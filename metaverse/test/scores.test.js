// 📊 成績：定期テスト・内申・模試（本番・過去問）。生徒も先生も入れられる・先生が確認・保護者は見るだけ・中高生だけ
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/server.js');

let base, server;
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
const S5 = (pts) => ['国語', '数学', '英語', '理科', '社会'].map((name, i) => ({ name, score: pts[i], avg: 60 }));
let owner, stu, other, kid, mama, stuId;

test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const mk = async (id, grade) => { const r = await http('POST', '/api/admin/users', { role: 'student', loginId: id, displayName: id, grade, password: 'password123' }, owner); return { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: id, password: 'password123' })).cookie }; };
  const a = await mk('chu2', '中2'); stu = a.cookie; stuId = a.id;
  other = (await mk('chu3', '中3')).cookie;
  kid = (await mk('sho5', '小5')).cookie;
  const inv = await http('POST', `/api/admin/users/${stuId}/parent-invite`, {}, owner);
  await http('POST', '/api/parent/register', { code: inv.data.code, displayName: 'ママ', loginId: 'mama', password: 'password123' });
  mama = (await http('POST', '/api/login', { loginId: 'mama', password: 'password123' })).cookie;
});

test('定期テスト：生徒が入れる（合計は自動）。同じテストは1つだけ。先生が確認、生徒が直すと確認まちにもどる', async () => {
  let r = await http('POST', '/api/scores', { kind: 'teiki', grade: '中2', term: '2mid', subjects: S5([80, 72, 90, 65, 70]), rank: 12, rankOf: 150 }, stu);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.id;
  assert.match((await http('POST', '/api/scores', { kind: 'teiki', grade: '中2', term: '2mid', subjects: S5([1, 1, 1, 1, 1]) }, stu)).data.error, /もう入っています/);
  assert.match((await http('POST', '/api/scores', { kind: 'teiki', grade: '中2', term: '2mid', subjects: [{ name: '数学', score: 120 }] }, stu)).data.error, /0〜100/);
  assert.match((await http('POST', '/api/scores', { kind: 'teiki', grade: '中2', term: 'x', subjects: S5([1, 1, 1, 1, 1]) }, stu)).data.error, /どのテスト/);
  let d = (await http('GET', '/api/scores', null, stu)).data;
  assert.equal(d.canEdit, true); assert.equal(d.canConfirm, false);
  assert.equal(d.records[0].sum.total, 377); assert.equal(d.records[0].termName, '2学期中間'); assert.equal(d.records[0].confirmed, false);
  assert.equal((await http('POST', `/api/scores/${id}/confirm`, {}, stu)).status, 403, '生徒は確認できない');
  assert.equal((await http('POST', `/api/scores/${id}/confirm`, {}, owner)).status, 200);
  assert.equal((await http('GET', '/api/scores', null, stu)).data.records[0].confirmed, true);
  assert.equal((await http('PATCH', `/api/scores/${id}`, { grade: '中2', term: '2mid', subjects: S5([80, 72, 95, 65, 70]) }, stu)).status, 200);
  d = (await http('GET', '/api/scores', null, stu)).data.records[0];
  assert.equal(d.sum.total, 382); assert.equal(d.confirmed, false, '直したら確認まち');
  // 先生が入れたものは、はじめから確認ずみ
  r = await http('POST', '/api/scores', { userId: stuId, kind: 'teiki', grade: '中2', term: '1end', subjects: S5([70, 70, 70, 70, 70]) }, owner);
  assert.equal(r.status, 201);
  d = (await http('GET', '/api/scores', null, stu)).data.records;
  assert.deepEqual(d.map(x => x.term), ['1end', '2mid'], 'テストの順にならぶ');
  assert.equal(d[0].confirmed, true); assert.equal(d[0].createdByStaff, true);
});

test('内申（学期ごと・9教科）と模試（本番・過去問はいくつでも。偏差値・判定）', async () => {
  const nine = ['国語', '社会', '数学', '理科', '英語', '音楽', '美術', '保健体育', '技術家庭'].map((name, i) => ({ name, value: [4, 3, 4, 5, 4, 3, 3, 4, 3][i] }));
  let r = await http('POST', '/api/scores', { kind: 'naishin', grade: '中2', term: '1', subjects: nine }, stu);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match((await http('POST', '/api/scores', { kind: 'naishin', grade: '中2', term: '2', subjects: [{ name: '国語', value: 11 }] }, stu)).data.error, /内申は1〜10/);
  for (let i = 1; i <= 3; i++) {
    r = await http('POST', '/api/scores', { kind: 'moshi', grade: '中2', title: `${2010 + i}年度 第1回`, past: true, subjects: S5([60, 60, 60, 60, 60]).map(s => ({ ...s, dev: 55 })), totalDev: 56 + i, judges: [{ school: '〇〇高校', judge: 'b' }] }, stu);
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  assert.match((await http('POST', '/api/scores', { kind: 'moshi', grade: '中2', title: '', subjects: S5([1, 1, 1, 1, 1]) }, stu)).data.error, /模試の名前/);
  assert.match((await http('POST', '/api/scores', { kind: 'moshi', grade: '中2', title: 'x', subjects: S5([1, 1, 1, 1, 1]), judges: [{ school: 'A高', judge: 'F' }] }, stu)).data.error, /A〜E/);
  r = await http('POST', '/api/scores', { kind: 'moshi', grade: '中2', title: '11月 県模試', takenOn: '2026-11-08', subjects: S5([70, 65, 80, 60, 75]), totalDev: 58.5, judges: [{ school: '〇〇高校', judge: 'A' }] }, stu);
  assert.equal(r.status, 201);
  const d = (await http('GET', '/api/scores', null, stu)).data.records;
  const n = d.find(x => x.kind === 'naishin');
  assert.equal(n.sum.total, 33); assert.equal(n.sum.total5, 20, '5教科の合計');
  const m = d.filter(x => x.kind === 'moshi');
  assert.equal(m.length, 4); assert.equal(m.filter(x => x.past).length, 3);
  assert.deepEqual(m.find(x => x.title === '11月 県模試').judges, [{ school: '〇〇高校', judge: 'A' }]);
  assert.equal(m.find(x => x.title === '2011年度 第1回').judges[0].judge, 'B', '小文字も大文字に');
});

test('見られる人：本人・保護者（見るだけ）・先生。ほかの生徒は見られない。小学生は入れられない', async () => {
  assert.equal((await http('GET', `/api/scores?userId=${stuId}`, null, other)).status, 403);
  const p = await http('GET', `/api/scores?userId=${stuId}`, null, mama);
  assert.equal(p.status, 200); assert.equal(p.data.canEdit, false); assert.ok(p.data.records.length >= 5);
  assert.equal((await http('POST', '/api/scores', { userId: stuId, kind: 'teiki', grade: '中2', term: 'final', subjects: S5([1, 1, 1, 1, 1]) }, mama)).status, 403);
  assert.equal((await http('POST', '/api/scores', { kind: 'teiki', grade: '中2', term: 'final', subjects: S5([1, 1, 1, 1, 1]) }, kid)).status, 403, '小学生');
  const id = (await http('GET', '/api/scores', null, stu)).data.records[0].id;
  assert.equal((await http('DELETE', `/api/scores/${id}`, null, other)).status, 403);
  // 管理画面の一覧
  assert.equal((await http('GET', '/api/admin/scores', null, stu)).status, 403);
  const o = (await http('GET', '/api/admin/scores', null, owner)).data;
  const s = o.students.find(x => x.name === 'chu2');
  assert.ok(s.count >= 6 && s.unconfirmed >= 5);
  assert.ok(!o.students.some(x => x.name === 'sho5'), '小学生は出ない');
  assert.equal((await http('DELETE', `/api/scores/${id}`, null, stu)).status, 200, '本人は消せる');
});
