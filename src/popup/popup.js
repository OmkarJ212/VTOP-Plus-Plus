// Popup script: syncs dashboard widget visibility toggles with storage and active VTOP tab.

document.addEventListener('DOMContentLoaded', async () => {
  const toggles = Array.from(document.querySelectorAll('input[data-setting]'));
  const settingKeys = toggles.map((el) => el.dataset.setting).filter(Boolean);
  const POPUP_THEME_KEY = 'vtop_plus_popup_dark_v1';

  let activeTab = null;

  function applyPopupTheme(isDark) {
    const active = Boolean(isDark);
    document.documentElement.classList.toggle('vtop-dark-theme', active);
    document.body?.classList.toggle('vtop-dark-theme', active);
    try {
      localStorage.setItem(POPUP_THEME_KEY, active ? '1' : '0');
    } catch { /* ignore */ }
  }

  try {
    if (localStorage.getItem(POPUP_THEME_KEY) === '1') {
      applyPopupTheme(true);
    }
  } catch { /* ignore */ }

  function syncToggleValues(values) {
    if (!values) return;
    for (const input of toggles) {
      const key = input.dataset.setting;
      if (key && values[key] !== undefined) {
        input.checked = Boolean(values[key]);
      }
    }
  }

  try {
    if (chrome?.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
    }
  } catch (err) {
    console.warn('[VTOP++] Popup tab error:', err);
  }

  const Storage = window.VTOP_PLUS?.Storage;
  if (Storage) {
    Storage.get([...settingKeys, 'enableDarkMode']).then((items) => {
      if (!items) return;
      for (const input of toggles) {
        const key = input.dataset.setting;
        input.checked = items[key] !== undefined ? Boolean(items[key]) : true;
      }
      applyPopupTheme(Boolean(items.enableDarkMode));
    });

    Storage.onKeysChanged([...settingKeys, 'enableDarkMode'], (matched) => {
      if (matched.enableDarkMode !== undefined) {
        applyPopupTheme(Boolean(matched.enableDarkMode));
      }
      syncToggleValues(matched);
    });
  }

  for (const input of toggles) {
    input.addEventListener('change', () => {
      const key = input.dataset.setting;
      if (!key) return;
      const patch = { [key]: input.checked };
      window.VTOP_PLUS?.Storage?.set(patch);

      if (activeTab?.id && chrome?.tabs?.sendMessage) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'APPLY_SETTINGS', settings: patch }, () => {
          void chrome.runtime.lastError;
        });
      }
    });
  }
});
