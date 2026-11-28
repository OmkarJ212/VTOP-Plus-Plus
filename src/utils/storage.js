// Storage Utility: persistent settings, localStorage mirror, and TTL-scoped caches.

(function () {
  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const DEFAULT_SETTINGS = {
    enableDownloader: true,
    enableCourseFilter: true,
    enableAttendanceCalc: true,
    enableFatPredictor: true,
    enableDaTracker: true,
    enableDaHomeCard: true,
    enableScheduleWidget: true,
    enableHomeMessages: true,
    enableMarksNotifier: true,
    enableAutoCaptcha: true,
    enableSpotlight: true,
    enableQuickDock: true,
    enableDarkMode: false
  };

  const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
  const SETTINGS_KEY_SET = new Set(SETTINGS_KEYS);
  const SETTINGS_MIRROR_KEY = 'vtop_plus_settings_v1';

  function getWebStore(area) {
    try {
      return area === 'local' ? window.localStorage : window.sessionStorage;
    } catch (_) {
      return null;
    }
  }

  function readSettingsMirror() {
    const store = getWebStore('local');
    if (!store) return null;
    try {
      const raw = store.getItem(SETTINGS_MIRROR_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeSettingsMirror(partial) {
    if (!partial || typeof partial !== 'object') return;
    const store = getWebStore('local');
    if (!store) return;
    try {
      const merged = { ...DEFAULT_SETTINGS, ...(readSettingsMirror() || {}), ...partial };
      store.setItem(SETTINGS_MIRROR_KEY, JSON.stringify(merged));
    } catch (_) {}
  }

  function isEntryValid(entry, { ttlMs = 0, timestampField = 'timestamp', badgeText = '', authId = '', validate } = {}) {
    if (!entry || typeof entry !== 'object') return false;
    if (ttlMs > 0) {
      const ts = Number(entry[timestampField] || 0);
      if (!ts || Date.now() - ts >= ttlMs) return false;
    }
    if (authId && entry.authId && entry.authId !== authId) return false;
    if (badgeText && entry.badgeText && entry.badgeText !== badgeText) return false;
    if (typeof validate === 'function' && !validate(entry)) return false;
    return true;
  }

  const Storage = {
    DEFAULT_SETTINGS,

    /**
     * Retrieve arbitrary keys from chrome.storage.local safely.
     */
    async get(keys) {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) {
          resolve({});
          return;
        }
        chrome.storage.local.get(keys, (items) => {
          if (chrome.runtime.lastError) {
            console.warn('[VTOP++] Error reading storage:', chrome.runtime.lastError);
            resolve({});
          } else {
            resolve(items || {});
          }
        });
      });
    },

    /**
     * Persist arbitrary key/value pairs to chrome.storage.local safely.
     */
    async set(obj) {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local || !obj || typeof obj !== 'object') {
          resolve();
          return;
        }
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime.lastError) {
            console.warn('[VTOP++] Error writing storage:', chrome.runtime.lastError);
          } else {
            const settingsPatch = {};
            let hasSetting = false;
            for (const key of Object.keys(obj)) {
              if (SETTINGS_KEY_SET.has(key)) {
                settingsPatch[key] = obj[key];
                hasSetting = true;
              }
            }
            if (hasSetting) writeSettingsMirror(settingsPatch);
          }
          resolve();
        });
      });
    },

    /**
     * Synchronous settings snapshot backed by a localStorage mirror for zero-latency boot.
     */
    getCachedSettingsSync() {
      const mirrored = readSettingsMirror();
      return mirrored ? { ...DEFAULT_SETTINGS, ...mirrored } : { ...DEFAULT_SETTINGS };
    },

    /**
     * Retrieve all current settings with fallbacks
     */
    async getSettings() {
      const items = await this.get(SETTINGS_KEYS);
      const merged = { ...DEFAULT_SETTINGS, ...(items || {}) };
      writeSettingsMirror(merged);
      return merged;
    },

    /**
     * Listen for settings changes across tabs
     */
    onChanged(callback) {
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName !== 'local') return;
          const updated = {};
          let hasSettingChange = false;
          for (const key of Object.keys(changes)) {
            if (!SETTINGS_KEY_SET.has(key)) continue;
            updated[key] = changes[key].newValue;
            hasSettingChange = true;
          }
          if (hasSettingChange) {
            writeSettingsMirror(updated);
            callback(updated);
          }
        });
      }
    },

    /**
     * Listen for specific storage keys (settings or module state) across tabs.
     */
    onKeysChanged(keys, callback) {
      if (!chrome?.storage?.onChanged) return () => {};
      const keySet = Array.isArray(keys) ? new Set(keys) : null;
      const listener = (changes, areaName) => {
        if (areaName !== 'local') return;
        const matched = {};
        let hasMatch = false;
        for (const key of Object.keys(changes)) {
          if (keySet && !keySet.has(key)) continue;
          matched[key] = changes[key].newValue;
          hasMatch = true;
        }
        if (hasMatch) callback(matched, changes);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },

    /**
     * Synchronous TTL-scoped JSON cache read for sessionStorage / localStorage.
     */
    getWebCache(key, { area = 'session', ttlMs = 0, timestampField = 'timestamp', badgeText = '', authId = '', validate } = {}) {
      const store = getWebStore(area);
      if (!store || !key) return null;
      try {
        const raw = store.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!isEntryValid(parsed, { ttlMs, timestampField, badgeText, authId, validate })) return null;
        return parsed;
      } catch (_) {
        return null;
      }
    },

    /**
     * Synchronous TTL-scoped JSON cache write for sessionStorage / localStorage.
     */
    setWebCache(key, payload, { area = 'session', timestampField = 'timestamp', addTimestamp = true } = {}) {
      const store = getWebStore(area);
      if (!store || !key) return false;
      try {
        const record =
          addTimestamp && payload && typeof payload === 'object' && !Array.isArray(payload) && payload[timestampField] === undefined
            ? { [timestampField]: Date.now(), ...payload }
            : payload;
        store.setItem(key, JSON.stringify(record));
        return true;
      } catch (_) {
        return false;
      }
    },

    /**
     * Remove all web storage keys matching a prefix.
     */
    removeWebCacheByPrefix(prefix, area = 'session') {
      const store = getWebStore(area);
      if (!store || !prefix) return;
      try {
        for (let i = store.length - 1; i >= 0; i--) {
          const k = store.key(i);
          if (k && k.startsWith(prefix)) {
            store.removeItem(k);
          }
        }
      } catch (_) {}
    },

    /**
     * Async TTL-scoped cache read across 'session', 'local', or 'chrome' storage.
     */
    async getScopedCache(key, opts = {}) {
      const area = opts.area || 'session';
      if (area === 'chrome') {
        const stored = await this.get([key]);
        const entry = stored?.[key];
        return isEntryValid(entry, opts) ? entry : null;
      }
      return this.getWebCache(key, opts);
    },

    /**
     * Async TTL-scoped cache write across 'session', 'local', or 'chrome' storage.
     */
    async setScopedCache(key, payload, opts = {}) {
      const area = opts.area || 'session';
      const timestampField = opts.timestampField || 'timestamp';
      const record =
        opts.addTimestamp !== false && payload && typeof payload === 'object' && !Array.isArray(payload) && payload[timestampField] === undefined
          ? { [timestampField]: Date.now(), ...payload }
          : payload;
      if (area === 'chrome') {
        await this.set({ [key]: record });
        return true;
      }
      return this.setWebCache(key, record, { ...opts, addTimestamp: false });
    }
  };

  window.VTOP_PLUS.Storage = Storage;

  // Apply zero-FOUC root CSS flags synchronously at document_start on VTOP pages
  if (
    typeof document !== 'undefined' &&
    document.documentElement &&
    typeof location !== 'undefined' &&
    !String(location.protocol || '').startsWith('chrome-extension')
  ) {
    const cached = Storage.getCachedSettingsSync();
    document.documentElement.classList.toggle('vtop-course-filter-enabled', cached.enableCourseFilter !== false);
    if (cached.enableDarkMode) {
      document.documentElement.classList.add('vtop-dark-theme');
    }
  }
})();
