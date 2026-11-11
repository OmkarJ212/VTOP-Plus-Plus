/**
 * VTOP++ - Popup Control Center Script
 * Syncs user toggles with storage and dispatches live commands to the active tab.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('vtop-status-badge');
  const statusMsg = document.getElementById('popup-status-msg');

  // Action buttons
  const btnDownloader = document.getElementById('btn-scan-downloader');
  const btnSpotlight = document.getElementById('btn-trigger-spotlight');
  const btnPrivacy = document.getElementById('btn-toggle-privacy');

  // Toggles
  const toggles = {
    enableDownloader: document.getElementById('toggle-downloader'),
    enableCourseFilter: document.getElementById('toggle-filter'),
    enableSpotlight: document.getElementById('toggle-spotlight'),
    enableAttendanceCalc: document.getElementById('toggle-attendance'),
    enableFatPredictor: document.getElementById('toggle-fat'),
    enableDaTracker: document.getElementById('toggle-da'),
    enableAutoCaptcha: document.getElementById('toggle-captcha'),
    enableSessionKeeper: document.getElementById('toggle-session'),
    enableQuickDock: document.getElementById('toggle-dock')
  };

  let activeTab = null;

  // 1. Check tab URL
  try {
    if (chrome?.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
      const url = activeTab?.url || '';

      if (url.includes('vtop.vit.ac.in') || url.includes('vtop2.vit.ac.in')) {
        statusBadge.textContent = '● Connected';
        statusBadge.style.background = '#ecfdf5';
        statusBadge.style.color = '#059669';
        statusBadge.style.borderColor = '#a7f3d0';
      } else {
        statusBadge.textContent = '○ Navigate to VTOP';
        statusBadge.style.background = '#fffbeb';
        statusBadge.style.color = '#b45309';
        statusBadge.style.borderColor = '#fde68a';
      }
    }
  } catch (err) {
    console.warn('[VTOP++] Popup tab error:', err);
  }

  // 2. Load stored settings
  if (chrome?.storage?.local) {
    chrome.storage.local.get(null, (items) => {
      for (const [key, elem] of Object.entries(toggles)) {
        if (elem && items[key] !== undefined) {
          elem.checked = Boolean(items[key]);
        }
      }
    });
  }

  // 3. Bind toggle changes
  for (const [key, elem] of Object.entries(toggles)) {
    if (!elem) continue;
    elem.addEventListener('change', () => {
      const update = { [key]: elem.checked };
      if (chrome?.storage?.local) {
        chrome.storage.local.set(update);
      }
      notifyActiveTab({ action: 'APPLY_SETTINGS', settings: update });
    });
  }

  // 4. Bind Quick Actions
  if (btnDownloader) {
    btnDownloader.addEventListener('click', () => {
      showStatus('Opening Downloader widget...', 'success');
      notifyActiveTab({ action: 'FORCE_SCAN' }, (resp) => {
        if (resp && resp.success) {
          showStatus('Downloader widget opened in bottom-right!', 'success');
        } else {
          showStatus('Opened. Make sure you are viewing a course.', 'warn');
        }
      });
    });
  }

  if (btnSpotlight) {
    btnSpotlight.addEventListener('click', () => {
      notifyActiveTab({ action: 'OPEN_SEARCH_PAGES' }, (resp) => {
        if (resp && resp.success) {
          showStatus('Search Pages opened on page!', 'success');
        } else {
          showStatus('Make sure you are on a VTOP tab', 'warn');
        }
      });
    });
  }

  if (btnPrivacy) {
    btnPrivacy.addEventListener('click', () => {
      notifyActiveTab({ action: 'TOGGLE_PRIVACY' }, (resp) => {
        if (resp) {
          showStatus(`Privacy Mode ${resp.active ? 'Activated 🔒' : 'Disabled 🔓'}`, 'success');
        }
      });
    });
  }

  function notifyActiveTab(message, callback) {
    if (!activeTab || !activeTab.id) return;
    chrome.tabs.sendMessage(activeTab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        // Tab might not have script injected
      }
      if (callback) callback(response);
    });
  }

  function showStatus(text, type = 'success') {
    if (!statusMsg) return;
    statusMsg.textContent = text;
    statusMsg.className = 'status-message ' + type;
    statusMsg.style.display = 'block';
    setTimeout(() => {
      statusMsg.style.display = 'none';
    }, 3000);
  }
});
