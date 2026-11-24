// 三浦塾メタバース サーバー（第1段階：ログイン・ユーザー管理・権限・教室設定）
const path = require('path');
const http = require('http');
const express = require('express');
const { db, now, transaction, audit, setSetting, getSetting } = require('./db');
const auth = require('./auth');
const { PERMISSIONS, KEYS, STUDENT_FORBIDDEN, defaultPermissions, can, canEnterRoom } = require('./permissions');
const realtime = require('./realtime');
const livekit = require('./livekit');
const notify = require('./notify');
const ganbari = require('./ganbari');
const fun = require('./fun');
const startphoto = require('./startphoto');
const parents = require('./parents');
const birthday = require('./birthday');
const onboard = require('./onboard');
const reading = require('./reading');
const writing = require('./writing');
const referral = require('./referral');
const myseat = require('./myseat');
const SchoolMap = require('../public/shared/map.js');
const kanken = require('./kanken');

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// ── セキュリティヘッダー ──
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
    "media-src 'self' blob:", `connect-src 'self' ws://${req.headers.host} wss://${req.headers.host} ${livekit.cspSources().join(' ')} ${speechCsp()}`.trim(), "font-src 'self'", "object-src 'none'",
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
app.use('/api', (req, res, next) => (req.path === '/admin/kanken/questions/bulk' || req.path === '/admin/parent-questions/bulk' ? jsonBulk : jsonSmall)(req, res, next));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  // 他サイトからの書き込みリクエストを拒否（CSRF 対策）
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    let sameOrigin = true;
    if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
    if (!sameOrigin) return res.status(403).json({ error: '不正なリクエストです' });
    const isPhoto = (req.path === '/study/photo' || req.path === '/me/start-photo' || req.path === '/reading/writing') && req.is('image/jpeg');
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
// 本番の音読テスト：Microsoft の音声サービスにつなぐ先（キーがあるときだけ）
const speechCsp = () => { const r = (process.env.AZURE_SPEECH_REGION || '').replace(/[^a-z0-9]/g, ''); return process.env.AZURE_SPEECH_KEY && r ? `wss://${r}.stt.speech.microsoft.com https://${r}.stt.speech.microsoft.com https://${r}.api.cognitive.microsoft.com` : ''; };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ── 公開用のユーザー情報 ──
function publicUser(u) {
  return {
    id: u.id, loginId: u.login_id, displayName: u.display_name, role: u.role, avatarColor: u.avatar_color,
    isActive: u.is_active, permissions: u.permissions, rooms: u.rooms, grade: u.grade || null,
    birthday: u.birthday || null, birthdayPublic: u.birthday_public === undefined ? true : !!u.birthday_public,
    visitDays: u.visit_days ? u.visit_days.split(',').map(Number) : [], visitTime: u.visit_time || null,
    classDays: u.class_days ? u.class_days.split(',').map(Number) : [],
    trialUntil: u.trial_until || null,
    hair: u.staff_hair || null, // 先生・オーナーの髪型
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
    return bad(res, `ログインの失敗が続いたため、${auth.LOCK_MINUTES}分ほど待ってからもう一度ためしてください（先生にたのむと、すぐ解除できます）`, 429);
  }
  const row = db.prepare('SELECT id, password_hash, is_active FROM users WHERE login_id = ?').get(loginId);
  const ok = auth.verifyPassword(password, row ? row.password_hash : auth.DUMMY_HASH) && row;
  if (!ok || !row.is_active) {
    auth.recordFailure(ipKey, 20); auth.recordFailure(idKey, 5);
    audit(row ? row.id : null, 'login.failed', loginId, row && !row.is_active ? { reason: 'inactive' } : null, req.ip);
    if (row && ok && !row.is_active) return bad(res, 'このアカウントは使えません。先生に相談してください', 401);
    const left = auth.failuresLeft(idKey, 5);
    if (auth.isLocked(idKey)) return bad(res, `IDかパスワードがちがいます。まちがいが続いたため、${auth.LOCK_MINUTES}分ほど入れません（先生にたのむと、すぐ解除できます）`, 401);
    return bad(res, 'IDかパスワードがちがいます' + (left <= 3 ? `（あと${left}回まちがえると、${auth.LOCK_MINUTES}分入れなくなります）` : ''), 401);
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
    // 保護者会の時間は、生徒は入れない
    trial: req.user.trial_until ? { until: req.user.trial_until, inviter: (db.prepare('SELECT display_name FROM users WHERE id = ?').get(referral.referrerOf(req.user.id)) || {}).display_name || null } : null,
    closed: req.user.role === 'student' && parents.meetingOn() ? `今は保護者会です。${parents.getMeeting().end}から入れます` : null,
    onboard: onboard.status(req.user), // ようこそツアーを見たか・はじめての日の「やることチェック」
  });
});
// ═════ 英語の音読（練習） ═════
app.get('/api/reading/units', auth.requireAuth, (req, res) => {
  if (req.user.role === 'parent') return bad(res, '生徒の機能です', 403);
  res.json({ units: reading.unitsFor(req.user), passScore: reading.getConfig().passScore });
});
app.post('/api/reading/practice', auth.requireAuth, (req, res) => {
  if (req.user.role === 'parent') return bad(res, '生徒の機能です', 403);
  const r = reading.recordPractice(req.user, Number(req.body.unitId), req.body.score, req.body.seconds, req.body.jaOnly === true, req.body.missing);
  if (r.error) return bad(res, r.error);
  res.json(r);
});
// 本番のテスト：Microsoft の発音評価を、生徒の端末から直接使うための短い合言葉（10分）。キーそのものは渡さない
const SPEECH_KEY = process.env.AZURE_SPEECH_KEY || '', SPEECH_REGION = (process.env.AZURE_SPEECH_REGION || '').replace(/[^a-z0-9]/g, '');
let speechToken = { value: null, at: 0 };
app.get('/api/reading/speech-token', auth.requireAuth, async (req, res) => {
  if (req.user.role === 'parent') return bad(res, '生徒の機能です', 403);
  if (!SPEECH_KEY || !SPEECH_REGION) return bad(res, '本番のテストの採点の準備がまだできていません（先生に伝えてね）', 503);
  if (!speechToken.value || Date.now() - speechToken.at > 8 * 60e3) {
    try {
      const r = await fetch(`https://${SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': SPEECH_KEY, 'Content-Length': '0' } });
      if (!r.ok) throw new Error('status ' + r.status);
      speechToken = { value: await r.text(), at: Date.now() };
    } catch (e) { console.error('音声サービスの合言葉をもらえませんでした:', e.message); return bad(res, '採点の準備ができませんでした。少し待ってからもう一度ためしてね', 502); }
  }
  res.json({ token: speechToken.value, region: SPEECH_REGION });
});
app.post('/api/reading/test', auth.requireAuth, (req, res) => {
  if (req.user.role === 'parent') return bad(res, '生徒の機能です', 403);
  const r = reading.recordTest(req.user, Number(req.body.unitId), req.body || {});
  if (r.error) return bad(res, r.error);
  if (r.points) realtime.refreshGanbari(req.user.id);
  realtime.activityResult(req.user, `🎤 スピーキングテスト「${r.title}」${r.score}点 → ${r.passed ? '🏅 合格' + (r.points ? `（+${r.points}pt）` : '') : '再テスト' + (r.missing >= reading.MAX_MISSING ? `（読めていない単語 ${r.missing}個）` : r.seconds > r.limit ? '（時間オーバー）' : '')}`);
  res.json(r);
});
// ✍️ ライティング：ノートの写真をおくる（?unitId=&mode=practice|test）。文字を読み取って本文とくらべる
app.post('/api/reading/writing', express.raw({ type: 'image/jpeg', limit: '4mb' }), auth.requireAuth, async (req, res) => {
  if (req.user.role === 'parent') return bad(res, '生徒の機能です', 403);
  const unit = db.prepare('SELECT * FROM reading_units WHERE id = ? AND active = 1').get(Number(req.query.unitId));
  if (!unit) return bad(res, '単元が見つかりません', 404);
  const r = await writing.grade(req.user, unit, String(req.query.mode || ''), req.body);
  if (r.error) return bad(res, r.error, r.code || 400);
  if (r.points) realtime.refreshGanbari(req.user.id);
  if (req.query.mode === 'test') realtime.activityResult(req.user, `✍️ ライティングテスト「${unit.title}」${r.score}点 → ${r.passed ? '🏅 合格' + (r.points ? `（+${r.points}pt）` : '') : '再テスト'}`);
  res.json(r);
});
app.post('/api/me/tour-seen', auth.requireAuth, (req, res) => { onboard.markTour(req.user.id); res.json({ ok: true }); });
app.post('/api/me/first-day', auth.requireAuth, (req, res) => {
  const r = onboard.finishFirstDay(req.user);
  if (r.error) return bad(res, r.error);
  realtime.refreshGanbari(req.user.id);
  res.json(r);
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
  const dg = isESUser(u) ? startphoto.goalOf(u.id) : null;
  res.json({ esShop: isESUser(u) ? { boughtThisMonth: ganbari.esBoughtThisMonth(u.id) } : null, dailyGoal: dg ? { minutes: dg, all: ganbari.dayAll(u.id, today), done: ganbari.dayAll(u.id, today) >= dg } : null,
    grade: u.grade || null, todayMinutes: ganbari.dayTotal(u.id, today), todayAll: ganbari.dayAll(u.id, today),
    termMinutes: term ? ganbari.minutesBetween(u.id, term.start, term.end) : 0, term,
    points: ganbari.points(u.id), streak: u.role === 'parent' ? parents.visitStreak(u.id) : ganbari.streak(u.id), equip: ganbari.getEquip(u.id),
    shop: ganbari.shopFor(u.id), goal: term ? ganbari.goalOf(u.id, term.key) : null,
    dressup: ganbari.dressupInfo(), myItems: ganbari.getEquip(u.id, { ignorePeriod: true }).ids,
    hs: ganbari.isHS(u.grade) ? { ...ganbari.hsWeeks(u.id), title: ganbari.titleOf(u.id), plan: ganbari.planOf(u.id), visitDays: u.visit_days ? u.visit_days.split(',').map(Number) : [], visitTime: u.visit_time || null } : null,
    fun: u.role === 'student' && !u.trial_until ? fun.statusFor(u.id) : null, parent: u.role === 'parent',
    pair: u.role === 'student' && !u.trial_until ? referral.pairOf(u.id) : null,
    mySeat: u.role === 'student' ? myseat.statusOf(u.id) : null,
    referralWeek: referral.weekOn() ? referral.getConfig().week : null,
    rules: { minutesPerPoint: c.minutesPerPoint, streakMin: ganbari.streakMinFor(u.id, c), window: ganbari.rulesSrc(c, ganbari.groupOf(u.grade)).window, window2: ganbari.rulesSrc(c, ganbari.groupOf(u.grade)).window2, requireSeat: c.requireSeat, today: ganbari.ruleFor(today, c, ganbari.groupOf(u.grade)) },
  });
});
app.post('/api/me/shop/buy', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'parent') return bad(res, 'ポイントは生徒と保護者の機能です', 403);
  const err = ganbari.buy(req.user.id, String(req.body.item || ''));
  if (err) return bad(res, err);
  res.json({ ok: true, points: ganbari.points(req.user.id) });
});
app.post('/api/me/equip', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'parent') return bad(res, '着せかえは生徒と保護者の機能です', 403);
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
app.get('/api/forest', auth.requireAuth, (req, res) => {
  const f = ganbari.forest();
  // 保護者には、自分の子ども以外の生徒の名前を見せない（短冊の目標は見せる）
  if (req.user.role === 'parent') { const mine = new Set(parents.childrenOf(req.user.id).map(k => k.name)); for (const t of f.trees) for (const g of t.goals) if (!mine.has(g.name)) g.name = '生徒'; }
  res.json({ ...f, moms: parents.momsTree() });
});

// ═════════ 友だち紹介・体験 ═════════
// 招待リンクの中身（ログインしていなくても見られる。だれからの招待かと体験の日数）
app.get('/api/trial/info', (req, res) => {
  const c = referral.getConfig(), inv = referral.inviterOf(req.query.code);
  if (!c.trial) return res.json({ ok: false, error: 'いまは体験の受付をしていません' });
  if (!inv) return res.json({ ok: false, error: '招待のリンクが正しくありません' });
  res.json({ ok: true, inviter: inv.role === 'parent' ? null : inv.name, days: referral.trialDays(), week: referral.weekOn() });
});
// 体験をはじめる（体験用のアカウントを作ってログイン）
app.post('/api/trial/start', (req, res) => {
  const ipKey = 'ip:' + req.ip;
  if (auth.isLocked(ipKey)) return bad(res, `まちがいが続いたため、${auth.LOCK_MINUTES}分ほど待ってからためしてください`, 429);
  const b = req.body || {};
  const r = referral.startTrial({ code: b.code, name: b.name, grade: b.grade }, req.ip);
  if (r.error) { if (/リンク/.test(r.error)) auth.recordFailure(ipKey, 10); return bad(res, r.error, r.status || 400); }
  const s = auth.createSession(r.id, req, r.until);
  auth.setSessionCookie(res, s.token, s.expires);
  res.json({ ok: true, until: r.until, days: r.days });
});
// 自分の招待リンク（入塾している生徒・保護者）
app.get('/api/me/referral', auth.requireAuth, (req, res) => {
  const u = req.user;
  if (!['student', 'parent'].includes(u.role) || u.trial_until) return bad(res, '生徒と保護者の機能です', 403);
  const c = referral.getConfig(), code = referral.codeOf(u.id);
  res.json({ code, path: '/#trial=' + code, trial: c.trial, days: referral.trialDays(), week: referral.weekOn() ? c.week : null,
    pair: u.role === 'student' ? referral.pairOf(u.id) : null, rewards: { pairPoints: referral.PAIR_POINTS, parentPoints: referral.PARENT_POINTS } });
});

// ═════════ 保護者 ═════════
// 招待コードで保護者が自分で登録する（ログインしていなくても使える）
app.post('/api/parent/register', (req, res) => {
  const ipKey = 'ip:' + req.ip;
  if (auth.isLocked(ipKey)) return bad(res, `まちがいが続いたため、${auth.LOCK_MINUTES}分ほど待ってからためしてください`, 429);
  const b = req.body || {};
  if (!parents.inviteStudent(b.code)) { auth.recordFailure(ipKey, 10); return bad(res, '招待コードが正しくないか、もう使われています'); }
  const loginId = String(b.loginId || '').trim();
  const displayName = cleanName(b.displayName);
  if (!RE_LOGIN.test(loginId)) return bad(res, 'ログインIDは半角英数字と _ . - の3〜32文字にしてください');
  const e = validateName(displayName) || validatePassword(b.password);
  if (e) return bad(res, e);
  if (db.prepare('SELECT 1 FROM users WHERE login_id = ?').get(loginId)) return bad(res, 'このログインIDはすでに使われています', 409);
  const id = transaction(() => {
    const r = db.prepare("INSERT INTO users (login_id, display_name, role, password_hash, avatar_color, created_at, updated_at) VALUES (?, ?, 'parent', ?, ?, ?, ?)")
      .run(loginId, displayName, auth.hashPassword(b.password), '#f48fb1', now(), now());
    const id = Number(r.lastInsertRowid);
    applyPermissionsAndRooms(id, 'parent', {}, []);
    parents.useInvite(b.code, id);
    return id;
  });
  audit(id, 'parent.registered', loginId, null, req.ip);
  const s = auth.createSession(id, req);
  auth.setSessionCookie(res, s.token, s.expires);
  res.status(201).json({ user: publicUser(auth.loadUser(id)) });
});
const requireParent = (req, res, next) => (req.user.role === 'parent' ? next() : bad(res, '保護者の機能です', 403));
// きょうだいを追加
app.post('/api/parent/link', auth.requireAuth, requireParent, (req, res) => {
  const r = parents.useInvite(req.body.code, req.user.id);
  if (r.error) return bad(res, r.error);
  const me = realtime._online.get(req.user.id);
  if (me) me.childIds = parents.childIds(req.user.id);
  res.json({ ok: true, children: parents.childrenOf(req.user.id) });
});
// 保護者ページ：お子さんの様子（数字だけ）・見たよスタンプ
// 📅 勉強の足あとカレンダー（保護者が、自分の子どもの分だけ見られる）：今年度（4月から）の毎日の自習時間
app.get('/api/parent/footprints/:id', auth.requireAuth, requireParent, (req, res) => {
  const id = Number(req.params.id);
  if (!parents.childIds(req.user.id).has(id)) return bad(res, '自分のお子さんの記録だけ見られます', 403);
  const c = ganbari.getConfig(), today = ganbari.jst().day, from = c.yearStart;
  const days = {};
  for (const r of ganbari.daysBetween(id, from, today)) if (r.all > 0) days[r.day] = r.all;
  res.json({ from, to: today, days });
});
app.get('/api/parent/home', auth.requireAuth, requireParent, (req, res) => {
  const today = ganbari.jst().day, mon = ganbari.mondayOf(today), sent = parents.cheersSentToday(req.user.id);
  const term = ganbari.termOf(today);
  const kids = parents.childrenOf(req.user.id).map(k => {
    const p = realtime._online.get(k.id);
    let week = 0; for (let i = 0; i < 7; i++) { const d = ganbari.addDays(mon, i); if (d > today) break; week += ganbari.dayAll(k.id, d); }
    const goal = term ? ganbari.goalOf(k.id, term.key) : null;
    return {
      ...k, today: ganbari.dayAll(k.id, today), week, streak: ganbari.streak(k.id), hs: ganbari.isHS(k.grade),
      studying: !!(p && SchoolMap.isStudyRoom(p.room) && !p.away), online: !!p,
      goal: goal && goal.status === 'approved' ? { text: goal.text, achieved: !!goal.achieved } : null, cheered: sent.has(k.id),
    };
  });
  res.json({ children: kids, stamps: parents.STAMPS, streak: parents.visitStreak(req.user.id), endsAt: parents.visitEndsAt(req.user.id), points: ganbari.points(req.user.id).balance, moms: parents.momsTree(),
    gifts: birthday.giftsForParent(req.user.id), myBirthday: req.user.birthday || null });
});
// 保護者が自分の誕生日を登録（月-日だけ）。誕生日の日に、子どもの画面にカードが出る
app.post('/api/parent/birthday', auth.requireAuth, requireParent, (req, res) => {
  const bd = ganbari.normBirthday(req.body.birthday);
  if (bd === undefined) return bad(res, '誕生日が正しくありません');
  db.prepare('UPDATE users SET birthday = ?, updated_at = ? WHERE id = ?').run(bd, now(), req.user.id);
  res.json({ ok: true, birthday: bd });
});
app.post('/api/parent/cheer', auth.requireAuth, requireParent, (req, res) => {
  const r = parents.sendCheer(req.user.id, Number(req.body.studentId), String(req.body.stamp || ''));
  if (r.error) return bad(res, r.error);
  realtime.refreshMoms();
  res.json({ ok: true, moms: parents.momsTree() });
});
// 毎日5問
app.get('/api/parent/quiz', auth.requireAuth, requireParent, (req, res) => res.json(parents.todayQuiz(req.user.id)));
app.post('/api/parent/quiz/answer', auth.requireAuth, requireParent, (req, res) => {
  const r = parents.answerQuiz(req.user.id, String(req.body.qid || ''), String(req.body.choice || ''));
  if (r.error) return bad(res, r.error);
  res.json({ ...r, points: ganbari.points(req.user.id).balance });
});

// ⭐ マイ席：えらべる席と、いまの状態
app.get('/api/me/myseat', auth.requireAuth, (req, res) => {
  const st = myseat.statusOf(req.user.id);
  if (!st) return bad(res, '生徒の機能です', 403);
  const taken = new Set(myseat.list().filter(s => s.id !== req.user.id).map(s => s.seat));
  res.json({ ...st, seats: myseat.seatsOf(st.room).map(id => ({ id, taken: taken.has(id) })) });
});
app.post('/api/me/myseat', auth.requireAuth, (req, res) => {
  const r = myseat.choose(req.user.id, String((req.body || {}).seat || ''));
  if (r.error) return bad(res, r.error);
  realtime.broadcastMySeats();
  res.json(r);
});

// 📝 先生の黒板（ロビー）：先生・オーナーが書く。毎日でなくてよい
function readBoard() { try { return JSON.parse(getSetting('blackboard', 'null')); } catch (e) { return null; } }
app.get('/api/blackboard', auth.requireAuth, (req, res) => res.json({ board: readBoard() }));
// 🌅 今日の朝活 成功者（ロビーの掲示板）。体験中の子には名前を出さない
app.get('/api/morning-board', auth.requireAuth, (req, res) => {
  const mb = fun.morningBoard();
  if (mb && req.user.trial_until) { mb.names = mb.names.map(() => '生徒'); mb.bdays = []; }
  res.json({ board: mb });
});
app.put('/api/blackboard', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'owner' && req.user.role !== 'teacher') return bad(res, '先生とオーナーだけが書けます', 403);
  const text = String((req.body || {}).text || '').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, '').trim().slice(0, 60);
  const board = text ? { text, by: req.user.display_name, role: req.user.role, at: Date.now() } : null;
  setSetting('blackboard', JSON.stringify(board));
  audit(req.user.id, 'blackboard.updated', null, { text }, req.ip);
  realtime.blackboardChanged(board);
  res.json({ ok: true, board });
});

// ── 季節のお楽しみ ──
app.post('/api/me/event-letter', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'student') return bad(res, '生徒の機能です', 403);
  const ev = String((req.body || {}).event || 'santa');
  if (!fun.EVENTS[ev]) return bad(res, 'イベントが正しくありません');
  const r = fun.readLetter(req.user.id, ev);
  if (r.error) return bad(res, r.error);
  realtime.refreshGanbari(req.user.id);
  res.json({ ok: true, ...r });
});


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
  const ph = realtime.getStudyPhoto(req.params.id, Math.max(0, Math.min(2, Number(req.query.i) || 0)));
  if (!ph) return bad(res, '写真はありません', 404);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(ph.buf);
});
app.get('/api/study/photos', auth.requireAuth, (req, res) => {
  if (!realtime.canViewStudyPhotos(req.user)) return bad(res, 'この写真を見る権限がありません', 403);
  res.json({ times: realtime.studyPhotoTimes() });
});

// ═════ 入室前の「今日最初に取り組むページ」の写真 ═════
const isESUser = (u) => u.role === 'student' && ganbari.isES(u.grade);
app.get('/api/me/start-photo', auth.requireAuth, async (req, res) => {
  // 小学生は、写真といっしょに「今日の目標時間」を決める
  const goal = isESUser(req.user) ? { choices: startphoto.GOAL_CHOICES, last: startphoto.lastGoal(req.user.id) || 45 } : null;
  try { res.json({ required: await startphoto.requiredAsync(req.user), goal }); } catch (e) { res.json({ required: false, goal }); }
});
app.post('/api/me/start-photo', express.raw({ type: 'image/jpeg', limit: '450kb' }), auth.requireAuth, async (req, res) => {
  if (req.user.role !== 'student') return bad(res, '生徒の機能です', 403);
  try {
    if (isESUser(req.user) && req.get('X-Goal-Minutes')) { const ge = startphoto.setGoal(req.user.id, req.get('X-Goal-Minutes')); if (ge) return bad(res, ge, 400); }
    const err = await startphoto.save(req.user.id, req.body);
    if (err) return bad(res, err, 400);
    res.json({ ok: true });
  } catch (e) { console.error('写真の保存に失敗:', e.message); bad(res, '写真を保存できませんでした。もう一度ためしてください', 500); }
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
  res.json({ users: ids.map(({ id }) => { const u = auth.loadUser(id); const ref = referral.referrerOf(id), rn = ref && db.prepare('SELECT display_name AS n, role FROM users WHERE id = ?').get(ref); return { ...publicUser(u), activeSessions: sessionCounts.get(id) || 0, locked: !!auth.isLocked('id:' + u.login_id), referrer: rn ? { id: ref, name: rn.n, role: rn.role } : null }; }) });
});
// ユーザーの削除（もとに戻せない）。オーナーだけ。自分とオーナーは消せない
// その人の記録（自習時間・ポイント・アイテム・写真・保護者とのつながりなど）もいっしょに消す。先生がした確認の記録などは、先生の名前だけ外して残す
const USER_COLS = ['user_id', 'parent_id', 'student_id', 'to_id', 'from_id', 'new_id', 'referrer_id'];
const KEEP_COLS = ['reviewed_by', 'created_by', 'used_by']; // ほかの人の記録：消さずに空にする
function deleteUserData(id) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('users', 'sqlite_sequence', 'audit_logs')").all().map(r => r.name);
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all();
    for (const c of cols) {
      if (USER_COLS.includes(c.name)) db.prepare(`DELETE FROM ${t} WHERE ${c.name} = ?`).run(id);
      else if (KEEP_COLS.includes(c.name)) {
        if (c.notnull) db.prepare(`DELETE FROM ${t} WHERE ${c.name} = ?`).run(id);
        else db.prepare(`UPDATE ${t} SET ${c.name} = NULL WHERE ${c.name} = ?`).run(id);
      }
    }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
admin.delete('/users/:id', requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  const target = auth.loadUser(id);
  if (!target) return bad(res, 'ユーザーが見つかりません', 404);
  if (id === req.user.id) return bad(res, '自分のアカウントは削除できません', 403);
  if (target.role === 'owner') return bad(res, 'オーナーは削除できません', 403);
  if (String((req.body || {}).confirm || '') !== target.display_name) return bad(res, '確認のため、名前を正しく入れてください');
  realtime.forgetUser(id);
  try { transaction(() => deleteUserData(id)); } catch (e) { console.error('ユーザーの削除に失敗:', e.message); return bad(res, '削除できませんでした', 500); }
  try { await startphoto.deleteUser(id); } catch (e) { console.error('写真の削除に失敗:', e.message); }
  audit(req.user.id, 'user.deleted', target.login_id, { role: target.role, name: target.display_name }, req.ip);
  res.json({ ok: true });
});
// 🎓 生徒全員の学年を1つ上げる（4月）。前の学年をとっておき、元に戻せる
const promoteTargets = () => db.prepare("SELECT id, grade FROM users WHERE role = 'student' AND grade IS NOT NULL AND grade NOT IN ('卒業', '大人') AND trial_until IS NULL").all();
admin.get('/grades/promote', requireOwner, (req, res) => {
  let undo = null; try { undo = JSON.parse(getSetting('grade_promote_undo', 'null')); } catch (e) {}
  res.json({ count: promoteTargets().length, undo: undo ? { at: undo.at, count: Object.keys(undo.grades).length } : null });
});
admin.post('/grades/promote', requireOwner, (req, res) => {
  const list = promoteTargets(), grades = {};
  transaction(() => {
    for (const u of list) { grades[u.id] = u.grade; db.prepare('UPDATE users SET grade = ?, updated_at = ? WHERE id = ?').run(ganbari.NEXT_GRADE[u.grade] || '卒業', now(), u.id); }
    setSetting('grade_promote_undo', JSON.stringify({ at: new Date().toISOString(), grades }));
  });
  for (const u of list) realtime.refreshUser(u.id);
  audit(req.user.id, 'grades.promoted', null, { count: list.length }, req.ip);
  res.json({ ok: true, count: list.length });
});
admin.post('/grades/promote-undo', requireOwner, (req, res) => {
  let undo = null; try { undo = JSON.parse(getSetting('grade_promote_undo', 'null')); } catch (e) {}
  if (!undo) return bad(res, '元に戻せる記録がありません');
  let count = 0;
  transaction(() => {
    for (const [id, g] of Object.entries(undo.grades)) count += db.prepare("UPDATE users SET grade = ?, updated_at = ? WHERE id = ? AND role = 'student'").run(g, now(), Number(id)).changes;
    setSetting('grade_promote_undo', 'null');
  });
  for (const id of Object.keys(undo.grades)) realtime.refreshUser(Number(id));
  audit(req.user.id, 'grades.promote_undone', null, { count }, req.ip);
  res.json({ ok: true, count });
});
// 保護者の招待コード（生徒ごと）
admin.post('/users/:id/parent-invite', requireOwner, (req, res) => {
  const r = parents.createInvite(Number(req.params.id), req.user.id);
  if (r.error) return bad(res, r.error, 404);
  res.json(r);
});
admin.get('/users/:id/parents', requireOwner, (req, res) => res.json({ parents: parents.parentsOf(Number(req.params.id)) }));
admin.delete('/users/:id/parents/:parentId', requireOwner, (req, res) => {
  if (!parents.unlink(Number(req.params.parentId), Number(req.params.id))) return bad(res, 'つながりが見つかりません', 404);
  audit(req.user.id, 'parent.unlinked', String(req.params.id), { parent: Number(req.params.parentId) }, req.ip);
  res.json({ ok: true });
});
// 保護者の毎日の問題（英単語・数学・理科・社会。漢字は漢字テストの問題を使う）
// 友だち紹介：設定・体験中の人・紹介の一覧（オーナーだけ）
admin.get('/referral', requireOwner, (req, res) => res.json({ config: referral.getConfig(), weekOn: referral.weekOn(), trials: referral.trials(), referrals: referral.referralList() }));
admin.patch('/referral', requireOwner, (req, res) => {
  const e = referral.setConfig(req.body || {});
  if (e) return bad(res, e);
  audit(req.user.id, 'referral.config', null, req.body, req.ip);
  res.json({ ok: true, config: referral.getConfig(), weekOn: referral.weekOn() });
});
// 体験中の子を入塾させる（アバターはそのまま。ログインIDとパスワードを決める）
admin.post('/users/:id/enroll', requireOwner, (req, res) => {
  const b = req.body || {}, loginId = String(b.loginId || '').trim();
  if (!RE_LOGIN.test(loginId)) return bad(res, 'ログインIDは半角英数字と _ . - の3〜32文字にしてください');
  const e = validatePassword(b.password);
  if (e) return bad(res, e);
  if (db.prepare('SELECT 1 FROM users WHERE login_id = ? AND id != ?').get(loginId, Number(req.params.id))) return bad(res, 'このログインIDはすでに使われています', 409);
  const r = referral.enrollTrial(Number(req.params.id), loginId, auth.hashPassword(b.password), req.user.id);
  if (r.error) return bad(res, r.error);
  realtime.kick(Number(req.params.id), '入塾の手続きができました。新しいログインIDとパスワードでログインしてください');
  realtime.referralRewarded(r.rewards);
  res.json({ ok: true, user: publicUser(auth.loadUser(Number(req.params.id))), rewards: r.rewards });
});
// 紹介してくれた人を登録（体験なしで入塾した生徒）
admin.post('/users/:id/referrer', requireOwner, (req, res) => {
  const r = referral.setReferrer(Number(req.params.id), Number((req.body || {}).referrerId), req.user.id);
  if (r.error) return bad(res, r.error);
  realtime.referralRewarded(r.rewards);
  res.json({ ok: true, rewards: r.rewards });
});

// 今日来た保護者（オーナーだけ）・保護者会のオン/オフ
admin.get('/parents/today', requireOwner, (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || '')) ? String(req.query.day) : ganbari.jst().day;
  res.json({ day, meeting: parents.getMeeting(), meetingOn: parents.meetingOn(), visits: parents.visitsOn(day).map(v => ({ ...v, online: realtime._online.has(v.id) })) });
});
// 保護者会の予定 { day, start, end }／{ cancel:true }（取り消す・いますぐおわる）
admin.post('/parent-meeting', requireOwner, (req, res) => {
  const b = req.body || {};
  let r;
  if (b.cancel) { if (parents.meetingOn()) parents.endMeetingNow(req.user.id); else parents.setMeeting(null, req.user.id); r = { ok: true }; }
  else r = parents.setMeeting({ day: b.day, start: b.start, end: b.end }, req.user.id);
  if (r && r.error) return bad(res, r.error);
  realtime.parentMeetingChanged();
  res.json({ ok: true, meeting: parents.getMeeting(), meetingOn: parents.meetingOn() });
});
// 面談ブースに入れる人（その日だけ）
admin.get('/mendan', requireOwner, (req, res) => res.json({ allowed: parents.mendanList() }));
admin.post('/mendan/:id', requireOwner, (req, res) => {
  const on = !(req.body && req.body.allow === false);
  const r = parents.allowMendan(Number(req.params.id), on, req.user.id);
  if (r.error) return bad(res, r.error);
  realtime.mendanChanged(Number(req.params.id));
  res.json({ ok: true, allowed: parents.mendanList() });
});
admin.get('/parent-questions', requireOwner, (req, res) => res.json({ subjects: parents.SUBJECTS, questions: parents.listQuestions() }));
admin.post('/parent-questions/bulk', requireOwner, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 2000) : [];
  const r = parents.addQuestions(rows);
  audit(req.user.id, 'parent.questions_added', null, { added: r.added }, req.ip);
  res.json(r);
});
admin.delete('/parent-questions/:id', requireOwner, (req, res) => {
  if (!parents.deleteQuestion(Number(req.params.id))) return bad(res, '問題が見つかりません', 404);
  res.json({ ok: true });
});

// ログインのロック（まちがいが続いたとき）を外す
admin.post('/users/:id/unlock', requireOwner, (req, res) => {
  const u = auth.loadUser(Number(req.params.id));
  if (!u) return bad(res, 'ユーザーが見つかりません', 404);
  auth.unlock(u.login_id);
  audit(req.user.id, 'user.unlocked', u.login_id, null, req.ip);
  res.json({ ok: true });
});
admin.post('/unlock-all', requireOwner, (req, res) => {
  const n = auth.unlock();
  audit(req.user.id, 'user.unlocked_all', null, { count: n }, req.ip);
  res.json({ ok: true, count: n });
});

function applyPermissionsAndRooms(userId, role, permissions, rooms) {
  if (role === 'owner') return;
  const base = defaultPermissions(role);
  const p = {};
  for (const k of KEYS) {
    let v = permissions && typeof permissions[k] === 'boolean' ? permissions[k] : base[k];
    if (role === 'parent') v = false; // 保護者には権限を付けない（ロビーだけ）
    if (role === 'student' && STUDENT_FORBIDDEN.includes(k)) v = false; // 生徒には付与させない
    p[k] = v ? 1 : 0;
  }
  const cols = PERMISSIONS.map(d => d.column);
  db.prepare(`INSERT INTO permissions (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})
    ON CONFLICT(user_id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`)
    .run(userId, ...PERMISSIONS.map(d => p[d.key]));
  if (role === 'teacher' && Array.isArray(rooms)) {
    const valid = new Set(db.prepare('SELECT id FROM rooms').all().map(r => r.id).filter(id => SchoolMap.isLessonRoom(id)));
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
  const birthday = role === 'student' ? ganbari.normBirthday(b.birthday) : null;
  if (birthday === undefined) return bad(res, '誕生日が正しくありません');
  const visit = role === 'student' ? ganbari.normVisit(b.visitDays, b.visitTime) : { days: null, time: null };
  if (!visit) return bad(res, '来る曜日と時刻が正しくありません');
  const classDays = role === 'student' ? ganbari.normClassDays(b.classDays) : null;
  if (classDays === undefined) return bad(res, '授業の曜日が正しくありません');
  const id = transaction(() => {
    const r = db.prepare('INSERT INTO users (login_id, display_name, role, password_hash, avatar_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(loginId, displayName, role, auth.hashPassword(b.password), color, now(), now());
    const id = Number(r.lastInsertRowid);
    if (grade) db.prepare('UPDATE users SET grade = ? WHERE id = ?').run(grade, id);
    if (role === 'student') db.prepare('UPDATE users SET birthday = ?, birthday_public = ?, visit_days = ?, visit_time = ?, class_days = ? WHERE id = ?').run(birthday, b.birthdayPublic === false ? 0 : 1, visit.days, visit.time, classDays, id);
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
    if (b.hair !== undefined) { // 先生・オーナーの髪型
      if (target.role !== 'teacher' && target.role !== 'owner') return '髪型は先生・オーナーだけに設定できます';
      const styles = ganbari.SHOP.filter(i => i.slot === 'hair').map(i => i.style);
      if (b.hair !== null && !styles.includes(b.hair)) return '髪型が正しくありません';
      db.prepare('UPDATE users SET staff_hair = ? WHERE id = ?').run(b.hair, id); changes.push('hair');
    }
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
    if (b.birthday !== undefined || b.birthdayPublic !== undefined) {
      if (target.role !== 'student' && !(target.role === 'parent' && b.birthdayPublic === undefined)) return '誕生日は生徒と保護者だけに設定できます';
      if (b.birthday !== undefined) {
        const bd = ganbari.normBirthday(b.birthday);
        if (bd === undefined) return '誕生日が正しくありません';
        db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run(bd, id); changes.push('birthday');
      }
      if (b.birthdayPublic !== undefined) { db.prepare('UPDATE users SET birthday_public = ? WHERE id = ?').run(b.birthdayPublic ? 1 : 0, id); changes.push('birthdayPublic'); }
    }
    if (b.visitDays !== undefined) {
      if (target.role !== 'student') return '来る曜日は生徒だけに設定できます';
      const v = ganbari.normVisit(b.visitDays, b.visitTime);
      if (!v) return '来る曜日と時刻が正しくありません（曜日をえらんだら時刻も入れてください）';
      db.prepare('UPDATE users SET visit_days = ?, visit_time = ? WHERE id = ?').run(v.days, v.time, id); changes.push('visit');
    }
    if (b.classDays !== undefined) {
      if (target.role !== 'student') return '授業の曜日は生徒だけに設定できます';
      const cd = ganbari.normClassDays(b.classDays);
      if (cd === undefined) return '授業の曜日が正しくありません';
      db.prepare('UPDATE users SET class_days = ? WHERE id = ?').run(cd, id); changes.push('classDays');
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
  res.json({ config: c, terms: ganbari.allTerms(c), current: ganbari.termOf(ganbari.jst().day, c), grades: ganbari.GRADES, stageNames: ganbari.STAGE_NAMES, events: ganbari.EVENTS, shop: ganbari.SHOP });
});
admin.patch('/ganbari/config', requireOwner, (req, res) => {
  const err = ganbari.setConfig(req.body, req.user.id);
  if (err) return bad(res, err);
  realtime.refreshAllGanbari();
  res.json({ config: ganbari.getConfig() });
});
admin.get('/reading', requireOwner, (req, res) => res.json({ units: reading.listUnits(), config: reading.getConfig(), summary: reading.practiceSummary(), tests: reading.testSummary(), writing: writing.summary(), visionReady: writing.visionReady(), grades: ganbari.GRADES, speechReady: !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) }));
admin.post('/reading/units', requireOwner, (req, res) => { const r = reading.addUnit(req.body || {}, req.user.id); if (r.error) return bad(res, r.error); res.status(201).json(r); });
admin.patch('/reading/units/:id', requireOwner, (req, res) => { const r = reading.updateUnit(Number(req.params.id), req.body || {}, req.user.id); if (r.error) return bad(res, r.error); res.json(r); });
admin.delete('/reading/units/:id', requireOwner, (req, res) => { if (!reading.deleteUnit(Number(req.params.id), req.user.id)) return bad(res, '単元が見つかりません', 404); res.json({ ok: true }); });
admin.patch('/reading/config', requireOwner, (req, res) => { const e = reading.setConfig(req.body || {}, req.user.id); if (e) return bad(res, e); res.json({ ok: true, config: reading.getConfig() }); });
admin.get('/parents/cheers', requireOwner, (req, res) => res.json({ cheers: parents.cheersList(Math.min(365, Math.max(1, Number(req.query.days) || 60))), moms: parents.momsTree() }));
admin.get('/ganbari/students', requireOwner, (req, res) => res.json({ students: ganbari.studentSummary() }));
admin.get('/ganbari/students/:id/days', requireOwner, (req, res) => {
  const from = String(req.query.from || ''), to = String(req.query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return bad(res, '期間が正しくありません');
  res.json({ days: ganbari.daysBetween(Number(req.params.id), from, to) });
});
admin.put('/ganbari/students/:id/days/:day', requireOwner, (req, res) => {
  const target = auth.loadUser(Number(req.params.id));
  if (!target || target.role !== 'student') return bad(res, '生徒が見つかりません', 404);
  // adjust：足す分（＋/－）。minutes：上書き（null でやめる。前からある直し方）
  const err = req.body.adjust !== undefined
    ? ganbari.setAdjust(target.id, req.params.day, Number(req.body.adjust), req.user.id)
    : ganbari.setManual(target.id, req.params.day, req.body.minutes === null ? null : Number(req.body.minutes), req.user.id);
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
// 生徒1人の勉強時間のくわしい内容（オーナーと、生徒への個別対応の権限がある先生）
admin.get('/ganbari/students/:id/detail', requireGoalReviewer, (req, res) => {
  const d = ganbari.studyDetail(Number(req.params.id));
  if (!d) return bad(res, '生徒が見つかりません', 404);
  res.json(d);
});
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
  const ids = req.body.all ? db.prepare("SELECT id FROM users WHERE role = 'student' AND is_active = 1 AND trial_until IS NULL ORDER BY grade, display_name").all().map(r => r.id)
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
  res.json({ studyPhotos: realtime.studyPhotosEnabled(), startPhoto: startphoto.enabledNow(), ownerPatrol: realtime.patrolOn() });
});
// 入室前の写真の一覧（オーナーだけ）。?day=YYYY-MM-DD（なければ今日）
admin.get('/start-photos', requireOwner, async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || '')) ? String(req.query.day) : ganbari.jst().day;
  try { res.json({ day, keepDays: startphoto.KEEP_DAYS, photos: await startphoto.listDay(day) }); } catch (e) { bad(res, '写真の一覧を読めませんでした', 500); }
});
admin.get('/start-photos/:userId/:day', requireOwner, async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.day)) return bad(res, '日付が正しくありません');
  try {
    const img = await startphoto.getImage(Number(req.params.userId), req.params.day);
    if (!img) return bad(res, '写真はありません', 404);
    res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(img);
  } catch (e) { bad(res, '写真を読めませんでした', 500); }
});
admin.patch('/settings', requireOwner, (req, res) => {
  if (typeof req.body.studyPhotos === 'boolean') {
    setSetting('study_photos', req.body.studyPhotos ? '1' : '0');
    realtime.setStudyPhotosFeature(req.body.studyPhotos);
    audit(req.user.id, 'settings.study_photos', req.body.studyPhotos ? 'on' : 'off', null, req.ip);
  }
  if (typeof req.body.ownerPatrol === 'boolean') {
    setSetting('owner_patrol', req.body.ownerPatrol ? '1' : '0');
    audit(req.user.id, 'settings.owner_patrol', req.body.ownerPatrol ? 'on' : 'off', null, req.ip);
  }
  if (typeof req.body.startPhoto === 'boolean') {
    setSetting('start_photo', req.body.startPhoto ? '1' : '0');
    audit(req.user.id, 'settings.start_photo', req.body.startPhoto ? 'on' : 'off', null, req.ip);
  }
  res.json({ studyPhotos: realtime.studyPhotosEnabled(), startPhoto: startphoto.enabledNow(), ownerPatrol: realtime.patrolOn() });
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
// Microsoft の音声のブラウザ用ライブラリ（本番の音読テストの採点に使う）
const SPEECH_DIST = path.join(path.dirname(require.resolve('microsoft-cognitiveservices-speech-sdk/package.json')), 'distrib', 'browser');
app.get('/vendor/speech-sdk.js', (req, res) => res.sendFile(path.join(SPEECH_DIST, 'microsoft.cognitiveservices.speech.sdk.bundle-min.js'), { maxAge: '1d' }));
app.get('/vendor/speech-processor.js', (req, res) => res.sendFile(path.join(SPEECH_DIST, 'speech-processor.js'), { maxAge: '1d' }));
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
