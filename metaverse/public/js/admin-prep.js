// 管理画面「📋 テスト対策」：全生徒の進み具合・学校×学年×テストの日程（Unit・範囲）とUnitチェック表・スケジュールのひな形
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const md = (d) => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : '';
  const TERMS = [['1mid', '1学期中間'], ['1end', '1学期期末'], ['2mid', '2学期中間'], ['2end', '2学期期末'], ['final', '学年末']];
  let sortLate = true;

  async function load(root, { api, toast }) {
    root.textContent = '';
    let d;
    try { d = await api('GET', '/api/admin/prep'); } catch (e) { return toast(e.message); }
    const section = (title, note) => { const s = el('div', 'gb-sec'); s.append(el('h3', 'sec', title)); if (note) s.append(el('p', 'muted', note)); root.append(s); return s; };
    const reload = () => load(root, { api, toast });

    // ── ① 全生徒の進み具合 ──
    const ov = section('📊 全生徒の進み具合（中学生）', '今のテスト（5週間前〜テスト最終日）の進み具合です。名前を押すと、その生徒のスケジュールが開いて✅をつけられます。');
    const sl = el('label', 'sr-check'); const sc = el('input'); sc.type = 'checkbox'; sc.checked = sortLate; sl.append(sc, document.createTextNode(' 遅れが多い順')); ov.append(sl);
    const tw = el('div', 'table-wrap'); ov.append(tw);
    const detail = el('div', 'pp-detail'); ov.append(detail);
    function table() {
      tw.textContent = '';
      const t = el('table', 'logs'); const h = el('tr'); ['学年', '名前', '学校', 'テスト', '進み', '遅れ'].forEach(x => h.append(el('th', null, x))); t.append(h);
      const rows = [...d.overview].sort((a, b) => sortLate ? (b.counts.late - a.counts.late) || a.grade.localeCompare(b.grade) : 0);
      for (const s of rows) {
        const tr = el('tr');
        tr.append(el('td', null, s.grade));
        const td = el('td'); const b = el('button', 'btn small secondary', s.name); b.type = 'button';
        b.onclick = () => { detail.textContent = ''; detail.append(el('h3', 'sec', `📋 ${s.name}さん（${s.grade}）`)); const box = el('div'); detail.append(box); window.Prep.mount(box, { api, toast, userId: s.id, onChange: () => api('GET', '/api/admin/prep').then(x => { d.overview = x.overview; table(); }).catch(() => {}) }); detail.scrollIntoView({ behavior: 'smooth' }); };
        td.append(b); tr.append(td);
        tr.append(el('td', null, s.school || '（未設定）'));
        tr.append(el('td', null, s.test ? `${s.test.termName} ${md(s.test.start)}${s.test.source === 'self' ? '（生徒が入力）' : ''}${s.test.active ? '' : '（まだ先）'}` : '日程なし'));
        tr.append(el('td', null, s.test && s.test.active ? `${s.counts.done}/${s.counts.total}` : '–'));
        tr.append(el('td', s.counts.late ? 'pp-late-cell' : null, s.counts.late ? `⚠️ ${s.counts.late}` : '–'));
        t.append(tr);
      }
      if (!rows.length) { const tr = el('tr'); const c = el('td', 'empty', '中学生がいません'); c.colSpan = 6; tr.append(c); t.append(tr); }
      tw.append(t);
    }
    sc.onchange = () => { sortLate = sc.checked; table(); };
    table();

    // ── ② 学校のテスト日程 ──
    const ss = section('🏫 学年ごとの課題・範囲（学校×学年×テスト）', 'テストの日は「🏫 教室の設定」→ 学校名の「📅 定期テストの日」で、学校ごとに先に入れておけます（その学校の生徒ぜんいんに反映）。ここでは学年ごとのスピーキング・ライティングの課題と範囲を入れます。学年だけ日がちがうときは、ここに日付を入れるとそちらが先になります。生徒の学校名は「👥 ユーザー」で入れます。スピーキング・ライティングの課題は「Unit6-1　Unit6-2」のように、改行・「、」・スペース2つで区切ります。音読に登録した単元と同じ名前にすると、テスト教室で合格したときに自動で✅がつきます。');
    const form = el('div', 'pp-form');
    // 学校は「🏫 教室の設定」で作ったものからえらぶ
    const school = el('select'); school.append(new Option('学校をえらぶ', ''));
    [...new Set([...(d.schoolList || []), ...d.schoolTests.map(t => t.school)])].forEach(n => school.append(new Option(n, n)));
    const dl = el('span');
    const grade = el('select'); ['中1', '中2', '中3'].forEach(g => grade.append(new Option(g, g)));
    const term = el('select'); TERMS.forEach(([v, n]) => term.append(new Option(n, v)));
    const start = el('input'); start.type = 'date'; const end = el('input'); end.type = 'date';
    const r1 = el('div', 'gb-row'); r1.append(school, dl, grade, term);
    const r2 = el('div', 'gb-row'); r2.append(el('span', null, 'テスト初日（空なら学校の日程）'), start, el('span', null, '最後の日（あれば）'), end);
    const spk = el('textarea', 'gb-out'); spk.rows = 2; spk.placeholder = 'スピーキング（例：Unit6-1　Unit6-2）';
    const wrt = el('textarea', 'gb-out'); wrt.rows = 2; wrt.placeholder = 'ライティング（例：Unit6-1　Unit6-2）';
    const unitHint = el('small', 'muted', d.units.length ? `音読に登録ずみの単元：${d.units.slice(0, 20).join('・')}${d.units.length > 20 ? ' ほか' : ''}` : '音読の単元はまだ登録されていません');
    const rangeBox = el('div', 'gb-row'); const rangeIn = {};
    for (const sub of (d.subjects.length ? d.subjects : ['英語', '数学'])) { const i = el('input'); i.placeholder = `${sub}の範囲（例：新ワーク p.40〜55）`; i.maxLength = 80; rangeIn[sub] = i; rangeBox.append(el('span', null, sub), i); }
    const save = el('button', 'btn', '保存する'); save.type = 'button';
    const del = el('button', 'btn secondary', 'この日程を消す'); del.type = 'button';
    form.append(r1, r2, el('b', null, '🗣 スピーキング・ライティングの課題'), spk, wrt, unitHint, el('b', null, '📖 テスト範囲（新ワークの行の下に出ます）'), rangeBox, (() => { const r = el('div', 'gb-row'); r.append(save, del); return r; })());
    ss.append(form);
    const fill = (t) => {
      school.value = t.school; grade.value = t.grade; term.value = t.term; start.value = t.start; end.value = t.end || '';
      spk.value = t.speaking.join('\n'); wrt.value = t.writing.join('\n');
      for (const [k, i] of Object.entries(rangeIn)) i.value = (t.ranges || {})[k] || '';
      form.scrollIntoView({ behavior: 'smooth' });
    };
    const body = () => ({ school: school.value, grade: grade.value, term: term.value, start: start.value || null, end: end.value || null, speaking: spk.value, writing: wrt.value, ranges: Object.fromEntries(Object.entries(rangeIn).map(([k, i]) => [k, i.value])) });
    save.onclick = async () => { if (!school.value) return toast('学校をえらんでください（学校は「🏫 教室の設定」で作れます）'); try { await api('PUT', '/api/admin/prep/school-test', body()); toast('保存しました'); reload(); } catch (e) { toast(e.message); } };
    del.onclick = async () => { if (!confirm(`${school.value} ${grade.value} の日程を消しますか？`)) return; try { await api('PUT', '/api/admin/prep/school-test', { ...body(), start: null }); toast('消しました'); reload(); } catch (e) { toast(e.message); } };
    // 登録ずみの日程と、生徒ごとの Unit チェック表
    const lw = el('div', 'table-wrap'); ss.append(lw);
    const lt = el('table', 'logs'); const lh = el('tr'); ['学校', '学年', 'テスト', '日程', 'スピーキング', 'ライティング', ''].forEach(x => lh.append(el('th', null, x))); lt.append(lh);
    const swBox = el('div', 'pp-swtable');
    for (const t of d.schoolTests) {
      const tr = el('tr');
      [t.school, t.grade, t.termName, `${md(t.start)}${t.end ? '〜' + md(t.end) : ''}${t.fromSchool ? '（学校の日程）' : ''}`, t.speaking.join('・') || '–', t.writing.join('・') || '–'].forEach(v => tr.append(el('td', null, v)));
      const td = el('td');
      const e = el('button', 'btn small secondary', '直す'); e.type = 'button'; e.onclick = () => fill(t);
      const c = el('button', 'btn small', '✅ Unitチェック表'); c.type = 'button'; c.onclick = () => swTable(t);
      td.append(e, c); tr.append(td); lt.append(tr);
    }
    if (!d.schoolTests.length) { const tr = el('tr'); const c = el('td', 'empty', 'まだ日程がありません'); c.colSpan = 7; tr.append(c); lt.append(tr); }
    lw.append(lt); ss.append(swBox);
    async function swTable(t) {
      let r; try { r = await api('GET', `/api/admin/prep/sw?school=${encodeURIComponent(t.school)}&grade=${encodeURIComponent(t.grade)}&term=${t.term}`); } catch (e) { return toast(e.message); }
      swBox.textContent = '';
      swBox.append(el('h4', null, `✅ ${t.school} ${t.grade} ${t.termName}：スピーキング・ライティング（締切 ${md(r.deadline)}）`));
      swBox.append(el('small', 'muted', '押した時点で保存します。🤖＝テスト教室で合格して自動で✅（押すと外せます）。'));
      const tb = el('table', 'logs pp-sw-grid'); const h = el('tr'); h.append(el('th', null, '生徒'));
      r.test.speaking.forEach(u => h.append(el('th', null, `🗣${u}`))); r.test.writing.forEach(u => h.append(el('th', null, `✍️${u}`))); tb.append(h);
      for (const s of r.students) {
        const tr = el('tr'); tr.append(el('td', null, s.name));
        for (const u of [...s.speaking, ...s.writing]) {
          const c = el('td'); const b = el('button', 'pp-cell' + (u.done ? ' done' : '') + (u.late ? ' late' : ''), u.done ? (u.by === 'app' ? '✅🤖' : '✅') : '□'); b.type = 'button';
          b.onclick = async () => { try { await api('POST', '/api/prep/check', { userId: s.id, grade: t.grade, term: t.term, start: t.start, item: u.key, state: !u.done }); swTable(t); } catch (e) { toast(e.message); } };
          c.append(b); tr.append(c);
        }
        tb.append(tr);
      }
      if (!r.students.length) { const tr = el('tr'); const c = el('td', 'empty', 'この学校・学年の生徒がいません（「👥 ユーザー」で学校名を入れてください）'); c.colSpan = 1 + r.test.speaking.length + r.test.writing.length; tr.append(c); tb.append(tr); }
      const w = el('div', 'table-wrap'); w.append(tb); swBox.append(w);
      swBox.scrollIntoView({ behavior: 'smooth' });
    }

    // ── ③ スケジュールのひな形 ──
    const ts = section('🗓 対策スケジュールのひな形', '1行に「いつ｜教科｜やること」。「いつ」は「5週間前」「10日前」「前日」のように書きます。区切りは「｜」「|」タブのどれでもOK。それぞれの期間は、その段階の開始日から次の段階の開始日の前日までです。');
    const ta = el('textarea', 'gb-out'); ta.rows = 16; ta.value = d.template;
    const tsave = el('button', 'btn', '保存する'); tsave.type = 'button';
    const treset = el('button', 'btn secondary', 'はじめの内容にもどす'); treset.type = 'button';
    tsave.onclick = async () => { try { await api('PUT', '/api/admin/prep/template', { text: ta.value }); toast('保存しました'); reload(); } catch (e) { toast(e.message); } };
    treset.onclick = () => { if (confirm('はじめの内容にもどしますか？（「保存する」を押すまでは変わりません）')) ta.value = d.defaultTemplate; };
    const tr2 = el('div', 'gb-row'); tr2.append(tsave, treset);
    ts.append(ta, tr2, el('small', 'muted', '行の文を変えると、その行の✅は新しい行としてやり直しになります。'));
  }
  window.AdminPrep = { load };
})();
