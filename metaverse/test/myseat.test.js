// ⭐ マイ席：🔥30日（高校生は4週）でえらべる・ほかの子のマイ席はえらべない・🔥がとぎれたら返す・名前プレートの見え方
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const app = require('../server/server.js');
const G = require('../server/ganbari.js');
const M = require('../server/myseat.js');
const { db } = require('../server/db.js');

let base, server;
const sockets = [];
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
    sockets.push(s); s.on('init', (d) => resolve({ s, init: d })); s.on('connect_error', reject);
  });
}
const days30 = (id, n = 30) => { const t = G.jst().day; for (let i = 0; i < n; i++) db.prepare('INSERT OR REPLACE INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, 0, 70)').run(id, G.addDays(t, -i)); };

let owner; const U = {};
test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  for (const k of ['aaa', 'bbb']) {
    const r = await http('POST', '/api/admin/users', { role: 'student', loginId: k, displayName: k + 'さん', grade: '中2', password: 'password123' }, owner);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  }
});

test('🔥30日まではえらべない・30日でえらべる', async () => {
  days30(U.aaa.id, 29);
  let r = await http('GET', '/api/me/myseat', null, U.aaa.cookie);
  assert.equal(r.data.eligible, false); assert.equal(r.data.need, 30); assert.equal(r.data.room, 'study');
  assert.equal((await http('POST', '/api/me/myseat', { seat: r.data.seats[0].id }, U.aaa.cookie)).status, 400);
  days30(U.aaa.id, 30);
  r = await http('GET', '/api/me/myseat', null, U.aaa.cookie);
  assert.equal(r.data.eligible, true);
  const seat = r.data.seats[3].id;
  assert.equal((await http('POST', '/api/me/myseat', { seat: '1,1' }, U.aaa.cookie)).status, 400, '自習室の席だけ');
  const c = await http('POST', '/api/me/myseat', { seat }, U.aaa.cookie);
  assert.equal(c.status, 200);
  U.aaa.seat = seat;
  // ほかの子は同じ席をえらべない
  days30(U.bbb.id, 30);
  const r2 = await http('GET', '/api/me/myseat', null, U.bbb.cookie);
  assert.equal(r2.data.seats.find(s => s.id === seat).taken, true);
  assert.equal((await http('POST', '/api/me/myseat', { seat }, U.bbb.cookie)).status, 400);
  // 名前プレート：生徒には名前が見える
  const b = await connect(U.bbb.cookie);
  assert.deepEqual(b.init.mySeats.map(s => [s.seat, s.name]), [[seat, 'aaaさん']]);
  // ほかの子もふつうにすわれる（本人がいないとき）
  assert.equal(M.list().length, 1);
});

test('🔥がとぎれたら返す', () => {
  db.prepare('DELETE FROM study_days WHERE user_id = ? AND day >= ?').run(U.aaa.id, G.addDays(G.jst().day, -2));
  assert.equal(M.checkKeep(U.aaa.id), true);
  assert.equal(M.statusOf(U.aaa.id).seat, null);
  assert.equal(M.checkKeep(U.bbb.id), false, 'マイ席がない子は何もしない');
});
