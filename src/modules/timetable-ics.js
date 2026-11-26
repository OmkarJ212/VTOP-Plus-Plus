/**
 * VTOP++ - Timetable Parser & RFC 5545 .ics Calendar Exporter
 * Parses VTOP's #timeTableStyle grid + Course Summary table and builds
 * RFC 5545 .ics calendar files & Google Calendar export modal.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const MODAL_ID = 'vtop-tt-export-modal';
  const REMINDER_PREF_KEY = 'vtop_tt_reminder_mins';

  const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const DAY_SHORT = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
  const DAY_BYDAY = { MON: 'MO', TUE: 'TU', WED: 'WE', THU: 'TH', FRI: 'FR', SAT: 'SA', SUN: 'SU' };
  const JS_DAY_TO_KEY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const REGEX_COURSE_CODE = /\b([A-Z]{2,5}\d{3,4}[A-Z]?)\b/;

  const cleanText = (el) => window.VTOP_PLUS.DOM.cleanText(el);
  const toIsoDate = (d) => window.VTOP_PLUS.DOM.toIsoDate(d);

  function parseTimeToMinutes(raw, afterLunch = false) {
    if (!raw) return null;
    const str = String(raw).trim();
    const m = str.match(/(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[3] ? m[3].toUpperCase() : '';
    if (ampm === 'PM' && h < 12) h += 12;
    else if (ampm === 'AM' && h === 12) h = 0;
    else if (!ampm && afterLunch && h >= 1 && h <= 7) h += 12;
    else if (!ampm && h >= 1 && h <= 7) h += 12; // VIT Vellore classes run 08:00 - 19:30
    return h * 60 + min;
  }

  function formatMinutes24(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Builds a 2D logical cell matrix expanding rowspan & colspan from a <table>.
   */
  function buildTableMatrix(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const matrix = [];
    for (let r = 0; r < rows.length; r++) {
      if (!matrix[r]) matrix[r] = [];
      let c = 0;
      const cells = Array.from(rows[r].children).filter((el) => el.tagName === 'TD' || el.tagName === 'TH');
      for (const cell of cells) {
        while (matrix[r][c] !== undefined) c++;
        const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);
        const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
        for (let dr = 0; dr < rowspan; dr++) {
          if (!matrix[r + dr]) matrix[r + dr] = [];
          for (let dc = 0; dc < colspan; dc++) {
            matrix[r + dr][c + dc] = {
              cell,
              text: cleanText(cell),
              isOrigin: dr === 0 && dc === 0,
              colspan: dr === 0 && dc === 0 ? colspan : 1
            };
          }
        }
        c += colspan;
      }
    }
    return matrix;
  }

  function parseCourseSummaryTables(root) {
    const coursesByCode = {};
    const tables = Array.from(root.querySelectorAll('table')).filter((t) => t.id !== 'timeTableStyle');

    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length < 2) continue;

      let headerRowIdx = -1;
      let colMap = {};

      for (let i = 0; i < Math.min(3, rows.length); i++) {
        const headers = Array.from(rows[i].querySelectorAll('th, td')).map((c) => cleanText(c).toLowerCase());
        const courseIdx = headers.findIndex((h) => h === 'course' || h.includes('course title') || h.includes('course code'));
        const slotIdx = headers.findIndex((h) => h.includes('slot') || h.includes('venue'));
        const facultyIdx = headers.findIndex((h) => h.includes('faculty'));
        if (courseIdx !== -1 && (slotIdx !== -1 || facultyIdx !== -1)) {
          headerRowIdx = i;
          colMap = {
            courseIdx,
            typeIdx: headers.findIndex((h) => h.includes('type') || h === 'l t p j c'),
            slotIdx,
            venueIdx: headers.findIndex((h) => h === 'venue' || h.includes('room')),
            facultyIdx
          };
          break;
        }
      }

      if (headerRowIdx === -1) continue;

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const cells = Array.from(rows[r].querySelectorAll('td'));
        if (cells.length < 3) continue;
        const courseText = cleanText(cells[colMap.courseIdx]);
        const codeMatch = courseText.match(REGEX_COURSE_CODE);
        if (!codeMatch) continue;

        const code = codeMatch[1].toUpperCase();
        let title = courseText.replace(codeMatch[0], '').replace(/^[\s\-:]+/, '').trim();
        let courseType = '';
        const parenMatch = title.match(/\(([^)]+)\)\s*$/);
        if (parenMatch) {
          courseType = parenMatch[1].trim();
          title = title.slice(0, parenMatch.index).trim();
        }

        const slotVenueText = colMap.slotIdx !== -1 ? cleanText(cells[colMap.slotIdx]) : '';
        const facultyText = colMap.facultyIdx !== -1 ? cleanText(cells[colMap.facultyIdx]) : '';
        const faculty = facultyText.split(/\s*-\s*(?:SCHOOL|SCOPE|SENSE|SELECT|SMEC|SCE|SAS|SSL|VITBS)/i)[0].trim() || facultyText;

        let slot = '';
        let venue = colMap.venueIdx !== -1 && colMap.venueIdx !== colMap.slotIdx ? cleanText(cells[colMap.venueIdx]) : '';
        if (slotVenueText) {
          const parts = slotVenueText.split(/\s+-\s+/);
          slot = (parts[0] || '').trim();
          if (!venue && parts[1]) venue = parts.slice(1).join(' - ').trim();
        }

        const entry = { code, title: title || code, courseType, slot, venue, faculty };
        if (!coursesByCode[code]) coursesByCode[code] = [];
        coursesByCode[code].push(entry);
      }

      if (Object.keys(coursesByCode).length > 0) break;
    }

    return coursesByCode;
  }

  function extractTimeHeaders(matrix) {
    const theoryTimes = {};
    const labTimes = {};

    const parsePair = (startRow, endRow, targetMap) => {
      let passedLunch = false;
      const len = Math.max(startRow.length, endRow.length);
      for (let c = 0; c < len; c++) {
        const sTxt = startRow[c]?.text || '';
        const eTxt = endRow[c]?.text || '';
        if (/lunch/i.test(sTxt) || /lunch/i.test(eTxt)) {
          passedLunch = true;
          continue;
        }
        const startMin = parseTimeToMinutes(sTxt, passedLunch);
        const endMin = parseTimeToMinutes(eTxt, passedLunch);
        if (startMin !== null && endMin !== null) {
          if (startMin >= 13 * 60) passedLunch = true;
          targetMap[c] = { startMin, endMin };
        }
      }
    };

    let lastSection = '';
    for (let r = 0; r < matrix.length - 1; r++) {
      const rowTexts = matrix[r].map((x) => (x?.text || '').toUpperCase());
      const nextTexts = matrix[r + 1].map((x) => (x?.text || '').toUpperCase());
      if (rowTexts.some((t) => t.includes('THEORY'))) lastSection = 'THEORY';
      else if (rowTexts.some((t) => t.includes('LAB'))) lastSection = 'LAB';

      const hasStart = rowTexts.some((t) => /\bSTART\b/.test(t));
      const hasEnd = nextTexts.some((t) => /\bEND\b/.test(t));
      if (!hasStart || !hasEnd) continue;

      const section = rowTexts.some((t) => t.includes('THEORY'))
        ? 'THEORY'
        : rowTexts.some((t) => t.includes('LAB'))
          ? 'LAB'
          : lastSection;

      if (section === 'THEORY') {
        parsePair(matrix[r], matrix[r + 1], theoryTimes);
      } else if (section === 'LAB') {
        parsePair(matrix[r], matrix[r + 1], labTimes);
      }
    }

    return { theoryTimes, labTimes };
  }

  function parseSlotCellText(text, coursesByCode) {
    if (!text) return null;
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized === '-' || /^lunch$/i.test(normalized)) return null;

    // Standard VTOP cell: "A1-BCSE302L-TH-SJT401-ALL" or "A1-BCSE302L-TH-SJT-401-ALL"
    const parts = normalized.split(/\s*-\s*/);
    if (parts.length >= 3 && REGEX_COURSE_CODE.test(parts[1])) {
      const slot = parts[0].trim();
      const code = parts[1].match(REGEX_COURSE_CODE)[1].toUpperCase();
      const type = parts[2].trim();
      const tail = parts.slice(3);
      if (tail.length > 1 && /^(ALL|B[12]|G[12]|T[12])$/i.test(tail[tail.length - 1])) {
        tail.pop();
      }
      const venue = tail.join('-').trim();
      return { slot, code, type, venue };
    }

    // Alternate cell starting directly with course code: "BCSE302L-TH-SJT401-ALL"
    if (parts.length >= 2 && REGEX_COURSE_CODE.test(parts[0])) {
      const code = parts[0].match(REGEX_COURSE_CODE)[1].toUpperCase();
      const type = (parts[1] || '').trim();
      const tail = parts.slice(2);
      if (tail.length > 1 && /^(ALL|B[12]|G[12]|T[12])$/i.test(tail[tail.length - 1])) {
        tail.pop();
      }
      return { slot: '', code, type, venue: tail.join('-').trim() };
    }

    // Fallback: match registered course code anywhere in cell text
    const codeMatch = normalized.match(REGEX_COURSE_CODE);
    if (codeMatch && coursesByCode[codeMatch[1].toUpperCase()]) {
      const code = codeMatch[1].toUpperCase();
      return {
        slot: parts[0] && parts[0] !== code ? parts[0].trim() : '',
        code,
        type: parts[2] || '',
        venue: parts[3] || ''
      };
    }

    return null;
  }

  function mergeConsecutiveSlots(slots) {
    if (!Array.isArray(slots) || slots.length === 0) return [];
    const sorted = [...slots].sort((a, b) => a.startMin - b.startMin);
    const merged = [];

    for (const item of sorted) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        prev.code === item.code &&
        prev.type === item.type &&
        prev.venue === item.venue &&
        item.startMin - prev.endMin <= 15
      ) {
        prev.endMin = Math.max(prev.endMin, item.endMin);
        if (item.slot && !prev.slot.split('+').includes(item.slot)) {
          prev.slot = prev.slot ? `${prev.slot}+${item.slot}` : item.slot;
        }
      } else {
        merged.push({ ...item });
      }
    }
    return merged;
  }

  function parseTimeTableFromRoot(root) {
    if (!root || !root.querySelector) return null;
    const gridTable = root.getElementById ? root.getElementById('timeTableStyle') : root.querySelector('#timeTableStyle');
    if (!gridTable) return null;

    const coursesByCode = parseCourseSummaryTables(root);
    const matrix = buildTableMatrix(gridTable);
    const { theoryTimes, labTimes } = extractTimeHeaders(matrix);

    const rawSlotsByDay = { MON: [], TUE: [], WED: [], THU: [], FRI: [], SAT: [], SUN: [] };
    const seenKeys = new Set();

    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r];
      let dayKey = '';
      for (let dc = 0; dc < Math.min(2, row.length); dc++) {
        const rawDay = (row[dc]?.text || '').trim().toUpperCase();
        const mDay = rawDay.match(/^(MON|TUE|WED|THU|FRI|SAT|SUN)(?:DAY)?\b/);
        if (mDay) {
          dayKey = mDay[1];
          break;
        }
      }
      if (!dayKey) continue;

      const kindCell = row.slice(0, 3).find((cell) => cell && /\b(THEORY|LAB)\b/i.test(cell.text));
      const rowKind = kindCell && /\bLAB\b/i.test(kindCell.text) ? 'LAB' : 'THEORY';
      const timeMap = rowKind === 'LAB' ? labTimes : theoryTimes;

      for (let c = 0; c < row.length; c++) {
        const entry = row[c];
        if (!entry || !entry.isOrigin) continue;
        const startTiming = timeMap[c];
        if (!startTiming) continue;

        let endMin = startTiming.endMin;
        const span = entry.colspan || 1;
        for (let k = 1; k < span; k++) {
          if (timeMap[c + k]) {
            endMin = Math.max(endMin, timeMap[c + k].endMin);
          }
        }
        const timing = { startMin: startTiming.startMin, endMin };

        const parsed = parseSlotCellText(entry.text, coursesByCode);
        if (!parsed) continue;

        const metaList = coursesByCode[parsed.code] || [];
        const matchedMeta =
          metaList.find((m) => {
            if (/lab|lo|ela/i.test(parsed.type) && /lab/i.test(m.courseType)) return true;
            if (/th|eth/i.test(parsed.type) && /theory/i.test(m.courseType)) return true;
            return false;
          }) || metaList[0];

        const dedupKey = `${dayKey}|${timing.startMin}|${timing.endMin}|${parsed.code}|${parsed.type}`;
        if (seenKeys.has(dedupKey)) continue;
        seenKeys.add(dedupKey);

        rawSlotsByDay[dayKey].push({
          day: dayKey,
          startMin: timing.startMin,
          endMin: timing.endMin,
          slot: parsed.slot || matchedMeta?.slot || '',
          code: parsed.code,
          title: matchedMeta?.title || parsed.code,
          type: parsed.type || (rowKind === 'LAB' ? 'LO' : 'TH'),
          venue: parsed.venue || matchedMeta?.venue || '',
          faculty: matchedMeta?.faculty || ''
        });
      }
    }

    const mergedSlotsByDay = {};
    let totalClasses = 0;
    for (const day of DAY_ORDER) {
      rawSlotsByDay[day].sort((a, b) => a.startMin - b.startMin);
      mergedSlotsByDay[day] = mergeConsecutiveSlots(rawSlotsByDay[day]);
      totalClasses += mergedSlotsByDay[day].length;
    }

    if (totalClasses === 0 && Object.keys(coursesByCode).length === 0) {
      return null;
    }

    return {
      coursesByCode,
      rawSlotsByDay,
      mergedSlotsByDay,
      totalClasses
    };
  }

  // ===========================================================================
  // RFC 5545 .ics GENERATOR
  // ===========================================================================

  function escapeIcsText(str) {
    return String(str || '')
      .replace(/\\/g, '\\\\')
      .replace(/\r\n?/g, '\n')
      .replace(/\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function foldIcsLine(line) {
    if (line.length <= 74) return line;
    const parts = [];
    parts.push(line.slice(0, 74));
    let idx = 74;
    while (idx < line.length) {
      parts.push(' ' + line.slice(idx, idx + 73));
      idx += 73;
    }
    return parts.join('\r\n');
  }

  function formatUtcIcsDateTime(dateObj) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    const hh = String(dateObj.getUTCHours()).padStart(2, '0');
    const mm = String(dateObj.getUTCMinutes()).padStart(2, '0');
    const ss = String(dateObj.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${d}T${hh}${mm}${ss}Z`;
  }

  function getFirstDateOnOrAfter(startDateStr, dayKey) {
    const targetJsDay = JS_DAY_TO_KEY.indexOf(dayKey);
    const [y, m, d] = startDateStr.split('-').map((n) => parseInt(n, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    const diff = (targetJsDay - dt.getUTCDay() + 7) % 7;
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt;
  }

  function istDateMinutesToUtc(utcDayDate, mins) {
    return new Date(
      Date.UTC(
        utcDayDate.getUTCFullYear(),
        utcDayDate.getUTCMonth(),
        utcDayDate.getUTCDate(),
        0,
        mins - 330,
        0
      )
    );
  }

  function isIsoDateString(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
  }

  function sanitizeUidPart(str) {
    return String(str || '').replace(/[^A-Za-z0-9._-]/g, '') || 'X';
  }

  function normalizeReminderMinutes(val, fallback = 10) {
    if (val === '' || val === null || val === undefined) return fallback;
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
    return Math.max(0, Math.min(1440, n));
  }

  function countIcsEvents(timetable, startDate, endDate, mergeLabs = true) {
    if (!timetable) return 0;
    const validEnd = isIsoDateString(endDate) ? endDate : toIsoDate(new Date(Date.now() + 112 * 24 * 60 * 60 * 1000));
    const validStart = isIsoDateString(startDate) ? startDate : toIsoDate(new Date());
    const [ey, em, ed] = validEnd.split('-').map((n) => parseInt(n, 10));
    const untilDate = new Date(Date.UTC(ey, em - 1, ed, 23, 59 - 330, 59));
    const slotsSource = mergeLabs ? timetable.mergedSlotsByDay : timetable.rawSlotsByDay;
    let count = 0;
    for (const dayKey of DAY_ORDER) {
      for (const item of slotsSource?.[dayKey] || []) {
        const firstOccurrence = getFirstDateOnOrAfter(validStart, dayKey);
        const dtStart = istDateMinutesToUtc(firstOccurrence, item.startMin);
        if (dtStart <= untilDate) count++;
      }
    }
    return count;
  }

  function generateIcsContent(timetable, options = {}) {
    const rawStart = options.startDate;
    const rawEnd = options.endDate;
    const startDate = isIsoDateString(rawStart) ? rawStart : toIsoDate(new Date());
    const endDate = isIsoDateString(rawEnd) ? rawEnd : toIsoDate(new Date(Date.now() + 112 * 24 * 60 * 60 * 1000));
    const {
      mergeLabs = true,
      reminderMinutes = 10,
      semesterSubId = 'SEM',
      authId = 'VTOP'
    } = options;

    const slotsSource = mergeLabs ? timetable.mergedSlotsByDay : timetable.rawSlotsByDay;
    const [ey, em, ed] = endDate.split('-').map((n) => parseInt(n, 10));
    const untilDate = new Date(Date.UTC(ey, em - 1, ed, 23, 59 - 330, 59));
    const untilUtc = formatUtcIcsDateTime(untilDate);
    const now = new Date();
    const stampUtc = formatUtcIcsDateTime(now);
    const exportBatch = now.getTime().toString(36);
    const safeAuth = sanitizeUidPart(authId);
    const safeSem = sanitizeUidPart(semesterSubId);

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//VTOP++//VIT Vellore Timetable//EN',
      'CALSCALE:GREGORIAN',
      `X-WR-CALNAME:VTOP Timetable (${semesterSubId})`,
      'X-WR-TIMEZONE:Asia/Kolkata'
    ];

    for (const dayKey of DAY_ORDER) {
      const items = slotsSource[dayKey] || [];
      for (const item of items) {
        const firstOccurrence = getFirstDateOnOrAfter(startDate, dayKey);
        const dtStartDate = istDateMinutesToUtc(firstOccurrence, item.startMin);
        const dtEndDate = istDateMinutesToUtc(firstOccurrence, item.endMin);
        if (dtStartDate > untilDate) continue;

        const dtStartUtc = formatUtcIcsDateTime(dtStartDate);
        const dtEndUtc = formatUtcIcsDateTime(dtEndDate);
        const utcDayKey = JS_DAY_TO_KEY[dtStartDate.getUTCDay()];
        const safeCode = sanitizeUidPart(item.code);
        const safeType = sanitizeUidPart(item.type || 'CLS');
        const uid = `vtop-plus-${safeAuth}-${safeSem}-${safeCode}-${safeType}-${dayKey}-${item.startMin}-${exportBatch}@vtop.vit.ac.in`;
        const summary = item.title || item.code;

        const descParts = [];
        if (item.slot) descParts.push(`Slot: ${item.slot}`);
        if (item.faculty) descParts.push(`Faculty: ${item.faculty}`);
        if (item.type) descParts.push(`Type: ${item.type}`);

        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${stampUtc}`);
        lines.push(`DTSTART:${dtStartUtc}`);
        lines.push(`DTEND:${dtEndUtc}`);
        lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${DAY_BYDAY[utcDayKey]};UNTIL=${untilUtc}`);
        lines.push(`SUMMARY:${escapeIcsText(summary)}`);
        if (item.venue) lines.push(`LOCATION:${escapeIcsText(item.venue)}`);
        if (descParts.length) lines.push(`DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`);
        lines.push('STATUS:CONFIRMED');
        lines.push('SEQUENCE:0');
        const safeReminder = normalizeReminderMinutes(reminderMinutes, 10);
        if (safeReminder > 0) {
          lines.push('BEGIN:VALARM');
          lines.push(`TRIGGER:-PT${safeReminder}M`);
          lines.push('ACTION:DISPLAY');
          lines.push(`DESCRIPTION:${escapeIcsText(summary)}`);
          lines.push('END:VALARM');
        }
        lines.push('END:VEVENT');
      }
    }

    lines.push('END:VCALENDAR');
    return lines.map(foldIcsLine).join('\r\n') + '\r\n';
  }

  const TimetableIcs = {
    MODAL_ID,
    DAY_ORDER,
    DAY_SHORT,
    parseTimeToMinutes,
    formatMinutes24,
    parseTimeTableFromRoot,
    countIcsEvents,
    generateIcsContent,
    _reminderMinutes: 10,
    _reminderPrefLoaded: false,

    async loadReminderPreference() {
      if (this._reminderPrefLoaded) return this._reminderMinutes;
      this._reminderPrefLoaded = true;
      const Storage = window.VTOP_PLUS?.Storage;
      if (!Storage) return this._reminderMinutes;
      try {
        const stored = await Storage.get([REMINDER_PREF_KEY]);
        if (stored && stored[REMINDER_PREF_KEY] !== undefined) {
          this._reminderMinutes = normalizeReminderMinutes(stored[REMINDER_PREF_KEY], 10);
        }
      } catch (_) {}
      return this._reminderMinutes;
    },

    async saveReminderPreference(mins) {
      const normalized = normalizeReminderMinutes(mins, 10);
      this._reminderMinutes = normalized;
      this._reminderPrefLoaded = true;
      const Storage = window.VTOP_PLUS?.Storage;
      if (Storage) {
        await Storage.set({ [REMINDER_PREF_KEY]: normalized }).catch(() => {});
      }
      return normalized;
    },

    async openExportModal(timetable, semId) {
      document.getElementById(MODAL_ID)?.remove();

      const today = new Date();
      const defaultEnd = new Date(today.getTime() + 112 * 24 * 60 * 60 * 1000);
      const savedReminder = await this.loadReminderPreference();

      const overlay = document.createElement('div');
      overlay.id = MODAL_ID;
      overlay.className = 'vtop-tt-modal-overlay';
      overlay.innerHTML = `
        <div class="vtop-plus-card vtop-tt-modal" role="dialog" aria-modal="true" aria-labelledby="vtop-tt-modal-title">
          <div class="vtop-tt-modal-head">
            <div>
              <h3 id="vtop-tt-modal-title">Export Timetable (.ics)</h3>
            </div>
            <button type="button" class="vtop-msg-icon-btn" id="vtop-tt-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="vtop-tt-modal-body">
            <div class="vtop-tt-modal-grid">
              <label class="vtop-tt-field">
                <span>Repeat From</span>
                <input type="date" id="vtop-tt-start-date" value="${toIsoDate(today)}" />
              </label>
              <label class="vtop-tt-field">
                <span>Repeat Until (Semester End)</span>
                <input type="date" id="vtop-tt-end-date" value="${toIsoDate(defaultEnd)}" />
              </label>
            </div>
            <div class="vtop-tt-notify-row">
              <label for="vtop-tt-reminder-mins">Notify before:</label>
              <input type="number" id="vtop-tt-reminder-mins" min="0" max="1440" step="1" value="${savedReminder}" aria-label="Notify before minutes" />
              <span class="vtop-tt-notify-suffix">mins</span>
            </div>
            <div class="vtop-tt-modal-err" id="vtop-tt-modal-err" hidden></div>
          </div>
          <div class="vtop-tt-modal-foot">
            <button type="button" class="vtop-tt-btn" id="vtop-tt-gcal-sync">Add to Google Calendar</button>
            <button type="button" class="vtop-tt-btn vtop-tt-btn-primary" id="vtop-tt-download-only">Download .ics</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#vtop-tt-modal-close')?.addEventListener('click', close);

      const minsInput = overlay.querySelector('#vtop-tt-reminder-mins');
      const errEl = overlay.querySelector('#vtop-tt-modal-err');

      const runDownload = (openGcal) => {
        const startDate = overlay.querySelector('#vtop-tt-start-date')?.value || toIsoDate(today);
        const endDate = overlay.querySelector('#vtop-tt-end-date')?.value || toIsoDate(defaultEnd);
        const mergeLabs = true;
        const reminderMinutes = normalizeReminderMinutes(minsInput?.value, 0);
        this.saveReminderPreference(reminderMinutes);

        if (countIcsEvents(timetable, startDate, endDate, mergeLabs) === 0) {
          if (errEl) {
            errEl.textContent = 'No classes fall within the selected dates.';
            errEl.hidden = false;
          }
          return;
        }
        if (errEl) errEl.hidden = true;

        const ics = generateIcsContent(timetable, {
          startDate,
          endDate,
          mergeLabs,
          reminderMinutes,
          semesterSubId: semId,
          authId: window.VTOP_PLUS?.DOM?.getAuthId?.() || 'VTOP'
        });

        window.VTOP_PLUS?.DOM?.triggerBlobDownload(ics, `VTOP_${sanitizeUidPart(semId || 'Timetable')}.ics`, 'text/calendar;charset=utf-8');
        if (openGcal) {
          window.open('https://calendar.google.com/calendar/u/0/r/settings/export', '_blank', 'noopener');
        }
        close();
      };

      overlay.querySelector('#vtop-tt-download-only')?.addEventListener('click', () => runDownload(false));
      overlay.querySelector('#vtop-tt-gcal-sync')?.addEventListener('click', () => runDownload(true));
    }
  };

  window.VTOP_PLUS.TimetableIcs = TimetableIcs;
})();
