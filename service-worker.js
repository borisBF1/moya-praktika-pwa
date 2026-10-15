// service-worker.js — кэширует приложение целиком, чтобы оно открывалось
// без сети. Данные пользователя тут ни при чём: они лежат в IndexedDB.

const CACHE_NAME = 'praktika-v3';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './app.js',
  './db.js',
  './ui.js',
  './utils.js',
  './wheel.js',
  './swipe.js',
  './whatsnew.js',
  './today.js',
  './calendar.js',
  './clients.js',
  './tasks.js',
  './income.js',
  './settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Отдаём из кэша сразу, а сеть используем, чтобы тихо обновить копию —
 * приложение всегда открывается мгновенно и работает офлайн,
 * а новая версия подхватывается при следующем запуске.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Переходы по адресу всегда ведут на закэшированную оболочку
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
