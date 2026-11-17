// がんばりの仕組み：自習時間の記録・学期と年度・ポイントと着せかえ・連続自習・学年の木・目標の短冊・保護者レポート
//
// ■ 自習時間の数え方（オーナーが管理画面で決める）
//   1分ごとに、次の条件をすべて満たす生徒に1分を足す
//   ・自習室にいる ・アプリを見ている（離席していない） ・（設定）席に座っている
//   ・（設定・見守り写真がオンのとき）カメラがオン ・（設定）数える時間帯の中 ・（設定）1日の上限に達していない
//   オーナーは、生徒ごと・日ごとに時間を修正できる（修正した値が優先される）
// ■ 学年の木：今学期の「学年の生徒1人あたりの平均自習時間」で育つ（人数の差が出ないように平均）
// ■ ポイント・着せかえ：今年度の自習時間で増える。新年度になると、ポイントと持っているアイテムは0に戻る
const crypto = require('crypto');
const { db, now, getSetting, setSetting, audit } = require('./db');

const TZ = 'Asia/Tokyo';
const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'];
const NEXT_GRADE = Object.fromEntries(GRADES.map((g, i) => [g, GRADES[i + 1] || '卒業']));
const STAGE_NAMES = ['芽', '若葉', '若木', '大きな木', '花', '実り'];

db.exec(`
CREATE TABLE IF NOT EXISTS study_days (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,              -- YYYY-MM-DD（日本時間）
  auto_min   INTEGER NOT NULL DEFAULT 0, -- 自動で数えた分
  manual_min INTEGER,                    -- オーナーが修正した分（NULL なら自動の値を使う）
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS shop_owned (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  year_start TEXT NOT NULL,
  price      INTEGER NOT NULL,
  bought_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, item, year_start)
);
CREATE TABLE IF NOT EXISTS avatar_equip (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  year_start TEXT NOT NULL,
  head TEXT, face TEXT, pet TEXT
);
CREATE TABLE IF NOT EXISTS goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term_key   TEXT NOT NULL,
  text       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  achieved   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  reviewed_by INTEGER,
  UNIQUE (user_id, term_key)
);
CREATE TABLE IF NOT EXISTS report_links (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term_name  TEXT NOT NULL,
  term_start TEXT NOT NULL,
  term_end   TEXT NOT NULL,
  comment    TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_by INTEGER
);
`);
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'grade')) db.exec('ALTER TABLE users ADD COLUMN grade TEXT');

// ───────── 日付（日本時間） ─────────
function jst(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const o = Object.fromEntries(f.formatToParts(d).map(p => [p.type, p.value]));
  const hour = o.hour === '24' ? '00' : o.hour;
  return { day: `${o.year}-${o.month}-${o.day}`, hm: `${hour}:${o.minute}`, month: Number(o.month), year: Number(o.year) };
}
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addYears = (day, n) => { const [y, m, d] = day.split('-'); return `${Number(y) + n}-${m}-${d}`; };
const RE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const RE_HM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

// ───────── 設定 ─────────
function defaults(today = jst()) {
  const y = today.month >= 4 ? today.year : today.year - 1;
  return {
    window: { start: '00:00', end: '24:00' }, // 数える時間帯
    dailyCap: 300,         // 1日に数える上限（分）
    requireSeat: true,     // 席に座っているときだけ数える
    requireCamera: false,  // 見守り写真がオンのとき、カメラがオンのときだけ数える
    streakMin: 20,         // 連続自習に数える1日の最低時間（分）
    minutesPerPoint: 10,   // 何分で1ポイント
    yearStart: `${y}-04-01`,
    terms: [`${y}-04-01`, `${y}-09-01`, `${y + 1}-01-01`],
    trees: [{ name: '中1の木', grades: ['中1'] }, { name: '中2の木', grades: ['中2'] }, { name: '中3の木', grades: ['中3'] }],
    stages: [0, 5, 15, 30, 50, 80], // 木の段階（平均時間・時間単位）
  };
}
function getConfig() {
  let saved = {};
  try { saved = JSON.parse(getSetting('ganbari', '{}')); } catch (e) { saved = {}; }
  const d = defaults();
  return { ...d, ...saved, window: { ...d.window, ...(saved.window || {}) } };
}
// 入力のチェックをしてから保存する。エラーならメッセージを返す
function setConfig(patch, actorId) {
  const c = getConfig();
  const p = patch || {};
  if (p.window) {
    if (!RE_HM.test(p.window.start || '') || !RE_HM.test(p.window.end || '') || p.window.start >= p.window.end) return '数える時間帯が正しくありません';
    c.window = { start: p.window.start, end: p.window.end };
  }
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  if (p.dailyCap !== undefined) { if (!int(p.dailyCap, 10, 1440)) return '1日の上限は10〜1440分にしてください'; c.dailyCap = p.dailyCap; }
  if (p.streakMin !== undefined) { if (!int(p.streakMin, 1, 600)) return '連続自習の最低時間は1〜600分にしてください'; c.streakMin = p.streakMin; }
  if (p.minutesPerPoint !== undefined) { if (!int(p.minutesPerPoint, 1, 120)) return 'ポイントの設定は1〜120分にしてください'; c.minutesPerPoint = p.minutesPerPoint; }
  if (p.requireSeat !== undefined) c.requireSeat = !!p.requireSeat;
  if (p.requireCamera !== undefined) c.requireCamera = !!p.requireCamera;
  if (p.terms !== undefined) {
    if (!Array.isArray(p.terms) || p.terms.length !== 3 || !p.terms.every(t => RE_DAY.test(t)) || !(p.terms[0] < p.terms[1] && p.terms[1] < p.terms[2])) return '学期の開始日を正しく入れてください（1学期 < 2学期 < 3学期）';
    if (p.terms[0] !== c.yearStart) return '1学期の開始日を変えるときは「新年度にする」を使ってください';
    if (p.terms[2] >= addYears(c.yearStart, 1)) return '3学期の開始日は、年度の終わりより前にしてください';
    c.terms = p.terms;
  }
  if (p.trees !== undefined) {
    if (!Array.isArray(p.trees) || p.trees.length !== 3) return '木は3本です';
    const trees = [];
    for (const t of p.trees) {
      const name = String((t && t.name) || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
      const grades = Array.isArray(t && t.grades) ? [...new Set(t.grades.filter(g => GRADES.includes(g)))] : [];
      if (!name || !grades.length) return '木の名前と学年を入れてください';
      trees.push({ name, grades });
    }
    c.trees = trees;
  }
  if (p.stages !== undefined) {
    const s = p.stages;
    if (!Array.isArray(s) || s.length !== 6 || s[0] !== 0 || !s.every((v, i) => typeof v === 'number' && v >= 0 && v <= 2000 && (i === 0 || v > s[i - 1]))) return '木の段階の時間は、0から始めて大きくなる順に6つ入れてください';
    c.stages = s;
  }
  setSetting('ganbari', JSON.stringify(c));
  if (actorId) audit(actorId, 'ganbari.config', null, null);
  return null;
}

// ───────── 学期・年度 ─────────
function termOf(day, c = getConfig()) {
  const yearEnd = addDays(addYears(c.yearStart, 1), -1);
  if (day < c.terms[0] || day > yearEnd) return null;
  let i = 0;
  while (i < 2 && day >= c.terms[i + 1]) i++;
  const end = i < 2 ? addDays(c.terms[i + 1], -1) : yearEnd;
  return { key: `${c.yearStart}#${i + 1}`, index: i + 1, name: `${i + 1}学期`, start: c.terms[i], end };
}
function allTerms(c = getConfig()) {
  const yearEnd = addDays(addYears(c.yearStart, 1), -1);
  return c.terms.map((start, i) => ({ key: `${c.yearStart}#${i + 1}`, index: i + 1, name: `${i + 1}学期`, start, end: i < 2 ? addDays(c.terms[i + 1], -1) : yearEnd }));
}

// ───────── 自習時間 ─────────
const totalExpr = 'COALESCE(manual_min, auto_min)';
function dayTotal(userId, day) {
  const r = db.prepare(`SELECT ${totalExpr} AS m FROM study_days WHERE user_id = ? AND day = ?`).get(userId, day);
  return r ? r.m : 0;
}
function minutesBetween(userId, from, to) {
  return db.prepare(`SELECT COALESCE(SUM(${totalExpr}), 0) AS m FROM study_days WHERE user_id = ? AND day BETWEEN ? AND ?`).get(userId, from, to).m;
}
function daysBetween(userId, from, to) {
  return db.prepare(`SELECT day, auto_min AS auto, manual_min AS manual, ${totalExpr} AS total FROM study_days WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day`).all(userId, from, to);
}
function setManual(userId, day, minutes, actorId) {
  if (!RE_DAY.test(day)) return '日付が正しくありません';
  if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440)) return '時間は0〜1440分で入れてください';
  db.prepare(`INSERT INTO study_days (user_id, day, auto_min, manual_min) VALUES (?, ?, 0, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET manual_min = excluded.manual_min`).run(userId, day, minutes);
  audit(actorId, 'ganbari.time_edited', String(userId), { day, minutes });
  return null;
}

/**
 * 1分ごとに呼ぶ：条件を満たす生徒に1分を足す
 * @param {Map} online realtime の接続中ユーザー
 * @param {{photosOn:boolean, date?:Date}} opt
 * @returns {number[]} 足した生徒の id
 */
function tick(online, opt = {}) {
  const c = getConfig();
  const t = jst(opt.date || new Date());
  if (t.hm < c.window.start || t.hm >= c.window.end) return [];
  const added = [];
  const up = db.prepare(`INSERT INTO study_days (user_id, day, auto_min) VALUES (?, ?, 1)
    ON CONFLICT(user_id, day) DO UPDATE SET auto_min = auto_min + 1`);
  db.exec('BEGIN');
  try {
    for (const p of online.values()) {
      if (p.user.role !== 'student' || p.room !== 'study' || p.away) continue;
      if (c.requireSeat && !p.seat) continue;
      if (c.requireCamera && opt.photosOn && !p.studyCam) continue;
      if (dayTotal(p.id, t.day) >= c.dailyCap) continue;
      up.run(p.id, t.day);
      added.push(p.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return added;
}

// 連続自習の日数（今日まだ達していなくても、昨日まで続いていれば数える）
function streak(userId, date = new Date()) {
  const c = getConfig();
  const today = jst(date).day;
  const rows = db.prepare(`SELECT day, ${totalExpr} AS m FROM study_days WHERE user_id = ? AND day <= ? AND day >= ? ORDER BY day DESC`)
    .all(userId, today, addDays(today, -400));
  const ok = new Set(rows.filter(r => r.m >= c.streakMin).map(r => r.day));
  let day = ok.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (ok.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

// ───────── ポイントと着せかえ ─────────
// months: 買える月（期間限定）。なければいつでも
const SHOP = [
  { id: 'cap', slot: 'head', emoji: '🧢', name: 'キャップ', price: 20 },
  { id: 'ribbon', slot: 'head', emoji: '🎀', name: 'リボン', price: 20 },
  { id: 'tophat', slot: 'head', emoji: '🎩', name: 'シルクハット', price: 50 },
  { id: 'gradcap', slot: 'head', emoji: '🎓', name: '博士の帽子', price: 80 },
  { id: 'crown', slot: 'head', emoji: '👑', name: '王冠', price: 150 },
  { id: 'sakura', slot: 'head', emoji: '🌸', name: '桜の髪かざり', price: 30, months: [3, 4, 5] },
  { id: 'sunflower', slot: 'head', emoji: '🌻', name: 'ひまわり', price: 30, months: [7, 8] },
  { id: 'maple', slot: 'head', emoji: '🍁', name: 'もみじ', price: 30, months: [10, 11] },
  { id: 'santa', slot: 'head', emoji: '🎅', name: 'サンタ', price: 40, months: [12] },
  { id: 'glasses', slot: 'face', emoji: '👓', name: 'メガネ', price: 30 },
  { id: 'sunglasses', slot: 'face', emoji: '🕶️', name: 'サングラス', price: 40 },
  { id: 'goggles', slot: 'face', emoji: '🥽', name: 'ゴーグル', price: 60 },
  { id: 'chick', slot: 'pet', emoji: '🐤', name: 'ひよこ', price: 40 },
  { id: 'cat', slot: 'pet', emoji: '🐱', name: 'ねこ', price: 60 },
  { id: 'dog', slot: 'pet', emoji: '🐶', name: 'いぬ', price: 60 },
  { id: 'rabbit', slot: 'pet', emoji: '🐰', name: 'うさぎ', price: 60 },
  { id: 'panda', slot: 'pet', emoji: '🐼', name: 'パンダ', price: 100 },
  { id: 'dragon', slot: 'pet', emoji: '🐲', name: 'ドラゴン', price: 200 },
  { id: 'pumpkin', slot: 'pet', emoji: '🎃', name: 'かぼちゃ', price: 50, months: [10] },
  { id: 'snowman', slot: 'pet', emoji: '⛄', name: '雪だるま', price: 50, months: [12, 1, 2] },
];
const itemById = (id) => SHOP.find(i => i.id === id);

function points(userId, date = new Date()) {
  const c = getConfig();
  const today = jst(date).day;
  const minutes = minutesBetween(userId, c.yearStart, today);
  const earned = Math.floor(minutes / c.minutesPerPoint);
  const spent = db.prepare('SELECT COALESCE(SUM(price), 0) AS s FROM shop_owned WHERE user_id = ? AND year_start = ?').get(userId, c.yearStart).s;
  return { earned, spent, balance: earned - spent, yearMinutes: minutes };
}
function owned(userId) {
  const c = getConfig();
  return db.prepare('SELECT item FROM shop_owned WHERE user_id = ? AND year_start = ?').all(userId, c.yearStart).map(r => r.item);
}
function getEquip(userId) {
  const c = getConfig();
  const r = db.prepare('SELECT * FROM avatar_equip WHERE user_id = ?').get(userId);
  if (!r || r.year_start !== c.yearStart) return { head: null, face: null, pet: null }; // 新年度になったら何もつけていない状態に
  const emoji = (id) => (id && itemById(id) ? itemById(id).emoji : null);
  return { head: emoji(r.head), face: emoji(r.face), pet: emoji(r.pet), ids: { head: r.head, face: r.face, pet: r.pet } };
}
function buy(userId, itemId, date = new Date()) {
  const item = itemById(itemId);
  if (!item) return 'そのアイテムはありません';
  if (item.months && !item.months.includes(jst(date).month)) return 'このアイテムは今は買えません（期間限定）';
  if (owned(userId).includes(itemId)) return 'もう持っています';
  const pt = points(userId, date);
  if (pt.balance < item.price) return `ポイントが足りません（あと${item.price - pt.balance}ポイント）`;
  db.prepare('INSERT INTO shop_owned (user_id, item, year_start, price, bought_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, itemId, getConfig().yearStart, item.price, now());
  return null;
}
function equip(userId, slot, itemId) {
  if (!['head', 'face', 'pet'].includes(slot)) return 'つける場所が正しくありません';
  if (itemId !== null) {
    const item = itemById(itemId);
    if (!item || item.slot !== slot) return 'そのアイテムはここにはつけられません';
    if (!owned(userId).includes(itemId)) return 'まだ持っていません';
  }
  const c = getConfig();
  const cur = db.prepare('SELECT * FROM avatar_equip WHERE user_id = ?').get(userId);
  const base = cur && cur.year_start === c.yearStart ? cur : { head: null, face: null, pet: null };
  const next = { ...base, [slot]: itemId };
  db.prepare(`INSERT INTO avatar_equip (user_id, year_start, head, face, pet) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET year_start = excluded.year_start, head = excluded.head, face = excluded.face, pet = excluded.pet`)
    .run(userId, c.yearStart, next.head, next.face, next.pet);
  return null;
}
function shopFor(userId, date = new Date()) {
  const month = jst(date).month;
  const have = new Set(owned(userId));
  return SHOP.map(i => ({ ...i, owned: have.has(i.id), available: !i.months || i.months.includes(month), limited: !!i.months }));
}

// ───────── 目標の短冊 ─────────
const cleanText = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
function setGoal(userId, text, date = new Date()) {
  const term = termOf(jst(date).day);
  if (!term) return '今は学期の期間ではありません';
  const t = cleanText(text, 30);
  if (!t) return '目標を書いてください';
  const cur = db.prepare('SELECT * FROM goals WHERE user_id = ? AND term_key = ?').get(userId, term.key);
  if (cur && cur.achieved) return '達成した目標は変えられません';
  db.prepare(`INSERT INTO goals (user_id, term_key, text, status, achieved, updated_at) VALUES (?, ?, ?, 'pending', 0, ?)
    ON CONFLICT(user_id, term_key) DO UPDATE SET text = excluded.text, status = 'pending', updated_at = excluded.updated_at`)
    .run(userId, term.key, t, now());
  return null;
}
function goalOf(userId, termKey) {
  return db.prepare('SELECT id, text, status, achieved FROM goals WHERE user_id = ? AND term_key = ?').get(userId, termKey) || null;
}
function listGoals(termKey) {
  return db.prepare(`SELECT g.id, g.text, g.status, g.achieved, g.updated_at, u.display_name AS name, u.grade
    FROM goals g JOIN users u ON u.id = g.user_id WHERE g.term_key = ? AND u.is_active = 1
    ORDER BY CASE g.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, g.updated_at DESC`).all(termKey);
}
function reviewGoal(goalId, action, actorId) {
  const g = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  if (!g) return '目標が見つかりません';
  const sets = {
    approve: ["status = 'approved'"], reject: ["status = 'rejected'", 'achieved = 0'],
    achieved: ["status = 'approved'", 'achieved = 1'], unachieved: ['achieved = 0'],
  }[action];
  if (!sets) return '操作が正しくありません';
  db.prepare(`UPDATE goals SET ${sets.join(', ')}, reviewed_by = ?, updated_at = ? WHERE id = ?`).run(actorId, now(), goalId);
  audit(actorId, 'ganbari.goal_' + action, String(g.user_id), null);
  return null;
}

// ───────── 学年の木 ─────────
function stageOf(avgMinutes, c = getConfig()) {
  const h = avgMinutes / 60;
  let s = 0;
  for (let i = 0; i < c.stages.length; i++) if (h >= c.stages[i]) s = i;
  return s;
}
function forest(date = new Date(), termOverride = null) {
  const c = getConfig();
  const term = termOverride || termOf(jst(date).day, c);
  const trees = c.trees.map((t, i) => {
    const students = db.prepare(`SELECT id, display_name AS name FROM users WHERE role = 'student' AND is_active = 1 AND grade IN (${t.grades.map(() => '?').join(',')})`).all(...t.grades);
    let sum = 0;
    if (term) for (const s of students) sum += minutesBetween(s.id, term.start, term.end);
    const avg = students.length ? sum / students.length : 0; // 人数の差が出ないように「平均」
    const stage = stageOf(avg, c);
    const goals = term ? db.prepare(`SELECT u.display_name AS name, g.text, g.achieved FROM goals g JOIN users u ON u.id = g.user_id
      WHERE g.term_key = ? AND g.status = 'approved' AND u.is_active = 1 AND u.grade IN (${t.grades.map(() => '?').join(',')}) ORDER BY g.id`).all(term.key, ...t.grades) : [];
    return {
      index: i, name: t.name, grades: t.grades, students: students.length, avgMinutes: Math.round(avg),
      stage, stageName: STAGE_NAMES[stage], nextHours: c.stages[stage + 1] ?? null,
      goals: goals.map(g => ({ name: g.name, text: g.text, achieved: !!g.achieved })),
    };
  });
  return { term, trees };
}
function treeOfGrade(grade, date = new Date(), term = null) {
  const f = forest(date, term);
  return f.trees.find(t => t.grades.includes(grade)) || null;
}

// ───────── 一覧（管理画面） ─────────
function studentSummary(date = new Date()) {
  const c = getConfig();
  const today = jst(date).day;
  const term = termOf(today, c);
  return db.prepare("SELECT id, display_name AS name, grade FROM users WHERE role = 'student' AND is_active = 1 ORDER BY grade, display_name").all().map(s => {
    const pt = points(s.id, date);
    return {
      ...s, today: dayTotal(s.id, today), term: term ? minutesBetween(s.id, term.start, term.end) : 0,
      year: pt.yearMinutes, points: pt.balance, streak: streak(s.id, date),
    };
  });
}

// ───────── 新年度 ─────────
function newYear(terms, promote, actorId) {
  if (!Array.isArray(terms) || terms.length !== 3 || !terms.every(t => RE_DAY.test(t)) || !(terms[0] < terms[1] && terms[1] < terms[2])) return '新しい学期の開始日を正しく入れてください';
  const c = getConfig();
  if (terms[0] <= c.yearStart) return '新年度の開始日は、今の年度より後にしてください';
  if (terms[2] >= addYears(terms[0], 1)) return '3学期の開始日は、年度の終わりより前にしてください';
  c.yearStart = terms[0]; c.terms = terms;
  setSetting('ganbari', JSON.stringify(c));
  let promoted = 0;
  if (promote) {
    for (const u of db.prepare("SELECT id, grade FROM users WHERE role = 'student' AND grade IS NOT NULL").all()) {
      if (NEXT_GRADE[u.grade]) { db.prepare('UPDATE users SET grade = ? WHERE id = ?').run(NEXT_GRADE[u.grade], u.id); promoted++; }
    }
  }
  audit(actorId, 'ganbari.new_year', terms[0], { promote: !!promote, promoted });
  return null;
}

// ───────── 保護者レポート ─────────
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function createReport(userId, term, comment, actorId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + 120 * 86400e3).toISOString();
  db.prepare('INSERT INTO report_links (token_hash, user_id, term_name, term_start, term_end, comment, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, term.name, term.start, term.end, cleanText(comment, 200) || null, now(), expires, actorId);
  audit(actorId, 'ganbari.report_created', String(userId), { term: term.name });
  return token;
}
function reportData(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 64) return null;
  const r = db.prepare('SELECT * FROM report_links WHERE token_hash = ?').get(sha256(token));
  if (!r || r.expires_at < now()) return null;
  const u = db.prepare('SELECT id, display_name, grade, avatar_color FROM users WHERE id = ?').get(r.user_id);
  if (!u) return null;
  const c = getConfig();
  const termKey = allTerms(c).find(t => t.start === r.term_start)?.key || `${r.term_start}#old`;
  const goal = termKey ? goalOf(u.id, termKey) : null;
  const days = db.prepare(`SELECT COUNT(*) AS n FROM study_days WHERE user_id = ? AND day BETWEEN ? AND ? AND ${totalExpr} > 0`).get(u.id, r.term_start, r.term_end).n;
  // 木はレポートの学期の時点（その学期の平均）で表示する
  const tree = u.grade ? treeOfGrade(u.grade, new Date(), { key: termKey, start: r.term_start, end: r.term_end }) : null;
  return {
    name: u.display_name, grade: u.grade, color: u.avatar_color,
    term: { name: r.term_name, start: r.term_start, end: r.term_end },
    totalMinutes: minutesBetween(u.id, r.term_start, r.term_end), studyDays: days,
    equip: getEquip(u.id), streak: streak(u.id),
    goal: goal && goal.status === 'approved' ? { text: goal.text, achieved: !!goal.achieved } : null,
    tree: tree ? { name: tree.name, stage: tree.stage, stageName: tree.stageName, avgMinutes: tree.avgMinutes } : null,
    comment: r.comment, createdAt: r.created_at,
  };
}

module.exports = {
  GRADES, STAGE_NAMES, SHOP, jst, addDays, getConfig, setConfig, termOf, allTerms, dayTotal, minutesBetween, daysBetween, setManual, tick,
  streak, points, owned, getEquip, buy, equip, shopFor, setGoal, goalOf, listGoals, reviewGoal, forest, studentSummary, newYear,
  createReport, reportData,
};
