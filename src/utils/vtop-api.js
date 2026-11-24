/**
 * VTOP++ - Shared VTOP API, Serialized Request Queue & Active Semester Resolver
 * Prevents simultaneous burst requests to VTOP, enforces cross-tab HTTP 429 backoff,
 * and shares both activeSemesterSubId (from StudentDA) and registeredSemesters
 * (from StudentTimeTable / StudentAttendance) across modules.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const ACTIVE_SEM_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const REG_SEMS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const RATE_LIMIT_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes
  const RATE_LIMIT_STORAGE_KEY = 'vtop_plus_rate_limit_until';

  let queueTail = Promise.resolve();
  let lastRequestEndedAt = 0;
  let memoryActiveSem = null;
  let memoryRegSems = null;
  let memoryRateLimitUntil = 0;
  let pendingActiveSemPromise = null;

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (items) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        resolve(items || {});
      });
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set(obj, () => resolve());
    });
  }

  function isLoginScreen() {
    const path = window.location.pathname.toLowerCase();
    return (
      path.includes('/login') ||
      Boolean(
        document.querySelector(
          '#vtopLoginForm, input#username, input#captchaStr, #loginForm, #vtopLogin, #authLoginBtn, input[name="username"], input[type="password"]'
        )
      )
    );
  }

  function isSessionExpiredHtml(html) {
    if (!html || typeof html !== 'string') return true;
    return /id="vtopLoginForm"|id="loginForm"|Login\s*-\s*VTOP/i.test(html);
  }

  function isRateLimited() {
    if (memoryRateLimitUntil && Date.now() < memoryRateLimitUntil) return true;
    try {
      const raw = sessionStorage.getItem(RATE_LIMIT_STORAGE_KEY);
      const ts = raw ? parseInt(raw, 10) : 0;
      if (ts && Date.now() < ts) {
        memoryRateLimitUntil = ts;
        return true;
      }
    } catch (_) {}
    return false;
  }

  async function isRateLimitedAsync() {
    if (isRateLimited()) return true;
    const stored = await storageGet([RATE_LIMIT_STORAGE_KEY]);
    const ts = Number(stored?.[RATE_LIMIT_STORAGE_KEY]) || 0;
    if (ts > Date.now()) {
      memoryRateLimitUntil = ts;
      try {
        sessionStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(ts));
      } catch (_) {}
      return true;
    }
    return false;
  }

  function markRateLimited(ms = RATE_LIMIT_BACKOFF_MS) {
    const until = Date.now() + ms;
    memoryRateLimitUntil = until;
    try {
      sessionStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(until));
    } catch (_) {}
    storageSet({ [RATE_LIMIT_STORAGE_KEY]: until });
  }

  function getHomeSemesterBadgeText() {
    const courseData = document.getElementById('course-data');
    if (!courseData) return '';
    const badge =
      courseData.querySelector('.card-header .bg-warning') ||
      courseData.querySelector('.card-header span:last-child');
    const txt = (badge?.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^(FALL|WIN|SUM|TRI|INTER)/i.test(txt)) return txt;
    return '';
  }

  function normalizeSemesterBadge(badgeText) {
    if (!badgeText) return null;
    const upper = badgeText.toUpperCase();
    let season = '';
    if (upper.includes('FALL')) season = 'fall';
    else if (upper.includes('WIN')) season = 'winter';
    else if (upper.includes('SUM')) season = 'summer';
    else if (upper.includes('INTER')) season = 'inter';
    const yearMatch = upper.match(/(\d{4}-\d{2})/);
    return season && yearMatch ? { season, year: yearMatch[1] } : null;
  }

  function matchOptionByBadge(options, badgeText) {
    const norm = normalizeSemesterBadge(badgeText);
    if (!norm || !Array.isArray(options)) return null;
    return (
      options.find((opt) => {
        const label = (opt.label || '').toLowerCase();
        return label.includes(norm.season) && label.includes(norm.year);
      }) || null
    );
  }

  function extractSelectOptions(doc, selectId = 'semesterSubId') {
    const sel = doc?.getElementById ? doc.getElementById(selectId) : doc?.querySelector?.(`#${selectId}`);
    if (!sel) return [];
    return Array.from(sel.querySelectorAll('option'))
      .map((opt) => ({
        value: (opt.value || '').trim(),
        label: (opt.textContent || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((o) => o.value.length > 0);
  }

  const VtopApi = {
    storageGet,
    storageSet,
    isLoginScreen,
    isSessionExpiredHtml,
    isRateLimited,
    isRateLimitedAsync,
    markRateLimited,
    getHomeSemesterBadgeText,
    matchOptionByBadge,
    extractSelectOptions,

    isAuthenticated() {
      const DOM = window.VTOP_PLUS?.DOM;
      const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
      return Boolean(authId) && !isLoginScreen();
    },

    /**
     * Serializes background requests across modules with polite spacing + jitter
     * so VTOP never receives simultaneous multi-module bursts.
     */
    enqueue(taskFn, minGapMs = 450) {
      const run = async () => {
        const waitMs = Math.max(0, lastRequestEndedAt + minGapMs - Date.now());
        if (waitMs > 0) {
          const jitter = Math.floor(Math.random() * 140);
          await new Promise((r) => setTimeout(r, waitMs + jitter));
        }
        try {
          return await taskFn();
        } finally {
          lastRequestEndedAt = Date.now();
        }
      };

      const next = queueTail.then(run, run);
      queueTail = next.catch(() => {});
      return next;
    },

    async postHtml(relUrl, extraParams = {}, { queued = true, minGapMs = 450, timeoutMs = 15000 } = {}) {
      if (!this.isAuthenticated()) {
        return { ok: false, status: 0, html: '', expired: true, rateLimited: false };
      }
      if (await isRateLimitedAsync()) {
        return { ok: false, status: 429, html: '', expired: false, rateLimited: true };
      }

      const execute = async () => {
        if (await isRateLimitedAsync()) {
          return { ok: false, status: 429, html: '', expired: false, rateLimited: true };
        }
        const DOM = window.VTOP_PLUS?.DOM;
        const basePath = DOM?.getBasePath ? DOM.getBasePath() : window.location.pathname.split('/')[1] || 'vtop';
        const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
        const csrf = DOM?.getCsrfToken ? DOM.getCsrfToken() : '';
        const cleanRel = String(relUrl || '').replace(/^\/+/, '');
        const url = `${window.location.origin}/${basePath}/${cleanRel}`;

        const body = new URLSearchParams();
        if (authId && extraParams.authorizedID === undefined) body.append('authorizedID', authId);
        if (csrf && extraParams._csrf === undefined) body.append('_csrf', csrf);
        for (const [k, v] of Object.entries(extraParams)) {
          if (v !== undefined && v !== null && v !== '') {
            body.append(k, String(v));
          }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: body.toString(),
            signal: controller.signal
          });

          if (res.status === 429) {
            markRateLimited();
            return { ok: false, status: 429, html: '', expired: false, rateLimited: true };
          }
          if (!res.ok) {
            return { ok: false, status: res.status, html: '', expired: false, rateLimited: false };
          }

          const html = await res.text();
          if (isSessionExpiredHtml(html)) {
            return { ok: false, status: res.status, html: '', expired: true, rateLimited: false };
          }

          return { ok: true, status: res.status, html, expired: false, rateLimited: false };
        } catch (err) {
          return { ok: false, status: 0, html: '', expired: false, rateLimited: false, error: err };
        } finally {
          clearTimeout(timer);
        }
      };

      return queued ? this.enqueue(execute, minGapMs) : execute();
    },

    async saveActiveSemesterId(semesterSubId, label = '') {
      if (!semesterSubId) return;
      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      const badgeText = getHomeSemesterBadgeText();
      const record = {
        authId,
        semesterSubId,
        label,
        badgeText,
        fetchedAt: Date.now()
      };
      memoryActiveSem = record;
      await storageSet({ [`vtop_active_sem_v1_${authId}`]: record });
    },

    /**
     * Resolves the authoritative current active semesterSubId using StudentDA's
     * first #semesterSubId option (which never lists upcoming next-semester shells).
     */
    async resolveActiveSemesterId({ forceRefresh = false } = {}) {
      if (!this.isAuthenticated()) return null;

      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      const currentBadge = getHomeSemesterBadgeText();

      const isRecordValid = (rec) => {
        if (!rec || !rec.semesterSubId || rec.authId !== authId) return false;
        if (Date.now() - (rec.fetchedAt || 0) > ACTIVE_SEM_TTL_MS) return false;
        if (currentBadge && rec.badgeText && rec.badgeText !== currentBadge) return false;
        return true;
      };

      if (!forceRefresh && isRecordValid(memoryActiveSem)) {
        return memoryActiveSem;
      }

      if (!forceRefresh) {
        const cacheKey = `vtop_active_sem_v1_${authId}`;
        const stored = await storageGet([cacheKey]);
        const rec = stored?.[cacheKey];
        if (isRecordValid(rec)) {
          memoryActiveSem = rec;
          return rec;
        }
      }

      if (pendingActiveSemPromise) return pendingActiveSemPromise;

      pendingActiveSemPromise = (async () => {
        try {
          const res = await this.postHtml('examinations/StudentDA', {
            verifyMenu: 'true',
            nocache: `@(${new Date().toUTCString()})`
          });
          if (!res.ok || !res.html) return null;

          const doc = new DOMParser().parseFromString(res.html, 'text/html');
          const options = extractSelectOptions(doc, 'semesterSubId');
          const first = options[0];
          if (!first) return null;

          await this.saveActiveSemesterId(first.value, first.label);
          return memoryActiveSem;
        } finally {
          pendingActiveSemPromise = null;
        }
      })();

      return pendingActiveSemPromise;
    },

    /**
     * Stores the ordered list of *registered* semesters (from StudentTimeTable or StudentAttendance)
     * so MarksNotifier can immediately pick current + previous registered semester with 0 extra probes.
     */
    async saveRegisteredSemesters(options) {
      if (!Array.isArray(options) || options.length === 0) return;
      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      const cleaned = options
        .map((o) => ({
          value: String(o.value || '').trim(),
          label: String(o.label || '').replace(/\s*-\s*VLR\s*$/i, '').trim()
        }))
        .filter((o) => o.value.length > 0);
      if (cleaned.length === 0) return;

      const record = {
        authId,
        badgeText: getHomeSemesterBadgeText(),
        options: cleaned,
        fetchedAt: Date.now()
      };
      memoryRegSems = record;
      await storageSet({ [`vtop_registered_sems_v1_${authId}`]: record });
    },

    async getRegisteredSemesters() {
      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      const currentBadge = getHomeSemesterBadgeText();

      const isValid = (rec) => {
        if (!rec || !Array.isArray(rec.options) || rec.options.length === 0 || rec.authId !== authId) {
          return false;
        }
        if (Date.now() - (rec.fetchedAt || 0) > REG_SEMS_TTL_MS) return false;
        if (currentBadge && rec.badgeText && rec.badgeText !== currentBadge) return false;
        return true;
      };

      if (isValid(memoryRegSems)) return memoryRegSems.options;

      const key = `vtop_registered_sems_v1_${authId}`;
      const stored = await storageGet([key]);
      const rec = stored?.[key];
      if (isValid(rec)) {
        memoryRegSems = rec;
        return rec.options;
      }
      return null;
    }
  };

  window.VTOP_PLUS.VtopApi = VtopApi;
})();
