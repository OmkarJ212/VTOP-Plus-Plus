/**
 * VTOP++ - Digital Assignment (DA) Tracker Module
 * Replaces bulky intrusive cards with an elegant native column in VTOP's Assignment Upload table.
 * Shows remaining days for the next assignment with dynamic color coding:
 * - Purple: Due today (0 days left)
 * - Red: 3 or less days left (or overdue)
 * - Green: More than 3 days left OR all submissions done
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  function parseIndianDate(str) {
    if (!str) return null;
    str = str.trim();

    // 1. DD-MM-YYYY, DD/MM/YYYY, or DD.MM.YYYY
    const numMatch = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (numMatch) {
      const d = parseInt(numMatch[1], 10);
      const m = parseInt(numMatch[2], 10) - 1;
      let y = parseInt(numMatch[3], 10);
      if (y < 100) y += 2000;
      const dt = new Date(y, m, d, 23, 59, 59);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // 2. DD-MMM-YYYY or DD MMM YYYY (e.g. 22-Oct-2026, 22 Oct 2026, 05-Jan-2025)
    const alphaMatch = str.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/);
    if (alphaMatch) {
      const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const d = parseInt(alphaMatch[1], 10);
      const mKey = alphaMatch[2].substring(0, 3).toLowerCase();
      const m = months[mKey];
      let y = parseInt(alphaMatch[3], 10);
      if (y < 100) y += 2000;
      if (m !== undefined) {
        const dt = new Date(y, m, d, 23, 59, 59);
        return isNaN(dt.getTime()) ? null : dt;
      }
    }

    // 3. Fallback
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  const DaTracker = {
    isScanning: false,

    init() {
      this.checkAndTrack();
    },

    /**
     * Check if currently on the Digital Assignment module
     */
    isDaPage() {
      if (this.findCourseOverviewTable()) return true;

      const bodyText = (document.body?.textContent || '').toLowerCase();
      if (bodyText.includes('assignment upload') || bodyText.includes('digital assignment')) {
        return true;
      }

      return Boolean(
        document.querySelector(
          '#daUpload, #studDaUpload, form[action*="DigitalAssignment"], button[name="downloadQuestion"], button[name="downloadStudentDA"], [onclick*="myFunction"]'
        )
      );
    },

    checkAndTrack() {
      // Permanently remove any legacy bulky DA Hub card from DOM
      const existingCard = document.getElementById('vtop-da-summary-card');
      if (existingCard) existingCard.remove();

      const table = this.findCourseOverviewTable();
      if (!table) {
        return;
      }

      this.augmentCourseOverviewTable(table);
    },

    findCourseOverviewTable() {
      const allTables = Array.from(document.querySelectorAll('table'));
      for (const table of allTables) {
        const text = (table.textContent || '').toLowerCase();
        if (
          (text.includes('class nbr') || text.includes('class number')) &&
          text.includes('course code') &&
          (text.includes('dashboard') ||
            text.includes('faculty') ||
            Boolean(table.querySelector('.bi-folder-symlink-fill, [onclick*="myFunction"]')))
        ) {
          return table;
        }
      }
      return null;
    },

    /**
     * Injects the native "Next Assignment" column directly into the Course Overview table
     */
    augmentCourseOverviewTable(table) {
      // 1. Add Header Cell
      const headerRow =
        table.querySelector('thead tr') ||
        table.querySelector('tr.tableHeader') ||
        table.querySelector('tr:has(th)') ||
        table.querySelector('tr:first-child');
      if (!headerRow) return;

      if (!headerRow.querySelector('.vtop-th-da-status')) {
        const th = document.createElement(headerRow.querySelector('th') ? 'th' : 'td');
        th.className = 'vtop-th-da-status fixedContent tableHeader';
        th.textContent = 'Next Assignment';
        th.style.cssText = 'text-align: center; vertical-align: middle; width: 15%; min-width: 135px;';
        headerRow.appendChild(th);
      }

      // 2. Add Data Cells to each course row
      const allRows = Array.from(table.querySelectorAll('tr'));
      const dataRows = allRows.filter((r) => {
        if (r.classList.contains('tableHeader') || r.closest('thead')) return false;
        if (r.querySelector('th')) return false;
        const cells = r.querySelectorAll('td');
        return cells.length >= 6;
      });

      dataRows.forEach((row) => {
        let cell = row.querySelector('.vtop-td-da-status');
        if (!cell) {
          cell = document.createElement('td');
          cell.className = 'vtop-td-da-status fixedContent tableContent';
          cell.style.cssText = 'text-align: center; vertical-align: middle; padding: 6px 10px;';
          cell.innerHTML = '<span class="vtop-da-badge vtop-da-badge-loading">Checking...</span>';
          row.appendChild(cell);
        }
      });

      // 3. Trigger background scan
      this.scanCourseDeadlines(dataRows);
    },

    getAuthId() {
      const fromDom =
        document.getElementById('authorizedID')?.value ||
        document.getElementById('authorizedIDX')?.value ||
        document.querySelector('input[name="authorizedID"], input[name*="authId" i]')?.value ||
        document.querySelector('input[name*="regNo" i]')?.value;
      if (fromDom) return fromDom.trim();

      try {
        const match = document.cookie.match(/(?:^|;\s*)(?:authorizedID|regNo)=([^;]+)/i);
        if (match) return decodeURIComponent(match[1]).trim();
      } catch (_) {}

      const profileEl = document.querySelector('.user-profile, .username, #regNo, .navbar-custom-menu');
      const profileText = profileEl?.textContent || '';
      const regMatch = profileText.match(/\b\d{2}[A-Z]{3}\d{4,5}\b/i);
      if (regMatch) return regMatch[0].toUpperCase();

      return '';
    },

    getCsrfToken() {
      const csrfInput = document.querySelector('input[name="_csrf"], input[id="_csrf"], input[name*="csrf" i]');
      if (csrfInput && csrfInput.value) return csrfInput.value;

      const csrfMeta = document.querySelector('meta[name="_csrf"]');
      if (csrfMeta && csrfMeta.content) return csrfMeta.content;

      try {
        const match = document.cookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|_csrf)=([^;]+)/i);
        if (match) return decodeURIComponent(match[1]);
      } catch (_) {}

      if (window._csrf) return window._csrf;
      return '';
    },

    async scanCourseDeadlines(dataRows) {
      const pendingRows = dataRows.filter((r) => r.querySelector('.vtop-da-badge-loading'));
      if (pendingRows.length === 0) return;

      if (this.isScanning) return;
      this.isScanning = true;

      const authId = this.getAuthId();
      const csrf = this.getCsrfToken();

      const processRow = async (row) => {
        if (!document.body.contains(row)) return;

        const cell = row.querySelector('.vtop-td-da-status');
        if (!cell) return;

        // If already resolved to a final badge, don't re-fetch
        if (cell.querySelector('.vtop-da-badge:not(.vtop-da-badge-loading)')) return;

        const cells = row.querySelectorAll('td');
        const classNbrText = (cells[1]?.textContent || '').trim();
        const button = row.querySelector('button, a');
        const onclickAttr = button?.getAttribute('onclick') || '';
        const onclickMatch =
          onclickAttr.match(/(?:myFunction|processDigitalAssignment|viewDA|doDownloadQuestion)\s*\(\s*['"]([^'"]+)['"]/i) ||
          onclickAttr.match(/\(['"](VL[A-Za-z0-9]+|\d+)['"]\)/i);

        const classId =
          button?.dataset?.classid ||
          button?.dataset?.editclassid ||
          button?.getAttribute('data-classid') ||
          (onclickMatch ? onclickMatch[1] : null) ||
          (classNbrText.match(/^(VL[A-Za-z0-9]+|\d+)$/i) ? classNbrText : null) ||
          classNbrText ||
          '';

        if (!classId) {
          cell.innerHTML = '<span class="vtop-da-badge vtop-da-badge-green">All submissions done</span>';
          return;
        }

        // Check sessionStorage cache first (20 minute TTL)
        const cacheKey = `vtop_da_status_${classId}`;
        let status = null;
        try {
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < 20 * 60 * 1000) {
              status = parsed.data;
            }
          }
        } catch (_) {}

        if (!status) {
          try {
            status = await this.fetchCourseStatus(classId, authId, csrf);
            if (status && status.type !== 'error') {
              try {
                sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: status }));
              } catch (_) {}
            }
          } catch (err) {
            console.warn(`[VTOP++] DA check error for ${classId}:`, err);
            status = { type: 'error', text: 'Check failed' };
          }
        }

        if (!status) {
          status = { type: 'error', text: 'Check failed' };
        }

        this.applyRowBadge(cell, status);
      };

      try {
        const BATCH_SIZE = 3;
        for (let i = 0; i < pendingRows.length; i += BATCH_SIZE) {
          const batch = pendingRows.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map((row) => processRow(row)));
          if (i + BATCH_SIZE < pendingRows.length) {
            await new Promise((r) => setTimeout(r, 150));
          }
        }
      } finally {
        this.isScanning = false;
      }
    },

    async fetchCourseStatus(classId, authId, csrf) {
      const basePath = window.location.pathname.split('/')[1] || 'vtop';
      const endpoints = [
        `${window.location.origin}/${basePath}/examinations/processDigitalAssignment`,
        `${window.location.origin}/${basePath}/processDigitalAssignment`,
        `${window.location.origin}/${basePath}/examinations/StudentDAUpload`
      ];

      const params = new URLSearchParams();
      if (authId) params.append('authorizedID', authId);
      params.append('classId', classId);
      if (csrf) params.append('_csrf', csrf);

      const semSelect = document.querySelector('select[name*="sem" i], select[id*="sem" i]');
      if (semSelect?.value) {
        params.append(semSelect.name || 'semesterSubId', semSelect.value);
      }
      params.append('x', new Date().toUTCString());

      for (const targetUrl of endpoints) {
        try {
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: params.toString()
          });

          if (!res.ok) continue;

          const html = await res.text();
          if (html.includes('id="loginForm"') || html.includes('Login - VTOP')) {
            return { type: 'error', text: 'Auth expired' };
          }

          const parsed = this.parseCourseHtml(html);
          if (parsed && parsed.type !== 'error') {
            return parsed;
          }
        } catch (e) {
          console.warn(`[VTOP++] DA check error for ${targetUrl}:`, e);
        }
      }

      return { type: 'error', text: 'Check failed' };
    },

    parseCourseHtml(html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const tables = Array.from(doc.querySelectorAll('table'));
      let daTable = tables.find((t) => {
        const txt = (t.textContent || '').toLowerCase();
        return (
          txt.includes('due date') ||
          txt.includes('download question') ||
          txt.includes('case study') ||
          txt.includes('assignment') ||
          Boolean(t.querySelector('#downloadQuestion, #downloadStudentDA, button[name="downloadQuestion"]'))
        );
      });

      if (!daTable && tables.length > 0) {
        daTable = tables[0];
      }

      let allTrs = [];
      if (daTable) {
        allTrs = Array.from(daTable.querySelectorAll('tr'));
      } else {
        allTrs = Array.from(doc.querySelectorAll('tr'));
      }

      const dataRows = allTrs.filter((r) => {
        if (r.classList.contains('tableHeader') || r.closest('thead')) return false;
        if (r.querySelector('th')) return false;
        const cells = r.querySelectorAll('td');
        if (cells.length < 5) return false;
        const firstText = (cells[0].textContent || '').trim().toLowerCase();
        if (firstText.includes('sl.no') || firstText.includes('last updated')) return false;
        return true;
      });

      if (dataRows.length === 0) {
        return { type: 'done', text: 'All submissions done' };
      }

      let closestUpcomingDays = null;
      let closestOverdueDays = null;
      let hasUnsubmitted = false;

      dataRows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) return;

        // Check if submitted
        const hasStudentDownloadBtn = Boolean(
          row.querySelector(
            'button[name="downloadStudentDA"], button[id="downloadStudentDA"], a[href*="downloadSTudentDA"], [data-code][id*="StudentDA" i]'
          )
        );
        const cellTexts = Array.from(cells).map((c) => c.textContent || '');
        const hasTimestamp = cellTexts.some(
          (txt) =>
            /\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b|\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/.test(txt) &&
            (txt.includes('AM') || txt.includes('PM') || txt.includes(':'))
        );
        const rowText = (row.textContent || '').toLowerCase();
        const hasSubmittedText =
          rowText.includes('uploaded') || rowText.includes('submitted') || rowText.includes('view file');
        const hasUploadAction = Boolean(
          row.querySelector(
            'input[type="file"], #studDaUpload, button[name="digitalAssignmentSubmit"], button[name="editAssignment"]'
          )
        );

        let isSubmitted = false;
        if (hasStudentDownloadBtn || (hasTimestamp && !hasUploadAction) || hasSubmittedText) {
          isSubmitted = true;
        }
        if (rowText.includes('not applicable') || rowText.includes('n/a')) {
          isSubmitted = true;
        }

        if (!isSubmitted) {
          hasUnsubmitted = true;
          const dateSourceText = (cells[4]?.textContent || row.textContent || '').trim();
          const allDateMatches = Array.from(
            dateSourceText.matchAll(
              /\b(\d{1,2}[-\/\s][A-Za-z]{3,}[-\/\s]\d{2,4}|\d{1,2}[-\/\.][0-9]{1,2}[-\/\.]\d{2,4})\b/g
            )
          );

          if (allDateMatches.length > 0) {
            const parsedDates = allDateMatches.map((m) => parseIndianDate(m[1])).filter(Boolean);

            if (parsedDates.length > 0) {
              parsedDates.sort((a, b) => a.getTime() - b.getTime());
              const parsedDate = parsedDates[0];

              const now = new Date();
              const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
              const dueDayStart = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()).getTime();
              const diffDays = Math.round((dueDayStart - todayStart) / (1000 * 60 * 60 * 24));

              if (diffDays >= 0) {
                if (closestUpcomingDays === null || diffDays < closestUpcomingDays) {
                  closestUpcomingDays = diffDays;
                }
              } else {
                if (closestOverdueDays === null || diffDays > closestOverdueDays) {
                  closestOverdueDays = diffDays;
                }
              }
            }
          }
        }
      });

      if (!hasUnsubmitted) {
        return { type: 'done', text: 'All submissions done' };
      }

      // Design rules:
      // - Purple: Due today (0 days left)
      // - Red: 3 or less days left (or overdue)
      // - Green: More than 3 days left
      if (closestUpcomingDays !== null) {
        if (closestUpcomingDays === 0) {
          return { type: 'purple', text: 'Due today' };
        } else if (closestUpcomingDays <= 3) {
          return { type: 'red', text: `${closestUpcomingDays} day${closestUpcomingDays === 1 ? '' : 's'} left` };
        } else {
          return { type: 'green', text: `${closestUpcomingDays} days left` };
        }
      }

      if (closestOverdueDays !== null) {
        return { type: 'red', text: 'Overdue' };
      }

      return { type: 'done', text: 'All submissions done' };
    },

    applyRowBadge(cell, status) {
      if (!cell) return;
      let badgeClass = 'vtop-da-badge-green';
      if (status.type === 'purple') {
        badgeClass = 'vtop-da-badge-purple';
      } else if (status.type === 'red' || status.type === 'error') {
        badgeClass = 'vtop-da-badge-red';
      } else if (status.type === 'green' || status.type === 'done') {
        badgeClass = 'vtop-da-badge-green';
      }

      cell.innerHTML = `<span class="vtop-da-badge ${badgeClass}">${status.text}</span>`;
    }
  };

  window.VTOP_PLUS.DaTracker = DaTracker;
})();
