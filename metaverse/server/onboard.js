// はじめての人へ：ようこそツアー（見たかどうか）と、生徒のはじめての日の「やることチェック」
// ツアーはどの端末でも1回だけ出るように、サーバーに覚えておく
const { db, now } = require('./db');
const G = require('./ganbari');

db.exec('CREATE TABLE IF NOT EXISTS onboard (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, tour_seen_at TEXT, firstday_done_at TEXT)');
const FIRSTDAY_POINTS = 5;
const FIRSTDAY_MINUTES = 30;
const NEW_DAYS = 14; // 登録してから14日のあいだだけ「やることチェック」を出す（前からいる生徒には出さない）

function row(userId) { return db.prepare('SELECT tour_seen_at, firstday_done_at FROM onboard WHERE user_id = ?').get(userId) || {}; }
/** { tourSeen, firstDay: null | { minutes, points } } */
function status(user) {
  const r = row(user.id);
  let firstDay = null;
  const adult = user.grade === '大人'; // 大人英会話：生徒向けの案内・初めてチャレンジはなし
  if (user.role === 'student' && !adult && !r.firstday_done_at) {
    const created = Date.parse(user.created_at || '');
    if (Number.isFinite(created) && Date.now() - created < NEW_DAYS * 86400e3) firstDay = { minutes: FIRSTDAY_MINUTES, points: user.trial_until ? 0 : FIRSTDAY_POINTS };
  }
  return { tourSeen: adult || !!r.tour_seen_at, firstDay };
}
function markTour(userId) {
  db.prepare('INSERT INTO onboard (user_id, tour_seen_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET tour_seen_at = COALESCE(onboard.tour_seen_at, excluded.tour_seen_at)').run(userId, now());
}
/** やることチェックが全部できた：今日30分以上なら、1回だけ＋5ポイント（体験中の子はポイントなし） */
function finishFirstDay(user) {
  const st = status(user);
  if (!st.firstDay) return { error: 'もう終わっています' };
  if (G.dayAll(user.id, G.jst().day) < FIRSTDAY_MINUTES) return { error: `今日の自習が${FIRSTDAY_MINUTES}分になったら完了です` };
  db.prepare('INSERT INTO onboard (user_id, firstday_done_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET firstday_done_at = excluded.firstday_done_at').run(user.id, now());
  let points = 0;
  if (!user.trial_until) {
    const r = db.prepare('INSERT OR IGNORE INTO bonus_points (user_id, reason, points, created_at) VALUES (?, ?, ?, ?)').run(user.id, 'firstday', FIRSTDAY_POINTS, now());
    if (r.changes) points = FIRSTDAY_POINTS;
  }
  return { ok: true, points };
}
module.exports = { status, markTour, finishFirstDay, FIRSTDAY_MINUTES, FIRSTDAY_POINTS };
