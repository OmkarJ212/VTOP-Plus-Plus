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
      icon: '📚',
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
      icon: '🎯',
      dataUrl: 'examinations/StudentMarkView',
      fallbackDataUrls: ['examinations/examGradeView/StudentGradeHistory', 'examinations/StudentMarks'],
      patterns: [/student\s*mark/i, /^marks$/i, /mark\s*view/i, /marks\s*&\s*grades/i],
      synonyms: ['marks', 'cat', 'fat', 'grades', 'score', 'results', 'mark', 'internals', 'assessment']
    },
    {
      id: 'attendance',
      title: 'Class Attendance',
      category: 'Academics',
      icon: '📊',
      dataUrl: 'academics/common/StudentAttendance',
      fallbackDataUrls: ['academics/common/Attendance', 'academics/common/StudentAttendanceDetail'],
      patterns: [/class\s*attendance/i, /^attendance$/i, /student\s*attendance/i],
      synonyms: ['attendance', 'bunk', 'absent', 'present', 'percentage', 'classes', 'att']
    },
    {
      id: 'timetable',
      title: 'Class Time Table',
      category: 'Academics',
      icon: '📅',
      dataUrl: 'academics/common/StudentTimeTable',
      fallbackDataUrls: ['academics/common/TimeTable', 'academics/common/StudentTimetable'],
      patterns: [/time\s*table/i, /class\s*time\s*table/i, /student\s*time\s*table/i],
      synonyms: ['timetable', 'time table', 'tt', 'schedule', 'routine', 'slots', 'classes']
    },
    {
      id: 'digital-assignments',
      title: 'Digital Assignment Upload',
      category: 'Examinations',
      icon: '📝',
      dataUrl: 'examinations/StudentDA',
      fallbackDataUrls: ['examinations/StudentDAUpload', 'examinations/DigitalAssignment'],
      patterns: [/digital\s*assignment/i, /assignment\s*upload/i, /^da$/i],
      synonyms: ['da', 'digital assignment', 'assignment', 'upload', 'homework', 'submission', 'deadlines']
    },
    {
      id: 'grade-history',
      title: 'Student Grade History',
      category: 'Examinations',
      icon: '📜',
      dataUrl: 'examinations/examGradeView/StudentGradeHistory',
      fallbackDataUrls: ['examinations/StudentGradeHistory', 'examinations/GradeHistory'],
      patterns: [/grade\s*history/i, /exam\s*grade/i],
      synonyms: ['grades', 'grade history', 'gpa', 'cgpa', 'history', 'transcript', 'credits', 'results']
    },
    {
      id: 'exam-schedule',
      title: 'Exam Schedule',
      category: 'Examinations',
      icon: '⏱️',
      dataUrl: 'examinations/ExamSchedule',
      fallbackDataUrls: ['examinations/StudentExamSchedule'],
      patterns: [/exam\s*schedule/i, /examination\s*schedule/i],
      synonyms: ['exam', 'cat', 'fat', 'schedule', 'dates', 'timings', 'hall ticket', 'seating']
    },
    {
      id: 'hostel-leave',
      title: 'Hostel Leave Application',
      category: 'Hostels',
      icon: '🏖️',
      dataUrl: 'hostels/StudentLeave',
      fallbackDataUrls: ['hostels/LeaveApplication', 'hostels/StudentLeaveApply'],
      patterns: [/hostel\s*leave/i, /leave\s*application/i, /^leave$/i],
      synonyms: ['leave', 'hostel', 'outing', 'home', 'permission', 'night out', 'vacation', 'pass']
    },
    {
      id: 'curriculum',
      title: 'Curriculum & Credit Distribution',
      category: 'Academics',
      icon: '📋',
      dataUrl: 'academics/common/Curriculum',
      fallbackDataUrls: ['academics/common/StudentCurriculum'],
      patterns: [/curriculum/i, /credits/i],
      synonyms: ['curriculum', 'basket', 'credits', 'degree', 'audit', 'syllabus', 'courses']
    },
    {
      id: 'faculty-advisor',
      title: 'Faculty Advisor & Proctor Details',
      category: 'Academics',
      icon: '👨‍🏫',
      dataUrl: 'academics/common/FacultyAdvisor',
      fallbackDataUrls: ['academics/common/StudentFacultyAdvisor', 'academics/common/ProctorDetails'],
      patterns: [/faculty\s*advisor/i, /proctor/i],
      synonyms: ['faculty', 'teacher', 'prof', 'professor', 'cabin', 'proctor', 'mentor', 'advisor']
    },
    {
      id: 'academic-calendar',
      title: 'Academic Calendar',
      category: 'Academics',
      icon: '🗓️',
      dataUrl: 'academics/common/AcademicCalendar',
      fallbackDataUrls: ['academics/common/Calendar'],
      patterns: [/academic\s*calendar/i, /calendar/i],
      synonyms: ['calendar', 'holidays', 'academic calendar', 'schedule', 'semester dates']
    },
    {
      id: 'biometric-log',
      title: 'Biometric Log',
      category: 'Hostels',
      icon: '👆',
      dataUrl: 'hostels/BiometricLog',
      fallbackDataUrls: ['hostels/StudentBiometricLog'],
      patterns: [/biometric/i, /in\s*out\s*log/i],
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
    calendar: ['holidays', 'academic calendar', 'schedule']
  };

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
      lowerUrl,
      acronym,
      words,
      synonyms,
      searchTokens: `${lowerTitle} ${lowerCat} ${acronym} ${synonyms.join(' ')} ${lowerUrl}`
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

      // Start with our core catalog - register primary and all fallback URLs
      const itemsMap = new Map();
      for (const core of CORE_PAGES) {
        const enriched = enrichItemMetadata({ ...core, element: null });
        itemsMap.set(core.dataUrl.toLowerCase(), enriched);
        if (Array.isArray(core.fallbackDataUrls)) {
          for (const fallback of core.fallbackDataUrls) {
            itemsMap.set(fallback.toLowerCase(), enriched);
          }
        }
      }

      for (const link of links) {
        const rawText = (link.textContent || '').replace(/\s+/g, ' ').trim();
        const dataUrl = (link.getAttribute('data-url') || '').trim();
        const href = (link.getAttribute('href') || '').trim();

        // Strict filtering against junk/branding/collapse buttons
        if (!rawText || rawText.length < 3 || rawText.length > 70) continue;
        if (/^(vit|vtop|home|dashboard|logout|sign out|change password|profile|my profile|menu|navigation)$/i.test(rawText)) continue;
        if (/logout|sign out|change password/i.test(rawText)) continue;
        if (link.getAttribute('data-bs-toggle') === 'collapse' || link.getAttribute('data-toggle') === 'collapse') continue;
        if (href && href.startsWith('#MG')) continue;
        if (!dataUrl && (!href || href === '#' || href === 'javascript:void(0);') && !link.getAttribute('onclick')) continue;

        // Check if this matches any of our core pages
        let matchedCore = null;
        if (dataUrl) {
          matchedCore = itemsMap.get(dataUrl.toLowerCase());
        }
        if (!matchedCore) {
          for (const item of itemsMap.values()) {
            if (item.patterns && item.patterns.some((p) => p.test(rawText))) {
              matchedCore = item;
              break;
            }
          }
        }

        if (matchedCore) {
          matchedCore.element = link;
          // Crucial fix: preserve the authentic, working data-url and title from the active DOM!
          if (dataUrl) {
            matchedCore.dataUrl = dataUrl;
          }
          if (rawText && rawText.length >= 3) {
            matchedCore.title = rawText;
          }
          continue;
        }

        // New page discovered from VTOP menus
        let category = 'Academics';
        const collapseParent = link.closest('.hmenubox, .collapse, .card, .dropdown-menu, div[id^="MG0"]');
        if (collapseParent) {
          const header = collapseParent.querySelector('.fw-bold.h5, h4, .card-title, .dropdown-header, .panel-title');
          if (header && header.textContent) {
            category = header.textContent.trim();
          }
        }

        const dedupeKey = (dataUrl || rawText).toLowerCase();
        if (!itemsMap.has(dedupeKey)) {
          const newItem = enrichItemMetadata({
            id: `dyn-${dedupeKey.replace(/[^a-z0-9]/g, '-')}`,
            title: rawText,
            category,
            dataUrl,
            element: link,
            href: href !== '#' && href !== 'javascript:void(0);' ? href : null,
            icon: category.includes('Exam') ? '📝' : category.includes('Hostel') ? '🏖️' : '📄'
          });
          itemsMap.set(dedupeKey, newItem);
        }
      }

      this.indexedItems = Array.from(new Set(itemsMap.values()));
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
              const el = document.querySelector(`a[data-url="${u}"], button[data-url="${u}"], [data-url*="${u}"]`);
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
            icon: item.icon,
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
        const found = document.querySelector(
          `a[data-url="${u}"], button[data-url="${u}"], [data-url*="${u}"]`
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