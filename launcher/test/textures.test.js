'use strict';

// Tests for src/textures.js with made-up pictures (no game data). Run: node --test test/

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const textures = require('../src/textures');

function dds(pixels) { // a 2 x 2 plain 32-bit picture
  const head = Buffer.alloc(128);
  head.write('DDS ', 0, 'latin1'); head.writeUInt32LE(124, 4);
  head.writeUInt32LE(2, 12); head.writeUInt32LE(2, 16);
  head.writeUInt32LE(32, 76); head.writeUInt32LE(0x41, 80); head.writeUInt32LE(32, 88);
  head.writeUInt32LE(0xFF, 92); head.writeUInt32LE(0xFF00, 96); head.writeUInt32LE(0xFF0000, 100); head.writeUInt32LE(0xFF000000, 104);
  return Buffer.concat([head, Buffer.from(pixels)]);
}

test('saved pictures become PNGs, grey shading maps go in their own sub-folder, and clearing empties both', async () => {
  const port = fs.mkdtempSync(path.join(os.tmpdir(), 'textest-'));
  try {
    const t = textures.texturePaths(port);
    fs.mkdirSync(t.dump, { recursive: true });
    fs.writeFileSync(path.join(t.dump, 'tex1_2x2_aa_14.dds'), dds([200, 10, 10, 255, 1, 2, 3, 255, 9, 9, 9, 255, 0, 0, 0, 0]));
    fs.writeFileSync(path.join(t.dump, 'tex1_2x2_bb_1.dds'), dds([5, 5, 5, 255, 6, 6, 6, 255, 7, 7, 7, 255, 8, 8, 8, 255]));
    fs.writeFileSync(path.join(t.dump, 'tex1_2x2_cc_14.dds'), Buffer.from('not a picture'));
    const made = await textures.makeGamePictures(port);
    assert.strictEqual(made, 2);
    assert.ok(fs.existsSync(path.join(t.pictures, 'tex1_2x2_aa_14.png')));
    assert.ok(fs.existsSync(path.join(t.shading, 'tex1_2x2_bb_1.png')));
    assert.ok(!fs.existsSync(path.join(t.pictures, 'tex1_2x2_cc_14.png')));
    textures.clearGamePictures(port);
    assert.ok(!fs.existsSync(t.dump) && !fs.existsSync(t.pictures));
    assert.strictEqual(await textures.makeGamePictures(port), 0); // nothing saved: nothing made, no error
  } finally {
    fs.rmSync(port, { recursive: true, force: true });
  }
});
