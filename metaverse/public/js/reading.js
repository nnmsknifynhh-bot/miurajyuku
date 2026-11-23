// 英語の音読の練習（無料のブラウザの聞き取りで採点）
// - 単元をえらぶ → 「🎤 読みはじめる」→ 読む → 「読みおわった」
// - 聞き取れた単語の割合が点数。聞き取れなかった単語は赤。赤い単語のある文は日本語訳を出す
// - 90点以上・時間内で合格（あとで本番のテストを受けられるようにする）
// - 「🔊 お手本」は端末の読み上げ（無料）
(function () {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ── 単語をそろえる（大文字小文字・記号・短縮形） ──
  const CONTR = { "i'm": 'i am', "can't": 'can not', "cannot": 'can not', "won't": 'will not', "let's": 'let us', "it's": 'it is', "that's": 'that is', "what's": 'what is', "where's": 'where is', "there's": 'there is', "here's": 'here is', "he's": 'he is', "she's": 'she is', "who's": 'who is', "how's": 'how is' };
  function toks(word) {
    let w = String(word).toLowerCase().replace(/[’‘]/g, "'").replace(/-/g, '').replace(/[^a-z0-9']/g, '');
    if (!w) return [];
    if (CONTR[w]) return CONTR[w].split(' ');
    w = w.replace(/n't$/, ' not').replace(/'re$/, ' are').replace(/'ve$/, ' have').replace(/'ll$/, ' will').replace(/'d$/, ' would').replace(/'m$/, ' am').replace(/'s$/, 's').replace(/'/g, '');
    return w.split(' ').filter(Boolean);
  }
  const wordsOf = (t) => String(t || '').split(/\s+/).map(w => w.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '')).filter(Boolean);
  // 本文の単語のうち、聞き取れたもの（順番どおりにいちばん多く合うところをさがす）
  function grade(words, heard) {
    const P = [], owner = [];
    words.forEach((w, i) => toks(w).forEach(t => { P.push(t); owner.push(i); }));
    const H = [];
    for (const w of String(heard).split(/\s+/)) H.push(...toks(w));
    const n = P.length, m = H.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = P[i] === H[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hit = new Array(n).fill(false);
    for (let i = 0, j = 0; i < n && j < m;) { if (P[i] === H[j]) { hit[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
    const ok = words.map(() => true);
    hit.forEach((h, k) => { if (!h) ok[owner[k]] = false; });
    const score = words.length ? Math.round(ok.filter(Boolean).length / words.length * 100) : 0;
    return { ok, score };
  }

  function create({ api, toast, getUser }) {
    const st = { units: [], unit: null, rec: null, recording: false, finals: [], interim: '', startAt: 0, lastAt: 0, timer: null, showJa: false, result: null };
    const root = $('#reading');

    async function open() {
      root.hidden = false;
      showList();
      try { const d = await api('GET', '/api/reading/units'); st.units = d.units; showList(); } catch (e) { toast(e.message); }
    }
    function close() { stopRec(true); root.hidden = true; if (window.speechSynthesis) speechSynthesis.cancel(); }
    $('#rd-close').onclick = close;
    $('#rd-back').onclick = () => { stopRec(true); showList(); };

    function showList() {
      st.unit = null;
      $('#rd-back').hidden = true; $('#rd-title').textContent = '🔁 音読の練習';
      const body = $('#rd-body'); body.textContent = '';
      if (!SR) body.append(el('p', 'rd-warn', 'この端末（ブラウザ）では英語の聞き取りが使えません。iPad・iPhone は Safari、パソコン・Android は Chrome で開いてください。お手本を聞くことはできます。'));
      if (!st.units.length) { body.append(el('p', 'muted', 'まだ練習できる単元がありません。先生が登録するまで待ってね。')); return; }
      body.append(el('p', 'muted', '単元をえらんでね。90点以上・時間内で合格！'));
      const list = el('div', 'rd-units');
      for (const u of st.units) {
        const b = el('button', 'rd-unit'); b.type = 'button';
        const left = el('span'); left.append(el('b', null, u.title), el('small', null, `${getUser().role === 'student' ? '' : u.grade + '・'}${u.words}語・⏱ ${mmss(u.limit)}`));
        const right = el('span', 'rd-badge' + (u.practice.passed ? ' ok' : ''), u.practice.passed ? `✅ ${u.practice.best}点` : u.practice.count ? `${u.practice.best}点（${u.practice.count}回）` : 'はじめて');
        b.append(left, right); b.onclick = () => showUnit(u); list.append(b);
      }
      body.append(list);
    }

    function showUnit(u) {
      st.unit = u; st.result = null; st.showJa = false;
      $('#rd-back').hidden = false; $('#rd-title').textContent = u.title;
      render();
    }
    function render() {
      const u = st.unit, r = st.result, body = $('#rd-body'); body.textContent = '';
      const top = el('div', 'rd-top');
      const timer = el('span', 'rd-timer', `⏱ ${mmss(st.recording ? (Date.now() - st.startAt) / 1000 : r ? r.seconds : 0)} / ${mmss(u.limit)}`); timer.id = 'rd-timer';
      const ja = el('button', 'btn small secondary', st.showJa ? '👀 訳をかくす' : '👀 訳を見る'); ja.type = 'button';
      ja.onclick = () => { st.showJa = !st.showJa; render(); };
      const model = el('button', 'btn small secondary', '🔊 お手本'); model.type = 'button'; model.onclick = speakModel; model.hidden = !window.speechSynthesis;
      top.append(timer, ja, model);
      body.append(top);
      const pas = el('div', 'rd-passage');
      let wi = 0;
      for (const line of u.lines) {
        const row = el('div', 'rd-line');
        if (line.speaker) row.append(el('span', 'rd-speaker', line.speaker));
        const en = el('p', 'rd-en');
        let bad = false;
        for (const w of String(line.en).split(/\s+/).filter(Boolean)) {
          const clean = w.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '');
          const span = el('span', null, w + ' ');
          if (clean) { if (r && !r.ok[wi]) { span.className = 'ng'; bad = true; } wi++; }
          en.append(span);
        }
        row.append(en);
        if (line.ja && (st.showJa || bad)) row.append(el('p', 'rd-ja', line.ja));
        pas.append(row);
      }
      body.append(pas);
      const live = el('p', 'rd-live'); live.id = 'rd-live'; live.hidden = !st.recording; live.textContent = st.interim ? `🎧 ${st.interim}` : '🎧 聞いています…';
      body.append(live);
      if (r) {
        const res = el('div', 'rd-result' + (r.passed ? ' ok' : ''));
        res.append(el('b', 'rd-score', `${r.score}点`), el('span', null, `時間 ${mmss(r.seconds)}（制限 ${mmss(u.limit)}）`));
        res.append(el('p', null, r.passed ? '🎉 合格！ 本番のテストも、この調子で！' : r.score < 90 ? '赤い単語を、お手本を聞いてからもう一度！ 90点まであと少し' : `点数はOK！ 制限時間（${mmss(u.limit)}）の中で読めるように、もう一度`));
        body.append(res);
      }
      const btns = el('div', 'rd-btns');
      if (st.recording) { const stop = el('button', 'btn rd-big', '⏹ 読みおわった'); stop.type = 'button'; stop.onclick = () => finish(); btns.append(stop); }
      else { const go = el('button', 'btn rd-big', r ? '🔁 もう一度読む' : '🎤 読みはじめる'); go.type = 'button'; go.disabled = !SR; go.onclick = startRec; btns.append(go); }
      body.append(btns);
      if (!SR) body.append(el('p', 'rd-warn', 'この端末では聞き取りが使えません（Safari か Chrome で開いてください）'));
    }

    function speakModel() {
      if (!window.speechSynthesis) return;
      speechSynthesis.cancel();
      const text = st.unit.lines.map(l => l.en).join(' ');
      const ut = new SpeechSynthesisUtterance(text);
      ut.lang = 'en-US'; ut.rate = 0.9;
      const v = speechSynthesis.getVoices().find(x => /^en(-|_)US/i.test(x.lang)) || speechSynthesis.getVoices().find(x => /^en/i.test(x.lang));
      if (v) ut.voice = v;
      speechSynthesis.speak(ut);
    }

    function startRec() {
      if (!SR || st.recording) return;
      if (window.speechSynthesis) speechSynthesis.cancel();
      st.finals = []; st.interim = ''; st.result = null; st.recording = true; st.startAt = Date.now(); st.lastAt = 0;
      const rec = new SR();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) st.finals.push(t); else interim += t;
        }
        st.interim = interim; st.lastAt = Date.now();
        const live = $('#rd-live'); if (live) live.textContent = `🎧 ${[...st.finals.slice(-1), interim].join(' ').slice(-80)}`;
        // 最後まで読めたら、自動でおわる
        const g = grade(wordsOf(st.unit.lines.map(l => l.en).join(' ')), [...st.finals, interim].join(' '));
        if (g.score === 100) setTimeout(() => { if (st.recording) finish(); }, 800);
      };
      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { toast('マイクが使えません。ブラウザの設定でマイクを許可してください', 6000); stopRec(true); render(); }
      };
      rec.onend = () => { if (st.recording && st.rec === rec) { try { rec.start(); } catch (e) { /* 次の機会に */ } } }; // iPhone は無音でとまるので、つづける
      st.rec = rec;
      try { rec.start(); } catch (e) { toast('聞き取りを始められませんでした'); st.recording = false; }
      clearInterval(st.timer);
      st.timer = setInterval(() => {
        const t = $('#rd-timer'); if (!t || !st.recording) return;
        const sec = (Date.now() - st.startAt) / 1000;
        t.textContent = `⏱ ${mmss(sec)} / ${mmss(st.unit.limit)}`;
        t.classList.toggle('over', sec > st.unit.limit);
        if (sec > st.unit.limit * 2 + 30) finish(); // 長すぎるときは自動でおわる
      }, 250);
      render();
    }
    function stopRec(discard) {
      clearInterval(st.timer);
      const rec = st.rec; st.rec = null; st.recording = false;
      if (rec) { try { rec.onend = null; rec.stop(); } catch (e) {} }
      if (discard) { st.finals = []; st.interim = ''; }
    }
    async function finish() {
      if (!st.recording) return;
      const end = st.lastAt || Date.now();
      const heard = [...st.finals, st.interim].join(' ');
      stopRec(false);
      const g = grade(wordsOf(st.unit.lines.map(l => l.en).join(' ')), heard);
      const seconds = Math.max(1, Math.round((end - st.startAt) / 1000));
      const passed = g.score >= 90 && seconds <= st.unit.limit;
      st.result = { ...g, seconds, passed };
      st.interim = '';
      render();
      try {
        const r = await api('POST', '/api/reading/practice', { unitId: st.unit.id, score: g.score, seconds });
        st.unit.practice.count++; st.unit.practice.best = Math.max(st.unit.practice.best || 0, g.score);
        if (r.passed) st.unit.practice.passed = true;
      } catch (e) { toast(e.message); }
    }
    return { open, close, _grade: grade };
  }
  window.Reading = { create, grade, toks };
})();
