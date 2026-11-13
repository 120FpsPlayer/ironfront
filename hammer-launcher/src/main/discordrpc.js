'use strict';

/**
 * Discord Rich Presence ("Gra w Minecraft 1.21.1 · HammerShop") over Discord's local IPC socket.
 * Needs a Discord application ID in launcher.config.json → discordClientId; silently does nothing without Discord.
 */

const net = require('node:net');
const path = require('node:path');

function socketPaths(id = 0) {
  if (process.platform === 'win32') return [`\\\\?\\pipe\\discord-ipc-${id}`];
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return [base, path.join(base, 'app', 'com.discordapp.Discord'), path.join(base, 'snap.discord'), path.join(base, '.flatpak', 'com.discordapp.Discord', 'xdg-run')].map((d) => path.join(d, `discord-ipc-${id}`));
}

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

/** Reads Discord's answers: 8-byte header (op, length) + JSON. Calls onMessage(op, data) for each whole frame. */
function reader(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0);
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) return;
      let data = null;
      try {
        data = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'));
      } catch {
        data = null;
      }
      buf = buf.subarray(8 + len);
      onMessage(op, data);
    }
  };
}

function createPresence(clientId, { waitMs = 5000 } = {}) {
  let socket = null;
  let connecting = null;
  let last = null; // the newest activity asked for – so one cleared while connecting is not shown after all

  function open(p) {
    return new Promise((resolve) => {
      const c = net.createConnection(p, () => resolve(c));
      c.once('error', () => resolve(null));
    });
  }

  /** Connects and says hello; true once Discord answered READY. Commands sent before that can be dropped. */
  async function connect() {
    if (!clientId) return false;
    if (socket) return true;
    connecting ??= (async () => {
      let s = null;
      for (let i = 0; i < 10 && !s; i += 1) {
        for (const p of socketPaths(i)) {
          s = await open(p);
          if (s) break;
        }
      }
      if (!s) return false;
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), waitMs);
        s.on('data', reader((op, data) => {
          if (op === 1 && data?.evt === 'READY') {
            clearTimeout(timer);
            resolve(true);
          } else if (op === 2) {
            clearTimeout(timer);
            resolve(false); // Discord refused (e.g. an unknown application ID)
          } else if (op === 3) {
            s.write(frame(4, data ?? {})); // ping → pong
          }
        }));
        s.on('error', () => null);
        s.once('close', () => {
          clearTimeout(timer);
          resolve(false);
        });
        s.write(frame(0, { v: 1, client_id: clientId }));
      });
      if (!ok) {
        s.destroy();
        return false;
      }
      socket = s;
      s.once('close', () => {
        if (socket === s) socket = null;
      });
      return true;
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  }

  function send(activity) {
    socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, ...(activity ? { activity } : {}) }, nonce: String(Date.now()) + Math.random().toString(16).slice(2, 6) }));
  }

  return {
    async set(activity) {
      last = activity;
      if (!(await connect())) return false;
      if (last !== activity) return false; // cleared or replaced while connecting
      send(activity);
      return true;
    },
    async clear() {
      last = null;
      if (socket) send(null);
    },
    close() {
      socket?.destroy();
      socket = null;
    },
  };
}

module.exports = { createPresence, frame, socketPaths, reader };
