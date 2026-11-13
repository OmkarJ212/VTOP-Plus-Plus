/**
 * VTOP++ - Course Material Downloader Module
 * High-speed, rate-limit-safe batch downloader with teacher grouping,
 * instant STORE ZIP packaging, multi-page auto-traversal, and resilient DOM table observation.
 * Fully ported & integrated from vtop-downloader-extension.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const REGEX_COURSE_CODE = /([A-Z]{3,4}\d{3,4}[A-Z]?)/;
  const REGEX_CLEAN_TEACHER = /[^a-zA-Z0-9_\-\. ]/g;
  const REGEX_WHITESPACE = /[\r\n\t]+/g;
  const REGEX_SAFE_FILENAME = /[^a-zA-Z0-9_\-]/g;
  const REGEX_RFC5987 = /filename\*=(?:UTF-8''|utf-8'')((['"]).*?\2|[^;\n]*)/i;
  const REGEX_STD_FILENAME = /filename=((['"]).*?\2|[^;\n]*)/i;
  const REGEX_SPACES = /\s+/g;
  const REGEX_ILLEGAL_FS = /[\/\\:*?"<>|]/g;
  const REGEX_CTRL_CHARS = /[\x00-\x1f\x7f]/g;
  const REGEX_ONCLICK_FILEID = /downloadCourseMaterialFacultyPdf\s*\(\s*['"]?([a-zA-Z0-9_\-]+)['"]?/i;
  const REGEX_TOTAL_ENTRIES = /of\s+([\d,]+)\s+entries/i;

  const SELECTOR_DOWNLOAD_BTNS =
    'button#downloadmat[data-fileid], button[data-fileid], .download-btn[data-fileid], [data-fileid], [data-file-id], button[onclick*="downloadCourseMaterialFacultyPdf"], a[onclick*="downloadCourseMaterialFacultyPdf"], input[onclick*="downloadCourseMaterialFacultyPdf"]';

  function queryDownloadButtons() {
    const matTable = document.getElementById('materialTable');
    if (matTable) {
      const btns = matTable.querySelectorAll('button#downloadmat[data-fileid], button[data-fileid], .download-btn[data-fileid]');
      if (btns.length > 0) return btns;
    }
    return document.querySelectorAll(SELECTOR_DOWNLOAD_BTNS);
  }

  const allCourseFiles = new Map(); // fileId -> item
  let activeBaseCourseCode = null;
  let isDownloading = false;
  let cancelRequested = false;
  let isCrawlingPages = false;
  let hasAutoCrawled = false;
  let crawlGen = 0;

  function extractBaseCourseCode(code) {
    if (!code) return '';
    return code.replace(/[PEL]$/i, '');
  }

  const CourseDownloader = {
    selectedFaculty: '__ALL__',
    _observer: null,
    _statusTimer: null,

    getFileCount() {
      return allCourseFiles.size;
    },

    getActiveCourseCode() {
      return activeBaseCourseCode || 'Course';
    },

    resetCourse() {
      crawlGen++;
      allCourseFiles.clear();
      hasAutoCrawled = false;
      activeBaseCourseCode = null;
      this.selectedFaculty = '__ALL__';
    },

    isBusy() {
      return isCrawlingPages || isDownloading;
    },

    init() {
      if (isCrawlingPages || isDownloading) return;
      this.scanPageForMaterials();
    },

    destroy() {
      const panel = document.getElementById('vtop-zip-panel');
      if (panel && !isDownloading) {
        panel.style.display = 'none';
      }
    },

    openPanel() {
      let panel = document.getElementById('vtop-zip-panel');
      if (!panel) {
        this.renderPanel();
        panel = document.getElementById('vtop-zip-panel');
      }
      if (panel) {
        panel.style.display = 'block';
        panel.classList.remove('vtop-minimized');
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },

    async scanPageForMaterials() {
      const downloadButtons = queryDownloadButtons();
      if (!downloadButtons || downloadButtons.length === 0) {
        const panel = document.getElementById('vtop-zip-panel');
        if (panel && !isDownloading) {
          panel.style.display = 'none';
        }
        return;
      }

      const tbody = document.querySelector('#materialTable tbody, table tbody');
      const beforeCount = tbody ? tbody.rows.length : 0;
      const expanded = window.VTOP_PLUS?.DOM?.expandDataTableLength ? window.VTOP_PLUS.DOM.expandDataTableLength() : false;

      if (expanded && tbody && tbody.rows.length === beforeCount) {
        await new Promise((resolve) => {
          let done = false;
          let obs = null;
          const finish = () => {
            if (done) return;
            done = true;
            if (obs) obs.disconnect();
            resolve();
          };
          obs = new MutationObserver(finish);
          obs.observe(tbody, { childList: true });
          setTimeout(finish, 120);
        });
      }

      this.scanVisibleRows(expanded ? null : downloadButtons);

      if (allCourseFiles.size > 0) {
        this.renderPanel();
      }

      this.checkForMultiPageAndAutoCrawl();
    },

    scanVisibleRows(cachedButtons = null) {
      const downloadButtons = cachedButtons || queryDownloadButtons();
      if (!downloadButtons || downloadButtons.length === 0) return;

      // Detect if visible rows belong to a completely new course subject
      for (let i = 0; i < downloadButtons.length; i++) {
        const row = downloadButtons[i].closest('tr');
        if (!row) continue;
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const courseText = (cells[1]?.textContent || '').trim();
          const courseMatch = courseText.match(REGEX_COURSE_CODE);
          if (courseMatch) {
            const detectedBaseCode = extractBaseCourseCode(courseMatch[1]);
            if (activeBaseCourseCode && activeBaseCourseCode !== detectedBaseCode) {
              allCourseFiles.clear();
              hasAutoCrawled = false;
              this.selectedFaculty = '__ALL__';
            }
            activeBaseCourseCode = detectedBaseCode;
            break;
          }
        }
      }

      // Iterate through buttons, skipping already-cached rows
      for (let i = 0; i < downloadButtons.length; i++) {
        const btn = downloadButtons[i];
        let fileId = btn.getAttribute('data-fileid') || btn.getAttribute('data-file-id');
        if (!fileId) {
          const onclickAttr = btn.getAttribute('onclick') || '';
          const match = onclickAttr.match(REGEX_ONCLICK_FILEID);
          if (match && match[1]) {
            fileId = match[1];
          }
        }
        if (!fileId || allCourseFiles.has(fileId)) continue;

        const row = btn.closest('tr');
        if (!row) continue;

        const cells = row.querySelectorAll('td');
        let courseText = '';
        let materialText = '';
        let teacherText = 'Unknown Faculty';
        let uploadDate = '';

        if (cells.length >= 4) {
          courseText = (cells[1]?.textContent || '').trim();

          const matSpan = cells[2]?.querySelector('span');
          materialText = matSpan
            ? matSpan.textContent.trim()
            : ((cells[2]?.textContent)?.trim() || `Material_${fileId}`);
          materialText = materialText.replace(REGEX_WHITESPACE, ' ').trim();

          const facCell = cells[3];
          if (facCell) {
            const spans = facCell.querySelectorAll('span');
            if (spans.length >= 1) teacherText = spans[0].textContent.trim();
            if (spans.length >= 2) uploadDate = spans[1].textContent.trim();
            if (!teacherText || teacherText === 'Unknown Faculty') {
              const rawFac = (facCell.innerText || facCell.textContent || '').split('\n')[0].trim();
              const dateMatch = rawFac.match(/\s*(\d{2}-\d{2}-\d{4})\s*$/);
              if (dateMatch) {
                if (!uploadDate) uploadDate = dateMatch[1];
                teacherText = rawFac.slice(0, dateMatch.index).trim() || 'Unknown Faculty';
              } else if (rawFac) {
                teacherText = rawFac;
              }
            }
          }
        }

        const courseMatch = courseText.match(REGEX_COURSE_CODE);
        const courseCode = courseMatch ? courseMatch[1] : (activeBaseCourseCode || 'Course');
        const cleanTeacherName = teacherText.replace(REGEX_CLEAN_TEACHER, '').trim();

        allCourseFiles.set(fileId, {
          fileId,
          teacher: teacherText,
          cleanTeacher: cleanTeacherName,
          courseCode,
          courseText,
          materialText,
          uploadDate
        });
      }
    },

    getTableStateSnapshot() {
      const activeBtn = document.querySelector(
        '#materialTable_paginate .paginate_button.current, #materialTable_paginate .page-item.active, .paginate_button.current'
      );
      const activePage = activeBtn ? (activeBtn.textContent || '').trim() : '';
      const firstRow = document.querySelector('#materialTable tbody tr, table tbody tr');
      const firstRowText = firstRow ? (firstRow.textContent || '').trim().substring(0, 40) : '';
      const infoText = document.getElementById('materialTable_info')?.textContent ||
                       document.querySelector('.dataTables_info')?.textContent || '';
      return `${activePage}|${firstRowText}|${infoText}`;
    },

    async waitForTableStateChange(oldSnapshot, maxWaitMs = 2500) {
      return new Promise((resolve) => {
        let settled = false;
        let obs = null;
        let pollTimer = null;
        let timeoutTimer = null;

        const finish = (changed) => {
          if (settled) return;
          settled = true;
          if (obs) obs.disconnect();
          if (pollTimer) clearInterval(pollTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve(changed);
        };

        const check = () => {
          if (this.getTableStateSnapshot() !== oldSnapshot) {
            setTimeout(() => finish(true), 20);
          }
        };

        const tbody = document.querySelector('#materialTable tbody, table tbody');
        if (tbody) {
          obs = new MutationObserver(check);
          obs.observe(tbody, { childList: true });
        }

        pollTimer = setInterval(check, 50);
        timeoutTimer = setTimeout(() => finish(false), maxWaitMs);
      });
    },

    async checkForMultiPageAndAutoCrawl() {
      if (hasAutoCrawled || isCrawlingPages || isDownloading) return;

      const nextLi =
        document.getElementById('materialTable_next') ||
        document.querySelector('#materialTable_paginate .next, .paginate_button.next');
      const isNextAvailable =
        nextLi && !nextLi.classList.contains('disabled') && nextLi.getAttribute('aria-disabled') !== 'true';

      const infoElem =
        document.getElementById('materialTable_info') || document.querySelector('.dataTables_info');
      let totalEntries = 0;
      if (infoElem) {
        const match = (infoElem.innerText || infoElem.textContent || '').match(REGEX_TOTAL_ENTRIES);
        if (match) totalEntries = parseInt(match[1].replace(/,/g, ''), 10);
      }

      if (isNextAvailable || totalEntries > allCourseFiles.size) {
        hasAutoCrawled = true;
        await this.crawlAllPages();
      }
    },

    async crawlAllPages() {
      if (isCrawlingPages) return;
      isCrawlingPages = true;
      const gen = crawlGen;

      try {
        this.showStatus('Scanning all pages for materials...', 3000);
        this.updateFileCountLabel('Scanning pages...');

        let maxPages = 20;
        while (maxPages-- > 0) {
          if (crawlGen !== gen) return;
          this.scanVisibleRows();

          const nextLi =
            document.getElementById('materialTable_next') ||
            document.querySelector('#materialTable_paginate .next, .paginate_button.next');
          if (!nextLi || nextLi.classList.contains('disabled') || nextLi.getAttribute('aria-disabled') === 'true') {
            break;
          }

          const nextA = nextLi.querySelector('a') || nextLi;
          const snapshot = this.getTableStateSnapshot();
          nextA.click();
          await this.waitForTableStateChange(snapshot, 2500);
          if (crawlGen !== gen) return;
        }

        this.scanVisibleRows();

        // Return to page 1
        const firstBtn =
          document.getElementById('materialTable_first') ||
          document.querySelector('#materialTable_paginate .first a, #materialTable_paginate .paginate_button.first');
        let targetBtn = firstBtn;
        if (!targetBtn) {
          const pageLinks = document.querySelectorAll(
            '#materialTable_paginate .paginate_button, #materialTable_paginate .page-link, #materialTable_paginate a'
          );
          for (const btn of pageLinks) {
            const txt = (btn.innerText || btn.textContent || '').trim();
            if (txt === '1') {
              targetBtn = btn;
              break;
            }
          }
        }

        if (targetBtn) {
          const snapshot = this.getTableStateSnapshot();
          targetBtn.click();
          await this.waitForTableStateChange(snapshot, 1500);
          if (crawlGen !== gen) return;
        }

        this.updateFacultyDropdown();
        this.showStatus(`Found ${allCourseFiles.size} materials across all pages.`, 4000);
      } finally {
        isCrawlingPages = false;
      }
    },

    getTeachersMap() {
      const map = new Map();
      allCourseFiles.forEach((item) => {
        let group = map.get(item.teacher);
        if (!group) {
          group = [];
          map.set(item.teacher, group);
        }
        group.push(item);
      });
      return map;
    },

    renderPanel() {
      let panel = document.getElementById('vtop-zip-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'vtop-zip-panel';
        panel.className = 'vtop-plus-panel';
        panel.innerHTML = `
          <div class="vtop-panel-header" id="vtop-panel-header">
            <div class="vtop-panel-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
              <span>VTOP Material Downloader</span>
            </div>
            <div class="vtop-panel-actions">
              <button class="vtop-icon-btn" id="vtop-min-btn" title="Minimize/Maximize">_</button>
            </div>
          </div>
          <div class="vtop-panel-body">
            <div class="vtop-form-group">
              <label class="vtop-form-label" for="vtop-faculty-select">Faculty:</label>
              <select class="vtop-form-select" id="vtop-faculty-select"></select>
            </div>

            <div class="vtop-form-group">
              <label class="vtop-form-label" for="vtop-regno-input">Registration No:</label>
              <input class="vtop-form-input" type="text" id="vtop-regno-input" placeholder="e.g. 24BCE0000" />
            </div>

            <div class="vtop-form-group">
              <label class="vtop-form-label" for="vtop-speed-select">Download Speed:</label>
              <select class="vtop-form-select" id="vtop-speed-select">
                <option value="human" selected>Human (1.6s – 2.6s delay)</option>
                <option value="fast">Fast</option>
              </select>
            </div>

            <div class="vtop-meta-info">
              <span id="vtop-file-count">0 files detected</span>
              <button type="button" id="vtop-rescan-pages-btn" style="background: none; border: none; padding: 0; font: inherit; cursor: pointer; color: var(--vtop-accent-sky); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>Scan All Pages</button>
            </div>

            <div class="vtop-btn-row">
              <button class="vtop-download-btn" id="vtop-start-btn" style="flex: 1;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span>Download All as .ZIP</span>
              </button>
              <button class="vtop-cancel-btn" id="vtop-cancel-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                <span>Cancel</span>
              </button>
            </div>

            <div class="vtop-progress-container" id="vtop-progress-box">
              <div class="vtop-progress-bar-bg">
                <div class="vtop-progress-bar-fill" id="vtop-progress-bar"></div>
              </div>
              <div class="vtop-progress-text" id="vtop-progress-label">Preparing downloads...</div>
            </div>

            <div class="vtop-status-msg" id="vtop-status-msg"></div>
          </div>
        `;
        document.body.appendChild(panel);

        const header = document.getElementById('vtop-panel-header');
        const minBtn = document.getElementById('vtop-min-btn');
        minBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          panel.classList.toggle('vtop-minimized');
        });
        header.addEventListener('dblclick', () => {
          panel.classList.toggle('vtop-minimized');
        });

        // Draggable floating panel via header
        header.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || e.target.closest('#vtop-min-btn, button')) return;
          const startX = e.clientX;
          const startY = e.clientY;
          const rect = panel.getBoundingClientRect();
          let dragging = false;

          const onMouseMove = (moveEvt) => {
            const dx = moveEvt.clientX - startX;
            const dy = moveEvt.clientY - startY;
            if (!dragging && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            if (!dragging) {
              dragging = true;
              panel.classList.add('vtop-panel-dragging');
              panel.style.right = 'auto';
              panel.style.bottom = 'auto';
            }
            const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
            const nextLeft = Math.min(maxLeft, Math.max(0, rect.left + dx));
            const nextTop = Math.min(maxTop, Math.max(0, rect.top + dy));
            panel.style.left = `${nextLeft}px`;
            panel.style.top = `${nextTop}px`;
          };

          const onMouseUp = () => {
            if (dragging) {
              panel.classList.remove('vtop-panel-dragging');
            }
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        });

        document.getElementById('vtop-start-btn').addEventListener('click', () => this.handleDownloadAll());
        document.getElementById('vtop-cancel-btn').addEventListener('click', () => {
          if (isDownloading) {
            cancelRequested = true;
            this.showStatus('Cancelling after current file...', 3000);
          }
        });
        document.getElementById('vtop-rescan-pages-btn').addEventListener('click', (e) => {
          e.preventDefault();
          this.crawlAllPages();
        });
        const facSel = document.getElementById('vtop-faculty-select');
        facSel.addEventListener('change', () => {
          this.selectedFaculty = facSel.value;
          this.updateFileCountLabel();
          if (window.VTOP_PLUS?.CourseFilter?.selectFaculty) {
            window.VTOP_PLUS.CourseFilter.selectFaculty(this.selectedFaculty === '__ALL__' ? 'ALL' : this.selectedFaculty);
          }
        });

        const regInput = document.getElementById('vtop-regno-input');
        regInput.addEventListener('input', () => {
          const val = regInput.value.trim().toUpperCase();
          if (chrome?.storage?.local) chrome.storage.local.set({ vtop_reg_no: val });
        });

        const speedSelect = document.getElementById('vtop-speed-select');
        speedSelect.addEventListener('change', () => {
          if (chrome?.storage?.local) {
            chrome.storage.local.set({
              vtop_speed_mode: speedSelect.value,
              downloadPacing: speedSelect.value
            });
          }
        });
      }

      panel.style.display = 'block';
      this.populateRegistrationNumber();
      this.loadSavedSettings();
      this.updateFacultyDropdown();
    },

    updateFacultyDropdown() {
      const facultySelect = document.getElementById('vtop-faculty-select');
      if (!facultySelect) return;

      const teachersMap = this.getTeachersMap();
      let currentSignature = `${allCourseFiles.size}`;
      teachersMap.forEach((files, teacher) => {
        currentSignature += `|${teacher}:${files.length}`;
      });

      if (facultySelect.dataset.signature === currentSignature) {
        this.updateFileCountLabel();
        return;
      }
      facultySelect.dataset.signature = currentSignature;

      const previousSelection = this.selectedFaculty || facultySelect.value;
      facultySelect.innerHTML = '';

      const allOpt = document.createElement('option');
      allOpt.value = '__ALL__';
      allOpt.textContent = `All Faculty (${allCourseFiles.size} total files)`;
      facultySelect.appendChild(allOpt);

      teachersMap.forEach((files, teacher) => {
        const opt = document.createElement('option');
        opt.value = teacher;
        opt.textContent = `${teacher} (${files.length} files)`;
        facultySelect.appendChild(opt);
      });

      if (previousSelection && previousSelection !== '__ALL__' && [...facultySelect.options].some((o) => o.value === previousSelection)) {
        facultySelect.value = previousSelection;
      } else {
        facultySelect.value = '__ALL__';
        this.selectedFaculty = '__ALL__';
      }

      this.updateFileCountLabel();
    },

    selectFaculty(facultyName) {
      const select = document.getElementById('vtop-faculty-select');
      if (!select) return;

      if (!facultyName || facultyName === 'ALL' || facultyName === '__ALL__') {
        this.selectedFaculty = '__ALL__';
        select.value = '__ALL__';
        this.updateFileCountLabel();
        return;
      }

      const target = facultyName.trim().toLowerCase();
      let matchedValue = null;

      for (const opt of select.options) {
        if (opt.value.trim().toLowerCase() === target) {
          matchedValue = opt.value;
          break;
        }
      }

      if (!matchedValue) {
        for (const opt of select.options) {
          const optVal = opt.value.trim().toLowerCase();
          if (optVal !== '__all__' && (optVal.includes(target) || target.includes(optVal))) {
            matchedValue = opt.value;
            break;
          }
        }
      }

      if (matchedValue) {
        this.selectedFaculty = matchedValue;
        select.value = matchedValue;
        this.updateFileCountLabel();
      }
    },

    loadSavedSettings() {
      if (chrome?.storage?.local) {
        chrome.storage.local.get(['vtop_speed_mode', 'downloadPacing'], (res) => {
          let speed = res?.downloadPacing || res?.vtop_speed_mode;
          if (speed === 'safe' || speed === 'stealth') speed = 'human';
          if (speed) {
            const speedSelect = document.getElementById('vtop-speed-select');
            if (speedSelect) speedSelect.value = speed;
          }
        });
      }
    },

    populateRegistrationNumber() {
      const regInput = document.getElementById('vtop-regno-input');
      if (!regInput || regInput.value) return;

      const fillFromDom = () => {
        const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : '';
        if (authId) regInput.value = authId;
      };

      if (chrome?.storage?.local) {
        chrome.storage.local.get(['vtop_reg_no'], (res) => {
          if (res && res.vtop_reg_no) {
            regInput.value = res.vtop_reg_no;
            return;
          }
          fillFromDom();
        });
      } else {
        fillFromDom();
      }
    },

    updateFileCountLabel(customText = null) {
      const facultySelect = document.getElementById('vtop-faculty-select');
      const countLabel = document.getElementById('vtop-file-count');
      if (!countLabel) return;

      if (customText) {
        countLabel.textContent = customText;
        return;
      }

      if (!facultySelect) return;
      const selectedTeacher = facultySelect.value;
      const teachersMap = this.getTeachersMap();

      if (selectedTeacher === '__ALL__') {
        countLabel.textContent = `${allCourseFiles.size} total files detected`;
      } else {
        const files = teachersMap.get(selectedTeacher) || [];
        countLabel.textContent = `${files.length} files detected`;
      }
    },

    showStatus(text, autoHideMs = 0) {
      const msg = document.getElementById('vtop-status-msg');
      if (!msg) return;
      if (this._statusTimer) {
        clearTimeout(this._statusTimer);
        this._statusTimer = null;
      }
      msg.textContent = text;
      msg.style.display = 'block';
      if (autoHideMs > 0) {
        this._statusTimer = setTimeout(() => {
          msg.style.display = 'none';
          this._statusTimer = null;
        }, autoHideMs);
      }
    },

    getDelayMs(mode) {
      if (mode === 'fast') {
        return Math.floor(400 + Math.random() * 350);
      }
      // 'human' mode: natural human clicking pace with jitter
      return Math.floor(1600 + Math.random() * 1000);
    },

    sanitizeFileName(name) {
      if (!name || typeof name !== 'string') return '';
      const cleaned = name
        .replace(REGEX_CTRL_CHARS, '')
        .replace(REGEX_ILLEGAL_FS, '_')
        .replace(REGEX_WHITESPACE, ' ')
        .trim()
        .replace(/^\.+/, '')
        .trim();
      if (!cleaned || cleaned === '.' || cleaned === '..') return '';
      return cleaned;
    },

    base64ToArrayBuffer(base64) {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    },

    async handleDownloadAll() {
      if (isDownloading) return;

      const facultySelect = document.getElementById('vtop-faculty-select');
      const regInput = document.getElementById('vtop-regno-input');
      const speedSelect = document.getElementById('vtop-speed-select');
      const startBtn = document.getElementById('vtop-start-btn');
      const cancelBtn = document.getElementById('vtop-cancel-btn');
      const progressBox = document.getElementById('vtop-progress-box');
      const progressBar = document.getElementById('vtop-progress-bar');
      const progressLabel = document.getElementById('vtop-progress-label');

      const selectedTeacher = facultySelect ? facultySelect.value : '__ALL__';
      const regNo = regInput ? regInput.value.trim().toUpperCase() : '';
      let speedMode = speedSelect ? speedSelect.value : 'human';
      if (speedMode === 'safe' || speedMode === 'stealth') speedMode = 'human';

      if (!regNo) {
        alert('Please enter your Student Registration Number (e.g. 24BCE0000).');
        if (regInput) regInput.focus();
        return;
      }

      const csrfToken = window.VTOP_PLUS?.DOM?.getCsrfToken ? window.VTOP_PLUS.DOM.getCsrfToken() : '';
      if (!csrfToken) {
        alert('Unable to automatically detect the VTOP CSRF Token. Please refresh the page and try again.');
        return;
      }

      const teachersMap = this.getTeachersMap();
      let filesToDownload = [];
      if (selectedTeacher === '__ALL__') {
        filesToDownload = Array.from(allCourseFiles.values());
      } else {
        filesToDownload = teachersMap.get(selectedTeacher) || [];
      }

      if (filesToDownload.length === 0) {
        alert('No files found to download. Please make sure the course materials table is visible.');
        return;
      }

      if (typeof JSZip === 'undefined') {
        alert('JSZip library is not loaded. Please reload the extension.');
        return;
      }

      isDownloading = true;
      cancelRequested = false;
      if (startBtn) startBtn.disabled = true;
      if (facultySelect) facultySelect.disabled = true;
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
      if (progressBox) progressBox.style.display = 'flex';
      if (progressBar) progressBar.style.width = '0%';
      if (progressLabel) progressLabel.textContent = `Starting download of ${filesToDownload.length} files...`;

      const zip = new JSZip();
      const usedFileNames = new Set();
      let downloadedCount = 0;
      let failedCount = 0;

      const courseCode = filesToDownload[0]?.courseCode || 'VTOP';
      const cleanTeacherName =
        selectedTeacher === '__ALL__'
          ? 'All_Faculty'
          : (filesToDownload[0]?.cleanTeacher || 'Faculty').replace(REGEX_SPACES, '_');

      try {
        for (let i = 0; i < filesToDownload.length; i++) {
          if (cancelRequested) {
            this.showStatus('Download stopped by user.', 3000);
            break;
          }

          const fileInfo = filesToDownload[i];
          const percent = Math.round((i / filesToDownload.length) * 100);
          if (progressBar) progressBar.style.width = `${percent}%`;
          if (progressLabel)
            progressLabel.textContent = `[${i + 1}/${filesToDownload.length}] Downloading: ${fileInfo.materialText}...`;

          try {
            const fileData = await this.fetchSingleMaterial(fileInfo, regNo, csrfToken);

            let fileName = fileData.fileName;
            if (!fileName) {
              const safeMatText = fileInfo.materialText.replace(REGEX_SAFE_FILENAME, '_').substring(0, 40);
              const ext = this.getExtensionFromContentType(fileData.contentType);
              fileName = `${fileInfo.courseCode}_${safeMatText}_${fileInfo.fileId}.${ext}`;
            }

            fileName = this.sanitizeFileName(fileName) || `Material_${fileInfo.fileId}.${this.getExtensionFromContentType(fileData.contentType)}`;

            let uniqueName = fileName;
            let counter = 1;
            while (usedFileNames.has(uniqueName)) {
              const lastDot = fileName.lastIndexOf('.');
              if (lastDot !== -1) {
                const base = fileName.substring(0, lastDot);
                const ext = fileName.substring(lastDot);
                uniqueName = `${base}_(${counter})${ext}`;
              } else {
                uniqueName = `${fileName}_(${counter})`;
              }
              counter++;
            }
            usedFileNames.add(uniqueName);

            zip.file(uniqueName, fileData.arrayBuffer, { binary: true });
            downloadedCount++;
          } catch (err) {
            console.error(`[VTOP++] Failed file ${fileInfo.fileId}:`, err);
            failedCount++;

            if (
              err.message &&
              (err.message.includes('session expired') || err.message.includes('429') || err.message.includes('logged out'))
            ) {
              alert(`Rate Limit / Session Guard:\n${err.message}`);
              break;
            }
          }

          if (i < filesToDownload.length - 1 && !cancelRequested) {
            const delayMs = this.getDelayMs(speedMode);
            for (let rem = delayMs; rem > 0; rem -= 200) {
              if (cancelRequested) break;
              if (progressLabel)
                progressLabel.textContent = `[${i + 1}/${filesToDownload.length}] Waiting ${(rem / 1000).toFixed(1)}s before next file...`;
              await new Promise((r) => setTimeout(r, Math.min(200, rem)));
            }
          }
        }

        if (downloadedCount > 0) {
          if (progressBar) progressBar.style.width = '95%';
          if (progressLabel) progressLabel.textContent = 'Creating .ZIP archive...';

          const zipBlob = await zip.generateAsync(
            {
              type: 'blob',
              compression: 'STORE'
            },
            (metadata) => {
              if (progressBar) progressBar.style.width = `${Math.round(metadata.percent)}%`;
            }
          );

          const suffix = cancelRequested ? '_Partial' : '';
          const zipFileName = this.sanitizeFileName(`${courseCode}_${cleanTeacherName}_Materials${suffix}.zip`) || 'Course_Materials.zip';
          this.triggerBlobDownload(zipBlob, zipFileName);

          if (progressBar) progressBar.style.width = '100%';
          if (progressLabel) progressLabel.textContent = `Finished! ${downloadedCount} files zipped. (${failedCount} failed)`;
          this.showStatus(`Saved as ${zipFileName}`, 5000);
        } else {
          if (progressLabel) progressLabel.textContent = 'No files downloaded.';
        }
      } catch (globalErr) {
        console.error('[VTOP++] Error during batch download:', globalErr);
        alert('An error occurred while downloading: ' + globalErr.message);
      } finally {
        isDownloading = false;
        cancelRequested = false;
        if (startBtn) startBtn.disabled = false;
        if (facultySelect) facultySelect.disabled = false;
        if (cancelBtn) cancelBtn.style.display = 'none';
      }
    },

    /**
     * Request single file with dual-layer engine:
     * 1. Background Service Worker (immune to CSP & redirect CORS)
     * 2. Direct Content-Script fetch fallback
     */
    async fetchSingleMaterial(fileInfo, regNo, csrfToken) {
      const fileId = fileInfo.fileId;
      const basePath = window.VTOP_PLUS?.DOM?.getBasePath ? window.VTOP_PLUS.DOM.getBasePath() : 'vtop';
      const targetUrl = `${window.location.origin}/${basePath}/downloadCourseMaterialFacultyPdf`;

      const formData = new URLSearchParams();
      if (csrfToken) formData.append('_csrf', csrfToken);
      formData.append('authorizedID', regNo);
      formData.append('fileId', fileId);
      const bodyString = formData.toString();

      const customHeaders = {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: '*/*'
      };
      if (csrfToken) {
        customHeaders['X-CSRF-TOKEN'] = csrfToken;
      }

      let lastError = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          // Attempt 1: Try via Background Service Worker (immune to CSP & redirect CORS)
          let bgResult = null;
          try {
            bgResult = await new Promise((resolve) => {
              if (!chrome?.runtime?.sendMessage) return resolve(null);
              chrome.runtime.sendMessage(
                {
                  action: 'FETCH_MATERIAL',
                  url: targetUrl,
                  body: bodyString,
                  headers: customHeaders,
                  timeoutMs: 25000
                },
                (response) => {
                  if (chrome.runtime.lastError) return resolve(null);
                  resolve(response);
                }
              );
            });
          } catch (_) {
            bgResult = null;
          }

          let arrayBuffer = null;
          let contentType = '';
          let contentDisposition = '';

          let bgHandled = false;
          if (bgResult && bgResult.success && bgResult.base64Data) {
            arrayBuffer = this.base64ToArrayBuffer(bgResult.base64Data);
            contentType = bgResult.contentType || '';
            contentDisposition = bgResult.contentDisposition || '';
            bgHandled = true;
          } else if (bgResult && bgResult.error && bgResult.error.includes('429')) {
            throw new Error('HTTP 429: VTOP has temporarily rate-limited downloads. Please wait a few minutes.');
          }

          if (!bgHandled) {
            // Attempt 2: Fallback to direct fetch in page context
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            try {
              const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  ...customHeaders
                },
                body: bodyString,
                credentials: 'include',
                redirect: 'follow',
                signal: controller.signal
              });

              if (response.status === 429) {
                throw new Error('HTTP 429: VTOP has temporarily rate-limited downloads. Please wait a few minutes.');
              }

              if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
              }

              contentType = response.headers.get('content-type') || '';
              contentDisposition = response.headers.get('content-disposition') || '';
              arrayBuffer = await response.arrayBuffer();
            } finally {
              clearTimeout(timeoutId);
            }
          }

          if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            throw new Error('Empty response received from server (0 bytes).');
          }

          if (contentType.includes('text/html') || (!contentDisposition && arrayBuffer.byteLength < 5000)) {
            const textPreview = new TextDecoder().decode(arrayBuffer.slice(0, 1000));
            if (
              textPreview.includes('login') ||
              textPreview.includes('Login') ||
              textPreview.includes('session') ||
              textPreview.includes('Session Timeout')
            ) {
              throw new Error('VTOP session expired or logged out. Pausing downloads to protect your account.');
            }
            if (contentType.includes('text/html')) {
              throw new Error('Received an HTML error response instead of the requested material file.');
            }
          }

          let fileName = null;
          if (contentDisposition) {
            const rfcMatch = contentDisposition.match(REGEX_RFC5987);
            if (rfcMatch && rfcMatch[1]) {
              const raw = rfcMatch[1].replace(/['"]/g, '').trim();
              try {
                fileName = decodeURIComponent(raw);
              } catch (_) {
                fileName = raw;
              }
            } else {
              const stdMatch = contentDisposition.match(REGEX_STD_FILENAME);
              if (stdMatch && stdMatch[1]) {
                fileName = stdMatch[1].replace(/['"]/g, '').trim();
              }
            }
          }

          return {
            arrayBuffer,
            fileName,
            contentType
          };
        } catch (err) {
          lastError = err;
          if (
            err.message &&
            (err.message.includes('429') ||
              err.message.includes('rate-limited') ||
              err.message.includes('session expired') ||
              err.message.includes('logged out'))
          ) {
            throw err;
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      throw lastError || new Error('Download failed after retries.');
    },

    getExtensionFromContentType(contentType) {
      if (contentType.includes('application/pdf')) return 'pdf';
      if (contentType.includes('application/zip')) return 'zip';
      if (contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml')) return 'docx';
      if (contentType.includes('application/vnd.openxmlformats-officedocument.presentationml')) return 'pptx';
      if (contentType.includes('image/png')) return 'png';
      if (contentType.includes('image/jpeg')) return 'jpg';
      return 'pdf';
    },

    triggerBlobDownload(blob, fileName) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 10000);
    }
  };

  window.VTOP_PLUS.CourseDownloader = CourseDownloader;
})();
