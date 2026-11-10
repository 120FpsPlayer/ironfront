'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const tmpDir = (name = 'hs') => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/** fetch stand-in: routes = [{ match: RegExp | (url, init) => bool, json?, body?, status?, once? }]. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const r of routes) {
      const hit = typeof r.match === 'function' ? r.match(String(url), init) : r.match.test(String(url));
      if (!hit || r.used) continue;
      if (r.once) r.used = true;
      const status = r.status ?? 200;
      const payload = typeof r.json === 'function' ? r.json(String(url), init) : r.json;
      const body = r.body != null ? Buffer.from(r.body) : Buffer.from(JSON.stringify(payload ?? null));
      return new Response(body, { status, headers: { 'content-length': String(body.length), 'content-type': r.body != null ? 'application/octet-stream' : 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

/** A fake mod jar with fabric.mod.json. */
function fabricJar(meta) {
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, ...meta })));
  zip.addFile('assets/x.txt', Buffer.from('x'));
  return zip.toBuffer();
}

/** A Modrinth version object with one file served by the mock fetch. */
function mrVersion({ id, projectId, name = id, number = '1.0.0', mc = ['1.21.1'], loaders = ['fabric'], type = 'release', deps = [], file }) {
  return {
    id,
    project_id: projectId,
    name,
    version_number: number,
    game_versions: mc,
    loaders,
    version_type: type,
    dependencies: deps,
    files: [{ url: `https://cdn.modrinth.com/data/${projectId}/versions/${id}/${file.name}`, filename: file.name, primary: true, size: file.body.length, hashes: { sha1: sha1(file.body) } }],
  };
}

module.exports = { tmpDir, sha1, mockFetch, fabricJar, mrVersion };
