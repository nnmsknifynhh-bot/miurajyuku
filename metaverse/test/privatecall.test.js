// 第4段階 個別通話テスト：呼び出せる人・参加確認・授業音声との切り替え・トークン・終了
process.env.DB_PATH = ':memory:';
process.env.LIVEKIT_URL = 'wss://test-project.livekit.cloud';
process.env.LIVEKIT_API_KEY = 'APItestkey';
process.env.LIVEKIT_API_SECRET = 'testsecret-testsecret-testsecret-0123456789';
process.env.PRIVATE_RING_MS = '700';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');
const livekit = require('../server/livekit.js');

const T = SM.TILE;
const calls = [];
livekit._setService({
  removeParticipant: async (room, identity) => { calls.push(['remove', room, identity]); },
  deleteRoom: async (room) => { calls.push(['delete', room]); },
});

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
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    sockets.push(s);
    const c = { s, events: [], me: null, classes: {}, rejected: [] };
    s.onAny((ev, data) => c.events.push({ ev, data }));
    s.on('init', (d) => { c.me = d.me; c.classes = d.classes; resolve(c); });
    s.on('class-state', (d) => { c.classes = d; });
    s.on('move-rejected', (d) => { c.rejected.push(d.reason); c.me.x = d.x; c.me.y = d.y; });
    s.on('connect_error', reject);
  });
}
async function walk(c, tx, ty) {
  const path = SM.findPath(Math.floor(c.me.x / T), Math.floor(c.me.y / T), tx, ty);
  const before = c.rejected.length;
  for (const step of path) {
    const p = SM.tileCenter(step.x, step.y);
    c.s.emit('move', { x: p.x, y: p.y, dir: 'up' });
    await sleep(25);
    if (c.rejected.length > before) return false;
    c.me.x = p.x; c.me.y = p.y;
  }
  await sleep(60);
  return true;
}
const ask = (c, ev, data = {}) => new Promise(r => c.s.emit(ev, data, r));
const jwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url'));
const last = (c, ev) => [...c.events].reverse().find(e => e.ev === ev);
const count = (c, ev) => c.events.filter(e => e.ev === ev).length;

let owner;
const U = {};
test('準備：先生（教室1・教室2）、個別通話の権限がない先生、生徒3人', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (key, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: key, displayName: key }, owner);
    assert.equal(r.status, 201, key);
    U[key] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: key, password: 'password123' })).cookie };
  };
  await add('tch1', { role: 'teacher', rooms: ['class1'] });
  await add('tch2', { role: 'teacher', rooms: ['class2'] });
  await add('tch4', { role: 'teacher', rooms: ['class1'], permissions: { enter_classroom: true, start_class_call: true, start_private_call: false, share_screen: true, handle_students: true } });
  for (const k of ['stu1', 'stu2', 'stu3']) await add(k, { role: 'student' });
  for (const k of Object.keys(U)) U[k].c = await connect(U[k].cookie);
  assert.equal(await walk(U.tch1.c, 8, 1), true);
  assert.equal(await walk(U.tch2.c, 25, 1), true);
  assert.equal(await walk(U.tch4.c, 9, 1), true);
  assert.equal(await walk(U.stu1.c, 2, 6), true);
  assert.equal(await walk(U.stu2.c, 5, 6), true);
  assert.equal(await walk(U.stu3.c, 10, 23), true); // 自習室
});

test('生徒は個別通話を始められない（ほかの生徒も先生も呼べない）', async () => {
  const r1 = await ask(U.stu1.c, 'pc-invite', { studentId: U.stu2.id });
  assert.equal(r1.ok, false); assert.match(r1.error, /権限/);
  const r2 = await ask(U.stu1.c, 'pc-invite', { studentId: U.tch1.id });
  assert.equal(r2.ok, false);
  assert.equal(count(U.stu2.c, 'pc-incoming'), 0);
});

test('個別通話の権限がない先生は呼び出せない', async () => {
  const r = await ask(U.tch4.c, 'pc-invite', { studentId: U.stu1.id });
  assert.equal(r.ok, false); assert.match(r.error, /権限/);
});

test('担当外の教室にいる生徒は呼び出せない（自習室の生徒は呼び出せる）', async () => {
  const r = await ask(U.tch2.c, 'pc-invite', { studentId: U.stu1.id });
  assert.equal(r.ok, false); assert.match(r.error, /担当の教室か自習室/);
  const ok = await ask(U.tch2.c, 'pc-invite', { studentId: U.stu3.id });
  assert.equal(ok.ok, true);
  await ask(U.tch2.c, 'pc-end', { callId: ok.callId });
  await sleep(50);
  assert.match(last(U.stu3.c, 'pc-ended').data.reason, /取り消し/);
});

let callId;
test('先生が呼び出すと、その生徒だけに参加確認が届く', async () => {
  assert.equal((await ask(U.tch1.c, 'class-start')).ok, true);
  U.stu1.c.s.emit('hand', { raised: true }, () => {});
  await sleep(50);
  const r = await ask(U.tch1.c, 'pc-invite', { studentId: U.stu1.id });
  assert.equal(r.ok, true);
  callId = r.callId;
  await sleep(80);
  assert.equal(last(U.stu1.c, 'pc-incoming').data.teacherName, 'tch1');
  assert.equal(count(U.stu2.c, 'pc-incoming'), 0);
  // 呼び出し中の生徒は、ほかの先生からは呼べない
  const ownerSock = await connect(owner);
  const busy = await ask(ownerSock, 'pc-invite', { studentId: U.stu1.id });
  assert.equal(busy.ok, false); assert.match(busy.error, /ほかの先生/);
  ownerSock.s.disconnect();
});

test('生徒が参加すると通話開始：2人は授業の通話から外れ、授業側には「個別指導中」と伝わる', async () => {
  calls.length = 0;
  const r = await ask(U.stu1.c, 'pc-respond', { callId, accept: true });
  assert.equal(r.ok, true);
  await sleep(100);
  assert.equal(last(U.tch1.c, 'pc-started').data.role, 'teacher');
  assert.equal(last(U.stu1.c, 'pc-started').data.role, 'student');
  assert.ok(calls.some(c => c[0] === 'remove' && c[1] === 'miura-class-class1' && c[2] === `u-${U.tch1.id}`));
  assert.ok(calls.some(c => c[0] === 'remove' && c[1] === 'miura-class-class1' && c[2] === `u-${U.stu1.id}`));
  assert.equal(U.stu2.c.classes.class1.away, true);
  assert.ok(U.stu2.c.events.some(e => e.ev === 'user-updated' && e.data.id === U.stu1.id && e.data.inPrivate === true));
  assert.ok(U.stu2.c.events.some(e => e.ev === 'user-updated' && e.data.id === U.stu1.id && e.data.hand === false), '挙手は自動で取り消し');
});

test('個別通話中の2人には授業の通話トークンが発行されない（音声が混ざらない）', async () => {
  await sleep(1600);
  assert.equal((await ask(U.stu1.c, 'lk-token')).ok, false);
  assert.equal((await ask(U.tch1.c, 'lk-token')).ok, false);
  assert.equal((await ask(U.stu2.c, 'lk-token')).ok, true, 'ほかの生徒は授業に参加したまま');
});

test('個別通話のトークン：別の部屋。先生は声＋画面共有、生徒は声＋カメラ（ノートを見せる）', async () => {
  const t = await ask(U.tch1.c, 'pc-token', { callId });
  assert.equal(t.ok, true);
  const gt = jwt(t.token).video;
  assert.match(gt.room, /^miura-private-[0-9a-f-]{36}$/);
  assert.deepEqual(gt.canPublishSources, ['microphone', 'screen_share', 'screen_share_audio']);
  const s = await ask(U.stu1.c, 'pc-token', { callId });
  const gs = jwt(s.token).video;
  assert.equal(gs.room, gt.room);
  assert.deepEqual(gs.canPublishSources, ['microphone', 'camera']);
  assert.ok(!gs.roomRecord && !gt.roomRecord, '録画権限なし');
  // 関係のない生徒は個別通話の部屋に入れない
  const other = await ask(U.stu2.c, 'pc-token', { callId });
  assert.equal(other.ok, false);
});

test('どちらかが終了すると2人とも通話が終わり、授業に戻れる', async () => {
  calls.length = 0;
  assert.equal((await ask(U.stu1.c, 'pc-end', { callId })).ok, true);
  await sleep(100);
  assert.match(last(U.tch1.c, 'pc-ended').data.reason, /stu1さんが個別通話を終了/);
  assert.ok(calls.some(c => c[0] === 'delete' && /^miura-private-/.test(c[1])));
  assert.equal(U.stu2.c.classes.class1.away, false);
  await sleep(1600);
  assert.equal((await ask(U.stu1.c, 'lk-token')).ok, true, '授業の通話に戻れる');
  assert.equal((await ask(U.stu1.c, 'pc-token', { callId })).ok, false, '終わった通話には入れない');
});

test('生徒が「あとで」を選ぶと、先生に伝わる', async () => {
  const r = await ask(U.tch1.c, 'pc-invite', { studentId: U.stu2.id });
  await sleep(50);
  await ask(U.stu2.c, 'pc-respond', { callId: r.callId, accept: false });
  await sleep(50);
  assert.match(last(U.tch1.c, 'pc-ended').data.reason, /あとで/);
});

test('応答がなければ呼び出しは自動で終わる', async () => {
  await ask(U.tch1.c, 'pc-invite', { studentId: U.stu2.id });
  await sleep(900);
  assert.match(last(U.tch1.c, 'pc-ended').data.reason, /応答しませんでした/);
  assert.match(last(U.stu2.c, 'pc-ended').data.reason, /応答しませんでした/);
});

test('通話中に生徒の接続が切れると、個別通話は終了する', async () => {
  const r = await ask(U.tch1.c, 'pc-invite', { studentId: U.stu2.id });
  await ask(U.stu2.c, 'pc-respond', { callId: r.callId, accept: true });
  U.stu2.c.s.disconnect();
  await sleep(150);
  assert.match(last(U.tch1.c, 'pc-ended').data.reason, /接続が切れた/);
  U.stu2.c = await connect(U.stu2.cookie);
});

test('オーナーは管理画面から個別通話を終了させられる。先生はできない', async () => {
  const r = await ask(U.tch1.c, 'pc-invite', { studentId: U.stu1.id });
  await ask(U.stu1.c, 'pc-respond', { callId: r.callId, accept: true });
  const pres = await http('GET', '/api/admin/presence', null, owner);
  assert.equal(pres.data.users.find(u => u.id === U.stu1.id).privateWith, 'tch1');
  assert.equal((await http('POST', `/api/admin/calls/${U.stu1.id}/end`, {}, U.tch1.cookie)).status, 403);
  assert.equal((await http('POST', `/api/admin/calls/${U.stu1.id}/end`, {}, owner)).status, 200);
  await sleep(80);
  assert.match(last(U.stu1.c, 'pc-ended').data.reason, /管理者/);
});

test('操作ログには通話の開始・終了だけが残る（内容は記録しない）', async () => {
  const r = await http('GET', '/api/admin/logs', null, owner);
  const acts = r.data.logs.map(l => l.action);
  assert.ok(acts.includes('private.started') && acts.includes('private.ended') && acts.includes('private.invited'));
});
