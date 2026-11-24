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

  function create({ api, toast, getUser, onClose }) {
    const st = { units: [], unit: null, rec: null, recording: false, finals: [], interim: '', startAt: 0, lastAt: 0, timer: null, showJa: false, result: null };
    const root = $('#reading');

    async function open() {
      root.hidden = false;
      showList();
      try { const d = await api('GET', '/api/reading/units'); st.units = d.units; showList(); } catch (e) { toast(e.message); }
    }
    function close() { stopRec(true); root.hidden = true; if (window.speechSynthesis) speechSynthesis.cancel(); if (onClose) onClose(); }
    $('#rd-close').onclick = close;
    $('#rd-back').onclick = () => { stopRec(true); showList(); };

    function showList() {
      st.unit = null;
      $('#rd-back').hidden = true; $('#rd-title').textContent = '🔁 音読の練習';
      const body = $('#rd-body'); body.textContent = '';
      if (!SR) body.append(el('p', 'rd-warn', 'この端末（ブラウザ）では英語の聞き取りが使えません。iPad・iPhone は Safari、パソコン・Android は Chrome で開いてください。お手本を聞くことはできます。'));
      if (!st.units.length) { body.append(el('p', 'muted', 'まだ練習できる単元がありません。先生が登録するまで待ってね。')); return; }
      body.append(el('p', 'muted', '単元をえらんでね。練習で90点以上・時間内を出すと、本番のテストを受けられるよ。'));
      const list = el('div', 'rd-units');
      const staff = getUser().role !== 'student';
      for (const u of st.units) {
        const row = el('div', 'rd-unit');
        const left = el('span'); left.append(el('b', null, u.title), el('small', null, `${staff ? u.grade + '・' : ''}${u.words}語・⏱ ${mmss(u.limit)}`));
        const st2 = el('small', 'rd-status');
        st2.textContent = (u.test.passed ? `🏅 テストクリア（${u.test.best}点）` : u.practice.passed ? `✅ 練習合格 → テストへ！（クリアで +${u.test.nextPoints}pt）` : u.practice.count ? `練習 ${u.practice.best}点（${u.practice.count}回）` : 'はじめて');
        left.append(st2);
        const btns = el('span', 'rd-unit-btns');
        const p = el('button', 'btn small secondary', '🔁 練習'); p.type = 'button'; p.onclick = () => showUnit(u, 'practice');
        const t = el('button', 'btn small', '📝 テスト'); t.type = 'button';
        t.disabled = !(u.practice.passed || staff);
        t.title = t.disabled ? '練習で90点以上・時間内を出すと受けられるよ' : '';
        t.onclick = () => showUnit(u, 'test');
        btns.append(p, t); row.append(left, btns); list.append(row);
      }
      body.append(list);
    }

    function showUnit(u, mode = 'practice') {
      st.unit = u; st.result = null; st.showJa = false; st.mode = mode;
      $('#rd-back').hidden = false; $('#rd-title').textContent = (mode === 'test' ? '📝 テスト：' : '🔁 練習：') + u.title;
      render();
    }
    function render() {
      const u = st.unit, r = st.result, body = $('#rd-body'); body.textContent = '';
      const top = el('div', 'rd-top');
      const timer = el('span', 'rd-timer', `⏱ ${mmss(st.recording ? (Date.now() - st.startAt) / 1000 : r ? r.seconds : 0)} / ${mmss(u.limit)}`); timer.id = 'rd-timer';
      const ja = el('button', 'btn small secondary', st.showJa ? '👀 訳をかくす' : '👀 訳を見る'); ja.type = 'button';
      ja.onclick = () => { st.showJa = !st.showJa; render(); };
      const test = st.mode === 'test';
      ja.hidden = test; // テストのときは訳をいつも出す
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
        if (line.ja && (st.showJa || bad || test)) row.append(el('p', 'rd-ja', line.ja));
        pas.append(row);
      }
      body.append(pas);
      const live = el('p', 'rd-live'); live.id = 'rd-live'; live.hidden = !st.recording; live.textContent = st.interim ? `🎧 ${st.interim}` : '🎧 聞いています…';
      body.append(live);
      if (r) {
        const res = el('div', 'rd-result' + (r.passed ? ' ok' : ''));
        res.append(el('b', 'rd-score', `${r.score}点`), el('span', null, `時間 ${mmss(r.seconds)}（制限 ${mmss(u.limit)}）`));
        if (test && r.accuracy != null) res.append(el('small', 'rd-sub', `発音の正確さ ${r.accuracy}・なめらかさ ${r.fluency}・読みもれなし ${r.completeness}`));
        const msg = test
          ? (r.passed ? (r.points ? `🎉 クリア！（${r.attempt}回目） +${r.points}ポイント！` : r.alreadyCleared ? '🎉 クリア！（この単元はもうポイントをもらっているよ）' : '🎉 クリア！') : r.score < 90 ? '赤い単語は発音があやしいところ。練習でたしかめてから、もう一度！' : `点数はOK！ 制限時間（${mmss(u.limit)}）の中で読めるように、もう一度`)
          : (r.passed ? '🎉 練習合格！ 本番のテストを受けられるよ' : r.score < 90 ? '赤い単語を、お手本を聞いてからもう一度！ 90点まであと少し' : `点数はOK！ 制限時間（${mmss(u.limit)}）の中で読めるように、もう一度`);
        res.append(el('p', null, msg));
        body.append(res);
        if (!test && r.passed) { const go = el('button', 'btn small', '📝 本番のテストへ'); go.type = 'button'; go.onclick = () => showUnit(u, 'test'); body.append(go); }
      }
      const btns = el('div', 'rd-btns');
      if (st.recording) { const stop = el('button', 'btn rd-big', '⏹ 読みおわった'); stop.type = 'button'; stop.onclick = () => finish(); btns.append(stop); }
      else if (test) { const go = el('button', 'btn rd-big', st.preparing ? '準備中…' : r ? '📝 もう一度テスト' : '📝 テストを始める'); go.type = 'button'; go.disabled = !!st.preparing; go.onclick = startTest; btns.append(go); }
      else { const go = el('button', 'btn rd-big', r ? '🔁 もう一度読む' : '🎤 読みはじめる'); go.type = 'button'; go.disabled = !SR; go.onclick = startRec; btns.append(go); }
      body.append(btns);
      if (!SR && !test) body.append(el('p', 'rd-warn', 'この端末では聞き取りが使えません（Safari か Chrome で開いてください）'));
      if (test && !st.recording && !r) body.append(el('p', 'muted', '本番のテストは、Microsoft の音声サービスが発音を採点します。90点以上・時間内でクリア！'));
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
      if (rec && rec.azure) { try { rec.azure.stopContinuousRecognitionAsync(() => rec.azure.close(), () => rec.azure.close()); } catch (e) {} }
      else if (rec) { try { rec.onend = null; rec.stop(); } catch (e) {} }
      if (discard) { st.finals = []; st.interim = ''; }
    }
    async function finish() {
      if (!st.recording) return;
      if (st.mode === 'test') return finishTest();
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
    // ═════ 本番のテスト：Microsoft の発音評価 ═════
    let sdkLoading = null;
    function loadSdk() {
      if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
      if (!sdkLoading) sdkLoading = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/vendor/speech-sdk.js'; sc.onload = () => res(window.SpeechSDK); sc.onerror = () => { sdkLoading = null; rej(new Error('採点のしくみを読みこめませんでした')); }; document.head.append(sc); });
      return sdkLoading;
    }
    async function startTest() {
      if (st.recording || st.preparing) return;
      if (window.speechSynthesis) speechSynthesis.cancel();
      st.preparing = true; render();
      let sdk, tk;
      try { [sdk, tk] = await Promise.all([loadSdk(), api('GET', '/api/reading/speech-token')]); }
      catch (e) { st.preparing = false; render(); return toast(e.message, 6000); }
      st.preparing = false;
      const ref = st.unit.lines.map(l => l.en).join(' ');
      const cfg = sdk.SpeechConfig.fromAuthorizationToken(tk.token, tk.region);
      cfg.speechRecognitionLanguage = 'en-US';
      const audio = sdk.AudioConfig.fromDefaultMicrophoneInput();
      try { audio.setProperty('MICROPHONE-WorkletSourceUrl', '/vendor/speech-processor.js'); } catch (e) {}
      const pa = new sdk.PronunciationAssessmentConfig(ref, sdk.PronunciationAssessmentGradingSystem.HundredMark, sdk.PronunciationAssessmentGranularity.Word, true);
      const recog = new sdk.SpeechRecognizer(cfg, audio);
      pa.applyTo(recog);
      st.segs = []; st.result = null; st.interim = ''; st.recording = true; st.startAt = Date.now(); st.lastEnd = 0;
      st.rec = { azure: recog };
      recog.recognizing = (_s, e) => { st.interim = e.result.text || ''; const live = $('#rd-live'); if (live) live.textContent = `🎧 ${st.interim.slice(-80)}`; };
      recog.recognized = (_s, e) => {
        if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
        let detail = null;
        try { detail = JSON.parse(e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult)); } catch (er) {}
        const nb = detail && detail.NBest && detail.NBest[0];
        if (!nb) return;
        st.segs.push({ words: (nb.Words || []).map(w => ({ word: w.Word, acc: w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : 0, err: w.PronunciationAssessment ? w.PronunciationAssessment.ErrorType : 'None' })), fluency: nb.PronunciationAssessment ? nb.PronunciationAssessment.FluencyScore : (nb.FluencyScore || 0) });
        st.lastEnd = (e.result.offset + e.result.duration) / 1e7;
        const g = scoreTest(); if (g.completeness >= 100) setTimeout(() => { if (st.recording) finish(); }, 900);
      };
      recog.canceled = (_s, e) => { if (e.reason === sdk.CancellationReason.Error) { toast('採点につながりませんでした：' + (e.errorDetails || ''), 7000); stopRec(true); render(); } };
      recog.startContinuousRecognitionAsync(() => {}, (err) => { toast('マイクを使えませんでした。ブラウザでマイクを許可してください', 6000); stopRec(true); render(); });
      clearInterval(st.timer);
      st.timer = setInterval(() => {
        const t = $('#rd-timer'); if (!t || !st.recording) return;
        const sec = (Date.now() - st.startAt) / 1000;
        t.textContent = `⏱ ${mmss(sec)} / ${mmss(st.unit.limit)}`;
        t.classList.toggle('over', sec > st.unit.limit);
        if (sec > st.unit.limit * 2 + 30) finish();
      }, 250);
      render();
    }
    // 全体の点数：本文の単語と、聞き取った単語（と発音の点）を順番どおりに合わせる
    // 正確さ＝合った単語の発音の点の平均、読みもれなし＝合った単語の割合、なめらかさ＝文ごとの平均
    // 総合＝3つを低い順にならべて 0.6・0.2・0.2 の重み（Microsoft のサンプルと同じ計算）
    function scoreTest() {
      const words = wordsOf(st.unit.lines.map(l => l.en).join(' '));
      const P = [], owner = [];
      words.forEach((w, i) => toks(w).forEach(t => { P.push(t); owner.push(i); }));
      const H = [];
      for (const sg of st.segs) for (const w of sg.words) for (const t of toks(w.word)) H.push({ t, acc: w.acc, err: w.err });
      const n = P.length, m = H.length;
      const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = P[i] === H[j].t ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      const accOf = new Array(n).fill(null);
      for (let i = 0, j = 0; i < n && j < m;) { if (P[i] === H[j].t) { accOf[i] = H[j].err === 'Mispronunciation' ? Math.min(H[j].acc, 59) : H[j].acc; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
      const wAcc = words.map(() => []);
      accOf.forEach((a, k) => wAcc[owner[k]].push(a));
      const per = wAcc.map(list => list.some(a => a === null) ? null : list.reduce((x, y) => x + y, 0) / list.length);
      const matched = per.filter(a => a !== null);
      const accuracy = matched.length ? Math.round(matched.reduce((x, y) => x + y, 0) / matched.length) : 0;
      const completeness = words.length ? Math.round(matched.length / words.length * 100) : 0;
      let fw = 0, fs = 0; for (const sg of st.segs) { fw += sg.words.length; fs += sg.fluency * sg.words.length; }
      const fluency = fw ? Math.round(fs / fw) : 0;
      const sorted = [accuracy, fluency, completeness].sort((a, b) => a - b);
      const score = Math.round(sorted[0] * 0.6 + sorted[1] * 0.2 + sorted[2] * 0.2);
      return { score, accuracy, fluency, completeness, ok: per.map(a => a !== null && a >= 60) };
    }
    async function finishTest() {
      const seconds = Math.max(1, Math.round(st.lastEnd || (Date.now() - st.startAt) / 1000));
      stopRec(false);
      const g = scoreTest();
      st.result = { ...g, seconds, passed: g.score >= 90 && seconds <= st.unit.limit };
      st.interim = '';
      render();
      try {
        const r = await api('POST', '/api/reading/test', { unitId: st.unit.id, score: g.score, accuracy: g.accuracy, fluency: g.fluency, completeness: g.completeness, seconds });
        Object.assign(st.result, { points: r.points, attempt: r.attempt, alreadyCleared: r.alreadyCleared, passed: r.passed });
        st.unit.test.count++; st.unit.test.best = Math.max(st.unit.test.best || 0, g.score);
        if (r.passed) st.unit.test.passed = true;
        if (r.points) toast(`🏅 テストクリア！ +${r.points}ポイント`, 6000);
        render();
      } catch (e) { toast(e.message); }
    }

    return { open, close, _grade: grade };
  }
  window.Reading = { create, grade, toks };
})();
