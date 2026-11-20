(function (root) {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function playLock() {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    [880, 1320].forEach((freq, idx) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(0.001, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.06 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.14);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.16);
    });
  }

  function playBeam() {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    osc2.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.34);
    osc2.frequency.setValueAtTime(440, now);
    osc2.frequency.exponentialRampToValueAtTime(2640, now + 0.34);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.34);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.45);
    osc2.stop(now + 0.45);
  }

  function playOverride() {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    const buf = c.createBuffer(1, c.sampleRate * 0.18, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (i % 120 < 40 ? 0.5 : 0.12);
    }
    const noise = c.createBufferSource();
    noise.buffer = buf;
    const nGain = c.createGain();
    nGain.gain.setValueAtTime(0.09, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.connect(nGain);
    nGain.connect(c.destination);
    noise.start(now);

    const sub = c.createOscillator();
    const sGain = c.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(140, now + 0.14);
    sub.frequency.exponentialRampToValueAtTime(520, now + 0.38);
    sGain.gain.setValueAtTime(0.12, now + 0.14);
    sGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    sub.connect(sGain);
    sGain.connect(c.destination);
    sub.start(now + 0.14);
    sub.stop(now + 0.45);
  }

  function playRestore() {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.25);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  root.StarkAudio = { playLock, playBeam, playOverride, playRestore };
})(typeof window !== 'undefined' ? window : globalThis);
