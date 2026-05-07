const manager = new SearchManager("fr");
let helperInjected = false;
let unsubscribeManager = null;

function getWords() {
  const startIn = document.querySelector(".PlasmicLobby_start__UfTYb input");
  const destIn = document.querySelector(".PlasmicLobby_destination__W5Hn0 input");
  const targetDest = document.querySelector(".PlasmicWiki_slotTargetDestination__i4_cc");

  let start = startIn?.value?.trim();
  if (!start) {
    const h1 = document.querySelector("#firstHeading") || document.querySelector(".firstHeading") || document.querySelector("h1");
    if (h1) start = h1.innerText.split("[")[0].trim();
  }

  const goal = destIn?.value?.trim() || targetDest?.innerText?.trim();
  return { start, goal };
}

function normalizeWikiTitle(title) {
  if (!title) return "";
  return title.replace(/_/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getSelectedLanguage() {
  const select = document.getElementById("helper-lang-select");
  if (!select) return "fr";
  return (select.value || "fr").trim().toLowerCase();
}

function updateLanguageHint() {
  const hint = document.getElementById("helper-lang-hint");
  const select = document.getElementById("helper-lang-select");
  if (!hint || !select) return;
  hint.innerText = `Langue sélectionnée : ${select.value}`;
}

function removeFloatingUI() {
  const panel = document.getElementById("wikirace-floating-helper");
  if (panel) panel.remove();
  helperInjected = false;
}

function renderPathFromState(state) {
  const pathDiv = document.getElementById("helper-path");
  if (!pathDiv) return;

  if (!Array.isArray(state.path) || state.path.length < 2) {
    pathDiv.innerHTML = `<div class="helper-empty">Aucun chemin affiché.</div>`;
    return;
  }

  const lang = state.lang || "fr";
  const labels = Array.isArray(state.labels) ? state.labels : [];
  const steps = [];

  for (let index = 1; index < state.path.length; index++) {
    const title = state.path[index];
    const safeTitle = escapeHtml(title);
    const pageUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

    const labelInfo = labels[index - 1];
    const label = labelInfo?.label ? escapeHtml(labelInfo.label) : "Lien confirmé";
    const href = labelInfo?.href
      ? `https://${lang}.wikipedia.org${labelInfo.href}`
      : pageUrl;

    steps.push(`
      <div class="path-step">
        <div class="path-step-top">
          <div class="path-step-content">
            <a class="path-label-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>
            <div class="path-target-line">
              <span class="path-arrow">→</span>
              <span class="path-title-exact">${safeTitle}</span>
            </div>
          </div>
          <span class="path-status status-ok">ok</span>
        </div>
      </div>
    `);
  }

  pathDiv.innerHTML = steps.join("");
}

function renderState(state) {
  const info = document.getElementById("helper-info");
  const goBtn = document.getElementById("helper-go-btn");
  const stopBtn = document.getElementById("helper-stop-btn");

  if (info) {
    info.innerHTML = [
      `Langue : <b>${escapeHtml(state.lang || "fr")}</b>`,
      `Visités : <b>${state.total || 0}</b>`,
      `Front départ : <b>${state.frontStart || 0}</b>`,
      `Front arrivée : <b>${state.frontGoal || 0}</b>`,
      state.cached ? `<b>Cache local utilisé</b>` : "",
      state.allLinksConfirmed ? `<b>Liens confirmés</b>` : ""
    ].filter(Boolean).join(" · ");
  }

  if (goBtn) goBtn.disabled = !!state.running;
  if (stopBtn) stopBtn.disabled = !state.running;

  renderPathFromState(state);
}

function buildPanel() {
  const panel = document.createElement("div");
  panel.id = "wikirace-floating-helper";
  panel.innerHTML = `
    <div class="helper-header" id="helper-header">
      <b>WIKIRACE HELPER</b>
      <div class="helper-header-actions">
        <span id="helper-toggle-icon">▾</span>
        <button id="helper-close-btn" title="Fermer">×</button>
      </div>
    </div>

    <div class="helper-body" id="helper-body">
      <div class="helper-lang-box">
        <label for="helper-lang-select">Langue Wikipédia</label>
        <select id="helper-lang-select">
          <option value="fr" selected>fr</option>
          <option value="en">en</option>
          <option value="es">es</option>
          <option value="de">de</option>
          <option value="it">it</option>
          <option value="pt">pt</option>
        </select>
        <div id="helper-lang-hint">Langue sélectionnée : fr</div>
      </div>

      <div id="helper-info">En attente...</div>

      <div id="helper-path">
        <div class="helper-empty">Aucun chemin affiché.</div>
      </div>

      <div class="helper-actions">
        <button id="helper-go-btn">Chercher</button>
        <button id="helper-stop-btn" disabled>Stop</button>
      </div>
    </div>
  `;

  return panel;
}

function attachPanelEvents(panel) {
  const closeBtn = panel.querySelector("#helper-close-btn");
  const header = panel.querySelector("#helper-header");
  const body = panel.querySelector("#helper-body");
  const toggleIcon = panel.querySelector("#helper-toggle-icon");
  const goBtn = panel.querySelector("#helper-go-btn");
  const stopBtn = panel.querySelector("#helper-stop-btn");
  const langSelect = panel.querySelector("#helper-lang-select");

  let collapsed = false;

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeFloatingUI();
  });

  header.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "flex";
    toggleIcon.innerText = collapsed ? "▸" : "▾";
  });

  langSelect.addEventListener("change", () => {
    const nextLang = getSelectedLanguage();
    manager.setLanguage(nextLang);
    updateLanguageHint();
    renderState(manager.getStatus());
  });

  goBtn.addEventListener("click", async () => {
    const { start, goal } = getWords();

    if (!start || !goal) {
      const pathDiv = document.getElementById("helper-path");
      if (pathDiv) {
        pathDiv.innerHTML = `<div class="helper-empty">Départ ou arrivée introuvable sur la page.</div>`;
      }
      return;
    }

    const lang = getSelectedLanguage();
    manager.setLanguage(lang);

    try {
      await manager.start(normalizeWikiTitle(start), normalizeWikiTitle(goal));
    } catch (error) {
      const state = manager.getStatus();
      state.logs.push(`Erreur inattendue : ${error?.message || error}`);
      renderState(state);
    }
  });

  stopBtn.addEventListener("click", () => {
    manager.stop();
    renderState(manager.getStatus());
  });
}

function injectFloatingUI() {
  if (helperInjected) return;

  removeFloatingUI();

  const panel = buildPanel();
  document.body.appendChild(panel);
  attachPanelEvents(panel);

  if (unsubscribeManager) unsubscribeManager();
  unsubscribeManager = manager.subscribe((state) => {
    renderState(state);
  });

  updateLanguageHint();
  renderState(manager.getStatus());
  helperInjected = true;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "TOGGLE_HELPER") return;

  const existing = document.getElementById("wikirace-floating-helper");
  if (existing) {
    removeFloatingUI();
  } else {
    injectFloatingUI();
  }
});