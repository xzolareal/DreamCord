// Code commun au mode "patch Discord" (discord-patch.js) et au client autonome (index.js).
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const wallpaperServer = require('./wallpaper-server');

const electron = require('electron');

const state = { config: null, log: () => {} };

function getConfig() {
  if (!state.config) state.config = cfg.loadConfig();
  return state.config;
}
function reloadConfig() {
  state.config = cfg.loadConfig();
  return state.config;
}
function setConfig(next) {
  if (!next || typeof next !== 'object') return;
  state.config = next;
  cfg.saveConfigSoon(next);
}

// ---- Code du renderer : lu une seule fois (relu seulement s'il change) ----
const sourceCache = new Map();
function readRenderer(file) {
  const full = path.join(__dirname, '../renderer', file);
  try {
    const mtime = fs.statSync(full).mtimeMs;
    const hit = sourceCache.get(full);
    if (hit && hit.mtime === mtime) return hit.code;
    const code = fs.readFileSync(full, 'utf8');
    sourceCache.set(full, { mtime, code });
    return code;
  } catch (err) {
    state.log('Lecture ' + file + ' impossible: ' + err.message);
    return '';
  }
}

async function resolveWallpaperUrl(config) {
  const wp = config.wallpaper;
  if (!wp || wp.source !== 'file' || !wp.filePath) return '';
  wallpaperServer.allow(wp.filePath); // fichier déjà choisi par l'utilisateur
  if (!wp.enabled) return '';
  try {
    return (await wallpaperServer.serveFile(wp.filePath)) || '';
  } catch (err) {
    state.log('Serveur fond: ' + err.message);
    return '';
  }
}

// Charge utile injectée dans la page : réglages + écran de chargement (secours) + cœur.
async function buildPayload() {
  const config = reloadConfig();
  const boot = {
    config,
    defaults: cfg.DEFAULT_CONFIG,
    wallpaperUrl: await resolveWallpaperUrl(config),
    themes: cfg.loadUserThemes()
  };
  return `window.__DREAMCORD_BOOT__=${JSON.stringify(boot)};\n${readRenderer('splash.js')}\n${readRenderer('dreamcord-core.js')}`;
}

// ---- Fenêtre ----
function applyWindowMaterial(win, material, withBackground = false) {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return;
  const valid = ['none', 'mica', 'acrylic', 'tabbed'];
  const target = valid.includes(material) ? material : 'none';
  try {
    win.setBackgroundMaterial(target);
    if (withBackground) win.setBackgroundColor(target === 'none' ? '#0b0b12' : '#00000000');
  } catch {}
}

function patchCspValue(csp) {
  if (typeof csp !== 'string' || !csp) return csp;
  const extras = {
    'img-src': ['http://127.0.0.1:*'],
    'media-src': ['http://127.0.0.1:*'],
    'connect-src': ['https://translate.googleapis.com'],
    'style-src': ["'unsafe-inline'"],
    'trusted-types': ['dreamcord-ui']
  };
  const directives = csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  const seen = new Set();
  const updated = directives.map((dir) => {
    const parts = dir.split(/\s+/);
    const name = (parts[0] || '').toLowerCase();
    seen.add(name);
    const add = extras[name];
    if (!add) return dir;
    const existing = new Set(parts.slice(1));
    const missing = add.filter((v) => !existing.has(v));
    return missing.length ? `${dir} ${missing.join(' ')}` : dir;
  });
  return updated.join('; ');
}

function stripCsp(headers) {
  if (!headers) return headers;
  let hit = false;
  for (const k in headers) {
    if (k.toLowerCase() === 'content-security-policy') {
      hit = true;
      break;
    }
  }
  if (!hit) return headers;
  const out = {};
  for (const k in headers) {
    if (k.toLowerCase() === 'content-security-policy') {
      const val = headers[k];
      out[k] = Array.isArray(val) ? val.map(patchCspValue) : patchCspValue(val);
    } else {
      out[k] = headers[k];
    }
  }
  return out;
}

// ---- Commandes envoyées par le renderer ----
function runCommand(win, cmd, data) {
  const alive = win && !win.isDestroyed();
  switch (cmd) {
    case 'log':
      state.log('[Renderer] ' + data);
      break;
    case 'save-config':
      setConfig(data);
      break;
    case 'reset-config': {
      const fresh = cfg.clone(cfg.DEFAULT_CONFIG);
      state.config = fresh;
      cfg.saveConfig(fresh);
      if (alive) applyWindowMaterial(win, fresh.window.material);
      break;
    }
    case 'set-material':
      getConfig().window.material = data;
      cfg.saveConfigSoon(getConfig());
      applyWindowMaterial(win, data);
      break;
    case 'always-on-top':
      if (alive) win.setAlwaysOnTop(Boolean(data), 'floating');
      break;
    case 'window-opacity':
      if (alive) win.setOpacity(Math.min(1, Math.max(0.3, Number(data) || 1)));
      break;
    case 'open-folder': {
      cfg.ensureDirectories();
      const p = cfg.getPaths();
      electron.shell.openPath(data === 'themes' ? p.themesDir : data === 'plugins' ? p.pluginsDir : p.userData);
      break;
    }
    case 'toggle-devtools':
      if (alive) win.webContents.toggleDevTools();
      break;
  }
}

function registerIpc() {
  const { ipcMain, BrowserWindow } = electron;
  if (!ipcMain) return;
  const handle = (channel, fn) => {
    try {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, fn);
    } catch (err) {
      state.log(`IPC ${channel}: ${err.message}`);
    }
  };
  handle('dreamcord:get-config', () => getConfig());
  handle('dreamcord:save-config', (_e, next) => {
    setConfig(next);
    return true;
  });
  handle('dreamcord:pick-wallpaper', (e) => wallpaperServer.pickFile(BrowserWindow.fromWebContents(e.sender)));
  handle('dreamcord:wallpaper-url', (_e, filePath) => wallpaperServer.serveFile(filePath));
  ipcMain.removeAllListeners('dreamcord:cmd');
  ipcMain.on('dreamcord:cmd', (e, cmd, data) => runCommand(BrowserWindow.fromWebContents(e.sender), cmd, data));
}

module.exports = {
  state,
  getConfig,
  reloadConfig,
  setConfig,
  buildPayload,
  applyWindowMaterial,
  stripCsp,
  runCommand,
  registerIpc,
  flushConfig: cfg.flushConfig
};
