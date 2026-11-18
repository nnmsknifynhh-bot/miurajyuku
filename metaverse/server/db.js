// データベース（SQLite / Node.js 標準の node:sqlite を使用）
// 本番で PostgreSQL に移行する場合も、このファイルの SQL を置き換えれば済むようにしてあります。
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const SchoolMap = require('../public/shared/map.js');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','teacher','student','parent')),
  password_hash TEXT NOT NULL,
  avatar_color  TEXT NOT NULL DEFAULT '#64b5f6',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_enter_classroom   INTEGER NOT NULL DEFAULT 0,
  can_start_class_call  INTEGER NOT NULL DEFAULT 0,
  can_start_private_call INTEGER NOT NULL DEFAULT 0,
  can_share_screen      INTEGER NOT NULL DEFAULT 0,
  can_handle_students   INTEGER NOT NULL DEFAULT 0,
  can_manage_classroom  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('classroom','study')),
  capacity     INTEGER NOT NULL,
  max_capacity INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- 先生の担当教室
CREATE TABLE IF NOT EXISTS teacher_rooms (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, room_id)
);

-- ログインセッション（トークンはハッシュ化して保存）
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 塾全体の設定（例：自習室の見守り写真のオン/オフ）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 操作ログ（ログイン・管理操作）
CREATE TABLE IF NOT EXISTS audit_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  actor_id  INTEGER,
  action    TEXT NOT NULL,
  target    TEXT,
  detail    TEXT,
  ip        TEXT
);
`);

// 部屋の初期データ（座席数はマップから計算）
const ROOM_SEED = [
  { id: 'class1', name: 'スピーキング・ライティング教室', type: 'study', sort: 1 }, // 教室1をテストの教室に
  { id: 'class2', name: '教室2', type: 'classroom', sort: 2 },
  { id: 'class3', name: '高校生自習室', type: 'study', sort: 3 }, // 教室3を高校生自習室（カフェ風）に改装
  { id: 'study', name: '自習室', type: 'study', sort: 4 },
  { id: 'mendan', name: '面談ブース', type: 'classroom', sort: 5 }, // ロビーの面談ブース（オーナーが許可した人だけ）
];
const insertRoom = db.prepare('INSERT OR IGNORE INTO rooms (id, name, type, capacity, max_capacity, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
for (const r of ROOM_SEED) {
  const max = SchoolMap.seatCount(r.id);
  const def = r.type === 'study' ? Math.min(30, max) : max;
  insertRoom.run(r.id, r.name, r.type, def, max, r.sort);
}
// すでに「教室1」として保存されているデータを、スピーキング・ライティング教室に切りかえる（1回だけ）
{
  const r1 = db.prepare("SELECT type FROM rooms WHERE id = 'class1'").get();
  if (r1 && r1.type === 'classroom') {
    const max = SchoolMap.seatCount('class1');
    db.prepare("UPDATE rooms SET type = 'study', name = 'スピーキング・ライティング教室', capacity = ?, max_capacity = ? WHERE id = 'class1'").run(max, max);
  }
}
// すでに「教室3」として保存されているデータを、高校生自習室に切りかえる（1回だけ）
{
  const r3 = db.prepare("SELECT type FROM rooms WHERE id = 'class3'").get();
  if (r3 && r3.type === 'classroom') {
    const max = SchoolMap.seatCount('class3');
    db.prepare("UPDATE rooms SET type = 'study', name = '高校生自習室', capacity = ?, max_capacity = ? WHERE id = 'class3'").run(max, max);
  }
}

const now = () => new Date().toISOString();

function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function audit(actorId, action, target, detail, ip) {
  db.prepare('INSERT INTO audit_logs (at, actor_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now(), actorId ?? null, action, target ?? null, detail ? JSON.stringify(detail) : null, ip ?? null);
}

// 操作ログ（IPアドレスを含む）は一定期間で自動削除する（個人情報を必要以上に持たないため）
const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS || 180);
function pruneAuditLogs() {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86400e3).toISOString();
  return db.prepare('DELETE FROM audit_logs WHERE at < ?').run(cutoff).changes;
}
pruneAuditLogs();
setInterval(pruneAuditLogs, 24 * 3600e3).unref();

// 体験アカウント（友だち紹介）：体験の終わりの時刻（ミリ秒）。入塾したら NULL
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'trial_until')) db.exec('ALTER TABLE users ADD COLUMN trial_until INTEGER');
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'class_days')) db.exec('ALTER TABLE users ADD COLUMN class_days TEXT');
function getSetting(key, def = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { db, now, transaction, audit, pruneAuditLogs, getSetting, setSetting, DB_PATH, AUDIT_RETENTION_DAYS };
