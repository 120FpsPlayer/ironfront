'use strict';

/**
 * Minecraft server status (Server List Ping, 1.7+): online players, version, MOTD and latency – the same thing the
 * multiplayer screen shows. Follows SRV records (_minecraft._tcp.host) like the game does.
 */

const net = require('node:net');
const dns = require('node:dns').promises;

function varInt(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

function readVarInt(buf, offset = 0) {
  let value = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value, size: i - offset };
    shift += 7;
    if (shift > 35) throw new Error('VarInt too big');
  }
}

function packet(id, ...parts) {
  const body = Buffer.concat([varInt(id), ...parts]);
  return Buffer.concat([varInt(body.length), body]);
}

function mcString(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varInt(b.length), b]);
}

/** Chat component / § codes → plain text. */
function motdText(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d.replace(/§[0-9a-fk-or]/gi, '');
  return `${motdText(d.text ?? '')}${(d.extra ?? []).map(motdText).join('')}`.replace(/§[0-9a-fk-or]/gi, '');
}

async function resolveTarget(address) {
  const m = /^\s*([^:\s]+)(?::(\d{1,5}))?\s*$/.exec(String(address ?? ''));
  if (!m) throw new Error('Nieprawidłowy adres serwera.');
  const host = m[1];
  if (m[2]) return { host, port: Number(m[2]), shownHost: host };
  try {
    const [srv] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (srv) return { host: srv.name, port: srv.port, shownHost: host };
  } catch {
    // no SRV record – the default port
  }
  return { host, port: 25565, shownHost: host };
}

/** { online, players: { online, max, sample }, version, motd, favicon, latency } – online:false on failure. */
async function ping(address, { timeout = 5000, protocol = 767 } = {}) {
  let target;
  try {
    target = await resolveTarget(address);
  } catch (err) {
    return { online: false, error: err.message };
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host: target.host, port: target.port });
    let data = Buffer.alloc(0);
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout, () => done({ online: false, error: 'Serwer nie odpowiada.' }));
    socket.on('error', () => done({ online: false, error: 'Serwer jest offline.' }));
    socket.on('connect', () => {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);
      socket.write(packet(0x00, varInt(protocol), mcString(target.shownHost), port, varInt(1)));
      socket.write(packet(0x00));
    });
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      try {
        const len = readVarInt(data);
        if (!len || data.length < len.size + len.value) return;
        const id = readVarInt(data, len.size);
        const strLen = readVarInt(data, len.size + id.size);
        const start = len.size + id.size + strLen.size;
        const json = JSON.parse(data.subarray(start, start + strLen.value).toString('utf8'));
        done({
          online: true,
          latency: Date.now() - started,
          version: json.version?.name ?? null,
          protocol: json.version?.protocol ?? null,
          players: { online: json.players?.online ?? 0, max: json.players?.max ?? 0, sample: (json.players?.sample ?? []).map((p) => p.name).slice(0, 12) },
          motd: motdText(json.description).trim(),
          favicon: typeof json.favicon === 'string' && json.favicon.startsWith('data:image/png;base64,') ? json.favicon : null,
        });
      } catch {
        done({ online: false, error: 'Nieprawidłowa odpowiedź serwera.' });
      }
    });
  });
}

module.exports = { ping, motdText, varInt, readVarInt, packet, mcString };
