// 📋 テスト対策の画面（生徒・保護者は見るだけ／先生・オーナーは✅をつけられる）
// Prep.mount(box, { api, toast, userId?, onChange? })
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const mdw = (d) => `${md(d)}(${WD[new Date(d + 'T00:00:00Z').getUTCDay()]})`;
  const period = (s, e) => s === e ? mdw(s) : `${mdw(s)}〜${mdw(e)}`;

  function mount(box, { api, toast, userId, onChange }) {
    let d = null;
    const q = userId ? `?userId=${userId}` : '';
    async function load() {
      try { d = await api('GET', '/api/prep' + q); } catch (e) { box.textContent = e.message; return; }
      render();
    }
    async function check(item, state) {
      try {
        await api('POST', '/api/prep/check', { userId: d.student.id, grade: d.test.grade, term: d.test.term, start: d.test.start, item, state });
        await load(); if (onChange) onChange();
      } catch (e) { toast(e.message); }
    }
    function render() {
      box.textContent = ''; box.classList.add('pp-root');
      if (d.notTarget) { box.append(el('p', 'muted', 'テスト対策は中学生の機能です。')); return; }
      const t = d.test;
      if (!t) {
        box.append(el('p', 'muted', d.needDate
          ? 'テストの日がまだ入っていません。塾で学校の日程を入れると、自動で出ます（学校の日程がないときは、「📊 成績」→「📝 定期テスト」→「📅 テストの日」で自分で入れられます）。'
          : 'まだ次のテストの日程がありません。'));
        return;
      }
      // 見出し
      const head = el('div', 'pp-head');
      head.append(el('h3', null, `📋 ${t.termName}テスト（${t.end ? period(t.start, t.end) : mdw(t.start)}）`));
      head.append(el('span', 'pp-src', t.source === 'juku' ? '（塾で設定）' : '（自分で入力）'));
      box.append(head);
      if (!t.active) { box.append(el('p', 'muted', `テストまで あと${t.daysLeft}日。テスト対策のスケジュールは、5週間前から出ます。`)); return; }
      const c = d.counts;
      const sum = el('div', 'pp-sum');
      sum.append(el('b', null, t.daysLeft > 0 ? `あと${t.daysLeft}日` : t.daysLeft === 0 ? '今日からテスト！' : 'テスト中'));
      sum.append(el('span', null, `進み ${c.done}/${c.total}`));
      if (c.late) sum.append(el('span', 'pp-late-n', `⚠️ 遅れ ${c.late}`));
      const bar = el('div', 'pp-bar'); const fill = el('i'); fill.style.width = (c.total ? Math.round(c.done / c.total * 100) : 0) + '%'; bar.append(fill);
      box.append(sum, bar);
      if (!d.canCheck) box.append(el('p', 'pp-note', '✅は先生がつけます'));
      // 🗣 スピーキング・ライティング
      const sw = d.sw;
      if (sw.speaking.length || sw.writing.length) {
        const s = el('section', 'pp-stage pp-sw');
        const lateSw = [...sw.speaking, ...sw.writing].some(x => x.late);
        s.append(el('h4', null, `🗣 スピーキング・ライティング（締切 ${mdw(sw.deadline)}）`));
        for (const [kind, name] of [['speaking', 'スピーキング'], ['writing', 'ライティング']]) {
          const list = sw[kind]; if (!list.length) continue;
          const row = el('div', 'pp-sw-row');
          row.append(el('b', null, `${name} ${list.filter(x => x.done).length}/${list.length}`));
          const units = el('div', 'pp-units');
          for (const u of list) {
            const b = el(d.canCheck ? 'button' : 'span', 'pp-unit' + (u.done ? ' done' : '') + (u.late ? ' late' : ''));
            b.append(el('span', 'pp-box', u.done ? '✅' : '□'), document.createTextNode(u.name));
            if (u.by === 'app') { b.append(el('small', null, ` 🤖${u.auto && u.auto.score != null ? u.auto.score + '点' : ''}`)); b.title = 'テスト教室で合格（アプリが自動で✅）'; }
            if (d.canCheck) { b.type = 'button'; b.onclick = () => check(u.key, !u.done); }
            units.append(b);
          }
          row.append(units); s.append(row);
        }
        if (lateSw) s.append(el('p', 'pp-late-msg', '締切をすぎたLessonがあります'));
        if ([...sw.speaking, ...sw.writing].some(x => x.by === 'app')) s.append(el('p', 'pp-hint', '🤖＝テスト教室で合格したので、アプリが自動で✅をつけました'));
        box.append(s);
      }
      // 段階ごと
      for (const sg of d.stages) {
        const s = el('section', 'pp-stage' + (sg.now ? ' now' : '') + (sg.past ? ' past' : ''));
        const h = el('h4'); h.append(document.createTextNode(`${sg.when}`), el('small', null, ` ${period(sg.start, sg.end)}`));
        if (sg.now) h.append(el('span', 'pp-now', '今ここ'));
        s.append(h);
        for (const it of sg.items) {
          const r = el(d.canCheck ? 'button' : 'div', 'pp-item ' + it.status);
          r.append(el('span', 'pp-box', it.done ? '✅' : '□'), el('span', 'pp-subj', it.subject));
          const tx = el('span', 'pp-task', it.task); if (it.range) tx.append(el('small', null, `📖 ${it.range}`));
          r.append(tx);
          if (it.status === 'late') r.append(el('span', 'pp-tag', '期限すぎ'));
          if (d.canCheck) { r.type = 'button'; r.onclick = () => check(it.key, !it.done); }
          s.append(r);
        }
        box.append(s);
      }
      if (t.ranges && Object.keys(t.ranges).length) {
        const rr = el('section', 'pp-stage'); rr.append(el('h4', null, '📖 テスト範囲'));
        for (const [k, v] of Object.entries(t.ranges)) rr.append(el('p', null, `${k}：${v}`));
        box.append(rr);
      }
    }
    box.textContent = '読みこみ中…';
    load();
    return { reload: load };
  }
  window.Prep = { mount };
})();
