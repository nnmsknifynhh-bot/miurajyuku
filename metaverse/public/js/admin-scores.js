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
  }
  window.AdminScores = { load };
})();
