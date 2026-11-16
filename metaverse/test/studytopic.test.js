// 吹き出しテスト（全員・どの部屋でも）
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
const lastTopic = (c, id) => [...c.events].reverse().find(e => e.ev === 'user-updated' && e.d.id === id && 'topic' in e.d)?.d.topic;

let owner; const U = {};
test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (k, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: k, displayName: k }, owner);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  };
  await add('stu1', { role: 'student' }); await add('stu2', { role: 'student' });
  await add('tch1', { role: 'teacher', rooms: ['class1'] });
  for (const k of Object.keys(U)) U[k].c = await connect(U[k].cookie);
});

test('ロビー（自習室の外）でも書ける', async () => {
  const r = await ask(U.stu1.c, 'study-topic', { text: '数学' });
  assert.equal(r.ok, true);
  await sleep(80);
  assert.equal(lastTopic(U.stu2.c, U.stu1.id), '数学');
});

test('自習室で書くと全員に吹き出しが届く（HTMLの記号は取り除き、24文字まで）', async () => {
  await walk(U.stu1.c, 10, 23);
  const r = await ask(U.stu1.c, 'study-topic', { text: '数学：<b>連立方程式</b>の文章題をがんばる！ここまでで二十四文字以上' });
  assert.equal(r.ok, true);
  assert.ok(!/[<>]/.test(r.topic)); assert.ok(r.topic.length <= 24);
  await sleep(80);
  assert.equal(lastTopic(U.stu2.c, U.stu1.id), r.topic);
  assert.equal(lastTopic(U.tch1.c, U.stu1.id), r.topic);
});

test('あとから入った人にも見える', async () => {
  const late = await connect(U.stu2.cookie);
  const init = late.events.find(e => e.ev === 'init').d;
  assert.ok(init.users.find(u => u.id === U.stu1.id).topic.startsWith('数学'));
  U.stu2.c = late;
});

test('先生・オーナーも書ける', async () => {
  const r = await ask(U.tch1.c, 'study-topic', { text: '質問受付中' });
  assert.equal(r.ok, true);
  await sleep(80);
  assert.equal(lastTopic(U.stu2.c, U.tch1.id), '質問受付中');
  const ownerSock = await connect(owner);
  assert.equal((await ask(ownerSock, 'study-topic', { text: '面談中' })).ok, true);
  ownerSock.s.disconnect();
});

test('生徒はほかの人の吹き出しを消せない。先生は消せる', async () => {
  assert.equal((await ask(U.stu2.c, 'study-topic-clear', U.stu1.id)).ok, false);
  assert.equal((await ask(U.tch1.c, 'study-topic-clear', U.stu1.id)).ok, true);
  await sleep(80);
  assert.equal(lastTopic(U.stu2.c, U.stu1.id), null);
  assert.ok(U.stu1.c.events.some(e => e.ev === 'topic-cleared'));
});

test('部屋を移動しても吹き出しは残る。自分で消すと消える', async () => {
  await ask(U.stu1.c, 'study-topic', { text: '英語の単語' });
  await walk(U.stu1.c, 16, 17);
  await sleep(80);
  assert.equal(lastTopic(U.stu2.c, U.stu1.id), '英語の単語');
  assert.equal((await ask(U.stu1.c, 'study-topic', { text: '' })).topic, null);
  await sleep(80);
  assert.equal(lastTopic(U.stu2.c, U.stu1.id), null);
});
