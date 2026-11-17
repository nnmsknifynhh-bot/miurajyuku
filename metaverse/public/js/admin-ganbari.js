// 管理画面「🏆 がんばり」：自習時間の数え方・学期と年度・学年の木・生徒の自習時間の修正・目標の確認・保護者レポート
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hm = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}時間${m ? m + '分' : ''}` : `${m}分`; };
  const mmdd = (d) => d.slice(5).replace('-', '/');

  async function load(root, ctx) {
    const { me, meta, api, toast } = ctx;
    root.textContent = '';
    const isOwner = me.role === 'owner';
    const section = (title, note) => {
      const s = el('div', 'gb-sec');
      s.append(el('h3', 'sec', title));
      if (note) s.append(el('p', 'muted', note));
      root.append(s);
      return s;
    };
    let cfg = null;
    if (isOwner) {
      try { cfg = await api('GET', '/api/admin/ganbari/config'); } catch (e) { return toast(e.message); }
    }

    // ═════ 目標の確認（先生も） ═════
    const goalSec = section('🎯 目標の確認', '生徒が書いた「今学期の目標」です。「確認OK」にすると学年の木に短冊として飾られ、「達成」にすると⭐になります。');
    async function loadGoals() {
      const box = goalSec.querySelector('.gb-goals') || goalSec.appendChild(el('div', 'gb-goals'));
      box.textContent = '';
      let data;
      try { data = await api('GET', '/api/admin/ganbari/goals'); } catch (e) { box.append(el('p', 'muted', e.message)); return; }
      if (!data.term) { box.append(el('p', 'muted', '今は学期の期間ではありません')); return; }
      if (!data.goals.length) { box.append(el('p', 'muted', 'まだ目標は出ていません')); return; }
      for (const g of data.goals) {
        const row = el('div', 'gb-goal ' + g.status);
        const st = g.achieved ? '⭐ 達成' : { pending: '⏳ 確認待ち', approved: '🎋 飾っています', rejected: '✖ 書き直し' }[g.status];
        const info = el('div');
        info.append(el('b', null, `${g.name}（${g.grade || '学年未設定'}）`), el('div', null, g.text), el('small', 'muted', st));
        const acts = el('div', 'actions');
        const btn = (label, action, cls = 'secondary') => {
          const b = el('button', 'btn small ' + cls, label);
          b.onclick = async () => { try { await api('POST', `/api/admin/ganbari/goals/${g.id}/review`, { action }); loadGoals(); } catch (e) { toast(e.message); } };
          acts.append(b);
        };
        if (g.status !== 'approved') btn('確認OK', 'approve', '');
        if (g.status !== 'rejected' && !g.achieved) btn('書き直してもらう', 'reject');
        if (g.status === 'approved' && !g.achieved) btn('⭐ 達成にする', 'achieved', '');
        if (g.achieved) btn('達成を取り消す', 'unachieved');
        row.append(info, acts);
        box.append(row);
      }
    }
    loadGoals();
    if (!isOwner) return; // 先生は目標の確認だけ

    const c = cfg.config;
    const save = async (patch, msg) => {
      try { cfg.config = (await api('PATCH', '/api/admin/ganbari/config', patch)).config; toast(msg || '保存しました'); return true; }
      catch (e) { toast(e.message); return false; }
    };
    const field = (label, input, note) => { const l = el('label', 'field'); l.append(label, input); if (note) l.append(el('small', null, note)); return l; };
    const numInput = (v, min, max) => { const i = el('input'); i.type = 'number'; i.min = min; i.max = max; i.value = v; i.inputMode = 'numeric'; return i; };
    const timeInput = (v) => { const i = el('input'); i.type = 'time'; i.value = v === '24:00' ? '23:59' : v; return i; };
    const dateInput = (v) => { const i = el('input'); i.type = 'date'; i.value = v; return i; };
    const check = (label, v) => { const l = el('label', 'gb-check'); const i = el('input'); i.type = 'checkbox'; i.checked = v; l.append(i, document.createTextNode(label)); return [l, i]; };

    // ═════ 自習時間の数え方 ═════
    const rule = section('⏱ 自習時間の数え方', '自習室にいて、アプリを見ている（離席していない）生徒の時間を1分ずつ数えます。公平になるように、条件を決めてください。');
    const wStart = timeInput(c.window.start), wEnd = timeInput(c.window.end);
    const allDay = check('時間帯を決めない（いつでも数える）', c.window.start === '00:00' && c.window.end === '24:00');
    const syncWin = () => { wStart.disabled = wEnd.disabled = allDay[1].checked; };
    allDay[1].onchange = syncWin; syncWin();
    const cap = numInput(c.dailyCap, 10, 1440), streakMin = numInput(c.streakMin, 1, 600), mpp = numInput(c.minutesPerPoint, 1, 120);
    const seat = check('席に座っているときだけ数える', c.requireSeat), cam = check('見守り写真がオンのときは、カメラがオンのときだけ数える', c.requireCamera);
    const grid = el('div', 'gb-grid');
    const winRow = el('div', 'gb-row'); winRow.append(wStart, el('span', null, '〜'), wEnd);
    grid.append(field('数える時間帯', winRow), field('1日に数える上限（分）', cap, '例：300 = 5時間'), field('連続自習🔥に数える1日の最低時間（分）', streakMin), field('何分で1ポイント', mpp));
    const saveRule = el('button', 'btn', '保存する');
    saveRule.onclick = () => save({
      window: allDay[1].checked ? { start: '00:00', end: '24:00' } : { start: wStart.value, end: wEnd.value === '23:59' ? '24:00' : wEnd.value },
      dailyCap: Number(cap.value), streakMin: Number(streakMin.value), minutesPerPoint: Number(mpp.value),
      requireSeat: seat[1].checked, requireCamera: cam[1].checked,
    }, '数え方を保存しました');
    // 曜日ごとの数え方
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const byDay = check('曜日ごとに変える（数える曜日・時間帯・上限）', Array.isArray(c.weekly));
    const wkBox = el('div', 'gb-week');
    const wkRows = WD.map((name, i) => {
      const w = (c.weekly && c.weekly[i]) || { on: true, start: c.window.start, end: c.window.end, cap: c.dailyCap };
      const row = el('div', 'gb-wd');
      const on = check(name + '曜', w.on);
      const s = timeInput(w.start), e = timeInput(w.end), cp = numInput(w.cap, 10, 1440);
      const all = check('いつでも', w.start === '00:00' && w.end === '24:00');
      const sync = () => { const off = !on[1].checked; s.disabled = e.disabled = off || all[1].checked; cp.disabled = all[1].disabled = off; row.classList.toggle('off', off); };
      on[1].onchange = all[1].onchange = sync; sync();
      const t = el('span', 'gb-row'); t.append(s, el('span', null, '〜'), e);
      const capL = el('span', 'gb-row'); capL.append(el('span', 'muted', '上限'), cp, el('span', 'muted', '分'));
      row.append(on[0], all[0], t, capL);
      wkBox.append(row);
      return () => ({ on: on[1].checked, start: all[1].checked ? '00:00' : s.value, end: all[1].checked ? '24:00' : (e.value === '23:59' ? '24:00' : e.value), cap: Number(cp.value) });
    });
    const wkNote = el('p', 'muted', 'チェックをはずした曜日は自習時間を数えません。その曜日は連続自習🔥も途切れません（お休みの日として、とばして数えます）。');
    const syncWeek = () => { const w = byDay[1].checked; wkBox.hidden = wkNote.hidden = !w; grid.querySelectorAll('.gb-common').forEach(x => { x.hidden = w; }); allDay[0].hidden = w; };
    grid.children[0].classList.add('gb-common'); grid.children[1].classList.add('gb-common');
    byDay[1].onchange = syncWeek; syncWeek();
    saveRule.onclick = () => save({
      window: allDay[1].checked ? { start: '00:00', end: '24:00' } : { start: wStart.value, end: wEnd.value === '23:59' ? '24:00' : wEnd.value },
      dailyCap: Number(cap.value), streakMin: Number(streakMin.value), minutesPerPoint: Number(mpp.value),
      requireSeat: seat[1].checked, requireCamera: cam[1].checked,
      weekly: byDay[1].checked ? wkRows.map(f => f()) : null,
    }, '数え方を保存しました');
    rule.append(allDay[0], byDay[0], wkBox, wkNote, grid, seat[0], cam[0], saveRule);

    // ═════ 学期と年度 ═════
    const termSec = section('📅 学期と年度', `今は ${cfg.current ? cfg.current.name : '学期の期間外'}です。保護者レポートは学期ごとに作れます。`);
    const t1 = dateInput(c.terms[0]), t2 = dateInput(c.terms[1]), t3 = dateInput(c.terms[2]);
    t1.disabled = true;
    const tg = el('div', 'gb-grid');
    tg.append(field('1学期の開始日（年度の始まり）', t1), field('2学期の開始日', t2), field('3学期の開始日', t3));
    const saveTerms = el('button', 'btn', '学期を保存する');
    saveTerms.onclick = () => save({ terms: [t1.value, t2.value, t3.value] }, '学期を保存しました');
    termSec.append(tg, saveTerms);
    // 新年度
    const ny = el('div', 'gb-box warn');
    ny.append(el('b', null, '🌸 新年度にする'), el('p', 'muted', 'ポイントと着せかえアイテムが全員0にもどります（自習時間の記録は残ります）。3学期の保護者レポートは、新年度にする前に作ってください。'));
    const y = Number(c.yearStart.slice(0, 4)) + 1;
    const n1 = dateInput(`${y}-04-01`), n2 = dateInput(`${y}-09-01`), n3 = dateInput(`${y + 1}-01-01`);
    const nyGrid = el('div', 'gb-grid'); nyGrid.append(field('新年度の1学期', n1), field('2学期', n2), field('3学期', n3));
    const promote = check('生徒全員の学年を1つ上げる（中3 → 高1、高3 → 卒業）', true);
    const nyBtn = el('button', 'btn danger', '新年度にする');
    nyBtn.onclick = async () => {
      if (!confirm('新年度にしますか？\n全員のポイントと着せかえアイテムが0にもどります。この操作は元にもどせません。')) return;
      try { await api('POST', '/api/admin/ganbari/new-year', { terms: [n1.value, n2.value, n3.value], promote: promote[1].checked }); toast('新年度にしました'); load(root, ctx); }
      catch (e) { toast(e.message); }
    };
    ny.append(nyGrid, promote[0], nyBtn);
    termSec.append(ny);

    // ═════ 学年の木 ═════
    const treeSec = section('🌳 学年の木', '木は、今学期の「学年の生徒1人あたりの平均自習時間」で育ちます。学年の人数がちがっても公平です。');
    const treeRows = c.trees.map((t, i) => {
      const box = el('div', 'gb-box');
      const name = el('input'); name.value = t.name; name.maxLength = 12;
      box.append(field(`${i + 1}本目の名前`, name));
      const gwrap = el('div', 'gb-grades');
      const boxes = meta.grades.map(g => { const [l, inp] = check(g, t.grades.includes(g)); inp.value = g; gwrap.append(l); return inp; });
      box.append(el('small', 'muted', 'ふくめる学年'), gwrap);
      treeSec.append(box);
      return { name, boxes };
    });
    const stageWrap = el('div', 'gb-grid');
    const stageInputs = cfg.stageNames.map((n, i) => { const inp = numInput(c.stages[i], 0, 2000); if (i === 0) inp.disabled = true; stageWrap.append(field(`${n}（平均○時間から）`, inp)); return inp; });
    treeSec.append(el('b', null, '木の段階'), stageWrap);
    const saveTree = el('button', 'btn', '木の設定を保存する');
    saveTree.onclick = () => save({
      trees: treeRows.map(r => ({ name: r.name.value, grades: r.boxes.filter(b => b.checked).map(b => b.value) })),
      stages: stageInputs.map(i => Number(i.value)),
    }, '木の設定を保存しました');
    treeSec.append(saveTree);

    // ═════ 着せかえ期間 ═════
    const dsSec = section('👕 着せかえ期間', '着せかえ（帽子・洋服・眼鏡・杖や剣・ペット・着ぐるみ）を買ったり着たりできる期間です。期間の外では、着せかえは誰にも見えません（持っているアイテムとポイントは消えません）。');
    const modeWrap = el('div', 'gb-row');
    const mkRadio = (val, label) => { const l = el('label', 'gb-check'); const r = el('input'); r.type = 'radio'; r.name = 'ds-mode'; r.value = val; r.checked = c.dressup.mode === val; l.append(r, document.createTextNode(label)); modeWrap.append(l); return r; };
    const rAlways = mkRadio('always', 'いつでも'); mkRadio('periods', '期間を決める');
    const plist = el('div', 'gb-periods');
    const addPeriodRow = (pr = { name: '', start: '', end: '' }) => {
      const row = el('div', 'gb-row gb-period');
      const nm = el('input'); nm.placeholder = '名前（例：冬休み）'; nm.value = pr.name || ''; nm.maxLength = 20;
      const st = dateInput(pr.start), en = dateInput(pr.end);
      const del = el('button', 'btn small secondary', '削除'); del.onclick = () => row.remove();
      row.append(nm, st, el('span', null, '〜'), en, del);
      plist.append(row);
    };
    c.dressup.periods.forEach(addPeriodRow);
    const addP = el('button', 'btn small secondary', '＋ 期間を追加'); addP.onclick = () => addPeriodRow();
    const syncMode = () => { plist.hidden = addP.hidden = rAlways.checked; };
    modeWrap.querySelectorAll('input').forEach(r => r.onchange = syncMode); syncMode();
    const saveDs = el('button', 'btn', '着せかえ期間を保存する');
    saveDs.onclick = () => save({
      dressup: {
        mode: rAlways.checked ? 'always' : 'periods',
        periods: [...plist.querySelectorAll('.gb-period')].map(r => { const [nm, st, en] = r.querySelectorAll('input'); return { name: nm.value, start: st.value, end: en.value }; }),
      },
    }, '着せかえ期間を保存しました');
    dsSec.append(modeWrap, plist, addP, saveDs);

    // ═════ 季節の飾り ═════
    const evSec = section('🎍 季節の飾り', 'その時期になると、ロビー・ろうか・自習室に飾りが出ます（画面に舞う演出はありません）。');
    const evWrap = el('div', 'gb-grades');
    const evBoxes = cfg.events.map(e => {
      const [l, inp] = check(`${e.name}（${e.from.replace('-', '/')}〜${e.to.replace('-', '/')}）`, c.events[e.id] !== false);
      inp.value = e.id; evWrap.append(l); return inp;
    });
    const saveEv = el('button', 'btn', '季節の飾りを保存する');
    saveEv.onclick = () => save({ events: Object.fromEntries(evBoxes.map(b => [b.value, b.checked])) }, '季節の飾りを保存しました');
    evSec.append(evWrap, saveEv);

    // ═════ 生徒の自習時間 ═════
    const stSec = section('👦 生徒の自習時間', '「修正」で、日ごとの自習時間を直せます（直した値が優先されます）。');
    const stBox = el('div', 'table-wrap'); stSec.append(stBox);
    async function loadStudents() {
      let data;
      try { data = await api('GET', '/api/admin/ganbari/students'); } catch (e) { return toast(e.message); }
      stBox.textContent = '';
      const table = el('table', 'logs');
      const head = el('tr');
      ['名前', '学年', '今日', '今学期', '今年度', 'ポイント', '🔥', ''].forEach(h => head.append(el('th', null, h)));
      table.append(el('thead')); table.firstChild.append(head);
      const tb = el('tbody');
      for (const s of data.students) {
        const tr = el('tr');
        [s.name, s.grade || '未設定', hm(s.today), hm(s.term), hm(s.year), s.points, s.streak ? `${s.streak}日` : ''].forEach(v => tr.append(el('td', null, String(v))));
        const td = el('td'); const b = el('button', 'btn small secondary', '修正'); b.onclick = () => openDays(s); td.append(b); tr.append(td);
        tb.append(tr);
      }
      if (!data.students.length) { const tr = el('tr'); const td = el('td', 'empty', '生徒がいません'); td.colSpan = 8; tr.append(td); tb.append(tr); }
      table.append(tb); stBox.append(table);
    }
    loadStudents();

    // 日ごとの修正
    let dlg = document.querySelector('#gb-days-dialog');
    if (!dlg) {
      dlg = el('dialog'); dlg.id = 'gb-days-dialog';
      dlg.innerHTML = '';
      const body = el('div', 'dialog-body');
      body.append(el('h2', null, ''), el('div', 'gb-range'), el('div', 'gb-days'), el('div', 'dialog-actions'));
      dlg.append(body);
      document.body.append(dlg);
    }
    async function openDays(s) {
      const body = dlg.firstChild;
      body.querySelector('h2').textContent = `${s.name} の自習時間`;
      const range = body.querySelector('.gb-range'); range.textContent = '';
      const terms = cfg.terms;
      const sel = el('select');
      for (const t of terms) { const o = el('option', null, `${t.name}（${mmdd(t.start)}〜${mmdd(t.end)}）`); o.value = t.key; sel.append(o); }
      if (cfg.current) sel.value = cfg.current.key;
      const addDay = dateInput(new Date().toISOString().slice(0, 10));
      const addMin = numInput(0, 0, 1440);
      const addBtn = el('button', 'btn small', 'この日の時間を入れる');
      range.append(field('学期', sel));
      const addRow = el('div', 'gb-row'); addRow.append(addDay, addMin, el('span', null, '分'), addBtn);
      range.append(el('small', 'muted', '記録がない日に時間を入れるとき：'), addRow);
      const list = body.querySelector('.gb-days');
      async function refresh() {
        const t = terms.find(x => x.key === sel.value);
        let days = [];
        try { days = (await api('GET', `/api/admin/ganbari/students/${s.id}/days?from=${t.start}&to=${t.end}`)).days; } catch (e) { toast(e.message); }
        list.textContent = '';
        if (!days.length) list.append(el('p', 'muted', 'この学期の記録はまだありません'));
        for (const d of days) {
          const row = el('div', 'gb-day');
          const inp = numInput(d.total, 0, 1440);
          const ok = el('button', 'btn small', '保存');
          ok.onclick = async () => { try { await api('PUT', `/api/admin/ganbari/students/${s.id}/days/${d.day}`, { minutes: Number(inp.value) }); toast('修正しました'); refresh(); loadStudents(); } catch (e) { toast(e.message); } };
          row.append(el('span', null, d.day.replace(/-/g, '/')), el('small', 'muted', `自動：${d.auto}分${d.manual !== null ? '（修正済み）' : ''}`), inp, el('span', null, '分'), ok);
          if (d.manual !== null) {
            const back = el('button', 'btn small secondary', '自動の値にもどす');
            back.onclick = async () => { try { await api('PUT', `/api/admin/ganbari/students/${s.id}/days/${d.day}`, { minutes: null }); refresh(); loadStudents(); } catch (e) { toast(e.message); } };
            row.append(back);
          }
          list.append(row);
        }
      }
      addBtn.onclick = async () => { try { await api('PUT', `/api/admin/ganbari/students/${s.id}/days/${addDay.value}`, { minutes: Number(addMin.value) }); toast('入れました'); refresh(); loadStudents(); } catch (e) { toast(e.message); } };
      sel.onchange = refresh;
      const actions = body.querySelector('.dialog-actions'); actions.textContent = '';
      const close = el('button', 'btn secondary', 'とじる'); close.onclick = () => dlg.close(); actions.append(close);
      await refresh();
      dlg.showModal();
    }

    // ═════ 保護者レポート ═════
    const rpSec = section('📨 保護者レポート', '学期ごとに、総自習時間・現在のアバター・目標・学年の木をまとめたページを作ります。リンクを LINE などで送るか、ページを開いて「画像で保存」した画像を送ってください（リンクの期限は120日）。');
    const rsel = el('select');
    for (const t of cfg.terms) { const o = el('option', null, `${t.name}（${mmdd(t.start)}〜${mmdd(t.end)}）`); o.value = t.key; rsel.append(o); }
    if (cfg.current) rsel.value = cfg.current.key;
    const comment = el('textarea'); comment.maxLength = 200; comment.rows = 2; comment.placeholder = '先生からのひとこと（全員共通・あとから1人ずつ作ることもできます）';
    const allBtn = el('button', 'btn', '全員分のリンクを作る');
    const out = el('textarea', 'gb-out'); out.readOnly = true; out.rows = 6; out.hidden = true;
    const copyBtn = el('button', 'btn small secondary', 'まとめてコピー'); copyBtn.hidden = true;
    copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(out.value); toast('コピーしました'); } catch (e) { out.select(); toast('選択したので、コピーしてください'); } };
    allBtn.onclick = async () => {
      try {
        const r = await api('POST', '/api/admin/ganbari/reports', { termKey: rsel.value, all: true, comment: comment.value });
        out.value = r.reports.map(x => `${x.name}（${x.grade || ''}）：${location.origin}${x.path}`).join('\n');
        out.hidden = false; copyBtn.hidden = false;
        renderReportRows(r.reports);
        toast(`${r.reports.length}人分のリンクを作りました`);
      } catch (e) { toast(e.message); }
    };
    rpSec.append(field('学期', rsel), field('先生からのひとこと', comment), allBtn, out, copyBtn);
    const rpList = el('div', 'gb-reports'); rpSec.append(rpList);
    function renderReportRows(reports) {
      rpList.textContent = '';
      for (const r of reports) {
        const row = el('div', 'gb-report');
        row.append(el('b', null, `${r.name}（${r.grade || ''}）`));
        const open = el('a', 'btn small secondary', 'ひらく'); open.href = r.path; open.target = '_blank'; open.rel = 'noopener';
        const cp = el('button', 'btn small secondary', 'リンクをコピー');
        cp.onclick = async () => { try { await navigator.clipboard.writeText(location.origin + r.path); toast('コピーしました'); } catch (e) { toast('コピーできませんでした'); } };
        row.append(open, cp);
        rpList.append(row);
      }
    }
  }

  window.AdminGanbari = { load };
})();
