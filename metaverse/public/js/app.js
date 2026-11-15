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
    classes: {}, classCall: false, call: null,
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
    connect();
    requestAnimationFrame(loop);
  })();

  async function loadMe() {
    const data = await api('GET', '/api/me');
    state.user = data.user; state.rooms = data.rooms;
    $('#menu-admin').hidden = !(data.user.role === 'owner' || data.user.permissions.manage_classroom);
  }

  // ───────── サーバーとの接続 ─────────
  function connect() {
    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;
    state.call = window.ClassCall.create({ socket, getState: () => state, toast });
    $('#conn').hidden = false;

    socket.on('connect', () => { $('#conn').hidden = true; });
    socket.on('disconnect', (reason) => {
      state.ready = false;
      if (reason !== 'io server disconnect') { $('#conn').textContent = '接続が切れました。つなぎなおしています…'; $('#conn').hidden = false; }
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
      buildReactions(); updateAll();
    });
    socket.on('class-state', (c) => { state.classes = c; state.call.sync(); });
    socket.on('class-ended', ({ room, reason }) => {
      if (state.me && state.me.room === room) toast(reason || '授業が終わりました', 4500);
    });
    socket.on('rooms', (c) => { state.counts = c; updatePlace(true); renderPanel(); });
    socket.on('user-joined', (u) => { state.others.set(u.id, { ...u, rx: u.x, ry: u.y }); renderPanel(); });
    socket.on('user-left', ({ id }) => { state.others.delete(id); renderPanel(); hideUserPop(); });
    socket.on('user-moved', (d) => { const u = state.others.get(d.id); if (u) Object.assign(u, d); });
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
      state.call.leave();
      alert(reason || '接続が切断されました');
      location.replace('/');
    });
  }

  function sendMove(force) {
    if (!state.ready) return;
    const me = state.me, t = performance.now();
    const key = Math.round(me.x) + ',' + Math.round(me.y) + ',' + me.dir + ',' + me.moving;
    if (key === state.lastSentKey || (!force && t - state.lastSent < 66)) return;
    state.lastSent = t; state.lastSentKey = key;
    state.socket.emit('move', { x: me.x, y: me.y, dir: me.dir, moving: me.moving });
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
  function updateAll() { updatePlace(true); updateButtons(); renderPanel(); if (state.call) state.call.sync(); }

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

  function updateButtons() {
    const me = state.me;
    $('#sit-label').textContent = me && me.seat ? 'たつ' : 'すわる';
    $('#btn-sit').classList.toggle('on', !!(me && me.seat));
    $('#hand-label').textContent = me && me.hand ? '手をおろす' : '手をあげる';
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
  $('#btn-react').onclick = () => { $('#react-pop').hidden = !$('#react-pop').hidden; };

  // ───────── 先生用パネル（挙手一覧・入室者一覧） ─────────
  function openPanel(tab) {
    state.panelTab = tab;
    $('#panel').hidden = false;
    document.querySelectorAll('.panel-tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#panel-hands').hidden = tab !== 'hands'; $('#panel-people').hidden = tab !== 'people';
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

  function renderPanel() {
    if (!isStaff() || !state.me) return;
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
      const done = el('button', 'btn small', '対応済み'); done.onclick = () => lowerHand(u);
      acts.append(go, done);
      item.append(info, acts);
      hb.append(item);
    }
    hb.append(el('p', 'panel-note', '生徒との個別通話は第4段階で追加します（現在は未実装）'));

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
        li.append(el('span', 'tag', (u.hand ? '✋ ' : '') + (u.seat ? '着席' : '')));
        ul.append(li);
      }
      if (members.length) box.append(ul);
      pb.append(box);
    }
  }
  setInterval(() => { if (!$('#panel').hidden) renderPanel(); }, 15000);

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
    pop.append(el('div', 'sub', (room ? room.name : 'ろうか・ロビー') + (u.seat ? '・着席中' : '') + (u.hand ? '・✋挙手中' : '')));
    if (isStaff()) {
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
  $('#me-btn').onclick = () => { $('#me-menu').hidden = !$('#me-menu').hidden; };
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

  // 先生への通知音（短いチャイム）
  let audioCtx = null;
  function chime() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      [880, 1175].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.0001, t0 + i * 0.15);
        g.gain.exponentialRampToValueAtTime(0.15, t0 + i * 0.15 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.15 + 0.35);
        o.start(t0 + i * 0.15); o.stop(t0 + i * 0.15 + 0.4);
      });
    } catch (e) { /* 音が出せない環境 */ }
  }

  // ───────── 描画 ─────────
  function render(time) {
    ctx.fillStyle = '#3a3341'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    const me = state.me;
    if (!me || !mapCanvas) return;
    const z = state.zoom;
    const clamp = (v, view, size) => size <= view ? size / 2 : Math.max(view / 2, Math.min(size - view / 2, v));
    const tx = clamp(me.x, innerWidth / z, SM.W * T), ty = clamp(me.y, innerHeight / z, SM.H * T);
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
    list.sort((a, b) => a.y - b.y);
    for (const it of list) window.Render.drawAvatar(ctx, it.u, it.x, it.y, { isMe: it.isMe, time: time / 1000, now: time, speaking: state.call && state.call.isSpeaking(it.u.id) });
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
