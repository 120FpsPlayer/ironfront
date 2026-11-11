'use strict';

/**
 * npm run plus-key – makes a new Hammer+ signing key (Ed25519) and prints the line for .env and the public key for
 * Hammer Launcher. Nothing is saved anywhere: copy the line into .env yourself and keep it secret.
 */

const crypto = require('node:crypto');
const path = require('node:path');

process.chdir(path.join(__dirname, '..'));
const { env } = require('../src/env');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const secret = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const shown = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

if (env.plusPrivateKey) {
  console.log('⚠️  W .env jest już HAMMER_PLUS_PRIVATE_KEY. Podmień go tylko wtedy, gdy naprawdę chcesz nowy klucz –');
  console.log('    wszystkie wystawione dotąd kody Hammer+ przestaną działać, a launcher będzie potrzebował nowego klucza publicznego.\n');
}
console.log('1. Wklej tę linię do pliku .env (to klucz prywatny – NIGDY nikomu go nie podawaj i nie wrzucaj do repozytorium):\n');
console.log(`HAMMER_PLUS_PRIVATE_KEY=${secret}\n`);
console.log('2. Uruchom bota ponownie.\n');
console.log('3. Klucz publiczny do wpisania w Hammer Launcherze (ten można pokazywać; pokaże go też /hammerplus klucz):\n');
console.log(`${shown}\n`);
