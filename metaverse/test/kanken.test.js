// 入室前の漢字テスト：学年ごとの級・答えないと入れない・すぐの入り直しは出さない・問題の管理
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const app = require('../server/server.js');
const kanken = require('../server/kanken.js');
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
// 接続して、入れたか（init）・テストが必要と言われたか（quiz-required）を返す
function tryConnect(cookie) {
  return new Promise((resolve) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('init', () => resolve({ s, entered: true }));
    s.on('quiz-required', () => resolve({ s, entered: false }));
  });
}
const answerOf = (word) => db.prepare('SELECT answer FROM quiz_questions WHERE word = ?').get(word).answer;

let owner; const U = {};
test('準備：中1・中2・中3・小5の生徒と先生', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (k, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: 'usr' + k, displayName: k }, owner);
    assert.equal(r.status, 201);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: 'usr' + k, password: 'password123' })).cookie };
  };
  await add('c1', { role: 'student', grade: '中1' }); await add('c2', { role: 'student', grade: '中2' });
  await add('c3', { role: 'student', grade: '中3' }); await add('e5', { role: 'student', grade: '小5' });
  await add('tch', { role: 'teacher', rooms: ['class1'] });
});

test('サンプル問題：各級に15問以上あり、4つの選択肢はすべてちがう', () => {
  const qs = kanken.listQuestions();
  for (const lv of ['5級', '4級', '3級', '準2級']) assert.ok(qs.filter(q => q.level === lv).length >= 15, lv);
  for (const q of qs) assert.equal(new Set([q.answer, ...q.wrong]).size, 4, q.word);
});

test('答えるまで入室できない（先生・対象外の学年は出題なし）', async () => {
  assert.equal((await http('GET', '/api/quiz/status', null, U.c1.cookie)).data.required, true);
  assert.equal((await tryConnect(U.c1.cookie)).entered, false);
  assert.equal((await http('GET', '/api/quiz/status', null, U.tch.cookie)).data.required, false);
  assert.equal((await tryConnect(U.tch.cookie)).entered, true);
  assert.equal((await http('GET', '/api/quiz/status', null, U.e5.cookie)).data.required, false, '小5は初期設定では出題なし');
});

test('学年に合った級から出る（中1：5〜4級、中2：4〜3級、中3：3〜準2級）', async () => {
  const levels = async (k) => { const s = new Set(); for (let i = 0; i < 25; i++) s.add((await http('POST', '/api/quiz/question', {}, U[k].cookie)).data.level); return [...s].sort(); };
  assert.deepEqual(await levels('c1'), ['4級', '5級']);
  assert.deepEqual(await levels('c2'), ['3級', '4級']);
  assert.deepEqual(await levels('c3'), ['3級', '準2級']);
  assert.equal((await http('POST', '/api/quiz/question', {}, U.tch.cookie)).status, 403);
});

test('正解すると入室できる。結果に正しい読みが返る', async () => {
  const q = (await http('POST', '/api/quiz/question', {}, U.c1.cookie)).data;
  assert.equal(q.choices.length, 4);
  assert.ok(!('answer' in q), '答えは先に送らない');
  const idx = q.choices.indexOf(answerOf(q.word));
  const r = (await http('POST', '/api/quiz/answer', { choice: idx }, U.c1.cookie)).data;
  assert.equal(r.correct, true); assert.equal(r.answerIndex, idx);
  assert.equal((await http('GET', '/api/quiz/status', null, U.c1.cookie)).data.required, false);
  assert.equal((await tryConnect(U.c1.cookie)).entered, true);
  assert.equal((await http('POST', '/api/quiz/answer', { choice: 0 }, U.c1.cookie)).status, 400, '問題なしで答えられない');
});

test('まちがえても、正しい読みを見てから入室できる', async () => {
  const q = (await http('POST', '/api/quiz/question', {}, U.c2.cookie)).data;
  const wrong = q.choices.findIndex(c => c !== answerOf(q.word));
  const r = (await http('POST', '/api/quiz/answer', { choice: wrong }, U.c2.cookie)).data;
  assert.equal(r.correct, false);
  assert.equal(r.answer, answerOf(q.word));
  assert.equal((await tryConnect(U.c2.cookie)).entered, true);
});

test('通信が一瞬切れて入り直すときは出題しない', async () => {
  const first = await tryConnect(U.c1.cookie); // まだ答えて15分以内
  first.s.disconnect(); await sleep(150);
  kanken._reset(); // 「答えた記録」が消えていても
  assert.equal((await tryConnect(U.c1.cookie)).entered, true, 'すぐの入り直しは入れる');
});

test('オーナーは問題を追加・修正・お休み・削除できる（先生・生徒は不可）', async () => {
  assert.equal((await http('POST', '/api/admin/kanken/questions', { level: '4級', word: '跳躍', answer: 'ちょうやく', wrong: ['とうやく', 'ちょうよく', 'はねやく'] }, U.tch.cookie)).status, 403);
  assert.equal((await http('POST', '/api/admin/kanken/questions', { level: '4級', word: '跳躍', answer: 'ちょうやく', wrong: ['ちょうやく', 'ちょうよく', 'はねやく'] }, owner)).status, 400, '同じ読みはだめ');
  assert.equal((await http('POST', '/api/admin/kanken/questions', { level: '4級', word: '跳躍', answer: 'ちょうやく', wrong: ['とうやく', 'ちょうよく', 'はねやく'] }, owner)).status, 201);
  const data = (await http('GET', '/api/admin/kanken', null, owner)).data;
  const q = data.questions.find(x => x.word === '跳躍');
  assert.equal((await http('PATCH', `/api/admin/kanken/questions/${q.id}`, { active: false }, owner)).status, 200);
  assert.equal((await http('PATCH', `/api/admin/kanken/questions/${q.id}`, { level: '3級', word: '跳躍', answer: 'ちょうやく', wrong: ['とうやく', 'ちょうよく', 'はねやく'] }, owner)).status, 200);
  assert.equal((await http('DELETE', `/api/admin/kanken/questions/${q.id}`, {}, owner)).status, 200);
  const st = data.stats.find(s => s.name === 'c1');
  assert.ok(st.answered >= 1 && st.correct >= 1, '成績が見られる');
});

test('学年ごとの級はオーナーが変えられる。オフにすると出題しない', async () => {
  await http('PATCH', '/api/admin/kanken/config', { gradeLevels: { '小5': ['5級'], '中1': ['5級', '4級'], '中2': ['4級', '3級'], '中3': ['3級', '準2級'] } }, owner);
  assert.equal((await http('GET', '/api/quiz/status', null, U.e5.cookie)).data.required, true);
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  assert.equal((await http('GET', '/api/quiz/status', null, U.e5.cookie)).data.required, false);
  assert.equal((await http('PATCH', '/api/admin/kanken/config', { enabled: true }, U.tch.cookie)).status, 403);
});
