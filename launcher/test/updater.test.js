'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const updater = require('../src/updater');

const asset = (name, url) => ({ name, size: 1000, browser_download_url: url || `https://github.com/${updater.REPO}/releases/download/v1.2.3/${name}` });
const release = (over = {}) => ({
  tag_name: 'v1.2.3', draft: false, prerelease: false, body: 'Notes', html_url: `https://github.com/${updater.REPO}/releases/tag/v1.2.3`,
  assets: [asset('Punch-Drunk-1.2.3-Windows-x64.zip'), asset('Punch-Drunk-1.2.3-Windows-x64.zip.sha256')], ...over
});

test('versions compare numerically', () => {
  assert.ok(updater.isNewer('1.0.1', '1.0.0'));
  assert.ok(updater.isNewer('v1.10.0', '1.9.9'));
  assert.ok(updater.isNewer('2.0.0', '1.99.99'));
  assert.ok(!updater.isNewer('1.0.0', '1.0.0'));
  assert.ok(!updater.isNewer('1.0.0', '1.0.1'));
  assert.ok(!updater.isNewer('garbage', '1.0.0'));
  assert.ok(!updater.isNewer('1.0.1-beta', '1.0.0'));
});

test('only GitHub (and, in test mode, this PC) may be contacted', () => {
  const ok = u => updater.allowedUrl(u);
  assert.ok(ok(`https://github.com/${updater.REPO}/releases/download/v1/x.zip`));
  assert.ok(ok('https://objects.githubusercontent.com/anything'));
  assert.ok(ok(`https://api.github.com/repos/${updater.REPO}/releases/latest`));
  assert.ok(!ok('https://github.com/someone-else/repo/releases/download/v1/x.zip'));
  assert.ok(!ok('https://api.github.com/repos/someone-else/repo/releases/latest'));
  assert.ok(!ok('http://github.com/' + updater.REPO));
  assert.ok(!ok('https://evil.example.com/x.zip'));
  assert.ok(!ok('https://github.com.evil.example/Mr-Shizzy/Punch-Drunk/releases/download/x'));
  assert.ok(!ok('https://user:pw@github.com/' + updater.REPO + '/releases/download/x'));
  assert.ok(!ok('http://127.0.0.1:8080/x'), 'local addresses only in test mode');
  assert.ok(updater.allowedUrl('http://127.0.0.1:8080/x', true));
  assert.ok(!updater.allowedUrl('http://192.168.1.5/x', true));
  assert.ok(!updater.allowedUrl('file:///C:/x', true));
});

test('a usable release is picked, an unusable one is not', () => {
  const info = updater.pickRelease(release(), { selfUpdate: true });
  assert.equal(info.version, '1.2.3');
  assert.equal(info.manual, false);
  assert.equal(info.asset.name, 'Punch-Drunk-1.2.3-Windows-x64.zip');
  assert.equal(info.sha.name, 'Punch-Drunk-1.2.3-Windows-x64.zip.sha256');
  assert.equal(updater.pickRelease(release({ draft: true }), { selfUpdate: true }), null);
  assert.equal(updater.pickRelease(release({ prerelease: true }), { selfUpdate: true }), null);
  assert.equal(updater.pickRelease(release({ tag_name: 'nightly' }), { selfUpdate: true }), null);
  assert.equal(updater.pickRelease(null, { selfUpdate: true }), null);
});

test('without the zip or its checksum, or from a strange address, the notice is only a link', () => {
  assert.equal(updater.pickRelease(release({ assets: [asset('Punch-Drunk-1.2.3-Windows-x64.zip')] }), { selfUpdate: true }).manual, true);
  assert.equal(updater.pickRelease(release({ assets: [] }), { selfUpdate: true }).manual, true);
  const hostile = release({ assets: [asset('Punch-Drunk-1.2.3-Windows-x64.zip', 'https://evil.example.com/a.zip'), asset('Punch-Drunk-1.2.3-Windows-x64.zip.sha256')] });
  assert.equal(updater.pickRelease(hostile, { selfUpdate: true }).manual, true);
  // Other platforms are always a link.
  assert.equal(updater.pickRelease(release(), { selfUpdate: false }).manual, true);
  // A link outside GitHub is replaced by the releases page.
  assert.equal(updater.pickRelease(release({ html_url: 'https://evil.example.com/' }), {}).page, updater.RELEASES_PAGE);
});

test('the checksum file is read like sha256sum writes it', () => {
  const h = 'a'.repeat(64);
  assert.equal(updater.parseSha256(`${h}  Punch-Drunk-1.2.3-Windows-x64.zip\n`, 'Punch-Drunk-1.2.3-Windows-x64.zip'), h);
  assert.equal(updater.parseSha256(`${h.toUpperCase()} *Punch-Drunk-1.2.3-Windows-x64.zip`, 'Punch-Drunk-1.2.3-Windows-x64.zip'), h);
  assert.equal(updater.parseSha256(`${h}\n`, 'x.zip'), h);
  assert.equal(updater.parseSha256(`${h}  other.zip`, 'x.zip'), null);
  assert.equal(updater.parseSha256('not a hash', 'x.zip'), null);
  assert.equal(updater.parseSha256('', 'x.zip'), null);
});

test('network problems are said in plain words', () => {
  assert.match(updater.describeError(Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' })), /couldn't reach the server/);
  assert.match(updater.describeError(Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' })), /Is this PC online/);
  assert.match(updater.describeError(new Error('The download was interrupted.')), /couldn't reach the server/);
  assert.match(updater.describeError(new Error('HTTP 404')), /no release/);
  assert.match(updater.describeError(new Error('HTTP 403')), /limiting requests/);
  assert.match(updater.describeError(new Error('HTTP 500')), /500/);
  assert.equal(updater.describeError(new Error('The downloaded update is damaged.')), 'The downloaded update is damaged.');
});

// ---- the apply script, run for real on a made-up program folder (Windows only) ----

const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const onWindows = process.platform === 'win32' && fs.existsSync(powershell);

function makeProgram(base, version, files) {
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'Punch-Drunk.cmd'), `@echo started ${version}> "%~dp0started.txt"\r\n`);
  fs.mkdirSync(path.join(base, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(base, 'resources', 'version.txt'), version);
  for (const [name, text] of Object.entries(files || {})) fs.writeFileSync(path.join(base, name), text);
}
function runApply(root, staging, extra = []) {
  const script = path.join(root, 'update', 'apply-update.ps1');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, updater.APPLY_SCRIPT);
  const result = path.join(root, 'update', 'result.json');
  const argsFile = path.join(root, 'update', 'apply-args.json');
  fs.writeFileSync(argsFile, JSON.stringify({ launcherPid: 999999, root, staging, exe: 'Punch-Drunk.cmd', result, from: '1.0.0', to: '1.0.1' }));
  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ArgsFile', argsFile, ...extra],
    { encoding: 'utf8', timeout: 120000 });
  return { r, result: fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, 'utf8')) : null };
}
function cleanup(dir) {   // the restarted launcher (a .cmd here) may still hold the folder for a moment
  for (let i = 0; i < 20; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); }
  }
}
const waitFor = (file, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fs.existsSync(file)) return true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); } return false; };

test('the apply script swaps the files and keeps the player\'s own', { skip: !onWindows }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd update test '));
  try {
    const root = path.join(dir, 'Punch-Drunk');
    makeProgram(root, 'old', { 'old-only.dll': 'x', 'common.dll': 'old', 'settings.json': '{"mine":true}' });
    fs.mkdirSync(path.join(root, 'data', 'port'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'port', 'save.bin'), 'SAVE');
    fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
    const staging = path.join(root, 'update', 'staging', 'Punch-Drunk');
    makeProgram(staging, 'new', { 'new-only.dll': 'y', 'common.dll': 'new' });
    const { r, result } = runApply(root, staging);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(root, 'resources', 'version.txt'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(root, 'common.dll'), 'utf8'), 'new');
    assert.ok(fs.existsSync(path.join(root, 'new-only.dll')));
    assert.ok(!fs.existsSync(path.join(root, 'old-only.dll')), 'a file the new version no longer has is gone');
    assert.equal(fs.readFileSync(path.join(root, 'data', 'port', 'save.bin'), 'utf8'), 'SAVE', 'the player\'s data is untouched');
    assert.equal(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), '{"mine":true}', 'settings are untouched');
    assert.ok(!fs.readdirSync(root).some(n => n.endsWith('.old-update')), 'no leftovers');
    assert.ok(!fs.existsSync(staging), 'the unpacked update is removed');
    assert.ok(waitFor(path.join(root, 'started.txt')), 'the new launcher was started');
    assert.match(fs.readFileSync(path.join(root, 'started.txt'), 'utf8'), /new/);
  } finally { cleanup(dir); }
});

test('the apply script puts the old files back when it can\'t finish', { skip: !onWindows }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd update test '));
  try {
    const root = path.join(dir, 'Punch-Drunk');
    makeProgram(root, 'old', { 'common.dll': 'old', 'settings.json': '{"mine":true}' });
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'save.bin'), 'SAVE');
    const staging = path.join(root, 'update', 'staging', 'Punch-Drunk');
    makeProgram(staging, 'new', { 'common.dll': 'new' });
    // A process working inside resources\ stops that folder from being renamed (as an antivirus scan or a stray program would).
    const holder = spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'ping -n 40 127.0.0.1 >nul'], { cwd: path.join(root, 'resources'), stdio: 'ignore' });
    let out;
    try { out = runApply(root, staging); } finally { holder.kill(); spawnSync('taskkill', ['/PID', String(holder.pid), '/T', '/F'], { stdio: 'ignore' }); }
    assert.equal(out.result.ok, false, JSON.stringify(out.result));
    assert.equal(fs.readFileSync(path.join(root, 'resources', 'version.txt'), 'utf8'), 'old', 'the old program is back');
    assert.equal(fs.readFileSync(path.join(root, 'common.dll'), 'utf8'), 'old');
    assert.ok(fs.existsSync(path.join(root, 'Punch-Drunk.cmd')));
    assert.equal(fs.readFileSync(path.join(root, 'data', 'save.bin'), 'utf8'), 'SAVE');
    assert.equal(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), '{"mine":true}');
    assert.ok(!fs.readdirSync(root).some(n => n.endsWith('.old-update')), 'nothing left half-moved');
    assert.ok(waitFor(path.join(root, 'started.txt')), 'the old launcher was started again');
    assert.match(fs.readFileSync(path.join(root, 'started.txt'), 'utf8'), /old/);
  } finally { cleanup(dir); }
});
