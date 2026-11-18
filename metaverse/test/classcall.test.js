// 第3段階 授業（全体通話・画面共有）テスト
// LiveKit 本体には接続せず、トークンの中身と「サーバーから退出させる」呼び出しを検証する
process.env.DB_PATH = ':memory:';
process.env.LIVEKIT_URL = 'wss://test-project.livekit.cloud';
process.env.LIVEKIT_API_KEY = 'APItestkey';
process.env.LIVEKIT_API_SECRET = 'testsecret-testsecret-testsecret-0123456789';
process.env.CLASS_GRACE_MS = '800';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');
const livekit = require('../server/livekit.js');

const T = SM.TILE;
const calls = [];
livekit._setService({
  removeParticipant: async (room, identity) => { calls.push(['remove', room, identity]); },
  deleteRoom: async (room) => { calls.push(['delete', room]); },
});

let base, server;
const sockets = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
test.before(async () => {
  server = app.createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { sockets.forEach(s => s.disconnect()); server.close(); setTimeout(() => process.exit(0), 200).unref(); });

async function http(method, path, body, cookie) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const sc = res.headers.get('set-cookie');
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie, headers: res.headers };
}
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    sockets.push(s);
    const c = { s, events: [], me: null, classes: {}, rejected: [] };
    s.onAny((ev, data) => c.events.push({ ev, data }));
    s.on('init', (d) => { c.me = d.me; c.classes = d.classes; resolve(c); });
    s.on('class-state', (d) => { c.classes = d; });
    s.on('move-rejected', (d) => { c.rejected.push(d.reason); c.me.x = d.x; c.me.y = d.y; });
    s.on('connect_error', reject);
  });
}
async function walk(c, tx, ty) {
  const path = SM.findPath(Math.floor(c.me.x / T), Math.floor(c.me.y / T), tx, ty);
  const before = c.rejected.length;
  for (const step of path) {
    const p = SM.tileCenter(step.x, step.y);
    c.s.emit('move', { x: p.x, y: p.y, dir: 'up' });
    await sleep(25);
    if (c.rejected.length > before) return false;
    c.me.x = p.x; c.me.y = p.y;
  }
  await sleep(60);
  return true;
}
const ask = (c, ev, d = {}) => new Promise(r => c.s.emit(ev, d, r));
const jwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url'));

let owner;
const U = {};
test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (key, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: key, displayName: key }, owner);
    assert.equal(r.status, 201, key);
    U[key] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: key, password: 'password123' })).cookie };
  };
  await add('tch1', { role: 'teacher', rooms: ['class2'] });
  await add('tch2', { role: 'teacher', rooms: ['class2'] });
  await add('tch3', { role: 'teacher', rooms: ['class2'], permissions: { enter_classroom: true, start_class_call: true, share_screen: false, handle_students: true, start_private_call: true, manage_classroom: false } });
  await add('stu1', { role: 'student' });
  await add('stu2', { role: 'student' });
  for (const k of Object.keys(U)) U[k].c = await connect(U[k].cookie);
});

test('画面の設定：LiveKit への接続が CSP で許可され、ライブラリが配信される', async () => {
  const r = await http('GET', '/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /wss:\/\/test-project\.livekit\.cloud/);
  assert.match(csp, /wss:\/\/\*\.livekit\.cloud/);
  const lib = await fetch(base + '/vendor/livekit-client.umd.js');
  assert.equal(lib.status, 200);
  assert.equal((await http('GET', '/api/me', null, U.stu1.cookie)).data.features.classCall, true);
});

test('生徒は授業を始められない。先生も教室の外では始められない', async () => {
  assert.equal((await ask(U.stu1.c, 'class-start')).ok, false);
  const r = await ask(U.tch1.c, 'class-start');
  assert.equal(r.ok, false);
  assert.match(r.error, /担当の教室/);
});

test('先生が担当教室で授業を始めると、全員に「授業中」が伝わる', async () => {
  assert.equal(await walk(U.tch1.c, 25, 1), true);
  assert.equal((await ask(U.tch1.c, 'class-start')).ok, true);
  await sleep(100);
  assert.equal(U.stu1.c.classes.class2.teacherName, 'tch1');
  // 同じ教室の別の先生は重ねて始められない
  assert.equal(await walk(U.tch3.c, 26, 1), true);
  const r = await ask(U.tch3.c, 'class-start');
  assert.equal(r.ok, false);
  assert.match(r.error, /tch1先生が授業中/);
});

test('トークン：授業を始めた先生だけがマイク・画面共有を送れる', async () => {
  const t = await ask(U.tch1.c, 'lk-token');
  assert.equal(t.ok, true);
  assert.equal(t.url, 'wss://test-project.livekit.cloud');
  const g = jwt(t.token).video;
  assert.equal(g.room, 'miura-class-class2');
  assert.equal(g.canPublish, true);
  assert.deepEqual(g.canPublishSources, ['microphone', 'screen_share', 'screen_share_audio']);
  assert.equal(g.canPublishData, false);
  assert.ok(!g.roomRecord && !g.roomAdmin, '録画・管理権限は付けない');
  // 同じ教室の別の先生は聞くだけ
  const t3 = jwt((await ask(U.tch3.c, 'lk-token')).token).video;
  assert.equal(t3.canPublish, false);
});

test('トークン：教室にいる生徒は聞くだけ。教室の外・授業のない教室では発行されない', async () => {
  assert.equal((await ask(U.stu1.c, 'lk-token')).ok, false, 'ロビーにいる生徒');
  assert.equal(await walk(U.stu1.c, 22, 6), true);
  const r = await ask(U.stu1.c, 'lk-token');
  assert.equal(r.ok, true);
  const g = jwt(r.token).video;
  assert.equal(g.canPublish, false);
  assert.deepEqual(g.canPublishSources || [], []);
  assert.equal(g.canSubscribe, true);
  assert.equal(jwt(r.token).sub, `u-${U.stu1.id}`);
  assert.equal(await walk(U.stu2.c, 10, 23), true); // 自習室（授業の教室ではない）
  assert.equal((await ask(U.stu2.c, 'lk-token')).ok, false);
});

test('授業中の生徒のスタンプ・吹き出しは、先生がOKにしたときだけ（最初は止めている）', async () => {
  // stu1 は授業中の class1 にいる
  assert.equal(U.stu1.c.classes.class2.allowChat, false);
  const topic = await ask(U.stu1.c, 'study-topic', { text: 'わかった！' });
  assert.equal(topic.ok, false);
  assert.match(topic.error, /先生がOKを出したとき/);
  assert.equal((await ask(U.stu1.c, 'class-chat', { allow: true })).ok, false, '生徒は切りかえられない');
  assert.equal((await ask(U.tch3.c, 'class-chat', { allow: true })).ok, false, '授業をしていない先生も切りかえられない');
  assert.equal((await ask(U.tch1.c, 'class-chat', { allow: true })).ok, true);
  await sleep(80);
  assert.equal(U.stu1.c.classes.class2.allowChat, true);
  assert.equal((await ask(U.stu1.c, 'study-topic', { text: 'わかった！' })).ok, true);
  const n = () => U.tch1.c.events.filter(e => e.ev === 'reaction' && e.data.id === U.stu1.id).length;
  const before = n();
  U.stu1.c.s.emit('reaction', '👍'); await sleep(120);
  assert.equal(n(), before + 1, 'OKのときはスタンプが届く');
  // 止めると、吹き出しは消え、スタンプも届かない
  assert.equal((await ask(U.tch1.c, 'class-chat', { allow: false })).ok, true);
  await sleep(80);
  assert.ok(U.stu1.c.events.some(e => e.ev === 'topic-cleared' && e.data.reason === 'class'));
  await sleep(1300);
  U.stu1.c.s.emit('reaction', '👍'); await sleep(120);
  assert.equal(n(), before + 1, '止めているときは届かない');
});

test('画面共有の権限がない先生にはトークンに画面共有が入らない', async () => {
  await ask(U.tch1.c, 'class-end');
  assert.equal((await ask(U.tch3.c, 'class-start')).ok, true);
  await sleep(1600);
  const g = jwt((await ask(U.tch3.c, 'lk-token')).token).video;
  assert.deepEqual(g.canPublishSources, ['microphone']);
  // 表示用の状態でも画面共有にならない
  U.tch3.c.s.emit('class-media', { mic: true, screen: true });
  await sleep(100);
  assert.equal(U.stu1.c.classes.class2.screen, false);
  assert.equal(U.stu1.c.classes.class2.mic, true);
  await ask(U.tch3.c, 'class-end');
});

test('生徒は授業を終了できない。教室を出た生徒は LiveKit から退出させられる', async () => {
  assert.equal((await ask(U.tch1.c, 'class-start')).ok, true);
  assert.equal((await ask(U.stu1.c, 'class-end')).ok, false);
  calls.length = 0;
  assert.equal(await walk(U.stu1.c, 31, 16), true); // ろうかへ
  assert.deepEqual(calls, [['remove', 'miura-class-class2', `u-${U.stu1.id}`]]);
});

test('先生が教室を出ると授業は終了し、LiveKit の部屋も閉じる', async () => {
  calls.length = 0;
  assert.equal(await walk(U.tch1.c, 31, 15), true);
  await sleep(100);
  assert.ok(calls.some(c => c[0] === 'delete' && c[1] === 'miura-class-class2'));
  assert.equal(U.stu1.c.classes.class2, undefined);
  assert.ok(U.stu1.c.events.some(e => e.ev === 'class-ended'));
});

test('先生の通信が切れても、すぐに再接続すれば授業は続く。戻らなければ自動終了', async () => {
  assert.equal(await walk(U.tch1.c, 25, 1), true);
  assert.equal((await ask(U.tch1.c, 'class-start')).ok, true);
  U.tch1.c.s.disconnect();
  await sleep(200);
  U.tch1.c = await connect(U.tch1.cookie);       // 再接続（元の場所＝教室1に戻る）
  await sleep(900);
  assert.ok(U.stu1.c.classes.class2, '授業が続いている');
  U.tch1.c.s.disconnect();
  await sleep(1100);
  assert.equal(U.stu1.c.classes.class2, undefined, '戻らなかったので終了');
  U.tch1.c = await connect(U.tch1.cookie);
});

test('授業中に先生の通話権限を外すと授業が終了する', async () => {
  assert.equal((await ask(U.tch1.c, 'class-start')).ok, true);
  await http('PATCH', `/api/admin/users/${U.tch1.id}`, { permissions: { enter_classroom: true, start_class_call: false } }, owner);
  await sleep(150);
  assert.equal(U.stu1.c.classes.class2, undefined);
  await http('PATCH', `/api/admin/users/${U.tch1.id}`, { permissions: { enter_classroom: true, start_class_call: true, share_screen: true } }, owner);
});

test('オーナーは管理画面から授業を終了できる。先生は終了 API を使えない', async () => {
  assert.equal((await ask(U.tch1.c, 'class-start')).ok, true);
  assert.equal((await http('POST', '/api/admin/classes/class2/end', {}, U.tch1.cookie)).status, 403);
  const r = await http('GET', '/api/admin/presence', null, owner);
  assert.equal(r.data.classes.class2.teacherName, 'tch1');
  assert.equal((await http('POST', '/api/admin/classes/class2/end', {}, owner)).status, 200);
  await sleep(100);
  assert.equal(U.stu1.c.classes.class2, undefined);
});
