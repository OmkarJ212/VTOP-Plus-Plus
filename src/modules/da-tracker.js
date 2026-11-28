// Digital Assignment Tracker: due-date countdowns & badges (purple: due today, red: <=3d/overdue, green: >3d/submitted).

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  function parseIndianDate(str) {
    return window.VTOP_PLUS?.DOM?.parseIndianDate?.(str) || null;
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
    _lastActiveClassId: '',

    init(opts = {}) {
      this.checkAndTrack(opts);
    },

    destroy() {
      this._scanToken++;
      this._rescanPending = false;
      this._lastActiveClassId = '';
      window.VTOP_PLUS?.DaHomeCard?.clearPendingTarget?.();
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
      window.VTOP_PLUS?.Storage?.removeWebCacheByPrefix?.('vtop_da_status_', 'session');
    },

    checkAndTrack({ augmentHomeCard = true } = {}) {
      // Never inject DA columns on unrelated pages such as Additional Learning (#addLeanForm)
      if (document.getElementById('addLeanForm')) return;

      // Home page Forthcoming Digital Assignments card (#digital-assignments)
      const homeDaContainer = document.getElementById('digital-assignments');
      if (homeDaContainer) {
        if (augmentHomeCard) {
          window.VTOP_PLUS?.DaHomeCard?.augmentHomeDaCard?.(homeDaContainer);
        } else {
          window.VTOP_PLUS?.DaHomeCard?.destroy?.();
        }
      }

      // 0b. Handle auto-select semester & direct course jump on StudentDA page
      if (document.getElementById('digitalAssignment')) {
        this.handleStudentDaAutoFlow();
      }

      const overviewTable = this.findCourseOverviewTable();

      // 1. Check for single-course assignment upload view (where student actually views/uploads files)
      const singleTable = this.findSingleCourseDaTable(overviewTable);
      if (singleTable) {
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

    async handleStudentDaAutoFlow() {
      const homeCard = window.VTOP_PLUS?.DaHomeCard;
      const target = homeCard?.getPendingTarget ? homeCard.getPendingTarget() : null;

      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (VtopApi?.autoSelectSemesterOnPage) {
        const didTrigger = await VtopApi.autoSelectSemesterOnPage({
          autoFlag: 'vtopDaAutoSem',
          targetSemesterId: target?.semesterSubId || ''
        });
        if (didTrigger) return;
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
            homeCard?.clearPendingTarget?.();
            window.VTOP_PLUS?.DOM?.simulateNativeClick?.(btn) || btn.click();
            break;
          }
        }
      }
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

      // Refresh only this course's cached status so returning to the overview table is instant
      const DOM = window.VTOP_PLUS?.DOM;
      const Storage = window.VTOP_PLUS?.Storage;
      const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
      const activeClassId =
        (document.querySelector('input#classId, input[name="classId"]')?.value || '').trim() ||
        (document.querySelector('#digitalAssignment [data-classid]')?.getAttribute('data-classid') || '').trim() ||
        this._lastActiveClassId ||
        '';
      if (activeClassId && Storage?.setWebCache) {
        let nextStatus;
        if (pendingCount === 0) {
          nextStatus = { type: 'done', text: 'All submissions done' };
        } else if (closestPending) {
          nextStatus = { type: closestPending.badgeType, text: closestPending.badgeText };
        } else {
          nextStatus = { type: 'purple', text: 'Pending assignment' };
        }
        Storage.setWebCache(`vtop_da_status_${authId || 'anon'}_${activeClassId}`, { data: nextStatus }, { area: 'session' });
      } else {
        this.clearCache();
      }
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
          cell.innerHTML = '<span class="vtop-da-badge vtop-da-badge-loading">--</span>';
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

        if (button && classId && !button.dataset.vtopDaClickTracked) {
          button.dataset.vtopDaClickTracked = '1';
          button.addEventListener('click', () => {
            this._lastActiveClassId = classId;
          });
        }

        if (!classId) {
          this.applyRowBadge(cell, { type: 'done', text: 'All submissions done' });
          return { fatal: false };
        }

        const Storage = window.VTOP_PLUS?.Storage;
        const cacheKey = `vtop_da_status_${authId || 'anon'}_${classId}`;
        const cachedStatus = Storage?.getWebCache(cacheKey, { area: 'session', ttlMs: 20 * 60 * 1000 });
        let status = cachedStatus ? cachedStatus.data : null;

        if (!status) {
          try {
            status = await this.fetchCourseStatus(classId, authId, csrf);
            if (myToken !== this._scanToken) return { fatal: true };
            if (status && status.type !== 'error') {
              Storage?.setWebCache(cacheKey, { data: status }, { area: 'session' });
            }
          } catch (err) {
            console.warn(`[VTOP++] DA check error for ${classId}:`, err);
            status = { type: 'error', text: 'Check failed' };
          }
        }

        if (myToken !== this._scanToken || !document.body.contains(row)) return { fatal: false };

        if (!status) {
          status = { type: 'error', text: 'Check failed' };
        }

        this.applyRowBadge(cell, status);
        return { fatal: Boolean(status.fatal) };
      };

      const CONCURRENCY = 3;
      let nextIdx = 0;
      let aborted = false;

      const worker = async () => {
        while (!aborted && myToken === this._scanToken) {
          const idx = nextIdx++;
          if (idx >= pendingRows.length) break;
          const res = await processRow(pendingRows[idx]);
          if (res?.fatal) {
            aborted = true;
            break;
          }
        }
      };

      try {
        const workerCount = Math.min(CONCURRENCY, pendingRows.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        if (aborted && myToken === this._scanToken) {
          for (let i = nextIdx; i < pendingRows.length; i++) {
            const cell = pendingRows[i]?.querySelector('.vtop-td-da-status');
            const badge = cell?.querySelector('.vtop-da-badge-loading');
            if (badge) {
              badge.classList.remove('vtop-da-badge-loading');
            }
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
        const res = await VtopApi.postHtml('examinations/processDigitalAssignment', extra, { queued: false });
        if (res.rateLimited) {
          console.warn('[VTOP++] VTOP rate limited DA checks (HTTP 429).');
          return { type: 'error', text: 'Rate limited', fatal: true };
        }
        if (res.expired) {
          return { type: 'error', text: 'Auth expired', fatal: true };
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
        span.className = status.fatal ? 'vtop-da-badge' : 'vtop-da-badge vtop-da-badge-loading';
        span.textContent = '--';
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
