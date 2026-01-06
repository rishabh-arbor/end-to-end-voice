/**
 * Electron preload script - exposes safe APIs to renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods to the page
contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  callGemini: (params) => ipcRenderer.invoke('call-gemini', params),
  onConfig: (callback) => ipcRenderer.on('config', (event, config) => callback(config))
});

console.log('[preload] API exposed to renderer');

