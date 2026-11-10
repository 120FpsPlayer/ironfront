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

function createPresence(clientId) {
  let socket = null;
  let ready = false;

  async function connect() {
    if (!clientId || socket) return ready;
    for (let i = 0; i < 10 && !socket; i += 1) {
      for (const p of socketPaths(i)) {
        const s = await new Promise((resolve) => {
          const c = net.createConnection(p, () => resolve(c));
          c.once('error', () => resolve(null));
        });
        if (s) {
          socket = s;
          break;
        }
      }
    }
    if (!socket) return false;
    socket.on('error', () => null);
    socket.on('close', () => {
      socket = null;
      ready = false;
    });
    socket.write(frame(0, { v: 1, client_id: clientId }));
    ready = true;
    return true;
  }

  return {
    async set(activity) {
      if (!clientId) return false;
      if (!(await connect())) return false;
      socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(Date.now()) }));
      return true;
    },
    async clear() {
      if (!socket) return;
      socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: String(Date.now()) }));
    },
    close() {
      socket?.destroy();
      socket = null;
    },
  };
}

module.exports = { createPresence, frame, socketPaths };
