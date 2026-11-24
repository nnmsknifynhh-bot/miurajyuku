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
  let PASS = 90; // 合格ライン（サーバーの設定でかわる）
  const MAX_MISS = 3; // スピーキング：聞き取れなかった単語が3つ以上なら再テスト

  // ── 単語をそろえる（大文字小文字・記号・短縮形） ──
  const CONTR = { "i'm": 'i am', "can't": 'can not', "cannot": 'can not', "won't": 'will not', "let's": 'let us', "it's": 'it is', "that's": 'that is', "what's": 'what is', "where's": 'where is', "there's": 'there is', "here's": 'here is', "he's": 'he is', "she's": 'she is', "who's": 'who is', "how's": 'how is' };
  // 数字は英語のつづりにそろえる（「10」と「ten」を同じにする。音声の機械は数字で書くことが多いため）
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  function numWords(n) {
    if (n < 20) return [ONES[n]];
    if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
    if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? numWords(n % 100) : [])];
    // 年（1100〜1999・2010〜2099）は「nineteen ninety」「twenty twenty six」の読み方
    if ((n >= 1100 && n <= 1999) || (n >= 2010 && n <= 2099)) return [...numWords(Math.floor(n / 100)), ...(n % 100 ? (n % 100 < 10 ? ['oh', ONES[n % 100]] : numWords(n % 100)) : ['hundred'])];
    if (n < 1000000) return [...numWords(Math.floor(n / 1000)), 'thousand', ...(n % 1000 ? numWords(n % 1000) : [])];
    return String(n).split('').map(d => ONES[Number(d)]);
  }
  const ordWords = (n) => { const w = numWords(n), last = w[w.length - 1]; w[w.length - 1] = ORD[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th'); return w; };
  function toks(word) {
    // ハイフン・コロン・数字と文字のさかい目で分ける（twenty-six → twenty six、3-D → 3 d、7:30 → 7 30）
    const parts = String(word).toLowerCase().replace(/[’‘]/g, "'").replace(/[-:\/]/g, ' ').replace(/(\d)(?=[a-z])(?!(st|nd|rd|th)\b)/g, '$1 ').replace(/([a-z])(?=\d)/g, '$1 ').split(/\s+/);
    const out = [];
    for (const p of parts) {
      let w = p.replace(/[^a-z0-9']/g, '');
      if (!w) continue;
      const ord = w.match(/^(\d+)(st|nd|rd|th)$/);
      if (ord) { out.push(...ordWords(Number(ord[1]))); continue; }
      if (/^\d+$/.test(w)) { out.push(...numWords(Number(w))); continue; }
      if (CONTR[w]) { out.push(...CONTR[w].split(' ')); continue; }
      w = w.replace(/n't$/, ' not').replace(/'re$/, ' are').replace(/'ve$/, ' have').replace(/'ll$/, ' will').replace(/'d$/, ' would').replace(/'m$/, ' am').replace(/'s$/, 's').replace(/'/g, '');
      out.push(...w.split(' ').filter(Boolean));
    }
    return out;
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

  // 🌸 合格の花吹雪（big：本番のクリア＝たくさん・大きな文字つき）
  function celebrate(big, text) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = document.createElement('canvas'); cv.className = 'rd-confetti';
    const W = cv.width = innerWidth * (devicePixelRatio || 1), H = cv.height = innerHeight * (devicePixelRatio || 1);
    document.body.append(cv);
    const g = cv.getContext('2d'), dpr = devicePixelRatio || 1;
    const COLORS = ['#ff8fb1', '#ffc2d6', '#ffd43b', '#4dabf7', '#69db7c', '#b197fc', '#ffa94d'];
    const N = big ? 160 : 70, ps = [];
    for (let i = 0; i < N; i++) {
      const petal = Math.random() < 0.55;
      ps.push({ x: Math.random() * W, y: -Math.random() * H * 0.6 - 20, vx: (Math.random() - 0.5) * 2.2 * dpr, vy: (1.6 + Math.random() * 2.6) * dpr, r: (petal ? 7 + Math.random() * 6 : 4 + Math.random() * 4) * dpr,
        a: Math.random() * Math.PI * 2, va: (Math.random() - 0.5) * 0.2, sw: Math.random() * Math.PI * 2, petal, c: petal ? COLORS[Math.random() < 0.7 ? 0 : 1] : COLORS[Math.floor(Math.random() * COLORS.length)] });
    }
    if (big && text) { const b = document.createElement('div'); b.className = 'rd-banner'; b.textContent = text; document.body.append(b); setTimeout(() => b.remove(), 3200); }
    const t0 = performance.now(), DUR = big ? 4200 : 2800;
    (function frame(now) {
      const t = now - t0;
      g.clearRect(0, 0, W, H);
      g.globalAlpha = t > DUR - 700 ? Math.max(0, (DUR - t) / 700) : 1;
      for (const p of ps) {
        p.sw += 0.05; p.x += p.vx + Math.sin(p.sw) * 0.8 * dpr; p.y += p.vy; p.a += p.va;
        g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c;
        if (p.petal) { g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(-p.r * 0.3, -p.r * 0.1, p.r * 0.35, p.r * 0.18, 0, 0, Math.PI * 2); g.fill(); }
        else g.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
        g.restore();
      }
      if (t < DUR) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  function create({ api, toast, getUser, onClose, onActivity }) {
    // いま何をしているか（先生・オーナーの画面に出す）
    const act = (kind, title) => { if (onActivity) onActivity(kind, title || ''); };
    const st = { units: [], unit: null, rec: null, recording: false, finals: [], interim: '', startAt: 0, lastAt: 0, timer: null, showJa: false, result: null };
    const root = $('#reading');

    async function open() {
      root.hidden = false;
      showList();
      try { const d = await api('GET', '/api/reading/units'); st.units = d.units; PASS = d.passScore || 90; showList(); } catch (e) { toast(e.message); }
    }
    function close() { stopRec(true); root.hidden = true; act(null); if (window.speechSynthesis) speechSynthesis.cancel(); if (onClose) onClose(); }
    $('#rd-close').onclick = close;
    $('#rd-back').onclick = () => { stopRec(true); showList(); };

    function showList() {
      st.unit = null; act('rd-list');
      $('#rd-back').hidden = true; $('#rd-title').textContent = '🔁 音読の練習';
      const body = $('#rd-body'); body.textContent = '';
      if (!SR) body.append(el('p', 'rd-warn', 'この端末（ブラウザ）では英語の聞き取りが使えません。iPad・iPhone は Safari、パソコン・Android は Chrome で開いてください。お手本を聞くことはできます。'));
      if (!st.units.length) { body.append(el('p', 'muted', 'まだ練習できる単元がありません。先生が登録するまで待ってね。')); return; }
      body.append(el('p', 'muted', `①「英文で練習」→ ②「訳だけで練習」（日本語訳だけを見て英語を言う）→ ③ 本番のテスト（訳だけ）。②で${PASS}点以上・時間内を出すと、テストを受けられるよ。`));
      const list = el('div', 'rd-units');
      const staff = getUser().role !== 'student';
      for (const u of st.units) {
        const row = el('div', 'rd-unit');
        const showGrade = staff || u.grade !== getUser().grade; // 小学生が中1の単元をえらぶとき、学年を出す
        const left = el('span'); left.append(el('b', null, (showGrade && !staff ? `【${u.grade}】` : '') + u.title), el('small', null, `${staff ? u.grade + '・' : ''}${u.words}語・⏱ ${mmss(u.limit)}`));
        const st2 = el('small', 'rd-status');
        st2.textContent = u.test.passed ? `🏅 テストクリア（${u.test.best}点）`
          : u.practice.passed ? `✅ 訳だけで合格 → テストへ！（クリアで +${u.test.nextPoints}pt）`
          : u.practice.enPassed ? `✅ 英文で合格 → 次は「訳だけ」で練習（${u.practice.best != null ? u.practice.best + '点' : 'まだ'}）`
          : u.practice.count ? `英文で練習 ${u.practice.enBest}点（${u.practice.count}回）` : 'はじめて';
        left.append(st2);
        const btns = el('span', 'rd-unit-btns');
        const p = el('button', 'btn small secondary', '🔤 英文で練習'); p.type = 'button'; p.onclick = () => showUnit(u, 'practice');
        const j = el('button', 'btn small secondary', '🇯🇵 訳だけで練習'); j.type = 'button'; j.onclick = () => showUnit(u, 'jaPractice');
        const t = el('button', 'btn small', '📝 テスト'); t.type = 'button';
        t.disabled = !(u.practice.passed || staff);
        t.title = t.disabled ? `「訳だけで練習」で${PASS}点以上・時間内を出すと受けられるよ` : '';
        t.onclick = () => showUnit(u, 'test');
        btns.append(p, j, t);
        // ✍️ ライティング（音読テストに合格した単元）
        if (u.test.passed || staff) {
          const wr = u.writing || {};
          const wp = el('button', 'btn small secondary', '✍️ 書く練習'); wp.type = 'button'; wp.onclick = () => showUnit(u, 'wPractice');
          const wt = el('button', 'btn small', '📝 ライティング'); wt.type = 'button';
          wt.disabled = !(wr.practicePassed || staff); wt.title = wt.disabled ? '書く練習で100点を出すと受けられるよ' : '';
          wt.onclick = () => showUnit(u, 'wTest');
          const br = el('span', 'rd-break'); btns.append(br, wp, wt);
          const ws = el('small', 'rd-status');
          ws.textContent = wr.testPassed ? `✍️🏅 ライティングクリア` : wr.practicePassed ? `✍️ 書く練習で100点 → ライティングへ！（クリアで +${wr.nextPoints}pt）` : wr.practiceCount ? `✍️ 書く練習 ${wr.practiceBest}点（${wr.practiceCount}回）` : '✍️ 次はライティング（書く練習から）';
          left.append(ws);
        }
        row.append(left, btns); list.append(row);
      }
      body.append(list);
    }

    function showUnit(u, mode = 'practice') {
      st.unit = u; st.result = null; st.showJa = false; st.mode = mode;
      act(({ practice: 'rd-practice', jaPractice: 'rd-ja', test: 'rd-test', wPractice: 'w-practice', wTest: 'w-test' })[mode], u.title);
      if (mode === 'wPractice' || mode === 'wTest') { st.wres = null; st.wimg = null; $('#rd-back').hidden = false; $('#rd-title').textContent = (mode === 'wTest' ? '📝 ライティング：' : '✍️ 書く練習：') + u.title; return renderWriting(); }
      if (mode === 'test') prepareTest(); // iPhone・iPad：ボタンを押したその場でマイクを始めるため、合言葉は先にもらっておく
      $('#rd-back').hidden = false; $('#rd-title').textContent = ({ test: '📝 テスト：', jaPractice: '🇯🇵 訳だけで練習：', practice: '🔤 英文で練習：' })[mode] + u.title;
      render();
    }
    // ═════ ✍️ ライティング：日本語訳を見てノートに書く → 撮る → 文字を読み取ってくらべる ═════
    const W_LABEL = { case: '大文字・小文字', punct: 'ピリオド・？・アポストロフィなど', spell: 'つづり', missing: '書いていない' };
    function renderWriting() {
      const u = st.unit, r = st.wres, body = $('#rd-body'); body.textContent = '';
      const test = st.mode === 'wTest';
      body.append(el('p', 'muted', r ? '' : `日本語訳を見て、ノートに英文を書こう（時間は自由）。大文字・小文字、ピリオド・？・アポストロフィ（'）もしっかり。話す人の名前は書かなくていいよ。書けたら「📸 ノートを撮る」。100点で${test ? 'クリア' : '合格'}！`));
      const pas = el('div', 'rd-passage');
      let k = 0;
      for (const line of u.lines) {
        const row = el('div', 'rd-line');
        if (line.speaker) row.append(el('span', 'rd-speaker', line.speaker));
        if (!r) row.append(el('p', 'rd-ja big', line.ja || '（この文の訳はまだありません）'));
        else {
          const en = el('p', 'rd-en');
          for (const tok of String(line.en).split(/\s+/).filter(Boolean)) {
            const w = r.words[k++] || { status: 'ok' };
            const span = el('span', w.status === 'ok' ? null : 'w-' + w.status, tok + ' ');
            if (w.status !== 'ok') span.title = `${W_LABEL[w.status]}${w.got ? `：あなたは「${w.got}」` : ''}`;
            en.append(span);
          }
          row.append(en);
          if (line.ja) row.append(el('p', 'rd-ja', line.ja));
        }
        pas.append(row);
      }
      body.append(pas);
      if (r) {
        const res = el('div', 'rd-result' + (r.passed ? ' ok' : ''));
        res.append(el('b', 'rd-score', `${r.score}点`), el('span', null, test ? `ライティング（${r.attempt}回目）` : '書く練習'));
        const bad = r.words.filter(w => w.status !== 'ok');
        res.append(el('p', null, r.passed ? (test ? (r.points ? `🎉 クリア！ +${r.points}ポイント！` : r.alreadyCleared ? '🎉 クリア！（この単元はもうポイントをもらっているよ）' : '🎉 クリア！') : '🎉 100点！ ライティングを受けられるよ') : `${test ? '🔁 再テスト' : '🔁 もう一度'}：あと${bad.length + r.extra.length}か所。${bad.some(w => w.status === 'missing') ? '抜けている単語があります。' : ''}下をたしかめて、書きなおしてね`));
        for (const st3 of ['spell', 'missing', 'case', 'punct']) {
          const list = bad.filter(w => w.status === st3);
          if (list.length) res.append(el('small', 'rd-sub w-sum-' + st3, `${({ spell: '✏️', missing: '🔇', case: '🔠', punct: '❗' })[st3]} ${W_LABEL[st3]}：${list.slice(0, 10).map(w => w.got ? `${w.got} → ${w.ref}` : w.ref).join('・')}${list.length > 10 ? ' ほか' : ''}`));
        }
        if (r.extra.length) res.append(el('small', 'rd-sub', `➕ 本文にない単語：${r.extra.slice(0, 10).join('・')}`));
        res.append(el('small', 'rd-sub', `📄 読み取った文：${(r.written || []).join(' / ').slice(0, 300)}`));
        res.append(el('small', 'rd-sub', '字がちゃんと読み取られていないときは、明るいところで、ノートをまっすぐ撮りなおしてね'));
        body.append(res);
        if (!test && r.passed) { const go = el('button', 'btn small', '📝 ライティングへ'); go.type = 'button'; go.onclick = () => showUnit(u, 'wTest'); body.append(go); }
      }
      if (st.wimg) { const im = el('img', 'w-preview'); im.src = st.wimg.url; im.alt = 'ノートの写真'; body.append(im); }
      const btns = el('div', 'rd-btns');
      const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.setAttribute('capture', 'environment'); file.hidden = true;
      const shot = el('button', 'btn rd-big' + (st.wimg ? ' secondary' : ''), st.wimg ? '📸 撮りなおす' : r ? '📸 書きなおして撮る' : '📸 ノートを撮る'); shot.type = 'button'; shot.onclick = () => file.click();
      file.onchange = () => {
        const f = file.files[0]; if (!f) return;
        const im = new Image();
        im.onload = () => {
          const k2 = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas');
          cv.width = Math.round(im.naturalWidth * k2); cv.height = Math.round(im.naturalHeight * k2);
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(im.src);
          cv.toBlob(b => { if (st.wimg) URL.revokeObjectURL(st.wimg.url); st.wimg = { blob: b, url: URL.createObjectURL(b) }; st.wres = null; renderWriting(); }, 'image/jpeg', 0.85);
        };
        im.src = URL.createObjectURL(f);
      };
      btns.append(file, shot);
      if (st.wimg) {
        const send = el('button', 'btn rd-big', st.wsending ? '読み取り中…' : '✅ 採点する'); send.type = 'button'; send.disabled = !!st.wsending;
        send.onclick = async () => {
          st.wsending = true; renderWriting();
          try {
            const res = await fetch(`/api/reading/writing?unitId=${u.id}&mode=${test ? 'test' : 'practice'}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: st.wimg.blob });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || '採点できませんでした');
            st.wres = d; URL.revokeObjectURL(st.wimg.url); st.wimg = null;
            if (d.passed) celebrate(test, test ? (d.points ? `✍️ ライティングクリア！ +${d.points}ポイント` : '✍️ ライティングクリア！') : null);
            const wr = u.writing || (u.writing = {});
            if (test) { wr.testCount = (wr.testCount || 0) + 1; if (d.passed) wr.testPassed = true; if (d.points) toast(`🏅 ライティングクリア！ +${d.points}ポイント`, 6000); }
            else { wr.practiceCount = (wr.practiceCount || 0) + 1; wr.practiceBest = Math.max(wr.practiceBest || 0, d.score); if (d.passed) wr.practicePassed = true; }
          } catch (e) { toast(e.message, 6000); }
          st.wsending = false; renderWriting();
        };
        btns.append(send);
      }
      body.append(btns);
    }

    function render() {
      const u = st.unit, r = st.result, body = $('#rd-body'); body.textContent = '';
      const top = el('div', 'rd-top');
      const timer = el('span', 'rd-timer', `⏱ ${mmss(st.recording ? (Date.now() - st.startAt) / 1000 : r ? r.seconds : 0)} / ${mmss(u.limit)}`); timer.id = 'rd-timer';
      const ja = el('button', 'btn small secondary', st.showJa ? '👀 訳をかくす' : '👀 訳を見る'); ja.type = 'button';
      ja.onclick = () => { st.showJa = !st.showJa; render(); };
      const test = st.mode === 'test';
      const jaOnly = st.mode === 'test' || st.mode === 'jaPractice'; // 日本語訳だけを見て英語を言う（終わったら英文と赤い単語を見せる）
      const hideEn = jaOnly && !r;
      ja.hidden = jaOnly;
      const model = el('button', 'btn small secondary', '🔊 お手本'); model.type = 'button'; model.onclick = speakModel; model.hidden = !window.speechSynthesis || hideEn;
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
          if (clean) {
            if (r && !r.ok[wi]) {
              const a = r.acc ? r.acc[wi] : null;
              const weak = a !== null && a !== undefined; // 言えたが発音があやしい（テストだけわかる）
              span.className = weak ? 'weak' : 'ng'; bad = true;
              span.title = weak ? `発音 ${a}点（押すとお手本）` : '言えていない・聞き取れなかった（押すとお手本）';
              span.onclick = () => { speakWord(clean); toast(weak ? `「${clean}」発音 ${a}点` : `「${clean}」は聞き取れなかったよ`, 2500); };
            }
            wi++;
          }
          en.append(span);
        }
        if (hideEn) row.append(el('p', 'rd-ja big', line.ja || '（この文の訳はまだありません）'));
        else { row.append(en); if (line.ja && (st.showJa || bad || jaOnly)) row.append(el('p', 'rd-ja', line.ja)); }
        pas.append(row);
      }
      body.append(pas);
      const live = el('p', 'rd-live'); live.id = 'rd-live'; live.hidden = !st.recording; live.textContent = st.interim ? `🎧 ${st.interim}` : '🎧 聞いています…';
      body.append(live);
      if (r) {
        const res = el('div', 'rd-result' + (r.passed ? ' ok' : ''));
        res.append(el('b', 'rd-score', `${r.score}点`), el('span', null, `時間 ${mmss(r.seconds)}（制限 ${mmss(u.limit)}）`));
        if (test && r.accuracy != null) res.append(el('small', 'rd-sub', `発音の正確さ ${r.accuracy}・なめらかさ ${r.fluency}・読みもれなし ${r.completeness}`));
        if (test && r.heard != null) res.append(el('small', 'rd-sub', `🎧 聞き取った英語：${r.heard || '（なし）'}`));
        const msg = test
          ? (r.passed ? (r.points ? `🎉 クリア！（${r.attempt}回目） +${r.points}ポイント！` : r.alreadyCleared ? '🎉 クリア！（この単元はもうポイントをもらっているよ）' : '🎉 クリア！') : r.score < PASS ? '下の「言えていない単語」「発音をもう少し」をたしかめてから、もう一度！' : `点数はOK！ 制限時間（${mmss(u.limit)}）の中で読めるように、もう一度`)
          : st.mode === 'practice' ? (r.passed ? '🎉 英文で合格！ 次は「訳だけ」で言えるか練習しよう' : r.score < PASS ? `赤い単語を、お手本を聞いてからもう一度！ ${PASS}点まであと少し` : `点数はOK！ 制限時間（${mmss(u.limit)}）の中で読めるように、もう一度`)
          : (r.passed ? '🎉 訳だけで合格！ 本番のテストを受けられるよ' : r.score < PASS ? `赤い単語を、お手本を聞いてからもう一度！ ${PASS}点まであと少し` : `点数はOK！ 制限時間（${mmss(u.limit)}）の中で読めるように、もう一度`);
        const missFail = !r.passed && r.missing >= MAX_MISS && r.score >= PASS && r.seconds <= u.limit;
        res.append(el('p', null, missFail ? `🔁 再テスト：聞き取れなかった単語が${r.missing}つ（3つ以上は再テスト）。点数はOKなので、赤い単語（the・a なども）をはっきり言おう！` : msg));
        // 何がいけなかったか：言えていない単語・発音をもう少しの単語
        const words = wordsOf(u.lines.map(l => l.en).join(' '));
        const miss = [], weak = [];
        words.forEach((w, i) => { if (r.ok[i]) return; const a = r.acc ? r.acc[i] : null; if (a !== null && a !== undefined) weak.push(`${w}（${a}点）`); else miss.push(w); });
        if (miss.length) res.append(el('small', 'rd-sub' + (miss.length >= MAX_MISS ? ' w-alert' : ''), `🔇 言えていない・聞き取れなかった単語（赤）：${miss.length}語${miss.length >= MAX_MISS ? '（3つ以上なので再テスト）' : '（3つ以上で再テスト）'} … ${miss.slice(0, 12).join('・')}${miss.length > 12 ? ' ほか' : ''}`));
        if (weak.length) res.append(el('small', 'rd-sub', `🗣 発音をもう少し（オレンジ）：${weak.slice(0, 10).join('・')}${weak.length > 10 ? ' ほか' : ''}`));
        if (r.seconds > u.limit) res.append(el('small', 'rd-sub', `⏱ 時間が ${r.seconds - u.limit}秒 オーバー`));
        if (miss.length || weak.length) res.append(el('small', 'rd-sub', '色のついた単語を押すと、お手本の発音が聞けるよ'));
        body.append(res);
        if (st.mode === 'practice' && r.passed) { const go = el('button', 'btn small', '🇯🇵 訳だけで練習へ'); go.type = 'button'; go.onclick = () => showUnit(u, 'jaPractice'); body.append(go); }
        if (st.mode === 'jaPractice' && r.passed) { const go = el('button', 'btn small', '📝 本番のテストへ'); go.type = 'button'; go.onclick = () => showUnit(u, 'test'); body.append(go); }
      }
      const btns = el('div', 'rd-btns');
      if (st.recording) { const stop = el('button', 'btn rd-big', '⏹ 読みおわった'); stop.type = 'button'; stop.onclick = () => finish(); btns.append(stop); }
      else if (st.scoring) { const w = el('button', 'btn rd-big', '採点中…'); w.type = 'button'; w.disabled = true; btns.append(w); }
      else if (test) { const go = el('button', 'btn rd-big', st.preparing ? '準備中…' : !prep ? '🔄 準備する' : r ? '📝 もう一度テスト' : '📝 テストを始める'); go.type = 'button'; go.disabled = !!st.preparing; go.onclick = startTest; btns.append(go); }
      else { const go = el('button', 'btn rd-big', r ? '🔁 もう一度読む' : '🎤 読みはじめる'); go.type = 'button'; go.disabled = !SR; go.onclick = startRec; btns.append(go); }
      body.append(btns);
      if (!SR && !test) body.append(el('p', 'rd-warn', 'この端末では聞き取りが使えません（Safari か Chrome で開いてください）'));
      if (test && !st.recording && !r) body.append(el('p', 'muted', `日本語訳を見て、英語で言おう。Microsoft の音声サービスが発音を採点します。${PASS}点以上・時間内でクリア！`));
      if (st.mode === 'jaPractice' && !st.recording && !r) body.append(el('p', 'muted', '本番と同じように、日本語訳だけを見て英語で言おう。終わったら英文と、言えなかった単語が出るよ。'));
    }

    function speakWord(w) {
      if (!window.speechSynthesis) return;
      speechSynthesis.cancel();
      const ut = new SpeechSynthesisUtterance(w); ut.lang = 'en-US'; ut.rate = 0.8;
      const v = speechSynthesis.getVoices().find(x => /^en(-|_)US/i.test(x.lang)); if (v) ut.voice = v;
      speechSynthesis.speak(ut);
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
      const missing = g.ok.filter(x => !x).length; // 練習（無料の聞き取り）では赤＝聞き取れなかった単語
      const passed = g.score >= PASS && seconds <= st.unit.limit && missing < MAX_MISS;
      st.result = { ...g, seconds, passed, missing };
      st.interim = '';
      render();
      if (passed) celebrate(false);
      try {
        const jaOnly = st.mode === 'jaPractice';
        const r = await api('POST', '/api/reading/practice', { unitId: st.unit.id, score: g.score, seconds, jaOnly, missing });
        const pr = st.unit.practice; pr.count++;
        if (jaOnly) { pr.best = Math.max(pr.best || 0, g.score); if (r.passed) pr.passed = true; }
        else { pr.enBest = Math.max(pr.enBest || 0, g.score); if (r.passed) pr.enPassed = true; }
      } catch (e) { toast(e.message); }
    }
    // ═════ 本番のテスト：Microsoft の発音評価 ═════
    let sdkLoading = null;
    function loadSdk() {
      if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
      if (!sdkLoading) sdkLoading = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/vendor/speech-sdk.js'; sc.onload = () => res(window.SpeechSDK); sc.onerror = () => { sdkLoading = null; rej(new Error('採点のしくみを読みこめませんでした')); }; document.head.append(sc); });
      return sdkLoading;
    }
    let prep = null; // { sdk, tk, at }
    async function prepareTest() {
      if (prep && Date.now() - prep.at < 7 * 60e3) return prep;
      st.preparing = true; if (st.unit) render();
      try { const [sdk, tk] = await Promise.all([loadSdk(), api('GET', '/api/reading/speech-token')]); prep = { sdk, tk, at: Date.now() }; }
      catch (e) { prep = null; toast(e.message, 6000); }
      st.preparing = false; if (st.unit && !st.recording) render();
      return prep;
    }
    function startTest() {
      if (st.recording || st.preparing || st.scoring) return;
      if (window.speechSynthesis) speechSynthesis.cancel();
      if (!prep || Date.now() - prep.at > 7 * 60e3) { prepareTest(); return; } // 準備ができたら、もう一度押してもらう
      const { sdk, tk } = prep;
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
      st.heardAny = false;
      recog.recognizing = (_s, e) => { st.interim = e.result.text || ''; if (st.interim) st.heardAny = true; const live = $('#rd-live'); if (live) live.textContent = `🎧 ${st.interim.slice(-80)}`; };
      st.heardText = '';
      recog.recognized = (_s, e) => {
        if (e.result.reason !== sdk.ResultReason.RecognizedSpeech || !e.result.text) return;
        st.heardAny = true;
        st.heardText = (st.heardText + ' ' + e.result.text).trim();
        // 発音の点：① SDK の読み取り ② 返ってきた JSON ③ どちらもないときは文字だけ（点は文の正確さ）
        let pa = null, detail = null;
        try { pa = sdk.PronunciationAssessmentResult.fromResult(e.result); } catch (er) {}
        try { detail = JSON.parse(e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult)); } catch (er) {}
        const nb = detail && detail.NBest && detail.NBest[0];
        const segAcc = pa && pa.accuracyScore != null ? pa.accuracyScore : nb && nb.PronunciationAssessment ? nb.PronunciationAssessment.AccuracyScore : null;
        const segFlu = pa && pa.fluencyScore != null ? pa.fluencyScore : nb && nb.PronunciationAssessment ? nb.PronunciationAssessment.FluencyScore : (nb && nb.FluencyScore) || null;
        let rawWords = (pa && pa.detailResult && pa.detailResult.Words) || (nb && nb.Words) || [];
        let words = rawWords.map(w => { const a = w.PronunciationAssessment || {}; return { word: w.Word, acc: a.AccuracyScore != null ? a.AccuracyScore : (w.AccuracyScore != null ? w.AccuracyScore : segAcc != null ? segAcc : 80), err: a.ErrorType || w.ErrorType || 'None' }; });
        words = words.filter(w => w.err !== 'Omission'); // 読みもれの印は、こちらで数えるのでのぞく
        if (!words.length) words = e.result.text.split(/\s+/).filter(Boolean).map(t => ({ word: t, acc: segAcc != null ? segAcc : 80, err: 'None' }));
        st.segs.push({ words, fluency: segFlu != null ? segFlu : 80 });
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
    // 本番の点数（やさしめ）
    // - 言い直しOK：同じ単語を何回か言ったら、いちばんよく言えたものを使う（言い直した分は減点しない）
    // - 単語ごと：発音60点以上なら満点あつかい、40〜59は7割、それより下は4割、言えていなければ0
    // - 総合 ＝ 単語の点の平均 ×0.9 ＋ なめらかさ ×0.1（なめらかさはほとんど影響しない）
    function scoreTest() {
      const words = wordsOf(st.unit.lines.map(l => l.en).join(' '));
      const P = [], owner = [];
      words.forEach((w, i) => toks(w).forEach(t => { P.push(t); owner.push(i); }));
      const H = [];
      for (const sg of st.segs) for (const w of sg.words) for (const t of toks(w.word)) H.push({ t, acc: w.err === 'Mispronunciation' ? Math.min(w.acc, 59) : w.acc });
      const n = P.length, m = H.length;
      const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = P[i] === H[j].t ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      const accOf = new Array(n).fill(null);
      for (let i = 0, j = 0; i < n && j < m;) {
        if (P[i] === H[j].t) {
          // 言い直し：近く（前後4語）で同じ単語を言っていたら、いちばんよい発音の点
          let best = H[j].acc;
          for (let k = Math.max(0, j - 4); k <= Math.min(m - 1, j + 4); k++) if (H[k].t === P[i]) best = Math.max(best, H[k].acc);
          accOf[i] = best; i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
      }
      const wAcc = words.map(() => []);
      accOf.forEach((a, k) => wAcc[owner[k]].push(a));
      const per = wAcc.map(list => list.some(a => a === null) ? null : list.reduce((x, y) => x + y, 0) / list.length);
      const matched = per.filter(a => a !== null);
      const accuracy = matched.length ? Math.round(matched.reduce((x, y) => x + y, 0) / matched.length) : 0;
      const completeness = words.length ? Math.round(matched.length / words.length * 100) : 0;
      let fw = 0, fs = 0; for (const sg of st.segs) { fw += sg.words.length; fs += sg.fluency * sg.words.length; }
      const fluency = fw ? Math.round(fs / fw) : 0;
      const credit = per.map(a => a === null ? 0 : a >= 60 ? 100 : a >= 40 ? 70 : 40);
      const wordScore = credit.length ? credit.reduce((x, y) => x + y, 0) / credit.length : 0;
      const score = Math.min(100, Math.round(wordScore * 0.9 + fluency * 0.1));
      return { score, accuracy, fluency, completeness, ok: per.map(a => a !== null && a >= 60), acc: per.map(a => a === null ? null : Math.round(a)) };
    }
    async function finishTest() {
      const pressedSec = (Date.now() - st.startAt) / 1000;
      const rec = st.rec;
      clearInterval(st.timer); st.recording = false; st.scoring = true; st.rec = null; render();
      // 最後の部分の採点がとどくのを待ってから計算する
      await new Promise((res) => {
        let done = false; const end = () => { if (!done) { done = true; setTimeout(res, 600); } };
        // セッションが終わったとき（最後の結果のあと）まで待つ。来なければ最大7秒
        try { rec.azure.sessionStopped = () => end(); } catch (e) {}
        try { rec.azure.stopContinuousRecognitionAsync(() => { setTimeout(end, 1500); }, () => end()); } catch (e) { end(); }
        setTimeout(end, 7000);
      });
      try { rec.azure.close(); } catch (e) {}
      st.scoring = false;
      if (!st.segs.length) { // 声がとどいていない：記録しない（テストの回数にも数えない）
        st.interim = ''; render();
        toast(st.heardAny ? '採点の結果がとどきませんでした。もう一度ためしてね' : '声が聞きとれませんでした。マイクを許可しているか、iPad・iPhone の音量・マナーモードではなくマイクの近くで話しているか確かめて、もう一度ためしてね', 8000);
        return;
      }
      const seconds = Math.max(1, Math.round(st.lastEnd || pressedSec));
      const g = scoreTest();
      const missing = g.acc.filter(a => a === null).length; // 聞き取れなかった単語（the・a なども）
      st.result = { ...g, seconds, missing, passed: g.score >= PASS && seconds <= st.unit.limit && missing < MAX_MISS, heard: (st.heardText || '').slice(0, 400) };
      st.interim = '';
      render();
      try {
        const r = await api('POST', '/api/reading/test', { unitId: st.unit.id, score: g.score, accuracy: g.accuracy, fluency: g.fluency, completeness: g.completeness, seconds, missing });
        Object.assign(st.result, { points: r.points, attempt: r.attempt, alreadyCleared: r.alreadyCleared, passed: r.passed });
        st.unit.test.count++; st.unit.test.best = Math.max(st.unit.test.best || 0, g.score);
        if (r.passed) st.unit.test.passed = true;
        if (r.passed) celebrate(true, r.points ? `🎉 クリア！ +${r.points}ポイント` : '🎉 クリア！');
        if (r.points) toast(`🏅 テストクリア！ +${r.points}ポイント`, 6000);
        render();
      } catch (e) { toast(e.message); }
    }

    return { open, close, _grade: grade };
  }
  window.Reading = { create, grade, toks, celebrate };
})();
