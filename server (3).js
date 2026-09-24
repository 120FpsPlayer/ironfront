/* =========================================================
   IRONFRONT — lobbyserver för co-op
   Kör:   node server.js      (inga paket behövs — Node 18+ räcker)
   Port:  8787 lokalt, eller porten hostingpanelen ger (SERVER_PORT)

   Servern är medvetet "dum": den håller reda på lobbyer och
   koder och skickar vidare meddelanden. Själva striden räknas
   ut hos värden (host) — servern vet ingenting om robotar,
   fiender eller skott. Det gör den liten, billig att köra och
   omöjlig att fuska via.

   Meddelanden (JSON), klient → server:
     { t:'hello', name, robot, slot }        första meddelandet
     { t:'create' }                          skapa lobby, bli värd
     { t:'join', code }                      gå med via kod
     { t:'ready', ready:true|false }
     { t:'start', params }                   bara värden
     { t:'leave' }
     { t:'relay', data }                     värd → alla gäster, gäst → värd
   Server → klient:
     { t:'welcome', id }
     { t:'lobby', code, you, host, started, players:[{id,name,robot,ready,host}] }
     { t:'start', params, players:[{id,name,robot,slot}] }
     { t:'relay', from, data }
     { t:'left', id, name }  { t:'closed', reason }  { t:'error', reason }
   ========================================================= */
// Vanlig CommonJS (require) — då går filen att köra var som helst med
// `node server.js`, utan package.json och utan "type": "module".
const { createServer } = require('http');
const { createHash, randomBytes, scryptSync, timingSafeEqual } = require('crypto');
const fs = require('fs');
const path = require('path');

/* ---------------------------------------------------------
   Minimal WebSocket-server utan beroenden
   Hela servern är EN fil — inget npm install, inga paket.
   Ladda upp filen, starta den, klart. Den här delen gör
   handskakningen och packar upp/in textramar enligt RFC 6455;
   resten av filen ser ut precis som med ett vanligt bibliotek.
   --------------------------------------------------------- */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket {
  constructor(sock){
    this.sock = sock;
    this.readyState = 1;
    this.OPEN = 1;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.handlers = { message: [], close: [], pong: [] };
    sock.setNoDelay(true);
    sock.on('data', d => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  on(ev, fn){ (this.handlers[ev] || (this.handlers[ev] = [])).push(fn); }
  _emit(ev, arg){ for (const fn of this.handlers[ev] || []) fn(arg); }
  _closed(){
    if (this.readyState === 3) return;
    this.readyState = 3;
    this._emit('close');
  }
  _frame(op, payload){
    const len = payload.length;
    let head;
    if (len < 126){ head = Buffer.from([0x80 | op, len]); }
    else if (len < 65536){ head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.sock.write(Buffer.concat([head, payload])); } catch { this._closed(); }
  }
  send(text){ if (this.readyState === 1) this._frame(0x1, Buffer.from(text, 'utf8')); }
  ping(){ if (this.readyState === 1) this._frame(0x9, Buffer.alloc(0)); }
  terminate(){ this.readyState = 3; try { this.sock.destroy(); } catch {} this._emit('close'); }
  _data(chunk){
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2){
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126){ if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127){ if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20){ this.terminate(); return; }          // skydd: max 1 MB per meddelande
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked){
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      if (op === 0x8){ this._frame(0x8, Buffer.alloc(0)); this.sock.end(); this._closed(); return; }
      if (op === 0x9){ this._frame(0xA, payload); continue; }
      if (op === 0xA){ this._emit('pong'); continue; }
      if (op === 0x1 || op === 0x2 || op === 0x0){
        this.frag.push(payload);
        if (fin){ const msg = Buffer.concat(this.frag).toString('utf8'); this.frag = []; this._emit('message', msg); }
      }
    }
  }
}

class WebSocketServer {
  constructor({ port, host }){
    this.clients = new Set();
    this.handlers = [];
    this.http = createServer((req, res) => {
      if (this.onHttp && this.onHttp(req, res)) return;
      // En vanlig webbläsarsida hit visar bara att servern lever
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`IRONFRONT-servern är igång. ${this.clients.size} anslutna.`);
    });
    this.http.on('upgrade', (req, sock) => {
      const key = req.headers['sec-websocket-key'];
      if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket'){ sock.destroy(); return; }
      const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                 `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const ws = new Socket(sock);
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      for (const fn of this.handlers) fn(ws, req);
    });
    this.http.listen(port, host);
  }
  on(ev, fn){ if (ev === 'connection') this.handlers.push(fn); }
}

/* =========================================================
   ADMINLÖSENORD
   Byt 'byt-mig' till ett eget lösenord. Adminsidan når du sedan
   på  http://<serverns-ip>:<port>/admin  — där ser du vem som är
   online, pågående lobbyer, loggen, och kan sparka ut eller
   spärra spelare. Så länge lösenordet är 'byt-mig' är sidan av.
   ========================================================= */
const ADMIN_KEY = process.env.ADMIN_KEY || 'byt-mig';

// Hostingpaneler (Wispbyte, Pterodactyl m.fl.) ger dig en port och lägger
// den i SERVER_PORT. Lokalt används PORT eller 8787.
const PORT = Number(process.env.SERVER_PORT) || Number(process.env.PORT) || 8787;
const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const lobbies = new Map();   // kod → { code, host, players: Map<id, client>, started }

/* ---------------------------------------------------------
   NAMNREGISTER
   Varje namn får bara finnas en gång. När någon tar ett namn
   får den en hemlig nyckel (token) som sparas i spelarens
   sparfil — bara den som har nyckeln kan använda namnet igen.
   Registret sparas i names.json bredvid serverfilen, så det
   finns kvar när servern startas om.
   --------------------------------------------------------- */
const NAMES_FILE = path.join(__dirname, 'names.json');
let names = {};              // namn i gemener → { name, token, since }
try { names = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')) || {}; } catch { names = {}; }
let saveTimer = null;
function saveNames(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(NAMES_FILE, JSON.stringify(names), () => {});
  }, 500);
}
const NAME_RE = /^[A-Za-z0-9ÅÄÖåäöÉéÜü_\-]{3,16}$/;
function nameError(name){
  if (!NAME_RE.test(name)) return 'Namnet ska vara 3–16 tecken: bokstäver, siffror, _ eller -.';
  return null;
}
/** Lediga namn: finns inte, eller ägs redan av den här nyckeln. */
function nameFree(name, token){
  const e = names[name.toLowerCase()];
  return !e || (token && e.token === token);
}

/* ---------------------------------------------------------
   KONTON: lösenord
   Lösenordet sparas aldrig i klartext — bara ett saltat
   scrypt-hash. Med namn + lösenord kan man logga in på en
   annan dator och få tillbaka sin nyckel och sin sparfil.
   --------------------------------------------------------- */
function hashPass(password, salt = randomBytes(16).toString('hex')){
  return { salt, hash: scryptSync(String(password), salt, 32).toString('hex') };
}
function checkPass(entry, password){
  if (!entry?.pass) return false;
  const a = Buffer.from(hashPass(password, entry.pass.salt).hash, 'hex');
  const b = Buffer.from(entry.pass.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const passError = p => (!p || String(p).length < 4) ? 'Lösenordet måste vara minst 4 tecken.' : String(p).length > 64 ? 'Lösenordet är för långt.' : null;

/* ---------------------------------------------------------
   JSON-filer på disk (skrivs med en kort fördröjning)
   --------------------------------------------------------- */
function loadJson(file, fallback){ try { return JSON.parse(fs.readFileSync(file, 'utf8')) || fallback; } catch { return fallback; } }
const timers = {};
function saveJson(file, data){
  clearTimeout(timers[file]);
  timers[file] = setTimeout(() => fs.writeFile(file, JSON.stringify(data), () => {}), 400);
}

/* ---------------------------------------------------------
   SPÄRRAR — namn och IP-adresser som inte får spela
   --------------------------------------------------------- */
const BANS_FILE = path.join(__dirname, 'banned.json');
const bans = loadJson(BANS_FILE, { names: [], ips: [] });
const nameBanned = n => bans.names.includes(String(n || '').toLowerCase());
const ipBanned = ip => bans.ips.includes(ip);

/* ---------------------------------------------------------
   MOLNSPARNING — en fil per konto i data/saves/
   --------------------------------------------------------- */
const DATA_DIR = path.join(__dirname, 'data');
const SAVE_DIR = path.join(DATA_DIR, 'saves');
try { fs.mkdirSync(SAVE_DIR, { recursive: true }); } catch {}
const saveFile = name => path.join(SAVE_DIR, name.toLowerCase().replace(/[^a-z0-9åäöéü_-]/gi, '_') + '.json');
const MAX_SAVE = 300 * 1024;

/* ---------------------------------------------------------
   TOPPLISTOR
   Byggs av det spelarna skickar in (sparfil och resultat).
   Spelet räknas ut i webbläsaren, så en bestämd fuskare kan
   ljuga — för en kompisserver räcker det gott.
   --------------------------------------------------------- */
const BOARD_FILE = path.join(DATA_DIR, 'board.json');
const board = loadJson(BOARD_FILE, {});      // namn i gemener → { name, level, xp, sector, score, title, weekly }

function isoWeekId(date = new Date()){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-v${Math.ceil(((d - y0) / 86400000 + 1) / 7)}`;
}

function boardFromSave(name, data){
  const k = name.toLowerCase();
  const e = board[k] || (board[k] = { name });
  e.name = name;
  e.level = Math.max(1, Math.min(30, Number(data.level) || 1));
  e.xp = Math.max(0, Number(data.xp) || 0);
  e.sector = Math.max(0, (Number(data.sector) || 1) - 1);          // högsta rensade sektor
  e.score = Math.max(e.score || 0, Number(data.bestScore) || 0);
  e.updated = Date.now();
  saveJson(BOARD_FILE, board);
}

function topList(kind){
  const week = isoWeekId();
  let rows = Object.values(board).filter(e => !nameBanned(e.name));
  if (kind === 'level') rows = rows.sort((a, b) => b.level - a.level || b.xp - a.xp).map(e => ({ name: e.name, value: e.level, extra: `${e.xp} XP` }));
  else if (kind === 'sector') rows = rows.filter(e => e.sector > 0).sort((a, b) => b.sector - a.sector || b.level - a.level).map(e => ({ name: e.name, value: e.sector, extra: `nivå ${e.level}` }));
  else if (kind === 'score') rows = rows.filter(e => e.score > 0).sort((a, b) => b.score - a.score).map(e => ({ name: e.name, value: e.score, extra: `nivå ${e.level}` }));
  else if (kind === 'bossrush' || kind === 'timeattack') rows = rows.filter(e => e.trials?.[kind]?.time > 0).sort((a, b) => a.trials[kind].time - b.trials[kind].time)
                                   .map(e => ({ name: e.name, value: e.trials[kind].time, extra: `nivå ${e.level}` }));
  else if (kind === 'daily'){
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    rows = rows.filter(e => e.trials?.daily?.day === today).sort((a, b) => b.trials.daily.score - a.trials.daily.score)
               .map(e => ({ name: e.name, value: e.trials.daily.score, extra: `nivå ${e.level}` }));
  }
  else if (kind === 'survival') rows = rows.filter(e => e.survival?.wave > 0).sort((a, b) => b.survival.wave - a.survival.wave || b.survival.score - a.survival.score)
                                   .map(e => ({ name: e.name, value: e.survival.wave, extra: `${e.survival.score} poäng` }));
  else if (kind === 'weekly') rows = rows.filter(e => e.weekly?.id === week).sort((a, b) => (b.weekly.won - a.weekly.won) || b.weekly.score - a.weekly.score)
                                   .map(e => ({ name: e.name, value: e.weekly.score, extra: e.weekly.won ? 'klarad ✓' : `våg ${e.weekly.wave}` }));
  else rows = [];
  return { rows, week };
}
let nextId = 1;

/* ---------------------------------------------------------
   LOGG
   Allt som händer skrivs både till konsolen (syns i Wispbyte-
   panelen) och till en fil per dag i mappen logs/, t.ex.
   logs/2026-09-23.log. Loggar äldre än LOG_DAYS dagar tas
   bort automatiskt så att disken inte fylls.
   Varje rad: tid, händelse, vem (id och namn) och detaljer.
   --------------------------------------------------------- */
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_DAYS = 30;
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const pad = n => String(n).padStart(2, '0');
function stamp(d = new Date()){
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function who(c){ return c ? `${c.id}${c.name && c.name !== 'Spelare' ? ' "' + c.name + '"' : ''}` : ''; }
const recentLog = [];            // de senaste raderna, för adminsidan
function log(event, c, details = ''){
  const line = `[${stamp()}] ${event.padEnd(16)} ${who(c)}${details ? '  ' + details : ''}`;
  console.log(line);
  recentLog.push(line);
  if (recentLog.length > 400) recentLog.shift();
  fs.appendFile(path.join(LOG_DIR, stamp().slice(0, 10) + '.log'), line + '\n', () => {});
}
function pruneLogs(){
  const limit = Date.now() - LOG_DAYS * 86400000;
  fs.readdir(LOG_DIR, (err, files) => {
    if (err) return;
    for (const f of files){
      const t = Date.parse(f.slice(0, 10));
      if (f.endsWith('.log') && t && t < limit) fs.unlink(path.join(LOG_DIR, f), () => {});
    }
  });
}
pruneLogs();
setInterval(pruneLogs, 6 * 3600000);

/** Varifrån en anslutning kommer: IP-adress (bakom proxy: första adressen i x-forwarded-for). */
function clientIp(req){
  const fwd = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req?.socket?.remoteAddress || '?';
  return ip.replace(/^::ffff:/, '');
}
const dur = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
const online = () => wss.clients.size;
const clients = new Map();       // id → klient, för adminsidan

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
console.log(`IRONFRONT-servern lyssnar på port ${PORT} (ws://<serverns-ip>:${PORT})`);
log('SERVER START', null, `port ${PORT} · ${Object.keys(names).length} registrerade namn · loggar i ${LOG_DIR}`);

function makeCode(){
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (lobbies.has(code));
  return code;
}

function send(ws, msg){
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function lobbyState(lobby, you){
  return {
    t: 'lobby', code: lobby.code, you, host: lobby.host, started: lobby.started,
    players: [...lobby.players.values()].map(c => ({
      id: c.id, name: c.name, robot: c.robot, ready: c.ready, host: c.id === lobby.host, title: c.title, level: c.level
    }))
  };
}
function broadcastLobby(lobby){
  for (const c of lobby.players.values()) send(c.ws, lobbyState(lobby, c.id));
}

function leave(client, reason = 'left'){
  const lobby = client.lobby && lobbies.get(client.lobby);
  client.lobby = null;
  client.ready = false;
  if (!lobby) return;
  lobby.players.delete(client.id);
  log(reason === 'disconnect' ? 'LÄMNADE (FRÅN)' : 'LÄMNADE LOBBY', client, `lobby ${lobby.code}${lobby.started ? ' mitt i matchen' : ''} · ${lobby.players.size} kvar`);
  if (client.id === lobby.host){
    log('LOBBY STÄNGD', client, `lobby ${lobby.code} · värden lämnade`);
    // Värden räknar ut striden — utan värd finns ingen match kvar
    for (const c of lobby.players.values()){
      c.lobby = null;
      send(c.ws, { t: 'closed', reason: 'Värden lämnade lobbyn.' });
    }
    lobbies.delete(lobby.code);
    return;
  }
  for (const c of lobby.players.values()) send(c.ws, { t: 'left', id: client.id, name: client.name, reason });
  broadcastLobby(lobby);
}

wss.on('connection', (ws, req) => {
  const client = { id: 'p' + (nextId++), ws, name: 'Spelare', robot: '—', slot: null, ready: false, lobby: null,
                   ip: clientIp(req), since: Date.now() };
  log('ANSLUTEN', client, `ip ${client.ip} · webbläsare: ${String(req?.headers?.['user-agent'] || '?').slice(0, 90)} · ${online()} online`);
  clients.set(client.id, client);
  if (ipBanned(client.ip)){
    log('SPÄRRAD IP', client, `ip ${client.ip} · kopplades ned`);
    send(ws, { t: 'error', reason: 'Du är spärrad från den här servern.' });
    setTimeout(() => ws.terminate(), 200);
    return;
  }
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { t: 'welcome', id: client.id });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const lobby = client.lobby && lobbies.get(client.lobby);

    switch (m.t){
      case 'check': {
        const name = String(m.name || '').trim();
        const err = nameError(name);
        const free = !err && nameFree(name, m.token);
        if (!free && !err) log('NAMN UPPTAGET', client, `försökte "${name}" · ip ${client.ip}`);
        send(ws, { t: 'check', name, ok: free, reason: err || 'Namnet är redan taget.' });
        break;
      }

      case 'claim': {
        const name = String(m.name || '').trim();
        const err = nameError(name);
        if (err) return send(ws, { t: 'claim', ok: false, reason: err });
        if (nameBanned(name)) return send(ws, { t: 'claim', ok: false, reason: 'Det namnet är spärrat.' });
        if (m.password !== undefined && m.password !== ''){
          const pe = passError(m.password);
          if (pe) return send(ws, { t: 'claim', ok: false, reason: pe });
        }
        if (!nameFree(name, m.token)){
          log('NAMN NEKAT', client, `"${name}" tillhör någon annan · ip ${client.ip}`);
          return send(ws, { t: 'claim', ok: false, reason: 'Namnet är redan taget.' });
        }
        // Byter man namn släpps det gamla
        let old = null, oldEntry = null;
        if (m.token) for (const [k, e] of Object.entries(names)) if (e.token === m.token && k !== name.toLowerCase()){
          old = e.name; oldEntry = e; delete names[k];
          // Sparfil och topplisterad följer med till det nya namnet
          try { fs.renameSync(saveFile(e.name), saveFile(name)); } catch {}
          if (board[k]){ board[name.toLowerCase()] = { ...board[k], name }; delete board[k]; saveJson(BOARD_FILE, board); }
        }
        const token = m.token && typeof m.token === 'string' && m.token.length >= 16 ? m.token : randomBytes(18).toString('hex');
        const prev = names[name.toLowerCase()] || oldEntry;
        const pass = m.password ? hashPass(m.password) : prev?.pass;
        names[name.toLowerCase()] = { name, token, since: prev?.since || Date.now(), pass };
        if (m.password) log('LÖSENORD SATT', client, `"${name}"`);
        saveNames();
        const known = names[name.toLowerCase()] && m.token === token && !old;
        log(old ? 'NAMN BYTT' : known ? 'NAMN BEKRÄFTAT' : 'NYTT NAMN', client,
            `${old ? '"' + old + '" → ' : ''}"${name}" · ip ${client.ip}`);
        send(ws, { t: 'claim', ok: true, name, token, hasPass: !!pass });
        break;
      }

      case 'login': {
        // Namn + lösenord → nyckeln och molnsparfilen, t.ex. på en ny dator
        const name = String(m.name || '').trim();
        const e = names[name.toLowerCase()];
        if (!e || !checkPass(e, m.password)){
          log('INLOGGNING NEKAD', client, `"${name}" · ip ${client.ip}`);
          return send(ws, { t: 'login', ok: false, reason: e && !e.pass ? 'Kontot har inget lösenord. Logga in på datorn där du skapade det och sätt ett under Konto.' : 'Fel namn eller lösenord.' });
        }
        if (nameBanned(name)) return send(ws, { t: 'login', ok: false, reason: 'Det namnet är spärrat.' });
        let save = null;
        try { save = JSON.parse(fs.readFileSync(saveFile(e.name), 'utf8')); } catch {}
        log('LOGGADE IN', client, `"${e.name}" · ip ${client.ip}${save ? ' · molnsparfil hämtad' : ''}`);
        send(ws, { t: 'login', ok: true, name: e.name, token: e.token, save: save?.data || null, at: save?.at || null });
        break;
      }

      case 'save': {
        // Molnsparning: bara den som har nyckeln får skriva
        const name = String(m.name || '').trim();
        const e = names[name.toLowerCase()];
        if (!e || e.token !== m.token) return send(ws, { t: 'saved', ok: false, reason: 'Inte inloggad.' });
        const json = JSON.stringify({ at: Date.now(), data: m.data });
        if (json.length > MAX_SAVE) return send(ws, { t: 'saved', ok: false, reason: 'Sparfilen är för stor.' });
        fs.writeFile(saveFile(e.name), json, err => {
          send(ws, { t: 'saved', ok: !err, at: Date.now() });
        });
        if (m.data && typeof m.data === 'object') boardFromSave(e.name, m.data);
        break;
      }

      case 'load': {
        const name = String(m.name || '').trim();
        const e = names[name.toLowerCase()];
        if (!e || e.token !== m.token) return send(ws, { t: 'loaded', ok: false, reason: 'Inte inloggad.' });
        let save = null;
        try { save = JSON.parse(fs.readFileSync(saveFile(e.name), 'utf8')); } catch {}
        send(ws, { t: 'loaded', ok: true, save: save?.data || null, at: save?.at || null });
        break;
      }

      case 'top': {
        const kind = ['level', 'sector', 'score', 'weekly', 'survival', 'bossrush', 'timeattack', 'daily'].includes(m.kind) ? m.kind : 'level';
        const { rows, week } = topList(kind);
        const me = rows.findIndex(r => r.name.toLowerCase() === String(m.name || '').toLowerCase());
        send(ws, { t: 'top', kind, week, rows: rows.slice(0, 50), me: me >= 0 ? { rank: me + 1, ...rows[me] } : null, total: rows.length });
        break;
      }

      case 'hello':
        // Ett registrerat namn får bara användas av den som äger det
        if (m.name && nameBanned(m.name)){
          send(ws, { t: 'error', reason: 'Det namnet är spärrat från servern.' });
          log('SPÄRRAT NAMN', client, `"${m.name}" · ip ${client.ip} · kopplades ned`);
          setTimeout(() => ws.terminate(), 200);
          return;
        }
        if (m.name && !nameFree(String(m.name), m.token)){
          send(ws, { t: 'error', reason: `Namnet ${m.name} tillhör någon annan. Byt namn i huvudmenyn.` });
          log('NAMNKONFLIKT', client, `utgav sig för att vara "${m.name}" · ip ${client.ip} · spelar som gäst`);
          client.name = 'Gäst' + client.id.slice(1);
        } else {
          client.name = String(m.name || 'Spelare').slice(0, 16);
          client.verified = !!(m.name && m.token && names[client.name.toLowerCase()]?.token === m.token);
        }
        client.title = String(m.title || '').slice(0, 24);
        client.level = Number(m.level) || 1;
        client.robot = String(m.robot || '—').slice(0, 16);
        client.slot = m.slot && typeof m.slot === 'object' ? m.slot : null;
        // Logga bara när något ändrats — hello skickas igen vid varje lobby
        const sig = `${client.name}|${client.level}|${client.robot}`;
        if (sig !== client.helloSig){
          log(client.helloSig ? 'UPPDATERAD' : 'INLOGGAD', client, `nivå ${client.level} ${client.title || ''} · robot ${client.robot} · ip ${client.ip}`);
          client.helloSig = sig;
        }
        break;

      case 'activity': {
        // Vad spelaren gör i sitt eget spel (även utan lobby)
        const d = m.data && typeof m.data === 'object' ? m.data : {};
        const str = v => String(v ?? '?').slice(0, 24);
        const MODE = { sectors: 'Sektorer', story: 'Story', weekly: 'Utmaning', coop: 'Co-op' };
        const where = d.training ? 'Träningen (sektor 1)'
          : d.mode === 'trial' ? `Arena ${str(d.trial)}`
          : d.mode === 'story' ? `Story kapitel ${str(d.chapter)}`
          : d.mode === 'weekly' ? `Veckans utmaning v.${str(d.weekly)}`
          : `${MODE[d.mode] || str(d.mode)} sektor ${str(d.sector)}`;
        if (m.kind === 'start'){
          client.playingSince = Date.now();
          log('SPELAR', client, `${where} · robot ${str(d.robot)}`);
        } else if (m.kind === 'end'){
          const res = d.reason === 'abandon' ? 'LÄMNADE' : d.won ? 'VANN' : 'FÖRLORADE';
          log('RESULTAT', client, `${res} · ${d.mode === 'story' ? 'kapitel ' + str(d.chapter) : 'sektor ' + str(d.sector)} · ` +
              `våg ${str(d.wave)}/${str(d.waveTotal)} · ${str(d.kills)} nedkämpade · ${str(d.score)} poäng · ` +
              `+${str(d.xp)} XP · nivå ${str(d.level)} · ${str(d.time)} s`);
          if (d.levelUp) log('NIVÅ UPP', client, `nu nivå ${str(d.levelUp)}`);
          // Arenan till topplistorna: bästa tid (bara vinster) eller dagens bästa poäng
          if (d.mode === 'trial' && client.verified && ['bossrush', 'timeattack', 'daily'].includes(d.trial)){
            const k = client.name.toLowerCase();
            const e = board[k] || (board[k] = { name: client.name, level: client.level, xp: 0, sector: 0, score: 0 });
            e.trials = e.trials || {};
            const t = e.trials[d.trial] || {};
            if (d.trial === 'daily'){
              if (t.day !== d.trialDay || (Number(d.score) || 0) > (t.score || 0)) e.trials.daily = { day: String(d.trialDay), score: Number(d.score) || 0 };
            } else if (d.won && Number(d.elapsed) > 0 && (!t.time || Number(d.elapsed) < t.time)){
              e.trials[d.trial] = { time: Number(d.elapsed) };
            }
            saveJson(BOARD_FILE, board);
          }
          // Överlevnad till topplistan
          if (d.mode === 'survival' && client.verified && d.reason !== 'abandon'){
            const k = client.name.toLowerCase();
            const e = board[k] || (board[k] = { name: client.name, level: client.level, xp: 0, sector: 0, score: 0 });
            const sv = e.survival || { wave: 0, score: 0 };
            if ((Number(d.wave) || 0) > sv.wave || ((Number(d.wave) || 0) === sv.wave && (Number(d.score) || 0) > sv.score))
              e.survival = { wave: Number(d.wave) || 0, score: Number(d.score) || 0 };
            saveJson(BOARD_FILE, board);
          }
          // Veckans utmaning till topplistan (bara om namnet är äkta)
          if (d.mode === 'weekly' && client.verified){
            const k = client.name.toLowerCase();
            const e = board[k] || (board[k] = { name: client.name, level: client.level, xp: 0, sector: 0, score: 0 });
            const week = isoWeekId();
            const w = e.weekly?.id === week ? e.weekly : { id: week, score: 0, wave: 0, won: 0 };
            w.score = Math.max(w.score, Number(d.score) || 0);
            w.wave = Math.max(w.wave, Number(d.wave) || 0);
            if (d.won) w.won = 1;
            e.weekly = w;
            saveJson(BOARD_FILE, board);
          }
          client.level = Number(d.level) || client.level;
        }
        break;
      }

      case 'create': {
        if (lobby) leave(client);
        const code = makeCode();
        const lb = { code, host: client.id, players: new Map([[client.id, client]]), started: false };
        lobbies.set(code, lb);
        client.lobby = code;
        client.ready = true;
        log('LOBBY SKAPAD', client, `kod ${code}`);
        broadcastLobby(lb);
        break;
      }

      case 'join': {
        const code = String(m.code || '').toUpperCase();
        const lb = lobbies.get(code);
        if (!lb){ log('FEL KOD', client, `försökte "${code}"`); return send(ws, { t: 'error', reason: 'Ingen lobby med den koden.' }); }
        if (lb.started){ log('NEKAD', client, `lobby ${code} · matchen pågår`); return send(ws, { t: 'error', reason: 'Matchen har redan börjat.' }); }
        if (lb.players.size >= MAX_PLAYERS){ log('NEKAD', client, `lobby ${code} · full`); return send(ws, { t: 'error', reason: 'Lobbyn är full (4 spelare).' }); }
        if (lobby) leave(client);
        lb.players.set(client.id, client);
        client.lobby = code;
        client.ready = false;
        log('GICK MED', client, `lobby ${code} · ${lb.players.size}/${MAX_PLAYERS} spelare`);
        broadcastLobby(lb);
        break;
      }

      case 'ready':
        if (!lobby) return;
        client.ready = !!m.ready;
        log(client.ready ? 'REDO' : 'INTE REDO', client, `lobby ${lobby.code}`);
        broadcastLobby(lobby);
        break;

      case 'start': {
        if (!lobby || lobby.host !== client.id) return;
        if (lobby.players.size < 2) return send(ws, { t: 'error', reason: 'Minst två spelare behövs.' });
        if ([...lobby.players.values()].some(c => !c.ready))
          return send(ws, { t: 'error', reason: 'Alla spelare är inte redo.' });
        lobby.started = true;
        lobby.startedAt = Date.now();
        log('MATCH START', client, `lobby ${lobby.code} · sektor ${m.params?.sector ?? '?'} · spelare: ` +
            [...lobby.players.values()].map(c => `${c.name} (nivå ${c.level}, ${c.robot})`).join(', '));
        const players = [...lobby.players.values()].map(c => ({ id: c.id, name: c.name, robot: c.robot, slot: c.slot, title: c.title, level: c.level }));
        for (const c of lobby.players.values()) send(c.ws, { t: 'start', params: m.params || {}, players, host: lobby.host });
        break;
      }

      case 'relay': {
        if (!lobby) return;
        const out = { t: 'relay', from: client.id, data: m.data };
        if (client.id === lobby.host){
          for (const c of lobby.players.values()) if (c.id !== client.id) send(c.ws, out);
        } else {
          const host = lobby.players.get(lobby.host);
          if (host) send(host.ws, out);
        }
        break;
      }

      case 'end':
        // Värden avslutade matchen — lobbyn kan användas igen
        if (lobby && lobby.host === client.id){
          const r = m.result || {};
          const res = { sector: 'VINST', dead: 'FÖRLUST', abandon: 'AVBRUTEN' }[r.reason] || 'SLUT';
          log('MATCH SLUT', client, `lobby ${lobby.code} · ${res} · våg ${r.wave ?? '?'} · ${r.kills ?? '?'} nedkämpade · ` +
              `${r.score ?? '?'} poäng · ${lobby.startedAt ? dur(Date.now() - lobby.startedAt) : '?'}`);
          lobby.started = false;
          for (const c of lobby.players.values()) c.ready = c.id === lobby.host;
          broadcastLobby(lobby);
        }
        break;

      case 'leave':
        leave(client);
        break;
    }
  });

  ws.on('close', () => {
    leave(client, 'disconnect');
    clients.delete(client.id);
    log('FRÅNKOPPLAD', client, `ip ${client.ip} · var ansluten ${dur(Date.now() - client.since)} · ${online()} online`);
  });
});

// Håll anslutningarna vid liv och städa bort döda
setInterval(() => {
  for (const ws of wss.clients){
    if (!ws.isAlive){ ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

/* =========================================================
   ADMINSIDAN
   http://<serverns-ip>:<port>/admin?key=<ADMIN_KEY>
   Uppdateras av sig själv var tionde sekund.
   ========================================================= */
const startedAt = Date.now();
const htmlEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function adminAction(q){
  const act = q.get('do');
  if (act === 'kick'){
    const c = clients.get(q.get('id'));
    if (c){ send(c.ws, { t: 'error', reason: 'Du sparkades ut av administratören.' }); log('SPARKAD', c, 'av admin'); setTimeout(() => c.ws.terminate(), 150); }
  } else if (act === 'ban'){
    const n = String(q.get('name') || '').toLowerCase();
    if (n && !bans.names.includes(n)){ bans.names.push(n); saveJson(BANS_FILE, bans); log('NAMN SPÄRRAT', null, `"${n}" av admin`); }
    for (const c of clients.values()) if (c.name.toLowerCase() === n){ send(c.ws, { t: 'error', reason: 'Du är spärrad från servern.' }); setTimeout(() => c.ws.terminate(), 150); }
  } else if (act === 'unban'){
    const n = String(q.get('name') || '').toLowerCase();
    bans.names = bans.names.filter(x => x !== n); saveJson(BANS_FILE, bans); log('SPÄRR HÄVD', null, `"${n}"`);
  } else if (act === 'banip'){
    const ip = String(q.get('ip') || '');
    if (ip && !bans.ips.includes(ip)){ bans.ips.push(ip); saveJson(BANS_FILE, bans); log('IP SPÄRRAD', null, `${ip} av admin`); }
    for (const c of clients.values()) if (c.ip === ip) setTimeout(() => c.ws.terminate(), 150);
  } else if (act === 'say'){
    const text = String(q.get('text') || '').trim().slice(0, 200);
    if (text){
      for (const c of clients.values()) send(c.ws, { t: 'notice', text });
      log('MEDDELANDE', null, `till ${clients.size} spelare: "${text}"`);
    }
  } else if (act === 'backup'){
    backup(true);
  } else if (act === 'unbanip'){
    const ip = String(q.get('ip') || '');
    bans.ips = bans.ips.filter(x => x !== ip); saveJson(BANS_FILE, bans); log('IP-SPÄRR HÄVD', null, ip);
  }
}

function adminPage(key){
  const k = encodeURIComponent(key);
  const a = (params, label, cls = '') => `<a class="b ${cls}" href="/admin?key=${k}&${params}">${label}</a>`;
  const rows = [...clients.values()].map(c => {
    const lb = c.lobby ? lobbies.get(c.lobby) : null;
    return `<tr><td>${htmlEsc(c.id)}</td><td><b>${htmlEsc(c.name)}</b>${c.verified ? ' ✓' : ''}</td><td>${c.level || '—'}</td>
      <td>${htmlEsc(c.robot)}</td><td>${htmlEsc(c.ip)}</td><td>${lb ? htmlEsc(lb.code) + (lb.started ? ' (spelar)' : '') : '—'}</td>
      <td>${dur(Date.now() - c.since)}</td>
      <td>${a('do=kick&id=' + encodeURIComponent(c.id), 'Sparka')} ${c.name !== 'Spelare' ? a('do=ban&name=' + encodeURIComponent(c.name), 'Spärra namn', 'r') : ''} ${a('do=banip&ip=' + encodeURIComponent(c.ip), 'Spärra IP', 'r')}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="m">Ingen är ansluten just nu.</td></tr>';
  const lobs = [...lobbies.values()].map(lb => `<tr><td><b>${htmlEsc(lb.code)}</b></td><td>${lb.started ? 'Matchen pågår' + (lb.startedAt ? ' · ' + dur(Date.now() - lb.startedAt) : '') : 'Väntar'}</td>
    <td>${[...lb.players.values()].map(c => htmlEsc(c.name) + (c.id === lb.host ? ' (värd)' : '')).join(', ')}</td></tr>`).join('')
    || '<tr><td colspan="3" class="m">Inga lobbyer.</td></tr>';
  const banRows = [
    ...bans.names.map(n => `<li>Namn <b>${htmlEsc(n)}</b> ${a('do=unban&name=' + encodeURIComponent(n), 'Häv')}</li>`),
    ...bans.ips.map(ip => `<li>IP <b>${htmlEsc(ip)}</b> ${a('do=unbanip&ip=' + encodeURIComponent(ip), 'Häv')}</li>`)
  ].join('') || '<li class="m">Inga spärrar.</li>';
  const top = topList('level').rows.slice(0, 10).map((r, i) => `<li>${i + 1}. <b>${htmlEsc(r.name)}</b> — nivå ${r.value}</li>`).join('') || '<li class="m">Tom.</li>';
  const logHtml = recentLog.slice(-200).reverse().map(l => htmlEsc(l)).join('\n');
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta http-equiv="refresh" content="10">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>IRONFRONT · admin</title>
<style>
body{margin:0;background:#070b10;color:#e8f0f6;font:14px/1.45 system-ui,sans-serif;padding:20px}
h1{font-size:20px;letter-spacing:.08em;margin:0 0 4px} h1 span{color:#ff5a1e} h2{font-size:13px;letter-spacing:.16em;color:#8093a5;margin:26px 0 8px;text-transform:uppercase}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.stats div{background:#101923;border:1px solid #2a3b4e;padding:10px 14px}.stats b{display:block;font-size:20px;color:#5fb3d4}
table{border-collapse:collapse;width:100%;background:#0d141c}td{border-bottom:1px solid #1d2a38;padding:7px 9px;vertical-align:top}
.b{display:inline-block;padding:3px 8px;border:1px solid #3f5871;color:#e8f0f6;text-decoration:none;font-size:12px;margin:1px}.b:hover{border-color:#5fb3d4}.b.r{border-color:#7a2d34;color:#ff8a8a}
.m{color:#8093a5} ul{margin:0;padding-left:18px} pre{background:#0d141c;border:1px solid #1d2a38;padding:12px;overflow:auto;max-height:480px;font-size:12px;white-space:pre}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style></head><body>
<h1>IRON<span>FRONT</span> · adminpanel</h1><div class="m">Uppdateras var tionde sekund · ${stamp()}</div>
<div class="stats"><div><b>${clients.size}</b>online</div><div><b>${lobbies.size}</b>lobbyer</div><div><b>${Object.keys(names).length}</b>registrerade namn</div><div><b>${dur(Date.now() - startedAt)}</b>drifttid</div></div>
<h2>Meddelande till alla</h2>
<form action="/admin" method="get" style="display:flex;gap:8px;max-width:640px">
  <input type="hidden" name="key" value="${htmlEsc(key)}"><input type="hidden" name="do" value="say">
  <input name="text" maxlength="200" placeholder="T.ex. Servern startas om om 5 minuter" style="flex:1;padding:8px;background:#0d141c;border:1px solid #2a3b4e;color:#e8f0f6">
  <button class="b" style="padding:8px 14px">Skicka</button></form>
<p class="m" style="margin-top:6px">Visas som ett meddelande hos alla som är anslutna just nu. · ${a('do=backup', 'Gör backup nu')} ${lastBackup ? 'Senaste backup: ' + htmlEsc(lastBackup) : ''}</p>
<h2>Anslutna just nu</h2><table><tr class="m"><td>ID</td><td>Namn (✓ = verifierat)</td><td>Nivå</td><td>Robot</td><td>IP</td><td>Lobby</td><td>Ansluten</td><td></td></tr>${rows}</table>
<h2>Lobbyer</h2><table><tr class="m"><td>Kod</td><td>Status</td><td>Spelare</td></tr>${lobs}</table>
<div class="grid"><div><h2>Spärrar</h2><ul>${banRows}</ul></div><div><h2>Topp 10 (nivå)</h2><ul>${top}</ul></div></div>
<h2>Logg (senaste först)</h2><pre>${logHtml}</pre>
</body></html>`;
}

wss.onHttp = (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/admin') return false;
  const key = url.searchParams.get('key') || '';
  if (ADMIN_KEY === 'byt-mig'){
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Adminsidan är avstängd. Öppna server.js och byt ADMIN_KEY från "byt-mig" till ett eget lösenord, starta sedan om servern.');
    return true;
  }
  if (key !== ADMIN_KEY){
    log('ADMIN NEKAD', null, `fel lösenord från ${clientIp(req)}`);
    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="background:#070b10;color:#e8f0f6;font:15px system-ui;padding:40px">
      <form><b>IRONFRONT · admin</b><br><br><input name="key" type="password" placeholder="Adminlösenord" autofocus style="padding:8px">
      <button style="padding:8px 14px">Logga in</button></form>`);
    return true;
  }
  if (url.searchParams.get('do')){
    adminAction(url.searchParams);
    res.writeHead(302, { location: `/admin?key=${encodeURIComponent(key)}` });
    res.end();
    return true;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(adminPage(key));
  return true;
};

/* =========================================================
   BACKUP
   En gång per dygn kopieras namn, sparfiler, topplistor och
   spärrar till backups/<datum>/. De sju senaste sparas.
   ========================================================= */
const BACKUP_DIR = path.join(__dirname, 'backups');
let lastBackup = null;
function copyDir(from, to){
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from, { withFileTypes: true })){
    const a = path.join(from, f.name), b = path.join(to, f.name);
    if (f.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
function backup(force = false){
  try {
    const day = stamp().slice(0, 10);
    const dir = path.join(BACKUP_DIR, day);
    if (!force && fs.existsSync(dir)) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of [NAMES_FILE, BANS_FILE]) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, path.basename(f)));
    if (fs.existsSync(DATA_DIR)) copyDir(DATA_DIR, path.join(dir, 'data'));
    lastBackup = stamp();
    log('BACKUP', null, `sparad i backups/${day}`);
    const all = fs.readdirSync(BACKUP_DIR).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 7))) fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  } catch (e) { log('BACKUP MISSLYCKADES', null, String(e.message || e)); }
}
setTimeout(() => backup(), 60 * 1000);          // en minut efter start
setInterval(() => backup(), 60 * 60 * 1000);    // kolla varje timme om dagens backup finns
