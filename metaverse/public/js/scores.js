// 📊 成績（定期テスト・内申・模試）の画面。生徒・保護者・先生（管理画面）で同じものを使う
// Scores.mount(box, { api, toast, userId? }) … userId がなければ自分の成績
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const KINDS = [['teiki', '📝 定期テスト'], ['naishin', '📒 内申'], ['moshi', '📈 模試']];
  const TEIKI = [['1mid', '1学期中間'], ['1end', '1学期期末'], ['2mid', '2学期中間'], ['2end', '2学期期末'], ['final', '学年末']];
  const NAISHIN = [['1', '1学期'], ['2', '2学期'], ['3', '3学期']];
  const SHORT = { '1mid': '1中間', '1end': '1期末', '2mid': '2中間', '2end': '2期末', final: '学年末', 1: '1学期', 2: '2学期', 3: '3学期' };
  const FIVE = ['国語', '数学', '英語', '理科', '社会'];
  const SUB4 = ['音楽', '美術', '保健体育', '技術家庭'];
  const NINE = ['国語', '社会', '数学', '理科', '英語', ...SUB4];
  const isJH = (g) => /^中/.test(g || '');
  const GRADES_JHHS = /^[中高][1-3]$/;
  // 志望校の判定の表示（例：〇〇高校 A判定（80%））
  const judgeText = (j) => `${j.school} ${j.judge ? `${j.judge}判定${j.pct != null ? `（${j.pct}%）` : ''}` : j.below != null ? `判定なし（${j.below}%未満）` : '–'}${j.naishin ? '〔内申込み〕' : ''}`;
  // 換算内申（東京都：5教科はそのまま＋実技4教科は2倍。65点満点）。9教科そろっているときだけ
  const kansanOf = (rec) => {
    if (!rec) return null;
    const v = (n) => { const x = (rec.subjects || []).find(s => s.name === n); return x && x.value != null ? Number(x.value) : null; };
    const all = NINE.map(v); if (all.some(x => x == null)) return null;
    return all.slice(0, 5).reduce((a, b) => a + b, 0) + all.slice(5).reduce((a, b) => a + b, 0) * 2;
  };
  // 合計の偏差値から判定（サーバーと同じ決め方。入れている途中に見せる）
  function judgeOf(type, school, dev, kansan) {
    const sc = type && type.schools.find(x => x.name === school);
    if (!sc) return null;
    if (dev == null || dev === '' || !Number.isFinite(Number(dev))) return { school, judge: null, pct: null };
    const rate = type.naishinRate == null ? 0.5 : type.naishinRate;
    const k = kansan === '' || kansan == null || !Number.isFinite(Number(kansan)) ? null : Number(kansan);
    const useN = k != null && sc.naishin != null && rate > 0;
    const eff = useN ? Math.round((Number(dev) + (k - sc.naishin) * rate) * 10) / 10 : Number(dev);
    const extra = useN ? { naishin: true, effDev: eff } : {};
    for (const l of type.levels) { const t = sc.devs[l.name]; if (t != null && eff >= t) return { school, judge: l.name, pct: l.pct, ...extra }; }
    const last = type.levels[type.levels.length - 1];
    return { school, judge: null, pct: null, below: last ? last.pct : null, ...extra };
  }
  const fmt = (n) => n == null ? '–' : String(n);
  const diffEl = (cur, prev) => {
    if (cur == null || prev == null) return null;
    const d = Math.round((cur - prev) * 10) / 10;
    return el('small', d > 0 ? 'sr-up' : d < 0 ? 'sr-down' : 'sr-same', d > 0 ? `↑${d}` : d < 0 ? `↓${-d}` : '→');
  };
  const titleOf = (r) => r.kind === 'moshi' ? `${r.past ? '📚 過去問 ' : ''}${r.title}${r.takenOn ? `（${Number(r.takenOn.slice(5, 7))}/${Number(r.takenOn.slice(8))}）` : ''}` : `${r.grade} ${r.termName}${r.kind === 'naishin' ? 'の内申' : ''}`;

  // 折れ線グラフ（SVG）。points: [{ label, v }]
  function chart(points, { label, min, max, invert } = {}) {
    const ps = points.filter(p => p.v != null);
    if (ps.length < 2) return null;
    const W = 320, H = 140, L = 34, R = 10, T = 14, B = 34;
    const lo = min != null ? min : Math.min(...ps.map(p => p.v)), hi = max != null ? max : Math.max(...ps.map(p => p.v));
    const span = hi - lo || 1;
    const xs = (i) => L + (W - L - R) * (ps.length === 1 ? 0.5 : i / (ps.length - 1));
    const ys = (v) => T + (H - T - B) * (1 - (v - lo) / span);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'sr-chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label || 'グラフ');
    const mk = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
    for (const v of [lo, (lo + hi) / 2, hi]) { mk('line', { x1: L, x2: W - R, y1: ys(v), y2: ys(v), class: 'sr-grid' }); const t = mk('text', { x: L - 4, y: ys(v) + 3, class: 'sr-ax', 'text-anchor': 'end' }); t.textContent = Math.round(v); }
    mk('polyline', { points: ps.map((p, i) => `${xs(i)},${ys(p.v)}`).join(' '), class: 'sr-line' });
    ps.forEach((p, i) => {
      mk('circle', { cx: xs(i), cy: ys(p.v), r: 3.5, class: 'sr-dot' });
      const v = mk('text', { x: xs(i), y: ys(p.v) - 6, class: 'sr-val', 'text-anchor': 'middle' }); v.textContent = p.v;
      if (ps.length <= 8 || i % Math.ceil(ps.length / 8) === 0 || i === ps.length - 1) { const t = mk('text', { x: xs(i), y: H - 18, class: 'sr-ax', 'text-anchor': 'middle' }); t.textContent = p.label; }
      if (p.group && (i === 0 || ps[i - 1].group !== p.group)) { const t = mk('text', { x: xs(i), y: H - 5, class: 'sr-ax sr-ax-g', 'text-anchor': 'middle' }); t.textContent = p.group; }
    });
    return svg;
  }

  function mount(box, { api, toast, userId }) {
    let data = null, tab = 'teiki', showPast = true, editing = null;
    const q = userId ? `?userId=${userId}` : '';
    async function load() {
      try { data = await api('GET', '/api/scores' + q); } catch (e) { box.textContent = e.message; return; }
      render();
    }
    function render() {
      box.textContent = '';
      box.classList.add('sr-root');
      const tabs = el('div', 'sr-tabs');
      for (const [k, name] of KINDS) {
        const n = data.records.filter(r => r.kind === k).length;
        const b = el('button', 'sr-tab' + (tab === k ? ' active' : ''), name + (n ? ` (${n})` : '')); b.type = 'button';
        b.onclick = () => { tab = k; editing = null; render(); };
        tabs.append(b);
      }
      box.append(tabs);
      if (editing) { box.append(form(editing)); return; }
      const recs = data.records.filter(r => r.kind === tab && (tab !== 'moshi' || showPast || !r.past));
      if (data.canEdit) {
        const add = el('button', 'btn small', tab === 'teiki' ? '＋ 定期テストを入れる' : tab === 'naishin' ? '＋ 内申を入れる' : '＋ 模試を入れる'); add.type = 'button';
        add.onclick = () => { editing = { kind: tab }; render(); };
        box.append(add);
      }
      if (tab === 'teiki' && GRADES_JHHS.test(data.student.grade || '')) box.append(datesPanel());
      if (tab === 'moshi' && data.records.some(r => r.kind === 'moshi' && r.past)) {
        const l = el('label', 'sr-check'); const c = el('input'); c.type = 'checkbox'; c.checked = showPast; c.onchange = () => { showPast = c.checked; render(); };
        l.append(c, document.createTextNode(' 過去問も表示する')); box.append(l);
      }
      if (!recs.length) { box.append(el('p', 'muted', data.canEdit ? 'まだありません。上のボタンから入れてね。' : 'まだ入っていません。')); return; }
      // グラフ
      const real = tab === 'moshi' ? recs.filter(r => !r.past) : recs;
      const g = tab === 'moshi'
        ? chart(real.map(r => ({ label: (r.takenOn || '').slice(5).replace('-', '/') || r.title.slice(0, 4), group: r.grade, v: r.totalDev })), { label: '模試の偏差値', min: 30, max: 75 })
        : chart(recs.map(r => ({ label: SHORT[r.term] || r.term, group: r.grade, v: tab === 'naishin' && !isJH(r.grade) ? r.sum.average : r.sum.total })), { label: tab === 'naishin' ? '内申の合計' : '定期テストの合計' });
      if (g) { const w = el('div', 'sr-chart-wrap'); w.append(el('b', null, tab === 'moshi' ? '📈 偏差値（合計）の変化（本番の模試）' : tab === 'naishin' ? '📈 内申の変化' : '📈 合計点の変化')); w.append(g); box.append(w); }
      // 新しいものが上
      const prevOf = (r) => { const i = recs.indexOf(r); for (let k = i - 1; k >= 0; k--) if (recs[k].kind === r.kind && (r.kind !== 'moshi' || recs[k].past === r.past)) return recs[k]; return null; };
      for (const r of [...recs].reverse()) box.append(card(r, prevOf(r)));
    }
    // 📅 テストの日（今の学年）：入れておくと、左上に「あと○日」が出る。終わって2週間たっても成績がないと「入れてね」
    function datesPanel() {
      const g = data.student.grade, dates = data.testDates || [];
      const p = el('details', 'sr-dates');
      const next = dates.filter(d => d.grade === g && (d.end || d.start) >= new Date().toISOString().slice(0, 10))[0];
      p.open = data.canEdit && !dates.some(d => d.grade === g);
      p.append(el('summary', null, `📅 テストの日（${g}）${next ? `：次は ${next.termName}（${Number(next.start.slice(5, 7))}/${Number(next.start.slice(8))}〜）` : ''}`));
      if (data.canEdit) p.append(el('small', 'muted', '学校のテストの日を入れておくと、画面の左上に「〇〇まであと○日」が出ます。テストが終わって2週間たっても成績を入れていないと、「成績を入れてね」と出ます。'));
      for (const [term, name] of TEIKI) {
        const d = dates.find(x => x.grade === g && x.term === term) || {};
        const row = el('div', 'gb-row sr-date-row');
        row.append(el('b', null, name));
        if (!data.canEdit) { row.append(el('span', null, d.start ? `${d.start.slice(5).replace('-', '/')}${d.end ? `〜${d.end.slice(5).replace('-', '/')}` : ''}` : '–')); p.append(row); continue; }
        const s = el('input'); s.type = 'date'; s.value = d.start || ''; s.setAttribute('aria-label', name + 'のはじめの日');
        const e = el('input'); e.type = 'date'; e.value = d.end || ''; e.setAttribute('aria-label', name + 'の最後の日');
        const sv = el('button', 'btn small', '保存'); sv.type = 'button';
        sv.onclick = async () => {
          try { await api('PUT', '/api/scores/test-date', { ...(userId ? { userId } : {}), grade: g, term, start: s.value || null, end: e.value || null }); toast(s.value ? `${name}の日を保存しました` : `${name}の日を消しました`); if (window.Scores.onChange) window.Scores.onChange(); load(); }
          catch (er) { toast(er.message); }
        };
        row.append(s, el('span', null, '〜'), e, sv); p.append(row);
      }
      if (data.canEdit) p.append(el('small', 'muted', '1日だけのテストは、右の日付は空のままでOK。ない学校のテスト（1学期中間など）は空のままにしてください。'));
      return p;
    }
    function card(r, prev) {
      const c = el('div', 'sr-card');
      const h = el('div', 'sr-head');
      h.append(el('b', null, titleOf(r)));
      h.append(el('span', 'sr-badge ' + (r.confirmed ? 'ok' : 'wait'), r.confirmed ? '✅ 先生確認ずみ' : '⏳ 確認まち'));
      c.append(h);
      const t = el('table', 'sr-table');
      const head = el('tr'); head.append(el('th', null, '教科'));
      const cols = r.kind === 'naishin' ? ['内申'] : r.kind === 'teiki' ? ['点数', '平均'] : ['点数', '偏差値'];
      cols.forEach(x => head.append(el('th', 'num', x))); t.append(head);
      const pmap = new Map(((prev && prev.subjects) || []).map(s => [s.name, s]));
      for (const s of r.subjects) {
        const tr = el('tr'); tr.append(el('td', null, s.name));
        const p = pmap.get(s.name);
        if (r.kind === 'naishin') { const td = el('td', 'num', fmt(s.value)); const d = diffEl(s.value, p && p.value); if (d) td.append(' ', d); tr.append(td); }
        else {
          const td = el('td', 'num', fmt(s.score) + (s.max && s.max !== 100 ? `/${s.max}` : '')); const d = diffEl(s.score, p && p.score); if (d) td.append(' ', d); tr.append(td);
          tr.append(el('td', 'num', r.kind === 'teiki' ? fmt(s.avg) : fmt(s.dev)));
        }
        t.append(tr);
      }
      const ps = prev && prev.sum;
      const foot = el('tr', 'sr-total'); foot.append(el('td', null, r.kind === 'naishin' ? '合計' : '合計'));
      const tt = el('td', 'num', fmt(r.sum.total) + (r.kind !== 'naishin' && r.sum.totalMax ? `/${r.sum.totalMax}` : '')); const dd = diffEl(r.sum.total, ps && ps.total); if (dd) tt.append(' ', dd); foot.append(tt);
      foot.append(el('td', 'num', r.kind === 'moshi' ? fmt(r.totalDev) : r.kind === 'teiki' ? (r.rank ? `${r.rank}位${r.rankOf ? `/${r.rankOf}人` : ''}` : '') : ''));
      t.append(foot); c.append(t);
      if (r.kind === 'naishin') c.append(el('p', 'sr-sub', isJH(r.grade) ? `5教科 ${fmt(r.sum.total5)}・9教科 ${fmt(r.sum.total)}` : `評定平均 ${fmt(r.sum.average)}`));
      if (r.kind === 'moshi' && r.judges && r.judges.length) c.append(el('p', 'sr-sub', '🏫 ' + r.judges.map(judgeText).join('・')));
      const acts = el('div', 'sr-acts');
      if (data.canEdit) {
        const e = el('button', 'btn small secondary', '直す'); e.type = 'button'; e.onclick = () => { editing = r; render(); };
        const d = el('button', 'btn small danger', '消す'); d.type = 'button';
        let armed = false;
        d.onclick = async () => { if (!armed) { armed = true; d.textContent = 'もう一度押すと消えます'; setTimeout(() => { armed = false; d.textContent = '消す'; }, 4000); return; } try { await api('DELETE', `/api/scores/${r.id}`); toast('消しました'); load(); } catch (er) { toast(er.message); } };
        acts.append(e, d);
      }
      if (data.canConfirm) {
        const b = el('button', 'btn small' + (r.confirmed ? ' secondary' : ''), r.confirmed ? '確認をはずす' : '✅ 確認した'); b.type = 'button';
        b.onclick = async () => { try { await api('POST', `/api/scores/${r.id}/confirm`, { confirmed: !r.confirmed }); load(); } catch (er) { toast(er.message); } };
        acts.append(b);
      }
      if (acts.children.length) c.append(acts);
      return c;
    }
    // 入れる・直す
    function form(r) {
      const kind = r.kind, f = el('form', 'sr-form');
      const grades = data.grades, g0 = r.grade || (grades.includes(data.student.grade) ? data.student.grade : grades[0]);
      const row = el('div', 'gb-row');
      const gs = el('select'); grades.forEach(g => gs.append(new Option(g, g))); gs.value = g0;
      row.append(gs);
      let ts, title, past, day, tsel, round;
      const types = data.moshiTypes || [];
      if (kind !== 'moshi') { ts = el('select'); (kind === 'teiki' ? TEIKI : NAISHIN).forEach(([v, n]) => ts.append(new Option(n, v))); if (r.term) ts.value = r.term; row.append(ts); }
      else {
        // 模試の種類：オーナーが登録したものからえらぶ（登録がないとき・先生は「その他」で名前を入れられる）
        tsel = el('select'); tsel.append(new Option('模試をえらぶ', ''));
        types.forEach(t => tsel.append(new Option(t.name, t.id)));
        const other = !types.length || data.canConfirm;
        if (other) tsel.append(new Option('その他（名前を入れる）', '_other'));
        tsel.value = r.typeId && types.some(t => t.id === r.typeId) ? r.typeId : r.id && !r.typeId ? (other ? '_other' : '') : !types.length ? '_other' : types.length === 1 ? types[0].id : '';
        round = el('input'); round.placeholder = '何回目・何年度（例：第3回・2015年度 第1回）'; round.maxLength = 30; round.value = r.round || '';
        title = el('input'); title.placeholder = '模試の名前'; title.maxLength = 40; title.value = r.typeId ? '' : (r.title || '');
        day = el('input'); day.type = 'date'; day.value = r.takenOn || '';
        const pl = el('label', 'sr-check'); past = el('input'); past.type = 'checkbox'; past.checked = !!r.past; pl.append(past, document.createTextNode(' 📚 過去問'));
        row.append(tsel, title, round, day, pl);
      }
      f.append(el('h3', null, (r.id ? '直す：' : '入れる：') + (KINDS.find(k => k[0] === kind)[1])), row);
      // 教科（前に入れたものと同じ教科から始める）
      const last = [...data.records].reverse().find(x => x.kind === kind);
      const names = r.subjects ? r.subjects : (last ? last.subjects.map(s => ({ name: s.name, max: s.max })) : (kind === 'naishin' ? (isJH(g0) ? NINE : FIVE) : kind === 'moshi' && !isJH(g0) ? ['国語', '数学', '英語'] : FIVE).map(name => ({ name })));
      // 満点はふつう100点なので、かくしておく（「満点を変える」で出す）
      let showMax = kind !== 'naishin' && names.some(x => x.max && x.max !== 100);
      const list = el('div', 'sr-rows' + (kind === 'naishin' ? ' n' : showMax ? '' : ' nomax')), rows = [];
      const head = el('div', 'sr-row sr-row-h'); head.append(el('span', null, '教科'));
      (kind === 'naishin' ? ['内申（1〜5）'] : kind === 'teiki' ? ['点数', '平均点', '満点'] : ['点数', '偏差値', '満点']).forEach(x => head.append(el('span', x === '満点' ? 'sr-max' : null, x)));
      head.append(el('span')); list.append(head);
      const numIn = (v, ph, step = 'any') => { const i = el('input'); i.type = 'number'; i.inputMode = 'decimal'; i.step = step; i.placeholder = ph; if (v != null) i.value = v; return i; };
      function addRow(s = {}) {
        const rr = el('div', 'sr-row'); const nm = el('input'); nm.value = s.name || ''; nm.placeholder = '教科'; nm.maxLength = 12;
        const o = { nm };
        rr.append(nm);
        if (kind === 'naishin') { o.v = numIn(s.value, '4', '1'); rr.append(o.v); }
        else { o.sc = numIn(s.score, '点'); o.x = numIn(kind === 'teiki' ? s.avg : s.dev, kind === 'teiki' ? '平均' : '偏差値'); o.max = numIn(s.max && s.max !== 100 ? s.max : null, '100'); rr.append(o.sc, o.x, o.max); }
        if (o.max) o.max.classList.add('sr-max');
        const del = el('button', 'btn small secondary', '×'); del.type = 'button'; del.title = 'この教科をけす'; del.onclick = () => { rr.remove(); rows.splice(rows.indexOf(o), 1); };
        rr.append(del); list.append(rr); rows.push(o);
      }
      names.forEach(addRow);
      const more = el('div', 'gb-row');
      const plus = el('button', 'btn small secondary', '＋ 教科を足す'); plus.type = 'button'; plus.onclick = () => addRow();
      more.append(plus);
      if (kind !== 'naishin') {
        const mx = el('button', 'btn small secondary', showMax ? '満点をかくす' : '✏️ 満点を変える（100点でない教科）'); mx.type = 'button';
        mx.onclick = () => { showMax = !showMax; list.classList.toggle('nomax', !showMax); mx.textContent = showMax ? '満点をかくす' : '✏️ 満点を変える（100点でない教科）'; };
        more.append(mx);
      }
      if (kind === 'teiki') { const s4 = el('button', 'btn small secondary', '＋ 副教科（音・美・保体・技家）'); s4.type = 'button'; s4.onclick = () => SUB4.filter(n => !rows.some(o => o.nm.value === n)).forEach(name => addRow({ name })); more.append(s4); }
      f.append(list, more);
      let rank, rankOf, tdev, kansan; const judges = [];
      if (kind === 'teiki') {
        const rr = el('div', 'gb-row'); rank = numIn(r.rank, '順位', '1'); rankOf = numIn(r.rankOf, '人数', '1');
        rr.append(el('span', null, '学年順位（あれば）'), rank, el('span', null, '位 /'), rankOf, el('span', null, '人')); f.append(rr);
      }
      if (kind === 'moshi') {
        const rr = el('div', 'gb-row'); tdev = numIn(r.totalDev, '偏差値'); rr.append(el('span', null, '合計の偏差値'), tdev); f.append(rr);
        // 換算内申（入れると、内申も使って判定する）。はじめは、いちばん新しい内申から自動で入れる
        const lastN = [...data.records].reverse().find(x => x.kind === 'naishin');
        kansan = numIn(r.kansan != null ? r.kansan : r.id ? null : kansanOf(lastN), '換算内申');
        const kr = el('div', 'gb-row'); kr.append(el('span', null, '換算内申（65点満点）'), kansan, el('small', 'muted', '入れると、内申も使って判定します（空なら偏差値だけ）')); f.append(kr);
        const jbox = el('div', 'sr-judges'); f.append(jbox);
        const typeOf = () => types.find(t => t.id === tsel.value) || null;
        let picks = (r.judges || []).map(j => j.school);
        function drawJudges() {
          jbox.textContent = ''; judges.length = 0;
          const t = typeOf();
          title.hidden = tsel.value !== '_other'; round.hidden = tsel.value === '_other';
          if (tsel.value === '_other') { // 自由な名前：判定も手で入れる
            jbox.append(el('small', 'muted', '志望校の判定（3つまで）'));
            for (let i = 0; i < 3; i++) {
              const j = (r.judges || [])[i] || {};
              const jr = el('div', 'gb-row'); const sc = el('input'); sc.placeholder = `志望校${i + 1}`; sc.maxLength = 30; sc.value = j.school || '';
              const js = el('select'); ['', 'S', 'A', 'B', 'C', 'D', 'E'].forEach(x => js.append(new Option(x ? `${x}判定` : '判定', x))); js.value = j.judge || '';
              jr.append(sc, js); jbox.append(jr); judges.push([sc, js]);
            }
            return;
          }
          if (!t) return;
          if (!t.schools.length) { jbox.append(el('small', 'muted', 'この模試の志望校はまだ登録されていません（先生が登録すると、判定が自動で出ます）')); return; }
          jbox.append(el('small', 'muted', '志望校をえらぶと、合計の偏差値から判定が自動で出ます（3つまで）'));
          for (let i = 0; i < 3; i++) {
            const jr = el('div', 'gb-row');
            const sel = el('select'); sel.append(new Option(`志望校${i + 1}`, '')); t.schools.forEach(x => sel.append(new Option(x.name, x.name)));
            sel.value = t.schools.some(x => x.name === picks[i]) ? picks[i] : '';
            const out = el('b', 'sr-judge-out');
            const upd = () => { picks[i] = sel.value; const j = sel.value ? judgeOf(t, sel.value, tdev.value, kansan.value) : null; out.textContent = j ? (j.judge ? `${j.judge}判定（${j.pct}%）` : j.below != null && tdev.value ? `判定なし（${j.below}%未満）` : '合計の偏差値を入れてね') + (j.naishin && tdev.value ? `〔内申込み：偏差値${j.effDev}あつかい〕` : '') : ''; };
            sel.onchange = upd; upd(); jr.append(sel, out); jbox.append(jr); judges.push([sel, null, upd]);
          }
        }
        tsel.onchange = drawJudges;
        tdev.addEventListener('input', () => judges.forEach(x => x[2] && x[2]()));
        kansan.addEventListener('input', () => judges.forEach(x => x[2] && x[2]()));
        drawJudges();
      }
      const acts = el('div', 'gb-row');
      const save = el('button', 'btn', r.id ? '直す' : '保存する'); save.type = 'submit';
      const cancel = el('button', 'btn secondary', 'やめる'); cancel.type = 'button'; cancel.onclick = () => { editing = null; render(); };
      acts.append(save, cancel); f.append(acts);
      if (!data.canConfirm) f.append(el('small', 'muted', '保存すると、先生が確認します（直すと、もう一度確認まちになります）。'));
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const body = { kind, grade: gs.value, subjects: rows.map(o => kind === 'naishin' ? { name: o.nm.value, value: o.v.value } : { name: o.nm.value, score: o.sc.value, max: o.max.value, ...(kind === 'teiki' ? { avg: o.x.value } : { dev: o.x.value }) }) };
        if (userId) body.userId = userId;
        if (ts) body.term = ts.value;
        if (kind === 'moshi') {
          Object.assign(body, { past: past.checked, takenOn: day.value || null, totalDev: tdev.value, kansan: kansan.value });
          if (tsel.value === '_other') Object.assign(body, { title: title.value, judges: judges.map(([a, b]) => ({ school: a.value, judge: b.value })) });
          else Object.assign(body, { typeId: tsel.value, round: round.value, schools: judges.map(([a]) => a.value).filter(Boolean) });
          if (!tsel.value) { toast('模試をえらんでください'); return; }
        }
        if (kind === 'teiki') Object.assign(body, { rank: rank.value, rankOf: rankOf.value });
        save.disabled = true;
        try {
          if (r.id) await api('PATCH', `/api/scores/${r.id}`, body); else await api('POST', '/api/scores', body);
          toast(r.id ? '直しました' : '保存しました'); editing = null; await load();
        } catch (e) { toast(e.message); save.disabled = false; }
      };
      return f;
    }
    box.textContent = '読みこみ中…';
    load();
    return { reload: load };
  }
  window.Scores = { mount, chart };
})();
