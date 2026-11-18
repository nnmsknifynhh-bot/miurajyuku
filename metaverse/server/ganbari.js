// がんばりの仕組み：自習時間の記録・学期と年度・ポイントと着せかえ・連続自習・学年の木・目標の短冊・保護者レポート
//
// ■ 自習時間の数え方（オーナーが管理画面で決める）
//   1分ごとに、次の条件をすべて満たす生徒に1分を足す
//   ・自習室にいる ・アプリを見ている（離席していない） ・（設定）席に座っている
//   ・（設定・見守り写真がオンのとき）カメラがオン ・（設定）数える時間帯の中 ・（設定）1日の上限に達していない
//   オーナーは、生徒ごと・日ごとに時間を修正できる（修正した値が優先される）
// ■ 学年の木：今学期の「学年の生徒1人あたりの平均自習時間」で育つ（人数の差が出ないように平均）
// ■ ポイント・着せかえ：自習時間で増える。新年度になっても、ポイントと持っているアイテムは引きつぐ
const crypto = require('crypto');
const { db, now, getSetting, setSetting, audit } = require('./db');
const SM = require('../public/shared/map.js');

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
// 誕生日（月-日だけ。生まれた年は持たない）と、ほかの生徒にも見せるか
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'birthday')) {
  db.exec("ALTER TABLE users ADD COLUMN birthday TEXT");
  db.exec("ALTER TABLE users ADD COLUMN birthday_public INTEGER NOT NULL DEFAULT 1");
}
// 高校生：来る曜日（例 '2,5'＝火・金）と時刻、今日やること、来ていないお知らせの記録
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'visit_days')) {
  db.exec('ALTER TABLE users ADD COLUMN visit_days TEXT');
  db.exec('ALTER TABLE users ADD COLUMN visit_time TEXT');
}
// 生徒ごとの授業の曜日（例 '2,5'＝火・金）。その曜日は🔥がとぎれない（自習すれば1日に数える）
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'class_days')) db.exec('ALTER TABLE users ADD COLUMN class_days TEXT');
function normClassDays(v) {
  if (v == null || (Array.isArray(v) && !v.length)) return null;
  if (!Array.isArray(v) || !v.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) return undefined;
  return [...new Set(v)].sort().join(',');
}
db.exec(`CREATE TABLE IF NOT EXISTS study_plans (user_id INTEGER NOT NULL, day TEXT NOT NULL, items TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, day))`);
db.exec(`CREATE TABLE IF NOT EXISTS late_alerts (user_id INTEGER NOT NULL, day TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (user_id, day))`);
// お楽しみ（朝活など）でもらったボーナスポイント。reason は同じものを二重にもらわないための印
db.exec(`CREATE TABLE IF NOT EXISTS bonus_points (user_id INTEGER NOT NULL, reason TEXT NOT NULL, points INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, reason))`);
db.exec(`CREATE TABLE IF NOT EXISTS birthday_cards (user_id INTEGER NOT NULL, year INTEGER NOT NULL, shown_at TEXT NOT NULL, PRIMARY KEY (user_id, year))`);
// 着せかえの場所を増やした（洋服・手に持つもの・着ぐるみ）
for (const col of ['clothes', 'hand', 'costume']) {
  if (!db.prepare('PRAGMA table_info(avatar_equip)').all().some(c => c.name === col)) db.exec(`ALTER TABLE avatar_equip ADD COLUMN ${col} TEXT`);
}
const SLOTS = ['head', 'clothes', 'face', 'hand', 'pet', 'costume'];

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
// 保護者会の日（生徒が入れない時間がある日）：🔥がとぎれない・サンタの日数・高校生の週の回数に入れる
function meetingDays() { try { return new Set(JSON.parse(getSetting('parent_meeting_days', '[]'))); } catch (e) { return new Set(); } }
function addMeetingDay(day) { const s = meetingDays(); s.add(day); setSetting('parent_meeting_days', JSON.stringify([...s].sort().slice(-100))); }
function removeMeetingDay(day) { const s = meetingDays(); if (s.delete(day)) setSetting('parent_meeting_days', JSON.stringify([...s].sort())); }
const RE_HM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const weekdayOf = (day) => new Date(day + 'T00:00:00Z').getUTCDay();

// ───────── 設定 ─────────
const HS_GRADES = ['高1', '高2', '高3'];
const isHS = (grade) => HS_GRADES.includes(grade);
const HS_TREE = { name: '高校生の木', grades: HS_GRADES };
// 高校生の称号（自習時間の合計・時間）
const TITLES = [[20, 'がんばり屋'], [50, '努力家'], [100, '鉄人'], [200, '勉強の達人'], [300, '受験の覇者'], [500, '伝説の受験生']];
function defaults(today = jst()) {
  const y = today.month >= 4 ? today.year : today.year - 1;
  return {
    window: { start: '00:00', end: '24:00' }, // 数える時間帯（朝）
    window2: null,         // 2つ目の時間帯（夜）。使わないときは null
    dailyCap: 300,         // 1日に数える上限（分）
    weekly: null,          // 曜日ごとの数え方（null＝毎日同じ）。[日,月,…,土] の7つ：{ on, start, end, start2, end2, cap }（夜を使わないときは start2/end2 が null）
    requireSeat: true,     // 席に座っているときだけ数える
    requireCamera: false,  // 見守り写真がオンのとき、カメラがオンのときだけ数える
    streakMin: 90,         // 連続自習に数える1日の最低時間（分）。下の学年別にない学年はこれ
    streakByGrade: { '中1': 45, '中2': 60, '中3': 90 }, // 学年別の最低時間（分）
    minutesPerPoint: 10,   // 何分で1ポイント
    yearStart: `${y}-04-01`,
    pointsFrom: `${y}-04-01`, // ポイントを数え始めた日（新年度になっても変えない＝ポイントは引きつぐ）
    terms: [`${y}-04-01`, `${y}-09-01`, `${y + 1}-01-01`],
    trees: [{ name: '中1の木', grades: ['中1'] }, { name: '中2の木', grades: ['中2'] }, { name: '中3の木', grades: ['中3'] }, HS_TREE],
    // 高校生（高校生自習室）の数え方。時間帯・上限・曜日は中学生とは別。週のノルマ：週○回・1回○分以上
    hs: { window: { start: '00:00', end: '24:00' }, window2: null, dailyCap: 360, weekly: null, sessionsPerWeek: 2, sessionMinutes: 180, weekBonus: 30, lateMinutes: 15 },
    stages: [0, 5, 15, 30, 50, 80], // 木の段階（平均時間・時間単位）
    dressup: { mode: 'always', periods: [] }, // 着せかえ期間：always＝いつでも / periods＝決めた期間だけ
    events: Object.fromEntries(EVENTS.map(e => [e.id, true])), // 季節の飾り（オン/オフ）
    birthdayMessage: 'いつもがんばっているね。すてきな1年になりますように！', // 誕生日カードのひとこと
    // 季節のお楽しみ（オン/オフと条件）
    fun: { santa: true, santaDays: 10, asakatsu: true, asakatsuStart: '06:00', asakatsuEnd: '07:30', asakatsuMinutes: 30, asakatsuPoints: 3 },
  };
}

// ───────── 季節の飾り ─────────
// from/to は「月-日」。to が from より前なら年をまたぐ
const EVENTS = [
  { id: 'newyear', name: 'お正月', from: '01-01', to: '01-15' },
  { id: 'winter', name: '冬・雪', from: '01-16', to: '01-31' },
  { id: 'setsubun', name: '節分', from: '02-01', to: '02-03' },
  { id: 'valentine', name: 'バレンタイン', from: '02-04', to: '02-14' },
  { id: 'hina', name: 'ひな祭り', from: '02-15', to: '03-03' },
  { id: 'whiteday', name: 'ホワイトデー', from: '03-04', to: '03-14' },
  { id: 'graduation', name: '卒業式', from: '03-15', to: '03-31' },
  { id: 'entrance', name: '入学式', from: '04-01', to: '04-10' },
  { id: 'hanami', name: 'お花見', from: '04-11', to: '04-30' },
  { id: 'kodomo', name: 'こどもの日', from: '05-01', to: '05-05' },
  { id: 'mothersday', name: '母の日', from: '05-06', to: '05-15' },
  { id: 'shinryoku', name: '新緑', from: '05-16', to: '05-31' },
  { id: 'ajisai', name: 'あじさい・梅雨', from: '06-01', to: '06-30' },
  { id: 'tanabata', name: '七夕', from: '07-01', to: '07-07' },
  { id: 'summer', name: '夏・ひまわり', from: '07-08', to: '07-31' },
  { id: 'matsuri', name: '夏祭り・花火', from: '08-01', to: '08-31' },
  { id: 'earlyautumn', name: '秋の始まり', from: '09-01', to: '09-15' },
  { id: 'tsukimi', name: 'お月見', from: '09-16', to: '09-30' },
  { id: 'halloween', name: 'ハロウィン', from: '10-01', to: '10-31' },
  { id: 'koyo', name: '紅葉・秋', from: '11-01', to: '11-15' },
  { id: 'harvest', name: '秋の収穫祭', from: '11-16', to: '11-30' },
  { id: 'christmas', name: 'クリスマス', from: '12-01', to: '12-25' },
  { id: 'prenewyear', name: 'お正月準備', from: '12-26', to: '12-31' },
];
function currentEvent(date = new Date(), c = getConfig()) {
  const md = jst(date).day.slice(5);
  return EVENTS.find(e => c.events[e.id] !== false && (e.from <= e.to ? md >= e.from && md <= e.to : md >= e.from || md <= e.to)) || null;
}
function getConfig() {
  let saved = {};
  try { saved = JSON.parse(getSetting('ganbari', '{}')); } catch (e) { saved = {}; }
  const d = defaults();
  // ポイントを数え始めた日は、一度決めたら変えない（まだ保存していなければ今の年度の始まりで保存）
  if (!saved.pointsFrom) {
    saved.pointsFrom = saved.yearStart || d.yearStart;
    setSetting('ganbari', JSON.stringify({ ...d, ...saved }));
  }
  const shs = saved.hs || {};
  const trees = Array.isArray(saved.trees) ? (saved.trees.length === 3 ? [...saved.trees, HS_TREE] : saved.trees) : d.trees; // 4本目（高校生の木）を足す
  return {
    ...d, ...saved, window: { ...d.window, ...(saved.window || {}) }, trees,
    dressup: { ...d.dressup, ...(saved.dressup || {}) }, events: { ...d.events, ...(saved.events || {}) },
    hs: { ...d.hs, ...shs, window: { ...d.hs.window, ...(shs.window || {}) } },
    fun: { ...d.fun, ...(saved.fun || {}) },
  };
}
// その日の数え方（曜日ごとの設定があればそれ、なければ毎日同じ設定）
// group：'hs'＝高校生（高校生自習室の数え方）、それ以外＝中学生など
function ruleFor(day, c = getConfig(), group = null) {
  const src = group === 'hs' ? c.hs : c;
  return ruleOf(day, src);
}
function ruleOf(day, c) {
  if (Array.isArray(c.weekly) && c.weekly.length === 7) {
    const w = c.weekly[weekdayOf(day)];
    const windows = [{ start: w.start, end: w.end }];
    if (w.start2 && w.end2) windows.push({ start: w.start2, end: w.end2 });
    return { weekday: WEEKDAYS[weekdayOf(day)], on: !!w.on, windows, cap: w.cap };
  }
  const windows = [{ ...c.window }];
  if (c.window2) windows.push({ ...c.window2 });
  return { weekday: WEEKDAYS[weekdayOf(day)], on: true, windows, cap: c.dailyCap };
}
// 時間帯（1つ目＝朝・2つ目＝夜）のチェック。エラーならメッセージを返す
function checkWindows(s1, e1, s2, e2, label) {
  if (!RE_HM.test(s1 || '') || !RE_HM.test(e1 || '') || s1 >= e1) return `${label}の時間帯（1つ目）が正しくありません`;
  if (s2 == null && e2 == null) return null;
  if (!RE_HM.test(s2 || '') || !RE_HM.test(e2 || '') || s2 >= e2) return `${label}の時間帯（2つ目）が正しくありません`;
  if (s2 < e1) return `${label}の2つ目の時間帯は、1つ目が終わってからにしてください`;
  return null;
}
// 連続自習の最低時間を 90分 に変更（以前の初期値20分のまま保存されている場合だけ、1回だけ直す）
(function migrate() {
  if (getSetting('ganbari_streak90') === '1') return;
  try {
    const saved = JSON.parse(getSetting('ganbari', '{}'));
    if (saved.streakMin === 20) { saved.streakMin = 90; setSetting('ganbari', JSON.stringify(saved)); }
  } catch (e) { /* 設定がまだない */ }
  setSetting('ganbari_streak90', '1');
})();
// 入力のチェックをしてから保存する。エラーならメッセージを返す
// 数える時間帯・1日の上限・曜日ごとの設定を、t（中学生の設定か高校生の設定）に入れる。エラーならメッセージを返す
function applyRules(c, p) {
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  if (p.window || p.window2 !== undefined) {
    const w1 = p.window || c.window, w2 = p.window2 !== undefined ? p.window2 : c.window2;
    const err = checkWindows(w1.start, w1.end, w2 ? w2.start : null, w2 ? w2.end : null, '数える');
    if (err) return err;
    c.window = { start: w1.start, end: w1.end };
    c.window2 = w2 ? { start: w2.start, end: w2.end } : null;
  }
  if (p.dailyCap !== undefined) { if (!int(p.dailyCap, 10, 1440)) return '1日の上限は10〜1440分にしてください'; c.dailyCap = p.dailyCap; }
  if (p.weekly !== undefined) {
    if (p.weekly === null) c.weekly = null;
    else {
      if (!Array.isArray(p.weekly) || p.weekly.length !== 7) return '曜日ごとの設定は日〜土の7つです';
      const w = [];
      for (let i = 0; i < 7; i++) {
        const d = p.weekly[i] || {};
        const on = !!d.on, cap = d.cap === undefined ? c.dailyCap : d.cap;
        const has2 = d.start2 != null || d.end2 != null;
        if (on) {
          const err = checkWindows(d.start, d.end, has2 ? d.start2 : null, has2 ? d.end2 : null, `${WEEKDAYS[i]}曜日`);
          if (err) return err;
          if (!int(cap, 10, 1440)) return `${WEEKDAYS[i]}曜日の上限は10〜1440分にしてください`;
        }
        const ok2 = has2 && !checkWindows(d.start, d.end, d.start2, d.end2, '');
        w.push({
          on, start: RE_HM.test(d.start || '') ? d.start : '00:00', end: RE_HM.test(d.end || '') ? d.end : '24:00',
          start2: ok2 ? d.start2 : null, end2: ok2 ? d.end2 : null, cap: int(cap, 10, 1440) ? cap : c.dailyCap,
        });
      }
      if (!w.some(x => x.on)) return '数える曜日を1つ以上えらんでください';
      c.weekly = w;
    }
  }
  return null;
}
function setConfig(patch, actorId) {
  const c = getConfig();
  const p = patch || {};
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  let err = applyRules(c, p);
  if (err) return err;
  if (p.hs !== undefined) {
    const h = p.hs || {};
    const hs = { ...c.hs };
    err = applyRules(hs, h);
    if (err) return '高校生：' + err;
    if (h.sessionsPerWeek !== undefined) { if (!int(h.sessionsPerWeek, 1, 7)) return '高校生：週の回数は1〜7回にしてください'; hs.sessionsPerWeek = h.sessionsPerWeek; }
    if (h.sessionMinutes !== undefined) { if (!int(h.sessionMinutes, 10, 720)) return '高校生：1回の時間は10〜720分にしてください'; hs.sessionMinutes = h.sessionMinutes; }
    if (h.weekBonus !== undefined) { if (!int(h.weekBonus, 0, 1000)) return '高校生：週のボーナスは0〜1000ポイントにしてください'; hs.weekBonus = h.weekBonus; }
    if (h.lateMinutes !== undefined) { if (!int(h.lateMinutes, 1, 240)) return '高校生：遅れの通知は1〜240分後にしてください'; hs.lateMinutes = h.lateMinutes; }
    c.hs = hs;
  }
  if (p.streakByGrade !== undefined) {
    const g = p.streakByGrade;
    if (!g || typeof g !== 'object' || Array.isArray(g)) return '学年別の最低時間が正しくありません';
    const out = {};
    for (const [k, v] of Object.entries(g)) {
      if (!GRADES.includes(k)) return '学年が正しくありません';
      if (!int(v, 1, 600)) return `${k}の連続自習の最低時間は1〜600分にしてください`;
      out[k] = v;
    }
    c.streakByGrade = out;
  }
  if (p.fun !== undefined) {
    const f = p.fun || {}, out = { ...c.fun };
    for (const k of ['santa', 'asakatsu']) if (f[k] !== undefined) out[k] = !!f[k];
    const lim = { santaDays: [1, 30, 'がんばりサンタの日数は1〜30日'],
      asakatsuMinutes: [1, 120, '朝活の時間は1〜120分'], asakatsuPoints: [0, 100, '朝活のポイントは0〜100'] };
    for (const [k, [mn, mx, msg]] of Object.entries(lim)) {
      if (f[k] === undefined) continue;
      if (!int(f[k], mn, mx)) return msg + 'にしてください';
      out[k] = f[k];
    }
    for (const k of ['asakatsuStart', 'asakatsuEnd']) {
      if (f[k] === undefined) continue;
      if (!RE_HM.test(f[k]) || f[k] === '24:00') return '朝活の時間帯が正しくありません';
      out[k] = f[k];
    }
    if (out.asakatsuStart >= out.asakatsuEnd) return '朝活の時間帯が正しくありません（はじめ ＜ おわり）';
    c.fun = out;
  }
  if (p.birthdayMessage !== undefined) {
    const m = String(p.birthdayMessage || '').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, '').trim();
    if (!m || m.length > 100) return '誕生日カードのひとことは1〜100文字にしてください';
    c.birthdayMessage = m;
  }
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
    if (!Array.isArray(p.trees) || p.trees.length !== 4) return '木は4本です（中学生3本・高校生1本）';
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
  if (p.dressup !== undefined) {
    const d = p.dressup || {};
    if (!['always', 'periods'].includes(d.mode)) return '着せかえ期間の設定が正しくありません';
    const periods = Array.isArray(d.periods) ? d.periods : [];
    if (periods.length > 20) return '着せかえ期間は20個までです';
    const clean = [];
    for (const pr of periods) {
      const name = String((pr && pr.name) || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
      if (!RE_DAY.test((pr && pr.start) || '') || !RE_DAY.test((pr && pr.end) || '') || pr.start > pr.end) return '着せかえ期間の日付を正しく入れてください（始まり ≦ 終わり）';
      clean.push({ name, start: pr.start, end: pr.end });
    }
    if (d.mode === 'periods' && !clean.length) return '着せかえ期間を1つ以上入れてください';
    c.dressup = { mode: d.mode, periods: clean };
  }
  if (p.events !== undefined) {
    const ev = {};
    for (const e of EVENTS) ev[e.id] = !(p.events && p.events[e.id] === false);
    c.events = ev;
  }
  setSetting('ganbari', JSON.stringify(c));
  if (actorId) audit(actorId, 'ganbari.config', null, null);
  return null;
}

// 着せかえできる（見える）期間か
function dressupOpen(date = new Date(), c = getConfig()) {
  if (c.dressup.mode !== 'periods') return true;
  const day = jst(date).day;
  return c.dressup.periods.some(p => day >= p.start && day <= p.end);
}
function dressupInfo(date = new Date(), c = getConfig()) {
  const day = jst(date).day;
  const open = dressupOpen(date, c);
  const now = c.dressup.mode === 'periods' ? c.dressup.periods.find(p => day >= p.start && day <= p.end) || null : null;
  const next = c.dressup.mode === 'periods' ? c.dressup.periods.filter(p => p.start > day).sort((a, b) => a.start.localeCompare(b.start))[0] || null : null;
  return { open, mode: c.dressup.mode, now, next };
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
// ポイントになる時間（時間帯の中・1日の上限まで）
const totalExpr = 'COALESCE(manual_min, auto_min)';
// 勉強時間（全部）：時間帯の外・上限をこえた分もふくむ。🔥・がんばりサンタ・表示・保護者の画面に使う
const allExpr = 'MAX(all_min, COALESCE(manual_min, auto_min))';
{ // 「勉強時間（全部）」の列を足す（1回だけ）
  const cols = db.prepare('PRAGMA table_info(study_days)').all().map(c => c.name);
  if (!cols.includes('all_min')) db.exec('ALTER TABLE study_days ADD COLUMN all_min INTEGER NOT NULL DEFAULT 0');
}
function dayAll(userId, day) {
  const r = db.prepare(`SELECT ${allExpr} AS m FROM study_days WHERE user_id = ? AND day = ?`).get(userId, day);
  return r ? r.m : 0;
}
function allBetween(userId, from, to) {
  return db.prepare(`SELECT COALESCE(SUM(${allExpr}), 0) AS m FROM study_days WHERE user_id = ? AND day BETWEEN ? AND ?`).get(userId, from, to).m;
}
// 1分を記録する。point=true ならポイントになる時間にも足す（勉強時間（全部）はいつも足す）
const upMinute = () => db.prepare(`INSERT INTO study_days (user_id, day, auto_min, all_min) VALUES (?, ?, ?, 1)
  ON CONFLICT(user_id, day) DO UPDATE SET all_min = MAX(all_min, auto_min) + 1, auto_min = auto_min + excluded.auto_min`);
function dayTotal(userId, day) {
  const r = db.prepare(`SELECT ${totalExpr} AS m FROM study_days WHERE user_id = ? AND day = ?`).get(userId, day);
  return r ? r.m : 0;
}
function minutesBetween(userId, from, to) {
  return db.prepare(`SELECT COALESCE(SUM(${totalExpr}), 0) AS m FROM study_days WHERE user_id = ? AND day BETWEEN ? AND ?`).get(userId, from, to).m;
}
function daysBetween(userId, from, to) {
  return db.prepare(`SELECT day, auto_min AS auto, manual_min AS manual, ${totalExpr} AS total, ${allExpr} AS "all" FROM study_days WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day`).all(userId, from, to);
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
  const rules = { jh: ruleFor(t.day, c), hs: ruleFor(t.day, c, 'hs') };
  const open = (r) => r.on && r.windows.some(w => t.hm >= w.start && t.hm < w.end);
  const added = []; // ポイントになる時間に足した生徒
  Object.defineProperty(added, 'counted', { value: [], enumerable: false }); // 勉強時間（全部）に足した生徒（時間帯の外もふくむ）
  const up = upMinute();
  db.exec('BEGIN');
  try {
    for (const p of online.values()) {
      if (p.user.role !== 'student' || p.user.trial_until || !SM.isStudyRoom(p.room) || p.away) continue; // 体験中の子は記録しない
      if (c.requireSeat && !p.seat) continue;
      if (c.requireCamera && opt.photosOn && !p.studyCam) continue;
      const r = rules[isHS(p.user.grade) ? 'hs' : 'jh'];
      const point = open(r) && dayTotal(p.id, t.day) < r.cap;
      up.run(p.id, t.day, point ? 1 : 0);
      added.counted.push(p.id);
      if (point) added.push(p.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return added;
}

/**
 * 通信が切れていた間の自習時間を足す（すぐにつながり直したときだけ realtime から呼ぶ）
 * 切れていた時間の1分ごとに、数える時間帯・1日の上限をたしかめて足す
 * @returns {number} 足した分
 */
function creditGap(userId, fromMs, toMs, maxMin = 5) {
  const c = getConfig();
  const n = Math.min(maxMin, Math.floor((toMs - fromMs) / 60_000));
  if (n <= 0) return 0;
  const up = upMinute();
  let added = 0;
  const u = db.prepare('SELECT grade FROM users WHERE id = ?').get(userId);
  const group = u && isHS(u.grade) ? 'hs' : null;
  for (let i = 1; i <= n; i++) {
    const t = jst(new Date(fromMs + i * 60_000));
    const r = ruleFor(t.day, c, group);
    const point = r.on && r.windows.some(w => t.hm >= w.start && t.hm < w.end) && dayTotal(userId, t.day) < r.cap;
    up.run(userId, t.day, point ? 1 : 0); // 勉強時間（全部）はいつも足す
    if (point) added++;
  }
  return added;
}

// その生徒の連続自習🔥の最低時間（学年別の設定があればそれ）
function streakMinFor(userId, c = getConfig()) {
  const u = db.prepare('SELECT grade FROM users WHERE id = ?').get(userId);
  const g = u && u.grade;
  return (g && c.streakByGrade && Number.isInteger(c.streakByGrade[g])) ? c.streakByGrade[g] : c.streakMin;
}
// 連続自習の日数（今日まだ達していなくても、昨日まで続いていれば数える）
function streak(userId, date = new Date()) {
  const c = getConfig();
  const gu = db.prepare('SELECT grade FROM users WHERE id = ?').get(userId);
  if (gu && isHS(gu.grade)) return hsWeeks(userId, date, c).streak; // 高校生は「週」で数える
  const min = streakMinFor(userId, c);
  const today = jst(date).day;
  const rows = db.prepare(`SELECT day, ${allExpr} AS m FROM study_days WHERE user_id = ? AND day <= ? AND day >= ? ORDER BY day DESC`)
    .all(userId, today, addDays(today, -400));
  const ok = new Set(rows.filter(r => r.m >= min).map(r => r.day));
  // 数えない曜日（お休みの曜日）は、とばしてつなげる。その日に自習していれば1日に数える
  const md = meetingDays();
  const cu = db.prepare('SELECT class_days FROM users WHERE id = ?').get(userId);
  const classDays = new Set(cu && cu.class_days ? cu.class_days.split(',').map(Number) : []);
  // 保護者会の日・その生徒の授業の曜日も、とばしてつなげる
  const off = (d) => !ruleFor(d, c).on || md.has(d) || classDays.has(weekdayOf(d));
  let day = today;
  if (!ok.has(day)) day = addDays(day, -1);
  let n = 0;
  for (let i = 0; i < 400; i++, day = addDays(day, -1)) {
    if (ok.has(day)) n++;
    else if (!off(day)) break;
  }
  return n;
}

// ───────── ポイントと着せかえ ─────────
// months: 買える月（期間限定）。なければいつでも
const SHOP = [
  // 帽子・かざり（絵文字で表示）
  { id: 'cap', slot: 'head', emoji: '🧢', name: 'キャップ', price: 20 },
  { id: 'ribbon', slot: 'head', emoji: '🎀', name: 'リボン', price: 20 },
  { id: 'strawhat', slot: 'head', emoji: '👒', name: 'むぎわら帽子', price: 40 },
  { id: 'tophat', slot: 'head', emoji: '🎩', name: 'シルクハット', price: 60 },
  { id: 'helmet', slot: 'head', emoji: '⛑️', name: 'ヘルメット', price: 60 },
  { id: 'gradcap', slot: 'head', emoji: '🎓', name: '博士の帽子', price: 100 },
  { id: 'crown', slot: 'head', emoji: '👑', name: '王冠', price: 200 },
  { id: 'sakura', slot: 'head', emoji: '🌸', name: '桜の髪かざり', price: 30, months: [3, 4, 5] },
  { id: 'sunflower', slot: 'head', emoji: '🌻', name: 'ひまわり', price: 30, months: [7, 8] },
  { id: 'maple', slot: 'head', emoji: '🍁', name: 'もみじ', price: 30, months: [10, 11] },
  { id: 'santa', slot: 'head', emoji: '🎅', name: 'サンタ', price: 40, months: [12] },
  { id: 'star', slot: 'head', emoji: '🌟', name: 'スターのかんむり', price: 400 },
  { id: 'rainbow', slot: 'head', emoji: '🌈', name: 'にじのわっか', price: 600 },
  { id: 'diamond', slot: 'head', emoji: '💎', name: 'ダイヤのかざり', price: 1000 },
  // 誕生日のプレゼント（お店では買えない。誕生日に入室するともらえる）
  { id: 'bday_cake', slot: 'head', emoji: '🎂', name: 'バースデーケーキの帽子', price: 0, special: 'birthday' },
  // 友だち紹介でしかもらえないアイテム
  { id: 'friend_chick', slot: 'pet', emoji: '🐥', name: 'なかよしひよこ（おそろい）', price: 0, special: 'friend' },
  { id: 'pair_star', slot: 'head', emoji: '💫', name: 'ペア自習のきらきら星', price: 0, special: 'friend' },
  // がんばりサンタのプレゼント（12月にがんばった人だけ。お店では買えない）
  { id: 'x_star', slot: 'head', emoji: '🌟', name: 'ツリーの星', price: 0, special: 'santa' },
  { id: 'x_reindeer', slot: 'pet', emoji: '🦌', name: 'トナカイ', price: 0, special: 'santa' },
  { id: 'x_snow', slot: 'pet', emoji: '☃️', name: 'ゆきだるまくん', price: 0, special: 'santa' },
  { id: 'x_candy', slot: 'hand', emoji: '🍭', name: 'キャンディの杖', price: 0, special: 'santa' },
  { id: 'x_bell', slot: 'hand', emoji: '🔔', name: 'クリスマスベル', price: 0, special: 'santa' },
  // 洋服（形と色で表示）
  { id: 'uniform', slot: 'clothes', style: 'uniform', emoji: '👔', name: '制服', price: 30 },
  { id: 'parka', slot: 'clothes', style: 'parka', emoji: '🧥', name: 'パーカー', price: 30 },
  { id: 'jersey', slot: 'clothes', style: 'jersey', emoji: '🏃', name: 'ジャージ', price: 40 },
  { id: 'kimono', slot: 'clothes', style: 'kimono', emoji: '👘', name: '着物', price: 80 },
  { id: 'dress', slot: 'clothes', style: 'dress', emoji: '👗', name: 'ドレス', price: 100 },
  { id: 'tuxedo', slot: 'clothes', style: 'tuxedo', emoji: '🤵', name: 'タキシード', price: 100 },
  { id: 'armor', slot: 'clothes', style: 'armor', emoji: '🛡️', name: 'よろい', price: 150 },
  { id: 'hero', slot: 'clothes', style: 'hero', emoji: '🦸', name: 'ヒーロースーツ', price: 200 },
  { id: 'ninja', slot: 'clothes', style: 'ninja', emoji: '🥷', name: '忍者の服', price: 300 },
  { id: 'astronaut', slot: 'clothes', style: 'astronaut', emoji: '👨‍🚀', name: '宇宙服', price: 500 },
  { id: 'king', slot: 'clothes', style: 'king', emoji: '🤴', name: '王様のマント', price: 800 },
  // 眼鏡
  { id: 'glasses', slot: 'face', emoji: '👓', name: 'メガネ', price: 30 },
  { id: 'sunglasses', slot: 'face', emoji: '🕶️', name: 'サングラス', price: 40 },
  { id: 'goggles', slot: 'face', emoji: '🥽', name: 'ゴーグル', price: 60 },
  { id: 'mask', slot: 'face', emoji: '🎭', name: '仮面', price: 300 },
  // 手に持つもの（杖・剣など）
  { id: 'wand', slot: 'hand', emoji: '🪄', name: '魔法の杖', price: 60 },
  { id: 'sword', slot: 'hand', emoji: '🗡️', name: '剣', price: 80 },
  { id: 'shield', slot: 'hand', emoji: '🛡️', name: '盾', price: 90 },
  { id: 'bow', slot: 'hand', emoji: '🏹', name: '弓矢', price: 100 },
  { id: 'swords', slot: 'hand', emoji: '⚔️', name: '二刀流', price: 150 },
  { id: 'trident', slot: 'hand', emoji: '🔱', name: '伝説の槍', price: 250 },
  { id: 'thunder', slot: 'hand', emoji: '⚡', name: 'いなずまの杖', price: 400 },
  { id: 'meteor', slot: 'hand', emoji: '🌠', name: 'ながれ星のステッキ', price: 600 },
  { id: 'trophy', slot: 'hand', emoji: '🏆', name: '自習王のトロフィー', price: 1000 },
  // ペット
  { id: 'chick', slot: 'pet', emoji: '🐤', name: 'ひよこ', price: 40 },
  { id: 'cat', slot: 'pet', emoji: '🐱', name: 'ねこ', price: 60 },
  { id: 'dog', slot: 'pet', emoji: '🐶', name: 'いぬ', price: 60 },
  { id: 'rabbit', slot: 'pet', emoji: '🐰', name: 'うさぎ', price: 60 },
  { id: 'panda', slot: 'pet', emoji: '🐼', name: 'パンダ', price: 100 },
  { id: 'unicorn', slot: 'pet', emoji: '🦄', name: 'ユニコーン', price: 180 },
  { id: 'dragon', slot: 'pet', emoji: '🐲', name: 'ドラゴン', price: 250 },
  { id: 'lion', slot: 'pet', emoji: '🦁', name: 'ライオン', price: 300 },
  { id: 'eagle', slot: 'pet', emoji: '🦅', name: 'わし', price: 350 },
  { id: 'peacock', slot: 'pet', emoji: '🦚', name: 'くじゃく', price: 450 },
  { id: 'whale', slot: 'pet', emoji: '🐳', name: 'くじら', price: 600 },
  { id: 'brachio', slot: 'pet', emoji: '🦕', name: '首長りゅう', price: 800 },
  { id: 'pumpkin', slot: 'pet', emoji: '🎃', name: 'かぼちゃ', price: 50, months: [10] },
  { id: 'snowman', slot: 'pet', emoji: '⛄', name: '雪だるま', price: 50, months: [12, 1, 2] },
  // 着ぐるみ（体と頭をすっぽり。着ているあいだは帽子・洋服は表示しない）
  { id: 'k_bear', slot: 'costume', style: 'bear', emoji: '🐻', name: 'くまの着ぐるみ', price: 150 },
  { id: 'k_cat', slot: 'costume', style: 'cat', emoji: '😺', name: 'ねこの着ぐるみ', price: 150 },
  { id: 'k_rabbit', slot: 'costume', style: 'rabbit', emoji: '🐇', name: 'うさぎの着ぐるみ', price: 150 },
  { id: 'k_penguin', slot: 'costume', style: 'penguin', emoji: '🐧', name: 'ペンギンの着ぐるみ', price: 180 },
  { id: 'k_panda', slot: 'costume', style: 'panda', emoji: '🐼', name: 'パンダの着ぐるみ', price: 200 },
  { id: 'k_dino', slot: 'costume', style: 'dino', emoji: '🦖', name: 'きょうりゅうの着ぐるみ', price: 300 },
  { id: 'k_unicorn', slot: 'costume', style: 'unicorn', emoji: '🦄', name: 'ユニコーンの着ぐるみ', price: 500 },
  { id: 'k_dragon', slot: 'costume', style: 'dragon', emoji: '🐉', name: 'ドラゴンの着ぐるみ', price: 800 },
];
const itemById = (id) => SHOP.find(i => i.id === id);

function points(userId, date = new Date()) {
  const c = getConfig();
  const today = jst(date).day;
  // ポイントは年度をまたいで引きつぐ（数え始めた日からの合計）
  const gu = db.prepare('SELECT grade, role FROM users WHERE id = ?').get(userId);
  if (gu && gu.role === 'parent') { // 保護者：毎日の問題で正解した数がポイント（1問1ポイント）
    const earnedP = db.prepare('SELECT COUNT(*) AS n FROM parent_quiz WHERE user_id = ? AND correct = 1').get(userId).n
      + db.prepare('SELECT COALESCE(SUM(points), 0) AS s FROM bonus_points WHERE user_id = ?').get(userId).s; // 紹介のボーナスなど
    const spentP = db.prepare('SELECT COALESCE(SUM(price), 0) AS s FROM shop_owned WHERE user_id = ?').get(userId).s;
    return { earned: earnedP, spent: spentP, balance: earnedP - spentP, yearMinutes: 0 };
  }
  const bonus = gu && isHS(gu.grade) ? hsWeeks(userId, date, c).achievedWeeks * c.hs.weekBonus : 0; // 高校生：週のノルマ達成ボーナス
  const extra = db.prepare('SELECT COALESCE(SUM(points), 0) AS s FROM bonus_points WHERE user_id = ?').get(userId).s; // 朝活など
  const earned = Math.floor(minutesBetween(userId, c.pointsFrom, today) / c.minutesPerPoint) + bonus + extra;
  const spent = db.prepare('SELECT COALESCE(SUM(price), 0) AS s FROM shop_owned WHERE user_id = ?').get(userId).s;
  return { earned, spent, balance: earned - spent, yearMinutes: minutesBetween(userId, c.yearStart, today) };
}
function owned(userId) {
  // 買ったアイテムも年度をまたいで持ち続ける
  return db.prepare('SELECT DISTINCT item FROM shop_owned WHERE user_id = ?').all(userId).map(r => r.item);
}
const EMPTY_EQUIP = () => Object.fromEntries(SLOTS.map(sl => [sl, null]));
// 表示用：絵文字（帽子・眼鏡・手・ペット）と、形の名前（洋服・着ぐるみ）
// opts.ignorePeriod: 期間外でも、持ち主の確認用に中身を返す
function getEquip(userId, opts = {}) {
  const c = getConfig();
  const r = db.prepare('SELECT * FROM avatar_equip WHERE user_id = ?').get(userId);
  const ids = r ? Object.fromEntries(SLOTS.map(sl => [sl, r[sl] || null])) : EMPTY_EQUIP(); // 新年度になっても、つけたまま
  const visible = opts.ignorePeriod || dressupOpen(opts.date, c);
  const out = EMPTY_EQUIP();
  if (visible) {
    for (const sl of SLOTS) {
      const it = ids[sl] && itemById(ids[sl]);
      if (it) out[sl] = it.style || it.emoji;
    }
  }
  return { ...out, ids, hidden: !visible };
}
function buy(userId, itemId, date = new Date()) {
  const item = itemById(itemId);
  if (!item) return 'そのアイテムはありません';
  if (!dressupOpen(date)) return '今は着せかえ期間ではありません';
  if (item.months && !item.months.includes(jst(date).month)) return 'このアイテムは今は買えません（期間限定）';
  if (owned(userId).includes(itemId)) return 'もう持っています';
  if (item.special) return 'このアイテムはお店では買えません';
  const pt = points(userId, date);
  if (pt.balance < item.price) return `ポイントが足りません（あと${item.price - pt.balance}ポイント）`;
  db.prepare('INSERT INTO shop_owned (user_id, item, year_start, price, bought_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, itemId, getConfig().yearStart, item.price, now());
  return null;
}
function equip(userId, slot, itemId, date = new Date()) {
  if (!SLOTS.includes(slot)) return 'つける場所が正しくありません';
  if (!dressupOpen(date)) return '今は着せかえ期間ではありません';
  if (itemId !== null) {
    const item = itemById(itemId);
    if (!item || item.slot !== slot) return 'そのアイテムはここにはつけられません';
    if (!owned(userId).includes(itemId)) return 'まだ持っていません';
  }
  const c = getConfig();
  const cur = db.prepare('SELECT * FROM avatar_equip WHERE user_id = ?').get(userId);
  const base = cur || EMPTY_EQUIP();
  const next = { ...EMPTY_EQUIP(), ...Object.fromEntries(SLOTS.map(sl => [sl, base[sl] || null])), [slot]: itemId };
  db.prepare(`INSERT INTO avatar_equip (user_id, year_start, ${SLOTS.join(', ')}) VALUES (?, ?, ${SLOTS.map(() => '?').join(', ')})
    ON CONFLICT(user_id) DO UPDATE SET year_start = excluded.year_start, ${SLOTS.map(sl => `${sl} = excluded.${sl}`).join(', ')}`)
    .run(userId, c.yearStart, ...SLOTS.map(sl => next[sl]));
  return null;
}
function shopFor(userId, date = new Date()) {
  const month = jst(date).month;
  const have = new Set(owned(userId));
  return SHOP.filter(i => !i.special || have.has(i.id)) // 特別なアイテムは、もらった人にだけ見える
    .map(i => ({ ...i, owned: have.has(i.id), available: !i.months || i.months.includes(month), limited: !!i.months }));
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
  const ev = currentEvent(date);
  const c = getConfig();
  const term = termOverride || termOf(jst(date).day, c);
  const trees = c.trees.map((t, i) => {
    const students = db.prepare(`SELECT id, display_name AS name FROM users WHERE role = 'student' AND is_active = 1 AND trial_until IS NULL AND grade IN (${t.grades.map(() => '?').join(',')})`).all(...t.grades);
    let sum = 0;
    if (term) for (const s of students) sum += minutesBetween(s.id, term.start, term.end);
    const avg = students.length ? sum / students.length : 0; // 人数の差が出ないように「平均」
    const stage = stageOf(avg, c);
    const goals = term ? db.prepare(`SELECT u.display_name AS name, g.text, g.achieved FROM goals g JOIN users u ON u.id = g.user_id
      WHERE g.term_key = ? AND g.status = 'approved' AND u.is_active = 1 AND u.grade IN (${t.grades.map(() => '?').join(',')}) ORDER BY g.id`).all(term.key, ...t.grades) : [];
    const birthday = students.some(s => { const b = birthdayInfo(s.id, date); return b && b.public; });
    return {
      index: i, name: t.name, grades: t.grades, students: students.length, avgMinutes: Math.round(avg), birthday,
      stage, stageName: STAGE_NAMES[stage], nextHours: c.stages[stage + 1] ?? null,
      goals: goals.map(g => ({ name: g.name, text: g.text, achieved: !!g.achieved })),
    };
  });
  return { term, trees, event: ev ? { id: ev.id, name: ev.name } : null };
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
  return db.prepare("SELECT id, display_name AS name, grade FROM users WHERE role = 'student' AND is_active = 1 AND trial_until IS NULL ORDER BY grade, display_name").all().map(s => {
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
    for (const u of db.prepare("SELECT id, grade FROM users WHERE role = 'student' AND grade IS NOT NULL AND trial_until IS NULL").all()) {
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

// ───────── 高校生：週のノルマ・週の連続・称号 ─────────
// その日をふくむ週の月曜日
const mondayOf = (day) => addDays(day, -((weekdayOf(day) + 6) % 7));
/**
 * 高校生の週の記録
 * @returns {{ week:{start,sessions,need,minutes,needMinutes,achieved}, today:{minutes,sessionMinutes,done}, streak:number, achievedWeeks:number }}
 */
function hsWeeks(userId, date = new Date(), c = getConfig()) {
  const hs = c.hs, today = jst(date).day, mon = mondayOf(today);
  const rows = db.prepare(`SELECT day, ${allExpr} AS m FROM study_days WHERE user_id = ? AND day >= ? AND day <= ?`).all(userId, mondayOf(c.pointsFrom), today); // 🔥（週）は勉強時間（全部）で数える
  const byWeek = new Map(); // 月曜日 -> { sessions, minutes }
  for (const r of rows) {
    const w = mondayOf(r.day), v = byWeek.get(w) || { sessions: 0, minutes: 0 };
    v.minutes += r.m; if (r.m >= hs.sessionMinutes) v.sessions++;
    byWeek.set(w, v);
  }
  // 保護者会の日（自習できなかった日）は、1回分に数える
  const done = new Set(rows.filter(r => r.m >= hs.sessionMinutes).map(r => r.day));
  for (const d of meetingDays()) {
    if (d < mondayOf(c.pointsFrom) || d > today || done.has(d)) continue;
    const w = mondayOf(d), v = byWeek.get(w) || { sessions: 0, minutes: 0 };
    v.sessions++; byWeek.set(w, v);
  }
  const ok = (w) => (byWeek.get(w) || { sessions: 0 }).sessions >= hs.sessionsPerWeek;
  let achievedWeeks = 0;
  for (const w of byWeek.keys()) if (ok(w)) achievedWeeks++;
  let streak = 0;
  for (let w = ok(mon) ? mon : addDays(mon, -7), i = 0; i < 300 && ok(w); i++, w = addDays(w, -7)) streak++;
  const cur = byWeek.get(mon) || { sessions: 0, minutes: 0 };
  const todayMin = dayAll(userId, today);
  return {
    week: { start: mon, sessions: cur.sessions, need: hs.sessionsPerWeek, minutes: cur.minutes, needMinutes: hs.sessionsPerWeek * hs.sessionMinutes, achieved: cur.sessions >= hs.sessionsPerWeek },
    today: { minutes: todayMin, sessionMinutes: hs.sessionMinutes, done: todayMin >= hs.sessionMinutes },
    streak, achievedWeeks, bonus: hs.weekBonus,
  };
}
// 高校生の称号（自習時間の合計で決まる）。{ name, hours, next:{ name, hoursLeft } }
function titleOf(userId) {
  const u = db.prepare('SELECT grade FROM users WHERE id = ?').get(userId);
  if (!u || !isHS(u.grade)) return null;
  const total = db.prepare(`SELECT COALESCE(SUM(${totalExpr}), 0) AS m FROM study_days WHERE user_id = ?`).get(userId).m;
  const hours = total / 60;
  let name = null, next = null;
  for (const [h, n] of TITLES) { if (hours >= h) name = n; else { next = { name: n, hoursLeft: Math.ceil(h - hours) }; break; } }
  return { name, hours: Math.floor(hours), next };
}

// 今日やること（3つ）。1つ16文字まで
function setPlan(userId, items, date = new Date()) {
  if (!Array.isArray(items) || items.length !== 3) return '今日やることを3つ書いてください';
  const clean = items.map(t => String(t || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16));
  if (clean.some(t => !t)) return '今日やることを3つとも書いてください';
  db.prepare(`INSERT INTO study_plans (user_id, day, items, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`).run(userId, jst(date).day, JSON.stringify(clean), now());
  return null;
}
function planOf(userId, date = new Date()) {
  const r = db.prepare('SELECT items FROM study_plans WHERE user_id = ? AND day = ?').get(userId, jst(date).day);
  try { return r ? JSON.parse(r.items) : null; } catch (e) { return null; }
}
// 来る曜日と時刻（高校生）。days は 0(日)〜6(土) の配列
function normVisit(days, time) {
  if (days == null || (Array.isArray(days) && !days.length)) return { days: null, time: null };
  if (!Array.isArray(days) || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  if (!RE_HM.test(time || '') || time === '24:00') return null;
  return { days: [...new Set(days)].sort().join(','), time };
}
/**
 * 決めた曜日・時刻を過ぎても来ていない高校生（1日1回だけ返す）
 * @param {Set<number>} onlineIds いまつないでいる人
 */
function lateStudents(onlineIds, date = new Date()) {
  const c = getConfig(), t = jst(date), wd = weekdayOf(t.day);
  const out = [];
  for (const u of db.prepare("SELECT id, display_name AS name, grade, visit_days, visit_time FROM users WHERE role = 'student' AND is_active = 1 AND visit_days IS NOT NULL AND visit_time IS NOT NULL").all()) {
    if (!isHS(u.grade) || !u.visit_days.split(',').map(Number).includes(wd)) continue;
    const [h, m] = u.visit_time.split(':').map(Number);
    const due = h * 60 + m + c.hs.lateMinutes, [nh, nm] = t.hm.split(':').map(Number);
    if (nh * 60 + nm < due) continue;
    if (onlineIds.has(u.id) || dayTotal(u.id, t.day) > 0) continue; // 来ている・今日すでに自習した
    const r = db.prepare('INSERT OR IGNORE INTO late_alerts (user_id, day, sent_at) VALUES (?, ?, ?)').run(u.id, t.day, now());
    if (r.changes) out.push({ id: u.id, name: u.name, weekday: WEEKDAYS[wd], time: u.visit_time });
  }
  return out;
}

// ───────── 誕生日 ─────────
const RE_MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// '04-05' のような月-日。正しくなければ null
function normBirthday(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!RE_MD.test(s)) return undefined;
  const [m, d] = s.split('-').map(Number);
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days ? s : undefined;
}
// 今日がその生徒の誕生日か（2/29生まれは、うるう年でない年は2/28に祝う）。{ public } か null
function birthdayInfo(userId, date = new Date()) {
  const u = db.prepare("SELECT birthday, birthday_public FROM users WHERE id = ? AND role = 'student'").get(userId);
  if (!u || !u.birthday) return null;
  const t = jst(date), md = t.day.slice(5);
  const leap = (t.year % 4 === 0 && t.year % 100 !== 0) || t.year % 400 === 0;
  const today = md === u.birthday || (u.birthday === '02-29' && !leap && md === '02-28');
  return today ? { public: !!u.birthday_public } : null;
}
// 誕生日の日に1回だけ：カードを見せる印をつけ、プレゼントのアイテムをわたす。はじめてなら { gift } を返す
function celebrateBirthday(userId, date = new Date()) {
  if (!birthdayInfo(userId, date)) return null;
  const year = jst(date).year;
  const r = db.prepare('INSERT OR IGNORE INTO birthday_cards (user_id, year, shown_at) VALUES (?, ?, ?)').run(userId, year, now());
  if (!r.changes) return null;
  let gift = false;
  if (!owned(userId).includes('bday_cake')) {
    db.prepare('INSERT INTO shop_owned (user_id, item, year_start, price, bought_at) VALUES (?, ?, ?, 0, ?)').run(userId, 'bday_cake', getConfig().yearStart, now());
    gift = true;
  }
  return { gift, message: getConfig().birthdayMessage };
}

module.exports = {
  itemById, normClassDays, meetingDays, addMeetingDay, removeMeetingDay, RE_DAY,
  setPlan, planOf, normVisit, lateStudents,
  HS_GRADES, isHS, hsWeeks, titleOf, TITLES, mondayOf,
  normBirthday, birthdayInfo, celebrateBirthday,
  creditGap,
  streakMinFor,
  ruleFor, WEEKDAYS,
  SLOTS, EVENTS, currentEvent, dressupOpen, dressupInfo,
  GRADES, STAGE_NAMES, SHOP, jst, addDays, getConfig, setConfig, termOf, allTerms, dayTotal, dayAll, allBetween, minutesBetween, daysBetween, setManual, tick,
  streak, points, owned, getEquip, buy, equip, shopFor, setGoal, goalOf, listGoals, reviewGoal, forest, studentSummary, newYear,
  createReport, reportData,
};
