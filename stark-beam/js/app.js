(function () {
  // ===== DOM ELEMENTS =====
  const connDot = document.getElementById('connDot');
  const tabArBtn = document.getElementById('tabArBtn');
  const tabSendBtn = document.getElementById('tabSendBtn');
  const tabRxBtn = document.getElementById('tabRxBtn');
  const flipCamBtn = document.getElementById('flipCamBtn');
  const toastEl = document.getElementById('toast');

  // Scanner / AR View
  const scannerView = document.getElementById('scannerView');
  const cameraVideo = document.getElementById('cameraVideo');
  const cameraOverlayPrompt = document.getElementById('cameraOverlayPrompt');
  const camErrorText = document.getElementById('camErrorText');
  const startCamBtn = document.getElementById('startCamBtn');
  const hudCanvas = document.getElementById('hudCanvas');
  const hudCtx = hudCanvas.getContext('2d');

  const p2pBar = document.getElementById('p2pBar');
  const codeInput = document.getElementById('codeInput');
  const connectCodeBtn = document.getElementById('connectCodeBtn');
  const copyRxLinkBtn = document.getElementById('copyRxLinkBtn');

  const pickFileBtn = document.getElementById('pickFileBtn');
  const loadDemoBtn = document.getElementById('loadDemoBtn');
  const fileInput = document.getElementById('fileInput');
  const flickZone = document.getElementById('flickZone');
  const fileNameEl = document.getElementById('fileName');
  const fileHintEl = document.getElementById('fileHint');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar = document.getElementById('progressBar');

  const beamBtn = document.getElementById('beamBtn');
  const autoFitBtn = document.getElementById('autoFitBtn');
  const togglePinsBtn = document.getElementById('togglePinsBtn');
  const restoreBtn = document.getElementById('restoreBtn');

  const remoteBar = document.getElementById('remoteBar');
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const seekSlider = document.getElementById('seekSlider');
  const timeReadout = document.getElementById('timeReadout');
  const volSlider = document.getElementById('volSlider');
  const muteBtn = document.getElementById('muteBtn');

  // AR Stage
  const arStage = document.getElementById('arStage');
  const arPlane = document.getElementById('arPlane');
  const arImg = document.getElementById('arImg');
  const arVideo = document.getElementById('arVideo');
  const arAudioOverlay = document.getElementById('arAudioOverlay');
  const arAudioName = document.getElementById('arAudioName');
  const arAudioEl = document.getElementById('arAudioEl');
  const arHandles = Array.from(document.querySelectorAll('.ar-handle'));

  // Integrated Receiver View
  const receiverView = document.getElementById('receiverView');
  const rxStandby = document.getElementById('rxStandby');
  const rxQrBox = document.getElementById('rxQrBox');
  const rxCodeText = document.getElementById('rxCodeText');
  const rxConnStatus = document.getElementById('rxConnStatus');
  const rxUnlockBtn = document.getElementById('rxUnlockBtn');
  const rxNewCodeBtn = document.getElementById('rxNewCodeBtn');
  const rxTransfer = document.getElementById('rxTransfer');
  const rxBarFill = document.getElementById('rxBarFill');
  const rxTransferPct = document.getElementById('rxTransferPct');
  const rxMediaLayer = document.getElementById('rxMediaLayer');
  const rxImg = document.getElementById('rxImg');
  const rxVideo = document.getElementById('rxVideo');
  const rxAudioStage = document.getElementById('rxAudioStage');
  const rxAudioCanvas = document.getElementById('rxAudioCanvas');
  const rxAudioTitle = document.getElementById('rxAudioTitle');
  const rxAudioTime = document.getElementById('rxAudioTime');
  const rxAudio = document.getElementById('rxAudio');
  const rxOverrideBanner = document.getElementById('rxOverrideBanner');
  const rxOverrideSub = document.getElementById('rxOverrideSub');
  const rxExitMediaBtn = document.getElementById('rxExitMediaBtn');

  // ===== APP STATE =====
  let activeTab = 'ar'; // 'ar' | 'send' | 'rx'
  let facingMode = 'environment';
  let camStream = null;
  let selectedFile = null;
  let selectedObjectUrl = null;

  // AR state
  let arActive = false;
  let arPinsVisible = true;
  let arCorners = [
    { x: 0.12, y: 0.22 },
    { x: 0.88, y: 0.22 },
    { x: 0.88, y: 0.58 },
    { x: 0.12, y: 0.58 },
  ];
  let dragIdx = -1;
  const scratchCanvas = document.createElement('canvas');
  const qrCanvas = document.createElement('canvas');

  // Sender P2P state
  let senderPeer = null;
  let senderConn = null;
  let connectedCode = null;
  let qrScanBusy = false;
  let lastQrAt = 0;

  // Receiver P2P state
  let rxPeer = null;
  let rxConn = null;
  let rxCode = sessionStorage.getItem('sr_stark_rx_code') || window.StarkP2P.generateCode();
  sessionStorage.setItem('sr_stark_rx_code', rxCode);
  let rxActiveKind = null;
  let rxBlobUrl = null;
  let rxAudioCtx = null;
  let rxAnalyser = null;
  let rxAudioSrc = null;
  let rxAudioRaf = null;

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

  // ===== CAMERA CONTROL =====
  function stopCamera() {
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
    }
    cameraVideo.srcObject = null;
  }

  async function startCamera() {
    cameraOverlayPrompt.classList.remove('show');
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camErrorText.textContent = 'Tu navegador requiere HTTPS o no soporta acceso a cámara.';
      cameraOverlayPrompt.classList.add('show');
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (_) {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        camErrorText.textContent = 'No se pudo abrir la cámara (' + (err2.name || 'permiso denegado') + '). Toca para reintentar.';
        cameraOverlayPrompt.classList.add('show');
        return;
      }
    }
    cameraVideo.srcObject = camStream;
    cameraVideo.muted = true;
    cameraVideo.setAttribute('playsinline', '');
    try {
      await cameraVideo.play();
    } catch (_) {
      camErrorText.textContent = 'Toca el botón para iniciar la vista de cámara.';
      cameraOverlayPrompt.classList.add('show');
    }
  }

  startCamBtn.addEventListener('click', startCamera);
  flipCamBtn.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    if (activeTab !== 'rx') startCamera();
  });

  // ===== TAB SWITCHING (AR CAM / ENVIAR TV / RECIBIR TV) =====
  function switchTab(next) {
    activeTab = next;
    tabArBtn.className = 'mode-btn' + (next === 'ar' ? ' active' : '');
    tabSendBtn.className = 'mode-btn' + (next === 'send' ? ' active' : '');
    tabRxBtn.className = 'mode-btn' + (next === 'rx' ? ' active-amber' : '');

    const isRx = next === 'rx';
    scannerView.classList.toggle('hidden', isRx);
    receiverView.classList.toggle('active', isRx);
    flipCamBtn.style.visibility = isRx ? 'hidden' : 'visible';

    if (isRx) {
      stopCamera();
      stopArProjection();
      initReceiverPeer();
      connDot.className = 'status-dot online';
      return;
    }

    p2pBar.classList.toggle('show', next === 'send');
    autoFitBtn.style.display = next === 'ar' ? 'inline-flex' : 'none';
    togglePinsBtn.style.display = next === 'ar' ? 'inline-flex' : 'none';

    if (next === 'send') {
      stopArProjection();
      beamBtn.textContent = '▲ ENVIAR A TV';
      connDot.className = connectedCode ? 'status-dot online' : 'status-dot';
      showToast('APUNTA AL QR DE LA OTRA PANTALLA O INGRESA EL CÓDIGO');
    } else {
      remoteBar.classList.remove('show');
      beamBtn.textContent = '▲ PROYECTAR AR';
      connDot.className = 'status-dot locked';
    }

    if (!camStream) startCamera();
  }

  tabArBtn.addEventListener('click', () => switchTab('ar'));
  tabSendBtn.addEventListener('click', () => switchTab('send'));
  tabRxBtn.addEventListener('click', () => switchTab('rx'));

  // ===== FILE PICKER & BUILT-IN DEMO =====
  pickFileBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  function setSelectedFile(file) {
    selectedFile = file;
    if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
    selectedObjectUrl = URL.createObjectURL(file);

    const mb = (file.size / (1024 * 1024)).toFixed(2);
    const kind = window.StarkP2P.getFileKind(file.name, file.type).toUpperCase();
    fileNameEl.textContent = `${file.name} (${mb} MB)`;
    fileHintEl.textContent = `LISTO [${kind}] • DESLIZA HACIA ARRIBA ↑ O PULSA PROYECTAR`;
    flickZone.classList.add('ready');
    if (window.StarkAudio) window.StarkAudio.playLock();
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) setSelectedFile(f);
  });

  // Built-in Demo Generator (Real JPEG Blob!)
  loadDemoBtn.addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 540;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#030c15';
    ctx.fillRect(0, 0, 960, 540);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.22)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 960; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 540); ctx.stroke(); }
    for (let y = 0; y < 540; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(960, y); ctx.stroke(); }
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(480, 270, 140, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffb300';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(480, 270, 108, 0.4, Math.PI * 1.65); ctx.stroke();
    ctx.strokeStyle = '#7bf5ff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(480, 345); ctx.lineTo(410, 222); ctx.lineTo(550, 222); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('STARK INDUSTRIES // MARK VI OVERRIDE', 40, 62);
    ctx.fillStyle = '#ffb300';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('SIGNAL HIJACKED BY SR APPS — STARK BEAM', 40, 504);

    c.toBlob((blob) => {
      if (!blob) return;
      const demoFile = new File([blob], 'Stark_Mark_VI_Demo.jpeg', { type: 'image/jpeg' });
      setSelectedFile(demoFile);
      showToast('DEMO CARGADO // TOCA PROYECTAR O DESLIZA ↑');
    }, 'image/jpeg', 0.92);
  });

  // ===== AR 3D HOMOGRAPHY PROJECTION =====
  function updateArTransform() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const pts = arCorners.map((p) => ({ x: p.x * W, y: p.y * H }));
    const matrix = window.StarkVision.computeHomographyMatrix3d(640, 360, pts);
    if (matrix) {
      arPlane.style.transform = matrix;
    }
    arHandles.forEach((h, i) => {
      h.style.left = pts[i].x + 'px';
      h.style.top = pts[i].y + 'px';
    });
  }

  function startArProjection() {
    if (!selectedFile || !selectedObjectUrl) return;
    const kind = window.StarkP2P.getFileKind(selectedFile.name, selectedFile.type);

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
      const p = arVideo.play();
      if (p && p.catch) {
        p.catch(() => {
          arVideo.muted = true;
          arVideo.play().catch(() => {});
        });
      }
    }

    arPinsVisible = true;
    arHandles.forEach((h) => h.classList.add('visible'));
    updateArTransform();
    arPlane.classList.add('glitch-active');
    setTimeout(() => arPlane.classList.remove('glitch-active'), 800);
    showToast('AR ACTIVO // ARRASTRA LOS 4 PUNTOS AL MONITOR');
  }

  function stopArProjection() {
    arActive = false;
    arStage.classList.remove('active');
    arVideo.pause();
    arAudioEl.pause();
    arHandles.forEach((h) => h.classList.remove('visible'));
  }

  togglePinsBtn.addEventListener('click', () => {
    if (!arActive) {
      arStage.classList.add('active');
      arPinsVisible = true;
      arHandles.forEach((h) => h.classList.add('visible'));
      updateArTransform();
      showToast('ARRASTRA LOS 4 PUNTOS ÁMBAR A LAS ESQUINAS');
      return;
    }
    arPinsVisible = !arPinsVisible;
    arHandles.forEach((h) => h.classList.toggle('visible', arPinsVisible));
    arPlane.style.border = arPinsVisible ? '2px solid rgba(0, 229, 255, 0.75)' : 'none';
    showToast(arPinsVisible ? 'PUNTOS DE AJUSTE VISIBLES' : 'VISTA LIMPIA SIN PUNTOS');
  });

  autoFitBtn.addEventListener('click', () => {
    const res = window.StarkVision.detectScreenQuad(cameraVideo, scratchCanvas);
    if (res && res.found) {
      arCorners = res.quad;
      updateArTransform();
      if (window.StarkAudio) window.StarkAudio.playLock();
      showToast('PANTALLA DETECTADA Y ENCAJADA ✓');
    } else {
      arCorners = [
        { x: 0.12, y: 0.22 },
        { x: 0.88, y: 0.22 },
        { x: 0.88, y: 0.58 },
        { x: 0.12, y: 0.58 },
      ];
      updateArTransform();
      showToast('SIN PANTALLA BRILLANTE CLARA — ARRASTRA LOS 4 PUNTOS');
    }
  });

  arHandles.forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      dragIdx = Number(handle.dataset.idx);
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (dragIdx !== Number(handle.dataset.idx)) return;
      const next = arCorners.map((p) => ({ ...p }));
      next[dragIdx] = {
        x: Math.max(0.02, Math.min(0.98, e.clientX / window.innerWidth)),
        y: Math.max(0.08, Math.min(0.92, e.clientY / window.innerHeight)),
      };
      if (window.StarkVision.isValidConvexQuad(next, 0.015)) {
        arCorners = next;
        updateArTransform();
      }
    });
    handle.addEventListener('pointerup', () => { dragIdx = -1; });
  });

  // ===== SENDER P2P (ENVIAR TV) =====
  function ensureSenderPeer() {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        return reject(new Error('Sin conexión a motor P2P (verifica tu internet)'));
      }
      if (senderPeer && !senderPeer.destroyed && senderPeer.open) return resolve(senderPeer);
      if (senderPeer && !senderPeer.destroyed) {
        senderPeer.once('open', () => resolve(senderPeer));
        senderPeer.once('error', reject);
        return;
      }
      senderPeer = new window.Peer(window.StarkP2P.PEER_CONFIG);
      senderPeer.once('open', () => resolve(senderPeer));
      senderPeer.on('error', (err) => {
        showToast(err.type === 'peer-unavailable' ? 'CÓDIGO NO ENCONTRADO EN RECIBIR TV' : 'ERROR P2P: ' + err.type);
        connDot.className = 'status-dot';
      });
    });
  }

  async function connectToReceiverCode(raw) {
    const code = window.StarkP2P.normalizeCode(raw);
    if (code.length < 4) {
      showToast('ESCRIBE EL CÓDIGO DE 4 LETRAS DE LA PANTALLA RECEPTORA');
      return;
    }
    codeInput.value = code;
    if (connectedCode === code && senderConn && senderConn.open) {
      showToast(`YA ENLAZADO CON TV ${code}`);
      return;
    }
    showToast(`CONECTANDO CON PANTALLA ${code}...`);
    connectCodeBtn.disabled = true;

    try {
      const p = await ensureSenderPeer();
      if (senderConn) { try { senderConn.close(); } catch (_) {} }
      const targetId = window.StarkP2P.peerIdForCode(code);
      const nextConn = p.connect(targetId, { reliable: true, serialization: 'json' });
      senderConn = nextConn;

      const timeout = setTimeout(() => {
        if (!nextConn.open) {
          connectCodeBtn.disabled = false;
          showToast('TIEMPO AGOTADO: VERIFICA QUE LA TV ESTÉ EN "RECIBIR TV"');
        }
      }, 12000);

      nextConn.on('open', () => {
        clearTimeout(timeout);
        connectCodeBtn.disabled = false;
        connectedCode = code;
        connDot.className = 'status-dot online';
        if (window.StarkAudio) window.StarkAudio.playLock();
        showToast(`ENLAZADO CON TV ${code} ✓`);
      });

      nextConn.on('data', (msg) => {
        if (msg && msg.type === 'playback_state' && msg.duration > 0) {
          seekSlider.max = String(Math.floor(msg.duration));
          seekSlider.value = String(Math.floor(msg.currentTime || 0));
          timeReadout.textContent = formatTime(msg.currentTime || 0);
        }
      });

      nextConn.on('close', () => {
        clearTimeout(timeout);
        connectCodeBtn.disabled = false;
        if (senderConn === nextConn) {
          connectedCode = null;
          connDot.className = 'status-dot';
          remoteBar.classList.remove('show');
          showToast('DESCONECTADO DE LA TV');
        }
      });
    } catch (err) {
      connectCodeBtn.disabled = false;
      showToast(err.message || 'ERROR AL CONECTAR');
    }
  }

  connectCodeBtn.addEventListener('click', () => connectToReceiverCode(codeInput.value));
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectToReceiverCode(codeInput.value);
  });

  copyRxLinkBtn.addEventListener('click', async () => {
    const rxUrl = location.origin + location.pathname + '#receiver';
    if (navigator.share) {
      try {
        await navigator.share({ title: 'STARK BEAM — Pantalla Receptora', url: rxUrl });
        return;
      } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(rxUrl);
      showToast('LINK DE RECEPTOR COPIADO ✓');
    } catch (_) {
      prompt('Abre este link en la TV o PC:', rxUrl);
    }
  });

  // ===== EXECUTE BEAM (AR OR P2P) =====
  async function executeBeam() {
    if (!selectedFile) {
      showToast('PRIMERO TOCA "ELEGIR" O "DEMO"');
      return;
    }
    if (window.StarkAudio) window.StarkAudio.playBeam();

    if (activeTab === 'ar') {
      startArProjection();
      return;
    }

    if (!senderConn || !senderConn.open) {
      if (codeInput.value.trim().length >= 4) {
        await connectToReceiverCode(codeInput.value);
      } else {
        showToast('APUNTA AL QR O ENLAZA EL CÓDIGO DE LA PANTALLA RECEPTORA');
      }
      return;
    }

    beamBtn.disabled = true;
    progressWrap.classList.add('show');
    progressBar.style.width = '2%';
    try {
      await window.StarkP2P.sendFileP2P(senderConn, selectedFile, (pct) => {
        progressBar.style.width = pct + '%';
        beamBtn.textContent = `ENVIANDO ${pct}%`;
      });
      remoteBar.classList.add('show');
      showToast(`SEÑAL ENVIADA A TV ${connectedCode} ✓`);
    } catch (err) {
      showToast(err.message || 'ERROR EN ENVÍO P2P');
    } finally {
      beamBtn.disabled = false;
      beamBtn.textContent = '▲ ENVIAR A TV';
      setTimeout(() => progressWrap.classList.remove('show'), 600);
    }
  }

  beamBtn.addEventListener('click', executeBeam);

  // Flick-Up Gesture on #flickZone
  let flickStartY = null;
  flickZone.addEventListener('pointerdown', (e) => {
    flickStartY = e.clientY;
    flickZone.setPointerCapture(e.pointerId);
  });
  flickZone.addEventListener('pointermove', (e) => {
    if (flickStartY === null) return;
    const dy = Math.min(0, e.clientY - flickStartY);
    flickZone.style.transform = `translateY(${Math.max(-56, dy)}px)`;
  });
  flickZone.addEventListener('pointerup', (e) => {
    if (flickStartY === null) return;
    const dy = e.clientY - flickStartY;
    flickStartY = null;
    flickZone.style.transform = '';
    if (dy < -36) executeBeam();
  });

  // Remote Controls
  function sendControl(action, value) {
    if (senderConn && senderConn.open) senderConn.send({ type: 'control', action, value });
  }
  restoreBtn.addEventListener('click', () => {
    if (activeTab === 'ar') {
      stopArProjection();
      if (window.StarkAudio) window.StarkAudio.playRestore();
      showToast('PROYECCIÓN AR DETENIDA');
    } else {
      sendControl('restore');
      remoteBar.classList.remove('show');
      if (window.StarkAudio) window.StarkAudio.playRestore();
      showToast('PANTALLA LIBERADA');
    }
  });
  playBtn.addEventListener('click', () => sendControl('play'));
  pauseBtn.addEventListener('click', () => sendControl('pause'));
  seekSlider.addEventListener('change', () => sendControl('seek', Number(seekSlider.value)));
  volSlider.addEventListener('input', () => sendControl('volume', Number(volSlider.value)));
  muteBtn.addEventListener('click', () => sendControl('mute'));

  // ===== INTEGRATED RECEIVER LOGIC (RECIBIR TV) =====
  function renderRxQr() {
    rxCodeText.textContent = rxCode;
    rxQrBox.innerHTML = '';
    if (typeof window.qrcode === 'function') {
      const qr = window.qrcode(0, 'M');
      qr.addData('STARK:' + rxCode);
      qr.make();
      rxQrBox.innerHTML = qr.createImgTag(5, 0);
    } else {
      rxQrBox.innerHTML = `<div class="hud-mono" style="color:#031018;font-weight:800;font-size:18px">STARK:${rxCode}</div>`;
    }
  }

  function stopRxMedia() {
    if (rxAudioRaf) { cancelAnimationFrame(rxAudioRaf); rxAudioRaf = null; }
    rxImg.style.display = 'none'; rxImg.src = '';
    rxVideo.pause(); rxVideo.style.display = 'none'; rxVideo.removeAttribute('src'); rxVideo.load();
    rxAudio.pause(); rxAudioStage.style.display = 'none'; rxAudio.removeAttribute('src'); rxAudio.load();
    if (rxBlobUrl) { URL.revokeObjectURL(rxBlobUrl); rxBlobUrl = null; }
    rxActiveKind = null;
  }

  function exitRxMedia() {
    stopRxMedia();
    rxMediaLayer.classList.remove('active');
    rxExitMediaBtn.classList.remove('show');
    rxStandby.style.display = 'flex';
  }
  rxExitMediaBtn.addEventListener('click', exitRxMedia);

  function startRxAudioViz() {
    try {
      if (!rxAudioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        rxAudioCtx = new AC();
        rxAnalyser = rxAudioCtx.createAnalyser();
        rxAnalyser.fftSize = 128;
        rxAudioSrc = rxAudioCtx.createMediaElementSource(rxAudio);
        rxAudioSrc.connect(rxAnalyser);
        rxAnalyser.connect(rxAudioCtx.destination);
      }
      if (rxAudioCtx.state === 'suspended') rxAudioCtx.resume();
    } catch (_) {}

    const ctx = rxAudioCanvas.getContext('2d');
    const bins = rxAnalyser ? new Uint8Array(rxAnalyser.frequencyBinCount) : new Uint8Array(64);
    function draw() {
      rxAudioRaf = requestAnimationFrame(draw);
      const w = rxAudioCanvas.width, h = rxAudioCanvas.height, cx = w / 2, cy = h / 2;
      ctx.clearRect(0, 0, w, h);
      if (rxAnalyser) rxAnalyser.getByteFrequencyData(bins);
      else {
        const t = performance.now() * 0.005;
        for (let i = 0; i < bins.length; i++) bins[i] = 80 + Math.sin(t + i * 0.35) * 65;
      }
      const avg = bins.reduce((a, b) => a + b, 0) / bins.length;
      const r = 68 + (avg / 255) * 14;
      ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,179,0,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 48; i++) {
        const ang = (i / 48) * Math.PI * 2 - Math.PI / 2;
        const val = bins[i % bins.length] / 255;
        const len = 12 + val * 62;
        ctx.strokeStyle = val > 0.68 ? '#ffb300' : '#00e5ff';
        ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
        ctx.lineTo(cx + Math.cos(ang) * (r + len), cy + Math.sin(ang) * (r + len));
        ctx.stroke();
      }
      rxAudioTime.textContent = `${formatTime(rxAudio.currentTime)} / ${formatTime(rxAudio.duration)}`;
    }
    draw();
  }

  function presentRxMedia(media) {
    stopRxMedia();
    rxBlobUrl = media.url;
    rxActiveKind = media.kind || 'video';
    rxOverrideSub.textContent = `INYECTANDO ${media.name.toUpperCase()}`;

    if (window.StarkAudio) window.StarkAudio.playOverride();
    rxOverrideBanner.classList.add('show');
    receiverView.classList.add('glitch-active');
    setTimeout(() => receiverView.classList.remove('glitch-active'), 800);

    setTimeout(() => {
      rxOverrideBanner.classList.remove('show');
      rxStandby.style.display = 'none';
      rxMediaLayer.classList.add('active');
      rxExitMediaBtn.classList.add('show');

      if (rxActiveKind === 'image') {
        rxImg.src = media.url;
        rxImg.style.display = 'block';
      } else if (rxActiveKind === 'audio') {
        rxAudioStage.style.display = 'flex';
        rxAudioTitle.textContent = media.name.toUpperCase();
        rxAudio.src = media.url;
        rxAudio.play().catch(() => {});
        startRxAudioViz();
      } else {
        rxVideo.src = media.url;
        rxVideo.style.display = 'block';
        rxVideo.muted = false;
        rxVideo.play().catch(() => {
          rxVideo.muted = true;
          rxVideo.play().catch(() => {});
        });
      }
    }, 820);
  }

  const handleRxPacket = window.StarkP2P.createFileAssembler({
    onStart: (meta) => {
      rxTransfer.classList.add('show');
      rxBarFill.style.width = '2%';
      rxTransferPct.textContent = `0% // ${meta.name}`;
    },
    onProgress: (pct, meta) => {
      rxBarFill.style.width = pct + '%';
      rxTransferPct.textContent = `${pct}% // ${meta.name}`;
    },
    onComplete: (media) => {
      rxTransfer.classList.remove('show');
      presentRxMedia(media);
    },
  });

  function handleRxControl(action, value) {
    if (action === 'restore') {
      if (window.StarkAudio) window.StarkAudio.playRestore();
      exitRxMedia();
      return;
    }
    const p = rxActiveKind === 'audio' ? rxAudio : rxActiveKind === 'video' ? rxVideo : null;
    if (!p) return;
    if (action === 'play') p.play().catch(() => {});
    if (action === 'pause') p.pause();
    if (action === 'seek' && isFinite(Number(value))) p.currentTime = Number(value);
    if (action === 'volume' && isFinite(Number(value))) { p.muted = false; p.volume = Math.max(0, Math.min(1, Number(value))); }
    if (action === 'mute') p.muted = !p.muted;
  }

  function initReceiverPeer(forceNewCode) {
    if (forceNewCode) {
      if (rxPeer) { try { rxPeer.destroy(); } catch (_) {} rxPeer = null; }
      rxCode = window.StarkP2P.generateCode();
      sessionStorage.setItem('sr_stark_rx_code', rxCode);
    }
    renderRxQr();
    if (rxPeer && !rxPeer.destroyed) return;
    if (typeof window.Peer !== 'function') {
      rxConnStatus.innerHTML = '<span class="status-dot hijacked"></span> ERROR CARGANDO MOTOR P2P';
      return;
    }
    rxConnStatus.innerHTML = '<span class="status-dot"></span> CONECTANDO SEÑAL P2P...';
    rxPeer = new window.Peer(window.StarkP2P.peerIdForCode(rxCode), window.StarkP2P.PEER_CONFIG);

    rxPeer.on('open', () => {
      rxConnStatus.innerHTML = '<span class="status-dot online"></span> LISTO // ESCANEA EL QR O INGRESA EL CÓDIGO';
    });

    rxPeer.on('connection', (conn) => {
      rxConn = conn;
      conn.on('open', () => {
        if (window.StarkAudio) window.StarkAudio.playLock();
        rxConnStatus.innerHTML = '<span class="status-dot locked"></span> CELULAR ENLAZADO // ESPERANDO ARCHIVO';
      });
      conn.on('data', (msg) => {
        if (handleRxPacket(msg)) return;
        if (msg && msg.type === 'control') handleRxControl(msg.action, msg.value);
      });
      conn.on('close', () => {
        rxConnStatus.innerHTML = '<span class="status-dot online"></span> LISTO // ESCANEA EL QR O INGRESA EL CÓDIGO';
      });
    });

    rxPeer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        initReceiverPeer(true);
      } else {
        rxConnStatus.innerHTML = '<span class="status-dot hijacked"></span> ERROR P2P (' + err.type + ')';
      }
    });
  }

  rxUnlockBtn.addEventListener('click', () => {
    if (window.StarkAudio) window.StarkAudio.playLock();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    rxUnlockBtn.textContent = 'AUDIO Y PANTALLA LISTOS ✓';
    rxUnlockBtn.classList.remove('btn-amber');
    rxUnlockBtn.classList.add('btn-primary');
  });

  rxNewCodeBtn.addEventListener('click', () => initReceiverPeer(true));

  // Report receiver playback state back to phone
  setInterval(() => {
    if (!rxConn || !rxConn.open) return;
    const p = rxActiveKind === 'audio' ? rxAudio : rxActiveKind === 'video' ? rxVideo : null;
    if (!p) return;
    rxConn.send({
      type: 'playback_state',
      playing: !p.paused,
      currentTime: p.currentTime || 0,
      duration: isFinite(p.duration) ? p.duration : 0,
    });
  }, 500);

  // ===== HUD & QR LOOP =====
  function resizeHud() {
    hudCanvas.width = window.innerWidth;
    hudCanvas.height = window.innerHeight;
    if (arActive || arPinsVisible) updateArTransform();
  }
  window.addEventListener('resize', resizeHud);
  resizeHud();

  let frame = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (activeTab === 'rx') return;
    frame++;

    const W = hudCanvas.width;
    const H = hudCanvas.height;
    hudCtx.clearRect(0, 0, W, H);

    // QR Scan in ENVIAR TV mode every 16 frames
    if (activeTab === 'send' && frame % 16 === 0 && !qrScanBusy && cameraVideo.readyState >= 2 && Date.now() - lastQrAt > 3500) {
      qrScanBusy = true;
      window.StarkVision.scanQrCode(cameraVideo, qrCanvas)
        .then((code) => {
          if (code && code !== connectedCode) {
            lastQrAt = Date.now();
            connectToReceiverCode(code);
          }
        })
        .catch(() => {})
        .finally(() => { qrScanBusy = false; });
    }

    // Center Stark Reticle
    const cx = W / 2;
    const cy = H * 0.42;
    const rot = performance.now() * 0.0008;
    hudCtx.save();
    hudCtx.translate(cx, cy);
    hudCtx.strokeStyle = connectedCode || arActive ? 'rgba(255, 179, 0, 0.72)' : 'rgba(0, 229, 255, 0.5)';
    hudCtx.lineWidth = 1.6;
    hudCtx.beginPath(); hudCtx.arc(0, 0, 50, rot, rot + Math.PI * 1.25); hudCtx.stroke();
    hudCtx.beginPath(); hudCtx.arc(0, 0, 38, -rot * 1.5, -rot * 1.5 + Math.PI * 0.85); hudCtx.stroke();
    hudCtx.beginPath();
    hudCtx.moveTo(-12, 0); hudCtx.lineTo(-4, 0);
    hudCtx.moveTo(4, 0); hudCtx.lineTo(12, 0);
    hudCtx.moveTo(0, -12); hudCtx.lineTo(0, -4);
    hudCtx.moveTo(0, 4); hudCtx.lineTo(0, 12);
    hudCtx.stroke();
    hudCtx.restore();
  }

  // Initial route check (#receiver or ?code=XXXX)
  const hash = location.hash.toLowerCase();
  const qCode = new URLSearchParams(location.search).get('code');
  if (hash === '#receiver') {
    switchTab('rx');
  } else if (qCode) {
    switchTab('send');
    connectToReceiverCode(qCode);
  } else {
    switchTab('ar');
  }
  loop();
})();
