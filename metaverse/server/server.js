// 三浦塾メタバース サーバー（第1段階：ログイン・ユーザー管理・権限・教室設定）
const path = require('path');
const http = require('http');
const express = require('express');
const { db, now, transaction, audit, setSetting } = require('./db');
const auth = require('./auth');
const { PERMISSIONS, KEYS, STUDENT_FORBIDDEN, defaultPermissions, can, canEnterRoom } = require('./permissions');
const realtime = require('./realtime');
const livekit = require('./livekit');
const notify = require('./notify');
const ganbari = require('./ganbari');
const kanken = require('./kanken');

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// ── セキュリティヘッダー ──
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
    "media-src 'self' blob:", `connect-src 'self' ws://${req.headers.host} wss://${req.headers.host} ${livekit.cspSources().join(' ')}`.trim(), "font-src 'self'", "object-src 'none'",
    "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), display-capture=(self), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// 受け取るデータの大きさの上限（漢字テストのまとめて登録だけ大きめ）
const jsonSmall = express.json({ limit: '20kb' }), jsonBulk = express.json({ limit: '400kb' });
app.use('/api', (req, res, next) => (req.path === '/admin/kanken/questions/bulk' ? jsonBulk : jsonSmall)(req, res, next));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  // 他サイトからの書き込みリクエストを拒否（CSRF 対策）
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    let sameOrigin = true;
    if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
    if (!sameOrigin) return res.status(403).json({ error: '不正なリクエストです' });
    const isPhoto = req.path === '/study/photo' && req.is('image/jpeg');
    if (!req.is('application/json') && !isPhoto) return res.status(415).json({ error: '不正なリクエストです' });
  }
  next();
});

// ── 入力チェック ──
const RE_LOGIN = /^[a-zA-Z0-9_.-]{3,32}$/;
const RE_COLOR = /^#[0-9a-fA-F]{6}$/;
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 72) return 'パスワードは8〜72文字にしてください';
  return null;
}
function validateName(name) {
  if (!name || name.length > 20) return '表示名は1〜20文字にしてください';
  return null;
}
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ── 公開用のユーザー情報 ──
function publicUser(u) {
  return {
    id: u.id, loginId: u.login_id, displayName: u.display_name, role: u.role, avatarColor: u.avatar_color,
    isActive: u.is_active, permissions: u.permissions, rooms: u.rooms, grade: u.grade || null,
  };
}
function listRooms(user) {
  return db.prepare('SELECT id, name, type, capacity, max_capacity FROM rooms ORDER BY sort_order').all()
    .map(r => ({ id: r.id, name: r.name, type: r.type, capacity: r.capacity, maxCapacity: r.max_capacity, canEnter: canEnterRoom(user, r) }));
}

// ═════════ 初期セットアップ（ユーザーが1人もいないときだけ） ═════════
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

// いま動いている版（Render は RENDER_GIT_COMMIT に GitHub のコミット番号を入れてくれる）
const STARTED_AT = new Date().toISOString();
app.get('/api/version', (req, res) => {
  res.json({ version: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7), startedAt: STARTED_AT });
});

app.get('/api/setup-status', (req, res) => res.json({ needsSetup: userCount() === 0 }));

app.post('/api/setup', (req, res) => {
  if (userCount() > 0) return bad(res, 'セットアップは完了しています', 409);
  const loginId = String(req.body.loginId || '').trim();
  const displayName = cleanName(req.body.displayName);
  if (!RE_LOGIN.test(loginId)) return bad(res, 'ログインIDは半角英数字と _ . - の3〜32文字にしてください');
  const e = validateName(displayName) || validatePassword(req.body.password);
  if (e) return bad(res, e);
  const id = transaction(() => {
    if (userCount() > 0) throw new Error('race');
    const r = db.prepare('INSERT INTO users (login_id, display_name, role, password_hash, avatar_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(loginId, displayName, 'owner', auth.hashPassword(req.body.password), '#f59e0b', now(), now());
    db.prepare('INSERT INTO permissions (user_id) VALUES (?)').run(r.lastInsertRowid);
    return Number(r.lastInsertRowid);
  });
  audit(id, 'setup.owner_created', loginId, null, req.ip);
  const s = auth.createSession(id, req);
  auth.setSessionCookie(res, s.token, s.expires);
  res.json({ user: publicUser(auth.loadUser(id)) });
});

// ═════════ ログイン / ログアウト ═════════
app.post('/api/login', (req, res) => {
  const loginId = String(req.body.loginId || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const ipKey = 'ip:' + req.ip, idKey = 'id:' + loginId;
  if (auth.isLocked(ipKey) || auth.isLocked(idKey)) {
    return bad(res, `ログインの失敗が続いたため、${auth.LOCK_MINUTES}分ほど待ってからもう一度ためしてください`, 429);
  }
  const row = db.prepare('SELECT id, password_hash, is_active FROM users WHERE login_id = ?').get(loginId);
  const ok = auth.verifyPassword(password, row ? row.password_hash : auth.DUMMY_HASH) && row;
  if (!ok || !row.is_active) {
    auth.recordFailure(ipKey, 20); auth.recordFailure(idKey, 5);
    audit(row ? row.id : null, 'login.failed', loginId, row && !row.is_active ? { reason: 'inactive' } : null, req.ip);
    return bad(res, row && ok && !row.is_active ? 'このアカウントは使えません。先生に相談してください' : 'IDかパスワードがちがいます', 401);
  }
  auth.clearFailures(idKey);
  const s = auth.createSession(row.id, req);
  auth.setSessionCookie(res, s.token, s.expires);
  audit(row.id, 'login.success', loginId, null, req.ip);
  res.json({ user: publicUser(auth.loadUser(row.id)) });
});

app.post('/api/logout', (req, res) => {
  const u = auth.userFromRequest(req);
  if (u) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(u.sessionTokenHash);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', auth.requireAuth, (req, res) => {
  res.json({
    user: publicUser(req.user), rooms: listRooms(req.user),
    features: { classCall: livekit.enabled, studyPhotos: realtime.studyPhotosEnabled() },
  });
});

// ═════════ 入室前の漢字テスト ═════════
app.get('/api/quiz/status', auth.requireAuth, (req, res) => {
  res.json({ required: kanken.required(req.user, { quickRejoin: realtime.isQuickRejoin(req.user.id) }) });
});
app.post('/api/quiz/question', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'student') return bad(res, '生徒の機能です', 403);
  const q = kanken.newQuestion(req.user);
  if (!q) return bad(res, '問題がありません', 404);
  res.json(q);
});
app.post('/api/quiz/answer', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'student') return bad(res, '生徒の機能です', 403);
  const r = kanken.answer(req.user, Number(req.body.choice));
  if (r.error) return bad(res, r.error);
  res.json(r);
});

// ═════════ がんばり（生徒） ═════════
app.get('/api/me/ganbari', auth.requireAuth, (req, res) => {
  const c = ganbari.getConfig();
  const today = ganbari.jst().day;
  const term = ganbari.termOf(today, c);
  const u = req.user;
  res.json({
    grade: u.grade || null, todayMinutes: ganbari.dayTotal(u.id, today),
    termMinutes: term ? ganbari.minutesBetween(u.id, term.start, term.end) : 0, term,
    points: ganbari.points(u.id), streak: ganbari.streak(u.id), equip: ganbari.getEquip(u.id),
    shop: ganbari.shopFor(u.id), goal: term ? ganbari.goalOf(u.id, term.key) : null,
    dressup: ganbari.dressupInfo(), myItems: ganbari.getEquip(u.id, { ignorePeriod: true }).ids,
    rules: { minutesPerPoint: c.minutesPerPoint, streakMin: c.streakMin, window: c.window, requireSeat: c.requireSeat, today: ganbari.ruleFor(today, c) },
  });
});
app.post('/api/me/shop/buy', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'student') return bad(res, 'ポイントは生徒の機能です', 403);
  const err = ganbari.buy(req.user.id, String(req.body.item || ''));
  if (err) return bad(res, err);
  res.json({ ok: true, points: ganbari.points(req.user.id) });
});
app.post('/api/me/equip', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'student') return bad(res, '着せかえは生徒の機能です', 403);
  const err = ganbari.equip(req.user.id, String(req.body.slot || ''), req.body.item === null ? null : String(req.body.item || ''));
  if (err) return bad(res, err);
  realtime.refreshGanbari(req.user.id);
  res.json({ ok: true, equip: ganbari.getEquip(req.user.id) });
});
app.post('/api/me/goal', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'student') return bad(res, '目標は生徒の機能です', 403);
  const err = ganbari.setGoal(req.user.id, req.body.text);
  if (err) return bad(res, err);
  const term = ganbari.termOf(ganbari.jst().day);
  res.json({ ok: true, goal: ganbari.goalOf(req.user.id, term.key) });
});
// 学年の木（ログインしている人なら誰でも見られる）
app.get('/api/forest', auth.requireAuth, (req, res) => res.json(ganbari.forest()));

// 保護者レポート（ログイン不要。リンクに含まれる合いことばで1人分だけ見られる）
app.post('/api/report-data', (req, res) => {
  const data = ganbari.reportData(String(req.body.token || ''));
  if (!data) return bad(res, 'このレポートは見られません（期限切れか、リンクがまちがっています）', 404);
  res.json(data);
});

// ═════════ 入室の通知（オーナー・先生） ═════════
const requireStaff = (req, res, next) => (notify.isStaffRole(req.user.role) ? next() : bad(res, 'この機能は先生とオーナー用です', 403));
app.get('/api/notify', auth.requireAuth, requireStaff, (req, res) => {
  res.json({ prefs: notify.getPrefs(req.user.id), publicKey: notify.publicKey(), devices: notify.deviceCount(req.user.id) });
});
app.patch('/api/notify', auth.requireAuth, requireStaff, (req, res) => {
  res.json({ prefs: notify.setPrefs(req.user.id, { arrivals: !!req.body.arrivals }) });
});
app.post('/api/notify/subscribe', auth.requireAuth, requireStaff, (req, res) => {
  const err = notify.subscribe(req.user.id, req.body.subscription, req.body.device);
  if (err) return bad(res, err);
  audit(req.user.id, 'notify.subscribed', req.user.login_id, { device: String(req.body.device || '').slice(0, 60) }, req.ip);
  res.json({ ok: true, devices: notify.deviceCount(req.user.id) });
});
app.post('/api/notify/unsubscribe', auth.requireAuth, requireStaff, (req, res) => {
  notify.unsubscribe(req.user.id, req.body.endpoint);
  res.json({ ok: true, devices: notify.deviceCount(req.user.id) });
});
// テスト通知（この端末に届くか確かめる）
app.post('/api/notify/test', auth.requireAuth, requireStaff, async (req, res) => {
  const r = await notify.pushTo(req.user.id, { title: '🔔 テスト通知', body: '通知はこのように届きます（三浦塾 オンライン教室）', tag: 'test', url: '/app' });
  res.json({ sent: r.sent, errors: r.errors, devices: notify.deviceCount(req.user.id) });
});

// ═════════ 自習室の見守り写真 ═════════
// 生徒の端末から10分に1回届く写真（JPEG）。最新の1枚だけをメモリに置き、データベースには保存しない
app.post('/api/study/photo', express.raw({ type: 'image/jpeg', limit: '300kb' }), auth.requireAuth, (req, res) => {
  const err = realtime.storeStudyPhoto(req.user.id, req.body, {
    brightness: req.get('X-Photo-Brightness'), fp: req.get('X-Photo-Fp'), reason: req.get('X-Photo-Reason'),
  });
  if (err) return bad(res, err, 400);
  res.json({ ok: true });
});
// 見られるのはオーナーと「生徒への個別対応」の権限がある先生だけ
app.get('/api/study/photo/:id', auth.requireAuth, (req, res) => {
  if (!realtime.canViewStudyPhotos(req.user)) return bad(res, 'この写真を見る権限がありません', 403);
  const ph = realtime.getStudyPhoto(req.params.id);
  if (!ph) return bad(res, '写真はありません', 404);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(ph.buf);
});
app.get('/api/study/photos', auth.requireAuth, (req, res) => {
  if (!realtime.canViewStudyPhotos(req.user)) return bad(res, 'この写真を見る権限がありません', 403);
  res.json({ times: realtime.studyPhotoTimes() });
});

app.post('/api/me/password', auth.requireAuth, (req, res) => {
  const key = 'pw:' + req.user.id;
  if (auth.isLocked(key)) return bad(res, `失敗が続いたため、${auth.LOCK_MINUTES}分ほど待ってからもう一度ためしてください`, 429);
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!auth.verifyPassword(String(req.body.currentPassword || ''), row.password_hash)) {
    auth.recordFailure(key, 5);
    return bad(res, '今のパスワードがちがいます', 401);
  }
  auth.clearFailures(key);
  const e = validatePassword(req.body.newPassword);
  if (e) return bad(res, e);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(auth.hashPassword(req.body.newPassword), now(), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.user.sessionTokenHash);
  audit(req.user.id, 'user.password_changed_self', req.user.login_id, null, req.ip);
  res.json({ ok: true });
});

// ═════════ 管理画面 API ═════════
const admin = express.Router();
admin.use(auth.requireAuth);
const requireOwner = auth.requireRole('owner');
const requireRoomManager = (req, res, next) => can(req.user, 'manage_classroom') ? next() : bad(res, 'この操作は許可されていません', 403);

admin.get('/meta', (req, res) => {
  res.json({
    canReviewGoals: req.user.role === 'owner' || (req.user.role === 'teacher' && can(req.user, 'handle_students')),
    grades: ganbari.GRADES,
    permissions: PERMISSIONS.map(p => ({ key: p.key, label: p.label })),
    studentForbidden: STUDENT_FORBIDDEN,
    rooms: db.prepare('SELECT id, name, type FROM rooms ORDER BY sort_order').all(),
    canManageUsers: req.user.role === 'owner',
    canManageRooms: can(req.user, 'manage_classroom'),
  });
});

admin.get('/users', requireOwner, (req, res) => {
  const ids = db.prepare("SELECT id FROM users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END, display_name").all();
  const sessionCounts = new Map(db.prepare('SELECT user_id, COUNT(*) AS n FROM sessions WHERE expires_at > ? GROUP BY user_id').all(now()).map(r => [r.user_id, r.n]));
  res.json({ users: ids.map(({ id }) => ({ ...publicUser(auth.loadUser(id)), activeSessions: sessionCounts.get(id) || 0 })) });
});

function applyPermissionsAndRooms(userId, role, permissions, rooms) {
  if (role === 'owner') return;
  const base = defaultPermissions(role);
  const p = {};
  for (const k of KEYS) {
    let v = permissions && typeof permissions[k] === 'boolean' ? permissions[k] : base[k];
    if (role === 'student' && STUDENT_FORBIDDEN.includes(k)) v = false; // 生徒には付与させない
    p[k] = v ? 1 : 0;
  }
  const cols = PERMISSIONS.map(d => d.column);
  db.prepare(`INSERT INTO permissions (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})
    ON CONFLICT(user_id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`)
    .run(userId, ...PERMISSIONS.map(d => p[d.key]));
  if (role === 'teacher' && Array.isArray(rooms)) {
    const valid = new Set(db.prepare("SELECT id FROM rooms WHERE type = 'classroom'").all().map(r => r.id));
    db.prepare('DELETE FROM teacher_rooms WHERE user_id = ?').run(userId);
    for (const r of new Set(rooms)) if (valid.has(r)) db.prepare('INSERT INTO teacher_rooms (user_id, room_id) VALUES (?, ?)').run(userId, r);
  }
}

admin.post('/users', requireOwner, (req, res) => {
  const b = req.body || {};
  const role = b.role;
  const loginId = String(b.loginId || '').trim();
  const displayName = cleanName(b.displayName);
  if (!['teacher', 'student'].includes(role)) return bad(res, '役割を選んでください');
  if (!RE_LOGIN.test(loginId)) return bad(res, 'ログインIDは半角英数字と _ . - の3〜32文字にしてください');
  const e = validateName(displayName) || validatePassword(b.password);
  if (e) return bad(res, e);
  if (db.prepare('SELECT 1 FROM users WHERE login_id = ?').get(loginId)) return bad(res, 'このログインIDはすでに使われています', 409);
  const color = RE_COLOR.test(b.avatarColor || '') ? b.avatarColor : '#64b5f6';
  const grade = role === 'student' && ganbari.GRADES.includes(b.grade) ? b.grade : null;
  const id = transaction(() => {
    const r = db.prepare('INSERT INTO users (login_id, display_name, role, password_hash, avatar_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(loginId, displayName, role, auth.hashPassword(b.password), color, now(), now());
    const id = Number(r.lastInsertRowid);
    if (grade) db.prepare('UPDATE users SET grade = ? WHERE id = ?').run(grade, id);
    applyPermissionsAndRooms(id, role, b.permissions, b.rooms);
    return id;
  });
  audit(req.user.id, 'user.created', loginId, { role }, req.ip);
  res.status(201).json({ user: publicUser(auth.loadUser(id)) });
});

admin.patch('/users/:id', requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const target = auth.loadUser(id);
  if (!target) return bad(res, 'ユーザーが見つかりません', 404);
  const b = req.body || {};
  const changes = [];
  const isSelf = id === req.user.id;
  if (target.role === 'owner' && !isSelf) return bad(res, 'ほかのオーナーは編集できません', 403);

  const result = transaction(() => {
    if (b.displayName !== undefined) {
      const name = cleanName(b.displayName);
      const e = validateName(name); if (e) return e;
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, id); changes.push('displayName');
    }
    if (b.grade !== undefined) {
      if (target.role !== 'student') return '学年は生徒だけに設定できます';
      if (b.grade !== null && b.grade !== '卒業' && !ganbari.GRADES.includes(b.grade)) return '学年が正しくありません';
      db.prepare('UPDATE users SET grade = ? WHERE id = ?').run(b.grade, id); changes.push('grade');
    }
    if (b.avatarColor !== undefined) {
      if (!RE_COLOR.test(b.avatarColor)) return '色の指定が正しくありません';
      db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(b.avatarColor, id); changes.push('avatarColor');
    }
    if (b.password) {
      const e = validatePassword(b.password); if (e) return e;
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(b.password), id); changes.push('password');
    }
    if (b.isActive !== undefined) {
      if (target.role === 'owner') return 'オーナーは無効化できません';
      db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(b.isActive ? 1 : 0, id); changes.push('isActive');
    }
    if (b.permissions !== undefined || b.rooms !== undefined) {
      if (target.role === 'owner') return 'オーナーの権限は変更できません';
      applyPermissionsAndRooms(id, target.role, b.permissions ?? target.permissions, b.rooms ?? target.rooms);
      changes.push('permissions');
    }
    db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(now(), id);
    return null;
  });
  if (result) return bad(res, result);
  // 無効化・パスワード変更時はログイン中の端末をすべてログアウトさせる
  if ((b.isActive === false || b.password) && !isSelf) {
    auth.revokeUserSessions(id);
    realtime.kick(id, b.isActive === false ? 'このアカウントは使えなくなりました' : 'パスワードが変更されたため、もう一度ログインしてください');
  } else {
    realtime.refreshUser(id);
  }
  audit(req.user.id, 'user.updated', target.login_id, { changes }, req.ip);
  res.json({ user: publicUser(auth.loadUser(id)) });
});

admin.post('/users/:id/revoke-sessions', requireOwner, (req, res) => {
  const target = auth.loadUser(Number(req.params.id));
  if (!target) return bad(res, 'ユーザーが見つかりません', 404);
  if (target.id === req.user.id) return bad(res, '自分自身は強制ログアウトできません');
  const n = auth.revokeUserSessions(target.id);
  realtime.kick(target.id, '管理者によってログアウトされました');
  audit(req.user.id, 'user.sessions_revoked', target.login_id, { count: n }, req.ip);
  res.json({ revoked: n });
});

admin.get('/rooms', requireRoomManager, (req, res) => {
  res.json({ rooms: db.prepare('SELECT id, name, type, capacity, max_capacity AS maxCapacity FROM rooms ORDER BY sort_order').all() });
});

admin.patch('/rooms/:id', requireRoomManager, (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return bad(res, '部屋が見つかりません', 404);
  const cap = Number(req.body.capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > room.max_capacity) return bad(res, `定員は1〜${room.max_capacity}人で設定してください（座席数が上限です）`);
  db.prepare('UPDATE rooms SET capacity = ? WHERE id = ?').run(cap, room.id);
  realtime.refreshRooms();
  audit(req.user.id, 'room.capacity_changed', room.id, { from: room.capacity, to: cap }, req.ip);
  res.json({ room: { id: room.id, capacity: cap } });
});

// ── 入室状況（第2段階） ──
admin.get('/presence', requireRoomManager, (req, res) => {
  const isOwner = req.user.role === 'owner';
  const users = realtime.presence().map(u => (isOwner ? u : { ...u, ip: undefined }));
  res.json({ rooms: realtime.roomCounts(), classes: realtime.classState(), users });
});

// 個別通話を管理者が終了させる（オーナーのみ）。:userId は通話中の先生か生徒
admin.post('/calls/:userId/end', requireOwner, (req, res) => {
  const ok = realtime.endCallOf(req.params.userId, req.user.id);
  if (!ok) return bad(res, 'その人は個別通話中ではありません', 404);
  res.json({ ok: true });
});

// 授業（全体通話）を管理者が終了させる（オーナーのみ）
admin.post('/classes/:roomId/end', requireOwner, (req, res) => {
  const ok = realtime.endClass(req.params.roomId, '管理者が授業を終了しました', req.user.id);
  if (!ok) return bad(res, 'その教室は授業中ではありません', 404);
  res.json({ ok: true });
});

// 不審な接続を止める（オーナーのみ）。revoke: true ならその人のログインもすべて無効にする
admin.post('/presence/:id/disconnect', requireOwner, (req, res) => {
  const target = auth.loadUser(Number(req.params.id));
  if (!target) return bad(res, 'ユーザーが見つかりません', 404);
  if (target.id === req.user.id) return bad(res, '自分自身は切断できません');
  const revoke = !!req.body.revoke;
  if (revoke) auth.revokeUserSessions(target.id);
  const was = realtime.kick(target.id, revoke ? '管理者によってログアウトされました' : '管理者によって接続が切断されました');
  audit(req.user.id, revoke ? 'presence.disconnected_and_revoked' : 'presence.disconnected', target.login_id, null, req.ip);
  res.json({ disconnected: was });
});

// ── がんばり（オーナー） ──
admin.get('/ganbari/config', requireOwner, (req, res) => {
  const c = ganbari.getConfig();
  res.json({ config: c, terms: ganbari.allTerms(c), current: ganbari.termOf(ganbari.jst().day, c), grades: ganbari.GRADES, stageNames: ganbari.STAGE_NAMES, events: ganbari.EVENTS });
});
admin.patch('/ganbari/config', requireOwner, (req, res) => {
  const err = ganbari.setConfig(req.body, req.user.id);
  if (err) return bad(res, err);
  realtime.refreshAllGanbari();
  res.json({ config: ganbari.getConfig() });
});
admin.get('/ganbari/students', requireOwner, (req, res) => res.json({ students: ganbari.studentSummary() }));
admin.get('/ganbari/students/:id/days', requireOwner, (req, res) => {
  const from = String(req.query.from || ''), to = String(req.query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return bad(res, '期間が正しくありません');
  res.json({ days: ganbari.daysBetween(Number(req.params.id), from, to) });
});
admin.put('/ganbari/students/:id/days/:day', requireOwner, (req, res) => {
  const target = auth.loadUser(Number(req.params.id));
  if (!target || target.role !== 'student') return bad(res, '生徒が見つかりません', 404);
  const m = req.body.minutes === null ? null : Number(req.body.minutes);
  const err = ganbari.setManual(target.id, req.params.day, m, req.user.id);
  if (err) return bad(res, err);
  realtime.refreshGanbari(target.id);
  res.json({ ok: true });
});
admin.post('/ganbari/new-year', requireOwner, (req, res) => {
  const err = ganbari.newYear(req.body.terms, !!req.body.promote, req.user.id);
  if (err) return bad(res, err);
  realtime.refreshAllGanbari();
  res.json({ ok: true, config: ganbari.getConfig() });
});
// 目標の確認（オーナーと、生徒への個別対応の権限がある先生）
const requireGoalReviewer = (req, res, next) =>
  (req.user.role === 'owner' || (req.user.role === 'teacher' && can(req.user, 'handle_students')) ? next() : bad(res, 'この操作は許可されていません', 403));
admin.get('/ganbari/goals', requireGoalReviewer, (req, res) => {
  const term = ganbari.termOf(ganbari.jst().day);
  res.json({ term, goals: term ? ganbari.listGoals(term.key) : [] });
});
admin.post('/ganbari/goals/:id/review', requireGoalReviewer, (req, res) => {
  const err = ganbari.reviewGoal(Number(req.params.id), String(req.body.action || ''), req.user.id);
  if (err) return bad(res, err);
  res.json({ ok: true });
});
// 保護者レポートのリンクを作る（オーナー）
function reportTerm(key) {
  return ganbari.allTerms().find(t => t.key === key) || null;
}
admin.post('/ganbari/reports', requireOwner, (req, res) => {
  const term = reportTerm(req.body.termKey);
  if (!term) return bad(res, '学期を選んでください');
  const ids = req.body.all ? db.prepare("SELECT id FROM users WHERE role = 'student' AND is_active = 1 ORDER BY grade, display_name").all().map(r => r.id)
    : [Number(req.body.userId)];
  const out = [];
  for (const id of ids) {
    const u = auth.loadUser(id);
    if (!u || u.role !== 'student') continue;
    const token = ganbari.createReport(id, term, req.body.comment, req.user.id);
    out.push({ userId: id, name: u.display_name, grade: u.grade, path: '/report#' + token });
  }
  if (!out.length) return bad(res, '生徒が見つかりません', 404);
  res.json({ reports: out, term });
});

// ── 漢字テスト（オーナー） ──
admin.get('/kanken', requireOwner, (req, res) => {
  res.json({ config: kanken.getConfig(), levels: kanken.LEVELS, grades: ganbari.GRADES, questions: kanken.listQuestions(), stats: kanken.stats() });
});
admin.patch('/kanken/config', requireOwner, (req, res) => {
  const err = kanken.setConfig(req.body, req.user.id);
  if (err) return bad(res, err);
  res.json({ config: kanken.getConfig() });
});
admin.post('/kanken/questions', requireOwner, (req, res) => {
  const err = kanken.addQuestion(req.body, req.user.id);
  if (err) return bad(res, err);
  res.status(201).json({ ok: true });
});
admin.post('/kanken/questions/bulk', requireOwner, (req, res) => {
  const r = kanken.addBulk(req.body.rows, req.user.id);
  if (r.error) return bad(res, r.error);
  res.json(r);
});
admin.patch('/kanken/questions/:id', requireOwner, (req, res) => {
  const err = kanken.updateQuestion(Number(req.params.id), req.body, req.user.id);
  if (err) return bad(res, err);
  res.json({ ok: true });
});
admin.delete('/kanken/questions/:id', requireOwner, (req, res) => {
  const err = kanken.deleteQuestion(Number(req.params.id), req.user.id);
  if (err) return bad(res, err, 404);
  res.json({ ok: true });
});

// 塾全体の設定（オーナーのみ）
admin.get('/settings', requireOwner, (req, res) => {
  res.json({ studyPhotos: realtime.studyPhotosEnabled() });
});
admin.patch('/settings', requireOwner, (req, res) => {
  if (typeof req.body.studyPhotos === 'boolean') {
    setSetting('study_photos', req.body.studyPhotos ? '1' : '0');
    realtime.setStudyPhotosFeature(req.body.studyPhotos);
    audit(req.user.id, 'settings.study_photos', req.body.studyPhotos ? 'on' : 'off', null, req.ip);
  }
  res.json({ studyPhotos: realtime.studyPhotosEnabled() });
});

admin.get('/logs', requireOwner, (req, res) => {
  const logs = db.prepare(`SELECT l.id, l.at, l.action, l.target, l.detail, l.ip, u.display_name AS actor
    FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT 200`).all();
  res.json({ logs });
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => bad(res, '見つかりません', 404));

// ── 画面 ──
// LiveKit のブラウザ用ライブラリ（外部CDNを使わず、このサーバーから配信）
const LK_DIST = path.join(path.dirname(require.resolve('livekit-client')), '');
app.get(['/vendor/livekit-client.umd.js', '/vendor/livekit-client.umd.js.map'], (req, res) => {
  res.sendFile(path.join(LK_DIST, path.basename(req.path)), { maxAge: '1d' });
});
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], index: 'index.html' }));

app.use((err, req, res, _next) => {
  if (!err.status || err.status >= 500) console.error(err); // 利用者側の誤り（4xx）は記録しない
  if (req.path.startsWith('/api')) return bad(res, err.type === 'entity.parse.failed' ? '不正なリクエストです' : 'サーバーでエラーが起きました', err.status || 500);
  res.status(500).send('Server error');
});

function createServer() {
  const server = http.createServer(app);
  realtime.attach(server);
  return server;
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`三浦塾メタバース: http://localhost:${PORT}`));
}
module.exports = app;
module.exports.createServer = createServer;
