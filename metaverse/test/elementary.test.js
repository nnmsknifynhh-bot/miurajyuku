// 小学生：小学生自習室（教室2を改装）・小学生だけ入れる・小学生はロビーと小学生自習室だけ・数え方（6:00〜7:30・15:00〜18:00）・🔥45分・小学生の木
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

const at = (day, hm = '12:00') => new Date(`${day}T${hm}:00+09:00`);
const today = () => G.jst().day;
let owner; const U = {};
test('準備：小学生・中学生・先生', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  for (const [k, grade] of [['es5', '小5'], ['jh2', '中2']]) {
    const r = await http('POST', '/api/admin/users', { role: 'student', grade, loginId: k, displayName: k, password: 'password123' }, owner);
    U[k] = { id: r.data.user.id, user: r.data.user, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  }
});

test('小学生自習室：教室2が自習室に（授業もできる）。座席は24', () => {
  const z = SM.ZONES.find(v => v.id === 'class2');
  assert.equal(z.name, '小学生自習室'); assert.equal(z.type, 'study');
  assert.ok(SM.isStudyRoom('class2')); assert.ok(SM.isLessonRoom('class2'));
  assert.equal(SM.seatCount('class2'), 24);
  assert.equal(SM.FOREST.length, 5, '小学生の木');
});

test('入れる部屋：小学生は小学生自習室だけ、小学生自習室は小学生だけ', async () => {
  const P = require('../server/permissions.js');
  const room = (id, type) => ({ id, type });
  const es = { role: 'student', grade: '小5' }, jh = { role: 'student', grade: '中2' };
  assert.equal(P.canEnterRoom(es, room('class2', 'study')), true);
  for (const id of ['study', 'class1', 'class3']) assert.equal(P.canEnterRoom(es, room(id, 'study')), false, id);
  assert.equal(P.canEnterRoom(jh, room('class2', 'study')), false);
  assert.equal(P.canEnterRoom(jh, room('study', 'study')), true);
  // 実際に歩いて入る
  const c = await connect(U.es5.cookie);
  const e = SM.ENTRY.class2;
  assert.ok(await walk(c, e.x, e.y), c.rejected.join());
  const j = await connect(U.jh2.cookie);
  assert.equal(await walk(j, e.x, e.y), false);
  assert.ok(j.rejected.some(r => /小学生の部屋/.test(r)), j.rejected.join());
  c.s.disconnect(); j.s.disconnect();
});

test('数え方：小学生は 6:00〜7:30・15:00〜18:00 がポイント。🔥は1日45分', () => {
  const c = G.getConfig();
  assert.deepEqual(c.es.window, { start: '06:00', end: '07:30' });
  assert.deepEqual(c.es.window2, { start: '15:00', end: '18:00' });
  assert.equal(G.streakMinFor(U.es5.id), 45);
  const day = G.addDays(today(), -30);
  const pres = (u, room) => ({ id: u.id, user: { role: 'student', grade: u.user.grade }, room, seat: room === 'class2' ? '19,4' : '2,21', away: null, studyCam: true });
  const online = new Map([[1, pres(U.es5, 'class2')], [2, pres(U.jh2, 'study')]]);
  G.setConfig({ window: { start: '19:00', end: '23:00' }, window2: null });
  assert.deepEqual(G.tick(online, { date: at(day, '16:00') }), [U.es5.id], '16時：小学生だけポイント');
  assert.deepEqual(G.tick(online, { date: at(day, '20:00') }), [U.jh2.id], '20時：中学生だけポイント');
  assert.deepEqual(G.tick(online, { date: at(day, '20:01') }).counted.sort(), [U.es5.id, U.jh2.id].sort(), '勉強時間（全部）はどちらも');
  assert.match(G.setConfig({ es: { window: { start: '18:00', end: '15:00' } } }), /^小学生：/);
});

test('小学生の木：小学生の時間で育つ', () => {
  const f = G.forest();
  assert.equal(f.trees.length, 5);
  assert.equal(f.trees[4].name, '小学生の木');
  assert.deepEqual(f.trees[4].grades, ['小1', '小2', '小3', '小4', '小5', '小6']);
});

test('小学生ショップ：買えるのは小学生用だけ・半分くらいの値段・1か月に1回まで。ほかは🔒', () => {
  const { db } = require('../server/db.js');
  G.setManual(U.es5.id, G.addDays(today(), -3), 600, null); // 60ポイント分
  const shop = G.shopFor(U.es5.id);
  const cap = shop.find(i => i.id === 'cap'), dragon = shop.find(i => i.id === 'dragon');
  assert.equal(cap.price, 10); assert.equal(cap.locked, false);
  assert.equal(dragon.locked, true);
  assert.match(G.buy(U.es5.id, 'dragon'), /中学生になったら/);
  assert.equal(G.buy(U.es5.id, 'cap'), null);
  assert.match(G.buy(U.es5.id, 'chick'), /1か月に1回/);
  assert.equal(G.esBoughtThisMonth(U.es5.id), true);
  // 先月に買ったことにすると、今月また買える
  db.prepare("UPDATE shop_owned SET bought_at = '2000-01-15T00:00:00.000Z' WHERE user_id = ?").run(U.es5.id);
  assert.equal(G.buy(U.es5.id, 'chick'), null);
  // 中学生はふつう
  assert.equal(G.shopFor(U.jh2.id).find(i => i.id === 'cap').price, 20);
});

test('小学生の今日の目標時間：写真といっしょに決める（小学生だけ）', async () => {
  const S = require('../server/startphoto.js');
  assert.equal(S.setGoal(U.es5.id, 7), '目標の時間をえらんでください');
  assert.equal(S.setGoal(U.es5.id, 45), null);
  assert.equal(S.goalOf(U.es5.id), 45);
  const g = (await http('GET', '/api/me/ganbari', null, U.es5.cookie)).data.dailyGoal;
  assert.equal(g.minutes, 45);
  assert.equal((await http('GET', '/api/me/ganbari', null, U.jh2.cookie)).data.dailyGoal, null);
  assert.equal((await http('GET', '/api/me/start-photo', null, U.jh2.cookie)).data.goal, null, '中学生は目標なし');
  assert.ok((await http('GET', '/api/me/start-photo', null, U.es5.cookie)).data.goal.choices.includes(45));
});
