// 入室前の「今日最初に取り組むページ」の写真
// - 生徒は、その日はじめて入るとき（漢字テストのあと）に、今日最初に取り組むページを撮ってから入室する
// - 写真はオーナーがあとで見られる（日ごとの一覧）。14日たったら消す
// - 写真は大きいので、アプリ本体のデータ（SQLite → PostgreSQL へ丸ごと自動保存）には入れない。
//   DATABASE_URL があるときは PostgreSQL の別のテーブルに直接保存、ないとき（開発・テスト）は SQLite に保存する
const { db, now, getSetting } = require('./db');
const snap = require('./pgsnapshot');

const KEEP_DAYS = 14;
const MAX_BYTES = 400 * 1024;
const jstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (day, n) => { const x = new Date(day + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ── 保存先 ──
const usePg = () => snap.enabled;
if (!snap.enabled) {
  db.exec(`CREATE TABLE IF NOT EXISTS start_photos (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, image BLOB NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day))`);
}
let pgReady = false;
async function pg() {
  const pool = snap.getPool();
  if (!pgReady) {
    await pool.query(`CREATE TABLE IF NOT EXISTS start_photos (
      user_id INTEGER NOT NULL, day TEXT NOT NULL, image BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, day))`);
    pgReady = true;
  }
  return pool;
}

// ── 小学生の「今日の目標時間」（写真といっしょに決める。小さいので SQLite に） ──
db.exec('CREATE TABLE IF NOT EXISTS daily_goals (user_id INTEGER NOT NULL, day TEXT NOT NULL, minutes INTEGER NOT NULL, PRIMARY KEY (user_id, day))');
const GOAL_CHOICES = [15, 20, 30, 45, 60, 90, 120];
function setGoal(userId, minutes) {
  const m = Number(minutes);
  if (!GOAL_CHOICES.includes(m)) return '目標の時間をえらんでください';
  db.prepare('INSERT INTO daily_goals (user_id, day, minutes) VALUES (?, ?, ?) ON CONFLICT (user_id, day) DO UPDATE SET minutes = excluded.minutes').run(userId, jstDay(), m);
  return null;
}
function goalOf(userId, day = jstDay()) { const r = db.prepare('SELECT minutes FROM daily_goals WHERE user_id = ? AND day = ?').get(userId, day); return r ? r.minutes : null; }
function lastGoal(userId) { const r = db.prepare('SELECT minutes FROM daily_goals WHERE user_id = ? ORDER BY day DESC LIMIT 1').get(userId); return r ? r.minutes : null; }

// ── 今日撮った人（入室のチェックはすぐ答える必要があるので、メモリにも持つ） ──
let todaySet = { day: null, ids: new Set(), loaded: false };
async function loadToday() {
  const day = jstDay();
  if (todaySet.day === day && todaySet.loaded) return;
  const ids = new Set();
  if (usePg()) {
    const r = await (await pg()).query('SELECT user_id FROM start_photos WHERE day = $1', [day]);
    for (const row of r.rows) ids.add(Number(row.user_id));
  } else {
    for (const row of db.prepare('SELECT user_id FROM start_photos WHERE day = ?').all(day)) ids.add(row.user_id);
  }
  // 読みこみ中に撮った人も残す
  if (todaySet.day === day) for (const id of todaySet.ids) ids.add(id);
  todaySet = { day, ids, loaded: true };
}
function ensureToday() {
  const day = jstDay();
  if (todaySet.day !== day) { todaySet = { day, ids: new Set(), loaded: false }; loadToday().catch(e => console.error('写真の一覧を読めませんでした:', e.message)); }
}

// オン/オフ（オーナーが「教室の設定」で変えられる。最初はオン。自動テストの中だけは最初オフ）
const enabledNow = () => getSetting('start_photo', process.env.NODE_TEST_CONTEXT ? '0' : '1') === '1';
/** 今日まだ撮っていない生徒か（体験中の子・生徒以外は不要） */
function required(user) {
  if (!enabledNow() || !user || user.role !== 'student' || user.trial_until) return false;
  ensureToday();
  if (!todaySet.loaded) return false; // 読みこみ中（起動直後の数秒）は止めない
  return !todaySet.ids.has(user.id);
}
async function requiredAsync(user) {
  if (!enabledNow() || !user || user.role !== 'student' || user.trial_until) return false;
  ensureToday(); await loadToday();
  return !todaySet.ids.has(user.id);
}

/** 写真を保存（今日の分。撮りなおしたら上書き） */
async function save(userId, buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100) return '写真が届いていません';
  if (buf.length > MAX_BYTES) return '写真が大きすぎます';
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return 'JPEG の写真を送ってください';
  const day = jstDay(), old = addDays(day, -KEEP_DAYS);
  if (usePg()) {
    const p = await pg();
    await p.query(`INSERT INTO start_photos (user_id, day, image, created_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (user_id, day) DO UPDATE SET image = EXCLUDED.image, created_at = now()`, [userId, day, buf]);
    await p.query('DELETE FROM start_photos WHERE day < $1', [old]);
  } else {
    db.prepare(`INSERT INTO start_photos (user_id, day, image, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, day) DO UPDATE SET image = excluded.image, created_at = excluded.created_at`).run(userId, day, buf, now());
    db.prepare('DELETE FROM start_photos WHERE day < ?').run(old);
  }
  ensureToday(); todaySet.ids.add(userId);
  return null;
}

/** その日の写真の一覧（オーナー用）：[{ userId, name, grade, at }] */
async function listDay(day) {
  let rows;
  if (usePg()) rows = (await (await pg()).query('SELECT user_id, created_at FROM start_photos WHERE day = $1 ORDER BY created_at', [day])).rows.map(r => ({ userId: Number(r.user_id), at: new Date(r.created_at).toISOString() }));
  else rows = db.prepare('SELECT user_id, created_at FROM start_photos WHERE day = ? ORDER BY created_at').all(day).map(r => ({ userId: r.user_id, at: r.created_at }));
  const users = new Map(db.prepare("SELECT id, display_name AS name, grade FROM users WHERE role = 'student'").all().map(u => [u.id, u]));
  return rows.filter(r => users.has(r.userId)).map(r => ({ ...r, name: users.get(r.userId).name, grade: users.get(r.userId).grade }));
}
async function getImage(userId, day) {
  if (usePg()) { const r = await (await pg()).query('SELECT image FROM start_photos WHERE user_id = $1 AND day = $2', [userId, day]); return r.rows[0] ? r.rows[0].image : null; }
  const r = db.prepare('SELECT image FROM start_photos WHERE user_id = ? AND day = ?').get(userId, day);
  return r ? Buffer.from(r.image) : null;
}

module.exports = { GOAL_CHOICES, setGoal, goalOf, lastGoal, enabledNow, required, requiredAsync, save, listDay, getImage, KEEP_DAYS, MAX_BYTES, _loadToday: loadToday };
