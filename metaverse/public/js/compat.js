// 古いブラウザ（とくに iPadOS 15 以前の Safari・Chrome）でも動くようにするための補い
(function () {
  // ① 角の丸い四角（ctx.roundRect）：Safari 16 より前にはない。地図や名札をかくのに使う
  const P = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (P && !P.roundRect) {
    P.roundRect = function (x, y, w, h, r) {
      let rad = Array.isArray(r) ? r : [r === undefined ? 0 : r];
      rad = rad.map(v => (typeof v === 'object' && v ? v.x || 0 : Number(v) || 0));
      const [tl, tr = tl, br = tl, bl = tr] = rad.length === 1 ? [rad[0], rad[0], rad[0], rad[0]] : rad.length === 2 ? [rad[0], rad[1], rad[0], rad[1]] : rad.length === 3 ? [rad[0], rad[1], rad[2], rad[1]] : rad;
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }
      const lim = (v) => Math.max(0, Math.min(v, w / 2, h / 2));
      const a = lim(tl), b = lim(tr), c = lim(br), d = lim(bl);
      this.moveTo(x + a, y);
      this.lineTo(x + w - b, y); this.arcTo(x + w, y, x + w, y + b, b);
      this.lineTo(x + w, y + h - c); this.arcTo(x + w, y + h, x + w - c, y + h, c);
      this.lineTo(x + d, y + h); this.arcTo(x, y + h, x, y + h - d, d);
      this.lineTo(x, y + a); this.arcTo(x, y, x + a, y, a);
      this.closePath();
      return this;
    };
  }
  // ② ダイアログ（<dialog> の showModal / close）：Safari 15.4 より前にはない
  if (typeof window.HTMLDialogElement === 'undefined') {
    document.documentElement.classList.add('dlg-poly'); // 見た目は common.css の .dlg-poly で
    const E = HTMLElement.prototype;
    const isDlg = (el) => el && el.tagName === 'DIALOG';
    Object.defineProperty(E, 'open', {
      configurable: true,
      get() { return isDlg(this) ? this.hasAttribute('open') : undefined; },
      set(v) { if (isDlg(this)) { if (v) this.setAttribute('open', ''); else this.removeAttribute('open'); } },
    });
    E.show = E.showModal = function () { if (isDlg(this)) this.setAttribute('open', ''); };
    E.close = function (val) {
      if (!isDlg(this) || !this.hasAttribute('open')) return;
      this.removeAttribute('open');
      if (val !== undefined) this.returnValue = val;
      this.dispatchEvent(new Event('close'));
    };
    // Esc で閉じる（cancel を止められるように）
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = [...document.querySelectorAll('dialog[open]')].pop();
      if (!open) return;
      const ev = new Event('cancel', { cancelable: true });
      open.dispatchEvent(ev);
      if (!ev.defaultPrevented) open.close();
    });
  }
})();
