// 管理画面「📈 成績」：中学生・高校生の定期テスト・内申・模試。確認まちの一覧・生徒ごとの成績・表計算ソフト用の書き出し
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const KIND = { teiki: '定期テスト', naishin: '内申', moshi: '模試' };
  const title = (r) => r.kind === 'moshi' ? `${r.past ? '過去問 ' : ''}${r.title}` : `${r.grade} ${r.termName}`;
  let gradeF = '', onlyWait = false;

  async function load(root, { api, toast }) {
    root.textContent = '';
    let d;
    try { d = await api('GET', '/api/admin/scores'); } catch (e) { return toast(e.message); }
    const sec = el('div', 'gb-sec'); root.append(sec);
    sec.append(el('h3', 'sec', '📈 成績（中学生・高校生）'));
    sec.append(el('p', 'muted', '生徒が入れた成績は「⏳ 確認まち」になります。生徒の名前を押すと、成績を見る・入れる・直す・「✅ 確認した」ができます。先生が入れたものは、はじめから確認ずみです。保護者は「わが子の様子」で見られます（入れたり直したりはできません）。'));
    const tools = el('div', 'gb-row');
    const gs = el('select'); [['', 'すべての学年'], ...['中1', '中2', '中3', '高1', '高2', '高3'].map(g => [g, g])].forEach(([v, t]) => gs.append(new Option(t, v))); gs.value = gradeF;
    const wl = el('label', 'sr-check'); const wc = el('input'); wc.type = 'checkbox'; wc.checked = onlyWait; wl.append(wc, document.createTextNode(' ⏳ 確認まちがある生徒だけ'));
    const csv = el('button', 'btn small secondary', '⬇ 表計算ソフト用（CSV）'); csv.type = 'button';
    tools.append(gs, wl, csv); sec.append(tools);
    const waitN = d.records.filter(r => !r.confirmed).length;
    sec.append(el('p', waitN ? 'sr-wait-note' : 'muted', waitN ? `⏳ 確認まち：${waitN}件` : '確認まちはありません'));
    const tw = el('div', 'table-wrap'); sec.append(tw);
    const detail = el('div', 'sr-detail'); root.append(detail);
    function table() {
      tw.textContent = '';
      const t = el('table', 'logs'); const h = el('tr'); ['学年', '名前', '記録', '確認まち', 'さいきん入った成績'].forEach(x => h.append(el('th', null, x))); t.append(h);
      const list = d.students.filter(s => (!gradeF || s.grade === gradeF) && (!onlyWait || s.unconfirmed));
      for (const s of list) {
        const tr = el('tr');
        tr.append(el('td', null, s.grade));
        const nb = el('button', 'btn small secondary', s.name); nb.type = 'button';
        nb.onclick = () => {
          detail.textContent = ''; detail.append(el('h3', 'sec', `📊 ${s.name}さん（${s.grade}）の成績`));
          const box = el('div'); detail.append(box);
          window.Scores.mount(box, { api, toast, userId: s.id });
          detail.scrollIntoView({ behavior: 'smooth' });
        };
        const td = el('td'); td.append(nb); tr.append(td);
        tr.append(el('td', null, `${s.count}件`), el('td', s.unconfirmed ? 'sr-wait-cell' : null, s.unconfirmed ? `⏳ ${s.unconfirmed}件` : '–'));
        tr.append(el('td', null, s.last ? `${KIND[s.last.kind]}：${title(s.last)}（合計 ${s.last.sum.total ?? '–'}）` : 'まだありません'));
        t.append(tr);
      }
      if (!list.length) { const tr = el('tr'); const td = el('td', 'empty', '該当する生徒がいません'); td.colSpan = 5; tr.append(td); t.append(tr); }
      tw.append(t);
    }
    gs.onchange = () => { gradeF = gs.value; table(); };
    wc.onchange = () => { onlyWait = wc.checked; table(); };
    // CSV：1行＝1つの成績（教科ごとの列）
    csv.onclick = () => {
      const subj = [...new Set(d.records.flatMap(r => r.subjects.map(s => s.name)))];
      const head = ['名前', '今の学年', '種類', 'テスト・模試', 'そのときの学年', '日付', ...subj, '合計', '順位', '偏差値（合計）', '判定', '確認'];
      const rows = d.records.filter(r => !gradeF || r.nowGrade === gradeF).map(r => {
        const m = new Map(r.subjects.map(s => [s.name, r.kind === 'naishin' ? s.value : s.score]));
        return [r.name, r.nowGrade, KIND[r.kind], r.kind === 'moshi' ? title(r) : r.termName, r.grade, r.takenOn || '', ...subj.map(n => m.get(n) ?? ''), r.sum.total ?? '', r.rank ? `${r.rank}/${r.rankOf || ''}` : '', r.totalDev ?? '', (r.judges || []).map(j => `${j.school}:${j.judge || ''}`).join(' '), r.confirmed ? '確認ずみ' : '確認まち'];
      });
      const esc = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const text = '﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
      const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `成績_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    table();
    if (d.canEditTypes) typesSection(root, d, { api, toast });
  }

  // ── 🏫 模試の種類と、志望校の判定ライン（オーナー） ──
  function typesSection(root, d, { api, toast }) {
    const sec = el('div', 'gb-sec'); root.insertBefore(sec, root.children[1] || null);
    sec.append(el('h3', 'sec', '🏫 模試の種類と、志望校の判定ライン'));
    sec.append(el('p', 'muted', 'ここで登録した模試が、生徒の画面でプルダウンに出ます。志望校ごとに「この偏差値以上なら S判定」のように入れておくと、生徒が合計の偏差値と志望校を入れたときに、判定が自動で出ます（判定は保存したときの判定ラインで決まります）。'));
    const types = JSON.parse(JSON.stringify(d.moshiTypes || []));
    const wrap = el('div'); sec.append(wrap);
    const numIn = (v, w = '64px') => { const i = el('input'); i.type = 'number'; i.step = 'any'; i.style.width = w; if (v != null) i.value = v; return i; };
    function draw() {
      wrap.textContent = '';
      types.forEach((t, ti) => {
        const box = el('details', 'sr-type'); box.open = !!t._open;
        box.ontoggle = () => { t._open = box.open; };
        box.append(el('summary', null, `📈 ${t.name || '（名前なし）'}（志望校 ${t.schools.length}校）`));
        const nr = el('div', 'gb-row'); const nm = el('input'); nm.value = t.name; nm.placeholder = '模試の名前（例：V模擬）'; nm.maxLength = 30; nm.oninput = () => { t.name = nm.value; };
        const del = el('button', 'btn small danger', 'この模試を消す'); del.type = 'button'; del.onclick = () => { if (confirm(`「${t.name}」を消しますか？（入れた成績は残ります）`)) { types.splice(ti, 1); draw(); } };
        nr.append(nm, del); box.append(nr);
        // 判定の段階
        box.append(el('b', null, '判定の段階（上から高い順）'));
        const lr = el('div', 'gb-row');
        t.levels.forEach((l, li) => {
          const n = el('input'); n.value = l.name; n.style.width = '46px'; n.maxLength = 4; n.oninput = () => { const old = l.name; l.name = n.value; t.schools.forEach(sc => { if (old in sc.devs) { sc.devs[n.value] = sc.devs[old]; delete sc.devs[old]; } }); };
          const pc = numIn(l.pct, '56px'); pc.oninput = () => { l.pct = pc.value === '' ? null : Number(pc.value); };
          const x = el('button', 'btn small secondary', '×'); x.type = 'button'; x.onclick = () => { t.levels.splice(li, 1); draw(); };
          const one = el('span', 'gb-row'); one.style.flexWrap = 'nowrap'; one.append(n, pc, el('span', null, '%'), x); lr.append(one);
        });
        const al = el('button', 'btn small secondary', '＋ 段階'); al.type = 'button'; al.onclick = () => { t.levels.push({ name: '', pct: null }); t._open = true; draw(); };
        lr.append(al); box.append(lr);
        // 換算内申の重み（内申1点＝偏差値いくつ分）
        const nr2 = el('div', 'gb-row'); const rate = numIn(t.naishinRate == null ? 0.5 : t.naishinRate, '70px'); rate.min = 0; rate.max = 5; rate.oninput = () => { t.naishinRate = rate.value === '' ? 0.5 : Number(rate.value); };
        nr2.append(el('b', null, '換算内申の重み：内申1点 ＝ 偏差値'), rate, el('small', 'muted', '分（初期0.5。0にすると内申は判定に使いません。学校の「換算内申」と生徒の換算内申の差 × この数を、偏差値に足して判定します）'));
        box.append(nr2);
        // 志望校
        box.append(el('b', null, '志望校と判定ラインの偏差値'));
        const tw = el('div', 'table-wrap'); const tb = el('table', 'logs');
        const h = el('tr'); h.append(el('th', null, '学校')); t.levels.forEach(l => h.append(el('th', null, `${l.name}（${l.pct ?? ''}%）`))); h.append(el('th', null, '換算内申'), el('th')); tb.append(h);
        t.schools.forEach((sc, si) => {
          const tr = el('tr'); const td = el('td'); const sn = el('input'); sn.value = sc.name; sn.maxLength = 30; sn.oninput = () => { sc.name = sn.value; }; td.append(sn); tr.append(td);
          t.levels.forEach(l => { const c = el('td'); const i = numIn(sc.devs[l.name]); i.oninput = () => { if (i.value === '') delete sc.devs[l.name]; else sc.devs[l.name] = Number(i.value); }; c.append(i); tr.append(c); });
          { const c = el('td'); const i = numIn(sc.naishin); i.oninput = () => { if (i.value === '') delete sc.naishin; else sc.naishin = Number(i.value); }; c.append(i); tr.append(c); }
          const c = el('td'); const x = el('button', 'btn small secondary', '×'); x.type = 'button'; x.onclick = () => { t.schools.splice(si, 1); draw(); }; c.append(x); tr.append(c);
          tb.append(tr);
        });
        tw.append(tb); box.append(tw);
        const ar = el('div', 'gb-row');
        const as = el('button', 'btn small secondary', '＋ 志望校'); as.type = 'button'; as.onclick = () => { t.schools.push({ name: '', devs: {} }); t._open = true; draw(); };
        // まとめて貼り付け（表計算ソフトから：学校名、S、A、B…の順）
        const pa = el('details'); pa.append(el('summary', null, '📋 まとめて貼り付け'));
        const ta = el('textarea', 'gb-out'); ta.rows = 5; ta.placeholder = `学校名と、判定ラインの偏差値を ${t.levels.map(l => l.name).join('・')} の順に。最後に換算内申を足してもOK（タブ区切り・カンマ区切り）\n例：〇〇高校\t65\t62\t59\t56\t53\t48`;
        const pb = el('button', 'btn small', '追加する'); pb.type = 'button';
        pb.onclick = () => {
          let n = 0;
          for (const line of ta.value.split(/\r?\n/)) {
            const cols = line.split(/\t|,/).map(x => x.trim()); if (!cols[0]) continue;
            const devs = {}; t.levels.forEach((l, i) => { const v = Number(cols[i + 1]); if (cols[i + 1] && Number.isFinite(v)) devs[l.name] = v; });
            const nv = Number(cols[t.levels.length + 1]), naishin = cols[t.levels.length + 1] && Number.isFinite(nv) ? nv : undefined;
            const ex = t.schools.find(x => x.name === cols[0]); if (ex) { ex.devs = devs; if (naishin !== undefined) ex.naishin = naishin; } else t.schools.push(naishin !== undefined ? { name: cols[0], devs, naishin } : { name: cols[0], devs }); n++;
          }
          ta.value = ''; t._open = true; draw(); toast(`${n}校を入れました（下の「保存する」で保存）`);
        };
        pa.append(ta, pb);
        ar.append(as); box.append(ar, pa);
        wrap.append(box);
      });
      const add = el('button', 'btn small secondary', '＋ 模試を追加'); add.type = 'button';
      add.onclick = () => { types.push({ name: '', levels: (d.defaultLevels || []).map(l => ({ ...l })), schools: [], _open: true }); draw(); };
      const save = el('button', 'btn', '保存する'); save.type = 'button';
      save.onclick = async () => {
        try { const r = await api('PUT', '/api/admin/moshi-types', { types: types.map(({ _open, ...t }) => t) }); toast('保存しました'); types.splice(0, types.length, ...r.types.map((t, i) => ({ ...t, _open: types[i] && types[i]._open }))); d.moshiTypes = r.types; draw(); }
        catch (e) { toast(e.message); }
      };
      const r = el('div', 'gb-row'); r.append(add, save); wrap.append(r);
    }
    draw();
  }
  window.AdminScores = { load };
})();
