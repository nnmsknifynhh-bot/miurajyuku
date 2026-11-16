// 自習室の見守り写真テスト：権限・同意（オン/オフ）・ずる対策・自習室を出たら消える
process.env.DB_PATH = ':memory:';
process.env.STUDY_PHOTO_MIN_INTERVAL_MS = '300';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');

const T = SM.TILE;
let base, server;
const sockets = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { sockets.forEach(s => s.disconnect()); server.close(); setTimeout(() => process.exit(0), 200).unref(); });

async function http(method, path, body, cookie, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': isBuf ? 'image/jpeg' : 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: method === 'GET' ? undefined : (isBuf ? body : JSON.stringify(body || {})),
  });
  const sc = res.headers.get('set-cookie');
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('json')) data = await res.json(); else if (res.ok) data = Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
const jpeg = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(n)]);
const up = (cookie, buf, meta = {}) => http('POST', '/api/study/photo', buf, cookie, {
  ...(meta.b !== undefined ? { 'X-Photo-Brightness': String(meta.b) } : {}), ...(meta.fp ? { 'X-Photo-Fp': meta.fp } : {}), ...(meta.reason ? { 'X-Photo-Reason': meta.reason } : {}),
});
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
    c.s.emit('move', { x: p.x, y: p.y, dir: 'up' }); await sleep(25); c.me.x = p.x; c.me.y = p.y;
  }
  await sleep(80);
}
const ask = (c, ev, d) => new Promise(r => c.s.emit(ev, d, r));

let owner; const U = {};
test('準備', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (k, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: k, displayName: k }, owner);
    assert.equal(r.status, 201);
    U[k] = { id: r.data.user.id, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  };
  await add('stu1', { role: 'student' }); await add('stu2', { role: 'student' });
  await add('tch1', { role: 'teacher', rooms: ['class1'] });
  await add('tch2', { role: 'teacher', rooms: ['class1'], permissions: { enter_classroom: true, handle_students: false } });
  for (const k of Object.keys(U)) U[k].c = await connect(U[k].cookie);
});

test('最初はオフ。オフのときは写真を送れない。設定を変えられるのはオーナーだけ', async () => {
  await walk(U.stu1.c, 10, 23);
  assert.equal((await up(U.stu1.cookie, jpeg())).status, 400);
  assert.equal((await http('PATCH', '/api/admin/settings', { studyPhotos: true }, U.tch1.cookie)).status, 403);
  assert.equal((await http('PATCH', '/api/admin/settings', { studyPhotos: true }, owner)).data.studyPhotos, true);
  await sleep(50);
  assert.ok(U.stu1.c.events.some(e => e.ev === 'features' && e.d.studyPhotos === true));
});

test('自習室にいる生徒だけが送れる（教室・先生は不可）。JPEG 以外・大きすぎる写真は拒否', async () => {
  await walk(U.stu2.c, 5, 6); // 教室1
  assert.equal((await up(U.stu2.cookie, jpeg())).status, 400);
  assert.equal((await up(U.tch1.cookie, jpeg())).status, 400);
  assert.equal((await up(U.stu1.cookie, Buffer.from('not a jpeg at all, just text...'.repeat(10)))).status, 400);
  assert.equal((await http('POST', '/api/study/photo', jpeg(), U.stu1.cookie, { 'Content-Type': 'image/png' })).status, 415);
  assert.equal((await up(U.stu1.cookie, jpeg(400_000))).status, 413);
  const ok = await up(U.stu1.cookie, jpeg(), { b: 120, fp: '0f0f0f0f0f0f0f0f' });
  assert.equal(ok.status, 200);
});

test('見られるのはオーナーと「生徒への個別対応」の権限がある先生だけ', async () => {
  assert.equal((await http('GET', `/api/study/photo/${U.stu1.id}`, null, owner)).status, 200);
  assert.equal((await http('GET', `/api/study/photo/${U.stu1.id}`, null, U.tch1.cookie)).status, 200);
  assert.equal((await http('GET', `/api/study/photo/${U.stu1.id}`, null, U.tch2.cookie)).status, 403);
  assert.equal((await http('GET', `/api/study/photo/${U.stu1.id}`, null, U.stu2.cookie)).status, 403);
  assert.equal((await http('GET', '/api/study/photos', null, U.stu2.cookie)).status, 403);
});

test('ずる対策：送信間隔が短すぎる・前とまったく同じ写真ファイルは拒否', async () => {
  assert.equal((await up(U.stu1.cookie, jpeg())).status, 400, '間隔が短い');
  await sleep(350);
  const same = jpeg();
  assert.equal((await up(U.stu1.cookie, same, { fp: '0f0f0f0f0f0f0f0f' })).status, 200);
  await sleep(350);
  const r = await up(U.stu1.cookie, same);
  assert.equal(r.status, 400); assert.match(r.data.error, /同じ写真/);
});

test('ずる対策：真っ暗な写真・30分以上ほとんど動きがない写真には印がつく', async () => {
  for (let i = 0; i < 2; i++) { await sleep(350); assert.equal((await up(U.stu1.cookie, jpeg(), { b: 10, fp: '0f0f0f0f0f0f0f0e' })).status, 200); }
  const meta = (await http('GET', '/api/study/photos', null, U.tch1.cookie)).data.times[U.stu1.id];
  assert.equal(meta.dark, true);
  assert.ok(meta.still >= 3, `動きなしの回数: ${meta.still}`);
  await sleep(350);
  assert.equal((await up(U.stu1.cookie, jpeg(), { b: 130, fp: 'f0f0f0f0f0f0f0f0' })).status, 200);
  const meta2 = (await http('GET', '/api/study/photos', null, U.tch1.cookie)).data.times[U.stu1.id];
  assert.equal(meta2.dark, false); assert.equal(meta2.still, 0);
});

test('ずる対策：先生の「今すぐ撮る」は生徒の端末に届く（権限のない先生は不可）', async () => {
  U.stu1.c.s.emit('study-camera', { on: true }); await sleep(80);
  assert.equal((await ask(U.tch2.c, 'study-photo-request', { studentId: U.stu1.id })).ok, false);
  assert.equal((await ask(U.tch1.c, 'study-photo-request', { studentId: U.stu1.id })).ok, true);
  await sleep(80);
  assert.ok(U.stu1.c.events.some(e => e.ev === 'take-photo'));
  await sleep(1000); // 実際の端末でも、撮影〜送信には1秒ほどかかる
  const r = await up(U.stu1.cookie, jpeg(), { reason: 'request' });
  assert.equal(r.status, 200, '今すぐ撮影は通常の間隔制限なし: ' + JSON.stringify(r.data));
  assert.equal((await http('GET', '/api/study/photos', null, U.tch1.cookie)).data.times[U.stu1.id].reason, 'request');
  assert.equal((await ask(U.tch1.c, 'study-photo-request', { studentId: U.stu1.id })).ok, false, '30秒に1回まで');
});

test('「今すぐ撮る」の結果（届いた／撮れなかった）が先生に知らされる', async () => {
  await sleep(31000 - 0); // 30秒の連打制限が明けるのを待つ
  assert.equal((await ask(U.tch1.c, 'study-photo-request', { studentId: U.stu1.id })).ok, true);
  await sleep(1100);
  assert.equal((await up(U.stu1.cookie, jpeg(), { reason: 'request' })).status, 200);
  await sleep(80);
  const okEv = [...U.tch1.c.events].reverse().find(e => e.ev === 'study-photo-result');
  assert.equal(okEv.d.ok, true);
});

test('生徒の通信が切れて再接続しても、カメラがオンなら「今すぐ撮る」が使える', async () => {
  U.stu1.c.s.disconnect();
  await sleep(150);
  U.stu1.c = await connect(U.stu1.cookie);         // 自習室に戻る（元の場所）
  U.stu1.c.s.emit('study-camera', { on: true });    // 画面側が再接続時に送り直す
  await sleep(100);
  assert.ok(U.tch1.c.events.some(e => e.ev === 'user-updated' && e.d.id === U.stu1.id && e.d.studyCam === true));
});

test('離席（アプリを閉じた・別の画面）は先生にも伝わる', async () => {
  U.stu1.c.s.emit('away', { away: 'hidden' }); await sleep(80);
  assert.ok(U.tch1.c.events.some(e => e.ev === 'user-updated' && e.d.id === U.stu1.id && e.d.away === 'hidden'));
  U.stu1.c.s.emit('away', { away: null }); await sleep(80);
  assert.ok(U.tch1.c.events.some(e => e.ev === 'user-updated' && e.d.id === U.stu1.id && e.d.away === null));
});

test('自習室を出ると写真は消える。設定をオフにしても消える', async () => {
  await walk(U.stu1.c, 16, 17); // ろうか
  assert.equal((await http('GET', `/api/study/photo/${U.stu1.id}`, null, owner)).status, 404);
  assert.ok(U.tch1.c.events.some(e => e.ev === 'study-photo' && e.d.id === U.stu1.id && e.d.at === null));
  await walk(U.stu1.c, 10, 23);
  await sleep(350);
  assert.equal((await up(U.stu1.cookie, jpeg())).status, 200);
  await http('PATCH', '/api/admin/settings', { studyPhotos: false }, owner);
  assert.equal((await http('GET', `/api/study/photo/${U.stu1.id}`, null, owner)).status, 404);
});
