// 自習室の見守り写真（生徒の端末）
// - 自習室に入ると「見守り写真」の案内を表示。生徒が自分で「カメラをオンにする」を押して始める
// - 写真は7〜13分おきの「ランダムな時間」に撮る（時間を予想して、その時だけ座る…を防ぐ）
// - 先生が「今すぐ撮る」を押したときも撮る
// - 写真といっしょに「明るさ」と「写真の特徴（似ているかの判定用）」を送る
// LiveKit（無料枠）は使わない。写真はこのアプリのサーバーに直接送る。
(function () {
  const $ = (s) => document.querySelector(s);
  const MIN_MS = 7 * 60e3, MAX_MS = 13 * 60e3;

  function create({ socket, getState, toast }) {
    const sc = { stream: null, facing: 'user', timer: null, starting: false, lastAt: 0, declined: false };

    const wanted = () => {
      const st = getState();
      return !!(st.studyPhotos && st.user && st.user.role === 'student' && st.me && window.SchoolMap.isStudyRoom(st.me.room));
    };

    function sync() {
      if (!wanted()) { if (sc.stream) stop(false); sc.declined = false; render(); return; }
      // 画面に戻ってきたとき、カメラが止まっていたら再開する（iPhone はバックグラウンドで止まる）
      if (sc.stream && sc.stream.getVideoTracks().every(t => t.readyState === 'ended')) { stop(false); start(); return; }
      render();
    }

    async function start() {
      if (sc.starting) return;
      sc.starting = true;
      try {
        sc.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: sc.facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
        });
        const v = $('#sc-preview');
        v.srcObject = sc.stream;
        await v.play().catch(() => {});
        socket.emit('study-camera', { on: true });
        sc.declined = false;
        setTimeout(() => capture('auto'), 2000); // 最初の1枚（カメラが明るさに慣れるのを待つ）
        schedule();
      } catch (e) {
        sc.stream = null;
        toast('カメラが使えません。ブラウザの設定でカメラを許可してください', 5000);
      } finally {
        sc.starting = false;
        render();
      }
    }

    function stop(byUser) {
      clearTimeout(sc.timer); sc.timer = null;
      if (sc.stream) sc.stream.getTracks().forEach(t => t.stop());
      sc.stream = null;
      $('#sc-preview').srcObject = null;
      socket.emit('study-camera', { on: false });
      if (byUser) sc.declined = true;
      render();
    }

    function schedule() {
      clearTimeout(sc.timer);
      const wait = MIN_MS + Math.random() * (MAX_MS - MIN_MS);
      sc.timer = setTimeout(async () => { await capture('auto'); schedule(); }, wait);
    }

    async function capture(reason) {
      if (!sc.stream) return;
      const v = $('#sc-preview');
      // 映像が一時停止していたら（スマホで画面を切り替えたあとなど）再生し直してから撮る
      if (v.paused || !v.videoWidth) {
        try { await v.play(); } catch (e) {}
        await new Promise(r => setTimeout(r, 800));
      }
      if (!v.videoWidth) { socket.emit('study-photo-failed', { reason: 'カメラの映像が止まっています' }); return; }
      const w = 480, h = Math.round(v.videoHeight / v.videoWidth * w);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(v, 0, 0, w, h);
      // 明るさと「写真の特徴」（8×8に縮めて、平均より明るいかどうかの64ビット）
      const s = document.createElement('canvas'); s.width = 8; s.height = 8;
      const sg = s.getContext('2d', { willReadFrequently: true });
      sg.drawImage(c, 0, 0, 8, 8);
      const px = sg.getImageData(0, 0, 8, 8).data;
      const gray = [];
      for (let i = 0; i < px.length; i += 4) gray.push(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
      const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
      let bits = 0n;
      for (const v2 of gray) bits = (bits << 1n) | (v2 > avg ? 1n : 0n);
      const fp = bits.toString(16).padStart(16, '0');
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
      if (!blob) return;
      try {
        const res = await fetch('/api/study/photo', {
          method: 'POST', credentials: 'same-origin', body: blob,
          headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Brightness': String(Math.round(avg)), 'X-Photo-Fp': fp, 'X-Photo-Reason': reason },
        });
        if (res.ok) { sc.lastAt = Date.now(); render(); }
        else if (reason === 'request') {
          const d = await res.json().catch(() => ({}));
          socket.emit('study-photo-failed', { reason: d.error || '送信できませんでした' });
        }
      } catch (e) { if (reason === 'request') socket.emit('study-photo-failed', { reason: '通信できませんでした' }); }
    }

    socket.on('take-photo', () => { capture('request'); });
    // 通信が切れて再接続したとき、カメラがオンであることをサーバーに伝え直す
    socket.on('connect', () => { if (sc.stream) socket.emit('study-camera', { on: true }); });
    // 画面に戻ってきたとき、映像が止まっていたら再生し直す
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && sc.stream) { const v = $('#sc-preview'); v.play().catch(() => {}); }
    });

    function render() {
      const card = $('#sc-card'), badge = $('#sc-badge');
      const show = wanted();
      card.hidden = !(show && !sc.stream && !sc.declined);
      badge.hidden = !(show && (sc.stream || sc.declined));
      if (badge.hidden) return;
      $('#sc-status').textContent = sc.stream ? '📷 見守り中' : '📷 カメラはオフです';
      $('#sc-sub').textContent = sc.stream
        ? 'ときどき写真が先生に届きます' + (sc.lastAt ? `（前回 ${new Date(sc.lastAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）` : '')
        : '先生には「カメラオフ」と表示されます';
      $('#sc-preview').hidden = !sc.stream;
      $('#sc-flip').hidden = !sc.stream;
      $('#sc-toggle').textContent = sc.stream ? 'オフにする' : 'オンにする';
    }

    $('#sc-start').onclick = () => start();
    $('#sc-later').onclick = () => { sc.declined = true; socket.emit('study-camera', { on: false }); render(); };
    $('#sc-toggle').onclick = () => (sc.stream ? (confirm('見守りカメラをオフにしますか？\n先生には「カメラオフ」と表示されます。') && stop(true)) : start());
    $('#sc-flip').onclick = async () => { sc.facing = sc.facing === 'user' ? 'environment' : 'user'; stop(false); await start(); };

    return { sync, stop: () => stop(false) };
  }

  window.StudyCam = { create };
})();
