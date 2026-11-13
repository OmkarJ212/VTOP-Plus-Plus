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
      document.querySelectorAll('.blockUI, .blockOverlay').forEach((el) => el.remove());
      this.onNavigationComplete();
    }

    requestNavigation(dockItem, pillElement = null) {
      if (this.isInFlight) {
        console.log(`[VTOP++] In-flight request active. Queued: ${dockItem.title}`);

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
      switch (id) {
        case 'course-page':
          return `<svg class="vtop-dock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
        case 'attendance':
          return `<svg class="vtop-dock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
        case 'timetable':
          return `<svg class="vtop-dock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
        case 'digital-assignments':
          return `<svg class="vtop-dock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
        case 'marks-grades':
          return `<svg class="vtop-dock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`;
        case 'search':
          return `<svg class="vtop-dock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
        case 'downloader':
          return `<svg class="vtop-dock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
        case 'privacy':
          return `<svg class="vtop-dock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
        case 'dark-mode':
        case 'moon':
          return `<svg class="vtop-dock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
        case 'sun':
          return `<svg class="vtop-dock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        default:
          return `<svg class="vtop-dock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/></svg>`;
      }
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
        pill.title = dockItem.isFound ? `Open ${dockItem.title}` : `Searching for "${dockItem.title}"`;
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

      // 4. Utility Icon Buttons: Downloader, Privacy, Dark Mode
      const dlBtn = document.createElement('button');
      dlBtn.id = 'vtop-dock-dl-btn';
      dlBtn.type = 'button';
      dlBtn.className = 'vtop-nav-item vtop-dock-icon-btn';
      dlBtn.title = 'Open Course Material Downloader';
      dlBtn.innerHTML = this.getDockIconSvg('downloader');
      dlBtn.addEventListener('click', () => window.VTOP_PLUS.CourseDownloader?.openPanel());
      elements.push(dlBtn);

      const privBtn = document.createElement('button');
      privBtn.id = 'vtop-dock-priv-btn';
      privBtn.type = 'button';
      privBtn.className = 'vtop-nav-item vtop-dock-icon-btn';
      privBtn.title = 'Toggle Privacy Mode (Blur Sensitive Info)';
      privBtn.innerHTML = this.getDockIconSvg('privacy');
      privBtn.addEventListener('click', () => window.VTOP_PLUS.PrivacyMode?.toggle());
      elements.push(privBtn);

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
