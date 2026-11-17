// 保護者レポート：リンクの「#」のあとの合いことばで、1人分のレポートを表示する（ログイン不要）
(function () {
  const $ = (s) => document.querySelector(s);
  const hm = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}時間${m ? ` ${m}分` : ''}` : `${m}分`; };
  const md = (d) => { const [, m, dd] = d.split('-'); return `${Number(m)}月${Number(dd)}日`; };
  const token = location.hash.slice(1);

  (async () => {
    let d;
    try { d = await window.App.api('POST', '/api/report-data', { token }); }
    catch (e) { const er = $('#rp-error'); er.textContent = e.message; er.hidden = false; return; }
    draw(d);
    $('#rp-card').hidden = false; $('#rp-actions').hidden = false; $('#rp-note').hidden = false;
    document.title = `${d.name}さんのがんばりレポート（${d.term.name}）｜三浦塾`;
  })();

  function draw(d) {
    const cv = $('#rp-card'), c = cv.getContext('2d');
    const W = cv.width;
    const round = (x, y, w, h, r, color) => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };
    const text = (s, x, y, size, color = '#2d2a32', weight = 'bold', align = 'left') => {
      c.font = `${weight} ${size}px "Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Hiragino Sans","Noto Sans JP",sans-serif`;
      c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillText(s, x, y);
    };
    const wrap = (s, x, y, maxW, size, lh, color) => {
      c.font = `bold ${size}px sans-serif`;
      let line = '', yy = y;
      for (const ch of s) {
        if (c.measureText(line + ch).width > maxW) { text(line, x, yy, size, color); line = ch; yy += lh; } else line += ch;
      }
      if (line) text(line, x, yy, size, color);
      return yy;
    };
    // 背景
    c.fillStyle = '#fff8ef'; c.fillRect(0, 0, W, cv.height);
    round(0, 0, W, 210, 0, '#2f7de1');
    text('三浦塾 オンライン教室', 60, 80, 36, 'rgba(255,255,255,.85)');
    text('がんばりレポート', 60, 150, 64, '#fff');
    text(`${d.term.name}（${md(d.term.start)}〜${md(d.term.end)}）`, W - 60, 150, 32, '#fff', 'bold', 'right');
    // 名前
    text(`${d.name} さん`, 60, 300, 60);
    if (d.grade) text(d.grade, 60 + c.measureText(`${d.name} さん`).width + 30, 300, 36, '#6b6475');

    // 自習時間
    round(60, 350, W - 120, 250, 28, '#fff');
    c.strokeStyle = '#eadfce'; c.lineWidth = 4; c.beginPath(); c.roundRect(60, 350, W - 120, 250, 28); c.stroke();
    text('今学期の自習時間', 100, 420, 34, '#6b6475');
    text(hm(d.totalMinutes), 100, 530, 96, '#ff8a3d');
    text(`自習した日：${d.studyDays}日`, W - 100, 470, 32, '#2d2a32', 'bold', 'right');
    if (d.streak >= 2) text(`🔥 いま ${d.streak}日連続`, W - 100, 530, 32, '#d64545', 'bold', 'right');

    // アバター（左）と 学年の木（右）
    round(60, 640, 440, 470, 28, '#fff');
    round(580, 640, W - 640, 470, 28, '#fff');
    text('いまのアバター', 100, 700, 32, '#6b6475');
    c.save(); c.translate(280, 960); c.scale(4.2, 4.2);
    window.Render.drawAvatar(c, { name: d.name, role: 'student', color: d.color, dir: 'down', equip: d.equip, streak: 0 }, 0, 0, { time: 0, now: 0 });
    c.restore();
    text('学年の木', 620, 700, 32, '#6b6475');
    if (d.tree) {
      c.save(); c.translate(820, 1010); c.scale(2.6, 2.6);
      window.Render.drawTree(c, 0, 0, { ...d.tree, goals: [] }, { time: 0, label: false });
      c.restore();
      text(`${d.tree.name}・${d.tree.stageName}`, 820, 1060, 32, '#2d2a32', 'bold', 'center');
      text(`学年の平均 ${hm(d.tree.avgMinutes)}`, 820, 1095, 26, '#6b6475', 'bold', 'center');
    } else text('（学年が設定されていません）', 620, 900, 26, '#6b6475');

    // 目標
    round(60, 1150, W - 120, 170, 28, '#fff6d6');
    text('🎯 今学期の目標', 100, 1210, 32, '#6b4e00');
    if (d.goal) {
      wrap(d.goal.text, 100, 1270, W - 380, 36, 44, '#2d2a32');
      text(d.goal.achieved ? '⭐ 達成！' : '🎋 とりくみ中', W - 100, 1270, 36, d.goal.achieved ? '#e0a100' : '#2fa36b', 'bold', 'right');
    } else text('（目標はまだありません）', 100, 1270, 30, '#6b6475');

    // 先生から
    if (d.comment) {
      round(60, 1350, W - 120, 140, 28, '#eaf2fd');
      text('先生から', 100, 1405, 28, '#1f63bb');
      wrap(d.comment, 100, 1455, W - 200, 32, 40, '#2d2a32');
    }
    text(`三浦塾　${new Date(d.createdAt).toLocaleDateString('ja-JP')} 作成`, W - 60, cv.height - 30, 24, '#9a92a5', 'bold', 'right');
  }

  async function blob() { return new Promise(r => $('#rp-card').toBlob(r, 'image/png')); }
  const fileName = () => `${document.title.split('｜')[0]}.png`;
  $('#rp-save').onclick = async () => {
    const b = await blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = fileName();
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  // スマホでは「共有」から LINE などに直接送れる
  if (navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] })) {
    $('#rp-share').hidden = false;
    $('#rp-share').onclick = async () => {
      const f = new File([await blob()], fileName(), { type: 'image/png' });
      try { await navigator.share({ files: [f], title: document.title }); } catch (e) { /* キャンセル */ }
    };
  }
})();
