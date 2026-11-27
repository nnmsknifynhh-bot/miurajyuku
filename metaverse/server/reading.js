// 英語の音読：単元（教科書の本文と日本語訳）・制限時間（語数と学年から自動）・練習の記録
// 練習の採点は、生徒の端末のブラウザの聞き取り（無料）で行う。サーバーは結果を受け取って記録する
// （本番のテストの採点〔Microsoft〕は、あとでつなぐ）
const { db, now, getSetting, setSetting, audit } = require('./db');
const G = require('./ganbari');

db.exec(`
CREATE TABLE IF NOT EXISTS reading_units (id INTEGER PRIMARY KEY AUTOINCREMENT, grade TEXT NOT NULL, title TEXT NOT NULL, lines TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reading_practice (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, unit_id INTEGER NOT NULL, score INTEGER NOT NULL, seconds INTEGER NOT NULL, limit_sec INTEGER NOT NULL, passed INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_reading_practice_user ON reading_practice(user_id, unit_id);
CREATE TABLE IF NOT EXISTS reading_tests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, unit_id INTEGER NOT NULL, attempt INTEGER NOT NULL, score INTEGER NOT NULL, accuracy INTEGER, fluency INTEGER, completeness INTEGER, seconds INTEGER NOT NULL, limit_sec INTEGER NOT NULL, passed INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_reading_tests_user ON reading_tests(user_id, unit_id);
`);
// 大人英会話：その人だけの文（user_id があれば、その人だけに見える）
if (!db.prepare('PRAGMA table_info(reading_units)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE reading_units ADD COLUMN user_id INTEGER');
// 単元のならび順（先生が ↑↓ で決める。決めていない単元は、名前の数字の順：Unit1-2 → Unit1-10 → Unit2-1）
// 📘 教科書（空なら全員に出る。学校に結びつけた教科書の単元だけが、その学校の生徒に出る）
if (!db.prepare('PRAGMA table_info(reading_units)').all().some(c => c.name === 'textbook')) db.exec('ALTER TABLE reading_units ADD COLUMN textbook TEXT');
if (!db.prepare('PRAGMA table_info(reading_units)').all().some(c => c.name === 'sort_order')) db.exec('ALTER TABLE reading_units ADD COLUMN sort_order INTEGER');
// 練習が「英文を見て」か「訳だけで」か（テストを受けられるのは、訳だけで合格したとき）
if (!db.prepare('PRAGMA table_info(reading_practice)').all().some(c => c.name === 'ja_only')) db.exec('ALTER TABLE reading_practice ADD COLUMN ja_only INTEGER NOT NULL DEFAULT 0');
// 声がとどかずに0点で記録されたテスト（読みもれなし0）は、回数に数えないので消す（1回だけ）
if (getSetting('reading_clean0', '') !== '1') { db.prepare('DELETE FROM reading_tests WHERE score = 0 AND COALESCE(completeness, 0) = 0').run(); setSetting('reading_clean0', '1'); }
// 本番のテストでクリアしたときのポイント（単元ごとに1回）：1回目 +5／2回目 +4／3回目から +3
const TEST_POINTS = (attempt) => attempt <= 1 ? 5 : attempt === 2 ? 4 : 3;

// 学年ごとの「1分に読む語数」（中3の本文52語を1分 → 52語。ほかは目安。管理画面で変えられる）
const DEFAULT_WPM = { '小1': 30, '小2': 30, '小3': 30, '小4': 30, '小5': 30, '小6': 30, '中1': 40, '中2': 45, '中3': 52, '高1': 60, '高2': 70, '高3': 70, '大人': 70 };
const MAX_MISSING = 3; // スピーキング：聞き取れなかった単語が3つ以上なら、点数が足りていても再テスト
const PASS_SCORE = 90; // 合格ライン（管理画面で変えられる）
// ライティングテストを受けられる時間（授業の日の、授業の前・後）
const DEFAULT_W_WINDOWS = [{ start: '19:30', end: '20:00' }, { start: '22:00', end: '22:30' }];
const RE_HM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
function getConfig() {
  let saved = {};
  try { saved = JSON.parse(getSetting('reading', '{}')); } catch (e) { saved = {}; }
  return { wpm: { ...DEFAULT_WPM, ...(saved.wpm || {}) }, passScore: Number.isInteger(saved.passScore) ? saved.passScore : PASS_SCORE, writingClassDay: saved.writingClassDay !== false, writingWindows: Array.isArray(saved.writingWindows) ? saved.writingWindows : DEFAULT_W_WINDOWS };
}
function setConfig(p, actorId) {
  const c = getConfig();
  if (p.wpm) {
    for (const [g, v] of Object.entries(p.wpm)) {
      if (!G.GRADES.includes(g)) continue;
      if (!Number.isInteger(v) || v < 10 || v > 300) return `${g}の語数は10〜300にしてください`;
      c.wpm[g] = v;
    }
  }
  if (p.passScore !== undefined) {
    if (!Number.isInteger(p.passScore) || p.passScore < 50 || p.passScore > 100) return '合格ラインは50〜100点にしてください';
    c.passScore = p.passScore;
  }
  if (p.writingClassDay !== undefined) c.writingClassDay = !!p.writingClassDay; // ライティングテストは授業の日だけ
  if (p.writingWindows !== undefined) { // その日の、テストを受けられる時間（0〜3つ。空なら授業の日のいつでも）
    const w = p.writingWindows;
    if (!Array.isArray(w) || w.length > 3 || !w.every(x => x && RE_HM.test(x.start || '') && RE_HM.test(x.end || '') && x.start < x.end)) return 'テストの時間が正しくありません（例：19:30〜20:00）';
    c.writingWindows = w.map(x => ({ start: x.start, end: x.end })).sort((a, b) => a.start.localeCompare(b.start));
  }
  setSetting('reading', JSON.stringify({ wpm: c.wpm, passScore: c.passScore, writingClassDay: c.writingClassDay, writingWindows: c.writingWindows }));
  audit(actorId, 'reading.config', null, null);
  return null;
}

// 本文の単語（話す人の名前はのぞく）
const wordsOf = (text) => String(text || '').split(/\s+/).map(w => w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '')).filter(Boolean);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, '').trim().slice(0, n);
/**
 * 貼り付けた本文を行に分ける。英語の行と、そのすぐ下の日本語の行を1組にする。
 * 「Jin: I'm sorry.」のように行の頭に「名前:」があれば、話す人の名前として分ける（読まない・数えない）
 */
function parseText(text) {
  const raw = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const isEn = (s) => /[A-Za-z]/.test(s) && !/[぀-ヿ一-鿿]/.test(s);
  const out = [];
  for (const line of raw) {
    if (isEn(line)) {
      const m = line.match(/^([A-Z][A-Za-z .'-]{0,20}):\s*(.+)$/);
      out.push({ speaker: m ? m[1].trim() : null, en: clean(m ? m[2] : line, 400), ja: '' });
    } else if (out.length && !out[out.length - 1].ja) out[out.length - 1].ja = clean(line, 400);
  }
  return out;
}
const limitSec = (words, grade, c = getConfig()) => Math.max(10, Math.ceil((words / (c.wpm[grade] || 52)) * 60 / 5) * 5);
function view(u, c = getConfig(), grade = u.grade) {
  const lines = JSON.parse(u.lines);
  const words = lines.reduce((n, l) => n + wordsOf(l.en).length, 0);
  return { id: u.id, grade: u.grade, title: u.title, lines, words, limit: limitSec(words, grade || u.grade, c), active: !!u.active, textbook: u.textbook || null, userId: u.user_id || null, userName: u.user_name || null };
}

// 大人英会話：だれ用の文か（userId が空なら、大人みんな）
function personOf(p, grade = p.grade) {
  if (grade !== '大人' || p.userId == null || p.userId === '') return { id: null };
  const u = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student' AND grade = '大人'").get(Number(p.userId));
  return u ? { id: u.id } : { error: '大人英会話の生徒をえらんでください' };
}
// 単元の教科書（大人はなし）。空なら null＝全員に出る
function textbookFor(p, grade) {
  if (grade === '大人' || p.textbook == null || p.textbook === '') return { tb: null };
  const t = String(p.textbook).trim();
  return require('./prep').textbookList().includes(t) ? { tb: t } : { error: '教科書が見つかりません（「🏫 教室の設定」で作れます）' };
}
function addUnit(p, actorId) {
  if (!G.GRADES.includes(p.grade)) return { error: '学年をえらんでください' };
  const tbr = textbookFor(p, p.grade); if (tbr.error) return tbr;
  // 大人英会話：名前が空なら「11/24の週」（毎週の3文）
  const j = G.jst();
  const title = clean(p.title, 60) || (p.grade === '大人' ? `${Number(j.day.slice(5, 7))}/${Number(j.day.slice(8))}の文` : '');
  const who = personOf(p);
  if (who.error) return who;
  if (!title) return { error: '単元の名前を入れてください（例：Unit 1 Part 1）' };
  const lines = parseText(p.text);
  if (!lines.length) return { error: '英語の本文を入れてください' };
  if (lines.length > 60) return { error: '本文が長すぎます（60行まで）' };
  const r = db.prepare('INSERT INTO reading_units (grade, title, lines, created_at, user_id, textbook) VALUES (?, ?, ?, ?, ?, ?)').run(p.grade, title, JSON.stringify(lines), now(), who.id, tbr.tb);
  audit(actorId, 'reading.unit_added', title, { grade: p.grade, textbook: tbr.tb });
  return { ok: true, id: Number(r.lastInsertRowid) };
}
function updateUnit(id, p, actorId) {
  const u = db.prepare('SELECT * FROM reading_units WHERE id = ?').get(id);
  if (!u) return { error: '単元が見つかりません' };
  const grade = p.grade !== undefined ? p.grade : u.grade;
  if (!G.GRADES.includes(grade)) return { error: '学年をえらんでください' };
  const title = p.title !== undefined ? clean(p.title, 60) : u.title;
  if (!title) return { error: '単元の名前を入れてください' };
  const lines = p.text !== undefined ? parseText(p.text) : JSON.parse(u.lines);
  if (!lines.length) return { error: '英語の本文を入れてください' };
  const active = p.active !== undefined ? (p.active ? 1 : 0) : u.active;
  const who = p.userId !== undefined ? personOf(p, grade) : { id: grade === '大人' ? u.user_id : null };
  if (who.error) return who;
  const tbr = p.textbook !== undefined ? textbookFor(p, grade) : { tb: grade === '大人' ? null : u.textbook };
  if (tbr.error) return tbr;
  db.prepare('UPDATE reading_units SET grade = ?, title = ?, lines = ?, active = ?, user_id = ?, textbook = ? WHERE id = ?').run(grade, title, JSON.stringify(lines), active, who.id, tbr.tb, id);
  audit(actorId, 'reading.unit_updated', title, null);
  return { ok: true };
}
function deleteUnit(id, actorId) {
  const r = db.prepare('DELETE FROM reading_units WHERE id = ?').run(id);
  db.prepare('DELETE FROM reading_practice WHERE unit_id = ?').run(id);
  db.prepare('DELETE FROM reading_tests WHERE unit_id = ?').run(id);
  db.prepare('DELETE FROM writing_attempts WHERE unit_id = ?').run(id);
  audit(actorId, 'reading.unit_deleted', String(id), null);
  return r.changes > 0;
}
const natural = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
// 同じ学年の中のならび：先生が決めた順 → 名前（数字は数の大きさ順）
const byOrder = (a, b) => ((a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)) || natural.compare(a.title, b.title) || a.id - b.id;
const GRADE_ORDER = (g) => { const i = G.GRADES.indexOf(g); return i < 0 ? 99 : i; };
function sortUnits(rows) { return rows.sort((a, b) => (GRADE_ORDER(a.grade) - GRADE_ORDER(b.grade)) || (a.grade === '大人' ? b.id - a.id : byOrder(a, b))); }
function listUnits(c = getConfig()) {
  return sortUnits(db.prepare('SELECT r.*, u.display_name AS user_name FROM reading_units r LEFT JOIN users u ON u.id = r.user_id').all()).map(u => view(u, c));
}
/** 先生が単元を ↑↓ で動かす（同じ学年の中で、となりと入れかえる） */
function moveUnit(id, dir, actorId) {
  const u = db.prepare('SELECT * FROM reading_units WHERE id = ?').get(id);
  if (!u) return { error: '単元が見つかりません' };
  const list = db.prepare('SELECT * FROM reading_units WHERE grade = ?').all(u.grade).sort(byOrder);
  const i = list.findIndex(x => x.id === id), j = i + (dir === 'up' ? -1 : 1);
  if (j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];
  const up = db.prepare('UPDATE reading_units SET sort_order = ? WHERE id = ?');
  db.exec('BEGIN'); try { list.forEach((x, k) => up.run(k + 1, x.id)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(actorId, 'reading.unit_moved', u.title, { dir });
  return { ok: true };
}

// 生徒の単元の一覧（自分の学年。先生・オーナーは全部）。練習の記録つき
function unitsFor(user) {
  const c = getConfig();
  const staff = user.role === 'owner' || user.role === 'teacher';
  let rows = staff ? sortUnits(db.prepare('SELECT * FROM reading_units WHERE active = 1').all())
    : /^小[1-6]$/.test(user.grade || '') // 小学生は、自分の学年の単元と「中1」の単元をえらべる
      ? db.prepare("SELECT * FROM reading_units WHERE active = 1 AND grade IN (?, '中1')").all(user.grade).sort((a, b) => ((a.grade === user.grade ? 0 : 1) - (b.grade === user.grade ? 0 : 1)) || byOrder(a, b))
      : user.grade === '大人' // 大人：自分の文（と大人みんなの文）。新しいものが上
        ? db.prepare("SELECT * FROM reading_units WHERE active = 1 AND grade = '大人' AND (user_id IS NULL OR user_id = ?) ORDER BY id DESC").all(user.id)
        : db.prepare('SELECT * FROM reading_units WHERE active = 1 AND grade = ?').all(user.grade || '').sort(byOrder);
  // 📘 学校に教科書が結びついている生徒：その教科書の単元と、教科書なしの単元だけ（結びついていなければ今まで通り全部）
  const tb = staff ? null : require('./prep').textbookOf(user);
  if (tb) rows = rows.filter(u => !u.textbook || u.textbook === tb);
  return rows.map(u => {
    const best = db.prepare(`SELECT COUNT(*) AS n, MAX(CASE WHEN ja_only = 1 THEN score END) AS best, MAX(CASE WHEN ja_only = 1 THEN passed END) AS passed,
      MAX(CASE WHEN ja_only = 0 THEN score END) AS enBest, MAX(CASE WHEN ja_only = 0 THEN passed END) AS enPassed FROM reading_practice WHERE user_id = ? AND unit_id = ?`).get(user.id, u.id);
    const t = db.prepare('SELECT MAX(score) AS best, COUNT(*) AS n, MAX(passed) AS passed, MAX(points) AS points FROM reading_tests WHERE user_id = ? AND unit_id = ?').get(user.id, u.id);
    return { ...view(u, c, staff ? u.grade : user.grade), practice: { count: best.n, best: best.best, passed: !!best.passed, enBest: best.enBest, enPassed: !!best.enPassed },
      test: { count: t.n, best: t.best, passed: !!t.passed, points: t.points || 0, nextPoints: t.passed ? 0 : TEST_POINTS(t.n + 1) },
      writing: (() => { const W = require('./writing'), td = W.testDay(user); return { ...W.status(user.id, u.id), ...td, testMsg: td.testNow ? null : W.testDayMessage(td) }; })() };
  });
}
/** 練習の結果を記録する（点数・時間は端末で計算したもの）。合格ライン：90点以上・時間内 */
// その人が使える単元か（ほかの人だけの文は使えない）
const mine = (u, user) => u && (!u.user_id || u.user_id === user.id || user.role === 'owner' || user.role === 'teacher');
function recordPractice(user, unitId, score, seconds, jaOnly = false, missing = 0) {
  const u = db.prepare('SELECT * FROM reading_units WHERE id = ? AND active = 1').get(unitId);
  if (!mine(u, user)) return { error: '単元が見つかりません' };
  const sc = Math.round(Number(score)), sec = Math.round(Number(seconds));
  if (!Number.isFinite(sc) || sc < 0 || sc > 100 || !Number.isFinite(sec) || sec < 1 || sec > 3600) return { error: '結果が正しくありません' };
  const v = view(u, getConfig(), user.role === 'student' ? user.grade : u.grade);
  const miss = Math.max(0, Math.round(Number(missing)) || 0);
  const passed = sc >= getConfig().passScore && sec <= v.limit && miss < MAX_MISSING;
  db.prepare('INSERT INTO reading_practice (user_id, unit_id, score, seconds, limit_sec, passed, ja_only, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, unitId, sc, sec, v.limit, passed ? 1 : 0, jaOnly ? 1 : 0, now());
  return { ok: true, passed, limit: v.limit };
}
/**
 * 本番のテストの結果を記録する（採点は Microsoft の発音評価。端末で受け取った点数を送ってくる）
 * 受けられるのは、その単元の練習で合格した生徒だけ（先生・オーナーは、ためしに受けられる・ポイントなし）
 * 90点以上・時間内でクリア。はじめてクリアしたときだけポイント
 */
function recordTest(user, unitId, r) {
  const u = db.prepare('SELECT * FROM reading_units WHERE id = ? AND active = 1').get(unitId);
  if (!mine(u, user)) return { error: '単元が見つかりません' };
  const staff = user.role === 'owner' || user.role === 'teacher';
  const okPractice = db.prepare('SELECT 1 FROM reading_practice WHERE user_id = ? AND unit_id = ? AND passed = 1 AND ja_only = 1').get(user.id, unitId);
  if (!staff && !okPractice) return { error: '先に「訳だけで練習」で90点以上・時間内を出してね' };
  const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; };
  const sc = num(r.score), sec = Math.round(Number(r.seconds));
  if (sc === null || !Number.isFinite(sec) || sec < 1 || sec > 3600) return { error: '結果が正しくありません' };
  const v = view(u, getConfig(), staff ? u.grade : user.grade);
  const before = db.prepare('SELECT COUNT(*) AS n, MAX(passed) AS p FROM reading_tests WHERE user_id = ? AND unit_id = ?').get(user.id, unitId);
  const attempt = before.n + 1;
  const miss = Math.max(0, Math.round(Number(r.missing)) || 0);
  const passed = sc >= getConfig().passScore && sec <= v.limit && miss < MAX_MISSING;
  let points = 0;
  if (passed && !before.p && user.role === 'student' && !user.trial_until) {
    points = TEST_POINTS(attempt);
    const ins = db.prepare('INSERT OR IGNORE INTO bonus_points (user_id, reason, points, created_at) VALUES (?, ?, ?, ?)').run(user.id, `reading:${unitId}`, points, now());
    if (!ins.changes) points = 0;
  }
  db.prepare('INSERT INTO reading_tests (user_id, unit_id, attempt, score, accuracy, fluency, completeness, seconds, limit_sec, passed, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, unitId, attempt, sc, num(r.accuracy), num(r.fluency), num(r.completeness), sec, v.limit, passed ? 1 : 0, points, now());
  return { ok: true, passed, points, attempt, limit: v.limit, alreadyCleared: !!before.p, score: sc, seconds: sec, missing: miss, title: u.title };
}
function testSummary() {
  return db.prepare(`SELECT t.user_id, u.display_name AS name, u.grade, t.unit_id, r.title, COUNT(*) AS count, MAX(t.score) AS best, MAX(t.passed) AS passed, MAX(t.points) AS points,
      MIN(CASE WHEN t.passed = 1 THEN t.attempt END) AS clearedAt, MAX(t.created_at) AS last
    FROM reading_tests t JOIN users u ON u.id = t.user_id JOIN reading_units r ON r.id = t.unit_id GROUP BY t.user_id, t.unit_id ORDER BY last DESC LIMIT 300`).all()
    .map(r => ({ ...r, passed: !!r.passed }));
}

// 先生用：生徒ごと・単元ごとの練習のようす
function practiceSummary() {
  return db.prepare(`SELECT p.user_id, u.display_name AS name, u.grade, p.unit_id, r.title, COUNT(*) AS count, MAX(p.score) AS best, MAX(CASE WHEN p.ja_only = 1 THEN p.passed ELSE 0 END) AS passed, MAX(CASE WHEN p.ja_only = 0 THEN p.passed ELSE 0 END) AS enPassed, MAX(p.created_at) AS last
    FROM reading_practice p JOIN users u ON u.id = p.user_id JOIN reading_units r ON r.id = p.unit_id GROUP BY p.user_id, p.unit_id ORDER BY last DESC LIMIT 300`).all()
    .map(r => ({ ...r, passed: !!r.passed, enPassed: !!r.enPassed }));
}

module.exports = { moveUnit, MAX_MISSING, TEST_POINTS, recordTest, testSummary, DEFAULT_WPM, PASS_SCORE, getConfig, setConfig, parseText, wordsOf, limitSec, addUnit, updateUnit, deleteUnit, listUnits, unitsFor, recordPractice, practiceSummary };
