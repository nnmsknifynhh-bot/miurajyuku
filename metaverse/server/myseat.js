// ⭐ 自分だけのVIP席
// 🔥（連続自習）が30日（高校生は4週）続いたら、自分の部屋の空いている席から1つえらべる。机に金色の名前プレート。
// その子がいないときは、ほかの子も座れる（席が足りなくならないように）。🔥がとぎれたら返す
const { db, now } = require('./db');
const G = require('./ganbari');
const SM = require('../public/shared/map.js');

db.exec('CREATE TABLE IF NOT EXISTS my_seats (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, seat TEXT NOT NULL UNIQUE, room TEXT NOT NULL, chosen_at TEXT NOT NULL)');

const NEED_DAYS = 30, NEED_WEEKS = 4;
function roomFor(grade) { return grade === '大人' ? 'class1' : G.isHS(grade) ? 'class3' : G.isES(grade) ? 'class2' : 'study'; } // 高校生は高校生自習室・小学生は小学生自習室・中学生は中学生自習室
// その部屋の、ふつうの自習席（テストのブースはのぞく）
function seatsOf(room) {
  const z = SM.ZONES.find(v => v.id === room), out = [];
  if (!z) return out;
  for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) if (SM.tileAt(x, y) === 'c' && !SM.isBoothSeat(SM.seatId(x, y))) out.push(SM.seatId(x, y));
  return out;
}
function statusOf(userId) {
  const u = db.prepare("SELECT id, grade, trial_until FROM users WHERE id = ? AND role = 'student'").get(userId);
  if (!u || u.trial_until) return null;
  const hs = G.isHS(u.grade), need = hs ? NEED_WEEKS : NEED_DAYS, streak = G.streak(userId);
  const r = db.prepare('SELECT seat, room FROM my_seats WHERE user_id = ?').get(userId);
  return { eligible: streak >= need, streak, need, unit: hs ? '週' : '日', room: roomFor(u.grade), seat: r ? r.seat : null };
}
// 席をえらぶ・かえる
function choose(userId, seat) {
  const st = statusOf(userId);
  if (!st) return { error: '生徒の機能です' };
  if (!st.eligible) return { error: `🔥が${st.need}${st.unit}続いたら、VIP席をえらべます（いま${st.streak}${st.unit}）` };
  if (!seatsOf(st.room).includes(String(seat))) return { error: 'その席はえらべません' };
  const other = db.prepare('SELECT user_id FROM my_seats WHERE seat = ? AND user_id != ?').get(String(seat), userId);
  if (other) return { error: 'その席は、ほかの子のVIP席です' };
  db.prepare('INSERT INTO my_seats (user_id, seat, room, chosen_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET seat = excluded.seat, room = excluded.room, chosen_at = excluded.chosen_at')
    .run(userId, String(seat), st.room, now());
  return { ok: true, seat: String(seat) };
}
// 🔥がとぎれた・学年が変わって部屋がちがう → 返す。返したら true
function checkKeep(userId) {
  const st = statusOf(userId);
  const r = db.prepare('SELECT seat, room FROM my_seats WHERE user_id = ?').get(userId);
  if (!r) return false;
  if (st && st.eligible && st.room === r.room) return false;
  db.prepare('DELETE FROM my_seats WHERE user_id = ?').run(userId);
  return true;
}
// みんなのVIP席（名札用）
function list() {
  return db.prepare(`SELECT m.user_id AS id, m.seat, m.room, u.display_name AS name FROM my_seats m JOIN users u ON u.id = m.user_id WHERE u.is_active = 1`).all();
}

module.exports = { NEED_DAYS, NEED_WEEKS, seatsOf, statusOf, choose, checkKeep, list };
