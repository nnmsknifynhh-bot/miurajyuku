// 2D空間（第2段階：複数人のリアルタイム同期・入室チェック・挙手・リアクション／第3段階：授業の通話・画面共有）
(function () {
  const SM = window.SchoolMap, { api, toast, ROLE_LABEL } = window.App;
  const T = SM.TILE, SPEED = 140;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const state = {
    user: null, rooms: [], counts: {}, reactions: [], me: null, others: new Map(),
    zoom: 1, cam: { x: 0, y: 0 }, keys: new Set(), path: [], pathSeat: null, joy: { x: 0, y: 0 },
    lastBlockToast: 0, lastSent: 0, lastSentKey: '', socket: null, ready: false, panelTab: 'hands',
    classes: {}, classCall: false, call: null, studyPhotos: false, sc: null, photoMeta: {},
  };
  const canvas = $('#world'), ctx = canvas.getContext('2d');
  let mapCanvas = null;
  const isStaff = () => state.user && state.user.role !== 'student';

  // ───────── 起動 ─────────
  (async function init() {
    try { await loadMe(); } catch (e) { location.replace('/'); return; }
    const u = state.user;
    $('#me-name').textContent = u.displayName;
    $('#me-dot').style.background = u.avatarColor;
    $('#me-role').textContent = ROLE_LABEL[u.role];
    $('#me-role').className = 'badge ' + u.role;
    document.body.classList.add(u.role === 'student' ? 'is-student' : 'is-staff');
    mapCanvas = window.Render.buildMap();
    state.zoom = autoZoom();
    if (matchMedia('(pointer: coarse)').matches) $('#joystick').hidden = false;
    resize();
    // 生徒は、入室の前に漢字の読みテスト（必要なときだけ）
    if (u.role === 'student') {
      try { if ((await api('GET', '/api/quiz/status')).required) await runQuiz(); } catch (e) { /* テストなしで入室 */ }
    }
    connect();
    requestAnimationFrame(loop);
  })();

  // ───────── 入室前の漢字テスト（4択） ─────────
  async function runQuiz() {
    let q;
    try { q = await api('POST', '/api/quiz/question'); } catch (e) { return; }
    const box = $('#quiz');
    $('#quiz-level').textContent = `漢検 ${q.level}`;
    $('#quiz-word').textContent = q.word;
    const choices = $('#quiz-choices'); choices.textContent = '';
    $('#quiz-result').hidden = true; $('#quiz-enter').hidden = true;
    box.hidden = false;
    return new Promise((resolve) => {
      q.choices.forEach((c, i) => {
        const b = el('button', null, c);
        b.onclick = async () => {
          choices.querySelectorAll('button').forEach(x => { x.disabled = true; });
          let r;
          try { r = await api('POST', '/api/quiz/answer', { choice: i }); } catch (e) { box.hidden = true; resolve(); return; }
          choices.children[r.answerIndex].classList.add('ok');
          if (!r.correct) b.classList.add('ng');
          const res = $('#quiz-result');
          res.textContent = r.correct ? '🎉 正解！' : `ざんねん！ 正しい読みは「${r.answer}」`;
          res.style.color = r.correct ? 'var(--success)' : 'var(--danger)';
          res.hidden = false;
          const enter = $('#quiz-enter'); enter.hidden = false; enter.focus();
          enter.onclick = () => { box.hidden = true; resolve(); };
        };
        choices.append(b);
      });
    });
  }

  async function loadMe() {
    const data = await api('GET', '/api/me');
    state.user = data.user; state.rooms = data.rooms;
    state.studyPhotos = !!(data.features && data.features.studyPhotos);
    $('#menu-admin').hidden = !(data.user.role === 'owner' || data.user.permissions.manage_classroom);
  }

  // ───────── サーバーとの接続 ─────────
  function connect() {
    const socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    state.socket = socket;
    state.call = window.ClassCall.create({ socket, getState: () => state, toast });
    state.pc = window.PrivateCall.create({ socket, getState: () => state, toast });
    state.sc = window.StudyCam.create({ socket, getState: () => state, toast });
    state.gb = window.GanbariUI.create({ api, toast, getState: () => state });
    state.gb.refreshForest();
    let lastForest = 0;
    socket.on('study-minute', () => { if (Date.now() - lastForest > 120000) { lastForest = Date.now(); state.gb.refreshForest(); } });
    socket.on('features', (f) => { state.studyPhotos = !!f.studyPhotos; updateAll(); });
    socket.on('student-arrived', ({ name, time, birthday }) => {
      toast(birthday ? `🎂 ${name}さんが入室しました（${time}）。今日は誕生日です。声をかけてあげてね` : `🔔 ${name}さんが入室しました（${time}）`, birthday ? 9000 : 6000);
      chime();
    });
    // 高校生が決めた曜日に来ていないとき（先生・オーナーへ）
    socket.on('student-late', ({ name, weekday, time }) => { toast(`⏰ ${name}さんがまだ来ていません（${weekday}曜 ${time}〜の予定）`, 9000); chime(); });
    socket.on('study-minute', () => { if (state.user && state.user.role === 'student') refreshWeek(); });
    // 誕生日のお祝いカード（その日にはじめて入ったとき）
    socket.on('birthday', ({ name, message, gift }) => {
      $('#bday-title').textContent = `${name}さん、お誕生日おめでとう！`;
      $('#bday-msg').textContent = message || '';
      $('#bday-gift').hidden = !gift;
      const d = $('#bday-dialog');
      if (d.open) return;
      const show = () => { if (document.querySelector('dialog[open]')) return setTimeout(show, 1500); d.showModal(); };
      setTimeout(show, 800);
    });
    socket.on('topic-cleared', ({ by, reason }) => { state.me.topic = null; updateButtons(); toast(by ? `${by}が吹き出しを消しました` : reason === 'class' ? '先生がスタンプ・吹き出しを止めたので、吹き出しを消しました' : '先生がはなれたので、吹き出しを消しました'); });
    socket.on('study-photo', ({ id, at }) => { refreshPhotoMeta(); void id; void at; });
    socket.on('study-photo-result', ({ id, name, ok, reason }) => {
      clearTimeout(photoWait[id]);
      toast(ok ? `📸 ${name}さんの写真が届きました` : `${name}さんの写真を撮れませんでした（${reason || '理由不明'}）`, 5000);
      refreshPhotoMeta();
    });
    socket.on('connect', () => reportAway());
    $('#conn').hidden = false;

    socket.on('connect', () => { $('#conn').hidden = true; });
    // 自習中に通信が切れて、すぐもどってきたとき
    socket.on('study-resumed', (d) => {
      const m = (d && d.minutes) || 0;
      toast((d && d.seat ? '🔌 つながり直して、元の席にもどりました。' : '🔌 つながり直しました。') + (m ? `切れていた${m}分も自習時間に入れたよ。` : '') + 'このまま続けよう！', 5000);
    });
    // アプリにもどったら、すぐつなぎ直す（待たずに）
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !socket.connected) socket.connect(); });
    window.addEventListener('online', () => { if (!socket.connected) socket.connect(); });
    socket.on('disconnect', (reason) => {
      state.ready = false;
      if (reason !== 'io server disconnect') { $('#conn').textContent = '接続が切れました。つなぎなおしています…'; $('#conn').hidden = false; }
    });
    // テストに答えていない（サーバーが入室を止めた）とき
    socket.on('quiz-required', async () => {
      await runQuiz();
      socket.connect();
    });
    socket.on('connect_error', (err) => {
      if (err && err.message === 'unauthorized') { location.replace('/'); return; }
      $('#conn').textContent = 'サーバーにつながりません。通信を確認してください'; $('#conn').hidden = false;
    });

    socket.on('init', (d) => {
      state.me = { ...d.me, rx: d.me.x, ry: d.me.y };
      state.cam = { x: d.me.x, y: d.me.y };
      state.others = new Map(d.users.map(u => [u.id, { ...u, rx: u.x, ry: u.y }]));
      state.counts = d.rooms; state.reactions = d.reactions;
      state.classes = d.classes || {}; state.classCall = !!d.classCall;
      state.path = []; state.pathSeat = null; state.ready = true;
      buildReactions(); updateAll(); refreshWeek(true);
    });
    socket.on('class-state', (c) => { state.classes = c; state.call.sync(); });
    socket.on('class-ended', ({ room, reason }) => {
      if (state.me && state.me.room === room) toast(reason || '授業が終わりました', 4500);
    });
    socket.on('rooms', (c) => { state.counts = c; updatePlace(true); renderPanel(); });
    socket.on('user-joined', (u) => { state.others.set(u.id, { ...u, rx: u.x, ry: u.y }); renderPanel(); });
    socket.on('user-left', ({ id }) => { state.others.delete(id); renderPanel(); hideUserPop(); });
    // 位置の更新（0.1秒ごとにまとめて届く）: [id, x, y, 向き, 歩いているか]
    const DIRS = { u: 'up', d: 'down', l: 'left', r: 'right' };
    socket.on('moves', (list) => {
      for (const [id, x, y, dir, moving] of list) {
        const u = state.others.get(id);
        if (u) { u.x = x; u.y = y; u.dir = DIRS[dir] || u.dir; u.moving = !!moving; }
      }
    });
    socket.on('user-updated', (d) => {
      const u = d.id === state.me.id ? state.me : state.others.get(d.id);
      if (!u) return;
      Object.assign(u, d);
      if (u === state.me) updateAll(); else renderPanel();
    });
    socket.on('reaction', ({ id, kind }) => {
      const u = id === state.me.id ? state.me : state.others.get(id);
      if (u) u.reaction = { kind, until: performance.now() + 2500 };
    });
    socket.on('move-rejected', ({ x, y, reason }) => {
      Object.assign(state.me, { x, y, moving: false });
      state.path = []; state.pathSeat = null;
      if (reason) blockToast(reason);
    });
    socket.on('force-move', ({ x, y, reason }) => {
      Object.assign(state.me, { x, y, seat: null });
      state.path = []; state.pathSeat = null;
      toast(reason, 5000); updateAll();
    });
    socket.on('hand-raised', ({ name, roomName }) => {
      toast(`✋ ${name}さんが手をあげました（${roomName}）`, 4500);
      chime(); renderPanel();
    });
    socket.on('hand-lowered', ({ by }) => { toast(`${by}先生が気づいてくれました`); updateAll(); });
    socket.on('me-updated', async () => { try { await loadMe(); updateAll(); } catch (e) {} });
    socket.on('kicked', ({ reason }) => {
      state.ready = false;
      state.call.leave(); state.pc.leave(); state.sc.stop();
      alert(reason || '接続が切断されました');
      location.replace('/');
    });
  }

  function sendMove(force) {
    if (!state.ready) return;
    const me = state.me, t = performance.now();
    const key = Math.round(me.x) + ',' + Math.round(me.y) + ',' + me.dir + ',' + me.moving;
    if (key === state.lastSentKey || (!force && t - state.lastSent < 80)) return;
    state.lastSent = t; state.lastSentKey = key;
    state.socket.emit('move', { x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, dir: me.dir, moving: me.moving });
  }

  // ───────── 入室判定（画面側。最終判定はサーバー） ─────────
  const roomInfo = (id) => state.rooms.find(r => r.id === id);
  function zoneBlockReason(z) {
    if (!z || (z.type !== 'classroom' && z.type !== 'study')) return null;
    if (state.me && state.me.room === z.id) return null;
    const r = roomInfo(z.id);
    if (z.type === 'classroom' && !(r && r.canEnter)) {
      return state.user.role === 'teacher' ? `${z.name}には入れません（担当の教室ではありません）` : `${z.name}には入れません`;
    }
    const c = state.counts[z.id];
    if (state.user.role === 'student' && c && c.students >= c.capacity) return `${z.name}は満員です（定員${c.capacity}人）`;
    return null;
  }
  const tileAllowed = (tx, ty) => !zoneBlockReason(SM.zoneAt(tx, ty));

  function canStand(x, y) {
    const r = 9;
    return [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]].every(([px, py]) => {
      const tx = Math.floor(px / T), ty = Math.floor(py / T);
      return SM.isWalkable(tx, ty) && tileAllowed(tx, ty);
    });
  }
  function blockToast(text) {
    if (performance.now() - state.lastBlockToast < 2500) return;
    state.lastBlockToast = performance.now();
    toast(text);
  }

  // ───────── 座席 ─────────
  function occupiedSeats() {
    const s = new Set();
    for (const u of state.others.values()) if (u.seat) s.add(u.seat);
    return s;
  }

  function walkTo(tx, ty, seat, autoRoom) {
    const me = state.me;
    const reason = zoneBlockReason(SM.zoneAt(tx, ty));
    if (reason) { blockToast(reason); return false; }
    if (leavingWhileTeaching(SM.tileCenter(tx, ty).x, SM.tileCenter(tx, ty).y)) return false;
    if (seat && occupiedSeats().has(SM.seatId(tx, ty))) { toast('その席はほかの人が使っています'); return false; }
    const p = SM.findPath(Math.floor(me.x / T), Math.floor(me.y / T), tx, ty, tileAllowed);
    if (!p) return false;
    standUp();
    state.path = p; state.pathSeat = seat ? { x: tx, y: ty, autoRoom } : null;
    if (!p.length && seat) { state.pathSeat = null; sit(tx, ty, autoRoom); } // すでに席の上にいる
    return true;
  }

  function sit(tx, ty, autoRoom, tries = 0) {
    sendMove(true);
    state.socket.emit('sit', SM.seatId(tx, ty), (res) => {
      if (!res || !res.ok) {
        // 部屋えらびで向かった席が先にうまっていたら、となりの空席へ
        const r = autoRoom && roomInfo(autoRoom);
        if (r && tries < 3) { goToRoom(r, tries + 1); return; }
        toast((res && res.error) || '座れませんでした'); return;
      }
      Object.assign(state.me, { x: res.x, y: res.y, dir: res.dir, seat: SM.seatId(tx, ty), moving: false });
      state.lastSentKey = Math.round(res.x) + ',' + Math.round(res.y) + ',' + res.dir + ',false';
      updateAll();
    });
  }
  function standUp() {
    if (!state.me.seat) return;
    state.me.seat = null;
    state.socket.emit('stand');
    updateAll();
  }
  function toggleSit() {
    const me = state.me;
    if (!me) return;
    if (me.seat) return standUp();
    const occ = occupiedSeats();
    const cx = Math.floor(me.x / T), cy = Math.floor(me.y / T);
    let best = null, bd = Infinity;
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (!SM.isSeat(x, y) || occ.has(SM.seatId(x, y))) continue;
      const c = SM.tileCenter(x, y), d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d < bd && d < T * 1.4) { bd = d; best = { x, y }; }
    }
    if (!best) return toast('近くに空いているいすがありません。いすをタップすると座れます');
    state.path = [];
    const c = SM.tileCenter(best.x, best.y);
    me.x = c.x; me.y = c.y;
    sit(best.x, best.y);
  }

  // ───────── 自習室：立ち歩きが10秒をこえたら、席えらびを出す ─────────
  const STAND_LIMIT_MS = 10_000;
  let standingSince = 0;
  function studySeats() {
    const z = SM.ZONES.find(v => v.id === ((state.me && SM.isStudyRoom(state.me.room)) ? state.me.room : 'study')), seats = [];
    for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) if (SM.tileAt(x, y) === 'c') seats.push({ x, y });
    return seats;
  }
  function openSeatPicker() {
    const map = $('#seat-map'); map.textContent = '';
    const occ = occupiedSeats(), seats = studySeats();
    const roomId = SM.isStudyRoom(state.me.room) ? state.me.room : 'study';
    const groups = (SM.SEAT_GROUPS[roomId] || [{ label: '席' }]).map(gp => [gp.label, seats.filter(s =>
      (gp.x1 == null || (s.x >= gp.x1 && s.x <= gp.x2)) && (gp.y1 == null || (s.y >= gp.y1 && s.y <= gp.y2)))]);
    for (const [label, side] of groups) {
      if (!side.length) continue;
      const xs = [...new Set(side.map(s => s.x))].sort((a, b) => a - b), ys = [...new Set(side.map(s => s.y))].sort((a, b) => a - b);
      const box = document.createElement('div'); box.className = 'seat-side';
      const title = document.createElement('b'); title.textContent = label;
      const grid = document.createElement('div'); grid.className = 'seat-grid';
      grid.style.gridTemplateColumns = `repeat(${xs.length}, minmax(0, 44px))`;
      for (const st of side) {
        const b = document.createElement('button'); b.type = 'button';
        const taken = occ.has(SM.seatId(st.x, st.y));
        b.textContent = taken ? '👤' : '🪑'; b.disabled = taken;
        b.title = taken ? 'ほかの人が使っています' : 'この席にすわる';
        b.style.gridColumn = xs.indexOf(st.x) + 1; b.style.gridRow = ys.indexOf(st.y) + 1;
        b.onclick = () => { $('#seat-dialog').close(); walkTo(st.x, st.y, true); };
        grid.append(b);
      }
      box.append(title, grid); map.append(box);
    }
    if (!$('#seat-dialog').open) $('#seat-dialog').showModal();
  }
  // ───────── 高校生：週のノルマ・今日やること ─────────
  let weekBusy = false, lastWeekAt = 0;
  async function refreshWeek(force) {
    const me = state.me;
    if (!me || !state.user || state.user.role !== 'student' || !me.hs) { $('#week-chip').hidden = true; return; }
    if (weekBusy || (!force && Date.now() - lastWeekAt < 50_000)) return;
    weekBusy = true; lastWeekAt = Date.now();
    try {
      const g = await api('GET', '/api/me/ganbari');
      if (!g.hs) { $('#week-chip').hidden = true; return; }
      const w = g.hs.week, t = g.hs.today;
      const hmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
      const marks = Array.from({ length: w.need }, (_, i) => i < w.sessions ? '●' : '○').join('');
      $('#week-chip').textContent = '';
      $('#week-chip').append(document.createTextNode(`📅 今週 ${marks} ${w.sessions}/${w.need}回` + (w.achieved ? ' 達成！🎉' : '')));
      const sm = document.createElement('small');
      sm.textContent = t.done ? `今日 ${hmm(t.minutes)} ✓ 1回クリア` : `今日 ${hmm(t.minutes)} / ${hmm(t.sessionMinutes)}（あと${t.sessionMinutes - t.minutes}分）`;
      $('#week-chip').append(sm);
      $('#week-chip').hidden = false;
      state.hsInfo = g.hs;
    } catch (e) { /* 次の機会に */ } finally { weekBusy = false; }
  }
  setInterval(() => refreshWeek(), 60_000);
  // 高校生自習室に入ったら「今日やること」を書く（今日まだ書いていなければ）
  function checkPlan() {
    const me = state.me;
    if (!me || !me.hs || state.user.role !== 'student' || me.room !== 'class3' || me.plan) return;
    if ($('#plan-dialog').open || document.querySelector('dialog[open]')) return;
    $('#plan-error').hidden = true;
    $('#plan-dialog').showModal();
    setTimeout(() => $('#plan-1').focus(), 50);
  }
  setInterval(checkPlan, 1500);
  $('#plan-dialog').addEventListener('cancel', (e) => e.preventDefault()); // 書くまで閉じない
  $('#plan-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const items = [1, 2, 3].map(i => $('#plan-' + i).value);
    state.socket.emit('study-plan', { items }, (r) => {
      if (!r || !r.ok) { $('#plan-error').textContent = (r && r.error) || '保存できませんでした'; $('#plan-error').hidden = false; return; }
      state.me.plan = r.plan; $('#plan-dialog').close(); toast('☕ 今日やることを書きました。がんばろう！'); refreshWeek(true);
    });
  });
  // 自習室から出たら、書きかけの画面は閉じる
  setInterval(() => { if ($('#plan-dialog').open && state.me && state.me.room !== 'class3') $('#plan-dialog').close(); }, 1000);

  $('#bday-close').onclick = () => { $('#bday-dialog').close(); if (state.gb && state.gb.refreshForest) state.gb.refreshForest(); };
  $('#seat-close').onclick = () => { $('#seat-dialog').close(); standingSince = Date.now(); };
  $('#seat-near').onclick = () => {
    $('#seat-dialog').close();
    const me = state.me, occ = occupiedSeats();
    const free = studySeats().filter(s => !occ.has(SM.seatId(s.x, s.y)))
      .sort((a, b) => Math.hypot(SM.tileCenter(a.x, a.y).x - me.x, SM.tileCenter(a.x, a.y).y - me.y) - Math.hypot(SM.tileCenter(b.x, b.y).x - me.x, SM.tileCenter(b.x, b.y).y - me.y));
    if (!free.length) return toast('空いている席がありません');
    walkTo(free[0].x, free[0].y, true);
  };
  setInterval(() => {
    const me = state.me;
    const watching = state.ready && me && state.user && state.user.role === 'student' && SM.isStudyRoom(me.room) && !me.seat
      && !state.pathSeat && document.visibilityState === 'visible' && !document.querySelector('dialog[open]');
    if (!watching) { standingSince = 0; return; } // すわった・歩いて席へ向かっている・ほかの画面を開いている・アプリを見ていないときは数えない
    if (!standingSince) { standingSince = Date.now(); return; }
    if (Date.now() - standingSince > STAND_LIMIT_MS) { standingSince = 0; openSeatPicker(); }
  }, 1000);

  // ───────── 移動 ─────────
  function update(dt) {
    const me = state.me;
    if (!me || !state.ready) return;
    let dx = state.joy.x, dy = state.joy.y;
    if (state.keys.has('left')) dx -= 1;
    if (state.keys.has('right')) dx += 1;
    if (state.keys.has('up')) dy -= 1;
    if (state.keys.has('down')) dy += 1;
    const len = Math.hypot(dx, dy);
    me.moving = false;
    if (len > 0.15) {
      state.path = []; state.pathSeat = null;
      standUp();
      const sp = SPEED * Math.min(1, len) * dt;
      const nx = me.x + dx / len * sp, ny = me.y + dy / len * sp;
      if (canStand(nx, me.y) && !leavingWhileTeaching(nx, me.y)) me.x = nx; else checkBlocked(nx + Math.sign(dx) * 9, me.y);
      if (canStand(me.x, ny) && !leavingWhileTeaching(me.x, ny)) me.y = ny; else checkBlocked(me.x, ny + Math.sign(dy) * 9);
      me.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      me.moving = true;
    } else if (state.path.length) {
      const next = SM.tileCenter(state.path[0].x, state.path[0].y);
      const ex = next.x - me.x, ey = next.y - me.y, d = Math.hypot(ex, ey), step = SPEED * 1.2 * dt;
      if (d) me.dir = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? 'right' : 'left') : (ey > 0 ? 'down' : 'up');
      if (d <= step) { me.x = next.x; me.y = next.y; state.path.shift(); } else { me.x += ex / d * step; me.y += ey / d * step; }
      me.moving = state.path.length > 0;
      if (!state.path.length && state.pathSeat) { const s = state.pathSeat; state.pathSeat = null; sit(s.x, s.y, s.autoRoom, s.tries); }
    }
    sendMove(false);
    updatePlace(false);
  }
  function checkBlocked(x, y) {
    const r = zoneBlockReason(SM.zoneAtPx(x, y));
    if (r) blockToast(r);
  }

  // ───────── 表示の更新 ─────────
  function updateAll() { updatePlace(true); updateButtons(); renderPanel(); if (state.call) state.call.sync(); if (state.sc) state.sc.sync(); }

  // ── 自習室：勉強内容の吹き出し ──
  // 生徒：教科を選んで続けて書く／先生・オーナー：よく使う文をそのまま使う
  const SUBJECTS = ['国語', '数学', '算数', '英語', '理科', '社会', '宿題', 'テスト勉強'];
  const STAFF_PRESETS = ['質問受付中', '授業準備中', '面談中', '休憩中', 'すぐ戻ります'];
  // 生徒が1時間に2回以上、吹き出しやスタンプを開いたら忠告する（この端末の記録で数える）
  const CHAT_LIMIT = 2, CHAT_WINDOW = 60 * 60 * 1000;
  function chatWarning() {
    if (!state.user || state.user.role !== 'student') return null;
    const key = 'juku-chat-opens-' + state.user.id, now = Date.now();
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]').filter(t => typeof t === 'number' && now - t < CHAT_WINDOW); } catch (e) { list = []; }
    list.push(now);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* 保存できない環境 */ }
    if (list.length < CHAT_LIMIT) return null;
    return `⚠️ この1時間で${list.length}回目だよ。吹き出しやスタンプはほどほどにして、勉強に集中しよう！`;
  }
  // 生徒が先生・オーナーと話している（近くにいる・個別通話中）か。サーバーでも同じようにたしかめる
  function talkingWithStaff() {
    const me = state.me;
    if (state.pc && state.pc.active()) return true;
    const zoneId = (x, y) => (SM.zoneAtPx(x, y) || {}).id || null; // 部屋は位置から求める（ほかの人の room は移動中に古いことがある）
    const myZone = zoneId(me.x, me.y);
    for (const u of state.others.values()) {
      if (u.role !== 'student' && Math.hypot(u.x - me.x, u.y - me.y) <= T * 3.5 && zoneId(u.x, u.y) === myZone) return true;
    }
    return false;
  }
  function openTopic() {
    if (state.user.role === 'student' && !state.me.topic && $('#btn-topic').hidden) {
      return toast('💬 吹き出しは、先生と話すときだけ使えます。先生に近くに来てもらってね', 5000);
    }
    const warn = chatWarning();
    $('#topic-warn').textContent = warn || ''; $('#topic-warn').hidden = !warn;
    const chips = $('#topic-chips'); chips.textContent = '';
    const student = state.user.role === 'student';
    $('#topic-title').textContent = student && SM.isStudyRoom(state.me.room) ? '✏️ なにを勉強する？' : '💬 吹き出しに書く';
    let saved = '';
    try { saved = localStorage.getItem('juku-topic-' + state.user.id) || ''; } catch (e) {}
    $('#topic-input').value = state.me.topic || saved;
    $('#topic-input').placeholder = student ? '例：数学　連立方程式' : '例：質問受付中です';
    for (const s of (student ? SUBJECTS : STAFF_PRESETS)) {
      const b = el('button', null, s); b.type = 'button';
      b.onclick = () => {
        if (student) {
          const cur = $('#topic-input').value.replace(new RegExp('^(' + SUBJECTS.join('|') + ')[：:　 ]*'), '');
          $('#topic-input').value = (s + '　' + cur).slice(0, 24).trimEnd() + (cur ? '' : '　');
        } else {
          $('#topic-input').value = s;
        }
        $('#topic-input').focus();
        chips.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      };
      chips.append(b);
    }
    $('#topic-clear').hidden = !state.me.topic;
    $('#topic-dialog').showModal();
  }
  function sendTopic(text) {
    state.socket.emit('study-topic', { text }, (r) => {
      if (!r || !r.ok) return toast((r && r.error) || 'できませんでした');
      state.me.topic = r.topic; updateButtons();
      try { if (r.topic) localStorage.setItem('juku-topic-' + state.user.id, r.topic); } catch (e) {}
      $('#topic-dialog').close();
    });
  }
  $('#btn-topic').onclick = openTopic;
  $('#topic-cancel').onclick = () => $('#topic-dialog').close();
  $('#topic-clear').onclick = () => sendTopic('');
  $('#topic-form').addEventListener('submit', (e) => { e.preventDefault(); sendTopic($('#topic-input').value.trim()); });

  // 離席の検知：アプリを閉じた・別のアプリに切り替えた（hidden）、別の画面を操作中（blur）
  function reportAway() {
    if (!state.socket) return;
    const away = document.visibilityState === 'hidden' ? 'hidden' : (document.hasFocus() ? null : 'blur');
    state.socket.emit('away', { away });
    if (!away && state.sc) state.sc.sync();
  }
  document.addEventListener('visibilitychange', reportAway);
  window.addEventListener('blur', () => setTimeout(reportAway, 300));
  window.addEventListener('focus', reportAway);
  window.addEventListener('pagehide', reportAway);

  // 授業中の先生は教室から出られない（出ると授業が終わってしまうため）
  function leavingWhileTeaching(x, y) {
    if (!state.call || !state.call.isTeachingHere()) return false;
    const z = SM.zoneAtPx(x, y);
    if (z && z.id === state.me.room) return false;
    blockToast('授業中は教室から出られません。先に「授業を終わる」を押してください');
    return true;
  }

  let lastPlaceKey = '';
  function updatePlace(force) {
    if (!state.me) return;
    const z = SM.zoneAtPx(state.me.x, state.me.y);
    const c = z && state.counts[z.id];
    const key = (z ? z.id : '') + (c ? c.students + '/' + c.capacity : '');
    if (!force && key === lastPlaceKey) return;
    lastPlaceKey = key;
    $('#place-name').textContent = z ? z.name : '出入口';
    $('#place-cap').textContent = c ? `生徒 ${c.students}/${c.capacity}人` : '';
  }

  // 生徒の「吹き出し」「スタンプ」は、先生・オーナーに話しかけられたとき（近くに来た・個別通話中）だけ出す。
  // スタンプは授業中の教室でも使える（サーバーでも同じようにたしかめる）
  function updateTalkButtons() {
    if (!state.user || state.user.role !== 'student' || !state.me) return;
    // 授業中の教室では、先生が「スタンプ・吹き出しOK」にしたときだけ
    const cls = state.me.room && state.classes && state.classes[state.me.room];
    const inCall = !!(state.pc && state.pc.active());
    const talk = inCall || (cls ? !!cls.allowChat : talkingWithStaff());
    const topicOn = talk || !!state.me.topic;
    const reactOn = talk;
    if ($('#btn-topic').hidden === topicOn) $('#btn-topic').hidden = !topicOn;
    if ($('#btn-react').hidden === reactOn) { $('#btn-react').hidden = !reactOn; if (!reactOn) $('#react-pop').hidden = true; }
    if (talk && !state.talkHinted) { state.talkHinted = true; toast(cls && !inCall ? '😊 先生がスタンプ・吹き出しをOKにしました' : '👋 先生が話しかけています。吹き出しやスタンプで返事ができます', 4000); }
    if (!talk) state.talkHinted = false;
  }
  setInterval(updateTalkButtons, 700);
  function updateButtons() {
    const me = state.me;
    updateTalkButtons();
    $('#sit-label').textContent = me && me.seat ? 'たつ' : 'すわる';
    $('#btn-sit').classList.toggle('on', !!(me && me.seat));
    $('#hand-label').textContent = me && me.hand ? '手をおろす' : '手をあげる';
    // 自習室では「手をあげる」の代わりに「勉強内容」ボタン
    // 自習室では挙手を使わないので「手をあげる」を隠す（吹き出しボタンはどこでも表示）
    const inStudy = !!(me && SM.isStudyRoom(me.room));
    $('#btn-hand').hidden = inStudy;
    $('#btn-topic').classList.toggle('on', !!(me && me.topic));
    $('#btn-hand').classList.toggle('hand-on', !!(me && me.hand));
  }

  // ───────── 挙手・リアクション（生徒） ─────────
  $('#btn-hand').onclick = () => {
    if (!state.ready) return;
    const raised = !state.me.hand;
    state.socket.emit('hand', { raised }, (res) => {
      if (!res || !res.ok) return toast((res && res.error) || 'できませんでした');
      state.me.hand = raised; updateButtons();
      if (raised) toast('手をあげました。先生が気づくまで待ってね');
    });
  };
  function buildReactions() {
    const pop = $('#react-pop'); pop.textContent = '';
    for (const k of state.reactions) {
      const b = el('button', null, k);
      b.onclick = () => { state.socket.emit('reaction', k); pop.hidden = true; };
      pop.append(b);
    }
  }
  $('#btn-react').onclick = () => {
    const opening = $('#react-pop').hidden;
    $('#react-pop').hidden = !opening;
    if (opening) { const warn = chatWarning(); if (warn) toast(warn, 6000); }
  };

  // ───────── 先生用パネル（挙手一覧・入室者一覧） ─────────
  function openPanel(tab) {
    state.panelTab = tab;
    $('#panel').hidden = false;
    document.querySelectorAll('.panel-tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#panel-hands').hidden = tab !== 'hands'; $('#panel-people').hidden = tab !== 'people'; $('#panel-study').hidden = tab !== 'study';
    if (tab === 'study') refreshPhotoMeta();
    renderPanel();
  }
  $('#btn-hands').onclick = () => ($('#panel').hidden || state.panelTab !== 'hands') ? openPanel('hands') : ($('#panel').hidden = true);
  $('#btn-people').onclick = () => ($('#panel').hidden || state.panelTab !== 'people') ? openPanel('people') : ($('#panel').hidden = true);
  $('#panel-close').onclick = () => { $('#panel').hidden = true; };
  document.querySelectorAll('.panel-tabs [data-tab]').forEach(b => b.onclick = () => openPanel(b.dataset.tab));

  // 自分が対応できる教室（担当教室。オーナーは全教室）
  const handleable = (roomId) => {
    const u = state.user;
    if (!u || u.role === 'student' || !u.permissions.handle_students) return false;
    const r = roomInfo(roomId);
    return !!(r && r.type === 'classroom' && r.canEnter);
  };
  const handList = () => [...state.others.values()].filter(u => u.hand && handleable(u.room)).sort((a, b) => a.handAt - b.handAt);

  // ── 自習室の見守り写真（先生・オーナー） ──
  const canViewStudy = () => !!(state.user && (state.user.role === 'owner' || (state.user.role === 'teacher' && state.user.permissions.handle_students)));
  async function refreshPhotoMeta() {
    if (!canViewStudy() || !state.studyPhotos) return;
    try { state.photoMeta = (await api('GET', '/api/study/photos')).times || {}; } catch (e) { /* 次の機会に */ }
    renderPanel();
  }
  setInterval(() => { if (!$('#panel').hidden && state.panelTab === 'study') refreshPhotoMeta(); }, 30000);
  const ago = (t) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'いま' : `${m}分前`; };
  function renderStudyPanel() {
    const box = $('#panel-study'); box.textContent = '';
    if (!state.studyPhotos) { box.append(el('p', 'panel-empty', '見守り写真はオフです（オーナーが管理画面の「教室の設定」でオンにできます）')); return; }
    const students = [...state.others.values()].filter(u => SM.isStudyRoom(u.room) && u.role === 'student').sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    if (!students.length) { box.append(el('p', 'panel-empty', 'いま自習室にいる生徒はいません')); return; }
    for (const u of students) {
      const meta = state.photoMeta[u.id];
      const card = el('div', 'study-card');
      let thumb;
      if (meta) {
        thumb = el('img'); thumb.src = `/api/study/photo/${u.id}?t=${meta.at}`; thumb.alt = u.name + 'さんの写真';
        thumb.onclick = () => { $('#sc-photo-title').textContent = `${u.name}さん（${ago(meta.at)}）`; $('#sc-photo-big').src = thumb.src; $('#sc-photo-dialog').showModal(); };
      } else thumb = el('div', 'noimg', u.studyCam ? '撮影待ち' : '写真なし');
      const info = el('div');
      info.append(el('b', null, u.name));
      if (u.topic) info.append(el('div', 'topic', '💬 ' + u.topic));
      const st = el('div', 'st');
      const warn = [];
      if (u.away === 'hidden') warn.push('💤 アプリを閉じています');
      else if (u.away === 'blur') warn.push('💤 別の画面を操作中');
      if (!u.studyCam) warn.push('📷 カメラオフ');
      if (meta && meta.dark) warn.push('⚫ 真っ暗（カメラが隠れている？）');
      if (meta && meta.still >= 3) warn.push('🗿 30分以上ほとんど動きなし');
      if (meta && u.studyCam && Date.now() - meta.at > 16 * 60e3) warn.push('⏱ 写真が届いていません');
      if (warn.length) { warn.forEach(w => st.append(el('span', 'bad', w + '　'))); card.classList.add('warn'); }
      st.append(document.createTextNode(meta ? `📷 ${ago(meta.at)}${meta.reason === 'request' ? '（今すぐ撮影）' : ''}` : ''));
      info.append(st);
      if (u.studyCam) {
        const b = el('button', 'btn small secondary', '📸 今すぐ撮る');
        b.onclick = () => state.socket.emit('study-photo-request', { studentId: u.id }, (r) => {
          if (!r || !r.ok) return toast((r && r.error) || 'できませんでした');
          toast(`${u.name}さんの写真を撮っています…`);
          // 20秒たっても届かなければ知らせる
          clearTimeout(photoWait[u.id]);
          photoWait[u.id] = setTimeout(() => toast(`${u.name}さんの写真が届きませんでした。生徒のアプリが閉じているか、スマホの画面が消えている可能性があります`, 6000), 20000);
        });
        info.append(b);
      }
      card.append(thumb, info);
      box.append(card);
    }
    box.append(el('p', 'panel-note', '写真は7〜13分おきのランダムな時間に届きます（生徒には撮影の時間は分かりません）。写真は最新の1枚だけで、生徒が自習室を出ると消えます。'));
  }
  $('#sc-photo-close').onclick = () => $('#sc-photo-dialog').close();
  const photoWait = {};

  function renderPanel() {
    if (!isStaff() || !state.me) return;
    $('#tab-study-btn').hidden = !canViewStudy();
    if (state.panelTab === 'study' && !$('#panel').hidden) renderStudyPanel();
    const hands = handList();
    $('#hands-count').hidden = hands.length === 0;
    $('#hands-count').textContent = hands.length;
    if ($('#panel').hidden) return;

    const hb = $('#panel-hands'); hb.textContent = '';
    if (!hands.length) hb.append(el('p', 'panel-empty', '手をあげている生徒はいません'));
    for (const u of hands) {
      const item = el('div', 'hand-item');
      const info = el('div'); info.append(el('b', null, '✋ ' + u.name));
      const mins = Math.max(0, Math.floor((Date.now() - u.handAt) / 60000));
      info.append(el('small', null, `${(roomInfo(u.room) || {}).name || ''}・${mins ? mins + '分前' : 'いま'}`));
      const acts = el('div', 'acts');
      const go = el('button', 'btn small secondary', '近くへ'); go.onclick = () => walkNear(u);
      const done = el('button', 'btn small secondary', '対応済み'); done.onclick = () => lowerHand(u);
      acts.append(go, done);
      if (canPrivate()) { const call = el('button', 'btn small', '🎧 個別通話'); call.onclick = () => state.pc.invite(u); acts.append(call); }
      item.append(info, acts);
      hb.append(item);
    }
    hb.append(el('p', 'panel-note', canPrivate() ? '「個別通話」を押すと、生徒に参加確認が届きます。生徒が参加すると、ふたりだけで話せます（授業の音声は自動で止まり、終わると戻ります）。' : '個別通話の権限がないため、個別通話は使えません'));

    const pb = $('#panel-people'); pb.textContent = '';
    const everyone = [state.me, ...state.others.values()];
    const groups = [...state.rooms.map(r => ({ id: r.id, name: r.name })), { id: null, name: 'ろうか・ロビー' }];
    for (const g of groups) {
      const members = everyone.filter(u => (u.room || null) === g.id)
        .sort((a, b) => (a.role === 'student') - (b.role === 'student') || a.name.localeCompare(b.name, 'ja'));
      const box = el('div', 'room-group');
      const h = el('h4', null, g.name);
      const c = g.id && state.counts[g.id];
      if (c) { const s = el('small', c.students >= c.capacity ? 'full' : '', `生徒 ${c.students}/${c.capacity}人${c.staff ? `・先生 ${c.staff}人` : ''}`); h.append(s); }
      else h.append(el('small', null, `${members.length}人`));
      box.append(h);
      const ul = el('ul');
      for (const u of members) {
        const li = el('li');
        const dot = el('span', 'dot'); dot.style.background = u.color;
        li.append(dot, el('span', null, (u.role !== 'student' ? ROLE_LABEL[u.role] + ' ' : '') + u.name + (u === state.me ? '（自分）' : '')));
        li.append(el('span', 'tag', (u.away ? '💤 ' : '') + (u.inPrivate ? '🎧 ' : '') + (u.hand ? '✋ ' : '') + (u.seat ? '着席' : '')));
        if (u !== state.me && u.role === 'student' && canPrivate() && handleableRoom(u.room) && !u.inPrivate) {
          const b = el('button', 'btn small', '🎧'); b.title = '個別通話'; b.onclick = () => state.pc.invite(u); li.append(b);
        }
        ul.append(li);
      }
      if (members.length) box.append(ul);
      pb.append(box);
    }
  }
  setInterval(() => { if (!$('#panel').hidden) renderPanel(); }, 15000);

  // 個別通話を始められるか（サーバーでも同じ判定をしている）
  const canPrivate = () => !!(state.user && state.user.role !== 'student' && state.user.permissions.start_private_call && state.classCall);
  const handleableRoom = (roomId) => { const r = roomId && roomInfo(roomId); return !!(r && r.canEnter); };

  function lowerHand(u) {
    state.socket.emit('lower-hand', u.id, (res) => {
      if (!res || !res.ok) toast((res && res.error) || 'できませんでした');
      hideUserPop();
    });
  }
  function walkNear(u) {
    hideUserPop();
    const ux = Math.floor(u.x / T), uy = Math.floor(u.y / T);
    const taken = new Set([...state.others.values()].map(o => SM.seatId(Math.floor(o.x / T), Math.floor(o.y / T))));
    const me = state.me;
    for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = ux + dx, y = uy + dy;
      if (!SM.isWalkable(x, y) || SM.isSeat(x, y) || taken.has(SM.seatId(x, y)) || !tileAllowed(x, y)) continue;
      if (SM.findPath(Math.floor(me.x / T), Math.floor(me.y / T), x, y, tileAllowed)) { walkTo(x, y, false); return; }
    }
    toast('近くへ行けませんでした');
  }

  // アバターをタップしたときの表示
  function showUserPop(u, sx, sy) {
    const pop = $('#user-pop'); pop.textContent = '';
    const title = el('div', 'title', u.name);
    if (u.role !== 'student') title.append(el('span', 'badge ' + u.role, ROLE_LABEL[u.role]));
    pop.append(title);
    const room = u.room && roomInfo(u.room);
    pop.append(el('div', 'sub', (room ? room.name : 'ろうか・ロビー') + (u.seat ? '・着席中' : '') + (u.hand ? '・✋挙手中' : '') + (u.inPrivate ? '・🎧個別通話中' : '')));
    if (u.topic) pop.append(el('div', 'sub', '💬 ' + u.topic));
    if (u.topic && isStaff() && state.user.permissions.handle_students) {
      const c = el('button', 'btn small secondary', '吹き出しを消す');
      c.onclick = () => state.socket.emit('study-topic-clear', u.id, (r) => { hideUserPop(); if (!r || !r.ok) toast((r && r.error) || 'できませんでした'); });
      pop.append(c);
    }
    if (isStaff()) {
      if (u.role === 'student' && canPrivate() && !u.inPrivate) {
        const c = el('button', 'btn small', '🎧 個別通話をする');
        if (handleableRoom(u.room)) c.onclick = () => { hideUserPop(); state.pc.invite(u); };
        else { c.disabled = true; c.textContent = '🎧 担当の教室・自習室の生徒のみ'; }
        pop.append(c);
      }
      const go = el('button', 'btn small secondary', '近くへ行く'); go.onclick = () => walkNear(u); pop.append(go);
      if (u.hand && handleable(u.room)) { const b = el('button', 'btn small', '挙手に対応済みにする'); b.onclick = () => lowerHand(u); pop.append(b); }
    }
    pop.hidden = false;
    pop.style.left = Math.max(8, Math.min(sx - 100, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(sy + 12, innerHeight - pop.offsetHeight - 8)) + 'px';
  }
  function hideUserPop() { $('#user-pop').hidden = true; }

  // ───────── 部屋えらび ─────────
  const ROOM_ICON = { classroom: '🏫', study: '📚', lobby: '🚪' };
  function openRooms() {
    if (!state.ready) return;
    const list = $('#room-list');
    list.textContent = '';
    const here = state.me.room || ((SM.zoneAtPx(state.me.x, state.me.y) || {}).id);
    const items = [...state.rooms, { id: 'lobby', name: 'ロビー', type: 'lobby', canEnter: true }];
    for (const r of items) {
      const c = state.counts[r.id];
      const full = c && state.user.role === 'student' && c.students >= c.capacity && here !== r.id;
      const ok = r.canEnter && !full;
      const card = el('div', 'room-card' + (ok ? '' : ' locked') + (here === r.id ? ' here' : ''));
      const info = el('div');
      info.append(el('h3', null, r.name));
      info.append(el('p', null, (state.classes[r.id] ? '🎙 授業中・' : '') + (c ? `生徒 ${c.students}/${c.capacity}人` + (c.staff ? `・先生 ${c.staff}人` : '') + (!r.canEnter ? '・入れません' : full ? '・満員' : '') : 'みんなの入口')));
      const btn = el('button', 'btn small' + (ok ? '' : ' secondary'), here === r.id ? 'ここにいます' : !r.canEnter ? '🔒' : full ? '満員' : '行く');
      btn.disabled = !ok || here === r.id;
      btn.onclick = () => { $('#rooms-dialog').close(); goToRoom(r); };
      card.append(el('div', 'icon', ROOM_ICON[r.type]), info, btn);
      list.appendChild(card);
    }
    $('#rooms-dialog').showModal();
  }

  function goToRoom(r, tries = 0) {
    if (r.type === 'classroom' && state.user.role !== 'student') {
      const pod = SM.PODIUM[r.id];
      if (walkTo(pod.x, pod.y, false)) toast(`${r.name}の教壇へ向かいます`);
      return;
    }
    if (r.type === 'classroom' || r.type === 'study') {
      const z = SM.ZONES.find(v => v.id === r.id), entry = SM.ENTRY[r.id], occ = occupiedSeats();
      const seats = [];
      for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) {
        if (SM.tileAt(x, y) === 'c' && !occ.has(SM.seatId(x, y))) seats.push({ x, y });
      }
      seats.sort((a, b) => Math.hypot(a.x - entry.x, a.y - entry.y) - Math.hypot(b.x - entry.x, b.y - entry.y));
      if (!seats.length) return toast('空いている席がありません');
      // 同時に入ってきた人と同じ席を取り合わないよう、近い3席から選ぶ
      const pick = seats[Math.floor(Math.random() * Math.min(3, seats.length))];
      if (walkTo(pick.x, pick.y, true, r.id)) {
        if (state.pathSeat) state.pathSeat.tries = tries;
        if (!tries) toast(`${r.name}の空いている席へ向かいます`);
      }
      return;
    }
    const e = SM.ENTRY[r.id];
    if (e) walkTo(e.x, e.y, false);
  }

  // ───────── 入力 ─────────
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('keydown', (e) => {
    if (!state.me || e.target.closest('input, dialog')) return;
    if (KEYMAP[e.code]) { state.keys.add(KEYMAP[e.code]); e.preventDefault(); }
    else if (e.code === 'Space') { e.preventDefault(); toggleSit(); }
    else if (e.code === 'KeyH' && state.user.role === 'student') $('#btn-hand').click();
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) state.keys.delete(KEYMAP[e.code]); });
  window.addEventListener('blur', () => state.keys.clear());

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  function autoZoom() { return clampZoom(Math.max(innerWidth, innerHeight) / (24 * T)); }
  const clampZoom = (z) => Math.max(0.6, Math.min(2.6, z));
  const screenToWorld = (sx, sy) => ({ x: (sx - innerWidth / 2) / state.zoom + state.cam.x, y: (sy - innerHeight / 2) / state.zoom + state.cam.y });

  const pointers = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    $('#me-menu').hidden = true; $('#react-pop').hidden = true; hideUserPop();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      state.zoom = clampZoom(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
    }
  });
  const endPointer = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size === 0) pinch = null; return; }
    if (e.type === 'pointerup' && Math.hypot(p.x - p.sx, p.y - p.sy) < 12 && performance.now() - p.t < 600) onTap(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.zoom = clampZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });

  function onTap(sx, sy) {
    if (!state.ready) return;
    const w = screenToWorld(sx, sy);
    // ほかの人のアバター
    let hit = null, hd = 20;
    for (const u of state.others.values()) {
      const d = Math.hypot(u.rx - w.x, u.ry - 8 - w.y);
      if (d < hd) { hd = d; hit = u; }
    }
    if (hit) return showUserPop(hit, sx, sy);
    // 学年の木
    for (let i = 0; i < SM.FOREST.length; i++) {
      const p = treePos(i);
      if (Math.abs(w.x - p.x) < 42 && w.y > p.y - 100 && w.y < p.y + 24) return state.gb.openForest(i);
    }
    const tx = Math.floor(w.x / T), ty = Math.floor(w.y / T);
    if (SM.isSeat(tx, ty)) { walkTo(tx, ty, true); return; }
    if (SM.isWalkable(tx, ty)) { walkTo(tx, ty, false); return; }
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (SM.isWalkable(tx + dx, ty + dy)) { walkTo(tx + dx, ty + dy, SM.isSeat(tx + dx, ty + dy)); return; }
    }
  }

  const joy = $('#joystick'), knob = $('#knob');
  let joyId = null;
  const joyMove = (e) => {
    const r = joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2 - 10, d = Math.hypot(dx, dy);
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    state.joy = { x: dx / max, y: dy / max };
  };
  joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
  const joyEnd = (e) => { if (e.pointerId !== joyId) return; joyId = null; state.joy = { x: 0, y: 0 }; knob.style.transform = ''; };
  joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);

  $('#btn-rooms').onclick = openRooms;
  $('#rooms-close').onclick = () => $('#rooms-dialog').close();
  $('#btn-sit').onclick = toggleSit;
  $('#zoom-in').onclick = () => { state.zoom = clampZoom(state.zoom * 1.2); };
  $('#zoom-out').onclick = () => { state.zoom = clampZoom(state.zoom / 1.2); };
  $('#me-btn').onclick = () => {
    $('#me-menu').hidden = !$('#me-menu').hidden;
    if (!$('#me-menu').hidden) api('GET', '/api/version').then(v => { $('#menu-ver').textContent = `アプリの版：${v.version}`; }).catch(() => {});
  };
  $('#menu-logout').onclick = async () => {
    try { await api('POST', '/api/logout'); } catch (e) {}
    location.replace('/');
  };
  $('#menu-password').onclick = () => { $('#me-menu').hidden = true; $('#pw-form').reset(); $('#pw-error').textContent = ''; $('#pw-dialog').showModal(); };
  $('#pw-cancel').onclick = () => $('#pw-dialog').close();
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/me/password', { currentPassword: $('#pw-current').value, newPassword: $('#pw-new').value });
      $('#pw-dialog').close(); toast('パスワードを変更しました');
    } catch (err) { $('#pw-error').textContent = err.message; }
  });

  // ───────── がんばり（ポイント・目標・学年の木） ─────────
  $('#menu-shop').onclick = () => { $('#me-menu').hidden = true; state.gb.openShop(); };
  $('#menu-goal').onclick = () => { $('#me-menu').hidden = true; state.gb.openGoal(); };
  $('#menu-forest').onclick = () => { $('#me-menu').hidden = true; state.gb.openForest(null); };
  setInterval(() => { if (state.gb && document.visibilityState === 'visible') state.gb.refreshForest(); }, 60000);
  const treePos = (i) => { const f = SM.FOREST[i]; return { x: (f.x + 1) * T, y: (f.y + 1) * T - 6 }; };

  // ───────── 入室の通知の設定（先生・オーナー） ─────────
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const b64ToBytes = (b64) => { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
  let notifyInfo = null;
  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function renderNotify() {
    notifyInfo = await api('GET', '/api/notify');
    $('#nt-on').checked = notifyInfo.prefs.arrivals;
    const st = $('#nt-status');
    const sub = await currentSub().catch(() => null);
    $('#nt-sub').hidden = !!sub; $('#nt-unsub').hidden = !sub; $('#nt-test').hidden = !sub;
    $('#nt-local').hidden = !(pushSupported() && Notification.permission === 'granted');
    if (!pushSupported()) {
      st.textContent = isIOS && !isStandalone()
        ? 'iPhone・iPad では、Safari の共有ボタン →「ホーム画面に追加」をして、ホーム画面のアイコンから開くと使えます。'
        : 'このブラウザはプッシュ通知に対応していません。';
      $('#nt-sub').hidden = true;
    } else if (Notification.permission === 'denied') {
      st.textContent = '通知がブロックされています。ブラウザ（または端末）の設定で、このサイトの通知を「許可」にしてください。';
      $('#nt-sub').hidden = true;
    } else {
      st.textContent = sub ? '✅ この端末で受け取ります。' : 'この端末ではまだ受け取りません。';
    }
    if (notifyInfo.devices) st.textContent += `（登録している端末：${notifyInfo.devices}台）`;
  }
  $('#menu-notify').onclick = async () => {
    $('#me-menu').hidden = true;
    try { await renderNotify(); $('#notify-dialog').showModal(); } catch (e) { toast(e.message); }
  };
  $('#nt-close').onclick = () => $('#notify-dialog').close();
  $('#nt-on').onchange = async () => {
    try { await api('PATCH', '/api/notify', { arrivals: $('#nt-on').checked }); toast($('#nt-on').checked ? '入室の通知をオンにしました' : '入室の通知をオフにしました'); }
    catch (e) { toast(e.message); }
  };
  $('#nt-sub').onclick = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('通知が許可されませんでした'); return renderNotify(); }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(notifyInfo.publicKey) });
      const device = (isIOS ? 'iPhone/iPad' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows' : 'その他');
      await api('POST', '/api/notify/subscribe', { subscription: sub.toJSON(), device });
      toast('この端末で通知を受け取ります。「テスト通知を送る」で確かめられます');
    } catch (e) { toast('通知を登録できませんでした：' + (e.message || '')); }
    renderNotify();
  };
  $('#nt-unsub').onclick = async () => {
    try {
      const sub = await currentSub();
      if (sub) { await api('POST', '/api/notify/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      toast('この端末では通知を受け取りません');
    } catch (e) { toast(e.message); }
    renderNotify();
  };
  // 原因を見分けるための表示
  const showResult = (text) => { const r = $('#nt-result'); r.textContent = text; r.hidden = false; };
  $('#nt-test').onclick = async () => {
    try {
      const r = await api('POST', '/api/notify/test');
      const lines = [`送信できた端末：${r.sent}台 ／ 登録している端末：${r.devices}台`];
      for (const e of r.errors || []) lines.push(`送信エラー（${e.service}）：${e.status || ''} ${e.message || ''}`);
      if (r.sent) lines.push('数秒たっても届かないときは「この端末に直接表示（確認用）」を押してください。');
      else lines.push('送信できませんでした。「この端末では受け取らない」→「この端末で受け取る」で登録し直してください。');
      showResult(lines.join('\n'));
      renderNotify();
    } catch (e) { showResult('エラー：' + e.message); }
  };
  // サーバーを通さず、この端末で通知を出す（端末の設定の確認）
  $('#nt-local').onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('🔔 表示テスト', { body: 'これが見えれば、この端末の通知設定はOKです', tag: 'local-test', icon: '/icons/icon-192.png' });
      showResult('この端末で通知を出しました。\n・見えた → 端末はOK。送信の途中に原因があります（上の「テスト通知を送る」の結果を教えてください）\n・見えない → 端末やブラウザの通知設定、集中モード（応答不可）を確認してください');
    } catch (e) { showResult('この端末では通知を出せませんでした：' + e.message); }
  };

  // 音のテスト（スピーカー・イヤホンから音が出るか、生徒が自分で確認できる）
  $('#menu-sound').onclick = () => {
    $('#me-menu').hidden = true;
    chime(0.35);
    toast('「ピンポン」と聞こえたらOK。聞こえないときは、音量とマナーモード（iPhone の横のスイッチ）を確認してね', 6000);
  };

  // 画面が自動で消えないようにする（授業・個別通話の間と、生徒が自習室にいる間。
  // 画面が消えると音が止まったり、通信が切れて自習時間が数えられなくなる端末があるため）
  let wakeLock = null;
  async function updateWakeLock() {
    const studying = state.user && state.user.role === 'student' && state.me && SM.isStudyRoom(state.me.room);
    const need = document.visibilityState === 'visible' && (studying || (state.call && state.call.connected()) || (state.pc && state.pc.active()));
    try {
      if (need && !wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!need && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; /* 未対応の端末 */ }
  }
  setInterval(updateWakeLock, 3000);
  document.addEventListener('visibilitychange', updateWakeLock);

  // 先生への通知音（短いチャイム）
  let audioCtx = null;
  function chime(vol = 0.15) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      [880, 1175].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.0001, t0 + i * 0.15);
        g.gain.exponentialRampToValueAtTime(vol, t0 + i * 0.15 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.15 + 0.35);
        o.start(t0 + i * 0.15); o.stop(t0 + i * 0.15 + 0.4);
      });
    } catch (e) { /* 音が出せない環境 */ }
  }

  // ───────── 描画 ─────────
  // 上のバー・下のボタン・スティックの高さ（0.5秒ごとに測りなおす）
  let insetCache = { at: -1e9, top: 0, bottom: 0 };
  function uiInsets(time) {
    if (time - insetCache.at < 500) return insetCache;
    let top = 0, bottom = 0;
    const topEl = document.querySelector('.hud-top');
    if (topEl) top = Math.max(0, topEl.getBoundingClientRect().bottom);
    for (const sel of ['.hud-bottom', '.joystick']) {
      const el = document.querySelector(sel);
      if (!el || el.hidden || getComputedStyle(el).display === 'none') continue; // position: fixed なので offsetParent は使えない
      const r = el.getBoundingClientRect();
      if (r.height) bottom = Math.max(bottom, innerHeight - r.top);
    }
    insetCache = { at: time, top, bottom: Math.min(bottom, innerHeight * 0.4) };
    return insetCache;
  }
  function render(time) {
    ctx.fillStyle = '#3a3341'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    const me = state.me;
    if (!me || !mapCanvas) return;
    const z = state.zoom;
    // 画面の上下にあるボタンの下にマップの端（自習室の木など）が隠れないよう、その分だけ余白をとって動かす
    const ins = uiInsets(time);
    const clamp = (v, view, size, padA = 0, padB = 0) => size + padA + padB <= view ? size / 2 + (padB - padA) / 2 : Math.max(view / 2 - padA, Math.min(size - view / 2 + padB, v));
    // 自習室では、自分と部屋のまん中の間を見る（上の席にすわっても、まん中の学年の木が見えるように）
    const zone = SM.zoneAtPx(me.x, me.y);
    const lookY = zone && zone.type === 'study' ? (me.y + (zone.y1 + zone.y2 + 1) / 2 * T) / 2 : me.y;
    const tx = clamp(me.x, innerWidth / z, SM.W * T), ty = clamp(lookY, innerHeight / z, SM.H * T, ins.top / z, ins.bottom / z);
    state.cam.x += (tx - state.cam.x) * 0.12;
    state.cam.y += (ty - state.cam.y) * 0.12;

    ctx.save();
    ctx.translate(innerWidth / 2, innerHeight / 2);
    ctx.scale(z, z);
    ctx.translate(-Math.round(state.cam.x), -Math.round(state.cam.y));
    ctx.drawImage(mapCanvas, 0, 0);

    // 入れない部屋・満員の部屋
    for (const zone of SM.ZONES) {
      const reason = zoneBlockReason(zone);
      if (!reason) continue;
      ctx.fillStyle = 'rgba(40,30,50,.35)';
      ctx.fillRect(zone.x1 * T, zone.y1 * T, (zone.x2 - zone.x1 + 1) * T, (zone.y2 - zone.y1 + 1) * T);
      ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(/満員/.test(reason) ? '満員です' : '🔒 入れません', ((zone.x1 + zone.x2 + 1) / 2) * T, ((zone.y1 + zone.y2 + 1) / 2) * T);
      ctx.textAlign = 'start';
    }
    if (state.path.length) {
      ctx.fillStyle = 'rgba(47,125,225,.45)';
      for (const p of state.path) { ctx.beginPath(); ctx.arc((p.x + .5) * T, (p.y + .5) * T, 3, 0, Math.PI * 2); ctx.fill(); }
      const last = state.path[state.path.length - 1];
      ctx.strokeStyle = 'rgba(47,125,225,.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc((last.x + .5) * T, (last.y + .5) * T, 10 + Math.sin(time / 150) * 2, 0, Math.PI * 2); ctx.stroke();
    }
    const list = [...state.others.values()].map(u => ({ u, x: u.rx, y: u.ry, isMe: false }));
    list.push({ u: me, x: me.x, y: me.y, isMe: true });
    const forest = state.gb && state.gb.forest;
    SM.FOREST.forEach((f, i) => { const p = treePos(i); list.push({ tree: forest ? forest.trees[i] : null, x: p.x, y: p.y }); });
    list.sort((a, b) => a.y - b.y);
    const season = window.Render.seasonOf();
    if (forest && forest.event) window.Render.drawDecorations(ctx, forest.event.id, time);
    for (const it of list) {
      if ('tree' in it) window.Render.drawTree(ctx, it.x, it.y, it.tree, { time: time / 1000, season, highlight: it.tree && state.user && it.tree.grades.includes(state.user.grade) });
      else window.Render.drawAvatar(ctx, it.u, it.x, it.y, { isMe: it.isMe, time: time / 1000, now: time, speaking: state.call && state.call.isSpeaking(it.u.id) });
    }
    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    for (const u of state.others.values()) {
      if (Math.hypot(u.x - u.rx, u.y - u.ry) > T * 5) { u.rx = u.x; u.ry = u.y; }
      u.rx += (u.x - u.rx) * Math.min(1, dt * 12);
      u.ry += (u.y - u.ry) * Math.min(1, dt * 12);
    }
    render(now);
    requestAnimationFrame(loop);
  }

  window.__world = { state, walkTo, goToRoom };
})();
