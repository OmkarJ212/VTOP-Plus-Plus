/**
 * VTOP++ - Search Pages (Ctrl+K / Cmd+K)
 * Universal fast search bar for all VTOP pages with 0ms cold-start,
 * deep-indexed page search across all VTOP menus, fuzzy scoring, live keyword highlighting,
 * and 1-click native navigation.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const POOL_SIZE = 15;

  class CommandPalette {
    constructor() {
      this.isOpen = false;
      this.modal = null;
      this.input = null;
      this.resultsContainer = null;
      this.emptyState = null;
      this.filteredItems = [];
      this.rowPool = [];
      this.selectedIndex = 0;
      this.prevSelectedIndex = 0;
      this._keyboardListenerAttached = false;
      this._keydownHandler = null;
    }

    init() {
      if (window !== window.top) return; // Don't mount in nested sub-frames
      this.initKeyboardListener();
      this.createDOM();
    }

    destroy() {
      this.close();
      if (this._keydownHandler) {
        window.removeEventListener('keydown', this._keydownHandler);
      }
      this._keyboardListenerAttached = false;
      this._keydownHandler = null;
      if (this.modal) {
        this.modal.remove();
        this.modal = null;
      }
    }

    initKeyboardListener() {
      if (this._keyboardListenerAttached) return;
      this._keyboardListenerAttached = true;

      this._keydownHandler = (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          this.toggle();
        } else if (e.key === 'Escape' && this.isOpen) {
          e.preventDefault();
          this.close();
        }
      };
      window.addEventListener('keydown', this._keydownHandler);
    }

    createDOM() {
      if (document.getElementById('vtop-plus-palette-overlay')) {
        this.modal = document.getElementById('vtop-plus-palette-overlay');
        this.input = document.getElementById('vtop-palette-input');
        this.resultsContainer = document.getElementById('vtop-palette-list');
        return;
      }

      this.modal = document.createElement('div');
      this.modal.id = 'vtop-plus-palette-overlay';
      this.modal.className = 'vtop-palette-overlay';
      this.modal.style.display = 'none';

      this.modal.innerHTML = `
        <div class="vtop-palette-dialog">
          <div class="vtop-palette-header">
            <svg class="vtop-palette-search-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--vtop-text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" id="vtop-palette-input" class="vtop-palette-input"
              placeholder="Search VTOP pages"
              autocomplete="off" spellcheck="false" />
            <kbd class="vtop-palette-esc">ESC</kbd>
          </div>
          <div class="vtop-palette-list" id="vtop-palette-list">
            <div class="vtop-palette-empty" id="vtop-palette-empty" style="display:none;">
              <div>No matching VTOP pages found.</div>
            </div>
          </div>
          <div class="vtop-palette-footer">
            <span class="vtop-palette-hint"><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
            <span class="vtop-palette-hint"><kbd>Enter</kbd> Select</span>
            <span class="vtop-palette-hint"><kbd>Esc</kbd> Close</span>
            <span style="margin-left:auto;font-weight:600;color:var(--vtop-accent-sky);font-size:12px;">Search Pages</span>
          </div>
        </div>
      `;

      document.body.appendChild(this.modal);

      this.input = document.getElementById('vtop-palette-input');
      this.resultsContainer = document.getElementById('vtop-palette-list');
      this.emptyState = document.getElementById('vtop-palette-empty');

      // Click outside to dismiss
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });

      this.input.addEventListener('input', (e) => this.handleSearch(e.target.value));
      this.input.addEventListener('keydown', (e) => this.handleKeyDown(e));

      // Build DOM element pool (15 pre-allocated rows)
      this.rowPool = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        const row = document.createElement('div');
        row.className = 'vtop-palette-item';
        row.style.display = 'none';

        const mainEl = document.createElement('div');
        mainEl.className = 'vtop-palette-item-text';

        const titleEl = document.createElement('div');
        titleEl.className = 'vtop-palette-item-title';

        const subEl = document.createElement('div');
        subEl.className = 'vtop-palette-item-sub';

        mainEl.appendChild(titleEl);
        mainEl.appendChild(subEl);

        const actionEl = document.createElement('span');
        actionEl.className = 'vtop-palette-item-action';
        actionEl.textContent = 'Open →';

        row.appendChild(mainEl);
        row.appendChild(actionEl);

        const poolEntry = { row, titleEl, subEl, item: null };
        row.addEventListener('click', () => {
          if (poolEntry.item) this.selectItem(poolEntry.item);
        });

        this.rowPool.push(poolEntry);
        this.resultsContainer.appendChild(row);
      }
    }

    open() {
      if (!this.modal || !document.getElementById('vtop-plus-palette-overlay')) {
        this.createDOM();
      }
      if (!this.modal) return;

      // Rescan dynamic links on every open
      if (window.VTOP_PLUS.Crawler) {
        window.VTOP_PLUS.Crawler.scan();
      }

      this.modal.style.display = 'flex';
      this.isOpen = true;
      this.selectedIndex = 0;
      this.prevSelectedIndex = 0;

      if (this.input) {
        this.input.value = '';
        setTimeout(() => {
          this.input.focus();
          this.input.select();
        }, 50);
      }

      this.handleSearch('');
    }

    close() {
      if (this.modal) this.modal.style.display = 'none';
      this.isOpen = false;
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    scoreItem(item, queryLower) {
      const title = (item.lowerTitle || item.title).toLowerCase();

      // 1. Exact match
      if (title === queryLower) return 1000;

      // 2. Title starts with query
      if (title.startsWith(queryLower)) return 850;

      // 3. Acronym match (e.g. "da" -> Digital Assignment, "tt" -> Time Table, "cp" -> Course Page)
      if (item.acronym === queryLower) return 820;
      if (item.acronym && item.acronym.startsWith(queryLower)) return 780;

      // 4. Word prefix match
      if (item.words) {
        for (let i = 0; i < item.words.length; i++) {
          if (item.words[i].startsWith(queryLower)) return 720 - i * 15;
        }
      }

      // 5. Synonym match (e.g. "bunk" -> Attendance, "fat" -> Mark View)
      if (item.synonyms) {
        for (let i = 0; i < item.synonyms.length; i++) {
          const syn = item.synonyms[i];
          if (syn === queryLower) return 680;
          if (syn.startsWith(queryLower)) return 630;
          if (syn.includes(queryLower)) return 550;
        }
      }

      // 6. Substring match inside title
      const subIdx = title.indexOf(queryLower);
      if (subIdx !== -1) return 500 - subIdx * 5;

      // 7. Category match (e.g. "Academics", "Examinations", "Hostels")
      if (item.lowerCat && item.lowerCat.includes(queryLower)) return 220;

      // 8. Fuzzy subsequence match
      if (queryLower.length >= 3) {
        let qIdx = 0;
        let score = 0;
        let consecutive = 0;
        let firstMatchIdx = -1;
        let lastMatchIdx = -1;
        for (let i = 0; i < title.length && qIdx < queryLower.length; i++) {
          if (title[i] === queryLower[qIdx]) {
            if (firstMatchIdx === -1) firstMatchIdx = i;
            lastMatchIdx = i;
            consecutive++;
            score += 15 + consecutive * 5;
            qIdx++;
          } else {
            consecutive = 0;
          }
        }
        if (qIdx === queryLower.length) {
          const span = lastMatchIdx - firstMatchIdx;
          if (span > queryLower.length * 3) return 0;
          return score;
        }
      }

      return 0;
    }

    handleSearch(query) {
      const q = (query || '').trim().toLowerCase();
      const crawler = window.VTOP_PLUS.Crawler;
      const crawledItems = crawler ? crawler.getAllItems() : [];

      const builtInActions = [
        {
          id: 'vtop-action-dark-mode',
          title: 'Toggle Dark Mode',
          category: 'Quick Action',
          isAction: true,
          action: () => window.VTOP_PLUS.DarkMode?.toggle(),
          acronym: 'dm',
          words: ['toggle', 'dark', 'mode', 'theme', 'night'],
          synonyms: ['dark', 'night', 'theme', 'black', 'mode', 'light']
        },
        {
          id: 'vtop-action-privacy-mode',
          title: 'Toggle Privacy Blur',
          category: 'Quick Action',
          isAction: true,
          action: () => window.VTOP_PLUS.PrivacyMode?.toggle(),
          acronym: 'pm',
          words: ['toggle', 'privacy', 'blur', 'mode', 'incognito'],
          synonyms: ['privacy', 'blur', 'hide', 'censor', 'incognito']
        }
      ];

      const allItems = [...builtInActions, ...crawledItems];

      if (!q) {
        this.filteredItems = allItems.slice(0, POOL_SIZE);
      } else {
        const scored = [];
        for (let i = 0; i < allItems.length; i++) {
          const item = allItems[i];
          const score = this.scoreItem(item, q);
          if (score > 0) {
            scored.push({ item, score });
          }
        }
        scored.sort((a, b) => b.score - a.score);
        this.filteredItems = scored.slice(0, POOL_SIZE).map((s) => s.item);
      }

      this.selectedIndex = 0;
      this.prevSelectedIndex = 0;
      this.renderResults(q);
    }

    updateHighlight(container, text, queryLower) {
      if (!queryLower || queryLower.length < 2) {
        container.textContent = text;
        return;
      }

      const lower = text.toLowerCase();
      const idx = lower.indexOf(queryLower);
      if (idx === -1) {
        container.textContent = text;
        return;
      }

      container.textContent = '';
      if (idx > 0) {
        container.appendChild(document.createTextNode(text.slice(0, idx)));
      }

      const mark = document.createElement('mark');
      mark.className = 'vtop-match';
      mark.textContent = text.slice(idx, idx + queryLower.length);
      container.appendChild(mark);

      if (idx + queryLower.length < text.length) {
        container.appendChild(document.createTextNode(text.slice(idx + queryLower.length)));
      }
    }

    renderResults(queryLower = '') {
      const count = this.filteredItems.length;

      if (count === 0) {
        if (this.emptyState) this.emptyState.style.display = 'block';
        for (let i = 0; i < this.rowPool.length; i++) {
          this.rowPool[i].row.style.display = 'none';
        }
        return;
      }

      if (this.emptyState) this.emptyState.style.display = 'none';
      const maxRender = Math.min(count, this.rowPool.length);

      for (let i = 0; i < maxRender; i++) {
        const pool = this.rowPool[i];
        const item = this.filteredItems[i];
        pool.item = item;

        pool.row.className = `vtop-palette-item ${i === this.selectedIndex ? 'selected' : ''}`;
        
        this.updateHighlight(pool.titleEl, item.title, queryLower);
        pool.subEl.textContent = item.subtitle || (item.category ? `VTOP → ${item.category}` : item.dataUrl || '');

        pool.row.style.display = 'flex';
      }

      for (let i = maxRender; i < this.rowPool.length; i++) {
        this.rowPool[i].row.style.display = 'none';
      }

      this.scrollSelectedIntoView();
    }

    handleKeyDown(e) {
      if (!this.filteredItems.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.prevSelectedIndex = this.selectedIndex;
        this.selectedIndex = (this.selectedIndex + 1) % this.filteredItems.length;
        this.updateSelectionVisuals();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.prevSelectedIndex = this.selectedIndex;
        this.selectedIndex = (this.selectedIndex - 1 + this.filteredItems.length) % this.filteredItems.length;
        this.updateSelectionVisuals();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = this.filteredItems[this.selectedIndex];
        if (selected) this.selectItem(selected);
      }
    }

    updateSelectionVisuals() {
      if (this.rowPool[this.prevSelectedIndex]) {
        this.rowPool[this.prevSelectedIndex].row.classList.remove('selected');
      }
      if (this.rowPool[this.selectedIndex]) {
        this.rowPool[this.selectedIndex].row.classList.add('selected');
      }
      this.scrollSelectedIntoView();
    }

    scrollSelectedIntoView() {
      const pool = this.rowPool[this.selectedIndex];
      if (pool && pool.row) {
        pool.row.scrollIntoView({ block: 'nearest' });
      }
    }

    selectItem(item) {
      this.close();
      this.dispatchNavigation(item);
    }

    dispatchNavigation(item) {
      if (item.isAction && typeof item.action === 'function') {
        item.action();
        return;
      }
      const qd = window.VTOP_PLUS?.QuickDock;
      if (qd && typeof qd.requestNavigation === 'function') {
        qd.requestNavigation({ id: item.id, title: item.title, targetItem: item });
      } else if (window.VTOP_PLUS.Crawler) {
        window.VTOP_PLUS.Crawler.navigate(item);
      } else if (item.element && typeof item.element.click === 'function') {
        item.element.click();
      }
    }
  }

  window.VTOP_PLUS.CommandPalette = new CommandPalette();
})();