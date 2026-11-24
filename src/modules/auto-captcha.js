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
  const HIGH_CONFIDENCE_MARGIN = 3.5;
  const HIGH_CONFIDENCE_PROB = 0.9;
  const LOW_CONFIDENCE_REFRESH_THRESHOLD = 0.45;
  const GOOD_CONFIDENCE_THRESHOLD = 0.75;
  const MAX_AUTO_REFRESHES = 2;
  const REFRESH_BTN_SELECTOR =
    '#captchaBlock #button-addon2, button[onclick*="loadCaptcha"], #captchaBlock button, #captchaRefresh, [onclick*="captcha" i], .captcha-refresh, .glyphicon-refresh, .fa-refresh, #captchaBlock a, .captcha-container button, .captcha-container a';

  // Reusable offscreen canvas & context (zero re-allocation per solve)
  let offscreenCanvas = null;
  let offscreenCtx = null;
  let cachedWeights = null;

  // Pre-allocated typed buffers for zero-GC feature extraction & inference
  const satMap = new Uint8Array(VELLORE_WIDTH * VELLORE_HEIGHT);
  const invLumMap = new Uint8Array(VELLORE_WIDTH * VELLORE_HEIGHT);
  const flatBuffer = new Uint8Array(BLOCK_PIXELS);
  const binaryMask = new Uint8Array(BLOCK_PIXELS);
  const otsuHist = new Uint32Array(256);
  const logitsBuffer = new Float64Array(NUM_CLASSES);

  /**
   * Compute both saturation (primary) and inverted luminance (grayscale fallback)
   * into pre-allocated typed arrays in a single pass over RGBA pixels.
   */
  function computeFeatureMaps(rgbaData, outSat, outInvLum) {
    for (let i = 0, j = 0; i < rgbaData.length; i += 4, j++) {
      const r = rgbaData[i];
      const g = rgbaData[i + 1];
      const b = rgbaData[i + 2];
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      outSat[j] = max ? Math.round(((max - min) * 255) / max) : 0;
      outInvLum[j] = 255 - Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  /**
   * Compute Otsu's optimal binarization threshold for a 24x22 block,
   * falling back to the block mean if pixel variance is zero.
   */
  function computeOtsuThreshold(values, hist) {
    hist.fill(0);
    let totalSum = 0;
    for (let k = 0; k < BLOCK_PIXELS; k++) {
      const v = values[k];
      hist[v]++;
      totalSum += v;
    }

    let wB = 0;
    let sumB = 0;
    let maxVar = 0;
    let bestThresh = totalSum / BLOCK_PIXELS;

    for (let t = 0; t < 255; t++) {
      const count = hist[t];
      if (!count) continue;
      wB += count;
      const wF = BLOCK_PIXELS - wB;
      if (!wF) break;

      sumB += t * count;
      const mB = sumB / wB;
      const mF = (totalSum - sumB) / wF;
      const diff = mB - mF;
      const betweenVar = wB * wF * diff * diff;
      if (betweenVar > maxVar) {
        maxVar = betweenVar;
        bestThresh = t;
      }
    }

    return bestThresh;
  }

  /**
   * Binarize block into binaryMask and remove isolated 1-pixel speckles
   * (foreground pixels with zero foreground 8-neighbors).
   */
  function binarizeAndDespeckle(values, threshold, outMask) {
    for (let k = 0; k < BLOCK_PIXELS; k++) {
      outMask[k] = values[k] > threshold ? 1 : 0;
    }

    for (let y = 0; y < BLOCK_H; y++) {
      const row = y * BLOCK_W;
      const yMin = y > 0 ? y - 1 : 0;
      const yMax = y < BLOCK_H - 1 ? y + 1 : BLOCK_H - 1;
      for (let x = 0; x < BLOCK_W; x++) {
        const idx = row + x;
        if (!outMask[idx]) continue;

        const xMin = x > 0 ? x - 1 : 0;
        const xMax = x < BLOCK_W - 1 ? x + 1 : BLOCK_W - 1;
        let hasNeighbor = false;

        for (let ny = yMin; ny <= yMax && !hasNeighbor; ny++) {
          const nRow = ny * BLOCK_W;
          for (let nx = xMin; nx <= xMax; nx++) {
            if ((ny !== y || nx !== x) && outMask[nRow + nx]) {
              hasNeighbor = true;
              break;
            }
          }
        }

        if (!hasNeighbor) {
          outMask[idx] = 0;
        }
      }
    }
  }

  /**
   * Evaluate dense 528x32 linear weights on a binary mask and compute
   * top class, logit margin over runner-up, and softmax confidence.
   */
  function scoreMask(mask, W, B, logits) {
    for (let j = 0; j < NUM_CLASSES; j++) {
      logits[j] = B[j];
    }
    for (let k = 0; k < BLOCK_PIXELS; k++) {
      if (mask[k]) {
        const wRow = W[k];
        for (let j = 0; j < NUM_CLASSES; j++) {
          logits[j] += wRow[j];
        }
      }
    }

    let bestIdx = 0;
    let maxLogit = -Infinity;
    let secondLogit = -Infinity;
    for (let j = 0; j < NUM_CLASSES; j++) {
      const v = logits[j];
      if (v > maxLogit) {
        secondLogit = maxLogit;
        maxLogit = v;
        bestIdx = j;
      } else if (v > secondLogit) {
        secondLogit = v;
      }
    }

    let sumExp = 0;
    for (let j = 0; j < NUM_CLASSES; j++) {
      sumExp += Math.exp(logits[j] - maxLogit);
    }

    return {
      bestIdx,
      margin: maxLogit - secondLogit,
      confidence: 1 / sumExp
    };
  }

  /**
   * Extract a 24x22 block at (x1, y1), choose saturation or grayscale fallback,
   * binarize via Otsu + despeckle, and score against linear weights.
   */
  function evaluateCrop(x1, y1, W, B) {
    let idx = 0;
    let maxSat = 0;
    for (let y = y1; y < y1 + BLOCK_H; y++) {
      const rowOffset = y * VELLORE_WIDTH;
      for (let x = x1; x < x1 + BLOCK_W; x++) {
        const v = satMap[rowOffset + x];
        flatBuffer[idx++] = v;
        if (v > maxSat) maxSat = v;
      }
    }

    // Fallback to inverted luminance if block has virtually no color saturation
    if (maxSat < 25) {
      idx = 0;
      for (let y = y1; y < y1 + BLOCK_H; y++) {
        const rowOffset = y * VELLORE_WIDTH;
        for (let x = x1; x < x1 + BLOCK_W; x++) {
          flatBuffer[idx++] = invLumMap[rowOffset + x];
        }
      }
    }

    const threshold = computeOtsuThreshold(flatBuffer, otsuHist);
    binarizeAndDespeckle(flatBuffer, threshold, binaryMask);
    return scoreMask(binaryMask, W, B, logitsBuffer);
  }

  /**
   * Classify a single character position, rescuing slight glyph shifts
   * with a +/-1 px micro-shift search when the centered prediction is uncertain.
   */
  function classifyBlock(baseX, baseY, W, B) {
    let best = evaluateCrop(baseX, baseY, W, B);
    if (best.margin >= HIGH_CONFIDENCE_MARGIN && best.confidence >= HIGH_CONFIDENCE_PROB) {
      return best;
    }

    for (let dy = -1; dy <= 1; dy++) {
      const sy = Math.max(0, Math.min(VELLORE_HEIGHT - BLOCK_H, baseY + dy));
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const sx = Math.max(0, Math.min(VELLORE_WIDTH - BLOCK_W, baseX + dx));
        const candidate = evaluateCrop(sx, sy, W, B);
        if (
          candidate.margin > best.margin ||
          (candidate.margin === best.margin && candidate.confidence > best.confidence)
        ) {
          best = candidate;
        }
      }
    }

    return best;
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
   * Computes saturation + luminance maps on a 200x40 offscreen canvas,
   * applies Otsu thresholding + despeckling, micro-shift alignment rescue,
   * and returns the solved text with per-character softmax confidence.
   */
  async function solveCaptchaFromImage(img) {
    const weights = await getVelloreWeights();
    if (!weights?.weights || !weights?.biases) return null;

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
      return null;
    }

    computeFeatureMaps(imgData.data, satMap, invLumMap);

    const W = weights.weights; // 528 x 32
    const B = weights.biases;  // 32
    let solvedText = '';
    let minConfidence = 1;
    let sumConfidence = 0;

    for (let a = 0; a < 6; a++) {
      const x1 = (a + 1) * 25 + 2;
      const y1 = 7 + 5 * (a % 2) + 1;
      const result = classifyBlock(x1, y1, W, B);

      solvedText += VELLORE_LABELS[result.bestIdx];
      if (result.confidence < minConfidence) minConfidence = result.confidence;
      sumConfidence += result.confidence;
    }

    return {
      text: solvedText,
      minConfidence,
      avgConfidence: sumConfidence / 6
    };
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

  let badgeResetTimer = null;

  function renderSolvedBadge(input, result) {
    if (badgeResetTimer) {
      clearTimeout(badgeResetTimer);
      badgeResetTimer = null;
    }

    const minConf = result?.minConfidence ?? 1;
    const isHighConf = minConf >= GOOD_CONFIDENCE_THRESHOLD;
    input.dataset.vtopCaptchaConfidence = String(Math.round(minConf * 100));

    if (!('vtopOrigBorder' in input.dataset)) {
      input.dataset.vtopOrigBorder = input.style.borderColor || '';
      input.dataset.vtopOrigBoxShadow = input.style.boxShadow || '';
    }

    input.style.borderColor = isHighConf ? 'var(--vtop-success-bright)' : 'var(--vtop-warn-bright)';
    input.style.boxShadow = isHighConf
      ? '0 0 0 3px var(--vtop-success-focus)'
      : '0 0 0 3px var(--vtop-warn-bg-soft)';

    badgeResetTimer = setTimeout(() => {
      input.style.borderColor = input.dataset.vtopOrigBorder || '';
      input.style.boxShadow = input.dataset.vtopOrigBoxShadow || '';
      badgeResetTimer = null;
    }, 1500);
  }

  // ---------- Controller ----------

  let lastSolvedSrc = null;
  let lastAttemptedRefreshSrc = null;
  let autoRefreshCount = 0;
  let isAutoRefreshing = false;
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
        autoRefreshCount = 0;
        lastAttemptedRefreshSrc = null;
        if (imgObserver) {
          imgObserver.disconnect();
        }
        imgObserver = new MutationObserver(() => {
          lastSolvedSrc = null;
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
        const result = await solveCaptchaFromImage(img);

        if (result && result.text.length === 6) {
          if (
            result.minConfidence < LOW_CONFIDENCE_REFRESH_THRESHOLD &&
            autoRefreshCount < MAX_AUTO_REFRESHES &&
            src !== lastAttemptedRefreshSrc
          ) {
            const refreshBtn = document.querySelector(REFRESH_BTN_SELECTOR);
            if (refreshBtn) {
              autoRefreshCount++;
              lastAttemptedRefreshSrc = src;
              lastSolvedSrc = null;
              isAutoRefreshing = true;
              try {
                refreshBtn.click();
              } finally {
                isAutoRefreshing = false;
              }
              return;
            }
          }

          input.value = result.text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          renderSolvedBadge(input, result);
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
        const btn = e.target.closest(REFRESH_BTN_SELECTOR);
        if (btn) {
          if (!isAutoRefreshing) {
            autoRefreshCount = 0;
            lastAttemptedRefreshSrc = null;
          }
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
            const raw = captchaInput.value;
            const sanitized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (sanitized !== raw) {
              const pos = captchaInput.selectionStart;
              captchaInput.value = sanitized;
              if (document.activeElement === captchaInput && typeof pos === 'number') {
                const nextPos = Math.min(pos, sanitized.length);
                captchaInput.setSelectionRange(nextPos, nextPos);
              }
            }
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
