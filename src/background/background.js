/**
 * VTOP++ - Background Service Worker
 * Manages privileged downloads, CORS/CSP bypass, and session keep-alive alarms.
 */

chrome.runtime.onInstalled.addListener(() => {
});

// Ensure alarm is active on worker spin-up
setupKeepAliveAlarm();

// Setup 9-minute alarm for session keep-alive
function setupKeepAliveAlarm() {
  if (chrome.alarms) {
    chrome.alarms.get('vtop_keep_alive_alarm', (existing) => {
      if (!existing) {
        chrome.alarms.create('vtop_keep_alive_alarm', { periodInMinutes: 9 });
      }
    });
  }
}

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'vtop_keep_alive_alarm') {
      pingActiveVtopSessions();
    }
  });
}

/**
 * Send heartbeat ping to active VTOP tabs to prevent 15-minute idle session timeout
 */
async function pingActiveVtopSessions() {
  try {
    const tabs = await chrome.tabs.query({ url: ['*://vtop.vit.ac.in/*'] });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'HEARTBEAT_PING' }, () => {
          if (chrome.runtime.lastError) {
            // tab might be unloaded or loading
          }
        });
      }
    }
  } catch (err) {
    console.warn('[VTOP++] Keep-alive ping failed:', err);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') return;

  if (message.action === 'FETCH_MATERIAL') {
    handleFetchMaterial(message)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true; // Keep channel open
  }

  if (message.action === 'LOAD_CAPTCHA_WEIGHTS') {
    fetch(chrome.runtime.getURL('models/velloreWeights.json'))
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open
  }

  if (message.action === 'NOTIFY_MARKS_UPDATE') {
    handleMarksNotification(message, sender)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }
});

const marksNotifTargets = new Map();

async function handleMarksNotification({ title, message, semesterSubId }, sender) {
  if (!chrome.notifications?.create) {
    return { success: false, error: 'Notifications API unavailable' };
  }
  const notifId = `vtop-marks-${Date.now()}`;
  marksNotifTargets.set(notifId, {
    tabId: sender?.tab?.id || null,
    windowId: sender?.tab?.windowId || null,
    semesterSubId: semesterSubId || ''
  });

  return new Promise((resolve) => {
    chrome.notifications.create(
      notifId,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: title || 'VTOP++ Marks Updated',
        message: message || 'New marks were uploaded on VTOP.'
      },
      () => {
        if (chrome.runtime.lastError) {
          marksNotifTargets.delete(notifId);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve({ success: true, notifId });
        }
      }
    );
  });
}

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener(async (notifId) => {
    const target = marksNotifTargets.get(notifId);
    marksNotifTargets.delete(notifId);
    chrome.notifications.clear(notifId);

    try {
      let tabId = target?.tabId || null;
      let windowId = target?.windowId || null;
      if (!tabId) {
        const tabs = await chrome.tabs.query({ url: ['*://vtop.vit.ac.in/*'] });
        if (tabs[0]) {
          tabId = tabs[0].id;
          windowId = tabs[0].windowId;
        }
      }
      if (windowId) {
        await chrome.windows.update(windowId, { focused: true }).catch(() => {});
      }
      if (tabId) {
        await chrome.tabs.update(tabId, { active: true }).catch(() => {});
        chrome.tabs.sendMessage(
          tabId,
          { action: 'OPEN_MARKS_PAGE', semesterSubId: target?.semesterSubId || '' },
          () => { void chrome.runtime.lastError; }
        );
      }
    } catch (_) {}
  });
}

function isAllowedMaterialUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === 'vtop.vit.ac.in') {
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    }
    if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.amazonaws.com')) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Fetch course material with extension privileges
 */
async function handleFetchMaterial({ url, body, headers, timeoutMs = 25000 }) {
  if (!isAllowedMaterialUrl(url)) {
    return { success: false, error: 'Disallowed URL' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
        ...(headers || {})
      },
      body: body,
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal
    });

    const status = response.status;
    const ok = response.ok;
    const contentType = response.headers.get('content-type') || '';
    const contentDisposition = response.headers.get('content-disposition') || '';

    if (!ok) {
      return {
        success: false,
        status,
        error: `HTTP ${status} ${response.statusText}`
      };
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      return {
        success: false,
        status,
        error: 'Received empty response (0 bytes) from server.'
      };
    }

    // Guard against Chrome IPC message payload limits (~64MB)
    if (arrayBuffer.byteLength > 45 * 1024 * 1024) {
      return {
        success: false,
        status,
        error: `File is too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB) for background IPC bridge.`
      };
    }

    const base64Data = arrayBufferToBase64(arrayBuffer);

    return {
      success: true,
      status,
      contentType,
      contentDisposition,
      byteLength: arrayBuffer.byteLength,
      base64Data
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s` };
    }
    return { success: false, error: err.message || String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * High-performance chunked conversion of ArrayBuffer to Base64 string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192; // 8KB chunks safely avoid call stack limits on all platforms
  let binary = '';
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
