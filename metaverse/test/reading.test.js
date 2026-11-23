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
  assert.deepEqual(p, { count: 3, best: 95, passed: true });
  const adm = (await http('GET', '/api/admin/reading', null, owner)).data;
  assert.equal(adm.units.length, 2); assert.equal(adm.summary[0].count, 3);
  // 1分の語数を変えると、制限時間も変わる
  assert.equal((await http('PATCH', '/api/admin/reading/config', { wpm: { '中3': 60 } }, owner)).status, 200);
  assert.equal((await http('GET', '/api/reading/units', null, sc)).data.units[0].limit, 55);
  assert.equal((await http('GET', '/api/admin/reading', null, sc)).status, 403, '生徒は管理画面を使えない');
});
