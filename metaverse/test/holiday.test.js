// 祝日・長い休みは土曜日と同じ数え方（中・高・小それぞれ）／左上のポイント表示
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const H = require('../server/holidays.js');
const app = require('../server/server.js');
const G = require('../server/ganbari.js');

let base, server; const sockets = [];
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { sockets.forEach(s => s.disconnect()); server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}

test('日本の祝日：振替休日・国民の休日もわかる', () => {
  for (const d of ['2026-01-01', '2026-01-12', '2026-03-20', '2026-05-06', '2026-09-21', '2026-09-22', '2026-09-23', '2026-11-23', '2025-11-24', '2027-03-21', '2027-03-22']) assert.ok(H.isHoliday(d), d);
  for (const d of ['2026-11-24', '2026-05-07', '2026-12-25']) assert.ok(!H.isHoliday(d), d);
});

test('祝日・長い休みの平日は土曜日の数え方になる（学年グループごとにオフにできる）', async () => {
  const owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const wk = Array.from({ length: 7 }, () => ({ on: true, start: '19:00', end: '23:00', cap: 240 }));
  wk[6] = { on: true, start: '00:00', end: '24:00', cap: 900 };
  const r = await http('PATCH', '/api/admin/ganbari/config', { weekly: wk, vacations: [{ name: '冬休み', start: '2026-12-24', end: '2027-01-07' }], hs: { weekly: wk, holidaySat: false }, es: { weekly: wk, vacationSat: false } }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(G.ruleFor('2026-11-23').cap, 900, '祝日（月）は土曜と同じ');
  assert.match(G.ruleFor('2026-11-23').weekday, /祝日/);
  assert.equal(G.ruleFor('2026-11-24').cap, 240, 'ふつうの火曜');
  assert.equal(G.ruleFor('2026-12-25').cap, 900, '冬休みの金曜は土曜と同じ');
  assert.equal(G.ruleFor('2026-11-23', G.getConfig(), 'hs').cap, 240, '高校生は祝日をオフにした');
  assert.equal(G.ruleFor('2026-12-25', G.getConfig(), 'hs').cap, 900, '高校生も冬休みは土曜');
  assert.equal(G.ruleFor('2026-12-25', G.getConfig(), 'es').cap, 240, '小学生は長い休みをオフにした');
  assert.equal(G.ruleFor('2026-11-23', G.getConfig(), 'es').cap, 900, '小学生も祝日は土曜');
  assert.equal((await http('PATCH', '/api/admin/ganbari/config', { vacations: [{ name: 'x', start: '2026-12-30', end: '2026-12-01' }] }, owner)).status, 400);
});

test('左上のポイント表示：入室したとき今のポイントが届く（先生には届かない）', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'stu', displayName: 'すう', grade: '高1', password: 'password123' }, owner);
  const sc = (await http('POST', '/api/login', { loginId: 'stu', password: 'password123' })).cookie;
  const connect = (cookie) => new Promise((resolve, reject) => { const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true }); sockets.push(s); s.on('init', (d) => resolve(d)); s.on('connect_error', reject); });
  const d = await connect(sc);
  assert.deepEqual(d.me.pts, { balance: 0, medal: null });
  const o = await connect(owner);
  assert.equal(o.me.pts, null);
});
