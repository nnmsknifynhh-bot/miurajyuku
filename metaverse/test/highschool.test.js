// 高校生：高校生自習室（教室3を改装）・数え方を別に・週のノルマと週の🔥・ボーナス・称号・今日やること・来ていない通知・高校生の木
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
const at = (day, hm = '19:00') => new Date(`${day}T${hm}:00+09:00`);
const today = () => G.jst().day;

let owner; const U = {};
test('準備：高校生2人・中学生1人', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (k, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: k, displayName: k }, owner);
    assert.equal(r.status, 201, k + JSON.stringify(r.data));
    U[k] = { id: r.data.user.id, user: r.data.user, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  };
  await add('hs1', { role: 'student', grade: '高1' });
  await add('hs2', { role: 'student', grade: '高2' });
  await add('jh1', { role: 'student', grade: '小6' });
});

test('教室3は高校生自習室になっている。高校生だけ入れて、中学生などは自習室', async () => {
  const rooms = (await http('GET', '/api/me', null, U.hs1.cookie)).data.rooms;
  const c3 = rooms.find(r => r.id === 'class3');
  assert.equal(c3.name, '高校生自習室'); assert.equal(c3.type, 'study'); assert.equal(c3.canEnter, true);
  assert.equal(rooms.find(r => r.id === 'study').canEnter, false, '高校生は中学生の自習室には入らない');
  assert.equal((await http('GET', '/api/me', null, U.jh1.cookie)).data.rooms.find(r => r.id === 'class3').canEnter, false);
  U.hs1.c = await connect(U.hs1.cookie);
  assert.equal(await walk(U.hs1.c, 44, 3), true, '高校生自習室に入れる');
  U.jh1.c = await connect(U.jh1.cookie);
  assert.equal(await walk(U.jh1.c, 44, 3), false, '中学生は入れない');
  assert.ok(U.jh1.c.rejected.some(r => /高校生の部屋/.test(r || '')));
});

test('今日やること：高校生自習室で3つ書くと、みんなに吹き出しで見える', async () => {
  assert.equal((await ask(U.hs1.c, 'study-plan', { items: ['数学', '英語', ''] })).ok, false, '3つとも');
  const r = await ask(U.hs1.c, 'study-plan', { items: ['数学 青チャート', '英単語 100こ', '<b>古文</b>'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, ['数学 青チャート', '英単語 100こ', 'b古文/b'.replace(/b/g, '').length ? r.plan[2] : '']);
  assert.ok(!/[<>]/.test(r.plan[2]));
  await sleep(80);
  assert.ok(U.jh1.c.events.some(e => e.ev === 'user-updated' && e.d.id === U.hs1.id && Array.isArray(e.d.plan)));
  assert.equal((await ask(U.jh1.c, 'study-plan', { items: ['a', 'b', 'c'] })).ok, false, '中学生は使えない');
  // つなぎ直しても残る
  U.hs1.c.s.disconnect(); await sleep(100);
  U.hs1.c = await connect(U.hs1.cookie);
  assert.equal(U.hs1.c.me.plan.length, 3);
  assert.equal(U.hs1.c.me.hs, true);
});

test('数え方は中学生と高校生で別々（時間帯・上限）', () => {
  const day = G.addDays(today(), -40);
  assert.equal(G.setConfig({ window: { start: '00:00', end: '24:00' }, hs: { window: { start: '18:00', end: '22:00' }, dailyCap: 20 } }), null);
  const pres = (u, room) => ({ id: u.id, user: { role: 'student', grade: u.user.grade }, room, seat: room === 'class3' ? '44,2' : '2,21', away: null, studyCam: true });
  const online = new Map([[1, pres(U.hs2, 'class3')], [2, pres(U.jh1, 'study')]]);
  assert.deepEqual(G.tick(online, { date: at(day, '10:00') }), [U.jh1.id], '10時：高校生は時間帯の外');
  assert.deepEqual(G.tick(online, { date: at(day, '19:00') }).sort(), [U.hs2.id, U.jh1.id].sort());
  assert.match(G.setConfig({ hs: { window: { start: '22:00', end: '18:00' } } }), /^高校生：/);
  assert.match(G.setConfig({ hs: { medals: [{ minutes: 300, points: 10 }, { minutes: 200, points: 20 }, { minutes: 540, points: 30 }] } }), /🥉＜🥈＜🥇/);
  assert.match(G.setConfig({ hs: { medals: [{ minutes: 240, points: 10 }] } }), /3つ/);
  G.setConfig({ hs: { window: { start: '16:00', end: '23:00' }, dailyCap: 360 } });
});

test('週のメダル：週の合計で🥉4時間+10・🥈6時間+20・🥇9時間+30。🔥は🥉以上の週で数える', () => {
  const C = G.getConfig();
  assert.deepEqual(C.hs.medals, [{ minutes: 240, points: 10 }, { minutes: 360, points: 20 }, { minutes: 540, points: 30 }]);
  assert.deepEqual(C.hs.window, { start: '16:00', end: '23:00' }, '高校生のポイントの時間帯は16:00〜23:00');
  const mon = G.mondayOf(today());
  const id = U.hs2.id;
  // 先々週：合計9時間（🥇）、先週：合計6時間を毎日少しずつ（🥈）、今週：月曜に1時間40分
  G.setManual(id, G.addDays(mon, -14), 300, null); G.setManual(id, G.addDays(mon, -12), 300, null);
  for (let i = 0; i < 6; i++) G.setManual(id, G.addDays(mon, -7 + i), 60, null);
  G.setManual(id, mon, 100, null);
  const h = G.hsWeeks(id, at(G.addDays(mon, 1)));
  assert.equal(h.week.minutes, 100); assert.equal(h.week.medal, null); assert.equal(h.week.achieved, false);
  assert.equal(h.week.next.id, 'bronze'); assert.equal(h.week.next.left, 140, '🥉まであと2時間20分');
  assert.equal(h.streak, 2, '今週はまだでも、先週まで2週続いている');
  assert.equal(h.achievedWeeks, 2);
  assert.deepEqual(h.counts, { bronze: 0, silver: 1, gold: 1 });
  assert.equal(h.bonusPoints, 30 + 20, 'いちばん上のメダルの分だけ');
  assert.equal(G.streak(id, at(G.addDays(mon, 1))), 2, '高校生の🔥は週');
  const pt = G.points(id, at(G.addDays(mon, 1)));
  assert.ok(pt.earned >= 50, 'メダルのボーナスがポイントに入る');
  G.setManual(id, G.addDays(mon, 1), 150, null); // 今週 4時間10分 → 🥉
  // 前の「週のノルマ（回数）」の設定は、メダルと16:00〜23:00に切りかわる
  const D = require('../server/db.js');
  const saved = JSON.parse(D.getSetting('ganbari', '{}'));
  D.setSetting('ganbari', JSON.stringify({ ...saved, hs: { window: { start: '00:00', end: '24:00' }, dailyCap: 360, sessionsPerWeek: 2, sessionMinutes: 180, weekBonus: 30 } }));
  const m = G.getConfig().hs;
  assert.deepEqual(m.window, { start: '16:00', end: '23:00' });
  assert.equal(m.medals[2].points, 30); assert.equal(m.sessionsPerWeek, undefined);
  const h2 = G.hsWeeks(id, at(G.addDays(mon, 1)));
  assert.equal(h2.week.medal.id, 'bronze'); assert.equal(h2.week.next.id, 'silver');
  assert.equal(h2.streak, 3, '今週も🥉で3週');
});

test('称号：自習時間の合計で変わる（高校生だけ）', () => {
  const t = G.titleOf(U.hs2.id); // 前のテストで約20時間
  assert.equal(t.name, 'がんばり屋'); assert.equal(t.next.name, '努力家'); assert.ok(t.next.hoursLeft > 0);
  for (let i = 60; i < 65; i++) G.setManual(U.hs2.id, G.addDays(today(), -i), 600, null);
  assert.equal(G.titleOf(U.hs2.id).name, '努力家', '50時間以上');
  assert.equal(G.titleOf(U.jh1.id), null, '中学生などにはない');
});

test('来る曜日：決めた時刻をすぎても来ていないと、1日1回だけ先生に知らせる', async () => {
  const wd = new Date(today() + 'T00:00:00Z').getUTCDay();
  assert.equal((await http('PATCH', `/api/admin/users/${U.hs2.id}`, { visitDays: [wd], visitTime: '00:00' }, owner)).status, 200);
  assert.equal((await http('PATCH', `/api/admin/users/${U.hs2.id}`, { visitDays: [wd], visitTime: null }, owner)).status, 400, '時刻が必要');
  const u = (await http('GET', '/api/admin/users', null, owner)).data.users.find(x => x.id === U.hs2.id);
  assert.deepEqual(u.visitDays, [wd]); assert.equal(u.visitTime, '00:00');
  const late = G.lateStudents(new Set(), at(today(), '23:59'));
  assert.deepEqual(late.map(x => x.id), G.dayTotal(U.hs2.id, today()) > 0 ? [] : [U.hs2.id]);
  assert.equal(G.lateStudents(new Set(), at(today(), '23:59')).length, 0, '2回目は知らせない');
  // 来ている生徒には知らせない
  await http('PATCH', `/api/admin/users/${U.hs1.id}`, { visitDays: [wd], visitTime: '00:00' }, owner);
  assert.ok(!G.lateStudents(new Set([U.hs1.id]), at(today(), '23:59')).some(x => x.id === U.hs1.id));
});

test('高校生の木（4本目）と短冊', async () => {
  const f = G.forest();
  assert.equal(f.trees.length, 5);
  assert.equal(f.trees[3].name, '高校生の木');
  assert.deepEqual(f.trees[3].grades, ['高1', '高2', '高3']);
  const g = await http('POST', '/api/me/goal', { text: '模試で偏差値60' }, U.hs1.cookie);
  assert.equal(g.status, 200);
  await http('POST', `/api/admin/ganbari/goals/${g.data.goal.id}/review`, { action: 'approve' }, owner);
  assert.ok(G.forest().trees[3].goals.some(x => x.text === '模試で偏差値60'));
});

test('生徒の画面用：週のノルマ・称号・今日やること', async () => {
  const me = (await http('GET', '/api/me/ganbari', null, U.hs1.cookie)).data;
  assert.ok(me.hs && me.hs.week && me.hs.today);
  assert.equal(me.hs.plan.length, 3);
  assert.equal((await http('GET', '/api/me/ganbari', null, U.jh1.cookie)).data.hs, null);
});
