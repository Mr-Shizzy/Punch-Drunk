'use strict';

// Renders build/icon.svg to build/icon.png and src/assets/icon.png (512x512), with Electron's own Chromium, so no
// image tools are needed. Run from launcher\: npx electron packaging/render_icon.js

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 500));
  const png = (await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })).resize({ width: 512, height: 512 }).toPNG();
  for (const out of [path.join(root, 'build', 'icon.png'), path.join(root, 'src', 'assets', 'icon.png')]) fs.writeFileSync(out, png);
  console.log('icon written');
  app.quit();
});
