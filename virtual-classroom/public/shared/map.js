// 三浦塾バーチャル教室のマップ定義（サーバー・クライアント共通）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClassMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 46, H = 30, TILE = 32;

  /*
   * タイル記号
   *  .  床        _  ドア      #  壁        W  ホワイトボード(壁)  M  モニター(壁)
   *  D  机        T  教卓      K  テーブル  c  椅子(座れる)        t  先生の椅子(座れる)
   *  S  ソファ(座れる)  P  観葉植物  B  本棚/下駄箱  V  自販機  m  玄関マット
   */
  const grid = [];
  for (let y = 0; y < H; y++) grid.push(new Array(W).fill('.'));
  const set = (x, y, ch) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = ch; };
  const fill = (x1, y1, x2, y2, ch) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) set(x, y, ch); };

  // 外壁
  fill(0, 0, W - 1, 0, '#'); fill(0, H - 1, W - 1, H - 1, '#');
  fill(0, 0, 0, H - 1, '#'); fill(W - 1, 0, W - 1, H - 1, '#');
  // 内壁
  fill(0, 18, W - 1, 18, '#');   // 上段と下段の仕切り
  fill(28, 0, 28, 18, '#');      // 教室 | 面談室
  fill(28, 9, W - 1, 9, '#');    // 面談室A | 面談室B
  fill(19, 18, 19, H - 1, '#');  // 自習室 | ラウンジ
  fill(36, 18, 36, H - 1, '#');  // ラウンジ | エントランス
  // ドア
  [[28, 5], [28, 13], [22, 18], [23, 18], [19, 23], [19, 24], [36, 23], [36, 24]]
    .forEach(([x, y]) => set(x, y, '_'));

  // ── 教室 ──
  fill(9, 0, 19, 0, 'W');           // ホワイトボード
  fill(12, 3, 16, 3, 'T');          // 教卓
  set(14, 2, 't');                  // 先生の椅子
  for (const y of [7, 10, 13]) {
    for (const gx of [3, 8, 13, 18, 23]) {
      set(gx, y, 'D'); set(gx + 1, y, 'D');
      set(gx, y + 1, 'c'); set(gx + 1, y + 1, 'c');
    }
  }
  [[1, 1], [27, 1], [1, 17], [27, 17]].forEach(([x, y]) => set(x, y, 'P'));
  fill(1, 6, 1, 14, 'B');

  // ── 面談室A / B（画面共有ルーム） ──
  for (const [top, screenY] of [[1, 0], [10, 9]]) {
    fill(34, screenY, 37, screenY, 'M');
    const ty = top + 3;
    fill(34, ty, 37, ty + 1, 'K');
    [[33, ty], [33, ty + 1], [38, ty], [38, ty + 1], [35, ty - 1], [36, ty - 1], [35, ty + 2], [36, ty + 2]]
      .forEach(([x, y]) => set(x, y, 'c'));
    set(43, top, 'P'); set(29, top + 7, 'P');
  }

  // ── 自習室 ──
  fill(2, 19, 17, 19, 'B');
  for (const y of [21, 25]) {
    for (const x of [2, 5, 8, 11, 14, 17]) { set(x, y, 'D'); set(x, y + 1, 'c'); }
  }

  // ── ラウンジ ──
  fill(26, 23, 28, 24, 'K');
  [[25, 23], [25, 24], [29, 23], [29, 24]].forEach(([x, y]) => set(x, y, 'S'));
  [[20, 19], [35, 28], [20, 28]].forEach(([x, y]) => set(x, y, 'P'));
  fill(33, 19, 34, 19, 'V');

  // ── エントランス ──
  [[37, 19], [44, 19]].forEach(([x, y]) => set(x, y, 'P'));
  fill(39, 22, 42, 25, 'm');
  fill(38, 28, 43, 28, 'B');

  const ZONES = [
    { id: 'classroom', name: '教室', type: 'open', x1: 1, y1: 1, x2: 27, y2: 17 },
    { id: 'roomA', name: '面談室A（画面共有）', type: 'private', x1: 29, y1: 1, x2: 44, y2: 8 },
    { id: 'roomB', name: '面談室B（画面共有）', type: 'private', x1: 29, y1: 10, x2: 44, y2: 17 },
    { id: 'study', name: '自習室', type: 'quiet', x1: 1, y1: 19, x2: 18, y2: 28 },
    { id: 'lounge', name: 'ラウンジ', type: 'open', x1: 20, y1: 19, x2: 35, y2: 28 },
    { id: 'entrance', name: 'エントランス', type: 'open', x1: 37, y1: 19, x2: 44, y2: 28 },
  ];

  const WALKABLE = new Set(['.', '_', 'c', 't', 'S', 'm']);
  const SEATS = new Set(['c', 't', 'S']);

  const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H) ? '#' : grid[ty][tx];
  const isWalkable = (tx, ty) => WALKABLE.has(tileAt(tx, ty));
  const isSeat = (tx, ty) => SEATS.has(tileAt(tx, ty));
  const zoneAt = (tx, ty) => ZONES.find(z => tx >= z.x1 && tx <= z.x2 && ty >= z.y1 && ty <= z.y2) || null;
  const zoneAtPx = (x, y) => zoneAt(Math.floor(x / TILE), Math.floor(y / TILE));
  const seatId = (tx, ty) => tx + ',' + ty;
  const parseSeat = (id) => { const [x, y] = String(id).split(',').map(Number); return { x, y }; };
  const tileCenter = (tx, ty) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });

  // 4方向BFSで経路探索。返り値はタイル座標の配列（開始タイルを含まない）
  function findPath(sx, sy, gx, gy) {
    if (!isWalkable(gx, gy)) return null;
    if (sx === gx && sy === gy) return [];
    const prev = new Map();
    const key = (x, y) => y * W + x;
    const q = [[sx, sy]];
    prev.set(key(sx, sy), -1);
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (prev.has(k) || !isWalkable(nx, ny)) continue;
        prev.set(k, key(x, y));
        if (nx === gx && ny === gy) {
          const path = [];
          let c = k;
          while (c !== key(sx, sy)) { path.push({ x: c % W, y: Math.floor(c / W) }); c = prev.get(c); }
          return path.reverse();
        }
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // 最寄りの空席を探す（zoneId 指定可、kinds で椅子の種類を限定）
  function nearestFreeSeat(sx, sy, occupied, opts = {}) {
    const { zoneId = null, kinds = ['c'] } = opts;
    const seen = new Set([sy * W + sx]);
    const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      const ch = tileAt(x, y);
      if (kinds.includes(ch) && !occupied.has(seatId(x, y))) {
        const z = zoneAt(x, y);
        if (!zoneId || (z && z.id === zoneId)) return { x, y };
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ny * W + nx;
        if (seen.has(k) || !isWalkable(nx, ny)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return null;
  }

  const SPAWN = [];
  for (let y = 22; y <= 25; y++) for (let x = 39; x <= 42; x++) SPAWN.push({ x, y });

  return {
    W, H, TILE, grid, ZONES, SPAWN,
    tileAt, isWalkable, isSeat, zoneAt, zoneAtPx, seatId, parseSeat, tileCenter, findPath, nearestFreeSeat,
  };
});
