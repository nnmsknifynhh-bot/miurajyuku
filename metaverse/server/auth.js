// 認証：パスワードのハッシュ化、セッション管理、ログイン試行の制限
const crypto = require('crypto');
const { db, now } = require('./db');
const { rowToPermissions } = require('./permissions');

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const COOKIE_NAME = 'juku_sid';
const COOKIE_SECURE = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';

// ── パスワード（scrypt + ソルト） ──
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
// 存在しないIDでも同じくらい時間をかける（ID の存在を推測されにくくする）
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

// ── セッション ──
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId, req, untilMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(untilMs || Date.now() + SESSION_DAYS * 86400e3).toISOString(); // 体験アカウントは体験の終わりまで
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, now(), expires, req.ip, String(req.headers['user-agent'] || '').slice(0, 200));
  return { token, expires };
}
function setSessionCookie(res, token, expires) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/', expires: new Date(expires),
  });
}
function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/' });
}
function revokeUserSessions(userId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// ユーザーを権限・担当教室付きで読み込む
function loadUser(id) {
  const u = db.prepare('SELECT id, login_id, display_name, role, avatar_color, grade, birthday, birthday_public, visit_days, visit_time, class_days, trial_until, is_active, created_at, updated_at FROM users WHERE id = ?').get(id);
  if (!u) return null;
  const perm = db.prepare('SELECT * FROM permissions WHERE user_id = ?').get(id);
  u.is_active = !!u.is_active;
  u.permissions = rowToPermissions(perm, u.role);
  u.rooms = u.role === 'owner'
    ? db.prepare('SELECT id FROM rooms ORDER BY sort_order').all().map(r => r.id)
    : db.prepare('SELECT room_id FROM teacher_rooms WHERE user_id = ?').all(id).map(r => r.room_id);
  return { ...u };
}

function userFromRequest(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!s) return null;
  if (s.expires_at < now()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token)); return null; }
  const u = loadUser(s.user_id);
  if (!u || !u.is_active) return null;
  if (u.trial_until && u.trial_until < Date.now()) return null; // 体験期間が終わった
  u.sessionTokenHash = sha256(token);
  return u;
}

// ── ミドルウェア ──
function requireAuth(req, res, next) {
  const u = userFromRequest(req);
  if (!u) return res.status(401).json({ error: 'ログインしてください' });
  req.user = u;
  next();
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'この操作は許可されていません' });

// ── ログイン試行の制限（総当たり対策） ──
const attempts = new Map(); // key -> { count, until }
const LOCK_MINUTES = 15;
function isLocked(key) {
  const a = attempts.get(key);
  return a && a.until && a.until > Date.now();
}
function recordFailure(key, max) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count++;
  if (a.count >= max) { a.until = Date.now() + LOCK_MINUTES * 60e3; a.count = 0; }
  attempts.set(key, a);
}
function clearFailures(key) { attempts.delete(key); }
// ロックを外す（オーナーが管理画面から）。loginId を渡すとその人、渡さないと全部（端末ごとのロックもふくむ）
function unlock(loginId) {
  if (loginId == null) { const n = [...attempts.values()].filter(a => a.until > Date.now()).length; attempts.clear(); return n; }
  const had = isLocked('id:' + loginId);
  attempts.delete('id:' + loginId);
  return had ? 1 : 0;
}
// あと何回まちがえるとロックされるか（ID ごと）
function failuresLeft(key, max) { const a = attempts.get(key); return a && !(a.until > Date.now()) ? max - a.count : max; }
setInterval(() => { const t = Date.now(); for (const [k, a] of attempts) if (!a.until || a.until < t) if (!a.count) attempts.delete(k); }, 10 * 60e3).unref();
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()), 60 * 60e3).unref();

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, createSession, setSessionCookie, clearSessionCookie, revokeUserSessions,
  loadUser, userFromRequest, requireAuth, requireRole, isLocked, recordFailure, clearFailures, unlock, failuresLeft, LOCK_MINUTES,
};
