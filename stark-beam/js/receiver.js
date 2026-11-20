(function () {
  const screenCodeEl = document.getElementById('screenCode');
  const qrBox = document.getElementById('qrBox');
  const connStatus = document.getElementById('connStatus');
  const unlockBtn = document.getElementById('unlockBtn');
  const standbyView = document.getElementById('standbyView');
  const transferOverlay = document.getElementById('transferOverlay');
  const transferBarFill = document.getElementById('transferBarFill');
  const transferPct = document.getElementById('transferPct');
  const mediaLayer = document.getElementById('mediaLayer');
  const imgPlayer = document.getElementById('imgPlayer');
  const videoPlayer = document.getElementById('videoPlayer');
  const audioStage = document.getElementById('audioStage');
  const audioPlayer = document.getElementById('audioPlayer');
  const audioCanvas = document.getElementById('audioCanvas');
  const audioTitle = document.getElementById('audioTitle');
  const audioTime = document.getElementById('audioTime');
  const overrideBanner = document.getElementById('overrideBanner');
  const overrideSub = document.getElementById('overrideSub');
  const liveHudTag = document.getElementById('liveHudTag');
  const liveFileLabel = document.getElementById('liveFileLabel');

  let code = sessionStorage.getItem('sr_stark_tv_code');
  if (!code) {
    code = window.StarkP2P.generateCode();
    sessionStorage.setItem('sr_stark_tv_code', code);
  }
  screenCodeEl.textContent = code;

  // Render scannable QR beacon (`STARK:XXXX`)
  function renderQr() {
    qrBox.innerHTML = '';
    if (typeof window.qrcode === 'function') {
      const qr = window.qrcode(0, 'M');
      qr.addData('STARK:' + code);
      qr.make();
      qrBox.innerHTML = qr.createImgTag(6, 0);
    } else {
      qrBox.innerHTML = `<div class="hud-mono" style="color:#031018;font-weight:800;font-size:20px">STARK:${code}</div>`;
    }
  }
  renderQr();

  let peer = null;
  let activeConn = null;
  let activeKind = null;
  let currentBlobUrl = null;
  let audioCtx = null;
  let analyser = null;
  let audioSrc = null;
  let rafId = null;

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  unlockBtn.addEventListener('click', () => {
    if (window.StarkAudio) window.StarkAudio.playLock();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    unlockBtn.textContent = 'AUDIO Y PANTALLA LISTOS ✓';
    unlockBtn.classList.remove('btn-amber');
    unlockBtn.classList.add('btn-primary');
  });

  function stopCurrentMedia() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    imgPlayer.style.display = 'none';
    imgPlayer.src = '';
    videoPlayer.pause();
    videoPlayer.style.display = 'none';
    videoPlayer.removeAttribute('src');
    videoPlayer.load();
    audioPlayer.pause();
    audioStage.style.display = 'none';
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    activeKind = null;
  }

  function startAudioVisualizer() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        audioSrc = audioCtx.createMediaElementSource(audioPlayer);
        audioSrc.connect(analyser);
        analyser.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}

    const ctx = audioCanvas.getContext('2d');
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : new Uint8Array(64);

    function draw() {
      rafId = requestAnimationFrame(draw);
      const w = audioCanvas.width;
      const h = audioCanvas.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      if (analyser) {
        analyser.getByteFrequencyData(bins);
      } else {
        const t = performance.now() * 0.005;
        for (let i = 0; i < bins.length; i++) bins[i] = 80 + Math.sin(t + i * 0.35) * 65;
      }

      const avg = bins.reduce((a, b) => a + b, 0) / bins.length;
      const radius = 78 + (avg / 255) * 16;

      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, radius * 0.62, 0, Math.PI * 2); ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 179, 0, 0.78)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, radius * 0.84, 0, Math.PI * 2); ctx.stroke();

      const count = 48;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const val = bins[i % bins.length] / 255;
        const len = 14 + val * 72;
        ctx.strokeStyle = val > 0.68 ? '#ffb300' : '#00e5ff';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.lineTo(cx + Math.cos(angle) * (radius + len), cy + Math.sin(angle) * (radius + len));
        ctx.stroke();
      }
      audioTime.textContent = `${formatTime(audioPlayer.currentTime)} / ${formatTime(audioPlayer.duration)}`;
    }
    draw();
  }

  function presentMedia(media) {
    stopCurrentMedia();
    currentBlobUrl = media.url;
    activeKind = media.kind || 'video';
    liveFileLabel.textContent = `OVERRIDE // ${media.name}`;
    overrideSub.textContent = `INYECTANDO ${media.name.toUpperCase()}`;

    if (window.StarkAudio) window.StarkAudio.playOverride();
    overrideBanner.classList.add('show');
    document.body.classList.add('glitch-active');
    setTimeout(() => document.body.classList.remove('glitch-active'), 820);

    setTimeout(() => {
      overrideBanner.classList.remove('show');
      standbyView.style.display = 'none';
      mediaLayer.classList.add('active');
      liveHudTag.classList.add('show');

      if (activeKind === 'image') {
        imgPlayer.src = media.url;
        imgPlayer.style.display = 'block';
      } else if (activeKind === 'audio') {
        audioStage.style.display = 'flex';
        audioTitle.textContent = media.name.toUpperCase();
        audioPlayer.src = media.url;
        audioPlayer.play().catch(() => {});
        startAudioVisualizer();
      } else {
        videoPlayer.src = media.url;
        videoPlayer.style.display = 'block';
        videoPlayer.muted = false;
        videoPlayer.play().catch(() => {
          videoPlayer.muted = true;
          videoPlayer.play().catch(() => {});
        });
      }
    }, 850);
  }

  function handleControl(action, value) {
    if (action === 'restore') {
      if (window.StarkAudio) window.StarkAudio.playRestore();
      stopCurrentMedia();
      mediaLayer.classList.remove('active');
      liveHudTag.classList.remove('show');
      standbyView.style.display = 'flex';
      return;
    }
    const player = activeKind === 'audio' ? audioPlayer : activeKind === 'video' ? videoPlayer : null;
    if (!player) return;
    if (action === 'play') player.play().catch(() => {});
    if (action === 'pause') player.pause();
    if (action === 'seek' && isFinite(Number(value))) player.currentTime = Number(value);
    if (action === 'volume' && isFinite(Number(value))) {
      player.muted = false;
      player.volume = Math.max(0, Math.min(1, Number(value)));
    }
    if (action === 'mute') player.muted = !player.muted;
  }

  const handleFilePacket = window.StarkP2P.createFileAssembler({
    onStart: (meta) => {
      transferOverlay.classList.add('show');
      transferBarFill.style.width = '2%';
      transferPct.textContent = `0% // ${meta.name}`;
    },
    onProgress: (pct, meta) => {
      transferBarFill.style.width = pct + '%';
      transferPct.textContent = `${pct}% // ${meta.name}`;
    },
    onComplete: (media) => {
      transferOverlay.classList.remove('show');
      presentMedia(media);
    },
  });

  function initPeer() {
    if (typeof window.Peer !== 'function') {
      connStatus.innerHTML = '<span class="status-dot hijacked"></span> ERROR CARGANDO MOTOR P2P';
      return;
    }
    const peerId = window.StarkP2P.peerIdForCode(code);
    peer = new window.Peer(peerId, { debug: 0 });

    peer.on('open', () => {
      connStatus.innerHTML = '<span class="status-dot online"></span> SEÑAL P2P LISTA // ESCANEA EL QR CON TU CELULAR';
    });

    peer.on('connection', (conn) => {
      activeConn = conn;
      conn.on('open', () => {
        if (window.StarkAudio) window.StarkAudio.playLock();
        connStatus.innerHTML = '<span class="status-dot locked"></span> CELULAR STARK ENLAZADO // ESPERANDO ARCHIVO';
      });
      conn.on('data', (msg) => {
        if (handleFilePacket(msg)) return;
        if (msg && msg.type === 'control') {
          handleControl(msg.action, msg.value);
        }
      });
      conn.on('close', () => {
        connStatus.innerHTML = '<span class="status-dot online"></span> SEÑAL P2P LISTA // ESCANEA EL QR CON TU CELULAR';
      });
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        code = window.StarkP2P.generateCode();
        sessionStorage.setItem('sr_stark_tv_code', code);
        screenCodeEl.textContent = code;
        renderQr();
        setTimeout(initPeer, 500);
      } else {
        connStatus.innerHTML = '<span class="status-dot"></span> RECONECTANDO SEÑAL...';
        setTimeout(initPeer, 3000);
      }
    });
  }

  // Report live playback progress to connected phone
  setInterval(() => {
    if (!activeConn || !activeConn.open) return;
    const player = activeKind === 'audio' ? audioPlayer : activeKind === 'video' ? videoPlayer : null;
    if (!player) return;
    activeConn.send({
      type: 'playback_state',
      playing: !player.paused,
      currentTime: player.currentTime || 0,
      duration: isFinite(player.duration) ? player.duration : 0,
    });
  }, 500);

  initPeer();
})();
