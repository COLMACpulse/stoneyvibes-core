// ===============================
// STONEYVIBES — CORE DATA LAYER
// ===============================

const STORAGE_KEY = "stoneyvibes_sessions_v1";

// ---- Data Models ----

function createSession({
  strainName = "",
  photo = null,        // base64
  audio = null,        // base64
  moodBefore = null,   // string
  moodAfter = null,    // string
  sleepQuality = null, // 1–5
  severity = null      // 1–5
}) {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    strainName,
    photo,
    audio,
    moodBefore,
    moodAfter,
    sleepQuality,
    severity
  };
}

// ---- Storage ----

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
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

// ---- Debug Hook (TEMP) ----
window.StoneyVibes = {
  createSession,
  addSession,
  loadSessions
};
