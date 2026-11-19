// 季節のお楽しみ：がんばりサンタ・朝活チャレンジ
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

// ───────── 🎅 がんばりサンタ（2章立て） ─────────
// 第1章 中間テスト編：10/1〜10/31 に「学年の最低時間（🔥と同じ）」以上自習した日が○日 → サンタから手紙（サンタ帽がもらえる）
// 第2章 期末テスト編：11/1〜11/30 に○日 → 12/1〜12/25 サンタがアバターのうしろについて歩く。両方クリアならトナカイも
db.exec('CREATE TABLE IF NOT EXISTS santa_letters (user_id INTEGER NOT NULL, year INTEGER NOT NULL, read_at TEXT, PRIMARY KEY (user_id, year))');
const CHAPTERS = [
  { key: 'ch1', name: '第1章 中間テスト編', from: '10-01', to: '10-31' },
  { key: 'ch2', name: '第2章 期末テスト編', from: '11-01', to: '11-30' },
];
const PARADE = { from: '12-01', to: '12-25' };
const HAT = 'santa_hat';
function chapterDays(userId, year, ch, today) {
  const from = `${year}-${ch.from}`, to = `${year}-${ch.to}`;
  const rows = db.prepare('SELECT day, MAX(all_min, COALESCE(manual_min, auto_min)) AS m FROM study_days WHERE user_id = ? AND day >= ? AND day <= ?').all(userId, from, to);
  const min = G.streakMinFor(userId); // 中1 45分・中2 60分・中3 90分 など
  const ok = new Set(rows.filter(r => r.m >= min && r.day <= today).map(r => r.day));
  for (const d of G.meetingDays()) if (d >= from && d <= to && d <= today) ok.add(d); // 保護者会の日は1日に数える
  return ok.size;
}
function santaStatus(userId, date = new Date()) {
  const f = cfg(), t = G.jst(date);
  if (!f.santa) return null;
  const m = md(t), year = t.year, need = f.santaDays;
  const phase = m >= CHAPTERS[0].from && m <= CHAPTERS[0].to ? 'ch1' : m >= CHAPTERS[1].from && m <= CHAPTERS[1].to ? 'ch2' : m >= PARADE.from && m <= PARADE.to ? 'parade' : null;
  if (!phase) return null;
  const [d1, d2] = CHAPTERS.map(ch => chapterDays(userId, year, ch, t.day));
  const c1 = d1 >= need, c2 = d2 >= need;
  // 第1章クリア：サンタ帽をプレゼント（1回だけ）・手紙
  if (c1 && !G.owned(userId).includes(HAT)) db.prepare('INSERT INTO shop_owned (user_id, item, year_start, price, bought_at) VALUES (?, ?, ?, 0, ?)').run(userId, HAT, G.getConfig().yearStart, now());
  const letter = db.prepare('SELECT read_at FROM santa_letters WHERE user_id = ? AND year = ?').get(userId, year);
  return {
    year, phase, need, minMinutes: G.streakMinFor(userId),
    chapters: [{ ...CHAPTERS[0], days: d1, cleared: c1 }, { ...CHAPTERS[1], days: d2, cleared: c2 }],
    letter: c1 && !(letter && letter.read_at), // まだ読んでいない手紙がある
    follow: phase === 'parade' && c2 ? (c1 ? ['santa', 'reindeer'] : ['santa']) : [],
  };
}
// 手紙を読んだ
function readLetter(userId, date = new Date()) {
  const st = santaStatus(userId, date);
  if (!st || !st.chapters[0].cleared) return { error: 'まだ手紙は届いていません' };
  db.prepare('INSERT INTO santa_letters (user_id, year, read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, year) DO UPDATE SET read_at = excluded.read_at').run(userId, st.year, now());
  return { ok: true };
}
// いま、うしろについて歩く仲間（12/1〜12/25）
function followersOf(userId, date = new Date()) {
  try { const st = santaStatus(userId, date); return st && st.follow.length ? st.follow : null; } catch (e) { return null; }
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
  awardBadge, badgesOf, santaStatus, readLetter, followersOf, CHAPTERS,
  morningTick, morningStamps, morningStatus, statusFor,
};
