// マイクの準備と、使えなかったときの案内（とくに iPhone・iPad の「ホーム画面に追加」したアプリ）
// - ホーム画面のアプリ（PWA）は Safari とは別あつかい：Safari で許可していても、アプリを開くたびに許可を聞かれる
// - ボタンを押したその場で getUserMedia を呼んで許可をもらう（押した直後でないと iPad はダイアログを出さない）
// - 失敗したら、エラー名と詳しい内容を出し、OS の制限なら Safari で開く案内を出す
(function () {
  const ua = navigator.userAgent || '';
  // iPadOS 13 以降の iPad は Mac のふりをするので、タッチの数でも見分ける
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isStandalone = () => {
    try { if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) return true; } catch (e) { /* 古い端末 */ }
    return navigator.standalone === true;
  };
  const iosVersion = () => { const m = ua.match(/OS (\d+)[_.](\d+)/) || ua.match(/Version\/(\d+)\.(\d+)/); return m ? m[1] + '.' + m[2] : ''; };
  const hasGUM = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const iosPwa = () => isIOS && isStandalone();

  let warm = false; // このアプリを開いてから、マイクの許可がとれたか

  // ボタンのクリックの中で（await の前に）呼ぶこと。成功：{ ok:true }、失敗：{ ok:false, name, message }
  async function ensure() {
    if (!window.isSecureContext && location.hostname !== 'localhost') return { ok: false, name: 'InsecureContext', message: 'https ではない接続です' };
    if (!hasGUM()) return { ok: false, name: 'NoMediaDevices', message: 'この端末・ブラウザでは getUserMedia が使えません' + (isIOS ? `（iOS ${iosVersion() || '?'}）` : '') };
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      s.getTracks().forEach(t => t.stop()); // 許可をもらうだけ。すぐ止める（このあと聞き取り・通話が自分で開く）
      warm = true;
      return { ok: true };
    } catch (e) {
      return { ok: false, name: (e && e.name) || 'Error', message: (e && e.message) || String(e || '') };
    }
  }

  const HINT = {
    NotAllowedError: () => iosPwa()
      ? 'マイクが許可されていません。ホーム画面のアプリは、開くたびに許可を聞かれます。「許可しない」を押した場合は、アプリを上にスワイプして完全に閉じ、もう一度開いてから、マイクのボタンを押して「許可」を選んでください。iPad の「設定」→「スクリーンタイム」→「コンテンツとプライバシーの制限」→「マイク」が「許可しない」になっていないかも確かめてください。'
      : 'マイクが許可されていません。Safari の場合は「設定」アプリ →「Safari」→「マイク」を「確認」か「許可」に。アドレス欄の「ぁあ」→「Webサイトの設定」→「マイク」でも変えられます。',
    PermissionDeniedError: () => HINT.NotAllowedError(),
    NotFoundError: () => 'マイクが見つかりません。イヤホンやマイクのつなぎ方を確かめてください。',
    NotReadableError: () => 'ほかのアプリ（FaceTime・通話・録音・別のタブなど）がマイクを使っています。そのアプリを閉じてから、もう一度ためしてください。',
    AbortError: () => HINT.NotReadableError(),
    OverconstrainedError: () => 'この端末のマイクの設定が合いませんでした。もう一度ためしてください。',
    SecurityError: () => '安全のため、マイクが止められています（画面の制限・プライバシーの設定）。',
    InsecureContext: () => '安全な接続（https）で開いてください。',
    NoMediaDevices: () => 'この端末のバージョンでは、ホーム画面のアプリからマイクが使えません。Safari で開いてください。',
    'service-not-allowed': () => 'ホーム画面のアプリでは、iPad・iPhone の仕組み（OS の制限）で、この聞き取りが使えません。Safari で開くと使えます。',
    'not-allowed': () => HINT.NotAllowedError(),
    'audio-capture': () => HINT.NotFoundError(),
  };

  // Safari で開くリンク（ホーム画面のアプリの中からは Safari を直接開けないので、コピーして貼ってもらう）
  const safariUrl = () => location.origin + '/app';
  const showSafari = (name) => iosPwa() && (name === 'NoMediaDevices' || name === 'service-not-allowed' || name === 'NotAllowedError' || name === 'not-allowed' || name === 'SecurityError' || name === 'Error');

  function explain(err, what = 'マイク') {
    const name = (err && err.name) || 'Error', message = (err && err.message) || '';
    const hint = (HINT[name] || (() => `${what}を使えませんでした。もう一度ためしてください。`))();
    const d = document.createElement('dialog');
    const body = document.createElement('div'); body.className = 'dialog-body';
    const h = document.createElement('h2'); h.textContent = `🎤 ${what}が使えませんでした`;
    const p = document.createElement('p'); p.style.margin = '0'; p.textContent = hint;
    body.append(h, p);
    if (showSafari(name)) {
      const box = document.createElement('div'); box.className = 'muted';
      box.textContent = 'Safari で開く方法：① 下の「リンクをコピー」② Safari を開く ③ アドレス欄に貼りつけて開く（Safari では、いつもの ID とパスワードでもう一度ログインしてください）';
      const url = document.createElement('code'); url.textContent = safariUrl(); url.style.cssText = 'display:block;word-break:break-all;background:#f7f2ea;padding:8px 10px;border-radius:10px;margin-top:6px';
      box.append(url); body.append(box);
    }
    const det = document.createElement('small'); det.className = 'muted';
    det.textContent = `くわしい内容：${name}${message ? ' / ' + message : ''}（${iosPwa() ? 'ホーム画面のアプリ' : 'ブラウザ'}${isIOS ? '・iOS ' + (iosVersion() || '?') : ''}）`;
    det.style.wordBreak = 'break-all';
    body.append(det);
    const acts = document.createElement('div'); acts.className = 'dialog-actions';
    if (showSafari(name)) {
      const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'btn secondary'; cp.textContent = '🔗 リンクをコピー';
      cp.onclick = async () => {
        try { await navigator.clipboard.writeText(safariUrl()); cp.textContent = '✅ コピーしました'; }
        catch (e) { const r = document.createRange(); r.selectNodeContents(body.querySelector('code')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cp.textContent = '選んだ文字をコピーしてください'; }
      };
      acts.append(cp);
    }
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn'; ok.textContent = 'OK';
    ok.onclick = () => d.close();
    acts.append(ok); body.append(acts); d.append(body);
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    try { d.showModal(); } catch (e) { d.setAttribute('open', ''); }
  }

  function toast(text, ms = 4000) {
    let area = document.querySelector('.toast-area');
    if (!area) { area = document.createElement('div'); area.className = 'toast-area'; document.body.appendChild(area); }
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
    area.appendChild(el); setTimeout(() => el.remove(), ms);
  }

  // ホーム画面のアプリで、まだ許可がとれていないとき：先に許可だけもらい、もう一度押してもらう
  // true を返したら、呼び出し側はここで止める（準備中 or 失敗の案内を出した）
  async function warmUpIfNeeded() {
    if (!iosPwa() || warm) return false;
    const r = await ensure();
    if (r.ok) toast('🎤 マイクの準備ができました。もう一度ボタンを押してね');
    else explain(r);
    return true;
  }

  window.Mic = { ensure, explain, warmUpIfNeeded, isIOS, isStandalone, iosPwa, iosVersion, hasGUM, get warm() { return warm; } };
})();
