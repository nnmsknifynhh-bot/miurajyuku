// マップとアバターの描画
(function () {
  const SM = window.SchoolMap;
  const T = SM.TILE;

  const FLOORS = {
    classroom: ['#e8c48f', '#e1bb84', '#c9a06a'],
    hall: ['#ebe7df', '#e4dfd5', '#d5cec2'],
    study: ['#f5e4c6', '#efdcba', '#dcc49d'],
    cafe: ['#a47551', '#956a49', '#7d5739'],
    kids: ['#fff3d6', '#fde7c2', '#f2d6a6'], // 小学生自習室：クリーム色のチェック
    lobby: ['#f1ece4', '#ebe4d9', '#d8cfc1'],
    none: ['#e9e3d9', '#e2dbcf', '#d2c9bb'],
  };

  function zoneTypeNear(x, y) {
    const z = SM.zoneAt(x, y) || SM.zoneAt(x, y - 1) || SM.zoneAt(x, y + 1) || SM.zoneAt(x - 1, y) || SM.zoneAt(x + 1, y);
    return z ? (z.style || z.type) : 'none';
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
      } else if (type === 'cafe') {
        // 落ち着いた濃い木目（ヘリンボーン風）
        for (let i = 0; i < 4; i++) {
          const ox = ((y + i) % 2) * 8;
          g.fillStyle = (x * 3 + y + i) % 3 === 0 ? b : a;
          g.fillRect(px, py + i * 8, T, 8);
          g.fillStyle = seam; g.fillRect(px, py + i * 8 + 7, T, 1);
          g.fillRect(px + ox, py + i * 8, 1, 8); g.fillRect(px + ox + 16, py + i * 8, 1, 8);
        }
      } else if (type === 'kids') {
        // やわらかいチェックの床＋小さな水玉
        g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(px, py, T, T);
        g.fillStyle = seam; g.fillRect(px, py + T - 1, T, 1); g.fillRect(px + T - 1, py, 1, T);
        g.fillStyle = ['rgba(255,143,163,.25)', 'rgba(110,198,255,.25)', 'rgba(123,211,137,.25)'][(x * 7 + y * 3) % 3];
        g.beginPath(); g.arc(px + 16, py + 16, 2.2, 0, Math.PI * 2); g.fill();
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
        case 'r': case 'Y': if (zt === 'kids') {
          // にじ色のふちどりラグ
          const isR = (c) => c === 'r' || c === 'Y';
          g.fillStyle = '#ffe3ec'; g.fillRect(px, py, T, T);
          const cols = ['#ff8fa3', '#ffc75f', '#7bd389', '#6ec6ff', '#b79cff'];
          g.fillStyle = cols[(x + y) % 5];
          if (!isR(SM.tileAt(x - 1, y))) g.fillRect(px + 2, py, 4, T);
          if (!isR(SM.tileAt(x + 1, y))) g.fillRect(px + T - 6, py, 4, T);
          if (!isR(SM.tileAt(x, y - 1))) g.fillRect(px, py + 2, T, 4);
          if (!isR(SM.tileAt(x, y + 1))) g.fillRect(px, py + T - 6, T, 4);
          g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(px + 16, py + 16, 3, 0, Math.PI * 2); g.fill();
          break;
        } else {
          const isR = (c) => c === 'r' || c === 'Y';
          g.fillStyle = '#a9c4a2'; g.fillRect(px, py, T, T);
          g.fillStyle = '#93b18c';
          if (!isR(SM.tileAt(x - 1, y))) g.fillRect(px + 3, py, 3, T);
          if (!isR(SM.tileAt(x + 1, y))) g.fillRect(px + T - 6, py, 3, T);
          if (!isR(SM.tileAt(x, y - 1))) g.fillRect(px, py + 3, T, 3);
          if (!isR(SM.tileAt(x, y + 1))) g.fillRect(px, py + T - 6, T, 3);
          break;
        }
        case 'm': g.fillStyle = '#8e6f5a'; g.fillRect(px, py, T, T); g.fillStyle = '#a2826b'; g.fillRect(px + 3, py + 3, T - 6, T - 6); break;
        case 'T':
          g.fillStyle = '#c4935c'; g.fillRect(px, py, T, T);
          rr(px - (SM.tileAt(x - 1, y) === 'T' ? 2 : -2), py + 4, T + 0, T - 8, 3, '#7a4b2a');
          g.fillStyle = '#8f5d37'; g.fillRect(px + 2, py + 7, T - 4, 4); break;
        case 'D': if (zt === 'kids') {
          // 小学生自習室：まるい角のつくえ（となりとつなげて島に）
          const l = SM.tileAt(x - 1, y) === 'D', r = SM.tileAt(x + 1, y) === 'D';
          g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(px + (l ? 0 : 4), py + T - 6, T - (l ? 0 : 4) - (r ? 0 : 4), 4);
          rr(px + (l ? -2 : 3), py + 4, T + (l ? 2 : -3) + (r ? 2 : -3), T - 9, 7, '#f6c98e');
          rr(px + (l ? -2 : 5), py + 6, T + (l ? 2 : -5) + (r ? 2 : -5), T - 13, 5, '#ffdcaa');
          g.fillStyle = ['#ff8fa3', '#6ec6ff', '#7bd389', '#ffc75f'][(x + y) % 4]; g.fillRect(px + 9, py + 9, 11, 8); // ノート
          g.fillStyle = '#fff'; g.fillRect(px + 10, py + 10, 9, 6);
          break;
        } else {
          g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(px + 4, py + T - 5, T - 6, 4);
          rr(px + 3, py + 4, T - 6, T - 9, 4, '#c08d55');
          rr(px + 5, py + 6, T - 10, T - 13, 3, '#d6a771');
          g.fillStyle = '#fff'; g.fillRect(px + 9, py + 9, 11, 8); g.fillStyle = '#8fb4e8'; g.fillRect(px + 10, py + 10, 9, 1); break;
        }
        case 'b': if (zt === 'cafe') {
          // 窓ぎわのカウンター（一枚板）＋マグカップ
          rr(px - 1, py + 4, T + 2, T - 12, 2, '#6b4226'); g.fillStyle = '#86562f'; g.fillRect(px - 1, py + 4, T + 2, 4);
          if (x % 2) { circle(px + 22, py + 13, 4, '#f5f0e8'); circle(px + 22, py + 13, 2.4, '#6b3f22'); }
          else { g.fillStyle = '#fff'; g.fillRect(px + 6, py + 10, 10, 7); g.fillStyle = '#c9d8ea'; g.fillRect(px + 7, py + 12, 8, 1); }
          break;
        } else {
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
        case 'q': // カフェの丸テーブル
          g.fillStyle = 'rgba(0,0,0,.15)'; g.beginPath(); g.ellipse(px + 16, py + 24, 13, 4, 0, 0, Math.PI * 2); g.fill();
          circle(px + 16, py + 16, 13, '#5d3a22'); circle(px + 16, py + 15, 11.5, '#7a4b2a');
          circle(px + 11, py + 12, 3.4, '#f5f0e8'); circle(px + 11, py + 12, 2, '#6b3f22');
          g.fillStyle = '#fff'; g.fillRect(px + 15, py + 13, 8, 6); break;
        case 'c': if (zt === 'cafe') { // カフェの革張りのいす
          const facing = SM.seatFacing(x, y);
          circle(px + 16, py + 16, 9, '#8d3b2f'); circle(px + 16, py + 16, 6.5, '#a8493a');
          if (facing === 'up') rr(px + 8, py + T - 9, T - 16, 5, 2.5, '#6e2c22');
          else rr(px + 8, py + 4, T - 16, 5, 2.5, '#6e2c22');
          break;
        } else {
          const facing = SM.seatFacing(x, y);
          const KC = [['#ff8fa3', '#e86f86'], ['#ffc75f', '#e5a93c'], ['#7bd389', '#58b56c'], ['#6ec6ff', '#4aa6e0'], ['#b79cff', '#967ae6']][(x * 3 + y) % 5];
          const col = zt === 'kids' ? KC[0] : zt === 'study' ? '#7aa38a' : '#5d6e88', dark = zt === 'kids' ? KC[1] : zt === 'study' ? '#5c8a6f' : '#46556b';
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
        case 'O': { // ソファ（2人がけ。となりもソファならつなげる）
          const l = SM.tileAt(x - 1, y) === 'O', r = SM.tileAt(x + 1, y) === 'O';
          g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(px + (l ? 0 : 3), py + 26, T - (l ? 0 : 3) - (r ? 0 : 3), 4);
          rr(px + (l ? -2 : 2), py + 16, T + (l ? 2 : -2) + (r ? 2 : -2), 12, 4, '#c9867a');   // 背もたれ（手前）
          rr(px + (l ? -2 : 2), py + 6, T + (l ? 2 : -2) + (r ? 2 : -2), 14, 5, '#e3a397');    // 座面
          if (!l) rr(px + 1, py + 6, 6, 22, 3, '#b8746a');
          if (!r) rr(px + T - 7, py + 6, 6, 22, 3, '#b8746a');
          g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(px + 8, py + 9, T - 16, 2);
          break;
        }
        case 'S': rr(px + 2, py + 8, T - 4, 16, 3, '#a7744a'); g.fillStyle = '#bf8c5f'; g.fillRect(px + 2, py + 11, T - 4, 2); g.fillRect(px + 2, py + 17, T - 4, 2); break;
      }
    }

    // 黒板の文字・スクリーン表示
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // スピーキング・ライティング教室：黒板とブースの名前
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = 'bold 12px sans-serif';
    g.fillText('🎤 Speaking & ✏️ Writing Test', 7 * T, 0.45 * T);
    g.fillStyle = '#7fa6d9'; g.font = 'bold 10px sans-serif'; g.fillText('スクリーン', 13 * T, 0.45 * T);
    for (const b of SM.BOOTHS.class1) {
      g.font = 'bold 11px sans-serif'; const w = g.measureText(b.name).width + 12;
      rr((b.x + 0.5) * T - w / 2 - 22, (b.y - 0.5) * T - 8, w, 16, 6, 'rgba(224,123,16,.9)');
      g.fillStyle = '#fff'; g.fillText(b.name, (b.x + 0.5) * T - 22, (b.y - 0.5) * T + 0.5);
    }
    // カフェのカウンターのメニュー
    g.fillStyle = '#f5e6c8'; g.font = 'bold 11px sans-serif'; g.fillText('☕ Study Café', 38 * T, 1.55 * T);
    for (const z of SM.ZONES.filter(z => (z.type === 'classroom' || z.lesson) && !z.private)) {
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 12px sans-serif';
      g.fillText('きょうも いっしょに がんばろう！', (z.x1 + 6) * T, 0.45 * T);
      g.fillStyle = '#7fa6d9'; g.font = 'bold 10px sans-serif';
      g.fillText('スクリーン', (z.x1 + 12) * T, 0.45 * T);
    }
    // 高校生自習室：テーブルの上のペンダントライト（あたたかい光）
    const cafe = SM.ZONES.find(z => z.id === 'class3');
    for (const [lx, ly] of [[37.5, 6.5], [41.5, 6.5], [45.5, 6.5], [37.5, 10.5], [41.5, 10.5], [45.5, 10.5], [46, 2.2], [42, 2.2]]) {
      const grd = g.createRadialGradient(lx * T, ly * T, 0, lx * T, ly * T, 3.2 * T);
      grd.addColorStop(0, 'rgba(255,200,120,.32)'); grd.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = grd;
      g.fillRect(cafe.x1 * T, cafe.y1 * T, (cafe.x2 - cafe.x1 + 1) * T, (cafe.y2 - cafe.y1 + 1) * T);
    }
    // 小学生自習室：三角の旗（ガーランド）と、やわらかい光
    {
      const cols = ['#ff8fa3', '#ffc75f', '#7bd389', '#6ec6ff', '#b79cff'];
      g.strokeStyle = 'rgba(120,90,60,.6)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(18 * T, 3.15 * T); g.quadraticCurveTo(26 * T, 3.6 * T, 34 * T, 3.15 * T); g.stroke();
      for (let i = 0; i < 24; i++) {
        const fx = 18.4 * T + i * (15.2 * T / 24), t2 = (fx - 18 * T) / (16 * T), fy = 3.15 * T + Math.sin(t2 * Math.PI) * 0.22 * T;
        g.fillStyle = cols[i % 5]; g.beginPath(); g.moveTo(fx - 7, fy); g.lineTo(fx + 7, fy); g.lineTo(fx, fy + 12); g.closePath(); g.fill();
      }
      const kz = SM.ZONES.find(z => z.id === 'class2');
      for (const [lx, ly] of [[21, 7], [25, 7], [29, 7]]) {
        const grd = g.createRadialGradient(lx * T, ly * T, 0, lx * T, ly * T, 5 * T);
        grd.addColorStop(0, 'rgba(255,240,200,.35)'); grd.addColorStop(1, 'rgba(255,240,200,0)');
        g.fillStyle = grd; g.fillRect(kz.x1 * T, kz.y1 * T, (kz.x2 - kz.x1 + 1) * T, (kz.y2 - kz.y1 + 1) * T);
      }
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
    sign('🎤 テスト教室', 14 * T, 15.5 * T, '#2f7de1'); sign('🎒 小学生自習室', 32 * T, 15.5 * T, '#ff8a3d'); sign('高校生自習室', 49 * T, 15.5 * T, '#6d4c41');
    sign('📚 中学生自習室', 17 * T, 18.5 * T, '#8b6b4a'); sign('ロビー', 43 * T, 18.5 * T, '#7a6f86');
    sign('🌿 中学生自習室　しずかに集中しよう', 17 * T, 31.3 * T, 'rgba(110,85,60,.75)');
    sign('ようこそ 三浦塾へ', 42 * T, 21.5 * T, 'rgba(120,110,135,.8)');
    sign('🗣 面談ブース', 37 * T, 25.5 * T, 'rgba(47,125,225,.85)');
    sign('☕ 高校生自習室　自分のペースで、しっかり集中', 42 * T, 12.4 * T, 'rgba(93,58,34,.8)');
    sign('🌈 小学生自習室　たのしく しっかり がんばろう', 26 * T, 12.4 * T, 'rgba(255,138,61,.85)');
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    return cv;
  }

  const ROLE_TAG = { owner: 'オーナー', teacher: '先生', parent: '🏠' };

  // ───────── 洋服 ─────────
  function drawBody(ctx, x, by, h, u, clothes, costume) {
    const rr = (bx, byy, w, hh, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(bx, byy, w, hh, r); ctx.fill(); };
    if (costume) {
      if (costume.wings && u.dir !== 'down') { ctx.fillStyle = costume.wings; [[-1], [1]].forEach(([sd]) => { ctx.beginPath(); ctx.moveTo(x + sd * 6, by - 3); ctx.lineTo(x + sd * 18, by - 9); ctx.lineTo(x + sd * 15, by + 2); ctx.lineTo(x + sd * 18, by + 6); ctx.closePath(); ctx.fill(); }); }
      rr(x - 11, by - 5, 22, h + 1, 8, costume.body);
      if (costume.belly) rr(x - 6, by - 2, 12, h - 4, 6, costume.belly);
      if (costume.spikes && u.dir !== 'down') { ctx.fillStyle = costume.spikes; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - 3, by - 2 + i * 4); ctx.lineTo(x + 3, by - 2 + i * 4); ctx.lineTo(x, by - 7 + i * 4); ctx.fill(); } }
      return;
    }
    const C = {
      uniform: { base: '#2c3e66' }, parka: { base: u.color }, jersey: { base: '#1f5fbf' }, kimono: { base: '#d6456e' },
      dress: { base: '#f48fb1' }, tuxedo: { base: '#222' }, armor: { base: '#9aa5b1' }, hero: { base: '#e53935' },
      ninja: { base: '#26304a' }, astronaut: { base: '#eef1f5' }, king: { base: '#6a1b9a' }, suit: { base: '#2f3a4f' },
    }[clothes] || { base: u.color };
    if (clothes === 'dress') { // すそが広がる
      ctx.fillStyle = C.base; ctx.beginPath(); ctx.moveTo(x - 7, by - 5); ctx.lineTo(x + 7, by - 5); ctx.lineTo(x + 13, by + h - 1); ctx.lineTo(x - 13, by + h - 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; for (let i = -12; i <= 10; i += 4) { ctx.beginPath(); ctx.arc(x + i + 1, by + h - 1, 1.6, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    rr(x - 10, by - 5, 20, h, 7, C.base);
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x - 7, by - 3, 5, 3);
    switch (clothes) {
      case 'suit': { // スーツ：白いシャツ・ネクタイ（オーナーは紫、先生はオレンジ）・えり
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 4.5, by - 5); ctx.lineTo(x + 4.5, by - 5); ctx.lineTo(x, by + 5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = u.role === 'owner' ? '#8b5cf6' : '#e07b10';
        ctx.beginPath(); ctx.moveTo(x - 1.6, by - 5); ctx.lineTo(x + 1.6, by - 5); ctx.lineTo(x + 2, by + 3); ctx.lineTo(x, by + 5.5); ctx.lineTo(x - 2, by + 3); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#1e2635'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(x - 4.5, by - 5); ctx.lineTo(x - 1, by + 6); ctx.moveTo(x + 4.5, by - 5); ctx.lineTo(x + 1, by + 6); ctx.stroke();
        ctx.fillStyle = '#c9d2e0'; ctx.beginPath(); ctx.arc(x - 0.2, by + 7.5, 0.9, 0, Math.PI * 2); ctx.arc(x - 0.2, by + 10.5, 0.9, 0, Math.PI * 2); ctx.fill(); // ボタン
        break;
      }
      case 'uniform':
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 5, by - 5); ctx.lineTo(x + 5, by - 5); ctx.lineTo(x, by + 1); ctx.fill();
        ctx.fillStyle = '#d32f2f'; ctx.fillRect(x - 1.2, by - 4, 2.4, 6); break;
      case 'parka':
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x - 6, by + 4, 12, 3);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 2, by - 4); ctx.lineTo(x - 2, by); ctx.moveTo(x + 2, by - 4); ctx.lineTo(x + 2, by); ctx.stroke(); break;
      case 'jersey':
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 9, by - 4, 2, h - 3); ctx.fillRect(x + 7, by - 4, 2, h - 3); ctx.fillRect(x - 0.6, by - 5, 1.2, h - 2); break;
      case 'kimono':
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 5, by - 5); ctx.lineTo(x, by + 2); ctx.lineTo(x + 5, by - 5); ctx.lineTo(x + 3, by - 5); ctx.lineTo(x, by - 1); ctx.lineTo(x - 3, by - 5); ctx.fill();
        ctx.fillStyle = '#ffd54f'; ctx.fillRect(x - 10, by + 3, 20, 4);
        ctx.fillStyle = 'rgba(255,255,255,.6)'; [[-6, 8], [5, 9], [-2, -1]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.arc(x + dx, by + dy, 1.4, 0, Math.PI * 2); ctx.fill(); }); break;
      case 'tuxedo':
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 4, by - 5); ctx.lineTo(x + 4, by - 5); ctx.lineTo(x, by + 6); ctx.fill();
        ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.moveTo(x - 4, by - 5); ctx.lineTo(x, by - 3); ctx.lineTo(x - 4, by - 1); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + 4, by - 5); ctx.lineTo(x, by - 3); ctx.lineTo(x + 4, by - 1); ctx.fill(); break;
      case 'armor':
        ctx.fillStyle = '#c7d0d9'; ctx.beginPath(); ctx.arc(x - 9, by - 3, 4, 0, Math.PI * 2); ctx.arc(x + 9, by - 3, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#6d7782'; ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - 8, by + i * 4); ctx.lineTo(x + 8, by + i * 4); ctx.stroke(); } break;
      case 'hero':
        ctx.fillStyle = '#ffd54f'; ctx.beginPath(); ctx.moveTo(x, by - 3); ctx.lineTo(x + 4, by + 1); ctx.lineTo(x, by + 5); ctx.lineTo(x - 4, by + 1); ctx.fill(); break;
      case 'ninja':
        ctx.fillStyle = '#c62828'; ctx.fillRect(x - 10, by + 3, 20, 3);
        ctx.strokeStyle = '#3d4a6b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 6, by - 5); ctx.lineTo(x + 2, by + 3); ctx.moveTo(x + 6, by - 5); ctx.lineTo(x - 2, by + 3); ctx.stroke(); break;
      case 'astronaut':
        ctx.fillStyle = '#90a4ae'; ctx.fillRect(x - 10, by + 3, 20, 2);
        ctx.fillStyle = '#1e88e5'; ctx.fillRect(x - 5, by - 3, 10, 6);
        ctx.fillStyle = '#e53935'; ctx.fillRect(x - 3, by - 2, 2, 2); ctx.fillStyle = '#ffeb3b'; ctx.fillRect(x + 1, by - 2, 2, 2); break;
      case 'king':
        ctx.fillStyle = '#ffd54f'; ctx.fillRect(x - 10, by - 5, 20, 2.5); ctx.fillRect(x - 1.5, by - 5, 3, h);
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 10, by + h - 3, 20, 2.5); break;
      default:
        if (u.role !== 'student') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - 4, by - 5); ctx.lineTo(x + 4, by - 5); ctx.lineTo(x, by + 1); ctx.fill(); }
    }
  }

  // ───────── 着ぐるみ ─────────
  const COSTUMES = {
    bear: { body: '#8d6e63', belly: '#d7b899', ear: 'round', earColor: '#8d6e63', inner: '#d7b899' },
    cat: { body: '#f5a25d', belly: '#ffe0c2', ear: 'tri', earColor: '#f5a25d', inner: '#ffc1cc' },
    rabbit: { body: '#f4f4f4', belly: '#ffffff', ear: 'long', earColor: '#f4f4f4', inner: '#ffc1cc' },
    penguin: { body: '#2b2f3a', belly: '#ffffff', ear: null, earColor: '#2b2f3a', beak: true },
    panda: { body: '#ffffff', belly: '#ffffff', ear: 'round', earColor: '#222', inner: '#222', patches: true },
    dino: { body: '#5fbf6a', belly: '#d9f2c4', ear: 'spike', earColor: '#3e8e48', spikes: '#3e8e48' },
    unicorn: { body: '#ffffff', belly: '#fce4ec', ear: 'horn', earColor: '#ffd54f', mane: ['#f48fb1', '#ce93d8', '#81d4fa'] },
    dragon: { body: '#d84315', belly: '#ffcc80', ear: 'horns', earColor: '#ffd54f', spikes: '#8d2a0b', wings: '#ff7043' },
  };
  function drawHood(ctx, x, by, dir, c) {
    const hy = by - 13;
    // 耳
    ctx.fillStyle = c.earColor;
    if (c.ear === 'round') { [[-8, -8], [8, -8]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.arc(x + dx, hy + dy, 4.5, 0, Math.PI * 2); ctx.fill(); }); }
    if (c.ear === 'tri') { [[-8, 1], [8, -1]].forEach(([dx, s]) => { ctx.beginPath(); ctx.moveTo(x + dx - 4 * s - 1, hy - 6); ctx.lineTo(x + dx + 4, hy - 6); ctx.lineTo(x + dx, hy - 15); ctx.closePath(); ctx.fill(); }); }
    if (c.ear === 'long') { [[-5, -0.15], [5, 0.15]].forEach(([dx, rot]) => { ctx.save(); ctx.translate(x + dx, hy - 14); ctx.rotate(rot); ctx.beginPath(); ctx.ellipse(0, 0, 3.5, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = c.inner; ctx.beginPath(); ctx.ellipse(0, 1, 1.6, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); ctx.fillStyle = c.earColor; }); }
    if (c.ear === 'horn') { ctx.beginPath(); ctx.moveTo(x - 3, hy - 9); ctx.lineTo(x + 3, hy - 9); ctx.lineTo(x, hy - 21); ctx.fill(); ctx.strokeStyle = '#e0a800'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 2, hy - 12); ctx.lineTo(x + 2, hy - 14); ctx.moveTo(x - 1.5, hy - 16); ctx.lineTo(x + 1.5, hy - 18); ctx.stroke(); }
    if (c.ear === 'horns') { [[-7, -1], [7, 1]].forEach(([dx, s]) => { ctx.beginPath(); ctx.moveTo(x + dx - 3, hy - 7); ctx.lineTo(x + dx + 3, hy - 7); ctx.lineTo(x + dx + s * 4, hy - 17); ctx.fill(); }); }
    if (c.ear === 'spike') { for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x + i * 6 - 3, hy - 9); ctx.lineTo(x + i * 6 + 3, hy - 9); ctx.lineTo(x + i * 6, hy - 16); ctx.fill(); } }
    // フード（頭をつつむ。正面は顔が見える）
    ctx.fillStyle = c.body;
    ctx.beginPath(); ctx.arc(x, hy, 11.5, 0, Math.PI * 2); ctx.fill();
    if (dir !== 'up') {
      ctx.fillStyle = '#fbdcc0';
      ctx.beginPath(); ctx.ellipse(x + (dir === 'left' ? -2 : dir === 'right' ? 2 : 0), hy + 2, 7.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      if (c.patches) { ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(x - 4, hy + 1, 2.4, 3, 0.3, 0, Math.PI * 2); ctx.ellipse(x + 4, hy + 1, 2.4, 3, -0.3, 0, Math.PI * 2); ctx.fill(); }
      if (c.beak) { ctx.fillStyle = '#ffb300'; ctx.beginPath(); ctx.moveTo(x - 2, hy + 4); ctx.lineTo(x + 2, hy + 4); ctx.lineTo(x, hy + 7); ctx.fill(); }
    }
    if (c.mane && dir !== 'down') { c.mane.forEach((col, i) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + (dir === 'left' ? 8 : dir === 'right' ? -8 : 0) + (i - 1) * 3, hy - 8 + i * 5, 3.5, 0, Math.PI * 2); ctx.fill(); }); }
    if (c.mane && dir === 'down') { c.mane.forEach((col, i) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x - 6 + i * 6, hy - 10, 2.6, 0, Math.PI * 2); ctx.fill(); }); }
    if (c.inner && c.ear === 'round' && !c.patches) { ctx.fillStyle = c.inner; [[-8, -8], [8, -8]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.arc(x + dx, hy + dy, 2, 0, Math.PI * 2); ctx.fill(); }); }
  }
  const TAG_BG = { owner: 'rgba(139,92,246,.95)', teacher: 'rgba(224,123,16,.95)', student: 'rgba(45,42,50,.78)', parent: 'rgba(214,92,140,.92)' };

  // ───────── 髪型 ─────────
  const HAIR_BROWN = '#3d2c24', HAIR_BLACK = '#1d1a1f', HAIR_GOLD = '#f2c14e';
  const hairColor = (style) => style === 'gold' ? HAIR_GOLD : style === 'regent' || style === 'mohawk' ? HAIR_BLACK : style === 'afro' ? '#2a1d18' : HAIR_BROWN;
  // ふつうの髪（頭の上半分）
  function hairCap(ctx, x, by, dir, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (dir === 'up') ctx.arc(x, by - 13, 10.5, 0, Math.PI * 2);
    else if (dir === 'left') ctx.arc(x + 2, by - 15, 10, Math.PI * .8, Math.PI * 2.05);
    else if (dir === 'right') ctx.arc(x - 2, by - 15, 10, Math.PI * .95, Math.PI * 2.2);
    else ctx.arc(x, by - 15, 10, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();
  }
  const ell = (ctx, cx, cy, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); ctx.fill(); };
  // とがった毛（ツンツン・金髪）
  function spikes(ctx, x, by, dir, color, big) {
    ctx.fillStyle = color;
    const k = big ? 1.35 : 1;
    const tips = dir === 'left' ? [[-9, -24], [-4, -29], [2, -30], [8, -27], [12, -21]]
      : dir === 'right' ? [[9, -24], [4, -29], [-2, -30], [-8, -27], [-12, -21]]
        : [[-10, -22], [-5, -28], [0, -30], [5, -28], [10, -22]];
    ctx.beginPath();
    for (const [tx, ty] of tips) {
      const ax = x + tx * (dir === 'left' || dir === 'right' ? 1 : 1), ay = by + (ty + 13) * k - 13;
      ctx.moveTo(x + tx * 0.55 - 4, by - 19); ctx.lineTo(ax, ay); ctx.lineTo(x + tx * 0.55 + 4, by - 19);
    }
    ctx.fill();
  }
  function drawHairBack(ctx, x, by, dir, style, t) {
    const c = hairColor(style);
    ctx.fillStyle = c;
    const sway = Math.sin(t * 3) * 0.08;
    if (style === 'ponytail') {
      if (dir === 'up') { /* うしろ向きは前の層でかく */ }
      else if (dir === 'left') ell(ctx, x + 12, by - 10, 3.5, 8, -0.5 + sway);
      else if (dir === 'right') ell(ctx, x - 12, by - 10, 3.5, 8, 0.5 + sway);
      else ell(ctx, x + 10, by - 6, 3, 6.5, -0.3 + sway);
    } else if (style === 'twintail') {
      if (dir !== 'right') ell(ctx, x - 12, by - 7, 3.5, 8, 0.25 + sway);
      if (dir !== 'left') ell(ctx, x + 12, by - 7, 3.5, 8, -0.25 + sway);
    } else if (style === 'long') {
      ctx.beginPath();
      if (dir === 'left') ctx.roundRect(x - 4, by - 18, 15, 20, 5);
      else if (dir === 'right') ctx.roundRect(x - 11, by - 18, 15, 20, 5);
      else ctx.roundRect(x - 11.5, by - 18, 23, dir === 'up' ? 22 : 19, 6);
      ctx.fill();
    } else if (style === 'bob') { // ボブ：あごのあたりまで、丸く
      ctx.beginPath();
      if (dir === 'left') ctx.roundRect(x - 5, by - 23, 17, 19, 7);
      else if (dir === 'right') ctx.roundRect(x - 12, by - 23, 17, 19, 7);
      else ctx.roundRect(x - 12.5, by - 23, 25, dir === 'up' ? 20 : 18, 8);
      ctx.fill();
    } else if (style === 'afro') {
      ctx.beginPath(); ctx.arc(x, by - 17, 14.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      for (const [dx, dy] of [[-8, -8], [6, -10], [-2, -2], [9, 0]]) { ctx.beginPath(); ctx.arc(x + dx, by - 17 + dy, 3, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  function drawHairFront(ctx, x, by, dir, style, t) {
    const c = hairColor(style);
    if (style === 'mash') { // マッシュ：まゆの上でまっすぐ
      ctx.fillStyle = c; ctx.beginPath();
      if (dir === 'up') ctx.arc(x, by - 13, 11, 0, Math.PI * 2);
      else { ctx.arc(x, by - 14, 11, Math.PI, Math.PI * 2); ctx.lineTo(x + 11, by - 12); ctx.lineTo(x - 11, by - 12); ctx.closePath(); }
      ctx.fill();
      if (dir === 'left') { ctx.fillStyle = '#fbdcc0'; ell(ctx, x - 6, by - 10, 4, 3); }
      if (dir === 'right') { ctx.fillStyle = '#fbdcc0'; ell(ctx, x + 6, by - 10, 4, 3); }
      return;
    }
    if (style === 'bob') { // ボブ：まゆの上で前髪をそろえ、横はほおの横まで
      ctx.fillStyle = c; ctx.beginPath();
      if (dir === 'up') { ctx.arc(x, by - 13, 11.5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.roundRect(x - 12, by - 14, 24, 11, 5); ctx.fill(); return; }
      if (dir === 'left') { ctx.arc(x + 1, by - 14, 11, Math.PI * 0.85, Math.PI * 2.05); ctx.fill(); ctx.beginPath(); ctx.roundRect(x + 3, by - 16, 9, 13, 4); ctx.fill(); return; }
      if (dir === 'right') { ctx.arc(x - 1, by - 14, 11, Math.PI * 0.95, Math.PI * 2.15); ctx.fill(); ctx.beginPath(); ctx.roundRect(x - 12, by - 16, 9, 13, 4); ctx.fill(); return; }
      ctx.arc(x, by - 14, 11.5, Math.PI, Math.PI * 2); ctx.lineTo(x + 11.5, by - 13); ctx.lineTo(x - 11.5, by - 13); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.roundRect(x - 12.5, by - 15, 4, 12, 2); ctx.roundRect(x + 8.5, by - 15, 4, 12, 2); ctx.fill();
      return;
    }
    if (style === 'spiky' || style === 'gold') { spikes(ctx, x, by, dir, c, style === 'gold'); hairCap(ctx, x, by, dir, c); if (style === 'gold') { ctx.fillStyle = 'rgba(255,255,255,.45)'; ell(ctx, x - 4, by - 21, 2.5, 1.2, -0.4); } return; }
    if (style === 'regent') { // リーゼント：前にぐいっと
      hairCap(ctx, x, by, dir, c);
      ctx.fillStyle = c;
      if (dir === 'left') ell(ctx, x - 9, by - 23, 9, 5, -0.25);
      else if (dir === 'right') ell(ctx, x + 9, by - 23, 9, 5, 0.25);
      else if (dir === 'up') ell(ctx, x, by - 22, 8, 5);
      else { ell(ctx, x, by - 23.5, 11.5, 6.5); }
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2; ctx.beginPath();
      if (dir === 'left') ctx.arc(x - 9, by - 23, 6, Math.PI * 1.1, Math.PI * 1.6); else if (dir === 'right') ctx.arc(x + 9, by - 23, 6, Math.PI * 1.4, Math.PI * 1.9); else ctx.arc(x, by - 23.5, 8, Math.PI * 1.15, Math.PI * 1.6);
      ctx.stroke();
      return;
    }
    if (style === 'mohawk') { // モヒカン：横は短く、まん中だけ立てる
      hairCap(ctx, x, by, dir, 'rgba(60,45,40,.35)');
      ctx.fillStyle = c; ctx.beginPath();
      if (dir === 'left' || dir === 'right') { const s = dir === 'left' ? -1 : 1; for (let i = -2; i <= 2; i++) { const bx = x + i * 4 * s; ctx.moveTo(bx - 3, by - 21); ctx.lineTo(bx + s * 2, by - 31 + Math.abs(i)); ctx.lineTo(bx + 3, by - 21); } }
      else { ctx.moveTo(x - 5, by - 20); ctx.lineTo(x - 4, by - 29); ctx.lineTo(x - 1.5, by - 27); ctx.lineTo(x, by - 33); ctx.lineTo(x + 1.5, by - 27); ctx.lineTo(x + 4, by - 29); ctx.lineTo(x + 5, by - 20); }
      ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, by - 21, dir === 'left' || dir === 'right' ? 10 : 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (style === 'afro') { ctx.fillStyle = c; ctx.beginPath(); if (dir === 'up') ctx.arc(x, by - 16, 14, 0, Math.PI * 2); else ctx.arc(x, by - 17, 12.5, Math.PI * 1.02, Math.PI * 1.98); ctx.fill(); return; }
    hairCap(ctx, x, by, dir, c);
    if (style === 'long' && dir === 'down') { ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(x - 11.5, by - 15, 4, 13, 2); ctx.roundRect(x + 7.5, by - 15, 4, 13, 2); ctx.fill(); }
    if (style === 'bun') { ctx.fillStyle = c; const bx = dir === 'left' ? x + 4 : dir === 'right' ? x - 4 : x; ctx.beginPath(); ctx.arc(bx, by - 25, 5.5, 0, Math.PI * 2); ctx.fill(); }
    if (style === 'ponytail' || style === 'twintail') { // ゴム
      ctx.fillStyle = '#ff6b9a';
      if (style === 'ponytail' && dir === 'up') { ctx.fillStyle = c; ell(ctx, x, by - 4, 4, 8.5, Math.sin(t * 3) * 0.08); ctx.fillStyle = '#ff6b9a'; }
      if (style === 'ponytail') { if (dir === 'up') ell(ctx, x, by - 11, 2.8, 1.8); else if (dir === 'left') ell(ctx, x + 10, by - 15, 1.8, 1.8); else if (dir === 'right') ell(ctx, x - 10, by - 15, 1.8, 1.8); }
      else { if (dir !== 'right') ell(ctx, x - 10, by - 13, 1.8, 1.8); if (dir !== 'left') ell(ctx, x + 10, by - 13, 1.8, 1.8); }
    }
  }
  const TALL_HAIR = new Set(['spiky', 'gold', 'regent', 'mohawk', 'afro', 'bun']);

  // ───────── 高いアイテムの演出（動きは小さめ・ゆっくり。すわっているときは、もっと控えめ） ─────────
  // 周期 period 秒に1回、0〜1〜0 でふくらむ値（dur は光っている長さの割合）
  const pulse = (t, period, dur = 0.15, off = 0) => { const ph = ((t + off) % period) / period; return ph < dur ? Math.sin(ph / dur * Math.PI) : 0; };
  function sparkle(ctx, x, y, r, a, color = '#fff') { // 4本の光
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.25, y - r * 0.25); ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.25, y + r * 0.25);
    ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.25, y + r * 0.25); ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.25, y - r * 0.25); ctx.fill(); ctx.restore();
  }
  function glint(ctx, x, y, fx, period, off = 0) { const k = pulse(fx.t, period, 0.12, off); if (k > 0) sparkle(ctx, x, y, 3 + k * 4, k); }
  function drawHeadItem(ctx, item, x, by, fx) {
    const t = fx.t, hy = by - 24;
    if (item === '🌟') { // スターのかんむり：ゆっくり回って、ときどきキラッ
      ctx.save(); ctx.translate(x, hy); ctx.scale(Math.max(0.25, Math.abs(Math.cos(t * 1.2))), 1);
      ctx.font = '16px sans-serif'; ctx.fillText(item, 0, 0); ctx.restore();
      glint(ctx, x + 6, hy - 6, fx, 3);
      return;
    }
    if (item === '🌈') { // にじのわっか：頭の上に浮かぶ虹色のわっか
      const fy = by - 27 + Math.sin(t * 2) * 1.5;
      ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc'].forEach((c, i) => {
        ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(x, fy, 11 - i * 0.9, 3.6 - i * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(x, fy, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.font = '16px sans-serif'; ctx.fillText(item, x, hy);
    if (item === '💎') { // ダイヤ：光の線と小さな✨
      const k = pulse(t, 2.5, 0.2);
      if (k > 0) { ctx.save(); ctx.globalAlpha = k * 0.8; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 6 + k * 10, hy - 6); ctx.lineTo(x - 10 + k * 10, hy + 6); ctx.stroke(); ctx.restore(); }
      if (!fx.seated) for (let i = 0; i < 3; i++) { const a = pulse(t, 3, 0.25, i * 1); if (a > 0) sparkle(ctx, x + [-13, 12, 9][i], hy + [-4, -9, 6][i], 2.5 + a * 2, a, '#e3f2ff'); }
    }
  }
  // 宇宙服のヘルメット（頭のまわりのガラス）
  function helmetFx(ctx, x, by, fx) {
    ctx.save();
    ctx.fillStyle = 'rgba(180,220,255,.22)'; ctx.strokeStyle = 'rgba(220,235,255,.95)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, by - 13, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const k = pulse(fx.t, 3.5, 0.25);
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + k * 0.45})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, by - 13, 9.5, Math.PI * 1.15, Math.PI * 1.45); ctx.stroke();
    ctx.restore();
  }
  // ドラゴン：ときどき口から小さな🔥
  function dragonFx(ctx, x, by, fx) {
    if (fx.seated || fx.dir === 'up') return;
    const k = pulse(fx.t, 5, 0.18);
    if (k <= 0) return;
    const d = fx.dir === 'left' ? -1 : fx.dir === 'right' ? 1 : 0;
    ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.4); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${8 + k * 8}px sans-serif`; ctx.fillText('🔥', x + d * (12 + k * 8), by - 6 + (d ? 0 : 6 + k * 6));
    ctx.restore();
  }
  // 歩いたあとに残るもの（足元のうしろ側）
  function trailFx(ctx, x, y, fx, kind) {
    if (!fx.moving || fx.seated) return;
    const back = fx.dir === 'left' ? 1 : fx.dir === 'right' ? -1 : 0, backY = fx.dir === 'up' ? 1 : fx.dir === 'down' ? -1 : 0;
    const RB = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc'];
    for (let i = 0; i < 4; i++) {
      const ph = ((fx.t * 2 + i / 4) % 1); // 0→1 で遠ざかって消える
      const px = x + back * (6 + ph * 16) + Math.sin(i * 7 + fx.t) * 2, py = y + 8 + backY * (4 + ph * 12) - ph * 4;
      ctx.save(); ctx.globalAlpha = (1 - ph) * 0.7;
      if (kind === 'smoke') { ctx.fillStyle = '#b8b8c4'; ctx.beginPath(); ctx.arc(px, py, 3 + ph * 5, 0, Math.PI * 2); ctx.fill(); }
      else sparkle(ctx, px, py - 4, 2.5 + (1 - ph) * 2, (1 - ph) * 0.9, RB[i % RB.length]);
      ctx.restore();
    }
  }
  // ペット：高いペットは大きめ・それぞれの動き
  function drawPet(ctx, pet, x, y, moving, t, fx) {
    const hop = moving ? Math.abs(Math.sin(t * 10)) * -4 : Math.sin(t * 2) * 1;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (pet === '🦅') { // わし：肩のあたりを飛ぶ
      const fl = Math.sin(t * 6);
      ctx.translate(x + 16 + Math.sin(t * 1.3) * 3, y - 22 + fl * 2); ctx.scale(1, 0.85 + Math.abs(fl) * 0.15);
      ctx.font = '19px sans-serif'; ctx.fillText(pet, 0, 0);
    } else if (pet === '🐳') { // くじら：空中を泳いで、ときどき潮をふく
      const wx = x + 22 + Math.sin(t * 0.9) * 3, wy = y - 6 + Math.sin(t * 1.8) * 3;
      ctx.font = '19px sans-serif'; ctx.fillText(pet, wx, wy);
      const k = pulse(fx.t, 5, 0.3);
      if (k > 0 && !fx.seated) { ctx.globalAlpha = k; ctx.font = `${8 + k * 6}px sans-serif`; ctx.fillText('💦', wx - 2, wy - 12 - k * 6); }
    } else if (pet === '🦕') { // 首長りゅう：大きめで、ゆっくりついて歩く
      ctx.font = '24px sans-serif'; ctx.fillText(pet, x + 24 + Math.sin(t * 1.2) * 1.5, y + 1 + (moving ? Math.abs(Math.sin(t * 5)) * -2 : 0));
    } else if (pet === '🦚') { // くじゃく：ときどき羽を広げてキラッ
      const k = pulse(fx.t, 4.5, 0.3);
      if (k > 0) { const gr = ctx.createRadialGradient(x + 20, y + 2, 1, x + 20, y + 2, 14); gr.addColorStop(0, `rgba(80,200,160,${k * 0.6})`); gr.addColorStop(1, 'rgba(80,200,160,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x + 20, y + 2, 14, 0, Math.PI * 2); ctx.fill(); }
      ctx.translate(x + 20, y + 4 + hop); ctx.scale(1 + k * 0.35, 1 + k * 0.35);
      ctx.font = '18px sans-serif'; ctx.fillText(pet, 0, 0);
      if (k > 0.5) sparkle(ctx, 7, -9, 4, k);
    } else {
      ctx.font = pet === '🦁' ? '19px sans-serif' : '16px sans-serif'; // ライオンは少し大きめ
      ctx.fillText(pet, x + 19, y + 4 + hop);
    }
    ctx.restore();
  }
  // 手に持つアイテム：体の横に大きめに。杖（⚡・🌠）は棒の先にのせて、ときどきピカッと光る
  const STAFF = { '⚡': { glow: '255,214,10', spark: '#ffe066' }, '🌠': { glow: '180,200,255', spark: '#fff3b0' } };
  function drawHandItem(ctx, item, x, by, dir, t, seated = false) {
    const side = dir === 'left' ? 1 : -1; // 体の横
    const hx = x + side * 17, sway = Math.sin(t * 2) * 0.05;
    const st = STAFF[item];
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (item === '🏆') { // 自習王のトロフィー：金色に光って、ときどき紙ふぶき
      ctx.translate(hx, by + 2);
      const gr = ctx.createRadialGradient(0, -2, 1, 0, -2, 16); gr.addColorStop(0, `rgba(255,215,64,${0.35 + Math.sin(t * 2.5) * 0.12})`); gr.addColorStop(1, 'rgba(255,215,64,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, -2, 16, 0, Math.PI * 2); ctx.fill();
      ctx.font = '20px sans-serif'; ctx.fillText(item, 0, 0);
      const ph = (t % 6) / 6;
      if (ph < 0.25 && !seated) { const k = ph / 0.25, C = ['#ff8fb1', '#ffd43b', '#4dabf7', '#69db7c', '#b197fc'];
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ctx.globalAlpha = 1 - k; ctx.fillStyle = C[i % C.length];
          ctx.fillRect(Math.cos(a) * (6 + k * 16), -12 + Math.sin(a) * (4 + k * 8) + k * k * 14, 3, 2); } }
      ctx.restore(); return;
    }
    if (!st) { // ふつうのアイテム（剣・盾など）：1.3倍くらい
      ctx.translate(hx, by + 2); ctx.rotate(side * -0.35 + sway);
      ctx.font = '20px sans-serif'; ctx.fillText(item, 0, 0); ctx.restore(); return;
    }
    ctx.translate(hx, by + 16); ctx.rotate(side * -0.12 + sway);
    // 棒（金のふちの茶色）
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -26); ctx.stroke();
    ctx.strokeStyle = '#e0b341'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, -26); ctx.stroke();
    // ピカッ（3秒に1回・0.4秒）
    const ph = (t % 3) / 3, flash = ph < 0.13 ? Math.sin(ph / 0.13 * Math.PI) : 0;
    const top = -33;
    const glow = 0.25 + flash * 0.6;
    const gr = ctx.createRadialGradient(0, top, 1, 0, top, 14 + flash * 10);
    gr.addColorStop(0, `rgba(${st.glow},${glow})`); gr.addColorStop(1, `rgba(${st.glow},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, top, 14 + flash * 10, 0, Math.PI * 2); ctx.fill();
    if (flash > 0 && !seated) { // 火花（すわっているときは光るだけ）
      ctx.strokeStyle = st.spark; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + 0.3, r1 = 11 + flash * 4, r2 = r1 + 4 + flash * 6;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, top + Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, top + Math.sin(a) * r2); ctx.stroke();
      }
    }
    ctx.font = '20px sans-serif'; ctx.fillText(item, 0, top);
    ctx.restore();
  }
  function drawAvatar(ctx, u, x, y, opts = {}) {
    const t = opts.time || 0;
    const seated = !!u.seat;
    const eq0 = u.equip || {};
    const floaty = eq0.clothes === 'astronaut' && !seated && !eq0.costume; // 宇宙服：ふわふわ浮く
    const bob = u.moving && !seated ? Math.sin(t * 14) * 1.5 : 0;
    const by = y + bob - (seated ? 3 : 0) - (floaty ? 3 + Math.sin(t * 2.2) * 2 : 0);
    const fx = { t: t + ((u.id || 0) % 97) * 0.37, seated, moving: !!u.moving, dir: u.dir }; // 高いアイテムの演出（人ごとに少しずらす）
    // 動いたあとに残るもの（忍者の煙・ユニコーンの光）
    if (eq0.clothes === 'ninja' && !eq0.costume) trailFx(ctx, x, y, fx, 'smoke');
    if (eq0.costume === 'unicorn') trailFx(ctx, x, y, fx, 'rainbow');

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
    const eq = u.equip || {};
    const staff = u.role === 'owner' || u.role === 'teacher';
    const costume = !staff && eq.costume ? COSTUMES[eq.costume] : null;
    const clothes = staff ? (eq.clothes || 'suit') : !costume && eq.clothes ? eq.clothes : null; // 先生・オーナーはふだんスーツ（Ms. Miura の季節の衣装だけ例外）
    const bodyH = seated ? 13 : 15;
    // ヒーローのマント（体の後ろ）
    if (clothes === 'king' && u.dir !== 'down') { // 王様のマント：歩くとひらひら
      const fl = u.moving ? Math.sin(t * 9) * 3 : Math.sin(t * 1.5) * 0.8, back = u.dir === 'left' ? 1 : u.dir === 'right' ? -1 : 0;
      ctx.fillStyle = '#b71c1c'; ctx.beginPath(); ctx.moveTo(x - 10, by - 5); ctx.lineTo(x + 10, by - 5);
      ctx.quadraticCurveTo(x + 15 + back * 3, by + 5, x + 14 + back * 5 + fl, by + 14); ctx.lineTo(x - 14 + back * 5 - fl, by + 14);
      ctx.quadraticCurveTo(x - 15 + back * 3, by + 5, x - 10, by - 5); ctx.fill();
      ctx.fillStyle = '#fff'; for (let i = -12; i <= 12; i += 4) { ctx.beginPath(); ctx.arc(x + i + back * 5 + (i / 12) * fl, by + 14, 1.6, 0, Math.PI * 2); ctx.fill(); } }
    if (clothes === 'hero' && u.dir !== 'down') { ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.moveTo(x - 9, by - 4); ctx.lineTo(x + 9, by - 4); ctx.lineTo(x + 12, by + 13); ctx.lineTo(x - 12, by + 13); ctx.fill(); }
    // 髪型（頭のうしろに来る部分：ポニーテール・ツインテール・ロング・アフロ）
    const hair = !costume && eq.hair ? eq.hair : null; // 先生・オーナーも、管理画面で決めた髪型
    if (hair) drawHairBack(ctx, x, by, u.dir, hair, t);
    // 体（洋服・着ぐるみ）
    drawBody(ctx, x, by, bodyH, u, clothes, costume);
    // 頭
    ctx.fillStyle = '#fbdcc0';
    ctx.beginPath(); ctx.arc(x, by - 13, 10, 0, Math.PI * 2); ctx.fill();
    if (costume) {
      drawHood(ctx, x, by, u.dir, costume);
    } else if (hair) {
      drawHairFront(ctx, x, by, u.dir, hair, t);
    } else {
      hairCap(ctx, x, by, u.dir, '#3d2c24');
    }
    if (u.dir !== 'up') {
      ctx.fillStyle = '#2d2a32';
      const ex = u.dir === 'left' ? -3 : u.dir === 'right' ? 3 : 0;
      if (u.dir !== 'right') ctx.fillRect(x - 5 + ex, by - 12, 2.5, 3.5);
      if (u.dir !== 'left') ctx.fillRect(x + 2.5 + ex, by - 12, 2.5, 3.5);
      ctx.fillStyle = 'rgba(255,120,120,.35)';
      if (u.dir === 'down') { ctx.fillRect(x - 8, by - 8, 3, 2); ctx.fillRect(x + 5, by - 8, 3, 2); }
    }
    if (clothes === 'astronaut') helmetFx(ctx, x, by, fx);
    if (eq.costume === 'dragon') dragonFx(ctx, x, by, fx);
    if (hair === 'gold') glint(ctx, x - 3, by - 22, fx, 3, 0.5);
    // 着せかえ（眼鏡・帽子・手に持つもの・ペット）。着ぐるみのときは帽子をかくす
    if (u.equip) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000'; ctx.globalAlpha = 1; // 絵文字がうすくならないように（前に使った半とうめいの色をリセット）
      if (eq.face && u.dir !== 'up') { ctx.font = '12px sans-serif'; ctx.fillText(eq.face, x, by - 11); if (eq.face === '🎭') glint(ctx, x + 3, by - 13, fx, 4, 1.1); }
      if (eq.head && !costume) drawHeadItem(ctx, eq.head, x, by, fx);
      if (eq.hand) drawHandItem(ctx, eq.hand, x, by, u.dir, t, seated);
      if (eq.pet) drawPet(ctx, eq.pet, x, y, u.moving, t, fx);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
    // 誕生日の子が席にすわっていたら、席に🎈風船
    if (u.bday && u.seat && !opts.noTag) {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const sway = Math.sin(t * 1.6) * 2;
      ctx.strokeStyle = 'rgba(120,120,120,.7)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x + 15, y + 10); ctx.lineTo(x + 19 + sway, y - 6); ctx.moveTo(x + 15, y + 10); ctx.lineTo(x + 28 + sway, y - 1); ctx.stroke();
      ctx.font = '15px sans-serif'; ctx.fillText('🎈', x + 19 + sway, y - 13); ctx.fillText('🎈', x + 29 + sway, y - 8);
      ctx.restore();
    }
    // 🌱 小学生：すわり続けると、机の横に花が育つ（15分🌱・30分🌷・45分🌻）
    if (u.sprout && u.seat && !opts.noTag) {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.globalAlpha = 1;
      const k = Math.min(3, u.sprout), size = 12 + k * 3, sway = Math.sin(t * 1.2 + (u.id || 0)) * 0.08;
      // 小さな植木ばち
      ctx.fillStyle = '#c9784a'; ctx.beginPath(); ctx.roundRect(x - 27, y + 4, 10, 8, 2); ctx.fill();
      ctx.fillStyle = '#a85f36'; ctx.fillRect(x - 28, y + 3, 12, 3);
      ctx.translate(x - 22, y + 3); ctx.rotate(sway);
      ctx.fillStyle = '#000'; ctx.font = size + 'px sans-serif';
      ctx.fillText(['', '🌱', '🌷', '🌻'][k], 0, -size / 2);
      ctx.restore();
    }
    // 帽子・かざりをつけているときは、名札を少し上へ（アイテムがかくれないように）
    const byTag = by - ((u.equip && u.equip.head && !(u.equip.costume)) || (u.equip && u.equip.costume) ? 12 : (hair && TALL_HAIR.has(hair) ? 8 : 0));
    if (opts.noTag) return; // 招待カードなど：アバターだけ
    // 名札（連続自習の日数🔥つき）
    const tag = u.hideRole ? null : ROLE_TAG[u.role]; // Ms. Miura は「先生」をつけない
    // 高校生：称号を名前の前に、🔥は「週」で数える
    const fire = u.hs ? (u.streak >= 1 ? ` 🔥${u.streak}週` : '') : (u.streak >= 1 ? ` 🔥${u.streak}` : '');
    const label = (u.myChild ? '💗 ' : '') + (u.bday ? (u.cakes && u.cakes.n ? `🎂×${u.cakes.n}${u.cakes.gold ? '🌟' : ''} ` : '🎂 ') : '') + (tag ? tag + ' ' : '') + (u.title ? `【${u.title}】` : '') + u.name + fire + (u.asa ? ' 🌅' : '') + (u.goalDone ? ' ✅' : '');
    ctx.font = 'bold 12px sans-serif';
    const tw = Math.min(200, ctx.measureText(label).width + 12);
    ctx.fillStyle = opts.isMe ? 'rgba(47,125,225,.95)' : TAG_BG[u.role];
    if (u.bday) { // 誕生日：金色の名札
      const gr = ctx.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
      gr.addColorStop(0, '#d4a017'); gr.addColorStop(0.5, '#f5c542'); gr.addColorStop(1, '#d4a017');
      ctx.fillStyle = gr;
    }
    ctx.beginPath(); ctx.roundRect(x - tw / 2, byTag - 42, tw, 17, 8.5); ctx.fill();
    if (u.bday) { ctx.strokeStyle = '#fff6d0'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, byTag - 33, 190);
    if (opts.isMe && !u.hand) { // 自分の目印
      ctx.fillStyle = '#ffcf3d';
      const ay = byTag - 50 + Math.sin(t * 4) * 2;
      ctx.beginPath(); ctx.moveTo(x - 6, ay - 6); ctx.lineTo(x + 6, ay - 6); ctx.lineTo(x, ay); ctx.fill();
    }
    // 離席中（アプリを閉じている・別の画面を操作中）
    if (u.away) {
      ctx.font = '18px sans-serif';
      ctx.fillText('💤', x - tw / 2 - 12, byTag - 33);
    }
    // 音読・ライティング中（先生・オーナーの画面だけに届く）：名札の右に 🎤 / ✍️
    if (u.activity && !u.inPrivate) {
      const k = u.activity.kind, ic = k === 'rd-test' ? '🎤' : k === 'w-test' ? '📝' : k === 'w-practice' ? '✍️' : '📖';
      ctx.font = '13px sans-serif';
      ctx.fillStyle = /test/.test(k) ? 'rgba(220,53,69,.95)' : 'rgba(40,140,90,.95)';
      ctx.beginPath(); ctx.roundRect(x + tw / 2 - 2, byTag - 43, 24, 19, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(ic, x + tw / 2 + 10, byTag - 33);
    }
    // 個別通話中
    if (u.inPrivate) {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = 'rgba(139,92,246,.95)';
      ctx.beginPath(); ctx.roundRect(x + tw / 2 - 2, byTag - 43, 24, 19, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText('🎧', x + tw / 2 + 10, byTag - 33);
    }
    // 挙手
    if (u.hand) {
      const hy = byTag - 60 + Math.sin(t * 6) * 3;
      ctx.fillStyle = '#ffcf3d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, hy, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '18px sans-serif'; ctx.fillText('✋', x, hy + 1);
    }
    // 今日やること（高校生自習室の高校生・3つ）
    let topicH = 0;
    if (u.hs && u.plan && u.room === 'class3' && !u.topic) {
      ctx.font = 'bold 11px sans-serif';
      const lines = u.plan.map((t, i) => `${'①②③'[i]} ${t}`);
      const bw = Math.min(170, Math.max(...lines.map(l => ctx.measureText(l).width)) + 16), lh = 14, bh = lines.length * lh + 8;
      const top = byTag - 66 - bh - 4;
      ctx.fillStyle = 'rgba(255,250,240,.97)'; ctx.strokeStyle = '#b08968'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - bw / 2, top, bw, bh, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5d3a22'; ctx.textAlign = 'left';
      lines.forEach((l, i) => ctx.fillText(l, x - bw / 2 + 8, top + 4 + lh * i + lh / 2, bw - 14));
      ctx.textAlign = 'center';
      topicH = bh + 4;
    }
    // 今日の自習時間（自習室の生徒・10分単位）
    if (u.role === 'student' && SM.isStudyRoom(u.room) && typeof u.today === 'number' && !u.topic) {
      const h = Math.floor(u.today / 60), m = u.today % 60;
      const text = '📚 今日 ' + (h ? `${h}時間${m ? m + '分' : ''}` : `${m}分`);
      ctx.font = 'bold 11px sans-serif';
      const bw = ctx.measureText(text).width + 14, bh = 19, top = byTag - 66;
      void bh;
      ctx.fillStyle = 'rgba(232,245,233,.96)'; ctx.strokeStyle = '#7cb987'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - bw / 2, top, bw, bh, 9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1f5a2b'; ctx.fillText(text, x, top + bh / 2 + 1);
      topicH += 26;
    }
    // 吹き出し（先生・オーナー。生徒は先生と話すときだけ）
    if (u.topic) {
      const text = '💬 ' + u.topic;
      ctx.font = 'bold 12px sans-serif';
      const bw = Math.min(200, ctx.measureText(text).width + 16), bh = 22, top = byTag - 70;
      ctx.fillStyle = '#fffbea'; ctx.strokeStyle = '#e8c766'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - bw / 2, top, bw, bh, 9); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 6, top + bh - 0.5); ctx.lineTo(x + 6, top + bh - 0.5); ctx.lineTo(x, top + bh + 6); ctx.closePath();
      ctx.fillStyle = '#fffbea'; ctx.fill();
      ctx.strokeStyle = '#e8c766'; ctx.beginPath(); ctx.moveTo(x - 6, top + bh); ctx.lineTo(x, top + bh + 6); ctx.lineTo(x + 6, top + bh); ctx.stroke();
      ctx.fillStyle = '#4a3b00'; ctx.fillText(text, x, top + bh / 2 + 1, 190);
      topicH = 30;
    }
    // リアクション（ふわっと上がって消える）
    if (u.reaction && opts.now < u.reaction.until) {
      const k = 1 - (u.reaction.until - opts.now) / 2500;
      ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
      ctx.font = '26px sans-serif';
      ctx.fillText(u.reaction.kind, x + (u.hand ? 24 : 0), byTag - 62 - topicH - k * 30);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  // ───────── 季節 ─────────
  function seasonOf(date = new Date()) {
    const m = date.getMonth() + 1;
    return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
  }
  const FOLIAGE = {
    spring: ['#8fd27c', '#6fbf5f'], summer: ['#3f9a4f', '#2f8240'], autumn: ['#f0a03a', '#d9692b'], winter: ['#6d9a78', '#557f62'],
  };

  // 学年の木。stage: 0 芽 / 1 若葉 / 2 若木 / 3 大きな木 / 4 花 / 5 実り
  function drawTree(ctx, cx, baseY, tree, opts = {}) {
    const t = opts.time || 0, season = opts.season || seasonOf();
    const stage = tree ? tree.stage : 0;
    const [c1, c2] = FOLIAGE[season];
    const sway = Math.sin(t * 1.3) * 1.5;
    const circle = (x, y, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    ctx.save();
    // 植木鉢の土
    ctx.fillStyle = '#8a6a4f'; ctx.beginPath(); ctx.ellipse(cx, baseY, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6e523c'; ctx.beginPath(); ctx.ellipse(cx, baseY - 1, 17, 5, 0, 0, Math.PI * 2); ctx.fill();
    let canopy = null; // { x, y, r }
    if (stage === 0) { // 芽
      ctx.strokeStyle = '#5aa04a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, baseY - 2); ctx.lineTo(cx, baseY - 14); ctx.stroke();
      ctx.fillStyle = '#7cc46a';
      ctx.beginPath(); ctx.ellipse(cx - 6 + sway, baseY - 16, 7, 4, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 6 + sway, baseY - 17, 7, 4, 0.5, 0, Math.PI * 2); ctx.fill();
      canopy = { x: cx, y: baseY - 16, r: 10 };
    } else if (stage === 1) { // 若葉
      ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx, baseY - 2); ctx.lineTo(cx, baseY - 26); ctx.stroke();
      circle(cx - 8 + sway, baseY - 26, 10, c2); circle(cx + 8 + sway, baseY - 28, 10, c2); circle(cx + sway, baseY - 36, 11, c1);
      canopy = { x: cx + sway, y: baseY - 30, r: 18 };
    } else {
      const h = stage === 2 ? 40 : 56, r = stage === 2 ? 22 : 34;
      ctx.fillStyle = '#7a5434';
      ctx.beginPath(); ctx.moveTo(cx - (stage === 2 ? 5 : 8), baseY); ctx.lineTo(cx - 3, baseY - h); ctx.lineTo(cx + 3, baseY - h); ctx.lineTo(cx + (stage === 2 ? 5 : 8), baseY); ctx.fill();
      const cy = baseY - h - r * 0.55;
      const blobs = [[-0.6, 0.25, 0.65], [0.6, 0.25, 0.65], [0, -0.35, 0.75], [-0.35, -0.05, 0.6], [0.35, -0.05, 0.6]];
      for (const [dx, dy, rr] of blobs) circle(cx + dx * r + sway, cy + dy * r, rr * r, c2);
      for (const [dx, dy, rr] of blobs.slice(2)) circle(cx + dx * r * 0.8 + sway, cy + dy * r * 0.8 - 3, rr * r * 0.75, c1);
      if (season === 'winter') { // 雪が少しつもる
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath(); ctx.ellipse(cx + sway, cy - r * 0.75, r * 0.45, r * 0.13, 0, 0, Math.PI * 2); ctx.fill();
      }
      canopy = { x: cx + sway, y: cy, r };
      // 花・実（決まった位置に）
      if (stage >= 4) {
        for (let i = 0; i < 14; i++) {
          const a = i * 2.39996, d = (0.25 + ((i * 37) % 70) / 100) * r * 0.85;
          const px = canopy.x + Math.cos(a) * d, py = canopy.y + Math.sin(a) * d * 0.8;
          if (stage === 4) { circle(px, py, 3.2, '#ffc2d6'); circle(px, py, 1.3, '#ff7fa8'); }
          else { circle(px, py, 4, i % 3 ? '#e8452e' : '#f39a2b'); circle(px - 1.2, py - 1.2, 1.2, 'rgba(255,255,255,.7)'); }
        }
      }
    }
    // 目標の短冊（達成したものは⭐）
    const goals = (tree && tree.goals) || [];
    const colors = ['#ff8a80', '#ffd54f', '#81d4fa', '#a5d6a7', '#ce93d8', '#ffab91'];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    goals.slice(0, 30).forEach((g, i) => {
      const a = i * 2.39996 + 0.8, d = (0.35 + ((i * 53) % 55) / 100) * canopy.r;
      const gx = canopy.x + Math.cos(a) * d, gy = canopy.y + Math.sin(a) * d * 0.7 + 4;
      if (g.achieved) { ctx.font = '13px sans-serif'; ctx.fillText('⭐', gx, gy + Math.sin(t * 3 + i) * 1.5); }
      else {
        const swing = Math.sin(t * 2 + i) * 0.12;
        ctx.save(); ctx.translate(gx, gy - 3); ctx.rotate(swing);
        ctx.strokeStyle = 'rgba(80,60,40,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 3); ctx.stroke();
        ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(-2.5, 3, 5, 10);
        ctx.restore();
      }
    });
    // 誕生日の生徒がいる学年の木：ケーキの飾り
    if (tree && tree.birthday) {
      ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🎂', cx + 26, baseY - 4 + Math.sin(t * 2) * 1.2);
    }
    // 名札
    if (tree && opts.label !== false) {
      const label = `${tree.name}・${tree.stageName}`;
      ctx.font = 'bold 11px sans-serif';
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = opts.highlight ? 'rgba(47,125,225,.95)' : 'rgba(110,85,60,.9)';
      ctx.beginPath(); ctx.roundRect(cx - w / 2, baseY + 6, w, 16, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, cx, baseY + 14.5);
    }
    ctx.restore();
  }

  // ───────── 季節の飾り（正月・バレンタイン・卒業・入学・こどもの日・お月見・ハロウィン・クリスマス） ─────────
  // マップの決まった場所に飾る（画面に舞う演出はしない）
  // 飾り。'@' で始まるものは絵文字にないので、絵で描く
  const DECOR = {
    newyear: { banner: '🎍 あけましておめでとう 🎍', big: '🎍', items: ['@kagami', '@daruma', '🍊'], garland: ['🎍', '@daruma'] },
    winter: { banner: '❄️ 冬・雪 ❄️', big: '⛄', items: ['❄️', '⛄', '🧣'], garland: ['❄️', '✨'] },
    setsubun: { banner: '👹 鬼は外！ 福は内！ 👹', big: '👹', items: ['👹', '@mame', '@okame'], garland: ['👹', '@okame'] },
    valentine: { banner: '💝 ハッピーバレンタイン 💝', big: '💝', items: ['🍫', '💕', '🍬'], garland: ['💗', '💖'] },
    hina: { banner: '🎎 ひな祭り 🎎', big: '🎎', items: ['🎎', '🌸', '🍡'], garland: ['🌸', '🎎'] },
    whiteday: { banner: '💝 ホワイトデー 💝', big: '🎁', items: ['🎀', '🤍', '🍬'], garland: ['🎀', '🤍'] },
    graduation: { banner: '🎓 卒業おめでとう！ 🎓', big: '💐', items: ['🌸', '📜', '💐'], garland: ['🌸', '🎉'] },
    entrance: { banner: '🌸 入学おめでとう！ 🌸', big: '🌸', items: ['🎒', '🌸', '✏️'], garland: ['🌸', '🌷'] },
    hanami: { banner: '🌸 お花見 🌸', big: '🌸', items: ['🌷', '🦋', '🍡'], garland: ['🌸', '🌼'] },
    kodomo: { banner: '🎏 こどもの日 🎏', big: '🎏', items: ['🎏', '@kabuto', '🍡'], garland: ['🎏', '@kabuto'] },
    mothersday: { banner: '💐 母の日 ありがとう 💐', big: '💐', items: ['🌺', '💐', '💌'], garland: ['🌺', '💗'] },
    shinryoku: { banner: '🌿 新緑の季節 🌿', big: '🌳', items: ['🌿', '🍀', '🌱'], garland: ['🍃', '🍀'] },
    ajisai: { banner: '☔ あじさいの季節 ☔', big: '☔', items: ['@ajisai', '🐌', '☂️'], garland: ['@ajisai', '💧'] },
    tanabata: { banner: '🎋 七夕 願いがかないますように 🎋', big: '🎋', items: ['🎋', '@tanzaku', '🌌'], garland: ['⭐', '@tanzaku'] },
    summer: { banner: '🌻 夏だ！ 🌻', big: '🌻', items: ['🌊', '🍉', '🌻'], garland: ['🌻', '☀️'] },
    matsuri: { banner: '🎆 夏祭り 🎆', big: '🏮', items: ['🎆', '🏮', '🍧'], garland: ['🏮', '🎇'] },
    earlyautumn: { banner: '🍂 秋の始まり 🍂', big: '@cosmos', items: ['@cosmos', '@tombo', '🍂'], garland: ['@cosmos', '@tombo'] },
    tsukimi: { banner: '🎑 お月見 🎑', big: '🎑', items: ['🌕', '🐇', '🌾'], garland: ['🌕', '🌾'] },
    halloween: { banner: '🎃 ハッピーハロウィン 🎃', big: '🎃', items: ['👻', '🦇', '🍬'], garland: ['🎃', '🦇'] },
    koyo: { banner: '🍁 紅葉 🍁', big: '🍁', items: ['🍁', '@icho', '🍂'], garland: ['🍁', '@icho'] },
    harvest: { banner: '🌰 秋の収穫祭 🌰', big: '🍄', items: ['🌰', '🍄', '🍠'], garland: ['🌰', '🍄'] },
    christmas: { banner: '🎄 メリークリスマス 🎄', big: '🎄', items: ['🎁', '⛄', '🔔'], garland: ['⭐', '🔔'] },
    prenewyear: { banner: '🎍 よいお年を 🎍', big: '🎍', items: ['🎍', '@shimenawa', '🍊'], garland: ['🎍', '@shimenawa'] },
  };
  // 絵文字にない飾りの絵（中心 x,y・大きさ s）
  const ART = {
    kagami(c, x, y, s) { // 鏡餅
      c.fillStyle = '#c9302c'; c.fillRect(x - s * .45, y + s * .22, s * .9, s * .18);
      c.fillStyle = '#fff'; c.strokeStyle = '#ddd'; c.lineWidth = 1;
      c.beginPath(); c.ellipse(x, y + s * .12, s * .4, s * .16, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(x, y - s * .08, s * .3, s * .13, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#ff9800'; c.beginPath(); c.arc(x, y - s * .24, s * .11, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#4caf50'; c.fillRect(x - s * .02, y - s * .38, s * .05, s * .06);
    },
    daruma(c, x, y, s) { // だるま
      c.fillStyle = '#d32f2f'; c.beginPath(); c.ellipse(x, y + s * .04, s * .34, s * .4, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fbe9e7'; c.beginPath(); c.ellipse(x, y - s * .08, s * .2, s * .17, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#222'; c.beginPath(); c.arc(x - s * .08, y - s * .1, s * .04, 0, Math.PI * 2); c.arc(x + s * .08, y - s * .1, s * .04, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffca28'; c.fillRect(x - s * .12, y + s * .2, s * .24, s * .06);
    },
    mame(c, x, y, s) { // 枡と福豆
      c.fillStyle = '#d7b47a'; c.fillRect(x - s * .32, y - s * .05, s * .64, s * .36);
      c.strokeStyle = '#a07b3f'; c.lineWidth = 1.5; c.strokeRect(x - s * .32, y - s * .05, s * .64, s * .36);
      c.fillStyle = '#f0d9a8'; [[-.16, -.1], [0, -.14], [.16, -.1], [-.08, -.2], [.08, -.2]].forEach(([dx, dy]) => { c.beginPath(); c.arc(x + dx * s, y + dy * s, s * .08, 0, Math.PI * 2); c.fill(); });
    },
    okame(c, x, y, s) { // おかめ
      c.fillStyle = '#222'; c.beginPath(); c.arc(x, y - s * .06, s * .4, Math.PI, 0); c.fill();
      c.fillStyle = '#fff6ec'; c.beginPath(); c.ellipse(x, y + s * .04, s * .34, s * .36, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(244,143,177,.8)'; c.beginPath(); c.arc(x - s * .18, y + s * .12, s * .08, 0, Math.PI * 2); c.arc(x + s * .18, y + s * .12, s * .08, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#222'; c.lineWidth = 1.5; c.beginPath(); c.arc(x - s * .1, y, s * .05, Math.PI, 0); c.moveTo(x + s * .15, y); c.arc(x + s * .1, y, s * .05, 0, Math.PI, true); c.stroke();
      c.fillStyle = '#d32f2f'; c.beginPath(); c.arc(x, y + s * .2, s * .04, 0, Math.PI * 2); c.fill();
    },
    kabuto(c, x, y, s) { // かぶと
      c.fillStyle = '#1e3a5f'; c.beginPath(); c.arc(x, y + s * .1, s * .3, Math.PI, 0); c.fill();
      c.fillRect(x - s * .42, y + s * .1, s * .84, s * .12);
      c.fillStyle = '#ffc107'; c.beginPath(); c.moveTo(x - s * .05, y - s * .1); c.lineTo(x - s * .35, y - s * .42); c.lineTo(x - s * .15, y - s * .12); c.fill();
      c.beginPath(); c.moveTo(x + s * .05, y - s * .1); c.lineTo(x + s * .35, y - s * .42); c.lineTo(x + s * .15, y - s * .12); c.fill();
      c.beginPath(); c.arc(x, y - s * .08, s * .07, 0, Math.PI * 2); c.fill();
    },
    ajisai(c, x, y, s) { // あじさい
      c.fillStyle = '#4caf50'; c.beginPath(); c.ellipse(x - s * .25, y + s * .25, s * .18, s * .08, -.5, 0, Math.PI * 2); c.fill();
      const cols = ['#7e57c2', '#5c6bc0', '#ab47bc', '#42a5f5'];
      for (let i = 0; i < 13; i++) { const a = i * 2.4, r = s * .26 * Math.sqrt(i / 13); c.fillStyle = cols[i % 4]; c.beginPath(); c.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, s * .1, 0, Math.PI * 2); c.fill(); }
    },
    tanzaku(c, x, y, s) { // 短冊
      [['#e53935', -.2, -.15], ['#fdd835', 0, 0], ['#1e88e5', .2, -.1]].forEach(([col, dx, rot]) => { c.save(); c.translate(x + dx * s, y); c.rotate(rot); c.fillStyle = col; c.fillRect(-s * .07, -s * .32, s * .14, s * .64); c.restore(); });
    },
    cosmos(c, x, y, s) { // コスモス
      c.fillStyle = '#f48fb1'; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.beginPath(); c.ellipse(x + Math.cos(a) * s * .2, y + Math.sin(a) * s * .2, s * .14, s * .07, a, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#ffca28'; c.beginPath(); c.arc(x, y, s * .08, 0, Math.PI * 2); c.fill();
    },
    tombo(c, x, y, s) { // とんぼ
      c.fillStyle = 'rgba(200,230,255,.85)'; [[-.18, -.08, -.3], [.18, -.08, .3], [-.16, .06, .3], [.16, .06, -.3]].forEach(([dx, dy, r]) => { c.beginPath(); c.ellipse(x + dx * s, y + dy * s, s * .18, s * .06, r, 0, Math.PI * 2); c.fill(); });
      c.fillStyle = '#e65100'; c.fillRect(x - s * .03, y - s * .12, s * .06, s * .45);
      c.beginPath(); c.arc(x, y - s * .14, s * .06, 0, Math.PI * 2); c.fill();
    },
    icho(c, x, y, s) { // いちょう
      c.fillStyle = '#fbc02d'; c.beginPath(); c.moveTo(x, y + s * .15); c.arc(x, y + s * .15, s * .35, Math.PI * 1.15, Math.PI * 1.85); c.closePath(); c.fill();
      c.strokeStyle = '#a07b00'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y + s * .15); c.lineTo(x, y + s * .35); c.stroke();
    },
    shimenawa(c, x, y, s) { // しめ縄
      c.strokeStyle = '#c8a24a'; c.lineWidth = s * .12; c.beginPath(); c.moveTo(x - s * .4, y - s * .15); c.quadraticCurveTo(x, y + s * .05, x + s * .4, y - s * .15); c.stroke();
      c.fillStyle = '#fff'; c.strokeStyle = '#ccc'; c.lineWidth = 1;
      [-.2, .2].forEach(dx => { c.beginPath(); c.moveTo(x + dx * s - s * .06, y - s * .02); c.lineTo(x + dx * s + s * .06, y + s * .06); c.lineTo(x + dx * s - s * .06, y + s * .14); c.lineTo(x + dx * s + s * .06, y + s * .24); c.lineTo(x + dx * s - s * .02, y + s * .24); c.lineTo(x + dx * s - s * .12, y + s * .14); c.closePath(); c.fill(); c.stroke(); });
    },
  };
  // 飾りを1つ置く（絵文字は文字で、@ は絵で）
  function put(ctx, token, x, y, size) {
    if (token[0] === '@') { const f = ART[token.slice(1)]; if (f) { ctx.save(); f(ctx, x, y, size * 1.4); ctx.restore(); } return; }
    ctx.font = `${size}px sans-serif`; ctx.fillText(token, x, y);
  }
  function drawDecorations(ctx, eventId, time) {
    const d = DECOR[eventId];
    if (!d) return;
    const T = SM.TILE, t = time / 1000;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sign = (text, cx, cy) => {
      ctx.font = 'bold 14px sans-serif';
      const w = ctx.measureText(text).width + 24;
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = '#e07b10'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - 13, w, 26, 13); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5a3b00'; ctx.fillText(text, cx, cy + 1);
    };
    // ロビー：大きな飾り（入口の両側）と横断幕
    put(ctx, d.big, 40.5 * T, 21 * T, 40); put(ctx, d.big, 45.5 * T, 21 * T, 40);
    d.items.forEach((e, i) => put(ctx, e, (37 + i) * T, 22.4 * T + Math.sin(t * 2 + i) * 1.5, 22));
    d.items.forEach((e, i) => put(ctx, e, (41 + i) * T, 25.2 * T + Math.sin(t * 2 + i + 1) * 1.5, 22));
    sign(d.banner, 43 * T, 27 * T);
    // ろうか：飾りの列（上の壁ぞい）
    for (let x = 3, i = 0; x <= 48; x += 3, i++) put(ctx, d.garland[i % d.garland.length], x * T, 15.25 * T + Math.sin(t * 1.5 + i) * 1.2, 16);
    sign(d.banner, 25 * T, 17 * T);
    // 自習室：木のそば
    put(ctx, d.big, 14.5 * T, 23 * T, 24); put(ctx, d.items[0], 19.5 * T, 28 * T, 24);
    ctx.restore();
  }

  // 🎅 がんばりサンタ：うしろについて歩くサンタ（赤い服）とトナカイ
  function drawFollower(ctx, kind, x, y, t) {
    const hop = Math.abs(Math.sin(t * 6 + (kind === 'santa' ? 0 : 1.3))) * 2;
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(x, y + 11, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (kind === 'santa') {
      ctx.fillStyle = '#d63a3a'; ctx.beginPath(); ctx.roundRect(x - 8, y - 4 - hop, 16, 14, 6); ctx.fill(); // 赤い服
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 8, y + 3 - hop, 16, 2.5);                                  // 白いふち
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x - 8, y + 1 - hop, 16, 1.6);                               // ベルト
      ctx.font = '17px sans-serif'; ctx.fillText('🎅', x, y - 11 - hop);
    } else if (HINA[kind]) { // 🎎 ひな人形（おだいりさま・おひなさま・三人官女・五人囃子）
      drawHina(ctx, kind, x, y - hop, t);
    } else if (kind === 'hikoboshi' || kind === 'orihime') { // 彦星（青い着物）・織姫（桃色の着物と羽衣）
      const yy = y - hop, hiko = kind === 'hikoboshi';
      if (!hiko) { // 羽衣（ふわっとした帯）
        ctx.strokeStyle = 'rgba(255,190,220,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 12, yy + 2); ctx.quadraticCurveTo(x, yy - 14 + Math.sin(t * 3) * 2, x + 12, yy + 2); ctx.stroke();
      }
      ctx.fillStyle = hiko ? '#3b6fd1' : '#f07fae'; // 着物
      ctx.beginPath(); ctx.moveTo(x - 9, yy + 10); ctx.lineTo(x - 6, yy - 4); ctx.lineTo(x + 6, yy - 4); ctx.lineTo(x + 9, yy + 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = hiko ? '#f5d34f' : '#ffe680'; ctx.fillRect(x - 6.5, yy + 1, 13, 2.4); // 帯
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 3, yy - 4); ctx.lineTo(x, yy); ctx.lineTo(x + 3, yy - 4); ctx.stroke(); // えり
      ctx.fillStyle = '#fbe0c8'; ctx.beginPath(); ctx.arc(x, yy - 9, 5.5, 0, Math.PI * 2); ctx.fill(); // 顔
      ctx.fillStyle = '#2b2230'; // かみ
      if (hiko) { ctx.beginPath(); ctx.arc(x, yy - 11, 5.6, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.arc(x, yy - 17, 2.3, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(x, yy - 11, 5.8, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.arc(x - 4, yy - 16, 2.6, 0, Math.PI * 2); ctx.arc(x + 4, yy - 16, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x + 5, yy - 13, 1.4, 0, Math.PI * 2); ctx.fill(); } // かんざし
      ctx.fillStyle = '#2b2230'; ctx.fillRect(x - 2.6, yy - 9, 1.2, 1.4); ctx.fillRect(x + 1.4, yy - 9, 1.2, 1.4); // 目
    } else { // トナカイ（どの端末でも同じに見えるよう、絵文字ではなく自分でかく）
      const yy = y - hop;
      ctx.strokeStyle = '#7a4a22'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); // つの
      ctx.moveTo(x + 3, yy - 13); ctx.lineTo(x + 1, yy - 20); ctx.moveTo(x + 2, yy - 17); ctx.lineTo(x - 2, yy - 19);
      ctx.moveTo(x + 7, yy - 13); ctx.lineTo(x + 9, yy - 20); ctx.moveTo(x + 8, yy - 17); ctx.lineTo(x + 12, yy - 19);
      ctx.stroke();
      ctx.fillStyle = '#a0683a'; // 体と足
      ctx.beginPath(); ctx.ellipse(x - 2, yy + 2, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 8, yy + 5, 2.4, 6); ctx.fillRect(x + 3, yy + 5, 2.4, 6);
      ctx.beginPath(); ctx.ellipse(x + 5, yy - 8, 5.5, 5, 0, 0, Math.PI * 2); ctx.fill(); // 頭
      ctx.fillStyle = '#e8c9a0'; ctx.beginPath(); ctx.ellipse(x - 3, yy + 3, 5, 3, 0, 0, Math.PI * 2); ctx.fill(); // おなか
      ctx.fillStyle = '#2b1d14'; ctx.beginPath(); ctx.arc(x + 6, yy - 9, 1, 0, Math.PI * 2); ctx.fill(); // 目
      ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(x + 10, yy - 7, 2.2, 0, Math.PI * 2); ctx.fill(); // 赤い鼻
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  // 🪟 季節と時間で変わる窓：朝焼け・昼・夕焼け・夜空、春は桜・夏は入道雲・秋は紅葉・冬は雪
  let WINDOWS = null;
  function windowRects() {
    if (WINDOWS) return WINDOWS;
    WINDOWS = [];
    for (let y = 0; y < SM.H; y++) for (let x = 0; x < SM.W; x++) if (SM.tileAt(x, y) === 'w') {
      const px = x * T, py = y * T;
      WINDOWS.push(x === 0 ? { x: px + 8, y: py + 2, w: 16, h: T - 4, i: x * 7 + y * 13 } : { x: px + 2, y: py + 6, w: T - 4, h: 18, i: x * 7 + y * 13 });
    }
    return WINDOWS;
  }
  function skyNow() {
    if (window.__sky) return window.__sky; // 画面の確認用
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', month: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false });
    const o = Object.fromEntries(f.formatToParts(new Date()).map(p => [p.type, p.value]));
    const h = (Number(o.hour) % 24) + Number(o.minute) / 60, m = Number(o.month);
    const time = h >= 5 && h < 7 ? 'dawn' : h >= 7 && h < 16 ? 'day' : h >= 16 && h < 18.5 ? 'dusk' : 'night';
    const season = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
    return { time, season };
  }
  const SKY = { dawn: ['#ffb38a', '#ffe0b8'], day: ['#6fbaf5', '#cfe9ff'], dusk: ['#ff8a5c', '#ffc79a'], night: ['#16224a', '#2e3f7a'] };
  function drawWindows(ctx, t, view) {
    const sk = skyNow(), [top, bottom] = SKY[sk.time];
    for (const r of windowRects()) {
      if (view && (r.x > view.x2 || r.x + r.w < view.x1 || r.y > view.y2 || r.y + r.h < view.y1)) continue;
      const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h); g.addColorStop(0, top); g.addColorStop(1, bottom);
      ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      const k = r.i;
      if (sk.time === 'night') { // 星と月
        for (let j = 0; j < 4; j++) { const tw = (Math.sin(t * 2 + k + j * 1.9) + 1) / 2; ctx.fillStyle = `rgba(255,255,220,${0.35 + tw * 0.65})`; ctx.fillRect(r.x + ((k * 5 + j * 7) % (r.w - 2)) + 1, r.y + ((k * 3 + j * 5) % (r.h - 2)) + 1, 1.4, 1.4); }
        if (k % 9 === 0) { ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(r.x + r.w * 0.7, r.y + r.h * 0.35, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = top; ctx.beginPath(); ctx.arc(r.x + r.w * 0.7 + 1.6, r.y + r.h * 0.35 - 1, 2.8, 0, Math.PI * 2); ctx.fill(); }
      } else if (sk.time === 'day') { // 雲
        const cx = r.x + ((t * 3 + k * 11) % (r.w + 16)) - 8, cy = r.y + 5 + (k % 3) * 3;
        ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.arc(cx + 3.5, cy - 1, 3.6, 0, Math.PI * 2); ctx.arc(cx + 7, cy, 2.8, 0, Math.PI * 2); ctx.fill();
      } else { // 朝焼け・夕焼けの太陽
        if (k % 5 === 0) { ctx.fillStyle = sk.time === 'dawn' ? 'rgba(255,240,180,.95)' : 'rgba(255,200,120,.95)'; ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h - 2, 4, 0, Math.PI * 2); ctx.fill(); }
      }
      // 季節のもの
      if (sk.season === 'spring') for (let j = 0; j < 2; j++) { const px = r.x + ((k * 7 + j * 13 + t * 6) % r.w), py = r.y + ((t * 8 + k * 5 + j * 9) % r.h); ctx.fillStyle = '#ffc4d8'; ctx.beginPath(); ctx.ellipse(px, py, 1.6, 1, t + j, 0, Math.PI * 2); ctx.fill(); }
      if (sk.season === 'autumn') for (let j = 0; j < 2; j++) { const px = r.x + ((k * 5 + j * 11 + t * 4) % r.w), py = r.y + ((t * 6 + k * 7 + j * 9) % r.h); ctx.fillStyle = j ? '#e8662f' : '#f2b233'; ctx.beginPath(); ctx.ellipse(px, py, 1.7, 1.1, t * 2 + j, 0, Math.PI * 2); ctx.fill(); }
      if (sk.season === 'winter') for (let j = 0; j < 3; j++) { const px = r.x + ((k * 5 + j * 7) % r.w) + Math.sin(t + j) * 1.5, py = r.y + ((t * 7 + k * 3 + j * 6) % r.h); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 0.9, 0, Math.PI * 2); ctx.fill(); }
      if (sk.season === 'summer' && sk.time !== 'night' && k % 4 === 0) { ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(r.x + 6, r.y + r.h - 1, 4, Math.PI, 0); ctx.arc(r.x + 11, r.y + r.h - 3, 4.5, Math.PI, 0); ctx.fill(); } // 入道雲
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; if (r.w > r.h) ctx.fillRect(r.x + 3, r.y + 2, 6, 2); else ctx.fillRect(r.x + 2, r.y + 2, 2, 6); // ガラスの光
    }
  }

  // 📝 先生の黒板（ロビーの掲示板の場所）
  const BOARD = { x: 36 * T + 1, y: 19 * T + 2, w: 4 * T - 2, h: T + 20 };
  function drawBoard(ctx, board) {
    const b = BOARD;
    ctx.fillStyle = '#8a6038'; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 3); ctx.fill(); // 木のわく
    ctx.fillStyle = '#2f5d46'; ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 9);
    ctx.fillStyle = '#c9b48a'; ctx.fillRect(b.x + 6, b.y + b.h - 6, b.w - 12, 3); // チョーク置き
    ctx.fillStyle = '#fff'; ctx.fillRect(b.x + b.w - 22, b.y + b.h - 8, 7, 2); ctx.fillStyle = '#ffd1dc'; ctx.fillRect(b.x + b.w - 13, b.y + b.h - 8, 6, 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (!board) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = 'bold 8px sans-serif'; ctx.fillText('📝 先生の黒板', b.x + b.w / 2, b.y + b.h / 2 - 2); }
    else {
      // 1行9文字くらいで、3行まで
      const chars = [...board.text], lines = [];
      for (let i = 0; i < chars.length && lines.length < 3; i += 11) lines.push(chars.slice(i, i + 11).join(''));
      if (chars.length > 33) lines[2] = lines[2].slice(0, 10) + '…';
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.font = 'bold 9.5px sans-serif';
      const lh = 11, y0 = b.y + 3 + (b.h - 9) / 2 - (lines.length - 1) * lh / 2;
      lines.forEach((ln, i) => ctx.fillText(ln, b.x + b.w / 2, y0 + i * lh));
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  const inBoard = (wx, wy) => wx >= BOARD.x && wx <= BOARD.x + BOARD.w && wy >= BOARD.y && wy <= BOARD.y + BOARD.h;

  // 🌅 今日の朝活 成功者（ロビーの上の壁、入口の右）
  const MORNING = { x: 44 * T + 4, y: 19 * T + 2, w: 5 * T - 8, h: T + 20 };
  function drawMorningBoard(ctx, mb) {
    if (!mb) return;
    const b = MORNING;
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, '#ffb15c'); g.addColorStop(1, '#ff7d4d');
    ctx.fillStyle = '#a8572c'; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 4); ctx.fill(); // わく
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(b.x + 2, b.y + 2, b.w - 4, 15, 3); ctx.fill(); // 見出し
    ctx.fillStyle = '#fff8ec'; ctx.beginPath(); ctx.roundRect(b.x + 2, b.y + 18, b.w - 4, b.h - 20, 3); ctx.fill(); // 名前の紙
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const n = mb.names.length;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif';
    ctx.fillText(n ? `🌅 今日の朝活 成功者 ${n}人` : '🌅 今日の朝活', b.x + b.w / 2, b.y + 10);
    ctx.fillStyle = '#5a3a1e';
    if (!n) {
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(mb.over ? '明日も待ってるよ！' : '今日の一番乗りはだれ？', b.x + b.w / 2, b.y + 28);
      ctx.font = '7.5px sans-serif'; ctx.fillStyle = '#9a7a5c';
      ctx.fillText(`朝 ${mb.start}〜${mb.end} に ${mb.minutes}分`, b.x + b.w / 2, b.y + 41);
    } else {
      // 2行まで。入りきらない人は「ほか○人」
      ctx.font = 'bold 8.5px sans-serif';
      const maxW = b.w - 10, lines = [''];
      let shown = 0;
      for (const name of mb.names) {
        const cur = lines[lines.length - 1], next = cur ? cur + '・' + name : name;
        if (ctx.measureText(next).width <= maxW) { lines[lines.length - 1] = next; shown++; continue; }
        if (lines.length < 2) { lines.push(name); shown++; continue; }
        break;
      }
      if (shown < n) {
        const rest = `ほか${n - shown}人`;
        let last = lines[lines.length - 1];
        while (last.includes('・') && ctx.measureText(last + ' ' + rest).width > maxW) { last = last.slice(0, last.lastIndexOf('・')); shown--; }
        lines[lines.length - 1] = last + ' ' + `ほか${n - shown}人`;
      }
      const y0 = lines.length === 1 ? b.y + 34 : b.y + 28;
      lines.forEach((ln, i) => ctx.fillText(ln, b.x + b.w / 2, y0 + i * 12));
    }
    // 🎂 今日のお誕生日（見せる設定の子だけ）：板の下に小さな札
    if (mb.bdays && mb.bdays.length) {
      ctx.font = 'bold 8.5px sans-serif';
      let text = '🎂 今日のお誕生日：' + mb.bdays.join('・');
      while (ctx.measureText(text).width > b.w + 10 && text.length > 12) text = text.slice(0, -2);
      if (text !== '🎂 今日のお誕生日：' + mb.bdays.join('・')) text += '…';
      const w = ctx.measureText(text).width + 12, cx = b.x + b.w / 2, ty = b.y + b.h + 2;
      ctx.fillStyle = '#ffe9a8'; ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(cx - w / 2, ty, w, 14, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#6b4a00'; ctx.fillText(text, cx, ty + 7.5);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  const inMorningBoard = (wx, wy) => wx >= MORNING.x && wx <= MORNING.x + MORNING.w && wy >= MORNING.y && wy <= MORNING.y + MORNING.h + 16;

  // 🎎 ひな人形：着物の色と、持ち物
  const HINA = {
    dairi: { robe: '#2a2a3a', under: '#7a1f2b', hair: 'kanmuri' },                 // おだいりさま：黒の束帯・冠・しゃく
    hina: { robe: '#b8323c', under: '#f2c14e', layers: ['#3c8a5a', '#7b4fa6', '#f2c14e'], hair: 'long' }, // おひなさま：十二単
    kanjo1: { robe: '#ffffff', hakama: '#d6303a', hair: 'long', item: 'choshi' },  // 三人官女：白い着物と赤いはかま
    kanjo2: { robe: '#ffffff', hakama: '#d6303a', hair: 'long', item: 'sanbo' },
    kanjo3: { robe: '#ffffff', hakama: '#d6303a', hair: 'long', item: 'hisage' },
    hayashi1: { robe: '#e98a2f', hakama: '#3f6fb5', hair: 'eboshi', item: 'taiko' }, // 五人囃子：太鼓・大鼓・小鼓・笛・謡
    hayashi2: { robe: '#4f9d63', hakama: '#3f6fb5', hair: 'eboshi', item: 'okawa' },
    hayashi3: { robe: '#d24f7c', hakama: '#3f6fb5', hair: 'eboshi', item: 'kotsuzumi' },
    hayashi4: { robe: '#7a5bc4', hakama: '#3f6fb5', hair: 'eboshi', item: 'fue' },
    hayashi5: { robe: '#2f9bb3', hakama: '#3f6fb5', hair: 'eboshi', item: 'ogi' },
  };
  function drawHina(ctx, kind, x, yy, t) {
    const h = HINA[kind];
    // 着物（すそが広がる形）
    if (h.layers) { // 十二単：すそに色の重なり
      h.layers.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - 11 + i, yy + 11 - i * 1.6); ctx.lineTo(x - 6, yy - 4); ctx.lineTo(x + 6, yy - 4); ctx.lineTo(x + 11 - i, yy + 11 - i * 1.6); ctx.closePath(); ctx.fill(); });
    }
    ctx.fillStyle = h.robe;
    ctx.beginPath(); ctx.moveTo(x - 9, h.hakama ? yy + 4 : yy + 7); ctx.lineTo(x - 6, yy - 4); ctx.lineTo(x + 6, yy - 4); ctx.lineTo(x + 9, h.hakama ? yy + 4 : yy + 7); ctx.closePath(); ctx.fill();
    if (h.robe === '#ffffff') { ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 0.8; ctx.stroke(); }
    if (h.hakama) { ctx.fillStyle = h.hakama; ctx.beginPath(); ctx.moveTo(x - 9, yy + 4); ctx.lineTo(x + 9, yy + 4); ctx.lineTo(x + 10, yy + 11); ctx.lineTo(x - 10, yy + 11); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = h.under || '#d6303a'; ctx.lineWidth = 1.4; // えり
    ctx.beginPath(); ctx.moveTo(x - 3.5, yy - 4); ctx.lineTo(x, yy + 0.5); ctx.lineTo(x + 3.5, yy - 4); ctx.stroke();
    // 顔とかみ
    ctx.fillStyle = '#fdf1e6'; ctx.beginPath(); ctx.arc(x, yy - 9, 5.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1e1a22';
    if (h.hair === 'long') { // 長いかみ（うしろに流れる）
      ctx.beginPath(); ctx.arc(x, yy - 10.5, 5.8, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - 6.2, yy - 10.5, 2.2, 12); ctx.fillRect(x + 4, yy - 10.5, 2.2, 12);
    } else ctx.beginPath(), ctx.arc(x, yy - 10.8, 5.6, Math.PI, 0), ctx.fill();
    if (h.hair === 'kanmuri') { // 冠と、うしろにのびる纓（えい）
      ctx.fillRect(x - 3.5, yy - 18, 7, 4.5); ctx.beginPath(); ctx.moveTo(x + 2, yy - 18); ctx.quadraticCurveTo(x + 4, yy - 26, x + 1, yy - 27); ctx.lineWidth = 1.6; ctx.strokeStyle = '#1e1a22'; ctx.stroke();
      ctx.fillStyle = '#e8cf9a'; ctx.fillRect(x + 6, yy - 6, 1.6, 9); // しゃく
    }
    if (kind === 'hina') { // 金の冠と、ひおうぎ（扇）
      ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.moveTo(x - 4, yy - 15); ctx.lineTo(x - 2, yy - 19); ctx.lineTo(x, yy - 16); ctx.lineTo(x + 2, yy - 19); ctx.lineTo(x + 4, yy - 15); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f7e1b0'; ctx.beginPath(); ctx.moveTo(x + 5, yy + 2); ctx.arc(x + 5, yy + 2, 7, -Math.PI * 0.95, -Math.PI * 0.55); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#d6303a'; ctx.lineWidth = 0.8; ctx.stroke();
    }
    if (h.hair === 'eboshi') { ctx.fillStyle = '#1e1a22'; ctx.beginPath(); ctx.moveTo(x - 4, yy - 14); ctx.lineTo(x + 1, yy - 22); ctx.lineTo(x + 4, yy - 14); ctx.closePath(); ctx.fill(); } // えぼし
    ctx.fillStyle = '#2b2230'; ctx.fillRect(x - 2.6, yy - 9, 1.2, 1.3); ctx.fillRect(x + 1.4, yy - 9, 1.2, 1.3); // 目
    ctx.fillStyle = 'rgba(240,120,140,.55)'; ctx.beginPath(); ctx.arc(x - 3.2, yy - 6.8, 1.1, 0, Math.PI * 2); ctx.arc(x + 3.2, yy - 6.8, 1.1, 0, Math.PI * 2); ctx.fill(); // ほっぺ
    // 持ち物
    const it = h.item;
    if (it === 'choshi') { ctx.strokeStyle = '#b8862e'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 10, yy - 8); ctx.lineTo(x + 2, yy + 2); ctx.stroke(); ctx.fillStyle = '#d9a63a'; ctx.beginPath(); ctx.arc(x - 10, yy - 8, 2.4, 0, Math.PI * 2); ctx.fill(); } // 長柄の銚子
    if (it === 'sanbo') { ctx.fillStyle = '#e2c27a'; ctx.fillRect(x - 5, yy - 1, 10, 2); ctx.fillRect(x - 3, yy + 1, 6, 3); ctx.fillStyle = '#f5f0e6'; ctx.beginPath(); ctx.arc(x, yy - 2, 2.2, 0, Math.PI * 2); ctx.fill(); } // 三方
    if (it === 'hisage') { ctx.fillStyle = '#c99a3a'; ctx.beginPath(); ctx.arc(x + 6, yy + 1, 3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#8a6420'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + 6, yy - 2, 3, Math.PI, 0); ctx.stroke(); } // 提子
    if (it === 'taiko') { ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.ellipse(x, yy + 3, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#f3e3c3'; ctx.beginPath(); ctx.ellipse(x, yy + 2, 4.5, 2, 0, 0, Math.PI * 2); ctx.fill(); } // 太鼓
    if (it === 'okawa') { ctx.fillStyle = '#c0392b'; ctx.fillRect(x - 10, yy - 2, 6, 3); ctx.fillStyle = '#f3e3c3'; ctx.beginPath(); ctx.arc(x - 10, yy - 0.5, 2.6, 0, Math.PI * 2); ctx.arc(x - 4, yy - 0.5, 2.6, 0, Math.PI * 2); ctx.fill(); } // 大鼓（ひざ）
    if (it === 'kotsuzumi') { ctx.fillStyle = '#c0392b'; ctx.fillRect(x + 4, yy - 13, 3, 6); ctx.fillStyle = '#f3e3c3'; ctx.beginPath(); ctx.arc(x + 5.5, yy - 13, 2.4, 0, Math.PI * 2); ctx.arc(x + 5.5, yy - 7, 2.4, 0, Math.PI * 2); ctx.fill(); } // 小鼓（肩）
    if (it === 'fue') { ctx.strokeStyle = '#7a4a22'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 1, yy - 6); ctx.lineTo(x + 11, yy - 9); ctx.stroke(); } // 笛
    if (it === 'ogi') { ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.moveTo(x + 4, yy + 1); ctx.arc(x + 4, yy + 1, 7, -Math.PI * 0.85, -Math.PI * 0.45); ctx.closePath(); ctx.fill(); } // 謡の扇
    if (kind.startsWith('hayashi')) { // 音符がふわっと
      const n = Number(kind.slice(-1)), ph = (t * 0.8 + n * 0.37) % 1;
      ctx.globalAlpha = 1 - ph; ctx.fillStyle = '#7a5bc4'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(n % 2 ? '♪' : '♫', x + 7, yy - 18 - ph * 10); ctx.globalAlpha = 1;
    }
  }

  // 🌸 春のスター：桜の花かんむり・まわりの光・花びら
  function sakura(ctx, cx, cy, r, rot, color) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.fillStyle = color || '#ffb7cf';
    for (let i = 0; i < 5; i++) { ctx.rotate(Math.PI * 2 / 5); ctx.beginPath(); ctx.ellipse(0, -r * 0.62, r * 0.42, r * 0.62, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#f7d046'; ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawSakuraCrown(ctx, x, y, t) {
    ctx.strokeStyle = '#7fae5a'; ctx.lineWidth = 1.6; // 葉のわっか
    ctx.beginPath(); ctx.ellipse(x, y + 1, 10, 3, 0, 0, Math.PI * 2); ctx.stroke();
    [[-8, 1, '#ffc4d8'], [-3.5, -1.5, '#ff9fc0'], [1.5, -2, '#ffd3e2'], [6.5, -0.5, '#ff9fc0'], [9.5, 2, '#ffc4d8']]
      .forEach(([dx, dy, c], i) => sakura(ctx, x + dx, y + dy, 3.4, t * 0.6 + i, c));
  }
  function drawBloomGlow(ctx, x, y, t, s) {
    const r = 30 * s + Math.sin(t * 2.4) * 2;
    const g = ctx.createRadialGradient(x, y - 10 * s, 4, x, y - 10 * s, r);
    g.addColorStop(0, 'rgba(255,214,232,.75)'); g.addColorStop(0.55, 'rgba(255,190,215,.35)'); g.addColorStop(1, 'rgba(255,190,215,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 10 * s, r, 0, Math.PI * 2); ctx.fill();
  }
  function drawPetal(ctx, p, now) {
    const age = (now - p.born) / 1000, life = 1.6;
    if (age > life) return false;
    const x = p.x + p.vx * age + Math.sin(age * 4 + p.seed) * 5, y = p.y + p.vy * age + age * age * 14;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - age / life); ctx.translate(x, y); ctx.rotate(p.seed + age * 3);
    ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 1.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    return true;
  }

  // 特別な日の演出：12/25は雪とプレゼント、7/7は天の川と星
  function drawFx(ctx, fx, x, y, t) {
    ctx.save();
    if (fx === 'tanabata') {
      // 頭の上に天の川（星の帯）がかかり、まわりで星がきらきら
      const cx = x, cy = y - 18;
      const band = ctx.createLinearGradient(cx - 56, cy - 40, cx + 56, cy - 40);
      band.addColorStop(0, 'rgba(160,180,255,0)'); band.addColorStop(0.5, 'rgba(170,190,255,.55)'); band.addColorStop(1, 'rgba(160,180,255,0)');
      ctx.strokeStyle = band; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy + 34, 62, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      for (let i = 0; i < 14; i++) {
        const a = Math.PI * 1.15 + (i / 13) * Math.PI * 0.7, r = 62 + Math.sin(i * 2.3) * 5;
        const sx = cx + Math.cos(a) * r, sy = cy + 34 + Math.sin(a) * r, tw = (Math.sin(t * 4 + i * 1.7) + 1) / 2, s = 1.2 + tw * 2.2;
        ctx.fillStyle = `rgba(255,240,150,${0.45 + tw * 0.55})`;
        ctx.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? s * 0.4 : s * 1.7, aa = k * Math.PI / 4; ctx.lineTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr); } ctx.closePath(); ctx.fill();
      }
      ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('💗', cx + Math.sin(t * 2) * 3, cy - 36 - Math.abs(Math.sin(t * 2.5)) * 3);
    } else if (fx === 'hinamatsuri') {
      const cols = ['#ff9fc0', '#ffffff', '#9fd68a', '#ffe27a'];
      for (let i = 0; i < 22; i++) { // ふってくる、ひなあられ
        const sx = x - 55 + ((i * 41) % 110) + Math.sin(t * 1.3 + i) * 3, sy = y - 72 + ((t * 24 + i * 19) % 92);
        ctx.fillStyle = cols[i % 4]; ctx.strokeStyle = 'rgba(180,120,140,.45)'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.arc(sx, sy, 2 + (i % 2) * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    } else if (fx === 'xmas') {
      for (let i = 0; i < 18; i++) { // ふる雪（頭の上から足もとまで）
        const sx = x - 50 + ((i * 37) % 100) + Math.sin(t * 1.5 + i) * 4, sy = y - 70 + ((t * 20 + i * 17) % 86);
        ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = 'rgba(120,160,210,.7)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(sx, sy, 1.8 + (i % 3) * 0.7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '13px sans-serif'; // 足もとにプレゼント
      ctx.fillText('🎁', x - 9, y + 18 - Math.abs(Math.sin(t * 3)) * 2); ctx.fillText('🎁', x + 10, y + 19 - Math.abs(Math.sin(t * 3 + 1)) * 2);
    }
    ctx.restore();
  }

  window.Render = { buildMap, drawAvatar, drawFollower, drawFx, drawBloomGlow, drawPetal, drawWindows, drawBoard, inBoard, drawMorningBoard, inMorningBoard, drawTree, drawDecorations, seasonOf, COSTUMES };
})();
