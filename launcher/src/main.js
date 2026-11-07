'use strict';

// POW: Recompiled!! Launcher (POW = Punch-Out!! Wii): main process. Sets up the ports on the player's own computer from their own copies (checks
// the build tools; Punch-Out!!: validates and extracts the disc with nodtool; Doc Louis's Punch-Out!!: collects the
// title from Dolphin's Wii storage), builds a port with scripts/build_port.sh, or scripts/build_port.ps1 on Windows,
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

// The one supported disc: Punch-Out!! (USA), its main.dol.
const GAME_ID = 'R7PE01';
const MAIN_DOL_MD5 = '1276cd5952e3b4c644925928786b3e20';
// nodtool (encounter/nod, MIT / Apache-2.0): the same pinned release WiiCompiled's own setup uses.
const NODTOOL = {
  version: 'v2.0.0-alpha.10',
  'linux-x64': { asset: 'nodtool-linux-x86_64', sha256: 'f853b83268b9542faf0d28815bc3a23c090ae28ebf397e46f99cbb08122c8307' },
  'win32-x64': { asset: 'nodtool-windows-x86_64.exe', sha256: '1e150e33b88157527f96caea89ad12267aed8b117180c9ebaa89ebe89c1d948d' }
};
// Doc Louis's Punch-Out!! (WiiWare, USA): title 00010001-57504345 as Dolphin installs it (decrypted contents), and
// the sha256 of its game code (content 1).
const DOC_TITLE = ['00010001', '57504345'];
const DOC_DOL_SHA256 = '3ea93aaa347414c4cd81891f4d13d605b2316abb53f1bc511d036122ea5c37eb';
const GAMES = {
  // legacyBinaries: names a build from before a rename has; found, it counts as built (and outdated), so Play works.
  punchout: { name: 'Punch-Out!!', binary: 'POWRecompiled', legacyBinaries: ['RePunched'] },
  doclouis: { name: "Doc Louis's Punch-Out!!", binary: 'DocLouis' }
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
const VC_REDIST = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
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

const configFile = () => path.join(app.getPath('userData'), 'preferences.json');
function loadConfig() {
  // Preferences from before the renames ("Re-Punched Launcher", "Fist-In Launcher", "Punch-Out PC Launcher") carry
  // over once.
  const legacy = ['Re-Punched Launcher', 'Fist-In Launcher', 'Punch-Out PC Launcher']
    .map(name => path.join(app.getPath('appData'), name, 'preferences.json')).find(file => fs.existsSync(file));
  if (!fs.existsSync(configFile()) && legacy) {
    try { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.copyFileSync(legacy, configFile()); } catch { /* start fresh */ }
  }
  try { config = JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { config = {}; }
}
function saveConfig() {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}
// Installs from before the renames (Re-Punched, Fist-In, punchout-pc) stay where they are: their build folders hold
// absolute paths, so moving them would mean building from scratch.
const LOCAL_DATA = IS_WIN ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
  : path.join(os.homedir(), '.local', 'share');
const DEFAULT_DATA_ROOT = path.join(LOCAL_DATA, IS_WIN ? 'POW-Recompiled' : 'pow-recompiled');
const LEGACY_DATA_ROOTS = [path.join(LOCAL_DATA, IS_WIN ? 'Re-Punched' : 're-punched'),
  path.join(LOCAL_DATA, IS_WIN ? 'Fist-In' : 'fist-in'), path.join(os.homedir(), '.local', 'share', 'punchout-pc')];
const dataRoot = () => config.dataRoot || (fs.existsSync(DEFAULT_DATA_ROOT) ? DEFAULT_DATA_ROOT
  : LEGACY_DATA_ROOTS.find(dir => fs.existsSync(dir)) || DEFAULT_DATA_ROOT);
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
  const candidates = [config.portSource, process.env.PUNCHOUT_PORT_SOURCE,
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
function log(line) {
  logLines.push(line);
  if (logLines.length > 4000) logLines.splice(0, logLines.length - 4000);
  send('log', line);
}
function setTask(next) {
  task = next;
  send('task', task);
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
    https.get(url, { headers: { 'User-Agent': 'pow-recompiled-launcher' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`download failed (HTTP ${res.statusCode})`)); return; }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      if (onProgress) res.on('data', chunk => { got += chunk.length; onProgress(got, total); });
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
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
const VC_RUNTIME_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];
async function checkWindowsTools() {
  const t = winTools();
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  let dotnetOk = false;
  if (fs.existsSync(t.dotnet)) {
    const r = await run(t.dotnet, ['--list-sdks'], { timeout: 20000, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
    dotnetOk = r.ok && /^8\./m.test(r.stdout);
  }
  const results = [
    { name: 'git', ok: fs.existsSync(t.git), need: 'Git' },
    { name: 'dotnet', ok: dotnetOk, need: '.NET 8 SDK' },
    { name: 'vcruntime', ok: VC_RUNTIME_DLLS.every(d => fs.existsSync(path.join(sys32, d))), need: 'Visual C++ runtime' }
  ];
  const missing = results.filter(r => !r.ok).map(r => r.name);
  return { ok: missing.length === 0, results, missing, hint: null, managed: true };
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
  const file = path.join(os.tmpdir(), `pow-recompiled-${process.pid}-${Date.now()}.json`);
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
  if (!status.results.find(r => r.name === 'vcruntime').ok) {
    // Microsoft's own installer (the game's renderer DLLs need it). Windows asks for permission to install it.
    const exe = path.join(p.tools, 'vc_redist.x64.exe');
    await download(VC_REDIST, exe, (got, total) => setTask({ label: 'Downloading the Visual C++ runtime', detail: mb(got), percent: percentOf(got, total) }));
    const sig = await run('powershell.exe', ['-NoProfile', '-Command',
      `$s = Get-AuthenticodeSignature -LiteralPath '${exe.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { timeout: 60000 });
    if (!/^Valid\|.*O=Microsoft Corporation/m.test(sig.stdout)) { await fsp.rm(exe, { force: true }); throw new Error("The Visual C++ runtime download isn't signed by Microsoft."); }
    setTask({ label: 'Installing the Visual C++ runtime', detail: 'Allow it in the Windows prompt', percent: null });
    // Start-Process -Verb RunAs: the installer needs administrator rights, which a plain spawn can't ask for.
    await run('powershell.exe', ['-NoProfile', '-Command',
      `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList '/install','/passive','/norestart' -Verb RunAs -Wait`], { timeout: 10 * 60000 });
    await fsp.rm(exe, { force: true });
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
// Doc Louis's Punch-Out!!: the title, from Dolphin's Wii storage (Tools > Install WAD puts it there, decrypted)

// Dolphin's Wii folder: the usual places for a normal install and the Flatpak on Linux, Documents or AppData on
// Windows.
function dolphinWiiFolders() {
  const home = os.homedir();
  if (IS_WIN) {
    return [path.join(app.getPath('documents'), 'Dolphin Emulator', 'Wii'),
      path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Dolphin Emulator', 'Wii')];
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return [...new Set([path.join(xdg, 'dolphin-emu', 'Wii'), path.join(home, '.local', 'share', 'dolphin-emu', 'Wii'),
    path.join(home, '.var', 'app', 'org.DolphinEmu.dolphin-emu', 'data', 'dolphin-emu', 'Wii'),
    path.join(home, '.dolphin-emu', 'Wii')])];
}
// Where the title's files are: its folder (content/title.tmd, content/*.app), the shared contents (shared1: content.map
// and *.app) and the ticket. From a Wii folder, a Dolphin user folder holding one, or the title's own folder.
function docTitleAt(dir) {
  if (!dir) return null;
  const has = p => fs.existsSync(p);
  for (const wii of [dir, path.join(dir, 'Wii')]) {
    const title = path.join(wii, 'title', ...DOC_TITLE);
    if (has(path.join(title, 'content', 'title.tmd'))) {
      return { title, shared: path.join(wii, 'shared1'), ticket: path.join(wii, 'ticket', DOC_TITLE[0], `${DOC_TITLE[1]}.tik`), from: wii };
    }
  }
  if (has(path.join(dir, 'content', 'title.tmd'))) {
    // The title folder itself: shared contents next to it in its Wii folder, or copied into it (content.map + .app).
    const wii = path.join(dir, '..', '..', '..');
    const shared = has(path.join(wii, 'shared1', 'content.map')) ? path.join(wii, 'shared1') : dir;
    const ticket = [path.join(wii, 'ticket', DOC_TITLE[0], `${DOC_TITLE[1]}.tik`), path.join(dir, `${DOC_TITLE[1]}.tik`), path.join(dir, 'title.tik')]
      .find(has) || '';
    return { title: dir, shared, ticket, from: dir };
  }
  return null;
}
function docSource() {
  return docTitleAt(config.docFolder) || dolphinWiiFolders().map(docTitleAt).find(Boolean) || null;
}

function docReady() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(gamePaths('doclouis').data, '..', 'collected.json'), 'utf8'));
    return info.dolSha256 === DOC_DOL_SHA256 && fs.existsSync(path.join(gamePaths('doclouis').data, '00000001.app'));
  } catch { return false; }
}

// Copies the title's contents into doclouis/title as title.tmd + <content id>.app (what the game's ES reads), each
// checked against the hash in its title.tmd. Shared contents are found in shared1/content.map by that hash.
async function collectDocTitle() {
  const src = docSource();
  if (!src) throw new Error("Doc Louis's Punch-Out!! wasn't found in Dolphin. Install it there first (Tools > Install WAD), or choose its folder.");
  setTask({ label: "Getting Doc Louis's Punch-Out!! from Dolphin", detail: src.from, percent: null });
  const out = gamePaths('doclouis').data;
  const tmd = await fsp.readFile(path.join(src.title, 'content', 'title.tmd'));
  const count = tmd.readUInt16BE(0x1DE);
  const shared = new Map();
  try {
    const map = await fsp.readFile(path.join(src.shared, 'content.map'));
    for (let i = 0; i + 28 <= map.length; i += 28) {
      shared.set(map.subarray(i + 8, i + 28).toString('hex'), path.join(src.shared, map.subarray(i, i + 8).toString('latin1') + '.app'));
    }
  } catch { /* no shared contents */ }
  await fsp.rm(out, { recursive: true, force: true });
  await fsp.mkdir(out, { recursive: true });
  await fsp.writeFile(path.join(out, 'title.tmd'), tmd);
  for (let i = 0; i < count; i++) {
    const r = 0x1E4 + 36 * i;
    const cid = tmd.readUInt32BE(r), index = tmd.readUInt16BE(r + 4), type = tmd.readUInt16BE(r + 6);
    const size = Number(tmd.readBigUInt64BE(r + 8)), sha1 = tmd.subarray(r + 16, r + 36).toString('hex');
    const name = cid.toString(16).padStart(8, '0') + '.app';
    let file = path.join(src.title, 'content', name);
    if (type & 0x8000) file = shared.get(sha1) || file;
    let data = null;
    try { data = await fsp.readFile(file); } catch { /* missing */ }
    if (!data || data.length < size || crypto.createHash('sha1').update(data.subarray(0, size)).digest('hex') !== sha1) {
      throw new Error(`Doc Louis's Punch-Out!! in Dolphin is incomplete or damaged (content ${index}, ${name}). Reinstall it in Dolphin.`);
    }
    await fsp.writeFile(path.join(out, name), data.subarray(0, size)); // (a content's size; any padding dropped)
  }
  if (src.ticket && fs.existsSync(src.ticket)) await fsp.copyFile(src.ticket, path.join(out, 'title.tik'));
  const dol = path.join(out, '00000001.app');
  const dolSha256 = fs.existsSync(dol) ? await sha256(dol) : '';
  if (dolSha256 !== DOC_DOL_SHA256) throw new Error("That's a version of Doc Louis's Punch-Out!! the port doesn't support yet (it needs the USA release, WPCE01).");
  await fsp.writeFile(path.join(out, '..', 'collected.json'), JSON.stringify({ from: src.from, dolSha256, at: new Date().toISOString() }, null, 2));
}

// Doc Louis's own Config.toml: where its title is. Everything shared it reads from Punch-Out!!'s (see above).
function ensureDocConfig() {
  const file = gamePaths('doclouis').config;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  text = toml.set(text, 'paths', 'title_content', gamePaths('doclouis').data);
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
  if (game === 'punchout' && !await discExtracted()) await extractDisc();
  if (game === 'doclouis') await collectDocTitle(); // quick: a few MB, and picks up a reinstall in Dolphin
  await fsp.mkdir(p.logs, { recursive: true });
  const steps = { total: 7, at: 0 };
  const label = `Building ${GAMES[game].name}`;
  setTask({ label, detail: 'Starting', percent: 0 });
  // The other game's WiiCompiled clone, if there is one, is copied instead of downloading it again.
  const other = gamePaths(game === 'punchout' ? 'doclouis' : 'punchout');
  const seed = path.join(other.work, 'wiicompiled');
  const env = { ...process.env, PO_GAME: game, PO_SRC: src, PO_WORK: p.work, PO_DATA: p.data, PO_PORT: p.port, PO_LOGS: p.logs,
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
// name matches the window's app ID. The game's is "pow-recompiled", so this hidden entry (NoDisplay: not in the app
// menu) gives its window the glove and "POW: Recompiled!!". Rewritten on each launch so it follows the install folder.
function writeGameDesktopEntry(binary) {
  if (process.platform !== 'linux') return;
  try {
    const dir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');
    const icon = path.join(path.dirname(binary), 'assets', 'punchout', 'icon.png');
    const quote = s => '"' + s.replace(/(["`$\\])/g, '\\$1') + '"';
    const text = ['[Desktop Entry]', 'Type=Application', 'Name=POW: Recompiled!!', 'Comment=Punch-Out!! (Wii) on PC',
      `Exec=${quote(binary)}`, `Path=${path.dirname(binary)}`, `Icon=${fs.existsSync(icon) ? icon : 'applications-games'}`,
      'StartupWMClass=pow-recompiled', 'Categories=Game;', 'NoDisplay=true', ''].join('\n');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pow-recompiled.desktop'), text);
    for (const old of ['re-punched.desktop', 'fist-in.desktop', 'punchout-pc.desktop']) fs.rmSync(path.join(dir, old), { force: true }); // earlier names
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
      forceAspect: get('video', 'force_aspect', false) === true,
      nativeEffects: get('video', 'native_effect_copies', false) === true,
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

async function state() {
  const game = currentGame();
  const tools = await checkTools();
  const extracted = game === 'punchout' ? await discExtracted() : docReady();
  const b = await buildState(game);
  const doc = game === 'doclouis' ? docSource() : null;
  const haveCopy = game === 'punchout' ? Boolean(config.disc || extracted) : Boolean(doc || extracted);
  // Once the game is built it can be played without the build tools (they may live in a container, or be gone).
  const step = b.built ? 0 : !tools.ok ? 1 : !haveCopy ? 2 : 3;
  return {
    game, games: Object.fromEntries(Object.entries(GAMES).map(([id, g]) => [id, { name: g.name, built: fs.existsSync(gameBinary(id)) }])),
    step, tools, extracted,
    disc: config.disc || config.discFolder || null,
    doc: doc ? doc.from : null, dolphinFolders: dolphinWiiFolders(),
    build: { built: b.built, outdated: Boolean(b.outdated), at: b.info?.at || null },
    portSource: portSource(),
    dataRoot: dataRoot(),
    steamDeck: STEAM_DECK,
    running: gameRunning, busy: Boolean(child) && !gameRunning,
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
    if (which === 'dataRoot') config.dataRoot = r.filePaths[0];
    if (which === 'portSource') config.portSource = r.filePaths[0];
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
  // Doc Louis's: Dolphin's Wii folder (or its user folder, or the title's own folder) when it isn't found by itself.
  ipcMain.handle('choose-doc-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: "Choose Dolphin's Wii folder", properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    if (!docTitleAt(r.filePaths[0])) {
      return { ok: false, problem: "Doc Louis's Punch-Out!! isn't in that folder. Choose Dolphin's Wii folder (it holds title and shared1)." };
    }
    config.docFolder = r.filePaths[0];
    saveConfig();
    send('state-changed');
    return { ok: true };
  });
  ipcMain.handle('build', exclusive(build));
  ipcMain.handle('play', exclusive(play));
  ipcMain.handle('stop', () => stopChild());
  ipcMain.handle('save-settings', (_e, s) => { writeGameSettings(s); return readGameSettings(); });
  ipcMain.handle('open-folder', (_e, which) => {
    const p = paths();
    const g = gamePaths();
    const dir = { logs: g.logs, port: g.port, data: p.root }[which] || p.root;
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
    width: 1080, height: 760, minWidth: 860, minHeight: 600, frame: false, backgroundColor: '#14121f',
    title: 'POW: Recompiled!! Launcher', show: false, icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Development: PUNCHOUT_SCREENSHOTS=<folder> saves a picture of every page, then quits.
  if (process.env.PUNCHOUT_SCREENSHOTS) {
    win.webContents.once('did-finish-load', async () => {
      const dir = process.env.PUNCHOUT_SCREENSHOTS;
      fs.mkdirSync(dir, { recursive: true });
      for (const pageName of ['play', 'archipelago', 'controls', 'settings', 'credits']) {
        await win.webContents.executeJavaScript(`document.getElementById('nav-${pageName}').click()`);
        await new Promise(r => setTimeout(r, 1200));
        fs.writeFileSync(path.join(dir, `${pageName}.png`), (await win.webContents.capturePage()).toPNG());
      }
      app.quit();
    });
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    loadConfig();
    registerHandlers();
    createWindow();
  });
  app.on('window-all-closed', () => { stopChild(); app.quit(); });
}
