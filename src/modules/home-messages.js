/**
 * VTOP++ - Home Page Class Messages Widget
 * Fetches faculty class messages in the background and renders them on the Home page
 * in a clean card matching #course-data.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const CARD_ID = 'vtop-home-class-messages';
  const CLASS_MSG_DATA_URL = 'academics/common/StudentClassMessage';
  const CACHE_KEY = 'vtop_home_class_messages_v3';
  const CACHE_TTL_MS = 5 * 60 * 1000;

  const cleanText = (input) => window.VTOP_PLUS.DOM.cleanText(input);
  const escapeHtml = (str) => window.VTOP_PLUS.DOM.escapeHtml(str);

  function parsePanelMessage(panel) {
    const heading = panel.querySelector('.panel-heading, .expand') || panel;
    const headingClone = heading.cloneNode(true);
    headingClone.querySelectorAll('.left-arrow').forEach((el) => el.remove());

    let course = '';
    let message = '';

    const container = headingClone.querySelector('h5') || headingClone.querySelector('a') || headingClone;
    const bolds = Array.from(container.querySelectorAll('b, strong'));
    if (bolds.length > 0) {
      let currentField = '';
      const collectFrom = (node) => {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          const txt = node.nodeValue || '';
          if (currentField === 'course') course += txt;
          else if (currentField === 'message') message += txt;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName === 'B' || node.tagName === 'STRONG') {
          const lbl = cleanText(node.textContent).toLowerCase();
          if (lbl.startsWith('course')) {
            currentField = 'course';
            return;
          }
          if (lbl.startsWith('message')) {
            currentField = 'message';
            return;
          }
        }
        for (const child of node.childNodes) {
          collectFrom(child);
        }
      };
      collectFrom(container);
      course = cleanText(course);
      message = cleanText(message);
    }

    if (!course && !message) {
      const rawHeading = cleanText(headingClone.textContent);
      const match = rawHeading.match(/Course\s*:\s*([\s\S]*?)\s*Message\s*:\s*([\s\S]*)$/i);
      if (match) {
        course = cleanText(match[1]);
        message = cleanText(match[2]);
      } else {
        message = rawHeading;
      }
    }

    const details = [];
    panel.querySelectorAll('.panel-collapse table tr, .panel-body table tr').forEach((tr) => {
      const cells = tr.querySelectorAll('th, td');
      if (cells.length >= 2) {
        const label = cleanText(cells[0].textContent);
        const value = cleanText(cells[1].textContent);
        if (label || value) {
          details.push({ label, value });
        }
      }
    });

    return { course, message, details };
  }

  function sanitizeFragmentNode(root) {
    if (!root) return;

    root.querySelectorAll('script, style, iframe, object, embed, link, meta, svg, math, base, form, template').forEach((el) => el.remove());

    const DANGEROUS_URI_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster']);
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if (DANGEROUS_URI_ATTRS.has(name)) {
          const normalized = String(attr.value || '').replace(/[\x00-\x20\x7f]+/g, '');
          if (/^(javascript|vbscript|data):/i.test(normalized)) {
            el.removeAttribute(attr.name);
          }
        }
      }

      // Strip legacy inline backgrounds/colors/borders/margins that break light/dark consistency
      if (el.hasAttribute('style')) {
        el.style.removeProperty('background');
        el.style.removeProperty('background-color');
        el.style.removeProperty('color');
        el.style.removeProperty('border');
        el.style.removeProperty('border-color');
        el.style.removeProperty('margin-left');
        el.style.removeProperty('margin-top');
        el.style.removeProperty('margin-bottom');
        if (!el.getAttribute('style')?.trim()) {
          el.removeAttribute('style');
        }
      }
    }
  }

  function wireExpandToggles(container) {
    const toggles = container.querySelectorAll('.expand');
    toggles.forEach((toggle) => {
      toggle.style.cursor = 'pointer';
      toggle.addEventListener('click', (e) => {
        // Avoid double toggling if Bootstrap collapse already handles this trigger
        if (toggle.hasAttribute('data-bs-toggle') || toggle.hasAttribute('data-toggle')) {
          return;
        }
        e.preventDefault();
        const indicator = toggle.firstElementChild;
        if (indicator) {
          const txt = indicator.textContent.trim();
          if (txt === '+') indicator.textContent = '-';
          else if (txt === '-') indicator.textContent = '+';
        }
        const next = toggle.nextElementSibling;
        if (next) {
          const isHidden = next.style.display === 'none' || getComputedStyle(next).display === 'none';
          next.style.display = isHidden ? '' : 'none';
        }
      });
    });
  }

  const HomeMessages = {
    isFetching: false,

    init() {
      this.syncDashboardEmptyStates();

      const courseData = document.getElementById('course-data');
      if (!courseData) {
        this.destroy();
        return;
      }

      const existing = document.getElementById(CARD_ID);
      if (existing) {
        // Keep card directly anchored right below #course-data if VTOP re-arranged siblings
        if (courseData.nextElementSibling !== existing && courseData.parentElement) {
          courseData.insertAdjacentElement('afterend', existing);
        }
        return;
      }

      const card = this.createCard();
      courseData.insertAdjacentElement('afterend', card);
      this.load(false);
    },

    syncDashboardEmptyStates() {
      const proctorEl = document.getElementById('proctor-message');
      if (proctorEl) {
        const hasProctorMsg = Array.from(proctorEl.childNodes).some((node) => {
          if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.trim().length > 0;
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          if (node.classList.contains('vtop-dashboard-empty')) return false;
          if (node.textContent.trim().length > 0) return true;
          return Boolean(node.querySelector('img, table, a, button'));
        });
        this.toggleEmptyState(
          proctorEl,
          !hasProctorMsg,
          'No message from proctor'
        );
      }

      const daEl = document.getElementById('digital-assignments');
      if (daEl) {
        const tbody = daEl.querySelector('table tbody');
        const hasDaRows = tbody
          ? Array.from(tbody.querySelectorAll('tr')).some((tr) => tr.textContent.trim().length > 0)
          : Array.from(daEl.childNodes).some((node) => {
              if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.trim().length > 0;
              if (node.nodeType !== Node.ELEMENT_NODE) return false;
              if (node.classList.contains('vtop-dashboard-empty')) return false;
              return node.textContent.trim().length > 0;
            });
        this.toggleEmptyState(
          daEl,
          !hasDaRows,
          'No DA Pending'
        );
      }
    },

    toggleEmptyState(container, isEmpty, title, note) {
      window.VTOP_PLUS?.UI?.toggleEmptyState?.(container, isEmpty, title, note);
    },

    destroy() {
      const existing = document.getElementById(CARD_ID);
      if (existing) existing.remove();
    },

    createCard() {
      const UI = window.VTOP_PLUS?.UI;
      const card = UI
        ? UI.createHomeCard({
            id: CARD_ID,
            className: 'card border-0 mb-3 vtop-msg-card',
            headerClass: 'card-header d-flex flex-column flex-md-row primaryBorderTop vtop-msg-header',
            headerHtml: `
              <span class="fs-6 fontcolor3 flex-fill text-nowrap fw-bold vtop-msg-title">
                Class messages sent by faculty
              </span>
              <div class="vtop-msg-header-actions">
                <span class="vtop-msg-badge vtop-msg-badge-muted">Checking...</span>
                <button type="button" class="vtop-msg-icon-btn vtop-msg-refresh-btn" title="Refresh Class Messages" aria-label="Refresh Class Messages">
                  ${UI.icon('refresh', 14)}
                </button>
                <button type="button" class="vtop-msg-icon-btn vtop-msg-open-btn" title="Open Class Messages Page" aria-label="Open Class Messages Page">
                  ${UI.icon('external-link', 14)}
                </button>
              </div>
            `,
            bodyClass: 'card-body small vtop-msg-body',
            bodyHtml: '<div class="vtop-msg-state vtop-msg-loading">Loading class messages...</div>'
          })
        : document.createElement('div');

      card.querySelector('.vtop-msg-refresh-btn')?.addEventListener('click', () => {
        this.load(true);
      });

      card.querySelector('.vtop-msg-open-btn')?.addEventListener('click', () => {
        this.openFullPage();
      });

      return card;
    },

    openFullPage() {
      const crawler = window.VTOP_PLUS?.Crawler;
      if (crawler) {
        const navigated = crawler.navigate({
          dataUrl: CLASS_MSG_DATA_URL,
          title: 'Class Messages'
        });
        if (navigated) return;
      }

      const menuLink = document.querySelector(`a[data-url="${CLASS_MSG_DATA_URL}"], [data-url*="${CLASS_MSG_DATA_URL}"]`);
      if (menuLink) {
        menuLink.click();
      }
    },

    async load(forceRefresh = false) {
      if (this.isFetching) return;

      const card = document.getElementById(CARD_ID);
      if (!card) return;

      if (!forceRefresh) {
        const cached = this.readCache();
        if (cached) {
          this.renderParsed(card, cached);
          return;
        }
      }

      this.isFetching = true;
      const refreshBtn = card.querySelector('.vtop-msg-refresh-btn');
      const badge = card.querySelector('.vtop-msg-badge');
      if (refreshBtn) refreshBtn.classList.add('vtop-msg-spinning');
      if (badge) {
        badge.className = 'vtop-msg-badge vtop-msg-badge-muted';
        badge.textContent = 'Refreshing...';
      }

      try {
        const html = await this.fetchMessagesHtml();
        const parsed = this.parseMessagesHtml(html);

        if (parsed.status === 'ok') {
          this.writeCache(parsed);
        }
        this.renderParsed(card, parsed);
      } catch (err) {
        console.warn('[VTOP++] Home Class Messages fetch error:', err);
        this.renderParsed(card, {
          status: 'error',
          message: 'Could not load class messages automatically.'
        });
      } finally {
        this.isFetching = false;
        const latestRefreshBtn = document.getElementById(CARD_ID)?.querySelector('.vtop-msg-refresh-btn');
        if (latestRefreshBtn) latestRefreshBtn.classList.remove('vtop-msg-spinning');
      }
    },

    readCache() {
      const entry = window.VTOP_PLUS?.Storage?.getWebCache(CACHE_KEY, {
        area: 'session',
        ttlMs: CACHE_TTL_MS,
        validate: (p) => Boolean(p.data)
      });
      return entry ? entry.data : null;
    },

    writeCache(data) {
      window.VTOP_PLUS?.Storage?.setWebCache(CACHE_KEY, { data }, { area: 'session' });
    },

    async fetchMessagesHtml() {
      const VtopApi = window.VTOP_PLUS?.VtopApi;

      const attempt = async (includeVerifyMenu) => {
        const extra = { nocache: `@(${new Date().toUTCString()})` };
        if (includeVerifyMenu) extra.verifyMenu = 'true';
        const res = await VtopApi.postHtml(CLASS_MSG_DATA_URL, extra);
        if (res.rateLimited) throw new Error('HTTP 429');
        if (!res.ok) throw new Error(`HTTP ${res.status || 0}`);
        return res.html;
      };

      const html = await attempt(true);
      if (
        /view\s+class\s+messages|no\s+messages\s+sent\s+by\s+faculty|class\s+message/i.test(html) ||
        /id="vtopLoginForm"|id="loginForm"|Login\s*-\s*VTOP/i.test(html)
      ) {
        return html;
      }

      // Fallback once without verifyMenu in case this endpoint rejects it
      return attempt(false);
    },

    parseMessagesHtml(html) {
      if (!html || /id="vtopLoginForm"|id="loginForm"|Login\s*-\s*VTOP/i.test(html)) {
        return { status: 'error', message: 'Session expired. Please reload VTOP.' };
      }

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const boxBody = doc.querySelector('.box-info .box-body, .box .box-body') || doc.body;
      if (!boxBody) {
        return { status: 'error', message: 'Class messages view unavailable.' };
      }

      // Check explicit empty-state wording from VTOP
      const rawText = (boxBody.textContent || '').replace(/\s+/g, ' ').trim();
      if (/no\s+messages\s+sent\s+by\s+faculty/i.test(rawText)) {
        return {
          status: 'ok',
          empty: true,
          count: 0,
          note: 'Messages expire automatically after their expiry date.'
        };
      }

      const clone = boxBody.cloneNode(true);
      sanitizeFragmentNode(clone);

      // Extract & remove the bright green/red "Note :" heading so we render a clean muted note
      let note = '';
      clone.querySelectorAll('h4, h5, p').forEach((el) => {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^note\s*:/i.test(txt) && txt.toLowerCase().includes('expired')) {
          note = txt.replace(/^note\s*:\s*/i, '').trim();
          el.remove();
        }
      });

      const panels = Array.from(clone.querySelectorAll('.panel'));
      if (panels.length > 0) {
        const items = panels
          .map(parsePanelMessage)
          .filter((item) => item.course || item.message || item.details.length > 0);
        if (items.length === 0) {
          return {
            status: 'ok',
            empty: true,
            count: 0,
            note: note || 'Messages expire automatically after their expiry date.'
          };
        }
        return {
          status: 'ok',
          empty: false,
          count: items.length,
          note: note || 'Messages expire automatically after their expiry date.',
          items
        };
      }

      // Normalize any fallback tables inside .box-body to match #course-data styling
      const tables = clone.querySelectorAll('table');
      tables.forEach((tbl) => {
        tbl.classList.add('table', 'table-sm', 'table-hover', 'table-borderless', 'vtop-msg-table');
      });

      const contentText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (!contentText) {
        return {
          status: 'ok',
          empty: true,
          count: 0,
          note: note || 'Messages expire automatically after their expiry date.'
        };
      }

      // Estimate message count from collapsible blocks or table rows
      let count = 0;
      const blocks = clone.querySelectorAll('.expand, .card, .alert');
      if (blocks.length > 0) {
        count = blocks.length;
      } else {
        const bodyRows = clone.querySelectorAll('table tbody tr');
        count = bodyRows.length > 0 ? bodyRows.length : 1;
      }

      return {
        status: 'ok',
        empty: false,
        count,
        note: note || 'Messages expire automatically after their expiry date.',
        bodyHtml: clone.innerHTML
      };
    },

    renderParsed(card, parsed) {
      const badge = card.querySelector('.vtop-msg-badge');
      const body = card.querySelector('.vtop-msg-body');
      if (!body) return;

      if (parsed.status === 'error') {
        if (badge) {
          badge.className = 'vtop-msg-badge vtop-msg-badge-warn';
          badge.textContent = 'Unavailable';
        }
        body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'vtop-msg-state vtop-msg-error-state';
        const text = document.createElement('span');
        text.textContent = parsed.message || 'Could not load class messages.';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm vtop-msg-fallback-btn';
        btn.textContent = 'Open Class Messages';
        btn.addEventListener('click', () => this.openFullPage());
        wrap.append(text, btn);
        body.appendChild(wrap);
        return;
      }

      if (parsed.empty) {
        if (badge) {
          badge.className = 'vtop-msg-badge vtop-msg-badge-muted';
          badge.textContent = '0 Messages';
        }
        body.innerHTML = window.VTOP_PLUS?.UI?.emptyState('No messages sent by faculty') || '';
        return;
      }

      if (badge) {
        badge.className = 'vtop-msg-badge vtop-msg-badge-active';
        badge.textContent = `${parsed.count} ${parsed.count === 1 ? 'Message' : 'Messages'}`;
      }

      body.innerHTML = '';

      if (Array.isArray(parsed.items) && parsed.items.length > 0) {
        const listEl = document.createElement('div');
        listEl.className = 'vtop-msg-list';

        for (const item of parsed.items) {
          const row = document.createElement('div');
          row.className = 'vtop-msg-item';

          const details = Array.isArray(item.details) ? item.details : [];
          const postedEntry = details.find((d) => /posted/i.test(d.label));
          const expiryEntry = details.find((d) => /expir/i.test(d.label));
          const dateText = postedEntry?.value || expiryEntry?.value || '';

          const courseMatch = (item.course || '').match(/^([A-Z]{2,5}\d{3,4}[A-Z]?)\s*-\s*(.+)$/);
          const courseHtml = courseMatch
            ? `<span class="vtop-msg-course-code">${escapeHtml(courseMatch[1])}</span><span class="vtop-msg-course-sep">-</span><span class="vtop-msg-course-name">${escapeHtml(courseMatch[2])}</span>`
            : `<span class="vtop-msg-course-name">${escapeHtml(item.course || 'Class Message')}</span>`;

          const trigger = document.createElement('button');
          trigger.type = 'button';
          trigger.className = 'vtop-msg-item-trigger';
          trigger.setAttribute('aria-expanded', 'false');
          trigger.innerHTML = `
            <div class="vtop-msg-item-main">
              <div class="vtop-msg-item-top">
                <div class="vtop-msg-course">${courseHtml}</div>
                <div class="vtop-msg-item-right">
                  ${dateText ? `<span class="vtop-msg-date">${escapeHtml(dateText)}</span>` : ''}
                  ${
                    details.length > 0
                      ? `<span class="vtop-msg-chevron" aria-hidden="true">
                          ${window.VTOP_PLUS?.UI?.icon('chevron-down', 14) || ''}
                        </span>`
                      : ''
                  }
                </div>
              </div>
              ${item.message ? `<div class="vtop-msg-text">${escapeHtml(item.message)}</div>` : ''}
            </div>
          `;

          row.appendChild(trigger);

          if (details.length > 0) {
            const detailsEl = document.createElement('div');
            detailsEl.className = 'vtop-msg-details';
            detailsEl.hidden = true;

            const grid = document.createElement('div');
            grid.className = 'vtop-msg-meta-grid';
            for (const d of details) {
              const cell = document.createElement('div');
              cell.className = 'vtop-msg-meta-row';
              cell.innerHTML = `
                <span class="vtop-msg-meta-label">${escapeHtml(d.label)}</span>
                <span class="vtop-msg-meta-val">${escapeHtml(d.value)}</span>
              `;
              grid.appendChild(cell);
            }
            detailsEl.appendChild(grid);
            row.appendChild(detailsEl);

            trigger.addEventListener('click', () => {
              const expanded = trigger.getAttribute('aria-expanded') === 'true';
              trigger.setAttribute('aria-expanded', expanded ? 'false' : 'true');
              detailsEl.hidden = expanded;
              row.classList.toggle('is-expanded', !expanded);
            });
          }

          listEl.appendChild(row);
        }

        body.appendChild(listEl);
      } else {
        const contentWrap = document.createElement('div');
        contentWrap.className = 'vtop-msg-content';
        const sanitizedDoc = new DOMParser().parseFromString(parsed.bodyHtml || '', 'text/html');
        sanitizeFragmentNode(sanitizedDoc.body);
        contentWrap.innerHTML = sanitizedDoc.body ? sanitizedDoc.body.innerHTML : '';
        wireExpandToggles(contentWrap);
        body.appendChild(contentWrap);
      }
    }
  };

  window.VTOP_PLUS.HomeMessages = HomeMessages;
})();
