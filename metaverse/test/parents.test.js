// 保護者：招待コードで登録・ロビーだけ・1日1回10分・名前の表示ルール・毎日5問・見たよスタンプ・母達の木
process.env.DB_PATH = ':memory:';
process.env.TEST_LEAVE_MS = '300';
process.env.PARENT_VISIT_MS = '1500';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');
const P = require('../server/parents.js');

const T = SM.TILE;
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
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    sockets.push(s);
    const c = { s, me: null, init: null, events: [], rejected: [] };
    s.onAny((ev, d) => c.events.push({ ev, d }));
    s.on('move-rejected', (d) => c.rejected.push(d && d.reason));
    s.on('init', (d) => { c.me = d.me; c.init = d; resolve(c); });
    s.on('visit-over', () => resolve(c));
    s.on('connect_error', reject);
  });
}
async function walk(c, tx, ty) {
  const path = SM.findPath(Math.floor(c.me.x / T), Math.floor(c.me.y / T), tx, ty);
  if (!path) return false;
  const before = c.rejected.length;
  for (const st of path) { const p = SM.tileCenter(st.x, st.y); c.s.emit('move', { x: p.x, y: p.y, dir: 'up' }); await sleep(20); c.me.x = p.x; c.me.y = p.y; }
  await sleep(100);
  return c.rejected.length === before;
}
const ask = (c, ev, d) => new Promise(r => c.s.emit(ev, d, r));

let owner; const U = {};
test('準備：生徒2人と招待コード', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  for (const k of ['kid', 'other']) {
    const r = await http('POST', '/api/admin/users', { password: 'password123', role: 'student', grade: '中2', loginId: k, displayName: k + 'くん' }, owner);
    assert.equal(r.status, 201);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  }
});

test('招待コードで登録できる（まちがったコード・使ったコードはだめ）', async () => {
  const inv = await http('POST', `/api/admin/users/${U.kid.id}/parent-invite`, {}, owner);
  assert.match(inv.data.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const badr = await http('POST', '/api/parent/register', { code: 'AAAA-BBBB', displayName: '母', loginId: 'mama', password: 'password123' });
  assert.equal(badr.status, 400);
  const r = await http('POST', '/api/parent/register', { code: inv.data.code.toLowerCase().replace('-', ''), displayName: 'キッドの母', loginId: 'mama', password: 'password123' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  U.mama = { cookie: r.cookie };
  const again = await http('POST', '/api/parent/register', { code: inv.data.code, displayName: '別', loginId: 'mama2', password: 'password123' });
  assert.equal(again.status, 400);
  const me = await http('GET', '/api/me', null, U.mama.cookie);
  assert.equal(me.data.user.role, 'parent');
  U.mama.id = me.data.user.id;
  // 管理画面：生徒にひもづいた保護者
  const ps = await http('GET', `/api/admin/users/${U.kid.id}/parents`, null, owner);
  assert.equal(ps.data.parents.length, 1);
  // 2人目の保護者（ほかの家族）
  const inv2 = await http('POST', `/api/admin/users/${U.other.id}/parent-invite`, {}, owner);
  const r2 = await http('POST', '/api/parent/register', { code: inv2.data.code, displayName: 'アザーの母', loginId: 'mama2', password: 'password123' });
  U.mama2 = { cookie: r2.cookie, id: (await http('GET', '/api/me', null, r2.cookie)).data.user.id };
  // 保護者は生徒の機能を使えない
  assert.equal((await http('GET', '/api/parent/home', null, U.kid.cookie)).status, 403);
});

test('名前の表示ルール：生徒からは「保護者」、保護者からはわが子だけ名前', async () => {
  U.kid.c = await connect(U.kid.cookie);
  U.other.c = await connect(U.other.cookie);
  U.mama.c = await connect(U.mama.cookie);
  const seen = Object.fromEntries(U.mama.c.init.users.map(u => [u.id, u]));
  assert.equal(seen[U.kid.id].name, 'kidくん');
  assert.equal(seen[U.kid.id].myChild, true);
  assert.equal(seen[U.other.id].name, '生徒');
  assert.ok('streak' in seen[U.other.id]);
  await sleep(150);
  const joined = U.kid.c.events.filter(e => e.ev === 'user-joined').map(e => e.d).find(u => u.id === U.mama.id);
  assert.equal(joined.name, '保護者');
  // 保護者どうしは名前が見える
  U.mama2.c = await connect(U.mama2.cookie);
  assert.equal(U.mama2.c.init.users.find(u => u.id === U.mama.id).name, 'キッドの母');
  assert.ok(U.mama.c.init.visit && U.mama.c.init.visit.endsAt > Date.now());
  assert.deepEqual(U.mama.c.init.reactions, ['👋', '🙇', '😊', '👍', '🌸']);
});

test('保護者はロビーだけ・ソファにすわれる・あいさつスタンプは決まったものだけ', async () => {
  const c = U.mama.c;
  const [sx, sy] = SM.SOFAS[0].seats[0];
  assert.ok(await walk(c, sx, sy), c.rejected.join());
  const r = await ask(c, 'sit', SM.seatId(sx, sy));
  assert.ok(r.ok, JSON.stringify(r));
  // 自習室へは入れない
  const z = SM.ZONES.find(v => v.id === 'study');
  const ok = await walk(c, z.x1 + 1, z.y1 + 1);
  assert.equal(ok, false);
  assert.ok(c.rejected.some(x => /ロビー/.test(x || '')), c.rejected.join());
  c.s.emit('reaction', '🌸'); c.s.emit('reaction', '🎉');
  await sleep(150);
  const kinds = U.mama2.c.events.filter(e => e.ev === 'reaction' && e.d.id === U.mama.id).map(e => e.d.kind);
  assert.deepEqual(kinds, ['🌸']);
});

test('毎日5問：1問正解で1ポイント・同じ問題は2回答えられない', async () => {
  const qr = await http('GET', '/api/parent/quiz', null, U.mama.cookie);
  assert.equal(qr.status, 200, JSON.stringify(qr.data));
  const q = qr.data;
  assert.equal(q.questions.length, 5);
  assert.ok(P.SUBJECTS.includes(q.subject));
  const D = require('../server/db.js').db;
  const pool = [...D.prepare('SELECT question, answer FROM parent_questions').all(), ...D.prepare('SELECT word, answer FROM quiz_questions').all().map(r => ({ question: `「${r.word}」の読み方は？`, answer: r.answer }))];
  const ansOf = (qq) => { const f = pool.find(x => x.question === qq.question); return f ? f.answer : null; };
  let got = 0;
  for (const [i, qq] of q.questions.entries()) {
    const right = ansOf(qq);
    const choice = i < 3 && right ? right : qq.choices.find(c => c !== right);
    const r = await http('POST', '/api/parent/quiz/answer', { qid: qq.qid, choice }, U.mama.cookie);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    if (r.data.correct) got++;
  }
  const pts = (await http('GET', '/api/me/ganbari', null, U.mama.cookie)).data;
  assert.equal(pts.points.balance, got);
  const dup = await http('POST', '/api/parent/quiz/answer', { qid: q.questions[0].qid, choice: q.questions[0].choices[0] }, U.mama.cookie);
  assert.equal(dup.status, 400);
});

test('見たよスタンプ：わが子にだけ・1日1回・花が咲く・子どもが次に入ったとき1回だけ', async () => {
  const before = (await http('GET', '/api/parent/home', null, U.mama.cookie)).data;
  assert.equal(before.children.length, 1);
  assert.equal(before.children[0].id, U.kid.id);
  assert.ok(before.moms.families >= 2);
  const stamp = before.stamps[0];
  assert.equal((await http('POST', '/api/parent/cheer', { studentId: U.other.id, stamp }, U.mama.cookie)).status, 400);
  const r = await http('POST', '/api/parent/cheer', { studentId: U.kid.id, stamp }, U.mama.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.data.moms.flowers, before.moms.flowers + 1);
  assert.equal((await http('POST', '/api/parent/cheer', { studentId: U.kid.id, stamp }, U.mama.cookie)).status, 400);
  // 子どもがつながり直すと1回だけ届く
  U.kid.c.s.disconnect(); await sleep(400);
  const k2 = await connect(U.kid.cookie); await sleep(150);
  const cheer = k2.events.find(e => e.ev === 'cheer');
  assert.deepEqual(cheer.d.stamps, [stamp]);
  k2.s.disconnect(); await sleep(400);
  const k3 = await connect(U.kid.cookie); await sleep(150);
  assert.ok(!k3.events.some(e => e.ev === 'cheer'));
  // 森のデータ：母達の木・保護者からはほかの子の目標名は出ない
  const f = (await http('GET', '/api/forest', null, U.mama.cookie)).data;
  assert.equal(f.moms.flowers, before.moms.flowers + 1);
});

test('オーナーは今日来た保護者がわかる（オーナーだけ）', async () => {
  const r = await http('GET', '/api/admin/parents/today', null, owner);
  assert.equal(r.status, 200);
  const names = r.data.visits.map(v => v.name);
  assert.ok(names.includes('キッドの母') && names.includes('アザーの母'), names.join());
  assert.deepEqual(r.data.visits.find(v => v.name === 'キッドの母').children, ['kidくん']);
  assert.equal(r.data.meeting, false);
  assert.equal((await http('GET', '/api/admin/parents/today', null, U.kid.cookie)).status, 403);
});

test('10分（テストでは1.5秒）で自動退室・その日はもう入れない・🔥は毎日来たら数える', async () => {
  await sleep(4000); // 5秒ごとの見回りで退室
  assert.ok(U.mama.c.events.some(e => e.ev === 'kicked'), U.mama.c.events.map(e => e.ev).join());
  const again = await connect(U.mama.cookie);
  assert.ok(again.events.some(e => e.ev === 'visit-over'));
  assert.equal(again.init, null);
  // 🔥：昨日と今日に来ていれば2日
  const G = require('../server/ganbari.js');
  require('../server/db.js').db.prepare('INSERT INTO parent_visits (user_id, day, started_at) VALUES (?, ?, ?)').run(U.mama.id, G.addDays(G.jst().day, -1), Date.now() - 86400000);
  assert.equal(P.visitStreak(U.mama.id), 2);
});

test('保護者会：オンの日は中学生と同じルールで教室へ・時間制限なし・オフで退室', async () => {
  const z = SM.ZONES.find(v => v.id === 'study');
  assert.equal((await http('POST', '/api/admin/parent-meeting', { on: true }, U.kid.cookie)).status, 403);
  assert.equal((await http('POST', '/api/admin/parent-meeting', { on: true }, owner)).status, 200);
  // 10分をすぎた日でも、保護者会の日は入れる
  const c = await connect(U.mama2.cookie);
  assert.ok(c.init && c.init.visit.meeting, c.events.map(e => e.ev).join());
  const ok = await walk(c, z.x1 + 1, z.y1 + 1);
  assert.ok(ok, c.rejected.join());
  // 高校生自習室は中学生と同じで入れない
  const P2 = require('../server/permissions.js');
  assert.equal(P2.canEnterRoom({ role: 'parent' }, { id: 'class3', type: 'study' }), false);
  assert.equal(P2.canEnterRoom({ role: 'parent' }, { id: 'class1', type: 'study' }), true);
  assert.equal(P2.canEnterRoom({ role: 'parent' }, { id: 'class2', type: 'classroom' }), true);
  // 自習室では、先生がいないとスタンプは出せない（生徒と同じ）
  const before = U.other.c.events.filter(e => e.ev === 'reaction').length;
  c.s.emit('reaction', '👋'); await sleep(150);
  assert.equal(U.other.c.events.filter(e => e.ev === 'reaction').length, before);
  await sleep(2500); // 1.5秒をすぎても退室しない
  assert.ok(!c.events.some(e => e.ev === 'kicked'));
  assert.equal((await http('POST', '/api/admin/parent-meeting', { on: false }, owner)).status, 200);
  await sleep(200);
  const k = c.events.find(e => e.ev === 'kicked');
  assert.match(k.d.reason, /保護者会/);
});

