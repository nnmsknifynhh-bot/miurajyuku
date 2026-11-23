// オーナーの見回り：オーナーがいないとき、生徒・保護者の画面だけに「面談ブースにいて、30分おきにろうかの端まで往復する」姿を見せる
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');
const app = require('../server/server.js');
const realtime = require('../server/realtime.js');

let base, server; const sockets = [];
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
    sockets.push(s); const c = { s, init: null, events: [] };
    s.onAny((ev, d) => c.events.push({ ev, d }));
    s.on('init', (d) => { c.init = d; resolve(c); }); s.on('connect_error', reject);
  });
}

test('オーナーがいないとき、生徒には見回りの姿が見える（先生には見えない）。オーナーが来たら本物になる', async () => {
  const owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  assert.equal((await http('PATCH', '/api/admin/settings', { ownerPatrol: true }, owner)).data.ownerPatrol, true);
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'stu', displayName: 'すう', grade: '中1', password: 'password123' }, owner);
  await http('POST', '/api/admin/users', { role: 'teacher', loginId: 'tch', displayName: '山田', password: 'password123' }, owner);
  const sc = (await http('POST', '/api/login', { loginId: 'stu', password: 'password123' })).cookie;
  const tc = (await http('POST', '/api/login', { loginId: 'tch', password: 'password123' })).cookie;
  const st = await connect(sc), te = await connect(tc);
  const bot = st.init.users.find(u => u.role === 'owner');
  assert.ok(bot && bot.bot && bot.name === '三浦', '生徒には見える');
  assert.ok(!te.init.users.some(u => u.role === 'owner'), '先生には見えない');
  // オーナーが入ると、本物の姿にかわる
  const oc = await connect(owner);
  await sleep(400);
  const joined = st.events.filter(e => e.ev === 'user-joined' && e.d.role === 'owner').pop();
  assert.ok(joined && !joined.d.bot, '本物のオーナー');
  oc.s.disconnect(); await sleep(700);
  const back = st.events.filter(e => e.ev === 'user-joined' && e.d.role === 'owner').pop();
  assert.ok(back.d.bot, 'オーナーが出たら、また見回りの姿');
  // オフにすると消える
  await http('PATCH', '/api/admin/settings', { ownerPatrol: false }, owner); await sleep(400);
  assert.ok(st.events.some(e => e.ev === 'user-left' && e.d.id === bot.id));
});

test('見回りの時刻：毎時0分・30分に面談ブースを出て、ろうかの端まで往復し、面談ブースにもどる', () => {
  const at = (hm, sec = 0) => new Date(`2026-11-23T${hm}:${String(sec).padStart(2, '0')}+09:00`).getTime();
  const zoneOf = (p) => (SM.zoneAtPx(p.x, p.y) || {}).id;
  assert.equal(zoneOf(realtime._patrolPos(at('10:20'))), 'mendan', 'ふだんは面談ブース');
  assert.equal(realtime._patrolPos(at('10:20')).moving, false);
  assert.equal(realtime._patrolPos(at('10:30', 5)).moving, true, '30分に出発');
  let farthest = 0;
  for (let s = 0; s < 120; s++) { const p = realtime._patrolPos(at('10:00') + s * 1000); if (zoneOf(p) === 'hall') farthest = Math.max(farthest, Math.abs(p.x - SM.tileCenter(37, 29).x)); }
  assert.ok(farthest > SM.TILE * 20, 'ろうかの端のほうまで行く');
  assert.equal(zoneOf(realtime._patrolPos(at('10:05'))), 'mendan', 'もどってくる');
});
