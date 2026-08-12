const KEYS = {
  collections: "newsweekly_collections",
  saved: "newsweekly_savedsearches",
  feedback: "newsweekly_feedback",
  prompt: "masterPrompt",
};

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const collections = {
  list() {
    return read(KEYS.collections, []);
  },
  save(list) {
    write(KEYS.collections, list);
  },
  create(name, items = []) {
    const list = this.list();
    const coll = { id: uid(), name, items };
    this.save([...list, coll]);
    return coll;
  },
  addItems(collId, newItems) {
    const list = this.list();
    const next = list.map((c) => {
      if (c.id !== collId) return c;
      const existing = new Set(c.items.map((i) => i.key));
      return {
        ...c,
        items: [...c.items, ...newItems.filter((i) => !existing.has(i.key))],
      };
    });
    this.save(next);
    return next.find((c) => c.id === collId);
  },
  removeItems(collId, keys) {
    const list = this.list();
    const drop = new Set(keys);
    const next = list.map((c) =>
      c.id === collId
        ? { ...c, items: c.items.filter((i) => !drop.has(i.key)) }
        : c,
    );
    this.save(next);
    return next.find((c) => c.id === collId);
  },
  remove(collId) {
    this.save(this.list().filter((c) => c.id !== collId));
  },
};

export const savedSearches = {
  list() {
    return read(KEYS.saved, []);
  },
  add(name, params) {
    const item = { id: uid(), name, ...params, createdAt: Date.now() };
    this.save([...this.list(), item]);
    return item;
  },
  remove(id) {
    this.save(this.list().filter((s) => s.id !== id));
  },
};

export const feedback = {
  list() {
    return read(KEYS.feedback, []);
  },
  add(text) {
    const item = { id: uid(), text, at: new Date().toISOString() };
    this.save([...this.list(), item]);
    return item;
  },
};

export { uid };
