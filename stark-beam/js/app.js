(function () {
  // ===== DOM =====
  const toastEl = document.getElementById('toast');
  const scannerView = document.getElementById('scannerView');
  const cameraVideo = document.getElementById('cameraVideo');
  const hudCanvas = document.getElementById('hudCanvas');
  const hudCtx = hudCanvas.getContext('2d');
  const cameraPrompt = document.getElementById('cameraPrompt');
  const camPromptText = document.getElementById('camPromptText');
  const startCamBtn = document.getElementById('startCamBtn');

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const flipCamBtn = document.getElementById('flipCamBtn');
  const menuBtn = document.getElementById('menuBtn');

  const mediaBadge = document.getElementById('mediaBadge');
  const mediaBadgeName = document.getElementById('mediaBadgeName');
  const remotePill = document.getElementById('remotePill');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const playPauseIcon = document.getElementById('playPauseIcon');
  const seekSlider = document.getElementById('seekSlider');
  const timeReadout = document.getElementById('timeReadout');

  const mediaSlotBtn = document.getElementById('mediaSlotBtn');
  const mediaThumbImg = document.getElementById('mediaThumbImg');
  const mediaSlotIcon = document.getElementById('mediaSlotIcon');
  const fileInput = document.getElementById('fileInput');
  const beamShutter = document.getElementById('beamShutter');
  const progressCircle = document.getElementById('progressCircle');
  const rightSlotBtn = document.getElementById('rightSlotBtn');
  const rightSlotIcon = document.getElementById('rightSlotIcon');

  // Slide-up Sheet
  const sheetBackdrop = document.getElementById('sheetBackdrop');
  const controlSheet = document.getElementById('controlSheet');
  const closeSheetBtn = document.getElementById('closeSheetBtn');
  const sheetAirplayBtn = document.getElementById('sheetAirplayBtn');
  const sheetReceiverBtn = document.getElementById('sheetReceiverBtn');
  const sheetChannelLabel = document.getElementById('sheetChannelLabel');
  const sheetNetworkSub = document.getElementById('sheetNetworkSub');
  const sheetChannelBtn = document.getElementById('sheetChannelBtn');

  // Receiver View
  const receiverView = document.getElementById('receiverView');
  const rxOpticalPulse = document.getElementById('rxOpticalPulse');
  const rxFsBtn = document.getElementById('rxFsBtn');
  const rxCloseBtn = document.getElementById('rxCloseBtn');
  const rxStandby = document.getElementById('rxStandby');
  const rxDeviceTitle = document.getElementById('rxDeviceTitle');
  const rxConnStatus = document.getElementById('rxConnStatus');
  const rxUnlockBtn = document.getElementById('rxUnlockBtn');
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

  const nativeCastVideo = document.getElementById('nativeCastVideo');

  // ===== STATE =====
  const RING_CIRCUMFERENCE = 226.2;
  let activeMode = 'scan'; // 'scan' | 'rx'
  let room = window.StarkTransport.normalizeRoom(localStorage.getItem('sr_stark_room') || 'sr1');
  let facingMode = 'environment';
  let camStream = null;
  let selectedFile = null;
  let selectedObjectUrl = null;
  let airplayLoopUrl = null;
  let remotePlaying = true;

  // Optical Monitor Tracking
  const scratchCanvas = document.createElement('canvas');
  const probeCanvas = document.createElement('canvas');
  let focusPoint = { x: 0.5, y: 0.46 };
  let smoothPrimaryQuad = null;
  let primaryMonitor = null;
  let stableMonitorFrames = 0;
  let missFrames = 0;
  let wasMonitorLocked = false;

  // Scanner WSS Relay
  const scannerId = window.StarkTransport.makeId('scn');
  let scannerRelay = null;
  let scannerRelayOnline = false;
  const onlineScreens = new Map();
  const flashAckWaiters = new Map();

  let verifiedTarget = null;
  let activeProjection = false;
  let opticalProbeBusy = false;
  let lastOpticalProbeAt = 0;
  let opticalNoMatch = false;

  // Receiver WSS Relay
  const rxScreenId = sessionStorage.getItem('sr_stark_rx_id') || window.StarkTransport.makeId('web');
  sessionStorage.setItem('sr_stark_rx_id', rxScreenId);
  const myDeviceName = window.StarkTransport.detectDeviceName();
  let rxRelay = null;
  let lastScannerFrom = null;
  let rxActiveKind = null;
  let rxBlobUrl = null;
  let rxAudioCtx = null;
  let rxAnalyser = null;
  let rxAudioSrc = null;
  let rxAudioRaf = null;

  rxDeviceTitle.textContent = myDeviceName;

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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function setProgressRing(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    progressCircle.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped / 100));
  }

  // ===== SHEET =====
  function openSheet() {
    sheetChannelLabel.textContent = 'CANAL: ' + room.toUpperCase();
    const liveCount = getLiveCandidates().length;
    sheetNetworkSub.textContent = scannerRelayOnline
      ? (liveCount ? `Enlace activo · ${liveCount} receptor(es) en canal` : 'Enlace activo · Sin receptores en canal')
      : 'Conectando enlace inalámbrico...';
    sheetBackdrop.classList.add('open');
    controlSheet.classList.add('open');
  }
  function closeSheet() {
    sheetBackdrop.classList.remove('open');
    controlSheet.classList.remove('open');
  }
  menuBtn.addEventListener('click', openSheet);
  closeSheetBtn.addEventListener('click', closeSheet);
  sheetBackdrop.addEventListener('click', closeSheet);

  sheetChannelBtn.addEventListener('click', () => {
    const input = prompt('Canal privado compartido (ej. SR1, CASA, OFICINA):', room.toUpperCase());
    if (!input) return;
    room = window.StarkTransport.normalizeRoom(input);
    localStorage.setItem('sr_stark_room', room);
    onlineScreens.clear();
    verifiedTarget = null;
    opticalNoMatch = false;
    if (activeMode === 'rx') initReceiverRelay();
    else initScannerRelay();
    sheetChannelLabel.textContent = 'CANAL: ' + room.toUpperCase();
    updateTelemetry();
    showToast('Canal actualizado a ' + room.toUpperCase());
  });

  sheetAirplayBtn.addEventListener('click', () => {
    closeSheet();
    launchNativeAirPlayOrCast();
  });

  sheetReceiverBtn.addEventListener('click', () => {
    closeSheet();
    enterMode('rx');
  });

  // ===== STATUS & RIGHT BUTTON SYNC =====
  function getLiveCandidates() {
    const now = Date.now();
    const out = [];
    for (const [id, scr] of onlineScreens.entries()) {
      if (now - scr.lastSeen < 45000) out.push(scr);
      else onlineScreens.delete(id);
    }
    return out;
  }

  function getVerifiedTarget() {
    if (verifiedTarget && onlineScreens.has(verifiedTarget.id)) return verifiedTarget;
    verifiedTarget = null;
    return null;
  }

  function updateRightButton() {
    if (activeProjection) {
      rightSlotBtn.classList.add('live');
      rightSlotIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"/>';
    } else {
      rightSlotBtn.classList.remove('live');
      rightSlotIcon.innerHTML = '<path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"/><polygon points="12 15 17 21 7 21 12 15"/>';
    }
  }

  function updateTelemetry() {
    const target = getVerifiedTarget();
    beamShutter.classList.toggle('locked', !!(target || (primaryMonitor && selectedFile)));
    updateRightButton();

    if (target) {
      statusDot.className = 'dot online';
      statusText.textContent = `LOCKED · ${target.name.toUpperCase()}`;
      return;
    }
    if (opticalProbeBusy && primaryMonitor) {
      statusDot.className = 'dot active';
      statusText.textContent = 'OPTICAL HANDSHAKE...';
      return;
    }
    if (primaryMonitor) {
      const ratio = primaryMonitor.aspect > 1.5 ? '16:9' : primaryMonitor.aspect > 1.15 ? '4:3' : '9:16';
      const pct = Math.round(primaryMonitor.confidence * 100);
      statusDot.className = 'dot active';
      statusText.textContent = `DISPLAY · ${ratio} · ${pct}%`;
      return;
    }
    statusDot.className = scannerRelayOnline ? 'dot online' : 'dot';
    statusText.textContent = scannerRelayOnline ? 'OPTICAL SCANNING' : 'CONNECTING LINK...';
  }

  // ===== CAMERA =====
  function stopCamera() {
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
    }
    cameraVideo.srcObject = null;
  }

  async function startCamera() {
    cameraPrompt.classList.remove('show');
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camPromptText.textContent = 'Se requiere HTTPS para acceder a la cámara.';
      cameraPrompt.classList.add('show');
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
        camPromptText.textContent = 'Permiso de cámara requerido (' + (err2.name || 'denegado') + ').';
        cameraPrompt.classList.add('show');
        return;
      }
    }
    cameraVideo.srcObject = camStream;
    cameraVideo.muted = true;
    cameraVideo.setAttribute('playsinline', '');
    try {
      await cameraVideo.play();
    } catch (_) {
      camPromptText.textContent = 'Toca para iniciar el visor óptico.';
      cameraPrompt.classList.add('show');
    }
  }

  startCamBtn.addEventListener('click', startCamera);
  flipCamBtn.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    if (activeMode === 'scan') startCamera();
  });

  // Tap to focus a specific monitor OR swipe up anywhere on viewfinder to beam!
  let canvasTouchStartY = null;
  let canvasTouchStartX = null;
  hudCanvas.addEventListener('pointerdown', (e) => {
    canvasTouchStartY = e.clientY;
    canvasTouchStartX = e.clientX;
  });
  hudCanvas.addEventListener('pointerup', (e) => {
    if (canvasTouchStartY === null) return;
    const dy = e.clientY - canvasTouchStartY;
    const dx = Math.abs(e.clientX - canvasTouchStartX);
    canvasTouchStartY = null;

    if (dy < -65 && dx < 90 && selectedFile) {
      executeBeam();
      return;
    }
    if (Math.abs(dy) < 18 && dx < 18) {
      const rect = hudCanvas.getBoundingClientRect();
      focusPoint = {
        x: Math.max(0.1, Math.min(0.9, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0.15, Math.min(0.85, (e.clientY - rect.top) / rect.height)),
      };
      verifiedTarget = null;
      opticalNoMatch = false;
      lastOpticalProbeAt = 0;
      if (window.StarkAudio) window.StarkAudio.playLock();
      updateTelemetry();
    }
  });

  // ===== MODE SWITCH (SCANNER <-> INTEGRATED RECEIVER) =====
  function enterMode(mode) {
    activeMode = mode;
    const isRx = mode === 'rx';
    scannerView.classList.toggle('hidden', isRx);
    receiverView.classList.toggle('active', isRx);

    if (isRx) {
      stopCamera();
      if (scannerRelay) { scannerRelay.destroy(); scannerRelay = null; }
      initReceiverRelay();
    } else {
      if (rxRelay) { rxRelay.destroy(); rxRelay = null; }
      stopRxMedia();
      verifiedTarget = null;
      opticalNoMatch = false;
      lastOpticalProbeAt = 0;
      if (!camStream) startCamera();
      initScannerRelay();
      updateTelemetry();
    }
  }

  rxCloseBtn.addEventListener('click', () => enterMode('scan'));

  // ===== FILE PICKER WITH CLEAN THUMBNAIL =====
  mediaSlotBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    selectedFile = f;
    if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
    if (airplayLoopUrl) { URL.revokeObjectURL(airplayLoopUrl); airplayLoopUrl = null; }
    selectedObjectUrl = URL.createObjectURL(f);

    const kind = window.StarkTransport.getFileKind(f.name, f.type);
    mediaSlotBtn.classList.add('has-file');
    mediaBadge.classList.add('show');
    mediaBadgeName.textContent = f.name;

    if (kind === 'image') {
      mediaThumbImg.src = selectedObjectUrl;
      mediaThumbImg.style.display = 'block';
      mediaSlotIcon.style.display = 'none';
    } else {
      mediaThumbImg.style.display = 'none';
      mediaSlotIcon.style.display = 'flex';
      mediaSlotIcon.innerHTML = kind === 'audio'
        ? '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
        : '<svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
    }

    if (window.StarkAudio) window.StarkAudio.playLock();
    updateTelemetry();
  });

  // ===== 5G/WI-FI MQTT WSS SCANNER RELAY =====
  function pingDiscover() {
    if (!scannerRelay || !scannerRelay.isConnected()) return;
    const t = window.StarkTransport.topics(room);
    scannerRelay.publish(t.discover, { type: 'who', from: scannerId, ts: Date.now() });
  }

  function initScannerRelay() {
    if (scannerRelay) { scannerRelay.destroy(); scannerRelay = null; }
    scannerRelayOnline = false;
    onlineScreens.clear();

    const t = window.StarkTransport.topics(room);
    scannerRelay = window.StarkTransport.createRelayClient({
      clientId: scannerId,
      onConnect: () => {
        scannerRelayOnline = true;
        scannerRelay.subscribe(t.presence);
        scannerRelay.subscribe(t.ack(scannerId));
        pingDiscover();
        updateTelemetry();
      },
      onDisconnect: () => {
        scannerRelayOnline = false;
        updateTelemetry();
      },
      onMessage: (topic, msg) => {
        if (topic === t.presence && msg && msg.id) {
          if (msg.online === false) {
            onlineScreens.delete(msg.id);
            if (verifiedTarget && verifiedTarget.id === msg.id) {
              verifiedTarget = null;
              updateTelemetry();
            }
            return;
          }
          onlineScreens.set(msg.id, {
            id: msg.id,
            name: msg.name || 'Monitor',
            resolution: msg.resolution || '',
            kind: msg.kind || 'web',
            lastSeen: Date.now(),
          });
          if (primaryMonitor && !getVerifiedTarget() && !opticalProbeBusy) {
            lastOpticalProbeAt = 0;
          }
          return;
        }

        if (topic === t.ack(scannerId) && msg) {
          if (msg.type === 'opt_flash_started' && msg.token && flashAckWaiters.has(msg.token)) {
            const fn = flashAckWaiters.get(msg.token);
            flashAckWaiters.delete(msg.token);
            fn();
          } else if (msg.type === 'playback_state' && verifiedTarget && msg.screenId === verifiedTarget.id && msg.duration > 0) {
            remotePlaying = !!msg.playing;
            playPauseIcon.innerHTML = remotePlaying
              ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
              : '<polygon points="6 4 20 12 6 20 6 4"/>';
            seekSlider.max = String(Math.floor(msg.duration));
            seekSlider.value = String(Math.floor(msg.currentTime || 0));
            timeReadout.textContent = formatTime(msg.currentTime || 0);
          }
        }
      },
    });
  }

  setInterval(() => {
    if (activeMode === 'scan' && scannerRelayOnline) pingDiscover();
  }, 8000);

  // ===== SYNCHRONIZED BLACK -> CYAN OPTICAL HANDSHAKE =====
  function waitForFlashAck(token, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        flashAckWaiters.delete(token);
        resolve(false);
      }, timeoutMs);
      flashAckWaiters.set(token, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async function identifyVisibleMonitor() {
    if (opticalProbeBusy || !primaryMonitor || activeMode !== 'scan') return;

    pingDiscover();
    let candidates = getLiveCandidates();
    if (!candidates.length) {
      await sleep(350);
      candidates = getLiveCandidates();
    }
    if (!candidates.length) {
      opticalNoMatch = true;
      updateTelemetry();
      return;
    }

    opticalProbeBusy = true;
    opticalNoMatch = false;
    lastOpticalProbeAt = Date.now();
    updateTelemetry();

    const t = window.StarkTransport.topics(room);
    let bestMatch = null;
    let bestSwing = 0;

    try {
      for (const cand of candidates) {
        if (!primaryMonitor || activeMode !== 'scan') break;
        const base = window.StarkVision.sampleBboxStats(cameraVideo, probeCanvas, primaryMonitor.bbox);
        if (!base) continue;

        const token = 'f' + Math.random().toString(36).slice(2, 8);
        const ackPromise = waitForFlashAck(token, 1200);
        scannerRelay.publish(t.cmd(cand.id), {
          type: 'opt_flash',
          from: scannerId,
          token,
          darkMs: 220,
          brightMs: 340,
        });

        await ackPromise;

        let minLum = base.lum, maxLum = base.lum;
        let minCyan = base.cyan, maxCyan = base.cyan;
        for (let step = 0; step < 19; step++) {
          await sleep(38);
          if (!primaryMonitor) break;
          const s = window.StarkVision.sampleBboxStats(cameraVideo, probeCanvas, primaryMonitor.bbox);
          if (s) {
            if (s.lum < minLum) minLum = s.lum;
            if (s.lum > maxLum) maxLum = s.lum;
            if (s.cyan < minCyan) minCyan = s.cyan;
            if (s.cyan > maxCyan) maxCyan = s.cyan;
          }
        }

        const swing = Math.max(maxLum - minLum, maxCyan - minCyan);
        if (swing >= 22 && swing > bestSwing) {
          bestSwing = swing;
          bestMatch = cand;
          break;
        }
      }
    } finally {
      opticalProbeBusy = false;
    }

    if (bestMatch) {
      verifiedTarget = bestMatch;
      opticalNoMatch = false;
      if (window.StarkAudio) window.StarkAudio.playLock();
      showToast('Enlazado con ' + bestMatch.name);
    } else {
      verifiedTarget = null;
      opticalNoMatch = true;
    }
    updateTelemetry();
  }

  // ===== NATIVE AIRPLAY (iOS) / CAST (ANDROID) INCLUDING JPEG -> MP4 WRAPPER =====
  async function wrapImageAsLoopVideoUrl(fileUrl) {
    if (airplayLoopUrl) return airplayLoopUrl;
    if (typeof MediaRecorder !== 'function') return null;

    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = fileUrl; });

    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const ctx = c.getContext('2d');
    const scale = Math.min(c.width / img.width, c.height / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    const dx = (c.width - dw) / 2, dy = (c.height - dh) / 2;

    const stream = c.captureStream(12);
    const mime = MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve) => {
      rec.onstop = () => {
        airplayLoopUrl = URL.createObjectURL(new Blob(chunks, { type: mime || 'video/mp4' }));
        resolve(airplayLoopUrl);
      };
    });

    rec.start();
    for (let f = 0; f < 14; f++) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, dx, dy, dw, dh);
      await sleep(75);
    }
    rec.stop();
    return done;
  }

  async function launchNativeAirPlayOrCast() {
    if (!selectedFile || !selectedObjectUrl) {
      fileInput.value = '';
      fileInput.click();
      showToast('Elige un archivo JPEG, MP3, MP4 o MOV');
      return;
    }
    const kind = window.StarkTransport.getFileKind(selectedFile.name, selectedFile.type);
    let mediaUrl = selectedObjectUrl;

    if (kind === 'image') {
      showToast('Preparando imagen para AirPlay / TV...');
      try {
        const wrapped = await wrapImageAsLoopVideoUrl(selectedObjectUrl);
        if (!wrapped) {
          openSheet();
          showToast('Para fotos en PC usa el Agente Windows o Modo Receptor');
          return;
        }
        mediaUrl = wrapped;
      } catch (_) {
        openSheet();
        return;
      }
    }

    nativeCastVideo.src = mediaUrl;
    nativeCastVideo.play().catch(() => {});

    if (typeof nativeCastVideo.webkitShowPlaybackTargetPicker === 'function') {
      try {
        nativeCastVideo.webkitShowPlaybackTargetPicker();
        return;
      } catch (_) {}
    }
    if (nativeCastVideo.remote && typeof nativeCastVideo.remote.prompt === 'function') {
      nativeCastVideo.remote.prompt().catch(() => openSheet());
      return;
    }
    openSheet();
  }

  // ===== BEAM SHUTTER EXECUTION =====
  async function executeBeam() {
    if (!selectedFile) {
      fileInput.value = '';
      fileInput.click();
      return;
    }

    if (!primaryMonitor && !activeProjection) {
      showToast('Enfoca un monitor o TV con la cámara');
      return;
    }

    let target = getVerifiedTarget();
    if (!target) {
      await identifyVisibleMonitor();
      target = getVerifiedTarget();
    }

    // Fallback cleanly to native AirPlay/Cast when focusing a TV without STARK receiver/agent
    if (!target) {
      if (typeof nativeCastVideo.webkitShowPlaybackTargetPicker === 'function' || (nativeCastVideo.remote && nativeCastVideo.remote.prompt)) {
        launchNativeAirPlayOrCast();
        return;
      }
      openSheet();
      showToast('Activa Receptor o Agente Windows en esa pantalla');
      return;
    }

    if (window.StarkAudio) window.StarkAudio.playBeam();
    beamShutter.disabled = true;
    activeProjection = true;
    setProgressRing(4);
    updateTelemetry();

    try {
      const t = window.StarkTransport.topics(room);
      const res = await window.StarkTransport.sendFileRelay(scannerRelay, t.cmd(target.id), scannerId, selectedFile, (pct) => {
        setProgressRing(pct);
      });
      if (res.kind !== 'image') remotePill.classList.add('show');
      showToast('Proyectando en ' + target.name);
    } catch (err) {
      activeProjection = false;
      showToast(err.message || 'Error en transmisión');
    } finally {
      beamShutter.disabled = false;
      setTimeout(() => setProgressRing(0), 650);
      updateTelemetry();
    }
  }

  beamShutter.addEventListener('click', executeBeam);

  rightSlotBtn.addEventListener('click', () => {
    if (activeProjection) {
      nativeCastVideo.pause();
      sendControl('restore');
      activeProjection = false;
      remotePill.classList.remove('show');
      if (window.StarkAudio) window.StarkAudio.playRestore();
      updateTelemetry();
      showToast('Proyección detenida');
    } else {
      launchNativeAirPlayOrCast();
    }
  });

  function sendControl(action, value) {
    const target = getVerifiedTarget();
    if (target && scannerRelay && scannerRelay.isConnected()) {
      const t = window.StarkTransport.topics(room);
      scannerRelay.publish(t.cmd(target.id), { type: 'control', action, value });
    }
  }

  playPauseBtn.addEventListener('click', () => {
    remotePlaying = !remotePlaying;
    sendControl(remotePlaying ? 'play' : 'pause');
  });
  seekSlider.addEventListener('change', () => sendControl('seek', Number(seekSlider.value)));

  // ===== INTEGRATED FULLSCREEN RECEIVER =====
  async function triggerOpticalFlash(darkMs, brightMs) {
    rxOpticalPulse.style.background = '#000000';
    rxOpticalPulse.style.opacity = '0.98';
    await sleep(Math.max(150, Math.min(400, darkMs || 220)));
    rxOpticalPulse.style.background = '#00f5ff';
    rxOpticalPulse.style.opacity = '0.98';
    await sleep(Math.max(200, Math.min(500, brightMs || 340)));
    rxOpticalPulse.style.opacity = '0';
  }

  function stopRxMedia() {
    if (rxAudioRaf) { cancelAnimationFrame(rxAudioRaf); rxAudioRaf = null; }
    rxImg.style.display = 'none'; rxImg.src = '';
    rxVideo.pause(); rxVideo.style.display = 'none'; rxVideo.removeAttribute('src'); rxVideo.load();
    rxAudio.pause(); rxAudioStage.style.display = 'none'; rxAudio.removeAttribute('src'); rxAudio.load();
    if (rxBlobUrl) { URL.revokeObjectURL(rxBlobUrl); rxBlobUrl = null; }
    rxActiveKind = null;
    rxMediaLayer.classList.remove('active');
    rxStandby.style.display = 'flex';
  }

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
        for (let i = 0; i < bins.length; i++) bins[i] = 75 + Math.sin(t + i * 0.35) * 55;
      }
      const avg = bins.reduce((a, b) => a + b, 0) / bins.length;
      const r = 64 + (avg / 255) * 12;
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.65, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 48; i++) {
        const ang = (i / 48) * Math.PI * 2 - Math.PI / 2;
        const val = bins[i % bins.length] / 255;
        const len = 10 + val * 56;
        ctx.strokeStyle = val > 0.65 ? '#38bdf8' : 'rgba(241,245,249,0.72)';
        ctx.lineWidth = 2.5; ctx.lineCap = 'round';
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
    rxOverrideSub.textContent = media.name.toUpperCase();

    if (window.StarkAudio) window.StarkAudio.playOverride();
    rxOverrideBanner.classList.add('show');
    receiverView.classList.add('glitch-active');
    setTimeout(() => receiverView.classList.remove('glitch-active'), 720);

    setTimeout(() => {
      rxOverrideBanner.classList.remove('show');
      rxStandby.style.display = 'none';
      rxMediaLayer.classList.add('active');

      if (rxActiveKind === 'image') {
        rxImg.src = media.url;
        rxImg.style.display = 'block';
      } else if (rxActiveKind === 'audio') {
        rxAudioStage.style.display = 'flex';
        rxAudioTitle.textContent = media.name;
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
    }, 760);
  }

  const handleRxPacket = window.StarkTransport.createFileAssembler({
    onStart: (meta) => {
      if (meta.from) lastScannerFrom = meta.from;
      rxTransfer.classList.add('show');
      rxBarFill.style.width = '3%';
      rxTransferPct.textContent = `0% · ${meta.name}`;
    },
    onProgress: (pct, meta) => {
      rxBarFill.style.width = pct + '%';
      rxTransferPct.textContent = `${pct}% · ${meta.name}`;
    },
    onComplete: (media) => {
      rxTransfer.classList.remove('show');
      presentRxMedia(media);
    },
  });

  function handleRxControl(action, value) {
    if (action === 'restore') {
      if (window.StarkAudio) window.StarkAudio.playRestore();
      stopRxMedia();
      return;
    }
    const p = rxActiveKind === 'audio' ? rxAudio : rxActiveKind === 'video' ? rxVideo : null;
    if (!p) return;
    if (action === 'play') p.play().catch(() => {});
    if (action === 'pause') p.pause();
    if (action === 'seek' && isFinite(Number(value))) p.currentTime = Number(value);
  }

  function publishRxPresence() {
    if (!rxRelay || !rxRelay.isConnected()) return;
    const t = window.StarkTransport.topics(room);
    rxRelay.publish(t.presence, {
      id: rxScreenId,
      name: myDeviceName,
      resolution: `${window.screen.width}x${window.screen.height}`,
      kind: 'web',
      online: true,
      ts: Date.now(),
    });
  }

  function initReceiverRelay() {
    if (rxRelay) { rxRelay.destroy(); rxRelay = null; }
    const t = window.StarkTransport.topics(room);
    rxConnStatus.innerHTML = `<span class="dot"></span><span>Conectando canal ${room.toUpperCase()}...</span>`;

    rxRelay = window.StarkTransport.createRelayClient({
      clientId: rxScreenId,
      willTopic: t.presence,
      willPayload: { id: rxScreenId, online: false },
      onConnect: () => {
        rxRelay.subscribe(t.discover);
        rxRelay.subscribe(t.cmd(rxScreenId));
        publishRxPresence();
        rxConnStatus.innerHTML = `<span class="dot online"></span><span>En línea · Canal ${room.toUpperCase()}</span>`;
      },
      onDisconnect: () => {
        rxConnStatus.innerHTML = `<span class="dot"></span><span>Reconectando...</span>`;
      },
      onMessage: (topic, msg) => {
        if (topic === t.discover) { publishRxPresence(); return; }
        if (!msg) return;
        if (msg.type === 'opt_flash') {
          if (msg.from) {
            lastScannerFrom = msg.from;
            rxRelay.publish(t.ack(msg.from), {
              type: 'opt_flash_started',
              screenId: rxScreenId,
              token: msg.token,
            });
          }
          triggerOpticalFlash(msg.darkMs, msg.brightMs);
          return;
        }
        if (handleRxPacket(msg)) return;
        if (msg.type === 'control') handleRxControl(msg.action, msg.value);
      },
    });
  }

  function unlockReceiverFullscreen() {
    if (window.StarkAudio) window.StarkAudio.playLock();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    rxUnlockBtn.textContent = 'Audio y pantalla listos ✓';
  }
  rxUnlockBtn.addEventListener('click', unlockReceiverFullscreen);
  rxFsBtn.addEventListener('click', unlockReceiverFullscreen);

  setInterval(() => {
    if (activeMode !== 'rx' || !rxRelay || !rxRelay.isConnected() || !lastScannerFrom) return;
    const p = rxActiveKind === 'audio' ? rxAudio : rxActiveKind === 'video' ? rxVideo : null;
    if (!p) return;
    const t = window.StarkTransport.topics(room);
    rxRelay.publish(t.ack(lastScannerFrom), {
      type: 'playback_state',
      screenId: rxScreenId,
      playing: !p.paused,
      currentTime: p.currentTime || 0,
      duration: isFinite(p.duration) ? p.duration : 0,
    });
  }, 600);

  window.addEventListener('beforeunload', () => {
    if (rxRelay) rxRelay.destroy();
    if (scannerRelay) scannerRelay.destroy();
  });

  // ===== PRECISION AEROSPACE OPTICAL HUD RENDERER =====
  function resizeHud() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    hudCanvas.width = Math.round(window.innerWidth * dpr);
    hudCanvas.height = Math.round(window.innerHeight * dpr);
    hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeHud);
  resizeHud();

  function drawPrecisionBrackets(ctx, pts, color, lineWidth, armLen) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';
    for (let i = 0; i < 4; i++) {
      const curr = pts[i];
      const prev = pts[(i + 3) % 4];
      const next = pts[(i + 1) % 4];
      const v1x = prev.x - curr.x, v1y = prev.y - curr.y;
      const l1 = Math.hypot(v1x, v1y) || 1;
      const v2x = next.x - curr.x, v2y = next.y - curr.y;
      const l2 = Math.hypot(v2x, v2y) || 1;
      const a1 = Math.min(armLen, l1 * 0.28);
      const a2 = Math.min(armLen, l2 * 0.28);
      ctx.beginPath();
      ctx.moveTo(curr.x + (v1x / l1) * a1, curr.y + (v1y / l1) * a1);
      ctx.lineTo(curr.x, curr.y);
      ctx.lineTo(curr.x + (v2x / l2) * a2, curr.y + (v2y / l2) * a2);
      ctx.stroke();
    }
  }

  let frame = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (activeMode !== 'scan') return;
    frame++;

    const W = window.innerWidth;
    const H = window.innerHeight;
    hudCtx.clearRect(0, 0, W, H);

    // Optical monitor detection every 3 frames
    if (frame % 3 === 0 && cameraVideo.readyState >= 2) {
      const det = window.StarkVision.detectMonitors(cameraVideo, scratchCanvas, focusPoint);
      if (det.best) {
        missFrames = 0;
        stableMonitorFrames++;
        primaryMonitor = det.best;
        smoothPrimaryQuad = window.StarkVision.smoothQuad(smoothPrimaryQuad, det.best.quad, 0.28);

        if (!wasMonitorLocked) {
          wasMonitorLocked = true;
          if (window.StarkAudio) window.StarkAudio.playLock();
        }

        if (
          stableMonitorFrames >= 3 &&
          !getVerifiedTarget() &&
          !opticalProbeBusy &&
          scannerRelayOnline &&
          Date.now() - lastOpticalProbeAt > 3200
        ) {
          identifyVisibleMonitor();
        }
        updateTelemetry();
      } else {
        missFrames++;
        stableMonitorFrames = 0;
        if (missFrames > 14) {
          primaryMonitor = null;
          smoothPrimaryQuad = null;
          wasMonitorLocked = false;
          opticalNoMatch = false;
          if (!activeProjection) verifiedTarget = null;
          updateTelemetry();
        }
      }
    }

    const target = getVerifiedTarget();

    // Precision hairline monitor framing (no loud arcade boxes)
    if (smoothPrimaryQuad && primaryMonitor) {
      const pts = smoothPrimaryQuad.map((p) => window.StarkVision.mapVideoNormToCanvas(p, cameraVideo, W, H));
      const strokeColor = target ? '#22c55e' : (opticalProbeBusy ? '#38bdf8' : 'rgba(241, 245, 249, 0.92)');

      hudCtx.save();
      // Ultra-subtle perimeter hairline
      hudCtx.strokeStyle = target ? 'rgba(34, 197, 94, 0.38)' : 'rgba(255, 255, 255, 0.24)';
      hudCtx.lineWidth = 1;
      hudCtx.beginPath();
      hudCtx.moveTo(pts[0].x, pts[0].y);
      hudCtx.lineTo(pts[1].x, pts[1].y);
      hudCtx.lineTo(pts[2].x, pts[2].y);
      hudCtx.lineTo(pts[3].x, pts[3].y);
      hudCtx.closePath();
      hudCtx.stroke();

      // Precision machined corner brackets
      drawPrecisionBrackets(hudCtx, pts, strokeColor, 2.2, 22);

      // Clean micro-telemetry label aligned to top-left corner
      const ratio = primaryMonitor.aspect > 1.5 ? '16:9' : primaryMonitor.aspect > 1.15 ? '4:3' : '9:16';
      const label = target
        ? `LINKED · ${target.name.toUpperCase()}`
        : opticalProbeBusy
          ? 'SYNCING OPTICAL PULSE...'
          : `DISPLAY · ${ratio}`;

      hudCtx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = hudCtx.measureText(label).width + 14;
      const tx = Math.max(14, Math.min(W - tw - 14, pts[0].x));
      const ty = Math.max(78, pts[0].y - 10);

      hudCtx.fillStyle = 'rgba(4, 6, 8, 0.72)';
      if (typeof hudCtx.roundRect === 'function') {
        hudCtx.beginPath();
        hudCtx.roundRect(tx, ty - 16, tw, 19, 5);
        hudCtx.fill();
        hudCtx.strokeStyle = target ? 'rgba(34, 197, 94, 0.65)' : 'rgba(255, 255, 255, 0.22)';
        hudCtx.lineWidth = 0.8;
        hudCtx.stroke();
      } else {
        hudCtx.fillRect(tx, ty - 16, tw, 19);
        hudCtx.strokeStyle = target ? 'rgba(34, 197, 94, 0.65)' : 'rgba(255, 255, 255, 0.22)';
        hudCtx.lineWidth = 0.8;
        hudCtx.strokeRect(tx, ty - 16, tw, 19);
      }
      hudCtx.fillStyle = target ? '#4ade80' : '#f1f5f9';
      hudCtx.fillText(label, tx + 7, ty - 3.5);
      hudCtx.restore();
    }

    // Minimalist Leica/Stark center optical reticle (razor-thin hairlines)
    const cx = W * focusPoint.x;
    const cy = H * focusPoint.y;
    hudCtx.save();
    hudCtx.translate(cx, cy);
    hudCtx.strokeStyle = target
      ? 'rgba(34, 197, 94, 0.7)'
      : primaryMonitor ? 'rgba(56, 189, 248, 0.65)' : 'rgba(255, 255, 255, 0.35)';
    hudCtx.lineWidth = 1;

    // Hairline crosshair ticks
    hudCtx.beginPath();
    hudCtx.moveTo(-16, 0); hudCtx.lineTo(-5, 0);
    hudCtx.moveTo(5, 0); hudCtx.lineTo(16, 0);
    hudCtx.moveTo(0, -16); hudCtx.lineTo(0, -5);
    hudCtx.moveTo(0, 5); hudCtx.lineTo(0, 16);
    hudCtx.stroke();

    // Subtle rotating arc only during optical handshake
    if (opticalProbeBusy) {
      const rot = performance.now() * 0.004;
      hudCtx.strokeStyle = '#38bdf8';
      hudCtx.lineWidth = 1.5;
      hudCtx.beginPath();
      hudCtx.arc(0, 0, 26, rot, rot + Math.PI * 1.1);
      hudCtx.stroke();
    }
    hudCtx.restore();
  }

  if (location.hash.toLowerCase() === '#receiver') {
    enterMode('rx');
  } else {
    enterMode('scan');
  }
  loop();
})();
