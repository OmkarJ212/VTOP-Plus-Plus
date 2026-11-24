/**
 * VTOP++ - Timetable .ics / Google Calendar Export & Today's Schedule Widget
 * 1. Resolves the true active semester via StudentDA's first option (avoiding upcoming next-semester shells).
 * 2. Parses VTOP's #timeTableStyle grid + Course Summary table (handling rowspan/colspan & Dark Mode).
 * 3. Renders a compact "Today's Schedule" card at the top of the Home right column.
 * 4. Generates RFC 5545 .ics calendar files & Google Calendar recurring event links.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const WIDGET_ID = 'vtop-home-today-schedule';
  const PAGE_BAR_ID = 'vtop-tt-page-toolbar';
  const MODAL_ID = 'vtop-tt-export-modal';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (timetable rarely changes)

  const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const DAY_SHORT = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
  const DAY_BYDAY = { MON: 'MO', TUE: 'TU', WED: 'WE', THU: 'TH', FRI: 'FR', SAT: 'SA', SUN: 'SU' };
  const JS_DAY_TO_KEY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const REGEX_COURSE_CODE = /\b([A-Z]{2,5}\d{3,4}[A-Z]?)\b/;

  const escapeHtml = (str) => window.VTOP_PLUS.DOM.escapeHtml(str);
  const cleanText = (el) => window.VTOP_PLUS.DOM.cleanText(el);

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

  function getIstNowParts() {
    const now = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(now);
      const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
      const wk = String(map.weekday || '').toUpperCase().slice(0, 3);
      const dayKey = DAY_ORDER.includes(wk) ? wk : JS_DAY_TO_KEY[now.getDay()];
      const hh = parseInt(map.hour, 10) % 24;
      const mm = parseInt(map.minute, 10);
      if (!isNaN(hh) && !isNaN(mm)) {
        return { now, dayKey, mins: hh * 60 + mm };
      }
    } catch (_) {}
    return { now, dayKey: JS_DAY_TO_KEY[now.getDay()], mins: now.getHours() * 60 + now.getMinutes() };
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
  // RFC 5545 .ics GENERATOR & GOOGLE CALENDAR LINKS
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

  function toIsoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function downloadIcsFile(content, filename) {
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 10000);
  }

  // ===========================================================================
  // MODULE CONTROLLER
  // ===========================================================================

  const REMINDER_PREF_KEY = 'vtop_tt_reminder_mins';

  const TimetableCalendar = {
    parseTimeTableFromRoot,
    generateIcsContent,
    _isFetching: false,
    _selectedDay: null,
    _liveTickTimer: null,
    _cachedData: null,
    _reminderMinutes: 10,
    _reminderPrefLoaded: false,

    async loadReminderPreference() {
      if (this._reminderPrefLoaded) return this._reminderMinutes;
      this._reminderPrefLoaded = true;
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!VtopApi?.storageGet) return this._reminderMinutes;
      try {
        const stored = await VtopApi.storageGet([REMINDER_PREF_KEY]);
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
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (VtopApi?.storageSet) {
        await VtopApi.storageSet({ [REMINDER_PREF_KEY]: normalized }).catch(() => {});
      }
      return normalized;
    },

    init() {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!VtopApi?.isAuthenticated()) {
        this.destroy();
        return;
      }
      this.loadReminderPreference();

      // 1. Timetable Page: auto-select true active semester & inject export toolbar
      if (document.getElementById('studentTimeTable')) {
        this.handleTimetablePage();
      }

      // 1b. Attendance Page: passively capture registered semesters list & reset dropdown after table loads
      if (document.getElementById('viewStudentAttendance')) {
        this.handleAttendancePage(VtopApi);
      }

      // 2. Home Dashboard: mount Today's Schedule widget at top of right column (col-md-4)
      const rightCol = this.findHomeRightColumn();
      if (rightCol) {
        this.mountHomeWidget(rightCol);
      } else {
        this.destroyHomeWidget();
      }
    },

    destroy() {
      this.destroyHomeWidget();
      document.getElementById(PAGE_BAR_ID)?.remove();
      document.getElementById(MODAL_ID)?.remove();
    },

    destroyHomeWidget() {
      if (this._liveTickTimer) {
        clearInterval(this._liveTickTimer);
        this._liveTickTimer = null;
      }
      document.getElementById(WIDGET_ID)?.remove();
    },

    findHomeRightColumn() {
      const anchor =
        document.getElementById('proctor-message')?.closest('.card') ||
        document.getElementById('edu-status')?.closest('.card');
      if (!anchor) return null;
      return anchor.closest('.col-md-4') || anchor.parentElement;
    },

    getCacheKey() {
      const authId = window.VTOP_PLUS?.DOM?.getAuthId ? window.VTOP_PLUS.DOM.getAuthId() : 'anon';
      return `vtop_timetable_cache_v1_${authId}`;
    },

    async readCache() {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!VtopApi) return null;
      const key = this.getCacheKey();
      const stored = await VtopApi.storageGet([key]);
      const data = stored?.[key];
      if (!data || !data.timetable) return null;

      // Invalidate if Home badge clearly indicates a different semester
      const badge = VtopApi.getHomeSemesterBadgeText();
      if (badge && data.badgeText && badge !== data.badgeText) return null;

      return data;
    },

    async writeCache(payload) {
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!VtopApi || !payload) return;
      this._cachedData = payload;
      await VtopApi.storageSet({ [this.getCacheKey()]: payload });
    },

    handleAttendancePage(VtopApi) {
      const semSelect = document.querySelector('#viewStudentAttendance #semesterSubId');
      if (!semSelect) return;

      const attOpts = VtopApi.extractSelectOptions(document, 'semesterSubId');
      if (attOpts.length > 0) {
        VtopApi.saveRegisteredSemesters(attOpts);
      }

      if (!semSelect.dataset.vtopAttChangeBound) {
        semSelect.dataset.vtopAttChangeBound = '1';
        semSelect.addEventListener('change', () => {
          const tbl = document.querySelector('#viewStudentAttendance ~ #loadMyFragment table, #loadMyFragment table');
          if (tbl) delete tbl.dataset.vtopAttResetDone;
        });
      }

      if (document.querySelector('.blockUI, .blockOverlay')) return;
      const attTable = document.querySelector('#AttendanceDetailDataTable, #loadMyFragment table');
      if (attTable && !attTable.dataset.vtopAttResetDone && semSelect.value !== '') {
        attTable.dataset.vtopAttResetDone = '1';
        window.VTOP_PLUS?.DOM?.resetSelectToDefault?.(semSelect);
      }
    },

    async handleTimetablePage() {
      const semSelect = document.getElementById('semesterSubId');
      const VtopApi = window.VTOP_PLUS?.VtopApi;
      if (!semSelect || !VtopApi) return;

      const options = Array.from(semSelect.options)
        .map((o) => ({ value: o.value.trim(), label: cleanText(o) }))
        .filter((o) => o.value);
      if (options.length > 0) {
        VtopApi.saveRegisteredSemesters(options);
      }

      if (!semSelect.dataset.vtopTtChangeBound) {
        semSelect.dataset.vtopTtChangeBound = '1';
        semSelect.addEventListener('change', () => {
          const existingGrid = document.getElementById('timeTableStyle');
          if (existingGrid) delete existingGrid.dataset.vtopTtCollected;
        });
      }

      // Auto-select active semester (resolved from StudentDA first option) once if empty
      if (semSelect.value === '' && !semSelect.dataset.vtopTtAutoSem) {
        semSelect.dataset.vtopTtAutoSem = '1';

        const active = await VtopApi.resolveActiveSemesterId();
        let targetOpt = active?.semesterSubId
          ? options.find((o) => o.value === active.semesterSubId)
          : null;

        if (!targetOpt) {
          const badge = VtopApi.getHomeSemesterBadgeText();
          targetOpt = VtopApi.matchOptionByBadge(options, badge) || options[0];
        }

        if (targetOpt) {
          const DOM = window.VTOP_PLUS?.DOM;
          if (DOM?.waitForBlockUIClear) {
            await DOM.waitForBlockUIClear();
          }
          if (!semSelect.isConnected || semSelect.value !== '') return;
          semSelect.value = targetOpt.value;
          semSelect.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }

      // If #timeTableStyle is currently rendered, parse, cache, inject toolbar, then reset dropdown
      if (document.querySelector('.blockUI, .blockOverlay')) return;
      const grid = document.getElementById('timeTableStyle');
      const fragment = document.getElementById('loadMyFragment');
      if (!grid || !fragment) return;

      const semId = (semSelect.value || semSelect.dataset.vtopLastSem || '').trim();
      const matchedOpt = options.find((o) => o.value === semId);
      const semLabel = matchedOpt?.label || semSelect.dataset.vtopLastSemLabel || '';

      if (!grid.dataset.vtopTtCollected) {
        const parsed = parseTimeTableFromRoot(document);
        if (!parsed) return;
        grid.dataset.vtopTtCollected = semId || '1';

        // Passively cache if it matches active semester (or if cache is empty)
        const active = await VtopApi.resolveActiveSemesterId().catch(() => null);
        if (!active || active.semesterSubId === semId) {
          await this.writeCache({
            semesterSubId: semId,
            semesterLabel: semLabel,
            badgeText: VtopApi.getHomeSemesterBadgeText(),
            updatedAt: Date.now(),
            timetable: parsed
          });
        }

        this.mountTimetablePageToolbar(fragment, parsed, semId, semLabel);
      }

      if (semSelect.value !== '') {
        window.VTOP_PLUS?.DOM?.resetSelectToDefault?.(semSelect);
      }
    },

    mountTimetablePageToolbar(fragment, parsed, semId, semLabel) {
      let bar = document.getElementById(PAGE_BAR_ID);
      if (bar && bar.dataset.semId === semId && fragment.contains(bar)) return;
      if (bar) bar.remove();

      bar = document.createElement('div');
      bar.id = PAGE_BAR_ID;
      bar.dataset.semId = semId;
      bar.className = 'vtop-plus-card vtop-tt-page-bar';
      bar.innerHTML = `
        <div class="vtop-tt-page-bar-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span><strong>${escapeHtml(semLabel || semId)}</strong> &middot; ${parsed.totalClasses} classes</span>
        </div>
        <div class="vtop-tt-page-bar-actions">
          <button type="button" class="vtop-tt-btn vtop-tt-btn-primary" data-tt-action="export-modal">
            Export .ics
          </button>
        </div>
      `;

      const exportBtn = bar.querySelector('[data-tt-action="export-modal"]');
      exportBtn?.addEventListener('click', () => {
        if (!parsed.totalClasses) {
          exportBtn.textContent = 'No classes found';
          setTimeout(() => { exportBtn.textContent = 'Export .ics'; }, 2000);
          return;
        }
        this.openExportModal(parsed, semId, semLabel);
      });

      fragment.insertAdjacentElement('afterbegin', bar);
    },

    mountHomeWidget(rightCol) {
      let card = document.getElementById(WIDGET_ID);
      const firstAnchor = rightCol.firstElementChild;

      if (card) {
        if (firstAnchor && firstAnchor !== card) {
          rightCol.insertAdjacentElement('afterbegin', card);
        }
        return;
      }

      card = document.createElement('div');
      card.id = WIDGET_ID;
      card.className = 'card border-0 mb-3 vtop-tt-widget';
      card.innerHTML = `
        <div class="card-header d-flex primaryBorderTop vtop-tt-header">
          <div class="vtop-tt-title-wrap">
            <span class="fs-6 fontcolor3 fw-bold vtop-tt-title">Today's Schedule</span>
          </div>
          <div class="vtop-tt-header-actions">
            <button type="button" class="vtop-msg-icon-btn" id="vtop-tt-export-btn" title="Export .ics / Google Calendar" aria-label="Export Timetable">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </button>
            <button type="button" class="vtop-msg-icon-btn" id="vtop-tt-refresh-btn" title="Refresh Timetable" aria-label="Refresh Timetable">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
            <button type="button" class="vtop-msg-icon-btn" id="vtop-tt-open-btn" title="Open Full Timetable" aria-label="Open Full Timetable">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="vtop-tt-days-bar" id="vtop-tt-days-bar"></div>
        <div class="card-body vtop-tt-body" id="vtop-tt-body">
          <div class="vtop-tt-state">Loading schedule...</div>
        </div>
      `;

      rightCol.insertAdjacentElement('afterbegin', card);

      card.querySelector('#vtop-tt-refresh-btn')?.addEventListener('click', () => {
        this.loadHomeSchedule(true);
      });
      card.querySelector('#vtop-tt-open-btn')?.addEventListener('click', () => {
        this.openFullTimetablePage();
      });
      card.querySelector('#vtop-tt-export-btn')?.addEventListener('click', () => {
        if (this._cachedData?.timetable) {
          this.openExportModal(
            this._cachedData.timetable,
            this._cachedData.semesterSubId,
            this._cachedData.semesterLabel
          );
        } else {
          this.openFullTimetablePage();
        }
      });

      this.loadHomeSchedule(false);

      if (this._liveTickTimer) clearInterval(this._liveTickTimer);
      this._liveTickTimer = setInterval(() => {
        if (document.getElementById(WIDGET_ID) && this._cachedData) {
          this.renderWidgetBody(this._cachedData);
        }
      }, 60000);
    },

    openFullTimetablePage() {
      const crawler = window.VTOP_PLUS?.Crawler;
      if (
        crawler?.navigate({
          dataUrl: 'academics/common/StudentTimeTable',
          fallbackDataUrls: ['academics/common/TimeTable', 'academics/common/StudentTimetable'],
          title: 'Class Time Table'
        })
      ) {
        return;
      }
      const link = document.querySelector('a[data-url*="StudentTimeTable" i]');
      if (link) link.click();
    },

    async loadHomeSchedule(forceRefresh = false) {
      if (this._isFetching) return;
      const widget = document.getElementById(WIDGET_ID);
      if (!widget) return;

      if (!forceRefresh) {
        const badge = window.VTOP_PLUS?.VtopApi?.getHomeSemesterBadgeText?.() || '';
        const mem = this._cachedData;
        if (
          mem &&
          mem.timetable &&
          (!badge || !mem.badgeText || mem.badgeText === badge) &&
          Date.now() - (mem.updatedAt || 0) < CACHE_TTL_MS
        ) {
          this.renderWidgetBody(mem);
          return;
        }
        const cached = await this.readCache();
        if (cached) {
          this._cachedData = cached;
          this.renderWidgetBody(cached);
          if (Date.now() - (cached.updatedAt || 0) < CACHE_TTL_MS) {
            return;
          }
        }
      }

      this._isFetching = true;
      const refreshBtn = document.getElementById('vtop-tt-refresh-btn');
      if (refreshBtn) refreshBtn.classList.add('vtop-msg-spinning');

      try {
        const VtopApi = window.VTOP_PLUS?.VtopApi;
        if (!VtopApi) return;

        // Step 1: Resolve authoritative current semester (from StudentDA first option)
        const active = await VtopApi.resolveActiveSemesterId({ forceRefresh });

        // Step 2: Fetch StudentTimeTable shell to extract dropdown + form CSRF
        const pageRes = await VtopApi.postHtml('academics/common/StudentTimeTable', {
          verifyMenu: 'true',
          nocache: `@(${new Date().toUTCString()})`
        });
        if (!pageRes.ok || !pageRes.html) {
          if (!this._cachedData) this.renderError('Could not load timetable.');
          return;
        }

        const pageDoc = new DOMParser().parseFromString(pageRes.html, 'text/html');
        const options = VtopApi.extractSelectOptions(pageDoc, 'semesterSubId');
        if (options.length > 0) {
          await VtopApi.saveRegisteredSemesters(options);
        }
        const formCsrf = pageDoc.querySelector('#studentTimeTable input[name="_csrf"]')?.value;
        const formAuthId = pageDoc.querySelector('#studentTimeTable #authorizedID')?.value;

        let targetOpt = active?.semesterSubId
          ? options.find((o) => o.value === active.semesterSubId)
          : null;
        if (!targetOpt) {
          targetOpt = VtopApi.matchOptionByBadge(options, VtopApi.getHomeSemesterBadgeText()) || options[0];
        }
        if (!targetOpt) {
          this.renderError('No registered semester found.');
          return;
        }

        // Step 3: Replay processViewTimeTable (relative to <base href="/vtop/">)
        const ttRes = await VtopApi.postHtml('processViewTimeTable', {
          _csrf: formCsrf,
          authorizedID: formAuthId,
          semesterSubId: targetOpt.value,
          x: new Date().toUTCString()
        });
        if (!ttRes.ok || !ttRes.html) {
          if (!this._cachedData) this.renderError('Timetable unavailable.');
          return;
        }

        const ttDoc = new DOMParser().parseFromString(ttRes.html, 'text/html');
        const parsed = parseTimeTableFromRoot(ttDoc);
        if (!parsed) {
          if (!this._cachedData) this.renderError('No classes scheduled.');
          return;
        }

        const payload = {
          semesterSubId: targetOpt.value,
          semesterLabel: targetOpt.label,
          badgeText: VtopApi.getHomeSemesterBadgeText(),
          updatedAt: Date.now(),
          timetable: parsed
        };
        await this.writeCache(payload);
        this.renderWidgetBody(payload);
      } catch (err) {
        console.warn('[VTOP++] Timetable fetch error:', err);
        if (!this._cachedData) this.renderError('Failed to fetch schedule.');
      } finally {
        this._isFetching = false;
        document.getElementById('vtop-tt-refresh-btn')?.classList.remove('vtop-msg-spinning');
      }
    },

    renderError(msg) {
      const body = document.getElementById('vtop-tt-body');
      if (body) {
        body.innerHTML = `<div class="vtop-tt-state">${escapeHtml(msg)}</div>`;
      }
    },

    renderWidgetBody(payload) {
      const widget = document.getElementById(WIDGET_ID);
      if (!widget) return;

      const { dayKey: todayKey, mins: nowMins } = getIstNowParts();
      if (!this._selectedDay) {
        const hasToday = (payload.timetable.mergedSlotsByDay[todayKey] || []).length > 0;
        this._selectedDay = hasToday ? todayKey : 'MON';
      }

      const activeDay = this._selectedDay;
      const classes = payload.timetable.mergedSlotsByDay[activeDay] || [];

      // Render weekday tabs (MON-SAT, plus SUN only if classes exist)
      const daysBar = document.getElementById('vtop-tt-days-bar');
      if (daysBar) {
        const visibleDays = DAY_ORDER.filter(
          (d) => d !== 'SUN' || (payload.timetable.mergedSlotsByDay.SUN || []).length > 0
        );
        daysBar.innerHTML = visibleDays
          .map((d) => {
            const isToday = d === todayKey;
            const isActive = d === activeDay;
            return `
              <button type="button" class="vtop-tt-day-tab ${isActive ? 'is-active' : ''} ${isToday ? 'is-today' : ''}" data-tt-day="${d}">
                <span>${DAY_SHORT[d]}</span>
              </button>
            `;
          })
          .join('');

        daysBar.querySelectorAll('.vtop-tt-day-tab').forEach((btn) => {
          btn.addEventListener('click', () => {
            this._selectedDay = btn.dataset.ttDay;
            this.renderWidgetBody(payload);
          });
        });
      }

      const body = document.getElementById('vtop-tt-body');
      if (!body) return;

      if (classes.length === 0) {
        body.innerHTML = `
          <div class="vtop-dashboard-empty vtop-tt-empty">
            <div class="vtop-dashboard-empty-title">No classes on ${DAY_SHORT[activeDay]}</div>
          </div>
        `;
        return;
      }

      let nextMarked = false;
      const listHtml = classes
        .map((item, idx) => {
          let stateCls = '';
          let statusPill = '';

          if (activeDay === todayKey) {
            if (nowMins >= item.startMin && nowMins < item.endMin) {
              const rem = item.endMin - nowMins;
              stateCls = 'is-live';
              statusPill = `<span class="vtop-tt-status vtop-tt-status-live">Now &middot; ${rem}m left</span>`;
            } else if (nowMins >= item.endMin) {
              stateCls = 'is-done';
              statusPill = `<span class="vtop-tt-status vtop-tt-status-done">Done</span>`;
            } else if (!nextMarked) {
              nextMarked = true;
              const wait = item.startMin - nowMins;
              const waitLabel = wait >= 60 ? `In ${Math.floor(wait / 60)}h ${wait % 60}m` : `In ${wait}m`;
              stateCls = 'is-next';
              statusPill = `<span class="vtop-tt-status vtop-tt-status-next">${waitLabel}</span>`;
            }
          }

          return `
            <div class="vtop-tt-item ${stateCls}" data-tt-idx="${idx}">
              <div class="vtop-tt-info">
                <div class="vtop-tt-course-row">
                  <span class="vtop-tt-code">${escapeHtml(item.title || item.code)}</span>
                  <span class="vtop-tt-type">${escapeHtml(item.type)}</span>
                </div>
                <div class="vtop-tt-meta">
                  ${item.venue ? `<span class="vtop-tt-venue">${escapeHtml(item.venue)}</span>` : ''}
                  ${item.slot ? `<span class="vtop-tt-slot">${escapeHtml(item.slot)}</span>` : ''}
                </div>
              </div>
              <div class="vtop-tt-right">
                <span class="vtop-tt-time-range">${formatMinutes24(item.startMin)} - ${formatMinutes24(item.endMin)}</span>
                ${statusPill}
              </div>
            </div>
          `;
        })
        .join('');

      body.innerHTML = `<div class="vtop-tt-list">${listHtml}</div>`;
    },

    async openExportModal(timetable, semId, semLabel) {
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

        downloadIcsFile(ics, `VTOP_${sanitizeUidPart(semId || 'Timetable')}.ics`);
        if (openGcal) {
          window.open('https://calendar.google.com/calendar/u/0/r/settings/export', '_blank', 'noopener');
        }
        close();
      };

      overlay.querySelector('#vtop-tt-download-only')?.addEventListener('click', () => runDownload(false));
      overlay.querySelector('#vtop-tt-gcal-sync')?.addEventListener('click', () => runDownload(true));
    }
  };

  window.VTOP_PLUS.TimetableCalendar = TimetableCalendar;
})();
