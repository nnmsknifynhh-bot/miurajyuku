// 第1段階 API テスト：認証・権限・管理機能をサーバー側で検証する
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const app = require('../server/server.js');

let base, server;
test.before(async () => {
  server = app.createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

// cookie を保持する簡易クライアント
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}

const owner = client(), teacher = client(), student = client(), anon = client();
let teacherId, studentId;

test('初期セットアップでオーナーを作成でき、2回目はできない', async () => {
  assert.equal((await anon('GET', '/api/setup-status')).data.needsSetup, true);
  const r = await owner('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' });
  assert.equal(r.status, 200); assert.equal(r.data.user.role, 'owner');
  assert.equal((await anon('POST', '/api/setup', { displayName: 'x', loginId: 'hacker', password: 'password1' })).status, 409);
});

test('未ログインでは API を使えない', async () => {
  assert.equal((await anon('GET', '/api/me')).status, 401);
  assert.equal((await anon('GET', '/api/admin/users')).status, 401);
});

test('オーナーが先生・生徒を登録できる（生徒に禁止権限は付かない）', async () => {
  let r = await owner('POST', '/api/admin/users', { role: 'teacher', displayName: '佐藤先生', loginId: 'sato', password: 'teacherpw1', rooms: ['class1', 'bogus'] });
  assert.equal(r.status, 201); teacherId = r.data.user.id;
  assert.deepEqual(r.data.user.rooms, ['class1']);
  assert.equal(r.data.user.permissions.start_class_call, true);
  r = await owner('POST', '/api/admin/users', { role: 'student', displayName: 'たろう', loginId: 'taro', password: 'studentpw1',
    permissions: { enter_classroom: true, start_private_call: true, manage_classroom: true, share_screen: true } });
  assert.equal(r.status, 201); studentId = r.data.user.id;
  const p = r.data.user.permissions;
  assert.equal(p.enter_classroom, true);
  assert.equal(p.start_private_call, false); assert.equal(p.manage_classroom, false); assert.equal(p.share_screen, false);
  assert.equal((await owner('POST', '/api/admin/users', { role: 'student', displayName: 'x', loginId: 'TARO', password: 'studentpw1' })).status, 409);
  assert.equal((await owner('POST', '/api/admin/users', { role: 'owner', displayName: 'x', loginId: 'own2', password: 'studentpw1' })).status, 400);
});

test('ログイン：パスワード違いは失敗、正しければ成功', async () => {
  assert.equal((await student('POST', '/api/login', { loginId: 'taro', password: 'wrong-pass' })).status, 401);
  assert.equal((await student('POST', '/api/login', { loginId: 'Taro', password: 'studentpw1' })).status, 200);
  assert.equal((await teacher('POST', '/api/login', { loginId: 'sato', password: 'teacherpw1' })).status, 200);
});

test('生徒・先生は管理 API を使えない（サーバー側で拒否）', async () => {
  assert.equal((await student('GET', '/api/admin/users')).status, 403);
  assert.equal((await student('PATCH', `/api/admin/users/${studentId}`, { permissions: { manage_classroom: true } })).status, 403);
  assert.equal((await student('PATCH', '/api/admin/rooms/study', { capacity: 1 })).status, 403);
  assert.equal((await teacher('GET', '/api/admin/users')).status, 403);
  assert.equal((await teacher('PATCH', '/api/admin/rooms/class1', { capacity: 5 })).status, 403);
});

test('入室できる教室：先生は担当教室のみ、生徒は全教室', async () => {
  const t = (await teacher('GET', '/api/me')).data.rooms;
  assert.deepEqual(t.filter(r => r.canEnter).map(r => r.id), ['class1', 'study']);
  const s = (await student('GET', '/api/me')).data.rooms;
  assert.deepEqual(s.filter(r => r.canEnter).map(r => r.id), ['class1', 'class2', 'class3', 'study']);
});

test('教室管理の権限を付けた先生は定員を変更できる（座席数が上限）', async () => {
  const r = await owner('PATCH', `/api/admin/users/${teacherId}`, { permissions: { manage_classroom: true } });
  assert.equal(r.data.user.permissions.manage_classroom, true);
  assert.equal((await teacher('PATCH', '/api/admin/rooms/study', { capacity: 20 })).status, 200);
  assert.equal((await teacher('PATCH', '/api/admin/rooms/class1', { capacity: 16 })).status, 400);
  assert.equal((await teacher('PATCH', '/api/admin/rooms/class1', { capacity: 0 })).status, 400);
});

test('生徒の「教室への入室」を外すと教室に入れなくなる', async () => {
  await owner('PATCH', `/api/admin/users/${studentId}`, { permissions: { enter_classroom: false } });
  const s = (await student('GET', '/api/me')).data.rooms;
  assert.deepEqual(s.filter(r => r.canEnter).map(r => r.id), ['study']);
  await owner('PATCH', `/api/admin/users/${studentId}`, { permissions: { enter_classroom: true } });
});

test('他サイトからの書き込みリクエストは拒否される', async () => {
  const r = await owner('PATCH', '/api/admin/rooms/study', { capacity: 3 }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('強制ログアウト・無効化でログインが切れ、無効化中はログインできない', async () => {
  let r = await owner('POST', `/api/admin/users/${studentId}/revoke-sessions`, {});
  assert.equal(r.data.revoked, 1);
  assert.equal((await student('GET', '/api/me')).status, 401);
  assert.equal((await student('POST', '/api/login', { loginId: 'taro', password: 'studentpw1' })).status, 200);
  await owner('PATCH', `/api/admin/users/${studentId}`, { isActive: false });
  assert.equal((await student('GET', '/api/me')).status, 401);
  assert.equal((await student('POST', '/api/login', { loginId: 'taro', password: 'studentpw1' })).status, 401);
  await owner('PATCH', `/api/admin/users/${studentId}`, { isActive: true });
  assert.equal((await student('POST', '/api/login', { loginId: 'taro', password: 'studentpw1' })).status, 200);
});

test('オーナーは無効化できず、権限も変更できない', async () => {
  const me = (await owner('GET', '/api/me')).data.user;
  assert.equal((await owner('PATCH', `/api/admin/users/${me.id}`, { isActive: false })).status, 400);
  assert.equal((await owner('PATCH', `/api/admin/users/${me.id}`, { permissions: { manage_classroom: false } })).status, 400);
});

test('5回続けて失敗するとそのIDは一時ロックされる', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c('POST', '/api/login', { loginId: 'sato', password: 'bad-password' })).status, 401);
  assert.equal((await c('POST', '/api/login', { loginId: 'sato', password: 'teacherpw1' })).status, 429);
});

test('パスワードはハッシュ化して保存されている', async () => {
  const { db } = require('../server/db');
  const rows = db.prepare('SELECT password_hash FROM users').all();
  for (const r of rows) assert.match(r.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});
