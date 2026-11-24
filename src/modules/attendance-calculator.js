/**
 * VTOP++ - Attendance Bunk Calculator & Debarment Risk Module
 * Automatically analyzes attendance tables with rich status cell extraction (Attended, Total, OD, Present, Absent).
 * Provides interactive target simulations (1–100%) and bunk/attendance calculations.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const HARD_MAX_NEEDED = 100;

  const AttendanceCalculator = {
    targetPercent: 75,
    _settingsLoaded: false,
    _settingsPromise: null,

    init() {
      this.checkAndCalculate();
    },

    checkAndCalculate() {
      const table = this.findAttendanceTable();
      if (!table) {
        const existing = document.getElementById('vtop-attendance-summary-card');
        if (existing) existing.remove();
        return;
      }

      if (this._settingsLoaded) {
        this.renderSummaryWidget(table);
        this.augmentTable(table);
        return;
      }

      if (!this._settingsPromise) {
        this._settingsPromise = this.loadTargetSettings().then(() => {
          this._settingsLoaded = true;
        });
      }
      this._settingsPromise.then(() => {
        this.renderSummaryWidget(table);
        this.augmentTable(table);
      });
    },

    async loadTargetSettings() {
      if (chrome?.storage?.local) {
        return new Promise((resolve) => {
          chrome.storage.local.get(['attendanceTarget'], (res) => {
            if (chrome.runtime.lastError) {
              resolve();
              return;
            }
            if (res && res.attendanceTarget !== undefined) {
              const val = parseInt(res.attendanceTarget, 10);
              if (!isNaN(val)) {
                this.targetPercent = Math.max(1, Math.min(100, val));
              }
            }
            resolve();
          });
        });
      }
    },

    findAttendanceTable() {
      // 1. Direct O(1) selector on Vellore VTOP (#AttendanceDetailDataTable)
      const direct = document.getElementById('AttendanceDetailDataTable') ||
                     document.querySelector('#attendanceDetail, table[id*="attendance" i]');
      if (direct) return direct;

      // 2. Fast scan across tables
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const text = (table.textContent || '').toLowerCase();
        if (
          (text.includes('attended') || text.includes('attendance status')) &&
          (text.includes('total') || text.includes('conducted') || text.includes('present')) &&
          text.includes('%')
        ) {
          return table;
        }
      }
      return null;
    },

    renderSummaryWidget(table) {
      let card = document.getElementById('vtop-attendance-summary-card');
      if (card) {
        if (table && table.parentNode && card.nextElementSibling !== table) {
          table.parentNode.insertBefore(card, table);
        }
        return;
      }

      card = document.createElement('div');
      card.id = 'vtop-attendance-summary-card';
      card.className = 'vtop-plus-card vtop-attendance-card vtop-att-bar';

      card.innerHTML = `
        <div class="vtop-att-bar-left">
          <span class="vtop-att-overall" id="vtop-stat-overall">Overall --%</span>
          <span class="vtop-att-pill vtop-att-pill-muted" id="vtop-att-risk-pill" style="display: none;"></span>
          <span class="vtop-att-pill vtop-att-pill-info" id="vtop-box-od" style="display: none;"><span id="vtop-stat-od">0</span> OD</span>
        </div>
        <div class="vtop-att-bar-right">
          <span class="vtop-att-target-label">Target</span>
          <div class="vtop-att-presets" id="vtop-att-presets">
            <button type="button" class="vtop-att-preset-btn" data-target="75">75%</button>
            <button type="button" class="vtop-att-preset-btn" data-target="80">80%</button>
            <button type="button" class="vtop-att-preset-btn" data-target="85">85%</button>
          </div>
          <div class="vtop-att-custom-wrap">
            <input type="number" id="vtop-target-num" min="1" max="100" value="${this.targetPercent}" class="vtop-target-input vtop-att-num-input" aria-label="Custom target attendance percentage" />
            <span class="vtop-att-pct-sign">%</span>
          </div>
          <span id="vtop-target-debarment-warning" class="vtop-att-below-note" style="display: ${this.targetPercent < 75 ? 'inline-flex' : 'none'};" title="VIT debarment threshold is 75%">Below 75%</span>
        </div>
      `;

      table.parentNode.insertBefore(card, table);

      const numInput = document.getElementById('vtop-target-num');
      const presetBtns = card.querySelectorAll('.vtop-att-preset-btn');
      let debouncedStorageTimer = null;

      const syncPresets = (val) => {
        presetBtns.forEach((btn) => {
          btn.classList.toggle('is-active', parseInt(btn.dataset.target, 10) === val);
        });
      };
      syncPresets(this.targetPercent);

      const updateTarget = (val) => {
        val = Math.max(1, Math.min(100, parseInt(val, 10) || 75));
        this.targetPercent = val;
        if (numInput) numInput.value = val;
        syncPresets(val);
        const debarmentWarning = document.getElementById('vtop-target-debarment-warning');
        if (debarmentWarning) {
          debarmentWarning.style.display = val < 75 ? 'inline-flex' : 'none';
        }
        if (debouncedStorageTimer) clearTimeout(debouncedStorageTimer);
        debouncedStorageTimer = setTimeout(() => {
          if (chrome?.storage?.local) chrome.storage.local.set({ attendanceTarget: val });
        }, 300);

        const currentTable = this.findAttendanceTable() || table;
        if (currentTable) {
          this.augmentTable(currentTable);
        }
      };

      presetBtns.forEach((btn) => {
        btn.addEventListener('click', () => updateTarget(btn.dataset.target));
      });
      numInput?.addEventListener('change', (e) => updateTarget(e.target.value));
    },

    getCourseType(row) {
      const rowText = (row.textContent || '').toLowerCase();
      if (/\b(lab\s*only|embedded\s*lab|lo|ela)\b/i.test(rowText)) {
        return 'lab';
      }
      return 'theory';
    },

    estimateMaxRemaining(totalConducted, courseType) {
      // ~15-week VIT semester cap (~30 lab sessions, ~60 theory/SS classes)
      const semesterCap = courseType === 'lab' ? 30 : 60;
      if (totalConducted < semesterCap) {
        return semesterCap - totalConducted;
      }
      // Small buffer if instructor already conducted more than the typical cap
      return courseType === 'lab' ? 4 : 6;
    },

    /**
     * Resiliently extracts attendance numbers from separate columns (O(1) fast-path) or a rich status cell
     */
    extractAttendanceData(row, attendedIdx, totalIdx, odIdx = -1) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 3) return null;

      // 1. O(1) Fast-path: Separate numeric columns (exact #AttendanceDetailDataTable layout: col 5 & col 6)
      if (attendedIdx !== -1 && totalIdx !== -1 && cells[attendedIdx] && cells[totalIdx]) {
        const attText = (cells[attendedIdx].textContent || '').trim();
        const totText = (cells[totalIdx].textContent || '').trim();
        if (/^\d+$/.test(attText) && /^\d+$/.test(totText)) {
          const attended = parseInt(attText, 10) || 0;
          const total = parseInt(totText, 10) || 0;
          let onDuty = 0;
          if (odIdx !== -1 && cells[odIdx]) {
            onDuty = parseInt((cells[odIdx].textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
          }
          // Note: In VTOP, the Attended column already includes On Duty (OD) classes.
          const percentage = total > 0 ? (attended / total) * 100 : 0;
          return { attended, total, present: Math.max(0, attended - onDuty), absent: Math.max(0, total - attended), onDuty, percentage };
        }
      }

      // 2. Fallback: Rich multi-line Attendance Status cell
      for (const cell of cells) {
        const text = cell.textContent || '';
        if (
          (text.includes('Attended') || text.includes('Present')) &&
          (text.includes('Total Class') || text.includes('Total') || text.includes('Absent'))
        ) {
          const attMatch = text.match(/Attended\s*:\s*(\d+)/i);
          const totMatch = text.match(/Total\s*(?:Class|Classes)?\s*:\s*(\d+)/i);
          const presMatch = text.match(/Present\s*:\s*(\d+)/i);
          const absMatch = text.match(/Absent\s*:\s*(\d+)/i);
          const odMatch = text.match(/On\s*Duty\s*:\s*(\d+)/i);
          const pctMatch = text.match(/Percentage\s*:\s*(\d+(?:\.\d+)?)\s*%/i);

          if ((attMatch || presMatch) && (totMatch || absMatch)) {
            const present = presMatch ? parseInt(presMatch[1], 10) : 0;
            const absent = absMatch ? parseInt(absMatch[1], 10) : 0;
            const onDuty = odMatch ? parseInt(odMatch[1], 10) : 0;

            // In VTOP, Attended = Present + On Duty (On Duty is counted as present)
            let attended = attMatch ? parseInt(attMatch[1], 10) : present + onDuty;
            if (present + onDuty > attended) {
              attended = present + onDuty;
            }

            let total = totMatch ? parseInt(totMatch[1], 10) : attended + absent;
            const percentage = pctMatch
              ? parseFloat(pctMatch[1])
              : total > 0
              ? (attended / total) * 100
              : 0;

            return { attended, total, present, absent, onDuty, percentage };
          }
        }
      }

      // 3. Fallback: Separate columns with non-pure-digit formatting
      if (attendedIdx !== -1 && totalIdx !== -1 && cells[attendedIdx] && cells[totalIdx]) {
        const attended = parseInt((cells[attendedIdx].textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
        const total = parseInt((cells[totalIdx].textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
        let onDuty = 0;
        if (odIdx !== -1 && cells[odIdx]) {
          onDuty = parseInt((cells[odIdx].textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
        }
        // Note: In VTOP, the Attended column already includes On Duty (OD) classes.
        const percentage = total > 0 ? (attended / total) * 100 : 0;
        return { attended, total, present: Math.max(0, attended - onDuty), absent: Math.max(0, total - attended), onDuty, percentage };
      }

      return null;
    },

    augmentTable(table) {
      const headerRow = table.querySelector('thead tr, tr.tableHeader, tr:first-child');
      if (!headerRow) return;

      // Exact O(1) column indices for #AttendanceDetailDataTable, with header-scan fallback
      const ths = headerRow.querySelectorAll('th, td');
      let attendedIdx = -1;
      let totalIdx = -1;
      let odIdx = -1;

      if (table.id === 'AttendanceDetailDataTable' && ths.length >= 7) {
        attendedIdx = 5;
        totalIdx = 6;
      } else {
        ths.forEach((th, idx) => {
          const text = (th.textContent || '').toLowerCase().trim();
          if (text.includes('attended') && !text.includes('%') && !text.includes('percentage')) attendedIdx = idx;
          if (text.includes('total') || text.includes('conducted')) totalIdx = idx;
          if (text.includes('duty') || text === 'od') odIdx = idx;
        });
      }

      // Add Bunk Meter column header if not present
      if (!headerRow.querySelector('#vtop-th-bunk-meter')) {
        const newTh = document.createElement(headerRow.querySelector('th') ? 'th' : 'td');
        newTh.id = 'vtop-th-bunk-meter';
        newTh.className = 'vtop-th-bunk fixedContent tableHeader';
        newTh.style.cssText = 'text-align: center; vertical-align: middle; min-width: 160px;';
        newTh.textContent = 'VTOP++ Bunk Status';
        headerRow.appendChild(newTh);
      }

      // Process rows
      const allRows = Array.from(table.querySelectorAll('tr'));
      const dataRows = allRows.filter((r) => {
        if (r.classList.contains('tableHeader') || r.closest('thead')) return false;
        const cells = r.querySelectorAll('td');
        return cells.length >= 3;
      });

      const sig = `${this.targetPercent}|${dataRows.length}|${dataRows.map((r) => {
        const c = r.querySelectorAll('td');
        return `${c[attendedIdx]?.textContent || ''}/${c[totalIdx]?.textContent || ''}`;
      }).join(';')}`;
      if (table.dataset.vtopAttSig === sig && document.getElementById('vtop-attendance-summary-card')) {
        return;
      }
      table.dataset.vtopAttSig = sig;

      let totalAttendedSum = 0;
      let totalConductedSum = 0;
      let totalODSum = 0;
      let belowTargetCount = 0;

      dataRows.forEach((row) => {
        const data = this.extractAttendanceData(row, attendedIdx, totalIdx, odIdx);
        if (!data || data.total === 0) {
          // Ensure placeholder cell exists to prevent column count distortion across rows
          let bunkCell = row.querySelector('.vtop-td-bunk');
          if (!bunkCell) {
            bunkCell = document.createElement('td');
            bunkCell.className = 'vtop-td-bunk fixedContent tableContent';
            bunkCell.style.cssText = 'text-align: center; vertical-align: middle; padding: 8px 10px;';
            bunkCell.innerHTML = '<span style="color:var(--vtop-text-dim);font-size:12px;">--</span>';
            row.appendChild(bunkCell);
          }
          return;
        }

        totalAttendedSum += data.attended;
        totalConductedSum += data.total;
        totalODSum += data.onDuty;

        const currentPct = data.percentage;
        if (currentPct < this.targetPercent) belowTargetCount++;

        const courseType = this.getCourseType(row);
        const maxRemaining = this.estimateMaxRemaining(data.total, courseType);
        const targetPct = Math.max(1, Math.min(100, this.targetPercent));
        let statusHtml = '';

        // Calculate bunks strictly from actual classes conducted using exact integer math
        if (targetPct === 100) {
          if (data.attended < data.total) {
            const missed = data.total - data.attended;
            statusHtml = `
              <span class="vtop-badge vtop-badge-danger" title="Cannot achieve 100% attendance as ${missed} class${missed === 1 ? ' was' : 'es were'} missed">
                Impossible (missed ${missed})
              </span>
            `;
          } else {
            statusHtml = `
              <span class="vtop-badge vtop-badge-warn" title="Must attend every remaining class to stay at 100%">
                Need to attend all
              </span>
            `;
          }
        } else if (100 * data.attended >= targetPct * data.total) {
          const safeBunks = Math.max(0, Math.floor((100 * data.attended - targetPct * data.total) / targetPct));
          const badgeClass = currentPct >= 80 ? 'vtop-badge-safe' : 'vtop-badge-warn';
          if (safeBunks === 0) {
            statusHtml = `
              <span class="vtop-badge ${badgeClass}" title="Current attendance is right at target. Bunking the next class will drop you below ${targetPct}%">
                On target (0 bunks left)
              </span>
            `;
          } else if (safeBunks > maxRemaining || safeBunks > HARD_MAX_NEEDED) {
            statusHtml = `
              <span class="vtop-badge ${badgeClass}" title="Mathematically ${safeBunks} bunks above ${targetPct}%, covering all remaining classes in the semester">
                Can bunk all remaining
              </span>
            `;
          } else {
            statusHtml = `
              <span class="vtop-badge ${badgeClass}">
                Can bunk ${safeBunks} class${safeBunks === 1 ? '' : 'es'}
              </span>
            `;
          }
        } else {
          const needed = Math.max(1, Math.ceil((targetPct * data.total - 100 * data.attended) / (100 - targetPct)));
          const maxPossiblePct =
            data.total + maxRemaining > 0
              ? ((data.attended + maxRemaining) / (data.total + maxRemaining)) * 100
              : data.percentage;

          if (needed > maxRemaining || needed > HARD_MAX_NEEDED || maxPossiblePct < targetPct) {
            statusHtml = `
              <span class="vtop-badge vtop-badge-danger" title="Need to attend ${needed} consecutive classes to reach ${targetPct}%, which exceeds realistic remaining classes in a semester">
                Impossible
              </span>
            `;
          } else {
            statusHtml = `
              <span class="vtop-badge vtop-badge-danger">
                Need to attend ${needed} class${needed === 1 ? '' : 'es'}
              </span>
            `;
          }
        }

        // Inject / update cell in row (avoid redundant DOM writes)
        let bunkCell = row.querySelector('.vtop-td-bunk');
        if (!bunkCell) {
          bunkCell = document.createElement('td');
          bunkCell.className = 'vtop-td-bunk fixedContent tableContent';
          bunkCell.style.cssText = 'text-align: center; vertical-align: middle; padding: 8px 10px;';
          bunkCell.innerHTML = statusHtml;
          row.appendChild(bunkCell);
        } else if (bunkCell.innerHTML !== statusHtml) {
          bunkCell.innerHTML = statusHtml;
        }

        const newTitle =
          data.onDuty > 0
            ? `Present: ${data.present} + On Duty: ${data.onDuty} = Attended: ${data.attended} / ${data.total} (${data.percentage.toFixed(1)}%)`
            : `Attended: ${data.attended} / ${data.total} (${data.percentage.toFixed(1)}%)`;
        if (bunkCell.title !== newTitle) {
          bunkCell.title = newTitle;
        }
      });

      // Update Summary Bar numbers
      const overallElem = document.getElementById('vtop-stat-overall');
      const riskPill = document.getElementById('vtop-att-risk-pill');
      const odBox = document.getElementById('vtop-box-od');
      const odElem = document.getElementById('vtop-stat-od');

      if (overallElem) {
        if (totalConductedSum > 0) {
          const overallNum = (totalAttendedSum / totalConductedSum) * 100;
          overallElem.textContent = `Overall ${overallNum.toFixed(1)}%`;
          overallElem.className = `vtop-att-overall ${
            overallNum >= 80 ? 'is-safe' : overallNum >= 75 ? 'is-warn' : 'is-danger'
          }`;
        } else {
          overallElem.textContent = 'Overall --%';
          overallElem.className = 'vtop-att-overall';
        }
      }

      if (riskPill) {
        if (totalConductedSum > 0) {
          riskPill.style.display = 'inline-flex';
          if (belowTargetCount > 0) {
            riskPill.className = 'vtop-att-pill vtop-att-pill-danger';
            riskPill.textContent = `${belowTargetCount} below ${this.targetPercent}%`;
          } else {
            riskPill.className = 'vtop-att-pill vtop-att-pill-safe';
            riskPill.textContent = 'All Safe';
          }
        } else {
          riskPill.style.display = 'none';
        }
      }

      if (odBox && odElem) {
        if (totalODSum > 0) {
          odBox.style.display = 'inline-flex';
          odElem.textContent = totalODSum;
        } else {
          odBox.style.display = 'none';
        }
      }
    }
  };

  window.VTOP_PLUS.AttendanceCalculator = AttendanceCalculator;
})();
