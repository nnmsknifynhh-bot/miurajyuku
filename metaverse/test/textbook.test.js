// 📘 英語の教科書：教室の設定で一覧を持ち、学校に結びつける。単元に教科書をつけると、その学校の生徒にだけ出る
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

let owner; const U = {};
const titles = async (k) => (await http('GET', '/api/reading/units', null, U[k].cookie)).data.units.map(u => u.title).sort();
test('準備：学校2つ・中1が3人', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  for (const n of ['A中学校', 'B中学校']) assert.equal((await http('POST', '/api/admin/schools', { name: n }, owner)).status, 200);
  for (const [k, school] of [['a', 'A中学校'], ['b', 'B中学校'], ['n', null]]) {
    const r = await http('POST', '/api/admin/users', { role: 'student', grade: '中1', loginId: 'stu' + k, displayName: k, password: 'password123' }, owner);
    if (school) assert.equal((await http('PATCH', `/api/admin/users/${r.data.user.id}`, { school }, owner)).status, 200);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: 'stu' + k, password: 'password123' })).cookie };
  }
});

test('教科書の一覧（はじめから主な教科書）・学校に結びつける', async () => {
  const r = await http('GET', '/api/admin/schools', null, owner);
  assert.ok(r.data.textbooks.includes('ニュークラウン'));
  assert.equal((await http('POST', '/api/admin/schools', { action: 'textbook', name: 'A中学校', textbook: 'ニュークラウン' }, owner)).status, 200);
  assert.equal((await http('POST', '/api/admin/schools', { action: 'textbook', name: 'B中学校', textbook: 'サンシャイン' }, owner)).status, 200);
  assert.equal((await http('POST', '/api/admin/schools', { action: 'textbook', name: 'B中学校', textbook: 'ないよ' }, owner)).status, 400);
  const s = (await http('GET', '/api/admin/schools', null, owner)).data.schools;
  assert.equal(s.find(x => x.name === 'A中学校').textbook, 'ニュークラウン');
});

test('単元に教科書をつけると、その教科書の学校の生徒にだけ出る（教科書なしは全員・学校に教科書がない子は全部）', async () => {
  const add = (title, textbook) => http('POST', '/api/admin/reading/units', { grade: '中1', title, textbook, text: 'Hello.\nこんにちは。' }, owner);
  assert.equal((await add('共通', null)).status, 201);
  assert.equal((await add('NC Unit1', 'ニュークラウン')).status, 201);
  assert.equal((await add('SS Unit1', 'サンシャイン')).status, 201);
  assert.equal((await add('X', 'ないよ')).status, 400);
  assert.deepEqual(await titles('a'), ['NC Unit1', '共通']);
  assert.deepEqual(await titles('b'), ['SS Unit1', '共通']);
  assert.deepEqual(await titles('n'), ['NC Unit1', 'SS Unit1', '共通']);
  const list = (await http('GET', '/api/admin/reading', null, owner)).data;
  assert.ok(list.textbooks.includes('サンシャイン'));
  assert.equal(list.units.find(u => u.title === 'NC Unit1').textbook, 'ニュークラウン');
});

test('名前を変えると、単元と学校の結びつきもいっしょに変わる・単元がある教科書は消せない・学校の名前を変えても教科書はそのまま', async () => {
  assert.equal((await http('POST', '/api/admin/schools', { action: 'tb-rename', from: 'ニュークラウン', to: 'NEW CROWN' }, owner)).status, 200);
  assert.deepEqual(await titles('a'), ['NC Unit1', '共通']);
  assert.equal((await http('POST', '/api/admin/schools', { action: 'tb-remove', name: 'NEW CROWN' }, owner)).status, 400);
  assert.equal((await http('POST', '/api/admin/schools', { action: 'rename', from: 'A中学校', to: 'A中' }, owner)).status, 200);
  const s = (await http('GET', '/api/admin/schools', null, owner)).data.schools;
  assert.equal(s.find(x => x.name === 'A中').textbook, 'NEW CROWN');
  assert.deepEqual(await titles('a'), ['NC Unit1', '共通']);
  assert.equal((await http('POST', '/api/admin/schools', { action: 'tb-add', name: 'ニューホライズン' }, owner)).status, 400, 'もうある');
});
