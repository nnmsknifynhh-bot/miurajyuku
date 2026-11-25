// データの自動保存（無料のデータベース Neon などの PostgreSQL へ）
//
// 無料のサーバー（Render 無料プラン）は、再起動のたびにファイルが消えてしまう。
// そこで、アプリ本体は今までどおり SQLite で動かし、その中身を丸ごと PostgreSQL に保存しておく。
// - 起動時：PostgreSQL に保存された最新のデータを読み戻してから起動する
// - 動作中：データが変わったら数秒以内に保存する
// - 停止時（再起動・スリープ）：最後に必ず保存してから止まる
// - 念のため、曜日ごとのバックアップ（7日分）も残す
//
// 環境変数 DATABASE_URL が設定されているときだけ動く（未設定なら何もしない）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// 貼り付けのときに入りがちな余分な文字（前後の空白・引用符・「DATABASE_URL=」）を取り除く
const DATABASE_URL = (process.env.DATABASE_URL || '').trim().replace(/^DATABASE_URL\s*=\s*/i, '').replace(/^["']|["']$/g, '').trim();
const enabled = !!DATABASE_URL;
const SAVE_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS || 3000);
// 通信量をへらす：丸ごと保存は5分に1回まで（止まるときは必ず保存）。曜日ごとのバックアップは6時間に1回
const MIN_GAP_MS = Number(process.env.SNAPSHOT_MIN_GAP_MS || 5 * 60_000);
const BACKUP_GAP_MS = Number(process.env.SNAPSHOT_BACKUP_GAP_MS || 6 * 3600_000);
let lastSaveAt = 0, lastBackupAt = 0, lastBackupId = null;

let PoolImpl = null;
let pool = null;
function getPool() {
  if (!pool) {
    const Pool = PoolImpl || require('pg').Pool;
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
  }
  return pool;
}

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await getPool().query(`CREATE TABLE IF NOT EXISTS app_snapshot (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    size INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  tableReady = true;
}

/**
 * 起動前に呼ぶ：保存されているデータを dbPath に書き出す。
 * 通信の失敗で読めなかったときは例外を投げる（空のデータで起動して、保存済みのデータを上書きしないため）。
 * @returns {Promise<'restored'|'empty'|'disabled'>}
 */
async function restore(dbPath) {
  if (!enabled) return 'disabled';
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      await ensureTable();
      const r = await getPool().query('SELECT data FROM app_snapshot WHERE id = 1');
      if (!r.rows.length) return 'empty';
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) fs.rmSync(f, { force: true });
      const raw = r.rows[0].data; // 'gz:'＋base64（圧縮）／前の形は base64 だけ
      fs.writeFileSync(dbPath, raw.startsWith('gz:') ? zlib.gunzipSync(Buffer.from(raw.slice(3), 'base64')) : Buffer.from(raw, 'base64'));
      return 'restored';
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, Number(process.env.SNAPSHOT_RETRY_MS || 2000) * (i + 1)));
    }
  }
  throw new Error('データベース（DATABASE_URL）からデータを読み込めませんでした: ' + (lastErr && lastErr.message));
}

let saving = null;
let lastChanges = -1;
let db = null;

// いまの SQLite の中身を PostgreSQL に保存する
async function save() {
  if (!enabled || !db) return false;
  if (saving) return saving;
  saving = (async () => {
    const tmp = path.join(os.tmpdir(), `juku-snapshot-${process.pid}-${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const data = 'gz:' + zlib.gzipSync(fs.readFileSync(tmp), { level: 9 }).toString('base64'); // 圧縮して送る
      const backupId = 100 + new Date().getDay(); // 曜日ごとのバックアップ（100〜106）
      const ids = [1];
      if (backupId !== lastBackupId || Date.now() - lastBackupAt >= BACKUP_GAP_MS) ids.push(backupId);
      for (const id of ids) {
        await getPool().query(
          `INSERT INTO app_snapshot (id, data, size, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, size = EXCLUDED.size, updated_at = now()`,
          [id, data, data.length],
        );
      }
      lastSaveAt = Date.now();
      if (ids.includes(backupId)) { lastBackupAt = lastSaveAt; lastBackupId = backupId; }
      return true;
    } finally {
      fs.rmSync(tmp, { force: true });
      saving = null;
    }
  })();
  return saving;
}

function changesNow() { return db.prepare('SELECT total_changes() AS n').get().n; }

/** 起動後に呼ぶ：変更があれば数秒ごとに保存し、停止時にも保存する */
function startAutoSave(sqliteDb) {
  if (!enabled) return;
  db = sqliteDb;
  lastChanges = -1; // 起動直後に1回保存（初期データの作成を含む）
  const tick = async () => {
    try {
      const n = changesNow();
      if (n !== lastChanges && Date.now() - lastSaveAt >= MIN_GAP_MS) { await save(); lastChanges = n; }
    } catch (e) {
      console.error('データの自動保存に失敗しました（次の機会に再試行します）:', e.message);
    }
  };
  const timer = setInterval(tick, SAVE_INTERVAL_MS);
  timer.unref();
  tick();
  const shutdown = async (sig) => {
    clearInterval(timer);
    try { if (changesNow() !== lastChanges) await save(); } catch (e) { console.error('停止前の保存に失敗:', e.message); }
    process.exit(sig === 'SIGTERM' ? 0 : 1);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
  enabled, restore, save, startAutoSave, getPool,
  _setPool: (P) => { PoolImpl = P; pool = null; tableReady = false; },
  _flushForTest: async () => { const n = changesNow(); await save(); lastChanges = n; },
};
