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
-- 学校ごとの定期テストの日（全学年共通）。学年ごとにちがうときは prep_school_tests の日付が優先
CREATE TABLE IF NOT EXISTS school_test_dates (school TEXT NOT NULL, term TEXT NOT NULL, start_day TEXT NOT NULL, end_day TEXT, PRIMARY KEY (school, term));
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
  return db.prepare('SELECT * FROM prep_school_tests ORDER BY school, grade, term').all().map(viewSchoolTest).map(t => { if (!t.start) { const sd = schoolDate(t.school, t.term); if (sd) Object.assign(t, sd, { fromSchool: true }); } return t; });
}
function viewSchoolTest(r) {
  return { school: r.school, grade: r.grade, term: r.term, termName: TERM_NAME[r.term], start: r.start_day, end: r.end_day, speaking: JSON.parse(r.speaking), writing: JSON.parse(r.writing), ranges: JSON.parse(r.ranges) };
}
function setSchoolTest(b, actorId) {
  const school = clean(b.school, 30).replace(/\s+/g, ' ');
  if (!school) return { error: '学校名を入れてください' };
  if (!GRADES.includes(b.grade)) return { error: '学年をえらんでください（中1〜中3）' };
  if (!TERMS.includes(b.term)) return { error: 'どのテストかえらんでください' };
  const hasContent = parseUnits(b.speaking).length || parseUnits(b.writing).length || Object.values(b.ranges || {}).some(v => clean(v, 80));
  if (b.remove || (!b.start && !hasContent)) { db.prepare('DELETE FROM prep_school_tests WHERE school = ? AND grade = ? AND term = ?').run(school, b.grade, b.term); audit(actorId, 'prep.school_test_deleted', school, { grade: b.grade, term: b.term }); return { ok: true }; }
  if (!b.start && !schoolDate(school, b.term)) return { error: 'テスト初日を入れてください（学校の日程がまだありません。「🏫 教室の設定」の学校名で入れられます）' };
  if ((b.start && !RE_DAY.test(b.start)) || (b.end && !RE_DAY.test(b.end))) return { error: '日付が正しくありません' };
  const end = b.start && b.end && b.end !== b.start ? b.end : null;
  if (end && end < b.start) return { error: '最後の日は、初日より後にしてください' };
  b.start = b.start || ''; // 空＝学校の日程を使う
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
const schoolDate = (school, term) => db.prepare('SELECT start_day AS start, end_day AS end FROM school_test_dates WHERE school = ? AND term = ?').get(school, term) || null;
/** その学校・学年・テストの日程（学年の日付 → なければ学校の日付）と、学年ごとの Unit・範囲 */
function effective(school, grade, term) {
  const r = db.prepare('SELECT * FROM prep_school_tests WHERE school = ? AND grade = ? AND term = ?').get(school, grade, term);
  const st = r ? viewSchoolTest(r) : { school, grade, term, termName: TERM_NAME[term], start: '', end: null, speaking: [], writing: [], ranges: {} };
  if (!st.start) { const sd = schoolDate(school, term); if (!sd) return null; st.start = sd.start; st.end = sd.end; st.fromSchool = true; }
  return st;
}
function datesFor(user) {
  const u = typeof user === 'object' ? user : db.prepare('SELECT id, grade, school FROM users WHERE id = ?').get(user);
  if (!u) return [];
  const row = db.prepare('SELECT grade, school FROM users WHERE id = ?').get(u.id) || {};
  const school = u.school || row.school, grade = u.grade || row.grade;
  const out = [];
  if (school && GRADES.includes(grade)) for (const term of TERMS) { const t = effective(school, grade, term); if (t) out.push({ grade, term, termName: t.termName, start: t.start, end: t.end, source: 'juku', st: t }); }
  const has = new Set(out.map(d => d.grade + '|' + d.term));
  for (const r of db.prepare('SELECT grade, term, start_day AS start, end_day AS end FROM score_test_dates WHERE user_id = ?').all(u.id)) {
    if (!has.has(r.grade + '|' + r.term)) out.push({ ...r, termName: TERM_NAME[r.term], source: 'self' });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
const jukuHas = (user, grade, term) => !!(user.school && GRADES.includes(grade) && effective(user.school, grade, term));

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
  const st = effective(school, grade, term);
  if (!st) return null;
  const { items } = parseTemplate(templateText());
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
// ───────── 学校名の一覧（教室の設定で作る。ユーザーの編集でプルダウンに出る） ─────────
const normSchool = (s) => clean(s, 30).replace(/\s+/g, ' ');
function schoolList() {
  let list = null; try { list = JSON.parse(getSetting('schools', 'null')); } catch (e) { list = null; }
  if (!Array.isArray(list)) { // はじめて：生徒に入っている学校名・日程の学校名から作る
    list = [...new Set([...db.prepare("SELECT DISTINCT school AS s FROM users WHERE school IS NOT NULL").all(), ...db.prepare('SELECT DISTINCT school AS s FROM prep_school_tests').all()].map(r => r.s))].sort();
  }
  const count = new Map(db.prepare("SELECT school, COUNT(*) AS n FROM users WHERE role = 'student' AND is_active = 1 AND school IS NOT NULL GROUP BY school").all().map(r => [r.school, r.n]));
  const dates = new Map();
  for (const r of db.prepare('SELECT school, term, start_day AS start, end_day AS end FROM school_test_dates').all()) { if (!dates.has(r.school)) dates.set(r.school, {}); dates.get(r.school)[r.term] = { start: r.start, end: r.end }; }
  const tbs = schoolTextbooks();
  return list.map(name => ({ name, students: count.get(name) || 0, dates: dates.get(name) || {}, textbook: tbs[name] || null }));
}
function addSchool(name, actorId) {
  const n = normSchool(name); if (!n) return { error: '学校名を入れてください' };
  const list = schoolList().map(s => s.name);
  if (list.includes(n)) return { error: `「${n}」はもうあります` };
  if (list.length >= 200) return { error: '学校は200校までです' };
  setSetting('schools', JSON.stringify([...list, n].sort((a, b) => a.localeCompare(b, 'ja'))));
  audit(actorId, 'school.added', n, null);
  return { ok: true };
}
/** 学校の定期テストの日（全学年共通）をまとめて入れる：{ term: { start, end } }（start が空なら消す） */
function setSchoolDates(name, dates, actorId) {
  const n = normSchool(name);
  if (!schoolList().some(s => s.name === n)) return { error: '学校が見つかりません' };
  const rows = [];
  for (const term of TERMS) {
    const d = (dates || {})[term]; if (!d) continue;
    if (!d.start) { rows.push([term, null, null]); continue; }
    if (!RE_DAY.test(d.start) || (d.end && !RE_DAY.test(d.end))) return { error: `${TERM_NAME[term]}：日付が正しくありません` };
    const end = d.end && d.end !== d.start ? d.end : null;
    if (end && end < d.start) return { error: `${TERM_NAME[term]}：最後の日は、初日より後にしてください` };
    rows.push([term, d.start, end]);
  }
  for (const [term, st, en] of rows) {
    if (!st) db.prepare('DELETE FROM school_test_dates WHERE school = ? AND term = ?').run(n, term);
    else db.prepare('INSERT INTO school_test_dates (school, term, start_day, end_day) VALUES (?, ?, ?, ?) ON CONFLICT (school, term) DO UPDATE SET start_day = excluded.start_day, end_day = excluded.end_day').run(n, term, st, en);
  }
  audit(actorId, 'school.dates', n, null);
  return { ok: true };
}
/** 名前を変える：生徒の学校名・学校の日程もいっしょに変える */
function renameSchool(from, to, actorId) {
  const a = normSchool(from), b = normSchool(to);
  if (!b) return { error: '新しい学校名を入れてください' };
  const list = schoolList().map(s => s.name);
  if (!list.includes(a)) return { error: '学校が見つかりません' };
  if (a !== b && list.includes(b)) return { error: `「${b}」はもうあります` };
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET school = ? WHERE school = ?').run(b, a);
    db.prepare('UPDATE prep_school_tests SET school = ? WHERE school = ?').run(b, a);
    db.prepare('UPDATE school_test_dates SET school = ? WHERE school = ?').run(b, a);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  setSetting('schools', JSON.stringify(list.map(x => x === a ? b : x).sort((x, y) => x.localeCompare(y, 'ja'))));
  { const m = schoolTextbooks(); if (a !== b && m[a]) { m[b] = m[a]; delete m[a]; saveSchoolTextbooks(m); } }
  audit(actorId, 'school.renamed', a, { to: b });
  return { ok: true };
}
/** 一覧から消す（その学校の生徒がいるときは消せない） */
function removeSchool(name, actorId) {
  const n = normSchool(name), list = schoolList();
  const s = list.find(x => x.name === n);
  if (!s) return { error: '学校が見つかりません' };
  if (s.students) return { error: `この学校の生徒が${s.students}人います。先に生徒の学校名を変えてください` };
  setSetting('schools', JSON.stringify(list.map(x => x.name).filter(x => x !== n)));
  db.prepare('DELETE FROM school_test_dates WHERE school = ?').run(n);
  { const m = schoolTextbooks(); if (m[n]) { delete m[n]; saveSchoolTextbooks(m); } }
  audit(actorId, 'school.removed', n, null);
  return { ok: true };
}
// ───────── 📘 英語の教科書（教室の設定で一覧を持つ。学校ごとに1つ結びつける → 音読の単元をその学校の生徒に出し分ける） ─────────
const DEFAULT_TEXTBOOKS = ['ニューホライズン', 'ニュークラウン', 'サンシャイン', 'ワンワールド', 'ヒアウィーゴー', 'ブルースカイ'];
const normTb = (s) => clean(s, 30).replace(/\s+/g, ' ');
function textbookList() {
  let list = null; try { list = JSON.parse(getSetting('textbooks', 'null')); } catch (e) { list = null; }
  return Array.isArray(list) ? list : DEFAULT_TEXTBOOKS.slice();
}
function schoolTextbooks() { try { const m = JSON.parse(getSetting('school_textbooks', '{}')); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } }
const saveSchoolTextbooks = (m) => setSetting('school_textbooks', JSON.stringify(m));
/** 生徒の教科書（学校に結びつけたもの。なければ null） */
function textbookOf(user) { return (user && user.school && schoolTextbooks()[user.school]) || null; }
function addTextbook(name, actorId) {
  const n = normTb(name); if (!n) return { error: '教科書の名前を入れてください' };
  const list = textbookList();
  if (list.includes(n)) return { error: `「${n}」はもうあります` };
  if (list.length >= 30) return { error: '教科書は30までです' };
  setSetting('textbooks', JSON.stringify([...list, n]));
  audit(actorId, 'textbook.added', n, null);
  return { ok: true };
}
/** 名前を変える：単元・学校の結びつきもいっしょに変える */
function renameTextbook(from, to, actorId) {
  const a = normTb(from), b = normTb(to), list = textbookList();
  if (!b) return { error: '新しい名前を入れてください' };
  if (!list.includes(a)) return { error: '教科書が見つかりません' };
  if (a !== b && list.includes(b)) return { error: `「${b}」はもうあります` };
  db.prepare('UPDATE reading_units SET textbook = ? WHERE textbook = ?').run(b, a);
  const m = schoolTextbooks(); for (const k of Object.keys(m)) if (m[k] === a) m[k] = b; saveSchoolTextbooks(m);
  setSetting('textbooks', JSON.stringify(list.map(x => x === a ? b : x)));
  audit(actorId, 'textbook.renamed', a, { to: b });
  return { ok: true };
}
/** 一覧から消す（その教科書の単元があるときは消せない） */
function removeTextbook(name, actorId) {
  const n = normTb(name), list = textbookList();
  if (!list.includes(n)) return { error: '教科書が見つかりません' };
  const units = db.prepare('SELECT COUNT(*) AS n FROM reading_units WHERE textbook = ?').get(n).n;
  if (units) return { error: `この教科書の単元が${units}こあります。先に単元を消すか、ほかの教科書に変えてください` };
  const m = schoolTextbooks(); for (const k of Object.keys(m)) if (m[k] === n) delete m[k]; saveSchoolTextbooks(m);
  setSetting('textbooks', JSON.stringify(list.filter(x => x !== n)));
  audit(actorId, 'textbook.removed', n, null);
  return { ok: true };
}
/** 学校に教科書を結びつける（空なら外す） */
function setSchoolTextbook(name, tb, actorId) {
  const n = normSchool(name), t = tb ? normTb(tb) : '';
  if (!schoolList().some(s => s.name === n)) return { error: '学校が見つかりません' };
  if (t && !textbookList().includes(t)) return { error: '教科書が見つかりません' };
  const m = schoolTextbooks(); if (t) m[n] = t; else delete m[n]; saveSchoolTextbooks(m);
  audit(actorId, 'school.textbook', n, { textbook: t || null });
  return { ok: true };
}
module.exports = { textbookList, textbookOf, schoolTextbooks, addTextbook, renameTextbook, removeTextbook, setSchoolTextbook, setSchoolDates, effective, schoolList, addSchool, renameSchool, removeSchool, swTable, DEFAULT_TEMPLATE, GRADES, TERMS, TERM_NAME, parseTemplate, parseUnits, templateText, setTemplate, schoolTests, setSchoolTest, datesFor, jukuHas, stagesOf, scheduleFor, setCheck, overview };
