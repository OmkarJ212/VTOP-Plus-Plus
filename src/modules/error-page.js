/**
 * VTOP++ - Tomcat / Server Error Page Enhancer
 * Transforms raw Apache Tomcat error responses (e.g., 404/403/500) into a
 * clean VTOP-styled error page matching the pre-login shell in Light & Dark modes.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const STATUS_SUMMARIES = {
    '400': 'The request sent to VTOP could not be understood by the server.',
    '401': 'Authentication is required before you can access this page.',
    '403': 'You do not have permission to view this resource.',
    '404': 'The requested VTOP page or resource could not be found.',
    '405': 'This request method is not supported for the target endpoint.',
    '408': 'The VTOP server timed out waiting for the request.',
    '429': 'Too many requests were sent in a short time. Please wait a moment and retry.',
    '500': 'The VTOP server encountered an unexpected error while processing your request.',
    '502': 'VTOP received an invalid response from an upstream server.',
    '503': 'VTOP is temporarily unavailable or undergoing maintenance.',
    '504': 'The upstream VTOP server took too long to respond.'
  };

  function isTomcatErrorPage() {
    if (document.getElementById('vtop-error-shell')) return false;
    if (
      document.getElementById('vtop-header') ||
      document.getElementById('vtopOpenPageHeader') ||
      document.getElementById('page_outline') ||
      document.getElementById('vtopLoginForm')
    ) {
      return false;
    }

    const body = document.body;
    if (!body) return false;

    const h1 = body.querySelector(':scope > h1');
    const h1Text = (h1?.textContent || '').trim();
    if (!/^HTTP\s+Status\s+\d{3}\b/i.test(h1Text)) return false;

    const h3Text = (body.querySelector(':scope > h3')?.textContent || '').trim();
    const hasLineHr = Boolean(body.querySelector(':scope > hr.line'));
    return /Apache\s+Tomcat/i.test(h3Text) || hasLineHr;
  }

  function extractTomcatDetails() {
    const body = document.body;
    const h1Text = (body.querySelector(':scope > h1')?.textContent || '').trim();
    const match = h1Text.match(/^HTTP\s+Status\s+(\d{3})\s*(?:[–\-:]\s*(.+))?$/i);
    const code = match?.[1] || '';
    const title = (match?.[2] || h1Text || 'Error').trim();

    const rows = [];
    body.querySelectorAll(':scope > p').forEach((p) => {
      const clone = p.cloneNode(true);
      const labelEl = clone.querySelector('b, strong');
      const label = (labelEl?.textContent || '').trim();
      if (labelEl) labelEl.remove();
      const value = clone.textContent.replace(/\s+/g, ' ').trim();
      if (label || value) {
        rows.push({ label: label || 'Detail', value });
      }
    });

    const traces = Array.from(body.querySelectorAll(':scope > pre'))
      .map((pre) => pre.textContent.trim())
      .filter(Boolean);

    const server = (body.querySelector(':scope > h3')?.textContent || '').trim();
    return { code, title, h1Text, rows, traces, server };
  }

  function neutralizeInlineTomcatStyles() {
    document.querySelectorAll('head style').forEach((styleEl) => {
      if (/#525D76/i.test(styleEl.textContent || '')) {
        styleEl.disabled = true;
      }
    });
  }

  function renderErrorPage() {
    const DOM = window.VTOP_PLUS?.DOM;
    const UI = window.VTOP_PLUS?.UI;
    const escapeHtml = DOM?.escapeHtml || ((s) => String(s ?? ''));
    const icon = (name, size = 14) => (UI?.icon ? UI.icon(name, size, { ariaHidden: true }) : '');

    const { code, title, h1Text, rows, traces, server } = extractTomcatDetails();
    neutralizeInlineTomcatStyles();

    document.documentElement.classList.add('vtop-error-page');
    document.body.classList.add('vtop-error-page');

    const heading = code ? `HTTP ${code} – ${title}` : (h1Text || title);
    const summary =
      STATUS_SUMMARIES[code] ||
      'The server could not complete your request. You can return to the home page or try again.';
    const pathText = window.location.pathname || '/';

    const detailRows = [
      { label: 'Path', html: `<code>${escapeHtml(pathText)}</code>` },
      ...rows.map((r) => ({ label: r.label, html: `<span>${escapeHtml(r.value)}</span>` }))
    ];

    const traceHtml = traces.length
      ? `<details class="vtop-err-trace">
           <summary>Technical Details</summary>
           <pre>${escapeHtml(traces.join('\n\n'))}</pre>
         </details>`
      : '';

    const shell = document.createElement('div');
    shell.id = 'vtop-error-shell';
    shell.style.display = 'contents';
    shell.innerHTML = `
      <nav class="vtop-err-navbar">
        <div class="vtop-err-navbar-inner">
          <a class="vtop-err-brand" href="/vtop/open/page">
            <img class="vtop-err-emblem" src="/vtop/assets/img/VITLogoEmblem.png" alt="">
            <span class="vtop-err-brand-vit">VIT</span>
          </a>
          <span class="vtop-err-brand-sub">(Vellore Campus)</span>
        </div>
      </nav>
      <main class="vtop-err-main">
        <section class="vtop-err-card" role="alert" aria-labelledby="vtop-err-heading">
          <div class="vtop-err-card-header">
            <h4 class="vtop-err-title" id="vtop-err-heading">${escapeHtml(heading)}</h4>
          </div>
          <div class="vtop-err-card-body">
            <p class="vtop-err-summary">${escapeHtml(summary)}</p>
            <div class="vtop-err-details">
              ${detailRows
                .map(
                  (row) => `
                  <div class="vtop-err-row">
                    <div class="vtop-err-key">${escapeHtml(row.label)}</div>
                    <div class="vtop-err-val">${row.html}</div>
                  </div>`
                )
                .join('')}
            </div>
            ${traceHtml}
            <div class="vtop-err-actions">
              <button type="button" class="vtop-err-btn" id="vtop-err-back-btn">
                ${icon('arrow-left', 14)}
                <span>Go Back</span>
              </button>
              <button type="button" class="vtop-err-btn" id="vtop-err-reload-btn">
                ${icon('refresh', 14)}
                <span>Reload</span>
              </button>
              <a class="vtop-err-btn vtop-err-btn-primary" href="/vtop/open/page">
                ${icon('home', 14)}
                <span>Go to Home Page</span>
              </a>
            </div>
          </div>
          <div class="vtop-err-card-footer">
            <span>${escapeHtml(server || 'VTOP Server')}</span>
            <span>VIT Vellore</span>
          </div>
        </section>
      </main>
      <footer class="vtop-err-bottom-bar">
        <span>Copyright © ${new Date().getFullYear()} Software Development Cell, VIT, Vellore-632 014.</span>
      </footer>
    `;

    // Remove only raw Tomcat nodes so extension overlays (e.g. CommandPalette) remain intact
    Array.from(document.body.children).forEach((child) => {
      if (!child.id || !child.id.startsWith('vtop-plus-')) {
        child.remove();
      }
    });
    document.body.prepend(shell);

    const emblem = shell.querySelector('.vtop-err-emblem');
    if (emblem) {
      emblem.addEventListener('error', () => {
        emblem.style.display = 'none';
      }, { once: true });
    }

    document.getElementById('vtop-err-back-btn')?.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.assign('/vtop/open/page');
      }
    });

    document.getElementById('vtop-err-reload-btn')?.addEventListener('click', () => {
      window.location.reload();
    });
  }

  const ErrorPage = {
    init() {
      if (!isTomcatErrorPage()) return false;
      renderErrorPage();
      return true;
    }
  };

  window.VTOP_PLUS.ErrorPage = ErrorPage;
})();
