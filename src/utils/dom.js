/**
 * VTOP++ - DOM Utilities
 * High-performance helpers for DOM manipulation, observation, and table parsing.
 */

(function () {
  window.VTOP_PLUS = window.VTOP_PLUS || {};

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
     * Auto-expands DataTables page length selector to 100 / All if available
     */
    expandDataTableLength() {
      const lengthSelect = document.querySelector('select[name="materialTable_length"], select[name$="_length"]');
      if (!lengthSelect || lengthSelect.value === '100' || lengthSelect.value === '-1') return false;

      let targetOption =
        lengthSelect.querySelector('option[value="100"]') ||
        lengthSelect.querySelector('option[value="-1"]');

      if (!targetOption) {
        let maxVal = 0;
        for (const opt of lengthSelect.options) {
          const val = parseInt(opt.value, 10);
          if (val > maxVal) {
            maxVal = val;
            targetOption = opt;
          }
        }
      }

      if (targetOption && lengthSelect.value !== targetOption.value) {
        lengthSelect.value = targetOption.value;
        lengthSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
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
    }
  };

  window.VTOP_PLUS.DOM = DOM;
})();
