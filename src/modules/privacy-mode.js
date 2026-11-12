/**
 * VTOP++ - Privacy & Incognito Mode Module
 * Blurs sensitive student data (Registration Number, CGPA, Grades, Student Photo) in public spaces.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  // Stateless case-insensitive regex for registration numbers (no /g flag to prevent lastIndex state drift)
  const REGEX_REG_NO = /\b(2[0-9][A-Z]{3}[0-9]{4,5})\b/i;

  const PrivacyMode = {
    isActive: false,

    init() {
      if (chrome?.storage?.local) {
        chrome.storage.local.get(['enablePrivacyMode'], (res) => {
          if (res?.enablePrivacyMode) {
            this.set(true);
          }
        });
      }
    },

    toggle() {
      this.set(!this.isActive);
    },

    set(active) {
      this.isActive = active;
      document.documentElement.classList.toggle('vtop-privacy-active', active);

      if (chrome?.storage?.local) {
        chrome.storage.local.set({ enablePrivacyMode: active });
      }

      if (active) {
        this.tagSensitiveElements();
      }

      console.log(`[VTOP++] Privacy Mode ${active ? 'Enabled' : 'Disabled'}`);
    },

    tagSensitiveElements() {
      // 1. Tag text elements containing registration numbers
      const textTargets = document.querySelectorAll(
        '#navbarDropdown, .dropdown-toggle, .user-profile, .student-info, span.fw-bold, .navbar-text'
      );
      textTargets.forEach((el) => {
        if (el.children.length <= 2 && REGEX_REG_NO.test(el.textContent)) {
          el.classList.add('vtop-privacy-blur-target');
        }
      });

      // 2. Tag student face photo elements
      const photoTargets = document.querySelectorAll(
        'img.img-circle, img.user-image, img.profile-user-img, .navbar-nav img, .navbar-custom-menu img, .user-panel img, .user-menu img'
      );
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
    }
  };

  window.VTOP_PLUS.PrivacyMode = PrivacyMode;
})();
