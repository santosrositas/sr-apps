/**
 * High-Precision Optical Monitor/Screen Detector & Long-Range QR Beacon Scanner.
 * - Uses 200px thin-bezel local-trough + dark-barrier segmentation so even modern
 *   "frameless" monitors with 2-3px side bezels in bright offices lock cleanly
 *   while rejecting white walls, desks, and ceiling glare.
 * - Native BarcodeDetector + ROI-zoomed high-res jsQR fallback for long-range QR pairing.
 */
(function (root) {
  function detectMonitors(videoEl, scratchCanvas, focusPoint) {
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) {
      return { best: null, candidates: [] };
    }

    const W = 200;
    const H = Math.max(112, Math.round((videoEl.videoHeight / videoEl.videoWidth) * W));
    if (scratchCanvas.width !== W || scratchCanvas.height !== H) {
      scratchCanvas.width = W;
      scratchCanvas.height = H;
    }

    const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(videoEl, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    return detectMonitorsFromRgba(data, W, H, focusPoint);
  }

  function detectMonitorsFromRgba(data, W, H, focusPoint) {
    const N = W * H;
    const lum = new Uint8Array(N);
    let sum = 0;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const l = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8;
      lum[p] = l;
      sum += l;
    }
    const mean = sum / N;
    const darkThr = Math.max(60, Math.min(108, Math.round(mean * 0.68)));
    const rawBarrier = new Uint8Array(N);

    for (let y = 2; y < H - 2; y++) {
      const row = y * W;
      for (let x = 2; x < W - 2; x++) {
        const idx = row + x;
        const l = lum[idx];
        if (l <= darkThr) {
          rawBarrier[idx] = 1;
          continue;
        }
        // Thin-bezel trough detector: seals 2-3px modern frameless bezels even in bright rooms
        const hDrop = Math.min(lum[idx - 2], lum[idx + 2]) - l;
        const vDrop = Math.min(lum[idx - 2 * W], lum[idx + 2 * W]) - l;
        const gx = Math.abs(lum[idx + 1] - lum[idx - 1]);
        const gy = Math.abs(lum[idx + W] - lum[idx - W]);
        if (hDrop > 28 || vDrop > 28 || ((gx + gy) > 65 && l < darkThr + 55)) {
          rawBarrier[idx] = 1;
        }
      }
    }

    // 1px dilation seals tiny glare gaps along thin bezels
    const barrier = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        const idx = row + x;
        if (
          rawBarrier[idx] ||
          rawBarrier[idx - 1] || rawBarrier[idx + 1] ||
          rawBarrier[idx - W] || rawBarrier[idx + W]
        ) {
          barrier[idx] = 1;
        }
      }
    }

    const visited = new Uint8Array(N);
    const queue = new Int32Array(N);
    const candidates = [];
    const fx = focusPoint ? focusPoint.x : 0.5;
    const fy = focusPoint ? focusPoint.y : 0.46;

    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const start = y * W + x;
        if (barrier[start] || visited[start]) continue;

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
        let topTouch = false, botTouch = false, leftTouch = false, rightTouch = false;

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

          if (cx <= 2) leftTouch = true;
          if (cx >= W - 3) rightTouch = true;
          if (cy <= 2) topTouch = true;
          if (cy >= H - 3) botTouch = true;

          const s = cx + cy;
          const d = cx - cy;
          if (s < minSum) { minSum = s; tlX = cx; tlY = cy; }
          if (s > maxSum) { maxSum = s; brX = cx; brY = cy; }
          if (d > maxDiff) { maxDiff = d; trX = cx; trY = cy; }
          if (d < minDiff) { minDiff = d; blX = cx; blY = cy; }

          if (cx > 1 && !barrier[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; queue[tail++] = idx - 1; }
          if (cx < W - 2 && !barrier[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; queue[tail++] = idx + 1; }
          if (cy > 1 && !barrier[idx - W] && !visited[idx - W]) { visited[idx - W] = 1; queue[tail++] = idx - W; }
          if (cy < H - 2 && !barrier[idx + W] && !visited[idx + W]) { visited[idx + W] = 1; queue[tail++] = idx + W; }
        }

        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const bboxArea = bw * bh;
        const areaRatio = bboxArea / N;

        if (areaRatio < 0.035 || areaRatio > 0.88) continue;
        if (bw < 28 || bh < 18) continue;

        const fillRatio = count / bboxArea;
        if (fillRatio < 0.55) continue;

        const aspect = bw / bh;
        if (aspect < 0.45 || aspect > 2.75) continue;

        // Reject bright walls/desks bleeding out of top or bottom frame edges
        if (topTouch || botTouch) continue;
        if (leftTouch && rightTouch) continue;

        // Verify dark bezel surrounds the 4 sides
        const pad = 2;
        const bx0 = Math.max(0, minX - pad);
        const bx1 = Math.min(W - 1, maxX + pad);
        const by0 = Math.max(0, minY - pad);
        const by1 = Math.min(H - 1, maxY + pad);
        let bezelHits = 0;
        let bezelChecks = 0;
        for (let sx = bx0; sx <= bx1; sx += 2) {
          if (barrier[by0 * W + sx]) bezelHits++;
          if (barrier[by1 * W + sx]) bezelHits++;
          bezelChecks += 2;
        }
        for (let sy = by0; sy <= by1; sy += 2) {
          if (barrier[sy * W + bx0]) bezelHits++;
          if (barrier[sy * W + bx1]) bezelHits++;
          bezelChecks += 2;
        }
        const bezelCoverage = bezelChecks > 0 ? bezelHits / bezelChecks : 0;
        if (bezelCoverage < 0.5) continue;

        const innerAvg = lumSum / count;
        if (innerAvg < darkThr + 16) continue;

        const cxNorm = (minX + maxX) / (2 * W);
        const cyNorm = (minY + maxY) / (2 * H);
        const dist = Math.hypot(cxNorm - fx, cyNorm - fy);
        const centerBonus = Math.max(0, 1 - dist * 1.35);
        const aspectBonus = (aspect >= 1.2 && aspect <= 2.2) ? 0.24 : 0.1;
        const enclosureBonus = (!leftTouch && !rightTouch) ? 0.25 : 0.05;
        const sizeBonus = Math.min(0.32, areaRatio * 1.15);

        const score =
          fillRatio * 0.32 +
          bezelCoverage * 0.30 +
          centerBonus * 0.26 +
          aspectBonus +
          enclosureBonus +
          sizeBonus;

        const padX = 1 / W;
        const padY = 1 / H;
        const quad = [
          { x: Math.max(0, (tlX * 0.45 + minX * 0.55) / W - padX), y: Math.max(0, (tlY * 0.45 + minY * 0.55) / H - padY) },
          { x: Math.min(1, (trX * 0.45 + maxX * 0.55) / W + padX), y: Math.max(0, (trY * 0.45 + minY * 0.55) / H - padY) },
          { x: Math.min(1, (brX * 0.45 + maxX * 0.55) / W + padX), y: Math.min(1, (brY * 0.45 + maxY * 0.55) / H + padY) },
          { x: Math.max(0, (blX * 0.45 + minX * 0.55) / W - padX), y: Math.min(1, (blY * 0.45 + maxY * 0.55) / H + padY) },
        ];

        candidates.push({
          bbox: { x: minX / W, y: minY / H, w: bw / W, h: bh / H },
          quad,
          aspect,
          fillRatio,
          bezelCoverage,
          confidence: Math.min(0.99, Math.max(0.62, score * 0.72)),
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

  async function scanQrBeacon(videoEl, qrCanvas, roiBbox) {
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return null;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;

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

    if (typeof window !== 'undefined' && typeof window.jsQR === 'function') {
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (roiBbox) {
        const padX = roiBbox.w * 0.14;
        const padY = roiBbox.h * 0.14;
        sx = Math.max(0, Math.floor((roiBbox.x - padX) * vw));
        sy = Math.max(0, Math.floor((roiBbox.y - padY) * vh));
        sw = Math.min(vw - sx, Math.ceil((roiBbox.w + padX * 2) * vw));
        sh = Math.min(vh - sy, Math.ceil((roiBbox.h + padY * 2) * vh));
      } else {
        sx = Math.floor(vw * 0.1);
        sy = Math.floor(vh * 0.1);
        sw = Math.floor(vw * 0.8);
        sh = Math.floor(vh * 0.8);
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
    detectMonitorsFromRgba,
    smoothQuad,
    mapVideoNormToCanvas,
    scanQrBeacon,
    parseStarkQrPayload,
  };
})(typeof window !== 'undefined' ? window : globalThis);
