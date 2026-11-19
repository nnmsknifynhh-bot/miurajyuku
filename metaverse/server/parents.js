// 保護者：招待コードで登録・ロビーで1日1回10分・毎日5問の4択・見たよスタンプ・家族の木
const crypto = require('crypto');
const { db, now, audit, getSetting, setSetting } = require('./db');
const G = require('./ganbari');

// ───────── users の role に 'parent' を足す（古いデータは表を作り直す・1回だけ） ─────────
(function migrateRole() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!row || row.sql.includes("'parent'")) return;
  const newSql = row.sql
    .replace(/CHECK \(role IN \('owner','teacher','student'\)\)/, "CHECK (role IN ('owner','teacher','student','parent'))")
    .replace(/CREATE TABLE (IF NOT EXISTS )?"?users"?/, 'CREATE TABLE users_new');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(newSql);
    db.exec('INSERT INTO users_new SELECT * FROM users');
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
})();

db.exec(`
CREATE TABLE IF NOT EXISTS parent_children (parent_id INTEGER NOT NULL, student_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (parent_id, student_id));
CREATE TABLE IF NOT EXISTS parent_invites (code TEXT PRIMARY KEY, student_id INTEGER NOT NULL, created_at TEXT NOT NULL, used_by INTEGER, used_at TEXT);
CREATE TABLE IF NOT EXISTS parent_visits (user_id INTEGER NOT NULL, day TEXT NOT NULL, started_at INTEGER NOT NULL, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS parent_quiz (user_id INTEGER NOT NULL, day TEXT NOT NULL, qid TEXT NOT NULL, correct INTEGER NOT NULL, answered_at TEXT NOT NULL, PRIMARY KEY (user_id, day, qid));
CREATE TABLE IF NOT EXISTS parent_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, wrong TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS parent_cheers (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL, student_id INTEGER NOT NULL, day TEXT NOT NULL, stamp TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE (parent_id, student_id, day));
`);

const VISIT_MS = Number(process.env.PARENT_VISIT_MS || 10 * 60_000); // 1日1回・10分
const SUBJECTS = ['漢字', '英単語', '数学', '理科', '社会'];
const PER_DAY = 5;
const STAMPS = ['👍 がんばったね', '💪 その調子', '🍙 おつかれさま', '🌟 すごいね', '😊 いつも応援してるよ'];

// ───────── 招待コード・登録 ─────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // まぎらわしい 0/O・1/I はのぞく
function newCode() {
  let s = '';
  for (const b of crypto.randomBytes(8)) s += CODE_CHARS[b % CODE_CHARS.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}
function createInvite(studentId, actorId) {
  const st = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student' AND trial_until IS NULL").get(studentId);
  if (!st) return { error: '生徒が見つかりません' };
  const code = newCode();
  db.prepare('INSERT INTO parent_invites (code, student_id, created_at) VALUES (?, ?, ?)').run(code, studentId, now());
  if (actorId) audit(actorId, 'parent.invite_created', String(studentId), null);
  return { code };
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
// 招待コードをたしかめる（使えるなら生徒の id）
function inviteStudent(code) {
  const r = db.prepare('SELECT student_id, used_by FROM parent_invites WHERE code = ?').get(normCode(code));
  if (!r || r.used_by) return null;
  const st = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student' AND is_active = 1").get(r.student_id);
  return st ? st.id : null;
}
function useInvite(code, parentId) {
  const c = normCode(code);
  const sid = inviteStudent(c);
  if (!sid) return { error: '招待コードが正しくないか、もう使われています' };
  db.prepare('UPDATE parent_invites SET used_by = ?, used_at = ? WHERE code = ?').run(parentId, now(), c);
  db.prepare('INSERT OR IGNORE INTO parent_children (parent_id, student_id, created_at) VALUES (?, ?, ?)').run(parentId, sid, now());
  return { studentId: sid };
}
function childrenOf(parentId) {
  return db.prepare(`SELECT u.id, u.display_name AS name, u.grade FROM parent_children pc JOIN users u ON u.id = pc.student_id
    WHERE pc.parent_id = ? AND u.is_active = 1 ORDER BY u.display_name`).all(parentId);
}
function parentsOf(studentId) {
  return db.prepare(`SELECT u.id, u.display_name AS name, u.login_id AS loginId, u.is_active AS active FROM parent_children pc JOIN users u ON u.id = pc.parent_id
    WHERE pc.student_id = ? ORDER BY u.id`).all(studentId);
}
function unlink(parentId, studentId) {
  return db.prepare('DELETE FROM parent_children WHERE parent_id = ? AND student_id = ?').run(parentId, studentId).changes > 0;
}
function childIds(parentId) { return new Set(db.prepare('SELECT student_id FROM parent_children WHERE parent_id = ?').all(parentId).map(r => r.student_id)); }

// ───────── 1日1回・10分の訪問と、毎日来た🔥 ─────────
function startVisit(userId, nowMs = Date.now()) {
  const day = G.jst(new Date(nowMs)).day;
  const r = db.prepare('SELECT started_at FROM parent_visits WHERE user_id = ? AND day = ?').get(userId, day);
  if (r) {
    const left = r.started_at + VISIT_MS - nowMs;
    if (left <= 0) return { error: '今日の訪問はおわりました。また明日お待ちしています（1日1回・10分）' };
    return { startedAt: r.started_at, endsAt: r.started_at + VISIT_MS, again: true };
  }
  db.prepare('INSERT INTO parent_visits (user_id, day, started_at) VALUES (?, ?, ?)').run(userId, day, nowMs);
  return { startedAt: nowMs, endsAt: nowMs + VISIT_MS, again: false };
}
// 保護者会：オーナーがオンにした日だけ（日がかわると自動でオフ）。保護者も中学生と同じルールで全部の教室へ
// 保護者会の予定 { day:'YYYY-MM-DD', start:'19:00', end:'20:00' }（日本時間）。その時間だけ保護者は全部の教室へ、生徒は入室できない
const RE_HM = /^([01]\d|2[0-3]):[0-5]\d$/;
function getMeeting(nowMs = Date.now()) {
  let m = null;
  try { m = JSON.parse(getSetting('parent_meeting', 'null')); } catch (e) { m = null; }
  if (!m || typeof m !== 'object' || !G.RE_DAY.test(m.day || '') || !RE_HM.test(m.start || '') || !RE_HM.test(m.end || '')) return null;
  if (m.day < G.jst(new Date(nowMs)).day) return null; // 終わった日の予定は消えたことにする
  return m;
}
function meetingPhase(nowMs = Date.now()) {
  const m = getMeeting(nowMs), t = G.jst(new Date(nowMs));
  if (!m || m.day !== t.day) return null;
  if (t.hm >= m.start && t.hm < m.end) return 'on';
  const soon = new Date(`${m.day}T${m.start}:00+09:00`).getTime() - 5 * 60000;
  if (nowMs >= soon && t.hm < m.start) return 'soon';
  return null;
}
function meetingOn(nowMs = Date.now()) { return meetingPhase(nowMs) === 'on'; }
function setMeeting(v, actorId) {
  const old = getMeeting();
  if (!v) {
    // 始まる前に取り消したら、その日は🔥を守る日からも外す
    if (old && !meetingOn() && (old.day > G.jst().day || G.jst().hm < old.start)) G.removeMeetingDay(old.day);
    setSetting('parent_meeting', 'null');
    if (actorId) audit(actorId, 'parent.meeting_off', null, null);
    return { ok: true, meeting: null };
  }
  const day = String(v.day || ''), start = String(v.start || ''), end = String(v.end || '');
  if (!G.RE_DAY.test(day) || day < G.jst().day) return { error: '日にちは今日より後にしてください' };
  if (!RE_HM.test(start) || !RE_HM.test(end) || start >= end) return { error: '時刻は「はじまり」より「おわり」をあとにしてください' };
  if (old && old.day !== day) G.removeMeetingDay(old.day);
  setSetting('parent_meeting', JSON.stringify({ day, start, end }));
  G.addMeetingDay(day);
  if (actorId) audit(actorId, 'parent.meeting_on', null, { day, start, end });
  return { ok: true, meeting: { day, start, end } };
}
// 保護者会を今すぐおわる（その日の🔥を守る日はそのまま）
function endMeetingNow(actorId) {
  const m = getMeeting();
  if (!m) return;
  const t = G.jst();
  if (m.day === t.day && t.hm >= m.start) setSetting('parent_meeting', JSON.stringify({ ...m, end: t.hm > m.start ? t.hm : m.start }));
  else return setMeeting(null, actorId);
  if (actorId) audit(actorId, 'parent.meeting_off', null, null);
}

// ───────── 面談ブース：オーナーが許可した保護者・生徒だけ（許可はその日だけ） ─────────
db.exec(`CREATE TABLE IF NOT EXISTS mendan_allow (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, day))`);
function mendanAllowed(userId, nowMs = Date.now()) {
  return !!db.prepare('SELECT 1 FROM mendan_allow WHERE user_id = ? AND day = ?').get(userId, G.jst(new Date(nowMs)).day);
}
function allowMendan(userId, on, actorId) {
  const u = db.prepare("SELECT id, role FROM users WHERE id = ? AND role IN ('student', 'parent')").get(userId);
  if (!u) return { error: '生徒か保護者をえらんでください' };
  const day = G.jst().day;
  if (on) db.prepare('INSERT OR IGNORE INTO mendan_allow (user_id, day, created_at) VALUES (?, ?, ?)').run(userId, day, now());
  else db.prepare('DELETE FROM mendan_allow WHERE user_id = ? AND day = ?').run(userId, day);
  if (actorId) audit(actorId, on ? 'mendan.allowed' : 'mendan.removed', String(userId), null);
  return { ok: true };
}
function mendanList() {
  return db.prepare(`SELECT u.id, u.display_name AS name, u.role, u.grade FROM mendan_allow m JOIN users u ON u.id = m.user_id WHERE m.day = ? ORDER BY u.role, u.display_name`).all(G.jst().day)
    .map(r => ({ ...r, children: r.role === 'parent' ? childrenOf(r.id).map(k => k.name) : [] }));
}
// 保護者会の日：来たことだけ記録する（10分・1日1回の制限はなし）
function recordVisit(userId, nowMs = Date.now()) {
  db.prepare('INSERT OR IGNORE INTO parent_visits (user_id, day, started_at) VALUES (?, ?, ?)').run(userId, G.jst(new Date(nowMs)).day, nowMs);
}
// オーナー用：その日に来た保護者
function visitsOn(day) {
  return db.prepare(`SELECT v.user_id AS id, v.started_at AS startedAt, u.display_name AS name, u.login_id AS loginId FROM parent_visits v JOIN users u ON u.id = v.user_id
    WHERE v.day = ? ORDER BY v.started_at`).all(day).map(r => ({ ...r, children: childrenOf(r.id).map(k => k.name) }));
}
function visitEndsAt(userId, nowMs = Date.now()) {
  const r = db.prepare('SELECT started_at FROM parent_visits WHERE user_id = ? AND day = ?').get(userId, G.jst(new Date(nowMs)).day);
  return r ? r.started_at + VISIT_MS : null;
}
// 連続して毎日来た日数（今日まだでも、昨日まで続いていれば数える）
function visitStreak(userId, date = new Date()) {
  const days = new Set(db.prepare('SELECT day FROM parent_visits WHERE user_id = ?').all(userId).map(r => r.day));
  let d = G.jst(date).day;
  if (!days.has(d)) d = G.addDays(d, -1);
  let n = 0;
  while (days.has(d) && n < 1000) { n++; d = G.addDays(d, -1); }
  return n;
}

// ───────── 毎日5問（教科は日替わり） ─────────
function subjectOf(date = new Date()) {
  const day = G.jst(date).day;
  const n = Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8)) / 86400000);
  return SUBJECTS[n % SUBJECTS.length];
}
// その教科の問題（漢字は漢字テストの問題を使う）
function pool(subject) {
  if (subject === '漢字') {
    return db.prepare("SELECT id, word, answer, wrong1, wrong2, wrong3 FROM quiz_questions WHERE active = 1 AND level IN ('4級', '3級', '準2級')").all()
      .map(q => ({ qid: 'k:' + q.id, question: `「${q.word}」の読み方は？`, answer: q.answer, wrong: [q.wrong1, q.wrong2, q.wrong3] }));
  }
  return db.prepare('SELECT id, question, answer, wrong FROM parent_questions WHERE active = 1 AND subject = ?').all(subject)
    .map(q => ({ qid: 'p:' + q.id, question: q.question, answer: q.answer, wrong: JSON.parse(q.wrong) }));
}
// 日と人で決まる、ばらばらの順番（同じ日に何度開いても同じ5問）
function seeded(seed) { let h = crypto.createHash('sha256').update(seed).digest(); let i = 0; return () => { if (i + 4 > h.length) { h = crypto.createHash('sha256').update(h).digest(); i = 0; } const v = h.readUInt32BE(i); i += 4; return v / 0x100000000; }; }
function todayQuiz(userId, date = new Date()) {
  const day = G.jst(date).day, subject = subjectOf(date);
  const all = pool(subject);
  // 最近出した問題はなるべく出さない
  const recent = new Set(db.prepare('SELECT qid FROM parent_quiz WHERE user_id = ? AND day < ? AND day >= ?').all(userId, day, G.addDays(day, -60)).map(r => r.qid));
  const rnd = seeded(`${userId}:${day}`);
  const order = all.map(q => ({ q, k: (recent.has(q.qid) ? 1 : 0) + rnd() })).sort((a, b) => a.k - b.k).map(x => x.q).slice(0, PER_DAY);
  const done = new Map(db.prepare('SELECT qid, correct FROM parent_quiz WHERE user_id = ? AND day = ?').all(userId, day).map(r => [r.qid, !!r.correct]));
  return {
    day, subject, total: order.length,
    questions: order.map(q => {
      const choices = [q.answer, ...q.wrong].map(c => ({ c, k: rnd() })).sort((a, b) => a.k - b.k).map(x => x.c);
      return { qid: q.qid, question: q.question, choices, done: done.has(q.qid), correct: done.has(q.qid) ? done.get(q.qid) : null };
    }),
  };
}
function answerQuiz(userId, qid, choice, date = new Date()) {
  const quiz = todayQuiz(userId, date);
  const q = quiz.questions.find(x => x.qid === qid);
  if (!q) return { error: '今日の問題ではありません' };
  if (q.done) return { error: 'この問題はもう答えました' };
  const src = pool(quiz.subject).find(x => x.qid === qid);
  const correct = String(choice) === src.answer;
  db.prepare('INSERT INTO parent_quiz (user_id, day, qid, correct, answered_at) VALUES (?, ?, ?, ?, ?)').run(userId, quiz.day, qid, correct ? 1 : 0, now());
  return { correct, answer: src.answer };
}
function quizPoints(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM parent_quiz WHERE user_id = ? AND correct = 1').get(userId).n;
}
// 問題の管理（オーナー）
function addQuestions(rows) {
  const out = { added: 0, skipped: 0, errors: [] };
  const exists = db.prepare('SELECT 1 FROM parent_questions WHERE subject = ? AND question = ?');
  const ins = db.prepare('INSERT INTO parent_questions (subject, question, answer, wrong, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const r of rows || []) {
    const subject = String(r.subject || '').trim(), question = String(r.question || '').trim().slice(0, 120), answer = String(r.answer || '').trim().slice(0, 40);
    const wrong = (Array.isArray(r.wrong) ? r.wrong : []).map(w => String(w || '').trim().slice(0, 40));
    if (!SUBJECTS.includes(subject) || subject === '漢字') { out.errors.push({ line: r.line, error: '教科は 英単語・数学・理科・社会 のどれかです' }); continue; }
    if (!question || !answer || wrong.length !== 3 || wrong.some(w => !w) || new Set([answer, ...wrong]).size !== 4) { out.errors.push({ line: r.line, error: '問題・正解・まちがい3つ（すべてちがうもの）を入れてください' }); continue; }
    if (exists.get(subject, question)) { out.skipped++; continue; }
    ins.run(subject, question, answer, JSON.stringify(wrong), now()); out.added++;
  }
  return out;
}
function listQuestions() {
  return db.prepare('SELECT id, subject, question, answer, wrong, active FROM parent_questions ORDER BY subject, id').all().map(q => ({ ...q, wrong: JSON.parse(q.wrong), active: !!q.active }));
}
function deleteQuestion(id) { return db.prepare('DELETE FROM parent_questions WHERE id = ?').run(id).changes > 0; }
// はじめての起動で、最初の問題を入れる
(function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM parent_questions').get().n) return;
  const rows = require('./parent_questions.json');
  addQuestions(rows.map((r, i) => ({ line: i + 1, subject: r[0], question: r[1], answer: r[2], wrong: [r[3], r[4], r[5]] })));
})();

// ───────── 見たよスタンプ・家族の木 ─────────
function sendCheer(parentId, studentId, stamp, date = new Date()) {
  if (!childIds(parentId).has(studentId)) return { error: '自分のお子さんにだけ送れます' };
  if (!STAMPS.includes(stamp)) return { error: 'スタンプをえらんでください' };
  const day = G.jst(date).day;
  const r = db.prepare('INSERT OR IGNORE INTO parent_cheers (parent_id, student_id, day, stamp, created_at) VALUES (?, ?, ?, ?, ?)').run(parentId, studentId, day, stamp, now());
  if (!r.changes) return { error: '今日はもう送りました（1日1回）' };
  return { ok: true };
}
function cheersSentToday(parentId, date = new Date()) {
  return new Set(db.prepare('SELECT student_id FROM parent_cheers WHERE parent_id = ? AND day = ?').all(parentId, G.jst(date).day).map(r => r.student_id));
}
// 子どもがまだ受け取っていないスタンプ（受け取ったことにする）
function takeCheers(studentId) {
  const rows = db.prepare('SELECT id, stamp FROM parent_cheers WHERE student_id = ? AND delivered = 0 ORDER BY id').all(studentId);
  if (rows.length) db.prepare(`UPDATE parent_cheers SET delivered = 1 WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map(r => r.id));
  return rows.map(r => r.stamp);
}
const MOM_STAGES = [0, 5, 15, 30, 60, 100]; // 花の数で育つ（年度ごと）
function momsTree(date = new Date()) {
  const c = G.getConfig(), t = G.jst(date);
  const flowers = db.prepare('SELECT COUNT(*) AS n FROM parent_cheers WHERE day >= ?').get(c.yearStart).n;
  const month = t.day.slice(0, 7);
  const families = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM parent_visits WHERE day >= ? AND day <= ?").get(`${month}-01`, `${month}-31`).n;
  let stage = 0;
  for (let i = 0; i < MOM_STAGES.length; i++) if (flowers >= MOM_STAGES[i]) stage = i;
  return { name: '家族の木', tulips: require('./referral').tulips(), flowers, families, stage, stageName: G.STAGE_NAMES[stage], nextFlowers: MOM_STAGES[stage + 1] ?? null };
}

module.exports = {
  VISIT_MS, SUBJECTS, STAMPS, createInvite, inviteStudent, useInvite, childrenOf, parentsOf, unlink, childIds, normCode,
  startVisit, visitEndsAt, meetingOn, meetingPhase, getMeeting, setMeeting, endMeetingNow, mendanAllowed, allowMendan, mendanList, recordVisit, visitsOn, visitStreak, subjectOf, todayQuiz, answerQuiz, quizPoints, addQuestions, listQuestions, deleteQuestion,
  sendCheer, cheersSentToday, takeCheers, momsTree,
};
