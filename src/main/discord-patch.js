// Chargé dans le processus principal de Discord (via injector.js).
const fs = require('fs');
const path = require('path');
const electron = require('electron');
const common = require('./common');
const { getPaths, ensureDirectories } = require('./config');
const wallpaperServer = require('./wallpaper-server');

const { app, BrowserWindow, session } = electron;

const LOG_FILE = path.join(getPaths().userData, 'patch.log');
function logPatch(msg) {
  try {
    fs.appendFile(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf8', () => {});
  } catch {}
}
common.state.log = logPatch;

try {
  ensureDirectories();
  fs.writeFile(LOG_FILE, `[${new Date().toISOString()}] DreamCord chargé\n`, 'utf8', () => {});
} catch {}

// Préchauffe la config + sources renderer + serveur fond d'écran avant le dom-ready
common.warmCache();
common.installTaskbarBadgeHook();

const patchedWindows = new WeakSet();
const patchedSessions = new WeakSet();
const injectedGen = new WeakMap(); // webContents -> dernière génération injectée
const injectingGen = new WeakMap(); // webContents -> génération en cours d'injection
const navGen = new WeakMap(); // webContents -> compteur de navigation courante
const consoleHandlers = new WeakMap(); // webContents -> listener console de secours

function getNavGen(wc) {
  return navGen.get(wc) || 0;
}

function bumpNavGen(wc) {
  const next = getNavGen(wc) + 1;
  navGen.set(wc, next);
  return next;
}

function setupSessionHooks(ses) {
  if (!ses || patchedSessions.has(ses)) return;
  patchedSessions.add(ses);

  // 1) Script preload (écran de chargement immédiat + pont IPC)
  try {
    const preloadPath = path.resolve(__dirname, '../preload/index.js');
    if (fs.existsSync(preloadPath)) {
      if (typeof ses.registerPreloadScript === 'function') {
        const already =
          typeof ses.getPreloadScripts === 'function' &&
          ses.getPreloadScripts().some((s) => s && (s.id === 'dreamcord-preload' || s.filePath === preloadPath));
        if (!already) {
          ses.registerPreloadScript({ id: 'dreamcord-preload', type: 'frame', filePath: preloadPath });
        }
      } else if (typeof ses.setPreloads === 'function') {
        const origSetPreloads = ses.setPreloads.bind(ses);
        const ensurePreload = (list) => {
          const arr = Array.isArray(list) ? list.slice() : [];
          if (!arr.includes(preloadPath)) arr.push(preloadPath);
          return origSetPreloads(arr);
        };
        const existing = ses.getPreloads ? ses.getPreloads() : [];
        ensurePreload(existing);
        // Empêche Discord d'écraser notre preload lors d'appels ultérieurs à setPreloads
        ses.setPreloads = (preloads) => ensurePreload(preloads);
      }
    }
  } catch (err) {
    logPatch('Preload: ' + err.message);
  }

  // 2) Patch CSP (serveur local fond d'écran, traduction, Trusted Types),
  //    même si Discord remplace/filtre ensuite son propre écouteur.
  try {
    common.installCspHook(ses);
  } catch (err) {
    logPatch('Hooks CSP: ' + err.message);
  }
}

async function injectIntoWindow(win) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;
  if (!common.isDiscordUrl(wc.getURL())) return;

  const gen = getNavGen(wc);
  if (injectedGen.get(wc) === gen || injectingGen.get(wc) === gen) return;
  injectingGen.set(wc, gen);

  try {
    const payload = await common.buildPayload();
    if (win.isDestroyed() || wc.isDestroyed() || getNavGen(wc) !== gen) return;

    const hasNative = await wc.executeJavaScript(`${payload}\nBoolean(window.DreamCordNative);`, true);
    if (win.isDestroyed() || wc.isDestroyed() || getNavGen(wc) !== gen) return;
    injectedGen.set(wc, gen);

    const config = common.getConfig();
    if (config.window?.material && config.window.material !== 'none') {
      common.applyWindowMaterial(win, config.window.material);
    }
    if (config.window?.iconPath) {
      common.applyWindowIcon(win, config.window.iconPath);
    }
    common.applyTaskbarBadge(win, Boolean(config.window?.hideTaskbarBadge));
    if (!config.plugins?.['window-opacity']) {
      common.applyWindowOpacity(win, 1);
    }

    // Si le pont natif (preload) fonctionne, on retire le pont console de secours (zéro overhead)
    if (hasNative) {
      const handler = consoleHandlers.get(wc);
      if (handler) {
        wc.removeListener('console-message', handler);
        consoleHandlers.delete(wc);
      }
    }
  } catch (err) {
    logPatch('Injection: ' + (err?.stack || err?.message || err));
  } finally {
    if (injectingGen.get(wc) === gen) injectingGen.delete(wc);
  }
}

// Pont de secours (si le preload n'a pas pu être enregistré) : messages console
function makeConsoleHandler(win) {
  const PREFIX = '__DREAMCORD_IPC__:';
  const wc = win.webContents;
  return (event, _level, legacyMessage) => {
    const msg = typeof event?.message === 'string' ? event.message : typeof legacyMessage === 'string' ? legacyMessage : '';
    if (msg.charCodeAt(0) !== 95 || !msg.startsWith(PREFIX)) return;
    try {
      const { cmd, data, id } = JSON.parse(msg.slice(PREFIX.length));
      const reply = (payload) => {
        if (id === undefined || id === null || wc.isDestroyed()) return;
        wc.executeJavaScript(`window.__DREAMCORD_REPLY__&&window.__DREAMCORD_REPLY__(${Number(id)},${JSON.stringify(payload ?? null)})`, true).catch(() => {});
      };
      if (cmd === 'pick-wallpaper') wallpaperServer.pickFile(win).then(reply, () => reply(null));
      else if (cmd === 'wallpaper-url') {
        const configured = common.getConfig().wallpaper?.filePath;
        if (configured && data && path.resolve(String(data)) === path.resolve(String(configured))) {
          wallpaperServer.allow(data);
        }
        wallpaperServer.serveFile(data).then(reply, () => reply(null));
      } else if (cmd === 'pick-icon') common.pickIconFile(win).then(reply, () => reply(null));
      else common.runCommand(win, cmd, data);
    } catch (err) {
      logPatch('Pont console: ' + err.message);
    }
  };
}

function attachWindowHooks(win) {
  if (!win || win.isDestroyed() || patchedWindows.has(win)) return;
  patchedWindows.add(win);
  const wc = win.webContents;
  if (!wc) return;

  setupSessionHooks(wc.session);

  if (common.getConfig().window?.hideTaskbarBadge) {
    common.applyTaskbarBadge(win, true);
  }

  win.on('enter-full-screen', () => {
    try {
      const mat = common.getConfig().window?.material;
      if (mat && mat !== 'none') common.applyWindowMaterial(win, 'none');
    } catch {}
  });
  win.on('leave-full-screen', () => {
    try {
      const mat = common.getConfig().window?.material;
      if (mat && mat !== 'none') setTimeout(() => !win.isDestroyed() && common.applyWindowMaterial(win, mat), 80);
    } catch {}
  });

  const consoleHandler = makeConsoleHandler(win);
  consoleHandlers.set(wc, consoleHandler);
  wc.on('console-message', consoleHandler);

  wc.on('did-start-loading', () => bumpNavGen(wc));
  wc.on('render-process-gone', () => bumpNavGen(wc));
  // dom-ready = le plus tôt possible (fond + thème visibles vite) ; did-finish-load = filet de sécurité
  wc.on('dom-ready', () => injectIntoWindow(win));
  wc.on('did-finish-load', () => injectIntoWindow(win));

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat || input.meta) return;
    const isF9 = input.key === 'F9' && !input.control && !input.alt && !input.shift;
    const isCtrlAltD = input.control && input.alt && !input.shift && input.key.toLowerCase() === 'd';
    if (!isF9 && !isCtrlAltD) return;
    if (!common.isDiscordUrl(wc.getURL())) return;
    event.preventDefault();
    wc.executeJavaScript('window.__DREAMCORD_TOGGLE_STUDIO__&&window.__DREAMCORD_TOGGLE_STUDIO__()', true).catch(() => {});
  });
}

if (app) {
  common.registerIpc();

  app.on('session-created', setupSessionHooks);
  app.on('browser-window-created', (_e, win) => attachWindowHooks(win));
  app.on('before-quit', () => {
    common.flushConfig();
    common.closeWallpaperServer();
  });

  app.whenReady().then(() => {
    try {
      common.registerIpc();
      common.installTaskbarBadgeHook();
      setupSessionHooks(session.defaultSession);
      for (const win of BrowserWindow.getAllWindows()) {
        attachWindowHooks(win);
        injectIntoWindow(win);
      }
    } catch (err) {
      logPatch('whenReady: ' + err.message);
    }
  });
}
