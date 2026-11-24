/**
 * VTOP++ - Marks Summary & Potential CGPA Calculator Module
 * 1. Displays total marks achieved till now for every course on Marks & Grade.
 * 2. Auto-captures CGPA & current credits from Grade History (CGPA Details).
 * 3. Provides a live Potential CGPA Calculator at the top of Marks & Grade.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const REGEX_COURSE_CODE = /\b([A-Z]{3,4}\d{3,4}[A-Z]?)\b/;
  const STORAGE_BASELINE_KEY = 'vtop_cgpa_baseline';
  const SESSION_CALC_KEY = 'vtop_cgpa_calc_state_v1';
  const CALC_ID = 'vtop-cgpa-calculator';

  const GRADE_OPTIONS = [
    { label: 'S', grade: 'S', points: 10 },
    { label: 'A', grade: 'A', points: 9 },
    { label: 'B', grade: 'B', points: 8 },
    { label: 'C', grade: 'C', points: 7 },
    { label: 'D', grade: 'D', points: 6 },
    { label: 'E', grade: 'E', points: 5 },
    { label: 'F', grade: 'F', points: 0 },
    { label: 'N', grade: 'N', points: 0 }
  ];

  const GRADE_POINTS_MAP = Object.fromEntries(GRADE_OPTIONS.map((g) => [g.grade, g.points]));

  let cachedBaseline = null;
  let calcState = loadSessionCalcState();

  function loadSessionCalcState() {
    try {
      const raw = sessionStorage.getItem(SESSION_CALC_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.subjects) && parsed.subjects.length > 0) {
          return {
            isOpen: Boolean(parsed.isOpen),
            cgpa: parsed.cgpa ?? '',
            credits: parsed.credits ?? '',
            manualBaseline: Boolean(parsed.manualBaseline),
            subjects: parsed.subjects.map((s) => ({
              credits: s.credits ?? '',
              grade: GRADE_POINTS_MAP[s.grade] !== undefined ? s.grade : 'S'
            }))
          };
        }
      }
    } catch (_) {}
    return {
      isOpen: false,
      cgpa: '',
      credits: '',
      manualBaseline: false,
      subjects: [{ credits: '', grade: 'S' }]
    };
  }

  function saveSessionCalcState() {
    try {
      sessionStorage.setItem(SESSION_CALC_KEY, JSON.stringify(calcState));
    } catch (_) {}
  }

  const escapeHtml = (str) => window.VTOP_PLUS.DOM.escapeHtml(str);

  const MarksFatPredictor = {
    courses: [],

    init() {
      this.captureGradeHistory();
      this.checkAndMountCgpaCalculator();
      this.checkAndSummarizeMarks();
    },

    destroy() {
      const calc = document.getElementById(CALC_ID);
      if (calc) calc.remove();
      document.querySelectorAll('.vtop-fat-inline-tfoot').forEach((el) => el.remove());
    },

    /**
     * Parses CGPA & current credits from a Grade History document/fragment ("CGPA Details" table).
     */
    parseGradeHistoryFromRoot(root) {
      if (!root || !root.querySelectorAll) return null;
      const gradeForm = root.getElementById ? root.getElementById('studentGradeView') : root.querySelector('#studentGradeView');
      const scope = gradeForm || root;

      const candidateTables = Array.from(scope.querySelectorAll('.box table, table.table'));
      let cgpaTable = null;
      let colMap = null;

      for (const tbl of candidateTables) {
        const headRow = tbl.querySelector('thead tr') || tbl.querySelector('tr');
        if (!headRow) continue;
        const cells = Array.from(headRow.querySelectorAll('td, th')).map((c) =>
          (c.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
        );
        const cgpaIdx = cells.findIndex((t) => t === 'cgpa' || t.includes('cgpa'));
        const regIdx = cells.findIndex((t) => t.includes('credits registered'));
        const earnedIdx = cells.findIndex((t) => t.includes('credits earned'));

        if (cgpaIdx !== -1 && (regIdx !== -1 || earnedIdx !== -1)) {
          cgpaTable = tbl;
          colMap = { cgpaIdx, regIdx, earnedIdx };
          break;
        }
      }

      if (!cgpaTable || !colMap) return null;

      const bodyRow = cgpaTable.querySelector('tbody tr') || cgpaTable.querySelectorAll('tr')[1];
      if (!bodyRow) return null;

      const cells = Array.from(bodyRow.querySelectorAll('td, th'));
      const cgpa = parseFloat((cells[colMap.cgpaIdx]?.textContent || '').replace(/[^0-9.]/g, ''));
      const creditsRegistered =
        colMap.regIdx !== -1
          ? parseFloat((cells[colMap.regIdx]?.textContent || '').replace(/[^0-9.]/g, ''))
          : NaN;
      const creditsEarned =
        colMap.earnedIdx !== -1
          ? parseFloat((cells[colMap.earnedIdx]?.textContent || '').replace(/[^0-9.]/g, ''))
          : NaN;

      const credits =
        !isNaN(creditsRegistered) && creditsRegistered > 0
          ? creditsRegistered
          : !isNaN(creditsEarned) && creditsEarned > 0
          ? creditsEarned
          : NaN;

      if (isNaN(cgpa) || cgpa < 0 || cgpa > 10 || isNaN(credits) || credits <= 0) return null;

      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : '';
      return {
        authId,
        cgpa,
        credits,
        creditsRegistered: isNaN(creditsRegistered) ? credits : creditsRegistered,
        creditsEarned: isNaN(creditsEarned) ? credits : creditsEarned,
        updatedAt: Date.now()
      };
    },

    saveBaseline(baseline) {
      if (!baseline) return;
      cachedBaseline = baseline;
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ [STORAGE_BASELINE_KEY]: baseline });
      }
    },

    /**
     * Extracts CGPA and current credits from Grade History's "CGPA Details" table
     * when the user is on the Grade History page.
     */
    captureGradeHistory() {
      const baseline = this.parseGradeHistoryFromRoot(document);
      if (baseline) {
        this.saveBaseline(baseline);
      }
    },

    loadBaseline(callback) {
      const currentAuthId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : '';
      const isMatchingUser = (data) =>
        data &&
        typeof data.cgpa === 'number' &&
        typeof data.credits === 'number' &&
        (!currentAuthId || !data.authId || data.authId === currentAuthId);

      if (isMatchingUser(cachedBaseline)) {
        callback(cachedBaseline);
        return;
      }
      if (chrome?.storage?.local) {
        chrome.storage.local.get([STORAGE_BASELINE_KEY], (res) => {
          const data = res?.[STORAGE_BASELINE_KEY] || null;
          cachedBaseline = isMatchingUser(data) ? data : null;
          callback(cachedBaseline);
        });
      } else {
        callback(null);
      }
    },

    /**
     * Automatically fetches the logged-in user's Grade History page in the background
     * and parses their real CGPA & Credits so Marks & Grade prefills immediately.
     */
    async fetchGradeHistoryBaseline() {
      if (this._pendingFetchPromise) return this._pendingFetchPromise;

      this._pendingFetchPromise = (async () => {
        try {
          const DOM = window.VTOP_PLUS?.DOM;
          const basePath = DOM?.getBasePath ? DOM.getBasePath() : window.location.pathname.split('/')[1] || 'vtop';
          const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
          const csrf = DOM?.getCsrfToken ? DOM.getCsrfToken() : '';

          const menuLink = document.querySelector('a[data-url*="StudentGradeHistory" i], [data-url*="GradeHistory" i]');
          const menuUrl = menuLink?.getAttribute('data-url')?.trim();
          const candidates = [
            menuUrl,
            'examinations/examGradeView/StudentGradeHistory',
            'examinations/StudentGradeHistory',
            'examinations/GradeHistory'
          ].filter((u, i, arr) => u && arr.indexOf(u) === i);

          for (const relPath of candidates) {
            const url = `${window.location.origin}/${basePath}/${relPath.replace(/^\/+/, '')}`;
            for (const includeVerifyMenu of [true, false]) {
              try {
                const params = new URLSearchParams();
                if (includeVerifyMenu) params.append('verifyMenu', 'true');
                if (authId) params.append('authorizedID', authId);
                if (csrf) params.append('_csrf', csrf);
                params.append('nocache', `@(${new Date().toUTCString()})`);

                const res = await fetch(url, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                  },
                  body: params.toString()
                });

                if (!res.ok) continue;
                const html = await res.text();
                if (!html || !/cgpa/i.test(html)) continue;

                const doc = new DOMParser().parseFromString(html, 'text/html');
                const baseline = this.parseGradeHistoryFromRoot(doc);
                if (baseline) {
                  this.saveBaseline(baseline);
                  return baseline;
                }
              } catch (_) {}
            }
          }
        } finally {
          this._pendingFetchPromise = null;
        }
        return null;
      })();

      return this._pendingFetchPromise;
    },

    /**
     * Mounts the collapsible CGPA Calculator bar directly above the Marks View card.
     */
    checkAndMountCgpaCalculator() {
      const markForm = document.getElementById('studentMarkView');
      const isMarksPage =
        Boolean(markForm) ||
        (Boolean(document.querySelector('#fixedTableContainer table.customTable-level1')) &&
          !document.getElementById('studentGradeView'));

      if (!isMarksPage) return;

      const marksCard = markForm
        ? markForm.closest('.card') || markForm.closest('.card-body')?.parentNode
        : document.querySelector('#fixedTableContainer')?.closest('.card');
      const mountParent = marksCard ? marksCard.parentNode : null;
      if (!marksCard || !mountParent) return;

      const existing = document.getElementById(CALC_ID);
      if (existing && existing.parentNode === mountParent && existing.nextElementSibling === marksCard) {
        if (!calcState.manualBaseline && (!calcState.cgpa || !calcState.credits) && cachedBaseline) {
          this.applyBaselineToInputs(cachedBaseline);
          this.recalculateCgpa();
        }
        return;
      }
      if (existing) existing.remove();

      const card = document.createElement('div');
      card.id = CALC_ID;
      card.className = calcState.isOpen ? 'vtop-plus-card is-open' : 'vtop-plus-card';

      card.innerHTML = `
        <button type="button" class="vtop-cgpa-toggle" id="vtop-cgpa-toggle" aria-expanded="${calcState.isOpen ? 'true' : 'false'}">
          <span class="vtop-card-title">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>
            <span>CGPA Calculator</span>
          </span>
          <svg class="vtop-cgpa-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>

        <div class="vtop-cgpa-body" id="vtop-cgpa-body">
          <div class="vtop-cgpa-body-inner">
            <div class="vtop-cgpa-baseline-bar">
              <div class="vtop-cgpa-baseline-summary" id="vtop-cgpa-baseline-summary">
                <span class="vtop-cgpa-baseline-text" id="vtop-cgpa-baseline-text">Baseline: Syncing...</span>
              </div>
              <div class="vtop-cgpa-baseline-actions">
                <button type="button" id="vtop-cgpa-edit-baseline" class="vtop-cgpa-btn vtop-cgpa-btn-sm">Edit</button>
                <button type="button" id="vtop-cgpa-reset-baseline" class="vtop-cgpa-btn vtop-cgpa-btn-sm" title="Sync latest values from Grade History">Sync</button>
              </div>
            </div>

            <div class="vtop-cgpa-baseline-grid" id="vtop-cgpa-baseline-editor" hidden>
              <div class="vtop-cgpa-field">
                <label class="vtop-cgpa-label" for="vtop-cgpa-curr">Current CGPA</label>
                <input type="number" step="0.01" min="0" max="10" id="vtop-cgpa-curr" class="vtop-cgpa-input" />
              </div>
              <div class="vtop-cgpa-field">
                <label class="vtop-cgpa-label" for="vtop-cgpa-credits">Current Credits</label>
                <input type="number" step="0.5" min="0" id="vtop-cgpa-credits" class="vtop-cgpa-input" />
              </div>
            </div>

            <div class="vtop-cgpa-subjects-section">
              <div class="vtop-cgpa-subjects-head">
                <span class="vtop-cgpa-subjects-title">Semester Courses</span>
                <div class="vtop-cgpa-subjects-actions">
                  <button type="button" id="vtop-cgpa-add-row" class="vtop-cgpa-btn vtop-cgpa-btn-sm vtop-cgpa-btn-primary">+ Add</button>
                  <button type="button" id="vtop-cgpa-clear-rows" class="vtop-cgpa-btn vtop-cgpa-btn-sm">Clear</button>
                </div>
              </div>
              <div class="vtop-cgpa-cols-head">
                <span class="vtop-cgpa-label">Credits</span>
                <span class="vtop-cgpa-label">Grade</span>
                <span></span>
              </div>
              <div class="vtop-cgpa-rows" id="vtop-cgpa-rows"></div>
            </div>

            <div class="vtop-stats-grid">
              <div class="vtop-stat-box">
                <div class="vtop-stat-num" id="vtop-cgpa-out-cgpa">—</div>
                <div class="vtop-stat-lbl">Calculated CGPA</div>
              </div>
              <div class="vtop-stat-box">
                <div class="vtop-stat-num" id="vtop-cgpa-out-sgpa">—</div>
                <div class="vtop-stat-lbl">Assumed SGPA</div>
              </div>
              <div class="vtop-stat-box">
                <div class="vtop-stat-num" id="vtop-cgpa-out-credits">—</div>
                <div class="vtop-stat-lbl">Total Credits</div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Mount directly above the Marks View card (outside the card & form)
      mountParent.insertBefore(card, marksCard);

      this.bindCgpaEvents();
      this.renderSubjectRows();

      this.loadBaseline(async (baseline) => {
        if (baseline) {
          this.applyBaselineToInputs(baseline);
          this.recalculateCgpa();
        }
        const isStale = !baseline || Date.now() - (baseline.updatedAt || 0) > 60 * 60 * 1000;
        const missingValues = !calcState.manualBaseline && (!calcState.cgpa || !calcState.credits);
        if (isStale || missingValues) {
          const fresh = await this.fetchGradeHistoryBaseline();
          if (fresh || baseline) {
            this.applyBaselineToInputs(fresh || baseline);
            this.recalculateCgpa();
          }
        }
      });
    },

    applyBaselineToInputs(baseline) {
      const currInput = document.getElementById('vtop-cgpa-curr');
      const credInput = document.getElementById('vtop-cgpa-credits');
      const editor = document.getElementById('vtop-cgpa-baseline-editor');
      const summaryText = document.getElementById('vtop-cgpa-baseline-text');
      if (!currInput || !credInput) return;

      if (baseline && (!calcState.manualBaseline || !calcState.cgpa || !calcState.credits)) {
        calcState.cgpa = String(baseline.cgpa);
        calcState.credits = String(baseline.credits);
        calcState.manualBaseline = false;
        saveSessionCalcState();
      }

      currInput.value = calcState.cgpa;
      credInput.value = calcState.credits;

      const hasBaseline = Boolean(calcState.cgpa && calcState.credits);
      if (summaryText) {
        summaryText.textContent = hasBaseline
          ? `Baseline: ${calcState.cgpa} CGPA · ${calcState.credits} Credits`
          : 'Baseline: Not set';
      }
      if (editor && !hasBaseline) {
        editor.hidden = false;
      }
    },

    bindCgpaEvents() {
      const card = document.getElementById(CALC_ID);
      const toggleBtn = document.getElementById('vtop-cgpa-toggle');
      const currInput = document.getElementById('vtop-cgpa-curr');
      const credInput = document.getElementById('vtop-cgpa-credits');
      const editBtn = document.getElementById('vtop-cgpa-edit-baseline');
      const editor = document.getElementById('vtop-cgpa-baseline-editor');
      const resetBtn = document.getElementById('vtop-cgpa-reset-baseline');
      const addBtn = document.getElementById('vtop-cgpa-add-row');
      const clearBtn = document.getElementById('vtop-cgpa-clear-rows');
      const rowsContainer = document.getElementById('vtop-cgpa-rows');

      const refreshSummaryText = () => {
        const summaryText = document.getElementById('vtop-cgpa-baseline-text');
        if (!summaryText) return;
        const hasBaseline = Boolean(calcState.cgpa && calcState.credits);
        summaryText.textContent = hasBaseline
          ? `Baseline: ${calcState.cgpa} CGPA · ${calcState.credits} Credits`
          : 'Baseline: Not set';
      };

      toggleBtn?.addEventListener('click', () => {
        calcState.isOpen = !calcState.isOpen;
        saveSessionCalcState();
        if (card) card.classList.toggle('is-open', calcState.isOpen);
        toggleBtn.setAttribute('aria-expanded', calcState.isOpen ? 'true' : 'false');
      });

      editBtn?.addEventListener('click', () => {
        if (!editor) return;
        editor.hidden = !editor.hidden;
        editBtn.textContent = editor.hidden ? 'Edit' : 'Done';
      });

      currInput?.addEventListener('input', () => {
        calcState.cgpa = currInput.value;
        calcState.manualBaseline = true;
        saveSessionCalcState();
        refreshSummaryText();
        this.recalculateCgpa();
      });

      credInput?.addEventListener('input', () => {
        calcState.credits = credInput.value;
        calcState.manualBaseline = true;
        saveSessionCalcState();
        refreshSummaryText();
        this.recalculateCgpa();
      });

      resetBtn?.addEventListener('click', async () => {
        resetBtn.disabled = true;
        const fresh = (await this.fetchGradeHistoryBaseline()) || cachedBaseline;
        if (fresh) {
          calcState.cgpa = String(fresh.cgpa);
          calcState.credits = String(fresh.credits);
          calcState.manualBaseline = false;
          saveSessionCalcState();
        }
        this.applyBaselineToInputs(fresh);
        this.recalculateCgpa();
        resetBtn.disabled = false;
      });

      addBtn?.addEventListener('click', () => {
        calcState.subjects.push({ name: '', credits: '', grade: 'S' });
        saveSessionCalcState();
        this.renderSubjectRows();
        this.recalculateCgpa();
      });

      clearBtn?.addEventListener('click', () => {
        calcState.subjects = [{ name: '', credits: '', grade: 'S' }];
        saveSessionCalcState();
        this.renderSubjectRows();
        this.recalculateCgpa();
      });

      rowsContainer?.addEventListener('input', (e) => {
        const rowEl = e.target.closest('.vtop-cgpa-row');
        if (!rowEl) return;
        const idx = parseInt(rowEl.dataset.idx, 10);
        if (isNaN(idx) || !calcState.subjects[idx]) return;

        if (e.target.classList.contains('vtop-cgpa-cred-input')) {
          calcState.subjects[idx].credits = e.target.value;
        }
        saveSessionCalcState();
        this.recalculateCgpa();
      });

      rowsContainer?.addEventListener('change', (e) => {
        const rowEl = e.target.closest('.vtop-cgpa-row');
        if (!rowEl) return;
        const idx = parseInt(rowEl.dataset.idx, 10);
        if (isNaN(idx) || !calcState.subjects[idx]) return;

        if (e.target.classList.contains('vtop-cgpa-grade-select')) {
          calcState.subjects[idx].grade = e.target.value;
          saveSessionCalcState();
          this.recalculateCgpa();
        }
      });

      rowsContainer?.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.vtop-cgpa-remove-btn');
        if (!removeBtn) return;
        const rowEl = removeBtn.closest('.vtop-cgpa-row');
        if (!rowEl) return;
        const idx = parseInt(rowEl.dataset.idx, 10);
        if (isNaN(idx)) return;

        if (calcState.subjects.length > 1) {
          calcState.subjects.splice(idx, 1);
        } else {
          calcState.subjects[0] = { name: '', credits: '', grade: 'S' };
        }
        saveSessionCalcState();
        this.renderSubjectRows();
        this.recalculateCgpa();
      });
    },

    renderSubjectRows() {
      const container = document.getElementById('vtop-cgpa-rows');
      if (!container) return;

      container.innerHTML = calcState.subjects
        .map((subj, idx) => {
          const optionsHtml = GRADE_OPTIONS.map(
            (opt) =>
              `<option value="${opt.grade}" ${subj.grade === opt.grade ? 'selected' : ''}>${opt.label}</option>`
          ).join('');

          return `
            <div class="vtop-cgpa-row" data-idx="${idx}">
              <input type="number" step="0.5" min="0" max="30" class="vtop-cgpa-input vtop-cgpa-cred-input" placeholder="Credits" aria-label="Credits" value="${escapeHtml(subj.credits)}" />
              <select class="vtop-cgpa-select vtop-cgpa-grade-select" aria-label="Assumed Grade">
                ${optionsHtml}
              </select>
              <button type="button" class="vtop-cgpa-remove-btn" title="Remove row" aria-label="Remove row">&times;</button>
            </div>
          `;
        })
        .join('');
    },

    recalculateCgpa() {
      const outCgpa = document.getElementById('vtop-cgpa-out-cgpa');
      const outSgpa = document.getElementById('vtop-cgpa-out-sgpa');
      const outCredits = document.getElementById('vtop-cgpa-out-credits');
      if (!outCgpa || !outSgpa || !outCredits) return;

      const prevCgpaRaw = parseFloat(calcState.cgpa);
      const prevCredRaw = parseFloat(calcState.credits);
      const hasPrev = !isNaN(prevCgpaRaw) && prevCgpaRaw >= 0 && prevCgpaRaw <= 10 && !isNaN(prevCredRaw) && prevCredRaw > 0;
      const prevCgpa = hasPrev ? prevCgpaRaw : 0;
      const prevCredits = hasPrev ? prevCredRaw : 0;

      let addedCredits = 0;
      let addedPoints = 0;
      for (const subj of calcState.subjects) {
        const cr = parseFloat(subj.credits);
        const gp = GRADE_POINTS_MAP[subj.grade];
        if (!isNaN(cr) && cr > 0 && gp !== undefined) {
          addedCredits += cr;
          addedPoints += cr * gp;
        }
      }

      const totalCredits = prevCredits + addedCredits;
      const totalPoints = prevCgpa * prevCredits + addedPoints;

      if (totalCredits > 0) {
        const calculatedCgpa = totalPoints / totalCredits;
        let deltaHtml = '';
        if (hasPrev && addedCredits > 0) {
          const diff = calculatedCgpa - prevCgpa;
          if (Math.abs(diff) >= 0.005) {
            const sign = diff > 0 ? '+' : '';
            const cls = diff > 0 ? 'vtop-cgpa-delta-up' : 'vtop-cgpa-delta-down';
            deltaHtml = `<span class="${cls}">(${sign}${diff.toFixed(2)})</span>`;
          } else {
            deltaHtml = '<span class="vtop-cgpa-delta-flat">(0.00)</span>';
          }
        }
        outCgpa.innerHTML = `${calculatedCgpa.toFixed(2)}${deltaHtml}`;
        outCredits.textContent = this.formatNum(totalCredits);
        outCredits.title =
          hasPrev && addedCredits > 0
            ? `${this.formatNum(prevCredits)} + ${this.formatNum(addedCredits)} = ${this.formatNum(totalCredits)}`
            : '';
      } else {
        outCgpa.textContent = '—';
        outCredits.textContent = '—';
        outCredits.title = '';
      }

      outSgpa.textContent = addedCredits > 0 ? (addedPoints / addedCredits).toFixed(2) : '—';
    },

    checkAndSummarizeMarks() {
      const courses = this.extractAllCourses(document, { includeUngraded: false });
      if (!courses || courses.length === 0) return;

      this.courses = courses;
      this.augmentCourseTables();
    },

    /**
     * Public root-agnostic parser reused by MarksNotifier for background HTML diffs
     */
    parseMarksFromRoot(root, options = { includeUngraded: true }) {
      return this.extractAllCourses(root, options);
    },

    /**
     * Extracts all courses and their corresponding inner marks tables from VTOP's nested layout
     */
    extractAllCourses(root = document, options = {}) {
      if (!root || !root.querySelectorAll) return [];
      const includeUngraded = Boolean(options?.includeUngraded);
      const courses = [];

      let marksTables = Array.from(root.querySelectorAll('#fixedTableContainer table.customTable-level1'));

      let allTables = null;
      if (marksTables.length === 0) {
        allTables = Array.from(root.querySelectorAll('table'));
        marksTables = allTables.filter((t) => {
          const header = t.querySelector('thead') || t.querySelector('tr:first-child');
          const text = (header ? header.textContent : t.textContent || '').toLowerCase();
          return (
            text.includes('mark title') &&
            text.includes('weightage') &&
            (text.includes('scored mark') || text.includes('weightage mark') || text.includes('status'))
          );
        });
      }

      if (marksTables.length > 0) {
        marksTables.forEach((innerTable, idx) => {
          const courseInfo = this.detectCourseHeader(innerTable, idx + 1);
          const marksData = this.parseInnerMarksTable(innerTable, { includeUngraded });

          if (marksData.components.length === 0) {
            if (root === document) this.clearSummary(innerTable);
            return;
          }

          courses.push({
            id: `course-${idx}`,
            tableElement: innerTable,
            code: courseInfo.code,
            title: courseInfo.title,
            type: courseInfo.type,
            faculty: courseInfo.faculty,
            slot: courseInfo.slot,
            components: marksData.components,
            totalGot: marksData.totalGot,
            totalGiven: marksData.totalGiven
          });
        });
      } else {
        if (!allTables) allTables = Array.from(root.querySelectorAll('table'));
        const flatTable = allTables.find((t) => {
          const header = t.querySelector('thead') || t.querySelector('tr:first-child');
          const text = (header ? header.textContent : t.textContent || '').toLowerCase();
          return (
            (text.includes('cat-i') || text.includes('cat 1') || text.includes('continuous assessment')) &&
            (text.includes('weightage') || text.includes('scored mark'))
          );
        });

        if (flatTable) {
          const marksData = this.parseInnerMarksTable(flatTable, { includeUngraded });
          if (marksData.components.length > 0) {
            courses.push({
              id: 'course-0',
              tableElement: flatTable,
              code: 'VTOP Course',
              title: 'Current Course Marks',
              type: 'Theory',
              faculty: '',
              slot: '',
              components: marksData.components,
              totalGot: marksData.totalGot,
              totalGiven: marksData.totalGiven
            });
          }
        }
      }

      return courses;
    },

    clearSummary(table) {
      const existing = table?.querySelector('.vtop-fat-inline-tfoot');
      if (existing) existing.remove();
    },

    /**
     * Finds the course code, title, and metadata for a given marks table
     */
    detectCourseHeader(innerTable, fallbackIdx) {
      let code = `Course ${fallbackIdx}`;
      let title = '';
      let type = 'Theory';
      let faculty = '';
      let slot = '';

      const containingTr = innerTable.closest('tr');
      let courseRow = null;

      if (containingTr) {
        courseRow = containingTr.previousElementSibling;
        if (!courseRow || courseRow.querySelectorAll('td').length < 3) {
          courseRow = containingTr;
        }
      }

      if (courseRow) {
        const cells = Array.from(courseRow.querySelectorAll('td, th'));
        if (cells.length >= 5) {
          const codeMatch = (cells[2]?.textContent || '').trim().match(REGEX_COURSE_CODE);
          if (codeMatch) {
            code = codeMatch[1];
          } else {
            for (const cell of cells) {
              const m = (cell.textContent || '').trim().match(REGEX_COURSE_CODE);
              if (m) {
                code = m[1];
                break;
              }
            }
          }
          if (cells[3]) title = cells[3].textContent.trim();
          if (cells[4]) type = cells[4].textContent.trim();
          if (cells[6]) faculty = cells[6].textContent.trim();
          if (cells[7]) slot = cells[7].textContent.trim();
        }
      }

      if (!title) title = code;
      return { code, title, type, faculty, slot };
    },

    /**
     * Parse rows of an inner marks table (CAT-1, CAT-2, Quizzes, DAs, Lab assessments)
     */
    parseInnerMarksTable(table, options = {}) {
      const includeUngraded = Boolean(options?.includeUngraded);
      let titleCol = 1;
      let maxCol = 2;
      let weightCol = 3;
      let statusCol = 4;
      let scoredCol = 5;
      let weightageMarkCol = 6;

      if (!table.classList.contains('customTable-level1')) {
        const headCells = table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td');
        headCells.forEach((th, idx) => {
          const text = (th.textContent || '').toLowerCase().trim();
          if (text.includes('title') || text.includes('component')) titleCol = idx;
          else if (text.includes('max')) maxCol = idx;
          else if (text.includes('weightage %') || text === 'weightage') weightCol = idx;
          else if (text.includes('status')) statusCol = idx;
          else if (text.includes('scored mark')) scoredCol = idx;
          else if (text.includes('weightage mark')) weightageMarkCol = idx;
        });
      }

      const components = [];
      let totalGot = 0;
      let totalGiven = 0;

      const directTbodyRows = table.querySelectorAll(':scope > tbody > tr');
      const rows =
        directTbodyRows.length > 0
          ? Array.from(directTbodyRows)
          : Array.from(table.querySelectorAll('tr')).slice(1);

      rows.forEach((row) => {
        if (row.closest('tfoot, .vtop-fat-inline-tfoot') || row.classList.contains('vtop-fat-header-row')) {
          return;
        }

        const cells = row.querySelectorAll(':scope > td');
        if (cells.length < 4) return;

        const titleText = (cells[titleCol]?.textContent || '').trim();
        if (!titleText || titleText.toLowerCase().includes('mark title')) return;

        const maxMark = parseFloat((cells[maxCol]?.textContent || '').replace(/[^0-9.]/g, '')) || 0;
        const weightPct = parseFloat((cells[weightCol]?.textContent || '').replace(/[^0-9.]/g, '')) || 0;
        const status = (cells[statusCol]?.textContent || '').trim();
        const scoredText = (cells[scoredCol]?.textContent || '').trim();
        const scored = parseFloat(scoredText.replace(/[^0-9.]/g, '')) || 0;

        let weightMark = 0;
        const weightMarkCell = cells[weightageMarkCol];
        const weightMarkText = weightMarkCell ? weightMarkCell.textContent.trim() : '';
        if (weightMarkText && !isNaN(parseFloat(weightMarkText))) {
          weightMark = parseFloat(weightMarkText) || 0;
        } else if (maxMark > 0 && weightPct > 0) {
          weightMark = (scored / maxMark) * weightPct;
        }

        const hasScore = scoredText !== '' && !isNaN(parseFloat(scoredText));
        const hasWeightMark = weightMarkText !== '' && !isNaN(parseFloat(weightMarkText));
        const isAbsent = /\babsent\b/i.test(status);
        const isGraded = hasScore || hasWeightMark || isAbsent;

        if ((weightPct > 0 || maxMark > 0) && isGraded) {
          totalGiven += weightPct;
          totalGot += weightMark;
        }

        if ((weightPct > 0 || maxMark > 0) && (isGraded || includeUngraded)) {
          components.push({
            title: titleText,
            maxMark,
            weightPct,
            status,
            scored,
            scoredRaw: scoredText,
            weightMark,
            weightMarkRaw: weightMarkText,
            isGraded,
            rowElement: row
          });
        }
      });

      const roundedGot = Math.round(totalGot * 1e4) / 1e4;
      const roundedGiven = Math.round(totalGiven * 1e4) / 1e4;

      return { components, totalGot: roundedGot, totalGiven: roundedGiven };
    },

    formatNum(num) {
      const rounded = Math.round(num * 100) / 100;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
    },

    /**
     * Injects total marks achieved summary footer at the bottom of every course marks table
     */
    augmentCourseTables() {
      this.courses.forEach((c) => {
        if (!c.tableElement) return;

        let tfoot = c.tableElement.querySelector('.vtop-fat-inline-tfoot');
        if (!tfoot) {
          tfoot = document.createElement('tfoot');
          tfoot.className = 'vtop-fat-inline-tfoot';
          c.tableElement.appendChild(tfoot);
        }

        const firstRowCols = c.tableElement.querySelector('tr')?.querySelectorAll('td, th').length || 0;
        const gotLabel = this.formatNum(c.totalGot);
        const givenLabel = this.formatNum(c.totalGiven);
        const summaryMeta = `${gotLabel} / ${givenLabel}`;

        const nextHtml =
          firstRowCols === 8
            ? `
            <tr class="tableHeader-level1 vtop-fat-header-row">
              <td colspan="5" class="vtop-fat-header-left">Total Marks Achieved</td>
              <td colspan="3" class="vtop-fat-header-right">${summaryMeta}</td>
            </tr>
          `
            : `
            <tr class="tableHeader-level1 vtop-fat-header-row">
              <td colspan="100%">
                <div class="vtop-fat-fallback-header">
                  <span>Total Marks Achieved</span>
                  <span>${summaryMeta}</span>
                </div>
              </td>
            </tr>
          `;

        if (tfoot.innerHTML !== nextHtml) {
          tfoot.innerHTML = nextHtml;
        }
      });
    }
  };

  window.VTOP_PLUS.MarksFatPredictor = MarksFatPredictor;
})();
