/* MyDukaan App — offline service worker
   ---------------------------------------------------------------
   Kaam: is HTML app ke "shell" (khud page + Firebase/JsBarcode/QRious
   CDN scripts) ko cache karta hai, taaki agli baar network na ho tab
   bhi app poori tarah khul jaaye aur chale. Asli data (STATE) already
   localStorage me save hota hai — ye service worker sirf "app load
   ho paaye" wali problem solve karta hai.

   NEW: Liquid Glass theme — ye service worker khud index.html me
   liquid-glass.css ka <link> daal deta hai, isliye index.html me kuch
   badalne ki zaroorat nahi.
   ---------------------------------------------------------------
   Version badalna ho (naya deploy karte waqt cache refresh karne ke
   liye) to bas CACHE_NAME ka number badha dein. */
const CACHE_NAME = "mydukaan-shell-v6";

// App ki JS files. ASSET_V wahi hona chahiye jo index.html ke <script src="...?v=..."> me hai.
const ASSET_V = "20261009c";
const APP_FILES = ["core.js", "restaurant.js", "delivery.js", "start.js"].map(function (f) {
  return "./" + f + "?v=" + ASSET_V;
});

// Liquid glass theme ki CSS file
const THEME_CSS = "./liquid-glass.css?v=1";
const THEME_TAG = '<link rel="stylesheet" href="' + THEME_CSS + '">';

const PRECACHE_URLS = [
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js",
  "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js",
  "https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js",
  THEME_CSS
].concat(APP_FILES);

// HTML response me </head> se pehle theme CSS ka link daalta hai
// (agar pehle se nahi hai). Fail hone par original response hi deta hai.
function withTheme(res) {
  try {
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!res || !res.ok || type.indexOf("text/html") === -1) return Promise.resolve(res);
    return res.clone().text().then(function (html) {
      if (html.indexOf("liquid-glass.css") !== -1 || html.indexOf("</head>") === -1) return res;
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      return new Response(html.replace("</head>", THEME_TAG + "</head>"), {
        status: res.status,
        statusText: res.statusText,
        headers: headers
      });
    }).catch(function () { return res; });
  } catch (e) {
    return Promise.resolve(res);
  }
}

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
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
  // touch nahi karta.
  if (
    url.hostname.indexOf("firebaseio.com") !== -1 ||
    url.hostname.indexOf("firebasedatabase.app") !== -1 ||
    url.hostname.indexOf("googleapis.com") !== -1 ||
    url.hostname.indexOf("firebasestorage") !== -1
  ) {
    return;
  }

  const isPageRequest = req.mode === "navigate" || req.destination === "document";

  // App ki apni JS + CSS files: network-first, offline hone par cache se.
  const sameOrigin = url.origin === self.location.origin;
  const isOwnScript = req.destination === "script" && sameOrigin;
  const isOwnStyle = req.destination === "style" && sameOrigin;

  if (isPageRequest || isOwnScript || isOwnStyle) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          }
          return isPageRequest ? withTheme(res) : res;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            if (isOwnScript || isOwnStyle) return cached || Response.error();
            const page = cached || caches.match(self.registration.scope);
            return Promise.resolve(page).then(function (p) { return p ? withTheme(p) : p; });
          });
        })
    );
    return;
  }

  // CDN scripts/fonts/images: cache-first + background refresh.
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
