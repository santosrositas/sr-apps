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

  const radarStrip = document.getElementById('radarStrip');
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

  // Native AirPlay / Cast bridge
  const nativeCastVideo = document.getElementById('nativeCastVideo');

  // ===== STATE =====
  let activeTab = 'scan'; // 'scan' | 'rx'
  let room = window.StarkP2P.normalizeRoom(localStorage.getItem('sr_stark_room') || 'sr1');
  let facingMode = 'environment';
  let camStream = null;
  let selectedFile = null;
  let selectedObjectUrl = null;

  // Optical detection state
  const scratchCanvas = document.createElement('canvas');
  let focusPoint = { x: 0.5, y: 0.45 };
  let smoothPrimaryQuad = null;
  let primaryMonitor = null;
  let secondaryMonitors = [];
  let missFrames = 0;
  let wasMonitorLocked = false;

  // Auto-Discovery P2P Sender state
  let senderPeer = null;
  const discoveredScreens = new Map(); // slotNum -> { slot, name, resolution, conn }
  let selectedSlot = null;
  let scanningSlots = false;

  // Auto-Discovery Receiver state
  let rxPeer = null;
  let rxSlot = 1;
  let rxConn = null;
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
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 3000);
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateRoomLabels() {
    const label = 'CANAL: ' + room.toUpperCase();
    roomBtn.textContent = label;
    rxRoomBtn.textContent = label;
  }
  updateRoomLabels();

  function changeRoom() {
    const input = prompt('Nombre de tu canal automático (ej. SR1, CASA, OFICINA). Usa el mismo en tu cel y tu PC/TV:', room.toUpperCase());
    if (!input) return;
    room = window.StarkP2P.normalizeRoom(input);
    localStorage.setItem('sr_stark_room', room);
    updateRoomLabels();

    // Reset connections on new room
    for (const entry of discoveredScreens.values()) {
      try { entry.conn.close(); } catch (_) {}
    }
    discoveredScreens.clear();
    selectedSlot = null;
    renderRadarChips();

    if (activeTab === 'rx') {
      initReceiverAutoSlot(1);
    } else {
      scanAutoScreens(true);
    }
    showToast('CANAL CAMBIADO A ' + room.toUpperCase());
  }
  roomBtn.addEventListener('click', changeRoom);
  rxRoomBtn.addEventListener('click', changeRoom);

  function getActiveTarget() {
    if (selectedSlot && discoveredScreens.has(selectedSlot)) {
      const entry = discoveredScreens.get(selectedSlot);
      if (entry.conn && entry.conn.open) return entry;
    }
    for (const entry of discoveredScreens.values()) {
      if (entry.conn && entry.conn.open) {
        selectedSlot = entry.slot;
        return entry;
      }
    }
    return null;
  }

  function updateRadarPill() {
    const target = getActiveTarget();
    connDot.className = target ? 'status-dot online' : (primaryMonitor ? 'status-dot locked' : 'status-dot');

    if (target && primaryMonitor) {
      const pct = Math.round(primaryMonitor.confidence * 100);
      radarStatus.className = 'hud-mono connected';
      radarStatus.querySelector('.status-dot').className = 'status-dot online';
      radarStatusText.textContent = `MONITOR FIJADO (${pct}%) → ${target.name.toUpperCase()} LISTO`;
      return;
    }
    if (target) {
      radarStatus.className = 'hud-mono connected';
      radarStatus.querySelector('.status-dot').className = 'status-dot online';
      radarStatusText.textContent = `AUTO-ENLAZADO: ${target.name.toUpperCase()} — LISTO`;
      return;
    }
    if (primaryMonitor) {
      const pct = Math.round(primaryMonitor.confidence * 100);
      const ratioLabel = primaryMonitor.aspect > 1.5 ? '16:9' : primaryMonitor.aspect > 1.15 ? '4:3' : 'VERTICAL';
      radarStatus.className = 'hud-mono locked';
      radarStatus.querySelector('.status-dot').className = 'status-dot locked';
      radarStatusText.textContent = `MONITOR DETECTADO [${ratioLabel} · ${pct}%] — USA AIRPLAY O RECEPTOR`;
      return;
    }
    radarStatus.className = 'hud-mono';
    radarStatus.querySelector('.status-dot').className = 'status-dot';
    radarStatusText.textContent = scanningSlots ? 'BUSCANDO PANTALLAS EN TU CANAL...' : 'APUNTA A UN MONITOR O USA 📡 AIRPLAY / TV';
  }

  function renderRadarChips() {
    while (radarStrip.children.length > 2) {
      radarStrip.removeChild(radarStrip.lastChild);
    }
    for (const entry of discoveredScreens.values()) {
      if (!entry.conn || !entry.conn.open) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'screen-chip' + (entry.slot === selectedSlot ? ' selected' : '');
      chip.innerHTML = `<span class="status-dot online"></span><span>${entry.name}</span>`;
      chip.addEventListener('click', () => {
        selectedSlot = entry.slot;
        if (window.StarkAudio) window.StarkAudio.playLock();
        renderRadarChips();
        updateRadarPill();
        showToast('OBJETIVO: ' + entry.name.toUpperCase());
      });
      radarStrip.appendChild(chip);
    }
    updateRadarPill();
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

  hudCanvas.addEventListener('pointerdown', (e) => {
    const rect = hudCanvas.getBoundingClientRect();
    focusPoint = {
      x: Math.max(0.1, Math.min(0.9, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0.15, Math.min(0.85, (e.clientY - rect.top) / rect.height)),
    };
    if (window.StarkAudio) window.StarkAudio.playLock();
  });

  // ===== ZERO-QR AUTO-DISCOVERY ENGINE (SCANNER SIDE) =====
  function ensureSenderPeer() {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') return reject(new Error('Sin conexión a internet'));
      if (senderPeer && !senderPeer.destroyed && senderPeer.open) return resolve(senderPeer);
      if (senderPeer && !senderPeer.destroyed) {
        senderPeer.once('open', () => resolve(senderPeer));
        senderPeer.once('error', () => {});
        return;
      }
      senderPeer = new window.Peer(window.StarkP2P.PEER_CONFIG);
      senderPeer.once('open', () => resolve(senderPeer));
      // Silently ignore peer-unavailable during automatic slot probing
      senderPeer.on('error', () => {});
    });
  }

  async function scanAutoScreens(manualFeedback) {
    if (activeTab !== 'scan') return;
    scanningSlots = true;
    rescanBtn.textContent = '⟳ BUSCANDO...';
    updateRadarPill();

    try {
      const p = await ensureSenderPeer();
      for (let slot = 1; slot <= window.StarkP2P.MAX_SLOTS; slot++) {
        const existing = discoveredScreens.get(slot);
        if (existing && existing.conn && existing.conn.open) continue;

        const targetId = window.StarkP2P.slotPeerId(room, slot);
        const conn = p.connect(targetId, { reliable: true, serialization: 'json' });

        conn.on('open', () => {
          const entry = {
            slot,
            name: `Pantalla ${slot}`,
            resolution: '',
            conn,
          };
          discoveredScreens.set(slot, entry);
          if (!selectedSlot) selectedSlot = slot;
          if (window.StarkAudio) window.StarkAudio.playLock();
          renderRadarChips();
          showToast(`PANTALLA DETECTADA AUTOMÁTICAMENTE ✓`);
        });

        conn.on('data', (msg) => {
          if (!msg) return;
          if (msg.type === 'hello') {
            const entry = discoveredScreens.get(slot);
            if (entry) {
              entry.name = msg.name || `Pantalla ${slot}`;
              entry.resolution = msg.resolution || '';
              renderRadarChips();
            }
          } else if (msg.type === 'playback_state' && slot === selectedSlot && msg.duration > 0) {
            seekSlider.max = String(Math.floor(msg.duration));
            seekSlider.value = String(Math.floor(msg.currentTime || 0));
            timeReadout.textContent = formatTime(msg.currentTime || 0);
          }
        });

        conn.on('close', () => {
          const entry = discoveredScreens.get(slot);
          if (entry && entry.conn === conn) {
            discoveredScreens.delete(slot);
            if (selectedSlot === slot) selectedSlot = null;
            renderRadarChips();
          }
        });
      }
    } catch (_) {}

    setTimeout(() => {
      scanningSlots = false;
      rescanBtn.textContent = '⟳ BUSCAR PANTALLAS';
      updateRadarPill();
      if (manualFeedback && !getActiveTarget()) {
        showToast('SIN RECEPTOR EN CANAL ' + room.toUpperCase() + ' — USA 📡 AIRPLAY / TV O ABRE RECEPTOR TV');
      }
    }, 2600);
  }

  rescanBtn.addEventListener('click', () => scanAutoScreens(true));

  // Periodic background auto-discovery when no screen is paired yet
  setInterval(() => {
    if (activeTab === 'scan' && !getActiveTarget() && !scanningSlots) {
      scanAutoScreens(false);
    }
  }, 7000);

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
      initReceiverAutoSlot(1);
      connDot.className = 'status-dot online';
    } else {
      if (!camStream) startCamera();
      scanAutoScreens(false);
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
    selectedObjectUrl = URL.createObjectURL(file);

    const mb = (file.size / (1024 * 1024)).toFixed(2);
    const kind = window.StarkP2P.getFileKind(file.name, file.type).toUpperCase();
    fileNameEl.textContent = `${file.name} (${mb} MB)`;
    fileHintEl.textContent = `LISTO [${kind}] • DESLIZA ↑ O TOCA TRANSMITIR / AIRPLAY`;
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
    ctx.fillText('STARK INDUSTRIES // MARK VI OVERRIDE', 40, 62);
    ctx.fillStyle = '#ffb300'; ctx.font = 'bold 18px monospace';
    ctx.fillText('AUTO-BEAM SIN QR — SR APPS', 40, 504);

    c.toBlob((blob) => {
      if (!blob) return;
      setSelectedFile(new File([blob], 'Stark_Mark_VI_Demo.jpeg', { type: 'image/jpeg' }));
      showToast('DEMO LISTO // DESLIZA ↑ PARA TRANSMITIR');
    }, 'image/jpeg', 0.92);
  });

  // ===== NATIVE AIRPLAY (iOS) / REMOTE PLAYBACK (ANDROID) — ZERO APP ON TV! =====
  function launchNativeAirPlayOrCast() {
    if (!selectedFile || !selectedObjectUrl) {
      showToast('ELIGE UN MP4, MOV O MP3 PARA PROYECTAR POR AIRPLAY / CAST');
      return;
    }
    const kind = window.StarkP2P.getFileKind(selectedFile.name, selectedFile.type);
    if (kind === 'image') {
      showToast('AIRPLAY NATIVO ES PARA VIDEO/AUDIO (MP4/MOV/MP3). PARA JPEG USA TRANSMITIR AL RECEPTOR');
      return;
    }

    nativeCastVideo.src = selectedObjectUrl;
    nativeCastVideo.play().catch(() => {});

    // iOS Safari native AirPlay picker (Apple TV, Samsung/LG/Sony/Roku AirPlay 2 TVs, Mac!)
    if (typeof nativeCastVideo.webkitShowPlaybackTargetPicker === 'function') {
      try {
        nativeCastVideo.webkitShowPlaybackTargetPicker();
        showToast('SELECCIONA TU TV / APPLE TV / MAC EN AIRPLAY');
        return;
      } catch (_) {}
    }

    // Android Chrome / W3C Remote Playback API (Chromecast / Google TV / Android TV)
    if (nativeCastVideo.remote && typeof nativeCastVideo.remote.prompt === 'function') {
      nativeCastVideo.remote.prompt()
        .then(() => showToast('CONECTANDO CON TV POR CAST...'))
        .catch(() => showToast('NO SE ENCONTRARON TVs CAST EN ESTE NAVEGADOR'));
      return;
    }

    showToast('ESTE NAVEGADOR NO EXPONE AIRPLAY/CAST — USA RECEPTOR TV AUTOMÁTICO');
  }

  airplayBtn.addEventListener('click', launchNativeAirPlayOrCast);

  // ===== EXECUTE BEAM (AUTO-DISCOVERED SCREEN OR FALLBACK TO NATIVE AIRPLAY) =====
  async function executeBeam() {
    if (!selectedFile) {
      showToast('ELIGE UN ARCHIVO O TOCA "DEMO" PRIMERO');
      return;
    }

    const target = getActiveTarget();
    if (!target) {
      const kind = window.StarkP2P.getFileKind(selectedFile.name, selectedFile.type);
      // If user loaded video/audio on iPhone/Android and no web receiver is open, launch AirPlay/Cast directly!
      if (kind !== 'image' && (typeof nativeCastVideo.webkitShowPlaybackTargetPicker === 'function' || (nativeCastVideo.remote && nativeCastVideo.remote.prompt))) {
        launchNativeAirPlayOrCast();
        return;
      }
      scanAutoScreens(true);
      return;
    }

    if (window.StarkAudio) window.StarkAudio.playBeam();
    beamBtn.disabled = true;
    progressWrap.classList.add('show');
    progressBar.style.width = '2%';

    try {
      await window.StarkP2P.sendFileP2P(target.conn, selectedFile, (pct) => {
        progressBar.style.width = pct + '%';
        beamBtn.textContent = `ENVIANDO ${pct}%`;
      });
      remoteBar.classList.add('show');
      showToast(`ENVIADO A ${target.name.toUpperCase()} ✓`);
    } catch (err) {
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
    const target = getActiveTarget();
    if (target) target.conn.send({ type: 'control', action, value });
  }
  restoreBtn.addEventListener('click', () => {
    nativeCastVideo.pause();
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

  // ===== INTEGRATED RECEIVER (AUTO-SLOT REGISTRATION, ZERO QR) =====
  const myDeviceName = window.StarkP2P.detectDeviceName();
  rxDeviceTitle.textContent = myDeviceName;

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

  function initReceiverAutoSlot(slotNum) {
    if (rxPeer) { try { rxPeer.destroy(); } catch (_) {} rxPeer = null; }
    rxSlot = slotNum;
    if (typeof window.Peer !== 'function') {
      rxConnStatus.innerHTML = '<span class="status-dot hijacked"></span> ERROR DE CONEXIÓN';
      return;
    }
    const peerId = window.StarkP2P.slotPeerId(room, rxSlot);
    rxConnStatus.innerHTML = `<span class="status-dot"></span> CONECTANDO EN CANAL ${room.toUpperCase()} (SLOT ${rxSlot})...`;
    rxPeer = new window.Peer(peerId, window.StarkP2P.PEER_CONFIG);

    rxPeer.on('open', () => {
      rxConnStatus.innerHTML = `<span class="status-dot online"></span> VISIBLE EN AUTOMÁTICO — CANAL ${room.toUpperCase()} (#${rxSlot})`;
    });

    rxPeer.on('connection', (conn) => {
      rxConn = conn;
      conn.on('open', () => {
        if (window.StarkAudio) window.StarkAudio.playLock();
        conn.send({
          type: 'hello',
          slot: rxSlot,
          name: myDeviceName,
          resolution: `${window.screen.width}x${window.screen.height}`,
        });
        rxConnStatus.innerHTML = '<span class="status-dot locked"></span> CELULAR STARK ENLAZADO AUTOMÁTICAMENTE ✓';
      });
      conn.on('data', (msg) => {
        if (handleRxPacket(msg)) return;
        if (msg && msg.type === 'control') handleRxControl(msg.action, msg.value);
      });
      conn.on('close', () => {
        rxConnStatus.innerHTML = `<span class="status-dot online"></span> VISIBLE EN AUTOMÁTICO — CANAL ${room.toUpperCase()} (#${rxSlot})`;
      });
    });

    rxPeer.on('error', (err) => {
      if (err.type === 'unavailable-id' && rxSlot < window.StarkP2P.MAX_SLOTS) {
        initReceiverAutoSlot(rxSlot + 1);
      } else {
        rxConnStatus.innerHTML = '<span class="status-dot hijacked"></span> RECONECTANDO (' + err.type + ')...';
        setTimeout(() => initReceiverAutoSlot(1), 3500);
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    if (rxPeer) { try { rxPeer.destroy(); } catch (_) {} }
    if (senderPeer) { try { senderPeer.destroy(); } catch (_) {} }
  });

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

  // ===== REAL-TIME OPTICAL MONITOR DETECTION & STARK HUD LOOP =====
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

    // Run thin-bezel monitor detector every 3 frames
    if (frame % 3 === 0 && cameraVideo.readyState >= 2) {
      const det = window.StarkVision.detectMonitors(cameraVideo, scratchCanvas, focusPoint);
      if (det.best) {
        missFrames = 0;
        primaryMonitor = det.best;
        secondaryMonitors = det.candidates.slice(1);
        smoothPrimaryQuad = window.StarkVision.smoothQuad(smoothPrimaryQuad, det.best.quad, 0.3);
        if (!wasMonitorLocked) {
          wasMonitorLocked = true;
          if (window.StarkAudio) window.StarkAudio.playLock();
        }
        updateRadarPill();
      } else {
        missFrames++;
        if (missFrames > 6) {
          primaryMonitor = null;
          secondaryMonitors = [];
          smoothPrimaryQuad = null;
          wasMonitorLocked = false;
          updateRadarPill();
        }
      }
    }

    // Draw secondary monitors
    secondaryMonitors.forEach((sec) => {
      const pts = sec.quad.map((p) => window.StarkVision.mapVideoNormToCanvas(p, cameraVideo, W, H));
      drawCornerBrackets(hudCtx, pts, 'rgba(0, 229, 255, 0.45)', 1.8, 16);
    });

    const target = getActiveTarget();

    // Draw locked primary monitor box
    if (smoothPrimaryQuad && primaryMonitor) {
      const pts = smoothPrimaryQuad.map((p) => window.StarkVision.mapVideoNormToCanvas(p, cameraVideo, W, H));
      const lockColor = target ? '#00e676' : '#ffb300';

      hudCtx.save();
      hudCtx.fillStyle = target ? 'rgba(0, 230, 118, 0.08)' : 'rgba(255, 179, 0, 0.08)';
      hudCtx.beginPath();
      hudCtx.moveTo(pts[0].x, pts[0].y);
      hudCtx.lineTo(pts[1].x, pts[1].y);
      hudCtx.lineTo(pts[2].x, pts[2].y);
      hudCtx.lineTo(pts[3].x, pts[3].y);
      hudCtx.closePath();
      hudCtx.fill();

      hudCtx.strokeStyle = target ? 'rgba(0, 230, 118, 0.55)' : 'rgba(0, 229, 255, 0.55)';
      hudCtx.lineWidth = 1.4;
      hudCtx.setLineDash([6, 6]);
      hudCtx.stroke();
      hudCtx.setLineDash([]);

      drawCornerBrackets(hudCtx, pts, lockColor, 3.2, 26);

      if (!target) {
        const sweep = (performance.now() * 0.0009) % 1;
        const lx1 = pts[0].x + (pts[3].x - pts[0].x) * sweep;
        const ly1 = pts[0].y + (pts[3].y - pts[0].y) * sweep;
        const lx2 = pts[1].x + (pts[2].x - pts[1].x) * sweep;
        const ly2 = pts[1].y + (pts[2].y - pts[1].y) * sweep;
        hudCtx.strokeStyle = 'rgba(0, 229, 255, 0.85)';
        hudCtx.lineWidth = 2;
        hudCtx.beginPath();
        hudCtx.moveTo(lx1, ly1);
        hudCtx.lineTo(lx2, ly2);
        hudCtx.stroke();
      }

      const pct = Math.round(primaryMonitor.confidence * 100);
      const tag = target
        ? `LOCKED → ${target.name.toUpperCase()}`
        : `MONITOR DETECTED // ${pct}%`;
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
      ? 'rgba(0, 230, 118, 0.78)'
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

  // Initial route
  if (location.hash.toLowerCase() === '#receiver') {
    switchTab('rx');
  } else {
    switchTab('scan');
  }
  loop();
})();
