// 第3・4段階：LiveKit（音声・画面共有のサーバー）との連携
// - 参加用トークンはこのサーバーだけが発行する。トークンに「話してよいか・画面共有してよいか」を書き込むので、
//   画面を改造しても許可されていない送信はできない。
// - 部屋から出た人・切断された人は、サーバーから LiveKit の部屋を強制退出させる。
// - 録音・録画（LiveKit Egress）は一切起動しない。
const { AccessToken, RoomServiceClient, TrackSource } = require('livekit-server-sdk');

const URL_ = (process.env.LIVEKIT_URL || '').trim();
const KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();
const PREFIX = process.env.LIVEKIT_ROOM_PREFIX || 'miura-';
const enabled = !!(URL_ && KEY && SECRET);

let service = enabled ? new RoomServiceClient(URL_.replace(/^ws/, 'http'), KEY, SECRET) : null;

const lkRoomName = (roomId, kind = 'class') => `${PREFIX}${kind}-${roomId}`;
const identityOf = (userId) => `u-${userId}`;

/**
 * 参加用トークンを作る
 * @param {object} o
 * @param {number} o.userId
 * @param {string} o.name   表示名
 * @param {string} o.role
 * @param {string} o.room   LiveKit の部屋名
 * @param {boolean} o.mic   マイクを送ってよいか
 * @param {boolean} o.screen 画面共有を送ってよいか
 * @param {boolean} o.camera カメラを送ってよいか（個別通話で生徒がノートを見せる）
 */
async function makeToken({ userId, name, role, room, mic = false, screen = false, camera = false }) {
  const at = new AccessToken(KEY, SECRET, {
    identity: identityOf(userId), name, ttl: '10m', metadata: JSON.stringify({ role }),
  });
  const sources = [];
  if (mic) sources.push(TrackSource.MICROPHONE);
  if (camera) sources.push(TrackSource.CAMERA);
  if (screen) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  at.addGrant({
    roomJoin: true, room, canSubscribe: true, canPublishData: false,
    canPublish: sources.length > 0, canPublishSources: sources,
    roomRecord: false, roomAdmin: false, hidden: false,
  });
  return at.toJwt();
}

async function removeParticipant(room, userId) {
  if (!service) return;
  try { await service.removeParticipant(room, identityOf(userId)); } catch (e) { /* もういない場合など */ }
}
async function closeRoom(room) {
  if (!service) return;
  try { await service.deleteRoom(room); } catch (e) { /* 部屋がまだない場合など */ }
}

// CSP（connect-src）に追加する接続先
function cspSources() {
  if (!enabled) return [];
  try {
    const host = new URL(URL_).host;
    const list = [`wss://${host}`, `https://${host}`];
    if (/\.livekit\.cloud$/.test(host)) list.push('wss://*.livekit.cloud', 'https://*.livekit.cloud');
    if (URL_.startsWith('ws://')) list.push(`ws://${host}`, `http://${host}`);
    return list;
  } catch { return []; }
}

module.exports = {
  enabled, url: URL_, lkRoomName, identityOf, makeToken, removeParticipant, closeRoom, cspSources,
  _setService: (s) => { service = s; },
};
