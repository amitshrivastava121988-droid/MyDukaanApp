/* MyDukaan App — start.js
   boot() + offline banner. Must load LAST.
   Classic <script> file: shares globals (STATE, persist, fbdb, esc, toast ...) with the other files. */

async function boot(){
  if (window.__sdkLoadFailed || !fbdb){
    showBootRetryScreen();
    return;
  }
  try{
    applyTheme(loadAdminTheme());
    await ensureAuth();
    try{ if (typeof DN!=="undefined") DN.loadSettings(); }catch(e){} /* DN-HOOK */
    if (getUrlParam("provider")==="1"){ ROUTE="provider"; if (typeof DNP!=="undefined") await DNP.boot(); render(); hideSplash(); return; } /* DN-HOOK */
    const catalogShop = getUrlParam("shop");
    if (catalogShop){
      ROUTE = "catalog";
      CATALOG_PRODUCT_ID = getUrlParam("product") || null;
      render();
      loadCatalogData(catalogShop);
      hideSplash();
      return;
    }
    if (getUrlParam("nearby")){
      ROUTE = "nearby";
      render();
      hideSplash();
      return;
    }
    // Pehle se login session hai to seedha wahi page kholein (URL param ki zaroorat nahi)
    if (SESSION && SESSION.superadmin){
      ROUTE = "superadmin";
      render();
      loadShopsList();
      hideSplash();
      return;
    }
    if (SESSION && SESSION.shopId){
      const ok = await tryRestoreShopSession(SESSION.shopId);
      if (ok){ ROUTE="app"; render(); hideSplash(); return; }
    }
    // Koi session nahi — agar seedhe admin link se aaye hain to admin login dikhayein
    if (getUrlParam("admin")==="1"){
      ROUTE = "superadminLogin";
      render();
      hideSplash();
      return;
    }
    ROUTE = "login";
    render();
    hideSplash();
  } catch(e){
    // Koi bhi anjaan error aaye to app hamesha ke liye loading par atakna
    // nahi chahiye — login screen dikha do taaki user retry kar sake.
    console.error("Boot failed", e);
    ROUTE = "login";
    try{ render(); }catch(e2){}
    hideSplash();
  }
}
/* ---------- Offline banner + auto re-sync jab network wapas aaye ---------- */
function updateOfflineBanner(){
  const b = document.getElementById("offlineBanner");
  if (b) b.style.display = navigator.onLine ? "none" : "block";
}
function resyncAfterReconnect(){
  updateOfflineBanner();
  if (!navigator.onLine) return;
  try{
    // Offline rehte hue jo bhi changes sirf localStorage me save hue the,
    // unhe ab Firebase par push karo taaki dusre devices bhi update ho jaayein.
    // NOTE: listenShopData()/listenOrders() ko yahan dobara call NAHI karte —
    // Firebase ke apne ".on('value')" listeners network wapas aane par khud
    // hi re-sync ho jaate hain. Dobara call karne se ek hi ref par DO
    // listeners ek saath chalte, jisse kabhi-kabhi ek purana/stale snapshot
    // aakar abhi-abhi kiya gaya delete "wapas" dikha deta tha.
    if (CURRENT_SHOP_ID && STATE) pushStateToFirebase(0);
  } catch(e){ console.error("Resync on reconnect failed", e); }
}
window.addEventListener("online", resyncAfterReconnect);
window.addEventListener("offline", updateOfflineBanner);
updateOfflineBanner();

window.__mdLoading = false;   /* all script files have executed */
setTimeout(boot, 300);
