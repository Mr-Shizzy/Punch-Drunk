'use strict';

// Tests for src/art.js with archives, textures and videos built here from made-up contents (no game data).
// Run: node --test test/

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const art = require('../src/art');

const made = [];
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arttest-')); made.push(d); return d; }
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A U8 archive holding the given files (flat), as the Wii's channel banners do.
function makeU8(files) {
  const names = Object.keys(files);
  const nodes = (names.length + 1) * 12;
  const nameTable = Buffer.concat(names.map(n => Buffer.from(n + '\0', 'latin1')));
  const nameOffsets = [];
  let acc = 0;
  for (const n of names) { nameOffsets.push(acc); acc += n.length + 1; }
  const dataStart = Math.ceil((0x20 + nodes + nameTable.length) / 0x40) * 0x40;
  const head = Buffer.alloc(0x20);
  Buffer.from([0x55, 0xAA, 0x38, 0x2D]).copy(head);
  head.writeUInt32BE(0x20, 4); head.writeUInt32BE(nodes + nameTable.length, 8); head.writeUInt32BE(dataStart, 12);
  const table = Buffer.alloc(nodes);
  table[0] = 1; table.writeUInt32BE(names.length + 1, 8);
  const body = [];
  let off = dataStart;
  names.forEach((n, i) => {
    const e = (i + 1) * 12;
    table[e] = 0; table.writeUIntBE(nameOffsets[i], e + 1, 3);
    table.writeUInt32BE(off, e + 4); table.writeUInt32BE(files[n].length, e + 8);
    const padded = Math.ceil(files[n].length / 0x40) * 0x40;
    body.push(Buffer.concat([files[n], Buffer.alloc(padded - files[n].length)]));
    off += padded;
  });
  const front = Buffer.concat([head, table, nameTable]);
  return Buffer.concat([front, Buffer.alloc(dataStart - front.length), ...body]);
}

// "Compression" that only stores: every flag byte 0 means eight literals.
function lz77Store(data) {
  const out = [Buffer.from('LZ77'), Buffer.from([0x10, data.length & 255, (data.length >> 8) & 255, (data.length >> 16) & 255])];
  for (let i = 0; i < data.length; i += 8) out.push(Buffer.from([0]), data.subarray(i, i + 8));
  return Buffer.concat(out);
}

// A 4x4 RGB5A3 texture: opaque pixel i has red = i.
function makeTpl() {
  const out = Buffer.alloc(0x40 + 32);
  out.writeUInt32BE(0x0020AF30, 0); out.writeUInt32BE(1, 4); out.writeUInt32BE(12, 8);
  out.writeUInt32BE(20, 12); out.writeUInt32BE(0, 16);
  out.writeUInt16BE(4, 20); out.writeUInt16BE(4, 22); out.writeUInt32BE(5, 24); out.writeUInt32BE(0x40, 28);
  for (let i = 0; i < 16; i++) out.writeUInt16BE(0x8000 | (i << 10), 0x40 + i * 2);
  return out;
}

function makeBanner() {
  const inner = makeU8({ 'banner.brlyt': Buffer.from('x'), 'FE_Logo.tpl': makeTpl() });
  const bannerBin = Buffer.concat([Buffer.from('IMD5'), Buffer.alloc(28), lz77Store(inner)]);
  const outer = makeU8({ 'banner.bin': bannerBin, 'icon.bin': Buffer.from('i') });
  return Buffer.concat([Buffer.alloc(0x600), outer]); // the archive sits after the banner's header block
}

// Pixels out of a PNG this module wrote (8-bit RGBA, no filtering): the first row.
function firstRow(pngBuf, width) {
  assert.deepStrictEqual([...pngBuf.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  let p = 8, idat = [];
  while (p < pngBuf.length) {
    const len = pngBuf.readUInt32BE(p), type = pngBuf.toString('latin1', p + 4, p + 8);
    if (type === 'IDAT') idat.push(pngBuf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.strictEqual(raw[0], 0);
  return raw.subarray(1, 1 + width * 4);
}

test('the logo comes out of a channel banner as a PNG', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opening.bnr'), makeBanner());
  const r = art.buildArt({ filesDir: dir, outDir: path.join(dir, 'art') });
  assert.deepStrictEqual(r.problems, []);
  assert.deepStrictEqual(r.made, ['punchout-logo.png']);
  const row = firstRow(fs.readFileSync(path.join(dir, 'art', 'punchout-logo.png')), 4);
  for (let x = 0; x < 4; x++) {
    assert.strictEqual(row[x * 4], Math.round(x * 255 / 31)); // red of pixel x (x < 4 in the first row)
    assert.strictEqual(row[x * 4 + 3], 255);
  }
});

test('the logo of an unpacked WAD (00000000.app) works the same way', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, '00000000.app'), makeBanner());
  const r = art.buildArt({ docBanner: path.join(dir, '00000000.app'), outDir: path.join(dir, 'art') });
  assert.deepStrictEqual(r.made, ['doclouis-logo.png']);
});

test('THP frames: the missing 00 after FF is put back, and frames are found by number', () => {
  const dir = tmpDir();
  const jpegHead = Buffer.from([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x04, 0x01, 0x02, 0xFF, 0xDA, 0x00, 0x04, 0x03, 0x04]);
  const scan = [Buffer.from([1, 0xFF, 2, 0xFF, 0xFF, 3]), Buffer.from([9, 8, 0xFF, 7])];
  const frames = scan.map(s => Buffer.concat([jpegHead, s, Buffer.from([0xFF, 0xD9, 0, 0])]));
  // header 0x30 bytes, component table at 0x30 (video, audio), frames from 0x60; each: next, prev, video size, audio size
  const head = Buffer.alloc(0x60);
  head.write('THP\0', 0, 'latin1');
  head.writeUInt32BE(frames.length, 0x14);
  head.writeUInt32BE(16 + frames[0].length, 0x18);
  head.writeUInt32BE(0x30, 0x20);
  head.writeUInt32BE(0x60, 0x28);
  head.writeUInt32BE(2, 0x30); head[0x34] = 0; head[0x35] = 1;
  const frameBuf = (f, nextSize) => { const h = Buffer.alloc(16); h.writeUInt32BE(nextSize, 0); h.writeUInt32BE(f.length, 8); return Buffer.concat([h, f]); };
  const file = path.join(dir, 'x.thp');
  fs.writeFileSync(file, Buffer.concat([head, frameBuf(frames[0], 16 + frames[1].length), frameBuf(frames[1], 0)]));
  const f0 = art.thpFrame(file, 0), f1 = art.thpFrame(file, 1);
  assert.deepStrictEqual([...f0.subarray(jpegHead.length)], [1, 0xFF, 0, 2, 0xFF, 0, 0xFF, 0, 3, 0xFF, 0xD9]);
  assert.deepStrictEqual([...f1.subarray(jpegHead.length)], [9, 8, 0xFF, 0, 7, 0xFF, 0xD9]);
  assert.strictEqual(art.thpFrame(file, 2), null);
});

test('a missing or damaged source is skipped, and the rest is still made', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'opening.bnr'), Buffer.alloc(100));
  fs.mkdirSync(path.join(dir, 'art', 'movies'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'art', 'movies', 'Intro_Movie.thp'), Buffer.from('not a video at all, but long enough to read a header from'));
  const r = art.buildArt({ filesDir: dir, docBanner: path.join(dir, 'nope.app'), outDir: path.join(dir, 'out') });
  assert.deepStrictEqual(r.made, []);
  assert.strictEqual(r.problems.length, 2);
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'art.json')));
});
