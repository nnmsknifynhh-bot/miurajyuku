// 管理画面「📝 漢字テスト」：オン/オフ・学年ごとの級・成績・問題の追加と修正
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function load(root, { api, toast }) {
    root.textContent = '';
    let data;
    try { data = await api('GET', '/api/admin/kanken'); } catch (e) { return toast(e.message); }
    const { config, levels, grades, questions, stats } = data;
    const section = (title, note) => { const s = el('div', 'gb-sec'); s.append(el('h3', 'sec', title)); if (note) s.append(el('p', 'muted', note)); root.append(s); return s; };

    // ── 設定 ──
    const setSec = section('⚙️ 出題の設定', '生徒がオンライン教室に入るとき、学年に合った級から読みの4択問題を1問出します。正解でも不正解でも、正しい読みを見てから入室できます（通信が一瞬切れて入り直すときは出しません）。');
    const onL = el('label', 'gb-check'); const on = el('input'); on.type = 'checkbox'; on.checked = config.enabled; onL.append(on, document.createTextNode('入室前の漢字テストを出す'));
    const table = el('table', 'logs');
    const head = el('tr'); head.append(el('th', null, '学年'), ...levels.map(l => el('th', null, l)));
    table.append(head);
    const boxes = {};
    for (const g of grades) {
      const tr = el('tr'); tr.append(el('td', null, g));
      boxes[g] = levels.map(l => { const td = el('td'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = (config.gradeLevels[g] || []).includes(l); cb.value = l; td.append(cb); tr.append(td); return cb; });
      table.append(tr);
    }
    const wrap = el('div', 'table-wrap'); wrap.append(table);
    const saveCfg = el('button', 'btn', '設定を保存する');
    saveCfg.onclick = async () => {
      const gradeLevels = Object.fromEntries(grades.map(g => [g, boxes[g].filter(b => b.checked).map(b => b.value)]));
      try { await api('PATCH', '/api/admin/kanken/config', { enabled: on.checked, gradeLevels }); toast('保存しました'); } catch (e) { toast(e.message); }
    };
    setSec.append(onL, el('small', 'muted', 'チェックがない学年の生徒には出題しません。'), wrap, saveCfg);

    // ── 成績 ──
    const stSec = section('📊 生徒の成績（最近30日）');
    const st = el('table', 'logs');
    const sh = el('tr'); ['名前', '学年', '答えた数', '正解', '正答率'].forEach(h => sh.append(el('th', null, h))); st.append(sh);
    for (const s of stats) {
      const tr = el('tr');
      [s.name, s.grade || '未設定', s.answered, s.correct, s.answered ? Math.round(s.correct / s.answered * 100) + '%' : '—'].forEach(v => tr.append(el('td', null, String(v))));
      st.append(tr);
    }
    const stw = el('div', 'table-wrap'); stw.append(st); stSec.append(stw);

    // ── 問題 ──
    const qSec = section('📝 問題', `全${questions.length}問。「サンプル」は最初に入っている問題です。級の分け方は目安なので、確認して必要なら直してください。`);
    // 追加・修正フォーム
    const form = el('div', 'gb-box');
    const fLevel = el('select'); levels.forEach(l => { const o = el('option', null, l); o.value = l; fLevel.append(o); });
    const inp = (ph) => { const i = el('input'); i.placeholder = ph; i.maxLength = 20; return i; };
    const fWord = inp('漢字（例：跳躍）'), fAns = inp('正しい読み'), fW1 = inp('まちがいの読み1'), fW2 = inp('まちがいの読み2'), fW3 = inp('まちがいの読み3');
    const fRow = el('div', 'gb-row kq-form'); fRow.append(fLevel, fWord, fAns, fW1, fW2, fW3);
    const fBtn = el('button', 'btn small', '＋ 追加する'), fCancel = el('button', 'btn small secondary', '修正をやめる');
    fCancel.hidden = true;
    let editing = null;
    const resetForm = () => { editing = null; [fWord, fAns, fW1, fW2, fW3].forEach(i => { i.value = ''; }); fBtn.textContent = '＋ 追加する'; fCancel.hidden = true; };
    fCancel.onclick = resetForm;
    fBtn.onclick = async () => {
      const body = { level: fLevel.value, word: fWord.value, answer: fAns.value, wrong: [fW1.value, fW2.value, fW3.value] };
      try {
        if (editing) await api('PATCH', `/api/admin/kanken/questions/${editing}`, body); else await api('POST', '/api/admin/kanken/questions', body);
        toast(editing ? '修正しました' : '追加しました'); load(root, { api, toast });
      } catch (e) { toast(e.message); }
    };
    form.append(el('b', null, '問題を追加・修正'), fRow, el('div', 'gb-row', null));
    form.lastChild.append(fBtn, fCancel);
    qSec.append(form);
    // 一覧
    const filter = el('select'); [['', 'すべての級'], ...levels.map(l => [l, l])].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; filter.append(o); });
    qSec.append(filter);
    const list = el('div', 'kq-list'); qSec.append(list);
    const render = () => {
      list.textContent = '';
      for (const q of questions.filter(x => !filter.value || x.level === filter.value)) {
        const row = el('div', 'kq-row' + (q.active ? '' : ' off'));
        row.append(el('span', 'badge', q.level), el('b', 'kq-word', q.word), el('span', 'kq-ans', '✅ ' + q.answer), el('small', 'muted', '✖ ' + q.wrong.join('・')));
        if (q.sample) row.append(el('span', 'badge off', 'サンプル'));
        const acts = el('span', 'kq-acts');
        const b = (t, cls, fn) => { const x = el('button', 'btn small ' + cls, t); x.onclick = fn; acts.append(x); };
        b('修正', 'secondary', () => { editing = q.id; fLevel.value = q.level; fWord.value = q.word; fAns.value = q.answer; [fW1.value, fW2.value, fW3.value] = q.wrong; fBtn.textContent = '修正を保存'; fCancel.hidden = false; form.scrollIntoView({ behavior: 'smooth' }); });
        b(q.active ? 'お休み' : '出題する', 'secondary', async () => { try { await api('PATCH', `/api/admin/kanken/questions/${q.id}`, { active: !q.active }); load(root, { api, toast }); } catch (e) { toast(e.message); } });
        b('削除', 'danger', async () => { if (!confirm(`「${q.word}」を削除しますか？`)) return; try { await api('DELETE', `/api/admin/kanken/questions/${q.id}`); load(root, { api, toast }); } catch (e) { toast(e.message); } });
        row.append(acts);
        list.append(row);
      }
    };
    filter.onchange = render;
    render();
  }

  window.AdminKanken = { load };
})();
