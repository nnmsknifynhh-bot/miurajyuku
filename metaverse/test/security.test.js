// 第5段階 セキュリティ点検テスト
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');
const { db, pruneAuditLogs } = require('../server/db.js');

const T = SM.TILE;
let base, server;
const sockets = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
test.before(async () => {
  server = app.createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { sockets.forEach(s => s.disconnect()); server.close(); setTimeout(() => process.exit(0), 200).unref(); });

async function http(method, path, body, cookie, extra = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body || {})),
  });
  const sc = res.headers.get('set-cookie');
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie, headers: res.headers, setCookie: sc };
}
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    sockets.push(s);
    const c = { s, me: null, events: [] };
    s.onAny((ev, d) => c.events.push({ ev, d }));
    s.on('init', (d) => { c.me = d.me; resolve(c); });
    s.on('connect_error', reject);
  });
}
async function walk(c, tx, ty) {
  for (const step of SM.findPath(Math.floor(c.me.x / T), Math.floor(c.me.y / T), tx, ty)) {
    const p = SM.tileCenter(step.x, step.y);
    c.s.emit('move', { x: p.x, y: p.y, dir: 'up' });
    await sleep(25);
    c.me.x = p.x; c.me.y = p.y;
  }
  await sleep(60);
}

let owner, stu, tch;
test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('POST', '/api/admin/users', { role: 'student', displayName: 'はな', loginId: 'hana', password: 'password123' }, owner);
  await http('POST', '/api/admin/users', { role: 'teacher', displayName: '佐藤', loginId: 'sato', password: 'password123', rooms: ['class1'] }, owner);
  stu = (await http('POST', '/api/login', { loginId: 'hana', password: 'password123' })).cookie;
  tch = (await http('POST', '/api/login', { loginId: 'sato', password: 'password123' })).cookie;
});

test('セキュリティヘッダー（CSP・クリックジャッキング対策など）がすべての画面に付く', async () => {
  for (const p of ['/', '/app', '/admin', '/api/setup-status']) {
    const r = await http('GET', p);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/, p);
    assert.match(csp, /script-src 'self'(;|$)/, `${p}: インラインスクリプト禁止`);
    assert.match(csp, /frame-ancestors 'none'/, p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', p);
    assert.equal(r.headers.get('x-powered-by'), null, p);
  }
});

test('ログイン Cookie は HttpOnly・SameSite（JavaScript から読めない）', async () => {
  const r = await http('POST', '/api/login', { loginId: 'hana', password: 'password123' });
  assert.match(r.setCookie, /HttpOnly/i);
  assert.match(r.setCookie, /SameSite=Lax/i);
});

test('表示名に HTML を入れても、タグとして保存されない', async () => {
  const r = await http('POST', '/api/admin/users', { role: 'student', displayName: '<b onclick=x>はな</b>', loginId: 'xss1', password: 'password123' }, owner);
  assert.equal(r.status, 201);
  assert.ok(!/[<>]/.test(r.data.user.displayName));
});

test('大きすぎるリクエスト・壊れたデータは拒否される（サーバーは落ちない）', async () => {
  const big = await http('POST', '/api/login', { loginId: 'a'.repeat(30000), password: 'x' });
  assert.equal(big.status, 413);
  const broken = await http('POST', '/api/login', '{"loginId": ');
  assert.equal(broken.status, 400);
  const notJson = await http('POST', '/api/login', 'loginId=a', null, { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(notJson.status, 415);
  assert.equal((await http('GET', '/api/setup-status')).status, 200);
});

test('パスワード変更も、5回続けて間違えると一時ロックされる', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await http('POST', '/api/me/password', { currentPassword: 'wrong-' + i, newPassword: 'newpassword1' }, stu)).status, 401);
  assert.equal((await http('POST', '/api/me/password', { currentPassword: 'password123', newPassword: 'newpassword1' }, stu)).status, 429);
});

test('イベントを大量に送っても、10回/秒程度までしか処理されない', async () => {
  const c = await connect(stu);
  let acks = 0;
  for (let i = 0; i < 100; i++) c.s.emit('sit', '1,1', () => { acks++; });
  await sleep(500);
  assert.ok(acks <= 26, `処理された数: ${acks}`);
  assert.ok(acks >= 15, `通常の量は処理される: ${acks}`);
  c.s.disconnect();
});

test('手のあげさげを連打しても、先生への通知は3秒に1回まで', async () => {
  await sleep(2100); // レート制限の回復待ち
  const s = await connect(stu), t = await connect(tch);
  await walk(t, 8, 1); await walk(s, 2, 6);
  const ask = (raised) => new Promise(r => s.s.emit('hand', { raised }, r));
  assert.equal((await ask(true)).ok, true);
  await ask(false);
  const again = await ask(true);
  assert.equal(again.ok, false);
  assert.match(again.error, /すこし待って/);
  await sleep(100);
  assert.equal(t.events.filter(e => e.ev === 'hand-raised').length, 1);
});

test('操作ログは保存期間（既定180日）を過ぎると自動で削除される', () => {
  db.prepare("INSERT INTO audit_logs (at, action, ip) VALUES (?, 'login.success', '203.0.113.1')").run(new Date(Date.now() - 200 * 86400e3).toISOString());
  const removed = pruneAuditLogs();
  assert.equal(removed, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE ip = '203.0.113.1'").get().n, 0);
});

test('生徒の画面・API から、ほかの人の個人情報（ログインID・IP）は見えない', async () => {
  const c = await connect(stu);
  const keys = new Set();
  const all = [c.me, ...(c.events.find(e => e.ev === 'init')?.d.users || [])];
  all.forEach(u => Object.keys(u).forEach(k => keys.add(k)));
  for (const k of ['loginId', 'login_id', 'ip', 'device', 'password_hash']) assert.ok(!keys.has(k), k);
  assert.equal((await http('GET', '/api/admin/presence', null, stu)).status, 403);
  assert.equal((await http('GET', '/api/admin/users', null, stu)).status, 403);
});
