/**
 * VTOP++ - Session Keep-Alive Module
 * Sends background heartbeat pings every 8-9 minutes to prevent the 15-minute idle timeout.
 */

(function () {
  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const SessionKeeper = {
    timer: null,
    lastPingTime: null,
    _onMessage: null,

    init() {
      if (this.timer) clearInterval(this.timer);

      // Listen for background worker alarm pings
      if (!this._onMessage) {
        this._onMessage = (message) => {
          if (message.action === 'HEARTBEAT_PING') {
            this.ping();
          }
        };
        chrome.runtime.onMessage.addListener(this._onMessage);
      }

      // Also set a client-side interval every 8 minutes as backup
      this.timer = setInterval(() => {
        this.ping();
      }, 8 * 60 * 1000);

      console.log('[VTOP++] Session Keep-Alive module activated (8-minute cycle).');
    },

    async ping() {
      // Only ping if student is actively logged in
      const authId = document.getElementById('authorizedID')?.value ||
                     document.getElementById('authorizedIDX')?.value ||
                     document.querySelector('input[name="authorizedID"]')?.value;

      const isLoginScreen = Boolean(document.querySelector('#loginForm, #vtopLogin, input[name="username"]'));
      if (!authId || isLoginScreen) return;

      try {
        const basePath = window.location.pathname.split('/')[1] || 'vtop';
        const pingUrl = window.location.href || `/${basePath}/content`;
        const urlWithParam = pingUrl.includes('?') 
          ? `${pingUrl}&_vtop_ping=${Date.now()}` 
          : `${pingUrl}?_vtop_ping=${Date.now()}`;

        await fetch(urlWithParam, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store'
        }).catch(() => {
          return fetch(`/${basePath}/content?_vtop_ping=${Date.now()}`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store'
          });
        });
        this.lastPingTime = new Date().toLocaleTimeString();
        console.debug(`[VTOP++] Session heartbeat sent at ${this.lastPingTime}`);
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
        chrome.runtime.onMessage.removeListener(this._onMessage);
        this._onMessage = null;
      }
    }
  };

  window.VTOP_PLUS.SessionKeeper = SessionKeeper;
})();
