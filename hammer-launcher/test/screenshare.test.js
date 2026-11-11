'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createScreenshotShare, endpoint, imageKind, linkFrom, family, MAX_BYTES } = require('../src/main/screenshare');
const { loadConfig, DEFAULTS } = require('../src/main/config');
const { createServices } = require('../src/main/services');
const { tmpDir } = require('./helpers');

const LITTERBOX = 'https://litterbox.catbox.moe/resources/internals/api.php';
const CONFIG = { screenshotShare: { url: LITTERBOX, time: '72h' } };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('…reszta obrazu…')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('…reszta obrazu…')]);
const NOW = Date.UTC(2026, 10, 11, 18, 0, 0);

function picture(name = '2026-11-11_18.20.11.png', data = PNG) {
  const file = path.join(tmpDir(), name);
  fs.writeFileSync(file, data);
  return file;
}

/** The host: answers with `answer` (a string, or a function of the request) and remembers what it was sent. */
function host(answer = 'https://litter.catbox.moe/a1b2c3.png\n', status = 200) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (answer instanceof Error) throw answer;
    return new Response(typeof answer === 'function' ? answer(url, init) : answer, { status });
  };
  return { fetchFn, calls };
}

function sharing({ answer, status, config = CONFIG, given = false } = {}) {
  const h = host(answer, status);
  const state = { given, remembered: 0 };
  const share = createScreenshotShare({ config, fetchFn: h.fetchFn, now: () => NOW, consent: { given: () => state.given, remember: () => ((state.given = true), (state.remembered += 1)) } });
  return { share, calls: h.calls, state };
}

test('screenshot link: the host comes from launcher.config.json – an empty url switches the feature off', () => {
  assert.deepEqual(endpoint(CONFIG), { url: LITTERBOX, time: '72h', hours: 72, host: 'litterbox.catbox.moe', family: 'catbox.moe' });
  assert.deepEqual(endpoint({ screenshotShare: { url: LITTERBOX, time: '1h' } }).hours, 1);
  assert.deepEqual([endpoint({ screenshotShare: { url: LITTERBOX, time: '2 tygodnie' } }).time, endpoint({ screenshotShare: { url: LITTERBOX } }).time], ['72h', '72h'], 'a retention the host does not know falls back to 72 hours');
  for (const url of ['', '   ', null, undefined, 'litterbox.catbox.moe', 'http://litterbox.catbox.moe/api.php', 'ftp://catbox.moe/x', 'https://localhost/api', 'https://user:haslo@catbox.moe/api', 'javascript:alert(1)']) {
    assert.equal(endpoint({ screenshotShare: { url } }), null, String(url));
  }
  assert.equal(endpoint({}), null);
  assert.equal(endpoint(undefined), null);
  assert.deepEqual([family('litterbox.catbox.moe'), family('Litter.CATBOX.moe'), family('catbox.moe')], ['catbox.moe', 'catbox.moe', 'catbox.moe']);
  // Without the key in the file nothing is uploaded anywhere; the launcher's own config names Litterbox.
  assert.deepEqual(DEFAULTS.screenshotShare, { url: '', time: '72h' });
  assert.deepEqual(loadConfig(path.join(tmpDir(), 'nie-ma.json')).screenshotShare, { url: '', time: '72h' });
  assert.deepEqual(loadConfig().screenshotShare, { url: LITTERBOX, time: '72h' });
  const { share, calls } = sharing({ config: { screenshotShare: { url: '' } }, given: true });
  assert.deepEqual(share.info(), { available: false, hours: null, service: null, ask: false });
  return assert.rejects(share.share(picture(), { agreed: true }), /wyłączone/).then(() => assert.equal(calls.length, 0));
});

test('screenshot link: the request – a multipart form with reqtype, time and the picture under a neutral name', async () => {
  const { share, calls } = sharing();
  assert.deepEqual(share.info(), { available: true, hours: 72, service: 'litterbox.catbox.moe', ask: true });
  const res = await share.share(picture('2026-11-11_18.20.11.png'), { agreed: true });
  assert.deepEqual(res, { url: 'https://litter.catbox.moe/a1b2c3.png', hours: 72, expiresAt: NOW + 72 * 3600_000 });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, LITTERBOX);
  assert.equal(init.method, 'POST');
  assert.match(init.headers['user-agent'], /^Hammer-Launcher\//);
  assert.ok(init.signal instanceof AbortSignal, 'a host that never answers is given up on');
  assert.ok(init.body instanceof FormData);
  assert.deepEqual([...init.body.keys()], ['reqtype', 'time', 'fileToUpload']);
  assert.deepEqual([init.body.get('reqtype'), init.body.get('time')], ['fileupload', '72h']);
  const file = init.body.get('fileToUpload');
  assert.deepEqual([file.name, file.type, file.size], ['zrzut-ekranu.png', 'image/png', PNG.length], 'the file name (with its date) stays on the computer');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
  // A JPEG, and another retention from the config.
  const day = sharing({ config: { screenshotShare: { url: LITTERBOX, time: '24h' } }, answer: 'https://litter.catbox.moe/zz.jpg' });
  const jpg = await day.share.share(picture('zamek.JPG', JPEG), { agreed: true });
  assert.deepEqual([jpg.hours, jpg.expiresAt, day.calls[0].init.body.get('time')], [24, NOW + 24 * 3600_000, '24h']);
  assert.deepEqual([day.calls[0].init.body.get('fileToUpload').name, day.calls[0].init.body.get('fileToUpload').type], ['zrzut-ekranu.jpg', 'image/jpeg']);
});

test('screenshot link: nothing leaves the computer before the player has said yes', async () => {
  const { share, calls, state } = sharing();
  const file = picture();
  await assert.rejects(share.share(file), /Najpierw potwierdź/);
  await assert.rejects(share.share(file, { agreed: false, remember: true }), /Najpierw potwierdź/);
  assert.deepEqual([calls.length, state.remembered], [0, 0], 'no request, and „Nie pytaj ponownie” without a yes means nothing');
  // Yes, this once: asked again next time.
  await share.share(file, { agreed: true });
  assert.deepEqual([calls.length, state.given, share.info().ask], [1, false, true]);
  await assert.rejects(share.share(file), /Najpierw potwierdź/);
  // Yes with „Nie pytaj ponownie”: remembered.
  await share.share(file, { agreed: true, remember: true });
  assert.deepEqual([calls.length, state.given, state.remembered, share.info().ask], [2, true, 1, false]);
  await share.share(file);
  assert.equal(calls.length, 3);
});

test('screenshot link: only an https address on the host\'s own family is accepted as the answer', async () => {
  assert.equal(linkFrom('https://litter.catbox.moe/a1b2c3.png', 'catbox.moe'), 'https://litter.catbox.moe/a1b2c3.png');
  assert.equal(linkFrom('  https://files.catbox.moe/x.jpg\r\n', 'catbox.moe'), 'https://files.catbox.moe/x.jpg');
  assert.equal(linkFrom('https://catbox.moe/x.png', 'catbox.moe'), 'https://catbox.moe/x.png');
  const bad = [
    'http://litter.catbox.moe/a1b2c3.png', // not https
    'https://evil.example/a1b2c3.png',
    'https://evilcatbox.moe/a.png', // looks alike, is not the family
    'https://catbox.moe.evil.example/a.png',
    'https://litter.catbox.moe@evil.example/a.png',
    'https://user:pass@litter.catbox.moe/a.png',
    'https://litter.catbox.moe:8443/a.png',
    'https://litter.catbox.moe/', // the front page is not a picture
    'https://litter.catbox.moe',
    'javascript:alert(1)',
    'file:///C:/Windows/system32',
    '<html><body>502 Bad Gateway</body></html>',
    'https://litter.catbox.moe/a.png https://evil.example/b.png',
    'No request type was specified.',
    '',
    null,
    `https://litter.catbox.moe/${'a'.repeat(400)}.png`,
  ];
  for (const answer of bad) assert.equal(linkFrom(answer, 'catbox.moe'), null, String(answer));
  for (const answer of bad) {
    const { share } = sharing({ answer: answer ?? '', given: true });
    await assert.rejects(share.share(picture()), /nie jest linkiem do obrazu – nic nie zostało skopiowane/, String(answer));
  }
});

test('screenshot link: only PNG and JPEG of at most 20 MB are sent; errors and timeouts get a calm sentence', async () => {
  assert.deepEqual([imageKind(PNG), imageKind(JPEG), imageKind(Buffer.from('GIF89a…')), imageKind(Buffer.from('MZ')), imageKind(Buffer.alloc(0))], ['png', 'jpeg', null, null, null]);
  const { share, calls } = sharing({ given: true });
  await assert.rejects(share.share(picture('notatki.txt', PNG)), /tylko zrzut ekranu w formacie PNG albo JPG/);
  await assert.rejects(share.share(picture('wirus.png', Buffer.from('MZ to nie obraz'))), /nie jest obrazem PNG ani JPG – nie został wysłany/, 'the name alone does not make a picture');
  await assert.rejects(share.share(path.join(tmpDir(), 'nie-ma.png')), /Nie ma już tego zrzutu ekranu/);
  const folder = path.join(tmpDir(), 'folder.png');
  fs.mkdirSync(folder);
  await assert.rejects(share.share(folder), /Nie ma już tego zrzutu ekranu/);
  const link = path.join(tmpDir(), 'link.png');
  try {
    fs.symlinkSync(picture('prawdziwy.png'), link);
    await assert.rejects(share.share(link), /Nie ma już tego zrzutu ekranu/, 'a link in the folder is not a screenshot');
  } catch (err) {
    if (err.code !== 'EPERM') throw err; // Windows without the right to make links
  }
  // 20 MB is the limit (a sparse file – nothing is really written).
  const big = picture('wielki.png');
  fs.truncateSync(big, MAX_BYTES + 1);
  await assert.rejects(share.share(big), /ponad 20 MB/);
  const edge = picture('na-styk.png');
  fs.truncateSync(edge, MAX_BYTES);
  assert.equal(calls.length, 0, 'none of these reached the host');
  await share.share(edge);
  assert.equal(calls.length, 1);

  const timeout = sharing({ answer: Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), given: true });
  await assert.rejects(timeout.share.share(picture()), /serwis nie odpowiada\. Sprawdź internet i spróbuj ponownie za chwilę\.$/);
  const down = sharing({ answer: 'Service Unavailable', status: 503, given: true });
  await assert.rejects(down.share.share(picture()), /Serwis nie przyjął zrzutu ekranu \(błąd 503\)/);
  const refused = sharing({ answer: 'https://litter.catbox.moe/a.png', status: 403, given: true });
  await assert.rejects(refused.share.share(picture()), /błąd 403/, 'an error status is an error, whatever the body says');
});

test('services: „Udostępnij link” takes only screenshots of an instance, and the consent lives in the settings', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('https://litter.catbox.moe/q9w8e7.png');
  };
  const s = createServices({ root: tmpDir(), config: { brand: 'HammerShop', ...CONFIG }, accounts: { list: () => [] }, fetchFn, now: () => NOW });
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  fs.mkdirSync(path.join(instance.dir, 'screenshots'));
  fs.writeFileSync(path.join(instance.dir, 'screenshots', 'zamek.png'), PNG);
  fs.writeFileSync(path.join(instance.dir, 'options.png'), PNG); // a picture elsewhere in the instance
  assert.deepEqual(s.gallery.shareInfo(), { available: true, hours: 72, service: 'litterbox.catbox.moe', ask: true });

  await assert.rejects(s.gallery.share(instance.id, 'zamek.png'), /Najpierw potwierdź/);
  await assert.rejects(s.gallery.share(instance.id, 'zamek.png', { agreed: 'tak' }), /Najpierw potwierdź/, 'only a real yes counts');
  for (const name of ['../options.png', '..\\options.png', '/etc/passwd', 'options.txt', '.ukryty.png', '', null]) assert.throws(() => s.gallery.share(instance.id, name, { agreed: true }), /Nieprawidłowy plik/, String(name));
  assert.throws(() => s.gallery.share(instance.id, 'nie-ma.png', { agreed: true }), /Nie ma już tego zrzutu ekranu/);
  assert.throws(() => s.gallery.share('nie-ma', 'zamek.png', { agreed: true }), /Nie ma takiej instancji/);
  assert.equal(calls.length, 0);

  const res = await s.gallery.share(instance.id, 'zamek.png', { agreed: true, remember: true });
  assert.deepEqual(res, { url: 'https://litter.catbox.moe/q9w8e7.png', hours: 72, expiresAt: NOW + 72 * 3600_000 });
  assert.equal(calls[0].url, LITTERBOX);
  // „Nie pytaj ponownie” is the setting, so it can be switched back on in Ustawienia.
  assert.equal(s.settings.get().screenshotShareAsk, false);
  assert.equal(s.gallery.shareInfo().ask, false);
  await s.gallery.share(instance.id, 'zamek.png');
  assert.equal(calls.length, 2);
  s.settings.set({ screenshotShareAsk: true });
  await assert.rejects(s.gallery.share(instance.id, 'zamek.png'), /Najpierw potwierdź/);
  assert.equal(calls.length, 2);
});
