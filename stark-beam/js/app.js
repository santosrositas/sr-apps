(function () {
  // ===== DOM =====
  const connDot = document.getElementById('connDot');
  const tabScanBtn = document.getElementById('tabScanBtn');
  const tabRxBtn = document.getElementById('tabRxBtn');
  const flipCamBtn = document.getElementById('flipCamBtn');
  const toastEl = document.getElementById('toast');

  // Scanner View
  const scannerView = document.getElementById('scannerView');
  const cameraVideo = document.getElementById('cameraVideo');
  const cameraOverlayPrompt = document.getElementById('cameraOverlayPrompt');
  const camErrorText = document.getElementById('camErrorText');
  const startCamBtn = document.getElementById('startCamBtn');
  const hudCanvas = document.getElementById('hudCanvas');
  const hudCtx = hudCanvas.getContext('2d');

  const rescanBtn = document.getElementById('rescanBtn');
  const roomBtn = document.getElementById('roomBtn');
  const radarStatus = document.getElementById('radarStatus');
  const radarStatusText = document.getElementById('radarStatusText');

  const pickFileBtn = document.getElementById('pickFileBtn');
  const loadDemoBtn = document.getElementById('loadDemoBtn');
  const fileInput = document.getElementById('fileInput');
  const flickZone = document.getElementById('flickZone');
  const fileNameEl = document.getElementById('fileName');
  const fileHintEl = document.getElementById('fileHint');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar = document.getElementById('progressBar');
  const beamBtn = document.getElementById('beamBtn');
  const airplayBtn = document.getElementById('airplayBtn');
  const restoreBtn = document.getElementById('restoreBtn');

  const remoteBar = document.getElementById('remoteBar');
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const seekSlider = document.getElementById('seekSlider');
  const timeReadout = document.getElementById('timeReadout');
  const volSlider = document.getElementById('volSlider');
  const muteBtn = document.getElementById('muteBtn');

  // Receiver View
  const receiverView = document.getElementById('receiverView');
  const rxOpticalPulse = document.getElementById('rxOpticalPulse');
  const rxStandby = document.getElementById('rxStandby');
  const rxDeviceTitle = document.getElementById('rxDeviceTitle');
  const rxConnStatus = document.getElementById('rxConnStatus');
  const rxUnlockBtn = document.getElementById('rxUnlockBtn');
  const rxRoomBtn = document.getElementById('rxRoomBtn');
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

  const nativeCastVideo = document.getElementById('nativeCastVideo');

  // ===== STATE =====
  let activeTab = 'scan'; // 'scan' | 'rx'
  let room = window.StarkTransport.normalizeRoom(localStorage.getItem('sr_stark_room') || 'sr1');
  let facingMode = 'environment';
  let camStream = null;
  let selectedFile = null;
  let selectedObjectUrl = null;
  let airplayLoopUrl = null;

  // Optical Monitor Detection state
  const scratchCanvas = document.createElement('canvas');
  const probeCanvas = document.createElement('canvas');
  let focusPoint = { x: 0.5, y: 0.45 };
  let smoothPrimaryQuad = null;
  let primaryMonitor = null;
  let stableMonitorFrames = 0;
  let missFrames = 0;
  let wasMonitorLocked = false;

  // Scanner MQTT WSS state (works 100% across 5G <-> Wi-Fi)
  const scannerId = window.StarkTransport.makeId('scn');
  let scannerRelay = null;
  let scannerRelayOnline = false;
  const onlineScreens = new Map(); // screenId -> { id, name, resolution, kind, lastSeen }
  const flashAckWaiters = new Map(); // token -> resolve()

  // Camera-Verified Target (ONLY locked when camera sees the physical monitor!)
  let verifiedTarget = null; // { id, name, resolution, kind }
  let activeTransferOrPlayback = false;
  let opticalProbeBusy = false;
  let lastOpticalProbeAt = 0;
  let opticalNoMatch = false;

  // Receiver MQTT WSS state
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
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
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

  function updateRoomLabels() {
    const label = 'CANAL: ' + room.toUpperCase();
    roomBtn.textContent = label;
    rxRoomBtn.textContent = label;
  }
  updateRoomLabels();

  function getLiveCandidates() {
    const now = Date.now();
    const list = [];
    for (const [id, scr] of onlineScreens.entries()) {
      if (now - scr.lastSeen < 45000) {
        list.push(scr);
      } else {
        onlineScreens.delete(id);
      }
    }
    return list;
  }

  function getVerifiedTarget() {
    if (verifiedTarget && onlineScreens.has(verifiedTarget.id)) {
      return verifiedTarget;
    }
    verifiedTarget = null;
    return null;
  }

  function updateRadarPill() {
    const target = getVerifiedTarget();
    connDot.className = target
      ? 'status-dot online'
      : primaryMonitor ? 'status-dot locked' : (scannerRelayOnline ? 'status-dot online' : 'status-dot');

    if (target) {
      radarStatus.className = 'hud-mono connected';
      radarStatus.querySelector('.status-dot').className = 'status-dot online';
      radarStatusText.textContent = `✓ ENFOCADO: ${target.name.toUpperCase()} — LISTO`;
      return;
    }
    if (opticalProbeBusy && primaryMonitor) {
      radarStatus.className = 'hud-mono locked';
      radarStatus.querySelector('.status-dot').className = 'status-dot locked';
      radarStatusText.textContent = 'MONITOR ENFOCADO — IDENTIFICANDO PULSO...';
      return;
    }
    if (primaryMonitor) {
      const pct = Math.round(primaryMonitor.confidence * 100);
      const ratio = primaryMonitor.aspect > 1.5 ? '16:9' : primaryMonitor.aspect > 1.15 ? '4:3' : 'VERTICAL';
      radarStatus.className = 'hud-mono locked';
      radarStatus.querySelector('.status-dot').className = 'status-dot locked';
      if (!scannerRelayOnline) {
        radarStatusText.textContent = `MONITOR [${ratio}] — CONECTANDO RED...`;
      } else if (opticalNoMatch) {
        radarStatusText.textContent = `MONITOR [${ratio} · ${pct}%] — LISTO PARA 📡 AIRPLAY / TV`;
      } else {
        radarStatusText.textContent = `MONITOR DETECTADO [${ratio} · ${pct}%]...`;
      }
      return;
    }
    radarStatus.className = 'hud-mono';
    radarStatus.querySelector('.status-dot').className = scannerRelayOnline ? 'status-dot online' : 'status-dot';
    radarStatusText.textContent = scannerRelayOnline
      ? 'ENFOCA UN MONITOR O TV CON LA CÁMARA...'
      : 'CONECTANDO ENLACE 5G/WI-FI...';
  }

  function changeRoom() {
    const input = prompt('Nombre de tu canal (ej. SR1, CASA, OFICINA). Usa el mismo en tu cel y tu PC/TV:', room.toUpperCase());
    if (!input) return;
    room = window.StarkTransport.normalizeRoom(input);
    localStorage.setItem('sr_stark_room', room);
    updateRoomLabels();

    onlineScreens.clear();
    verifiedTarget = null;
    opticalNoMatch = false;

    if (activeTab === 'rx') {
      initReceiverRelay();
    } else {
      initScannerRelay();
    }
    updateRadarPill();
    showToast('CANAL: ' + room.toUpperCase());
  }
  roomBtn.addEventListener('click', changeRoom);
  rxRoomBtn.addEventListener('click', changeRoom);

  // ===== CAMERA =====
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
        camErrorText.textContent = 'No se pudo abrir la cámara (' + (err2.name || 'permiso denegado') + ').';
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
      camErrorText.textContent = 'Toca el botón para iniciar la cámara trasera.';
      cameraOverlayPrompt.classList.add('show');
    }
  }

  startCamBtn.addEventListener('click', startCamera);
  flipCamBtn.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    if (activeTab === 'scan') startCamera();
  });

  // Tap on any monitor to focus & re-verify THAT exact monitor
  hudCanvas.addEventListener('pointerdown', (e) => {
    const rect = hudCanvas.getBoundingClientRect();
    focusPoint = {
      x: Math.max(0.1, Math.min(0.9, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0.15, Math.min(0.85, (e.clientY - rect.top) / rect.height)),
    };
    verifiedTarget = null;
    opticalNoMatch = false;
    lastOpticalProbeAt = 0;
    if (window.StarkAudio) window.StarkAudio.playLock();
    updateRadarPill();
  });

  // ===== SCANNER MQTT WSS RELAY (5G <-> WI-FI PROOF) =====
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
        updateRadarPill();
      },
      onDisconnect: () => {
        scannerRelayOnline = false;
        updateRadarPill();
      },
      onMessage: (topic, msg) => {
        if (topic === t.presence && msg && msg.id) {
          if (msg.online === false) {
            onlineScreens.delete(msg.id);
            if (verifiedTarget && verifiedTarget.id === msg.id) {
              verifiedTarget = null;
              updateRadarPill();
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
            seekSlider.max = String(Math.floor(msg.duration));
            seekSlider.value = String(Math.floor(msg.currentTime || 0));
            timeReadout.textContent = formatTime(msg.currentTime || 0);
          }
        }
      },
    });
  }

  setInterval(() => {
    if (activeTab === 'scan' && scannerRelayOnline) pingDiscover();
  }, 8000);

  // ===== SYNCHRONIZED BLACK->CYAN OPTICAL HANDSHAKE (LOCKS ONLY THE MONITOR IN CAMERA VIEW!) =====
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
    if (opticalProbeBusy || !primaryMonitor || activeTab !== 'scan') return;

    pingDiscover();
    let candidates = getLiveCandidates();
    if (!candidates.length) {
      await sleep(350);
      candidates = getLiveCandidates();
    }
    if (!candidates.length) {
      opticalNoMatch = true;
      updateRadarPill();
      return;
    }

    opticalProbeBusy = true;
    opticalNoMatch = false;
    lastOpticalProbeAt = Date.now();
    updateRadarPill();

    const t = window.StarkTransport.topics(room);
    let bestMatch = null;
    let bestSwing = 0;

    try {
      for (const cand of candidates) {
        if (!primaryMonitor || activeTab !== 'scan') break;
        const base = window.StarkVision.sampleBboxStats(cameraVideo, probeCanvas, primaryMonitor.bbox);
        if (!base) continue;

        const token = 'f' + Math.random().toString(36).slice(2, 8);
        const ackPromise = waitForFlashAck(token, 1200);

        // Request 2-phase BLACK (220ms) -> BRIGHT CYAN (340ms) flash on ONLY this candidate
        scannerRelay.publish(t.cmd(cand.id), {
          type: 'opt_flash',
          from: scannerId,
          token,
          darkMs: 220,
          brightMs: 340,
        });

        // Wait for exact millisecond receiver starts flashing (eliminates 5G jitter!)
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

        const lumSwing = maxLum - minLum;
        const cyanSwing = maxCyan - minCyan;
        const swing = Math.max(lumSwing, cyanSwing);

        // Black -> Cyan creates a huge brightness/cyan swing ONLY inside the monitor being looked at!
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
      showToast(`✓ MONITOR FIJADO: ${bestMatch.name.toUpperCase()}`);
    } else {
      verifiedTarget = null;
      opticalNoMatch = true;
    }
    updateRadarPill();
  }

  rescanBtn.addEventListener('click', () => {
    verifiedTarget = null;
    opticalNoMatch = false;
    lastOpticalProbeAt = 0;
    pingDiscover();
    if (primaryMonitor) {
      identifyVisibleMonitor();
    } else {
      showToast('ENFOCA UN MONITOR O TV CON LA CÁMARA');
    }
    updateRadarPill();
  });

  // ===== TAB SWITCH =====
  function switchTab(next) {
    activeTab = next;
    tabScanBtn.className = 'mode-btn' + (next === 'scan' ? ' active' : '');
    tabRxBtn.className = 'mode-btn' + (next === 'rx' ? ' active-amber' : '');

    const isRx = next === 'rx';
    scannerView.classList.toggle('hidden', isRx);
    receiverView.classList.toggle('active', isRx);
    flipCamBtn.style.visibility = isRx ? 'hidden' : 'visible';

    if (isRx) {
      stopCamera();
      if (scannerRelay) { scannerRelay.destroy(); scannerRelay = null; }
      initReceiverRelay();
      connDot.className = 'status-dot online';
    } else {
      if (rxRelay) { rxRelay.destroy(); rxRelay = null; }
      verifiedTarget = null;
      opticalNoMatch = false;
      lastOpticalProbeAt = 0;
      if (!camStream) startCamera();
      initScannerRelay();
      updateRadarPill();
    }
  }

  tabScanBtn.addEventListener('click', () => switchTab('scan'));
  tabRxBtn.addEventListener('click', () => switchTab('rx'));

  // ===== FILE PICKER + DEMO =====
  pickFileBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  function setSelectedFile(file) {
    selectedFile = file;
    if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
    if (airplayLoopUrl) { URL.revokeObjectURL(airplayLoopUrl); airplayLoopUrl = null; }
    selectedObjectUrl = URL.createObjectURL(file);

    const mb = (file.size / (1024 * 1024)).toFixed(2);
    const kind = window.StarkTransport.getFileKind(file.name, file.type).toUpperCase();
    fileNameEl.textContent = `${file.name} (${mb} MB)`;
    fileHintEl.textContent = `LISTO [${kind}] • ENFOCA EL MONITOR Y DESLIZA ↑`;
    flickZone.classList.add('ready');
    if (window.StarkAudio) window.StarkAudio.playLock();
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) setSelectedFile(f);
  });

  loadDemoBtn.addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 540;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#030c15';
    ctx.fillRect(0, 0, 960, 540);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.22)';
    for (let x = 0; x < 960; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 540); ctx.stroke(); }
    for (let y = 0; y < 540; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(960, y); ctx.stroke(); }
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(480, 270, 140, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(480, 270, 108, 0.4, Math.PI * 1.65); ctx.stroke();
    ctx.strokeStyle = '#7bf5ff'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(480, 345); ctx.lineTo(410, 222); ctx.lineTo(550, 222); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#00e5ff'; ctx.font = 'bold 28px monospace';
    ctx.fillText('STARK INDUSTRIES // OPTICAL LOCK', 40, 62);
    ctx.fillStyle = '#ffb300'; ctx.font = 'bold 18px monospace';
    ctx.fillText('SIGNAL OVERRIDE — SR APPS', 40, 504);

    c.toBlob((blob) => {
      if (!blob) return;
      setSelectedFile(new File([blob], 'Stark_Mark_VI_Demo.jpeg', { type: 'image/jpeg' }));
      showToast('DEMO LISTO // ENFOCA EL MONITOR Y DESLIZA ↑');
    }, 'image/jpeg', 0.92);
  });

  // ===== JPEG -> LOOPING MP4 WRAPPER FOR NATIVE iOS AIRPLAY (ZERO APP ON TV!) =====
  async function wrapImageAsLoopVideoUrl(fileUrl) {
    if (airplayLoopUrl) return airplayLoopUrl;
    if (typeof MediaRecorder !== 'function') return null;

    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = fileUrl;
    });

    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const ctx = c.getContext('2d');
    const scale = Math.min(c.width / img.width, c.height / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (c.width - dw) / 2;
    const dy = (c.height - dh) / 2;

    const stream = c.captureStream(12);
    const mime = MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mime || 'video/mp4' });
        airplayLoopUrl = URL.createObjectURL(blob);
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
      showToast('ELIGE UN JPEG, MP3, MP4 O MOV PRIMERO');
      return;
    }
    const kind = window.StarkTransport.getFileKind(selectedFile.name, selectedFile.type);
    let mediaUrl = selectedObjectUrl;

    if (kind === 'image') {
      showToast('PREPARANDO FOTO PARA AIRPLAY / TV...');
      try {
        const wrapped = await wrapImageAsLoopVideoUrl(selectedObjectUrl);
        if (!wrapped) {
          showToast('PARA FOTO EN PC USA EL AGENTE WINDOWS O RECEPTOR TV');
          return;
        }
        mediaUrl = wrapped;
      } catch (_) {
        showToast('NO SE PUDO CONVERTIR FOTO A AIRPLAY');
        return;
      }
    }

    nativeCastVideo.src = mediaUrl;
    nativeCastVideo.play().catch(() => {});

    if (typeof nativeCastVideo.webkitShowPlaybackTargetPicker === 'function') {
      try {
        nativeCastVideo.webkitShowPlaybackTargetPicker();
        showToast('SELECCIONA TU TV / APPLE TV / MAC EN AIRPLAY');
        return;
      } catch (_) {}
    }
    if (nativeCastVideo.remote && typeof nativeCastVideo.remote.prompt === 'function') {
      nativeCastVideo.remote.prompt()
        .then(() => showToast('PROYECTANDO A TV POR CAST...'))
        .catch(() => showToast('NO SE DETECTARON TVs CAST'));
      return;
    }
    showToast('ESTE NAVEGADOR NO EXPONE AIRPLAY — USA RECEPTOR TV O AGENTE WINDOWS');
  }

  airplayBtn.addEventListener('click', launchNativeAirPlayOrCast);

  // ===== TRANSMIT TO THE CAMERA-FOCUSED MONITOR =====
  async function executeBeam() {
    if (!selectedFile) {
      showToast('ELIGE UN ARCHIVO O TOCA "DEMO" PRIMERO');
      return;
    }

    if (!primaryMonitor && !activeTransferOrPlayback) {
      showToast('ENFOCA LA CÁMARA DIRECTAMENTE AL MONITOR O TV');
      return;
    }

    let target = getVerifiedTarget();
    if (!target) {
      await identifyVisibleMonitor();
      target = getVerifiedTarget();
    }

    // If focused monitor has no STARK Receiver / Windows Agent, automatically offer native AirPlay/Cast!
    if (!target) {
      if (typeof nativeCastVideo.webkitShowPlaybackTargetPicker === 'function' || (nativeCastVideo.remote && nativeCastVideo.remote.prompt)) {
        launchNativeAirPlayOrCast();
        return;
      }
      showToast('ACTIVA "RECEPTOR TV" O EL AGENTE WINDOWS EN ESA PANTALLA');
      return;
    }

    if (window.StarkAudio) window.StarkAudio.playBeam();
    beamBtn.disabled = true;
    activeTransferOrPlayback = true;
    progressWrap.classList.add('show');
    progressBar.style.width = '2%';

    try {
      const t = window.StarkTransport.topics(room);
      await window.StarkTransport.sendFileRelay(scannerRelay, t.cmd(target.id), scannerId, selectedFile, (pct) => {
        progressBar.style.width = pct + '%';
        beamBtn.textContent = `ENVIANDO ${pct}%`;
      });
      remoteBar.classList.add('show');
      showToast(`PROYECTADO EN ${target.name.toUpperCase()} ✓`);
    } catch (err) {
      activeTransferOrPlayback = false;
      showToast(err.message || 'ERROR EN TRANSMISIÓN');
    } finally {
      beamBtn.disabled = false;
      beamBtn.textContent = '▲ TRANSMITIR';
      setTimeout(() => progressWrap.classList.remove('show'), 600);
    }
  }

  beamBtn.addEventListener('click', executeBeam);

  // Flick-Up Gesture
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
    const target = getVerifiedTarget();
    if (target && scannerRelay && scannerRelay.isConnected()) {
      const t = window.StarkTransport.topics(room);
      scannerRelay.publish(t.cmd(target.id), { type: 'control', action, value });
    }
  }
  restoreBtn.addEventListener('click', () => {
    nativeCastVideo.pause();
    sendControl('restore');
    activeTransferOrPlayback = false;
    remoteBar.classList.remove('show');
    if (window.StarkAudio) window.StarkAudio.playRestore();
    showToast('PANTALLA LIBERADA');
  });
  playBtn.addEventListener('click', () => sendControl('play'));
  pauseBtn.addEventListener('click', () => sendControl('pause'));
  seekSlider.addEventListener('change', () => sendControl('seek', Number(seekSlider.value)));
  volSlider.addEventListener('input', () => sendControl('volume', Number(volSlider.value)));
  muteBtn.addEventListener('click', () => sendControl('mute'));

  // ===== INTEGRATED RECEIVER (2-PHASE BLACK -> CYAN OPTICAL PULSE + FULLSCREEN PLAYER) =====
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

  const handleRxPacket = window.StarkTransport.createFileAssembler({
    onStart: (meta) => {
      if (meta.from) lastScannerFrom = meta.from;
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
    rxConnStatus.innerHTML = `<span class="status-dot"></span> CONECTANDO CANAL ${room.toUpperCase()}...`;

    rxRelay = window.StarkTransport.createRelayClient({
      clientId: rxScreenId,
      willTopic: t.presence,
      willPayload: { id: rxScreenId, online: false },
      onConnect: () => {
        rxRelay.subscribe(t.discover);
        rxRelay.subscribe(t.cmd(rxScreenId));
        publishRxPresence();
        rxConnStatus.innerHTML = `<span class="status-dot online"></span> EN LÍNEA // ENFOCA ESTA PANTALLA CON TU CELULAR`;
      },
      onDisconnect: () => {
        rxConnStatus.innerHTML = `<span class="status-dot"></span> RECONECTANDO CANAL ${room.toUpperCase()}...`;
      },
      onMessage: (topic, msg) => {
        if (topic === t.discover) {
          publishRxPresence();
          return;
        }
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

  rxUnlockBtn.addEventListener('click', () => {
    if (window.StarkAudio) window.StarkAudio.playLock();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    rxUnlockBtn.textContent = 'AUDIO Y PANTALLA LISTOS ✓';
    rxUnlockBtn.classList.remove('btn-amber');
    rxUnlockBtn.classList.add('btn-primary');
  });

  setInterval(() => {
    if (activeTab !== 'rx' || !rxRelay || !rxRelay.isConnected()) return;
    if (lastScannerFrom) {
      const p = rxActiveKind === 'audio' ? rxAudio : rxActiveKind === 'video' ? rxVideo : null;
      if (p) {
        const t = window.StarkTransport.topics(room);
        rxRelay.publish(t.ack(lastScannerFrom), {
          type: 'playback_state',
          screenId: rxScreenId,
          playing: !p.paused,
          currentTime: p.currentTime || 0,
          duration: isFinite(p.duration) ? p.duration : 0,
        });
      }
    }
  }, 600);

  window.addEventListener('beforeunload', () => {
    if (rxRelay) rxRelay.destroy();
    if (scannerRelay) scannerRelay.destroy();
  });

  // ===== REAL-TIME CAMERA-ONLY MONITOR LOCK & HUD LOOP =====
  function resizeHud() {
    hudCanvas.width = window.innerWidth;
    hudCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeHud);
  resizeHud();

  function drawCornerBrackets(ctx, pts, color, lineWidth, armLen) {
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
      const a1 = Math.min(armLen, l1 * 0.35);
      const a2 = Math.min(armLen, l2 * 0.35);
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
    if (activeTab !== 'scan') return;
    frame++;

    const W = hudCanvas.width;
    const H = hudCanvas.height;
    hudCtx.clearRect(0, 0, W, H);

    // Detect ONLY the physical monitor currently seen by the camera
    if (frame % 3 === 0 && cameraVideo.readyState >= 2) {
      const det = window.StarkVision.detectMonitors(cameraVideo, scratchCanvas, focusPoint);
      if (det.best) {
        missFrames = 0;
        stableMonitorFrames++;
        primaryMonitor = det.best;
        smoothPrimaryQuad = window.StarkVision.smoothQuad(smoothPrimaryQuad, det.best.quad, 0.3);

        if (!wasMonitorLocked) {
          wasMonitorLocked = true;
          if (window.StarkAudio) window.StarkAudio.playLock();
        }

        if (
          stableMonitorFrames >= 3 &&
          !getVerifiedTarget() &&
          !opticalProbeBusy &&
          scannerRelayOnline &&
          Date.now() - lastOpticalProbeAt > 3000
        ) {
          identifyVisibleMonitor();
        }
        updateRadarPill();
      } else {
        missFrames++;
        stableMonitorFrames = 0;
        if (missFrames > 14) {
          primaryMonitor = null;
          smoothPrimaryQuad = null;
          wasMonitorLocked = false;
          opticalNoMatch = false;
          if (!activeTransferOrPlayback) verifiedTarget = null;
          updateRadarPill();
        }
      }
    }

    const target = getVerifiedTarget();

    if (smoothPrimaryQuad && primaryMonitor) {
      const pts = smoothPrimaryQuad.map((p) => window.StarkVision.mapVideoNormToCanvas(p, cameraVideo, W, H));
      const lockColor = target ? '#00e676' : (opticalProbeBusy ? '#00e5ff' : '#ffb300');

      hudCtx.save();
      hudCtx.fillStyle = target ? 'rgba(0, 230, 118, 0.08)' : 'rgba(255, 179, 0, 0.07)';
      hudCtx.beginPath();
      hudCtx.moveTo(pts[0].x, pts[0].y);
      hudCtx.lineTo(pts[1].x, pts[1].y);
      hudCtx.lineTo(pts[2].x, pts[2].y);
      hudCtx.lineTo(pts[3].x, pts[3].y);
      hudCtx.closePath();
      hudCtx.fill();

      hudCtx.strokeStyle = target ? 'rgba(0, 230, 118, 0.6)' : 'rgba(0, 229, 255, 0.55)';
      hudCtx.lineWidth = 1.4;
      hudCtx.setLineDash([6, 6]);
      hudCtx.stroke();
      hudCtx.setLineDash([]);

      drawCornerBrackets(hudCtx, pts, lockColor, 3.2, 26);

      if (!target) {
        const sweep = (performance.now() * 0.0012) % 1;
        const lx1 = pts[0].x + (pts[3].x - pts[0].x) * sweep;
        const ly1 = pts[0].y + (pts[3].y - pts[0].y) * sweep;
        const lx2 = pts[1].x + (pts[2].x - pts[1].x) * sweep;
        const ly2 = pts[1].y + (pts[2].y - pts[1].y) * sweep;
        hudCtx.strokeStyle = opticalProbeBusy ? '#00e5ff' : 'rgba(0, 229, 255, 0.8)';
        hudCtx.lineWidth = 2;
        hudCtx.beginPath();
        hudCtx.moveTo(lx1, ly1);
        hudCtx.lineTo(lx2, ly2);
        hudCtx.stroke();
      }

      const pct = Math.round(primaryMonitor.confidence * 100);
      const tag = target
        ? `✓ ${target.name.toUpperCase()}`
        : opticalProbeBusy
          ? 'IDENTIFICANDO PANTALLA...'
          : `MONITOR ENFOCADO // ${pct}%`;

      hudCtx.font = '700 11px ui-monospace, monospace';
      const tw = hudCtx.measureText(tag).width + 14;
      const tx = Math.max(10, Math.min(W - tw - 10, pts[0].x));
      const ty = Math.max(146, pts[0].y - 10);
      hudCtx.fillStyle = 'rgba(4, 14, 24, 0.86)';
      hudCtx.fillRect(tx, ty - 16, tw, 20);
      hudCtx.strokeStyle = lockColor;
      hudCtx.lineWidth = 1;
      hudCtx.strokeRect(tx, ty - 16, tw, 20);
      hudCtx.fillStyle = lockColor;
      hudCtx.fillText(tag, tx + 7, ty - 2);
      hudCtx.restore();
    }

    // Center Stark Reticle
    const cx = W * focusPoint.x;
    const cy = H * focusPoint.y;
    const rot = performance.now() * 0.0008;
    hudCtx.save();
    hudCtx.translate(cx, cy);
    hudCtx.strokeStyle = target
      ? 'rgba(0, 230, 118, 0.8)'
      : primaryMonitor ? 'rgba(255, 179, 0, 0.72)' : 'rgba(0, 229, 255, 0.48)';
    hudCtx.lineWidth = 1.5;
    hudCtx.beginPath(); hudCtx.arc(0, 0, 44, rot, rot + Math.PI * 1.2); hudCtx.stroke();
    hudCtx.beginPath(); hudCtx.arc(0, 0, 32, -rot * 1.5, -rot * 1.5 + Math.PI * 0.8); hudCtx.stroke();
    hudCtx.beginPath();
    hudCtx.moveTo(-10, 0); hudCtx.lineTo(-4, 0);
    hudCtx.moveTo(4, 0); hudCtx.lineTo(10, 0);
    hudCtx.moveTo(0, -10); hudCtx.lineTo(0, -4);
    hudCtx.moveTo(0, 4); hudCtx.lineTo(0, 10);
    hudCtx.stroke();
    hudCtx.restore();
  }

  if (location.hash.toLowerCase() === '#receiver') {
    switchTab('rx');
  } else {
    switchTab('scan');
  }
  loop();
})();
