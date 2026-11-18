// スピーキング・ライティング教室（教室1）：自習の部屋と同じルール・ブースは呼ばれた生徒だけ・順番待ち
process.env.DB_PATH = ':memory:';
process.env.TEST_LEAVE_MS = '300';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');
const G = require('../server/ganbari.js');

const T = SM.TILE;
let base, server;
const sockets = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { sockets.forEach(s => s.disconnect()); server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    sockets.push(s);
    const c = { s, me: null, events: [], rejected: [] };
    s.onAny((ev, d) => c.events.push({ ev, d }));
    s.on('move-rejected', (d) => c.rejected.push(d && d.reason));
    s.on('init', (d) => { c.me = d.me; resolve(c); });
    s.on('connect_error', reject);
  });
}
async function walk(c, tx, ty) {
  const path = SM.findPath(Math.floor(c.me.x / T), Math.floor(c.me.y / T), tx, ty);
  if (!path) return false;
  const before = c.rejected.length;
  for (const st of path) { const p = SM.tileCenter(st.x, st.y); c.s.emit('move', { x: p.x, y: p.y, dir: 'up' }); await sleep(25); c.me.x = p.x; c.me.y = p.y; }
  await sleep(100);
  return c.rejected.length === before;
}
const ask = (c, ev, d) => new Promise(r => c.s.emit(ev, d, r));

const at = (day, hm = '19:00') => new Date(`${day}T${hm}:00+09:00`);
let owner; const U = {};
const last = (c, ev) => [...c.events].reverse().find(e => e.ev === ev);
test('準備：中学生・高校生・先生', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner); // 入室前の漢字テストはなし
  const add = async (k, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: k, displayName: k }, owner);
    assert.equal(r.status, 201, k);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  };
  await add('jh1', { role: 'student', grade: '中2' });
  await add('hs1', { role: 'student', grade: '高1' });
  await add('jh2', { role: 'student', grade: '中3' });
  await add('tch', { role: 'teacher', rooms: [] });
  for (const k of Object.keys(U)) U[k].c = await connect(U[k].cookie);
});

test('教室1はスピーキング・ライティング教室。中学生も高校生も入れて、自習の部屋と同じに数える', async () => {
  const rooms = (await http('GET', '/api/me', null, U.hs1.cookie)).data.rooms;
  const r1 = rooms.find(r => r.id === 'class1');
  assert.equal(r1.name, 'スピーキング・ライティング教室'); assert.equal(r1.type, 'study'); assert.equal(r1.canEnter, true);
  assert.equal(SM.isStudyRoom('class1'), true);
  assert.equal(await walk(U.jh1.c, 2, 7), true);
  assert.equal(await walk(U.hs1.c, 5, 7), true);
  assert.equal(await walk(U.jh2.c, 8, 7), true);
  assert.equal(await walk(U.tch.c, 9, 3), true, '先生も入れる');
  assert.equal((await ask(U.jh1.c, 'sit', '2,6')).ok, true, 'ふつうの席にすわれる');
  const day = G.addDays(G.jst().day, -50);
  const pres = new Map([[1, { id: U.jh1.id, user: { role: 'student', grade: '中2' }, room: 'class1', seat: '2,6', away: null, studyCam: true }]]);
  assert.deepEqual(G.tick(pres, { date: at(day, '19:00') }), [U.jh1.id], '自習時間に数える');
});

test('ブースは先生に呼ばれた生徒だけすわれる', async () => {
  assert.equal(await walk(U.hs1.c, 6, 5), true);
  const r = await ask(U.hs1.c, 'sit', '6,4');
  assert.equal(r.ok, false); assert.match(r.error, /呼ばれたら/);
});

test('順番待ち：並ぶと番号がもらえ、先生に知らせが届く。部屋の外では並べない', async () => {
  assert.equal((await ask(U.tch.c, 'test-join', {})).ok, false, '先生は並べない');
  const a = await ask(U.hs1.c, 'test-join', {});
  assert.equal(a.ok, true); assert.equal(a.n, 1);
  const b = await ask(U.jh2.c, 'test-join', {});
  assert.equal(b.n, 2);
  assert.equal((await ask(U.hs1.c, 'test-join', {})).n, 1, '2回並んでも1回');
  await sleep(80);
  assert.ok(U.tch.c.events.some(e => e.ev === 'test-notice'));
  const q = last(U.jh1.c, 'test-queue').d;
  assert.deepEqual(q.queue.map(x => x.name), ['hs1', 'jh2']);
});

test('先生が「次の人」を呼ぶと、1番目の生徒がブースへ。ブースにすわれ、終わったらブースがあく', async () => {
  assert.equal((await ask(U.jh1.c, 'test-next', {})).ok, false, '生徒は呼べない');
  const r = await ask(U.tch.c, 'test-next', { seat: '6,4' });
  assert.equal(r.ok, true); assert.equal(r.userId, U.hs1.id);
  await sleep(80);
  assert.equal(last(U.hs1.c, 'test-called').d.seat, '6,4');
  assert.equal((await ask(U.jh2.c, 'sit', '6,4')).ok, false, 'ほかの生徒はすわれない');
  assert.equal((await ask(U.hs1.c, 'sit', '6,4')).ok, true, '呼ばれた生徒はすわれる');
  const q = last(U.jh1.c, 'test-queue').d;
  assert.deepEqual(q.queue.map(x => x.name), ['jh2']);
  assert.equal(q.booths.find(b => b.seat === '6,4').userName, 'hs1');
  // もう1つのブースへ次の人
  const r2 = await ask(U.tch.c, 'test-next', {});
  assert.equal(r2.seat, '11,4');
  assert.equal((await ask(U.tch.c, 'test-next', {})).ok, false, 'ブースがうまっている');
  // 終わり
  assert.equal((await ask(U.tch.c, 'test-done', { userId: U.hs1.id })).ok, true);
  await sleep(80);
  assert.ok(last(U.hs1.c, 'test-finished'));
  assert.equal(last(U.jh1.c, 'test-queue').d.booths.find(b => b.seat === '6,4').userId, null);
});

test('部屋を出たり、通信が切れたまま戻らなかったりすると、順番待ちからぬける', async () => {
  await ask(U.jh1.c, 'test-join', {});
  assert.equal(await walk(U.jh1.c, 14, 16), true); // ろうかへ
  await sleep(80);
  assert.ok(!last(U.tch.c, 'test-queue').d.queue.some(x => x.id === U.jh1.id));
  // jh2 はブース2にいる → 切れて戻らなければブースがあく
  U.jh2.c.s.disconnect();
  await sleep(500);
  assert.equal(last(U.tch.c, 'test-queue').d.booths.find(b => b.seat === '11,4').userId, null);
});
