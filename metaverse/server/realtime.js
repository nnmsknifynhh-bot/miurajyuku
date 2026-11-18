// リアルタイム機能（Socket.IO）
// 第2段階：位置・入室・着席・挙手（すべてサーバーが判定。画面側の判定は表示用）
// 第3段階：授業（先生の全体通話・画面共有）の開始・終了と、LiveKit 参加トークンの発行
// 第4段階：個別通話（先生→生徒の呼び出し・参加確認・別の通話部屋・授業音声との切り替え）
// - 接続はログイン中の Cookie で認証
const crypto = require('crypto');
const { Server } = require('socket.io');
const SM = require('../public/shared/map.js');
const auth = require('./auth');
const { db, now, audit, getSetting } = require('./db');
const livekit = require('./livekit');
const notify = require('./notify');
const ganbari = require('./ganbari');
const fun = require('./fun');
const kanken = require('./kanken');
const { can, canEnterRoom } = require('./permissions');

const T = SM.TILE;
const REACTIONS = ['👍', '👏', '😊', '❓', '💡', '🙏'];
const ROOM_TYPES = new Set(['classroom', 'study']);

let io = null;
const online = new Map();  // userId -> presence
const lastPos = new Map(); // userId -> { x, y }（再接続時に元の場所へ）
const lastOffline = new Map(); // userId -> 切断した時刻（すぐ入り直したときは入室の通知をしない）
// 自習中に通信が切れた生徒：{ at, seat }。STUDY_GAP_MS 以内につながり直したら、元の席にもどし、切れていた間も自習時間に数える
const studyGaps = new Map();
const STUDY_GAP_MS = Number(process.env.STUDY_GAP_MS || 5 * 60_000);
const REJOIN_QUIET_MS = Number(process.env.REJOIN_QUIET_MS || 10 * 60_000);

const getRooms = () => db.prepare('SELECT id, name, type, capacity FROM rooms ORDER BY sort_order').all();
const getRoom = (id) => db.prepare('SELECT id, name, type, capacity FROM rooms WHERE id = ?').get(id);
const roomIdAt = (x, y) => {
  const z = SM.zoneAtPx(x, y);
  return z && ROOM_TYPES.has(z.type) ? z.id : null;
};
const isStaff = (p) => p.user.role === 'owner' || p.user.role === 'teacher';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const DIRS = new Set(['up', 'down', 'left', 'right']);

// 見た目に必要な分だけ（期間外は全部 null）
const equipView = (e) => (e ? Object.fromEntries(ganbari.SLOTS.map(sl => [sl, e[sl] || null])) : null);

function pub(p) {
  return {
    id: p.id, name: p.user.display_name, role: p.user.role, color: p.user.avatar_color,
    x: p.x, y: p.y, dir: p.dir, moving: p.moving, room: p.room, seat: p.seat, hand: p.hand, handAt: p.handAt,
    inPrivate: inActiveCall(p), away: p.away || null, studyCam: !!p.studyCam, topic: p.topic || null, today: p.today10 ?? null,
    bday: !!(p.bday && p.bday.public),
    hs: !!p.hs, title: p.title || null, plan: p.plan || null, // 高校生：称号・今日やること（🔥は週で数える） // 誕生日（ほかの生徒にも見せる設定のときだけ。先生だけの設定は staff にだけ別に送る）
    equip: equipView(p.equip), streak: p.streak || 0,
  };
}

// ═════════ 自習室の見守り写真 ═════════
// 写真は最新の1枚だけをメモリに置く（データベースには保存しない）。自習室を出る・切断すると消える。
const studyPhotos = new Map(); // userId -> { buf, at, hash, fp, dark, still, reason }
const PHOTO_MIN_INTERVAL_MS = Number(process.env.STUDY_PHOTO_MIN_INTERVAL_MS || 60_000);
const studyPhotosEnabled = () => getSetting('study_photos', '0') === '1';
const canViewStudyPhotos = (u) => !!u && u.is_active && (u.role === 'owner' || (u.role === 'teacher' && can(u, 'handle_students')));
function notifyStudyViewers(payload) {
  for (const s of online.values()) if (canViewStudyPhotos(s.user)) s.socket.emit('study-photo', payload);
}
function clearStudyPhoto(p) {
  const had = studyPhotos.delete(p.id);
  if (p.studyCam) { p.studyCam = false; if (io) io.emit('user-updated', { id: p.id, studyCam: false }); }
  if (had) notifyStudyViewers({ id: p.id, at: null });
}

// ═════════ 第4段階：個別通話 ═════════
const calls = new Map(); // callId -> { id, teacherId, studentId, teacherName, studentName, status, createdAt, acceptedAt, lkRoom, ringTimer }
const RING_MS = Number(process.env.PRIVATE_RING_MS || 30_000);
const callOf = (p) => (p && p.callId ? calls.get(p.callId) || null : null);
function inActiveCall(p) { const c = callOf(p); return !!(c && c.status === 'active'); }

// 部屋ごとの人数（定員の対象は生徒のみ。先生・オーナーは数えない）
function roomCounts() {
  const c = {};
  for (const r of getRooms()) c[r.id] = { name: r.name, type: r.type, capacity: r.capacity, students: 0, staff: 0 };
  for (const p of online.values()) {
    if (!p.room || !c[p.room]) continue;
    if (p.user.role === 'student') c[p.room].students++; else c[p.room].staff++;
  }
  return c;
}
// 位置の更新はまとめて 0.1 秒ごとに1回送る（スマホの通信量を減らすため）
const pendingMoves = new Map(); // userId -> [id, x, y, dir, moving]
const DIR_CODE = { up: 'u', down: 'd', left: 'l', right: 'r' };
const r1 = (v) => Math.round(v * 10) / 10;
function queueMove(p) { pendingMoves.set(p.id, [p.id, r1(p.x), r1(p.y), DIR_CODE[p.dir] || 'd', p.moving ? 1 : 0]); }
function flushMoves() {
  if (!pendingMoves.size || !io) return;
  io.volatile.emit('moves', [...pendingMoves.values()]);
  pendingMoves.clear();
}

let roomsTimer = null;
function broadcastRooms() {
  if (roomsTimer || !io) return;
  roomsTimer = setTimeout(() => { roomsTimer = null; io.emit('rooms', roomCounts()); }, 100);
}

// 入室チェック：権限と定員
function entryError(p, roomId) {
  const room = getRoom(roomId);
  if (!room) return null;
  if (!canEnterRoom(p.user, room)) {
    if (p.user.role === 'student' && room.type === 'study') return room.id === 'class3' ? '高校生自習室は高校生の部屋です' : '高校生は「高校生自習室」で自習してね';
    return p.user.role === 'teacher' ? `${room.name}には入れません（担当の教室ではありません）` : `${room.name}には入れません`;
  }
  if (p.user.role === 'student') {
    let n = 0;
    for (const o of online.values()) if (o !== p && o.room === roomId && o.user.role === 'student') n++;
    if (n >= room.capacity) return `${room.name}は満員です（定員${room.capacity}人）`;
  }
  return null;
}

function spawnPos(p) {
  const saved = lastPos.get(p.id);
  if (saved && SM.isWalkable(Math.floor(saved.x / T), Math.floor(saved.y / T))) {
    const r = roomIdAt(saved.x, saved.y);
    if (!r || !entryError(p, r)) return saved;
  }
  const others = [...online.values()];
  const free = SM.SPAWN.filter(t => !others.some(o => Math.abs(o.x - (t.x + .5) * T) < T && Math.abs(o.y - (t.y + .5) * T) < T));
  const list = free.length ? free : SM.SPAWN;
  const t = list[Math.floor(Math.random() * list.length)];
  return SM.tileCenter(t.x, t.y);
}

// 先生（挙手に対応できる人）か
function canHandle(staff, roomId) {
  if (!isStaff(staff) || !can(staff.user, 'handle_students')) return false;
  const room = getRoom(roomId);
  return !!room && canEnterRoom(staff.user, room);
}

function lowerHand(p, byName) {
  if (!p.hand) return;
  p.hand = false; p.handAt = 0;
  io.emit('user-updated', { id: p.id, hand: false, handAt: 0 });
  if (byName) p.socket.emit('hand-lowered', { by: byName });
}

// ═════════ 第3段階：授業（全体通話・画面共有） ═════════
const classes = new Map(); // roomId -> { teacherId, teacherName, startedAt, mic, screen, graceTimer }
const GRACE_MS = Number(process.env.CLASS_GRACE_MS || 60_000);

function classState() {
  const s = {};
  for (const [id, c] of classes) {
    // away: 先生が個別指導中（授業の部屋には声が届かない）
    s[id] = { teacherId: c.teacherId, teacherName: c.teacherName, startedAt: c.startedAt, mic: c.mic, screen: c.screen, allowChat: !!c.allowChat, away: inActiveCall(online.get(c.teacherId)) };
  }
  return s;
}
function broadcastClasses() { if (io) io.emit('class-state', classState()); }

function endClass(roomId, reason, actorId) {
  const c = classes.get(roomId);
  if (!c) return false;
  clearTimeout(c.graceTimer);
  classes.delete(roomId);
  livekit.closeRoom(livekit.lkRoomName(roomId)); // 参加者全員を LiveKit から退出させる
  broadcastClasses();
  if (io) io.emit('class-ended', { room: roomId, reason: reason || null });
  audit(actorId ?? c.teacherId, 'class.ended', roomId, reason ? { reason } : null);
  return true;
}

// p が roomId から出たとき。mode: 'moved'（歩いて出た）| 'disconnected'（通信切れ）| 'kicked'（管理者が切断）
function leaveClassRoom(p, roomId, mode) {
  const c = classes.get(roomId);
  if (!c) return;
  livekit.removeParticipant(livekit.lkRoomName(roomId), p.id);
  if (c.teacherId !== p.id) return;
  if (mode === 'disconnected') {
    clearTimeout(c.graceTimer);
    c.graceTimer = setTimeout(() => endClass(roomId, '先生の接続が切れたため、授業を終了しました'), GRACE_MS);
  } else {
    endClass(roomId, mode === 'kicked' ? '授業を終了しました' : `${c.teacherName}先生が教室を出たため、授業を終了しました`);
  }
}

function endCall(call, reason, actorId) {
  if (!call || !calls.has(call.id)) return false;
  clearTimeout(call.ringTimer);
  calls.delete(call.id);
  const wasActive = call.status === 'active';
  for (const uid of [call.teacherId, call.studentId]) {
    const p = online.get(uid);
    if (!p || p.callId !== call.id) continue;
    p.callId = null;
    p.socket.emit('pc-ended', { callId: call.id, reason: reason || '個別通話を終了しました' });
    if (wasActive && io) io.emit('user-updated', { id: uid, inPrivate: false });
  }
  if (wasActive) {
    livekit.closeRoom(call.lkRoom);
    const minutes = Math.round((Date.now() - call.acceptedAt) / 6000) / 10;
    audit(actorId ?? call.teacherId, 'private.ended', call.studentName, { minutes });
    broadcastClasses();
  }
  return true;
}

// ───── スピーキング・ライティングテストの順番待ち（教室1） ─────
const TEST_ROOM = 'class1';
const testQ = { queue: [], booths: Object.fromEntries(SM.BOOTHS[TEST_ROOM].map(b => [`${b.x},${b.y}`, null])), leaveTimers: new Map() };
function boothOf(userId) { for (const [seat, id] of Object.entries(testQ.booths)) if (id === userId) return seat; return null; }
function testState() {
  const name = (id) => { const o = online.get(id); return o ? o.user.display_name : '（いません）'; };
  return {
    queue: testQ.queue.map((id, i) => ({ id, name: name(id), n: i + 1 })),
    booths: SM.BOOTHS[TEST_ROOM].map(b => { const seat = `${b.x},${b.y}`, id = testQ.booths[seat]; return { seat, name: b.name, userId: id, userName: id ? name(id) : null }; }),
  };
}
function broadcastTest() { if (io) io.emit('test-queue', testState()); }
function leaveTest(userId) {
  let changed = false;
  const i = testQ.queue.indexOf(userId);
  if (i >= 0) { testQ.queue.splice(i, 1); changed = true; }
  const seat = boothOf(userId);
  if (seat) { testQ.booths[seat] = null; changed = true; }
  if (changed) broadcastTest();
}
// テストの順番待ちを、生徒を見られる先生・オーナーに知らせる
function notifyStaffTest(text) {
  for (const s of online.values()) if (canViewStudyPhotos(s.user)) s.socket.emit('test-notice', { text });
}

function setRoom(p, roomId) {
  if (p.room === roomId) return;
  if (p.room === TEST_ROOM) leaveTest(p.id); // テストの教室を出たら、順番待ちからぬける
  if (p.hand) lowerHand(p);
  if (SM.isStudyRoom(p.room)) clearStudyPhoto(p);
  if (p.room) leaveClassRoom(p, p.room, 'moved');
  p.room = roomId;
  io.emit('user-updated', { id: p.id, room: roomId });
  broadcastRooms();
}

// 部屋から外へ出す（権限がなくなったときなど）
function forceOut(p, reason) {
  const exit = SM.EXIT[p.room] || SM.ENTRY.lobby;
  const c = SM.tileCenter(exit.x, exit.y);
  p.x = c.x; p.y = c.y; p.seat = null;
  setRoom(p, null);
  io.emit('user-updated', { id: p.id, x: p.x, y: p.y, seat: null });
  p.socket.emit('force-move', { x: p.x, y: p.y, reason });
}

function clientIp(socket) {
  if (process.env.TRUST_PROXY) {
    const xf = socket.handshake.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return socket.handshake.address;
}
function deviceLabel(ua) {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'その他';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} / ${br}` : os;
}

function attach(httpServer) {
  io = new Server(httpServer, { maxHttpBufferSize: 10_000, pingInterval: 20_000, pingTimeout: 20_000 });

  // 認証：ログイン中の Cookie が必要。他サイトからの接続は拒否
  io.use((socket, next) => {
    const req = socket.request;
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
      if (!ok) return next(new Error('forbidden'));
    }
    const u = auth.userFromRequest(req);
    if (!u) return next(new Error('unauthorized'));
    socket.data.user = u;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    // 入室前の漢字テスト：まだ答えていない生徒は入れない（すぐの入り直しは除く）
    if (kanken.required(user, { quickRejoin: isQuickRejoin(user.id) })) {
      socket.emit('quiz-required');
      socket.disconnect(true);
      return;
    }

    // 送りすぎ対策：移動以外のイベントは1人あたり平均10回/秒（瞬間的には20回）まで。超えた分は無視する
    const bucket = { tokens: 20, at: Date.now() };
    socket.use(([ev], next) => {
      if (ev === 'move') return next();
      const t = Date.now();
      bucket.tokens = Math.min(20, bucket.tokens + (t - bucket.at) / 100);
      bucket.at = t;
      if (bucket.tokens < 1) return; // 破棄（ack も返さない）
      bucket.tokens -= 1;
      next();
    });

    // 同じユーザーの古い接続は切る（1人1接続）
    const old = online.get(user.id);
    if (old) {
      // 前の接続がまだ残っていた（スマホの通信が切れたのに、サーバーが気づく前につながり直した）ときも、元の席にもどす
      if (old.user.role === 'student' && SM.isStudyRoom(old.room) && !old.away) studyGaps.set(old.id, { at: Date.now(), seat: old.seat, room: old.room });
      kickPresence(old, '別の端末（またはタブ）で入室したため、こちらは切断しました');
    }

    const p = {
      id: user.id, user, socket, tokenHash: user.sessionTokenHash,
      x: 0, y: 0, dir: 'down', moving: false, room: null, seat: null, hand: false, handAt: 0,
      connectedAt: Date.now(), ip: clientIp(socket), device: deviceLabel(socket.handshake.headers['user-agent']),
      lastMoveAt: 0, lastReactionAt: 0,
    };
    Object.assign(p, spawnPos(p));
    p.equip = ganbari.getEquip(p.id);
    p.streak = user.role === 'student' ? ganbari.streak(p.id) : 0;
    p.today10 = user.role === 'student' ? shownToday(ganbari.dayTotal(p.id, ganbari.jst().day)) : null;
    p.bday = user.role === 'student' ? ganbari.birthdayInfo(p.id) : null;
    refreshHS(p, false);
    p.room = roomIdAt(p.x, p.y);
    // 自習中に通信が切れていた生徒：すぐもどってきたら、元の席にすわらせ、切れていた間も数える
    let gapMinutes = 0;
    const gap = studyGaps.get(p.id);
    studyGaps.delete(p.id);
    if (gap && user.role === 'student' && Date.now() - gap.at <= STUDY_GAP_MS && p.room === gap.room) {
      if (gap.seat && ![...online.values()].some(o => o.id !== p.id && o.seat === gap.seat)) {
        const [sx, sy] = gap.seat.split(',').map(Number);
        const c = SM.tileCenter(sx, sy);
        if (Math.hypot(c.x - p.x, c.y - p.y) <= 8) { p.seat = gap.seat; p.x = c.x; p.y = c.y; p.dir = SM.seatFacing(sx, sy); }
      }
      try { gapMinutes = ganbari.creditGap(p.id, gap.at, Date.now(), Math.floor(STUDY_GAP_MS / 60_000)); } catch (e) { console.error('切れていた間の自習時間を足せませんでした:', e.message); }
      if (gapMinutes) { p.streak = ganbari.streak(p.id); p.today10 = shownToday(ganbari.dayTotal(p.id, ganbari.jst().day)); }
    }
    // 授業中の先生が再接続したら、授業の自動終了を取り消す
    const myClass = p.room && classes.get(p.room);
    if (myClass && myClass.teacherId === p.id) { clearTimeout(myClass.graceTimer); myClass.graceTimer = null; }
    online.set(p.id, p);
    if (isStaff(p)) socket.join('staff');

    // 生徒が「来た」ときだけ、オーナー・先生に通知（10分以内の入り直しは通知しない）
    if (user.role === 'student') {
      const off = lastOffline.get(p.id);
      const quiet = old || (off && Date.now() - off < REJOIN_QUIET_MS);
      if (!quiet) notify.studentArrived({ id: p.id, name: user.display_name, birthday: !!p.bday }, online).catch(e => console.error('入室通知に失敗:', e.message));
    }

    socket.emit('init', {
      me: { ...pub(p), bday: !!p.bday }, users: [...online.values()].filter(o => o !== p).map(pub), rooms: roomCounts(), reactions: REACTIONS,
      classes: classState(), classCall: livekit.enabled, testQueue: testState(),
    });
    if (gap && p.room === gap.room && Date.now() - gap.at <= STUDY_GAP_MS) socket.emit('study-resumed', { minutes: gapMinutes, seat: p.seat });
    socket.broadcast.emit('user-joined', pub(p));
    // 誕生日を「先生だけ」に見せる生徒：先生・オーナーにだけ🎂を知らせる
    if (p.bday && !p.bday.public) socket.to('staff').emit('user-updated', { id: p.id, bday: true });
    if (isStaff(p)) for (const o of online.values()) if (o !== p && o.bday && !o.bday.public) socket.emit('user-updated', { id: o.id, bday: true });
    // 誕生日の日にはじめて入ったら、お祝いカード（とプレゼント）
    if (p.bday) sendBirthdayCard(p);
    broadcastRooms();

    const reject = (reason) => socket.emit('move-rejected', { x: p.x, y: p.y, reason: reason || null });

    socket.on('move', (d) => {
      if (!d || typeof d !== 'object') return;
      const x = num(d.x), y = num(d.y);
      if (Number.isNaN(x) || Number.isNaN(y)) return;
      const t = Date.now();
      if (t - p.lastMoveAt < 20) return; // 送りすぎは無視（最大 50回/秒）
      p.lastMoveAt = t;
      if (Math.hypot(x - p.x, y - p.y) > T * 4) return reject('移動が速すぎます');
      if (!SM.isWalkable(Math.floor(x / T), Math.floor(y / T))) return reject(null);
      const newRoom = roomIdAt(x, y);
      if (newRoom && newRoom !== p.room) {
        const err = entryError(p, newRoom);
        if (err) return reject(err);
      }
      p.x = x; p.y = y;
      if (DIRS.has(d.dir)) p.dir = d.dir;
      p.moving = !!d.moving;
      if (p.seat) {
        const [sx, sy] = p.seat.split(',').map(Number);
        const c = SM.tileCenter(sx, sy);
        if (Math.hypot(c.x - x, c.y - y) > 8) { p.seat = null; io.emit('user-updated', { id: p.id, seat: null }); }
      }
      queueMove(p);
      if (newRoom !== p.room) setRoom(p, newRoom);
    });

    socket.on('sit', (seat, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      const m = /^(\d{1,3}),(\d{1,3})$/.exec(String(seat || ''));
      if (!m) return ack({ ok: false, error: 'そこには座れません' });
      const sx = Number(m[1]), sy = Number(m[2]);
      if (!SM.isSeat(sx, sy)) return ack({ ok: false, error: 'そこには座れません' });
      const c = SM.tileCenter(sx, sy);
      if (Math.hypot(c.x - p.x, c.y - p.y) > T * 1.6) return ack({ ok: false, error: '席が遠すぎます' });
      const seatRoom = roomIdAt(c.x, c.y);
      if (seatRoom !== p.room) return ack({ ok: false, error: '先に部屋に入ってください' });
      const id = SM.seatId(sx, sy);
      for (const o of online.values()) if (o !== p && o.seat === id) return ack({ ok: false, error: 'その席はほかの人が使っています' });
      // テストのブースは、先生に呼ばれた生徒だけ
      if (SM.isBoothSeat(id) && p.user.role === 'student' && boothOf(p.id) !== id) return ack({ ok: false, error: 'テストのブースは、先生に呼ばれたらすわれます' });
      p.seat = id; p.x = c.x; p.y = c.y; p.dir = SM.seatFacing(sx, sy); p.moving = false;
      ack({ ok: true, x: p.x, y: p.y, dir: p.dir });
      socket.broadcast.emit('user-updated', { id: p.id, seat: id, x: p.x, y: p.y, dir: p.dir, moving: false });
    });

    socket.on('stand', () => {
      if (!p.seat) return;
      p.seat = null;
      io.emit('user-updated', { id: p.id, seat: null });
    });

    // ── 挙手 ──
    socket.on('hand', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      const raised = !!(d && d.raised);
      if (!raised) { lowerHand(p); return ack({ ok: true }); }
      if (p.user.role !== 'student') return ack({ ok: false, error: '挙手は生徒の機能です' });
      const room = p.room && getRoom(p.room);
      if (!room || room.type !== 'classroom') return ack({ ok: false, error: '授業の教室に入ってから手をあげてね' });
      if (p.hand) return ack({ ok: true });
      // 手のあげさげを連打して先生に通知が大量に届かないように
      if (Date.now() - (p.lastHandAt || 0) < 3000) return ack({ ok: false, error: 'すこし待ってから、もう一度手をあげてね' });
      p.lastHandAt = Date.now();
      p.hand = true; p.handAt = Date.now();
      io.emit('user-updated', { id: p.id, hand: true, handAt: p.handAt });
      for (const s of online.values()) {
        if (s !== p && canHandle(s, room.id)) s.socket.emit('hand-raised', { id: p.id, name: p.user.display_name, room: room.id, roomName: room.name });
      }
      ack({ ok: true });
    });

    socket.on('lower-hand', (targetId, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      const target = online.get(Number(targetId));
      if (!target || !target.hand) return ack({ ok: false, error: '手をあげている生徒が見つかりません' });
      if (!canHandle(p, target.room)) return ack({ ok: false, error: 'この操作は許可されていません' });
      lowerHand(target, p.user.display_name);
      ack({ ok: true });
    });

    // ── リアクション ──
    socket.on('reaction', (kind) => {
      if (!REACTIONS.includes(kind)) return;
      // 生徒のスタンプは、先生・オーナーに話しかけられているとき（近く・個別通話中・授業中の教室）だけ
      if (p.user.role === 'student' && !studentChatAllowed(p)) return;
      const t = Date.now();
      if (t - p.lastReactionAt < 1200) return;
      p.lastReactionAt = t;
      io.emit('reaction', { id: p.id, kind });
    });

    // ── 授業（第3段階） ──
    const classRoomOf = () => {
      const room = p.room && getRoom(p.room);
      return room && room.type === 'classroom' ? room : null;
    };
    socket.on('class-start', (_d, ack) => {
      if (typeof ack !== 'function') return;
      if (!livekit.enabled) return ack({ ok: false, error: '通話サーバー（LiveKit）が設定されていません' });
      if (!isStaff(p) || !can(p.user, 'start_class_call')) return ack({ ok: false, error: '授業を始める権限がありません' });
      const room = classRoomOf();
      if (!room || !canEnterRoom(p.user, room)) return ack({ ok: false, error: '担当の教室に入ってから始めてください' });
      const cur = classes.get(room.id);
      if (cur && cur.teacherId !== p.id) return ack({ ok: false, error: `${cur.teacherName}先生が授業中です` });
      if (!cur) {
        classes.set(room.id, { teacherId: p.id, teacherName: p.user.display_name, startedAt: Date.now(), mic: false, screen: false, allowChat: false, graceTimer: null });
        audit(p.id, 'class.started', room.id, null, p.ip);
        broadcastClasses();
      }
      ack({ ok: true });
    });

    socket.on('class-end', (_d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      const c = p.room && classes.get(p.room);
      if (!c) return ack({ ok: false, error: '授業中ではありません' });
      if (c.teacherId !== p.id && p.user.role !== 'owner') return ack({ ok: false, error: '授業を終了する権限がありません' });
      endClass(p.room, null, p.id);
      ack({ ok: true });
    });

    // 参加用トークン：いる部屋が授業中のときだけ発行。送信できるのは授業を始めた先生だけ
    let lastTokenAt = 0;
    socket.on('lk-token', async (_d, ack) => {
      if (typeof ack !== 'function') return;
      const c = p.room && classes.get(p.room);
      if (!livekit.enabled || !c) return ack({ ok: false, error: 'いまは授業中ではありません' });
      if (inActiveCall(p)) return ack({ ok: false, error: '個別通話中は授業の音声は止まっています' });
      if (Date.now() - lastTokenAt < 1500) return ack({ ok: false, error: 'しばらく待ってからもう一度ためしてください' });
      lastTokenAt = Date.now();
      const isTeacher = c.teacherId === p.id;
      const canScreen = isTeacher && can(p.user, 'share_screen');
      try {
        const token = await livekit.makeToken({
          userId: p.id, name: p.user.display_name, role: p.user.role, room: livekit.lkRoomName(p.room), mic: isTeacher, screen: canScreen,
        });
        ack({ ok: true, url: livekit.url, token, room: p.room, publisher: isTeacher, canScreen });
      } catch (e) {
        ack({ ok: false, error: '通話の準備に失敗しました' });
      }
    });

    // 先生のマイク・画面共有の状態（表示用。送信できるかどうかはトークンで決まる）
    let lastMediaAt = 0;
    socket.on('class-media', (d) => {
      if (Date.now() - lastMediaAt < 300) return;
      lastMediaAt = Date.now();
      const c = p.room && classes.get(p.room);
      if (!c || c.teacherId !== p.id || !d || typeof d !== 'object') return;
      c.mic = !!d.mic;
      c.screen = !!d.screen && can(p.user, 'share_screen');
      broadcastClasses();
    });

    // 授業中の生徒のスタンプ・吹き出しを、授業をしている先生（またはオーナー）が許可する／止める
    socket.on('class-chat', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      const c = p.room && classes.get(p.room);
      if (!c) return ack({ ok: false, error: '授業中ではありません' });
      if (c.teacherId !== p.id && p.user.role !== 'owner') return ack({ ok: false, error: '授業をしている先生だけが変えられます' });
      c.allowChat = !!(d && d.allow);
      broadcastClasses();
      if (!c.allowChat) { // 止めたら、その教室の生徒の吹き出しを消す
        for (const o of online.values()) {
          if (o.user.role !== 'student' || o.room !== p.room || !o.topic || inActiveCall(o)) continue;
          o.topic = null;
          io.emit('user-updated', { id: o.id, topic: null });
          o.socket.emit('topic-cleared', { by: null, reason: 'class' });
        }
      }
      ack({ ok: true, allowChat: c.allowChat });
    });

    // ── 個別通話（第4段階） ──
    // 先生だけが呼び出せる。生徒から生徒・先生へ呼び出す手段は用意しない
    socket.on('pc-invite', (d, ack) => {
      if (typeof ack !== 'function') return;
      if (!livekit.enabled) return ack({ ok: false, error: '通話サーバー（LiveKit）が設定されていません' });
      if (!isStaff(p) || !can(p.user, 'start_private_call')) return ack({ ok: false, error: '個別通話を始める権限がありません' });
      const target = online.get(Number(d && d.studentId));
      if (!target || target.user.role !== 'student') return ack({ ok: false, error: '生徒が見つかりません（退室した可能性があります）' });
      const room = target.room && getRoom(target.room);
      if (!room || !canEnterRoom(p.user, room)) return ack({ ok: false, error: '担当の教室か自習室にいる生徒だけ呼び出せます' });
      if (p.callId) return ack({ ok: false, error: 'すでに個別通話中（または呼び出し中）です' });
      if (target.callId) return ack({ ok: false, error: `${target.user.display_name}さんはほかの先生と通話中です` });
      const call = {
        id: crypto.randomUUID(), teacherId: p.id, studentId: target.id,
        teacherName: p.user.display_name, studentName: target.user.display_name,
        status: 'ringing', createdAt: Date.now(), acceptedAt: 0, ringTimer: null,
      };
      call.lkRoom = livekit.lkRoomName(call.id, 'private');
      call.ringTimer = setTimeout(() => endCall(call, `${call.studentName}さんが応答しませんでした`), RING_MS);
      calls.set(call.id, call);
      p.callId = call.id; target.callId = call.id;
      target.socket.emit('pc-incoming', { callId: call.id, teacherName: call.teacherName, timeoutMs: RING_MS });
      audit(p.id, 'private.invited', target.user.login_id, null, p.ip);
      ack({ ok: true, callId: call.id, studentName: call.studentName });
    });

    socket.on('pc-respond', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      const call = callOf(p);
      if (!call || call.studentId !== p.id || call.status !== 'ringing' || !d || d.callId !== call.id) return ack({ ok: false, error: 'この呼び出しは終了しています' });
      if (!d.accept) { endCall(call, `${call.studentName}さんは「あとで」を選びました`, p.id); return ack({ ok: true }); }
      clearTimeout(call.ringTimer);
      call.status = 'active'; call.acceptedAt = Date.now();
      const teacher = online.get(call.teacherId);
      lowerHand(p);
      // 授業の部屋から2人を退出させる（個別通話の声が授業に混ざらない・授業の声も個別通話に混ざらない）
      for (const u of [teacher, p]) {
        if (!u) continue;
        if (u.room && classes.has(u.room)) livekit.removeParticipant(livekit.lkRoomName(u.room), u.id);
        io.emit('user-updated', { id: u.id, inPrivate: true });
        u.socket.emit('pc-started', { callId: call.id, teacherName: call.teacherName, studentName: call.studentName, role: u === p ? 'student' : 'teacher' });
      }
      broadcastClasses();
      audit(p.id, 'private.started', call.studentName, { teacher: call.teacherName });
      ack({ ok: true });
    });

    let lastPcTokenAt = 0;
    socket.on('pc-token', async (d, ack) => {
      if (typeof ack !== 'function') return;
      const call = callOf(p);
      if (!call || call.status !== 'active' || !d || d.callId !== call.id) return ack({ ok: false, error: '個別通話は終了しています' });
      if (Date.now() - lastPcTokenAt < 1500) return ack({ ok: false, error: 'しばらく待ってからもう一度ためしてください' });
      lastPcTokenAt = Date.now();
      const isTeacher = call.teacherId === p.id;
      try {
        const token = await livekit.makeToken({
          userId: p.id, name: p.user.display_name, role: p.user.role, room: call.lkRoom,
          mic: true, screen: isTeacher && can(p.user, 'share_screen'), camera: !isTeacher,
        });
        ack({ ok: true, url: livekit.url, token, canScreen: isTeacher && can(p.user, 'share_screen'), canCamera: !isTeacher });
      } catch (e) {
        ack({ ok: false, error: '通話の準備に失敗しました' });
      }
    });

    socket.on('pc-end', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      const call = callOf(p);
      if (!call || !d || d.callId !== call.id) return ack({ ok: false });
      const who = p.id === call.teacherId ? `${call.teacherName}先生` : `${call.studentName}さん`;
      endCall(call, call.status === 'ringing' && p.id === call.teacherId ? '先生が呼び出しを取り消しました' : `${who}が個別通話を終了しました`, p.id);
      ack({ ok: true });
    });

    // ── 吹き出し（全員・どの部屋でも。自分で消すか、切断するまで表示） ──
    socket.on('study-topic', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      const text = String((d && d.text) || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
      // 生徒の吹き出しは、先生・オーナーと話すとき（近くにいる・個別通話中）だけ
      if (text && p.user.role === 'student' && !studentChatAllowed(p)) {
        return ack({ ok: false, error: p.room && classes.has(p.room) ? '授業中は、先生がOKを出したときだけ吹き出しを使えます' : '吹き出しは、先生と話すときだけ使えます。先生に近くに来てもらってね' });
      }
      p.topic = text || null;
      io.emit('user-updated', { id: p.id, topic: p.topic });
      ack({ ok: true, topic: p.topic });
    });
    // 高校生：今日やること（3つ）を書く。高校生自習室にいるときだけ
    socket.on('study-plan', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (p.user.role !== 'student' || !ganbari.isHS(p.user.grade)) return ack({ ok: false, error: '高校生の機能です' });
      if (p.room !== 'class3') return ack({ ok: false, error: '高校生自習室に入ってから書いてください' });
      const err = ganbari.setPlan(p.id, d && d.items);
      if (err) return ack({ ok: false, error: err });
      refreshHS(p);
      ack({ ok: true, plan: p.plan });
    });
    // ── スピーキング・ライティングテストの順番待ち ──
    socket.on('test-join', (_d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (p.user.role !== 'student') return ack({ ok: false, error: '生徒の機能です' });
      if (p.room !== TEST_ROOM) return ack({ ok: false, error: 'スピーキング・ライティング教室に入ってから並んでね' });
      if (boothOf(p.id)) return ack({ ok: false, error: 'いまテストのブースにいます' });
      if (!testQ.queue.includes(p.id)) {
        testQ.queue.push(p.id);
        notifyStaffTest(`🎤 ${p.user.display_name}さんがテストの順番待ちに並びました（${testQ.queue.length}人待ち）`);
      }
      broadcastTest();
      ack({ ok: true, n: testQ.queue.indexOf(p.id) + 1 });
    });
    socket.on('test-leave', (_d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      leaveTest(p.id);
      ack({ ok: true });
    });
    // 先生：次の人をブースへ呼ぶ
    socket.on('test-next', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!canViewStudyPhotos(p.user)) return ack({ ok: false, error: 'この操作は許可されていません' });
      const seat = d && d.seat && d.seat in testQ.booths ? d.seat : Object.keys(testQ.booths).find(s => !testQ.booths[s]);
      if (!seat || testQ.booths[seat]) return ack({ ok: false, error: '空いているブースがありません' });
      const id = testQ.queue.find(uid => online.has(uid));
      if (!id) return ack({ ok: false, error: '順番待ちの生徒がいません' });
      testQ.queue.splice(testQ.queue.indexOf(id), 1);
      testQ.booths[seat] = id;
      const st = online.get(id);
      const b = SM.BOOTHS[TEST_ROOM].find(x => `${x.x},${x.y}` === seat);
      st.socket.emit('test-called', { seat, name: b.name, by: p.user.display_name });
      broadcastTest();
      ack({ ok: true, userId: id, name: st.user.display_name, seat });
    });
    // 先生：テストが終わった（ブースをあける）
    socket.on('test-done', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!canViewStudyPhotos(p.user)) return ack({ ok: false, error: 'この操作は許可されていません' });
      const id = Number(d && d.userId);
      const seat = boothOf(id);
      if (!seat) return ack({ ok: false, error: 'ブースにいません' });
      testQ.booths[seat] = null;
      const st = online.get(id);
      if (st) {
        if (st.seat === seat) { st.seat = null; io.emit('user-updated', { id: st.id, seat: null }); }
        st.socket.emit('test-finished', { by: p.user.display_name });
      }
      broadcastTest();
      ack({ ok: true });
    });

    // 先生がほかの人の吹き出しを消す（ふさわしくない内容など）
    socket.on('study-topic-clear', (targetId, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!isStaff(p) || !can(p.user, 'handle_students')) return ack({ ok: false, error: 'この操作は許可されていません' });
      const t = online.get(Number(targetId));
      if (!t || !t.topic) return ack({ ok: false, error: '吹き出しはありません' });
      t.topic = null;
      io.emit('user-updated', { id: t.id, topic: null });
      t.socket.emit('topic-cleared', { by: `${p.user.display_name}先生` });
      ack({ ok: true });
    });

    // ── 離席（アプリを閉じた・別のアプリに切り替えた） ──
    // away: 'hidden'（アプリを閉じた・別アプリ）| 'blur'（別の画面を操作中）| null（アプリを見ている）
    socket.on('away', (d) => {
      const kind = d && (d.away === 'hidden' || d.away === 'blur') ? d.away : null;
      if (kind === (p.away || null)) return;
      p.away = kind;
      io.emit('user-updated', { id: p.id, away: kind });
    });

    // 先生が「今すぐ撮る」：生徒が準備できないタイミングで写真を撮る（ずる防止）
    socket.on('study-photo-request', (d, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!canViewStudyPhotos(p.user)) return ack({ ok: false, error: '権限がありません' });
      const t = online.get(Number(d && d.studentId));
      if (!t || !SM.isStudyRoom(t.room) || !t.studyCam) return ack({ ok: false, error: 'カメラがオンの自習中の生徒だけ撮影できます' });
      if (Date.now() - (t.lastPhotoRequestAt || 0) < 30_000) return ack({ ok: false, error: '30秒ほど待ってからもう一度押してください' });
      t.lastPhotoRequestAt = Date.now(); // 連打防止（30秒に1回）
      t.photoRequestedAt = Date.now();   // 未使用の撮影リクエスト（1回使うと消える）
      t.photoRequestedBy = p.id;         // 結果（届いた／届かなかった）を知らせる相手
      t.socket.emit('take-photo');
      ack({ ok: true });
    });

    // ── 自習室の見守りカメラのオン/オフ（表示用。写真そのものは HTTP で送る） ──
    socket.on('study-camera', (d) => {
      const on = !!(d && d.on) && p.user.role === 'student' && SM.isStudyRoom(p.room) && studyPhotosEnabled();
      if (on === !!p.studyCam) return;
      p.studyCam = on;
      io.emit('user-updated', { id: p.id, studyCam: on });
      if (!on) { if (studyPhotos.delete(p.id)) notifyStudyViewers({ id: p.id, at: null }); }
    });

    // 生徒の端末で「今すぐ撮る」に失敗したとき、頼んだ先生に知らせる
    socket.on('study-photo-failed', (d) => {
      const by = p.photoRequestedBy && online.get(p.photoRequestedBy);
      if (!by || !p.photoRequestedAt) return;
      p.photoRequestedAt = 0;
      by.socket.emit('study-photo-result', { id: p.id, name: p.user.display_name, ok: false, reason: String((d && d.reason) || '').slice(0, 60) });
    });

    socket.on('disconnect', () => {
      if (online.get(p.id) !== p) return;
      // 通信が一瞬切れただけなら順番は残す（2分もどらなければぬける）
      if (testQ.queue.includes(p.id) || boothOf(p.id)) {
        clearTimeout(testQ.leaveTimers.get(p.id));
        testQ.leaveTimers.set(p.id, setTimeout(() => { testQ.leaveTimers.delete(p.id); if (!online.has(p.id)) leaveTest(p.id); }, Number(process.env.TEST_LEAVE_MS || 120_000)));
      }
      clearStudyPhoto(p);
      if (p.callId) endCall(callOf(p), `${p.user.display_name}${isStaff(p) ? '先生' : 'さん'}の接続が切れたため、個別通話を終了しました`);
      if (p.room) leaveClassRoom(p, p.room, 'disconnected');
      lastPos.set(p.id, { x: p.x, y: p.y });
      lastOffline.set(p.id, Date.now());
      if (p.user.role === 'student' && SM.isStudyRoom(p.room) && !p.away) studyGaps.set(p.id, { at: Date.now(), seat: p.seat, room: p.room });
      online.delete(p.id);
      pendingMoves.delete(p.id);
      io.emit('user-left', { id: p.id });
      broadcastRooms();
    });
  });

  setInterval(flushMoves, 100).unref();

  // 先生・オーナーがはなれたら、生徒の吹き出しを消す（10秒ごと）
  setInterval(() => {
    for (const p of online.values()) {
      if (p.user.role !== 'student' || !p.topic || studentChatAllowed(p)) continue;
      p.topic = null;
      io.emit('user-updated', { id: p.id, topic: null });
      p.socket.emit('topic-cleared', { by: null });
    }
  }, Number(process.env.TOPIC_CHECK_MS || 10_000)).unref();

  // 自習時間を1分ごとに数える（条件は ganbari.js・管理画面で設定）
  let dressupWasOpen = ganbari.dressupOpen();
  setInterval(() => {
    try {
      // 着せかえ期間が始まった・終わったら、全員の見た目を更新
      const open = ganbari.dressupOpen();
      if (open !== dressupWasOpen) { dressupWasOpen = open; refreshAllGanbari(); }
      const added = ganbari.tick(online, { photosOn: studyPhotosEnabled() });
      for (const id of added) {
        const p = online.get(id);
        if (!p) continue;
        const s = ganbari.streak(id);
        if (s !== p.streak) { p.streak = s; io.emit('user-updated', { id, streak: s }); }
        p.socket.emit('study-minute');
      }
      // 🌅 朝活チャレンジ：朝（初期設定 6:00〜7:30）に数えた時間で早起きスタンプとポイント
      for (const r of fun.morningTick(added)) {
        const p = online.get(r.id);
        if (p) p.socket.emit('fun-event', { kind: 'asa', stamps: r.stamps, points: r.points });
      }
      for (const p of online.values()) { updateToday(p); refreshBirthday(p); refreshHS(p); } // 日付が変わったときも 0 にもどる
      // 決めた曜日・時刻を過ぎても来ていない高校生を、先生に知らせる
      for (const s of ganbari.lateStudents(new Set(online.keys()))) notify.studentLate(s, online).catch(e => console.error('遅れの通知に失敗:', e.message));
    } catch (e) { console.error('自習時間の記録に失敗:', e.message); }
  }, Number(process.env.STUDY_TICK_MS || 60_000)).unref();

  // ログインが無効になった接続を定期的に切る（強制ログアウト・期限切れの取りこぼし防止）
  setInterval(() => {
    for (const p of online.values()) {
      const s = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(p.tokenHash);
      const u = db.prepare('SELECT is_active FROM users WHERE id = ?').get(p.id);
      if (!s || s.expires_at < now() || !u || !u.is_active) kickPresence(p, 'ログインが切れました。もう一度ログインしてください');
    }
  }, 30_000).unref();

  return io;
}

function kickPresence(p, reason, mode = 'disconnected') {
  p.socket.emit('kicked', { reason });
  if (online.get(p.id) === p) {
    clearStudyPhoto(p);
    if (p.callId) endCall(callOf(p), `${p.user.display_name}${isStaff(p) ? '先生' : 'さん'}の接続が切れたため、個別通話を終了しました`);
    if (p.room) leaveClassRoom(p, p.room, mode);
    lastPos.set(p.id, { x: p.x, y: p.y });
    lastOffline.set(p.id, Date.now());
    online.delete(p.id);
    if (io) { io.emit('user-left', { id: p.id }); broadcastRooms(); }
  }
  p.socket.disconnect(true);
}

// ── 管理機能から呼ばれる ──
function kick(userId, reason) {
  const p = online.get(Number(userId));
  if (!p) return false;
  kickPresence(p, reason || '管理者によって接続が切断されました', 'kicked');
  return true;
}

// 権限・担当教室・名前などが変わったとき
function refreshUser(userId) {
  const p = online.get(Number(userId));
  if (!p) return;
  const u = auth.loadUser(p.id);
  if (!u || !u.is_active) return kick(p.id, 'このアカウントは使えなくなりました');
  const hadScreen = can(p.user, 'share_screen');
  p.user = { ...u, sessionTokenHash: p.tokenHash };
  refreshBirthday(p); // 誕生日の登録・見せ方が変わったとき
  refreshHS(p);
  // 授業中に通話・画面共有の権限が外されたら授業を終了する
  for (const [roomId, c] of classes) {
    if (c.teacherId !== p.id) continue;
    if (!can(p.user, 'start_class_call') || (hadScreen && !can(p.user, 'share_screen'))) endClass(roomId, '先生の権限が変更されたため、授業を終了しました');
  }
  const call = callOf(p);
  if (call && call.teacherId === p.id && (!can(p.user, 'start_private_call') || (hadScreen && !can(p.user, 'share_screen')))) {
    endCall(call, '先生の権限が変更されたため、個別通話を終了しました');
  }
  io.emit('user-updated', { id: p.id, name: u.display_name, color: u.avatar_color });
  p.socket.emit('me-updated');
  if (p.room) {
    const room = getRoom(p.room);
    if (!canEnterRoom(p.user, room)) forceOut(p, `${room.name}に入る権限がなくなったため、ろうかへ移動しました`);
  }
}

function refreshRooms() { broadcastRooms(); }

// 高校生の称号・今日やることを読みなおす（変わったら知らせる）
function refreshHS(p, emit = true) {
  const hs = p.user.role === 'student' && ganbari.isHS(p.user.grade);
  const t = hs ? ganbari.titleOf(p.id) : null;
  const next = { hs, title: t && t.name ? t.name : null, plan: hs ? ganbari.planOf(p.id) : null };
  const changed = next.hs !== !!p.hs || next.title !== (p.title || null) || JSON.stringify(next.plan) !== JSON.stringify(p.plan || null);
  Object.assign(p, next);
  if (changed && emit && io) io.emit('user-updated', { id: p.id, hs: next.hs, title: next.title, plan: next.plan });
}
// 誕生日カード：その日にはじめてのときだけ（ganbari 側で1日1回に限る）
function sendBirthdayCard(p) {
  try {
    const r = ganbari.celebrateBirthday(p.id);
    if (!r) return;
    p.socket.emit('birthday', { name: p.user.display_name, message: r.message, gift: r.gift });
    if (r.gift) { p.equip = ganbari.getEquip(p.id); }
  } catch (e) { console.error('誕生日のお祝いに失敗:', e.message); }
}
// 日付が変わったときなどに、誕生日の🎂を付けたり外したりする
function refreshBirthday(p) {
  if (p.user.role !== 'student') return;
  const b = ganbari.birthdayInfo(p.id);
  const was = p.bday ? (p.bday.public ? 'public' : 'staff') : null, now = b ? (b.public ? 'public' : 'staff') : null;
  if (was === now) return;
  p.bday = b;
  if (now === 'public' || was === 'public') io.emit('user-updated', { id: p.id, bday: now === 'public' });
  if (now === 'staff' || was === 'staff') { io.to('staff').emit('user-updated', { id: p.id, bday: now !== null }); p.socket.emit('user-updated', { id: p.id, bday: now !== null }); }
  if (b) sendBirthdayCard(p);
}
// 生徒が吹き出し・スタンプを使えるか。
// 授業中の教室では、先生が「スタンプ・吹き出しOK」にしているときだけ（個別通話中は別）。それ以外は先生と話しているときだけ
function studentChatAllowed(p) {
  if (inActiveCall(p)) return true;
  const c = p.room && classes.get(p.room);
  if (c) return !!c.allowChat;
  return talkingWithStaff(p);
}
// 生徒が先生・オーナーと話している（近くにいる・個別通話中）か
const TALK_DIST = T * 3.5;
function talkingWithStaff(p) {
  if (inActiveCall(p)) return true;
  for (const o of online.values()) {
    if (o !== p && isStaff(o) && o.room === p.room && Math.hypot(o.x - p.x, o.y - p.y) <= TALK_DIST) return true;
  }
  return false;
}
// 頭の上に出す今日の自習時間：10分までは1分ごと、1時間までは5分ごと、1時間からは10分ごと（切り捨て）
function shownToday(m) {
  if (m < 10) return m;
  if (m < 60) return Math.floor(m / 5) * 5;
  return Math.floor(m / 10) * 10;
}
// 今日の自習時間（表示用に丸めたもの）を更新して、変わったら全員に知らせる
function updateToday(p) {
  if (p.user.role !== 'student') return;
  const v = shownToday(ganbari.dayTotal(p.id, ganbari.jst().day));
  if (v === p.today10) return;
  p.today10 = v;
  if (io) io.emit('user-updated', { id: p.id, today: v });
}

// 少し前まで入室していた（通信が一瞬切れただけ）か
function isQuickRejoin(userId) {
  if (online.has(userId)) return true;
  const off = lastOffline.get(userId);
  return !!(off && Date.now() - off < REJOIN_QUIET_MS);
}

// 着せかえ・自習時間の修正などのあとに、表示を更新する
function refreshGanbari(userId) {
  const p = online.get(Number(userId));
  if (!p) return;
  p.equip = ganbari.getEquip(p.id);
  p.streak = p.user.role === 'student' ? ganbari.streak(p.id) : 0;
  io.emit('user-updated', { id: p.id, equip: equipView(p.equip), streak: p.streak });
  updateToday(p);
  refreshHS(p);
}
function refreshAllGanbari() { for (const id of online.keys()) refreshGanbari(id); }

// 見守り写真を受け取る（生徒・自習室にいる・機能がオンのときだけ）。エラーならメッセージを返す
// meta: { brightness: 0〜255, fp: 64ビットの「写真の特徴」(16進), reason: 'auto'|'request' }
function storeStudyPhoto(userId, buf, meta = {}) {
  if (!studyPhotosEnabled()) return '見守り写真はオフになっています';
  const p = online.get(Number(userId));
  if (!p || p.user.role !== 'student') return '送信できません';
  if (!SM.isStudyRoom(p.room)) return '自習室に入ってから送信してください';
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return '写真の形式が正しくありません';
  const prev = studyPhotos.get(p.id);
  const requested = p.photoRequestedAt && Date.now() - p.photoRequestedAt < 60_000;
  const minGap = requested ? 1_000 : PHOTO_MIN_INTERVAL_MS; // 「今すぐ撮る」は1回だけ・30秒に1回までなので短くてよい
  if (prev && Date.now() - prev.at < minGap) return '送信の間隔が短すぎます';
  // 前と「まったく同じファイル」は、カメラで撮った写真ではない（保存しておいた写真の使い回し）
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (prev && prev.hash === hash) return '同じ写真は送信できません';
  const fp = /^[0-9a-f]{16}$/.test(meta.fp || '') ? meta.fp : null;
  const brightness = Number.isFinite(Number(meta.brightness)) ? Number(meta.brightness) : null;
  // 前の写真とほとんど同じなら「動きなし」を数える（3回続くと約30分動きなし）
  let still = 0;
  if (fp && prev && prev.fp) {
    let diff = 0;
    const a = BigInt('0x' + fp) ^ BigInt('0x' + prev.fp);
    for (let x = a; x; x >>= 1n) diff += Number(x & 1n);
    still = diff <= 3 ? (prev.still || 0) + 1 : 0;
  }
  const at = Date.now();
  const reason = requested && meta.reason === 'request' ? 'request' : 'auto';
  if (reason === 'request') {
    p.photoRequestedAt = 0;
    const by = p.photoRequestedBy && online.get(p.photoRequestedBy);
    if (by) by.socket.emit('study-photo-result', { id: p.id, name: p.user.display_name, ok: true });
  }
  studyPhotos.set(p.id, { buf, at, hash, fp, still, reason, dark: brightness !== null && brightness < 25 });
  if (!p.studyCam) { p.studyCam = true; io.emit('user-updated', { id: p.id, studyCam: true }); }
  notifyStudyViewers({ id: p.id, at });
  return null;
}
function getStudyPhoto(userId) { return studyPhotos.get(Number(userId)) || null; }
function studyPhotoTimes() {
  const o = {};
  for (const [id, v] of studyPhotos) o[id] = { at: v.at, dark: v.dark, still: v.still, reason: v.reason };
  return o;
}

// 見守り写真の設定を変えたとき
function setStudyPhotosFeature(on) {
  if (!on) {
    for (const p of online.values()) clearStudyPhoto(p);
    studyPhotos.clear();
  }
  if (io) io.emit('features', { studyPhotos: !!on });
}

// 管理者が個別通話を終了させる
function endCallOf(userId, actorId) {
  const p = online.get(Number(userId));
  const call = callOf(p);
  return call ? endCall(call, '管理者が個別通話を終了しました', actorId) : false;
}

function presence() {
  return [...online.values()].map(p => ({
    privateWith: (() => { const c = callOf(p); if (!c || c.status !== 'active') return null; return p.id === c.teacherId ? c.studentName : c.teacherName; })(),
    ...pub(p), loginId: p.user.login_id, zone: (SM.zoneAtPx(p.x, p.y) || {}).id || null,
    connectedAt: new Date(p.connectedAt).toISOString(), ip: p.ip, device: p.device,
  }));
}

function _reset() { online.clear(); lastPos.clear(); lastOffline.clear(); calls.clear(); studyPhotos.clear(); }

module.exports = {
  shownToday,
  isQuickRejoin, refreshGanbari, refreshBirthday, refreshAllGanbari, _online: online,
  storeStudyPhoto, getStudyPhoto, studyPhotoTimes, canViewStudyPhotos, setStudyPhotosFeature, studyPhotosEnabled,
  attach, kick, refreshUser, refreshRooms, presence, roomCounts, classState, endClass, endCallOf, REACTIONS, _reset };
