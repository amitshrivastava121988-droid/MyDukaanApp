MyDukaan App — multi-file layout
================================
Upload ye SAB files GitHub repo me (index.html ki jagah replace):

  index.html      shell + CSS + script tags
  core.js         General shop, orders, sales, Firebase, routing   (sabse pehle load)
  restaurant.js   RESTO + RMENU (tables, menu, customer menu)       (optional module)
  delivery.js     DN + DNP + DNS (Local Delivery)                   (optional module)
  start.js        boot()                                            (sabse last load)
  sw.js           service worker (updated)

Load order index.html me fix hai: core -> restaurant -> delivery -> start.
Sab "classic" script files hain, isliye STATE, persist(), fbdb, esc(), toast() sabko milte hain.

Agar restaurant.js ya delivery.js load/crash ho:  wo module band ho jata hai, baaki app chalti rehti hai
(console me "Module failed: ..." dikhta hai, window.__mdFailed me naam). core.js/start.js fail ho to
app ko "Internet weak" retry screen milti hai.

Naya deploy (har baar jab koi .js badle):
  1. index.html me 4 script tags ka ?v=... badlein (jaise 20261010a)
  2. sw.js me ASSET_V wahi value + CACHE_NAME ka number +1
  Ye na karne par bhi online users ko nayi files milti hain (sw network-first hai), par browser cache
  (GitHub Pages ~10 min) purani file de sakta hai.

Naya module (jaise hotel.js): file banao, index.html me delivery.js ke baad <script> tag lagao,
sw.js ke APP_FILES me naam jodo. Core se call hamesha  typeof HOTEL!=="undefined"  guard ke saath.
