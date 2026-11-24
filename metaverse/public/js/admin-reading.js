// 管理画面「🎤 音読」：単元（教科書の本文と日本語訳）の登録・学年ごとの「1分に読む語数」・練習のようす
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  // サーバーと同じ分け方（プレビュー用）
  const isEn = (s) => /[A-Za-z]/.test(s) && !/[぀-ヿ一-鿿]/.test(s);
  const wordsOf = (t) => String(t || '').split(/\s+/).map(w => w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '')).filter(Boolean);
  function parse(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      if (isEn(line)) { const m = line.match(/^([A-Z][A-Za-z .'-]{0,20}):\s*(.+)$/); out.push({ speaker: m ? m[1] : null, en: m ? m[2] : line, ja: '' }); }
      else if (out.length && !out[out.length - 1].ja) out[out.length - 1].ja = line;
    }
    return out;
  }
  const toText = (lines) => lines.map(l => (l.speaker ? `${l.speaker}: ` : '') + l.en + (l.ja ? `\n${l.ja}` : '')).join('\n');

  async function load(root, { api, toast }) {
    root.textContent = '';
    let d;
    try { d = await api('GET', '/api/admin/reading'); } catch (e) { return toast(e.message); }
    const section = (title, note) => { const s = el('div', 'gb-sec'); s.append(el('h3', 'sec', title)); if (note) s.append(el('p', 'muted', note)); root.append(s); return s; };
    const limitOf = (words, grade) => Math.max(10, Math.ceil((words / (d.config.wpm[grade] || 52)) * 60 / 5) * 5);

    // ── 単元を追加・直す ──
    const fs = section('📖 単元を登録する', '英語の行のすぐ下に、その日本語訳の行を書いてください。行の頭の「Jin:」のような話す人の名前は、読まない・数えない部分になります。教科書の本文は塾の中だけで使ってください。');
    const gsel = el('select'); d.grades.forEach(g => { const o = el('option', null, g); o.value = g; gsel.append(o); }); gsel.value = '中3';
    const title = el('input'); title.placeholder = '単元の名前（例：Unit 1 Part 1）。大人は空なら「11/24の週」'; title.maxLength = 60;
    const ta = el('textarea', 'gb-out'); ta.rows = 12; ta.placeholder = "Jin: I'm sorry I'm late.\n遅れてごめんなさい。\nSho: Don't worry. We've just arrived, too.\n気にしないで。ぼくたちもちょうど着いたところだよ。";
    const pv = el('p', 'muted');
    const upd = () => { const ls = parse(ta.value), w = ls.reduce((n, l) => n + wordsOf(l.en).length, 0); pv.textContent = ls.length ? `${ls.length}行・${w}語 → ${gsel.value}の制限時間 ${mmss(limitOf(w, gsel.value))}${ls.some(l => !l.ja) ? '（訳がない行があります）' : ''}` : ''; };
    ta.oninput = gsel.onchange = upd;
    let editing = null;
    const save = el('button', 'btn', '登録する'), cancel = el('button', 'btn secondary', 'やめる'); cancel.hidden = true;
    const row = el('div', 'gb-row'); row.append(gsel, title);
    fs.append(row, ta, pv, (() => { const r = el('div', 'gb-row'); r.append(save, cancel); return r; })());
    cancel.onclick = () => { editing = null; save.textContent = '登録する'; cancel.hidden = true; ta.value = ''; title.value = ''; upd(); };
    save.onclick = async () => {
      try {
        if (editing) await api('PATCH', `/api/admin/reading/units/${editing}`, { grade: gsel.value, title: title.value, text: ta.value });
        else await api('POST', '/api/admin/reading/units', { grade: gsel.value, title: title.value, text: ta.value });
        toast(editing ? '直しました' : '登録しました'); load(root, { api, toast });
      } catch (e) { toast(e.message); }
    };

    // ── 単元の一覧 ──
    const ls = section('📚 登録した単元', '生徒は、自分の学年の単元だけ練習できます（先生・オーナーは全部）。');
    const tw = el('div', 'table-wrap'); ls.append(tw);
    const t = el('table', 'logs'); const h = el('tr'); ['学年', '単元', '語数', '制限時間', '', ''].forEach(x => h.append(el('th', null, x))); t.append(el('thead')); t.firstChild.append(h);
    const tb = el('tbody');
    for (const u of d.units) {
      const tr = el('tr'); if (!u.active) tr.style.opacity = '.5';
      [u.grade, u.title, `${u.words}語`, mmss(u.limit)].forEach(v => tr.append(el('td', null, v)));
      const a = el('td'); const eb = el('button', 'btn small secondary', '直す');
      eb.onclick = () => { editing = u.id; gsel.value = u.grade; title.value = u.title; ta.value = toText(u.lines); save.textContent = '直す'; cancel.hidden = false; upd(); fs.scrollIntoView({ behavior: 'smooth' }); };
      const hb = el('button', 'btn small secondary', u.active ? 'かくす' : '出す');
      hb.onclick = async () => { try { await api('PATCH', `/api/admin/reading/units/${u.id}`, { active: !u.active }); load(root, { api, toast }); } catch (e) { toast(e.message); } };
      a.append(eb, hb); tr.append(a);
      const b = el('td'); const db2 = el('button', 'btn small danger', '消す');
      let armed = false;
      db2.onclick = async () => { if (!armed) { armed = true; db2.textContent = 'もう一度押すと消えます'; setTimeout(() => { armed = false; db2.textContent = '消す'; }, 4000); return; } try { await api('DELETE', `/api/admin/reading/units/${u.id}`); toast('消しました'); load(root, { api, toast }); } catch (e) { toast(e.message); } };
      b.append(db2); tr.append(b); tb.append(tr);
    }
    if (!d.units.length) { const tr = el('tr'); const td = el('td', 'empty', 'まだ単元がありません。上で登録してください'); td.colSpan = 6; tr.append(td); tb.append(tr); }
    t.append(tb); tw.append(t);

    // ── 1分に読む語数 ──
    const ws = section('⏱ 合格ラインと、学年ごとの「1分に読む語数」', '制限時間 ＝ 本文の語数 ÷ この数（5秒単位で切り上げ）。例：中3は52語の本文を1分。数を小さくすると、時間がゆるくなります。');
    const wrow = el('div', 'gb-row'); const winputs = {};
    for (const g of d.grades) { const i = el('input'); i.type = 'number'; i.min = 10; i.max = 300; i.value = d.config.wpm[g]; i.style.width = '70px'; winputs[g] = i; const one = el('span', 'gb-row'); one.style.flexWrap = 'nowrap'; one.append(el('span', null, g), i); wrow.append(one); }
    const pi = el('input'); pi.type = 'number'; pi.min = 50; pi.max = 100; pi.value = d.config.passScore; pi.style.width = '80px';
    const prow = el('div', 'gb-row'); prow.append(el('b', null, '🎯 合格ライン（練習・テスト共通）'), pi, el('span', null, '点以上・時間内'));
    const cdl = el('label', 'gb-row'); const cd = el('input'); cd.type = 'checkbox'; cd.checked = d.config.writingClassDay !== false;
    cdl.append(cd, el('span', null, '📝 ライティングテストは「授業の日」だけ受けられる（生徒ごとの授業の曜日は、ユーザー管理で登録。練習はいつでもOK）'));
    // 授業の日の、テストを受けられる時間（授業の前・後。2つまで）
    const wins = d.config.writingWindows || [];
    const twrow = el('div', 'gb-row'); twrow.append(el('span', null, '⏰ 受けられる時間：'));
    const tins = [0, 1].map(i => { const a = el('input'); a.type = 'time'; a.value = (wins[i] && wins[i].start) || ''; const b = el('input'); b.type = 'time'; b.value = (wins[i] && wins[i].end) || ''; twrow.append(a, el('span', null, '〜'), b, el('span', null, i === 0 ? '　と　' : '')); return [a, b]; });
    twrow.append(el('small', 'muted', '（空にすると、授業の日のいつでも。終わりの時間から15分までは写真を送れます）'));
    const wsave = el('button', 'btn', '保存する');
    wsave.onclick = async () => { try { await api('PATCH', '/api/admin/reading/config', { writingClassDay: cd.checked, writingWindows: tins.filter(([a, b]) => a.value && b.value).map(([a, b]) => ({ start: a.value, end: b.value })), passScore: Number(pi.value), wpm: Object.fromEntries(Object.entries(winputs).map(([g, i]) => [g, Number(i.value)])) }); toast('保存しました'); load(root, { api, toast }); } catch (e) { toast(e.message); } };
    ws.append(wrow, prow, cdl, twrow, wsave);

    // ── 本番のテストの結果 ──
    const ts = section('📝 本番のテストの結果', `Microsoft の音声サービスが採点します。${d.config.passScore}点以上・時間内でクリア（単元ごとに1回：1回目+5／2回目+4／3回目から+3ポイント）。採点の準備：${d.speechReady ? '✅ できています' : '⚠️ まだです（Render の Environment に AZURE_SPEECH_KEY と AZURE_SPEECH_REGION を入れてください）'}`);
    const tw2 = el('div', 'table-wrap'); ts.append(tw2);
    const tt = el('table', 'logs'); const th2 = el('tr'); ['生徒', '学年', '単元', '回数', 'いちばんよい点', 'クリア', 'ポイント', '最後'].forEach(x => th2.append(el('th', null, x))); tt.append(el('thead')); tt.firstChild.append(th2);
    const tb2 = el('tbody');
    for (const r of d.tests || []) {
      const tr = el('tr');
      [r.name, r.grade || '', r.title, `${r.count}回`, `${r.best}点`, r.passed ? `✅ ${r.clearedAt}回目` : '', r.points ? `+${r.points}` : '', new Date(r.last).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })].forEach(v => tr.append(el('td', null, v)));
      tb2.append(tr);
    }
    if (!(d.tests || []).length) { const tr = el('tr'); const td = el('td', 'empty', 'まだテストの記録はありません'); td.colSpan = 8; tr.append(td); tb2.append(tr); }
    tt.append(tb2); tw2.append(tt);

    // ── ✍️ ライティングの結果 ──
    const wsx = section('✍️ ライティングの結果', `音読テストに合格した単元で受けられます。日本語訳を見てノートに書き、写真を Microsoft が読み取ります。大文字・小文字・記号もふくめて100点で合格（練習で100点 → テスト）。文字の読み取りの準備：${d.visionReady ? '✅ できています' : '⚠️ まだです（Render の Environment に AZURE_VISION_KEY と AZURE_VISION_ENDPOINT を入れてください）'}`);
    const ww = el('div', 'table-wrap'); wsx.append(ww);
    const wt = el('table', 'logs'); const wh = el('tr'); ['生徒', '学年', '単元', '練習', 'テスト', 'いちばんよい点', 'クリア', 'ポイント', '最後'].forEach(x => wh.append(el('th', null, x))); wt.append(el('thead')); wt.firstChild.append(wh);
    const wb = el('tbody');
    for (const r of d.writing || []) {
      const tr = el('tr');
      [r.name, r.grade || '', r.title, `${r.practice}回`, `${r.tests}回`, `${r.best}点`, r.passed ? `✅ ${r.clearedAt}回目` : '', r.points ? `+${r.points}` : '', new Date(r.last).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })].forEach(v => tr.append(el('td', null, v)));
      wb.append(tr);
    }
    if (!(d.writing || []).length) { const tr = el('tr'); const td = el('td', 'empty', 'まだライティングの記録はありません'); td.colSpan = 9; tr.append(td); wb.append(tr); }
    wt.append(wb); ww.append(wt);

    // ── 練習のようす ──
    const ps = section('🔁 練習のようす', `生徒ごと・単元ごとの練習の回数といちばんよい点数です。「英文で合格」→「訳だけで合格」（${d.config.passScore}点以上・時間内）になると、本番のテストを受けられます。`);
    const pw = el('div', 'table-wrap'); ps.append(pw);
    const pt = el('table', 'logs'); const ph = el('tr'); ['生徒', '学年', '単元', '回数', 'いちばんよい点', '合格', '最後'].forEach(x => ph.append(el('th', null, x))); pt.append(el('thead')); pt.firstChild.append(ph);
    const pb = el('tbody');
    for (const r of d.summary) {
      const tr = el('tr');
      [r.name, r.grade || '', r.title, `${r.count}回`, `${r.best}点`, r.passed ? '✅ 訳だけ' : r.enPassed ? '✅ 英文' : '', new Date(r.last).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })].forEach(v => tr.append(el('td', null, v)));
      pb.append(tr);
    }
    if (!d.summary.length) { const tr = el('tr'); const td = el('td', 'empty', 'まだ練習の記録はありません'); td.colSpan = 7; tr.append(td); pb.append(tr); }
    pt.append(pb); pw.append(pt);
  }
  window.AdminReading = { load };
})();
