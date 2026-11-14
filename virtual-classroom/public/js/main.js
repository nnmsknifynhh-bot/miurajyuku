// 三浦塾 バーチャル教室 クライアント
(function () {
  const CM = window.ClassMap;
  const T = CM.TILE;
  const SPEED = 150;              // px/秒
  const R_CONNECT = T * 3.5;      // この距離に近づくと通話開始
  const R_DISCONNECT = T * 4.5;   // この距離を離れると通話終了
  const R_FULL = T * 1.5;         // この距離以内は最大音量

  const $ = (s) => document.querySelector(s);
  const state = {
    socket: null, rtc: null, me: null, others: new Map(),
    keys: new Set(), path: [], pathSeat: null, zoom: Math.max(0.8, Math.min(1.6, Math.min(innerWidth / (30 * 32), innerHeight / (20 * 32)))), cam: { x: 0, y: 0 },
    lastSent: 0, lastSentPos: '', selfLevel: 0, micAnalyser: null, links: new Map(),
    stream: { mic: null, cam: null, screen: null }, media: { mic: false, cam: false, screen: false },
    autoSeat: false, viewerPeer: null, config: null,
  };

  // ───────── 入室 ─────────
  fetch('/config').then(r => r.json()).then(c => { state.config = c; }).catch(() => { state.config = { iceServers: [] }; });
  try { $('#name').value = localStorage.getItem('vc-name') || ''; $('#color').value = localStorage.getItem('vc-color') || '#64b5f6'; } catch (e) {}

  document.querySelectorAll('input[name=role]').forEach(r => r.addEventListener('change', () => {
    $('#pass-row').hidden = !(r.value === 'teacher' && r.checked && state.config && state.config.teacherPasscodeRequired);
  }));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#join-btn');
    btn.disabled = true; $('#login-error').textContent = '';
    const name = $('#name').value.trim();
    const role = document.querySelector('input[name=role]:checked').value;
    const color = $('#color').value;
    try { localStorage.setItem('vc-name', name); localStorage.setItem('vc-color', color); } catch (e) {}

    // マイク取得（ユーザー操作の中で行う）
    try {
      state.stream.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      state.media.mic = true;
    } catch (err) {
      console.warn('マイクを使用できません', err);
    }

    const socket = io();
    socket.emit('join', { name, role, color, passcode: $('#passcode').value }, (res) => {
      if (!res.ok) {
        $('#login-error').textContent = res.error || '入室できませんでした';
        btn.disabled = false; socket.disconnect();
        return;
      }
      state.socket = socket;
      start(res, $('#autoseat').checked);
    });
  });

  function start(res, autoSeat) {
    const { socket } = state;
    state.me = { ...res.self };
    for (const u of res.users) addOther(u);
    if (state.me.role === 'teacher') document.body.classList.add('is-teacher');
    $('#login').hidden = true; $('#app').hidden = false;

    state.rtc = new RtcManager({
      socket, selfId: state.me.id, iceServers: (state.config && state.config.iceServers) || [],
      onPeersChanged: () => scheduleVideoRender(),
    });
    if (state.stream.mic) {
      state.rtc.setLocalTrack('audio', state.stream.mic.getAudioTracks()[0]);
      setupMicMeter(state.stream.mic);
    }
    sendMedia();

    socket.on('user-joined', addOther);
    socket.on('user-left', ({ id }) => { state.others.delete(id); state.rtc.close(id, false); renderPeople(); });
    socket.on('user-moved', (d) => { const u = state.others.get(d.id); if (u) { u.x = d.x; u.y = d.y; u.dir = d.dir; } });
    socket.on('user-updated', (d) => {
      const u = d.id === state.me.id ? state.me : state.others.get(d.id);
      if (!u) return;
      Object.assign(u, d);
      renderPeople(); scheduleVideoRender(); updateToolbar();
    });
    socket.on('chat', onChat);
    socket.on('summoned', onSummoned);
    socket.on('disconnect', () => toast('サーバーとの接続が切れました。ページを再読み込みしてください。'));

    resize();
    state.cam.x = state.me.x; state.cam.y = state.me.y;
    renderPeople(); updateToolbar();
    if (autoSeat) setTimeout(goToFreeSeat, 600);
    requestAnimationFrame(loop);
    setInterval(updateLinks, 250);
  }

  function addOther(u) {
    state.others.set(u.id, { ...u, rx: u.x, ry: u.y });
    renderPeople();
  }

  // ───────── 入力 ─────────
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('keydown', (e) => {
    if (!state.me || e.target.closest('input, textarea')) return;
    if (KEYMAP[e.code]) { state.keys.add(KEYMAP[e.code]); state.path = []; state.pathSeat = null; e.preventDefault(); }
    else if (e.code === 'Space') { e.preventDefault(); toggleSit(); }
    else if (e.code === 'KeyM') toggleMic();
    else if (e.code === 'Escape') { hideMenu(); closeViewer(); }
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) state.keys.delete(KEYMAP[e.code]); });
  window.addEventListener('blur', () => state.keys.clear());

  const canvas = $('#world');
  const ctx = canvas.getContext('2d');
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.zoom = Math.max(0.6, Math.min(3, state.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, { passive: false });

  const screenToWorld = (sx, sy) => ({
    x: (sx - innerWidth / 2) / state.zoom + state.cam.x,
    y: (sy - innerHeight / 2) / state.zoom + state.cam.y,
  });

  canvas.addEventListener('click', (e) => {
    hideMenu();
    const w = screenToWorld(e.clientX, e.clientY);
    // アバターをクリック
    let hit = null;
    for (const u of state.others.values()) if (Math.hypot(u.rx - w.x, u.ry - 6 - w.y) < 16) hit = u;
    if (hit) return showUserMenu(hit, e.clientX, e.clientY);
    const tx = Math.floor(w.x / T), ty = Math.floor(w.y / T);
    if (CM.isSeat(tx, ty)) {
      if (occupiedSeats().has(CM.seatId(tx, ty))) return toast('その席は使用中です');
      walkTo(tx, ty, CM.seatId(tx, ty));
    } else {
      walkTo(tx, ty, null);
    }
  });

  function walkTo(tx, ty, seat) {
    const me = state.me;
    const p = CM.findPath(Math.floor(me.x / T), Math.floor(me.y / T), tx, ty);
    if (!p) return;
    standUp();
    state.path = p; state.pathSeat = seat;
  }

  function occupiedSeats() {
    const s = new Set();
    for (const u of state.others.values()) if (u.seat) s.add(u.seat);
    return s;
  }

  function goToFreeSeat() {
    const me = state.me;
    const teacher = me.role === 'teacher';
    const seat = CM.nearestFreeSeat(Math.floor(me.x / T), Math.floor(me.y / T), occupiedSeats(),
      teacher ? { kinds: ['t'] } : { zoneId: 'classroom', kinds: ['c'] });
    if (seat) walkTo(seat.x, seat.y, CM.seatId(seat.x, seat.y));
    else if (!teacher) toast('教室に空いている席がありません');
  }

  function toggleSit() {
    if (state.me.seat) return standUp();
    const me = state.me;
    const occ = occupiedSeats();
    const cx = Math.floor(me.x / T), cy = Math.floor(me.y / T);
    let best = null, bd = Infinity;
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (!CM.isSeat(x, y) || occ.has(CM.seatId(x, y))) continue;
      const c = CM.tileCenter(x, y), d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) return toast('近くに空いている席がありません');
    sit(CM.seatId(best.x, best.y));
  }

  function sit(seat) {
    state.socket.emit('sit', seat, (res) => {
      if (!res.ok) { toast(res.error || '座れませんでした'); return; }
      Object.assign(state.me, { seat, x: res.x, y: res.y, dir: res.dir });
      updateToolbar();
    });
  }
  function standUp() {
    if (!state.me.seat) return;
    state.me.seat = null;
    state.socket.emit('stand');
    updateToolbar();
  }

  // ───────── 移動 ─────────
  function canStand(x, y) {
    const r = 9;
    return [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]]
      .every(([px, py]) => CM.isWalkable(Math.floor(px / T), Math.floor(py / T)));
  }

  function updateMe(dt) {
    const me = state.me;
    let dx = 0, dy = 0;
    if (state.keys.has('left')) dx -= 1;
    if (state.keys.has('right')) dx += 1;
    if (state.keys.has('up')) dy -= 1;
    if (state.keys.has('down')) dy += 1;

    if (dx || dy) {
      standUp();
      const len = Math.hypot(dx, dy);
      const nx = me.x + dx / len * SPEED * dt, ny = me.y + dy / len * SPEED * dt;
      if (canStand(nx, me.y)) me.x = nx;
      if (canStand(me.x, ny)) me.y = ny;
      me.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    } else if (state.path.length) {
      const next = CM.tileCenter(state.path[0].x, state.path[0].y);
      const ex = next.x - me.x, ey = next.y - me.y, d = Math.hypot(ex, ey), step = SPEED * dt;
      if (d) me.dir = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? 'right' : 'left') : (ey > 0 ? 'down' : 'up');
      if (d <= step) { me.x = next.x; me.y = next.y; state.path.shift(); }
      else { me.x += ex / d * step; me.y += ey / d * step; }
      if (!state.path.length && state.pathSeat) { const s = state.pathSeat; state.pathSeat = null; sendMove(true); sit(s); }
    }
    sendMove(false);
  }

  function sendMove(force) {
    const me = state.me, now = performance.now();
    const key = Math.round(me.x) + ',' + Math.round(me.y) + ',' + me.dir;
    if (key === state.lastSentPos || (!force && now - state.lastSent < 60)) return;
    state.lastSent = now; state.lastSentPos = key;
    state.socket.emit('move', { x: me.x, y: me.y, dir: me.dir });
  }

  // ───────── 近接通話の判定 ─────────
  // 2人のユーザーをつなぐべきか判定し、つなぐなら音量を返す
  function linkFor(a, b, connected) {
    const za = CM.zoneAtPx(a.x, a.y), zb = CM.zoneAtPx(b.x, b.y);
    if ((za && za.type === 'quiet') || (zb && zb.type === 'quiet')) return null;
    if ((za && za.type === 'private') || (zb && zb.type === 'private')) {
      return za && zb && za.id === zb.id ? { volume: 1, reason: 'room' } : null;
    }
    if ((a.broadcast || b.broadcast) && za && zb && za.id === zb.id) return { volume: 1, reason: 'broadcast' };
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > (connected ? R_DISCONNECT : R_CONNECT)) return null;
    const v = d <= R_FULL ? 1 : Math.max(0.12, 1 - (d - R_FULL) / (R_DISCONNECT - R_FULL));
    return { volume: v, reason: 'near' };
  }

  function updateLinks() {
    const desired = new Map();
    for (const u of state.others.values()) {
      if (u.bot) continue;
      const l = linkFor(state.me, u, state.rtc.peers.has(u.id));
      if (l) desired.set(u.id, l);
    }
    state.links = desired;
    state.rtc.sync(desired);
    updateZoneInfo();
  }

  let lastZone = undefined;
  function updateZoneInfo() {
    const z = CM.zoneAtPx(state.me.x, state.me.y);
    const n = state.rtc.peers.size;
    let desc;
    if (!z) desc = '移動中';
    else if (z.type === 'private') desc = 'この部屋にいる全員と通話・画面共有できます（外には聞こえません）';
    else if (z.type === 'quiet') desc = '自習室では通話はオフになります。静かに集中しましょう';
    else desc = '近くの人と通話できます';
    $('#zone-name').textContent = (z ? z.name : '廊下') + (n ? `　🔊 ${n}人と接続中` : '');
    $('#zone-desc').textContent = desc;
    if (z && z.type === 'quiet' && lastZone !== z.id && state.media.mic) toast('自習室に入りました。通話はオフになります');
    lastZone = z ? z.id : null;
  }

  // ───────── メディア操作 ─────────
  async function toggleMic() {
    if (!state.stream.mic) {
      try {
        state.stream.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        state.rtc.setLocalTrack('audio', state.stream.mic.getAudioTracks()[0]);
        setupMicMeter(state.stream.mic);
        state.media.mic = true;
      } catch (e) { return toast('マイクを使用できません。ブラウザの設定を確認してください'); }
    } else {
      state.media.mic = !state.media.mic;
      state.stream.mic.getAudioTracks().forEach(t => { t.enabled = state.media.mic; });
    }
    sendMedia();
  }

  async function toggleCam() {
    if (state.media.cam) {
      state.stream.cam.getTracks().forEach(t => t.stop());
      state.stream.cam = null; state.media.cam = false;
      state.rtc.setLocalTrack('cam', null);
    } else {
      try {
        state.stream.cam = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, frameRate: 15 } });
        state.media.cam = true;
        state.rtc.setLocalTrack('cam', state.stream.cam.getVideoTracks()[0]);
      } catch (e) { return toast('カメラを使用できません'); }
    }
    sendMedia();
  }

  async function toggleScreen() {
    if (state.media.screen) return stopScreen();
    if (!navigator.mediaDevices.getDisplayMedia) return toast('このブラウザは画面共有に対応していません');
    try {
      state.stream.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
      const track = state.stream.screen.getVideoTracks()[0];
      try { track.contentHint = 'detail'; } catch (e) {}
      track.addEventListener('ended', stopScreen);
      state.media.screen = true;
      state.rtc.setLocalTrack('screen', track);
      sendMedia();
      const z = CM.zoneAtPx(state.me.x, state.me.y);
      if (!z || z.type !== 'private') toast('画面共有中：近くの人に表示されます。面談室に入ると部屋の全員に共有できます');
    } catch (e) { /* キャンセル */ }
  }
  function stopScreen() {
    if (!state.stream.screen) return;
    state.stream.screen.getTracks().forEach(t => t.stop());
    state.stream.screen = null; state.media.screen = false;
    state.rtc.setLocalTrack('screen', null);
    sendMedia();
  }

  function sendMedia() {
    state.me.media = { ...state.media };
    state.socket.emit('media', state.media);
    updateToolbar(); scheduleVideoRender();
  }

  function setupMicMeter(stream) {
    try {
      const ac = new AudioContext();
      const an = ac.createAnalyser(); an.fftSize = 256;
      ac.createMediaStreamSource(stream).connect(an);
      state.micAnalyser = an;
    } catch (e) {}
  }

  function updateToolbar() {
    const set = (id, on, label) => { const b = $(id); b.classList.toggle('on', on); if (label) b.querySelector('span').textContent = label; };
    const mic = $('#btn-mic');
    mic.classList.toggle('off', !state.media.mic);
    mic.firstChild.textContent = state.media.mic ? '🎤' : '🔇';
    mic.querySelector('span').textContent = state.media.mic ? 'マイク ON' : 'マイク OFF';
    set('#btn-cam', state.media.cam, state.media.cam ? 'カメラ ON' : 'カメラ');
    set('#btn-screen', state.media.screen, state.media.screen ? '共有を停止' : '画面共有');
    set('#btn-sit', !!state.me.seat, state.me.seat ? '立つ' : '座る');
    set('#btn-broadcast', !!state.me.broadcast, state.me.broadcast ? '全体に話し中' : '部屋全体に話す');
  }

  $('#btn-mic').onclick = toggleMic;
  $('#btn-cam').onclick = toggleCam;
  $('#btn-screen').onclick = toggleScreen;
  $('#btn-sit').onclick = toggleSit;
  $('#btn-broadcast').onclick = () => {
    state.me.broadcast = !state.me.broadcast;
    state.socket.emit('broadcast', state.me.broadcast);
    updateToolbar();
    if (state.me.broadcast) toast('同じ部屋にいる全員にあなたの声が届きます');
  };
  $('#btn-bots').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.top - 110, 'デモ生徒', [
      ['5人入室させる', () => state.socket.emit('demo-bots', 5)],
      ['1人入室させる', () => state.socket.emit('demo-bots', 1)],
      ['全員退室させる', () => state.socket.emit('demo-bots', 0)],
    ]);
  };

  // ───────── ビデオ表示 ─────────
  let videoRenderQueued = false;
  function scheduleVideoRender() {
    if (videoRenderQueued) return;
    videoRenderQueued = true;
    requestAnimationFrame(() => { videoRenderQueued = false; renderVideos(); });
  }

  const tileCache = new Map(); // key -> element
  function renderVideos() {
    if (!state.me) return;
    const box = $('#videos');
    const want = [];
    if (state.media.cam) want.push({ key: 'self-cam', self: true, kind: 'cam', track: state.stream.cam.getVideoTracks()[0], name: state.me.name + '（自分）' });
    if (state.media.screen) want.push({ key: 'self-screen', self: true, kind: 'screen', track: state.stream.screen.getVideoTracks()[0], name: 'あなたの画面' });
    for (const p of state.rtc.peers.values()) {
      const u = state.others.get(p.id);
      if (!u) continue;
      const media = u.media || {};
      want.push({ key: p.id + '-cam', peer: p, kind: 'cam', track: media.cam ? p.remote.cam : null, name: u.name, color: u.color });
      if (media.screen && p.remote.screen) want.push({ key: p.id + '-screen', peer: p, kind: 'screen', track: p.remote.screen, name: u.name + ' の画面' });
    }
    const keys = new Set(want.map(w => w.key));
    for (const [k, el] of tileCache) if (!keys.has(k)) { el.remove(); tileCache.delete(k); }
    for (const w of want) {
      let el = tileCache.get(w.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'vtile' + (w.kind === 'screen' ? ' screen' : '') + (w.self ? ' self' : '');
        el.innerHTML = '<video autoplay playsinline muted></video><div class="avatar"></div><div class="label"></div>';
        if (w.kind === 'screen') el.onclick = () => openViewer(w.name, el.querySelector('video').srcObject);
        tileCache.set(w.key, el);
      }
      box.appendChild(el);
      const v = el.querySelector('video'), av = el.querySelector('.avatar');
      el.querySelector('.label').textContent = w.name;
      if (w.track) {
        if (!v.srcObject || v.srcObject.getTracks()[0] !== w.track) { v.srcObject = new MediaStream([w.track]); v.play().catch(() => {}); }
        v.hidden = false; av.hidden = true;
      } else {
        v.srcObject = null; v.hidden = true; av.hidden = false;
        av.textContent = (w.name || '?').slice(0, 1);
        av.style.background = w.color || '#374151';
      }
      el.dataset.peer = w.peer ? w.peer.id : 'self';
    }
  }

  function openViewer(title, stream) {
    if (!stream) return;
    $('#viewer-title').textContent = title;
    $('#viewer-video').srcObject = stream;
    $('#viewer').hidden = false;
  }
  function closeViewer() { $('#viewer').hidden = true; $('#viewer-video').srcObject = null; }
  $('#viewer-close').onclick = closeViewer;

  // ───────── チャット・参加者 ─────────
  function openSide(tab) {
    $('#side').hidden = false;
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tab-chat').hidden = tab !== 'chat'; $('#tab-people').hidden = tab !== 'people';
    if (tab === 'chat') $('#chat-input').focus();
    $('#btn-chat').classList.remove('off');
  }
  $('#btn-chat').onclick = () => ($('#side').hidden || $('#tab-chat').hidden) ? openSide('chat') : ($('#side').hidden = true);
  $('#btn-people').onclick = () => ($('#side').hidden || $('#tab-people').hidden) ? openSide('people') : ($('#side').hidden = true);
  $('#side-close').onclick = () => { $('#side').hidden = true; };
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => openSide(b.dataset.tab));

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#chat-input').value.trim();
    if (!text) return;
    state.socket.emit('chat', { text, announce: $('#announce-check').checked });
    $('#chat-input').value = '';
  });

  function onChat(m) {
    const div = document.createElement('div');
    if (m.system) { div.className = 'msg system'; div.textContent = m.text; }
    else {
      div.className = 'msg' + (m.announce ? ' announce' : '');
      const who = document.createElement('div');
      who.className = 'who' + (m.role === 'teacher' ? ' teacher' : '');
      who.textContent = (m.announce ? '📢 ' : '') + m.name + (m.role === 'teacher' ? ' 先生' : '') + '　' + new Date(m.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const text = document.createElement('div'); text.className = 'text'; text.textContent = m.text;
      div.append(who, text);
      if (m.announce) showAnnounce(`📢 ${m.name}先生：${m.text}`);
      else if ($('#side').hidden && m.from !== state.me.id) $('#btn-chat').classList.add('off');
      // 吹き出し
      const u = m.from === state.me.id ? state.me : state.others.get(m.from);
      if (u) { u.bubble = m.text.slice(0, 40); u.bubbleUntil = performance.now() + 5000; }
    }
    const box = $('#messages');
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  let announceTimer = null;
  function showAnnounce(text) {
    const el = $('#announce');
    el.textContent = text; el.hidden = false;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { el.hidden = true; }, 8000);
  }

  function renderPeople() {
    if (!state.me) return;
    const list = [state.me, ...state.others.values()]
      .sort((a, b) => (a.role === b.role ? 0 : a.role === 'teacher' ? -1 : 1) || a.name.localeCompare(b.name, 'ja'));
    $('#people-count').textContent = list.length + '人';
    const ul = $('#people');
    ul.innerHTML = '';
    for (const u of list) {
      const li = document.createElement('li');
      const z = CM.zoneAtPx(u.x, u.y);
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = u.color;
      const name = document.createElement('span');
      name.textContent = (u.role === 'teacher' ? '👩‍🏫 ' : '') + u.name + (u.id === state.me.id ? '（自分）' : '');
      const meta = document.createElement('span'); meta.className = 'meta';
      meta.textContent = (z ? z.name.replace(/（.*）/, '') : '') + (u.seat ? '・着席' : '');
      li.append(dot, name, meta);
      if (u.id !== state.me.id) {
        const go = document.createElement('button'); go.textContent = '近くへ';
        go.onclick = () => walkNear(u);
        li.append(go);
        if (state.me.role === 'teacher' && u.role === 'student') {
          const call = document.createElement('button'); call.textContent = '呼ぶ';
          call.onclick = () => summon(u);
          li.append(call);
        }
      }
      ul.appendChild(li);
    }
  }
  setInterval(renderPeople, 3000);

  function walkNear(u) {
    const ux = Math.floor(u.x / T), uy = Math.floor(u.y / T);
    const occ = new Set([...state.others.values()].map(o => CM.seatId(Math.floor(o.x / T), Math.floor(o.y / T))));
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = ux + dx, y = uy + dy;
        if (CM.isWalkable(x, y) && !occ.has(CM.seatId(x, y)) && CM.findPath(Math.floor(state.me.x / T), Math.floor(state.me.y / T), x, y)) {
          return walkTo(x, y, null);
        }
      }
    }
  }

  function summon(u) {
    state.socket.emit('summon', u.id);
    toast(`${u.name}さんを呼びました`);
  }

  function onSummoned({ name, x, y }) {
    toast(`👩‍🏫 ${name}先生が呼んでいます`, [
      ['行く', () => walkNear({ x, y }), true],
      ['あとで', () => {}],
    ], 20000);
  }

  // ───────── メニュー・トースト ─────────
  function showMenu(x, y, title, items) {
    const m = $('#menu');
    m.innerHTML = '';
    const t = document.createElement('div'); t.className = 'title'; t.textContent = title; m.appendChild(t);
    for (const [label, fn] of items) {
      const b = document.createElement('button'); b.textContent = label;
      b.onclick = () => { hideMenu(); fn(); };
      m.appendChild(b);
    }
    m.hidden = false;
    m.style.left = Math.min(x, innerWidth - 190) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
  }
  function hideMenu() { $('#menu').hidden = true; }
  function showUserMenu(u, x, y) {
    const items = [['近くへ行く', () => walkNear(u)]];
    if (state.me.role === 'teacher' && u.role === 'student') items.push(['ここに呼ぶ', () => summon(u)]);
    const p = state.rtc.peers.get(u.id);
    if (p && u.media && u.media.screen && p.remote.screen) items.push(['画面共有を見る', () => openViewer(u.name + ' の画面', new MediaStream([p.remote.screen]))]);
    showMenu(x, y, (u.role === 'teacher' ? '👩‍🏫 ' : '') + u.name, items);
  }

  function toast(text, actions, ms = 4000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    if (actions) {
      const a = document.createElement('div'); a.className = 'actions';
      for (const [label, fn, primary] of actions) {
        const b = document.createElement('button'); b.textContent = label;
        if (primary) b.className = 'primary';
        b.onclick = () => { el.remove(); fn(); };
        a.appendChild(b);
      }
      el.appendChild(a);
    }
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ───────── 描画 ─────────
  const FLOOR = {
    classroom: ['#ead7b0', '#e2cda3'], roomA: ['#cfdcf0', '#c4d3ea'], roomB: ['#d9d0ee', '#cfc5e8'],
    study: ['#d6e8cf', '#cce0c4'], lounge: ['#f3dfcc', '#ecd5bf'], entrance: ['#dedede', '#d4d4d4'], none: ['#d8d2c8', '#d0c9be'],
  };

  const mapCanvas = document.createElement('canvas');
  (function buildMap() {
    mapCanvas.width = CM.W * T; mapCanvas.height = CM.H * T;
    const g = mapCanvas.getContext('2d');
    const floorAt = (x, y) => {
      let z = CM.zoneAt(x, y);
      if (!z) z = CM.zoneAt(x + 1, y) || CM.zoneAt(x, y + 1) || CM.zoneAt(x - 1, y) || CM.zoneAt(x, y - 1);
      return FLOOR[z ? z.id : 'none'][(x + y) % 2];
    };
    const rr = (x, y, w, h, r, color) => { g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
    for (let y = 0; y < CM.H; y++) for (let x = 0; x < CM.W; x++) {
      const ch = CM.tileAt(x, y), px = x * T, py = y * T;
      if (ch === '#' || ch === 'W' || ch === 'M') {
        g.fillStyle = '#4a3f37'; g.fillRect(px, py, T, T);
        g.fillStyle = '#5d5047'; g.fillRect(px, py + T - 8, T, 8);
        if (ch === 'W') { g.fillStyle = '#f8fafc'; g.fillRect(px, py + 6, T, T - 12); g.fillStyle = '#94a3b8'; g.fillRect(px, py + T - 8, T, 2); }
        if (ch === 'M') { g.fillStyle = '#0f172a'; g.fillRect(px + 1, py + 5, T - 2, T - 12); g.fillStyle = '#38bdf8'; g.globalAlpha = .35; g.fillRect(px + 3, py + 7, T - 6, T - 16); g.globalAlpha = 1; }
        continue;
      }
      g.fillStyle = floorAt(x, y); g.fillRect(px, py, T, T);
      switch (ch) {
        case '_': g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(px, py, T, T); break;
        case 'm': g.fillStyle = '#9b5d4b'; g.fillRect(px, py, T, T); g.fillStyle = '#b47a63'; g.fillRect(px + 3, py + 3, T - 6, T - 6); break;
        case 'D': rr(px + 1, py + 4, T - 2, T - 6, 3, '#a47148'); g.fillStyle = '#b98557'; g.fillRect(px + 3, py + 6, T - 6, T - 12);
          g.fillStyle = '#fff'; g.fillRect(px + 9, py + 10, 12, 9); break;
        case 'T': rr(px, py + 2, T, T - 4, 2, '#7c4a2d'); g.fillStyle = '#8f5a39'; g.fillRect(px + 2, py + 4, T - 4, T - 10); break;
        case 'K': rr(px, py, T, T, 0, '#c8a06e'); g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(px + 2, py + 2, T - 4, T - 4); break;
        case 'c': case 't':
          rr(px + 7, py + 7, T - 14, T - 12, 4, ch === 't' ? '#b91c1c' : '#64748b');
          rr(px + 7, py + T - 9, T - 14, 5, 2, ch === 't' ? '#7f1d1d' : '#475569'); break;
        case 'S': rr(px + 2, py + 3, T - 4, T - 6, 6, '#3f7d5f'); rr(px + 6, py + 7, T - 12, T - 14, 4, '#56a07c'); break;
        case 'P': g.fillStyle = '#8b5a3c'; g.fillRect(px + 10, py + 18, 12, 11);
          g.fillStyle = '#2f855a'; g.beginPath(); g.arc(px + 16, py + 13, 10, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#48bb78'; g.beginPath(); g.arc(px + 13, py + 10, 5, 0, Math.PI * 2); g.fill(); break;
        case 'B': g.fillStyle = '#6b4226'; g.fillRect(px, py, T, T);
          ['#e53e3e', '#3182ce', '#d69e2e', '#38a169', '#805ad5'].forEach((c, i) => { g.fillStyle = c; g.fillRect(px + 3 + i * 5, py + 4, 4, 11); g.fillRect(px + 4 + i * 5, py + 18, 4, 10); }); break;
        case 'V': rr(px + 2, py, T - 4, T - 2, 3, '#dc2626'); g.fillStyle = '#e0f2fe'; g.fillRect(px + 6, py + 4, T - 12, 12); break;
      }
    }
    // 部屋の名前
    g.font = 'bold 13px sans-serif'; g.textBaseline = 'top';
    for (const z of CM.ZONES) {
      const label = z.name + (z.type === 'quiet' ? ' 🤫' : z.type === 'private' ? ' 🔒' : '');
      const w = g.measureText(label).width + 12;
      const lx = z.id === 'classroom' ? 2 * T + 4 : (z.x1 * T + 4), ly = z.id === 'classroom' ? T + 4 : (z.y1 * T + 4);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.roundRect(lx, ly, w, 20, 6); g.fill();
      g.fillStyle = '#fff'; g.fillText(label, lx + 6, ly + 4);
    }
  })();

  function drawAvatar(u, x, y, isMe, level) {
    const seated = !!u.seat;
    const by = seated ? y - 2 : y;
    // 話している表示
    if (level > 4) {
      ctx.strokeStyle = 'rgba(34,197,94,.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, by - 6, 17 + Math.min(4, level / 6), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(x, y + 11, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    // 体
    ctx.fillStyle = u.color;
    ctx.beginPath(); ctx.roundRect(x - 9, by - 4, 18, seated ? 12 : 15, 6); ctx.fill();
    if (u.role === 'teacher') { ctx.fillStyle = '#1f2937'; ctx.fillRect(x - 1.5, by - 3, 3, 8); }
    // 頭
    ctx.fillStyle = '#f7d7b5';
    ctx.beginPath(); ctx.arc(x, by - 11, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b2a20';
    ctx.beginPath();
    if (u.dir === 'up') ctx.arc(x, by - 11, 9, 0, Math.PI * 2);
    else ctx.arc(x, by - 13, 9, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    if (u.dir !== 'up') {
      ctx.fillStyle = '#1f2937';
      const ex = u.dir === 'left' ? -3 : u.dir === 'right' ? 3 : 0;
      if (u.dir !== 'right') ctx.fillRect(x - 4 + ex, by - 10, 2, 3);
      if (u.dir !== 'left') ctx.fillRect(x + 2 + ex, by - 10, 2, 3);
    }
    // 名札
    const label = (u.role === 'teacher' ? '先生 ' : '') + u.name;
    ctx.font = 'bold 11px sans-serif';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = isMe ? 'rgba(37,99,235,.9)' : u.role === 'teacher' ? 'rgba(180,83,9,.92)' : 'rgba(17,24,39,.75)';
    ctx.beginPath(); ctx.roundRect(x - tw / 2, by - 36, tw, 15, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, by - 28.5);
    // マイクOFF / 画面共有 / 全体放送
    let icons = '';
    if (!u.bot && u.media && !u.media.mic) icons += '🔇';
    if (u.media && u.media.screen) icons += '🖥️';
    if (u.broadcast) icons += '📢';
    if (icons) { ctx.font = '11px sans-serif'; ctx.fillText(icons, x + tw / 2 + 4 + icons.length * 2, by - 28.5); }
    // チャット吹き出し
    if (u.bubble && u.bubbleUntil > performance.now()) {
      ctx.font = '12px sans-serif';
      const bw = Math.min(200, ctx.measureText(u.bubble).width + 14);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.roundRect(x - bw / 2, by - 62, bw, 22, 8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 5, by - 40.5); ctx.lineTo(x + 5, by - 40.5); ctx.lineTo(x, by - 36); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillText(u.bubble, x, by - 51, 190);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  function render() {
    const me = state.me, z = state.zoom;
    // カメラはマップの外を映さないように制限
    const clampCam = (v, view, size) => size <= view ? size / 2 : Math.max(view / 2, Math.min(size - view / 2, v));
    const tx = clampCam(me.x, innerWidth / z, CM.W * T), ty = clampCam(me.y, innerHeight / z, CM.H * T);
    state.cam.x += (tx - state.cam.x) * 0.15;
    state.cam.y += (ty - state.cam.y) * 0.15;
    ctx.fillStyle = '#2b2f3a'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.save();
    ctx.translate(innerWidth / 2, innerHeight / 2);
    ctx.scale(z, z);
    ctx.translate(-Math.round(state.cam.x), -Math.round(state.cam.y));
    ctx.drawImage(mapCanvas, 0, 0);

    // 通話範囲
    const myZone = CM.zoneAtPx(me.x, me.y);
    if (!myZone || myZone.type === 'open') {
      ctx.fillStyle = 'rgba(37,99,235,.07)'; ctx.strokeStyle = 'rgba(37,99,235,.35)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(me.x, me.y, R_CONNECT, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    } else if (myZone.type === 'private') {
      ctx.strokeStyle = 'rgba(37,99,235,.6)'; ctx.lineWidth = 3;
      ctx.strokeRect(myZone.x1 * T, myZone.y1 * T, (myZone.x2 - myZone.x1 + 1) * T, (myZone.y2 - myZone.y1 + 1) * T);
    }
    // 経路
    if (state.path.length) {
      ctx.fillStyle = 'rgba(37,99,235,.35)';
      for (const p of state.path) { ctx.beginPath(); ctx.arc((p.x + .5) * T, (p.y + .5) * T, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    // 接続中の線
    for (const p of state.rtc.peers.values()) {
      const u = state.others.get(p.id);
      if (!u) continue;
      ctx.strokeStyle = 'rgba(34,197,94,.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(u.rx, u.ry); ctx.stroke();
    }

    const list = [...state.others.values()].map(u => ({ u, x: u.rx, y: u.ry, isMe: false }));
    list.push({ u: me, x: me.x, y: me.y, isMe: true });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      const level = it.isMe ? (state.media.mic ? state.selfLevel : 0) : ((state.rtc.peers.get(it.u.id) || {}).level || 0);
      drawAvatar(it.u, it.x, it.y, it.isMe, level);
    }
    ctx.restore();
  }

  let last = performance.now();
  const micBuf = new Uint8Array(128);
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    updateMe(dt);
    for (const u of state.others.values()) {
      if (Math.hypot(u.x - u.rx, u.y - u.ry) > T * 4) { u.rx = u.x; u.ry = u.y; }
      u.rx += (u.x - u.rx) * Math.min(1, dt * 12);
      u.ry += (u.y - u.ry) * Math.min(1, dt * 12);
    }
    if (state.micAnalyser) {
      state.micAnalyser.getByteTimeDomainData(micBuf);
      let s = 0; for (const v of micBuf) s += (v - 128) * (v - 128);
      state.selfLevel = Math.sqrt(s / micBuf.length);
    }
    state.rtc.tick(1);
    // 映像タイルの発話表示
    document.querySelectorAll('.vtile').forEach(el => {
      const p = state.rtc.peers.get(el.dataset.peer);
      const lv = el.dataset.peer === 'self' ? (state.media.mic ? state.selfLevel : 0) : (p ? p.level : 0);
      el.classList.toggle('speaking', lv > 4 && !el.classList.contains('screen'));
    });
    render();
    requestAnimationFrame(loop);
  }
  // テスト・デバッグ用
  window.__vc = { state, walkTo };
})();
