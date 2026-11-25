'use strict';

// Builds launcher\buildkit\ (kept out of git, shipped inside the Windows download as resources\buildkit): everything the
// build would otherwise download, so a player's setup needs no internet. Every file is fetched from its official address and
// checked against its pin, so the kit is the same files the online build uses:
//   tools\      MinGit, nodtool                                         (pins: src\pins.js)
//   wiicompiled-<commit>.zip   WiiCompiled + Aurora at the pinned commits, no history (git clone, verified by commit id)
//   downloads\  the compiler, CMake, Ninja and every library archive    (WiiCompiled's own scripts fetch them, each checked
//               against the checksum they pin)
//   translator.zip  the translator built from that source plus port\punchout_region.patch, self-contained (no .NET SDK is
//               shipped: Microsoft's SDK terms don't allow it; the SDK used here is thrown away)
//   manifest.json  sizes and checksums, for the launcher's self-test
// Safe to run again: finished parts are kept (pass --refresh to redo everything). Needs git and internet, on the PC that
// builds the release. Run from launcher\: node packaging/fetch_buildkit.js

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const pins = require('../src/pins');

const LAUNCHER = path.join(__dirname, '..');
const KIT = path.join(LAUNCHER, 'buildkit');
const refresh = process.argv.includes('--refresh');
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const TAR = path.join(SYSTEM32, 'tar.exe');
const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const say = text => console.log(`\n== ${text}`);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} failed (exit ${r.status})`);
}
async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function fetchPinned(url, dest, algorithm, expected) {
  if (!refresh && fs.existsSync(dest) && await hashFile(dest, algorithm) === expected) { console.log(`  have ${path.basename(dest)}`); return; }
  console.log(`  downloading ${path.basename(dest)}`);
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'punch-drunk-release-build' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest + '.part'));
  const actual = await hashFile(dest + '.part', algorithm);
  if (actual !== expected) { fs.rmSync(dest + '.part', { force: true }); throw new Error(`${path.basename(dest)} has the wrong checksum (${actual})`); }
  fs.renameSync(dest + '.part', dest);
}
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), base)
    : [path.relative(base, path.join(dir, e.name)).replace(/\\/g, '/')]);
}

(async () => {
  if (process.platform !== 'win32') throw new Error('The Windows build kit is made on Windows.');
  fs.mkdirSync(KIT, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'punch-drunk-kit-'));
  try {
    // An earlier kit carried the .NET SDK and the translator's NuGet packages; Microsoft's SDK terms don't allow handing the
    // SDK out, so the translator is built here instead and shipped finished (step 4). Old leftovers go.
    const previous = fs.existsSync(path.join(KIT, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(KIT, 'manifest.json'), 'utf8')) : {};
    fs.rmSync(path.join(KIT, 'nuget'), { recursive: true, force: true });
    for (const old of fs.existsSync(path.join(KIT, 'tools')) ? fs.readdirSync(path.join(KIT, 'tools')) : []) {
      if (/^dotnet-sdk/i.test(old)) fs.rmSync(path.join(KIT, 'tools', old), { force: true });
    }

    // ---- 1. The tools the launcher unpacks itself.
    say('Tools: MinGit, nodtool');
    const tools = path.join(KIT, 'tools');
    await fetchPinned(pins.MINGIT.url, path.join(tools, path.basename(new URL(pins.MINGIT.url).pathname)), 'sha256', pins.MINGIT.sha256);
    const nod = pins.NODTOOL['win32-x64'];
    await fetchPinned(`https://github.com/encounter/nod/releases/download/${pins.NODTOOL.version}/${nod.asset}`, path.join(tools, nod.asset), 'sha256', nod.sha256);

    // ---- 2. WiiCompiled + Aurora source at the pinned commits.
    const wc = pins.WIICOMPILED;
    const sourceZip = path.join(KIT, `wiicompiled-${wc.commit.slice(0, 7)}.zip`);
    const buildScript = fs.readFileSync(path.join(LAUNCHER, 'scripts', 'build_port.ps1'), 'utf8');
    const baseCommit = /\$BaseCommit = '([0-9a-f]+)'/.exec(buildScript)?.[1];
    if (!baseCommit || !wc.commit.startsWith(baseCommit)) throw new Error(`build_port.ps1 builds ${baseCommit}, but src/pins.js pins ${wc.commit}`);
    const stage = path.join(scratch, 'source');   // the files without any .git: what goes in the zip, and what the next step reads
    say(`WiiCompiled ${wc.commit.slice(0, 7)} + Aurora ${wc.aurora.commit.slice(0, 7)}`);
    const clone = path.join(scratch, 'clone');
    const git = ['-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', '-c', 'advice.detachedHead=false'];
    run('git', [...git, 'clone', '-q', wc.repo, clone]);
    run('git', [...git, '-C', clone, 'checkout', '-q', wc.commit]);
    run('git', [...git, '-C', clone, 'submodule', 'update', '--init', '--recursive', '--force', '-q']);
    const head = spawnSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const aurora = spawnSync('git', ['-C', clone, 'rev-parse', 'HEAD:aurora-main'], { encoding: 'utf8' }).stdout.trim();
    if (head !== wc.commit) throw new Error(`WiiCompiled is at ${head}, not ${wc.commit}`);
    if (aurora !== wc.aurora.commit) throw new Error(`Aurora is at ${aurora}, not ${wc.aurora.commit}`);
    fs.cpSync(clone, stage, { recursive: true, filter: p => path.basename(p) !== '.git' });
    if (refresh || !fs.existsSync(sourceZip)) {
      fs.rmSync(sourceZip, { force: true });
      run(TAR, ['-a', '-c', '-f', sourceZip, '-C', stage, '.']);
    } else console.log(`  have ${path.basename(sourceZip)}`);

    // ---- 3. The compiler, CMake, Ninja and the libraries: WiiCompiled's own scripts, which check each against its pin.
    say('Compiler, CMake, Ninja and library archives');
    const downloads = path.join(KIT, 'downloads');
    if (refresh || !fs.existsSync(downloads) || fs.readdirSync(downloads).length < 10) {
      fs.rmSync(downloads, { recursive: true, force: true });
      run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fetch_buildkit_downloads.ps1'),
        '-Source', stage, '-Out', downloads, '-Scratch', path.join(scratch, 'prepared')]);
    } else console.log(`  have ${fs.readdirSync(downloads).length} archives`);

    // ---- 4. The translator, built here and shipped finished, so players need no .NET SDK. The port's patch changes five of the
    // translator's own files, so it is built from WiiCompiled's source with that patch applied (and the launcher only uses
    // it for exactly that patch). Self-contained: the .NET runtime it needs is inside. The SDK that builds it is
    // downloaded here, used and thrown away; it is never shipped.
    say('Translator (built from the pinned source plus the port patch)');
    const patchFile = path.join(LAUNCHER, '..', 'port', 'punchout_region.patch');
    const patchSha = await hashFile(patchFile, 'sha256');
    const translatorZip = path.join(KIT, 'translator.zip');
    let translator = previous.translator;
    if (!refresh && fs.existsSync(translatorZip) && translator && translator.patchSha256 === patchSha && translator.commit === wc.commit) {
      console.log('  have translator.zip (same port patch)');
    } else {
      fs.rmSync(translatorZip, { force: true });
      const sdkZip = path.join(scratch, path.basename(new URL(pins.DOTNET.url).pathname));
      await fetchPinned(pins.DOTNET.url, sdkZip, 'sha512', pins.DOTNET.sha512);
      const sdk = path.join(scratch, 'dotnet');
      fs.mkdirSync(sdk, { recursive: true });
      run(TAR, ['-xf', sdkZip, '-C', sdk]);
      const patched = path.join(scratch, 'patched');
      fs.cpSync(stage, patched, { recursive: true });
      run('git', ['-C', patched, 'apply', '--whitespace=nowarn', patchFile]);
      const packages = path.join(scratch, 'packages');
      const config = path.join(scratch, 'NuGet.Config');
      fs.writeFileSync(config, '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <clear />\n    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />\n  </packageSources>\n</configuration>\n');
      const env = { ...process.env, DOTNET_ROOT: sdk, DOTNET_MULTILEVEL_LOOKUP: '0', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1',
        DOTNET_CLI_HOME: path.join(scratch, 'home'), NUGET_PACKAGES: packages, MSBUILDDISABLENODEREUSE: '1', DOTNET_CLI_DO_NOT_USE_MSBUILD_SERVER: '1' };
      const out = path.join(scratch, 'translator-out');
      run(path.join(sdk, 'dotnet.exe'), ['publish', path.join(patched, 'translator', 'src', 'Translator.Cli', 'Translator.Cli.csproj'),
        '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-o', out, '--configfile', config, '-v', 'quiet',
        '--disable-build-servers', '-nodeReuse:false', '-p:UseSharedCompilation=false', '-p:DebugType=none', '-p:DebugSymbols=false'], { env });
      if (!fs.existsSync(path.join(out, 'Translator.Cli.exe'))) throw new Error('The translator was not built');
      // Licence texts of what the folder holds besides our own code: the .NET runtime, YamlDotNet, Tomlyn.
      const lic = path.join(out, 'licenses');
      fs.mkdirSync(lic, { recursive: true });
      for (const rel of walk(packages)) {
        const [pkg] = rel.split('/');
        if (/^(microsoft\.netcore\.app\.runtime\.win-x64|yamldotnet|tomlyn)$/.test(pkg) && /(^|\/)(license|third-party-notices|thirdpartynotices)[^/]*$/i.test(rel)) {
          fs.copyFileSync(path.join(packages, rel), path.join(lic, `${pkg}-${path.basename(rel)}`));
          console.log(`  licence: ${pkg}-${path.basename(rel)}`);
        }
      }
      run(TAR, ['-a', '-c', '-f', translatorZip, '-C', out, '.']);
      translator = { file: 'translator.zip', commit: wc.commit, patchSha256: patchSha, dotnet: pins.DOTNET.version };
    }

    // ---- 5. License texts for the pieces whose download carries none (Dawn's prebuilt package, Ninja's exe, nodtool's exe).
    say('License texts');
    const licenses = path.join(KIT, 'licenses');
    fs.mkdirSync(licenses, { recursive: true });
    const texts = {
      'dawn-LICENSE.txt': 'https://raw.githubusercontent.com/encounter/dawn/main/LICENSE',
      'ninja-LICENSE.txt': 'https://raw.githubusercontent.com/ninja-build/ninja/master/COPYING',
      'tomlyn-LICENSE.txt': 'https://raw.githubusercontent.com/xoofx/Tomlyn/main/license.txt',
      'nod-LICENSE-MIT.txt': 'https://raw.githubusercontent.com/encounter/nod/main/LICENSE-MIT',
      'nod-LICENSE-APACHE.txt': 'https://raw.githubusercontent.com/encounter/nod/main/LICENSE-APACHE'
    };
    for (const [name, url] of Object.entries(texts)) {
      const dest = path.join(licenses, name);
      if (!refresh && fs.existsSync(dest)) { console.log(`  have ${name}`); continue; }
      const res = await fetch(url, { headers: { 'User-Agent': 'punch-drunk-release-build' } });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      fs.writeFileSync(dest, await res.text());
      console.log(`  ${name}`);
    }

    // ---- 6. The manifest.
    say('Manifest');
    const files = [];
    for (const rel of walk(KIT).filter(r => r !== 'manifest.json').sort()) {
      const full = path.join(KIT, rel);
      files.push({ path: rel, size: fs.statSync(full).size, sha256: await hashFile(full, 'sha256') });
    }
    const manifest = {
      made: new Date().toISOString(),
      source: { file: path.basename(sourceZip), commit: wc.commit, aurora: wc.aurora.commit, sha256: files.find(f => f.path === path.basename(sourceZip)).sha256 },
      translator: { ...translator, sha256: files.find(f => f.path === 'translator.zip').sha256 },
      files
    };
    fs.writeFileSync(path.join(KIT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const total = files.reduce((n, f) => n + f.size, 0);
    console.log(`\nBuild kit ready: ${files.length} files, ${(total / 1048576).toFixed(0)} MB, in ${KIT}`);
  } finally {
    // Git leaves read-only files in a clone, which fs.rmSync can't delete on Windows: cmd's rmdir can.
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {
      spawnSync(path.join(SYSTEM32, 'cmd.exe'), ['/c', 'rmdir', '/s', '/q', scratch], { stdio: 'ignore' });
    }
  }
})().catch(err => { console.error(`\nFAILED: ${err.message}`); process.exit(1); });
