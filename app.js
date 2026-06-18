/************************************************************
 * StoneyVibes — VOLUME 1
 * - Swipe pages left/right (scroll-snap)
 * - STASH (localStorage)
 * - SESSIONS (IndexedDB)
 * - Recording: Start / Pause / Stop
 * - Terpene Presence Draft (localStorage)
 ************************************************************/

/* ================= NAV / SWIPE ================= */

const pages = document.getElementById("pages");
const tabStash = document.getElementById("tabStash");
const tabSessions = document.getElementById("tabSessions");
const tabAbout = document.getElementById("tabAbout");

function setActiveTab(which){
  [tabStash, tabSessions, tabAbout].forEach(t => t.classList.remove("active"));
  if (which === "stash") tabStash.classList.add("active");
  if (which === "sessions") tabSessions.classList.add("active");
  if (which === "about") tabAbout.classList.add("active");
}

function scrollToPage(idx){
  pages.scrollTo({ left: idx * pages.clientWidth, behavior: "smooth" });
}

tabStash.onclick = () => scrollToPage(0);
tabSessions.onclick = () => scrollToPage(1);
tabAbout.onclick = () => scrollToPage(2);

pages.addEventListener("scroll", () => {
  const idx = Math.round(pages.scrollLeft / pages.clientWidth);
  if (idx === 0) setActiveTab("stash");
  if (idx === 1) setActiveTab("sessions");
  if (idx === 2) setActiveTab("about");
});

/* ================= HELPERS ================= */

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function fmtTime(ts){
  const d = new Date(ts);
  return d.toLocaleString();
}

function uid(){
  return "sess_" + Math.random().toString(16).slice(2) + "_" + Date.now();
}

/* ================= TERPENE DRAFT ================= */

const TERP_DRAFT_KEY = "sv_terpene_draft_v1";

function loadTerpeneDraft(){
  try { return JSON.parse(localStorage.getItem(TERP_DRAFT_KEY) || "null"); }
  catch { return null; }
}
function clearTerpeneDraft(){
  localStorage.removeItem(TERP_DRAFT_KEY);
  updateTerpeneStatus();
}
function draftSummary(draft){
  if (!draft || !draft.presence) return "None";
  const vals = Object.values(draft.presence);
  const scored = vals.filter(v => v && v !== "NP");
  return scored.length ? `Ready (${scored.length})` : "None";
}
function updateTerpeneStatus(){
  const el = document.getElementById("terpeneStatus");
  if (!el) return;
  const d = loadTerpeneDraft();
  el.textContent = draftSummary(d);
}

document.getElementById("openTerpenesBtn").onclick = () => {
  window.location.href = "./terpenes.html";
};

document.getElementById("clearTerpenesDraftBtn").onclick = () => {
  if (confirm("Clear terpene draft on this device?")){
    clearTerpeneDraft();
  }
};

/* ================= STASH ================= */

const STASH_KEY = "sv_stash_v1";
const stashList = document.getElementById("stashList");
const stashName = document.getElementById("stashName");
const stashCategory = document.getElementById("stashCategory");
const stashNotes = document.getElementById("stashNotes");
const sessionStashLink = document.getElementById("sessionStashLink");

function loadStash(){
  try { return JSON.parse(localStorage.getItem(STASH_KEY) || "[]"); }
  catch { return []; }
}
function saveStash(items){
  localStorage.setItem(STASH_KEY, JSON.stringify(items));
  renderStash();
  renderStashLinkDropdown();
}
function renderStash(){
  const items = loadStash();
  if (!items.length){
    stashList.innerHTML = '<div class="muted">No stash items yet.</div>';
    return;
  }
  stashList.innerHTML = "";
  items.forEach((it, i) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <div>
          <p class="itemTitle">${escapeHtml(it.name)}</p>
          <p class="itemMeta">${escapeHtml(it.category)} — ${escapeHtml(it.notes || "")}</p>
        </div>
        <div class="itemBtns">
          <button class="btn btnDanger">Delete</button>
        </div>
      </div>
    `;
    el.querySelector("button").onclick = () => {
      const updated = loadStash();
      updated.splice(i,1);
      saveStash(updated);
    };
    stashList.appendChild(el);
  });
}
function renderStashLinkDropdown(){
  const items = loadStash();
  sessionStashLink.innerHTML = '<option value="">— none —</option>';
  items.forEach(it => {
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = `${it.name} (${it.category})`;
    sessionStashLink.appendChild(opt);
  });
}

document.getElementById("addStashBtn").onclick = () => {
  const name = stashName.value.trim();
  if (!name) return alert("Give it a name.");
  const item = {
    id: "stash_" + Date.now(),
    name,
    category: stashCategory.value,
    notes: stashNotes.value.trim()
  };
  const items = loadStash();
  items.unshift(item);
  saveStash(items);
  stashName.value = "";
  stashNotes.value = "";
};

document.getElementById("clearStashBtn").onclick = () => {
  if (confirm("Clear entire STASH?")) saveStash([]);
};

/* ================= SESSIONS DB ================= */

const DB_NAME = "stoneyvibes_db";
const STORE = "sessions";

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, { keyPath:"id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(session){
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(session);
}

async function dbGetAll(){
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

/* ================= RECORDING ================= */

const recBtn = document.getElementById("recBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const statusText = document.getElementById("statusText");
const sessionList = document.getElementById("sessionList");

let mediaRecorder = null;
let chunks = [];

function setStatus(text){ statusText.textContent = text; }

recBtn.onclick = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  mediaRecorder = new MediaRecorder(stream);
  chunks = [];

  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
    await saveSession(blob);
  };

  mediaRecorder.start();
  setStatus("Recording…");
  recBtn.disabled = true;
  pauseBtn.disabled = false;
  stopBtn.disabled = false;
};

pauseBtn.onclick = () => {
  if (!mediaRecorder) return;
  if (mediaRecorder.state === "recording"){
    mediaRecorder.pause();
    setStatus("Paused");
  } else {
    mediaRecorder.resume();
    setStatus("Recording…");
  }
};

stopBtn.onclick = () => {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  setStatus("Idle");
  recBtn.disabled = false;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
};

/* ================= SAVE SESSION ================= */

async function saveSession(blob){
  const draft = loadTerpeneDraft();
  const session = {
    id: uid(),
    createdAt: Date.now(),
    tag: document.getElementById("sessionTag").value.trim(),
    notes: document.getElementById("sessionNotes").value.trim(),
    stashId: sessionStashLink.value,
    terpenes: draft || null,
    audioBlob: blob
  };
  await dbPut(session);
  await renderSessions();
}

async function renderSessions(){
  const sessions = await dbGetAll();
  if (!sessions.length){
    sessionList.innerHTML = '<div class="muted">No sessions yet.</div>';
    return;
  }
  sessionList.innerHTML = "";
  sessions.reverse().forEach(s => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemHead">
        <div>
          <p class="itemTitle">${escapeHtml(s.tag || "Session")}</p>
          <p class="itemMeta">${fmtTime(s.createdAt)}</p>
        </div>
      </div>
    `;
    sessionList.appendChild(el);
  });
}

/* ================= INIT ================= */

renderStash();
renderStashLinkDropdown();
renderSessions();
updateTerpeneStatus();
setStatus("Idle");
