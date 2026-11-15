(function () {
  const { api, toast, ROLE_LABEL } = window.App;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let me, meta, users = [], editing = null, roleFilter = '';

  (async function init() {
    try { me = (await api('GET', '/api/me')).user; } catch (e) { location.replace('/'); return; }
    try { meta = await api('GET', '/api/admin/meta'); } catch (e) { return denied(); }
    if (!meta.canManageUsers && !meta.canManageRooms) return denied();
    $('#who').textContent = `${me.displayName}（${ROLE_LABEL[me.role]}）`;
    $('#tab-users-btn').hidden = !meta.canManageUsers;
    $('#tab-logs-btn').hidden = !meta.canManageUsers;
    $('#tab-rooms-btn').hidden = !meta.canManageRooms;
    document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    showTab(meta.canManageUsers ? 'users' : 'rooms');
  })();

  function denied() {
    document.querySelector('main').innerHTML = '';
    document.querySelector('main').append(el('p', 'notice', 'この画面を使う権限がありません。'));
    $('#tabs').hidden = true;
  }

  function showTab(tab) {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + tab; });
    if (tab === 'users') loadUsers();
    if (tab === 'rooms') loadRooms();
    if (tab === 'logs') loadLogs();
  }

  // ═════════ ユーザー ═════════
  async function loadUsers() {
    try { users = (await api('GET', '/api/admin/users')).users; renderUsers(); }
    catch (e) { toast(e.message); }
  }

  function renderUsers() {
    const q = $('#search').value.trim().toLowerCase();
    const list = $('#user-list');
    list.textContent = '';
    const shown = users.filter(u => (!roleFilter || u.role === roleFilter) &&
      (!q || u.displayName.toLowerCase().includes(q) || u.loginId.toLowerCase().includes(q)));
    if (!shown.length) { list.append(el('p', 'empty', 'ユーザーがいません')); return; }
    const roomName = (id) => (meta.rooms.find(r => r.id === id) || {}).name || id;
    for (const u of shown) {
      const row = el('div', 'user-row' + (u.isActive ? '' : ' inactive'));
      const av = el('div', 'avatar'); av.style.background = u.avatarColor;
      const info = el('div');
      const name = el('div', 'name', u.displayName);
      name.append(el('span', 'badge ' + u.role, ROLE_LABEL[u.role]));
      if (!u.isActive) name.append(el('span', 'badge off', '無効'));
      const sub = [`ID: ${u.loginId}`, `ログイン中の端末: ${u.activeSessions}`];
      if (u.role === 'teacher') sub.push('担当: ' + (u.rooms.length ? u.rooms.map(roomName).join('・') : 'なし'));
      info.append(name, el('div', 'sub', sub.join('　')));
      const actions = el('div', 'actions');
      const isSelf = u.id === me.id;
      const btn = (label, cls, fn) => { const b = el('button', 'btn small ' + cls, label); b.onclick = fn; actions.append(b); };
      btn('編集', 'secondary', () => openEditor(u));
      if (u.role !== 'owner') {
        btn(u.isActive ? '無効にする' : '有効にする', u.isActive ? 'danger' : '', () => toggleActive(u));
      }
      if (!isSelf && u.activeSessions > 0) btn('強制ログアウト', 'secondary', () => revoke(u));
      row.append(av, info, actions);
      list.append(row);
    }
  }
  $('#search').addEventListener('input', renderUsers);
  document.querySelectorAll('#role-filter .chip').forEach(c => c.onclick = () => {
    roleFilter = c.dataset.role;
    document.querySelectorAll('#role-filter .chip').forEach(x => x.classList.toggle('active', x === c));
    renderUsers();
  });

  async function toggleActive(u) {
    const msg = u.isActive
      ? `${u.displayName} さんのアカウントを無効にしますか？\nログイン中の端末もすぐにログアウトされます。`
      : `${u.displayName} さんのアカウントを有効に戻しますか？`;
    if (!confirm(msg)) return;
    try { await api('PATCH', `/api/admin/users/${u.id}`, { isActive: !u.isActive }); toast('更新しました'); loadUsers(); }
    catch (e) { toast(e.message); }
  }
  async function revoke(u) {
    if (!confirm(`${u.displayName} さんのすべての端末をログアウトさせますか？`)) return;
    try { const r = await api('POST', `/api/admin/users/${u.id}/revoke-sessions`); toast(`${r.revoked}台の端末をログアウトさせました`); loadUsers(); }
    catch (e) { toast(e.message); }
  }

  // ── 追加・編集ダイアログ ──
  $('#add-user').onclick = () => openEditor(null);
  $('#user-cancel').onclick = () => $('#user-dialog').close();
  document.querySelectorAll('#role-pick input').forEach(r => r.addEventListener('change', () => renderPermFields(currentRole(), null)));
  const currentRole = () => editing ? editing.role : document.querySelector('#role-pick input:checked').value;

  function openEditor(u) {
    editing = u;
    $('#user-form').reset();
    $('#user-error').textContent = '';
    $('#user-dialog-title').textContent = u ? `${u.displayName} さんを編集` : 'ユーザーを追加';
    $('#role-pick').hidden = !!u;
    $('#f-name').value = u ? u.displayName : '';
    $('#f-login').value = u ? u.loginId : '';
    $('#f-login').readOnly = !!u;
    $('#f-pw').value = u ? '' : makePassword();
    $('#f-pw-label').textContent = u ? '新しいパスワード（変更するときだけ入力）' : 'パスワード';
    $('#f-color').value = u ? u.avatarColor : randomColor();
    renderPermFields(currentRole(), u);
    $('#user-dialog').showModal();
  }

  function renderPermFields(role, u) {
    const isOwner = role === 'owner';
    $('#rooms-field').hidden = role !== 'teacher';
    const rbox = $('#f-rooms'); rbox.textContent = '';
    for (const r of meta.rooms.filter(r => r.type === 'classroom')) {
      const lab = el('label');
      const cb = el('input'); cb.type = 'checkbox'; cb.value = r.id; cb.name = 'room';
      cb.checked = u ? u.rooms.includes(r.id) : false;
      lab.append(cb, document.createTextNode(r.name));
      rbox.append(lab);
    }
    const pbox = $('#f-perms'); pbox.textContent = '';
    const defaults = { teacher: ['enter_classroom', 'start_class_call', 'start_private_call', 'share_screen', 'handle_students'], student: ['enter_classroom'] };
    for (const p of meta.permissions) {
      const forbidden = role === 'student' && meta.studentForbidden.includes(p.key);
      const lab = el('label', forbidden || isOwner ? 'disabled' : '');
      const cb = el('input'); cb.type = 'checkbox'; cb.value = p.key; cb.name = 'perm';
      cb.checked = isOwner ? true : u ? !!u.permissions[p.key] : (defaults[role] || []).includes(p.key);
      cb.disabled = forbidden || isOwner;
      if (forbidden) cb.checked = false;
      lab.append(cb, document.createTextNode(p.label));
      pbox.append(lab);
    }
    $('#perm-note').textContent = isOwner ? 'オーナーはすべての権限を持っています（変更できません）'
      : role === 'student' ? '生徒には通話の開始・画面共有・管理の権限は付けられません（サーバー側でも禁止しています）'
      : '先生は「担当する教室」にチェックした教室にだけ入れます';
  }

  $('#gen-pw').onclick = () => { $('#f-pw').value = makePassword(); };

  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#user-error').textContent = '';
    const role = currentRole();
    const permissions = {};
    document.querySelectorAll('#f-perms input').forEach(cb => { permissions[cb.value] = cb.checked; });
    const rooms = [...document.querySelectorAll('#f-rooms input:checked')].map(cb => cb.value);
    const body = { displayName: $('#f-name').value, avatarColor: $('#f-color').value };
    const pw = $('#f-pw').value;
    if (role !== 'owner') { body.permissions = permissions; if (role === 'teacher') body.rooms = rooms; }
    $('#user-save').disabled = true;
    try {
      let saved;
      if (editing) {
        if (pw) body.password = pw;
        saved = (await api('PATCH', `/api/admin/users/${editing.id}`, body)).user;
      } else {
        Object.assign(body, { role, loginId: $('#f-login').value, password: pw });
        saved = (await api('POST', '/api/admin/users', body)).user;
      }
      $('#user-dialog').close();
      if (pw) showCredentials(saved, pw); else toast('保存しました');
      loadUsers();
    } catch (err) {
      $('#user-error').textContent = err.message;
    } finally {
      $('#user-save').disabled = false;
    }
  });

  function showCredentials(u, pw) {
    $('#cred-text').textContent = `三浦塾 オンライン教室\nURL：${location.origin}/\n名前：${u.displayName}\nログインID：${u.loginId}\nパスワード：${pw}`;
    $('#cred-dialog').showModal();
  }
  $('#cred-close').onclick = () => { $('#cred-text').textContent = ''; $('#cred-dialog').close(); };
  $('#cred-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#cred-text').textContent); toast('コピーしました'); }
    catch (e) { toast('コピーできませんでした。手で書き写してください'); }
  };

  // 読みまちがえにくい文字だけでパスワードを作る（例：kumo-4827）
  function makePassword() {
    const cons = 'bdfghkmnprstz', vow = 'aeiou', rnd = new Uint32Array(8);
    crypto.getRandomValues(rnd);
    let s = '';
    for (let i = 0; i < 4; i++) s += i % 2 ? vow[rnd[i] % vow.length] : cons[rnd[i] % cons.length];
    return s + '-' + String(1000 + (rnd[4] % 9000));
  }
  function randomColor() {
    const c = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#7986cb', '#a1887f', '#4fc3f7'];
    return c[Math.floor(Math.random() * c.length)];
  }

  // ═════════ 教室の設定 ═════════
  async function loadRooms() {
    let rooms;
    try { rooms = (await api('GET', '/api/admin/rooms')).rooms; } catch (e) { return toast(e.message); }
    const box = $('#room-list'); box.textContent = '';
    for (const r of rooms) {
      const card = el('div', 'room-box');
      card.append(el('h3', null, (r.type === 'study' ? '📚 ' : '🏫 ') + r.name));
      card.append(el('div', 'muted', `座席数 ${r.maxCapacity}席`));
      const row = el('div', 'cap-row');
      const input = el('input'); input.type = 'number'; input.min = 1; input.max = r.maxCapacity; input.value = r.capacity; input.inputMode = 'numeric';
      const save = el('button', 'btn small', '保存');
      save.onclick = async () => {
        try { await api('PATCH', `/api/admin/rooms/${r.id}`, { capacity: Number(input.value) }); toast(`${r.name}の定員を${input.value}人にしました`); }
        catch (e) { toast(e.message); input.value = r.capacity; }
      };
      row.append(el('span', null, '定員'), input, el('span', null, '人'), save);
      card.append(row);
      box.append(card);
    }
  }

  // ═════════ 操作ログ ═════════
  const ACTION_LABEL = {
    'login.success': 'ログイン', 'login.failed': 'ログイン失敗', 'setup.owner_created': '初期セットアップ',
    'user.created': 'ユーザー作成', 'user.updated': 'ユーザー編集', 'user.sessions_revoked': '強制ログアウト',
    'user.password_changed_self': 'パスワード変更（本人）', 'room.capacity_changed': '定員の変更',
  };
  async function loadLogs() {
    let logs;
    try { logs = (await api('GET', '/api/admin/logs')).logs; } catch (e) { return toast(e.message); }
    const body = $('#log-body'); body.textContent = '';
    for (const l of logs) {
      const tr = el('tr');
      const at = new Date(l.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      let detail = '';
      try { const d = JSON.parse(l.detail || 'null'); if (d && d.reason === 'inactive') detail = '（無効なアカウント）'; if (d && d.to) detail = `（${d.from}→${d.to}人）`; } catch (e) {}
      [at, l.actor || '—', (ACTION_LABEL[l.action] || l.action) + detail, l.target || '', l.ip || ''].forEach(t => tr.append(el('td', null, t)));
      body.append(tr);
    }
    if (!logs.length) { const tr = el('tr'); const td = el('td', 'empty', 'まだ記録がありません'); td.colSpan = 5; tr.append(td); body.append(tr); }
  }
})();
