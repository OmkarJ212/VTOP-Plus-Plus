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

    // 1. YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, or DD.MM.YYYY
    const numMatch = str.match(/\b(\d{1,4})[-\/.](\d{1,2})[-\/.](\d{1,4})\b/);
    if (numMatch) {
      let d, m, y;
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
      if (isNaN(dt.getTime()) || dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) {
        return null;
      }
      return dt;
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
        if (isNaN(dt.getTime()) || dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) {
          return null;
        }
        return dt;
      }
    }

    return null;
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
      badgeText = absDays === 0 ? 'Overdue (today)' : `Overdue (${absDays}d ago)`;
    } else if (isToday) {
      badgeType = 'purple';
      badgeText = diffHours > 1 ? `Due Today (${diffHours}h left)` : 'Due Today';
    } else if (diffDays <= 3) {
      badgeType = 'red';
      badgeText = `${diffDays} day${diffDays === 1 ? '' : 's'} left`;
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

  function extractDateFromText(text) {
    if (!text) return null;
    const match =
      text.match(/\b(\d{1,2}[-\/\s][A-Za-z]{3,}[-\/\s]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?)\b/) ||
      text.match(/\b(\d{1,2}[-\/\.][0-9]{1,2}[-\/\.]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?)\b/);
    return match ? parseIndianDate(match[1]) : null;
  }

  function isDaRowSubmitted(row, cells) {
    const hasStudentDownload = Boolean(
      row.querySelector(
        'button[name="downloadStudentDA"], button[id="downloadStudentDA"], a[href*="downloadSTudentDA"], [data-code][id*="StudentDA" i]'
      )
    );
    const cellTexts = Array.from(cells).map((c) => (c.textContent || '').trim());
    const hasTimestamp = cellTexts.some(
      (txt) =>
        /\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b|\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/.test(txt) &&
        (txt.includes('AM') || txt.includes('PM') || txt.includes(':'))
    );
    const statusCells = cells.length >= 4 ? Array.from(cells).slice(-3) : Array.from(cells);
    const statusText = statusCells.map((c) => (c.textContent || '').toLowerCase()).join(' ');
    const hasSubmittedText =
      statusText.includes('uploaded') || statusText.includes('submitted') || statusText.includes('view file');
    const hasUploadAction = Boolean(
      row.querySelector(
        'input[type="file"], #studDaUpload, button[name="digitalAssignmentSubmit"], button[name="editAssignment"]'
      )
    );

    if (hasStudentDownload || (hasTimestamp && !hasUploadAction) || hasSubmittedText) {
      return true;
    }
    return statusText.includes('not applicable') || statusText.includes('n/a');
  }

  const DaTracker = {
    isScanning: false,
    _scanToken: 0,
    _rescanPending: false,
    _pendingTarget: null,
    _homeCoursesPromise: null,

    init() {
      this.checkAndTrack();
    },

    destroy() {
      this._scanToken++;
      this._rescanPending = false;
      this._pendingTarget = null;
      document.querySelectorAll('.vtop-th-da-status, .vtop-td-da-status, .vtop-da-home-col, .vtop-da-home-cell').forEach((el) => el.remove());
      document.querySelectorAll('.vtop-da-cell-augmented').forEach((el) => {
        el.classList.remove('vtop-da-cell-augmented');
        el.querySelectorAll('.vtop-da-cell-badge, .vtop-da-badge').forEach((b) => b.remove());
      });
      document.querySelectorAll('.vtop-da-urgent-row').forEach((el) => {
        el.classList.remove('vtop-da-urgent-row');
      });
      this.isScanning = false;
    },

    clearCache() {
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith('vtop_da_status_')) {
            sessionStorage.removeItem(key);
          }
        }
      } catch (_) {}
    },

    checkAndTrack() {
      // Never inject DA columns on unrelated pages such as Additional Learning (#addLeanForm)
      if (document.getElementById('addLeanForm')) return;

      // 0. Home page Forthcoming Digital Assignments card (#digital-assignments)
      const homeDaContainer = document.getElementById('digital-assignments');
      if (homeDaContainer) {
        this.augmentHomeDaCard(homeDaContainer);
      }

      // 0b. Handle auto-select semester & direct course jump on StudentDA page
      if (document.getElementById('digitalAssignment')) {
        this.handleStudentDaAutoFlow();
      }

      const overviewTable = this.findCourseOverviewTable();

      // 1. Check for single-course assignment upload view (where student actually views/uploads files)
      const singleTable = this.findSingleCourseDaTable(overviewTable);
      if (singleTable) {
        this.clearCache();
        this.augmentSingleCourseDaTable(singleTable);
        return;
      }

      // 2. Check for course overview table (where student selects a course)
      if (overviewTable) {
        this.augmentCourseOverviewTable(overviewTable);

        // Reset #semesterSubId back to default "-- Choose Semester --" after collecting overview
        const daSelect = document.querySelector('#digitalAssignment #semesterSubId');
        if (daSelect && daSelect.value !== '' && !document.querySelector('.blockUI, .blockOverlay')) {
          daSelect.dataset.vtopDaAutoSem = '1';
          window.VTOP_PLUS?.DOM?.resetSelectToDefault?.(daSelect);
        }
      }
    },

    // =========================================================================
    // 0. HOME PAGE FORTHCOMING DA CARD & BACKGROUND COURSE DASHBOARD FETCHER
    // =========================================================================

    async fetchLatestSemesterCourses() {
      const DOM = window.VTOP_PLUS?.DOM;
      const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
      const cacheKey = `vtop_da_home_courses_v1_${authId || 'anon'}`;

      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && Date.now() - parsed.timestamp < 20 * 60 * 1000 && Array.isArray(parsed.courses)) {
            return parsed.courses;
          }
        }
      } catch (_) {}

      if (this._homeCoursesPromise) return this._homeCoursesPromise;

      this._homeCoursesPromise = (async () => {
        try {
          const VtopApi = window.VTOP_PLUS?.VtopApi;
          const csrf = DOM?.getCsrfToken ? DOM.getCsrfToken() : '';

          const postHtml = async (relUrl, extra = {}) => {
            const res = await VtopApi.postHtml(relUrl, extra);
            return res.ok ? res.html : '';
          };

          // Step 1: Load StudentDA markup silently and choose first non-empty semester
          const pageHtml = await postHtml('examinations/StudentDA', {
            verifyMenu: 'true',
            nocache: `@(${new Date().toUTCString()})`
          });
          if (!pageHtml) return [];

          const pageDoc = new DOMParser().parseFromString(pageHtml, 'text/html');
          const semSelect = pageDoc.getElementById('semesterSubId');
          const firstSemOpt = semSelect?.querySelector('option[value]:not([value=""])');
          if (!firstSemOpt) return [];

          const semesterSubId = firstSemOpt.value;
          const semesterLabel = (firstSemOpt.textContent || '').replace(/\s+/g, ' ').trim();
          if (VtopApi?.saveActiveSemesterId) {
            VtopApi.saveActiveSemesterId(semesterSubId, semesterLabel);
          }
          const formCsrf = pageDoc.querySelector('#digitalAssignment input[name="_csrf"]')?.value || csrf;
          const formAuthId = pageDoc.querySelector('#digitalAssignment #authorizedID')?.value || authId;

          // Step 2: Fetch resulting course table for that first semester (same as dAOnChange)
          const tableHtml = await postHtml('examinations/doDigitalAssignment', {
            _csrf: formCsrf,
            authorizedID: formAuthId,
            semesterSubId
          });
          if (!tableHtml) return [];

          const tableDoc = new DOMParser().parseFromString(tableHtml, 'text/html');
          const rows = Array.from(tableDoc.querySelectorAll('#fixedTableContainer table.customTable tr.tableContent, table tr'));
          const courses = [];

          for (const row of rows) {
            if (row.classList.contains('tableHeader') || row.closest('thead') || row.querySelector('th')) continue;
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) continue;

            const btn = row.querySelector('button[onclick*="myFunction"], a[onclick*="myFunction"], button, a');
            const onclick = btn?.getAttribute('onclick') || '';
            const match = onclick.match(/myFunction\s*\(\s*['"]?([a-zA-Z0-9_-]+)['"]?\s*\)/i);
            const classId =
              btn?.dataset?.classid ||
              (match ? match[1] : '') ||
              (cells[1]?.textContent || '').trim();

            if (!btn || !classId) continue;

            courses.push({
              semesterSubId,
              classId,
              courseCode: (cells[2]?.textContent || '').trim(),
              courseTitle: (cells[3]?.textContent || '').trim(),
              courseType: (cells[4]?.textContent || '').trim()
            });
          }

          if (courses.length > 0) {
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), courses }));
            } catch (_) {}
          }
          return courses;
        } catch (err) {
          console.warn('[VTOP++] Failed to prefetch latest DA courses:', err);
          return [];
        } finally {
          this._homeCoursesPromise = null;
        }
      })();

      return this._homeCoursesPromise;
    },

    matchHomeCourse(courseText, courses) {
      if (!courseText || !Array.isArray(courses) || courses.length === 0) return null;
      const codeMatch = courseText.match(/\b([A-Z]{3,4}\d{3,4}[A-Z]?)\b/i);
      if (codeMatch) {
        const code = codeMatch[1].toUpperCase();
        const byCode = courses.find((c) => (c.courseCode || '').toUpperCase() === code);
        if (byCode) return byCode;
      }

      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const target = norm(courseText);
      if (!target) return null;

      const wantsLab = /\b(lab|ela)\b/i.test(courseText);
      const wantsTheory = /\b(theory|eth|th)\b/i.test(courseText);

      const candidates = courses.filter((c) => {
        const title = norm(c.courseTitle);
        return title && (target.includes(title) || title.includes(target));
      });
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      if (wantsLab) {
        const labMatch = candidates.find((c) => /lab/i.test(c.courseType || ''));
        if (labMatch) return labMatch;
      }
      if (wantsTheory) {
        const thMatch = candidates.find((c) => /theory/i.test(c.courseType || ''));
        if (thMatch) return thMatch;
      }
      return candidates[0];
    },

    navigateToCourseDa(semesterSubId = '', classId = '') {
      this._pendingTarget = {
        semesterSubId: semesterSubId || '',
        classId: classId || '',
        expiresAt: Date.now() + 15000
      };

      const crawler = window.VTOP_PLUS?.Crawler;
      if (
        crawler &&
        crawler.navigate({
          dataUrl: 'examinations/StudentDA',
          fallbackDataUrls: ['examinations/StudentDAUpload', 'examinations/DigitalAssignment'],
          title: 'Digital Assignment Upload'
        })
      ) {
        return;
      }

      const menuLink = document.querySelector('a[data-url*="StudentDA" i], [data-url*="DigitalAssignment" i]');
      if (menuLink) {
        window.VTOP_PLUS?.DOM?.simulateNativeClick?.(menuLink) || menuLink.click();
      }
    },

    handleStudentDaAutoFlow() {
      const target = this._pendingTarget;
      if (target && Date.now() > target.expiresAt) {
        this._pendingTarget = null;
        return;
      }

      const semSelect = document.getElementById('semesterSubId');
      if (semSelect && semSelect.value === '' && !semSelect.dataset.vtopDaAutoSem) {
        const desiredOpt =
          (target?.semesterSubId &&
            Array.from(semSelect.options).find((o) => o.value === target.semesterSubId)) ||
          semSelect.querySelector('option[value]:not([value=""])');

        if (desiredOpt) {
          semSelect.dataset.vtopDaAutoSem = '1';
          const DOM = window.VTOP_PLUS?.DOM;
          const applyChoice = () => {
            if (!semSelect.isConnected || semSelect.value !== '') return;
            semSelect.value = desiredOpt.value;
            semSelect.dispatchEvent(new Event('change', { bubbles: true }));
          };
          if (DOM?.waitForBlockUIClear) {
            DOM.waitForBlockUIClear().then(applyChoice);
          } else {
            applyChoice();
          }
          return;
        }
      }

      if (target?.classId) {
        const overviewTable = this.findCourseOverviewTable();
        if (!overviewTable) return;

        const cid = target.classId;
        const rows = Array.from(overviewTable.querySelectorAll('tr'));
        for (const row of rows) {
          if (row.classList.contains('tableHeader') || row.closest('thead') || row.querySelector('th')) continue;
          const btn = row.querySelector('button[onclick*="myFunction"], a[onclick*="myFunction"], button, a');
          const onclick = btn?.getAttribute('onclick') || '';
          const match = onclick.match(/myFunction\s*\(\s*['"]?([a-zA-Z0-9_-]+)['"]?\s*\)/i);
          const rowCid =
            btn?.dataset?.classid ||
            (match ? match[1] : '') ||
            (row.querySelectorAll('td')[1]?.textContent || '').trim();

          if (btn && rowCid === cid) {
            this._pendingTarget = null;
            window.VTOP_PLUS?.DOM?.simulateNativeClick?.(btn) || btn.click();
            break;
          }
        }
      }
    },

    openCourseDaUploadDirectly(classId) {
      const DOM = window.VTOP_PLUS?.DOM;
      const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
      const csrf = DOM?.getCsrfToken ? DOM.getCsrfToken() : '';

      document.dispatchEvent(
        new CustomEvent('vtop-plus-open-da-upload', {
          detail: { classId, authId, csrf }
        })
      );
    },

    async augmentHomeDaCard(container) {
      const table = container.querySelector('table');
      const tbody = table?.querySelector('tbody');
      if (!table || !tbody) return;

      const dataRows = Array.from(tbody.querySelectorAll('tr')).filter((tr) => tr.textContent.trim().length > 0);
      if (dataRows.length === 0) return;

      const theadRow = table.querySelector('thead tr');
      if (theadRow && !theadRow.querySelector('.vtop-da-home-col')) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.className = 'vtop-da-home-col text-center';
        th.textContent = 'Upload Now';
        theadRow.appendChild(th);
      }

      const courses = await this.fetchLatestSemesterCourses();
      if (!document.body.contains(container)) return;

      dataRows.forEach((row) => {
        if (row.querySelector('.vtop-da-home-cell')) return;
        const cells = row.querySelectorAll('td');
        const courseNameText = (cells[1]?.textContent || cells[0]?.textContent || '').replace(/\s+/g, ' ').trim();
        const matched = this.matchHomeCourse(courseNameText, courses);

        const td = document.createElement('td');
        td.className = 'vtop-da-home-cell text-center';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vtop-da-home-upload-btn';
        btn.textContent = 'Upload Now';
        btn.title = matched
          ? `Open DA Upload for ${matched.courseCode || matched.courseTitle}`
          : 'Open Digital Assignment Upload';
        btn.addEventListener('click', async () => {
          let targetCourse = matched;
          if (!targetCourse?.classId) {
            btn.disabled = true;
            const latest = await this.fetchLatestSemesterCourses();
            targetCourse = this.matchHomeCourse(courseNameText, latest);
            btn.disabled = false;
          }
          if (targetCourse?.classId) {
            this.openCourseDaUploadDirectly(targetCourse.classId);
          } else {
            this.navigateToCourseDa(targetCourse?.semesterSubId || '', '');
          }
        });

        td.appendChild(btn);
        row.appendChild(td);
      });
    },

    // =========================================================================
    // 1. SINGLE-COURSE ASSIGNMENT UPLOAD VIEW (Inner DA View)
    // =========================================================================

    findSingleCourseDaTable(knownOverviewTable = null) {
      // 1. O(1) scoped check inside #fixedTableContainer > table.customTable
      const scopedTables = document.querySelectorAll('#fixedTableContainer table.customTable');
      for (const table of scopedTables) {
        const headerText = (table.querySelector('tr')?.textContent || '').toLowerCase();
        if (
          (headerText.includes('due date') || headerText.includes('deadline') || headerText.includes('last date')) &&
          (headerText.includes('title') || headerText.includes('document details') || headerText.includes('qp') || headerText.includes('assignment'))
        ) {
          return table;
        }
      }

      // 2. Fallback: scan all tables using textContent (no layout reflow)
      const overview = knownOverviewTable || this.findCourseOverviewTable();
      const allTables = Array.from(document.querySelectorAll('table'));

      for (const table of allTables) {
        if (table === overview) continue;
        // Skip Home/Dashboard summary cards (e.g. #digital-assignments Forthcoming DA card)
        if (table.closest('#digital-assignments, #course-data, #edu-status, #last-five-feedbacks, #proctor-message, #vtop-home-class-messages')) {
          continue;
        }

        const text = (table.textContent || '').toLowerCase();
        const hasDueDate = text.includes('due date') || text.includes('deadline') || text.includes('last date');
        const hasAssignment =
          text.includes('assignment') ||
          text.includes('case study') ||
          text.includes('download question') ||
          text.includes('document details') ||
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

      headerCells.forEach((cell, idx) => {
        const txt = (cell.textContent || '').toLowerCase();
        if (txt.includes('due date') || txt.includes('deadline') || txt.includes('last date')) {
          dueDateColIdx = idx;
        }
      });

      // Fallback column index if header text not explicitly found
      if (dueDateColIdx === -1) dueDateColIdx = 4;

      const allRows = Array.from(table.querySelectorAll('tr'));
      const dataRows = allRows.filter((r) => {
        if (r.classList.contains('tableHeader') || r.closest('thead') || r === headerRow) return false;
        if (r.querySelector('th')) return false;
        const cells = r.querySelectorAll('td');
        if (cells.length < 4) return false;
        // Skip VTOP's 3-cell sub-header row ("Last Updated On | Upload/Edit | Download") under Document Details
        const firstText = (cells[0].textContent || '').trim().toLowerCase();
        if (firstText.includes('last updated') || firstText.includes('sl.no')) return false;
        return true;
      });

      if (dataRows.length === 0) return;

      let titleColIdx = -1;
      headerCells.forEach((cell, idx) => {
        const txt = (cell.textContent || '').toLowerCase();
        if (txt.includes('title') || txt.includes('assignment')) {
          titleColIdx = idx;
        }
      });

      let submittedCount = 0;
      let pendingCount = 0;
      let closestPending = null;
      let closestTitle = '';

      dataRows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) return;

        const isSubmitted = isDaRowSubmitted(row, cells);
        const dueCell = cells[dueDateColIdx] || cells[3] || cells[2];
        const dateSource = (dueCell?.textContent || '').trim();
        const parsedDate = extractDateFromText(dateSource);
        const rowTitle = (cells[titleColIdx !== -1 ? titleColIdx : 1]?.textContent || '').replace(/\s+/g, ' ').trim();

        if (isSubmitted) {
          submittedCount++;
          if (dueCell && !dueCell.classList.contains('vtop-da-cell-augmented')) {
            dueCell.classList.add('vtop-da-cell-augmented');
            const badge = document.createElement('div');
            badge.className = 'vtop-da-cell-badge';
            const span = document.createElement('span');
            span.className = 'vtop-da-badge vtop-da-badge-green';
            span.textContent = 'Submitted';
            badge.appendChild(span);
            dueCell.appendChild(badge);
          }
        } else {
          pendingCount++;
          if (parsedDate) {
            const rem = getRemainingTime(parsedDate);
            if (rem) {
              if (
                !closestPending ||
                (rem.diffMs >= 0 && (closestPending.isOverdue || rem.diffMs < closestPending.diffMs)) ||
                (rem.isOverdue && closestPending.isOverdue && rem.diffMs > closestPending.diffMs)
              ) {
                closestPending = rem;
                closestTitle = rowTitle;
              }

              // Augment the table cell with an inline countdown badge
              if (dueCell && !dueCell.classList.contains('vtop-da-cell-augmented')) {
                dueCell.classList.add('vtop-da-cell-augmented');
                const badge = document.createElement('div');
                badge.className = 'vtop-da-cell-badge';
                const span = document.createElement('span');
                span.className = `vtop-da-badge vtop-da-badge-${rem.badgeType}`;
                span.textContent = rem.badgeText;
                badge.appendChild(span);
                dueCell.appendChild(badge);

                if (rem.badgeType === 'purple' || rem.badgeType === 'red') {
                  row.classList.add('vtop-da-urgent-row');
                }
              }
            }
          }
        }
      });
    },

    // =========================================================================
    // 2. COURSE OVERVIEW TABLE (Outer Course Selection View)
    // =========================================================================

    findCourseOverviewTable() {
      // Only augment course overview tables on Digital Assignment pages
      const isDaPage = Boolean(document.getElementById('digitalAssignment')) ||
        Array.from(document.querySelectorAll('.card-header, .box-header')).some((h) =>
          /assignment/i.test(h.textContent || '')
        );
      if (!isDaPage) return null;

      // 1. O(1) scoped check inside #fixedTableContainer > table.customTable
      const scopedTables = document.querySelectorAll('#fixedTableContainer table.customTable');
      for (const table of scopedTables) {
        const firstRow = table.querySelector('tr');
        const headerText = (firstRow?.textContent || '').toLowerCase();
        const colCount = firstRow ? firstRow.children.length : 0;
        if (
          colCount >= 6 &&
          (headerText.includes('class nbr') || headerText.includes('class number') || headerText.includes('class no')) &&
          (headerText.includes('course code') || headerText.includes('course title'))
        ) {
          return table;
        }
      }

      // 2. Fallback: scan tables using textContent (no layout reflow)
      const allTables = Array.from(document.querySelectorAll('table'));
      for (const table of allTables) {
        const firstRow = table.querySelector('tr');
        const colCount = firstRow ? firstRow.children.length : 0;
        const text = (firstRow ? firstRow.textContent : table.textContent || '').toLowerCase();
        const hasClassNbr = text.includes('class nbr') || text.includes('class number') || text.includes('class no');
        const hasCourseCode = text.includes('course code') || text.includes('course title');

        if (colCount >= 6 && hasClassNbr && hasCourseCode) {
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
        th.className = 'vtop-th-da-status tableHeader';
        th.textContent = 'Next Assignment';
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
          cell.className = 'vtop-td-da-status tableContent';
          cell.innerHTML = '<span class="vtop-da-badge vtop-da-badge-loading">Checking...</span>';
          row.appendChild(cell);
        }
      });

      this.scanCourseDeadlines(dataRows);
    },

    async scanCourseDeadlines(dataRows) {
      const pendingRows = dataRows.filter((r) => r.querySelector('.vtop-da-badge-loading'));
      if (pendingRows.length === 0) return;

      if (this.isScanning) {
        this._rescanPending = true;
        return;
      }
      this.isScanning = true;
      const myToken = ++this._scanToken;

      const DOM = window.VTOP_PLUS?.DOM;
      const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
      const csrf = DOM?.getCsrfToken ? DOM.getCsrfToken() : '';

      const processRow = async (row) => {
        if (myToken !== this._scanToken || !document.body.contains(row)) return false;

        const cell = row.querySelector('.vtop-td-da-status');
        if (!cell) return false;

        if (cell.querySelector('.vtop-da-badge:not(.vtop-da-badge-loading)')) return false;

        const cells = row.querySelectorAll('td');
        const classNbrText = (cells[1]?.textContent || '').trim();
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
          this.applyRowBadge(cell, { type: 'done', text: 'All submissions done' });
          return false;
        }

        const cacheKey = `vtop_da_status_${authId || 'anon'}_${classId}`;
        let status = null;
        let didFetch = false;
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
          didFetch = true;
          try {
            status = await this.fetchCourseStatus(classId, authId, csrf);
            if (myToken !== this._scanToken) return false;
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

        if (myToken !== this._scanToken || !document.body.contains(row)) return false;

        if (!status) {
          status = { type: 'error', text: 'Check failed' };
        }

        this.applyRowBadge(cell, status);
        return didFetch;
      };

      try {
        for (let i = 0; i < pendingRows.length; i++) {
          if (myToken !== this._scanToken) break;
          const didFetch = await processRow(pendingRows[i]);
          if (myToken !== this._scanToken) break;
          if (didFetch && i < pendingRows.length - 1) {
            await new Promise((r) => setTimeout(r, Math.floor(300 + Math.random() * 150)));
          }
        }
      } finally {
        if (myToken === this._scanToken) {
          this.isScanning = false;
          if (this._rescanPending) {
            this._rescanPending = false;
            this.checkAndTrack();
          }
        }
      }
    },

    async fetchCourseStatus(classId, authId, csrf) {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      const semSelect = document.getElementById('semesterSubId') ||
                        document.querySelector('select[name*="sem" i], select[id*="sem" i]');
      const semValue = semSelect?.value || semSelect?.dataset?.vtopLastSem || '';
      const extra = {
        classId,
        x: new Date().toUTCString()
      };
      if (authId) extra.authorizedID = authId;
      if (csrf) extra._csrf = csrf;
      if (semValue) {
        extra[semSelect.name || 'semesterSubId'] = semValue;
      }

      try {
        const res = await VtopApi.postHtml('examinations/processDigitalAssignment', extra);
        if (res.rateLimited) {
          console.warn('[VTOP++] VTOP rate limited DA checks (HTTP 429).');
          return { type: 'error', text: 'Rate limited' };
        }
        if (res.expired) {
          return { type: 'error', text: 'Auth expired' };
        }
        if (!res.ok) {
          return { type: 'error', text: 'Check failed' };
        }

        const parsed = this.parseCourseHtml(res.html);
        if (parsed && parsed.type !== 'error') {
          return parsed;
        }
      } catch (e) {
        console.warn('[VTOP++] DA check error:', e);
      }

      return { type: 'error', text: 'Check failed' };
    },

    parseCourseHtml(html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const tables = Array.from(doc.querySelectorAll('#fixedTableContainer table.customTable, table'));
      let daTable = tables.find((t) => {
        const headerTxt = (t.querySelector('tr')?.textContent || t.textContent || '').toLowerCase();
        return (
          headerTxt.includes('due date') ||
          headerTxt.includes('document details') ||
          headerTxt.includes('download question') ||
          headerTxt.includes('case study') ||
          headerTxt.includes('assignment') ||
          Boolean(t.querySelector('#downloadQuestion, #downloadStudentDA, button[name="downloadQuestion"]'))
        );
      });

      if (!daTable && tables.length > 0) {
        daTable = tables[tables.length - 1];
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
        if (cells.length < 4) return false;
        const firstText = (cells[0].textContent || '').trim().toLowerCase();
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

        if (!isDaRowSubmitted(row, cells)) {
          hasUnsubmitted = true;

          // Search all cells for due date patterns
          let foundDate = null;
          for (let i = 0; i < cells.length; i++) {
            const dt = extractDateFromText((cells[i].innerText || cells[i].textContent || '').trim());
            if (dt) {
              foundDate = dt;
              break;
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

      // If unsubmitted items exist but no date was parsed, warn student instead of falsely claiming all done
      return { type: 'purple', text: 'Pending assignment' };
    },

    applyRowBadge(cell, status) {
      if (!cell) return;
      if (status.type === 'error') {
        const span = document.createElement('span');
        span.className = 'vtop-da-badge vtop-da-badge-loading';
        span.textContent = '--';
        if (status.text) span.title = status.text;
        cell.replaceChildren(span);
        return;
      }

      let badgeClass = 'vtop-da-badge-green';
      if (status.type === 'purple') {
        badgeClass = 'vtop-da-badge-purple';
      } else if (status.type === 'red') {
        badgeClass = 'vtop-da-badge-red';
      } else if (status.type === 'green' || status.type === 'done') {
        badgeClass = 'vtop-da-badge-green';
      }

      const span = document.createElement('span');
      span.className = `vtop-da-badge ${badgeClass}`;
      span.textContent = status.text || '';
      cell.replaceChildren(span);
    }
  };

  window.VTOP_PLUS.DaTracker = DaTracker;
})();
