/**
 * VTOP++ - Home Forthcoming DA Card & Direct Upload Launcher
 * Prefetches active semester DA courses and injects "Upload Now" actions
 * into the Home dashboard's #digital-assignments card.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const DaHomeCard = {
    _pendingTarget: null,
    _homeCoursesPromise: null,

    getPendingTarget() {
      if (this._pendingTarget && Date.now() > this._pendingTarget.expiresAt) {
        this._pendingTarget = null;
      }
      return this._pendingTarget;
    },

    clearPendingTarget() {
      this._pendingTarget = null;
    },

    async fetchLatestSemesterCourses() {
      const DOM = window.VTOP_PLUS?.DOM;
      const Storage = window.VTOP_PLUS?.Storage;
      const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
      const cacheKey = `vtop_da_home_courses_v1_${authId || 'anon'}`;

      const cached = Storage?.getWebCache(cacheKey, {
        area: 'session',
        ttlMs: 20 * 60 * 1000,
        validate: (p) => Array.isArray(p.courses)
      });
      if (cached) return cached.courses;

      if (this._homeCoursesPromise) return this._homeCoursesPromise;

      this._homeCoursesPromise = (async () => {
        try {
          const VtopApi = window.VTOP_PLUS?.VtopApi;
          if (!VtopApi) return [];

          const semRes = await VtopApi.fetchSemesterData({
            pageUrl: 'examinations/StudentDA',
            formSelector: '#digitalAssignment',
            dataUrl: 'examinations/doDigitalAssignment',
            useFirstOptionOnly: true
          });
          if (!semRes.ok || !semRes.html) return [];

          const { semesterSubId, semesterLabel, html: tableHtml } = semRes;
          if (VtopApi.saveActiveSemesterId && semesterSubId) {
            VtopApi.saveActiveSemesterId(semesterSubId, semesterLabel);
          }

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
            Storage?.setWebCache(cacheKey, { courses }, { area: 'session' });
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

      const wantsLab = /\b(lab|ela)\b/i.test(courseText);
      const wantsTheory = /\b(theory|eth|th)\b/i.test(courseText);
      const pickPreferred = (list) => {
        if (list.length === 1) return list[0];
        if (wantsLab) {
          const labMatch = list.find((c) => /lab|\bela\b|\blo\b/i.test(c.courseType || ''));
          if (labMatch) return labMatch;
        }
        if (wantsTheory) {
          const thMatch = list.find((c) => /theory|\beth\b|\bth\b/i.test(c.courseType || ''));
          if (thMatch) return thMatch;
        }
        return list[0];
      };

      const codeMatch = courseText.match(/\b([A-Z]{3,4}\d{3,4}[A-Z]?)\b/i);
      if (codeMatch) {
        const code = codeMatch[1].toUpperCase();
        const codeMatches = courses.filter((c) => (c.courseCode || '').toUpperCase() === code);
        if (codeMatches.length > 0) return pickPreferred(codeMatches);
      }

      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const target = norm(courseText);
      if (!target) return null;

      const candidates = courses.filter((c) => {
        const title = norm(c.courseTitle);
        return title && (target.includes(title) || title.includes(target));
      });
      if (candidates.length === 0) return null;
      return pickPreferred(candidates);
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
    }
  };

  window.VTOP_PLUS.DaHomeCard = DaHomeCard;
})();
