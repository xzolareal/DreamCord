const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DreamCordNative', {
  getConfig: () => ipcRenderer.invoke('dreamcord:get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('dreamcord:save-config', cfg),
  pickWallpaper: () => ipcRenderer.invoke('dreamcord:pick-wallpaper'),
  getWallpaperUrl: (filePath) => ipcRenderer.invoke('dreamcord:wallpaper-url', filePath),
  send: (cmd, data) => ipcRenderer.send('dreamcord:cmd', cmd, data),
  onOpenStudio: (cb) => ipcRenderer.on('dreamcord:open-studio', () => cb())
});

// Écran de chargement : affiché dès le premier instant, uniquement sur la fenêtre principale Discord.
try {
  if (
    window.top === window &&
    !window.opener &&
    /(^|\.)discord(app)?\.com$/i.test(location.hostname) &&
    !/^\/(overlay|popout|oauth2|billing|login\/handoff)/i.test(location.pathname || '/')
  ) {
    require('../renderer/splash.js').start();
  }
} catch {
  // preload isolé (sandbox) : le cœur de DreamCord affichera l'écran de chargement à la place
}
