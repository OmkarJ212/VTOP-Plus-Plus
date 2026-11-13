/**
 * VTOP++ - Storage Utility
 * Persistent configuration management for all VTOP++ modules.
 */

(function () {
  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const DEFAULT_SETTINGS = {
    enableDownloader: true,
    enableCourseFilter: true,
    enableAttendanceCalc: true,
    enableFatPredictor: true,
    enableDaTracker: true,
    enableAutoCaptcha: true,
    enableSessionKeeper: true,
    enableSpotlight: true,
    enableQuickDock: true,
    enablePrivacyMode: false,
    enableDarkMode: false,
    enableHideActionPlan: false,
    downloadPacing: 'human', // 'human', 'fast'
    attendanceTarget: 75 // 75, 80, 85, 90
  };

  function normalizePacing(val) {
    if (val === 'fast') return 'fast';
    return 'human';
  }

  const SETTINGS_KEYS = [...Object.keys(DEFAULT_SETTINGS), 'vtop_speed_mode'];
  const SETTINGS_KEY_SET = new Set(SETTINGS_KEYS);

  const Storage = {
    DEFAULT_SETTINGS,

    /**
     * Retrieve all current settings with fallbacks
     */
    async getSettings() {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) {
          resolve(DEFAULT_SETTINGS);
          return;
        }
        chrome.storage.local.get(SETTINGS_KEYS, (items) => {
          if (chrome.runtime.lastError) {
            console.warn('[VTOP++] Error reading storage:', chrome.runtime.lastError);
            resolve(DEFAULT_SETTINGS);
          } else {
            const raw = items || {};
            if (raw.vtop_speed_mode && !raw.downloadPacing) {
              raw.downloadPacing = raw.vtop_speed_mode;
            }
            if (raw.downloadPacing) {
              raw.downloadPacing = normalizePacing(raw.downloadPacing);
            }
            resolve({ ...DEFAULT_SETTINGS, ...raw });
          }
        });
      });
    },

    /**
     * Listen for settings changes across tabs
     */
    onChanged(callback) {
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local') {
            const updated = {};
            let hasSettingChange = false;
            for (const key of Object.keys(changes)) {
              if (!SETTINGS_KEY_SET.has(key)) continue;
              updated[key] = changes[key].newValue;
              hasSettingChange = true;
            }
            if (!hasSettingChange) return;
            if (updated.vtop_speed_mode && !updated.downloadPacing) {
              updated.downloadPacing = updated.vtop_speed_mode;
            }
            if (updated.downloadPacing) {
              updated.downloadPacing = normalizePacing(updated.downloadPacing);
            }
            callback(updated);
          }
        });
      }
    }
  };

  window.VTOP_PLUS.Storage = Storage;
})();
