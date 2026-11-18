(function () {
  const { api, toast, ROLE_LABEL } = window.App;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let me, meta, users = [], editing = null, roleFilter = '';

  (async function init() {
    try { me = (await api('GET', '/api/me')).user; } catch (e) { location.replace('/'); return; }
    try { meta = await api('GET', '/api/admin/meta'); } catch (e) { return denied(); }
    if (!meta.canManageUsers && !meta.canManageRooms && !meta.canReviewGoals) return denied();
    $('#tab-ganbari-btn').hidden = !(meta.canManageUsers || meta.canReviewGoals);
    $('#tab-kanken-btn').hidden = !meta.canManageUsers;
    $('#who').textContent = `${me.displayName}（${ROLE_LABEL[me.role]}）`;
    $('#tab-users-btn').hidden = !meta.canManageUsers;
    $('#tab-logs-btn').hidden = !meta.canManageUsers;
    $('#tab-rooms-btn').hidden = !meta.canManageRooms;
    $('#tab-status-btn').hidden = !meta.canManageRooms;
    document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    showTab(meta.canManageUsers ? 'users' : meta.canManageRooms ? 'rooms' : 'ganbari');
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
    if (tab === 'ganbari') window.AdminGanbari.load($('#tab-ganbari'), { me, meta, api, toast });
    if (tab === 'kanken') window.AdminKanken.load($('#tab-kanken'), { api, toast });
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
      if (u.locked) name.append(el('span', 'badge off', '🔒 ロック中'));
      if (u.trialUntil) name.append(el('span', 'badge trial', u.trialUntil > Date.now() ? `🎈 体験中（${new Date(u.trialUntil).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' })}まで）` : '🎈 体験おわり'));
      if (u.referrer) name.append(el('span', 'badge', `🤝 紹介：${u.referrer.name}${u.referrer.role === 'parent' ? '（保護者）' : ''}`));
      const sub = [`ID: ${u.loginId}`, ...(u.role === "student" ? [`学年: ${u.grade || "未設定"}`] : []), ...(u.classDays && u.classDays.length ? [`🏫 授業 ${u.classDays.map(i => '日月火水木金土'[i]).join('・')}`] : []), ...(u.visitDays && u.visitDays.length ? [`📅 ${u.visitDays.map(i => '日月火水木金土'[i]).join('・')} ${u.visitTime}〜`] : []), ...(u.birthday ? [`🎂 ${Number(u.birthday.slice(0, 2))}月${Number(u.birthday.slice(3))}日${u.birthdayPublic ? '' : '（先生だけ）'}`] : []), `ログイン中の端末: ${u.activeSessions}`];
      if (u.role === 'teacher') sub.push('担当: ' + (u.rooms.length ? u.rooms.map(roomName).join('・') : 'なし'));
      info.append(name, el('div', 'sub', sub.join('　')));
      const actions = el('div', 'actions');
      const isSelf = u.id === me.id;
      const btn = (label, cls, fn) => { const b = el('button', 'btn small ' + cls, label); b.onclick = fn; actions.append(b); };
      if (u.locked) btn('🔓 ロックを解除', '', () => unlock(u));
      btn('編集', 'secondary', () => openEditor(u));
      if (u.role === 'student' && me.role === 'owner' && !u.trialUntil) btn('👪 保護者', 'secondary', () => openFamily(u));
      if (u.trialUntil && me.role === 'owner') btn('🎓 入塾にする', '', () => enrollTrial(u));
      if (u.role === 'student' && !u.trialUntil && !u.referrer && me.role === 'owner') btn('🤝 紹介者', 'secondary', () => openRef(u));
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
  async function unlock(u) {
    try { await api('POST', `/api/admin/users/${u.id}/unlock`); toast(`${u.displayName} さんのロックを解除しました。すぐにログインできます`); loadUsers(); }
    catch (e) { toast(e.message); }
  }
  async function revoke(u) {
    if (!confirm(`${u.displayName} さんのすべての端末をログアウトさせますか？`)) return;
    try { const r = await api('POST', `/api/admin/users/${u.id}/revoke-sessions`); toast(`${r.revoked}台の端末をログアウトさせました`); loadUsers(); }
    catch (e) { toast(e.message); }
  }

  // ── 追加・編集ダイアログ ──
  $('#add-user').onclick = () => openEditor(null);
  $('#unlock-all').onclick = async () => {
    if (!confirm('ログインのまちがいでロックされている人を、全員解除しますか？')) return;
    try { const r = await api('POST', '/api/admin/unlock-all'); toast(r.count ? `${r.count}件のロックを解除しました` : 'ロックされている人はいませんでした'); loadUsers(); }
    catch (e) { toast(e.message); }
  };
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
    const gsel = $('#f-grade'); gsel.textContent = '';
    for (const gname of ['', ...meta.grades, '卒業']) { const o = el('option', null, gname || '（未設定）'); o.value = gname; gsel.append(o); }
    gsel.value = u && u.grade ? u.grade : '';
    // 誕生日（月・日）
    const [bm, bd] = u && u.birthday ? u.birthday.split('-') : ['', ''];
    const msel = $('#f-bmonth'), dsel = $('#f-bday'); msel.textContent = ''; dsel.textContent = '';
    msel.append(Object.assign(el('option', null, '—'), { value: '' })); dsel.append(Object.assign(el('option', null, '—'), { value: '' }));
    for (let m = 1; m <= 12; m++) { const o = el('option', null, String(m)); o.value = String(m).padStart(2, '0'); msel.append(o); }
    for (let d = 1; d <= 31; d++) { const o = el('option', null, String(d)); o.value = String(d).padStart(2, '0'); dsel.append(o); }
    msel.value = bm; dsel.value = bd;
    $('#f-bpublic').checked = u ? u.birthdayPublic !== false : true;
    // 来る曜日（高校生）
    const vbox = $('#f-vdays'); vbox.textContent = '';
    ['日', '月', '火', '水', '木', '金', '土'].forEach((w, i) => {
      const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.value = String(i);
      cb.checked = !!(u && u.visitDays && u.visitDays.includes(i));
      lab.append(cb, document.createTextNode(w)); vbox.append(lab);
    });
    $('#f-vtime').value = u && u.visitTime ? u.visitTime : '';
    // 授業の曜日
    const cbox = $('#f-cdays'); cbox.textContent = '';
    ['日', '月', '火', '水', '木', '金', '土'].forEach((w, i) => {
      const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.value = String(i);
      cb.checked = !!(u && u.classDays && u.classDays.includes(i));
      lab.append(cb, document.createTextNode(w)); cbox.append(lab);
    });
    const syncVisit = () => { $('#visit-field').hidden = currentRole() !== 'student' || !/^高[123]$/.test($('#f-grade').value); };
    $('#f-grade').onchange = syncVisit; syncVisit();
    $('#user-dialog').showModal();
  }

  function renderPermFields(role, u) {
    $('#grade-field').hidden = role !== 'student';
    $('#perms-field').hidden = role === 'parent';
    $('#bday-field').hidden = role !== 'student';
    $('#class-field').hidden = role !== 'student';
    $('#visit-field').hidden = role !== 'student' || !/^高[123]$/.test(($('#f-grade') || {}).value || '');
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
    if (role === 'student') {
      body.grade = $('#f-grade').value || null;
      const m = $('#f-bmonth').value, d = $('#f-bday').value;
      if (!!m !== !!d) { $('#user-error').textContent = '誕生日は月と日の両方を選んでください（登録しないときは両方「—」）'; return; }
      body.birthday = m ? `${m}-${d}` : null;
      body.birthdayPublic = $('#f-bpublic').checked;
      body.classDays = [...document.querySelectorAll('#f-cdays input:checked')].map(cb => Number(cb.value));
      if (/^高[123]$/.test(body.grade || '')) {
        const days = [...document.querySelectorAll('#f-vdays input:checked')].map(cb => Number(cb.value));
        const t = $('#f-vtime').value;
        if (days.length && !t) { $('#user-error').textContent = '来る曜日をえらんだら、時刻も入れてください'; return; }
        body.visitDays = days; body.visitTime = days.length ? t : null;
      }
    }
    const pw = $('#f-pw').value;
    if (role !== 'owner' && role !== 'parent') { body.permissions = permissions; if (role === 'teacher') body.rooms = rooms; }
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

  // ── 👪 保護者の招待コード・つながっている保護者 ──
  let famUser = null;
  async function openFamily(u) {
    famUser = u;
    $('#fa-title').textContent = `👪 ${u.displayName} さんの保護者`;
    $('#fa-code').hidden = true; $('#fa-copy').hidden = true; $('#fa-code').textContent = '';
    const list = $('#fa-list'); list.textContent = '';
    try {
      const { parents } = await api('GET', `/api/admin/users/${u.id}/parents`);
      if (!parents.length) list.append(el('p', 'muted', 'まだ保護者は登録されていません。「招待コードを作る」で作ったコードを保護者の方にお渡しください（1回だけ使えます）。'));
      for (const p of parents) {
        const row = el('div', 'gb-row');
        row.append(el('span', null, `${p.name}（ID: ${p.loginId}）${p.active ? '' : '・無効'}`));
        const b = el('button', 'btn small danger', '外す');
        b.onclick = async () => {
          if (!confirm(`${p.name} さんと ${u.displayName} さんのつながりを外しますか？\n（保護者のアカウントは残ります。無効にするときはユーザー一覧から）`)) return;
          try { await api('DELETE', `/api/admin/users/${u.id}/parents/${p.id}`); toast('外しました'); openFamily(u); } catch (e) { toast(e.message); }
        };
        row.append(b); list.append(row);
      }
    } catch (e) { toast(e.message); return; }
    if (!$('#family-admin').open) $('#family-admin').showModal();
  }
  $('#fa-make').onclick = async () => {
    try {
      const { code } = await api('POST', `/api/admin/users/${famUser.id}/parent-invite`);
      $('#fa-code').textContent = `三浦塾 オンライン教室（保護者の方へ）\n${famUser.displayName} さんの保護者用 招待コード：${code}\n\n1. ${location.origin}/#parent を開く\n2. 招待コード・お名前・ログインID・パスワードを入れて登録\n※コードは1回だけ使えます。訪問は1日1回・10分です。`;
      $('#fa-code').hidden = false; $('#fa-copy').hidden = false;
    } catch (e) { toast(e.message); }
  };
  $('#fa-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#fa-code').textContent); toast('コピーしました'); } catch (e) { toast('コピーできませんでした'); } };
  $('#fa-close').onclick = () => $('#family-admin').close();

  // ── 🤝 体験 → 入塾・紹介者の登録 ──
  async function enrollTrial(u) {
    const loginId = prompt(`${u.displayName} さんを入塾にします。\n新しいログインIDを入れてください（半角英数字）`, '');
    if (!loginId) return;
    const pw = makePassword();
    try {
      const r = await api('POST', `/api/admin/users/${u.id}/enroll`, { loginId: loginId.trim(), password: pw });
      showCredentials(r.user, pw);
      toast(r.rewards ? (r.rewards.kind === 'student' ? '入塾にしました。紹介してくれた生徒と2人に🐥をわたし、ペア自習チャレンジが始まりました' : '入塾にしました。紹介してくれた保護者に🌷と50ポイント') : '入塾にしました', 7000);
      loadUsers(); if (typeof loadReferral === 'function') loadReferral();
    } catch (e) { toast(e.message); }
  }
  let refUser = null;
  function openRef(u) {
    refUser = u;
    $('#ref-title').textContent = `${u.displayName} さんを紹介してくれた人`;
    const sel = $('#ref-select'); sel.textContent = '';
    sel.append(Object.assign(el('option', null, '— えらんでください —'), { value: '' }));
    for (const x of users.filter(v => v.isActive && v.id !== u.id && !v.trialUntil && (v.role === 'student' || v.role === 'parent'))) {
      const o = el('option', null, `${x.role === 'parent' ? '保護者' : '生徒'}：${x.displayName}${x.grade ? `（${x.grade}）` : ''}`); o.value = x.id; sel.append(o);
    }
    $('#ref-dialog').showModal();
  }
  $('#ref-cancel').onclick = () => $('#ref-dialog').close();
  $('#ref-save').onclick = async () => {
    const id = $('#ref-select').value;
    if (!id) return toast('えらんでください');
    try {
      const r = await api('POST', `/api/admin/users/${refUser.id}/referrer`, { referrerId: Number(id) });
      $('#ref-dialog').close();
      toast(r.rewards && r.rewards.kind === 'parent' ? '登録しました。保護者に🌷と50ポイント' : '登録しました。2人に🐥をわたし、ペア自習チャレンジが始まりました', 6000);
      loadUsers();
    } catch (e) { toast(e.message); }
  };

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
  const ROOM_LABEL = { class1: 'スピーキング・ライティング教室', class2: '教室2', class3: '高校生自習室', study: '自習室', hall: 'ろうか', lobby: 'ロビー' };
  async function loadStatus() {
    let data;
    try { data = await api('GET', '/api/admin/presence'); } catch (e) { return toast(e.message); }
    const isOwner = me.role === 'owner';
    $('#status-note').textContent = isOwner ? '不審な接続は「切断」で止められます。' : '（接続の切断はオーナーのみ）';
    $('#ip-col').hidden = !isOwner;
    if (isOwner) { loadParentsToday(); loadReferral(); }
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
  // 今日来た保護者・保護者会
  let pmLoaded = false, mdLoaded = 0, rfLoaded = false;
  // 🤝 友だち紹介・体験
  async function loadReferral() {
    let d;
    try { d = await api('GET', '/api/admin/referral'); } catch (e) { return; }
    const c = d.config;
    if (!rfLoaded) {
      rfLoaded = true;
      $('#rf-trial').checked = c.trial; $('#rf-days').value = c.trialDays; $('#rf-wdays').value = c.weekTrialDays;
      $('#rf-wstart').value = c.week ? c.week.start : ''; $('#rf-wend').value = c.week ? c.week.end : '';
    }
    $('#rf-state').textContent = d.weekOn ? '🎉 いま友だち紹介ウィーク中' : c.week ? `紹介ウィーク：${c.week.start}〜${c.week.end}` : '';
    const tb = $('#rf-trials'); tb.textContent = '';
    const active = d.trials.filter(t => t.active);
    tb.append(el('p', null, `🎈 体験中：${active.length}人`));
    for (const t of active) {
      const row = el('div', 'gb-row');
      row.append(el('span', null, `${t.name}（${t.grade}）・${new Date(t.until).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' })}まで・招待：${t.referrer || '—'}${t.referrerRole === 'parent' ? '（保護者）' : ''}`));
      const b = el('button', 'btn small', '🎓 入塾にする');
      b.onclick = () => enrollTrial({ id: t.id, displayName: t.name });
      row.append(b); tb.append(row);
    }
    const lb = $('#rf-list'); lb.textContent = '';
    if (d.referrals.length) {
      lb.append(el('p', null, `🤝 紹介で入塾：${d.referrals.length}人`));
      for (const r of d.referrals.slice(0, 20)) {
        const pair = r.referrerRole === 'student' ? (r.pairResult === 'success' ? '・ペア成功💫' : r.pairResult === 'over' ? '・ペアおしかった' : '・ペア挑戦中') : '・🌷';
        lb.append(el('div', 'muted', `${r.newName} ← ${r.referrer}${r.referrerRole === 'parent' ? '（保護者）' : ''}（${r.enrolledAt.slice(0, 10)}）${pair}`));
      }
    }
  }
  $('#rf-save').onclick = async () => {
    const body = { trial: $('#rf-trial').checked, trialDays: Number($('#rf-days').value), weekTrialDays: Number($('#rf-wdays').value) };
    const ws = $('#rf-wstart').value, we = $('#rf-wend').value;
    if (ws || we) body.week = { start: ws, end: we };
    try { await api('PATCH', '/api/admin/referral', body); toast('保存しました'); loadReferral(); } catch (e) { toast(e.message); }
  };
  $('#rf-wclear').onclick = async () => {
    try { await api('PATCH', '/api/admin/referral', { week: null }); $('#rf-wstart').value = ''; $('#rf-wend').value = ''; toast('紹介ウィークを消しました'); loadReferral(); } catch (e) { toast(e.message); }
  };

  async function loadParentsToday() {
    let d;
    try { d = await api('GET', '/api/admin/parents/today'); } catch (e) { return; }
    $('#parent-box').hidden = false;
    const m = d.meeting, fmtDay = (x) => `${Number(x.slice(5, 7))}月${Number(x.slice(8))}日`;
    $('#pm-state').textContent = d.meetingOn ? `🎉 いま保護者会中です（${m.start}〜${m.end}）。生徒は入れません` : m ? `予定：${fmtDay(m.day)} ${m.start}〜${m.end}` : '予定はありません（保護者はロビーだけ・1日1回10分）';
    $('#pm-cancel').hidden = !m; $('#pm-cancel').textContent = d.meetingOn ? 'いますぐおわる' : '取り消す';
    if (!pmLoaded) { pmLoaded = true; const t = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); $('#pm-day').value = m ? m.day : t; if (m) { $('#pm-start').value = m.start; $('#pm-end').value = m.end; } }
    loadMendan();
    $('#pv-title').textContent = `今日来た保護者：${d.visits.length}人`;
    const body = $('#pv-body'); body.textContent = '';
    for (const v of d.visits) {
      const tr = el('tr');
      [v.name, v.children.join('・') || '—', new Date(v.startedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }), v.online ? '🟢 入室中' : ''].forEach(x => tr.append(el('td', null, x)));
      body.append(tr);
    }
    if (!d.visits.length) { const tr = el('tr'); const td = el('td', 'empty', '今日はまだ来ていません'); td.colSpan = 4; tr.append(td); body.append(tr); }
  }
  $('#pm-save').onclick = async () => {
    const body = { day: $('#pm-day').value, start: $('#pm-start').value, end: $('#pm-end').value };
    if (!confirm(`${body.day} ${body.start}〜${body.end} に保護者会の予定を入れますか？\nその時間は、生徒は入室できなくなります。`)) return;
    try { await api('POST', '/api/admin/parent-meeting', body); toast('保護者会の予定を入れました'); loadParentsToday(); } catch (e) { toast(e.message); }
  };
  $('#pm-cancel').onclick = async () => {
    if (!confirm('保護者会を取り消し（おわり）ますか？\n入室中の保護者は退室します。')) return;
    try { await api('POST', '/api/admin/parent-meeting', { cancel: true }); toast('保護者会を取り消しました'); loadParentsToday(); } catch (e) { toast(e.message); }
  };
  // 面談ブースに入れる人
  async function loadMendan() {
    let d;
    try { d = await api('GET', '/api/admin/mendan'); } catch (e) { return; }
    // えらぶリスト（生徒・保護者）は1分に1回だけ作り直す（選んでいる途中に消えないように）
    if (Date.now() - mdLoaded > 60000) {
      mdLoaded = Date.now();
      try {
        const all = (await api('GET', '/api/admin/users')).users.filter(u => u.isActive && (u.role === 'student' || u.role === 'parent'));
        const sel = $('#md-user'), cur = sel.value; sel.textContent = '';
        sel.append(Object.assign(el('option', null, '— 生徒・保護者をえらぶ —'), { value: '' }));
        for (const u of all.sort((a, b) => (a.role > b.role ? 1 : a.role < b.role ? -1 : a.displayName.localeCompare(b.displayName, 'ja')))) {
          const o = el('option', null, `${u.role === 'parent' ? '保護者' : '生徒'}：${u.displayName}${u.grade ? `（${u.grade}）` : ''}`); o.value = u.id; sel.append(o);
        }
        sel.value = cur;
      } catch (e) { /* 次の更新で */ }
    }
    const list = $('#md-list'); list.textContent = '';
    if (!d.allowed.length) list.append(el('p', 'muted', '今日はまだだれも許可していません'));
    for (const u of d.allowed) {
      const row = el('div', 'gb-row');
      row.append(el('span', null, `${u.role === 'parent' ? '👪 保護者' : '🧑‍🎓 生徒'}：${u.name}${u.children.length ? `（${u.children.join('・')}の保護者）` : ''}`));
      const b = el('button', 'btn small secondary', '外す');
      b.onclick = async () => { try { await api('POST', `/api/admin/mendan/${u.id}`, { allow: false }); loadMendan(); } catch (e) { toast(e.message); } };
      row.append(b); list.append(row);
    }
  }
  $('#md-add').onclick = async () => {
    const id = $('#md-user').value;
    if (!id) return toast('生徒か保護者をえらんでください');
    try { await api('POST', `/api/admin/mendan/${id}`, { allow: true }); toast('面談ブースに入れるようにしました（今日だけ）'); loadMendan(); } catch (e) { toast(e.message); }
  };

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
    'presence.disconnected': '接続の切断', 'settings.study_photos': '見守り写真の設定', 'private.invited': '個別通話の呼び出し', 'private.started': '個別通話を開始', 'private.ended': '個別通話を終了', 'class.started': '授業（通話）を開始', 'class.ended': '授業（通話）を終了', 'presence.disconnected_and_revoked': '切断＋ログアウト', 'parent.meeting_on': '保護者会の予定', 'parent.meeting_off': '保護者会の取り消し', 'mendan.allowed': '面談ブースを許可', 'trial.started': '体験を開始', 'trial.enrolled': '体験から入塾', 'referral.set': '紹介者を登録', 'referral.config': '友だち紹介の設定', 'mendan.removed': '面談ブースの許可を外す',
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
