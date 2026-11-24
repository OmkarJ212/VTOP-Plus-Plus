/**
 * VTOP++ - Master Content Script
 * Central orchestrator for all VTOP++ modules, settings dispatch, and SPA life-cycle management.
 */

(function () {
  'use strict';

  if (window.__vtop_plus_injected) return;
  if (window !== window.top) return; // Prevent duplicate instances in nested frames
  if (!window.VTOP_PLUS) return;
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
    DarkMode,
    HomeMessages,
    TimetableCalendar,
    MarksNotifier
  } = window.VTOP_PLUS;

  let currentSettings = { ...Storage.DEFAULT_SETTINGS };

  init();

  async function init() {
    currentSettings = await Storage.getSettings();

    setupMessageListener();
    setupMutationObserver();
    setupWatchdog();

    bootModules();
  }

  function bootModules() {
    // 0. Pre-crawl VTOP routes and initialize mega-menu drawer dismiss
    if (Crawler) Crawler.scan();
    if (MenuDrawer) MenuDrawer.init();

    // 1. Login Page Auto-Captcha
    if (currentSettings.enableAutoCaptcha !== false && AutoCaptcha) {
      AutoCaptcha.init();
    }

    // 2. Session Keep-Alive
    if (currentSettings.enableSessionKeeper !== false && SessionKeeper) {
      SessionKeeper.init();
    }

    // 3. Privacy Mode & Universal Dark Mode
    if (PrivacyMode) PrivacyMode.init();
    if (DarkMode) DarkMode.init();

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
    if (CourseDownloader?.isBusy?.()) return;

    // Permanently remove Campus Etiquette button if re-injected by VTOP
    document.getElementById('campusEtiquetteBtn')?.remove();

    // Remove stray backtick text node in VTOP's #b5-pagewrapper
    const pageWrapper = document.getElementById('b5-pagewrapper');
    if (pageWrapper) {
      for (const node of Array.from(pageWrapper.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.includes('`')) {
          const cleaned = node.nodeValue.replace(/`/g, '');
          if (cleaned.trim() === '') node.remove();
          else node.nodeValue = cleaned;
        }
      }
    }

    // Fix VTOP's Course Outcome accordion button missing `.collapsed` when collapsed (`aria-expanded="false"`)
    document
      .querySelectorAll('#courseAccordion .accordion-button[aria-expanded="false"]:not(.collapsed)')
      .forEach((btn) => {
        const targetSel = btn.getAttribute('data-bs-target');
        const target = targetSel ? document.querySelector(targetSel) : null;
        if (!target || !target.classList.contains('show')) {
          btn.classList.add('collapsed');
        }
      });

    // Upgrade legacy Bootstrap 3 data-toggle / data-dismiss attributes (e.g. FAQ #falistfrag, Event Registration) to Bootstrap 5
    document.querySelectorAll('[data-toggle]:not([data-bs-toggle])').forEach((el) => {
      const val = el.getAttribute('data-toggle');
      if (val === 'collapse' || val === 'modal' || val === 'tab' || val === 'pill' || val === 'tooltip') {
        el.setAttribute('data-bs-toggle', val);
        const target = el.getAttribute('data-target') || el.getAttribute('href');
        if (target && !el.hasAttribute('data-bs-target') && target.startsWith('#')) {
          el.setAttribute('data-bs-target', target);
        }
      }
    });
    document.querySelectorAll('[data-dismiss="modal"]:not([data-bs-dismiss])').forEach((el) => {
      el.setAttribute('data-bs-dismiss', 'modal');
    });

    // Strip legacy inline colors/floats inside FAQ (#falistfrag) so theme CSS governs both Light & Dark cleanly
    document.querySelectorAll('#falistfrag .panel, #falistfrag .panel-heading, #falistfrag .panel-title, #falistfrag .panel-title h4, #falistfrag .panel-collapse, #falistfrag .panel-body, #falistfrag .faqcontent').forEach((el) => {
      if (el.dataset.vtopFaqCleaned) return;
      el.style.removeProperty('color');
      el.style.removeProperty('border-color');
      el.style.removeProperty('background');
      el.style.removeProperty('background-color');
      el.style.removeProperty('float');
      el.removeAttribute('data-vtop-orig-color');
      el.removeAttribute('data-vtop-orig-bg');
      el.removeAttribute('data-vtop-orig-background');
      el.dataset.vtopFaqCleaned = '1';
    });

    // Clean legacy inline borders/colors/margins inside Class Messages (#accordion inside .box-info .box-body)
    document.querySelectorAll('.box-info .box-body #accordion .panel').forEach((panel) => {
      if (panel.dataset.vtopClassMsgCleaned) return;
      panel.dataset.vtopClassMsgCleaned = '1';

      const expand = panel.querySelector('.panel-title.expand');
      if (expand) {
        expand.style.removeProperty('margin-left');
        expand.style.removeProperty('border');
        expand.style.removeProperty('border-color');
        expand.style.removeProperty('background');
        expand.style.removeProperty('background-color');
        expand.style.removeProperty('color');

        const arrow = expand.querySelector('.left-arrow');
        if (arrow) {
          arrow.style.removeProperty('margin-top');
          arrow.style.removeProperty('margin-left');
        }

        const innerLink = expand.querySelector('a[href^="#"]');
        if (innerLink) {
          if (expand.hasAttribute('data-bs-toggle')) {
            innerLink.removeAttribute('data-bs-toggle');
            innerLink.removeAttribute('data-toggle');
          }
          innerLink.addEventListener('click', (e) => e.preventDefault());
        }

        expand.querySelectorAll('h5, h5 b, h5 span').forEach((el) => {
          el.style.removeProperty('color');
          el.style.removeProperty('font-family');
          el.style.removeProperty('font-weight');
          el.style.removeProperty('line-height');
          el.removeAttribute('data-vtop-orig-color');
        });
      }

      panel.querySelectorAll('.panel-body td[style*="d2d6de" i]').forEach((td) => {
        td.classList.add('vtop-class-msg-label');
        td.style.removeProperty('background');
        td.style.removeProperty('background-color');
        td.removeAttribute('data-vtop-orig-bg');
      });

      const collapseEl = panel.querySelector('.panel-collapse');
      const arrow = panel.querySelector('.left-arrow');
      if (collapseEl && arrow) {
        collapseEl.addEventListener('shown.bs.collapse', () => {
          arrow.textContent = '-';
          panel.classList.add('is-expanded');
        });
        collapseEl.addEventListener('hidden.bs.collapse', () => {
          arrow.textContent = '+';
          panel.classList.remove('is-expanded');
        });
      }
    });

    // 0a. Refresh dynamic link indexer and mega-menu close buttons
    if (Crawler) Crawler.scan();
    if (MenuDrawer) MenuDrawer.injectCloseButtons();

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
    } else if (DaTracker) {
      DaTracker.destroy();
    }

    // 9. Marks Summary, Grade History CGPA Capture & Potential CGPA Calculator
    if (MarksFatPredictor?.captureGradeHistory) {
      MarksFatPredictor.captureGradeHistory();
    }
    if (currentSettings.enableFatPredictor !== false && MarksFatPredictor) {
      MarksFatPredictor.init();
    } else if (MarksFatPredictor?.destroy) {
      MarksFatPredictor.destroy();
    }

    // 10. Home Page Class Messages Widget
    if (HomeMessages) {
      HomeMessages.init();
    }

    // 11. Today's Schedule Widget & Timetable .ics Export
    if (currentSettings.enableScheduleWidget !== false && TimetableCalendar) {
      TimetableCalendar.init();
    } else if (TimetableCalendar?.destroy) {
      TimetableCalendar.destroy();
    }

    // 12. Marks Changed / Uploaded Notifier
    if (currentSettings.enableMarksNotifier !== false && MarksNotifier) {
      MarksNotifier.init();
    } else if (MarksNotifier?.destroy) {
      MarksNotifier.destroy();
    }
  }

  function isExtensionNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id && node.id.startsWith('vtop-')) return true;
    if (typeof node.className === 'string' && node.className.includes('vtop-')) return true;
    return Boolean(
      (node.matches && node.matches('[data-vtop-nav-item]')) ||
      (node.closest && node.closest('[id^="vtop-"], [class*="vtop-"], [data-vtop-nav-item]'))
    );
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
        if (changedEls.length === 0 && m.target?.id === 'b5-pagewrapper') return true;
        return changedEls.length > 0 && changedEls.every(isExtensionNode);
      });
      if (isInternal) return;

      if (window.__vtop_plus_scan_t) clearTimeout(window.__vtop_plus_scan_t);
      window.__vtop_plus_scan_t = setTimeout(() => {
        runPageScanners();
      }, 100);
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

      // Check Course Downloader if #materialTable buttons exist but panel is not mounted
      if (currentSettings.enableDownloader !== false && CourseDownloader) {
        const materialTable = document.getElementById('materialTable');
        const hasDownloadBtn = Boolean(
          materialTable
            ? materialTable.querySelector('button#downloadmat[data-fileid], button[data-fileid], .download-btn[data-fileid]')
            : document.querySelector('button#downloadmat[data-fileid], button[data-fileid], .download-btn[data-fileid]')
        );
        const panel = document.getElementById('vtop-zip-panel');
        if (hasDownloadBtn && !panel) {
          CourseDownloader.init();
        }
      }

      // Check DA Tracker if on DA view but status column/cell badges are not yet mounted
      if (currentSettings.enableDaTracker !== false && currentPageType === 'DIGITAL_ASSIGNMENT' && DaTracker) {
        const hasOverviewAugment = Boolean(document.querySelector('.vtop-th-da-status'));
        const hasCellAugment = Boolean(document.querySelector('.vtop-da-cell-augmented'));
        if (!hasOverviewAugment && !hasCellAugment) {
          DaTracker.init();
        }
      }
    }, 2000);
  }

  function applyModuleStates() {
    if (DarkMode && typeof currentSettings.enableDarkMode === 'boolean') {
      DarkMode.set(currentSettings.enableDarkMode);
    }
    if (PrivacyMode && typeof currentSettings.enablePrivacyMode === 'boolean') {
      PrivacyMode.set(currentSettings.enablePrivacyMode);
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

    if (currentSettings.enableDaTracker === false) DaTracker?.destroy();
    if (currentSettings.enableScheduleWidget === false) TimetableCalendar?.destroy();
    if (currentSettings.enableMarksNotifier === false) MarksNotifier?.destroy();

    runPageScanners();
  }

  /**
   * Listen for communication from popup.js and cross-tab storage
   */
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.action !== 'string') return;

      if (message.action === 'FORCE_SCAN') {
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

      if (message.action === 'OPEN_SEARCH_PAGES') {
        if (CommandPalette) {
          CommandPalette.open();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'CommandPalette not loaded' });
        }
        return true;
      }

      if (message.action === 'TOGGLE_PRIVACY') {
        if (typeof message.active === 'boolean') PrivacyMode?.set(message.active);
        else PrivacyMode?.toggle();
        sendResponse({ success: true, active: PrivacyMode?.isActive });
        return true;
      }

      if (message.action === 'TOGGLE_DARK_MODE') {
        if (typeof message.active === 'boolean') DarkMode?.set(message.active);
        else DarkMode?.toggle();
        sendResponse({ success: true, active: DarkMode?.isActive });
        return true;
      }

      if (message.action === 'APPLY_SETTINGS') {
        if (!message.settings || typeof message.settings !== 'object') {
          sendResponse({ success: false, error: 'Invalid settings payload' });
          return true;
        }
        currentSettings = { ...currentSettings, ...message.settings };

        applyModuleStates();
        sendResponse({ success: true });
        return true;
      }
    });

    // Listen for storage changes across tabs
    Storage.onChanged((newSettings) => {
      currentSettings = { ...currentSettings, ...newSettings };
      applyModuleStates();
    });
  }
})();
