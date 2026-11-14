const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const CONFIG_VERSION = 3;

const DEFAULT_CONFIG = {
  configVersion: CONFIG_VERSION,
  lang: 'fr',
  window: {
    width: 1320,
    height: 840,
    material: 'none',
    minimizeToTray: true,
    hardwareAcceleration: true,
    startMinimized: false,
    showFloatingButton: true
  },
  appearance: {
    enabled: false,
    palette: 'carbone', // 'carbone' | 'noir' | 'ocean' | 'violet' | 'discord'
    accentColor: '#6366f1',
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

function getPaths() {
  const appData =
    process.env.APPDATA ||
    (app && typeof app.getPath === 'function' ? app.getPath('appData') : path.join(os.homedir(), 'AppData', 'Roaming'));
  const userData = path.join(appData, 'DreamCord');
  return {
    userData,
    configFile: path.join(userData, 'dreamcord-config.json'),
    themesDir: path.join(userData, 'themes'),
    pluginsDir: path.join(userData, 'plugins')
  };
}

function ensureDirectories() {
  const paths = getPaths();
  for (const dir of [paths.userData, paths.themesDir, paths.pluginsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return paths;
}

function deepMerge(target, source) {
  const output = { ...target };
  if (!source || typeof source !== 'object') return output;
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

function migrateConfig(parsed) {
  // Ancienne config (v1/v2) : on repart des réglages simples en gardant
  // le strict nécessaire (CSS perso, couleur d'accent, plugins conservés).
  const fresh = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
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
    if (parsed.plugins) {
      for (const id of Object.keys(fresh.plugins)) {
        if (typeof parsed.plugins[id] === 'boolean') fresh.plugins[id] = parsed.plugins[id];
      }
    }
    const lvl = parsed.pluginSettings?.['volume-booster']?.boostLevel;
    if (lvl) fresh.pluginSettings['volume-booster'].level = Number(lvl) || 200;
  } catch {}
  return fresh;
}

function loadConfig() {
  const { configFile } = ensureDirectories();
  try {
    if (fs.existsSync(configFile)) {
      const raw = fs.readFileSync(configFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.configVersion !== CONFIG_VERSION) {
        const migrated = migrateConfig(parsed);
        saveConfig(migrated);
        return migrated;
      }
      return deepMerge(DEFAULT_CONFIG, parsed);
    }
  } catch (err) {
    console.error('[DreamCord] Erreur lecture config:', err);
  }
  saveConfig(DEFAULT_CONFIG);
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig(config) {
  const { configFile } = ensureDirectories();
  try {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[DreamCord] Erreur sauvegarde config:', err);
    return false;
  }
}

function loadUserPlugins() {
  const { pluginsDir } = ensureDirectories();
  const plugins = [];
  try {
    const files = fs.readdirSync(pluginsDir).filter((f) =>f.endsWith('.js'));
    for (const file of files) {
      const fullPath = path.join(pluginsDir, file);
      const code = fs.readFileSync(fullPath, 'utf8');
      plugins.push({ file, code });
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
    const files = fs.readdirSync(themesDir).filter((f) =>f.endsWith('.css'));
    for (const file of files) {
      const fullPath = path.join(themesDir, file);
      const css = fs.readFileSync(fullPath, 'utf8');
      themes.push({ file, css });
    }
  } catch (err) {
    console.error('[DreamCord] Erreur lecture themes:', err);
  }
  return themes;
}

const clone = (obj) => JSON.parse(JSON.stringify(obj));

let pendingSaveTimer = null;
let pendingSaveConfig = null;

function saveConfigSoon(config) {
  pendingSaveConfig = config;
  if (pendingSaveTimer) return;
  pendingSaveTimer = setTimeout(() => {
    pendingSaveTimer = null;
    const cfgToSave = pendingSaveConfig;
    pendingSaveConfig = null;
    if (cfgToSave) saveConfig(cfgToSave);
  }, 250);
}

function flushConfig() {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  if (pendingSaveConfig) {
    const cfgToSave = pendingSaveConfig;
    pendingSaveConfig = null;
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
  clone,
  loadUserPlugins,
  loadUserThemes
};
