const { chromium, devices } = require('playwright');
// 第5段階：スマホ画面の点検（7機種を再現して、ボタンの重なり・はみ出し・押しにくい小さなボタンを調べる）
// 使い方：
//   1) 新しい空のデータベースでサーバーを起動（LiveKit は未接続でよい）
//      DB_PATH=/tmp/check.db PORT=3204 LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=x LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npm start
//   2) node tools/mobilecheck.js   （Playwright が必要： npm i -D playwright && npx playwright install chromium）
// スクリーンショットは tools/mobilecheck-out/ に保存されます
const path = require('path');
const OUT = path.join(__dirname, 'mobilecheck-out') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = process.env.CHECK_URL || 'http://localhost:3204';
const api = async (method, path, body, cookie) => {
  const r = await fetch(URL + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = r.headers.get('set-cookie'); return { cookie: sc ? sc.split(';')[0] : cookie, data: await r.json().catch(() => null) };
};
const DEVICES = ['iPhone SE', 'iPhone 13', 'iPhone 15 Pro Max', 'Pixel 7', 'Galaxy S9+', 'iPhone 13 landscape', 'iPad Mini'];
(async () => {
  const owner = (await api('POST', '/api/setup', { displayName: '三浦', loginId: 'miura', password: 'ownerpass1' })).cookie;
  await api('POST', '/api/admin/users', { role: 'teacher', displayName: '佐藤', loginId: 'sato', password: 'satopass1', rooms: ['class1'] }, owner);
  for (let i = 0; i < DEVICES.length; i++) await api('POST', '/api/admin/users', { role: 'student', displayName: 'みなみ' + i, loginId: 'stu' + i, password: 'password123' }, owner);
  const browser = await chromium.launch();
  // 先生が授業を開始
  const tc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const t = await tc.newPage();
  await t.goto(URL); await t.waitForSelector('#login-form:not([hidden])');
  await t.fill('#login-id', 'sato'); await t.fill('#login-pw', 'satopass1'); await t.click('#login-form button[type=submit]');
  await t.waitForFunction(() => window.__world && window.__world.state.ready);
  await t.evaluate(() => window.__world.walkTo(8, 1, false)); await t.waitForTimeout(12000);
  await t.click('#class-bar button:has-text("授業を始める")'); await t.waitForTimeout(500);

  const report = [];
  for (let i = 0; i < DEVICES.length; i++) {
    const name = DEVICES[i];
    const ctx = await browser.newContext({ ...devices[name] });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.push(`${name}: PAGEERR ${e.message}`));
    await p.goto(URL); await p.waitForSelector('#login-form:not([hidden])');
    // ログイン画面の確認
    const loginIssues = await p.evaluate(() => {
      const r = document.querySelector('.login-card').getBoundingClientRect();
      return r.right > innerWidth + 1 ? ['ログインカードが画面からはみ出し'] : [];
    });
    await p.fill('#login-id', 'stu' + i); await p.fill('#login-pw', 'password123'); await p.tap('#login-form button[type=submit]');
    await p.waitForFunction(() => window.__world && window.__world.state.ready);
    await p.evaluate(() => { const s = window.__world.state; window.__world.goToRoom(s.rooms[0]); });
    await p.waitForTimeout(13000);
    await p.tap('#btn-hand'); await p.waitForTimeout(3200);
    const issues = await p.evaluate(() => {
      const out = [];
      const vis = (e) => e && !e.hidden && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
      const els = [
        ['現在地', '.place'], ['名前ボタン', '.me-btn'], ['テスト版表示', '.stage-note'], ['ズーム', '.zoom'], ['スティック', '#joystick'],
        ...[...document.querySelectorAll('#class-bar > *')].map((e, i) => ['授業バー' + i, e]),
        ...[...document.querySelectorAll('.hud-bottom .big-btn')].filter(vis).map((e) => ['下ボタン:' + e.textContent.trim(), e]),
      ].map(([n, s]) => [n, typeof s === 'string' ? document.querySelector(s) : s]).filter(([, e]) => vis(e));
      const boxes = els.map(([n, e]) => [n, e.getBoundingClientRect()]);
      for (const [n, b] of boxes) {
        if (b.left < -1 || b.right > innerWidth + 1 || b.top < -1 || b.bottom > innerHeight + 1) out.push(`${n} が画面からはみ出し`);
      }
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        const [na, ra] = boxes[a], [nb, rb] = boxes[b];
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 2 && oy > 2) out.push(`${na} と ${nb} が重なっている`);
      }
      for (const e of document.querySelectorAll('.hud-bottom .big-btn, #class-bar button, .zoom button, .me-btn')) {
        if (!vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.height < 44 || r.width < 44) out.push(`押しにくい小さいボタン: ${e.textContent.trim() || e.id} (${Math.round(r.width)}x${Math.round(r.height)})`);
      }
      return out;
    });
    report.push(`■ ${name} (${p.viewportSize().width}x${p.viewportSize().height}): ` + ([...loginIssues, ...issues].join(' / ') || '問題なし'));
    await p.screenshot({ path: OUT + `m${i}-${name.replace(/\s+/g, '_')}.png` });
    await ctx.close();
  }
  console.log(report.join('\n'));
  await browser.close();
})();
