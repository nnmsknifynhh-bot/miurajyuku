// マップとアバターの描画
(function () {
  const SM = window.SchoolMap;
  const T = SM.TILE;

  const FLOORS = {
    classroom: ['#e8c48f', '#e1bb84', '#c9a06a'],
    hall: ['#ebe7df', '#e4dfd5', '#d5cec2'],
    study: ['#f5e4c6', '#efdcba', '#dcc49d'],
    lobby: ['#f1ece4', '#ebe4d9', '#d8cfc1'],
    none: ['#e9e3d9', '#e2dbcf', '#d2c9bb'],
  };

  function zoneTypeNear(x, y) {
    const z = SM.zoneAt(x, y) || SM.zoneAt(x, y - 1) || SM.zoneAt(x, y + 1) || SM.zoneAt(x - 1, y) || SM.zoneAt(x + 1, y);
    return z ? z.type : 'none';
  }

  function buildMap() {
    const cv = document.createElement('canvas');
    cv.width = SM.W * T; cv.height = SM.H * T;
    const g = cv.getContext('2d');
    const rr = (x, y, w, h, r, color) => { g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
    const circle = (x, y, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };

    function floor(x, y) {
      const type = zoneTypeNear(x, y), [a, b, seam] = FLOORS[type], px = x * T, py = y * T;
      if (type === 'study') {
        // 明るい木目のフローリング（板を横にずらして並べる）
        for (let i = 0; i < 2; i++) {
          g.fillStyle = (x + y * 3 + i) % 3 === 0 ? b : a;
          g.fillRect(px, py + i * 16, T, 16);
          g.fillStyle = seam; g.fillRect(px, py + i * 16 + 15, T, 1);
          if ((x + y + i * 2) % 4 === 0) g.fillRect(px + ((y + i) % 2 ? 10 : 22), py + i * 16, 1, 15);
          g.fillStyle = 'rgba(160,110,60,.08)'; g.fillRect(px + 4, py + i * 16 + 6, 18, 1);
        }
      } else if (type === 'classroom') {
        g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(px, py, T, T);
        g.fillStyle = seam; g.fillRect(px, py + T - 1, T, 1); g.fillRect(px + ((y % 2) ? 0 : 16), py, 1, T);
      } else if (type === 'lobby') {
        g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(px, py, T, T);
        g.fillStyle = seam; g.fillRect(px, py, T, 1); g.fillRect(px, py, 1, T);
      } else {
        g.fillStyle = a; g.fillRect(px, py, T, T);
        if (y === 16 || y === 17) { g.fillStyle = b; g.fillRect(px, py, T, T); }
        g.fillStyle = seam; g.fillRect(px, py + T - 1, T, 1);
      }
    }

    function wall(x, y, ch) {
      const px = x * T, py = y * T;
      g.fillStyle = '#5b4d63'; g.fillRect(px, py, T, T);
      g.fillStyle = '#76667e'; g.fillRect(px, py + T - 10, T, 10);
      g.fillStyle = '#4a3e51'; g.fillRect(px, py + T - 11, T, 1);
      if (ch === 'w') { // 窓
        const vertical = x === 0;
        g.fillStyle = '#cfe9ff';
        if (vertical) g.fillRect(px + 8, py + 2, 16, T - 4); else g.fillRect(px + 2, py + 6, T - 4, 18);
        g.fillStyle = 'rgba(255,255,255,.7)';
        if (vertical) g.fillRect(px + 10, py + 4, 3, T - 8); else g.fillRect(px + 5, py + 8, 6, 3);
      }
      if (ch === 'W') { rr(px, py + 4, T, T - 10, 0, '#8a6038'); g.fillStyle = '#2f5d46'; g.fillRect(px, py + 7, T, T - 16); }
      if (ch === 'V') { g.fillStyle = '#2a2a33'; g.fillRect(px, py + 3, T, T - 8); g.fillStyle = '#1b2a44'; g.fillRect(px + 1, py + 5, T - 2, T - 12); }
      if (ch === 'N') { g.fillStyle = '#c8a06a'; g.fillRect(px + 1, py + 5, T - 2, T - 12);
        ['#fff', '#ffe08a', '#bfe3ff'].forEach((c, i) => { g.fillStyle = c; g.fillRect(px + 3 + i * 9, py + 8 + (i % 2) * 3, 7, 8); }); }
      if (ch === 'G') { g.fillStyle = '#bfe6f5'; g.fillRect(px + 2, py + 2, T - 4, T - 6); g.fillStyle = '#8fb9c9'; g.fillRect(px + (x % 2 ? 0 : T - 3), py + 2, 3, T - 6); }
    }

    for (let y = 0; y < SM.H; y++) for (let x = 0; x < SM.W; x++) {
      const ch = SM.tileAt(x, y), px = x * T, py = y * T;
      if ('#wWVNG'.includes(ch)) { wall(x, y, ch); continue; }
      floor(x, y);
      const zt = zoneTypeNear(x, y);
      switch (ch) {
        case '_':
          g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(px, py, T, T);
          g.fillStyle = '#b9ab95'; g.fillRect(px, py + 13, T, 6); break;
        case 'p': {
          g.fillStyle = '#c4935c'; g.fillRect(px, py, T, T);
          g.fillStyle = '#d3a56d'; g.fillRect(px, py, T, 3);
          g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(px + (y % 2 ? 8 : 24), py, 1, T);
          if (SM.tileAt(x, y + 1) !== 'p' && SM.tileAt(x, y + 1) !== 'T') { g.fillStyle = '#946638'; g.fillRect(px, py + T - 6, T, 6); }
          break;
        }
        case 'r':
          g.fillStyle = '#a9c4a2'; g.fillRect(px, py, T, T);
          g.fillStyle = '#93b18c';
          if (SM.tileAt(x - 1, y) !== 'r') g.fillRect(px + 3, py, 3, T);
          if (SM.tileAt(x + 1, y) !== 'r') g.fillRect(px + T - 6, py, 3, T);
          if (SM.tileAt(x, y - 1) !== 'r') g.fillRect(px, py + 3, T, 3);
          if (SM.tileAt(x, y + 1) !== 'r') g.fillRect(px, py + T - 6, T, 3);
          break;
        case 'm': g.fillStyle = '#8e6f5a'; g.fillRect(px, py, T, T); g.fillStyle = '#a2826b'; g.fillRect(px + 3, py + 3, T - 6, T - 6); break;
        case 'T':
          g.fillStyle = '#c4935c'; g.fillRect(px, py, T, T);
          rr(px - (SM.tileAt(x - 1, y) === 'T' ? 2 : -2), py + 4, T + 0, T - 8, 3, '#7a4b2a');
          g.fillStyle = '#8f5d37'; g.fillRect(px + 2, py + 7, T - 4, 4); break;
        case 'D':
          g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(px + 4, py + T - 5, T - 6, 4);
          rr(px + 3, py + 4, T - 6, T - 9, 4, '#c08d55');
          rr(px + 5, py + 6, T - 10, T - 13, 3, '#d6a771');
          g.fillStyle = '#fff'; g.fillRect(px + 9, py + 9, 11, 8); g.fillStyle = '#8fb4e8'; g.fillRect(px + 10, py + 10, 9, 1); break;
        case 'b': {
          // 個別ブース：木の天板＋白いパーティション＋手元ライト
          const chairBelow = SM.tileAt(x, y + 1) === 'c';
          rr(px + 2, py + (chairBelow ? 6 : 2), T - 4, T - 8, 3, '#dcb98a');
          g.fillStyle = '#e8cba0'; g.fillRect(px + 4, py + (chairBelow ? 8 : 4), T - 8, 3);
          g.fillStyle = '#fbfbf8'; g.strokeStyle = '#d8d3c8'; g.lineWidth = 1;
          const back = chairBelow ? py : py + T - 5;
          g.fillRect(px, back, T, 5); g.strokeRect(px + .5, back + .5, T - 1, 4);
          g.fillRect(px, py, 3, T); g.fillRect(px + T - 3, py, 3, T);
          g.fillStyle = '#d8d3c8'; g.fillRect(px + 3, py, 1, T); g.fillRect(px + T - 4, py, 1, T);
          circle(px + T - 9, py + (chairBelow ? 13 : 19), 3, '#ffd36b');
          g.fillStyle = '#fff'; g.fillRect(px + 8, py + (chairBelow ? 13 : 9), 9, 7);
          break;
        }
        case 'c': {
          const facing = SM.seatFacing(x, y);
          const col = zt === 'study' ? '#7aa38a' : '#5d6e88', dark = zt === 'study' ? '#5c8a6f' : '#46556b';
          rr(px + 8, py + 8, T - 16, T - 14, 5, col);
          if (facing === 'up') rr(px + 7, py + T - 10, T - 14, 6, 3, dark);
          else rr(px + 7, py + 3, T - 14, 6, 3, dark);
          if (zt === 'study') { // ブースの仕切りを椅子の横まで延ばす
            g.fillStyle = '#fbfbf8'; g.fillRect(px, py, 3, T - 8); g.fillRect(px + T - 3, py, 3, T - 8);
          }
          break;
        }
        case 'L':
          g.fillStyle = '#8fa4bd'; g.fillRect(px + 1, py + 2, T - 2, T - 4);
          g.fillStyle = '#7389a3'; g.fillRect(px + 15, py + 2, 2, T - 4);
          g.fillStyle = '#dfe6ee'; g.fillRect(px + 10, py + 14, 3, 5); g.fillRect(px + 19, py + 14, 3, 5); break;
        case 'P':
          g.fillStyle = '#c9845a'; g.fillRect(px + 10, py + 19, 12, 10);
          circle(px + 16, py + 13, 11, '#3f8f5e'); circle(px + 12, py + 10, 6, '#58b07a'); circle(px + 21, py + 14, 5, '#4ea06e'); break;
        case 'B':
          g.fillStyle = '#8b5e3c'; g.fillRect(px, py + 1, T, T - 2);
          ['#e76f51', '#2a9d8f', '#e9c46a', '#577590', '#f4a261'].forEach((c, i) => {
            g.fillStyle = c; g.fillRect(px + 3 + i * 5, py + 4, 4, 11); g.fillRect(px + 4 + i * 5, py + 18, 4, 10);
          });
          break;
        case 'k': rr(px, py + 4, T, T - 8, 0, '#c58b5a'); g.fillStyle = '#e2b285'; g.fillRect(px, py + 4, T, 5); break;
        case 'F': rr(px + 8, py + 4, 16, 24, 3, '#f4f7fb'); circle(px + 16, py + 10, 5, '#8ecae6'); break;
        case 'S': rr(px + 2, py + 8, T - 4, 16, 3, '#a7744a'); g.fillStyle = '#bf8c5f'; g.fillRect(px + 2, py + 11, T - 4, 2); g.fillRect(px + 2, py + 17, T - 4, 2); break;
      }
    }

    // 黒板の文字・スクリーン表示
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const z of SM.ZONES.filter(z => z.type === 'classroom')) {
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 12px sans-serif';
      g.fillText('きょうも いっしょに がんばろう！', (z.x1 + 6) * T, 0.45 * T);
      g.fillStyle = '#7fa6d9'; g.font = 'bold 10px sans-serif';
      g.fillText('スクリーン', (z.x1 + 12) * T, 0.45 * T);
    }
    // 自習室のやわらかい照明
    const study = SM.ZONES.find(z => z.id === 'study');
    for (const [lx, ly] of [[7, 22], [26, 22], [8, 28], [25, 28], [17, 26]]) {
      const grd = g.createRadialGradient(lx * T, ly * T, 0, lx * T, ly * T, 5 * T);
      grd.addColorStop(0, 'rgba(255,236,190,.35)'); grd.addColorStop(1, 'rgba(255,236,190,0)');
      g.fillStyle = grd;
      g.fillRect(study.x1 * T, study.y1 * T, (study.x2 - study.x1 + 1) * T, (study.y2 - study.y1 + 1) * T);
    }
    // 部屋の名前（扉の上の札と部屋の中）
    const sign = (text, cx, cy, bg) => {
      g.font = 'bold 14px sans-serif';
      const w = g.measureText(text).width + 18;
      rr(cx - w / 2, cy - 12, w, 24, 8, bg);
      g.fillStyle = '#fff'; g.fillText(text, cx, cy + 1);
    };
    sign('教室1', 15 * T, 15.5 * T, '#2f7de1'); sign('教室2', 32 * T, 15.5 * T, '#2fa36b'); sign('教室3', 49 * T, 15.5 * T, '#e07b10');
    sign('自習室', 17 * T, 18.5 * T, '#8b6b4a'); sign('ロビー', 43 * T, 18.5 * T, '#7a6f86');
    sign('🌿 自習室　しずかに集中しよう', 17 * T, 30.5 * T, 'rgba(110,85,60,.75)');
    sign('ようこそ 三浦塾へ', 43 * T, 21.5 * T, 'rgba(120,110,135,.8)');
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    return cv;
  }

  const ROLE_TAG = { owner: 'オーナー', teacher: '先生' };
  const TAG_BG = { owner: 'rgba(139,92,246,.95)', teacher: 'rgba(224,123,16,.95)', student: 'rgba(45,42,50,.78)' };

  function drawAvatar(ctx, u, x, y, opts = {}) {
    const t = opts.time || 0;
    const seated = !!u.seat;
    const bob = u.moving && !seated ? Math.sin(t * 14) * 1.5 : 0;
    const by = y + bob - (seated ? 3 : 0);

    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath(); ctx.ellipse(x, y + 12, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    // 話している人（授業の音声）
    if (opts.speaking) {
      ctx.strokeStyle = 'rgba(47,163,107,.95)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, by - 8, 21 + Math.sin(t * 10) * 1.5, 0, Math.PI * 2); ctx.stroke();
    }
    // 足
    if (!seated) {
      const step = u.moving ? Math.sin(t * 14) * 3 : 0;
      ctx.fillStyle = '#4a4458';
      ctx.fillRect(x - 6, by + 8 + step, 5, 5); ctx.fillRect(x + 1, by + 8 - step, 5, 5);
    }
    // 体
    ctx.fillStyle = u.color;
    ctx.beginPath(); ctx.roundRect(x - 10, by - 5, 20, seated ? 13 : 15, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x - 7, by - 3, 5, 3);
    if (u.role !== 'student') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 4, by - 5); ctx.lineTo(x + 4, by - 5); ctx.lineTo(x, by + 1); ctx.fill(); }
    // 頭
    ctx.fillStyle = '#fbdcc0';
    ctx.beginPath(); ctx.arc(x, by - 13, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3d2c24';
    ctx.beginPath();
    if (u.dir === 'up') ctx.arc(x, by - 13, 10.5, 0, Math.PI * 2);
    else if (u.dir === 'left') ctx.arc(x + 2, by - 15, 10, Math.PI * .8, Math.PI * 2.05);
    else if (u.dir === 'right') ctx.arc(x - 2, by - 15, 10, Math.PI * .95, Math.PI * 2.2);
    else ctx.arc(x, by - 15, 10, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();
    if (u.dir !== 'up') {
      ctx.fillStyle = '#2d2a32';
      const ex = u.dir === 'left' ? -3 : u.dir === 'right' ? 3 : 0;
      if (u.dir !== 'right') ctx.fillRect(x - 5 + ex, by - 12, 2.5, 3.5);
      if (u.dir !== 'left') ctx.fillRect(x + 2.5 + ex, by - 12, 2.5, 3.5);
      ctx.fillStyle = 'rgba(255,120,120,.35)';
      if (u.dir === 'down') { ctx.fillRect(x - 8, by - 8, 3, 2); ctx.fillRect(x + 5, by - 8, 3, 2); }
    }
    // 名札
    const tag = ROLE_TAG[u.role];
    const label = (tag ? tag + ' ' : '') + u.name;
    ctx.font = 'bold 12px sans-serif';
    const tw = Math.min(160, ctx.measureText(label).width + 12);
    ctx.fillStyle = opts.isMe ? 'rgba(47,125,225,.95)' : TAG_BG[u.role];
    ctx.beginPath(); ctx.roundRect(x - tw / 2, by - 42, tw, 17, 8.5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, by - 33, 150);
    if (opts.isMe && !u.hand) { // 自分の目印
      ctx.fillStyle = '#ffcf3d';
      const ay = by - 50 + Math.sin(t * 4) * 2;
      ctx.beginPath(); ctx.moveTo(x - 6, ay - 6); ctx.lineTo(x + 6, ay - 6); ctx.lineTo(x, ay); ctx.fill();
    }
    // 個別通話中
    if (u.inPrivate) {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = 'rgba(139,92,246,.95)';
      ctx.beginPath(); ctx.roundRect(x + tw / 2 - 2, by - 43, 24, 19, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText('🎧', x + tw / 2 + 10, by - 33);
    }
    // 挙手
    if (u.hand) {
      const hy = by - 60 + Math.sin(t * 6) * 3;
      ctx.fillStyle = '#ffcf3d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, hy, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '18px sans-serif'; ctx.fillText('✋', x, hy + 1);
    }
    // リアクション（ふわっと上がって消える）
    if (u.reaction && opts.now < u.reaction.until) {
      const k = 1 - (u.reaction.until - opts.now) / 2500;
      ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
      ctx.font = '26px sans-serif';
      ctx.fillText(u.reaction.kind, x + (u.hand ? 24 : 0), by - 62 - k * 30);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  window.Render = { buildMap, drawAvatar };
})();
