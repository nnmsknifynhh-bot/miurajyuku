// 第4段階：個別通話（先生 → 生徒）
// - 先生が呼び出す → 生徒に参加確認 → 参加すると別の通話部屋へ
// - 通話中は授業の音声から外れる（サーバーが授業の通話から退出させ、トークンも出さない）
// - 終了すると自動で授業の音声に戻る
(function () {
  const LK = window.LivekitClient;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  function create({ socket, getState, toast }) {
    const pc = {
      call: null,   // { id, role: 'teacher'|'student', peerName, status: 'ringing'|'incoming'|'active', startedAt }
      room: null, connecting: false, error: null, micOn: false, screenOn: false, camOn: false,
      canScreen: false, canCamera: false, audioBlocked: false, remoteVideo: null, peerSpeaking: false, timer: null,
    };
    const ask = (ev, data) => new Promise(r => socket.emit(ev, data || {}, r));

    // ── 先生：呼び出す ──
    async function invite(user) {
      if (pc.call) return toast('いまは個別通話中（または呼び出し中）です');
      const res = await ask('pc-invite', { studentId: user.id });
      if (!res || !res.ok) return toast((res && res.error) || '呼び出せませんでした');
      pc.call = { id: res.callId, role: 'teacher', peerName: res.studentName, status: 'ringing' };
      render();
    }
    async function cancelOrEnd() {
      if (!pc.call) return;
      await ask('pc-end', { callId: pc.call.id });
    }

    // ── 生徒：参加確認 ──
    socket.on('pc-incoming', ({ callId, teacherName, timeoutMs }) => {
      pc.call = { id: callId, role: 'student', peerName: teacherName, status: 'incoming' };
      $('#pc-in-title').textContent = `${teacherName}先生から、個別通話のおさそいです`;
      const end = Date.now() + (timeoutMs || 30000);
      const tick = () => {
        const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        $('#pc-in-count').textContent = `あと ${left} 秒`;
      };
      tick(); clearInterval(pc.timer); pc.timer = setInterval(tick, 500);
      const dlg = $('#pc-incoming');
      if (!dlg.open) dlg.showModal();
      vibrate();
      render();
    });
    $('#pc-accept').onclick = async () => {
      if (!pc.call) return;
      closeIncoming();
      const res = await ask('pc-respond', { callId: pc.call.id, accept: true });
      if (!res || !res.ok) { toast((res && res.error) || '参加できませんでした'); pc.call = null; render(); }
    };
    $('#pc-decline').onclick = async () => {
      if (!pc.call) return;
      closeIncoming();
      await ask('pc-respond', { callId: pc.call.id, accept: false });
    };
    function closeIncoming() { clearInterval(pc.timer); const d = $('#pc-incoming'); if (d.open) d.close(); }

    // ── 通話の開始・終了（サーバーから） ──
    socket.on('pc-started', ({ callId, teacherName, studentName, role }) => {
      pc.call = { id: callId, role, peerName: role === 'teacher' ? studentName : teacherName, status: 'active', startedAt: Date.now() };
      render();
      join();
    });
    socket.on('pc-ended', ({ callId, reason }) => {
      if (!pc.call || pc.call.id !== callId) return;
      const wasActive = pc.call.status === 'active';
      closeIncoming();
      leave();
      pc.call = null;
      render();
      toast(reason + (wasActive && classActiveHere() ? '。授業にもどりました' : ''), 4500);
    });
    function classActiveHere() { const st = getState(); return !!(st.me && st.me.room && st.classes[st.me.room]); }

    async function join() {
      if (!LK || !pc.call) return;
      pc.connecting = true; pc.error = null; render();
      let res = await ask('pc-token', { callId: pc.call.id });
      if (!res || !res.ok) { await new Promise(r => setTimeout(r, 1600)); res = await ask('pc-token', { callId: pc.call && pc.call.id }); }
      if (!pc.call) return;
      if (!res || !res.ok) { pc.connecting = false; pc.error = (res && res.error) || '通話の準備に失敗しました'; render(); return; }
      // 声向けの音質・音切れ対策（授業と同じ設定）
      const room = new LK.Room({
        adaptiveStream: true, dynacast: true,
        publishDefaults: {
          audioPreset: LK.AudioPresets.speech, dtx: true, red: true,
          screenShareEncoding: { maxBitrate: 1_200_000, maxFramerate: 8 },
          screenShareSimulcastLayers: [LK.ScreenSharePresets.h720fps5],
        },
      });
      bind(room);
      try { await room.connect(res.url, res.token, { autoSubscribe: true }); }
      catch (e) { pc.connecting = false; pc.error = '通話サーバーにつながりません'; render(); return; }
      if (!pc.call) { room.disconnect(); return; }
      Object.assign(pc, { room, connecting: false, canScreen: res.canScreen && canShareScreen, canCamera: res.canCamera });
      pc.audioBlocked = !room.canPlaybackAudio;
      await setMic(true);
      render();
    }
    function leave() {
      const room = pc.room;
      Object.assign(pc, { room: null, connecting: false, error: null, micOn: false, screenOn: false, camOn: false, remoteVideo: null, peerSpeaking: false });
      if (room) room.disconnect();
      $('#pc-audio').textContent = '';
      const v = $('#pc-video'); v.srcObject = null;
      const lv = $('#pc-local'); lv.srcObject = null;
    }

    function bind(room) {
      room
        .on(LK.RoomEvent.TrackSubscribed, (track, pub, participant) => {
          if (track.kind === 'audio') { const a = track.attach(); $('#pc-audio').appendChild(a); return; }
          track.attach($('#pc-video'));
          pc.remoteVideo = track.source === LK.Track.Source.ScreenShare ? `${participant.name || ''}先生の画面` : `${participant.name || ''}さんのノート（カメラ）`;
          render();
        })
        .on(LK.RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach(e => { if (e.id !== 'pc-video') e.remove(); });
          if (track.kind === 'video') { pc.remoteVideo = null; $('#pc-video').srcObject = null; render(); }
        })
        .on(LK.RoomEvent.AudioPlaybackStatusChanged, () => { pc.audioBlocked = !room.canPlaybackAudio; render(); })
        .on(LK.RoomEvent.ConnectionQualityChanged, (q, participant) => {
          if (participant !== room.localParticipant) return;
          pc.poor = q === LK.ConnectionQuality.Poor || q === LK.ConnectionQuality.Lost;
          render();
        })
        .on(LK.RoomEvent.ActiveSpeakersChanged, (sp) => {
          pc.peerSpeaking = sp.some(s => s.identity !== room.localParticipant.identity);
          $('#pc-overlay').classList.toggle('peer-speaking', pc.peerSpeaking);
        })
        .on(LK.RoomEvent.LocalTrackUnpublished, (p) => {
          if (p.source === LK.Track.Source.ScreenShare) pc.screenOn = false;
          if (p.source === LK.Track.Source.Camera) { pc.camOn = false; $('#pc-local').srcObject = null; }
          render();
        })
        .on(LK.RoomEvent.Disconnected, () => {
          if (pc.room !== room) return;
          pc.room = null; pc.error = '通話が切れました'; render();
        });
    }

    // ── 操作 ──
    async function setMic(on) {
      if (!pc.room) return;
      try { await pc.room.localParticipant.setMicrophoneEnabled(on, { echoCancellation: true, noiseSuppression: true }); pc.micOn = on; }
      catch (e) { pc.micOn = false; if (on && window.Mic) Mic.explain(e); else toast('マイクが使えません。ブラウザの設定でマイクを許可してください', 5000); }
      render();
    }
    async function setScreen(on) {
      if (!pc.room || !pc.canScreen) return;
      try { await pc.room.localParticipant.setScreenShareEnabled(on, { audio: false, contentHint: 'detail' }); pc.screenOn = on; }
      catch (e) { pc.screenOn = false; }
      render();
    }
    // 生徒：背面カメラでノートを見せる（スマホのブラウザは画面共有ができないため）
    async function setCamera(on) {
      if (!pc.room || !pc.canCamera) return;
      try {
        const pub = await pc.room.localParticipant.setCameraEnabled(on, { facingMode: 'environment', resolution: { width: 1280, height: 720 } });
        pc.camOn = on;
        const lv = $('#pc-local');
        if (on && pub && pub.track) pub.track.attach(lv); else lv.srcObject = null;
      } catch (e) {
        pc.camOn = false;
        toast('カメラが使えません。ブラウザの設定でカメラを許可してください', 5000);
      }
      render();
    }

    function vibrate() { try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} }

    // ── 表示 ──
    function render() {
      const c = pc.call;
      // 呼び出し中（先生）
      const ring = $('#pc-ring');
      ring.textContent = '';
      ring.hidden = !(c && c.role === 'teacher' && c.status === 'ringing');
      if (!ring.hidden) {
        ring.append(el('span', null, `📞 ${c.peerName}さんを呼び出しています…`));
        const b = el('button', 'cb-btn', '取り消す'); b.onclick = cancelOrEnd; ring.append(b);
      }
      // 通話画面
      const ov = $('#pc-overlay');
      ov.hidden = !(c && c.status === 'active');
      if (ov.hidden) return;
      $('#pc-title').textContent = c.role === 'teacher' ? `🎧 ${c.peerName}さんと個別通話` : `🎧 ${c.peerName}先生と個別通話`;
      const mins = Math.floor((Date.now() - c.startedAt) / 60000);
      $('#pc-sub').textContent = `${mins}分・ほかの人には聞こえません・授業の音声は止まっています`;
      $('#pc-peer').textContent = (c.peerName || '?').slice(0, 1);
      $('#pc-peer-wrap').hidden = !!pc.remoteVideo;
      $('#pc-video-wrap').hidden = !pc.remoteVideo;
      $('#pc-video-label').textContent = pc.remoteVideo || '';
      $('#pc-local').hidden = !pc.camOn;

      const st = $('#pc-status'); st.textContent = '';
      if (pc.connecting) st.append(el('span', 'cb-note', 'つないでいます…'));
      else if (pc.error) {
        st.append(el('span', 'cb-note warn', pc.error));
        const r = el('button', 'cb-btn', 'もう一度'); r.onclick = () => { leave(); join(); }; st.append(r);
      } else if (pc.audioBlocked) {
        const b = el('button', 'cb-btn primary pulse', '🔊 タップして声をきく');
        b.onclick = async () => { try { await pc.room.startAudio(); } catch (e) {} pc.audioBlocked = !(pc.room && pc.room.canPlaybackAudio); render(); };
        st.append(b);
      }

      if (pc.room && pc.poor) st.append(el('span', 'cb-note warn', '⚠️ 通信が不安定です。Wi-Fi の近くへ移動してみてね'));
      const ctl = $('#pc-controls'); ctl.textContent = '';
      if (pc.room) {
        const mic = el('button', 'cb-btn' + (pc.micOn ? ' on' : ' off'), pc.micOn ? '🎤 マイクON' : '🔇 マイクOFF');
        mic.onclick = () => setMic(!pc.micOn); ctl.append(mic);
        if (c.role === 'teacher' && pc.canScreen) {
          const s = el('button', 'cb-btn' + (pc.screenOn ? ' on' : ''), pc.screenOn ? '🖥 共有をやめる' : '🖥 画面共有');
          s.onclick = () => setScreen(!pc.screenOn); ctl.append(s);
        }
        if (c.role === 'student' && pc.canCamera) {
          const s = el('button', 'cb-btn' + (pc.camOn ? ' on' : ''), pc.camOn ? '📷 カメラをとめる' : '📷 ノートを見せる');
          s.onclick = () => setCamera(!pc.camOn); ctl.append(s);
        }
      }
      const end = el('button', 'cb-btn danger', c.role === 'teacher' ? '通話を終わる' : '通話を終わる（授業にもどる）');
      end.onclick = async () => { if (confirm('個別通話を終わりますか？')) await cancelOrEnd(); };
      ctl.append(end);
    }
    setInterval(() => { if (pc.call && pc.call.status === 'active') render(); }, 15000);

    return {
      invite, render,
      busy: () => !!pc.call,
      active: () => !!(pc.call && pc.call.status === 'active'),
      leave: () => { closeIncoming(); leave(); pc.call = null; render(); },
    };
  }

  window.PrivateCall = { create };
})();
