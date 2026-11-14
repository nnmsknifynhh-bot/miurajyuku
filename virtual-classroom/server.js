// 三浦塾 バーチャル教室サーバー
// - Socket.IO で位置・状態を同期
// - WebRTC のシグナリングを中継（音声・映像・画面共有は P2P）
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const CM = require('./public/shared/map.js');

const PORT = process.env.PORT || 3000;
const TEACHER_PASSCODE = process.env.TEACHER_PASSCODE || '';

// STUN/TURN 設定（TURN を使う場合は環境変数で指定）
const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
if (process.env.TURN_URL) {
  iceServers.push({
    urls: process.env.TURN_URL.split(','),
    username: process.env.TURN_USERNAME || '',
    credential: process.env.TURN_CREDENTIAL || '',
  });
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/config', (_req, res) => res.json({ iceServers, teacherPasscodeRequired: !!TEACHER_PASSCODE }));

const server = http.createServer(app);
const io = new Server(server);

/** @type {Map<string, any>} */
const users = new Map();
const COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#7986cb', '#a1887f', '#90a4ae'];

const publicUser = (u) => ({
  id: u.id, name: u.name, role: u.role, color: u.color, x: u.x, y: u.y, dir: u.dir,
  seat: u.seat, media: u.media, broadcast: u.broadcast, bot: !!u.bot,
});
const occupiedSeats = (exceptId) => {
  const s = new Set();
  for (const u of users.values()) if (u.seat && u.id !== exceptId) s.add(u.seat);
  return s;
};
const randomSpawn = () => {
  const taken = [...users.values()];
  const free = CM.SPAWN.filter(t => !taken.some(u => Math.abs(u.x - (t.x + 0.5) * CM.TILE) < 16 && Math.abs(u.y - (t.y + 0.5) * CM.TILE) < 16));
  const list = free.length ? free : CM.SPAWN;
  const t = list[Math.floor(Math.random() * list.length)];
  return CM.tileCenter(t.x, t.y);
};
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

io.on('connection', (socket) => {
  let me = null;

  socket.on('join', (data = {}, ack = () => {}) => {
    if (me) return ack({ ok: false, error: 'すでに入室しています' });
    const name = clean(data.name, 20);
    const role = data.role === 'teacher' ? 'teacher' : 'student';
    if (!name) return ack({ ok: false, error: '名前を入力してください' });
    if (role === 'teacher' && TEACHER_PASSCODE && data.passcode !== TEACHER_PASSCODE) {
      return ack({ ok: false, error: '先生用パスコードが違います' });
    }
    const pos = randomSpawn();
    me = {
      id: socket.id, name, role,
      color: /^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : COLORS[users.size % COLORS.length],
      x: pos.x, y: pos.y, dir: 'up', seat: null,
      media: { mic: false, cam: false, screen: false }, broadcast: false,
    };
    users.set(me.id, me);
    ack({ ok: true, self: publicUser(me), users: [...users.values()].filter(u => u.id !== me.id).map(publicUser) });
    socket.broadcast.emit('user-joined', publicUser(me));
    io.emit('chat', { system: true, text: `${name}${role === 'teacher' ? '先生' : 'さん'}が入室しました`, ts: Date.now() });
  });

  socket.on('move', (d = {}) => {
    if (!me) return;
    me.x = Math.max(0, Math.min(CM.W * CM.TILE, num(d.x, me.x)));
    me.y = Math.max(0, Math.min(CM.H * CM.TILE, num(d.y, me.y)));
    me.dir = ['up', 'down', 'left', 'right'].includes(d.dir) ? d.dir : me.dir;
    if (me.seat) {
      const c = CM.tileCenter(...Object.values(CM.parseSeat(me.seat)));
      if (Math.hypot(c.x - me.x, c.y - me.y) > 8) {
        me.seat = null;
        io.emit('user-updated', { id: me.id, seat: null });
      }
    }
    socket.broadcast.volatile.emit('user-moved', { id: me.id, x: me.x, y: me.y, dir: me.dir });
  });

  socket.on('sit', (seat, ack = () => {}) => {
    if (!me) return ack({ ok: false });
    const { x, y } = CM.parseSeat(seat);
    if (!CM.isSeat(x, y)) return ack({ ok: false, error: 'そこには座れません' });
    if (occupiedSeats(me.id).has(seat)) return ack({ ok: false, error: 'その席は使用中です' });
    const c = CM.tileCenter(x, y);
    if (Math.hypot(c.x - me.x, c.y - me.y) > CM.TILE * 1.6) return ack({ ok: false, error: '席が遠すぎます' });
    me.seat = seat; me.x = c.x; me.y = c.y;
    me.dir = CM.tileAt(x, y) === 't' ? 'down' : 'up';
    ack({ ok: true, x: c.x, y: c.y, dir: me.dir });
    socket.broadcast.emit('user-updated', { id: me.id, seat, x: c.x, y: c.y, dir: me.dir });
  });

  socket.on('stand', () => {
    if (!me || !me.seat) return;
    me.seat = null;
    io.emit('user-updated', { id: me.id, seat: null });
  });

  socket.on('media', (m = {}) => {
    if (!me) return;
    me.media = { mic: !!m.mic, cam: !!m.cam, screen: !!m.screen };
    socket.broadcast.emit('user-updated', { id: me.id, media: me.media });
  });

  socket.on('broadcast', (on) => {
    if (!me || me.role !== 'teacher') return;
    me.broadcast = !!on;
    io.emit('user-updated', { id: me.id, broadcast: me.broadcast });
  });

  socket.on('chat', (d = {}) => {
    if (!me) return;
    const text = clean(d.text, 500);
    if (!text) return;
    io.emit('chat', {
      from: me.id, name: me.name, role: me.role, text,
      announce: me.role === 'teacher' && !!d.announce, ts: Date.now(),
    });
  });

  // 先生が生徒を呼ぶ
  socket.on('summon', (targetId) => {
    if (!me || me.role !== 'teacher') return;
    const t = users.get(targetId);
    if (!t) return;
    if (t.bot) return botGoTo(t, me);
    io.to(targetId).emit('summoned', { by: me.id, name: me.name, x: me.x, y: me.y });
  });

  // WebRTC シグナリング中継
  socket.on('signal', (d = {}) => {
    if (!me || typeof d.to !== 'string' || !users.has(d.to)) return;
    io.to(d.to).emit('signal', { from: me.id, data: d.data });
  });

  // デモ用の生徒（先生のみ）
  socket.on('demo-bots', (n) => {
    if (!me || me.role !== 'teacher') return;
    if (n === 0) return clearBots();
    spawnBots(Math.max(1, Math.min(10, num(n, 5))));
  });

  socket.on('disconnect', () => {
    if (!me) return;
    users.delete(me.id);
    io.emit('user-left', { id: me.id });
    io.emit('chat', { system: true, text: `${me.name}${me.role === 'teacher' ? '先生' : 'さん'}が退室しました`, ts: Date.now() });
  });
});

// ───────── デモ生徒（ボット） ─────────
const BOT_NAMES = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田'];
let botSeq = 0;

function spawnBots(n) {
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      const used = new Set([...users.values()].map(u => u.name));
      const name = (BOT_NAMES.find(b => !used.has(b + '（デモ）')) || '生徒' + (botSeq + 1)) + '（デモ）';
      const pos = randomSpawn();
      const bot = {
        id: 'bot-' + (++botSeq), name, role: 'student', bot: true,
        color: COLORS[botSeq % COLORS.length], x: pos.x, y: pos.y, dir: 'up', seat: null,
        media: { mic: false, cam: false, screen: false }, broadcast: false, path: [], target: null,
      };
      users.set(bot.id, bot);
      io.emit('user-joined', publicUser(bot));
      // 空いている教室の席へ向かう
      const seat = CM.nearestFreeSeat(Math.floor(bot.x / CM.TILE), Math.floor(bot.y / CM.TILE),
        new Set([...occupiedSeats(), ...[...users.values()].filter(u => u.bot && u.target).map(u => u.target)]),
        { zoneId: 'classroom' });
      if (seat) botWalk(bot, seat.x, seat.y, CM.seatId(seat.x, seat.y));
    }, i * 1200);
  }
}

function botWalk(bot, tx, ty, seat) {
  const p = CM.findPath(Math.floor(bot.x / CM.TILE), Math.floor(bot.y / CM.TILE), tx, ty);
  if (!p) return;
  if (bot.seat) { bot.seat = null; io.emit('user-updated', { id: bot.id, seat: null }); }
  bot.path = p; bot.target = seat || null;
}

function botGoTo(bot, near) {
  const occ = new Set([...users.values()].filter(u => u.id !== bot.id).map(u => CM.seatId(Math.floor(u.x / CM.TILE), Math.floor(u.y / CM.TILE))));
  const nx = Math.floor(near.x / CM.TILE), ny = Math.floor(near.y / CM.TILE);
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [0, 2]]) {
    const x = nx + dx, y = ny + dy;
    if (CM.isWalkable(x, y) && !occ.has(CM.seatId(x, y))) return botWalk(bot, x, y, null);
  }
}

function clearBots() {
  for (const u of [...users.values()]) {
    if (u.bot) { users.delete(u.id); io.emit('user-left', { id: u.id }); }
  }
}

setInterval(() => {
  for (const b of users.values()) {
    if (!b.bot || !b.path.length) continue;
    const next = CM.tileCenter(b.path[0].x, b.path[0].y);
    const dx = next.x - b.x, dy = next.y - b.y, d = Math.hypot(dx, dy), step = 15;
    if (Math.abs(dx) > Math.abs(dy)) b.dir = dx > 0 ? 'right' : 'left'; else if (d) b.dir = dy > 0 ? 'down' : 'up';
    if (d <= step) { b.x = next.x; b.y = next.y; b.path.shift(); } else { b.x += dx / d * step; b.y += dy / d * step; }
    io.volatile.emit('user-moved', { id: b.id, x: b.x, y: b.y, dir: b.dir });
    if (!b.path.length && b.target) {
      if (!occupiedSeats(b.id).has(b.target)) {
        b.seat = b.target; b.dir = 'up';
        io.emit('user-updated', { id: b.id, seat: b.seat, x: b.x, y: b.y, dir: b.dir });
      }
      b.target = null;
    }
  }
}, 100);

server.listen(PORT, () => console.log(`三浦塾バーチャル教室: http://localhost:${PORT}`));
