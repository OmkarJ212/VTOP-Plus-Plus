/**
 * VTOP++ - Universal Dark Mode Module
 * Deep obsidian/slate dark theme engine covering 100% of VTOP pages.
 * Handles instant FOUC prevention, storage synchronization,
 * dynamic AJAX element sanitization, and manual toggles.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  if (window.VTOP_PLUS.DarkMode) return;

  // Ensure body receives theme when DOM is parsed
  document.addEventListener('DOMContentLoaded', () => {
    if (window.VTOP_PLUS.DarkMode?.isActive) {
      document.documentElement.classList.add('vtop-dark-theme');
      if (document.body) {
        document.body.classList.add('vtop-dark-theme');
      }
      window.VTOP_PLUS.DarkMode.syncDockButton();
    }
  }, { once: true });

  const WHITE_BG_REGEX = /background(?:-color)?:\s*(?:#fff(?:fff)?|#f8f9fa|#f4f6f9|#f1f5f9|#e9ecef|#fafafa|white|rgb\(\s*(?:24[0-9]|25[0-5])\s*,\s*(?:24[0-9]|25[0-5])\s*,\s*(?:24[0-9]|25[0-5])\s*\))/i;
  const DARK_TEXT_REGEX = /color\s*:\s*(?:#000(?:000)?|#111|#222|#333|#444|#555|#212529|#2c3e50|#34495e|black|rgb\(\s*(?:[0-9]|[1-4][0-9]|50)\s*,\s*(?:[0-9]|[1-4][0-9]|50)\s*,\s*(?:[0-9]|[1-4][0-9]|50)\s*\))/i;

  const DarkMode = {
    isActive: false,
    _observer: null,
    _debounceTimer: null,
    _isInitialized: false,

    init() {
      if (this._isInitialized) return;
      this._isInitialized = true;

      if (chrome?.storage?.local) {
        chrome.storage.local.get(['enableDarkMode'], (res) => {
          if (res?.enableDarkMode !== undefined) {
            this.set(Boolean(res.enableDarkMode), false);
          }
        });
      }

      // Sync across open tabs in real-time
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.enableDarkMode !== undefined) {
            this.set(Boolean(changes.enableDarkMode.newValue), false);
          }
        });
      }
    },

    toggle() {
      this.set(!this.isActive, true);
    },

    set(active, saveStorage = true) {
      this.isActive = Boolean(active);

      if (document.documentElement) {
        document.documentElement.classList.toggle('vtop-dark-theme', this.isActive);
      }
      if (document.body) {
        document.body.classList.toggle('vtop-dark-theme', this.isActive);
      }

      // Update Quick Dock button visual if present
      this.syncDockButton();

      if (window.VTOP_PLUS?.CourseFilter?.syncTheme) {
        window.VTOP_PLUS.CourseFilter.syncTheme(this.isActive);
      }

      if (saveStorage && chrome?.storage?.local) {
        chrome.storage.local.set({ enableDarkMode: this.isActive });
      }

      if (this.isActive) {
        this.sanitizeDynamicElements();
        this.startObserver();
      } else {
        this.stopObserver();
      }

      console.log(`[VTOP++] Universal Dark Mode ${this.isActive ? 'Enabled' : 'Disabled'}`);
    },

    syncDockButton() {
      const btn = document.getElementById('vtop-dock-dark-btn');
      if (!btn) return;

      btn.title = this.isActive
        ? 'Switch to Light Mode'
        : 'Switch to Dark Mode';
      btn.classList.toggle('active', this.isActive);

      const qd = window.VTOP_PLUS.QuickDock;
      if (qd && typeof qd.getDockIconSvg === 'function') {
        btn.innerHTML = qd.getDockIconSvg(this.isActive ? 'sun' : 'moon');
      }
    },

    startObserver() {
      if (this._observer) return;
      this._pendingRoots = this._pendingRoots || new Set();
      this._observer = new MutationObserver((mutations) => {
        if (!this.isActive || this._isSanitizing) return;

        let hasExternalChanges = false;
        for (const m of mutations) {
          const t = m.target;
          if (
            t &&
            (t.closest?.('.vtop-plus-dock, .vtop-nav-item, .vtop-dock-pill, .vtop-dock-icon-btn, .vtop-dock-sep, [data-vtop-nav-item], .vtop-plus-panel, .vtop-palette-overlay, .vtop-plus-card') ||
             (typeof t.id === 'string' && t.id.startsWith('vtop-')))
          ) {
            continue;
          }
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && !this._isProtectedElement(node)) {
              this._pendingRoots.add(node);
              hasExternalChanges = true;
            }
          }
        }
        if (!hasExternalChanges) return;

        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
          const roots = Array.from(this._pendingRoots);
          this._pendingRoots.clear();
          if (!this.isActive) return;
          for (const r of roots) {
            if (r.isConnected) {
              this.sanitizeDynamicElements(r);
            }
          }
        }, 150);
      });

      const root = document.body || document.documentElement;
      if (root) {
        this._observer.observe(root, {
          childList: true,
          subtree: true
        });
      }
    },

    stopObserver() {
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
      if (this._pendingRoots) {
        this._pendingRoots.clear();
      }
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
    },

    /**
     * Universal Dynamic Cleaner: Sanitizes hardcoded legacy inline backgrounds
     * and black text from freshly injected AJAX chunks without touching captcha or status indicators.
     */
    sanitizeDynamicElements(root = document) {
      if (!this.isActive || this._isSanitizing || !root) return;
      this._isSanitizing = true;

      try {
        const queryAll = (sel) => {
          const list = root.querySelectorAll ? Array.from(root.querySelectorAll(sel)) : [];
          if (root !== document && root.matches?.(sel)) list.unshift(root);
          return list;
        };

        // 1. Remove legacy HTML bgcolor attributes across all elements
        const bgElements = queryAll('[bgcolor]');
        for (let i = 0; i < bgElements.length; i++) {
          const el = bgElements[i];
          if (this._isProtectedElement(el)) continue;
          el.removeAttribute('bgcolor');
        }

        // 1b. Clear WhiteBackground wrappers inline backgrounds
        const whiteWrappers = queryAll('.WhiteBackground, [class*="WhiteBackground" i]');
        for (let i = 0; i < whiteWrappers.length; i++) {
          whiteWrappers[i].style.backgroundColor = '';
          whiteWrappers[i].style.background = '';
        }

        // 1c. Ensure injected course filter bars stay dark
        if (window.VTOP_PLUS?.CourseFilter?.syncTheme) {
          window.VTOP_PLUS.CourseFilter.syncTheme(true);
        }

        // 1d. Clear any hardcoded blue/inline text colors from navbar elements to ensure pure white text
        const headerElements = queryAll('#vtop-header [style*="color"], .navbar [style*="color"], #quickLinks [style*="color"], #navbarDropdown [style*="color"]');
        for (let i = 0; i < headerElements.length; i++) {
          headerElements[i].style.color = '';
        }

        // 2. Clear hardcoded white/near-white inline background styles and near-black text
        const styledElements = queryAll('[style*="background"], [style*="color"]');
        for (let i = 0; i < styledElements.length; i++) {
          const el = styledElements[i];
          if (this._isProtectedElement(el)) continue;

          const css = el.style.cssText;
          if (WHITE_BG_REGEX.test(css)) {
            el.style.backgroundColor = '';
          }
          if (DARK_TEXT_REGEX.test(css)) {
            el.style.color = '';
          }
        }
      } finally {
        this._isSanitizing = false;
      }
    },

    _isProtectedElement(el) {
      if (!el) return true;
      if (
        el.id === 'captchaBlockImg' ||
        el.id === 'captchaImage' ||
        el.id === 'captchaCanvas' ||
        el.closest?.('#captchaBlockImg, .vtop-plus-dock, .vtop-nav-item, .vtop-dock-pill, .vtop-dock-icon-btn, .vtop-dock-sep, [data-vtop-nav-item], .vtop-plus-panel, .vtop-palette-overlay')
      ) {
        return true;
      }
      return false;
    }
  };

  window.VTOP_PLUS.DarkMode = DarkMode;
  DarkMode.init();
})();
