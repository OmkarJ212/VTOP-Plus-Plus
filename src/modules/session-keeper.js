/**
 * VTOP++ - Session Keep-Alive Module
 * Sends background heartbeat pings every 8-9 minutes to prevent the 15-minute idle timeout.
 */

(function () {
  window.VTOP_PLUS = window.VTOP_PLUS || {};

  let lastActivityTime = Date.now();
  const MAX_IDLE_KEEP_ALIVE_MS = 20 * 60 * 1000; // 20 minutes idle limit for public safety

  function markActivity() {
    lastActivityTime = Date.now();
  }

  const SessionKeeper = {
    timer: null,
    lastPingTime: null,
    _onMessage: null,
    _listenersAttached: false,

    init() {
      if (this.timer) clearInterval(this.timer);

      if (!this._listenersAttached) {
        window.addEventListener('mousemove', markActivity, { passive: true });
        window.addEventListener('keydown', markActivity, { passive: true });
        window.addEventListener('scroll', markActivity, { passive: true });
        window.addEventListener('click', markActivity, { passive: true });
        window.addEventListener('touchstart', markActivity, { passive: true });
        this._listenersAttached = true;
      }

      // Listen for background worker alarm pings
      if (!this._onMessage && chrome?.runtime?.onMessage) {
        this._onMessage = (message) => {
          if (message && message.action === 'HEARTBEAT_PING') {
            this.ping();
          }
        };
        chrome.runtime.onMessage.addListener(this._onMessage);
      }

      // Also set a client-side interval every 8 minutes as backup
      this.timer = setInterval(() => {
        this.ping();
      }, 8 * 60 * 1000);

      console.log('[VTOP++] Session Keep-Alive module activated (8-minute cycle with idle guard).');
    },

    async ping() {
      // 1. Only ping if student is actively logged in
      const DOM = window.VTOP_PLUS?.DOM;
      const authId = DOM?.getAuthId ? DOM.getAuthId() : '';
      const isLoginScreen = Boolean(document.querySelector('#vtopLoginForm, input#username, #loginForm, #vtopLogin, input[name="username"]'));
      if (!authId || isLoginScreen) return;

      // 2. Pause keep-alive if device has been idle for >20 mins to prevent public session exposure
      if (Date.now() - lastActivityTime > MAX_IDLE_KEEP_ALIVE_MS) {
        console.debug('[VTOP++] User idle for >20m. Pausing keep-alive pings for terminal security.');
        return;
      }

      try {
        const basePath = DOM?.getBasePath ? DOM.getBasePath() : 'vtop';
        const pingUrl = `${window.location.origin}/${basePath}/content`;

        let res = await fetch(pingUrl, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store'
        }).catch(() => null);

        if (!res || !res.ok) {
          res = await fetch(`${window.location.origin}/${basePath}/`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store'
          }).catch(() => null);
        }

        if (res && res.ok && !(res.url || '').includes('/vtop/login')) {
          this.lastPingTime = new Date().toLocaleTimeString();
          console.debug(`[VTOP++] Session heartbeat sent at ${this.lastPingTime}`);
        }
      } catch (err) {
        // network offline or page navigating
      }
    },

    destroy() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      if (this._onMessage) {
        if (chrome?.runtime?.onMessage) {
          chrome.runtime.onMessage.removeListener(this._onMessage);
        }
        this._onMessage = null;
      }
      if (this._listenersAttached) {
        window.removeEventListener('mousemove', markActivity);
        window.removeEventListener('keydown', markActivity);
        window.removeEventListener('scroll', markActivity);
        window.removeEventListener('click', markActivity);
        window.removeEventListener('touchstart', markActivity);
        this._listenersAttached = false;
      }
    }
  };

  window.VTOP_PLUS.SessionKeeper = SessionKeeper;
})();
