// サーバー API 呼び出しと共通ユーティリティ
(function () {
  async function api(method, url, body) {
    const opt = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body || {});
    }
    const res = await fetch(url, opt);
    let data = {};
    try { data = await res.json(); } catch (e) { /* 本文なし */ }
    if (!res.ok) {
      const err = new Error(data.error || 'エラーが起きました。もう一度ためしてください');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(text, ms = 2800) {
    let area = document.querySelector('.toast-area');
    if (!area) { area = document.createElement('div'); area.className = 'toast-area'; document.body.appendChild(area); }
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = text;
    area.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  const ROLE_LABEL = { owner: 'オーナー', teacher: '先生', student: '生徒', parent: '保護者' };

  // PWA（ホーム画面に追加して使えるようにする）
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  // ホーム画面のアプリは、閉じずに裏にまわしただけだと古い版のまま動きつづける。
  // しばらく（5分以上）裏にいたあと戻ってきたとき、新しい版が出ていたら読みなおす
  if (location.protocol !== 'file:') {
    let loadedVer = null, hiddenAt = 0;
    const getVer = () => fetch('/api/version', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => v && v.version).catch(() => null);
    getVer().then(v => { loadedVer = v; });
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt < 5 * 60e3) return;
      hiddenAt = 0;
      try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) reg.update(); } catch (e) { /* なくてもよい */ }
      const v = await getVer();
      if (loadedVer && v && v !== loadedVer && !document.querySelector('dialog[open]')) location.reload();
    });
  }

  window.App = { api, toast, ROLE_LABEL };
})();
