const fs = require('fs');
const path = require('path');
const os = require('os');

let electronApp = null;
try {
  const electron = require('electron');
  if (electron && typeof electron === 'object' && electron.app) electronApp = electron.app;
} catch {}

const CONFIG_VERSION = 3;

const DEFAULT_CONFIG = {
  configVersion: CONFIG_VERSION,
  lang: 'fr',
  window: {
    width: 1320,
    height: 840,
    material: 'none',
    iconPath: '',
    iconPreview: '',
    hideTaskbarBadge: false,
    minimizeToTray: true,
    hardwareAcceleration: true,
    startMinimized: false,
    showFloatingButton: true
  },
  appearance: {
    enabled: false,
    palette: 'default', // 'default' | 'carbone' | 'noir' | 'ocean' | 'violet' | 'discord'
    accentColor: '#ffffff',
    borderRadius: 8
  },
  // Fond d'écran animé (image, GIF ou vidéo) derrière Discord
  wallpaper: {
    enabled: false,
    source: 'file', // 'file' (fichier du PC) | 'url' (lien direct)
    filePath: '',
    fileName: '',
    url: '',
    brightness: 80, // % (10 - 200)
    opacity: 100, // % (0 - 100) opacité du fond
    uiOpacity: 70, // % (0 - 100) opacité des panneaux Discord
    blur: 0, // px (0 - 30)
    contrast: 100, // % (50 - 150)
    saturation: 100, // % (0 - 200)
    fit: 'cover', // 'cover' | 'contain' | 'fill'
    speed: 1, // vitesse de lecture vidéo (0.25 - 2)
    pauseMinimized: true,
    pauseUnfocused: false
  },
  customCss: '',
  plugins: {
    'message-logger': true,
    'translate': true,
    'view-raw': true,
    'exact-timestamps': false,
    'hide-typing': false,
    'no-telemetry': true,
    'call-timer': true,
    'privacy-blur': false,
    'declutter-ui': false,
    'server-cloner': true,
    'custom-friend': true,
    'fake-message-send': true,
    'clear-messages': true
  },
  pluginSettings: {
    'privacy-blur': { amount: 8 },
    'custom-friend': { users: {} }
  }
};

const clone = (obj) => JSON.parse(JSON.stringify(obj));

let cachedPaths = null;
let dirsEnsured = false;

function getPaths() {
  if (cachedPaths) return cachedPaths;
  const appData =
    process.env.APPDATA ||
    (electronApp && typeof electronApp.getPath === 'function'
      ? electronApp.getPath('appData')
      : path.join(os.homedir(), 'AppData', 'Roaming'));
  const userData = path.join(appData, 'DreamCord');
  cachedPaths = {
    userData,
    configFile: path.join(userData, 'dreamcord-config.json'),
    themesDir: path.join(userData, 'themes'),
    pluginsDir: path.join(userData, 'plugins')
  };
  return cachedPaths;
}

function ensureDirectories(force = false) {
  const paths = getPaths();
  if (dirsEnsured && !force) return paths;
  for (const dir of [paths.userData, paths.themesDir, paths.pluginsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  dirsEnsured = true;
  return paths;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge(target, source) {
  const output = { ...target };
  if (!source || typeof source !== 'object' || Array.isArray(source)) return output;
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      output[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      output[key] = sv;
    }
  }
  return output;
}

function migrateConfig(parsed) {
  // Ancienne config (v1/v2) : on repart des réglages simples en gardant
  // le strict nécessaire (CSS perso, couleur d'accent, plugins conservés).
  const fresh = clone(DEFAULT_CONFIG);
  try {
    if (parsed.window && typeof parsed.window === 'object') {
      for (const k of ['width', 'height', 'minimizeToTray', 'hardwareAcceleration', 'startMinimized', 'showFloatingButton']) {
        if (parsed.window[k] !== undefined) fresh.window[k] = parsed.window[k];
      }
    }
    if (parsed.appearance?.accentColor) fresh.appearance.accentColor = parsed.appearance.accentColor;
    if (typeof parsed.customCss === 'string' && !parsed.customCss.includes('DreamCord Pro - QuickCSS')) {
      fresh.customCss = parsed.customCss;
    }
    if (parsed.plugins && typeof parsed.plugins === 'object') {
      for (const id of Object.keys(fresh.plugins)) {
        if (typeof parsed.plugins[id] === 'boolean') fresh.plugins[id] = parsed.plugins[id];
      }
    }
  } catch {}
  return fresh;
}

let lastConfigMtime = 0;

function getConfigMtime() {
  try {
    return fs.statSync(getPaths().configFile).mtimeMs;
  } catch {
    return 0;
  }
}

function loadConfig() {
  const { configFile } = ensureDirectories();
  try {
    if (fs.existsSync(configFile)) {
      const stat = fs.statSync(configFile);
      const raw = fs.readFileSync(configFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.configVersion !== CONFIG_VERSION) {
          const migrated = migrateConfig(parsed);
          saveConfig(migrated);
          return migrated;
        }
        lastConfigMtime = stat.mtimeMs;
        return deepMerge(clone(DEFAULT_CONFIG), parsed);
      }
    }
  } catch (err) {
    console.error('[DreamCord] Erreur lecture config:', err);
  }
  const fresh = clone(DEFAULT_CONFIG);
  saveConfig(fresh);
  return fresh;
}

function writeFileAtomicSync(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

async function writeFileAtomicAsync(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  } catch {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {}
    await fs.promises.writeFile(filePath, content, 'utf8');
  }
}

let writeSeq = 0;
let pendingSaveTimer = null;
let pendingSaveConfig = null;
let inFlightConfig = null;
let asyncWriteInFlight = false;

function saveConfig(config) {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  pendingSaveConfig = null;
  inFlightConfig = null;
  asyncWriteInFlight = false;
  const { configFile } = ensureDirectories();
  writeSeq += 1;
  try {
    writeFileAtomicSync(configFile, JSON.stringify(config, null, 2));
    lastConfigMtime = getConfigMtime();
    return true;
  } catch (err) {
    console.error('[DreamCord] Erreur sauvegarde config:', err);
    return false;
  }
}

// Cache thèmes / plugins par fichier (mtime) pour éviter de relire le disque à chaque rechargement
const fileReadCache = new Map();
function readCachedText(fullPath) {
  const stat = fs.statSync(fullPath);
  const hit = fileReadCache.get(fullPath);
  if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit.content;
  const content = fs.readFileSync(fullPath, 'utf8');
  fileReadCache.set(fullPath, { mtime: stat.mtimeMs, size: stat.size, content });
  return content;
}

function loadUserPlugins() {
  const { pluginsDir } = ensureDirectories();
  const plugins = [];
  try {
    const files = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const fullPath = path.join(pluginsDir, file);
      plugins.push({ file, code: readCachedText(fullPath) });
    }
  } catch (err) {
    console.error('[DreamCord] Erreur lecture plugins:', err);
  }
  return plugins;
}

function loadUserThemes() {
  const { themesDir } = ensureDirectories();
  const themes = [];
  try {
    const files = fs.readdirSync(themesDir).filter((f) => f.endsWith('.css'));
    for (const file of files) {
      const fullPath = path.join(themesDir, file);
      themes.push({ file, css: readCachedText(fullPath) });
    }
  } catch (err) {
    console.error('[DreamCord] Erreur lecture themes:', err);
  }
  return themes;
}

function hasPendingSave() {
  return Boolean(pendingSaveTimer || pendingSaveConfig || asyncWriteInFlight);
}

function hasConfigChangedOnDisk() {
  if (hasPendingSave()) return false;
  const mtime = getConfigMtime();
  return mtime > 0 && mtime !== lastConfigMtime;
}

function saveConfigSoon(config) {
  pendingSaveConfig = config;
  if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
  pendingSaveTimer = setTimeout(() => {
    pendingSaveTimer = null;
    const cfgToSave = pendingSaveConfig;
    pendingSaveConfig = null;
    if (!cfgToSave) return;

    const seq = ++writeSeq;
    const { configFile } = ensureDirectories();
    let json;
    try {
      json = JSON.stringify(cfgToSave, null, 2);
    } catch (err) {
      console.error('[DreamCord] Erreur sérialisation config:', err);
      return;
    }

    inFlightConfig = cfgToSave;
    asyncWriteInFlight = true;
    writeFileAtomicAsync(configFile, json)
      .then(() => {
        if (seq === writeSeq) lastConfigMtime = getConfigMtime();
      })
      .catch((err) => {
        console.error('[DreamCord] Erreur sauvegarde config:', err);
      })
      .finally(() => {
        if (seq === writeSeq) {
          asyncWriteInFlight = false;
          inFlightConfig = null;
        }
      });
  }, 250);
}

function flushConfig() {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  const cfgToSave = pendingSaveConfig || inFlightConfig;
  pendingSaveConfig = null;
  inFlightConfig = null;
  if (cfgToSave) {
    saveConfig(cfgToSave);
  }
}

module.exports = {
  DEFAULT_CONFIG,
  getPaths,
  ensureDirectories,
  loadConfig,
  saveConfig,
  saveConfigSoon,
  flushConfig,
  hasPendingSave,
  hasConfigChangedOnDisk,
  clone,
  loadUserPlugins,
  loadUserThemes
};
