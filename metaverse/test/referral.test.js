// 友だち紹介：招待リンク・体験アカウント（期限・記録なし・名前）・入塾でおそろいアイテム・ペア自習チャレンジ・紹介ウィーク・保護者の紹介
process.env.DB_PATH = ':memory:';
process.env.TEST_LEAVE_MS = '300';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const app = require('../server/server.js');
const G = require('../server/ganbari.js');
const R = require('../server/referral.js');
const { db } = require('../server/db.js');

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
    const c = { s, init: null, events: [] };
    s.onAny((ev, d) => c.events.push({ ev, d }));
    s.on('init', (d) => { c.init = d; resolve(c); });
    s.on('connect_error', reject);
  });
}
const fake = (id, extra = {}) => ({ id, user: { role: 'student' }, room: 'study', seat: '2,21', away: null, studyCam: true, ...extra });

let owner; const U = {};
test('準備：生徒2人・保護者1人', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  for (const [k, grade] of [['taro', '中2'], ['other', '中2']]) {
    const r = await http('POST', '/api/admin/users', { role: 'student', grade, loginId: k, displayName: k, password: 'password123' }, owner);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  }
  const inv = await http('POST', `/api/admin/users/${U.other.id}/parent-invite`, {}, owner);
  const p = await http('POST', '/api/parent/register', { code: inv.data.code, displayName: 'アザーの母', loginId: 'mama', password: 'password123' });
  U.mama = { cookie: p.cookie, id: (await http('GET', '/api/me', null, p.cookie)).data.user.id };
});

test('招待リンク：生徒・保護者は自分のリンクを持てる', async () => {
  const r = await http('GET', '/api/me/referral', null, U.taro.cookie);
  assert.equal(r.status, 200);
  assert.match(r.data.code, /^[A-Z0-9]{6}$/);
  assert.equal(r.data.path, '/#trial=' + r.data.code);
  U.taro.code = r.data.code;
  assert.equal((await http('GET', '/api/me/referral', null, U.taro.cookie)).data.code, U.taro.code, '同じコード');
  U.mama.code = (await http('GET', '/api/me/referral', null, U.mama.cookie)).data.code;
  const info = await http('GET', '/api/trial/info?code=' + U.taro.code);
  assert.deepEqual([info.data.ok, info.data.inviter, info.data.days], [true, 'taro', 3]);
  assert.equal((await http('GET', '/api/trial/info?code=ZZZZZZ')).data.ok, false);
});

test('体験アカウント：期限つき・記録なし・ほかの生徒の名前は見えない（招待した子は見える）', async () => {
  assert.equal((await http('POST', '/api/trial/start', { code: U.taro.code, name: 'けんた', grade: '中9' })).status, 400);
  const r = await http('POST', '/api/trial/start', { code: U.taro.code, name: 'けんた', grade: '中2' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  U.ken = { cookie: r.cookie };
  const me = await http('GET', '/api/me', null, r.cookie);
  U.ken.id = me.data.user.id;
  assert.equal(me.data.trial.inviter, 'taro');
  assert.ok(Math.abs(me.data.user.trialUntil - (Date.now() + 3 * 86400e3)) < 60e3);
  // 名前の見え方
  const t = await connect(U.taro.cookie), o = await connect(U.other.cookie);
  const k = await connect(U.ken.cookie);
  const seen = Object.fromEntries(k.init.users.map(u => [u.id, u.name]));
  assert.equal(seen[U.taro.id], 'taro');
  assert.equal(seen[U.other.id], '生徒');
  await sleep(150);
  const joined = t.events.filter(e => e.ev === 'user-joined').map(e => e.d).find(u => u.id === U.ken.id);
  assert.equal(joined.name, '体験：けんた');
  // 自習時間は記録しない・学年の木にも数えない
  const added = G.tick(new Map([[1, fake(U.ken.id, { user: { role: 'student', trial_until: Date.now() + 1e6 } })], [2, fake(U.taro.id)]]), { date: new Date(`${G.jst().day}T19:00:00+09:00`) });
  assert.deepEqual(added.counted, [U.taro.id]);
  const forest = await http('GET', '/api/forest', null, U.taro.cookie);
  assert.ok(forest.status === 200);
  // 管理画面の一覧
  const list = (await http('GET', '/api/admin/referral', null, owner)).data;
  assert.equal(list.trials[0].name, 'けんた');
  assert.equal(list.trials[0].referrer, 'taro');
  [t, o, k].forEach(c => c.s.disconnect());
});

test('体験の期限がすぎたら入れない', async () => {
  db.prepare('UPDATE users SET trial_until = ? WHERE id = ?').run(Date.now() - 1000, U.ken.id);
  assert.equal((await http('GET', '/api/me', null, U.ken.cookie)).status, 401);
  db.prepare('UPDATE users SET trial_until = ? WHERE id = ?').run(Date.now() + 86400e3, U.ken.id);
});

test('入塾：体験アカウントをそのまま生徒に・2人におそろいのアイテム・ペア自習チャレンジ開始', async () => {
  assert.equal((await http('POST', `/api/admin/users/${U.ken.id}/enroll`, { loginId: 'kenta', password: 'password123' }, U.taro.cookie)).status, 403);
  const r = await http('POST', `/api/admin/users/${U.ken.id}/enroll`, { loginId: 'kenta', password: 'password123' }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.trialUntil, null);
  assert.equal(r.data.rewards.kind, 'student');
  U.ken.cookie = (await http('POST', '/api/login', { loginId: 'kenta', password: 'password123' })).cookie;
  for (const k of ['taro', 'ken']) {
    const g = (await http('GET', '/api/me/ganbari', null, U[k].cookie)).data;
    assert.ok(g.myItems !== undefined);
    assert.ok(G.shopFor(U[k].id).some(i => i.id === 'friend_chick' && i.owned), k + 'におそろいのひよこ');
    assert.equal(g.pair.days, 7);
    assert.equal(g.pair.partner, k === 'taro' ? 'けんた' : 'taro');
  }
  // 2回目はもらえない
  assert.equal((await http('POST', `/api/admin/users/${U.ken.id}/referrer`, { referrerId: U.taro.id }, owner)).status, 400);
});

test('ペア自習チャレンジ：7日間2人とも🔥なら、2人に限定アイテム＋30ポイント', () => {
  const start = G.jst().day;
  db.prepare('UPDATE referrals SET pair_start = ? WHERE new_id = ?').run(start, U.ken.id);
  const before = [G.points(U.taro.id).balance, G.points(U.ken.id).balance];
  for (let i = 0; i < 7; i++) for (const id of [U.taro.id, U.ken.id]) db.prepare('INSERT OR REPLACE INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, 0, 70)').run(id, G.addDays(start, i));
  assert.equal(R.settlePair(U.taro.id, new Date(`${G.addDays(start, 3)}T20:00:00+09:00`)), null, 'まだ途中');
  const won = R.settlePair(U.taro.id, new Date(`${G.addDays(start, 6)}T23:00:00+09:00`));
  assert.deepEqual(won.sort(), [U.taro.id, U.ken.id].sort());
  assert.equal(G.points(U.taro.id).balance - before[0], 30);
  assert.equal(G.points(U.ken.id).balance - before[1], 30);
  assert.ok(G.shopFor(U.ken.id).some(i => i.id === 'pair_star' && i.owned));
  assert.equal(R.settlePair(U.taro.id, new Date(`${G.addDays(start, 6)}T23:30:00+09:00`)), null, '2回目はなし');
});

test('保護者の紹介：入塾したら家族の木に🌷・保護者に＋50ポイント', async () => {
  const r = await http('POST', '/api/trial/start', { code: U.mama.code, name: 'はな', grade: '中1' });
  assert.equal(r.status, 200);
  const id = (await http('GET', '/api/me', null, r.cookie)).data.user.id;
  const before = G.points(U.mama.id).balance;
  const e = await http('POST', `/api/admin/users/${id}/enroll`, { loginId: 'hana', password: 'password123' }, owner);
  assert.equal(e.data.rewards.kind, 'parent');
  assert.equal(G.points(U.mama.id).balance - before, 50);
  const home = (await http('GET', '/api/parent/home', null, U.mama.cookie)).data;
  assert.equal(home.moms.tulips, 1);
});

test('友だち紹介ウィーク：期間中は体験の日数がのびる・設定はオーナーだけ', async () => {
  const today = G.jst().day;
  assert.equal((await http('PATCH', '/api/admin/referral', { week: { start: today, end: today } }, U.taro.cookie)).status, 403);
  assert.equal((await http('PATCH', '/api/admin/referral', { week: { start: today, end: G.addDays(today, -1) } }, owner)).status, 400);
  const r = await http('PATCH', '/api/admin/referral', { week: { start: today, end: G.addDays(today, 6) }, weekTrialDays: 7 }, owner);
  assert.equal(r.status, 200);
  assert.equal(r.data.weekOn, true);
  assert.equal((await http('GET', '/api/trial/info?code=' + U.taro.code)).data.days, 7);
  assert.deepEqual((await http('GET', '/api/me/ganbari', null, U.taro.cookie)).data.referralWeek, { start: today, end: G.addDays(today, 6) });
  // 体験の受付を止める
  await http('PATCH', '/api/admin/referral', { trial: false, week: null }, owner);
  assert.equal((await http('POST', '/api/trial/start', { code: U.taro.code, name: 'x', grade: '中1' })).status, 400);
  await http('PATCH', '/api/admin/referral', { trial: true }, owner);
});

test('体験なしで入塾した生徒にも、紹介者を登録できる', async () => {
  const s = await http('POST', '/api/admin/users', { role: 'student', grade: '中1', loginId: 'yui', displayName: 'ゆい', password: 'password123' }, owner);
  const r = await http('POST', `/api/admin/users/${s.data.user.id}/referrer`, { referrerId: U.other.id }, owner);
  assert.equal(r.status, 200);
  assert.ok(G.shopFor(U.other.id).some(i => i.id === 'friend_chick' && i.owned));
  const users = (await http('GET', '/api/admin/users', null, owner)).data.users;
  assert.equal(users.find(u => u.id === s.data.user.id).referrer.name, 'other');
});
