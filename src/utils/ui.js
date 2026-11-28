/**
 * VTOP++ - Shared UI & SVG Icon Registry
 * Centralizes inline SVG icons and shared Home dashboard card / empty-state builders.
 */

(function () {
  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const ICONS = {
    book: {
      body: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
    },
    chart: {
      body: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'
    },
    calendar: {
      body: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
    },
    'file-text': {
      body: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'
    },
    target: {
      body: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'
    },
    search: {
      body: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    },
    download: {
      body: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
    },
    moon: {
      body: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    },
    sun: {
      body: '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'
    },
    'circle-dot': {
      noCap: true,
      body: '<circle cx="12" cy="12" r="4"/>'
    },
    refresh: {
      body: '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>'
    },
    'external-link': {
      body: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>'
    },
    'chevron-down': {
      body: '<polyline points="6 9 12 15 18 9"></polyline>'
    },
    check: {
      body: '<polyline points="20 6 9 17 4 12"></polyline>'
    },
    package: {
      body: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>'
    },
    'x-circle': {
      body: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>'
    },
    'graduation-cap': {
      body: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path>'
    },
    home: {
      body: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>'
    },
    'arrow-left': {
      body: '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>'
    }
  };

  const UI = {
    /**
     * Returns an inline SVG string from the shared registry.
     */
    icon(name, size = 14, { className = '', strokeWidth = 2, stroke = 'currentColor', ariaHidden = false } = {}) {
      const def = ICONS[name];
      if (!def) return '';
      const cls = className ? ` class="${className}"` : '';
      const cap = def.noCap ? '' : ' stroke-linecap="round" stroke-linejoin="round"';
      const aria = ariaHidden ? ' aria-hidden="true"' : '';
      return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${cap}${aria}>${def.body}</svg>`;
    },

    /**
     * Locates the right-hand sidebar column on VTOP Home.
     */
    getHomeRightColumn() {
      const anchor =
        document.getElementById('proctor-message')?.closest('.card') ||
        document.getElementById('edu-status')?.closest('.card');
      if (!anchor) return null;
      return anchor.closest('.col-md-4') || anchor.parentElement;
    },

    /**
     * Builds an empty-state HTML block matching Home dashboard card styling.
     */
    emptyState(title, note = '', extraClass = '') {
      const escapeHtml = window.VTOP_PLUS?.DOM?.escapeHtml || ((s) => String(s ?? ''));
      const cls = extraClass ? `vtop-dashboard-empty ${extraClass}` : 'vtop-dashboard-empty';
      const noteHtml = note ? `<div class="vtop-dashboard-empty-note">${escapeHtml(note)}</div>` : '';
      return `<div class="${cls}"><div class="vtop-dashboard-empty-title">${escapeHtml(title)}</div>${noteHtml}</div>`;
    },

    /**
     * Toggles an empty-state element inside a container without duplicating nodes.
     */
    toggleEmptyState(container, isEmpty, title, note = '') {
      if (!container) return;
      const existing = container.querySelector(':scope > .vtop-dashboard-empty');
      if (!isEmpty) {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;

      const emptyEl = document.createElement('div');
      emptyEl.className = 'vtop-dashboard-empty';

      const titleEl = document.createElement('div');
      titleEl.className = 'vtop-dashboard-empty-title';
      titleEl.textContent = title;
      emptyEl.appendChild(titleEl);

      if (note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'vtop-dashboard-empty-note';
        noteEl.textContent = note;
        emptyEl.appendChild(noteEl);
      }
      container.appendChild(emptyEl);
    },

    /**
     * Creates a standardized Home dashboard card element.
     */
    createHomeCard({
      id,
      className = 'card border-0 mb-3',
      headerClass = 'card-header d-flex primaryBorderTop',
      headerHtml = '',
      subBarHtml = '',
      bodyClass = 'card-body',
      bodyId = '',
      bodyHtml = ''
    }) {
      const card = document.createElement('div');
      if (id) card.id = id;
      card.className = className;
      const bodyIdAttr = bodyId ? ` id="${bodyId}"` : '';
      card.innerHTML = `
        <div class="${headerClass}">${headerHtml}</div>
        ${subBarHtml}
        <div class="${bodyClass}"${bodyIdAttr}>${bodyHtml}</div>
      `;
      return card;
    }
  };

  window.VTOP_PLUS.UI = UI;
})();
