// 📋 テスト対策：定期テストの5週間前から前日までの「いつ・何をやるか」と、先生がつける✅
// - 中学生だけ。テストの日は「学校×学年×テスト」で先生が入れる（入っていなければ、生徒が成績の画面で入れた日）
// - スケジュールのひな形は1つ（先生が「5週間前｜数学｜計算トレーニングを解く」の形で書きかえる）
// - ✅をつけるのは先生・オーナーだけ。生徒・保護者は見るだけ
// - スピーキング・ライティングの課題は、音読の単元と同じ名前なら、テスト教室で合格すると自動で✅（先生があとで外せる）
const { db, now, audit, getSetting, setSetting } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS prep_school_tests (
  school TEXT NOT NULL, grade TEXT NOT NULL, term TEXT NOT NULL,
  start_day TEXT NOT NULL, end_day TEXT,
  speaking TEXT NOT NULL DEFAULT '[]', writing TEXT NOT NULL DEFAULT '[]', ranges TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (school, grade, term)
);
-- ✅（state 1＝やった・0＝先生が外した）。テストの初日もキーに入れる（次の年のテストに引きつがない）
CREATE TABLE IF NOT EXISTS prep_checks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, grade TEXT NOT NULL, term TEXT NOT NULL, start_day TEXT NOT NULL,
  item TEXT NOT NULL, state INTEGER NOT NULL, by_user INTEGER, at TEXT NOT NULL,
  PRIMARY KEY (user_id, grade, term, start_day, item)
);
`);

const GRADES = ['中1', '中2', '中3'];
const TERMS = ['1mid', '1end', '2mid', '2end', 'final'];
const TERM_NAME = { '1mid': '1学期中間', '1end': '1学期期末', '2mid': '2学期中間', '2end': '2学期期末', final: '学年末' };
const RE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, '').trim().slice(0, n);
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400e3);
const dayStr = (n) => new Date(n * 86400e3).toISOString().slice(0, 10);
const isStaff = (u) => u && (u.role === 'owner' || u.role === 'teacher');

// ───────── ひな形 ─────────
const DEFAULT_TEMPLATE = `5週間前｜数学｜計算トレーニングを解く
5週間前｜英語｜スピーキング・ライティングを終わらせる
4週間前｜数学｜計算トレーニングを提出し、直し
4週間前｜数学｜新ワークを解く
4週間前｜英語｜新ワークを解く
3週間前｜数学｜新ワークの直し
3週間前｜英語｜新ワークの直し
2週間前｜数学｜新ワークの直し
2週間前｜数学｜裏テスト
2週間前｜英語｜新ワークの直し
2週間前｜英語｜裏テスト
1週間前｜数学｜クリアテスト
1週間前｜英語｜クリアテスト
前日｜数学｜サポートテスト
前日｜英語｜サポートテスト`;
const toHalf = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
/** 「○週間前」「○日前」「前日」→ 何日前か */
function offsetOf(when) {
  const w = toHalf(when).replace(/\s/g, '');
  if (w === '前日') return 1;
  let m = w.match(/^(\d{1,2})週間?前$/); if (m) return Number(m[1]) * 7;
  m = w.match(/^(\d{1,3})日前$/); if (m) return Number(m[1]);
  return null;
}
/** ひな形の文 → 行（エラーがあれば行番号つきで返す） */
function parseTemplate(text) {
  const items = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cols = line.split(/[｜|\t]/).map(x => x.trim());
    if (cols.length < 3 || !cols[2]) { errors.push(`${i + 1}行目：「いつ｜教科｜やること」の形にしてください`); return; }
    const days = offsetOf(cols[0]);
    if (!days || days > 120) { errors.push(`${i + 1}行目：「いつ」は「5週間前」「10日前」「前日」のように書いてください`); return; }
    const when = clean(cols[0], 10), subject = clean(cols[1], 10), task = clean(cols.slice(2).join(' '), 60);
    items.push({ key: `${when}|${subject}|${task}`, when, days, subject, task });
  });
  if (items.length > 80) errors.push('行は80行までです');
  return { items, errors };
}
const templateText = () => getSetting('prep_template', DEFAULT_TEMPLATE);
function setTemplate(text, actorId) {
  const p = parseTemplate(text);
  if (p.errors.length) return { error: p.errors.slice(0, 3).join(' / ') };
  if (!p.items.length) return { error: '1行以上入れてください' };
  setSetting('prep_template', String(text).trim());
  audit(actorId, 'prep.template', null, { items: p.items.length });
  return { ok: true, items: p.items };
}

// ───────── 学校×学年×テスト ─────────
/** スピーキング・ライティングの課題の文 → Unit の一覧（改行・「、」・「,」・スペース2つで区切る） */
function parseUnits(text) {
  if (Array.isArray(text)) text = text.join('\n');
  const out = [];
  for (const u of String(text || '').split(/\r?\n|[、,，]|\s{2,}|　/)) { const v = clean(u, 30); if (v && !out.includes(v)) out.push(v); }
  return out.slice(0, 20);
}
function schoolTests() {
  return db.prepare('SELECT * FROM prep_school_tests ORDER BY school, grade, start_day').all().map(viewSchoolTest);
}
function viewSchoolTest(r) {
  return { school: r.school, grade: r.grade, term: r.term, termName: TERM_NAME[r.term], start: r.start_day, end: r.end_day, speaking: JSON.parse(r.speaking), writing: JSON.parse(r.writing), ranges: JSON.parse(r.ranges) };
}
function setSchoolTest(b, actorId) {
  const school = clean(b.school, 30).replace(/\s+/g, ' ');
  if (!school) return { error: '学校名を入れてください' };
  if (!GRADES.includes(b.grade)) return { error: '学年をえらんでください（中1〜中3）' };
  if (!TERMS.includes(b.term)) return { error: 'どのテストかえらんでください' };
  if (!b.start) { db.prepare('DELETE FROM prep_school_tests WHERE school = ? AND grade = ? AND term = ?').run(school, b.grade, b.term); audit(actorId, 'prep.school_test_deleted', school, { grade: b.grade, term: b.term }); return { ok: true }; }
  if (!RE_DAY.test(b.start) || (b.end && !RE_DAY.test(b.end))) return { error: '日付が正しくありません' };
  const end = b.end && b.end !== b.start ? b.end : null;
  if (end && end < b.start) return { error: '最後の日は、初日より後にしてください' };
  const ranges = {};
  for (const [k, v] of Object.entries(b.ranges || {}).slice(0, 10)) { const kk = clean(k, 10), vv = clean(v, 80); if (kk && vv) ranges[kk] = vv; }
  db.prepare(`INSERT INTO prep_school_tests (school, grade, term, start_day, end_day, speaking, writing, ranges, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (school, grade, term) DO UPDATE SET start_day = excluded.start_day, end_day = excluded.end_day, speaking = excluded.speaking, writing = excluded.writing, ranges = excluded.ranges, updated_at = excluded.updated_at`)
    .run(school, b.grade, b.term, b.start, end, JSON.stringify(parseUnits(b.speaking)), JSON.stringify(parseUnits(b.writing)), JSON.stringify(ranges), now());
  audit(actorId, 'prep.school_test', school, { grade: b.grade, term: b.term });
  return { ok: true };
}

// ───────── その生徒のテストの日 ─────────
/**
 * 学校の日程（先生が入れた）を先に使い、ないテストだけ生徒が入れた日を使う
 * @returns [{ grade, term, termName, start, end, source:'juku'|'self', st? }]
 */
function datesFor(user) {
  const u = typeof user === 'object' ? user : db.prepare('SELECT id, grade, school FROM users WHERE id = ?').get(user);
  if (!u) return [];
  const school = u.school || (db.prepare('SELECT school FROM users WHERE id = ?').get(u.id) || {}).school;
  const juku = school ? db.prepare('SELECT * FROM prep_school_tests WHERE school = ?').all(school).map(viewSchoolTest) : [];
  const out = juku.map(t => ({ grade: t.grade, term: t.term, termName: t.termName, start: t.start, end: t.end, source: 'juku', st: t }));
  const has = new Set(out.map(d => d.grade + '|' + d.term));
  for (const r of db.prepare('SELECT grade, term, start_day AS start, end_day AS end FROM score_test_dates WHERE user_id = ?').all(u.id)) {
    if (!has.has(r.grade + '|' + r.term)) out.push({ ...r, termName: TERM_NAME[r.term], source: 'self' });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
const jukuHas = (user, grade, term) => !!(user.school && db.prepare('SELECT 1 FROM prep_school_tests WHERE school = ? AND grade = ? AND term = ?').get(user.school, grade, term));

// ───────── スケジュール ─────────
/** 段階（同じ「いつ」）ごとの期間：その段階の開始日〜次の段階の開始日の前日 */
function stagesOf(items, startDay) {
  const t0 = dayNum(startDay);
  const offs = [...new Set(items.map(i => i.days))].sort((a, b) => b - a);
  return offs.map((d, i) => {
    const s = t0 - d, e = i + 1 < offs.length ? t0 - offs[i + 1] - 1 : t0 - 1;
    return { days: d, when: items.find(x => x.days === d).when, start: dayStr(s), end: dayStr(Math.max(s, e)), items: items.filter(x => x.days === d) };
  });
}
// テスト教室の合格（スピーキング：本番テスト、ライティング：ライティングテスト）
function autoPass(userId, kind, unitName) {
  const u = db.prepare('SELECT id FROM reading_units WHERE title = ? AND active = 1 ORDER BY id DESC').all(unitName).map(r => r.id);
  if (!u.length) return null;
  const q = u.map(() => '?').join(',');
  const r = kind === 'speaking'
    ? db.prepare(`SELECT score, created_at FROM reading_tests WHERE user_id = ? AND passed = 1 AND unit_id IN (${q}) ORDER BY id LIMIT 1`).get(userId, ...u)
    : db.prepare(`SELECT score, created_at FROM writing_attempts WHERE user_id = ? AND mode = 'test' AND passed = 1 AND unit_id IN (${q}) ORDER BY id LIMIT 1`).get(userId, ...u);
  return r ? { score: r.score, at: r.created_at } : { linked: true };
}
// スピーキング・ライティングの✅（先生の✅がなければ、テスト教室の合格で自動）
function swStates(userId, st, checks, deadline, t) {
  const sw = { deadline, speaking: [], writing: [] };
  for (const kind of ['speaking', 'writing']) {
    for (const name of st[kind]) {
      const key = `sw:${kind}:${name}`, c = checks.get(key), auto = autoPass(userId, kind, name);
      const done = c ? !!c.state : !!(auto && auto.at);
      sw[kind].push({ key, name, done, by: c ? 'teacher' : auto && auto.at ? 'app' : null, auto: auto && auto.at ? auto : null, linked: !!auto, late: !done && t > dayNum(deadline) });
    }
  }
  return sw;
}
/** 管理画面：その学校・学年・テストの生徒ごとの Unit チェック表 */
function swTable(school, grade, term, today) {
  const r = db.prepare('SELECT * FROM prep_school_tests WHERE school = ? AND grade = ? AND term = ?').get(school, grade, term);
  if (!r) return null;
  const st = viewSchoolTest(r), { items } = parseTemplate(templateText());
  const maxDays = Math.max(...items.map(i => i.days), 0), stages = stagesOf(items, st.start);
  const deadline = stages[0] ? stages[0].end : dayStr(dayNum(st.start) - 1 - 0);
  const students = db.prepare("SELECT id, display_name AS name FROM users WHERE role = 'student' AND is_active = 1 AND school = ? AND grade = ? ORDER BY display_name").all(school, grade);
  return {
    test: st, deadline, maxDays,
    students: students.map(s => {
      const checks = new Map(db.prepare('SELECT item, state, by_user, at FROM prep_checks WHERE user_id = ? AND grade = ? AND term = ? AND start_day = ?').all(s.id, grade, term, st.start).map(x => [x.item, x]));
      return { ...s, ...swStates(s.id, st, checks, deadline, dayNum(today)) };
    }),
  };
}
/** 今の（次の）テストを1つえらぶ：5週間前（ひな形のいちばん早い日）からテストの最後の日まで */
function currentTest(dates, today, maxDays) {
  const t = dayNum(today);
  for (const d of dates) {
    const s = dayNum(d.start), e = dayNum(d.end || d.start);
    if (t <= e && t >= s - maxDays) return { ...d, active: true };
  }
  const next = dates.find(d => dayNum(d.start) > dayNum(today));
  return next ? { ...next, active: false } : null;
}
/**
 * 生徒1人のテスト対策（今のテスト）
 * @returns {{ test, stages, sw, counts:{ total, done, late }, ... }}
 */
function scheduleFor(userId, today) {
  const u = db.prepare('SELECT id, display_name AS name, grade, school, role, trial_until FROM users WHERE id = ?').get(userId);
  if (!u || u.role !== 'student') return null;
  const base = { student: { id: u.id, name: u.name, grade: u.grade, school: u.school }, today };
  if (!GRADES.includes(u.grade)) return { ...base, notTarget: true };
  const { items } = parseTemplate(templateText());
  const maxDays = Math.max(...items.map(i => i.days), 0);
  const dates = datesFor(u).filter(d => d.grade === u.grade);
  const test = currentTest(dates, today, maxDays);
  if (!test) return { ...base, test: null, needDate: !u.school || !dates.some(d => d.source === 'juku') };
  const checks = new Map(db.prepare('SELECT item, state, by_user, at FROM prep_checks WHERE user_id = ? AND grade = ? AND term = ? AND start_day = ?').all(u.id, test.grade, test.term, test.start).map(r => [r.item, r]));
  const t = dayNum(today);
  const stateOf = (start, end, done) => done ? 'done' : t > dayNum(end) ? 'late' : t >= dayNum(start) ? 'now' : 'future';
  const ranges = test.st ? test.st.ranges : {};
  const stages = stagesOf(items, test.start).map(sg => {
    const its = sg.items.map(it => {
      const c = checks.get(it.key), done = !!(c && c.state);
      const range = /ワーク/.test(it.task) && ranges[it.subject] ? ranges[it.subject] : null;
      return { key: it.key, subject: it.subject, task: it.task, range, done, at: done ? c.at : null, status: stateOf(sg.start, sg.end, done) };
    });
    return { when: sg.when, days: sg.days, start: sg.start, end: sg.end, now: t >= dayNum(sg.start) && t <= dayNum(sg.end), past: t > dayNum(sg.end), items: its };
  });
  // スピーキング・ライティング（締め切りは、いちばん早い段階の最後の日）
  const first = stages[0];
  const deadline = first ? first.end : dayStr(dayNum(test.start) - 1);
  const sw = test.st ? swStates(u.id, test.st, checks, deadline, t) : { deadline, speaking: [], writing: [] };
  const all = [...stages.flatMap(s => s.items), ...sw.speaking, ...sw.writing];
  const counts = { total: all.length, done: all.filter(x => x.done).length, late: stages.flatMap(s => s.items).filter(x => x.status === 'late').length + [...sw.speaking, ...sw.writing].filter(x => x.late).length };
  return {
    ...base,
    test: { grade: test.grade, term: test.term, termName: test.termName, start: test.start, end: test.end, source: test.source, active: test.active, daysLeft: dayNum(test.start) - t, ranges },
    stages: test.active ? stages : [], sw: test.active ? sw : { deadline, speaking: [], writing: [] }, counts: test.active ? counts : { total: 0, done: 0, late: 0 },
  };
}
/** 先生が✅をつける・外す（state：true / false / null＝自動にもどす） */
function setCheck(actor, b) {
  if (!isStaff(actor)) return { error: '✅は先生がつけます', code: 403 };
  const u = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").get(Number(b.userId));
  if (!u) return { error: '生徒が見つかりません', code: 404 };
  if (!GRADES.includes(b.grade) || !TERMS.includes(b.term) || !RE_DAY.test(b.start || '') || !b.item) return { error: '内容が正しくありません' };
  const item = clean(b.item, 120);
  if (b.state === null) db.prepare('DELETE FROM prep_checks WHERE user_id = ? AND grade = ? AND term = ? AND start_day = ? AND item = ?').run(u.id, b.grade, b.term, b.start, item);
  else db.prepare(`INSERT INTO prep_checks (user_id, grade, term, start_day, item, state, by_user, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, grade, term, start_day, item) DO UPDATE SET state = excluded.state, by_user = excluded.by_user, at = excluded.at`).run(u.id, b.grade, b.term, b.start, item, b.state ? 1 : 0, actor.id, now());
  return { ok: true };
}
/** 管理画面：中学生ぜんいんの、今のテストの進み具合 */
function overview(today) {
  return db.prepare(`SELECT id FROM users WHERE role = 'student' AND is_active = 1 AND trial_until IS NULL AND grade IN ('中1', '中2', '中3') ORDER BY grade, display_name`).all()
    .map(r => scheduleFor(r.id, today)).filter(Boolean)
    .map(s => ({ ...s.student, test: s.test, counts: s.counts || { total: 0, done: 0, late: 0 } }));
}
module.exports = { swTable, DEFAULT_TEMPLATE, GRADES, TERMS, TERM_NAME, parseTemplate, parseUnits, templateText, setTemplate, schoolTests, setSchoolTest, datesFor, jukuHas, stagesOf, scheduleFor, setCheck, overview };
