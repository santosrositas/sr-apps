/**
 * Server-less WebRTC P2P Engine for STARK BEAM (Powered by PeerJS).
 * Streams JPEG, PNG, MP3, MP4, and MOV files directly Phone <-> TV in 64KB chunks
 * with DataChannel backpressure handling so large videos transfer reliably on iOS & Android.
 */
(function (root) {
  const PEER_PREFIX = 'sr-starkbeam-';
  const CHUNK_SIZE = 64 * 1024; // 64 KB safe across Safari & Chrome WebRTC DataChannels

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function peerIdForCode(code) {
    return PEER_PREFIX + normalizeCode(code).toLowerCase();
  }

  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 4; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function getFileKind(name, mime) {
    const ext = (String(name || '').split('.').pop() || '').toLowerCase();
    if ((mime && mime.startsWith('image/')) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
    if ((mime && mime.startsWith('audio/')) || ['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
    return 'video';
  }

  async function waitForBufferDrain(conn) {
    const dc = conn && conn.dataChannel;
    if (!dc) return;
    while (dc.bufferedAmount > 512 * 1024 && conn.open) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /**
   * Streams a File/Blob over an open PeerJS DataConnection in 64KB chunks.
   */
  async function sendFileP2P(conn, file, onProgress) {
    if (!conn || !conn.open) throw new Error('Sin conexión P2P con la pantalla');
    const id = 'm-' + Date.now().toString(36);
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
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
      if (!conn.open) throw new Error('Conexión interrumpida durante transmisión');
      const start = i * CHUNK_SIZE;
      const slice = file.slice(start, Math.min(file.size, start + CHUNK_SIZE));
      const buffer = await slice.arrayBuffer();
      await waitForBufferDrain(conn);
      conn.send({
        type: 'file_chunk',
        id,
        index: i,
        data: buffer,
      });
      if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }

    conn.send({ type: 'file_end', id });
    return { id, kind };
  }

  /**
   * Creates a receiver-side reassembler for incoming chunked P2P files.
   */
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
        current.chunks[msg.index] = msg.data;
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
    normalizeCode,
    peerIdForCode,
    generateCode,
    getFileKind,
    sendFileP2P,
    createFileAssembler,
  };
})(typeof window !== 'undefined' ? window : globalThis);
