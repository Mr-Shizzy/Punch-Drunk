'use strict';

// Tests for src/wad.js with a WAD built here from made-up contents and a made-up "common key" (random bytes), so no
// real key or game data is needed. Run: node --test test/

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseKey, readWad, unpackWad, describeWad } = require('../src/wad');

const align = (n, a = 0x40) => Math.ceil(n / a) * a;
const pad = (buf, a = 0x40) => Buffer.concat([buf, Buffer.alloc(align(buf.length, a) - buf.length)]);
function aesEnc(key, iv, data) {
  const c = crypto.createCipheriv('aes-128-cbc', key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
}

// A minimal WAD: header, cert chain (filler), ticket, TMD, then each content encrypted with the title key.
function makeWad(commonKey, contents, { titleId = '0001000157504345', keyIndex = 0 } = {}) {
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

const sample = () => [
  { id: 0, data: crypto.randomBytes(1000) },
  { id: 1, data: crypto.randomBytes(70000) },
  { id: 0x1a, data: crypto.randomBytes(33), shared: true }
];
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wadtest-')); }

test('parseKey: hex, spaced hex, raw 16 bytes, BootMii keys.bin', () => {
  const key = crypto.randomBytes(16);
  assert.deepStrictEqual(parseKey(key.toString('hex')), key);
  assert.deepStrictEqual(parseKey(' 0x' + key.toString('hex').toUpperCase().match(/../g).join(' ') + '\n'), key);
  assert.deepStrictEqual(parseKey(Buffer.from(key)), key);
  const keysBin = Buffer.alloc(0x400);
  keysBin.write('BackupMii v1, ConsoleID: 0badf00d\n', 0, 'latin1');
  key.copy(keysBin, 0x114);
  assert.deepStrictEqual(parseKey(keysBin), key);
  assert.throws(() => parseKey('not a key'), { code: 'bad-key-format' });
  assert.throws(() => parseKey(Buffer.alloc(0x400)), { code: 'bad-key-format' });
});

test('unpacks with the right key: tmd, ticket and each content, byte for byte', async () => {
  const key = crypto.randomBytes(16);
  const contents = sample();
  const dir = tmpDir();
  const wadFile = path.join(dir, 'game.wad');
  fs.writeFileSync(wadFile, makeWad(key, contents));
  assert.deepStrictEqual(describeWad(wadFile), { titleId: '0001000157504345', contents: 3 });
  const out = path.join(dir, 'title');
  const r = await unpackWad(wadFile, Buffer.from(key), out, { titleId: '0001000157504345' });
  assert.strictEqual(r.contents, 3);
  for (const c of contents) {
    assert.deepStrictEqual(fs.readFileSync(path.join(out, c.id.toString(16).padStart(8, '0') + '.app')), c.data);
  }
  assert.ok(fs.existsSync(path.join(out, 'title.tmd')) && fs.existsSync(path.join(out, 'title.tik')));
  assert.ok(!fs.existsSync(out + '.unpacking'));
});

test('the key buffer passed in is wiped afterwards', async () => {
  const key = crypto.randomBytes(16);
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'game.wad'), makeWad(key, sample()));
  const given = Buffer.from(key);
  await unpackWad(path.join(dir, 'game.wad'), given, path.join(dir, 'title'));
  assert.ok(given.every(b => b === 0));
});

test('a wrong key is refused, and an earlier good unpack is kept', async () => {
  const key = crypto.randomBytes(16);
  const dir = tmpDir();
  const wadFile = path.join(dir, 'game.wad');
  fs.writeFileSync(wadFile, makeWad(key, sample()));
  const out = path.join(dir, 'title');
  await unpackWad(wadFile, Buffer.from(key), out);
  const before = fs.readdirSync(out).sort();
  await assert.rejects(unpackWad(wadFile, crypto.randomBytes(16), out), { code: 'wrong-key' });
  assert.deepStrictEqual(fs.readdirSync(out).sort(), before);
  assert.ok(!fs.existsSync(out + '.unpacking'));
});

test('the wrong game, a Korean-key ticket, a damaged content and a non-WAD are refused', async () => {
  const key = crypto.randomBytes(16);
  const dir = tmpDir();
  const other = path.join(dir, 'other.wad');
  fs.writeFileSync(other, makeWad(key, sample(), { titleId: '0001000157414145' }));
  await assert.rejects(unpackWad(other, Buffer.from(key), path.join(dir, 'a'), { titleId: '0001000157504345' }), { code: 'wrong-title' });
  const korean = path.join(dir, 'korean.wad');
  fs.writeFileSync(korean, makeWad(key, sample(), { keyIndex: 1 }));
  await assert.rejects(unpackWad(korean, Buffer.from(key), path.join(dir, 'b')), { code: 'wrong-key-index' });
  const damaged = makeWad(key, sample());
  damaged[damaged.length - 0x40] ^= 0xFF; // inside the last content
  fs.writeFileSync(path.join(dir, 'damaged.wad'), damaged);
  await assert.rejects(unpackWad(path.join(dir, 'damaged.wad'), Buffer.from(key), path.join(dir, 'c')), { code: 'damaged' });
  fs.writeFileSync(path.join(dir, 'junk.wad'), crypto.randomBytes(5000));
  assert.throws(() => describeWad(path.join(dir, 'junk.wad')), { code: 'not-wad' });
  await assert.rejects(unpackWad(path.join(dir, 'junk.wad'), Buffer.from(key), path.join(dir, 'd')), { code: 'not-wad' });
});

test('readWad lays out contents at 0x40-aligned offsets', () => {
  const key = crypto.randomBytes(16);
  const w = readWad(makeWad(key, sample()));
  assert.strictEqual(w.contents.length, 3);
  for (const c of w.contents) assert.strictEqual(c.offset % 0x40, 0);
});
