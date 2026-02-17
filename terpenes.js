function n(id) {
  const v = parseFloat(document.getElementById(id).value);
  return Number.isFinite(v) ? v : 0;
}

function evaluateTerpenes(t) {
  const { myrcene, limonene, caryophyllene, pinene, linalool, terpinolene } = t;

  // “Presence score” compatible:
  // If user enters 0–3 instead of % values, math still behaves (relative weighting).

  const BodyIndex =
    (myrcene * 2) +
    caryophyllene +
    linalool;

  const ClarityIndex =
    (limonene + (pinene * 1.5)) -
    (myrcene * 0.5);

  const CreativeIndex =
    (limonene + pinene + terpinolene) -
    (myrcene * 0.7);

  let zScore = "Unclassified";

  if (BodyIndex < 1 && ClarityIndex > 1) zScore = "Z2 — Functional Lift";
  else if (BodyIndex >= 1 && BodyIndex <= 1.5) zScore = "Z3–Z4 — Grounded Flow";
  else if (BodyIndex > 1.5 && BodyIndex <= 2) zScore = "Z5 — Body Glow";
  else if (BodyIndex > 2) zScore = "Z6 — Melt / Sleep";

  return { BodyIndex, ClarityIndex, CreativeIndex, zScore };
}

function nowStamp() {
  const d = new Date();
  return d.toISOString();
}

function loadLog() {
  try {
    return JSON.parse(localStorage.getItem("sv_terpene_log") || "[]");
  } catch {
    return [];
  }
}

function saveLog(entry) {
  const log = loadLog();
  log.unshift(entry);
  localStorage.setItem("sv_terpene_log", JSON.stringify(log));
  return log;
}

function renderResult(res, t) {
  return [
    `Inputs: ${JSON.stringify(t)}`,
    "",
    `BodyIndex: ${res.BodyIndex.toFixed(2)}`,
    `ClarityIndex: ${res.ClarityIndex.toFixed(2)}`,
    `CreativeIndex: ${res.CreativeIndex.toFixed(2)}`,
    "",
    `Z-Scale: ${res.zScore}`,
  ].join("\n");
}

const out = document.getElementById("out");
const statusPill = document.getElementById("statusPill");

document.getElementById("runBtn").addEventListener("click", () => {
  const t = {
    myrcene: n("myrcene"),
    limonene: n("limonene"),
    caryophyllene: n("caryophyllene"),
    pinene: n("pinene"),
    linalool: n("linalool"),
    terpinolene: n("terpinolene"),
  };

  const res = evaluateTerpenes(t);
  out.textContent = renderResult(res, t);
  statusPill.textContent = "Ran Z-Scale";
});

document.getElementById("saveBtn").addEventListener("click", () => {
  // Require a run first
  if (out.textContent === "—") {
    statusPill.textContent = "Run first";
    return;
  }

  const entry = {
    ts: nowStamp(),
    type: "terpenes",
    raw: out.textContent,
  };

  saveLog(entry);
  statusPill.textContent = "Saved";
});
