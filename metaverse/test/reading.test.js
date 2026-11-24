// 英語の音読（練習）：単元の登録（英語の行＋訳の行・話す人の名前は数えない）・制限時間（語数÷学年の1分の語数・5秒で切り上げ）・練習の記録
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/server.js');
const R = require('../server/reading.js');

let base, server;
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
const TEXT = `Jin: I'm sorry I'm late.
遅れてごめんなさい。
Sho: Don't worry. We've just arrived, too. But Hina hasn't come yet.
気にしないで。ぼくたちもちょうど着いたところだよ。でも、ヒナはまだ来ていないんだ。
Jin: Really? Is she late, too? I'll call her.
本当に？ 彼女も遅れているの？ 電話してみるね。
Jin: Hi, Hina. Where are you now?
もしもし、ヒナ。今どこにいるの？
Hina: Oh, I'm sorry. I got here early and I'm in the entrance hall now. I've already bought the tickets for all of us.
あっ、ごめんね。早く着いて、今はエントランスホールにいるの。もうみんなの分のチケットを買ってあるよ。`;

test('本文の分け方：名前は数えない・訳はすぐ下の行', () => {
  const ls = R.parseText(TEXT);
  assert.equal(ls.length, 5);
  assert.equal(ls[0].speaker, 'Jin'); assert.equal(ls[0].en, "I'm sorry I'm late."); assert.equal(ls[0].ja, '遅れてごめんなさい。');
  assert.equal(ls.reduce((n, l) => n + R.wordsOf(l.en).length, 0), 52, '中3の本文は52語');
  assert.equal(R.limitSec(52, '中3'), 60, '中3は52語を1分');
  assert.equal(R.limitSec(52, '中1'), 80, '中1は40語/分 → 78秒 → 80秒');
});

test('単元を登録して、生徒は自分の学年の単元を練習できる。90点以上・時間内で合格', async () => {
  const owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  assert.equal((await http('PATCH', '/api/admin/reading/config', { passScore: 90 }, owner)).status, 200, '合格ラインを90点に');
  assert.equal((await http('PATCH', '/api/admin/reading/config', { passScore: 30 }, owner)).status, 400);
  assert.equal((await http('POST', '/api/admin/reading/units', { grade: '中3', title: 'Unit 1 Part 1', text: TEXT }, owner)).status, 201);
  assert.equal((await http('POST', '/api/admin/reading/units', { grade: '中1', title: 'Unit 1', text: 'Hello. I am Ken.\nこんにちは。' }, owner)).status, 201);
  assert.equal((await http('POST', '/api/admin/reading/units', { grade: '中3', title: '', text: TEXT }, owner)).status, 400);
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'stu', displayName: 'すう', grade: '中3', password: 'password123' }, owner);
  const sc = (await http('POST', '/api/login', { loginId: 'stu', password: 'password123' })).cookie;
  const us = (await http('GET', '/api/reading/units', null, sc)).data.units;
  assert.equal(us.length, 1, '自分の学年だけ'); assert.equal(us[0].limit, 60); assert.equal(us[0].words, 52);
  let r = await http('POST', '/api/reading/practice', { unitId: us[0].id, score: 95, seconds: 75 }, sc);
  assert.equal(r.data.passed, false, '時間オーバー');
  r = await http('POST', '/api/reading/practice', { unitId: us[0].id, score: 88, seconds: 50 }, sc);
  assert.equal(r.data.passed, false, '90点に足りない');
  r = await http('POST', '/api/reading/practice', { unitId: us[0].id, score: 92, seconds: 58 }, sc);
  assert.equal(r.data.passed, true);
  const p = (await http('GET', '/api/reading/units', null, sc)).data.units[0].practice;
  assert.deepEqual(p, { count: 3, best: null, passed: false, enBest: 95, enPassed: true }, '英文で合格（訳だけはまだ）');
  const adm = (await http('GET', '/api/admin/reading', null, owner)).data;
  assert.equal(adm.units.length, 2); assert.equal(adm.summary[0].count, 3);
  // 1分の語数を変えると、制限時間も変わる
  assert.equal((await http('PATCH', '/api/admin/reading/config', { wpm: { '中3': 60 } }, owner)).status, 200);
  assert.equal((await http('GET', '/api/reading/units', null, sc)).data.units[0].limit, 55);
  assert.equal((await http('GET', '/api/admin/reading', null, sc)).status, 403, '生徒は管理画面を使えない');
});

test('本番のテスト：練習で合格するまで受けられない。クリアは単元ごとに1回、1回目+5／2回目+4／3回目から+3', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  const G = require('../server/ganbari.js');
  const mk = async (id) => { await http('POST', '/api/admin/users', { role: 'student', loginId: id, displayName: id, grade: '中3', password: 'password123' }, owner); return (await http('POST', '/api/login', { loginId: id, password: 'password123' })).cookie; };
  const a = await mk('tsa'), b = await mk('tsb');
  const unit = (await http('GET', '/api/reading/units', null, a)).data.units[0];
  assert.match((await http('POST', '/api/reading/test', { unitId: unit.id, score: 95, seconds: 50 }, a)).data.error, /練習/);
  for (const c of [a, b]) await http('POST', '/api/reading/practice', { unitId: unit.id, score: 95, seconds: 50 }, c);
  assert.match((await http('POST', '/api/reading/test', { unitId: unit.id, score: 95, seconds: 50 }, a)).data.error, /訳だけ/, '英文で合格しただけではテストは受けられない');
  for (const c of [a, b]) await http('POST', '/api/reading/practice', { unitId: unit.id, score: 92, seconds: 50, jaOnly: true }, c);
  // A：1回目でクリア → +5
  let r = (await http('POST', '/api/reading/test', { unitId: unit.id, score: 93, accuracy: 92, fluency: 95, completeness: 100, seconds: 50 }, a)).data;
  assert.equal(r.passed, true); assert.equal(r.points, 5); assert.equal(r.attempt, 1);
  r = (await http('POST', '/api/reading/test', { unitId: unit.id, score: 99, seconds: 50 }, a)).data;
  assert.equal(r.points, 0, '2回目のクリアはポイントなし'); assert.equal(r.alreadyCleared, true);
  // B：時間オーバー → 点数たりない → 3回目でクリア → +3
  assert.equal((await http('POST', '/api/reading/test', { unitId: unit.id, score: 95, seconds: 70 }, b)).data.passed, false);
  assert.equal((await http('POST', '/api/reading/test', { unitId: unit.id, score: 85, seconds: 50 }, b)).data.passed, false);
  r = (await http('POST', '/api/reading/test', { unitId: unit.id, score: 91, seconds: 52 }, b)).data;
  assert.equal(r.points, 3);
  const units = (await http('GET', '/api/reading/units', null, b)).data.units;
  assert.equal(units[0].test.passed, true);
  const adm = (await http('GET', '/api/admin/reading', null, owner)).data;
  assert.ok(adm.tests.some(t => t.name === 'tsb' && t.clearedAt === 3 && t.points === 3));
  assert.equal(adm.speechReady, false, 'キーがないときは準備まだ');
  assert.equal((await http('GET', '/api/reading/speech-token', null, a)).status, 503);
});

test('ライティング：音読テストに合格した単元だけ。練習で100点 → テスト。大文字・記号もまちがい。1回目+5', async () => {
  const W = require('../server/writing.js');
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  const a = (await http('POST', '/api/login', { loginId: 'tsa', password: 'password123' })).cookie; // 音読テストに合格ずみ
  const c = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'tsc', displayName: 'tsc', grade: '中3', password: 'password123' }, owner)) && (await http('POST', '/api/login', { loginId: 'tsc', password: 'password123' })).cookie;
  const unit = (await http('GET', '/api/reading/units', null, a)).data.units[0];
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1)]);
  const send = (cookie, mode) => fetch(`${base}/api/reading/writing?unitId=${unit.id}&mode=${mode}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Cookie: cookie }, body: jpg }).then(async r => ({ status: r.status, data: await r.json() }));
  const full = R.parseText(TEXT).map(l => l.en);
  W.ocr.read = async () => full;
  assert.match((await send(c, 'practice')).data.error, /音読テスト/);
  assert.match((await send(a, 'test')).data.error, /書く練習/);
  W.ocr.read = async () => ["i'm sorry I'm late", ...full.slice(1)];
  let r = (await send(a, 'practice')).data;
  assert.equal(r.passed, false); assert.ok(r.words.some(w => w.status === 'case')); assert.ok(r.words.some(w => w.status === 'punct'));
  W.ocr.read = async () => full;
  r = (await send(a, 'practice')).data; assert.equal(r.score, 100); assert.equal(r.passed, true);
  r = (await send(a, 'test')).data; assert.equal(r.passed, true); assert.equal(r.points, 5);
  r = (await send(a, 'test')).data; assert.equal(r.points, 0, 'ポイントは1回だけ');
  assert.equal((await http('GET', '/api/reading/units', null, a)).data.units[0].writing.testPassed, true);
  assert.ok((await http('GET', '/api/admin/reading', null, owner)).data.writing.some(w => w.name === 'tsa' && w.passed));
});

test('スピーキング：聞き取れなかった単語が3つ以上なら、点数が足りていても再テスト（練習もテストも）', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'tsm', displayName: 'tsm', grade: '中3', password: 'password123' }, owner);
  const m = (await http('POST', '/api/login', { loginId: 'tsm', password: 'password123' })).cookie;
  const unit = (await http('GET', '/api/reading/units', null, m)).data.units[0];
  assert.equal((await http('POST', '/api/reading/practice', { unitId: unit.id, score: 95, seconds: 40, jaOnly: true, missing: 3 }, m)).data.passed, false, '練習：3つで不合格');
  assert.equal((await http('POST', '/api/reading/practice', { unitId: unit.id, score: 95, seconds: 40, jaOnly: true, missing: 2 }, m)).data.passed, true, '練習：2つまでOK');
  const r = (await http('POST', '/api/reading/test', { unitId: unit.id, score: 96, seconds: 40, missing: 4 }, m)).data;
  assert.equal(r.passed, false); assert.equal(r.points, 0);
  assert.equal((await http('POST', '/api/reading/test', { unitId: unit.id, score: 96, seconds: 40, missing: 0 }, m)).data.points, 4, '2回目でクリア → +4');
});

test('小学生は、自分の学年の単元と中1の単元をえらべる（時間は小学生の語数で計算）', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'es5', displayName: 'es5', grade: '小5', password: 'password123' }, owner);
  await http('POST', '/api/admin/reading/units', { grade: '小5', title: 'Hello', text: 'Hello. Nice to meet you.\nこんにちは。' }, owner);
  const e = (await http('POST', '/api/login', { loginId: 'es5', password: 'password123' })).cookie;
  const us = (await http('GET', '/api/reading/units', null, e)).data.units;
  assert.deepEqual(us.map(u => u.grade), ['小5', '中1'], '自分の学年が先、つぎに中1（中3はなし）');
  const ken = us.find(u => u.grade === '中1');
  assert.equal(ken.limit, R.limitSec(ken.words, '小5'), '時間は小学生の語数で');
});
