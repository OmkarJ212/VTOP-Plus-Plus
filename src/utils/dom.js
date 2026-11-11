/**
 * VTOP++ - DOM Utilities
 * High-performance helpers for DOM manipulation, observation, and table parsing.
 */

(function () {
  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const DOM = {
    /**
     * Safely triggers native click on an element with 0ms dispatch latency
     */
    simulateNativeClick(element) {
      if (!element) return false;

      // Direct native click dispatch (0ms latency, zero scroll delay, preserves CSRF tokens)
      if (typeof element.click === 'function') {
        try {
          element.click();
          return true;
        } catch (e) {
          console.warn('[VTOP++] element.click() fallback:', e);
        }
      }

      // Synthetic click event fallback
      const evt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      element.dispatchEvent(evt);
      return true;
    },

    /**
     * Check if currently on a specific VTOP view by page URL, form, or table presence
     */
    detectPageType() {
      const href = window.location.href.toLowerCase();

      if (document.querySelector('#loginForm, #vtopLogin, #authLoginBtn, input[name="username"], input[type="password"]')) {
        return 'LOGIN';
      }

      if (document.querySelector('button[data-fileid], .download-btn[data-fileid], #materialTable') || href.includes('coursematerial')) {
        return 'COURSE_PAGE';
      }

      if (document.querySelector('#attendanceDetail, table[id*="attendance" i]') || href.includes('attendance')) {
        return 'ATTENDANCE';
      }

      if (document.querySelector('#studentMarks, #marksView, table[id*="marks" i], .vtop-fat-inline-tfoot') || href.includes('marks')) {
        return 'MARKS';
      }

      if (
        document.querySelector(
          '#digitalAssignment, #daUpload, #studDaUpload, form[action*="DigitalAssignment"], button[name="downloadQuestion"], button[name="downloadStudentDA"], button .bi-folder-symlink-fill, [onclick*="myFunction"], [onclick*="processDigitalAssignment"]'
        ) ||
        href.includes('assignment') ||
        document.querySelector('.card-header h3, h3, h2, .card-title, .page-head')?.textContent?.toLowerCase().includes('assignment upload')
      ) {
        return 'DIGITAL_ASSIGNMENT';
      }

      return 'GENERAL';
    }
  };

  window.VTOP_PLUS.DOM = DOM;
})();
