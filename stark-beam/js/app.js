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

  const codeInput = document.getElementById('codeInput');
  const connectCodeBtn = document.getElementById('connectCodeBtn');
  const copyRxLinkBtn = document.getElementById('copyRxLinkBtn');
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

  // ===== STATE =====
  let activeTab = 'scan'; // 'scan' | 'rx'
  let facingMode = 'environment';
  let camStream = null;
  let selectedFile = null;

  // Optical detection state
  const scratchCanvas = document.createElement('canvas');
  const qrCanvas = document.createElement('canvas');
  let focusPoint = { x: 0.5, y: 0.45 };
  let smoothPrimaryQuad = null;
  let primaryMonitor = null;
  let secondaryMonitors = [];
  let missFrames = 0;
  let wasMonitorLocked = false;
  let detectedQrQuad = null;
  let detectedQrTime = 0;

  // Sender P2P state
  let senderPeer = null;
  let senderConn = null;
  let connectedCode = null;
  let connectingCode = null;
  let qrScanBusy = false;
  let lastQrAttemptAt = 0;

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

  function updateRadarPill() {
    if (connectedCode) {
      radarStatus.className = 'hud-mono connected';
      radarStatus.querySelector('.status-dot').className = 'status-dot online';
      radarStatusText.textContent = `ENLAZADO CON PANTALLA ${connectedCode} — LISTO`;
      return;
    }
    if (connectingCode) {
      radarStatus.className = 'hud-mono locked';
      radarStatus.querySelector('.status-dot').className = 'status-dot locked';
      radarStatusText.textContent = `CONECTANDO CON PANTALLA ${connectingCode}...`;
      return;
    }
    if (primaryMonitor) {
      const pct = Math.round(primaryMonitor.confidence * 100);
      const ratioLabel = primaryMonitor.aspect > 1.5 ? '16:9' : primaryMonitor.aspect > 1.15 ? '4:3' : 'VERTICAL';
      radarStatus.className = 'hud-mono locked';
      radarStatus.querySelector('.status-dot').className = 'status-dot locked';
      radarStatusText.textContent = `MONITOR DETECTADO [${ratioLabel} · ${pct}%] — LEYENDO QR...`;
      return;
    }
    radarStatus.className = 'hud-mono';
    radarStatus.querySelector('.status-dot').className = 'status-dot';
    radarStatusText.textContent = 'APUNTA A UN MONITOR O TV...';
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
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
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

  // Tap on viewfinder to prioritize a specific monitor when multiple are visible
  hudCanvas.addEventListener('pointerdown', (e) => {
    const rect = hudCanvas.getBoundingClientRect();
    focusPoint = {
      x: Math.max(0.1, Math.min(0.9, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0.15, Math.min(0.85, (e.clientY - rect.top) / rect.height)),
    };
    if (window.StarkAudio) window.StarkAudio.playLock();
  });

  // ===== TAB SWITCH (ESCÁNER / RECEPTOR TV) =====
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
      initReceiverPeer();
      connDot.className = 'status-dot online';
    } else {
      connDot.className = connectedCode ? 'status-dot online' : 'status-dot';
      if (!camStream) startCamera();
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
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    const kind = window.StarkP2P.getFileKind(file.name, file.type).toUpperCase();
    fileNameEl.textContent = `${file.name} (${mb} MB)`;
    fileHintEl.textContent = `LISTO [${kind}] • DESLIZA ↑ O TOCA TRANSMITIR`;
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
    ctx.fillText('TRANSMITIDO DESDE SR APPS — STARK BEAM', 40, 504);

    c.toBlob((blob) => {
      if (!blob) return;
      setSelectedFile(new File([blob], 'Stark_Mark_VI_Demo.jpeg', { type: 'image/jpeg' }));
      showToast('DEMO LISTO // DESLIZA ↑ PARA TRANSMITIR');
    }, 'image/jpeg', 0.92);
  });

  // ===== SENDER P2P =====
  function ensureSenderPeer() {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        return reject(new Error('Sin conexión a motor P2P (verifica internet)'));
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
        connectingCode = null;
        connectCodeBtn.disabled = false;
        showToast(err.type === 'peer-unavailable' ? 'CÓDIGO NO ACTIVO EN RECEPTOR TV' : 'ERROR P2P: ' + err.type);
        connDot.className = 'status-dot';
        updateRadarPill();
      });
    });
  }

  async function connectToReceiverCode(raw) {
    const code = window.StarkP2P.normalizeCode(raw);
    if (code.length < 4) {
      showToast('ESCRIBE EL CÓDIGO DE 4 LETRAS DEL RECEPTOR');
      return;
    }
    codeInput.value = code;
    if (connectedCode === code && senderConn && senderConn.open) return;
    if (connectingCode === code) return;

    connectingCode = code;
    connectCodeBtn.disabled = true;
    updateRadarPill();

    try {
      const p = await ensureSenderPeer();
      if (senderConn) { try { senderConn.close(); } catch (_) {} }
      const targetId = window.StarkP2P.peerIdForCode(code);
      const nextConn = p.connect(targetId, { reliable: true, serialization: 'json' });
      senderConn = nextConn;

      const timeout = setTimeout(() => {
        if (!nextConn.open) {
          connectingCode = null;
          connectCodeBtn.disabled = false;
          updateRadarPill();
          showToast('NO RESPONDE — VERIFICA QUE LA TV ESTÉ EN "RECEPTOR TV"');
        }
      }, 12000);

      nextConn.on('open', () => {
        clearTimeout(timeout);
        connectingCode = null;
        connectCodeBtn.disabled = false;
        connectedCode = code;
        connDot.className = 'status-dot online';
        if (window.StarkAudio) window.StarkAudio.playLock();
        updateRadarPill();
        showToast(`OBJETIVO ENLAZADO // PANTALLA ${code} ✓`);
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
        connectingCode = null;
        connectCodeBtn.disabled = false;
        if (senderConn === nextConn) {
          connectedCode = null;
          connDot.className = 'status-dot';
          remoteBar.classList.remove('show');
          updateRadarPill();
          showToast('DESCONECTADO DE LA PANTALLA');
        }
      });
    } catch (err) {
      connectingCode = null;
      connectCodeBtn.disabled = false;
      updateRadarPill();
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
        await navigator.share({ title: 'STARK BEAM — Receptor TV', url: rxUrl });
        return;
      } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(rxUrl);
      showToast('LINK RECEPTOR COPIADO ✓');
    } catch (_) {
      prompt('Abre este link en la TV o monitor:', rxUrl);
    }
  });

  // ===== BEAM EXECUTION =====
  async function executeBeam() {
    if (!selectedFile) {
      showToast('ELIGE UN ARCHIVO O TOCA "DEMO" PRIMERO');
      return;
    }
    if (!senderConn || !senderConn.open) {
      if (codeInput.value.trim().length >= 4) {
        await connectToReceiverCode(codeInput.value);
      } else {
        showToast('APUNTA AL QR DEL RECEPTOR TV O ESCRIBE SU CÓDIGO ARRIBA');
      }
      return;
    }

    if (window.StarkAudio) window.StarkAudio.playBeam();
    beamBtn.disabled = true;
    progressWrap.classList.add('show');
    progressBar.style.width = '2%';

    try {
      await window.StarkP2P.sendFileP2P(senderConn, selectedFile, (pct) => {
        progressBar.style.width = pct + '%';
        beamBtn.textContent = `ENVIANDO ${pct}%`;
      });
      remoteBar.classList.add('show');
      showToast(`SEÑAL INYECTADA EN PANTALLA ${connectedCode} ✓`);
    } catch (err) {
      showToast(err.message || 'ERROR EN TRANSMISIÓN');
    } finally {
      beamBtn.disabled = false;
      beamBtn.textContent = '▲ TRANSMITIR A PANTALLA';
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
    if (senderConn && senderConn.open) senderConn.send({ type: 'control', action, value });
  }
  restoreBtn.addEventListener('click', () => {
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

  // ===== INTEGRATED RECEIVER (RECEPTOR TV) =====
  function renderRxQr() {
    rxCodeText.textContent = rxCode;
    rxQrBox.innerHTML = '';
    if (typeof window.qrcode === 'function') {
      // Version 1, Error Correction L (21x21 chunky modules -> scannable from 2-3+ meters!)
      const qr = window.qrcode(0, 'L');
      qr.addData('SB:' + rxCode);
      qr.make();
      rxQrBox.innerHTML = qr.createImgTag(8, 0);
    } else {
      rxQrBox.innerHTML = `<div class="hud-mono" style="color:#031018;font-weight:800;font-size:22px">SB:${rxCode}</div>`;
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
      rxConnStatus.innerHTML = '<span class="status-dot online"></span> LISTO // APUNTA TU CELULAR A ESTE QR';
    });

    rxPeer.on('connection', (conn) => {
      rxConn = conn;
      conn.on('open', () => {
        if (window.StarkAudio) window.StarkAudio.playLock();
        rxConnStatus.innerHTML = '<span class="status-dot locked"></span> CELULAR STARK ENLAZADO // ESPERANDO ARCHIVO';
      });
      conn.on('data', (msg) => {
        if (handleRxPacket(msg)) return;
        if (msg && msg.type === 'control') handleRxControl(msg.action, msg.value);
      });
      conn.on('close', () => {
        rxConnStatus.innerHTML = '<span class="status-dot online"></span> LISTO // APUNTA TU CELULAR A ESTE QR';
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

  // ===== REAL-TIME MONITOR DETECTION & STARK HUD RENDER LOOP =====
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

    // 1. Run Connected-Component Optical Monitor Detection every 3 frames (~10-20 Hz)
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

    // 2. Run High-Resolution ROI-Zoomed QR Beacon Scanner every 10 frames
    if (frame % 10 === 0 && !qrScanBusy && cameraVideo.readyState >= 2 && Date.now() - lastQrAttemptAt > 1200) {
      qrScanBusy = true;
      const roi = primaryMonitor ? primaryMonitor.bbox : null;
      window.StarkVision.scanQrBeacon(cameraVideo, qrCanvas, roi)
        .then((hit) => {
          if (hit && hit.code) {
            detectedQrQuad = hit.quad;
            detectedQrTime = Date.now();
            if (hit.code !== connectedCode && hit.code !== connectingCode) {
              lastQrAttemptAt = Date.now();
              connectToReceiverCode(hit.code);
            }
          }
        })
        .catch(() => {})
        .finally(() => { qrScanBusy = false; });
    }

    // 3. Draw Secondary Detected Monitors (subtle cyan outline)
    secondaryMonitors.forEach((sec) => {
      const pts = sec.quad.map((p) => window.StarkVision.mapVideoNormToCanvas(p, cameraVideo, W, H));
      drawCornerBrackets(hudCtx, pts, 'rgba(0, 229, 255, 0.45)', 1.8, 16);
    });

    // 4. Draw Primary Locked Monitor Bounding Quad (Stark Target Lock!)
    if (smoothPrimaryQuad && primaryMonitor) {
      const pts = smoothPrimaryQuad.map((p) => window.StarkVision.mapVideoNormToCanvas(p, cameraVideo, W, H));
      const lockColor = connectedCode ? '#00e676' : '#ffb300';

      // Translucent HUD tint inside detected screen
      hudCtx.save();
      hudCtx.fillStyle = connectedCode ? 'rgba(0, 230, 118, 0.08)' : 'rgba(255, 179, 0, 0.08)';
      hudCtx.beginPath();
      hudCtx.moveTo(pts[0].x, pts[0].y);
      hudCtx.lineTo(pts[1].x, pts[1].y);
      hudCtx.lineTo(pts[2].x, pts[2].y);
      hudCtx.lineTo(pts[3].x, pts[3].y);
      hudCtx.closePath();
      hudCtx.fill();

      // Dashed perimeter + bold corner brackets
      hudCtx.strokeStyle = connectedCode ? 'rgba(0, 230, 118, 0.55)' : 'rgba(0, 229, 255, 0.55)';
      hudCtx.lineWidth = 1.4;
      hudCtx.setLineDash([6, 6]);
      hudCtx.stroke();
      hudCtx.setLineDash([]);

      drawCornerBrackets(hudCtx, pts, lockColor, 3.2, 26);

      // Animated scanning laser inside the detected screen
      if (!connectedCode) {
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

      // Telemetry Tag above screen
      const pct = Math.round(primaryMonitor.confidence * 100);
      const tag = connectedCode
        ? `TARGET LOCKED // TV ${connectedCode}`
        : `DISPLAY LOCKED // ${pct}%`;
      hudCtx.font = '700 11px ui-monospace, monospace';
      const tw = hudCtx.measureText(tag).width + 14;
      const tx = Math.max(10, Math.min(W - tw - 10, pts[0].x));
      const ty = Math.max(142, pts[0].y - 10);
      hudCtx.fillStyle = 'rgba(4, 14, 24, 0.84)';
      hudCtx.fillRect(tx, ty - 16, tw, 20);
      hudCtx.strokeStyle = lockColor;
      hudCtx.lineWidth = 1;
      hudCtx.strokeRect(tx, ty - 16, tw, 20);
      hudCtx.fillStyle = lockColor;
      hudCtx.fillText(tag, tx + 7, ty - 2);
      hudCtx.restore();
    }

    // 5. Highlight exact QR beacon box when read
    if (detectedQrQuad && Date.now() - detectedQrTime < 2200) {
      const qPts = detectedQrQuad.map((p) => window.StarkVision.mapVideoNormToCanvas(p, cameraVideo, W, H));
      drawCornerBrackets(hudCtx, qPts, '#00e676', 3, 18);
    }

    // 6. Center Stark Reticle (at focusPoint)
    const cx = W * focusPoint.x;
    const cy = H * focusPoint.y;
    const rot = performance.now() * 0.0008;
    hudCtx.save();
    hudCtx.translate(cx, cy);
    hudCtx.strokeStyle = connectedCode
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

  // Initial route (#receiver or ?code=XXXX)
  const hash = location.hash.toLowerCase();
  const qCode = new URLSearchParams(location.search).get('code');
  if (hash === '#receiver') {
    switchTab('rx');
  } else if (qCode) {
    switchTab('scan');
    connectToReceiverCode(qCode);
  } else {
    switchTab('scan');
  }
  loop();
})();
