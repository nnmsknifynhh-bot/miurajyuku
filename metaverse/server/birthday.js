// 誕生日のお祝い
// ① 🎂を渡す：誕生日の子の近くに行くと渡せる（中学生・高校生どうし。先生・オーナーはだれにでも＝金色の🎂）。同じ相手には1日1回。ポイントはなし
// ② おうちの人の誕生日：子どもがメッセージと「今日の勉強時間」をプレゼントする。保護者の画面に出て、達成すると🌸
const { db, now } = require('./db');
const G = require('./ganbari');

db.exec(`
CREATE TABLE IF NOT EXISTS bday_cakes (to_id INTEGER NOT NULL, from_id INTEGER NOT NULL, day TEXT NOT NULL, gold INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (to_id, from_id, day));
CREATE TABLE IF NOT EXISTS parent_bday_gifts (parent_id INTEGER NOT NULL, student_id INTEGER NOT NULL, day TEXT NOT NULL, message TEXT NOT NULL, minutes INTEGER NOT NULL, done_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY (parent_id, student_id, day));
`);

const isJHorHS = (grade) => /^[中高][1-3]$/.test(grade || '');
const isESgrade = (grade) => /^小[1-6]$/.test(grade || '');

// その月-日が今日か（2/29は、うるう年でない年は2/28）
function isTodayMD(md, date = new Date()) {
  if (!md) return false;
  const t = G.jst(date), today = t.day.slice(5);
  const leap = (t.year % 4 === 0 && t.year % 100 !== 0) || t.year % 400 === 0;
  return today === md || (md === '02-29' && !leap && today === '02-28');
}

// ───────── ① 🎂 ─────────
function giveCake(fromId, toId, gold, date = new Date()) {
  const r = db.prepare('INSERT OR IGNORE INTO bday_cakes (to_id, from_id, day, gold, created_at) VALUES (?, ?, ?, ?, ?)').run(toId, fromId, G.jst(date).day, gold ? 1 : 0, now());
  return r.changes > 0;
}
/** 今日もらった🎂の数 { n, gold } */
function cakesOf(toId, date = new Date()) {
  const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(gold), 0) AS g FROM bday_cakes WHERE to_id = ? AND day = ?').get(toId, G.jst(date).day);
  return { n: r.n, gold: r.g };
}
/** 今日🎂を渡した相手 */
function givenBy(fromId, date = new Date()) {
  return db.prepare('SELECT to_id FROM bday_cakes WHERE from_id = ? AND day = ?').all(fromId, G.jst(date).day).map(r => r.to_id);
}

// ───────── ② おうちの人の誕生日 ─────────
const GIFT_MESSAGES = ['🎉 お誕生日おめでとう！', '💐 いつもありがとう', '😊 これからもよろしくね', '💪 今日もがんばるから見ててね'];
const GIFT_MINUTES = [15, 30, 45, 60, 90, 120];

/** 今日が誕生日の、その子のおうちの人 [{ id, name, sent, minutes }] */
function parentsBirthdayToday(studentId, date = new Date()) {
  const day = G.jst(date).day;
  return db.prepare(`SELECT u.id, u.display_name AS name, u.birthday FROM parent_children pc JOIN users u ON u.id = pc.parent_id
    WHERE pc.student_id = ? AND u.role = 'parent' AND u.is_active = 1 AND u.birthday IS NOT NULL`).all(studentId)
    .filter(r => isTodayMD(r.birthday, date))
    .map(r => {
      const g = db.prepare('SELECT minutes FROM parent_bday_gifts WHERE parent_id = ? AND student_id = ? AND day = ?').get(r.id, studentId, day);
      return { id: r.id, name: r.name, sent: !!g, minutes: g ? g.minutes : null };
    });
}
function sendParentGift(studentId, parentId, message, minutes, date = new Date()) {
  const p = parentsBirthdayToday(studentId, date).find(x => x.id === parentId);
  if (!p) return { error: '今日が誕生日のおうちの人が見つかりません' };
  if (!GIFT_MESSAGES.includes(message)) return { error: 'メッセージをえらんでください' };
  const m = Number(minutes);
  if (!GIFT_MINUTES.includes(m)) return { error: 'プレゼントする時間をえらんでください' };
  const r = db.prepare('INSERT OR IGNORE INTO parent_bday_gifts (parent_id, student_id, day, message, minutes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(parentId, studentId, G.jst(date).day, message, m, now());
  if (!r.changes) return { error: 'もう送ったよ' };
  checkGifts(studentId, date);
  return { ok: true, name: p.name };
}
/** 今日のプレゼントの時間に届いたか。はじめて届いたものを返す [{ parentId, minutes }] */
function checkGifts(studentId, date = new Date()) {
  const day = G.jst(date).day;
  const rows = db.prepare('SELECT parent_id, minutes FROM parent_bday_gifts WHERE student_id = ? AND day = ? AND done_at IS NULL').all(studentId, day);
  if (!rows.length) return [];
  const all = G.dayAll(studentId, day), done = [];
  for (const r of rows) if (all >= r.minutes) {
    db.prepare('UPDATE parent_bday_gifts SET done_at = ? WHERE parent_id = ? AND student_id = ? AND day = ?').run(now(), r.parent_id, studentId, day);
    done.push({ parentId: r.parent_id, minutes: r.minutes });
  }
  return done;
}
/** 保護者の画面：この7日のプレゼント [{ child, day, message, minutes, studied, done, today }] */
function giftsForParent(parentId, date = new Date()) {
  const today = G.jst(date).day, from = G.addDays(today, -6);
  return db.prepare(`SELECT g.student_id, g.day, g.message, g.minutes, g.done_at, u.display_name AS child FROM parent_bday_gifts g JOIN users u ON u.id = g.student_id
    WHERE g.parent_id = ? AND g.day >= ? ORDER BY g.day DESC, g.created_at`).all(parentId, from)
    .map(r => {
      const studied = G.dayAll(r.student_id, r.day);
      return { child: r.child, day: r.day, message: r.message, minutes: r.minutes, studied, done: !!r.done_at || studied >= r.minutes, today: r.day === today };
    });
}
/** その保護者の誕生日が今日か */
function parentBirthdayToday(parentId, date = new Date()) {
  const u = db.prepare("SELECT birthday FROM users WHERE id = ? AND role = 'parent'").get(parentId);
  return !!(u && isTodayMD(u.birthday, date));
}

module.exports = { isJHorHS, isESgrade, isTodayMD, giveCake, cakesOf, givenBy, GIFT_MESSAGES, GIFT_MINUTES, parentsBirthdayToday, sendParentGift, checkGifts, giftsForParent, parentBirthdayToday };
