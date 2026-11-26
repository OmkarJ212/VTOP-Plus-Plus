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
  const NAV_HEADER_SELECTOR = '#vtop-header, .navbar, #quickLinks, #navbarDropdown';
  const SANITIZE_SELECTOR = '[bgcolor], [class*="WhiteBackground" i], [style*="background"], [style*="color"]';
  const RESTORE_SELECTOR = '[data-vtop-orig-bgcolor], [data-vtop-orig-bg], [data-vtop-orig-background], [data-vtop-orig-color]';

  const DarkMode = {
    isActive: false,
    _observer: null,
    _debounceTimer: null,
    _fallbackTransitionTimer: null,
    _activeTransition: null,
    _isInitialized: false,
    _hasAppliedOnce: false,

    init() {
      if (this._isInitialized) return;
      this._isInitialized = true;

      const Storage = window.VTOP_PLUS?.Storage;
      if (Storage) {
        Storage.get(['enableDarkMode']).then((res) => {
          if (res?.enableDarkMode !== undefined) {
            this.set(Boolean(res.enableDarkMode), false, false);
          }
        });
        // Sync across open tabs in real-time
        Storage.onKeysChanged(['enableDarkMode'], (matched) => {
          if (matched.enableDarkMode !== undefined) {
            const next = Boolean(matched.enableDarkMode);
            const isVisible = document.visibilityState === 'visible' && Boolean(document.body);
            this.set(next, false, isVisible);
          }
        });
      }
    },

    toggle() {
      this.set(!this.isActive, true, true);
    },

    _applyThemeState(nextActive) {
      const rootEl = document.documentElement;
      if (rootEl) {
        rootEl.classList.toggle('vtop-dark-theme', nextActive);
      }
      if (document.body) {
        document.body.classList.toggle('vtop-dark-theme', nextActive);
      }

      this.syncDockButton();

      if (nextActive) {
        this.sanitizeDynamicElements();
        this.startObserver();
      } else {
        this.stopObserver();
        this.restoreSanitizedElements();
      }
    },

    set(active, saveStorage = true, animate = false) {
      const nextActive = Boolean(active);
      if (this._hasAppliedOnce && this.isActive === nextActive) {
        if (saveStorage) {
          window.VTOP_PLUS?.Storage?.set({ enableDarkMode: nextActive });
        }
        return;
      }

      this.isActive = nextActive;
      this._hasAppliedOnce = true;

      if (saveStorage) {
        window.VTOP_PLUS?.Storage?.set({ enableDarkMode: nextActive });
      }

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const shouldAnimate = animate && !reducedMotion && Boolean(document.body) && document.visibilityState === 'visible';
      const rootEl = document.documentElement;

      if (shouldAnimate && typeof document.startViewTransition === 'function') {
        if (this._activeTransition) {
          try {
            this._activeTransition.skipTransition();
          } catch (_) {}
          this._activeTransition = null;
        }

        // Freeze per-element CSS transitions while capturing the new theme frame
        // so every element dissolves together in one unified GPU cross-fade.
        rootEl?.classList.add('vtop-theme-snap');
        try {
          const transition = document.startViewTransition(() => {
            this._applyThemeState(nextActive);
          });
          this._activeTransition = transition;
          const cleanup = () => {
            rootEl?.classList.remove('vtop-theme-snap');
            if (this._activeTransition === transition) {
              this._activeTransition = null;
            }
          };
          transition.finished.then(cleanup, cleanup);
          setTimeout(cleanup, 400);
          return;
        } catch (_) {
          rootEl?.classList.remove('vtop-theme-snap');
        }
      }

      if (shouldAnimate && rootEl) {
        if (this._fallbackTransitionTimer) {
          clearTimeout(this._fallbackTransitionTimer);
        }
        rootEl.classList.add('vtop-theme-transitioning');
        this._applyThemeState(nextActive);
        this._fallbackTransitionTimer = setTimeout(() => {
          rootEl.classList.remove('vtop-theme-transitioning');
          this._fallbackTransitionTimer = null;
        }, 210);
        return;
      }

      this._applyThemeState(nextActive);
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
     * and black text in a single DOM pass without layout-thrashing loops.
     */
    sanitizeDynamicElements(root = document) {
      if (!this.isActive || this._isSanitizing || !root) return;
      this._isSanitizing = true;

      try {
        const candidates = root.querySelectorAll ? Array.from(root.querySelectorAll(SANITIZE_SELECTOR)) : [];
        if (root !== document && root.matches?.(SANITIZE_SELECTOR)) {
          candidates.unshift(root);
        }
        if (candidates.length === 0) return;

        // Read phase first, then batch writes
        const ops = [];
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          if (this._isProtectedElement(el)) continue;

          const hasBgAttr = el.hasAttribute('bgcolor');
          const bgAttrVal = hasBgAttr ? (el.getAttribute('bgcolor') || '') : '';
          const classNameStr = typeof el.className === 'string' ? el.className : '';
          const isWhiteWrapper = /WhiteBackground/i.test(classNameStr);
          const styleAttr = el.getAttribute('style') || '';
          const isNavHeader = Boolean(styleAttr && el.closest?.(NAV_HEADER_SELECTOR));

          const inlineBg = el.style.backgroundColor || '';
          const inlineBgShort = el.style.background || '';
          const inlineColor = el.style.color || '';
          const cssText = styleAttr ? el.style.cssText : '';

          const clearWhiteWrapperBg = isWhiteWrapper && (inlineBg || inlineBgShort);
          const clearHeaderColor = isNavHeader && inlineColor;
          const clearInlineBg = !clearWhiteWrapperBg && cssText && WHITE_BG_REGEX.test(cssText) && inlineBg;
          const clearInlineColor = !clearHeaderColor && cssText && DARK_TEXT_REGEX.test(cssText) && inlineColor;

          if (hasBgAttr || clearWhiteWrapperBg || clearHeaderColor || clearInlineBg || clearInlineColor) {
            ops.push({
              el,
              hasBgAttr,
              bgAttrVal,
              hasOrigBgAttr: hasBgAttr && el.hasAttribute('data-vtop-orig-bgcolor'),
              clearWhiteWrapperBg,
              clearHeaderColor,
              clearInlineBg,
              clearInlineColor,
              inlineBg,
              inlineBgShort,
              inlineColor,
              hasOrigBg: el.hasAttribute('data-vtop-orig-bg'),
              hasOrigBackground: el.hasAttribute('data-vtop-orig-background'),
              hasOrigColor: el.hasAttribute('data-vtop-orig-color')
            });
          }
        }

        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          const el = op.el;

          if (op.hasBgAttr) {
            if (!op.hasOrigBgAttr) el.setAttribute('data-vtop-orig-bgcolor', op.bgAttrVal);
            el.removeAttribute('bgcolor');
          }
          if (op.clearWhiteWrapperBg) {
            if (op.inlineBg && !op.hasOrigBg) el.setAttribute('data-vtop-orig-bg', op.inlineBg);
            if (op.inlineBgShort && !op.hasOrigBackground) el.setAttribute('data-vtop-orig-background', op.inlineBgShort);
            el.style.backgroundColor = '';
            el.style.background = '';
          } else if (op.clearInlineBg) {
            if (!op.hasOrigBg) el.setAttribute('data-vtop-orig-bg', op.inlineBg);
            el.style.backgroundColor = '';
          }
          if (op.clearHeaderColor || op.clearInlineColor) {
            if (!op.hasOrigColor) el.setAttribute('data-vtop-orig-color', op.inlineColor);
            el.style.color = '';
          }
        }
      } finally {
        this._isSanitizing = false;
      }
    },

    /**
     * Restore original inline attributes/styles cleared by sanitizeDynamicElements
     * in a single DOM pass so Light Mode restores cleanly.
     */
    restoreSanitizedElements() {
      const els = document.querySelectorAll(RESTORE_SELECTOR);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.hasAttribute('data-vtop-orig-bgcolor')) {
          el.setAttribute('bgcolor', el.getAttribute('data-vtop-orig-bgcolor') || '');
          el.removeAttribute('data-vtop-orig-bgcolor');
        }
        if (el.hasAttribute('data-vtop-orig-bg')) {
          el.style.backgroundColor = el.getAttribute('data-vtop-orig-bg') || '';
          el.removeAttribute('data-vtop-orig-bg');
        }
        if (el.hasAttribute('data-vtop-orig-background')) {
          el.style.background = el.getAttribute('data-vtop-orig-background') || '';
          el.removeAttribute('data-vtop-orig-background');
        }
        if (el.hasAttribute('data-vtop-orig-color')) {
          el.style.color = el.getAttribute('data-vtop-orig-color') || '';
          el.removeAttribute('data-vtop-orig-color');
        }
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
