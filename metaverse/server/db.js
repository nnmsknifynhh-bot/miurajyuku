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
  role          TEXT NOT NULL CHECK (role IN ('owner','teacher','student')),
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
  { id: 'class1', name: '教室1', type: 'classroom', sort: 1 },
  { id: 'class2', name: '教室2', type: 'classroom', sort: 2 },
  { id: 'class3', name: '教室3', type: 'classroom', sort: 3 },
  { id: 'study', name: '自習室', type: 'study', sort: 4 },
];
const insertRoom = db.prepare('INSERT OR IGNORE INTO rooms (id, name, type, capacity, max_capacity, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
for (const r of ROOM_SEED) {
  const max = SchoolMap.seatCount(r.id);
  const def = r.type === 'study' ? Math.min(30, max) : max;
  insertRoom.run(r.id, r.name, r.type, def, max, r.sort);
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

module.exports = { db, now, transaction, audit, DB_PATH };
