'use strict';

/**
 * Reads what a mod is from inside its .jar: fabric.mod.json, quilt.mod.json, META-INF/neoforge.mods.toml or
 * META-INF/mods.toml (Forge). Returns { id, name, version, description, authors, loader } or null.
 */

const AdmZip = require('adm-zip');

/** Tiny TOML reader for the few fields of mods.toml we show (modId, version, displayName, description, authors). */
function readModsToml(text) {
  const out = {};
  let inMods = false;
  let lastKey = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[[')) {
      if (inMods && out.modId) break; // only the first [[mods]] entry
      inMods = line === '[[mods]]';
      continue;
    }
    if (line.startsWith('[')) {
      if (inMods && out.modId) break;
      inMods = false;
      continue;
    }
    const m = /^([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (m) {
      lastKey = m[1];
      const key = inMods ? m[1] : `top.${m[1]}`;
      let value = m[2].trim();
      if (value.startsWith("'''") || value.startsWith('"""')) value = value.slice(3);
      value = value.replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '');
      out[key] = value;
    } else if (lastKey && inMods && out[lastKey] !== undefined && !line.includes('=')) {
      out[lastKey] += ` ${line.replace(/'''|"""/g, '')}`;
    }
  }
  return out;
}

function readJarMeta(file) {
  let zip;
  try {
    zip = new AdmZip(file);
  } catch {
    return null;
  }
  const text = (name) => {
    const entry = zip.getEntry(name);
    return entry ? entry.getData().toString('utf8') : null;
  };
  try {
    const fabric = text('fabric.mod.json');
    if (fabric) {
      const j = JSON.parse(fabric.replace(/^﻿/, '').replace(/[\u0000-\u0019]+/g, ' '));
      return { id: j.id, name: j.name ?? j.id, version: j.version, description: j.description ?? '', authors: (j.authors ?? []).map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean), loader: 'fabric' };
    }
    const quilt = text('quilt.mod.json');
    if (quilt) {
      const q = JSON.parse(quilt).quilt_loader ?? {};
      return { id: q.id, name: q.metadata?.name ?? q.id, version: q.version, description: q.metadata?.description ?? '', authors: Object.keys(q.metadata?.contributors ?? {}), loader: 'quilt' };
    }
    for (const [name, loader] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']]) {
      const toml = text(name);
      if (toml) {
        const t = readModsToml(toml);
        let version = t.version;
        if (version === '${file.jarVersion}') {
          const manifest = text('META-INF/MANIFEST.MF') ?? '';
          version = /Implementation-Version:\s*(\S+)/.exec(manifest)?.[1] ?? null;
        }
        return { id: t.modId, name: t.displayName ?? t.modId, version, description: (t.description ?? '').trim(), authors: t.authors ? [t.authors] : [], loader };
      }
    }
  } catch {
    // a broken metadata file – show the file name instead
  }
  return null;
}

module.exports = { readJarMeta, readModsToml };
