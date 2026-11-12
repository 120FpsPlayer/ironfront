'use strict';

/**
 * Signs a launcher update, so that launchers with `updatePublicKey` in launcher.config.json install only what
 * the owner released (src/main/selfupdate.js checks it):
 *
 *   node scripts/sign-release.js <installer.exe> [--key <file>] [--version <x.y.z>] [--yml]
 *   node scripts/sign-release.js --new-key
 *
 * The signature is the base64 Ed25519 signature of the text "<version>\n<sha512>", where sha512 is the base64
 * SHA-512 of the installer – the same value electron-builder writes into latest.yml. It is printed and written
 * to <installer>.sig next to the file; on the update server it is the top-level field `signature` of latest.yml.
 *
 *   --key <file>     the private key: base64 of the PKCS#8 DER form of an Ed25519 key. Without it the key is
 *                    read from the environment variable UPDATE_SIGNING_KEY (that is how CI passes it).
 *   --version <v>    the version to sign. Without it: the version of the latest.yml next to the installer (when
 *                    it describes this very file), else the version in package.json.
 *   --yml            also writes the signature into the latest.yml next to the installer (for a server that
 *                    serves these files as they are).
 *   --new-key        makes a new key pair and says where each half goes. Nothing is written to disk.
 *
 * The private key must never be in the repository or in the launcher – only the public half is.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha512File, signedText, verifyRelease, parseVersion } = require('../src/main/selfupdate');
const { publicKey: readPublicKey } = require('../src/main/plus');

class SignError extends Error {}

/** The key object for a private key given as base64 of PKCS#8 DER (spaces and line breaks around it are fine). */
function privateKeyFrom(text) {
  const base64 = String(text ?? '').replace(/\s+/g, '');
  if (!base64) throw new SignError('Brak klucza prywatnego. Podaj plik: --key <plik>, albo ustaw zmienną UPDATE_SIGNING_KEY.');
  let key;
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('not base64');
    key = crypto.createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    throw new SignError('To nie jest klucz prywatny w oczekiwanej postaci (base64 z PKCS#8 DER). Nowy zrobisz poleceniem: node scripts/sign-release.js --new-key');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new SignError(`Klucz musi być kluczem Ed25519, a ten to ${key.asymmetricKeyType}.`);
  return key;
}

/** The public half as launcher.config.json holds it: base64 of the raw 32 bytes. */
function publicKeyOf(privateKey) {
  return crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
}

/** A fresh pair: { privateKey: base64 PKCS#8 DER (secret), publicKey: base64 of the raw key (for launcher.config.json) }. */
function newKeyPair() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), publicKey: publicKeyOf(privateKey) };
}

/** The signature (base64) of one release: its version and the base64 SHA-512 of its installer. */
function signRelease({ version, sha512 }, privateKey) {
  if (!parseVersion(version)) throw new SignError(`„${version}” nie wygląda na numer wersji (np. 2.6.1).`);
  if (typeof sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(sha512)) throw new SignError('Suma kontrolna musi być SHA-512 w base64 (tak jak w latest.yml).');
  const key = typeof privateKey === 'string' ? privateKeyFrom(privateKey) : privateKey;
  return crypto.sign(null, Buffer.from(signedText(version, sha512), 'utf8'), key).toString('base64');
}

/** latest.yml next to the installer: { file, version, sha512 of this installer in it (or null) } – null when there is none. */
function latestYmlFor(installer) {
  const file = path.join(path.dirname(installer), 'latest.yml');
  if (!fs.existsSync(file)) return null;
  let info;
  try {
    info = require('js-yaml').load(fs.readFileSync(file, 'utf8'));
  } catch {
    return { file, version: null, sha512: null };
  }
  const name = path.basename(installer);
  const entry = (Array.isArray(info?.files) ? info.files : []).find((f) => typeof f?.url === 'string' && decodeURIComponent(f.url.split('/').pop().split('?')[0]) === name);
  return { file, version: typeof info?.version === 'string' ? info.version : null, sha512: entry?.sha512 ?? (info?.path === name ? info.sha512 : null) ?? null };
}

/** Puts `signature: <base64>` into a latest.yml text – replacing the one that is there. */
function withSignature(yml, signature) {
  const lines = String(yml).replace(/\r\n/g, '\n').split('\n').filter((l) => !/^signature:/.test(l));
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return `${lines.join('\n')}\nsignature: ${signature}\n`;
}

/**
 * Signs one installer: { file, version, sha512, signature, sigFile, publicKey, yml } – `yml` says what was found
 * in the latest.yml next to it. Throws SignError (a Polish text) when something does not fit.
 */
async function signInstaller(installer, { key, version = null, writeYml = false, packageVersion = null } = {}) {
  const file = path.resolve(installer);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new SignError(`Nie ma takiego pliku: ${installer}`);
  const privateKey = privateKeyFrom(key);
  const sha512 = await sha512File(file);
  const yml = latestYmlFor(file);
  if (yml?.sha512 && yml.sha512 !== sha512) throw new SignError(`latest.yml obok instalatora opisuje inny plik (inna suma kontrolna). Zbuduj instalator jeszcze raz albo usuń stary latest.yml.`);
  const signedVersion = version ?? (yml?.sha512 ? yml.version : null) ?? packageVersion;
  if (!parseVersion(signedVersion)) throw new SignError('Nie wiem, którą wersję podpisać. Podaj ją: --version 2.6.1');
  if (yml?.sha512 && yml.version && yml.version !== signedVersion) throw new SignError(`latest.yml mówi o wersji ${yml.version}, a podpisujesz ${signedVersion}. Launcher sprawdza wersję z latest.yml – podpisz właśnie ją.`);
  const signature = signRelease({ version: signedVersion, sha512 }, privateKey);
  const publicKey = publicKeyOf(privateKey);
  if (!verifyRelease({ version: signedVersion, sha512, signature }, readPublicKey(publicKey))) throw new SignError('Podpis nie przeszedł własnej kontroli – nic nie zapisano.');
  const sigFile = `${file}.sig`;
  fs.writeFileSync(sigFile, `${signature}\n`);
  let ymlWritten = false;
  if (writeYml) {
    if (!yml?.sha512) throw new SignError('Nie ma obok instalatora pliku latest.yml, który go opisuje – nie mam gdzie wpisać podpisu (--yml).');
    fs.writeFileSync(yml.file, withSignature(fs.readFileSync(yml.file, 'utf8'), signature));
    ymlWritten = true;
  }
  return { file, version: signedVersion, sha512, signature, sigFile, publicKey, yml: yml ? { file: yml.file, matches: Boolean(yml.sha512), written: ymlWritten } : null };
}

function configuredPublicKey() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launcher.config.json'), 'utf8')).updatePublicKey ?? '').trim();
  } catch {
    return '';
  }
}

async function main(argv = process.argv.slice(2), { env = process.env, out = console.log } = {}) {
  const flag = (name) => argv.includes(name);
  const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  if (flag('--new-key')) {
    const pair = newKeyPair();
    out('Nowa para kluczy do podpisywania aktualizacji launchera (Ed25519).\n');
    out('KLUCZ PRYWATNY – tajny. Nie wklejaj go do repozytorium ani do launchera:');
    out(`  ${pair.privateKey}\n`);
    out('  • w GitHubie: Settings → Secrets and variables → Actions → New repository secret,');
    out('    nazwa UPDATE_SIGNING_KEY, wartość: powyższa linia – instalator z CI dostanie wtedy plik .sig,');
    out('  • lokalnie: zapisz go w pliku poza repozytorium i podawaj: --key <plik>.\n');
    out('KLUCZ PUBLICZNY – wpisz go w launcher.config.json jako "updatePublicKey":');
    out(`  ${pair.publicKey}\n`);
    out('Od wersji launchera zbudowanej z tym kluczem instalowane będą tylko aktualizacje z poprawnym podpisem.');
    out('Zgubiony klucz prywatny = trzeba wydać launcher z nowym kluczem publicznym (instalowany ręcznie).');
    return 0;
  }
  const files = argv.filter((a, i) => !a.startsWith('--') && !['--key', '--version'].includes(argv[i - 1]));
  if (files.length !== 1) {
    out('Użycie:\n  node scripts/sign-release.js <instalator.exe> [--key <plik>] [--version <x.y.z>] [--yml]\n  node scripts/sign-release.js --new-key');
    return 2;
  }
  const keyFile = value('--key');
  let key;
  try {
    key = keyFile ? fs.readFileSync(keyFile, 'utf8') : env.UPDATE_SIGNING_KEY;
  } catch (err) {
    out(`Nie udało się wczytać klucza z pliku ${keyFile} (${err.code ?? err.message}).`);
    return 1;
  }
  try {
    const res = await signInstaller(files[0], { key, version: value('--version'), writeYml: flag('--yml'), packageVersion: require('../package.json').version });
    out(`Plik:      ${path.basename(res.file)}`);
    out(`Wersja:    ${res.version}`);
    out(`SHA-512:   ${res.sha512}${res.yml?.matches ? '  (taka sama jak w latest.yml)' : ''}`);
    out(`Podpis:    ${res.signature}`);
    out(`Zapisano:  ${res.sigFile}${res.yml?.written ? ` oraz pole „signature” w ${res.yml.file}` : ''}`);
    const configured = configuredPublicKey();
    out(`Klucz publiczny tej pary: ${res.publicKey}${configured ? (configured === res.publicKey ? '  (ten sam co w launcher.config.json)' : '\nUWAGA: w launcher.config.json jest INNY updatePublicKey – launchery odrzucą ten podpis.') : '\n(w launcher.config.json updatePublicKey jest pusty – launcher nie sprawdza jeszcze podpisów)'}`);
    return 0;
  } catch (err) {
    if (!(err instanceof SignError)) throw err;
    out(`Błąd: ${err.message}`);
    return 1;
  }
}

module.exports = { signRelease, signInstaller, newKeyPair, privateKeyFrom, publicKeyOf, withSignature, main, SignError };

if (require.main === module) {
  main().then(
    (code) => (process.exitCode = code),
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
