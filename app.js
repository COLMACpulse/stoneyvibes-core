// ===============================
// STONEYVIBES — CORE DATA LAYER (v1)
// Full-file replace. No UI assumptions.
// ===============================

const STORAGE_KEY = "stoneyvibes_sessions_v1";

// ---- Session Model ----
function createSession(fields = {}) {
  return {
    id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2),
    timestamp: Date.now(),

    // Core fields (safe defaults)
    strainName: fields.strainName || "",
    severity: fields.severity ?? null,       // 1–5
    moodBefore: fields.moodBefore ?? null,   // string
    moodAfter: fields.moodAfter ?? null,     // string
    sleepQuality: fields.sleepQuality ?? null, // 1–5

    // Media (base64 data URLs)
    photo: fields.photo ?? null,
    audio: fields.audio ?? null,

    // Free text (optional)
    notes: fields.notes ?? ""
  };
}

// ---- Storage ----
function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function addSession(session) {
  const sessions = loadSessions();
  sessions.unshift(session); // newest first
  saveSessions(sessions);
  return session;
}

function deleteSession(id) {
  const sessions = loadSessions().filter(s => s.id !== id);
  saveSessions(sessions);
  return sessions;
}

function clearAllSessions() {
  localStorage.removeItem(STORAGE_KEY);
}

// ---- Minimal export (for later offload) ----
function exportSessionsJson() {
  const sessions = loadSessions();
  return JSON.stringify({ exportedAt: Date.now(), sessions }, null, 2);
}

// ---- Debug hooks (TEMP but useful) ----
window.StoneyVibes = {
  STORAGE_KEY,
  createSession,
  loadSessions,
  addSession,
  deleteSession,
  clearAllSessions,
  exportSessionsJson
};
