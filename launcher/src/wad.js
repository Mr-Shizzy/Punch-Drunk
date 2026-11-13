'use strict';

// Unpacks a WiiWare WAD (the player's own backup) into a title folder: title.tmd, title.tik and <content id>.app,
// each content decrypted and checked against the SHA-1 its TMD lists. No emulator is involved.
//
// The Wii common key is NOT part of this program. The player supplies it (their BootMii keys.bin, or pasted), it is
// used for this one unpack and then wiped from memory. It is never saved, logged, hashed or sent anywhere. A wrong
// key is caught because the decrypted contents don't match their TMD hashes.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const align = (n, a = 0x40) => Math.ceil(n / a) * a;

class WadError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// The common key, from what the player gives: a BootMii keys.bin (its OTP holds the key at 0x114), a 16-byte raw key
// file, or 32 hex digits (pasted, or in a text file). Returns a 16-byte Buffer, or throws a WadError.
function parseKey(input) {
  if (Buffer.isBuffer(input)) {
    if (input.length === 16) return Buffer.from(input);
    // BootMii's keys.bin: 0x400 bytes, a text header ("BackupMii v1, ConsoleID: ...") then the OTP at 0x100.
    if (input.length === 0x400 && input.subarray(0, 9).toString('latin1') === 'BackupMii') {
      return Buffer.from(input.subarray(0x114, 0x124));
    }
    input = input.toString('latin1');
  }
  const hex = String(input).replace(/0x/gi, '').replace(/[\s:-]/g, '');
  if (/^[0-9a-fA-F]{32}$/.test(hex)) return Buffer.from(hex, 'hex');
  throw new WadError("That isn't a Wii common key. Choose the keys.bin from your BootMii backup, or paste the key as 32 hexadecimal digits.", 'bad-key-format');
}

function aesCbcDecrypt(key, iv, data) {
  const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
}

// Reads the WAD's layout and its TMD, without any key. Used to check the file is the right game before asking for
// the key, and by unpackWad.
function readWad(buf) {
  if (buf.length < 0x40) throw new WadError("That file is too small to be a WAD.", 'not-wad');
  const headerSize = buf.readUInt32BE(0), type = buf.subarray(4, 6).toString('latin1');
  if (headerSize !== 0x20 || (type !== 'Is' && type !== 'ib')) throw new WadError("That file isn't a WiiWare WAD.", 'not-wad');
  const certSize = buf.readUInt32BE(0x08), tikSize = buf.readUInt32BE(0x10), tmdSize = buf.readUInt32BE(0x14);
  const dataSize = buf.readUInt32BE(0x18);
  const certAt = align(headerSize), tikAt = certAt + align(certSize), tmdAt = tikAt + align(tikSize), dataAt = tmdAt + align(tmdSize);
  if (tikSize < 0x2A4 || tmdSize < 0x1E4 || dataAt + dataSize > buf.length) throw new WadError("That WAD is incomplete or damaged.", 'damaged');
  const ticket = buf.subarray(tikAt, tikAt + tikSize);
  const tmd = buf.subarray(tmdAt, tmdAt + tmdSize);
  const titleId = tmd.subarray(0x18C, 0x194).toString('hex');
  const count = tmd.readUInt16BE(0x1DE);
  if (tmdSize < 0x1E4 + 36 * count) throw new WadError("That WAD is incomplete or damaged.", 'damaged');
  const contents = [];
  let at = dataAt;
  for (let i = 0; i < count; i++) {
    const r = 0x1E4 + 36 * i;
    const c = {
      id: tmd.readUInt32BE(r), index: tmd.readUInt16BE(r + 4), type: tmd.readUInt16BE(r + 6),
      size: Number(tmd.readBigUInt64BE(r + 8)), sha1: tmd.subarray(r + 16, r + 36).toString('hex'), offset: at
    };
    c.name = c.id.toString(16).padStart(8, '0') + '.app';
    at += align(c.size, 0x40);
    if (c.offset + align(c.size, 16) > dataAt + dataSize) throw new WadError("That WAD is incomplete or damaged.", 'damaged');
    contents.push(c);
  }
  return { ticket, tmd, titleId, ticketTitleId: ticket.subarray(0x1DC, 0x1E4).toString('hex'), commonKeyIndex: ticket[0x1F1], contents };
}

// Unpacks wadFile into outDir with the player's common key (a Buffer from parseKey; wiped when this returns).
// options.titleId: the title it must be (hex, e.g. '0001000157504345'); options.check(name, data): extra checks on a
// decrypted content (e.g. the game code's sha256), throwing to refuse it. Writes to a temporary folder first, so a
// failed unpack leaves an earlier good one in place.
async function unpackWad(wadFile, key, outDir, options = {}) {
  let titleKey = null;
  try {
    const buf = await fsp.readFile(wadFile);
    const wad = readWad(buf);
    if (options.titleId && wad.titleId !== options.titleId) {
      throw new WadError(options.wrongTitleMessage || "That WAD is a different game.", 'wrong-title');
    }
    // 1 = the Korean key, 2 = the Wii U's vWii key. Other values are the normal key: real tickets carry stray values
    // here (this game's USA WAD has 0x0A), and Dolphin treats them the same way.
    if (wad.commonKeyIndex === 1 || wad.commonKeyIndex === 2) {
      throw new WadError("That WAD uses a regional key (not the USA release's), which isn't supported.", 'wrong-key-index');
    }
    // The ticket's title key, decrypted with the common key; the IV is the title ID then zeros.
    const iv = Buffer.alloc(16);
    wad.ticket.copy(iv, 0, 0x1DC, 0x1E4);
    titleKey = aesCbcDecrypt(key, iv, wad.ticket.subarray(0x1BF, 0x1CF));

    const tmp = outDir + '.unpacking';
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    try {
      await fsp.writeFile(path.join(tmp, 'title.tmd'), wad.tmd);
      await fsp.writeFile(path.join(tmp, 'title.tik'), wad.ticket);
      for (const [n, c] of wad.contents.entries()) {
        const civ = Buffer.alloc(16);
        civ.writeUInt16BE(c.index, 0);
        const enc = buf.subarray(c.offset, c.offset + align(c.size, 16));
        const data = aesCbcDecrypt(titleKey, civ, enc).subarray(0, c.size);
        if (crypto.createHash('sha1').update(data).digest('hex') !== c.sha1) {
          // With the wrong key, the very first content already fails; later failures mean a damaged file.
          throw n === 0
            ? new WadError("That key didn't unlock this WAD. Check it's the Wii common key from your own console.", 'wrong-key')
            : new WadError(`That WAD is damaged (content ${c.index}, ${c.name}).`, 'damaged');
        }
        if (options.check) options.check(c.name, data);
        await fsp.writeFile(path.join(tmp, c.name), data);
        if (options.onProgress) options.onProgress(n + 1, wad.contents.length);
      }
      await fsp.rm(outDir, { recursive: true, force: true });
      await fsp.rename(tmp, outDir);
    } catch (err) {
      await fsp.rm(tmp, { recursive: true, force: true });
      throw err;
    }
    return { titleId: wad.titleId, contents: wad.contents.length };
  } finally {
    // Best effort: don't leave the keys lying around in memory.
    if (titleKey) titleKey.fill(0);
    if (Buffer.isBuffer(key)) key.fill(0);
  }
}

// Just the TMD details, for checking a chosen WAD before the key is asked for.
function describeWad(wadFile) {
  const fd = fs.openSync(wadFile, 'r');
  try {
    const head = Buffer.alloc(0x40);
    fs.readSync(fd, head, 0, 0x40, 0);
    if (head.readUInt32BE(0) !== 0x20) throw new WadError("That file isn't a WiiWare WAD.", 'not-wad');
    const certSize = head.readUInt32BE(0x08), tikSize = head.readUInt32BE(0x10), tmdSize = head.readUInt32BE(0x14);
    const tmdAt = align(0x20) + align(certSize) + align(tikSize);
    if (tmdSize < 0x1E4 || tmdSize > 0x10000) throw new WadError("That file isn't a WiiWare WAD.", 'not-wad');
    const tmd = Buffer.alloc(tmdSize);
    fs.readSync(fd, tmd, 0, tmdSize, tmdAt);
    return { titleId: tmd.subarray(0x18C, 0x194).toString('hex'), contents: tmd.readUInt16BE(0x1DE) };
  } finally {
    fs.closeSync(fd);
  }
}

const pad = (buf, a = 0x40) => Buffer.concat([buf, Buffer.alloc(align(buf.length, a) - buf.length)]);
function aesEnc(key, iv, data) {
  const c = crypto.createCipheriv('aes-128-cbc', key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
}

// For tests and --selftest only: a minimal WAD of made-up contents, encrypted with a made-up key (any 16 bytes).
// A minimal WAD: header, cert chain (filler), ticket, TMD, then each content encrypted with the title key.
function buildTestWad(commonKey, contents, { titleId = '0001000157504345', keyIndex = 0 } = {}) {
  const tid = Buffer.from(titleId, 'hex');
  const titleKey = crypto.randomBytes(16);
  const ticket = Buffer.alloc(0x2A4);
  ticket.writeUInt32BE(0x00010001, 0);
  tid.copy(ticket, 0x1DC);
  ticket[0x1F1] = keyIndex;
  aesEnc(commonKey, Buffer.concat([tid, Buffer.alloc(8)]), titleKey).copy(ticket, 0x1BF);
  const tmd = Buffer.alloc(0x1E4 + 36 * contents.length);
  tid.copy(tmd, 0x18C);
  tmd.writeUInt16BE(contents.length, 0x1DE);
  const data = [];
  contents.forEach((c, i) => {
    const r = 0x1E4 + 36 * i;
    tmd.writeUInt32BE(c.id, r);
    tmd.writeUInt16BE(i, r + 4);
    tmd.writeUInt16BE(c.shared ? 0x8001 : 1, r + 6);
    tmd.writeBigUInt64BE(BigInt(c.data.length), r + 8);
    crypto.createHash('sha1').update(c.data).digest().copy(tmd, r + 16);
    const iv = Buffer.alloc(16);
    iv.writeUInt16BE(i, 0);
    data.push(pad(aesEnc(titleKey, iv, pad(c.data, 16))));
  });
  const cert = Buffer.alloc(0xA00, 0xCC);
  const body = Buffer.concat(data);
  const header = Buffer.alloc(0x20);
  header.writeUInt32BE(0x20, 0);
  header.write('Is', 4, 'latin1');
  header.writeUInt32BE(cert.length, 0x08);
  header.writeUInt32BE(ticket.length, 0x10);
  header.writeUInt32BE(tmd.length, 0x14);
  header.writeUInt32BE(body.length, 0x18);
  return Buffer.concat([pad(header), pad(cert), pad(ticket), pad(tmd), body]);
}

module.exports = { parseKey, readWad, unpackWad, describeWad, buildTestWad, WadError };
