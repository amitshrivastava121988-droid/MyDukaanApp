/* MyDukaan App — delivery.js
   Local Delivery Network: DN (settings) + DNP (provider) + DNS (shop side). Optional module.
   Classic <script> file: shares globals (STATE, persist, fbdb, esc, toast ...) with the other files. */

/* =====================================================================
   MyDukaan LOCAL DELIVERY NETWORK — Stage 1 (settings, flags, legal, OTP stub)
   Self-contained module. To disable: Admin -> Delivery Network -> master switch OFF
   (data is kept). To remove: delete this block + the lines marked DN-HOOK.
   Wording: MyDukaan = technology platform; providers = independent providers.
===================================================================== */
const DN = (function(){
  const DEFAULTS = {
    flags:{ deliveryNetworkEnabled:false, providerRegistrationEnabled:false, shopDeliveryEnabled:false,
            providerSubscriptionEnabled:false, deliveryOTPEnabled:true, deliveryRatingEnabled:true },
    deliveryNetworkShopMonthlyFee:99,
    deliveryNetworkProviderMonthlyFee:99,
    subscriptionDurationDays:30,
    trialDays:0,
    providerVerificationRequired:true,
    maxSearchRadiusKm:5,
    roadDistanceFactor:1.3,
    otpChannel:"inapp",                 // "inapp" | "sms" | "whatsapp" (sms/whatsapp = future)
    offerExpiryMinutes:10,
    allowShopCancelBeforePickup:true,
    requireCancelReason:true,
    slabs:[{upToKm:2,amount:20},{upToKm:3,amount:25},{upToKm:5,amount:35},{upToKm:7,amount:45}]
  };
  const FLAG_LABELS = {
    deliveryNetworkEnabled:"Delivery Network (master switch)",
    providerRegistrationEnabled:"Provider registration",
    shopDeliveryEnabled:"Shop Local Delivery",
    providerSubscriptionEnabled:"Provider subscription",
    deliveryOTPEnabled:"Pickup / Delivery OTP",
    deliveryRatingEnabled:"Ratings"
  };
  const LEGAL_DOCS = [
    ["shopTerms","Shop Terms"],["providerTerms","Independent Delivery Provider Terms"],
    ["customerTerms","Customer Terms"],["privacy","Privacy Policy"],
    ["cancellation","Cancellation Policy"],["dispute","Dispute Policy"]
  ];
  const clone = function(o){ return JSON.parse(JSON.stringify(o)); };
  let S = clone(DEFAULTS);

  function merge(remote){
    const out = clone(DEFAULTS);
    if (!remote || typeof remote!=="object") return out;
    Object.keys(out.flags).forEach(function(k){
      if (remote.flags && typeof remote.flags[k]==="boolean") out.flags[k] = remote.flags[k];
    });
    ["deliveryNetworkShopMonthlyFee","deliveryNetworkProviderMonthlyFee","subscriptionDurationDays","trialDays","maxSearchRadiusKm","offerExpiryMinutes","roadDistanceFactor"].forEach(function(k){
      const v = Number(remote[k]); if (remote[k]!=null && isFinite(v) && v>=0) out[k] = v;
    });
    ["providerVerificationRequired","allowShopCancelBeforePickup","requireCancelReason"].forEach(function(k){
      if (typeof remote[k]==="boolean") out[k] = remote[k];
    });
    if (["inapp","sms","whatsapp"].indexOf(remote.otpChannel)!==-1) out.otpChannel = remote.otpChannel;
    if (remote.slabs){
      const arr = Array.isArray(remote.slabs) ? remote.slabs : Object.keys(remote.slabs).map(function(k){ return remote.slabs[k]; });
      const clean = arr.filter(function(s){ return s && isFinite(Number(s.upToKm)) && isFinite(Number(s.amount)); })
                       .map(function(s){ return {upToKm:Number(s.upToKm), amount:Number(s.amount)}; });
      if (clean.length) out.slabs = clean;
    }
    return out;
  }

  async function loadSettings(){
    try{
      const snap = await withFbTimeout(fbdb.ref("deliveryNetwork/settings").once("value"));
      if (snap && snap.__timedOut) return S;
      S = merge(snap.val());
      if (typeof ROUTE!=="undefined" && ROUTE==="app" && TAB==="more" && !SCREEN) render();
    }catch(e){ /* rules not published yet or offline -> defaults (feature stays OFF) */ }
    return S;
  }
  function settings(){ return S; }
  function isOn(flag){ return !!(S.flags.deliveryNetworkEnabled && S.flags[flag]); }
  function shopTileVisible(){ return isOn("shopDeliveryEnabled"); }
  function money(n){ return "₹"+(Number(n)||0); }

  /* Suggested delivery amount for a distance, from admin slabs (null = beyond last slab). */
  function suggestAmount(km){
    const slabs = S.slabs.slice().sort(function(a,b){ return a.upToKm-b.upToKm; });
    for (let i=0;i<slabs.length;i++){ if (km<=slabs[i].upToKm) return slabs[i].amount; }
    return null;
  }

  /* ---------- OTP: generation + delivery channel (single switch point) ----------
     Today: "inapp" — nothing is sent; OTP is shown inside the app.
     Later: implement the sms / whatsapp branches (ideally from a server/Cloud Function). */
  function generateOtp(){
    const a = new Uint32Array(1); crypto.getRandomValues(a);
    return String(a[0] % 1000000).padStart(6,"0");
  }
  async function deliverOtp(channel, phone, otp, purpose){
    const ch = channel || S.otpChannel || "inapp";
    if (ch==="inapp") return {sent:false, mode:"inapp", showInApp:true};
    if (ch==="sms")      return {sent:false, mode:"sms",      reason:"not_enabled"};   // TODO: SMS gateway
    if (ch==="whatsapp") return {sent:false, mode:"whatsapp", reason:"not_enabled"};   // TODO: WhatsApp API
    return {sent:false, mode:ch, reason:"unknown_channel"};
  }

  /* ---------- Shop-side screens ---------- */
  function renderScreen(s){
    if (s.type==="dnShop") return DNS.renderShop();
    if (s.type==="dnNewReq") return DNS.renderNewReq(s.orderId);
    if (s.type==="dnLegal") return renderLegalList();
    if (s.type==="dnLegalDoc") return renderLegalDoc(s.doc);
    return "";
  }
  function renderLegalList(){
    let h = header("Terms & Policies", {onBack:"openScreen({type:'dnShop'})"}) + '<div class="content">';
    LEGAL_DOCS.forEach(function(d){
      h += '<button class="btn" style="background:var(--card);color:var(--text);border:1px solid var(--border);margin-bottom:8px;text-align:left;" onclick="openScreen({type:\'dnLegalDoc\',doc:\''+d[0]+'\'})">'+esc(d[1])+'</button>';
    });
    return h + '</div>';
  }
  function renderLegalDoc(id){
    const d = LEGAL_DOCS.find(function(x){ return x[0]===id; }) || [id,id];
    let h = header(d[1], {onBack:"openScreen({type:'dnLegal'})"}) + '<div class="content"><div class="card">';
    h += '<div style="font-weight:800;margin-bottom:8px;">'+esc(d[1])+'</div>';
    h += '<div class="tiny muted" style="line-height:1.6;">[Placeholder] This document will be drafted and reviewed by a qualified legal professional before launch.<br><br>'+
         'Platform note: MyDukaan provides technology that helps shops and independent delivery providers connect. Delivery providers are independent providers and are not employees of MyDukaan. '+
         'This text is not legal advice.</div></div></div>';
    return h;
  }

  /* ---------- Super Admin: Delivery Network settings ---------- */
  async function openAdmin(){
    await loadSettings();
    const host = document.getElementById("toastHost");
    let h = '<div class="modal-overlay" onclick="DN.closeModal(event)"><div class="modal-sheet" onclick="event.stopPropagation()">'+
      '<div class="modal-title">🛵 Delivery Network Settings</div>'+
      '<button class="btn" style="background:var(--border);color:var(--text);margin-bottom:10px;" onclick="DNP.openAdmin()">👥 Delivery Providers</button>'+
      '<button class="btn" style="background:var(--border);color:var(--text);margin-bottom:10px;" onclick="DNS.openAdminShops()">🏪 Shops (activation)</button>';
    h += '<div class="section-title" style="margin-top:0;">Feature flags</div>';
    Object.keys(FLAG_LABELS).forEach(function(k){
      h += '<label style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;"><input type="checkbox" id="dn_f_'+k+'"'+(S.flags[k]?' checked':'')+' style="width:auto;"> '+esc(FLAG_LABELS[k])+'</label>';
    });
    h += '<div class="section-title">Pricing &amp; duration</div>';
    h += field("Shop monthly fee (₹)","number","dn_shopFee",S.deliveryNetworkShopMonthlyFee);
    h += field("Provider monthly fee (₹)","number","dn_provFee",S.deliveryNetworkProviderMonthlyFee);
    h += field("Subscription duration (days)","number","dn_days",S.subscriptionDurationDays);
    h += field("Free trial (days, 0 = none)","number","dn_trial",S.trialDays);
    h += '<div class="section-title">Suggested delivery slabs (up to km → ₹)</div>';
    for (let i=0;i<6;i++){
      const sl = S.slabs[i];
      h += '<div style="display:flex;gap:8px;margin-bottom:8px;"><input type="number" id="dn_km'+i+'" placeholder="up to km" value="'+(sl?esc(sl.upToKm):'')+'">'+
           '<input type="number" id="dn_amt'+i+'" placeholder="₹ amount" value="'+(sl?esc(sl.amount):'')+'"></div>';
    }
    h += '<div class="section-title">Rules</div>';
    h += field("Max provider search radius (km)","number","dn_radius",S.maxSearchRadiusKm);
    h += field("Offer expiry (minutes)","number","dn_expiry",S.offerExpiryMinutes);
    h += field("Road distance factor (straight line × this)","number","dn_road",S.roadDistanceFactor);
    h += selectField("OTP channel","dn_otpChannel",["inapp","sms","whatsapp"],S.otpChannel);
    [["dn_verif","Provider verification required",S.providerVerificationRequired],
     ["dn_shopCancel","Shop may cancel before pickup",S.allowShopCancelBeforePickup],
     ["dn_reason","Cancellation reason required",S.requireCancelReason]].forEach(function(r){
      h += '<label style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;"><input type="checkbox" id="'+r[0]+'"'+(r[2]?' checked':'')+' style="width:auto;"> '+esc(r[1])+'</label>';
    });
    h += '<div id="dn_err" class="tiny" style="color:#dc2626;min-height:14px;margin:6px 0;"></div>'+
         '<button class="btn primary" onclick="DN.saveAdmin()">Save</button>'+
         '<button class="btn" style="background:var(--border);color:var(--text);margin-top:8px;" onclick="DN.closeModal()">Close</button></div></div>';
    host.innerHTML = h;
  }
  function closeModal(e){ if (e && e.target!==e.currentTarget) return; document.getElementById("toastHost").innerHTML=""; }
  function setErr(m){ const el=document.getElementById("dn_err"); if(el) el.textContent=m; }

  function readForm(){
    const g = function(id){ return document.getElementById(id); };
    const num = function(id){ const v=parseFloat(g(id).value); return isFinite(v)?v:NaN; };
    const o = {flags:{}};
    Object.keys(FLAG_LABELS).forEach(function(k){ o.flags[k] = !!g("dn_f_"+k).checked; });
    o.deliveryNetworkShopMonthlyFee = num("dn_shopFee");
    o.deliveryNetworkProviderMonthlyFee = num("dn_provFee");
    o.subscriptionDurationDays = num("dn_days");
    o.trialDays = num("dn_trial");
    o.maxSearchRadiusKm = num("dn_radius");
    o.offerExpiryMinutes = num("dn_expiry");
    o.roadDistanceFactor = num("dn_road");
    if (isNaN(o.roadDistanceFactor) || o.roadDistanceFactor<1 || o.roadDistanceFactor>3) throw new Error("Road factor must be between 1 and 3");
    ["deliveryNetworkShopMonthlyFee","deliveryNetworkProviderMonthlyFee","trialDays"].forEach(function(k){
      if (isNaN(o[k]) || o[k]<0) throw new Error("Fees / trial must be 0 or more");
    });
    if (isNaN(o.subscriptionDurationDays) || o.subscriptionDurationDays<1) throw new Error("Duration must be at least 1 day");
    if (isNaN(o.maxSearchRadiusKm) || o.maxSearchRadiusKm<=0) throw new Error("Search radius must be above 0");
    if (isNaN(o.offerExpiryMinutes) || o.offerExpiryMinutes<1) throw new Error("Offer expiry must be at least 1 minute");
    o.otpChannel = g("dn_otpChannel").value;
    o.providerVerificationRequired = !!g("dn_verif").checked;
    o.allowShopCancelBeforePickup = !!g("dn_shopCancel").checked;
    o.requireCancelReason = !!g("dn_reason").checked;
    const slabs = []; let prev = 0;
    for (let i=0;i<6;i++){
      const kmRaw = g("dn_km"+i).value.trim(), amtRaw = g("dn_amt"+i).value.trim();
      if (!kmRaw && !amtRaw) continue;
      const km = parseFloat(kmRaw), amt = parseFloat(amtRaw);
      if (!isFinite(km) || !isFinite(amt) || km<=0 || amt<0) throw new Error("Slab "+(i+1)+": enter valid km and ₹");
      if (km<=prev) throw new Error("Slab km must increase each row");
      prev = km; slabs.push({upToKm:km, amount:amt});
    }
    if (!slabs.length) throw new Error("Add at least one delivery slab");
    o.slabs = slabs;
    return o;
  }
  async function saveAdmin(){
    let o;
    try{ o = readForm(); }catch(e){ setErr(e.message); return; }
    setErr("Saving…");
    try{
      const u = firebase.auth().currentUser;
      o.updatedAt = new Date().toISOString(); o.updatedBy = u ? u.uid : null;
      await fbdb.ref("deliveryNetwork/settings").set(o);
      S = merge(o);
      closeModal(); toast("Delivery settings saved");
    }catch(e){ setErr("Save failed — check Firebase rules are published (see rules file) and internet."); }
  }

  return {settings, loadSettings, isOn, shopTileVisible, suggestAmount, money,
          generateOtp, deliverOtp, renderScreen, openAdmin, closeModal, saveAdmin, merge};
})();

/* =====================================================================
   MyDukaan LOCAL DELIVERY NETWORK — Stage 2: Delivery Provider module
   Provider page: ?provider=1  |  Admin: Superadmin > Delivery Network > Providers
   Data: deliveryNetwork/providers/<uid>, providerPhotos/<uid>, subscriptions/<uid>
   Payments are recorded manually by admin (no gateway). Independent providers, not employees.
===================================================================== */
const DNP = (function(){
  const ID_TYPES = ["Aadhaar","Voter ID","Driving Licence","PAN","Other"];
  const VEHICLES = ["Bike","Scooter","Bicycle","E-rickshaw","Auto","Mini truck","On foot"];
  const BASE = "deliveryNetwork/";
  const DAY = 86400000;
  let P = {screen:"login", uid:null, profile:null, sub:null, photo:"", draft:{photo:"",lat:null,lng:null}, err:"", offs:[]};
  let A = {list:[], subs:{}, q:"", f:"all", sel:null, photo:""};
  const S = function(){ return DN.settings(); };
  const g = function(id){ const e=document.getElementById(id); return e ? String(e.value||"").trim() : ""; };
  const pEmail = function(m){ return "provider_"+m+"@mydukaanapp.local"; };
  function me(){
    const u = firebase.auth().currentUser;
    return (u && !u.isAnonymous && u.email && u.email.indexOf("provider_")===0) ? u : null;
  }
  const fmtDate = function(ts){ return ts ? new Date(Number(ts)).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "-"; };
  function badge(st){
    const c = {pending:"#d97706",verified:"#16a34a",rejected:"#dc2626",suspended:"#7c3aed",active:"#16a34a",expired:"#dc2626",none:"#64748b"}[st]||"#64748b";
    return '<span style="background:'+c+'22;color:'+c+';border:1px solid '+c+'55;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:800;text-transform:uppercase;">'+esc(st)+'</span>';
  }
  const subActive = function(s){ return !!(s && Number(s.expiryTs)>Date.now() && s.status!=="cancelled"); };
  const verifyOk = function(p){ return !!p && (p.status==="verified" || (!S().providerVerificationRequired && p.status==="pending")); };
  const canGoAvailable = function(p,s){ return verifyOk(p) && (!S().flags.providerSubscriptionEnabled || subActive(s)); };

  /* ================= Provider side ================= */
  async function boot(){
    await DN.loadSettings();
    const u = me();
    if (u){ P.uid = u.uid; attach(); } else { P.screen = "login"; }
  }
  function detach(){ P.offs.forEach(function(f){ try{ f(); }catch(e){} }); P.offs = []; }
  function attach(){
    detach();
    const pr = fbdb.ref(BASE+"providers/"+P.uid), sr = fbdb.ref(BASE+"subscriptions/"+P.uid);
    const onP = function(snap){
      const first = (P.screen!=="home" && P.screen!=="register") || !P.profile;
      P.profile = snap.val();
      if (P.profile){ P.screen = "home"; refresh(); }
      else if (P.screen!=="register"){ P.screen = "register"; refresh(); }
    };
    const onS = function(snap){ P.sub = snap.val(); if (P.screen==="home") refresh(); };
    pr.on("value", onP, function(){}); sr.on("value", onS, function(){});
    P.offs.push(function(){ pr.off("value", onP); sr.off("value", onS); });
    fbdb.ref(BASE+"providerPhotos/"+P.uid).once("value").then(function(s){ P.photo = s.val()||""; if (P.screen==="home") refresh(); }).catch(function(){});
  }
  function refresh(){ if (ROUTE==="provider") render_(); }
  function render_(){ document.getElementById("app").innerHTML = render(); }

  function render(){
    const st = S();
    let h = header("Delivery Provider") + '<div class="content">';
    if (!st.flags.deliveryNetworkEnabled){
      return h + '<div class="card">The Local Delivery Network is not available right now.</div></div>';
    }
    h += '<div class="tiny muted" style="margin-bottom:12px;line-height:1.5;">MyDukaan is a technology platform. Delivery providers are independent providers and accept delivery opportunities voluntarily.</div>';
    if (P.screen==="home" && P.profile) return h + renderHome() + '</div>';
    if (P.screen==="register") return h + renderRegister() + '</div>';
    return h + renderLogin() + '</div>';
  }
  function renderLogin(){
    let h = '<div class="card">'+field("Mobile Number","tel","pl_mobile","")+field("Password","password","pl_pass","")+
      '<div class="tiny" id="pl_err" style="color:#dc2626;min-height:14px;margin-bottom:8px;">'+esc(P.err)+'</div>'+
      '<button class="btn primary" onclick="DNP.login()">Login</button></div>';
    if (S().flags.providerRegistrationEnabled)
      h += '<button class="btn" style="margin-top:12px;background:var(--border);color:var(--text);" onclick="DNP.goRegister()">New provider? Register</button>';
    else h += '<div class="tiny muted" style="margin-top:12px;">New provider registration is currently closed.</div>';
    return h;
  }
  function goRegister(){ P.screen="register"; P.err=""; render_(); }
  function goLogin(){ P.screen="login"; P.err=""; render_(); }
  function renderRegister(){
    const u = me(), mob = u ? u.email.slice(9,19) : "";
    if (!u && !S().flags.providerRegistrationEnabled) return '<div class="card">Registration is currently closed.</div>';
    let h = '<div class="card"><div style="font-weight:800;margin-bottom:10px;">Provider Registration</div>';
    h += '<div style="text-align:center;margin-bottom:10px;"><img id="pr_prev" src="'+esc(P.draft.photo)+'" style="width:90px;height:90px;border-radius:50%;object-fit:cover;background:var(--border);"><br>'+
         '<input type="file" accept="image/*" capture="user" onchange="DNP.pickPhoto(this)" style="margin-top:8px;font-size:12px;"><div class="tiny muted">Profile photo *</div></div>';
    h += field("Full name *","text","pr_name","")+(u?'<div class="field"><label class="field-label">Mobile</label><input type="tel" id="pr_mobile" value="'+esc(mob)+'" readonly></div>':field("Mobile number *","tel","pr_mobile",""))+
         field("Address *","text","pr_addr","")+field("City *","text","pr_city","")+field("Area / locality *","text","pr_area","")+
         selectField("Vehicle type *","pr_vtype",VEHICLES,"Bike")+field("Vehicle number (if any)","text","pr_vnum","")+field("Driving licence no. (if any)","text","pr_lic","")+
         selectField("ID type *","pr_idtype",ID_TYPES,"Aadhaar")+field("ID number — last 4 digits only *","tel","pr_id4","")+
         field("Emergency contact name *","text","pr_ename","")+field("Emergency contact mobile *","tel","pr_ephone","");
    h += '<div class="tiny muted" style="margin:-4px 0 10px;">We do not store full ID numbers or ID photos.</div>';
    h += '<button class="btn" style="background:var(--border);color:var(--text);margin-bottom:6px;" onclick="DNP.useLocation()">📍 Use my approximate area location</button><div class="tiny muted" id="pr_loc" style="margin-bottom:10px;">'+(P.draft.lat!=null?'Saved (approx.)':'Optional — used only to find nearby delivery opportunities')+'</div>';
    if (!u) h += field("Create password *","password","pr_pass","");
    h += '<label style="display:flex;gap:10px;font-size:12px;margin-bottom:8px;"><input type="checkbox" id="pr_terms" style="width:auto;"> I accept the Independent Delivery Provider Terms and Privacy Policy (placeholder documents).</label>'+
         '<label style="display:flex;gap:10px;font-size:12px;margin-bottom:8px;"><input type="checkbox" id="pr_indep" style="width:auto;"> I understand I am an independent delivery provider, not an employee of MyDukaan, and that MyDukaan provides the technology platform.</label>'+
         '<div class="tiny" id="pr_err" style="color:#dc2626;min-height:14px;margin-bottom:8px;">'+esc(P.err)+'</div>'+
         '<button class="btn primary" onclick="DNP.register()">Submit for verification</button>';
    if (!u) h += '<button class="btn" style="margin-top:8px;background:var(--border);color:var(--text);" onclick="DNP.goLogin()">Back to login</button>';
    return h + '</div>';
  }
  function pickPhoto(inp){
    const f = inp.files && inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = function(){
      const img = new Image();
      img.onload = function(){
        const c = document.createElement("canvas"); c.width = c.height = 200;
        const s = Math.min(img.width, img.height);
        c.getContext("2d").drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,200,200);
        P.draft.photo = c.toDataURL("image/jpeg",0.7);
        const el = document.getElementById("pr_prev"); if (el) el.src = P.draft.photo;
      };
      img.src = r.result;
    };
    r.readAsDataURL(f);
  }
  function useLocation(){
    if (!navigator.geolocation){ toast("Location support nahi hai"); return; }
    navigator.geolocation.getCurrentPosition(function(pos){
      P.draft.lat = Math.round(pos.coords.latitude*100)/100; P.draft.lng = Math.round(pos.coords.longitude*100)/100;
      const el = document.getElementById("pr_loc"); if (el) el.textContent = "Saved (approx. area, not exact address)";
    }, function(){ toast("Location nahi mili"); }, {timeout:10000});
  }
  const setErr = function(id,m){ P.err = m; const e=document.getElementById(id); if(e) e.textContent=m; };
  function validateReg(d, needPass, pass){
    if (d.name.length<2) return "Naam bharen";
    if (!/^[0-9]{10}$/.test(d.mobile)) return "Sahi 10-digit mobile likhein";
    if (!d.address || !d.city || !d.area) return "Address, city aur area bharen";
    if (!/^[0-9]{4}$/.test(d.idLast4)) return "ID ke sirf last 4 digit likhein";
    if (!d.emergencyName || !/^[0-9]{10}$/.test(d.emergencyPhone)) return "Emergency contact naam aur 10-digit mobile bharen";
    if (!P.draft.photo) return "Profile photo lagayein";
    if (needPass && pass.length<6) return "Password kam se kam 6 character ka rakhein";
    if (!document.getElementById("pr_terms").checked || !document.getElementById("pr_indep").checked) return "Terms aur Independent Provider declaration accept karein";
    return "";
  }
  async function register(){
    const d = {name:g("pr_name"),mobile:g("pr_mobile"),address:g("pr_addr"),city:g("pr_city"),area:g("pr_area"),vehicleType:g("pr_vtype"),
      vehicleNumber:g("pr_vnum"),licenceNo:g("pr_lic"),idType:g("pr_idtype"),idLast4:g("pr_id4"),emergencyName:g("pr_ename"),emergencyPhone:g("pr_ephone")};
    const existing = me(), pass = g("pr_pass");
    const bad = validateReg(d, !existing, pass);
    if (bad){ setErr("pr_err", bad); return; }
    setErr("pr_err","Submit ho raha hai…");
    try{
      let u = existing;
      if (!u){
        try{ await firebase.auth().createUserWithEmailAndPassword(pEmail(d.mobile), firebaseAuthPassword(d.mobile, pass)); }
        catch(e){ setErr("pr_err", e && e.code==="auth/email-already-in-use" ? "Ye mobile pehle se registered hai — Login karein" : "Account nahi ban paya, dobara try karein"); return; }
        u = me();
      }
      P.uid = u.uid;
      const now = new Date().toISOString();
      const prof = {status:"pending", availability:"OFFLINE", createdAt:now, termsAccepted:true, independentDeclaration:true, termsAcceptedAt:now, termsVersion:"placeholder-v0"};
      Object.keys(d).forEach(function(k){ if (d[k]) prof[k] = d[k]; });
      if (P.draft.lat!=null){ prof.baseLat = P.draft.lat; prof.baseLng = P.draft.lng; }
      await fbdb.ref(BASE+"providers/"+P.uid).set(prof);
      await fbdb.ref(BASE+"providerPhotos/"+P.uid).set(P.draft.photo);
      P.photo = P.draft.photo; P.screen = "register"; attach();
      toast("Registration submit ho gayi — verification pending");
    }catch(e){ setErr("pr_err","Save nahi ho paya — internet / rules check karein"); }
  }
  async function login(){
    const mobile = g("pl_mobile"), pw = document.getElementById("pl_pass").value;
    if (!/^[0-9]{10}$/.test(mobile) || !pw){ setErr("pl_err","Mobile aur password bharen"); return; }
    setErr("pl_err","Check ho raha hai…");
    try{
      await firebase.auth().signInWithEmailAndPassword(pEmail(mobile), firebaseAuthPassword(mobile, pw));
      P.uid = me().uid; P.screen = "home"; P.profile = null; attach();
    }catch(e){ setErr("pl_err","Mobile ya password galat hai"); }
  }
  function logout(){
    detach(); P = {screen:"login", uid:null, profile:null, sub:null, photo:"", draft:{photo:"",lat:null,lng:null}, err:"", offs:[]};
    try{ firebase.auth().signOut().then(function(){ firebase.auth().signInAnonymously().catch(function(){}); }); }catch(e){}
    render_();
  }
  function renderHome(){
    const p = P.profile, s = P.sub, st = S();
    let h = '<div class="card" style="display:flex;gap:12px;align-items:center;margin-bottom:12px;">'+
      (P.photo?'<img src="'+esc(P.photo)+'" style="width:56px;height:56px;border-radius:50%;object-fit:cover;">':'')+
      '<div style="flex:1;"><div style="font-weight:800;">'+esc(p.name)+'</div><div class="tiny muted">'+esc(p.mobile)+' · '+esc(p.area||"")+', '+esc(p.city||"")+'</div></div>'+badge(p.status)+'</div>';
    if (p.status==="pending") h += '<div class="card" style="margin-bottom:12px;">Your registration is under review. '+(st.providerVerificationRequired?'You will receive delivery opportunities after verification.':'')+'</div>';
    if (p.status==="rejected") h += '<div class="card" style="margin-bottom:12px;">Registration was not approved.'+(p.statusNote?'<br><span class="tiny muted">Note: '+esc(p.statusNote)+'</span>':'')+'</div>';
    if (p.status==="suspended") h += '<div class="card" style="margin-bottom:12px;">Your account is suspended.'+(p.statusNote?'<br><span class="tiny muted">Note: '+esc(p.statusNote)+'</span>':'')+' Please contact support.</div>';
    const act = subActive(s);
    h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:6px;">Membership</div>';
    if (!st.flags.providerSubscriptionEnabled) h += '<div class="tiny muted">Membership is not required at the moment.</div>';
    else {
      h += '<div style="display:flex;justify-content:space-between;"><span>Status</span>'+badge(act?"active":(s?"expired":"none"))+'</div>'+
        '<div style="display:flex;justify-content:space-between;margin-top:6px;"><span>Expiry</span><b>'+(s?esc(fmtDate(s.expiryTs)):"-")+'</b></div>'+
        '<div style="display:flex;justify-content:space-between;margin-top:6px;"><span>Plan fee</span><b>'+esc(DN.money(st.deliveryNetworkProviderMonthlyFee))+' / '+esc(st.subscriptionDurationDays)+' days</b></div>'+
        '<div class="tiny muted" style="margin-top:8px;">Pay as instructed by MyDukaan support; the admin will activate your membership after payment is recorded.</div>';
    }
    h += '</div>';
    const ok = canGoAvailable(p,s), cur = p.availability||"OFFLINE";
    h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:8px;">Availability</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">';
    ["OFFLINE","AVAILABLE","BUSY"].forEach(function(v){
      const sel = cur===v, dis = v!=="OFFLINE" && !ok;
      h += '<button class="btn" style="padding:10px 4px;font-size:12px;'+(sel?'':'background:var(--border);color:var(--text);')+(dis?'opacity:.45;':'')+'" onclick="DNP.setAvail(\''+v+'\')">'+v+'</button>';
    });
    h += '</div>'+(ok?'':'<div class="tiny muted" style="margin-top:8px;">You can go Available once you are verified'+(st.flags.providerSubscriptionEnabled?' and your membership is active':'')+'.</div>')+'</div>';
    h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:6px;">Delivery Opportunities</div><div class="tiny muted">Nearby opportunities will appear here in the next stage. You choose whether to accept or reject each one.</div></div>';
    h += '<button class="btn" style="background:var(--border);color:var(--text);" onclick="DNP.logout()">Logout</button>';
    return h;
  }
  async function setAvail(v){
    if (v!=="OFFLINE" && !canGoAvailable(P.profile,P.sub)){ toast("Pehle verification / membership zaroori hai"); return; }
    try{ await fbdb.ref(BASE+"providers/"+P.uid+"/availability").set(v); toast("Status: "+v); }
    catch(e){ toast("Update nahi hua — verification / membership check karein"); }
  }

  /* ================= Admin side ================= */
  const modalHost = function(){ return document.getElementById("toastHost"); };
  async function openAdmin(){
    modalHost().innerHTML = '<div class="modal-overlay"><div class="modal-sheet"><div class="modal-title">👥 Delivery Providers</div><div class="tiny muted">Loading…</div></div></div>';
    try{
      await DN.loadSettings();
      const r = await Promise.all([withFbTimeout(fbdb.ref(BASE+"providers").once("value")), withFbTimeout(fbdb.ref(BASE+"subscriptions").once("value"))]);
      if (r[0].__timedOut || r[1].__timedOut) throw new Error("timeout");
      const pv = r[0].val()||{}; A.subs = r[1].val()||{};
      A.list = Object.keys(pv).map(function(id){ return Object.assign({uid:id}, pv[id]); }).sort(function(a,b){ return (b.createdAt||"").localeCompare(a.createdAt||""); });
      A.sel = null; A.q = ""; A.f = "all"; adminRender();
    }catch(e){ modalHost().innerHTML = '<div class="modal-overlay" onclick="DNP.closeAdmin(event)"><div class="modal-sheet" onclick="event.stopPropagation()"><div class="modal-title">👥 Delivery Providers</div><div class="tiny" style="color:#dc2626;">Load nahi hua — rules publish aur internet check karein.</div><button class="btn" style="margin-top:10px;" onclick="DNP.closeAdmin()">Close</button></div></div>'; }
  }
  function closeAdmin(e){ if (e && e.target!==e.currentTarget) return; modalHost().innerHTML = ""; }
  function adminRender(){
    let h = '<div class="modal-overlay" onclick="DNP.closeAdmin(event)"><div class="modal-sheet" onclick="event.stopPropagation()">';
    if (A.sel) h += adminDetail(); else {
      h += '<div class="modal-title">👥 Delivery Providers ('+A.list.length+')</div>'+
        '<input type="text" placeholder="Search name / mobile" value="'+esc(A.q)+'" oninput="DNP.adminSearch(this.value)" style="margin-bottom:8px;">'+
        '<select onchange="DNP.adminFilter(this.value)" style="margin-bottom:10px;">'+["all","pending","verified","rejected","suspended"].map(function(f){ return '<option value="'+f+'"'+(A.f===f?' selected':'')+'>'+f+'</option>'; }).join('')+'</select>'+
        '<div id="pa_list">'+adminListHtml()+'</div>'+
        '<button class="btn" style="margin-top:10px;background:var(--border);color:var(--text);" onclick="DN.openAdmin()">← Settings</button>'+
        '<button class="btn" style="margin-top:8px;background:var(--border);color:var(--text);" onclick="DNP.closeAdmin()">Close</button>';
    }
    modalHost().innerHTML = h + '</div></div>';
  }
  function adminListHtml(){
    const q = A.q.toLowerCase();
    const rows = A.list.filter(function(p){ return (A.f==="all"||p.status===A.f) && (!q || (p.name||"").toLowerCase().indexOf(q)!==-1 || (p.mobile||"").indexOf(q)!==-1); });
    if (!rows.length) return '<div class="tiny muted">No providers found.</div>';
    return rows.map(function(p){
      const s = A.subs[p.uid];
      return '<div class="card" style="margin-bottom:8px;padding:10px;cursor:pointer;" onclick="DNP.adminOpen(\''+esc(p.uid)+'\')"><div style="display:flex;justify-content:space-between;gap:8px;"><b>'+esc(p.name)+'</b>'+badge(p.status)+'</div>'+
        '<div class="tiny muted">'+esc(p.mobile)+' · '+esc(p.area||"")+', '+esc(p.city||"")+' · '+esc(p.availability||"OFFLINE")+'</div>'+
        '<div class="tiny muted">Membership: '+(subActive(s)?'active till '+esc(fmtDate(s.expiryTs)):(s?'expired':'none'))+'</div></div>';
    }).join('');
  }
  function adminSearch(v){ A.q = v; const e=document.getElementById("pa_list"); if (e) e.innerHTML = adminListHtml(); }
  function adminFilter(v){ A.f = v; const e=document.getElementById("pa_list"); if (e) e.innerHTML = adminListHtml(); }
  async function adminOpen(uid){
    A.sel = uid; A.photo = ""; adminRender();
    try{ const s = await fbdb.ref(BASE+"providerPhotos/"+uid).once("value"); A.photo = s.val()||""; if (A.sel===uid) adminRender(); }catch(e){}
  }
  function adminBack(){ A.sel = null; adminRender(); }
  function adminDetail(){
    const p = A.list.find(function(x){ return x.uid===A.sel; }) || {}, s = A.subs[A.sel];
    const row = function(k,v){ return '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;"><span class="muted">'+k+'</span><b style="text-align:right;">'+esc(v||"-")+'</b></div>'; };
    let h = '<div class="modal-title">'+esc(p.name||"Provider")+' '+badge(p.status||"pending")+'</div>'+
      (A.photo?'<div style="text-align:center;margin-bottom:8px;"><img src="'+esc(A.photo)+'" style="width:110px;height:110px;border-radius:50%;object-fit:cover;"></div>':'')+
      row("Mobile",p.mobile)+row("Address",p.address)+row("City / Area",(p.city||"")+" / "+(p.area||""))+row("Vehicle",(p.vehicleType||"")+" "+(p.vehicleNumber||""))+row("Licence",p.licenceNo)+
      row("ID",(p.idType||"")+" ••••"+(p.idLast4||""))+row("Emergency",(p.emergencyName||"")+" "+(p.emergencyPhone||""))+row("Availability",p.availability)+row("Registered",fmtDate(Date.parse(p.createdAt||"")))+
      (p.statusNote?row("Note",p.statusNote):"")+
      '<div class="section-title">Membership</div>'+row("Status",subActive(s)?"Active":(s?"Expired / cancelled":"None"))+row("Expiry",s?fmtDate(s.expiryTs):"-")+row("Payment",s?(s.paymentStatus+(s.paymentMethod&&s.paymentMethod!=="none"?" ("+s.paymentMethod+")":"")):"-");
    const b = function(label,fn,bg){ return '<button class="btn" style="margin-top:8px;'+(bg?'':'background:var(--border);color:var(--text);')+'" onclick="'+fn+'">'+label+'</button>'; };
    h += '<div class="section-title">Actions</div>';
    if (p.status!=="verified") h += b("✅ Verify","DNP.adminStatus('verified')",1);
    if (p.status!=="rejected" && p.status!=="verified") h += b("❌ Reject","DNP.adminStatus('rejected')");
    if (p.status==="verified") h += b("⏸ Suspend","DNP.adminStatus('suspended')");
    if (p.status==="suspended") h += b("▶ Reactivate","DNP.adminStatus('verified')",1);
    h += b("💳 Mark paid (+"+S().subscriptionDurationDays+" days)","DNP.adminActivate('paid')",1);
    if (S().trialDays>0) h += b("🎁 Grant trial ("+S().trialDays+" days)","DNP.adminActivate('trial')");
    if (s) h += b("Cancel membership","DNP.adminCancelSub()");
    return h + b("← Back to list","DNP.adminBack()");
  }
  async function adminStatus(st){
    const p = A.list.find(function(x){ return x.uid===A.sel; }); if (!p) return;
    let note = ""; if (st==="rejected"||st==="suspended"){ note = prompt("Reason / note (optional)") || ""; }
    const upd = {status:st, statusNote:note||null, statusUpdatedAt:new Date().toISOString()};
    if (st!=="verified") upd.availability = "OFFLINE";
    try{ await fbdb.ref(BASE+"providers/"+p.uid).update(upd); Object.assign(p, upd); if (!note) delete p.statusNote; adminRender(); toast("Status: "+st); }
    catch(e){ toast("Update fail hua"); }
  }
  function buildSub(kind, old, st, uid){
    const now = Date.now(), days = kind==="paid" ? Number(st.subscriptionDurationDays)||30 : Number(st.trialDays)||0;
    const extend = subActive(old), baseTs = extend ? Number(old.expiryTs) : now;
    return {planId:"default", amount:kind==="paid"?Number(st.deliveryNetworkProviderMonthlyFee)||0:0, durationDays:days,
      startTs:extend?Number(old.startTs)||now:now, expiryTs:baseTs+days*DAY, status:"active",
      paymentStatus:kind==="paid"?"paid":"trial", paymentMethod:kind==="paid"?"manual":"none",
      updatedAt:new Date().toISOString(), updatedBy:(firebase.auth().currentUser||{}).uid||""};
  }
  async function adminActivate(kind){
    const uid = A.sel; if (!uid) return;
    if (kind==="trial" && !(S().trialDays>0)){ toast("Trial days 0 hain"); return; }
    const sub = buildSub(kind, A.subs[uid], S(), uid);
    try{ await fbdb.ref(BASE+"subscriptions/"+uid).set(sub); A.subs[uid] = sub; adminRender(); toast(kind==="paid"?"Payment recorded — membership active":"Trial granted"); }
    catch(e){ toast("Save fail hua"); }
  }
  async function adminCancelSub(){
    const uid = A.sel, old = A.subs[uid]; if (!uid || !old) return;
    if (!confirm("Membership cancel karein?")) return;
    const sub = Object.assign({}, old, {status:"cancelled", expiryTs:Date.now(), updatedAt:new Date().toISOString()});
    try{ await fbdb.ref(BASE+"subscriptions/"+uid).set(sub); await fbdb.ref(BASE+"providers/"+uid+"/availability").set("OFFLINE"); A.subs[uid]=sub; const p=A.list.find(function(x){return x.uid===uid;}); if(p) p.availability="OFFLINE"; adminRender(); toast("Membership cancelled"); }
    catch(e){ toast("Save fail hua"); }
  }

  return {boot, render, login, logout, register, goRegister, goLogin, pickPhoto, useLocation, setAvail,
          openAdmin, closeAdmin, adminSearch, adminFilter, adminOpen, adminBack, adminStatus, adminActivate, adminCancelSub,
          _t:{subActive, verifyOk, canGoAvailable, buildSub, validateReg, P:function(){return P;}}};
})();

/* =====================================================================
   MyDukaan LOCAL DELIVERY NETWORK — Stage 3: Shop side
   Shop activation (admin records payment), Request Local Delivery for an existing order,
   distance + slab price, shop delivery dashboard, cancellation, customer location pin.
   Delivery attaches to the EXISTING order (shops/<shop>/orders/<orderId>/deliveryId).
   Data: deliveryNetwork/{shopSubs, shopActivationRequests, requests, requestPrivate, orderLinks, counters, customerPins}
===================================================================== */
const DNS = (function(){
  const B = "deliveryNetwork/", DAY = 86400000;
  const STAT = {CREATED:["Created","#64748b"],SEARCHING:["Searching","#d97706"],OFFERED:["Offered","#d97706"],ACCEPTED:["Provider assigned","#2563eb"],
    ARRIVED_AT_PICKUP:["At pickup","#2563eb"],PICKED_UP:["Picked up","#7c3aed"],OUT_FOR_DELIVERY:["Out for delivery","#7c3aed"],
    DELIVERED:["Delivered","#16a34a"],CANCELLED:["Cancelled","#dc2626"],EXPIRED:["Expired","#64748b"]};
  const CANCELLABLE = ["CREATED","SEARCHING","OFFERED"];
  const TERMINAL = ["DELIVERED","CANCELLED","EXPIRED"];
  const GROUPS = [["all","All"],["active","Active"],["searching","Searching"],["assigned","Provider assigned"],["picked","Picked up / Out"],["delivered","Delivered"],["cancelled","Cancelled / Expired"]];
  const CANCEL_REASONS = ["Shop cancelled","Customer unavailable","Wrong address","Package unavailable","Other"];
  const SIZES = ["Small","Medium","Large"], PAYS = ["Cash","UPI","Other"], DEADLINES = ["15 min","30 min","45 min","60 min","90 min"];
  let D = {shopId:null, sub:null, act:null, reqs:{}, offs:[], filter:"all", draft:{}};
  let AD = {list:[], subs:{}, acts:{}, q:""};
  let PIN = {lat:null, lng:null};
  const S = function(){ return DN.settings(); };
  const g = function(id){ const e=document.getElementById(id); return e ? String(e.value||"").trim() : ""; };
  const setTxt = function(id,t){ const e=document.getElementById(id); if (e) e.textContent = t; };
  const r1 = function(n){ return Math.round(n*10)/10; };
  const fmtD = function(ts){ return new Date(Number(ts)).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); };
  const fmtT = function(iso){ return iso ? String(iso).replace("T"," ").slice(0,16) : "-"; };
  const subActive = function(s){ return !!(s && Number(s.expiryTs)>Date.now() && s.status!=="cancelled"); };
  const badge = function(st){ const x = STAT[st]||[st,"#64748b"]; return '<span style="background:'+x[1]+'22;color:'+x[1]+';border:1px solid '+x[1]+'55;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:800;white-space:nowrap;">'+esc(x[0])+'</span>'; };
  function groupOf(st){
    if (st==="DELIVERED") return "delivered";
    if (st==="CANCELLED"||st==="EXPIRED") return "cancelled";
    if (st==="ACCEPTED"||st==="ARRIVED_AT_PICKUP") return "assigned";
    if (st==="PICKED_UP"||st==="OUT_FOR_DELIVERY") return "picked";
    return "searching";
  }
  const isActiveSt = function(st){ return TERMINAL.indexOf(st)===-1; };

  /* ---------- live data for the logged-in shop ---------- */
  function detach(){ D.offs.forEach(function(f){ try{ f(); }catch(e){} }); D.offs = []; }
  function listen(path, fn){
    const r = fbdb.ref(path), cb = function(s){ fn(s.val()); refresh(); };
    r.on("value", cb, function(){}); D.offs.push(function(){ r.off("value", cb); });
  }
  function ensure(){
    if (typeof CURRENT_SHOP_ID==="undefined" || !CURRENT_SHOP_ID) return false;
    if (D.shopId===CURRENT_SHOP_ID) return true;
    detach(); D = {shopId:CURRENT_SHOP_ID, sub:null, act:null, reqs:{}, offs:[], filter:"all", draft:{}};
    const sid = CURRENT_SHOP_ID;
    listen(B+"shopSubs/"+sid, function(v){ D.sub = v; });
    listen(B+"shopActivationRequests/"+sid, function(v){ D.act = v; });
    listen(B+"requests/"+sid, function(v){ D.reqs = v||{}; });
    return true;
  }
  function refresh(){
    if (ROUTE!=="app" || !SCREEN) return;
    const t = SCREEN.type||"";
    if (t==="orders" || t==="dnShop") render();
  }
  const shopActive = function(){ return subActive(D.sub); };
  const reqList = function(){ return Object.keys(D.reqs).map(function(id){ return Object.assign({id:id}, D.reqs[id]); }).sort(function(a,b){ return (b.createdTs||0)-(a.createdTs||0); }); };

  /* ---------- Shop: Local Delivery home + dashboard ---------- */
  function renderShop(){
    ensure(); const st = S();
    let h = header("Local Delivery", {onBack:"closeScreen('more')"}) + '<div class="content">';
    h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:6px;">🛵 MyDukaan Local Delivery Network</div>'+
      '<div class="tiny muted" style="line-height:1.5;">MyDukaan is a technology platform that connects shops with independent delivery providers. Providers accept delivery opportunities voluntarily. MyDukaan does not take a per-delivery commission.</div></div>';
    const act = shopActive();
    h += '<div class="card" style="margin-bottom:12px;">'+
      '<div style="display:flex;justify-content:space-between;"><span>Network access fee</span><b>'+esc(DN.money(st.deliveryNetworkShopMonthlyFee))+' / '+esc(st.subscriptionDurationDays)+' days</b></div>'+
      '<div style="display:flex;justify-content:space-between;margin-top:6px;"><span>Status</span><b class="'+(act?'green':'orange')+'">'+(act?'Active':(D.sub?'Expired':'Not activated'))+'</b></div>'+
      (D.sub ? '<div style="display:flex;justify-content:space-between;margin-top:6px;"><span>Expiry</span><b>'+esc(fmtD(D.sub.expiryTs))+'</b></div>' : '');
    if (!act){
      if (D.act && D.act.status==="requested") h += '<div class="tiny muted" style="margin-top:8px;">Activation requested. It will be activated after your payment is recorded by MyDukaan support.</div>';
      else h += '<button class="btn primary" style="margin-top:10px;" onclick="DNS.requestActivation()">Request activation</button>';
    } else if (act && Number(D.sub.expiryTs)-Date.now() < 5*DAY){
      h += '<div class="tiny orange" style="margin-top:8px;">Expiring soon — contact MyDukaan support to renew.</div>';
    }
    h += '</div>';
    const list = reqList();
    if (list.length){
      const cnt = function(k){ return list.filter(function(r){ return k==="all" || (k==="active"?isActiveSt(r.status):groupOf(r.status)===k); }).length; };
      h += '<div class="section-title">Deliveries</div><select onchange="DNS.setFilter(this.value)" style="margin-bottom:10px;">'+
        GROUPS.map(function(x){ return '<option value="'+x[0]+'"'+(D.filter===x[0]?' selected':'')+'>'+esc(x[1])+' ('+cnt(x[0])+')</option>'; }).join('')+'</select>';
      const rows = list.filter(function(r){ return D.filter==="all" || (D.filter==="active"?isActiveSt(r.status):groupOf(r.status)===D.filter); });
      h += rows.length ? rows.map(reqCard).join('') : '<div class="tiny muted">No deliveries in this filter.</div>';
    }
    if (!list.length && act) h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:6px;">Deliveries</div>'+
      '<div class="tiny muted" style="line-height:1.5;">No delivery requests yet. Open <b>Orders Received</b>, pick an order where the customer chose Home Delivery, and tap <b>🛵 Request Local Delivery</b>.</div>'+
      '<button class="btn primary" style="margin-top:10px;" onclick="openScreen({type:\'orders\'})">🧾 Open Orders</button></div>';
    h += '<button class="btn" style="margin-top:6px;background:var(--border);color:var(--text);" onclick="openScreen({type:\'dnLegal\'})">📄 Terms &amp; Policies</button>';
    return h + '</div>';
  }
  function reqCard(r){
    const row = function(k,v){ return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:2px 0;"><span class="muted">'+k+'</span><span style="text-align:right;font-weight:700;">'+esc(v)+'</span></div>'; };
    let h = '<div class="card" style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;"><b>'+esc(r.code||"Delivery")+'</b>'+badge(r.status)+'</div>'+
      row("Order","#"+String(r.orderId||"").slice(-6).toUpperCase())+row("Customer",r.customerName||"-")+row("Provider",r.providerName||"Not assigned yet")+
      row("Distance",r.distanceKm+" km")+row("Delivery charge",DN.money(r.deliveryCharge)+" ("+(r.paymentMethod||"-")+", "+(r.paymentStatus||"pending")+")")+
      row("MyDukaan commission",DN.money(r.mdCommission||0))+row("Created",fmtT(r.createdAt))+(r.deliveredAt?row("Completed",fmtT(r.deliveredAt)):"")+
      (r.status==="CANCELLED"?row("Cancelled",(r.cancelledBy||"")+(r.cancelReason?" — "+r.cancelReason:"")):"");
    if (CANCELLABLE.indexOf(r.status)!==-1 && S().allowShopCancelBeforePickup)
      h += '<button class="icon-mini-btn danger" style="margin-top:8px;" onclick="DNS.askCancel(\''+esc(r.id)+'\')">Cancel delivery</button>';
    return h + '</div>';
  }
  function setFilter(v){ D.filter = v; render(); }
  async function requestActivation(){
    ensure();
    try{
      await fbdb.ref(B+"shopActivationRequests/"+D.shopId).set({status:"requested", requestedAt:new Date().toISOString(), shopName:(STATE&&STATE.settings&&STATE.settings.shopName)||""});
      toast("Activation request bhej di gayi");
    }catch(e){ toast("Request nahi gayi — internet check karein"); }
  }

  /* ---------- Order list button (hook) ---------- */
  function orderBtn(o){
    try{
      if (!DN.isOn("shopDeliveryEnabled") || !ensure()) return "";
      const r = o.deliveryId ? D.reqs[o.deliveryId] : null;
      if (r && r.status!=="CANCELLED" && r.status!=="EXPIRED")
        return '<button class="icon-mini-btn" style="background:#ede9fe;color:#6d28d9;" onclick="openScreen({type:\'dnShop\'})">🛵 '+esc(r.code||"Delivery")+' · '+esc((STAT[r.status]||[r.status])[0])+'</button>';
      if (o.deliveryType==="delivery" && o.status!=="completed")
        return '<button class="icon-mini-btn" style="background:#ede9fe;color:#6d28d9;" onclick="DNS.openNewReq(\''+esc(o.id)+'\')">🛵 Request Local Delivery</button>';
    }catch(e){}
    return "";
  }

  /* ---------- Create delivery request ---------- */
  async function openNewReq(orderId){
    ensure();
    if (!shopActive()){ toast("Pehle Local Delivery activate karein"); openScreen({type:"dnShop"}); return; }
    const s = (STATE && STATE.settings) || {};
    D.draft = {orderId:orderId, pLat:isFinite(parseFloat(s.shopLat))?Number(s.shopLat):null, pLng:isFinite(parseFloat(s.shopLng))?Number(s.shopLng):null, dLat:null, dLng:null};
    try{
      const snap = await withFbTimeout(fbdb.ref(B+"customerPins/"+D.shopId+"/"+orderId).once("value"));
      const v = snap && !snap.__timedOut ? snap.val() : null;
      if (v && isFinite(v.lat) && isFinite(v.lng)){ D.draft.dLat = Number(v.lat); D.draft.dLng = Number(v.lng); }
    }catch(e){}
    openScreen({type:"dnNewReq", orderId:orderId});
  }
  function distInfo(){
    const d = D.draft;
    if (d.pLat!=null && d.dLat!=null) return {km:r1(haversineKm(d.pLat,d.pLng,d.dLat,d.dLng)*(S().roadDistanceFactor||1.3)), src:"geo"};
    const m = parseFloat(g("dr_km")); return (isFinite(m) && m>0) ? {km:r1(m), src:"manual"} : null;
  }
  function renderNewReq(orderId){
    const o = (typeof ORDERS!=="undefined" ? ORDERS : []).find(function(x){ return x.id===orderId; });
    let h = header("Request Local Delivery", {onBack:"openScreen({type:'orders'})"}) + '<div class="content">';
    if (!o || D.draft.orderId!==orderId) return h + '<div class="empty">Order nahi mila — Orders se dobara kholein</div></div>';
    const s = (STATE && STATE.settings) || {}, d = D.draft, i = distInfo(), sug = i ? DN.suggestAmount(i.km) : null;
    h += '<div class="card" style="margin-bottom:12px;"><b>Order #'+esc(String(o.id).slice(-6).toUpperCase())+'</b><div class="tiny muted">'+esc(o.customerName||"")+' · Total '+esc(DN.money(o.total))+'</div></div>';
    h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:8px;">Pickup</div>'+
      field("Pickup area / locality * (shown to providers)","text","dr_parea","")+field("Pickup address *","text","dr_paddr",s.address||"")+
      (d.pLat!=null ? '<div class="tiny green">📍 Shop location saved</div>' :
        '<button class="btn" style="background:var(--border);color:var(--text);" onclick="DNS.useShopLoc()">📍 I am at the shop — use current location</button><div class="tiny muted" id="dr_ploc" style="margin-top:4px;">Optional. Without it, enter the distance manually below.</div>')+'</div>';
    h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:8px;">Customer drop</div>'+
      field("Drop area / locality * (shown to providers)","text","dr_darea","")+field("Customer name *","text","dr_cname",o.customerName||"")+
      field("Customer phone *","tel","dr_cphone",o.customerMobile||"")+field("Drop address *","text","dr_daddr",o.customerAddress||"")+
      (d.dLat!=null ? '<div class="tiny green">📍 Customer pinned their location</div>' : '<div class="tiny muted">Customer did not pin a location.</div>')+
      ((d.pLat==null || d.dLat==null) ? field("Distance in km (manual) *","number","dr_km","") : '')+'</div>';
    h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;margin-bottom:8px;">Package &amp; payment</div>'+
      selectField("Package size","dr_size",SIZES,"Small")+field("Special handling instructions","text","dr_instr","")+
      selectField("Pickup deadline (from now)","dr_deadline",DEADLINES,"30 min")+selectField("Provider paid by","dr_pay",PAYS,"Cash")+'</div>';
    h += '<div class="card" style="margin-bottom:12px;"><div style="font-weight:800;">Estimated distance: <span id="dr_dist">'+(i?esc(i.km)+' km':'—')+'</span></div>'+
      '<div class="tiny muted" id="dr_src">'+(i?(i.src==="geo"?'Approximate, from both locations':'Entered manually'):'Enter distance to see price')+'</div>'+
      '<button class="btn" style="margin:8px 0;background:var(--border);color:var(--text);" onclick="DNS.recalc()">Calculate distance &amp; price</button>'+
      field("Delivery amount for provider (₹) *","number","dr_amount",sug!=null?sug:"")+
      '<div class="tiny muted" id="dr_sugg">'+(sug!=null?'Suggested: '+esc(DN.money(sug))+'. You may offer more, not less.':'')+'</div>'+
      '<div class="tiny muted" style="margin-top:6px;">The provider receives this amount. MyDukaan commission: ₹0. MyDukaan does not collect or settle this payment.</div></div>';
    h += '<div class="tiny" id="dr_err" style="color:#dc2626;min-height:14px;margin-bottom:8px;"></div><button class="btn primary" onclick="DNS.createRequest()">Create delivery request</button>';
    return h + '</div>';
  }
  function useShopLoc(){
    if (!navigator.geolocation){ toast("Location support nahi hai"); return; }
    navigator.geolocation.getCurrentPosition(function(pos){
      D.draft.pLat = pos.coords.latitude; D.draft.pLng = pos.coords.longitude; setTxt("dr_ploc","Location saved ✓"); recalc();
    }, function(){ toast("Location nahi mili"); }, {timeout:10000});
  }
  function recalc(){
    const i = distInfo(), sug = i ? DN.suggestAmount(i.km) : null;
    setTxt("dr_dist", i ? i.km+" km" : "—"); setTxt("dr_src", i ? (i.src==="geo"?"Approximate, from both locations":"Entered manually") : "Enter distance to see price");
    setTxt("dr_sugg", sug!=null ? "Suggested: "+DN.money(sug)+". You may offer more, not less." : (i ? "Distance is beyond the delivery slabs" : ""));
    const a = document.getElementById("dr_amount"); if (a && sug!=null) a.value = sug;
  }
  function buildRequest(o, f, i, ids){
    const mins = parseInt(f.deadline,10)||30, now = Date.now(), iso = new Date(now).toISOString();
    const main = {shopId:ids.shopId, orderId:o.id, code:ids.code, status:"CREATED", createdAt:iso, createdTs:now, shopName:ids.shopName,
      pickupArea:f.parea, dropArea:f.darea, distanceKm:i.km, distanceSource:i.src, deliveryCharge:f.amount, providerEarning:f.amount, mdCommission:0,
      packageSize:f.size, paymentMethod:f.pay, paymentStatus:"pending", pickupDeadline:new Date(now+mins*60000).toISOString(), pickupDeadlineTs:now+mins*60000, customerName:f.cname};
    const priv = {shopId:ids.shopId, orderId:o.id, pickupAddress:f.paddr, dropAddress:f.daddr, customerPhone:f.cphone};
    if (f.instr) priv.instructions = f.instr;
    const d = D.draft;
    if (d.pLat!=null){ priv.pickupLat = d.pLat; priv.pickupLng = d.pLng; }
    if (d.dLat!=null){ priv.dropLat = d.dLat; priv.dropLng = d.dLng; }
    const u = {};
    u[B+"requests/"+ids.shopId+"/"+ids.id] = main;
    u[B+"requestPrivate/"+ids.shopId+"/"+ids.id] = priv;
    u[B+"orderLinks/"+ids.shopId+"/"+o.id] = ids.id;
    u["shops/"+ids.shopId+"/orders/"+o.id+"/deliveryId"] = ids.id;
    return u;
  }
  async function createRequest(){
    const err = function(m){ setTxt("dr_err", m); };
    ensure();
    const o = ORDERS.find(function(x){ return x.id===D.draft.orderId; });
    if (!o){ err("Order nahi mila"); return; }
    if (!shopActive()){ err("Local Delivery active nahi hai"); return; }
    const f = {parea:g("dr_parea"),paddr:g("dr_paddr"),darea:g("dr_darea"),daddr:g("dr_daddr"),cname:g("dr_cname"),cphone:g("dr_cphone"),size:g("dr_size"),
      instr:g("dr_instr"),deadline:g("dr_deadline"),pay:g("dr_pay"),amount:parseFloat(g("dr_amount"))};
    if (!f.parea || !f.paddr || !f.darea || !f.daddr || !f.cname) { err("Sabhi * wali jankari bharen"); return; }
    if (!/^[0-9]{10}$/.test(f.cphone)){ err("Customer ka sahi 10-digit mobile likhein"); return; }
    const i = distInfo(); if (!i){ err("Distance calculate karein / manually likhein"); return; }
    const sug = DN.suggestAmount(i.km);
    if (sug==null){ err("Distance delivery slabs se zyada hai"); return; }
    if (!isFinite(f.amount) || f.amount<sug){ err("Amount kam se kam "+DN.money(sug)+" hona chahiye"); return; }
    err("Request ban rahi hai…");
    let step = "counter";
    try{
      const c = await fbdb.ref(B+"counters/delivery").transaction(function(v){ return (Number(v)||1000)+1; });
      if (!c.committed) throw new Error("counter not committed");
      step = "save";
      const id = fbdb.ref(B+"requests/"+D.shopId).push().key;
      const u = buildRequest(o, f, i, {shopId:D.shopId, id:id, code:"DEL-"+c.snapshot.val(), shopName:(STATE.settings&&STATE.settings.shopName)||""});
      await fbdb.ref().update(u);
      toast("Delivery request ban gayi"); openScreen({type:"dnShop"});
    }catch(e){
      try{ console.error("Local Delivery create failed at "+step, e); }catch(x){}
      err("Request nahi bani ("+(step==="counter"?"number generate":"save")+": "+String((e&&(e.code||e.message))||"error").slice(0,60)+") — rules publish / activation / duplicate check karein");
    }
  }

  /* ---------- Cancel ---------- */
  function askCancel(id){
    document.getElementById("toastHost").innerHTML = '<div class="modal-overlay" onclick="DNS.closeModal(event)"><div class="modal-sheet" onclick="event.stopPropagation()">'+
      '<div class="modal-title">Cancel delivery</div>'+selectField("Reason","dc_reason",CANCEL_REASONS,"Shop cancelled")+field("Note (required if reason is Other)","text","dc_note","")+
      '<div class="tiny" id="dc_err" style="color:#dc2626;min-height:14px;"></div>'+
      '<button class="btn primary" onclick="DNS.cancel(\''+esc(id)+'\')">Confirm cancel</button>'+
      '<button class="btn" style="margin-top:8px;background:var(--border);color:var(--text);" onclick="DNS.closeModal()">Back</button></div></div>';
  }
  function closeModal(e){ if (e && e.target!==e.currentTarget) return; document.getElementById("toastHost").innerHTML = ""; }
  async function cancel(id){
    const r = D.reqs[id], reason = g("dc_reason"), note = g("dc_note");
    if (!r || CANCELLABLE.indexOf(r.status)===-1){ setTxt("dc_err","Ab cancel nahi ho sakta"); return; }
    if (S().requireCancelReason && reason==="Other" && !note){ setTxt("dc_err","Note likhein"); return; }
    const base = B+"requests/"+D.shopId+"/"+id+"/", u = {};
    u[base+"status"] = "CANCELLED"; u[base+"cancelReason"] = (note ? reason+": "+note : reason).slice(0,200);
    u[base+"cancelledBy"] = "shop"; u[base+"cancelledAt"] = new Date().toISOString();
    try{ await fbdb.ref().update(u); closeModal(); toast("Delivery cancel ho gayi"); }
    catch(e){ setTxt("dc_err","Cancel nahi hua — ho sakta hai provider assign ho chuka ho"); }
  }

  /* ---------- Customer location pin (order page) ---------- */
  function customerPinHtml(){
    if (!DN.isOn("shopDeliveryEnabled")) return "";
    return '<div class="field"><button type="button" class="btn" style="background:var(--border);color:var(--text);" onclick="DNS.pinMe()">📍 '+(PIN.lat!=null?'Location pinned ✓ (tap to update)':'Pin my delivery location (optional)')+'</button>'+
      '<div class="tiny muted" style="margin-top:4px;">Optional. Shared only with the shop and the delivery provider assigned to your order, to make delivery easier.</div></div>';
  }
  function pinMe(){
    if (!navigator.geolocation){ toast("Location support nahi hai"); return; }
    navigator.geolocation.getCurrentPosition(function(pos){
      PIN = {lat:Math.round(pos.coords.latitude*1e5)/1e5, lng:Math.round(pos.coords.longitude*1e5)/1e5};
      const w = document.getElementById("catalogDeliveryWrap"); if (w && typeof catalogDeliveryOptionHtml==="function") w.innerHTML = catalogDeliveryOptionHtml();
    }, function(){ toast("Location nahi mili"); }, {timeout:10000});
  }
  async function saveCustomerPin(shopId, orderId, deliveryType){
    if (PIN.lat==null || deliveryType!=="delivery" || !orderId) return;
    try{ await fbdb.ref(B+"customerPins/"+shopId+"/"+orderId).set({lat:PIN.lat, lng:PIN.lng, ts:Date.now()}); }catch(e){}
    PIN = {lat:null, lng:null};
  }

  /* ---------- Admin: Delivery Network shops ---------- */
  const host = function(){ return document.getElementById("toastHost"); };
  async function openAdminShops(){
    host().innerHTML = '<div class="modal-overlay"><div class="modal-sheet"><div class="modal-title">🏪 Shops — Local Delivery</div><div class="tiny muted">Loading…</div></div></div>';
    try{
      await DN.loadSettings();
      if ((typeof SA_SHOPS==="undefined" || !SA_SHOPS.length) && typeof loadShopsList==="function") await loadShopsList();
      const r = await Promise.all([withFbTimeout(fbdb.ref(B+"shopSubs").once("value")), withFbTimeout(fbdb.ref(B+"shopActivationRequests").once("value"))]);
      if (r[0].__timedOut || r[1].__timedOut) throw new Error("timeout");
      AD.subs = r[0].val()||{}; AD.acts = r[1].val()||{}; AD.q = "";
      AD.list = (typeof SA_SHOPS!=="undefined" ? SA_SHOPS : []).map(function(s){ return {id:s.id, name:s.shopName||"", mobile:s.mobile||""}; });
      adminRender();
    }catch(e){ host().innerHTML = '<div class="modal-overlay" onclick="DNS.closeModal(event)"><div class="modal-sheet" onclick="event.stopPropagation()"><div class="modal-title">🏪 Shops</div><div class="tiny" style="color:#dc2626;">Load nahi hua — rules publish aur internet check karein.</div><button class="btn" style="margin-top:10px;" onclick="DNS.closeModal()">Close</button></div></div>'; }
  }
  function adminRender(){
    host().innerHTML = '<div class="modal-overlay" onclick="DNS.closeModal(event)"><div class="modal-sheet" onclick="event.stopPropagation()"><div class="modal-title">🏪 Shops — Local Delivery</div>'+
      '<input type="text" placeholder="Search shop / mobile" value="'+esc(AD.q)+'" oninput="DNS.adminSearch(this.value)" style="margin-bottom:10px;"><div id="sa_dn_list">'+adminListHtml()+'</div>'+
      '<button class="btn" style="margin-top:10px;background:var(--border);color:var(--text);" onclick="DN.openAdmin()">← Settings</button>'+
      '<button class="btn" style="margin-top:8px;background:var(--border);color:var(--text);" onclick="DNS.closeModal()">Close</button></div></div>';
  }
  function adminListHtml(){
    const q = AD.q.toLowerCase();
    const rows = AD.list.filter(function(s){ return !q || s.name.toLowerCase().indexOf(q)!==-1 || s.mobile.indexOf(q)!==-1; })
      .sort(function(a,b){ return (AD.acts[b.id]?1:0)-(AD.acts[a.id]?1:0); });
    if (!rows.length) return '<div class="tiny muted">No shops found.</div>';
    return rows.map(function(s){
      const sub = AD.subs[s.id], act = subActive(sub), req = AD.acts[s.id];
      return '<div class="card" style="margin-bottom:8px;padding:10px;"><div style="display:flex;justify-content:space-between;gap:8px;"><b>'+esc(s.name)+'</b>'+
        (req?'<span class="tiny orange" style="font-weight:800;">REQUESTED</span>':'')+'</div><div class="tiny muted">'+esc(s.mobile)+' · '+(act?'Active till '+esc(fmtD(sub.expiryTs)):(sub?'Expired / cancelled':'Not activated'))+'</div>'+
        '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;"><button class="icon-mini-btn" onclick="DNS.adminPaid(\''+esc(s.id)+'\')">💳 Mark paid (+'+esc(S().subscriptionDurationDays)+' days)</button>'+
        (sub?'<button class="icon-mini-btn danger" onclick="DNS.adminCancel(\''+esc(s.id)+'\')">Cancel</button>':'')+'</div></div>';
    }).join('');
  }
  function adminSearch(v){ AD.q = v; const e = document.getElementById("sa_dn_list"); if (e) e.innerHTML = adminListHtml(); }
  function buildShopSub(old, st){
    const now = Date.now(), days = Number(st.subscriptionDurationDays)||30, ext = subActive(old), base = ext ? Number(old.expiryTs) : now;
    return {planId:"default", amount:Number(st.deliveryNetworkShopMonthlyFee)||0, durationDays:days, startTs:ext?Number(old.startTs)||now:now, expiryTs:base+days*DAY,
      status:"active", paymentStatus:"paid", paymentMethod:"manual", updatedAt:new Date().toISOString(), updatedBy:(firebase.auth().currentUser||{}).uid||""};
  }
  async function adminPaid(id){
    const sub = buildShopSub(AD.subs[id], S());
    try{ await fbdb.ref(B+"shopSubs/"+id).set(sub); await fbdb.ref(B+"shopActivationRequests/"+id).remove(); AD.subs[id] = sub; delete AD.acts[id]; adminRender(); toast("Payment recorded — Local Delivery active"); }
    catch(e){ toast("Save fail hua"); }
  }
  async function adminCancel(id){
    const old = AD.subs[id]; if (!old || !confirm("Is shop ki Local Delivery cancel karein?")) return;
    const sub = Object.assign({}, old, {status:"cancelled", expiryTs:Date.now(), updatedAt:new Date().toISOString()});
    try{ await fbdb.ref(B+"shopSubs/"+id).set(sub); AD.subs[id] = sub; adminRender(); toast("Cancelled"); }
    catch(e){ toast("Save fail hua"); }
  }

  return {renderShop, renderNewReq, orderBtn, openNewReq, useShopLoc, recalc, createRequest, askCancel, cancel, closeModal, setFilter, requestActivation,
          customerPinHtml, pinMe, saveCustomerPin, openAdminShops, adminSearch, adminPaid, adminCancel,
          _t:{buildRequest, buildShopSub, groupOf, subActive, D:function(){return D;}}};
})();
