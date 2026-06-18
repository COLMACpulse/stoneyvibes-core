/* terpenes.js — StoneyVibes v1 (CONDENSED UI)
   Presence-only terpene draft:
   NP = Not Present
   BG = Background
   N  = Noticeable
   D  = Dominant

   Update:
   - condensed single-row layout per terpene
   - tap active level again = clears selection
*/

(() => {
  const DRAFT_KEY = "sv_terp_draft_v1";

  const TERPENES = [
    { id: "myrcene", label: "Myrcene" },
    { id: "limonene", label: "Limonene" },
    { id: "caryophyllene", label: "β-Caryophyllene" },
    { id: "pinene", label: "α/β-Pinene" },
    { id: "linalool", label: "Linalool" },
    { id: "terpinolene", label: "Terpinolene" },
  ];

  const LEVELS = [
    { v: "NP", t: "NP" },
    { v: "BG", t: "BG" },
    { v: "N",  t: "N"  },
    { v: "D",  t: "D"  },
  ];

  const $ = (id) => document.getElementById(id);

  const backBtn = $("backBtn");
  const terpList = $("terpList");
  const saveDraftBtn = $("saveDraftBtn");
  const clearDraftBtn = $("clearDraftBtn");
  const draftStatus = $("draftStatus");

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadDraft() {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveDraft(obj) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(obj));
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  function nowStamp() {
    const d = new Date();
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function setStatus(text) {
    if (draftStatus) draftStatus.textContent = text;
  }

  function render() {
    if (!terpList) return;
    terpList.innerHTML = "";

    const draft = loadDraft() || { values: {}, updatedAt: null };
    const values = draft.values || {};

    for (const terp of TERPENES) {
      const current = values[terp.id] || "";

      const el = document.createElement("div");
      el.className = "item";

      const btns = LEVELS.map((L) => {
        const active = current === L.v ? " active" : "";
        return `
          <button
            class="btn btnTiny btnTog${active}"
            type="button"
            data-terp="${escapeHtml(terp.id)}"
            data-val="${escapeHtml(L.v)}"
            style="padding:6px 10px; min-width:42px;"
          >${escapeHtml(L.t)}</button>
        `;
      }).join("");

      // CONDENSED: one row, label + buttons on same line
      el.innerHTML = `
        <div class="itemHead" style="align-items:center; gap:10px;">
          <p class="itemTitle" style="margin:0; line-height:1.15;">${escapeHtml(terp.label)}</p>
          <div class="itemBtns" style="gap:6px;">
            ${btns}
          </div>
        </div>
      `;

      terpList.appendChild(el);
    }

    // bind handlers (scoped to this page)
    const buttons = Array.from(terpList.querySelectorAll("[data-terp][data-val]"));
    buttons.forEach((b) => {
      b.onclick = () => {
        const terpId = b.getAttribute("data-terp");
        const val = b.getAttribute("data-val");
        if (!terpId || !val) return;

        const draftNow = loadDraft() || { values: {}, updatedAt: null };
        draftNow.values = draftNow.values || {};

        const current = draftNow.values[terpId] || "";

        // tap active again = clear
        if (current === val) {
          delete draftNow.values[terpId];
        } else {
          draftNow.values[terpId] = val;
        }

        draftNow.updatedAt = Date.now();
        saveDraft(draftNow);

        // update active state for that terp row
        const rowBtns = Array.from(terpList.querySelectorAll(`[data-terp="${CSS.escape(terpId)}"]`));
        const newVal = draftNow.values[terpId] || "";
        rowBtns.forEach((x) => x.classList.toggle("active", (x.getAttribute("data-val") || "") === newVal));

        setStatus(`Draft updated — ${nowStamp()}`);
      };
    });

    if (draft.updatedAt) setStatus(`Draft saved — ${new Date(draft.updatedAt).toLocaleString()}`);
    else setStatus("No draft yet.");
  }

  function collectCurrentFromUI() {
    const out = {};
    for (const terp of TERPENES) {
      const active = terpList
        ? terpList.querySelector(`[data-terp="${CSS.escape(terp.id)}"].active`)
        : document.querySelector(`[data-terp="${CSS.escape(terp.id)}"].active`);
      if (active) out[terp.id] = active.getAttribute("data-val") || "";
    }
    return out;
  }

  // nav
  if (backBtn) {
    backBtn.onclick = () => {
      window.location.href = "./index.html";
    };
  }

  if (saveDraftBtn) {
    saveDraftBtn.onclick = () => {
      const values = collectCurrentFromUI();
      const draft = { values, updatedAt: Date.now() };
      saveDraft(draft);
      setStatus(`Draft saved — ${nowStamp()}`);
      alert("Draft saved.");
    };
  }

  if (clearDraftBtn) {
    clearDraftBtn.onclick = () => {
      const ok = confirm("Clear terpene draft on this device?");
      if (!ok) return;
      clearDraft();
      render();
      setStatus("No draft yet.");
      alert("Draft cleared.");
    };
  }

  // init
  render();
})();
