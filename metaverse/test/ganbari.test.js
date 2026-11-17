// がんばりの仕組みテスト：自習時間の数え方・修正・学年の木（平均）・ポイントと着せかえ・新年度・連続自習・目標・保護者レポート
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/server.js');
const G = require('../server/ganbari.js');
const { db } = require('../server/db.js');

let base, server;
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
// 学期の中の日時（日本時間）
const C = () => G.getConfig();
const at = (day, hm = '19:00') => new Date(`${day}T${hm}:00+09:00`);
const T2 = () => C().terms[1]; // 2学期の初日
const fake = (u, extra = {}) => ({ id: u.id, user: { role: u.role || 'student' }, room: 'study', seat: '2,21', away: null, studyCam: true, ...extra });

let owner; const U = {};
test('準備：生徒（中1×2人、中2×1人、中3×0人）と先生', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (k, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: 'usr' + k, displayName: k }, owner);
    assert.equal(r.status, 201, k);
    U[k] = { id: r.data.user.id, role: body.role, grade: r.data.user.grade, cookie: (await http('POST', '/api/login', { loginId: 'usr' + k, password: 'password123' })).cookie };
  };
  await add('a1', { role: 'student', grade: '中1' }); await add('a2', { role: 'student', grade: '中1' });
  await add('b1', { role: 'student', grade: '中2' });
  await add('tch', { role: 'teacher', rooms: ['class1'] });
  assert.equal(U.a1.grade, '中1');
});

test('自習時間：条件を満たす生徒だけ1分ずつ数える', () => {
  const day = T2();
  const online = new Map([
    [1, fake(U.a1)],                                   // 数える
    [2, fake(U.a2, { seat: null })],                   // 座っていない → 数えない（初期設定）
    [3, fake(U.b1, { away: 'hidden' })],               // 離席 → 数えない
    [4, fake({ id: U.tch.id, role: 'teacher' }, { user: { role: 'teacher' } })], // 先生 → 数えない
  ]);
  const added = G.tick(online, { photosOn: false, date: at(day) });
  assert.deepEqual(added, [U.a1.id]);
  assert.equal(G.dayTotal(U.a1.id, day), 1);
});

test('自習時間：数える時間帯・1日の上限・カメラの条件はオーナーが決められる', () => {
  const day = T2();
  assert.equal(G.setConfig({ window: { start: '18:00', end: '22:00' }, dailyCap: 10, requireCamera: true }), null);
  const o = new Map([[1, fake(U.a1)]]);
  assert.deepEqual(G.tick(o, { date: at(day, '17:30') }), [], '時間帯の外');
  for (let m = 0; m < 9; m++) assert.equal(G.tick(o, { date: at(day, `19:${String(m).padStart(2, '0')}`) }).length, 1);
  assert.equal(G.dayTotal(U.a1.id, day), 10);
  assert.deepEqual(G.tick(o, { date: at(day, '19:30') }), [], '1日の上限（10分）');
  const day2 = G.addDays(day, 1);
  assert.deepEqual(G.tick(new Map([[1, fake(U.a1, { studyCam: false })]]), { photosOn: true, date: at(day2) }), [], '見守り写真オン・カメラオフ');
  assert.equal(G.tick(new Map([[1, fake(U.a1, { studyCam: false })]]), { photosOn: false, date: at(day2) }).length, 1, '見守り写真オフなら関係なし');
  assert.match(G.setConfig({ window: { start: '22:00', end: '18:00' } }), /時間帯/);
  assert.match(G.setConfig({ dailyCap: 0 }), /上限/);
  G.setConfig({ window: { start: '00:00', end: '24:00' }, dailyCap: 300, requireCamera: false });
});

test('自習時間の修正：オーナーが入れた値が優先される。設定はオーナーだけが変えられる', async () => {
  const day = T2();
  const r = await http('PUT', `/api/admin/ganbari/students/${U.a1.id}/days/${day}`, { minutes: 120 }, owner);
  assert.equal(r.status, 200);
  assert.equal(G.dayTotal(U.a1.id, day), 120);
  assert.equal((await http('PUT', `/api/admin/ganbari/students/${U.a1.id}/days/${day}`, { minutes: 120 }, U.tch.cookie)).status, 403);
  assert.equal((await http('PATCH', '/api/admin/ganbari/config', { dailyCap: 100 }, U.tch.cookie)).status, 403);
  assert.equal((await http('PUT', `/api/admin/ganbari/students/${U.a1.id}/days/${day}`, { minutes: 5000 }, owner)).status, 400);
  const days = (await http('GET', `/api/admin/ganbari/students/${U.a1.id}/days?from=${day}&to=${day}`, null, owner)).data.days;
  assert.equal(days[0].manual, 120); assert.equal(days[0].auto, 10);
});

test('学年の木：学年の「平均」時間で育つ（人数の差が出ない）', () => {
  const c = C();
  const day = c.terms[1];
  // 中1：a1=121分（120分に修正した日＋次の日の1分）・a2=0分 → 平均60.5分。中2：b1=600分 → 平均600分（10時間）
  G.setManual(U.b1.id, day, 600, null);
  const f = G.forest(at(day));
  const [t1, t2, t3] = f.trees;
  assert.equal(t1.students, 2); assert.equal(t1.avgMinutes, 61);
  assert.equal(t2.students, 1); assert.equal(t2.avgMinutes, 600);
  assert.equal(t3.students, 0); assert.equal(t3.avgMinutes, 0);
  assert.equal(t2.stageName, '若葉', '10時間 → 若葉（5時間以上）');
  assert.equal(t1.stageName, '芽');
  assert.equal(t2.nextHours, 15);
});

test('木の名前・学年・段階の時間はオーナーが変えられる', () => {
  assert.equal(G.setConfig({ trees: [{ name: '小学生の木', grades: ['小5', '小6'] }, { name: '中1・中2の木', grades: ['中1', '中2'] }, { name: '受験生の木', grades: ['中3'] }] }), null);
  const f = G.forest(at(C().terms[1]));
  assert.equal(f.trees[1].students, 3);
  assert.equal(f.trees[1].avgMinutes, 240, '(120+0+600)/3');
  assert.match(G.setConfig({ stages: [0, 5, 4, 30, 50, 80] }), /段階/);
  G.setConfig({ trees: [{ name: '中1の木', grades: ['中1'] }, { name: '中2の木', grades: ['中2'] }, { name: '中3の木', grades: ['中3'] }] });
});

test('ポイント：今年度の自習時間で増え、買うと減る。期間限定・足りないときは買えない', () => {
  const now = at(G.addDays(C().terms[1], 2));
  // a1：今年度 120分（修正）＋1分（2日目） → 10分で1ポイント → 12ポイント
  const p = G.points(U.a1.id, now);
  assert.equal(p.earned, 12);
  assert.match(G.buy(U.a1.id, 'crown', now), /ポイントが足りません/);
  assert.equal(G.buy(U.a1.id, 'nothing', now), 'そのアイテムはありません');
  G.setManual(U.a1.id, G.addDays(C().terms[1], 1), 600, null); // +600分 → 72ポイント
  assert.equal(G.buy(U.a1.id, 'cat', now), null);
  assert.equal(G.points(U.a1.id, now).balance, 72 - 60);
  assert.equal(G.buy(U.a1.id, 'cat', now), 'もう持っています');
  const july = at(`${C().yearStart.slice(0, 4)}-07-15`);
  assert.match(G.buy(U.a1.id, 'santa', july), /期間限定/);
});

test('着せかえ：持っているものだけつけられる', async () => {
  assert.equal(G.equip(U.a1.id, 'pet', 'dog'), 'まだ持っています'.replace('持っています', '持っていません'));
  assert.equal(G.equip(U.a1.id, 'head', 'cat'), 'そのアイテムはここにはつけられません');
  assert.equal(G.equip(U.a1.id, 'pet', 'cat'), null);
  assert.equal(G.getEquip(U.a1.id).pet, '🐱');
  // API からも：先生は買えない
  assert.equal((await http('POST', '/api/me/shop/buy', { item: 'cap' }, U.tch.cookie)).status, 403);
  const me = (await http('GET', '/api/me/ganbari', null, U.a1.cookie)).data;
  assert.equal(me.equip.pet, '🐱');
  assert.ok(me.shop.find(i => i.id === 'cat').owned);
});

test('連続自習の🔥：1日の最低時間（初期20分）を続けた日数', () => {
  const d0 = C().terms[2]; // 3学期の初日を「今日」とする
  for (let i = 1; i <= 3; i++) G.setManual(U.a2.id, G.addDays(d0, -i), 30, null);
  G.setManual(U.a2.id, G.addDays(d0, -4), 10, null); // 足りない日で途切れる
  assert.equal(G.streak(U.a2.id, at(d0)), 3, '今日はまだでも、昨日まで3日続いている');
  G.setManual(U.a2.id, d0, 25, null);
  assert.equal(G.streak(U.a2.id, at(d0)), 4);
});

test('目標の短冊：先生が確認してから木に飾られ、達成すると⭐になる', async () => {
  const r = await http('POST', '/api/me/goal', { text: '英単語を毎日20個覚える<script>' }, U.a1.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.data.goal.status, 'pending');
  assert.ok(!/[<>]/.test(r.data.goal.text));
  const tree = () => G.forest().trees.find(t => t.name === '中1の木');
  assert.equal(tree().goals.length, 0, '確認前は飾られない');
  assert.equal((await http('GET', '/api/admin/ganbari/goals', null, U.a2.cookie)).status, 403, '生徒は確認できない');
  const list = (await http('GET', '/api/admin/ganbari/goals', null, U.tch.cookie)).data.goals;
  const g = list.find(x => x.name === 'a1');
  assert.equal((await http('POST', `/api/admin/ganbari/goals/${g.id}/review`, { action: 'approve' }, U.tch.cookie)).status, 200);
  assert.equal(tree().goals.length, 1);
  assert.equal(tree().goals[0].achieved, false);
  await http('POST', `/api/admin/ganbari/goals/${g.id}/review`, { action: 'achieved' }, owner);
  assert.equal(tree().goals[0].achieved, true);
  assert.equal((await http('POST', '/api/me/goal', { text: '別の目標' }, U.a1.cookie)).status, 400, '達成した目標は変えられない');
});

test('保護者レポート：オーナーがリンクを作り、リンクを知っている人だけ1人分を見られる', async () => {
  const term = G.termOf(G.jst().day);
  assert.equal((await http('POST', '/api/admin/ganbari/reports', { termKey: term.key, userId: U.a1.id }, U.tch.cookie)).status, 403);
  const r = await http('POST', '/api/admin/ganbari/reports', { termKey: term.key, userId: U.a1.id, comment: 'よくがんばりました！' }, owner);
  assert.equal(r.status, 200);
  const token = r.data.reports[0].path.split('#')[1];
  const d = (await http('POST', '/api/report-data', { token })).data; // ログインなし
  assert.equal(d.name, 'a1'); assert.equal(d.grade, '中1');
  assert.equal(d.comment, 'よくがんばりました！');
  assert.equal(d.goal.achieved, true);
  assert.equal(d.equip.pet, '🐱');
  assert.equal(d.tree.name, '中1の木');
  assert.ok(typeof d.totalMinutes === 'number');
  assert.equal((await http('POST', '/api/report-data', { token: 'x'.repeat(32) })).status, 404, 'まちがったリンク');
  db.prepare("UPDATE report_links SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await http('POST', '/api/report-data', { token })).status, 404, '期限切れ');
  const all = await http('POST', '/api/admin/ganbari/reports', { termKey: term.key, all: true }, owner);
  assert.equal(all.data.reports.length, 3, '全員分まとめて作れる');
});

test('新年度：ポイントと着せかえは0に戻り、学年を1つ上げられる', async () => {
  const c = C();
  const y = Number(c.yearStart.slice(0, 4)) + 1;
  assert.equal((await http('POST', '/api/admin/ganbari/new-year', { terms: [`${y}-04-01`, `${y}-09-01`, `${y + 1}-01-01`], promote: true }, U.tch.cookie)).status, 403);
  const r = await http('POST', '/api/admin/ganbari/new-year', { terms: [`${y}-04-01`, `${y}-09-01`, `${y + 1}-01-01`], promote: true }, owner);
  assert.equal(r.status, 200);
  const later = at(`${y}-05-01`);
  assert.equal(G.points(U.a1.id, later).balance, 0);
  assert.deepEqual(G.owned(U.a1.id), []);
  assert.equal(G.getEquip(U.a1.id).pet, null);
  assert.equal(db.prepare('SELECT grade FROM users WHERE id = ?').get(U.a1.id).grade, '中2');
  assert.equal(db.prepare('SELECT grade FROM users WHERE id = ?').get(U.b1.id).grade, '中3');
  assert.match((await http('POST', '/api/admin/ganbari/new-year', { terms: [`${y}-04-01`, `${y}-09-01`, `${y + 1}-01-01`] }, owner)).data.error, /後にして/);
});
