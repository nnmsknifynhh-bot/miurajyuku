// 友だち紹介：招待コード・体験アカウント・入塾したときのおそろいアイテム・ペア自習チャレンジ・友だち紹介ウィーク・保護者どうしの紹介
const crypto = require('crypto');
const { db, now, audit, getSetting, setSetting } = require('./db');
const G = require('./ganbari');

db.exec(`
CREATE TABLE IF NOT EXISTS referral_codes (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE);
-- new_id：紹介された人（体験中・入塾した生徒）。referrer_id：紹介した生徒または保護者
CREATE TABLE IF NOT EXISTS referrals (
  new_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  enrolled_at TEXT,          -- 入塾した日時（体験中は NULL）
  pair_start  TEXT,          -- ペア自習チャレンジの初日（生徒どうしの紹介だけ）
  pair_result TEXT           -- 'success' | 'over'
);
`);

const PAIR_DAYS = 7, PAIR_POINTS = 30, PARENT_POINTS = 50;
const ENROLL_ITEM = 'friend_chick', PAIR_ITEM = 'pair_star';

// ── 設定（オーナーが変えられる） ──
const DEFAULTS = { trial: true, trialDays: 3, week: null, weekTrialDays: 7 };
function getConfig() {
  let c = {};
  try { c = JSON.parse(getSetting('referral', '{}')) || {}; } catch (e) { c = {}; }
  return { ...DEFAULTS, ...c };
}
function setConfig(p) {
  const c = getConfig();
  if (p.trial !== undefined) c.trial = !!p.trial;
  for (const k of ['trialDays', 'weekTrialDays']) {
    if (p[k] === undefined) continue;
    const n = Number(p[k]);
    if (!Number.isInteger(n) || n < 1 || n > 30) return '体験の日数は1〜30日にしてください';
    c[k] = n;
  }
  if (p.week !== undefined) {
    if (p.week === null) c.week = null;
    else {
      const { start, end } = p.week || {};
      if (!G.RE_DAY.test(start || '') || !G.RE_DAY.test(end || '') || start > end) return '友だち紹介ウィークの日にちが正しくありません';
      c.week = { start, end };
    }
  }
  setSetting('referral', JSON.stringify(c));
  return null;
}
function weekOn(date = new Date()) {
  const w = getConfig().week, d = G.jst(date).day;
  return !!(w && d >= w.start && d <= w.end);
}
const trialDays = () => (weekOn() ? getConfig().weekTrialDays : getConfig().trialDays);

// ── 招待コード（1人1つ。何回でも使える） ──
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function codeOf(userId) {
  const r = db.prepare('SELECT code FROM referral_codes WHERE user_id = ?').get(userId);
  if (r) return r.code;
  for (let i = 0; i < 20; i++) {
    const code = Array.from(crypto.randomBytes(6), b => ALPHA[b % ALPHA.length]).join('');
    if (db.prepare('INSERT OR IGNORE INTO referral_codes (code, user_id) VALUES (?, ?)').run(code, userId).changes) return code;
  }
  throw new Error('招待コードを作れませんでした');
}
// コードの持ち主（入塾している生徒・保護者だけ）
function inviterOf(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!c) return null;
  return db.prepare(`SELECT u.id, u.display_name AS name, u.role FROM referral_codes rc JOIN users u ON u.id = rc.user_id
    WHERE rc.code = ? AND u.is_active = 1 AND u.role IN ('student', 'parent') AND u.trial_until IS NULL`).get(c) || null;
}

// ── 体験アカウント ──
const recentTrials = new Map(); // ip -> [時刻]（作りすぎ防止）
function startTrial({ code, name, grade }, ip, nowMs = Date.now()) {
  const c = getConfig();
  if (!c.trial) return { error: 'いまは体験の受付をしていません' };
  const inv = inviterOf(code);
  if (!inv) return { error: '招待のリンクが正しくありません。もう一度リンクを開いてください' };
  const list = (recentTrials.get(ip) || []).filter(t => nowMs - t < 3600e3);
  if (list.length >= 5) return { error: '体験の登録が続いています。しばらく待ってからためしてください', status: 429 };
  if (!G.GRADES.includes(grade) || grade === '卒業') return { error: '学年をえらんでください' };
  const nm = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  if (!nm) return { error: 'お名前（ニックネーム）を入れてください' };
  const days = trialDays(), until = nowMs + days * 86400e3;
  const id = (() => {
    const r = db.prepare("INSERT INTO users (login_id, display_name, role, password_hash, avatar_color, grade, trial_until, created_at, updated_at) VALUES (?, ?, 'student', ?, ?, ?, ?, ?, ?)")
      .run('trial-' + crypto.randomBytes(5).toString('hex'), nm, 'x', '#ffb74d', grade, until, now(), now());
    return Number(r.lastInsertRowid);
  })();
  db.prepare('INSERT INTO referrals (new_id, referrer_id, created_at) VALUES (?, ?, ?)').run(id, inv.id, now());
  list.push(nowMs); recentTrials.set(ip, list);
  audit(id, 'trial.started', String(inv.id), { grade, days }, ip);
  return { id, until, days, inviter: inv.name };
}
const isTrial = (u) => !!(u && u.trial_until);
// 体験中の人の一覧（オーナー用）
function trials() {
  return db.prepare(`SELECT u.id, u.display_name AS name, u.grade, u.trial_until AS until, r.referrer_id AS referrerId, ru.display_name AS referrer, ru.role AS referrerRole
    FROM users u LEFT JOIN referrals r ON r.new_id = u.id LEFT JOIN users ru ON ru.id = r.referrer_id
    WHERE u.trial_until IS NOT NULL ORDER BY u.trial_until DESC`).all().map(t => ({ ...t, active: t.until > Date.now() }));
}

// ── 入塾 ──
// 体験アカウントを、そのまま入塾した生徒のアカウントにする（アバターや着せかえはそのまま）
function enrollTrial(id, loginId, passwordHash, actorId) {
  const u = db.prepare('SELECT id, trial_until FROM users WHERE id = ?').get(id);
  if (!u || !u.trial_until) return { error: '体験中の人ではありません' };
  db.prepare('UPDATE users SET login_id = ?, password_hash = ?, trial_until = NULL, updated_at = ? WHERE id = ?').run(loginId, passwordHash, now(), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit(actorId, 'trial.enrolled', String(id), null);
  return { ok: true, rewards: markEnrolled(id) };
}
// 体験なしで入塾した生徒に、紹介してくれた人を登録する
function setReferrer(newId, referrerId, actorId) {
  if (newId === referrerId) return { error: '自分は紹介者にできません' };
  const nu = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student' AND trial_until IS NULL").get(newId);
  if (!nu) return { error: '入塾している生徒をえらんでください' };
  const ru = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('student', 'parent') AND trial_until IS NULL AND is_active = 1").get(referrerId);
  if (!ru) return { error: '紹介してくれた生徒・保護者をえらんでください' };
  if (db.prepare('SELECT 1 FROM referrals WHERE new_id = ? AND enrolled_at IS NOT NULL').get(newId)) return { error: 'この生徒の紹介者は、もう登録されています' };
  db.prepare('INSERT INTO referrals (new_id, referrer_id, created_at) VALUES (?, ?, ?) ON CONFLICT(new_id) DO UPDATE SET referrer_id = excluded.referrer_id').run(newId, referrerId, now());
  audit(actorId, 'referral.set', String(newId), { referrer: referrerId });
  return { ok: true, rewards: markEnrolled(newId) };
}
function giveItem(userId, item) {
  if (db.prepare('SELECT 1 FROM shop_owned WHERE user_id = ? AND item = ?').get(userId, item)) return;
  db.prepare('INSERT INTO shop_owned (user_id, item, year_start, price, bought_at) VALUES (?, ?, ?, 0, ?)').run(userId, item, G.getConfig().yearStart, now());
}
function bonus(userId, reason, points) {
  return db.prepare('INSERT OR IGNORE INTO bonus_points (user_id, reason, points, created_at) VALUES (?, ?, ?, ?)').run(userId, reason, points, now()).changes > 0;
}
// 入塾したときのごほうび。生徒の紹介：2人におそろいのアイテム＋ペア自習チャレンジ開始。保護者の紹介：家族の木に🌷・保護者に＋50ポイント
function markEnrolled(newId) {
  const r = db.prepare('SELECT r.*, u.role AS referrerRole FROM referrals r JOIN users u ON u.id = r.referrer_id WHERE r.new_id = ?').get(newId);
  if (!r || r.enrolled_at) return null;
  const today = G.jst().day;
  if (r.referrerRole === 'student') {
    db.prepare('UPDATE referrals SET enrolled_at = ?, pair_start = ? WHERE new_id = ?').run(now(), today, newId);
    giveItem(newId, ENROLL_ITEM); giveItem(r.referrer_id, ENROLL_ITEM);
    return { kind: 'student', ids: [newId, r.referrer_id] };
  }
  db.prepare('UPDATE referrals SET enrolled_at = ? WHERE new_id = ?').run(now(), newId);
  bonus(r.referrer_id, `referral:${newId}`, PARENT_POINTS);
  return { kind: 'parent', ids: [r.referrer_id] };
}
// オーナー用：紹介の一覧
function referralList() {
  return db.prepare(`SELECT r.new_id AS newId, nu.display_name AS newName, r.referrer_id AS referrerId, ru.display_name AS referrer, ru.role AS referrerRole,
    r.enrolled_at AS enrolledAt, r.pair_start AS pairStart, r.pair_result AS pairResult
    FROM referrals r JOIN users nu ON nu.id = r.new_id JOIN users ru ON ru.id = r.referrer_id WHERE r.enrolled_at IS NOT NULL ORDER BY r.enrolled_at DESC`).all();
}
function referrerOf(newId) {
  const r = db.prepare('SELECT referrer_id FROM referrals WHERE new_id = ?').get(newId);
  return r ? r.referrer_id : null;
}

// ── ペア自習チャレンジ：入塾した日から7日間、2人とも🔥（学年の最低時間）を続けたら、2人に限定アイテム＋30ポイント ──
function dayOk(userId, day, c = G.getConfig()) {
  if (G.dayAll(userId, day) >= G.streakMinFor(userId, c)) return true;
  // 🔥と同じく、数えない曜日・保護者会の日・授業の曜日はとぎれない
  if (!G.ruleFor(day, c).on || G.meetingDays().has(day)) return true;
  const u = db.prepare('SELECT class_days FROM users WHERE id = ?').get(userId);
  const wd = new Date(day + 'T00:00:00Z').getUTCDay();
  return !!(u && u.class_days && u.class_days.split(',').map(Number).includes(wd));
}
function daysDone(userId, start, today) {
  let n = 0;
  for (let i = 0; i < PAIR_DAYS; i++) {
    const d = G.addDays(start, i);
    if (d > today) break;
    if (dayOk(userId, d)) n++; else if (d < today) return { n, broken: true };
  }
  return { n, broken: false };
}
// その生徒がいま参加しているペア（いちばん新しいもの）
function pairOf(userId, date = new Date()) {
  const today = G.jst(date).day;
  const r = db.prepare(`SELECT r.* FROM referrals r JOIN users u ON u.id = r.referrer_id
    WHERE u.role = 'student' AND r.pair_start IS NOT NULL AND (r.new_id = ? OR r.referrer_id = ?)
    ORDER BY r.pair_start DESC LIMIT 1`).get(userId, userId);
  if (!r) return null;
  const end = G.addDays(r.pair_start, PAIR_DAYS - 1);
  if (r.pair_result && today > G.addDays(end, 3)) return null; // 終わってから3日たったら表示しない
  const partnerId = r.new_id === userId ? r.referrer_id : r.new_id;
  const p = db.prepare('SELECT display_name FROM users WHERE id = ?').get(partnerId);
  const me = daysDone(userId, r.pair_start, today), you = daysDone(partnerId, r.pair_start, today);
  return { newId: r.new_id, partnerId, partner: p ? p.display_name : '', start: r.pair_start, end, days: PAIR_DAYS, mine: me.n, theirs: you.n,
    broken: me.broken || you.broken, result: r.pair_result, points: PAIR_POINTS };
}
// 結果を決める（7日そろったら成功・とぎれたら終わり）。成功したら2人に限定アイテム＋30ポイント。返り値：成功した2人の id
function settlePair(userId, date = new Date()) {
  const s = pairOf(userId, date);
  if (!s || s.result) return null;
  if (s.mine >= PAIR_DAYS && s.theirs >= PAIR_DAYS) {
    db.prepare("UPDATE referrals SET pair_result = 'success' WHERE new_id = ?").run(s.newId);
    for (const id of [userId, s.partnerId]) { giveItem(id, PAIR_ITEM); bonus(id, `pair:${s.newId}`, PAIR_POINTS); }
    return [userId, s.partnerId];
  }
  if (s.broken || G.jst(date).day > s.end) db.prepare("UPDATE referrals SET pair_result = 'over' WHERE new_id = ?").run(s.newId);
  return null;
}

// 保護者の紹介で入塾した数（家族の木の🌷）
function tulips() {
  return db.prepare("SELECT COUNT(*) AS n FROM referrals r JOIN users u ON u.id = r.referrer_id WHERE u.role = 'parent' AND r.enrolled_at IS NOT NULL").get().n;
}

module.exports = {
  PAIR_DAYS, PAIR_POINTS, PARENT_POINTS, ENROLL_ITEM, PAIR_ITEM, getConfig, setConfig, weekOn, trialDays,
  codeOf, inviterOf, startTrial, isTrial, trials, enrollTrial, setReferrer, markEnrolled, referralList, referrerOf,
  dayOk, pairOf, settlePair, tulips, _recentTrials: recentTrials,
};
