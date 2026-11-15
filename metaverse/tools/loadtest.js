// 第5段階：負荷テスト
// サーバーを別プロセスで起動し、生徒45人＋先生3人の授業を再現して、
// 位置同期の遅延・サーバーのCPU/メモリ・1人あたりの受信量を測る。
//
// 使い方:  node tools/loadtest.js [--students 45] [--teachers 3] [--seconds 60] [--walkers 6]
// ※ Linux で実行してください（サーバーのCPU・メモリは /proc から読みます）
// ※ 音声（LiveKit）は対象外です。LiveKit Cloud 側の負荷は LiveKit が処理します。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: ioc } = require('socket.io-client');
const SM = require('../public/shared/map.js');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? Number(process.argv[i + 1]) : def; };
const N_STUDENTS = arg('students', 45), N_TEACHERS = arg('teachers', 3), SECONDS = arg('seconds', 60), WALKERS = arg('walkers', 6);
const PORT = 3400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const T = SM.TILE, SPEED = 140, HZ = 15;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

async function http(method, p, body, cookie) {
  const res = await fetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const sc = res.headers.get('set-cookie');
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : cookie };
}

function procStats(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  const cpuTicks = Number(stat[11]) + Number(stat[12]); // utime + stime
  const rss = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024;
  return { cpuTicks, rssMB: rss };
}

const sent = new Map(); // `${id}:${x}` -> 送信時刻
const latencies = [];
let recvBytes = 0, recvMsgs = 0;

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const s = ioc(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, forceNew: true });
    const c = { s, me: null, rejected: 0, counting: false };
    s.on('init', (d) => { c.me = d.me; resolve(c); });
    s.on('connect_error', reject);
    s.on('move-rejected', (d) => { c.rejected++; c.me.x = d.x; c.me.y = d.y; });
    s.on('moves', (list) => {
      if (!c.counting) return;
      const now = performance.now();
      for (const [id, x, y] of list) {
        const key = id + ':' + x + ':' + y;
        const t0 = sent.get(key);
        if (t0) latencies.push(now - t0);
      }
    });
    s.io.engine.on('packet', (p) => { if (c.counting) { recvMsgs++; if (typeof p.data === 'string') recvBytes += p.data.length; } });
  });
}

// 実際の歩く速さ（140px/秒）で、15回/秒の位置送信をしながら目的地へ
async function walk(c, tx, ty) {
  const route = SM.findPath(Math.floor(c.me.x / T), Math.floor(c.me.y / T), tx, ty);
  if (!route) return false;
  const step = SPEED / HZ;
  for (const node of route) {
    const goal = SM.tileCenter(node.x, node.y);
    for (;;) {
      const dx = goal.x - c.me.x, dy = goal.y - c.me.y, d = Math.hypot(dx, dy);
      if (d <= step) { c.me.x = goal.x; c.me.y = goal.y; } else { c.me.x += dx / d * step; c.me.y += dy / d * step; }
      const x = Math.round(c.me.x * 10) / 10, y = Math.round(c.me.y * 10) / 10; // 実際の画面と同じく0.1px単位
      sent.set(c.me.id + ':' + x + ':' + y, performance.now());
      c.s.emit('move', { x, y, dir: 'up', moving: true });
      c.me.x = x; c.me.y = y;
      await sleep(1000 / HZ);
      if (d <= step) break;
    }
  }
  return true;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'juku-load-'));
  console.log(`サーバー起動中（ポート ${PORT}）…`);
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 'load.db'),
      LIVEKIT_URL: 'ws://127.0.0.1:9', LIVEKIT_API_KEY: 'loadtest', LIVEKIT_API_SECRET: 'loadtest-secret-loadtest-secret-0000',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const stop = () => { try { server.kill(); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); };
  process.on('exit', stop);
  for (let i = 0; i < 50; i++) { try { await http('GET', '/api/setup-status'); break; } catch { await sleep(100); } }

  const owner = (await http('POST', '/api/setup', { displayName: 'owner', loginId: 'owner', password: 'ownerpass1' })).cookie;
  const rooms = ['class1', 'class2', 'class3'];
  const users = [];
  console.log(`アカウント作成：先生${N_TEACHERS}人・生徒${N_STUDENTS}人…`);
  for (let i = 0; i < N_TEACHERS; i++) {
    await http('POST', '/api/admin/users', { role: 'teacher', loginId: `tch${i}`, displayName: `先生${i}`, password: 'password123', rooms: [rooms[i % 3]] }, owner);
    users.push({ role: 'teacher', loginId: `tch${i}`, room: rooms[i % 3] });
  }
  for (let i = 0; i < N_STUDENTS; i++) {
    await http('POST', '/api/admin/users', { role: 'student', loginId: `stu${i}`, displayName: `生徒${i}`, password: 'password123' }, owner);
    users.push({ role: 'student', loginId: `stu${i}`, room: rooms[Math.floor(i / 15) % 3] });
  }
  for (const u of users) u.cookie = (await http('POST', '/api/login', { loginId: u.loginId, password: 'password123' })).cookie;

  console.log('全員が接続…');
  let t0 = performance.now();
  for (const u of users) u.c = await connect(u.cookie);
  const connectMs = performance.now() - t0;

  console.log('全員が教室へ歩いて着席…（実際の歩く速さで移動）');
  const seatsBy = Object.fromEntries(rooms.map(r => [r, [...SM.classroomSeats[r]]]));
  t0 = performance.now();
  const entryResults = await Promise.all(users.map(async (u) => {
    if (u.role === 'teacher') { const p = SM.PODIUM[u.room]; return walk(u.c, p.x, p.y); }
    const seat = seatsBy[u.room].shift();
    if (!seat) return walk(u.c, SM.ENTRY.lobby.x, SM.ENTRY.lobby.y);
    const ok = await walk(u.c, seat.x, seat.y);
    if (ok) await new Promise(r => u.c.s.emit('sit', SM.seatId(seat.x, seat.y), r));
    u.seat = seat;
    return ok;
  }));
  const entryMs = performance.now() - t0;
  for (const u of users.filter(x => x.role === 'teacher')) await new Promise(r => u.c.s.emit('class-start', {}, r));

  console.log(`授業中の動きを ${SECONDS} 秒間再現…（挙手・リアクション・常に${WALKERS}人が歩き回る）`);
  const students = users.filter(u => u.role === 'student');
  users.forEach(u => { u.c.counting = true; });
  latencies.length = 0; recvBytes = 0; recvMsgs = 0;
  const before = procStats(server.pid);
  const tStart = performance.now();
  let hands = 0, reactions = 0, walksDone = 0;
  const reactionsList = ['👍', '👏', '😊', '❓', '💡', '🙏'];
  const activity = setInterval(() => {
    for (const s of students) {
      const r = Math.random();
      if (r < 0.02) { s.hand = !s.hand; s.c.s.emit('hand', { raised: s.hand }, () => {}); hands++; }
      else if (r < 0.04) { s.c.s.emit('reaction', reactionsList[Math.floor(Math.random() * 6)]); reactions++; }
    }
  }, 1000);
  // 歩き回る生徒（教室の中を往復）
  const walkerLoop = async (s) => {
    const z = SM.ZONES.find(v => v.id === s.room);
    while (performance.now() - tStart < SECONDS * 1000) {
      const tx = z.x1 + 1 + Math.floor(Math.random() * 13), ty = [4, 7, 10][Math.floor(Math.random() * 3)];
      await walk(s.c, tx, ty); walksDone++;
      await walk(s.c, s.seat.x, s.seat.y);
    }
  };
  await Promise.all(students.slice(0, WALKERS).map(walkerLoop).concat([sleep(SECONDS * 1000)]));
  clearInterval(activity);
  const elapsed = (performance.now() - tStart) / 1000;
  const after = procStats(server.pid);
  const cpuPct = ((after.cpuTicks - before.cpuTicks) / 100) / elapsed * 100;

  const counts = (await http('GET', '/api/admin/presence', null, owner)).data;
  const result = {
    参加者: `先生${N_TEACHERS}人＋生徒${N_STUDENTS}人（同時接続 ${users.length}）`,
    接続にかかった時間: `${Math.round(connectMs)} ms（${users.length}人を順番に接続）`,
    入室と着席: `${entryResults.filter(Boolean).length}/${users.length}人が成功（${(entryMs / 1000).toFixed(1)} 秒）`,
    各教室の生徒数: rooms.map(r => `${r}: ${counts.rooms[r].students}/${counts.rooms[r].capacity}`).join('、'),
    授業中の教室: Object.keys(counts.classes).length,
    計測時間: `${elapsed.toFixed(0)} 秒`,
    '位置同期の遅延（中央値 / 95% / 99% / 最大）': `${pct(latencies, .5).toFixed(1)} / ${pct(latencies, .95).toFixed(1)} / ${pct(latencies, .99).toFixed(1)} / ${latencies.reduce((a, b) => Math.max(a, b), 0).toFixed(1)} ms（${latencies.length}件）`,
    'サーバーのCPU使用率（1コアあたり）': `${cpuPct.toFixed(1)} %`,
    サーバーのメモリ: `${after.rssMB.toFixed(0)} MB`,
    '1人あたりの受信量': `${(recvBytes / users.length / elapsed / 1024).toFixed(1)} KB/秒（${(recvMsgs / users.length / elapsed).toFixed(0)} メッセージ/秒）`,
    挙手の切り替え: hands, リアクション: reactions, 歩き回った回数: walksDone,
    拒否された移動: users.reduce((a, u) => a + u.c.rejected, 0),
  };
  console.log('\n===== 負荷テスト結果 =====');
  for (const [k, v] of Object.entries(result)) console.log(`${k}: ${v}`);
  users.forEach(u => u.c.s.disconnect());
  stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
