/**
 * Zero-QR Auto-Discovery WebRTC P2P Engine (iOS Safari + Android Chrome + Desktop).
 * - Automatic room-slot discovery (slots 1..4) so Phone & TV/PC find each other with ZERO QR codes.
 * - Uses JSON serialization with 12KB base64 chunks + public STUN servers for rock-solid iOS/Android streaming.
 */
(function (root) {
  const MAX_SLOTS = 4;
  const CHUNK_BYTES = 12 * 1024; // 12 KB raw -> ~16 KB base64 (safe on iOS Safari & Android Chrome)

  const PEER_CONFIG = {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
      ],
    },
  };

  function normalizeRoom(room) {
    const clean = String(room || 'sr1').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    return clean || 'sr1';
  }

  function slotPeerId(room, slotNum) {
    return `sr-sb-${normalizeRoom(room)}-r${slotNum}`;
  }

  function detectDeviceName() {
    if (typeof navigator === 'undefined') return 'Pantalla';
    const ua = navigator.userAgent || '';
    if (/SmartTV|Tizen|Web0S|BRAVIA|AppleTV|Roku|AFT/i.test(ua)) return 'Smart TV';
    if (/Windows/i.test(ua)) return 'Monitor Windows';
    if (/Macintosh|Mac OS/i.test(ua)) return 'Monitor Mac';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Pantalla Android';
    if (/Linux/i.test(ua)) return 'Monitor Linux';
    return 'Pantalla Web';
  }

  function getFileKind(name, mime) {
    const ext = (String(name || '').split('.').pop() || '').toLowerCase();
    if ((mime && mime.startsWith('image/')) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
    if ((mime && mime.startsWith('audio/')) || ['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
    return 'video';
  }

  function uint8ToBase64(u8) {
    let bin = '';
    const step = 0x4000;
    for (let i = 0; i < u8.length; i += step) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + step));
    }
    return btoa(bin);
  }

  function base64ToUint8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function waitForBufferDrain(conn) {
    const dc = conn && conn.dataChannel;
    if (!dc) return;
    let tries = 0;
    while (dc.bufferedAmount > 256 * 1024 && conn.open && tries < 400) {
      await new Promise((r) => setTimeout(r, 25));
      tries++;
    }
  }

  async function sendFileP2P(conn, file, onProgress) {
    if (!conn || !conn.open) throw new Error('Sin conexión activa con la pantalla');
    const id = 'm-' + Date.now().toString(36);
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
    const kind = getFileKind(file.name, file.type);

    conn.send({
      type: 'file_start',
      id,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      kind,
      size: file.size,
      totalChunks,
    });

    for (let i = 0; i < totalChunks; i++) {
      if (!conn.open) throw new Error('Se perdió la conexión con la pantalla');
      const start = i * CHUNK_BYTES;
      const slice = file.slice(start, Math.min(file.size, start + CHUNK_BYTES));
      const buf = await slice.arrayBuffer();
      const b64 = uint8ToBase64(new Uint8Array(buf));

      await waitForBufferDrain(conn);
      conn.send({
        type: 'file_chunk',
        id,
        index: i,
        b64,
      });

      if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    conn.send({ type: 'file_end', id });
    return { id, kind };
  }

  function createFileAssembler({ onStart, onProgress, onComplete }) {
    let current = null;

    return function handlePacket(msg) {
      if (!msg || typeof msg !== 'object') return false;

      if (msg.type === 'file_start') {
        current = {
          id: msg.id,
          name: msg.name,
          mime: msg.mime,
          kind: msg.kind,
          size: msg.size,
          totalChunks: msg.totalChunks,
          received: 0,
          chunks: new Array(msg.totalChunks),
        };
        if (onStart) onStart(current);
        return true;
      }

      if (msg.type === 'file_chunk' && current && msg.id === current.id) {
        current.chunks[msg.index] = msg.b64 ? base64ToUint8(msg.b64) : msg.data;
        current.received++;
        const pct = Math.round((current.received / current.totalChunks) * 100);
        if (onProgress) onProgress(pct, current);
        return true;
      }

      if (msg.type === 'file_end' && current && msg.id === current.id) {
        const blob = new Blob(current.chunks, { type: current.mime });
        const url = URL.createObjectURL(blob);
        const done = { ...current, url, blob };
        current = null;
        if (onComplete) onComplete(done);
        return true;
      }

      return false;
    };
  }

  root.StarkP2P = {
    MAX_SLOTS,
    PEER_CONFIG,
    normalizeRoom,
    slotPeerId,
    detectDeviceName,
    getFileKind,
    sendFileP2P,
    createFileAssembler,
  };
})(typeof window !== 'undefined' ? window : globalThis);
