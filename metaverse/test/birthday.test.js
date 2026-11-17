// 誕生日：登録（月・日だけ）・お祝いカードとプレゼント（1日1回）・🎂の見せ方（みんな／先生だけ）・学年の木・先生へのお知らせ
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const app = require('../server/server.js');
const G = require('../server/ganbari.js');

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
    const c = { s, me: null, init: null, events: [] };
    s.onAny((ev, d) => c.events.push({ ev, d }));
    s.on('init', (d) => { c.me = d.me; c.init = d; resolve(c); });
    s.on('connect_error', reject);
  });
}
const today = () => G.jst().day.slice(5);
const notToday = () => (today() === '01-01' ? '01-02' : '01-01');

let owner; const U = {};
test('準備：誕生日の登録は月・日だけ。おかしな日付は受けつけない', async () => {
  owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const add = async (k, body) => {
    const r = await http('POST', '/api/admin/users', { password: 'password123', ...body, loginId: k, displayName: k }, owner);
    assert.equal(r.status, 201, k);
    U[k] = { id: r.data.user.id, user: r.data.user, cookie: (await http('POST', '/api/login', { loginId: k, password: 'password123' })).cookie };
  };
  await add('pub', { role: 'student', grade: '小5', birthday: today() });                         // 今日が誕生日・みんなに見せる
  await add('priv', { role: 'student', grade: '小5', birthday: today(), birthdayPublic: false });  // 今日が誕生日・先生だけ
  await add('other', { role: 'student', grade: '小5', birthday: notToday() });
  await add('tch', { role: 'teacher', rooms: ['class1'] });
  assert.equal(U.pub.user.birthday, today());
  assert.equal(U.priv.user.birthdayPublic, false);
  assert.equal((await http('POST', '/api/admin/users', { password: 'password123', role: 'student', loginId: 'bad1', displayName: 'bad1', birthday: '02-30' }, owner)).status, 400);
  assert.equal((await http('PATCH', `/api/admin/users/${U.tch.id}`, { birthday: '04-01' }, owner)).status, 400, '先生には登録しない');
  assert.equal((await http('PATCH', `/api/admin/users/${U.other.id}`, { birthday: notToday() }, U.tch.cookie)).status, 403, 'オーナーだけ');
});

test('先生が先に入っていると、誕生日の生徒の入室で「今日は誕生日」と届く', async () => {
  U.tch.c = await connect(U.tch.cookie);
  U.other.c = await connect(U.other.cookie);
  U.pub.c = await connect(U.pub.cookie);
  await sleep(150);
  const arrived = U.tch.c.events.filter(e => e.ev === 'student-arrived');
  assert.equal(arrived.find(e => e.d.name === 'pub').d.birthday, true);
  assert.equal(arrived.find(e => e.d.name === 'other').d.birthday, false);
});

test('誕生日に入るとお祝いカードとプレゼントが届く（その日は1回だけ）', async () => {
  const card = U.pub.c.events.find(e => e.ev === 'birthday');
  assert.ok(card, 'カードが届く');
  assert.equal(card.d.gift, true);
  assert.ok(G.owned(U.pub.id).includes('bday_cake'));
  assert.equal(U.pub.c.me.bday, true);
  U.pub.c.s.disconnect(); await sleep(100);
  U.pub.c = await connect(U.pub.cookie); await sleep(100);
  assert.ok(!U.pub.c.events.some(e => e.ev === 'birthday'), '2回目は出ない');
});

test('プレゼントのアイテムはお店では買えず、もらった人にだけ見える', async () => {
  assert.ok(G.shopFor(U.pub.id).some(i => i.id === 'bday_cake'));
  assert.ok(!G.shopFor(U.other.id).some(i => i.id === 'bday_cake'));
  assert.match(G.buy(U.other.id, 'bday_cake'), /買えません/);
});

test('🎂：「みんなに見せる」はほかの生徒にも、「先生だけ」は先生と本人にだけ見える', async () => {
  U.priv.c = await connect(U.priv.cookie);
  await sleep(150);
  assert.equal(U.priv.c.me.bday, true, '本人には見える');
  const seenByOther = U.other.c.events.find(e => e.ev === 'user-joined' && e.d.id === U.priv.id);
  assert.equal(seenByOther.d.bday, false, 'ほかの生徒には見えない');
  assert.ok(!U.other.c.events.some(e => e.ev === 'user-updated' && e.d.id === U.priv.id && e.d.bday), 'あとからも届かない');
  assert.ok(U.tch.c.events.some(e => e.ev === 'user-updated' && e.d.id === U.priv.id && e.d.bday === true), '先生には届く');
  const pubSeen = U.other.c.events.filter(e => e.ev === 'user-joined' && e.d.id === U.pub.id).pop();
  assert.equal(pubSeen.d.bday, true);
});

test('学年の木：みんなに見せる誕生日の生徒がいる木にケーキ', () => {
  G.setConfig({ trees: [{ name: '小5の木', grades: ['小5'] }, { name: '中2の木', grades: ['中2'] }, { name: '中3の木', grades: ['中3'] }, { name: '高校生の木', grades: ['高1', '高2', '高3'] }] });
  const f = G.forest();
  assert.equal(f.trees[0].birthday, true);
  assert.equal(f.trees[1].birthday, false);
});

test('2/29生まれは、うるう年でない年は2/28に祝う', () => {
  const id = U.other.id;
  require('../server/db.js').db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run('02-29', id);
  assert.ok(G.birthdayInfo(id, new Date('2027-02-28T12:00:00+09:00')));
  assert.equal(G.birthdayInfo(id, new Date('2028-02-28T12:00:00+09:00')), null);
  assert.ok(G.birthdayInfo(id, new Date('2028-02-29T12:00:00+09:00')));
});

test('お祝いカードのひとことはオーナーが変えられる', async () => {
  assert.equal((await http('PATCH', '/api/admin/ganbari/config', { birthdayMessage: 'おめでとう！' }, owner)).status, 200);
  assert.equal(G.getConfig().birthdayMessage, 'おめでとう！');
  assert.equal((await http('PATCH', '/api/admin/ganbari/config', { birthdayMessage: '' }, owner)).status, 400);
});
