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
const { can, canEnterRoom } = require('./permissions');

const T = SM.TILE;
const REACTIONS = ['👍', '👏', '😊', '❓', '💡', '🙏'];
const ROOM_TYPES = new Set(['classroom', 'study']);

let io = null;
const online = new Map();  // userId -> presence
const lastPos = new Map(); // userId -> { x, y }（再接続時に元の場所へ）

const getRooms = () => db.prepare('SELECT id, name, type, capacity FROM rooms ORDER BY sort_order').all();
const getRoom = (id) => db.prepare('SELECT id, name, type, capacity FROM rooms WHERE id = ?').get(id);
const roomIdAt = (x, y) => {
  const z = SM.zoneAtPx(x, y);
  return z && ROOM_TYPES.has(z.type) ? z.id : null;
};
const isStaff = (p) => p.user.role === 'owner' || p.user.role === 'teacher';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const DIRS = new Set(['up', 'down', 'left', 'right']);

function pub(p) {
  return {
    id: p.id, name: p.user.display_name, role: p.user.role, color: p.user.avatar_color,
    x: p.x, y: p.y, dir: p.dir, moving: p.moving, room: p.room, seat: p.seat, hand: p.hand, handAt: p.handAt,
    inPrivate: inActiveCall(p), away: p.away || null, studyCam: !!p.studyCam,
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
    s[id] = { teacherId: c.teacherId, teacherName: c.teacherName, startedAt: c.startedAt, mic: c.mic, screen: c.screen, away: inActiveCall(online.get(c.teacherId)) };
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

function setRoom(p, roomId) {
  if (p.room === roomId) return;
  if (p.hand) lowerHand(p);
  if (p.room === 'study') clearStudyPhoto(p);
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
    if (old) kickPresence(old, '別の端末（またはタブ）で入室したため、こちらは切断しました');

    const p = {
      id: user.id, user, socket, tokenHash: user.sessionTokenHash,
      x: 0, y: 0, dir: 'down', moving: false, room: null, seat: null, hand: false, handAt: 0,
      connectedAt: Date.now(), ip: clientIp(socket), device: deviceLabel(socket.handshake.headers['user-agent']),
      lastMoveAt: 0, lastReactionAt: 0,
    };
    Object.assign(p, spawnPos(p));
    p.room = roomIdAt(p.x, p.y);
    // 授業中の先生が再接続したら、授業の自動終了を取り消す
    const myClass = p.room && classes.get(p.room);
    if (myClass && myClass.teacherId === p.id) { clearTimeout(myClass.graceTimer); myClass.graceTimer = null; }
    online.set(p.id, p);
    if (isStaff(p)) socket.join('staff');

    socket.emit('init', {
      me: pub(p), users: [...online.values()].filter(o => o !== p).map(pub), rooms: roomCounts(), reactions: REACTIONS,
      classes: classState(), classCall: livekit.enabled,
    });
    socket.broadcast.emit('user-joined', pub(p));
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
        classes.set(room.id, { teacherId: p.id, teacherName: p.user.display_name, startedAt: Date.now(), mic: false, screen: false, graceTimer: null });
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
      if (!t || t.room !== 'study' || !t.studyCam) return ack({ ok: false, error: 'カメラがオンの自習中の生徒だけ撮影できます' });
      if (Date.now() - (t.lastPhotoRequestAt || 0) < 30_000) return ack({ ok: false, error: '30秒ほど待ってからもう一度押してください' });
      t.lastPhotoRequestAt = Date.now(); // 連打防止（30秒に1回）
      t.photoRequestedAt = Date.now();   // 未使用の撮影リクエスト（1回使うと消える）
      t.socket.emit('take-photo');
      ack({ ok: true });
    });

    // ── 自習室の見守りカメラのオン/オフ（表示用。写真そのものは HTTP で送る） ──
    socket.on('study-camera', (d) => {
      const on = !!(d && d.on) && p.user.role === 'student' && p.room === 'study' && studyPhotosEnabled();
      if (on === !!p.studyCam) return;
      p.studyCam = on;
      io.emit('user-updated', { id: p.id, studyCam: on });
      if (!on) { if (studyPhotos.delete(p.id)) notifyStudyViewers({ id: p.id, at: null }); }
    });

    socket.on('disconnect', () => {
      if (online.get(p.id) !== p) return;
      clearStudyPhoto(p);
      if (p.callId) endCall(callOf(p), `${p.user.display_name}${isStaff(p) ? '先生' : 'さん'}の接続が切れたため、個別通話を終了しました`);
      if (p.room) leaveClassRoom(p, p.room, 'disconnected');
      lastPos.set(p.id, { x: p.x, y: p.y });
      online.delete(p.id);
      pendingMoves.delete(p.id);
      io.emit('user-left', { id: p.id });
      broadcastRooms();
    });
  });

  setInterval(flushMoves, 100).unref();

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

// 見守り写真を受け取る（生徒・自習室にいる・機能がオンのときだけ）。エラーならメッセージを返す
// meta: { brightness: 0〜255, fp: 64ビットの「写真の特徴」(16進), reason: 'auto'|'request' }
function storeStudyPhoto(userId, buf, meta = {}) {
  if (!studyPhotosEnabled()) return '見守り写真はオフになっています';
  const p = online.get(Number(userId));
  if (!p || p.user.role !== 'student') return '送信できません';
  if (p.room !== 'study') return '自習室に入ってから送信してください';
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
  if (reason === 'request') p.photoRequestedAt = 0;
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

function _reset() { online.clear(); lastPos.clear(); calls.clear(); studyPhotos.clear(); }

module.exports = {
  storeStudyPhoto, getStudyPhoto, studyPhotoTimes, canViewStudyPhotos, setStudyPhotosFeature, studyPhotosEnabled,
  attach, kick, refreshUser, refreshRooms, presence, roomCounts, classState, endClass, endCallOf, REACTIONS, _reset, _online: online };
