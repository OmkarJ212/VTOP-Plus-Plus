// Marks Notifier: tracks current + previous registered semesters with 30m cooldown, 45s tab lock, and baseline guards.

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const HOME_CARD_ID = 'vtop-home-marks-updates';
  const TOAST_ID = 'vtop-marks-toast';

  const CHECK_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
  const PAIR_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const CROSS_TAB_LOCK_MS = 45 * 1000; // 45 seconds
  const BOOT_DELAY_MS = 2200; // Let Home critical widgets & Timetable settle first

  const escapeHtml = (str) => window.VTOP_PLUS.DOM.escapeHtml(str);
  const cleanText = (el) => window.VTOP_PLUS.DOM.cleanText(el);

  function looksLikeValidMarksHtml(html) {
    if (!html || typeof html !== 'string') return false;
    return /customTable-level1|studentMarkView|Marks?\s*View|Mark\s*Title|No\s+data|No\s+Record/i.test(html);
  }

  function serializeCourses(parsedCourses) {
    const map = {};
    for (const c of parsedCourses || []) {
      const courseKey = `${c.code}|${c.type || 'TH'}`;
      const compMap = {};
      const titleCounts = {};
      for (const comp of c.components || []) {
        const baseTitle = comp.title;
        titleCounts[baseTitle] = (titleCounts[baseTitle] || 0) + 1;
        const uniqueTitle = titleCounts[baseTitle] > 1 ? `${baseTitle} #${titleCounts[baseTitle]}` : baseTitle;
        compMap[uniqueTitle] = {
          scoredRaw: comp.scoredRaw ?? (comp.isGraded ? String(comp.scored) : ''),
          maxMark: comp.maxMark || 0,
          weightMarkRaw: comp.weightMarkRaw ?? (comp.isGraded ? String(comp.weightMark) : ''),
          weightPct: comp.weightPct || 0,
          status: comp.status || '',
          isGraded: Boolean(comp.isGraded)
        };
      }
      map[courseKey] = {
        code: c.code,
        title: c.title,
        type: c.type || '',
        components: compMap
      };
    }
    return map;
  }

  function diffSemesterSnapshots(prevCourses, nextCourses, semesterSubId, semesterLabel) {
    if (!prevCourses) return []; // First-run silent baseline
    const changes = [];
    const now = Date.now();

    for (const [courseKey, nextCourse] of Object.entries(nextCourses || {})) {
      const prevCourse = prevCourses[courseKey];
      const nextComps = nextCourse.components || {};
      const prevComps = prevCourse?.components || {};

      for (const [compTitle, nextComp] of Object.entries(nextComps)) {
        const prevComp = prevComps[compTitle];

        if (!prevComp) {
          if (nextComp.isGraded || nextComp.scoredRaw) {
            changes.push({
              id: `${semesterSubId}|${courseKey}|${compTitle}|${now}`,
              semesterSubId,
              semesterLabel,
              courseKey,
              courseCode: nextCourse.code,
              courseTitle: nextCourse.title,
              courseType: nextCourse.type,
              componentTitle: compTitle,
              changeType: 'NEW_COMPONENT',
              oldVal: '',
              newVal: nextComp.scoredRaw || nextComp.status || 'Uploaded',
              maxMark: nextComp.maxMark,
              detectedAt: now
            });
          }
          continue;
        }

        const prevScoreStr = String(prevComp.scoredRaw || '').trim();
        const nextScoreStr = String(nextComp.scoredRaw || '').trim();
        const prevWeightStr = String(prevComp.weightMarkRaw || '').trim();
        const nextWeightStr = String(nextComp.weightMarkRaw || '').trim();
        const prevStatus = String(prevComp.status || '').trim();
        const nextStatus = String(nextComp.status || '').trim();

        if (!prevComp.isGraded && nextComp.isGraded) {
          changes.push({
            id: `${semesterSubId}|${courseKey}|${compTitle}|${now}`,
            semesterSubId,
            semesterLabel,
            courseKey,
            courseCode: nextCourse.code,
            courseTitle: nextCourse.title,
            courseType: nextCourse.type,
            componentTitle: compTitle,
            changeType: 'NEW_COMPONENT',
            oldVal: prevScoreStr || prevStatus || 'Pending',
            newVal: nextScoreStr || nextStatus || 'Graded',
            maxMark: nextComp.maxMark,
            detectedAt: now
          });
        } else if (prevScoreStr !== nextScoreStr || prevWeightStr !== nextWeightStr) {
          changes.push({
            id: `${semesterSubId}|${courseKey}|${compTitle}|${now}`,
            semesterSubId,
            semesterLabel,
            courseKey,
            courseCode: nextCourse.code,
            courseTitle: nextCourse.title,
            courseType: nextCourse.type,
            componentTitle: compTitle,
            changeType: 'SCORE_UPDATED',
            oldVal: prevScoreStr || prevWeightStr || '—',
            newVal: nextScoreStr || nextWeightStr || '—',
            maxMark: nextComp.maxMark,
            detectedAt: now
          });
        } else if (prevStatus !== nextStatus && nextStatus) {
          changes.push({
            id: `${semesterSubId}|${courseKey}|${compTitle}|${now}`,
            semesterSubId,
            semesterLabel,
            courseKey,
            courseCode: nextCourse.code,
            courseTitle: nextCourse.title,
            courseType: nextCourse.type,
            componentTitle: compTitle,
            changeType: 'STATUS_CHANGED',
            oldVal: prevStatus || '—',
            newVal: nextStatus,
            maxMark: nextComp.maxMark,
            detectedAt: now
          });
        }
      }
    }

    return changes;
  }

  const MarksNotifier = {
    diffSemesterSnapshots,
    _isChecking: false,
    _bootTimer: null,
    _uiTickTimer: null,
    _pendingJump: null,
    _onMessage: null,
    _onStorageChanged: null,
    _syncPromise: null,
    _lastCapturedSig: '',

    init() {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!VtopApi?.isAuthenticated()) {
        this.destroy();
        return;
      }

      if (!this._onMessage && chrome?.runtime?.onMessage) {
        this._onMessage = (msg) => {
          if (msg?.action === 'OPEN_MARKS_PAGE') {
            this.openMarksPage(msg.semesterSubId || '');
          }
        };
        chrome.runtime.onMessage.addListener(this._onMessage);
      }

      if (!this._unsubStorage && window.VTOP_PLUS?.Storage?.onKeysChanged) {
        const key = this.getStorageKey();
        this._unsubStorage = window.VTOP_PLUS.Storage.onKeysChanged([key], (matched) => {
          if (matched[key]) {
            this.syncUiFromState(matched[key]);
          }
        });
      }

      // 1. Handle StudentMarkView page (auto-jump, passive capture, row highlights)
      if (document.getElementById('studentMarkView')) {
        this.handleMarksPage();
      } else {
        this._lastCapturedSig = '';
      }

      // 2. Render Dashboard Marks Notifier widget & sync dock badge
      this.syncUiFromState();

      if (!this._uiTickTimer) {
        this._uiTickTimer = setInterval(() => {
          if (document.getElementById(HOME_CARD_ID)) {
            this.syncUiFromState();
          }
        }, 60000);
      }

      // 3. Staggered throttled background check (respects 30m persistent cooldown)
      this.maybeScheduleCheck(BOOT_DELAY_MS);
    },

    destroy() {
      if (this._bootTimer) {
        clearTimeout(this._bootTimer);
        this._bootTimer = null;
      }
      if (this._uiTickTimer) {
        clearInterval(this._uiTickTimer);
        this._uiTickTimer = null;
      }
      if (this._onMessage && chrome?.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(this._onMessage);
        this._onMessage = null;
      }
      if (this._unsubStorage) {
        this._unsubStorage();
        this._unsubStorage = null;
      }
      document.getElementById(HOME_CARD_ID)?.remove();
      document.getElementById(TOAST_ID)?.remove();
      this.clearDockBadge();
    },

    getStorageKey() {
      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      return `vtop_marks_notifier_v1_${authId}`;
    },

    async loadState() {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      const key = this.getStorageKey();
      const stored = VtopApi ? await VtopApi.storageGet([key]) : {};
      const state = stored?.[key];
      if (state && state.authId === authId) {
        return {
          authId,
          trackedPair: Array.isArray(state.trackedPair) ? state.trackedPair : [],
          pairResolvedAt: state.pairResolvedAt || 0,
          lastCheckAt: state.lastCheckAt || 0,
          lockUntil: state.lockUntil || 0,
          semesters: state.semesters || {},
          unreadChanges: Array.isArray(state.unreadChanges) ? state.unreadChanges : []
        };
      }
      return {
        authId,
        trackedPair: [],
        pairResolvedAt: 0,
        lastCheckAt: 0,
        lockUntil: 0,
        semesters: {},
        unreadChanges: []
      };
    },

    async saveState(state) {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!VtopApi) return;
      await VtopApi.storageSet({ [this.getStorageKey()]: state });
    },

    maybeScheduleCheck(delayMs = BOOT_DELAY_MS) {
      if (this._bootTimer) clearTimeout(this._bootTimer);
      this._bootTimer = setTimeout(async () => {
        this._bootTimer = null;
        const VtopApi = window.VTOP_PLUS?.VtopApi;
        if (!VtopApi?.isAuthenticated() || (await VtopApi.isRateLimitedAsync())) return;
        const state = await this.loadState();
        if (Date.now() - (state.lastCheckAt || 0) >= CHECK_COOLDOWN_MS) {
          this.checkMarks(false);
        }
      }, delayMs);
    },

    async fetchMarksForSemester(semesterSubId, formMeta = {}) {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      const MarksPredictor = window.VTOP_PLUS?.MarksFatPredictor;
      if (!VtopApi || !MarksPredictor?.parseMarksFromRoot) {
        return { ok: false, rateLimited: false, expired: false, courses: [], serialized: null };
      }

      const res = await VtopApi.postHtml('examinations/doStudentMarkView', {
        _csrf: formMeta.csrf,
        authorizedID: formMeta.authId,
        semesterSubId
      });

      if (res.rateLimited || res.expired || !res.ok || !looksLikeValidMarksHtml(res.html)) {
        return {
          ok: false,
          rateLimited: Boolean(res.rateLimited),
          expired: Boolean(res.expired),
          courses: [],
          serialized: null
        };
      }

      const doc = new DOMParser().parseFromString(res.html, 'text/html');
      const courses = MarksPredictor.parseMarksFromRoot(doc, { includeUngraded: true });
      return {
        ok: true,
        rateLimited: false,
        expired: false,
        courses,
        serialized: serializeCourses(courses)
      };
    },

    async resolvePairViaRegisteredList(VtopApi) {
      const [active, regSems] = await Promise.all([
        VtopApi.resolveActiveSemesterId(),
        VtopApi.getRegisteredSemesters()
      ]);
      if (!active?.semesterSubId || !Array.isArray(regSems) || regSems.length === 0) {
        return null;
      }

      const idx = regSems.findIndex((s) => s.value === active.semesterSubId);
      if (idx === -1) return null;

      const pair = [{ semesterSubId: regSems[idx].value, label: regSems[idx].label || active.label }];
      if (regSems[idx + 1]) {
        pair.push({ semesterSubId: regSems[idx + 1].value, label: regSems[idx + 1].label });
      }
      return pair;
    },

    async checkMarks(force = false) {
      if (this._isChecking) return;
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!VtopApi?.isAuthenticated() || (await VtopApi.isRateLimitedAsync())) return;

      const state = await this.loadState();
      const now = Date.now();
      if (!force) {
        if (now - state.lastCheckAt < CHECK_COOLDOWN_MS) return;
        if (state.lockUntil && now < state.lockUntil) return;
      }

      this._isChecking = true;
      state.lockUntil = now + CROSS_TAB_LOCK_MS;
      await this.saveState(state);
      this.syncUiFromState(state);

      let newlyDetected = [];
      let didCompleteAny = false;
      let aborted = false;

      try {
        let pair = state.trackedPair;
        let formMeta = {};
        const fetchedMap = {};

        const needsPairResolve =
          force ||
          !Array.isArray(pair) ||
          pair.length === 0 ||
          now - (state.pairResolvedAt || 0) > PAIR_TTL_MS;

        if (needsPairResolve) {
          // Fast zero-probe path: StudentDA active semester + StudentTimeTable/Attendance registered list
          const fastPair = await this.resolvePairViaRegisteredList(VtopApi);
          if (fastPair && fastPair.length > 0) {
            pair = fastPair;
            state.trackedPair = pair;
            state.pairResolvedAt = Date.now();
          } else {
            // Fallback: fetch StudentMarkView shell & skip empty Summer/Tri terms
            const shell = await VtopApi.fetchSemesterShell({
              pageUrl: 'examinations/StudentMarkView',
              formSelector: '#studentMarkView'
            });
            if (shell.rateLimited || shell.expired || !shell.ok) {
              aborted = true;
              return;
            }

            const { options } = shell;
            formMeta = {
              csrf: shell.csrf || undefined,
              authId: shell.authId || undefined
            };

            if (options.length > 0) {
              const active = await VtopApi.resolveActiveSemesterId();
              let curIdx = active?.semesterSubId
                ? options.findIndex((o) => o.value === active.semesterSubId)
                : -1;
              if (curIdx === -1) curIdx = 0;

              const currentOpt = options[curIdx];
              const resolved = [{ semesterSubId: currentOpt.value, label: currentOpt.label }];

              const curFetched = await this.fetchMarksForSemester(currentOpt.value, formMeta);
              if (curFetched.rateLimited || curFetched.expired) {
                aborted = true;
                return;
              }
              if (curFetched.ok) fetchedMap[currentOpt.value] = curFetched;

              const maxProbe = Math.min(options.length, curIdx + 4);
              for (let i = curIdx + 1; i < maxProbe; i++) {
                const cand = options[i];
                const prevFetched = await this.fetchMarksForSemester(cand.value, formMeta);
                if (prevFetched.rateLimited || prevFetched.expired) {
                  aborted = true;
                  return;
                }
                if (prevFetched.ok && prevFetched.courses.length > 0) {
                  resolved.push({ semesterSubId: cand.value, label: cand.label });
                  fetchedMap[cand.value] = prevFetched;
                  break;
                }
              }

              pair = resolved;
              state.trackedPair = pair;
              state.pairResolvedAt = Date.now();
            }
          }
        }

        // Fetch any semester in the tracked pair not already fetched during pair resolution
        for (const sem of pair || []) {
          if (!fetchedMap[sem.semesterSubId]) {
            const res = await this.fetchMarksForSemester(sem.semesterSubId, formMeta);
            if (res.rateLimited || res.expired) {
              aborted = true;
              break;
            }
            if (res.ok) fetchedMap[sem.semesterSubId] = res;
          }
        }

        if (!aborted) {
          for (const sem of pair || []) {
            const result = fetchedMap[sem.semesterSubId];
            if (!result || !result.ok) continue;
            didCompleteAny = true;

            const prevSem = state.semesters[sem.semesterSubId];
            const diffs = diffSemesterSnapshots(
              prevSem?.courses || null,
              result.serialized,
              sem.semesterSubId,
              sem.label
            );
            if (diffs.length > 0) {
              newlyDetected = newlyDetected.concat(diffs);
            }

            state.semesters[sem.semesterSubId] = {
              label: sem.label,
              updatedAt: Date.now(),
              courses: result.serialized
            };
          }

          if (didCompleteAny) {
            state.lastCheckAt = Date.now();
          }
          if (newlyDetected.length > 0) {
            state.unreadChanges = this.mergeUnread(state.unreadChanges, newlyDetected);
          }
        }
      } catch (err) {
        console.warn('[VTOP++] Marks notifier check error:', err);
      } finally {
        state.lockUntil = 0;
        await this.saveState(state);
        this._isChecking = false;
        this.syncUiFromState(state);

        if (newlyDetected.length > 0) {
          this.showToast(newlyDetected);
          this.sendBrowserNotification(newlyDetected);
        }
      }
    },

    mergeUnread(existing, additions) {
      const byKey = new Map();
      for (const item of existing || []) {
        byKey.set(`${item.semesterSubId}|${item.courseKey}|${item.componentTitle}`, item);
      }
      for (const item of additions || []) {
        byKey.set(`${item.semesterSubId}|${item.courseKey}|${item.componentTitle}`, item);
      }
      return Array.from(byKey.values()).sort((a, b) => (b.detectedAt || 0) - (a.detectedAt || 0));
    },

    async markAllRead(semesterSubId = '') {
      const state = await this.loadState();
      if (semesterSubId) {
        state.unreadChanges = state.unreadChanges.filter((c) => c.semesterSubId !== semesterSubId);
      } else {
        state.unreadChanges = [];
      }
      await this.saveState(state);
      this.syncUiFromState(state);
      if (document.getElementById('studentMarkView')) {
        this.highlightMarksTableRows(state);
      }
    },

    openMarksPage(semesterSubId = '') {
      if (semesterSubId) {
        this._pendingJump = {
          semesterSubId,
          expiresAt: Date.now() + 15000
        };
      }

      const semSelect = document.querySelector('#studentMarkView #semesterSubId');
      if (semSelect && semesterSubId) {
        if (semSelect.value !== semesterSubId) {
          const DOM = window.VTOP_PLUS?.DOM;
          if (DOM?.waitForBlockUIClear) {
            DOM.waitForBlockUIClear().then(() => {
              if (!semSelect.isConnected) return;
              semSelect.value = semesterSubId;
              semSelect.dispatchEvent(new Event('change', { bubbles: true }));
            });
          } else {
            semSelect.value = semesterSubId;
            semSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        return;
      }

      const crawler = window.VTOP_PLUS?.Crawler;
      if (
        crawler?.navigate({
          dataUrl: 'examinations/StudentMarkView',
          fallbackDataUrls: ['examinations/StudentMarks'],
          title: 'Student Mark View'
        })
      ) {
        return;
      }
      const link = document.querySelector('a[data-url*="StudentMarkView" i]');
      if (link) link.click();
    },

    async handleMarksPage() {
      const semSelect = document.querySelector('#studentMarkView #semesterSubId');
      if (!semSelect) return;

      // 1. Auto-select target semester if jumping from a notification
      if (this._pendingJump) {
        if (Date.now() > this._pendingJump.expiresAt) {
          this._pendingJump = null;
        } else if (semSelect.value !== this._pendingJump.semesterSubId) {
          const targetId = this._pendingJump.semesterSubId;
          const opt = Array.from(semSelect.options).find((o) => o.value === targetId);
          if (opt) {
            this._pendingJump = null;
            const VtopApi = window.VTOP_PLUS?.VtopApi;
            if (
              await VtopApi?.autoSelectSemesterOnPage?.({
                formSelector: '#studentMarkView',
                targetSemesterId: targetId,
                forceWhenNonEmpty: true,
                autoFlag: ''
              })
            ) {
              return;
            }
          }
        } else {
          this._pendingJump = null;
        }
      }

      const state = await this.loadState();
      const selectedSemId = (semSelect.value || semSelect.dataset.vtopLastSem || '').trim();
      const matchedOpt = Array.from(semSelect.options || []).find((o) => o.value === selectedSemId);
      const selectedLabel = matchedOpt ? cleanText(matchedOpt) : (semSelect.dataset.vtopLastSemLabel || '');

      // 2. Passive zero-request capture (deduplicated per rendered semester table)
      const MarksPredictor = window.VTOP_PLUS?.MarksFatPredictor;
      const tableCount = document.querySelectorAll('#fixedTableContainer table.customTable-level1').length;
      const tableSig = `${selectedSemId}:${tableCount}`;
      if (selectedSemId && MarksPredictor?.parseMarksFromRoot && tableSig !== this._lastCapturedSig) {
        const parsed = MarksPredictor.parseMarksFromRoot(document, { includeUngraded: true });
        if (parsed.length > 0) {
          this._lastCapturedSig = tableSig;
          const serialized = serializeCourses(parsed);
          const prevSem = state.semesters[selectedSemId];
          const diffs = diffSemesterSnapshots(
            prevSem?.courses || null,
            serialized,
            selectedSemId,
            selectedLabel || selectedSemId
          );

          state.semesters[selectedSemId] = {
            label: selectedLabel || prevSem?.label || selectedSemId,
            updatedAt: Date.now(),
            courses: serialized
          };

          if (diffs.length > 0) {
            state.unreadChanges = this.mergeUnread(state.unreadChanges, diffs);
          }
          await this.saveState(state);

          if (diffs.length > 0) {
            this.showToast(diffs);
          }
        }
      }

      this.highlightMarksTableRows(state, selectedSemId);

      // Reset dropdown back to default "-- Choose Semester --" once marks data is collected & highlighted
      if (
        semSelect.value !== '' &&
        !document.querySelector('.blockUI, .blockOverlay') &&
        document.querySelector('#fixedTableContainer table.customTable-level1')
      ) {
        window.VTOP_PLUS?.DOM?.resetSelectToDefault?.(semSelect);
      }
    },

    highlightMarksTableRows(state, selectedSemId = '') {
      document.querySelectorAll('.vtop-marks-row-changed').forEach((el) => el.classList.remove('vtop-marks-row-changed'));
      document.querySelectorAll('.vtop-marks-diff-pill').forEach((el) => el.remove());

      const semId = selectedSemId || (document.querySelector('#studentMarkView #semesterSubId')?.value || document.querySelector('#studentMarkView #semesterSubId')?.dataset?.vtopLastSem || '').trim();
      if (!semId) return;

      const unread = (state.unreadChanges || []).filter((c) => c.semesterSubId === semId);
      if (unread.length === 0) return;

      const MarksPredictor = window.VTOP_PLUS?.MarksFatPredictor;
      if (!MarksPredictor?.parseMarksFromRoot) return;

      const parsed = MarksPredictor.parseMarksFromRoot(document, { includeUngraded: true });
      for (const course of parsed) {
        const courseKey = `${course.code}|${course.type || 'TH'}`;
        for (const comp of course.components || []) {
          const match = unread.find(
            (u) => u.courseKey === courseKey && u.componentTitle === comp.title
          );
          if (match && comp.rowElement) {
            comp.rowElement.classList.add('vtop-marks-row-changed');
            const titleCell = comp.rowElement.querySelector('td:nth-child(2)') || comp.rowElement.querySelector('td');
            if (titleCell && !titleCell.querySelector('.vtop-marks-diff-pill')) {
              const pill = document.createElement('span');
              pill.className = 'vtop-marks-diff-pill';
              pill.textContent = match.changeType === 'NEW_COMPONENT' ? 'NEW' : 'UPDATED';
              if (match.oldVal) {
                pill.title = `Previous: ${match.oldVal}`;
              }
              titleCell.appendChild(pill);
            }
          }
        }
      }
    },

    async syncUiFromState(providedState = null) {
      if (this._syncPromise && !providedState) return this._syncPromise;

      const run = async () => {
        const state = providedState || (await this.loadState());
        const unread = state.unreadChanges || [];

        this.syncDockBadge(unread.length);

        const UI = window.VTOP_PLUS?.UI;
        const rightCol = UI?.getHomeRightColumn ? UI.getHomeRightColumn() : null;

        if (!rightCol) {
          document.getElementById(HOME_CARD_ID)?.remove();
          return;
        }

        const currentSemId = state.trackedPair?.[0]?.semesterSubId || '';
        const isChecking = Boolean(this._isChecking);
        const sig = `${isChecking ? '1' : '0'}|${currentSemId}|${unread.map((u) => `${u.id}:${u.newVal}`).join('|')}`;

        const ttWidget = document.getElementById('vtop-home-today-schedule');
        let card = document.getElementById(HOME_CARD_ID);
        if (!card) {
          card = document.createElement('div');
          card.id = HOME_CARD_ID;
          card.className = 'card border-0 mb-3 vtop-marks-home-card';
          if (ttWidget) {
            ttWidget.insertAdjacentElement('afterend', card);
          } else {
            rightCol.insertAdjacentElement('afterbegin', card);
          }
        } else if (ttWidget && ttWidget.nextElementSibling !== card) {
          ttWidget.insertAdjacentElement('afterend', card);
        }

        if (card.dataset.unreadSig === sig) {
          return;
        }
        card.dataset.unreadSig = sig;

        let badgeClass = 'vtop-msg-badge vtop-msg-badge-muted';
        let badgeText = 'Up to date';
        if (unread.length > 0) {
          badgeClass = 'vtop-msg-badge vtop-msg-badge-active';
          badgeText = `${unread.length} New`;
        }

        const bodyHtml =
          unread.length > 0
            ? unread
                .map((c) => {
                  const scoreLabel = c.maxMark ? `${c.newVal}/${c.maxMark}` : c.newVal;
                  const prevNote = c.oldVal && c.changeType === 'SCORE_UPDATED' ? ` (was ${c.oldVal})` : '';
                  const showSem = currentSemId && c.semesterSubId && c.semesterSubId !== currentSemId;
                  return `
                    <button type="button" class="vtop-marks-home-item" data-sem-id="${escapeHtml(c.semesterSubId)}">
                      <div class="vtop-marks-home-item-top">
                        <span class="vtop-marks-home-code">${escapeHtml(c.courseTitle || c.courseCode)}</span>
                        <span class="vtop-marks-diff-pill">${c.changeType === 'NEW_COMPONENT' ? 'NEW' : 'UPDATED'}</span>
                        <span class="vtop-marks-home-score">${escapeHtml(scoreLabel)}${escapeHtml(prevNote)}</span>
                      </div>
                      <div class="vtop-marks-home-sub">
                        <span>${escapeHtml(c.componentTitle)}</span>
                        ${showSem ? `<span>&middot;</span><span>${escapeHtml(c.semesterLabel || c.semesterSubId)}</span>` : ''}
                      </div>
                    </button>
                  `;
                })
                .join('')
            : UI?.emptyState
              ? UI.emptyState('No new marks updates')
              : '';

        card.innerHTML = `
          <div class="card-header d-flex primaryBorderTop vtop-marks-home-header">
            <div class="vtop-tt-title-wrap">
              <span class="fs-6 fontcolor3 fw-bold">Marks Notifier</span>
              <span class="${badgeClass}">${escapeHtml(badgeText)}</span>
            </div>
            <div class="vtop-tt-header-actions">
              ${
                unread.length > 0
                  ? `<button type="button" class="vtop-msg-icon-btn" id="vtop-marks-home-dismiss" title="Mark all as read" aria-label="Mark all as read">
                      ${UI?.icon('check', 14) || ''}
                    </button>`
                  : ''
              }
              <button type="button" class="vtop-msg-icon-btn ${isChecking ? 'vtop-msg-spinning' : ''}" id="vtop-marks-check-now" title="Refresh Marks" aria-label="Refresh Marks" ${isChecking ? 'disabled' : ''}>
                ${UI?.icon('refresh', 14) || ''}
              </button>
              <button type="button" class="vtop-msg-icon-btn" id="vtop-marks-open-btn" title="Open Marks Page" aria-label="Open Marks Page">
                ${UI?.icon('external-link', 14) || ''}
              </button>
            </div>
          </div>
          <div class="card-body vtop-marks-home-body">
            ${bodyHtml}
          </div>
        `;

        card.querySelector('#vtop-marks-home-dismiss')?.addEventListener('click', () => {
          this.markAllRead('');
        });

        card.querySelector('#vtop-marks-check-now')?.addEventListener('click', () => {
          this.checkMarks(true);
        });

        card.querySelector('#vtop-marks-open-btn')?.addEventListener('click', () => {
          this.openMarksPage('');
        });

        card.querySelectorAll('.vtop-marks-home-item').forEach((btn) => {
          btn.addEventListener('click', () => {
            this.openMarksPage(btn.dataset.semId || '');
          });
        });
      };

      this._syncPromise = run().finally(() => {
        this._syncPromise = null;
      });
      return this._syncPromise;
    },

    syncDockBadge(count) {
      const pills = document.querySelectorAll('#vtop-header .vtop-dock-pill, #vtop-plus-quick-dock .vtop-dock-pill');
      for (const pill of pills) {
        const labelText = (pill.querySelector('.vtop-pill-text')?.textContent || pill.textContent || '').trim();
        if (!/marks\s*&\s*grades/i.test(labelText)) continue;

        let badge = pill.querySelector('.vtop-dock-unread-badge');
        if (count <= 0) {
          if (badge) badge.remove();
          continue;
        }
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'vtop-dock-unread-badge';
          pill.appendChild(badge);
        }
        badge.textContent = count > 9 ? '9+' : String(count);
      }
    },

    clearDockBadge() {
      document.querySelectorAll('.vtop-dock-unread-badge').forEach((el) => el.remove());
    },

    showToast(changes) {
      if (!Array.isArray(changes) || changes.length === 0) return;
      document.getElementById(TOAST_ID)?.remove();

      const first = changes[0];
      const firstName = first.courseTitle || first.courseCode;
      const title =
        changes.length === 1
          ? `${firstName} • ${first.componentTitle}`
          : `${changes.length} Marks Updated`;
      const detail =
        changes.length === 1
          ? `Score: ${first.newVal}${first.maxMark ? `/${first.maxMark}` : ''} (${first.semesterLabel || first.semesterSubId})`
          : `${firstName} ${first.componentTitle} & ${changes.length - 1} more`;

      const toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.className = 'vtop-plus-card vtop-marks-toast';
      toast.innerHTML = `
        <div class="vtop-marks-toast-copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
        <div class="vtop-marks-toast-actions">
          <button type="button" class="vtop-tt-btn vtop-tt-btn-primary" id="vtop-marks-toast-open">View</button>
          <button type="button" class="vtop-msg-icon-btn" id="vtop-marks-toast-close" aria-label="Dismiss">&times;</button>
        </div>
      `;

      document.body.appendChild(toast);

      const dismiss = () => toast.remove();
      toast.querySelector('#vtop-marks-toast-close')?.addEventListener('click', dismiss);
      toast.querySelector('#vtop-marks-toast-open')?.addEventListener('click', () => {
        dismiss();
        this.openMarksPage(first.semesterSubId);
      });

      setTimeout(() => {
        if (toast.isConnected) toast.remove();
      }, 12000);
    },

    sendBrowserNotification(changes) {
      if (!chrome?.runtime?.sendMessage || !Array.isArray(changes) || changes.length === 0) return;
      const first = changes[0];
      const firstName = first.courseTitle || first.courseCode;
      const title =
        changes.length === 1
          ? `Marks Updated: ${firstName}`
          : `${changes.length} Marks Updated`;
      const message =
        changes.length === 1
          ? `${first.componentTitle}: ${first.newVal}${first.maxMark ? `/${first.maxMark}` : ''} (${first.semesterLabel || first.semesterSubId})`
          : `${firstName} (${first.componentTitle}) and ${changes.length - 1} more update(s).`;

      try {
        chrome.runtime.sendMessage(
          {
            action: 'NOTIFY_MARKS_UPDATE',
            title,
            message,
            semesterSubId: first.semesterSubId
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      } catch (_) {}
    }
  };

  window.VTOP_PLUS.MarksNotifier = MarksNotifier;
})();
