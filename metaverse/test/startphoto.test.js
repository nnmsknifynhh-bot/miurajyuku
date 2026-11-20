// 入室前の写真（今日最初に取り組むページ）：今日まだ撮っていない生徒は入れない・オーナーだけ見られる・オン/オフ
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js'); void SM;
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
function connectAny(cookie) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('init', () => resolve('init'));
    s.on('photo-required', () => resolve('photo-required'));
    s.on('connect_error', reject);
  });
}
const jpeg = (n = 2000) => { const b = Buffer.alloc(n, 7); b[0] = 0xff; b[1] = 0xd8; return b; };
async function post(path, buf, cookie) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Cookie: cookie }, body: buf });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let owner; const U = {};
test('準備：オーナー・生徒・先生。入室前の写真をオンにする', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  for (const [k, role] of [['taro', 'student'], ['tch1', 'teacher']]) {
    const r = await http('POST', '/api/admin/users', { role, grade: role === 'student' ? '中2' : undefined, loginId: k, displayName: k, password: 'password123' }, owner);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  }
  assert.equal((await http('PATCH', '/api/admin/settings', { startPhoto: true }, U.tch1.cookie)).status, 403);
  assert.equal((await http('PATCH', '/api/admin/settings', { startPhoto: true }, owner)).data.startPhoto, true);
});

test('今日まだ撮っていない生徒は入れない（先生は関係なし）', async () => {
  assert.equal((await http('GET', '/api/me/start-photo', null, U.taro.cookie)).data.required, true);
  assert.equal(await connectAny(U.taro.cookie), 'photo-required');
  assert.equal(await connectAny(U.tch1.cookie), 'init');
});

test('写真を送ると入れる（JPEG だけ・大きすぎはだめ）', async () => {
  assert.equal((await post('/api/me/start-photo', Buffer.from('hello world, not a jpeg at all........................................................................'), U.taro.cookie)).status, 400);
  assert.equal((await post('/api/me/start-photo', jpeg(), U.tch1.cookie)).status, 403, '先生は送れない');
  const r = await post('/api/me/start-photo', jpeg(), U.taro.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await http('GET', '/api/me/start-photo', null, U.taro.cookie)).data.required, false);
  assert.equal(await connectAny(U.taro.cookie), 'init');
});

test('写真はオーナーだけが日ごとに見られる', async () => {
  const day = G.jst().day;
  const l = await http('GET', '/api/admin/start-photos?day=' + day, null, owner);
  assert.equal(l.status, 200);
  assert.equal(l.data.photos.length, 1); assert.equal(l.data.photos[0].name, 'taro');
  const img = await fetch(`${base}/api/admin/start-photos/${U.taro.id}/${day}`, { headers: { Cookie: owner } });
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await img.arrayBuffer()).length, 2000);
  assert.equal((await http('GET', '/api/admin/start-photos?day=' + day, null, U.tch1.cookie)).status, 403);
  assert.equal((await http('GET', '/api/admin/start-photos?day=' + day, null, U.taro.cookie)).status, 403);
});

test('オフにすると写真なしで入れる', async () => {
  await http('PATCH', '/api/admin/settings', { startPhoto: false }, owner);
  const r = await http('POST', '/api/admin/users', { role: 'student', grade: '中1', loginId: 'hana', displayName: 'hana', password: 'password123' }, owner);
  const ck = (await http('POST', '/api/login', { loginId: 'hana', password: 'password123' })).cookie;
  assert.equal((await http('GET', '/api/me/start-photo', null, ck)).data.required, false);
  assert.equal(await connectAny(ck), 'init');
  void r;
});
