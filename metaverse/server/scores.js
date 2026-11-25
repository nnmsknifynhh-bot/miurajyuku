// 📊 成績：定期テスト・内申（通知表）・模試（本番と過去問）
// - 中学生・高校生だけ。生徒も先生も入れられる。生徒が入れたものは、先生が「確認ずみ」にできる（生徒が直すと確認はもどる）
// - 生徒は自分の成績だけ、保護者は自分の子どもの成績だけ、先生・オーナーは全員を見られる
// - ポイントはつけない
const { db, now, audit, getSetting, setSetting } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS score_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- teiki（定期テスト）/ naishin（内申）/ moshi（模試）
  grade TEXT NOT NULL,           -- そのときの学年（中1〜高3）
  term TEXT,                     -- 定期テスト：1mid/1end/2mid/2end/final ・ 内申：1/2/3（学期）
  title TEXT,                    -- 模試の名前（例：11月 県模試・2015年度 第3回）
  past INTEGER NOT NULL DEFAULT 0, -- 模試の過去問なら 1
  taken_on TEXT,                 -- 受けた日（YYYY-MM-DD）
  data TEXT NOT NULL,            -- 教科ごとの点数など（JSON）
  created_by INTEGER,
  confirmed_by INTEGER,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_score_user ON score_records(user_id, kind);
-- 定期テストの日（生徒が入れる）：カウントダウンと、入れ忘れのお知らせに使う
CREATE TABLE IF NOT EXISTS score_test_dates (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, grade TEXT NOT NULL, term TEXT NOT NULL, start_day TEXT NOT NULL, end_day TEXT, PRIMARY KEY (user_id, grade, term));
`);

const GRADES = ['中1', '中2', '中3', '高1', '高2', '高3'];
const isJH = (g) => /^中[1-3]$/.test(g || ''), isTarget = (g) => GRADES.includes(g);
const TERMS = { teiki: ['1mid', '1end', '2mid', '2end', 'final'], naishin: ['1', '2', '3'] };
const TERM_NAME = { '1mid': '1学期中間', '1end': '1学期期末', '2mid': '2学期中間', '2end': '2学期期末', final: '学年末', 1: '1学期', 2: '2学期', 3: '3学期' };
const JUDGES = ['A', 'B', 'C', 'D', 'E'];
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const RE_DAY = /^\d{4}-\d{2}-\d{2}$/;
// 数（空なら null）。範囲の外ならエラー
function num(v, min, max, label) {
  if (v === '' || v == null) return { v: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return { error: `${label}は${min}〜${max}にしてください` };
  return { v: Math.round(n * 10) / 10 };
}

// ───────── 模試の種類（オーナーが登録）：判定の段階（例 S 90%・A 80%…）と、志望校ごとの判定ラインの偏差値 ─────────
const DEFAULT_LEVELS = [{ name: 'S', pct: 90 }, { name: 'A', pct: 80 }, { name: 'B', pct: 60 }, { name: 'C', pct: 40 }, { name: 'D', pct: 20 }];
function getTypes() { try { const v = JSON.parse(getSetting('moshi_types', '[]')); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function setTypes(list, actorId) {
  if (!Array.isArray(list) || list.length > 30) return { error: '模試の種類は30個までです' };
  const out = [], names = new Set();
  for (const t of list) {
    const name = clean(t && t.name, 30);
    if (!name) return { error: '模試の名前を入れてください' };
    if (names.has(name)) return { error: `「${name}」が2つあります` }; names.add(name);
    const lv = Array.isArray(t.levels) && t.levels.length ? t.levels : DEFAULT_LEVELS;
    if (lv.length > 8) return { error: `${name}：判定の段階は8つまでです` };
    const levels = [], ln = new Set();
    for (const l of lv) {
      const n = clean(l && l.name, 4); if (!n) return { error: `${name}：判定の名前（S・Aなど）を入れてください` };
      if (ln.has(n)) return { error: `${name}：判定「${n}」が2つあります` }; ln.add(n);
      const pct = num(l.pct, 0, 100, `${name}の${n}判定の合格可能性`); if (pct.error) return pct;
      levels.push({ name: n, pct: pct.v });
    }
    const schools = [], sn = new Set();
    for (const sc of (Array.isArray(t.schools) ? t.schools : []).slice(0, 300)) {
      const n = clean(sc && sc.name, 30); if (!n) continue;
      if (sn.has(n)) return { error: `${name}：「${n}」が2つあります` }; sn.add(n);
      const devs = {};
      for (const l of levels) { const d = num(sc.devs && sc.devs[l.name], 20, 90, `${n}の${l.name}判定の偏差値`); if (d.error) return d; if (d.v != null) devs[l.name] = d.v; }
      schools.push({ name: n, devs });
    }
    const id = /^m[0-9a-z]+$/.test(String(t.id || '')) ? String(t.id) : 'm' + Date.now().toString(36) + out.length;
    out.push({ id, name, levels, schools });
  }
  setSetting('moshi_types', JSON.stringify(out));
  audit(actorId, 'scores.moshi_types', null, { count: out.length });
  return { ok: true, types: out };
}
/** 合計の偏差値から、その学校の判定（いちばん上の段階から順に、判定ラインをこえているか） */
function judgeOf(type, schoolName, dev) {
  const sc = type.schools.find(x => x.name === schoolName);
  if (!sc) return null;
  if (dev == null) return { school: schoolName, judge: null, pct: null };
  for (const l of type.levels) { const t = sc.devs[l.name]; if (t != null && dev >= t) return { school: schoolName, judge: l.name, pct: l.pct }; }
  const last = type.levels[type.levels.length - 1];
  return { school: schoolName, judge: null, pct: null, below: last ? last.pct : null };
}

/** 入力をたしかめて、保存する形にする */
function normalize(kind, body, gradeNow) {
  if (!['teiki', 'naishin', 'moshi'].includes(kind)) return { error: '種類をえらんでください' };
  const grade = body.grade || gradeNow;
  if (!isTarget(grade)) return { error: '学年をえらんでください（中1〜高3）' };
  let term = null, title = null, past = 0, takenOn = null, type = null, round = null;
  if (kind !== 'moshi') {
    term = String(body.term || '');
    if (!TERMS[kind].includes(term)) return { error: kind === 'teiki' ? 'どのテストかえらんでください' : '学期をえらんでください' };
  } else {
    past = body.past ? 1 : 0;
    if (body.typeId) { // オーナーが登録した模試（名前＋何回目・何年度）
      type = getTypes().find(t => t.id === String(body.typeId));
      if (!type) return { error: '模試の種類が見つかりません' };
      round = clean(body.round, 30);
      title = (type.name + (round ? ' ' + round : '')).slice(0, 60);
    } else {
      title = clean(body.title, 40);
      if (!title) return { error: '模試をえらんでください' };
    }
  }
  if (body.takenOn) { if (!RE_DAY.test(body.takenOn)) return { error: '日付が正しくありません' }; takenOn = body.takenOn; }
  const src = Array.isArray(body.subjects) ? body.subjects : [];
  if (src.length > 15) return { error: '教科は15個までです' };
  const subjects = [], seen = new Set();
  for (const s of src) {
    const name = clean(s && s.name, 12);
    if (!name) continue;
    if (seen.has(name)) return { error: `「${name}」が2つあります` };
    seen.add(name);
    const o = { name };
    if (kind === 'naishin') {
      const v = num(s.value, 1, 10, `${name}の内申`); if (v.error) return v; o.value = v.v;
    } else {
      const max = num(s.max === '' || s.max == null ? 100 : s.max, 1, 1000, `${name}の満点`); if (max.error) return max; o.max = max.v;
      const sc = num(s.score, 0, o.max, `${name}の点数`); if (sc.error) return sc; o.score = sc.v;
      if (kind === 'teiki') { const a = num(s.avg, 0, o.max, `${name}の平均点`); if (a.error) return a; o.avg = a.v; }
      if (kind === 'moshi') { const d = num(s.dev, 10, 100, `${name}の偏差値`); if (d.error) return d; o.dev = d.v; }
    }
    subjects.push(o);
  }
  if (!subjects.length) return { error: '教科を1つ以上入れてください' };
  const data = { subjects };
  if (kind === 'teiki') {
    const r = num(body.rank, 1, 2000, '順位'); if (r.error) return r; data.rank = r.v;
    const rn = num(body.rankOf, 1, 2000, '人数'); if (rn.error) return rn; data.rankOf = rn.v;
  }
  if (kind === 'moshi') {
    const d = num(body.totalDev, 10, 100, '合計の偏差値'); if (d.error) return d; data.totalDev = d.v;
    if (type) { // 志望校をえらぶと、判定は合計の偏差値から自動で決まる
      data.typeId = type.id; data.round = round;
      const js = [];
      for (const n of (Array.isArray(body.schools) ? body.schools : []).slice(0, 3)) {
        if (!n) continue;
        const j = judgeOf(type, String(n), data.totalDev);
        if (!j) return { error: `「${n}」は、この模試の志望校の一覧にありません` };
        if (!js.some(x => x.school === j.school)) js.push(j);
      }
      data.judges = js;
      return { grade, term, title, past, takenOn, data };
    }
    const judges = [];
    for (const j of (Array.isArray(body.judges) ? body.judges : []).slice(0, 5)) {
      const school = clean(j && j.school, 30), g = String((j && j.judge) || '').toUpperCase();
      if (!school && !g) continue;
      if (!school) return { error: '志望校の名前を入れてください' };
      if (g && !JUDGES.includes(g)) return { error: '判定は A〜E にしてください' };
      judges.push({ school, judge: g || null });
    }
    data.judges = judges;
  }
  return { grade, term, title, past, takenOn, data };
}

// 合計など（表示用）
function summarize(kind, data, grade) {
  const ss = data.subjects || [];
  if (kind === 'naishin') {
    const vals = ss.filter(s => s.value != null);
    const sum = vals.reduce((a, s) => a + s.value, 0);
    const five = ['国語', '社会', '数学', '理科', '英語'];
    const s5 = vals.filter(s => five.includes(s.name));
    return { total: vals.length ? sum : null, total5: isJH(grade) && s5.length ? s5.reduce((a, s) => a + s.value, 0) : null, average: vals.length ? Math.round(sum / vals.length * 10) / 10 : null, count: vals.length };
  }
  const sc = ss.filter(s => s.score != null);
  return { total: sc.length ? Math.round(sc.reduce((a, s) => a + s.score, 0) * 10) / 10 : null, totalMax: sc.length ? sc.reduce((a, s) => a + (s.max || 100), 0) : null, count: sc.length };
}
const TERM_ORDER = { '1mid': 1, '1end': 2, '2mid': 3, '2end': 4, final: 5, 1: 1, 2: 2, 3: 3 };
function view(r) {
  const data = JSON.parse(r.data);
  return {
    id: r.id, userId: r.user_id, kind: r.kind, grade: r.grade, term: r.term, termName: r.term ? TERM_NAME[r.term] : null, title: r.title, past: !!r.past, takenOn: r.taken_on,
    ...data, sum: summarize(r.kind, data, r.grade),
    confirmed: !!r.confirmed_at, confirmedAt: r.confirmed_at, confirmedBy: r.confirmed_name || null,
    createdByStaff: !!r.by_staff, updatedAt: r.updated_at,
  };
}
const SELECT = `SELECT s.*, c.display_name AS confirmed_name, (b.role IN ('owner', 'teacher')) AS by_staff FROM score_records s
  LEFT JOIN users c ON c.id = s.confirmed_by LEFT JOIN users b ON b.id = s.created_by`;
// 学年 → 学期・テストの順（模試は日付の順）
function sortKey(v) { return [GRADES.indexOf(v.grade), v.kind === 'moshi' ? (v.takenOn || v.updatedAt || '') : String(TERM_ORDER[v.term] || 0).padStart(2, '0')]; }
function listFor(userId) {
  return db.prepare(`${SELECT} WHERE s.user_id = ?`).all(userId).map(view)
    .sort((a, b) => { const x = sortKey(a), y = sortKey(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : a.id - b.id); });
}

const isStaff = (u) => u.role === 'owner' || u.role === 'teacher';
const target = (id) => db.prepare("SELECT id, display_name AS name, grade, role, trial_until FROM users WHERE id = ? AND role = 'student'").get(id);
/** その人が、この生徒の成績を見られるか */
function canSee(actor, studentId) {
  if (isStaff(actor)) return true;
  if (actor.role === 'student') return actor.id === studentId;
  if (actor.role === 'parent') return require('./parents').childIds(actor.id).has(studentId);
  return false;
}
function canEdit(actor, st) {
  if (isStaff(actor)) return true;
  return actor.role === 'student' && actor.id === st.id && !st.trial_until && isTarget(st.grade);
}

function save(actor, studentId, body, id = null) {
  const st = target(studentId);
  if (!st) return { error: '生徒が見つかりません', code: 404 };
  if (!canEdit(actor, st)) return { error: '中学生・高校生の、自分の成績だけ入れられます', code: 403 };
  const cur = id ? db.prepare('SELECT * FROM score_records WHERE id = ? AND user_id = ?').get(id, st.id) : null;
  if (id && !cur) return { error: '記録が見つかりません', code: 404 };
  const kind = cur ? cur.kind : String(body.kind || '');
  const n = normalize(kind, body, isTarget(st.grade) ? st.grade : null);
  if (n.error) return n;
  // 定期テスト・内申は、同じ学年・同じテスト（学期）は1つだけ
  if (kind !== 'moshi') {
    const dup = db.prepare('SELECT id FROM score_records WHERE user_id = ? AND kind = ? AND grade = ? AND term = ?').get(st.id, kind, n.grade, n.term);
    if (dup && dup.id !== id) return { error: `${n.grade}の${TERM_NAME[n.term]}${kind === 'naishin' ? 'の内申' : ''}は、もう入っています（「直す」から変えてください）` };
  }
  const staff = isStaff(actor), t = now();
  // 先生が入れた・直したものは確認ずみ。生徒が直すと「確認まち」にもどる
  const conf = staff ? [actor.id, t] : [null, null];
  if (cur) {
    db.prepare('UPDATE score_records SET grade = ?, term = ?, title = ?, past = ?, taken_on = ?, data = ?, confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE id = ?')
      .run(n.grade, n.term, n.title, n.past, n.takenOn, JSON.stringify(n.data), ...conf, t, id);
  } else {
    id = Number(db.prepare('INSERT INTO score_records (user_id, kind, grade, term, title, past, taken_on, data, created_by, confirmed_by, confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(st.id, kind, n.grade, n.term, n.title, n.past, n.takenOn, JSON.stringify(n.data), actor.id, ...conf, t, t).lastInsertRowid);
  }
  if (staff) audit(actor.id, cur ? 'score.updated' : 'score.added', String(st.id), { kind });
  return { ok: true, id };
}
function remove(actor, id) {
  const r = db.prepare('SELECT s.*, u.trial_until, u.grade AS ugrade FROM score_records s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id);
  if (!r) return { error: '記録が見つかりません', code: 404 };
  if (!isStaff(actor) && !(actor.role === 'student' && actor.id === r.user_id)) return { error: '消せません', code: 403 };
  db.prepare('DELETE FROM score_records WHERE id = ?').run(id);
  if (isStaff(actor)) audit(actor.id, 'score.deleted', String(r.user_id), { kind: r.kind });
  return { ok: true };
}
function confirm(actor, id, on = true) {
  if (!isStaff(actor)) return { error: '先生とオーナーの機能です', code: 403 };
  const r = db.prepare('UPDATE score_records SET confirmed_by = ?, confirmed_at = ? WHERE id = ?').run(on ? actor.id : null, on ? now() : null, id);
  if (!r.changes) return { error: '記録が見つかりません', code: 404 };
  return { ok: true };
}
/** 管理画面：中高生ぜんいんの一覧（さいきん入った・直した順） */
function overview() {
  const students = db.prepare(`SELECT u.id, u.display_name AS name, u.grade FROM users u WHERE u.role = 'student' AND u.is_active = 1 AND u.trial_until IS NULL AND u.grade IN (${GRADES.map(() => '?').join(',')}) ORDER BY u.grade, u.display_name`).all(...GRADES);
  const recs = db.prepare(`${SELECT} ORDER BY s.updated_at DESC`).all().map(view);
  const by = new Map(students.map(s => [s.id, { ...s, count: 0, unconfirmed: 0, last: null }]));
  for (const r of recs) { const s = by.get(r.userId); if (!s) continue; s.count++; if (!r.confirmed) s.unconfirmed++; if (!s.last) s.last = r; }
  return { students: [...by.values()], records: recs.filter(r => by.has(r.userId)).map(r => ({ ...r, name: by.get(r.userId).name, nowGrade: by.get(r.userId).grade })) };
}
// ───────── テストの日：カウントダウン・入れ忘れのお知らせ ─────────
const COUNTDOWN_DAYS = 60;   // 何日前からカウントダウンを出すか
const REMIND_AFTER = 14;     // テストが終わって何日たったら「成績を入れてね」
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400e3);
// 塾が入れた学校の日程（テスト対策）を先に使い、ないテストだけ生徒が入れた日
function testDates(userId) {
  return require('./prep').datesFor(userId).map(({ st, ...d }) => d);
}
function setTestDate(actor, studentId, b) {
  const st = target(studentId);
  if (!st) return { error: '生徒が見つかりません', code: 404 };
  if (!canEdit(actor, st)) return { error: '自分のテストの日だけ入れられます', code: 403 };
  const grade = b.grade || st.grade, term = String(b.term || '');
  if (!isTarget(grade)) return { error: '学年をえらんでください' };
  if (!TERMS.teiki.includes(term)) return { error: 'どのテストかえらんでください' };
  const su = db.prepare('SELECT school FROM users WHERE id = ?').get(st.id);
  if (require('./prep').jukuHas({ school: su && su.school }, grade, term)) return { error: 'このテストの日は、塾で設定しています' };
  if (!b.start) { db.prepare('DELETE FROM score_test_dates WHERE user_id = ? AND grade = ? AND term = ?').run(st.id, grade, term); return { ok: true }; }
  if (!RE_DAY.test(b.start) || (b.end && !RE_DAY.test(b.end))) return { error: '日付が正しくありません' };
  const end = b.end && b.end !== b.start ? b.end : null;
  if (end && end < b.start) return { error: '最後の日は、はじめの日より後にしてください' };
  db.prepare('INSERT INTO score_test_dates (user_id, grade, term, start_day, end_day) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, grade, term) DO UPDATE SET start_day = excluded.start_day, end_day = excluded.end_day')
    .run(st.id, grade, term, b.start, end);
  return { ok: true };
}
/**
 * 生徒の画面の左上に出すもの
 * - countdown：次のテストまであと何日（60日前から）・テスト中
 * - missing：テストが終わって2週間たっても成績を入れていないテスト
 */
function reminder(user, today) {
  if (user.role !== 'student' || user.trial_until || !isTarget(user.grade)) return { countdown: null, missing: [] };
  const t = dayNum(today), dates = testDates(user.id);
  let countdown = null;
  for (const d of dates) {
    const s = dayNum(d.start), e = dayNum(d.end || d.start);
    if (t >= s && t <= e) { countdown = { term: d.term, termName: d.termName, grade: d.grade, days: 0, during: true, first: t === s }; break; }
    if (s > t && s - t <= COUNTDOWN_DAYS) { countdown = { term: d.term, termName: d.termName, grade: d.grade, days: s - t, during: false }; break; }
  }
  const has = new Set(db.prepare("SELECT grade || '|' || term AS k FROM score_records WHERE user_id = ? AND kind = 'teiki'").all(user.id).map(r => r.k));
  const missing = dates.filter(d => t - dayNum(d.end || d.start) >= REMIND_AFTER && !has.has(`${d.grade}|${d.term}`))
    .map(d => ({ grade: d.grade, term: d.term, termName: d.termName }));
  return { countdown, missing };
}
module.exports = { testDates, setTestDate, reminder, COUNTDOWN_DAYS, REMIND_AFTER, getTypes, setTypes, judgeOf, DEFAULT_LEVELS, GRADES, TERMS, TERM_NAME, JUDGES, normalize, summarize, listFor, canSee, canEdit, target, save, remove, confirm, overview, isTarget };
