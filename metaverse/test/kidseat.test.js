// 🪑 小学生：席を変えられるのは10分に1回（テストでは1.5秒）・🌱 すわり続けると席に花が育つ
process.env.DB_PATH = ':memory:';
process.env.KID_SEAT_GAP_MS = '1500';
process.env.SPROUT_STEP_MS = '700';
process.env.STUDY_TICK_MS = '250';
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


let owner; const U = {};
test('準備：小学生2人・中学生', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  for (const [k, grade] of [['es5', '小5'], ['es3', '小3'], ['jh2', '中2']]) {
    const r = await http('POST', '/api/admin/users', { role: 'student', grade, loginId: k, displayName: k, password: 'password123' }, owner);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  }
});

test('小学生は10分（テスト1.5秒）たつまで、ほかの席に変えられない。さっきの席・前の席がうまっているときはOK', async () => {
  const a = await connect(U.es5.cookie);
  assert.ok(await walk(a, 19, 4));
  let r = await ask(a, 'sit', '19,4'); assert.ok(r.ok, r.error);
  a.s.emit('stand');
  assert.ok(await walk(a, 20, 4));
  r = await ask(a, 'sit', '20,4');
  assert.equal(r.ok, false); assert.match(r.error, /10分に1回/);
  assert.ok(await walk(a, 19, 4));
  r = await ask(a, 'sit', '19,4'); assert.ok(r.ok, 'さっきの席にはすわれる');
  a.s.emit('stand');
  // つなぎ直しても、待ち時間は消えない
  a.s.disconnect();
  const a2 = await connect(U.es5.cookie);
  assert.ok(await walk(a2, 20, 4));
  r = await ask(a2, 'sit', '20,4'); assert.equal(r.ok, false, 'つなぎ直してもだめ');
  // 前の席がうまっていたら、変えてよい
  const b = await connect(U.es3.cookie);
  assert.ok(await walk(b, 19, 4));
  r = await ask(b, 'sit', '19,4'); assert.ok(r.ok, r.error);
  r = await ask(a2, 'sit', '20,4'); assert.ok(r.ok, '前の席がうまっていれば変えられる');
  // 時間がたてば変えられる
  b.s.emit('stand'); a2.s.emit('stand');
  await sleep(1600);
  assert.ok(await walk(b, 23, 4));
  r = await ask(b, 'sit', '23,4'); assert.ok(r.ok, '時間がたてば変えられる');
  a2.s.disconnect(); b.s.disconnect();
});

test('中学生は今まで通り、すぐに席を変えられる', async () => {
  const c = await connect(U.jh2.cookie);
  const seats = []; for (let y = 20; y <= 32; y++) for (let x = 1; x <= 33; x++) if (SM.tileAt(x, y) === 'c') seats.push([x, y]);
  const [s1, s2] = [seats[0], seats[2]];
  assert.ok(await walk(c, s1[0], s1[1]));
  let r = await ask(c, 'sit', s1.join(',')); assert.ok(r.ok, r.error);
  c.s.emit('stand');
  assert.ok(await walk(c, s2[0], s2[1]));
  r = await ask(c, 'sit', s2.join(',')); assert.ok(r.ok, r.error);
  c.s.disconnect();
});

test('🌱 小学生：すわり続けると花が育ち（🌱→🌷→🌻）、立つと最初から', async () => {
  const a = await connect(U.es5.cookie);
  await sleep(1600); // 席の待ち時間をすぎてから
  assert.ok(await walk(a, 27, 4));
  const r = await ask(a, 'sit', '27,4'); assert.ok(r.ok, r.error);
  const stages = () => a.events.filter(e => e.ev === 'user-updated' && e.d.id === U.es5.id && 'sprout' in e.d).map(e => e.d.sprout);
  await sleep(2600);
  assert.deepEqual(stages().slice(0, 3), [1, 2, 3], '育つ');
  assert.ok(a.events.some(e => e.ev === 'sprout-up' && e.d.stage === 3));
  a.s.emit('stand');
  await sleep(500);
  assert.equal(stages().pop(), 0, '立ったら最初から');
  a.s.disconnect();
});
