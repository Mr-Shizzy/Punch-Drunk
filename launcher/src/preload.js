'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = channel => callback => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('launcher', {
  state: () => ipcRenderer.invoke('state'),
  checkTools: () => ipcRenderer.invoke('check-tools'),
  installTools: () => ipcRenderer.invoke('install-tools'),
  chooseDisc: () => ipcRenderer.invoke('choose-disc'),
  chooseDiscFolder: () => ipcRenderer.invoke('choose-disc-folder'),
  selectGame: game => ipcRenderer.invoke('select-game', game),
  chooseDocWad: () => ipcRenderer.invoke('choose-doc-wad'),
  unpackDocKeyFile: () => ipcRenderer.invoke('unpack-doc-keyfile'),
  unpackDocKey: text => ipcRenderer.invoke('unpack-doc-key', text),
  chooseFolder: which => ipcRenderer.invoke('choose-folder', which),
  choosePatchFile: () => ipcRenderer.invoke('choose-patch-file'),
  build: () => ipcRenderer.invoke('build'),
  play: () => ipcRenderer.invoke('play'),
  stop: () => ipcRenderer.invoke('stop'),
  saveSettings: settings => ipcRenderer.invoke('save-settings', settings),
  openFolder: which => ipcRenderer.invoke('open-folder', which),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  copyLog: () => ipcRenderer.invoke('copy-log'),
  copyText: text => ipcRenderer.invoke('copy-text', text),
  window: action => ipcRenderer.invoke('window', action),
  onLog: on('log'),
  onTask: on('task'),
  onStateChanged: on('state-changed')
});
