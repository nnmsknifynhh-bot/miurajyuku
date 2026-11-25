// 📊 成績：定期テスト・内申（通知表）・模試（本番と過去問）
// - 中学生・高校生だけ。生徒も先生も入れられる。生徒が入れたものは、先生が「確認ずみ」にできる（生徒が直すと確認はもどる）
// - 生徒は自分の成績だけ、保護者は自分の子どもの成績だけ、先生・オーナーは全員を見られる
// - ポイントはつけない
const { db, now, audit } = require('./db');

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

/** 入力をたしかめて、保存する形にする */
function normalize(kind, body, gradeNow) {
  if (!['teiki', 'naishin', 'moshi'].includes(kind)) return { error: '種類をえらんでください' };
  const grade = body.grade || gradeNow;
  if (!isTarget(grade)) return { error: '学年をえらんでください（中1〜高3）' };
  let term = null, title = null, past = 0, takenOn = null;
  if (kind !== 'moshi') {
    term = String(body.term || '');
    if (!TERMS[kind].includes(term)) return { error: kind === 'teiki' ? 'どのテストかえらんでください' : '学期をえらんでください' };
  } else {
    title = clean(body.title, 40);
    if (!title) return { error: '模試の名前を入れてください（例：11月 県模試）' };
    past = body.past ? 1 : 0;
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
module.exports = { GRADES, TERMS, TERM_NAME, JUDGES, normalize, summarize, listFor, canSee, canEdit, target, save, remove, confirm, overview, isTarget };
