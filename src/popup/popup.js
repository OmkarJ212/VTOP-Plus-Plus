/**
 * VTOP++ - Popup Control Script
 * Syncs Session Keep-Alive setting with storage and active VTOP tab.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('vtop-status-badge');
  const sessionToggle = document.getElementById('toggle-session');
  const sessionMeta = document.getElementById('session-meta-text');

  let activeTab = null;

  function applyPopupTheme(isDark) {
    const active = Boolean(isDark);
    document.documentElement.classList.toggle('vtop-dark-theme', active);
    document.body?.classList.toggle('vtop-dark-theme', active);
  }

  function renderSessionMeta(enabled) {
    if (!sessionMeta) return;
    sessionMeta.classList.toggle('is-paused', !enabled);
    const label = sessionMeta.querySelector('span:last-child');
    if (label) {
      label.textContent = enabled ? 'Active' : 'Paused';
    }
  }

  try {
    if (chrome?.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
      const url = activeTab?.url || '';
      const isVelloreVtop = /^https?:\/\/vtop\.vit\.ac\.in(\/|$)/i.test(url);

      if (isVelloreVtop) {
        statusBadge.textContent = '● Connected';
        statusBadge.classList.remove('is-warn');
      } else {
        statusBadge.textContent = '○ Open VTOP';
        statusBadge.classList.add('is-warn');
      }
    }
  } catch (err) {
    console.warn('[VTOP++] Popup tab error:', err);
  }

  if (chrome?.storage?.local) {
    chrome.storage.local.get(['enableSessionKeeper', 'enableDarkMode'], (items) => {
      if (chrome.runtime.lastError || !items) return;
      const enabled = items.enableSessionKeeper !== undefined ? Boolean(items.enableSessionKeeper) : true;
      if (sessionToggle) sessionToggle.checked = enabled;
      renderSessionMeta(enabled);
      applyPopupTheme(Boolean(items.enableDarkMode));
    });
  }

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.enableDarkMode !== undefined) {
        applyPopupTheme(Boolean(changes.enableDarkMode.newValue));
      }
      if (changes.enableSessionKeeper !== undefined) {
        const enabled = Boolean(changes.enableSessionKeeper.newValue);
        if (sessionToggle) sessionToggle.checked = enabled;
        renderSessionMeta(enabled);
      }
    });
  }

  sessionToggle?.addEventListener('change', () => {
    const enabled = sessionToggle.checked;
    renderSessionMeta(enabled);

    if (chrome?.storage?.local) {
      chrome.storage.local.set({ enableSessionKeeper: enabled });
    }

    if (activeTab?.id && chrome?.tabs?.sendMessage) {
      chrome.tabs.sendMessage(
        activeTab.id,
        { action: 'APPLY_SETTINGS', settings: { enableSessionKeeper: enabled } },
        () => {
          void chrome.runtime.lastError;
        }
      );
    }
  });
});
