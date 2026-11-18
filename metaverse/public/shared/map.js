// 三浦塾メタバースのマップ定義（サーバー・クライアント共通）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SchoolMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 52, H = 34, TILE = 32;

  /*
   * タイル記号
   *  #  壁          w  窓(壁)       W  黒板(壁)      V  大型スクリーン(壁)   N  掲示板(壁)   G  ガラス扉(壁)
   *  .  床          _  出入口       p  教壇(歩ける)  r  ラグ(歩ける)         m  玄関マット(歩ける)
   *  T  教卓        D  生徒の机     c  椅子(座れる)  b  学習ブースの机        L  ロッカー
   *  P  観葉植物    B  本棚/下駄箱  k  受付カウンター  F  ウォーターサーバー   S  ベンチ(座れる)
 *  Y  がんばりの木の根元（描画は動的）      q  カフェのテーブル
   */
  const grid = [];
  for (let y = 0; y < H; y++) grid.push(new Array(W).fill('.'));
  const set = (x, y, ch) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y][x] = ch; };
  const fill = (x1, y1, x2, y2, ch) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) set(x, y, ch); };

  // 外壁・内壁
  fill(0, 0, W - 1, 0, '#'); fill(0, H - 1, W - 1, H - 1, '#');
  fill(0, 0, 0, H - 1, '#'); fill(W - 1, 0, W - 1, H - 1, '#');
  fill(0, 14, W - 1, 14, '#');               // 教室と廊下の間
  fill(17, 0, 17, 14, '#'); fill(34, 0, 34, 14, '#'); // 教室どうしの間
  fill(0, 19, W - 1, 19, '#');               // 廊下と下の部屋の間
  fill(34, 19, 34, H - 1, '#');              // 自習室とロビーの間

  // ── 授業教室（2部屋・各15席）。3つ目（x=35〜）は高校生自習室（カフェ風）に改装 ──
  const CLASSROOM_X = [1, 18];
  const classroomSeats = {};
  CLASSROOM_X.forEach((ox, i) => {
    const id = 'class' + (i + 1);
    fill(ox + 2, 0, ox + 9, 0, 'W');          // 黒板
    fill(ox + 10, 0, ox + 13, 0, 'V');        // 大型スクリーン
    fill(ox + 2, 1, ox + 13, 2, 'p');         // 教壇
    set(ox + 7, 2, 'T'); set(ox + 8, 2, 'T'); // 教卓
    set(ox, 1, 'P'); set(ox + 15, 1, 'P');
    classroomSeats[id] = [];
    for (const dy of [5, 8, 11]) {
      for (const dx of [1, 4, 7, 10, 13]) {
        set(ox + dx, dy, 'D'); set(ox + dx, dy + 1, 'c');
        classroomSeats[id].push({ x: ox + dx, y: dy + 1 });
      }
    }
    fill(ox + 1, 13, ox + 5, 13, 'L');        // ロッカー
    set(ox + 13, 14, '_'); set(ox + 14, 14, '_'); // 出入口
  });
  // 教室1はスピーキング・ライティングテストの教室：教壇の前にテスト用のブースを2つ（うしろの席は順番待ちの自習席）
  const BOOTHS = { class1: [{ x: 6, y: 4, name: 'ブース1' }, { x: 11, y: 4, name: 'ブース2' }] };
  for (const b of BOOTHS.class1) { set(b.x, b.y - 1, 'b'); set(b.x, b.y, 'c'); }

  // ── 高校生自習室（教室3を改装・カフェ風） ──
  {
    fill(35, 0, 50, 0, 'w');                  // 大きな窓
    fill(36, 1, 39, 1, 'k');                  // カフェのカウンター
    for (let x = 43; x <= 49; x++) { set(x, 1, 'b'); set(x, 2, 'c'); } // 窓ぎわのカウンター席（7席）
    for (const ty of [6, 10]) {
      for (const tx of [37, 41, 45]) { set(tx, ty, 'q'); set(tx, ty - 1, 'c'); set(tx, ty + 1, 'c'); } // テーブル席（12席）
    }
    fill(47, 5, 50, 10, 'r');                 // 高校生の木のまわりのラグ
    set(48, 8, 'Y'); set(49, 8, 'Y');
    [[35, 1], [50, 1], [35, 13], [41, 13]].forEach(([x, y]) => set(x, y, 'P'));
    fill(36, 13, 39, 13, 'B');                // 本棚
    set(50, 12, 'F');
    set(48, 14, '_'); set(49, 14, '_');       // 出入口
  }

  // ── 廊下 ──
  [[1, 15], [50, 15], [1, 18], [50, 18]].forEach(([x, y]) => set(x, y, 'P'));

  // ── 自習室（木目・個別ブース） ──
  set(16, 19, '_'); set(17, 19, '_');
  fill(1, H - 1, 33, H - 1, 'w'); fill(0, 20, 0, 32, 'w');
  for (const x of [2, 4, 6, 8, 10, 12, 21, 23, 25, 27, 29, 31]) { set(x, 20, 'b'); set(x, 21, 'c'); }
  for (const x of [4, 6, 8, 10, 12, 21, 23, 25, 27, 29]) {
    set(x, 25, 'b'); set(x, 26, 'b');
    set(x, 24, 'c'); set(x, 27, 'c');
  }
  fill(15, 22, 18, 31, 'r');                 // 中央のラグ
  // がんばりの木（学年ごとに3本）。根元の2マスは通れない。左右（x=15, 18）は通路
  // 4本目は高校生の木（高校生自習室の中）
  const FOREST = [{ x: 16, y: 23 }, { x: 16, y: 26 }, { x: 16, y: 29 }, { x: 48, y: 8 }];
  for (const f of FOREST) { set(f.x, f.y, 'Y'); set(f.x + 1, f.y, 'Y'); }
  fill(2, 32, 7, 32, 'B');
  fill(26, 32, 31, 32, 'B');
  [[1, 32], [13, 32], [20, 32], [33, 32], [33, 20], [1, 20]].forEach(([x, y]) => set(x, y, 'P'));
  set(33, 26, 'F');

  // ── ロビー（エントランス） ──
  set(42, 19, '_'); set(43, 19, '_');
  fill(36, 19, 39, 19, 'N');                 // 掲示板
  fill(42, H - 1, 43, H - 1, 'G');           // 正面玄関
  fill(40, 28, 45, 31, 'm');
  fill(36, 23, 38, 23, 'k');                 // 受付
  fill(35, 26, 35, 31, 'B');                 // 下駄箱
  fill(47, 23, 49, 23, 'S');                 // ベンチ
  [[35, 20], [50, 20], [50, 32], [36, 32]].forEach(([x, y]) => set(x, y, 'P'));

  // 部屋（ゾーン）。id は DB の rooms.id と一致させる
  const ZONES = [
    { id: 'class1', name: 'スピーキング・ライティング教室', type: 'study', style: 'classroom', test: true, x1: 1, y1: 1, x2: 16, y2: 13 },
    { id: 'class2', name: '教室2', type: 'classroom', x1: 18, y1: 1, x2: 33, y2: 13 },
    { id: 'class3', name: '高校生自習室', type: 'study', style: 'cafe', x1: 35, y1: 1, x2: 50, y2: 13 },
    { id: 'hall', name: 'ろうか', type: 'hall', x1: 1, y1: 15, x2: 50, y2: 18 },
    { id: 'study', name: '自習室', type: 'study', x1: 1, y1: 20, x2: 33, y2: 32 },
    { id: 'lobby', name: 'ロビー', type: 'lobby', x1: 35, y1: 20, x2: 50, y2: 32 },
  ];
  // 各部屋の「到着地点」（部屋選択メニューから移動するとき）
  const ENTRY = {
    class1: { x: 14, y: 13 }, class2: { x: 31, y: 13 }, class3: { x: 48, y: 13 },
    study: { x: 16, y: 21 }, lobby: { x: 42, y: 26 }, hall: { x: 25, y: 16 },
  };
  // 部屋から出されたときの移動先（扉の外の廊下）
  const EXIT = { class1: { x: 14, y: 15 }, class2: { x: 31, y: 15 }, class3: { x: 48, y: 15 }, study: { x: 16, y: 18 } };
  // 教壇の立ち位置
  const PODIUM = { class1: { x: 8, y: 1 }, class2: { x: 25, y: 1 } };
  // テストのブースの席か
  const isBoothSeat = (seatId) => Object.values(BOOTHS).some(list => list.some(b => `${b.x},${b.y}` === seatId));
  // 自習室（自習時間を数える部屋）。study＝中学生など、class3＝高校生
  const isStudyRoom = (id) => { const z = ZONES.find(v => v.id === id); return !!(z && z.type === 'study'); };
  // 席えらびの画面での席の分け方
  const SEAT_GROUPS = {
    study: [{ label: '左がわ', x1: 1, x2: 15 }, { label: '右がわ', x1: 16, x2: 33 }],
    class3: [{ label: '窓ぎわのカウンター', y1: 1, y2: 3 }, { label: 'テーブル席', y1: 4, y2: 13 }],
    class1: [{ label: '順番待ちの席', y1: 5, y2: 13 }],
  };

  const WALKABLE = new Set(['.', '_', 'p', 'r', 'm', 'c', 'S']);
  const SEATS = new Set(['c', 'S']);
  const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H) ? '#' : grid[ty][tx];
  const isWalkable = (tx, ty) => WALKABLE.has(tileAt(tx, ty));
  const isSeat = (tx, ty) => SEATS.has(tileAt(tx, ty));
  const zoneAt = (tx, ty) => ZONES.find(z => tx >= z.x1 && tx <= z.x2 && ty >= z.y1 && ty <= z.y2) || null;
  const zoneAtPx = (x, y) => zoneAt(Math.floor(x / TILE), Math.floor(y / TILE));
  const seatId = (tx, ty) => tx + ',' + ty;
  const tileCenter = (tx, ty) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
  // 椅子の向き：机が上にあれば上向き、下にあれば下向き
  const seatFacing = (tx, ty) => {
    const up = tileAt(tx, ty - 1), down = tileAt(tx, ty + 1);
    if (up === 'D' || up === 'b' || up === 'q') return 'up';
    if (down === 'D' || down === 'b' || down === 'q') return 'down';
    return 'down';
  };

  // 4方向BFS。canEnter(tx,ty) で通れないタイルを追加指定できる
  function findPath(sx, sy, gx, gy, canEnter) {
    const ok = (x, y) => isWalkable(x, y) && (!canEnter || canEnter(x, y));
    if (!ok(gx, gy)) return null;
    if (sx === gx && sy === gy) return [];
    const key = (x, y) => y * W + x;
    const prev = new Map([[key(sx, sy), -1]]);
    const q = [[sx, sy]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (prev.has(k) || !ok(nx, ny)) continue;
        prev.set(k, key(x, y));
        if (nx === gx && ny === gy) {
          const path = [];
          for (let c = k; c !== key(sx, sy); c = prev.get(c)) path.push({ x: c % W, y: Math.floor(c / W) });
          return path.reverse();
        }
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // 部屋ごとの座席数（定員の上限）
  const seatCount = (zoneId) => {
    const z = ZONES.find(v => v.id === zoneId);
    if (!z) return 0;
    let n = 0;
    for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) if (tileAt(x, y) === 'c') n++;
    return n;
  };

  const SPAWN = [];
  for (let y = 28; y <= 31; y++) for (let x = 40; x <= 45; x++) SPAWN.push({ x, y });

  return {
    W, H, TILE, grid, ZONES, ENTRY, EXIT, PODIUM, SPAWN, classroomSeats, FOREST, isStudyRoom, SEAT_GROUPS, BOOTHS, isBoothSeat,
    tileAt, isWalkable, isSeat, zoneAt, zoneAtPx, seatId, tileCenter, seatFacing, findPath, seatCount,
  };
});
