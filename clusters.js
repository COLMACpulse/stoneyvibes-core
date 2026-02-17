// clusters.js — StoneyVibes local-only clustering + survival labels (v1)
// Not medical. This is patterning YOUR logs for clarity + intention.
// Drop into /src (or same folder as your app.js) and import where needed.

export const CLUSTER_LABEL = Object.freeze({
  SEED: "SEED",
  EMERGING: "EMERGING",
  CONFIRMED: "CONFIRMED",
  DRIFTING: "DRIFTING",
  REVIEW: "REVIEW",
});

export const CONFIDENCE_BADGE = Object.freeze({
  LOCKED: "Locked",
  STRONG: "Strong",
  EMERGING: "Emerging",
  NOISE: "Noise",
});

const DEFAULTS = Object.freeze({
  // Similarity thresholds
  THRESH_SAME: 0.78,     // join cluster
  THRESH_NEIGHBOR: 0.65, // adjacent (optional)
  // Survival rules
  MIN_N: 3,
  MIN_DISTINCT_DAYS: 2,
  SIG_AGREE_PCT: 0.70,   // 70%
  SIG_KEYS: ["bodyFirst", "headSpeed", "eyeResponse"],
  VAR_MAX: 0.16,         // internal variance cutoff (tune later)
  // Weighting
  W: {
    status: 0.30,
    target: 0.20,
    whiff: 0.40,
    severity: 0.07,
    terps: 0.03, // aroma metadata only (kept tiny)
  },
});

// ----------------------------
// Session shape (recommended)
// ----------------------------
// session = {
//   id: "uuid",
//   ts: 1738346400000, // ms
//   strain: "Zookie" | "Unknown" | ...
//   status: ["CALM","FOCUS"] or "CALM" or null
//   target: ["CREATIVE"] or "SLEEP" ...
//   whiff: {
//     bodyFirst: "E"|"D"|...,
//     headSpeed: "A"|"B"|...,
//     eyeResponse: "B"|"C"|...,
//     mouthFeel: "A"|"B"|...,
//     humor: "YES"|"NO"|"MAYBE",
//     social: "A"|"B"|...,
//     threat: "A"|"B"|...,
//   },
//   severity: { z: 0..6 } or { z: "Z3" } or null
//   terps: ["myrcene","limonene"] or ["CITRUS","PINE"] (aroma tags) or null
// }

function normArr(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.filter(Boolean).map(String);
  return [String(x)];
}

function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function jaccard(a, b) {
  const A = new Set(normArr(a));
  const B = new Set(normArr(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const v of A) if (B.has(v)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenEq(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase() ? 1 : 0;
}

function safeNumZ(sev) {
  if (!sev) return null;
  const z = sev.z ?? sev.Z ?? sev.zScale ?? sev.z_score;
  if (z === null || z === undefined) return null;
  const s = String(z).trim().toUpperCase();
  // Accept "Z3" or "3"
  const n = s.startsWith("Z") ? Number(s.slice(1)) : Number(s);
  return Number.isFinite(n) ? n : null;
}

function severitySim(aSev, bSev) {
  const a = safeNumZ(aSev);
  const b = safeNumZ(bSev);
  if (a === null && b === null) return 1;
  if (a === null || b === null) return 0.5; // unknown shouldn't kill similarity
  const diff = Math.abs(a - b);
  // within 1 step = strong; fade out by 6
  return Math.max(0, 1 - diff / 6);
}

function whiffSim(aWhiff, bWhiff) {
  // Most power lives here.
  // You can expand later, but keep stable for v1.
  const keys = ["bodyFirst", "headSpeed", "eyeResponse", "mouthFeel", "social", "threat"];
  let score = 0;
  let denom = 0;
  for (const k of keys) {
    const av = aWhiff?.[k];
    const bv = bWhiff?.[k];
    // If both missing, skip (don’t fake agreement)
    if (!av && !bv) continue;
    denom += 1;
    score += tokenEq(av, bv);
  }
  if (denom === 0) return 0.5; // neutral if no whiff data
  return score / denom;
}

export function scoreSimilarity(a, b, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts, W: { ...DEFAULTS.W, ...(opts.W || {}) } };

  const statusS = jaccard(a.status, b.status);
  const targetS = jaccard(a.target, b.target);
  const whiffS = whiffSim(a.whiff, b.whiff);
  const sevS = severitySim(a.severity, b.severity);

  // Terps = aroma metadata only. Low weight. Also jaccard.
  const terpS = jaccard(a.terps, b.terps);

  const W = cfg.W;
  const totalW = W.status + W.target + W.whiff + W.severity + W.terps;

  const raw =
    statusS * W.status +
    targetS * W.target +
    whiffS * W.whiff +
    sevS * W.severity +
    terpS * W.terps;

  return totalW === 0 ? 0 : raw / totalW;
}

function centroidOf(cluster) {
  // Simple centroid = most common token per field (mode).
  // Keeps it cheap + deterministic.
  const sessions = cluster.sessions || [];
  const pickMode = (vals) => {
    const m = new Map();
    for (const v of vals) {
      if (!v) continue;
      const k = String(v).trim().toUpperCase();
      m.set(k, (m.get(k) || 0) + 1);
    }
    let best = null;
    let bestN = -1;
    for (const [k, n] of m.entries()) {
      if (n > bestN) {
        bestN = n;
        best = k;
      }
    }
    return best;
  };

  const allStatus = [];
  const allTarget = [];
  const bodyFirst = [];
  const headSpeed = [];
  const eyeResponse = [];
  const mouthFeel = [];
  const social = [];
  const threat = [];
  const zs = [];
  const terps = [];

  for (const s of sessions) {
    allStatus.push(...normArr(s.status));
    allTarget.push(...normArr(s.target));
    bodyFirst.push(s.whiff?.bodyFirst);
    headSpeed.push(s.whiff?.headSpeed);
    eyeResponse.push(s.whiff?.eyeResponse);
    mouthFeel.push(s.whiff?.mouthFeel);
    social.push(s.whiff?.social);
    threat.push(s.whiff?.threat);

    const z = safeNumZ(s.severity);
    if (z !== null) zs.push(z);

    terps.push(...normArr(s.terps));
  }

  const zMean = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null;

  return {
    status: Array.from(new Set(allStatus.map((x) => String(x).toUpperCase()))),
    target: Array.from(new Set(allTarget.map((x) => String(x).toUpperCase()))),
    whiff: {
      bodyFirst: pickMode(bodyFirst),
      headSpeed: pickMode(headSpeed),
      eyeResponse: pickMode(eyeResponse),
      mouthFeel: pickMode(mouthFeel),
      social: pickMode(social),
      threat: pickMode(threat),
    },
    severity: zMean === null ? null : { z: zMean },
    terps: Array.from(new Set(terps.map((x) => String(x).toUpperCase()))),
  };
}

function internalVariance(cluster, opts = {}) {
  // Variance as mean absolute deviation from centroid similarity.
  const cfg = { ...DEFAULTS, ...opts, W: { ...DEFAULTS.W, ...(opts.W || {}) } };
  const c = centroidOf(cluster);
  const sims = cluster.sessions.map((s) => scoreSimilarity(s, c, cfg));
  if (sims.length <= 1) return 0;
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  const mad = sims.reduce((a, b) => a + Math.abs(b - mean), 0) / sims.length;
  return mad;
}

function signatureAgreement(cluster, sigKeys = DEFAULTS.SIG_KEYS) {
  // For each signature key, compute pct matching the cluster mode.
  const sessions = cluster.sessions || [];
  if (!sessions.length) return { agree: 0, perKey: {} };

  const perKey = {};
  let agreeCount = 0;

  for (const k of sigKeys) {
    const vals = sessions.map((s) => s.whiff?.[k]).filter(Boolean).map((v) => String(v).toUpperCase());
    if (!vals.length) {
      perKey[k] = null;
      continue;
    }
    const freq = new Map();
    for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
    let mode = null;
    let best = -1;
    for (const [v, n] of freq.entries()) {
      if (n > best) {
        best = n;
        mode = v;
      }
    }
    const pct = best / vals.length;
    perKey[k] = { mode, pct };
    if (pct >= DEFAULTS.SIG_AGREE_PCT) agreeCount++;
  }

  return { agree: agreeCount, perKey };
}

export function computeClusterConfidence(cluster, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts, W: { ...DEFAULTS.W, ...(opts.W || {}) } };
  const n = cluster.sessions.length;

  // Base: how tight is it?
  const varMAD = internalVariance(cluster, cfg);
  const tightness = Math.max(0, 1 - varMAD / cfg.VAR_MAX); // 1 is tight

  // Breadth: distinct days
  const days = new Set(cluster.sessions.map((s) => dayKey(s.ts)));
  const dayScore = Math.min(1, days.size / cfg.MIN_DISTINCT_DAYS);

  // Signature agreement
  const sig = signatureAgreement(cluster, cfg.SIG_KEYS);
  const sigScore = Math.min(1, sig.agree / 3); // 0..1

  // Repetition
  const repScore = Math.min(1, n / (cfg.MIN_N * 2)); // saturates at ~6 sessions

  // Weighted confidence
  const conf = 0.40 * tightness + 0.25 * dayScore + 0.20 * sigScore + 0.15 * repScore;

  // Badge
  let badge = CONFIDENCE_BADGE.NOISE;
  if (conf >= 0.95) badge = CONFIDENCE_BADGE.LOCKED;
  else if (conf >= 0.80) badge = CONFIDENCE_BADGE.STRONG;
  else if (conf >= 0.65) badge = CONFIDENCE_BADGE.EMERGING;

  return {
    confidence: Number(conf.toFixed(3)),
    badge,
    varianceMAD: Number(varMAD.toFixed(3)),
    n,
    distinctDays: days.size,
    signature: sig,
  };
}

export function labelCluster(cluster, prevCluster = null, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts, W: { ...DEFAULTS.W, ...(opts.W || {}) } };
  const { n, distinctDays, signature, varianceMAD, confidence } = computeClusterConfidence(cluster, cfg);

  // Survival rules
  const passesN = n >= cfg.MIN_N;
  const passesDays = distinctDays >= cfg.MIN_DISTINCT_DAYS;
  const passesSig = signature.agree >= 2; // 2 of 3 signature keys stable
  const tooLoose = varianceMAD > cfg.VAR_MAX;

  if (n <= 2) return CLUSTER_LABEL.SEED;
  if (tooLoose) return CLUSTER_LABEL.REVIEW;
  if (passesN && passesDays && passesSig && confidence >= 0.80) return CLUSTER_LABEL.CONFIRMED;
  if (passesN && passesDays && confidence >= 0.65) return CLUSTER_LABEL.EMERGING;

  // Drift logic (optional): if it used to be confirmed but is loosening
  if (prevCluster) {
    const prevLabel = prevCluster.label;
    if (prevLabel === CLUSTER_LABEL.CONFIRMED && confidence < 0.80) return CLUSTER_LABEL.DRIFTING;
  }
  return CLUSTER_LABEL.EMERGING;
}

export function summarizeCluster(cluster, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts, W: { ...DEFAULTS.W, ...(opts.W || {}) } };
  const cent = centroidOf(cluster);
  const meta = computeClusterConfidence(cluster, cfg);

  const sig = cent.whiff || {};
  const parts = [];

  // Short "why"
  parts.push(`${meta.badge} — ${meta.n} sessions, ${meta.distinctDays} day(s)`);

  // Signature sentence
  const sigBits = [];
  if (sig.bodyFirst) sigBits.push(`body-first ${sig.bodyFirst}`);
  if (sig.eyeResponse) sigBits.push(`eyes ${sig.eyeResponse}`);
  if (sig.headSpeed) sigBits.push(`head ${sig.headSpeed}`);
  if (sigBits.length) parts.push(`Signature: ${sigBits.join(", ")}`);

  // Status/target top words
  const top3 = (arr) => {
    const m = new Map();
    for (const v of normArr(arr)) {
      const k = String(v).toUpperCase();
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
  };

  const st = top3(cent.status);
  const tg = top3(cent.target);
  if (st.length) parts.push(`Status: ${st.join(" / ")}`);
  if (tg.length) parts.push(`Target: ${tg.join(" / ")}`);

  return {
    id: cluster.id,
    label: cluster.label,
    confidence: meta.confidence,
    badge: meta.badge,
    oneLiner: parts.join(" • "),
    centroid: cent,
  };
}

export function buildClusters(sessions, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts, W: { ...DEFAULTS.W, ...(opts.W || {}) } };

  const clean = (sessions || [])
    .filter((s) => s && s.ts)
    .slice()
    .sort((a, b) => b.ts - a.ts); // newest first

  const clusters = [];

  const newCluster = (seed) => ({
    id: `cl_${Math.random().toString(36).slice(2, 10)}`,
    sessions: [seed],
    centroid: seed, // temp; recompute later
    label: CLUSTER_LABEL.SEED,
    confidence: 0,
    badge: CONFIDENCE_BADGE.NOISE,
  });

  for (const s of clean) {
    let bestIdx = -1;
    let bestSim = -1;

    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      // Compare to centroid snapshot (fast)
      const cent = c.centroid || centroidOf(c);
      const sim = scoreSimilarity(s, cent, cfg);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestSim >= cfg.THRESH_SAME && bestIdx >= 0) {
      clusters[bestIdx].sessions.push(s);
      // Refresh centroid lightly (recompute from sessions)
      clusters[bestIdx].centroid = centroidOf(clusters[bestIdx]);
    } else {
      clusters.push(newCluster(s));
    }
  }

  // Final pass: label + confidence + summaries
  for (const c of clusters) {
    const meta = computeClusterConfidence(c, cfg);
    c.confidence = meta.confidence;
    c.badge = meta.badge;
    c.label = labelCluster(c, null, cfg);
    c.summary = summarizeCluster(c, cfg);
  }

  // Sort clusters by (label priority, confidence, recency)
  const labelRank = (lab) => {
    switch (lab) {
      case CLUSTER_LABEL.CONFIRMED: return 4;
      case CLUSTER_LABEL.EMERGING: return 3;
      case CLUSTER_LABEL.SEED: return 2;
      case CLUSTER_LABEL.DRIFTING: return 1;
      case CLUSTER_LABEL.REVIEW: return 0;
      default: return 0;
    }
  };

  clusters.sort((a, b) => {
    const ra = labelRank(a.label);
    const rb = labelRank(b.label);
    if (rb !== ra) return rb - ra;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const aNew = Math.max(...a.sessions.map((s) => s.ts));
    const bNew = Math.max(...b.sessions.map((s) => s.ts));
    return bNew - aNew;
  });

  return clusters;
}

// ----------------------------
// Auto-summary per SESSION
// ----------------------------
export function summarizeSession(session) {
  const s = session || {};
  const w = s.whiff || {};
  const bits = [];

  if (s.strain) bits.push(String(s.strain).toUpperCase());
  if (s.status) bits.push(`status:${normArr(s.status).join("/")}`);
  if (s.target) bits.push(`target:${normArr(s.target).join("/")}`);

  const wh = [];
  if (w.bodyFirst) wh.push(`body:${w.bodyFirst}`);
  if (w.eyeResponse) wh.push(`eyes:${w.eyeResponse}`);
  if (w.headSpeed) wh.push(`head:${w.headSpeed}`);
  if (w.mouthFeel) wh.push(`mouth:${w.mouthFeel}`);
  if (w.social) wh.push(`social:${w.social}`);
  if (w.threat) wh.push(`threat:${w.threat}`);
  if (wh.length) bits.push(`whiff[${wh.join(", ")}]`);

  const z = safeNumZ(s.severity);
  if (z !== null) bits.push(`Z${Math.round(z * 10) / 10}`);

  return bits.join(" • ");
}
