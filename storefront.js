/* MyDukaan App — storefront.js
   Customer storefront extras:
   - Auto-scrolling banner slider (image / video ads + offers) on the public catalog
   - Owner "Ads / Banners" manager (More -> Ads / Banners) + media picker used by Offers
   Optional module: if this file fails to load, core.js falls back to the plain offer banner
   and everything else keeps working. Classic <script>: shares globals with core.js.

   Data: ads live in STATE.settings.storeAds (settings is already publicly readable by the
   catalog, so no new Firebase rule is needed). Offers keep living in STATE.offers and may now
   carry optional mediaType ("image"|"video") + mediaUrl. */
const SF = (function(){
  const MAX_ADS = 10;
  const MAX_VIDEO_MB = 25;
  const S = {draft:{}, timer:null, idx:0, track:null, pausedUntil:0, slides:[]};

  /* ---------------------------------------------------------------- CSS */
  (function injectCss(){
    try{
      const st = document.createElement("style");
      st.id = "sf-css";
      st.textContent =
        '.sf-carousel{position:relative;margin:12px 12px 6px;border-radius:16px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.28);background:#111;}'+
        '.sf-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;}'+
        '.sf-track::-webkit-scrollbar{display:none;}'+
        '.sf-slide{flex:0 0 100%;scroll-snap-align:center;position:relative;aspect-ratio:16/9;overflow:hidden;background:#1e1b4b;color:#fff;cursor:pointer;}'+
        '.sf-slide img,.sf-slide video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}'+
        '.sf-yt-host,.sf-yt-host iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}'+
        '.sf-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-size:20px;pointer-events:none;}'+
        '.sf-over{position:absolute;left:0;right:0;bottom:0;padding:26px 14px 14px;background:linear-gradient(transparent,rgba(0,0,0,.72));pointer-events:none;}'+
        '.sf-title{font-weight:800;font-size:16px;line-height:1.25;text-shadow:0 1px 4px rgba(0,0,0,.5);}'+
        '.sf-sub{font-size:12.5px;margin-top:3px;opacity:.95;}'+
        '.sf-chip{display:inline-block;margin-top:6px;padding:2px 9px;border-radius:999px;background:#facc15;color:#422006;font-weight:800;font-size:12px;margin-right:6px;}'+
        '.sf-chip.code{background:rgba(255,255,255,.22);color:#fff;border:1px dashed rgba(255,255,255,.7);}'+
        '.sf-text{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:18px 20px;background:linear-gradient(120deg,#7c2d12,#b45309);}'+
        '.sf-dots{position:absolute;left:0;right:0;bottom:6px;display:flex;justify-content:center;gap:6px;pointer-events:none;}'+
        '.sf-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.5);transition:all .25s;}'+
        '.sf-dot.on{width:18px;border-radius:4px;background:#fff;}'+
        '.sf-badge{position:absolute;top:8px;left:8px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;pointer-events:none;}'+
        '.sf-hl{animation:sfhl 1.4s ease 1;} @keyframes sfhl{0%,60%{box-shadow:0 0 0 3px var(--primary);}100%{box-shadow:none;}}'+
        '.sf-row{display:flex;gap:10px;align-items:center;border:1px solid var(--border);border-radius:14px;background:var(--card);padding:10px;margin-bottom:10px;}'+
        '.sf-thumb{width:84px;height:52px;border-radius:8px;overflow:hidden;background:#0f172a;flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:center;font-size:20px;}'+
        '.sf-thumb img,.sf-thumb video{width:100%;height:100%;object-fit:cover;}'+
        '.sf-row-main{flex:1;min-width:0;}'+
        '.sf-row-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}'+
        '.sf-preview{width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#0f172a;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px;margin:8px 0;}'+
        '.sf-preview img,.sf-preview video{width:100%;height:100%;object-fit:cover;}'+
        '.sf-status{font-size:12px;margin:4px 0 10px;min-height:16px;font-weight:600;}'+
        '@media (prefers-reduced-motion:reduce){.sf-dot{transition:none;}}';
      document.head.appendChild(st);
    }catch(e){}
  })();

  /* ------------------------------------------------------------ helpers */
  function safeUrl(u){
    u = String(u==null?"":u).trim();
    return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : "";
  }
  function ytId(url){
    const u = safeUrl(url); if (!u) return "";
    let m = u.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/i);
    if (!m) m = u.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/i);
    return m ? m[1] : "";
  }
  function isFileVideo(url){
    const u = safeUrl(url); if (!u) return false;
    return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u) || /res\.cloudinary\.com\/[^/]+\/video\/upload\//i.test(u);
  }
  /* Cloudinary videos: ask for a small, web-friendly rendition (saves customers' data). */
  function videoSrc(url){
    const u = safeUrl(url);
    if (/res\.cloudinary\.com\/[^/]+\/video\/upload\//i.test(u) && u.indexOf("/upload/q_auto")===-1){
      return u.replace("/video/upload/", "/video/upload/q_auto:eco,w_720,c_limit/");
    }
    return u;
  }
  function mediaKind(type, url){
    if (!safeUrl(url)) return "";
    if (type==="video") return ytId(url) ? "yt" : (isFileVideo(url) ? "file" : "");
    if (type==="image") return "img";
    return "";
  }
  function isLive(a){
    if (!a || a.active===false) return false;
    const t = todayStr();
    if (a.startDate && t < a.startDate) return false;
    if (a.endDate && t > a.endDate) return false;
    return true;
  }
  function adsList(){
    if (!STATE || !STATE.settings) return [];
    const v = STATE.settings.storeAds;
    return Array.isArray(v) ? v : [];
  }
  function ensureAds(){
    if (!STATE.settings.storeAds || !Array.isArray(STATE.settings.storeAds)) STATE.settings.storeAds = [];
    return STATE.settings.storeAds;
  }
  function discountLabel(o){
    return (o.discountType && o.discountValue) ? (o.discountType==="percentage" ? (o.discountValue+"% OFF") : (fmt(o.discountValue)+" OFF")) : "";
  }

  /* ============================================================ Customer: slider */
  function buildSlides(data){
    const slides = [];
    ((data && data.storeAds) || []).filter(isLive).forEach(function(a){
      const kind = mediaKind(a.mediaType, a.mediaUrl);
      if (!kind) return;
      slides.push({src:"ad", kind:kind, url:a.mediaUrl, title:a.title||"", sub:a.subtitle||"", chip:"", code:"",
        link:{type:a.linkType||"none", value:a.linkValue||""}});
    });
    const offers = (data && data.offers) || [];
    offers.forEach(function(o){
      const kind = mediaKind(o.mediaType, o.mediaUrl);
      slides.push({src:"offer", kind:kind||"text", url:kind?o.mediaUrl:"", title:o.title||"", sub:o.text||"",
        chip:discountLabel(o), code:o.couponCode||"", link:{type:"none", value:""}});
    });
    if (!offers.length && data && data.offerActive && data.offerTitle){
      slides.push({src:"offer", kind:"text", url:"", title:data.offerTitle, sub:data.offerText||"", chip:"", code:"", link:{type:"none", value:""}});
    }
    return slides;
  }
  function slideHtml(s, i){
    const dur = s.kind==="yt" ? 9000 : (s.kind==="file" ? 8000 : 4500);
    let media = "";
    if (s.kind==="img"){
      media = '<img src="'+esc(safeUrl(s.url))+'" alt="" '+(i===0?'':'loading="lazy"')+'>';
    } else if (s.kind==="file"){
      media = '<video muted playsinline loop preload="'+(i===0?'auto':'metadata')+'"><source src="'+esc(videoSrc(s.url))+'"></video>';
    } else if (s.kind==="yt"){
      const id = ytId(s.url);
      media = '<img src="https://i.ytimg.com/vi/'+id+'/hqdefault.jpg" alt=""><div class="sf-yt-host" data-yt="'+id+'"></div><div class="sf-play">▶</div>';
    } else {
      media = '<div class="sf-text">'+
        '<div class="sf-title" style="font-size:19px;">🎉 '+esc(s.title)+'</div>'+
        (s.sub ? '<div class="sf-sub">'+esc(s.sub)+'</div>' : '')+
        '<div>'+(s.chip?'<span class="sf-chip">'+esc(s.chip)+'</span>':'')+(s.code?'<span class="sf-chip code">'+esc(s.code)+'</span>':'')+'</div></div>';
    }
    let over = "";
    if (s.kind!=="text" && (s.title || s.sub || s.chip || s.code)){
      over = '<div class="sf-over">'+
        (s.title ? '<div class="sf-title">'+esc(s.title)+'</div>' : '')+
        (s.sub ? '<div class="sf-sub">'+esc(s.sub)+'</div>' : '')+
        '<div>'+(s.chip?'<span class="sf-chip">'+esc(s.chip)+'</span>':'')+(s.code?'<span class="sf-chip code">'+esc(s.code)+'</span>':'')+'</div></div>';
    }
    return '<div class="sf-slide" data-i="'+i+'" data-kind="'+s.kind+'" data-dur="'+dur+'" onclick="SF.tap('+i+')">'+
      media+over+(s.src==="ad" ? '<div class="sf-badge">Ad</div>' : '')+'</div>';
  }
  function carouselHtml(data){
    S.slides = buildSlides(data);
    if (!S.slides.length) return '';
    return '<div class="sf-carousel" id="sfCar"><div class="sf-track" id="sfTrack">'+S.slides.map(slideHtml).join('')+'</div>'+
      (S.slides.length>1 ? '<div class="sf-dots" id="sfDots">'+S.slides.map(function(_,i){ return '<span class="sf-dot'+(i===0?' on':'')+'"></span>'; }).join('')+'</div>' : '')+'</div>';
  }
  function reducedMotion(){ try{ return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(e){ return false; } }
  function inView(el){ const r = el.getBoundingClientRect(); return r.bottom>0 && r.top<(window.innerHeight||800); }
  function activate(i){
    const track = S.track; if (!track) return;
    Array.prototype.forEach.call(track.children, function(c, k){
      const on = (k===i);
      const kind = c.getAttribute("data-kind");
      if (kind==="file"){
        const v = c.querySelector("video"); if (!v) return;
        v.muted = true;
        if (on){ try{ const p = v.play(); if (p && p.catch) p.catch(function(){}); }catch(e){} } else { try{ v.pause(); }catch(e){} }
      } else if (kind==="yt"){
        const host = c.querySelector(".sf-yt-host"); if (!host) return;
        const play = c.querySelector(".sf-play");
        if (on && !host.firstChild){
          const id = host.getAttribute("data-yt");
          host.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1&mute=1&controls=0&loop=1&playlist='+id+'&playsinline=1&modestbranding=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
          if (play) play.style.display = "none";
        } else if (!on && host.firstChild){
          host.innerHTML = ""; if (play) play.style.display = "";
        }
      }
    });
  }
  function updateDots(){
    const d = document.getElementById("sfDots"); if (!d) return;
    Array.prototype.forEach.call(d.children, function(el, k){ el.className = "sf-dot"+(k===S.idx?" on":""); });
  }
  function goTo(i){
    const track = S.track; if (!track) return;
    S.idx = i; activate(i); updateDots();
    try{ track.scrollTo({left:i*track.clientWidth, behavior:"smooth"}); }catch(e){ track.scrollLeft = i*track.clientWidth; }
  }
  function schedule(){
    clearTimeout(S.timer);
    const cur = S.track && S.track.children[S.idx];
    const dur = cur ? (Number(cur.getAttribute("data-dur"))||4500) : 4500;
    S.timer = setTimeout(tick, dur);
  }
  function tick(){
    const track = document.getElementById("sfTrack");
    if (!track || track!==S.track) return;               /* catalog re-rendered / left: stop */
    if (document.hidden || Date.now()<S.pausedUntil || reducedMotion() || !inView(track)){ S.timer = setTimeout(tick, 1000); return; }
    goTo((S.idx+1) % track.children.length);
    schedule();
  }
  function onScroll(){
    const track = S.track; if (!track || !track.clientWidth) return;
    const i = Math.round(track.scrollLeft/track.clientWidth);
    if (i!==S.idx && i>=0 && i<track.children.length){ S.idx = i; activate(i); updateDots(); schedule(); }
  }
  function stop(){ clearTimeout(S.timer); S.timer = null; S.track = null; }
  function afterRender(){
    stop();
    const track = document.getElementById("sfTrack");
    if (!track) return;
    S.track = track; S.idx = 0; S.pausedUntil = 0;
    activate(0);
    if (track.children.length<2) return;
    track.addEventListener("scroll", onScroll, {passive:true});
    ["pointerdown","touchstart","mouseenter"].forEach(function(ev){
      track.addEventListener(ev, function(){ S.pausedUntil = Date.now()+8000; }, {passive:true});
    });
    schedule();
  }
  function tap(i){
    const s = S.slides[i]; if (!s) return;
    S.pausedUntil = Date.now()+8000;
    const l = s.link || {};
    if (l.type==="url"){ const u = safeUrl(l.value); if (u) window.open(u, "_blank", "noopener"); }
    else if (l.type==="product" && l.value) goProduct(l.value);
    else if (l.type==="category" && l.value) goCategory(l.value);
  }
  function scrollToGrid(){ const w = document.getElementById("catalogFilterGridWrap"); if (w){ try{ w.scrollIntoView({behavior:"smooth", block:"start"}); }catch(e){} } }
  function goCategory(c){
    if (typeof DRAFT!=="undefined"){ if (!DRAFT.catalogFilter) DRAFT.catalogFilter = {category:"All", prevOnly:false, search:""}; DRAFT.catalogFilter.prevOnly = false; DRAFT.catalogFilter.search = ""; }
    setCatalogCategory(c);
    const inp = document.getElementById("catSearch"); if (inp) inp.value = "";
    scrollToGrid();
  }
  function goProduct(pid){
    if (typeof DRAFT!=="undefined"){ if (!DRAFT.catalogFilter) DRAFT.catalogFilter = {category:"All", prevOnly:false, search:""}; DRAFT.catalogFilter.category = "All"; DRAFT.catalogFilter.prevOnly = false; DRAFT.catalogFilter.search = ""; }
    softRenderCatalogGrid();
    const inp = document.getElementById("catSearch"); if (inp) inp.value = "";
    setTimeout(function(){
      const el = document.getElementById("catcard_"+pid);
      if (el){ try{ el.scrollIntoView({behavior:"smooth", block:"center"}); }catch(e){} el.classList.add("sf-hl"); setTimeout(function(){ el.classList.remove("sf-hl"); }, 1600); }
    }, 60);
  }

  /* ============================================================ Owner: media picker */
  function previewHtml(d){
    if (d.uploading) return '⏳ Upload ho raha hai…';
    if (!d.url) return d.type==="video" ? '🎬 Video abhi select nahi hua' : (d.type==="image" ? '🖼️ Photo abhi select nahi hui' : 'Koi media nahi');
    if (d.type==="image") return '<img src="'+esc(safeUrl(d.url))+'" alt="">';
    const y = ytId(d.url);
    if (y) return '<img src="https://i.ytimg.com/vi/'+y+'/hqdefault.jpg" alt="">';
    if (isFileVideo(d.url)) return '<video src="'+esc(videoSrc(d.url))+'" muted playsinline controls preload="metadata"></video>';
    return '⚠️ Ye link YouTube ya .mp4 video ka nahi lag raha';
  }
  function pickerInner(pfx){
    const d = S.draft[pfx];
    let h = '';
    if (d.type==="image"){
      h += '<input type="file" accept="image/*" id="'+pfx+'_mfile" style="display:none;" onchange="SF.pickFile(\''+pfx+'\',this)">'+
        '<button class="btn primary" style="width:auto;padding:0 14px;" onclick="document.getElementById(\''+pfx+'_mfile\').click()">🖼️ Photo chunein</button>';
    } else if (d.type==="video"){
      h += '<input type="file" accept="video/*" id="'+pfx+'_mfile" style="display:none;" onchange="SF.pickFile(\''+pfx+'\',this)">'+
        '<button class="btn primary" style="width:auto;padding:0 14px;margin-bottom:10px;" onclick="document.getElementById(\''+pfx+'_mfile\').click()">🎬 Video upload karein (max '+MAX_VIDEO_MB+'MB)</button>'+
        '<div class="field"><label class="field-label">Ya video ka link (YouTube / .mp4 https link)</label>'+
        '<input type="text" id="'+pfx+'_murl" value="'+esc(d.url && !d.uploaded ? d.url : '')+'" placeholder="https://youtu.be/..." oninput="SF.pickUrl(\''+pfx+'\',this.value)"></div>';
    }
    if (d.type!=="none") h += '<div class="sf-preview" id="'+pfx+'_mprev">'+previewHtml(d)+'</div><div class="sf-status" id="'+pfx+'_mstat"></div>';
    return h;
  }
  function pickerHtml(pfx, cur, allowNone){
    const t = cur && (cur.mediaType==="image" || cur.mediaType==="video") ? cur.mediaType : (allowNone ? "none" : "image");
    S.draft[pfx] = {type:t, url:(cur && cur.mediaUrl) || "", uploading:false, uploaded:false, allowNone:!!allowNone};
    return '<div class="field"><label class="field-label">'+(allowNone?'Banner media (optional)':'Media')+'</label>'+
      '<select id="'+pfx+'_mtype" onchange="SF.pickType(\''+pfx+'\')">'+
      (allowNone?'<option value="none"'+(t==="none"?' selected':'')+'>Koi nahi (sirf text)</option>':'')+
      '<option value="image"'+(t==="image"?' selected':'')+'>🖼️ Image</option>'+
      '<option value="video"'+(t==="video"?' selected':'')+'>🎬 Video</option>'+
      '</select></div><div id="'+pfx+'_mwrap">'+pickerInner(pfx)+'</div>';
  }
  function repaintPicker(pfx){ const w = document.getElementById(pfx+"_mwrap"); if (w) w.innerHTML = pickerInner(pfx); }
  function pickType(pfx){
    const d = S.draft[pfx]; if (!d || d.uploading) return;
    const v = document.getElementById(pfx+"_mtype").value;
    d.type = v; d.url = ""; d.uploaded = false;
    repaintPicker(pfx);
  }
  function pickUrl(pfx, v){
    const d = S.draft[pfx]; if (!d) return;
    d.url = String(v||"").trim(); d.uploaded = false;
    const p = document.getElementById(pfx+"_mprev"); if (p) p.innerHTML = previewHtml(d);
    const st = document.getElementById(pfx+"_mstat");
    if (st) st.textContent = "";
  }
  function setStatus(pfx, msg, bad){
    const st = document.getElementById(pfx+"_mstat");
    if (st){ st.textContent = msg||""; st.style.color = bad ? "#dc2626" : "var(--muted)"; }
  }
  function uploadVideo(file, onProgress){
    return new Promise(function(resolve, reject){
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
      fd.append("folder", "mydukaan/ads");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "https://api.cloudinary.com/v1_1/"+CLOUDINARY_CLOUD_NAME+"/video/upload");
      xhr.upload.onprogress = function(e){ if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded*100/e.total)); };
      xhr.onload = function(){
        let data = null; try{ data = JSON.parse(xhr.responseText); }catch(e){}
        if (xhr.status>=200 && xhr.status<300 && data && data.secure_url) resolve(data.secure_url);
        else reject(new Error((data && data.error && data.error.message) || ("HTTP "+xhr.status)));
      };
      xhr.onerror = function(){ reject(new Error("Network error")); };
      xhr.send(fd);
    });
  }
  async function pickFile(pfx, input){
    const d = S.draft[pfx]; const file = input && input.files && input.files[0];
    if (!d || !file) return;
    if (d.uploading) return;
    if (d.type==="image" && !/^image\//.test(file.type)){ setStatus(pfx, "Sirf image file chunein", true); return; }
    if (d.type==="video" && !/^video\//.test(file.type)){ setStatus(pfx, "Sirf video file chunein", true); return; }
    if (d.type==="video" && file.size > MAX_VIDEO_MB*1024*1024){ setStatus(pfx, "Video "+MAX_VIDEO_MB+"MB se chhota hona chahiye (ya YouTube link use karein)", true); return; }
    d.uploading = true;
    const p = document.getElementById(pfx+"_mprev"); if (p) p.innerHTML = previewHtml(d);
    try{
      let url;
      if (d.type==="image"){
        setStatus(pfx, "Image upload ho rahi hai…");
        const blob = await fileToCompressedBlob(file, 1280, 0.8);
        url = await uploadImageToStorage(blob, "mydukaan/ads");        /* no base64 fallback: ads sit in public settings */
      } else {
        setStatus(pfx, "Video upload ho raha hai… 0%");
        url = await uploadVideo(file, function(pc){ setStatus(pfx, "Video upload ho raha hai… "+pc+"%"); });
      }
      d.url = url; d.uploaded = true;
      setStatus(pfx, "✅ Upload ho gaya");
    }catch(e){
      setStatus(pfx, "Upload nahi hua"+(e && e.message ? (" ("+e.message+")") : "")+(d.type==="video" ? " — YouTube/.mp4 link use kar sakte hain" : " — dobara try karein"), true);
    }
    d.uploading = false;
    const p2 = document.getElementById(pfx+"_mprev"); if (p2) p2.innerHTML = previewHtml(d);
    try{ input.value = ""; }catch(e){}
  }
  /* Returns {ok, mediaType, mediaUrl, error} for a picker. */
  function readPicker(pfx){
    const d = S.draft[pfx] || {type:"none", url:""};
    if (d.uploading) return {ok:false, error:"Upload poora hone tak ruko"};
    if (d.type==="none") return {ok:true, mediaType:"", mediaUrl:""};
    if (!d.url) return {ok:false, error:d.type==="video" ? "Video upload karein ya link daalein" : "Photo chunein"};
    if (!safeUrl(d.url)) return {ok:false, error:"Link https:// se shuru hona chahiye"};
    if (d.type==="video" && !mediaKind("video", d.url)) return {ok:false, error:"Video link YouTube ya .mp4 ka hona chahiye"};
    return {ok:true, mediaType:d.type, mediaUrl:d.url};
  }

  /* ============================================================ Owner: Ads manager */
  function thumbHtml(a){
    const k = mediaKind(a.mediaType, a.mediaUrl);
    if (k==="img") return '<img src="'+esc(safeUrl(a.mediaUrl))+'" alt="">';
    if (k==="yt") return '<img src="https://i.ytimg.com/vi/'+ytId(a.mediaUrl)+'/hqdefault.jpg" alt="">';
    if (k==="file") return '🎬';
    return '⚠️';
  }
  function renderAdsList(){
    const list = adsList();
    let h = header("Ads / Banners", {onBack:"closeScreen('more')",
      rightHtml: list.length<MAX_ADS ? '<button class="icon-btn solid" onclick="SF.openAdForm()">+</button>' : ''});
    h += '<div class="content">';
    h += '<div class="tiny muted" style="margin-bottom:12px;line-height:1.45;">Yahan banaye hue image/video ads customer ke order page ke top par <b>apne aap scroll</b> hote hain (Offers bhi usi slider me dikhte hain). Max '+MAX_ADS+' ads.</div>';
    if (list.length===0){
      h += '<div class="empty">Abhi koi ad nahi hai.<div style="margin-top:14px;"><button class="btn primary" onclick="SF.openAdForm()">+ Pehla Ad Banayein</button></div></div>';
    } else {
      h += list.map(function(a, i){
        const live = isLive(a);
        const dates = (a.startDate||a.endDate) ? (esc(a.startDate||"—")+" → "+esc(a.endDate||"—")) : "";
        return '<div class="sf-row"><div class="sf-thumb">'+thumbHtml(a)+'</div><div class="sf-row-main">'+
          '<div class="row-name">'+esc(a.title||"(bina title)")+'</div>'+
          '<div class="row-sub">'+(a.mediaType==="video"?'🎬 Video':'🖼️ Image')+(dates?(' · '+dates):'')+'</div>'+
          '<div class="tiny" style="font-weight:700;color:'+(live?"#16a34a":"#94a3b8")+';">'+(live?"LIVE":"Off / Expired")+'</div>'+
          '<div class="sf-row-actions">'+
          '<button class="icon-mini-btn" '+(i===0?'disabled':'')+' onclick="SF.move('+i+',-1)">⬆️</button>'+
          '<button class="icon-mini-btn" '+(i===list.length-1?'disabled':'')+' onclick="SF.move('+i+',1)">⬇️</button>'+
          '<button class="icon-mini-btn" onclick="SF.openAdForm(\''+a.id+'\')">✏️ Edit</button>'+
          '<button class="icon-mini-btn" onclick="SF.toggle(\''+a.id+'\')">'+(a.active===false?'▶️ On':'⏸️ Off')+'</button>'+
          '<button class="icon-mini-btn danger" onclick="SF.remove(\''+a.id+'\')">🗑️</button>'+
          '</div></div></div>';
      }).join('');
    }
    h += '</div>';
    return h;
  }
  function openAdForm(id){
    if (!id && adsList().length>=MAX_ADS){ toast("Max "+MAX_ADS+" ads hi bana sakte hain"); return; }
    DRAFT.sfAdEditId = id || null;
    openScreen({type:"sfAdForm"});
  }
  function linkValueHtml(a){
    const lt = (a && a.linkType) || "none", lv = (a && a.linkValue) || "";
    const prods = (STATE.products||[]);
    const cats = Array.from(new Set(prods.map(function(p){ return p.category; }).filter(Boolean)));
    return '<div id="sf_lv_product" style="display:'+(lt==="product"?'block':'none')+';"><div class="field"><label class="field-label">Product chunein</label><select id="sf_lvp">'+
      prods.map(function(p){ return '<option value="'+esc(p.id)+'"'+(lt==="product" && lv===p.id?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('')+'</select></div></div>'+
      '<div id="sf_lv_category" style="display:'+(lt==="category"?'block':'none')+';"><div class="field"><label class="field-label">Category chunein</label><select id="sf_lvc">'+
      cats.map(function(c){ return '<option value="'+esc(c)+'"'+(lt==="category" && lv===c?' selected':'')+'>'+esc(c)+'</option>'; }).join('')+'</select></div></div>'+
      '<div id="sf_lv_url" style="display:'+(lt==="url"?'block':'none')+';"><div class="field"><label class="field-label">Website link (https://)</label><input type="text" id="sf_lvu" value="'+esc(lt==="url"?lv:"")+'" placeholder="https://..."></div></div>';
  }
  function linkTypeChanged(){
    const v = document.getElementById("sf_linkType").value;
    ["product","category","url"].forEach(function(k){ const el = document.getElementById("sf_lv_"+k); if (el) el.style.display = (k===v?"block":"none"); });
  }
  function renderAdForm(){
    const id = DRAFT.sfAdEditId;
    const a = id ? adsList().find(function(x){ return x.id===id; }) : null;
    let h = header(a ? "Edit Ad" : "Naya Ad", {onBack:"openScreen({type:'sfAds'})"});
    h += '<div class="content">';
    h += pickerHtml("sf", a, false);
    h += field("Title (optional)","text","sf_title", a ? (a.title||"") : "");
    h += field("Chhota text (optional)","text","sf_sub", a ? (a.subtitle||"") : "");
    h += '<div class="field"><label class="field-label">Ad par tap karne par kya ho?</label><select id="sf_linkType" onchange="SF.linkTypeChanged()">'+
      [["none","Kuch nahi"],["product","Ek product dikhao"],["category","Ek category dikhao"],["url","Website link kholo"]].map(function(o){
        return '<option value="'+o[0]+'"'+(((a&&a.linkType)||"none")===o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join('')+'</select></div>';
    h += linkValueHtml(a);
    h += '<div class="grid2">'+field("Start Date","date","sf_start", a ? (a.startDate||"") : "")+field("End Date","date","sf_end", a ? (a.endDate||"") : "")+'</div>';
    h += '<button class="btn primary" onclick="SF.saveAd()">'+(a?"Update Ad":"Save Ad")+'</button>';
    if (a) h += '<button class="btn" style="background:#fef2f2;color:#dc2626;margin-top:10px;" onclick="SF.remove(\''+a.id+'\',true)">🗑️ Delete Ad</button>';
    h += '</div>';
    return h;
  }
  function saveAd(){
    const m = readPicker("sf");
    if (!m.ok){ toast(m.error); return; }
    const lt = document.getElementById("sf_linkType").value;
    let lv = "";
    if (lt==="product") lv = (document.getElementById("sf_lvp")||{}).value || "";
    else if (lt==="category") lv = (document.getElementById("sf_lvc")||{}).value || "";
    else if (lt==="url"){ lv = safeUrl((document.getElementById("sf_lvu")||{}).value); if (!lv){ toast("Website link https:// se shuru hona chahiye"); return; } }
    if ((lt==="product" || lt==="category") && !lv){ toast("Link ke liye option chunein"); return; }
    const start = document.getElementById("sf_start").value.trim(), end = document.getElementById("sf_end").value.trim();
    if (start && end && end < start){ toast("End date start date se pehle nahi ho sakti"); return; }
    const arr = ensureAds();
    const id = DRAFT.sfAdEditId;
    const data = {mediaType:m.mediaType, mediaUrl:m.mediaUrl, title:document.getElementById("sf_title").value.trim(),
      subtitle:document.getElementById("sf_sub").value.trim(), linkType:lt, linkValue:lv, startDate:start, endDate:end};
    if (id){
      const a = arr.find(function(x){ return x.id===id; });
      if (a) Object.assign(a, data);
      toast("Ad updated");
    } else {
      if (arr.length>=MAX_ADS){ toast("Max "+MAX_ADS+" ads hi bana sakte hain"); return; }
      arr.push(Object.assign({id:uid(), active:true, createdAt:new Date().toISOString()}, data));
      toast("Ad add ho gaya");
    }
    persist();
    DRAFT.sfAdEditId = null;
    openScreen({type:"sfAds"});
  }
  function move(i, dir){
    const arr = ensureAds(); const j = i+dir;
    if (j<0 || j>=arr.length) return;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    persist(); render();
  }
  function toggle(id){
    const a = adsList().find(function(x){ return x.id===id; });
    if (!a) return;
    a.active = (a.active===false);
    persist(); render();
  }
  function remove(id, fromForm){
    const a = adsList().find(function(x){ return x.id===id; });
    if (!a) return;
    if (!confirm('"'+(a.title||"Ye ad")+'" delete karein?')) return;
    STATE.settings.storeAds = adsList().filter(function(x){ return x.id!==id; });
    persist(); toast("Ad deleted");
    openScreen({type:"sfAds"});
  }
  function renderScreen(s){
    if (s.type==="sfAdForm") return renderAdForm();
    return renderAdsList();
  }

  return {carouselHtml:carouselHtml, afterRender:afterRender, stop:stop, tap:tap,
          pickerHtml:pickerHtml, readPicker:readPicker, pickType:pickType, pickUrl:pickUrl, pickFile:pickFile,
          renderScreen:renderScreen, openAdForm:openAdForm, saveAd:saveAd, move:move, toggle:toggle, remove:remove,
          linkTypeChanged:linkTypeChanged,
          _S:S, _util:{ytId:ytId, safeUrl:safeUrl, isFileVideo:isFileVideo, mediaKind:mediaKind, videoSrc:videoSrc, isLive:isLive, buildSlides:buildSlides}};
})();
