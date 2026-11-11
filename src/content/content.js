/**
 * VTOP++ - Master Content Script
 * Central orchestrator for all VTOP++ modules, settings dispatch, and SPA life-cycle management.
 */

(function () {
  'use strict';

  if (window.__vtop_plus_injected) return;
  if (window !== window.top) return; // Prevent duplicate instances in nested frames
  window.__vtop_plus_injected = true;

  const {
    Storage,
    DOM,
    Crawler,
    MenuDrawer,
    AutoCaptcha,
    SessionKeeper,
    CourseFilter,
    CourseDownloader,
    AttendanceCalculator,
    DaTracker,
    MarksFatPredictor,
    CommandPalette,
    QuickDock,
    PrivacyMode
  } = window.VTOP_PLUS;

  let currentSettings = { ...Storage.DEFAULT_SETTINGS };

  init();

  async function init() {
    console.log('[VTOP++] Booting VTOP++ Master Engine (v1.0.0)...');

    currentSettings = await Storage.getSettings();

    setupMessageListener();
    setupMutationObserver();
    setupWatchdog();

    bootModules();
  }

  function bootModules() {
    // 0. Pre-crawl VTOP routes and initialize mega-menu drawer dismiss
    if (Crawler) {
      Crawler.scan();
    }

    if (MenuDrawer) {
      MenuDrawer.init();
    }

    // 1. Login Page Auto-Captcha
    if (currentSettings.enableAutoCaptcha !== false && AutoCaptcha) {
      AutoCaptcha.init();
    }

    // 2. Session Keep-Alive
    if (currentSettings.enableSessionKeeper !== false && SessionKeeper) {
      SessionKeeper.init();
    }

    // 3. Privacy Mode
    if (PrivacyMode) {
      PrivacyMode.init();
    }

    // 4. Search Pages (Ctrl+K)
    if (currentSettings.enableSpotlight !== false && CommandPalette) {
      CommandPalette.init();
    }

    // 5. Quick Dock
    if (currentSettings.enableQuickDock !== false && QuickDock) {
      QuickDock.init();
    }

    // Run contextual page scanners
    runPageScanners();
  }

  function runPageScanners() {
    // Permanently remove Campus Etiquette button if re-injected by VTOP
    const etiquetteBtn = document.getElementById('campusEtiquetteBtn');
    if (etiquetteBtn) {
      etiquetteBtn.remove();
    }

    // 0a. Refresh dynamic link indexer and mega-menu close buttons
    if (Crawler) {
      Crawler.scan();
    }
    if (MenuDrawer) {
      MenuDrawer.injectCloseButtons();
    }

    // 0b. Auto-Captcha (if login form or registration captcha is in view)
    if (currentSettings.enableAutoCaptcha !== false && AutoCaptcha) {
      AutoCaptcha.solve();
    }

    // 0c. Quick Dock (dynamically mounts after user logs in)
    if (currentSettings.enableQuickDock !== false && QuickDock) {
      QuickDock.init();
    } else if (QuickDock) {
      QuickDock.destroy();
    }

    // 0d. Privacy Mode element re-tagger
    if (PrivacyMode?.isActive) {
      PrivacyMode.tagSensitiveElements();
    }

    // 6. Course Materials Filter & Downloader
    if (currentSettings.enableCourseFilter !== false && CourseFilter) {
      CourseFilter.init();
    } else if (CourseFilter) {
      CourseFilter.destroy();
    }

    if (currentSettings.enableDownloader !== false && CourseDownloader) {
      CourseDownloader.init();
    } else if (CourseDownloader) {
      CourseDownloader.destroy();
    }

    // 7. Attendance Bunk Calculator
    if (currentSettings.enableAttendanceCalc !== false && AttendanceCalculator) {
      AttendanceCalculator.init();
    }

    // 8. Digital Assignment Tracker
    if (currentSettings.enableDaTracker !== false && DaTracker) {
      DaTracker.init();
    }

    // 9. FAT Grade & Target Marks Predictor
    if (currentSettings.enableFatPredictor !== false && MarksFatPredictor) {
      MarksFatPredictor.init();
    }
  }

  function isVtopNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const id = node.id || '';
    const cls = typeof node.className === 'string' ? node.className : '';
    if (id.startsWith('vtop-') || cls.includes('vtop-')) return true;
    return Boolean(node.closest?.('[id^="vtop-"], [class*="vtop-"]'));
  }

  /**
   * Resilient DOM observer that never detaches during SPA navigation
   */
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // Ignore mutations originating strictly from VTOP++ injected components to break reflow loops
      const isInternal = mutations.every((m) => {
        if (isVtopNode(m.target)) return true;
        const changedEls = [...m.addedNodes, ...m.removedNodes].filter((n) => n.nodeType === 1);
        return changedEls.length > 0 && changedEls.every(isVtopNode);
      });
      if (isInternal) return;

      if (window.__vtop_plus_scan_t) clearTimeout(window.__vtop_plus_scan_t);
      window.__vtop_plus_scan_t = setTimeout(() => {
        runPageScanners();
      }, 350);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Safety watchdog to catch tables loaded via slow AJAX requests
   */
  let lastKnownPageType = '';
  function setupWatchdog() {
    setInterval(() => {
      const currentPageType = DOM?.detectPageType ? DOM.detectPageType() : '';
      if (currentPageType !== lastKnownPageType) {
        lastKnownPageType = currentPageType;
        runPageScanners();
      }
    }, 2500);
  }

  /**
   * Listen for communication from popup.js and cross-tab storage
   */
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'FORCE_SCAN' || message.action === 'OPEN_PANEL') {
        CourseDownloader?.openPanel();
        runPageScanners();
        sendResponse({ success: true });
        return true;
      }

      if (
        message.action === 'OPEN_SEARCH_PAGES' ||
        message.action === 'OPEN_SPOTLIGHT' ||
        message.action === 'TOGGLE_COMMAND_PALETTE'
      ) {
        if (CommandPalette) {
          CommandPalette.open();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'CommandPalette not loaded' });
        }
        return true;
      }

      if (message.action === 'NAVIGATE_TO') {
        const crawler = window.VTOP_PLUS.Crawler;
        if (crawler) {
          const items = crawler.getQuickDockItems();
          const target = items.find((i) => i.id === message.targetId);
          if (target) {
            QuickDock?.requestNavigation(target);
          }
        }
        sendResponse({ success: true });
        return true;
      }

      if (message.action === 'TOGGLE_PRIVACY') {
        PrivacyMode?.toggle();
        sendResponse({ success: true, active: PrivacyMode.isActive });
        return true;
      }

      if (message.action === 'APPLY_SETTINGS') {
        currentSettings = { ...currentSettings, ...message.settings };

        if (currentSettings.enableQuickDock !== false) QuickDock?.init();
        else QuickDock?.destroy();

        if (currentSettings.enableCourseFilter !== false) CourseFilter?.init();
        else CourseFilter?.destroy();

        if (currentSettings.enableSpotlight !== false) CommandPalette?.init();
        else CommandPalette?.destroy();

        if (currentSettings.enableSessionKeeper !== false) SessionKeeper?.init();
        else SessionKeeper?.destroy();

        if (currentSettings.enableDownloader !== false) CourseDownloader?.init();
        else CourseDownloader?.destroy();

        runPageScanners();
        sendResponse({ success: true });
        return true;
      }
    });

    // Listen for storage changes across tabs
    Storage.onChanged((newSettings) => {
      currentSettings = { ...currentSettings, ...newSettings };

      if (currentSettings.enableQuickDock !== false) QuickDock?.init();
      else QuickDock?.destroy();

      if (currentSettings.enableCourseFilter !== false) CourseFilter?.init();
      else CourseFilter?.destroy();

      if (currentSettings.enableSpotlight !== false) CommandPalette?.init();
      else CommandPalette?.destroy();

      if (currentSettings.enableSessionKeeper !== false) SessionKeeper?.init();
      else SessionKeeper?.destroy();

      if (currentSettings.enableDownloader !== false) CourseDownloader?.init();
      else CourseDownloader?.destroy();

      runPageScanners();
    });
  }
})();
