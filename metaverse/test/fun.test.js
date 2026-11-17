// 季節のお楽しみ：がんばりサンタ・年越し自習・朝活チャレンジ・バッジ
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

test('がんばりサンタ：11/1〜30に学年の最低時間（中2は60分）以上の日が10日以上で、12/1〜7に箱を開けられる（1回だけ）', () => {
  for (let d = 1; d <= 10; d++) G.setManual(U.aaa.id, `${Y}-11-${String(d).padStart(2, '0')}`, 60, null);
  for (let d = 1; d <= 10; d++) G.setManual(U.bbb.id, `${Y}-11-${String(d).padStart(2, '0')}`, d === 1 ? 59 : 70, null); // 1日は足りない
  const c1 = F.santaStatus(U.aaa.id, at(`${Y}-11-20`));
  assert.equal(c1.phase, 'count'); assert.equal(c1.days, 10); assert.equal(c1.eligible, true); assert.equal(c1.minMinutes, 60);
  assert.equal(F.santaStatus(U.bbb.id, at(`${Y}-11-20`)).days, 9);
  assert.equal(F.santaStatus(U.aaa.id, at(`${Y}-10-31`)), null, '期間の外');
  assert.equal(F.santaStatus(U.aaa.id, at(`${Y}-12-08`)), null, '12/8からは開けられない');
  assert.match(F.openSanta(U.aaa.id, at(`${Y}-11-20`)).error, /12月1日/);
  const r = F.openSanta(U.aaa.id, at(`${Y}-12-03`));
  assert.ok(r.item && r.item.emoji, 'クリスマスのアイテムが入っている');
  assert.ok(G.owned(U.aaa.id).includes(r.item.id));
  assert.match(F.openSanta(U.aaa.id, at(`${Y}-12-05`)).error, /もう開けました/);
  assert.match(F.openSanta(U.bbb.id, at(`${Y}-12-01`)).error, /10日以上/);
  assert.match(G.buy(U.bbb.id, 'x_reindeer'), /買えません/, 'お店では買えない');
});

test('年越し自習：23:50〜0:10に自習室にいて（20分のうち18分以上）、0:10にもいる生徒にバッジ', () => {
  const tick = (ids, day, hm) => F.toshikoshiTick(ids, at(day, hm));
  const minutes = [];
  for (let m = 50; m < 60; m++) minutes.push([`${Y}-12-31`, `23:${m}`]);
  for (let m = 0; m < 10; m++) minutes.push([`${Y + 1}-01-01`, `00:0${m}`]);
  assert.deepEqual(tick([U.aaa.id], `${Y}-12-31`, '23:49'), { year: null, awarded: [] }, '23:50より前は数えない');
  minutes.forEach(([d, hm], i) => {
    const ids = [U.aaa.id];
    if (i >= 5) ids.push(U.bbb.id); // bbb は 23:55 から（15分だけ）
    assert.deepEqual(tick(ids, d, hm).awarded, [], '0:10までは、まだあげない');
  });
  const r = tick([U.aaa.id, U.bbb.id], `${Y + 1}-01-01`, '00:10');
  assert.deepEqual(r.awarded, [U.aaa.id], 'ずっといた aaa だけ');
  assert.equal(r.year, Y + 1);
  assert.deepEqual(tick([U.aaa.id], `${Y + 1}-01-01`, '00:11').awarded, [], '2回目はなし');
  assert.ok(F.badgesOf(U.aaa.id).some(b => b.label.includes('年越し自習')));
  assert.ok(!F.badgesOf(U.bbb.id).some(b => b.label.includes('年越し自習')));
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

test('生徒の画面用のまとめ（バッジつき）', async () => {
  const me = (await http('GET', '/api/me/ganbari', null, U.aaa.cookie)).data;
  assert.ok(me.fun && Array.isArray(me.fun.badges));
  assert.ok(me.fun.badges.length >= 1);
});
