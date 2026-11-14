// WebRTC 接続管理（P2P メッシュ）
// 各ピアごとに 3 本のトランシーバーを固定で持つ: [0]=マイク [1]=カメラ [2]=画面共有
// トラックの切り替えは replaceTrack で行うので、再ネゴシエーションは不要。
(function () {
  const SLOTS = ['audio', 'cam', 'screen'];

  class RtcManager {
    constructor({ socket, selfId, iceServers, onPeersChanged }) {
      this.socket = socket;
      this.selfId = selfId;
      this.iceServers = iceServers;
      this.onPeersChanged = onPeersChanged || (() => {});
      this.peers = new Map(); // id -> peer
      this.local = { audio: null, cam: null, screen: null };
      this.cooldown = new Map(); // id -> 再接続を待つ時刻
      this.audioCtx = null;
      socket.on('signal', ({ from, data }) => this.handleSignal(from, data).catch(e => console.warn('signal error', e)));
    }

    setLocalTrack(slot, track) {
      this.local[slot] = track;
      const i = SLOTS.indexOf(slot);
      for (const p of this.peers.values()) {
        const tr = p.pc.getTransceivers()[i];
        if (tr) tr.sender.replaceTrack(track).catch(() => {});
      }
    }

    // desired: Map<id, {volume}>
    sync(desired) {
      for (const [id, info] of desired) {
        const p = this.peers.get(id);
        if (p) { p.volume = info.volume; continue; }
        if (this.selfId < id && (this.cooldown.get(id) || 0) < Date.now()) this.createOffer(id, info.volume);
      }
      for (const [id] of this.peers) {
        if (!desired.has(id)) this.close(id, true);
      }
    }

    newPeer(id, cid, volume) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      const peer = {
        id, cid, pc, volume, remote: { audio: null, cam: null, screen: null },
        audioEl: null, analyser: null, level: 0, pendingIce: [],
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) this.send(id, { type: 'ice', cid, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        const idx = pc.getTransceivers().indexOf(e.transceiver);
        const slot = SLOTS[idx];
        if (!slot) return;
        peer.remote[slot] = e.track;
        if (slot === 'audio') this.attachAudio(peer, e.track);
        this.onPeersChanged();
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState) && this.peers.get(id) === peer) {
          this.close(id, false);
        }
        this.onPeersChanged();
      };
      this.peers.set(id, peer);
      return peer;
    }

    async createOffer(id, volume) {
      const cid = Math.random().toString(36).slice(2);
      const peer = this.newPeer(id, cid, volume);
      const { pc } = peer;
      for (const slot of SLOTS) {
        const tr = pc.addTransceiver(slot === 'audio' ? 'audio' : 'video', { direction: 'sendrecv' });
        if (this.local[slot]) await tr.sender.replaceTrack(this.local[slot]);
      }
      await pc.setLocalDescription(await pc.createOffer());
      this.send(id, { type: 'offer', cid, sdp: pc.localDescription });
      this.onPeersChanged();
    }

    async handleSignal(from, data) {
      if (!data) return;
      let peer = this.peers.get(from);
      if (data.type === 'offer') {
        if (peer) this.close(from, false);
        peer = this.newPeer(from, data.cid, 0);
        const { pc } = peer;
        await pc.setRemoteDescription(data.sdp);
        const trs = pc.getTransceivers();
        for (let i = 0; i < SLOTS.length && i < trs.length; i++) {
          trs[i].direction = 'sendrecv';
          if (this.local[SLOTS[i]]) await trs[i].sender.replaceTrack(this.local[SLOTS[i]]);
        }
        await pc.setLocalDescription(await pc.createAnswer());
        this.send(from, { type: 'answer', cid: data.cid, sdp: pc.localDescription });
        await this.flushIce(peer);
        this.onPeersChanged();
        return;
      }
      if (!peer || peer.cid !== data.cid) return;
      if (data.type === 'answer') {
        await peer.pc.setRemoteDescription(data.sdp);
        await this.flushIce(peer);
      } else if (data.type === 'ice') {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pendingIce.push(data.candidate);
      } else if (data.type === 'bye') {
        this.close(from, false);
        this.cooldown.set(from, Date.now() + 1500);
      }
    }

    async flushIce(peer) {
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    }

    attachAudio(peer, track) {
      if (!peer.audioEl) {
        peer.audioEl = new Audio();
        peer.audioEl.autoplay = true;
        document.getElementById('audio-sink').appendChild(peer.audioEl);
      }
      const stream = new MediaStream([track]);
      peer.audioEl.srcObject = stream;
      peer.audioEl.play().catch(() => {});
      try {
        this.audioCtx = this.audioCtx || new AudioContext();
        const src = this.audioCtx.createMediaStreamSource(stream);
        const an = this.audioCtx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        peer.analyser = an;
      } catch (e) { /* 音量メーター無しで続行 */ }
    }

    close(id, notify) {
      const p = this.peers.get(id);
      if (!p) return;
      this.peers.delete(id);
      if (notify) this.send(id, { type: 'bye', cid: p.cid });
      try { p.pc.close(); } catch (e) {}
      if (p.audioEl) { p.audioEl.srcObject = null; p.audioEl.remove(); }
      this.onPeersChanged();
    }

    closeAll() { for (const id of [...this.peers.keys()]) this.close(id, true); }

    send(to, data) { this.socket.emit('signal', { to, data }); }

    // 音量反映と発話レベル計測（毎フレーム呼ぶ）
    tick(masterVolume) {
      const buf = new Uint8Array(128);
      for (const p of this.peers.values()) {
        if (p.audioEl) p.audioEl.volume = Math.max(0, Math.min(1, p.volume * masterVolume));
        if (p.analyser) {
          p.analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += (v - 128) * (v - 128);
          p.level = Math.sqrt(sum / buf.length);
        }
      }
    }
  }

  window.RtcManager = RtcManager;
})();
