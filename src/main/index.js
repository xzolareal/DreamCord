// Client autonome : npm start
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session, shell, Tray, Menu, nativeImage, desktopCapturer } = require('electron');
const common = require('./common');
const { ensureDirectories, saveConfigSoon } = require('./config');
const { injectBranch } = require('./injector');

app.setName('DreamCord');

let mainWindow = null;
let tray = null;
let isQuitting = false;
const config = common.getConfig();

if (config.window.hardwareAcceleration === false) {
  app.disableHardwareAcceleration();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function getIconPath() {
  const custom = common.getConfig().window?.iconPath;
  if (custom && fs.existsSync(custom)) return custom;
  const p = path.join(__dirname, '../../assets/icon.png');
  return fs.existsSync(p) ? p : null;
}

function showAndFocusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function setupNetworkHooks() {
  const ses = session.defaultSession;

  common.installCspHook(ses);

  const TELEMETRY = ['/api/v9/science', '/api/v10/science', '/api/v9/metrics', '/api/v10/metrics', 'sentry.io'];
  ses.webRequest.onBeforeRequest({ urls: ['*://*.discord.com/*', '*://*.sentry.io/*'] }, (details, callback) => {
    if (common.getConfig().plugins?.['no-telemetry']) {
      const url = details.url.toLowerCase();
      if (TELEMETRY.some((t) => url.includes(t))) return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  const ALLOWED_PERMS = new Set([
    'media',
    'mediaKeySystem',
    'notifications',
    'fullscreen',
    'clipboard-read',
    'clipboard-sanitized-write',
    'display-capture'
  ]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMS.has(permission));
  });

  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      callback(sources.length ? { video: sources[0], audio: 'loopback' } : {});
    } catch {
      callback({});
    }
  });
}

function createTray() {
  const iconPath = getIconPath();
  const img = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(img && !img.isEmpty() ? img : nativeImage.createEmpty());
  tray.setToolTip('DreamCord');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Afficher DreamCord', click: showAndFocusWindow },
      {
        label: 'Réglages (F9)',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          showAndFocusWindow();
          mainWindow.webContents.executeJavaScript('window.__DREAMCORD_TOGGLE_STUDIO__&&window.__DREAMCORD_TOGGLE_STUDIO__()', true).catch(() => {});
        }
      },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('click', showAndFocusWindow);
}

function createWindow() {
  ensureDirectories();
  const cfg = common.getConfig();
  const supportedMaterial = common.resolveSupportedMaterial(cfg.window.material || 'none');

  mainWindow = new BrowserWindow({
    width: cfg.window.width || 1320,
    height: cfg.window.height || 840,
    minWidth: 940,
    minHeight: 600,
    title: 'DreamCord',
    icon: getIconPath() || undefined,
    show: false,
    backgroundColor: supportedMaterial === 'none' ? '#09090b' : '#00000000',
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { color: '#00000000', symbolColor: '#e4e4e7', height: 32 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });
  const wc = mainWindow.webContents;
  common.applyWindowMaterial(mainWindow, supportedMaterial, true);
  if (cfg.window.iconPath) {
    common.applyWindowIcon(mainWindow, cfg.window.iconPath);
  }
  common.applyTaskbarBadge(mainWindow, Boolean(cfg.window.hideTaskbarBadge));

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(ptb\.|canary\.)?discord(app)?\.com/i.test(url)) return { action: 'allow' };
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat || input.meta) return;
    const isF9 = input.key === 'F9' && !input.control && !input.alt && !input.shift;
    const isCtrlAltD = input.control && input.alt && !input.shift && input.key.toLowerCase() === 'd';
    const isDevTools = input.control && input.shift && !input.alt && input.key.toLowerCase() === 'i';
    if (isF9 || isCtrlAltD) {
      event.preventDefault();
      wc.executeJavaScript('window.__DREAMCORD_TOGGLE_STUDIO__&&window.__DREAMCORD_TOGGLE_STUDIO__()', true).catch(() => {});
    } else if (isDevTools) {
      event.preventDefault();
      wc.toggleDevTools();
    }
  });

  let shown = false;
  let showFallbackTimer = null;
  const revealWindow = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    if (showFallbackTimer) {
      clearTimeout(showFallbackTimer);
      showFallbackTimer = null;
    }
    if (!cfg.window.startMinimized) {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  mainWindow.once('ready-to-show', revealWindow);
  if (!cfg.window.startMinimized) {
    showFallbackTimer = setTimeout(revealWindow, 3000);
  }

  let navGen = 0;
  let injectedGen = -1;
  let injectingGen = -1;
  const inject = async () => {
    if (!mainWindow || mainWindow.isDestroyed() || wc.isDestroyed()) return;
    if (!common.isDiscordUrl(wc.getURL())) return;
    const gen = navGen;
    if (injectedGen === gen || injectingGen === gen) return;
    injectingGen = gen;
    try {
      const payload = await common.buildPayload();
      if (!mainWindow || mainWindow.isDestroyed() || wc.isDestroyed() || navGen !== gen) return;
      await wc.executeJavaScript(payload, true);
      if (navGen === gen) injectedGen = gen;
      if (!common.getConfig().plugins?.['window-opacity']) {
        common.applyWindowOpacity(mainWindow, 1);
      }
    } catch (err) {
      console.error('[DreamCord] Injection:', err);
    } finally {
      if (injectingGen === gen) injectingGen = -1;
    }
  };
  wc.on('did-start-loading', () => {
    navGen += 1;
  });
  wc.on('render-process-gone', () => {
    navGen += 1;
  });
  wc.on('dom-ready', inject);
  wc.on('did-finish-load', inject);
  wc.on('did-fail-load', (_e, code, desc, url) => {
    revealWindow();
    console.error('[DreamCord] Échec chargement:', code, desc, url);
  });

  // Taille de fenêtre : enregistrée une fois le redimensionnement terminé
  let resizeTimer = null;
  mainWindow.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
      const [width, height] = mainWindow.getSize();
      const c = common.getConfig();
      c.window.width = width;
      c.window.height = height;
      saveConfigSoon(c);
    }, 600);
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && common.getConfig().window.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    clearTimeout(resizeTimer);
    if (showFallbackTimer) clearTimeout(showFallbackTimer);
    mainWindow = null;
  });

  mainWindow.loadURL('https://discord.com/app');
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    common.warmCache();
    common.installTaskbarBadgeHook();
    setupNetworkHooks();
    common.registerIpc();
    createTray();
    createWindow();
    // Injection différée dans le Discord officiel pour ne pas ralentir l'ouverture de la fenêtre
    setTimeout(() => {
      try {
        injectBranch('stable');
      } catch {}
    }, 1500);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    common.flushConfig();
    common.closeWallpaperServer();
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
      tray = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
