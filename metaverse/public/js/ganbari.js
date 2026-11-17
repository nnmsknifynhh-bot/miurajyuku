// がんばり（画面）：ポイントと着せかえ・今学期の目標・学年の木
(function () {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hm = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}時間${m ? m + '分' : ''}` : `${m}分`; };
  const fmt = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

  function create({ api, toast, getState }) {
    const g = { forest: null, me: null, shopSlot: 'head' };

    async function refreshForest() {
      try { g.forest = await api('GET', '/api/forest'); } catch (e) { /* 次の機会に */ }
      return g.forest;
    }

    // ── ポイントと着せかえ ──
    async function openShop() {
      try { g.me = await api('GET', '/api/me/ganbari'); } catch (e) { return toast(e.message); }
      renderShop();
      $('#shop-dialog').showModal();
    }
    function renderShop() {
      const me = g.me;
      $('#shop-points').textContent = me.points.balance;
      $('#shop-sub').textContent = `今日 ${hm(me.todayMinutes)}・今学期 ${hm(me.termMinutes)}・${me.rules.minutesPerPoint}分で1ポイント` + (me.streak >= 1 ? `・🔥${me.streak}日連続` : '');
      document.querySelectorAll('#shop-tabs button').forEach(b => b.classList.toggle('on', b.dataset.slot === g.shopSlot));
      // 着せかえ期間の外は、見る・買う・着ることができない
      const open = me.dressup.open;
      const closed = $('#shop-closed');
      closed.hidden = open;
      if (!open) closed.textContent = '🔒 今は着せかえ期間ではありません。' + (me.dressup.next ? `次は ${fmt(me.dressup.next.start)}〜${fmt(me.dressup.next.end)}${me.dressup.next.name ? '（' + me.dressup.next.name + '）' : ''} です。` : 'ポイントはそのままたまります。');
      else if (me.dressup.now) { closed.hidden = false; closed.textContent = `✨ 着せかえ期間中（〜${fmt(me.dressup.now.end)}まで）`; }
      const box = $('#shop-items'); box.textContent = '';
      const equippedId = me.myItems ? me.myItems[g.shopSlot] : null;
      for (const it of me.shop.filter(i => i.slot === g.shopSlot && (i.available || i.owned))) {
        const card = el('div', 'shop-item' + (it.id === equippedId ? ' on' : ''));
        card.append(el('div', 'emoji', it.emoji), el('div', 'nm', it.name));
        if (it.limited) card.append(el('div', 'lim', '期間限定'));
        let b;
        if (it.owned) {
          b = el('button', 'btn small' + (it.id === equippedId ? ' secondary' : ''), it.id === equippedId ? 'はずす' : 'つける');
          b.disabled = !open;
          b.onclick = () => doEquip(it.id === equippedId ? null : it.id);
        } else {
          b = el('button', 'btn small' + (me.points.balance < it.price ? ' secondary' : ''), `${it.price}pt`);
          b.disabled = !open || me.points.balance < it.price;
          b.onclick = () => doBuy(it);
        }
        card.append(b);
        box.append(card);
      }
    }
    async function doBuy(it) {
      if (!confirm(`${it.emoji} ${it.name} を ${it.price} ポイントで買いますか？`)) return;
      try { await api('POST', '/api/me/shop/buy', { item: it.id }); toast(`${it.emoji} ${it.name} を手に入れた！`); g.me = await api('GET', '/api/me/ganbari'); renderShop(); }
      catch (e) { toast(e.message); }
    }
    async function doEquip(itemId) {
      try { await api('POST', '/api/me/equip', { slot: g.shopSlot, item: itemId }); g.me = await api('GET', '/api/me/ganbari'); renderShop(); }
      catch (e) { toast(e.message); }
    }
    document.querySelectorAll('#shop-tabs button').forEach(b => b.onclick = () => { g.shopSlot = b.dataset.slot; renderShop(); });
    $('#shop-close').onclick = () => $('#shop-dialog').close();

    // ── 今学期の目標 ──
    async function openGoal() {
      try { g.me = await api('GET', '/api/me/ganbari'); } catch (e) { return toast(e.message); }
      const goal = g.me.goal;
      $('#goal-term').textContent = g.me.term ? `${g.me.term.name}（〜${g.me.term.end.slice(5).replace('-', '/')}）` : '';
      $('#goal-input').value = goal ? goal.text : '';
      const st = $('#goal-status');
      st.textContent = !goal ? '目標を書くと、先生が確認してから「学年の木」に短冊として飾られます。'
        : goal.achieved ? '⭐ 達成！ 木の短冊が星になりました。'
        : goal.status === 'approved' ? '🎋 木に飾られています。達成したら先生が星にしてくれます。'
        : goal.status === 'rejected' ? 'もう一度考えて書き直してね（先生が確認できませんでした）。'
        : '⏳ 先生の確認待ちです。';
      $('#goal-input').disabled = !!(goal && goal.achieved);
      $('#goal-save').hidden = !!(goal && goal.achieved);
      $('#goal-dialog').showModal();
    }
    $('#goal-cancel').onclick = () => $('#goal-dialog').close();
    $('#goal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/me/goal', { text: $('#goal-input').value }); toast('目標を出しました。先生が確認すると、木に飾られます'); $('#goal-dialog').close(); }
      catch (err) { toast(err.message); }
    });

    // ── 学年の木 ──
    async function openForest(index) {
      await refreshForest();
      const f = g.forest;
      if (!f) return;
      const box = $('#forest-body'); box.textContent = '';
      $('#forest-term').textContent = f.term ? `${f.term.name}（${f.term.start.slice(5).replace('-', '/')}〜${f.term.end.slice(5).replace('-', '/')}）の平均自習時間で育ちます` : '今は学期の期間ではありません';
      const st = getState();
      const myGrade = st.user && st.user.grade;
      f.trees.forEach((t, i) => {
        const card = el('div', 'tree-card' + (i === index ? ' focus' : '') + (t.grades.includes(myGrade) ? ' mine' : ''));
        const cv = el('canvas'); cv.width = 120; cv.height = 130;
        const c = cv.getContext('2d');
        window.Render.drawTree(c, 60, 104, t, { time: performance.now() / 1000, label: false });
        const info = el('div');
        info.append(el('b', null, t.name + (t.grades.includes(myGrade) ? '（あなたの学年）' : '')));
        info.append(el('div', 'big', `1人あたり ${hm(t.avgMinutes)}`));
        info.append(el('div', 'muted', `いまは「${t.stageName}」` + (t.nextHours != null ? `・あと${Math.max(0, Math.ceil(t.nextHours * 60 - t.avgMinutes))}分で次の段階` : '・いちばん大きく育ちました！')));
        if (t.goals.length) {
          const ul = el('ul', 'goal-list');
          for (const gl of t.goals) ul.append(el('li', null, `${gl.achieved ? '⭐' : '🎋'} ${gl.name}：${gl.text}`));
          info.append(ul);
        } else info.append(el('div', 'muted', 'まだ短冊はありません'));
        card.append(cv, info);
        box.append(card);
      });
      $('#forest-dialog').showModal();
      if (index != null) setTimeout(() => box.children[index] && box.children[index].scrollIntoView({ block: 'nearest' }), 50);
    }
    $('#forest-close').onclick = () => $('#forest-dialog').close();

    return { refreshForest, openShop, openGoal, openForest, get forest() { return g.forest; } };
  }

  window.GanbariUI = { create };
})();
