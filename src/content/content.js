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
    CourseFilter,
    CourseDownloader,
    AttendanceCalculator,
    DaTracker,
    MarksFatPredictor,
    CommandPalette,
    QuickDock,
    DarkMode,
    HomeMessages,
    TimetableCalendar,
    MarksNotifier,
    ErrorPage
  } = window.VTOP_PLUS;

  let currentSettings = { ...Storage.DEFAULT_SETTINGS };

  init();

  function init() {
    currentSettings = Storage.getCachedSettingsSync
      ? Storage.getCachedSettingsSync()
      : { ...Storage.DEFAULT_SETTINGS };

    setupMessageListener();
    setupMutationObserver();
    setupWatchdog();

    bootModules();

    Storage.getSettings().then((stored) => {
      if (!stored) return;
      const changed = Object.keys(stored).some((k) => stored[k] !== currentSettings[k]);
      currentSettings = stored;
      if (changed) {
        applyModuleStates();
      }
    });
  }

  function bootModules() {
    // 0. Pre-crawl VTOP routes, upgrade raw Tomcat error pages, and initialize mega-menu drawer dismiss
    if (ErrorPage) ErrorPage.init();
    if (Crawler) Crawler.scan();
    if (MenuDrawer) MenuDrawer.init();

    // 1. Login Page Auto-Captcha
    if (currentSettings.enableAutoCaptcha !== false && AutoCaptcha) {
      AutoCaptcha.init();
    }

    // 2. Universal Dark Mode
    if (DarkMode) DarkMode.init();

    // 4. Search Pages (Ctrl+K)
    if (currentSettings.enableSpotlight !== false && CommandPalette) {
      CommandPalette.init();
    }

    // 5. Quick Dock
    if (currentSettings.enableQuickDock !== false && QuickDock) {
      QuickDock.init();
    }

    document.documentElement?.classList.toggle('vtop-course-filter-enabled', currentSettings.enableCourseFilter !== false);

    // Run contextual page scanners
    runPageScanners();
  }

  function runPageScanners() {
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

    // Remove stray <br> spacers between Student Profile accordion items
    document.querySelectorAll('#accordionExample > br').forEach((br) => br.remove());

    // Fix VTOP's accordion buttons missing `.collapsed` when collapsed (`aria-expanded="false"`)
    document
      .querySelectorAll('#courseAccordion .accordion-button[aria-expanded="false"]:not(.collapsed), #accordionExample .accordion-button[aria-expanded="false"]:not(.collapsed)')
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
      DaTracker.init({ augmentHomeCard: currentSettings.enableDaHomeCard !== false });
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

    // 10. Home Page Class Messages Widget & Default Empty States
    if (HomeMessages) {
      HomeMessages.init({ showCard: currentSettings.enableHomeMessages !== false });
    }

    // 11. Today's Schedule Widget & Timetable .ics Export
    if (TimetableCalendar) {
      TimetableCalendar.init({ showHomeWidget: currentSettings.enableScheduleWidget !== false });
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

      // Immediately mount/refresh CourseFilter if VTOP injected or populated #courseId so native dropdown never flashes
      if (currentSettings.enableCourseFilter !== false && CourseFilter) {
        const hasNewCourseSelect = mutations.some((m) => {
          if (m.target?.nodeType === 1 && m.target.matches?.('select#courseId, select[name="courseId"]')) {
            return true;
          }
          return Array.from(m.addedNodes).some(
            (n) =>
              n.nodeType === 1 &&
              (n.matches?.('select#courseId, select[name="courseId"]') ||
                Boolean(n.querySelector?.('select#courseId, select[name="courseId"]')))
          );
        });
        if (hasNewCourseSelect) {
          CourseFilter.init();
        }
      }

      if (!window.__vtop_plus_scan_pending) {
        window.__vtop_plus_scan_pending = true;
        const flushScan = () => {
          window.__vtop_plus_scan_pending = false;
          runPageScanners();
        };
        if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
          requestAnimationFrame(flushScan);
        } else {
          setTimeout(flushScan, 16);
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Safety watchdog to catch tables loaded via slow AJAX requests, Dashboard switches, or dynamic tab changes
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

      const needsCourseFilter =
        currentSettings.enableCourseFilter !== false &&
        ((Boolean(document.querySelector('select#courseId, select[name="courseId"]')) &&
          !document.getElementById('vtop-custom-course-filter')) ||
          (Boolean(document.getElementById('materialTable')) &&
            !document.getElementById('vtop-plus-table-filter-bar')));

      const hasHomeRightAnchor = Boolean(document.getElementById('proctor-message') || document.getElementById('edu-status'));
      const hasUnaugmentedHomeDa =
        currentSettings.enableDaTracker !== false &&
        currentSettings.enableDaHomeCard !== false &&
        Array.from(document.querySelectorAll('#digital-assignments table tbody tr')).some(
          (tr) => tr.textContent.trim().length > 0 && !tr.querySelector('.vtop-da-home-cell')
        );

      const needsDashboard =
        (currentSettings.enableHomeMessages !== false &&
          Boolean(document.getElementById('course-data')) &&
          !document.getElementById('vtop-home-class-messages')) ||
        (currentSettings.enableScheduleWidget !== false &&
          hasHomeRightAnchor &&
          !document.getElementById('vtop-home-today-schedule')) ||
        (currentSettings.enableMarksNotifier !== false &&
          hasHomeRightAnchor &&
          !document.getElementById('vtop-home-marks-updates')) ||
        hasUnaugmentedHomeDa;

      const needsQuickDock =
        currentSettings.enableQuickDock !== false &&
        Boolean(QuickDock?.isAuthenticated?.()) &&
        !QuickDock.isMountedInDom();

      const needsAttendance =
        currentSettings.enableAttendanceCalc !== false &&
        Boolean(document.getElementById('AttendanceDetailDataTable')) &&
        !document.getElementById('vtop-attendance-summary-card');

      const markForm = document.getElementById('studentMarkView');
      const marksTableExists = Boolean(document.querySelector('#fixedTableContainer table.customTable-level1'));
      const hasCgpaHostCard = Boolean(
        markForm?.closest('.card') ||
          (marksTableExists &&
            !document.getElementById('studentGradeView') &&
            document.querySelector('#fixedTableContainer')?.closest('.card'))
      );
      const needsFatPredictor =
        currentSettings.enableFatPredictor !== false &&
        ((marksTableExists && !document.querySelector('.vtop-fat-inline-tfoot')) ||
          (hasCgpaHostCard && !document.getElementById('vtop-cgpa-calculator')));

      if (needsCourseFilter || needsDashboard || needsQuickDock || needsAttendance || needsFatPredictor) {
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
        if (hasDownloadBtn && (!panel || panel.style.display === 'none')) {
          CourseDownloader.init();
        }
      }

      // Check DA Tracker if on DA view but status column/cell badges are not yet mounted
      if (currentSettings.enableDaTracker !== false && DaTracker) {
        const hasOverviewAugment = Boolean(document.querySelector('.vtop-th-da-status'));
        const hasCellAugment = Boolean(document.querySelector('.vtop-da-cell-augmented'));
        if (!hasOverviewAugment && !hasCellAugment) {
          DaTracker.init({ augmentHomeCard: currentSettings.enableDaHomeCard !== false });
        }
      }
    }, 1500);
  }

  function applyModuleStates() {
    document.documentElement?.classList.toggle('vtop-course-filter-enabled', currentSettings.enableCourseFilter !== false);
    if (DarkMode && typeof currentSettings.enableDarkMode === 'boolean') {
      DarkMode.set(currentSettings.enableDarkMode, false, false);
    }

    if (currentSettings.enableQuickDock !== false) QuickDock?.init();
    else QuickDock?.destroy();

    if (currentSettings.enableCourseFilter !== false) CourseFilter?.init();
    else CourseFilter?.destroy();

    if (currentSettings.enableSpotlight !== false) CommandPalette?.init();
    else CommandPalette?.destroy();

    if (currentSettings.enableDownloader !== false) CourseDownloader?.init();
    else CourseDownloader?.destroy();

    if (currentSettings.enableDaTracker === false) DaTracker?.destroy();
    else if (currentSettings.enableDaHomeCard === false) window.VTOP_PLUS?.DaHomeCard?.destroy?.();

    if (currentSettings.enableHomeMessages === false) HomeMessages?.destroy?.();
    if (currentSettings.enableScheduleWidget === false) TimetableCalendar?.destroyHomeWidget?.();
    if (currentSettings.enableMarksNotifier === false) MarksNotifier?.destroy();

    runPageScanners();
  }

  function applySettingsPatch(patch) {
    if (!patch || typeof patch !== 'object') return false;
    const changed = Object.keys(patch).some((k) => patch[k] !== currentSettings[k]);
    if (!changed) return false;
    currentSettings = { ...currentSettings, ...patch };
    applyModuleStates();
    return true;
  }

  // Listen for popup APPLY_SETTINGS and cross-tab storage changes
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.action !== 'string') return;

      if (message.action === 'APPLY_SETTINGS') {
        if (!message.settings || typeof message.settings !== 'object') {
          sendResponse({ success: false, error: 'Invalid settings payload' });
          return true;
        }
        applySettingsPatch(message.settings);
        sendResponse({ success: true });
        return true;
      }
    });

    Storage.onChanged((newSettings) => {
      applySettingsPatch(newSettings);
    });
  }
})();
