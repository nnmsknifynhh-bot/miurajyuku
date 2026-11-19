// 季節のお楽しみ：がんばりサンタ・朝活チャレンジ
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/server.js');
const G = require('../server/ganbari.js');
const F = require('../server/fun.js');

let base, server;
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
const at = (day, hm = '19:00') => new Date(`${day}T${hm}:00+09:00`);
const Y = 2026;

let owner; const U = {};
test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  for (const k of ['aaa', 'bbb']) {
    const r = await http('POST', '/api/admin/users', { role: 'student', loginId: k, displayName: k, grade: '中2', password: 'password123' }, owner);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  }
});

test('がんばりサンタ（2章）：10月15日→手紙とサンタ帽、11月15日→12/1〜25 サンタ、両方→トナカイも', () => {
  const pad = (n) => String(n).padStart(2, '0');
  for (let d = 1; d <= 15; d++) G.setManual(U.aaa.id, `${Y}-10-${pad(d)}`, 60, null);           // 第1章クリア
  for (let d = 1; d <= 15; d++) G.setManual(U.aaa.id, `${Y}-11-${pad(d)}`, 70, null);           // 第2章クリア
  for (let d = 1; d <= 15; d++) G.setManual(U.bbb.id, `${Y}-10-${pad(d)}`, d === 1 ? 59 : 70, null); // 1日足りない
  for (let d = 1; d <= 15; d++) G.setManual(U.bbb.id, `${Y}-11-${pad(d)}`, 70, null);
  // 第1章のとちゅう
  const mid = F.santaStatus(U.aaa.id, at(`${Y}-10-10`));
  assert.equal(mid.phase, 'ch1'); assert.equal(mid.chapters[0].days, 10); assert.equal(mid.chapters[0].cleared, false); assert.equal(mid.minMinutes, 60);
  assert.equal(mid.letter, false);
  // 第1章クリア：手紙とサンタ帽
  const c1 = F.santaStatus(U.aaa.id, at(`${Y}-10-20`));
  assert.equal(c1.chapters[0].cleared, true); assert.equal(c1.letter, true);
  assert.ok(G.owned(U.aaa.id).includes('santa_hat'));
  assert.equal(F.santaStatus(U.bbb.id, at(`${Y}-10-31`)).chapters[0].days, 14);
  assert.ok(!G.owned(U.bbb.id).includes('santa_hat'));
  assert.ok(F.readLetter(U.aaa.id, 'santa', at(`${Y}-11-02`)).ok);
  assert.equal(F.santaStatus(U.aaa.id, at(`${Y}-11-02`)).letter, false, '読んだら出ない');
  assert.match(F.readLetter(U.bbb.id, 'santa', at(`${Y}-11-02`)).error, /まだ/);
  // 第2章
  const c2 = F.santaStatus(U.bbb.id, at(`${Y}-11-20`));
  assert.equal(c2.phase, 'ch2'); assert.equal(c2.chapters[1].days, 15); assert.equal(c2.chapters[1].cleared, true);
  // 12/1〜12/25：ついて歩く
  assert.deepEqual(F.followersOf(U.aaa.id, at(`${Y}-12-10`)), ['santa', 'reindeer'], '両方クリア');
  assert.deepEqual(F.followersOf(U.bbb.id, at(`${Y}-12-10`)), ['santa'], '第2章だけ');
  assert.equal(F.followersOf(U.aaa.id, at(`${Y}-11-30`)), null, '12/1から');
  assert.equal(F.followersOf(U.aaa.id, at(`${Y}-12-26`)), null, '12/25まで');
  assert.equal(F.santaStatus(U.aaa.id, at(`${Y}-09-30`)), null, '期間の外');
  assert.match(G.buy(U.bbb.id, 'santa_hat'), /買えません/, 'お店では買えない');
  // 12/25：サンタがついている子にクリスマスの演出
  assert.equal(F.fxOf(U.bbb.id, at(`${Y}-12-25`)), 'xmas');
  assert.equal(F.fxOf(U.bbb.id, at(`${Y}-12-24`)), null);
});

test('七夕（2章）：5月15日→手紙と笹かざり、6月15日→7/1〜20 彦星、両方→織姫も。7/7は両方クリアの子に演出', () => {
  const pad = (n) => String(n).padStart(2, '0');
  for (let d = 1; d <= 15; d++) { G.setManual(U.aaa.id, `${Y}-05-${pad(d)}`, 60, null); G.setManual(U.aaa.id, `${Y}-06-${pad(d)}`, 60, null); }
  for (let d = 1; d <= 15; d++) G.setManual(U.bbb.id, `${Y}-06-${pad(d)}`, 60, null);
  const s1 = F.tanabataStatus(U.aaa.id, at(`${Y}-05-20`));
  assert.equal(s1.phase, 'ch1'); assert.equal(s1.chapters[0].cleared, true); assert.equal(s1.letter, true);
  assert.ok(G.owned(U.aaa.id).includes('sasa'));
  assert.ok(F.readLetter(U.aaa.id, 'tanabata', at(`${Y}-06-01`)).ok);
  assert.equal(F.tanabataStatus(U.aaa.id, at(`${Y}-06-01`)).letter, false);
  assert.equal(F.tanabataStatus(U.aaa.id, at(`${Y}-04-30`)), null, '5/1から');
  assert.deepEqual(F.followersOf(U.aaa.id, at(`${Y}-07-10`)), ['hikoboshi', 'orihime']);
  assert.deepEqual(F.followersOf(U.bbb.id, at(`${Y}-07-10`)), ['hikoboshi'], '第2章だけ：彦星だけ');
  assert.equal(F.followersOf(U.aaa.id, at(`${Y}-07-21`)), null, '7/20まで');
  assert.equal(F.fxOf(U.aaa.id, at(`${Y}-07-07`)), 'tanabata', '両方クリアは7/7に演出');
  assert.equal(F.fxOf(U.bbb.id, at(`${Y}-07-07`)), null, '彦星だけの子は演出なし（織姫に会えていない）');
});

test('朝活：6:00〜7:30に数えた時間が30分になった日にスタンプと3ポイント（バッジはなし）', () => {
  const before = G.points(U.bbb.id).earned;
  let got = [];
  for (let m = 0; m < 35; m++) got = got.concat(F.morningTick([U.bbb.id], at(`${Y}-10-01`, `06:${String(10 + m).padStart(2, '0')}`)));
  assert.equal(got.length, 1, '30分になったときに1回だけ');
  assert.equal(got[0].stamps, 1); assert.equal(got[0].points, 3);
  assert.equal(G.points(U.bbb.id).earned, before + 3, 'スタンプのポイント');
  assert.deepEqual(F.morningTick([U.bbb.id], at(`${Y}-10-02`, '07:30')), [], '7:30からは数えない');
  assert.equal(F.morningStatus(U.bbb.id, at(`${Y}-10-02`)).today, 0);
  assert.ok(!F.badgesOf(U.bbb.id).some(b => b.label === '早起きバッジ'));
  assert.match(G.setConfig({ fun: { asakatsuStart: '08:00', asakatsuEnd: '07:00' } }), /時間帯/);
});

test('オーナーはお楽しみのオン/オフと条件を変えられる。オフにすると出ない', async () => {
  assert.equal((await http('PATCH', '/api/admin/ganbari/config', { fun: { santaDays: 0 } }, owner)).status, 400);
  assert.equal((await http('PATCH', '/api/admin/ganbari/config', { fun: { santa: false, asakatsu: false } }, owner)).status, 200);
  assert.equal(F.santaStatus(U.aaa.id, at(`${Y}-12-20`)), null);
  assert.deepEqual(F.morningTick([U.aaa.id], at(`${Y}-10-20`, '06:30')), []);
  await http('PATCH', '/api/admin/ganbari/config', { fun: { santa: true, asakatsu: true } }, owner);
});

test('生徒の画面用のまとめ', async () => {
  const me = (await http('GET', '/api/me/ganbari', null, U.aaa.cookie)).data;
  assert.ok(me.fun && 'santa' in me.fun && 'morning' in me.fun);
});
