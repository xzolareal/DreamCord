// Code commun au mode "patch Discord" (discord-patch.js) et au client autonome (index.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('./config');
const wallpaperServer = require('./wallpaper-server');

const electron = require('electron');

const state = { config: null, log: () => {} };

function getConfig() {
  if (!state.config || cfg.hasConfigChangedOnDisk()) {
    state.config = cfg.loadConfig();
  }
  return state.config;
}

function reloadConfig() {
  if (state.config && cfg.hasPendingSave()) return state.config;
  if (!state.config || cfg.hasConfigChangedOnDisk()) {
    state.config = cfg.loadConfig();
  }
  return state.config;
}

function setConfig(next) {
  if (!next || typeof next !== 'object') return;
  state.config = next;
  cfg.saveConfigSoon(next);
}

// ---- Validation URL Discord ----
function isDiscordUrl(url) {
  if (typeof url !== 'string' || !url.includes('discord')) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (!/(^|\.)discord(app)?\.com$/i.test(u.hostname)) return false;
    if (/^\/(overlay|popout|oauth2|billing|login\/handoff)/i.test(u.pathname || '/')) return false;
    return true;
  } catch {
    return false;
  }
}

// ---- Code du renderer : lu une seule fois (relu seulement s'il change) ----
const sourceCache = new Map();
function readRenderer(file) {
  const full = path.join(__dirname, '../renderer', file);
  try {
    const stat = fs.statSync(full);
    const hit = sourceCache.get(full);
    if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit.code;
    const code = fs.readFileSync(full, 'utf8');
    sourceCache.set(full, { mtime: stat.mtimeMs, size: stat.size, code });
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

// Préchauffage non-bloquant au démarrage : zéro latence disque au moment du dom-ready.
function warmCache() {
  try {
    const config = getConfig();
    readRenderer('splash.js');
    readRenderer('dreamcord-core.js');
    cfg.loadUserThemes();
    if (config.wallpaper?.enabled && config.wallpaper?.source === 'file' && config.wallpaper?.filePath) {
      resolveWallpaperUrl(config).catch(() => {});
    }
  } catch {}
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

// ---- Fenêtre (Windows DWM / opacité / icône / badge) ----
const WIN_BUILD = (() => {
  if (process.platform !== 'win32') return 0;
  const parts = String(os.release() || '').split('.');
  return parseInt(parts[2], 10) || 0;
})();

const VALID_MATERIALS = new Set(['none', 'mica', 'acrylic', 'tabbed']);
const windowMaterials = new WeakMap();
const backgroundManagedWindows = new WeakSet();

function resolveSupportedMaterial(material) {
  if (process.platform !== 'win32') return 'none';
  const target = VALID_MATERIALS.has(material) ? material : 'none';
  if (target === 'none') return 'none';
  // DWMWA_SYSTEMBACKDROP_TYPE (mica / tabbed / acrylic natif) nécessite Windows 11 22H2 (build 22621+)
  if (WIN_BUILD > 0 && WIN_BUILD < 22621) return 'none';
  return target;
}

function applyWindowMaterial(win, material, withBackground = false) {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return;
  if (withBackground) backgroundManagedWindows.add(win);

  const target = resolveSupportedMaterial(material);
  const prev = windowMaterials.get(win) || 'none';
  if (prev === target) return;
  if (typeof win.setBackgroundMaterial !== 'function') return;

  try {
    win.setBackgroundMaterial(target);
    windowMaterials.set(win, target);
    if (withBackground || backgroundManagedWindows.has(win) || target !== 'none' || prev !== 'none') {
      win.setBackgroundColor(target === 'none' ? '#09090b' : '#00000000');
    }
  } catch (err) {
    state.log('Matériau fenêtre: ' + err.message);
  }
}

function applyWindowOpacity(win, value) {
  if (!win || win.isDestroyed() || typeof win.setOpacity !== 'function') return;
  const n = Number(value);
  const target = Math.min(1, Math.max(0.3, Number.isFinite(n) ? n : 1));
  try {
    if (typeof win.getOpacity === 'function' && Math.abs(win.getOpacity() - target) < 0.002) return;
    win.setOpacity(target);
  } catch (err) {
    state.log('Opacité fenêtre: ' + err.message);
  }
}

function writeIcoFromImage(img, outPath) {
  const sizes = [256, 64, 48, 32, 16];
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const hdrSize = 6 + sizes.length * 16;
  const hdr = Buffer.alloc(hdrSize);
  hdr.writeUInt16LE(0, 0);
  hdr.writeUInt16LE(1, 2);
  hdr.writeUInt16LE(sizes.length, 4);
  let offset = hdrSize;
  sizes.forEach((s, i) => {
    const pos = 6 + i * 16;
    const len = pngs[i].length;
    hdr.writeUInt8(s >= 256 ? 0 : s, pos);
    hdr.writeUInt8(s >= 256 ? 0 : s, pos + 1);
    hdr.writeUInt8(0, pos + 2);
    hdr.writeUInt8(0, pos + 3);
    hdr.writeUInt16LE(1, pos + 4);
    hdr.writeUInt16LE(32, pos + 6);
    hdr.writeUInt32LE(len, pos + 8);
    hdr.writeUInt32LE(offset, pos + 12);
    offset += len;
  });
  const buf = Buffer.concat([hdr, ...pngs]);
  const tmpPath = `${outPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, outPath);
  } catch {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    fs.writeFileSync(outPath, buf);
  }
}

function updateShortcutsIcon(icoPath) {
  if (process.platform !== 'win32' || !icoPath) return;
  try {
    const { execFile } = require('child_process');
    const safeIco = icoPath.replace(/'/g, "''");
    const ps = [
      "$ws = New-Object -ComObject WScript.Shell;",
      "$paths = @(",
      "  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Discord.lnk'),",
      "  (Join-Path $env:PUBLIC 'Desktop\\Discord.lnk'),",
      "  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Discord.lnk'),",
      "  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Discord Inc\\Discord.lnk'),",
      "  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\Discord.lnk')",
      ");",
      "$imp = Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\ImplicitAppShortcuts';",
      "if (Test-Path $imp) { $paths += (Get-ChildItem $imp -Filter '*Discord*.lnk' -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName) }",
      `foreach ($p in $paths) { if (Test-Path $p) { $s = $ws.CreateShortcut($p); $s.IconLocation = '${safeIco},0'; $s.Save(); } }`,
      "Add-Type -Namespace Win32 -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int e, int f, System.IntPtr d1, System.IntPtr d2);';",
      "[Win32.Native]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero);"
    ].join(' ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps],
      { windowsHide: true, timeout: 15000 },
      () => {}
    );
  } catch {}
}

const iconCache = new Map();
function loadCachedIcon(iconPath) {
  const { nativeImage } = electron;
  if (!nativeImage?.createFromPath) return null;
  let mtime = 0;
  try {
    mtime = fs.statSync(iconPath).mtimeMs;
  } catch {
    return null;
  }
  const hit = iconCache.get(iconPath);
  if (hit && hit.mtime === mtime) return hit;
  const img = nativeImage.createFromPath(iconPath);
  if (!img || img.isEmpty()) return null;
  const resized = img.resize({ width: 256, height: 256, quality: 'best' });
  const entry = { mtime, img, resized };
  if (iconCache.size >= 16) iconCache.clear();
  iconCache.set(iconPath, entry);
  return entry;
}

function applyWindowIcon(win, iconPath, updateShortcuts = false) {
  const { nativeImage, BrowserWindow } = electron;
  const wins = BrowserWindow?.getAllWindows ? BrowserWindow.getAllWindows() : win ? [win] : [];
  const setAll = (icon) => {
    for (const w of wins) {
      if (w && !w.isDestroyed() && typeof w.setIcon === 'function') w.setIcon(icon);
    }
  };
  try {
    if (iconPath && fs.existsSync(iconPath)) {
      const isIco = /\.ico$/i.test(iconPath);
      if (isIco && process.platform === 'win32') {
        // Passer le chemin .ico natif préserve toutes les résolutions 16/32/48/256px sous Windows
        setAll(iconPath);
        if (updateShortcuts) updateShortcutsIcon(iconPath);
        return;
      }
      const loaded = loadCachedIcon(iconPath);
      if (loaded) {
        setAll(loaded.resized);
        if (updateShortcuts && process.platform === 'win32') {
          cfg.ensureDirectories();
          const icoTarget = path.join(cfg.getPaths().userData, 'custom-icon.ico');
          writeIcoFromImage(loaded.img, icoTarget);
          updateShortcutsIcon(icoTarget);
        }
        return;
      }
      setAll(iconPath);
      if (updateShortcuts && isIco) updateShortcutsIcon(iconPath);
      return;
    }

    const bundledIco = path.join(__dirname, '../../assets/icon.ico');
    const bundledPng = path.join(__dirname, '../../assets/icon.png');
    const defaultIco = path.join(path.dirname(process.execPath), 'app.ico');
    if (fs.existsSync(bundledIco)) {
      setAll(bundledIco);
      if (updateShortcuts) updateShortcutsIcon(bundledIco);
    } else if (fs.existsSync(bundledPng)) {
      const loaded = loadCachedIcon(bundledPng);
      if (loaded) setAll(loaded.resized);
    } else if (fs.existsSync(defaultIco)) {
      setAll(defaultIco);
      if (updateShortcuts) updateShortcutsIcon(defaultIco);
    } else if (nativeImage?.createFromPath) {
      const exeImg = nativeImage.createFromPath(process.execPath);
      if (exeImg && !exeImg.isEmpty()) setAll(exeImg);
      if (updateShortcuts) updateShortcutsIcon(process.execPath);
    }
  } catch (err) {
    state.log('Icône fenêtre: ' + err.message);
  }
}

// ---- Badge de la barre des tâches (Windows) ----
let protoOverlayHooked = false;
let origSetOverlayIcon = null;
const lastOverlay = new WeakMap();

function installTaskbarBadgeHook() {
  if (protoOverlayHooked || process.platform !== 'win32') return;
  const { BrowserWindow } = electron;
  if (!BrowserWindow?.prototype?.setOverlayIcon) return;
  protoOverlayHooked = true;
  origSetOverlayIcon = BrowserWindow.prototype.setOverlayIcon;
  BrowserWindow.prototype.setOverlayIcon = function (overlay, desc) {
    if (typeof this.isDestroyed === 'function' && this.isDestroyed()) return;
    lastOverlay.set(this, overlay ? { overlay, desc: typeof desc === 'string' ? desc : '' } : null);
    try {
      if (getConfig().window?.hideTaskbarBadge) {
        return origSetOverlayIcon.call(this, null, '');
      }
      return origSetOverlayIcon.call(this, overlay, desc);
    } catch {}
  };
}

function applyTaskbarBadge(win, hide) {
  if (process.platform !== 'win32') return;
  installTaskbarBadgeHook();
  if (!win || win.isDestroyed()) return;
  try {
    const callNative = origSetOverlayIcon
      ? (overlay, desc) => origSetOverlayIcon.call(win, overlay, desc)
      : typeof win.setOverlayIcon === 'function'
        ? (overlay, desc) => win.setOverlayIcon(overlay, desc)
        : null;
    if (!callNative) return;
    if (hide) {
      callNative(null, '');
    } else {
      const saved = lastOverlay.get(win);
      if (saved && saved.overlay) callNative(saved.overlay, saved.desc);
    }
  } catch (err) {
    state.log('Badge barre des tâches: ' + err.message);
  }
}

async function pickIconFile(win) {
  const { dialog, nativeImage } = electron;
  if (!dialog) return null;
  const res = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
    title: 'Choisir une icône Discord',
    properties: ['openFile'],
    filters: [{ name: 'Icônes & Images', extensions: ['ico', 'png', 'jpg', 'jpeg', 'webp'] }]
  });
  if (res.canceled || !res.filePaths?.[0]) return null;
  const filePath = res.filePaths[0];
  let preview = '';
  try {
    const img = nativeImage?.createFromPath ? nativeImage.createFromPath(filePath) : null;
    if (img && !img.isEmpty()) preview = img.resize({ width: 128, height: 128, quality: 'best' }).toDataURL();
  } catch {}
  return { filePath, fileName: path.basename(filePath), preview };
}

// ---- Patch CSP (serveur local fond d'écran, traduction, Trusted Types) ----
const CSP_EXTRAS = {
  'img-src': ['http://127.0.0.1:*', 'https:', 'data:', 'blob:'],
  'media-src': ['http://127.0.0.1:*', 'https:', 'data:', 'blob:'],
  'connect-src': ['https://translate.googleapis.com', 'http://127.0.0.1:*'],
  'style-src': ["'unsafe-inline'"],
  'trusted-types': ['dreamcord-ui']
};

const cspMemo = new Map();

function patchCspValue(csp) {
  if (typeof csp !== 'string' || !csp) return csp;
  const cached = cspMemo.get(csp);
  if (cached !== undefined) return cached;

  const directives = csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  const seen = new Map();
  const updated = directives.map((dir) => {
    const parts = dir.split(/\s+/);
    const name = (parts[0] || '').toLowerCase();
    const tokens = parts.slice(1);
    seen.set(name, tokens);
    const add = CSP_EXTRAS[name];
    if (!add) return dir;
    if (name === 'trusted-types' && tokens.length === 1 && tokens[0].toLowerCase() === "'none'") {
      return `${parts[0]} ${add.join(' ')}`;
    }
    const existing = new Set(tokens);
    const missing = add.filter((v) => !existing.has(v));
    return missing.length ? `${dir} ${missing.join(' ')}` : dir;
  });

  // Si default-src est présent sans media-src / img-src, le navigateur bloque http://127.0.0.1:* par repli
  const defaultTokens = seen.get('default-src');
  if (defaultTokens) {
    for (const needed of ['img-src', 'media-src']) {
      if (!seen.has(needed)) {
        const merged = Array.from(new Set([...defaultTokens.filter((t) => t.toLowerCase() !== "'none'"), ...CSP_EXTRAS[needed]]));
        updated.push(`${needed} ${merged.join(' ')}`);
      }
    }
  }

  const result = updated.join('; ');
  if (cspMemo.size >= 64) cspMemo.clear();
  cspMemo.set(csp, result);
  return result;
}

function stripCsp(headers) {
  if (!headers) return headers;
  let hit = false;
  for (const k in headers) {
    const low = k.toLowerCase();
    if (low === 'content-security-policy' || low === 'content-security-policy-report-only') {
      hit = true;
      break;
    }
  }
  if (!hit) return headers;
  const out = {};
  for (const k in headers) {
    const low = k.toLowerCase();
    if (low === 'content-security-policy' || low === 'content-security-policy-report-only') {
      const val = headers[k];
      out[k] = Array.isArray(val) ? val.map(patchCspValue) : patchCspValue(val);
    } else {
      out[k] = headers[k];
    }
  }
  return out;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileMatchPattern(pattern) {
  const raw = String(pattern || '');
  if (raw === '<all_urls>') return /^(?:https?|wss?|ftp|file):\/\/.*/i;
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]+)(\/.*)?$/i.exec(raw);
  if (m) {
    const scheme = m[1] === '*' ? '(?:https?|wss?)' : escapeRegex(m[1]);
    let host;
    if (m[2] === '*') {
      host = '[^/]+';
    } else if (m[2].startsWith('*.')) {
      host = '(?:[^/]+\\.)?' + escapeRegex(m[2].slice(2)).replace(/\\\*/g, '[^/]*');
    } else {
      host = escapeRegex(m[2]).replace(/\\\*/g, '[^/]*');
    }
    const pathPart = m[3] ? escapeRegex(m[3]).replace(/\\\*/g, '.*') : '(?:\\/.*)?';
    try {
      return new RegExp(`^${scheme}:\\/\\/${host}${pathPart}$`, 'i');
    } catch {
      return null;
    }
  }
  const escaped = escapeRegex(raw).replace(/\\\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`, 'i');
  } catch {
    return null;
  }
}

function compileWebRequestFilter(filter) {
  if (!filter || typeof filter !== 'object') return null;
  const urls = Array.isArray(filter.urls) ? filter.urls.map(compileMatchPattern).filter(Boolean) : null;
  const types = Array.isArray(filter.types) && filter.types.length ? new Set(filter.types) : null;
  return (details) => {
    if (types && details.resourceType && !types.has(details.resourceType)) return false;
    if (urls && urls.length) {
      const url = details.url || '';
      if (!urls.some((re) => re.test(url))) return false;
    }
    return true;
  };
}

const cspHookedSessions = new WeakSet();

let capturedAuthHeader = '';

function installCspHook(ses) {
  if (!ses || !ses.webRequest || cspHookedSessions.has(ses)) return;
  cspHookedSessions.add(ses);

  // Capture passive en mémoire du header Authorization pour charger le catalogue Shop/Effets
  try {
    const origBefore = ses.webRequest.onBeforeSendHeaders.bind(ses.webRequest);
    const seenShopUrls = new Set();
    const captureAuth = (details, callback) => {
      try {
        if (details?.url?.includes('discord.com/api/') && details.requestHeaders) {
          const auth = details.requestHeaders.Authorization || details.requestHeaders.authorization;
          if (auth && !String(auth).startsWith('Bot ')) capturedAuthHeader = String(auth);
          if (/collectibles|\/shop|profile-frame/i.test(details.url) && !seenShopUrls.has(details.url)) {
            seenShopUrls.add(details.url);
            state.log(`[ShopURL] ${details.url}`);
          }
        }
      } catch {}
      return callback({});
    };
    origBefore({ urls: ['https://*.discord.com/api/*', 'https://discord.com/api/*'] }, captureAuth);
    ses.webRequest.onBeforeSendHeaders = function (arg1, arg2) {
      const hasFilter = typeof arg1 !== 'function' && arg1 !== null && arg1 !== undefined;
      const listener = hasFilter ? arg2 : arg1;
      if (typeof listener !== 'function') return origBefore(captureAuth);
      const matcher = hasFilter ? compileWebRequestFilter(arg1) : null;
      const wrapped = (details, callback) => {
        try {
          if (details?.url?.includes('discord.com/api/') && details.requestHeaders) {
            const auth = details.requestHeaders.Authorization || details.requestHeaders.authorization;
            if (auth && !String(auth).startsWith('Bot ')) capturedAuthHeader = String(auth);
          }
        } catch {}
        if (matcher && !matcher(details)) return callback({});
        return listener(details, callback);
      };
      return origBefore(wrapped);
    };
  } catch {}

  const orig = ses.webRequest.onHeadersReceived.bind(ses.webRequest);
  const stripOnly = (details, callback) => {
    const patched = stripCsp(details.responseHeaders);
    if (patched !== details.responseHeaders) return callback({ responseHeaders: patched });
    return callback({});
  };

  orig(stripOnly);

  ses.webRequest.onHeadersReceived = function (arg1, arg2) {
    const hasFilter = typeof arg1 !== 'function' && arg1 !== null && arg1 !== undefined;
    const listener = hasFilter ? arg2 : arg1;
    if (typeof listener !== 'function') {
      // Si Discord désenregistre son écouteur, on conserve notre patch CSP
      return orig(stripOnly);
    }
    const matcher = hasFilter ? compileWebRequestFilter(arg1) : null;
    const wrapped = (details, callback) => {
      if (matcher && !matcher(details)) {
        return stripOnly(details, callback);
      }
      return listener(details, (res) => {
        if (res && res.cancel) return callback(res);
        const baseHeaders = res && res.responseHeaders ? res.responseHeaders : details.responseHeaders;
        const patched = stripCsp(baseHeaders);
        if (patched !== baseHeaders) {
          return callback({ ...(res || {}), responseHeaders: patched });
        }
        return callback(res || {});
      });
    };
    return orig(wrapped);
  };
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
      if (alive) {
        applyWindowMaterial(win, fresh.window.material);
        applyWindowOpacity(win, 1);
        try {
          win.setAlwaysOnTop(false);
        } catch {}
        applyWindowIcon(win, '', true);
        const wins = electron.BrowserWindow?.getAllWindows ? electron.BrowserWindow.getAllWindows() : [win];
        for (const bw of wins) applyTaskbarBadge(bw, false);
      }
      break;
    }
    case 'set-material': {
      const c = getConfig();
      const w = c.window || (c.window = {});
      w.material = data;
      cfg.saveConfigSoon(c);
      applyWindowMaterial(win, data);
      break;
    }
    case 'set-icon': {
      const c = getConfig();
      const w = c.window || (c.window = {});
      w.iconPath = typeof data === 'string' ? data : '';
      if (!w.iconPath) w.iconPreview = '';
      cfg.saveConfigSoon(c);
      if (alive) applyWindowIcon(win, w.iconPath, true);
      break;
    }
    case 'hide-taskbar-badge': {
      const c = getConfig();
      const w = c.window || (c.window = {});
      w.hideTaskbarBadge = Boolean(data);
      cfg.saveConfigSoon(c);
      const wins = electron.BrowserWindow?.getAllWindows ? electron.BrowserWindow.getAllWindows() : alive ? [win] : [];
      for (const bw of wins) applyTaskbarBadge(bw, w.hideTaskbarBadge);
      break;
    }
    case 'always-on-top':
      if (alive) {
        try {
          win.setAlwaysOnTop(Boolean(data), 'floating');
        } catch {}
      }
      break;
    case 'window-opacity':
      if (alive) applyWindowOpacity(win, data);
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
    case 'relaunch':
      try {
        electron.app.relaunch();
        electron.app.exit(0);
      } catch {}
      break;
  }
}

let ipcRegistered = false;

function registerIpc() {
  const { ipcMain, BrowserWindow } = electron;
  if (!ipcMain || ipcRegistered) return;
  ipcRegistered = true;

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
  handle('dreamcord:wallpaper-url', (_e, filePath) => {
    const configured = getConfig().wallpaper?.filePath;
    if (configured && filePath && path.resolve(String(filePath)) === path.resolve(String(configured))) {
      wallpaperServer.allow(filePath);
    }
    return wallpaperServer.serveFile(filePath);
  });
  handle('dreamcord:pick-icon', (e) => pickIconFile(BrowserWindow.fromWebContents(e.sender)));
  handle('dreamcord:get-collectibles', async (_e, fallbackToken) => {
    const authHeader = capturedAuthHeader || (fallbackToken ? String(fallbackToken).trim() : '');
    if (!authHeader) return { ok: false, error: 'no-auth', effects: [], categories: [] };
    const fetchJson = async (url) => {
      const fn = electron.net?.fetch || globalThis.fetch;
      const res = await fn(url, { headers: { Authorization: authHeader } });
      if (!res.ok) return null;
      return res.json();
    };
    const [effRes, catRes, catV2Res, shopHome, shopTabPf, shopPf, searchPf, frameRes, purchRes] = await Promise.all([
      fetchJson('https://discord.com/api/v9/user-profile-effects').catch(() => null),
      fetchJson('https://discord.com/api/v9/collectibles-categories?include_bundles=true&variants_return_style=2').catch(() => null)
        .then((r) => r || fetchJson('https://discord.com/api/v9/collectibles-categories?include_bundles=true').catch(() => null)),
      fetchJson('https://discord.com/api/v9/collectibles-categories/v2?include_bundles=true&include_dynamic_blocks=true&variants_return_style=2').catch(() => null),
      fetchJson('https://discord.com/api/v9/collectibles-shop?include_bundles=true&variants_return_style=2').catch(() => null),
      fetchJson('https://discord.com/api/v9/collectibles-shop?tab=profile-frames').catch(() => null),
      fetchJson('https://discord.com/api/v9/collectibles-shop?item_types=PROFILE_FRAME&limit=100').catch(() => null),
      fetchJson('https://discord.com/api/v9/shop/search?item_types=PROFILE_FRAME&limit=100').catch(() => null),
      fetchJson('https://discord.com/api/v9/user-profile-frames').catch(() => null),
      fetchJson('https://discord.com/api/v9/users/@me/collectibles-purchases').catch(() => null)
    ]);
    const effects = effRes?.profile_effect_configs || (Array.isArray(effRes) ? effRes : []);
    const categories = [];
    const pushCats = (src) => {
      if (!src) return;
      if (Array.isArray(src)) {
        categories.push(...src);
        return;
      }
      if (Array.isArray(src.categories)) categories.push(...src.categories);
      if (Array.isArray(src.products)) categories.push({ products: src.products });
      if (Array.isArray(src.results)) categories.push({ products: src.results });
      for (const arr of [src.shop_blocks, src.blocks, src.cards, src.shop_home_sections]) {
        if (!Array.isArray(arr)) continue;
        for (const blk of arr) {
          if (Array.isArray(blk?.products)) categories.push({ products: blk.products });
          if (Array.isArray(blk?.categories)) categories.push(...blk.categories);
          if (Array.isArray(blk?.items)) categories.push({ products: blk.items });
          if (Array.isArray(blk?.cards)) categories.push({ products: blk.cards });
        }
      }
    };
    pushCats(catRes);
    pushCats(catV2Res);
    pushCats(shopHome);
    pushCats(shopTabPf);
    pushCats(shopPf);
    pushCats(searchPf);
    pushCats(purchRes);
    const frames = frameRes?.profile_frame_configs || (Array.isArray(frameRes) ? frameRes : []);
    state.log(
      `[Collectibles] eff=${effects.length} cats=${categories.length} framesApi=${frames.length}` +
      ` shopTabPf=${shopTabPf ? Object.keys(shopTabPf).join(',') : 'null'}` +
      ` shopHome=${shopHome ? Object.keys(shopHome).join(',') : 'null'}` +
      ` searchPf=${searchPf ? Object.keys(searchPf).join(',') : 'null'}`
    );
    return { ok: true, effects, categories, frames };
  });
  ipcMain.removeAllListeners('dreamcord:cmd');
  ipcMain.on('dreamcord:cmd', (e, cmd, data) => runCommand(BrowserWindow.fromWebContents(e.sender), cmd, data));
}

module.exports = {
  state,
  getConfig,
  reloadConfig,
  setConfig,
  isDiscordUrl,
  warmCache,
  buildPayload,
  resolveSupportedMaterial,
  applyWindowMaterial,
  applyWindowOpacity,
  applyWindowIcon,
  installTaskbarBadgeHook,
  applyTaskbarBadge,
  pickIconFile,
  stripCsp,
  installCspHook,
  runCommand,
  registerIpc,
  flushConfig: cfg.flushConfig,
  closeWallpaperServer: wallpaperServer.closeServer
};
