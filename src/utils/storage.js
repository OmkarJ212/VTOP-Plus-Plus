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
    downloadPacing: 'fast', // 'safe', 'fast', 'stealth'
    attendanceTarget: 75 // 75, 80, 85, 90
  };

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
        chrome.storage.local.get(null, (items) => {
          if (chrome.runtime.lastError) {
            console.warn('[VTOP++] Error reading storage:', chrome.runtime.lastError);
            resolve(DEFAULT_SETTINGS);
          } else {
            const raw = items || {};
            if (raw.vtop_speed_mode && !raw.downloadPacing) {
              raw.downloadPacing = raw.vtop_speed_mode;
            }
            resolve({ ...DEFAULT_SETTINGS, ...raw });
          }
        });
      });
    },

    /**
     * Save updated settings
     */
    async saveSettings(newSettings) {
      return new Promise((resolve, reject) => {
        if (!chrome?.storage?.local) {
          resolve();
          return;
        }
        chrome.storage.local.set(newSettings, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
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
            for (const key of Object.keys(changes)) {
              updated[key] = changes[key].newValue;
            }
            if (updated.vtop_speed_mode && !updated.downloadPacing) {
              updated.downloadPacing = updated.vtop_speed_mode;
            }
            callback(updated);
          }
        });
      }
    }
  };

  window.VTOP_PLUS.Storage = Storage;
})();
