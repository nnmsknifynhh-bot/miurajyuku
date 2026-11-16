// 起動用のファイル（npm start）
// DATABASE_URL があれば、保存されているデータを読み戻してからサーバーを起動する。
const path = require('path');
const snapshot = require('./pgsnapshot');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

(async () => {
  if (snapshot.enabled) {
    const r = await snapshot.restore(DB_PATH);
    console.log(r === 'restored' ? '保存されているデータを読み込みました' : 'データベースは空です（はじめての起動）');
  } else {
    console.log('DATABASE_URL が未設定のため、データはこのサーバーの中だけに保存されます');
  }
  process.env.DB_PATH = DB_PATH;
  const { db } = require('./db');
  const app = require('./server');
  const PORT = Number(process.env.PORT || 3000);
  app.createServer().listen(PORT, () => console.log(`三浦塾メタバース: http://localhost:${PORT}`));
  snapshot.startAutoSave(db);
})().catch((e) => {
  console.error(e.message);
  process.exit(1); // データを読めないまま起動すると、保存済みのデータを空で上書きしてしまうため止める
});
