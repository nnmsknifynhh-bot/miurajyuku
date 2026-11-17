// 通知：生徒が入室したとき、オーナーと先生に知らせる
// - アプリを開いている人 → 画面に表示＋チャイム（Socket.IO）
// - アプリを閉じている人 → プッシュ通知（Web Push。無料。iPhone はホーム画面に追加したアプリのみ）
// プッシュ通知の鍵（VAPID）は初回起動時に自動で作り、データベースに保存する（Neon にも自動保存される）。
const { db, now, getSetting, setSetting } = require('./db');

let webpush = require('web-push');
let vapid = null;

db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  device     TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notify_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  arrivals INTEGER NOT NULL DEFAULT 1
);
`);

function keys() {
  if (vapid) return vapid;
  let pub = getSetting('vapid_public'), priv = getSetting('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    setSetting('vapid_public', pub); setSetting('vapid_private', priv);
  }
  vapid = { publicKey: pub, privateKey: priv };
  // 連絡先（プッシュ通知の決まりで必要）。Render ではアプリのアドレスが自動で入る
  webpush.setVapidDetails(process.env.PUSH_SUBJECT || process.env.RENDER_EXTERNAL_URL || 'mailto:admin@example.com', pub, priv);
  return vapid;
}

const isStaffRole = (role) => role === 'owner' || role === 'teacher';

function getPrefs(userId) {
  const r = db.prepare('SELECT arrivals FROM notify_prefs WHERE user_id = ?').get(userId);
  return { arrivals: r ? !!r.arrivals : true }; // 先生・オーナーは最初からオン
}
function setPrefs(userId, prefs) {
  db.prepare('INSERT INTO notify_prefs (user_id, arrivals) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET arrivals = excluded.arrivals')
    .run(userId, prefs.arrivals ? 1 : 0);
  return getPrefs(userId);
}

function subscribe(userId, sub, device) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return 'この端末では通知を登録できません';
  const k = sub.keys || {};
  if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) return 'この端末では通知を登録できません';
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`)
    .run(userId, sub.endpoint, k.p256dh, k.auth, String(device || '').slice(0, 60), now());
  return null;
}
function unsubscribe(userId, endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, String(endpoint || '')).changes;
}
function deviceCount(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId).n;
}

async function pushTo(userId, payload) {
  keys();
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  let sent = 0;
  const errors = [];
  for (const s of subs) {
    const service = (() => { try { return new URL(s.endpoint).host; } catch { return '?'; } })();
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 600, urgency: 'high' });
      sent++;
    } catch (e) {
      // 端末側で通知が無効になった（404/410）ものは削除
      if (e && (e.statusCode === 404 || e.statusCode === 410)) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      else console.error('プッシュ通知の送信に失敗:', service, e && (e.statusCode || e.message), e && e.body);
      errors.push({ service, status: (e && e.statusCode) || null, message: String((e && (e.body || e.message)) || '').slice(0, 120) });
    }
  }
  return { sent, errors };
}

/**
 * 生徒の入室を知らせる
 * @param {{id:number, name:string}} student
 * @param {Map<number, any>} online  realtime の接続中ユーザー（userId -> presence）
 */
async function studentArrived(student, online) {
  const staff = db.prepare("SELECT id FROM users WHERE role IN ('owner','teacher') AND is_active = 1").all();
  const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ_DISPLAY || 'Asia/Tokyo' });
  const result = { inApp: 0, push: 0 };
  for (const { id } of staff) {
    if (!getPrefs(id).arrivals) continue;
    const p = online.get(id);
    if (p) {
      p.socket.emit('student-arrived', { id: student.id, name: student.name, time, birthday: !!student.birthday });
      result.inApp++;
    } else {
      result.push += (await pushTo(id, {
        title: student.birthday ? `🎂 ${student.name}さんが入室しました（今日は誕生日です）` : `🔔 ${student.name}さんが入室しました`,
        body: student.birthday ? `${time}　声をかけてお祝いしてあげてください` : `${time}　三浦塾 オンライン教室`,
        tag: 'arrival-' + student.id,
        url: '/app',
      })).sent;
    }
  }
  return result;
}

// 決めた曜日・時刻を過ぎても来ていない高校生を、先生・オーナーに知らせる
async function studentLate(student, online) {
  const staff = db.prepare("SELECT id FROM users WHERE role IN ('owner','teacher') AND is_active = 1").all();
  const result = { inApp: 0, push: 0 };
  for (const { id } of staff) {
    if (!getPrefs(id).arrivals) continue;
    const p = online.get(id);
    if (p) { p.socket.emit('student-late', { id: student.id, name: student.name, weekday: student.weekday, time: student.time }); result.inApp++; }
    else {
      result.push += (await pushTo(id, {
        title: `⏰ ${student.name}さんがまだ来ていません`,
        body: `${student.weekday}曜 ${student.time} からの予定です　三浦塾 オンライン教室`,
        tag: 'late-' + student.id, url: '/app',
      })).sent;
    }
  }
  return result;
}

module.exports = {
  studentLate,
  isStaffRole, publicKey: () => keys().publicKey, getPrefs, setPrefs, subscribe, unsubscribe, deviceCount, studentArrived, pushTo,
  _setWebPush: (w) => { webpush = w; vapid = null; },
};
