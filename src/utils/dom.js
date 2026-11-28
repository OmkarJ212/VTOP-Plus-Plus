/**
 * VTOP++ - DOM Utilities
 * High-performance helpers for DOM manipulation, observation, and table parsing.
 */

(function () {
  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const MONTH_INDEX = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11
  };

  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function toIsoDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  const DOM = {
    /**
     * Safely triggers native click on an element with 0ms dispatch latency
     */
    simulateNativeClick(element) {
      if (!element) return false;

      // Direct native click dispatch (0ms latency, zero scroll delay, preserves CSRF tokens)
      if (typeof element.click === 'function') {
        try {
          element.click();
          return true;
        } catch (e) {
          console.warn('[VTOP++] element.click() fallback:', e);
        }
      }

      // Synthetic click event fallback
      const evt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      element.dispatchEvent(evt);
      return true;
    },

    /**
     * Check if currently on a specific VTOP view by exact DOM IDs, URL, or table presence
     */
    detectPageType() {
      const path = window.location.pathname.toLowerCase();

      if (
        path.includes('/login') ||
        document.querySelector('#vtopLoginForm, input#username, input#captchaStr, #loginForm, #vtopLogin, #authLoginBtn, input[name="username"], input[type="password"]')
      ) {
        return 'LOGIN';
      }

      if (
        document.querySelector('#materialTable, select#courseId, button#downloadmat[data-fileid], button[data-fileid], .download-btn[data-fileid]') ||
        path.includes('coursematerial')
      ) {
        return 'COURSE_PAGE';
      }

      if (
        document.querySelector('#AttendanceDetailDataTable, #StudentCourseDetailDataTable, #attendanceDetail, table[id*="attendance" i]') ||
        path.includes('attendance')
      ) {
        return 'ATTENDANCE';
      }

      if (
        document.querySelector('#fixedTableContainer table.customTable-level1, #studentMarks, #marksView, table[id*="marks" i], .vtop-fat-inline-tfoot') ||
        path.includes('marks')
      ) {
        return 'MARKS';
      }

      // Check exact DA customTable headers inside #fixedTableContainer before broad selectors
      const customTables = document.querySelectorAll('#fixedTableContainer table.customTable');
      for (const tbl of customTables) {
        const firstRowText = (tbl.querySelector('tr')?.textContent || '').toLowerCase();
        if (
          (firstRowText.includes('due date') && firstRowText.includes('document details')) ||
          (firstRowText.includes('class nbr') && firstRowText.includes('dashboard'))
        ) {
          return 'DIGITAL_ASSIGNMENT';
        }
      }

      if (
        document.querySelector(
          '#digitalAssignment, #daUpload, #studDaUpload, form[action*="DigitalAssignment"], button[name="downloadQuestion"], button[name="downloadStudentDA"], button .bi-folder-symlink-fill, [onclick*="myFunction"], [onclick*="processDigitalAssignment"]'
        ) ||
        path.includes('assignment')
      ) {
        return 'DIGITAL_ASSIGNMENT';
      }

      return 'GENERAL';
    },

    getBasePath() {
      return window.location.pathname.split('/')[1] || 'vtop';
    },

    getAuthId() {
      const fromDom =
        document.getElementById('authorizedIDX')?.value ||
        document.getElementById('authorizedID')?.value ||
        document.getElementById('authorizedID2')?.value ||
        document.querySelector('input[name="authorizedID"], input[name*="authId" i], input[name*="regNo" i]')?.value;
      if (fromDom) return fromDom.trim().toUpperCase();

      const userImg = document.querySelector('img[src*="/users/image/?id="]');
      if (userImg) {
        const idMatch = userImg.src.match(/id=([a-zA-Z0-9]+)/);
        if (idMatch && idMatch[1]) return idMatch[1].toUpperCase();
      }

      const bodyText = document.body?.textContent || '';
      const regMatch = bodyText.match(/\b(2[0-9][A-Z]{3}[0-9]{4,5})\b/i);
      if (regMatch) return regMatch[1].toUpperCase();

      return '';
    },

    getCsrfToken() {
      const csrfInputs = document.querySelectorAll('input[name="_csrf"], input[id="_csrf"], input[name*="csrf" i], input[id*="csrf" i]');
      for (const input of csrfInputs) {
        if (input.value && input.value.trim().length > 5) {
          return input.value.trim();
        }
      }

      const csrfMeta = document.querySelector('meta[name="_csrf"], meta[name*="csrf" i]');
      if (csrfMeta && csrfMeta.content && csrfMeta.content.trim().length > 5) {
        return csrfMeta.content.trim();
      }

      try {
        const match = document.cookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|_csrf|CSRF-TOKEN)=([^;]+)/i);
        if (match && match[1]) return decodeURIComponent(match[1]);
      } catch (_) {}

      return '';
    },

    /**
     * Resets a <select> back to its default "-- Choose --" option without firing change,
     * preserving the previously selected value in dataset.vtopLastSem.
     */
    resetSelectToDefault(selectEl) {
      if (!selectEl || !selectEl.isConnected) return false;
      const curVal = (selectEl.value || '').trim();
      if (!curVal) return false;

      const selectedOpt = selectEl.options?.[selectEl.selectedIndex];
      selectEl.dataset.vtopLastSem = curVal;
      selectEl.dataset.vtopLastSemLabel = (selectedOpt?.textContent || '').replace(/\s+/g, ' ').trim();

      const emptyOpt = Array.from(selectEl.options || []).find((o) => o.value === '');
      if (emptyOpt) {
        selectEl.value = '';
        selectEl.selectedIndex = emptyOpt.index;
        return true;
      }
      return false;
    },

    /**
     * Restores VTOP's #popup element back to #page_outline (or body) if it is
     * trapped inside a .blockUI container that is about to be removed.
     */
    rescueBlockUIPopup() {
      const restoreTarget = document.getElementById('page_outline') || document.body;
      if (!restoreTarget) return;

      document.querySelectorAll('.blockUI #popup, .blockOverlay #popup').forEach((popup) => {
        popup.classList.add('noshow');
        popup.style.display = 'none';
        restoreTarget.appendChild(popup);
      });
    },

    /**
     * Waits until VTOP's jQuery BlockUI overlay finishes its 400ms fadeOut and
     * restores #popup back to #page_outline before triggering another BlockUI call.
     */
    waitForBlockUIClear(timeoutMs = 2500) {
      if (!document.querySelector('.blockUI, .blockOverlay')) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const poll = () => {
          if (!document.querySelector('.blockUI, .blockOverlay')) {
            setTimeout(resolve, 40);
            return;
          }
          if (Date.now() >= deadline) {
            resolve();
            return;
          }
          setTimeout(poll, 40);
        };
        setTimeout(poll, 40);
      });
    },

    escapeHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    cleanText(input) {
      const raw = typeof input === 'string' ? input : input?.textContent || '';
      return raw.replace(/\s+/g, ' ').trim();
    },

    MONTH_SHORT,

    toIsoDate,

    /**
     * Current wall-clock date/time in Asia/Kolkata (IST).
     */
    getIstNowParts(dayOrder = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
      const jsDayToKey = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const now = new Date();
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).formatToParts(now);
        const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
        const wk = String(map.weekday || '').toUpperCase().slice(0, 3);
        const dayKey = dayOrder.includes(wk) ? wk : jsDayToKey[now.getDay()];
        const hh = parseInt(map.hour, 10) % 24;
        const mm = parseInt(map.minute, 10);
        const dateKey = map.year && map.month && map.day ? `${map.year}-${map.month}-${map.day}` : toIsoDate(now);
        if (!isNaN(hh) && !isNaN(mm)) {
          return { now, dayKey, dateKey, mins: hh * 60 + mm };
        }
      } catch (_) {}
      return {
        now,
        dayKey: jsDayToKey[now.getDay()],
        dateKey: toIsoDate(now),
        mins: now.getHours() * 60 + now.getMinutes()
      };
    },

    /**
     * Parses DD-MMM-YYYY, DD MMM YYYY, YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, or DD.MM.YYYY
     * with optional HH:MM(:SS) AM/PM into a local Date (default 23:59:59).
     */
    parseIndianDate(str) {
      if (!str) return null;
      const raw = String(str).trim();

      let hours = 23;
      let minutes = 59;
      let seconds = 59;
      const timeMatch = raw.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\b/);
      if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const s = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const meridiem = timeMatch[4] ? timeMatch[4].toUpperCase() : null;

        if (meridiem === 'PM' && h < 12) h += 12;
        if (meridiem === 'AM' && h === 12) h = 0;
        hours = h;
        minutes = m;
        seconds = s;
      }

      const numMatch = raw.match(/\b(\d{1,4})[-\/.](\d{1,2})[-\/.](\d{1,4})\b/);
      if (numMatch) {
        let d;
        let m;
        let y;
        if (numMatch[1].length === 4) {
          y = parseInt(numMatch[1], 10);
          m = parseInt(numMatch[2], 10) - 1;
          d = parseInt(numMatch[3], 10);
        } else {
          d = parseInt(numMatch[1], 10);
          m = parseInt(numMatch[2], 10) - 1;
          y = parseInt(numMatch[3], 10);
          if (y < 100) y += 2000;
        }
        const dt = new Date(y, m, d, hours, minutes, seconds);
        if (!isNaN(dt.getTime()) && dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d) {
          return dt;
        }
        return null;
      }

      const alphaMatch = raw.match(/\b(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})\b/);
      if (alphaMatch) {
        const d = parseInt(alphaMatch[1], 10);
        const m = MONTH_INDEX[alphaMatch[2].substring(0, 3).toLowerCase()];
        let y = parseInt(alphaMatch[3], 10);
        if (y < 100) y += 2000;
        if (m !== undefined) {
          const dt = new Date(y, m, d, hours, minutes, seconds);
          if (!isNaN(dt.getTime()) && dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d) {
            return dt;
          }
        }
      }

      return null;
    },

    /**
     * Parses DD-MMM-YYYY / DD-MM-YYYY / YYYY-MM-DD to canonical YYYY-MM-DD (UTC validated).
     */
    parseExamDateKey(raw) {
      if (!raw) return '';
      const str = String(raw).trim();
      const alpha = str.match(/\b(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})\b/);
      if (alpha) {
        const day = parseInt(alpha[1], 10);
        const mon = MONTH_INDEX[alpha[2].slice(0, 3).toLowerCase()];
        let yr = parseInt(alpha[3], 10);
        if (yr < 100) yr += 2000;
        if (mon !== undefined && day >= 1 && day <= 31) {
          const dt = new Date(Date.UTC(yr, mon, day));
          if (dt.getUTCFullYear() === yr && dt.getUTCMonth() === mon && dt.getUTCDate() === day) {
            return `${yr}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          }
        }
      }
      const num = str.match(/\b(\d{1,4})[-\/\.](\d{1,2})[-\/\.](\d{1,4})\b/);
      if (num) {
        let yr;
        let mon;
        let day;
        if (num[1].length === 4) {
          yr = parseInt(num[1], 10);
          mon = parseInt(num[2], 10) - 1;
          day = parseInt(num[3], 10);
        } else {
          day = parseInt(num[1], 10);
          mon = parseInt(num[2], 10) - 1;
          yr = parseInt(num[3], 10);
          if (yr < 100) yr += 2000;
        }
        const dt = new Date(Date.UTC(yr, mon, day));
        if (dt.getUTCFullYear() === yr && dt.getUTCMonth() === mon && dt.getUTCDate() === day) {
          return `${yr}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
      return '';
    },

    /**
     * Triggers a browser file download for a Blob or string content.
     */
    triggerBlobDownload(contentOrBlob, filename, mimeType = 'application/octet-stream') {
      const blob =
        typeof Blob !== 'undefined' && contentOrBlob instanceof Blob
          ? contentOrBlob
          : new Blob([contentOrBlob], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 10000);
    }
  };

  window.VTOP_PLUS.DOM = DOM;
})();
