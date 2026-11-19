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

// ───────── 季節の2章イベント（🎅 がんばりサンタ・🎋 七夕） ─────────
// 「自習した日」＝学年の最低時間（🔥と同じ。中1 45分・中2 60分・中3 90分など）以上の日。保護者会の日も1日に数える
// 第1章クリア → 手紙と、お店では買えないアイテム。第2章クリア → ごほうびの期間、仲間がうしろについて歩く。両方クリア → 仲間がふえる
// 特別な日（12/25・7/7）は、仲間がついている子のまわりに特別な演出
db.exec('CREATE TABLE IF NOT EXISTS event_letters (user_id INTEGER NOT NULL, event TEXT NOT NULL, year INTEGER NOT NULL, read_at TEXT, PRIMARY KEY (user_id, event, year))');
const EVENTS = {
  santa: {
    on: 'santa', days: 'santaDays', item: 'santa_hat',
    chapters: [
      { key: 'ch1', name: '第1章 中間テスト編', from: '10-01', to: '10-31' },
      { key: 'ch2', name: '第2章 期末テスト編', from: '11-01', to: '11-30' },
    ],
    parade: { from: '12-01', to: '12-25' }, one: ['santa'], both: ['santa', 'reindeer'],
    fxDay: '12-25', fx: 'xmas', fxBoth: false, // 12/25は、サンタがついている子みんな
  },
  tanabata: {
    on: 'tanabata', days: 'tanabataDays', item: 'sasa',
    chapters: [
      { key: 'ch1', name: '第1章 中間テスト編', from: '05-01', to: '05-31' },
      { key: 'ch2', name: '第2章 期末テスト編', from: '06-01', to: '06-30' },
    ],
    parade: { from: '07-01', to: '07-20' }, one: ['hikoboshi'], both: ['hikoboshi', 'orihime'],
    fxDay: '07-07', fx: 'tanabata', fxBoth: true, // 7/7は、織姫と彦星を会わせてあげた子（両方クリア）
  },
};
function chapterDays(userId, year, ch, today) {
  const from = `${year}-${ch.from}`, to = `${year}-${ch.to}`;
  const rows = db.prepare('SELECT day, MAX(all_min, COALESCE(manual_min, auto_min)) AS m FROM study_days WHERE user_id = ? AND day >= ? AND day <= ?').all(userId, from, to);
  const min = G.streakMinFor(userId);
  const ok = new Set(rows.filter(r => r.m >= min && r.day <= today).map(r => r.day));
  for (const d of G.meetingDays()) if (d >= from && d <= to && d <= today) ok.add(d);
  return ok.size;
}
function eventStatus(name, userId, date = new Date()) {
  const ev = EVENTS[name], f = cfg(), t = G.jst(date);
  if (!ev || f[ev.on] === false) return null;
  const m = md(t), year = t.year, need = f[ev.days] || 15;
  const [c1r, c2r] = ev.chapters;
  const phase = m >= c1r.from && m <= c1r.to ? 'ch1' : m >= c2r.from && m <= c2r.to ? 'ch2' : m >= ev.parade.from && m <= ev.parade.to ? 'parade' : null;
  if (!phase) return null;
  const [d1, d2] = ev.chapters.map(ch => chapterDays(userId, year, ch, t.day));
  const c1 = d1 >= need, c2 = d2 >= need;
  if (c1 && !G.owned(userId).includes(ev.item)) db.prepare('INSERT INTO shop_owned (user_id, item, year_start, price, bought_at) VALUES (?, ?, ?, 0, ?)').run(userId, ev.item, G.getConfig().yearStart, now());
  const letter = db.prepare('SELECT read_at FROM event_letters WHERE user_id = ? AND event = ? AND year = ?').get(userId, name, year);
  const follow = phase === 'parade' && c2 ? (c1 ? ev.both : ev.one) : [];
  const fx = follow.length && m === ev.fxDay && (!ev.fxBoth || (c1 && c2)) ? ev.fx : null;
  return {
    event: name, year, phase, need, minMinutes: G.streakMinFor(userId), parade: ev.parade,
    chapters: [{ ...c1r, days: d1, cleared: c1 }, { ...c2r, days: d2, cleared: c2 }],
    letter: c1 && !(letter && letter.read_at), follow, fx,
  };
}
const santaStatus = (userId, date) => eventStatus('santa', userId, date);
const tanabataStatus = (userId, date) => eventStatus('tanabata', userId, date);
function readLetter(userId, name = 'santa', date = new Date()) {
  const st = eventStatus(name, userId, date);
  if (!st || !st.chapters[0].cleared) return { error: 'まだ手紙は届いていません' };
  db.prepare('INSERT INTO event_letters (user_id, event, year, read_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, event, year) DO UPDATE SET read_at = excluded.read_at').run(userId, name, st.year, now());
  return { ok: true };
}
// いま、うしろについて歩く仲間と、特別な日の演出（12/25・7/7）
function followersOf(userId, date = new Date()) {
  for (const name of Object.keys(EVENTS)) {
    try { const st = eventStatus(name, userId, date); if (st && st.follow.length) return st.follow; } catch (e) { /* 次へ */ }
  }
  return null;
}
function fxOf(userId, date = new Date()) {
  for (const name of Object.keys(EVENTS)) {
    try { const st = eventStatus(name, userId, date); if (st && st.fx) return st.fx; } catch (e) { /* 次へ */ }
  }
  return null;
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
    santa: santaStatus(userId, date), tanabata: tanabataStatus(userId, date), morning: morningStatus(userId, date),
    badges: badgesOf(userId),
  };
}

module.exports = {
  awardBadge, badgesOf, EVENTS, eventStatus, santaStatus, tanabataStatus, readLetter, followersOf, fxOf,
  morningTick, morningStamps, morningStatus, statusFor,
};
