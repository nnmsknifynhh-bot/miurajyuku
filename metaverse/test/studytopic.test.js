// 吹き出しテスト：先生・オーナーはどこでも。生徒は先生と話すとき（近く・個別通話中）だけ。自習室の生徒は今日の自習時間を表示
process.env.DB_PATH = ':memory:';
process.env.TOPIC_CHECK_MS = '200';
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

test('生徒は、先生が近くにいないと吹き出しを書けない', async () => {
  await walk(U.stu1.c, 10, 23);
  const r = await ask(U.stu1.c, 'study-topic', { text: '数学' });
  assert.equal(r.ok, false);
  assert.match(r.error, /先生と話すときだけ/);
});

test('先生が近くに来ると書ける。全員に届く（HTMLの記号は取り除き、24文字まで）', async () => {
  await walk(U.tch1.c, 11, 22);
  const r = await ask(U.stu1.c, 'study-topic', { text: '数学：<b>連立方程式</b>の文章題をがんばる！ここまでで二十四文字以上' });
  assert.equal(r.ok, true);
  assert.ok(!/[<>]/.test(r.topic)); assert.ok(r.topic.length <= 24);
  await sleep(80);
  assert.equal(lastTopic(U.stu2.c, U.stu1.id), r.topic);
  assert.equal(lastTopic(U.tch1.c, U.stu1.id), r.topic);
});

test('あとから入った人にも見える。自習室の生徒には今日の自習時間（10分単位）がつく', async () => {
  const late = await connect(U.stu2.cookie);
  const init = late.events.find(e => e.ev === 'init').d;
  const s1 = init.users.find(u => u.id === U.stu1.id);
  assert.ok(s1.topic.startsWith('数学'));
  assert.equal(s1.today, 0);
  assert.equal(init.users.find(u => u.id === U.tch1.id).today, null, '先生にはつかない');
  U.stu2.c = late;
});

test('先生・オーナーはどこでも書ける', async () => {
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

test('先生がはなれると、生徒の吹き出しは自動で消える', async () => {
  assert.equal((await ask(U.stu1.c, 'study-topic', { text: '英語の単語' })).ok, true);
  await sleep(80);
  assert.equal(lastTopic(U.stu2.c, U.stu1.id), '英語の単語');
  await walk(U.tch1.c, 16, 17);
  await sleep(500);
  assert.equal(lastTopic(U.stu2.c, U.stu1.id), null);
  assert.ok(U.stu1.c.events.filter(e => e.ev === 'topic-cleared').some(e => e.d.by === null));
});

test('生徒のスタンプも、先生が近くにいるときだけ届く', async () => {
  const got = () => U.stu2.c.events.filter(e => e.ev === 'reaction' && e.d.id === U.stu1.id).length;
  const before = got();
  U.stu1.c.s.emit('reaction', '👍'); await sleep(150);
  assert.equal(got(), before, '先生が遠いと届かない');
  await walk(U.tch1.c, 11, 22);
  await sleep(1300); // 連打よけの間かく
  U.stu1.c.s.emit('reaction', '👍'); await sleep(150);
  assert.equal(got(), before + 1, '先生が近くにいると届く');
});

test('頭の上の今日の自習時間：10分までは1分ごと、1時間までは5分ごと、それより上は10分ごと', () => {
  const { shownToday } = require('../server/realtime.js');
  assert.deepEqual([0, 1, 7, 9, 10, 14, 15, 59, 60, 67, 89, 125].map(shownToday), [0, 1, 7, 9, 10, 10, 15, 55, 60, 60, 80, 120]);
});
