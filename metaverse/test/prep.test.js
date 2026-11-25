// 📋 テスト対策：ひな形（いつ｜教科｜やること）・学校×学年×テストの日程・期間の計算・先生だけの✅・スピーキング/ライティングの自動✅
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/server.js');
const P = require('../server/prep.js');
const { db } = require('../server/db.js');

let base, server;
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
let owner, stu, stuId, other, mama;

test('ひな形の読み方：「｜」「|」タブ・○週間前／○日前／前日', () => {
  const p = P.parseTemplate('5週間前｜数学｜計算\n10日前|英語|単語\n前日\t数学\tサポートテスト\n\nあした｜数学｜x');
  assert.deepEqual(p.items.map(i => i.days), [35, 10, 1]);
  assert.equal(p.errors.length, 1);
  assert.deepEqual(P.parseUnits('Unit6-1  Unit6-2\nUnit 7 Part 1、Unit8'), ['Unit6-1', 'Unit6-2', 'Unit 7 Part 1', 'Unit8']);
});

test('期間：その段階の開始日〜次の段階の開始日の前日（初日12/9）', () => {
  const st = P.stagesOf(P.parseTemplate(P.DEFAULT_TEMPLATE).items, '2026-12-09');
  assert.deepEqual(st.map(s => `${s.when} ${s.start.slice(5)}〜${s.end.slice(5)}`), ['5週間前 11-04〜11-10', '4週間前 11-11〜11-17', '3週間前 11-18〜11-24', '2週間前 11-25〜12-01', '1週間前 12-02〜12-07', '前日 12-08〜12-08']);
});

test('準備：中2の生徒（学校：〇〇中）・保護者', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const r = await http('POST', '/api/admin/users', { role: 'student', loginId: 'chu2', displayName: 'ちゅう', grade: '中2', password: 'password123', school: '〇〇中' }, owner);
  stuId = r.data.user.id;
  assert.equal(r.data.user.school, '〇〇中');
  stu = (await http('POST', '/api/login', { loginId: 'chu2', password: 'password123' })).cookie;
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'chu2b', displayName: 'べつ', grade: '中2', password: 'password123' }, owner);
  other = (await http('POST', '/api/login', { loginId: 'chu2b', password: 'password123' })).cookie;
  const inv = await http('POST', `/api/admin/users/${stuId}/parent-invite`, {}, owner);
  await http('POST', '/api/parent/register', { code: inv.data.code, displayName: 'ママ', loginId: 'mama', password: 'password123' });
  mama = (await http('POST', '/api/login', { loginId: 'mama', password: 'password123' })).cookie;
});

test('学校の日程（先生）→ 生徒は自動でスケジュール（塾で設定）。生徒はその日を入れられない', async () => {
  assert.equal((await http('PUT', '/api/admin/prep/school-test', { school: '〇〇中', grade: '中2', term: '2end', start: '2026-12-09' }, stu)).status, 403);
  const r = await http('PUT', '/api/admin/prep/school-test', { school: '〇〇中', grade: '中2', term: '2end', start: '2026-12-09', end: '2026-12-10', speaking: 'Unit6-1  Unit6-2', writing: 'Unit6-1', ranges: { 英語: '新ワーク p.40〜55' } }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = P.scheduleFor(stuId, '2026-11-12');
  assert.equal(s.test.source, 'juku'); assert.equal(s.test.termName, '2学期期末');
  assert.equal(s.stages.find(x => x.now).when, '4週間前', '今ここ');
  const first = s.stages[0].items;
  assert.ok(first.every(i => i.status === 'late'), '5週間前は期限すぎ（✅なし）');
  assert.equal(s.sw.deadline, '2026-11-10');
  assert.deepEqual(s.sw.speaking.map(x => x.name), ['Unit6-1', 'Unit6-2']);
  assert.equal(s.counts.late, 2 + 3, '5週間前の2つ ＋ Unit 3つ');
  assert.equal(s.stages.find(x => x.when === '4週間前').items.find(i => i.subject === '英語').range, '新ワーク p.40〜55', '新ワークの行に範囲');
  assert.match((await http('PUT', '/api/scores/test-date', { grade: '中2', term: '2end', start: '2026-12-01' }, stu)).data.error, /塾で設定/);
  // 成績の画面のテストの日も、塾の日程になる
  const sd = (await http('GET', '/api/scores', null, stu)).data.testDates;
  assert.deepEqual(sd.map(d => `${d.term}:${d.source}`), ['2end:juku']);
});

test('✅は先生だけ。保護者・生徒は見るだけ。Unitの✅は生徒の✅で消えない', async () => {
  const k = P.scheduleFor(stuId, '2026-11-12');
  const item = k.stages[0].items[0];
  const body = { userId: stuId, grade: '中2', term: '2end', start: '2026-12-09', item: item.key, state: true };
  assert.equal((await http('POST', '/api/prep/check', body, stu)).status, 403);
  assert.equal((await http('POST', '/api/prep/check', body, mama)).status, 403);
  assert.equal((await http('POST', '/api/prep/check', body, owner)).status, 200);
  assert.equal((await http('POST', '/api/prep/check', { ...body, item: 'sw:speaking:Unit6-1' }, owner)).status, 200);
  const s = (await http('GET', '/api/prep', null, stu)).data;
  assert.equal(s.canCheck, false);
  const p = (await http('GET', `/api/prep?userId=${stuId}`, null, mama)).data;
  assert.equal(p.canCheck, false); assert.equal(p.test.term, '2end');
  assert.equal((await http('GET', `/api/prep?userId=${stuId}`, null, other)).status, 403);
  const o = (await http('GET', `/api/prep?userId=${stuId}`, null, owner)).data;
  assert.equal(o.canCheck, true);
  const now = P.scheduleFor(stuId, '2026-11-12');
  assert.equal(now.stages[0].items[0].done, true);
  assert.equal(now.sw.speaking[0].done, true); assert.equal(now.sw.speaking[0].by, 'teacher');
  assert.equal(now.counts.late, 3, '✅した2つは遅れからはずれる');
});

test('テスト教室の合格で、スピーキング・ライティングに自動✅（先生は外せる）', async () => {
  // 音読の単元「Unit6-2」を作って、本番テストに合格した記録
  const u = db.prepare("INSERT INTO reading_units (grade, title, lines, created_at) VALUES ('中2', 'Unit6-2', '[]', datetime('now'))").run().lastInsertRowid;
  db.prepare("INSERT INTO reading_tests (user_id, unit_id, attempt, score, seconds, limit_sec, passed, points, created_at) VALUES (?, ?, 1, 93, 50, 60, 1, 5, datetime('now'))").run(stuId, u);
  let s = P.scheduleFor(stuId, '2026-11-12');
  const x = s.sw.speaking.find(v => v.name === 'Unit6-2');
  assert.equal(x.done, true); assert.equal(x.by, 'app'); assert.equal(x.auto.score, 93);
  assert.equal(s.sw.writing[0].done, false, 'ライティングはまだ');
  await http('POST', '/api/prep/check', { userId: stuId, grade: '中2', term: '2end', start: '2026-12-09', item: 'sw:speaking:Unit6-2', state: false }, owner);
  s = P.scheduleFor(stuId, '2026-11-12');
  assert.equal(s.sw.speaking.find(v => v.name === 'Unit6-2').done, false, '先生が外せる');
  // 管理画面の Unit チェック表と、全体の一覧
  const sw = (await http('GET', `/api/admin/prep/sw?school=${encodeURIComponent('〇〇中')}&grade=中2&term=2end`, null, owner)).data;
  assert.equal(sw.students[0].name, 'ちゅう');
  const adm = (await http('GET', '/api/admin/prep', null, owner)).data;
  assert.deepEqual(adm.schools, [{ name: '〇〇中', n: 1 }]);
  assert.ok(adm.overview.some(r => r.name === 'ちゅう'));
});

test('学校の日程がない生徒は、自分で入れた日でスケジュール', async () => {
  await http('PUT', '/api/scores/test-date', { grade: '中2', term: '2end', start: '2026-12-15' }, other);
  const id = db.prepare("SELECT id FROM users WHERE login_id = 'chu2b'").get().id;
  const s = P.scheduleFor(id, '2026-11-20');
  assert.equal(s.test.source, 'self'); assert.equal(s.test.start, '2026-12-15');
  assert.deepEqual(s.sw.speaking, [], 'Unit の課題は学校の日程のときだけ');
  assert.equal(P.scheduleFor(id, '2026-10-01').test.active, false, '5週間前より前は、まだ出さない');
  // ひな形を書きかえ
  assert.equal((await http('PUT', '/api/admin/prep/template', { text: 'あした｜数学｜x' }, owner)).status, 400);
  assert.equal((await http('PUT', '/api/admin/prep/template', { text: '2週間前｜数学｜ワーク\n前日｜英語｜単語' }, owner)).status, 200);
  assert.deepEqual(P.scheduleFor(id, '2026-12-05').stages.map(x => x.when), ['2週間前', '前日']);
});

test('🏫 学校名：教室の設定で作る・名前を変える（生徒と日程もいっしょ）・生徒がいる学校は消せない', async () => {
  let r = (await http('GET', '/api/admin/schools', null, owner)).data.schools;
  assert.deepEqual(r.map(s => s.name), ['〇〇中'], 'はじめは生徒・日程の学校名から');
  assert.equal((await http('POST', '/api/admin/schools', { name: '△△中' }, stu)).status, 403);
  assert.equal((await http('POST', '/api/admin/schools', { name: '△△中' }, owner)).status, 200);
  assert.match((await http('POST', '/api/admin/schools', { name: '△△中' }, owner)).data.error, /もうあります/);
  r = (await http('POST', '/api/admin/schools', { action: 'rename', from: '〇〇中', to: '〇〇中学校' }, owner)).data.schools;
  assert.deepEqual(r.map(s => `${s.name}:${s.students}`), ['△△中:0', '〇〇中学校:1']);
  assert.equal(db.prepare('SELECT school FROM users WHERE id = ?').get(stuId).school, '〇〇中学校');
  assert.ok(P.schoolTests().every(t => t.school === '〇〇中学校'), '日程の学校名も変わる');
  assert.match((await http('POST', '/api/admin/schools', { action: 'remove', name: '〇〇中学校' }, owner)).data.error, /生徒が1人/);
  assert.equal((await http('POST', '/api/admin/schools', { action: 'remove', name: '△△中' }, owner)).status, 200);
  assert.deepEqual((await http('GET', '/api/admin/prep', null, owner)).data.schoolList, ['〇〇中学校']);
});
