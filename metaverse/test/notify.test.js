// 入室の通知テスト：アプリを開いている先生には画面に、閉じている先生にはプッシュ通知
process.env.DB_PATH = ':memory:';
process.env.REJOIN_QUIET_MS = '600';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const app = require('../server/server.js');
const notify = require('../server/notify.js');

// 本物のプッシュ通知サービスの代わりに、送った内容を記録する
const pushes = [];
let failNext = null;
notify._setWebPush({
  generateVAPIDKeys: () => ({ publicKey: 'BPUBLICKEYTEST', privateKey: 'privatekeytest' }),
  setVapidDetails: () => {},
  sendNotification: async (sub, payload) => {
    if (failNext) { const e = Object.assign(new Error('gone'), { statusCode: failNext }); failNext = null; throw e; }
    pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  },
});

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
    const c = { s, events: [] };
    s.onAny((ev, d) => c.events.push({ ev, d }));
    s.on('init', () => resolve(c));
    s.on('connect_error', reject);
  });
}
const sub = (n) => ({ endpoint: `https://push.example.test/${n}`, keys: { p256dh: 'BKEY' + n, auth: 'AUTH' + n } });
const arrived = (c) => c.events.filter(e => e.ev === 'student-arrived');

let owner; const U = {};
test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (k, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: k, displayName: k }, owner);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  };
  await add('stu1', { role: 'student' }); await add('stu2', { role: 'student' });
  await add('tch1', { role: 'teacher', rooms: ['class1'] }); await add('tch2', { role: 'teacher', rooms: ['class2'] });
});

test('通知の設定は先生・オーナーだけ。最初はオン', async () => {
  assert.equal((await http('GET', '/api/notify', null, U.stu1.cookie)).status, 403);
  const r = await http('GET', '/api/notify', null, U.tch1.cookie);
  assert.equal(r.data.prefs.arrivals, true);
  assert.ok(r.data.publicKey);
});

test('端末の登録：正しくない内容は拒否、正しければ登録される', async () => {
  assert.equal((await http('POST', '/api/notify/subscribe', { subscription: { endpoint: 'http://evil' } }, owner)).status, 400);
  assert.equal((await http('POST', '/api/notify/subscribe', { subscription: sub(1), device: 'iPhone/iPad' }, owner)).data.devices, 1);
  assert.equal((await http('POST', '/api/notify/subscribe', { subscription: sub(2), device: 'Windows' }, U.tch2.cookie)).data.devices, 1);
  assert.equal((await http('POST', '/api/notify/subscribe', { subscription: sub(3) }, U.stu1.cookie)).status, 403);
});

test('生徒が入室すると、アプリを開いている先生には画面に、閉じている人にはプッシュ通知が届く', async () => {
  U.tch1.c = await connect(U.tch1.cookie);   // 開いている
  pushes.length = 0;
  U.stu1.c = await connect(U.stu1.cookie);
  await sleep(150);
  assert.equal(arrived(U.tch1.c).length, 1);
  assert.equal(arrived(U.tch1.c)[0].d.name, 'stu1');
  const targets = pushes.map(p => p.endpoint).sort();
  assert.deepEqual(targets, [sub(1).endpoint, sub(2).endpoint], 'オーナーと先生2の端末へ');
  assert.match(pushes[0].payload.title, /stu1さんが入室しました/);
});

test('先生が入っても通知しない。すぐに入り直した生徒も通知しない', async () => {
  pushes.length = 0;
  const before = arrived(U.tch1.c).length;
  U.tch2.c = await connect(U.tch2.cookie);
  U.stu1.c.s.disconnect(); await sleep(100);
  U.stu1.c = await connect(U.stu1.cookie);
  await sleep(150);
  assert.equal(arrived(U.tch1.c).length, before);
  assert.equal(pushes.length, 0);
});

test('しばらくたってから入り直すと、また通知する', async () => {
  U.stu1.c.s.disconnect();
  await sleep(700);
  U.stu1.c = await connect(U.stu1.cookie);
  await sleep(150);
  assert.equal(arrived(U.tch2.c).length, 1);
});

test('通知をオフにした人には届かない', async () => {
  await http('PATCH', '/api/notify', { arrivals: false }, U.tch1.cookie);
  await http('PATCH', '/api/notify', { arrivals: false }, owner);
  pushes.length = 0;
  const before = arrived(U.tch1.c).length;
  U.stu2.c = await connect(U.stu2.cookie);
  await sleep(150);
  assert.equal(arrived(U.tch1.c).length, before);
  assert.ok(!pushes.some(p => p.endpoint === sub(1).endpoint));
  await http('PATCH', '/api/notify', { arrivals: true }, owner);
});

test('テスト通知が送れる。端末側で無効になった登録（410）は自動で削除', async () => {
  pushes.length = 0;
  assert.equal((await http('POST', '/api/notify/test', {}, owner)).data.sent, 1);
  failNext = 410;
  assert.equal((await http('POST', '/api/notify/test', {}, owner)).data.sent, 0);
  assert.equal((await http('GET', '/api/notify', null, owner)).data.devices, 0);
});
