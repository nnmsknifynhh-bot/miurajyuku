// 自習中に通信が切れても、すぐもどれば元の席にもどり、切れていた間も自習時間に数える
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');

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
    const c = { s, me: null, events: [] };
    s.onAny((ev, d) => c.events.push({ ev, d }));
    s.on('init', (d) => { c.me = d.me; resolve(c); });
    s.on('connect_error', reject);
  });
}
async function walk(c, tx, ty) {
  for (const step of SM.findPath(Math.floor(c.me.x / T), Math.floor(c.me.y / T), tx, ty)) {
    const p = SM.tileCenter(step.x, step.y);
    c.s.emit('move', { x: p.x, y: p.y, dir: 'up' }); await sleep(25); c.me.x = p.x; c.me.y = p.y;
  }
  await sleep(80);
}
const ask = (c, ev, d) => new Promise(r => c.s.emit(ev, d, r));
const G = require('../server/ganbari.js');

let owner; const U = {};
test('準備：自習室の席にすわる', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const r = await http('POST', '/api/admin/users', { password: 'password123', role: 'student', loginId: 'stu1', displayName: 'stu1' }, owner);
  U.id = r.data.user.id;
  U.cookie = (await http('POST', '/api/login', { loginId: 'stu1', password: 'password123' })).cookie;
  U.c = await connect(U.cookie);
  await walk(U.c, 2, 22);
  const sit = await ask(U.c, 'sit', '2,21');
  assert.equal(sit.ok, true);
});

test('通信が切れて、すぐつながり直すと元の席にもどる', async () => {
  U.c.s.disconnect(); await sleep(150);
  const again = await connect(U.cookie);
  assert.equal(again.me.seat, '2,21');
  assert.equal(again.me.room, 'study');
  await sleep(50);
  assert.ok(again.events.some(e => e.ev === 'study-resumed'), 'お知らせが届く');
  U.c = again;
});

test('前の接続が残ったまま、つながり直したときも元の席にもどる', async () => {
  const again = await connect(U.cookie); // U.c はまだつながっている
  assert.equal(again.me.seat, '2,21');
  U.c = again;
});

test('離席中（ほかのアプリを見ている）に切れたときは、元にもどさない', async () => {
  U.c.s.emit('away', { away: 'hidden' }); await sleep(80);
  U.c.s.disconnect(); await sleep(150);
  const again = await connect(U.cookie);
  assert.equal(again.me.seat, null);
  assert.ok(!again.events.some(e => e.ev === 'study-resumed'));
  U.c = again;
});

test('切れていた間の自習時間：最大5分・数える時間帯と1日の上限は守る', () => {
  const day = G.addDays(G.getConfig().terms[1], 3);
  const t0 = new Date(`${day}T19:00:00+09:00`).getTime();
  assert.equal(G.creditGap(U.id, t0, t0 + 3.5 * 60_000), 3, '3分半 → 3分');
  assert.equal(G.creditGap(U.id, t0, t0 + 20 * 60_000), 5, '最大5分');
  assert.equal(G.dayTotal(U.id, day), 8);
  G.setConfig({ window: { start: '18:00', end: '19:02' } });
  assert.equal(G.creditGap(U.id, t0, t0 + 5 * 60_000), 1, '時間帯の外は数えない');
  G.setConfig({ window: { start: '00:00', end: '24:00' }, dailyCap: 10 });
  assert.equal(G.creditGap(U.id, t0, t0 + 5 * 60_000), 1, '1日の上限まで');
  G.setConfig({ dailyCap: 300 });
});
