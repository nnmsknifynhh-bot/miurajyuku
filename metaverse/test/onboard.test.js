// はじめての人へ：ようこそツアー（1回だけ）と、はじめての日の「やることチェック」（30分で＋5ポイント・1回だけ）
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

test('ツアーは1回だけ。やることチェックは新しい生徒だけ・30分で＋5ポイント', async () => {
  const owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const id = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'new', displayName: 'あらた', grade: '中1', password: 'password123' }, owner)).data.user.id;
  const old = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'old', displayName: 'ふるい', grade: '中1', password: 'password123' }, owner)).data.user.id;
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 30 * 86400e3).toISOString(), old);
  const sc = (await http('POST', '/api/login', { loginId: 'new', password: 'password123' })).cookie;
  const oc = (await http('POST', '/api/login', { loginId: 'old', password: 'password123' })).cookie;
  let me = (await http('GET', '/api/me', null, sc)).data.onboard;
  assert.equal(me.tourSeen, false);
  assert.deepEqual(me.firstDay, { minutes: 30, points: 5 });
  assert.equal((await http('GET', '/api/me', null, oc)).data.onboard.firstDay, null, '前からいる生徒には出さない');
  assert.equal((await http('GET', '/api/me', null, owner)).data.onboard.firstDay, null, '先生には出さない');
  await http('POST', '/api/me/tour-seen', {}, sc);
  assert.equal((await http('GET', '/api/me', null, sc)).data.onboard.tourSeen, true);
  // 30分まだ → できない
  assert.equal((await http('POST', '/api/me/first-day', {}, sc)).status, 400);
  db.prepare('INSERT INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, 30, 30)').run(id, G.jst().day);
  const before = G.points(id).balance;
  const r = await http('POST', '/api/me/first-day', {}, sc);
  assert.equal(r.status, 200); assert.equal(r.data.points, 5);
  assert.equal(G.points(id).balance, before + 5);
  assert.equal((await http('POST', '/api/me/first-day', {}, sc)).status, 400, '1回だけ');
  assert.equal((await http('GET', '/api/me', null, sc)).data.onboard.firstDay, null);
});
