/**
 * VTOP++ - Today's Schedule Home Widget & Timetable/Attendance Page Hooks
 * Coordinates between TimetableIcs (classes + .ics export) and ExamSchedule (exam mode).
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const WIDGET_ID = 'vtop-home-today-schedule';
  const PAGE_BAR_ID = 'vtop-tt-page-toolbar';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (timetable rarely changes)

  const escapeHtml = (str) => window.VTOP_PLUS.DOM.escapeHtml(str);
  const cleanText = (el) => window.VTOP_PLUS.DOM.cleanText(el);

  const TimetableWidget = {
    parseTimeTableFromRoot(root) {
      return window.VTOP_PLUS?.TimetableIcs?.parseTimeTableFromRoot(root) || null;
    },
    parseExamScheduleFromRoot(root) {
      return window.VTOP_PLUS?.ExamSchedule?.parseExamScheduleFromRoot(root) || null;
    },
    getActiveExamBlock(examSchedule, todayKey) {
      return window.VTOP_PLUS?.ExamSchedule?.getActiveExamBlock(examSchedule, todayKey) || null;
    },
    generateIcsContent(timetable, options) {
      return window.VTOP_PLUS?.TimetableIcs?.generateIcsContent(timetable, options) || '';
    },
    _isFetching: false,
    _selectedDay: null,
    _isExamMode: false,
    _liveTickTimer: null,
    _cachedData: null,

    init({ showHomeWidget = true } = {}) {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!VtopApi?.isAuthenticated()) {
        this.destroy();
        return;
      }
      window.VTOP_PLUS?.TimetableIcs?.loadReminderPreference?.();

      if (document.getElementById('studentTimeTable')) {
        this.handleTimetablePage();
      }
      if (document.getElementById('viewStudentAttendance')) {
        this.handleAttendancePage(VtopApi);
      }
      if (document.getElementById('examSchedule')) {
        window.VTOP_PLUS?.ExamSchedule?.handleExamSchedulePage?.(VtopApi);
      }

      const rightCol = showHomeWidget ? window.VTOP_PLUS?.UI?.getHomeRightColumn?.() || null : null;
      if (rightCol) {
        this.mountHomeWidget(rightCol);
      } else {
        this.destroyHomeWidget();
      }
    },

    destroy() {
      this.destroyHomeWidget();
      document.getElementById(PAGE_BAR_ID)?.remove();
      const modalId = window.VTOP_PLUS?.TimetableIcs?.MODAL_ID || 'vtop-tt-export-modal';
      document.getElementById(modalId)?.remove();
    },

    destroyHomeWidget() {
      if (this._liveTickTimer) {
        clearInterval(this._liveTickTimer);
        this._liveTickTimer = null;
      }
      document.getElementById(WIDGET_ID)?.remove();
    },

    getCacheKey() {
      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      return `vtop_timetable_cache_v1_${authId}`;
    },

    async readCache() {
      const Storage = window.VTOP_PLUS?.Storage;
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!Storage || !VtopApi) return null;
      return Storage.getScopedCache(this.getCacheKey(), {
        area: 'chrome',
        badgeText: VtopApi.getHomeSemesterBadgeText(),
        validate: (d) => Boolean(d.timetable)
      });
    },

    async writeCache(payload) {
      const Storage = window.VTOP_PLUS?.Storage;
      if (!Storage || !payload) return;
      this._cachedData = payload;
      await Storage.setScopedCache(this.getCacheKey(), payload, { area: 'chrome', addTimestamp: false });
    },

    handleAttendancePage(VtopApi) {
      const semSelect = document.querySelector('#viewStudentAttendance #semesterSubId');
      if (!semSelect) return;

      const attOpts = VtopApi.extractSelectOptions(document, 'semesterSubId');
      if (attOpts.length > 0) {
        VtopApi.saveRegisteredSemesters(attOpts);
      }

      if (!semSelect.dataset.vtopAttChangeBound) {
        semSelect.dataset.vtopAttChangeBound = '1';
        semSelect.addEventListener('change', () => {
          const tbl = document.querySelector('#viewStudentAttendance ~ #loadMyFragment table, #loadMyFragment table');
          if (tbl) delete tbl.dataset.vtopAttResetDone;
        });
      }

      if (document.querySelector('.blockUI, .blockOverlay')) return;
      const attTable = document.querySelector('#AttendanceDetailDataTable, #loadMyFragment table');
      if (attTable && !attTable.dataset.vtopAttResetDone && semSelect.value !== '') {
        attTable.dataset.vtopAttResetDone = '1';
        window.VTOP_PLUS?.DOM?.resetSelectToDefault?.(semSelect);
      }
    },

    async handleTimetablePage() {
      const semSelect = document.getElementById('semesterSubId');
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      const Ics = window.VTOP_PLUS?.TimetableIcs;
      if (!semSelect || !VtopApi || !Ics) return;

      const options = Array.from(semSelect.options)
        .map((o) => ({ value: o.value.trim(), label: cleanText(o) }))
        .filter((o) => o.value);
      if (options.length > 0) {
        VtopApi.saveRegisteredSemesters(options);
      }

      if (!semSelect.dataset.vtopTtChangeBound) {
        semSelect.dataset.vtopTtChangeBound = '1';
        semSelect.addEventListener('change', () => {
          const existingGrid = document.getElementById('timeTableStyle');
          if (existingGrid) delete existingGrid.dataset.vtopTtCollected;
        });
      }

      // Auto-select active semester (resolved from StudentDA first option) once if empty
      if (
        await VtopApi.autoSelectSemesterOnPage({
          autoFlag: 'vtopTtAutoSem',
          resolveActive: true,
          saveRegistered: true
        })
      ) {
        return;
      }

      // If #timeTableStyle is currently rendered, parse, cache, inject toolbar, then reset dropdown
      if (document.querySelector('.blockUI, .blockOverlay')) return;
      const grid = document.getElementById('timeTableStyle');
      const fragment = document.getElementById('loadMyFragment');
      if (!grid || !fragment) return;

      const semId = (semSelect.value || semSelect.dataset.vtopLastSem || '').trim();
      const matchedOpt = options.find((o) => o.value === semId);
      const semLabel = matchedOpt?.label || semSelect.dataset.vtopLastSemLabel || '';

      if (!grid.dataset.vtopTtCollected) {
        const parsed = Ics.parseTimeTableFromRoot(document);
        if (!parsed) return;
        grid.dataset.vtopTtCollected = semId || '1';

        // Passively cache if it matches active semester (or if cache is empty)
        const active = await VtopApi.resolveActiveSemesterId().catch(() => null);
        if (!active || active.semesterSubId === semId) {
          await this.writeCache({
            semesterSubId: semId,
            semesterLabel: semLabel,
            badgeText: VtopApi.getHomeSemesterBadgeText(),
            updatedAt: Date.now(),
            timetable: parsed
          });
        }

        this.mountTimetablePageToolbar(fragment, parsed, semId, semLabel);
      }

      if (semSelect.value !== '') {
        window.VTOP_PLUS?.DOM?.resetSelectToDefault?.(semSelect);
      }
    },

    mountTimetablePageToolbar(fragment, parsed, semId, semLabel) {
      let bar = document.getElementById(PAGE_BAR_ID);
      if (bar && bar.dataset.semId === semId && fragment.contains(bar)) return;
      if (bar) bar.remove();

      bar = document.createElement('div');
      bar.id = PAGE_BAR_ID;
      bar.dataset.semId = semId;
      bar.className = 'vtop-plus-card vtop-tt-page-bar';
      bar.innerHTML = `
        <div class="vtop-tt-page-bar-info">
          ${window.VTOP_PLUS?.UI?.icon('calendar', 16, { ariaHidden: true }) || ''}
          <span><strong>${escapeHtml(semLabel || semId)}</strong> &middot; ${parsed.totalClasses} classes</span>
        </div>
        <div class="vtop-tt-page-bar-actions">
          <button type="button" class="vtop-tt-btn vtop-tt-btn-primary" data-tt-action="export-modal">
            Export .ics
          </button>
        </div>
      `;

      const exportBtn = bar.querySelector('[data-tt-action="export-modal"]');
      exportBtn?.addEventListener('click', () => {
        if (!parsed.totalClasses) {
          exportBtn.textContent = 'No classes found';
          setTimeout(() => { exportBtn.textContent = 'Export .ics'; }, 2000);
          return;
        }
        window.VTOP_PLUS?.TimetableIcs?.openExportModal(parsed, semId, semLabel);
      });

      fragment.insertAdjacentElement('afterbegin', bar);
    },

    mountHomeWidget(rightCol) {
      let card = document.getElementById(WIDGET_ID);
      const firstAnchor = rightCol.firstElementChild;

      if (card) {
        if (firstAnchor && firstAnchor !== card) {
          rightCol.insertAdjacentElement('afterbegin', card);
        }
        return;
      }

      const UI = window.VTOP_PLUS?.UI;
      card = UI
        ? UI.createHomeCard({
            id: WIDGET_ID,
            className: 'card border-0 mb-3 vtop-tt-widget',
            headerClass: 'card-header d-flex primaryBorderTop vtop-tt-header',
            headerHtml: `
              <div class="vtop-tt-title-wrap">
                <span class="fs-6 fontcolor3 fw-bold vtop-tt-title">Today's Schedule</span>
              </div>
              <div class="vtop-tt-header-actions">
                <button type="button" class="vtop-msg-icon-btn" id="vtop-tt-export-btn" title="Export .ics / Google Calendar" aria-label="Export Timetable">
                  ${UI.icon('calendar', 14)}
                </button>
                <button type="button" class="vtop-msg-icon-btn" id="vtop-tt-refresh-btn" title="Refresh Timetable" aria-label="Refresh Timetable">
                  ${UI.icon('refresh', 14)}
                </button>
                <button type="button" class="vtop-msg-icon-btn" id="vtop-tt-open-btn" title="Open Full Timetable" aria-label="Open Full Timetable">
                  ${UI.icon('external-link', 14)}
                </button>
              </div>
            `,
            subBarHtml: '<div class="vtop-tt-days-bar" id="vtop-tt-days-bar"></div>',
            bodyClass: 'card-body vtop-tt-body',
            bodyId: 'vtop-tt-body',
            bodyHtml: '<div class="vtop-tt-state">Loading schedule...</div>'
          })
        : document.createElement('div');

      rightCol.insertAdjacentElement('afterbegin', card);

      card.querySelector('#vtop-tt-refresh-btn')?.addEventListener('click', () => {
        this.loadHomeSchedule(true);
      });
      card.querySelector('#vtop-tt-open-btn')?.addEventListener('click', () => {
        if (this._isExamMode) {
          window.VTOP_PLUS?.ExamSchedule?.openExamSchedulePage();
        } else {
          this.openFullTimetablePage();
        }
      });
      card.querySelector('#vtop-tt-export-btn')?.addEventListener('click', () => {
        if (this._isExamMode) return;
        if (this._cachedData?.timetable) {
          window.VTOP_PLUS?.TimetableIcs?.openExportModal(
            this._cachedData.timetable,
            this._cachedData.semesterSubId,
            this._cachedData.semesterLabel
          );
        } else {
          this.openFullTimetablePage();
        }
      });

      this.loadHomeSchedule(false);

      if (this._liveTickTimer) clearInterval(this._liveTickTimer);
      this._liveTickTimer = setInterval(() => {
        if (!document.getElementById(WIDGET_ID)) return;
        const { dateKey: todayKey } = window.VTOP_PLUS.DOM.getIstNowParts();
        const Exam = window.VTOP_PLUS?.ExamSchedule;
        const activeExamBlock = Exam?.getActiveExamBlock(Exam._cachedExamData?.examSchedule, todayKey);
        if (activeExamBlock) {
          Exam.renderExamWidgetBody(Exam._cachedExamData, activeExamBlock, (isExam, name) =>
            this.setWidgetModeHeader(isExam, name)
          );
        } else if (this._cachedData) {
          this.renderWidgetBody(this._cachedData);
        } else if (this._isExamMode) {
          this.loadHomeSchedule(false);
        }
      }, 60000);
    },

    openFullTimetablePage() {
      const crawler = window.VTOP_PLUS?.Crawler;
      if (
        crawler?.navigate({
          dataUrl: 'academics/common/StudentTimeTable',
          fallbackDataUrls: ['academics/common/TimeTable', 'academics/common/StudentTimetable'],
          title: 'Class Time Table'
        })
      ) {
        return;
      }
      const link = document.querySelector('a[data-url*="StudentTimeTable" i]');
      if (link) link.click();
    },

    async loadHomeSchedule(forceRefresh = false) {
      if (this._isFetching) return;
      const widget = document.getElementById(WIDGET_ID);
      if (!widget) return;

      const Exam = window.VTOP_PLUS?.ExamSchedule;
      const Ics = window.VTOP_PLUS?.TimetableIcs;
      const badge = window.VTOP_PLUS?.VtopApi?.getHomeSemesterBadgeText?.() || '';
      const { dateKey: todayKey } = window.VTOP_PLUS.DOM.getIstNowParts();

      let examPayload = null;
      let ttPayload = null;

      if (!forceRefresh) {
        const memExam = Exam?._cachedExamData;
        if (
          memExam &&
          memExam.examSchedule &&
          (!badge || !memExam.badgeText || memExam.badgeText === badge) &&
          Date.now() - (memExam.updatedAt || 0) < (Exam?.EXAM_CACHE_TTL_MS || 0)
        ) {
          examPayload = memExam;
        } else if (Exam) {
          const diskExam = await Exam.readExamCache();
          if (diskExam) {
            Exam._cachedExamData = diskExam;
            examPayload = diskExam;
          }
        }

        const memTt = this._cachedData;
        if (
          memTt &&
          memTt.timetable &&
          (!badge || !memTt.badgeText || memTt.badgeText === badge) &&
          Date.now() - (memTt.updatedAt || 0) < CACHE_TTL_MS
        ) {
          ttPayload = memTt;
        } else {
          const diskTt = await this.readCache();
          if (diskTt) {
            this._cachedData = diskTt;
            ttPayload = diskTt;
          }
        }

        const activeCachedExam = Exam?.getActiveExamBlock(examPayload?.examSchedule, todayKey);
        if (activeCachedExam) {
          Exam.renderExamWidgetBody(examPayload, activeCachedExam, (isExam, name) =>
            this.setWidgetModeHeader(isExam, name)
          );
          if (Date.now() - (examPayload.updatedAt || 0) < Exam.EXAM_CACHE_TTL_MS) {
            return;
          }
        } else if (ttPayload) {
          this.renderWidgetBody(ttPayload);
          const examFresh = examPayload && Exam && Date.now() - (examPayload.updatedAt || 0) < Exam.EXAM_CACHE_TTL_MS;
          const ttFresh = Date.now() - (ttPayload.updatedAt || 0) < CACHE_TTL_MS;
          if (examFresh && ttFresh) {
            return;
          }
        }
      }

      this._isFetching = true;
      const refreshBtn = document.getElementById('vtop-tt-refresh-btn');
      if (refreshBtn) refreshBtn.classList.add('vtop-msg-spinning');

      try {
        const VtopApi = window.VTOP_PLUS?.VtopApi;
        if (!VtopApi) return;

        // Step 1: Resolve authoritative current semester (from StudentDA first option)
        const active = await VtopApi.resolveActiveSemesterId({ forceRefresh });

        // Step 2: Fetch & cache exam schedule if forcing refresh, missing, or stale
        if (Exam) {
          const examNeedsFetch =
            forceRefresh ||
            !examPayload ||
            Date.now() - (examPayload.updatedAt || 0) >= Exam.EXAM_CACHE_TTL_MS;

          if (examNeedsFetch) {
            const fetchedExam = await Exam.fetchActiveExamSchedule(VtopApi, active).catch((err) => {
              console.warn('[VTOP++] Exam schedule fetch error:', err);
              return null;
            });
            if (fetchedExam) {
              examPayload = fetchedExam;
            }
          }

          const activeBlock = Exam.getActiveExamBlock(examPayload?.examSchedule, todayKey);
          if (activeBlock) {
            Exam.renderExamWidgetBody(examPayload, activeBlock, (isExam, name) =>
              this.setWidgetModeHeader(isExam, name)
            );
            return;
          }
        }

        // Step 3: Outside exam range — ensure timetable is loaded and render daily classes
        const ttNeedsFetch =
          forceRefresh ||
          !ttPayload ||
          Date.now() - (ttPayload.updatedAt || 0) >= CACHE_TTL_MS;

        if (!ttNeedsFetch && ttPayload) {
          this.renderWidgetBody(ttPayload);
          return;
        }

        const ttRes = await VtopApi.fetchSemesterData({
          pageUrl: 'academics/common/StudentTimeTable',
          formSelector: '#studentTimeTable',
          dataUrl: 'processViewTimeTable',
          active,
          saveRegistered: true,
          extraParams: { x: new Date().toUTCString() }
        });
        if (!ttRes.ok || !ttRes.html) {
          if (!this._cachedData) this.renderError('Schedule unavailable.');
          return;
        }

        const ttDoc = new DOMParser().parseFromString(ttRes.html, 'text/html');
        const parsed = Ics?.parseTimeTableFromRoot(ttDoc);
        if (!parsed) {
          if (!this._cachedData) this.renderError('No classes scheduled.');
          return;
        }

        const payload = {
          semesterSubId: ttRes.semesterSubId,
          semesterLabel: ttRes.semesterLabel,
          badgeText: VtopApi.getHomeSemesterBadgeText(),
          updatedAt: Date.now(),
          timetable: parsed
        };
        await this.writeCache(payload);
        this.renderWidgetBody(payload);
      } catch (err) {
        console.warn('[VTOP++] Timetable fetch error:', err);
        if (!this._cachedData && !this._isExamMode) this.renderError('Schedule unavailable.');
      } finally {
        this._isFetching = false;
        document.getElementById('vtop-tt-refresh-btn')?.classList.remove('vtop-msg-spinning');
      }
    },

    setWidgetModeHeader(isExam, blockName = '') {
      this._isExamMode = Boolean(isExam);
      const widget = document.getElementById(WIDGET_ID);
      if (!widget) return;

      const titleEl = widget.querySelector('.vtop-tt-title');
      if (titleEl) {
        titleEl.textContent = isExam ? `Exam Schedule · ${blockName}` : "Today's Schedule";
      }

      const exportBtn = document.getElementById('vtop-tt-export-btn');
      if (exportBtn) {
        exportBtn.style.display = isExam ? 'none' : '';
      }

      const openBtn = document.getElementById('vtop-tt-open-btn');
      if (openBtn) {
        const label = isExam ? 'Open Full Exam Schedule' : 'Open Full Timetable';
        openBtn.title = label;
        openBtn.setAttribute('aria-label', label);
      }

      const refreshBtn = document.getElementById('vtop-tt-refresh-btn');
      if (refreshBtn) {
        const label = isExam ? 'Refresh Exam Schedule' : 'Refresh Timetable';
        refreshBtn.title = label;
        refreshBtn.setAttribute('aria-label', label);
      }
    },

    renderError(msg) {
      const body = document.getElementById('vtop-tt-body');
      if (body) {
        body.innerHTML = `<div class="vtop-tt-state">${escapeHtml(msg)}</div>`;
      }
    },

    renderWidgetBody(payload) {
      const widget = document.getElementById(WIDGET_ID);
      const Ics = window.VTOP_PLUS?.TimetableIcs;
      if (!widget || !Ics) return;

      this.setWidgetModeHeader(false);

      const { DAY_ORDER, DAY_SHORT, formatMinutes24 } = Ics;
      const { dayKey: todayKey, mins: nowMins } = window.VTOP_PLUS.DOM.getIstNowParts(DAY_ORDER);
      if (!this._selectedDay) {
        const hasToday = (payload.timetable.mergedSlotsByDay[todayKey] || []).length > 0;
        this._selectedDay = hasToday ? todayKey : 'MON';
      }

      const activeDay = this._selectedDay;
      const classes = payload.timetable.mergedSlotsByDay[activeDay] || [];

      const daysBar = document.getElementById('vtop-tt-days-bar');
      if (daysBar) {
        const visibleDays = DAY_ORDER.filter(
          (d) => d !== 'SUN' || (payload.timetable.mergedSlotsByDay.SUN || []).length > 0
        );
        daysBar.innerHTML = visibleDays
          .map((d) => {
            const isToday = d === todayKey;
            const isActive = d === activeDay;
            return `
              <button type="button" class="vtop-tt-day-tab ${isActive ? 'is-active' : ''} ${isToday ? 'is-today' : ''}" data-tt-day="${d}">
                <span>${DAY_SHORT[d]}</span>
              </button>
            `;
          })
          .join('');

        daysBar.querySelectorAll('.vtop-tt-day-tab').forEach((btn) => {
          btn.addEventListener('click', () => {
            this._selectedDay = btn.dataset.ttDay;
            this.renderWidgetBody(payload);
          });
        });
      }

      const body = document.getElementById('vtop-tt-body');
      if (!body) return;

      if (classes.length === 0) {
        body.innerHTML = window.VTOP_PLUS?.UI?.emptyState(`No classes on ${DAY_SHORT[activeDay]}`, '', 'vtop-tt-empty') || '';
        return;
      }

      let nextMarked = false;
      const listHtml = classes
        .map((item, idx) => {
          let stateCls = '';
          let statusPill = '';

          if (activeDay === todayKey) {
            if (nowMins >= item.startMin && nowMins < item.endMin) {
              const rem = item.endMin - nowMins;
              stateCls = 'is-live';
              statusPill = `<span class="vtop-tt-status vtop-tt-status-live">Now &middot; ${rem}m left</span>`;
            } else if (nowMins >= item.endMin) {
              stateCls = 'is-done';
              statusPill = `<span class="vtop-tt-status vtop-tt-status-done">Done</span>`;
            } else if (!nextMarked) {
              nextMarked = true;
              const wait = item.startMin - nowMins;
              const waitLabel = wait >= 60 ? `In ${Math.floor(wait / 60)}h ${wait % 60}m` : `In ${wait}m`;
              stateCls = 'is-next';
              statusPill = `<span class="vtop-tt-status vtop-tt-status-next">${waitLabel}</span>`;
            }
          }

          return `
            <div class="vtop-tt-item ${stateCls}" data-tt-idx="${idx}">
              <div class="vtop-tt-info">
                <div class="vtop-tt-course-row">
                  <span class="vtop-tt-code">${escapeHtml(item.title || item.code)}</span>
                  <span class="vtop-tt-type">${escapeHtml(item.type)}</span>
                </div>
                <div class="vtop-tt-meta">
                  ${item.venue ? `<span class="vtop-tt-venue">${escapeHtml(item.venue)}</span>` : ''}
                  ${item.slot ? `<span class="vtop-tt-slot">${escapeHtml(item.slot)}</span>` : ''}
                </div>
              </div>
              <div class="vtop-tt-right">
                <span class="vtop-tt-time-range">${formatMinutes24(item.startMin)} - ${formatMinutes24(item.endMin)}</span>
                ${statusPill}
              </div>
            </div>
          `;
        })
        .join('');

      body.innerHTML = `<div class="vtop-tt-list">${listHtml}</div>`;
    }
  };

  window.VTOP_PLUS.TimetableCalendar = TimetableWidget;
})();
