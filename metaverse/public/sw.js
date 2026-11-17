// オフライン時の表示用キャッシュ。API は常にネットワークから取得し、保存しない。
const CACHE = 'juku-v25';
const ASSETS = [
  '/', '/app', '/admin', '/css/common.css', '/css/login.css', '/css/app.css', '/css/admin.css',
  '/js/api.js', '/js/login.js', '/js/app.js', '/js/render.js', '/js/admin.js', '/js/classcall.js', '/js/privatecall.js', '/js/studycam.js', '/js/ganbari.js', '/shared/map.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// ネットワーク優先（更新がすぐ反映されるように）、つながらないときだけキャッシュを使う
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ── プッシュ通知（アプリを閉じていても届く） ──
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '三浦塾 オンライン教室', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/app' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (new URL(c.url).pathname === url && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
