/**
 * Computer Vision, Convex Quad Validator, QR Scanner & 3D Homography Engine.
 */
(function (root) {
  function solveLinearSystem(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
      }
      if (Math.abs(M[maxRow][col]) < 1e-10) return null;
      const tmp = M[col];
      M[col] = M[maxRow];
      M[maxRow] = tmp;

      const pivot = M[col][col];
      for (let j = col; j <= n; j++) M[col][j] /= pivot;

      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
      }
    }
    return M.map((row) => row[n]);
  }

  /**
   * Checks that 4 points [TL, TR, BR, BL] form a valid convex clockwise quadrilateral
   * with sufficient area so matrix3d never collapses or inverts.
   */
  function isValidConvexQuad(pts, minArea = 0.02) {
    if (!pts || pts.length !== 4) return false;
    let area2 = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const c = pts[(i + 2) % 4];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross <= 1e-5) return false; // Must be strictly clockwise in screen coords (Y down)
      area2 += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area2) * 0.5 >= minArea;
  }

  function computeHomographyMatrix3d(width, height, dstPoints) {
    if (!isValidConvexQuad(dstPoints, 200)) return null;
    const src = [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ];
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = src[i];
      const [dx, dy] = [dstPoints[i].x, dstPoints[i].y];
      A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
      b.push(dx);
      A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
      b.push(dy);
    }
    const h = solveLinearSystem(A, b);
    if (!h || h.some((v) => !isFinite(v))) return null;
    const m = [
      h[0], h[3], 0, h[6],
      h[1], h[4], 0, h[7],
      0,    0,    1, 0,
      h[2], h[5], 0, 1,
    ];
    return `matrix3d(${m.map((v) => (Math.abs(v) < 1e-14 ? 0 : Number(v.toPrecision(12)))).join(',')})`;
  }

  function detectScreenQuad(videoEl, scratchCanvas) {
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return null;
    const W = 160;
    const H = Math.max(90, Math.round((videoEl.videoHeight / videoEl.videoWidth) * W));
    if (scratchCanvas.width !== W || scratchCanvas.height !== H) {
      scratchCanvas.width = W;
      scratchCanvas.height = H;
    }
    const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(videoEl, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    const lum = new Float32Array(W * H);
    let sum = 0;
    let maxL = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      lum[p] = l;
      sum += l;
      if (l > maxL) maxL = l;
    }
    const mean = sum / (W * H);
    const threshold = Math.max(mean + (maxL - mean) * 0.48, 125);

    const mx = Math.floor(W * 0.06);
    const my = Math.floor(H * 0.06);
    let count = 0;
    let minSum = Infinity, maxSum = -Infinity;
    let minDiff = Infinity, maxDiff = -Infinity;
    let tl = null, br = null, tr = null, bl = null;

    for (let y = my; y < H - my; y++) {
      for (let x = mx; x < W - mx; x++) {
        const idx = y * W + x;
        if (lum[idx] < threshold) continue;
        count++;
        const s = x + y;
        const d = x - y;
        if (s < minSum) { minSum = s; tl = { x, y }; }
        if (s > maxSum) { maxSum = s; br = { x, y }; }
        if (d > maxDiff) { maxDiff = d; tr = { x, y }; }
        if (d < minDiff) { minDiff = d; bl = { x, y }; }
      }
    }

    const areaRatio = count / (W * H);
    if (!tl || !tr || !br || !bl || areaRatio < 0.04 || areaRatio > 0.78) {
      return { found: false, quad: null };
    }

    const quad = [
      { x: tl.x / W, y: tl.y / H },
      { x: tr.x / W, y: tr.y / H },
      { x: br.x / W, y: br.y / H },
      { x: bl.x / W, y: bl.y / H },
    ];

    if (!isValidConvexQuad(quad, 0.04)) {
      return { found: false, quad: null };
    }
    return { found: true, quad };
  }

  let nativeDetector = null;
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (_) {}
  }

  async function scanQrCode(videoEl, qrCanvas) {
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return null;

    if (nativeDetector) {
      try {
        const codes = await nativeDetector.detect(videoEl);
        for (const c of codes) {
          if (c.rawValue && c.rawValue.startsWith('STARK:')) {
            return c.rawValue.slice(6).trim().toUpperCase();
          }
        }
      } catch (_) {}
    }

    if (typeof window !== 'undefined' && typeof window.jsQR === 'function') {
      const W = 320;
      const H = Math.max(180, Math.round((videoEl.videoHeight / videoEl.videoWidth) * W));
      if (qrCanvas.width !== W || qrCanvas.height !== H) {
        qrCanvas.width = W;
        qrCanvas.height = H;
      }
      const ctx = qrCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(videoEl, 0, 0, W, H);
      const imgData = ctx.getImageData(0, 0, W, H);
      const code = window.jsQR(imgData.data, W, H, { inversionAttempts: 'dontInvert' });
      if (code && code.data && code.data.startsWith('STARK:')) {
        return code.data.slice(6).trim().toUpperCase();
      }
    }
    return null;
  }

  root.StarkVision = {
    computeHomographyMatrix3d,
    isValidConvexQuad,
    detectScreenQuad,
    scanQrCode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
