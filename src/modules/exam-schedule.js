/**
 * VTOP++ - Exam Schedule Parser, Cache & Home Widget Exam Mode Renderer
 * Automatically swaps the Today's Schedule widget into Exam Schedule mode
 * whenever the current IST date falls within an exam block.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const WIDGET_ID = 'vtop-home-today-schedule';
  const EXAM_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  const escapeHtml = (str) => window.VTOP_PLUS.DOM.escapeHtml(str);
  const cleanText = (el) => window.VTOP_PLUS.DOM.cleanText(el);

  function getParseTimeToMinutes() {
    return window.VTOP_PLUS?.TimetableIcs?.parseTimeToMinutes;
  }

  function getFormatMinutes24() {
    return window.VTOP_PLUS?.TimetableIcs?.formatMinutes24;
  }

  function formatShortExamDate(dateKey) {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey || '';
    const monthShort = window.VTOP_PLUS?.DOM?.MONTH_SHORT || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const [, m, d] = dateKey.split('-').map((v) => parseInt(v, 10));
    return `${d} ${monthShort[m - 1] || ''}`.trim();
  }

  function diffDateKeysDays(fromKey, toKey) {
    if (!fromKey || !toKey) return 0;
    const [fy, fm, fd] = fromKey.split('-').map(Number);
    const [ty, tm, td] = toKey.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / (24 * 60 * 60 * 1000));
  }

  function parseExamTimeRange(raw) {
    if (!raw) return { startMin: null, endMin: null, label: '' };
    const parseTimeToMinutes = getParseTimeToMinutes();
    const formatMinutes24 = getFormatMinutes24();
    const parts = String(raw).split(/\s*[-–—]\s*|\s+to\s+/i);
    if (parts.length >= 2 && parseTimeToMinutes && formatMinutes24) {
      const startMin = parseTimeToMinutes(parts[0]);
      const endMin = parseTimeToMinutes(parts[1]);
      if (startMin !== null && endMin !== null) {
        return { startMin, endMin, label: `${formatMinutes24(startMin)} - ${formatMinutes24(endMin)}` };
      }
    }
    return { startMin: null, endMin: null, label: String(raw).trim() };
  }

  function parseExamScheduleFromRoot(root) {
    if (!root) return null;
    const table =
      root.querySelector('#fixedTableContainer table.customTable') ||
      root.querySelector('table.customTable') ||
      Array.from(root.querySelectorAll('table')).find((t) => {
        const txt = (t.textContent || '').toLowerCase();
        return txt.includes('exam date') && (txt.includes('seat') || txt.includes('reporting time'));
      });
    if (!table) return null;

    const colMap = {
      code: 1,
      title: 2,
      type: 3,
      classId: 4,
      slot: 5,
      date: 6,
      session: 7,
      reporting: 8,
      time: 9,
      venue: 10,
      seatLoc: 11,
      seatNo: 12
    };

    const rows = Array.from(table.querySelectorAll('tr'));
    for (const row of rows) {
      const cells = Array.from(row.children).filter((el) => el.tagName === 'TD' || el.tagName === 'TH');
      if (cells.length >= 10) {
        const labels = cells.map((c) => cleanText(c).toLowerCase());
        if (labels.some((l) => l.includes('exam date')) && labels.some((l) => l.includes('course code'))) {
          labels.forEach((lbl, idx) => {
            if (lbl.includes('course code')) colMap.code = idx;
            else if (lbl.includes('course title')) colMap.title = idx;
            else if (lbl.includes('course type')) colMap.type = idx;
            else if (lbl.includes('class id')) colMap.classId = idx;
            else if (lbl === 'slot') colMap.slot = idx;
            else if (lbl.includes('exam date')) colMap.date = idx;
            else if (lbl.includes('exam session')) colMap.session = idx;
            else if (lbl.includes('reporting')) colMap.reporting = idx;
            else if (lbl.includes('exam time')) colMap.time = idx;
            else if (lbl.includes('venue')) colMap.venue = idx;
            else if (lbl.includes('seat location')) colMap.seatLoc = idx;
            else if (lbl.includes('seat no')) colMap.seatNo = idx;
          });
          break;
        }
      }
    }

    const blockMap = new Map();
    let currentBlockName = 'Exams';
    const parseTimeToMinutes = getParseTimeToMinutes();

    for (const row of rows) {
      if (row.classList.contains('tableHeader') || row.closest('thead') || row.querySelector('th')) continue;
      const cells = Array.from(row.children).filter((el) => el.tagName === 'TD');
      if (cells.length === 0) continue;

      if (cells.length === 1) {
        const colspan = parseInt(cells[0].getAttribute('colspan') || '1', 10);
        const label = cleanText(cells[0]);
        if (colspan >= 6 && label && !/^general\s*\(/i.test(label) && !/no\s+records/i.test(label)) {
          currentBlockName = label;
        }
        continue;
      }

      if (cells.length < 10) continue;
      const dateRaw = cleanText(cells[colMap.date]);
      const dateKey = window.VTOP_PLUS?.DOM?.parseExamDateKey?.(dateRaw) || '';
      if (!dateKey) continue;

      const timeParsed = parseExamTimeRange(cleanText(cells[colMap.time]));
      const reportingTime = cleanText(cells[colMap.reporting]);
      const exam = {
        courseCode: cleanText(cells[colMap.code]),
        courseTitle: cleanText(cells[colMap.title]),
        courseType: cleanText(cells[colMap.type]),
        classId: cleanText(cells[colMap.classId]),
        slot: cleanText(cells[colMap.slot]),
        examDate: dateRaw,
        dateKey,
        examSession: cleanText(cells[colMap.session]),
        reportingTime,
        reportMin: parseTimeToMinutes ? parseTimeToMinutes(reportingTime) : null,
        examTime: cleanText(cells[colMap.time]),
        timeLabel: timeParsed.label,
        startMin: timeParsed.startMin,
        endMin: timeParsed.endMin,
        venue: cleanText(cells[colMap.venue]),
        seatLocation: cleanText(cells[colMap.seatLoc]),
        seatNo: cleanText(cells[colMap.seatNo])
      };

      if (!blockMap.has(currentBlockName)) {
        blockMap.set(currentBlockName, []);
      }
      blockMap.get(currentBlockName).push(exam);
    }

    const blocks = [];
    let totalExams = 0;
    for (const [name, exams] of blockMap.entries()) {
      exams.sort((a, b) => {
        if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
        return (a.startMin ?? 0) - (b.startMin ?? 0) || a.courseCode.localeCompare(b.courseCode);
      });
      if (exams.length > 0) {
        totalExams += exams.length;
        blocks.push({
          name,
          startDateKey: exams[0].dateKey,
          endDateKey: exams[exams.length - 1].dateKey,
          exams
        });
      }
    }

    return { blocks, totalExams };
  }

  function getActiveExamBlock(examSchedule, todayKey) {
    if (!examSchedule || !Array.isArray(examSchedule.blocks) || !todayKey) return null;
    const matches = examSchedule.blocks.filter(
      (b) => b.startDateKey && b.endDateKey && todayKey >= b.startDateKey && todayKey <= b.endDateKey
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.endDateKey.localeCompare(a.endDateKey));
    return matches[0];
  }

  const ExamSchedule = {
    EXAM_CACHE_TTL_MS,
    parseExamScheduleFromRoot,
    getActiveExamBlock,
    _examTab: 'UPCOMING',
    _cachedExamData: null,

    getExamCacheKey() {
      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      return `vtop_exam_schedule_cache_v1_${authId}`;
    },

    async readExamCache() {
      const Storage = window.VTOP_PLUS?.Storage;
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!Storage || !VtopApi) return null;
      return Storage.getScopedCache(this.getExamCacheKey(), {
        area: 'chrome',
        badgeText: VtopApi.getHomeSemesterBadgeText(),
        validate: (d) => Boolean(d.examSchedule)
      });
    },

    async writeExamCache(payload) {
      const Storage = window.VTOP_PLUS?.Storage;
      if (!Storage || !payload) return;
      this._cachedExamData = payload;
      await Storage.setScopedCache(this.getExamCacheKey(), payload, { area: 'chrome', addTimestamp: false });
    },

    async handleExamSchedulePage(VtopApi) {
      if (document.querySelector('.blockUI, .blockOverlay')) return;
      const form = document.getElementById('examSchedule');
      if (!form) return;
      const parsed = parseExamScheduleFromRoot(document);
      if (!parsed || parsed.totalExams === 0) return;

      const semSelect = form.querySelector('#semesterSubId');
      const semId = (semSelect?.value || semSelect?.dataset?.vtopLastSem || '').trim();
      const semLabel = semSelect?.selectedOptions?.[0] ? cleanText(semSelect.selectedOptions[0]) : '';
      const active = await VtopApi.resolveActiveSemesterId().catch(() => null);
      if (active?.semesterSubId && semId && active.semesterSubId !== semId) return;

      await this.writeExamCache({
        semesterSubId: semId || active?.semesterSubId || '',
        semesterLabel: semLabel || active?.label || '',
        badgeText: VtopApi.getHomeSemesterBadgeText(),
        updatedAt: Date.now(),
        examSchedule: parsed
      });
    },

    openExamSchedulePage() {
      const crawler = window.VTOP_PLUS?.Crawler;
      if (
        crawler?.navigate({
          dataUrl: 'examinations/StudExamSchedule',
          fallbackDataUrls: ['examinations/ExamSchedule', 'examinations/StudentExamSchedule'],
          title: 'Exam Schedule'
        })
      ) {
        return;
      }
      const link = document.querySelector('a[data-url*="ExamSchedule" i]');
      if (link) link.click();
    },

    async fetchActiveExamSchedule(VtopApi, active) {
      const examRes = await VtopApi.fetchSemesterData({
        pageUrl: 'examinations/StudExamSchedule',
        formSelector: '#examSchedule',
        dataUrl: 'examinations/doSearchExamScheduleForStudent',
        active,
        useSelectedOptionFallback: true
      });
      if (!examRes.ok || !examRes.html) return null;

      const examDoc = new DOMParser().parseFromString(examRes.html, 'text/html');
      const parsed = parseExamScheduleFromRoot(examDoc) || { blocks: [], totalExams: 0 };
      const payload = {
        semesterSubId: examRes.semesterSubId,
        semesterLabel: examRes.semesterLabel,
        badgeText: VtopApi.getHomeSemesterBadgeText(),
        updatedAt: Date.now(),
        examSchedule: parsed
      };
      await this.writeExamCache(payload);
      return payload;
    },

    renderExamWidgetBody(examPayload, activeBlock, setModeHeader) {
      const widget = document.getElementById(WIDGET_ID);
      if (!widget || !activeBlock) return;

      if (typeof setModeHeader === 'function') {
        setModeHeader(true, activeBlock.name);
      }

      const { dateKey: todayKey, mins: nowMins } = window.VTOP_PLUS.DOM.getIstNowParts();
      const allExams = activeBlock.exams || [];
      const upcomingExams = allExams.filter((e) => e.dateKey >= todayKey);

      if (!this._examTab || (this._examTab !== 'UPCOMING' && this._examTab !== 'ALL')) {
        this._examTab = 'UPCOMING';
      }
      const activeTab = this._examTab;
      const visibleExams = activeTab === 'UPCOMING' ? upcomingExams : allExams;

      const daysBar = document.getElementById('vtop-tt-days-bar');
      if (daysBar) {
        const rangeLabel = `${formatShortExamDate(activeBlock.startDateKey)} - ${formatShortExamDate(activeBlock.endDateKey)}`;
        daysBar.innerHTML = `
          <button type="button" class="vtop-tt-day-tab ${activeTab === 'UPCOMING' ? 'is-active' : ''}" data-exam-tab="UPCOMING">
            <span>Upcoming (${upcomingExams.length})</span>
          </button>
          <button type="button" class="vtop-tt-day-tab ${activeTab === 'ALL' ? 'is-active' : ''}" data-exam-tab="ALL">
            <span>All (${allExams.length})</span>
          </button>
          <span class="vtop-tt-exam-range-pill">${escapeHtml(rangeLabel)}</span>
        `;

        daysBar.querySelectorAll('[data-exam-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            this._examTab = btn.dataset.examTab;
            this.renderExamWidgetBody(examPayload, activeBlock, setModeHeader);
          });
        });
      }

      const body = document.getElementById('vtop-tt-body');
      if (!body) return;

      if (visibleExams.length === 0) {
        body.innerHTML = window.VTOP_PLUS?.UI?.emptyState('No upcoming exams remaining', '', 'vtop-tt-empty') || '';
        return;
      }

      let nextMarked = false;
      const listHtml = visibleExams
        .map((exam, idx) => {
          let stateCls = '';
          let statusPill = '';

          if (exam.dateKey < todayKey) {
            stateCls = 'is-done';
            statusPill = `<span class="vtop-tt-status vtop-tt-status-done">Done</span>`;
          } else if (exam.dateKey === todayKey) {
            if (exam.startMin !== null && exam.endMin !== null) {
              if (nowMins >= exam.startMin && nowMins < exam.endMin) {
                const rem = exam.endMin - nowMins;
                stateCls = 'is-live';
                statusPill = `<span class="vtop-tt-status vtop-tt-status-live">Now &middot; ${rem}m left</span>`;
              } else if (nowMins >= exam.endMin) {
                stateCls = 'is-done';
                statusPill = `<span class="vtop-tt-status vtop-tt-status-done">Done</span>`;
              } else if (exam.reportMin !== null && nowMins >= exam.reportMin) {
                stateCls = 'is-live';
                statusPill = `<span class="vtop-tt-status vtop-tt-status-live">Report Now</span>`;
              } else {
                nextMarked = true;
                const wait = exam.startMin - nowMins;
                const waitLabel = wait >= 60 ? `Today &middot; ${Math.floor(wait / 60)}h ${wait % 60}m` : `Today &middot; ${wait}m`;
                stateCls = 'is-next';
                statusPill = `<span class="vtop-tt-status vtop-tt-status-next">${waitLabel}</span>`;
              }
            } else {
              nextMarked = true;
              stateCls = 'is-next';
              statusPill = `<span class="vtop-tt-status vtop-tt-status-next">Today</span>`;
            }
          } else {
            const diffDays = diffDateKeysDays(todayKey, exam.dateKey);
            const dayTxt = diffDays === 1 ? 'Tomorrow' : `In ${diffDays}d`;
            if (!nextMarked) {
              nextMarked = true;
              stateCls = 'is-next';
              statusPill = `<span class="vtop-tt-status vtop-tt-status-next">${dayTxt}</span>`;
            } else {
              statusPill = `<span class="vtop-tt-status vtop-tt-status-done">${dayTxt}</span>`;
            }
          }

          const dateShort = exam.dateKey === todayKey ? 'Today' : formatShortExamDate(exam.dateKey);
          const seatParts = [];
          if (exam.venue) seatParts.push(exam.venue);
          if (exam.seatLocation) seatParts.push(exam.seatLocation);
          if (exam.seatNo) seatParts.push(`Seat ${exam.seatNo}`);

          return `
            <div class="vtop-tt-item ${stateCls}" data-exam-idx="${idx}">
              <div class="vtop-tt-info">
                <div class="vtop-tt-course-row">
                  <span class="vtop-tt-code">${escapeHtml(exam.courseTitle || exam.courseCode)}</span>
                  ${exam.courseCode ? `<span class="vtop-tt-type">${escapeHtml(exam.courseCode)}</span>` : ''}
                </div>
                <div class="vtop-tt-meta">
                  ${seatParts.length ? `<span class="vtop-tt-venue">${escapeHtml(seatParts.join(' · '))}</span>` : ''}
                  ${exam.reportingTime ? `<span class="vtop-tt-slot">Report ${escapeHtml(exam.reportingTime)}</span>` : ''}
                </div>
              </div>
              <div class="vtop-tt-right">
                <span class="vtop-tt-time-range">${escapeHtml(dateShort)} &middot; ${escapeHtml(exam.timeLabel || exam.examTime)}</span>
                ${statusPill}
              </div>
            </div>
          `;
        })
        .join('');

      body.innerHTML = `<div class="vtop-tt-list">${listHtml}</div>`;
    }
  };

  window.VTOP_PLUS.ExamSchedule = ExamSchedule;
})();
