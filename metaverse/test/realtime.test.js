// 第2段階 リアルタイム機能テスト：入室チェック（権限・定員）、座席、挙手、切断
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');

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

async function http(method, path, body, cookie) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const sc = res.headers.get('set-cookie');
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
async function login(loginId, password) {
  const r = await http('POST', '/api/login', { loginId, password });
  assert.equal(r.status, 200, `login ${loginId}`);
  return r.cookie;
}

// ソケットで接続し、init を受け取るまで待つ
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: cookie ? { Cookie: cookie } : {}, reconnection: false, forceNew: true });
    sockets.push(s);
    const c = { s, events: [], me: null, rooms: null, rejected: [] };
    s.onAny((ev, data) => c.events.push({ ev, data }));
    s.on('init', (d) => { c.me = d.me; c.rooms = d.rooms; resolve(c); });
    s.on('rooms', (r) => { c.rooms = r; });
    s.on('move-rejected', (d) => { c.rejected.push(d.reason); c.me.x = d.x; c.me.y = d.y; });
    s.on('force-move', (d) => { c.me.x = d.x; c.me.y = d.y; });
    s.on('connect_error', reject);
  });
}

// 経路にそって1マスずつ移動。拒否されたら止まる
async function walk(c, tx, ty) {
  const sx = Math.floor(c.me.x / T), sy = Math.floor(c.me.y / T);
  const path = SM.findPath(sx, sy, tx, ty);
  assert.ok(path, `path to ${tx},${ty}`);
  const before = c.rejected.length;
  for (const step of path) {
    const p = SM.tileCenter(step.x, step.y);
    c.s.emit('move', { x: p.x, y: p.y, dir: 'up', moving: true });
    await sleep(25);
    if (c.rejected.length > before) return false;
    c.me.x = p.x; c.me.y = p.y;
  }
  await sleep(60);
  return c.rejected.length === before;
}
const emitAck = (c, ev, data) => new Promise(r => c.s.emit(ev, data, r));

let ownerCookie;
const students = [];
const teachers = {};

test('準備：オーナー・先生3人・生徒46人を作成', async () => {
  ownerCookie = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  for (const [id, rooms] of [['t1', ['class1']], ['t2', ['class2']], ['t3', ['class3']]]) {
    const r = await http('POST', '/api/admin/users', { role: 'teacher', displayName: id, loginId: 'tch' + id, password: 'teacherpw1', rooms }, ownerCookie);
    assert.equal(r.status, 201);
    teachers[id] = { id: r.data.user.id, cookie: await login('tch' + id, 'teacherpw1') };
  }
  for (let i = 1; i <= 46; i++) {
    const r = await http('POST', '/api/admin/users', { role: 'student', displayName: `生徒${i}`, loginId: `stu${i}`, password: 'studentpw1', grade: i >= 31 && i <= 45 ? '高1' : undefined }, ownerCookie); // 31〜45人目は高校生（高校生自習室へ）
    assert.equal(r.status, 201);
    students.push({ id: r.data.user.id, cookie: await login(`stu${i}`, 'studentpw1') });
  }
});

test('ログインしていない接続・他サイトからの接続は拒否される', async () => {
  await assert.rejects(connect(null), /unauthorized/);
  await assert.rejects(new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: students[0].cookie, Origin: 'https://evil.example' }, reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('connect', resolve); s.on('connect_error', reject);
  }), /forbidden/);
});

test('45人の生徒と先生3人が同時に接続し、教室1・2と高校生自習室に15人ずつ入れる', async () => {
  for (const s of students) s.c = await connect(s.cookie);
  for (const t of Object.values(teachers)) t.c = await connect(t.cookie);
  const groups = ['class1', 'class2', 'class3'];
  const results = await Promise.all(students.slice(0, 45).map((s, i) => {
    const room = groups[Math.floor(i / 15)];
    const z = SM.ZONES.find(v => v.id === room);
    return walk(s.c, z.x1 + 1 + (i % 13), z.y1 + 3);
  }));
  assert.ok(results.every(Boolean), '45人全員が入室できる');
  await sleep(200);
  const counts = students[0].c.rooms;
  assert.equal(counts.class1.students, 15);
  assert.equal(counts.class2.students, 15);
  assert.equal(counts.class3.students, 15);
  // ほかの人の位置が届いている
  const seen = students[45].c.events.filter(e => e.ev === 'moves').reduce((n, e) => n + e.data.length, 0);
  assert.ok(seen > 100, `位置の同期イベントを受信 (${seen})`);
});

test('定員に達した教室には16人目の生徒が入れない（先生は定員に数えない）', async () => {
  const s = students[45];
  const ok = await walk(s.c, 5, 10);
  assert.equal(ok, false);
  assert.match(s.c.rejected.at(-1), /満員/);
  assert.equal(SM.zoneAtPx(s.c.me.x, s.c.me.y)?.id === 'class1', false);
  assert.equal(await walk(teachers.t1.c, 8, 4), true);
  await sleep(150);
  assert.equal(s.c.rooms.class1.students, 15);
  assert.equal(s.c.rooms.class1.staff, 1);
});

test('先生は担当外の教室に入れない', async () => {
  const ok = await walk(teachers.t2.c, 5, 4); // class1
  assert.equal(ok, false);
  assert.match(teachers.t2.c.rejected.at(-1), /担当/);
  assert.equal(await walk(teachers.t2.c, 25, 4), true); // class2
});

test('定員を変更すると、すぐに入室制限に反映される', async () => {
  await http('PATCH', '/api/admin/rooms/study', { capacity: 1 }, ownerCookie);
  const a = students[45];
  assert.equal(await walk(a.c, 10, 23), true);
  const b = students[0];
  assert.equal(await walk(b.c, 12, 23), false);
  assert.match(b.c.rejected.at(-1), /自習室は満員/);
  await http('PATCH', '/api/admin/rooms/study', { capacity: 30 }, ownerCookie);
});

test('同じ席には2人座れない', async () => {
  const a = students[45], b = students[1];
  assert.equal(await walk(b.c, 13, 24), true);
  assert.equal(await walk(a.c, 12, 23), true);
  const r1 = await emitAck(a.c, 'sit', '12,24');
  assert.equal(r1.ok, true);
  const r2 = await emitAck(b.c, 'sit', '12,24');
  assert.equal(r2.ok, false);
  assert.match(r2.error, /ほかの人/);
});

test('挙手：担当の先生とオーナーにだけ通知され、担当の先生が対応できる', async () => {
  const owner = await connect(ownerCookie);
  const st = students[2]; // class1
  const notes = (c) => c.events.filter(e => e.ev === 'hand-raised').length;
  const before = { t1: notes(teachers.t1.c), t2: notes(teachers.t2.c) };
  const r = await emitAck(st.c, 'hand', { raised: true });
  assert.equal(r.ok, true);
  await sleep(100);
  assert.equal(notes(teachers.t1.c), before.t1 + 1, '教室1の先生に通知');
  assert.equal(notes(teachers.t2.c), before.t2, '教室2の先生には通知されない');
  assert.equal(notes(owner), 1, 'オーナーに通知');
  const denied = await emitAck(teachers.t2.c, 'lower-hand', st.id);
  assert.equal(denied.ok, false);
  const done = await emitAck(teachers.t1.c, 'lower-hand', st.id);
  assert.equal(done.ok, true);
  await sleep(100);
  assert.ok(st.c.events.some(e => e.ev === 'hand-lowered'));
  owner.s.disconnect();
});

test('挙手は授業の教室の中だけ・生徒だけ', async () => {
  const r = await emitAck(students[45].c, 'hand', { raised: true }); // 自習室
  assert.equal(r.ok, false);
  const t = await emitAck(teachers.t1.c, 'hand', { raised: true });
  assert.equal(t.ok, false);
});

test('教室から出ると挙手は自動で取り消される', async () => {
  const st = students[3];
  await emitAck(st.c, 'hand', { raised: true });
  assert.equal(await walk(st.c, 14, 16), true); // ろうかへ
  await sleep(100);
  const ev = st.c.events.filter(e => e.ev === 'user-updated' && e.data.id === st.id && e.data.hand === false);
  assert.ok(ev.length >= 1);
});

test('入室の権限を外すと、教室にいる生徒はろうかへ移動させられる', async () => {
  const st = students[4]; // class1 にいる
  await http('PATCH', `/api/admin/users/${st.id}`, { permissions: { enter_classroom: false } }, ownerCookie);
  await sleep(150);
  assert.ok(st.c.events.some(e => e.ev === 'force-move'));
  assert.equal(SM.zoneAtPx(st.c.me.x, st.c.me.y).id, 'hall');
  assert.equal(await walk(st.c, 6, 4), false); // もう入れない
});

test('入室状況 API：オーナーは IP まで見られ、先生（教室管理なし）は見られない', async () => {
  const r = await http('GET', '/api/admin/presence', null, ownerCookie);
  assert.equal(r.status, 200);
  assert.ok(r.data.users.length >= 48);
  assert.ok(r.data.users[0].ip);
  assert.equal((await http('GET', '/api/admin/presence', null, teachers.t1.cookie)).status, 403);
});

test('オーナーが不審な接続を切断できる（ログインも無効化）', async () => {
  const st = students[5];
  const r = await http('POST', `/api/admin/presence/${st.id}/disconnect`, { revoke: true }, ownerCookie);
  assert.equal(r.data.disconnected, true);
  await sleep(150);
  assert.ok(st.c.events.some(e => e.ev === 'kicked'));
  assert.equal(st.c.s.connected, false);
  await assert.rejects(connect(st.cookie), /unauthorized/);
});

test('同じユーザーが別の端末で入ると、古い接続は切断される', async () => {
  const st = students[6];
  const second = await connect(st.cookie);
  await sleep(150);
  assert.ok(st.c.events.some(e => e.ev === 'kicked'));
  assert.equal(second.s.connected, true);
});

test('アカウントを無効化すると接続が切れる', async () => {
  const st = students[7];
  await http('PATCH', `/api/admin/users/${st.id}`, { isActive: false }, ownerCookie);
  await sleep(150);
  assert.ok(st.c.events.some(e => e.ev === 'kicked'));
});

test('切断すると人数とほかの人の画面から消える', async () => {
  const st = students[8]; // class1
  const watcher = students[9].c;
  const before = watcher.rooms.class1.students;
  st.c.s.disconnect();
  await sleep(300);
  assert.ok(watcher.events.some(e => e.ev === 'user-left' && e.data.id === st.id));
  assert.equal(watcher.rooms.class1.students, before - 1);
});

test('壁抜け・瞬間移動は拒否される', async () => {
  const c = students[10].c;
  const x = c.me.x, y = c.me.y;
  c.s.emit('move', { x: x + T * 10, y, dir: 'right' });
  await sleep(80);
  assert.match(c.rejected.at(-1), /速すぎ/);
  c.s.emit('move', { x: 0.5 * T, y: 0.5 * T, dir: 'up' }); // 壁
  await sleep(80);
  assert.equal(c.me.x, x);
});
