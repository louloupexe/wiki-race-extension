class WikiPath {
  constructor(lang = "fr") {
    this.lang = lang;
    this.baseUrl = `https://${lang}.wikipedia.org/w/api.php`;
    this.wikiPrefix = "/wiki/";
    this.lastRequestTime = 0;
    this.minRequestInterval = 180;
    this.htmlLinksCache = new Map();
    this.backlinksCache = new Map();
    this.pathCache = new Map();
    this.stopRequested = false;
    this.storagePrefix = `wikirace_${lang}`;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async rateLimit() {
    const now = Date.now();
    const diff = now - this.lastRequestTime;
    if (diff < this.minRequestInterval) {
      await this.sleep(this.minRequestInterval - diff);
    }
    this.lastRequestTime = Date.now();
  }

  normalizeTitle(title) {
    if (!title || typeof title !== "string") return null;
    const clean = title.replace(/_/g, " ").trim();
    if (!clean) return null;
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  isParasite(title) {
    if (!title) return true;
    const prefixes = [
      "Catégorie:", "Fichier:", "Modèle:", "Wikipédia:", "Portail:",
      "Aide:", "Discussion:", "Projet:", "Spécial:", "MediaWiki:", "Module:"
    ];
    if (prefixes.some((prefix) => title.startsWith(prefix))) return true;

    const lowered = title.toLowerCase();
    const blockedStarts = ["liste de", "liste des", "chronologie", "années ", "année "];
    return blockedStarts.some((start) => lowered.startsWith(start));
  }

  makePathKey(start, goal) {
    return `${this.storagePrefix}_path_${start}__${goal}`;
  }

  makeLinksKey(title) {
    return `${this.storagePrefix}_links_${title}`;
  }

  makeBacklinksKey(title) {
    return `${this.storagePrefix}_backlinks_${title}`;
  }

  async storageGet(key) {
    if (!chrome?.storage?.local) return null;
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => resolve(result?.[key] ?? null));
    });
  }

  async storageSet(obj) {
    if (!chrome?.storage?.local) return;
    return new Promise((resolve) => {
      chrome.storage.local.set(obj, () => resolve());
    });
  }

  async requestJson(params) {
    if (this.stopRequested) return null;

    const query = new URLSearchParams({
      ...params,
      format: "json",
      origin: "*",
      maxlag: "5"
    });

    if (params.action !== "opensearch") {
      query.set("formatversion", "2");
    }

    await this.rateLimit();

    try {
      const response = await fetch(`${this.baseUrl}?${query.toString()}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.error("Erreur API Wikipédia :", e);
      return null;
    }
  }

  async getStoredPath(start, goal) {
    const key = this.makePathKey(start, goal);
    const local = this.pathCache.get(key);
    if (local) return local;

    const stored = await this.storageGet(key);
    if (stored?.path?.length) {
      this.pathCache.set(key, stored);
      return stored;
    }
    return null;
  }

  async saveStoredPath(start, goal, path, labels = []) {
    const key = this.makePathKey(start, goal);
    const value = {
      start,
      goal,
      path,
      labels,
      updatedAt: Date.now()
    };
    this.pathCache.set(key, value);
    await this.storageSet({ [key]: value });
  }

  async extractConfirmedHtmlLinks(sourceTitle, maxLinks = 250) {
    sourceTitle = this.normalizeTitle(sourceTitle);
    if (!sourceTitle) return [null, []];

    if (this.htmlLinksCache.has(sourceTitle)) {
      return [sourceTitle, this.htmlLinksCache.get(sourceTitle)];
    }

    const storageKey = this.makeLinksKey(sourceTitle);
    const stored = await this.storageGet(storageKey);
    if (stored?.links?.length) {
      this.htmlLinksCache.set(sourceTitle, stored.links);
      return [sourceTitle, stored.links];
    }

    const data = await this.requestJson({
      action: "parse",
      page: sourceTitle,
      prop: "text"
    });

    if (!data?.parse?.text) {
      return [sourceTitle, []];
    }

    const htmlText = typeof data.parse.text === "string"
      ? data.parse.text
      : (data.parse.text?.["*"] || Object.values(data.parse.text || {})[0] || "");

    const pattern = /<a\b[^>]*href="(\/wiki\/[^"#:\?]+(?:#[^"]*)?)"[^>]*>(.*?)<\/a>/gi;
    const found = [];
    const seen = new Set();
    let match;

    while ((match = pattern.exec(htmlText)) !== null && found.length < maxLinks) {
      const hrefNoFragment = match[1].split("#")[0];
      if (!hrefNoFragment.startsWith(this.wikiPrefix)) continue;

      const rawTitle = hrefNoFragment.slice(this.wikiPrefix.length);
      const pageTitle = this.normalizeTitle(decodeURIComponent(rawTitle).replace(/_/g, " ").trim());
      if (!pageTitle || this.isParasite(pageTitle)) continue;

      const anchorText = match[2]
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .trim() || pageTitle;

      if (seen.has(pageTitle)) continue;
      seen.add(pageTitle);

      found.push({
        from: sourceTitle,
        to: pageTitle,
        label: anchorText,
        href: hrefNoFragment,
        found: true
      });
    }

    this.htmlLinksCache.set(sourceTitle, found);
    await this.storageSet({
      [storageKey]: {
        title: sourceTitle,
        links: found,
        updatedAt: Date.now()
      }
    });

    return [sourceTitle, found];
  }

  async getBacklinks(title, maxLinks = 80) {
    title = this.normalizeTitle(title);
    if (!title) return [null, []];

    if (this.backlinksCache.has(title)) {
      return [title, this.backlinksCache.get(title)];
    }

    const storageKey = this.makeBacklinksKey(title);
    const stored = await this.storageGet(storageKey);
    if (stored?.links?.length) {
      this.backlinksCache.set(title, stored.links);
      return [title, stored.links];
    }

    const data = await this.requestJson({
      action: "query",
      list: "backlinks",
      bltitle: title,
      blnamespace: "0",
      blfilterredir: "nonredirects",
      bllimit: "max"
    });

    const links = (data?.query?.backlinks || [])
      .map((b) => this.normalizeTitle(b.title))
      .filter((t) => t && !this.isParasite(t))
      .slice(0, maxLinks);

    this.backlinksCache.set(title, links);
    await this.storageSet({
      [storageKey]: {
        title,
        links,
        updatedAt: Date.now()
      }
    });

    return [title, links];
  }

  reconstructPath(parentsStart, parentsGoal, meeting) {
    const left = [];
    let cur = meeting;
    while (cur !== null && cur !== undefined) {
      left.push(cur);
      cur = parentsStart[cur];
    }
    left.reverse();

    const right = [];
    cur = parentsGoal[meeting];
    while (cur !== null && cur !== undefined) {
      right.push(cur);
      cur = parentsGoal[cur];
    }

    return left.concat(right);
  }

  async buildLabelsFromPath(path) {
    const labels = [];
    if (path.length < 2) return labels;

    for (let i = 0; i < path.length - 1; i++) {
      const source = path[i];
      const target = path[i + 1];
      const [, links] = await this.extractConfirmedHtmlLinks(source, 500);
      const labelInfo = links.find((item) => this.normalizeTitle(item.to) === this.normalizeTitle(target));
      if (!labelInfo) {
        return null;
      }
      labels.push(labelInfo);
    }

    return labels;
  }

  async finalizeFoundPath(startTitle, goalTitle, path) {
    const labels = await this.buildLabelsFromPath(path);
    if (!labels) {
      return null;
    }

    await this.saveStoredPath(startTitle, goalTitle, path, labels);
    return {
      ok: true,
      path,
      labels,
      allLinksConfirmed: true
    };
  }

  async findPath(start, goal, { logCb, progressCb } = {}) {
    this.stopRequested = false;

    const startTitle = this.normalizeTitle(start);
    const goalTitle = this.normalizeTitle(goal);

    if (!startTitle || !goalTitle) {
      return { ok: false, error: "Point de départ ou destination invalide" };
    }

    if (startTitle === goalTitle) {
      return {
        ok: true,
        path: [startTitle],
        labels: [],
        allLinksConfirmed: true,
        cached: true
      };
    }

    const cached = await this.getStoredPath(startTitle, goalTitle);
    if (cached?.path?.length >= 2) {
      return {
        ok: true,
        path: cached.path,
        labels: cached.labels || [],
        allLinksConfirmed: true,
        cached: true
      };
    }

    const qStart = [startTitle];
    const qGoal = [goalTitle];
    const parentsStart = { [startTitle]: null };
    const parentsGoal = { [goalTitle]: null };
    const visitedStart = new Set([startTitle]);
    const visitedGoal = new Set([goalTitle]);

    while (qStart.length > 0 && qGoal.length > 0) {
      if (this.stopRequested) {
        return { ok: false, error: "Recherche arrêtée" };
      }

      const currStart = qStart.shift();
      logCb?.(`DÉPART ${currStart}`);
      const [, confirmedLinks] = await this.extractConfirmedHtmlLinks(currStart, 250);

      for (const item of confirmedLinks) {
        const link = item.to;
        if (!visitedStart.has(link)) {
          visitedStart.add(link);
          parentsStart[link] = currStart;
          qStart.push(link);

          if (link === goalTitle || visitedGoal.has(link)) {
            const candidatePath = this.reconstructPath(parentsStart, parentsGoal, link);
            const result = await this.finalizeFoundPath(startTitle, goalTitle, candidatePath);
            if (result) return { ...result, cached: false };
            logCb?.(`REJET lien non confirmé dans le chemin : ${candidatePath.join(" -> ")}`);
          }
        }
      }

      progressCb?.({
        total: visitedStart.size + visitedGoal.size,
        frontStart: qStart.length,
        frontGoal: qGoal.length,
        running: true
      });

      if (!qGoal.length) break;
      if (this.stopRequested) {
        return { ok: false, error: "Recherche arrêtée" };
      }

      const currGoal = qGoal.shift();
      logCb?.(`ARRIVÉE ${currGoal}`);
      const [, inlinks] = await this.getBacklinks(currGoal, 80);

      for (const link of inlinks) {
        if (!visitedGoal.has(link)) {
          visitedGoal.add(link);
          parentsGoal[link] = currGoal;
          qGoal.push(link);

          if (visitedStart.has(link)) {
            const candidatePath = this.reconstructPath(parentsStart, parentsGoal, link);
            const result = await this.finalizeFoundPath(startTitle, goalTitle, candidatePath);
            if (result) return { ...result, cached: false };
            logCb?.(`REJET lien non confirmé dans le chemin : ${candidatePath.join(" -> ")}`);
          }
        }
      }

      progressCb?.({
        total: visitedStart.size + visitedGoal.size,
        frontStart: qStart.length,
        frontGoal: qGoal.length,
        running: true
      });
    }

    return { ok: false, error: "Aucun chemin 100% hyperlien confirmé trouvé" };
  }
}