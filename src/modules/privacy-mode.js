/**
 * VTOP++ - Privacy & Incognito Mode Module
 * Blurs sensitive student data (Registration Number, CGPA, Grades, Student Photo) in public spaces.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  // Stateless case-insensitive regexes (no /g flag to prevent lastIndex state drift)
  const REGEX_REG_NO = /\b(2[0-9][A-Z]{3}[0-9]{4,5})\b/i;
  const REGEX_CGPA_INLINE = /\bCGPA\s*[:\-]?\s*\d+(?:\.\d+)?\b/i;

  const PrivacyMode = {
    isActive: false,
    _initialized: false,
    _observer: null,

    init() {
      if (this._initialized) return;
      this._initialized = true;

      if (chrome?.storage?.local) {
        chrome.storage.local.get(['enablePrivacyMode'], (res) => {
          if (chrome.runtime.lastError) return;
          if (res?.enablePrivacyMode) {
            this.set(true, false);
          }
        });
      }

      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.enablePrivacyMode !== undefined) {
            this.set(Boolean(changes.enablePrivacyMode.newValue), false);
          }
        });
      }
    },

    toggle() {
      this.set(!this.isActive, true);
    },

    set(active, saveStorage = true) {
      this.isActive = Boolean(active);
      document.documentElement.classList.toggle('vtop-privacy-active', this.isActive);

      if (saveStorage && chrome?.storage?.local) {
        chrome.storage.local.set({ enablePrivacyMode: this.isActive });
      }

      if (this.isActive) {
        this.tagSensitiveElements(document);
        this.startObserver();
      } else {
        this.stopObserver();
      }

      console.log(`[VTOP++] Privacy Mode ${this.isActive ? 'Enabled' : 'Disabled'}`);
    },

    startObserver() {
      if (this._observer) return;
      const root = document.body || document.documentElement;
      if (!root) return;

      this._observer = new MutationObserver((mutations) => {
        if (!this.isActive) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (typeof node.id === 'string' && node.id.startsWith('vtop-')) continue;
            this.tagSensitiveElements(node);
          }
        }
      });

      this._observer.observe(root, { childList: true, subtree: true });
    },

    stopObserver() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
    },

    tagSensitiveElements(root = document) {
      if (!root || !root.querySelectorAll) return;

      const TEXT_SELECTOR =
        '#navbarDropdown, .dropdown-toggle, .user-profile, .student-info, span.fw-bold, .navbar-text, .card-body span, .card-body td, .card-body div, .box-body td, .box-body span';
      const PHOTO_SELECTOR =
        'img.img-circle, img.user-image, img.profile-user-img, img[src*="/users/image/"], .navbar-nav img, .navbar-custom-menu img, .user-panel img, .user-menu img';
      const LABEL_SELECTOR = 'td, th, .fw-bold, strong, label';

      // 1. Tag text elements containing registration numbers or inline CGPA
      const textTargets = Array.from(root.querySelectorAll(TEXT_SELECTOR));
      if (root !== document && root.matches?.(TEXT_SELECTOR)) textTargets.push(root);
      textTargets.forEach((el) => {
        if (el.children.length > 4) return;
        const txt = el.textContent || '';
        if (REGEX_REG_NO.test(txt) || REGEX_CGPA_INLINE.test(txt)) {
          el.classList.add('vtop-privacy-blur-target');
        }
      });

      // 2. Tag student face photo elements
      const photoTargets = Array.from(root.querySelectorAll(PHOTO_SELECTOR));
      if (root !== document && root.matches?.(PHOTO_SELECTOR)) photoTargets.push(root);
      photoTargets.forEach((img) => {
        const src = (img.src || '').toLowerCase();
        const alt = (img.alt || '').toLowerCase();
        const cls = (img.className || '').toLowerCase();
        // Protect university logos and extension icons
        if (src.includes('logo') || src.includes('icon') || alt.includes('logo') || cls.includes('logo')) {
          return;
        }
        img.classList.add('vtop-privacy-blur-target', 'vtop-privacy-blur-photo');
      });

      // 3. Tag profile name & CGPA label/value pairs in tables or cards
      const labelCells = Array.from(root.querySelectorAll(LABEL_SELECTOR));
      if (root !== document && root.matches?.(LABEL_SELECTOR)) labelCells.push(root);
      labelCells.forEach((el) => {
        if (el.children.length > 1) return;
        const label = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (
          label === 'cgpa' ||
          label === 'cumulative grade point average' ||
          label === 'student name' ||
          label === 'register number' ||
          label === 'registration number' ||
          label === 'reg. no.' ||
          label === 'reg no'
        ) {
          const valEl = el.nextElementSibling;
          if (valEl && valEl.children.length <= 4) {
            valEl.classList.add('vtop-privacy-blur-target');
          }
        }
      });
    }
  };

  window.VTOP_PLUS.PrivacyMode = PrivacyMode;
})();
