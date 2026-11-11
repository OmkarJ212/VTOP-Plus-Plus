/**
 * VTOP++ - FAT Grade Predictor & Target Marks Module
 * Specifically calibrated for VTOP's nested marks view (Continuous Assessment Test, Quizzes, DAs).
 * Parses each course's inner marks table, extracts weightage marks, and predicts
 * exact FAT marks needed for S, A, B, and Pass grades with interactive course selection.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const REGEX_COURSE_CODE = /\b([A-Z]{3,4}\d{3,4}[A-Z]?)\b/;

  const MarksFatPredictor = {
    courses: [],

    init() {
      this.checkAndPredict();
    },

    checkAndPredict() {
      // Ensure any legacy top predictor card is removed so the page is clean and tables are at top
      const existing = document.getElementById('vtop-fat-predictor-card');
      if (existing) existing.remove();

      const courses = this.extractAllCourses();
      if (!courses || courses.length === 0) {
        return;
      }

      this.courses = courses;
      this.augmentCourseTables();
    },

    /**
     * Extracts all courses and their corresponding inner marks tables from VTOP's nested layout
     */
    extractAllCourses() {
      const courses = [];
      const allTables = Array.from(document.querySelectorAll('table'));

      // Find all inner marks tables (tables that have "Mark Title", "Max. Mark", etc.)
      // Inspect table headers first rather than scanning full table text
      const marksTables = allTables.filter((t) => {
        const header = t.querySelector('thead') || t.querySelector('tr:first-child');
        const text = (header ? header.textContent : t.textContent || '').toLowerCase();
        return (
          text.includes('mark title') &&
          text.includes('weightage') &&
          (text.includes('scored mark') || text.includes('weightage mark') || text.includes('status'))
        );
      });

      if (marksTables.length > 0) {
        marksTables.forEach((innerTable, idx) => {
          const courseInfo = this.detectCourseHeader(innerTable, idx + 1);
          const marksData = this.parseInnerMarksTable(innerTable, courseInfo);

          if (marksData.components.length > 0) {
            courses.push({
              id: `course-${idx}`,
              tableElement: innerTable,
              code: courseInfo.code,
              title: courseInfo.title,
              type: courseInfo.type,
              faculty: courseInfo.faculty,
              slot: courseInfo.slot,
              components: marksData.components,
              currentInternals: marksData.currentInternals,
              maxInternals: marksData.maxInternals,
              fatWeight: marksData.fatWeight
            });
          }
        });
      } else {
        // Fallback for single flat marks tables
        const flatTable = allTables.find((t) => {
          const header = t.querySelector('thead') || t.querySelector('tr:first-child');
          const text = (header ? header.textContent : t.textContent || '').toLowerCase();
          return (
            (text.includes('cat-i') || text.includes('cat 1') || text.includes('continuous assessment')) &&
            (text.includes('weightage') || text.includes('scored mark'))
          );
        });

        if (flatTable) {
          const courseInfo = { code: 'VTOP Course', title: 'Current Course Marks', type: 'Theory', faculty: '', slot: '' };
          const marksData = this.parseInnerMarksTable(flatTable, courseInfo);
          if (marksData.components.length > 0) {
            courses.push({
              id: 'course-0',
              tableElement: flatTable,
              code: courseInfo.code,
              title: courseInfo.title,
              type: courseInfo.type,
              faculty: courseInfo.faculty,
              slot: courseInfo.slot,
              components: marksData.components,
              currentInternals: marksData.currentInternals,
              maxInternals: marksData.maxInternals,
              fatWeight: marksData.fatWeight
            });
          }
        }
      }

      return courses;
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

      // Check outer table row preceding this inner table
      const containingTr = innerTable.closest('tr');
      let courseRow = null;

      if (containingTr) {
        // Check previous table row in the outer table
        courseRow = containingTr.previousElementSibling;
        if (!courseRow || courseRow.querySelectorAll('td').length < 3) {
          // Inner table might be directly inside a row with course info
          courseRow = containingTr;
        }
      }

      if (courseRow) {
        const cells = Array.from(courseRow.querySelectorAll('td, th'));
        for (const cell of cells) {
          const text = (cell.textContent || '').trim();
          const match = text.match(REGEX_COURSE_CODE);
          if (match && !code.startsWith(match[1])) {
            code = match[1];
          }
        }

        // Try reading standard VTOP outer table columns:
        // Sl.No (0) | ClassNbr (1) | Course Code (2) | Course Title (3) | Course Type (4) | Course System (5) | Faculty (6) | Slot (7)
        if (cells.length >= 5) {
          if (!title && cells[3]) title = cells[3].textContent.trim();
          if (cells[4]) type = cells[4].textContent.trim();
          if (cells[6]) faculty = cells[6].textContent.trim();
          if (cells[7]) slot = cells[7].textContent.trim();
        }
      }

      if (!title) {
        title = code;
      }

      return { code, title, type, faculty, slot };
    },

    /**
     * Parse rows of an inner marks table (CAT-1, CAT-2, Quizzes, DAs)
     */
    parseInnerMarksTable(table, courseInfo = null) {
      let titleCol = 1;
      let maxCol = 2;
      let weightCol = 3;
      let statusCol = 4;
      let scoredCol = 5;
      let weightageMarkCol = 6;

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

      const components = [];
      let currentInternals = 0;
      let maxInternals = 0;

      const rows = table.querySelectorAll('tbody tr').length > 0
        ? table.querySelectorAll('tbody tr')
        : Array.from(table.querySelectorAll('tr')).slice(1);

      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) return;

        const titleText = (cells[titleCol]?.textContent || '').trim();
        if (!titleText || titleText.toLowerCase().includes('mark title')) return;

        const maxMark = parseFloat((cells[maxCol]?.textContent || '').replace(/[^0-9.]/g, '')) || 0;
        const weightPct = parseFloat((cells[weightCol]?.textContent || '').replace(/[^0-9.]/g, '')) || 0;
        const status = (cells[statusCol]?.textContent || '').trim();
        const scored = parseFloat((cells[scoredCol]?.textContent || '').replace(/[^0-9.]/g, '')) || 0;

        let weightMark = 0;
        const weightMarkCell = cells[weightageMarkCol];
        const weightMarkText = weightMarkCell ? weightMarkCell.textContent.trim() : '';
        if (weightMarkText && !isNaN(parseFloat(weightMarkText))) {
          weightMark = parseFloat(weightMarkText) || 0;
        } else if (maxMark > 0 && weightPct > 0) {
          weightMark = (scored / maxMark) * weightPct;
        }

        if (weightPct > 0 || maxMark > 0) {
          maxInternals += weightPct;
          currentInternals += weightMark;

          components.push({
            title: titleText,
            maxMark,
            weightPct,
            status,
            scored,
            weightMark
          });
        }
      });

      // Lab/100% CA course: courseInfo.type matches ELA/LO/LAB/PROJECT, or course code ends in P, or maxInternals >= 100
      // fatWeight = 0 for Lab/100% CA courses; otherwise for Theory courses fatWeight = 40
      const isLabOrCA = Boolean(
        (courseInfo?.type && /\b(ELA|LO|LAB|PROJECT)\b/i.test(courseInfo.type)) ||
        (courseInfo?.code && courseInfo.code.trim().toUpperCase().endsWith('P')) ||
        maxInternals >= 100
      );
      const fatWeight = isLabOrCA ? 0 : 40;

      return { components, currentInternals, maxInternals, fatWeight };
    },

    calcRequiredFat(targetTotal, currentInternals, fatWeight) {
      if (fatWeight <= 0) return 0;
      const neededWeighted = targetTotal - currentInternals;
      if (neededWeighted <= 0) return 0; // Already secured
      const rawOutOf100 = (neededWeighted / fatWeight) * 100;
      return Math.ceil(rawOutOf100);
    },

    formatTargetValue(val, fatWeight) {
      if (fatWeight <= 0) {
        return '<span class="vtop-fat-badge vtop-fat-badge-na">N/A (100% CA)</span>';
      }
      if (val <= 0) {
        return '<span class="vtop-fat-badge vtop-fat-badge-secured">Secured 🎉</span>';
      }
      if (val > 100) {
        return '<span class="vtop-fat-badge vtop-fat-badge-impossible">Impossible (&gt;100)</span>';
      }
      if (val > 75) {
        return `<span class="vtop-fat-val-num vtop-fat-val-warn">${val}</span> <span class="vtop-fat-val-den">/ 100</span>`;
      }
      return `<span class="vtop-fat-val-num vtop-fat-val-safe">${val}</span> <span class="vtop-fat-val-den">/ 100</span>`;
    },

    /**
     * Injects a clean, prominent inline section directly under each course's marks table
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

        const sNeeded = this.calcRequiredFat(90, c.currentInternals, c.fatWeight);
        const aNeeded = this.calcRequiredFat(80, c.currentInternals, c.fatWeight);
        const bNeeded = this.calcRequiredFat(70, c.currentInternals, c.fatWeight);
        const passNeeded = this.calcRequiredFat(50, c.currentInternals, c.fatWeight);
        const passScore = Math.max(40, passNeeded);

        tfoot.innerHTML = `
          <tr>
            <td colspan="100%" class="vtop-fat-tfoot-cell">
              <div class="vtop-fat-summary-wrapper">
                <div class="vtop-fat-summary-title-row">
                  <div class="vtop-fat-summary-title">
                    <span class="vtop-fat-title-icon">🎯</span>
                    <strong>VTOP++ FAT Target Marks</strong>
                    ${c.code ? `<span class="vtop-fat-course-tag">${c.code} · ${c.type}</span>` : ''}
                  </div>
                  <div class="vtop-fat-internals-badge">
                    Internals Secured: <strong>${c.currentInternals.toFixed(1)} / ${c.maxInternals}</strong>
                    <span class="vtop-fat-weightage-tag">(${c.fatWeight}% FAT Weightage)</span>
                  </div>
                </div>
                <div class="vtop-fat-grid">
                  <div class="vtop-fat-target-card">
                    <span class="vtop-fat-grade-label">S Grade (≥90)</span>
                    <span class="vtop-fat-target-val">${this.formatTargetValue(sNeeded, c.fatWeight)}</span>
                  </div>
                  <div class="vtop-fat-target-card">
                    <span class="vtop-fat-grade-label">A Grade (≥80)</span>
                    <span class="vtop-fat-target-val">${this.formatTargetValue(aNeeded, c.fatWeight)}</span>
                  </div>
                  <div class="vtop-fat-target-card">
                    <span class="vtop-fat-grade-label">B Grade (≥70)</span>
                    <span class="vtop-fat-target-val">${this.formatTargetValue(bNeeded, c.fatWeight)}</span>
                  </div>
                  <div class="vtop-fat-target-card">
                    <span class="vtop-fat-grade-label">Pass (Min 40% in FAT)</span>
                    <span class="vtop-fat-target-val">${this.formatTargetValue(passScore, c.fatWeight)}</span>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        `;
      });
    }
  };

  window.VTOP_PLUS.MarksFatPredictor = MarksFatPredictor;
})();
