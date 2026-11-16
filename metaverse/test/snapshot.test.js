// データの自動保存（PostgreSQL）テスト：保存 → 別の場所へ読み戻し → 中身が同じ
// 本物の Neon の代わりに、メモリ上の PostgreSQL（pg-mem）を使う
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'juku-snap-'));
process.env.DATABASE_URL = 'postgres://test@localhost/test';
process.env.DB_PATH = path.join(tmp, 'a.db');
process.env.SNAPSHOT_RETRY_MS = '10';
const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');
const { DatabaseSync } = require('node:sqlite');
const snapshot = require('../server/pgsnapshot.js');

const mem = newDb();
const { Pool } = mem.adapters.createPg();
snapshot._setPool(Pool);
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(0), 100).unref(); });

test('はじめての起動：保存データがなければ空のまま起動する', async () => {
  assert.equal(await snapshot.restore(process.env.DB_PATH), 'empty');
});

test('データを変更すると PostgreSQL に保存され、別の場所に読み戻すと同じ中身になる（再起動しても消えない）', async () => {
  const { db } = require('../server/db.js');
  const auth = require('../server/auth.js');
  db.prepare("INSERT INTO users (login_id, display_name, role, password_hash, created_at, updated_at) VALUES ('hana', 'はな', 'student', ?, 'x', 'x')")
    .run(auth.hashPassword('password123'));
  db.prepare("UPDATE rooms SET capacity = 7 WHERE id = 'study'").run();
  snapshot.startAutoSave(db);
  await snapshot._flushForTest();

  // 「再起動後」を想定して、別のファイルへ読み戻す
  const restoredPath = path.join(tmp, 'restored.db');
  assert.equal(await snapshot.restore(restoredPath), 'restored');
  const db2 = new DatabaseSync(restoredPath);
  const u = db2.prepare("SELECT display_name, password_hash FROM users WHERE login_id = 'hana'").get();
  assert.equal(u.display_name, 'はな');
  assert.ok(auth.verifyPassword('password123', u.password_hash), 'パスワードもそのまま');
  assert.equal(db2.prepare("SELECT capacity FROM rooms WHERE id = 'study'").get().capacity, 7);
  db2.close();
});

test('曜日ごとのバックアップも残る', async () => {
  const p = new Pool();
  const r = await p.query('SELECT id FROM app_snapshot ORDER BY id');
  const ids = r.rows.map(x => x.id);
  assert.ok(ids.includes(1));
  assert.ok(ids.includes(100 + new Date().getDay()));
});

test('データベースにつながらないときは起動を止める（空のデータで上書きしない）', async () => {
  class BrokenPool { async query() { throw new Error('connection refused'); } }
  snapshot._setPool(BrokenPool);
  await assert.rejects(snapshot.restore(path.join(tmp, 'x.db')), /読み込めませんでした/);
});
