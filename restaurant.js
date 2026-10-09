/* MyDukaan App — restaurant.js
   Restaurant / Hotel: RESTO (types, tables, QR) + RMENU (menu, customization, customer menu, cart). Optional module.
   Classic <script> file: shares globals (STATE, persist, fbdb, esc, toast ...) with the other files. */

/* =====================================================================
   MyDukaan RESTAURANT / HOTEL MODULE — Phase 1 (business type + plumbing)
   Self-contained block. Only shops with meta.businessType != "general" are
   affected; General Shops (and every existing shop with no businessType)
   keep the exact existing UI. To remove: delete this block + lines marked RS-HOOK.
   Later phases (tables, QR, menu, orders, kitchen) will extend RESTO.
===================================================================== */
const RESTO = (function(){
  const TYPES = {general:"General Shop", restaurant:"Restaurant", hotel:"Hotel", hotel_restaurant:"Hotel + Restaurant"};
  const ORDER = ["general","restaurant","hotel","hotel_restaurant"];
  function normalize(v){ return (typeof v==="string" && TYPES[v]) ? v : "general"; }
  function typeOf(meta){ return normalize(meta && meta.businessType); }
  /* Offline restore leaves CURRENT_SHOP_META null — fall back to the last known type
     (cached per shop) so a restaurant is never silently treated as a General Shop
     and shopPublic.businessType is never overwritten with "general". */
  function cacheKey(){ return "mdBizType:"+(typeof CURRENT_SHOP_ID!=="undefined" ? CURRENT_SHOP_ID : ""); }
  function type(){
    const meta = (typeof CURRENT_SHOP_META!=="undefined") ? CURRENT_SHOP_META : null;
    if (meta){
      const t = typeOf(meta);
      try{ localStorage.setItem(cacheKey(), t); }catch(e){}
      return t;
    }
    try{ return normalize(localStorage.getItem(cacheKey())); }catch(e){ return "general"; }
  }
  function hasRestaurant(){ const t=type(); return t==="restaurant" || t==="hotel_restaurant"; }
  function hasHotel(){ const t=type(); return t==="hotel" || t==="hotel_restaurant"; }
  function isActiveMode(){ return type()!=="general"; }
  function label(t){ return TYPES[normalize(t)]; }
  function selectHtml(id, selected){
    const sel = normalize(selected);
    return '<div class="field"><label class="field-label">Shop Type</label><select id="'+id+'">'+
      ORDER.map(function(k){ return '<option value="'+k+'"'+(k===sel?' selected':'')+'>'+esc(TYPES[k])+'</option>'; }).join('')+
      '</select></div>';
  }
  /* ===================== Phase 2: Restaurant Settings ===================== */
  const DEFAULTS = {
    open:true, hideMenuWhenClosed:false, openTime:"", closeTime:"",
    name:"", address:"", mobile:"", gst:"",
    dineIn:true, takeaway:true, delivery:false,
    nameRequired:true, mobileRequired:false,
    cancelWindow:5, lockCancelOnAccept:true,
    taxEnabled:false, taxPct:5, serviceEnabled:false, servicePct:5,
    tableQr:true, tableSession:true, autoFreeTable:true,
    popup:true, sound:true, browserNotif:false
  };
  const S = {loadedFor:null, settings:Object.assign({}, DEFAULTS), tables:{}, menu:{}, categories:{}, groups:{}, tableFilter:"all"};
  const STATUS = {
    available:["🟢","Available"], occupied:["🔴","Occupied"], reserved:["🟣","Reserved"],
    cleaning:["🟡","Cleaning"], out_of_service:["⚫","Out of Service"]
  };
  function sid(){ return (typeof CURRENT_SHOP_ID!=="undefined") ? CURRENT_SHOP_ID : null; }
  function cacheKey2(){ return "mdResto:"+sid(); }
  function cacheSave(){ try{ localStorage.setItem(cacheKey2(), JSON.stringify({settings:S.settings, tables:S.tables, menu:S.menu, categories:S.categories, groups:S.groups})); }catch(e){} }
  /* Firebase writes stay pending while offline (they are queued and sent later), so never
     await them forever — resolve after a short wait and treat that as "queued". */
  function fbw(promise){
    return new Promise(function(res){
      let done = false;
      const t = setTimeout(function(){ if (!done){ done = true; res({ok:true, queued:true}); } }, 5000);
      promise.then(function(){ if (!done){ done = true; clearTimeout(t); res({ok:true}); } })
             .catch(function(e){ if (!done){ done = true; clearTimeout(t); res({ok:false, err:e}); } });
    });
  }
  function tok(){
    try{ const a = new Uint32Array(4); crypto.getRandomValues(a); return Array.prototype.map.call(a, function(n){ return n.toString(36); }).join("").slice(0,16); }
    catch(e){ return uid()+uid(); }
  }
  async function load(force){
    const id = sid();
    if (!id) return;
    if (S.loadedFor===id && !force) return;
    let val = null, fromNet = false;
    try{
      const snap = await withFbTimeout(fbdb.ref("shops/"+id+"/restaurant").once("value"));
      if (!snap.__timedOut){ val = snap.val() || {}; fromNet = true; }
    }catch(e){}
    if (!fromNet){
      try{ val = JSON.parse(localStorage.getItem("mdResto:"+id) || "null"); }catch(e){}
      val = val || {};
    }
    S.settings = Object.assign({}, DEFAULTS, val.settings || {});
    S.tables = val.tables || {};
    S.menu = val.menu || {}; S.categories = val.categories || {}; S.groups = val.customGroups || {};   /* Phase 4: menu / categories / customization groups */
    S.loadedFor = id;
    if (fromNet) cacheSave();
    if (typeof RMENU!=="undefined") setTimeout(RMENU.onProductsChanged, 0);
  }
  function pubSettings(s){
    return {open:!!s.open, hideMenuWhenClosed:!!s.hideMenuWhenClosed, openTime:s.openTime||"", closeTime:s.closeTime||"",
      name:s.name||"", nameRequired:!!s.nameRequired, mobileRequired:!!s.mobileRequired,
      dineIn:!!s.dineIn, takeaway:!!s.takeaway, delivery:!!s.delivery,
      cancelWindow:Number(s.cancelWindow)||0, lockCancelOnAccept:!!s.lockCancelOnAccept,
      taxEnabled:!!s.taxEnabled, taxPct:Number(s.taxPct)||0, serviceEnabled:!!s.serviceEnabled, servicePct:Number(s.servicePct)||0,
      tableQr:!!s.tableQr, tableSession:!!s.tableSession};
  }
  async function persistSettings(){
    const id = sid();
    cacheSave();
    const a = await fbw(fbdb.ref("shops/"+id+"/restaurant/settings").set(S.settings));
    const b = await fbw(fbdb.ref("shopPublic/"+id+"/restaurant").set(pubSettings(S.settings)));
    return a.ok && b.ok;
  }
  function g(id){ const el = document.getElementById(id); return el ? el.value : ""; }
  function gc(id){ const el = document.getElementById(id); return !!(el && el.checked); }
  function chk(id, text, val){
    return '<label class="restaurant-row"><span>'+esc(text)+'</span><input type="checkbox" id="'+id+'"'+(val?' checked':'')+'></label>';
  }
  function sel(label, id, pairs, val){
    return '<div class="field"><label class="field-label">'+esc(label)+'</label><select id="'+id+'">'+
      pairs.map(function(p){ return '<option value="'+esc(p[0])+'"'+(String(p[0])===String(val)?' selected':'')+'>'+esc(p[1])+'</option>'; }).join('')+'</select></div>';
  }
  function pct(v){ const n = parseFloat(v); return (isFinite(n) && n>=0 && n<=100) ? n : null; }
  async function saveSettings(){
    const taxPct = pct(g("rs_taxPct")), svcPct = pct(g("rs_svcPct"));
    if (taxPct===null || svcPct===null){ toast("Enter GST / Service Charge % between 0 and 100"); return; }
    const s = Object.assign({}, S.settings, {
      name:g("rs_name").trim(), address:g("rs_address").trim(), mobile:g("rs_mobile").trim(), gst:g("rs_gst").trim(),
      openTime:g("rs_openTime"), closeTime:g("rs_closeTime"),
      open:gc("rs_open"), hideMenuWhenClosed:gc("rs_hideClosed"),
      dineIn:gc("rs_dineIn"), takeaway:gc("rs_takeaway"), delivery:gc("rs_delivery"),
      nameRequired:gc("rs_nameReq"), mobileRequired:gc("rs_mobReq"),
      cancelWindow:parseInt(g("rs_cancelWin"),10)||0, lockCancelOnAccept:gc("rs_lockAccept"),
      taxEnabled:gc("rs_tax"), taxPct:taxPct, serviceEnabled:gc("rs_svc"), servicePct:svcPct,
      tableQr:gc("rs_tableQr"), tableSession:gc("rs_session"), autoFreeTable:gc("rs_autoFree"),
      popup:gc("rs_popup"), sound:gc("rs_sound"), browserNotif:gc("rs_bnotif")
    });
    if (!s.dineIn && !s.takeaway && !s.delivery){ toast("Keep at least one order type (Dine-in / Takeaway / Delivery) ON"); return; }
    S.settings = s;
    if (s.browserNotif){ try{ if ("Notification" in window && Notification.permission==="default") Notification.requestPermission(); }catch(e){} }
    const ok = await persistSettings();
    toast(ok ? "Restaurant settings saved" : "Save failed — check permissions / internet");
    refreshBanner();
  }
  async function toggleOpen(){
    await load();
    S.settings.open = !S.settings.open;
    refreshBanner();
    const ok = await persistSettings();
    toast(ok ? (S.settings.open ? "🟢 Restaurant OPEN" : "🔴 Restaurant CLOSED") : "Save failed — check permissions / internet");
  }
  function renderSettings(){
    const s = S.settings;
    let h = header("Restaurant Settings", {onBack:"closeScreen('dashboard')"});
    h += '<div class="content restaurant-screen">';
    h += '<div class="card"><div class="section-title" style="margin-top:0;">🟢 Open / Closed</div>'+
      chk("rs_open","Restaurant is OPEN now", s.open)+
      chk("rs_hideClosed","Hide the whole menu when closed", s.hideMenuWhenClosed)+
      '<div class="grid2">'+field("Opening Time","time","rs_openTime",s.openTime)+field("Closing Time","time","rs_closeTime",s.closeTime)+'</div></div>';
    h += '<div class="card"><div class="section-title" style="margin-top:0;">🏪 Basic</div>'+
      field("Restaurant Name","text","rs_name",s.name||(STATE&&STATE.settings&&STATE.settings.shopName)||"")+
      field("Address","text","rs_address",s.address)+field("Mobile","tel","rs_mobile",s.mobile)+field("GST Number","text","rs_gst",s.gst)+'</div>';
    h += '<div class="card"><div class="section-title" style="margin-top:0;">🧾 Ordering</div>'+
      chk("rs_dineIn","Dine-in", s.dineIn)+chk("rs_takeaway","Take Away", s.takeaway)+chk("rs_delivery","Home Delivery", s.delivery)+
      chk("rs_nameReq","Customer name required", s.nameRequired)+chk("rs_mobReq","Customer mobile required", s.mobileRequired)+
      sel("Customer Cancellation Window","rs_cancelWin",[["5","5 minutes"],["10","10 minutes"],["15","15 minutes"],["0","No cancellation"]], String(s.cancelWindow))+
      chk("rs_lockAccept","Customer cannot cancel once the order is accepted", s.lockCancelOnAccept)+'</div>';
    h += '<div class="card"><div class="section-title" style="margin-top:0;">💰 Charges</div>'+
      chk("rs_tax","GST / Tax lagayein", s.taxEnabled)+field("GST %","number","rs_taxPct",s.taxPct)+
      chk("rs_svc","Service Charge lagayein", s.serviceEnabled)+field("Service Charge %","number","rs_svcPct",s.servicePct)+'</div>';
    h += '<div class="card"><div class="section-title" style="margin-top:0;">🪑 Table</div>'+
      chk("rs_tableQr","Table QR ON", s.tableQr)+chk("rs_session","Table session ON", s.tableSession)+
      chk("rs_autoFree","Mark table Available automatically when all its orders are complete", s.autoFreeTable)+'</div>';
    h += '<div class="card"><div class="section-title" style="margin-top:0;">🔔 Notifications</div>'+
      chk("rs_popup","New Order popup", s.popup)+chk("rs_sound","Order sound", s.sound)+chk("rs_bnotif","Browser notification", s.browserNotif)+'</div>';
    h += '<button class="btn primary" onclick="RESTO.saveSettings()">💾 Save Settings</button>';
    h += '</div>';
    return h;
  }

  /* ===================== Phase 3: Tables + Table QR ===================== */
  function tableLabel(t){
    if (t.name) return t.name;
    const n = String(t.tableNumber==null ? "" : t.tableNumber);
    return "Table "+(/^\d$/.test(n) ? "0"+n : n);
  }
  function tablesSorted(){
    return Object.keys(S.tables).map(function(id){ return Object.assign({id:id}, S.tables[id]); })
      .sort(function(a,b){ return String(a.tableNumber).localeCompare(String(b.tableNumber), undefined, {numeric:true}); });
  }
  function pubTable(t){
    return {tableNumber:t.tableNumber, name:t.name||"", section:t.section||"", seats:t.seats, qrToken:t.qrToken, active:t.status!=="out_of_service"};
  }
  function modalShow(html){ const h = document.getElementById("toastHost"); if (h) h.innerHTML = html; }
  function modalClose(ev){
    if (ev && ev.target !== ev.currentTarget) return;
    const h = document.getElementById("toastHost"); if (h) h.innerHTML = "";
  }
  function sheet(inner){
    return '<div class="modal-overlay" onclick="RESTO.modalClose(event)"><div class="modal-sheet" onclick="event.stopPropagation()">'+inner+'</div></div>';
  }
  function counts(){
    const c = {all:0, available:0, occupied:0, reserved:0, cleaning:0, out_of_service:0};
    Object.keys(S.tables).forEach(function(id){ const st = S.tables[id].status || "available"; c.all++; if (c[st]!=null) c[st]++; });
    return c;
  }
  function renderTables(){
    const c = counts();
    const list = tablesSorted().filter(function(t){ return S.tableFilter==="all" || (t.status||"available")===S.tableFilter; });
    let h = header("Tables", {onBack:"closeScreen('dashboard')", rightHtml:'<button class="icon-btn solid" onclick="RESTO.openTableForm()">+</button>'});
    h += '<div class="content restaurant-screen">';
    if (!S.settings.tableQr) h += '<div class="restaurant-warn">⚠️ "Table QR" is OFF in Settings — a scanned table QR will not be treated as valid.</div>';
    if (c.all>0){
      h += '<div class="grid2" style="margin-bottom:10px;">'+
        '<button class="btn" style="background:#f1f5f9;color:#334155;" onclick="RESTO.openBulkForm()">➕ Multiple Tables</button>'+
        '<button class="btn primary" onclick="RESTO.printAll()">🖨️ Download All Table QR</button></div>';
    }
    h += '<div class="restaurant-chips">'+
      [["all","All"],["available","Available"],["occupied","Occupied"],["reserved","Reserved"],["cleaning","Cleaning"]].map(function(f){
        return '<button class="restaurant-chip'+(S.tableFilter===f[0]?' active':'')+'" onclick="RESTO.setTableFilter(\''+f[0]+'\')">'+f[1]+' ('+(c[f[0]]||0)+')</button>';
      }).join('')+'</div>';
    if (c.all===0){
      h += '<div class="empty">No tables added yet.<div style="margin-top:14px;"><button class="btn primary" onclick="RESTO.openTableForm()">+ Add Table</button> '+
        '<button class="btn" style="background:#f1f5f9;color:#334155;margin-top:8px;" onclick="RESTO.openBulkForm()">➕ Ek saath kai tables</button></div></div>';
    } else if (list.length===0){
      h += '<div class="empty">No tables match this filter.</div>';
    } else {
      h += list.map(function(t){
        const st = STATUS[t.status] || STATUS.available;
        return '<div class="restaurant-table-card"><div class="restaurant-table-top"><div><div class="row-name">'+esc(tableLabel(t))+'</div>'+
          '<div class="row-sub">'+esc(t.seats)+' Seats'+(t.section?' · '+esc(t.section):'')+'</div></div>'+
          '<button class="restaurant-status" onclick="RESTO.openStatusMenu(\''+t.id+'\')">'+st[0]+' '+st[1]+' ▾</button></div>'+
          '<div class="restaurant-table-actions">'+
          '<button class="icon-mini-btn" onclick="RESTO.openTableQr(\''+t.id+'\')">📱 QR</button>'+
          '<button class="icon-mini-btn" onclick="RESTO.openTableForm(\''+t.id+'\')">✏️ Edit</button>'+
          '<button class="icon-mini-btn danger" onclick="RESTO.deleteTable(\''+t.id+'\')">🗑️ Delete</button></div></div>';
      }).join('');
    }
    h += '</div>';
    return h;
  }
  function setTableFilter(f){ S.tableFilter = f; render(); }
  function openTableForm(id){
    const t = id ? S.tables[id] : null;
    const next = String(tablesSorted().length+1);
    modalShow(sheet(
      '<div class="modal-title">'+(t?'✏️ Edit Table':'🪑 New Table')+'</div>'+
      field("Table Number *","text","rs_t_num", t?t.tableNumber:next)+
      field("Table Name (optional, e.g. Garden 1)","text","rs_t_name", t?t.name:"")+
      field("Seats *","number","rs_t_seats", t?t.seats:4)+
      field("Section (optional, e.g. Family / Garden)","text","rs_t_section", t?t.section:"")+
      sel("Status","rs_t_status", Object.keys(STATUS).map(function(k){ return [k, STATUS[k][1]]; }), t?(t.status||"available"):"available")+
      '<button class="btn primary" style="margin-bottom:10px;" onclick="RESTO.saveTable('+(id?"'"+id+"'":"null")+')">Save</button>'+
      '<button class="btn" style="background:var(--border);color:var(--text);" onclick="RESTO.modalClose()">Close</button>'));
  }
  function numberTaken(num, exceptId){
    const n = String(num).trim().toLowerCase();
    return Object.keys(S.tables).some(function(id){ return id!==exceptId && String(S.tables[id].tableNumber).trim().toLowerCase()===n; });
  }
  async function saveTable(id){
    const num = g("rs_t_num").trim();
    const seats = parseInt(g("rs_t_seats"),10);
    if (!num){ toast("Enter a table number"); return; }
    if (!(seats>=1 && seats<=50)){ toast("Seats must be between 1 and 50"); return; }
    if (numberTaken(num, id)){ toast("This table number already exists"); return; }
    const old = id ? S.tables[id] : null;
    const tid = id || ("T"+uid());
    const status = STATUS[g("rs_t_status")] ? g("rs_t_status") : "available";
    const obj = {tableNumber:num, name:g("rs_t_name").trim(), seats:seats, section:g("rs_t_section").trim(), status:status,
      active:status!=="out_of_service", qrToken:(old&&old.qrToken)||tok(), createdAt:(old&&old.createdAt)||Date.now()};
    S.tables[tid] = obj; cacheSave(); modalClose(); render();
    const a = await fbw(fbdb.ref("shops/"+sid()+"/restaurant/tables/"+tid).set(obj));
    const b = await fbw(fbdb.ref("shopPublic/"+sid()+"/tables/"+tid).set(pubTable(obj)));
    if (!(a.ok && b.ok)) toast("Table save failed — check permissions / internet");
  }
  function openStatusMenu(id){
    const t = S.tables[id]; if (!t) return;
    modalShow(sheet('<div class="modal-title">'+esc(tableLabel(t))+' — Status</div>'+
      Object.keys(STATUS).map(function(k){
        return '<button class="btn" style="margin-bottom:8px;background:'+((t.status||"available")===k?'var(--primary)':'#f1f5f9')+';color:'+((t.status||"available")===k?'#fff':'#334155')+';" onclick="RESTO.setStatus(\''+id+'\',\''+k+'\')">'+STATUS[k][0]+' '+STATUS[k][1]+'</button>';
      }).join('')+
      '<button class="btn" style="background:var(--border);color:var(--text);" onclick="RESTO.modalClose()">Close</button>'));
  }
  async function setStatus(id, status){
    const t = S.tables[id]; if (!t || !STATUS[status]) return;
    t.status = status; t.active = status!=="out_of_service";
    cacheSave(); modalClose(); render();
    const a = await fbw(fbdb.ref("shops/"+sid()+"/restaurant/tables/"+id+"/status").set(status));
    const b = await fbw(fbdb.ref("shopPublic/"+sid()+"/tables/"+id+"/active").set(t.active));
    if (!(a.ok && b.ok)) toast("Status save failed — check permissions / internet");
  }
  async function deleteTable(id){
    const t = S.tables[id]; if (!t) return;
    if (!confirm(tableLabel(t)+": delete this table? Its QR will stop working.")) return;
    delete S.tables[id]; cacheSave(); render();
    const a = await fbw(fbdb.ref("shops/"+sid()+"/restaurant/tables/"+id).remove());
    const b = await fbw(fbdb.ref("shopPublic/"+sid()+"/tables/"+id).remove());
    if (!(a.ok && b.ok)) toast("Delete failed — check permissions / internet");
  }
  function openBulkForm(){
    modalShow(sheet('<div class="modal-title">➕ Ek saath kai Tables</div>'+
      field("How many tables? (1–50)","number","rs_b_count",10)+
      field("Starting number","number","rs_b_start", tablesSorted().length+1)+
      field("Seats (per table)","number","rs_b_seats",4)+
      field("Section (optional)","text","rs_b_section","")+
      '<button class="btn primary" style="margin-bottom:10px;" onclick="RESTO.saveBulk()">Create Tables</button>'+
      '<button class="btn" style="background:var(--border);color:var(--text);" onclick="RESTO.modalClose()">Close</button>'));
  }
  async function saveBulk(){
    const count = parseInt(g("rs_b_count"),10), start = parseInt(g("rs_b_start"),10), seats = parseInt(g("rs_b_seats"),10);
    const section = g("rs_b_section").trim();
    if (!(count>=1 && count<=50) || !(start>=0) || !(seats>=1 && seats<=50)){ toast("Enter a valid Count (1–50), Starting number and Seats"); return; }
    const priv = {}, pub = {}; let skipped = 0;
    for (let i=0;i<count;i++){
      const num = String(start+i);
      if (numberTaken(num, null)){ skipped++; continue; }
      const tid = "T"+uid();
      const obj = {tableNumber:num, name:"", seats:seats, section:section, status:"available", active:true, qrToken:tok(), createdAt:Date.now()};
      S.tables[tid] = obj; priv[tid] = obj; pub[tid] = pubTable(obj);
    }
    cacheSave(); modalClose(); render();
    if (!Object.keys(priv).length){ toast("All these numbers already exist"); return; }
    const a = await fbw(fbdb.ref("shops/"+sid()+"/restaurant/tables").update(priv));
    const b = await fbw(fbdb.ref("shopPublic/"+sid()+"/tables").update(pub));
    toast((a.ok && b.ok) ? (Object.keys(priv).length+" tables created"+(skipped?(" ("+skipped+" existing numbers skipped)"):"")) : "Save failed — check permissions / internet");
  }
  /* ---- Table QR ---- */
  function tableUrl(id){
    const t = S.tables[id];
    return location.origin + location.pathname + "?shop=" + sid() + "&table=" + id + "&token=" + t.qrToken;
  }
  function qrDataUrl(url, size){
    const cv = document.createElement("canvas");
    new QRious({element:cv, value:url, size:size||320, background:"#ffffff", foreground:"#0f172a", level:"M"});
    return cv.toDataURL("image/png");
  }
  function openTableQr(id){
    const t = S.tables[id]; if (!t) return;
    const url = tableUrl(id);
    modalShow('<div class="modal-overlay" onclick="RESTO.modalClose(event)"><div class="modal-sheet" style="text-align:center;" onclick="event.stopPropagation()">'+
      '<div class="modal-title">'+esc(tableLabel(t))+' — QR</div>'+
      '<div style="background:#fff;border-radius:12px;padding:14px;display:inline-block;"><canvas id="qrCanvas"></canvas></div>'+
      '<div class="tiny muted" style="margin:10px 0;word-break:break-all;">'+esc(url)+'</div>'+
      '<div class="grid2" style="margin-bottom:8px;">'+
      '<button class="btn" style="background:#f1f5f9;color:#334155;" onclick="downloadQrImage(\''+esc(tableLabel(t)).replace(/[^A-Za-z0-9]+/g,"-")+'-qr\')">⬇️ Download</button>'+
      '<button class="btn primary" onclick="RESTO.printPosters([\''+id+'\'])">🖨️ Print Poster</button></div>'+
      '<div class="grid2" style="margin-bottom:8px;">'+
      '<button class="btn" style="background:#f1f5f9;color:#334155;" onclick="RESTO.copyLink(\''+id+'\')">🔗 Copy Link</button>'+
      '<button class="btn" style="background:#f1f5f9;color:#334155;" onclick="RESTO.shareLink(\''+id+'\')">📤 Share Link</button></div>'+
      '<button class="btn" style="background:#fef2f2;color:#991b1b;margin-bottom:8px;" onclick="RESTO.regenQr(\''+id+'\')">♻️ Regenerate QR (purana band)</button>'+
      '<button class="btn" style="background:var(--border);color:var(--text);" onclick="RESTO.modalClose()">Close</button>'+
      '</div></div>');
    try{ new QRious({element:document.getElementById("qrCanvas"), value:url, size:220, background:"#ffffff", foreground:"#0f172a", level:"M"}); }
    catch(e){ toast("Could not generate QR"); }
  }
  function copyLink(id){
    const url = tableUrl(id);
    if (navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(function(){ toast("Link copied"); }).catch(function(){ toast(url); }); }
    else toast(url);
  }
  function shareLink(id){
    const t = S.tables[id]; const url = tableUrl(id);
    if (navigator.share){ navigator.share({title:(S.settings.name||"Menu")+" — "+tableLabel(t), url:url}).catch(function(){}); }
    else copyLink(id);
  }
  async function regenQr(id){
    const t = S.tables[id]; if (!t) return;
    if (!confirm(tableLabel(t)+": the old QR/link will stop working. Generate a new QR?")) return;
    t.qrToken = tok(); cacheSave(); openTableQr(id);
    const a = await fbw(fbdb.ref("shops/"+sid()+"/restaurant/tables/"+id+"/qrToken").set(t.qrToken));
    const b = await fbw(fbdb.ref("shopPublic/"+sid()+"/tables/"+id+"/qrToken").set(t.qrToken));
    toast((a.ok && b.ok) ? "New QR generated — print the new one" : "Save failed — check permissions / internet");
  }
  function printPosters(ids){
    const tables = ids.map(function(id){ return Object.assign({id:id}, S.tables[id]); }).filter(function(t){ return t.qrToken; });
    if (!tables.length){ toast("No tables to print"); return; }
    const rname = S.settings.name || (STATE && STATE.settings && STATE.settings.shopName) || "";
    let body = "";
    try{
      body = tables.map(function(t){
        return '<div class="poster"><div class="rn">'+esc(rname)+'</div><div class="tn">'+esc(tableLabel(t).toUpperCase())+'</div>'+
          '<div class="sc">Scan to View Menu<br>&amp; Order</div><img src="'+qrDataUrl(tableUrl(t.id), 360)+'">'+
          '<div class="ft">Please scan using your phone camera</div></div>';
      }).join("");
    }catch(e){ toast("Could not generate QR"); return; }
    const w = window.open("", "_blank");
    if (!w){ toast("Popup blocked — allow popups in your browser"); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Table QR</title><style>'+
      'body{margin:0;font-family:Arial,sans-serif;} .poster{page-break-after:always;text-align:center;padding:40px 20px;} .poster:last-child{page-break-after:auto;}'+
      '.rn{font-size:22px;font-weight:700;color:#334155;} .tn{font-size:56px;font-weight:900;margin:14px 0;} .sc{font-size:26px;font-weight:700;margin-bottom:18px;line-height:1.3;}'+
      '.poster img{width:300px;height:300px;} .ft{font-size:18px;color:#475569;margin-top:16px;}'+
      '</style></head><body>'+body+'<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>');
    w.document.close();
  }
  function printAll(){ printPosters(tablesSorted().filter(function(t){ return t.status!=="out_of_service"; }).map(function(t){ return t.id; })); }

  /* ===================== Dashboard banner + screens ===================== */
  function bannerInner(){
    const icon = hasRestaurant() ? "🍽️" : "🏨";
    const ready = S.loadedFor===sid();
    let h = '<div class="restaurant-banner-title">'+icon+' '+esc(label(type()))+' Mode</div>';
    if (hasRestaurant()){
      const c = counts();
      h += '<div class="restaurant-stats">'+
        '<div><b>'+(ready?c.all:'…')+'</b><span>Tables</span></div>'+
        '<div><b>'+(ready?c.available:'…')+'</b><span>Available</span></div>'+
        '<div><b>'+(ready?c.occupied:'…')+'</b><span>Occupied</span></div></div>';
      h += '<button class="restaurant-open '+(S.settings.open?'is-open':'is-closed')+'" onclick="RESTO.toggleOpen()">'+(S.settings.open?'🟢 OPEN — tap to close':'🔴 CLOSED — tap to open')+'</button>';
      h += '<div class="grid2" style="margin-top:8px;">'+
        '<button class="btn primary" onclick="openScreen({type:\'rsTables\'})">🪑 Tables</button>'+
        '<button class="btn" style="background:#f1f5f9;color:#334155;" onclick="openScreen({type:\'rsSettings\'})">⚙️ Settings</button></div>';
      h += '<button class="btn primary" style="margin-top:8px;" onclick="openScreen({type:\'rsMenu\'})">🍽️ Menu</button>';
      h += '<div class="restaurant-banner-sub">Orders and Kitchen are coming in the next updates.</div>';
    } else {
      h += '<div class="restaurant-banner-sub">Rooms and Room Service are coming in the next updates. All other features keep working as before.</div>'+
        '<button class="btn" style="margin-top:8px;background:#f1f5f9;color:#334155;" onclick="openScreen({type:\'rsSettings\'})">⚙️ Settings</button>';
    }
    return h;
  }
  function refreshBanner(){ const el = document.getElementById("restoBanner"); if (el) el.innerHTML = bannerInner(); }
  function dashboardBannerHtml(){
    if (!isActiveMode()) return '';
    setTimeout(function(){ load().then(refreshBanner).catch(function(){}); }, 0);
    return '<div class="restaurant-banner" id="restoBanner">'+bannerInner()+'</div>';
  }
  function renderScreen(s){
    if (S.loadedFor!==sid()){
      setTimeout(function(){ load().then(function(){ render(); }).catch(function(){}); }, 0);
      return header("Restaurant", {onBack:"closeScreen('dashboard')"})+'<div class="content"><div class="empty">Loading…</div></div>';
    }
    if (s.type==="rsSettings") return renderSettings();
    if (s.type==="rsTables") return renderTables();
    if (s.type==="rsMenu" || s.type==="rsMenuItem" || s.type==="rsMenuGroup") return RMENU.renderScreen(s);
    return header("Restaurant", {onBack:"closeScreen('dashboard')"})+'<div class="content"><div class="empty">—</div></div>';
  }

  /* ===================== Customer side: table QR ===================== */
  const CUST = {tableId:null, label:"", ok:false, reason:""};
  async function resolveCustomerTable(shopId){
    const tid = getUrlParam("table");
    if (!tid) return;
    CUST.tableId = tid; CUST.ok = false; CUST.reason = "invalid";
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(tid)) return;   /* never use raw URL text as a DB path */
    try{
      const res = await Promise.all([
        withFbTimeout(fbdb.ref("shopPublic/"+shopId+"/tables/"+tid).once("value")),
        withFbTimeout(fbdb.ref("shopPublic/"+shopId+"/restaurant").once("value"))
      ]);
      if (res[0].__timedOut){ CUST.reason = "offline"; return; }
      const t = res[0].val(), rs = res[1].val() || {};
      const token = getUrlParam("token");
      if (!t) CUST.reason = "invalid";
      else if (rs.tableQr===false) CUST.reason = "disabled";
      else if (t.active===false) CUST.reason = "unavailable";
      else if (!token || !t.qrToken || token!==t.qrToken) CUST.reason = "old";
      else { CUST.ok = true; CUST.reason = ""; CUST.label = tableLabel(t); }
    }catch(e){ CUST.reason = "offline"; }
  }
  function customerChipHtml(){
    if (!CUST.tableId || CUST.reason==="offline") return '';
    if (CUST.ok) return '<div class="restaurant-table-chip">📍 '+esc(CUST.label)+'</div>';
    return '<div class="restaurant-table-chip warn">⚠️ This table QR is no longer valid — please ask the staff</div>';
  }

  /* ---- Super Admin: change shop type ---- */
  function openTypeModal(shopId){
    const s = SA_SHOPS.find(function(x){ return x.id===shopId; });
    if (!s) return;
    document.getElementById("toastHost").innerHTML = '<div class="modal-overlay" onclick="closeSaModal(event)"><div class="modal-sheet" onclick="event.stopPropagation()">'+
      '<div class="modal-title">🏷️ '+esc(s.shopName||"Shop")+' — Shop Type</div>'+
      selectHtml("sa_shopTypeEdit", s.businessType)+
      '<div class="tiny muted" style="margin:-6px 0 12px;">Existing data is not deleted. The change appears the next time the shop owner logs in or refreshes.</div>'+
      '<button class="btn primary" style="margin-bottom:10px;" onclick="RESTO.saveType(\''+shopId+'\')">Save</button>'+
      '<button class="btn" style="background:var(--border);color:var(--text);" onclick="closeSaModal(event)">Close</button>'+
      '</div></div>';
  }
  async function saveType(shopId){
    const s = SA_SHOPS.find(function(x){ return x.id===shopId; });
    const el = document.getElementById("sa_shopTypeEdit");
    if (!s || !el) return;
    const val = normalize(el.value);
    try {
      await fbdb.ref("shops/"+shopId+"/meta/businessType").set(val);
      try{ await fbdb.ref("shopPublic/"+shopId+"/businessType").set(val); }catch(e){}
      s.businessType = val;
      softRenderSAShops();
      document.getElementById("toastHost").innerHTML = "";
      toast("Shop type saved: "+label(val));
    } catch(e){ toast("Save failed — check your internet"); }
  }
  return {TYPES:TYPES, normalize:normalize, typeOf:typeOf, type:type, hasRestaurant:hasRestaurant, hasHotel:hasHotel,
          isActiveMode:isActiveMode, label:label, selectHtml:selectHtml, dashboardBannerHtml:dashboardBannerHtml,
          openTypeModal:openTypeModal, saveType:saveType,
          renderScreen:renderScreen, load:load, saveSettings:saveSettings, toggleOpen:toggleOpen,
          modalClose:modalClose, setTableFilter:setTableFilter, openTableForm:openTableForm, saveTable:saveTable,
          openStatusMenu:openStatusMenu, setStatus:setStatus, deleteTable:deleteTable, openBulkForm:openBulkForm, saveBulk:saveBulk,
          openTableQr:openTableQr, copyLink:copyLink, shareLink:shareLink, regenQr:regenQr, printPosters:printPosters, printAll:printAll,
          resolveCustomerTable:resolveCustomerTable, customerChipHtml:customerChipHtml,
          fbw:fbw, sid:sid, modalShow:modalShow, sheet:sheet, cacheSave:cacheSave, normalize:normalize,
          _S:S, _CUST:CUST, _tableUrl:tableUrl};
})();

/* =====================================================================
   MyDukaan RESTAURANT MENU — Phase 4 (menu) + Phase 5 (customer menu / cart)
   Separate block; uses RESTO internals (RESTO._S, RESTO.fbw, ...). Existing products are
   reused: name / price / MRP / photo live in STATE.products, restaurant-only fields live in
   shops/{id}/restaurant/menu/{productId}. Public copy: shopPublic/{id}/menu/{productId}.
   To remove: delete this block + lines marked RS-HOOK.
===================================================================== */
const RS_SAFE_ID = /^(?!__proto__$|constructor$|prototype$)[A-Za-z0-9_-]{1,40}$/;   /* ids that are safe to use in DB paths, object keys and inline handlers */
function rsmIds(v){
  if (!v) return [];
  const a = Array.isArray(v) ? v : Object.keys(v).filter(function(k){ return v[k]; });
  return a.filter(function(x){ return typeof x==="string" && RS_SAFE_ID.test(x); });
}
function rsmOptions(g){
  const o = (g && g.options) || {};
  const keys = Array.isArray(o) ? o.map(function(_,i){ return String(i); }) : Object.keys(o);
  return keys.filter(function(k){ return RS_SAFE_ID.test(k) && o[k] && typeof o[k]==="object"; })
    .map(function(k){ return {id:k, name:String(o[k].name||""), price:Math.max(0, Number(o[k].price)||0), available:o[k].available!==false, order:Number(o[k].order)||0}; })
    .sort(function(a,b){ return a.order-b.order; });
}
/* The ONE place where a restaurant order total is computed (cart, confirm, order, bill).
   lines: [{key,itemId,qty,sel:{groupId:[optionId]},note}]; menu/groups: owner data (public copy
   on the customer side, private copy on the owner side). Prices come ONLY from menu/groups —
   whatever price the client may have stored is ignored. Money is computed in paise (integers).
   Service charge = % of subtotal; GST = % of (subtotal + service charge).
   Returned lines are the snapshot to store with an order (name, unit price, chosen options). */
function calculateRestaurantOrderTotals(lines, menu, groups, settings){
  menu = menu || {}; groups = groups || {}; settings = settings || {};
  const paise = function(n){ n = Number(n); return isFinite(n) ? Math.round(n*100) : 0; };
  const pct = function(n){ n = Number(n); return (isFinite(n) && n>0) ? Math.min(100, n) : 0; };
  const out = {lines:[], errors:[], itemCount:0, valid:true};
  let subP = 0;
  (Array.isArray(lines) ? lines : []).forEach(function(ln){
    ln = ln || {};
    const it = (typeof ln.itemId==="string" && RS_SAFE_ID.test(ln.itemId) && Object.prototype.hasOwnProperty.call(menu, ln.itemId)) ? menu[ln.itemId] : null;
    const L = {key:String(ln.key||""), itemId:String(ln.itemId||""), name:it?String(it.name||""):"", foodType:it?(it.foodType||"veg"):"veg",
      station:it?(it.station||"kitchen"):"kitchen", qty:Math.min(50, Math.max(1, parseInt(ln.qty,10)||1)),
      note:String(ln.note||"").trim().slice(0,200), options:[], baseP:0, optionsP:0, unitP:0, lineP:0, errors:[]};
    if (!it){ L.errors.push("This item is no longer on the menu"); }
    else {
      if (it.available===false) L.errors.push("Currently Unavailable");
      L.baseP = Math.max(0, paise(it.price));
      const attached = rsmIds(it.groupIds);
      const sel = (ln.sel && typeof ln.sel==="object") ? ln.sel : {};
      Object.keys(sel).forEach(function(gid){
        if (attached.indexOf(gid)===-1 && rsmIds(sel[gid]).length) L.errors.push("Invalid customization selected");
      });
      attached.forEach(function(gid){
        const g = Object.prototype.hasOwnProperty.call(groups, gid) ? groups[gid] : null;
        if (!g || g.active===false) return;
        const opts = rsmOptions(g);
        if (!opts.length) return;
        const chosen = [];
        rsmIds(sel[gid]).forEach(function(oid){ if (chosen.indexOf(oid)===-1) chosen.push(oid); });
        const single = g.type!=="multi";
        chosen.forEach(function(oid){
          const op = opts.find(function(x){ return x.id===oid; });
          if (!op){ L.errors.push("The selected option is no longer available"); return; }
          if (!op.available){ L.errors.push(op.name+" is currently unavailable"); return; }
          L.options.push({groupId:gid, groupName:String(g.name||""), optionId:oid, optionName:op.name, price:op.price/1});
          L.optionsP += paise(op.price);
        });
        if (single && chosen.length>1) L.errors.push((g.name||"Option")+": choose only 1");
        const max = parseInt(g.max,10)||0;
        if (!single && max>0 && chosen.length>max) L.errors.push((g.name||"Option")+": choose up to "+max);
        if (g.required && chosen.length<1) L.errors.push((g.name||"Option")+" is required");
      });
    }
    L.unitP = L.baseP + L.optionsP;
    L.lineP = L.unitP * L.qty;
    L.valid = L.errors.length===0;
    L.basePrice = L.baseP/100; L.optionsPrice = L.optionsP/100; L.unitPrice = L.unitP/100; L.lineTotal = L.lineP/100;
    subP += L.lineP;
    out.itemCount += L.qty;
    if (!L.valid){ out.valid = false; L.errors.forEach(function(e){ out.errors.push((L.name||"Item")+": "+e); }); }
    out.lines.push(L);
  });
  if (!out.lines.length) out.valid = false;
  const servicePct = settings.serviceEnabled ? pct(settings.servicePct) : 0;
  const taxPct = settings.taxEnabled ? pct(settings.taxPct) : 0;
  const svcP = Math.round(subP * servicePct / 100);
  const taxP = Math.round((subP + svcP) * taxPct / 100);
  out.subtotalP = subP; out.serviceP = svcP; out.taxP = taxP; out.totalP = subP + svcP + taxP;
  out.subtotal = subP/100; out.service = svcP/100; out.tax = taxP/100; out.total = out.totalP/100;
  out.servicePct = servicePct; out.taxPct = taxPct;
  return out;
}

const RMENU = (function(){
  const FOOD = {veg:["Veg"], nonveg:["Non-Veg"], egg:["Egg"]};
  const STATIONS = {kitchen:"🍳 Kitchen", bar:"🍹 Bar", dessert:"🍨 Dessert", bakery:"🥐 Bakery"};
  const SPICY = ["No spice","🌶 Mild","🌶🌶 Medium","🌶🌶🌶 Hot"];
  const COMMON_CATS = ["Starters","Main Course","Breads","Rice & Biryani","Beverages","Desserts"];
  /* Presets are only TEMPLATES. Nothing is attached to any item until the owner ticks it. */
  const PRESETS = {
    spice:{label:"Spice Level", type:"single", opts:["Mild","Medium","Spicy","Extra Spicy"]},
    sugar:{label:"Sugar", type:"single", opts:["No Sugar","Less Sugar","Normal Sugar","Extra Sugar"]},
    salt:{label:"Salt", type:"single", opts:["No Salt","Less Salt","Normal Salt","Extra Salt"]},
    temp:{label:"Temperature", type:"single", opts:["Hot","Warm","Cold","With Ice"]}
  };
  const rs = RESTO._S;
  const M = {tab:"items", q:"", cat:"all", form:null, gform:null, catEditId:null};
  const PUBSIG = {};
  const asList = function(v){ return !v ? [] : (Array.isArray(v) ? v.filter(function(x){ return x!=null; }) : Object.keys(v).map(function(k){ return v[k]; })); };
  function sid(){ return RESTO.sid(); }
  function active(){ return typeof STATE!=="undefined" && STATE && RESTO.hasRestaurant() && rs.loadedFor===sid(); }
  function say(msg, bad){
    const host = document.getElementById("toastHost"); if (!host) return;
    host.innerHTML = '<div class="toast">'+(bad?'⚠️ ':'✓ ')+esc(msg)+'</div>';
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ host.innerHTML=""; }, bad?3200:1800);
  }
  function vegBadge(t){ return '<span class="restaurant-veg '+(t==="nonveg"?"nonveg":t==="egg"?"egg":"")+'" title="'+esc((FOOD[t]||FOOD.veg)[0])+'"></span>'; }
  function foodOf(t){ return FOOD[t] ? t : "veg"; }
  function numOrder(a,b){ return (Number(a.order)||0)-(Number(b.order)||0) || String(a.name).localeCompare(String(b.name)); }
  function catList(){ return Object.keys(rs.categories||{}).filter(function(k){ return RS_SAFE_ID.test(k) && rs.categories[k]; }).map(function(k){ return Object.assign({id:k}, rs.categories[k]); }).sort(numOrder); }
  function groupList(){ return Object.keys(rs.groups||{}).filter(function(k){ return RS_SAFE_ID.test(k) && rs.groups[k]; }).map(function(k){ return Object.assign({id:k}, rs.groups[k]); }).sort(numOrder); }
  function catName(id){ const c = rs.categories[id]; return c ? c.name : "Uncategorized"; }
  function menuProducts(){ return (STATE.products||[]).filter(function(p){ return rs.menu[p.id]; }); }
  function usedCount(gid){ return menuProducts().filter(function(p){ return rsmIds(rs.menu[p.id].groupIds).indexOf(gid)!==-1; }).length; }

  /* ---------------- public copy ---------------- */
  function pubItem(pid){
    const p = (STATE.products||[]).find(function(x){ return x.id===pid; }), m = rs.menu[pid];
    if (!p || !m) return null;
    const photo = productPhotosOf(p).find(function(u){ return u && !isLegacyBase64Photo(u); }) || "";
    return {name:String(p.name||""), price:Number(p.sellingPrice)||0, mrp:Number(p.mrp)||0, photo:photo,
      description:String(m.description||""), categoryId:String(m.categoryId||""), foodType:foodOf(m.foodType), available:m.available!==false,
      prepTime:Number(m.prepTime)||0, popular:!!m.popular, spicy:Number(m.spicy)||0, station:STATIONS[m.station]?m.station:"kitchen", groupIds:rsmIds(m.groupIds)};
  }
  function syncPublic(force){
    if (!active()) return Promise.resolve({ok:true});
    const changes = {}, keys = [];
    Object.keys(rs.menu).forEach(function(pid){
      if (!RS_SAFE_ID.test(pid)) return;
      const o = pubItem(pid), sig = o ? JSON.stringify(o) : "null";
      if (!force && PUBSIG[pid]===sig) return;
      PUBSIG[pid] = sig; changes[pid] = o; keys.push(pid);
    });
    if (!keys.length) return Promise.resolve({ok:true});
    return RESTO.fbw(fbdb.ref("shopPublic/"+sid()+"/menu").update(changes)).then(function(r){
      if (!r.ok) keys.forEach(function(k){ delete PUBSIG[k]; });
      return r;
    });
  }
  function onProductsChanged(){ try{ if (active()) syncPublic(false); }catch(e){} }   /* called from persist() / RESTO.load() */
  function pubGroup(g){
    const opts = {}; rsmOptions(g).forEach(function(o,i){ opts[o.id] = {name:o.name, price:o.price, available:o.available, order:i}; });
    return {name:String(g.name||""), type:g.type==="multi"?"multi":"single", required:!!g.required, max:parseInt(g.max,10)||0, order:Number(g.order)||0, active:g.active!==false, options:opts};
  }
  function privMenuNode(pid){
    const m = rs.menu[pid];
    return {categoryId:m.categoryId||"", description:m.description||"", foodType:foodOf(m.foodType), available:m.available!==false, prepTime:Number(m.prepTime)||0,
      popular:!!m.popular, spicy:Number(m.spicy)||0, station:STATIONS[m.station]?m.station:"kitchen", groupIds:rsmIds(m.groupIds), updatedAt:m.updatedAt||Date.now()};
  }
  function saveBase(){ RESTO.cacheSave(); }
  async function writePair(privPath, pubPath, val){      /* val===null -> remove */
    const a = await RESTO.fbw(val===null ? fbdb.ref(privPath).remove() : fbdb.ref(privPath).set(val));
    let b = {ok:true};
    if (pubPath) b = await RESTO.fbw(val===null ? fbdb.ref(pubPath).remove() : fbdb.ref(pubPath).set(pubValue(pubPath, val)));
    return a.ok && b.ok;
  }
  function pubValue(path, val){ return val; }

  /* ---------------- owner: main screen ---------------- */
  function renderScreen(s){
    if (s.type==="rsMenuItem") return renderItemForm();
    if (s.type==="rsMenuGroup") return renderGroupForm();
    syncPublic(false);
    return renderMain();
  }
  function renderMain(){
    const plus = M.tab==="items" ? "RMENU.openItemForm(null)" : M.tab==="cats" ? "RMENU.openCatForm(null)" : "RMENU.openGroupForm(null,null)";
    let h = header("Menu", {onBack:"closeScreen('dashboard')", rightHtml:'<button class="icon-btn solid" onclick="'+plus+'">+</button>'});
    h += '<div class="content restaurant-screen">';
    h += '<div class="restaurant-chips">'+[["items","🍽️ Items ("+menuProducts().length+")"],["cats","🗂️ Categories ("+catList().length+")"],["custom","🎛️ Customize ("+groupList().length+")"]].map(function(t){
      return '<button class="restaurant-chip'+(M.tab===t[0]?' active':'')+'" onclick="RMENU.setTab(\''+t[0]+'\')">'+t[1]+'</button>'; }).join('')+'</div>';
    h += '<div id="rmBody">'+(M.tab==="items" ? itemsTabHtml() : M.tab==="cats" ? catsTabHtml() : customTabHtml())+'</div></div>';
    return h;
  }
  function setTab(t){ M.tab = t; render(); }

  /* ---- items tab ---- */
  function itemsTabHtml(){
    const cats = catList();
    let h = '<div class="grid2" style="margin-bottom:10px;">'+
      '<button class="btn primary" onclick="RMENU.openItemForm(null)">➕ New Item</button>'+
      '<button class="btn" style="background:#f1f5f9;color:#334155;" onclick="RMENU.openAddExisting()">📦 Existing Product</button></div>';
    h += '<div class="search"><span>🔍</span><input type="text" id="rmSearch" placeholder="Menu item search…" value="'+esc(M.q)+'" oninput="RMENU.setQ(this.value)"></div>';
    h += '<div class="restaurant-chips">'+[["all","All"]].concat(cats.map(function(c){ return [c.id, c.name]; })).concat([["none","Uncategorized"]]).map(function(c){
      return '<button class="restaurant-chip'+(M.cat===c[0]?' active':'')+'" onclick="RMENU.setCat(\''+c[0]+'\')">'+esc(c[1])+'</button>'; }).join('')+'</div>';
    h += '<div id="rmItems">'+itemsHtml()+'</div>';
    return h;
  }
  function itemsHtml(){
    const q = M.q.trim().toLowerCase();
    const list = menuProducts().filter(function(p){
      const m = rs.menu[p.id];
      if (M.cat==="none" ? (m.categoryId && rs.categories[m.categoryId]) : (M.cat!=="all" && m.categoryId!==M.cat)) return false;
      return !q || String(p.name).toLowerCase().indexOf(q)!==-1;
    }).sort(function(a,b){ return String(a.name).localeCompare(String(b.name)); });
    if (!menuProducts().length) return '<div class="empty">The menu is empty.<br>Create an item with “New Item” or add an old product with “Existing Product”.</div>';
    if (!list.length) return '<div class="empty">No items found</div>';
    return list.map(function(p){
      const m = rs.menu[p.id], ph = productPhotosOf(p)[0], on = m.available!==false;
      const gids = rsmIds(m.groupIds).filter(function(g){ return rs.groups[g]; });
      return '<div class="restaurant-menu-card" data-pid="'+esc(p.id)+'"><div class="restaurant-thumb">'+(ph?'<img src="'+esc(ph)+'" alt="" onerror="this.style.display=\'none\'">':'🍽️')+'</div>'+
        '<div class="restaurant-menu-main"><div class="restaurant-menu-name">'+vegBadge(m.foodType)+'<span>'+esc(p.name)+'</span>'+(m.popular?' ⭐':'')+'</div>'+
        '<div class="restaurant-menu-meta"><b>'+fmt(p.sellingPrice)+'</b>'+(Number(p.mrp)>Number(p.sellingPrice)?' <s>'+fmt(p.mrp)+'</s>':'')+' · '+esc(catName(m.categoryId))+' · '+esc(STATIONS[m.station]||STATIONS.kitchen)+
        (m.prepTime?' · ⏱ '+esc(m.prepTime)+' min':'')+(m.spicy?' · '+esc(SPICY[m.spicy]||''):'')+(gids.length?' · 🎛️ '+gids.length:'')+'</div>'+
        '<div class="restaurant-menu-actions"><button class="restaurant-toggle '+(on?'on':'off')+'" onclick="RMENU.toggleAvail(\''+p.id+'\')">'+(on?'✅ Available':'⛔ Sold out')+'</button>'+
        '<button class="icon-mini-btn" onclick="RMENU.openItemForm(\''+p.id+'\')">✏️ Edit</button>'+
        '<button class="icon-mini-btn danger" onclick="RMENU.removeFromMenu(\''+p.id+'\')">🗑️ Remove from menu</button></div></div></div>';
    }).join('');
  }
  function softItems(){ const el = document.getElementById("rmItems"); if (el) el.innerHTML = itemsHtml(); }
  function setQ(v){ M.q = v; softItems(); }
  function setCat(c){ M.cat = c; render(); }
  async function toggleAvail(pid){
    const m = rs.menu[pid]; if (!m) return;
    m.available = (m.available===false);
    saveBase(); softItems();
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/menu/"+pid+"/available").set(m.available!==false));
    const b = await syncPublic(false);
    if (!(a.ok && b.ok)) say("Save failed — check permissions / internet", true);
  }
  async function removeFromMenu(pid){
    const p = (STATE.products||[]).find(function(x){ return x.id===pid; });
    if (!confirm('Remove "'+(p?p.name:"Item")+'" from the menu? The product stays in your Products list.')) return;
    delete rs.menu[pid]; saveBase(); PUBSIG[pid] = "null"; render();
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/menu/"+pid).remove());
    const b = await RESTO.fbw(fbdb.ref("shopPublic/"+sid()+"/menu/"+pid).remove());
    if (!(a.ok && b.ok)) say("Delete failed — check permissions / internet", true);
  }
  function openAddExisting(){
    const list = (STATE.products||[]).filter(function(p){ return !rs.menu[p.id]; });
    RESTO.modalShow(RESTO.sheet('<div class="modal-title">📦 Add an existing product to the menu</div>'+
      (list.length ? list.map(function(p){
        return '<div class="restaurant-menu-card" style="align-items:center;"><div class="restaurant-menu-main"><div class="restaurant-menu-name">'+esc(p.name)+'</div><div class="restaurant-menu-meta">'+fmt(p.sellingPrice)+'</div></div>'+
          '<button class="icon-mini-btn" onclick="RESTO.modalClose();RMENU.openItemForm(\''+p.id+'\')">＋ Add to menu</button></div>'; }).join('')
        : '<div class="empty">All products are already on the menu (or there are no products).</div>')+
      '<button class="btn" style="background:var(--border);color:var(--text);" onclick="RESTO.modalClose()">Close</button>'));
  }

  /* ---- categories tab ---- */
  function catsTabHtml(){
    const cats = catList();
    let h = '';
    if (!cats.length){
      h += '<div class="empty">No categories yet.</div><button class="btn primary" style="margin-bottom:8px;" onclick="RMENU.addCommonCats()">⚡ Add common categories</button>'+
        '<div class="restaurant-hint">'+esc(COMMON_CATS.join(", "))+'</div>';
    }
    h += cats.map(function(c,i){
      const n = menuProducts().filter(function(p){ return rs.menu[p.id].categoryId===c.id; }).length;
      return '<div class="restaurant-menu-card" style="align-items:center;"><div class="restaurant-menu-main"><div class="restaurant-menu-name">'+esc(c.name)+'</div><div class="restaurant-menu-meta">'+n+' items</div></div>'+
        '<button class="icon-mini-btn" '+(i===0?'disabled':'')+' onclick="RMENU.moveCat(\''+c.id+'\',-1)">⬆️</button>'+
        '<button class="icon-mini-btn" '+(i===cats.length-1?'disabled':'')+' onclick="RMENU.moveCat(\''+c.id+'\',1)">⬇️</button>'+
        '<button class="icon-mini-btn" onclick="RMENU.openCatForm(\''+c.id+'\')">✏️</button>'+
        '<button class="icon-mini-btn danger" onclick="RMENU.deleteCat(\''+c.id+'\')">🗑️</button></div>';
    }).join('');
    if (cats.length) h += '<button class="btn primary" onclick="RMENU.openCatForm(null)">➕ New Category</button>';
    return h;
  }
  function openCatForm(id){
    const c = id ? rs.categories[id] : null;
    M.catEditId = id;
    RESTO.modalShow(RESTO.sheet('<div class="modal-title">'+(c?'✏️ Category Edit':'🗂️ New Category')+'</div>'+
      field("Category Name *","text","rm_cat_name", c?c.name:"")+'<div id="rm_cat_err" class="restaurant-err" style="margin:-6px 0 10px;"></div>'+
      '<button class="btn primary" style="margin-bottom:10px;" onclick="RMENU.saveCat()">Save</button>'+
      '<button class="btn" style="background:var(--border);color:var(--text);" onclick="RESTO.modalClose()">Close</button>'));
  }
  function catNameTaken(name, exceptId){
    const n = name.trim().toLowerCase();
    return catList().some(function(c){ return c.id!==exceptId && String(c.name).trim().toLowerCase()===n; });
  }
  async function saveCat(){
    const el = document.getElementById("rm_cat_name"); const name = el ? el.value.trim() : "";
    const err = function(m){ const e = document.getElementById("rm_cat_err"); if (e) e.textContent = "⚠️ "+m; };   /* inline: toast() would wipe this modal */
    if (!name){ err("Enter a category name"); return; }
    if (name.length>40){ err("Name can be up to 40 characters"); return; }
    if (catNameTaken(name, M.catEditId)){ err("This category already exists"); return; }
    const id = M.catEditId || ("C"+uid());
    const old = rs.categories[id];
    const order = old ? (Number(old.order)||0) : catList().length;
    rs.categories[id] = {name:name, order:order, active:true};
    saveBase(); RESTO.modalClose(); render();
    const ok = await writePair("shops/"+sid()+"/restaurant/categories/"+id, "shopPublic/"+sid()+"/menuCategories/"+id, rs.categories[id]);
    if (!ok) say("Save failed — check permissions / internet", true);
  }
  async function addCommonCats(){
    const priv = {}; let i = catList().length;
    COMMON_CATS.forEach(function(n){ if (catNameTaken(n,null)) return; const id = "C"+uid(); priv[id] = {name:n, order:i++, active:true}; rs.categories[id] = priv[id]; });
    saveBase(); render();
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/categories").update(priv));
    const b = await RESTO.fbw(fbdb.ref("shopPublic/"+sid()+"/menuCategories").update(priv));
    if (!(a.ok && b.ok)) say("Save failed — check permissions / internet", true);
  }
  async function moveCat(id, dir){
    const list = catList(), i = list.findIndex(function(c){ return c.id===id; }), j = i+dir;
    if (i<0 || j<0 || j>=list.length) return;
    const t = list[i]; list[i] = list[j]; list[j] = t;
    const upd = {};
    list.forEach(function(c,k){ rs.categories[c.id].order = k; upd[c.id+"/order"] = k; });
    saveBase(); render();
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/categories").update(upd));
    const b = await RESTO.fbw(fbdb.ref("shopPublic/"+sid()+"/menuCategories").update(upd));
    if (!(a.ok && b.ok)) say("Reorder failed — check permissions / internet", true);
  }
  async function deleteCat(id){
    const c = rs.categories[id]; if (!c) return;
    const items = menuProducts().filter(function(p){ return rs.menu[p.id].categoryId===id; });
    if (!confirm('Delete "'+c.name+'"?'+(items.length?(' It has '+items.length+' items — they will become "Uncategorized".'):''))) return;
    delete rs.categories[id];
    items.forEach(function(p){ rs.menu[p.id].categoryId = ""; });
    saveBase(); if (M.cat===id) M.cat = "all"; render();
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/categories/"+id).remove());
    const b = await RESTO.fbw(fbdb.ref("shopPublic/"+sid()+"/menuCategories/"+id).remove());
    let ok = a.ok && b.ok;
    if (items.length){
      const upd = {}; items.forEach(function(p){ upd[p.id+"/categoryId"] = ""; });
      const r = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/menu").update(upd)); ok = ok && r.ok;
      const r2 = await syncPublic(false); ok = ok && r2.ok;
    }
    if (!ok) say("Delete failed — check permissions / internet", true);
  }

  /* ---- item form ---- */
  function openItemForm(pid){
    const p = pid ? (STATE.products||[]).find(function(x){ return x.id===pid; }) : null;
    const m = pid ? rs.menu[pid] : null;
    if (pid && !p){ say("Product not found", true); return; }
    M.form = {pid:pid||null, isNew:!p, onMenu:!!m,
      name:p?p.name:"", price:p?p.sellingPrice:"", mrp:(p&&p.mrp)?p.mrp:"",
      categoryId:m?(m.categoryId||""):(M.cat && rs.categories[M.cat] ? M.cat : ""), description:m?(m.description||""):"",
      foodType:m?foodOf(m.foodType):"veg", available:m?m.available!==false:true, prepTime:m?(m.prepTime||""):"",
      popular:m?!!m.popular:false, spicy:m?(Number(m.spicy)||0):0, station:m&&STATIONS[m.station]?m.station:"kitchen",
      groupIds:m?rsmIds(m.groupIds):[], photo:p?(productPhotosOf(p)[0]||""):"", _blob:null, _preview:"", _removePhoto:false};
    openScreen({type:"rsMenuItem"});
  }
  function collectItem(){
    const F = M.form; if (!F) return;
    const v = function(id){ const e = document.getElementById(id); return e ? e.value : null; };
    const set = function(k,id){ const x = v(id); if (x!==null) F[k] = x; };
    set("name","rm_f_name"); set("price","rm_f_price"); set("mrp","rm_f_mrp"); set("description","rm_f_desc"); set("prepTime","rm_f_prep"); set("categoryId","rm_f_cat");
    const av = document.getElementById("rm_f_avail"); if (av) F.available = av.checked;
    const po = document.getElementById("rm_f_pop"); if (po) F.popular = po.checked;
    const boxes = document.querySelectorAll("[data-rmg]");
    if (boxes.length || document.getElementById("rm_f_groups")){ F.groupIds = []; boxes.forEach(function(b){ if (b.checked) F.groupIds.push(b.getAttribute("data-rmg")); }); }
  }
  function setF(k, val){ collectItem(); M.form[k] = val; render(); }
  function seg(key, pairs, cur){
    return '<div class="restaurant-seg">'+pairs.map(function(p){ return '<button type="button" class="'+(String(cur)===String(p[0])?'active':'')+'" onclick="RMENU.setF(\''+key+'\','+(typeof p[0]==="number"?p[0]:"'"+p[0]+"'")+')">'+p[1]+'</button>'; }).join('')+'</div>';
  }
  function renderItemForm(){
    const F = M.form;
    if (!F) return header("Menu Item",{onBack:"openScreen({type:'rsMenu'})"})+'<div class="content"><div class="empty">—</div></div>';
    const shown = F._preview || (F._removePhoto ? "" : F.photo);
    let h = header(F.isNew?"New Menu Item":(F.onMenu?"Menu Item Edit":"Add to Menu"), {onBack:"RMENU.backFromForm()"});
    h += '<div class="content restaurant-screen">';
    h += '<label class="field-label">Photo (optional)</label><div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">'+
      '<div class="restaurant-thumb" style="width:72px;height:72px;" id="rm_f_photoPrev">'+(shown?'<img src="'+esc(shown)+'">':'📷')+'</div>'+
      '<input type="file" accept="image/*" id="rm_f_photoInput" style="display:none;" onchange="RMENU.onPhoto(event)">'+
      '<button class="btn primary" style="width:auto;padding:0 14px;" onclick="document.getElementById(\'rm_f_photoInput\').click()">🖼️ Add photo</button>'+
      (shown?'<button class="icon-mini-btn danger" onclick="RMENU.removePhoto()">🗑️</button>':'')+'</div>';
    h += field("Item Name *","text","rm_f_name",F.name);
    h += '<div class="field"><label class="field-label">Description (optional)</label><textarea id="rm_f_desc" rows="2" maxlength="300">'+esc(F.description)+'</textarea></div>';
    h += '<div class="field"><label class="field-label">Category</label><select id="rm_f_cat"><option value="">Uncategorized</option>'+
      catList().map(function(c){ return '<option value="'+c.id+'"'+(F.categoryId===c.id?' selected':'')+'>'+esc(c.name)+'</option>'; }).join('')+'</select></div>';
    h += '<div class="grid2">'+field("Price (₹) *","number","rm_f_price",F.price)+field("MRP (optional)","number","rm_f_mrp",F.mrp)+'</div>';
    h += '<label class="field-label">Type</label>'+seg("foodType",[["veg","🟢 Veg"],["nonveg","🔴 Non-Veg"],["egg","🟡 Egg"]],F.foodType);
    h += '<label class="field-label">Spicy Level</label>'+seg("spicy",SPICY.map(function(s,i){ return [i,s]; }),F.spicy);
    h += '<label class="field-label">Station</label>'+seg("station",Object.keys(STATIONS).map(function(k){ return [k,STATIONS[k]]; }),F.station);
    h += field("Prep Time (minutes, optional)","number","rm_f_prep",F.prepTime);
    h += '<div class="card" style="margin-bottom:12px;padding:4px 14px;">'+
      '<label class="restaurant-row"><span>✅ Available (OFF = Sold out)</span><input type="checkbox" id="rm_f_avail"'+(F.available?' checked':'')+'></label>'+
      '<label class="restaurant-row" style="border-bottom:none;"><span>⭐ Popular item</span><input type="checkbox" id="rm_f_pop"'+(F.popular?' checked':'')+'></label></div>';
    const gl = groupList();
    h += '<div class="section-title" style="margin-top:4px;">🎛️ Customization (groups that apply to this item)</div><div id="rm_f_groups">'+
      (gl.length ? gl.map(function(g){
        return '<label class="restaurant-row"><span>'+esc(g.name)+' <span class="restaurant-badge">'+(g.type==="multi"?"Multi":"Single")+'</span>'+(g.required?'<span class="restaurant-badge req">Required</span>':'')+'</span>'+
          '<input type="checkbox" data-rmg="'+g.id+'"'+(F.groupIds.indexOf(g.id)!==-1?' checked':'')+'></label>'; }).join('')
        : '<div class="restaurant-hint">No customization groups yet. Create Spice / Sugar / Salt / Temperature or your own group in Menu → Customize.</div>')+'</div>';
    h += '<button class="btn primary" id="rm_saveBtn" style="margin-top:12px;" onclick="RMENU.saveItem()">💾 Save</button></div>';
    return h;
  }
  function backFromForm(){ M.form = null; openScreen({type:"rsMenu"}); }
  function onPhoto(e){
    const file = e.target.files[0]; if (!file || !M.form) return;
    collectItem();
    fileToCompressedBlob(file, 900, 0.75).then(function(blob){
      const F = M.form; if (!F) return;
      if (F._preview) URL.revokeObjectURL(F._preview);
      F._blob = blob; F._preview = URL.createObjectURL(blob); F._removePhoto = false; render();
    }).catch(function(){ say("Could not load the photo", true); });
  }
  function removePhoto(){ collectItem(); const F = M.form; if (F._preview) URL.revokeObjectURL(F._preview); F._blob = null; F._preview = ""; F._removePhoto = true; render(); }
  async function saveItem(){
    collectItem();
    const F = M.form; if (!F) return;
    const name = String(F.name||"").trim(), price = Number(F.price), mrp = F.mrp==="" ? 0 : Number(F.mrp), prep = F.prepTime==="" ? 0 : Number(F.prepTime);
    if (!name){ say("Enter the item name", true); return; }
    if (name.length>80){ say("Name can be up to 80 characters", true); return; }
    if (F.price==="" || !isFinite(price) || price<0 || price>100000){ say("Enter a valid price (0 – 1,00,000)", true); return; }
    if (!isFinite(mrp) || mrp<0 || (mrp>0 && mrp<price)){ say("MRP cannot be lower than the price", true); return; }
    if (!isFinite(prep) || prep<0 || prep>300){ say("Prep time must be 0–300 minutes", true); return; }
    const dup = menuProducts().some(function(p){ return p.id!==F.pid && String(p.name).trim().toLowerCase()===name.toLowerCase(); });
    if (dup && !confirm('An item named "'+name+'" is already on the menu. Save anyway?')) return;
    const btn = document.getElementById("rm_saveBtn"); if (btn) btn.disabled = true;
    const pid = F.pid || uid();
    let photoUrl = F._removePhoto ? "" : F.photo, photoWarn = false;
    if (F._blob){
      if (!navigator.onLine){ say("Internet is required to upload a photo", true); if (btn) btn.disabled = false; return; }
      try{ photoUrl = await uploadImageOrFallback(F._blob, "mydukaan/shops/"+sid()+"/products/"+pid); photoWarn = isLegacyBase64Photo(photoUrl); }
      catch(e){ say("Could not save the photo — please try again", true); if (btn) btn.disabled = false; return; }
    }
    let p = STATE.products.find(function(x){ return x.id===pid; });
    if (!p){
      p = {id:pid, name:name, category:(STATE.settings&&STATE.settings.shopCategory)||"General", unit:"piece", purchasePrice:0, sellingPrice:price, mrp:mrp, qty:0, minLevel:0,
        madeToOrder:true, batchNumber:"", expiryDate:"", barcode:generateBarcode(), photos:[], photo:""};
      STATE.products.push(p);
    }
    p.name = name; p.sellingPrice = price; p.mrp = mrp;
    const ph = productPhotosOf(p).slice(0,3);
    if (photoUrl) ph[0] = photoUrl; else if (F._removePhoto && ph.length) ph.shift();
    p.photos = ph; p.photo = ph[0] || "";
    const node = {categoryId:rs.categories[F.categoryId]?F.categoryId:"", description:String(F.description||"").trim().slice(0,300), foodType:foodOf(F.foodType),
      available:!!F.available, prepTime:Math.round(prep), popular:!!F.popular, spicy:Math.min(3,Math.max(0,Number(F.spicy)||0)), station:STATIONS[F.station]?F.station:"kitchen",
      groupIds:F.groupIds.filter(function(g){ return rs.groups[g]; }), updatedAt:Date.now()};
    rs.menu[pid] = node; saveBase();
    persist();                       /* product fields -> shops/{id}/data ; RS-HOOK in persist() also pushes the public copy */
    if (F._preview) URL.revokeObjectURL(F._preview);
    M.form = null; openScreen({type:"rsMenu"});
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/menu/"+pid).set(privMenuNode(pid)));
    const b = await syncPublic(false);
    if (!(a.ok && b.ok)) say("Menu save failed — check permissions / internet", true);
    else say(photoWarn ? "Item saved (the photo will not show on the customer menu — upload failed)" : "Menu item saved");
  }

  /* ---- customization tab ---- */
  function customTabHtml(){
    const gl = groupList();
    let h = '<div class="section-title" style="margin-top:0;">⚡ Presets (templates — never applied to any item automatically)</div><div class="restaurant-chips" style="flex-wrap:wrap;">'+
      Object.keys(PRESETS).map(function(k){
        const have = gl.some(function(g){ return g.preset===k; });
        return '<button class="restaurant-chip" onclick="RMENU.openGroupForm(null,\''+k+'\')">'+(have?'✓ ':'＋ ')+esc(PRESETS[k].label)+'</button>'; }).join('')+'</div>';
    h += '<button class="btn primary" style="margin:6px 0 12px;" onclick="RMENU.openGroupForm(null,null)">➕ New Custom Group</button>';
    if (!gl.length) return h + '<div class="empty">No customization groups yet.</div>';
    return h + gl.map(function(g){
      const opts = rsmOptions(g);
      return '<div class="restaurant-menu-card" style="display:block;"><div class="restaurant-menu-name">'+esc(g.name)+'</div>'+
        '<div class="restaurant-menu-meta"><span class="restaurant-badge">'+(g.type==="multi"?"Multi select":"Single select")+'</span>'+(g.required?'<span class="restaurant-badge req">Required</span>':'<span class="restaurant-badge">Optional</span>')+
        opts.length+' options · '+usedCount(g.id)+' items use this</div>'+
        '<div class="restaurant-menu-meta">'+esc(opts.map(function(o){ return o.name+(o.price?(' +₹'+o.price):''); }).join(", "))+'</div>'+
        '<div class="restaurant-menu-actions"><button class="icon-mini-btn" onclick="RMENU.openGroupForm(\''+g.id+'\',null)">✏️ Edit</button>'+
        '<button class="icon-mini-btn" onclick="RMENU.openGroupItems(\''+g.id+'\')">🍽️ Choose items</button>'+
        '<button class="icon-mini-btn danger" onclick="RMENU.deleteGroup(\''+g.id+'\')">🗑️</button></div></div>';
    }).join('');
  }
  function openGroupForm(gid, preset){
    const g = gid ? rs.groups[gid] : null, pr = preset ? PRESETS[preset] : null;
    M.gform = {id:gid||null, preset:g?(g.preset||""):(preset||""), name:g?g.name:(pr?pr.label:""), type:g?(g.type==="multi"?"multi":"single"):(pr?pr.type:"single"),
      required:g?!!g.required:false, max:g?(parseInt(g.max,10)||0):0,
      options:g ? rsmOptions(g).map(function(o){ return {id:o.id,name:o.name,price:o.price,available:o.available}; })
        : (pr ? pr.opts.map(function(n){ return {id:"O"+uid(),name:n,price:0,available:true}; }) : [{id:"O"+uid(),name:"",price:0,available:true}])};
    openScreen({type:"rsMenuGroup"});
  }
  function collectGroup(){
    const G = M.gform; if (!G) return;
    const v = function(id){ const e = document.getElementById(id); return e ? e.value : null; };
    if (v("rm_g_name")!==null) G.name = v("rm_g_name");
    const rq = document.getElementById("rm_g_req"); if (rq) G.required = rq.checked;
    if (v("rm_g_max")!==null) G.max = v("rm_g_max");
    G.options.forEach(function(o,i){
      const n = v("rm_o_n"+i), p = v("rm_o_p"+i), a = document.getElementById("rm_o_a"+i);
      if (n!==null) o.name = n; if (p!==null) o.price = p; if (a) o.available = a.checked;
    });
  }
  function setG(k,val){ collectGroup(); M.gform[k] = val; render(); }
  function addOpt(){ collectGroup(); M.gform.options.push({id:"O"+uid(),name:"",price:0,available:true}); render(); }
  function delOpt(i){ collectGroup(); M.gform.options.splice(i,1); render(); }
  function moveOpt(i,d){ collectGroup(); const o = M.gform.options, j = i+d; if (j<0||j>=o.length) return; const t = o[i]; o[i] = o[j]; o[j] = t; render(); }
  function renderGroupForm(){
    const G = M.gform;
    if (!G) return header("Customization",{onBack:"openScreen({type:'rsMenu'})"})+'<div class="content"><div class="empty">—</div></div>';
    let h = header(G.id?"Group Edit":"Customization Group", {onBack:"RMENU.backFromGroup()"});
    h += '<div class="content restaurant-screen">'+field("Group Name * (e.g. Spice Level, Extra Toppings)","text","rm_g_name",G.name);
    h += '<label class="field-label">Selection</label>'+'<div class="restaurant-seg"><button type="button" class="'+(G.type==="single"?'active':'')+'" onclick="RMENU.setG(\'type\',\'single\')">⚪ Single (choose 1)</button><button type="button" class="'+(G.type==="multi"?'active':'')+'" onclick="RMENU.setG(\'type\',\'multi\')">☑️ Multi (choose several)</button></div>';
    h += '<div class="card" style="margin-bottom:12px;padding:4px 14px;"><label class="restaurant-row" style="border-bottom:none;"><span>Required (customer must choose)</span><input type="checkbox" id="rm_g_req"'+(G.required?' checked':'')+'></label></div>';
    if (G.type==="multi") h += field("Max selections (0 = no limit)","number","rm_g_max",G.max);
    h += '<div class="section-title">Options (name · extra price ₹ · available)</div>';
    h += G.options.map(function(o,i){
      return '<div class="restaurant-optrow"><input type="text" id="rm_o_n'+i+'" placeholder="Option name" maxlength="40" value="'+esc(o.name)+'">'+
        '<input type="number" id="rm_o_p'+i+'" placeholder="₹0" value="'+esc(o.price)+'"><input type="checkbox" id="rm_o_a'+i+'"'+(o.available?' checked':'')+' title="Available">'+
        '<span style="display:flex;gap:4px;"><button onclick="RMENU.moveOpt('+i+',-1)">⬆</button><button onclick="RMENU.moveOpt('+i+',1)">⬇</button><button onclick="RMENU.delOpt('+i+')">🗑</button></span></div>'; }).join('');
    h += '<button class="btn" style="background:#f1f5f9;color:#334155;margin-bottom:12px;" onclick="RMENU.addOpt()">➕ Add option</button>';
    h += '<button class="btn primary" id="rm_gSaveBtn" onclick="RMENU.saveGroup()">💾 Save</button></div>';
    return h;
  }
  function backFromGroup(){ M.gform = null; M.tab = "custom"; openScreen({type:"rsMenu"}); }
  async function saveGroup(){
    collectGroup();
    const G = M.gform; if (!G) return;
    const name = String(G.name||"").trim();
    if (!name){ say("Enter a group name", true); return; }
    if (name.length>40){ say("Name can be up to 40 characters", true); return; }
    if (groupList().some(function(g){ return g.id!==G.id && String(g.name).trim().toLowerCase()===name.toLowerCase(); })){ say("A group with this name already exists", true); return; }
    const opts = G.options.map(function(o){ return {id:o.id, name:String(o.name||"").trim(), price:o.price===""?0:Number(o.price), available:!!o.available}; });
    if (!opts.length){ say("Add at least 1 option", true); return; }
    for (let i=0;i<opts.length;i++){
      if (!opts[i].name){ say("Enter a name for option "+(i+1), true); return; }
      if (!isFinite(opts[i].price) || opts[i].price<0 || opts[i].price>10000){ say("Option extra price must be between 0 and 10,000", true); return; }
      for (let j=0;j<i;j++) if (opts[j].name.toLowerCase()===opts[i].name.toLowerCase()){ say("Duplicate option name: "+opts[i].name, true); return; }
    }
    let max = parseInt(G.max,10); if (!isFinite(max) || max<0) max = 0; if (G.type==="single") max = 0; if (max>opts.length) max = opts.length;
    const id = G.id || ("G"+uid()), old = rs.groups[id];
    const g = {name:name, type:G.type, required:!!G.required, max:max, preset:G.preset||"", order:old?(Number(old.order)||0):groupList().length, active:true, options:{}};
    opts.forEach(function(o,i){ g.options[o.id] = {name:o.name, price:o.price, available:o.available, order:i}; });
    rs.groups[id] = g; saveBase();
    M.gform = null; M.tab = "custom"; openScreen({type:"rsMenu"});
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/customGroups/"+id).set(g));
    const b = await RESTO.fbw(fbdb.ref("shopPublic/"+sid()+"/customGroups/"+id).set(pubGroup(g)));
    if (!(a.ok && b.ok)) say("Save failed — check permissions / internet", true); else say("Customization saved");
  }
  async function deleteGroup(id){
    const g = rs.groups[id]; if (!g) return;
    const items = menuProducts().filter(function(p){ return rsmIds(rs.menu[p.id].groupIds).indexOf(id)!==-1; });
    if (!confirm('Delete "'+g.name+'"?'+(items.length?(' It will also be removed from '+items.length+' items.'):''))) return;
    delete rs.groups[id];
    const upd = {};
    items.forEach(function(p){ rs.menu[p.id].groupIds = rsmIds(rs.menu[p.id].groupIds).filter(function(x){ return x!==id; }); upd[p.id] = privMenuNode(p.id); });
    saveBase(); render();
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/customGroups/"+id).remove());
    const b = await RESTO.fbw(fbdb.ref("shopPublic/"+sid()+"/customGroups/"+id).remove());
    let ok = a.ok && b.ok;
    if (items.length){ const r = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/menu").update(upd)); const r2 = await syncPublic(false); ok = ok && r.ok && r2.ok; }
    if (!ok) say("Delete failed — check permissions / internet", true);
  }
  function openGroupItems(gid){
    const g = rs.groups[gid]; if (!g) return;
    const list = menuProducts().sort(function(a,b){ return String(a.name).localeCompare(String(b.name)); });
    RESTO.modalShow(RESTO.sheet('<div class="modal-title">🍽️ '+esc(g.name)+' — apply to which items?</div>'+
      (list.length ? list.map(function(p){
        return '<label class="restaurant-row"><span>'+vegBadge(rs.menu[p.id].foodType)+' '+esc(p.name)+'</span><input type="checkbox" data-rmgi="'+p.id+'"'+(rsmIds(rs.menu[p.id].groupIds).indexOf(gid)!==-1?' checked':'')+'></label>'; }).join('')
        : '<div class="empty">There are no items on the menu yet.</div>')+
      '<button class="btn primary" style="margin:12px 0 8px;" onclick="RMENU.saveGroupItems(\''+gid+'\')">Save</button>'+
      '<button class="btn" style="background:var(--border);color:var(--text);" onclick="RESTO.modalClose()">Close</button>'));
  }
  async function saveGroupItems(gid){
    const upd = {};
    document.querySelectorAll("[data-rmgi]").forEach(function(b){
      const pid = b.getAttribute("data-rmgi"), m = rs.menu[pid]; if (!m) return;
      const cur = rsmIds(m.groupIds), has = cur.indexOf(gid)!==-1;
      if (b.checked && !has){ m.groupIds = cur.concat([gid]); upd[pid] = true; }
      else if (!b.checked && has){ m.groupIds = cur.filter(function(x){ return x!==gid; }); upd[pid] = true; }
    });
    const ids = Object.keys(upd);
    saveBase(); RESTO.modalClose(); render();
    if (!ids.length) return;
    const priv = {}; ids.forEach(function(pid){ priv[pid] = privMenuNode(pid); });
    const a = await RESTO.fbw(fbdb.ref("shops/"+sid()+"/restaurant/menu").update(priv));
    const b = await syncPublic(false);
    say((a.ok && b.ok) ? (ids.length+" items updated") : "Save failed — check permissions / internet", !(a.ok && b.ok));
  }

  /* =============== Customer side (Phase 5): menu, customize, cart — NO order submit yet =============== */
  const CM = {active:false, shopId:null, settings:{}, menu:{}, cats:{}, groups:{}, cat:"all", q:"", vegOnly:false, lines:[], note:"", D:null, back:null};
  function cartKey(){ return "mdRCart:"+CM.shopId; }
  function saveCart(){ try{ localStorage.setItem(cartKey(), JSON.stringify({lines:CM.lines, note:CM.note})); }catch(e){} }
  function loadCart(){
    CM.lines = []; CM.note = "";
    try{
      const o = JSON.parse(localStorage.getItem(cartKey())||"null");
      if (o && Array.isArray(o.lines)) o.lines.slice(0,60).forEach(function(l){
        if (!l || !RS_SAFE_ID.test(String(l.itemId||""))) return;
        const sel = {}; if (l.sel && typeof l.sel==="object") Object.keys(l.sel).forEach(function(g){ if (RS_SAFE_ID.test(g)) sel[g] = rsmIds(l.sel[g]); });
        CM.lines.push({key:"L"+uid(), itemId:l.itemId, qty:Math.min(50,Math.max(1,parseInt(l.qty,10)||1)), sel:sel, note:String(l.note||"").slice(0,200)});
      });
      if (o && typeof o.note==="string") CM.note = o.note.slice(0,300);
    }catch(e){}
  }
  /* Everything below treats data read from Firebase as untrusted-shaped: keep only known fields/types. */
  function cleanPack(p){
    const menu = {}, cats = {}, groups = {};
    Object.keys(p.menu||{}).forEach(function(k){
      const m = p.menu[k]; if (!RS_SAFE_ID.test(k) || !m || typeof m!=="object" || typeof m.name!=="string") return;
      menu[k] = {name:m.name.slice(0,120), price:Math.max(0,Number(m.price)||0), mrp:Math.max(0,Number(m.mrp)||0), photo:(typeof m.photo==="string" && /^https:\/\//.test(m.photo))?m.photo:"",
        description:String(m.description||"").slice(0,300), categoryId:RS_SAFE_ID.test(String(m.categoryId||""))?String(m.categoryId):"", foodType:foodOf(m.foodType), available:m.available!==false,
        prepTime:Math.max(0,Number(m.prepTime)||0), popular:!!m.popular, spicy:Math.min(3,Math.max(0,parseInt(m.spicy,10)||0)), station:STATIONS[m.station]?m.station:"kitchen", groupIds:rsmIds(m.groupIds)};
    });
    Object.keys(p.cats||{}).forEach(function(k){ const c = p.cats[k]; if (RS_SAFE_ID.test(k) && c && typeof c.name==="string" && c.active!==false) cats[k] = {name:c.name.slice(0,60), order:Number(c.order)||0}; });
    Object.keys(p.groups||{}).forEach(function(k){
      const g = p.groups[k]; if (!RS_SAFE_ID.test(k) || !g || typeof g.name!=="string") return;
      const opts = {}; rsmOptions(g).forEach(function(o,i){ opts[o.id] = {name:o.name.slice(0,60), price:o.price, available:o.available, order:i}; });
      groups[k] = {name:g.name.slice(0,60), type:g.type==="multi"?"multi":"single", required:!!g.required, max:parseInt(g.max,10)||0, order:Number(g.order)||0, active:g.active!==false, options:opts};
    });
    const s = p.settings||{};
    const settings = {open:s.open!==false, hideMenuWhenClosed:!!s.hideMenuWhenClosed, openTime:String(s.openTime||"").slice(0,5), closeTime:String(s.closeTime||"").slice(0,5), name:String(s.name||"").slice(0,80),
      taxEnabled:!!s.taxEnabled, taxPct:Number(s.taxPct)||0, serviceEnabled:!!s.serviceEnabled, servicePct:Number(s.servicePct)||0};
    return {biz:RESTO.normalize(p.biz), settings:settings, menu:menu, cats:cats, groups:groups};
  }
  async function loadCustomer(shopId){
    CM.active = false;
    if (!RS_SAFE_ID.test(String(shopId||""))) return;      /* never put raw URL text into a DB path */
    CM.shopId = shopId;
    const rd = function(p){ return withFbTimeout(fbdb.ref("shopPublic/"+shopId+"/"+p).once("value")); };
    let pack = null;
    try{
      const r = await Promise.all([rd("businessType"), rd("restaurant"), rd("menu"), rd("menuCategories"), rd("customGroups")]);
      if (r[0].__timedOut){ pack = JSON.parse(localStorage.getItem("mdRMenu:"+shopId)||"null"); }
      else {
        pack = {biz:r[0].val()||"general", settings:r[1].val()||{}, menu:r[2].val()||{}, cats:r[3].val()||{}, groups:r[4].val()||{}};
        try{ localStorage.setItem("mdRMenu:"+shopId, JSON.stringify(pack)); }catch(e){}
      }
    }catch(e){}
    if (!pack) return;
    const c = cleanPack(pack);
    CM.settings = c.settings; CM.menu = c.menu; CM.cats = c.cats; CM.groups = c.groups;
    CM.active = (c.biz==="restaurant" || c.biz==="hotel_restaurant");
    if (CM.active) loadCart();
  }
  function customerActive(){ return CM.active && CM.shopId===CATALOG_SHOP_ID; }
  function isClosed(){ return CM.settings.open===false; }
  function totals(lines){ return calculateRestaurantOrderTotals(lines, CM.menu, CM.groups, CM.settings); }
  function itemGroups(it){ return rsmIds(it.groupIds).filter(function(g){ return CM.groups[g] && CM.groups[g].active!==false && rsmOptions(CM.groups[g]).length; }); }
  function sortedCats(){ return Object.keys(CM.cats).map(function(k){ return Object.assign({id:k}, CM.cats[k]); }).sort(numOrder); }
  function itemQty(pid){ return CM.lines.reduce(function(n,l){ return l.itemId===pid ? n+l.qty : n; }, 0); }
  function sameLine(a,b){ return a.itemId===b.itemId && (a.note||"")===(b.note||"") && JSON.stringify(normSel(a.sel))===JSON.stringify(normSel(b.sel)); }
  function normSel(sel){ const o = {}; Object.keys(sel||{}).sort().forEach(function(g){ const a = rsmIds(sel[g]).slice().sort(); if (a.length) o[g] = a; }); return o; }

  function renderCustomer(){
    const st = CM.settings;
    let h = '<div class="catalog-header"><div class="catalog-shopname">'+esc(st.name||CATALOG_DATA.shopName||"Restaurant")+'</div><div class="catalog-sub">🍽️ Menu</div>'+RESTO.customerChipHtml()+'</div>';
    if (isClosed() && st.hideMenuWhenClosed) return h + '<div class="empty" style="padding:50px 20px;">🔴 The restaurant is closed right now.'+(st.openTime?('<br>Opens at: '+esc(st.openTime)):'')+'</div>';
    if (isClosed()) h += '<div class="restaurant-closed">🔴 The restaurant is closed — orders are not being accepted'+(st.openTime?(' (opens at '+esc(st.openTime)+')'):'')+'</div>';
    if (!Object.keys(CM.menu).length) return h + '<div class="empty" style="padding:50px 20px;">The menu is not ready yet.</div>';
    h += '<div class="restaurant-sticky"><div class="search"><span>🔍</span><input type="text" id="rcSearch" placeholder="Search dishes…" value="'+esc(CM.q)+'" oninput="RMENU.cSearch(this.value)"></div>'+
      '<div class="restaurant-chips" id="rcChips">'+chipsHtml()+'</div></div>';
    h += '<div class="content" style="padding-bottom:90px;" id="rcList">'+listHtml()+'</div>';
    h += '<div class="restaurant-cartbar" id="rcBar">'+barHtml()+'</div>';
    return h;
  }
  function chipsHtml(){
    const used = {}, any = {pop:false, none:false};
    Object.keys(CM.menu).forEach(function(k){ const m = CM.menu[k]; if (m.popular) any.pop = true; if (CM.cats[m.categoryId]) used[m.categoryId] = true; else any.none = true; });
    const chips = [["all","All"]];
    if (any.pop) chips.push(["pop","⭐ Popular"]);
    sortedCats().forEach(function(c){ if (used[c.id]) chips.push([c.id, c.name]); });
    if (any.none && sortedCats().length) chips.push(["none","Other"]);
    return '<button class="restaurant-chip'+(CM.vegOnly?' active':'')+'" onclick="RMENU.cVeg()">🟢 Veg only</button>'+
      chips.map(function(c){ return '<button class="restaurant-chip'+(CM.cat===c[0]?' active':'')+'" onclick="RMENU.cCat(\''+c[0]+'\')">'+esc(c[1])+'</button>'; }).join('');
  }
  function visibleItems(){
    const q = CM.q.trim().toLowerCase();
    return Object.keys(CM.menu).map(function(k){ return Object.assign({id:k}, CM.menu[k]); }).filter(function(m){
      if (CM.vegOnly && m.foodType!=="veg") return false;
      if (CM.cat==="pop" && !m.popular) return false;
      if (CM.cat==="none" ? CM.cats[m.categoryId] : (CM.cat!=="all" && CM.cat!=="pop" && m.categoryId!==CM.cat)) return false;
      return !q || m.name.toLowerCase().indexOf(q)!==-1 || m.description.toLowerCase().indexOf(q)!==-1;
    }).sort(function(a,b){ return (a.available===b.available ? 0 : (a.available?-1:1)) || a.name.localeCompare(b.name); });
  }
  function listHtml(){
    const items = visibleItems();
    if (!items.length) return '<div class="empty">No dishes found</div>';
    const sections = [];
    sortedCats().forEach(function(c){ sections.push({title:c.name, items:items.filter(function(m){ return m.categoryId===c.id; })}); });
    sections.push({title:sortedCats().length?"Other":"", items:items.filter(function(m){ return !CM.cats[m.categoryId]; })});
    return sections.filter(function(s){ return s.items.length; }).map(function(s){
      return (s.title?'<div class="restaurant-sec">'+esc(s.title)+'</div>':'')+s.items.map(cardHtml).join(''); }).join('');
  }
  function cardHtml(m){
    const off = !m.available || isClosed(), has = itemGroups(m).length>0, n = itemQty(m.id), plain = !has && CM.lines.find(function(l){ return l.itemId===m.id && !(l.note) && !Object.keys(normSel(l.sel)).length; });
    let act;
    if (!m.available) act = '<button class="restaurant-add" disabled>Currently Unavailable</button>';
    else if (isClosed()) act = '<button class="restaurant-add" disabled>Restaurant closed</button>';
    else if (has) act = '<button class="restaurant-add" onclick="RMENU.cOpen(\''+m.id+'\')">'+(n?('Customize + ('+n+')'):'ADD +')+'</button>';
    else if (plain) act = '<span class="restaurant-step"><button onclick="RMENU.cQty(\''+plain.key+'\',-1)">−</button><span>'+plain.qty+'</span><button onclick="RMENU.cQty(\''+plain.key+'\',1)">+</button></span>';
    else act = '<button class="restaurant-add" onclick="RMENU.cQuick(\''+m.id+'\')">ADD +</button>';
    return '<div class="restaurant-cust-card'+((!m.available)?' off':'')+'" data-item="'+m.id+'"><div class="restaurant-cust-img">'+(m.photo?'<img loading="lazy" src="'+esc(m.photo)+'" alt="" onerror="this.style.display=\'none\'">':'🍽️')+'</div>'+
      '<div style="flex:1;min-width:0;"><div class="restaurant-menu-name">'+vegBadge(m.foodType)+'<span>'+esc(m.name)+'</span></div>'+
      '<div class="restaurant-menu-meta">'+(m.popular?'⭐ Popular ':'')+(m.spicy?esc(SPICY[m.spicy])+' ':'')+(m.prepTime?'⏱ '+m.prepTime+' min':'')+'</div>'+
      (m.description?'<div class="restaurant-desc">'+esc(m.description)+'</div>':'')+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;"><div><span class="restaurant-price">'+fmt(m.price)+'</span>'+(m.mrp>m.price?'<span class="restaurant-mrp">'+fmt(m.mrp)+'</span>':'')+'</div>'+act+'</div></div></div>';
  }
  function barHtml(){
    if (!CM.lines.length) return '';
    const T = totals(CM.lines);
    return '<button onclick="RMENU.cCart()"><span>🛒 '+T.itemCount+' item'+(T.itemCount>1?'s':'')+'</span><span>'+fmt(T.subtotal)+' · View Cart ›</span></button>';
  }
  function refresh(){
    const l = document.getElementById("rcList"); if (l) l.innerHTML = listHtml();
    const b = document.getElementById("rcBar"); if (b) b.innerHTML = barHtml();
    const c = document.getElementById("rcChips"); if (c) c.innerHTML = chipsHtml();
  }
  function cSearch(v){ CM.q = v; const l = document.getElementById("rcList"); if (l) l.innerHTML = listHtml(); }
  function cCat(c){ CM.cat = c; refresh(); }
  function cVeg(){ CM.vegOnly = !CM.vegOnly; refresh(); }

  /* ---- sheets (own host, so toast() never closes them) ---- */
  function host(){ let h = document.getElementById("restoSheetHost"); if (!h){ h = document.createElement("div"); h.id = "restoSheetHost"; document.body.appendChild(h); } return h; }
  function showSheet(inner){ host().innerHTML = '<div class="restaurant-sheet-ov" onclick="RMENU.cClose(event)"><div class="restaurant-sheet" onclick="event.stopPropagation()">'+inner+'</div></div>'; }
  function cClose(ev){ if (ev && ev.target!==ev.currentTarget && !(ev.currentTarget && ev.currentTarget.classList && ev.currentTarget.classList.contains("x"))) return; host().innerHTML = ""; CM.D = null; CM.back = null; refresh(); }
  function closeSheetNow(){ host().innerHTML = ""; CM.D = null; CM.back = null; refresh(); }
  function cQuick(pid){
    const m = CM.menu[pid]; if (!m || !m.available || isClosed()) return;
    CM.lines.push({key:"L"+uid(), itemId:pid, qty:1, sel:{}, note:""}); saveCart(); refresh();
  }
  function cQty(key, d){
    const i = CM.lines.findIndex(function(l){ return l.key===key; }); if (i<0) return;
    const q = CM.lines[i].qty + d;
    if (q<1) CM.lines.splice(i,1); else CM.lines[i].qty = Math.min(50,q);
    saveCart(); refresh(); if (host().firstChild && !CM.D) renderCart();
  }
  function cRemove(key){ CM.lines = CM.lines.filter(function(l){ return l.key!==key; }); saveCart(); refresh(); if (!CM.lines.length) closeSheetNow(); else renderCart(); }
  function cOpen(pid, key){
    const m = CM.menu[pid]; if (!m) return;
    const ex = key ? CM.lines.find(function(l){ return l.key===key; }) : null;
    CM.D = ex ? {itemId:pid, key:key, qty:ex.qty, sel:JSON.parse(JSON.stringify(ex.sel||{})), note:ex.note||""} : {itemId:pid, key:null, qty:1, sel:{}, note:""};
    CM.back = key ? "cart" : null;
    renderSheet();
  }
  function renderSheet(){
    const D = CM.D; if (!D) return;
    const m = CM.menu[D.itemId]; if (!m) return;
    const prev = document.getElementById("rcSheetBody"), top = prev ? prev.scrollTop : 0;
    const T = totals([D]), L = T.lines[0];
    let body = (m.description?'<div class="restaurant-desc" style="-webkit-line-clamp:unset;">'+esc(m.description)+'</div>':'');
    itemGroups(m).forEach(function(gid){
      const g = CM.groups[gid], single = g.type!=="multi", chosen = rsmIds(D.sel[gid]);
      body += '<div class="restaurant-opt-title">'+esc(g.name)+' '+(g.required?'<span class="restaurant-badge req">Required</span>':'<span class="restaurant-badge">Optional</span>')+'</div>'+
        '<div class="tiny muted">'+(single?'Choose 1':(g.max>0?('Choose up to '+g.max):'Choose any'))+'</div>';
      rsmOptions(g).forEach(function(o){
        const on = chosen.indexOf(o.id)!==-1;
        body += '<button class="restaurant-opt'+(on?' on':'')+'" '+(o.available?'':'disabled')+' onclick="RMENU.cPick(\''+gid+'\',\''+o.id+'\')"><span>'+(single?(on?'◉':'○'):(on?'☑':'☐'))+' '+esc(o.name)+(o.available?'':' (Unavailable)')+'</span><span>'+(o.price?'+'+fmt(o.price):'')+'</span></button>';
      });
    });
    body += '<div class="field" style="margin-top:14px;"><label class="field-label">📝 Special instruction (optional)</label><textarea id="rcNote" rows="2" maxlength="200" placeholder="e.g. no onions, make it quick" oninput="RMENU.cNote(this.value)">'+esc(D.note)+'</textarea></div>';
    const bad = L.errors[0] || (isClosed()?"Restaurant closed":"");
    showSheet('<div class="restaurant-sheet-head">'+vegBadge(m.foodType)+'<span>'+esc(m.name)+'</span><button class="x" onclick="RMENU.cClose(event)">✕</button></div>'+
      '<div class="restaurant-sheet-body" id="rcSheetBody">'+body+'</div>'+
      '<div class="restaurant-sheet-foot"><span class="restaurant-step"><button onclick="RMENU.cDq(-1)">−</button><span id="rcDq">'+D.qty+'</span><button onclick="RMENU.cDq(1)">+</button></span>'+
      '<button class="btn primary" id="rcAddBtn" '+(bad?'disabled':'')+' onclick="RMENU.cSave()">'+(bad?esc(bad):((D.key?'Update':'Add to cart')+' · '+fmt(L.lineTotal)))+'</button></div>');
    const nb = document.getElementById("rcSheetBody"); if (nb) nb.scrollTop = top;
  }
  function cPick(gid, oid){
    const D = CM.D, g = CM.groups[gid]; if (!D || !g) return;
    let cur = rsmIds(D.sel[gid]);
    if (g.type!=="multi"){ cur = (cur[0]===oid && !g.required) ? [] : [oid]; }
    else if (cur.indexOf(oid)!==-1) cur = cur.filter(function(x){ return x!==oid; });
    else { if (g.max>0 && cur.length>=g.max){ toast("You can choose at most "+g.max); return; } cur = cur.concat([oid]); }
    D.sel[gid] = cur; renderSheet();
  }
  function cNote(v){ if (CM.D) CM.D.note = v.slice(0,200); }
  function cDq(d){ if (!CM.D) return; CM.D.qty = Math.min(50, Math.max(1, CM.D.qty+d)); renderSheet(); }
  function cSave(){
    const D = CM.D; if (!D) return;
    const T = totals([D]); if (!T.valid) return;
    const nl = {key:D.key||("L"+uid()), itemId:D.itemId, qty:D.qty, sel:normSel(D.sel), note:String(D.note||"").trim()};
    if (D.key){ const i = CM.lines.findIndex(function(l){ return l.key===D.key; }); if (i>=0) CM.lines[i] = nl; else CM.lines.push(nl); }
    else {
      const same = CM.lines.find(function(l){ return sameLine(l, nl); });
      if (same) same.qty = Math.min(50, same.qty+nl.qty); else CM.lines.push(nl);
    }
    saveCart();
    const back = CM.back; CM.D = null;
    if (back==="cart") { refresh(); renderCart(); } else { closeSheetNow(); toast("Added to cart"); }
  }
  function cCart(){ renderCart(); }
  function optText(L){ return L.options.map(function(o){ return o.optionName+(o.price?(' (+'+fmt(o.price)+')'):''); }).join(", "); }
  function renderCart(){
    CM.D = null;
    const T = totals(CM.lines);
    const prev = document.getElementById("rcSheetBody"), top = prev ? prev.scrollTop : 0;
    let body = T.lines.map(function(L, i){
      const ln = CM.lines[i], has = CM.menu[L.itemId] && itemGroups(CM.menu[L.itemId]).length>0;
      return '<div class="restaurant-line" data-line="'+ln.key+'"><div style="display:flex;justify-content:space-between;gap:8px;"><div class="restaurant-menu-name">'+vegBadge(L.foodType)+'<span>'+esc(L.name||"Item")+'</span></div><b>'+fmt(L.lineTotal)+'</b></div>'+
        (L.options.length?'<div class="restaurant-menu-meta">'+esc(optText(L))+'</div>':'')+(L.note?'<div class="restaurant-menu-meta">📝 '+esc(L.note)+'</div>':'')+
        L.errors.map(function(e){ return '<div class="restaurant-err">⚠️ '+esc(e)+'</div>'; }).join('')+
        '<div class="restaurant-menu-actions"><span class="restaurant-step"><button onclick="RMENU.cQty(\''+ln.key+'\',-1)">−</button><span>'+L.qty+'</span><button onclick="RMENU.cQty(\''+ln.key+'\',1)">+</button></span>'+
        ((has||L.note)&&CM.menu[L.itemId]?'<button class="icon-mini-btn" onclick="RMENU.cOpen(\''+L.itemId+'\',\''+ln.key+'\')">✏️ Edit</button>':'')+
        '<button class="icon-mini-btn danger" onclick="RMENU.cRemove(\''+ln.key+'\')">🗑️ Remove</button></div></div>';
    }).join('');
    body += '<div class="field" style="margin-top:14px;"><label class="field-label">📝 Instructions for the whole order (optional)</label><textarea id="rcOrderNote" rows="2" maxlength="300" oninput="RMENU.cOrderNote(this.value)">'+esc(CM.note)+'</textarea></div>';
    body += '<div class="restaurant-totals"><div><span>Subtotal</span><span>'+fmt(T.subtotal)+'</span></div>'+
      (T.servicePct>0?'<div><span>Service Charge ('+T.servicePct+'%)</span><span>'+fmt(T.service)+'</span></div>':'')+
      (T.taxPct>0?'<div><span>GST ('+T.taxPct+'%)</span><span>'+fmt(T.tax)+'</span></div>':'')+
      '<div class="grand"><span>Total</span><span>'+fmt(T.total)+'</span></div></div>';
    showSheet('<div class="restaurant-sheet-head">🛒 Your Order<button class="x" onclick="RMENU.cClose(event)">✕</button></div>'+
      '<div class="restaurant-sheet-body" id="rcSheetBody">'+body+'</div>'+
      '<div class="restaurant-sheet-foot" style="flex-direction:column;align-items:stretch;"><button class="btn primary" disabled id="rcConfirm">Placing orders is coming soon</button>'+
      '<div class="tiny muted" style="text-align:center;">For now this is only the menu and cart. Order confirmation arrives in the next update.'+(T.valid?'':' · Please fix the items in your cart.')+'</div></div>');
    const nb = document.getElementById("rcSheetBody"); if (nb) nb.scrollTop = top;
  }
  function cOrderNote(v){ CM.note = v.slice(0,300); saveCart(); }

  return {renderScreen:renderScreen, onProductsChanged:onProductsChanged, setTab:setTab, setQ:setQ, setCat:setCat, toggleAvail:toggleAvail, removeFromMenu:removeFromMenu, openAddExisting:openAddExisting,
    openCatForm:openCatForm, saveCat:saveCat, addCommonCats:addCommonCats, moveCat:moveCat, deleteCat:deleteCat,
    openItemForm:openItemForm, setF:setF, onPhoto:onPhoto, removePhoto:removePhoto, saveItem:saveItem, backFromForm:backFromForm,
    openGroupForm:openGroupForm, setG:setG, addOpt:addOpt, delOpt:delOpt, moveOpt:moveOpt, saveGroup:saveGroup, backFromGroup:backFromGroup, deleteGroup:deleteGroup, openGroupItems:openGroupItems, saveGroupItems:saveGroupItems,
    loadCustomer:loadCustomer, customerActive:customerActive, renderCustomer:renderCustomer,
    cSearch:cSearch, cCat:cCat, cVeg:cVeg, cQuick:cQuick, cQty:cQty, cRemove:cRemove, cOpen:cOpen, cPick:cPick, cNote:cNote, cDq:cDq, cSave:cSave, cCart:cCart, cClose:cClose, cOrderNote:cOrderNote,
    _M:M, _CM:CM, _syncPublic:syncPublic};
})();
