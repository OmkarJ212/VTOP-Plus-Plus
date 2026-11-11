/**
 * VTOP++ - Attendance Bunk Calculator & Debarment Risk Module
 * Automatically analyzes attendance tables with rich status cell extraction (Attended, Total, OD, Present, Absent).
 * Provides interactive target simulations (1–100%) and bunk/attendance calculations.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const AttendanceCalculator = {
    targetPercent: 75,

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

      this.loadTargetSettings().then(() => {
        this.renderSummaryWidget(table);
        this.augmentTable(table);
      });
    },

    async loadTargetSettings() {
      if (chrome?.storage?.local) {
        return new Promise((resolve) => {
          chrome.storage.local.get(['attendanceTarget'], (res) => {
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
      // 1. Direct O(1) selector on Vellore VTOP
      const direct = document.querySelector('#attendanceDetail, table[id*="attendance" i]');
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
        return;
      }

      card = document.createElement('div');
      card.id = 'vtop-attendance-summary-card';
      card.className = 'vtop-plus-card vtop-attendance-card';

      card.innerHTML = `
        <div class="vtop-card-header" style="flex-wrap: wrap; gap: 12px;">
          <div class="vtop-card-title">
            <span>📊</span>
            <span>VTOP++ Smart Attendance & Bunk Calculator</span>
          </div>
          <div class="vtop-target-controls" style="display: flex; align-items: center; gap: 8px;">
            <!-- Target Range Slider & Number Box (1-100%) -->
            <label for="vtop-target-slider" style="font-weight: 600; font-size: 13px; color: #334155;">Target:</label>
            <input type="range" id="vtop-target-slider" min="1" max="100" step="1" value="${this.targetPercent}" style="width: 120px; cursor: pointer;" />
            <div style="display: flex; align-items: center; gap: 2px;">
              <input type="number" id="vtop-target-num" min="1" max="100" value="${this.targetPercent}" class="vtop-target-input" style="width: 52px; padding: 4px 6px; font-size: 13px; font-weight: 700; border: 1px solid #cbd5e1; border-radius: 4px; text-align: center;" />
              <span style="font-weight: 700; color: #475569; font-size: 13px;">%</span>
            </div>
          </div>
        </div>

        <div id="vtop-target-debarment-warning" class="vtop-debarment-warning" style="display: ${this.targetPercent < 75 ? 'flex' : 'none'};">
          <span>⚠️</span>
          <span>Target is below VIT debarment threshold (75%)</span>
        </div>

        <div class="vtop-stats-grid" id="vtop-attendance-stats-grid">
          <div class="vtop-stat-box">
            <span class="vtop-stat-num" id="vtop-stat-overall">--%</span>
            <span class="vtop-stat-lbl">Average Attendance</span>
          </div>
          <div class="vtop-stat-box">
            <span class="vtop-stat-num" id="vtop-stat-safe" style="color: #27ae60;">0</span>
            <span class="vtop-stat-lbl">Safe Subjects (≥80%)</span>
          </div>
          <div class="vtop-stat-box">
            <span class="vtop-stat-num" id="vtop-stat-warn" style="color: #f39c12;">0</span>
            <span class="vtop-stat-lbl">Warning (75%–79%)</span>
          </div>
          <div class="vtop-stat-box">
            <span class="vtop-stat-num" id="vtop-stat-danger" style="color: #e74c3c;">0</span>
            <span class="vtop-stat-lbl">Debarred Risk (&lt;75%)</span>
          </div>
          <div class="vtop-stat-box" id="vtop-box-od" style="display: none;">
            <span class="vtop-stat-num" id="vtop-stat-od" style="color: #0284c7;">0</span>
            <span class="vtop-stat-lbl">On Duty Classes</span>
          </div>
        </div>
      `;

      table.parentNode.insertBefore(card, table);

      const slider = document.getElementById('vtop-target-slider');
      const numInput = document.getElementById('vtop-target-num');

      const updateTarget = (val) => {
        val = Math.max(1, Math.min(100, parseInt(val, 10) || 75));
        this.targetPercent = val;
        if (slider) slider.value = val;
        if (numInput) numInput.value = val;
        const debarmentWarning = document.getElementById('vtop-target-debarment-warning');
        if (debarmentWarning) {
          debarmentWarning.style.display = val < 75 ? 'flex' : 'none';
        }
        if (chrome?.storage?.local) chrome.storage.local.set({ attendanceTarget: val });
        this.augmentTable(table);
      };

      slider?.addEventListener('input', (e) => updateTarget(e.target.value));
      numInput?.addEventListener('change', (e) => updateTarget(e.target.value));
    },

    /**
     * Resiliently extracts attendance numbers from either a single rich cell or separate columns
     */
    extractAttendanceData(row, attendedIdx, totalIdx, odIdx = -1) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 3) return null;

      // 1. Primary: Rich multi-line Attendance Status cell
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

      // 2. Fallback: Separate column layout
      if (attendedIdx !== -1 && totalIdx !== -1 && cells[attendedIdx] && cells[totalIdx]) {
        let attended = parseInt((cells[attendedIdx].textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
        const total = parseInt((cells[totalIdx].textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
        let onDuty = 0;
        if (odIdx !== -1 && cells[odIdx]) {
          onDuty = parseInt((cells[odIdx].textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
        }
        if (onDuty > 0 && attended + onDuty <= total) {
          attended += onDuty;
        }
        const percentage = total > 0 ? (attended / total) * 100 : 0;
        return { attended, total, present: Math.max(0, attended - onDuty), absent: Math.max(0, total - attended), onDuty, percentage };
      }

      return null;
    },

    augmentTable(table) {
      const headerRow = table.querySelector('thead tr, tr.tableHeader, tr:first-child');
      if (!headerRow) return;

      // Identify column indices if separate columns exist
      const ths = headerRow.querySelectorAll('th, td');
      let attendedIdx = -1;
      let totalIdx = -1;
      let odIdx = -1;

      ths.forEach((th, idx) => {
        const text = (th.textContent || '').toLowerCase().trim();
        if (text.includes('attended') && !text.includes('%') && !text.includes('percentage')) attendedIdx = idx;
        if (text.includes('total') || text.includes('conducted')) totalIdx = idx;
        if (text.includes('duty') || text === 'od') odIdx = idx;
      });

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

      let totalAttendedSum = 0;
      let totalConductedSum = 0;
      let totalODSum = 0;
      let safeCount = 0;
      let warnCount = 0;
      let dangerCount = 0;

      dataRows.forEach((row) => {
        const data = this.extractAttendanceData(row, attendedIdx, totalIdx, odIdx);
        if (!data || data.total === 0) {
          // Ensure placeholder cell exists to prevent column count distortion across rows
          let bunkCell = row.querySelector('.vtop-td-bunk');
          if (!bunkCell) {
            bunkCell = document.createElement('td');
            bunkCell.className = 'vtop-td-bunk fixedContent tableContent';
            bunkCell.style.cssText = 'text-align: center; vertical-align: middle; padding: 8px 10px;';
            bunkCell.innerHTML = '<span style="color:#94a3b8;font-size:12px;">--</span>';
            row.appendChild(bunkCell);
          }
          return;
        }

        totalAttendedSum += data.attended;
        totalConductedSum += data.total;
        totalODSum += data.onDuty;

        const currentPct = data.percentage;

        if (currentPct >= 80) safeCount++;
        else if (currentPct >= 75) warnCount++;
        else dangerCount++;

        const target = Math.max(0.01, this.targetPercent / 100);
        let statusHtml = '';

        // Calculate bunks strictly from actual classes conducted
        if (this.targetPercent === 100) {
          if (data.attended < data.total) {
            const missed = data.total - data.attended;
            statusHtml = `
              <span class="vtop-badge vtop-badge-danger" title="Cannot achieve 100% attendance as ${missed} class${missed === 1 ? ' was' : 'es were'} missed">
                🔴 100% Impossible (already missed ${missed})
              </span>
            `;
          } else {
            statusHtml = `
              <span class="vtop-badge vtop-badge-warn" title="Must attend every remaining class to stay at 100%">
                🟡 Must attend every class (0 bunks)
              </span>
            `;
          }
        } else if (currentPct >= this.targetPercent) {
          const safeBunks = Math.max(0, Math.floor((data.attended - target * data.total) / target));
          const badgeClass = currentPct >= 80 ? 'vtop-badge-safe' : 'vtop-badge-warn';
          if (safeBunks === 0) {
            statusHtml = `
              <span class="vtop-badge ${badgeClass}" title="Current attendance is right at target. Bunking the next class will drop you below ${this.targetPercent}%">
                🟡 On target (cannot bunk next class)
              </span>
            `;
          } else {
            statusHtml = `
              <span class="vtop-badge ${badgeClass}">
                🟢 Can bunk <strong>${safeBunks}</strong> class${safeBunks === 1 ? '' : 'es'}
              </span>
            `;
          }
        } else {
          const needed = Math.max(1, Math.ceil((target * data.total - data.attended) / (1 - target)));
          statusHtml = `
            <span class="vtop-badge vtop-badge-danger">
              🔴 Attend <strong>${needed}</strong> consecutive class${needed === 1 ? '' : 'es'}
            </span>
          `;
        }

        // Clarify On Duty in cell if present
        if (data.onDuty > 0) {
          statusHtml += `
            <div style="font-size: 11px; color: #0284c7; font-weight: 600; margin-top: 4px;">
              Includes ${data.onDuty} On Duty
            </div>
          `;
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

      // Update Summary Header numbers
      const overallElem = document.getElementById('vtop-stat-overall');
      const safeElem = document.getElementById('vtop-stat-safe');
      const warnElem = document.getElementById('vtop-stat-warn');
      const dangerElem = document.getElementById('vtop-stat-danger');
      const odBox = document.getElementById('vtop-box-od');
      const odElem = document.getElementById('vtop-stat-od');

      if (overallElem && totalConductedSum > 0) {
        const overallPct = ((totalAttendedSum / totalConductedSum) * 100).toFixed(1);
        overallElem.textContent = `${overallPct}%`;
        if (overallPct >= 80) overallElem.style.color = '#27ae60';
        else if (overallPct >= 75) overallElem.style.color = '#f39c12';
        else overallElem.style.color = '#e74c3c';
      }

      if (safeElem) safeElem.textContent = safeCount;
      if (warnElem) warnElem.textContent = warnCount;
      if (dangerElem) dangerElem.textContent = dangerCount;

      if (odBox && odElem) {
        if (totalODSum > 0) {
          odBox.style.display = 'block';
          odElem.textContent = totalODSum;
        } else {
          odBox.style.display = 'none';
        }
      }
    }
  };

  window.VTOP_PLUS.AttendanceCalculator = AttendanceCalculator;
})();
