// 英語の音読（練習）：単元の登録（英語の行＋訳の行・話す人の名前は数えない）・制限時間（語数÷学年の1分の語数・5秒で切り上げ）・練習の記録
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/server.js');
const R = require('../server/reading.js');

let base, server;
test.before(async () => { server = app.createServer(); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });
async function http(method, path, body, cookie) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = res.headers.get('set-cookie'); let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}
const TEXT = `Jin: I'm sorry I'm late.
遅れてごめんなさい。
Sho: Don't worry. We've just arrived, too. But Hina hasn't come yet.
気にしないで。ぼくたちもちょうど着いたところだよ。でも、ヒナはまだ来ていないんだ。
Jin: Really? Is she late, too? I'll call her.
本当に？ 彼女も遅れているの？ 電話してみるね。
Jin: Hi, Hina. Where are you now?
もしもし、ヒナ。今どこにいるの？
Hina: Oh, I'm sorry. I got here early and I'm in the entrance hall now. I've already bought the tickets for all of us.
あっ、ごめんね。早く着いて、今はエントランスホールにいるの。もうみんなの分のチケットを買ってあるよ。`;

test('本文の分け方：名前は数えない・訳はすぐ下の行', () => {
  const ls = R.parseText(TEXT);
  assert.equal(ls.length, 5);
  assert.equal(ls[0].speaker, 'Jin'); assert.equal(ls[0].en, "I'm sorry I'm late."); assert.equal(ls[0].ja, '遅れてごめんなさい。');
  assert.equal(ls.reduce((n, l) => n + R.wordsOf(l.en).length, 0), 52, '中3の本文は52語');
  assert.equal(R.limitSec(52, '中3'), 60, '中3は52語を1分');
  assert.equal(R.limitSec(52, '中1'), 80, '中1は40語/分 → 78秒 → 80秒');
});

test('単元を登録して、生徒は自分の学年の単元を練習できる。90点以上・時間内で合格', async () => {
  const owner = (await http('POST', '/api/setup', { displayName: '三浦', loginId: 'owner', password: 'ownerpass1' })).cookie;
  assert.equal((await http('PATCH', '/api/admin/reading/config', { passScore: 90 }, owner)).status, 200, '合格ラインを90点に');
  assert.equal((await http('PATCH', '/api/admin/reading/config', { passScore: 30 }, owner)).status, 400);
  assert.equal((await http('POST', '/api/admin/reading/units', { grade: '中3', title: 'Unit 1 Part 1', text: TEXT }, owner)).status, 201);
  assert.equal((await http('POST', '/api/admin/reading/units', { grade: '中1', title: 'Unit 1', text: 'Hello. I am Ken.\nこんにちは。' }, owner)).status, 201);
  assert.equal((await http('POST', '/api/admin/reading/units', { grade: '中3', title: '', text: TEXT }, owner)).status, 400);
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'stu', displayName: 'すう', grade: '中3', password: 'password123' }, owner);
  const sc = (await http('POST', '/api/login', { loginId: 'stu', password: 'password123' })).cookie;
  const us = (await http('GET', '/api/reading/units', null, sc)).data.units;
  assert.equal(us.length, 1, '自分の学年だけ'); assert.equal(us[0].limit, 60); assert.equal(us[0].words, 52);
  let r = await http('POST', '/api/reading/practice', { unitId: us[0].id, score: 95, seconds: 75 }, sc);
  assert.equal(r.data.passed, false, '時間オーバー');
  r = await http('POST', '/api/reading/practice', { unitId: us[0].id, score: 88, seconds: 50 }, sc);
  assert.equal(r.data.passed, false, '90点に足りない');
  r = await http('POST', '/api/reading/practice', { unitId: us[0].id, score: 92, seconds: 58 }, sc);
  assert.equal(r.data.passed, true);
  const p = (await http('GET', '/api/reading/units', null, sc)).data.units[0].practice;
  assert.deepEqual(p, { count: 3, best: null, passed: false, enBest: 95, enPassed: true }, '英文で合格（訳だけはまだ）');
  const adm = (await http('GET', '/api/admin/reading', null, owner)).data;
  assert.equal(adm.units.length, 2); assert.equal(adm.summary[0].count, 3);
  // 1分の語数を変えると、制限時間も変わる
  assert.equal((await http('PATCH', '/api/admin/reading/config', { wpm: { '中3': 60 } }, owner)).status, 200);
  assert.equal((await http('GET', '/api/reading/units', null, sc)).data.units[0].limit, 55);
  assert.equal((await http('GET', '/api/admin/reading', null, sc)).status, 403, '生徒は管理画面を使えない');
});

test('本番のテスト：練習で合格するまで受けられない。クリアは単元ごとに1回、1回目+5／2回目+4／3回目から+3', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  const G = require('../server/ganbari.js');
  const mk = async (id) => { await http('POST', '/api/admin/users', { role: 'student', loginId: id, displayName: id, grade: '中3', password: 'password123' }, owner); return (await http('POST', '/api/login', { loginId: id, password: 'password123' })).cookie; };
  const a = await mk('tsa'), b = await mk('tsb');
  const unit = (await http('GET', '/api/reading/units', null, a)).data.units[0];
  assert.match((await http('POST', '/api/reading/test', { unitId: unit.id, score: 95, seconds: 50 }, a)).data.error, /練習/);
  for (const c of [a, b]) await http('POST', '/api/reading/practice', { unitId: unit.id, score: 95, seconds: 50 }, c);
  assert.match((await http('POST', '/api/reading/test', { unitId: unit.id, score: 95, seconds: 50 }, a)).data.error, /訳だけ/, '英文で合格しただけではテストは受けられない');
  for (const c of [a, b]) await http('POST', '/api/reading/practice', { unitId: unit.id, score: 92, seconds: 50, jaOnly: true }, c);
  // A：1回目でクリア → +5
  let r = (await http('POST', '/api/reading/test', { unitId: unit.id, score: 93, accuracy: 92, fluency: 95, completeness: 100, seconds: 50 }, a)).data;
  assert.equal(r.passed, true); assert.equal(r.points, 5); assert.equal(r.attempt, 1);
  r = (await http('POST', '/api/reading/test', { unitId: unit.id, score: 99, seconds: 50 }, a)).data;
  assert.equal(r.points, 0, '2回目のクリアはポイントなし'); assert.equal(r.alreadyCleared, true);
  // B：時間オーバー → 点数たりない → 3回目でクリア → +3
  assert.equal((await http('POST', '/api/reading/test', { unitId: unit.id, score: 95, seconds: 70 }, b)).data.passed, false);
  assert.equal((await http('POST', '/api/reading/test', { unitId: unit.id, score: 85, seconds: 50 }, b)).data.passed, false);
  r = (await http('POST', '/api/reading/test', { unitId: unit.id, score: 91, seconds: 52 }, b)).data;
  assert.equal(r.points, 3);
  const units = (await http('GET', '/api/reading/units', null, b)).data.units;
  assert.equal(units[0].test.passed, true);
  const adm = (await http('GET', '/api/admin/reading', null, owner)).data;
  assert.ok(adm.tests.some(t => t.name === 'tsb' && t.clearedAt === 3 && t.points === 3));
  assert.equal(adm.speechReady, false, 'キーがないときは準備まだ');
  assert.equal((await http('GET', '/api/reading/speech-token', null, a)).status, 503);
});

test('ライティング：音読テストに合格した単元だけ。練習で100点 → テスト。大文字・記号もまちがい。1回目+5', async () => {
  const W = require('../server/writing.js');
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  const a = (await http('POST', '/api/login', { loginId: 'tsa', password: 'password123' })).cookie; // 音読テストに合格ずみ
  const c = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'tsc', displayName: 'tsc', grade: '中3', password: 'password123' }, owner)) && (await http('POST', '/api/login', { loginId: 'tsc', password: 'password123' })).cookie;
  const unit = (await http('GET', '/api/reading/units', null, a)).data.units[0];
  let shot = 0; // 毎回ちがう写真（同じ写真は送れない）
  const photo = (n) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, n % 250 + 1), Buffer.from(String(n))]);
  const send = (cookie, mode, jpg = photo(++shot)) => fetch(`${base}/api/reading/writing?unitId=${unit.id}&mode=${mode}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Cookie: cookie }, body: jpg }).then(async r => ({ status: r.status, data: await r.json() }));
  const full = R.parseText(TEXT).map(l => l.en);
  W.ocr.read = async () => full;
  assert.match((await send(c, 'practice')).data.error, /音読テスト/);
  assert.match((await send(a, 'test')).data.error, /書く練習/);
  W.ocr.read = async () => ["i'm sorry I'm late", ...full.slice(1)];
  let r = (await send(a, 'practice')).data;
  assert.equal(r.passed, false); assert.ok(r.words.some(w => w.status === 'case')); assert.ok(r.words.some(w => w.status === 'punct'));
  W.ocr.read = async () => full;
  r = (await send(a, 'practice')).data; assert.equal(r.score, 100); assert.equal(r.passed, true);
  // 同じ写真は、もう一度送れない
  assert.match((await send(a, 'practice', photo(shot))).data.error, /同じ/);
  // テストは授業の日だけ（授業の曜日が未登録・ちがう曜日 → 受けられない）
  const { db } = require('../server/db.js');
  const G = require('../server/ganbari.js');
  const wd = new Date(G.jst().day + 'T00:00:00Z').getUTCDay();
  // 受けられる時間：はじめは 19:30〜20:00・22:00〜22:30（授業の前・後）
  assert.deepEqual(R.getConfig().writingWindows, [{ start: '19:30', end: '20:00' }, { start: '22:00', end: '22:30' }]);
  const tue = { role: 'student', class_days: '2' }; // 火曜が授業
  const at = (s) => new Date(s + '+09:00');
  assert.equal(W.testDay(tue, at('2026-11-24T19:45:00')).testNow, true, '火曜の授業前');
  assert.equal(W.testDay(tue, at('2026-11-24T21:00:00')).testNow, false, '授業中は受けられない');
  assert.equal(W.testDay(tue, at('2026-11-24T22:29:00')).testNow, true, '授業後');
  assert.equal(W.testDay(tue, at('2026-11-24T22:40:00')).testNow, false);
  assert.equal(W.testDay(tue, at('2026-11-24T22:40:00'), 15).testNow, true, '終わってから15分までは写真を送れる');
  assert.equal(W.testDay(tue, at('2026-11-25T19:45:00')).testNow, false, '授業の日でない');
  assert.match(W.testDayMessage(W.testDay(tue, at('2026-11-25T19:45:00'))), /授業の日（火曜）の 19:30〜20:00・22:00〜22:30/);
  assert.equal((await http('PATCH', '/api/admin/reading/config', { writingWindows: [{ start: '20:00', end: '19:30' }] }, owner)).status, 400);
  assert.equal((await http('PATCH', '/api/admin/reading/config', { writingWindows: [] }, owner)).status, 200, '空にすると授業の日のいつでも');
  assert.match((await send(a, 'test')).data.error, /授業の日.*先生に伝えて/);
  db.prepare("UPDATE users SET class_days = ? WHERE login_id = 'tsa'").run(String((wd + 1) % 7));
  assert.match((await send(a, 'test')).data.error, /授業の日（.曜）/);
  assert.equal((await http('GET', '/api/reading/units', null, a)).data.units[0].writing.testToday, false);
  // 設定をオフにすると、いつでも受けられる
  assert.equal((await http('PATCH', '/api/admin/reading/config', { writingClassDay: false }, owner)).status, 200);
  assert.equal((await http('GET', '/api/reading/units', null, a)).data.units[0].writing.testToday, true);
  await http('PATCH', '/api/admin/reading/config', { writingClassDay: true }, owner);
  db.prepare("UPDATE users SET class_days = ? WHERE login_id = 'tsa'").run(`${wd},${(wd + 3) % 7}`);
  r = (await send(a, 'test')).data; assert.equal(r.passed, true); assert.equal(r.points, 5);
  r = (await send(a, 'test')).data; assert.equal(r.points, 0, 'ポイントは1回だけ');
  assert.equal((await http('GET', '/api/reading/units', null, a)).data.units[0].writing.testPassed, true);
  assert.ok((await http('GET', '/api/admin/reading', null, owner)).data.writing.some(w => w.name === 'tsa' && w.passed));
});

test('スピーキング：聞き取れなかった単語が3つ以上なら、点数が足りていても再テスト（練習もテストも）', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'tsm', displayName: 'tsm', grade: '中3', password: 'password123' }, owner);
  const m = (await http('POST', '/api/login', { loginId: 'tsm', password: 'password123' })).cookie;
  const unit = (await http('GET', '/api/reading/units', null, m)).data.units[0];
  assert.equal((await http('POST', '/api/reading/practice', { unitId: unit.id, score: 95, seconds: 40, jaOnly: true, missing: 3 }, m)).data.passed, false, '練習：3つで不合格');
  assert.equal((await http('POST', '/api/reading/practice', { unitId: unit.id, score: 95, seconds: 40, jaOnly: true, missing: 2 }, m)).data.passed, true, '練習：2つまでOK');
  const r = (await http('POST', '/api/reading/test', { unitId: unit.id, score: 96, seconds: 40, missing: 4 }, m)).data;
  assert.equal(r.passed, false); assert.equal(r.points, 0);
  assert.equal((await http('POST', '/api/reading/test', { unitId: unit.id, score: 96, seconds: 40, missing: 0 }, m)).data.points, 4, '2回目でクリア → +4');
});

test('小学生は、自分の学年の単元と中1の単元をえらべる（時間は小学生の語数で計算）', async () => {
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'es5', displayName: 'es5', grade: '小5', password: 'password123' }, owner);
  await http('POST', '/api/admin/reading/units', { grade: '小5', title: 'Hello', text: 'Hello. Nice to meet you.\nこんにちは。' }, owner);
  const e = (await http('POST', '/api/login', { loginId: 'es5', password: 'password123' })).cookie;
  const us = (await http('GET', '/api/reading/units', null, e)).data.units;
  assert.deepEqual(us.map(u => u.grade), ['小5', '中1'], '自分の学年が先、つぎに中1（中3はなし）');
  const ken = us.find(u => u.grade === '中1');
  assert.equal(ken.limit, R.limitSec(ken.words, '小5'), '時間は小学生の語数で');
});

test('先生・オーナーの画面：生徒がいま音読・ライティングをしているのがわかる。テストの結果もお知らせ（生徒には届かない）', async () => {
  const { io: ioc } = require('socket.io-client');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
  const mk = async (id) => { await http('POST', '/api/admin/users', { role: 'student', loginId: id, displayName: id, grade: '中3', password: 'password123' }, owner); return (await http('POST', '/api/login', { loginId: id, password: 'password123' })).cookie; };
  const a = await mk('acta'), b = await mk('actb');
  const conns = [];
  const connect = (cookie) => new Promise((resolve, reject) => {
    const s = ioc(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    const c = { s, events: [] }; conns.push(s);
    s.onAny((ev, d) => c.events.push({ ev, d })); s.on('init', (d) => { c.me = d.me; resolve(c); }); s.on('connect_error', reject);
  });
  const sa = await connect(a), so = await connect(owner), sb = await connect(b);
  const unit = (await http('GET', '/api/reading/units', null, a)).data.units[0];
  sa.s.emit('activity', { kind: 'rd-test', title: unit.title });
  await sleep(150);
  const upd = (c) => c.events.filter(e => e.ev === 'user-updated' && e.d.id === sa.me.id && 'activity' in e.d).map(e => e.d.activity);
  assert.deepEqual(upd(so).at(-1) && upd(so).at(-1).kind, 'rd-test');
  assert.equal(upd(sb).length, 0, 'ほかの生徒には届かない');
  // 入りなおした先生にも届く（同じ人は前の接続が切れる）
  const so2 = await connect(owner); await sleep(150);
  assert.equal(upd(so2).at(-1).kind, 'rd-test');
  // テストの結果のお知らせ
  for (const ja of [false, true]) await http('POST', '/api/reading/practice', { unitId: unit.id, score: 95, seconds: 50, jaOnly: ja }, a);
  await http('POST', '/api/reading/test', { unitId: unit.id, score: 80, seconds: 50 }, a);
  await sleep(150);
  const res = so2.events.filter(e => e.ev === 'activity-result').map(e => e.d);
  assert.ok(res.some(d => d.name === 'acta' && /スピーキングテスト.*80点.*再テスト/.test(d.text)), JSON.stringify(res));
  assert.ok(!sb.events.some(e => e.ev === 'activity-result'), '生徒には届かない');
  // とじると消える・まちがった種類は消える扱い
  sa.s.emit('activity', { kind: null }); await sleep(150);
  assert.equal(upd(so2).at(-1), null);
  conns.forEach(s => s.disconnect());
});

test('大人（大人英会話）：テスト教室だけ入れる・毎週の文（新しい週が上・名前は自動）・高校生と同じポイント・ライティングなし・入室前は漢字と英単語', async () => {
  const P = require('../server/permissions.js');
  const SM = require('../public/shared/map.js');
  const G = require('../server/ganbari.js');
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  const r = await http('POST', '/api/admin/users', { role: 'student', loginId: 'adult1', displayName: '佐藤', grade: '大人', password: 'password123' }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const ac = (await http('POST', '/api/login', { loginId: 'adult1', password: 'password123' })).cookie;
  const user = { role: 'student', grade: '大人' };
  const room = (id) => SM.ZONES.find(z => z.id === id);
  assert.equal(P.canEnterRoom(user, room('class1')), true, 'スピーキング・ライティング教室');
  for (const id of ['study', 'class2', 'class3']) assert.equal(P.canEnterRoom(user, room(id)), false, id);
  // 毎週の文：名前が空なら「○/○の週」。新しい週が上
  const w1 = await http('POST', '/api/admin/reading/units', { grade: '大人', title: '', text: 'How was your weekend?\n週末はどうでしたか？' }, owner);
  assert.equal(w1.status, 201, JSON.stringify(w1.data));
  await http('POST', '/api/admin/reading/units', { grade: '大人', title: 'Week 2', text: 'I went hiking.\nハイキングに行きました。' }, owner);
  const us = (await http('GET', '/api/reading/units', null, ac)).data.units;
  assert.deepEqual(us.map(u => u.title), ['Week 2', `${Number(G.jst().day.slice(5, 7))}/${Number(G.jst().day.slice(8))}の文`]);
  // 1人ずつの文：その人だけに見える（ほかの大人には見えない・使えない）
  await http('POST', '/api/admin/users', { role: 'student', loginId: 'adult2', displayName: '鈴木', grade: '大人', password: 'password123' }, owner);
  const bc = (await http('POST', '/api/login', { loginId: 'adult2', password: 'password123' })).cookie;
  const adm0 = (await http('GET', '/api/admin/reading', null, owner)).data;
  const suzuki = adm0.adults.find(x => x.name === '鈴木');
  assert.ok(suzuki && adm0.adults.some(x => x.name === '佐藤'));
  assert.equal((await http('POST', '/api/admin/reading/units', { grade: '大人', userId: 999999, text: 'Hi.\nやあ。' }, owner)).status, 400);
  const own = await http('POST', '/api/admin/reading/units', { grade: '大人', userId: suzuki.id, title: '鈴木さんの文', text: 'Could you tell me the way to the station?\n駅への道を教えていただけますか？\nI have a meeting at ten.\n10時に会議があります。' }, owner);
  assert.equal(own.status, 201);
  assert.equal((await http('GET', '/api/reading/units', null, bc)).data.units[0].title, '鈴木さんの文', '本人には見える');
  assert.ok(!(await http('GET', '/api/reading/units', null, ac)).data.units.some(u => u.title === '鈴木さんの文'), 'ほかの大人には見えない');
  assert.match((await http('POST', '/api/reading/practice', { unitId: own.data.id, score: 95, seconds: 3 }, ac)).data.error, /見つかりません/);
  assert.equal((await http('GET', '/api/admin/reading', null, owner)).data.units.find(u => u.id === own.data.id).userName, '鈴木');
  // 練習 → テスト（ポイントは生徒と同じ）
  for (const ja of [false, true]) await http('POST', '/api/reading/practice', { unitId: us[0].id, score: 95, seconds: 3, jaOnly: ja }, ac);
  const t = (await http('POST', '/api/reading/test', { unitId: us[0].id, score: 95, seconds: 3 }, ac)).data;
  assert.equal(t.passed, true); assert.equal(t.points, 5);
  // ライティングはなし
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 7)]);
  const wr = await fetch(`${base}/api/reading/writing?unitId=${us[0].id}&mode=practice`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Cookie: ac }, body: jpg }).then(x => x.json());
  assert.match(wr.error, /ライティングはありません/);
  // 高校生と同じ数え方（週の🔥・メダル）・がんばりの一覧に出る。学年は上がらない
  assert.equal(G.groupOf('大人'), 'ad'); assert.equal(G.isHS('大人'), true);
  assert.ok(G.studentSummary().some(s => s.name === '佐藤' && s.hs));
  assert.equal(G.NEXT_GRADE['大人'], undefined); assert.equal(G.NEXT_GRADE['高3'], '卒業');
  // 入室前：漢字（準2級・2級）→ 英単語
  const K = require('../server/kanken.js');
  await http('PATCH', '/api/admin/kanken/config', { enabled: true }, owner);
  assert.deepEqual(K.levelsFor('大人'), ['準2級', '2級']);
  assert.equal((await http('GET', '/api/quiz/status', null, ac)).data.required, true);
  const q1 = (await http('POST', '/api/quiz/question', null, ac)).data;
  assert.equal(q1.kind, 'kanji'); assert.equal(q1.step, 1);
  const a1 = (await http('POST', '/api/quiz/answer', { choice: 0 }, ac)).data;
  assert.equal(a1.more, true, '次は英単語');
  assert.equal((await http('GET', '/api/quiz/status', null, ac)).data.required, true, 'まだ終わっていない');
  const q2 = (await http('POST', '/api/quiz/question', null, ac)).data;
  assert.equal(q2.kind, 'word'); assert.equal(q2.level, '英単語'); assert.ok(/^[A-Za-z ]+$/.test(q2.word), q2.word);
  const a2 = (await http('POST', '/api/quiz/answer', { choice: 1 }, ac)).data;
  assert.equal(a2.more, false);
  assert.equal((await http('GET', '/api/quiz/status', null, ac)).data.required, false, '2問でおわり');
  await http('PATCH', '/api/admin/kanken/config', { enabled: false }, owner);
});

test('大人のポイントになる時間は別（最初は 8:00〜15:00）。管理画面で変えられる', async () => {
  const G = require('../server/ganbari.js');
  const owner = (await http('POST', '/api/login', { loginId: 'owner', password: 'ownerpass1' })).cookie;
  assert.equal(G.groupOf('大人'), 'ad');
  const day = '2026-11-25';
  assert.deepEqual(G.ruleFor(day, G.getConfig(), 'ad').windows, [{ start: '08:00', end: '15:00' }]);
  assert.notDeepEqual(G.ruleFor(day, G.getConfig(), 'hs').windows, [{ start: '08:00', end: '15:00' }], '高校生はそのまま');
  const r = await http('PATCH', '/api/admin/ganbari/config', { ad: { window: { start: '09:00', end: '14:00' }, window2: null, dailyCap: 240 } }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(G.ruleFor(day, G.getConfig(), 'ad').windows, [{ start: '09:00', end: '14:00' }]);
  assert.equal(G.ruleFor(day, G.getConfig(), 'ad').cap, 240);
  // 時間帯の中だけポイントになる
  const id = (await http('POST', '/api/admin/users', { role: 'student', loginId: 'adultpt', displayName: 'ぽ', grade: '大人', password: 'password123' }, owner)).data.user.id;
  const fake = { id, room: 'class1', seat: 'x', away: null, user: { id, role: 'student', grade: '大人' } };
  const at = (hm) => new Date(`${day}T${hm}:00+09:00`);
  assert.equal(G.tick(new Map([[id, fake]]), { date: at('10:00') }).length, 1, '10時はポイント');
  assert.equal(G.tick(new Map([[id, fake]]), { date: at('16:00') }).length, 0, '16時はポイントにならない');
  await http('PATCH', '/api/admin/ganbari/config', { ad: { window: { start: '08:00', end: '15:00' }, window2: null, dailyCap: 360 } }, owner);
});
