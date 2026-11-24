// ライティングのテスト：日本語訳を見て、ノートに英文を手で書く → 写真 → Microsoft の文字読み取り（Read）→ 本文とくらべる
// - 大文字・小文字、ピリオド・？・！・カンマ・アポストロフィもまちがいにする（話す人の名前は書かない）
// - 100点（全部正しい）で合格。時間は無制限
// - 練習（何回でも）で100点 → テストを受けられる。テストを受けられるのは、その単元の音読テストに合格した生徒
// - テストではじめて合格したときだけポイント：1回目 +5／2回目 +4／3回目から +3
const { db, now } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS writing_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, unit_id INTEGER NOT NULL, mode TEXT NOT NULL, attempt INTEGER NOT NULL, score INTEGER NOT NULL, passed INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_writing_user ON writing_attempts(user_id, unit_id);
`);
// 送った写真の指紋（同じ写真をもう一度送れないように）
if (!db.prepare('PRAGMA table_info(writing_attempts)').all().some(c => c.name === 'photo_hash')) db.exec('ALTER TABLE writing_attempts ADD COLUMN photo_hash TEXT');
const crypto = require('node:crypto');
const G = require('./ganbari');
const WD = ['日', '月', '火', '水', '木', '金', '土'];
/**
 * ライティングテストを今日受けられるか（「授業の日だけ」の設定がオンなら、その生徒の授業の曜日だけ）
 * @returns {{ testToday: boolean, classDays: string|null }}  classDays は「火・金」のような表示用
 */
function testDay(user, date = new Date()) {
  const staff = user.role === 'owner' || user.role === 'teacher';
  const days = String(user.class_days || '').split(',').filter(Boolean).map(Number);
  const label = days.length ? days.map(d => WD[d]).join('・') : null;
  if (staff || !require('./reading').getConfig().writingClassDay) return { testToday: true, classDays: label };
  const wd = new Date(G.jst(date).day + 'T00:00:00Z').getUTCDay();
  return { testToday: days.includes(wd), classDays: label };
}
const PASS = 100;
const POINTS = (attempt) => attempt <= 1 ? 5 : attempt === 2 ? 4 : 3;

// ── 文字読み取り（Microsoft Read API v3.2：手書きも読める） ──
const visionReady = () => !!(process.env.AZURE_VISION_KEY && process.env.AZURE_VISION_ENDPOINT);
async function azureRead(buf) {
  const endpoint = String(process.env.AZURE_VISION_ENDPOINT || '').replace(/\/+$/, '');
  const key = process.env.AZURE_VISION_KEY;
  const r = await fetch(`${endpoint}/vision/v3.2/read/analyze?language=en`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/octet-stream' }, body: buf });
  if (r.status !== 202) throw new Error('読み取りを始められませんでした（' + r.status + '）');
  const op = r.headers.get('operation-location');
  for (let i = 0; i < 30; i++) {
    await new Promise(res => setTimeout(res, 700));
    const g = await fetch(op, { headers: { 'Ocp-Apim-Subscription-Key': key } });
    const j = await g.json();
    if (j.status === 'succeeded') return (j.analyzeResult.readResults || []).flatMap(p => (p.lines || []).map(l => l.text));
    if (j.status === 'failed') throw new Error('文字を読み取れませんでした');
  }
  throw new Error('読み取りに時間がかかりすぎました');
}
// テストのときは、ここを入れかえる
const ocr = { read: azureRead };

// ── くらべ方 ──
const normQ = (s) => String(s).replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
const tokensOf = (text) => normQ(text).split(/\s+/).filter(Boolean);
const loose = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * 本文（lines の en）と、読み取った文字をくらべる。
 * @returns {{ score, words: [{ ref, got, status }], extra: string[] }}
 * status: ok / case（大文字・小文字）/ punct（ピリオド・？・アポストロフィなど）/ spell（つづり）/ missing（書いていない）
 */
function compare(lines, written) {
  const ref = lines.flatMap(l => tokensOf(l.en));
  // 書いた文に「Jin:」のような話す人の名前があれば、のぞく
  const speakers = new Set(lines.map(l => l.speaker).filter(Boolean).map(s => s.toLowerCase()));
  const got = tokensOf(written.join(' ')).filter(t => !(t.endsWith(':') && speakers.has(t.slice(0, -1).toLowerCase())));
  const A = ref.map(loose), B = got.map(loose), n = A.length, m = B.length;
  // 単語の並びを合わせる（つづりちがいも近ければ合わせる）
  const sim = (a, b) => a === b ? 2 : (a && b && lev(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 3))) ? 1 : 0;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    const s = sim(A[i], B[j]);
    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], s ? dp[i + 1][j + 1] + s : -1);
  }
  const words = [], used = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n) {
    const s = j < m ? sim(A[i], B[j]) : 0;
    if (j < m && s && dp[i][j] === dp[i + 1][j + 1] + s) {
      used[j] = true;
      const r = ref[i], g = got[j];
      const letters = (t) => t.replace(/[^A-Za-z0-9]/g, '');
      // つづりがちがう → spell、文字は同じで大文字・小文字がちがう → case、文字も大文字も同じで記号だけちがう → punct
      const status = r === g ? 'ok' : A[i] !== B[j] ? 'spell' : letters(r) !== letters(g) ? 'case' : 'punct';
      words.push({ ref: r, got: g, status }); i++; j++;
    } else if (j < m && dp[i][j] === dp[i][j + 1]) j++;
    else { words.push({ ref: ref[i], got: null, status: 'missing' }); i++; }
  }
  const extra = got.filter((_, k) => !used[k]);
  const ok = words.filter(w => w.status === 'ok').length;
  const score = n ? Math.floor(ok / (n + extra.length) * 100) : 0;
  return { score, words, extra };
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// ── 受けられるか・記録 ──
function status(userId, unitId) {
  const r = db.prepare(`SELECT COUNT(*) AS n, MAX(CASE WHEN mode = 'practice' THEN passed END) AS pp, MAX(CASE WHEN mode = 'practice' THEN score END) AS pbest,
    SUM(CASE WHEN mode = 'test' THEN 1 ELSE 0 END) AS tn, MAX(CASE WHEN mode = 'test' THEN passed END) AS tp, MAX(CASE WHEN mode = 'test' THEN score END) AS tbest
    FROM writing_attempts WHERE user_id = ? AND unit_id = ?`).get(userId, unitId);
  return { practicePassed: !!r.pp, practiceBest: r.pbest, practiceCount: r.n - (r.tn || 0), testCount: r.tn || 0, testPassed: !!r.tp, testBest: r.tbest, nextPoints: r.tp ? 0 : POINTS((r.tn || 0) + 1) };
}
async function grade(user, unit, mode, buf) {
  const staff = user.role === 'owner' || user.role === 'teacher';
  if (!['practice', 'test'].includes(mode)) return { error: 'えらび方が正しくありません' };
  if (!staff) {
    const readOk = db.prepare('SELECT 1 FROM reading_tests WHERE user_id = ? AND unit_id = ? AND passed = 1').get(user.id, unit.id);
    if (!readOk) return { error: '先に、この単元の音読テストに合格してね' };
    if (mode === 'test' && !status(user.id, unit.id).practicePassed) return { error: '先に、書く練習で100点を出してね' };
    if (mode === 'test') {
      const td = testDay(user);
      if (!td.testToday) return { error: td.classDays ? `📝 ライティングテストは、授業の日（${td.classDays}曜）に受けられるよ` : '📝 ライティングテストは授業の日に受けられます。授業の曜日がまだ登録されていないので、先生に伝えてね' };
    }
  }
  if (!Buffer.isBuffer(buf) || buf.length < 1000 || !(buf[0] === 0xff && buf[1] === 0xd8)) return { error: '写真が正しくありません（JPEG）' };
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (!staff && db.prepare('SELECT 1 FROM writing_attempts WHERE user_id = ? AND photo_hash = ?').get(user.id, hash)) return { error: '前に送った写真と同じです。新しく書いて、撮りなおしてね' };
  if (!visionReady() && ocr.read === azureRead) return { error: '文字の読み取りの準備がまだできていません（先生に伝えてね）', code: 503 };
  let written;
  try { written = await ocr.read(buf); } catch (e) { console.error('文字の読み取りに失敗:', e.message); return { error: '文字を読み取れませんでした。明るいところで、ノートがまっすぐ写るように撮りなおしてね', code: 502 }; }
  if (!written.length) return { error: '文字が見つかりませんでした。ノート全体が写るように撮りなおしてね' };
  const lines = JSON.parse(unit.lines);
  const c = compare(lines, written);
  const passed = c.score >= PASS;
  const before = status(user.id, unit.id);
  const attempt = mode === 'test' ? before.testCount + 1 : before.practiceCount + 1;
  let points = 0;
  if (mode === 'test' && passed && !before.testPassed && user.role === 'student' && !user.trial_until) {
    points = POINTS(attempt);
    if (!db.prepare('INSERT OR IGNORE INTO bonus_points (user_id, reason, points, created_at) VALUES (?, ?, ?, ?)').run(user.id, `writing:${unit.id}`, points, now()).changes) points = 0;
  }
  db.prepare('INSERT INTO writing_attempts (user_id, unit_id, mode, attempt, score, passed, points, created_at, photo_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, unit.id, mode, attempt, c.score, passed ? 1 : 0, points, now(), hash);
  return { ok: true, ...c, passed, points, attempt, alreadyCleared: mode === 'test' && before.testPassed, written };
}
function summary() {
  return db.prepare(`SELECT w.user_id, u.display_name AS name, u.grade, w.unit_id, r.title,
      SUM(CASE WHEN w.mode = 'practice' THEN 1 ELSE 0 END) AS practice, SUM(CASE WHEN w.mode = 'test' THEN 1 ELSE 0 END) AS tests,
      MAX(w.score) AS best, MAX(CASE WHEN w.mode = 'test' THEN w.passed ELSE 0 END) AS passed, MIN(CASE WHEN w.mode = 'test' AND w.passed = 1 THEN w.attempt END) AS clearedAt, MAX(w.points) AS points, MAX(w.created_at) AS last
    FROM writing_attempts w JOIN users u ON u.id = w.user_id JOIN reading_units r ON r.id = w.unit_id GROUP BY w.user_id, w.unit_id ORDER BY last DESC LIMIT 300`).all().map(r => ({ ...r, passed: !!r.passed }));
}
module.exports = { PASS, POINTS, compare, status, grade, testDay, summary, visionReady, ocr };
