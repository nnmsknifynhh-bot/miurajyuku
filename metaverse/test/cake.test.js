// 誕生日：🎂を渡す（中高どうし・近くで・1日1回・先生は金色・小学生は先生からだけ）と、おうちの人の誕生日（メッセージ＋勉強時間のプレゼント）
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');
const G = require('../server/ganbari.js');
const B = require('../server/birthday.js');
const fun = require('../server/fun.js');
const { db } = require('../server/db.js');

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
  for (const st of path) { const p = SM.tileCenter(st.x, st.y); c.s.emit('move', { x: p.x, y: p.y, dir: 'up' }); await sleep(25); c.me.x = p.x; c.me.y = p.y; }
  await sleep(100);
  return true;
}
const ask = (c, ev, d) => new Promise(r => c.s.emit(ev, d, r));
const evs = (c, name) => c.events.filter(e => e.ev === name).map(e => e.d);
const todayMD = G.jst().day.slice(5);
const L = SM.ENTRY.lobby;
let owner; const U = {};

test('準備：誕生日の子（中2・小5・先生だけに見せる中3）と、ほかの子', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  const ALIAS = { jhs: 'jh', hsx: 'hs', esx: 'es' };
  const list = [['bday', '中2', todayMD, true], ['kidb', '小5', todayMD, true], ['secret', '中3', todayMD, false], ['jhs', '中1', null, true], ['hsx', '高1', null, true], ['esx', '小6', null, true]];
  for (const [k, grade, birthday, pub] of list) {
    const r = await http('POST', '/api/admin/users', { role: 'student', grade, loginId: k.length < 3 ? k + 'x' : k, displayName: k, password: 'password123', birthday, birthdayPublic: pub }, owner);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    U[ALIAS[k] || k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  }
});

test('🎂：近くの中学生・高校生だけが渡せる。同じ相手には1日1回。ポイントはふえない', async () => {
  for (const k of ['bday', 'jh', 'hs', 'es', 'kidb', 'secret']) U[k].c = await connect(U[k].cookie);
  assert.ok(await walk(U.bday.c, L.x, L.y));
  assert.ok(await walk(U.jh.c, L.x + 8, L.y));
  // 遠いと渡せない
  assert.match((await ask(U.jh.c, 'cake', { to: U.bday.id })).error, /近く/);
  assert.ok(await walk(U.jh.c, L.x + 1, L.y));
  const pts = G.points(U.jh.id).balance;
  const r = await ask(U.jh.c, 'cake', { to: U.bday.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  await sleep(150);
  assert.ok(evs(U.bday.c, 'cake-got').some(d => d.name === 'jhs' && !d.gold && d.n === 1));
  assert.ok(evs(U.hs.c, 'user-updated').some(d => d.id === U.bday.id && d.cakes && d.cakes.n === 1), 'ほかの子の名札にも🎂×1');
  assert.equal(G.points(U.jh.id).balance, pts, 'ポイントはなし');
  assert.match((await ask(U.jh.c, 'cake', { to: U.bday.id })).error, /もう渡した/);
  // 小学生は渡せない・小学生には渡せない・先生だけに見せる子には渡せない・誕生日でない子には渡せない
  assert.ok(await walk(U.es.c, L.x + 2, L.y));
  assert.match((await ask(U.es.c, 'cake', { to: U.bday.id })).error, /中学生・高校生と先生/);
  assert.ok(await walk(U.kidb.c, L.x, L.y + 1));
  assert.match((await ask(U.jh.c, 'cake', { to: U.kidb.id })).error, /渡せません/);
  assert.ok(await walk(U.secret.c, L.x + 1, L.y + 1));
  assert.match((await ask(U.jh.c, 'cake', { to: U.secret.id })).error, /渡せません/);
  assert.ok(await walk(U.hs.c, L.x + 2, L.y + 1));
  assert.match((await ask(U.jh.c, 'cake', { to: U.hs.id })).error, /誕生日の子/);
  // 高校生も渡せる → 🎂×2
  assert.equal((await ask(U.hs.c, 'cake', { to: U.bday.id })).ok, true);
  assert.deepEqual(B.cakesOf(U.bday.id), { n: 2, gold: 0 });
});

test('🌟🎂：先生・オーナーはだれにでも渡せる（小学生・先生だけに見せる子にも）', async () => {
  const oc = await connect(owner);
  assert.ok(await walk(oc, L.x + 1, L.y + 2));
  assert.equal((await ask(oc, 'cake', { to: U.kidb.id })).ok, true);
  assert.equal((await ask(oc, 'cake', { to: U.secret.id })).ok, true);
  assert.equal((await ask(oc, 'cake', { to: U.bday.id })).ok, true);
  await sleep(150);
  assert.ok(evs(U.kidb.c, 'cake-got').some(d => d.gold));
  assert.deepEqual(B.cakesOf(U.bday.id), { n: 3, gold: 1 });
  // 先生だけに見せる子の🎂の数は、ほかの生徒には届かない
  assert.ok(!evs(U.jh.c, 'user-updated').some(d => d.id === U.secret.id && d.cakes), '生徒には見えない');
  assert.ok(evs(U.secret.c, 'cake-got').length >= 1, '本人には届く');
  // 入りなおすと、渡した相手を覚えている
  const again = await connect(U.jh.cookie);
  assert.ok(again.me.cakeGiven.includes(U.bday.id));
  again.s.disconnect();
});

test('ロビーの掲示板に「今日のお誕生日」（見せる設定の子だけ）', async () => {
  const mb = fun.morningBoard();
  assert.ok(mb.bdays.includes('bday') && mb.bdays.includes('kidb'));
  assert.ok(!mb.bdays.includes('secret'), '先生だけに見せる子はのせない');
});

test('おうちの人の誕生日：子どもにカード → メッセージと時間をプレゼント → 達成で🌸', async () => {
  const inv = await http('POST', `/api/admin/users/${U.jh.id}/parent-invite`, {}, owner);
  const reg = await http('POST', '/api/parent/register', { code: inv.data.code, displayName: 'ママ', loginId: 'mama', password: 'password123' });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const mama = (await http('POST', '/api/login', { loginId: 'mama', password: 'password123' })).cookie;
  // 保護者が自分で誕生日を登録（オーナーも登録できる）
  assert.equal((await http('POST', '/api/parent/birthday', { birthday: '13-40' }, mama)).status, 400);
  assert.equal((await http('POST', '/api/parent/birthday', { birthday: todayMD }, mama)).status, 200);
  const pid = reg.data.user ? reg.data.user.id : db.prepare("SELECT id FROM users WHERE login_id = 'mama'").get().id;
  assert.equal((await http('PATCH', `/api/admin/users/${pid}`, { birthday: todayMD }, owner)).status, 200, 'オーナーも登録できる');
  // 子どもが入ると、カードが届く
  U.jh.c.s.disconnect(); await sleep(100);
  const c = await connect(U.jh.cookie);
  await sleep(2800);
  const card = evs(c, 'parent-bday')[0];
  assert.ok(card && card.parents[0].id === pid && card.parents[0].name === 'ママ');
  assert.match((await ask(c, 'parent-gift', { parentId: pid, message: 'へんな文', minutes: 30 })).error, /メッセージ/);
  assert.match((await ask(c, 'parent-gift', { parentId: pid, message: card.messages[1], minutes: 7 })).error, /時間/);
  assert.equal((await ask(c, 'parent-gift', { parentId: pid, message: card.messages[1], minutes: 30 })).ok, true);
  assert.match((await ask(c, 'parent-gift', { parentId: pid, message: card.messages[0], minutes: 30 })).error, /もう送った/);
  // 保護者の画面に出る（まだ達成していない）
  let home = (await http('GET', '/api/parent/home', null, mama)).data;
  assert.equal(home.myBirthday, todayMD);
  assert.equal(home.gifts.length, 1);
  assert.equal(home.gifts[0].child, 'jhs'); assert.equal(home.gifts[0].minutes, 30); assert.equal(home.gifts[0].done, false);
  // 30分勉強すると達成
  db.prepare('INSERT INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, 30, 30) ON CONFLICT (user_id, day) DO UPDATE SET auto_min = 30, all_min = 30').run(U.jh.id, G.jst().day);
  assert.deepEqual(B.checkGifts(U.jh.id).map(g => g.minutes), [30]);
  assert.deepEqual(B.checkGifts(U.jh.id), [], '達成のお知らせは1回だけ');
  home = (await http('GET', '/api/parent/home', null, mama)).data;
  assert.equal(home.gifts[0].done, true);
  // 誕生日でないおうちの人にはプレゼントできない
  await http('POST', '/api/parent/birthday', { birthday: null }, mama);
  assert.equal(B.parentsBirthdayToday(U.jh.id).length, 0);
  // ほかの生徒は、そのおうちの人へ送れない
  assert.match((await ask(U.hs.c, 'parent-gift', { parentId: pid, message: card.messages[1], minutes: 30 })).error, /見つかりません/);
});
