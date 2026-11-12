/**
 * VTOP++ - Live Course Materials Filter Module
 * Fully ported & enhanced from vtop-course-filter.
 * 
 * Features:
 * 1. Segregates VTOP Course Page Consolidated by Semester (Recent First), Subject, and Faculty.
 * 2. Instant localStorage faculty cache per subject.
 * 3. Multi-page DataTables traversal to extract all professors across 15-25 pages.
 * 4. Real-time table filter by faculty across all pages (DataTables search hook).
 * 5. In-table instant filter bar for topic, lecture keywords, and Theory / Lab type pills.
 * 6. Clean lifecycle management with full destroy/unmount support.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const UI_ID = 'vtop-custom-course-filter';
  const TABLE_BAR_ID = 'vtop-plus-table-filter-bar';
  const LS_KEY = 'vtopFilter.v1';
  const CACHE_TTL = 14 * 24 * 3600 * 1000;
  const CACHE_MAX = 80;
  const POLL_MS = 150;
  const STALE_MS = 3000;

  const SELECTOR_DOWNLOAD_BTNS = 'button[data-fileid], .download-btn[data-fileid], [data-fileid], [data-file-id], button[onclick*="downloadCourseMaterialFacultyPdf"], a[onclick*="downloadCourseMaterialFacultyPdf"], input[onclick*="downloadCourseMaterialFacultyPdf"]';

  const state = {
    sem: '',
    subj: '',
    fac: 'ALL',
    topicQ: '',
    courses: {},
    sems: [],
    faculty: [],
    facCol: 3,
    matCol: 2,
    courseCol: 1,
    native: null,
    timer: null,
    pending: null
  };

  let persist = { sem: '', fac: {} };
  try {
    const o = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (o && typeof o === 'object') persist = { sem: o.sem || '', fac: o.fac || {} };
  } catch (_) {}

  function savePersist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(persist));
    } catch (_) {}
  }

  function cacheGet(subj) {
    const e = persist.fac[subj];
    if (!e || !Array.isArray(e.f) || Date.now() - e.t > CACHE_TTL) return null;
    return e.f.map((x) => ({ name: x[0], count: x[1] }));
  }

  function cacheSet(subj, list) {
    persist.fac[subj] = { t: Date.now(), f: list.map((f) => [f.name, f.count]) };
    const keys = Object.keys(persist.fac);
    if (keys.length > CACHE_MAX) {
      keys
        .sort((a, b) => persist.fac[a].t - persist.fac[b].t)
        .slice(0, keys.length - CACHE_MAX)
        .forEach((k) => delete persist.fac[k]);
    }
    savePersist();
  }

  function setBusy(on) {
    const b = document.getElementById('vtop-busy');
    if (b) b.style.display = on ? 'block' : 'none';
  }

  function semWeight(s) {
    const m = s.match(/(\d{4})-\d{2}/);
    const y = m ? parseInt(m[1], 10) : 0;
    const l = s.toLowerCase();
    let t = 0;
    if (l.includes('summer')) t = 3;
    else if (l.includes('winter')) t = 2;
    else if (l.includes('fall')) t = 1;
    if (l.includes('inter')) t += 0.5;
    return y * 10 + t;
  }

  function parseOptions(sel) {
    const data = {};
    let selSem = '';
    let selVal = '';
    const opts = sel.options;
    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i];
      const text = opt.textContent.trim();
      if (!opt.value || text.includes('-- Registered Courses --')) continue;
      // Robust split supporting standard hyphen, en-dash (–), and em-dash (—)
      const parts = text.split(/\s*[-–—]\s*/);
      if (parts.length < 2) {
        // Fallback: If no hyphen, treat as Current Semester so courses are never lost
        const sem = 'Current Semester';
        if (!data[sem]) data[sem] = [];
        data[sem].push({ value: opt.value, label: text });
        if (opt.selected) {
          selSem = sem;
          selVal = opt.value;
        }
        continue;
      }
      const sem = parts[0].trim();
      if (!data[sem]) data[sem] = [];
      const label = parts.slice(1).join(' - ').trim();
      data[sem].push({ value: opt.value, label });
      if (opt.selected) {
        selSem = sem;
        selVal = opt.value;
      }
    }
    return { data, selSem, selVal };
  }

  function cleanFaculty(v) {
    if (v == null) return '';
    let s = typeof v === 'string' ? v : v.innerHTML !== undefined ? v.innerHTML : String(v);
    if (s.includes('<')) {
      s = s
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p|li|tr|td)>/gi, '\n')
        .replace(/<[^>]*>/g, ' ');
    }
    if (s.includes('&')) {
      s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
    }
    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\s*\d{2}-\d{2}-\d{4}.*$/, '').replace(/\s+/g, ' ').trim();
      if (line) return /no data/i.test(line) ? '' : line;
    }
    return '';
  }

  const CourseFilter = {
    init() {
      this.ensureCourseDropdownUI();
      this.checkAndMountTableFilterBar();
    },

    destroy() {
      stopWaiting();

      // 1. Remove course dropdown UI
      const ui = document.getElementById(UI_ID);
      if (ui) ui.remove();

      // 2. Unhide native course dropdown
      if (state.native) {
        state.native.style.display = '';
        const sib = state.native.nextElementSibling;
        if (sib && /select2|chosen|bootstrap-select|ms-parent/.test(sib.className || '')) {
          sib.style.display = '';
        }
        state.native = null;
      }

      // 3. Remove table filter bar
      const bar = document.getElementById(TABLE_BAR_ID);
      if (bar) bar.remove();

      // 4. Reset table rows display
      const table = this.findMaterialsTable();
      if (table) {
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach((r) => (r.style.display = ''));
      }
    },

    findCourseDropdown() {
      // 1. O(1) direct selector on VTOP Course Page (select#courseId[name="courseId"])
      const direct = document.getElementById('courseId') || document.querySelector('select[name="courseId"]');
      if (direct) return direct;

      // 2. Fallback scan
      const selects = document.getElementsByTagName('select');
      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        if (sel.textContent && sel.textContent.includes('Registered Courses')) return sel;
        const maxCheck = Math.min(sel.options.length, 5);
        for (let j = 0; j < maxCheck; j++) {
          if (sel.options[j].textContent.includes('Registered Courses')) return sel;
        }
      }
      return null;
    },

    findMaterialsTable() {
      // 1. O(1) direct selector on VTOP Course Page (#materialTable)
      const direct = document.getElementById('materialTable');
      if (direct) return direct;

      // 2. Fallback selectors
      const btn = document.querySelector(SELECTOR_DOWNLOAD_BTNS);
      if (btn) {
        const table = btn.closest('table');
        if (table) return table;
      }

      const tables = document.getElementsByTagName('table');
      for (let i = tables.length - 1; i >= 0; i--) {
        const t = tables[i];
        if (!t.tBodies.length || t.querySelector('table')) continue;
        const h = t.tHead ? t.tHead.textContent.toLowerCase() : '';
        if (h.includes('uploaded by') && (h.includes('material') || h.includes('download') || h.includes('detail'))) {
          return t;
        }
      }
      return document.querySelector('table[id*="material" i]');
    },

    getOptionsSignature(sel) {
      if (!sel || !sel.options) return '';
      const len = sel.options.length;
      const first = len > 1 ? sel.options[1].value : '';
      const last = len > 0 ? sel.options[len - 1].value : '';
      return `${len}:${first}:${last}`;
    },

    ensureCourseDropdownUI() {
      const ui = document.getElementById(UI_ID);
      if (ui && state.native && state.native.isConnected) {
        const sig = this.getOptionsSignature(state.native);
        if (state.optSig === sig) return;
      }
      if (ui) ui.remove();

      const sel = this.findCourseDropdown();
      if (sel) this.mountCourseDropdownUI(sel);
    },

    mountCourseDropdownUI(native) {
      state.native = native;
      state.optSig = this.getOptionsSignature(native);
      const parsed = parseOptions(native);
      state.courses = parsed.data;
      state.sems = Object.keys(parsed.data).sort((a, b) => semWeight(b) - semWeight(a));

      if (parsed.selVal) {
        if (parsed.selVal !== state.subj) {
          state.fac = 'ALL';
          state.faculty = [];
        }
        state.sem = parsed.selSem;
        state.subj = parsed.selVal;
      } else {
        state.subj = '';
        state.fac = 'ALL';
        state.faculty = [];
        if (!state.courses[state.sem]) state.sem = '';
      }

      if (!state.sem || !state.courses[state.sem]) {
        state.sem = persist.sem && state.courses[persist.sem] ? persist.sem : state.sems[0] || '';
      }

      native.style.display = 'none';
      const sib = native.nextElementSibling;
      if (sib && /select2|chosen|bootstrap-select|ms-parent/.test(sib.className || '')) {
        sib.style.display = 'none';
      }

      const isDark = document.documentElement.classList.contains('vtop-dark-theme');
      const boxBg = isDark ? '#131c2e' : '#ffffff';
      const boxBorder = isDark ? '#293548' : '#cbd5e1';
      const selBg = isDark ? '#0f172a' : '#fff';
      const selBorder = isDark ? '#293548' : '#cbd5e1';
      const textColor = isDark ? '#f8fafc' : '#0f172a';
      const lblColor = isDark ? '#94a3b8' : '#334155';

      const box = document.createElement('div');
      box.id = UI_ID;
      box.className = 'vtop-plus-course-filter-panel';
      box.style.cssText =
        'display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;padding:16px;' +
        `background:${boxBg};border:1px solid ${boxBorder};border-radius:12px;margin:12px 0 16px;width:100%;` +
        'box-sizing:border-box;box-shadow:none;font-family:inherit;';

      const selCss = `width:100%;height:38px;padding:6px 12px;border:1px solid ${selBorder};border-radius:6px;background:${selBg};font-size:13px;color:${textColor};`;
      const lblCss = `font-weight:700;font-size:12px;color:${lblColor};margin-bottom:6px;display:block;`;

      box.innerHTML = `
        <div style="display:flex;flex-direction:column;justify-content:flex-end;">
          <label style="${lblCss}">1. Select Semester (Recent First)</label>
          <select id="vtop-sem-select" class="form-control" style="${selCss}">
            <option value="">-- Choose Semester --</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column;justify-content:flex-end;">
          <label style="${lblCss}">2. Select Subject</label>
          <select id="vtop-subj-select" class="form-control" style="${selCss}" disabled>
            <option value="">-- Select Semester First --</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column;justify-content:flex-end;">
          <label style="${lblCss}">3. Filter by Faculty</label>
          <select id="vtop-fac-select" class="form-control" style="${selCss}" disabled>
            <option value="ALL">-- Select Subject First --</option>
          </select>
        </div>
        <div id="vtop-busy" style="display:none;grid-column:1/-1;height:3px;border-radius:2px;
          background:linear-gradient(90deg,transparent,#27ae60,transparent);background-size:40% 100%;
          background-repeat:no-repeat;animation:vtopSlide 1s linear infinite;"></div>
        <style>@keyframes vtopSlide{0%{background-position:-40% 0}100%{background-position:140% 0}}</style>
      `;

      native.parentNode.insertBefore(box, native);

      const semSel = document.getElementById('vtop-sem-select');
      const subjSel = document.getElementById('vtop-subj-select');
      const facSel = document.getElementById('vtop-fac-select');

      const frag = document.createDocumentFragment();
      state.sems.forEach((sem) => {
        const o = document.createElement('option');
        o.value = sem;
        o.textContent = `${sem} (${state.courses[sem].length} Courses)`;
        frag.appendChild(o);
      });
      semSel.appendChild(frag);

      if (state.sem && state.courses[state.sem]) {
        semSel.value = state.sem;
        this.renderSubjects();

        if (state.subj) {
          const c = state.faculty.length ? state.faculty : cacheGet(state.subj);
          if (c && c.length) {
            state.faculty = c;
            facSel.disabled = false;
            this.renderFaculty();
          } else {
            facSel.innerHTML = '<option value="ALL">Loading materials...</option>';
          }
          waitForTable(null, this);
        }
      }

      semSel.addEventListener('change', () => {
        state.sem = semSel.value;
        if (state.sem) {
          persist.sem = state.sem;
          savePersist();
        }
        state.subj = '';
        state.fac = 'ALL';
        state.faculty = [];
        this.facPlaceholder('-- Select Subject First --');

        if (!state.sem) {
          subjSel.innerHTML = '<option value="">-- Select Semester First --</option>';
          subjSel.disabled = true;
          return;
        }
        this.renderSubjects();
      });

      subjSel.addEventListener('change', () => {
        const val = subjSel.value;
        if (!val) return;
        state.subj = val;
        state.fac = 'ALL';

        const cached = cacheGet(val);
        if (cached) {
          state.faculty = cached;
          facSel.disabled = false;
          this.renderFaculty();
        } else {
          state.faculty = [];
          this.facPlaceholder('Loading materials...');
        }

        const stale = this.findMaterialsTable();
        native.value = val;
        waitForTable(stale, this);
        native.dispatchEvent(new Event('change', { bubbles: true }));

        // Start at ALL Faculty for newly selected subject
        window.VTOP_PLUS?.CourseDownloader?.resetCourse?.();
        if (window.VTOP_PLUS?.CourseDownloader?.selectFaculty) {
          window.VTOP_PLUS.CourseDownloader.selectFaculty('ALL');
        }
      });

      facSel.addEventListener('change', () => {
        state.fac = facSel.value;
        this.applyFilter();
        if (window.VTOP_PLUS?.CourseDownloader?.selectFaculty) {
          window.VTOP_PLUS.CourseDownloader.selectFaculty(state.fac);
        }
      });
    },

    facPlaceholder(text) {
      const facSel = document.getElementById('vtop-fac-select');
      if (!facSel) return;
      facSel.innerHTML = '';
      const o = document.createElement('option');
      o.value = 'ALL';
      o.textContent = text;
      facSel.appendChild(o);
      facSel.disabled = true;
    },

    renderSubjects() {
      const sel = document.getElementById('vtop-subj-select');
      if (!sel) return;
      const list = state.courses[state.sem] || [];

      const frag = document.createDocumentFragment();
      const def = document.createElement('option');
      def.value = '';
      def.textContent = list.length
        ? `-- Choose Subject (${list.length} shown) --`
        : '-- No subjects found --';
      frag.appendChild(def);
      list.forEach((c) => {
        const o = document.createElement('option');
        o.value = c.value;
        o.textContent = c.label;
        frag.appendChild(o);
      });
      sel.replaceChildren(frag);
      sel.disabled = false;
      sel.value = list.some((c) => c.value === state.subj) ? state.subj : '';
    },

    renderFaculty() {
      const sel = document.getElementById('vtop-fac-select');
      if (!sel) return;
      const list = state.faculty;

      if (!list.some((f) => f.name === state.fac)) {
        state.fac = 'ALL';
      }

      const frag = document.createDocumentFragment();
      const all = document.createElement('option');
      all.value = 'ALL';
      all.textContent = `All Faculty (${list.length} shown)`;
      frag.appendChild(all);
      list.forEach((f) => {
        const o = document.createElement('option');
        o.value = f.name;
        o.textContent = `${f.name} (${f.count} files)`;
        frag.appendChild(o);
      });
      sel.replaceChildren(frag);
      sel.value = state.fac;
    },

    checkAndMountTableFilterBar() {
      const table = this.findMaterialsTable();
      if (!table) {
        const existing = document.getElementById(TABLE_BAR_ID);
        if (existing) existing.remove();
        return;
      }

      window.VTOP_PLUS?.DOM?.expandDataTableLength?.();

      const existingBar = document.getElementById(TABLE_BAR_ID);
      const targetParent = table.closest('.dataTables_wrapper') || table.parentNode;

      if (existingBar) {
        if (existingBar.parentNode === targetParent) return;
        existingBar.remove();
      }

      this.mountTableFilterBar(table, targetParent);
    },

    detectColumns(table) {
      // Exact #materialTable layout: #(0) | Course Detail(1) | Material Detail(2) | Uploaded By(3) | Download(4)
      if (table && table.id === 'materialTable') {
        state.facCol = 3;
        state.matCol = 2;
        state.courseCol = 1;
        return { facCol: 3, matCol: 2, courseCol: 1 };
      }

      let facCol = 3;
      let matCol = 2;
      let courseCol = 1;

      const headCells = table.querySelectorAll('thead th, thead td, tr:first-child th');
      headCells.forEach((th, idx) => {
        const text = th.textContent.toLowerCase();
        if (text.includes('uploaded by') || text.includes('faculty') || text.includes('teacher')) {
          facCol = idx;
        } else if (text.includes('material') || text.includes('description') || text.includes('topic')) {
          matCol = idx;
        } else if (text.includes('course') || text.includes('subject')) {
          courseCol = idx;
        }
      });
      state.facCol = facCol;
      state.matCol = matCol;
      state.courseCol = courseCol;
      return { facCol, matCol, courseCol };
    },

    mountTableFilterBar(table, targetParent) {
      const container = document.createElement('div');
      container.id = TABLE_BAR_ID;
      container.className = 'vtop-plus-filter-container';

      const isDark = document.documentElement.classList.contains('vtop-dark-theme') ||
                     document.body?.classList.contains('vtop-dark-theme') ||
                     window.VTOP_PLUS?.DarkMode?.isActive;

      const barBg = isDark ? '#131c2e' : '#ffffff';
      const barBorder = isDark ? '#293548' : '#e2e8f0';
      const inBg = isDark ? '#0f172a' : '#ffffff';
      const inBorder = isDark ? '#293548' : '#cbd5e1';
      const inColor = isDark ? '#f1f5f9' : '#0f172a';
      const btnBg = isDark ? '#1e293b' : '#f1f5f9';
      const btnBorder = isDark ? '#293548' : '#cbd5e1';
      const btnColor = isDark ? '#f1f5f9' : '#475569';

      container.style.cssText = `display:block;width:100%;box-sizing:border-box;background:${barBg} !important;background-color:${barBg} !important;border:1px solid ${barBorder} !important;border-radius:10px;padding:12px 16px;margin-bottom:12px;box-shadow:none !important;`;

      container.innerHTML = `
        <div class="vtop-filter-row" style="display:flex;align-items:center;gap:12px;width:100%;">
          <div class="vtop-filter-group" style="flex:1;display:flex;align-items:center;gap:8px;">
            <span class="vtop-filter-icon" style="display:inline-flex;align-items:center;color:${isDark ? '#94a3b8' : '#64748b'};"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></span>
            <input type="text" id="vtop-table-filter-search" class="vtop-filter-input" placeholder="Quick filter by topic, module, keyword..." style="width:100%;padding:8px 12px;border:1px solid ${inBorder} !important;border-radius:6px;font-size:13px;outline:none;background:${inBg} !important;background-color:${inBg} !important;color:${inColor} !important;box-sizing:border-box;" />
          </div>
          <button id="vtop-table-filter-reset" class="vtop-filter-btn" title="Reset Filters" style="background:${btnBg} !important;background-color:${btnBg} !important;border:1px solid ${btnBorder} !important;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;color:${btnColor} !important;white-space:nowrap;">Clear</button>
        </div>
      `;

      targetParent.insertBefore(container, targetParent.firstChild);

      const searchInput = document.getElementById('vtop-table-filter-search');
      const resetBtn = document.getElementById('vtop-table-filter-reset');

      searchInput?.addEventListener('focus', () => {
        window.VTOP_PLUS?.DOM?.expandDataTableLength?.();
      });

      searchInput?.addEventListener('input', () => {
        window.VTOP_PLUS?.DOM?.expandDataTableLength?.();
        state.topicQ = searchInput.value.toLowerCase().trim();
        this.applyFilter();
      });

      resetBtn?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        state.topicQ = '';
        state.fac = 'ALL';
        const facSel = document.getElementById('vtop-fac-select');
        if (facSel) facSel.value = 'ALL';
        this.applyFilter();
        if (window.VTOP_PLUS?.CourseDownloader?.selectFaculty) {
          window.VTOP_PLUS.CourseDownloader.selectFaculty('ALL');
        }
      });

      // Observe tbody so DataTables page changes automatically re-apply active filter
      const tbody = table.querySelector('tbody');
      if (tbody && !tbody.dataset.vtopFilterBound) {
        tbody.dataset.vtopFilterBound = 'true';
        let debounceTimer = null;
        const bodyObs = new MutationObserver(() => {
          if (state.topicQ || state.fac !== 'ALL') {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.applyFilter(), 40);
          }
        });
        bodyObs.observe(tbody, { childList: true });
      }
    },

    applyFilter() {
      const table = this.findMaterialsTable();
      if (!table) return;

      const cols = this.detectColumns(table);
      const query = (state.topicQ || '').toLowerCase().trim();
      const selectedFac = state.fac;

      // 1. Try driving DataTables' own search box if faculty is selected and no custom topic query
      const wrap = table.closest('.dataTables_wrapper, .dt-container') || document;
      const dtInput = wrap.querySelector('.dataTables_filter input, .dt-search input');
      if (dtInput) {
        const desiredVal = (selectedFac !== 'ALL' && !query) ? selectedFac : '';
        if (dtInput.value !== desiredVal && (desiredVal || dtInput.value)) {
          dtInput.value = desiredVal;
          dtInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      // 2. High-performance zero-reflow row filter:
      // Pass A: Read all textContent (zero layout reflows)
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const visibilityMap = new Array(rows.length);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) {
          visibilityMap[i] = true;
          continue;
        }

        const courseText = (cells[cols.courseCol]?.textContent || '').toLowerCase();
        const materialText = (cells[cols.matCol]?.textContent || '').toLowerCase();
        const teacherText = (cells[cols.facCol]?.textContent || '').toLowerCase();
        const rowText = (row.textContent || '').toLowerCase();

        const matchesTopic = !query || materialText.includes(query) || courseText.includes(query) || rowText.includes(query);
        const matchesFac = selectedFac === 'ALL' || teacherText.includes(selectedFac.toLowerCase());

        visibilityMap[i] = Boolean(matchesTopic && matchesFac);
      }

      // Pass B: Batch mutate DOM styles (no interleaved reads, locked 60 FPS)
      for (let i = 0; i < rows.length; i++) {
        const shouldShow = visibilityMap[i];
        const currentDisplay = rows[i].style.display;
        if (shouldShow && currentDisplay !== '') {
          rows[i].style.display = '';
        } else if (!shouldShow && currentDisplay !== 'none') {
          rows[i].style.display = 'none';
        }
      }
    },

    selectFaculty(facultyName) {
      const facSel = document.getElementById('vtop-fac-select');
      if (!facSel) return;

      if (!facultyName || facultyName === 'ALL' || facultyName === '__ALL__') {
        state.fac = 'ALL';
        facSel.value = 'ALL';
        this.applyFilter();
        return;
      }

      const target = facultyName.trim().toLowerCase();
      let matchedValue = null;

      for (const opt of facSel.options) {
        const val = opt.value.trim().toLowerCase();
        if (val === target || (val !== 'all' && (val.includes(target) || target.includes(val)))) {
          matchedValue = opt.value;
          break;
        }
      }

      if (matchedValue) {
        state.fac = matchedValue;
        facSel.value = matchedValue;
        this.applyFilter();
      }
    },

    syncTheme(isDark) {
      const container = document.getElementById(TABLE_BAR_ID);
      if (container) {
        const barBg = isDark ? '#131c2e' : '#ffffff';
        const barBorder = isDark ? '#293548' : '#e2e8f0';
        container.style.backgroundColor = barBg;
        container.style.background = barBg;
        container.style.borderColor = barBorder;

        const searchInput = document.getElementById('vtop-table-filter-search');
        if (searchInput) {
          const inBg = isDark ? '#0f172a' : '#ffffff';
          const inBorder = isDark ? '#293548' : '#cbd5e1';
          const inColor = isDark ? '#f1f5f9' : '#0f172a';
          searchInput.style.backgroundColor = inBg;
          searchInput.style.background = inBg;
          searchInput.style.borderColor = inBorder;
          searchInput.style.color = inColor;
        }

        const resetBtn = document.getElementById('vtop-table-filter-reset');
        if (resetBtn) {
          const btnBg = isDark ? '#1e293b' : '#f1f5f9';
          const btnBorder = isDark ? '#293548' : '#cbd5e1';
          const btnColor = isDark ? '#f1f5f9' : '#475569';
          resetBtn.style.backgroundColor = btnBg;
          resetBtn.style.background = btnBg;
          resetBtn.style.borderColor = btnBorder;
          resetBtn.style.color = btnColor;
        }
      }

      const topFilter = document.getElementById(UI_ID);
      if (topFilter) {
        topFilter.style.backgroundColor = isDark ? '#131c2e' : '#ffffff';
        topFilter.style.background = isDark ? '#131c2e' : '#ffffff';
        topFilter.style.borderColor = isDark ? '#293548' : '#cbd5e1';
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Table Observation & Faculty Extraction                            */
  /* ------------------------------------------------------------------ */

  function getTableSignature(table) {
    if (!table || !table.tBodies[0]) return '';
    const rows = table.tBodies[0].rows;
    const firstRow = rows[0];
    const firstText = firstRow ? (firstRow.textContent || '').trim().slice(0, 80) : '';
    return `${rows.length}|${firstText}`;
  }

  function waitForTable(stale, filterInstance) {
    stopWaiting();
    state.pending = {
      stale,
      staleSig: getTableSignature(stale),
      t0: Date.now()
    };
    setBusy(true);

    // React immediately when #page_outline receives the AJAX-injected #materialTable
    const watchRoot = document.getElementById('page_outline') || document.body;
    if (watchRoot) {
      state.waitObserver = new MutationObserver(() => tryExtract(filterInstance));
      state.waitObserver.observe(watchRoot, { childList: true, subtree: true });
    }

    state.timer = setInterval(() => tryExtract(filterInstance), POLL_MS);
    tryExtract(filterInstance);
  }

  function stopWaiting() {
    clearInterval(state.timer);
    state.timer = null;
    if (state.waitObserver) {
      state.waitObserver.disconnect();
      state.waitObserver = null;
    }
    state.pending = null;
    setBusy(false);
  }

  function tryExtract(filterInstance) {
    const p = state.pending;
    if (!p) return;
    const now = Date.now();
    const table = filterInstance.findMaterialsTable();

    if (table) {
      const sig = getTableSignature(table);
      const isNewTableNode = table !== p.stale;
      const isTableContentUpdated = Boolean(sig && sig !== p.staleSig);
      const isStaleFallbackReached = now - p.t0 >= STALE_MS;

      if (isNewTableNode || isTableContentUpdated || isStaleFallbackReached) {
        stopWaiting();
        finishExtraction(table, filterInstance);
        return;
      }
    }

    if (now - p.t0 >= 15000) {
      stopWaiting();
      filterInstance.facPlaceholder('Materials table timed out');
    }
  }

  function finishExtraction(table, filterInstance) {
    const tbody = table.tBodies[0];
    const beforeCount = tbody ? tbody.rows.length : 0;
    const expanded = window.VTOP_PLUS?.DOM?.expandDataTableLength ? window.VTOP_PLUS.DOM.expandDataTableLength() : false;

    const extractRows = () => {
      const cols = filterInstance.detectColumns(table);

      let counts = new Map();
      const rows = table.tBodies[0] ? table.tBodies[0].rows : [];
      for (let i = 0; i < rows.length; i++) {
        const c = rows[i].cells[cols.facCol];
        if (!c) continue;
        const f = cleanFaculty(c.innerHTML);
        if (f) counts.set(f, (counts.get(f) || 0) + 1);
      }

      state.faculty = Array.from(counts, ([name, count]) => ({
        name,
        count
      })).sort((a, b) => a.name.localeCompare(b.name));

      if (state.subj) cacheSet(state.subj, state.faculty);

      const facSel = document.getElementById('vtop-fac-select');
      if (!facSel) return;

      if (!state.faculty.length) {
        filterInstance.facPlaceholder('No materials found');
        return;
      }

      facSel.disabled = false;
      if (state.fac !== 'ALL' && !state.faculty.some((f) => f.name === state.fac)) {
        state.fac = 'ALL';
      }
      filterInstance.renderFaculty();
      filterInstance.checkAndMountTableFilterBar();

      // Auto-sync Downloader to current state (starts at 'ALL')
      if (window.VTOP_PLUS?.CourseDownloader?.selectFaculty) {
        window.VTOP_PLUS.CourseDownloader.selectFaculty(state.fac);
      }
    };

    if (!expanded) {
      extractRows();
      return;
    }

    // If DataTables updated synchronously on select change, extract immediately (0ms)
    const afterCount = tbody ? tbody.rows.length : 0;
    if (afterCount !== beforeCount) {
      extractRows();
      return;
    }

    // Otherwise observe tbody for instant redraw completion, with short 120ms fallback
    let done = false;
    let bodyObs = null;
    const runOnce = () => {
      if (done) return;
      done = true;
      if (bodyObs) bodyObs.disconnect();
      extractRows();
    };
    if (tbody) {
      bodyObs = new MutationObserver(runOnce);
      bodyObs.observe(tbody, { childList: true });
    }
    setTimeout(runOnce, 120);
  }

  window.VTOP_PLUS.CourseFilter = CourseFilter;
})();
