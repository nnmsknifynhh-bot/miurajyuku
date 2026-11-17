// 季節のお楽しみ：がんばりサンタ・年越し自習・朝活チャレンジ（とバッジ）
const { db, now } = require('./db');
const G = require('./ganbari');

db.exec(`
CREATE TABLE IF NOT EXISTS badges (user_id INTEGER NOT NULL, badge TEXT NOT NULL, label TEXT NOT NULL, emoji TEXT NOT NULL, earned_at TEXT NOT NULL, PRIMARY KEY (user_id, badge));
CREATE TABLE IF NOT EXISTS santa_gifts (user_id INTEGER NOT NULL, year INTEGER NOT NULL, item TEXT NOT NULL, opened_at TEXT NOT NULL, PRIMARY KEY (user_id, year));
CREATE TABLE IF NOT EXISTS study_morning (user_id INTEGER NOT NULL, day TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
`);

const cfg = () => G.getConfig().fun;
const md = (t) => t.day.slice(5);

// ───────── バッジ ─────────
function awardBadge(userId, badge, label, emoji) {
  return db.prepare('INSERT OR IGNORE INTO badges (user_id, badge, label, emoji, earned_at) VALUES (?, ?, ?, ?, ?)').run(userId, badge, label, emoji, now()).changes > 0;
}
function badgesOf(userId) {
  return db.prepare('SELECT badge, label, emoji, earned_at AS at FROM badges WHERE user_id = ? ORDER BY earned_at').all(userId);
}
function bonus(userId, reason, points) {
  if (!points) return false;
  return db.prepare('INSERT OR IGNORE INTO bonus_points (user_id, reason, points, created_at) VALUES (?, ?, ?, ?)').run(userId, reason, points, now()).changes > 0;
}

// ───────── 🎅 がんばりサンタ ─────────
// 11/1〜11/30 に「学年ごとの1日の最低時間（連続自習🔥と同じ）」以上自習した日が○日以上なら、12/1〜12/7 にプレゼント箱が開けられる
function santaStatus(userId, date = new Date()) {
  const f = cfg(), t = G.jst(date);
  if (!f.santa) return null;
  const m = md(t);
  const inCount = m >= '11-01' && m <= '11-30';
  const inGift = m >= '12-01' && m <= '12-07';
  if (!inCount && !inGift) return null;
  const year = t.year;
  const rows = db.prepare('SELECT day, COALESCE(manual_min, auto_min) AS m FROM study_days WHERE user_id = ? AND day >= ? AND day <= ?').all(userId, `${year}-11-01`, `${year}-11-30`);
  const min = G.streakMinFor(userId); // 中1 45分・中2 60分・中3 90分 など
  const days = rows.filter(r => r.m >= min).length;
  const opened = db.prepare('SELECT item FROM santa_gifts WHERE user_id = ? AND year = ?').get(userId, year);
  return { year, phase: inCount ? 'count' : 'gift', days, need: f.santaDays, minMinutes: min, eligible: days >= f.santaDays, opened: opened ? opened.item : null };
}
function openSanta(userId, date = new Date()) {
  const st = santaStatus(userId, date);
  if (!st || st.phase !== 'gift') return { error: 'プレゼントは12月1日〜7日に開けられます' };
  if (!st.eligible) return { error: `11月に${st.need}日以上自習するともらえます` };
  if (st.opened) return { error: 'もう開けました', item: G.itemById(st.opened) };
  const have = new Set(G.owned(userId));
  const pool = G.SHOP.filter(i => i.special === 'santa' && !have.has(i.id));
  const item = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO santa_gifts (user_id, year, item, opened_at) VALUES (?, ?, ?, ?)').run(userId, st.year, item ? item.id : 'points', now());
    if (item) db.prepare('INSERT INTO shop_owned (user_id, item, year_start, price, bought_at) VALUES (?, ?, ?, 0, ?)').run(userId, item.id, G.getConfig().yearStart, now());
    else bonus(userId, `santa:${st.year}`, 50); // 全部持っていたらポイント
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { item: item ? { id: item.id, emoji: item.emoji, name: item.name } : null, points: item ? 0 : 50 };
}

// ───────── 🎆 年越し自習 ─────────
// 12/31 23:50〜1/1 0:10 に自習室にいた生徒にバッジ（1年に1回）。いまの時刻が対象なら、明けた年（新しい年）を返す
function toshikoshiYear(date = new Date()) {
  const t = G.jst(date);
  if (!cfg().toshikoshi) return null;
  if (md(t) === '12-31' && t.hm >= '23:50') return t.year + 1;
  if (md(t) === '01-01' && t.hm < '00:10') return t.year;
  return null;
}
function awardToshikoshi(userId, year) {
  return awardBadge(userId, `toshikoshi-${year}`, `${year}年 年越し自習`, '🎍');
}

// ───────── 🌅 朝活チャレンジ ─────────
// 朝（初期設定 6:00〜7:30）に自習として数えられた時間が○分になった日に「早起きスタンプ」とポイント
function morningTick(userIds, date = new Date()) {
  const f = cfg(), t = G.jst(date);
  if (!f.asakatsu || t.hm < f.asakatsuStart || t.hm >= f.asakatsuEnd) return [];
  const out = [];
  const up = db.prepare(`INSERT INTO study_morning (user_id, day, minutes) VALUES (?, ?, 1)
    ON CONFLICT(user_id, day) DO UPDATE SET minutes = minutes + 1`);
  for (const id of userIds) {
    up.run(id, t.day);
    const m = db.prepare('SELECT minutes FROM study_morning WHERE user_id = ? AND day = ?').get(id, t.day).minutes;
    if (m !== f.asakatsuMinutes) continue; // ちょうど達したときだけ
    bonus(id, `asa:${t.day}`, f.asakatsuPoints);
    out.push({ id, stamps: morningStamps(id), points: f.asakatsuPoints });
  }
  return out;
}
function morningStamps(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM study_morning WHERE user_id = ? AND minutes >= ?').get(userId, cfg().asakatsuMinutes).n;
}
function morningStatus(userId, date = new Date()) {
  const f = cfg();
  if (!f.asakatsu) return null;
  const r = db.prepare('SELECT minutes FROM study_morning WHERE user_id = ? AND day = ?').get(userId, G.jst(date).day);
  return { today: r ? r.minutes : 0, minutes: f.asakatsuMinutes, stamps: morningStamps(userId), points: f.asakatsuPoints, start: f.asakatsuStart, end: f.asakatsuEnd };
}

// 生徒の画面用まとめ
function statusFor(userId, date = new Date()) {
  return {
    santa: santaStatus(userId, date), morning: morningStatus(userId, date),
    badges: badgesOf(userId),
  };
}

module.exports = {
  awardBadge, badgesOf, santaStatus, openSanta, toshikoshiYear, awardToshikoshi,
  morningTick, morningStamps, morningStatus, statusFor,
};
