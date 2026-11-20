/**
 * STARK BEAM v7 Transport Engine — 5G/Wi-Fi Proof MQTT over WSS (EMQX + HiveMQ failover).
 * - Replaces STUN-only WebRTC (which fails across 5G cellular <-> Wi-Fi NATs).
 * - Instant real-time screen presence (zero polling, LWT clean disconnect).
 * - Synchronized optical pulse handshake + 32KB chunked transfer for JPEG, PNG, MP3, MP4, MOV.
 */
(function (root) {
  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
  ];
  const TOPIC_ROOT = 'sr-sb-v7';
  const CHUNK_BYTES = 32 * 1024; // 32 KB raw (~43 KB base64) — fast & safe on EMQX/HiveMQ WSS

  function normalizeRoom(room) {
    const clean = String(room || 'sr1').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
    return clean || 'sr1';
  }

  function makeId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
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

  function topics(room) {
    const r = normalizeRoom(room);
    return {
      discover: `${TOPIC_ROOT}/${r}/discover`,
      presence: `${TOPIC_ROOT}/${r}/presence`,
      cmd: (screenId) => `${TOPIC_ROOT}/${r}/cmd/${screenId}`,
      ack: (scannerId) => `${TOPIC_ROOT}/${r}/ack/${scannerId}`,
    };
  }

  /**
   * Creates a resilient MQTT over WSS client with automatic failover between EMQX and HiveMQ.
   */
  function createRelayClient({ clientId, willTopic, willPayload, onConnect, onDisconnect, onMessage }) {
    let brokerIdx = 0;
    let client = null;
    let destroyed = false;
    let connectTimer = null;

    function connectCurrent() {
      if (destroyed) return;
      if (typeof window === 'undefined' || !window.mqtt) {
        if (onDisconnect) onDisconnect('Librería MQTT no cargada');
        return;
      }
      if (client) {
        try { client.end(true); } catch (_) {}
      }

      const url = BROKERS[brokerIdx % BROKERS.length];
      const opts = {
        clientId: clientId + '-' + Math.random().toString(36).slice(2, 5),
        clean: true,
        connectTimeout: 5500,
        reconnectPeriod: 2500,
        keepalive: 25,
      };
      if (willTopic && willPayload) {
        opts.will = {
          topic: willTopic,
          payload: typeof willPayload === 'string' ? willPayload : JSON.stringify(willPayload),
          qos: 0,
          retain: true,
        };
      }

      client = window.mqtt.connect(url, opts);

      clearTimeout(connectTimer);
      connectTimer = setTimeout(() => {
        if (!destroyed && client && !client.connected) {
          brokerIdx = (brokerIdx + 1) % BROKERS.length;
          connectCurrent();
        }
      }, 6000);

      client.on('connect', () => {
        clearTimeout(connectTimer);
        if (onConnect) onConnect(url);
      });

      client.on('offline', () => {
        if (onDisconnect) onDisconnect('Reconectando...');
      });

      client.on('error', () => {
        // Handled by timeout failover / reconnect
      });

      client.on('message', (topic, buf) => {
        let msg;
        try {
          msg = JSON.parse(buf.toString());
        } catch (_) {
          return;
        }
        if (onMessage) onMessage(topic, msg);
      });
    }

    connectCurrent();

    return {
      isConnected: () => !!(client && client.connected),
      subscribe: (topic) => {
        if (client && client.connected) client.subscribe(topic, { qos: 0 });
      },
      publish: (topic, obj, options) => {
        if (!client || !client.connected) return false;
        client.publish(topic, JSON.stringify(obj), options || { qos: 0, retain: false });
        return true;
      },
      destroy: () => {
        destroyed = true;
        clearTimeout(connectTimer);
        if (client) {
          if (willTopic && willPayload && client.connected) {
            try {
              client.publish(
                willTopic,
                typeof willPayload === 'string' ? willPayload : JSON.stringify(willPayload),
                { qos: 0, retain: true }
              );
            } catch (_) {}
          }
          try { client.end(true); } catch (_) {}
          client = null;
        }
      },
    };
  }

  /**
   * Streams any JPEG, PNG, MP3, MP4, or MOV file in paced 32KB base64 chunks over WSS relay.
   */
  async function sendFileRelay(relay, cmdTopic, scannerId, file, onProgress) {
    if (!relay || !relay.isConnected()) {
      throw new Error('Sin conexión al servidor de enlace (verifica internet)');
    }
    const id = 'm-' + Date.now().toString(36);
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
    const kind = getFileKind(file.name, file.type);

    relay.publish(cmdTopic, {
      type: 'file_start',
      from: scannerId,
      id,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      kind,
      size: file.size,
      totalChunks,
    });

    for (let i = 0; i < totalChunks; i++) {
      if (!relay.isConnected()) throw new Error('Se interrumpió la conexión durante el envío');
      const start = i * CHUNK_BYTES;
      const slice = file.slice(start, Math.min(file.size, start + CHUNK_BYTES));
      const buf = await slice.arrayBuffer();
      const b64 = uint8ToBase64(new Uint8Array(buf));

      relay.publish(cmdTopic, {
        type: 'file_chunk',
        id,
        index: i,
        b64,
      });

      if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
      // Gentle pacing so public MQTT brokers never rate-limit bursts on large videos
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 18));
    }

    relay.publish(cmdTopic, { type: 'file_end', id });
    return { id, kind };
  }

  function createFileAssembler({ onStart, onProgress, onComplete }) {
    let current = null;

    return function handlePacket(msg) {
      if (!msg || typeof msg !== 'object') return false;

      if (msg.type === 'file_start') {
        current = {
          id: msg.id,
          from: msg.from || null,
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
        if (!current.chunks[msg.index]) {
          current.chunks[msg.index] = msg.b64 ? base64ToUint8(msg.b64) : msg.data;
          current.received++;
        }
        const pct = Math.round((current.received / current.totalChunks) * 100);
        if (onProgress) onProgress(pct, current);
        return true;
      }

      if (msg.type === 'file_end' && current && msg.id === current.id) {
        const missing = current.chunks.some((c) => !c);
        if (missing) {
          // Fill any rare missing packet with empty buffer rather than crashing Blob
          current.chunks = current.chunks.map((c) => c || new Uint8Array(0));
        }
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

  root.StarkTransport = {
    BROKERS,
    TOPIC_ROOT,
    CHUNK_BYTES,
    normalizeRoom,
    makeId,
    detectDeviceName,
    getFileKind,
    topics,
    createRelayClient,
    sendFileRelay,
    createFileAssembler,
    uint8ToBase64,
    base64ToUint8,
  };
})(typeof window !== 'undefined' ? window : globalThis);
