'use strict';

// Fetches the Microsoft Visual C++ runtime DLLs the game needs (its graphics DLLs, webgpu_dawn.dll and
// dxcompiler.dll, link against them) into launcher\vcruntime, to ship app-local with the release: nothing is
// installed into Windows. Run on the build PC (build_release.js calls it); needs 7-Zip.
//
// Source: Microsoft's own current redistributable (aka.ms/vc14/vc_redist.x64.exe). Its Authenticode signature must
// be valid and Microsoft's, and so must each DLL taken out of it. The files are unmodified. Microsoft lets these
// runtime DLLs be redistributed with an application, in the application's folder ("app-local").

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const REDIST_URL = 'https://aka.ms/vc14/vc_redist.x64.exe';
const DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_atomic_wait.dll'];
const OUT = path.join(__dirname, '..', 'vcruntime');
const SEVEN_ZIP = ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].find(f => fs.existsSync(f));

function download(url, dest, redirects = 6) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'punch-drunk-build' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}
// "Valid|<subject>|<file version>" from PowerShell's own signature check.
function signature(file) {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; ` +
    `"$($s.Status)|$($s.SignerCertificate.Subject)|$((Get-Item -LiteralPath '${file.replace(/'/g, "''")}').VersionInfo.FileVersionRaw)"`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim();
}
function requireMicrosoft(file) {
  const sig = signature(file);
  // Valid, and issued to the organisation Microsoft Corporation (the installer is signed as "Microsoft Corporation",
  // the DLLs inside as "Microsoft Windows Software Compatibility Publisher").
  if (!/^Valid\|CN=Microsoft [^,|]+, O=Microsoft Corporation, L=Redmond, S=Washington, C=US\|/.test(sig)) throw new Error(`${path.basename(file)} isn't validly signed by Microsoft (${sig})`);
  return sig.split('|')[2];
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Run this on Windows.');
  if (!SEVEN_ZIP) throw new Error('7-Zip is needed to unpack the redistributable (https://7-zip.org).');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'punch-drunk-vcredist-'));
  try {
    const exe = path.join(work, 'vc_redist.x64.exe');
    console.log(`Downloading ${REDIST_URL}`);
    await download(REDIST_URL, exe);
    const version = requireMicrosoft(exe);
    console.log(`vc_redist.x64.exe ${version}: signed by Microsoft`);
    // The installer is a WiX bundle: its payload is an attached cabinet holding further cabinets; the x64 runtime
    // DLLs are in one of those, named <dll>_amd64. 7-Zip only opens these, nothing is run.
    const outer = path.join(work, 'outer'), inner = path.join(work, 'inner'), dlls = path.join(work, 'dlls');
    execFileSync(SEVEN_ZIP, ['x', '-t#', exe, `-o${outer}`, '-y'], { stdio: 'ignore' });
    const cabs = fs.readdirSync(outer).filter(n => n.endsWith('.cab')).map(n => path.join(outer, n));
    for (const cab of cabs) execFileSync(SEVEN_ZIP, ['x', cab, `-o${inner}`, '-y'], { stdio: 'ignore' });
    for (const box of fs.readdirSync(inner)) {
      try { execFileSync(SEVEN_ZIP, ['e', path.join(inner, box), `-o${dlls}`, '-y', ...DLLS.map(d => `${d}_amd64`)], { stdio: 'ignore' }); } catch { /* not a cabinet */ }
    }
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    const versions = {};
    for (const dll of DLLS) {
      const from = path.join(dlls, `${dll}_amd64`);
      if (!fs.existsSync(from)) throw new Error(`${dll} wasn't found in the redistributable`);
      versions[dll] = requireMicrosoft(from);
      fs.copyFileSync(from, path.join(OUT, dll));
    }
    fs.writeFileSync(path.join(OUT, 'VERSION.json'), JSON.stringify({ redistributable: version, files: versions, from: REDIST_URL }, null, 2));
    console.log(`Visual C++ runtime ${version} -> ${OUT}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
