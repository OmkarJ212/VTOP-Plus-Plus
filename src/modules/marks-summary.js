/**
 * VTOP++ - Marks Summary & Parser Module
 * 1. Parses nested VTOP Marks & Grade tables (reused by MarksNotifier for background diffs).
 * 2. Displays "Total Marks Achieved" summary footer on every course marks table.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const REGEX_COURSE_CODE = /\b([A-Z]{3,4}\d{3,4}[A-Z]?)\b/;

  const MarksSummary = {
    courses: [],

    destroy() {
      document.querySelectorAll('.vtop-fat-inline-tfoot').forEach((el) => el.remove());
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

  window.VTOP_PLUS.MarksSummary = MarksSummary;
})();
