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
  const isStaff = () => !!(state.user && (state.user.role === 'owner' || state.user.role === 'teacher'));
  const isParent = () => !!(state.user && state.user.role === 'parent');
  const isOwner = () => !!(state.user && state.user.role === 'owner');
  // 生徒と同じルールで動く人（生徒・保護者会の日の保護者）
  const studentLike = () => !!(state.user && (state.user.role === 'student' || (state.user.role === 'parent' && state.meeting)));

  // ───────── 起動 ─────────
  (async function init() {
    try { await loadMe(); } catch (e) { location.replace('/'); return; }
    const u = state.user;
    $('#me-name').textContent = u.displayName;
    $('#me-dot').style.background = u.avatarColor;
    $('#me-role').textContent = ROLE_LABEL[u.role];
    $('#me-role').className = 'badge ' + u.role;
    document.body.classList.add(u.role === 'student' ? 'is-student' : u.role === 'parent' ? 'is-parent' : 'is-staff');
    if (state.trial) { $('#me-role').textContent = '体験'; document.body.classList.add('is-trial'); try { localStorage.setItem('juku-trial-until', String(state.trial.until)); } catch (e) {} }
    mapCanvas = window.Render.buildMap();
    state.zoom = autoZoom();
    if (matchMedia('(pointer: coarse)').matches) $('#joystick').hidden = false;
    resize();
    if (state.closed) { showVisitOver(state.closed); return; } // 保護者会の時間は入れない
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
    state.closed = data.closed || null;
    state.trial = data.trial || null;
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
    socket.on('study-minute', () => { if (state.user && state.user.role === 'student') { refreshWeek(); refreshFun(); } });
    // 季節のお楽しみ
    // ── スピーキング・ライティングテストの順番待ち ──
    socket.on('test-queue', (q) => { state.testQueue = q; renderTest(); });
    socket.on('test-notice', ({ text }) => { if (!(state.me && state.me.room === 'class1')) { toast(text, 5000); chime(0.1); } });
    socket.on('test-called', ({ seat, name, by }) => {
      state.testBooth = seat;
      const [x, y] = seat.split(',').map(Number);
      toast(`🎤 順番が来ました！ ${by}先生が呼んでいます。${name}へ移動します`, 6000); chime(0.2);
      walkTo(x, y, true);
    });
    socket.on('test-finished', ({ by }) => {
      state.testBooth = null; if (state.me) state.me.seat = null;
      toast(`🎤 テストおつかれさま！（${by}先生）席にもどります`, 5000);
      goNearSeat();
      renderTest();
    });
    socket.on('fun-event', (d) => {
      if (d.kind === 'asa') toast(`🌅 早起きスタンプ！ +${d.points}ポイント（ぜんぶで${d.stamps}こ）`, 6000);
      refreshFun(true);
    });
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
      state.testQueue = d.testQueue || null;
      state.mySeats = d.mySeats || [];
      if (state.user.role === 'student') setTimeout(goMySeat, 1800);
      { const mine = state.testQueue && state.testQueue.booths.find(b => b.userId === d.me.id); state.testBooth = mine ? mine.seat : null; }
      buildReactions(); updateAll(); refreshWeek(true); refreshFun(true); renderTest();
      if (isParent()) parentInit(d.visit);
      updateOverviewBtn();
    });
    // ── 保護者 ──
    socket.on('visit-over', ({ message }) => showVisitOver(message));
    socket.on('myseats', (list) => { state.mySeats = list || []; });
    socket.on('myseat-lost', () => { toast('⭐ 🔥がとぎれたので、マイ席はお休みになりました。また続けたら、えらべるよ', 7000); refreshFun(true); });
    socket.on('referral-reward', ({ kind, points }) => {
      const msg = kind === 'enroll' ? '🐥 友だちが入塾しました！ おそろいの「なかよしひよこ」をもらったよ。7日間のペア自習チャレンジもスタート！'
        : kind === 'pair' ? `🤝 ペア自習チャレンジ成功！ 「ペア自習のきらきら星」💫と ${points}ポイントをもらったよ`
        : `🌷 ご紹介のご家族が入塾しました！ 家族の木に🌷が咲き、${points}ポイントをもらいました`;
      toast(msg, 9000); chime(0.2); refreshFun(true);
    });
    socket.on('meeting-closed', ({ message }) => { state.ready = false; showVisitOver(message); });
    socket.on('meeting-soon', ({ start, end }) => { toast(`📣 まもなく保護者会です（${start}〜${end}）。${start}になったら一度退室します。${end}からまた入れます`, 12000); chime(0.2); });
    socket.on('parent-meeting', ({ on }) => {
      setMeeting(!!on);
      if (on) { visitEndsAt = 0; toast('👪 保護者会がはじまりました。教室や自習室にも入れます', 6000); }
      else toast('👪 保護者会はおわりました。ロビーにもどります', 5000);
    });
    socket.on('mendan', ({ allowed }) => {
      if (allowed) { if (isParent()) { state.mendan = true; visitEndsAt = 0; } toast('🗣 面談ブースに入れるようになりました（ロビーの左下）', 6000); chime(0.15); }
      else { state.mendan = false; toast('面談ブースの許可がおわりました', 4000); }
    });
    socket.on('moms-updated', (m) => { if (state.gb && state.gb.forest) state.gb.forest.moms = m; });
    // 生徒：おうちの人からの「見たよ」スタンプ（次に入ったとき1回だけ）
    socket.on('cheer', ({ stamps }) => {
      const show = (i) => { if (i >= stamps.length) return; toast(`🏠 おうちの人から：${stamps[i]}`, 7000); chime(0.15); setTimeout(() => show(i + 1), 7200); };
      setTimeout(() => show(0), 1500);
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
      if (isParent() || /保護者会/.test(reason || '')) { showVisitOver(reason); return; }
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
    if (studentLike() && c && c.students >= c.capacity) return `${z.name}は満員です（定員${c.capacity}人）`;
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
    if (seat && SM.tileAt(tx, ty) === 'O' && state.user.role === 'student') { toast('ソファは保護者の方の席です'); seat = false; }
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
      if (isParent() && SM.tileAt(tx, ty) === 'O') parentSeated();
    });
  }
  function standUp() {
    exitOverview();
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
      if (SM.tileAt(x, y) === 'O' && state.user.role === 'student') continue; // ソファは保護者の席
      if (SM.isBoothSeat(SM.seatId(x, y)) && state.testBooth !== SM.seatId(x, y) && studentLike()) continue; // ブースは呼ばれたときだけ
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
    for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) if (SM.tileAt(x, y) === 'c' && !SM.isBoothSeat(SM.seatId(x, y))) seats.push({ x, y });
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
  // ───────── 保護者：ロビーのソファ・見わたし・毎日5問・わが子 ─────────
  let visitTimer = null, visitEndsAt = 0;
  function parentInit(visit) {
    state.mendan = !!(visit && visit.mendan);
    setMeeting(!!(visit && visit.meeting));
    if (visit && visit.endsAt) visitEndsAt = visit.endsAt;
    clearInterval(visitTimer);
    const tick = () => {
      const left = Math.max(0, visitEndsAt - Date.now()), m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
      const chip = $('#visit-chip');
      if (state.meeting || state.mendan) { chip.hidden = false; chip.textContent = state.meeting ? '👪 保護者会' : '🗣 面談ブースに入れます（左下）'; chip.classList.remove('warn'); return; }
      chip.hidden = !visitEndsAt;
      chip.textContent = `⏳ のこり ${m}:${String(s).padStart(2, '0')}・🔥${(state.me && state.me.streak) || 1}日目`;
      chip.classList.toggle('warn', left < 60000);
    };
    tick(); visitTimer = setInterval(tick, 1000);
    refreshPquizLabel();
    if (state.meeting) toast('👪 今日は保護者会です。生徒と同じルールで、教室や自習室にも入れます', 6000);
    else if (visit && visit.again) toast('おかえりなさい。今日の訪問の残り時間からつづきます', 4000);
    else toast('ようこそ！ 保護者の方はロビーで過ごします（1日1回・10分）', 4500);
    if (!state.me.seat) setTimeout(openSofaPicker, 400); else parentSeated();
  }
  function setMeeting(on) {
    state.meeting = on;
    document.body.classList.toggle('is-meeting', on);
    updateAll();
  }
  function openSofaPicker() {
    const map = $('#sofa-map'); map.textContent = '';
    const occ = occupiedSeats();
    for (const sofa of SM.SOFAS) {
      const box = el('div', 'seat-side'), grid = el('div', 'seat-grid');
      grid.style.gridTemplateColumns = `repeat(${sofa.seats.length}, minmax(0, 44px))`;
      for (const [x, y] of sofa.seats) {
        const taken = occ.has(SM.seatId(x, y)), b = el('button', null, taken ? '👤' : '🛋');
        b.type = 'button'; b.disabled = taken; b.title = taken ? 'ほかの方がすわっています' : 'ここにすわる';
        b.onclick = () => { $('#sofa-dialog').close(); walkTo(x, y, true); };
        grid.append(b);
      }
      box.append(el('b', null, sofa.name), grid); map.append(box);
    }
    if (!$('#sofa-dialog').open) $('#sofa-dialog').showModal();
  }
  let pquizAuto = false;
  // 塾全体を見わたす（保護者はソファにすわったとき・オーナーは「見わたす」ボタン）
  function enterOverview() {
    state.overview = true;
    // 塾全体が入る大きさ（スマホのたて画面では高さに合わせ、横は指でずらして見る）
    const fitW = innerWidth / (SM.W * T), fitH = (innerHeight - 200) / (SM.H * T);
    state.zoom = clampZoom(Math.min(fitH, fitW * 2.2));
    state.view = { x: state.me.x, y: SM.H * T / 2 };
    toast(matchMedia('(pointer: coarse)').matches ? '塾の中全体を見わたせます。指でずらす・2本指でひろげると近くが見られます' : '塾の中全体を見わたせます。ドラッグでずらす・ホイールで大きさを変えられます', 5000);
    updateOverviewBtn();
  }
  function exitOverview() {
    if (!state.overview) return;
    state.overview = false; state.zoom = autoZoom(); updateOverviewBtn();
  }
  function updateOverviewBtn() {
    const b = $('#btn-overview');
    b.hidden = !isOwner();
    b.classList.toggle('on', !!state.overview);
    $('#overview-label').textContent = state.overview ? 'もどる' : '見わたす';
  }
  $('#btn-overview').onclick = () => (state.overview ? exitOverview() : enterOverview());
  function parentSeated() {
    enterOverview();
    if (!pquizAuto) { pquizAuto = true; setTimeout(() => openPquiz(true), 1200); }
  }
  function showVisitOver(message) {
    clearInterval(visitTimer);
    state.ready = false;
    if (!isParent()) { // 生徒：保護者会の時間
      $('#visit-over-icon').textContent = '👪'; $('#visit-over-title').textContent = '今は保護者会の時間です';
      $('#visit-over-note').textContent = '時間になったら「もう一度入る」を押してください。'; $('#visit-retry').hidden = false;
    }
    $('#visit-over-msg').textContent = message || '';
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    $('#visit-over').hidden = false;
  }
  $('#visit-retry').onclick = () => location.reload();
  $('#visit-logout').onclick = async () => { try { await api('POST', '/api/logout'); } catch (e) {} location.replace('/'); };

  // 毎日5問（日替わりの教科・1問正解で1ポイント）
  let pq = null, pqIndex = 0;
  async function refreshPquizLabel() {
    try {
      pq = await api('GET', '/api/parent/quiz');
      const left = pq.questions.filter(q => !q.done).length;
      $('#pquiz-label').textContent = left ? `5問 あと${left}` : '5問 ✓';
      return left;
    } catch (e) { return 0; }
  }
  async function openPquiz(auto) {
    const left = await refreshPquizLabel();
    if (!pq) return;
    if (!left) { if (!auto) showPquizSummary(); return; }
    pqIndex = pq.questions.findIndex(q => !q.done);
    showPquizQuestion();
    if (!$('#pquiz-dialog').open) $('#pquiz-dialog').showModal();
  }
  function showPquizQuestion() {
    const q = pq.questions[pqIndex];
    $('#pquiz-subject').textContent = `今日は${pq.subject}`;
    $('#pquiz-step').textContent = `${pqIndex + 1} / ${pq.total}問目`;
    $('#pquiz-q').textContent = q.question;
    $('#pquiz-result').hidden = true; $('#pquiz-next').hidden = true; $('#pquiz-close').textContent = 'あとで';
    const box = $('#pquiz-choices'); box.textContent = '';
    for (const c of q.choices) {
      const b = el('button', null, c); b.type = 'button';
      b.onclick = async () => {
        box.querySelectorAll('button').forEach(x => { x.disabled = true; });
        let r;
        try { r = await api('POST', '/api/parent/quiz/answer', { qid: q.qid, choice: c }); } catch (e) { toast(e.message); return; }
        q.done = true; q.correct = r.correct;
        [...box.children].forEach(x => { if (x.textContent === r.answer) x.classList.add('ok'); });
        if (!r.correct) b.classList.add('ng');
        const res = $('#pquiz-result');
        res.textContent = r.correct ? '🎉 正解！ +1ポイント' : `ざんねん… 正解は「${r.answer}」`;
        res.style.color = r.correct ? 'var(--success)' : 'var(--danger)';
        res.hidden = false;
        const next = pq.questions.findIndex(x => !x.done);
        const nb = $('#pquiz-next'); nb.hidden = false; nb.textContent = next >= 0 ? '次の問題へ' : '結果を見る';
        nb.onclick = () => { if (next >= 0) { pqIndex = next; showPquizQuestion(); } else showPquizSummary(); };
        refreshPquizLabel();
        if (state.gb && state.gb.refresh) state.gb.refresh();
      };
      box.append(b);
    }
  }
  function showPquizSummary() {
    const ok = pq.questions.filter(q => q.correct).length;
    $('#pquiz-subject').textContent = `今日は${pq.subject}`;
    $('#pquiz-step').textContent = '';
    $('#pquiz-q').textContent = `今日の5問はおわりです。${pq.total}問中 ${ok}問 正解（+${ok}ポイント）`;
    $('#pquiz-choices').textContent = '';
    const res = $('#pquiz-result'); res.hidden = false; res.style.color = ''; res.textContent = 'ポイントは「🎁 ショップ」で着せかえと交換できます。また明日、ちがう教科でお待ちしています。';
    $('#pquiz-next').hidden = true; $('#pquiz-close').textContent = 'とじる';
    if (!$('#pquiz-dialog').open) $('#pquiz-dialog').showModal();
  }
  $('#btn-pquiz').onclick = () => openPquiz(false);
  $('#pquiz-close').onclick = () => $('#pquiz-dialog').close();

  // わが子の様子と「見たよ」スタンプ
  async function openFamily() {
    let d;
    try { d = await api('GET', '/api/parent/home'); } catch (e) { toast(e.message); return; }
    const list = $('#family-list'); list.textContent = '';
    if (!d.children.length) list.append(el('p', 'muted', 'まだお子さまがつながっていません。塾の招待コードを下から追加してください。'));
    for (const k of d.children) {
      const card = el('div', 'family-kid');
      card.append(el('h3', null, `${k.name}さん ${k.studying ? '📖 いま自習中' : k.online ? '🟢 入室中' : ''}`));
      const st = el('div', 'family-stats');
      const stat = (label, v) => { const d = el('div', null, label); d.append(el('b', null, v)); return d; };
      st.append(stat('今日の自習', fmtMin(k.today)), stat('今週', fmtMin(k.week)), stat('🔥 連続', `${k.streak}日`));
      card.append(st);
      if (k.goal) card.append(el('p', 'muted', `🎯 目標：${k.goal.text}${k.goal.achieved ? '（達成！）' : ''}`));
      const stamps = el('div', 'family-stamps');
      if (k.cheered) stamps.append(el('p', 'muted', '✅ 今日のスタンプは送りました。次に入室したときに表示されます'));
      else {
        stamps.append(el('p', 'muted', '「見たよ」スタンプを1つ選んでください（1日1回）'));
        for (const s of d.stamps) {
          const b = el('button', 'btn secondary small', s); b.type = 'button';
          b.onclick = async () => {
            stamps.querySelectorAll('button').forEach(x => { x.disabled = true; });
            try { await api('POST', '/api/parent/cheer', { studentId: k.id, stamp: s }); toast(`🌸 送りました！「家族の木」に花が1つ咲きました`, 4500); openFamily(); }
            catch (e) { toast(e.message); stamps.querySelectorAll('button').forEach(x => { x.disabled = false; }); }
          };
          stamps.append(b);
        }
      }
      card.append(stamps); list.append(card);
    }
    const m = d.moms;
    $('#family-moms').textContent = `🌸 家族の木：花${m.flowers}こ${m.tulips ? `・🌷${m.tulips}` : ''}（${m.stageName}）・今月${m.families}家族が挑戦中・あなたは🔥${d.streak}日連続・${d.points}ポイント`;
    if (!$('#family-dialog').open) $('#family-dialog').showModal();
  }
  const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`;
  $('#btn-family').onclick = openFamily;
  $('#family-close').onclick = () => $('#family-dialog').close();
  $('#family-add').onclick = async () => {
    const code = $('#family-code').value.trim();
    if (!code) return;
    try { await api('POST', '/api/parent/link', { code }); $('#family-code').value = ''; toast('お子さまを追加しました'); openFamily(); }
    catch (e) { toast(e.message); }
  };

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

  // ───────── 季節のお楽しみ（がんばりサンタ・朝活） ─────────
  // ほかの画面が開いていないときに出す
  function showWhenFree(d) {
    const show = () => { if (d.open) return; if (document.querySelector('dialog[open]')) return setTimeout(show, 1500); d.showModal(); };
    setTimeout(show, 600);
  }
  let funBusy = false, lastFunAt = 0;
  async function refreshFun(force) {
    if (!state.user || state.user.role !== 'student') { $('#fun-chip').hidden = true; return; }
    if (funBusy || (!force && Date.now() - lastFunAt < 50_000)) return;
    funBusy = true; lastFunAt = Date.now();
    try {
      const g = await api('GET', '/api/me/ganbari');
      const f = g.fun || {};
      state.fun = f;
      const chips = [];
      // 季節の2章イベント（🎅 がんばりサンタ・🎋 七夕）
      for (const ev of [f.santa, f.tanabata]) {
        if (!ev) continue;
        const L = SEASON[ev.event], end = `${Number(ev.parade.to.slice(0, 2))}/${Number(ev.parade.to.slice(3))}`, start = `${Number(ev.parade.from.slice(0, 2))}/${Number(ev.parade.from.slice(3))}`;
        if (ev.phase === 'ch1' || ev.phase === 'ch2') {
          const ch = ev.chapters[ev.phase === 'ch1' ? 0 : 1];
          chips.push(ch.cleared ? `${L.icon} ${ch.name} クリア！${ev.phase === 'ch1' ? ` ${L.from}から手紙が届いたよ` : ` ${start}から${L.one}がついてくるよ`}`
            : `${L.icon} ${ch.name} ${ch.days}/${ev.need}日（1日${ev.minMinutes}分以上）`);
        } else if (ev.phase === 'parade' && ev.follow.length) chips.push(`${ev.follow.length > 1 ? L.bothIcon + ' ' + L.both : L.icon + ' ' + L.one}がいっしょ！（${end}まで）`);
        // 特別な日（12/25・7/7）：その日はじめて入ったときに1回
        if (ev.fx) { const k = `juku-fx-${ev.event}-${ev.year}`; let seen = false; try { seen = !!localStorage.getItem(k); localStorage.setItem(k, '1'); } catch (e2) {} if (!seen) { toast(L.fxMsg, 9000); chime(0.25); } }
        // 💌 第1章クリア：手紙（読むまで、入室したときに1回出る）
        if (ev.letter && !letterAsked[ev.event]) { letterAsked[ev.event] = true; showLetter(ev); }
      }
      // ⭐ マイ席
      const ms = g.mySeat;
      if (ms && !state.trial) {
        if (ms.eligible && !ms.seat) {
          chips.push('⭐ マイ席をえらべるよ！ メニューの「⭐ マイ席」から');
          const k = 'juku-myseat-ok-' + state.user.id; let seen = false; try { seen = !!localStorage.getItem(k); localStorage.setItem(k, '1'); } catch (e2) {}
          if (!seen) { toast(`⭐ 🔥${ms.need}${ms.unit}達成！ 自分だけの「マイ席」をえらべるようになったよ`, 8000); chime(0.25); }
        } else if (!ms.eligible && ms.streak >= Math.ceil(ms.need / 3)) chips.push(`⭐ マイ席まで 🔥${ms.streak}/${ms.need}${ms.unit}`);
        if (!ms.eligible) { try { localStorage.removeItem('juku-myseat-ok-' + state.user.id); } catch (e2) {} }
      }
      // 🎎 3学期：ひな祭り・春のスター
      const hi = f.hina;
      if (hi && hi.phase === 'count') {
        const next = hi.tiers.find(x => !x.cleared);
        chips.push(`🎎 ${hi.name} ${hi.days}日（1日${hi.minMinutes}分以上）` + (next ? `\nあと${next.need - hi.days}日で${next.label}` : '\n五人囃子までそろったよ！'));
      } else if (hi && hi.phase === 'parade' && hi.cleared) chips.push(`🎎 ひな人形の行列がいっしょ！（3/20まで）`);
      if (hi && hi.fx) { const k = `juku-fx-hina-${hi.year}`; let seen = false; try { seen = !!localStorage.getItem(k); localStorage.setItem(k, '1'); } catch (e2) {} if (!seen) { toast('🎎 ひな祭りおめでとう！ がんばったあなたに、ひなあられがふってきたよ', 9000); chime(0.25); } }
      const hm = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' });
      if (f.morning && hm >= f.morning.start && hm < f.morning.end) chips.push(f.morning.today >= f.morning.minutes ? `🌅 朝活 今日のスタンプ ✓（ぜんぶで${f.morning.stamps}こ）` : `🌅 朝活 ${f.morning.today}/${f.morning.minutes}分（スタンプ${f.morning.stamps}こ）`);
      $('#fun-chip').textContent = chips.join('\n'); $('#fun-chip').style.whiteSpace = 'pre-line'; $('#fun-chip').hidden = !chips.length;
      // 🤝 友だち紹介：体験中・ペア自習チャレンジ・紹介ウィーク
      const rc = [];
      if (state.trial) {
        const left = Math.max(0, Math.ceil((state.trial.until - Date.now()) / 86400e3)), end = new Date(state.trial.until);
        rc.push(`🎈 体験中・あと${left}日（${end.getMonth() + 1}/${end.getDate()}まで）${state.trial.inviter ? `\n${state.trial.inviter}さんからの招待` : ''}`);
      }
      const pr = g.pair;
      if (pr && !pr.result) rc.push(`🤝 ペア自習チャレンジ（${pr.partner}さんと）\nあなた ${pr.mine}/${pr.days}日・${pr.partner} ${pr.theirs}/${pr.days}日${pr.broken ? '（おしかった！）' : ''}`);
      else if (pr && pr.result === 'success') rc.push(`🤝 ペア自習チャレンジ成功！ 💫と+${pr.points}ポイント`);
      if (g.referralWeek && !state.trial) rc.push(`🎉 友だち紹介ウィーク（〜${Number(g.referralWeek.end.slice(5, 7))}/${Number(g.referralWeek.end.slice(8))}）\nメニューの「🤝 友だちを招待」から`);
      $('#ref-chip').textContent = rc.join('\n'); $('#ref-chip').hidden = !rc.length;
    } catch (e) { /* 次の機会に */ } finally { funBusy = false; }
  }
  setInterval(() => refreshFun(), 60_000);
  // 季節の2章イベントのことば
  const SEASON = {
    santa: { icon: '🎅', bothIcon: '🎅🦌', from: 'サンタ', one: 'サンタ', both: 'サンタとトナカイ', item: 'サンタ帽', box: '💌',
      fxMsg: '🎄 メリークリスマス！ サンタからみんなへ、がんばったごほうびの雪とプレゼントが届いたよ',
      letter: (ev, name) => `${Number(ev.chapters[0].from.slice(0, 2))}月、${ev.chapters[0].days}日も自習をがんばったね。中間テストもよくがんばりました。\nごほうびに、サンタ帽をプレゼントするよ（着せかえでつけられます）。\n${Number(ev.chapters[1].from.slice(0, 2))}月も${ev.need}日がんばったら、12月1日から25日まで、わたしが${name}さんのうしろをついて歩くよ。両方クリアしたら、トナカイもいっしょにね。\n　　　　　　　　サンタより 🎅` },
    tanabata: { icon: '🎋', bothIcon: '🎋💫', from: '織姫と彦星', one: '彦星', both: '彦星と織姫', item: '笹かざり', box: '🎋',
      fxMsg: '🌌 今日は七夕！ あなたががんばって天の川に橋をかけたから、織姫と彦星が会えたよ',
      letter: (ev, name) => `${Number(ev.chapters[0].from.slice(0, 2))}月、${ev.chapters[0].days}日も自習をがんばってくれてありがとう。あなたの自習の一日一日が、天の川にかかる橋の星になっています。\nお礼に、笹かざりをおくります（着せかえでつけられます）。\n${Number(ev.chapters[1].from.slice(0, 2))}月も${ev.need}日がんばったら、7月1日から20日まで、彦星が${name}さんのうしろをついて歩きます。両方クリアしたら、織姫も会いにきて、2人そろって歩きます。\n　　　　　　織姫と彦星より 🌌` },
  };
  const letterAsked = {};
  let letterEvent = 'santa';
  function showLetter(ev) {
    const L = SEASON[ev.event];
    letterEvent = ev.event;
    $('#santa-box').textContent = L.box;
    $('#santa-from').textContent = `${L.icon} ${L.from}から手紙が届いたよ！`;
    $('#santa-title').textContent = `${state.user.displayName}さんへ`;
    $('#santa-msg').textContent = L.letter(ev, state.user.displayName);
    showWhenFree($('#santa-dialog'));
  }
  $('#santa-later').onclick = () => { $('#santa-dialog').close(); };
  $('#santa-open').onclick = async () => {
    $('#santa-dialog').close();
    const L = SEASON[letterEvent];
    try { await api('POST', '/api/me/event-letter', { event: letterEvent }); toast(`${L.icon} ${L.item}は「ポイントと着せかえ」でつけられるよ`, 5000); } catch (e) { /* 次の機会に */ }
    refreshFun(true);
  };

  $('#bday-close').onclick = () => { $('#bday-dialog').close(); if (state.gb && state.gb.refreshForest) state.gb.refreshForest(); };
  $('#seat-close').onclick = () => { $('#seat-dialog').close(); standingSince = Date.now(); };
  // 近くの空いている席（テストのブースはのぞく）へ歩いてすわる
  function goNearSeat() {
    const me = state.me, occ = occupiedSeats();
    if (!me) return;
    const free = studySeats().filter(s => !occ.has(SM.seatId(s.x, s.y)))
      .sort((a, b) => Math.hypot(SM.tileCenter(a.x, a.y).x - me.x, SM.tileCenter(a.x, a.y).y - me.y) - Math.hypot(SM.tileCenter(b.x, b.y).x - me.x, SM.tileCenter(b.x, b.y).y - me.y));
    if (free.length) walkTo(free[0].x, free[0].y, true);
  }
  // ───── スピーキング・ライティングテスト：生徒の「並ぶ」ボタンと、先生の受付パネル ─────
  function renderTest() {
    const q = state.testQueue, me = state.me;
    if (!me || !state.user || !q) { $('#btn-test').hidden = true; $('#test-panel').hidden = true; return; }
    const inTest = me.room === 'class1';
    if (state.user.role === 'student') {
      const pos = q.queue.findIndex(x => x.id === me.id);
      const booth = q.booths.find(b => b.userId === me.id);
      $('#btn-test').hidden = !inTest;
      $('#test-label').textContent = booth ? 'テスト中' : pos >= 0 ? `${pos + 1}番目` : 'テストに並ぶ';
      $('#btn-test').classList.toggle('on', pos >= 0 || !!booth);
      $('#btn-test').disabled = !!booth;
    } else {
      const canRun = state.user.role === 'owner' || (state.user.permissions && state.user.permissions.handle_students);
      $('#test-panel').hidden = !(inTest && canRun);
      if ($('#test-panel').hidden) return;
      const bx = $('#test-booths'); bx.textContent = '';
      for (const b of q.booths) {
        const row = el('div', 'test-booth' + (b.userId ? '' : ' free'));
        row.append(el('span', null, `${b.name}：${b.userName || '空き'}`));
        const acts = el('span', 'acts');
        if (b.userId) {
          const u = state.others.get(b.userId);
          if (u && canPrivate()) { const call = el('button', 'btn small', '🎧 通話'); call.onclick = () => state.pc.invite(u); acts.append(call); }
          const done = el('button', 'btn small secondary', '✅ 終了');
          done.onclick = () => state.socket.emit('test-done', { userId: b.userId }, (r) => { if (!r || !r.ok) toast((r && r.error) || 'できませんでした'); });
          acts.append(done);
        } else {
          const next = el('button', 'btn small', '▶ 次の人を呼ぶ');
          next.disabled = !q.queue.length;
          next.onclick = () => state.socket.emit('test-next', { seat: b.seat }, (r) => { if (!r || !r.ok) toast((r && r.error) || 'できませんでした'); else toast(`${r.name}さんを呼びました`); });
          acts.append(next);
        }
        row.append(acts); bx.append(row);
      }
      $('#test-q-count').textContent = `${q.queue.length}人`;
      const ol = $('#test-queue'); ol.textContent = '';
      if (!q.queue.length) ol.append(el('li', 'muted', 'まだだれも並んでいません'));
      for (const x of q.queue) ol.append(el('li', null, x.name));
    }
  }
  $('#btn-test').onclick = () => {
    const q = state.testQueue, me = state.me;
    if (!q || !me) return;
    if (q.queue.some(x => x.id === me.id)) {
      if (!confirm('テストの順番待ちをやめますか？')) return;
      state.socket.emit('test-leave', {}, () => toast('順番待ちをやめました'));
      return;
    }
    state.socket.emit('test-join', {}, (r) => {
      if (!r || !r.ok) return toast((r && r.error) || '並べませんでした');
      toast(`🎤 テストの順番待ちに並びました（${r.n}番目）。呼ばれるまで、席で自習していてね`, 5000);
    });
  };
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
    const watching = state.ready && me && studentLike() && SM.isStudyRoom(me.room) && !me.seat
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
    if (!studentLike()) return null;
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
      if ((u.role === 'owner' || u.role === 'teacher') && Math.hypot(u.x - me.x, u.y - me.y) <= T * 3.5 && zoneId(u.x, u.y) === myZone) return true;
    }
    return false;
  }
  function openTopic() {
    if (studentLike() && !state.me.topic && $('#btn-topic').hidden) {
      return toast('💬 吹き出しは、先生と話すときだけ使えます。先生に近くに来てもらってね', 5000);
    }
    const warn = chatWarning();
    $('#topic-warn').textContent = warn || ''; $('#topic-warn').hidden = !warn;
    const chips = $('#topic-chips'); chips.textContent = '';
    const student = studentLike();
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
    // スマホ・タブレットは、画面に見えていれば離席にしない（動画を小さく浮かせて見ている・画面を2つに分けているときなど）。
    // パソコンは、ほかのウィンドウを操作しているときも離席にする
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const away = document.visibilityState === 'hidden' ? 'hidden' : (touch || document.hasFocus() ? null : 'blur');
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
    if (!studentLike() || !state.me) return;
    // 授業中の教室では、先生が「スタンプ・吹き出しOK」にしたときだけ
    const cls = state.me.room && state.classes && state.classes[state.me.room];
    const inCall = !!(state.pc && state.pc.active());
    const talk = inCall || (cls ? !!cls.allowChat : talkingWithStaff());
    const topicOn = talk || !!state.me.topic;
    const reactOn = talk || (isParent() && !state.me.room); // 保護者はロビーではいつでもあいさつできる
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
    renderTest();
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
  const canPrivate = () => !!(isStaff() && state.user.permissions.start_private_call && state.classCall);
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
      const full = c && studentLike() && c.students >= c.capacity && here !== r.id;
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
    if (r.type === 'classroom' && !studentLike()) {
      const pod = SM.PODIUM[r.id];
      if (walkTo(pod.x, pod.y, false)) toast(`${r.name}の教壇へ向かいます`);
      return;
    }
    if (r.type === 'classroom' || r.type === 'study') {
      const z = SM.ZONES.find(v => v.id === r.id), entry = SM.ENTRY[r.id], occ = occupiedSeats();
      const seats = [];
      for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) {
        if (SM.tileAt(x, y) === 'c' && !occ.has(SM.seatId(x, y)) && !SM.isBoothSeat(SM.seatId(x, y))) seats.push({ x, y });
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
    if (KEYMAP[e.code]) { state.keys.add(KEYMAP[e.code]); e.preventDefault(); if (!isParent()) exitOverview(); }
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
  const clampZoom = (z) => Math.max(isParent() || isOwner() ? 0.15 : 0.6, Math.min(2.6, z)); // 保護者は塾全体を見わたせるように小さくできる
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
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    // 保護者がすわって見わたしているときは、1本指でずらして見る
    if (state.overview && pointers.size === 1 && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) { state.view.x -= dx / state.zoom; state.view.y -= dy / state.zoom; p.panned = true; }
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
    if (e.type === 'pointerup' && !p.panned && Math.hypot(p.x - p.sx, p.y - p.sy) < 12 && performance.now() - p.t < 600) onTap(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.zoom = clampZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });

  function onTap(sx, sy) {
    if (!state.ready) return;
    const w = screenToWorld(sx, sy);
    // ほかの人のアバター
    let hit = null, hd = Infinity;
    for (const u of state.others.values()) {
      const big = u.bloom || u.role === 'owner' || u.role === 'teacher'; // 1.4倍のアバターは、当たりも大きく
      const d = Math.hypot(u.rx - w.x, u.ry - (big ? 14 : 8) - w.y);
      if (d < (big ? 28 : 20) && d < hd) { hd = d; hit = u; }
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
  joy.addEventListener('pointerdown', (e) => { if (!isParent()) exitOverview(); joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); });
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
  // ───── 🤝 友だちを招待（招待カード・LINE） ─────
  let invite = null;
  async function openInvite() {
    $('#me-menu').hidden = true;
    try { invite = await api('GET', '/api/me/referral'); } catch (e) { return toast(e.message); }
    if (!invite.trial) return toast('いまは体験の受付をお休みしています');
    invite.url = location.origin + invite.path;
    const parent = isParent();
    $('#invite-title').textContent = parent ? '🌷 お友だちのご家族に紹介する' : '🤝 友だちを招待しよう';
    $('#invite-note').textContent = `${invite.week ? '🎉 友だち紹介ウィーク中！ ' : ''}リンクを送ると、${invite.days}日間オンライン自習室を体験できます（記録は残りません）。`;
    $('#invite-rewards').textContent = parent
      ? `紹介したご家族のお子さんが入塾すると、家族の木に🌷が咲き、${invite.rewards.parentPoints}ポイントもらえます。`
      : `友だちが入塾したら、2人におそろいの「なかよしひよこ🐥」。さらに7日間2人とも🔥を続けたら「ペア自習のきらきら星💫」と${invite.rewards.pairPoints}ポイント！`;
    $('#invite-card').hidden = parent; $('#invite-share').hidden = parent;
    if (!parent) drawInviteCard();
    $('#invite-dialog').showModal();
  }
  const inviteText = () => isParent()
    ? `三浦塾のオンライン自習室、よかったら体験してみませんか？ ${invite.days}日間、お子さんが体験できます。\n${invite.url}`
    : `${state.user.displayName}だよ！ 三浦塾のオンライン自習室で、いっしょに自習しよう！ ${invite.days}日間体験できるよ🎉\n${invite.url}`;
  function drawInviteCard() {
    const cv = $('#invite-card'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#47b4ff'); g.addColorStop(0.5, '#8a7cff'); g.addColorStop(1, '#ff8fbf');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,.12)'; for (let i = 0; i < 40; i++) { c.beginPath(); c.arc((i * 197) % W, (i * 311) % H, 6 + (i % 4) * 4, 0, Math.PI * 2); c.fill(); }
    c.textAlign = 'center'; c.fillStyle = '#fff'; c.font = '900 64px sans-serif';
    c.fillText('いっしょに自習しよう！', W / 2, 150);
    c.font = '700 40px sans-serif'; c.fillText(`${state.user.displayName}さんからの招待状`, W / 2, 225);
    // まん中：自分のアバター（着せかえのまま）
    c.fillStyle = 'rgba(255,255,255,.95)'; c.beginPath(); c.roundRect(140, 290, W - 280, 620, 60); c.fill();
    c.fillStyle = '#ffe9a8'; c.beginPath(); c.ellipse(W / 2, 760, 230, 50, 0, 0, Math.PI * 2); c.fill();
    c.save(); c.translate(W / 2, 640); c.scale(7, 7);
    const me = state.me || {};
    window.Render.drawAvatar(c, { ...me, seat: null, moving: false, dir: 'down', name: '', topic: null, today: null, reaction: null, streak: 0, title: null, bday: false }, 0, 0, { time: 0, noTag: true });
    c.restore();
    c.fillStyle = '#3a2f28'; c.font = '900 52px sans-serif';
    c.fillText(me.streak >= 1 ? `🔥 ${me.streak}${me.hs ? '週' : '日'}連続で自習中！` : '📚 毎日コツコツ自習中！', W / 2, 870);
    c.fillStyle = '#fff'; c.font = '900 54px sans-serif'; c.fillText('三浦塾 オンライン自習室', W / 2, 1010);
    c.font = '700 38px sans-serif';
    c.fillText(`アバターで入って、席にすわって集中！`, W / 2, 1075);
    c.fillText(`${invite.days}日間、体験できます`, W / 2, 1130);
    c.fillStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.roundRect(120, 1180, W - 240, 110, 30); c.fill();
    c.fillStyle = '#6f4cff'; c.font = '900 40px sans-serif'; c.fillText('リンクから体験スタート ▶', W / 2, 1250);
  }
  $('#menu-invite').onclick = openInvite;
  // ───── ⭐ マイ席 ─────
  const myMySeat = () => (state.mySeats || []).find(s => s.id === (state.user && state.user.id));
  async function openMySeat() {
    $('#me-menu').hidden = true;
    let d;
    try { d = await api('GET', '/api/me/myseat'); } catch (e) { return toast(e.message); }
    $('#myseat-note').textContent = d.eligible
      ? `🔥${d.streak}${d.unit}続いているね！ 好きな席をえらぶと、机に名前プレートがつきます。いないときは、ほかの子も座れます。🔥がとぎれたら返します。`
      : `🔥が${d.need}${d.unit}続いたら、自分だけの「マイ席」をえらべます（いま🔥${d.streak}${d.unit}）。`;
    const map = $('#myseat-map'); map.textContent = '';
    const seats = d.seats.map(s => { const [x, y] = s.id.split(',').map(Number); return { ...s, x, y }; });
    const groups = (SM.SEAT_GROUPS[d.room] || [{ label: '席' }]).map(gp => [gp.label, seats.filter(s =>
      (gp.x1 == null || (s.x >= gp.x1 && s.x <= gp.x2)) && (gp.y1 == null || (s.y >= gp.y1 && s.y <= gp.y2)))]);
    for (const [label, side] of groups) {
      if (!side.length) continue;
      const xs = [...new Set(side.map(s => s.x))].sort((a, b) => a - b), ys = [...new Set(side.map(s => s.y))].sort((a, b) => a - b);
      const box = el('div', 'seat-side'), grid = el('div', 'seat-grid');
      grid.style.gridTemplateColumns = `repeat(${xs.length}, minmax(0, 44px))`;
      for (const st of side) {
        const mine = st.id === d.seat, b = el('button', mine ? 'mine' : st.taken ? 'other-mine' : null, mine ? '⭐' : st.taken ? '🌟' : '🪑');
        b.type = 'button'; b.disabled = !d.eligible || st.taken || mine;
        b.title = mine ? 'あなたのマイ席' : st.taken ? 'ほかの子のマイ席' : 'この席をマイ席にする';
        b.style.gridColumn = xs.indexOf(st.x) + 1; b.style.gridRow = ys.indexOf(st.y) + 1;
        b.onclick = async () => {
          try { await api('POST', '/api/me/myseat', { seat: st.id }); toast('⭐ マイ席に決めたよ！ 次から入ると、この席に案内します', 5000); $('#myseat-dialog').close(); walkTo(st.x, st.y, true, true); }
          catch (e) { toast(e.message); }
        };
        grid.append(b);
      }
      box.append(el('b', null, label), grid); map.append(box);
    }
    if (!$('#myseat-dialog').open) $('#myseat-dialog').showModal();
  }
  $('#menu-myseat').onclick = openMySeat;
  $('#myseat-close').onclick = () => $('#myseat-dialog').close();
  // 入ったとき：マイ席が空いていれば、そこへ案内する
  function goMySeat() {
    const m = myMySeat(), me = state.me;
    if (!m || !me || me.seat || state.path.length || document.querySelector('dialog[open]')) return;
    const [x, y] = m.seat.split(',').map(Number);
    if (occupiedSeats().has(m.seat)) return toast('⭐ マイ席は、いまほかの子が使っています。ほかの席にすわってね', 5000);
    if (walkTo(x, y, true, true)) toast('⭐ マイ席へ案内します', 3000);
  }
  $('#family-invite').onclick = () => { $('#family-dialog').close(); openInvite(); };
  $('#invite-close').onclick = () => $('#invite-dialog').close();
  $('#invite-line').onclick = () => { window.open('https://line.me/R/share?text=' + encodeURIComponent(inviteText()), '_blank', 'noopener'); };
  $('#invite-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(inviteText()); toast('招待のメッセージとリンクをコピーしました'); } catch (e) { toast('コピーできませんでした'); }
  };
  $('#invite-share').onclick = () => {
    $('#invite-card').toBlob(async (blob) => {
      const file = new File([blob], '三浦塾_招待カード.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: inviteText() }); } catch (e) { /* やめた */ }
        return;
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('カードを保存しました。LINEで送るときは、リンクもいっしょに送ってね');
    }, 'image/png');
  };

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
  let insetCache = { at: -1e9, top: 0, over: 0, bottom: 0 };
  function uiInsets(time) {
    if (time - insetCache.at < 500) return insetCache;
    let top = 0, bottom = 0;
    const topEl = document.querySelector('.hud-top');
    if (topEl) top = Math.max(0, topEl.getBoundingClientRect().bottom);
    // 上に出ている表示（見守り中・お知らせのチップ）の下まで
    let over = top;
    for (const sel of ['.top-chips', '#sc-badge']) {
      const el = document.querySelector(sel);
      if (!el || el.hidden || getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.height) over = Math.max(over, r.bottom);
    }
    for (const sel of ['.hud-bottom', '.joystick']) {
      const el = document.querySelector(sel);
      if (!el || el.hidden || getComputedStyle(el).display === 'none') continue; // position: fixed なので offsetParent は使えない
      const r = el.getBoundingClientRect();
      if (r.height) bottom = Math.max(bottom, innerHeight - r.top);
    }
    insetCache = { at: time, top, over: Math.min(over, innerHeight * 0.45), bottom: Math.min(bottom, innerHeight * 0.4) };
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
    let tx = clamp(me.x, innerWidth / z, SM.W * T), ty = clamp(lookY, innerHeight / z, SM.H * T, ins.top / z, ins.bottom / z);
    // 自分が上の表示（見守り中など）や下のボタンにかくれないように（教室のいちばん上のブースなど）
    { const upper = me.y + (innerHeight / 2 - ins.over) / z - 64 / z, lower = me.y - (innerHeight / 2 - ins.bottom) / z + 24 / z; // 頭と名札の分・足もとの分
      if (ty > upper) ty = upper; else if (ty < lower) ty = lower; }
    if (state.overview) { // 保護者：すわっている間は塾全体を見わたす（ずらして見られる）
      state.view.x = tx = clamp(state.view.x, innerWidth / z, SM.W * T);
      state.view.y = ty = clamp(state.view.y, innerHeight / z, SM.H * T, ins.top / z, ins.bottom / z);
    }
    state.cam.x += (tx - state.cam.x) * 0.12;
    state.cam.y += (ty - state.cam.y) * 0.12;

    ctx.save();
    ctx.translate(innerWidth / 2, innerHeight / 2);
    ctx.scale(z, z);
    ctx.translate(-Math.round(state.cam.x), -Math.round(state.cam.y));
    ctx.drawImage(mapCanvas, 0, 0);
    drawMySeatPlates(time);

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
    // 家族の木（ロビー）：見たよスタンプで花が咲く
    if (forest && forest.moms) {
      const m = forest.moms;
      list.push({ tree: { name: m.name, stage: m.stage, stageName: `🌸${m.flowers}${m.tulips ? `・🌷${m.tulips}` : ''}・今月${m.families}家族が挑戦中`, goals: [], grades: [] }, x: (SM.MOM_TREE.x + 1) * T, y: (SM.MOM_TREE.y + 1) * T - 6 });
    }
    // 🎅 がんばりサンタ：うしろについて歩くサンタとトナカイ（12/1〜12/25）
    for (const it of list.slice()) if (it.u && it.u.follow && it.u.follow.length) for (const f of followerPos(it.u, it.x, it.y)) list.push(f);
    for (const it of list.slice()) if (it.u && it.u.fx) list.push({ fx: it.u.fx, x: it.x, y: it.y, z: 1e6 }); // 特別な日の演出（いちばん上にかく）
    for (const it of list) if (it.u && it.u.bloom) spawnPetals(it.u, it.x, it.y, time);
    if (petals.length) list.push({ petals: true, y: 0, z: 1e6 + 1 });
    list.sort((a, b) => (a.z || a.y) - (b.z || b.y));
    const season = window.Render.seasonOf();
    if (forest && forest.event) window.Render.drawDecorations(ctx, forest.event.id, time);
    for (const it of list) {
      if ('tree' in it) window.Render.drawTree(ctx, it.x, it.y, it.tree, { time: time / 1000, season, highlight: it.tree && state.user && it.tree.grades.includes(state.user.grade) });
      else if (it.follower) window.Render.drawFollower(ctx, it.follower, it.x, it.y, time / 1000);
      else if (it.fx) window.Render.drawFx(ctx, it.fx, it.x, it.y, time / 1000);
      else if (it.petals) { for (let i = petals.length - 1; i >= 0; i--) if (!window.Render.drawPetal(ctx, petals[i], time)) petals.splice(i, 1); }
      else if (it.u && (it.u.bloom || it.u.role === 'owner' || it.u.role === 'teacher')) { // 先生・オーナー（と🌸春のスター）はアバターが1.4倍
        const s = 1.4;
        if (it.u.bloom) window.Render.drawBloomGlow(ctx, it.x, it.y, time / 1000, s);
        ctx.save(); ctx.translate(it.x, it.y + 12); ctx.scale(s, s); ctx.translate(-it.x, -(it.y + 12));
        window.Render.drawAvatar(ctx, it.u, it.x, it.y, { isMe: it.isMe, time: time / 1000, now: time, speaking: state.call && state.call.isSpeaking(it.u.id) });
        ctx.restore();
      }
      else window.Render.drawAvatar(ctx, it.u, it.x, it.y, { isMe: it.isMe, time: time / 1000, now: time, speaking: state.call && state.call.isSpeaking(it.u.id) });
    }
    ctx.restore();
  }

  // ⭐ マイ席：机に金色の名前プレート。本人がすわっているときは、席がほんのり光る
  function drawMySeatPlates(time) {
    for (const s of state.mySeats || []) {
      const [sx, sy] = s.seat.split(',').map(Number);
      const deskY = SM.seatFacing(sx, sy) === 'up' ? sy - 1 : sy + 1;
      const owner = s.id === state.me.id ? state.me : state.others.get(s.id);
      if (owner && owner.seat === s.seat) {
        const g = ctx.createRadialGradient((sx + 0.5) * T, (sy + 0.5) * T, 2, (sx + 0.5) * T, (sy + 0.5) * T, T * 1.1);
        g.addColorStop(0, `rgba(255,214,90,${0.38 + Math.sin(time / 500) * 0.08})`); g.addColorStop(1, 'rgba(255,214,90,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc((sx + 0.5) * T, (sy + 0.5) * T, T * 1.1, 0, Math.PI * 2); ctx.fill();
      }
      const label = s.name ? '⭐' + (s.name.length > 4 ? s.name.slice(0, 4) : s.name) : '⭐';
      ctx.font = 'bold 8px sans-serif';
      const w = Math.max(14, ctx.measureText(label).width + 6), px = (sx + 0.5) * T, py = deskY < sy ? (sy + 1) * T + 3 : (deskY + 0.5) * T - 9; // いつも本人の足もと側に（名札や頭にかくれないように）
      const gr = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0);
      gr.addColorStop(0, '#d4a017'); gr.addColorStop(0.5, '#f7d36a'); gr.addColorStop(1, '#d4a017');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.roundRect(px - w / 2, py - 5.5, w, 11, 3); ctx.fill();
      ctx.strokeStyle = '#a07a10'; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.fillStyle = '#4a3200'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, px, py + 0.5);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }
  // 🌸 歩くと花吹雪：動いたぶんだけ花びらをまく
  const petals = [], lastBloom = new Map();
  function spawnPetals(u, x, y, now) {
    const lp = lastBloom.get(u.id);
    lastBloom.set(u.id, { x, y });
    if (!lp || petals.length > 260) return;
    const d = Math.hypot(x - lp.x, y - lp.y);
    const n = d > 0.5 ? 2 : (Math.random() < 0.04 ? 1 : 0); // 止まっているときも、ときどきひらり
    const colors = ['#ffc4d8', '#ff9fc0', '#ffd9e6', '#ffffff'];
    for (let i = 0; i < n; i++) petals.push({ x: x + (Math.random() - 0.5) * 22, y: y - 6 - Math.random() * 30, vx: (Math.random() - 0.5) * 30 - (x - lp.x) * 2, vy: -8 - Math.random() * 10, born: now, seed: Math.random() * 6, c: colors[(Math.random() * 4) | 0] });
  }
  // 歩いた道すじを少しだけ覚えておき、その上をうしろからついてくる（すわっているときは席のとなり）
  const trails = new Map();
  function followerPos(u, x, y) {
    let tr = trails.get(u.id);
    if (!tr) trails.set(u.id, tr = [{ x, y }]);
    const lp = tr[tr.length - 1];
    if (Math.hypot(x - lp.x, y - lp.y) > 3) { tr.push({ x, y }); if (tr.length > 80) tr.shift(); }
    return u.follow.map((kind, k) => {
      let pos = null;
      if (!u.seat) {
        const want = 30 * (k + 1);
        let dist = 0, px = x, py = y;
        for (let i = tr.length - 1; i >= 0; i--) {
          const d = Math.hypot(tr[i].x - px, tr[i].y - py);
          if (d > 0 && dist + d >= want) { const r = (want - dist) / d; pos = { x: px + (tr[i].x - px) * r, y: py + (tr[i].y - py) * r }; break; }
          dist += d; px = tr[i].x; py = tr[i].y;
        }
      }
      if (!pos) { const side = k % 2 ? 1 : -1, d = 24 + Math.floor(k / 2) * 18; pos = { x: x + side * d, y: y + 4 }; } // すわっているときは左右にならぶ
      return { follower: kind, x: pos.x, y: pos.y };
    });
  }

  let last = performance.now();
  function loop(now) {
    if (saver.on) { setTimeout(() => requestAnimationFrame(loop), 1000); return; } // 省電力中は地図をかかない
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

  // ───────── 🔋 省電力画面・電池のお知らせ ─────────
  const SAVER_IDLE_MS = Number(localStorage.getItem('juku-saver-ms')) || 60_000;
  const saver = { on: false, lastInput: Date.now(), battery: null };
  const fmtHM = (m) => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`);
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => {
    saver.lastInput = Date.now();
    if (saver.on) exitSaver();
  }, { capture: true, passive: true }));
  function saverAllowed() {
    const me = state.me;
    if (!state.ready || !me || !studentLike() || !SM.isStudyRoom(me.room) || !me.seat) return false;
    if (document.querySelector('dialog[open]') || !$('#visit-over').hidden) return false;
    if (state.pc && state.pc.active()) return false;
    if (talkingWithStaff()) return false; // 先生が話しかけに来たら、元の画面
    return true;
  }
  function enterSaver() {
    saver.on = true; $('#saver').hidden = false; updateSaver();
  }
  function exitSaver() {
    saver.on = false; $('#saver').hidden = true; saver.lastInput = Date.now();
  }
  function updateSaver() {
    if (!saver.on) return;
    const now = new Date(), me = state.me || {};
    $('#saver-clock').textContent = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    $('#saver-today').textContent = `📖 今日 ${fmtHM(me.today || 0)}`;
    const b = saver.battery, low = b && !b.charging && b.level < 0.2;
    $('#saver-sub').textContent = (me.streak >= 1 ? `🔥${me.streak}${me.hs ? '週' : '日'}連続` : '') + (b ? `　🔋${Math.round(b.level * 100)}%${b.charging ? '（充電中）' : ''}` : '') + (low ? '　充電してね' : '');
    $('#saver-sub').classList.toggle('low', !!low);
    // 同じ場所に文字を出し続けないよう、1分ごとに少し動かす
    const k = now.getMinutes();
    $('#saver-box').style.transform = `translate(${((k * 37) % 61) - 30}px, ${((k * 53) % 121) - 60}px)`;
  }
  setInterval(() => {
    if (!saver.on && saverAllowed() && Date.now() - saver.lastInput > SAVER_IDLE_MS) enterSaver();
    else if (saver.on && !saverAllowed()) exitSaver();
    else updateSaver();
  }, 1000);
  $('#saver').addEventListener('click', exitSaver);
  // 電池が20%を切ったら「充電してね」（Android の Chrome など、電池の残りを読めるブラウザだけ）
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      saver.battery = b;
      let warned = false;
      const check = () => {
        if (b.charging || b.level >= 0.2) { warned = false; return; }
        if (warned || !state.user || state.user.role !== 'student') return;
        warned = true;
        toast(`🔌 電池がのこり${Math.round(b.level * 100)}%です。充電しながら勉強しよう`, 8000);
      };
      b.addEventListener('levelchange', check); b.addEventListener('chargingchange', check);
      setTimeout(check, 3000);
    }).catch(() => {});
  }

  window.__world = { state, walkTo, goToRoom, showLetter };
})();
