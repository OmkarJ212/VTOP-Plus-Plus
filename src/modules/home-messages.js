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
  const CACHE_KEY = 'vtop_home_class_messages_v1';
  const CACHE_TTL_MS = 5 * 60 * 1000;

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

      // Strip legacy inline backgrounds/colors/huge bottom margins that break light/dark consistency
      if (el.hasAttribute('style')) {
        el.style.removeProperty('background');
        el.style.removeProperty('background-color');
        el.style.removeProperty('color');
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

    destroy() {
      const existing = document.getElementById(CARD_ID);
      if (existing) existing.remove();
    },

    createCard() {
      const card = document.createElement('div');
      card.id = CARD_ID;
      card.className = 'card border-2 mb-3 p-0 border-3 vtop-msg-card';

      card.innerHTML = `
        <div class="card-header d-flex flex-column flex-md-row primaryBorderTop vtop-msg-header">
          <span class="fs-6 fontcolor3 flex-fill text-nowrap fw-semibold vtop-msg-title">
            Class messages sent by faculty
          </span>
          <div class="vtop-msg-header-actions">
            <span class="vtop-msg-badge vtop-msg-badge-muted">Checking...</span>
            <button type="button" class="vtop-msg-icon-btn vtop-msg-refresh-btn" title="Refresh Class Messages" aria-label="Refresh Class Messages">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
            <button type="button" class="vtop-msg-icon-btn vtop-msg-open-btn" title="Open Class Messages Page" aria-label="Open Class Messages Page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="card-body small vtop-msg-body">
          <div class="vtop-msg-state vtop-msg-loading">Loading class messages...</div>
        </div>
      `;

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
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && Date.now() - parsed.timestamp < CACHE_TTL_MS && parsed.data) {
          return parsed.data;
        }
      } catch (_) {}
      return null;
    },

    writeCache(data) {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
      } catch (_) {}
    },

    async fetchMessagesHtml() {
      const DOM = window.VTOP_PLUS?.DOM;
      const basePath = DOM?.getBasePath ? DOM.getBasePath() : window.location.pathname.split('/')[1] || 'vtop';
      const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
      const csrf = DOM?.getCsrfToken ? DOM.getCsrfToken() : '';
      const url = `${window.location.origin}/${basePath}/${CLASS_MSG_DATA_URL}`;

      const attempt = async (includeVerifyMenu) => {
        const params = new URLSearchParams();
        if (includeVerifyMenu) params.append('verifyMenu', 'true');
        if (authId) params.append('authorizedID', authId);
        if (csrf) params.append('_csrf', csrf);
        params.append('nocache', `@(${new Date().toUTCString()})`);

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: params.toString()
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
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

      // Normalize any tables inside .box-body to match #course-data styling
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

      // Estimate message count from data rows or collapsible cards/headers
      let count = 0;
      const bodyRows = clone.querySelectorAll('table tbody tr');
      if (bodyRows.length > 0) {
        count = bodyRows.length;
      } else {
        const blocks = clone.querySelectorAll('.expand, .panel, .card, .alert');
        count = blocks.length > 0 ? blocks.length : 1;
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
        body.innerHTML = `
          <div class="vtop-msg-empty">
            <div class="vtop-msg-empty-title">No messages sent by faculty</div>
            <div class="vtop-msg-note">Note: ${this.escapeHtml(parsed.note || 'Messages expire automatically after their expiry date.')}</div>
          </div>
        `;
        return;
      }

      if (badge) {
        badge.className = 'vtop-msg-badge vtop-msg-badge-active';
        badge.textContent = `${parsed.count} ${parsed.count === 1 ? 'Message' : 'Messages'}`;
      }

      body.innerHTML = '';
      const contentWrap = document.createElement('div');
      contentWrap.className = 'vtop-msg-content';
      const sanitizedDoc = new DOMParser().parseFromString(parsed.bodyHtml || '', 'text/html');
      sanitizeFragmentNode(sanitizedDoc.body);
      contentWrap.innerHTML = sanitizedDoc.body ? sanitizedDoc.body.innerHTML : '';
      wireExpandToggles(contentWrap);
      body.appendChild(contentWrap);

      if (parsed.note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'vtop-msg-note vtop-msg-note-footer';
        noteEl.textContent = `Note: ${parsed.note}`;
        body.appendChild(noteEl);
      }
    },

    escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  };

  window.VTOP_PLUS.HomeMessages = HomeMessages;
})();
