/* =================================================================
   LIFTED STATES — app.js
   Local-only cannabis observation instrument.

   Storage compatibility:
   - Reuses original storage keys from StoneyVibes v1 so any prior
     data on the device is preserved transparently.
   - localStorage key:  sv_stash_v1   (stash items, photos stripped)
   - IndexedDB:         stoneyvibes_db_v1
                          - object store "sessions"  (keyPath: id)
                          - object store "stashPhotos" (keyPath: id)
   ================================================================= */

(function(){
  "use strict";

  /* ---------- Storage constants (kept identical to original) ---------- */
  const STASH_KEY        = "sv_stash_v1";
  const STASH_ORDER_KEY  = "sv_stash_order_mode_v1";
  const DB_NAME          = "stoneyvibes_db_v1";
  const DB_VERSION       = 2;
  const SESSION_STORE    = "sessions";
  const STASH_PHOTO_STORE = "stashPhotos";

  /* ---------- Photo compression ---------- */
  const PHOTO_MAX_DIM = 1280;
  const PHOTO_QUALITY = 0.82;
  const STASH_PHOTO_MAX_DIM = 960;
  const STASH_PHOTO_QUALITY = 0.72;
  const STASH_PHOTO_TARGET_BYTES = 160 * 1024;

  /* ===============================================================
     UTILITIES
     =============================================================== */

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(s){
    return String(s == null ? "" : s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function uid(prefix){
    return (prefix || "id") + "_" + Math.random().toString(16).slice(2,10) + "_" + Date.now().toString(36);
  }

  function fmtTime(ts){
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      });
    } catch { return "—"; }
  }

  function fmtDate(ts){
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric"
      });
    } catch { return "—"; }
  }

  function todayGreeting(){
    const h = new Date().getHours();
    if (h < 5)  return "Late hours.";
    if (h < 12) return "Good morning.";
    if (h < 17) return "Good afternoon.";
    if (h < 21) return "Good evening.";
    return "Late hours.";
  }

  /* ---- Toast ---- */
  const toastEl = $("#toast");
  let toastTimer = null;
  function toast(msg, kind){
    toastEl.textContent = msg;
    toastEl.className = "toast is-visible" + (kind ? " toast--" + kind : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 2400);
  }

  /* ---- Image compression ---- */
  function readFileAsDataUrl(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error || new Error("read failed"));
      r.readAsDataURL(file);
    });
  }
  function loadImg(src){
    return new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode failed"));
      i.src = src;
    });
  }
  function approxBytes(dataUrl){
    const s = String(dataUrl || "");
    const c = s.indexOf(",");
    const b = c >= 0 ? s.slice(c+1) : s;
    const pad = b.endsWith("==") ? 2 : (b.endsWith("=") ? 1 : 0);
    return Math.max(0, Math.floor(b.length * 3 / 4) - pad);
  }
  async function compressImageFile(file, opts){
    if (!file) return "";
    opts = opts || {};
    const url = await readFileAsDataUrl(file);
    const img = await loadImg(url);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) return url;
    const maxDim = opts.maxDim || PHOTO_MAX_DIM;
    let q = opts.quality || PHOTO_QUALITY;
    const targetBytes = opts.targetBytes || 0;
    const minQ = 0.46;
    const minDim = 380;
    let scale = Math.min(1, maxDim / Math.max(w,h));
    let tw = Math.max(1, Math.round(w*scale));
    let th = Math.max(1, Math.round(h*scale));
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d", { alpha: false });
    if (!ctx) return url;
    let best = url;
    for (let attempt = 0; attempt < 8; attempt++){
      cv.width = tw; cv.height = th;
      ctx.clearRect(0,0,tw,th);
      ctx.drawImage(img, 0, 0, tw, th);
      const out = cv.toDataURL("image/jpeg", q);
      if (out && approxBytes(out) < approxBytes(best)) best = out;
      if (!targetBytes || approxBytes(best) <= targetBytes) return best;
      if (q > minQ + 0.02) { q = Math.max(minQ, q - 0.08); }
      else {
        const longest = Math.max(tw, th);
        if (longest <= minDim) break;
        const shrink = longest > 900 ? 0.84 : 0.9;
        tw = Math.max(1, Math.round(tw * shrink));
        th = Math.max(1, Math.round(th * shrink));
      }
    }
    return best;
  }

  /* ===============================================================
     INDEXEDDB
     =============================================================== */

  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SESSION_STORE)){
          const s = db.createObjectStore(SESSION_STORE, { keyPath: "id" });
          s.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(STASH_PHOTO_STORE)){
          db.createObjectStore(STASH_PHOTO_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror  = () => reject(req.error);
    });
  }
  async function dbAllSessions(){
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(SESSION_STORE, "readonly");
      const idx = tx.objectStore(SESSION_STORE).index("createdAt");
      const r = idx.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  }
  async function dbPutSession(s){
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(SESSION_STORE, "readwrite");
      tx.objectStore(SESSION_STORE).put(s);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function dbDeleteSession(id){
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(SESSION_STORE, "readwrite");
      tx.objectStore(SESSION_STORE).delete(id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function dbClearSessions(){
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(SESSION_STORE, "readwrite");
      tx.objectStore(SESSION_STORE).clear();
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function dbPutStashPhoto(id, dataUrl){
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STASH_PHOTO_STORE, "readwrite");
      tx.objectStore(STASH_PHOTO_STORE).put({ id: String(id), dataUrl: String(dataUrl || "") });
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function dbAllStashPhotos(){
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STASH_PHOTO_STORE, "readonly");
      const r = tx.objectStore(STASH_PHOTO_STORE).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  }
  async function dbDeleteStashPhoto(id){
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STASH_PHOTO_STORE, "readwrite");
      tx.objectStore(STASH_PHOTO_STORE).delete(String(id));
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function dbClearStashPhotos(){
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STASH_PHOTO_STORE, "readwrite");
      tx.objectStore(STASH_PHOTO_STORE).clear();
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }

  /* ===============================================================
     STASH (localStorage) + STASH PHOTO CACHE
     =============================================================== */

  const stashPhotoCache = new Map();

  function loadStash(){
    try {
      const raw = localStorage.getItem(STASH_KEY) || "[]";
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(normalizeStashItem) : [];
    } catch { return []; }
  }
  function saveStash(items){
    try {
      // Photos are stored in IDB, not in localStorage. Strip any dataURL.
      const slim = items.map(it => {
        const c = Object.assign({}, it);
        delete c.photoDataUrl;
        return c;
      });
      localStorage.setItem(STASH_KEY, JSON.stringify(slim));
    } catch (e){
      toast("Storage full. Try removing photos.", "err");
    }
  }
  function normalizeStashItem(it){
    return {
      id: it.id || uid("stash"),
      name: String(it.name || "").trim(),
      category: String(it.category || "FLOWER").toUpperCase(),
      status: (it.status || "CURRENT").toUpperCase() === "SAMPLED" ? "SAMPLED" : "CURRENT",
      notes: String(it.notes || "").trim(),
      visual: Array.isArray(it.visual) ? it.visual : [],
      createdAt: it.createdAt || Date.now(),
      sortOrder: typeof it.sortOrder === "number" ? it.sortOrder : Date.now()
    };
  }
  async function loadStashPhotosIntoCache(){
    try {
      const rows = await dbAllStashPhotos();
      stashPhotoCache.clear();
      for (const r of rows) stashPhotoCache.set(String(r.id), r.dataUrl || "");
    } catch {}
  }

  /* ===============================================================
     NAV — bottom tabs + horizontal swipe
     =============================================================== */

  const pagesEl = $("#pages");
  const pageEls = $$(".page", pagesEl);
  const navBtns = $$(".bottomnav__btn");
  const pageIndex = {
    home: 0, stash: 1, log: 2, ask: 3, settings: 4
  };

  function setActiveNav(name){
    navBtns.forEach(b => b.classList.toggle("is-active", b.dataset.nav === name));
  }

  function goTo(name){
    const idx = pageIndex[name];
    if (idx == null) return;
    pagesEl.scrollTo({ left: idx * pagesEl.clientWidth, behavior: "smooth" });
    setActiveNav(name);
  }

  navBtns.forEach(b => {
    b.addEventListener("click", () => goTo(b.dataset.nav));
  });

  // Sync nav with horizontal scroll
  let scrollSyncTimer = null;
  pagesEl.addEventListener("scroll", () => {
    if (scrollSyncTimer) cancelAnimationFrame(scrollSyncTimer);
    scrollSyncTimer = requestAnimationFrame(() => {
      const idx = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
      const name = Object.keys(pageIndex).find(k => pageIndex[k] === idx);
      if (name) setActiveNav(name);
    });
  });

  // On resize, keep the active page in view
  window.addEventListener("resize", () => {
    const active = navBtns.find(b => b.classList.contains("is-active"));
    if (active) {
      const idx = pageIndex[active.dataset.nav];
      pagesEl.scrollLeft = idx * pagesEl.clientWidth;
    }
  });

  /* ===============================================================
     STASH UI
     =============================================================== */

  const stashNameEl       = $("#stashName");
  const stashCategoryEl   = $("#stashCategory");
  const stashStatusEl     = $("#stashStatus");
  const stashNotesEl      = $("#stashNotes");
  const stashListEl       = $("#stashList");
  const addStashBtn       = $("#addStashBtn");
  const stashFormReset    = $("#stashFormReset");
  const stashPhotoCamera  = $("#stashPhotoCameraInput");
  const stashPhotoLib     = $("#stashPhotoLibraryInput");
  const stashPhotoClear   = $("#stashPhotoClear");
  const stashPhotoThumb   = $("#stashPhotoThumb");
  const stashPhotoDataUrl = $("#stashPhotoDataUrl");
  const stashVisualChips  = $$("#stashVisualChips .chip");
  const stashOrderManual  = $("#stashOrderManualBtn");
  const stashOrderSmart   = $("#stashOrderSmartBtn");
  const stashDetailEl     = $("#stashDetail");
  const stashDetailBody   = $("#stashDetailBody");
  const stashDetailBack   = $("#stashDetailBackBtn");

  let stashVisualSet = new Set();
  let currentStashId = "";

  function getStashOrderMode(){
    try {
      const m = String(localStorage.getItem(STASH_ORDER_KEY) || "MANUAL").toUpperCase();
      return m === "SMART" ? "SMART" : "MANUAL";
    } catch { return "MANUAL"; }
  }
  function setStashOrderMode(m){
    try { localStorage.setItem(STASH_ORDER_KEY, m === "SMART" ? "SMART" : "MANUAL"); } catch {}
    renderStashOrderControls();
    renderStashList();
  }
  function renderStashOrderControls(){
    const m = getStashOrderMode();
    stashOrderManual.classList.toggle("is-active", m === "MANUAL");
    stashOrderSmart.classList.toggle("is-active", m === "SMART");
  }
  stashOrderManual.addEventListener("click", () => setStashOrderMode("MANUAL"));
  stashOrderSmart.addEventListener("click", () => setStashOrderMode("SMART"));

  function categoryLabel(c){
    switch (String(c||"").toUpperCase()){
      case "FLOWER": return "Flower";
      case "VAPE": return "Vape";
      case "EDIBLE": return "Edible";
      case "CONCENTRATE": return "Concentrate";
      default: return "Other";
    }
  }

  function renderStashList(){
    const items = loadStash();
    if (!items.length){
      stashListEl.innerHTML = '<div class="empty">No stash items yet. Add one above to begin.</div>';
      return;
    }

    const mode = getStashOrderMode();

    // For smart mode, we'd score by recent positive sessions. For now we sort by status (current first), then created.
    let sorted;
    if (mode === "SMART"){
      // load sessions to compute simple smart-score; but we'll just sort by createdAt desc with CURRENT first
      sorted = items.slice().sort((a,b) => {
        if (a.status !== b.status) return a.status === "CURRENT" ? -1 : 1;
        return (b.createdAt||0) - (a.createdAt||0);
      });
    } else {
      sorted = items.slice().sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0) || (b.createdAt||0)-(a.createdAt||0));
    }

    stashListEl.innerHTML = sorted.map(it => {
      const photo = stashPhotoCache.get(String(it.id)) || "";
      const thumb = photo
        ? `<img src="${escapeHtml(photo)}" alt="">`
        : `${categoryLabel(it.category).slice(0,2).toUpperCase()}`;
      const badge = it.status === "SAMPLED" ? "sampled" : "in stash";
      return `
        <div class="stash-item" data-stash-id="${escapeHtml(it.id)}">
          <div class="stash-item__thumb">${thumb}</div>
          <div class="stash-item__main">
            <div class="stash-item__name">${escapeHtml(it.name || "Unknown")}</div>
            <div class="stash-item__meta">${escapeHtml(categoryLabel(it.category))}${it.notes ? " · " + escapeHtml(it.notes) : ""}</div>
          </div>
          <span class="stash-item__badge ${it.status === "SAMPLED" ? "stash-item__badge--sampled" : ""}">${badge}</span>
        </div>
      `;
    }).join("");

    $$("[data-stash-id]", stashListEl).forEach(el => {
      el.addEventListener("click", () => openStashDetail(el.dataset.stashId));
    });
  }

  function renderStashVisualChips(){
    stashVisualChips.forEach(c => {
      c.classList.toggle("is-active", stashVisualSet.has(c.dataset.stashVisual));
    });
  }
  stashVisualChips.forEach(c => {
    c.addEventListener("click", () => {
      const v = c.dataset.stashVisual;
      if (stashVisualSet.has(v)) stashVisualSet.delete(v);
      else stashVisualSet.add(v);
      renderStashVisualChips();
    });
  });

  function resetStashForm(){
    stashNameEl.value = "";
    stashCategoryEl.value = "FLOWER";
    stashStatusEl.value = "CURRENT";
    stashNotesEl.value = "";
    stashVisualSet.clear();
    renderStashVisualChips();
    stashPhotoDataUrl.value = "";
    stashPhotoThumb.removeAttribute("src");
  }
  stashFormReset.addEventListener("click", resetStashForm);

  /* ---- photo handlers ---- */
  async function handleStashPhotoFile(file){
    if (!file) return;
    try {
      toast("Processing photo…");
      const dataUrl = await compressImageFile(file, {
        maxDim: STASH_PHOTO_MAX_DIM,
        quality: STASH_PHOTO_QUALITY,
        targetBytes: STASH_PHOTO_TARGET_BYTES
      });
      stashPhotoDataUrl.value = dataUrl;
      stashPhotoThumb.src = dataUrl;
      toast("Photo ready.", "ok");
    } catch (e){
      console.error(e);
      toast("Photo failed.", "err");
    }
  }
  stashPhotoCamera.addEventListener("change", e => handleStashPhotoFile(e.target.files && e.target.files[0]));
  stashPhotoLib.addEventListener("change", e => handleStashPhotoFile(e.target.files && e.target.files[0]));
  stashPhotoClear.addEventListener("click", () => {
    stashPhotoDataUrl.value = "";
    stashPhotoThumb.removeAttribute("src");
  });

  /* ---- add stash ---- */
  addStashBtn.addEventListener("click", async () => {
    const name = stashNameEl.value.trim();
    const items = loadStash();
    const item = normalizeStashItem({
      id: uid("stash"),
      name: name || autoUnknownName(items),
      category: stashCategoryEl.value,
      status: stashStatusEl.value,
      notes: stashNotesEl.value.trim(),
      visual: Array.from(stashVisualSet),
      createdAt: Date.now(),
      sortOrder: (items.reduce((m,it) => Math.max(m, it.sortOrder||0), 0) + 1)
    });
    items.unshift(item);
    saveStash(items);

    // photo
    const photo = stashPhotoDataUrl.value;
    if (photo){
      try { await dbPutStashPhoto(item.id, photo); stashPhotoCache.set(item.id, photo); } catch {}
    }

    resetStashForm();
    renderStashList();
    renderHomeStats();
    populateSessionStashLink();
    toast("Added to stash.", "ok");
  });

  function autoUnknownName(items){
    const existing = new Set(items.map(it => it.name));
    let i = 1;
    while (existing.has(`Unknown ${i}`)) i++;
    return `Unknown ${i}`;
  }

  /* ---- stash detail ---- */
  async function openStashDetail(id){
    const items = loadStash();
    const item = items.find(x => String(x.id) === String(id));
    if (!item) return;
    currentStashId = id;
    const photo = stashPhotoCache.get(String(id)) || "";

    // Compute session stats for this stash item
    const sessions = await dbAllSessions();
    const linked = sessions.filter(s => String(s.stashId) === String(id));
    const ratings = linked.map(s => Number(s.rating)).filter(n => !isNaN(n) && n > 0);
    const avgRating = ratings.length ? (ratings.reduce((a,b)=>a+b,0) / ratings.length) : 0;
    const effectCounts = {};
    linked.forEach(s => {
      (s.effects || []).forEach(e => effectCounts[e] = (effectCounts[e]||0) + 1);
    });
    const topEffects = Object.entries(effectCounts).sort((a,b) => b[1]-a[1]).slice(0,5);

    stashDetailBody.innerHTML = `
      <div class="card__head" style="margin-top:14px;">
        <h2 class="card__title">${escapeHtml(item.name)}</h2>
        <p class="muted small">${escapeHtml(categoryLabel(item.category))} · ${item.status === "SAMPLED" ? "Sampled / archive" : "In stash"}${item.notes ? " · " + escapeHtml(item.notes) : ""}</p>
      </div>

      ${photo ? `<img src="${escapeHtml(photo)}" alt="" style="width:100%; max-height:280px; object-fit:cover; border-radius:var(--r-md); margin:10px 0; border:1px solid var(--line);">` : ""}

      <div class="detail-stat-row">
        <div class="detail-stat">
          <div class="detail-stat__value">${linked.length}</div>
          <div class="detail-stat__label">Sessions</div>
        </div>
        <div class="detail-stat">
          <div class="detail-stat__value">${avgRating ? avgRating.toFixed(1) : "—"}</div>
          <div class="detail-stat__label">Avg rating</div>
        </div>
        <div class="detail-stat">
          <div class="detail-stat__value">${ratings.length}</div>
          <div class="detail-stat__label">Rated</div>
        </div>
      </div>

      ${item.visual && item.visual.length ? `
        <div class="detail-block">
          <div class="detail-block__label">Visual traits</div>
          <div>${item.visual.map(v => `<span class="session-pill">${escapeHtml(humanLabel(v))}</span>`).join("")}</div>
        </div>` : ""}

      ${topEffects.length ? `
        <div class="detail-block">
          <div class="detail-block__label">What it brings (most often)</div>
          <div>${topEffects.map(([k,n]) => `<span class="session-pill">${escapeHtml(humanLabel(k))} · ${n}</span>`).join("")}</div>
        </div>` : `
        <div class="detail-block">
          <div class="detail-block__label">What it brings</div>
          <div class="muted small">No session signals yet. Log a session linked to this sample to start tracking.</div>
        </div>`}

      <div class="detail-block">
        <div class="detail-block__label">Sessions</div>
        ${linked.length ? linked.slice().sort((a,b) => (b.createdAt||0)-(a.createdAt||0)).slice(0,10).map(s => `
          <div class="journal-item">
            <div class="journal-item__meta">${fmtTime(s.createdAt)}${s.rating ? " · Rated " + s.rating : ""}${s.mode ? " · " + escapeHtml(humanLabel(s.mode)) : ""}</div>
            <div>${escapeHtml((s.transcript || "").slice(0, 220) || "(no transcript)")}</div>
          </div>
        `).join("") : '<div class="muted small">No linked sessions yet.</div>'}
      </div>

      <div class="form-actions">
        <button class="btn btn--ghost" id="stashEditToggle" type="button">Edit</button>
        <button class="btn btn--ghost" id="stashLogFromHere" type="button">Log a session for this</button>
        <button class="btn btn--danger" id="stashDeleteBtn" type="button">Delete</button>
      </div>
    `;

    stashDetailEl.hidden = false;
    stashDetailEl.scrollIntoView({ behavior: "smooth", block: "start" });

    $("#stashLogFromHere").addEventListener("click", () => {
      // preset session form
      const link = $("#sessionStashLink");
      link.value = id;
      goTo("log");
    });

    $("#stashDeleteBtn").addEventListener("click", async () => {
      if (!confirm("Delete this stash item? Linked sessions will not be deleted.")) return;
      const next = loadStash().filter(x => String(x.id) !== String(id));
      saveStash(next);
      try { await dbDeleteStashPhoto(id); } catch {}
      stashPhotoCache.delete(String(id));
      closeStashDetail();
      renderStashList();
      renderHomeStats();
      populateSessionStashLink();
      toast("Deleted.", "ok");
    });

    $("#stashEditToggle").addEventListener("click", () => {
      // Simple: pop the item back into the form for editing, then delete on save.
      // But to keep it clean, we'll just allow status toggle + notes edit inline.
      stashNameEl.value = item.name;
      stashCategoryEl.value = item.category;
      stashStatusEl.value = item.status;
      stashNotesEl.value = item.notes;
      stashVisualSet = new Set(item.visual || []);
      renderStashVisualChips();
      if (stashPhotoCache.get(String(id))){
        stashPhotoDataUrl.value = stashPhotoCache.get(String(id));
        stashPhotoThumb.src = stashPhotoCache.get(String(id));
      }
      // delete original
      const next = loadStash().filter(x => String(x.id) !== String(id));
      saveStash(next);
      closeStashDetail();
      renderStashList();
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast("Now editing. Press Add to re-save.");
    });
  }

  function closeStashDetail(){
    stashDetailEl.hidden = true;
    currentStashId = "";
  }
  stashDetailBack.addEventListener("click", closeStashDetail);

  function humanLabel(s){
    return String(s || "")
      .toLowerCase()
      .split("_")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  /* ===============================================================
     LOG (SESSIONS)
     =============================================================== */

  const sessionStashLinkEl = $("#sessionStashLink");
  const sessionTagEl       = $("#sessionTag");
  const sessionModeEl      = $("#sessionMode");
  const sessionModeNoteEl  = $("#sessionModeNote");
  const recBtn             = $("#recBtn");
  const recBtnLabel        = $("#recBtnLabel");
  const stopBtn            = $("#stopBtn");
  const statusPill         = $("#statusPill");
  const statusText         = $("#statusText");
  const fileAudio          = $("#fileAudio");
  const iphoneFallback     = $("#iphoneFallback");
  const previewAudio       = $("#preview");
  const transcriptText     = $("#transcriptText");
  const rateRow            = $("#rateRow");
  const rateScoreEl        = $("#rateScore");
  const sleepRow           = $("#sleepRow");
  const sleepScoreEl       = $("#sleepScore");
  const sessionFreeNote    = $("#sessionFreeNote");
  const saveSessionBtn     = $("#saveSessionBtn");
  const resetSessionBtn    = $("#resetSessionBtn");

  let moodSet    = new Set();
  let effectSet  = new Set();
  let smellSet   = new Set();
  let mediaRecorder = null;
  let audioChunks   = [];
  let currentAudioBlob = null;
  let speechRec     = null;
  let speechFinal   = "";

  function buildRateRow(row, hiddenInput, max){
    row.innerHTML = "";
    for (let i = 1; i <= max; i++){
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rate-dot";
      b.textContent = i;
      b.dataset.value = String(i);
      b.addEventListener("click", () => {
        const cur = Number(hiddenInput.value || 0);
        const next = cur === i ? 0 : i;
        hiddenInput.value = next || "";
        Array.from(row.children).forEach(c => {
          c.classList.toggle("is-active", Number(c.dataset.value) === next);
        });
      });
      row.appendChild(b);
    }
  }
  buildRateRow(rateRow, rateScoreEl, 5);
  buildRateRow(sleepRow, sleepScoreEl, 5);

  function bindChipSet(containerSel, dataKey, set){
    $$(`${containerSel} .chip`).forEach(c => {
      c.addEventListener("click", () => {
        const v = c.dataset[dataKey];
        if (set.has(v)) set.delete(v); else set.add(v);
        c.classList.toggle("is-active", set.has(v));
      });
    });
  }
  bindChipSet("#moodChips",    "mood",   moodSet);
  bindChipSet("#effectChips",  "effect", effectSet);
  bindChipSet("#smellChips",   "smell",  smellSet);

  function populateSessionStashLink(){
    const items = loadStash();
    const cur = sessionStashLinkEl.value;
    sessionStashLinkEl.innerHTML = `<option value="">— none —</option>` + items
      .sort((a,b) => {
        if (a.status !== b.status) return a.status === "CURRENT" ? -1 : 1;
        return (b.createdAt||0) - (a.createdAt||0);
      })
      .map(it => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.name)}${it.status === "SAMPLED" ? " (archive)" : ""}</option>`)
      .join("");
    if (cur) sessionStashLinkEl.value = cur;
  }

  /* ---- Sliders ---- */
  const sliderConfig = [
    { id: "snapshotCalmWired",  valueEl: "snapshotCalmWiredValue",  left: "Calm",  right: "Wired" },
    { id: "snapshotClearFoggy", valueEl: "snapshotClearFoggyValue", left: "Clear", right: "Foggy" },
    { id: "snapshotSocialSolo", valueEl: "snapshotSocialSoloValue", left: "Social",right: "Solo" },
  ];
  function describeSliderValue(v, left, right){
    v = Number(v);
    if (v === 0) return "Balanced";
    if (v < 0) return `${left} ${-v}`;
    return `${right} ${v}`;
  }
  sliderConfig.forEach(cfg => {
    const sl = document.getElementById(cfg.id);
    const lbl = document.getElementById(cfg.valueEl);
    if (!sl || !lbl) return;
    const sync = () => { lbl.textContent = describeSliderValue(sl.value, cfg.left, cfg.right); };
    sl.addEventListener("input", sync);
    sync();
  });

  /* ---- Audio Recording ---- */

  function supportsMediaRecorder(){
    return typeof MediaRecorder !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
  }
  function setRecStatus(state){
    statusPill.classList.remove("is-on", "is-rec");
    if (state === "REC"){
      statusPill.classList.add("is-rec");
      statusText.textContent = "Recording";
    } else if (state === "READY"){
      statusPill.classList.add("is-on");
      statusText.textContent = "Ready to save";
    } else if (state === "DONE"){
      statusPill.classList.add("is-on");
      statusText.textContent = "Saved";
    } else {
      statusText.textContent = "Idle";
    }
  }

  // Show iOS fallback if MediaRecorder unavailable
  if (!supportsMediaRecorder()) {
    iphoneFallback.hidden = false;
    recBtn.disabled = true;
  }

  fileAudio.addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    currentAudioBlob = f;
    previewAudio.src = URL.createObjectURL(f);
    previewAudio.hidden = false;
    setRecStatus("READY");
  });

  recBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording"){
      // stop
      mediaRecorder.stop();
      return;
    }
    if (!supportsMediaRecorder()){
      toast("Recording not supported. Use iOS fallback.", "err");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Choose a widely supported mime
      let mimeType = "";
      if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstart = () => {
        recBtn.classList.add("is-recording");
        recBtnLabel.textContent = "Stop";
        stopBtn.disabled = false;
        setRecStatus("REC");
        startSpeechRecognition();
      };
      mediaRecorder.onstop = () => {
        recBtn.classList.remove("is-recording");
        recBtnLabel.textContent = "Start";
        stopBtn.disabled = true;
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        currentAudioBlob = blob;
        previewAudio.src = URL.createObjectURL(blob);
        previewAudio.hidden = false;
        setRecStatus("READY");
        stopSpeechRecognition();
      };
      mediaRecorder.start();
    } catch (e){
      console.error(e);
      toast("Mic access denied.", "err");
    }
  });
  stopBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  });

  /* ---- Speech recognition (when available) ---- */
  function startSpeechRecognition(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      speechRec = new SR();
      speechRec.continuous = true;
      speechRec.interimResults = true;
      speechRec.lang = navigator.language || "en-US";
      speechFinal = transcriptText.value || "";
      speechRec.onresult = ev => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++){
          const r = ev.results[i];
          if (r.isFinal) speechFinal += r[0].transcript + " ";
          else interim += r[0].transcript;
        }
        transcriptText.value = (speechFinal + interim).trim();
      };
      speechRec.onerror = () => { /* silently */ };
      speechRec.onend = () => {
        // try to restart if still recording
        if (mediaRecorder && mediaRecorder.state === "recording" && speechRec){
          try { speechRec.start(); } catch {}
        }
      };
      speechRec.start();
    } catch {}
  }
  function stopSpeechRecognition(){
    if (!speechRec) return;
    try { speechRec.stop(); } catch {}
    speechRec = null;
  }

  /* ---- Save session ---- */
  saveSessionBtn.addEventListener("click", async () => {
    const stashId = sessionStashLinkEl.value;
    const items = loadStash();
    const stashItem = items.find(x => String(x.id) === String(stashId));
    const tag = sessionTagEl.value.trim();
    const name = (stashItem && stashItem.name) || tag || "Untagged";

    const session = {
      id: uid("sess"),
      createdAt: Date.now(),
      stashId: stashId || "",
      tag: tag || "",
      sampleName: name,
      mode: sessionModeEl.value,
      modeNote: sessionModeNoteEl.value.trim(),
      transcript: transcriptText.value.trim(),
      rating: Number(rateScoreEl.value) || 0,
      sleep: Number(sleepScoreEl.value) || 0,
      mood: Array.from(moodSet),
      effects: Array.from(effectSet),
      smell: Array.from(smellSet),
      snapshot: {
        calmWired: Number(($("#snapshotCalmWired")||{}).value || 0),
        clearFoggy: Number(($("#snapshotClearFoggy")||{}).value || 0),
        socialSolo: Number(($("#snapshotSocialSolo")||{}).value || 0),
      },
      freeNote: (sessionFreeNote && sessionFreeNote.value.trim()) || ""
    };

    if (currentAudioBlob){
      try {
        session.audio = await blobToDataUrl(currentAudioBlob);
        session.audioMime = currentAudioBlob.type || "audio/webm";
      } catch {}
    }

    try {
      await dbPutSession(session);
      toast("Session saved.", "ok");
      setRecStatus("DONE");
      resetSessionForm();
      renderHomeStats();
      renderHomeRecent();
      renderHomePatterns();
      renderAskPatterns();
      renderJournal();
      // jump back to home so user sees the result
      setTimeout(() => goTo("home"), 250);
    } catch (e){
      console.error(e);
      toast("Save failed.", "err");
    }
  });
  resetSessionBtn.addEventListener("click", resetSessionForm);

  function resetSessionForm(){
    sessionStashLinkEl.value = "";
    sessionTagEl.value = "";
    sessionModeEl.value = "FLOWER";
    sessionModeNoteEl.value = "";
    transcriptText.value = "";
    rateScoreEl.value = "";
    sleepScoreEl.value = "";
    Array.from(rateRow.children).forEach(c => c.classList.remove("is-active"));
    Array.from(sleepRow.children).forEach(c => c.classList.remove("is-active"));
    moodSet.clear(); effectSet.clear(); smellSet.clear();
    $$("#moodChips .chip, #effectChips .chip, #smellChips .chip").forEach(c => c.classList.remove("is-active"));
    sliderConfig.forEach(cfg => {
      const sl = document.getElementById(cfg.id);
      if (sl) sl.value = 0;
      const lbl = document.getElementById(cfg.valueEl);
      if (lbl) lbl.textContent = "Balanced";
    });
    if (sessionFreeNote) sessionFreeNote.value = "";
    currentAudioBlob = null;
    previewAudio.removeAttribute("src");
    previewAudio.hidden = true;
    setRecStatus("IDLE");
    speechFinal = "";
  }

  function blobToDataUrl(blob){
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ""));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  }

  /* ===============================================================
     ASK + PATTERNS
     =============================================================== */

  // Map effect tags to the buckets shown in the pattern surface
  const PATTERN_BUCKETS = [
    { key: "SLEEP",    label: "Best for sleep",         effects: ["SLEEPY","HEAVY"], moodAfter: null },
    { key: "CALM",     label: "Best for calm",          effects: ["CALM"], },
    { key: "CREATIVE", label: "Best for creative",      effects: ["CREATIVE"], },
    { key: "FOCUS",    label: "Best for focus / clear", effects: ["FOCUS","CLEAR"], },
    { key: "SOCIAL",   label: "Best for fun / social",  effects: ["SOCIAL"], },
    { key: "STEADY",   label: "Most consistent",        special: "consistent" },
  ];

  async function getPatternData(){
    const items = loadStash();
    const sessions = await dbAllSessions();
    const byStash = {};
    sessions.forEach(s => {
      const key = String(s.stashId || `tag:${s.tag || s.sampleName || "Untagged"}`);
      (byStash[key] = byStash[key] || []).push(s);
    });
    return { items, sessions, byStash };
  }

  function scoreStashForBucket(sessions, bucket){
    if (!sessions || !sessions.length) return null;

    if (bucket.special === "consistent"){
      // Most consistent: stash with most repeated effect patterns at >=2 sessions
      if (sessions.length < 2) return null;
      const ratings = sessions.map(s => Number(s.rating)).filter(n => !isNaN(n) && n > 0);
      const avg = ratings.length ? ratings.reduce((a,b)=>a+b,0)/ratings.length : 0;
      // variance: lower is more consistent. We invert it.
      let variance = 0;
      if (ratings.length >= 2){
        const mean = avg;
        variance = ratings.reduce((acc,n) => acc + Math.pow(n-mean,2), 0) / ratings.length;
      }
      const score = (avg * Math.max(0.5, 1 - variance/4)) * Math.log(1 + ratings.length);
      return { score, count: sessions.length, avgRating: avg };
    }

    let hits = 0;
    let ratingSum = 0;
    let ratingN = 0;
    sessions.forEach(s => {
      const effs = s.effects || [];
      const has = bucket.effects.some(e => effs.includes(e));
      if (has){
        hits++;
        if (Number(s.rating) > 0) { ratingSum += Number(s.rating); ratingN++; }
      }
    });
    if (hits < 2) return null; // require repeat
    const avg = ratingN ? ratingSum/ratingN : 0;
    const score = hits * (avg || 1);
    return { score, count: hits, avgRating: avg };
  }

  async function computePatterns(){
    const { items, byStash } = await getPatternData();
    const result = {};
    PATTERN_BUCKETS.forEach(bucket => {
      let best = null;
      Object.entries(byStash).forEach(([k, sess]) => {
        const r = scoreStashForBucket(sess, bucket);
        if (!r) return;
        if (!best || r.score > best.score){
          // resolve to display name
          let displayName = "Untagged";
          let stashItem = null;
          if (k.startsWith("tag:")) displayName = k.slice(4);
          else {
            stashItem = items.find(x => String(x.id) === k);
            displayName = (stashItem && stashItem.name) || "Removed sample";
          }
          best = Object.assign({}, r, { key: k, displayName, stashItem });
        }
      });
      result[bucket.key] = best;
    });
    return result;
  }

  function renderPatternGrid(targetEl, patterns){
    const cards = PATTERN_BUCKETS.map(b => {
      const p = patterns[b.key];
      if (!p){
        return `
          <div class="pattern-card pattern-card--empty">
            <div class="pattern-card__label">${escapeHtml(b.label)}</div>
            <div class="pattern-card__title">No signal yet</div>
            <div class="pattern-card__meta">Needs at least two confirming sessions.</div>
          </div>`;
      }
      const confidence = p.count >= 4 ? "STRONG" : p.count >= 3 ? "REPEATED" : "EMERGING";
      return `
        <div class="pattern-card" ${p.stashItem ? `data-stash-id="${escapeHtml(p.stashItem.id)}"` : ""}>
          <div class="pattern-card__confidence">${confidence}</div>
          <div class="pattern-card__label">${escapeHtml(b.label)}</div>
          <div class="pattern-card__title">${escapeHtml(p.displayName)}</div>
          <div class="pattern-card__meta">${p.count} session${p.count === 1 ? "" : "s"}${p.avgRating ? " · avg " + p.avgRating.toFixed(1) : ""}</div>
        </div>
      `;
    }).join("");
    targetEl.innerHTML = cards;
    $$("[data-stash-id]", targetEl).forEach(el => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        goTo("stash");
        setTimeout(() => openStashDetail(el.dataset.stashId), 350);
      });
    });
  }

  async function renderHomePatterns(){
    const patterns = await computePatterns();
    // Trim to only ones that have data; if none, show "logging more reveals patterns"
    const grid = $("#homePatterns");
    const real = Object.values(patterns).filter(p => p);
    if (real.length === 0){
      grid.innerHTML = `
        <div class="pattern-card pattern-card--empty" style="grid-column: 1 / -1;">
          <div class="pattern-card__label">Patterns</div>
          <div class="pattern-card__title">Log a few sessions to reveal patterns.</div>
          <div class="pattern-card__meta">A signal needs to repeat. One session is a story, not a pattern.</div>
        </div>`;
      return;
    }
    renderPatternGrid(grid, patterns);
  }

  async function renderAskPatterns(){
    const patterns = await computePatterns();
    renderPatternGrid($("#askPatterns"), patterns);
  }

  /* ---- Ask quick prompts ---- */
  $$(".quick").forEach(b => {
    b.addEventListener("click", () => {
      const map = {
        sleep: "What helps me sleep?",
        calm: "What keeps me calm?",
        focus: "What sharpens my focus?",
        social: "What's good with people?",
        steady: "What runs most steady for me?",
        different: "Where do my sessions diverge?"
      };
      $("#askInput").value = map[b.dataset.quick] || "";
      runAsk();
    });
  });
  $("#askBtn").addEventListener("click", runAsk);
  $("#askInput").addEventListener("keydown", e => { if (e.key === "Enter") runAsk(); });

  async function runAsk(){
    const q = $("#askInput").value.trim().toLowerCase();
    const replyEl = $("#askReply");
    if (!q){
      replyEl.innerHTML = `<span class="muted">Type a question, or tap a quick prompt above.</span>`;
      return;
    }
    const patterns = await computePatterns();
    const { items, sessions } = await getPatternData();

    if (!sessions.length){
      replyEl.innerHTML = `Nothing to read yet. Log a few sessions first — the system needs at least <strong>two repetitions</strong> before it will surface a pattern. One strong session is just a story.`;
      return;
    }

    // Simple keyword routing
    let answer = "";
    if (/sleep/.test(q)){
      answer = patternAnswer("Sleep", patterns.SLEEP, sessions, "SLEEPY");
    } else if (/calm|chill|relax/.test(q)){
      answer = patternAnswer("Calm", patterns.CALM, sessions, "CALM");
    } else if (/focus|clear|sharp/.test(q)){
      answer = patternAnswer("Focus / clear", patterns.FOCUS, sessions, "FOCUS");
    } else if (/creat/.test(q)){
      answer = patternAnswer("Creative", patterns.CREATIVE, sessions, "CREATIVE");
    } else if (/social|fun|hang|people/.test(q)){
      answer = patternAnswer("Social / fun", patterns.SOCIAL, sessions, "SOCIAL");
    } else if (/steady|consist/.test(q)){
      answer = patternAnswer("Steady / consistent", patterns.STEADY, sessions, null, true);
    } else if (/different|divers|weird|surprise/.test(q)){
      // outlier session
      answer = outlierAnswer(sessions);
    } else if (/all\s*lanes|transcript|every|show me everything/.test(q)){
      answer = `You have <strong>${sessions.length} session${sessions.length===1?"":"s"}</strong> and <strong>${items.length} stash item${items.length===1?"":"s"}</strong>. Pattern surface below shows the strongest repeated signals across them.`;
    } else {
      // generic: surface the best-confidence pattern
      const best = Object.entries(patterns).filter(([k,v]) => v).sort((a,b)=> b[1].score - a[1].score)[0];
      if (best){
        const [k, p] = best;
        const bucket = PATTERN_BUCKETS.find(b => b.key === k);
        answer = `Best read across your data: <strong>${escapeHtml(p.displayName)}</strong> is your most consistent fit for <span class="answer__pill">${escapeHtml(bucket.label.toLowerCase().replace("best for ","").replace("most ",""))}</span> (${p.count} sessions${p.avgRating ? `, avg ${p.avgRating.toFixed(1)}` : ""}).`;
      } else {
        answer = `Nothing has repeated enough yet to call a pattern. Keep logging — the system needs at least two sessions on the same sample with the same signal before it will say anything definitive.`;
      }
    }
    replyEl.innerHTML = answer;
  }

  function patternAnswer(label, p, sessions, effectKey, isSteady){
    if (!p){
      return `No repeated <strong>${escapeHtml(label.toLowerCase())}</strong> signal yet. The system needs the same sample to land with that effect at least twice before it will name a pattern.`;
    }
    if (isSteady){
      return `Your most consistent sample is <strong>${escapeHtml(p.displayName)}</strong> across ${p.count} session${p.count===1?"":"s"}${p.avgRating ? `, averaging ${p.avgRating.toFixed(1)}/5` : ""}. Low variance = predictable landing.`;
    }
    return `For <strong>${escapeHtml(label.toLowerCase())}</strong>, your strongest repeated signal is <strong>${escapeHtml(p.displayName)}</strong> (${p.count} confirming session${p.count===1?"":"s"}${p.avgRating ? `, avg ${p.avgRating.toFixed(1)}/5` : ""}).`;
  }

  function outlierAnswer(sessions){
    if (sessions.length < 3) return `Not enough sessions yet to spot outliers. Need at least three.`;
    // Find a session whose effect set is most different from the average.
    const allEffects = new Set();
    sessions.forEach(s => (s.effects || []).forEach(e => allEffects.add(e)));
    const universe = Array.from(allEffects);
    if (!universe.length) return `Sessions don't have effect tags yet — outlier detection needs at least that.`;
    const vectors = sessions.map(s => universe.map(e => (s.effects || []).includes(e) ? 1 : 0));
    const centroid = universe.map((_, i) => vectors.reduce((a,v) => a + v[i], 0) / vectors.length);
    let maxDist = -1, idx = -1;
    vectors.forEach((v, i) => {
      const d = v.reduce((a, x, j) => a + Math.pow(x - centroid[j], 2), 0);
      if (d > maxDist){ maxDist = d; idx = i; }
    });
    if (idx < 0) return `No clear outlier.`;
    const s = sessions[idx];
    return `The session that lands most differently: <strong>${escapeHtml(s.sampleName || "Untagged")}</strong> on ${fmtDate(s.createdAt)}. Effects logged: ${(s.effects || []).map(e => `<span class="answer__pill">${escapeHtml(humanLabel(e))}</span>`).join(" ") || "<span class=\"muted small\">(none)</span>"}.`;
  }

  /* ===============================================================
     HOME
     =============================================================== */

  async function renderHomeStats(){
    const stash = loadStash();
    const sessions = await dbAllSessions();
    $("#statStash").textContent = stash.length;
    $("#statSessions").textContent = sessions.length;

    // "Repeated signals" = number of pattern buckets that have a hit
    const patterns = await computePatterns();
    const hits = Object.values(patterns).filter(p => p).length;
    $("#statSignals").textContent = hits;

    // Greeting + next move
    $("#heroGreeting").textContent = todayGreeting();
    if (sessions.length === 0 && stash.length === 0){
      $("#heroSub").textContent = "Your private instrument for observing how cannabis actually lands. Start with whatever you have on hand.";
      $("#nextTitle").textContent = "Add your first sample.";
      $("#nextBody").textContent = "Stash is your sample library. Name optional, photo optional — just begin.";
      setNextCtas("Add to Stash", "stash", "Log a session", "log");
    } else if (sessions.length === 0){
      $("#heroSub").textContent = "You've got samples in your stash. Time to capture how one actually lands.";
      $("#nextTitle").textContent = "Log your first session.";
      $("#nextBody").textContent = "Pick from stash, hit record, say what you notice. Two minutes is enough.";
      setNextCtas("Log a session", "log", "Add another sample", "stash");
    } else if (sessions.length < 6){
      $("#heroSub").textContent = "Keep logging. Patterns surface when signals repeat.";
      $("#nextTitle").textContent = `${sessions.length} session${sessions.length===1?"":"s"} captured — keep going.`;
      $("#nextBody").textContent = "A pattern needs at least two confirming sessions on the same sample. Most useful signals start showing around five or six.";
      setNextCtas("Log another session", "log", "See what's surfacing", "ask");
    } else {
      $("#heroSub").textContent = "Your map is taking shape. Check the patterns or log another.";
      $("#nextTitle").textContent = "Your pattern surface is live.";
      $("#nextBody").textContent = "Ask your own data what runs steady, what helps sleep, what's worth keeping.";
      setNextCtas("Ask your data", "ask", "Log a session", "log");
    }
  }

  function setNextCtas(label1, target1, label2, target2){
    const a = $("#nextCtaPrimary");
    const b = $("#nextCtaSecondary");
    a.textContent = label1; a.onclick = () => goTo(target1);
    b.textContent = label2; b.onclick = () => goTo(target2);
  }

  async function renderHomeRecent(){
    const sessions = await dbAllSessions();
    const recent = sessions.slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).slice(0, 5);
    const el = $("#homeRecent");
    if (!recent.length){
      el.innerHTML = `<div class="empty">No sessions yet. Log your first one when you're ready.</div>`;
      return;
    }
    el.innerHTML = recent.map(s => {
      const effChips = (s.effects || []).slice(0,3).map(e => escapeHtml(humanLabel(e))).join(" · ");
      return `
        <div class="recent-item" data-session-id="${escapeHtml(s.id)}">
          <div class="recent-item__main">
            <div class="recent-item__title">${escapeHtml(s.sampleName || "Untagged")}</div>
            <div class="recent-item__meta">${fmtTime(s.createdAt)}${effChips ? " · " + effChips : ""}</div>
          </div>
          <div class="recent-item__rating">${s.rating ? "★".repeat(s.rating) : ""}</div>
        </div>
      `;
    }).join("");
    $$(".recent-item", el).forEach(it => {
      it.addEventListener("click", () => {
        const sid = it.dataset.sessionId;
        // jump to settings journal for now (simple) — or could open detail
        goTo("settings");
        setTimeout(() => {
          const target = $(`[data-journal-session="${sid}"]`);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 350);
      });
    });
  }

  /* ===============================================================
     JOURNAL (Settings)
     =============================================================== */

  async function renderJournal(){
    const sessions = await dbAllSessions();
    const el = $("#sessionJournal");
    if (!sessions.length){
      el.innerHTML = `<div class="empty">No sessions yet.</div>`;
      return;
    }
    const sorted = sessions.slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    el.innerHTML = sorted.map(s => `
      <div class="journal-item" data-journal-session="${escapeHtml(s.id)}">
        <div class="journal-item__meta">${fmtTime(s.createdAt)} · ${escapeHtml(s.sampleName || "Untagged")}${s.rating ? " · ★" + s.rating : ""}${(s.effects && s.effects.length) ? " · " + s.effects.map(humanLabel).join(", ") : ""}</div>
        <div>${escapeHtml((s.transcript || "(no transcript)").slice(0, 240))}</div>
      </div>
    `).join("");
  }

  /* ===============================================================
     EXPORT / IMPORT / WIPE
     =============================================================== */

  $("#exportBtn").addEventListener("click", async () => {
    try {
      const stash = loadStash();
      const sessions = await dbAllSessions();
      // Strip audio (too large) but keep metadata
      const slimSessions = sessions.map(s => {
        const c = Object.assign({}, s);
        delete c.audio;
        return c;
      });
      const photos = await dbAllStashPhotos();
      const payload = {
        app: "Lifted States",
        version: 1,
        exportedAt: new Date().toISOString(),
        stash,
        stashPhotos: photos,
        sessions: slimSessions
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lifted-states-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Exported.", "ok");
    } catch (e){
      console.error(e);
      toast("Export failed.", "err");
    }
  });

  $("#importJsonInput").addEventListener("change", async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const data = JSON.parse(txt);
      if (!data || typeof data !== "object") throw new Error("invalid");
      if (Array.isArray(data.stash)){
        const cleaned = data.stash.map(normalizeStashItem);
        saveStash(cleaned);
      }
      if (Array.isArray(data.stashPhotos)){
        for (const p of data.stashPhotos){
          if (p && p.id) {
            try { await dbPutStashPhoto(p.id, p.dataUrl || ""); } catch {}
          }
        }
        await loadStashPhotosIntoCache();
      }
      if (Array.isArray(data.sessions)){
        for (const s of data.sessions){
          if (s && s.id){
            try { await dbPutSession(s); } catch {}
          }
        }
      }
      renderStashList();
      renderHomeStats();
      renderHomeRecent();
      renderHomePatterns();
      renderAskPatterns();
      renderJournal();
      populateSessionStashLink();
      toast("Imported.", "ok");
    } catch (err){
      console.error(err);
      toast("Import failed — invalid file.", "err");
    } finally {
      e.target.value = "";
    }
  });

  $("#wipeBtn").addEventListener("click", async () => {
    if (!confirm("Wipe everything from this device? Sessions, stash, photos. This cannot be undone.")) return;
    try {
      localStorage.removeItem(STASH_KEY);
      localStorage.removeItem(STASH_ORDER_KEY);
      await dbClearSessions();
      await dbClearStashPhotos();
      stashPhotoCache.clear();
      renderStashList();
      renderHomeStats();
      renderHomeRecent();
      renderHomePatterns();
      renderAskPatterns();
      renderJournal();
      populateSessionStashLink();
      toast("All local data wiped.", "ok");
    } catch (e){
      console.error(e);
      toast("Wipe failed.", "err");
    }
  });

  /* ===============================================================
     TOPBAR menu (cycles theme — placeholder for future)
     =============================================================== */
  $("#topbarMenuBtn").addEventListener("click", () => goTo("settings"));

  /* ===============================================================
     BOOTSTRAP
     =============================================================== */
  async function boot(){
    // Migrate any legacy data: if stash items embed photoDataUrl, lift them into IDB.
    const items = loadStash();
    let migrated = false;
    for (const it of items){
      if (it.photoDataUrl){
        try { await dbPutStashPhoto(it.id, it.photoDataUrl); migrated = true; } catch {}
        delete it.photoDataUrl;
      }
    }
    if (migrated) saveStash(items);

    await loadStashPhotosIntoCache();
    populateSessionStashLink();
    renderStashList();
    renderStashOrderControls();
    await renderHomeStats();
    await renderHomeRecent();
    await renderHomePatterns();
    await renderAskPatterns();
    await renderJournal();

    // Default to home page on load
    goTo("home");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
