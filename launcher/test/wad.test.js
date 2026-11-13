'use strict';

// Tests for src/wad.js with a WAD built here from made-up contents and a made-up "common key" (random bytes), so no
// real key or game data is needed. Run: node --test test/

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseKey, readWad, unpackWad, describeWad, buildTestWad: makeWad } = require('../src/wad');

const sample = () => [
  { id: 0, data: crypto.randomBytes(1000) },
  { id: 1, data: crypto.randomBytes(70000) },
  { id: 0x1a, data: crypto.randomBytes(33), shared: true }
];
const made = [];
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wadtest-')); made.push(d); return d; }
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

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
