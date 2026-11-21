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
    const endVal = (i) => (i.value === '23:59' ? '24:00' : i.value);
    // 朝・夜の時間帯の入力欄（1行分）。初期値 w1 / w2（w2 が null なら夜は使わない）
    const slotInputs = (w1, w2) => {
      const s1 = timeInput(w1.start), e1 = timeInput(w1.end);
      const s2 = timeInput(w2 ? w2.start : '18:00'), e2 = timeInput(w2 ? w2.end : '22:00');
      const all = check('いつでも', w1.start === '00:00' && w1.end === '24:00' && !w2);
      const night = check('2つめ', !!w2);
      const am = el('span', 'gb-row'); am.append(el('b', 'gb-slot', '1つめ'), s1, el('span', null, '〜'), e1);
      const pm = el('span', 'gb-row'); pm.append(night[0], s2, el('span', null, '〜'), e2);
      const sync = (off) => {
        s1.disabled = e1.disabled = off || all[1].checked;
        night[1].disabled = off || all[1].checked;
        s2.disabled = e2.disabled = off || all[1].checked || !night[1].checked;
        all[1].disabled = off;
        am.hidden = pm.hidden = all[1].checked;
      };
      const value = () => all[1].checked
        ? { start: '00:00', end: '24:00', start2: null, end2: null }
        : { start: s1.value, end: endVal(e1), start2: night[1].checked ? s2.value : null, end2: night[1].checked ? endVal(e2) : null };
      return { all, night, am, pm, sync, value };
    };
    // 数える時間帯・上限・曜日ごと（中学生と高校生で別々）
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const ruleBlock = (src, title, note) => {
      const box = el('div', 'gb-box');
      box.append(el('b', null, title));
      if (note) box.append(el('p', 'muted', note));
      const common = slotInputs(src.window, src.window2);
      const syncC = () => common.sync(false);
      common.all[1].onchange = common.night[1].onchange = syncC; syncC();
      const capI = numInput(src.dailyCap, 10, 1440);
      const winRow = el('div', 'gb-slots'); winRow.append(common.all[0], common.am, common.pm);
      const winField = el('div', 'field'); winField.append(el('span', null, '数える時間帯'), winRow, el('small', null, 'ふつうは「1つめ」だけでOK。朝と夕方のように2回に分けたいときだけ「2つめ」にチェック'));
      const capField = field('1日に数える上限（分）', capI, '1日の合計（2つめもふくむ）。これをこえた分はポイントにならない（時間の記録には入る）');
      const g = el('div', 'gb-rule'); g.append(winField, capField); // 時間帯と上限は縦にならべる（重ならないように）
      const byDay = check('曜日ごとに変える（数える曜日・時間帯・上限）', Array.isArray(src.weekly));
      const wkBox = el('div', 'gb-week');
      const wkRows = WD.map((name, i) => {
        const w = (src.weekly && src.weekly[i]) || { on: true, start: src.window.start, end: src.window.end, start2: src.window2 && src.window2.start, end2: src.window2 && src.window2.end, cap: src.dailyCap };
        const row = el('div', 'gb-wd');
        const on = check(name + '曜', w.on);
        const sl = slotInputs(w, w.start2 && w.end2 ? { start: w.start2, end: w.end2 } : null);
        const cp = numInput(w.cap, 10, 1440);
        const sync = () => { const off = !on[1].checked; sl.sync(off); cp.disabled = off; row.classList.toggle('off', off); };
        on[1].onchange = sl.all[1].onchange = sl.night[1].onchange = sync; sync();
        const capL = el('span', 'gb-row'); capL.append(el('span', 'muted', '上限'), cp, el('span', 'muted', '分'));
        const head = el('div', 'gb-row'); head.append(on[0], sl.all[0], capL);
        row.append(head, sl.am, sl.pm);
        wkBox.append(row);
        return () => ({ on: on[1].checked, ...sl.value(), cap: Number(cp.value) });
      });
      const wkNote = el('p', 'muted', 'チェックをはずした曜日は自習時間を数えません。');
      // 🎌 祝日・🏖 長い休みは土曜日と同じ（曜日ごとに変えるときだけ）
      const hol = check('🎌 祝日（振替休日もふくむ）は土曜日と同じ数え方にする', src.holidaySat !== false);
      const vac = check('🏖 長い休み（下の「長い休み」で決めた期間）は土曜日と同じ数え方にする', src.vacationSat !== false);
      const offBox = el('div', 'gb-hol'); offBox.append(hol[0], vac[0], el('small', 'muted', '平日だけが土曜日の数え方になります（日曜日はそのまま）。祝日はアプリが自動でわかります。'));
      const syncWeek = () => { const w = byDay[1].checked; wkBox.hidden = wkNote.hidden = offBox.hidden = !w; winField.hidden = capField.hidden = w; };
      byDay[1].onchange = syncWeek; syncWeek();
      box.append(byDay[0], wkBox, wkNote, offBox, g);
      return {
        box,
        value: () => {
          const v = common.value();
          return { window: { start: v.start, end: v.end }, window2: v.start2 ? { start: v.start2, end: v.end2 } : null, dailyCap: Number(capI.value), weekly: byDay[1].checked ? wkRows.map(f => f()) : null, holidaySat: hol[1].checked, vacationSat: vac[1].checked };
        },
      };
    };
    const jh = ruleBlock(c, '📚 自習室（中学生など）');
    const hs = ruleBlock(c.hs, '☕ 高校生自習室（高校生）', '高校生（高1〜高3）の数え方です。中学生とは別に決められます。');
    const es = ruleBlock(c.es, '🎒 小学生自習室（小学生）', '小学生（小1〜小6）の数え方です。最初は 朝6:00〜7:30・夕方15:00〜18:00 です。');
    // 高校生の週のノルマ
    const MD = [['🥉', 'ブロンズ'], ['🥈', 'シルバー'], ['🥇', 'ゴールド']];
    const medalsCfg = c.hs.medals || [{ minutes: 240, points: 10 }, { minutes: 360, points: 20 }, { minutes: 540, points: 30 }];
    const medalInputs = medalsCfg.map(m => [numInput(m.minutes, 10, 10080), numInput(m.points, 0, 1000)]);
    const hsLate = numInput(c.hs.lateMinutes, 1, 240);
    const hg = el('div', 'gb-grid');
    medalInputs.forEach(([mi, pi], i) => hg.append(field(`${MD[i][0]} ${MD[i][1]}：週の合計（分）`, mi, `例：${medalsCfg[i].minutes} = ${medalsCfg[i].minutes / 60}時間`), field(`${MD[i][0]} のボーナス（ポイント）`, pi, 'その週にとった、いちばん上のメダルの分だけふえます')));
    hg.append(field('来ていない通知（予定の何分後）', hsLate, '来る曜日と時刻は「ユーザー」の生徒の編集で決めます'));
    hs.box.append(el('b', null, '🏅 週のメダル'), hg, el('p', 'muted', '月曜〜日曜の勉強時間（全部）の合計でメダルが決まります。高校生の連続🔥は「🥉以上をとった週」が続いた数です（例：🔥3週）。保護者会の日は2時間分に数えます。'));

    const streakMin = numInput(c.streakMin, 1, 600), mpp = numInput(c.minutesPerPoint, 1, 120);
    const seat = check('席に座っているときだけ数える', c.requireSeat), cam = check('見守り写真がオンのときは、カメラがオンのときだけ数える', c.requireCamera);
    const grid = el('div', 'gb-grid');
    grid.append(field('何分で1ポイント', mpp, '中学生・高校生共通'), field('連続自習🔥の最低時間（分）：下の学年以外', streakMin, '例：小学生'));
    // 連続自習🔥の最低時間（学年別）
    const SG = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3'];
    const sgInputs = SG.map(g => [g, numInput((c.streakByGrade || {})[g] || c.streakMin, 1, 600)]);
    const sgBox = el('div', 'field');
    const sgRow = el('div', 'gb-row');
    sgInputs.forEach(([g, i]) => { i.style.width = '72px'; const one = el('span', 'gb-row'); one.style.flexWrap = 'nowrap'; one.append(el('span', null, g), i, el('span', 'muted', '分')); sgRow.append(one); });
    sgBox.append(el('span', null, '連続自習🔥の1日の最低時間（学年別）'), sgRow, el('small', null, 'この時間より多く自習した日が続くと🔥がふえます'));
    // 🏖 長い休み（中・高・小で共通。「土曜日と同じ」にチェックした学年だけに使う）
    const vacBox = el('div', 'gb-box');
    vacBox.append(el('b', null, '🏖 長い休み（夏休み・冬休み・春休み）'), el('p', 'muted', 'この期間の平日は、上で「🏖 長い休みは土曜日と同じ」にチェックした学年だけ、土曜日の数え方になります。学校ごとにちがうので、だいたいの期間で入れてください。'));
    const vacList = el('div', 'gb-vacs');
    const vacRows = [];
    const addVac = (v) => {
      const row = el('div', 'gb-row');
      const nm = el('input'); nm.value = v.name || ''; nm.placeholder = '名前（例：夏休み）'; nm.maxLength = 20; nm.style.width = '9em';
      const st = dateInput(v.start || ''), en = dateInput(v.end || '');
      const del = el('button', 'btn small secondary', '消す'); del.type = 'button';
      const item = { nm, st, en };
      del.onclick = () => { row.remove(); vacRows.splice(vacRows.indexOf(item), 1); };
      row.append(nm, st, el('span', null, '〜'), en, del); vacList.append(row); vacRows.push(item);
    };
    (c.vacations || []).forEach(addVac);
    const addVacBtn = el('button', 'btn small secondary', '＋ 休みを足す'); addVacBtn.type = 'button';
    addVacBtn.onclick = () => addVac({ name: ['夏休み', '冬休み', '春休み'][vacRows.length % 3] });
    vacBox.append(vacList, addVacBtn);
    const saveRule = el('button', 'btn', '保存する');
    saveRule.onclick = () => {
      const y = window.scrollY;
      return save({
        ...jh.value(),
        streakMin: Number(streakMin.value), minutesPerPoint: Number(mpp.value),
        streakByGrade: { ...(c.streakByGrade || {}), ...Object.fromEntries(sgInputs.map(([g, i]) => [g, Number(i.value)])) },
        requireSeat: seat[1].checked, requireCamera: cam[1].checked,
        es: es.value(),
        vacations: vacRows.filter(r => r.st.value && r.en.value).map(r => ({ name: r.nm.value.trim() || '休み', start: r.st.value, end: r.en.value })),
        hs: { ...hs.value(), medals: medalInputs.map(([mi, pi]) => ({ minutes: Number(mi.value), points: Number(pi.value) })), lateMinutes: Number(hsLate.value) },
      }, '数え方を保存しました').then(ok => { if (ok) load(root, ctx).then(() => window.scrollTo(0, y)); });
    };
    rule.append(jh.box, es.box, hs.box, vacBox, grid, sgBox, seat[0], cam[0], saveRule);

    // ═════ 🎒 小学生ショップ ═════
    {
      const esSec = section('🎒 小学生ショップ', 'チェックしたアイテムだけ、小学生が買えます（中学生の半分くらいの値段）。チェックしていないアイテムは「🔒 中学生から」と表示されます。小学生は1か月に1回まで交換できます。交換できる期間は「👕 着せかえ期間」と同じです。');
      const grid = el('div', 'gb-grid');
      const boxes = (cfg.shop || []).filter(i => !i.special).map(i => {
        const cb = check(`${i.emoji} ${i.name}（${i.price}→${Math.max(10, Math.round(i.price / 2 / 10) * 10)}pt）`, c.esItems.includes(i.id));
        cb[1].value = i.id; grid.append(cb[0]); return cb[1];
      });
      const sv = el('button', 'btn', '保存する');
      sv.onclick = () => save({ esItems: boxes.filter(b => b.checked).map(b => b.value) }, '小学生ショップを保存しました');
      esSec.append(grid, sv);
    }

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
    ny.append(el('b', null, '🌸 新年度にする'), el('p', 'muted', '学期と年度が新しくなります。ポイントと着せかえアイテムはそのまま引きつぎます。学年の木は新しい年度の自習時間で育て直します。3学期の保護者レポートは、新年度にする前に作ってください。'));
    const y = Number(c.yearStart.slice(0, 4)) + 1;
    const n1 = dateInput(`${y}-04-01`), n2 = dateInput(`${y}-09-01`), n3 = dateInput(`${y + 1}-01-01`);
    const nyGrid = el('div', 'gb-grid'); nyGrid.append(field('新年度の1学期', n1), field('2学期', n2), field('3学期', n3));
    const promote = check('生徒全員の学年を1つ上げる（中3 → 高1、高3 → 卒業）', true);
    const nyBtn = el('button', 'btn danger', '新年度にする');
    nyBtn.onclick = async () => {
      if (!confirm('新年度にしますか？\nポイントと着せかえアイテムはそのまま引きつぎます。この操作は元にもどせません。')) return;
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
    const dsSec = section('👕 着せかえ期間', '着せかえ（帽子・洋服・眼鏡・杖や剣・ペット・髪型・着ぐるみ）を買ったり着たりできる期間です。期間の外では、着せかえは誰にも見えません（持っているアイテムとポイントは消えません）。');
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

    // ═════ 季節のお楽しみ ═════
    const f = c.fun || {};
    const funSec = section('🎉 季節のお楽しみ', 'がんばりサンタ・七夕・ひな祭り・朝活チャレンジのオン/オフと条件です。');
    const fSanta = check('🎅 がんばりサンタ（2学期中間のクエスト 10月→サンタの手紙とサンタ帽／2学期期末のクエスト 11月→12/1〜25 サンタがついて歩く／両方でトナカイも）', f.santa !== false);
    const fSantaDays = numInput(f.santaDays || 15, 1, 30);
    const fTana = check('🎋 七夕（1学期中間のクエスト 5月→織姫と彦星の手紙と笹かざり／1学期期末のクエスト 6月→7/1〜20 彦星がついて歩く／両方で織姫も。7/7は特別な演出）', f.tanabata !== false);
    const fTanaDays = numInput(f.tanabataDays || 15, 1, 30);
    const fHina = check('🎎 3学期学年末クエスト（1/20〜2/28に15日→3/1〜3/20 おだいりさま・おひなさま、20日で三人官女、25日で五人囃子も。3/3はひなあられ）', f.hina !== false);
    const fHinaDays = numInput(f.hinaDays || 15, 1, 30);
    const fAsa = check('🌅 朝活チャレンジ（朝の自習で早起きスタンプとポイント）', f.asakatsu !== false);
    const fAsaMin = numInput(f.asakatsuMinutes || 30, 1, 120), fAsaPt = numInput(f.asakatsuPoints ?? 3, 0, 100);
    const fAsaS = timeInput(f.asakatsuStart || '06:00'), fAsaE = timeInput(f.asakatsuEnd || '07:30');
    const fAsaRow = el('div', 'gb-row'); fAsaRow.append(fAsaS, el('span', null, '〜'), fAsaE);
    const fg1 = el('div', 'gb-grid'); fg1.append(field('がんばりサンタ：各章で自習した日の数（10月・11月それぞれ）', fSantaDays, '「自習した日」は、学年ごとの連続自習🔥の最低時間（中1 45分・中2 60分・中3 90分など）以上の日です'));
    const fgT = el('div', 'gb-grid'); fgT.append(field('七夕：各章で自習した日の数（5月・6月それぞれ）', fTanaDays));
    const fgH = el('div', 'gb-grid'); fgH.append(field('ひな祭り：最初の段階の日数（三人官女は＋5日、五人囃子は＋10日）', fHinaDays));
    const fg2 = el('div', 'gb-grid'); fg2.append(field('朝活の時間帯', fAsaRow), field('朝活：スタンプがもらえる朝の自習時間（分）', fAsaMin, 'この時間帯に、自習時間として数えられた分'), field('朝活：スタンプ1こでもらえるポイント', fAsaPt));
    const saveFun = el('button', 'btn', 'お楽しみを保存する');
    saveFun.onclick = () => save({ fun: { santa: fSanta[1].checked, santaDays: Number(fSantaDays.value), tanabata: fTana[1].checked, tanabataDays: Number(fTanaDays.value), hina: fHina[1].checked, hinaDays: Number(fHinaDays.value), asakatsu: fAsa[1].checked, asakatsuMinutes: Number(fAsaMin.value), asakatsuPoints: Number(fAsaPt.value), asakatsuStart: fAsaS.value, asakatsuEnd: fAsaE.value === '23:59' ? '23:59' : fAsaE.value } }, 'お楽しみを保存しました');
    funSec.append(fSanta[0], fg1, fTana[0], fgT, fHina[0], fgH, fAsa[0], fg2, el('p', 'muted', '朝活は、「自習時間の数え方」で数える時間帯に朝活の時間帯が入っているときだけ数えます。'), saveFun);

    // ═════ 誕生日 ═════
    const bdSec = section('🎂 誕生日のお祝い', '誕生日は「ユーザー」タブの生徒の編集で登録します（月・日だけ）。誕生日に入室すると、お祝いカードが出て「🎂 バースデーケーキの帽子」をプレゼントします。その日は名札が金色になり🎂がつき、学年の木にもケーキが飾られます（「先生だけ」にした生徒は、先生・オーナーにだけ🎂が見えます）。先生には入室のお知らせで「今日は誕生日です」と届きます。');
    const bdMsg = el('textarea'); bdMsg.rows = 3; bdMsg.maxLength = 100; bdMsg.value = c.birthdayMessage || '';
    const saveBd = el('button', 'btn', 'カードのひとことを保存する');
    saveBd.onclick = () => save({ birthdayMessage: bdMsg.value }, '誕生日カードのひとことを保存しました');
    bdSec.append(field('お祝いカードのひとこと（100文字まで）', bdMsg), saveBd);

    // ═════ 📸 今日最初に取り組むページ（入室前の写真） ═════
    if (isOwner) {
      const spSec = section('📸 今日最初のページ', '生徒がその日はじめて入るときに撮った「今日最初に取り組むページ」です。写真をタップすると大きく見られます（14日で自動で消えます）。');
      const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      const dayIn = el('input'); dayIn.type = 'date'; dayIn.value = today; dayIn.max = today;
      const spRow = el('div', 'gb-row'); spRow.append(el('span', null, '日にち'), dayIn);
      const spGrid = el('div', 'sp-grid');
      spSec.append(spRow, spGrid);
      const loadSp = async () => {
        spGrid.textContent = '読みこみ中…';
        let d; try { d = await api('GET', '/api/admin/start-photos?day=' + dayIn.value); } catch (e) { spGrid.textContent = e.message; return; }
        spGrid.textContent = '';
        if (!d.photos.length) { spGrid.append(el('p', 'muted', 'この日の写真はありません')); return; }
        for (const p of d.photos) {
          const a = el('a', 'sp-item'); a.href = `/api/admin/start-photos/${p.userId}/${d.day}`; a.target = '_blank'; a.rel = 'noopener';
          const im = el('img'); im.src = a.href; im.alt = p.name; im.loading = 'lazy';
          const t = new Date(p.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
          a.append(im, el('b', null, p.name), el('small', null, `${p.grade || ''}・${t}`));
          spGrid.append(a);
        }
      };
      dayIn.onchange = loadSp; loadSp();
      root.prepend(spSec); // いちばん上に
    }

    // ═════ 生徒の自習時間 ═════
    const stSec = section('👦 生徒の自習時間', '「今日の自習時間」は今日勉強した時間ぜんぶ、「ポイントになる時間」はそのうち決めた時間帯の分です。見出しを押すと並べかえられます。生徒をタップすると、くわしい内容（今週・今学期・今年度・最近14日）が見られます。「修正」で、日ごとの自習時間を直せます。');
    root.prepend(stSec); // いちばん上に（毎日見るので）
    const stBox = el('div', 'table-wrap'); stSec.append(stBox);
    const GORDER = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '卒業'];
    const gIdx = (g) => { const i = GORDER.indexOf(g); return i < 0 ? 99 : i; };
    let stSort = { key: 'grade', desc: false }, stData = [];
    try { const v = JSON.parse(localStorage.getItem('juku-gb-sort') || 'null'); if (v && v.key) stSort = v; } catch (e) {}
    const COLS = [
      ['name', '名前', (a, b) => a.name.localeCompare(b.name, 'ja')],
      ['grade', '学年', (a, b) => gIdx(a.grade) - gIdx(b.grade) || a.name.localeCompare(b.name, 'ja')],
      ['todayAll', '今日の自習時間', (a, b) => a.todayAll - b.todayAll],
      ['today', 'ポイントになる時間', (a, b) => a.today - b.today],
      ['points', '今のポイント', (a, b) => a.points - b.points],
      ['streak', '🔥', (a, b) => a.streak - b.streak],
    ];
    function drawStudents() {
      stBox.textContent = '';
      const table = el('table', 'logs gb-students');
      const head = el('tr');
      for (const [key, label] of COLS) {
        const th = el('th', 'sortable', label + (stSort.key === key ? (stSort.desc ? ' ▼' : ' ▲') : ''));
        th.title = '押すと並べかえ';
        th.onclick = () => { stSort = { key, desc: stSort.key === key ? !stSort.desc : ['todayAll', 'today', 'points', 'streak'].includes(key) }; try { localStorage.setItem('juku-gb-sort', JSON.stringify(stSort)); } catch (e) {} drawStudents(); };
        head.append(th);
      }
      head.append(el('th', null, ''));
      table.append(el('thead')); table.firstChild.append(head);
      const cmp = (COLS.find(c => c[0] === stSort.key) || COLS[1])[2];
      const list = [...stData].sort((a, b) => (stSort.desc ? -cmp(a, b) : cmp(a, b)) || a.name.localeCompare(b.name, 'ja'));
      const tb = el('tbody');
      for (const s of list) {
        const tr = el('tr');
        tr.style.cursor = 'pointer'; tr.title = 'タップすると勉強時間のくわしい内容';
        tr.onclick = () => window.StudyDetail.open(api, s.id);
        const nameTd = el('td'); const nl = el('a', null, s.name); nl.href = '#'; nl.onclick = (e) => e.preventDefault(); nameTd.append(nl); tr.append(nameTd);
        [s.grade || '未設定', hm(s.todayAll), hm(s.today), `${s.points}pt`, s.streak ? `🔥${s.streak}${s.hs ? '週' : '日'}` : ''].forEach(v => tr.append(el('td', null, String(v))));
        const td = el('td'); const b = el('button', 'btn small secondary', '修正'); b.onclick = (e) => { e.stopPropagation(); openDays(s); }; td.append(b); tr.append(td);
        tb.append(tr);
      }
      if (!list.length) { const tr = el('tr'); const td = el('td', 'empty', '生徒がいません'); td.colSpan = 7; tr.append(td); tb.append(tr); }
      table.append(tb); stBox.append(table);
    }
    async function loadStudents() {
      let data;
      try { data = await api('GET', '/api/admin/ganbari/students'); } catch (e) { return toast(e.message); }
      stData = data.students; drawStudents();
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
