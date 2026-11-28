/**
 * VTOP++ - Menu Crawler & Deep Link Indexer
 * Specifically calibrated for VIT Vellore VTOP (vtop.vit.ac.in).
 * Indexes all routes across top-hmenu-bar, data-urls, drawers, and quickLinks.
 * Provides instant 0ms memory lookup for Search Pages (Ctrl+K) and Quick Dock.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  // Authoritative Core VTOP Pages
  const CORE_PAGES = [
    {
      id: 'course-page',
      title: 'Course Page',
      category: 'Academics',
      dataUrl: 'academics/common/StudentCoursePage',
      fallbackDataUrls: [
        'academics/common/CoursePage',
        'academics/common/CoursePageConsolidated',
        'academics/common/StudentCoursePageConsolidated',
        'academics/common/CoursePageConsolidatedView'
      ],
      patterns: [/course\s*page(?:\s*consolidated)?/i, /consolidated\s*course\s*page/i, /course\s*material/i],
      synonyms: ['course', 'cp', 'course page', 'materials', 'slides', 'notes', 'syllabus', 'modules', 'faculty', 'download']
    },
    {
      id: 'marks-grades',
      title: 'Student Mark View',
      category: 'Examinations',
      dataUrl: 'examinations/StudentMarkView',
      fallbackDataUrls: ['examinations/StudentMarks'],
      patterns: [/^student\s*mark(?:\s*view)?$/i, /^marks$/i, /^mark\s*view$/i, /^marks\s*&\s*grades$/i],
      synonyms: ['marks', 'cat', 'fat', 'grades', 'score', 'results', 'mark', 'internals', 'assessment']
    },
    {
      id: 'attendance',
      title: 'Class Attendance',
      category: 'Academics',
      dataUrl: 'academics/common/StudentAttendance',
      fallbackDataUrls: ['academics/common/Attendance', 'academics/common/StudentAttendanceDetail'],
      patterns: [/class\s*attendance/i, /^attendance$/i, /student\s*attendance/i],
      synonyms: ['attendance', 'bunk', 'absent', 'present', 'percentage', 'classes', 'att']
    },
    {
      id: 'timetable',
      title: 'Class Time Table',
      category: 'Academics',
      dataUrl: 'academics/common/StudentTimeTable',
      fallbackDataUrls: ['academics/common/TimeTable', 'academics/common/StudentTimetable'],
      patterns: [/time\s*table/i, /class\s*time\s*table/i, /student\s*time\s*table/i],
      synonyms: ['timetable', 'time table', 'tt', 'schedule', 'routine', 'slots', 'classes']
    },
    {
      id: 'digital-assignments',
      title: 'Digital Assignment Upload',
      category: 'Examinations',
      dataUrl: 'examinations/StudentDA',
      fallbackDataUrls: ['examinations/StudentDAUpload', 'examinations/DigitalAssignment'],
      patterns: [/digital\s*assignment/i, /assignment\s*upload/i, /^da$/i],
      synonyms: ['da', 'digital assignment', 'assignment', 'upload', 'homework', 'submission', 'deadlines']
    },
    {
      id: 'grade-history',
      title: 'Student Grade History',
      category: 'Examinations',
      dataUrl: 'examinations/examGradeView/StudentGradeHistory',
      fallbackDataUrls: ['examinations/StudentGradeHistory', 'examinations/GradeHistory'],
      patterns: [/grade\s*history/i, /exam\s*grade/i],
      synonyms: ['grades', 'grade history', 'gpa', 'cgpa', 'history', 'transcript', 'credits', 'results']
    },
    {
      id: 'exam-schedule',
      title: 'Exam Schedule',
      category: 'Examinations',
      dataUrl: 'examinations/ExamSchedule',
      fallbackDataUrls: ['examinations/StudExamSchedule', 'examinations/StudentExamSchedule'],
      patterns: [/^(?:student\s*)?exam(?:ination)?\s*schedule$/i],
      synonyms: ['exam', 'cat', 'fat', 'schedule', 'dates', 'timings', 'hall ticket', 'seating']
    },
    {
      id: 'hostel-leave',
      title: 'Hostel Leave Application',
      category: 'Hostels',
      dataUrl: 'hostels/StudentLeave',
      fallbackDataUrls: ['hostels/student/leave/1', 'hostels/LeaveApplication', 'hostels/StudentLeaveApply'],
      patterns: [/^hostel\s*leave$/i, /^leave\s*application$/i, /^leave(?:\s*request)?$/i],
      synonyms: ['leave', 'hostel', 'outing', 'home', 'permission', 'night out', 'vacation', 'pass']
    },
    {
      id: 'curriculum',
      title: 'Curriculum & Credit Distribution',
      category: 'Academics',
      dataUrl: 'academics/common/Curriculum',
      fallbackDataUrls: ['academics/common/StudentCurriculum'],
      patterns: [/^(?:my\s*)?curriculum$/i, /curriculum\s*&\s*credit/i],
      synonyms: ['curriculum', 'basket', 'credits', 'degree', 'audit', 'syllabus', 'courses']
    },
    {
      id: 'faculty-advisor',
      title: 'Faculty Advisor & Proctor Details',
      category: 'Academics',
      dataUrl: 'academics/common/FacultyAdvisor',
      fallbackDataUrls: ['proctor/viewProctorDetails', 'academics/common/StudentFacultyAdvisor', 'academics/common/ProctorDetails'],
      patterns: [/^faculty\s*advisor$/i, /^proctor\s*details$/i],
      synonyms: ['faculty', 'teacher', 'prof', 'professor', 'cabin', 'proctor', 'mentor', 'advisor']
    },
    {
      id: 'academic-calendar',
      title: 'Academic Calendar',
      category: 'Academics',
      dataUrl: 'academics/common/AcademicCalendar',
      fallbackDataUrls: ['academics/common/CalendarPreview', 'academics/common/Calendar'],
      patterns: [/^academics?\s*calendar$/i, /^calendar$/i],
      synonyms: ['calendar', 'holidays', 'academic calendar', 'schedule', 'semester dates']
    },
    {
      id: 'biometric-log',
      title: 'Biometric Log',
      category: 'Hostels',
      dataUrl: 'hostels/BiometricLog',
      fallbackDataUrls: ['academics/common/BiometricInfo', 'hostels/StudentBiometricLog'],
      patterns: [/^biometric(?:\s*(?:info|log))?$/i, /^in\s*out\s*log$/i],
      synonyms: ['biometric', 'punch', 'in out', 'timing', 'gate']
    }
  ];

  // Quick Dock subset definitions (the 5 primary shortcut pills)
  const QUICK_DOCK_IDS = ['course-page', 'attendance', 'timetable', 'digital-assignments', 'marks-grades'];

  // Synonym mappings for dynamic items
  const COMMON_SYNONYMS = {
    attendance: ['bunk', 'absent', 'present', 'percentage', 'classes', 'att'],
    timetable: ['tt', 'schedule', 'routine', 'slots', 'classes', 'routine'],
    'course page': ['cp', 'materials', 'slides', 'notes', 'syllabus', 'modules'],
    'digital assignment': ['da', 'assignment', 'upload', 'homework', 'submission'],
    mark: ['marks', 'grade', 'grades', 'gpa', 'cgpa', 'cat', 'fat', 'results', 'score'],
    curriculum: ['basket', 'credits', 'degree', 'syllabus'],
    faculty: ['teacher', 'prof', 'professor', 'cabin', 'cabin details'],
    proctor: ['mentor', 'advisor'],
    hostel: ['room', 'mess', 'leave', 'outing', 'warden'],
    biometric: ['punch', 'in out', 'timing'],
    exam: ['fat', 'cat', 'seating', 'hall ticket', 'schedule'],
    registration: ['ffcs', 'add drop', 'wishlist', 'course registration'],
    mooc: ['nptel', 'coursera', 'online courses'],
    pat: ['placement', 'cdc', 'internship', 'jobs', 'recruitment'],
    calendar: ['holidays', 'academic calendar', 'schedule'],
    profile: ['student profile', 'personal', 'details', 'info', 'address'],
    project: ['pjt', 'capstone', 'multidisciplinary', 'internship']
  };

  function buildLinkCategoryMap() {
    const map = new WeakMap();
    const megaBoxes = document.querySelectorAll('div[id^="MG0"]');
    for (const mg of megaBoxes) {
      const topEl = mg.querySelector('.fw-bold.h5, h5');
      const topCat = topEl ? topEl.textContent.replace(/\s+/g, ' ').trim() : '';
      let subCat = '';
      const nodes = mg.querySelectorAll('.card-title, a[data-url], button[data-url], .systemB5BtnMenu, .systemBtnMenu');
      for (const node of nodes) {
        if (node.classList.contains('card-title')) {
          subCat = node.textContent.replace(/\s+/g, ' ').trim();
          continue;
        }
        const label =
          topCat && subCat && subCat.toLowerCase() !== 'general' && subCat.toLowerCase() !== topCat.toLowerCase()
            ? `${topCat} · ${subCat}`
            : topCat || subCat || 'Academics';
        map.set(node, label);
      }
    }
    return map;
  }

  function extractAcronym(str) {
    return str
      .split(/[\s\-_/]+/)
      .filter(Boolean)
      .map((w) => w[0].toLowerCase())
      .join('');
  }

  function findSynonyms(titleLower, urlLower) {
    const matched = [];
    const combined = `${titleLower} ${urlLower}`;
    for (const [key, synonyms] of Object.entries(COMMON_SYNONYMS)) {
      if (combined.includes(key)) {
        matched.push(...synonyms);
      }
    }
    return matched;
  }

  function enrichItemMetadata(rawItem) {
    const lowerTitle = rawItem.title.toLowerCase();
    const lowerCat = (rawItem.category || 'VTOP').toLowerCase();
    const lowerUrl = (rawItem.dataUrl || '').toLowerCase();
    const acronym = extractAcronym(rawItem.title);
    const words = lowerTitle.split(/[\s\-_/]+/).filter(Boolean);
    const extraSynonyms = findSynonyms(lowerTitle, lowerUrl);
    const synonyms = Array.from(new Set([...(rawItem.synonyms || []), ...extraSynonyms]));

    return {
      ...rawItem,
      lowerTitle,
      lowerCat,
      acronym,
      words,
      synonyms
    };
  }

  class MenuCrawler {
    constructor() {
      this.indexedItems = [];
      this.quickDockMap = new Map();
      this.lastScanned = 0;
      this._initializeCorePages();
    }

    _initializeCorePages() {
      this.indexedItems = CORE_PAGES.map((p) => enrichItemMetadata({ ...p, element: null }));
      this._resolveQuickDockTargets();
    }

    /**
     * Scan the DOM for active navigation links and resolve them
     */
    scan(force = false) {
      if (!force && this.indexedItems.length > 0 && Date.now() - this.lastScanned < 1500) {
        return this.indexedItems;
      }

      const links = Array.from(
        document.querySelectorAll(
          'a[data-url], button[data-url], .systemB5BtnMenu, .systemBtnMenu, #top-hmenu-bar a, #quickLinks a, nav a, .sidebar-menu a, .nav a, div[id^="MG0"] a'
        )
      );
      const linkCategoryMap = buildLinkCategoryMap();

      // Build core lookup maps (cloned per scan so state never leaks across rescans)
      const coreItems = [];
      const coreByUrl = new Map();
      for (const core of CORE_PAGES) {
        const enriched = enrichItemMetadata({ ...core, element: null });
        coreItems.push(enriched);
        coreByUrl.set(core.dataUrl.toLowerCase(), enriched);
        if (Array.isArray(core.fallbackDataUrls)) {
          for (const fallback of core.fallbackDataUrls) {
            coreByUrl.set(fallback.toLowerCase(), enriched);
          }
        }
      }

      // Filter valid navigation links up front
      const candidates = [];
      for (const link of links) {
        const rawText = (link.textContent || '').replace(/\s+/g, ' ').trim();
        const dataUrl = (link.getAttribute('data-url') || '').trim();
        const href = (link.getAttribute('href') || '').trim();

        // Strict filtering against junk/branding/collapse buttons
        if (!rawText || rawText.length < 3 || rawText.length > 70) continue;
        if (/^(vit|vtop|home|dashboard|logout|sign out|menu|navigation)$/i.test(rawText)) continue;
        if (/logout|sign out/i.test(rawText)) continue;
        if (link.getAttribute('data-bs-toggle') === 'collapse' || link.getAttribute('data-toggle') === 'collapse') continue;
        if (href && href.startsWith('#MG')) continue;
        if (!dataUrl && (!href || href === '#' || href === 'javascript:void(0);') && !link.getAttribute('onclick')) continue;

        candidates.push({ link, rawText, dataUrl, href, consumed: false });
      }

      const bindCore = (coreItem, c) => {
        coreItem.element = c.link;
        if (c.dataUrl) coreItem.dataUrl = c.dataUrl;
        if (c.rawText && c.rawText.length >= 3) coreItem.title = c.rawText;
        Object.assign(coreItem, enrichItemMetadata(coreItem));
        c.consumed = true;
      };

      // Pass 1: Bind exact data-url matches first so unrelated menus (e.g. Project Mark View) never hijack core entries
      for (const c of candidates) {
        if (!c.dataUrl) continue;
        const matchedCore = coreByUrl.get(c.dataUrl.toLowerCase());
        if (!matchedCore) continue;
        if (!matchedCore.element || c.link.closest('div[id^="MG0"]')) {
          bindCore(matchedCore, c);
        } else {
          c.consumed = true;
        }
      }

      // Pass 2: Pattern fallback ONLY for core entries still unbound after Pass 1
      for (const c of candidates) {
        if (c.consumed) continue;
        for (const coreItem of coreItems) {
          if (coreItem.element) continue;
          if (coreItem.patterns && coreItem.patterns.some((p) => p.test(c.rawText))) {
            bindCore(coreItem, c);
            break;
          }
        }
      }

      // Pass 3: Index all remaining links as distinct dynamic pages (never overwrite or drop)
      const itemsMap = new Map();
      for (const coreItem of coreItems) {
        itemsMap.set((coreItem.dataUrl || coreItem.id).toLowerCase(), coreItem);
      }

      for (const c of candidates) {
        if (c.consumed) continue;
        const { link, rawText, dataUrl, href } = c;

        let category = linkCategoryMap.get(link) || '';
        if (!category) {
          const collapseParent = link.closest('.hmenubox, .collapse, .card, .dropdown-menu, div[id^="MG0"]');
          if (collapseParent) {
            const header = collapseParent.querySelector('.fw-bold.h5, h4, .dropdown-header, .panel-title, .card-title');
            if (header && header.textContent) {
              category = header.textContent.replace(/\s+/g, ' ').trim();
            }
          }
        }
        if (!category) category = 'Academics';

        const dedupeKey = (dataUrl || rawText).toLowerCase();
        if (!itemsMap.has(dedupeKey)) {
          const newItem = enrichItemMetadata({
            id: `dyn-${dedupeKey.replace(/[^a-z0-9]/g, '-')}`,
            title: rawText,
            category,
            dataUrl,
            element: link,
            href: href !== '#' && href !== 'javascript:void(0);' ? href : null
          });
          itemsMap.set(dedupeKey, newItem);
        }
      }

      this.indexedItems = Array.from(itemsMap.values());
      this.lastScanned = Date.now();
      this._resolveQuickDockTargets();
      return this.indexedItems;
    }

    _resolveQuickDockTargets() {
      this.quickDockMap.clear();

      for (const id of QUICK_DOCK_IDS) {
        const item = this.indexedItems.find((i) => i.id === id);
        if (item) {
          // If element not bound yet, check DOM directly across primary and fallback URLs
          if (!item.element) {
            const urlsToTry = [item.dataUrl, ...(item.fallbackDataUrls || [])].filter(Boolean);
            for (const u of urlsToTry) {
              const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(u) : u.replace(/["\\]/g, '\\$&');
              const el = document.querySelector(`a[data-url="${esc}"], button[data-url="${esc}"], [data-url*="${esc}"]`);
              if (el) {
                item.element = el;
                item.dataUrl = el.getAttribute('data-url') || u;
                break;
              }
            }
          }

          this.quickDockMap.set(id, {
            id: item.id,
            title: item.title,
            dataUrl: item.dataUrl,
            targetItem: item,
            isFound: Boolean(item.element || item.dataUrl)
          });
        }
      }
    }

    getQuickDockItems() {
      if (this.quickDockMap.size === 0) {
        this.scan();
      }
      return Array.from(this.quickDockMap.values());
    }

    getAllItems() {
      if (this.indexedItems.length === 0) {
        this.scan();
      }
      return this.indexedItems;
    }

    navigate(item) {
      if (!item) return false;

      // Ensure any open mega-menu drawer is closed so the screen is clear and unobstructed
      try {
        window.VTOP_PLUS?.MenuDrawer?.closeAllDrawers();
      } catch (_) {}

      // 1. If element is already bound and still in document, click it
      if (item.element && document.body.contains(item.element)) {
        const DOM = window.VTOP_PLUS?.DOM;
        if (DOM && typeof DOM.simulateNativeClick === 'function') {
          return DOM.simulateNativeClick(item.element);
        }
        item.element.click();
        return true;
      }

      // 2. Query document directly across primary and fallback data-urls
      const urlsToTry = [item.dataUrl, ...(item.fallbackDataUrls || [])].filter(Boolean);
      for (const u of urlsToTry) {
        const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(u) : u.replace(/["\\]/g, '\\$&');
        const found = document.querySelector(
          `a[data-url="${esc}"], button[data-url="${esc}"], [data-url*="${esc}"]`
        );
        if (found) {
          item.element = found;
          item.dataUrl = found.getAttribute('data-url') || u;
          const DOM = window.VTOP_PLUS?.DOM;
          if (DOM && typeof DOM.simulateNativeClick === 'function') {
            return DOM.simulateNativeClick(found);
          }
          found.click();
          return true;
        }
      }

      // 3. Query document by text content
      if (item.title || item.patterns) {
        const links = Array.from(document.querySelectorAll('a, button, [role="button"], .systemB5BtnMenu, .dropdown-item'));
        const matched = links.find((el) => {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          return (item.title && t === item.title.toLowerCase()) || (item.patterns && item.patterns.some((p) => p.test(t)));
        });
        if (matched) {
          item.element = matched;
          const dUrl = matched.getAttribute('data-url');
          if (dUrl) item.dataUrl = dUrl;
          const DOM = window.VTOP_PLUS?.DOM;
          if (DOM && typeof DOM.simulateNativeClick === 'function') {
            return DOM.simulateNativeClick(matched);
          }
          matched.click();
          return true;
        }
      }

      return false;
    }
  }

  window.VTOP_PLUS.Crawler = new MenuCrawler();
})();