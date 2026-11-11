/**
 * VTOP++ - Digital Assignment (DA) Tracker Module
 * Comprehensive DA Deadline & Countdown Tracker for VIT VTOP.
 * Supports:
 * 1. Single-Course Assignment Upload Page: Injects a high-visibility countdown banner
 *    and inline deadline badges directly into the Due Date column.
 * 2. Course Overview Page: Injects the "Next Assignment" column into VTOP's Course Overview table.
 * 
 * Dynamic color coding:
 * - Purple: Due today (0 days left or <24h remaining)
 * - Red: 3 or fewer days left (or overdue)
 * - Green: More than 3 days left OR submitted
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  function parseIndianDate(str) {
    if (!str) return null;
    str = str.trim();

    // Extract optional time component (e.g. 11:59:00 PM, 23:59, 11:59 PM)
    let hours = 23;
    let minutes = 59;
    let seconds = 59;
    const timeMatch = str.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\b/);
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

    // 1. DD-MM-YYYY, DD/MM/YYYY, or DD.MM.YYYY
    const numMatch = str.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/);
    if (numMatch) {
      const d = parseInt(numMatch[1], 10);
      const m = parseInt(numMatch[2], 10) - 1;
      let y = parseInt(numMatch[3], 10);
      if (y < 100) y += 2000;
      const dt = new Date(y, m, d, hours, minutes, seconds);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // 2. DD-MMM-YYYY or DD MMM YYYY (e.g. 25-Nov-2026, 22 Oct 2026, 05-Jan-2025)
    const alphaMatch = str.match(/\b(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})\b/);
    if (alphaMatch) {
      const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const d = parseInt(alphaMatch[1], 10);
      const mKey = alphaMatch[2].substring(0, 3).toLowerCase();
      const m = months[mKey];
      let y = parseInt(alphaMatch[3], 10);
      if (y < 100) y += 2000;
      if (m !== undefined) {
        const dt = new Date(y, m, d, hours, minutes, seconds);
        return isNaN(dt.getTime()) ? null : dt;
      }
    }

    // 3. Fallback
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  function getRemainingTime(targetDate) {
    if (!targetDate) return null;
    const now = new Date();
    const diffMs = targetDate.getTime() - now.getTime();

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dueDayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
    const diffDays = Math.round((dueDayStart - todayStart) / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    const isOverdue = diffMs < 0;
    const isToday = diffDays === 0;

    let badgeType = 'green';
    let badgeText = '';

    if (isOverdue) {
      badgeType = 'red';
      const absDays = Math.abs(diffDays);
      badgeText = absDays <= 1 ? 'Overdue (today) ⚠️' : `Overdue (${absDays}d ago) ⚠️`;
    } else if (isToday) {
      badgeType = 'purple';
      badgeText = diffHours > 1 ? `Due Today (${diffHours}h left) ⏰` : 'Due Today ⏰';
    } else if (diffDays <= 3) {
      badgeType = 'red';
      badgeText = `${diffDays} day${diffDays === 1 ? '' : 's'} left ⚠️`;
    } else {
      badgeType = 'green';
      badgeText = `${diffDays} days left`;
    }

    return {
      diffMs,
      diffDays,
      diffHours,
      isOverdue,
      isToday,
      badgeType,
      badgeText
    };
  }

  const DaTracker = {
    isScanning: false,

    init() {
      this.checkAndTrack();
    },

    destroy() {
      const banner = document.getElementById('vtop-da-countdown-banner');
      if (banner) banner.remove();

      document.querySelectorAll('.vtop-th-da-status, .vtop-td-da-status').forEach((el) => el.remove());
      document.querySelectorAll('.vtop-da-cell-augmented').forEach((el) => {
        el.classList.remove('vtop-da-cell-augmented');
        const badge = el.querySelector('.vtop-da-badge');
        if (badge) badge.remove();
      });
      document.querySelectorAll('.vtop-da-urgent-row').forEach((el) => {
        el.classList.remove('vtop-da-urgent-row');
      });
      this.isScanning = false;
    },

    isDaPage() {
      if (this.findSingleCourseDaTable() || this.findCourseOverviewTable()) return true;

      const href = window.location.href.toLowerCase();
      if (href.includes('digitalassignment') || href.includes('studentda')) return true;

      const bodyText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
      if (bodyText.includes('assignment upload') || bodyText.includes('digital assignment')) {
        return true;
      }

      return Boolean(
        document.querySelector(
          '#daUpload, #studDaUpload, form[action*="DigitalAssignment"], button[name="downloadQuestion"], button[name="downloadStudentDA"], [onclick*="myFunction"], [onclick*="processDigitalAssignment"], [onclick*="doStudentDA"]'
        )
      );
    },

    checkAndTrack() {
      // 1. Check for single-course assignment upload view (where student actually views/uploads files)
      const singleTable = this.findSingleCourseDaTable();
      if (singleTable) {
        this.augmentSingleCourseDaTable(singleTable);
        return;
      }

      // 2. Check for course overview table (where student selects a course)
      const overviewTable = this.findCourseOverviewTable();
      if (overviewTable) {
        this.augmentCourseOverviewTable(overviewTable);
      }
    },

    // =========================================================================
    // 1. SINGLE-COURSE ASSIGNMENT UPLOAD VIEW (Inner DA View)
    // =========================================================================

    findSingleCourseDaTable() {
      const overview = this.findCourseOverviewTable();
      const allTables = Array.from(document.querySelectorAll('table'));

      for (const table of allTables) {
        if (table === overview) continue;

        const text = (table.innerText || table.textContent || '').toLowerCase();
        const hasDueDate = text.includes('due date') || text.includes('deadline') || text.includes('last date');
        const hasAssignment =
          text.includes('assignment') ||
          text.includes('case study') ||
          text.includes('download question') ||
          text.includes('upload') ||
          Boolean(table.querySelector('button[name="downloadQuestion"], input[type="file"], #studDaUpload'));

        if (hasDueDate && hasAssignment) {
          return table;
        }
      }
      return null;
    },

    augmentSingleCourseDaTable(table) {
      const headerRow =
        table.querySelector('thead tr') ||
        table.querySelector('tr.tableHeader') ||
        table.querySelector('tr:has(th)') ||
        table.querySelector('tr:first-child');

      if (!headerRow) return;

      const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
      let dueDateColIdx = -1;
      let titleColIdx = -1;

      headerCells.forEach((cell, idx) => {
        const txt = (cell.innerText || cell.textContent || '').toLowerCase();
        if (txt.includes('due date') || txt.includes('deadline') || txt.includes('last date')) {
          dueDateColIdx = idx;
        }
        if (txt.includes('title') || txt.includes('assignment') || txt.includes('description')) {
          titleColIdx = idx;
        }
      });

      // Fallback column index if header text not explicitly found
      if (dueDateColIdx === -1) dueDateColIdx = 4;
      if (titleColIdx === -1) titleColIdx = 1;

      const allRows = Array.from(table.querySelectorAll('tr'));
      const dataRows = allRows.filter((r) => {
        if (r.classList.contains('tableHeader') || r.closest('thead') || r === headerRow) return false;
        if (r.querySelector('th')) return false;
        const cells = r.querySelectorAll('td');
        return cells.length >= 3;
      });

      if (dataRows.length === 0) return;

      let closestPending = null;
      let totalAssignments = 0;
      let submittedAssignments = 0;

      dataRows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) return;
        totalAssignments++;

        // Determine assignment title
        const titleCell = cells[titleColIdx] || cells[1] || cells[0];
        const title = (titleCell?.innerText || titleCell?.textContent || `Assignment ${totalAssignments}`).trim();

        // Determine submission status
        const hasStudentDownload = Boolean(
          row.querySelector(
            'button[name="downloadStudentDA"], button[id="downloadStudentDA"], a[href*="downloadSTudentDA"], [data-code][id*="StudentDA" i]'
          )
        );
        const cellTexts = Array.from(cells).map((c) => (c.innerText || c.textContent || '').trim());
        const hasTimestamp = cellTexts.some(
          (txt) =>
            /\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b|\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/.test(txt) &&
            (txt.includes('AM') || txt.includes('PM') || txt.includes(':'))
        );
        const rowText = (row.innerText || row.textContent || '').toLowerCase();
        const hasSubmittedText =
          rowText.includes('uploaded') || rowText.includes('submitted') || rowText.includes('view file');
        const hasUploadAction = Boolean(
          row.querySelector(
            'input[type="file"], #studDaUpload, button[name="digitalAssignmentSubmit"], button[name="editAssignment"]'
          )
        );

        let isSubmitted = false;
        if (hasStudentDownload || (hasTimestamp && !hasUploadAction) || hasSubmittedText) {
          isSubmitted = true;
        }
        if (rowText.includes('not applicable') || rowText.includes('n/a')) {
          isSubmitted = true;
        }

        // Extract due date from the specific due date cell or row text
        const dueCell = cells[dueDateColIdx] || cells[3] || cells[2];
        const dateSource = (dueCell?.innerText || dueCell?.textContent || row.innerText || row.textContent || '').trim();
        const dateMatch =
          dateSource.match(/\b(\d{1,2}[-\/\s][A-Za-z]{3,}[-\/\s]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?)\b/) ||
          dateSource.match(/\b(\d{1,2}[-\/\.][0-9]{1,2}[-\/\.]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?)\b/);

        let parsedDate = null;
        let dateFormatted = '';
        if (dateMatch) {
          parsedDate = parseIndianDate(dateMatch[1]);
          dateFormatted = dateMatch[1];
        }

        if (isSubmitted) {
          submittedAssignments++;
          if (dueCell && !dueCell.classList.contains('vtop-da-cell-augmented')) {
            dueCell.classList.add('vtop-da-cell-augmented');
            const badge = document.createElement('div');
            badge.className = 'vtop-da-cell-badge';
            badge.innerHTML = '<span class="vtop-da-badge vtop-da-badge-green">Submitted ✅</span>';
            dueCell.appendChild(badge);
          }
        } else if (parsedDate) {
          const rem = getRemainingTime(parsedDate);
          if (rem) {
            // Check if this is the closest upcoming deadline
            if (rem.diffMs >= 0) {
              if (!closestPending || rem.diffMs < closestPending.diffMs) {
                closestPending = { ...rem, title, dateFormatted, date: parsedDate };
              }
            } else if (!closestPending || closestPending.isOverdue) {
              if (!closestPending || rem.diffMs > closestPending.diffMs) {
                closestPending = { ...rem, title, dateFormatted, date: parsedDate };
              }
            }

            // Augment the table cell with an inline countdown badge
            if (dueCell && !dueCell.classList.contains('vtop-da-cell-augmented')) {
              dueCell.classList.add('vtop-da-cell-augmented');
              const badge = document.createElement('div');
              badge.className = 'vtop-da-cell-badge';
              badge.innerHTML = `<span class="vtop-da-badge vtop-da-badge-${rem.badgeType}">${rem.badgeText}</span>`;
              dueCell.appendChild(badge);

              if (rem.badgeType === 'purple' || rem.badgeType === 'red') {
                row.classList.add('vtop-da-urgent-row');
              }
            }
          }
        }
      });

      // Render or update the Top Banner above the assignments table
      this.renderCountdownBanner(table, closestPending, totalAssignments, submittedAssignments);
    },

    renderCountdownBanner(table, closest, total, submitted) {
      let banner = document.getElementById('vtop-da-countdown-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'vtop-da-countdown-banner';
        const mountTarget = table.closest('.table-responsive') || table.parentElement || table;
        mountTarget.parentElement.insertBefore(banner, mountTarget);
      }

      if (closest) {
        banner.className = `vtop-da-banner vtop-da-banner-${closest.badgeType}`;
        banner.innerHTML = `
          <div class="vtop-da-banner-left">
            <span class="vtop-da-banner-icon">${closest.isToday ? '⏰' : closest.isOverdue ? '⚠️' : '📅'}</span>
            <div class="vtop-da-banner-info">
              <div class="vtop-da-banner-title">
                Next Deadline: <strong>${closest.title}</strong>
              </div>
              <div class="vtop-da-banner-sub">
                Due on <strong>${closest.dateFormatted || closest.date.toLocaleDateString()}</strong> &bull; ${submitted}/${total} assignments completed
              </div>
            </div>
          </div>
          <div class="vtop-da-banner-right">
            <span class="vtop-da-badge vtop-da-badge-${closest.badgeType} vtop-da-badge-lg">${closest.badgeText}</span>
          </div>
        `;
      } else if (total > 0 && submitted >= total) {
        banner.className = 'vtop-da-banner vtop-da-banner-green';
        banner.innerHTML = `
          <div class="vtop-da-banner-left">
            <span class="vtop-da-banner-icon">🎉</span>
            <div class="vtop-da-banner-info">
              <div class="vtop-da-banner-title">
                <strong>All Digital Assignments Completed!</strong>
              </div>
              <div class="vtop-da-banner-sub">
                Great job! All ${total} assignments for this course have been uploaded and submitted.
              </div>
            </div>
          </div>
          <div class="vtop-da-banner-right">
            <span class="vtop-da-badge vtop-da-badge-green vtop-da-badge-lg">All Done ✅</span>
          </div>
        `;
      } else {
        banner.className = 'vtop-da-banner vtop-da-banner-green';
        banner.innerHTML = `
          <div class="vtop-da-banner-left">
            <span class="vtop-da-banner-icon">📋</span>
            <div class="vtop-da-banner-info">
              <div class="vtop-da-banner-title">Digital Assignment Tracker Active</div>
              <div class="vtop-da-banner-sub">${total} assignments listed for this course</div>
            </div>
          </div>
        `;
      }
    },

    // =========================================================================
    // 2. COURSE OVERVIEW TABLE (Outer Course Selection View)
    // =========================================================================

    findCourseOverviewTable() {
      const allTables = Array.from(document.querySelectorAll('table'));
      for (const table of allTables) {
        const text = (table.innerText || table.textContent || '').toLowerCase();
        const hasClassNbr = text.includes('class nbr') || text.includes('class number') || text.includes('class no');
        const hasCourseCode = text.includes('course code') || text.includes('course title');

        if (hasClassNbr && hasCourseCode) {
          return table;
        }
      }
      return null;
    },

    augmentCourseOverviewTable(table) {
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
        th.style.cssText = 'text-align: center; vertical-align: middle; width: 15%; min-width: 140px;';
        headerRow.appendChild(th);
      }

      const allRows = Array.from(table.querySelectorAll('tr'));
      const dataRows = allRows.filter((r) => {
        if (r.classList.contains('tableHeader') || r.closest('thead') || r === headerRow) return false;
        if (r.querySelector('th')) return false;
        const cells = r.querySelectorAll('td');
        return cells.length >= 4;
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

      this.scanCourseDeadlines(dataRows);
    },

    getAuthId() {
      const fromDom =
        document.getElementById('authorizedID')?.value ||
        document.getElementById('authorizedIDX')?.value ||
        document.querySelector('input[name="authorizedID"], input[name*="authId" i]')?.value ||
        document.querySelector('input[name*="regNo" i]')?.value;
      if (fromDom) return fromDom.trim();

      const userImg = document.querySelector('img[src*="/vtop/users/image/?id="]');
      if (userImg) {
        const idMatch = userImg.src.match(/id=([a-zA-Z0-9]+)/);
        if (idMatch && idMatch[1]) return idMatch[1].toUpperCase();
      }

      const bodyText = document.body?.innerText || document.body?.textContent || '';
      const regMatch = bodyText.match(/\b(2[0-9][A-Z]{3}[0-9]{4,5})\b/i);
      if (regMatch) return regMatch[1].toUpperCase();

      return '';
    },

    getCsrfToken() {
      const csrfInput = document.querySelector('input[name="_csrf"], input[id="_csrf"], input[name*="csrf" i]');
      if (csrfInput && csrfInput.value) return csrfInput.value;

      const csrfMeta = document.querySelector('meta[name="_csrf"]');
      if (csrfMeta && csrfMeta.content) return csrfMeta.content;

      try {
        const match = document.cookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|_csrf)=([^;]+)/i);
        if (match && match[1]) return decodeURIComponent(match[1]);
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

        if (cell.querySelector('.vtop-da-badge:not(.vtop-da-badge-loading)')) return;

        const cells = row.querySelectorAll('td');
        const classNbrText = (cells[1]?.innerText || cells[1]?.textContent || '').trim();
        const button = row.querySelector('button, a');
        const onclickAttr = button?.getAttribute('onclick') || '';
        const onclickMatch =
          onclickAttr.match(/(?:myFunction|processDigitalAssignment|viewDA|doDownloadQuestion|doStudentDA)\s*\(\s*['"]?([a-zA-Z0-9_\-]+)['"]?/i) ||
          onclickAttr.match(/\(['"]?([a-zA-Z0-9_\-]+)['"]?\)/i);

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
        for (let i = 0; i < pendingRows.length; i++) {
          await processRow(pendingRows[i]);
          if (i < pendingRows.length - 1) {
            await new Promise((r) => setTimeout(r, Math.floor(300 + Math.random() * 150)));
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
        `${window.location.origin}/${basePath}/examinations/StudentDAUpload`,
        `${window.location.origin}/${basePath}/examinations/doStudentDA`
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

          if (res.status === 429) {
            console.warn('[VTOP++] VTOP rate limited DA checks (HTTP 429).');
            return { type: 'error', text: 'Rate limited' };
          }

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
        const txt = (t.innerText || t.textContent || '').toLowerCase();
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
        if (cells.length < 3) return false;
        const firstText = (cells[0].innerText || cells[0].textContent || '').trim().toLowerCase();
        if (firstText.includes('sl.no') || firstText.includes('last updated')) return false;
        return true;
      });

      if (dataRows.length === 0) {
        return { type: 'done', text: 'All submissions done' };
      }

      let closestPending = null;
      let hasUnsubmitted = false;

      dataRows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) return;

        // Check if submitted
        const hasStudentDownload = Boolean(
          row.querySelector(
            'button[name="downloadStudentDA"], button[id="downloadStudentDA"], a[href*="downloadSTudentDA"], [data-code][id*="StudentDA" i]'
          )
        );
        const cellTexts = Array.from(cells).map((c) => (c.innerText || c.textContent || '').trim());
        const hasTimestamp = cellTexts.some(
          (txt) =>
            /\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b|\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/.test(txt) &&
            (txt.includes('AM') || txt.includes('PM') || txt.includes(':'))
        );
        const rowText = (row.innerText || row.textContent || '').toLowerCase();
        const hasSubmittedText =
          rowText.includes('uploaded') || rowText.includes('submitted') || rowText.includes('view file');
        const hasUploadAction = Boolean(
          row.querySelector(
            'input[type="file"], #studDaUpload, button[name="digitalAssignmentSubmit"], button[name="editAssignment"]'
          )
        );

        let isSubmitted = false;
        if (hasStudentDownload || (hasTimestamp && !hasUploadAction) || hasSubmittedText) {
          isSubmitted = true;
        }
        if (rowText.includes('not applicable') || rowText.includes('n/a')) {
          isSubmitted = true;
        }

        if (!isSubmitted) {
          hasUnsubmitted = true;

          // Search all cells for due date patterns
          let foundDate = null;
          for (let i = 0; i < cells.length; i++) {
            const cellTxt = (cells[i].innerText || cells[i].textContent || '').trim();
            const dateMatch =
              cellTxt.match(/\b(\d{1,2}[-\/\s][A-Za-z]{3,}[-\/\s]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?)\b/) ||
              cellTxt.match(/\b(\d{1,2}[-\/\.][0-9]{1,2}[-\/\.]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?)\b/);
            if (dateMatch) {
              const dt = parseIndianDate(dateMatch[1]);
              if (dt) {
                foundDate = dt;
                break;
              }
            }
          }

          if (foundDate) {
            const rem = getRemainingTime(foundDate);
            if (rem) {
              if (rem.diffMs >= 0) {
                if (!closestPending || rem.diffMs < closestPending.diffMs) {
                  closestPending = rem;
                }
              } else if (!closestPending || closestPending.isOverdue) {
                if (!closestPending || rem.diffMs > closestPending.diffMs) {
                  closestPending = rem;
                }
              }
            }
          }
        }
      });

      if (!hasUnsubmitted) {
        return { type: 'done', text: 'All submissions done' };
      }

      if (closestPending) {
        return {
          type: closestPending.badgeType,
          text: closestPending.badgeText
        };
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
