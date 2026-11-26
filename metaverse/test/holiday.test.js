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

test('高3は高1・高2とは別の数え方にできる（オフなら高校生と同じ）', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/ganbari/config', { hs: { weekly: null, window: { start: '16:00', end: '23:00' }, window2: null, dailyCap: 360 } }, owner);
  const day = '2026-11-25';
  assert.equal(G.groupOf('高3'), 'hs3');
  assert.deepEqual(G.ruleFor(day, G.getConfig(), 'hs3').windows, [{ start: '16:00', end: '23:00' }], 'オフのときは高校生と同じ');
  const r = await http('PATCH', '/api/admin/ganbari/config', { hs3: { separate: true, window: { start: '08:00', end: '23:00' }, window2: null, dailyCap: 600 } }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(G.ruleFor(day, G.getConfig(), 'hs3').windows, [{ start: '08:00', end: '23:00' }]);
  assert.equal(G.ruleFor(day, G.getConfig(), 'hs3').cap, 600);
  assert.deepEqual(G.ruleFor(day, G.getConfig(), 'hs').windows, [{ start: '16:00', end: '23:00' }], '高1・高2はそのまま');
});

test('祝日は、休んでも🔥がとぎれない（勉強した祝日は1日に数える）', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  const r = await http('POST', '/api/admin/users', { role: 'student', loginId: 'fire', displayName: 'ひ', grade: '中1', password: 'password123' }, owner);
  const id = r.data.user.id;
  const { db } = require('../server/db.js');
  const put = (day, m) => db.prepare('INSERT INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, day) DO UPDATE SET auto_min = excluded.auto_min, all_min = excluded.all_min').run(id, day, m, m);
  put('2026-11-21', 69); put('2026-11-22', 45); // 23日（勤労感謝の日）は0分
  assert.equal(G.streak(id, new Date('2026-11-24T12:00:00+09:00')), 2);
  put('2026-11-23', 50);
  assert.equal(G.streak(id, new Date('2026-11-24T12:00:00+09:00')), 3, '祝日に勉強すれば1日ふえる');
  assert.equal(G.streak(id, new Date('2026-11-21T23:00:00+09:00')), 1);
});

test('VIP席の子（🔥30以上）は、1日休んでも次の日にまた来れば🔥20から。2日休んだら0から', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  const id = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'vip', displayName: 'v', grade: '中1', password: 'password123' }, owner)).data.user.id;
  const { db } = require('../server/db.js');
  const put = (day) => db.prepare('INSERT INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, 60, 60) ON CONFLICT (user_id, day) DO UPDATE SET all_min = 60').run(id, day);
  const day = (n) => G.addDays('2027-03-01', n);
  for (let i = 0; i < 35; i++) put(day(i)); // 3/1〜4/4 の35日
  const at = (n, h = 20) => new Date(`${day(n)}T${String(h).padStart(2, '0')}:00:00+09:00`);
  const holi = (n) => require('../server/holidays.js').isHoliday(day(n));
  assert.ok(G.streak(id, at(34)) >= 35);
  // 35日目（4/5）を休む → 36日目（4/6）に来ると🔥20
  assert.ok(!holi(35) && !holi(36) && !holi(37), 'テストの日が祝日でない');
  put(day(36));
  assert.equal(G.streak(id, at(36)), 20, '次の日に来れば🔥20');
  put(day(37));
  assert.equal(G.streak(id, at(37)), 21);
  // 2日休む → 0から
  const id2 = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'vip2', displayName: 'v2', grade: '中1', password: 'password123' }, owner)).data.user.id;
  const put2 = (d) => db.prepare('INSERT INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, 60, 60)').run(id2, d);
  for (let i = 0; i < 35; i++) put2(day(i));
  put2(day(37));
  assert.equal(G.streak(id2, at(37)), 1, '2日休んだら0から');
  // 🔥30未満の子は今までどおり0から
  const id3 = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'vip3', displayName: 'v3', grade: '中1', password: 'password123' }, owner)).data.user.id;
  const put3 = (d) => db.prepare('INSERT INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, 60, 60)').run(id3, d);
  for (let i = 10; i < 35; i++) put3(day(i));
  put3(day(36));
  assert.equal(G.streak(id3, at(36)), 1);
});
