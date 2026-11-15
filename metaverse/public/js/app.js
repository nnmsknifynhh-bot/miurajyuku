// 2D空間（第1段階：自分のアバターの移動・部屋の移動・着席）
(function () {
  const SM = window.SchoolMap, { api, toast, ROLE_LABEL } = window.App;
  const T = SM.TILE, SPEED = 140;
  const $ = (s) => document.querySelector(s);

  const state = {
    user: null, rooms: [], me: null, zoom: 1, cam: { x: 0, y: 0 },
    keys: new Set(), path: [], pathSeat: null, joy: { x: 0, y: 0 }, lastBlockToast: 0,
  };
  const canvas = $('#world'), ctx = canvas.getContext('2d');
  let mapCanvas = null;

  // ───────── 起動 ─────────
  (async function init() {
    let data;
    try { data = await api('GET', '/api/me'); } catch (e) { location.replace('/'); return; }
    state.user = data.user; state.rooms = data.rooms;
    const u = data.user;
    $('#me-name').textContent = u.displayName;
    $('#me-dot').style.background = u.avatarColor;
    $('#me-role').textContent = ROLE_LABEL[u.role];
    $('#me-role').className = 'badge ' + u.role;
    $('#menu-admin').hidden = !(u.role === 'owner' || u.permissions.manage_classroom);

    mapCanvas = window.Render.buildMap();
    const start = restorePosition() || randomSpawn();
    state.me = { name: u.displayName, role: u.role, color: u.avatarColor, x: start.x, y: start.y, dir: 'up', seat: null, moving: false };
    state.cam = { x: start.x, y: start.y };
    state.zoom = autoZoom();
    if (matchMedia('(pointer: coarse)').matches) $('#joystick').hidden = false;
    resize(); updatePlace(); updateSitButton();
    requestAnimationFrame(loop);
    setInterval(savePosition, 2000);
    setInterval(checkSession, 60000); // 無効化・強制ログアウトされたらログイン画面へ戻す
  })();

  async function checkSession() {
    try {
      const data = await api('GET', '/api/me');
      state.rooms = data.rooms; state.user = data.user;
    } catch (e) {
      if (e.status === 401) { alert('ログインが切れました。もう一度ログインしてください。'); location.replace('/'); }
    }
  }

  function randomSpawn() {
    const t = SM.SPAWN[Math.floor(Math.random() * SM.SPAWN.length)];
    return SM.tileCenter(t.x, t.y);
  }
  // 前回いた場所（この端末だけに保存。保存できなくても動く）
  function savePosition() {
    try { localStorage.setItem('juku-pos-' + state.user.id, JSON.stringify({ x: state.me.x, y: state.me.y })); } catch (e) {}
  }
  function restorePosition() {
    try {
      const p = JSON.parse(localStorage.getItem('juku-pos-' + state.user.id) || 'null');
      if (p && canStand(p.x, p.y)) return p;
    } catch (e) {}
    return null;
  }

  // ───────── 入室できる部屋の判定 ─────────
  // ※第1段階では画面側での判定です。第2段階でサーバー側の入室チェック（定員・権限）を追加します。
  function roomInfo(id) { return state.rooms.find(r => r.id === id); }
  function zoneAllowed(z) {
    if (!z || z.type !== 'classroom') return true;
    const r = roomInfo(z.id);
    return !!(r && r.canEnter);
  }
  const tileAllowed = (tx, ty) => zoneAllowed(SM.zoneAt(tx, ty));

  function canStand(x, y) {
    const r = 9;
    return [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]].every(([px, py]) => {
      const tx = Math.floor(px / T), ty = Math.floor(py / T);
      return SM.isWalkable(tx, ty) && tileAllowed(tx, ty);
    });
  }
  function blockedByRoom(x, y) {
    const z = SM.zoneAtPx(x, y);
    return z && !zoneAllowed(z) ? z : null;
  }
  function notifyBlocked(z) {
    if (performance.now() - state.lastBlockToast < 2500) return;
    state.lastBlockToast = performance.now();
    toast(`${z.name}には入れません` + (state.user.role === 'teacher' ? '（担当の教室ではありません）' : ''));
  }

  // ───────── 移動 ─────────
  function walkTo(tx, ty, seat) {
    const me = state.me;
    const z = SM.zoneAt(tx, ty);
    if (!zoneAllowed(z)) { notifyBlocked(z); return false; }
    const p = SM.findPath(Math.floor(me.x / T), Math.floor(me.y / T), tx, ty, tileAllowed);
    if (!p) return false;
    standUp();
    state.path = p; state.pathSeat = seat ? { x: tx, y: ty } : null;
    return true;
  }

  function sitAt(tx, ty) {
    const c = SM.tileCenter(tx, ty);
    Object.assign(state.me, { x: c.x, y: c.y, seat: SM.seatId(tx, ty), dir: SM.seatFacing(tx, ty), moving: false });
    updateSitButton();
  }
  function standUp() {
    if (!state.me.seat) return;
    state.me.seat = null;
    updateSitButton();
  }
  function toggleSit() {
    const me = state.me;
    if (me.seat) return standUp();
    const cx = Math.floor(me.x / T), cy = Math.floor(me.y / T);
    let best = null, bd = Infinity;
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (!SM.isSeat(x, y)) continue;
      const c = SM.tileCenter(x, y), d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d < bd && d < T * 1.4) { bd = d; best = { x, y }; }
    }
    if (!best) return toast('近くにいすがありません。いすをタップすると座れます');
    state.path = [];
    sitAt(best.x, best.y);
  }
  function updateSitButton() {
    $('#sit-label').textContent = state.me && state.me.seat ? 'たつ' : 'すわる';
    $('#btn-sit').classList.toggle('on', !!(state.me && state.me.seat));
  }

  function update(dt) {
    const me = state.me;
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
      if (canStand(nx, me.y)) me.x = nx; else { const z = blockedByRoom(nx + Math.sign(dx) * 9, me.y); if (z) notifyBlocked(z); }
      if (canStand(me.x, ny)) me.y = ny; else { const z = blockedByRoom(me.x, ny + Math.sign(dy) * 9); if (z) notifyBlocked(z); }
      me.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      me.moving = true;
    } else if (state.path.length) {
      const next = SM.tileCenter(state.path[0].x, state.path[0].y);
      const ex = next.x - me.x, ey = next.y - me.y, d = Math.hypot(ex, ey), step = SPEED * 1.2 * dt;
      if (d) me.dir = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? 'right' : 'left') : (ey > 0 ? 'down' : 'up');
      if (d <= step) { me.x = next.x; me.y = next.y; state.path.shift(); } else { me.x += ex / d * step; me.y += ey / d * step; }
      me.moving = true;
      if (!state.path.length && state.pathSeat) { sitAt(state.pathSeat.x, state.pathSeat.y); state.pathSeat = null; }
    }
    updatePlace();
  }

  let lastZoneId;
  function updatePlace() {
    const z = SM.zoneAtPx(state.me.x, state.me.y);
    const id = z ? z.id : null;
    if (id === lastZoneId) return;
    lastZoneId = id;
    $('#place-name').textContent = z ? z.name : '出入口';
    const r = z && roomInfo(z.id);
    $('#place-cap').textContent = r ? `定員${r.capacity}人` : '';
  }

  // ───────── 部屋えらび ─────────
  const ROOM_ICON = { classroom: '🏫', study: '📚', lobby: '🚪' };
  function openRooms() {
    const list = $('#room-list');
    list.textContent = '';
    const here = SM.zoneAtPx(state.me.x, state.me.y);
    const items = [...state.rooms, { id: 'lobby', name: 'ロビー', type: 'lobby', canEnter: true }];
    for (const r of items) {
      const card = document.createElement('div');
      card.className = 'room-card' + (r.canEnter ? '' : ' locked') + (here && here.id === r.id ? ' here' : '');
      const icon = document.createElement('div'); icon.className = 'icon'; icon.textContent = ROOM_ICON[r.type];
      const info = document.createElement('div');
      const h = document.createElement('h3'); h.textContent = r.name;
      const p = document.createElement('p');
      p.textContent = r.capacity ? `定員 ${r.capacity}人` + (r.canEnter ? '' : '・入れません') : 'みんなの入口';
      info.append(h, p);
      const btn = document.createElement('button');
      btn.className = 'btn small' + (r.canEnter ? '' : ' secondary');
      btn.textContent = here && here.id === r.id ? 'ここにいます' : r.canEnter ? '行く' : '🔒';
      btn.disabled = !r.canEnter || (here && here.id === r.id);
      btn.onclick = () => { $('#rooms-dialog').close(); goToRoom(r); };
      card.append(icon, info, btn);
      list.appendChild(card);
    }
    $('#rooms-dialog').showModal();
  }

  function goToRoom(r) {
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    if (r.type === 'classroom' && state.user.role !== 'student') {
      const pod = SM.PODIUM[r.id];
      if (walkTo(pod.x, pod.y, false)) toast(`${r.name}の教壇へ向かいます`);
      return;
    }
    if (r.type === 'classroom' || r.type === 'study') {
      // 第1段階：入口に近い席へ（ほかの人の着席状況は第2段階で反映）
      const z = SM.ZONES.find(v => v.id === r.id), entry = SM.ENTRY[r.id];
      const seats = [];
      for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) if (SM.tileAt(x, y) === 'c') seats.push({ x, y });
      seats.sort((a, b) => near(a, entry) - near(b, entry));
      const s = seats[0];
      if (s && walkTo(s.x, s.y, true)) toast(`${r.name}の席へ向かいます`);
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
  // 画面の大きさに合わせた見やすいズーム（スマホでは約11マス、PCでは約24マスが見える）
  function autoZoom() { return clampZoom(Math.max(innerWidth, innerHeight) / (24 * T)); }
  const clampZoom = (z) => Math.max(0.6, Math.min(2.6, z));
  const screenToWorld = (sx, sy) => ({ x: (sx - innerWidth / 2) / state.zoom + state.cam.x, y: (sy - innerHeight / 2) / state.zoom + state.cam.y });

  // タップで移動・2本指でズーム
  const pointers = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    $('#me-menu').hidden = true;
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
    const w = screenToWorld(sx, sy);
    const tx = Math.floor(w.x / T), ty = Math.floor(w.y / T);
    if (SM.isSeat(tx, ty)) { walkTo(tx, ty, true); return; }
    if (SM.isWalkable(tx, ty)) { walkTo(tx, ty, false); return; }
    // 机などをタップしたら、となりの歩ける場所へ
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (SM.isWalkable(tx + dx, ty + dy)) { walkTo(tx + dx, ty + dy, SM.isSeat(tx + dx, ty + dy)); return; }
    }
  }

  // バーチャルスティック（スマホ）
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

  // ボタン類
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

  // ───────── 描画 ─────────
  function render(time) {
    const me = state.me, z = state.zoom;
    const clamp = (v, view, size) => size <= view ? size / 2 : Math.max(view / 2, Math.min(size - view / 2, v));
    const tx = clamp(me.x, innerWidth / z, SM.W * T), ty = clamp(me.y, innerHeight / z, SM.H * T);
    state.cam.x += (tx - state.cam.x) * 0.12;
    state.cam.y += (ty - state.cam.y) * 0.12;

    ctx.fillStyle = '#3a3341'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.save();
    ctx.translate(innerWidth / 2, innerHeight / 2);
    ctx.scale(z, z);
    ctx.translate(-Math.round(state.cam.x), -Math.round(state.cam.y));
    ctx.drawImage(mapCanvas, 0, 0);

    // 入れない教室はうすく暗くする
    for (const zone of SM.ZONES) {
      if (zoneAllowed(zone)) continue;
      ctx.fillStyle = 'rgba(40,30,50,.35)';
      ctx.fillRect(zone.x1 * T, zone.y1 * T, (zone.x2 - zone.x1 + 1) * T, (zone.y2 - zone.y1 + 1) * T);
      ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText('🔒 入れません', ((zone.x1 + zone.x2 + 1) / 2) * T, ((zone.y1 + zone.y2 + 1) / 2) * T);
      ctx.textAlign = 'start';
    }
    // 行き先の表示
    if (state.path.length) {
      ctx.fillStyle = 'rgba(47,125,225,.45)';
      for (const p of state.path) { ctx.beginPath(); ctx.arc((p.x + .5) * T, (p.y + .5) * T, 3, 0, Math.PI * 2); ctx.fill(); }
      const last = state.path[state.path.length - 1];
      ctx.strokeStyle = 'rgba(47,125,225,.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc((last.x + .5) * T, (last.y + .5) * T, 10 + Math.sin(time / 150) * 2, 0, Math.PI * 2); ctx.stroke();
    }
    window.Render.drawAvatar(ctx, me, me.x, me.y, { isMe: true, time: time / 1000 });
    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render(now);
    requestAnimationFrame(loop);
  }

  // テスト用（自動テストから状態を確認するため）
  window.__world = { state, walkTo, goToRoom };
})();
