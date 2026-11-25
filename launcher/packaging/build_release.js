'use strict';

// Builds the portable Windows release: one folder ("Punch-Drunk") holding the launcher, zipped with that folder
// inside, plus the zip's SHA-256. No installer: unzip anywhere and run "Punch-Drunk.exe".
//   1. runs the tests
//   2. electron-builder --win dir (the unpacked app)
//   3. copies it to dist\release\Punch-Drunk, with the README and licence files
//   4. runs the built exe's --selftest from a copy in a folder with a space in its path (proves it's portable)
//   5. zips it (top folder inside) and writes <zip>.sha256
//   6. deletes the intermediate folders, so the only exe left is the one in the release
// Run from launcher\: npm run dist:win

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = path.join(__dirname, '..');
const DIST = path.join(LAUNCHER, 'dist');
const UNPACKED = path.join(DIST, 'win-unpacked');
const RELEASE = path.join(DIST, 'release');
const FOLDER = 'Punch-Drunk';
const EXE = 'Punch-Drunk.exe';
const version = require(path.join(LAUNCHER, 'package.json')).version;
const ZIP = path.join(RELEASE, `Punch-Drunk-${version}-Windows-x64.zip`);

const step = text => console.log(`\n== ${text}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: LAUNCHER, shell: false, ...opts });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

if (process.platform !== 'win32') { console.error('Build the Windows release on Windows.'); process.exit(1); }

step('Tests');
run(process.execPath, ['--test', 'test/wad.test.js', 'test/updater.test.js']);

step('Build kit (the tools, source and pre-built translator the build needs, so setup works without internet)');
run(process.execPath, [path.join(__dirname, 'fetch_buildkit.js')]);
if (!fs.existsSync(path.join(LAUNCHER, 'buildkit', 'manifest.json'))) throw new Error('The build kit is missing');

step('Building the app');
// Only what this script makes: the Linux AppImages in dist\release stay.
for (const old of [UNPACKED, path.join(RELEASE, FOLDER), ZIP, `${ZIP}.sha256`]) fs.rmSync(old, { recursive: true, force: true });
run(npx, ['electron-builder', '--win', 'dir', '--x64'], { shell: true });
if (!fs.existsSync(path.join(UNPACKED, EXE))) throw new Error(`${EXE} wasn't built`);

step('Assembling the release folder');
const out = path.join(RELEASE, FOLDER);
fs.mkdirSync(RELEASE, { recursive: true });
fs.cpSync(UNPACKED, out, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'README.txt'), path.join(out, 'README.txt'));
fs.copyFileSync(path.join(__dirname, 'THIRD_PARTY_NOTICES.txt'), path.join(out, 'THIRD_PARTY_NOTICES.txt'));
if (!fs.existsSync(path.join(out, 'resources', 'buildkit', 'manifest.json'))) throw new Error('The build kit is missing from the build');
// Nothing of Microsoft's that its licences don't let us hand out: no Visual C++ runtime DLLs, no .NET SDK.
if (fs.existsSync(path.join(out, 'resources', 'vcruntime'))) throw new Error('resources\\vcruntime must not be in the download');
for (const name of fs.readdirSync(path.join(out, 'resources', 'buildkit', 'tools'))) {
  if (/dotnet/i.test(name)) throw new Error(`${name} (the .NET SDK) must not be in the download`);
}
if (!fs.existsSync(path.join(out, 'resources', 'buildkit', 'translator.zip'))) throw new Error('The pre-built translator is missing from the build');
fs.copyFileSync(path.join(LAUNCHER, '..', 'LICENSE'), path.join(out, 'LICENSE.txt'));
fs.copyFileSync(path.join(LAUNCHER, '..', 'port', 'LICENSE'), path.join(out, 'LICENSE-port.txt'));
// A fresh copy has no settings, data or temp yet; make sure none slipped in.
for (const name of ['settings.json', 'data', 'temp', 'selftest_result.txt']) fs.rmSync(path.join(out, name), { recursive: true, force: true });

step('Self-test from a folder with a space in its path');
// (The build PC's temp folder: the project folder's own path may not be a plain one.)
const trialRoot = path.join(require('node:os').tmpdir(), `punch drunk self test ${process.pid}`);
const trial = path.join(trialRoot, FOLDER);
fs.cpSync(out, trial, { recursive: true });
let selfTestOk = true;
try { run(path.join(trial, EXE), ['--selftest']); } catch { selfTestOk = false; }
const report = fs.readFileSync(path.join(trial, 'selftest_result.txt'), 'utf8');
console.log(report);
if (!selfTestOk || !report.includes('SELFTEST OK')) throw new Error('The built launcher failed its self-test.');
if (!report.startsWith(`Punch-Drunk ${version} packaged`)) throw new Error('The self-test names the wrong version.');

step('Checking for personal strings');
const personal = [process.env.USERNAME, process.env.USERPROFILE].filter(v => v && v.length > 2).map(v => v.toLowerCase());
const scan = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.(txt|json|js|html|css|md|ps1|sh|yml|patch)$/i.test(entry.name)) continue;
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const p of personal) if (text.includes(p)) throw new Error(`A personal string is in ${path.relative(out, file)}`);
  }
};
scan(path.join(out, 'resources'));
for (const name of fs.readdirSync(out)) if (/\.txt$/i.test(name)) scan(out);

step('Zipping');
fs.rmSync(ZIP, { force: true });
// Windows' tar (bsdtar) writes zip files with -a; the folder goes in as the zip's top folder.
run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', ZIP, FOLDER], { cwd: RELEASE });
const sha = crypto.createHash('sha256').update(fs.readFileSync(ZIP)).digest('hex');
fs.writeFileSync(`${ZIP}.sha256`, `${sha}  ${path.basename(ZIP)}\n`);

step('Cleaning up');
fs.rmSync(UNPACKED, { recursive: true, force: true });
fs.rmSync(trialRoot, { recursive: true, force: true });
for (const name of fs.readdirSync(DIST)) {
  if (name !== 'release') fs.rmSync(path.join(DIST, name), { recursive: true, force: true });
}

console.log(`\nDone.\n  Program: ${path.join(out, EXE)}\n  Zip:     ${ZIP}\n  SHA-256: ${sha}`);
