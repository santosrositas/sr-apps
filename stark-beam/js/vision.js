/**
 * High-Precision Optical Monitor/Screen Detector & Long-Range QR Beacon Scanner.
 * - Stage 1: Connected-Component Labeling (CCL) on adaptive luminous regions,
 *   scored by rectangular fill ratio, monitor aspect ratio, bezel contrast, and center proximity.
 * - Stage 2: Native BarcodeDetector + ROI-zoomed high-res jsQR fallback (works from 2-3m+ on iOS & Android).
 */
(function (root) {
  /**
   * Detects lit monitors, TVs, laptops, or tablet screens in a video frame using
   * connected-component labeling + rectangularity + bezel contrast scoring.
   * Returns normalized coordinates in [0..1] relative to the video frame.
   */
  function detectMonitors(videoEl, scratchCanvas, focusPoint) {
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) {
      return { best: null, candidates: [] };
    }

    const W = 160;
    const H = Math.max(90, Math.round((videoEl.videoHeight / videoEl.videoWidth) * W));
    if (scratchCanvas.width !== W || scratchCanvas.height !== H) {
      scratchCanvas.width = W;
      scratchCanvas.height = H;
    }

    const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(videoEl, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    const N = W * H;
    const lum = new Uint8Array(N);
    const hist = new Uint32Array(256);
    let sum = 0;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const l = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8;
      lum[p] = l;
      hist[l]++;
      sum += l;
    }

    const mean = sum / N;
    // Compute 78th percentile luminance for adaptive threshold across dark/bright rooms
    let acc = 0;
    let p78 = 140;
    const target78 = N * 0.78;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target78) {
        p78 = v;
        break;
      }
    }
    const threshold = Math.max(85, Math.min(220, Math.round(Math.max(p78, mean + 26))));

    // Binary mask of bright screen-like pixels
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (lum[i] >= threshold) mask[i] = 1;
    }

    // BFS Connected Component Labeling (4-connected, fast & zero recursion overflow)
    const visited = new Uint8Array(N);
    const queue = new Int32Array(N);
    const candidates = [];

    const fx = focusPoint ? focusPoint.x : 0.5;
    const fy = focusPoint ? focusPoint.y : 0.45;

    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const start = y * W + x;
        if (!mask[start] || visited[start]) continue;

        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        visited[start] = 1;

        let count = 0;
        let minX = x, maxX = x, minY = y, maxY = y;
        let minSum = x + y, maxSum = x + y;
        let minDiff = x - y, maxDiff = x - y;
        let tlX = x, tlY = y, brX = x, brY = y, trX = x, trY = y, blX = x, blY = y;
        let lumSum = 0;

        while (head < tail) {
          const idx = queue[head++];
          const cy = (idx / W) | 0;
          const cx = idx - cy * W;

          count++;
          lumSum += lum[idx];
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const s = cx + cy;
          const d = cx - cy;
          if (s < minSum) { minSum = s; tlX = cx; tlY = cy; }
          if (s > maxSum) { maxSum = s; brX = cx; brY = cy; }
          if (d > maxDiff) { maxDiff = d; trX = cx; trY = cy; }
          if (d < minDiff) { minDiff = d; blX = cx; blY = cy; }

          // 4 neighbors
          if (cx > 1) {
            const n = idx - 1;
            if (mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
          if (cx < W - 2) {
            const n = idx + 1;
            if (mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
          if (cy > 1) {
            const n = idx - W;
            if (mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
          if (cy < H - 2) {
            const n = idx + W;
            if (mask[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
        }

        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const bboxArea = bw * bh;
        const areaRatio = bboxArea / N;

        // Filter out tiny glare spots and full-frame bright walls
        if (areaRatio < 0.025 || areaRatio > 0.86) continue;
        if (bw < 18 || bh < 12) continue;

        const fillRatio = count / bboxArea;
        if (fillRatio < 0.44) continue; // Reject non-rectangular shapes

        const aspect = bw / bh;
        if (aspect < 0.42 || aspect > 2.85) continue;

        // Measure bezel contrast (outer ring 3px outside bbox should be darker than screen interior)
        const innerAvg = lumSum / count;
        let borderSum = 0;
        let borderCnt = 0;
        const pad = 3;
        const bx0 = Math.max(0, minX - pad);
        const bx1 = Math.min(W - 1, maxX + pad);
        const by0 = Math.max(0, minY - pad);
        const by1 = Math.min(H - 1, maxY + pad);

        for (let sx = bx0; sx <= bx1; sx += 2) {
          borderSum += lum[by0 * W + sx] + lum[by1 * W + sx];
          borderCnt += 2;
        }
        for (let sy = by0; sy <= by1; sy += 2) {
          borderSum += lum[sy * W + bx0] + lum[sy * W + bx1];
          borderCnt += 2;
        }
        const borderAvg = borderCnt > 0 ? borderSum / borderCnt : mean;
        const contrast = Math.max(0, (innerAvg - borderAvg) / 255);
        if (contrast < 0.09) continue; // Reject flat walls without bezel drop-off

        // Score candidate: favor rectangularity, bezel contrast, good size, and proximity to focus/center
        const cxNorm = (minX + maxX) / (2 * W);
        const cyNorm = (minY + maxY) / (2 * H);
        const dist = Math.hypot(cxNorm - fx, cyNorm - fy);
        const centerBonus = Math.max(0, 1 - dist * 1.4);
        const aspectBonus = (aspect >= 1.15 && aspect <= 2.15) ? 0.22 : 0.08;
        const sizeBonus = Math.min(0.3, areaRatio * 1.2);
        const score = fillRatio * 0.35 + contrast * 0.45 + centerBonus * 0.28 + aspectBonus + sizeBonus;

        // Blend axis-aligned bbox with extreme corners slightly for clean perspective silhouette
        const quad = [
          { x: (tlX * 0.65 + minX * 0.35) / W, y: (tlY * 0.65 + minY * 0.35) / H },
          { x: (trX * 0.65 + maxX * 0.35) / W, y: (trY * 0.65 + minY * 0.35) / H },
          { x: (brX * 0.65 + maxX * 0.35) / W, y: (brY * 0.65 + maxY * 0.35) / H },
          { x: (blX * 0.65 + minX * 0.35) / W, y: (blY * 0.65 + maxY * 0.35) / H },
        ];

        candidates.push({
          bbox: { x: minX / W, y: minY / H, w: bw / W, h: bh / H },
          quad,
          aspect,
          fillRatio,
          contrast,
          confidence: Math.min(0.99, Math.max(0.55, score)),
          score,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return { best: candidates[0] || null, candidates: candidates.slice(0, 3) };
  }

  function smoothQuad(prev, next, alpha = 0.28) {
    if (!prev) return next.map((p) => ({ x: p.x, y: p.y }));
    return prev.map((p, i) => ({
      x: p.x + (next[i].x - p.x) * alpha,
      y: p.y + (next[i].y - p.y) * alpha,
    }));
  }

  /**
   * Maps video-normalized coordinates [0..1] to screen/canvas pixel coordinates
   * accounting for CSS `object-fit: cover` cropping so the HUD box hugs the real monitor accurately!
   */
  function mapVideoNormToCanvas(normPt, videoEl, canvasW, canvasH) {
    const vw = videoEl.videoWidth || canvasW;
    const vh = videoEl.videoHeight || canvasH;
    const scale = Math.max(canvasW / vw, canvasH / vh);
    const drawnW = vw * scale;
    const drawnH = vh * scale;
    const offX = (canvasW - drawnW) * 0.5;
    const offY = (canvasH - drawnH) * 0.5;
    return {
      x: offX + normPt.x * drawnW,
      y: offY + normPt.y * drawnH,
    };
  }

  function parseStarkQrPayload(raw) {
    if (!raw) return null;
    const txt = String(raw).trim().toUpperCase();
    if (txt.startsWith('SB:')) return txt.slice(3).replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (txt.startsWith('STARK:')) return txt.slice(6).replace(/[^A-Z0-9]/g, '').slice(0, 6);
    return null;
  }

  let nativeDetector = null;
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (_) {}
  }

  /**
   * High-range QR Beacon scanner.
   * Uses native BarcodeDetector first, then high-resolution ROI-cropped jsQR
   * (zooming directly into the detected monitor bbox so QR codes are readable from 2-3m+).
   */
  async function scanQrBeacon(videoEl, qrCanvas, roiBbox) {
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return null;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;

    // 1. Native BarcodeDetector (full video resolution, hardware accelerated)
    if (nativeDetector) {
      try {
        const codes = await nativeDetector.detect(videoEl);
        for (const c of codes) {
          const parsed = parseStarkQrPayload(c.rawValue);
          if (parsed) {
            const quad = (c.cornerPoints && c.cornerPoints.length === 4)
              ? c.cornerPoints.map((pt) => ({ x: pt.x / vw, y: pt.y / vh }))
              : null;
            return { code: parsed, quad };
          }
        }
      } catch (_) {}
    }

    // 2. ROI-zoomed high-res jsQR (works on iPhone Safari + all browsers!)
    if (typeof window !== 'undefined' && typeof window.jsQR === 'function') {
      // Crop around detected monitor ROI (with 12% margin) or center 72% of frame
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (roiBbox) {
        const padX = roiBbox.w * 0.14;
        const padY = roiBbox.h * 0.14;
        sx = Math.max(0, Math.floor((roiBbox.x - padX) * vw));
        sy = Math.max(0, Math.floor((roiBbox.y - padY) * vh));
        sw = Math.min(vw - sx, Math.ceil((roiBbox.w + padX * 2) * vw));
        sh = Math.min(vh - sy, Math.ceil((roiBbox.h + padY * 2) * vh));
      } else {
        sx = Math.floor(vw * 0.12);
        sy = Math.floor(vh * 0.12);
        sw = Math.floor(vw * 0.76);
        sh = Math.floor(vh * 0.76);
      }

      const targetW = Math.min(640, sw);
      const targetH = Math.max(120, Math.round((sh / sw) * targetW));
      if (qrCanvas.width !== targetW || qrCanvas.height !== targetH) {
        qrCanvas.width = targetW;
        qrCanvas.height = targetH;
      }

      const ctx = qrCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, targetW, targetH);
      const imgData = ctx.getImageData(0, 0, targetW, targetH);
      const hit = window.jsQR(imgData.data, targetW, targetH, { inversionAttempts: 'attemptBoth' });
      if (hit) {
        const parsed = parseStarkQrPayload(hit.data);
        if (parsed) {
          const loc = hit.location;
          const mapPt = (pt) => ({
            x: (sx + (pt.x / targetW) * sw) / vw,
            y: (sy + (pt.y / targetH) * sh) / vh,
          });
          return {
            code: parsed,
            quad: [
              mapPt(loc.topLeftCorner),
              mapPt(loc.topRightCorner),
              mapPt(loc.bottomRightCorner),
              mapPt(loc.bottomLeftCorner),
            ],
          };
        }
      }
    }

    return null;
  }

  root.StarkVision = {
    detectMonitors,
    smoothQuad,
    mapVideoNormToCanvas,
    scanQrBeacon,
    parseStarkQrPayload,
  };
})(typeof window !== 'undefined' ? window : globalThis);
