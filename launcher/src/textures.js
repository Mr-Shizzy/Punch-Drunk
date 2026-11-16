'use strict';

const fs = require('node:fs');
const path = require('node:path');
const art = require('./art');

// Texture mods (experimental). The game's own dump is .dds, which few picture editors open, so after a session
// that dump is turned into ordinary PNGs in "game pictures" (the grey shading maps in a sub-folder, being the
// bulk of them and no use to recolour). Edited copies go in "my textures", which the game reads at start.
const texturePaths = port => ({
  mine: path.join(port, 'UserData', 'texture_replacements'),
  dump: path.join(port, 'UserData', 'Cache', 'texture_dumps'),
  pictures: path.join(port, 'UserData', 'game pictures'),
  shading: path.join(port, 'UserData', 'game pictures', 'grey shading maps')
});

function clearGamePictures(port) {
  const t = texturePaths(port);
  for (const dir of [t.dump, t.pictures]) fs.rmSync(dir, { recursive: true, force: true });
}

async function makeGamePictures(port, log = () => {}) {
  const t = texturePaths(port);
  let names = [];
  try { names = fs.readdirSync(t.dump).filter(n => n.toLowerCase().endsWith('.dds')); } catch { /* nothing saved */ }
  if (names.length === 0) return 0;
  fs.mkdirSync(t.shading, { recursive: true });
  let made = 0;
  for (const [i, name] of names.entries()) {
    try {
      const info = art.ddsToPngInfo(fs.readFileSync(path.join(t.dump, name)));
      if (info) {
        fs.writeFileSync(path.join(info.gray ? t.shading : t.pictures, name.replace(/\.dds$/i, '.png')), info.png);
        made++;
      }
    } catch (err) { log(`[textures] ${name}: ${err.message}`); }
    if (i % 50 === 49) await new Promise(r => setImmediate(r));
  }
  return made;
}

module.exports = { texturePaths, clearGamePictures, makeGamePictures };
