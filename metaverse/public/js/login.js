(function () {
  const { api } = window.App;
  const $ = (s) => document.querySelector(s);

  (async () => {
    try { await api('GET', '/api/me'); location.replace('/app'); return; } catch (e) { /* 未ログイン */ }
    const { needsSetup } = await api('GET', '/api/setup-status').catch(() => ({ needsSetup: false }));
    if (!needsSetup && location.hash === '#parent') { $('#parent-form').hidden = false; $('#parent-code').focus(); return; }
    $(needsSetup ? '#setup-form' : '#login-form').hidden = false;
    (needsSetup ? $('#setup-name') : $('#login-id')).focus();
  })();

  document.querySelector('.pw-toggle').addEventListener('click', () => {
    const i = $('#login-pw');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('button[type=submit]');
    btn.disabled = true; $('#login-error').textContent = '';
    try {
      await api('POST', '/api/login', { loginId: $('#login-id').value, password: $('#login-pw').value });
      location.replace('/app');
    } catch (err) {
      $('#login-error').textContent = err.message;
      btn.disabled = false;
    }
  });

  // 保護者の登録（招待コード）
  $('#to-parent').addEventListener('click', (e) => { e.preventDefault(); $('#login-form').hidden = true; $('#parent-form').hidden = false; $('#parent-code').focus(); });
  $('#to-login').addEventListener('click', (e) => { e.preventDefault(); $('#parent-form').hidden = true; $('#login-form').hidden = false; });
  $('#parent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; $('#parent-error').textContent = '';
    try {
      await api('POST', '/api/parent/register', { code: $('#parent-code').value, displayName: $('#parent-name').value, loginId: $('#parent-id').value, password: $('#parent-pw').value });
      location.replace('/app');
    } catch (err) {
      $('#parent-error').textContent = err.message;
      btn.disabled = false;
    }
  });

  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; $('#setup-error').textContent = '';
    try {
      await api('POST', '/api/setup', { displayName: $('#setup-name').value, loginId: $('#setup-id').value, password: $('#setup-pw').value });
      location.replace('/admin');
    } catch (err) {
      $('#setup-error').textContent = err.message;
      btn.disabled = false;
    }
  });
})();
