(function () {
  const cameraVideo = document.getElementById('cameraVideo');
  const cameraFallback = document.getElementById('cameraFallback');
  const retryCamBtn = document.getElementById('retryCamBtn');
  const flipCamBtn = document.getElementById('flipCamBtn');
  const hudCanvas = document.getElementById('hudCanvas');
  const hudCtx = hudCanvas.getContext('2d');
  const connDot = document.getElementById('connDot');

  const modeArBtn = document.getElementById('modeArBtn');
  const modeP2pBtn = document.getElementById('modeP2pBtn');
  const p2pBar = document.getElementById('p2pBar');
  const codeInput = document.getElementById('codeInput');
  const connectCodeBtn = document.getElementById('connectCodeBtn');
  const shareTvBtn = document.getElementById('shareTvBtn');

  const fileInput = document.getElementById('fileInput');
  const fileNameEl = document.getElementById('fileName');
  const fileHintEl = document.getElementById('fileHint');
  const flickZone = document.getElementById('flickZone');
  const beamBtn = document.getElementById('beamBtn');
  const arPinBtn = document.getElementById('arPinBtn');
  const restoreBtn = document.getElementById('restoreBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar = document.getElementById('progressBar');

  const remoteBar = document.getElementById('remoteBar');
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const seekSlider = document.getElementById('seekSlider');
  const timeReadout = document.getElementById('timeReadout');
  const volSlider = document.getElementById('volSlider');
  const muteBtn = document.getElementById('muteBtn');
  const toastEl = document.getElementById('toast');

  // AR elements
  const arStage = document.getElementById('arStage');
  const arPlane = document.getElementById('arPlane');
  const arImg = document.getElementById('arImg');
  const arVideo = document.getElementById('arVideo');
  const arAudioOverlay = document.getElementById('arAudioOverlay');
  const arAudioName = document.getElementById('arAudioName');
  const arAudioEl = document.getElementById('arAudioEl');
  const arHandles = Array.from(document.querySelectorAll('.ar-handle'));

  let mode = 'ar'; // 'ar' | 'p2p'
  let facingMode = 'environment';
  let currentStream = null;
  let selectedFile = null;
  let selectedObjectUrl = null;

  // P2P state
  let peer = null;
  let conn = null;
  let connectedCode = null;
  let connectingCode = null;
  let qrScanBusy = false;
  let lastQrCode = null;
  let lastQrAt = 0;

  // Vision & AR state
  const scratchCanvas = document.createElement('canvas');
  const qrCanvas = document.createElement('canvas');
  let detectedQuad = null;
  let wasLocked = false;
  let arActive = false;
  let arManualPin = false;
  let arCorners = [
    { x: 0.14, y: 0.22 },
    { x: 0.86, y: 0.22 },
    { x: 0.86, y: 0.62 },
    { x: 0.14, y: 0.62 },
  ];
  let dragIdx = -1;

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // Camera
  async function startCamera() {
    cameraFallback.classList.remove('show');
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      currentStream = stream;
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
    } catch (_) {
      cameraFallback.classList.add('show');
    }
  }

  retryCamBtn.addEventListener('click', startCamera);
  flipCamBtn.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
  });

  // PeerJS P2P initialization (lazy on first P2P action)
  function ensurePeer() {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        return reject(new Error('Motor P2P cargando o sin internet'));
      }
      if (peer && !peer.destroyed && peer.open) return resolve(peer);
      if (peer && !peer.destroyed) {
        peer.once('open', () => resolve(peer));
        peer.once('error', reject);
        return;
      }
      peer = new window.Peer({ debug: 0 });
      peer.once('open', () => resolve(peer));
      peer.on('error', (err) => {
        showToast('P2P: ' + (err.type === 'peer-unavailable' ? 'CÓDIGO DE TV NO ENCONTRADO' : err.message));
        connDot.className = 'status-dot';
        connectingCode = null;
      });
    });
  }

  async function connectToScreenCode(rawCode) {
    const code = window.StarkP2P.normalizeCode(rawCode);
    if (code.length < 4) {
      showToast('INGRESA EL CÓDIGO DE 4 CARACTERES DE LA TV');
      return;
    }
    if (connectedCode === code && conn && conn.open) {
      showToast(`YA ENLAZADO CON TV ${code}`);
      return;
    }
    if (connectingCode === code) return;
    connectingCode = code;
    codeInput.value = code;
    showToast(`ENLAZANDO CON PANTALLA ${code}...`);

    try {
      const p = await ensurePeer();
      if (conn) {
        try { conn.close(); } catch (_) {}
      }
      const targetPeerId = window.StarkP2P.peerIdForCode(code);
      const nextConn = p.connect(targetPeerId, { reliable: true });
      conn = nextConn;

      nextConn.on('open', () => {
        connectedCode = code;
        connectingCode = null;
        connDot.className = 'status-dot online';
        if (window.StarkAudio) window.StarkAudio.playLock();
        showToast(`OBJETIVO FIJADO // TV ${code} CONECTADA`);
      });

      nextConn.on('data', (msg) => {
        if (msg && msg.type === 'playback_state' && msg.duration > 0) {
          seekSlider.max = String(Math.floor(msg.duration));
          seekSlider.value = String(Math.floor(msg.currentTime || 0));
          timeReadout.textContent = formatTime(msg.currentTime || 0);
        }
      });

      nextConn.on('close', () => {
        if (conn === nextConn) {
          connectedCode = null;
          connectingCode = null;
          connDot.className = 'status-dot';
          remoteBar.classList.remove('show');
          showToast('DESCONECTADO DE LA PANTALLA');
        }
      });
    } catch (err) {
      connectingCode = null;
      showToast(err.message || 'ERROR DE CONEXIÓN P2P');
    }
  }

  connectCodeBtn.addEventListener('click', () => connectToScreenCode(codeInput.value));
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectToScreenCode(codeInput.value);
  });

  shareTvBtn.addEventListener('click', async () => {
    const tvUrl = new URL('./receiver.html', window.location.href).href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'STARK BEAM — Pantalla Receptora',
          text: 'Abre este enlace en la TV o monitor para enlazarlo con STARK BEAM:',
          url: tvUrl,
        });
        return;
      } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(tvUrl);
      showToast('LINK DE TV COPIADO AL PORTAPAPELES');
    } catch (_) {
      prompt('Abre este enlace en la TV o monitor:', tvUrl);
    }
  });

  // Mode Switch
  function setMode(nextMode) {
    mode = nextMode;
    modeArBtn.classList.toggle('active', mode === 'ar');
    modeP2pBtn.classList.toggle('active', mode === 'p2p');
    p2pBar.classList.toggle('show', mode === 'p2p');
    arPinBtn.style.display = mode === 'ar' ? 'inline-flex' : 'none';

    if (mode === 'p2p') {
      stopArProjection();
      connDot.className = connectedCode ? 'status-dot online' : 'status-dot';
      beamBtn.textContent = '▲ TRANSMITIR A TV';
      showToast('APUNTA AL QR DE LA TV O INGRESA SU CÓDIGO');
    } else {
      remoteBar.classList.remove('show');
      connDot.className = 'status-dot locked';
      beamBtn.textContent = '▲ OVERRIDE / PROYECTAR';
      showToast('MODO AR: APUNTA A CUALQUIER MONITOR Y PROYECTA');
    }
  }

  modeArBtn.addEventListener('click', () => setMode('ar'));
  modeP2pBtn.addEventListener('click', () => setMode('p2p'));

  // File Picker
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    selectedFile = file;
    if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
    selectedObjectUrl = URL.createObjectURL(file);

    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const kind = window.StarkP2P.getFileKind(file.name, file.type).toUpperCase();
    fileNameEl.textContent = `${file.name} (${mb} MB)`;
    fileHintEl.textContent = `LISTO [${kind}] • DESLIZA HACIA ARRIBA ↑ PARA LANZAR`;
    flickZone.classList.add('ready');
    if (window.StarkAudio) window.StarkAudio.playLock();
  });

  // Execute Beam (AR or WebRTC P2P)
  async function executeBeam() {
    if (!selectedFile) {
      showToast('SELECCIONA UN JPEG, MP3, MP4 O MOV PRIMERO');
      fileInput.click();
      return;
    }

    if (window.StarkAudio) window.StarkAudio.playBeam();

    if (mode === 'ar') {
      startArProjection();
      return;
    }

    if (!conn || !conn.open) {
      if (codeInput.value.trim().length >= 4) {
        await connectToScreenCode(codeInput.value);
      } else {
        showToast('APUNTA AL QR DE LA TV O ESCRIBE SU CÓDIGO ARRIBA');
      }
      return;
    }

    beamBtn.disabled = true;
    progressWrap.classList.add('show');
    progressBar.style.width = '2%';
    try {
      await window.StarkP2P.sendFileP2P(conn, selectedFile, (pct) => {
        progressBar.style.width = pct + '%';
        beamBtn.textContent = `ENVIANDO ${pct}%`;
      });
      remoteBar.classList.add('show');
      showToast(`SEÑAL INYECTADA EN TV ${connectedCode}`);
    } catch (err) {
      showToast(err.message || 'ERROR EN TRANSMISIÓN P2P');
    } finally {
      beamBtn.disabled = false;
      beamBtn.textContent = '▲ TRANSMITIR A TV';
      setTimeout(() => progressWrap.classList.remove('show'), 600);
    }
  }

  beamBtn.addEventListener('click', executeBeam);

  // Iron Man 2 Flick-Up Gesture
  let touchStartY = null;
  flickZone.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
    touchStartY = e.clientY;
    flickZone.setPointerCapture(e.pointerId);
  });
  flickZone.addEventListener('pointermove', (e) => {
    if (touchStartY === null) return;
    const dy = Math.min(0, e.clientY - touchStartY);
    flickZone.style.transform = `translateY(${Math.max(-64, dy)}px)`;
  });
  flickZone.addEventListener('pointerup', (e) => {
    if (touchStartY === null) return;
    const dy = e.clientY - touchStartY;
    touchStartY = null;
    flickZone.style.transform = '';
    if (dy < -38) executeBeam();
  });

  // AR 3D Projection
  function startArProjection() {
    if (!selectedFile || !selectedObjectUrl) return;
    const kind = window.StarkP2P.getFileKind(selectedFile.name, selectedFile.type);
    if (detectedQuad && !arManualPin) {
      arCorners = detectedQuad.map((p) => ({ x: p.x, y: p.y }));
    }
    arActive = true;
    arStage.classList.add('active');
    arImg.style.display = 'none';
    arVideo.style.display = 'none';
    arAudioOverlay.style.display = 'none';
    arVideo.pause();
    arAudioEl.pause();

    if (kind === 'image') {
      arImg.src = selectedObjectUrl;
      arImg.style.display = 'block';
    } else if (kind === 'audio') {
      arAudioOverlay.style.display = 'flex';
      arAudioName.textContent = selectedFile.name;
      arAudioEl.src = selectedObjectUrl;
      arAudioEl.play().catch(() => {});
    } else {
      arVideo.src = selectedObjectUrl;
      arVideo.style.display = 'block';
      arVideo.muted = false;
      arVideo.play().catch(() => {
        arVideo.muted = true;
        arVideo.play().catch(() => {});
      });
    }

    arPlane.classList.add('glitch-active');
    setTimeout(() => arPlane.classList.remove('glitch-active'), 820);
    updateArTransform();
    showToast('AR ACTIVO // TOCA "ESQUINAS" PARA AJUSTE MANUAL');
  }

  function stopArProjection() {
    arActive = false;
    arStage.classList.remove('active');
    arVideo.pause();
    arAudioEl.pause();
    arHandles.forEach((h) => h.classList.remove('visible'));
  }

  arPinBtn.addEventListener('click', () => {
    arManualPin = !arManualPin;
    arPinBtn.textContent = arManualPin ? 'AUTO' : 'ESQUINAS';
    arHandles.forEach((h) => h.classList.toggle('visible', arManualPin));
    if (arManualPin && !arActive) {
      arStage.classList.add('active');
      updateArTransform();
    }
    showToast(arManualPin ? 'ARRASTRA LOS 4 PUNTOS ÁMBAR A LAS ESQUINAS DEL MONITOR' : 'DETECCIÓN AUTOMÁTICA ACTIVA');
  });

  arHandles.forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      dragIdx = Number(handle.dataset.idx);
      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    handle.addEventListener('pointermove', (e) => {
      if (dragIdx !== Number(handle.dataset.idx)) return;
      arCorners[dragIdx] = {
        x: Math.max(0.02, Math.min(0.98, e.clientX / window.innerWidth)),
        y: Math.max(0.02, Math.min(0.98, e.clientY / window.innerHeight)),
      };
      updateArTransform();
    });
    handle.addEventListener('pointerup', () => { dragIdx = -1; });
  });

  function updateArTransform() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const pts = arCorners.map((p) => ({ x: p.x * W, y: p.y * H }));
    const matrix = window.StarkVision.computeHomographyMatrix3d(640, 360, pts);
    if (matrix) arPlane.style.transform = matrix;
    arHandles.forEach((h, i) => {
      h.style.left = pts[i].x + 'px';
      h.style.top = pts[i].y + 'px';
    });
  }

  // Remote Controls
  function sendControl(action, value) {
    if (conn && conn.open) {
      conn.send({ type: 'control', action, value });
    }
  }

  restoreBtn.addEventListener('click', () => {
    if (mode === 'ar') {
      stopArProjection();
      if (window.StarkAudio) window.StarkAudio.playRestore();
      showToast('PROYECCIÓN AR DETENIDA');
      return;
    }
    sendControl('restore');
    remoteBar.classList.remove('show');
    if (window.StarkAudio) window.StarkAudio.playRestore();
    showToast('PANTALLA LIBERADA');
  });

  playBtn.addEventListener('click', () => sendControl('play'));
  pauseBtn.addEventListener('click', () => sendControl('pause'));
  seekSlider.addEventListener('change', () => sendControl('seek', Number(seekSlider.value)));
  volSlider.addEventListener('input', () => sendControl('volume', Number(volSlider.value)));
  muteBtn.addEventListener('click', () => sendControl('mute'));

  // HUD + Vision + QR Beacon Scanner Loop
  function resizeHud() {
    hudCanvas.width = window.innerWidth;
    hudCanvas.height = window.innerHeight;
    if (arActive || arManualPin) updateArTransform();
  }
  window.addEventListener('resize', resizeHud);
  resizeHud();

  // Check URL ?code=XXXX for instant deep-link pairing
  const urlCode = new URLSearchParams(window.location.search).get('code');
  if (urlCode) {
    setMode('p2p');
    connectToScreenCode(urlCode);
  }

  let frameCounter = 0;
  function renderLoop() {
    requestAnimationFrame(renderLoop);
    frameCounter++;

    const W = hudCanvas.width;
    const H = hudCanvas.height;
    hudCtx.clearRect(0, 0, W, H);

    // Optical screen detection every 4 frames
    if (frameCounter % 4 === 0 && cameraVideo.readyState >= 2) {
      const res = window.StarkVision.detectScreenQuad(cameraVideo, scratchCanvas);
      if (res && res.found) {
        detectedQuad = window.StarkVision.smoothQuad(detectedQuad, res.quad, 0.22);
        if (!wasLocked) {
          wasLocked = true;
          if (window.StarkAudio) window.StarkAudio.playLock();
        }
        if (mode === 'ar' && arActive && !arManualPin) {
          arCorners = detectedQuad.map((p) => ({ x: p.x, y: p.y }));
          updateArTransform();
        }
      } else {
        wasLocked = false;
      }
    }

    // Automatic QR Beacon scan every 15 frames when in P2P mode (or anytime not connected)
    if (frameCounter % 15 === 0 && !qrScanBusy && cameraVideo.readyState >= 2 && (!connectedCode || mode === 'p2p')) {
      qrScanBusy = true;
      window.StarkVision.scanQrCode(cameraVideo, qrCanvas)
        .then((code) => {
          if (code && (code !== lastQrCode || Date.now() - lastQrAt > 5000)) {
            lastQrCode = code;
            lastQrAt = Date.now();
            if (mode !== 'p2p') setMode('p2p');
            connectToScreenCode(code);
          }
        })
        .catch(() => {})
        .finally(() => { qrScanBusy = false; });
    }

    // Center Stark Reticle
    const cx = W / 2;
    const cy = H * 0.44;
    const rot = performance.now() * 0.00075;

    hudCtx.save();
    hudCtx.translate(cx, cy);
    hudCtx.strokeStyle = (wasLocked || connectedCode) ? 'rgba(255, 179, 0, 0.78)' : 'rgba(0, 229, 255, 0.45)';
    hudCtx.lineWidth = 1.6;
    hudCtx.beginPath(); hudCtx.arc(0, 0, 54, rot, rot + Math.PI * 1.25); hudCtx.stroke();
    hudCtx.beginPath(); hudCtx.arc(0, 0, 42, -rot * 1.5, -rot * 1.5 + Math.PI * 0.85); hudCtx.stroke();
    hudCtx.beginPath();
    hudCtx.moveTo(-14, 0); hudCtx.lineTo(-5, 0);
    hudCtx.moveTo(5, 0); hudCtx.lineTo(14, 0);
    hudCtx.moveTo(0, -14); hudCtx.lineTo(0, -5);
    hudCtx.moveTo(0, 5); hudCtx.lineTo(0, 14);
    hudCtx.stroke();
    hudCtx.restore();

    // Draw Detected Screen Quad
    const activeQuad = (mode === 'ar' && arManualPin) ? arCorners : detectedQuad;
    if (activeQuad) {
      const pts = activeQuad.map((p) => ({ x: p.x * W, y: p.y * H }));
      hudCtx.save();
      hudCtx.strokeStyle = (wasLocked || arManualPin) ? '#ffb300' : '#00e5ff';
      hudCtx.lineWidth = 2;
      hudCtx.beginPath();
      hudCtx.moveTo(pts[0].x, pts[0].y);
      hudCtx.lineTo(pts[1].x, pts[1].y);
      hudCtx.lineTo(pts[2].x, pts[2].y);
      hudCtx.lineTo(pts[3].x, pts[3].y);
      hudCtx.closePath();
      hudCtx.stroke();

      pts.forEach((pt) => {
        hudCtx.fillStyle = '#00e5ff';
        hudCtx.fillRect(pt.x - 4, pt.y - 4, 8, 8);
      });

      hudCtx.font = '700 11px ui-monospace, monospace';
      hudCtx.fillStyle = '#ffb300';
      const label = mode === 'p2p'
        ? (connectedCode ? `P2P LOCKED // TV ${connectedCode}` : 'BUSCANDO QR DE PANTALLA...')
        : (arManualPin ? 'AR MANUAL // LOCKED' : 'DISPLAY DETECTED // AR READY');
      hudCtx.fillText(label, pts[0].x + 6, Math.max(120, pts[0].y - 8));
      hudCtx.restore();
    }
  }

  startCamera();
  renderLoop();
})();
