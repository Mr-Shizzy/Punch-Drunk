'use strict';

// Pictures for the home screen, made on the player's own computer from their own copy of the games: each game's
// logo (from the channel banner), and one still from a cut-scene video. Nothing from the games is shipped with the
// launcher or kept anywhere but the data folder.
//
// Formats read here (all Wii):
//   - the channel banner (opening.bnr on the disc, 00000000.app in the WAD): an archive (U8) holding banner.bin,
//     itself an archive (usually LZ77-compressed) that holds the logo as a TPL texture (RGB5A3);
//   - THP videos: a chain of frames, each holding a JPEG whose compressed data is not byte-stuffed (a normal JPEG
//     writes 00 after every FF in its data; THP leaves it out), so 00 is put back and any JPEG reader takes it.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const U8_MAGIC = Buffer.from([0x55, 0xAA, 0x38, 0x2D]);
const ART_VERSION = 1;

// Which video and which frame (counted from 0) make each background. Frames chosen on the USA disc.
const BACKGROUNDS = {
  punchout: { file: ['art', 'movies', 'Intro_Movie.thp'], frame: 190 },
  doclouis: { file: ['art', 'movies', 'victory_world.thp'], frame: 771 }
};

// ---------------------------------------------------------------------------------------------------------------
// Archives and textures

function lz77(data) {
  if (data.subarray(0, 4).toString('latin1') === 'LZ77') data = data.subarray(4);
  if (data[0] !== 0x10) throw new Error('unsupported compression');
  const size = data[1] | (data[2] << 8) | (data[3] << 16);
  const out = Buffer.alloc(size);
  let o = 0, p = 4;
  while (o < size) {
    const flags = data[p++];
    for (let k = 0; k < 8 && o < size; k++) {
      if (flags & (0x80 >> k)) {
        const a = data[p++], b = data[p++];
        const len = (a >> 4) + 3, disp = (((a & 15) << 8) | b) + 1;
        if (disp > o) throw new Error('damaged compressed data');
        for (let i = 0; i < len && o < size; i++) { out[o] = out[o - disp]; o++; }
      } else {
        out[o++] = data[p++];
      }
    }
  }
  return out;
}

// Files of a U8 archive that starts at `base` in buf: { name: Buffer } (offsets in the archive count from `base`).
function u8Files(buf, base = 0) {
  if (!buf.subarray(base, base + 4).equals(U8_MAGIC)) throw new Error('not an archive');
  const rootOff = buf.readUInt32BE(base + 4);
  const t = base + rootOff;
  const count = buf.readUInt32BE(t + 8);
  const names = t + count * 12;
  const files = {};
  for (let i = 0; i < count; i++) {
    const e = t + i * 12;
    const type = buf[e];
    const nameOff = buf.readUIntBE(e + 1, 3);
    const off = buf.readUInt32BE(e + 4), size = buf.readUInt32BE(e + 8);
    let end = names + nameOff;
    while (buf[end] !== 0) end++;
    if (type === 0) files[buf.toString('latin1', names + nameOff, end)] = buf.subarray(base + off, base + off + size);
  }
  return files;
}

// The channel banner's own archive (banner.bin): after a 32-byte IMD5 header, maybe LZ77-compressed.
function bannerFiles(bnr) {
  const at = bnr.subarray(0, 0x800).indexOf(U8_MAGIC);
  if (at < 0) throw new Error('no banner archive');
  const bin = u8Files(bnr, at)['banner.bin'];
  if (!bin) throw new Error('no banner.bin');
  let data = bin.subarray(0, 4).toString('latin1') === 'IMD5' ? bin.subarray(32) : bin;
  if (data.subarray(0, 4).toString('latin1') === 'LZ77') data = lz77(data);
  return u8Files(data, data.indexOf(U8_MAGIC));
}

// The first image of a TPL file, RGB5A3 only (what the banner logos use): { width, height, rgba }.
function tplRgba(tpl) {
  if (tpl.readUInt32BE(0) !== 0x0020AF30) throw new Error('not a texture');
  const table = tpl.readInt32BE(8);
  const header = tpl.readUInt32BE(table);
  const height = tpl.readUInt16BE(header), width = tpl.readUInt16BE(header + 2);
  const format = tpl.readUInt32BE(header + 4), data = tpl.readUInt32BE(header + 8);
  if (format !== 5) throw new Error(`unsupported texture format ${format}`);
  const rgba = Buffer.alloc(width * height * 4);
  let p = data;
  for (let ty = 0; ty < height; ty += 4) {
    for (let tx = 0; tx < width; tx += 4) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const v = tpl.readUInt16BE(p); p += 2;
          let r, g, b, a;
          if (v & 0x8000) {
            r = ((v >> 10) & 31) * 255 / 31; g = ((v >> 5) & 31) * 255 / 31; b = (v & 31) * 255 / 31; a = 255;
          } else {
            a = ((v >> 12) & 7) * 255 / 7; r = ((v >> 8) & 15) * 17; g = ((v >> 4) & 15) * 17; b = (v & 15) * 17;
          }
          if (tx + x < width && ty + y < height) {
            const o = ((ty + y) * width + tx + x) * 4;
            rgba[o] = Math.round(r); rgba[o + 1] = Math.round(g); rgba[o + 2] = Math.round(b); rgba[o + 3] = Math.round(a);
          }
        }
      }
    }
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------------------
// PNG (just enough to save a picture)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A plain 32-bit DDS picture (what the game's texture dump writes) as a PNG; the first image only. Returns null for
// any other kind of DDS.
function ddsToPng(dds) {
  if (dds.length < 128 || dds.toString('latin1', 0, 4) !== 'DDS ') return null;
  const height = dds.readUInt32LE(12), width = dds.readUInt32LE(16);
  const pfFlags = dds.readUInt32LE(80), bits = dds.readUInt32LE(88);
  if ((pfFlags & 4) || bits !== 32 || !(pfFlags & 0x40)) return null; // not an uncompressed colour picture
  if (width === 0 || height === 0 || dds.length < 128 + width * height * 4) return null;
  const masks = [dds.readUInt32LE(92), dds.readUInt32LE(96), dds.readUInt32LE(100), (pfFlags & 1) ? dds.readUInt32LE(104) : 0];
  const shifts = masks.map(m => (m === 0 ? -1 : Math.log2(m & -m)));
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = dds.readUInt32LE(128 + i * 4);
    for (let c = 0; c < 4; c++) rgba[i * 4 + c] = shifts[c] < 0 ? 255 : (v >>> shifts[c]) & 255;
  }
  return png(width, height, rgba);
}

// ---------------------------------------------------------------------------------------------------------------
// THP video frames

// Puts the missing 00 after every FF in a JPEG's compressed data (the part after the scan header).
function unstuffJpeg(jpeg) {
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xFF) throw new Error('damaged picture');
    const marker = jpeg[i + 1], len = jpeg.readUInt16BE(i + 2);
    i += 2 + len;
    if (marker === 0xDA) {
      let end = jpeg.length;
      while (end > i && jpeg[end - 1] === 0) end--;
      if (end >= 2 && jpeg[end - 2] === 0xFF && jpeg[end - 1] === 0xD9) end -= 2;
      const data = jpeg.subarray(i, end);
      const parts = [jpeg.subarray(0, i)];
      let from = 0;
      for (let k = 0; k < data.length; k++) {
        if (data[k] === 0xFF) { parts.push(data.subarray(from, k + 1), Buffer.from([0])); from = k + 1; }
      }
      parts.push(data.subarray(from), Buffer.from([0xFF, 0xD9]));
      return Buffer.concat(parts);
    }
  }
  throw new Error('damaged picture');
}

// Frame number `index` of a THP file as a JPEG. Returns null when the video has fewer frames than that.
function thpFrame(file, index) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(0x30);
    if (fs.readSync(fd, head, 0, head.length, 0) < head.length || head.toString('latin1', 0, 3) !== 'THP') throw new Error('not a video');
    const frames = head.readUInt32BE(0x14);
    let size = head.readUInt32BE(0x18);
    let pos = head.readUInt32BE(0x28);
    const compOff = head.readUInt32BE(0x20);
    const comp = Buffer.alloc(20);
    fs.readSync(fd, comp, 0, comp.length, compOff);
    const count = Math.min(comp.readUInt32BE(0), 16);
    const videoIndex = [...comp.subarray(4, 4 + count)].indexOf(0);
    if (videoIndex < 0 || index >= frames) return null;
    const small = Buffer.alloc(8 + 4 * count);
    for (let i = 0; ; i++) {
      fs.readSync(fd, small, 0, small.length, pos);
      if (i === index) {
        const videoSize = small.readUInt32BE(8 + 4 * videoIndex);
        if (videoSize <= 0 || videoSize > 4 << 20) throw new Error('damaged video');
        const jpeg = Buffer.alloc(videoSize);
        fs.readSync(fd, jpeg, 0, videoSize, pos + small.length);
        return unstuffJpeg(jpeg);
      }
      const next = small.readUInt32BE(0);
      pos += size; size = next;
    }
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Making the pictures

const NAMES = {
  punchoutLogo: 'punchout-logo.png', punchoutBg: 'punchout-bg.jpg',
  doclouisLogo: 'doclouis-logo.png', doclouisBg: 'doclouis-bg.jpg'
};

function logoPng(bannerFile) {
  const bnr = fs.readFileSync(bannerFile);
  const tpl = bannerFiles(bnr)['FE_Logo.tpl'];
  if (!tpl) throw new Error('no logo in the banner');
  const { width, height, rgba } = tplRgba(tpl);
  return png(width, height, rgba);
}

// Writes what it can into outDir and returns { made: [names], problems: [text] }. Sources: filesDir is the disc's
// files folder (DATA/files), docBanner the unpacked WAD's 00000000.app; either may be missing.
function buildArt({ filesDir, docBanner, outDir }) {
  const made = [], problems = [];
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name, produce) => {
    const target = path.join(outDir, name);
    try {
      const data = produce();
      if (!data) return;
      fs.writeFileSync(target + '.tmp', data);
      fs.renameSync(target + '.tmp', target);
      made.push(name);
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
    }
  };
  if (filesDir && fs.existsSync(filesDir)) {
    const bnr = path.join(filesDir, 'opening.bnr');
    if (fs.existsSync(bnr)) write(NAMES.punchoutLogo, () => logoPng(bnr));
    for (const [game, name] of [['punchout', NAMES.punchoutBg], ['doclouis', NAMES.doclouisBg]]) {
      const video = path.join(filesDir, ...BACKGROUNDS[game].file);
      if (fs.existsSync(video)) write(name, () => thpFrame(video, BACKGROUNDS[game].frame));
    }
  }
  if (docBanner && fs.existsSync(docBanner)) write(NAMES.doclouisLogo, () => logoPng(docBanner));
  if (made.length > 0) fs.writeFileSync(path.join(outDir, 'art.json'), JSON.stringify({ version: ART_VERSION, at: new Date().toISOString() }));
  return { made, problems };
}

module.exports = { buildArt, ddsToPng, thpFrame, unstuffJpeg, bannerFiles, tplRgba, png, lz77, u8Files, NAMES, BACKGROUNDS };
