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
    $('#tab-status-btn').hidden = !meta.canManageRooms;
    document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    showTab(meta.canManageUsers ? 'users' : 'rooms');
  })();

  function denied() {
    document.querySelector('main').innerHTML = '';
    document.querySelector('main').append(el('p', 'notice', 'この画面を使う権限がありません。'));
    $('#tabs').hidden = true;
  }

  let statusTimer = null;
  function showTab(tab) {
    clearInterval(statusTimer); statusTimer = null;
    if (tab === 'status') { loadStatus(); statusTimer = setInterval(loadStatus, 5000); }
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
    if (me.role === 'owner') {
      let cur = false;
      try { cur = (await api('GET', '/api/admin/settings')).studyPhotos; } catch (e) {}
      const card = el('div', 'room-box');
      card.append(el('h3', null, '📷 自習室の見守り写真'));
      card.append(el('div', 'muted', '自習室にいる生徒のカメラから、7〜13分おきに写真が届きます（先生とオーナーだけが見られます）。写真は最新の1枚だけで、データベースには保存せず、自習室を出ると消えます。オンにする前に、保護者と生徒の同意を取ってください。'));
      const row = el('div', 'cap-row');
      const b = el('button', 'btn small' + (cur ? ' danger' : ''), cur ? 'オフにする' : 'オンにする');
      row.append(el('b', null, cur ? '現在：オン' : '現在：オフ'), b);
      b.onclick = async () => {
        if (!cur && !confirm('見守り写真をオンにしますか？\n保護者と生徒の同意を取っていることを確認してください。')) return;
        try { await api('PATCH', '/api/admin/settings', { studyPhotos: !cur }); toast(!cur ? '見守り写真をオンにしました' : '見守り写真をオフにしました'); loadRooms(); }
        catch (e) { toast(e.message); }
      };
      card.append(row);
      box.append(card);
    }
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

  // ═════════ 入室状況 ═════════
  const ROOM_LABEL = { class1: '教室1', class2: '教室2', class3: '教室3', study: '自習室', hall: 'ろうか', lobby: 'ロビー' };
  async function loadStatus() {
    let data;
    try { data = await api('GET', '/api/admin/presence'); } catch (e) { return toast(e.message); }
    const isOwner = me.role === 'owner';
    $('#status-note').textContent = isOwner ? '不審な接続は「切断」で止められます。' : '（接続の切断はオーナーのみ）';
    $('#ip-col').hidden = !isOwner;
    const box = $('#status-rooms'); box.textContent = '';
    for (const [id, r] of Object.entries(data.rooms)) {
      const card = el('div', 'room-box');
      card.append(el('h3', null, (r.type === 'study' ? '📚 ' : '🏫 ') + r.name));
      card.append(el('div', 'big' + (r.students >= r.capacity ? ' full' : ''), `${r.students} / ${r.capacity}人`));
      card.append(el('div', 'muted', r.staff ? `先生・オーナー ${r.staff}人` : '先生はいません'));
      const cls = data.classes && data.classes[id];
      if (cls) {
        const mins = Math.floor((Date.now() - cls.startedAt) / 60000);
        card.append(el('div', 'live', `🔴 授業中：${cls.teacherName}先生（${mins}分）${cls.screen ? '・画面共有中' : ''}`));
        if (isOwner) {
          const b = el('button', 'btn small danger', '授業を終了させる');
          b.onclick = async () => {
            if (!confirm(`${r.name}の授業（通話・画面共有）を終了させますか？`)) return;
            try { await api('POST', `/api/admin/classes/${id}/end`); toast('授業を終了しました'); loadStatus(); } catch (e) { toast(e.message); }
          };
          card.append(b);
        }
      }
      const names = data.users.filter(u => u.room === id);
      if (names.length) {
        const ul = el('ul');
        names.forEach(u => ul.append(el('li', null, (u.role !== 'student' ? ROLE_LABEL[u.role] + ' ' : '') + u.name + (u.hand ? ' ✋' : ''))));
        card.append(ul);
      }
      box.append(card);
    }
    const body = $('#status-body'); body.textContent = '';
    for (const u of data.users.sort((a, b) => (a.room || 'z').localeCompare(b.room || 'z') || a.name.localeCompare(b.name, 'ja'))) {
      const tr = el('tr');
      const t = new Date(u.connectedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      [u.name, ROLE_LABEL[u.role], ROOM_LABEL[u.room || u.zone] || '出入口', (u.seat ? '着席' : '') + (u.hand ? ' ✋挙手' : '') + (u.privateWith ? ` 🎧${u.privateWith}と個別通話中` : ''), u.device, t].forEach(v => tr.append(el('td', null, v)));
      if (isOwner) tr.append(el('td', null, u.ip || ''));
      const td = el('td');
      if (isOwner && u.privateWith) {
        const b0 = el('button', 'btn small secondary', '個別通話を終了'); b0.onclick = async () => {
          if (!confirm(`${u.name} さんの個別通話を終了させますか？`)) return;
          try { await api('POST', `/api/admin/calls/${u.id}/end`); toast('個別通話を終了しました'); loadStatus(); } catch (e) { toast(e.message); }
        };
        td.append(b0, document.createTextNode(' '));
      }
      if (isOwner && u.id !== me.id) {
        const b1 = el('button', 'btn small secondary', '切断'); b1.onclick = () => disconnect(u, false);
        const b2 = el('button', 'btn small danger', '切断してログアウト'); b2.onclick = () => disconnect(u, true);
        td.append(b1, document.createTextNode(' '), b2);
      }
      tr.append(td);
      body.append(tr);
    }
    if (!data.users.length) { const tr = el('tr'); const td = el('td', 'empty', 'いま接続している人はいません'); td.colSpan = 8; tr.append(td); body.append(tr); }
  }
  async function disconnect(u, revoke) {
    const msg = revoke ? `${u.name} さんの接続を切り、すべての端末からログアウトさせますか？\n（もう一度ログインすれば入れます。入れなくするには「ユーザー」タブで無効にしてください）`
      : `${u.name} さんの接続を切りますか？（再ログインせずにページを開き直すと再接続できます）`;
    if (!confirm(msg)) return;
    try { await api('POST', `/api/admin/presence/${u.id}/disconnect`, { revoke }); toast('切断しました'); loadStatus(); }
    catch (e) { toast(e.message); }
  }

  // ═════════ 操作ログ ═════════
  const ACTION_LABEL = {
    'login.success': 'ログイン', 'login.failed': 'ログイン失敗', 'setup.owner_created': '初期セットアップ',
    'user.created': 'ユーザー作成', 'user.updated': 'ユーザー編集', 'user.sessions_revoked': '強制ログアウト',
    'user.password_changed_self': 'パスワード変更（本人）', 'room.capacity_changed': '定員の変更',
    'presence.disconnected': '接続の切断', 'settings.study_photos': '見守り写真の設定', 'private.invited': '個別通話の呼び出し', 'private.started': '個別通話を開始', 'private.ended': '個別通話を終了', 'class.started': '授業（通話）を開始', 'class.ended': '授業（通話）を終了', 'presence.disconnected_and_revoked': '切断＋ログアウト',
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
