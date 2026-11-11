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
    PrivacyMode,
    DarkMode
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
    const isTopFrame = window.self === window.top;

    // 0. Pre-crawl VTOP routes and initialize mega-menu drawer dismiss (top frame only)
    if (isTopFrame) {
      if (Crawler) Crawler.scan();
      if (MenuDrawer) MenuDrawer.init();
    }

    // 1. Login Page Auto-Captcha
    if (currentSettings.enableAutoCaptcha !== false && AutoCaptcha) {
      AutoCaptcha.init();
    }

    // 2. Session Keep-Alive (top frame only to avoid duplicate heartbeats)
    if (isTopFrame && currentSettings.enableSessionKeeper !== false && SessionKeeper) {
      SessionKeeper.init();
    }

    // 3. Privacy Mode
    if (PrivacyMode) {
      PrivacyMode.init();
    }

    // 3b. Universal Dark Mode
    if (DarkMode) {
      DarkMode.init();
    }

    // 4. Search Pages (Ctrl+K) (top frame only)
    if (isTopFrame && currentSettings.enableSpotlight !== false && CommandPalette) {
      CommandPalette.init();
    }

    // 5. Quick Dock (top frame only)
    if (isTopFrame && currentSettings.enableQuickDock !== false && QuickDock) {
      QuickDock.init();
    }

    // Run contextual page scanners
    runPageScanners();
  }

  function runPageScanners() {
    const isTopFrame = window.self === window.top;

    // Permanently remove Campus Etiquette button if re-injected by VTOP
    const etiquetteBtn = document.getElementById('campusEtiquetteBtn');
    if (etiquetteBtn) {
      etiquetteBtn.remove();
    }

    // 0a. Refresh dynamic link indexer and mega-menu close buttons
    if (isTopFrame) {
      if (Crawler) Crawler.scan();
      if (MenuDrawer) MenuDrawer.injectCloseButtons();
    }

    // 0b. Auto-Captcha (if login form or registration captcha is in view)
    if (currentSettings.enableAutoCaptcha !== false && AutoCaptcha) {
      AutoCaptcha.solve();
    }

    // 0c. Quick Dock (dynamically mounts after user logs in)
    if (isTopFrame) {
      if (currentSettings.enableQuickDock !== false && QuickDock) {
        QuickDock.init();
      } else if (QuickDock) {
        QuickDock.destroy();
      }
    }

    // 0d. Privacy Mode element re-tagger
    if (PrivacyMode?.isActive) {
      PrivacyMode.tagSensitiveElements();
    }

    // 0e. Universal Dark Mode dynamic element sanitizer
    if (DarkMode?.isActive) {
      DarkMode.sanitizeDynamicElements();
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

  const EXTENSION_SELECTORS = [
    '#vtop-zip-panel',
    '#vtop-quick-dock',
    '#vtop-custom-course-filter',
    '#vtop-plus-table-filter-bar',
    '#vtop-spotlight-modal',
    '#vtop-da-countdown-banner',
    '#vtop-busy',
    '[class*="vtop-plus-"]',
    '[class*="vtop-dock-"]',
    '[class*="vtop-palette-"]',
    '[class*="vtop-attendance-"]',
    '[class*="vtop-fat-"]',
    '[class*="vtop-da-"]',
    '[class*="vtop-filter-"]',
    '.vtop-th-da-status',
    '.vtop-td-da-status'
  ].join(', ');

  function isExtensionNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches && node.matches(EXTENSION_SELECTORS)) return true;
    return Boolean(node.closest && node.closest(EXTENSION_SELECTORS));
  }

  /**
   * Resilient DOM observer that never detaches during SPA navigation
   */
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // Ignore mutations originating strictly from VTOP++ injected components to break reflow loops
      const isInternal = mutations.every((m) => {
        if (isExtensionNode(m.target)) return true;
        const changedEls = [...m.addedNodes, ...m.removedNodes].filter((n) => n.nodeType === 1);
        return changedEls.length > 0 && changedEls.every(isExtensionNode);
      });
      if (isInternal) return;

      if (window.__vtop_plus_scan_t) clearTimeout(window.__vtop_plus_scan_t);
      window.__vtop_plus_scan_t = setTimeout(() => {
        runPageScanners();
      }, 300);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Safety watchdog to catch tables loaded via slow AJAX requests or dynamic tab switches
   */
  let lastKnownPageType = '';
  function setupWatchdog() {
    setInterval(() => {
      const currentPageType = DOM?.detectPageType ? DOM.detectPageType() : '';
      if (currentPageType !== lastKnownPageType) {
        lastKnownPageType = currentPageType;
        runPageScanners();
        return;
      }

      // Check Course Downloader if buttons exist but panel is not mounted/visible
      const downloadButtons = document.querySelectorAll(
        'button[data-fileid], .download-btn[data-fileid], [data-fileid], [data-file-id], button[onclick*="downloadCourseMaterialFacultyPdf"], a[onclick*="downloadCourseMaterialFacultyPdf"], input[onclick*="downloadCourseMaterialFacultyPdf"]'
      );
      const panel = document.getElementById('vtop-zip-panel');
      const isPanelVisible = panel && panel.style.display !== 'none';
      if (downloadButtons.length > 0 && (!panel || !isPanelVisible)) {
        if (CourseDownloader) CourseDownloader.init();
      }

      // Check DA Tracker if on DA view but countdown is not yet mounted
      if (currentPageType === 'DIGITAL_ASSIGNMENT') {
        const hasOverviewAugment = Boolean(document.querySelector('.vtop-th-da-status'));
        const hasBanner = Boolean(document.getElementById('vtop-da-countdown-banner'));
        if (!hasOverviewAugment && !hasBanner) {
          if (DaTracker) DaTracker.init();
        }
      }
    }, 2000);
  }

  /**
   * Listen for communication from popup.js and cross-tab storage
   */
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'FORCE_SCAN' || message.action === 'OPEN_PANEL') {
        const scanPromise = CourseDownloader?.scanPageForMaterials
          ? CourseDownloader.scanPageForMaterials()
          : Promise.resolve();

        scanPromise
          .then(() => {
            CourseDownloader?.openPanel();
            runPageScanners();
            const buttons = document.querySelectorAll(
              'button[data-fileid], .download-btn[data-fileid], [data-fileid], [data-file-id], button[onclick*="downloadCourseMaterialFacultyPdf"], a[onclick*="downloadCourseMaterialFacultyPdf"], input[onclick*="downloadCourseMaterialFacultyPdf"]'
            );
            sendResponse({
              success: true,
              fileCount: CourseDownloader?.getFileCount ? CourseDownloader.getFileCount() : 0,
              activeCourse: CourseDownloader?.getActiveCourseCode ? CourseDownloader.getActiveCourseCode() : 'Course',
              hasButtons: buttons.length > 0
            });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
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

      if (message.action === 'TOGGLE_DARK_MODE') {
        DarkMode?.toggle();
        sendResponse({ success: true, active: DarkMode?.isActive });
        return true;
      }

      if (message.action === 'APPLY_SETTINGS') {
        currentSettings = { ...currentSettings, ...message.settings };

        if (message.settings.enableDarkMode !== undefined && DarkMode) {
          DarkMode.set(Boolean(message.settings.enableDarkMode));
        }

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
