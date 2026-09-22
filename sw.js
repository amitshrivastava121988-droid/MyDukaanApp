/* MyDukaan App — offline service worker
   ---------------------------------------------------------------
   Kaam: is HTML app ke "shell" (khud page + Firebase/JsBarcode/QRious
   CDN scripts) ko cache karta hai, taaki agli baar network na ho tab
   bhi app poori tarah khul jaaye aur chale. Asli data (STATE) already
   localStorage me save hota hai — ye service worker sirf "app load
   ho paaye" wali problem solve karta hai.
   ---------------------------------------------------------------
   Version badalna ho (naya deploy karte waqt cache refresh karne ke
   liye) to bas CACHE_NAME ka number badha dein. */
const CACHE_NAME = "mydukaan-shell-v1";

const PRECACHE_URLS = [
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js",
  "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js",
  "https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js"
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Har URL alag-alag try karte hain — agar ek CDN file fail ho
      // (weak network) to baaki phir bhi cache ho jaayein, poora
      // install fail nahi hona chahiye.
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Firebase Realtime Database / Auth / Storage calls ko service worker
  // touch nahi karta — Firebase SDK khud offline/online handle karta hai,
  // in requests ko cache karne se galat/purana data serve ho sakta hai.
  if (
    url.hostname.indexOf("firebaseio.com") !== -1 ||
    url.hostname.indexOf("firebasedatabase.app") !== -1 ||
    url.hostname.indexOf("googleapis.com") !== -1 ||
    url.hostname.indexOf("firebasestorage") !== -1
  ) {
    return;
  }

  const isPageRequest = req.mode === "navigate" || req.destination === "document";

  if (isPageRequest) {
    // Main HTML page: pehle network se fresh copy try karo (taaki updates
    // mil sakein), offline hone par turant cache se serve karo.
    event.respondWith(
      fetch(req)
        .then(function (res) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match(self.registration.scope);
          });
        })
    );
    return;
  }

  // CDN scripts/fonts/images: cache-first (turant offline-safe response),
  // background me network se fresh copy fetch karke cache update karte
  // raho taaki agli baar behtar rahe.
  event.respondWith(
    caches.match(req).then(function (cached) {
      const network = fetch(req)
        .then(function (res) {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
