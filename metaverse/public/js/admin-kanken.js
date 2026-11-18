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

    // ── まとめて追加（表計算ソフトから貼り付け） ──
    const bkSec = section('📋 まとめて追加', 'Excel や Google スプレッドシートで「級・漢字・正しい読み・まちがい1・まちがい2・まちがい3」の6列の表を作り、表の部分をコピーして下に貼り付けてください。まちがいの読みが空欄なら自動で作ります（🤖の印。登録前に必ず確認してください）。');
    const dlRow = el('div', 'gb-row');
    const csvCell = (v) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const download = (name, rows) => {
      const text = '﻿' + rows.map(r => r.map(v => csvCell(String(v))).join(',')).join('\r\n');
      const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    const HEAD = ['級', '漢字', '正しい読み', 'まちがい1', 'まちがい2', 'まちがい3'];
    const tplBtn = el('button', 'btn small secondary', '📄 ひな形をダウンロード');
    tplBtn.onclick = () => download('漢字テスト_ひな形.csv', [HEAD, ['4級', '跳躍', 'ちょうやく', 'とうやく', 'ちょうよく', 'はねやく'], ['3級', '緩慢', 'かんまん', '', '', '']]);
    const expBtn = el('button', 'btn small secondary', '⬇ 今の問題をダウンロード');
    expBtn.onclick = () => download('漢字テスト_問題.csv', [HEAD, ...questions.map(q => [q.level, q.word, q.answer, ...q.wrong])]);
    dlRow.append(tplBtn, expBtn);
    const paste = el('textarea', 'gb-out'); paste.rows = 8; paste.placeholder = '4級	跳躍	ちょうやく	とうやく	ちょうよく	はねやく\n3級	緩慢	かんまん\n…（表計算ソフトからコピーして貼り付け）';
    const checkBtn = el('button', 'btn', '確認する');
    const preview = el('div', 'kq-preview');
    const commitBtn = el('button', 'btn', '登録する'); commitBtn.hidden = true;
    let parsed = [];
    checkBtn.onclick = () => {
      parsed = parseRows(paste.value, levels);
      preview.textContent = '';
      if (!parsed.length) { preview.append(el('p', 'muted', '貼り付けた内容がありません')); commitBtn.hidden = true; return; }
      const exist = new Set(questions.map(q => q.level + '|' + q.word));
      const t = el('table', 'logs');
      const h = el('tr'); ['行', '級', '漢字', '正しい読み', 'まちがいの読み', ''].forEach(x => h.append(el('th', null, x))); t.append(h);
      let ok = 0;
      for (const r of parsed) {
        if (!r.error && exist.has(r.level + '|' + r.word)) r.note = 'もう登録済み（とばします）';
        const tr = el('tr', r.error ? 'kq-bad' : r.auto ? 'kq-auto' : '');
        [r.line, r.level || '', r.word || '', r.answer || '', (r.wrong || []).join('・')].forEach(x => tr.append(el('td', null, String(x))));
        tr.append(el('td', null, r.error ? '✖ ' + r.error : r.note ? r.note : r.auto ? '🤖 自動で作った読み（確認してください）' : '✅'));
        t.append(tr);
        if (!r.error && !r.note) ok++;
      }
      const w = el('div', 'table-wrap'); w.append(t);
      preview.append(el('p', null, `登録できる問題：${ok}問（全${parsed.length}行）`), w);
      commitBtn.hidden = ok === 0;
      commitBtn.textContent = `${ok}問を登録する`;
    };
    commitBtn.onclick = async () => {
      const rows = parsed.filter(r => !r.error && !r.note).map(r => ({ line: r.line, level: r.level, word: r.word, answer: r.answer, wrong: r.wrong }));
      if (parsed.some(r => r.auto && !r.error && !r.note) && !confirm('🤖 自動で作った「まちがいの読み」がふくまれています。\n別の正しい読みになっていないか確認しましたか？')) return;
      try {
        const res = await api('POST', '/api/admin/kanken/questions/bulk', { rows });
        toast(`${res.added}問を登録しました` + (res.skipped ? `（${res.skipped}問は登録済みのためとばしました）` : '') + (res.errors.length ? `（${res.errors.length}行はエラー）` : ''), 6000);
        load(root, { api, toast });
      } catch (e) { toast(e.message); }
    };
    bkSec.append(dlRow, paste, checkBtn, preview, commitBtn);

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
    loadParentQuestions(root, { api, toast });
  }

  // ── 👪 保護者の「今日の5問」（英単語・数学・理科・社会。漢字は上の漢字テストの4級〜準2級から出ます） ──
  async function loadParentQuestions(root, { api, toast }) {
    let d;
    try { d = await api('GET', '/api/admin/parent-questions'); } catch (e) { return; }
    const sec = el('div', 'gb-sec'); root.append(sec);
    const counts = {}; d.questions.forEach(q => { counts[q.subject] = (counts[q.subject] || 0) + 1; });
    sec.append(el('h3', 'sec', '👪 保護者の「今日の5問」'),
      el('p', 'muted', `教科は日替わり（漢字→英単語→数学→理科→社会）。漢字の日は、上の漢字テストの4級・3級・準2級から出ます。登録数：${['英単語', '数学', '理科', '社会'].map(s => `${s} ${counts[s] || 0}問`).join('・')}。最初に入っている問題は目安なので、先生が確認してください。`));
    const paste = el('textarea', 'gb-out'); paste.rows = 5;
    paste.placeholder = '教科	問題	正解	まちがい1	まちがい2	まちがい3\n理科	水が沸騰する温度は？	100℃	50℃	0℃	80℃\n…（表計算ソフトからコピーして貼り付け）';
    const add = el('button', 'btn', '貼り付けた問題を登録する');
    add.onclick = async () => {
      const rows = paste.value.replace(/\r/g, '').split('\n').map((line, i) => ({ line, i })).filter(x => x.line.trim())
        .map(({ line, i }) => { const c = (line.includes('\t') ? line.split('\t') : splitCsvLine(line)).map(x => x.trim()); return { line: i + 1, subject: c[0], question: c[1], answer: c[2], wrong: c.slice(3, 6) }; })
        .filter(r => !(r.line === 1 && r.subject === '教科'));
      if (!rows.length) return toast('貼り付けた内容がありません');
      try {
        const r = await api('POST', '/api/admin/parent-questions/bulk', { rows });
        toast(`${r.added}問を登録しました` + (r.skipped ? `（${r.skipped}問は登録済み）` : '') + (r.errors.length ? `（${r.errors.map(e => e.line + '行目：' + e.error).slice(0, 3).join(' / ')}）` : ''), 8000);
        if (r.added) load(root, { api, toast });
      } catch (e) { toast(e.message); }
    };
    const filter = el('select'); [['', 'すべての教科'], ...['英単語', '数学', '理科', '社会'].map(x => [x, x])].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; filter.append(o); });
    const list = el('div', 'kq-list');
    const render = () => {
      list.textContent = '';
      for (const q of d.questions.filter(x => !filter.value || x.subject === filter.value)) {
        const row = el('div', 'kq-row');
        row.append(el('span', 'badge', q.subject), el('b', 'kq-word', q.question), el('span', 'kq-ans', '✅ ' + q.answer), el('small', 'muted', '✖ ' + q.wrong.join('・')));
        const acts = el('span', 'kq-acts'), del = el('button', 'btn small danger', '削除');
        del.onclick = async () => { if (!confirm(`「${q.question}」を削除しますか？`)) return; try { await api('DELETE', `/api/admin/parent-questions/${q.id}`); d.questions = d.questions.filter(x => x !== q); render(); } catch (e) { toast(e.message); } };
        acts.append(del); row.append(acts); list.append(row);
      }
    };
    filter.onchange = render; render();
    sec.append(paste, add, filter, list);
  }

  // ── 貼り付けた表を読む ──
  const z2h = (s) => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  function normLevel(v, levels) {
    let t = z2h(String(v || '').trim()).replace(/\s/g, '');
    if (!t) return '';
    if (!t.endsWith('級')) t += '級';
    t = t.replace(/^準(\d)/, '準$1');
    return levels.includes(t) ? t : '';
  }
  function splitCsvLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  }
  function parseRows(text, levels) {
    const lines = text.replace(/\r/g, '').split('\n');
    const rows = [];
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const cells = (line.includes('\t') ? line.split('\t') : splitCsvLine(line)).map(c => c.trim());
      if (i === 0 && /級/.test(cells[0]) && /漢字/.test(cells[1] || '')) return; // 見出しの行
      const r = { line: i + 1, level: normLevel(cells[0], levels), word: cells[1] || '', answer: cells[2] || '', wrong: cells.slice(3, 6).filter(Boolean) };
      if (!r.level) r.error = '級が正しくありません（例：4級・準2級）';
      else if (!r.word || !r.answer) r.error = '漢字と正しい読みを入れてください';
      else if (!/^[ぁ-ゖー]+$/.test(r.answer)) r.error = '正しい読みは、ひらがなで入れてください';
      else {
        if (r.wrong.length < 3) {
          const made = makeWrongs(r.answer, r.wrong);
          if (made.length + r.wrong.length < 3) r.error = 'まちがいの読みを自動で作れませんでした。3つ入れてください';
          else { r.wrong = [...r.wrong, ...made].slice(0, 3); r.auto = true; }
        }
        if (!r.error && new Set([r.answer, ...r.wrong]).size !== 4) r.error = '4つの選択肢は、すべてちがう読みにしてください';
      }
      rows.push(r);
    });
    return rows;
  }
  // まちがいの読みを作る（濁点・半濁点、小さい「っ」、のばす音「う」、拗音を変える）
  const DAKU = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
  const UNDAKU = Object.fromEntries(Object.entries(DAKU).map(([a, b]) => [b, a]));
  const HANDAKU = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ', ば: 'ぱ', び: 'ぴ', ぶ: 'ぷ', べ: 'ぺ', ぼ: 'ぽ' };
  function makeWrongs(ans, have) {
    const cand = new Set();
    const chars = [...ans];
    chars.forEach((c, i) => {
      const swap = DAKU[c] || UNDAKU[c];
      if (swap && c !== 'ぢ' && swap !== 'ぢ' && swap !== 'づ') cand.add([...chars.slice(0, i), swap, ...chars.slice(i + 1)].join(''));
      if (HANDAKU[c]) cand.add([...chars.slice(0, i), HANDAKU[c], ...chars.slice(i + 1)].join(''));
    });
    if (ans.includes('っ')) cand.add(ans.replace('っ', 'つ'));
    else for (let i = 1; i < chars.length - 1; i++) if (/[かきくけこさしすせそたちつてとぱぴぷぺぽ]/.test(chars[i + 1]) && /[くちつき]/.test(chars[i])) { cand.add([...chars.slice(0, i), 'っ', ...chars.slice(i + 1)].join('')); break; }
    if (/(ょう|ゅう|こう|そう|とう|ほう|よう|どう|ぼう|ろう)/.test(ans)) cand.add(ans.replace(/(ょ|ゅ|こ|そ|と|ほ|よ|ど|ぼ|ろ)う/, '$1'));
    else if (/[こそとのほもよろごぞどぼょ]$/.test(ans)) cand.add(ans + 'う');
    if (/しょ|しゅ|じょ|じゅ/.test(ans)) cand.add(ans.replace(/しょ|しゅ|じょ|じゅ/, m => ({ しょ: 'しゅ', しゅ: 'しょ', じょ: 'じゅ', じゅ: 'じょ' })[m]));
    // ま行⇔ば行、「ん」をぬく
    const MB = { ま: 'ば', み: 'び', む: 'ぶ', め: 'べ', も: 'ぼ', ば: 'ま', び: 'み', ぶ: 'む', べ: 'め', ぼ: 'も' };
    chars.forEach((c, i) => { if (MB[c] && i > 0) cand.add([...chars.slice(0, i), MB[c], ...chars.slice(i + 1)].join('')); });
    const n = ans.indexOf('ん');
    if (n > 0) cand.add(ans.slice(0, n) + ans.slice(n + 1));
    const list = [...cand].filter(w => w !== ans && !have.includes(w) && w.length >= 2);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list.slice(0, 3 - have.length);
  }

  window.AdminKanken = { load, _parseRows: parseRows, _makeWrongs: makeWrongs };
})();
