// 第3段階：授業の全体通話・画面共有（LiveKit）
// - 授業中の教室に入ると自動で接続。生徒は「聞く・見る」だけ（送信はサーバーが許可しない）
// - 先生は「授業を始める」→ マイク・画面共有を送信。教室を出ると切断
(function () {
  const LK = window.LivekitClient;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  function create({ socket, getState, toast }) {
    const cs = {
      room: null, joinedRoom: null, connecting: false, error: null, publisher: false, canScreen: false,
      micOn: false, screenOn: false, audioBlocked: false, speaking: new Set(), retryAt: 0, screenOwner: null,
    };

    // ── 接続の管理 ──
    function desiredRoom() {
      const st = getState();
      if (!st.classCall || !st.me || !st.me.room) return null;
      if (st.me.inPrivate) return null; // 個別通話中は授業の音声から外れる
      return st.classes[st.me.room] ? st.me.room : null;
    }

    async function sync() {
      const want = desiredRoom();
      if (!want) {
        if (cs.room || cs.connecting) leave();
        const st = getState();
        if (!(st.me && st.me.inPrivate)) cs.restoreMic = undefined; // 授業が終わったらマイク状態の記憶も消す
        render(); return;
      }
      if (cs.room && cs.joinedRoom === want) { render(); return; }
      if (cs.connecting || Date.now() < cs.retryAt) { render(); return; }
      if (cs.room) leave();
      await join(want);
    }

    function ask(ev) { return new Promise(r => socket.emit(ev, {}, r)); }

    async function join(roomId) {
      if (!LK) { cs.error = '通話の部品を読み込めませんでした'; render(); return; }
      cs.connecting = true; cs.error = null; render();
      const res = await ask('lk-token');
      if (!res || !res.ok || desiredRoom() !== roomId) {
        cs.connecting = false;
        if (res && !res.ok) { cs.error = res.error; cs.retryAt = Date.now() + 3000; }
        render(); return;
      }
      // 声向けの音質（約24kbps）・音切れ対策（RED）・無音時は送らない（DTX）
      // 画面共有は文字が読める解像度で、動きは少なめ（スマホの通信量を抑える）
      const room = new LK.Room({
        adaptiveStream: true, dynacast: true,
        publishDefaults: {
          audioPreset: LK.AudioPresets.speech, dtx: true, red: true,
          screenShareEncoding: { maxBitrate: 1_200_000, maxFramerate: 8 },
          screenShareSimulcastLayers: [LK.ScreenSharePresets.h720fps5],
        },
      });
      bindRoom(room);
      try {
        await room.connect(res.url, res.token, { autoSubscribe: true });
      } catch (e) {
        console.warn('LiveKit connect failed', e);
        cs.connecting = false; cs.error = '通話サーバーにつながりません'; cs.retryAt = Date.now() + 5000;
        render(); return;
      }
      if (desiredRoom() !== roomId) { room.disconnect(); cs.connecting = false; render(); return; }
      Object.assign(cs, { room, joinedRoom: roomId, connecting: false, publisher: res.publisher, teacher: !!res.teacher, canScreen: res.canScreen && canShareScreen });
      cs.audioBlocked = !room.canPlaybackAudio;
      if (cs.teacher) await setMic(cs.restoreMic !== false);
      else if (cs.publisher) await setMic(cs.restoreMic === true); // 面談ブース：生徒・保護者は自分でマイクをONにする
      render();
    }

    function leave() {
      const room = cs.room;
      if (cs.publisher && room) cs.restoreMic = cs.micOn; // 個別通話から戻ったときにマイクの状態を戻す
      Object.assign(cs, { room: null, joinedRoom: null, connecting: false, publisher: false, micOn: false, screenOn: false, audioBlocked: false });
      cs.speaking.clear();
      if (room) room.disconnect();
      $('#lk-audio').textContent = '';
      hideScreen();
    }

    function bindRoom(room) {
      room
        .on(LK.RoomEvent.TrackSubscribed, (track, pub, participant) => {
          if (track.kind === 'audio') {
            const a = track.attach();
            a.dataset.sid = track.sid;
            $('#lk-audio').appendChild(a);
          } else if (track.source === LK.Track.Source.ScreenShare) {
            showScreen(track, participant);
          }
        })
        .on(LK.RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach(e => e.remove());
          if (track.source === LK.Track.Source.ScreenShare) hideScreen();
        })
        .on(LK.RoomEvent.AudioPlaybackStatusChanged, () => { cs.audioBlocked = !room.canPlaybackAudio; render(); })
        .on(LK.RoomEvent.ConnectionQualityChanged, (q, participant) => {
          if (participant !== room.localParticipant) return;
          cs.poor = q === LK.ConnectionQuality.Poor || q === LK.ConnectionQuality.Lost;
          render();
        })
        .on(LK.RoomEvent.ActiveSpeakersChanged, (speakers) => {
          cs.speaking = new Set(speakers.map(s => s.identity));
        })
        .on(LK.RoomEvent.LocalTrackUnpublished, (pub) => {
          if (pub.source === LK.Track.Source.ScreenShare) { cs.screenOn = false; reportMedia(); render(); }
        })
        .on(LK.RoomEvent.Disconnected, () => {
          if (cs.room !== room) return;
          Object.assign(cs, { room: null, joinedRoom: null, micOn: false, screenOn: false });
          $('#lk-audio').textContent = ''; hideScreen();
          cs.retryAt = Date.now() + 2000;
          render();
        });
    }

    // ── 先生の操作 ──
    async function setMic(on) {
      if (!cs.room || !cs.publisher) return;
      try {
        await cs.room.localParticipant.setMicrophoneEnabled(on, { echoCancellation: true, noiseSuppression: true });
        cs.micOn = on;
      } catch (e) {
        cs.micOn = false;
        if (on && window.Mic) Mic.explain(e); else toast('マイクが使えません。ブラウザの設定でマイクを許可してください', 5000);
      }
      reportMedia(); render();
    }
    async function setScreen(on) {
      if (!cs.room || !cs.canScreen) return;
      try {
        await cs.room.localParticipant.setScreenShareEnabled(on, { audio: false, contentHint: 'detail' });
        cs.screenOn = on;
      } catch (e) {
        cs.screenOn = false;
        if (e && e.name !== 'NotAllowedError') toast('画面共有を開始できませんでした');
      }
      reportMedia(); render();
    }
    function reportMedia() { if (cs.teacher) socket.emit('class-media', { mic: cs.micOn, screen: cs.screenOn }); }

    async function startClass() {
      const res = await ask('class-start');
      if (!res || !res.ok) return toast((res && res.error) || '授業を始められませんでした');
      toast('授業を始めました。教室にいる生徒にあなたの声が届きます');
    }
    async function endClass() {
      if (!confirm('通話・画面共有を終わりますか？')) return;
      const res = await ask('class-end');
      if (!res || !res.ok) toast((res && res.error) || '終了できませんでした');
    }

    // ── 画面共有の表示 ──
    function showScreen(track, participant) {
      const v = $('#screen-video');
      track.attach(v);
      cs.screenOwner = participant.name || '先生';
      $('#screen-title').textContent = `🖥 ${cs.screenOwner}先生の画面`;
      $('#screen-view').hidden = false;
    }
    function hideScreen() {
      const v = $('#screen-video');
      v.srcObject = null;
      $('#screen-view').hidden = true;
      $('#screen-view').classList.remove('big');
    }
    $('#screen-big').onclick = () => {
      const view = $('#screen-view');
      view.classList.toggle('big');
      $('#screen-big').textContent = view.classList.contains('big') ? '小さく' : '⛶ 大きく';
    };

    // ── 表示 ──
    function render() {
      const bar = $('#class-bar');
      const st = getState();
      bar.textContent = '';
      if (!st.me || !st.me.room || st.me.inPrivate) { bar.hidden = true; return; }
      const roomInfo = st.rooms.find(r => r.id === st.me.room);
      const cls = st.classes[st.me.room];
      const u = st.user;
      const mendan = st.me.room === 'mendan';
      const word = mendan ? '面談' : '授業';
      const mayStart = (u.role === 'owner' || u.role === 'teacher') && u.permissions.start_class_call && roomInfo && window.SchoolMap.isLessonRoom(roomInfo.id) && roomInfo.canEnter;

      if (!cls) {
        if (!mayStart) { bar.hidden = true; return; }
        bar.hidden = false;
        if (!st.classCall) {
          bar.append(el('span', 'cb-note', '通話サーバー（LiveKit）が未設定のため、授業の通話は使えません'));
          return;
        }
        const b = el('button', 'cb-btn primary', mendan ? '📢 面談の通話を始める（声・画面共有）' : '📢 授業を始める（声・画面共有）');
        b.onclick = startClass;
        bar.append(b);
        return;
      }

      bar.hidden = false;
      const isTeacher = cls.teacherId === st.me.id;
      const head = el('span', 'cb-live', isTeacher ? `🔴 ${word}中` : `🎙 ${word}中：${cls.teacherName}先生`);
      const mins = Math.floor((Date.now() - cls.startedAt) / 60000);
      head.append(el('small', null, ` ${mins}分`));
      bar.append(head);

      if (cls.away && !isTeacher) bar.append(el('span', 'cb-note', '🎧 先生はいま個別指導中です。少し待っていてね'));
      if (cs.connecting) { bar.append(el('span', 'cb-note', 'つないでいます…')); }
      else if (cs.error && !cs.room) {
        bar.append(el('span', 'cb-note warn', cs.error));
        const r = el('button', 'cb-btn', 'もう一度'); r.onclick = () => { cs.retryAt = 0; cs.error = null; sync(); }; bar.append(r);
      } else if (cs.room) {
        if (cs.audioBlocked && !isTeacher) {
          const b = el('button', 'cb-btn primary pulse', '🔊 タップして音声をきく');
          b.onclick = async () => { try { await cs.room.startAudio(); } catch (e) {} cs.audioBlocked = !cs.room.canPlaybackAudio; render(); };
          bar.append(b);
        } else if (!isTeacher && !cls.away && !cs.publisher) {
          bar.append(el('span', 'cb-note ok', cls.mic ? '🔊 先生の声がきこえます' : '🔇 先生のマイクはOFFです'));
        }
      }

      if (cs.room && cs.poor) bar.append(el('span', 'cb-note warn', '⚠️ 通信が不安定です。Wi-Fi の近くへ移動してみてね'));
      if (cs.room && cs.publisher && !isTeacher) { // 面談ブース：生徒・保護者も話せる
        const mic = el('button', 'cb-btn' + (cs.micOn ? ' on' : ' off'), cs.micOn ? '🎤 マイクON（話せます）' : '🔇 マイクOFF（タップで話す）');
        mic.onclick = () => setMic(!cs.micOn);
        bar.append(mic);
      }
      if (isTeacher && cs.room) {
        const mic = el('button', 'cb-btn' + (cs.micOn ? ' on' : ' off'), cs.micOn ? '🎤 マイクON' : '🔇 マイクOFF');
        mic.onclick = () => setMic(!cs.micOn);
        bar.append(mic);
        if (cs.canScreen) {
          const sc = el('button', 'cb-btn' + (cs.screenOn ? ' on' : ''), cs.screenOn ? '🖥 共有をやめる' : '🖥 画面共有');
          sc.onclick = () => setScreen(!cs.screenOn);
          bar.append(sc);
        } else if (u.permissions.share_screen && !canShareScreen) {
          bar.append(el('span', 'cb-note', '画面共有はパソコンから使えます'));
        }
      }
      // 生徒のスタンプ・吹き出し（授業中は先生が許可したときだけ）
      if ((isTeacher || u.role === 'owner') && !mendan) {
        const chat = el('button', 'cb-btn' + (cls.allowChat ? ' on' : ' off'), cls.allowChat ? '😊 スタンプ・吹き出しOK' : '🤐 スタンプ・吹き出し止め中');
        chat.title = 'タップで切りかえ';
        chat.onclick = () => socket.emit('class-chat', { allow: !cls.allowChat }, (r) => { if (r && !r.ok) toast(r.error); else toast(r.allowChat ? '生徒がスタンプ・吹き出しを使えるようにしました' : '生徒のスタンプ・吹き出しを止めました'); });
        bar.append(chat);
      } else if (u.role === 'student' && !mendan) {
        bar.append(el('span', 'cb-note', cls.allowChat ? '😊 スタンプ・吹き出しOK' : '🤐 スタンプ・吹き出しは先生がOKを出したときだけ'));
      }
      if (isTeacher || u.role === 'owner') {
        const end = el('button', 'cb-btn danger', `${word}を終わる`);
        end.onclick = endClass;
        bar.append(end);
      }
    }

    setInterval(() => { sync(); }, 4000); // 切れたときの再接続と、経過時間の表示更新

    return {
      sync, render, leave,
      isSpeaking: (userId) => cs.speaking.has('u-' + userId),
      connected: () => !!cs.room,
      isTeachingHere: () => { const st = getState(); const c = st.me && st.me.room && st.classes[st.me.room]; return !!(c && c.teacherId === st.me.id); },
    };
  }

  window.ClassCall = { create };
})();
