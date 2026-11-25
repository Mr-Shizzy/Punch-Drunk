'use strict';

// The update check. Looks at the newest release of this project on GitHub; if it is newer than the running program, the
// launcher offers it ("Update now" / "Remind me later"). Nothing is ever forced and nothing about the player is sent (the
// request is a plain GET of a public page; GitHub sees an IP address, like any website).
//
// On Windows "Update now" downloads that release's zip, checks it against the release's .sha256 file, unpacks it into the
// program's own folder (update\), then a small script (PowerShell, started detached) waits for the launcher to close, swaps
// the program's files for the new ones (data\, settings.json and temp\ are never touched), and starts the new launcher. If
// anything fails the old files are put back. The launcher then rebuilds the games the new version changed.
// Linux and the Steam Deck get the notice and a button to the download page (an AppImage replacing itself is not done yet).
//
// This file holds the logic that needs no Electron, so it can be tested on its own (test/updater.test.js).

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const REPO = 'Mr-Shizzy/Punch-Drunk';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
// Where a release's files may come from. GitHub serves assets from github.com, which redirects to its own storage hosts.
const GITHUB_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com',
  'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);

// A test hook: PUNCHDRUNK_UPDATE_API points the check at another address (a local fake release server), which may then be
// plain http on this PC only. Without it only GitHub is ever contacted.
function source(env = process.env) {
  const override = env.PUNCHDRUNK_UPDATE_API;
  return override ? { api: override, test: true } : { api: API, test: false };
}

function parseVersion(text) {
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(text || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isNewer(remote, local) {
  const a = parseVersion(remote), b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Is this address one the updater may fetch? https from GitHub's hosts (for the repository's own release files only, when
// the host is github.com); in test mode also http/https to this PC.
function allowedUrl(url, test = false) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (test && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && ['http:', 'https:'].includes(u.protocol)) return true;
  if (u.protocol !== 'https:' || u.username || u.password || !GITHUB_HOSTS.has(u.hostname)) return false;
  if (u.hostname === 'github.com') return u.pathname.startsWith(`/${REPO}/releases/download/`);
  if (u.hostname === 'api.github.com') return u.pathname.startsWith(`/repos/${REPO}/`);
  return true; // GitHub's storage hosts (the redirect targets); the file is still checked against the release's SHA-256
}

const platformAsset = version => `Punch-Drunk-${version}-Windows-x64.zip`;

// The newest release as the launcher needs it, or null when it can't be used. `selfUpdate`: this platform can install it
// itself (Windows); then the release must carry the zip and its .sha256 file, otherwise the notice is "manual" (a link).
function pickRelease(json, { selfUpdate = false, test = false } = {}) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const version = String(json.tag_name || '').replace(/^v/, '');
  if (!parseVersion(version)) return null;
  const info = { version, notes: String(json.body || '').slice(0, 4000), page: allowedUrl(json.html_url || '', test) ? json.html_url : RELEASES_PAGE,
    size: 0, asset: null, sha: null, manual: true };
  if (!selfUpdate) return info;
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const zip = assets.find(a => a && a.name === platformAsset(version));
  const sha = assets.find(a => a && a.name === `${platformAsset(version)}.sha256`);
  if (!zip || !sha || !allowedUrl(zip.browser_download_url, test) || !allowedUrl(sha.browser_download_url, test)) return info;
  const size = Number(zip.size);
  if (!Number.isFinite(size) || size <= 0) return info;
  return { ...info, size, asset: { name: zip.name, url: zip.browser_download_url }, sha: { name: sha.name, url: sha.browser_download_url }, manual: false };
}

// "<64 hex digits>  <file name>" as sha256sum writes it (a file with only the hash is taken too).
function parseSha256(text, fileName) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})(?:\s+\*?(.+?))?\s*$/.exec(line.trim());
    if (m && (!m[2] || path.basename(m[2]) === fileName)) return m[1].toLowerCase();
  }
  return null;
}

// A network or server problem as a sentence a player can read (the original text goes to the activity log).
function describeError(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || err);
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) ||
    /stopped answering|interrupted/.test(msg)) return "it couldn't reach the server. Is this PC online?";
  const http = /^HTTP (\d+)$/.exec(msg);
  if (http) {
    if (http[1] === '404') return 'no release was found there yet.';
    if (http[1] === '403' || http[1] === '429') return 'GitHub is limiting requests right now. Try again later.';
    return `the server answered with an error (${http[1]}).`;
  }
  return msg;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// ---- Network ----

// One GET with redirects (each target must be an allowed address); `onResponse(res)` gets the final 200 response.
function get(url, { test = false, redirects = 5, signal } = {}, onResponse) {
  return new Promise((resolve, reject) => {
    if (!allowedUrl(url, test)) { reject(new Error('That address is not one the updater uses.')); return; }
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': 'punch-drunk-launcher', Accept: 'application/vnd.github+json, */*' }, signal }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), { test, redirects: redirects - 1, signal }, onResponse));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      Promise.resolve(onResponse(res)).then(resolve, reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('The server stopped answering.')));
  });
}
function getText(url, opts = {}, limit = 2 * 1024 * 1024) {
  return get(url, opts, res => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    res.on('data', c => { n += c.length; if (n > limit) { res.destroy(new Error('The reply was too large.')); return; } chunks.push(c); });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  }));
}
async function fetchLatest(api, opts = {}) {
  return JSON.parse(await getText(api, opts));
}
// Streams the file into `dest` (written as dest.part, then renamed) and reports progress.
function downloadFile(url, dest, onProgress, opts = {}) {
  return get(url, opts, res => new Promise((resolve, reject) => {
    const total = Number(res.headers['content-length']) || 0;
    let got = 0;
    const part = `${dest}.part`;
    const out = fs.createWriteStream(part);
    res.on('data', chunk => { got += chunk.length; if (onProgress) onProgress(got, total); });
    res.on('error', err => { out.destroy(); reject(err); });
    res.on('aborted', () => { out.destroy(); reject(new Error('The download was interrupted.')); });
    out.on('error', reject);
    out.on('finish', () => { fs.renameSync(part, dest); resolve(got); });
    res.pipe(out);
  }));
}

// ---- Applying (Windows) ----

// The PowerShell script that swaps the files once the launcher has closed. Its one argument is a JSON file holding: the
// launcher's process id, the program's folder, the unpacked new folder, the exe to start again, and where to leave the result. Anything it can't do
// puts the old files back and starts the old launcher again.
const APPLY_SCRIPT = String.raw`param([Parameter(Mandatory)][string]$ArgsFile)
$ErrorActionPreference = 'Stop'
# The launcher writes what the script needs to a small JSON file (no folder names on a command line).
$a = Get-Content -LiteralPath $ArgsFile -Raw -Encoding UTF8 | ConvertFrom-Json
$LauncherPid = [int]$a.launcherPid; $Root = [string]$a.root; $Staging = [string]$a.staging; $Exe = [string]$a.exe
$Result = [string]$a.result; $FromVersion = [string]$a.from; $ToVersion = [string]$a.to
# Never touched: the player's own files.
$keep = @('data', 'temp', 'update', 'settings.json', 'selftest_result.txt')
$suffix = '.old-update'
$updateDir = Join-Path $Root 'update'
$logFile = Join-Path $updateDir 'apply.log'
function Log([string]$Text) { try { Add-Content -LiteralPath $logFile -Value ('{0:HH:mm:ss} {1}' -f (Get-Date), $Text) } catch { } }
function Retry([scriptblock]$Action) {
    for ($i = 1; $i -le 12; $i++) {
        try { & $Action; return } catch { if ($i -eq 12) { throw } ; Start-Sleep -Milliseconds 500 }
    }
}
$lock = Join-Path $updateDir 'applying.lock'
Set-Content -LiteralPath $lock -Value "$PID"
$moved = New-Object System.Collections.Generic.List[string]    # names renamed to name.old-update
$copied = New-Object System.Collections.Generic.List[string]   # names copied in from the new version
$ok = $false; $error_text = ''
try {
    Log "waiting for the launcher (process $LauncherPid) to close"
    $proc = Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.WaitForExit(90000)) { throw 'the launcher did not close' }
    Start-Sleep -Milliseconds 800
    $newNames = @(Get-ChildItem -LiteralPath $Staging -Force | ForEach-Object { $_.Name })
    if ($newNames -notcontains $Exe) { throw "the update has no $Exe" }
    # 1. Everything of the old version moves aside (what the new version doesn't have stays aside, so it ends up removed).
    foreach ($entry in @(Get-ChildItem -LiteralPath $Root -Force)) {
        if ($keep -contains $entry.Name -or $entry.Name.EndsWith($suffix)) { continue }
        Log "moving aside $($entry.Name)"
        $target = $entry.FullName
        Retry { if (Test-Path -LiteralPath "$target$suffix") { Remove-Item -LiteralPath "$target$suffix" -Recurse -Force }; Move-Item -LiteralPath $target -Destination "$target$suffix" }
        $moved.Add($entry.Name)
    }
    # 2. The new version's files go in.
    foreach ($name in $newNames) {
        if ($keep -contains $name) { continue }
        Log "installing $name"
        Copy-Item -LiteralPath (Join-Path $Staging $name) -Destination (Join-Path $Root $name) -Recurse -Force
        $copied.Add($name)
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Root $Exe) -PathType Leaf)) { throw "$Exe is missing after the copy" }
    $ok = $true
    Log 'the new files are in place'
} catch {
    $error_text = $_.Exception.Message
    Log "FAILED: $error_text; putting the old files back"
    try {
        foreach ($name in $copied) { $p = Join-Path $Root $name; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force } }
        foreach ($name in $moved) {
            $p = Join-Path $Root $name
            if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
            if (Test-Path -LiteralPath "$p$suffix") { Move-Item -LiteralPath "$p$suffix" -Destination $p }
        }
        Log 'the old version is back'
    } catch { Log "ROLLBACK PROBLEM: $($_.Exception.Message)"; $error_text += " (and putting the old files back failed: $($_.Exception.Message))" }
}
if ($ok) {
    foreach ($name in $moved) { try { Remove-Item -LiteralPath (Join-Path $Root "$name$suffix") -Recurse -Force } catch { Log "could not remove the old $name" } }
    try { Remove-Item -LiteralPath $Staging -Recurse -Force } catch { }
}
$json = @{ ok = $ok; from = $FromVersion; to = $ToVersion; error = $error_text } | ConvertTo-Json
[IO.File]::WriteAllText($Result, $json, (New-Object System.Text.UTF8Encoding($false)))
Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
Log 'starting the launcher'
Start-Process -FilePath (Join-Path $Root $Exe) -WorkingDirectory $Root
`;

module.exports = { REPO, API, RELEASES_PAGE, APPLY_SCRIPT, source, parseVersion, isNewer, allowedUrl, platformAsset, pickRelease,
  parseSha256, describeError, sha256File, fetchLatest, getText, downloadFile };
