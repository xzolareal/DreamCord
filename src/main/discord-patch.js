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
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch {}
}
common.state.log = logPatch;

try {
  ensureDirectories();
  fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] DreamCord chargé\n`, 'utf8');
} catch {}

const patchedWindows = new WeakSet();
const patchedSessions = new WeakSet();
const injected = new WeakSet(); // webContents déjà injectés pour la page courante
const injecting = new WeakSet();

function isDiscordUrl(url) {
  if (typeof url !== 'string' || !url.includes('discord.com')) return false;
  try {
    const u = new URL(url);
    if (!/(^|\.)discord(app)?\.com$/i.test(u.hostname)) return false;
    if (/^\/(overlay|popout|oauth2)/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function setupSessionHooks(ses) {
  if (!ses || patchedSessions.has(ses)) return;
  patchedSessions.add(ses);

  // 1) Script preload (écran de chargement immédiat + pont IPC)
  try {
    const preloadPath = path.resolve(__dirname, '../preload/index.js');
    if (typeof ses.registerPreloadScript === 'function') {
      ses.registerPreloadScript({ id: 'dreamcord-preload', type: 'frame', filePath: preloadPath });
    } else if (typeof ses.setPreloads === 'function') {
      const existing = ses.getPreloads ? ses.getPreloads() : [];
      if (!existing.includes(preloadPath)) ses.setPreloads([...existing, preloadPath]);
    }
  } catch (err) {
    logPatch('Preload: ' + err.message);
  }

  // 2) Suppression de la CSP (nécessaire pour le serveur local du fond d'écran),
  //    même si Discord remplace ensuite son propre écouteur.
  try {
    const orig = ses.webRequest.onHeadersReceived.bind(ses.webRequest);
    orig((details, callback) => callback({ responseHeaders: common.stripCsp(details.responseHeaders) }));

    ses.webRequest.onHeadersReceived = function (arg1, arg2) {
      const hasFilter = typeof arg1 !== 'function' && arg1 !== null;
      const listener = hasFilter ? arg2 : arg1;
      if (!listener) return hasFilter ? orig(arg1, null) : orig(null);
      const wrapped = (details, callback) =>
        listener(details, (res) => {
          if (res && res.responseHeaders) res = { ...res, responseHeaders: common.stripCsp(res.responseHeaders) };
          callback(res);
        });
      return hasFilter ? orig(arg1, wrapped) : orig(wrapped);
    };
  } catch (err) {
    logPatch('Hooks CSP: ' + err.message);
  }
}

async function injectIntoWindow(win, consoleHandler) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!isDiscordUrl(wc.getURL()) || injected.has(wc) || injecting.has(wc)) return;
  injecting.add(wc);
  try {
    const payload = await common.buildPayload();
    if (win.isDestroyed()) return;
    await wc.executeJavaScript(payload, true);
    injected.add(wc);

    const config = common.getConfig();
    if (config.window?.material && config.window.material !== 'none') {
      common.applyWindowMaterial(win, config.window.material);
    }
    if (!config.plugins?.['window-opacity']) {
      try { win.setOpacity(1); } catch {}
    }
    // Si le pont natif (preload) fonctionne, on n'écoute plus la console de Discord.
    if (consoleHandler) {
      const native = await wc.executeJavaScript('Boolean(window.DreamCordNative)', true).catch(() => false);
      if (native) wc.removeListener('console-message', consoleHandler);
    }
  } catch (err) {
    logPatch('Injection: ' + (err?.stack || err?.message || err));
  } finally {
    injecting.delete(wc);
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
      else if (cmd === 'wallpaper-url') wallpaperServer.serveFile(data).then(reply, () => reply(null));
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

  const consoleHandler = makeConsoleHandler(win);
  wc.on('console-message', consoleHandler);

  wc.on('did-start-loading', () => injected.delete(wc));
  // dom-ready = le plus tôt possible (fond + thème visibles vite) ; did-finish-load = filet de sécurité
  wc.on('dom-ready', () => injectIntoWindow(win, consoleHandler));
  wc.on('did-finish-load', () => injectIntoWindow(win, consoleHandler));

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isF9 = input.key === 'F9' && !input.control && !input.alt && !input.shift;
    const isCtrlAltD = input.control && input.alt && !input.shift && input.key.toLowerCase() === 'd';
    if (!isF9 && !isCtrlAltD) return;
    if (!isDiscordUrl(wc.getURL())) return;
    event.preventDefault();
    wc.executeJavaScript('window.__DREAMCORD_TOGGLE_STUDIO__&&window.__DREAMCORD_TOGGLE_STUDIO__()', true).catch(() => {});
  });
}

if (app) {
  common.registerIpc();

  app.on('session-created', setupSessionHooks);
  app.on('browser-window-created', (_e, win) => attachWindowHooks(win));
  app.on('before-quit', () => common.flushConfig());

  app.whenReady().then(() => {
    try {
      common.registerIpc();
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
