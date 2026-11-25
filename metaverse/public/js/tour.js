// ようこそツアー：はじめてログインしたときに1回だけ。説明しているボタンを光らせて、カードで順番に教える
// window.Tour.start(kind, { onDone }) kind: 'es' | 'jh' | 'hs' | 'parent' | 'staff'
(function () {
  const STEPS = {
    es: [
      { t: '🎒 三浦塾オンラインへ ようこそ！', b: 'ここは、みんなといっしょに勉強する「オンラインの塾」だよ。使い方をかんたんに教えるね。' },
      { sel: '#btn-rooms', t: '小学生自習室へ', b: '「へや」をおして「🎒 小学生自習室」をえらぶと、自分で歩いて行くよ。' },
      { sel: '#btn-sit', t: '席にすわろう', b: 'すわっているあいだ、勉強時間がたまるよ。立ったままだと10秒でお知らせが出るよ。' },
      { t: '見守りカメラ', b: '自習室に入ると「カメラをオンにする」が出るよ。ノートがうつるところにおいてね。写真は先生だけが見るよ。' },
      { sel: '#goal-chip', t: '今日の目標', b: '写真をとるときに決めた「今日は何分やる？」の、のこりの時間が出るよ。たっせいすると名前に✅！' },
      { sel: '#pts-chip', t: 'ポイント', b: '⬆ が出ているあいだ、10分で1ポイントたまるよ（⏸ のときはたまらない）。おすと、ポイントでおしゃれとこうかんできるよ。' },
      { sel: '#me-btn', t: 'メニュー', b: '自分の名前をおすとメニュー。「❓ 使い方」で、このせつめいをいつでも見られるよ。今日もいっしょにがんばろう！' },
    ],
    jh: [
      { t: '📚 三浦塾オンラインへようこそ！', b: '家での勉強は、部活でいう「自主練」。みんなと同じ時間に、同じ場所で、自主練を当たり前にしよう。' },
      { sel: '#btn-rooms', t: '中学生自習室へ', b: '「へや」から「📚 中学生自習室」をえらぶと、自動で歩いて行きます。' },
      { sel: '#btn-sit', t: 'すわって開始', b: 'すわっているあいだ、自習時間を記録します。10秒立ち歩くと席えらびが出ます。' },
      { t: '見守りカメラ', b: '自習室では、ランダムな時間に写真が先生だけに届きます。ノートと手元がうつるように置いてください。' },
      { sel: '#pts-chip', t: 'ポイント', b: '⬆ のときは10分で1ポイント、⏸ のときは時間帯の外などでふえていません。押すと着せかえのショップが開きます。' },
      { sel: '#fun-chip', t: '🔥 と季節のクエスト', b: '学年の最低時間をこえた日が続くと🔥がふえます。30日続くと自分だけの「VIP席」。季節のクエストは左上に「○/15日」と出ます。' },
      { t: '先生と話す', b: '自習室はしずかに集中。先生が近くに来たら、💬吹き出しやスタンプで質問できます。' },
      { sel: '#me-btn', t: 'メニュー', b: '名前を押すとメニュー。VIP席・目標・学年の木・「❓ 使い方」があります。' },
    ],
    hs: [
      { t: '☕ 三浦塾オンラインへようこそ！', b: '高校生は「高校生自習室」で、自分のペースで勉強します。' },
      { sel: '#btn-rooms', t: '高校生自習室へ', b: '「へや」から「☕ 高校生自習室」をえらびます。' },
      { t: '今日やること', b: '高校生自習室に入ると「今日やること」を3つ書きます。名前の上に出るので、宣言して始めよう。' },
      { sel: '#btn-sit', t: 'すわって開始', b: 'すわっているあいだ、自習時間を記録します。' },
      { sel: '#week-chip', t: '週のメダル', b: '月〜日の合計で🥉🥈🥇。🥉以上の週が続くと🔥（週）がふえて、4週続くとVIP席をえらべます。' },
      { sel: '#pts-chip', t: 'ポイント', b: '⬆ のときは10分で1ポイント。メダルのボーナスもあります。押すとショップ。' },
      { sel: '#me-btn', t: 'メニュー', b: '名前を押すとメニュー。「❓ 使い方」でいつでも見直せます。' },
    ],
    parent: [
      { t: '👪 保護者の方へ', b: '三浦塾オンラインへようこそ。お子さんが勉強している様子を、ロビーからのぞくことができます。' },
      { sel: '#visit-chip', t: '1日1回・10分', b: 'ロビーには1日1回、10分入れます。のこり時間はここに出ます。' },
      { sel: '#me-btn', t: '👦🏻 わが子 👧🏻', b: '右上を押すと、お子さんの今日・今週の自習時間、🔥、足あとカレンダー、成績、テスト対策が見られます。「見たよ」スタンプを送ると、ロビーの家族の木に🌸が咲きます。「❓ 使い方」もここにあります。' },
      { sel: '#btn-pshop', t: 'ポイントと着せかえ', b: 'ポイントで、アバターの着せかえができます。' },
    ],
    staff: [
      { t: '👔 先生用のかんたんガイド', b: '生徒の様子を見て、声をかけるための使い方です。' },
      { sel: '#btn-people', t: '入室者・見守り', b: 'だれがどの部屋にいるかの一覧です。「📷 見守り」タブで、自習室のカメラの写真が見られます。' },
      { sel: '#btn-hands', t: '挙手', b: '授業中に手をあげた生徒の一覧です。「近くへ」で生徒のそばへ行けます。' },
      { t: '生徒と話す', b: '生徒の近く（3マス以内）に行くと、生徒が💬吹き出し・スタンプで返事できます。生徒をタップすると🎧個別通話も。' },
      { sel: '#btn-overview', t: '見わたす', b: '塾の中全体を見わたせます。' },
      { sel: '#me-btn', t: 'メニュー', b: '管理画面（がんばり・ユーザーなど）はメニューから。「❓ 使い方」で、生徒・保護者のガイドも見られます。' },
    ],
  };
  const $ = (s) => document.querySelector(s);
  let cur = null;
  const visible = (el) => { if (!el || el.hidden || el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function build() {
    let root = $('#tour');
    if (root) return root;
    root = document.createElement('div'); root.id = 'tour'; root.className = 'tour';
    root.innerHTML = '<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-live="polite"><div class="tour-step"></div><h3 class="tour-title"></h3><p class="tour-body"></p><div class="tour-btns"><button type="button" class="btn secondary small tour-skip">スキップ</button><span></span><button type="button" class="btn secondary small tour-prev">もどる</button><button type="button" class="btn small tour-next">つぎへ</button></div></div>';
    document.body.append(root);
    root.querySelector('.tour-next').onclick = () => go(cur.i + 1);
    root.querySelector('.tour-prev').onclick = () => go(cur.i - 1);
    root.querySelector('.tour-skip').onclick = () => end();
    window.addEventListener('resize', () => { if (cur) go(cur.i); });
    return root;
  }
  function go(i) {
    const root = build(), steps = cur.steps;
    if (i >= steps.length) return end();
    if (i < 0) i = 0;
    cur.i = i;
    const s = steps[i], target = s.sel ? $(s.sel) : null, hole = root.querySelector('.tour-hole'), card = root.querySelector('.tour-card');
    root.querySelector('.tour-step').textContent = `${i + 1} / ${steps.length}`;
    root.querySelector('.tour-title').textContent = s.t;
    root.querySelector('.tour-body').textContent = s.b;
    root.querySelector('.tour-prev').hidden = i === 0;
    root.querySelector('.tour-next').textContent = i === steps.length - 1 ? 'はじめる！' : 'つぎへ';
    card.style.left = card.style.top = card.style.bottom = ''; card.classList.remove('center');
    if (visible(target)) {
      const r = target.getBoundingClientRect(), pad = 6;
      Object.assign(hole.style, { display: 'block', left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      root.classList.remove('dim');
      const w = Math.min(340, window.innerWidth - 24), below = r.bottom + 14, ch = card.offsetHeight || 180;
      card.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
      if (below + ch < window.innerHeight - 8) card.style.top = `${below}px`;
      else card.style.top = `${Math.max(8, r.top - ch - 14)}px`;
    } else {
      hole.style.display = 'none'; root.classList.add('dim'); card.classList.add('center');
    }
  }
  function start(kind, opts = {}) {
    const steps = STEPS[kind]; if (!steps) return;
    cur = { steps, i: 0, opts };
    build().hidden = false;
    go(0);
  }
  function end() {
    const root = $('#tour'); if (root) root.hidden = true;
    const o = cur && cur.opts; cur = null;
    if (o && o.onDone) o.onDone();
  }
  window.Tour = { start, kinds: Object.keys(STEPS), active: () => !!cur };
})();
