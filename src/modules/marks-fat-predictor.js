/**
 * VTOP++ - Marks Summary & Lab/Soft-Skill Predictor Module
 * Shows total weightage scored out of weightage given for all courses,
 * and predicts remaining weightage needed for S, A, B, and Pass on Lab & Soft Skill courses.
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

      // 1. O(1) direct selector for Vellore VTOP inner marks tables (#fixedTableContainer table.customTable-level1)
      let marksTables = Array.from(document.querySelectorAll('#fixedTableContainer table.customTable-level1'));

      // 2. Fallback: scan all tables only if exact class selector yielded none
      let allTables = null;
      if (marksTables.length === 0) {
        allTables = Array.from(document.querySelectorAll('table'));
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
          const marksData = this.parseInnerMarksTable(innerTable);

          if (marksData.components.length === 0) {
            this.clearPrediction(innerTable);
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
            showPredictions: this.shouldPredictCourse(courseInfo) && marksData.remainingWeight > 0,
            components: marksData.components,
            totalGot: marksData.totalGot,
            totalGiven: marksData.totalGiven,
            remainingWeight: marksData.remainingWeight
          });
        });
      } else {
        // Fallback for single flat marks tables
        if (!allTables) allTables = Array.from(document.querySelectorAll('table'));
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
          const marksData = this.parseInnerMarksTable(flatTable);
          if (marksData.components.length > 0) {
            courses.push({
              id: 'course-0',
              tableElement: flatTable,
              code: courseInfo.code,
              title: courseInfo.title,
              type: courseInfo.type,
              faculty: courseInfo.faculty,
              slot: courseInfo.slot,
              showPredictions: this.shouldPredictCourse(courseInfo) && marksData.remainingWeight > 0,
              components: marksData.components,
              totalGot: marksData.totalGot,
              totalGiven: marksData.totalGiven,
              remainingWeight: marksData.remainingWeight
            });
          }
        }
      }

      return courses;
    },

    shouldPredictCourse(courseInfo) {
      const type = (courseInfo?.type || '').trim();
      if (/\btheory\s*only\b|\bembedded\s*theory\b/i.test(type)) return false;
      if (/\b(lab|soft\s*skill)/i.test(type)) return true;
      return Boolean(courseInfo?.code && courseInfo.code.trim().toUpperCase().endsWith('P') && !type);
    },

    clearPrediction(table) {
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

      // Check outer table row preceding this inner table
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
        // Exact outer table.customTable layout:
        // Sl.No.(0) | ClassNbr(1) | Course Code(2) | Course Title(3) | Course Type(4) | Course System(5) | Faculty(6) | Slot(7) | Course Mode(8)
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

      if (!title) {
        title = code;
      }

      return { code, title, type, faculty, slot };
    },

    /**
     * Parse rows of an inner marks table (CAT-1, CAT-2, Quizzes, DAs)
     */
    parseInnerMarksTable(table) {
      // Exact table.customTable-level1 layout:
      // Sl.No.(0) | Mark Title(1) | Max. Mark(2) | Weightage %(3) | Status(4) | Scored Mark(5) | Weightage Mark(6) | Remark(7)
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
      const rows = directTbodyRows.length > 0
        ? Array.from(directTbodyRows)
        : Array.from(table.querySelectorAll('tr')).slice(1);

      rows.forEach((row) => {
        if (
          row.closest('tfoot, .vtop-fat-inline-tfoot') ||
          row.classList.contains('vtop-fat-header-row') ||
          row.classList.contains('vtop-fat-targets-row')
        ) {
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
        const isGraded = hasScore || hasWeightMark || /\b(present|absent)\b/i.test(status);

        if ((weightPct > 0 || maxMark > 0) && isGraded) {
          totalGiven += weightPct;
          totalGot += weightMark;

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

      const remainingWeight = Math.max(0, 100 - totalGiven);

      return { components, totalGot, totalGiven, remainingWeight };
    },

    formatNum(num) {
      const rounded = Math.round(num * 100) / 100;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
    },

    formatTargetValue(targetTotal, totalGot, remainingWeight) {
      if (remainingWeight <= 0) {
        return '<span class="vtop-fat-val-muted">N/A (Complete)</span>';
      }
      const needed = Math.max(0, targetTotal - totalGot);
      if (needed <= 0) {
        return '<span class="vtop-fat-val-safe">Secured</span>';
      }
      const remLabel = this.formatNum(remainingWeight);
      if (needed > remainingWeight) {
        return `<span class="vtop-fat-val-muted">Impossible (&gt;${remLabel})</span>`;
      }
      const neededLabel = this.formatNum(needed);
      const ratio = needed / remainingWeight;
      const cls = ratio > 0.75 ? 'vtop-fat-val-warn' : 'vtop-fat-val-safe';
      return `<span class="${cls}">${neededLabel} / ${remLabel}</span>`;
    },

    /**
     * Injects native-styled marks summary and prediction rows at the bottom of the course marks table
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
        const remLabel = this.formatNum(c.remainingWeight);
        const headerTitle = c.showPredictions ? 'Marks Predictor' : 'Marks Summary';
        const summaryMeta = c.showPredictions
          ? `Total: ${gotLabel} / ${givenLabel} · Remaining: ${remLabel}`
          : `Total: ${gotLabel} / ${givenLabel}`;

        let targetsHtml = '';
        if (c.showPredictions) {
          const sVal = this.formatTargetValue(90, c.totalGot, c.remainingWeight);
          const aVal = this.formatTargetValue(80, c.totalGot, c.remainingWeight);
          const bVal = this.formatTargetValue(70, c.totalGot, c.remainingWeight);
          const passVal = this.formatTargetValue(50, c.totalGot, c.remainingWeight);

          if (firstRowCols === 8) {
            targetsHtml = `
              <tr class="tableContent-level1 vtop-fat-targets-row">
                <td colspan="2"><span class="vtop-fat-grade-label">S (&ge;90):</span> <span class="vtop-fat-target-val">${sVal}</span></td>
                <td colspan="2"><span class="vtop-fat-grade-label">A (&ge;80):</span> <span class="vtop-fat-target-val">${aVal}</span></td>
                <td colspan="2"><span class="vtop-fat-grade-label">B (&ge;70):</span> <span class="vtop-fat-target-val">${bVal}</span></td>
                <td colspan="2"><span class="vtop-fat-grade-label">Pass (&ge;50):</span> <span class="vtop-fat-target-val">${passVal}</span></td>
              </tr>
            `;
          } else {
            targetsHtml = `
              <tr class="tableContent-level1 vtop-fat-targets-row">
                <td colspan="100%" class="vtop-fat-tfoot-cell">
                  <div class="vtop-fat-grid">
                    <div class="vtop-fat-grid-cell"><span class="vtop-fat-grade-label">S (&ge;90):</span> <span class="vtop-fat-target-val">${sVal}</span></div>
                    <div class="vtop-fat-grid-cell"><span class="vtop-fat-grade-label">A (&ge;80):</span> <span class="vtop-fat-target-val">${aVal}</span></div>
                    <div class="vtop-fat-grid-cell"><span class="vtop-fat-grade-label">B (&ge;70):</span> <span class="vtop-fat-target-val">${bVal}</span></div>
                    <div class="vtop-fat-grid-cell"><span class="vtop-fat-grade-label">Pass (&ge;50):</span> <span class="vtop-fat-target-val">${passVal}</span></div>
                  </div>
                </td>
              </tr>
            `;
          }
        }

        if (firstRowCols === 8) {
          tfoot.innerHTML = `
            <tr class="tableHeader-level1 vtop-fat-header-row">
              <td colspan="4" class="vtop-fat-header-left">${headerTitle}</td>
              <td colspan="4" class="vtop-fat-header-right">${summaryMeta}</td>
            </tr>
            ${targetsHtml}
          `;
        } else {
          tfoot.innerHTML = `
            <tr class="tableHeader-level1 vtop-fat-header-row">
              <td colspan="100%">
                <div class="vtop-fat-fallback-header">
                  <span>${headerTitle}</span>
                  <span>${summaryMeta}</span>
                </div>
              </td>
            </tr>
            ${targetsHtml}
          `;
        }
      });
    }
  };

  window.VTOP_PLUS.MarksFatPredictor = MarksFatPredictor;
})();
