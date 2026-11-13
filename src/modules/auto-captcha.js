/**
 * VTOP++ - High-Precision Offline Captcha Solver & Smart Login Helper
 * Exclusively calibrated for VIT Vellore VTOP (vtop.vit.ac.in).
 * 100% client-side, zero latency, sub-millisecond inference, works completely offline.
 */

(function () {
  'use strict';

  window.VTOP_PLUS = window.VTOP_PLUS || {};

  const VELLORE_WIDTH = 200;
  const VELLORE_HEIGHT = 40;
  const VELLORE_LABELS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const NUM_CLASSES = 32;
  const BLOCK_W = 24;
  const BLOCK_H = 22;
  const BLOCK_PIXELS = 528; // 24 * 22

  // Reusable offscreen canvas & context (zero re-allocation per solve)
  let offscreenCanvas = null;
  let offscreenCtx = null;
  let cachedWeights = null;

  // Pre-allocated flat buffer for character binarization
  const flatBuffer = new Uint8Array(BLOCK_PIXELS);

  /**
   * Fast saturation calculation using typed array
   */
  function computeSaturation(rgbaData, outSat) {
    for (let i = 0, j = 0; i < rgbaData.length; i += 4, j++) {
      const r = rgbaData[i];
      const g = rgbaData[i + 1];
      const b = rgbaData[i + 2];
      const min = Math.min(r, g, b);
      const max = Math.max(r, g, b);
      outSat[j] = max ? Math.round(((max - min) * 255) / max) : 0;
    }
  }

  /**
   * Lazy-load Vellore neural weights with instant memory caching
   */
  async function getVelloreWeights() {
    if (cachedWeights) return cachedWeights;

    window.VTOP_PLUS.CAPTCHA_WEIGHTS = window.VTOP_PLUS.CAPTCHA_WEIGHTS || {};
    if (window.VTOP_PLUS.CAPTCHA_WEIGHTS.vellore) {
      cachedWeights = window.VTOP_PLUS.CAPTCHA_WEIGHTS.vellore;
      return cachedWeights;
    }

    try {
      const url = chrome.runtime.getURL('models/velloreWeights.json');
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        cachedWeights = data;
        window.VTOP_PLUS.CAPTCHA_WEIGHTS.vellore = data;
        return data;
      }
    } catch (_) {}

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'LOAD_CAPTCHA_WEIGHTS' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.success && response.data) {
          cachedWeights = response.data;
          window.VTOP_PLUS.CAPTCHA_WEIGHTS.vellore = response.data;
          resolve(response.data);
        } else {
          reject(new Error(response?.error || 'Failed to load Vellore weights'));
        }
      });
    });
  }

  /**
   * Sub-millisecond neural solver:
   * Extracts 6 characters directly from the 200x40 saturation map,
   * binarizes with dynamic thresholding, and evaluates dense weights with
   * fused single-pass argmax without floating multiplications.
   */
  async function solveCaptchaFromImage(img) {
    const weights = await getVelloreWeights();
    if (!weights?.weights || !weights?.biases) return '';

    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = VELLORE_WIDTH;
      offscreenCanvas.height = VELLORE_HEIGHT;
      offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    let imgData;
    try {
      offscreenCtx.drawImage(img, 0, 0, VELLORE_WIDTH, VELLORE_HEIGHT);
      imgData = offscreenCtx.getImageData(0, 0, VELLORE_WIDTH, VELLORE_HEIGHT);
    } catch (err) {
      console.warn('[VTOP++] Cannot extract captcha pixels (cross-origin or tainted canvas):', err);
      return '';
    }

    // Compute saturation map into typed array
    const sat = new Uint8Array(VELLORE_WIDTH * VELLORE_HEIGHT);
    computeSaturation(imgData.data, sat);

    const W = weights.weights; // 528 x 32
    const B = weights.biases;  // 32
    let solvedText = '';

    for (let a = 0; a < 6; a++) {
      const x1 = (a + 1) * 25 + 2;
      const y1 = 7 + 5 * (a % 2) + 1;
      const x2 = (a + 2) * 25 + 1; // x2 - x1 === 24
      const y2 = 35 - 5 * ((a + 1) % 2); // y2 - y1 === 22

      // Pass 1: compute mean saturation for dynamic binarization
      let sum = 0;
      let idx = 0;
      for (let y = y1; y < y2; y++) {
        const rowOffset = y * VELLORE_WIDTH;
        for (let x = x1; x < x2; x++) {
          const val = sat[rowOffset + x];
          flatBuffer[idx++] = val;
          sum += val;
        }
      }
      const avg = sum / BLOCK_PIXELS;

      // Pass 2: Inverted loop order - checks flatBuffer[k] > avg once per pixel instead of 32x
      const logits = Float64Array.from(B);
      for (let k = 0; k < BLOCK_PIXELS; k++) {
        if (flatBuffer[k] > avg) {
          const wRow = W[k];
          for (let j = 0; j < NUM_CLASSES; j++) {
            logits[j] += wRow[j];
          }
        }
      }
      let bestIdx = 0;
      let maxLogit = -Infinity;
      for (let j = 0; j < NUM_CLASSES; j++) {
        if (logits[j] > maxLogit) {
          maxLogit = logits[j];
          bestIdx = j;
        }
      }

      solvedText += VELLORE_LABELS[bestIdx];
    }

    return solvedText;
  }

  // ---------- DOM Locators & Automation ----------

  const CAPTCHA_KEYWORD_RE = /captcha/i;

  function looksLikeCaptcha(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return false;
    const ratio = w / h;
    return w >= 90 && w <= 450 && ratio >= 2.5 && ratio <= 6.5;
  }

  function findCaptchaImage() {
    // 1. Direct exact Vellore VTOP selector (#captchaBlock img) + standard fallbacks
    const direct = document.querySelector('#captchaBlock img, img#captchaImg, img#captcha, img[id*="captcha" i], img[src*="captcha" i], img[alt*="captcha" i]');
    if (direct) return direct;

    // 2. Score search across all img tags
    let best = null, bestScore = 0;
    for (const img of document.querySelectorAll('img')) {
      let score = 0;
      if (looksLikeCaptcha(img)) score += 3;
      const combined = [img.id, img.className, img.alt, img.src, img.title].join(' ');
      if (CAPTCHA_KEYWORD_RE.test(combined)) score += 5;
      if ((img.src || '').startsWith('data:image')) score += 2;
      if (img.closest('#captchaBlock, .captcha-container, form')) score += 2;

      if (score > bestScore && score >= 3) {
        best = img;
        bestScore = score;
      }
    }
    return best;
  }

  function findCaptchaInput(img) {
    // 1. Direct exact Vellore VTOP selector (input#captchaStr) + fallbacks
    const direct = document.querySelector('input#captchaStr, input[name="captchaStr"], input[name="captcha" i], input[id="captcha" i], input[placeholder*="captcha" i], input[name*="captcha" i]');
    if (direct) return direct;

    // 2. Search inputs inside form
    const form = img?.closest('form') || document;
    const inputs = [...form.querySelectorAll('input')].filter(el => {
      const type = (el.type || '').toLowerCase();
      return ['text', 'search', ''].includes(type) && !el.disabled && !el.readOnly;
    });

    const named = inputs.find(el => {
      const str = [el.name, el.id, el.placeholder, el.className].join(' ');
      return CAPTCHA_KEYWORD_RE.test(str);
    });
    if (named) return named;

    // 3. First text input following the image in DOM order
    if (img) {
      return inputs.find(el => (img.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) || null;
    }
    return null;
  }

  function renderSolvedBadge(input) {
    // Visual input glow
    const origBorder = input.style.borderColor;
    const origBoxShadow = input.style.boxShadow;
    input.style.borderColor = 'var(--vtop-success-bright)';
    input.style.boxShadow = '0 0 0 3px var(--vtop-success-focus)';
    setTimeout(() => {
      input.style.borderColor = origBorder;
      input.style.boxShadow = origBoxShadow;
    }, 1500);
  }

  // ---------- Controller ----------

  let lastSolvedSrc = null;
  let isSolving = false;
  let observerAttached = false;
  let observedImg = null;
  let imgObserver = null;

  const AutoCaptcha = {
    async solve() {
      if (isSolving) return;

      // Fast exit on logged-in pages without a login form or captcha field
      if (
        !document.querySelector(
          '#captchaBlock, input#captchaStr, input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], #vtopLoginForm, #loginForm, input[type="password"]'
        )
      ) {
        return;
      }

      const img = findCaptchaImage();
      const input = findCaptchaInput(img);

      if (!img || !input) return;

      if (img !== observedImg) {
        observedImg = img;
        if (imgObserver) {
          imgObserver.disconnect();
        }
        imgObserver = new MutationObserver(() => {
          AutoCaptcha.solve();
        });
        imgObserver.observe(img, { attributes: true, attributeFilter: ['src'] });
        this.applyLoginHelpers();
      }

      const src = img.currentSrc || img.src;
      if (!src) return;

      // Wait if image is still loading
      if (!img.complete || img.naturalWidth === 0) {
        if (!img.dataset.vtopLoadWaiting) {
          img.dataset.vtopLoadWaiting = 'true';
          img.addEventListener('load', () => {
            delete img.dataset.vtopLoadWaiting;
            AutoCaptcha.solve();
          }, { once: true });
          img.addEventListener('error', () => {
            delete img.dataset.vtopLoadWaiting;
          }, { once: true });
        }
        return;
      }

      if (src === lastSolvedSrc && input.value && input.value.length === 6) {
        return;
      }

      isSolving = true;
      try {
        const solved = await solveCaptchaFromImage(img);

        if (solved && solved.length === 6) {
          input.value = solved;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          renderSolvedBadge(input, solved);
          lastSolvedSrc = src;
        }
      } catch (err) {
        console.warn('[VTOP++] Captcha solving error:', err);
      } finally {
        isSolving = false;
      }
    },

    setupObserver() {
      if (observerAttached) return;
      observerAttached = true;

      // Also listen to image load events across the document
      document.addEventListener('load', (e) => {
        if (e.target && e.target.tagName === 'IMG' && looksLikeCaptcha(e.target)) {
          AutoCaptcha.solve();
        }
      }, true);

      // Listen to click on refresh icon/button (#button-addon2[onclick="loadCaptcha()"] inside #captchaBlock)
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('#captchaBlock #button-addon2, button[onclick*="loadCaptcha"], #captchaBlock button, #captchaRefresh, [onclick*="captcha" i], .captcha-refresh, .glyphicon-refresh, .fa-refresh, #captchaBlock a, .captcha-container button, .captcha-container a');
        if (btn) {
          lastSolvedSrc = null;
          const img = findCaptchaImage();
          if (img) {
            img.addEventListener('load', () => AutoCaptcha.solve(), { once: true });
          }
          setTimeout(() => AutoCaptcha.solve(), 250);
        }
      }, true);
    },

    applyLoginHelpers() {
      // 1. Auto-select Student role ONLY if no role is currently selected
      const studentRadio = document.querySelector('input[type="radio"][value*="student" i], #userTypeStudent, #student');
      if (studentRadio && !studentRadio.checked) {
        const groupName = studentRadio.name;
        const groupRadios = groupName ? document.querySelectorAll(`input[type="radio"][name="${groupName}"]`) : [];
        const anyChecked = Array.from(groupRadios).some((r) => r.checked);
        if (!anyChecked) {
          studentRadio.checked = true;
          studentRadio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // 2. Format input
      const captchaInput = findCaptchaInput(findCaptchaImage());
      if (captchaInput) {
        captchaInput.setAttribute('maxlength', '6');
        captchaInput.setAttribute('autocomplete', 'off');
        captchaInput.setAttribute('spellcheck', 'false');
        captchaInput.style.textTransform = 'uppercase';

        if (!captchaInput.dataset.vtopHelperBound) {
          captchaInput.dataset.vtopHelperBound = 'true';
          captchaInput.addEventListener('input', () => {
            const pos = captchaInput.selectionStart;
            captchaInput.value = captchaInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            captchaInput.setSelectionRange(pos, pos);
          });
        }
      }
    },

    init() {
      this.applyLoginHelpers();
      this.setupObserver();
      this.solve();

      // Single short safety retry if image was not yet painted at boot
      setTimeout(() => this.solve(), 150);
    }
  };

  window.VTOP_PLUS.AutoCaptcha = AutoCaptcha;
})();
