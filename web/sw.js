// Service Worker: 一度開いたら電波が無くても遊べるようにファイルを手元に置く。
// 更新のたびに VERSION を上げると古いキャッシュが捨てられる。
const VERSION = 'rooms-v2';
const FILES = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/main.js', './js/game.js', './js/rules.js', './js/solver.js', './js/render.js', './js/sterope.js', './js/fx.js', './js/audio.js', './js/music.js', './js/config.js',
  './levels/stages.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './assets/study.png', './assets/piece96.png',
  './assets/h384_idle_blink.png', './assets/h384_happy.png', './assets/h384_think.png', './assets/h384_puzzled.png', './assets/h384_delight.png',
  './assets/h384_teary.png', './assets/h384_salute.png', './assets/h384_worried.png', './assets/h384_surprise.png', './assets/h384_nod.png', './assets/h384_relief.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先、失敗したらキャッシュ
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request))
  );
});
