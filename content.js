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
        .replace(/'/g, "&#039;");
}

function detectWikiLanguage() {
    const host = window.location.hostname || "";
    const wikiMatch = host.match(/^([a-z-]+)\.wikipedia\.org$/i);
    if (wikiMatch) return wikiMatch[1].toLowerCase();

    const docLang = (document.documentElement.lang || "").trim().toLowerCase();
    if (docLang) return docLang.split("-")[0];

    const pageText = document.body?.innerText || "";
    if (/wikipédia/i.test(pageText)) return "fr";
    if (/wikipedia/i.test(pageText)) return "en";

    return "fr";
}

function getSelectedLanguage() {
    const select = document.getElementById("helper-lang-select");
    if (!select) return "fr";
    if (select.value === "auto") {
        return detectWikiLanguage();
    }
    return select.value;
}

function updateLanguageHint() {
    const hint = document.getElementById("helper-lang-hint");
    const select = document.getElementById("helper-lang-select");
    if (!hint || !select) return;

    const detected = detectWikiLanguage();
    if (select.value === "auto") {
        hint.innerText = `Auto détectée : ${detected}`;
    } else {
        hint.innerText = `Langue manuelle : ${select.value}`;
    }
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
        pathDiv.innerHTML = "<div class='helper-empty'>Aucun chemin trouvé.</div>";
        return;
    }

    if (!Array.isArray(state.labels) || state.labels.length === 0) {
        pathDiv.innerHTML = "<div class='helper-empty'>Aucun lien confirmé disponible.</div>";
        return;
    }

    let htmlStr = "";

    for (let i = 0; i < state.labels.length; i++) {
        const item = state.labels[i] || {};
        const targetTitle = item.to || state.path[i + 1] || "?";
        const label = item.label || targetTitle;
        const href = item.href || `/wiki/${encodeURIComponent(normalizeWikiTitle(targetTitle).replace(/ /g, "_"))}`;

        htmlStr += `
      <div class="path-step">
        <div class="path-step-top">
          <span class="path-label-main">${escapeHtml(label)}</span>
          <span class="path-status status-ok">confirmé</span>
        </div>
        <div class="path-link-line">
          lien : <a class="path-title-link" href="https://${escapeHtml(state.lang || "fr")}.wikipedia.org${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(targetTitle)}</a>
        </div>
      </div>
    `;
    }

    pathDiv.innerHTML = htmlStr || "<div class='helper-empty'>Aucune étape confirmée disponible.</div>";
}

function updateUI(state) {
    const info = document.getElementById("helper-info");
    const pathDiv = document.getElementById("helper-path");
    if (!info || !pathDiv) return;

    if (state.running) {
        info.innerText = `Exploration (${state.lang})... ${state.total} pages | file départ ${state.frontStart} | file arrivée ${state.frontGoal}`;
        if (!state.path.length) {
            pathDiv.innerHTML = "<div class='helper-loading'>Recherche en arrière-plan...</div>";
        }
        return;
    }

    if (state.path.length > 0) {
        info.innerText = state.cached
            ? `Chemin trouvé (${state.lang}, cache local).`
            : `Chemin trouvé (${state.lang}).`;
        renderPathFromState(state);
        sessionStorage.setItem("wikisavedpath", JSON.stringify({ path: state.path, labels: state.labels, lang: state.lang }));
        return;
    }

    if (state.logs.length > 0) {
        info.innerText = state.logs[state.logs.length - 1];
        pathDiv.innerHTML = "<div class='helper-empty'>Aucun résultat.</div>";
    }
}

function restoreSavedPath() {
    const saved = sessionStorage.getItem("wikisavedpath");
    if (!saved) return;

    try {
        const parsed = JSON.parse(saved);
        renderPathFromState({
            path: parsed.path || [],
            labels: parsed.labels || [],
            lang: parsed.lang || "fr"
        });
        const info = document.getElementById("helper-info");
        if (info) info.innerText = "Dernier chemin restauré depuis la session.";
    } catch {
        sessionStorage.removeItem("wikisavedpath");
    }
}

function ensureSubscription() {
    if (unsubscribeManager) return;
    unsubscribeManager = manager.subscribe((state) => {
        if (document.getElementById("wikirace-floating-helper")) {
            updateUI(state);
        }
    });
}

function injectFloatingUI() {
    if (helperInjected || document.getElementById("wikirace-floating-helper")) return;
    ensureSubscription();

    const panel = document.createElement("div");
    panel.id = "wikirace-floating-helper";
    panel.innerHTML = `
    <div class="helper-header" id="helper-toggle">
      <b>WIKIRACE HELPER</b>
      <div class="helper-header-actions">
        <span id="helper-toggle-icon">▾</span>
        <button id="helper-close" title="Fermer">×</button>
      </div>
    </div>
    <div class="helper-body" id="helper-body">
      <div class="helper-lang-box">
        <label for="helper-lang-select">Langue :</label>
        <select id="helper-lang-select">
          <option value="auto">Auto</option>
          <option value="fr">fr</option>
          <option value="en">en</option>
          <option value="es">es</option>
          <option value="de">de</option>
          <option value="it">it</option>
        </select>
        <div id="helper-lang-hint">Auto détectée : ${detectWikiLanguage()}</div>
      </div>
      <div id="helper-info">Prêt à scanner.</div>
      <div id="helper-path">---</div>
      <div class="helper-actions">
        <button id="helper-go-btn">CALCULER LE CHEMIN</button>
        <button id="helper-stop-btn" class="secondary-btn">STOP</button>
      </div>
    </div>
  `;

    document.body.appendChild(panel);
    helperInjected = true;

    const toggle = document.getElementById("helper-toggle");
    const toggleIcon = document.getElementById("helper-toggle-icon");
    const body = document.getElementById("helper-body");
    const closeBtn = document.getElementById("helper-close");
    const goBtn = document.getElementById("helper-go-btn");
    const stopBtn = document.getElementById("helper-stop-btn");
    const langSelect = document.getElementById("helper-lang-select");

    langSelect.addEventListener("change", () => {
        updateLanguageHint();
    });

    toggle.addEventListener("click", (e) => {
        if (e.target.id === "helper-close") return;
        const isHidden = body.style.display === "none";
        body.style.display = isHidden ? "flex" : "none";
        toggleIcon.innerText = isHidden ? "▾" : "▸";
    });

    closeBtn.addEventListener("click", () => {
        removeFloatingUI();
    });

    stopBtn.addEventListener("click", () => {
        manager.stop();
    });

    goBtn.addEventListener("click", async () => {
        const { start, goal } = getWords();
        const info = document.getElementById("helper-info");
        const pathDiv = document.getElementById("helper-path");
        const lang = getSelectedLanguage();

        if (!goal) {
            info.innerText = "Destination non trouvée.";
            return;
        }

        if (!start) {
            info.innerText = "Point de départ non trouvé.";
            return;
        }

        manager.setLanguage(lang);
        updateLanguageHint();

        info.innerText = `Recherche (${lang}) : ${start} -> ${goal}`;
        pathDiv.innerHTML = "<div class='helper-loading'>Algorithme en cours...</div>";
        manager.start(start, goal);
    });

    updateLanguageHint();
    updateUI(manager.getStatus());
    restoreSavedPath();
}

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "TOGGLE_HELPER") {
        const panel = document.getElementById("wikirace-floating-helper");
        if (panel) removeFloatingUI();
        else injectFloatingUI();
    }
});