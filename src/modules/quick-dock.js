/**
 * VTOP++ - Navbar Integrated Quick Shortcuts & In-Flight Navigation Queue
 * Specifically calibrated for VIT Vellore VTOP (vtop.vit.ac.in).
 * Injects 1-click page shortcuts and utility controls directly into the VTOP navbar
 * with an in-flight navigation queue and auto-unblock stall recovery.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  class QuickDock {
    constructor() {
      this.dockId = 'vtop-plus-quick-dock';
      this.container = null;
      this.mountedElements = [];
      this.isMounted = false;
      this.isInFlight = false;
      this.hasSeenBlockUI = false;
      this.pendingTarget = null;
      this.activePill = null;
      this.stuckWatchdogTimer = null;
      this.fallbackSettleTimer = null;
      this.progressBar = null;
      this.blockUIObserver = null;
      this.observedRoot = null;
    }

    /**
     * Strict verification: returns true ONLY when inside the authenticated student portal
     */
    isAuthenticated() {
      if (window.location.pathname.includes('/vtop/login') || window.location.href.includes('/open/login')) return false;

      const hasLoginForm = Boolean(
        document.querySelector('#vtopLoginForm, input#username, #loginForm, #vtopLogin, #authLoginBtn, input[name="username"], input[type="password"]')
      );
      if (hasLoginForm) return false;

      const authIdx = document.getElementById('authorizedIDX')?.value?.trim();
      const authId = document.getElementById('authorizedID')?.value?.trim();
      const userDropdown =
        document.getElementById('navbarDropdown') ||
        document.querySelector('.dropdown-toggle[href*="logout"], a[href*="logout"]');
      const hmenuBar = document.getElementById('top-hmenu-bar');

      const hasAuthUser = Boolean((authIdx && authIdx.length > 2) || (authId && authId.length > 2) || userDropdown);
      return Boolean(hasAuthUser && (hmenuBar || document.getElementById('vtop-header')));
    }

    /**
     * Watches VTOP's native BlockUI overlay only during in-flight navigation
     */
    startBlockUIObserver() {
      if (!this.blockUIObserver) {
        this.blockUIObserver = new MutationObserver((mutations) => {
          if (!this.isInFlight) return;

          const isBlocked = Boolean(document.querySelector('.blockUI, .blockOverlay'));

          if (isBlocked) {
            this.hasSeenBlockUI = true;
          } else if (!isBlocked && this.hasSeenBlockUI) {
            this.hasSeenBlockUI = false;
            this.onNavigationComplete();
          } else if (!isBlocked && !this.hasSeenBlockUI) {
            const mainContent = document.getElementById('page_outline') || document.querySelector('main, .page-content');
            if (mainContent && mutations.some((m) => m.addedNodes.length > 0 && mainContent.contains(m.target))) {
              this.onNavigationComplete();
            }
          }
        });
      }

      const root = document.body || document.documentElement;
      if (root && this.observedRoot !== root) {
        this.blockUIObserver.disconnect();
        this.blockUIObserver.observe(root, {
          childList: true,
          subtree: true
        });
        this.observedRoot = root;
      }
    }

    stopBlockUIObserver() {
      if (this.blockUIObserver) {
        this.blockUIObserver.disconnect();
      }
      this.observedRoot = null;
    }

    setInFlight(inFlight) {
      this.isInFlight = inFlight;

      if (this.progressBar) {
        if (inFlight) this.progressBar.classList.add('vtop-progress-active');
        else this.progressBar.classList.remove('vtop-progress-active');
      }

      if (inFlight) {
        clearTimeout(this.stuckWatchdogTimer);
        clearTimeout(this.fallbackSettleTimer);
        this.startBlockUIObserver();

        // Fallback: if view settled instantly without showing BlockUI
        this.fallbackSettleTimer = setTimeout(() => {
          if (this.isInFlight && !this.hasSeenBlockUI) {
            this.onNavigationComplete();
          }
        }, 450);

        // Safe watchdog: if BlockUI is genuinely stuck for > 15s, execute auto-unblock recovery
        this.stuckWatchdogTimer = setTimeout(() => {
          if (this.isInFlight) {
            console.warn('[VTOP++] VTOP server request took >15s. Executing safe unblock recovery.');
            this.recoverFromStall();
          }
        }, 15000);
      } else {
        clearTimeout(this.stuckWatchdogTimer);
        clearTimeout(this.fallbackSettleTimer);
        this.stuckWatchdogTimer = null;
        this.fallbackSettleTimer = null;
        this.hasSeenBlockUI = false;
        this.stopBlockUIObserver();
      }
    }

    onNavigationComplete() {
      this.setInFlight(false);

      if (this.activePill) {
        this.activePill.classList.remove('vtop-pill-loading');
        this.activePill = null;
      }

      if (this.pendingTarget) {
        const next = this.pendingTarget;
        this.pendingTarget = null;

        const allPills = document.querySelectorAll('.vtop-dock-pill');
        allPills.forEach((p) => p.classList.remove('vtop-pill-queued'));

        setTimeout(() => {
          this.executeNavigation(next.dockItem, next.pillElement);
        }, 40);
      }
    }

    recoverFromStall() {
      window.VTOP_PLUS?.DOM?.rescueBlockUIPopup?.();
      document.querySelectorAll('.blockUI, .blockOverlay').forEach((el) => el.remove());
      this.onNavigationComplete();
    }

    requestNavigation(dockItem, pillElement = null) {
      if (this.isInFlight) {
        const allPills = document.querySelectorAll('.vtop-dock-pill');
        allPills.forEach((p) => p.classList.remove('vtop-pill-queued'));

        if (pillElement) {
          pillElement.classList.add('vtop-pill-queued');
        }

        this.pendingTarget = { dockItem, pillElement };
        return false;
      }

      this.executeNavigation(dockItem, pillElement);
      return true;
    }

    executeNavigation(dockItem, pill) {
      window.VTOP_PLUS.MenuDrawer?.closeAllDrawers();

      const crawler = window.VTOP_PLUS.Crawler;
      if (!crawler) {
        this.onNavigationComplete();
        return;
      }

      this.setInFlight(true);
      this.activePill = pill;
      if (pill) pill.classList.add('vtop-pill-loading');

      let navigated = false;
      if (dockItem.targetItem) {
        navigated = crawler.navigate(dockItem.targetItem);
      }
      
      if (!navigated) {
        crawler.scan();
        const fresh = crawler.getQuickDockItems().find((i) => i.id === dockItem.id);
        if (fresh && fresh.targetItem) {
          navigated = crawler.navigate(fresh.targetItem);
        }
      }

      if (!navigated) {
        console.warn(`[VTOP++] Navigation target not found: ${dockItem.title}`);
        this.onNavigationComplete();
      }
    }

    getDockIconSvg(id) {
      const UI = window.VTOP_PLUS?.UI;
      const iconMap = {
        'course-page': ['book', 14],
        'attendance': ['chart', 14],
        'timetable': ['calendar', 14],
        'digital-assignments': ['file-text', 14],
        'marks-grades': ['target', 14],
        'search': ['search', 14],
        'downloader': ['download', 15],
        'dark-mode': ['moon', 15],
        'moon': ['moon', 15],
        'sun': ['sun', 15]
      };
      const [name, size] = iconMap[id] || ['circle-dot', 14];
      return UI ? UI.icon(name, size, { className: 'vtop-dock-icon' }) : '';
    }

    getShortTitle(id, originalTitle) {
      const SHORT_NAMES = {
        'course-page': 'Course Page',
        'attendance': 'Attendance',
        'timetable': 'Timetable',
        'digital-assignments': 'Digital Assignments',
        'marks-grades': 'Marks & Grades'
      };
      return SHORT_NAMES[id] || originalTitle;
    }

    isMountedInDom() {
      const navControl = document.getElementById('vtopHeaderBarControl');
      if (navControl) {
        return Boolean(
          navControl.querySelector('[data-vtop-nav-item="true"]') &&
          navControl.classList.contains('vtop-navbar-has-items')
        );
      }
      if (document.getElementById(this.dockId)) return true;
      if (document.querySelector('[data-vtop-nav-item="true"]')) return true;
      return this.mountedElements.length > 0 && this.mountedElements.some((el) => document.body.contains(el));
    }

    init() {
      if (!this.isAuthenticated()) {
        this.destroy();
        return;
      }

      if (this.isMounted && this.isMountedInDom()) return;
      this.mount();
    }

    mount() {
      if (!this.isAuthenticated()) return;
      if (this.isMountedInDom()) return;

      // Clean up any stale/orphaned items before re-mounting cleanly
      document.querySelectorAll('[data-vtop-nav-item="true"]').forEach((el) => el.remove());
      document.getElementById(this.dockId)?.remove();
      this.mountedElements = [];
      this.container = null;

      // 1. Permanently remove unused Campus Etiquette button
      const etiquetteBtn = document.getElementById('campusEtiquetteBtn');
      if (etiquetteBtn) {
        etiquetteBtn.remove();
      }

      // 2. Find target navbar containers
      const navControl = document.getElementById('vtopHeaderBarControl');
      const quickLinks = document.getElementById('quickLinks');
      const header = document.getElementById('vtop-header');

      const crawler = window.VTOP_PLUS.Crawler;
      const dockItems = crawler ? crawler.getQuickDockItems() : [];

      // Linear progress bar at top of screen
      if (!this.progressBar) {
        this.progressBar = document.createElement('div');
        this.progressBar.id = 'vtop-plus-top-progress';
        this.progressBar.className = 'vtop-top-progress';
        if (header) {
          header.appendChild(this.progressBar);
        } else {
          document.body.appendChild(this.progressBar);
        }
      }

      const elements = [];

      // 1. Core 5 VTOP Pages
      dockItems.forEach((dockItem) => {
        const pill = document.createElement('button');
        pill.className = `vtop-nav-item vtop-dock-pill ${!dockItem.isFound ? 'vtop-pill-unmapped' : ''}`;
        pill.title = `Open ${dockItem.title}`;
        pill.type = 'button';

        const iconSvg = this.getDockIconSvg(dockItem.id);
        const shortTitle = this.getShortTitle(dockItem.id, dockItem.title);

        pill.innerHTML = `
          <span class="vtop-pill-icon">${iconSvg}</span>
          <span class="vtop-pill-text"></span>
          <span class="vtop-pill-spinner"></span>
        `;
        const textSpan = pill.querySelector('.vtop-pill-text');
        if (textSpan) textSpan.textContent = shortTitle;

        pill.addEventListener('click', (e) => {
          e.preventDefault();
          this.requestNavigation(dockItem, pill);
        });

        elements.push(pill);
      });

      // 2. Search Pages Launcher (Ctrl+K)
      const isMac = Boolean(navigator.userAgent?.includes('Mac') || navigator.platform?.toUpperCase().includes('MAC'));
      const kbdText = isMac ? '⌘K' : 'Ctrl+K';
      const searchPill = document.createElement('button');
      searchPill.className = 'vtop-nav-item vtop-dock-pill vtop-pill-search';
      searchPill.title = 'Search Pages (Ctrl+K)';
      searchPill.type = 'button';
      searchPill.innerHTML = `
        <span class="vtop-pill-icon">${this.getDockIconSvg('search')}</span>
        <span class="vtop-pill-text">Search Pages</span>
        <kbd class="vtop-kbd-shortcut">${kbdText}</kbd>
      `;
      searchPill.addEventListener('click', (e) => {
        e.preventDefault();
        window.VTOP_PLUS.CommandPalette?.open();
      });
      elements.push(searchPill);

      // 3. Compact Divider
      const sep = document.createElement('div');
      sep.className = 'vtop-nav-item vtop-dock-sep';
      sep.setAttribute('aria-hidden', 'true');
      elements.push(sep);

      // 4. Utility Icon Buttons: Downloader, Dark Mode
      const dlBtn = document.createElement('button');
      dlBtn.id = 'vtop-dock-dl-btn';
      dlBtn.type = 'button';
      dlBtn.className = 'vtop-nav-item vtop-dock-icon-btn';
      dlBtn.title = 'Open Course Material Downloader';
      dlBtn.style.display = 'none';
      dlBtn.innerHTML = this.getDockIconSvg('downloader');
      dlBtn.addEventListener('click', () => window.VTOP_PLUS.CourseDownloader?.openPanel());
      elements.push(dlBtn);

      const isDark = Boolean(window.VTOP_PLUS.DarkMode?.isActive);
      const darkBtn = document.createElement('button');
      darkBtn.id = 'vtop-dock-dark-btn';
      darkBtn.type = 'button';
      darkBtn.className = `vtop-nav-item vtop-dock-icon-btn ${isDark ? 'active' : ''}`;
      darkBtn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
      darkBtn.innerHTML = this.getDockIconSvg(isDark ? 'sun' : 'moon');
      darkBtn.addEventListener('click', () => window.VTOP_PLUS.DarkMode?.toggle());
      elements.push(darkBtn);

      elements.forEach((el) => el.setAttribute('data-vtop-nav-item', 'true'));

      // Clean up empty spacer if present to let navbar items spread out naturally
      const emptySpacer = navControl?.querySelector('strong.mx-auto');
      if (emptySpacer && !emptySpacer.textContent.trim()) {
        emptySpacer.remove();
      }

      // 5. Mount individual options directly into the VIT navbar
      if (quickLinks || navControl) {
        elements[0].classList.add('vtop-nav-item-first');
        elements[elements.length - 1].classList.add('vtop-nav-item-last');

        const mountParent = quickLinks ? quickLinks.parentElement : navControl;
        if (quickLinks) {
          quickLinks.classList.remove('me-auto');
          quickLinks.after(...elements);
        } else {
          navControl.prepend(...elements);
        }
        if (mountParent) {
          mountParent.classList.add('vtop-navbar-has-items');
        }
        this.container = null;
      } else {
        // Fallback container only when VTOP's navbar structure is absent
        const dock = document.createElement('div');
        dock.id = this.dockId;
        dock.className = 'vtop-plus-dock vtop-dock-navbar';

        const pillsList = document.createElement('div');
        pillsList.className = 'vtop-dock-pills';
        elements.forEach((el) => pillsList.appendChild(el));
        dock.appendChild(pillsList);

        if (header) {
          header.appendChild(dock);
        } else {
          document.body.appendChild(dock);
        }
        this.container = dock;
      }

      this.mountedElements = elements;
      this.isMounted = true;
    }

    destroy() {
      this.setInFlight(false);
      this.pendingTarget = null;
      this.activePill = null;

      document.querySelectorAll('.vtop-navbar-has-items').forEach((el) => {
        el.classList.remove('vtop-navbar-has-items');
      });

      this.mountedElements.forEach((el) => {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });
      document.querySelectorAll('[data-vtop-nav-item="true"]').forEach((el) => el.remove());

      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }

      const quickLinks = document.getElementById('quickLinks');
      if (quickLinks) {
        quickLinks.classList.add('me-auto');
      }

      if (this.progressBar && this.progressBar.parentNode) {
        this.progressBar.parentNode.removeChild(this.progressBar);
      }
      this.mountedElements = [];
      this.container = null;
      this.progressBar = null;
      this.isMounted = false;
    }
  }

  window.VTOP_PLUS.QuickDock = new QuickDock();
})();
