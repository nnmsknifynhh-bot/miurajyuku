// 入室してきた子への「ようこそ」リアクション：小学生は2人だけ・すわって自習中、高校生は小学生以外に見える、同じ相手に1日1回
process.env.DB_PATH = ':memory:';
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
const evs = (c, name) => c.events.filter(e => e.ev === name).map(e => e.d);
let owner; const U = {};
test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  for (const [k, grade] of [['es1', '小5'], ['es2', '小4'], ['es3', '小6'], ['hs1', '高1'], ['hs2', '高2'], ['jh1', '中2']]) {
    const r = await http('POST', '/api/admin/users', { role: 'student', grade, loginId: k, displayName: k, password: 'password123' }, owner);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
    U[k].c = await connect(U[k].cookie);
  }
  assert.ok(await walk(U.jh1.c, 10, 23), '中学生は中学生自習室');
});

test('小学生：すわって自習中の子だけが、入ってきた子に送れる。見えるのは2人だけ', async () => {
  assert.ok(await walk(U.es1.c, 19, 4));
  assert.equal((await ask(U.es1.c, 'sit', '19,4')).ok, true);
  assert.ok(await walk(U.es3.c, 22, 8)); // 立っている小学生
  const e = SM.ENTRY.class2;
  assert.ok(await walk(U.es2.c, e.x, e.y));
  await sleep(150);
  assert.ok(evs(U.es1.c, 'welcome-chance').some(d => d.id === U.es2.id), 'すわっている子にお知らせ');
  assert.ok(!evs(U.es3.c, 'welcome-chance').some(d => d.id === U.es2.id), '立っている子には出ない');
  assert.match((await ask(U.es3.c, 'welcome', { to: U.es2.id, kind: '👋' })).error, /すわって/);
  const before = { jh: evs(U.jh1.c, 'reaction').length, es3: evs(U.es3.c, 'reaction').length };
  assert.equal((await ask(U.es1.c, 'welcome', { to: U.es2.id, kind: '👋' })).ok, true);
  await sleep(150);
  assert.ok(evs(U.es2.c, 'reaction').some(d => d.id === U.es1.id && d.kind === '👋'));
  assert.ok(evs(U.es2.c, 'welcome-got').some(d => d.from === U.es1.id && d.canReply));
  assert.equal(evs(U.jh1.c, 'reaction').length, before.jh, '中学生には見えない');
  assert.equal(evs(U.es3.c, 'reaction').length, before.es3, 'ほかの小学生にも見えない');
  assert.match((await ask(U.es1.c, 'welcome', { to: U.es2.id, kind: '😊' })).error, /今日はもう/);
  // 返す（1回だけ）
  assert.equal((await ask(U.es2.c, 'welcome-reply', { to: U.es1.id, kind: '😊' })).ok, true);
  await sleep(100);
  assert.ok(evs(U.es1.c, 'welcome-replied').some(d => d.from === U.es2.id));
  assert.match((await ask(U.es2.c, 'welcome-reply', { to: U.es1.id, kind: '😊' })).error, /もう返しました/);
  assert.equal((await ask(U.es3.c, 'welcome-reply', { to: U.es1.id, kind: '😊' })).ok, false, 'もらっていない子は返せない');
});

test('高校生：すわっていなくても送れる。小学生には見えず、中学生には見える', async () => {
  assert.ok(await walk(U.hs1.c, 44, 4));
  const e = SM.ENTRY.class3;
  assert.ok(await walk(U.hs2.c, e.x, e.y));
  await sleep(150);
  assert.ok(evs(U.hs1.c, 'welcome-chance').some(d => d.id === U.hs2.id));
  const before = { jh: evs(U.jh1.c, 'reaction').length, es: evs(U.es1.c, 'reaction').length };
  assert.equal((await ask(U.hs1.c, 'welcome', { to: U.hs2.id, kind: '💪' })).ok, true);
  await sleep(150);
  assert.equal(evs(U.jh1.c, 'reaction').length, before.jh + 1, '中学生には見える');
  assert.equal(evs(U.es1.c, 'reaction').length, before.es, '小学生には見えない');
  assert.match((await ask(U.hs1.c, 'welcome', { to: U.hs2.id, kind: '💪' })).error, /今日はもう/);
  assert.equal((await ask(U.jh1.c, 'welcome', { to: U.hs2.id, kind: '💪' })).ok, false, '中学生は送れない');
});

test('部屋の名前：自習室は「中学生自習室」', () => {
  assert.equal(SM.ZONES.find(z => z.id === 'study').name, '中学生自習室');
});
