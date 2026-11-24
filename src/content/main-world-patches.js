/**
 * VTOP++ - Main World Patches
 * Silences VTOP's blocking Bootstrap loading modal (#confirmBox) when triggered via
 * ConfirmBox.prototype.connectServer() (e.g. Faculty Info search, Facility/Transport/PAT
 * forms), while preserving interactive ConfirmBox.show() / showText() dialogs.
 */

(function () {
  'use strict';

  let patched = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 20;

  function patchConfirmBox() {
    if (patched) return true;

    let ctor = null;
    try {
      // Top-level `class ConfirmBox` in VTOP's inline script is a global lexical binding, not window.ConfirmBox
      if (typeof ConfirmBox === 'function') {
        ctor = ConfirmBox;
      } else if (typeof window.ConfirmBox === 'function') {
        ctor = window.ConfirmBox;
      }
    } catch (_) {
      ctor = null;
    }

    if (!ctor || !ctor.prototype || typeof ctor.prototype.connectServer !== 'function') {
      return false;
    }

    if (ctor.prototype.connectServer.__vtopPlusSilenced) {
      patched = true;
      return true;
    }

    const silentConnectServer = function () {
      if (this.paramsdefined !== undefined) {
        this.confirmBoxShown = false;
        this.keepOpen = false;
        return this.fetchCall(this.submitTo)
          .then((response) => this.updateResponse(response))
          .catch((error) => {
            console.warn('[VTOP++] Request error in ConfirmBox.connectServer:', error);
            if (typeof this.onError === 'function') {
              this.onError(error);
            }
          });
      }
    };

    silentConnectServer.__vtopPlusSilenced = true;
    ctor.prototype.connectServer = silentConnectServer;
    patched = true;
    return true;
  }

  function ensureBlockUIPopup() {
    let popup = document.getElementById('popup');
    if (popup && !popup.parentNode) {
      const host = document.getElementById('page_outline') || document.body;
      if (host) host.appendChild(popup);
    }
    if (!popup) {
      const host = document.getElementById('page_outline') || document.body;
      if (!host) return null;
      popup = document.createElement('div');
      popup.id = 'popup';
      popup.className = 'row noshow';
      popup.style.display = 'none';
      popup.innerHTML =
        '<div class="col-12"><div class="card"><div class="card-header"><span class="h6 fw-bold">Loading... Please Wait</span></div></div></div>';
      host.appendChild(popup);
    }
    return popup;
  }

  function patchBlockUI() {
    const jq = window.jQuery || window.$;
    if (!jq || typeof jq.blockUI !== 'function' || jq.blockUI.__vtopPlusGuarded) {
      return Boolean(jq?.blockUI?.__vtopPlusGuarded);
    }
    const origBlockUI = jq.blockUI;
    const guardedBlockUI = new Proxy(origBlockUI, {
      apply(target, thisArg, args) {
        let opts = args[0];
        if (opts && opts.message && opts.message.jquery && (opts.message.length === 0 || !opts.message[0]?.parentNode)) {
          const recovered = ensureBlockUIPopup();
          if (recovered) {
            opts = { ...opts, message: jq(recovered) };
            return Reflect.apply(target, thisArg, [opts, ...args.slice(1)]);
          }
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
    guardedBlockUI.__vtopPlusGuarded = true;
    jq.blockUI = guardedBlockUI;
    return true;
  }

  function tryPatchWithRetry() {
    const cbOk = patchConfirmBox();
    const buiOk = patchBlockUI();
    if (cbOk && buiOk) return;
    if (++attempts < MAX_ATTEMPTS) {
      setTimeout(tryPatchWithRetry, 250);
    }
  }

  tryPatchWithRetry();

  // Direct Course DA Upload loader invoked from Home page #digital-assignments table
  document.addEventListener('vtop-plus-open-da-upload', (e) => {
    const detail = e?.detail || {};
    const classId = typeof detail.classId === 'string' ? detail.classId.trim() : '';
    const authId = typeof detail.authId === 'string' ? detail.authId.trim() : '';
    const csrf = typeof detail.csrf === 'string' ? detail.csrf.trim() : '';
    if (!classId || !/^[A-Za-z0-9_-]+$/.test(classId)) return;

    const targetId = document.getElementById('main-section')
      ? 'main-section'
      : document.getElementById('b5-pagewrapper')
      ? 'b5-pagewrapper'
      : '';
    if (!targetId) return;

    const params = `_csrf=${encodeURIComponent(csrf)}&classId=${encodeURIComponent(classId)}&authorizedID=${encodeURIComponent(authId)}&x=${encodeURIComponent(new Date().toUTCString())}`;

    try {
      const Ctor = typeof ConfirmBox === 'function' ? ConfirmBox : window.ConfirmBox;
      if (typeof Ctor === 'function') {
        if (typeof blockGUI === 'function') blockGUI();
        new Ctor()
          .withParameters({
            submitTo: { url: 'examinations/processDigitalAssignment', data: params },
            updateResponseTo: targetId,
            onSuccess: function () {
              if (typeof unblockGUI === 'function') unblockGUI();
            },
            onError: function () {
              if (typeof unblockGUI === 'function') unblockGUI();
            }
          })
          .call();
        return;
      }
      if (typeof ajaxB5Call === 'function') {
        ajaxB5Call('examinations/processDigitalAssignment', params, targetId);
      }
    } catch (err) {
      console.warn('[VTOP++] Direct DA upload navigation error:', err);
    }
  });
})();
