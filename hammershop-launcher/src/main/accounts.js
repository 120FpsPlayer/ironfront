'use strict';

/**
 * Microsoft accounts (the only way to play Minecraft Java Edition legally). Login opens Microsoft's own page in a
 * small window (msmc); the launcher keeps the refresh token encrypted with the system keychain (Electron safeStorage)
 * and refreshes the game token by itself before each start. Accounts without Minecraft Java are refused.
 */

const crypto = require('node:crypto');
const { readJson, writeJson } = require('./store');

const ERRORS = {
  'error.gui.closed': 'Okno logowania zostało zamknięte.',
  'error.auth.microsoft': 'Nie udało się zalogować do konta Microsoft. Spróbuj ponownie.',
  'error.auth.xboxLive': 'Nie udało się połączyć z Xbox Live. Spróbuj ponownie za chwilę.',
  'error.auth.xsts.userNotFound': 'To konto Microsoft nie ma profilu Xbox. Załóż go na xbox.com i spróbuj ponownie.',
  'error.auth.xsts.bannedCountry': 'Xbox Live nie działa w kraju tego konta.',
  'error.auth.xsts.child': 'To konto dziecka – dorosły musi dodać je do rodziny Microsoft, żeby można było grać.',
  'error.auth.xsts.child.SK': 'To konto wymaga zgody rodzica na stronie Xbox.',
  'error.auth.minecraft.login': 'Mojang odrzucił logowanie. Spróbuj ponownie za chwilę.',
  'error.auth.minecraft.profile': 'To konto nie ma kupionego Minecraft: Java Edition.',
  'error.auth.minecraft.entitlements': 'Nie udało się sprawdzić, czy konto ma Minecrafta.',
};

/** msmc errors are strings ("error.gui.closed") or { ts: 'error.auth…' } – Polish text for the window. */
function loginError(err) {
  const code = typeof err === 'string' ? err : err?.ts ?? err?.name ?? err?.message;
  if (code && ERRORS[code]) return ERRORS[code];
  const parent = code && Object.keys(ERRORS).find((k) => code.startsWith(k));
  if (parent) return ERRORS[parent];
  return `Logowanie nie powiodło się${err?.message ? `: ${err.message}` : '.'}`;
}

const activeSkin = (profile) => (profile?.skins ?? []).find((s) => s.state === 'ACTIVE') ?? profile?.skins?.[0] ?? null;

/**
 * @param {object} o
 * @param {string} o.file accounts.json
 * @param {{ encrypt(text: string): string, decrypt(text: string): string }} o.crypt  safeStorage wrapper
 * @param {object} o.config launcher.config.json (microsoft.clientId for your own Azure app)
 * @param {Function} [o.AuthClass] msmc Auth (injected in tests)
 */
function createAccounts({ file, crypt, config = {}, AuthClass, windowProperties }) {
  const Auth = AuthClass ?? require('msmc').Auth;
  let state = readJson(file, { accounts: [] });
  const save = () => writeJson(file, state);

  function makeAuth() {
    const clientId = config.microsoft?.clientId;
    if (!clientId) return new Auth('select_account');
    return new Auth({ client_id: clientId, redirect: config.microsoft.redirect || 'https://login.live.com/oauth20_desktop.srf', prompt: 'select_account' });
  }

  function publicInfo(a) {
    return { id: a.id, name: a.name, skinUrl: a.skinUrl ?? null, skinVariant: a.skinVariant ?? 'CLASSIC', addedAt: a.addedAt, needsLogin: Boolean(a.needsLogin) };
  }

  function store(mc, refreshToken) {
    if (!mc?.profile?.id || mc.profile.demo) throw new Error(ERRORS['error.auth.minecraft.profile']);
    const skin = activeSkin(mc.profile);
    const record = {
      id: mc.profile.id,
      name: mc.profile.name,
      skinUrl: skin?.url ?? null,
      skinVariant: skin?.variant ?? 'CLASSIC',
      xuid: mc.xuid ?? null,
      refresh: crypt.encrypt(refreshToken),
      token: crypt.encrypt(mc.mcToken),
      exp: mc.exp ?? Date.now() + 23 * 3600 * 1000,
      addedAt: state.accounts.find((a) => a.id === mc.profile.id)?.addedAt ?? Date.now(),
      needsLogin: false,
    };
    state.accounts = [record, ...state.accounts.filter((a) => a.id !== record.id)];
    save();
    return publicInfo(record);
  }

  return {
    list: () => state.accounts.map(publicInfo),

    /** Opens the Microsoft login window; resolves with the new account or throws a Polish message. */
    async login() {
      try {
        const xbox = await makeAuth().launch('electron', windowProperties);
        const mc = await xbox.getMinecraft();
        return store(mc, xbox.save());
      } catch (err) {
        throw new Error(err instanceof Error && Object.values(ERRORS).includes(err.message) ? err.message : loginError(err));
      }
    },

    remove(id) {
      state.accounts = state.accounts.filter((a) => a.id !== id);
      save();
      return true;
    },

    /** { id, name, accessToken } for a launch – refreshes the game token when it is about to expire. */
    async launchAuth(id) {
      const account = state.accounts.find((a) => a.id === id) ?? state.accounts[0];
      if (!account) throw new Error('Zaloguj się kontem Microsoft w zakładce Konta.');
      if (account.exp - Date.now() > 5 * 60 * 1000 && account.token) {
        try {
          return { id: account.id, name: account.name, accessToken: crypt.decrypt(account.token) };
        } catch {
          // the keychain changed (e.g. another Windows user) – refresh below
        }
      }
      try {
        const xbox = await makeAuth().refresh(crypt.decrypt(account.refresh));
        const mc = await xbox.getMinecraft();
        const info = store(mc, xbox.save());
        return { id: info.id, name: info.name, accessToken: mc.mcToken };
      } catch (err) {
        account.needsLogin = true;
        save();
        throw new Error(`Sesja konta ${account.name} wygasła – zaloguj się ponownie w zakładce Konta. (${loginError(err)})`);
      }
    },
  };
}

/** Encryption with Electron's safeStorage (Windows DPAPI, macOS Keychain, libsecret) – a local key file as a fallback. */
function createCrypt({ safeStorage, keyFile, readKey, writeKey }) {
  const secure = Boolean(safeStorage?.isEncryptionAvailable?.());
  let k = null;
  const key = () => {
    if (k) return k;
    let hex = readKey?.(keyFile);
    if (!hex) {
      hex = crypto.randomBytes(32).toString('hex');
      writeKey?.(keyFile, hex);
    }
    k = Buffer.from(hex, 'hex');
    return k;
  };
  return {
    secure,
    encrypt(text) {
      if (secure) return `s:${safeStorage.encryptString(String(text)).toString('base64')}`;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
      const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return `k:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
    },
    decrypt(data) {
      const text = String(data);
      if (text.startsWith('s:')) return safeStorage.decryptString(Buffer.from(text.slice(2), 'base64'));
      if (!text.startsWith('k:')) throw new Error('Unknown token format');
      const raw = Buffer.from(text.slice(2), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

module.exports = { createAccounts, createCrypt, loginError, ERRORS };
