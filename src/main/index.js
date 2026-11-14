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
} else {
  // Rendu GPU plus fluide pour la vidéo de fond
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function getIconPath() {
  const p = path.join(__dirname, '../../assets/icon.png');
  return fs.existsSync(p) ? p : null;
}

function setupNetworkHooks() {
  const ses = session.defaultSession;

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: common.stripCsp(details.responseHeaders) });
  });

  const TELEMETRY = ['/api/v9/science', '/api/v10/science', '/api/v9/metrics', '/api/v10/metrics', 'sentry.io'];
  ses.webRequest.onBeforeRequest({ urls: ['*://*.discord.com/*', '*://*.sentry.io/*'] }, (details, callback) => {
    if (common.getConfig().plugins?.['no-telemetry']) {
      const url = details.url.toLowerCase();
      if (TELEMETRY.some((t) => url.includes(t))) return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'mediaKeySystem', 'notifications', 'fullscreen', 'clipboard-read', 'display-capture'].includes(permission));
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
  tray = new Tray(iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.setToolTip('DreamCord');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Afficher DreamCord', click: () => mainWindow && (mainWindow.show(), mainWindow.focus()) },
      {
        label: 'Réglages (F9)',
        click: () => {
          if (!mainWindow) return;
          mainWindow.show();
          mainWindow.webContents.executeJavaScript('window.__DREAMCORD_TOGGLE_STUDIO__&&window.__DREAMCORD_TOGGLE_STUDIO__()', true).catch(() => {});
        }
      },
      { type: 'separator' },
      { label: 'Quitter', click: () => ((isQuitting = true), app.quit()) }
    ])
  );
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.focus();
    else mainWindow.show();
  });
}

function createWindow() {
  ensureDirectories();
  const cfg = common.getConfig();
  const material = cfg.window.material || 'none';

  mainWindow = new BrowserWindow({
    width: cfg.window.width || 1320,
    height: cfg.window.height || 840,
    minWidth: 940,
    minHeight: 600,
    title: 'DreamCord',
    icon: getIconPath() || undefined,
    show: false,
    backgroundColor: material === 'none' ? '#05050a' : '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e4e4e7', height: 32 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });
  const wc = mainWindow.webContents;
  common.applyWindowMaterial(mainWindow, material, true);

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(ptb\.|canary\.)?discord\.com/.test(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isF9 = input.key === 'F9' && !input.control && !input.alt && !input.shift;
    const isCtrlAltD = input.control && input.alt && !input.shift && input.key.toLowerCase() === 'd';
    const isDevTools = input.control && input.shift && input.key.toLowerCase() === 'i';
    if (isF9 || isCtrlAltD) {
      event.preventDefault();
      wc.executeJavaScript('window.__DREAMCORD_TOGGLE_STUDIO__&&window.__DREAMCORD_TOGGLE_STUDIO__()', true).catch(() => {});
    } else if (isDevTools) {
      event.preventDefault();
      wc.toggleDevTools();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!cfg.window.startMinimized) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  let injected = false;
  const inject = async () => {
    if (injected || mainWindow.isDestroyed()) return;
    injected = true;
    try {
      await wc.executeJavaScript(await common.buildPayload(), true);
    } catch (err) {
      injected = false;
      console.error('[DreamCord] Injection:', err);
    }
  };
  wc.on('did-start-loading', () => (injected = false));
  wc.on('dom-ready', inject);
  wc.on('did-finish-load', inject);
  wc.on('did-fail-load', (_e, code, desc, url) => console.error('[DreamCord] Échec chargement:', code, desc, url));

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

  mainWindow.loadURL('https://discord.com/app');
}

app.whenReady().then(() => {
  try {
    injectBranch('stable'); // injection automatique dans le Discord officiel s'il est installé
  } catch {}
  setupNetworkHooks();
  common.registerIpc();
  createTray();
  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  common.flushConfig();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
