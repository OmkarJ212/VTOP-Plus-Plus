// Course Material Downloader: teacher grouping, STORE ZIP packaging, multi-page DataTables traversal.

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const REGEX_COURSE_CODE = /([A-Z]{3,4}\d{3,4}[A-Z]?)/;
  const REGEX_CLEAN_TEACHER = /[^a-zA-Z0-9_\-\. ]/g;
  const REGEX_WHITESPACE = /[\r\n\t]+/g;
  const REGEX_SPACES = /\s+/g;
  const REGEX_ILLEGAL_FS = /[\/\\:*?"<>|]/g;
  const REGEX_CTRL_CHARS = /[\x00-\x1f\x7f]/g;
  const REGEX_ONCLICK_FILEID = /downloadCourseMaterialFacultyPdf\s*\(\s*['"]?([a-zA-Z0-9_\-]+)['"]?/i;
  const REGEX_TOTAL_ENTRIES = /of\s+([\d,]+)\s+entries/i;
  const MAX_TOPIC_LEN = 80;

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

  /**
   * Formats VTOP faculty labels like "18842 - VETRISELVI T - SCOPE" into "VETRISELVI T [18842]"
   * for ZIP filenames, entry filenames, and faculty folders.
   */
  function formatFacultyForPath(rawTeacher) {
    const raw = String(rawTeacher || '').replace(REGEX_SPACES, ' ').trim();
    if (!raw) return '';

    let parts = raw.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      parts = raw.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
    }

    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      const code = parts[0];
      const nameParts = parts.length >= 3 ? parts.slice(1, -1) : parts.slice(1);
      const cleanName = nameParts.join(' - ').replace(REGEX_CLEAN_TEACHER, '').replace(REGEX_SPACES, ' ').trim();
      if (cleanName) {
        return `${cleanName} [${code}]`;
      }
    }

    return raw.replace(REGEX_CLEAN_TEACHER, '').replace(REGEX_SPACES, ' ').trim();
  }

  const SEGREGATE_STORAGE_KEY = 'vtop_dl_segregate_faculty';

  function loadSegregatePref() {
    try {
      const val = localStorage.getItem(SEGREGATE_STORAGE_KEY);
      return val === null ? true : val === 'true';
    } catch (_) {
      return true;
    }
  }

  const CourseDownloader = {
    selectedFaculty: '__ALL__',
    segregateByFaculty: loadSegregatePref(),
    _observer: null,
    _statusTimer: null,

    resetCourse() {
      crawlGen++;
      isCrawlingPages = false;
      allCourseFiles.clear();
      hasAutoCrawled = false;
      activeBaseCourseCode = null;
      this.selectedFaculty = '__ALL__';
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
      this.setDockButtonVisible(false);
    },

    setDockButtonVisible(visible) {
      const dlBtn = document.getElementById('vtop-dock-dl-btn');
      if (dlBtn) {
        dlBtn.style.display = visible ? 'inline-flex' : 'none';
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
        this.setDockButtonVisible(false);
        return;
      }

      this.setDockButtonVisible(true);
      this.scanVisibleRows(downloadButtons);

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
        const cleanTeacherName = formatFacultyForPath(teacherText);

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
      return window.VTOP_PLUS?.MaterialFetcher?.getTableStateSnapshot?.() || '';
    },

    async waitForTableStateChange(oldSnapshot, maxWaitMs = 2500) {
      return window.VTOP_PLUS?.MaterialFetcher?.waitForTableStateChange?.(oldSnapshot, maxWaitMs) ?? false;
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
      const fetcher = window.VTOP_PLUS?.MaterialFetcher;
      if (!fetcher) return;

      isCrawlingPages = true;
      const gen = crawlGen;

      try {
        this.updateFileCountLabel('Loading...');
        await fetcher.crawlAllPages({
          isCancelled: () => crawlGen !== gen,
          onScanRows: () => this.scanVisibleRows(),
          onComplete: () => {
            this.updateFileCountLabel();
            if (window.VTOP_PLUS?.CourseFilter?.syncFacultyList) {
              const facList = Array.from(this.getTeachersMap().entries())
                .map(([name, files]) => ({ name, count: files.length }))
                .sort((a, b) => a.name.localeCompare(b.name));
              window.VTOP_PLUS.CourseFilter.syncFacultyList(facList);
            }
            this.showStatus('', 0);
          }
        });
      } finally {
        if (crawlGen === gen) {
          isCrawlingPages = false;
        }
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
              ${window.VTOP_PLUS?.UI?.icon('package', 15, { ariaHidden: true }) || ''}
              <span>Material Downloader</span>
            </div>
            <div class="vtop-panel-actions">
              <button class="vtop-icon-btn" id="vtop-min-btn" title="Minimize/Maximize" aria-label="Minimize">&minus;</button>
            </div>
          </div>
          <div class="vtop-panel-body">
            <div class="vtop-dl-scope-row">
              <span class="vtop-dl-scope-label" id="vtop-dl-scope-label">All Faculty</span>
              <span class="vtop-dl-scope-count" id="vtop-file-count">0 files</span>
            </div>

            <label class="vtop-dl-option-row" id="vtop-dl-segregate-row">
              <input type="checkbox" id="vtop-dl-segregate-cb" ${this.segregateByFaculty ? 'checked' : ''} />
              <span>Separate folders per faculty</span>
            </label>

            <div class="vtop-btn-row">
              <button class="vtop-download-btn" id="vtop-start-btn" style="flex: 1;">
                ${window.VTOP_PLUS?.UI?.icon('download', 14, { strokeWidth: 2.2, ariaHidden: true }) || ''}
                <span>Download .ZIP</span>
              </button>
              <button class="vtop-cancel-btn" id="vtop-cancel-btn">
                ${window.VTOP_PLUS?.UI?.icon('x-circle', 14, { strokeWidth: 2.2, ariaHidden: true }) || ''}
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
          }
        });
        document.getElementById('vtop-dl-segregate-cb')?.addEventListener('change', (e) => {
          this.segregateByFaculty = Boolean(e.target.checked);
          try {
            localStorage.setItem(SEGREGATE_STORAGE_KEY, String(this.segregateByFaculty));
          } catch (_) {}
        });
      }

      panel.style.display = 'block';
      this.updateFileCountLabel();
    },

    selectFaculty(facultyName) {
      if (!facultyName || facultyName === 'ALL' || facultyName === '__ALL__') {
        this.selectedFaculty = '__ALL__';
        this.updateFileCountLabel();
        return;
      }

      const teachersMap = this.getTeachersMap();
      const target = facultyName.trim().toLowerCase();
      let matchedValue = null;

      for (const teacher of teachersMap.keys()) {
        if (teacher.trim().toLowerCase() === target) {
          matchedValue = teacher;
          break;
        }
      }

      if (!matchedValue) {
        for (const teacher of teachersMap.keys()) {
          const val = teacher.trim().toLowerCase();
          if (val.includes(target) || target.includes(val)) {
            matchedValue = teacher;
            break;
          }
        }
      }

      this.selectedFaculty = matchedValue || '__ALL__';
      this.updateFileCountLabel();
    },

    updateFileCountLabel(customText = null) {
      const countLabel = document.getElementById('vtop-file-count');
      const scopeLabel = document.getElementById('vtop-dl-scope-label');
      if (!countLabel) return;

      if (customText) {
        countLabel.textContent = customText;
        return;
      }

      const teachersMap = this.getTeachersMap();
      if (this.selectedFaculty !== '__ALL__' && !teachersMap.has(this.selectedFaculty)) {
        this.selectedFaculty = '__ALL__';
      }
      if (this.selectedFaculty === '__ALL__') {
        if (scopeLabel) scopeLabel.textContent = 'All Faculty';
        countLabel.textContent = `${allCourseFiles.size} file${allCourseFiles.size === 1 ? '' : 's'}`;
      } else {
        const files = teachersMap.get(this.selectedFaculty) || [];
        if (scopeLabel) scopeLabel.textContent = this.selectedFaculty;
        countLabel.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
      }
      const segRow = document.getElementById('vtop-dl-segregate-row');
      if (segRow) {
        segRow.style.display = this.selectedFaculty === '__ALL__' ? 'flex' : 'none';
      }
    },

    showStatus(text, autoHideMs = 0, isError = false) {
      const msg = document.getElementById('vtop-status-msg');
      if (!msg) return;
      if (this._statusTimer) {
        clearTimeout(this._statusTimer);
        this._statusTimer = null;
      }
      if (!text) {
        msg.style.display = 'none';
        msg.textContent = '';
        msg.classList.remove('is-error');
        return;
      }
      msg.textContent = text;
      msg.classList.toggle('is-error', Boolean(isError));
      msg.style.display = 'block';
      if (autoHideMs > 0) {
        this._statusTimer = setTimeout(() => {
          msg.style.display = 'none';
          msg.classList.remove('is-error');
          this._statusTimer = null;
        }, autoHideMs);
      }
    },

    getDelayMs() {
      return Math.floor(400 + Math.random() * 350);
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

    formatPathPart(text, fallback = 'Unknown') {
      const cleaned = this.sanitizeFileName(String(text || '').replace(REGEX_SPACES, ' '))
        .replace(/^[-_.\s]+|[-_.\s]+$/g, '')
        .trim();
      return cleaned || fallback;
    },

    extractSubjectNameFromText(rawText, crsType = '') {
      if (!rawText) return '';
      let title = String(rawText).replace(REGEX_SPACES, ' ').trim();
      title = title
        .replace(/^(?:.*?\s*[-–—]\s*)?[A-Z]{2,5}\d{3,4}[A-Z]?\s*[-–—]\s*/i, '')
        .replace(/\s*[-–—]\s*(?:ETH|ELA|EPJ|TH|LO|SS|OC|PJT)\b.*$/i, '')
        .trim();

      let resolvedType = String(crsType || '').trim().toUpperCase();
      if (!resolvedType) {
        const typeMatch = String(rawText).match(/[-–—]\s*(ETH|ELA|EPJ|TH|LO|SS|OC|PJT)\b/i);
        if (typeMatch) resolvedType = typeMatch[1].toUpperCase();
      }
      if (title && (resolvedType === 'ELA' || resolvedType === 'LO') && !/\blab\b/i.test(title)) {
        title = `${title} Lab`;
      }
      return title;
    },

    getActiveSubjectName(fallbackCourseText = '', fallbackCourseCode = '') {
      const selects = [
        document.getElementById('courseId'),
        document.getElementById('vtop-subj-select')
      ];
      for (const sel of selects) {
        if (!sel || sel.selectedIndex < 0) continue;
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) continue;
        const crsType = opt.getAttribute('data-crstype') || '';
        const parsed = this.extractSubjectNameFromText(opt.textContent || '', crsType);
        if (parsed) return parsed;
      }

      const fromRow = this.extractSubjectNameFromText(fallbackCourseText, '');
      if (fromRow && !REGEX_COURSE_CODE.test(fromRow)) return fromRow;
      return fallbackCourseCode || 'Subject';
    },

    buildEntryFileInfo(fileInfo, fileData, subjectName) {
      const serverName = fileData?.fileName ? String(fileData.fileName).trim() : '';
      const dotIdx = serverName.lastIndexOf('.');
      const hasValidExt = dotIdx > 0 && dotIdx < serverName.length - 1 && /^[a-zA-Z0-9]{1,10}$/.test(serverName.slice(dotIdx + 1));
      const ext = hasValidExt
        ? serverName.slice(dotIdx + 1).toLowerCase()
        : this.getExtensionFromContentType(fileData?.contentType || '');

      let rawTopic = String(fileInfo?.materialText || '').replace(REGEX_SPACES, ' ').trim();
      if (!rawTopic || /^material_\d+$/i.test(rawTopic) || /^no data$/i.test(rawTopic)) {
        rawTopic = hasValidExt ? serverName.slice(0, dotIdx) : (serverName || `Material_${fileInfo?.fileId || 'File'}`);
      }
      if (rawTopic.length > MAX_TOPIC_LEN) {
        rawTopic = rawTopic.slice(0, MAX_TOPIC_LEN).trim();
      }

      const cleanTopic = this.formatPathPart(rawTopic, `Material_${fileInfo?.fileId || 'File'}`);
      const cleanSubject = this.formatPathPart(subjectName, fileInfo?.courseCode || 'Subject');
      const cleanFaculty = this.formatPathPart(fileInfo?.cleanTeacher || formatFacultyForPath(fileInfo?.teacher), 'Faculty');
      const finalFileName = this.sanitizeFileName(`${cleanTopic}-${cleanSubject}-${cleanFaculty}.${ext}`) || `Material_${fileInfo?.fileId || 'File'}.${ext}`;

      return {
        facultyFolder: cleanFaculty,
        fileName: finalFileName
      };
    },

    base64ToArrayBuffer(base64) {
      return window.VTOP_PLUS?.MaterialFetcher?.base64ToArrayBuffer?.(base64);
    },

    isFatalBatchError(err) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
      const msg = String(err?.message || err || '');
      return (
        msg.includes('429') ||
        msg.includes('rate-limited') ||
        msg.includes('session expired') ||
        msg.includes('logged out') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError')
      );
    },

    async handleDownloadAll() {
      if (isDownloading) return;

      const startBtn = document.getElementById('vtop-start-btn');
      const cancelBtn = document.getElementById('vtop-cancel-btn');
      const progressBox = document.getElementById('vtop-progress-box');
      const progressBar = document.getElementById('vtop-progress-bar');
      const progressLabel = document.getElementById('vtop-progress-label');

      const selectedTeacher = this.selectedFaculty || '__ALL__';
      const regNo = (window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : '').trim().toUpperCase();

      if (!regNo) {
        this.showStatus('Please refresh VTOP and try again.', 5000, true);
        return;
      }

      const csrfToken = window.VTOP_PLUS?.DOM?.getCsrfToken ? window.VTOP_PLUS.DOM.getCsrfToken() : '';
      if (!csrfToken) {
        this.showStatus('Please refresh VTOP and try again.', 5000, true);
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
        this.showStatus('No files found.', 4000, true);
        return;
      }

      if (typeof JSZip === 'undefined') {
        this.showStatus('Please refresh VTOP and try again.', 5000, true);
        return;
      }

      const segregateCb = document.getElementById('vtop-dl-segregate-cb');

      isDownloading = true;
      cancelRequested = false;
      this.showStatus('', 0);
      if (startBtn) startBtn.disabled = true;
      if (segregateCb) segregateCb.disabled = true;
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
      if (progressBox) progressBox.style.display = 'flex';
      if (progressBar) progressBar.style.width = '0%';
      if (progressLabel) progressLabel.textContent = `0 / ${filesToDownload.length} files downloaded`;

      const zip = new JSZip();
      const usedEntryPaths = new Set();
      let downloadedCount = 0;
      let skippedCount = 0;
      let consecutiveFailures = 0;
      let abortedFatal = false;

      const isAllFaculty = selectedTeacher === '__ALL__';
      const segregateFolders = isAllFaculty && Boolean(segregateCb ? segregateCb.checked : this.segregateByFaculty);
      const rawSubject = this.getActiveSubjectName(filesToDownload[0]?.courseText, filesToDownload[0]?.courseCode);
      const subjectPart = this.formatPathPart(rawSubject, filesToDownload[0]?.courseCode || 'Subject');
      const facultyPart = isAllFaculty
        ? 'All_Faculty'
        : this.formatPathPart(filesToDownload[0]?.cleanTeacher || formatFacultyForPath(filesToDownload[0]?.teacher), 'Faculty');

      try {
        for (let i = 0; i < filesToDownload.length; i++) {
          if (cancelRequested) {
            break;
          }

          const fileInfo = filesToDownload[i];

          try {
            const fileData = await this.fetchSingleMaterial(fileInfo, regNo, csrfToken);

            if (cancelRequested) {
              break;
            }

            const { facultyFolder, fileName } = this.buildEntryFileInfo(fileInfo, fileData, subjectPart);
            const prefix = segregateFolders ? `${facultyFolder}/` : '';

            let uniqueName = fileName;
            let counter = 1;
            while (usedEntryPaths.has(`${prefix}${uniqueName}`)) {
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
            const entryPath = `${prefix}${uniqueName}`;
            usedEntryPaths.add(entryPath);

            zip.file(entryPath, fileData.arrayBuffer, { binary: true });
            downloadedCount++;
            consecutiveFailures = 0;
            if (progressBar) progressBar.style.width = `${Math.round(((downloadedCount + skippedCount) / filesToDownload.length) * 95)}%`;
            if (progressLabel) progressLabel.textContent = `${downloadedCount} / ${filesToDownload.length} files downloaded`;
          } catch (err) {
            console.warn(`[VTOP++] Skipped/failed file ${fileInfo.fileId}:`, err);
            consecutiveFailures++;
            if (this.isFatalBatchError(err) || consecutiveFailures >= 3) {
              abortedFatal = true;
              break;
            }
            skippedCount++;
          }

          if (i < filesToDownload.length - 1 && !cancelRequested) {
            const delayMs = this.getDelayMs();
            for (let rem = delayMs; rem > 0; rem -= 200) {
              if (cancelRequested) break;
              await new Promise((r) => setTimeout(r, Math.min(200, rem)));
            }
          }
        }

        const shouldDrop =
          cancelRequested ||
          abortedFatal ||
          downloadedCount === 0 ||
          downloadedCount + skippedCount < filesToDownload.length;

        if (shouldDrop) {
          if (progressBox) progressBox.style.display = 'none';
          if (progressBar) progressBar.style.width = '0%';
          if (progressLabel) progressLabel.textContent = '';
          this.showStatus('Download Dropped. Try again', 5000, true);
        } else {
          if (progressBar) progressBar.style.width = '95%';
          if (progressLabel) progressLabel.textContent = 'Creating .ZIP...';

          const zipBlob = await zip.generateAsync(
            {
              type: 'blob',
              compression: 'STORE'
            },
            (metadata) => {
              if (progressBar) progressBar.style.width = `${Math.round(metadata.percent)}%`;
            }
          );

          const zipFileName = this.sanitizeFileName(`${subjectPart}-${facultyPart}.zip`) || 'Course_Materials.zip';
          this.triggerBlobDownload(zipBlob, zipFileName);

          if (progressBar) progressBar.style.width = '100%';
          if (progressLabel) {
            progressLabel.textContent =
              skippedCount > 0
                ? `${downloadedCount} files downloaded (${skippedCount} unavailable)`
                : `${downloadedCount} / ${filesToDownload.length} files downloaded`;
          }
          this.showStatus(`Saved as ${zipFileName}`, 5000);
        }
      } catch (globalErr) {
        console.error('[VTOP++] Error during batch download:', globalErr);
        if (progressBox) progressBox.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        this.showStatus('Download Dropped. Try again', 5000, true);
      } finally {
        isDownloading = false;
        cancelRequested = false;
        if (startBtn) startBtn.disabled = false;
        if (segregateCb) segregateCb.disabled = false;
        if (cancelBtn) cancelBtn.style.display = 'none';
      }
    },

    async fetchSingleMaterial(fileInfo, regNo, csrfToken) {
      return window.VTOP_PLUS.MaterialFetcher.fetchSingleMaterial(fileInfo, regNo, csrfToken);
    },

    getExtensionFromContentType(contentType) {
      return window.VTOP_PLUS.MaterialFetcher.getExtensionFromContentType(contentType);
    },

    triggerBlobDownload(blob, fileName) {
      window.VTOP_PLUS?.DOM?.triggerBlobDownload?.(blob, fileName);
    }
  };

  window.VTOP_PLUS.CourseDownloader = CourseDownloader;
})();
