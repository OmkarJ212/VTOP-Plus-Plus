/**
 * VTOP++ - Marks Summary & Potential CGPA Calculator Facade
 * Composes MarksSummary and CgpaCalculator under window.VTOP_PLUS.MarksFatPredictor
 * for seamless compatibility with content.js and MarksNotifier.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const MarksFatPredictor = {
    init() {
      window.VTOP_PLUS?.CgpaCalculator?.captureGradeHistory?.();
      window.VTOP_PLUS?.CgpaCalculator?.checkAndMountCgpaCalculator?.();
      window.VTOP_PLUS?.MarksSummary?.checkAndSummarizeMarks?.();
    },

    destroy() {
      window.VTOP_PLUS?.CgpaCalculator?.destroy?.();
      window.VTOP_PLUS?.MarksSummary?.destroy?.();
    },

    checkAndMountCgpaCalculator() {
      return window.VTOP_PLUS?.CgpaCalculator?.checkAndMountCgpaCalculator?.();
    },

    checkAndSummarizeMarks() {
      return window.VTOP_PLUS?.MarksSummary?.checkAndSummarizeMarks?.();
    },

    parseMarksFromRoot(root, options = { includeUngraded: true }) {
      return window.VTOP_PLUS?.MarksSummary?.parseMarksFromRoot(root, options) || [];
    },

    parseGradeHistoryFromRoot(root) {
      return window.VTOP_PLUS?.CgpaCalculator?.parseGradeHistoryFromRoot(root) || null;
    }
  };

  window.VTOP_PLUS.MarksFatPredictor = MarksFatPredictor;
})();
