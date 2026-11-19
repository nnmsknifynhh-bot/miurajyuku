// 生徒の勉強時間のくわしい内容（オーナー・先生）：管理画面の一覧、教室で生徒をタップしたときに開く
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hm = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}時間${m ? m + '分' : ''}` : `${m}分`; };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  function dialog() {
    let d = document.querySelector('#study-detail');
    if (d) return d;
    d = el('dialog', 'sd-dialog'); d.id = 'study-detail';
    const body = el('div', 'dialog-body');
    body.append(el('div', 'sd-content'));
    const act = el('div', 'dialog-actions');
    const close = el('button', 'btn', 'とじる'); close.type = 'button'; close.onclick = () => d.close();
    act.append(close); body.append(act); d.append(body);
    document.body.append(d);
    return d;
  }

  async function open(api, id) {
    const d = dialog(), box = d.querySelector('.sd-content');
    box.textContent = '読みこみ中…';
    if (!d.open) d.showModal();
    let s;
    try { s = await api('GET', `/api/admin/ganbari/students/${id}/detail`); } catch (e) { box.textContent = e.message; return; }
    box.textContent = '';
    box.append(el('h2', null, `📊 ${s.name} の勉強時間`));
    box.append(el('div', 'sd-sub', `${s.grade || '学年未設定'}・今年度 ${s.studiedDays}日 自習`));
    // 上のカード：今日・ポイント・🔥
    const cards = el('div', 'sd-cards');
    const card = (big, small) => { const c = el('div', 'sd-card'); c.append(el('b', null, big), el('small', null, small)); return c; };
    cards.append(
      card(hm(s.today.all), `今日（ポイント ${hm(s.today.point)}）`),
      card(`${s.points.balance}pt`, `持っているポイント（使った ${s.points.spent}）`),
      card(s.streak ? `🔥${s.streak}${s.hs ? '週' : '日'}` : '🔥0', s.hs ? '🥉以上の週の連続' : `1日${s.streakMin}分以上の連続`),
    );
    box.append(cards);
    // 期間ごと
    const tbl = el('table', 'sd-tbl');
    const hr = el('tr'); ['', '勉強時間（全部）', 'ポイントになる時間'].forEach(h => hr.append(el('th', null, h))); tbl.append(hr);
    const row = (name, v) => { if (!v) return; const tr = el('tr'); [name, hm(v.all), hm(v.point)].forEach(x => tr.append(el('td', null, x))); tbl.append(tr); };
    row('今日', s.today); row('今週（月曜から）', s.week); row(s.term ? `今学期（${s.term.name}）` : '今学期', s.term); row('今年度', s.year);
    box.append(tbl);
    // 高校生：週のメダル
    if (s.medal) {
      const w = s.medal.week, c = s.medal.counts;
      box.append(el('div', 'sd-sub', `🏅 今週 ${hm(w.minutes)} ${w.medal ? w.medal.icon : ''}` + (w.next ? `（${w.next.icon}まであと${hm(w.next.left)}）` : '') + `・これまで 🥇${c.gold} 🥈${c.silver} 🥉${c.bronze}`));
    }
    // 最近14日
    box.append(el('b', null, '📅 最近14日'));
    const lg = el('div', 'sd-legend');
    const i1 = el('i'); i1.style.background = '#8fd3a8'; const i2 = el('i'); i2.style.background = '#2fae74';
    lg.append(i1, document.createTextNode('勉強時間（全部）'), i2, document.createTextNode('ポイントになる時間'));
    box.append(lg);
    const bars = el('div', 'sd-bars');
    const max = Math.max(60, ...s.days.map(x => x.all));
    s.days.forEach((x, i) => {
      const b = el('div', 'sd-bar' + (i === s.days.length - 1 ? ' today' : ''));
      const dt = new Date(x.day + 'T00:00:00Z');
      b.append(el('span', null, `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}(${WD[dt.getUTCDay()]})`));
      const t = el('div', 't'), a = el('div', 'a'), p = el('div', 'p');
      a.style.width = (x.all / max * 100) + '%'; p.style.width = (x.point / max * 100) + '%';
      t.append(a, p); b.append(t, el('span', 'n', x.all ? hm(x.all) : '—'));
      bars.append(b);
    });
    box.append(bars);
  }

  window.StudyDetail = { open };
})();
