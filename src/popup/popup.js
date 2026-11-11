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
  const btnDark = document.getElementById('btn-toggle-dark');

  // Toggles
  const toggles = {
    enableDarkMode: document.getElementById('toggle-dark-mode'),
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

      if (url.includes('vit.ac.in') || url.includes('vtop')) {
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
      if (btnDark && items?.enableDarkMode !== undefined) {
        btnDark.classList.toggle('active', Boolean(items.enableDarkMode));
      }
      if (btnPrivacy && items?.enablePrivacyMode !== undefined) {
        btnPrivacy.classList.toggle('active', Boolean(items.enablePrivacyMode));
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
      if (key === 'enableDarkMode' && btnDark) {
        btnDark.classList.toggle('active', elem.checked);
      }
      if (key === 'enablePrivacyMode' && btnPrivacy) {
        btnPrivacy.classList.toggle('active', elem.checked);
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
          if (resp.fileCount > 0) {
            showStatus(`✅ Found ${resp.fileCount} files (${resp.activeCourse})! Downloader opened.`, 'success');
          } else if (resp.hasButtons) {
            showStatus('✅ Course materials detected! Downloader opened.', 'success');
          } else {
            showStatus('Downloader widget opened in bottom-right!', 'success');
          }
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
      const newState = !toggles.enablePrivacyMode?.checked;
      if (toggles.enablePrivacyMode) {
        toggles.enablePrivacyMode.checked = newState;
      }
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ enablePrivacyMode: newState });
      }
      btnPrivacy.classList.toggle('active', newState);
      notifyActiveTab({ action: 'TOGGLE_PRIVACY', active: newState });
      showStatus(`Privacy Mode ${newState ? 'Activated 🔒' : 'Disabled 🔓'}`, 'success');
    });
  }

  if (btnDark) {
    btnDark.addEventListener('click', () => {
      const newState = !toggles.enableDarkMode?.checked;
      if (toggles.enableDarkMode) {
        toggles.enableDarkMode.checked = newState;
      }
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ enableDarkMode: newState });
      }
      btnDark.classList.toggle('active', newState);
      notifyActiveTab({ action: 'TOGGLE_DARK_MODE', active: newState });
      showStatus(`Universal Dark Mode ${newState ? 'Enabled 🌙' : 'Disabled ☀️'}`, 'success');
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
