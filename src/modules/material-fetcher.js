/**
 * VTOP++ - Course Material Multi-Page Crawler & Dual-Layer Fetcher
 * Handles DataTables pagination crawling and background/direct material downloads.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const REGEX_RFC5987 = /filename\*=(?:UTF-8''|utf-8'')((['"]).*?\2|[^;\n]*)/i;
  const REGEX_STD_FILENAME = /filename=((['"]).*?\2|[^;\n]*)/i;

  const MaterialFetcher = {
    getTableStateSnapshot() {
      const activeBtn = document.querySelector(
        '#materialTable_paginate .paginate_button.current, #materialTable_paginate .page-item.active, .paginate_button.current'
      );
      const activePage = activeBtn ? (activeBtn.textContent || '').trim() : '';
      const firstRow = document.querySelector('#materialTable tbody tr, table tbody tr');
      const firstRowText = firstRow ? (firstRow.textContent || '').trim().substring(0, 40) : '';
      const infoText =
        document.getElementById('materialTable_info')?.textContent ||
        document.querySelector('.dataTables_info')?.textContent ||
        '';
      return `${activePage}|${firstRowText}|${infoText}`;
    },

    async waitForTableStateChange(oldSnapshot, maxWaitMs = 2500) {
      return new Promise((resolve) => {
        let settled = false;
        let obs = null;
        let pollTimer = null;
        let timeoutTimer = null;

        const finish = (changed) => {
          if (settled) return;
          settled = true;
          if (obs) obs.disconnect();
          if (pollTimer) clearInterval(pollTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve(changed);
        };

        const check = () => {
          if (this.getTableStateSnapshot() !== oldSnapshot) {
            setTimeout(() => finish(true), 20);
          }
        };

        const tbody = document.querySelector('#materialTable tbody, table tbody');
        if (tbody) {
          obs = new MutationObserver(check);
          obs.observe(tbody, { childList: true });
        }

        pollTimer = setInterval(check, 50);
        timeoutTimer = setTimeout(() => finish(false), maxWaitMs);
      });
    },

    async crawlAllPages({ isCancelled, onScanRows, onComplete }) {
      let maxPages = 100;
      while (maxPages-- > 0) {
        if (isCancelled() || !document.getElementById('materialTable')) return;
        onScanRows();

        const nextLi =
          document.getElementById('materialTable_next') ||
          document.querySelector('#materialTable_paginate .next, .paginate_button.next');
        if (!nextLi || nextLi.classList.contains('disabled') || nextLi.getAttribute('aria-disabled') === 'true') {
          break;
        }

        const nextA = nextLi.querySelector('a') || nextLi;
        const snapshot = this.getTableStateSnapshot();
        nextA.click();
        await this.waitForTableStateChange(snapshot, 2500);
        if (isCancelled()) return;
      }

      onScanRows();

      // Return to page 1
      const firstBtn =
        document.getElementById('materialTable_first') ||
        document.querySelector('#materialTable_paginate .first a, #materialTable_paginate .paginate_button.first');
      let targetBtn = firstBtn;
      if (!targetBtn) {
        const pageLinks = document.querySelectorAll(
          '#materialTable_paginate .paginate_button, #materialTable_paginate .page-link, #materialTable_paginate a'
        );
        for (const btn of pageLinks) {
          const txt = (btn.innerText || btn.textContent || '').trim();
          if (txt === '1') {
            targetBtn = btn;
            break;
          }
        }
      }

      if (targetBtn) {
        const snapshot = this.getTableStateSnapshot();
        targetBtn.click();
        await this.waitForTableStateChange(snapshot, 1500);
        if (isCancelled()) return;
      }

      if (typeof onComplete === 'function') {
        onComplete();
      }
    },

    base64ToArrayBuffer(base64) {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    },

    getExtensionFromContentType(contentType) {
      if (contentType.includes('application/pdf')) return 'pdf';
      if (contentType.includes('application/zip')) return 'zip';
      if (contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml')) return 'docx';
      if (contentType.includes('application/vnd.openxmlformats-officedocument.presentationml')) return 'pptx';
      if (contentType.includes('image/png')) return 'png';
      if (contentType.includes('image/jpeg')) return 'jpg';
      return 'pdf';
    },

    /**
     * Request single file with dual-layer engine:
     * 1. Background Service Worker (immune to CSP & redirect CORS)
     * 2. Direct Content-Script fetch fallback
     */
    async fetchSingleMaterial(fileInfo, regNo, csrfToken) {
      const fileId = fileInfo.fileId;
      const basePath = window.VTOP_PLUS?.DOM?.getBasePath ? window.VTOP_PLUS.DOM.getBasePath() : 'vtop';
      const targetUrl = `${window.location.origin}/${basePath}/downloadCourseMaterialFacultyPdf`;

      const formData = new URLSearchParams();
      if (csrfToken) formData.append('_csrf', csrfToken);
      formData.append('authorizedID', regNo);
      formData.append('fileId', fileId);
      const bodyString = formData.toString();

      const customHeaders = {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: '*/*'
      };
      if (csrfToken) {
        customHeaders['X-CSRF-TOKEN'] = csrfToken;
      }

      let lastError = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          let bgResult = null;
          try {
            bgResult = await new Promise((resolve) => {
              if (!chrome?.runtime?.sendMessage) return resolve(null);
              chrome.runtime.sendMessage(
                {
                  action: 'FETCH_MATERIAL',
                  url: targetUrl,
                  body: bodyString,
                  headers: customHeaders,
                  timeoutMs: 25000
                },
                (response) => {
                  if (chrome.runtime.lastError) return resolve(null);
                  resolve(response);
                }
              );
            });
          } catch (_) {
            bgResult = null;
          }

          let arrayBuffer = null;
          let contentType = '';
          let contentDisposition = '';

          let bgHandled = false;
          if (bgResult && bgResult.success && bgResult.base64Data) {
            arrayBuffer = this.base64ToArrayBuffer(bgResult.base64Data);
            contentType = bgResult.contentType || '';
            contentDisposition = bgResult.contentDisposition || '';
            bgHandled = true;
          } else if (bgResult && bgResult.error && bgResult.error.includes('429')) {
            throw new Error('HTTP 429: VTOP has temporarily rate-limited downloads. Please wait a few minutes.');
          }

          if (!bgHandled) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            try {
              const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  ...customHeaders
                },
                body: bodyString,
                credentials: 'include',
                redirect: 'follow',
                signal: controller.signal
              });

              if (response.status === 429) {
                throw new Error('HTTP 429: VTOP has temporarily rate-limited downloads. Please wait a few minutes.');
              }

              if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
              }

              contentType = response.headers.get('content-type') || '';
              contentDisposition = response.headers.get('content-disposition') || '';
              arrayBuffer = await response.arrayBuffer();
            } finally {
              clearTimeout(timeoutId);
            }
          }

          if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            throw new Error('Empty response received from server (0 bytes).');
          }

          if (contentType.includes('text/html') || (!contentDisposition && arrayBuffer.byteLength < 5000)) {
            const textPreview = new TextDecoder().decode(arrayBuffer.slice(0, 1000));
            if (
              textPreview.includes('login') ||
              textPreview.includes('Login') ||
              textPreview.includes('session') ||
              textPreview.includes('Session Timeout')
            ) {
              throw new Error('VTOP session expired or logged out. Pausing downloads to protect your account.');
            }
            if (contentType.includes('text/html')) {
              throw new Error('Received an HTML error response instead of the requested material file.');
            }
          }

          let fileName = null;
          if (contentDisposition) {
            const rfcMatch = contentDisposition.match(REGEX_RFC5987);
            if (rfcMatch && rfcMatch[1]) {
              const raw = rfcMatch[1].replace(/['"]/g, '').trim();
              try {
                fileName = decodeURIComponent(raw);
              } catch (_) {
                fileName = raw;
              }
            } else {
              const stdMatch = contentDisposition.match(REGEX_STD_FILENAME);
              if (stdMatch && stdMatch[1]) {
                fileName = stdMatch[1].replace(/['"]/g, '').trim();
              }
            }
          }

          return {
            arrayBuffer,
            fileName,
            contentType
          };
        } catch (err) {
          lastError = err;
          if (
            err.message &&
            (err.message.includes('429') ||
              err.message.includes('rate-limited') ||
              err.message.includes('session expired') ||
              err.message.includes('logged out'))
          ) {
            throw err;
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      throw lastError || new Error('Download failed after retries.');
    }
  };

  window.VTOP_PLUS.MaterialFetcher = MaterialFetcher;
})();
