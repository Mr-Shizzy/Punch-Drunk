'use strict';

// Builds a Linux AppImage, then checks what's inside it.
// electron-builder's AppImage tools add six libraries to usr/lib (libXss, libXtst, libappindicator, libindicator,
// libgconf, libnotify). The launcher doesn't link to any of them, and some are GPL or LGPL, so the build uses a copy
// of those tools with the library folder emptied.
// Run from launcher/:  node packaging/build_linux.js [electron-builder config]

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Arch } = require('builder-util');
const { getAppImageTools } = require('app-builder-lib/out/toolsets/linux');

const LAUNCHER = path.join(__dirname, '..');
const config = process.argv[2] || null;
const settings = config ? require(path.join(LAUNCHER, config)) : require(path.join(LAUNCHER, 'package.json')).build;
const APPIMAGE = path.join(LAUNCHER, 'dist', settings.linux.artifactName.replace('${ext}', 'AppImage'));

async function main() {
  if (process.platform !== 'linux') throw new Error('Build the Linux AppImages on Linux (or WSL).');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'punch-drunk-appimage-'));
  try {
    const original = path.dirname((await getAppImageTools('0.0.0', Arch.x64)).runtime);
    const tools = path.join(work, 'tools');
    fs.cpSync(original, tools, { recursive: true, verbatimSymlinks: true });
    fs.rmSync(path.join(tools, 'lib', 'x64'), { recursive: true, force: true });
    fs.mkdirSync(path.join(tools, 'lib', 'x64'));

    fs.rmSync(APPIMAGE, { force: true });
    const args = ['electron-builder', ...(config ? ['--config', config] : []), '--linux', 'AppImage'];
    execFileSync('npx', args, { cwd: LAUNCHER, stdio: 'inherit', env: { ...process.env, APPIMAGE_TOOLS_PATH: tools } });

    // What's really in the finished file.
    execFileSync(APPIMAGE, ['--appimage-extract'], { cwd: work, stdio: 'ignore' });
    const root = path.join(work, 'squashfs-root');
    const lib = path.join(root, 'usr', 'lib');
    const extras = fs.existsSync(lib) ? fs.readdirSync(lib) : [];
    if (extras.length) throw new Error(`Unexpected libraries in usr/lib: ${extras.join(', ')}`);
    for (const name of [...settings.linux.extraFiles.map(f => f.to), 'LICENSE.electron.txt', 'LICENSES.chromium.html']) {
      if (!fs.existsSync(path.join(root, name))) throw new Error(`${name} is missing from the AppImage`);
    }
    console.log(`\nChecked: licence files are inside, no extra libraries.\n  ${APPIMAGE}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exit(1); });
