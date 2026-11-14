'use strict';

// Punch-Drunk: Punch-Out (Wii) Recomp, a fork of POW: Recompiled!!: the launcher's main process. Sets up the ports on the player's own computer from their own copies (checks
// the build tools; Punch-Out!!: validates and extracts the disc with nodtool; Doc Louis's Punch-Out!!: unpacks the
// player's WAD with the Wii common key they supply, src/wad.js), builds a port with scripts/build_port.sh, or scripts/build_port.ps1 on Windows,
// then launches it. Settings live in Punch-Out!!'s Config.toml, so the game's F10 menu and the launcher always
// agree; Doc Louis's reads the shared ones (controls, graphics, sound, button prompts) from there too.

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const toml = require('./toml-edit');
const art = require('./art');
const { pathToFileURL } = require('node:url');
const wad = require('./wad');

// The one supported disc: Punch-Out!! (USA), its main.dol.
const GAME_ID = 'R7PE01';
const MAIN_DOL_MD5 = '1276cd5952e3b4c644925928786b3e20';
// nodtool (encounter/nod, MIT / Apache-2.0): the same pinned release WiiCompiled's own setup uses.
const NODTOOL = {
  version: 'v2.0.0-alpha.10',
  'linux-x64': { asset: 'nodtool-linux-x86_64', sha256: 'f853b83268b9542faf0d28815bc3a23c090ae28ebf397e46f99cbb08122c8307' },
  'win32-x64': { asset: 'nodtool-windows-x86_64.exe', sha256: '1e150e33b88157527f96caea89ad12267aed8b117180c9ebaa89ebe89c1d948d' }
};
// Doc Louis's Punch-Out!! (WiiWare, USA): title 00010001-57504345, and
// the sha256 of its game code (content 1).
const DOC_TITLE = ['00010001', '57504345'];
const DOC_DOL_SHA256 = '3ea93aaa347414c4cd81891f4d13d605b2316abb53f1bc511d036122ea5c37eb';
const GAMES = {
  // legacyBinaries: names a build from before a rename has; found, it counts as built (and outdated), so Play works.
  punchout: { name: 'Punch-Out!!', binary: 'PunchDrunk', legacyBinaries: ['POWRecompiled'] },
  doclouis: { name: "Doc Louis's Punch-Out!!", binary: 'PunchDrunkDocLouis', legacyBinaries: ['DocLouis'] }
};
const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
// Windows: the launcher brings its own Git (MinGit, pinned) and .NET 8 SDK (the newest 8.0 SDK, checked against
// Microsoft's own release list) into its tools folder, so players install nothing. The compiler, CMake and Ninja
// come during the build, from WiiCompiled's own pinned Windows tool list (build_port.ps1 step 3).
const MINGIT = {
  version: '2.53.0',
  url: 'https://github.com/git-for-windows/git/releases/download/v2.53.0.windows.1/MinGit-2.53.0-64-bit.zip',
  sha256: '82b562c918ec87b2ef5316ed79bb199e3a25719bb871a0f10294acf21ebd08cd'
};
const DOTNET_RELEASES = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json';
const TOOLS = [
  { name: 'git', args: ['--version'] },
  { name: 'dotnet', args: ['--list-sdks'], check: out => dotnetSdkOk(out), need: '.NET SDK 8.0.200 or newer' },
  { name: 'cmake', args: ['--version'] },
  { name: 'ninja', args: ['--version'] },
  { name: 'clang', args: ['--version'] },
  { name: 'clang++', args: ['--version'] }
];

// The translator's TOML library (Tomlyn) needs the C# compiler of .NET SDK 8.0.200 or newer. Ubuntu's and Fedora's own
// dotnet-sdk-8.0 packages are the 8.0.1xx band, which fails with CS9057; Microsoft's install script
// (dotnet-install.sh, into ~/.dotnet) gets a newer one, and the launcher uses that when the system's is too old.
function dotnetSdkOk(listSdks) {
  return listSdks.split('\n').some(line => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(line.trim());
    if (!m) return false;
    const [major, patch] = [Number(m[1]), Number(m[3])];
    return major > 8 || (major === 8 && patch >= 200);
  });
}
const DOTNET_INSTALL = 'curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0';

// Steam Deck launcher: the same launcher plus its own build environment (resources/buildroot.tar.xz: Ubuntu 24.04
// with the compiler, CMake, Ninja, Git and .NET 8; Release/make_steamdeck_appimage.sh). It's unpacked into the tools
// folder once, and builds run inside it (scripts/build_port_steamdeck.sh, through bubblewrap): SteamOS can't install
// build tools, and a game built there runs on SteamOS. Nothing else about the launcher changes.
const BUILDROOT_ARCHIVE = path.join(process.resourcesPath || '', 'buildroot.tar.xz');
const STEAM_DECK = !IS_WIN && fs.existsSync(BUILDROOT_ARCHIVE);
function buildrootVersion() {
  try { return fs.readFileSync(path.join(process.resourcesPath || '', 'buildroot.version'), 'utf8').trim(); } catch { return 'unknown'; }
}
const buildrootDir = () => path.join(paths().tools, 'buildroot');
const buildrootMarker = () => path.join(buildrootDir(), '.re-punched-buildroot');

let win = null;
let config = {};
let task = null;      // { label, detail, percent }
let child = null;     // the running build / game
let gameRunning = false;
let toolsCache = null;
const logLines = [];

// ---------------------------------------------------------------------------------------------------------------
// Config and paths

// Portable: everything lives in the program's own folder, found from where it runs (so the folder can be moved or
// renamed): the launcher's settings.json, its data folder (tools, the unpacked games, builds, logs), Chromium's
// profile and a temp folder per running copy. Nothing goes to AppData, the registry or the system temp folder.
// Development (npm start): PUNCHDRUNK_ROOT, or launcher/dev-portable.
const PORTABLE_ROOT = app.isPackaged
  ? path.dirname(process.env.APPIMAGE || process.execPath)
  : path.resolve(process.env.PUNCHDRUNK_ROOT || path.join(__dirname, '..', 'dev-portable'));
const RUN_TEMP = path.join(PORTABLE_ROOT, 'temp', `run${process.pid}`);

// Must run before the app is ready: Chromium's profile, crash dumps and Electron's temp folder.
function usePortableFolders() {
  const profile = path.join(PORTABLE_ROOT, 'data', 'launcher-profile');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(RUN_TEMP, { recursive: true });
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.setPath('crashDumps', path.join(profile, 'crashes'));
  app.setPath('logs', path.join(profile, 'logs'));
  app.setPath('temp', RUN_TEMP);
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = RUN_TEMP;
}
// temp\run<pid> folders of copies that are no longer running.
function sweepTemp() {
  const base = path.join(PORTABLE_ROOT, 'temp');
  let entries = [];
  try { entries = fs.readdirSync(base); } catch { return; }
  for (const name of entries) {
    const m = /^run(\d+)$/.exec(name);
    if (!m || Number(m[1]) === process.pid) continue;
    let alive = false;
    try { process.kill(Number(m[1]), 0); alive = true; } catch (err) { alive = err.code === 'EPERM'; }
    if (!alive) { try { fs.rmSync(path.join(base, name), { recursive: true, force: true }); } catch { /* in use: next time */ } }
  }
}
function removeRunTemp() {
  try { fs.rmSync(RUN_TEMP, { recursive: true, force: true }); } catch { /* next start sweeps it */ }
}

const configFile = () => path.join(PORTABLE_ROOT, 'settings.json');
function loadConfig() {
  try { config = JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { config = {}; }
}
// Written to settings.json.tmp, then swapped in, so a crash never leaves half a file.
function saveConfig() {
  const tmp = configFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configFile());
}
// A folder setting inside the program's folder is kept relative, so moving the folder keeps it working.
const storePath = dir => {
  const rel = path.relative(PORTABLE_ROOT, dir);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : dir;
};
const loadPath = value => (value ? path.resolve(PORTABLE_ROOT, value) : null);
const DEFAULT_DATA_ROOT = path.join(PORTABLE_ROOT, 'data');
const dataRoot = () => loadPath(config.dataRoot) || DEFAULT_DATA_ROOT;
// WiiCompiled's native build only takes plain paths; for any other it makes a junction under ProgramData, which a
// portable program mustn't. So the data folder has to be a plain path (letters, digits, spaces, . _ -).
const PLAIN_PATH = /^[A-Za-z0-9 ._\\:-]+$/;
function checkPlainDataRoot() {
  if (IS_WIN && !PLAIN_PATH.test(path.resolve(dataRoot()))) {
    throw new Error(`The game can only be built in a folder whose path has just letters, numbers, spaces, dots, dashes and underscores. Move the launcher's folder somewhere like C:\\Games\\Punch-Drunk (now: ${dataRoot()}).`);
  }
}
const paths = () => {
  const root = dataRoot();
  return {
    root,
    tools: path.join(root, 'tools'),
    disc: config.discFolder || path.join(root, 'disc', 'DATA'),
    work: path.join(root, 'work'),
    port: path.join(root, 'port'),
    logs: path.join(root, 'logs'),
    gameConfig: path.join(root, 'port', 'UserData', 'Config.toml')
  };
};
// The selected game, and its folders. Punch-Out!!'s are the ones above (its Config.toml holds the shared settings).
const currentGame = () => (Object.hasOwn(GAMES, config.game) ? config.game : 'punchout');
const gamePaths = (game = currentGame()) => {
  const p = paths();
  if (game === 'punchout') return { data: p.disc, work: p.work, port: p.port, logs: p.logs, config: p.gameConfig };
  return {
    data: path.join(p.root, 'doclouis', 'title'), work: path.join(p.root, 'work-doclouis'),
    port: path.join(p.root, 'port-doclouis'), logs: path.join(p.logs, 'doclouis'),
    config: path.join(p.root, 'port-doclouis', 'UserData', 'Config.toml')
  };
};
// The port's own files (the WiiCompiled patch and the Punch-Out project): bundled with the launcher, or a folder
// chosen in Settings (for development: the recomp_wip folder).
function portSource() {
  const candidates = [loadPath(config.portSource), process.env.PUNCHOUT_PORT_SOURCE,
    path.join(process.resourcesPath || '', 'port-source'), path.join(__dirname, '..', 'port-source'),
    // The repository layout (launcher/ next to port/), and the development one (next to recomp_wip).
    path.join(__dirname, '..', '..', 'port'), path.join(__dirname, '..', '..', 'recomp_wip')];
  return candidates.find(dir => dir && fs.existsSync(path.join(dir, 'punchout_region.patch'))) || null;
}
function buildScript() {
  const name = IS_WIN ? 'build_port.ps1' : 'build_port.sh';
  const packaged = path.join(process.resourcesPath || '', 'scripts', name);
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'scripts', name);
}
// Windows: the portable tools the launcher downloads itself.
const winTools = () => {
  const t = paths().tools;
  return { git: path.join(t, 'git', 'cmd', 'git.exe'), dotnet: path.join(t, 'dotnet', 'dotnet.exe'), dotnetDir: path.join(t, 'dotnet') };
};

// ---------------------------------------------------------------------------------------------------------------
// Helpers

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const HEADLESS = process.argv.includes('--build') || process.argv.includes('--unpack-doc');
function log(line) {
  if (HEADLESS) console.log(line);
  logLines.push(line);
  if (logLines.length > 4000) logLines.splice(0, logLines.length - 4000);
  send('log', line);
}
let lastTaskLabel = null;
function setTask(next) {
  task = next;
  send('task', task);
  if (HEADLESS && next && next.label !== lastTaskLabel) console.log(`== ${next.label}`);
  lastTaskLabel = next ? next.label : null;
}
function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: opts.timeout || 20000, maxBuffer: 16 * 1024 * 1024, ...opts }, (error, stdout, stderr) =>
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error }));
  });
}
async function md5(file) {
  const hash = crypto.createHash('md5');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function download(url, dest, onProgress = null, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'punch-drunk-launcher' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`download failed (HTTP ${res.statusCode})`)); return; }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      if (onProgress) res.on('data', chunk => { got += chunk.length; onProgress(got, total); });
      const part = dest + '.part';
      const out = fs.createWriteStream(part);
      res.pipe(out);
      out.on('finish', () => out.close(err => {
        if (err) { reject(err); return; }
        try { fs.renameSync(part, dest); resolve(); } catch (e) { reject(e); }
      }));
      out.on('error', err => { fs.rm(part, { force: true }, () => reject(err)); });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Build tools

function distroInstallHint(missing) {
  let id = '';
  try { id = fs.readFileSync('/etc/os-release', 'utf8'); } catch { /* unknown */ }
  const like = (/^ID(?:_LIKE)?=(.*)$/gm.exec(id) || [])[1] || '';
  const all = id + ' ' + like;
  // SteamOS (Steam Deck): its system is read-only, so the tools go in an Ubuntu 24.04 distrobox, and the launcher
  // builds from inside it. Ubuntu 24.04's glibc (2.39) is older than SteamOS's, so the game it builds also runs
  // outside the container; one built in an Arch container (or on an up-to-date Arch PC) doesn't.
  if (/^ID=["']?steamos/im.test(id)) {
    return 'distrobox create --name powrecompiled --image ubuntu:24.04 && distrobox enter powrecompiled -- bash -c ' +
      `"sudo apt update && sudo apt install -y git cmake ninja-build clang curl libfuse2t64 && ${DOTNET_INSTALL}"` +
      '   # then run this launcher inside it: distrobox enter powrecompiled';
  }
  const pkgs = {
    apt: { git: 'git', dotnet: 'dotnet-sdk-8.0', cmake: 'cmake', ninja: 'ninja-build', clang: 'clang', 'clang++': 'clang' },
    dnf: { git: 'git', dotnet: 'dotnet-sdk-8.0', cmake: 'cmake', ninja: 'ninja-build', clang: 'clang', 'clang++': 'clang' },
    pacman: { git: 'git', dotnet: 'dotnet-sdk', cmake: 'cmake', ninja: 'ninja', clang: 'clang', 'clang++': 'clang' }
  };
  const manager = /arch|manjaro|endeavour|cachyos/i.test(all) ? 'pacman' : /fedora|rhel|centos|nobara|bazzite/i.test(all) ? 'dnf' : /debian|ubuntu|mint|pop|zorin|elementary/i.test(all) ? 'apt' : null;
  if (!manager) return missing.includes('dotnet') ? DOTNET_INSTALL : null;
  // .NET: Arch's package is current; Ubuntu's and Fedora's are too old (see dotnetSdkOk), so Microsoft's script.
  const script = manager !== 'pacman' && missing.includes('dotnet');
  const names = [...new Set(missing.filter(t => !(script && t === 'dotnet')).map(t => pkgs[manager][t]))];
  const install = !names.length ? null : manager === 'pacman' ? `sudo pacman -S --needed ${names.join(' ')}`
    : manager === 'dnf' ? `sudo dnf install ${names.join(' ')}` : `sudo apt install ${names.join(' ')}`;
  return [install, script ? DOTNET_INSTALL : null].filter(Boolean).join(' && ');
}

async function checkTools(force = false) {
  if (toolsCache && !force) return toolsCache;
  if (IS_WIN) return (toolsCache = await checkWindowsTools());
  if (STEAM_DECK) return (toolsCache = checkBuildroot());
  const results = [];
  for (const tool of TOOLS) {
    const r = await run(tool.name, tool.args, { timeout: 10000 });
    let ok = r.ok && (!tool.check || tool.check(r.stdout));
    if (!ok && tool.name === 'dotnet') {
      // The system's .NET is missing or too old: the one dotnet-install.sh puts in ~/.dotnet, if it's there (the
      // build then finds it first on PATH).
      const home = path.join(os.homedir(), '.dotnet');
      const own = await run(path.join(home, 'dotnet'), tool.args, { timeout: 10000 });
      if (own.ok && dotnetSdkOk(own.stdout)) {
        ok = true;
        if (!(process.env.PATH || '').split(':').includes(home)) process.env.PATH = `${home}:${process.env.PATH || ''}`;
        process.env.DOTNET_ROOT = home;
      }
    }
    results.push({ name: tool.name, ok, need: tool.need || tool.name });
  }
  const missing = results.filter(r => !r.ok).map(r => r.name);
  toolsCache = { ok: missing.length === 0, results, missing, hint: missing.length ? distroInstallHint(missing) : null };
  return toolsCache;
}

// ---- Steam Deck: the launcher's own build environment ----

function checkBuildroot() {
  let ok = false;
  try { ok = fs.readFileSync(buildrootMarker(), 'utf8').trim() === buildrootVersion(); } catch { /* not set up */ }
  return {
    ok, missing: ok ? [] : ['buildroot'], hint: null, managed: true,
    results: [{ name: 'buildroot', ok, need: 'Build tools (they come with this launcher)' }],
    managedText: 'The build tools come inside this launcher. Setting them up unpacks them into the launcher\'s ' +
      'folder (about 2 GB, a few minutes); nothing on the Steam Deck itself changes.',
    installLabel: 'Set up build tools'
  };
}

async function installBuildroot() {
  const dir = buildrootDir();
  const part = dir + '.part';
  await fsp.rm(part, { recursive: true, force: true });
  await fsp.mkdir(part, { recursive: true });
  setTask({ label: 'Setting up the build tools', detail: 'Unpacking (a few minutes)', percent: null });
  await spawnLogged('tar', ['-xJf', BUILDROOT_ARCHIVE, '-C', part, '--no-same-owner',
    '--exclude=./dev/*', '--exclude=dev/*'], {}, () => {});
  // The host's resolv.conf (DNS) is bound over this file in the build, which needs a plain file here, not the
  // container's symlink or nothing.
  const resolv = path.join(part, 'etc', 'resolv.conf');
  await fsp.rm(resolv, { force: true });
  await fsp.writeFile(resolv, '');
  await fsp.writeFile(path.join(part, '.re-punched-buildroot'), buildrootVersion() + '\n');
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(part, dir);
  return checkTools(true);
}

// ---- Windows: the launcher's own tools ----

async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function checkWindowsTools() {
  const t = winTools();
  let dotnetOk = false;
  if (fs.existsSync(t.dotnet)) {
    const r = await run(t.dotnet, ['--list-sdks'], { timeout: 20000, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
    dotnetOk = r.ok && /^8\./m.test(r.stdout);
  }
  const results = [
    { name: 'git', ok: fs.existsSync(t.git), need: 'Git' },
    { name: 'dotnet', ok: dotnetOk, need: '.NET 8 SDK' }
  ];
  const missing = results.filter(r => !r.ok).map(r => r.name);
  const managedText = 'The first build downloads Git, .NET 8 and the compiler into this folder. Nothing is installed into Windows.';
  return { ok: missing.length === 0, results, missing, hint: null, managed: true, managedText };
}

// ---- The Visual C++ runtime, app-local ----
// The game's graphics DLLs (webgpu_dawn.dll, dxcompiler.dll) need Microsoft's Visual C++ runtime. The launcher ships
// those DLLs (resources\vcruntime, from Microsoft's redistributable: packaging\fetch_vcruntime.js) instead of
// installing anything. Before each game starts: if Windows' own copy is missing or older than ours, ours goes beside
// the game (Windows loads DLLs from the game's folder first); if Windows' is as new or newer, ours is taken away from
// the game's folder so Windows' is used. Ours always stays in the launcher, so uninstalling Windows' copy later is fine.
const VC_RUNTIME_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_atomic_wait.dll'];
function bundledVcRuntime() {
  const dirs = [path.join(process.resourcesPath || '', 'vcruntime'), path.join(__dirname, '..', 'vcruntime')];
  return dirs.find(dir => VC_RUNTIME_DLLS.every(d => fs.existsSync(path.join(dir, d)))) || null;
}
// A Windows DLL's file version (VS_FIXEDFILEINFO), as a number that sorts correctly; 0 when it can't be read.
function dllVersion(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return 0; }
  const at = buf.indexOf(Buffer.from([0xBD, 0x04, 0xEF, 0xFE]));
  if (at < 0 || at + 16 > buf.length) return 0;
  const ms = buf.readUInt32LE(at + 8), ls = buf.readUInt32LE(at + 12);
  return ((ms >>> 16) * 2 ** 48) + ((ms & 0xFFFF) * 2 ** 32) + ((ls >>> 16) * 2 ** 16) + (ls & 0xFFFF);
}
const versionText = v => [Math.floor(v / 2 ** 48), Math.floor(v / 2 ** 32) % 65536, Math.floor(v / 2 ** 16) % 65536, v % 65536].join('.');
function prepareVcRuntime(portDir) {
  if (!IS_WIN) return;
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const system = Math.min(...VC_RUNTIME_DLLS.map(d => dllVersion(path.join(sys32, d))));
  const bundled = bundledVcRuntime();
  const ours = bundled ? Math.min(...VC_RUNTIME_DLLS.map(d => dllVersion(path.join(bundled, d)))) : 0;
  if (bundled && ours > system) {
    for (const d of VC_RUNTIME_DLLS) {
      const target = path.join(portDir, d);
      if (dllVersion(target) !== dllVersion(path.join(bundled, d))) fs.copyFileSync(path.join(bundled, d), target);
    }
    log(`Visual C++ runtime: using the launcher's ${versionText(ours)}${system ? ` (Windows has ${versionText(system)})` : " (Windows doesn't have it)"}.`);
  } else if (system) {
    for (const d of VC_RUNTIME_DLLS) fs.rmSync(path.join(portDir, d), { force: true });
    log(`Visual C++ runtime: using Windows' ${versionText(system)}.`);
  } else {
    throw new Error("The game needs Microsoft's Visual C++ runtime, and this copy of the launcher is missing its own. Download the launcher again.");
  }
}

function percentOf(got, total) { return total ? Math.round((got / total) * 100) : null; }
const mb = n => `${Math.round(n / 1048576)} MB`;
async function unzip(archive, dest) {
  // tar.exe (bsdtar) ships with Windows 10 and later and reads zip files.
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(dest, { recursive: true });
  const r = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', dest], { timeout: 15 * 60000 });
  if (!r.ok) throw new Error(`Couldn't unpack ${path.basename(archive)}: ${r.stderr.trim() || r.error?.message}`);
}
async function fetchJson(url) {
  const file = path.join(RUN_TEMP, `download-${Date.now()}.json`);
  try { await download(url, file); return JSON.parse(await fsp.readFile(file, 'utf8')); } finally { await fsp.rm(file, { force: true }); }
}

async function installWindowsTools() {
  const p = paths();
  const t = winTools();
  const status = await checkWindowsTools();
  await fsp.mkdir(p.tools, { recursive: true });
  if (!status.results.find(r => r.name === 'git').ok) {
    const zip = path.join(p.tools, `MinGit-${MINGIT.version}.zip`);
    await download(MINGIT.url, zip, (got, total) => setTask({ label: 'Downloading Git', detail: mb(got), percent: percentOf(got, total) }));
    if (await hashFile(zip, 'sha256') !== MINGIT.sha256) { await fsp.rm(zip, { force: true }); throw new Error('The Git download failed its checksum.'); }
    setTask({ label: 'Unpacking Git', detail: '', percent: null });
    await unzip(zip, path.join(p.tools, 'git'));
    await fsp.rm(zip, { force: true });
  }
  if (!status.results.find(r => r.name === 'dotnet').ok) {
    setTask({ label: 'Finding the .NET 8 SDK', detail: '', percent: null });
    const releases = await fetchJson(DOTNET_RELEASES);
    const file = (releases.releases || []).flatMap(r => (r.sdk && r.sdk.files) || [])
      .find(f => f.rid === 'win-x64' && /\.zip$/.test(f.name || f.url || ''));
    if (!file || !/^https:\/\//.test(file.url) || !file.hash) throw new Error("Couldn't find the .NET 8 SDK download.");
    const zip = path.join(p.tools, 'dotnet-sdk.zip');
    await download(file.url, zip, (got, total) => setTask({ label: 'Downloading .NET 8', detail: mb(got), percent: percentOf(got, total) }));
    if (await hashFile(zip, 'sha512') !== String(file.hash).toLowerCase()) { await fsp.rm(zip, { force: true }); throw new Error('The .NET download failed its checksum.'); }
    setTask({ label: 'Unpacking .NET 8', detail: 'About a minute', percent: null });
    await unzip(zip, t.dotnetDir);
    await fsp.rm(zip, { force: true });
  }
  return checkTools(true);
}

async function nodtool() {
  const key = `${process.platform}-${process.arch}`;
  const entry = NODTOOL[key];
  if (!entry) throw new Error(`No disc tool for ${key} yet.`);
  const p = paths();
  const file = path.join(p.tools, `nodtool-${NODTOOL.version}${EXE}`);
  if (fs.existsSync(file) && await sha256(file) === entry.sha256) return file;
  await fsp.mkdir(p.tools, { recursive: true });
  setTask({ label: 'Getting the disc tool', detail: 'nodtool ' + NODTOOL.version, percent: null });
  const tmp = file + '.part';
  await download(`https://github.com/encounter/nod/releases/download/${NODTOOL.version}/${entry.asset}`, tmp);
  if (await sha256(tmp) !== entry.sha256) { await fsp.rm(tmp, { force: true }); throw new Error('The downloaded disc tool failed its checksum.'); }
  if (!IS_WIN) await fsp.chmod(tmp, 0o755);
  await fsp.rename(tmp, file);
  return file;
}

// ---------------------------------------------------------------------------------------------------------------
// Disc

async function describeDisc(file) {
  const tool = await nodtool();
  const r = await run(tool, ['--no-color', 'info', file], { timeout: 60000 });
  const out = r.stdout + r.stderr;
  const id = (/^Game ID: (\S+)/m.exec(out) || [])[1];
  const title = (/^Title: (.+)$/m.exec(out) || [])[1] || '';
  const rev = Number((/^Disc \d+, Revision (\d+)/m.exec(out) || [])[1] || 0);
  if (!id) return { ok: false, problem: "That file doesn't look like a Wii disc image." };
  if (id !== GAME_ID) return { ok: false, id, title, problem: `That's ${title || id} (${id}). The launcher needs Punch-Out!! for the USA (${GAME_ID}).` };
  return { ok: true, id, title, rev };
}

async function discExtracted() {
  const p = paths();
  if (config.discFolder) return config.discFolderOk === true && fs.existsSync(path.join(config.discFolder, 'sys', 'main.dol'));
  const marker = path.join(p.disc, '..', 'extracted.json');
  try {
    const info = JSON.parse(fs.readFileSync(marker, 'utf8'));
    return info.mainDolMd5 === MAIN_DOL_MD5 && fs.existsSync(path.join(p.disc, 'sys', 'main.dol'));
  } catch { return false; }
}

async function extractDisc() {
  const p = paths();
  if (!config.disc) throw new Error('Choose your Punch-Out!! disc first.');
  const info = await describeDisc(config.disc);
  if (!info.ok) throw new Error(info.problem);
  const tool = await nodtool();
  await fsp.rm(p.disc, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(p.disc), { recursive: true });
  setTask({ label: 'Extracting your disc', detail: 'This takes a minute or two', percent: null });
  await spawnLogged(tool, ['--no-color', 'extract', config.disc, p.disc], {}, line => {
    const m = /(\d+(?:\.\d+)?)%/.exec(line);
    if (m) setTask({ label: 'Extracting your disc', detail: line.trim().slice(0, 80), percent: Number(m[1]) });
  });
  const dol = path.join(p.disc, 'sys', 'main.dol');
  if (!fs.existsSync(dol)) throw new Error('The disc extracted, but its game code (sys/main.dol) is missing.');
  const sum = await md5(dol);
  if (sum !== MAIN_DOL_MD5) throw new Error(`This Punch-Out!! disc is a revision the port doesn't support yet (main.dol ${sum}).`);
  await fsp.writeFile(path.join(p.disc, '..', 'extracted.json'), JSON.stringify({ from: config.disc, mainDolMd5: sum, at: new Date().toISOString() }, null, 2));
}

// ---------------------------------------------------------------------------------------------------------------
// Doc Louis's Punch-Out!!: the player's own WAD, unpacked by the launcher (src/wad.js) with the Wii common key they
// supply. The key is used for that one unpack and never saved; later builds use the unpacked title.

const DOC_TITLE_ID = DOC_TITLE.join('').toLowerCase();

function docReady() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(gamePaths('doclouis').data, '..', 'collected.json'), 'utf8'));
    return info.dolSha256 === DOC_DOL_SHA256 && fs.existsSync(path.join(gamePaths('doclouis').data, '00000001.app'));
  } catch { return false; }
}

// Unpacks the chosen WAD into doclouis/title as title.tmd, title.tik and <content id>.app (what the game's ES reads),
// each checked against its TMD hash, and the game code against the supported release's.
async function unpackDocWad(key) {
  try {
    const wadFile = config.docWad;
    if (!wadFile || !fs.existsSync(wadFile)) throw new Error("Choose your Doc Louis's Punch-Out!! WAD first.");
    setTask({ label: "Unpacking Doc Louis's Punch-Out!!", detail: path.basename(wadFile), percent: 0 });
    const out = gamePaths('doclouis').data;
    let dolSha256 = '';
    await wad.unpackWad(wadFile, key, out, {
      titleId: DOC_TITLE_ID,
      wrongTitleMessage: "That WAD isn't Doc Louis's Punch-Out!! (USA).",
      check: (name, data) => {
        if (name !== '00000001.app') return;
        dolSha256 = crypto.createHash('sha256').update(data).digest('hex');
        if (dolSha256 !== DOC_DOL_SHA256) throw new Error("That's a version of Doc Louis's Punch-Out!! the port doesn't support yet (it needs the USA release, WPCE01).");
      },
      onProgress: (n, total) => setTask({ label: "Unpacking Doc Louis's Punch-Out!!", detail: `${n} of ${total}`, percent: Math.round(n / total * 100) })
    });
    await fsp.writeFile(path.join(out, '..', 'collected.json'), JSON.stringify({ from: wadFile, dolSha256, at: new Date().toISOString() }, null, 2));
    log("Doc Louis's Punch-Out!! unpacked from your WAD.");
  } finally {
    if (Buffer.isBuffer(key)) key.fill(0);
  }
}

// Doc Louis's own Config.toml: where its title is. Everything shared it reads from Punch-Out!!'s (see above).
function ensureDocConfig() {
  const file = gamePaths('doclouis').config;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  text = toml.set(text, 'paths', 'title_content', gamePaths('doclouis').data);
  text = toml.set(text, 'paths', 'shared_config', path.relative(path.dirname(file), paths().gameConfig).split(path.sep).join('/'));
  fs.writeFileSync(file, text);
}

// ---------------------------------------------------------------------------------------------------------------
// Building and playing

function spawnLogged(cmd, args, opts, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    let tail = '';
    const handle = chunk => {
      tail += chunk.toString();
      const lines = tail.split(/\r?\n|\r/);
      tail = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        log(line);
        if (onLine) onLine(line);
      }
    };
    proc.stdout.on('data', handle);
    proc.stderr.on('data', handle);
    proc.on('error', err => { child = null; reject(err); });
    proc.on('close', (code, signal) => {
      child = null;
      if (tail.trim()) log(tail);
      if (code === 0) resolve();
      else reject(new Error(signal ? `stopped (${signal})` : `exited with code ${code}`));
    });
  });
}

// Stops the build or game. On Windows, killing PowerShell would leave CMake, Ninja and clang running, so the whole
// process tree goes.
function stopChild() {
  if (!child) return;
  if (IS_WIN && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  else child.kill('SIGINT');
}

function buildInfoFile(game = currentGame()) { return path.join(gamePaths(game).port, 'launcher-build.json'); }
async function portSourceHash() {
  const src = portSource();
  return src ? (await sha256(path.join(src, 'punchout_region.patch'))).slice(0, 16) : null;
}
// The game's executable: its current name, or the name a build from before a rename has (until it is rebuilt).
function gameBinary(game = currentGame()) {
  const port = gamePaths(game).port;
  const current = path.join(port, GAMES[game].binary + EXE);
  if (fs.existsSync(current)) return current;
  const legacy = (GAMES[game].legacyBinaries || []).map(name => path.join(port, name + EXE)).find(file => fs.existsSync(file));
  return legacy || current;
}
async function buildState(game = currentGame()) {
  const binary = gameBinary(game);
  let info = null;
  try { info = JSON.parse(fs.readFileSync(buildInfoFile(game), 'utf8')); } catch { /* not built */ }
  const built = fs.existsSync(binary) && info != null;
  const current = await portSourceHash();
  // A build under an earlier executable name always counts as outdated: the next build gives it the current name.
  const renamed = path.basename(binary) !== GAMES[game].binary + EXE;
  return { built, binary, info, outdated: built && ((current && info.patch !== current) || renamed) };
}

// Build tools write caches and settings to the user's profile (NuGet's packages and its NuGet.Config in AppData,
// .NET's first-run files, CMake's and clang's temp files). For the build they get a home inside the data folder, so
// nothing lands outside the program's folder.
function buildEnvironment() {
  const home = path.join(dataRoot(), 'build-home');
  const env = {
    TEMP: path.join(RUN_TEMP, 'build'), TMP: path.join(RUN_TEMP, 'build'), TMPDIR: path.join(RUN_TEMP, 'build'),
    DOTNET_CLI_HOME: home, NUGET_PACKAGES: path.join(home, 'nuget', 'packages'),
    NUGET_HTTP_CACHE_PATH: path.join(home, 'nuget', 'http-cache'), NUGET_PLUGINS_CACHE_PATH: path.join(home, 'nuget', 'plugins-cache'),
    PO_NUGET_CONFIG: path.join(home, 'nuget', 'NuGet.Config'),
    DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
    MSBUILDDISABLENODEREUSE: '1', DOTNET_CLI_DO_NOT_USE_MSBUILD_SERVER: '1', UseSharedCompilation: 'false',
    CMAKE_EXPORT_NO_PACKAGE_REGISTRY: 'ON',
    // Drives that keep no file owners (exFAT, many external disks) make git refuse its own folders as "dubious ownership".
    // Every git the build starts is told these folders are fine, for this run only (nothing written to a git config).
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*'
  };
  if (IS_WIN) {
    Object.assign(env, { USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local') });
  } else {
    Object.assign(env, { XDG_CACHE_HOME: path.join(home, '.cache'), XDG_CONFIG_HOME: path.join(home, '.config') });
  }
  for (const dir of [env.TEMP, path.join(home, 'nuget'), env.APPDATA, env.LOCALAPPDATA]) if (dir) fs.mkdirSync(dir, { recursive: true });
  // Only nuget.org, and NuGet reads this file instead of making one in AppData.
  if (!fs.existsSync(env.PO_NUGET_CONFIG)) {
    fs.writeFileSync(env.PO_NUGET_CONFIG, '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <clear />\n    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />\n  </packageSources>\n</configuration>\n');
  }
  return env;
}

async function build() {
  const game = currentGame();
  const p = gamePaths(game);
  const src = portSource();
  if (!src) throw new Error("The port's files weren't found. Choose them in Settings > Advanced.");
  let tools = await checkTools(true);
  // Tools the launcher brings itself (Windows' downloads, the Steam Deck launcher's build environment) are set up
  // here when missing or out of date: once a game is built the setup step is hidden (Play works without tools), so an
  // update's rebuild would otherwise just stop. (A new Steam Deck launcher brings a new build environment.)
  if (!tools.ok && tools.managed) {
    log(`Build tools need setting up (${tools.missing.join(', ')}); doing that first.`);
    tools = IS_WIN ? await installWindowsTools() : await installBuildroot();
  }
  if (!tools.ok) throw new Error(`Missing build tools: ${tools.missing.join(', ')}.`);
  checkPlainDataRoot();
  if (game === 'punchout' && !await discExtracted()) await extractDisc();
  if (game === 'doclouis' && !docReady()) throw new Error("Unpack your Doc Louis's Punch-Out!! WAD first (step 2).");
  await fsp.mkdir(p.logs, { recursive: true });
  const steps = { total: 7, at: 0 };
  const label = `Building ${GAMES[game].name}`;
  setTask({ label, detail: 'Starting', percent: 0 });
  // The other game's WiiCompiled clone, if there is one, is copied instead of downloading it again.
  const other = gamePaths(game === 'punchout' ? 'doclouis' : 'punchout');
  const seed = path.join(other.work, 'wiicompiled');
  const env = { ...process.env, ...buildEnvironment(), PO_GAME: game, PO_SRC: src, PO_WORK: p.work, PO_DATA: p.data, PO_PORT: p.port, PO_LOGS: p.logs,
    NINJA_STATUS: '[%f/%t] ', ...(fs.existsSync(path.join(seed, '.git')) ? { PO_SEED: seed } : {}) };
  let cmd = 'bash', args = [buildScript()], buildLog = null;
  if (STEAM_DECK) {
    env.PO_BUILDROOT = buildrootDir();
    args = [path.join(path.dirname(buildScript()), 'build_port_steamdeck.sh'), buildScript()];
  }
  if (IS_WIN) {
    // build_port.sh writes its own build.log; on Windows the launcher keeps it.
    const t = winTools();
    // One compiler / CMake / Ninja download for both games (Punch-Out!!'s work folder, where it always was).
    Object.assign(env, { PO_GIT: t.git, PO_DOTNET: t.dotnet, PO_TOOLCHAIN: path.join(paths().work, 'toolchain') });
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', buildScript()];
    buildLog = fs.createWriteStream(path.join(p.logs, 'build.log'));
  }
  try {
  await spawnLogged(cmd, args, { env, windowsHide: true }, line => {
    if (buildLog) buildLog.write(line + '\n');
    const step = /^@@STEP (\d+)\/(\d+) (.*)$/.exec(line);
    if (step) {
      steps.at = Number(step[1]); steps.total = Number(step[2]);
      setTask({ label, detail: step[3], percent: Math.round(((steps.at - 1) / steps.total) * 100) });
      return;
    }
    const ninja = /^\[(\d+)\/(\d+)\]/.exec(line);
    if (ninja && steps.at > 0) {
      const frac = Number(ninja[1]) / Math.max(1, Number(ninja[2]));
      setTask({ label, detail: `Compiling ${ninja[1]} of ${ninja[2]}`, percent: Math.round(((steps.at - 1 + frac) / steps.total) * 100) });
    }
  });
  } finally {
    if (buildLog) buildLog.end();
  }
  await fsp.writeFile(buildInfoFile(game), JSON.stringify({ patch: await portSourceHash(), at: new Date().toISOString(), source: src }, null, 2));
}

// Linux desktops (GNOME on Wayland in particular) take a window's taskbar icon and name from the desktop entry whose
// name matches the window's app ID. The game's is "punch-drunk", so this hidden entry (NoDisplay: not in the app
// menu) gives its window the icon and "Punch-Drunk". Rewritten on each launch so it follows the install folder.
function writeGameDesktopEntry(binary) {
  if (process.platform !== 'linux') return;
  try {
    const dir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');
    const icon = path.join(path.dirname(binary), 'assets', 'punchout', 'icon.png');
    const quote = s => '"' + s.replace(/(["`$\\])/g, '\\$1') + '"';
    const text = ['[Desktop Entry]', 'Type=Application', 'Name=Punch-Drunk', 'Comment=Punch-Out!! (Wii) on PC',
      `Exec=${quote(binary)}`, `Path=${path.dirname(binary)}`, `Icon=${fs.existsSync(icon) ? icon : 'applications-games'}`,
      'StartupWMClass=punch-drunk', 'Categories=Game;', 'NoDisplay=true', ''].join('\n');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'punch-drunk.desktop'), text);
    for (const old of ['pow-recompiled.desktop', 're-punched.desktop', 'fist-in.desktop', 'punchout-pc.desktop']) fs.rmSync(path.join(dir, old), { force: true }); // earlier names
  } catch (err) {
    log(`Couldn't write the game's desktop entry: ${err.message}`);
  }
}

async function play() {
  const game = currentGame();
  const state = await buildState(game);
  if (!state.built) throw new Error('Build the port first.');
  const p = gamePaths(game);
  ensureGameConfig(); // Punch-Out!!'s: also where Doc Louis's reads the shared settings
  if (game === 'doclouis') ensureDocConfig();
  else writeGameDesktopEntry(state.binary);
  prepareVcRuntime(p.port);
  gameRunning = true;
  send('state-changed');
  const logFile = path.join(p.logs, 'game.log');
  await fsp.mkdir(p.logs, { recursive: true });
  const out = fs.createWriteStream(logFile);
  setTask({ label: `Playing ${GAMES[game].name}`, detail: 'Close the game to come back here', percent: null });
  const watcher = setInterval(() => send('state-changed'), 2000); // the Archipelago checkmark follows the game
  try {
    await spawnLogged(state.binary, [], { cwd: p.port, windowsHide: false }, line => out.write(line + '\n'));
  } finally {
    clearInterval(watcher);
    out.end();
    gameRunning = false;
    send('state-changed');
  }
}

// The values WiiCompiled accepts (IsSupportedResolutionMultiplier / IsSupportedDisplayMode).
const GRAPHICS_RESOLUTIONS = [0, 1, 1.5, 2, 3, 4, 6, 8];
const GRAPHICS_DISPLAY_MODES = ['windowed', 'borderless', 'exclusive'];

// Punch-Out!! controls: [punchout_controls] in Config.toml, the same keys and defaults as the game
// (runtime punchout_controls.cpp). Per control: key, key2 (SDL key names or "Mouse Left"...), pad, pad2 (SDL gamepad
// names: "a" is the bottom face button, "dpup", "lefttrigger"...). "" = unbound.
const CONTROL_DEFAULTS = {
  up: ['W', 'Up', 'dpup', ''], down: ['S', 'Down', 'dpdown', ''], left: ['A', 'Left', 'dpleft', ''],
  right: ['D', 'Right', 'dpright', ''], one: ['J', '', 'a', ''], two: ['K', '', 'b', ''], a: ['L', 'Space', 'y', ''],
  b: ['', '', 'x', ''], plus: ['Return', '', 'start', ''], minus: ['Backspace', '', 'back', ''],
  page_left: ['Q', '', 'leftshoulder', ''], page_right: ['E', '', 'rightshoulder', '']
};
const CONTROL_SLOTS = ['key', 'key2', 'pad', 'pad2'];

// The game reads its settings and disc location from port/UserData/Config.toml.
function ensureGameConfig() {
  const p = paths();
  fs.mkdirSync(path.dirname(p.gameConfig), { recursive: true });
  let text = '';
  try { text = fs.readFileSync(p.gameConfig, 'utf8'); } catch { /* new */ }
  text = toml.set(text, 'paths', 'dvd_root', p.disc);
  // The frame-rate counter is off unless the player turns it on (the game itself defaults to on).
  if (toml.get(text, 'video', 'show_fps') === undefined) text = toml.set(text, 'video', 'show_fps', false);
  // Keep the picture's shape on wide windows (black bars) rather than stretching it. Only when never chosen.
  if (toml.get(text, 'video', 'force_aspect') === undefined) text = toml.set(text, 'video', 'force_aspect', true);
  fs.writeFileSync(p.gameConfig, text);
}

function readGameSettings() {
  let text = '';
  try { text = fs.readFileSync(paths().gameConfig, 'utf8'); } catch { /* none yet */ }
  const get = (section, key, fallback) => {
    const v = toml.get(text, section, key);
    return v === undefined ? fallback : v;
  };
  return {
    difficulty: get('punchout', 'difficulty', 'normal'),
    buttonStyle: get('punchout', 'button_style', 'auto'),
    player1Controller: String(get('controller', 'player1', 'auto')),
    skipStrapScreen: get('punchout', 'skip_strap_screen', true),
    controls: {
      lockMouse: get('punchout_controls', 'lock_mouse', false) === true,
      bindings: Object.fromEntries(Object.entries(CONTROL_DEFAULTS).map(([control, defaults]) =>
        [control, CONTROL_SLOTS.map((slot, i) => String(get('punchout_controls', `${control}_${slot}`, defaults[i])))]))
    },
    // Same keys and defaults as WiiCompiled's F10 Graphics menu (runtime_config.h).
    graphics: {
      widescreen: get('video', 'widescreen', true) !== false,
      forceAspect: get('video', 'force_aspect', true) === true, // true until chosen (ensureGameConfig writes it at Play)
      nativeEffects: get('video', 'native_effect_copies', false) === true,
      showFps: get('video', 'show_fps', false) === true,
      smoothEdges: Number(get('video', 'msaa', 1)) === 4, // anti-aliasing: msaa 4 = on, 1 = off
      textureMods: get('video', 'texture_replacements', false) === true, // experimental
      textureNames: get('video', 'texture_dumps', false) === true, // experimental
      resolution: GRAPHICS_RESOLUTIONS.includes(Number(get('video', 'resolution_multiplier', 1))) ? Number(get('video', 'resolution_multiplier', 1)) : 1,
      displayMode: GRAPHICS_DISPLAY_MODES.includes(get('video', 'display_mode', 'windowed')) ? get('video', 'display_mode', 'windowed') : 'windowed'
    },
    archipelago: {
      enabled: get('archipelago', 'enabled', false),
      server: get('archipelago', 'server', 'archipelago.gg:38281'),
      slot: get('archipelago', 'slot', ''),
      password: get('archipelago', 'password', ''),
      patchFile: get('archipelago', 'patch_file', ''),
      showLog: get('archipelago', 'show_log', true),
      connected: get('archipelago', 'connected', false)
    }
  };
}

function writeGameSettings(s) {
  ensureGameConfig();
  const file = paths().gameConfig;
  let text = fs.readFileSync(file, 'utf8');
  if (s.difficulty) text = toml.set(text, 'punchout', 'difficulty', s.difficulty);
  if (s.buttonStyle) text = toml.set(text, 'punchout', 'button_style', s.buttonStyle);
  if (typeof s.player1Controller === 'string' && s.player1Controller.length > 0 && s.player1Controller.length <= 64) {
    text = toml.set(text, 'controller', 'player1', s.player1Controller);
  }
  if (typeof s.skipStrapScreen === 'boolean') text = toml.set(text, 'punchout', 'skip_strap_screen', s.skipStrapScreen);
  const c = s.controls;
  if (c) {
    if (typeof c.lockMouse === 'boolean') text = toml.set(text, 'punchout_controls', 'lock_mouse', c.lockMouse);
    if (c.reset) {
      for (const [control, defaults] of Object.entries(CONTROL_DEFAULTS)) {
        CONTROL_SLOTS.forEach((slot, i) => { text = toml.set(text, 'punchout_controls', `${control}_${slot}`, defaults[i]); });
      }
    }
    const b = c.binding;
    if (b && Object.hasOwn(CONTROL_DEFAULTS, b.control) && Number.isInteger(b.slot) && b.slot >= 0 && b.slot < 4 &&
        typeof b.value === 'string' && b.value.length <= 32) {
      text = toml.set(text, 'punchout_controls', `${b.control}_${CONTROL_SLOTS[b.slot]}`, b.value);
    }
  }
  const g = s.graphics;
  if (g) {
    if (typeof g.widescreen === 'boolean') text = toml.set(text, 'video', 'widescreen', g.widescreen);
    if (typeof g.forceAspect === 'boolean') text = toml.set(text, 'video', 'force_aspect', g.forceAspect);
    if (typeof g.nativeEffects === 'boolean') text = toml.set(text, 'video', 'native_effect_copies', g.nativeEffects);
    if (typeof g.showFps === 'boolean') text = toml.set(text, 'video', 'show_fps', g.showFps);
    if (typeof g.smoothEdges === 'boolean') text = toml.set(text, 'video', 'msaa', g.smoothEdges ? 4 : 1);
    if (typeof g.textureMods === 'boolean') text = toml.set(text, 'video', 'texture_replacements', g.textureMods);
    if (typeof g.textureNames === 'boolean') text = toml.set(text, 'video', 'texture_dumps', g.textureNames);
    if (GRAPHICS_RESOLUTIONS.includes(g.resolution)) text = toml.set(text, 'video', 'resolution_multiplier', g.resolution);
    if (GRAPHICS_DISPLAY_MODES.includes(g.displayMode)) text = toml.set(text, 'video', 'display_mode', g.displayMode);
  }
  const ap = s.archipelago;
  if (ap) {
    for (const [key, value] of [['enabled', ap.enabled], ['server', ap.server], ['slot', ap.slot], ['password', ap.password],
      ['patch_file', ap.patchFile], ['show_log', ap.showLog]]) {
      if (value !== undefined) text = toml.set(text, 'archipelago', key, value);
    }
    // Turning Archipelago off clears the checkmark until the game logs in again.
    if (ap.enabled === false) text = toml.set(text, 'archipelago', 'connected', false);
  }
  fs.writeFileSync(file, text);
}

// ---------------------------------------------------------------------------------------------------------------
// State for the renderer

// Both games, for the home screen's cards: built (playable), outdated (an update to the port is ready) and
// haveCopy (the disc is chosen, or the WAD unpacked: it can be built).
async function gamesState() {
  const out = {};
  for (const [id, g] of Object.entries(GAMES)) {
    const b = await buildState(id);
    const haveCopy = id === 'punchout' ? Boolean(config.disc || await discExtracted()) : docReady();
    out[id] = { name: g.name, built: b.built, outdated: Boolean(b.outdated), haveCopy };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pictures for the home screen (made from the player's own copies, see art.js), in <data>/art

const artDir = () => path.join(dataRoot(), 'art');
const artTried = new Set();

// Makes whatever pictures are missing and their sources exist, once per change in what exists, without holding up the window.
function maybeMakeArt() {
  const sources = { filesDir: path.join(paths().disc, 'files'), docBanner: path.join(gamePaths('doclouis').data, '00000000.app'), outDir: artDir() };
  const missing = Object.values(art.NAMES).filter(name => !fs.existsSync(path.join(sources.outDir, name)));
  if (missing.length === 0) return;
  const key = [sources.filesDir, fs.existsSync(sources.filesDir), sources.docBanner, fs.existsSync(sources.docBanner), ...missing].join('|');
  if (artTried.has(key)) return;
  artTried.add(key);
  setImmediate(() => {
    try {
      const result = art.buildArt(sources);
      for (const problem of result.problems) log(`[art] ${problem}`);
      if (result.made.length > 0) send('state-changed');
    } catch (err) {
      log(`[art] ${err.message}`);
    }
  });
}

// The pictures that exist, as addresses the window can load. medal.png is optional and only ever the player's own.
function artState() {
  const out = {};
  const files = { punchoutLogo: art.NAMES.punchoutLogo, punchoutBg: art.NAMES.punchoutBg,
    doclouisLogo: art.NAMES.doclouisLogo, doclouisBg: art.NAMES.doclouisBg, medal: 'medal.png' };
  for (const [key, name] of Object.entries(files)) {
    const file = path.join(artDir(), name);
    try { out[key] = `${pathToFileURL(file).href}?${Math.round(fs.statSync(file).mtimeMs)}`; } catch { /* not made yet */ }
  }
  return out;
}

async function state() {
  maybeMakeArt();
  const game = currentGame();
  const tools = await checkTools();
  const extracted = game === 'punchout' ? await discExtracted() : docReady();
  const b = await buildState(game);
  // Doc Louis's: the WAD has to be unpacked (that needs the key) before step 2 counts as done.
  const haveCopy = game === 'punchout' ? Boolean(config.disc || extracted) : extracted;
  // Once the game is built it can be played without the build tools (they may live in a container, or be gone).
  const step = b.built ? 0 : !tools.ok ? 1 : !haveCopy ? 2 : 3;
  return {
    game, games: await gamesState(),
    step, tools, extracted,
    disc: config.disc || config.discFolder || null,
    docWad: config.docWad || null,
    build: { built: b.built, outdated: Boolean(b.outdated), at: b.info?.at || null },
    portSource: portSource(),
    dataRoot: dataRoot(),
    steamDeck: STEAM_DECK,
    running: gameRunning, busy: Boolean(child) && !gameRunning,
    art: artState(),
    task, settings: readGameSettings(), version: app.getVersion(),
    logs: logLines.slice(-400)
  };
}

function exclusive(fn) {
  return async (...args) => {
    if (child) throw new Error('Something is already running.');
    try { return await fn(...args); } finally { setTask(null); send('state-changed'); }
  };
}

function registerHandlers() {
  ipcMain.handle('state', () => state());
  ipcMain.handle('check-tools', async () => { await checkTools(true); return state(); });
  ipcMain.handle('install-tools', exclusive(async () => {
    if (IS_WIN) await installWindowsTools();
    else if (STEAM_DECK) await installBuildroot();
  }));
  ipcMain.handle('choose-disc', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose your Punch-Out!! disc', properties: ['openFile'],
      filters: [{ name: 'Wii disc images', extensions: ['iso', 'wbfs', 'rvz', 'ciso', 'gcz', 'wia', 'nfs'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    setTask({ label: 'Checking your disc', detail: path.basename(r.filePaths[0]), percent: null });
    try {
      const info = await describeDisc(r.filePaths[0]);
      if (info.ok) { config.disc = r.filePaths[0]; delete config.discFolder; delete config.discFolderOk; saveConfig(); }
      return info;
    } finally { setTask(null); send('state-changed'); }
  });
  // An already extracted disc (a folder with sys/main.dol and files/), e.g. from Dolphin: used where it is.
  ipcMain.handle('choose-disc-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose your extracted Punch-Out!! disc', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    let dir = r.filePaths[0];
    if (!fs.existsSync(path.join(dir, 'sys', 'main.dol')) && fs.existsSync(path.join(dir, 'DATA', 'sys', 'main.dol'))) dir = path.join(dir, 'DATA');
    const dol = path.join(dir, 'sys', 'main.dol');
    if (!fs.existsSync(dol)) return { ok: false, problem: "That folder isn't an extracted disc (no sys/main.dol in it)." };
    const sum = await md5(dol);
    if (sum !== MAIN_DOL_MD5) return { ok: false, problem: "That's not the supported Punch-Out!! (USA) game code." };
    config.discFolder = dir;
    config.discFolderOk = true;
    delete config.disc;
    saveConfig();
    send('state-changed');
    return { ok: true };
  });
  ipcMain.handle('choose-folder', async (_e, which) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    if (which === 'dataRoot') config.dataRoot = storePath(r.filePaths[0]);
    if (which === 'portSource') config.portSource = storePath(r.filePaths[0]);
    saveConfig();
    send('state-changed');
    return r.filePaths[0];
  });
  ipcMain.handle('choose-patch-file', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Archipelago patch', extensions: ['appunchout'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('select-game', (_e, game) => {
    if (!Object.hasOwn(GAMES, game) || child) return state();
    config.game = game;
    saveConfig();
    return state();
  });
  // Doc Louis's: the player's WAD (checked to be the right game; no key needed for that).
  ipcMain.handle('choose-doc-wad', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Choose your Doc Louis's Punch-Out!! WAD", properties: ['openFile'],
      filters: [{ name: 'WiiWare WAD', extensions: ['wad'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      if (wad.describeWad(r.filePaths[0]).titleId !== DOC_TITLE_ID) return { ok: false, problem: "That WAD isn't Doc Louis's Punch-Out!! (USA)." };
    } catch (err) { return { ok: false, problem: err.message }; }
    config.docWad = r.filePaths[0];
    saveConfig();
    send('state-changed');
    return { ok: true };
  });
  // The Wii common key, to unpack it: the keys.bin from the player's BootMii backup (read here, so the key never
  // reaches the window), or pasted. Either way it's used once and wiped; nothing about it is saved or logged.
  const unpackWith = async getKey => {
    if (child) return { ok: false, problem: 'Something is already running.' };
    let key = null;
    try {
      key = await getKey();
      if (!key) return { ok: false, canceled: true };
      await unpackDocWad(key);
      return { ok: true };
    } catch (err) {
      return { ok: false, problem: err.message };
    } finally {
      if (key) key.fill(0);
      setTask(null);
      send('state-changed');
    }
  };
  ipcMain.handle('unpack-doc-keyfile', () => unpackWith(async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose keys.bin from your BootMii backup', properties: ['openFile'],
      filters: [{ name: 'Key file', extensions: ['bin', 'txt'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = await fsp.readFile(r.filePaths[0]);
    try { return wad.parseKey(file); } finally { file.fill(0); }
  }));
  ipcMain.handle('unpack-doc-key', (_e, text) => unpackWith(async () => wad.parseKey(String(text || ''))));
  ipcMain.handle('build', exclusive(build));
  ipcMain.handle('play', exclusive(play));
  ipcMain.handle('stop', () => stopChild());
  ipcMain.handle('save-settings', (_e, s) => { writeGameSettings(s); return readGameSettings(); });
  ipcMain.handle('open-folder', (_e, which) => {
    const p = paths();
    const g = gamePaths();
    // The game looks for these two next to its Config.toml (see runtime_config.h), one set per game.
    const dir = {
      logs: g.logs, port: g.port, data: p.root,
      textures: path.join(g.port, 'UserData', 'texture_replacements'),
      texturenames: path.join(g.port, 'UserData', 'Cache', 'texture_dumps')
    }[which] || p.root;
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  ipcMain.handle('open-external', (_e, url) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle('copy-log', () => { clipboard.writeText(logLines.join('\n')); return true; });
  ipcMain.handle('copy-text', (_e, text) => { clipboard.writeText(String(text)); return true; });
  ipcMain.handle('window', (_e, action) => {
    if (!win) return null;
    if (action === 'minimize') win.minimize();
    if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
    if (action === 'close') win.close();
    return { fullScreen: win.isFullScreen() };
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080, height: 760, minWidth: 860, minHeight: 600, frame: false, backgroundColor: '#17161c',
    title: 'Punch-Drunk: Punch-Out (Wii) Recomp', show: false, icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Development: PUNCHOUT_SCREENSHOTS=<folder> saves a picture of every page, then quits.
  if (process.env.PUNCHOUT_SCREENSHOTS) {
    win.webContents.once('did-finish-load', async () => {
      const dir = process.env.PUNCHOUT_SCREENSHOTS;
      fs.mkdirSync(dir, { recursive: true });
      for (const pageName of ['home', 'controls', 'settings']) {
        await win.webContents.executeJavaScript(pageName === 'home' ? `document.getElementById('nav-back').click()` : `document.getElementById('nav-${pageName}').click()`);
        await new Promise(r => setTimeout(r, 1200));
        fs.writeFileSync(path.join(dir, `${pageName}.png`), (await win.webContents.capturePage()).toPNG());
      }
      app.quit();
    });
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// --selftest: checks this copy without opening a window (after every build, and for "is my install OK?"): its folder
// is writable, the port's files and build scripts are there, and the WAD unpacker works (on a made-up WAD and key).
// Writes selftest_result.txt beside the program; exit code 0 = OK.
async function selfTest() {
  const lines = [`Punch-Drunk ${app.getVersion()} ${app.isPackaged ? 'packaged' : 'development'}`];
  const check = async (name, fn) => {
    try { const note = await fn(); lines.push(`OK   ${name}${note ? ': ' + note : ''}`); }
    catch (err) { lines.push(`FAIL ${name}: ${err.message}`); }
  };
  await check('program folder is writable', () => {
    const probe = path.join(PORTABLE_ROOT, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
  });
  await check("the port's files", () => {
    const src = portSource();
    if (!src) throw new Error('punchout_region.patch not found');
    for (const game of Object.keys(GAMES)) if (!fs.existsSync(path.join(src, 'projects', game, 'MAP.txt'))) throw new Error(`projects/${game} missing`);
  });
  if (IS_WIN && app.isPackaged) {
    await check('Visual C++ runtime (bundled)', () => {
      const dir = bundledVcRuntime();
      if (!dir) throw new Error('resources\\vcruntime is missing or incomplete');
      return versionText(Math.min(...VC_RUNTIME_DLLS.map(d => dllVersion(path.join(dir, d)))));
    });
  }
  await check('build script', () => { if (!fs.existsSync(buildScript())) throw new Error(`${path.basename(buildScript())} missing`); });
  await check('WAD unpacker', async () => {
    const key = crypto.randomBytes(16);
    const contents = [{ id: 0, data: crypto.randomBytes(5000) }, { id: 1, data: crypto.randomBytes(40000) }];
    const dir = path.join(RUN_TEMP, 'selftest');
    fs.mkdirSync(dir, { recursive: true });
    const wadFile = path.join(dir, 'test.wad');
    fs.writeFileSync(wadFile, wad.buildTestWad(key, contents));
    try {
      await wad.unpackWad(wadFile, Buffer.from(key), path.join(dir, 'title'), { titleId: DOC_TITLE_ID });
      if (!fs.readFileSync(path.join(dir, 'title', '00000001.app')).equals(contents[1].data)) throw new Error('unpacked data differs');
      let refused = false;
      try { await wad.unpackWad(wadFile, crypto.randomBytes(16), path.join(dir, 'title2')); } catch (err) { refused = err.code === 'wrong-key'; }
      if (!refused) throw new Error('a wrong key was not refused');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  // Not a failure: the launcher works anywhere; only building needs a plain path (it says so when you build).
  try { checkPlainDataRoot(); lines.push(`OK   data folder path is plain: ${dataRoot()}`); }
  catch { lines.push(`WARN data folder path has characters the game build can't use (move the folder to build): ${dataRoot()}`); }
  const ok = !lines.some(l => l.startsWith('FAIL'));
  lines.push(ok ? 'SELFTEST OK' : 'SELFTEST FAILED');
  fs.writeFileSync(path.join(PORTABLE_ROOT, 'selftest_result.txt'), lines.join('\r\n') + '\r\n');
  return ok;
}

usePortableFolders();
// --build <punchout|doclouis>: builds that game without a window (the same steps as the Build button), printing the
// build's output; exit code 0 = built. For testing and for building from a script.
if (process.argv.includes('--build')) {
  const game = process.argv[process.argv.indexOf('--build') + 1];
  app.whenReady().then(async () => {
    sweepTemp();
    loadConfig();
    let code = 1;
    try {
      if (!Object.hasOwn(GAMES, game)) throw new Error('Usage: --build punchout|doclouis');
      config.game = game;
      await build();
      console.log(`BUILT ${GAMES[game].name}: ${gameBinary(game)}`);
      code = 0;
    } catch (err) {
      console.log(`BUILD FAILED: ${err.message}`);
    }
    removeRunTemp();
    app.exit(code);
  });
} else if (process.argv.includes('--unpack-doc')) {
  // --unpack-doc <wad> <keys.bin or key file>: what Choose WAD + Choose keys.bin do, without a window. The key is read
  // from the file, used once and wiped, as in the window.
  const i = process.argv.indexOf('--unpack-doc');
  const [wadFile, keyFile] = [process.argv[i + 1], process.argv[i + 2]];
  app.whenReady().then(async () => {
    sweepTemp();
    loadConfig();
    let code = 1;
    try {
      if (!wadFile || !keyFile) throw new Error('Usage: --unpack-doc <wad> <keys.bin>');
      if (wad.describeWad(wadFile).titleId !== DOC_TITLE_ID) throw new Error("That WAD isn't Doc Louis's Punch-Out!! (USA).");
      config.docWad = path.resolve(wadFile);
      saveConfig();
      const file = fs.readFileSync(keyFile);
      let key;
      try { key = wad.parseKey(file); } finally { file.fill(0); }
      await unpackDocWad(key);
      console.log(`UNPACKED to ${gamePaths('doclouis').data}`);
      code = 0;
    } catch (err) {
      console.log(`UNPACK FAILED: ${err.message}`);
    }
    removeRunTemp();
    app.exit(code);
  });
} else if (process.argv.includes('--selftest')) {
  app.whenReady().then(async () => {
    sweepTemp();
    loadConfig();
    let ok = false;
    try { ok = await selfTest(); } catch { ok = false; }
    removeRunTemp();
    app.exit(ok ? 0 : 1);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    sweepTemp();
    loadConfig();
    registerHandlers();
    createWindow();
  });
  app.on('window-all-closed', () => { stopChild(); app.quit(); });
  app.on('will-quit', removeRunTemp);
}
