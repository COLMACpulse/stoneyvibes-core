console.log("app.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const recBtn = document.getElementById("recBtn");
  const stopBtn = document.getElementById("stopBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const statusText = document.getElementById("statusText");
  const preview = document.getElementById("preview");
  const sessionList = document.getElementById("sessionList");
if (!recBtn || !stopBtn || !pauseBtn || !statusText || !preview || !sessionList) {
    console.error("Missing required elements");
    return;
  }

  /* ---------- IndexedDB ---------- */
  const DB_NAME = "sv_db";
  const STORE = "sessions";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveSession(blob) {
    const db = await openDB();
    return new Promise(resolve => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        blob
      });
      tx.oncomplete = resolve;
    });
  }

  async function loadSessions() {
    const db = await openDB();
    return new Promise(resolve => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
    });
  }

  async function renderSessions() {
    const sessions = await loadSessions();
    sessionList.innerHTML = "";
    if (!sessions.length) {
      sessionList.innerHTML = `<div class="muted">No sessions yet.</div>`;
      return;
    }

    sessions
      .sort((a,b)=>b.createdAt-a.createdAt)
      .forEach(s => {
        const url = URL.createObjectURL(s.blob);
        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `
          <p class="itemTitle">${new Date(s.createdAt).toLocaleString()}</p>
          <audio controls src="${url}" style="width:100%;"></audio>
        `;
        sessionList.appendChild(el);
      });
  }

  /* ---------- Recording ---------- */
  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];

  recBtn.onclick = async () => {
    if (mediaRecorder) return;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Mic permission denied");
      return;
    }

    chunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);

    mediaRecorder.ondataavailable = e => {
      if (e.data.size) chunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
      await saveSession(blob);
      preview.src = URL.createObjectURL(blob);
      preview.style.display = "block";

      mediaStream.getTracks().forEach(t => t.stop());
      mediaRecorder = null;
      chunks = [];
      await renderSessions();
    };

    mediaRecorder.start();
    recBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent = "Recording…";
  };

  stopBtn.onclick = () => {
    if (!mediaRecorder) return;
    mediaRecorder.stop();
    recBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent = "Idle";
  };

  /* ---------- Init ---------- */
  await renderSessions();
});
