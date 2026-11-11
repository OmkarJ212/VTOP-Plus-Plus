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
  const REGEX_REG_NO = /\b(2[0-9][A-Z]{3}[0-9]{4,5})\b/i;
  const REGEX_CONTENT_DISPOSITION = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i;
  const REGEX_SPACES = /\s+/g;
  const REGEX_ILLEGAL_FS = /[\/\\:*?"<>|]/g;
  const REGEX_ONCLICK_FILEID = /downloadCourseMaterialFacultyPdf\s*\(\s*['"]?([a-zA-Z0-9_\-]+)['"]?/i;
  const REGEX_TOTAL_ENTRIES = /of\s+([\d,]+)\s+entries/i;

  const SELECTOR_DOWNLOAD_BTNS =
    'button[data-fileid], .download-btn[data-fileid], [data-fileid], [data-file-id], button[onclick*="downloadCourseMaterialFacultyPdf"], a[onclick*="downloadCourseMaterialFacultyPdf"], input[onclick*="downloadCourseMaterialFacultyPdf"]';

  const allCourseFiles = new Map(); // fileId -> item
  let activeBaseCourseCode = null;
  let isDownloading = false;
  let cancelRequested = false;
  let isCrawlingPages = false;
  let hasAutoCrawled = false;

  function extractBaseCourseCode(code) {
    if (!code) return '';
    return code.replace(/[PEL]$/i, '');
  }

  const CourseDownloader = {
    selectedFaculty: '__ALL__',
    _watchdogTimer: null,
    _observer: null,

    getFileCount() {
      return allCourseFiles.size;
    },

    getActiveCourseCode() {
      return activeBaseCourseCode || 'Course';
    },

    resetCourse() {
      allCourseFiles.clear();
      hasAutoCrawled = false;
      activeBaseCourseCode = null;
      this.selectedFaculty = '__ALL__';
    },

    init() {
      this.setupObserver();
      this.startWatchdogTimer();
      this.scanPageForMaterials();
    },

    setupObserver() {
      if (this._observer) return;
      this._observer = new MutationObserver((mutations) => {
        if (isCrawlingPages || isDownloading) return;

        const isInternal = mutations.every((m) => {
          return m.target && (m.target.id === 'vtop-zip-panel' || Boolean(m.target.closest && m.target.closest('#vtop-zip-panel')));
        });
        if (isInternal) return;

        if (window.__vtop_dl_scan_timeout) clearTimeout(window.__vtop_dl_scan_timeout);
        window.__vtop_dl_scan_timeout = setTimeout(() => {
          this.scanPageForMaterials();
        }, 300);
      });

      const target = document.body || document.documentElement;
      if (target) {
        this._observer.observe(target, { childList: true, subtree: true });
      }
    },

    startWatchdogTimer() {
      if (this._watchdogTimer) clearInterval(this._watchdogTimer);
      this._watchdogTimer = setInterval(() => {
        if (isDownloading || isCrawlingPages) return;
        const downloadButtons = document.querySelectorAll(SELECTOR_DOWNLOAD_BTNS);
        const panel = document.getElementById('vtop-zip-panel');
        const isPanelVisible = panel && panel.style.display !== 'none';

        if (downloadButtons.length > 0 && (!panel || !isPanelVisible)) {
          this.scanPageForMaterials();
        }
      }, 2000);
    },

    scan() {
      return this.scanPageForMaterials();
    },

    destroy() {
      if (this._watchdogTimer) {
        clearInterval(this._watchdogTimer);
        this._watchdogTimer = null;
      }
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
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
      const downloadButtons = document.querySelectorAll(SELECTOR_DOWNLOAD_BTNS);
      if (!downloadButtons || downloadButtons.length === 0) {
        const panel = document.getElementById('vtop-zip-panel');
        if (panel && !isDownloading) {
          panel.style.display = 'none';
        }
        return;
      }

      this.autoExpandLengthTo100();
      this.scanVisibleRows(downloadButtons);

      if (allCourseFiles.size > 0) {
        this.renderPanel();
      }

      this.checkForMultiPageAndAutoCrawl();
    },

    autoExpandLengthTo100() {
      const lengthSelect = document.querySelector('select[name="materialTable_length"], select[name$="_length"]');
      if (lengthSelect && lengthSelect.value !== '100' && lengthSelect.value !== '-1') {
        let targetOption =
          lengthSelect.querySelector('option[value="100"]') ||
          lengthSelect.querySelector('option[value="-1"]');

        if (!targetOption) {
          let maxVal = 0;
          for (const opt of lengthSelect.options) {
            const val = parseInt(opt.value, 10);
            if (val > maxVal) {
              maxVal = val;
              targetOption = opt;
            }
          }
        }

        if (targetOption && lengthSelect.value !== targetOption.value) {
          lengthSelect.value = targetOption.value;
          lengthSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    },

    scanVisibleRows(cachedButtons = null) {
      const downloadButtons = cachedButtons || document.querySelectorAll(SELECTOR_DOWNLOAD_BTNS);
      if (!downloadButtons || downloadButtons.length === 0) return;

      // Detect if visible rows belong to a completely new course subject
      for (let i = 0; i < downloadButtons.length; i++) {
        const row = downloadButtons[i].closest('tr');
        if (!row) continue;
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const courseText = (cells[1]?.innerText || cells[1]?.textContent || '').trim();
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
          courseText = (cells[1]?.innerText || cells[1]?.textContent || '').trim();

          const matSpan = cells[2]?.querySelector('span');
          materialText = matSpan
            ? (matSpan.innerText || matSpan.textContent).trim()
            : ((cells[2]?.innerText || cells[2]?.textContent)?.trim() || `Material_${fileId}`);
          materialText = materialText.replace(REGEX_WHITESPACE, ' ').trim();

          const facCell = cells[3];
          if (facCell) {
            const spans = facCell.querySelectorAll('span');
            if (spans.length >= 1) teacherText = (spans[0].innerText || spans[0].textContent).trim();
            if (spans.length >= 2) uploadDate = (spans[1].innerText || spans[1].textContent).trim();
            if (!teacherText) teacherText = (facCell.innerText || facCell.textContent).split('\n')[0].trim();
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
      const activePage = activeBtn ? (activeBtn.innerText || activeBtn.textContent || '').trim() : '';
      const firstRow = document.querySelector('#materialTable tbody tr, table tbody tr');
      const firstRowText = firstRow ? (firstRow.innerText || firstRow.textContent || '').substring(0, 40) : '';
      const infoText =
        document.querySelector('#materialTable_info, .dataTables_info')?.innerText ||
        document.querySelector('#materialTable_info, .dataTables_info')?.textContent ||
        '';
      return `${activePage}|${firstRowText}|${infoText}`;
    },

    async waitForTableStateChange(oldSnapshot, maxWaitMs = 2500) {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 100));
        const newSnapshot = this.getTableStateSnapshot();
        if (newSnapshot !== oldSnapshot) {
          await new Promise((r) => setTimeout(r, 150));
          return true;
        }
      }
      return false;
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

      this.showStatus('Scanning all pages for materials...', 3000);
      this.updateFileCountLabel('Scanning pages...');

      let maxPages = 20;
      while (maxPages-- > 0) {
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
      }

      isCrawlingPages = false;
      this.updateFacultyDropdown();
      this.showStatus(`Captured all ${allCourseFiles.size} materials across all pages!`, 4000);
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
              <span>📦</span>
              <span>VTOP Material Downloader</span>
            </div>
            <div class="vtop-panel-actions">
              <button class="vtop-icon-btn" id="vtop-min-btn" title="Minimize/Maximize">_</button>
            </div>
          </div>
          <div class="vtop-panel-body">
            <div class="vtop-form-group">
              <label class="vtop-form-label" for="vtop-faculty-select">Select Faculty / Teacher:</label>
              <select class="vtop-form-select" id="vtop-faculty-select"></select>
            </div>

            <div class="vtop-form-group">
              <label class="vtop-form-label" for="vtop-regno-input">Student Registration No:</label>
              <input class="vtop-form-input" type="text" id="vtop-regno-input" placeholder="e.g. 24BCE0212" />
            </div>

            <div class="vtop-form-group">
              <label class="vtop-form-label" for="vtop-speed-select">Download Pacing (Anti-Rate-Limit):</label>
              <select class="vtop-form-select" id="vtop-speed-select">
                <option value="safe" selected>🛡️ Safe (1.5s - 2.5s jitter, Human-like)</option>
                <option value="stealth">🐢 Stealth (3.0s - 5.0s, Extra Cautious)</option>
                <option value="fast">⚡ Fast (0.4s - 0.75s, Safe Accelerated)</option>
              </select>
            </div>

            <div class="vtop-meta-info">
              <span id="vtop-file-count">0 files detected</span>
              <a href="javascript:void(0)" id="vtop-rescan-pages-btn" style="color: #2980b9; text-decoration: none; font-weight: 600;">🔄 Scan All Pages</a>
            </div>

            <div class="vtop-btn-row">
              <button class="vtop-download-btn" id="vtop-start-btn" style="flex: 1;">
                <span>⬇️</span>
                <span>Download All as .ZIP</span>
              </button>
              <button class="vtop-cancel-btn" id="vtop-cancel-btn">
                <span>🛑</span>
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

        document.getElementById('vtop-start-btn').addEventListener('click', () => this.handleDownloadAll());
        document.getElementById('vtop-cancel-btn').addEventListener('click', () => {
          if (isDownloading) {
            cancelRequested = true;
            this.showStatus('Cancelling after current file...', 3000);
          }
        });
        document.getElementById('vtop-rescan-pages-btn').addEventListener('click', () => this.crawlAllPages());
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
          const speed = res?.downloadPacing || res?.vtop_speed_mode;
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

      if (chrome?.storage?.local) {
        chrome.storage.local.get(['vtop_reg_no'], (res) => {
          if (res && res.vtop_reg_no) {
            regInput.value = res.vtop_reg_no;
            return;
          }
          this.detectFromDOM(regInput);
        });
      } else {
        this.detectFromDOM(regInput);
      }
    },

    detectFromDOM(inputElem) {
      const hiddenId = document.querySelector('input[name="authorizedID"], input[id="authorizedID"], input[name*="regNo"]');
      if (hiddenId && hiddenId.value) {
        inputElem.value = hiddenId.value.trim().toUpperCase();
        return;
      }

      const userImg = document.querySelector('img[src*="/vtop/users/image/?id="]');
      if (userImg) {
        const idMatch = userImg.src.match(/id=([a-zA-Z0-9]+)/);
        if (idMatch && idMatch[1]) {
          inputElem.value = idMatch[1].toUpperCase();
          return;
        }
      }

      const match = (document.body?.innerText || document.body?.textContent || '').match(REGEX_REG_NO);
      if (match) inputElem.value = match[1].toUpperCase();
    },

    getCsrfToken() {
      const csrfInput = document.querySelector('input[name="_csrf"], input[id="_csrf"]');
      if (csrfInput && csrfInput.value) return csrfInput.value;

      const csrfMeta = document.querySelector('meta[name="_csrf"]');
      if (csrfMeta && csrfMeta.content) return csrfMeta.content;

      const anyCsrf = document.querySelector('input[type="hidden"][name*="csrf" i], input[type="hidden"][id*="csrf" i]');
      if (anyCsrf && anyCsrf.value) return anyCsrf.value;

      try {
        const match = document.cookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|_csrf)=([^;]+)/i);
        if (match && match[1]) return decodeURIComponent(match[1]);
      } catch (_) {}

      if (window._csrf) return window._csrf;
      return null;
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
      msg.textContent = text;
      msg.style.display = 'block';
      if (autoHideMs > 0) {
        setTimeout(() => {
          msg.style.display = 'none';
        }, autoHideMs);
      }
    },

    getDelayMs(mode) {
      if (mode === 'stealth') {
        return Math.floor(3000 + Math.random() * 2000);
      } else if (mode === 'fast') {
        return Math.floor(400 + Math.random() * 350);
      }
      return Math.floor(1600 + Math.random() * 1000);
    },

    sanitizeFileName(name) {
      if (!name) return '';
      return name
        .replace(REGEX_ILLEGAL_FS, '_')
        .replace(REGEX_WHITESPACE, ' ')
        .trim();
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
      const speedMode = speedSelect ? speedSelect.value : 'safe';

      if (!regNo) {
        alert('Please enter your Student Registration Number (e.g. 24BCE0212).');
        if (regInput) regInput.focus();
        return;
      }

      const csrfToken = this.getCsrfToken();
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

            fileName = this.sanitizeFileName(fileName);

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
              alert(`⚠️ Rate Limit / Session Guard:\n${err.message}`);
              break;
            }
          }

          if (i < filesToDownload.length - 1 && !cancelRequested) {
            const delayMs = this.getDelayMs(speedMode);
            for (let rem = delayMs; rem > 0; rem -= 200) {
              if (cancelRequested) break;
              if (progressLabel)
                progressLabel.textContent = `[${i + 1}/${filesToDownload.length}] Pacing: waiting ${(rem / 1000).toFixed(1)}s (simulating human click)...`;
              await new Promise((r) => setTimeout(r, Math.min(200, rem)));
            }
          }
        }

        if (downloadedCount > 0) {
          if (progressBar) progressBar.style.width = '95%';
          if (progressLabel) progressLabel.textContent = 'Packaging into .ZIP archive (instant)...';

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
          const zipFileName = `${courseCode}_${cleanTeacherName}_Materials${suffix}.zip`;
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
      const basePath = window.location.pathname.split('/')[1] || 'vtop';
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

          if (bgResult && bgResult.success && bgResult.base64Data) {
            arrayBuffer = this.base64ToArrayBuffer(bgResult.base64Data);
            contentType = bgResult.contentType || '';
            contentDisposition = bgResult.contentDisposition || '';
          } else if (bgResult && bgResult.error) {
            if (bgResult.error.includes('429')) {
              throw new Error('HTTP 429: VTOP has temporarily rate-limited downloads. Please wait a few minutes.');
            }
            throw new Error(bgResult.error);
          } else {
            // Attempt 2: Fallback to direct fetch in page context
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

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

            clearTimeout(timeoutId);

            if (response.status === 429) {
              throw new Error('HTTP 429: VTOP has temporarily rate-limited downloads. Please wait a few minutes.');
            }

            if (!response.ok) {
              throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            contentType = response.headers.get('content-type') || '';
            contentDisposition = response.headers.get('content-disposition') || '';
            arrayBuffer = await response.arrayBuffer();
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
          }

          let fileName = null;
          if (contentDisposition) {
            const match = contentDisposition.match(REGEX_CONTENT_DISPOSITION);
            if (match && match[1]) {
              fileName = match[1].replace(/['"]/g, '').trim();
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

    triggerBlobDownload(blob, fileName, existingUrl = null) {
      const url = existingUrl || URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 60000);
    }
  };

  window.VTOP_PLUS.CourseDownloader = CourseDownloader;
})();
