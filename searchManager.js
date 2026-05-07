class SearchManager {
  constructor(defaultLang = "fr") {
    this.lang = defaultLang;
    this.wiki = new WikiPath(this.lang);
    this.state = {
      running: false,
      logs: [],
      path: [],
      labels: [],
      total: 0,
      frontStart: 0,
      frontGoal: 0,
      cached: false,
      allLinksConfirmed: false,
      completedAt: 0,
      lang: this.lang
    };
    this.listeners = new Set();
    this.currentPromise = null;
  }

  setLanguage(lang) {
    const nextLang = (lang || "fr").trim().toLowerCase();
    if (this.state.running) return false;
    if (nextLang === this.lang) return true;

    this.lang = nextLang;
    this.wiki = new WikiPath(this.lang);
    this.state.lang = this.lang;
    this.emit();
    return true;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (_) {}
    }
  }

  async start(start, goal) {
    if (this.state.running) return;

    this.state = {
      ...this.state,
      running: true,
      logs: [`Démarrage (${this.lang})...`],
      path: [],
      labels: [],
      total: 0,
      frontStart: 0,
      frontGoal: 0,
      cached: false,
      allLinksConfirmed: false,
      completedAt: 0,
      lang: this.lang
    };
    this.emit();

    this.currentPromise = this.wiki.findPath(start, goal, {
      logCb: (msg) => {
        this.state.logs.push(msg);
        this.emit();
      },
      progressCb: (stats) => {
        this.state.total = stats.total || 0;
        this.state.frontStart = stats.frontStart || 0;
        this.state.frontGoal = stats.frontGoal || 0;
        this.emit();
      }
    });

    const result = await this.currentPromise;
    this.state.running = false;

    if (result.ok) {
      this.state.path = result.path || [];
      this.state.labels = result.labels || [];
      this.state.cached = !!result.cached;
      this.state.allLinksConfirmed = !!result.allLinksConfirmed;
      this.state.logs.push(result.cached ? "Chemin chargé depuis le cache local." : "Chemin trouvé.");
    } else {
      this.state.logs.push("Erreur : " + result.error);
    }

    this.state.completedAt = Date.now();
    this.emit();
  }

  stop() {
    this.wiki.stopRequested = true;
    this.state.running = false;
    this.state.logs.push("Recherche arrêtée.");
    this.emit();
  }

  getStatus() {
    return this.state;
  }
}