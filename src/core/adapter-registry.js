'use strict';

class AdapterRegistry {
  constructor() {
    this._adapters = new Map();
  }

  register(adapter) {
    if (!adapter?.manifest?.id) throw new Error('adapter must have manifest.id');
    this._adapters.set(adapter.manifest.id, adapter);
  }

  get(id) { return this._adapters.get(id) || null; }
  getAll() { return Array.from(this._adapters.values()); }
  has(id) { return this._adapters.has(id); }
}

module.exports = AdapterRegistry;
