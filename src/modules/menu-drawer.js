/**
 * VTOP++ - Mega-Menu Drawer Controller
 * Handles click-outside, Escape key, backdrop overlay, and close buttons
 * for VTOP's mega-menu drawers (#MG0001, #MG0002, etc.).
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const OPEN_DRAWER_SELECTOR = '.hmenubox.collapse.show, .collapse.show.hmenuitem, div[id^="MG0"].collapse.show';

  class MenuDrawerController {
    constructor() {
      this.isInitialized = false;
      this.backdrop = null;
      this.menuObserver = null;
      this.observedHmenuBar = null;
      this._onDocClick = null;
      this._onKeyDown = null;
    }

    init() {
      if (this.isInitialized) return;

      this.createBackdrop();
      this.setupGlobalListeners();
      this.attachMenuObserver();
      this.injectCloseButtons();
      this.isInitialized = true;
    }

    destroy() {
      if (this.menuObserver) {
        this.menuObserver.disconnect();
        this.menuObserver = null;
      }
      this.observedHmenuBar = null;
      if (this._onDocClick) {
        document.removeEventListener('click', this._onDocClick);
        this._onDocClick = null;
      }
      if (this._onKeyDown) {
        window.removeEventListener('keydown', this._onKeyDown);
        this._onKeyDown = null;
      }
      if (this.backdrop && this.backdrop.parentNode) {
        this.backdrop.parentNode.removeChild(this.backdrop);
      }
      this.backdrop = null;
      this.isInitialized = false;
    }

    /**
     * Create a subtle backdrop overlay behind active mega-menus
     */
    createBackdrop() {
      if (document.getElementById('vtop-plus-drawer-backdrop')) return;

      const backdrop = document.createElement('div');
      backdrop.id = 'vtop-plus-drawer-backdrop';
      backdrop.className = 'vtop-drawer-backdrop';
      backdrop.addEventListener('click', () => this.closeAllDrawers());

      document.body.appendChild(backdrop);
      this.backdrop = backdrop;
    }

    /**
     * Watches #top-hmenu-bar for drawer open/close to toggle backdrop
     */
    attachMenuObserver() {
      const hmenuBar = document.getElementById('top-hmenu-bar');
      if (!hmenuBar) return;
      if (this.menuObserver && this.observedHmenuBar === hmenuBar && this.observedHmenuBar.isConnected) return;

      if (this.menuObserver) {
        this.menuObserver.disconnect();
      }

      this.observedHmenuBar = hmenuBar;
      this.menuObserver = new MutationObserver(() => {
        const hasOpenDrawer = Boolean(document.querySelector(OPEN_DRAWER_SELECTOR));
        if (this.backdrop) {
          this.backdrop.classList.toggle('vtop-backdrop-visible', hasOpenDrawer);
        }
      });

      this.menuObserver.observe(hmenuBar, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true
      });
    }

    /**
     * Setup click-outside and Escape key handlers
     */
    setupGlobalListeners() {
      // 1. Click outside handler
      if (!this._onDocClick) {
        this._onDocClick = (e) => {
          const openDrawer = document.querySelector(OPEN_DRAWER_SELECTOR);
          if (!openDrawer) return;

          // If click was inside the drawer, or on a navbar menu toggle button, do nothing
          const clickedInsideDrawer = openDrawer.contains(e.target);
          const clickedToggleButton = Boolean(
            e.target.closest('#top-hmenu-bar .hmenuItem, a[data-bs-toggle="collapse"], a[href^="#MG"], [data-toggle="collapse"]')
          );

          if (!clickedInsideDrawer && !clickedToggleButton) {
            this.closeDrawer(openDrawer);
          }
        };
        document.addEventListener('click', this._onDocClick);
      }

      // 2. Escape key handler
      if (!this._onKeyDown) {
        this._onKeyDown = (e) => {
          if (e.key === 'Escape') {
            const openDrawer = document.querySelector(OPEN_DRAWER_SELECTOR);
            if (openDrawer) {
              e.preventDefault();
              this.closeDrawer(openDrawer);
            }
          }
        };
        window.addEventListener('keydown', this._onKeyDown);
      }
    }

    /**
     * Injects a modern close (✕) button into each mega-menu drawer
     */
    injectCloseButtons() {
      this.attachMenuObserver();
      const drawers = document.querySelectorAll('.hmenubox, div[id^="MG0"]');

      drawers.forEach((drawer) => {
        if (drawer.querySelector('.vtop-drawer-close-btn')) return;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'vtop-drawer-close-btn';
        closeBtn.title = 'Close menu (Esc)';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.closeDrawer(drawer);
        });

        drawer.prepend(closeBtn);
      });
    }

    /**
     * Safely closes a drawer using class removal & aria updates
     */
    closeDrawer(drawerElement) {
      if (!drawerElement) return;

      // Class removal & aria updates
      drawerElement.classList.remove('show');
      const drawerId = drawerElement.id;
      if (drawerId) {
        const toggleButtons = document.querySelectorAll(
          `[href="#${drawerId}"], [data-bs-target="#${drawerId}"], [data-target="#${drawerId}"]`
        );
        toggleButtons.forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
      }

      if (this.backdrop) {
        this.backdrop.classList.remove('vtop-backdrop-visible');
      }
    }

    /**
     * Closes all open drawers
     */
    closeAllDrawers() {
      const openDrawers = document.querySelectorAll(OPEN_DRAWER_SELECTOR);
      openDrawers.forEach((d) => this.closeDrawer(d));
    }
  }

  window.VTOP_PLUS.MenuDrawer = new MenuDrawerController();
})();
