/**
 * VTOP++ - Mega-Menu Drawer Controller
 * Handles click-outside, Escape key, backdrop overlay, and close buttons
 * for VTOP's mega-menu drawers (#MG0001, #MG0002, etc.).
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  class MenuDrawerController {
    constructor() {
      this.isInitialized = false;
      this.backdrop = null;
      this.menuObserver = null;
    }

    init() {
      if (this.isInitialized) return;

      this.createBackdrop();
      this.setupGlobalListeners();
      this.attachMenuObserver();
      this.injectCloseButtons();
      this.isInitialized = true;
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
      if (this.menuObserver) return;
      const hmenuBar = document.getElementById('top-hmenu-bar');
      if (!hmenuBar) return;

      this.menuObserver = new MutationObserver(() => {
        const hasOpenDrawer = Boolean(document.querySelector('.hmenubox.collapse.show, .collapse.show.hmenuitem'));
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
      document.addEventListener('click', (e) => {
        const openDrawer = document.querySelector('.hmenubox.collapse.show, .collapse.show.hmenuitem');
        if (!openDrawer) return;

        // If click was inside the drawer, or on a navbar menu toggle button, do nothing
        const clickedInsideDrawer = openDrawer.contains(e.target);
        const clickedToggleButton = Boolean(
          e.target.closest('#top-hmenu-bar .hmenuItem, a[data-bs-toggle="collapse"], a[href^="#MG"], [data-toggle="collapse"]')
        );

        if (!clickedInsideDrawer && !clickedToggleButton) {
          this.closeDrawer(openDrawer);
        }
      });

      // 2. Escape key handler
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const openDrawer = document.querySelector('.hmenubox.collapse.show, .collapse.show.hmenuitem');
          if (openDrawer) {
            e.preventDefault();
            this.closeDrawer(openDrawer);
          }
        }
      });
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
      const openDrawers = document.querySelectorAll('.hmenubox.collapse.show, .collapse.show.hmenuitem');
      openDrawers.forEach((d) => this.closeDrawer(d));
    }
  }

  window.VTOP_PLUS.MenuDrawer = new MenuDrawerController();
})();
