// ユーザーの削除：オーナーだけ・名前の確認つき・その人の記録もいっしょに消える（ほかの人の記録は残る）
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/server.js');
const { db } = require('../server/db.js');
const G = require('../server/ganbari.js');

let base, server;
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}

test('オーナーは生徒を削除できる。記録も消え、ほかの生徒の記録は残る', async () => {
  const owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const mk = async (loginId, displayName, grade) => (await http('POST', '/api/admin/users', { role: 'student', loginId, displayName, grade, password: 'password123' }, owner)).data.user.id;
  const a = await mk('aaa', 'あお', '中1'), b = await mk('bbb', 'べに', '中2');
  const tch = (await http('POST', '/api/admin/users', { role: 'teacher', loginId: 'tch', displayName: '山田', password: 'password123' }, owner)).data.user.id;
  const day = G.jst().day;
  for (const id of [a, b]) db.prepare('INSERT INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, 30, 30)').run(id, day);
  const inv = await http('POST', `/api/admin/users/${a}/parent-invite`, {}, owner);
  assert.equal((await http('POST', '/api/parent/register', { code: inv.data.code, displayName: 'あおの母', loginId: 'mama', password: 'password123' })).status, 201);
  const sa = (await http('POST', '/api/login', { loginId: 'aaa', password: 'password123' })).cookie;
  assert.equal((await http('GET', '/api/me', null, sa)).status, 200);

  // 名前の確認がちがうと消えない・先生は消せない・オーナーと自分は消えない
  assert.equal((await http('DELETE', `/api/admin/users/${a}`, { confirm: 'ちがう' }, owner)).status, 400);
  const tc = (await http('POST', '/api/login', { loginId: 'tch', password: 'password123' })).cookie;
  assert.equal((await http('DELETE', `/api/admin/users/${a}`, { confirm: 'あお' }, tc)).status, 403);
  const ownerId = db.prepare("SELECT id FROM users WHERE login_id = 'owner'").get().id;
  assert.equal((await http('DELETE', `/api/admin/users/${ownerId}`, { confirm: '三浦' }, owner)).status, 403);

  const r = await http('DELETE', `/api/admin/users/${a}`, { confirm: 'あお' }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(a).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM study_days WHERE user_id = ?').get(a).n, 0, '自習時間も消える');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parent_children WHERE student_id = ?').get(a).n, 0, '保護者とのつながりも消える');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM study_days WHERE user_id = ?').get(b).n, 1, 'ほかの生徒の記録は残る');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE login_id = 'mama'").get().n, 1, '保護者のアカウントは残る');
  assert.equal((await http('GET', '/api/me', null, sa)).status, 401, '消した人はログアウトされる');
  // 同じIDでまた登録できる
  assert.ok(await mk('aaa', 'あお', '中1'));
  // 先生も消せる
  assert.equal((await http('DELETE', `/api/admin/users/${tch}`, { confirm: '山田' }, owner)).status, 200);
});

test('🎓 学年を1つ上げる（小6→中1・中3→高1・高3→卒業。体験中・卒業はそのまま）と、元に戻す', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  const ids = {};
  for (const [k, g] of [['p6', '小6'], ['p9', '中3'], ['p12', '高3'], ['pg', '卒業']]) ids[k] = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'u' + k, displayName: k, grade: g, password: 'password123' }, owner)).data.user.id;
  db.prepare("UPDATE users SET grade = '卒業' WHERE id = ?").run(ids.pg);
  const gradeOf = (id) => db.prepare('SELECT grade FROM users WHERE id = ?').get(id).grade;
  const before = Object.fromEntries(db.prepare("SELECT id, grade FROM users WHERE role = 'student'").all().map(r => [r.id, r.grade]));
  const st = await http('GET', '/api/admin/grades/promote', null, owner);
  assert.equal(st.data.undo, null);
  const r = await http('POST', '/api/admin/grades/promote', {}, owner);
  assert.equal(r.status, 200);
  assert.equal(gradeOf(ids.p6), '中1'); assert.equal(gradeOf(ids.p9), '高1'); assert.equal(gradeOf(ids.p12), '卒業'); assert.equal(gradeOf(ids.pg), '卒業');
  assert.equal((await http('GET', '/api/admin/grades/promote', null, owner)).data.undo.count, r.data.count);
  assert.equal((await http('POST', '/api/admin/grades/promote-undo', {}, owner)).status, 200);
  for (const [id, g] of Object.entries(before)) assert.equal(gradeOf(Number(id)), g);
  assert.equal((await http('POST', '/api/admin/grades/promote-undo', {}, owner)).status, 400, '2回は戻せない');
});
