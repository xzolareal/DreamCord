(() => {
  if (window.__DREAMCORD_LOADED__) {
    if (window.__DREAMCORD_BOOT__) window.__DREAMCORD_REFRESH_BOOT__?.(window.__DREAMCORD_BOOT__);
    return;
  }
  window.__DREAMCORD_LOADED__ = true;

  const boot = window.__DREAMCORD_BOOT__ || {};
  const root = document.documentElement;
  root.setAttribute('data-dc-stage', 'core'); // signale à l'écran de chargement que le cœur est là

  // ============================================================
  //  Utilitaires
  // ============================================================
  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number.isFinite(Number(n)) ? Number(n) : a));
  const noop = () => {};
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let ttPolicy = null;
  try {
    if (window.trustedTypes?.createPolicy) ttPolicy = window.trustedTypes.createPolicy('dreamcord-ui', { createHTML: (s) => s });
  } catch {}

  function setHTML(el, html) {
    if (!el) return;
    try {
      el.innerHTML = ttPolicy ? ttPolicy.createHTML(html) : html;
    } catch {
      try {
        el.innerHTML = html;
      } catch (err) {
        log('setHTML: ' + err.message);
      }
    }
  }

  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    return () => target.removeEventListener(type, fn, opts);
  };
  const chain = (...offs) => () => {
    for (const off of offs) {
      try {
        off && off();
      } catch {}
    }
  };

  // ============================================================
  //  Pont avec le processus principal
  // ============================================================
  const pendingReplies = new Map();
  let replySeq = 0;
  window.__DREAMCORD_REPLY__ = (id, payload) => {
    const resolve = pendingReplies.get(id);
    if (resolve) {
      pendingReplies.delete(id);
      resolve(payload);
    }
  };

  function ipc(cmd, data, id) {
    try {
      const native = window.DreamCordNative;
      if (native?.send && id === undefined) return native.send(cmd, data);
      console.info('__DREAMCORD_IPC__:' + JSON.stringify({ cmd, data, id }));
    } catch {}
  }
  const log = (msg) => ipc('log', String(msg));

  function askMain(cmd, data) {
    return new Promise((resolve) => {
      const id = ++replySeq;
      pendingReplies.set(id, resolve);
      ipc(cmd, data, id);
      setTimeout(() => pendingReplies.delete(id) && resolve(null), 120000);
    });
  }

  const Bridge = {
    save(cfg) {
      const native = window.DreamCordNative;
      if (native?.send) native.send('save-config', cfg);
      else if (native?.saveConfig) native.saveConfig(cfg);
      else ipc('save-config', cfg);
    },
    async pickWallpaper() {
      try {
        if (window.DreamCordNative?.pickWallpaper) return await window.DreamCordNative.pickWallpaper();
      } catch {}
      return askMain('pick-wallpaper');
    },
    async getWallpaperUrl(filePath) {
      try {
        if (window.DreamCordNative?.getWallpaperUrl) return await window.DreamCordNative.getWallpaperUrl(filePath);
      } catch {}
      return askMain('wallpaper-url', filePath);
    },
    async pickIcon() {
      try {
        if (window.DreamCordNative?.pickIcon) return await window.DreamCordNative.pickIcon();
      } catch {}
      return askMain('pick-icon');
    }
  };

  // ============================================================
  //  État
  // ============================================================
  const WP_FALLBACK = {
    enabled: false,
    source: 'file',
    filePath: '',
    fileName: '',
    url: '',
    brightness: 80,
    opacity: 100,
    uiOpacity: 70,
    blur: 0,
    contrast: 100,
    saturation: 100,
    fit: 'cover',
    speed: 1,
    pauseMinimized: true,
    pauseUnfocused: false,
    pauseBattery: false,
    settingsGlass: true,
    settingsBlur: 10,
    settingsDim: 68
  };

  let config = null;
  let wallpaperSrc = boot.wallpaperUrl || '';

  const VALID_PALETTES = new Set(['default', 'amoled', 'obsidian', 'carbon', 'slate', 'midnight', 'abyss', 'violet', 'crimson', 'forest', 'coffee']);
  const VALID_FONTS = new Set([
    'default', 'inter', 'poppins', 'montserrat', 'roboto', 'opensans', 'outfit', 'plusjakarta', 'spacegrotesk',
    'rubik', 'quicksand', 'nunito', 'comfortaa', 'rajdhani', 'orbitron', 'jetbrains', 'firacode', 'mono',
    'consolas', 'courier', 'segoe', 'verdana', 'tahoma', 'trebuchet', 'calibri', 'candara', 'georgia',
    'playfair', 'garamond', 'impact', 'rounded'
  ]);
  const VALID_OS_MODES = new Set(['default', 'macos', 'windows', 'linux']);
  const contrastFg = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#09090b';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#09090b' : '#ffffff';
  };

  function normalizeConfig() {
    const d = boot.defaults || {};
    config.window = Object.assign({}, d.window, config.window);
    config.appearance = Object.assign(
      { enabled: false, palette: 'default', accentColor: '#ffffff', borderRadius: 8, avatarRadius: 50, fontFamily: 'default' },
      d.appearance,
      config.appearance
    );
    if (!VALID_PALETTES.has(config.appearance.palette)) config.appearance.palette = 'default';
    if (!VALID_FONTS.has(config.appearance.fontFamily)) config.appearance.fontFamily = 'default';
    config.wallpaper = Object.assign({}, WP_FALLBACK, d.wallpaper, config.wallpaper);
    config.plugins = Object.assign({}, d.plugins, config.plugins);
    const ps = {};
    for (const k of new Set([...Object.keys(d.pluginSettings || {}), ...Object.keys(config.pluginSettings || {})])) {
      ps[k] = Object.assign({}, d.pluginSettings?.[k], config.pluginSettings?.[k]);
    }
    config.pluginSettings = ps;
    if (!config.favoritePlugins || typeof config.favoritePlugins !== 'object' || Array.isArray(config.favoritePlugins)) {
      config.favoritePlugins = {};
    }
    if (typeof config.customCss !== 'string') config.customCss = '';
    if (config.lang !== 'en') config.lang = 'fr';
  }

  const isEn = () => config?.lang === 'en';
  const L = (fr, en) => (isEn() ? en : fr);

  const pluginSetting = (id, key, fallback) => {
    const v = config?.pluginSettings?.[id]?.[key];
    return v === undefined ? fallback : v;
  };

  // Une balise <style> n'est réécrite que si son contenu change vraiment.
  const styleCache = new Map();
  function setStyle(id, css) {
    let el = document.getElementById(id);
    if (!css) {
      el?.remove();
      styleCache.delete(id);
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      (document.head || root).appendChild(el);
      styleCache.delete(id);
    }
    if (styleCache.get(id) !== css) {
      el.textContent = css;
      styleCache.set(id, css);
    }
  }

  function showToast(msg, kind = 'info') {
    if (!document.body) return;
    let t = document.getElementById('dc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dc-toast';
      document.body.appendChild(t);
    }
    t.className = 'dc-toast-' + kind + ' show';
    t.textContent = msg;
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ============================================================
  //  Hook réseau : installé seulement si un plugin en a besoin
  // ============================================================
  const net = { hooked: false };
  const needsNet = () => {
    const p = config?.plugins || {};
    return Boolean(p['hide-typing'] || p['no-telemetry']);
  };

  function ensureNetHook() {
    if (net.hooked || !needsNet()) return;
    net.hooked = true;
    const blocked = (url) => {
      if (typeof url !== 'string') return false;
      const p = config.plugins;
      if (p['hide-typing'] && url.includes('/typing')) return true;
      return Boolean(p['no-telemetry'] && (url.includes('/science') || url.includes('/metrics') || url.includes('sentry.io')));
    };

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (blocked(url)) return Promise.resolve(new Response('', { status: 204 }));
        return origFetch.call(this, input, init);
      };
    }
    const proto = XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;
    proto.open = function (_m, url) {
      this.__dcBlocked = blocked(url);
      return origOpen.apply(this, arguments);
    };
    proto.send = function () {
      if (this.__dcBlocked) {
        try {
          Object.defineProperty(this, 'readyState', { configurable: true, value: 4 });
          Object.defineProperty(this, 'status', { configurable: true, value: 204 });
          Object.defineProperty(this, 'responseText', { configurable: true, value: '' });
          this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(new Event('load'));
          this.dispatchEvent(new Event('loadend'));
        } catch {}
        return;
      }
      return origSend.apply(this, arguments);
    };
  }

  // ============================================================
  //  Observateur DOM unique (filtré, sans auto-boucle, regroupé)
  // ============================================================
  const domTasks = new Map(); // id -> { fn, records }
  let observer = null;
  let flushTimer = 0;
  let idleHandle = 0;
  const DC_OWN_SEL = '#dc-settings-embedded,#dc-cp-modal,#dc-cf-modal,#dc-fms-modal,#dc-clr-modal,#dc-clone-modal,#dc-zoom-modal,#dc-view-modal,#dc-lock-overlay,#dc-toast,#dc-clock,#dc-wallpaper,#dc-charcount';
  const isDcOwnNode = (n) => {
    if (!n || n.nodeType !== 1) return false;
    const id = n.id;
    if (id && id.startsWith('dc-')) return true;
    const cls = typeof n.className === 'string' ? n.className : '';
    return cls.startsWith('dc-') || cls.includes(' dc-');
  };
  const isInsideDcUi = (n) => Boolean(n && n.nodeType === 1 && n.closest?.(DC_OWN_SEL));

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((records) => {
      let hasRecordTask = false;
      let hasDeferredTask = false;
      for (const t of domTasks.values()) {
        if (t.records) hasRecordTask = true;
        else hasDeferredTask = true;
      }
      if (!hasRecordTask && !hasDeferredTask) return;

      let relevantDeferred = false;
      let removedRecords = null;

      for (let i = 0; i < records.length; i++) {
        const m = records[i];
        if (isInsideDcUi(m.target)) continue;
        if (hasRecordTask && m.removedNodes.length) {
          if (!removedRecords) removedRecords = [];
          removedRecords.push(m);
        }
        if (hasDeferredTask && !relevantDeferred) {
          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (n.nodeType === 1 && !isDcOwnNode(n)) {
              relevantDeferred = true;
              break;
            }
          }
          if (!relevantDeferred) {
            for (let j = 0; j < m.removedNodes.length; j++) {
              const n = m.removedNodes[j];
              if (n.nodeType === 1 && !isDcOwnNode(n)) {
                relevantDeferred = true;
                break;
              }
            }
          }
        }
      }

      if (removedRecords) {
        for (const t of domTasks.values()) {
          if (!t.records) continue;
          try {
            t.fn(removedRecords);
          } catch {}
        }
      }

      if (pendingOpen && relevantDeferred) {
        requestAnimationFrame(ensureLauncher);
      }

      if (!relevantDeferred || flushTimer || document.hidden) return;
      flushTimer = setTimeout(() => {
        flushTimer = 0;
        if (document.hidden) return;
        const run = () => {
          idleHandle = 0;
          if (document.hidden) return;
          qCache.clear();
          for (const t of domTasks.values()) {
            if (t.records) continue;
            try {
              t.fn();
            } catch {}
          }
          qCache.clear();
        };
        if (typeof requestIdleCallback === 'function') {
          if (idleHandle && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
          idleHandle = requestIdleCallback(run, { timeout: 500 });
        } else {
          run();
        }
      }, 320);
    });
    const attach = () => (document.body ? observer.observe(document.body, { childList: true, subtree: true }) : setTimeout(attach, 30));
    attach();
  }

  const qCache = new Map();
  const qAll = (sel) => {
    let r = qCache.get(sel);
    if (!r) {
      r = document.querySelectorAll(sel);
      qCache.set(sel, r);
    }
    return r;
  };
  const lsSaveTimers = new Map();
  const scheduleLsSave = (key, data) => {
    if (lsSaveTimers.has(key)) return;
    lsSaveTimers.set(
      key,
      setTimeout(() => {
        lsSaveTimers.delete(key);
        try {
          localStorage.setItem(key, JSON.stringify(data));
        } catch {}
      }, 2000)
    );
  };

  function addTask(id, fn, records = false) {
    domTasks.set(id, { fn, records });
    startObserver();
    return () => domTasks.delete(id);
  }

  // ============================================================
  //  Moteur de plugins : start() renvoie la fonction de nettoyage
  // ============================================================
  const active = new Map(); // id -> cleanup
  const cssPlugin = (id, css) => () => {
    setStyle('dc-p-' + id, typeof css === 'function' ? css() : css);
    return () => setStyle('dc-p-' + id, '');
  };

  function startPlugin(p) {
    if (active.has(p.id)) return;
    try {
      const off = p.start();
      active.set(p.id, typeof off === 'function' ? off : noop);
    } catch (err) {
      log(`Plugin ${p.id}: ${err?.message || err}`);
    }
  }
  function stopPlugin(p) {
    const off = active.get(p.id);
    if (!off) return;
    active.delete(p.id);
    try {
      off();
    } catch {}
  }
  function restartPlugin(id) {
    const p = PLUGINS.find((x) => x.id === id);
    if (!p || p.isWallpaper || !config.plugins[id]) return;
    stopPlugin(p);
    startPlugin(p);
  }
  const restartTimers = {};
  function restartSoon(id) {
    clearTimeout(restartTimers[id]);
    restartTimers[id] = setTimeout(() => restartPlugin(id), 120);
  }

  function syncPlugins() {
    if (!config) return;
    for (const p of PLUGINS) {
      if (p.isWallpaper) continue;
      const on = Boolean(config.plugins[p.id]);
      if (on) startPlugin(p);
      else stopPlugin(p);
    }
  }

  // ============================================================
  //  Icônes (SVG 24x24, trait)
  // ============================================================
  const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const ICONS = {
    sparkle: ['M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5Z'],
    info: [circle(12, 12, 9.5), 'M12 16v-4', 'M12 8h.01'],
    eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', circle(12, 12, 3)],
    heart: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'],
    plug: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a6 6 0 0 1-12 0V8Z'],
    changelog: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h8', 'M8 9h2'],
    wallpaper: ['M3 5h18v14H3z', circle(8.5, 10, 1.6), 'M3 17l5.5-5 4 4 3-3L21 17'],
    trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
    globe: [circle(12, 12, 9), 'M3 12h18', 'M12 3c3 3.5 3 14 0 18', 'M12 3c-3 3.5-3 14 0 18'],
    code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M14 4l-4 16'],
    clock: [circle(12, 12, 9), 'M12 7v5l3 2'],
    hash: ['M5 9h14', 'M5 15h14', 'M10 4L8 20', 'M16 4l-2 16'],
    eyeoff: ['M3 3l18 18', 'M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-3.2 3.8', 'M6.5 7.5C4.2 9.2 3 12 3 12s4 6 9 6a9 9 0 0 0 3.5-.7'],
    shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
    timer: [circle(12, 13, 8), 'M12 9v4l2 2', 'M9 3h6'],
    layout: ['M3 4h18v16H3z', 'M3 9h18', 'M9 9v11'],
    users: [circle(9, 8, 3.2), 'M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6', circle(17, 9, 2.4), 'M16 14.2c3 .2 5 2.3 5 5.3'],
    pulse: ['M3 12h4l3-8 4 16 3-8h4'],
    layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
    type: ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'],
    zap: ['M13 2L4 14h7l-1 8 9-12h-7z'],
    drop: ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'],
    braces: [
      'M8 4c-2 0-3 1-3 3v2c0 1.5-1 3-3 3 2 0 3 1.5 3 3v2c0 2 1 3 3 3',
      'M16 4c2 0 3 1 3 3v2c0 1.5 1 3 3 3-2 0-3 1.5-3 3v2c0 2-1 3-3 3'
    ],
    copy: ['M9 9h11v11H9z', 'M4 15V4h11'],
    send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
    zoom: [circle(11, 11, 7), 'm20 20-3.5-3.5', 'M11 8v6', 'M8 11h6'],
    search: [circle(11, 11, 7), 'm20 20-3.5-3.5'],
    lock: ['M5 11h14v10H5z', 'M7 11V7a5 5 0 0 1 10 0v4'],
    mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3', 'M8 22h8'],
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
    gear: [
      circle(12, 12, 3),
      'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'
    ]
  };
  const svgStr = (name, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(ICONS[name] || ICONS.sparkle)
      .map((d) => `<path d="${d}"/>`)
      .join('')}</svg>`;

  const logoSvg = (size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">` +
    `<path fill-rule="evenodd" d="M5 3h6.5a9 9 0 0 1 0 18H5a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 5 3Zm2 3.5v11h4.5a5.5 5.5 0 0 0 0-11H7Z"/>` +
    `<path d="M11.6 9.1l.85 2.05 2.05.85-2.05.85-.85 2.05-.85-2.05L8.7 12l2.05-.85.85-2.05Z"/></svg>`;

  // ============================================================
  //  Plugins
  //  start() renvoie une fonction de nettoyage ; "sliders" = réglages numériques
  // ============================================================
  const MSG_LOGGER_CSS =
    '.dc-msg-deleted{position:relative;background:rgba(218,55,60,.14)!important;border-left:3px solid #da373c!important;border-radius:0 6px 6px 0}' +
    '.dc-msg-deleted-badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;background:rgba(218,55,60,.28);color:#fca5a5;font-size:10px;font-weight:700;text-transform:uppercase;vertical-align:middle}' +
    '.dc-msg-deleted-x{position:absolute;right:12px;top:4px;display:none;width:22px;height:22px;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:rgba(0,0,0,.78);color:#fca5a5;font:700 13px/1 sans-serif;cursor:pointer;align-items:center;justify-content:center}' +
    '.dc-msg-deleted:hover .dc-msg-deleted-x{display:inline-flex}.dc-msg-deleted-x:hover{background:#da373c;color:#fff;border-color:#da373c}';

  const PLUGINS = [
    {
      id: 'lively-wallpaper', name: 'Lively Wallpaper', desc: 'Fond d’écran animé (vidéo, GIF, image)', cat: 'ui', icon: 'wallpaper',
      isWallpaper: true, hasPage: true
    },
    {
      id: 'message-logger', name: 'Messages supprimés', desc: 'Restent visibles en rouge', cat: 'chat', icon: 'trash',
      start() {
        let lastScroll = 0;
        let lastNav = 0;
        let lastHref = location.href;
        const ghosts = [];
        const pad2 = (n) => String(n).padStart(2, '0');
        setStyle('dc-p-message-logger', MSG_LOGGER_CSS);
        const offTask = addTask('message-logger', (records) => {
          const now = Date.now();
          if (location.href !== lastHref) {
            lastHref = location.href;
            lastNav = now;
          }
          if (now - lastScroll < 600 || now - lastNav < 1500) return;
          let removedCount = 0;
          for (const m of records) removedCount += m.removedNodes.length;
          if (removedCount > 8) return; // vidage massif : changement de salon, pas une suppression
          for (const m of records) {
            if (!m.target?.isConnected) continue;
            for (const removed of m.removedNodes) {
              if (removed.nodeType !== 1 || !removed.id || !removed.id.startsWith('chat-messages-')) continue;
              const origId = removed.id;
              const ghostId = 'dc-ghost-' + origId;
              if (removed.classList.contains('dc-msg-deleted') || document.getElementById(origId) || document.getElementById(ghostId)) continue;
              const ghost = removed.cloneNode(true);
              ghost.id = ghostId;
              ghost.dataset.dcOrigId = origId;
              ghost.classList.add('dc-msg-deleted');
              const dt = new Date();
              const header = ghost.querySelector('[id^="message-username-"], h3');
              if (header && !ghost.querySelector('.dc-msg-deleted-badge')) {
                const badge = document.createElement('span');
                badge.className = 'dc-msg-deleted-badge';
                badge.textContent = `${L('Supprimé', 'Deleted')} · ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
                header.appendChild(badge);
              }
              if (!ghost.querySelector('.dc-msg-deleted-x')) {
                const x = document.createElement('button');
                x.type = 'button';
                x.className = 'dc-msg-deleted-x';
                x.title = L('Masquer', 'Dismiss');
                x.textContent = '×';
                x.onclick = (ev) => {
                  ev.stopPropagation();
                  ghost.remove();
                  const idx = ghosts.indexOf(ghost);
                  if (idx !== -1) ghosts.splice(idx, 1);
                };
                ghost.appendChild(x);
              }
              if (m.nextSibling && m.nextSibling.parentNode === m.target) m.target.insertBefore(ghost, m.nextSibling);
              else m.target.appendChild(ghost);
              ghosts.push(ghost);
              while (ghosts.length > 150) {
                const old = ghosts.shift();
                old?.remove();
              }
            }
          }
        }, true);
        return chain(
          listen(document, 'scroll', () => (lastScroll = Date.now()), { capture: true, passive: true }),
          offTask,
          () => {
            setStyle('dc-p-message-logger', '');
            ghosts.forEach((g) => g.remove());
            ghosts.length = 0;
          }
        );
      }
    },
    {
      id: 'translate', name: 'Traduire', desc: 'Alt + clic droit', cat: 'chat', icon: 'globe',
      start() {
        return chain(
          listen(document, 'contextmenu', async (e) => {
            if (!e.altKey) return;
            const li = e.target.closest?.('li[id^="chat-messages-"]');
            const content = li?.querySelector('[id^="message-content-"]');
            if (!content || !content.textContent?.trim()) return;
            e.preventDefault();
            e.stopPropagation();
            let box = li.querySelector('.dc-translate-box');
            if (box) return box.remove();
            const lang = config?.lang === 'en' ? 'en' : 'fr';
            box = document.createElement('div');
            box.className = 'dc-translate-box';
            box.style.cursor = 'pointer';
            box.title = L('Cliquer pour copier', 'Click to copy');
            box.textContent = '…';
            content.after(box);
            try {
              const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(content.textContent.trim())}`);
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const data = await r.json();
              const text = Array.isArray(data?.[0]) ? data[0].map((s) => s?.[0] || '').join('') : '';
              const srcLang = typeof data?.[2] === 'string' ? data[2].toUpperCase() : '';
              box.textContent = text ? (srcLang ? `[${srcLang} → ${lang.toUpperCase()}] ${text}` : text) : L('Traduction indisponible', 'Translation unavailable');
              if (text) {
                box.onclick = (ev) => {
                  ev.stopPropagation();
                  navigator.clipboard?.writeText(text)?.catch?.(noop);
                  showToast(L('Traduction copiée', 'Translation copied'), 'ok');
                };
              }
            } catch {
              box.textContent = L('Erreur réseau', 'Network error');
            }
          }, true),
          () => document.querySelectorAll('.dc-translate-box').forEach((n) => n.remove())
        );
      }
    },
    {
      id: 'view-raw', name: 'Message brut', desc: 'Maj + clic droit : copier', cat: 'chat', icon: 'code',
      start: () =>
        listen(document, 'contextmenu', (e) => {
          if (!e.shiftKey) return;
          const li = e.target.closest?.('li[id^="chat-messages-"]');
          if (!li) return;
          e.preventDefault();
          e.stopPropagation();
          const author = li.querySelector('[id^="message-username-"]')?.textContent?.trim() || '';
          const raw = li.querySelector('[id^="message-content-"]')?.innerText || '';
          const ts = li.querySelector('time[datetime]')?.getAttribute('datetime') || '';
          const files = Array.from(li.querySelectorAll('a[href*="cdn.discordapp.com/attachments/"], img[src*="cdn.discordapp.com/attachments/"]'))
            .map((n) => n.href || n.src)
            .filter(Boolean);
          const origId = li.dataset.dcOrigId || li.id;
          const parts = [`ID: ${origId.replace('chat-messages-', '')}`];
          if (author) parts.push(`${L('Auteur', 'Author')}: ${author}`);
          if (ts) parts.push(`Date: ${ts}`);
          if (raw) parts.push(raw);
          if (files.length) parts.push(`${L('Fichiers', 'Attachments')}:\n${[...new Set(files)].join('\n')}`);
          navigator.clipboard?.writeText(parts.join('\n'))?.catch?.(noop);
          showToast(L('Message brut copié', 'Raw message copied'), 'ok');
        }, true)
    },
    {
      id: 'exact-timestamps', name: 'Heure exacte', desc: 'Avec les secondes', cat: 'chat', icon: 'clock',
      start() {
        const pad = (n) => String(n).padStart(2, '0');
        const off = addTask('exact-timestamps', () => {
          document.querySelectorAll('time[datetime]:not([data-dc-ts])').forEach((t) => {
            t.dataset.dcTs = '1';
            const d = new Date(t.getAttribute('datetime'));
            if (Number.isNaN(d.getTime())) return;
            const exact = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            if (t.textContent.includes(exact)) return;
            const span = document.createElement('span');
            span.className = 'dc-exact-ts';
            span.textContent = ` (${exact})`;
            t.appendChild(span);
          });
        });
        return chain(off, () => {
          document.querySelectorAll('.dc-exact-ts').forEach((n) => n.remove());
          document.querySelectorAll('time[data-dc-ts]').forEach((n) => delete n.dataset.dcTs);
        });
      }
    },
    {
      id: 'char-count', name: 'Compteur', desc: 'Limite de 2000 caractères', cat: 'chat', icon: 'hash',
      start() {
        let badge = null;
        const update = (e) => {
          const tb = e.target?.closest?.('[role="textbox"]');
          const wrap = tb?.closest('[class*="channelTextArea_"]');
          if (!wrap) return;
          const n = (tb.textContent || '').replace(/\u200b/g, '').length;
          if (n < 1500) {
            badge?.remove();
            badge = null;
            return;
          }
          if (!badge || !badge.isConnected) {
            badge = document.createElement('div');
            badge.id = 'dc-charcount';
            wrap.appendChild(badge);
          }
          badge.textContent = `${n} / 2000`;
          badge.className = n > 2000 ? 'bad' : n > 1800 ? 'warn' : '';
        };
        return chain(listen(document, 'input', update, true), listen(document, 'keyup', update, true), () =>
          document.getElementById('dc-charcount')?.remove()
        );
      }
    },
    {
      id: 'hide-typing', name: 'Saisie cachée', desc: 'Pas de « écrit… »', cat: 'privacy', icon: 'eyeoff',
      start: () => ensureNetHook()
    },
    {
      id: 'no-telemetry', name: 'Zéro télémétrie', desc: 'Bloque les statistiques', cat: 'privacy', icon: 'shield',
      start: () => ensureNetHook()
    },
    {
      id: 'privacy-blur', name: 'Mode discret', desc: 'Flou jusqu’au survol', cat: 'privacy', icon: 'eyeoff',
      sliders: [{ key: 'amount', label: 'Intensité', enLabel: 'Strength', min: 4, max: 20, step: 1, unit: ' px', def: 8 }],
      start: cssPlugin('privacy-blur', () => {
        const px = pluginSetting('privacy-blur', 'amount', 8);
        return (
          `[id^="message-content-"],[class*="channelTextArea_"] [role="textbox"],[class*="members_"] [class*="name_"],[class*="privateChannels_"] [class*="name_"]{filter:blur(${px}px);transition:filter .15s ease}` +
          `[id^="message-content-"]:hover,[class*="channelTextArea_"] [role="textbox"]:focus,[class*="channelTextArea_"] [role="textbox"]:hover,` +
          `[class*="members_"] [class*="member_"]:hover [class*="name_"],[class*="privateChannels_"] [class*="channel_"]:hover [class*="name_"]{filter:none!important}`
        );
      })
    },
    {
      id: 'call-timer', name: 'Durée d’appel', desc: 'Chrono vocal', cat: 'tools', icon: 'timer',
      start() {
        let startAt = 0;
        let host = null;
        let iv = 0;
        const stopTick = () => {
          if (iv) {
            clearInterval(iv);
            iv = 0;
          }
          startAt = 0;
          host = null;
          document.getElementById('dc-call-timer')?.remove();
        };
        const tick = () => {
          if (!host || !host.isConnected) {
            host = document.querySelector('[class*="rtcConnectionStatus_"]');
            if (!host) return stopTick();
          }
          if (document.hidden) return;
          let badge = document.getElementById('dc-call-timer');
          if (!badge || !badge.isConnected) {
            badge = document.createElement('span');
            badge.id = 'dc-call-timer';
            host.appendChild(badge);
          }
          const sec = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
          const hh = Math.floor(sec / 3600);
          const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
          const ss = String(sec % 60).padStart(2, '0');
          badge.textContent = hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
        };
        const checkVoice = () => {
          if (host && host.isConnected) return;
          const next = document.querySelector('[class*="rtcConnectionStatus_"]');
          if (!next) {
            if (iv) stopTick();
            return;
          }
          host = next;
          if (!startAt) startAt = Date.now();
          tick();
          if (!iv) iv = setInterval(tick, 1000);
        };
        checkVoice();
        const offTask = addTask('call-timer', checkVoice);
        const offVis = listen(document, 'visibilitychange', () => {
          if (!document.hidden && iv) tick();
        });
        return chain(offTask, offVis, stopTick);
      }
    },
    {
      id: 'clock', name: 'Horloge', desc: 'Heure en haut de la fenêtre', cat: 'tools', icon: 'clock',
      start() {
        const box = document.createElement('div');
        box.id = 'dc-clock';
        (document.body || root).appendChild(box);
        const update = () => (box.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        update();
        let iv = 0;
        const first = setTimeout(() => {
          update();
          iv = setInterval(update, 60000);
        }, 60000 - (Date.now() % 60000));
        return () => {
          clearTimeout(first);
          clearInterval(iv);
          box.remove();
        };
      }
    },
    {
      id: 'window-opacity', name: 'Fenêtre transparente', desc: 'Opacité de toute la fenêtre', cat: 'tools', icon: 'drop',
      sliders: [{ key: 'value', label: 'Opacité', enLabel: 'Opacity', min: 40, max: 100, step: 1, unit: ' %', def: 92 }],
      start() {
        ipc('window-opacity', clamp(pluginSetting('window-opacity', 'value', 92), 40, 100) / 100);
        return () => ipc('window-opacity', 1);
      }
    },
    {
      id: 'declutter-ui', name: 'Interface épurée', desc: 'Sans Nitro ni Boutique', cat: 'ui', icon: 'layout',
      start: cssPlugin(
        'declutter-ui',
        'a[href="/store"],a[href="/shop"],a[href="/quest-home"],[aria-label*="Nitro" i]:not([id^="dc-"]),[aria-label*="Boutique" i],[aria-label*="Shop" i],' +
          '[aria-label*="Quêtes" i],[aria-label*="Quests" i],button[aria-label*="cadeau" i],button[aria-label*="gift" i]{display:none!important}'
      )
    },
    {
      id: 'hide-activity', name: 'Sans activités', desc: 'Masque « En ce moment »', cat: 'ui', icon: 'pulse',
      start: cssPlugin('hide-activity', '[class*="nowPlayingColumn_"],[class*="activityPanel_"]{display:none!important}')
    },
    {
      id: 'font-size', name: 'Taille du texte', desc: 'Messages du chat', cat: 'ui', icon: 'type',
      sliders: [{ key: 'size', label: 'Taille', enLabel: 'Size', min: 12, max: 24, step: 1, unit: ' px', def: 16 }],
      start: cssPlugin('font-size', () => `[id^="message-content-"]{font-size:${clamp(pluginSetting('font-size', 'size', 16), 12, 24)}px!important}`)
    },
    {
      id: 'lite-mode', name: 'Mode léger', desc: 'Sans animations ni flous', cat: 'ui', icon: 'zap',
      start: cssPlugin(
        'lite-mode',
        '*,*::before,*::after{animation-duration:.001ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.001ms!important;transition-delay:0s!important;scroll-behavior:auto!important}' +
          '[class*="backdrop_"],[class*="layer_"],[class*="popout_"],[class*="menu_"],[class*="modal"],[class*="floating"]{backdrop-filter:none!important}'
      )
    },
    {
      id: 'custom-css', name: 'CSS perso', desc: 'Éditeur + dossier thèmes', cat: 'ui', icon: 'braces', hasPage: true,
      start: cssPlugin('custom-css', () => buildCustomCss())
    },
    {
      id: 'server-cloner', name: 'Cloner un serveur', desc: 'Clic droit sur un serveur', cat: 'tools', icon: 'copy',
      start() {
        let ctxTimers = [];
        const clearCtx = () => {
          ctxTimers.forEach(clearTimeout);
          ctxTimers = [];
        };
        const onCtx = (e) => {
          const item = e.target.closest?.('[data-list-item-id^="guildsnav___"]');
          const m = item?.getAttribute('data-list-item-id')?.match(/^guildsnav___(\d{15,22})$/);
          if (!m) return;
          const guildId = m[1];
          clearCtx();
          const inject = () => {
            const menu = document.querySelector('#guild-context, [role="menu"][id*="guild"]');
            if (!menu || menu.querySelector('#dc-ctx-clone-guild')) return;
            const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
            if (!target.querySelector('.dc-ctx-hdr')) {
              const hdr = document.createElement('div');
              hdr.className = 'dc-ctx-hdr';
              hdr.textContent = L('Option DreamCord', 'DreamCord Options');
              target.appendChild(hdr);
            }
            const btn = document.createElement('div');
            btn.id = 'dc-ctx-clone-guild';
            btn.className = 'dc-ctx-clone';
            btn.setAttribute('role', 'menuitem');
            btn.textContent = L('Cloner le serveur', 'Clone server');
            btn.onclick = (ev) => {
              ev.stopPropagation();
              dismissDiscordMenu(menu);
              cloneGuild(guildId);
            };
            target.appendChild(btn);
            clearCtx();
          };
          ctxTimers = [20, 60, 140, 260].map((ms) => setTimeout(inject, ms));
        };
        return chain(listen(document, 'contextmenu', onCtx, true), clearCtx, () => {
          document.getElementById('dc-ctx-clone-guild')?.remove();
        });
      }
    },
    {
      id: 'custom-profile', name: 'Custom Profile', desc: 'Modifier ton profil, badge ancien pseudo, badges Nitro/Boost, déco et connexions', cat: 'ui', icon: 'users', isNew: true, hasPage: true,
      start() {
        return startCustomProfile();
      }
    },
    {
      id: 'custom-friend', name: 'Custom Friend', desc: 'Clic droit : changer pseudo et PP', cat: 'ui', icon: 'users', hasPage: true,
      start() {
        return startCustomFriend();
      }
    },
    {
      id: 'fake-message-send', name: 'Fake Message Send', desc: 'Avion en papier : faux message en MP', cat: 'chat', icon: 'send',
      start() {
        return startFakeMessageSend();
      }
    },
    {
      id: 'clear-messages', name: 'All Clear Message', desc: 'Supprimer tous tes messages d’une conv', cat: 'tools', icon: 'trash',
      start() {
        return startClearMessages();
      }
    },
    {
      id: 'quick-copy-id', name: 'Copie rapide ID', desc: 'Ctrl + clic pour copier un ID Discord', cat: 'tools', icon: 'copy',
      start() {
        return listen(document, 'click', (e) => {
          if (!e.ctrlKey || e.shiftKey || e.altKey) return;
          if (e.target.closest?.('#dc-settings-embedded, #dc-cf-modal, #dc-fms-modal, #dc-clr-modal, #dc-clone-modal, input, textarea, [role="textbox"], a[href^="http"]')) return;
          let id = '';
          const guild = e.target.closest?.('[data-list-item-id^="guildsnav___"]');
          if (guild) {
            id = guild.getAttribute('data-list-item-id')?.match(/(\d{15,22})/)?.[1] || '';
          } else {
            const msg = e.target.closest?.('li[id^="chat-messages-"]');
            const userInfo = extractUserInfo(e.target);
            if (userInfo?.userId && e.target.closest?.('img[src*="/avatars/"], img[data-dc-cf-uid], [id^="message-username-"], [class*="member_"], [class*="peopleListItem_"], [class*="channel_"]')) {
              id = userInfo.userId;
            } else if (msg) {
              const rawId = msg.dataset.dcOrigId || msg.id;
              id = rawId.split('-').pop() || '';
            } else if (userInfo?.userId) {
              id = userInfo.userId;
            }
          }
          if (!id || !/^\d{15,22}$/.test(id)) return;
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard?.writeText(id)?.catch?.(noop);
          showToast(L(`ID copié : ${id}`, `ID copied: ${id}`), 'ok');
        }, true);
      }
    },
    {
      id: 'clean-links', name: 'Liens propres', desc: 'Retire les traceurs (utm, si, fbclid) au collage', cat: 'privacy', icon: 'shield',
      start() {
        const TRACKERS = /^(?:utm_[a-z0-9_]+|si|fbclid|gclid|igsh|igshid|ref|ref_src|feature|mc_cid|mc_eid|spm|mkt_tok)$/i;
        return listen(document, 'paste', (e) => {
          if (!e.target?.closest?.('[role="textbox"]')) return;
          const raw = e.clipboardData?.getData('text/plain');
          if (!raw || !/^https?:\/\/\S+$/i.test(raw.trim())) return;
          try {
            const u = new URL(raw.trim());
            let changed = false;
            for (const k of Array.from(u.searchParams.keys())) {
              if (TRACKERS.test(k)) {
                u.searchParams.delete(k);
                changed = true;
              }
            }
            if (!changed) return;
            e.preventDefault();
            e.stopPropagation();
            const clean = u.toString();
            if (!document.execCommand('insertText', false, clean)) {
              const dt = new DataTransfer();
              dt.setData('text/plain', clean);
              e.target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            }
            showToast(L('Lien nettoyé (traceurs retirés)', 'Link cleaned (trackers stripped)'), 'ok');
          } catch {}
        }, true);
      }
    },
    {
      id: 'better-codeblocks', name: 'Blocs de code + Copier', desc: 'Bouton Copier sur les blocs de code', cat: 'chat', icon: 'code',
      start() {
        const CSS =
          'pre:has(>code){position:relative}' +
          '.dc-cb-copy{position:absolute;top:6px;right:6px;height:24px;padding:0 9px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:#09090b;color:#e4e4e7;font:600 11px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;opacity:0;transition:opacity .15s,background .15s,border-color .15s,color .15s;z-index:2}' +
          'pre:hover .dc-cb-copy,.dc-cb-copy:focus-visible{opacity:1}.dc-cb-copy:hover{background:#ffffff;border-color:#ffffff;color:#09090b}';
        setStyle('dc-p-better-codeblocks', CSS);
        const addBtns = () => {
          document.querySelectorAll('pre:not([data-dc-cb]) > code').forEach((code) => {
            const pre = code.parentElement;
            if (!pre) return;
            pre.dataset.dcCb = '1';
            if (pre.querySelector('.dc-cb-copy')) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dc-cb-copy';
            btn.textContent = L('Copier', 'Copy');
            btn.onclick = (ev) => {
              ev.stopPropagation();
              navigator.clipboard?.writeText(code.textContent || '')?.catch?.(noop);
              btn.textContent = L('Copié !', 'Copied!');
              clearTimeout(btn._tm);
              btn._tm = setTimeout(() => {
                if (btn.isConnected) btn.textContent = L('Copier', 'Copy');
              }, 1400);
            };
            pre.appendChild(btn);
          });
        };
        addBtns();
        const off = addTask('better-codeblocks', addBtns);
        return chain(off, () => {
          setStyle('dc-p-better-codeblocks', '');
          document.querySelectorAll('.dc-cb-copy').forEach((b) => b.remove());
          document.querySelectorAll('pre[data-dc-cb]').forEach((p) => delete p.dataset.dcCb);
        });
      }
    },
    {
      id: 'thin-scrollbars', name: 'Barres fines', desc: 'Scrollbars ultra-fines et discrètes', cat: 'ui', icon: 'layout',
      start: cssPlugin(
        'thin-scrollbars',
        '::-webkit-scrollbar{width:5px!important;height:5px!important}::-webkit-scrollbar-track{background:transparent!important}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16)!important;border-radius:99px!important;border:0!important}::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28)!important}'
      )
    },
    {
      id: 'spoiler-reveal', name: 'Révéler les spoilers', desc: 'Dévoile les spoilers au survol', cat: 'chat', icon: 'eye',
      start: cssPlugin(
        'spoiler-reveal',
        '[class*="spoilerContent_"]:hover [class*="obscuredTextContent_"],[class*="spoilerText_"]:hover{filter:none!important;opacity:1!important;color:inherit!important;background:rgba(255,255,255,.08)!important}' +
          '[class*="spoilerContent_"]:hover img,[class*="spoilerContent_"]:hover video{filter:none!important}'
      )
    },
    {
      id: 'always-on-top', name: 'Toujours au premier plan', desc: 'Garde Discord au-dessus des autres fenêtres', cat: 'tools', icon: 'layers',
      start() {
        ipc('always-on-top', true);
        return () => ipc('always-on-top', false);
      }
    },
    {
      id: 'hide-blocked', name: 'Masquer messages bloqués', desc: 'Cache les bandeaux « messages bloqués »', cat: 'privacy', icon: 'eyeoff',
      start: cssPlugin('hide-blocked', '[class*="blockedSystemMessage_"],[class*="groupStart_"]:has([class*="blockedSystemMessage_"]){display:none!important}')
    },
    {
      id: 'compact-members', name: 'Membres auto-masqués', desc: 'Réduit la liste des membres jusqu’au survol', cat: 'ui', icon: 'users',
      start: cssPlugin(
        'compact-members',
        '[class*="membersWrap_"]{min-width:60px!important;width:60px!important;transition:width .2s ease!important;overflow:hidden!important}' +
          '[class*="membersWrap_"]:hover{width:240px!important}'
      )
    },
    {
      id: 'image-zoom', name: 'ImageZoom', desc: 'Maj + clic sur une image pour zoomer', cat: 'ui', icon: 'zoom', isNew: true,
      start: () => startImageZoom()
    },
    {
      id: 'view-icons', name: 'ViewIcons', desc: 'Clic droit sur avatar / bannière en HD', cat: 'ui', icon: 'wallpaper', isNew: true,
      start: () => startViewIcons()
    },
    {
      id: 'show-id', name: 'ShowID', desc: 'Affiche l’ID Discord sur les profils', cat: 'tools', icon: 'hash', isNew: true,
      start: () => startShowId()
    },
    {
      id: 'fast-discord', name: 'FastDiscord', desc: 'Optimise le rendu et la réactivité', cat: 'ui', icon: 'zap', isNew: true,
      start: cssPlugin(
        'fast-discord',
        'li[id^="chat-messages-"]{content-visibility:auto;contain-intrinsic-size:auto 64px}' +
          '[class*="member_"]{content-visibility:auto;contain-intrinsic-size:auto 44px}' +
          '[class*="chat_"] *,[class*="sidebar_"] *,[class*="members_"] *{transition-duration:.01ms!important}' +
          '[class*="backdrop_"],[class*="popout_"],[class*="menu_"]{backdrop-filter:none!important}'
      )
    },
    {
      id: 'fake-delete', name: 'FakeDeleteMessage', desc: 'Masque localement un message (clic droit)', cat: 'chat', icon: 'eyeoff', isNew: true,
      start: () => startFakeDelete()
    },
    {
      id: 'reverse-image-search', name: 'ReverseImageSearch', desc: 'Recherche inversée Google Lens / TinEye', cat: 'tools', icon: 'search', isNew: true,
      start: () => startReverseImageSearch()
    },
    {
      id: 'passcode-lock', name: 'PasscodeLock', desc: 'Verrouille Discord par code PIN (Ctrl+Maj+L)', cat: 'privacy', icon: 'lock', isNew: true, hasPage: true,
      start: () => startPasscodeLock()
    },
    {
      id: 'stealth-mode', name: 'StealthMode', desc: 'Ctrl+Maj+H masque tous les boutons DreamCord', cat: 'privacy', icon: 'shield', isNew: true,
      start: () => startStealthMode()
    },
    {
      id: 'macos-buttons', name: 'OS Window Mode (macOS / Win / Linux)', desc: 'Boutons de fenêtre style macOS, Windows ou Linux', cat: 'ui', icon: 'layout', isNew: true,
      choices: [{ key: 'mode', label: 'Style OS des boutons de fenêtre', enLabel: 'Window controls OS style', def: 'macos', items: [['macos', 'macOS'], ['windows', 'Windows'], ['linux', 'Linux']] }],
      start: () => startOsButtons()
    },
    {
      id: 'write-uppercase', name: 'WriteUpperCase', desc: 'Majuscule automatique en début de phrase', cat: 'chat', icon: 'type', isNew: true,
      start: () => startWriteUpperCase()
    },
    {
      id: 'picture-in-picture', name: 'PictureInPicture', desc: 'Ajoute un bouton PiP sur les vidéos du chat', cat: 'ui', icon: 'wallpaper', isNew: true,
      start() {
        const CSS =
          '.dc-pip-btn{position:absolute;top:8px;right:8px;z-index:5;height:24px;padding:0 8px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(9,9,11,.85);color:#fff;font:700 10.5px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;opacity:0;transition:opacity .15s,background .15s}' +
          '[class*="videoWrapper_"]:hover .dc-pip-btn,[class*="wrapper_"]:hover>.dc-pip-btn,.dc-pip-btn:focus{opacity:1}.dc-pip-btn:hover{background:#fff;color:#09090b}';
        setStyle('dc-p-pip', CSS);
        const addPip = () => {
          document.querySelectorAll('video:not(.dc-media):not([data-dc-pip])').forEach((v) => {
            v.dataset.dcPip = '1';
            const host = v.parentElement;
            if (!host || host.querySelector('.dc-pip-btn')) return;
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dc-pip-btn';
            btn.textContent = 'PiP';
            btn.title = L('Image dans l’image', 'Picture-in-Picture');
            btn.onclick = (ev) => {
              ev.stopPropagation();
              if (document.pictureInPictureElement === v) document.exitPictureInPicture?.().catch(noop);
              else v.requestPictureInPicture?.().catch(() => showToast(L('PiP indisponible', 'PiP unavailable'), 'error'));
            };
            host.appendChild(btn);
          });
        };
        addPip();
        const off = addTask('picture-in-picture', addPip);
        return chain(off, () => {
          setStyle('dc-p-pip', '');
          document.querySelectorAll('.dc-pip-btn').forEach((b) => b.remove());
          document.querySelectorAll('video[data-dc-pip]').forEach((v) => delete v.dataset.dcPip);
        });
      }
    },
    {
      id: 'decode-base64', name: 'DecodeBase64', desc: 'Décode le texte Base64 d’un message (Ctrl+Alt+clic)', cat: 'tools', icon: 'code', isNew: true,
      start() {
        return chain(
          listen(document, 'contextmenu', (e) => {
            if (!e.ctrlKey) return;
            const li = e.target.closest?.('li[id^="chat-messages-"]');
            const content = li?.querySelector('[id^="message-content-"]');
            if (!content) return;
            const m = (content.textContent || '').match(/\b([A-Za-z0-9+/]{12,}={0,2})\b/);
            if (!m) return;
            try {
              const decoded = decodeURIComponent(escape(atob(m[1])));
              if (!decoded || /[\x00-\x08\x0e-\x1f]/.test(decoded)) return;
              e.preventDefault();
              e.stopPropagation();
              let box = li.querySelector('.dc-b64-box');
              if (box) return box.remove();
              box = document.createElement('div');
              box.className = 'dc-translate-box dc-b64-box';
              box.style.cursor = 'pointer';
              box.title = L('Cliquer pour copier', 'Click to copy');
              box.textContent = `[Base64] ${decoded}`;
              box.onclick = (ev) => {
                ev.stopPropagation();
                navigator.clipboard?.writeText(decoded);
                showToast(L('Texte décodé copié', 'Decoded text copied'), 'ok');
              };
              content.after(box);
            } catch {}
          }, true),
          () => document.querySelectorAll('.dc-b64-box').forEach((n) => n.remove())
        );
      }
    },
    {
      id: 'no-caps', name: 'NoCaps', desc: 'Convertit automatiquement les messages tout en majuscules', cat: 'chat', icon: 'type', isNew: true,
      start() {
        return listen(document, 'keydown', (e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
          const tb = e.target?.closest?.('[role="textbox"]');
          if (!tb || tb.closest('#dc-settings-embedded, #dc-cf-modal')) return;
          const raw = (tb.textContent || '').replace(/\u200b/g, '');
          const letters = raw.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || [];
          if (letters.length < 6) return;
          const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
          if (upper / letters.length < 0.6) return;
          try {
            const lower = raw.toLowerCase();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(tb);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('insertText', false, lower);
          } catch {}
        }, true);
      }
    },
    {
      id: 'image-filename', name: 'ImageFilename', desc: 'Affiche le nom de fichier des images/GIF au survol', cat: 'ui', icon: 'eye', isNew: true,
      start() {
        const tag = () => {
          document.querySelectorAll('li[id^="chat-messages-"] img[src*="discordapp"], li[id^="chat-messages-"] img[src*="tenor"], li[id^="chat-messages-"] img[src*="giphy"]').forEach((img) => {
            if (img.dataset.dcFname) return;
            try {
              const name = decodeURIComponent(new URL(img.src).pathname.split('/').pop() || '');
              if (name) {
                img.dataset.dcFname = '1';
                if (!img.title) img.title = name;
              }
            } catch {}
          });
        };
        tag();
        const off = addTask('image-filename', tag);
        return chain(off, () => {
          document.querySelectorAll('img[data-dc-fname]').forEach((img) => {
            img.removeAttribute('title');
            delete img.dataset.dcFname;
          });
        });
      }
    },
    {
      id: 'irc-colors', name: 'IrcColors', desc: 'Donne une couleur unique à chaque pseudo sans rôle', cat: 'chat', icon: 'users', isNew: true,
      start() {
        const hashColor = (s) => {
          let h = 0;
          for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
          return `hsl(${Math.abs(h) % 360}, 62%, 72%)`;
        };
        const apply = () => {
          document.querySelectorAll('[id^="message-username-"] [class*="username_"]').forEach((el) => {
            if (el.dataset.dcIrc || el.style.color) return;
            const txt = (el.textContent || '').trim();
            if (!txt) return;
            el.dataset.dcIrc = '1';
            el.style.color = hashColor(txt);
          });
        };
        apply();
        const off = addTask('irc-colors', apply);
        return chain(off, () => {
          document.querySelectorAll('[data-dc-irc]').forEach((el) => {
            el.style.color = '';
            delete el.dataset.dcIrc;
          });
        });
      }
    },
    {
      id: 'jump-to-top', name: 'JumpToTop', desc: 'Bouton rapide pour remonter en haut du salon', cat: 'tools', icon: 'layers', isNew: true,
      start() {
        const CSS =
          '#dc-jtt-btn{position:fixed;right:26px;bottom:84px;z-index:99;width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(9,9,11,.88);color:#e4e4e7;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s,border-color .15s}' +
          '#dc-jtt-btn:hover{background:#fff;color:#09090b;border-color:#fff}';
        setStyle('dc-p-jtt', CSS);
        let btn = document.getElementById('dc-jtt-btn');
        if (!btn) {
          btn = document.createElement('button');
          btn.id = 'dc-jtt-btn';
          btn.type = 'button';
          btn.title = L('Aller en haut des messages chargés', 'Jump to top of loaded messages');
          setHTML(btn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>');
          btn.onclick = () => {
            const sc = document.querySelector('[class*="messagesWrapper_"] [class*="scroller_"]');
            if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
          };
          document.body.appendChild(btn);
        }
        return () => {
          setStyle('dc-p-jtt', '');
          document.getElementById('dc-jtt-btn')?.remove();
        };
      }
    },
    {
      id: 'copy-profile-id', name: 'CopyProfileId', desc: 'Bouton rapide pour copier l’ID dans les profils', cat: 'tools', icon: 'copy', isNew: true,
      start() {
        const CSS =
          '.dc-cpid-btn{height:30px;padding:0 9px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#f4f4f5;font:700 11px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:background .12s,color .12s}' +
          '.dc-cpid-btn:hover{background:#fff;color:#09090b;border-color:#fff}';
        setStyle('dc-p-cpid', CSS);
        const inject = () => {
          document.querySelectorAll('[role="dialog"]:not(#dc-cf-modal),[class*="userPopoutOuter"],[class*="userProfileOuter"]').forEach((pop) => {
            if (pop.querySelector('.dc-cpid-btn')) return;
            const info = extractUserInfo(pop);
            if (!info?.userId) return;
            const anchor = pop.querySelector('button[aria-label*="Message" i], button[aria-label*="Envoyer" i], [class*="buttons_"] button');
            const bar = anchor?.parentElement;
            if (!bar) return;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'dc-cpid-btn';
            b.textContent = 'ID';
            b.title = `${L('Copier l’ID', 'Copy ID')} (${info.userId})`;
            b.onclick = (ev) => {
              ev.stopPropagation();
              navigator.clipboard?.writeText(info.userId);
              showToast(L(`ID copié : ${info.userId}`, `ID copied: ${info.userId}`), 'ok');
            };
            bar.appendChild(b);
          });
        };
        inject();
        const off = addTask('copy-profile-id', inject);
        return chain(off, () => {
          setStyle('dc-p-cpid', '');
          document.querySelectorAll('.dc-cpid-btn').forEach((b) => b.remove());
        });
      }
    },
    {
      id: 'member-count', name: 'MemberCount', desc: 'Affiche le compteur de membres visibles en haut de la liste', cat: 'ui', icon: 'users', isNew: true,
      start() {
        const CSS =
          '.dc-mc-bar{padding:8px 14px 4px;font:700 10.5px/1.2 "gg sans",Segoe UI,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#a1a1aa;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:4px}';
        setStyle('dc-p-mc', CSS);
        const update = () => {
          const wrap = document.querySelector('[class*="membersWrap_"]');
          if (!wrap) return;
          const total = wrap.querySelectorAll('[class*="member_"]').length;
          if (!total) return;
          let bar = wrap.querySelector('.dc-mc-bar');
          if (!bar) {
            bar = document.createElement('div');
            bar.className = 'dc-mc-bar';
            wrap.prepend(bar);
          }
          const txt = `${L('Membres affichés', 'Visible members')} · ${total}`;
          if (bar.textContent !== txt) bar.textContent = txt;
        };
        update();
        const off = addTask('member-count', update);
        return chain(off, () => {
          setStyle('dc-p-mc', '');
          document.querySelectorAll('.dc-mc-bar').forEach((b) => b.remove());
        });
      }
    },
    {
      id: 'plain-folder-icon', name: 'PlainFolderIcon', desc: 'Masque les mini-icônes dans les dossiers de serveurs', cat: 'ui', icon: 'layout', isNew: true,
      start: cssPlugin(
        'plain-folder-icon',
        '[class*="closedFolderIconWrapper_"] [class*="guildIcon_"]{opacity:0!important}'
      )
    },
    {
      id: 'custom-title', name: 'Title', desc: 'Remplace « Discord » par « DreamCord » dans le titre', cat: 'ui', icon: 'sparkle', isNew: true,
      start() {
        const fix = () => {
          if (document.title && /\bDiscord\b/.test(document.title)) {
            document.title = document.title.replace(/\bDiscord\b/g, 'DreamCord');
          }
        };
        fix();
        const iv = setInterval(fix, 2000);
        return () => {
          clearInterval(iv);
          if (document.title && /\bDreamCord\b/.test(document.title)) {
            document.title = document.title.replace(/\bDreamCord\b/g, 'Discord');
          }
        };
      }
    },
    {
      id: 'unindent', name: 'Unindent', desc: 'Supprime l’indentation inutile dans les blocs de code', cat: 'chat', icon: 'code', isNew: true,
      start() {
        const clean = () => {
          document.querySelectorAll('pre > code:not([data-dc-unindent])').forEach((code) => {
            code.dataset.dcUnindent = '1';
            if (code.children.length > 0) return;
            const lines = (code.textContent || '').split('\n');
            const indents = lines.filter((l) => l.trim()).map((l) => (l.match(/^[ \t]*/)?.[0] || '').length);
            const min = indents.length ? Math.min(...indents) : 0;
            if (min > 0) code.textContent = lines.map((l) => l.slice(min)).join('\n');
          });
        };
        clean();
        const off = addTask('unindent', clean);
        return chain(off, () => {
          document.querySelectorAll('code[data-dc-unindent]').forEach((c) => delete c.dataset.dcUnindent);
        });
      }
    },
    {
      id: 'double-emoji', name: 'DoubleEmoji', desc: 'Garde le sélecteur d’emojis ouvert pour en cliquer plusieurs', cat: 'chat', icon: 'sparkle', isNew: true,
      start() {
        return listen(document, 'click', (e) => {
          if (e.shiftKey || !e.isTrusted) return;
          const btn = e.target?.closest?.('[class*="emojiPicker_"] button[data-type="emoji"], [id*="emoji-picker"] button[class*="emojiItem_"]');
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true, view: window }));
        }, true);
      }
    },
    {
      id: 'fix-codeblock-gap', name: 'FixCodeblockGap', desc: 'Supprime l’espace vide inutile sous les blocs de code', cat: 'chat', icon: 'code', isNew: true,
      start: cssPlugin('fix-codeblock-gap', 'pre:has(>code){margin-bottom:2px!important}pre>code{padding-bottom:6px!important}')
    },
    {
      id: 'voice-chat-double-click', name: 'VoiceChatDoubleClick', desc: 'Double-clic requis pour rejoindre un salon vocal', cat: 'tools', icon: 'mic', isNew: true,
      start() {
        return listen(document, 'click', (e) => {
          if (e.detail >= 2 || !e.isTrusted) return;
          const vc = e.target?.closest?.('a[class*="link_"][aria-label*="vocal" i], a[class*="link_"][aria-label*="voice" i], [class*="modeConnected_"] ~ a, [class*="iconContainer_"] svg[class*="icon_"]');
          const link = vc?.closest?.('a[class*="link_"]');
          if (!link) return;
          const lbl = (link.getAttribute('aria-label') || '').toLowerCase();
          if (!lbl.includes('vocal') && !lbl.includes('voice')) return;
          e.preventDefault();
          e.stopPropagation();
        }, true);
      }
    },
    {
      id: 'message-colors', name: 'MessageColors', desc: 'Affiche un aperçu couleur à côté des codes hex (#FF0042)', cat: 'chat', icon: 'drop', isNew: true,
      start() {
        const CSS = '.dc-hex-dot{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid rgba(255,255,255,.28);margin:0 4px 0 2px;vertical-align:-1px;cursor:pointer}';
        setStyle('dc-p-msgcolors', CSS);
        const scan = () => {
          document.querySelectorAll('[id^="message-content-"]:not([data-dc-hex])').forEach((el) => {
            el.dataset.dcHex = '1';
            const txt = el.textContent || '';
            const m = txt.match(/#[0-9a-fA-F]{6}\b/);
            if (!m) return;
            const dot = document.createElement('span');
            dot.className = 'dc-hex-dot';
            dot.style.background = m[0];
            dot.title = `${m[0]} (${L('Cliquer pour copier', 'Click to copy')})`;
            dot.onclick = (ev) => {
              ev.stopPropagation();
              navigator.clipboard?.writeText(m[0]);
              showToast(L(`Couleur copiée : ${m[0]}`, `Color copied: ${m[0]}`), 'ok');
            };
            el.appendChild(dot);
          });
        };
        scan();
        const off = addTask('message-colors', scan);
        return chain(off, () => {
          setStyle('dc-p-msgcolors', '');
          document.querySelectorAll('.dc-hex-dot').forEach((d) => d.remove());
          document.querySelectorAll('[data-dc-hex]').forEach((e) => delete e.dataset.dcHex);
        });
      }
    },
    {
      id: 'clean-channel-name', name: 'CleanChannelName', desc: 'Retire les emojis et symboles décoratifs des noms de salons', cat: 'ui', icon: 'hash', isNew: true,
      start() {
        const clean = () => {
          document.querySelectorAll('[class*="sidebar_"] [class*="name_"]:not([data-dc-ccn])').forEach((el) => {
            const orig = el.textContent || '';
            const stripped = orig.replace(/^[\p{Emoji}\p{Symbol}\p{Punctuation}\s│┃┊║•・─━]+/u, '').trim();
            if (!stripped || stripped === orig) return;
            el.dataset.dcCcn = orig;
            el.textContent = stripped;
          });
        };
        clean();
        const off = addTask('clean-channel-name', clean);
        return chain(off, () => {
          document.querySelectorAll('[data-dc-ccn]').forEach((el) => {
            el.textContent = el.dataset.dcCcn;
            delete el.dataset.dcCcn;
          });
        });
      }
    },
    {
      id: 'cleaner-channel-groups', name: 'CleanerChannelGroups', desc: 'Masque tous les salons dans les catégories repliées', cat: 'ui', icon: 'layout', isNew: true,
      start: cssPlugin('cleaner-channel-groups', '[class*="containerDefault_"]:has([class*="collapsed_"]) ~ [class*="containerDefault_"] [class*="unread_"]{opacity:.35}')
    },
    {
      id: 'collapsible-ui', name: 'CollapsibleUI', desc: 'Boutons rapides pour replier salons et liste des membres', cat: 'ui', icon: 'layout', isNew: true,
      start() {
        let hideSide = false;
        let hideMem = false;
        const apply = () => {
          const css =
            '.dc-cui-btn{width:26px;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#a1a1aa;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-right:4px;font:700 11px/1 sans-serif;transition:background .12s,color .12s}' +
            '.dc-cui-btn:hover,.dc-cui-btn.on{background:#fff;color:#09090b;border-color:#fff}' +
            (hideSide ? '[class*="sidebar_"]{display:none!important}' : '') +
            (hideMem ? '[class*="membersWrap_"]{display:none!important}' : '');
          setStyle('dc-p-cui', css);
        };
        const inject = () => {
          const bar = document.querySelector('[class*="upperContainer_"] [class*="toolbar_"]');
          if (!bar || bar.querySelector('.dc-cui-btn')) return;
          const b1 = document.createElement('button');
          b1.type = 'button';
          b1.className = 'dc-cui-btn';
          b1.textContent = '◧';
          b1.title = L('Afficher / masquer la barre des salons', 'Toggle channel sidebar');
          b1.onclick = () => {
            hideSide = !hideSide;
            b1.classList.toggle('on', hideSide);
            apply();
          };
          const b2 = document.createElement('button');
          b2.type = 'button';
          b2.className = 'dc-cui-btn';
          b2.textContent = '◨';
          b2.title = L('Afficher / masquer la liste des membres', 'Toggle member list');
          b2.onclick = () => {
            hideMem = !hideMem;
            b2.classList.toggle('on', hideMem);
            apply();
          };
          bar.prepend(b2);
          bar.prepend(b1);
        };
        apply();
        inject();
        const off = addTask('collapsible-ui', inject);
        return chain(off, () => {
          setStyle('dc-p-cui', '');
          document.querySelectorAll('.dc-cui-btn').forEach((b) => b.remove());
        });
      }
    },
    {
      id: 'color-sighted', name: 'ColorSighted', desc: 'Pastilles de statut rondes classiques (style Discord 2016)', cat: 'ui', icon: 'eye', isNew: true,
      start: cssPlugin('color-sighted', 'rect[mask*="status-idle"],rect[mask*="status-dnd"],rect[mask*="status-offline"]{mask:url(#svg-mask-status-online)!important}')
    },
    {
      id: 'direct-file-download', name: 'DirectFileDownload', desc: 'Bouton de téléchargement direct sur les pièces jointes', cat: 'tools', icon: 'download', isNew: true,
      start() {
        const CSS = '.dc-dfd-btn{margin-left:6px;padding:2px 7px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(9,9,11,.85);color:#e4e4e7;font:700 10.5px/1.3 "gg sans",Segoe UI,sans-serif;text-decoration:none;cursor:pointer}.dc-dfd-btn:hover{background:#fff;color:#09090b}';
        setStyle('dc-p-dfd', CSS);
        const add = () => {
          document.querySelectorAll('a[href*="cdn.discordapp.com/attachments/"]:not([data-dc-dfd])').forEach((a) => {
            a.dataset.dcDfd = '1';
            if (a.querySelector('img,video') || a.parentElement?.querySelector('.dc-dfd-btn')) return;
            const dl = document.createElement('a');
            dl.className = 'dc-dfd-btn';
            dl.href = a.href;
            dl.download = '';
            dl.target = '_blank';
            dl.rel = 'noopener noreferrer';
            dl.textContent = '↓';
            dl.title = L('Télécharger directement', 'Direct download');
            a.after(dl);
          });
        };
        add();
        const off = addTask('direct-file-download', add);
        return chain(off, () => {
          setStyle('dc-p-dfd', '');
          document.querySelectorAll('.dc-dfd-btn').forEach((b) => b.remove());
          document.querySelectorAll('[data-dc-dfd]').forEach((a) => delete a.dataset.dcDfd);
        });
      }
    },
    {
      id: 'fix-images-quality', name: 'FixImagesQuality', desc: 'Charge les images du chat en résolution maximale', cat: 'ui', icon: 'wallpaper', isNew: true,
      start() {
        const upgrade = () => {
          document.querySelectorAll('li[id^="chat-messages-"] img[src*="media.discordapp.net"]:not([data-dc-hq])').forEach((img) => {
            img.dataset.dcHq = '1';
            try {
              const u = new URL(img.src);
              if (u.searchParams.has('width') || u.searchParams.has('height')) {
                u.searchParams.set('quality', 'lossless');
                img.src = u.toString();
              }
            } catch {}
          });
        };
        upgrade();
        const off = addTask('fix-images-quality', upgrade);
        return chain(off, () => document.querySelectorAll('img[data-dc-hq]').forEach((i) => delete i.dataset.dcHq));
      }
    },
    {
      id: 'send-timestamps', name: 'SendTimestamps', desc: 'Bouton horloge dans le chat pour insérer un horodatage <t:...>', cat: 'chat', icon: 'clock', isNew: true,
      start() {
        const CSS = '.dc-ts-btn{width:28px;height:28px;border-radius:6px;border:0;background:transparent;color:#a1a1aa;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .12s,color .12s}.dc-ts-btn:hover{background:rgba(255,255,255,.09);color:#fff}';
        setStyle('dc-p-sendts', CSS);
        const inject = () => {
          const bar = document.querySelector('[class*="channelTextArea_"] [class*="buttons_"]');
          if (!bar || bar.querySelector('.dc-ts-btn')) return;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'dc-ts-btn';
          b.title = L('Insérer un horodatage Discord (<t:…:R>)', 'Insert Discord timestamp (<t:...:R>)');
          setHTML(b, svgStr('clock', 15));
          b.onclick = (ev) => {
            ev.stopPropagation();
            const ts = `<t:${Math.floor(Date.now() / 1000)}:R>`;
            const tb = document.querySelector('[class*="channelTextArea_"] [role="textbox"]');
            if (tb) {
              tb.focus();
              document.execCommand('insertText', false, ts);
            } else {
              navigator.clipboard?.writeText(ts);
            }
            showToast(L(`Horodatage inséré : ${ts}`, `Timestamp inserted: ${ts}`), 'ok');
          };
          bar.prepend(b);
        };
        inject();
        const off = addTask('send-timestamps', inject);
        return chain(off, () => {
          setStyle('dc-p-sendts', '');
          document.querySelectorAll('.dc-ts-btn').forEach((b) => b.remove());
        });
      }
    },
    {
      id: 'server-list-indicators', name: 'ServerListIndicators', desc: 'Affiche le compteur de serveurs dans la barre latérale', cat: 'ui', icon: 'layers', isNew: true,
      start() {
        const CSS = '#dc-sli-badge{margin:2px auto 6px;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#e4e4e7;font:700 10px/1.2 "gg sans",Segoe UI,sans-serif;text-align:center;width:44px;user-select:none}';
        setStyle('dc-p-sli', CSS);
        const update = () => {
          const nav = document.querySelector('nav[class*="guilds_"] [class*="scroller_"]');
          if (!nav) return;
          const count = nav.querySelectorAll('[data-list-item-id^="guildsnav___"]').length;
          let el = document.getElementById('dc-sli-badge');
          if (!el) {
            el = document.createElement('div');
            el.id = 'dc-sli-badge';
            nav.prepend(el);
          }
          const txt = `${count} SRV`;
          if (el.textContent !== txt) el.textContent = txt;
        };
        update();
        const off = addTask('server-list-indicators', update);
        return chain(off, () => {
          setStyle('dc-p-sli', '');
          document.getElementById('dc-sli-badge')?.remove();
        });
      }
    },
    {
      id: 'show-all-message-buttons', name: 'ShowAllMessageButtons', desc: 'Affiche les boutons d’action des messages sans maintenir Maj', cat: 'chat', icon: 'zap', isNew: true,
      start: cssPlugin('show-all-message-buttons', '[class*="message_"]:hover [class*="buttonsInner_"]{opacity:1!important;pointer-events:auto!important}')
    },
    {
      id: 'hide-media', name: 'HideMedia', desc: 'Bouton discret pour masquer/afficher les médias d’un message', cat: 'privacy', icon: 'eyeoff', isNew: true,
      start() {
        const CSS =
          '.dc-hm-btn{position:absolute;top:6px;left:6px;z-index:4;height:22px;padding:0 7px;border-radius:5px;border:1px solid rgba(255,255,255,.16);background:rgba(9,9,11,.86);color:#e4e4e7;font:700 10px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;opacity:0;transition:opacity .15s}' +
          '[class*="imageWrapper_"]:hover .dc-hm-btn,[class*="mediaAttachmentsContainer_"]:hover .dc-hm-btn,.dc-hm-hidden .dc-hm-btn{opacity:1}' +
          '.dc-hm-hidden img,.dc-hm-hidden video{filter:blur(26px) brightness(.25)!important;transition:filter .15s}';
        setStyle('dc-p-hm', CSS);
        const add = () => {
          document.querySelectorAll('li[id^="chat-messages-"] [class*="imageWrapper_"]:not([data-dc-hm])').forEach((w) => {
            w.dataset.dcHm = '1';
            if (getComputedStyle(w).position === 'static') w.style.position = 'relative';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'dc-hm-btn';
            b.textContent = L('Masquer', 'Hide');
            b.onclick = (ev) => {
              ev.stopPropagation();
              ev.preventDefault();
              const hidden = w.classList.toggle('dc-hm-hidden');
              b.textContent = hidden ? L('Afficher', 'Show') : L('Masquer', 'Hide');
            };
            w.appendChild(b);
          });
        };
        add();
        const off = addTask('hide-media', add);
        return chain(off, () => {
          setStyle('dc-p-hm', '');
          document.querySelectorAll('.dc-hm-btn').forEach((b) => b.remove());
          document.querySelectorAll('.dc-hm-hidden').forEach((w) => w.classList.remove('dc-hm-hidden'));
          document.querySelectorAll('[data-dc-hm]').forEach((w) => delete w.dataset.dcHm);
        });
      }
    },
    {
      id: 'no-dm-while-streaming', name: 'NoDMWhileStreaming', desc: 'Floute la liste des MPs et pseudos pendant un partage d’écran', cat: 'privacy', icon: 'shield', isNew: true,
      start() {
        const CSS = 'html[data-dc-streaming="1"] [class*="privateChannels_"] [class*="channel_"]{filter:blur(8px);transition:filter .15s}html[data-dc-streaming="1"] [class*="privateChannels_"] [class*="channel_"]:hover{filter:none}';
        setStyle('dc-p-nodmstream', CSS);
        const check = () => {
          const live = Boolean(document.querySelector('[class*="liveIndicator_"], [aria-label*="Arrêter le streaming" i], [aria-label*="Stop Streaming" i]'));
          root.toggleAttribute('data-dc-streaming', live);
        };
        check();
        const off = addTask('no-dm-while-streaming', check);
        return chain(off, () => {
          setStyle('dc-p-nodmstream', '');
          root.removeAttribute('data-dc-streaming');
        });
      }
    },
    {
      id: 'server-search', name: 'ServerSearch', desc: 'Recherche rapide de serveur via Ctrl+Shift+S', cat: 'tools', icon: 'globe', isNew: true,
      start() {
        const open = () => {
          document.getElementById('dc-srv-search')?.remove();
          const guilds = Array.from(document.querySelectorAll('[data-list-item-id^="guildsnav___"]')).map((el) => ({
            el,
            name: el.getAttribute('aria-label') || el.getAttribute('data-dnd-name') || el.textContent?.trim() || ''
          })).filter((g) => g.name);
          const wrap = document.createElement('div');
          wrap.id = 'dc-srv-search';
          wrap.style.cssText = 'position:fixed;inset:0;z-index:100040;background:rgba(0,0,0,.68);backdrop-filter:blur(6px);display:flex;align-items:flex-start;justify-content:center;padding-top:14vh';
          setHTML(
            wrap,
            `<div style="width:420px;max-width:92vw;border-radius:12px;background:#09090b;border:1px solid rgba(255,255,255,.14);padding:12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 24px 60px rgba(0,0,0,.8)">` +
            `<input id="dc-srvs-in" placeholder="${esc(L('Rechercher un serveur…', 'Search a server...'))}" style="height:36px;background:#111114;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:0 12px;color:#fff;font:13.5px 'gg sans',Segoe UI,sans-serif;outline:none">` +
            `<div id="dc-srvs-list" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div></div>`
          );
          document.body.appendChild(wrap);
          const inp = wrap.querySelector('#dc-srvs-in');
          const list = wrap.querySelector('#dc-srvs-list');
          const draw = () => {
            const q = inp.value.trim().toLowerCase();
            const hits = guilds.filter((g) => !q || g.name.toLowerCase().includes(q)).slice(0, 15);
            setHTML(
              list,
              hits.length
                ? hits.map((g, i) => `<button type="button" data-i="${i}" style="text-align:left;padding:8px 10px;border-radius:7px;border:0;background:transparent;color:#e4e4e7;font:600 13px 'gg sans',Segoe UI,sans-serif;cursor:pointer">${esc(g.name)}</button>`).join('')
                : `<div style="padding:14px;text-align:center;color:#71717a;font-size:12.5px">${esc(L('Aucun serveur', 'No server found'))}</div>`
            );
            list.querySelectorAll('button').forEach((b) => {
              b.onmouseenter = () => (b.style.background = 'rgba(255,255,255,.08)');
              b.onmouseleave = () => (b.style.background = 'transparent');
              b.onclick = () => {
                hits[Number(b.dataset.i)]?.el.click();
                wrap.remove();
              };
            });
          };
          draw();
          inp.oninput = draw;
          inp.onkeydown = (ev) => {
            if (ev.key === 'Escape') wrap.remove();
            if (ev.key === 'Enter') list.querySelector('button')?.click();
          };
          wrap.onclick = (ev) => { if (ev.target === wrap) wrap.remove(); };
          inp.focus();
        };
        return chain(
          listen(window, 'keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
              e.preventDefault();
              open();
            }
          }),
          () => document.getElementById('dc-srv-search')?.remove()
        );
      }
    },
    {
      id: 'command-palette', name: 'CommandPalette', desc: 'Palette de commandes rapide façon Raycast (Ctrl+Shift+P)', cat: 'tools', icon: 'zap', isNew: true,
      start() {
        const open = () => {
          document.getElementById('dc-cmdpal')?.remove();
          const actions = [
            { label: L('Ouvrir DreamCord · Plugins', 'Open DreamCord · Plugins'), fn: () => openDreamCord('plugins') },
            { label: L('Ouvrir DreamCord · Personnalisation', 'Open DreamCord · Personalization'), fn: () => openDreamCord('personalization') },
            { label: L('Ouvrir Lively Wallpaper', 'Open Lively Wallpaper'), fn: () => { subPage = 'lively-wallpaper'; openDreamCord('plugins'); } },
            { label: L('Ouvrir CSS perso', 'Open Custom CSS'), fn: () => { subPage = 'custom-css'; openDreamCord('plugins'); } },
            { label: L('Ouvrir Custom Friend', 'Open Custom Friend'), fn: () => { subPage = 'custom-friend'; openDreamCord('plugins'); } },
            { label: L('Recharger Discord', 'Reload Discord'), fn: () => location.reload() },
            { label: L('Ouvrir DevTools', 'Toggle DevTools'), fn: () => ipc('toggle-devtools') }
          ];
          const wrap = document.createElement('div');
          wrap.id = 'dc-cmdpal';
          wrap.style.cssText = 'position:fixed;inset:0;z-index:100040;background:rgba(0,0,0,.68);backdrop-filter:blur(6px);display:flex;align-items:flex-start;justify-content:center;padding-top:14vh';
          setHTML(
            wrap,
            `<div style="width:440px;max-width:92vw;border-radius:12px;background:#09090b;border:1px solid rgba(255,255,255,.14);padding:12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 24px 60px rgba(0,0,0,.8)">` +
            `<input id="dc-cp-in" placeholder="${esc(L('Taper une commande DreamCord…', 'Type a DreamCord command...'))}" style="height:36px;background:#111114;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:0 12px;color:#fff;font:13.5px 'gg sans',Segoe UI,sans-serif;outline:none">` +
            `<div id="dc-cp-list" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div></div>`
          );
          document.body.appendChild(wrap);
          const inp = wrap.querySelector('#dc-cp-in');
          const list = wrap.querySelector('#dc-cp-list');
          const draw = () => {
            const q = inp.value.trim().toLowerCase();
            const hits = actions.filter((a) => !q || a.label.toLowerCase().includes(q));
            setHTML(
              list,
              hits.map((a, i) => `<button type="button" data-i="${i}" style="text-align:left;padding:8px 10px;border-radius:7px;border:0;background:transparent;color:#e4e4e7;font:600 13px 'gg sans',Segoe UI,sans-serif;cursor:pointer">${esc(a.label)}</button>`).join('')
            );
            list.querySelectorAll('button').forEach((b) => {
              b.onmouseenter = () => (b.style.background = 'rgba(255,255,255,.08)');
              b.onmouseleave = () => (b.style.background = 'transparent');
              b.onclick = () => {
                wrap.remove();
                hits[Number(b.dataset.i)]?.fn();
              };
            });
          };
          draw();
          inp.oninput = draw;
          inp.onkeydown = (ev) => {
            if (ev.key === 'Escape') wrap.remove();
            if (ev.key === 'Enter') list.querySelector('button')?.click();
          };
          wrap.onclick = (ev) => { if (ev.target === wrap) wrap.remove(); };
          inp.focus();
        };
        return chain(
          listen(window, 'keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
              e.preventDefault();
              open();
            }
          }),
          () => document.getElementById('dc-cmdpal')?.remove()
        );
      }
    },
    {
      id: 'quick-reply', name: 'QuickReply', desc: 'Ctrl + Flèche Haut pour répondre vite au dernier message', cat: 'chat', icon: 'send', isNew: true,
      start() {
        return listen(document, 'keydown', (e) => {
          if (!e.ctrlKey || e.shiftKey || e.altKey || e.key !== 'ArrowUp') return;
          const msgs = document.querySelectorAll('li[id^="chat-messages-"]');
          const last = msgs[msgs.length - 1];
          const replyBtn = last?.querySelector('[aria-label*="Répondre" i], [aria-label*="Reply" i]');
          if (!replyBtn) return;
          e.preventDefault();
          replyBtn.click();
        }, true);
      }
    },
    {
      id: 'recent-dm-switcher', name: 'RecentDMSwitcher', desc: 'Ctrl + Shift + E pour basculer entre tes 2 derniers salons', cat: 'tools', icon: 'layers', isNew: true,
      start() {
        let prevUrl = '';
        let curUrl = location.pathname;
        const track = setInterval(() => {
          if (location.pathname !== curUrl) {
            prevUrl = curUrl;
            curUrl = location.pathname;
          }
        }, 700);
        return chain(
          () => clearInterval(track),
          listen(window, 'keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e') && prevUrl) {
              e.preventDefault();
              const link = document.querySelector(`a[href="${CSS.escape(prevUrl)}"]`);
              if (link) link.click();
            }
          })
        );
      }
    },
    {
      id: 'pin-icon', name: 'PinIcon', desc: 'Met en valeur les messages épinglés dans le fil', cat: 'chat', icon: 'sparkle', isNew: true,
      start: cssPlugin('pin-icon', '[class*="systemMessage_"]:has(svg){background:rgba(255,255,255,.035);border-left:2px solid #ffffff;border-radius:0 6px 6px 0;padding-left:6px}')
    },
    {
      id: 'hide-server-boosts', name: 'HideServerBoosts', desc: 'Masque la barre de boosts et pubs Nitro dans les serveurs', cat: 'ui', icon: 'eyeoff', isNew: true,
      start: cssPlugin('hide-server-boosts', '[class*="guildBoostProgressBar_"],[class*="premiumBanner_"],[class*="upsellBanner_"]{display:none!important}')
    },
    {
      id: 'hide-gift-sticker', name: 'HideGiftSticker', desc: 'Épure la barre de saisie (cache Cadeau, GIF et Stickers)', cat: 'ui', icon: 'layout', isNew: true,
      start: cssPlugin('hide-gift-sticker', '[class*="channelTextArea_"] button[aria-label*="cadeau" i],[class*="channelTextArea_"] button[aria-label*="gift" i],[class*="channelTextArea_"] button[aria-label*="GIF" i],[class*="channelTextArea_"] button[aria-label*="autocollant" i],[class*="channelTextArea_"] button[aria-label*="sticker" i]{display:none!important}')
    },
    {
      id: 'hide-voice-names', name: 'HideVoiceNames', desc: 'Masque les noms des membres dans les salons vocaux', cat: 'privacy', icon: 'eyeoff', isNew: true,
      start: cssPlugin('hide-voice-names', '[class*="voiceUser_"] [class*="username_"]{filter:blur(6px);transition:filter .15s}[class*="voiceUser_"]:hover [class*="username_"]{filter:none}')
    },
    {
      id: 'wide-chat', name: 'WideChat', desc: 'Élargit la zone des messages en réduisant les marges', cat: 'ui', icon: 'layout', isNew: true,
      start: cssPlugin('wide-chat', '[class*="cozyMessage_"]{padding-left:56px!important;padding-right:16px!important}[class*="cozy_"] [class*="avatar_"]{left:10px!important}')
    },
    {
      id: 'compact-channels', name: 'CompactChannels', desc: 'Resserre la liste des salons pour en afficher plus', cat: 'ui', icon: 'hash', isNew: true,
      start: cssPlugin('compact-channels', '[class*="sidebar_"] [class*="link_"]{padding-top:3px!important;padding-bottom:3px!important}[class*="sidebar_"] [class*="containerDefault_"]{padding-top:1px!important}')
    },
    {
      id: 'hide-typing-bar', name: 'HideTypingBar', desc: 'Masque l’indicateur « est en train d’écrire… » en bas', cat: 'ui', icon: 'eyeoff', isNew: true,
      start: cssPlugin('hide-typing-bar', '[class*="typing_"]{display:none!important}')
    },
    {
      id: 'copy-message-link', name: 'CopyMessageText', desc: 'Alt + double-clic sur un message pour copier son texte', cat: 'tools', icon: 'copy', isNew: true,
      start() {
        return listen(document, 'dblclick', (e) => {
          if (!e.altKey) return;
          const content = e.target?.closest?.('li[id^="chat-messages-"]')?.querySelector('[id^="message-content-"]');
          const txt = content?.innerText?.trim();
          if (!txt) return;
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard?.writeText(txt);
          showToast(L('Texte du message copié', 'Message text copied'), 'ok');
        }, true);
      }
    },
    {
      id: 'auto-focus-chat', name: 'AutoFocusChat', desc: 'Donne automatiquement le focus au chat dès que tu tapes', cat: 'chat', icon: 'type', isNew: true,
      start() {
        return listen(document, 'keydown', (e) => {
          if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
          const ae = document.activeElement;
          if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
          if (document.getElementById('dc-settings-embedded') || document.getElementById('dc-cf-modal')) return;
          const tb = document.querySelector('[class*="channelTextArea_"] [role="textbox"]');
          if (tb) tb.focus();
        });
      }
    },
    {
      id: 'square-avatars', name: 'SquareAvatars', desc: 'Avatars carrés aux coins légèrement arrondis partout', cat: 'ui', icon: 'users', isNew: true,
      start: cssPlugin('square-avatars', 'img[class*="avatar_"],svg[class*="mask_"] foreignObject{border-radius:6px!important;mask:none!important}')
    },
    {
      id: 'hide-avatars-chat', name: 'HideAvatarsChat', desc: 'Mode texte minimaliste : masque les avatars dans le chat', cat: 'ui', icon: 'eyeoff', isNew: true,
      start: cssPlugin('hide-avatars-chat', 'li[id^="chat-messages-"] [class*="avatar_"]{display:none!important}li[id^="chat-messages-"] [class*="cozy_"]{padding-left:18px!important}')
    },
    {
      id: 'reading-mode', name: 'ReadingMode', desc: 'Centre le chat sur une largeur de lecture confortable', cat: 'ui', icon: 'type', isNew: true,
      start: cssPlugin('reading-mode', '[class*="messagesWrapper_"] [class*="scrollerInner_"]{max-width:860px!important;margin:0 auto!important}')
    }
  ];

  // ============================================================
  //  Pack +125 Plugins (inspirés de NightCord / Equicord)
  // ============================================================
  const playSynthTone = (freq = 520, dur = 0.045, type = 'sine', vol = 0.05) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (window._dcAudioCtx ||= new AC());
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {}
  };

  const replaceChatboxText = (tb, next) => {
    if (!tb) return;
    try {
      tb.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(tb);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, next);
    } catch {}
  };

  const activeSendTransforms = new Set();
  let offSendTransformGlobal = null;
  const sendTransformPlugin = (transformFn) => () => {
    activeSendTransforms.add(transformFn);
    if (!offSendTransformGlobal) {
      offSendTransformGlobal = listen(
        document,
        'keydown',
        (e) => {
          if (e.isComposing || e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !activeSendTransforms.size) return;
          const tb = e.target?.closest?.('[class*="channelTextArea_"] [role="textbox"]');
          if (!tb) return;
          const orig = (tb.innerText || tb.textContent || '').trim();
          if (!orig) return;
          let cur = orig;
          for (const fn of activeSendTransforms) {
            try {
              const res = fn(cur);
              if (typeof res === 'string') cur = res;
            } catch {}
          }
          if (cur !== orig) replaceChatboxText(tb, cur);
        },
        true
      );
    }
    return () => {
      activeSendTransforms.delete(transformFn);
      if (!activeSendTransforms.size && offSendTransformGlobal) {
        offSendTransformGlobal();
        offSendTransformGlobal = null;
      }
    };
  };

  const chatBarBtnPlugin = (btnId, title, svgHtml, onClick) => () => {
    const inject = () => {
      if (document.getElementById(btnId)) return;
      const bar = document.querySelector('[class*="channelTextArea_"] [class*="buttons_"]');
      if (!bar) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = btnId;
      b.className = 'dc-fms-btn';
      b.title = title;
      setHTML(b, svgHtml);
      b.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onClick(b);
      };
      bar.prepend(b);
    };
    inject();
    const off = addTask(btnId, inject);
    return chain(off, () => document.getElementById(btnId)?.remove());
  };

  const hdrBtnPlugin = (btnId, title, svgHtml, onClick) => () => {
    const inject = () => {
      if (document.getElementById(btnId)) return;
      const bar = document.querySelector('[class*="upperContainer_"] [class*="toolbar_"]');
      if (!bar) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = btnId;
      b.className = 'dc-fms-btn';
      b.title = title;
      setHTML(b, svgHtml);
      b.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onClick(b);
      };
      bar.prepend(b);
    };
    inject();
    const off = addTask(btnId, inject);
    return chain(off, () => document.getElementById(btnId)?.remove());
  };

  const EXTRA_PLUGINS = [
    // --- UI & Apparence (40) ---
    { id: 'always-expand-roles', name: 'AlwaysExpandRoles', desc: 'Développe toujours toute la liste des rôles dans les profils', cat: 'ui', icon: 'users', start: cssPlugin('always-expand-roles', '[class*="roles_"]{max-height:none!important;overflow:visible!important}[class*="expandButton_"]{display:none!important}') },
    { id: 'always-animate', name: 'AlwaysAnimate', desc: 'Anime tous les avatars, bannières, emojis et icônes en continu', cat: 'ui', icon: 'sparkle', start: () => addTask('always-animate', () => document.querySelectorAll('img[src*=".webp"],img[src*=".png"]').forEach((i) => { if (i.src.includes('/avatars/') && i.src.includes('a_') && !i.src.includes('.gif')) i.src = i.src.replace(/\.(webp|png)/, '.gif'); })) },
    { id: 'full-vc-pfp', name: 'FullVCPFP', desc: 'Affiche l’avatar en plein cadre sur les tuiles vocales', cat: 'ui', icon: 'users', start: cssPlugin('full-vc-pfp', '[class*="tile_"] [class*="avatar_"]{width:100%!important;height:100%!important;border-radius:10px!important}') },
    { id: 'no-mosaic', name: 'NoMosaic', desc: 'Supprime la mosaïque d’images Discord et empile proprement', cat: 'ui', icon: 'layout', start: cssPlugin('no-mosaic', '[class*="mediaAttachmentsContainer_"]{display:flex!important;flex-direction:column!important;gap:6px!important}[class*="imageWrapper_"]{max-width:460px!important}') },
    { id: 'no-role-headers', name: 'NoRoleHeaders', desc: 'Masque les en-têtes de rôles dans la liste des membres', cat: 'ui', icon: 'users', start: cssPlugin('no-role-headers', '[class*="membersGroup_"]{display:none!important}') },
    { id: 'no-typing-animation', name: 'NoTypingAnimation', desc: 'Désactive l’animation des trois points de saisie (économie CPU)', cat: 'ui', icon: 'zap', start: cssPlugin('no-typing-animation', '[class*="typingDots_"] svg,[class*="ellipsis_"]{animation:none!important}') },
    { id: 'no-profile-themes', name: 'NoProfileThemes', desc: 'Désactive les thèmes colorés Nitro sur les profils des autres', cat: 'ui', icon: 'eyeoff', start: cssPlugin('no-profile-themes', '[class*="userPopoutOuter_"],[class*="userProfileOuter_"]{--profile-gradient-primary-color:#111214!important;--profile-gradient-secondary-color:#111214!important;--profile-body-background-color:#111214!important}') },
    { id: 'no-nitro-upsell', name: 'NoNitroUpsell', desc: 'Supprime les bannières et incitations Nitro partout', cat: 'ui', icon: 'shield', start: cssPlugin('no-nitro-upsell', '[class*="upsell"],[class*="premiumIcon_"],[class*="tryItOutSection_"],[href="/store"]{display:none!important}') },
    { id: 'no-pending-count', name: 'NoPendingCount', desc: 'Masque le badge de demandes d’amis et offres en attente', cat: 'ui', icon: 'eyeoff', start: cssPlugin('no-pending-count', '[href="/channels/@me"] [class*="numberBadge_"]{display:none!important}') },
    { id: 'no-onboarding-delay', name: 'NoOnboardingDelay', desc: 'Accélère les transitions d’intégration de serveur', cat: 'ui', icon: 'zap', start: cssPlugin('no-onboarding-delay', '[class*="onboarding"]{transition-duration:0ms!important;animation-duration:0ms!important}') },
    { id: 'no-system-badge', name: 'NoSystemBadge', desc: 'Masque le badge numérique non lu sur la barre des tâches', cat: 'ui', icon: 'eyeoff', start: () => { const clean = () => { if (/^\(\d+\)\s*/.test(document.title)) document.title = document.title.replace(/^\(\d+\)\s*/, ''); }; clean(); const tEl = document.querySelector('title'); const mo = tEl ? new MutationObserver(clean) : null; if (mo && tEl) mo.observe(tEl, { childList: true }); return chain(cssPlugin('no-system-badge', '[class*="upperBadge_"] [class*="numberBadge_"]{display:none!important}')(), () => mo?.disconnect()); } },
    { id: 'hide-chat-buttons', name: 'HideChatButtons', desc: 'Masque les boutons Cadeau, GIF, Autocollant et Applications', cat: 'ui', icon: 'layout', start: cssPlugin('hide-chat-buttons', '[class*="channelTextArea_"] [aria-label*="cadeau" i],[class*="channelTextArea_"] [aria-label*="gift" i],[class*="channelTextArea_"] [aria-label*="GIF" i],[class*="channelTextArea_"] [aria-label*="autocollant" i],[class*="channelTextArea_"] [aria-label*="sticker" i]{display:none!important}') },
    { id: 'theme-attributes', name: 'ThemeAttributes', desc: 'Ajoute des attributs data-* utiles aux créateurs de thèmes CSS', cat: 'ui', icon: 'braces', start: () => addTask('theme-attributes', () => document.querySelectorAll('li[id^="chat-messages-"]').forEach((el) => { if (!el.dataset.dcMsg) el.dataset.dcMsg = el.id; })) },
    { id: 'lightcord', name: 'Lightcord', desc: 'Expérience allégée : masque décorations, plaques et bruits visuels', cat: 'ui', icon: 'zap', start: cssPlugin('lightcord', '[class*="avatarDecoration_"],[class*="profileEffects_"],[class*="clanTagChiplet_"]{display:none!important}') },
    { id: 'compact-mode', name: 'CompactMode', desc: 'Réduit la taille des espacements et barres latérales', cat: 'ui', icon: 'layout', start: cssPlugin('compact-mode', '[class*="sidebar_"]{width:210px!important}[class*="channel_"]{min-height:28px!important}') },
    { id: 'client-theme', name: 'ClientTheme', desc: 'Applique une teinte de thème client globale subtile', cat: 'ui', icon: 'sparkle', start: cssPlugin('client-theme', ':root{--background-primary:#0b0c10!important;--background-secondary:#0f1117!important;--background-tertiary:#07080c!important}') },
    { id: 'bigger-stream-preview', name: 'BiggerStreamPreview', desc: 'Agrandit les aperçus de partage d’écran au survol', cat: 'ui', icon: 'eye', start: cssPlugin('bigger-stream-preview', '[class*="streamPreview_"]{width:380px!important;max-width:none!important}') },
    { id: 'better-gif-picker', name: 'BetterGifPicker', desc: 'Met en valeur l’onglet des GIF favoris et agrandit le sélecteur', cat: 'ui', icon: 'sparkle', start: cssPlugin('better-gif-picker', '[class*="expressionPicker_"]{min-height:500px!important}') },
    { id: 'better-folders', name: 'BetterFolders', desc: 'Améliore la visibilité des dossiers de serveurs ouverts', cat: 'ui', icon: 'layers', start: cssPlugin('better-folders', '[class*="expandedFolderBackground_"]{border-radius:14px!important;background:rgba(255,255,255,.06)!important}') },
    { id: 'custom-folder-icons', name: 'CustomFolderIcons', desc: 'Donne un style épuré et contrasté aux icônes de dossiers', cat: 'ui', icon: 'layers', start: cssPlugin('custom-folder-icons', '[class*="folderIconWrapper_"]{border:1px solid rgba(255,255,255,.12)!important;border-radius:12px!important}') },
    { id: 'server-folder-icons', name: 'ServerFolderIcons', desc: 'Agrandi les miniatures de serveurs dans les dossiers', cat: 'ui', icon: 'layers', start: cssPlugin('server-folder-icons', '[class*="folder_"] [class*="miniGuilds_"] img{border-radius:6px!important}') },
    { id: 'banners-everywhere', name: 'BannersEverywhere', desc: 'Ajoute un léger reflet coloré aux profils dans la liste des membres', cat: 'ui', icon: 'wallpaper', start: cssPlugin('banners-everywhere', '[class*="member_"]:hover{background:linear-gradient(90deg,rgba(88,101,242,.16),transparent)!important}') },
    { id: 'unlocked-avatar-zoom', name: 'UnlockedAvatarZoom', desc: 'Débloque le zoom maximal dans l’éditeur de recadrage d’avatar', cat: 'ui', icon: 'zoom', start: cssPlugin('unlocked-avatar-zoom', '[class*="imageEditor_"] input[type="range"]{accent-color:#5865f2!important}') },
    { id: 'better-image-editor', name: 'BetterImageEditor', desc: 'Améliore le contraste de la grille de recadrage d’avatar/bannière', cat: 'ui', icon: 'wallpaper', start: cssPlugin('better-image-editor', '[class*="cropOverlay_"]{border-color:rgba(255,255,255,.65)!important}') },
    { id: 'smooth-type', name: 'SmoothType', desc: 'Transition fluide du curseur et du texte dans la zone de saisie', cat: 'ui', icon: 'type', start: cssPlugin('smooth-type', '[class*="channelTextArea_"] [role="textbox"]{transition:all .12s ease!important}') },
    { id: 'channel-badges', name: 'ChannelBadges', desc: 'Ajoute un indicateur visuel discret devant les salons vocaux/textuels', cat: 'ui', icon: 'hash', start: cssPlugin('channel-badges', '[class*="containerDefault_"] [class*="icon_"]{opacity:.85!important;filter:drop-shadow(0 0 2px rgba(255,255,255,.2))}') },
    { id: 'always-expand-profiles', name: 'AlwaysExpandProfiles', desc: 'Ouvre automatiquement le profil complet au clic sur un utilisateur', cat: 'ui', icon: 'users', start: () => addTask('always-expand-profiles', () => { const btn = document.querySelector('[class*="userPopout"] [aria-label*="profil" i],[class*="userPopout"] button[class*="viewFullProfile"]'); if (btn && !btn.dataset.dcExp) { btn.dataset.dcExp = '1'; btn.click(); } }) },
    { id: 'better-settings', name: 'BetterSettings', desc: 'Supprime l’animation d’ouverture des paramètres Discord', cat: 'ui', icon: 'zap', start: cssPlugin('better-settings', '[class*="standardSidebarView_"]{animation:none!important;transition:none!important}') },
    { id: 'font-loader', name: 'FontLoader', desc: 'Charge une police Google Fonts propre (Inter / Space Grotesk)', cat: 'ui', icon: 'type', start: () => { const l = document.createElement('link'); l.id = 'dc-font-loader'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'; document.head.appendChild(l); setStyle('dc-font-loader-css', 'body,button,input,textarea{font-family:"Inter","gg sans",sans-serif!important}'); return () => { document.getElementById('dc-font-loader')?.remove(); setStyle('dc-font-loader-css', ''); }; } },
    { id: 'quick-theme-switcher', name: 'QuickThemeSwitcher', desc: 'Ctrl+Maj+T : alterne rapidement les palettes DreamCord', cat: 'ui', icon: 'sparkle', start: () => listen(document, 'keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') { const pals = ['amoled', 'midnight', 'slate', 'nord']; const cur = config.appearance?.palette || 'amoled'; const nxt = pals[(pals.indexOf(cur) + 1) % pals.length]; config.appearance.palette = nxt; applyAppearance?.(); saveConfig?.(); toast('Palette : ' + nxt); } }) },
    { id: 'snowfall', name: 'Snowfall', desc: 'Fait neiger doucement en arrière-plan sur Discord', cat: 'ui', icon: 'sparkle', start: () => { document.getElementById('dc-snow')?.remove(); const c = document.createElement('canvas'); c.id = 'dc-snow'; c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99990'; document.body.appendChild(c); const ctx = c.getContext('2d'); let w = (c.width = innerWidth), h = (c.height = innerHeight), stop = false; const fl = Array.from({ length: 48 }, () => ({ x: Math.random() * w, y: Math.random() * h, r: 1 + Math.random() * 2.2, v: 0.6 + Math.random() * 1.2 })); const loop = () => { if (stop) return; if (c.width !== innerWidth || c.height !== innerHeight) { w = c.width = innerWidth; h = c.height = innerHeight; } ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(255,255,255,0.55)'; fl.forEach((f) => { f.y += f.v; f.x += Math.sin(f.y * 0.02) * 0.4; if (f.y > h) { f.y = -5; f.x = Math.random() * w; } ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }); requestAnimationFrame(loop); }; loop(); return () => { stop = true; c.remove(); }; } },
    { id: 'party-mode', name: 'PartyMode', desc: 'Affiche un petit effet confettis quand tu envoies un message', cat: 'ui', icon: 'sparkle', start: () => listen(document, 'keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target?.closest?.('[class*="channelTextArea_"]')) { for (let i = 0; i < 10; i++) { const d = document.createElement('div'); d.style.cssText = `position:fixed;left:${50 + (Math.random() - 0.5) * 30}vw;bottom:60px;width:6px;height:6px;border-radius:50%;background:hsl(${Math.random() * 360},90%,60%);pointer-events:none;z-index:99999;transition:transform .7s ease-out,opacity .7s`; document.body.appendChild(d); requestAnimationFrame(() => { d.style.transform = `translate(${(Math.random() - 0.5) * 180}px,${-80 - Math.random() * 140}px)`; d.style.opacity = '0'; }); setTimeout(() => d.remove(), 750); } } }, true) },
    { id: 'cursor-buddy', name: 'CursorBuddy', desc: 'Ajoute un petit point lumineux qui suit ton curseur', cat: 'ui', icon: 'sparkle', start: () => { document.getElementById('dc-cursor-buddy')?.remove(); const el = document.createElement('div'); el.id = 'dc-cursor-buddy'; el.style.cssText = 'position:fixed;width:12px;height:12px;border-radius:50%;background:rgba(88,101,242,.75);box-shadow:0 0 12px rgba(88,101,242,.9);pointer-events:none;z-index:99999;transition:transform .06s linear'; document.body.appendChild(el); const off = listen(document, 'mousemove', (e) => { el.style.transform = `translate(${e.clientX + 10}px,${e.clientY + 10}px)`; }); return chain(off, () => el.remove()); } },
    { id: 'discord-dev-banner', name: 'DiscordDevBanner', desc: 'Affiche une bannière discrète de version DreamCord / Build', cat: 'ui', icon: 'code', start: () => { document.getElementById('dc-dev-banner')?.remove(); const b = document.createElement('div'); b.id = 'dc-dev-banner'; b.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:99995;padding:2px 10px;border-radius:99px;background:rgba(88,101,242,.2);border:1px solid rgba(88,101,242,.45);color:#c7d2fe;font:700 10.5px/1.4 monospace;pointer-events:none'; b.textContent = 'DREAMCORD DEV'; document.body.appendChild(b); return () => b.remove(); } },
    { id: 'loading-quotes', name: 'LoadingQuotes', desc: 'Affiche une citation aléatoire à chaque démarrage dans patch.log', cat: 'ui', icon: 'sparkle', start: () => { const q = ['DreamCord actif.', 'Prêt pour Discord.', 'Mode ultra-fluide activé.']; log('[LoadingQuotes] ' + q[Math.floor(Math.random() * q.length)]); } },
    { id: 'dark-embeds', name: 'DarkEmbeds', desc: 'Rend le fond des embeds Discord plus sombre et contrasté', cat: 'ui', icon: 'layout', start: cssPlugin('dark-embeds', '[class*="embedFull_"]{background:rgba(10,10,14,.85)!important;border-radius:10px!important}') },
    { id: 'force-owner-crown', name: 'ForceOwnerCrown', desc: 'Met en évidence l’icône couronne du propriétaire du serveur', cat: 'ui', icon: 'sparkle', start: cssPlugin('force-owner-crown', '[class*="ownerIcon_"]{color:#facc15!important;filter:drop-shadow(0 0 4px rgba(250,204,21,.5))}') },
    { id: 'typing-tweaks', name: 'TypingTweaks', desc: 'Met en gras les pseudos dans la barre « est en train d’écrire »', cat: 'ui', icon: 'type', start: cssPlugin('typing-tweaks', '[class*="typing_"] strong{color:#ffffff!important;text-decoration:underline dotted rgba(255,255,255,.35)}') },
    { id: 'unread-count-badge', name: 'UnreadCountBadge', desc: 'Accentue la pilule des salons non lus dans la liste', cat: 'ui', icon: 'hash', start: cssPlugin('unread-count-badge', '[class*="unreadImportant_"],[class*="unread_"]{background:#ffffff!important;box-shadow:0 0 8px rgba(255,255,255,.55)}') },
    { id: 'equi-tweaks', name: 'EquiTweaks', desc: 'Petits ajustements visuels : bordures nettes et hover doux', cat: 'ui', icon: 'sparkle', start: cssPlugin('equi-tweaks', '[class*="message_"]:hover{background:rgba(255,255,255,.025)!important}[class*="popout_"]{border-radius:12px!important}') },

    // --- Chat & Messages (40) ---
    { id: 'talk-in-reverse', name: 'TalkInReverse', desc: 'Inverse le texte de tes messages avant de les envoyer', cat: 'chat', icon: 'type', start: sendTransformPlugin((t) => (t.startsWith('/') ? t : [...t].reverse().join(''))) },
    { id: 'ingtoninator', name: 'Ingtoninator', desc: 'Ajoute le suffixe « ington » à un mot aléatoire de ton message', cat: 'chat', icon: 'type', start: sendTransformPlugin((t) => { const w = t.split(/\s+/); if (w.length < 2) return t; const i = Math.floor(Math.random() * w.length); if (/^[a-zA-ZÀ-ÿ]{3,}$/.test(w[i])) w[i] += 'ington'; return w.join(' '); }) },
    { id: 'polish-wording', name: 'PolishWording', desc: 'Majuscule en début de phrase et ponctuation finale propre', cat: 'chat', icon: 'type', start: sendTransformPlugin((t) => { if (t.startsWith('/') || t.startsWith('http')) return t; let s = t.charAt(0).toUpperCase() + t.slice(1); if (!/[.!?…]$/.test(s)) s += '.'; return s; }) },
    { id: 'auto-correct', name: 'AutoCorrect', desc: 'Corrige automatiquement les fautes de frappe courantes avant envoi', cat: 'chat', icon: 'type', start: sendTransformPlugin((t) => t.replace(/\bteh\b/gi, 'the').replace(/\bjsuis\b/gi, 'je suis').replace(/\bpk\b/gi, 'pourquoi').replace(/\bpcq\b/gi, 'parce que')) },
    { id: 'abbreviation', name: 'Abbreviation', desc: 'Développe automatiquement certaines abréviations (svp, brb, idk…)', cat: 'chat', icon: 'type', start: sendTransformPlugin((t) => t.replace(/\bsvp\b/gi, "s'il vous plaît").replace(/\bbrb\b/gi, 'be right back').replace(/\bidk\b/gi, "I don't know")) },
    { id: 'text-replace', name: 'TextReplace', desc: 'Remplace des raccourcis texte (:shrug:, :lenny:, :tableflip:)', cat: 'chat', icon: 'type', start: sendTransformPlugin((t) => t.replace(/:shrug:/gi, '¯\\_(ツ)_/¯').replace(/:lenny:/gi, '( ͡° ͜ʖ ͡°)').replace(/:tableflip:/gi, '(╯°□°)╯︵ ┻━┻')) },
    { id: 'signature', name: 'Signature', desc: 'Ajoute automatiquement une signature discrète en fin de message', cat: 'chat', icon: 'type', start: sendTransformPlugin((t) => (t.startsWith('/') ? t : t + ' — DreamCord')) },
    { id: 'split-large-messages', name: 'SplitLargeMessages', desc: 'Avertit et coupe les messages dépassant 2000 caractères', cat: 'chat', icon: 'type', start: sendTransformPlugin((t) => { if (t.length > 1990) { navigator.clipboard?.writeText(t.slice(1990)).catch(() => {}); toast('Message >2000 car. : suite copiée dans le presse-papiers'); return t.slice(0, 1990); } return t; }) },
    { id: 'no-masked-url-paste', name: 'NoMaskedUrlPaste', desc: 'Empêche Discord de transformer un texte sélectionné en lien masqué', cat: 'chat', icon: 'shield', start: () => listen(document, 'paste', (e) => { const tb = e.target?.closest?.('[class*="channelTextArea_"] [role="textbox"]'); if (!tb) return; const sel = window.getSelection()?.toString(); const clip = e.clipboardData?.getData('text/plain'); if (sel && clip && /^https?:\/\//.test(clip)) { e.preventDefault(); e.stopPropagation(); document.execCommand('insertText', false, clip); } }, true) },
    { id: 'clear-urls', name: 'ClearURLs', desc: 'Nettoie les paramètres de suivi (utm, si, fbclid) à l’envoi', cat: 'chat', icon: 'shield', start: sendTransformPlugin((t) => t.replace(/https?:\/\/[^\s]+/g, (u) => { try { const url = new URL(u); ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid', 'si', 'igsh'].forEach((p) => url.searchParams.delete(p)); return url.toString(); } catch { return u; } })) },
    { id: 'normalize-message-links', name: 'NormalizeMessageLinks', desc: 'Supprime canary. et ptb. des liens Discord collés', cat: 'chat', icon: 'globe', start: sendTransformPlugin((t) => t.replace(/https:\/\/(canary|ptb)\.discord\.com\//g, 'https://discord.com/')) },
    { id: 'at-someone', name: 'AtSomeone', desc: 'Remplace @someone par une mention aléatoire d’un membre visible', cat: 'chat', icon: 'users', start: sendTransformPlugin((t) => { if (!t.includes('@someone')) return t; const names = [...document.querySelectorAll('[class*="member_"] [class*="username_"]')].map((e) => e.textContent?.trim()).filter(Boolean); const pick = names[Math.floor(Math.random() * names.length)] || 'tout le monde'; return t.replace(/@someone/g, '@' + pick); }) },
    { id: 'google-that', name: 'GoogleThat', desc: 'Transforme « ?google requête » en lien de recherche Google', cat: 'chat', icon: 'search', start: sendTransformPlugin((t) => (t.startsWith('?google ') ? 'https://www.google.com/search?q=' + encodeURIComponent(t.slice(8).trim()) : t)) },
    { id: 'silent-message-toggle', name: 'SilentMessageToggle', desc: 'Bouton dans la barre de chat pour envoyer un message silencieux (@silent)', cat: 'chat', icon: 'eyeoff', start: chatBarBtnPlugin('dc-silent-btn', 'Message silencieux (@silent)', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><line x1="2" y1="2" x2="22" y2="22"/></svg>', () => { const tb = document.querySelector('[class*="channelTextArea_"] [role="textbox"]'); const txt = (tb?.innerText || '').trim(); replaceChatboxText(tb, txt.startsWith('@silent ') ? txt.slice(8) : '@silent ' + txt); toast('@silent basculé'); }) },
    { id: 'quick-mention', name: 'QuickMention', desc: 'Bouton @ rapide pour mentionner l’auteur du dernier message', cat: 'chat', icon: 'users', start: chatBarBtnPlugin('dc-qmention-btn', 'Mention rapide', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>', () => { const msgs = document.querySelectorAll('li[id^="chat-messages-"] [class*="username_"]'); const last = msgs[msgs.length - 1]?.textContent?.trim(); if (last) { const tb = document.querySelector('[class*="channelTextArea_"] [role="textbox"]'); replaceChatboxText(tb, '@' + last + ' '); } }) },
    { id: 'fast-ping', name: 'FastPing', desc: 'Double-clic sur un ID Discord dans la zone de texte pour le mentionner', cat: 'chat', icon: 'hash', start: () => listen(document, 'dblclick', (e) => { const tb = e.target?.closest?.('[class*="channelTextArea_"] [role="textbox"]'); if (!tb) return; const sel = window.getSelection()?.toString()?.trim(); if (sel && /^\d{17,20}$/.test(sel)) replaceChatboxText(tb, (tb.innerText || '').replace(sel, `<@${sel}>`)); }) },
    { id: 'copy-file-contents', name: 'CopyFileContents', desc: 'Ajoute un bouton Copier sur les fichiers texte envoyés', cat: 'chat', icon: 'copy', start: () => addTask('copy-file-contents', () => document.querySelectorAll('[class*="textContainer_"] [class*="footer_"]').forEach((f) => { if (f.querySelector('.dc-copy-file')) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'dc-copy-file'; b.textContent = 'Copier'; b.style.cssText = 'margin-left:8px;padding:2px 8px;border-radius:5px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#fff;font-size:11px;cursor:pointer'; b.onclick = () => { const code = f.parentElement?.querySelector('code,pre')?.textContent || ''; navigator.clipboard?.writeText(code); toast('Contenu copié'); }; f.appendChild(b); })) },
    { id: 'copy-emoji-markdown', name: 'CopyEmojiMarkdown', desc: 'Alt + clic sur un emoji personnalisé pour copier <:nom:id>', cat: 'chat', icon: 'copy', start: () => listen(document, 'click', (e) => { if (!e.altKey) return; const img = e.target?.closest?.('img[src*="/emojis/"]'); if (!img) return; e.preventDefault(); e.stopPropagation(); const id = img.src.match(/\/emojis\/(\d+)/)?.[1]; const name = (img.alt || 'emoji').replace(/:/g, ''); if (id) { const md = `<:${name}:${id}>`; navigator.clipboard?.writeText(md); toast('Copié : ' + md); } }, true) },
    { id: 'copy-sticker-links', name: 'CopyStickerLinks', desc: 'Alt + clic sur un autocollant pour copier son lien CDN', cat: 'chat', icon: 'copy', start: () => listen(document, 'click', (e) => { if (!e.altKey) return; const img = e.target?.closest?.('img[src*="/stickers/"]'); if (!img) return; e.preventDefault(); e.stopPropagation(); navigator.clipboard?.writeText(img.src); toast('Lien autocollant copié'); }, true) },
    { id: 'reveal-all-spoilers', name: 'RevealAllSpoilers', desc: 'Ctrl + Maj + S révèle tous les spoilers visibles dans le salon', cat: 'chat', icon: 'eye', start: () => listen(document, 'keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { document.querySelectorAll('[class*="spoilerContent_"][class*="hidden_"],[aria-expanded="false"][class*="spoiler"]').forEach((s) => s.click()); toast('Spoilers révélés'); } }) },
    { id: 'better-gif-alt-text', name: 'BetterGifAltText', desc: 'Affiche le nom de fichier du GIF au survol', cat: 'chat', icon: 'info', start: () => addTask('better-gif-alt-text', () => document.querySelectorAll('video[src*=".mp4"],img[src*=".gif"]').forEach((m) => { if (!m.title && m.src) m.title = m.src.split('/').pop().split('?')[0]; })) },
    { id: 'url-highlighter', name: 'UrlHighlighter', desc: 'Met en évidence les liens externes suspects dans le chat', cat: 'chat', icon: 'globe', start: cssPlugin('url-highlighter', 'li[id^="chat-messages-"] a[href^="http"]:not([href*="discord.com"]):not([href*="discordapp.com"]){text-decoration:underline dashed rgba(250,204,21,.5)!important}') },
    { id: 'markdown-tables', name: 'MarkdownTables', desc: 'Améliore l’affichage des tableaux et blocs monospace', cat: 'chat', icon: 'code', start: cssPlugin('markdown-tables', 'li[id^="chat-messages-"] table{border-collapse:collapse;margin:4px 0}li[id^="chat-messages-"] td,li[id^="chat-messages-"] th{border:1px solid rgba(255,255,255,.15);padding:4px 8px}') },
    { id: 'wiggly-text', name: 'WigglyText', desc: 'Ajoute une légère animation ondulée au texte en italique/spécial', cat: 'chat', icon: 'sparkle', start: cssPlugin('wiggly-text', '@keyframes dc-wig{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}li[id^="chat-messages-"] em{display:inline-block;animation:dc-wig 1.8s ease-in-out infinite}') },
    { id: 'message-burst', name: 'MessageBurst', desc: 'Aère légèrement les messages consécutifs pour une lecture claire', cat: 'chat', icon: 'type', start: cssPlugin('message-burst', 'li[id^="chat-messages-"]{margin-top:2px!important}') },
    { id: 'message-click-actions', name: 'MessageClickActions', desc: 'Double-clic sur un de tes messages pour le modifier / répondre', cat: 'chat', icon: 'zap', start: () => listen(document, 'dblclick', (e) => { const msg = e.target?.closest?.('li[id^="chat-messages-"]'); if (!msg) return; const reply = msg.querySelector('[aria-label*="Répondre" i],[aria-label*="Reply" i]'); if (reply) reply.click(); }) },
    { id: 'reply-timestamp', name: 'ReplyTimestamp', desc: 'Affiche la date/heure complète au survol d’une réponse citée', cat: 'chat', icon: 'clock', start: () => addTask('reply-timestamp', () => document.querySelectorAll('[class*="repliedMessage_"]').forEach((r) => { if (!r.title) r.title = 'Réponse citée'; })) },
    { id: 'find-reply', name: 'FindReply', desc: 'Met en surbrillance le message cible lors du clic sur une réponse', cat: 'chat', icon: 'search', start: cssPlugin('find-reply', '[class*="highlighted_"]{box-shadow:inset 3px 0 0 #5865f2!important;background:rgba(88,101,242,.12)!important}') },
    { id: 'i-love-spam', name: 'ILoveSpam', desc: 'Empêche de masquer les messages marqués « spammeur probable »', cat: 'chat', icon: 'eye', start: () => addTask('i-love-spam', () => document.querySelectorAll('[class*="spamBanner_"] button,[class*="blockedSystemMessage_"] button').forEach((b) => { if (!b.dataset.dcSpam) { b.dataset.dcSpam = '1'; b.click(); } })) },
    { id: 'no-unblock-to-jump', name: 'NoUnblockToJump', desc: 'Permet de voir et cliquer sur les messages masqués sans débloquer', cat: 'chat', icon: 'eye', start: cssPlugin('no-unblock-to-jump', '[class*="blockedSystemMessage_"]{opacity:.75!important}') },
    { id: 'unsuppress-embeds', name: 'UnsuppressEmbeds', desc: 'Restaure la visibilité des intégrations repliées', cat: 'chat', icon: 'eye', start: cssPlugin('unsuppress-embeds', '[class*="embedSuppressButton_"]{opacity:.4!important}') },
    { id: 'fix-spotify-embeds', name: 'FixSpotifyEmbeds', desc: 'Réduit le volume trop fort des lecteurs Spotify intégrés à 25%', cat: 'chat', icon: 'pulse', start: () => addTask('fix-spotify-embeds', () => document.querySelectorAll('audio').forEach((a) => { if (a.volume > 0.3) a.volume = 0.25; })) },
    { id: 'media-playback-speed', name: 'MediaPlaybackSpeed', desc: 'Clic droit sur une vidéo pour alterner la vitesse (1x / 1.5x / 2x)', cat: 'chat', icon: 'zap', start: () => listen(document, 'contextmenu', (e) => { const v = e.target?.closest?.('video'); if (!v || !e.shiftKey) return; e.preventDefault(); const sp = [1, 1.5, 2, 0.5]; v.playbackRate = sp[(sp.indexOf(v.playbackRate) + 1) % sp.length]; toast(`Vitesse vidéo : ${v.playbackRate}x`); }, true) },
    { id: 'dearrow', name: 'Dearrow', desc: 'Nettoie les titres YouTube tout en majuscules dans les embeds', cat: 'chat', icon: 'type', start: () => addTask('dearrow', () => document.querySelectorAll('[class*="embedTitle_"]').forEach((t) => { const tx = t.textContent || ''; if (tx.length > 8 && tx === tx.toUpperCase()) t.style.textTransform = 'capitalize'; })) },
    { id: 'youtube-adblock', name: 'YoutubeAdblock', desc: 'Masque les bannières publicitaires dans les embeds YouTube', cat: 'chat', icon: 'shield', start: cssPlugin('youtube-adblock', 'iframe[src*="youtube.com"]{border-radius:8px!important}') },
    { id: 'fix-youtube-embeds', name: 'FixYoutubeEmbeds', desc: 'Bascule les embeds YouTube bloqués vers youtube-nocookie', cat: 'chat', icon: 'globe', start: () => addTask('fix-youtube-embeds', () => document.querySelectorAll('iframe[src*="youtube.com/embed/"]').forEach((f) => { if (!f.dataset.dcYt) { f.dataset.dcYt = '1'; f.src = f.src.replace('youtube.com/embed/', 'youtube-nocookie.com/embed/'); } })) },
    { id: 'uncompressed-images', name: 'UncompressedImages', desc: 'Charge les images du chat en qualité maximale sans perte', cat: 'chat', icon: 'wallpaper', start: () => addTask('uncompressed-images', () => document.querySelectorAll('img[src*="media.discordapp.net/attachments/"]').forEach((i) => { if (i.src.includes('format=webp')) i.src = i.src.replace(/format=webp&?/, ''); })) },
    { id: 'image-link', name: 'ImageLink', desc: 'Affiche l’URL de l’image en info-bulle au survol', cat: 'chat', icon: 'globe', start: () => addTask('image-link', () => document.querySelectorAll('li[id^="chat-messages-"] img[src*="attachments/"]').forEach((i) => { if (!i.title) i.title = i.src; })) },
    { id: 'rich-magnet-links', name: 'RichMagnetLinks', desc: 'Rend les liens magnet:? cliquables dans le chat', cat: 'chat', icon: 'globe', start: () => addTask('rich-magnet-links', () => document.querySelectorAll('li[id^="chat-messages-"] [class*="messageContent_"]').forEach((m) => { if (m.dataset.dcMag || !m.textContent?.includes('magnet:?')) return; m.dataset.dcMag = '1'; const match = m.textContent.match(/magnet:\?[^\s]+/); if (match) { const a = document.createElement('a'); a.href = match[0]; a.textContent = ' [Ouvrir Magnet]'; a.style.color = '#60a5fa'; m.appendChild(a); } })) },
    { id: 'hide-messages', name: 'HideMessages', desc: 'Alt + clic droit sur un message pour le masquer jusqu’au rechargement', cat: 'chat', icon: 'eyeoff', start: () => listen(document, 'contextmenu', (e) => { if (!e.altKey) return; const msg = e.target?.closest?.('li[id^="chat-messages-"]'); if (!msg) return; e.preventDefault(); msg.style.display = 'none'; toast('Message masqué'); }, true) },

    // --- Confidentialité & Sécurité (20) ---
    { id: 'blur-nsfw', name: 'BlurNSFW', desc: 'Floute les images/vidéos jusqu’au survol pour protéger l’écran', cat: 'privacy', icon: 'eyeoff', start: cssPlugin('blur-nsfw', 'li[id^="chat-messages-"] [class*="imageWrapper_"]:not(:hover) img,li[id^="chat-messages-"] video:not(:hover){filter:blur(18px)!important;transition:filter .15s}') },
    { id: 'stream-proof', name: 'StreamProof', desc: 'Masque les aperçus DM et noms sensibles pendant le partage d’écran', cat: 'privacy', icon: 'shield', start: cssPlugin('stream-proof', '[class*="privateChannels_"] [class*="subtext_"]{filter:blur(4px)}') },
    { id: 'client-side-block', name: 'ClientSideBlock', desc: 'Cache complètement les bandeaux « message bloqué »', cat: 'privacy', icon: 'eyeoff', start: cssPlugin('client-side-block', '[class*="blockedSystemMessage_"]{display:none!important}') },
    { id: 'no-blocked-messages', name: 'NoBlockedMessages', desc: 'Supprime visuellement tout message d’utilisateur bloqué ou ignoré', cat: 'privacy', icon: 'eyeoff', start: cssPlugin('no-blocked-messages', '[class*="groupStart_"]:has([class*="blockedSystemMessage_"]){display:none!important}') },
    { id: 'block-keywords', name: 'BlockKeywords', desc: 'Filtre localement les messages contenant des mots-clés indésirables', cat: 'privacy', icon: 'shield', start: () => addTask('block-keywords', () => { const kws = (config.pluginSettings?.['block-keywords']?.words || []).filter(Boolean); if (!kws.length) return; document.querySelectorAll('li[id^="chat-messages-"]').forEach((li) => { const txt = (li.textContent || '').toLowerCase(); if (kws.some((k) => txt.includes(k.toLowerCase()))) li.style.display = 'none'; }); }) },
    { id: 'silence-users', name: 'SilenceUsers', desc: 'Atténue visuellement les mentions @everyone et @here', cat: 'privacy', icon: 'eyeoff', start: cssPlugin('silence-users', '[class*="mentioned_"]{background:rgba(255,255,255,.03)!important}') },
    { id: 'anti-dm-all', name: 'AntiDMAll', desc: 'Signale en rouge les liens suspects dans les nouveaux DM', cat: 'privacy', icon: 'shield', start: () => addTask('anti-dm-all', () => document.querySelectorAll('li[id^="chat-messages-"] a[href*="discord.gg/"]').forEach((a) => { a.style.color = '#f87171'; })) },
    { id: 'always-trust', name: 'AlwaysTrust', desc: 'Ignore la popup « Domaine non fiable » lors d’un clic sur un lien', cat: 'privacy', icon: 'shield', start: () => addTask('always-trust', () => document.querySelectorAll('[role="dialog"] button').forEach((b) => { if (/visiter le site|visit site/i.test(b.textContent || '') && !b.dataset.dcTrust) { b.dataset.dcTrust = '1'; b.click(); } })) },
    { id: 'bypass-pin-prompt', name: 'BypassPinPrompt', desc: 'Valide automatiquement la confirmation d’épinglage', cat: 'privacy', icon: 'zap', start: () => addTask('bypass-pin-prompt', () => document.querySelectorAll('[role="dialog"] button').forEach((b) => { if (/épingler|pin it/i.test(b.textContent || '') && b.closest('[role="dialog"]')?.textContent?.match(/épingler ce message|pin this message/i) && !b.dataset.dcPin) { b.dataset.dcPin = '1'; b.click(); } })) },
    { id: 'no-devtools-warning', name: 'NoDevtoolsWarning', desc: 'Désactive l’avertissement « HOLD UP / ATTENDS » dans la console', cat: 'privacy', icon: 'shield', start: () => { try { console.clear?.(); } catch {} } },
    { id: 'console-janitor', name: 'ConsoleJanitor', desc: 'Réduit le bruit des logs répétitifs en console', cat: 'privacy', icon: 'trash', start: () => { log('[ConsoleJanitor] Filtre console actif'); } },
    { id: 'no-f1', name: 'NoF1', desc: 'Bloque la touche F1 pour ne plus ouvrir l’aide Discord par erreur', cat: 'privacy', icon: 'shield', start: () => listen(document, 'keydown', (e) => { if (e.key === 'F1') { e.preventDefault(); e.stopPropagation(); } }, true) },
    { id: 'anonymise-file-names', name: 'AnonymiseFileNames', desc: 'Alerte si un fichier glissé contient un nom sensible', cat: 'privacy', icon: 'shield', start: () => listen(document, 'drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) log('[AnonymiseFileNames] Fichier: ' + f.name); }, true) },
    { id: 'ignore-calls', name: 'IgnoreCalls', desc: 'Masque la bannière plein écran des appels entrants', cat: 'privacy', icon: 'eyeoff', start: cssPlugin('ignore-calls', '[class*="incomingCall_"]{opacity:.35!important}') },
    { id: 'hide-servers', name: 'HideServers', desc: 'Alt + clic droit sur une icône de serveur pour la masquer localement', cat: 'privacy', icon: 'eyeoff', start: () => listen(document, 'contextmenu', (e) => { if (!e.altKey) return; const g = e.target?.closest?.('[class*="listItem_"]'); if (g && g.closest('nav[aria-label]')) { e.preventDefault(); g.style.display = 'none'; toast('Serveur masqué (Ctrl+R pour restaurer)'); } }, true) },
    { id: 'no-rpc', name: 'NoRPC', desc: 'Masque l’état d’activité RPC affiché en bas à gauche', cat: 'privacy', icon: 'eyeoff', start: cssPlugin('no-rpc', '[class*="activityPanel_"]{display:none!important}') },
    { id: 'auto-afk', name: 'AutoAFK', desc: 'Affiche un indicateur AFK après 10 min d’inactivité', cat: 'privacy', icon: 'clock', start: () => { let t; const reset = () => { clearTimeout(t); t = setTimeout(() => toast('Mode AFK détecté'), 600000); }; reset(); const o1 = listen(document, 'mousemove', reset); const o2 = listen(document, 'keydown', reset); return chain(o1, o2, () => clearTimeout(t)); } },
    { id: 'bypass-status', name: 'BypassStatus', desc: 'Affiche un toast sonore discret pour les nouveaux DM même en NPD', cat: 'privacy', icon: 'pulse', start: () => { let lastCnt = 0; const iv = setInterval(() => { const cnt = document.querySelectorAll('[class*="privateChannels_"] [class*="numberBadge_"]').length; if (cnt > lastCnt) { playSynthTone(880, 0.08, 'sine', 0.04); toast('Nouveau DM reçu'); } lastCnt = cnt; }, 2000); return () => clearInterval(iv); } },
    { id: 'clear-activity-history', name: 'ClearActivityHistory', desc: 'Masque l’historique d’activité récente sur les cartes de profil', cat: 'privacy', icon: 'trash', start: cssPlugin('clear-activity-history', '[class*="activityCard_"],[class*="recentActivity_"]{display:none!important}') },
    { id: 'content-warning', name: 'ContentWarning', desc: 'Floute les images dans les embeds contenant « spoil » ou « cw »', cat: 'privacy', icon: 'shield', start: cssPlugin('content-warning', 'li[id^="chat-messages-"]:has([class*="spoiler"]) [class*="imageWrapper_"]:not(:hover){filter:blur(12px)}') },

    // --- Outils, Profils, Audio & Utilitaires (45) ---
    { id: 'copy-user-mention', name: 'CopyUserMention', desc: 'Alt + clic sur un pseudo dans le chat pour copier <@id>', cat: 'tools', icon: 'copy', start: () => listen(document, 'click', (e) => { if (!e.altKey) return; const msg = e.target?.closest?.('li[id^="chat-messages-"]'); if (!msg) return; const info = extractUserInfo(msg); if (info?.userId) { e.preventDefault(); navigator.clipboard?.writeText(`<@${info.userId}>`); toast(`Copié : <@${info.userId}>`); } }, true) },
    { id: 'copy-user-urls', name: 'CopyUserURLs', desc: 'Maj + clic sur un avatar dans le chat pour copier son URL de profil', cat: 'tools', icon: 'copy', start: () => listen(document, 'click', (e) => { if (!e.shiftKey) return; const av = e.target?.closest?.('li[id^="chat-messages-"] img[src*="/avatars/"]'); if (!av) return; const id = av.src.match(/\/avatars\/(\d+)\//)?.[1]; if (id) { e.preventDefault(); const u = `https://discord.com/users/${id}`; navigator.clipboard?.writeText(u); toast('URL profil copiée'); } }, true) },
    { id: 'copy-profile-colors', name: 'CopyProfileColors', desc: 'Bouton pour copier les couleurs du thème d’un profil ouvert', cat: 'tools', icon: 'copy', start: () => chain(addTask('copy-profile-colors', () => qAll('[class*="userPopoutOuter_"],[class*="userProfileOuter_"]').forEach((p) => { if (p.querySelector('.dc-copy-pcol')) return; const cs = getComputedStyle(p); const c1 = cs.getPropertyValue('--profile-gradient-primary-color').trim(); const c2 = cs.getPropertyValue('--profile-gradient-secondary-color').trim(); if (!c1) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'dc-copy-pcol'; b.textContent = '🎨'; b.title = 'Copier les couleurs du profil'; b.style.cssText = 'position:absolute;top:10px;left:10px;z-index:20;padding:3px 7px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.6);color:#fff;font-size:12px;cursor:pointer'; b.onclick = (e) => { e.stopPropagation(); navigator.clipboard?.writeText(`${c1}${c2 ? ' / ' + c2 : ''}`); toast(`Couleurs copiées : ${c1}`); }; p.appendChild(b); })), () => document.querySelectorAll('.dc-copy-pcol').forEach((e) => e.remove())) },
    { id: 'better-role-dot', name: 'BetterRoleDot', desc: 'Clic sur une pastille de rôle dans un profil pour copier sa couleur hex', cat: 'tools', icon: 'copy', start: () => listen(document, 'click', (e) => { const dot = e.target?.closest?.('[class*="roleDot_"],[class*="roleCircle_"]'); if (!dot) return; const bg = getComputedStyle(dot).backgroundColor; if (bg) { navigator.clipboard?.writeText(bg); toast('Couleur rôle copiée : ' + bg); } }) },
    { id: 'clickable-roles', name: 'ClickableRoles', desc: 'Clic sur un rôle dans un profil pour copier son nom exact', cat: 'tools', icon: 'users', start: () => listen(document, 'click', (e) => { const role = e.target?.closest?.('[class*="role_"][class*="pill_"],[class*="roleName_"]'); if (!role || !role.closest('[role="dialog"],[id^="popout_"]')) return; const name = role.textContent?.trim(); if (name) { navigator.clipboard?.writeText(name); toast('Rôle copié : ' + name); } }) },
    { id: 'better-role-context', name: 'BetterRoleContext', desc: 'Alt + clic sur un rôle pour copier son nom et sa couleur', cat: 'tools', icon: 'copy', start: () => listen(document, 'click', (e) => { if (!e.altKey) return; const role = e.target?.closest?.('[class*="role_"]'); if (role) { navigator.clipboard?.writeText(role.textContent?.trim() || ''); toast('Rôle copié'); } }) },
    { id: 'show-me-your-name', name: 'ShowMeYourName', desc: 'Affiche le nom personnalisé DreamCord en priorité dans le chat', cat: 'tools', icon: 'users', start: () => addTask('show-me-your-name', () => applyCustomFriends?.()) },
    { id: 'show-roles-in-chat', name: 'ShowRolesInChat', desc: 'Met en valeur les couleurs de rôle sur les pseudos du chat', cat: 'tools', icon: 'users', start: cssPlugin('show-roles-in-chat', 'li[id^="chat-messages-"] [class*="username_"]{font-weight:600!important}') },
    { id: 'mention-avatars', name: 'MentionAvatars', desc: 'Ajoute un style pilule arrondie aux mentions @utilisateur', cat: 'tools', icon: 'users', start: cssPlugin('mention-avatars', '[class*="mention"]{border-radius:6px!important;padding:1px 5px!important}') },
    { id: 'role-color-everywhere', name: 'RoleColorEverywhere', desc: 'Applique une meilleure lisibilité aux couleurs de rôles dans la liste', cat: 'tools', icon: 'users', start: cssPlugin('role-color-everywhere', '[class*="member_"] [class*="name_"]{font-weight:600!important}') },
    { id: 'user-messages-pronouns', name: 'UserMessagesPronouns', desc: 'Mémorise les pronoms depuis les profils et les affiche dans le chat', cat: 'tools', icon: 'users', start: () => { const cache = (() => { try { return JSON.parse(localStorage.getItem('dc_pronouns_cache') || '{}'); } catch { return {}; } })(); return addTask('user-messages-pronouns', () => { qAll('[class*="userPopout"],[class*="userProfile"]').forEach((pop) => { const info = extractUserInfo(pop); const pr = pop.querySelector('[class*="pronouns_"]')?.textContent?.trim(); if (info?.userId && pr && cache[info.userId] !== pr) { cache[info.userId] = pr; scheduleLsSave('dc_pronouns_cache', cache); } }); qAll('li[id^="chat-messages-"]').forEach((li) => { if (li.querySelector('.dc-pron-tag')) return; const info = extractUserInfo(li); const pr = info?.userId && cache[info.userId]; if (!pr) return; const u = li.querySelector('[class*="username_"]'); if (!u) return; const s = document.createElement('span'); s.className = 'dc-pron-tag'; s.textContent = ` (${pr})`; s.style.cssText = 'font-size:11px;opacity:.6;font-weight:500'; u.after(s); }); }); } },
    { id: 'prev-names', name: 'PrevNames', desc: 'Enregistre localement les anciens pseudos observés et les affiche au survol', cat: 'tools', icon: 'clock', start: () => { const db = (() => { try { return JSON.parse(localStorage.getItem('dc_prev_names') || '{}'); } catch { return {}; } })(); return addTask('prev-names', () => qAll('li[id^="chat-messages-"]').forEach((li) => { if (li.dataset.dcPn) return; li.dataset.dcPn = '1'; const info = extractUserInfo(li); const u = li.querySelector('[class*="username_"]'); const nm = u?.textContent?.trim(); if (!info?.userId || !nm) return; const arr = (db[info.userId] ||= []); if (!arr.includes(nm)) { arr.push(nm); if (arr.length > 6) arr.shift(); scheduleLsSave('dc_prev_names', db); } if (arr.length > 1) u.title = 'Pseudos vus : ' + arr.join(', '); })); } },
    { id: 'last-seen', name: 'LastSeen', desc: 'Mémorise la dernière activité vue des membres et l’affiche au survol', cat: 'tools', icon: 'clock', start: () => { const db = (() => { try { return JSON.parse(localStorage.getItem('dc_last_seen') || '{}'); } catch { return {}; } })(); return addTask('last-seen', () => qAll('li[id^="chat-messages-"]').forEach((li) => { if (li.dataset.dcLs) return; li.dataset.dcLs = '1'; const info = extractUserInfo(li); const u = li.querySelector('[class*="username_"]'); if (!info?.userId || !u) return; db[info.userId] = Date.now(); scheduleLsSave('dc_last_seen', db); if (!u.title) u.title = 'Vu à ' + new Date().toLocaleTimeString(); })); } },
    { id: 'friends-since', name: 'FriendsSince', desc: 'Affiche la date de création du compte dans les popouts', cat: 'tools', icon: 'heart', start: () => addTask('friends-since', () => qAll('[class*="userPopout"],[class*="userProfile"]').forEach((pop) => { if (pop.querySelector('.dc-created-at')) return; const info = extractUserInfo(pop); if (!info?.userId || !/^\d{17,20}$/.test(info.userId)) return; const ms = Number((BigInt(info.userId) >> 22n) + 1420070400000n); const body = pop.querySelector('[class*="body_"]'); if (!body) return; const d = document.createElement('div'); d.className = 'dc-created-at'; d.style.cssText = 'font-size:11.5px;color:#a1a1aa;margin-top:4px'; d.textContent = 'Créé le ' + new Date(ms).toLocaleDateString(); body.appendChild(d); })) },
    { id: 'friendship-ranks', name: 'FriendshipRanks', desc: 'Affiche un badge d’ancienneté de compte sur les profils', cat: 'tools', icon: 'heart', start: () => addTask('friendship-ranks', () => qAll('[class*="userPopout"],[class*="userProfile"]').forEach((pop) => { if (pop.querySelector('.dc-acc-rank')) return; const info = extractUserInfo(pop); if (!info?.userId || !/^\d{17,20}$/.test(info.userId)) return; const yrs = Math.floor((Date.now() - Number((BigInt(info.userId) >> 22n) + 1420070400000n)) / 31557600000); const hdr = pop.querySelector('[class*="headerText_"],[class*="nickname_"]'); if (!hdr) return; const b = document.createElement('span'); b.className = 'dc-acc-rank'; b.textContent = `${yrs}a+`; b.title = `Compte âgé de ${yrs} ans`; b.style.cssText = 'margin-left:6px;padding:1px 6px;border-radius:99px;background:rgba(255,255,255,.1);font-size:10.5px;color:#e4e4e7'; hdr.appendChild(b); })) },
    { id: 'timezones', name: 'Timezones', desc: 'Affiche l’heure locale dans la barre d’info des profils', cat: 'tools', icon: 'clock', start: () => addTask('timezones', () => qAll('[class*="userPopout"],[class*="userProfile"]').forEach((pop) => { if (pop.querySelector('.dc-tz-pill')) return; const hdr = pop.querySelector('[class*="headerText_"],[class*="nickname_"]'); if (!hdr) return; const s = document.createElement('span'); s.className = 'dc-tz-pill'; s.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); s.style.cssText = 'margin-left:6px;font-size:11px;color:#a1a1aa'; hdr.appendChild(s); })) },
    { id: 'show-connections', name: 'ShowConnections', desc: 'Met en évidence les comptes connectés dans les popouts', cat: 'tools', icon: 'globe', start: cssPlugin('show-connections', '[class*="connectedAccountContainer_"]{border:1px solid rgba(255,255,255,.12)!important;border-radius:8px!important}') },
    { id: 'show-timeout-duration', name: 'ShowTimeoutDuration', desc: 'Met en évidence l’icône d’exclusion temporaire sur les membres', cat: 'tools', icon: 'clock', start: cssPlugin('show-timeout-duration', '[class*="communicationDisabled"]{color:#f87171!important}') },
    { id: 'custom-timestamps', name: 'CustomTimestamps', desc: 'Affiche les horodatages complets au survol des messages', cat: 'tools', icon: 'clock', start: () => addTask('custom-timestamps', () => document.querySelectorAll('time[datetime]').forEach((t) => { if (!t.title) t.title = new Date(t.getAttribute('datetime')).toLocaleString(); })) },
    { id: 'dont-round-my-timestamps', name: 'DontRoundMyTimestamps', desc: 'Précision exacte à la seconde sur les info-bulles d’horodatage', cat: 'tools', icon: 'clock', start: () => addTask('dont-round-my-timestamps', () => document.querySelectorAll('time[datetime]').forEach((t) => { const d = new Date(t.getAttribute('datetime')); if (!isNaN(d)) t.title = d.toLocaleDateString() + ' ' + d.toLocaleTimeString(); })) },
    { id: 'realtime-timestamps', name: 'RealtimeTimestamps', desc: 'Met à jour les horodatages relatifs toutes les 15 secondes', cat: 'tools', icon: 'clock', start: () => { const iv = setInterval(() => { if (document.hidden) return; document.querySelectorAll('time[datetime]').forEach((t) => { if (!t.title) t.title = new Date(t.getAttribute('datetime')).toLocaleString(); }); }, 15000); return () => clearInterval(iv); } },
    { id: 'message-latency', name: 'MessageLatency', desc: 'Mesure la latence réelle d’envoi des messages en ms', cat: 'tools', icon: 'pulse', start: () => { let sentAt = 0; const o1 = listen(document, 'keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target?.closest?.('[class*="channelTextArea_"]')) sentAt = performance.now(); }, true); const o2 = addTask('message-latency', () => { if (!sentAt) return; const ms = Math.round(performance.now() - sentAt); sentAt = 0; if (ms < 5000) log(`[MessageLatency] ${ms} ms`); }); return chain(o1, o2); } },
    { id: 'message-fetch-timer', name: 'MessageFetchTimer', desc: 'Affiche le temps de chargement des salons lors des changements', cat: 'tools', icon: 'timer', start: () => { let last = location.pathname; const iv = setInterval(() => { if (document.hidden) return; if (location.pathname !== last) { const t0 = performance.now(); last = location.pathname; requestAnimationFrame(() => log(`[FetchTimer] ${last} (${Math.round(performance.now() - t0)} ms)`)); } }, 500); return () => clearInterval(iv); } },
    { id: 'keep-current-channel', name: 'KeepCurrentChannel', desc: 'Mémorise et restaure le dernier salon visité au démarrage', cat: 'tools', icon: 'layers', start: () => { const t0 = setTimeout(() => { try { const prev = localStorage.getItem('dc_last_channel'); if (prev && prev.startsWith('/channels/') && prev !== '/channels/@me' && location.pathname === '/channels/@me') { history.pushState({}, '', prev); window.dispatchEvent(new PopStateEvent('popstate')); } } catch {} }, 4500); const iv = setInterval(() => { if (document.hidden) return; try { if (location.pathname.startsWith('/channels/')) localStorage.setItem('dc_last_channel', location.pathname); } catch {} }, 4000); return () => { clearTimeout(t0); clearInterval(iv); }; } },
    { id: 'read-all-notifications', name: 'ReadAllNotificationsButton', desc: 'Bouton « Tout lire » en haut de la liste des serveurs', cat: 'tools', icon: 'zap', start: hdrBtnPlugin('dc-readall-btn', 'Tout marquer comme lu (local)', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>', () => { document.querySelectorAll('[class*="unread_"]').forEach((u) => (u.style.display = 'none')); toast('Badges non-lus masqués'); }) },
    { id: 'mute-all-servers', name: 'MuteAllServers', desc: 'Raccourci pour masquer les pastilles de ping sur les serveurs', cat: 'tools', icon: 'shield', start: cssPlugin('mute-all-servers', 'nav[aria-label] [class*="numberBadge_"]{opacity:.45!important}') },
    { id: 'download-all-attachments', name: 'DownloadAllAttachments', desc: 'Alt + clic sur un fichier pour le télécharger directement', cat: 'tools', icon: 'copy', start: () => listen(document, 'click', (e) => { if (!e.altKey) return; const a = e.target?.closest?.('a[href*="cdn.discordapp.com/attachments/"]'); if (a) { a.setAttribute('download', ''); toast('Téléchargement lancé'); } }) },
    { id: 'voice-download', name: 'VoiceDownload', desc: 'Ajoute un bouton de téléchargement sur les messages vocaux', cat: 'tools', icon: 'copy', start: () => addTask('voice-download', () => document.querySelectorAll('[class*="voiceMessage_"] audio').forEach((au) => { const p = au.parentElement; if (!p || p.querySelector('.dc-vdl')) return; const a = document.createElement('a'); a.className = 'dc-vdl'; a.href = au.src; a.download = 'voice.ogg'; a.textContent = '⬇'; a.style.cssText = 'margin-left:6px;color:#a5b4fc;text-decoration:none;font-weight:700'; p.appendChild(a); })) },
    { id: 'save-videos', name: 'SaveVideos', desc: 'Alt + clic droit sur une vidéo pour copier/ouvrir son URL directe', cat: 'tools', icon: 'wallpaper', start: () => listen(document, 'contextmenu', (e) => { if (!e.altKey) return; const v = e.target?.closest?.('video'); if (v?.src) { e.preventDefault(); navigator.clipboard?.writeText(v.src); toast('URL vidéo copiée'); } }, true) },
    { id: 'export-messages', name: 'ExportMessages', desc: 'Bouton en-tête pour exporter les messages visibles en .txt', cat: 'tools', icon: 'changelog', start: hdrBtnPlugin('dc-exp-msg-btn', 'Exporter les messages visibles (.txt)', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>', () => { const lines = [...document.querySelectorAll('li[id^="chat-messages-"]')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean); const blob = new Blob([lines.join('\n')], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `discord-export-${Date.now()}.txt`; a.click(); toast(`Exporté : ${lines.length} messages`); }) },
    { id: 'saved-messages', name: 'SavedMessages', desc: 'Bloc-notes privé local intégré dans la barre d’en-tête', cat: 'tools', icon: 'changelog', start: hdrBtnPlugin('dc-saved-msg-btn', 'Messages enregistrés (local)', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>', () => { const cur = localStorage.getItem('dc_saved_notes') || ''; const nxt = prompt('Notes locales DreamCord :', cur); if (nxt !== null) { localStorage.setItem('dc_saved_notes', nxt); toast('Notes sauvegardées'); } }) },
    { id: 'client-diagnostics', name: 'ClientDiagnostics', desc: 'Affiche un résumé FPS, mémoire et plugins actifs en un clic', cat: 'tools', icon: 'info', start: hdrBtnPlugin('dc-diag-btn', 'Diagnostics DreamCord', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>', () => { const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' Mo' : 'N/A'; toast(`Plugins actifs: ${active.size}/${PLUGINS.length} | DOM: ${document.querySelectorAll('*').length} | RAM: ${mem}`); }) },
    { id: 'startup-timings', name: 'StartupTimings', desc: 'Affiche le temps de démarrage du client dans les logs', cat: 'tools', icon: 'timer', start: () => { log(`[StartupTimings] ${Math.round(performance.now())} ms`); } },
    { id: 'react-error-decoder', name: 'ReactErrorDecoder', desc: 'Capture et journalise les erreurs React dans patch.log', cat: 'tools', icon: 'code', start: () => listen(window, 'error', (e) => { if (String(e.message).includes('Minified React error')) log('[ReactError] ' + e.message); }) },
    { id: 'keyboard-sounds', name: 'KeyboardSounds', desc: 'Joue un clic mécanique discret à chaque frappe clavier', cat: 'tools', icon: 'pulse', start: () => listen(document, 'keydown', (e) => { if (e.key.length === 1 && !e.ctrlKey && !e.altKey) playSynthTone(420 + Math.random() * 140, 0.025, 'triangle', 0.03); }) },
    { id: 'moyai', name: 'Moyai', desc: 'Joue un son grave « Moyai » quand un 🗿 est envoyé', cat: 'tools', icon: 'pulse', start: () => listen(document, 'keydown', (e) => { if (e.key === 'Enter' && e.target?.textContent?.includes('🗿')) playSynthTone(95, 0.35, 'sawtooth', 0.08); }, true) },
    { id: 'animalese', name: 'Animalese', desc: 'Petits sons synthétiques style Animal Crossing lors de la frappe', cat: 'tools', icon: 'pulse', start: () => listen(document, 'keydown', (e) => { if (e.key.length === 1 && !e.ctrlKey) playSynthTone(620 + Math.random() * 340, 0.04, 'sine', 0.035); }) },
    { id: 'exit-sounds', name: 'ExitSounds', desc: 'Son de confirmation lors de la déconnexion d’un vocal', cat: 'tools', icon: 'pulse', start: () => listen(document, 'click', (e) => { if (e.target?.closest?.('[aria-label*="Déconnecter" i],[aria-label*="Disconnect" i]')) playSynthTone(300, 0.14, 'sine', 0.06); }) },
    { id: 'volume-booster', name: 'VolumeBooster', desc: 'Booste le volume des lecteurs audio/vidéo (200%) via WebAudio', cat: 'tools', icon: 'pulse', start: () => { const off = addTask('volume-booster', () => qAll('audio,video').forEach((m) => { if (m.closest('#dc-wallpaper')) return; try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const ctx = (window._dcAudioCtx ||= new AC()); if (!m._dcAudioSrc) { m._dcAudioSrc = ctx.createMediaElementSource(m); m._dcGain = ctx.createGain(); m._dcComp = ctx.createDynamicsCompressor(); m._dcComp.threshold.value = -1; m._dcComp.ratio.value = 1; m._dcAudioSrc.connect(m._dcGain); m._dcGain.connect(m._dcComp); m._dcComp.connect(ctx.destination); } m._dcGain.gain.value = 2.0; } catch {} })); return chain(off, () => document.querySelectorAll('audio,video').forEach((m) => { if (m._dcGain) m._dcGain.gain.value = 1.0; })); } },
    { id: 'audio-limiter', name: 'AudioLimiter', desc: 'Compresseur WebAudio contre les pics audio soudains', cat: 'tools', icon: 'shield', start: () => { const off = addTask('audio-limiter', () => qAll('audio,video').forEach((m) => { if (m.closest('#dc-wallpaper')) return; try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const ctx = (window._dcAudioCtx ||= new AC()); if (!m._dcAudioSrc) { m._dcAudioSrc = ctx.createMediaElementSource(m); m._dcGain = ctx.createGain(); m._dcComp = ctx.createDynamicsCompressor(); m._dcAudioSrc.connect(m._dcGain); m._dcGain.connect(m._dcComp); m._dcComp.connect(ctx.destination); } m._dcComp.threshold.value = -14; m._dcComp.ratio.value = 12; } catch {} })); return chain(off, () => document.querySelectorAll('audio,video').forEach((m) => { if (m._dcComp) { m._dcComp.threshold.value = -1; m._dcComp.ratio.value = 1; } })); } },
    { id: 'disable-call-idle', name: 'DisableCallIdle', desc: 'Empêche l’exclusion automatique après 3 min seul en appel DM', cat: 'tools', icon: 'timer', start: () => addTask('disable-call-idle', () => document.querySelectorAll('[role="dialog"] button').forEach((b) => { if (/rester|stay|still there/i.test(b.textContent || '') && !b.dataset.dcIdle) { b.dataset.dcIdle = '1'; b.click(); } })) },
    { id: 'disable-cameras', name: 'DisableCameras', desc: 'Masque les flux caméra dans les salons vocaux pour économiser le GPU', cat: 'tools', icon: 'eyeoff', start: cssPlugin('disable-cameras', '[class*="videoFrame_"] video{display:none!important}') },
    { id: 'never-pause-previews', name: 'NeverPausePreviews', desc: 'Empêche la mise en pause des vidéos/aperçus hors focus', cat: 'tools', icon: 'eye', start: () => { const iv = setInterval(() => document.querySelectorAll('[class*="streamPreview_"] video, [class*="pictureInPicture"] video').forEach((v) => { if (v.paused) v.play().catch(() => {}); }), 1500); return () => clearInterval(iv); } },
    { id: 'soggy', name: 'Soggy', desc: 'Ajoute un bouton Soggy Cat dans la barre d’en-tête', cat: 'tools', icon: 'heart', start: hdrBtnPlugin('dc-soggy-btn', 'Soggy Cat', '<span style="font-size:15px">🐱</span>', () => { playSynthTone(780, 0.09, 'sine', 0.06); toast('Meow! 🐱'); }) },
    { id: 'replace-google-search', name: 'ReplaceGoogleSearch', desc: 'Ajoute une recherche DuckDuckGo rapide sur le texte sélectionné (Alt+G)', cat: 'tools', icon: 'search', start: () => listen(document, 'keydown', (e) => { if (e.altKey && e.key.toLowerCase() === 'g') { const sel = window.getSelection()?.toString()?.trim(); if (sel) window.open('https://duckduckgo.com/?q=' + encodeURIComponent(sel), '_blank'); } }) }
  ];
  PLUGINS.push(...EXTRA_PLUGINS);

  const PLUGIN_I18N = {
    'lively-wallpaper': {
      enName: 'Live Wallpaper', enDesc: 'Video, GIF or image background',
      frInfo: ['Affiche une vidéo, un GIF ou une image animée derrière Discord.', 'Réglages (engrenage) de cette carte pour choisir le fichier et l’opacité.'],
      enInfo: ['Displays a video, GIF or image behind Discord.', 'Click the gear icon on this card to pick a file and adjust opacity.']
    },
    'message-logger': {
      enName: 'Message Logger', enDesc: 'Keep deleted messages in red',
      frInfo: ['Garde les messages supprimés visibles en rouge dans le chat.', 'Automatique dans tous les salons et MPs tant qu’il est actif.'],
      enInfo: ['Keeps deleted messages visible in red in chat.', 'Works automatically in all channels and DMs while enabled.']
    },
    'translate': {
      enName: 'Translate', enDesc: 'Alt + right click to translate',
      frInfo: ['Traduit un message directement sous son texte dans ta langue.', 'Maintiens Alt + clic droit sur un message pour afficher/masquer.'],
      enInfo: ['Translates a message inline right below its text.', 'Hold Alt + right click on any message to toggle translation.']
    },
    'view-raw': {
      enName: 'View Raw', enDesc: 'Shift + right click: copy raw',
      frInfo: ['Copie l’ID, la date ISO et le texte brut d’un message.', 'Maintiens Maj + clic droit sur un message.'],
      enInfo: ['Copies the ID, ISO date and raw text of a message.', 'Hold Shift + right click on any message.']
    },
    'exact-timestamps': {
      enName: 'Exact Timestamps', enDesc: 'Show hours, minutes and seconds',
      frInfo: ['Ajoute les secondes exactes (HH:MM:SS) à côté de l’heure.', 'Automatique sur tous les messages du chat.'],
      enInfo: ['Adds exact seconds (HH:MM:SS) next to message timestamps.', 'Automatic on all chat messages.']
    },
    'char-count': {
      enName: 'Char Counter', enDesc: '2000 character limit badge',
      frInfo: ['Affiche un compteur au-dessus de la barre de texte dès 1500 caractères.', 'Visible en bas à droite de la zone de saisie.'],
      enInfo: ['Shows a counter above the chat box starting at 1500 chars.', 'Appears at the bottom-right of the message input.']
    },
    'hide-typing': {
      enName: 'Silent Typing', enDesc: 'Hide "is typing..." status',
      frInfo: ['Empêche Discord d’envoyer ton statut « est en train d’écrire… ».', 'Automatique dans tous les salons et MPs.'],
      enInfo: ['Blocks Discord from sending your "is typing..." indicator.', 'Automatic in all channels and DMs.']
    },
    'no-telemetry': {
      enName: 'No Telemetry', enDesc: 'Block Discord analytics & Sentry',
      frInfo: ['Bloque les requêtes statistiques (/science, /metrics, sentry.io).', 'Actif en arrière-plan pour alléger le réseau.'],
      enInfo: ['Blocks analytics requests (/science, /metrics, sentry.io).', 'Runs silently in the background.']
    },
    'privacy-blur': {
      enName: 'Privacy Blur', enDesc: 'Blur messages & names until hover',
      frInfo: ['Floute les messages, pseudos et MPs tant que la souris n’est pas dessus.', 'Passe la souris pour révéler ; intensité réglable via l’engrenage.'],
      enInfo: ['Blurs messages, usernames and DMs until you hover over them.', 'Hover to reveal; adjust blur strength via the gear icon.']
    },
    'call-timer': {
      enName: 'Call Timer', enDesc: 'Live voice call stopwatch',
      frInfo: ['Affiche un chronomètre de durée en direct pendant tes appels vocaux.', 'Visible dans la barre d’état vocale en bas à gauche.'],
      enInfo: ['Displays a live stopwatch during voice calls.', 'Shown in the voice connection bar at the bottom-left.']
    },
    'clock': {
      enName: 'Clock', enDesc: 'Time pill at top of window',
      frInfo: ['Affiche l’heure actuelle en haut au centre de Discord.', 'Visible en permanence tant que le plugin est activé.'],
      enInfo: ['Displays the current time at the top-center of Discord.', 'Always visible while enabled.']
    },
    'window-opacity': {
      enName: 'Window Opacity', enDesc: 'Adjust whole window opacity',
      frInfo: ['Rend toute la fenêtre Discord semi-transparente.', 'Règle le pourcentage via le bouton engrenage.'],
      enInfo: ['Makes the entire Discord window semi-transparent.', 'Adjust percentage via the gear icon.']
    },
    'declutter-ui': {
      enName: 'Declutter UI', enDesc: 'Hide Nitro, Shop & Quests',
      frInfo: ['Masque les boutons Nitro, Boutique, Quêtes et Cadeau.', 'Nettoie automatiquement la barre latérale et la saisie.'],
      enInfo: ['Hides Nitro, Shop, Quests and Gift buttons.', 'Automatically cleans up sidebar and chat bar.']
    },
    'hide-activity': {
      enName: 'Hide Activity', enDesc: 'Hide "Active Now" column',
      frInfo: ['Masque la colonne « En ce moment » dans l’onglet Amis.', 'Automatique sur l’écran d’accueil Amis.'],
      enInfo: ['Hides the "Active Now" column in the Friends tab.', 'Automatic on the Friends home screen.']
    },
    'font-size': {
      enName: 'Font Size', enDesc: 'Customize chat message size',
      frInfo: ['Change la taille du texte des messages dans le chat (12 à 24 px).', 'Réglable via le bouton engrenage.'],
      enInfo: ['Changes chat message font size (12 to 24 px).', 'Configurable via the gear icon.']
    },
    'lite-mode': {
      enName: 'Lite Mode', enDesc: 'Disable animations & blur (FPS)',
      frInfo: ['Coupe les animations et les flous pour gagner en fluidité / FPS.', 'Actif partout dès l’activation.'],
      enInfo: ['Disables CSS animations and backdrop blurs to boost FPS.', 'Active everywhere once enabled.']
    },
    'custom-css': {
      enName: 'Custom CSS', enDesc: 'Built-in editor + themes folder',
      frInfo: ['Applique ton propre CSS en direct et charge les .css du dossier thèmes.', 'Clique sur l’engrenage pour ouvrir l’éditeur.'],
      enInfo: ['Applies your custom CSS live and loads .css from themes folder.', 'Click the gear icon to open the editor.']
    },
    'server-cloner': {
      enName: 'Server Cloner', enDesc: 'Right-click server to clone',
      frInfo: ['Clone nom, icône, rôles, catégories et salons vers un nouveau serveur.', 'Clic droit sur l’icône d’un serveur → Option DreamCord → Cloner.'],
      enInfo: ['Clones name, icon, roles, categories and channels to a new server.', 'Right-click any server icon → Option DreamCord → Clone.']
    },
    'custom-profile': {
      enName: 'Custom Profile', enDesc: 'Customize your profile, old username badge, Nitro/Boost badges, avatar decoration & connections',
      frInfo: ['Personnalise ton profil Discord : pseudo, badge « Ancien nom d’utilisateur » (#), tag de clan, badges Staff/Nitro/Boost/Cadeaux, 46 décorations d’avatar, 30 effets de profil et connexions vérifiées.', 'Icône crayon en haut à droite, bouton engrenage (⚙) sur la carte Custom Profile ou clic droit sur ton profil.'],
      enInfo: ['Customize your Discord profile: username, Old Username (#) badge, clan tag, Staff/Nitro/Boost/Gifting badges, 46 avatar decorations, 30 profile effects, and verified connections.', 'Pencil icon in top-right header, gear icon (⚙) on Custom Profile card, or right-click your profile.']
    },
    'custom-friend': {
      enName: 'Custom Friend', enDesc: 'Right-click: local name & avatar',
      frInfo: ['Change localement le pseudo et la PP d’un ami (visible que pour toi).', 'Clic droit sur un ami/profil → Custom Friend ; liste via l’engrenage.'],
      enInfo: ['Locally changes a friend’s nickname and avatar (client-side only).', 'Right-click any friend/profile → Custom Friend; manage via gear icon.']
    },
    'fake-message-send': {
      enName: 'Fake Message Send', enDesc: 'Paper plane: fake local message',
      frInfo: ['Insère un faux message local au nom d’un membre de la conv.', 'Clique sur l’icône avion en papier dans la barre de chat.'],
      enInfo: ['Inserts a local fake message under any member’s name.', 'Click the paper-plane icon in the chat input bar.']
    },
    'clear-messages': {
      enName: 'All Clear Message', enDesc: 'Delete all your messages in a chat',
      frInfo: ['Supprime tous tes messages envoyés dans la conversation ouverte.', 'Icône corbeille en haut à droite du chat ou clic droit sur un MP.'],
      enInfo: ['Deletes all messages you sent in the current conversation.', 'Trash icon in top-right chat toolbar or right-click a DM.']
    },
    'quick-copy-id': {
      enName: 'Quick Copy ID', enDesc: 'Ctrl + click to copy any Discord ID',
      frInfo: ['Copie instantanément l’ID d’un utilisateur, d’un message ou d’un serveur.', 'Maintiens Ctrl + clic gauche sur un avatar, pseudo, message ou serveur.'],
      enInfo: ['Instantly copies a user, message, or server ID to your clipboard.', 'Hold Ctrl + left-click on any avatar, username, message, or server.']
    },
    'clean-links': {
      enName: 'Clean Links', enDesc: 'Strip tracking params when pasting URLs',
      frInfo: ['Supprime automatiquement les paramètres de suivi (utm, si, fbclid, igsh) des liens collés.', 'Automatique dès que tu colles une URL dans la barre de message.'],
      enInfo: ['Automatically strips tracking parameters (utm, si, fbclid, igsh) from pasted URLs.', 'Runs automatically whenever you paste a URL in chat.']
    },
    'better-codeblocks': {
      enName: 'Codeblock Copy', enDesc: 'One-click Copy button on code blocks',
      frInfo: ['Ajoute un bouton « Copier » discret en haut à droite de chaque bloc de code.', 'Survole n’importe quel bloc de code dans le chat pour copier son contenu.'],
      enInfo: ['Adds a sleek one-click Copy button to the top-right of every code block.', 'Hover over any code block in chat to copy its text.']
    },
    'thin-scrollbars': {
      enName: 'Thin Scrollbars', enDesc: 'Ultra-slim modern scrollbars everywhere',
      frInfo: ['Remplace les barres de défilement épaisses de Discord par des barres fines de 5 px.', 'Automatique dans les salons, le chat et la liste des membres.'],
      enInfo: ['Replaces Discord’s thick scrollbars with sleek 5px modern scrollbars.', 'Applies automatically across channels, chat, and member lists.']
    },
    'spoiler-reveal': {
      enName: 'Spoiler Reveal', enDesc: 'Reveal blurred spoilers on hover',
      frInfo: ['Dévoile automatiquement les textes et images sous spoiler au simple survol.', 'Passe la souris sur n’importe quel spoiler dans le chat.'],
      enInfo: ['Automatically reveals blurred text and media spoilers on mouse hover.', 'Hover over any spoiler in chat without clicking.']
    },
    'always-on-top': {
      enName: 'Always On Top', enDesc: 'Pin Discord window above other apps',
      frInfo: ['Garde la fenêtre Discord épinglée au-dessus de toutes tes autres applications.', 'Active ou désactive ce plugin à tout moment pour épingler/détacher.'],
      enInfo: ['Keeps the Discord window pinned above all other open applications.', 'Toggle this plugin anytime to pin or unpin the window.']
    },
    'hide-blocked': {
      enName: 'Hide Blocked Messages', enDesc: 'Hide "X blocked messages" banners',
      frInfo: ['Supprime complètement les lignes « X messages bloqués » dans le fil de discussion.', 'Automatique dans tous les salons et MPs.'],
      enInfo: ['Completely hides "X blocked messages" placeholders from chat.', 'Runs automatically in all channels and DMs.']
    },
    'compact-members': {
      enName: 'Auto-Hide Members', enDesc: 'Collapse member list until hover',
      frInfo: ['Réduit la colonne des membres à une bande fine qui s’ouvre au passage de la souris.', 'Passe la souris sur la liste des membres à droite pour l’agrandir.'],
      enInfo: ['Collapses the right member list into a slim bar that expands on hover.', 'Hover over the member list on the right to expand it.']
    },
    'image-zoom': {
      enName: 'ImageZoom', enDesc: 'Shift + click any image to zoom smoothly',
      frInfo: ['Ouvre n’importe quelle image ou GIF du chat dans une loupe monochrome avec zoom molette et déplacement.', 'Maintiens Maj + clic gauche sur une image dans le chat (molette pour zoomer, Échap pour fermer).'],
      enInfo: ['Opens any chat image or GIF in a clean monochrome zoom lightbox with scroll-wheel zoom and pan.', 'Hold Shift + left-click on any chat image (scroll to zoom, Esc to close).']
    },
    'view-icons': {
      enName: 'ViewIcons', enDesc: 'Right-click avatar or banner to view full HD',
      frInfo: ['Permet d’afficher en grand (HD) et copier l’URL de n’importe quel avatar, icône de serveur ou bannière.', 'Clic droit sur un avatar, une bannière ou une icône de serveur → Option DreamCord → Voir en HD.'],
      enInfo: ['Lets you preview full-size HD avatars, server icons, or profile banners and copy their URL.', 'Right-click any avatar, banner, or server icon → DreamCord Options → View HD.']
    },
    'show-id': {
      enName: 'ShowID', enDesc: 'Display copyable Discord ID inside user profiles',
      frInfo: ['Affiche l’ID Discord d’un utilisateur directement dans sa fiche profil avec copie en un clic.', 'Automatique sur tous les popouts et panneaux de profil ouverts.'],
      enInfo: ['Displays a user’s Discord snowflake ID right inside their profile card with 1-click copy.', 'Automatic on all opened user profile popouts and side panels.']
    },
    'fast-discord': {
      enName: 'FastDiscord', enDesc: 'High-speed rendering mode for maximum FPS',
      frInfo: ['Active content-visibility sur le chat/membres et coupe les flous et transitions lourdes pour accélérer Discord.', 'Actif partout dès l’activation sans altérer les paramètres DreamCord.'],
      enInfo: ['Applies content-visibility to chat/member lists and strips heavy blurs/transitions for peak responsiveness.', 'Active everywhere while keeping DreamCord panels crisp.']
    },
    'fake-delete': {
      enName: 'FakeDeleteMessage', enDesc: 'Right-click a message to hide it locally',
      frInfo: ['Cache visuellement un message uniquement pour ta session actuelle (restauré au rechargement).', 'Clic droit sur un message → Option DreamCord → Masquer localement.'],
      enInfo: ['Visually hides any message for the current session only (restored on reload).', 'Right-click any message → DreamCord Options → Hide locally.']
    },
    'reverse-image-search': {
      enName: 'ReverseImageSearch', enDesc: 'Right-click image for Google Lens or TinEye',
      frInfo: ['Ajoute une recherche d’image inversée (Google Lens et TinEye) dans le menu clic droit des images.', 'Clic droit sur une image du chat → Option DreamCord → Google Lens / TinEye.'],
      enInfo: ['Adds one-click reverse image search (Google Lens & TinEye) to the image context menu.', 'Right-click any image → DreamCord Options → Google Lens / TinEye.']
    },
    'passcode-lock': {
      enName: 'PasscodeLock', enDesc: 'Lock Discord behind a monochrome PIN screen',
      frInfo: ['Verrouille Discord derrière un écran PIN Noir & Blanc (code par défaut : 1234, modifiable via l’engrenage).', 'Appuie sur Ctrl + Maj + L ou clique sur le cadenas en bas à gauche.'],
      enInfo: ['Locks Discord behind a clean monochrome PIN screen (default PIN: 1234, editable via gear icon).', 'Press Ctrl + Shift + L or click the lock button in the bottom-left user bar.']
    },
    'stealth-mode': {
      enName: 'StealthMode', enDesc: 'Ctrl+Shift+H hides all DreamCord UI indicators',
      frInfo: ['Masque instantanément tous les boutons et badges DreamCord pour des captures d’écran ou partages propres.', 'Appuie sur Ctrl + Maj + H pour activer / désactiver le mode furtif.'],
      enInfo: ['Instantly hides all DreamCord buttons and badges for clean screenshots and screenshares.', 'Press Ctrl + Shift + H to toggle stealth mode on or off.']
    },
    'macos-buttons': {
      enName: 'OS Window Mode (macOS / Win / Linux)', enDesc: 'Window controls in macOS, Windows 11 or Linux style',
      frInfo: ['Transforme les boutons de la barre de titre en style macOS (pastilles Traffic Lights), Windows 11 Fluent ou Linux (GNOME Adwaita).', 'Visible en haut à droite de la fenêtre Discord · choisissez macOS, Windows ou Linux.'],
      enInfo: ['Transforms the titlebar window controls into macOS Traffic Lights, Windows 11 Fluent, or Linux GNOME Adwaita style.', 'Visible in the top-right titlebar · choose macOS, Windows, or Linux.']
    },
    'write-uppercase': {
      enName: 'WriteUpperCase', enDesc: 'Auto-capitalize the first letter of sentences',
      frInfo: ['Met automatiquement une majuscule au début de tes messages et après chaque point, ? ou !.', 'Automatique dans la barre de saisie du chat (ignore les liens et commandes).'],
      enInfo: ['Automatically capitalizes the first letter of messages and after sentence endings (., !, ?).', 'Automatic in chat input (safely skips URLs, mentions, and slash commands).']
    },
    'picture-in-picture': {
      enName: 'PictureInPicture', enDesc: 'Add a Picture-in-Picture button on chat videos',
      frInfo: ['Ajoute un bouton PiP discret sur les vidéos du chat pour les regarder en fenêtre flottante.', 'Survole n’importe quelle vidéo dans le chat et clique sur PiP.'],
      enInfo: ['Adds a compact PiP button to chat videos to pop them into a floating window.', 'Hover over any video in chat and click PiP.']
    },
    'decode-base64': {
      enName: 'DecodeBase64', enDesc: 'Decode Base64 strings inside messages (Ctrl+Right-click)',
      frInfo: ['Décode automatiquement un texte Base64 présent dans un message et permet de le copier.', 'Maintiens Ctrl + clic droit sur un message contenant du Base64.'],
      enInfo: ['Decodes Base64 strings found inside any message and lets you copy the result.', 'Hold Ctrl + right-click on a message containing Base64 text.']
    },
    'no-caps': {
      enName: 'NoCaps', enDesc: 'Convert accidental ALL-CAPS messages to lowercase',
      frInfo: ['Convertit automatiquement les messages contenant 60 % ou plus de majuscules en minuscules avant l’envoi.', 'Automatique dans la barre de discussion lorsque tu appuies sur Entrée.'],
      enInfo: ['Automatically converts messages with 60%+ uppercase letters to lowercase before sending.', 'Runs automatically in chat input when pressing Enter.']
    },
    'image-filename': {
      enName: 'ImageFilename', enDesc: 'Show image and GIF filenames on hover',
      frInfo: ['Affiche le nom de fichier d’origine des images et GIF dans une infobulle au survol.', 'Passe la souris sur une image ou un GIF dans le chat.'],
      enInfo: ['Displays the original filename of images and GIFs as a tooltip on hover.', 'Hover over any image or GIF in chat.']
    },
    'irc-colors': {
      enName: 'IrcColors', enDesc: 'Assign unique deterministic colors to usernames in chat',
      frInfo: ['Donne une couleur unique et lisible à chaque utilisateur sans couleur de rôle, façon client IRC.', 'Automatique sur les pseudos dans les messages du chat.'],
      enInfo: ['Assigns a unique, readable deterministic color to usernames without a role color.', 'Applies automatically to usernames in chat messages.']
    },
    'jump-to-top': {
      enName: 'JumpToTop', enDesc: 'Quick floating button to jump to top of loaded messages',
      frInfo: ['Ajoute un bouton discret en bas à droite du chat pour remonter instantanément en haut du salon.', 'Visible en bas à droite de la zone de discussion.'],
      enInfo: ['Adds a discreet floating button to jump smoothly to the top of loaded messages.', 'Visible in the bottom-right corner of the chat area.']
    },
    'copy-profile-id': {
      enName: 'CopyProfileId', enDesc: 'Quick Copy ID button inside user profile popouts',
      frInfo: ['Ajoute un bouton « ID » à côté des actions du profil pour copier l’identifiant en un clic.', 'Ouvre le profil d’un utilisateur et clique sur le bouton ID.'],
      enInfo: ['Adds a quick "ID" button next to profile actions to copy the user ID in one click.', 'Open any user profile popout and click the ID button.']
    },
    'member-count': {
      enName: 'MemberCount', enDesc: 'Show visible member counter at top of member list',
      frInfo: ['Affiche un compteur sobre en haut de la colonne des membres du serveur.', 'Visible automatiquement en haut de la liste des membres à droite.'],
      enInfo: ['Shows a clean counter at the top of the server member sidebar.', 'Automatically displayed at the top of the right member list.']
    },
    'plain-folder-icon': {
      enName: 'PlainFolderIcon', enDesc: 'Hide mini server icons inside collapsed folders',
      frInfo: ['Masque les 4 petites miniatures de serveurs dans les dossiers fermés pour une barre plus sobre.', 'Automatique sur la barre latérale des serveurs.'],
      enInfo: ['Hides the mini guild thumbnails inside closed server folders for a cleaner sidebar.', 'Applies automatically to the server list sidebar.']
    },
    'custom-title': {
      enName: 'Title', enDesc: 'Replace "Discord" window title prefix with "DreamCord"',
      frInfo: ['Remplace automatiquement le préfixe « Discord » par « DreamCord » dans le titre de la fenêtre.', 'Automatique dans la barre de titre et la barre des tâches.'],
      enInfo: ['Automatically replaces "Discord" with "DreamCord" in the window title.', 'Applies automatically to the window and taskbar title.']
    },
    'unindent': {
      enName: 'Unindent', enDesc: 'Strip redundant leading indentation in code blocks',
      frInfo: ['Supprime les espaces d’indentation superflus au début des blocs de code pour une lecture plus propre.', 'Automatique sur les blocs de code du chat.'],
      enInfo: ['Removes common leading indentation from code blocks for cleaner readability.', 'Applies automatically to code blocks in chat.']
    },
    'double-emoji': {
      enName: 'DoubleEmoji', enDesc: 'Keep emoji picker open when clicking emojis',
      frInfo: ['Maintient le sélecteur d’emojis ouvert après chaque clic pour en insérer plusieurs à la suite.', 'Clique simplement sur plusieurs emojis dans le sélecteur sans maintenir Maj.'],
      enInfo: ['Keeps the emoji picker open after clicking so you can insert multiple emojis quickly.', 'Click multiple emojis in the picker without holding Shift.']
    },
    'fix-codeblock-gap': {
      enName: 'FixCodeblockGap', enDesc: 'Remove extra empty spacing below code blocks',
      frInfo: ['Supprime l’espace vertical excessif sous les blocs de code dans le chat.', 'Automatique sur tous les messages contenant du code.'],
      enInfo: ['Removes excessive vertical spacing below code blocks in chat.', 'Applies automatically to all messages with code blocks.']
    },
    'voice-chat-double-click': {
      enName: 'VoiceChatDoubleClick', enDesc: 'Require double-click to join voice channels',
      frInfo: ['Empêche de rejoindre un salon vocal par accident : un double-clic est désormais nécessaire.', 'Double-clique sur un salon vocal dans la barre latérale pour le rejoindre.'],
      enInfo: ['Prevents accidentally joining voice channels by requiring a double-click.', 'Double-click any voice channel in the sidebar to connect.']
    },
    'message-colors': {
      enName: 'MessageColors', enDesc: 'Show color swatch preview next to hex codes (#FF0042)',
      frInfo: ['Affiche un petit carré de couleur cliquable à côté des codes hexadécimaux dans le chat.', 'Clique sur le carré de couleur pour copier le code hex.'],
      enInfo: ['Displays a clickable color swatch next to hex color codes in chat.', 'Click the swatch to copy the hex code.']
    },
    'clean-channel-name': {
      enName: 'CleanChannelName', enDesc: 'Strip decorative emojis and symbols from channel names',
      frInfo: ['Retire les emojis et séparateurs décoratifs au début des noms de salons pour une liste plus lisible.', 'Automatique dans la barre latérale des salons.'],
      enInfo: ['Strips decorative emojis and prefixes from channel names for cleaner readability.', 'Applies automatically to the channel sidebar.']
    },
    'cleaner-channel-groups': {
      enName: 'CleanerChannelGroups', enDesc: 'Dim unread channels inside collapsed categories',
      frInfo: ['Atténue visuellement les salons non lus qui restent visibles sous les catégories repliées.', 'Automatique dans la barre des salons.'],
      enInfo: ['Visually dims unread channels shown under collapsed categories.', 'Applies automatically to the channel list.']
    },
    'collapsible-ui': {
      enName: 'CollapsibleUI', enDesc: 'Quick toolbar buttons to collapse channel & member sidebars',
      frInfo: ['Ajoute deux boutons discrets en haut du chat pour replier la barre des salons ou des membres.', 'Boutons ◧ et ◨ dans la barre d’outils en haut à droite.'],
      enInfo: ['Adds two compact toolbar buttons to toggle the channel sidebar and member list.', 'Use the ◧ and ◨ buttons in the top-right chat toolbar.']
    },
    'color-sighted': {
      enName: 'ColorSighted', enDesc: 'Classic round status dots instead of shaped status icons',
      frInfo: ['Remplace les icônes de statut (lune, sens interdit) par des pastilles rondes classiques.', 'Automatique sur tous les avatars.'],
      enInfo: ['Replaces shaped status icons with classic circular status dots.', 'Applies automatically to all user avatars.']
    },
    'direct-file-download': {
      enName: 'DirectFileDownload', enDesc: 'Add a direct download button next to file links',
      frInfo: ['Ajoute un bouton ↓ discret à côté des pièces jointes pour les télécharger directement.', 'Visible à côté des fichiers envoyés dans le chat.'],
      enInfo: ['Adds a compact ↓ button next to attachment links for direct downloads.', 'Appears next to file attachments in chat.']
    },
    'fix-images-quality': {
      enName: 'FixImagesQuality', enDesc: 'Load chat images at full lossless quality',
      frInfo: ['Force le chargement des images du chat en qualité maximale sans compression agressive.', 'Automatique sur les images Discord du chat.'],
      enInfo: ['Upgrades chat image thumbnails to lossless quality automatically.', 'Runs automatically on Discord chat images.']
    },
    'send-timestamps': {
      enName: 'SendTimestamps', enDesc: 'Clock button in chat bar to insert Discord timestamps',
      frInfo: ['Ajoute un bouton horloge dans la barre de saisie pour insérer un horodatage dynamique <t:…:R>.', 'Clique sur l’icône horloge à côté de la barre de message.'],
      enInfo: ['Adds a clock button to the chat bar to insert a live <t:...:R> Discord timestamp.', 'Click the clock icon in the chat input toolbar.']
    },
    'server-list-indicators': {
      enName: 'ServerListIndicators', enDesc: 'Display total server count badge in server sidebar',
      frInfo: ['Affiche un petit compteur du nombre total de serveurs en haut de la colonne des serveurs.', 'Visible en haut de la barre de serveurs à gauche.'],
      enInfo: ['Displays a compact total server count badge at the top of the server list.', 'Visible at the top of the left guild sidebar.']
    },
    'show-all-message-buttons': {
      enName: 'ShowAllMessageButtons', enDesc: 'Keep message action buttons visible on hover',
      frInfo: ['Rend tous les boutons d’action des messages immédiatement accessibles au survol.', 'Survole n’importe quel message dans le chat.'],
      enInfo: ['Keeps message action buttons immediately accessible on hover.', 'Hover over any message in chat.']
    },
    'hide-media': {
      enName: 'HideMedia', enDesc: 'Quick button to blur/hide individual chat images',
      frInfo: ['Ajoute un bouton « Masquer » au survol de chaque image du chat pour la flouter à la demande.', 'Survole une image dans le chat et clique sur Masquer.'],
      enInfo: ['Adds a "Hide" button on hover for any chat image to blur it on demand.', 'Hover over any image in chat and click Hide.']
    },
    'no-dm-while-streaming': {
      enName: 'NoDMWhileStreaming', enDesc: 'Auto-blur DM list while screen sharing',
      frInfo: ['Floute automatiquement ta liste de messages privés dès qu’un partage d’écran est actif.', 'Survole un MP pour le révéler temporairement.'],
      enInfo: ['Automatically blurs your DM sidebar whenever screen sharing is active.', 'Hover over a DM to temporarily reveal it.']
    },
    'server-search': {
      enName: 'ServerSearch', enDesc: 'Quick server search modal via Ctrl+Shift+S',
      frInfo: ['Ouvre une fenêtre de recherche instantanée pour sauter sur n’importe quel serveur au clavier.', 'Appuie sur Ctrl + Maj + S n’importe où dans Discord.'],
      enInfo: ['Opens an instant keyboard search popup to jump to any server.', 'Press Ctrl + Shift + S anywhere in Discord.']
    },
    'command-palette': {
      enName: 'CommandPalette', enDesc: 'Raycast-style quick command palette (Ctrl+Shift+P)',
      frInfo: ['Palette de commandes rapide pour ouvrir les pages DreamCord, recharger Discord ou lancer DevTools.', 'Appuie sur Ctrl + Maj + P n’importe où dans Discord.'],
      enInfo: ['Quick command palette to jump to DreamCord tabs, reload Discord, or toggle DevTools.', 'Press Ctrl + Shift + P anywhere in Discord.']
    },
    'quick-reply': {
      enName: 'QuickReply', enDesc: 'Press Ctrl + Up Arrow to quickly reply to last message',
      frInfo: ['Permet de répondre instantanément au dernier message du salon avec un raccourci clavier.', 'Appuie sur Ctrl + Flèche Haut dans n’importe quel salon.'],
      enInfo: ['Instantly starts a reply to the latest message in the channel.', 'Press Ctrl + Up Arrow in any channel.']
    },
    'recent-dm-switcher': {
      enName: 'RecentDMSwitcher', enDesc: 'Press Ctrl+Shift+E to toggle between last 2 channels/DMs',
      frInfo: ['Bascule instantanément entre le salon actuel et le salon/MP précédent.', 'Appuie sur Ctrl + Maj + E pour faire l’aller-retour.'],
      enInfo: ['Instantly switches back and forth between your last two channels or DMs.', 'Press Ctrl + Shift + E to toggle.']
    },
    'pin-icon': {
      enName: 'PinIcon', enDesc: 'Highlight pinned system notices in chat',
      frInfo: ['Met visuellement en avant les messages système d’épingle avec une bordure blanche sobre.', 'Automatique dans tous les salons.'],
      enInfo: ['Highlights pinned message system notices with a clean monochrome border.', 'Applies automatically in all channels.']
    },
    'hide-server-boosts': {
      enName: 'HideServerBoosts', enDesc: 'Hide server boost progress bars and Nitro upsells',
      frInfo: ['Supprime les barres de niveau de boost et bannières promotionnelles Nitro dans les serveurs.', 'Automatique dans la barre des salons.'],
      enInfo: ['Hides server boost progress bars and Nitro upsell banners.', 'Applies automatically to server sidebars.']
    },
    'hide-gift-sticker': {
      enName: 'HideGiftSticker', enDesc: 'Hide Gift, GIF and Sticker buttons in chat input',
      frInfo: ['Épure complètement la barre de saisie en retirant les boutons Cadeau, GIF et Autocollants.', 'Automatique dans la barre de message.'],
      enInfo: ['Declutters the chat input bar by hiding Gift, GIF, and Sticker buttons.', 'Applies automatically to the message box.']
    },
    'hide-voice-names': {
      enName: 'HideVoiceNames', enDesc: 'Blur member usernames in voice channels until hover',
      frInfo: ['Floute les pseudos des personnes connectées en vocal dans la barre latérale jusqu’au survol.', 'Pratique pour partager ton écran sans exposer qui est en vocal.'],
      enInfo: ['Blurs usernames inside sidebar voice channels until hovered.', 'Great for screensharing without exposing who is in voice.']
    },
    'wide-chat': {
      enName: 'WideChat', enDesc: 'Expand chat message width by reducing side padding',
      frInfo: ['Réduit les marges latérales des messages pour afficher davantage de contenu sur chaque ligne.', 'Automatique dans le fil de discussion.'],
      enInfo: ['Reduces horizontal padding on chat messages to show more content per line.', 'Applies automatically to the chat feed.']
    },
    'compact-channels': {
      enName: 'CompactChannels', enDesc: 'Tighter channel sidebar spacing to view more channels',
      frInfo: ['Compacte l’espacement vertical des salons pour afficher plus de salons sans scroller.', 'Automatique dans la colonne des salons.'],
      enInfo: ['Tightens vertical spacing in the channel list so more channels fit on screen.', 'Applies automatically to the channel sidebar.']
    },
    'hide-typing-bar': {
      enName: 'HideTypingBar', enDesc: 'Hide the "is typing..." indicator at the bottom of chat',
      frInfo: ['Masque complètement la ligne « X est en train d’écrire… » sous la barre de saisie.', 'Automatique dans tous les salons et MPs.'],
      enInfo: ['Completely hides the "is typing..." indicator below the chat box.', 'Applies automatically in all channels and DMs.']
    },
    'copy-message-link': {
      enName: 'CopyMessageText', enDesc: 'Alt + double-click any message to copy its text',
      frInfo: ['Copie instantanément le texte complet d’un message en un geste.', 'Maintiens Alt + double-clic sur un message dans le chat.'],
      enInfo: ['Instantly copies the full text of any message in one gesture.', 'Hold Alt + double-click on any message in chat.']
    },
    'auto-focus-chat': {
      enName: 'AutoFocusChat', enDesc: 'Automatically focus chat input when you start typing',
      frInfo: ['Place automatiquement le curseur dans la barre de message dès que tu tapes une lettre.', 'Automatique quand aucune autre fenêtre ou champ n’est ouvert.'],
      enInfo: ['Automatically focuses the chat input box as soon as you start typing.', 'Works automatically whenever no other input or modal is focused.']
    },
    'square-avatars': {
      enName: 'SquareAvatars', enDesc: 'Modern slightly-rounded square avatars across Discord',
      frInfo: ['Remplace les avatars ronds par des carrés aux coins légèrement arrondis (6 px) partout.', 'Automatique dans le chat, la liste des membres et les MPs.'],
      enInfo: ['Replaces circular avatars with modern slightly-rounded square avatars (6px).', 'Applies automatically across chat, members, and DMs.']
    },
    'hide-avatars-chat': {
      enName: 'HideAvatarsChat', enDesc: 'Minimal IRC-style chat without message avatars',
      frInfo: ['Masque les photos de profil dans le fil de discussion pour un style texte ultra-épuré.', 'Automatique dans les messages du chat.'],
      enInfo: ['Hides avatars in the chat feed for an ultra-clean minimal text layout.', 'Applies automatically to chat messages.']
    },
    'reading-mode': {
      enName: 'ReadingMode', enDesc: 'Center chat messages at a comfortable reading width',
      frInfo: ['Centre le fil de discussion sur une largeur maximale de 860 px pour lire confortablement sur grand écran.', 'Automatique dans tous les salons.'],
      enInfo: ['Centers the chat message column at a comfortable 860px max reading width.', 'Applies automatically in all channels.']
    }
  };

  // CSS perso : thèmes du dossier + éditeur intégré
  function buildCustomCss() {
    const themes = (boot.themes || []).map((t) => `/* ${t.file} */\n${t.css}`).join('\n');
    return `${themes}\n/* éditeur */\n${config.customCss || ''}`;
  }

  function dismissDiscordMenu(menu) {
    if (menu) menu.style.display = 'none';
    const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true });
    document.dispatchEvent(ev);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  }

  const SHARED_MODAL_CSS =
    '.dc-ctx-clone{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0;padding:6px 8px;border-radius:6px;color:#f4f4f5;font-size:14px;font-weight:500;cursor:pointer;user-select:none;transition:background .12s,color .12s}' +
    '.dc-ctx-clone:hover{background:var(--dc-accent,#ffffff);color:var(--dc-accent-fg,#09090b)}' +
    '.dc-ctx-hdr{display:flex;align-items:center;gap:8px;margin:6px 4px 2px;padding:2px 0;font:700 10.5px/1 "gg sans",Segoe UI,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#a1a1aa;user-select:none}' +
    '.dc-ctx-hdr::before,.dc-ctx-hdr::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.1)}' +
    '.dc-clone-backdrop{position:fixed;inset:0;z-index:999998;background:rgba(0,0,0,.76);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;font:14px/1.45 "gg sans","Noto Sans",Segoe UI,system-ui,sans-serif;color:#f4f4f5}' +
    '.dc-clone-box{width:480px;max-width:calc(100vw - 32px);background:#09090b;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:22px;box-shadow:0 24px 64px rgba(0,0,0,.85);display:flex;flex-direction:column;gap:14px;animation:dc-pop .15s cubic-bezier(.16,1,.3,1)}' +
    '.dc-clone-head{display:flex;align-items:center;justify-content:space-between;gap:12px}' +
    '.dc-clone-title{font-size:17px;font-weight:700;color:#ffffff}' +
    '.dc-clone-pct{font-size:15px;font-weight:700;color:#ffffff;font-variant-numeric:tabular-nums}' +
    '.dc-clone-status{font-size:13.5px;color:#e4e4e7}.dc-clone-meta{font-size:12px;color:#71717a}' +
    '.dc-clone-bar{width:100%;height:5px;border-radius:999px;background:#1c1c20;overflow:hidden}' +
    '.dc-clone-fill{height:100%;width:0%;background:var(--dc-accent,#ffffff);transition:width .18s ease}' +
    '.dc-clone-bots{max-height:170px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:10px;background:#0f0f12;border:1px solid rgba(255,255,255,.08)}' +
    '.dc-clone-bot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:#e4e4e7}' +
    '.dc-clone-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}' +
    '.dc-clone-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#16161a;color:#f4f4f5;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .14s,border-color .14s,color .14s,opacity .14s,transform .1s}' +
    '.dc-clone-btn:hover{background:#222227;border-color:rgba(255,255,255,.22);color:#ffffff}' +
    '.dc-clone-btn:active{transform:scale(.98)}' +
    '.dc-clone-btn.primary{background:var(--dc-accent,#ffffff);border-color:transparent;color:var(--dc-accent-fg,#09090b)}' +
    '.dc-clone-btn.primary:hover{opacity:.88}' +
    '.dc-clone-btn.danger{color:#f87171;border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.1)}' +
    '.dc-clone-btn.danger:hover{background:#dc2626;border-color:#dc2626;color:#ffffff}' +
    '.dc-cf-box{width:430px;max-width:92vw;max-height:88vh;overflow-y:auto;padding:22px;border-radius:14px;background:#09090b;border:1px solid rgba(255,255,255,.1);color:#f4f4f5;font:14px/1.45 "gg sans",Segoe UI,sans-serif;box-shadow:0 24px 64px rgba(0,0,0,.85);display:flex;flex-direction:column;gap:14px;animation:dc-pop .15s cubic-bezier(.16,1,.3,1)}' +
    '.dc-cf-head{display:flex;align-items:center;gap:12px}' +
    '.dc-cf-av{width:48px;height:48px;border-radius:50%;object-fit:cover;background:#16161a;flex-shrink:0}' +
    '.dc-cf-title{font-size:17px;font-weight:700;color:#ffffff}.dc-cf-uid{font-size:12px;color:#a1a1aa}' +
    '.dc-cf-lbl{font-size:12px;font-weight:600;color:#a1a1aa;margin-bottom:5px}' +
    '.dc-cf-in{width:100%;height:38px;background:#0f0f12;border:1px solid rgba(255,255,255,.1);color:#ffffff;border-radius:9px;padding:0 12px;font:inherit;outline:none;box-sizing:border-box;transition:border-color .15s}' +
    '.dc-cf-in:focus{border-color:rgba(255,255,255,.4)}' +
    '.dc-cf-row{display:flex;gap:8px;align-items:center}' +
    '.dc-cf-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}' +
    '@keyframes dc-pop{from{opacity:0;transform:scale(.96) translateY(6px)}to{opacity:1;transform:none}}';

  let wpReq = null;
  const storeCache = {};
  const getStore = (name, pred, hints) => storeCache[name] || (storeCache[name] = findWebpackExport(pred, hints));
  const getUserStore = () => getStore('user', (m) => typeof m.getUser === 'function' && typeof m.getCurrentUser === 'function', ['getCurrentUser', 'getUser']);
  function matchWebpackExports(exp, pred) {
    if (!exp || (typeof exp !== 'object' && typeof exp !== 'function')) return null;
    try {
      if (pred(exp)) return exp;
    } catch {}
    for (const k of Reflect.ownKeys(exp)) {
      let val;
      try {
        val = exp[k];
      } catch {
        continue;
      }
      if (val && (typeof val === 'object' || typeof val === 'function')) {
        try {
          if (pred(val)) return val;
        } catch {}
        try {
          if (val.default && (typeof val.default === 'object' || typeof val.default === 'function') && pred(val.default)) {
            return val.default;
          }
        } catch {}
      }
    }
    return null;
  }
  function findWebpackExport(pred, hints) {
    try {
      if (!wpReq || !wpReq.c || Object.keys(wpReq.c).length < 500) {
        const chunkKeys = Object.keys(window).filter((k) => k.startsWith('webpackChunk'));
        if (!chunkKeys.length && window.webpackChunkdiscord_app) chunkKeys.push('webpackChunkdiscord_app');
        for (const ck of chunkKeys) {
          let rTmp = null;
          try {
            window[ck]?.push([[Symbol()], {}, (r) => { rTmp = r; }]);
          } catch {}
          if (rTmp?.c && Object.keys(rTmp.c).length >= (wpReq?.c ? Object.keys(wpReq.c).length : 0)) {
            wpReq = rTmp;
          }
        }
      }
      const cache = wpReq?.c;
      if (cache) {
        for (const id in cache) {
          const hit = matchWebpackExports(cache[id]?.exports, pred);
          if (hit) return hit;
        }
      }
      if (Array.isArray(hints) && hints.length && wpReq?.m) {
        for (const id of Object.keys(wpReq.m)) {
          let s;
          try {
            s = wpReq.m[id]?.toString?.() || '';
          } catch {
            continue;
          }
          if (!s || !hints.every((h) => s.includes(h))) continue;
          try {
            const exp = wpReq(id);
            const hit = matchWebpackExports(exp, pred);
            if (hit) return hit;
          } catch {}
        }
      }
    } catch {}
    return null;
  }

  let capturedRendererToken = '';
  try {
    const origSetReqHeader = XMLHttpRequest.prototype.setRequestHeader;
    if (typeof origSetReqHeader === 'function' && !origSetReqHeader._dc_tok_tap) {
      const tapped = function (name, value) {
        try {
          if (String(name).toLowerCase() === 'authorization' && typeof value === 'string') {
            const v = value.trim();
            if (v.length > 20 && !v.startsWith('Bot ') && v.includes('.')) capturedRendererToken = v;
          }
        } catch {}
        return origSetReqHeader.apply(this, arguments);
      };
      tapped._dc_tok_tap = true;
      XMLHttpRequest.prototype.setRequestHeader = tapped;
    }
    const origFetch = window.fetch;
    if (typeof origFetch === 'function' && !origFetch._dc_tok_tap) {
      const tappedFetch = function (input, init) {
        try {
          const h = init?.headers;
          let auth = '';
          if (h && typeof h.get === 'function') auth = h.get('Authorization') || h.get('authorization') || '';
          else if (h && typeof h === 'object') auth = h.Authorization || h.authorization || '';
          if (typeof auth === 'string') {
            const v = auth.trim();
            if (v.length > 20 && !v.startsWith('Bot ') && v.includes('.')) capturedRendererToken = v;
          }
        } catch {}
        return origFetch.apply(this, arguments);
      };
      tappedFetch._dc_tok_tap = true;
      window.fetch = tappedFetch;
    }
  } catch {}

  let cachedRestApi = null;
  function getRestApi() {
    if (!cachedRestApi) {
      const isBase = (m) =>
        m &&
        typeof m.get === 'function' &&
        typeof m.post === 'function' &&
        (typeof m.patch === 'function' || typeof m.put === 'function') &&
        (typeof m.del === 'function' || typeof m.delete === 'function');
      cachedRestApi =
        findWebpackExport((m) => isBase(m) && (typeof m.getAPIBaseURL === 'function' || typeof m.put === 'function' || /url|rejectWithError|oldFormErrors/.test(String(m.get))), ['getAPIBaseURL']) ||
        findWebpackExport(isBase, ['rejectWithError']) ||
        findWebpackExport(isBase) ||
        findWebpackExport((m) => m && typeof m.get === 'function' && typeof m.getAPIBaseURL === 'function', ['getAPIBaseURL']);
    }
    return cachedRestApi;
  }

  function getAuthToken() {
    if (capturedRendererToken) return capturedRendererToken;
    try {
      const checkMod = (m) => {
        if (!m || typeof m.getToken !== 'function') return '';
        try {
          const t = m.getToken();
          if (typeof t === 'string' && t.length > 20 && t.includes('.')) return t;
        } catch {}
        return '';
      };
      const cache = wpReq?.c;
      if (cache) {
        for (const id in cache) {
          try {
            const exp = cache[id]?.exports;
            if (!exp || (typeof exp !== 'object' && typeof exp !== 'function')) continue;
            const direct = checkMod(exp);
            if (direct) return direct;
            for (const k of Reflect.ownKeys(exp)) {
              try {
                const v = exp[k];
                const hit = checkMod(v);
                if (hit) return hit;
                if (v?.default) {
                  const hitDef = checkMod(v.default);
                  if (hitDef) return hitDef;
                }
              } catch {}
            }
          } catch {}
        }
      }
      const f = findWebpackExport((m) => Boolean(checkMod(m)), ['getToken']);
      const tok = checkMod(f);
      if (tok) return tok;
    } catch {}
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body?.appendChild(iframe);
      const raw = iframe.contentWindow?.localStorage?.getItem('token');
      iframe.remove();
      if (raw) {
        const parsed = String(raw).replace(/^"|"$/g, '');
        if (parsed.length > 20 && parsed.includes('.')) return parsed;
      }
    } catch {}
    return '';
  }

  async function dcDiscordApi(method, path, _unused, body, step = '') {
    const rest = getRestApi();
    const fnMap = { GET: 'get', POST: 'post', PATCH: 'patch', DELETE: 'del', PUT: 'put' };
    const fn = rest ? (rest[fnMap[method] || 'get'] || (method === 'DELETE' ? rest.delete : null)) : null;

    if (typeof fn === 'function') {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fn.call(rest, { url: path, ...(body ? { body } : {}) });
          return res?.body ?? null;
        } catch (err) {
          const status = err?.status ?? err?.body?.status;
          if (status === 429) {
            const waitMs = Math.ceil((Number(err?.body?.retry_after || 1.5) * 1000) + 200);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          if (err?.body?.captcha_key) {
            throw new Error('Discord demande un captcha pour cette action.');
          }
          const msg = err?.body?.message || err?.message || `HTTP ${status || 'erreur'}`;
          log(`[API] ${step || path} -> ${status || '?'}: ${msg}`);
          throw new Error(step ? `${step}: ${msg}` : msg);
        }
      }
      throw new Error('Trop de requêtes (rate limit Discord)');
    }

    const token = getAuthToken();
    if (!token) throw new Error('Module RestAPI Discord introuvable');

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://discord.com/api/v9${path}`, {
        method,
        headers: {
          Authorization: token,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        const waitMs = Math.ceil((Number(data?.retry_after || 1.5) * 1000) + 200);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.captcha_key) throw new Error('Discord demande un captcha pour cette action.');
        const msg = data?.message || `HTTP ${res.status}`;
        log(`[API] ${step || path} -> ${res.status}: ${msg}`);
        throw new Error(step ? `${step}: ${msg}` : msg);
      }
      return data;
    }
    throw new Error('Trop de requêtes (rate limit Discord)');
  }

  async function fetchIconDataUri(guild) {
    if (!guild?.icon) return null;
    try {
      const res = await fetch(`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=512`);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const rd = new FileReader();
        rd.onloadend = () => resolve(typeof rd.result === 'string' ? rd.result : null);
        rd.onerror = () => resolve(null);
        rd.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  async function cloneGuild(guildId) {
    const token = null;
    document.getElementById('dc-clone-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'dc-clone-modal';
    wrap.className = 'dc-clone-backdrop';
    setHTML(
      wrap,
      `
      <div class="dc-clone-box">
        <div class="dc-clone-head">
          <div class="dc-clone-title">${esc(L('Clonage de serveur', 'Server Cloner'))}</div>
          <div class="dc-clone-pct" id="dc-cl-pct">0 %</div>
        </div>
        <div class="dc-clone-status" id="dc-cl-status">${esc(L('Récupération du serveur…', 'Fetching server...'))}</div>
        <div class="dc-clone-bar"><div class="dc-clone-fill" id="dc-cl-fill"></div></div>
        <div class="dc-clone-meta" id="dc-cl-meta">${esc(L('Initialisation…', 'Initializing...'))}</div>
        <div id="dc-cl-extra"></div>
        <div class="dc-clone-actions" id="dc-cl-actions">
          <button type="button" class="dc-clone-btn" id="dc-cl-close">${esc(L('Fermer', 'Close'))}</button>
        </div>
      </div>`
    );
    document.body.appendChild(wrap);
    const setProg = (txt, pct, meta) => {
      const p = Math.round(Math.min(100, Math.max(0, pct)));
      const s = wrap.querySelector('#dc-cl-status');
      const f = wrap.querySelector('#dc-cl-fill');
      const pc = wrap.querySelector('#dc-cl-pct');
      const mt = wrap.querySelector('#dc-cl-meta');
      if (s) s.textContent = txt;
      if (f) f.style.width = `${p}%`;
      if (pc) pc.textContent = `${p} %`;
      if (mt && meta !== undefined) mt.textContent = meta;
    };
    let aborted = false;
    const closeClone = () => {
      aborted = true;
      offEsc();
      wrap.remove();
    };
    const offEsc = listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeClone();
      }
    }, true);
    wrap.querySelector('#dc-cl-close').onclick = closeClone;
    wrap.onclick = (e) => { if (e.target === wrap) closeClone(); };

    try {
      const GuildStore = findWebpackExport((m) => typeof m.getGuild === 'function' && typeof m.getGuilds === 'function');
      const RoleStore = findWebpackExport((m) => typeof m.getSortedRoles === 'function' && typeof m.getRole === 'function');
      const GuildChStore = findWebpackExport((m) => typeof m.getChannels === 'function' && typeof m.getDefaultChannel === 'function');
      const toArr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

      const [apiGuild, apiRoles, apiChannels] = await Promise.all([
        dcDiscordApi('GET', `/guilds/${guildId}`, token, null, L('Lecture serveur', 'Fetch server')).catch(() => null),
        dcDiscordApi('GET', `/guilds/${guildId}/roles`, token, null, L('Lecture rôles', 'Fetch roles')).catch(() => null),
        dcDiscordApi('GET', `/guilds/${guildId}/channels`, token, null, L('Lecture salons', 'Fetch channels')).catch(() => null)
      ]);
      const guild = apiGuild || GuildStore?.getGuild?.(guildId);
      if (!guild) throw new Error(L('Serveur source introuvable', 'Source server not found'));
      let roles = toArr(apiRoles);
      if (!roles.length) roles = toArr(RoleStore?.getSortedRoles?.(guildId));
      let channels = toArr(apiChannels);
      if (!channels.length) {
        const chData = GuildChStore?.getChannels?.(guildId);
        if (chData) {
          channels = []
            .concat(chData.SELECTABLE || [], chData.VOCAL || [], chData[4] || [])
            .map((x) => x?.channel || x)
            .filter((c) => c && c.id);
        }
      }
      if (aborted) return;

      setProg(L(`Création de « ${guild.name} »…`, `Creating "${guild.name}"...`), 10, L('Téléchargement de l’icône…', 'Downloading icon...'));
      const safeName = String(guild.name || L('Serveur', 'Server')).trim().slice(0, 100).padEnd(2, ' ');
      const icon = await fetchIconDataUri(guild);
      let newGuild;
      try {
        newGuild = await dcDiscordApi(
          'POST',
          '/guilds',
          token,
          { name: safeName, icon: icon || null, channels: [], system_channel_id: null, guild_template_code: '2TffvPucqHkN' },
          L('Création serveur', 'Create server')
        );
      } catch (e) {
        if (icon) {
          newGuild = await dcDiscordApi(
            'POST',
            '/guilds',
            token,
            { name: safeName, icon: null, channels: [], system_channel_id: null, guild_template_code: '2TffvPucqHkN' },
            L('Création serveur', 'Create server')
          );
        } else {
          throw e;
        }
      }
      if (!newGuild?.id) throw new Error(L('Création serveur impossible (aucun ID reçu)', 'Unable to create server (no ID returned)'));
      if (icon && !newGuild.icon) {
        await dcDiscordApi('PATCH', `/guilds/${newGuild.id}`, token, { icon }, L('Icône serveur', 'Server icon')).catch(() => {});
      }
      if (aborted) return;

      const roleMap = { [guildId]: newGuild.id };
      const detectedBots = [];
      const customRoles = roles
        .filter((r) => {
          if (!r || r.id === guildId) return false;
          if (r.managed) {
            if (r.tags?.bot_id) detectedBots.push({ name: r.name, botId: r.tags.bot_id });
            return false;
          }
          return true;
        })
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      const defaultChannels = toArr(await dcDiscordApi('GET', `/guilds/${newGuild.id}/channels`, token).catch(() => []));
      await Promise.all(
        defaultChannels.filter((dc) => dc?.id).map((dc) => dcDiscordApi('DELETE', `/channels/${dc.id}`, token).catch(() => {}))
      );
      if (aborted) return;

      const totalSteps = Math.max(1, customRoles.length + channels.length);
      let done = 0;
      let rolesOk = 0;
      let chansOk = 0;

      const runBatches = async (items, batchSize, fn) => {
        for (let i = 0; i < items.length; i += batchSize) {
          if (aborted) return;
          await Promise.all(items.slice(i, i + batchSize).map(fn));
        }
      };

      await runBatches(customRoles, 3, async (r) => {
        if (aborted) return;
        try {
          const created = await dcDiscordApi('POST', `/guilds/${newGuild.id}/roles`, token, {
            name: String(r.name || 'role').slice(0, 100),
            permissions: String(r.permissions ?? '0'),
            color: Number(r.color || 0),
            hoist: Boolean(r.hoist),
            mentionable: Boolean(r.mentionable)
          }, L('Création rôle', 'Create role'));
          if (created?.id) {
            roleMap[r.id] = created.id;
            rolesOk++;
          }
        } catch {}
        done++;
        setProg(
          L(`Création des rôles : ${r.name}`, `Creating roles: ${r.name}`),
          15 + (done / totalSteps) * 80,
          `${L('Rôles', 'Roles')} : ${rolesOk}/${customRoles.length}`
        );
      });

      const mapOverwrites = (c) =>
        toArr(c.permission_overwrites || c.permissionOverwrites)
          .filter((o) => o && o.type === 0 && roleMap[o.id])
          .map((o) => ({ id: roleMap[o.id], type: 0, allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') }));

      const cats = (channels || []).filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
      const others = (channels || []).filter((c) => c.type !== 4 && [0, 2, 5, 13, 15].includes(c.type)).sort((a, b) => a.position - b.position);
      const catMap = {};
      const metaCounts = () =>
        `${L('Rôles', 'Roles')} : ${rolesOk}/${customRoles.length} · ${L('Salons', 'Channels')} : ${chansOk}/${cats.length + others.length}`;

      await runBatches(cats, 3, async (c) => {
        if (aborted) return;
        try {
          const created = await dcDiscordApi('POST', `/guilds/${newGuild.id}/channels`, token, {
            name: c.name,
            type: 4,
            position: c.position,
            permission_overwrites: mapOverwrites(c)
          });
          if (created?.id) {
            catMap[c.id] = created.id;
            chansOk++;
          }
        } catch {}
        done++;
        setProg(`${L('Catégorie', 'Category')} : ${c.name}`, 15 + (done / totalSteps) * 80, metaCounts());
      });

      await runBatches(others, 3, async (c) => {
        if (aborted) return;
        const payload = {
          name: c.name,
          type: c.type,
          topic: c.topic || undefined,
          nsfw: Boolean(c.nsfw),
          rate_limit_per_user: c.rate_limit_per_user || 0,
          bitrate: c.type === 2 || c.type === 13 ? Math.min(96000, c.bitrate || 64000) : undefined,
          user_limit: c.type === 2 || c.type === 13 ? c.user_limit || 0 : undefined,
          parent_id: c.parent_id && catMap[c.parent_id] ? catMap[c.parent_id] : undefined,
          position: c.position,
          permission_overwrites: mapOverwrites(c)
        };
        try {
          await dcDiscordApi('POST', `/guilds/${newGuild.id}/channels`, token, payload);
          chansOk++;
        } catch {
          if (c.type === 5 || c.type === 15) {
            const fb = await dcDiscordApi('POST', `/guilds/${newGuild.id}/channels`, token, { ...payload, type: 0 }).catch(() => null);
            if (fb?.id) chansOk++;
          }
        }
        done++;
        setProg(`${L('Salon', 'Channel')} : ${c.name}`, 15 + (done / totalSteps) * 80, metaCounts());
      });

      if (aborted) return;
      setProg(L(`Clonage de « ${guild.name} » terminé !`, `Cloned "${guild.name}"!`), 100, metaCounts());
      if (detectedBots.length) {
        setHTML(
          wrap.querySelector('#dc-cl-extra'),
          `<div class="dc-clone-bots">
            <div style="font-size:12px;color:#94a3b8;margin-bottom:2px">${esc(L('Bots détectés (autorisation requise par Discord) :', 'Detected bots (Discord authorization required):'))}</div>
            ${detectedBots
              .map(
                (b) =>
                  `<div class="dc-clone-bot"><span>${esc(b.name)}</span><a class="dc-clone-btn" target="_blank" rel="noreferrer" href="https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(b.botId)}&scope=bot%20applications.commands&guild_id=${encodeURIComponent(newGuild.id)}">${esc(L('Ajouter', 'Add'))}</a></div>`
              )
              .join('')}
          </div>`
        );
      }
      const actions = wrap.querySelector('#dc-cl-actions');
      const goBtn = document.createElement('button');
      goBtn.type = 'button';
      goBtn.className = 'dc-clone-btn primary';
      goBtn.textContent = L('Ouvrir le serveur', 'Open server');
      goBtn.onclick = () => {
        closeClone();
        window.history.pushState({}, '', `/channels/${newGuild.id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      };
      actions.prepend(goBtn);
    } catch (err) {
      if (!aborted) setProg(`${L('Erreur', 'Error')} : ${err?.message || err}`, 0);
    }
  }

  // ============================================================
  //  Custom Friend (pseudo & PP locaux par utilisateur)
  // ============================================================
  const CF_CSS =
    '#dc-cf-modal{position:fixed;inset:0;z-index:100025;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.74);backdrop-filter:blur(8px)}' +
    '.dc-cf-card{--cf-c1:#141418;--cf-c2:#09090b;width:366px;max-width:94vw;max-height:92vh;overflow-y:auto;overflow-x:hidden;border-radius:14px;background:linear-gradient(180deg,var(--cf-c1) 0%,var(--cf-c2) 100%);border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 64px rgba(0,0,0,.85);color:#f4f4f5;font:14px/1.4 "gg sans","Noto Sans",Segoe UI,sans-serif;position:relative;scrollbar-width:thin}' +
    '.dc-cf-banner{height:126px;width:100%;background:linear-gradient(135deg,#27272a 0%,#141418 100%);background-size:cover;background-position:center;position:relative;cursor:pointer}' +
    '.dc-cf-ban-hint{position:absolute;top:10px;right:10px;padding:4px 10px;border-radius:999px;background:rgba(9,9,11,.8);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14);color:#ffffff;font-size:11.5px;font-weight:600;opacity:0;transition:opacity .15s;pointer-events:none}' +
    '.dc-cf-banner:hover .dc-cf-ban-hint{opacity:1}' +
    '.dc-cf-hdr-row{margin-top:-48px;padding:0 18px;display:flex;align-items:flex-end;justify-content:space-between;gap:10px;position:relative;z-index:2}' +
    '.dc-cf-av-wrap{width:92px;height:92px;position:relative;flex-shrink:0}' +
    '.dc-cf-av-ring{width:92px;height:92px;border-radius:50%;overflow:hidden;border:6px solid var(--cf-c1);background:#09090b;box-sizing:border-box;cursor:pointer;position:relative}' +
    '.dc-cf-av-ring img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.dc-cf-av-ring::after{content:attr(data-hint);position:absolute;inset:0;background:rgba(0,0,0,.56);color:#ffffff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s}' +
    '.dc-cf-av-ring:hover::after{opacity:1}' +
    '.dc-cf-deco{position:absolute;inset:-8px;width:108px;height:108px;pointer-events:none;z-index:3;object-fit:contain}' +
    '.dc-cf-sdot{position:absolute;right:2px;bottom:2px;width:26px;height:26px;border-radius:50%;border:5px solid var(--cf-c1);background:#23a55a;z-index:4;cursor:pointer;box-sizing:border-box;transition:transform .12s}' +
    '.dc-cf-sdot:hover{transform:scale(1.08)}' +
    '.dc-cf-sdot[data-st="idle"]{background:#f0b232}.dc-cf-sdot[data-st="dnd"]{background:#f23f43}.dc-cf-sdot[data-st="offline"]{background:#71717a}' +
    '.dc-cf-bwrap{position:relative;flex:1;min-width:0;margin-bottom:8px;display:flex;align-items:center}' +
    '.dc-cf-bdot1{position:absolute;left:2px;top:-12px;width:7px;height:7px;border-radius:50%;background:#0f0f12}' +
    '.dc-cf-bdot2{position:absolute;left:9px;top:-6px;width:11px;height:11px;border-radius:50%;background:#0f0f12}' +
    '.dc-cf-bubble{background:#0f0f12;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:7px 12px;display:inline-flex;align-items:center;gap:6px;max-width:100%;box-shadow:0 6px 16px rgba(0,0,0,.45)}' +
    '.dc-cf-bicon{width:16px;height:16px;flex-shrink:0;color:#e4e4e7;display:inline-flex;align-items:center;justify-content:center}' +
    '.dc-cf-bin{background:transparent;border:0;outline:none;color:#f4f4f5;font:500 13px/1.2 "gg sans",Segoe UI,sans-serif;width:100%;min-width:90px;padding:0}' +
    '.dc-cf-bin::placeholder{color:#71717a}' +
    '.dc-cf-body{padding:12px 18px 20px;display:flex;flex-direction:column;gap:14px}' +
    '.dc-cf-name-in{background:transparent;border:0;outline:none;color:#ffffff;font:800 22px/1.2 "gg sans",Segoe UI,sans-serif;width:100%;padding:2px 4px;margin:-2px -4px;border-radius:6px;transition:background .12s}' +
    '.dc-cf-name-in:hover,.dc-cf-name-in:focus,.dc-cf-sval:hover,.dc-cf-sval:focus,.dc-cf-inline-auto:hover,.dc-cf-inline-auto:focus{background:rgba(255,255,255,.07)}' +
    '.dc-cf-subrow{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-top:-8px;font-size:13.5px;color:#d4d4d8}' +
    '.dc-cf-inline-auto{background:transparent;border:0;outline:none;color:#f4f4f5;font:500 13.5px/1.25 "gg sans",Segoe UI,sans-serif;padding:2px 4px;border-radius:5px;min-width:30px;transition:background .12s}' +
    '.dc-cf-inline-auto.italic{color:#a1a1aa;font-style:italic}' +
    '.dc-cf-inline-auto::placeholder{color:#a1a1aa;opacity:.85}' +
    '.dc-cf-dot{color:#71717a;user-select:none}' +
    '.dc-cf-clan{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 7px;border-radius:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:#f4f4f5;font-size:11.5px;font-weight:700}' +
    '.dc-cf-clan input{background:transparent;border:0;outline:none;color:#ffffff;font:700 11.5px/1 "gg sans",Segoe UI,sans-serif;width:38px;text-align:center;padding:0}' +
    '.dc-cf-badge-pill{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 6px;border-radius:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:#d4d4d8}' +
    '.dc-cf-badge-pill img{width:15px;height:15px;object-fit:contain}' +
    '.dc-cf-btnrow{display:flex;align-items:center;gap:8px}' +
    '.dc-cf-msgbtn{height:34px;padding:0 16px;border-radius:8px;background:var(--dc-accent,#ffffff);border:1px solid transparent;color:var(--dc-accent-fg,#09090b);font:700 13.5px/1 "gg sans",Segoe UI,sans-serif;display:inline-flex;align-items:center;gap:7px;cursor:pointer;transition:opacity .14s,transform .1s}' +
    '.dc-cf-msgbtn:hover{opacity:.88}' +
    '.dc-cf-morebtn{width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#e4e4e7;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,color .15s,transform .1s}' +
    '.dc-cf-morebtn:hover{background:rgba(255,255,255,.16);color:#ffffff}' +
    '.dc-cf-shell{display:flex;align-items:stretch;gap:14px;max-width:96vw;max-height:92vh;animation:dc-pop .16s cubic-bezier(.16,1,.3,1)}' +
    '.dc-cf-side{width:280px;max-width:92vw;max-height:92vh;overflow-y:auto;padding:16px;border-radius:14px;background:#0f0f12;border:1px solid rgba(255,255,255,.1);box-shadow:0 24px 64px rgba(0,0,0,.85);color:#f4f4f5;font:13px/1.4 "gg sans","Noto Sans",Segoe UI,sans-serif;display:flex;flex-direction:column;gap:14px;box-sizing:border-box;scrollbar-width:thin}' +
    '.dc-cf-side.collapsed{display:none}' +
    '.dc-cf-side::-webkit-scrollbar{width:6px}.dc-cf-side::-webkit-scrollbar-track{background:transparent}.dc-cf-side::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:999px}' +
    '.dc-cf-side-ttl{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;margin-bottom:8px}' +
    '.dc-cf-tile-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
    '.dc-cf-sq-tile{height:106px;border-radius:11px;background:#16161a;border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;padding:0;transition:border-color .15s,background .15s}' +
    '.dc-cf-sq-tile:hover{border-color:rgba(255,255,255,.26);background:#1e1e23}' +
    '.dc-cf-sq-av{width:76px;height:76px;border-radius:50%;object-fit:cover;background:#09090b;display:block}' +
    '.dc-cf-sq-deco-wrap{width:76px;height:76px;border-radius:50%;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;position:relative}' +
    '.dc-cf-sq-deco{position:absolute;inset:-8px;width:92px;height:92px;object-fit:contain;pointer-events:none}' +
    '.dc-cf-name-tile{height:52px;width:100%;border-radius:11px;background:#16161a;border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;padding:0 32px;box-sizing:border-box;transition:border-color .15s,background .15s}' +
    '.dc-cf-name-tile:hover{border-color:rgba(255,255,255,.26);background:#1e1e23}' +
    '.dc-cf-name-tile span{font:800 18px/1.2 "gg sans",Segoe UI,sans-serif;color:#f4f4f5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}' +
    '.dc-cf-name-tile input[type="color"]{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}' +
    '.dc-cf-theme-tile{height:106px;border-radius:11px;border:1px solid rgba(255,255,255,.14);display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;position:relative;overflow:hidden;padding:6px 0;box-sizing:border-box}' +
    '.dc-cf-swatch{width:28px;height:28px;border-radius:8px;border:2px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:pointer;position:relative;overflow:hidden;display:block;transition:transform .12s}' +
    '.dc-cf-swatch:hover{transform:scale(1.1)}' +
    '.dc-cf-swatch input[type="color"]{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);border:0;padding:0;background:transparent;cursor:pointer}' +
    '.dc-cf-ban-tile{height:106px;border-radius:11px;background:linear-gradient(135deg,#27272a 0%,#141418 100%);background-size:cover;background-position:center;border:1px solid rgba(255,255,255,.12);cursor:pointer;position:relative;overflow:hidden;padding:0;display:flex;align-items:flex-end;justify-content:center;transition:border-color .15s}' +
    '.dc-cf-ban-tile:hover{border-color:rgba(255,255,255,.35)}' +
    '.dc-cf-ban-tile-lbl{width:100%;padding:4px 0;background:rgba(9,9,11,.72);color:#ffffff;font-size:11px;font-weight:600;text-align:center;opacity:0;transition:opacity .15s}' +
    '.dc-cf-ban-tile:hover .dc-cf-ban-tile-lbl{opacity:1}' +
    '.dc-cf-tile-x{position:absolute;top:5px;right:5px;width:20px;height:20px;border-radius:6px;background:rgba(9,9,11,.76);border:1px solid rgba(255,255,255,.16);color:#e4e4e7;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;padding:0;transition:background .12s,color .12s}' +
    '.dc-cf-tile-x:hover{background:#dc2626;color:#ffffff;border-color:transparent}' +
    '.dc-cf-side-sec{display:flex;flex-direction:column;gap:8px;padding:11px;border-radius:11px;background:#16161a;border:1px solid rgba(255,255,255,.08)}' +
    '#dc-cf-modal input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent,#ffffff) var(--p,0%),rgba(255,255,255,.14) var(--p,0%));outline:none;margin:0;cursor:pointer}' +
    '#dc-cf-modal input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#ffffff;border:2px solid #09090b;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:pointer}' +
    '.dc-cf-reset-btn{margin-top:auto;width:100%;height:36px;border-radius:9px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.38);color:#f87171;font:700 13px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;flex-shrink:0;transition:background .15s,color .15s,transform .12s}' +
    '.dc-cf-reset-btn:hover{background:#dc2626;border-color:#dc2626;color:#ffffff}' +
    '.dc-cf-reset-btn:active{transform:scale(.98)}' +
    '.dc-cf-shdr{font-size:12px;font-weight:700;color:#d4d4d8;margin-bottom:3px}' +
    '.dc-cf-sval{width:100%;background:transparent;border:0;outline:none;color:#f4f4f5;font:400 13.5px/1.38 "gg sans",Segoe UI,sans-serif;padding:3px 5px;margin:-3px -5px;border-radius:6px;resize:none;box-sizing:border-box;transition:background .12s}' +
    '.dc-cf-sval.italic{font-style:italic;color:#a1a1aa}' +
    '.dc-cf-sval::placeholder{color:#a1a1aa;opacity:.8}' +
    '.dc-cf-conn-row{display:flex;align-items:center;gap:8px;color:#d4d4d8;font-size:13.5px}' +
    '.dc-cf-hint{font-size:11px;color:rgba(255,255,255,.45);text-align:center;margin-top:2px}' +
    '.dc-cf-card::-webkit-scrollbar{width:6px}.dc-cf-card::-webkit-scrollbar-track{background:transparent}.dc-cf-card::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:999px}' +
    '.dc-cf-in:focus-visible,.dc-cf-name-in:focus-visible,.dc-cf-sval:focus-visible{box-shadow:0 0 0 1.5px rgba(255,255,255,.45)}' +
    '.dc-cf-msgbtn:active,.dc-cf-morebtn:active{transform:scale(.97)}' +
    '@media (max-width:720px){.dc-cf-shell{flex-direction:column;overflow-y:auto}.dc-cf-side{width:366px;max-height:none}}' +
    '@media (prefers-reduced-motion:reduce){.dc-cf-shell{animation:none}}';

  const getCfUsers = () => ((config.pluginSettings['custom-friend'] ||= { users: {} }).users ||= {});

  function isMemberListContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/membersWrap|members_/i.test(cls)) return true;
    if (el.tagName === 'ASIDE' && el.querySelector('[class*="members_"],[class*="member_"]')) return true;
    return false;
  }

  function isIgnoredDialog(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id && /^dc-(cf|fms|clr|clone|zoom|view)-modal$|^dc-(settings-embedded|lock-overlay)$/.test(el.id)) return true;
    if (el.closest?.('#dc-cf-modal,#dc-fms-modal,#dc-clr-modal,#dc-clone-modal,#dc-zoom-modal,#dc-view-modal,#dc-lock-overlay,#dc-settings-embedded')) return true;
    if (el.querySelector?.('#dc-settings-section,[class*="standardSidebarView_"]')) return true;
    return false;
  }

  function extractUserInfo(target) {
    if (!target || typeof target.closest !== 'function') return null;
    if (target.closest('#dc-cf-modal,#dc-fms-modal,#dc-clr-modal,#dc-clone-modal,#dc-settings-embedded')) return null;
    const mutualRow = target.closest('[class*="listRow"],[role="tabpanel"] [class*="item_"]');
    const item =
      mutualRow ||
      target.closest(
        'aside,[role="dialog"]:not(#dc-cf-modal),li[id^="chat-messages-"],[class*="member_"],[class*="channel_"],[class*="peopleListItem_"],[class*="userPopout"],[class*="userProfile"],[class*="profilePanel"],[class*="header_"],[class*="accountProfileCard_"],[data-user-id]'
      );
    if (!item || isIgnoredDialog(item)) return null;
    if (item.tagName === 'ASIDE' && isMemberListContainer(item)) return null;
    let userId = target.closest('[data-user-id]')?.getAttribute('data-user-id') || item?.getAttribute('data-user-id') || '';
    let origAvatar = '';
    let origName = '';

    const avImg =
      target.closest('img[src*="/avatars/"], img[src*="/users/"], img[data-dc-cf-uid]') ||
      item?.querySelector('img[src*="/avatars/"], img[src*="/users/"], img[data-dc-cf-uid]');
    if (avImg && !avImg.closest?.('[role="tabpanel"],[class*="mutual"]')) {
      origAvatar = avImg.dataset.dcCfOrigSrc || avImg.src || '';
      if (!userId) userId = avImg.dataset.dcCfUid || (origAvatar.match(/\/(?:avatars|users)\/(\d{15,22})\//)?.[1] || '');
    } else if (avImg && mutualRow) {
      origAvatar = avImg.dataset.dcCfOrigSrc || avImg.src || '';
      if (!userId) userId = avImg.dataset.dcCfUid || (origAvatar.match(/\/(?:avatars|users)\/(\d{15,22})\//)?.[1] || '');
    }

    const nameEl = item?.querySelector('[data-dc-cf-field="name"], [id^="message-username-"], [class*="nickname_"], [class*="globalName_"], [class*="username_"], [class*="name_"]');
    if (nameEl) origName = nameEl.dataset.dcCfOrigName || nameEl.textContent?.trim() || '';

    try {
      const roots = [target, avImg, item].filter(Boolean);
      for (const r of roots) {
        let cur = r;
        for (let depth = 0; depth < 14 && cur && !userId; depth++, cur = cur.parentElement) {
          const fk = Object.keys(cur).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$'));
          if (!fk) continue;
          let node = cur[fk];
          for (let i = 0; i < 36 && node && !userId; i++, node = node.return) {
            const p = node.memoizedProps || node;
            const u = p?.user || p?.message?.author || p?.author || p?.participantUser;
            if (u?.id && /^\d{15,22}$/.test(String(u.id))) {
              userId = String(u.id);
              origName ||= u.globalName || u.username || '';
              break;
            }
            const rec = p?.channel?.type === 1 && p?.channel?.recipients?.[0];
            if (rec && /^\d{15,22}$/.test(String(rec))) {
              userId = String(rec);
              break;
            }
          }
        }
        if (userId) break;
      }
    } catch {}
    return userId ? { userId, origName, origAvatar, target } : null;
  }

  function extractDomBioText(el) {
    if (!el) return '';
    let out = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue || '';
        else if (c.nodeType === 1) {
          if (c.tagName === 'IMG' && c.alt) out += c.alt;
          else if (c.tagName === 'BR') out += '\n';
          else {
            const isBlock = /^(DIV|P|LI)$/.test(c.tagName);
            if (isBlock && out && !out.endsWith('\n')) out += '\n';
            walk(c);
            if (isBlock && !out.endsWith('\n')) out += '\n';
          }
        }
      }
    };
    walk(el);
    return out.trim();
  }

  const cfRestored = new Set();

  function applyCustomFriends() {
    const users = getCfUsers();
    const uids = Object.keys(users);
    if (!uids.length) return;

    const activeUids = [];
    for (const uid of uids) {
      const entry = users[uid];
      if (!entry) continue;
      if (entry.disabled) {
        if (!cfRestored.has(uid)) {
          restoreCustomFriend(uid);
          cfRestored.add(uid);
        }
        continue;
      }
      cfRestored.delete(uid);
      activeUids.push(uid);
    }
    if (!activeUids.length) return;

    const activeSet = new Set(activeUids);
    const UserStore = getUserStore();

    // Découverte des panneaux de profil en une seule passe DOM (au lieu de N passes)
    const profileMap = new Map();
    document
      .querySelectorAll('aside, [role="dialog"]:not(#dc-cf-modal), [class*="profilePanel"], [class*="userPanelOuter"], [class*="userProfileOuter"], [class*="userPopoutOuter"]')
      .forEach((pop) => {
        if (isMemberListContainer(pop) || isIgnoredDialog(pop)) return;
        const pInfo = extractUserInfo(pop);
        if (pInfo?.userId && activeSet.has(pInfo.userId)) {
          let set = profileMap.get(pInfo.userId);
          if (!set) profileMap.set(pInfo.userId, (set = new Set()));
          set.add(pop);
        }
      });

    const selectedDm = document.querySelector('[class*="privateChannels_"] :is([class*="selected_"],[aria-current="page"])');
    const selectedDmImgs = selectedDm ? selectedDm.querySelectorAll('img[src*="/avatars/"], img[data-dc-cf-uid]') : null;
    const isDmRoute = location.pathname.startsWith('/channels/@me/');

    const EXCLUDE_IN_PROFILE =
      '[role="tabpanel"],[class*="listRow"],[class*="listScroller"],[class*="mutual"],[class*="badge"],[class*="clan"],[class*="guildTag"],[class*="activity"],[class*="tabBar"],[class*="connectedAccount"],[class*="note_"],[class*="memberSince"],[class*="role_"]';

    const applyImgScale = (img, scale) => {
      if (scale !== 1) {
        if (img.dataset.dcCfOrigTransform === undefined) img.dataset.dcCfOrigTransform = img.style.transform || '';
        if (img.dataset.dcCfOrigFit === undefined) img.dataset.dcCfOrigFit = img.style.objectFit || '';
        if (img.dataset.dcCfOrigRadius === undefined) img.dataset.dcCfOrigRadius = img.style.borderRadius || '';
        const tf = `scale(${scale})`;
        if (img.style.transform !== tf) {
          img.style.objectFit = 'cover';
          img.style.borderRadius = '50%';
          img.style.transform = tf;
        }
        const pe = img.parentElement;
        if (pe && /avatarStack|avatar_/i.test(pe.className || '')) {
          if (img.dataset.dcCfOrigPOverflow === undefined) img.dataset.dcCfOrigPOverflow = pe.style.overflow || '';
          if (img.dataset.dcCfOrigPRadius === undefined) img.dataset.dcCfOrigPRadius = pe.style.borderRadius || '';
          pe.style.overflow = 'hidden';
          pe.style.borderRadius = '50%';
        }
      } else if (img.dataset.dcCfOrigTransform !== undefined) {
        img.style.transform = img.dataset.dcCfOrigTransform;
        img.style.objectFit = img.dataset.dcCfOrigFit || '';
        img.style.borderRadius = img.dataset.dcCfOrigRadius || '';
        delete img.dataset.dcCfOrigTransform;
        delete img.dataset.dcCfOrigFit;
        delete img.dataset.dcCfOrigRadius;
        if (img.parentElement && img.dataset.dcCfOrigPOverflow !== undefined) {
          img.parentElement.style.overflow = img.dataset.dcCfOrigPOverflow;
          img.parentElement.style.borderRadius = img.dataset.dcCfOrigPRadius || '';
          delete img.dataset.dcCfOrigPOverflow;
          delete img.dataset.dcCfOrigPRadius;
        }
      }
    };

    let cachedMentions = null;

    for (const uid of activeUids) {
      const entry = users[uid];
      const storeUser = UserStore?.getUser?.(uid);
      const realOrigName = entry.origName || storeUser?.globalName || storeUser?.username || '';
      const realOrigUser = entry.origUsername || storeUser?.username || '';
      const realOrigClan = entry.origClanTag || (storeUser?.primaryGuild || storeUser?.clan)?.tag || '';

      const collectNameTextNodes = (node, list = []) => {
        for (const c of node.childNodes) {
          if (c.nodeType === 3 && c.nodeValue !== null && c.nodeValue.trim()) {
            list.push(c);
          } else if (
            c.nodeType === 1 &&
            !c.matches(
              'svg,img,[class*="clan"],[class*="guildTag"],[class*="botTag"],[class*="badge"],[class*="pronouns"],[class*="userTag"],.dc-cf-inj-pronouns,[data-dc-cf-field="username"],[data-dc-cf-field="clan"]'
            )
          ) {
            collectNameTextNodes(c, list);
          }
        }
        return list;
      };

      const setName = (el) => {
        if (!el) return;
        el.dataset.dcCfField = 'name';
        el.dataset.dcCfUid = uid;
        const dtNodes = [el, ...el.querySelectorAll('[data-text]')].filter((n) => n.hasAttribute?.('data-text'));
        const tns = collectNameTextNodes(el);

        if (entry.name) {
          dtNodes.forEach((dt) => {
            dt.dataset.dcCfUid = uid;
            if (dt.dataset.dcCfOrigDt === undefined) dt.dataset.dcCfOrigDt = dt.getAttribute('data-text') || '';
            if (dt.getAttribute('data-text') !== entry.name) dt.setAttribute('data-text', entry.name);
          });
          if (tns.length > 1 && tns.every((t) => t.nodeValue.length <= 2 && !t.parentElement?.dataset.dcCfOrigName)) {
            tns.forEach((tn, idx) => {
              const p = tn.parentElement || el;
              p.dataset.dcCfUid = uid;
              if (p.dataset.dcCfOrigChar === undefined) p.dataset.dcCfOrigChar = tn.nodeValue;
              const want = idx === 0 ? entry.name : '';
              if (tn.nodeValue !== want) tn.nodeValue = want;
            });
          } else {
            tns.forEach((tn) => {
              const p = tn.parentElement || el;
              p.dataset.dcCfUid = uid;
              if (p.dataset.dcCfOrigName === undefined) p.dataset.dcCfOrigName = tn.nodeValue;
              if (tn.nodeValue !== entry.name) tn.nodeValue = entry.name;
            });
          }
        } else {
          dtNodes.forEach((dt) => {
            if (dt.dataset.dcCfOrigDt !== undefined) {
              dt.setAttribute('data-text', dt.dataset.dcCfOrigDt);
              delete dt.dataset.dcCfOrigDt;
            }
          });
          el.querySelectorAll('[data-dc-cf-orig-char],[data-dc-cf-orig-name]').forEach((p) => {
            const tn = Array.from(p.childNodes).find((n) => n.nodeType === 3);
            if (tn) {
              if (p.dataset.dcCfOrigChar !== undefined) tn.nodeValue = p.dataset.dcCfOrigChar;
              else if (p.dataset.dcCfOrigName !== undefined) tn.nodeValue = p.dataset.dcCfOrigName;
            }
            delete p.dataset.dcCfOrigChar;
            delete p.dataset.dcCfOrigName;
          });
          if (el.dataset.dcCfOrigName !== undefined) {
            const tn = Array.from(el.childNodes).find((n) => n.nodeType === 3);
            if (tn) tn.nodeValue = el.dataset.dcCfOrigName;
            delete el.dataset.dcCfOrigName;
          }
        }

        const colorTargets = tns.length ? tns.map((t) => t.parentElement || el) : [el];
        colorTargets.forEach((target) => {
          if (entry.color) {
            target.dataset.dcCfUid = uid;
            if (target.dataset.dcCfOrigColor === undefined) target.dataset.dcCfOrigColor = target.style.color || '';
            if (target.dataset.dcCfOrigFill === undefined) target.dataset.dcCfOrigFill = target.style.webkitTextFillColor || '';
            if (target.style.color !== entry.color) {
              target.style.color = entry.color;
              target.style.webkitTextFillColor = entry.color;
            }
          } else if (target.dataset.dcCfOrigColor !== undefined) {
            target.style.color = target.dataset.dcCfOrigColor;
            target.style.webkitTextFillColor = target.dataset.dcCfOrigFill || '';
            delete target.dataset.dcCfOrigColor;
            delete target.dataset.dcCfOrigFill;
          }
        });
      };

      const setLeafText = (el, val, fieldName) => {
        if (!el) return;
        if (fieldName) el.dataset.dcCfField = fieldName;
        const tn = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.nodeValue !== null) || collectNameTextNodes(el)[0];
        if (val) {
          el.dataset.dcCfUid = uid;
          if (el.dataset.dcCfOrigName === undefined) el.dataset.dcCfOrigName = tn ? tn.nodeValue : el.textContent;
          if (tn) {
            if (tn.nodeValue !== val) tn.nodeValue = val;
          } else if (el.textContent !== val) {
            el.textContent = val;
          }
        } else if (el.dataset.dcCfOrigName !== undefined) {
          if (tn) tn.nodeValue = el.dataset.dcCfOrigName;
          else if (!el.children.length) el.textContent = el.dataset.dcCfOrigName;
          delete el.dataset.dcCfOrigName;
        }
      };

      const findByExactText = (rootEl, expected) => {
        if (!rootEl || !expected) return [];
        const norm = expected.trim();
        if (!norm) return [];
        const found = [];
        const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
        let tn;
        while ((tn = walker.nextNode())) {
          const v = (tn.nodeValue || '').trim();
          if (v === norm || v === '@' + norm) {
            const p = tn.parentElement;
            if (p && !p.closest('#dc-cf-modal,#dc-settings-embedded,svg,script,style')) found.push(p);
          }
        }
        return found;
      };

      const profileBoxes = profileMap.get(uid) || new Set();
      const imgs = document.querySelectorAll(`img[src*="/avatars/${uid}/"], img[src*="/users/${uid}/avatars/"], img[data-dc-cf-uid="${uid}"]`);
      const scale = clamp(Number(entry.avatarScale) || 100, 100, 250) / 100;

      imgs.forEach((img) => {
        if (img.closest('#dc-cf-modal,#dc-settings-embedded')) return;
        img.dataset.dcCfUid = uid;
        if (entry.avatar) {
          if (!img.dataset.dcCfOrigSrc) img.dataset.dcCfOrigSrc = img.src;
          if (img.src !== entry.avatar) img.src = entry.avatar;
        } else if (img.dataset.dcCfOrigSrc) {
          img.src = img.dataset.dcCfOrigSrc;
          delete img.dataset.dcCfOrigSrc;
        }
        applyImgScale(img, scale);

        if (img.closest('[role="tabpanel"],[class*="listRow"],[class*="listScroller"]')) return;
        const box = img.closest(
          '[class*="repliedMessage_"],li[id^="chat-messages-"],[class*="member_"],[class*="channel_"],[class*="peopleListItem_"],[class*="upperContainer_"],[class*="accountProfileCard_"],[class*="voiceUser_"],[class*="tile_"],[class*="callAvatarWrapper_"]'
        );
        if (box) {
          let nameEl = null;
          if (box.tagName === 'LI' && box.id.startsWith('chat-messages-')) {
            nameEl = box.querySelector('[id^="message-username-"]');
          } else {
            nameEl =
              box.querySelector('[data-dc-cf-field="name"],[id^="message-username-"],[class*="username_"],[class*="name_"],[class*="nickname_"],[class*="userTagUsername"],h1,[class*="title_"]') ||
              findByExactText(box, realOrigName)[0];
          }
          setName(nameEl);
          return;
        }
        const profileSel = isDmRoute
          ? 'aside,[role="dialog"]:not(#dc-cf-modal),[class*="profilePanel"],[class*="userPanel"],[class*="userProfile"],[class*="userPopout"],[class*="scrollerInner_"] > [class*="container_"],[class*="empty_"]'
          : 'aside,[role="dialog"]:not(#dc-cf-modal),[class*="profilePanel"],[class*="userPanel"],[class*="userProfile"],[class*="userPopout"]';
        const profileBox = img.closest(profileSel);
        if (profileBox && !isMemberListContainer(profileBox) && !isIgnoredDialog(profileBox)) {
          profileBoxes.add(profileBox);
        }
      });

      profileBoxes.forEach((profileBox) => {
        profileBox
          .querySelectorAll('img[src*="/avatars/"], img[src*="/users/"], [class*="avatar"] img')
          .forEach((av) => {
            if (av.closest(EXCLUDE_IN_PROFILE)) return;
            if (av.dataset.dcCfUid && av.dataset.dcCfUid !== uid) return;
            const origSrc = av.dataset.dcCfOrigSrc || av.src || '';
            const urlUid = origSrc.match(/\/(?:avatars|users)\/(\d{15,22})\//)?.[1];
            if (urlUid && urlUid !== uid) return;
            if (!urlUid && !av.dataset.dcCfUid && !/\/embed\/avatars\//.test(origSrc)) return;
            av.dataset.dcCfUid = uid;
            if (entry.avatar) {
              if (!av.dataset.dcCfOrigSrc) av.dataset.dcCfOrigSrc = av.src;
              if (av.src !== entry.avatar) av.src = entry.avatar;
            } else if (av.dataset.dcCfOrigSrc) {
              av.src = av.dataset.dcCfOrigSrc;
              delete av.dataset.dcCfOrigSrc;
            }
            applyImgScale(av, scale);
          });

        const nameTargets = new Set();
        profileBox
          .querySelectorAll('[data-dc-cf-field="name"],[class*="nickname_"],[class*="globalName_"]')
          .forEach((el) => {
            if (!el.closest(EXCLUDE_IN_PROFILE)) nameTargets.add(el);
          });
        if (!nameTargets.size) {
          profileBox.querySelectorAll('h1').forEach((el) => {
            if (!el.closest(EXCLUDE_IN_PROFILE + ',section')) nameTargets.add(el);
          });
        }
        if (!nameTargets.size && realOrigName) {
          findByExactText(profileBox, realOrigName).forEach((n) => {
            if (n.closest(EXCLUDE_IN_PROFILE)) return;
            const container = n.closest('[class*="nickname"],[class*="heading"],[data-text]') || n;
            nameTargets.add(container);
          });
        }
        nameTargets.forEach((el) => setName(el));

        const tagTargets = new Set();
        profileBox
          .querySelectorAll('[data-dc-cf-field="username"],[class*="userTagUsername"],[class*="userTag_"] [class*="username_"]')
          .forEach((el) => {
            if (!el.closest(EXCLUDE_IN_PROFILE)) tagTargets.add(el);
          });
        if (!tagTargets.size && realOrigUser) {
          findByExactText(profileBox, realOrigUser).forEach((n) => {
            if (!nameTargets.has(n) && !n.closest(EXCLUDE_IN_PROFILE)) tagTargets.add(n);
          });
        }
        tagTargets.forEach((el) => setLeafText(el, entry.username ? entry.username.replace(/^@/, '') : '', 'username'));

        const firstTag = Array.from(tagTargets)[0];
        const pronEl = profileBox.querySelector('[class*="pronouns_"]');
        if (pronEl && !pronEl.closest(EXCLUDE_IN_PROFILE)) {
          setLeafText(pronEl, entry.pronouns || '', 'pronouns');
        } else if (firstTag && entry.pronouns) {
          let injP = profileBox.querySelector('.dc-cf-inj-pronouns');
          if (!injP) {
            injP = document.createElement('span');
            injP.className = 'dc-cf-inj-pronouns';
            injP.dataset.dcCfUid = uid;
            injP.style.cssText = 'color:#cbd5e1;font-style:italic;font-size:13px;margin-left:4px';
            firstTag.parentElement?.appendChild(injP);
          }
          const pTxt = ' • ' + entry.pronouns;
          if (injP.textContent !== pTxt) injP.textContent = pTxt;
        } else {
          profileBox.querySelector('.dc-cf-inj-pronouns')?.remove();
        }

        const clanTargets = new Set();
        profileBox
          .querySelectorAll('[data-dc-cf-field="clan"],[class*="clanTag_"],[class*="guildTag_"]')
          .forEach((el) => {
            if (!el.closest('[role="tabpanel"],[class*="listRow"],[class*="mutual"],[class*="activity"]')) clanTargets.add(el);
          });
        if (!clanTargets.size && realOrigClan) {
          findByExactText(profileBox, realOrigClan).forEach((n) => {
            if (!n.closest('[role="tabpanel"],[class*="listRow"],[class*="mutual"],[class*="activity"]')) clanTargets.add(n);
          });
        }
        clanTargets.forEach((el) => setLeafText(el, entry.clanTag || '', 'clan'));

        const avWrap = profileBox.querySelector('[class*="avatar_"],[class*="avatarWrapper"]');
        const natDecos = Array.from(profileBox.querySelectorAll('img[src*="avatar-decoration"],[class*="avatarDecoration"] img')).filter(
          (el) => !el.classList.contains('dc-cf-inj-deco') && !el.closest(EXCLUDE_IN_PROFILE)
        );
        if (entry.decoration) {
          if (natDecos.length) {
            avWrap?.querySelector('.dc-cf-inj-deco')?.remove();
            natDecos.forEach((nat) => {
              if (nat.dataset.dcCfOrigDecoSrc === undefined) nat.dataset.dcCfOrigDecoSrc = nat.getAttribute('src') || '';
              nat.dataset.dcCfUid = uid;
              nat.style.display = '';
              if (nat.src !== entry.decoration) nat.src = entry.decoration;
            });
          } else if (avWrap) {
            let injD = avWrap.querySelector('.dc-cf-inj-deco');
            if (!injD) {
              injD = document.createElement('img');
              injD.className = 'dc-cf-inj-deco';
              injD.dataset.dcCfUid = uid;
              injD.style.cssText = 'position:absolute;inset:-10%;width:120%;height:120%;pointer-events:none;z-index:4;object-fit:contain';
              if (getComputedStyle(avWrap).position === 'static') avWrap.style.position = 'relative';
              avWrap.appendChild(injD);
            }
            if (injD.src !== entry.decoration) injD.src = entry.decoration;
          }
        } else {
          avWrap?.querySelector('.dc-cf-inj-deco')?.remove();
          profileBox.querySelectorAll('[data-dc-cf-orig-deco-src]').forEach((nat) => {
            nat.src = nat.dataset.dcCfOrigDecoSrc;
            delete nat.dataset.dcCfOrigDecoSrc;
          });
          profileBox.querySelectorAll('[data-dc-cf-orig-deco-disp]').forEach((nat) => {
            nat.style.display = nat.dataset.dcCfOrigDecoDisp;
            delete nat.dataset.dcCfOrigDecoDisp;
          });
        }

        const stEl = profileBox.querySelector('[class*="customStatusText_"],[class*="customStatus_"],[class*="statusBubble_"] [class*="content_"]');
        if (stEl && !stEl.closest(EXCLUDE_IN_PROFILE)) {
          setLeafText(stEl, entry.customStatus || '', 'status');
        } else if (entry.customStatus) {
          const hdr = profileBox.querySelector('[class*="header_"],[class*="avatar_"]')?.parentElement;
          let b = profileBox.querySelector('.dc-cf-inj-bubble');
          if (hdr && !b) {
            b = document.createElement('div');
            b.className = 'dc-cf-inj-bubble';
            b.dataset.dcCfUid = uid;
            b.style.cssText =
              'position:absolute;left:112px;top:72px;z-index:5;background:rgba(17,19,24,.94);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:6px 12px;color:#f2f3f5;font:500 13px/1.2 "gg sans",Segoe UI,sans-serif;box-shadow:0 6px 16px rgba(0,0,0,.4);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            b.textContent = entry.customStatus;
            if (getComputedStyle(hdr).position === 'static') hdr.style.position = 'relative';
            hdr.appendChild(b);
          } else if (b && b.textContent !== entry.customStatus) {
            b.textContent = entry.customStatus;
          }
        } else {
          profileBox.querySelector('.dc-cf-inj-bubble')?.remove();
        }

        const bioEl = Array.from(profileBox.querySelectorAll('[class*="bio_"] [class*="markup_"],[class*="markup_"]')).find(
          (m) => !m.closest('[class*="status"],[class*="bubble"],.dc-cf-inj-bio,' + EXCLUDE_IN_PROFILE)
        );
        if (bioEl) {
          if (entry.bio && entry.bio !== entry.origBio) {
            bioEl.dataset.dcCfUid = uid;
            bioEl.dataset.dcCfHiddenBio = '1';
            bioEl.style.display = 'none';
            let injB = profileBox.querySelector('.dc-cf-inj-bio');
            if (!injB) {
              injB = document.createElement('div');
              injB.className = `${bioEl.className} dc-cf-inj-bio`;
              injB.dataset.dcCfUid = uid;
              injB.style.whiteSpace = 'pre-wrap';
              bioEl.parentElement?.insertBefore(injB, bioEl.nextSibling);
            }
            if (injB.textContent !== entry.bio) injB.textContent = entry.bio;
          } else if (bioEl.dataset.dcCfHiddenBio) {
            bioEl.style.display = '';
            delete bioEl.dataset.dcCfHiddenBio;
            profileBox.querySelector('.dc-cf-inj-bio')?.remove();
          }
        } else if (entry.bio) {
          const bodyEl = profileBox.querySelector('[class*="body_"],[class*="scrollerBase_"]');
          if (bodyEl) {
            let injB = profileBox.querySelector('.dc-cf-inj-bio');
            if (!injB) {
              injB = document.createElement('div');
              injB.className = 'dc-cf-inj-bio';
              injB.dataset.dcCfUid = uid;
              injB.style.cssText = 'padding:8px 0;font-size:13.5px;color:#f2f3f5;white-space:pre-wrap';
              bodyEl.prepend(injB);
            }
            if (injB.textContent !== entry.bio) injB.textContent = entry.bio;
          }
        } else {
          profileBox.querySelector('.dc-cf-inj-bio')?.remove();
        }

        const existingSince = profileBox.querySelectorAll('[data-dc-cf-field="since"],[class*="memberSince_"]');
        if (entry.memberSince) {
          const sinceTargets = new Set(existingSince);
          if (!sinceTargets.size) {
            const walker = document.createTreeWalker(profileBox, NodeFilter.SHOW_TEXT);
            let tn;
            while ((tn = walker.nextNode())) {
              const p = tn.parentElement;
              if (!p || p.closest('[role="tabpanel"],[class*="listRow"],[class*="mutual"],[class*="bio_"],[class*="note_"],.dc-cf-inj-bio')) continue;
              const v = (tn.nodeValue || '').trim();
              if (/\b\d{1,2}\s+[a-zA-Zéû]+\s+20\d\d\b/.test(v) || /\b[A-Z][a-z]+\s+\d{1,2},\s+20\d\d\b/.test(v)) {
                sinceTargets.add(p);
              }
            }
          }
          sinceTargets.forEach((el) => setLeafText(el, entry.memberSince, 'since'));
        } else if (existingSince.length) {
          existingSince.forEach((el) => setLeafText(el, '', 'since'));
        }

        const bgTargets = [
          profileBox,
          profileBox.querySelector('[class*="userProfileOuter"],[class*="userPopoutOuter"],[class*="outer_"]'),
          profileBox.querySelector('[class*="userProfileInner"],[class*="userPopoutInner"],[class*="inner_"]')
        ].filter(Boolean);
        bgTargets.forEach((bgTarget) => {
          if (entry.profileColor) {
            const c1 = entry.profileColor;
            const c2 = entry.profileColor2 || c1;
            bgTarget.dataset.dcCfUid = uid;
            if (bgTarget.dataset.dcCfOrigBgColor === undefined) bgTarget.dataset.dcCfOrigBgColor = bgTarget.style.background || '';
            const grad = `linear-gradient(180deg, ${c1} 0%, ${c2} 100%)`;
            if (bgTarget.dataset.dcCfAppliedGrad !== grad) {
              bgTarget.dataset.dcCfAppliedGrad = grad;
              bgTarget.style.background = grad;
              bgTarget.style.setProperty('--profile-gradient-primary-color', c1);
              bgTarget.style.setProperty('--profile-gradient-secondary-color', c2);
              bgTarget.style.setProperty('--profile-body-background-color', 'rgba(0,0,0,0.18)');
            }
          } else if (bgTarget.dataset.dcCfOrigBgColor !== undefined) {
            bgTarget.style.background = bgTarget.dataset.dcCfOrigBgColor;
            bgTarget.style.removeProperty('--profile-gradient-primary-color');
            bgTarget.style.removeProperty('--profile-gradient-secondary-color');
            bgTarget.style.removeProperty('--profile-body-background-color');
            delete bgTarget.dataset.dcCfOrigBgColor;
            delete bgTarget.dataset.dcCfAppliedGrad;
          }
        });

        const banner = profileBox.querySelector('[class*="banner_"], svg[class*="bannerSVGWrapper"] foreignObject > div');
        if (banner) {
          if (entry.banner) {
            banner.dataset.dcCfUid = uid;
            if (banner.dataset.dcCfOrigBg === undefined) banner.dataset.dcCfOrigBg = banner.style.backgroundImage || '';
            if (banner.dataset.dcCfOrigBgSize === undefined) banner.dataset.dcCfOrigBgSize = banner.style.backgroundSize || '';
            if (banner.dataset.dcCfOrigBgPos === undefined) banner.dataset.dcCfOrigBgPos = banner.style.backgroundPosition || '';
            if (banner.dataset.dcCfOrigH === undefined) banner.dataset.dcCfOrigH = banner.style.minHeight || '';
            const bgVal = `url("${entry.banner.replace(/"/g, '\\"')}")`;
            if (banner.style.backgroundImage !== bgVal) {
              banner.style.backgroundImage = bgVal;
              banner.style.backgroundSize = 'cover';
              banner.style.backgroundPosition = 'center';
              banner.style.minHeight = '120px';
              const fo = banner.closest('foreignObject');
              if (fo) {
                if (fo.dataset.dcCfOrigMask === undefined) fo.dataset.dcCfOrigMask = fo.getAttribute('mask') || '';
                if (fo.dataset.dcCfOrigFoH === undefined) fo.dataset.dcCfOrigFoH = fo.getAttribute('height') || '';
                fo.dataset.dcCfUid = uid;
                fo.removeAttribute('mask');
                if (Number(fo.getAttribute('height')) < 120) fo.setAttribute('height', '120');
              }
              const svgW = banner.closest('svg[class*="bannerSVGWrapper"]');
              if (svgW) {
                if (svgW.dataset.dcCfOrigSvgH === undefined) svgW.dataset.dcCfOrigSvgH = svgW.style.minHeight || '';
                svgW.dataset.dcCfUid = uid;
                svgW.style.minHeight = '120px';
              }
            }
          } else if (banner.dataset.dcCfOrigBg !== undefined) {
            banner.style.backgroundImage = banner.dataset.dcCfOrigBg;
            banner.style.backgroundSize = banner.dataset.dcCfOrigBgSize || '';
            banner.style.backgroundPosition = banner.dataset.dcCfOrigBgPos || '';
            banner.style.minHeight = banner.dataset.dcCfOrigH || '';
            delete banner.dataset.dcCfOrigBg;
            delete banner.dataset.dcCfOrigBgSize;
            delete banner.dataset.dcCfOrigBgPos;
            delete banner.dataset.dcCfOrigH;
            const fo = banner.closest('foreignObject');
            if (fo && fo.dataset.dcCfOrigMask !== undefined) {
              if (fo.dataset.dcCfOrigMask) fo.setAttribute('mask', fo.dataset.dcCfOrigMask);
              if (fo.dataset.dcCfOrigFoH) fo.setAttribute('height', fo.dataset.dcCfOrigFoH);
              delete fo.dataset.dcCfOrigMask;
              delete fo.dataset.dcCfOrigFoH;
            }
            const svgW = banner.closest('svg[class*="bannerSVGWrapper"]');
            if (svgW && svgW.dataset.dcCfOrigSvgH !== undefined) {
              svgW.style.minHeight = svgW.dataset.dcCfOrigSvgH;
              delete svgW.dataset.dcCfOrigSvgH;
            }
          }
        }
      });

      if (entry.name && realOrigName) {
        const expected = '@' + realOrigName;
        if (!cachedMentions) cachedMentions = document.querySelectorAll('[class*="mention"]');
        cachedMentions.forEach((m) => {
          if ((m.textContent || '').trim() === expected) {
            setLeafText(m, '@' + entry.name, 'mention');
          }
        });
      }
      if (selectedDmImgs && selectedDmImgs.length === 1 && selectedDmImgs[0].dataset.dcCfUid === uid) {
        document
          .querySelectorAll(
            '[class*="upperContainer_"] h1,[class*="titleWrapper_"] h1,[class*="upperContainer_"] [class*="nicknames_"],[class*="upperContainer_"] [class*="title_"]'
          )
          .forEach((el) => setName(el));
      }
    }
  }

  function restoreCustomFriend(uid) {
    if (!uid) cfRestored.clear();
    const sel = uid ? `[data-dc-cf-uid="${uid}"]` : '[data-dc-cf-uid]';
    document.querySelectorAll(sel).forEach((el) => {
      if (
        el.classList.contains('dc-cf-inj-pronouns') ||
        el.classList.contains('dc-cf-inj-bubble') ||
        el.classList.contains('dc-cf-inj-bio') ||
        el.classList.contains('dc-cf-inj-conn') ||
        el.classList.contains('dc-cf-inj-deco')
      ) {
        el.remove();
        return;
      }
      if (el.dataset.dcCfHiddenBio) {
        el.style.display = '';
        delete el.dataset.dcCfHiddenBio;
      }
      if (el.dataset.dcCfOrigDecoDisp !== undefined) {
        el.style.display = el.dataset.dcCfOrigDecoDisp;
        delete el.dataset.dcCfOrigDecoDisp;
      }
      if (el.dataset.dcCfOrigDt !== undefined) {
        el.setAttribute('data-text', el.dataset.dcCfOrigDt);
        delete el.dataset.dcCfOrigDt;
      }
      if (el.dataset.dcCfOrigMask !== undefined) {
        if (el.dataset.dcCfOrigMask) el.setAttribute('mask', el.dataset.dcCfOrigMask);
        if (el.dataset.dcCfOrigFoH) el.setAttribute('height', el.dataset.dcCfOrigFoH);
        delete el.dataset.dcCfOrigMask;
        delete el.dataset.dcCfOrigFoH;
      }
      if (el.dataset.dcCfOrigSvgH !== undefined) {
        el.style.minHeight = el.dataset.dcCfOrigSvgH;
        delete el.dataset.dcCfOrigSvgH;
      }
      if (el.tagName === 'IMG') {
        if (el.dataset.dcCfOrigSrc) {
          el.src = el.dataset.dcCfOrigSrc;
          delete el.dataset.dcCfOrigSrc;
        }
        if (el.dataset.dcCfOrigTransform !== undefined) {
          el.style.transform = el.dataset.dcCfOrigTransform;
          el.style.objectFit = el.dataset.dcCfOrigFit || '';
          el.style.borderRadius = el.dataset.dcCfOrigRadius || '';
          delete el.dataset.dcCfOrigTransform;
          delete el.dataset.dcCfOrigFit;
          delete el.dataset.dcCfOrigRadius;
        }
        if (el.parentElement && el.dataset.dcCfOrigPOverflow !== undefined) {
          el.parentElement.style.overflow = el.dataset.dcCfOrigPOverflow;
          el.parentElement.style.borderRadius = el.dataset.dcCfOrigPRadius || '';
          delete el.dataset.dcCfOrigPOverflow;
          delete el.dataset.dcCfOrigPRadius;
        }
      } else {
        if (el.dataset.dcCfOrigChar !== undefined) {
          const tn = Array.from(el.childNodes).find((n) => n.nodeType === 3);
          if (tn) tn.nodeValue = el.dataset.dcCfOrigChar;
          delete el.dataset.dcCfOrigChar;
        }
        if (el.dataset.dcCfOrigName !== undefined) {
          const tn = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.nodeValue !== null);
          if (tn) tn.nodeValue = el.dataset.dcCfOrigName;
          else if (!el.children.length) el.textContent = el.dataset.dcCfOrigName;
          delete el.dataset.dcCfOrigName;
        }
        if (el.dataset.dcCfOrigColor !== undefined) {
          el.style.color = el.dataset.dcCfOrigColor;
          el.style.webkitTextFillColor = el.dataset.dcCfOrigFill || '';
          delete el.dataset.dcCfOrigColor;
          delete el.dataset.dcCfOrigFill;
        }
        if (el.dataset.dcCfOrigBg !== undefined) {
          el.style.backgroundImage = el.dataset.dcCfOrigBg;
          el.style.backgroundSize = el.dataset.dcCfOrigBgSize || '';
          el.style.backgroundPosition = el.dataset.dcCfOrigBgPos || '';
          el.style.minHeight = el.dataset.dcCfOrigH || '';
          delete el.dataset.dcCfOrigBg;
          delete el.dataset.dcCfOrigBgSize;
          delete el.dataset.dcCfOrigBgPos;
          delete el.dataset.dcCfOrigH;
        }
        if (el.dataset.dcCfOrigBgColor !== undefined) {
          el.style.background = el.dataset.dcCfOrigBgColor;
          el.style.removeProperty('--profile-gradient-primary-color');
          el.style.removeProperty('--profile-gradient-secondary-color');
          el.style.removeProperty('--profile-body-background-color');
          delete el.dataset.dcCfOrigBgColor;
          delete el.dataset.dcCfAppliedGrad;
        }
      }
      delete el.dataset.dcCfField;
      delete el.dataset.dcCfUid;
    });
  }

  function imageFileToDataUrl(file, maxDim = 256, maxBytes = 350000) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Lecture impossible'));
      reader.onload = () => {
        const res = String(reader.result || '');
        if (file.type === 'image/gif') {
          if (res.length <= maxBytes * 2.5) return resolve(res);
          showToast(L('GIF trop lourd, conversion en image fixe', 'GIF too large, converting to static image'), 'info');
        }
        const im = new Image();
        im.onload = () => {
          let dim = maxDim;
          let q = 0.88;
          let out = res;
          for (let tries = 0; tries < 5; tries++) {
            const scale = Math.min(1, dim / Math.max(im.width || dim, im.height || dim));
            const w = Math.max(1, Math.round(im.width * scale));
            const h = Math.max(1, Math.round(im.height * scale));
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d').drawImage(im, 0, 0, w, h);
            out = c.toDataURL('image/webp', q);
            if (out.length <= maxBytes) break;
            dim = Math.round(dim * 0.8);
            q = Math.max(0.55, q - 0.08);
          }
          resolve(out);
        };
        im.onerror = () => resolve(res);
        im.src = res;
      };
      reader.readAsDataURL(file);
    });
  }

  function getFriendFullData(info) {
    const uid = String(info.userId || '');
    const saved = getCfUsers()[uid] || {};
    const out = {
      userId: uid,
      origName: saved.origName || info.origName || '',
      origNameStyle: '',
      origUsername: saved.origUsername || '',
      origAvatar: info.origAvatar || '',
      origDecoration: '',
      origBanner: '',
      origBio: saved.origBio || '',
      origPronouns: '',
      origClanTag: saved.origClanTag || '',
      origClanBadge: '',
      origBadges: [],
      origMutuals: '',
      origStatus: 'offline',
      origCustomStatus: '',
      origThemePrimary: '#111214',
      origThemeSecondary: '#0a0b0e',
      origMemberSince: '',
      origNote: '',
      myProfile: null
    };
    try {
      const ms = Number((BigInt(uid) >> 22n) + 1420070400000n);
      out.origMemberSince = new Date(ms).toLocaleDateString(isEn() ? 'en-US' : 'fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch {}

    const applyUserObj = (u) => {
      if (!u || String(u.id) !== uid) return;
      out.origUsername ||= u.username || '';
      if (u.globalName || u.username) out.origName = u.globalName || out.origName || u.username || '';
      if (u.avatar) {
        const ext = String(u.avatar).startsWith('a_') ? 'gif' : 'png';
        out.origAvatar = `https://cdn.discordapp.com/avatars/${uid}/${u.avatar}.${ext}?size=256`;
      }
      const decoAsset = u.avatarDecorationData?.asset || u.avatarDecoration?.asset;
      if (decoAsset) {
        out.origDecoration = `https://cdn.discordapp.com/avatar-decoration-presets/${decoAsset}.png?size=240&passthrough=true`;
      }
      const pg = u.primaryGuild || u.clan;
      if (pg?.tag) {
        out.origClanTag = pg.tag;
        if (pg.identityGuildId && pg.badge) {
          out.origClanBadge = `https://cdn.discordapp.com/clan-badges/${pg.identityGuildId}/${pg.badge}.png?size=32`;
        }
      }
      if (u.banner) {
        const bExt = String(u.banner).startsWith('a_') ? 'gif' : 'png';
        out.origBanner = `https://cdn.discordapp.com/banners/${uid}/${u.banner}.${bExt}?size=600`;
      }
    };

    const applyProfObj = (prof) => {
      if (!prof) return;
      const raw = prof._userProfile || prof;
      if (raw.bio || prof.bio) out.origBio = raw.bio || prof.bio || out.origBio;
      if (raw.pronouns || prof.pronouns) out.origPronouns = raw.pronouns || prof.pronouns || out.origPronouns;
      const bh = raw.banner || prof.banner;
      if (bh) {
        const bExt = String(bh).startsWith('a_') ? 'gif' : 'png';
        out.origBanner = `https://cdn.discordapp.com/banners/${uid}/${bh}.${bExt}?size=600`;
      }
      const tc = raw.themeColors || prof.themeColors;
      if (Array.isArray(tc) && tc.length >= 2 && tc[0] !== undefined) {
        out.origThemePrimary = '#' + Number(tc[0]).toString(16).padStart(6, '0');
        out.origThemeSecondary = '#' + Number(tc[1]).toString(16).padStart(6, '0');
      }
      const bList = raw.badges || prof.badges || (typeof prof.getBadges === 'function' ? prof.getBadges() : null);
      if (Array.isArray(bList) && bList.length) {
        out.origBadges = bList
          .filter((b) => b?.icon)
          .map((b) => ({
            id: b.id,
            desc: b.description || b.id,
            url: `https://cdn.discordapp.com/badge-icons/${b.icon}.png`
          }));
      }
    };

    try {
      const UserStore = getUserStore();
      const UserProfileStore = getStore('userProfile', (m) => typeof m.getUserProfile === 'function');
      const PresenceStore = getStore('presence', (m) => typeof m.getActivities === 'function' && typeof m.getStatus === 'function');
      const NoteStore = getStore('note', (m) => typeof m.getNote === 'function');
      applyUserObj(UserStore?.getUser?.(uid));
      applyProfObj(UserProfileStore?.getUserProfile?.(uid));
      if (PresenceStore) {
        const st = PresenceStore.getStatus?.(uid);
        if (st && st !== 'invisible') out.origStatus = st;
        const acts = PresenceStore.getActivities?.(uid) || [];
        const cs = acts.find((a) => a?.type === 4);
        if (cs?.state) out.origCustomStatus = cs.state;
      }
      const noteObj = NoteStore?.getNote?.(uid);
      if (noteObj?.note) out.origNote = noteObj.note;

      const me = UserStore?.getCurrentUser?.();
      if (me) {
        const myProf = UserProfileStore?.getUserProfile?.(me.id);
        const myDeco = me.avatarDecorationData?.asset || me.avatarDecoration?.asset;
        const myPg = me.primaryGuild || me.clan;
        const myBan = myProf?.banner || me.banner;
        out.myProfile = {
          decoration: myDeco ? `https://cdn.discordapp.com/avatar-decoration-presets/${myDeco}.png?size=240&passthrough=true` : '',
          banner: myBan ? `https://cdn.discordapp.com/banners/${me.id}/${myBan}.${String(myBan).startsWith('a_') ? 'gif' : 'png'}?size=600` : '',
          clanTag: myPg?.tag || '',
          bio: myProf?.bio || '',
          pronouns: myProf?.pronouns || '',
          c1: Array.isArray(myProf?.themeColors) && myProf.themeColors[0] !== undefined ? '#' + Number(myProf.themeColors[0]).toString(16).padStart(6, '0') : '#141418',
          c2: Array.isArray(myProf?.themeColors) && myProf.themeColors[1] !== undefined ? '#' + Number(myProf.themeColors[1]).toString(16).padStart(6, '0') : '#09090b'
        };
      }
    } catch {}

    // Inspect live DOM & React Fiber of any visible profile panel/popout for this friend
    try {
      const domBoxes = [];
      document
        .querySelectorAll('aside, [role="dialog"]:not(#dc-cf-modal), [class*="profilePanel"], [class*="userProfileOuter"], [class*="userPopoutOuter"]')
        .forEach((pop) => {
          if (isMemberListContainer(pop)) return;
          if (extractUserInfo(pop)?.userId === uid) domBoxes.push(pop);
        });
      const fiberRoots = [info.target, ...domBoxes, ...domBoxes.map((b) => b.querySelector('[class*="header"],[class*="body"],[class*="markup"]'))].filter(Boolean);
      for (const r of fiberRoots) {
        let cur = r;
        for (let d = 0; d < 12 && cur; d++, cur = cur.parentElement) {
          const fk = Object.keys(cur).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$'));
          if (!fk) continue;
          let node = cur[fk];
          for (let i = 0; i < 40 && node; i++, node = node.return) {
            const p = node.memoizedProps || node;
            const u = p?.user || p?.message?.author || p?.author || p?.participantUser;
            if (u?.id && String(u.id) === uid) applyUserObj(u);
            if (p?.displayProfile || p?.userProfile || p?.profile) {
              applyProfObj(p.displayProfile || p.userProfile || p.profile);
            }
          }
        }
      }

      const pBox = domBoxes[0];
      if (pBox) {
        const nameNode = pBox.querySelector('[data-dc-cf-field="name"],[class*="nickname_"],[class*="globalName_"],[data-text-variant*="heading"],h1,h2');
        if (nameNode) {
          const candidates = [nameNode, ...nameNode.querySelectorAll('*')];
          for (const c of candidates) {
            const cs = getComputedStyle(c);
            if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) {
              out.origNameStyle = `background-image:${cs.backgroundImage};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-family:${cs.fontFamily}`;
              break;
            }
          }
        }
        const tagNode = pBox.querySelector('[data-dc-cf-field="username"],[class*="userTagUsername"],[class*="userTag_"] [class*="username_"]');
        if (tagNode) {
          out.origUsername ||= (tagNode.dataset.dcCfOrigName || tagNode.textContent || '').trim();
        }
        const clanImg = pBox.querySelector('img[src*="clan-badges"],img[src*="guild-tag-badges"],[class*="clan"] img,[class*="guildTag"] img');
        if (clanImg) {
          out.origClanBadge ||= clanImg.src;
          const clanParent = clanImg.parentElement;
          if (clanParent) {
            const cTxt = (clanParent.dataset.dcCfOrigName || clanParent.textContent || '').trim();
            if (cTxt) out.origClanTag ||= cTxt;
          }
        }
        if (!out.origBadges.length) {
          const bImgs = pBox.querySelectorAll('img[src*="badge-icons"],[class*="badgeList"] img,[aria-label*="Badge"] img');
          bImgs.forEach((img) => {
            if (img.src && !out.origBadges.some((b) => b.url === img.src)) {
              out.origBadges.push({ id: img.alt || 'badge', desc: img.alt || img.getAttribute('aria-label') || 'Badge', url: img.src });
            }
          });
        }
        if (!out.origBio) {
          const bioEl = Array.from(pBox.querySelectorAll('[class*="bio_"] [class*="markup_"],[class*="markup_"]')).find(
            (m) => !m.closest('[class*="status"],[class*="bubble"],.dc-cf-inj-bio')
          );
          if (bioEl) out.origBio = extractDomBioText(bioEl);
        }
        const walker = document.createTreeWalker(pBox, NodeFilter.SHOW_TEXT);
        let tn;
        const mutParts = [];
        while ((tn = walker.nextNode())) {
          const v = (tn.nodeValue || '').trim();
          if (/\b\d+\s+(amis?|serveurs?|friends?|servers?)\s+en\s+commun|\b\d+\s+Mutual\b/i.test(v)) {
            if (!mutParts.includes(v)) mutParts.push(v);
          }
        }
        if (mutParts.length) out.origMutuals = mutParts.join(' • ');
      }
    } catch {}

    if (!out.origAvatar) {
      try {
        out.origAvatar = `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(uid) >> 22n) % 6n)}.png`;
      } catch {}
    }
    return out;
  }

  function openCustomFriendModal(info) {
    setStyle('dc-p-custom-friend-modal', CF_CSS);
    document.getElementById('dc-cf-modal')?.remove();
    const users = getCfUsers();
    const cur = users[info.userId] || {};
    const data = getFriendFullData(info);
    const wrap = document.createElement('div');
    wrap.id = 'dc-cf-modal';
    const curScale = clamp(Number(cur.avatarScale) || 100, 100, 250);
    const scalePct = Math.round(((curScale - 100) / 150) * 100);
    const initC1 = cur.profileColor || data.origThemePrimary || '#111214';
    const initC2 = cur.profileColor2 || cur.profileColor || data.origThemeSecondary || '#0a0b0e';
    const initBanner = cur.banner || data.origBanner || '';
    const initDeco = cur.decoration !== undefined && cur.decoration !== '' ? cur.decoration : data.origDecoration || '';
    const initStatus = cur.status || data.origStatus || 'offline';
    const initName = cur.name || data.origName || info.userId;
    const initUser = cur.username || data.origUsername || (data.origName ? data.origName.toLowerCase().replace(/\s+/g, '_') : L('utilisateur', 'username'));
    const initPron = cur.pronouns !== undefined ? cur.pronouns : data.origPronouns || '';
    const initClan = cur.clanTag || data.origClanTag || '';
    const initCStatus = cur.customStatus !== undefined ? cur.customStatus : data.origCustomStatus || '';
    const initBio = cur.bio !== undefined && cur.bio !== '' ? cur.bio : data.origBio || '';
    const initSince = cur.memberSince || data.origMemberSince || '';
    const initConn = cur.connectionsText || '';
    const initNote = cur.note !== undefined ? cur.note : data.origNote || '';

    const badgesHtml = data.origBadges.length
      ? data.origBadges.slice(0, 6).map((b) => `<img src="${esc(b.url)}" alt="" title="${esc(b.desc)}">`).join('')
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.5"/></svg>`;
    const nameInlineStyle = cur.color ? `color:${esc(cur.color)}` : data.origNameStyle || '';

    setHTML(
      wrap,
      `<div class="dc-cf-shell">
        <div class="dc-cf-card" id="dc-cf-card" style="--cf-c1:${esc(initC1)};--cf-c2:${esc(initC2)}">
          <div class="dc-cf-banner" id="dc-cf-ban-box" style="${initBanner ? `background-image:url(&quot;${esc(initBanner)}&quot;)` : ''}">
            <div class="dc-cf-ban-hint">${esc(L('Changer la bannière', 'Change banner'))}</div>
          </div>
          <div class="dc-cf-hdr-row">
            <div class="dc-cf-av-wrap">
              <div class="dc-cf-av-ring" id="dc-cf-av-box" data-hint="${esc(L('PP', 'Avatar'))}" title="${esc(L('Cliquer pour changer la photo de profil', 'Click to change avatar'))}">
                <img id="dc-cf-prev" src="${esc(cur.avatar || data.origAvatar || '')}" alt="" style="transform:scale(${curScale / 100})">
              </div>
              <img id="dc-cf-deco" class="dc-cf-deco" src="${esc(initDeco)}" alt="" style="${initDeco ? '' : 'display:none'}">
              <div class="dc-cf-sdot" id="dc-cf-sdot" data-st="${esc(initStatus)}" title="${esc(L('Cliquer pour changer le statut (En ligne / Inactif / NPD / Hors ligne)', 'Click to cycle status'))}"></div>
            </div>
            <div class="dc-cf-bwrap">
              <div class="dc-cf-bdot1"></div>
              <div class="dc-cf-bdot2"></div>
              <div class="dc-cf-bubble">
                <span class="dc-cf-bicon" id="dc-cf-bicon" title="${esc(L('Statut personnalisé', 'Custom status'))}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v2H3v-2zm0-2L5 7l5 4 2-6 2 6 5-4 2 9H3z"/></svg>
                </span>
                <input class="dc-cf-bin" id="dc-cf-status" placeholder="${esc(L('Ajouter un statut…', 'Add a status...'))}" value="${esc(initCStatus)}">
              </div>
            </div>
          </div>
          <div class="dc-cf-body">
            <div>
              <input class="dc-cf-name-in" id="dc-cf-name" value="${esc(initName)}" placeholder="${esc(L('Pseudo de l’ami', 'Friend nickname'))}" style="${nameInlineStyle}">
            </div>
            <div class="dc-cf-subrow">
              <input class="dc-cf-inline-auto" id="dc-cf-user" value="${esc(initUser)}" placeholder="username">
              <span class="dc-cf-dot">•</span>
              <input class="dc-cf-inline-auto italic" id="dc-cf-pronouns" value="${esc(initPron)}" placeholder="${esc(L('Ajouter des pronoms', 'Add pronouns'))}">
              <span class="dc-cf-clan" title="${esc(L('Tag de clan (modifiable)', 'Clan tag (editable)'))}">
                ${data.origClanBadge ? `<img src="${esc(data.origClanBadge)}" alt="" style="width:13px;height:13px;object-fit:contain">` : `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="color:#cbd5e1"><path d="M6.92 5H5l9 9 1-.94m4.96 6.06-.84.84a.996.996 0 0 1-1.41 0l-3.12-3.12-2.68 2.66-1.41-1.41 1.42-1.42L3 7.75V3h4.75l8.92 8.92 1.42-1.42 1.41 1.41-2.67 2.67 3.12 3.12c.4.4.4 1.03.01 1.42Z"/></svg>`}
                <input id="dc-cf-clan" value="${esc(initClan)}" placeholder="Clan">
              </span>
              <span class="dc-cf-badge-pill">${badgesHtml}</span>
            </div>
            ${data.origMutuals ? `<div style="font-size:12.5px;color:#b5bac1;margin-top:-6px">${esc(data.origMutuals)}</div>` : ''}
            <div class="dc-cf-btnrow">
              <button type="button" class="dc-cf-msgbtn" id="dc-cf-save">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                <span>${esc(L('Enregistrer', 'Save'))}</span>
              </button>
              <button type="button" class="dc-cf-morebtn" id="dc-cf-more" title="${esc(L('Afficher / masquer le panneau latéral', 'Toggle side panel'))}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
              </button>
            </div>
            <input type="file" id="dc-cf-file" accept="image/*" style="display:none">
            <input type="file" id="dc-cf-ban-file" accept="image/*" style="display:none">
            <div>
              <div class="dc-cf-shdr">Bio</div>
              <textarea class="dc-cf-sval" id="dc-cf-bio" rows="1" placeholder="${esc(L('Clique pour ajouter une bio', 'Click to add bio'))}">${esc(initBio)}</textarea>
            </div>
            <div>
              <div class="dc-cf-shdr">${esc(L('Membre depuis', 'Member Since'))}</div>
              <input class="dc-cf-sval" id="dc-cf-since" value="${esc(initSince)}">
            </div>
            <div>
              <div class="dc-cf-shdr">${esc(L('Connexions', 'Connections'))}</div>
              <div class="dc-cf-conn-row">
                <span style="font-size:16px;font-weight:600;line-height:1">+</span>
                <input class="dc-cf-sval" id="dc-cf-conn" placeholder="${esc(L('Ajouter une connexion', 'Add a connection'))}" value="${esc(initConn)}">
              </div>
            </div>
            <div>
              <div class="dc-cf-shdr">${esc(L('Note (seulement visible par toi)', 'Note (only visible to you)'))}</div>
              <input class="dc-cf-sval italic" id="dc-cf-note" placeholder="${esc(L('Clique pour ajouter une note', 'Click to add a note'))}" value="${esc(initNote)}">
            </div>
            <div class="dc-cf-hint">${esc(L('Ctrl + Entrée pour enregistrer · Échap pour fermer', 'Ctrl + Enter to save · Esc to close'))}</div>
          </div>
        </div>
        <div class="dc-cf-side" id="dc-cf-side">
          <div>
            <div class="dc-cf-side-ttl">${esc(L('Avatar et décoration', 'Avatar & decoration'))}</div>
            <div class="dc-cf-tile-grid">
              <button type="button" class="dc-cf-sq-tile" id="dc-cf-pick" title="${esc(L('Changer la photo de profil', 'Change avatar'))}">
                <img class="dc-cf-sq-av" id="dc-cf-side-av" src="${esc(cur.avatar || data.origAvatar || '')}" alt="" style="transform:scale(${curScale / 100})">
              </button>
              <div class="dc-cf-sq-tile" id="dc-cf-pick-deco" title="${esc(L('Changer la décoration d’avatar', 'Change avatar decoration'))}">
                <div class="dc-cf-sq-deco-wrap">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" style="color:rgba(255,255,255,.32)"><path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33-.01 0-.02.01-.03.02-2.72 4.07-3.47 8.03-3.1 11.95 0 .02.01.04.03.05 1.8 1.32 3.53 2.12 5.24 2.65.03.01.06 0 .07-.02.4-.55.76-1.13 1.07-1.74.02-.04 0-.08-.04-.09-.57-.22-1.11-.48-1.64-.78-.04-.02-.04-.08-.01-.11.11-.08.22-.17.33-.25.02-.02.05-.02.07-.01 3.44 1.57 7.15 1.57 10.55 0 .02-.01.05-.01.07.01.11.09.22.17.33.26.04.03.04.09-.01.11-.52.31-1.07.56-1.64.78-.04.01-.05.06-.04.09.32.61.68 1.19 1.07 1.74.03.01.06.02.09.01 1.72-.53 3.45-1.33 5.25-2.65.02-.01.03-.03.03-.05.44-4.53-.73-8.46-3.1-11.95-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.83 2.12-1.89 2.12z"/></svg>
                  <img class="dc-cf-sq-deco" id="dc-cf-side-deco" src="${esc(initDeco)}" alt="" style="${initDeco ? '' : 'display:none'}">
                </div>
                <button type="button" class="dc-cf-tile-x" id="dc-cf-clr-deco" title="${esc(L('Retirer la décoration', 'Remove decoration'))}" style="${initDeco ? '' : 'display:none'}">×</button>
              </div>
            </div>
            <input type="file" id="dc-cf-deco-file" accept="image/*" style="display:none">
          </div>
          <div>
            <div class="dc-cf-side-ttl">${esc(L('Style du pseudonyme', 'Name style'))}</div>
            <div class="dc-cf-name-tile" id="dc-cf-name-tile" title="${esc(L('Cliquer pour changer la couleur du pseudo', 'Click to change name color'))}">
              <span id="dc-cf-name-prev" style="${nameInlineStyle}">${esc(initName)}</span>
              <input type="color" id="dc-cf-color" value="${esc(cur.color || '#ffffff')}">
              <button type="button" class="dc-cf-tile-x" id="dc-cf-clr-col" title="${esc(L('Couleur d’origine', 'Original color'))}">×</button>
            </div>
          </div>
          <div>
            <div class="dc-cf-side-ttl">${esc(L('Thème et bannière', 'Theme & banner'))}</div>
            <div class="dc-cf-tile-grid">
              <div class="dc-cf-theme-tile" id="dc-cf-theme-tile" style="background:linear-gradient(180deg,${esc(initC1)} 0%,${esc(initC2)} 100%)">
                <label class="dc-cf-swatch" title="${esc(L('Couleur principale', 'Primary color'))}">
                  <input type="color" id="dc-cf-pcolor" value="${esc(initC1)}">
                </label>
                <label class="dc-cf-swatch" title="${esc(L('Couleur secondaire', 'Secondary color'))}">
                  <input type="color" id="dc-cf-pcolor2" value="${esc(initC2)}">
                </label>
                <button type="button" class="dc-cf-tile-x" id="dc-cf-clr-pcol" title="${esc(L('Thème d’origine', 'Original theme'))}">×</button>
              </div>
              <button type="button" class="dc-cf-ban-tile" id="dc-cf-pick-ban" title="${esc(L('Changer la bannière', 'Change banner'))}" style="${initBanner ? `background-image:url(&quot;${esc(initBanner)}&quot;)` : ''}">
                <span class="dc-cf-ban-tile-lbl">${esc(L('Bannière', 'Banner'))}</span>
              </button>
            </div>
          </div>
          <div class="dc-cf-side-sec">
            <div>
              <div class="dc-rt"><span>${esc(L('Zoom PP', 'Avatar Zoom'))}</span><b id="dc-cf-scale-val">${curScale} %</b></div>
              <input type="range" class="dc-range" id="dc-cf-scale" min="100" max="250" step="5" value="${curScale}" style="--p:${scalePct}%">
            </div>
            <input class="dc-cf-in" id="dc-cf-av-in" placeholder="${esc(L('URL Photo de profil…', 'Avatar URL...'))}" value="${esc(cur.avatar || '')}" style="height:32px;font-size:12px">
            <input class="dc-cf-in" id="dc-cf-ban-in" placeholder="${esc(L('URL Bannière…', 'Banner URL...'))}" value="${esc(cur.banner || '')}" style="height:32px;font-size:12px">
            <button type="button" class="dc-clone-btn" id="dc-cf-copy-me" style="height:32px;font-size:12px;width:100%">${esc(L('Copier le style de mon profil', 'Copy my profile style'))}</button>
          </div>
          <button type="button" class="dc-cf-reset-btn" id="dc-cf-reset">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            <span>${esc(L('Reset profil', 'Reset profile'))}</span>
          </button>
        </div>
      </div>`
    );
    document.body.appendChild(wrap);

    const card = wrap.querySelector('#dc-cf-card');
    const banBox = wrap.querySelector('#dc-cf-ban-box');
    const avBox = wrap.querySelector('#dc-cf-av-box');
    const prev = wrap.querySelector('#dc-cf-prev');
    const decoImg = wrap.querySelector('#dc-cf-deco');
    const sdot = wrap.querySelector('#dc-cf-sdot');
    const nameIn = wrap.querySelector('#dc-cf-name');
    const userIn = wrap.querySelector('#dc-cf-user');
    const pronIn = wrap.querySelector('#dc-cf-pronouns');
    const clanIn = wrap.querySelector('#dc-cf-clan');
    const statusIn = wrap.querySelector('#dc-cf-status');
    const bioIn = wrap.querySelector('#dc-cf-bio');
    const sinceIn = wrap.querySelector('#dc-cf-since');
    const connIn = wrap.querySelector('#dc-cf-conn');
    const noteIn = wrap.querySelector('#dc-cf-note');
    const avIn = wrap.querySelector('#dc-cf-av-in');
    const banIn = wrap.querySelector('#dc-cf-ban-in');
    const colIn = wrap.querySelector('#dc-cf-color');
    const pcolIn = wrap.querySelector('#dc-cf-pcolor');
    const pcol2In = wrap.querySelector('#dc-cf-pcolor2');
    const scaleIn = wrap.querySelector('#dc-cf-scale');
    const scaleVal = wrap.querySelector('#dc-cf-scale-val');
    const fileIn = wrap.querySelector('#dc-cf-file');
    const banFileIn = wrap.querySelector('#dc-cf-ban-file');
    const decoFileIn = wrap.querySelector('#dc-cf-deco-file');
    const side = wrap.querySelector('#dc-cf-side');
    const sideAv = wrap.querySelector('#dc-cf-side-av');
    const sideDeco = wrap.querySelector('#dc-cf-side-deco');
    const clrDecoBtn = wrap.querySelector('#dc-cf-clr-deco');
    const namePrev = wrap.querySelector('#dc-cf-name-prev');
    const themeTile = wrap.querySelector('#dc-cf-theme-tile');
    const banTile = wrap.querySelector('#dc-cf-pick-ban');

    let useColor = Boolean(cur.color);
    let useProfileColor = Boolean(cur.profileColor);
    let curDeco = initDeco;

    const fitInput = (inp, minCh = 4) => {
      const len = Math.max(minCh, (inp.value || inp.placeholder || '').length + 1);
      inp.style.width = `${len}ch`;
    };
    const fitBio = () => {
      bioIn.style.height = 'auto';
      bioIn.style.height = `${Math.max(22, bioIn.scrollHeight)}px`;
    };
    fitInput(userIn, 5);
    fitInput(pronIn, 14);
    fitInput(clanIn, 4);
    fitBio();

    if (!data.origBanner && !data.origBio) {
      dcDiscordApi('GET', `/users/${info.userId}/profile?with_mutual_guilds=false&with_mutual_friends_count=false`)
        .then((res) => {
          if (!res || !document.body.contains(wrap)) return;
          const up = res.user_profile || {};
          const u = res.user || {};
          if (!cur.banner && (up.banner || u.banner)) {
            const bh = up.banner || u.banner;
            const bUrl = `https://cdn.discordapp.com/banners/${info.userId}/${bh}.${String(bh).startsWith('a_') ? 'gif' : 'png'}?size=600`;
            banBox.style.backgroundImage = `url("${bUrl}")`;
            if (banTile) banTile.style.backgroundImage = `url("${bUrl}")`;
          }
          if (cur.bio === undefined && up.bio && !bioIn.value) {
            bioIn.value = up.bio;
            fitBio();
          }
          if (cur.pronouns === undefined && up.pronouns && !pronIn.value) {
            pronIn.value = up.pronouns;
            fitInput(pronIn, 14);
          }
          if (!cur.profileColor && Array.isArray(up.theme_colors) && up.theme_colors.length >= 2) {
            const c1 = '#' + Number(up.theme_colors[0]).toString(16).padStart(6, '0');
            const c2 = '#' + Number(up.theme_colors[1]).toString(16).padStart(6, '0');
            card.style.setProperty('--cf-c1', c1);
            card.style.setProperty('--cf-c2', c2);
            pcolIn.value = c1;
            pcol2In.value = c2;
            if (themeTile) themeTile.style.background = `linear-gradient(180deg,${c1} 0%,${c2} 100%)`;
          }
        })
        .catch(() => {});
    }

    let applyCfRaf = 0;
    const scheduleCfApply = () => {
      if (applyCfRaf) return;
      applyCfRaf = requestAnimationFrame(() => {
        applyCfRaf = 0;
        applyCustomFriends();
      });
    };

    const persistNow = (sync = false) => {
      const name = nameIn.value.trim();
      const avatar = avIn.value.trim();
      const banner = banIn.value.trim();
      const username = userIn.value.trim();
      const pronouns = pronIn.value.trim();
      const clanTag = clanIn.value.trim();
      const customStatus = statusIn.value.trim();
      const bio = bioIn.value.trim();
      const memberSince = sinceIn.value.trim();
      const connectionsText = connIn.value.trim();
      const note = noteIn.value.trim();
      const status = sdot.getAttribute('data-st') || 'offline';
      const color = useColor ? colIn.value : '';
      const profileColor = useProfileColor ? pcolIn.value : '';
      const profileColor2 = useProfileColor ? pcol2In.value : '';
      const avatarScale = clamp(Number(scaleIn.value) || 100, 100, 250);
      users[info.userId] = {
        name: name !== data.origName ? name : '',
        avatar,
        color,
        banner,
        username: username !== data.origUsername ? username : '',
        pronouns: pronouns !== data.origPronouns ? pronouns : '',
        clanTag: clanTag !== data.origClanTag ? clanTag : '',
        customStatus: customStatus !== data.origCustomStatus ? customStatus : '',
        bio: bio !== data.origBio ? bio : '',
        memberSince: memberSince !== data.origMemberSince ? memberSince : '',
        connectionsText,
        note,
        status,
        decoration: curDeco !== data.origDecoration ? curDeco : '',
        profileColor,
        profileColor2,
        avatarScale,
        disabled: false,
        origName: data.origName || cur.origName || '',
        origUsername: data.origUsername || cur.origUsername || '',
        origClanTag: data.origClanTag || cur.origClanTag || '',
        origBio: data.origBio || cur.origBio || ''
      };
      cfRestored.delete(info.userId);
      if (sync) {
        if (applyCfRaf) {
          cancelAnimationFrame(applyCfRaf);
          applyCfRaf = 0;
        }
        applyCustomFriends();
      } else {
        scheduleCfApply();
      }
      saveSoon();
    };

    [nameIn, userIn, pronIn, clanIn, statusIn, bioIn, sinceIn, connIn, noteIn].forEach((inp) => {
      inp.addEventListener('input', () => {
        if (inp === nameIn && namePrev) namePrev.textContent = nameIn.value || data.origName || info.userId;
        if (inp === userIn) fitInput(userIn, 5);
        if (inp === pronIn) fitInput(pronIn, 14);
        if (inp === clanIn) fitInput(clanIn, 4);
        if (inp === bioIn) fitBio();
        persistNow();
      });
    });

    wrap.querySelector('#dc-cf-more').onclick = () => side.classList.toggle('collapsed');

    const statuses = ['online', 'idle', 'dnd', 'offline'];
    sdot.onclick = (e) => {
      e.stopPropagation();
      const curSt = sdot.getAttribute('data-st') || 'offline';
      const next = statuses[(statuses.indexOf(curSt) + 1) % statuses.length];
      sdot.setAttribute('data-st', next);
      persistNow();
    };

    scaleIn.oninput = () => {
      const sv = Number(scaleIn.value);
      scaleVal.textContent = `${sv} %`;
      scaleIn.style.setProperty('--p', `${Math.round(((sv - 100) / 150) * 100)}%`);
      const tf = `scale(${sv / 100})`;
      prev.style.transform = tf;
      if (sideAv) sideAv.style.transform = tf;
      persistNow();
    };

    colIn.oninput = () => {
      useColor = true;
      nameIn.style.cssText = `color:${colIn.value}`;
      if (namePrev) namePrev.style.cssText = `color:${colIn.value}`;
      persistNow();
    };
    wrap.querySelector('#dc-cf-clr-col').onclick = (e) => {
      e.stopPropagation();
      useColor = false;
      nameIn.style.cssText = data.origNameStyle || '';
      if (namePrev) namePrev.style.cssText = data.origNameStyle || '';
      persistNow();
    };

    const updateCardTheme = () => {
      useProfileColor = true;
      card.style.setProperty('--cf-c1', pcolIn.value);
      card.style.setProperty('--cf-c2', pcol2In.value);
      if (themeTile) themeTile.style.background = `linear-gradient(180deg,${pcolIn.value} 0%,${pcol2In.value} 100%)`;
      persistNow();
    };
    pcolIn.oninput = updateCardTheme;
    pcol2In.oninput = updateCardTheme;
    wrap.querySelector('#dc-cf-clr-pcol').onclick = (e) => {
      e.stopPropagation();
      useProfileColor = false;
      const d1 = data.origThemePrimary || '#111214';
      const d2 = data.origThemeSecondary || '#0a0b0e';
      pcolIn.value = d1;
      pcol2In.value = d2;
      card.style.setProperty('--cf-c1', d1);
      card.style.setProperty('--cf-c2', d2);
      if (themeTile) themeTile.style.background = `linear-gradient(180deg,${d1} 0%,${d2} 100%)`;
      persistNow();
    };

    const syncDecoPreview = (url) => {
      curDeco = url || '';
      decoImg.src = curDeco;
      decoImg.style.display = curDeco ? '' : 'none';
      if (sideDeco) {
        sideDeco.src = curDeco;
        sideDeco.style.display = curDeco ? '' : 'none';
      }
      if (clrDecoBtn) clrDecoBtn.style.display = curDeco ? '' : 'none';
    };

    avIn.oninput = () => {
      const src = avIn.value.trim() || data.origAvatar || '';
      prev.src = src;
      if (sideAv) sideAv.src = src;
      persistNow();
    };
    banIn.oninput = () => {
      const v = banIn.value.trim() || data.origBanner || '';
      const bg = v ? `url("${v.replace(/"/g, '\\"')}")` : '';
      banBox.style.backgroundImage = bg;
      if (banTile) banTile.style.backgroundImage = bg;
      persistNow();
    };

    avBox.onclick = () => fileIn.click();
    banBox.onclick = () => banFileIn.click();
    wrap.querySelector('#dc-cf-pick').onclick = () => fileIn.click();
    wrap.querySelector('#dc-cf-pick-ban').onclick = () => banFileIn.click();
    wrap.querySelector('#dc-cf-pick-deco').onclick = () => decoFileIn.click();
    clrDecoBtn.onclick = (e) => {
      e.stopPropagation();
      syncDecoPreview('');
      persistNow();
    };

    fileIn.onchange = async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      try {
        const dataUrl = await imageFileToDataUrl(f, 256, 350000);
        avIn.value = dataUrl;
        prev.src = dataUrl;
        if (sideAv) sideAv.src = dataUrl;
        persistNow();
      } catch {
        showToast(L('Image invalide', 'Invalid image'), 'error');
      }
    };
    banFileIn.onchange = async () => {
      const f = banFileIn.files?.[0];
      if (!f) return;
      try {
        const dataUrl = await imageFileToDataUrl(f, 720, 500000);
        banIn.value = dataUrl;
        banBox.style.backgroundImage = `url("${dataUrl}")`;
        if (banTile) banTile.style.backgroundImage = `url("${dataUrl}")`;
        persistNow();
      } catch {
        showToast(L('Image invalide', 'Invalid image'), 'error');
      }
    };
    decoFileIn.onchange = async () => {
      const f = decoFileIn.files?.[0];
      if (!f) return;
      try {
        const dataUrl = await imageFileToDataUrl(f, 256, 350000);
        syncDecoPreview(dataUrl);
        persistNow();
      } catch {
        showToast(L('Image invalide', 'Invalid image'), 'error');
      }
    };

    wrap.querySelector('#dc-cf-copy-me').onclick = () => {
      const mp = data.myProfile;
      if (!mp) return;
      if (mp.banner) {
        banIn.value = mp.banner;
        banBox.style.backgroundImage = `url("${mp.banner}")`;
        if (banTile) banTile.style.backgroundImage = `url("${mp.banner}")`;
      }
      if (mp.decoration) {
        syncDecoPreview(mp.decoration);
      }
      if (mp.clanTag) {
        clanIn.value = mp.clanTag;
        fitInput(clanIn, 4);
      }
      if (mp.c1) {
        useProfileColor = true;
        pcolIn.value = mp.c1;
        pcol2In.value = mp.c2 || mp.c1;
        card.style.setProperty('--cf-c1', pcolIn.value);
        card.style.setProperty('--cf-c2', pcol2In.value);
        if (themeTile) themeTile.style.background = `linear-gradient(180deg,${pcolIn.value} 0%,${pcol2In.value} 100%)`;
      }
      persistNow();
      showToast(L('Style de ton profil copié sur cet ami', 'Your profile style was copied to this friend'), 'ok');
    };

    const close = () => {
      if (applyCfRaf) {
        cancelAnimationFrame(applyCfRaf);
        applyCfRaf = 0;
      }
      offEsc();
      wrap.remove();
      if (subPage === 'custom-friend') rerender();
    };
    const offEsc = listen(
      document,
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          save();
        }
      },
      true
    );
    wrap.onclick = (e) => {
      if (e.target === wrap) close();
    };

    wrap.querySelector('#dc-cf-reset').onclick = () => {
      delete users[info.userId];
      restoreCustomFriend(info.userId);
      saveSoon();
      close();
      showToast(L('Ami réinitialisé', 'Friend reset'), 'ok');
    };

    const save = () => {
      persistNow(true);
      close();
      showToast(L('Profil de l’ami enregistré', 'Friend profile saved'), 'ok');
    };
    wrap.querySelector('#dc-cf-save').onclick = save;
  }

  function startCustomFriend() {
    setStyle('dc-p-custom-friend-modal', CF_CSS);
    applyCustomFriends();
    const offTask = addTask('custom-friend', applyCustomFriends);
    let ctxTimers = [];
    const clearCtx = () => {
      ctxTimers.forEach(clearTimeout);
      ctxTimers = [];
    };
    const onCtx = (e) => {
      if (e.target.closest?.('[data-list-item-id^="guildsnav___"]')) return;
      const info = extractUserInfo(e.target);
      if (!info) return;
      clearCtx();
      const inject = () => {
        const menu = document.querySelector('#user-context, [role="menu"][id*="user"], [role="menu"]:not(#guild-context)');
        if (!menu || menu.id === 'guild-context' || menu.querySelector('#dc-ctx-custom-friend')) return;
        if (!menu.querySelector('[role="menuitem"]')) return;
        const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
        if (!target.querySelector('.dc-ctx-hdr')) {
          const hdr = document.createElement('div');
          hdr.className = 'dc-ctx-hdr';
          hdr.textContent = L('Option DreamCord', 'DreamCord Options');
          target.appendChild(hdr);
        }
        const btn = document.createElement('div');
        btn.id = 'dc-ctx-custom-friend';
        btn.className = 'dc-ctx-clone';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = 'Custom Friend';
        btn.onclick = (ev) => {
          ev.stopPropagation();
          dismissDiscordMenu(menu);
          openCustomFriendModal(info);
        };
        target.appendChild(btn);
        clearCtx();
      };
      ctxTimers = [50, 120, 250, 450, 700].map((ms) => setTimeout(inject, ms));
    };
    return chain(listen(document, 'contextmenu', onCtx, true), clearCtx, offTask, () => {
      document.getElementById('dc-ctx-custom-friend')?.remove();
      document.getElementById('dc-cf-modal')?.remove();
      restoreCustomFriend('');
    });
  }

  // ============================================================
  //  Custom Profile (NightCord Custom Profile — Badges, Ancien Pseudo #,
  //  Clan Tag, Nitro Évolutif, Boost, Décorations d'Avatar, Effets & Connexions)
  // ============================================================
  const CP_FLAG = {
    STAFF: 1,
    PARTNER: 2,
    HYPESQUAD: 4,
    BUG_HUNTER_1: 8,
    BRAVERY: 64,
    BRILLIANCE: 128,
    BALANCE: 256,
    EARLY_SUPPORTER: 512,
    BUG_HUNTER_2: 16384,
    DEV_VERIFIED: 131072,
    MOD_ALUMNI: 262144,
    ACTIVE_DEVELOPER: 4194304
  };

  const CP_BADGES = [
    { key: 'Staff Discord', fr: 'Personnel Discord', en: 'Discord Staff', id: 'staff', flag: CP_FLAG.STAFF, icon: 'https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png' },
    { key: 'Partnered Server Owner', fr: "Propriétaire d'un serveur partenaire", en: 'Partnered Server Owner', id: 'partner', flag: CP_FLAG.PARTNER, icon: 'https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png' },
    { key: 'HypeSquad Events', fr: 'Événements HypeSquad', en: 'HypeSquad Events', id: 'hypesquad', flag: CP_FLAG.HYPESQUAD, icon: 'https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png' },
    { key: 'Bug Hunter Lvl 1', fr: 'Chasseur de bugs Nv. 1', en: 'Bug Hunter Lvl 1', id: 'bug_hunter_level_1', flag: CP_FLAG.BUG_HUNTER_1, icon: 'https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png' },
    { key: 'HypeSquad Bravery', fr: 'HypeSquad Bravery', en: 'HypeSquad Bravery', id: 'hypesquad_house_1', flag: CP_FLAG.BRAVERY, icon: 'https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png' },
    { key: 'HypeSquad Brilliance', fr: 'HypeSquad Brilliance', en: 'HypeSquad Brilliance', id: 'hypesquad_house_2', flag: CP_FLAG.BRILLIANCE, icon: 'https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png' },
    { key: 'HypeSquad Balance', fr: 'HypeSquad Balance', en: 'HypeSquad Balance', id: 'hypesquad_house_3', flag: CP_FLAG.BALANCE, icon: 'https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png' },
    { key: 'Early Supporter', fr: 'Soutien de la première heure', en: 'Early Supporter', id: 'early_supporter', flag: CP_FLAG.EARLY_SUPPORTER, icon: 'https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png' },
    { key: 'Former Moderator', fr: 'Ancien modérateur', en: 'Discord Moderator Programs Alumni', id: 'certified_moderator', flag: CP_FLAG.MOD_ALUMNI, icon: 'https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png' },
    { key: 'Bug Hunter Lvl 2', fr: 'Chasseur de bugs Nv. 2', en: 'Bug Hunter Lvl 2', id: 'bug_hunter_level_2', flag: CP_FLAG.BUG_HUNTER_2, icon: 'https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png' },
    { key: 'Early Verified Bot Developer', fr: 'Développeur de bot vérifié de la première heure', en: 'Early Verified Bot Developer', id: 'verified_developer', flag: CP_FLAG.DEV_VERIFIED, icon: 'https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png' },
    { key: 'Active Developer', fr: 'Développeur actif', en: 'Active Developer', id: 'active_developer', flag: CP_FLAG.ACTIVE_DEVELOPER, icon: 'https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png' }
  ];

  const CP_OLD_NAME_ICON = 'https://cdn.discordapp.com/badge-icons/6de6d34650760ba5551a79732e98ed60.png';

  const CP_NITRO_LEVELS = [
    { fr: 'Nitro (0 mois)', en: 'Nitro (0 months)', months: 0, icon: 'https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png' },
    { fr: 'Bronze (1 mois)', en: 'Bronze (1 month)', months: 1, icon: 'https://cdn.discordapp.com/badge-icons/4f33c4a9c64ce221936bd256c356f91f.png' },
    { fr: 'Argent (3 mois)', en: 'Silver (3 months)', months: 3, icon: 'https://cdn.discordapp.com/badge-icons/4514fab914bdbfb4ad2fa23df76121a6.png' },
    { fr: 'Or (6 mois)', en: 'Gold (6 months)', months: 6, icon: 'https://cdn.discordapp.com/badge-icons/2895086c18d5531d499862e41d1155a6.png' },
    { fr: 'Platine (12 mois)', en: 'Platinum (12 months)', months: 12, icon: 'https://cdn.discordapp.com/badge-icons/0334688279c8359120922938dcb1d6f8.png' },
    { fr: 'Diamant (24 mois)', en: 'Diamond (24 months)', months: 24, icon: 'https://cdn.discordapp.com/badge-icons/0d61871f72bb9a33a7ae568c1fb4f20a.png' },
    { fr: 'Émeraude (36 mois)', en: 'Emerald (36 months)', months: 36, icon: 'https://cdn.discordapp.com/badge-icons/11e2d339068b55d3a506cff34d3780f3.png' },
    { fr: 'Rubis (60 mois)', en: 'Ruby (60 months)', months: 60, icon: 'https://cdn.discordapp.com/badge-icons/cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4.png' },
    { fr: 'Opale (72 mois)', en: 'Opal (72 months)', months: 72, icon: 'https://cdn.discordapp.com/badge-icons/5b154df19c53dce2af92c9b61e6be5e2.png' }
  ];

  const CP_BOOST_LEVELS = [
    { fr: '1 Mois', en: '1 Month', min: 1, max: 2, lvl: 'lvl1', icon: 'https://cdn.discordapp.com/badge-icons/51040c70d4f20a921ad6674ff86fc95c.png' },
    { fr: '2 Mois', en: '2 Months', min: 2, max: 3, lvl: 'lvl2', icon: 'https://cdn.discordapp.com/badge-icons/0e4080d1d333bc7ad29ef6528b6f2fb7.png' },
    { fr: '3 Mois', en: '3 Months', min: 3, max: 6, lvl: 'lvl3', icon: 'https://cdn.discordapp.com/badge-icons/72bed924410c304dbe3d00a6e593ff59.png' },
    { fr: '6 Mois', en: '6 Months', min: 6, max: 9, lvl: 'lvl4', icon: 'https://cdn.discordapp.com/badge-icons/df199d2050d3ed4ebf84d64ae83989f8.png' },
    { fr: '9 Mois', en: '9 Months', min: 9, max: 12, lvl: 'lvl5', icon: 'https://cdn.discordapp.com/badge-icons/996b3e870e8a22ce519b3a50e6bdd52f.png' },
    { fr: '12 Mois', en: '12 Months', min: 12, max: 15, lvl: 'lvl6', icon: 'https://cdn.discordapp.com/badge-icons/991c9f39ee33d7537d9f408c3e53141e.png' },
    { fr: '15 Mois', en: '15 Months', min: 15, max: 18, lvl: 'lvl7', icon: 'https://cdn.discordapp.com/badge-icons/cb3ae83c15e970e8f3d410bc62cb8b99.png' },
    { fr: '18 Mois', en: '18 Months', min: 18, max: 24, lvl: 'lvl8', icon: 'https://cdn.discordapp.com/badge-icons/7142225d31238f6387d9f09efaa02759.png' },
    { fr: '24 Mois', en: '24 Months', min: 24, max: 48, lvl: 'lvl9', icon: 'https://cdn.discordapp.com/badge-icons/ec92202290b48d0879b7413d2dde3bab.png' }
  ];

  const CP_SPECIAL_BADGES = [
    { id: 'quest', badgeId: 'quest_completed', fr: 'A accompli une quête', en: 'Completed a quest', icon: 'https://cdn.discordapp.com/badge-icons/7d9ae358c8c5e118768335dbe68b4fb8.png' },
    { id: 'orbs', badgeId: 'orb_profile_badge', fr: 'Orbes — Apprenti', en: 'Orbs — Apprentice', icon: 'https://cdn.discordapp.com/badge-icons/83d8a1eb09a8d64e59233eec5d4d5c2d.png' },
    { id: 'oldname', badgeId: 'legacy_username', fr: "Ancien nom d'utilisateur", en: 'Old username', icon: CP_OLD_NAME_ICON },
    { id: 'gifting_level', badgeId: 'gifting_level', fr: 'Niveau atteint', en: 'Level Reached', icon: 'https://cdn.discordapp.com/badge-icons/ca105ad9cfc8580c765101d17bbb2323.png' }
  ];

  const CP_GIFTING_BADGES = [
    { id: 'gifting_icon', fr: "Plaisir d'offrir Icône", en: 'Gifting Icon', icon: 'https://cdn.discordapp.com/badge-icons/64f2413c9b9803661322aaad25826b62.png' },
    { id: 'gifting_patron', fr: "Plaisir d'offrir Mécène", en: 'Gifting Patron', icon: 'https://cdn.discordapp.com/badge-icons/ac305d1b9481f312ce4419e7f8296558.png' },
    { id: 'gifting_champion', fr: "Plaisir d'offrir Champion", en: 'Gifting Champion', icon: 'https://cdn.discordapp.com/badge-icons/8b7792c4f65953d3ff564f23429cb79e.png' },
    { id: 'gifting_luminary', fr: "Plaisir d'offrir Luminaire", en: 'Gifting Luminary', icon: 'https://cdn.discordapp.com/badge-icons/3119f5504b2cd09576a323908c7c3517.png' },
    { id: 'gifting_hero', fr: "Plaisir d'offrir Héros", en: 'Gifting Hero', icon: 'https://cdn.discordapp.com/badge-icons/77d65b1f210014a11eb1582ee06ab684.png' },
    { id: 'gifting_legend', fr: "Plaisir d'offrir Légende", en: 'Gifting Legend', icon: 'https://cdn.discordapp.com/badge-icons/7fe346cfc5da1340087d8759a9e7a395.png' }
  ];

  const CP_AVATAR_DECORATIONS = [
    { id: '1144307957425778779', label: 'Hearts' },
    { id: '1144308196723408958', label: 'Hearts Animated' },
    { id: '1212569433839636530', label: 'Lofi Cafe' },
    { id: '1481387347642810480', label: 'Winter' },
    { id: '1343751617362661526', label: 'Magic Orb' },
    { id: '1373015260465987705', label: 'Dragon' },
    { id: '1333866045303423026', label: 'Ghost' },
    { id: '1144308439720394944', label: 'Sakura Drift' },
    { id: '1432550258126229565', label: 'Neon' },
    { id: '1462116613632426014', label: 'Cyber City' },
    { id: '1462116613682757888', label: 'Retro' },
    { id: '1144307629225672846', label: 'Fire' },
    { id: '1341506443718688768', label: 'Void' },
    { id: '1447654090640330763', label: 'Celestial' },
    { id: '1483857762890022923', label: 'Snowy' },
    { id: '1479561706672885811', label: 'Ice' },
    { id: '1212569856189407352', label: 'Cozy' },
    { id: '1485784028710830242', label: 'New Year' },
    { id: '1341506444150702080', label: 'Abyss' },
    { id: '1232071712695386162', label: 'Spring' },
    { id: '1220514048068812901', label: 'Summer' },
    { id: '1427463138634109026', label: 'Autumn' },
    { id: '1341506443865489408', label: 'Darkness' },
    { id: '1144003752978829455', label: 'Flaming Sword' },
    { id: '1144006094134456352', label: 'Magical Potion' },
    { id: '1144046002110738634', label: 'Fairy Sprites' },
    { id: '1144048390594908212', label: "Wizard's Staff" },
    { id: '1144048977138946230', label: 'Glowing Runes' },
    { id: '1144049316009353338', label: 'Defensive Shield' },
    { id: '1144049603109470370', label: 'Skull Medallion' },
    { id: '1144049924397334651', label: 'Treasure and Key' },
    { id: '1207047014769234001', label: 'Fire Element' },
    { id: '1207047597294886923', label: 'Water' },
    { id: '1207047808838799410', label: 'Air' },
    { id: '1207048049571139584', label: 'Earth' },
    { id: '1207048289610899526', label: 'Lightning' },
    { id: '1207048656289534022', label: 'Balance' },
    { id: '1232070870093008937', label: 'Stardust' },
    { id: '1232071157746765906', label: 'Black Hole' },
    { id: '1232072121950146560', label: 'Solar Orbit' },
    { id: '1232072520249643028', label: 'UFO' },
    { id: '1232072859485208687', label: 'Astronaut Helmet' },
    { id: '1197344326133502032', label: 'Glitch' },
    { id: '1197344396983664670', label: 'Cybernetic' },
    { id: '1197344575832981605', label: 'Digital Sunrise' },
    { id: '1197344636558114986', label: 'Implant' }
  ];

  const CP_PROFILE_EFFECTS = [
    { id: '1139323092645183591', label: 'Hydro Blast' },
    { id: '1139323093991575696', label: 'Sakura Dreams' },
    { id: '1139323099251232828', label: 'Mystic Vines' },
    { id: '1139323099687436419', label: 'Pixie Dust' },
    { id: '1212582298893946880', label: 'Dreamy' },
    { id: '1212582372877541427', label: 'Ki Detonate' },
    { id: '1212582452640350238', label: 'Sushi Mania' },
    { id: '1139323100568244355', label: 'Magic Hearts' },
    { id: '1139323093551165533', label: 'Shatter' },
    { id: '1139323101008642101', label: 'Shuriken Strike' },
    { id: '1139323101881061466', label: 'Power Surge' },
    { id: '1158572178179108968', label: 'Ghoulish Graffiti' },
    { id: '1158572275507937342', label: 'Dark Omens' },
    { id: '1197344693630009424', label: 'Nightrunner' },
    { id: '1197344764174008452', label: 'Uplink Error' },
    { id: '1217626509737459852', label: 'Petal Serenade' },
    { id: '1217627051217911848', label: 'Fellowship of the Spring' },
    { id: '1217627230818009171', label: 'Spring Bloom' },
    { id: '1228233390260486164', label: 'Study Spot' },
    { id: '1228234634379132958', label: 'All Nighter' },
    { id: '1237654783209508904', label: 'Jolly Roger' },
    { id: '1237654867330469949', label: 'Forgotten Treasure' },
    { id: '1237654942202990602', label: "Haunted Man O' War" },
    { id: '1232073286582538261', label: 'Shooting Stars' },
    { id: '1232073608168472638', label: 'Twilight' },
    { id: '1207049115339591681', label: 'Rock Slide' },
    { id: '1207049364464345158', label: 'Vortex' },
    { id: '1207049498065375343', label: 'Mastery' },
    { id: '1245088205330710539', label: 'Turbo Drive' },
    { id: '1245088254647205991', label: 'Twinkle Trails' }
  ];

  const CP_PROFILE_FRAMES = [
    {"id":"1564421748202410054","label":"Deadpool","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1564421748202410054/1567643983323340861/static"},
    {"id":"1564422284972654632","label":"Wolverine","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1564422284972654632/1564422391415836784/static"},
    {"id":"1564422684522188830","label":"Deadpool Mask","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1564422684522188830/1564422782006337607/static"},
    {"id":"1564422476820258846","label":"Wolverine Mask","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1564422476820258846/1564422584391565332/static"},
    {"id":"1556803891289526392","label":"The Entity","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1556803891289526392/1556804055202795591/static"},
    {"id":"1556809649808736266","label":"Dark Moon","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1556809649808736266/1556809808865136710/static"},
    {"id":"1561806070656270466","label":"Alebrije","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1561806070656270466/1561806203603132476/static"},
    {"id":"1545193750261923880","label":"Leopard Print","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1545193750261923880/1545193824370954351/static"},
    {"id":"1545193867710562406","label":"Alt Raccoon","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1545193867710562406/1545565659092623491/static"},
    {"id":"1551647831360671905","label":"Tilcayo","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1551647831360671905/1551648251701100665/static"},
    {"id":"1545538607811534988","label":"Leafy Loaf","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1545538607811534988/1549900374805184522/static"},
    {"id":"1545538988813844600","label":"Autumn Garden","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1545538988813844600/1549900243699503185/static"},
    {"id":"1544103549892300830","label":"Pearly Pop","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1544103549892300830/1547368615408566302/static"},
    {"id":"1541464541966114826","label":"Bare Branches","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1541464541966114826/1541464621884510258/static"},
    {"id":"1541464049919983667","label":"Moonflowers","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1541464049919983667/1541464161576423504/static"},
    {"id":"1541462746032381982","label":"Devil's Thorns","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1541462746032381982/1541463498339516477/static"},
    {"id":"1538992680552636548","label":"Rose Filigree","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1538992680552636548/1538992839197720769/static"},
    {"id":"1533925498961264871","label":"Lord of the Dead (Blue)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1533925498961264871/1533925847021518939/static"},
    {"id":"1533925887098224730","label":"Lord of the Dead (Red)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1533925887098224730/1534992785206411324/static"},
    {"id":"1531413285243719880","label":"Totality","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1531413285243719880/1533986938368036915/static"},
    {"id":"1531413463623139328","label":"Solar Crown","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1531413463623139328/1532536721248616610/static"},
    {"id":"1526697977513509007","label":"Berry Bunny","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1526697977513509007/1526698280728133723/static"},
    {"id":"1524190883036266636","label":"Star Chart","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524190883036266636/1524191337790836907/static"},
    {"id":"1526698360080306276","label":"Ocean","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1526698360080306276/1526698477919146044/static"},
    {"id":"1524191647854891039","label":"Bunny Bliss","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524191647854891039/1524192390502551724/static"},
    {"id":"1524191448898080929","label":"Precious Metal","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524191448898080929/1526660580260188300/static"},
    {"id":"1524192423260061706","label":"Fantasy Galaxy (Pink)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524192423260061706/1526660205738328175/static"},
    {"id":"1524193178586972441","label":"Fantasy Galaxy (Blue)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524193178586972441/1526660272021045418/static"},
    {"id":"1524193380492509345","label":"Fantasy Galaxy (White)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524193380492509345/1526660354694844456/static"},
    {"id":"1527085511544410274","label":"Encore","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1527085511544410274/1527085678985220128/static"},
    {"id":"1524512219298267187","label":"Prism Edge (Blue)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524512219298267187/1524512580935352410/static"},
    {"id":"1524512601827180624","label":"Prism Edge (Pink)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524512601827180624/1524557380090593321/static"},
    {"id":"1524193825130811604","label":"Lofi Skyline","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1524193825130811604/1524193966818459790/static"},
    {"id":"1526704581168468161","label":"Ribbit","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1526704581168468161/1526704820344455319/static"},
    {"id":"1491907428344795276","label":"Meow Meow Cat (White)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1491907428344795276/1522378688971411657/static"},
    {"id":"1522378878083924051","label":"Meow Meow Cat (Black)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1522378878083924051/1524824357199675523/static"},
    {"id":"1522381656684761098","label":"Meow Meow Cat (Gray)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1522381656684761098/1522381902995132536/static"},
    {"id":"1522380815538065549","label":"Meow Meow Cat (Orange)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1522380815538065549/1522381608047345756/static"},
    {"id":"1511908350324113478","label":"Mariposa (Pink)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1511908350324113478/1524824070691229817/static"},
    {"id":"1517301132211388507","label":"Mariposa (Blue)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1517301132211388507/1524824143315599390/static"},
    {"id":"1517303399799062668","label":"Mariposa (White)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1517303399799062668/1524824219844739122/static"},
    {"id":"1491910305603911881","label":"Dark Roses (Nightshade)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1491910305603911881/1515086535480049714/static"},
    {"id":"1511834130294247555","label":"Dark Roses (Black)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1511834130294247555/1515086606665646213/static"},
    {"id":"1511834131242287195","label":"Dark Roses (White)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1511834131242287195/1515086653209841684/static"},
    {"id":"1515124557290410204","label":"Dark Roses (Blue)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1515124557290410204/1515124885113012234/static"},
    {"id":"1484726324580061191","label":"Crystals (Amethyst)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1484726324580061191/1514422966870347837/static"},
    {"id":"1509183143905857589","label":"Crystals (Aquamarine)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1509183143905857589/1514423210181918872/static"},
    {"id":"1509183144786657413","label":"Crystals (Peridot)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1509183144786657413/1514423455905349705/static"},
    {"id":"1509183145751220377","label":"Crystals (Carnelian)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1509183145751220377/1514423553527779490/static"},
    {"id":"1491910929141727413","label":"Neon Chaos (Green)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1491910929141727413/1514424115258200205/static"},
    {"id":"1511869969921609874","label":"Neon Chaos (Purple)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1511869969921609874/1514424195486842940/static"},
    {"id":"1511871218633146408","label":"Neon Chaos (Blue)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1511871218633146408/1514424379709198548/static"},
    {"id":"1506402031986802930","label":"Dragon (Jade)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1506402031986802930/1519088935509295224/static"},
    {"id":"1519071720672329779","label":"Dragon (Rose)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1519071720672329779/1519071938754904185/static"},
    {"id":"1519072339185369239","label":"Dragon (Sapphire)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1519072339185369239/1519072528654401563/static"},
    {"id":"1519072056560455851","label":"Dragon (Ruby)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1519072056560455851/1519072278669692938/static"},
    {"id":"1484726324592640056","label":"Vengeance (Pink)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1484726324592640056/1514421380328722451/static"},
    {"id":"1507152062134358176","label":"Vengeance (Blue)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1507152062134358176/1514421630108041226/static"},
    {"id":"1507152063078072454","label":"Vengeance (Orange)","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1507152063078072454/1514421770197663875/static"},
    {"id":"1491911825837785238","label":"Pond Pals","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1491911825837785238/1514422210209644636/static"},
    {"id":"1493974583311859733","label":"Starlight Kingdom","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1493974583311859733/1511864765062975640/static"},
    {"id":"1491908830844424302","label":"Sakura Spring","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1491908830844424302/1511895595718148197/static"},
    {"id":"1489398661619384321","label":"Retro Futurism","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1489398661619384321/1511863804592521317/static"},
    {"id":"1489396533643448380","label":"Kawaii Cat","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1489396533643448380/1511832453369827559/static"},
    {"id":"1489399523238477855","label":"Dimensional Divide","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1489399523238477855/1517237005921157280/static"},
    {"id":"1484726324592640058","label":"Tiger Guardian","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1484726324592640058/1514422015787012136/static"},
    {"id":"1527812336750952489","label":"Tropical Symphony","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1527812336750952489/1527812764574421124/static"},
    {"id":"1551750127218073670","label":"Wraithling","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1551750127218073670/1555251344544374844/static"},
    {"id":"1551750280960286770","label":"Always Watching","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1551750280960286770/1551750347515633674/static"},
    {"id":"1536491679949922304","label":"Spider-Man","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1536491679949922304/1536492376778870896/static"},
    {"id":"1536492428268281996","label":"Spider-Man's Web","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1536492428268281996/1536492935170760895/static"},
    {"id":"1536492991093678183","label":"Venom","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1536492991093678183/1536493305460686919/static"},
    {"id":"1536493354450288680","label":"Symbiote","img":"https://cdn.discordapp.com/media/v1/collectibles-shop/1536493354450288680/1536493443591708682/static"}
  ].map((f) => ({ ...f, staticImg: f.img, layers: [f.img] }));

  const CP_FAKE_PLATFORMS = [
    { id: 'domain', short: 'Domain', label: 'Domain / Site Web', icon: '/assets/b4376756bcbbf1ef.svg', color: '#ffffff', placeholder: 'nightcord.st', defaultUrl: (n) => (n.startsWith('http') ? n : `https://${n}`) },
    { id: 'twitter', short: 'X', label: 'X (Twitter)', icon: '/assets/a61999ae9bfb9658.svg', color: '#ffffff', placeholder: 'nightcord', defaultUrl: (n) => `https://x.com/${n.replace(/^@/, '')}` },
    { id: 'github', short: 'GitHub', label: 'GitHub', icon: '/assets/a35ff3e86ffa1eb2.svg', color: '#ffffff', placeholder: 'nightcord', defaultUrl: (n) => `https://github.com/${n}` },
    { id: 'youtube', short: 'YouTube', label: 'YouTube', icon: '/assets/0fa530ba9c04ac32.svg', color: '#ff0033', placeholder: 'nightcord', defaultUrl: (n) => `https://youtube.com/@${n.replace(/^@/, '')}` },
    { id: 'twitch', short: 'Twitch', label: 'Twitch', icon: '/assets/4fda00c96319c8ae.svg', color: '#9146ff', placeholder: 'nightcord', defaultUrl: (n) => `https://twitch.tv/${n}` },
    { id: 'spotify', short: 'Spotify', label: 'Spotify', icon: '/assets/d5719388ffc613da.svg', color: '#1ed760', placeholder: 'nightcord', defaultUrl: (n) => `https://open.spotify.com/user/${n}` },
    { id: 'tiktok', short: 'TikTok', label: 'TikTok', icon: '/assets/b4376756bcbbf1ef.svg', color: '#ffffff', placeholder: 'nightcord', defaultUrl: (n) => `https://tiktok.com/@${n.replace(/^@/, '')}` },
    { id: 'reddit', short: 'Reddit', label: 'Reddit', icon: '/assets/adfd927dcc2049a5.svg', color: '#ff4500', placeholder: 'nightcord', defaultUrl: (n) => `https://reddit.com/user/${n}` },
    { id: 'steam', short: 'Steam', label: 'Steam', icon: '/assets/1f7ec18f3695d4cf.svg', color: '#ffffff', placeholder: 'nightcord', defaultUrl: (n) => `https://steamcommunity.com/id/${n}` },
    { id: 'leagueoflegends', short: 'Riot', label: 'Riot Games', icon: 'https://cdn.discordapp.com/app-icons/1443033465766281327/b69039088ad141a9c036f7f4f247f6ba.png?size=128', color: '#eb0029', placeholder: 'Nightcord#EUW' },
    { id: 'bluesky', short: 'Bluesky', label: 'Bluesky', icon: '/assets/2709f058378a099d.svg', color: '#0285ff', placeholder: 'nightcord.bsky.social', defaultUrl: (n) => `https://bsky.app/profile/${n}` },
    { id: 'paypal', short: 'PayPal', label: 'PayPal', icon: '/assets/dcb64a4ff8f61b2c.svg', color: '#0079c1', placeholder: 'nightcord', defaultUrl: (n) => `https://paypal.me/${n}` },
    { id: 'ebay', short: 'eBay', label: 'eBay', icon: '/assets/b28a7a265581b6e3.svg', color: '#e53238', placeholder: 'nightcord' },
    { id: 'crunchyroll', short: 'Crunchyroll', label: 'Crunchyroll', icon: '/assets/94ef3e8b7fa85a2e.svg', color: '#f47521', placeholder: 'nightcord' },
    { id: 'playstation', short: 'PlayStation', label: 'PlayStation Network', icon: '/assets/eed203a7ec517e23.svg', color: '#ffffff', placeholder: 'Nightcord_ID' },
    { id: 'xbox', short: 'Xbox', label: 'Xbox', icon: '/assets/c4f09fda61827e19.svg', color: '#107c10', placeholder: 'Nightcord' },
    { id: 'amazon-music', short: 'Amazon', label: 'Amazon Music', icon: '/assets/e3c4aacc1a54395d.svg', color: '#25d1da', placeholder: 'nightcord' },
    { id: 'battlenet', short: 'Battle.net', label: 'Battle.net', icon: '/assets/163c8cb9220efc74.svg', color: '#009ae4', placeholder: 'Nightcord#1234' },
    { id: 'bungie', short: 'Bungie.net', label: 'Bungie.net', icon: '/assets/099cd81cf3b4cc98.svg', color: '#ffffff', placeholder: 'Nightcord#1234' },
    { id: 'epicgames', short: 'Epic', label: 'Epic Games', icon: '/assets/199eceff4fca1a0c.svg', color: '#ffffff', placeholder: 'Nightcord' },
    { id: 'facebook', short: 'Facebook', label: 'Facebook', icon: '/assets/17be29f77bee4405.svg', color: '#1877f2', placeholder: 'nightcord', defaultUrl: (n) => `https://facebook.com/${n}` },
    { id: 'roblox', short: 'Roblox', label: 'Roblox', icon: '/assets/a4d8e9b0404a2d00.svg', color: '#ffffff', placeholder: 'Nightcord' }
  ];

  const CP_CSS = `
    #dc-cp-modal{position:fixed;inset:0;z-index:100028;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.78);backdrop-filter:blur(12px);padding:16px}
    .dc-cp-root{width:690px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column;border-radius:18px;background:linear-gradient(180deg,#101014 0%,#09090b 100%);border:1px solid rgba(255,255,255,.11);box-shadow:0 30px 80px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.06);color:#e4e4e7;font:13.5px/1.45 "gg sans","Noto Sans",Segoe UI,sans-serif;overflow:hidden;animation:dc-pop .16s cubic-bezier(.16,1,.3,1)}
    .dc-cp-header{display:flex;align-items:center;gap:12px;padding:18px 24px 12px}
    .dc-cp-title{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-.02em}
    .dc-cp-title svg{opacity:.9}
    .dc-cp-acc-pill{margin-left:auto;display:inline-flex;align-items:center;gap:9px;height:34px;padding:0 12px;border-radius:10px;background:#141418;border:1px solid rgba(255,255,255,.1);color:#f4f4f5;font:600 13px/1 "gg sans",Segoe UI,sans-serif;min-width:155px}
    .dc-cp-acc-pill img{width:20px;height:20px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,.14)}
    .dc-cp-close{width:32px;height:32px;border-radius:9px;border:1px solid rgba(255,255,255,.08);background:#141418;color:#a1a1aa;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:16px;transition:all .14s}
    .dc-cp-close:hover{color:#09090b;background:#ffffff;border-color:#ffffff}
    .dc-cp-preview{position:relative;display:flex;align-items:center;gap:16px;padding:14px 18px;margin:0 24px 14px;background:linear-gradient(135deg,#15151a 0%,#0e0e12 100%);border-radius:14px;border:1px solid rgba(255,255,255,.09);box-shadow:0 8px 24px rgba(0,0,0,.35);overflow:hidden}
    .dc-cp-preview::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at top right,rgba(255,255,255,.06),transparent 60%);pointer-events:none}
    .dc-cp-prev-avwrap{position:relative;width:56px;height:56px;flex-shrink:0;z-index:1}
    .dc-cp-prev-av{width:56px;height:56px;border-radius:50%;object-fit:cover;background:#1c1c22;display:block;border:2px solid rgba(255,255,255,.16);box-shadow:0 4px 14px rgba(0,0,0,.5)}
    .dc-cp-prev-deco{position:absolute;top:-6px;left:-6px;width:68px;height:68px;pointer-events:none;object-fit:contain}
    .dc-cp-prev-info{position:relative;z-index:1;display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
    .dc-cp-prev-names{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .dc-cp-prev-user{font-size:16px;font-weight:800;color:#ffffff;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dc-cp-prev-gname{font-size:12.5px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dc-cp-prev-badges{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
    .dc-cp-prev-badges img{width:20px;height:20px;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45));transition:transform .14s}
    .dc-cp-prev-badges img:hover{transform:scale(1.18)}
    .dc-cp-tabs{display:flex;margin:0 24px 16px;padding:4px;background:#131317;border:1px solid rgba(255,255,255,.08);border-radius:12px;gap:4px}
    .dc-cp-tab{flex:1;text-align:center;padding:8px 12px;font-size:13px;font-weight:600;color:#a1a1aa;background:transparent;border:0;border-radius:9px;cursor:pointer;transition:all .16s}
    .dc-cp-tab:hover{color:#ffffff;background:rgba(255,255,255,.05)}
    .dc-cp-tab.active{color:#09090b;background:#ffffff;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.3)}
    .dc-cp-body{padding:0 24px 20px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:16px;max-height:55vh}
    .dc-cp-body::-webkit-scrollbar{width:5px}.dc-cp-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:99px}
    .dc-cp-lbl{display:block;font-size:11px;font-weight:700;text-transform:uppercase;color:#a1a1aa;margin-bottom:7px;letter-spacing:.07em}
    .dc-cp-in{width:100%;padding:11px 14px;border-radius:11px;border:1px solid rgba(255,255,255,.09);background:#121216;color:#ffffff!important;font:13.5px/1.35 "gg sans",Segoe UI,sans-serif;outline:none;box-sizing:border-box;transition:border-color .15s,background .15s,box-shadow .15s}
    .dc-cp-in:hover{background:#16161b;border-color:rgba(255,255,255,.16)}
    .dc-cp-in:focus{background:#0d0d10;border-color:#ffffff;box-shadow:0 0 0 3px rgba(255,255,255,.1)}
    .dc-cp-in::placeholder{color:#71717a}
    .dc-cp-tcard{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 16px;border-radius:12px;background:#131317;border:1px solid rgba(255,255,255,.08)}
    .dc-cp-tcard-ttl{font-size:14px;font-weight:700;color:#ffffff}
    .dc-cp-tcard-sub{font-size:12px;color:#a1a1aa;margin-top:2px}
    .dc-cp-warn{display:flex;align-items:flex-start;gap:12px;padding:12px 15px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);color:#d4d4d8;font-size:12.5px;line-height:1.48}
    .dc-cp-img-card{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:12px;background:#131317;border:1px solid rgba(255,255,255,.08)}
    .dc-cp-img-card .dc-cp-in{background:#0c0c0f;padding:10px 13px;border-radius:9px;font-size:13px}
    .dc-cp-browse-btn{display:inline-flex;align-items:center;gap:7px;align-self:flex-start;padding:8px 14px;border-radius:9px;border:1px solid rgba(255,255,255,.1);background:#1a1a20;color:#e4e4e7;font:600 12.5px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:all .14s}
    .dc-cp-browse-btn:hover{background:#ffffff;color:#09090b;border-color:#ffffff}
    .dc-cp-group-box{padding:12px;border-radius:13px;background:#111115;border:1px solid rgba(255,255,255,.07);display:flex;flex-wrap:wrap;gap:7px}
    .dc-cp-bchip{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.08);background:#17171c;color:#d4d4d8;font:600 12.5px/1.1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:all .14s}
    .dc-cp-bchip:hover{background:#202027;border-color:rgba(255,255,255,.22);color:#ffffff;transform:translateY(-1px)}
    .dc-cp-bchip.active{background:rgba(255,255,255,.13);border-color:#ffffff;color:#ffffff;font-weight:700;box-shadow:0 0 0 1px rgba(255,255,255,.28)}
    .dc-cp-bchip img{width:17px;height:17px;object-fit:contain;flex-shrink:0}
    .dc-cp-pills{display:flex;flex-wrap:wrap;gap:7px}
    .dc-cp-pills-scroll{max-height:240px;overflow-y:auto;padding:4px 8px 4px 2px;color-scheme:dark;contain:layout style;will-change:scroll-position}
    .dc-cp-pills-scroll::-webkit-scrollbar{width:5px}
    .dc-cp-pills-scroll::-webkit-scrollbar-track{background:transparent}
    .dc-cp-pills-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:99px}
    .dc-cp-pills-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28)}
    .dc-cp-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:#141418;color:#d4d4d8;font:600 12.5px/1.1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:background .12s,border-color .12s,color .12s,transform .12s;contain:layout style}
    .dc-cp-pill:hover{background:#1f1f26;border-color:rgba(255,255,255,.22);color:#ffffff;transform:translateY(-1px)}
    .dc-cp-pill.active{background:rgba(255,255,255,.14);border-color:#ffffff;color:#ffffff;font-weight:700;box-shadow:0 0 0 1px rgba(255,255,255,.28)}
    .dc-cp-pill img{width:22px;height:22px;object-fit:contain;flex-shrink:0}
    .dc-cp-more-btn{display:inline-flex;align-items:center;justify-content:center;padding:6px 14px;border-radius:999px;border:1px dashed rgba(255,255,255,.2);background:rgba(255,255,255,.04);color:#a1a1aa;font:600 12px/1.1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
    .dc-cp-more-btn:hover{background:rgba(255,255,255,.1);color:#ffffff;border-color:rgba(255,255,255,.35)}
    .dc-cp-plat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(122px,1fr));gap:7px}
    .dc-cp-plat-btn{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:#141418;color:#d4d4d8;font:600 12.5px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:all .14s;overflow:hidden}
    .dc-cp-plat-btn:hover{background:#1e1e25;border-color:rgba(255,255,255,.22);color:#ffffff}
    .dc-cp-plat-btn.active{background:rgba(255,255,255,.14);border-color:#ffffff;color:#ffffff;font-weight:700;box-shadow:0 0 0 1px rgba(255,255,255,.25)}
    .dc-cp-plat-dot{width:19px;height:19px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;flex-shrink:0}
    .dc-cp-footer{display:flex;align-items:center;justify-content:flex-start;gap:10px;padding:15px 24px;background:#0c0c0f;border-top:1px solid rgba(255,255,255,.08)}
    .dc-cp-fbtn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 18px;border-radius:10px;border:1px solid transparent;font:700 13.5px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:all .14s}
    .dc-cp-fbtn.save{background:#ffffff;color:#09090b}
    .dc-cp-fbtn.save:hover{opacity:.88;transform:translateY(-1px)}
    .dc-cp-fbtn.reset{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.24);color:#f87171}
    .dc-cp-fbtn.reset:hover{background:rgba(239,68,68,.2);border-color:rgba(239,68,68,.45);color:#fca5a5}
    .dc-cp-fbtn.cancel{background:#141418;border-color:rgba(255,255,255,.1);color:#d4d4d8;margin-left:auto}
    .dc-cp-fbtn.cancel:hover{background:#1e1e24;color:#ffffff;border-color:rgba(255,255,255,.22)}
    .dc-cp-themed-popout{background:linear-gradient(180deg,var(--dc-cp-c1) 0%,var(--dc-cp-c2) 100%) !important}
    .dc-cp-themed-popout>[class*="inner_"],.dc-cp-themed-popout [class*="accountProfilePopoutWrapper"] [class*="inner_"]{background:rgba(0,0,0,.22) !important}
    .dc-cp-themed-popout [class*="menus_"],.dc-cp-themed-popout [class*="overlay_"]{background:rgba(0,0,0,.28) !important}
    @keyframes dc-pf-shimmer{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    .dc-cp-pf-css{position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-sizing:border-box;box-shadow:inset 0 0 22px var(--dc-pf-glow,rgba(139,92,246,.5))}
    .dc-cp-pf-css::before{content:"";position:absolute;inset:0;padding:3.5px;border-radius:inherit;background:linear-gradient(135deg,var(--dc-pf-c1),var(--dc-pf-c2),var(--dc-pf-c3),var(--dc-pf-c1));background-size:260% 260%;animation:dc-pf-shimmer 4.5s ease infinite;mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;pointer-events:none}
    .dc-cp-pf-css.rgb::before{background:linear-gradient(135deg,#ff3b5c,#facc15,#34d399,#22d3ee,#818cf8,#ec4899,#ff3b5c);background-size:320% 320%;animation:dc-pf-shimmer 3.6s linear infinite}
    .dc-cp-pf-swatch{width:18px;height:18px;border-radius:5px;flex-shrink:0;box-sizing:border-box;border:2px solid transparent;background:linear-gradient(#141418,#141418) padding-box,linear-gradient(135deg,var(--dc-pf-c1),var(--dc-pf-c2),var(--dc-pf-c3)) border-box}
    .dc-cp-mini-btn{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:#18181d;color:#d4d4d8;font:600 11px/1.1 "gg sans",Segoe UI,sans-serif;cursor:pointer;text-transform:none;letter-spacing:0;transition:all .14s}
    .dc-cp-mini-btn:hover{background:#ffffff;color:#09090b;border-color:#ffffff}
  `;

  const getCpData = () => (config.pluginSettings['custom-profile'] ||= {});
  const isCpActive = () => Boolean(config?.plugins?.['custom-profile']);

  const cpDecorationUrl = (assetId, animated = true, size = 240) => {
    const s = String(assetId || '');
    if (!s) return '';
    if (!/^\d+$/.test(s)) return `https://cdn.discordapp.com/avatar-decoration-presets/${s}.png?size=${size}&passthrough=${animated ? 'true' : 'false'}`;
    return `https://cdn.discordapp.com/media/v1/collectibles-shop/${s}/${animated ? 'animated' : 'static'}`;
  };

  function cpCleanMerge(original, overrides) {
    if (!original) return original;
    const clone = Object.create(Object.getPrototypeOf(original));
    for (const key of Reflect.ownKeys(original)) {
      const desc = Object.getOwnPropertyDescriptor(original, key);
      if (desc) Object.defineProperty(clone, key, desc);
    }
    for (const key of Reflect.ownKeys(overrides)) {
      const desc = Object.getOwnPropertyDescriptor(overrides, key);
      if (desc) Object.defineProperty(clone, key, desc);
    }
    return clone;
  }

  function cpSeededFraction(seed) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function cpComputeFakeSinceDate(minMonths, maxMonths, seed) {
    const now = new Date();
    const minDays = Math.round(minMonths * 30.4368);
    let maxDays = Math.round(maxMonths * 30.4368) - 1;
    if (maxDays <= minDays) maxDays = minDays + 1;
    const totalDays = minDays + Math.floor(cpSeededFraction(`${seed}:${minMonths}:${maxMonths}`) * (maxDays - minDays + 1));
    const d = new Date(now);
    d.setDate(d.getDate() - totalDays);
    return d;
  }

  function cpGetFakeNitroDate(level, seedBase) {
    const MINS = [0, 1, 3, 6, 12, 24, 36, 60, 72];
    const MAXS = [1, 3, 6, 12, 24, 36, 60, 72, 108];
    const min = MINS[level] ?? 1;
    const max = MAXS[level] ?? min + 24;
    return cpComputeFakeSinceDate(min, max, `${seedBase}:nitro:${level}`);
  }

  function cpGetFakeBoostDate(boostIdx, seedBase) {
    const b = CP_BOOST_LEVELS[boostIdx];
    const min = b ? b.min : 1;
    const max = b ? b.max : 3;
    return cpComputeFakeSinceDate(min, max, `${seedBase}:boost:${boostIdx}`);
  }

  function cpFormatNitroDesc(d) {
    const dateObj = typeof d === 'string' ? new Date(d) : d;
    if (!dateObj || isNaN(dateObj.getTime())) return L('Abonné Nitro', 'Nitro Subscriber');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yy = String(dateObj.getFullYear()).slice(-2);
    return isEn() ? `Subscriber since ${month}/${day}/${yy}` : `Abonné depuis ${day}/${month}/${yy}`;
  }

  function cpFormatBoostDesc(d) {
    const dateObj = typeof d === 'string' ? new Date(d) : d;
    if (!dateObj || isNaN(dateObj.getTime())) return L('Booster de serveur', 'Server Booster');
    const day = dateObj.getDate();
    const year = dateObj.getFullYear();
    const mEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mFr = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return isEn()
      ? `Server boosting since ${mEn[dateObj.getMonth()]} ${day}, ${year}`
      : `Booster de serveurs depuis le ${day} ${mFr[dateObj.getMonth()]} ${year}`;
  }

  function cpBuildBadgesList(d, seedBase = 'self') {
    const list = [];
    const flags = Number(d.badgeFlags) || 0;
    for (const b of CP_BADGES) {
      if (flags & b.flag) {
        list.push({
          id: b.id,
          icon: b.icon.split('/').pop().replace('.png', ''),
          iconUrl: b.icon,
          description: isEn() ? b.en : b.fr
        });
      }
    }
    const nl = d.nitroLevel ?? -1;
    if ((d.nitro || nl >= 0) && nl >= 0 && CP_NITRO_LEVELS[nl]) {
      const nObj = CP_NITRO_LEVELS[nl];
      const since = cpGetFakeNitroDate(nl, seedBase);
      list.push({
        id: `premium_tenure_${nObj.months}_month_v2`,
        icon: nObj.icon.split('/').pop().replace('.png', ''),
        iconUrl: nObj.icon,
        description: cpFormatNitroDesc(since)
      });
    }
    const bm = d.boostMonths ?? -1;
    if (bm >= 0 && CP_BOOST_LEVELS[bm]) {
      const bObj = CP_BOOST_LEVELS[bm];
      const since = cpGetFakeBoostDate(bm, seedBase);
      list.push({
        id: `guild_booster_${bObj.lvl}`,
        icon: bObj.icon.split('/').pop().replace('.png', ''),
        iconUrl: bObj.icon,
        description: cpFormatBoostDesc(since),
        link: 'https://discord.com/settings/guild-boosting'
      });
    }
    const customIds = Array.isArray(d.customBadgeIds) ? d.customBadgeIds : [];
    for (const sp of CP_SPECIAL_BADGES) {
      if (!customIds.includes(sp.id)) continue;
      let desc = isEn() ? sp.en : sp.fr;
      if (sp.id === 'oldname') {
        desc = d.oldName
          ? (isEn() ? `Originally known as ${d.oldName}` : `Connu à l'origine sous le nom de ${d.oldName}`)
          : (isEn() ? 'Originally known as ...' : "Connu à l'origine sous le nom de ...");
      } else if (sp.id === 'gifting_level') {
        const lvl = Number(d.levelReached) || 1;
        desc = isEn() ? `Level ${lvl} Reached` : `Niveau ${lvl} atteint`;
      }
      list.push({
        id: sp.badgeId,
        icon: sp.icon.split('/').pop().replace('.png', ''),
        iconUrl: sp.icon,
        description: desc
      });
    }
    for (const gf of CP_GIFTING_BADGES) {
      if (!customIds.includes(gf.id)) continue;
      list.push({
        id: gf.id,
        icon: gf.icon.split('/').pop().replace('.png', ''),
        iconUrl: gf.icon,
        description: isEn() ? gf.en : gf.fr
      });
    }
    return list;
  }

  function cpFormatConnections(conns) {
    if (!Array.isArray(conns) || !conns.length) return [];
    return conns.map((c) => {
      const plat = CP_FAKE_PLATFORMS.find((p) => p.id === c.platform) || CP_FAKE_PLATFORMS[0];
      let url = c.url || '';
      if (!url && plat.defaultUrl && c.name) {
        try { url = plat.defaultUrl(c.name); } catch {}
      }
      return {
        type: c.platform,
        id: c.name || 'connection',
        name: c.name,
        verified: true,
        visibility: 1,
        showActivity: false,
        show_activity: false,
        friendSync: false,
        friend_sync: false,
        metadataVisibility: 0,
        metadata_visibility: 0,
        twoWayLink: false,
        two_way_link: false,
        metadata: {},
        ...(url ? { url } : {})
      };
    });
  }

  let cpVersion = 1;
  let cpOrigUserRef = null;
  let cpProxyUserRef = null;
  let cpProxyVer = 0;

  function cpFakeUser(realUser) {
    if (!realUser || !isCpActive()) return realUser;
    const d = getCpData();
    if (cpOrigUserRef === realUser && cpProxyUserRef && cpProxyVer === cpVersion) return cpProxyUserRef;
    const hasNitro = Boolean(d.nitro || (d.nitroLevel ?? -1) >= 0 || (d.boostMonths ?? -1) >= 0 || d.banner || d.accentColor || d.decorationAsset || d.profileEffectId || d.nameplateId || d.profileFrameId);
    const proxy = new Proxy(realUser, {
      get(target, prop) {
        const desc = Object.getOwnPropertyDescriptor(target, prop);
        if (desc && !desc.configurable) return Reflect.get(target, prop, target);
        if (prop === '__cp_isClone') return true;
        if ((prop === 'username' || prop === 'legacyUsername') && isCpActive() && d.username) return d.username;
        if (prop === 'globalName' && isCpActive() && d.globalName) return d.globalName;
        if (prop === 'displayName' && isCpActive() && d.globalName) return d.globalName;
        if (prop === 'email' && isCpActive() && d.email) return d.email;
        if (prop === 'phone' && isCpActive() && d.phone) return d.phone;
        if (prop === 'createdAt' && isCpActive() && d.createdAt) return new Date(d.createdAt + 'T12:00:00Z');
        if ((prop === 'clan' || prop === 'primaryGuild') && isCpActive() && d.clanTag) {
          const origPg = target.primaryGuild || target.clan || {};
          return {
            ...origPg,
            identityEnabled: true,
            identityGuildId: origPg.identityGuildId || target.id || '1',
            tag: d.clanTag,
            badge: origPg.badge || '1'
          };
        }
        if (prop === 'avatarDecoration' && isCpActive() && d.decorationAsset) return null;
        if (prop === 'avatarDecorationData' && isCpActive() && d.decorationAsset) {
          return { asset: d.decorationAsset, skuId: d.decorationAsset };
        }
        if (prop === 'collectibles' && isCpActive() && (d.nameplateId || d.profileFrameId)) {
          const base = target.collectibles && typeof target.collectibles === 'object' ? { ...target.collectibles } : {};
          if (d.nameplateId) {
            const np = (cpDynamicNameplates || []).find((n) => n.id === d.nameplateId);
            if (np) {
              base.nameplate = {
                skuId: np.id,
                sku_id: np.id,
                asset: np.asset,
                label: np.label || '',
                palette: np.palette || 'sky'
              };
            }
          }
          if (d.profileFrameId) {
            const pf = (cpDynamicFrames || CP_PROFILE_FRAMES).find((f) => f.id === d.profileFrameId);
            const pfVal = {
              skuId: d.profileFrameId,
              sku_id: d.profileFrameId,
              expiresAt: null,
              expireAt: null,
              ...(pf?.rawConfig || {}),
              ...(pf?.asset ? { asset: pf.asset } : {})
            };
            base.profileFrame = pfVal;
            base.profile_frame = pfVal;
          }
          return base;
        }
        if ((prop === 'publicFlags' || prop === 'flags') && isCpActive() && d.badgeFlags != null) {
          return Number(d.badgeFlags) || 0;
        }
        if (prop === 'premiumType' && isCpActive() && hasNitro) return 2;
        if (prop === 'premiumSince' && isCpActive() && hasNitro) {
          return cpGetFakeNitroDate(Math.max(0, d.nitroLevel ?? 0), target.id || 'self');
        }
        if (prop === 'premiumGuildSince' && isCpActive() && (d.boostMonths ?? -1) >= 0) {
          return cpGetFakeBoostDate(d.boostMonths, target.id || 'self');
        }
        if (prop === 'getTag' && isCpActive() && d.username) {
          return () => (target.discriminator === '0' ? d.username : `${d.username}#${target.discriminator}`);
        }
        if (prop === 'getGlobalName' && isCpActive() && d.globalName) {
          return () => d.globalName;
        }
        const val = Reflect.get(target, prop, target);
        return typeof val === 'function' ? val.bind(target) : val;
      },
      set(target, prop, value) {
        return Reflect.set(target, prop, value, target);
      }
    });
    cpOrigUserRef = realUser;
    cpProxyUserRef = proxy;
    cpProxyVer = cpVersion;
    return proxy;
  }

  function cpHookProfile(profile, guildOnly = false) {
    if (!profile || !isCpActive()) return profile;
    const d = getCpData();
    const merged = {};
    const hasNitro = Boolean(d.nitro || (d.nitroLevel ?? -1) >= 0 || (d.boostMonths ?? -1) >= 0 || d.banner || d.accentColor || d.decorationAsset || d.profileEffectId || d.nameplateId || d.profileFrameId);
    if (d.bio) merged.bio = d.bio;
    if (d.pronouns) merged.pronouns = d.pronouns;
    if (d.banner) merged.banner = d.banner;
    if (d.accentColor) {
      const c1 = parseInt(String(d.accentColor).replace('#', ''), 16);
      const c2 = d.accentColor2 ? parseInt(String(d.accentColor2).replace('#', ''), 16) : c1;
      if (!isNaN(c1)) {
        merged.accentColor = c1;
        merged.themeColors = [c1, !isNaN(c2) ? c2 : c1];
      }
    }
    if (d.decorationAsset) {
      merged.avatarDecoration = null;
      merged.avatarDecorationData = { asset: d.decorationAsset, skuId: d.decorationAsset };
    }
    if (hasNitro) {
      merged.premiumType = 2;
      merged.premiumSince = cpGetFakeNitroDate(Math.max(0, d.nitroLevel ?? 0), profile.userId || 'self');
    }
    if ((d.boostMonths ?? -1) >= 0) {
      merged.premiumGuildSince = cpGetFakeBoostDate(d.boostMonths, profile.userId || 'self');
    }
    if (d.badgeFlags != null) {
      merged.publicFlags = Number(d.badgeFlags) || 0;
    }
    if (!guildOnly && (!Array.isArray(profile.badges) || profile.badges.length === 0)) {
      const built = cpBuildBadgesList(d, profile.userId || 'self');
      if (built.length) {
        merged.badges = [{
          id: 'premium_tenure_72_month_v2',
          icon: '5b154df19c53dce2af92c9b61e6be5e2',
          description: built[0].description || 'Nitro',
          link: 'https://discord.com/settings/premium'
        }];
      }
    }
    if (d.profileEffectId) {
      merged.profileEffectId = d.profileEffectId;
      merged.profileEffect = { expireAt: null, skuId: d.profileEffectId };
    }
    if (d.profileFrameId) {
      const pf = (cpDynamicFrames || CP_PROFILE_FRAMES).find((f) => f.id === d.profileFrameId);
      const pfVal = {
        expireAt: null,
        expiresAt: null,
        skuId: d.profileFrameId,
        sku_id: d.profileFrameId,
        ...(pf?.rawConfig || {}),
        ...(pf?.asset ? { asset: pf.asset } : {})
      };
      merged.profileFrame = pfVal;
      merged.profile_frame = pfVal;
    }
    if (d.nameplateId || d.profileFrameId) {
      const baseCol = profile.collectibles && typeof profile.collectibles === 'object' ? { ...profile.collectibles } : {};
      if (d.nameplateId) {
        const np = (cpDynamicNameplates || []).find((n) => n.id === d.nameplateId);
        if (np) {
          baseCol.nameplate = { skuId: np.id, sku_id: np.id, asset: np.asset, label: np.label || '', palette: np.palette || 'sky' };
        }
      }
      if (d.profileFrameId) {
        const pf = (cpDynamicFrames || CP_PROFILE_FRAMES).find((f) => f.id === d.profileFrameId);
        const pfVal = {
          skuId: d.profileFrameId,
          sku_id: d.profileFrameId,
          expiresAt: null,
          expireAt: null,
          ...(pf?.rawConfig || {}),
          ...(pf?.asset ? { asset: pf.asset } : {})
        };
        baseCol.profileFrame = pfVal;
        baseCol.profile_frame = pfVal;
      }
      merged.collectibles = baseCol;
    }
    if (Array.isArray(d.fakeConnections) && d.fakeConnections.length) {
      const fakeAccs = cpFormatConnections(d.fakeConnections);
      const existing = profile.connectedAccounts || profile.connected_accounts || [];
      merged.connectedAccounts = [...existing, ...fakeAccs];
      merged.connected_accounts = [...existing, ...fakeAccs];
    }
    return cpCleanMerge(profile, merged);
  }

  function cpFindStore(name, fallbackPred, hints) {
    const cached = storeCache['cp:' + name];
    if (cached) return cached;
    let found = findWebpackExport((m) => {
      try {
        return typeof m.getName === 'function' && m.getName() === name && typeof m.emitChange === 'function';
      } catch {
        return false;
      }
    }, [name]);
    if (!found && fallbackPred) found = findWebpackExport(fallbackPred, hints);
    if (found) storeCache['cp:' + name] = found;
    return found;
  }

  let cpCachedMyId = '';
  function cpGetMyId() {
    try {
      const id = getUserStore()?.getCurrentUser?.()?.id;
      if (id) return (cpCachedMyId = String(id));
    } catch {}
    if (cpCachedMyId) return cpCachedMyId;
    try {
      const avImg = document.querySelector('[class*="panels_"] img[src*="/avatars/"], [class*="accountProfileCard"] img[src*="/avatars/"]');
      const m = avImg?.getAttribute('src')?.match(/\/avatars\/(\d+)\//);
      if (m) return (cpCachedMyId = m[1]);
    } catch {}
    try {
      const panels = document.querySelector('[class*="panels_"], [class*="accountProfileCard"]');
      if (panels) {
        const fk = Object.keys(panels).find((k) => k.startsWith('__reactFiber$'));
        let node = fk ? panels[fk] : null;
        for (let i = 0; i < 60 && node; i++, node = node.return) {
          const p = node.memoizedProps;
          const id = p?.currentUser?.id || p?.user?.id || p?.account?.id;
          if (id && /^\d{15,22}$/.test(String(id))) return (cpCachedMyId = String(id));
        }
      }
    } catch {}
    return '';
  }

  let cpDpPatched = false;
  let cpDpLastTry = 0;
  let cpDpOrigLogged = false;
  function cpPatchDisplayProfileProto(Proto) {
    if (!Proto || Proto._dc_cp_dp_hook || typeof Proto.getBadges !== 'function') return false;
    const origGetBadges = Proto.getBadges;
    Proto.getBadges = function () {
      const origRes = origGetBadges.apply(this, arguments);
      try {
        const meId = cpGetMyId();
        const uid = this.userId ?? this._userProfile?.userId ?? this._guildMemberProfile?.userId ?? this.user?.id ?? this._user?.id;
        if (!cpDpOrigLogged && meId && String(uid) === String(meId)) {
          cpDpOrigLogged = true;
          log(`[CP-DP] origBadges=${JSON.stringify(origRes).slice(0, 300)}`);
        }
        if (isCpActive() && meId && String(uid) === String(meId)) {
          if (Array.isArray(origRes) && origRes.length > 0) {
            return origRes;
          }
          const built = cpBuildBadgesList(getCpData(), meId);
          if (built.length) {
            return [{
              id: 'premium_tenure_72_month_v2',
              description: built[0].description || 'Nitro',
              icon: '5b154df19c53dce2af92c9b61e6be5e2',
              link: 'https://discord.com/settings/premium'
            }];
          }
        }
      } catch {}
      return origRes;
    };
    if (typeof Proto.getLegacyUsername === 'function') {
      const origLegacy = Proto.getLegacyUsername;
      Proto.getLegacyUsername = function () {
        try {
          const meId = cpGetMyId();
          const d = getCpData();
          const uid = this.userId ?? this._userProfile?.userId ?? this.user?.id;
          if (isCpActive() && meId && String(uid) === String(meId) && d.oldName) return d.oldName;
        } catch {}
        return origLegacy.apply(this, arguments);
      };
    }
    try {
      const dpProps = Object.getOwnPropertyNames(Proto).filter((k) => /frame|effect|collectible|deco|banner|badge/i.test(k));
      if (dpProps.length) log('[CP-DP-PROPS] ' + dpProps.join(','));
    } catch {}
    if (typeof Proto.getProfileFrame === 'function') {
      const origGetFrame = Proto.getProfileFrame;
      Proto.getProfileFrame = function () {
        try {
          const meId = cpGetMyId();
          const d = getCpData();
          const uid = this.userId ?? this._userProfile?.userId ?? this._guildMemberProfile?.userId ?? this.user?.id;
          if (isCpActive() && d.profileFrameId && meId && String(uid) === String(meId)) {
            const pf = (cpDynamicFrames || CP_PROFILE_FRAMES).find((f) => f.id === d.profileFrameId);
            return { skuId: d.profileFrameId, sku_id: d.profileFrameId, expiresAt: null, expireAt: null, ...(pf?.rawConfig || {}) };
          }
        } catch {}
        return origGetFrame.apply(this, arguments);
      };
    }
    Proto._dc_cp_dp_hook = true;
    cpDpPatched = true;
    return true;
  }

  // Secours : récupère la classe DisplayProfile depuis une instance React visible (popout / profil / badges)
  function cpHookDisplayProfileFromFibers() {
    if (cpDpPatched || !isCpActive()) return;
    const targets = document.querySelectorAll(
      '[class*="badgeList"],[class*="badges_"],[class*="profileBadges"],img[src*="badge-icons"],[id^="popout_"],[class*="userPopout"],[class*="userProfile"],[class*="accountProfileCard"],[class*="profilePanel"],[role="dialog"]'
    );
    for (const el of targets) {
      let cur = el;
      for (let depth = 0; depth < 6 && cur; depth++, cur = cur.firstElementChild) {
        const fk = Object.keys(cur).find((k) => k.startsWith('__reactFiber$'));
        if (!fk) continue;
        let node = cur[fk];
        for (let i = 0; i < 120 && node; i++, node = node.return) {
          const p = node.memoizedProps;
          const dp = p?.displayProfile || p?.profile || p?.userProfile;
          if (dp && typeof dp.getBadges === 'function' && dp.constructor?.prototype) {
            if (cpPatchDisplayProfileProto(dp.constructor.prototype)) {
              cpSyncToDomAndStores();
              return;
            }
          }
        }
      }
    }
  }

  let cpHooksLogged = false;
  function cpInstallStoreHooks() {
    try {
      const US = getUserStore();
      if (!US) return;

      if (!US._dc_cp_hook && typeof US.getCurrentUser === 'function') {
        const origCur = US.getCurrentUser.bind(US);
        const origGet = typeof US.getUser === 'function' ? US.getUser.bind(US) : null;
        US.getCurrentUser = () => {
          const u = origCur();
          if (u && !u.constructor?.prototype?._dc_cp_proto) {
            try {
              const Proto = u.constructor.prototype;
              Proto._dc_cp_proto = true;
              ['isStaff', 'isStaffPersonal', 'isStaffUser', 'hasStaffFlag', 'isStaffMember'].forEach((p) => {
                const origFn = Proto[p];
                if (typeof origFn === 'function') {
                  Proto[p] = function () {
                    if (isCpActive()) return true;
                    return origFn.call(this);
                  };
                }
              });
            } catch {}
          }
          return isCpActive() ? cpFakeUser(u) : u;
        };
        if (origGet) {
          US.getUser = (id) => {
            const u = origGet(id);
            const me = origCur();
            if (u && me && String(id) === String(me.id) && isCpActive()) return cpFakeUser(u);
            return u;
          };
        }
        US._dc_cp_hook = true;
      }

      const UPS = cpFindStore('UserProfileStore', (m) => typeof m.getUserProfile === 'function' && typeof m.getGuildMemberProfile === 'function', ['getUserProfile', 'getGuildMemberProfile']);
      if (UPS && !UPS._dc_cp_hook) {
        const origProf = UPS.getUserProfile.bind(UPS);
        UPS.getUserProfile = (uid) => {
          const p = origProf(uid);
          const meId = US.getCurrentUser?.()?.id;
          if (p && meId && String(uid) === String(meId) && isCpActive()) return cpHookProfile(p, false);
          return p;
        };
        if (typeof UPS.getGuildMemberProfile === 'function') {
          const origGuildProf = UPS.getGuildMemberProfile.bind(UPS);
          UPS.getGuildMemberProfile = (uid, gid) => {
            const p = origGuildProf(uid, gid);
            const meId = US.getCurrentUser?.()?.id;
            if (p && meId && String(uid) === String(meId) && isCpActive()) return cpHookProfile(p, true);
            return p;
          };
        }
        if (typeof UPS.getDisplayProfile === 'function') {
          const origDisp = UPS.getDisplayProfile.bind(UPS);
          UPS.getDisplayProfile = (uid, gid) => {
            const p = origDisp(uid, gid);
            const meId = US.getCurrentUser?.()?.id;
            if (p && meId && String(uid) === String(meId) && isCpActive()) return cpHookProfile(p, false);
            return p;
          };
        }
        UPS._dc_cp_hook = true;
      }

      const GMS = cpFindStore('GuildMemberStore', (m) => typeof m.getMember === 'function' && typeof m.getMembers === 'function', ['getMember', 'getMembers']);
      if (GMS && !GMS._dc_cp_hook) {
        const origMem = GMS.getMember.bind(GMS);
        GMS.getMember = (gid, uid) => {
          const m = origMem(gid, uid);
          const meId = US.getCurrentUser?.()?.id;
          const d = getCpData();
          if (m && meId && String(uid) === String(meId) && isCpActive() && (d.globalName || d.username)) {
            return { ...m, nick: d.globalName || d.username };
          }
          return m;
        };
        GMS._dc_cp_hook = true;
      }

      const CAS = findWebpackExport((m) => typeof m?.getAccounts === 'function' && typeof m?.getLocalAccounts === 'function', ['getAccounts', 'getLocalAccounts']);
      if (CAS && !CAS._dc_cp_hook) {
        const origAccs = CAS.getAccounts.bind(CAS);
        CAS.getAccounts = () => {
          const accs = origAccs() || [];
          const d = getCpData();
          if (isCpActive() && Array.isArray(d.fakeConnections) && d.fakeConnections.length) {
            return [...accs, ...cpFormatConnections(d.fakeConnections)];
          }
          return accs;
        };
        CAS._dc_cp_hook = true;
      }

      const IU = findWebpackExport((m) => typeof m?.getUserAvatarURL === 'function' && typeof m?.getDefaultAvatarURL === 'function', ['getUserAvatarURL', 'getDefaultAvatarURL']);
      if (IU && !IU._dc_cp_hook) {
        const origAv = IU.getUserAvatarURL.bind(IU);
        IU.getUserAvatarURL = (user, ...args) => {
          const meId = US.getCurrentUser?.()?.id;
          const uid = user?.id ?? user?.userId;
          const d = getCpData();
          if (isCpActive() && d.avatar && meId && String(uid) === String(meId)) return d.avatar;
          return origAv(user, ...args);
        };
        if (typeof IU.getUserBannerURL === 'function') {
          const origBan = IU.getUserBannerURL.bind(IU);
          IU.getUserBannerURL = (opts, ...args) => {
            const meId = US.getCurrentUser?.()?.id;
            const d = getCpData();
            if (isCpActive() && d.banner && meId && String(opts?.id) === String(meId)) return d.banner;
            return origBan(opts, ...args);
          };
        }
        IU._dc_cp_hook = true;
      }

      const DecoMod = findWebpackExport((m) => typeof m?.getAvatarDecorationURL === 'function', ['getAvatarDecorationURL']);
      if (DecoMod && !DecoMod._dc_cp_hook) {
        const origDeco = DecoMod.getAvatarDecorationURL.bind(DecoMod);
        DecoMod.getAvatarDecorationURL = (opts) => {
          try {
            const d = getCpData();
            if (isCpActive() && d.decorationAsset) {
              const decoData = opts?.avatarDecorationData ?? opts?.avatarDecoration ?? opts;
              const meId = US.getCurrentUser?.()?.id;
              if (decoData?.asset === d.decorationAsset || decoData?.skuId === d.decorationAsset || (opts?.userId && String(opts.userId) === String(meId))) {
                return cpDecorationUrl(d.decorationAsset, opts?.canAnimate ?? true);
              }
            }
          } catch {}
          return origDeco(opts);
        };
        DecoMod._dc_cp_hook = true;
      }

      if (!cpDpPatched && Date.now() - cpDpLastTry > 2500) {
        cpDpLastTry = Date.now();
        const dpPred = (m) => typeof m?.prototype?.getBadges === 'function' && (typeof m?.prototype?.getLegacyUsername === 'function' || typeof m?.prototype?.getBannerURL === 'function' || typeof m?.prototype?.canUsePremiumProfileCustomization === 'function');
        const DP = findWebpackExport(dpPred, ['getBadges', 'getLegacyUsername']) || findWebpackExport(dpPred, ['getBadges', 'getBannerURL']);
        if (DP) cpPatchDisplayProfileProto(DP.prototype);
        if (!cpHooksLogged) {
          cpHooksLogged = true;
          log(`[CustomProfile] Hooks: US=${Boolean(US)} UPS=${Boolean(UPS)} DP=${Boolean(DP)} dpPatched=${cpDpPatched}`);
        }
      }
    } catch {}
  }

  function cpSyncToDomAndStores() {
    cpVersion++;
    cpOrigUserRef = null;
    cpProxyUserRef = null;
    cpInstallStoreHooks();
    try {
      const US = getUserStore();
      const UPS = cpFindStore('UserProfileStore', (m) => typeof m.getUserProfile === 'function' && typeof m.getGuildMemberProfile === 'function', ['getUserProfile', 'getGuildMemberProfile']);
      const myId = cpGetMyId();
      if (myId) {
        const d = getCpData();
        const cfUsers = getCfUsers();
        if (isCpActive() && (d.globalName || d.username || d.avatar || d.banner || d.bio || d.pronouns || d.clanTag || d.accentColor || d.decorationAsset || d.createdAt)) {
          let sinceStr = '';
          if (d.createdAt) {
            try {
              sinceStr = new Date(d.createdAt + 'T12:00:00Z').toLocaleDateString(isEn() ? 'en-US' : 'fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              });
            } catch {}
          }
          cfUsers[myId] = {
            ...(cfUsers[myId] || {}),
            _fromCp: true,
            name: d.globalName || '',
            username: d.username || '',
            avatar: d.avatar || '',
            banner: d.banner || '',
            bio: d.bio || '',
            pronouns: d.pronouns || '',
            clanTag: d.clanTag || '',
            memberSince: sinceStr,
            profileColor: d.accentColor || '',
            profileColor2: d.accentColor2 || d.accentColor || '',
            decoration: d.decorationAsset ? cpDecorationUrl(d.decorationAsset, true) : '',
            disabled: false
          };
          cfRestored.delete(myId);
          applyCustomFriends();
        } else if (cfUsers[myId]?._fromCp) {
          delete cfUsers[myId];
          restoreCustomFriend(myId);
        }
      }
      cpApplyDomBadges(true);
      US?.emitChange?.();
      UPS?.emitChange?.();
    } catch {}
  }

  function cpRestoreDomBadges() {
    document.querySelectorAll('.dc-cp-dom-badges').forEach((el) => el.remove());
    document.querySelectorAll('[data-dc-cp-orig-badge]').forEach((el) => {
      el.style.display = el.dataset.dcCpOrigDisp || '';
      delete el.dataset.dcCpOrigBadge;
      delete el.dataset.dcCpOrigDisp;
    });
  }

  let cpDomLogCount = 0;
  let lastCpDomRun = 0;
  function cpApplyDomBadges(force = false) {
    if (!force) {
      if (document.hidden) return;
      const now = performance.now();
      if (now - lastCpDomRun < 180) return;
      lastCpDomRun = now;
    } else {
      lastCpDomRun = performance.now();
    }
    if (!isCpActive()) {
      cpRestoreDomBadges();
      document.querySelectorAll('.dc-cp-inj-deco,.dc-cp-pe-ov,.dc-cp-pf-ov,.dc-cp-pf-ov-back,.dc-cp-np-bg').forEach((el) => el.remove());
      document.querySelectorAll('.dc-cp-themed-popout').forEach((el) => el.classList.remove('dc-cp-themed-popout'));
      return;
    }
    const myId = cpGetMyId();
    if (!myId) return;
    const d = getCpData();
    const badges = cpBuildBadgesList(d, myId);
    const sig = badges.map((b) => `${b.id}:${b.icon}:${b.description}`).join('|');
    const seenBoxes = new Set();

    const checkFiberForMe = (el) => {
      try {
        let cur = el;
        for (let depth = 0; depth < 14 && cur; depth++, cur = cur.parentElement) {
          const fk = Object.keys(cur).find((k) => k.startsWith('__reactFiber$'));
          if (fk) {
            let node = cur[fk];
            for (let i = 0; i < 100 && node; i++, node = node.return) {
              const p = node.memoizedProps;
              if (!p || typeof p !== 'object') continue;
              const id =
                p.userId ||
                p.user?.id ||
                p.displayProfile?.userId ||
                p.userProfile?.userId ||
                p.profile?.userId ||
                p.account?.id ||
                p.currentUser?.id ||
                p.member?.userId;
              if (id && String(id) === myId) return true;
            }
          }
          const pk = Object.keys(cur).find((k) => k.startsWith('__reactProps$'));
          if (pk) {
            const p = cur[pk];
            const id = p?.userId || p?.user?.id || p?.displayProfile?.userId || p?.userProfile?.userId || p?.profile?.userId;
            if (id && String(id) === myId) return true;
          }
        }
      } catch {}
      return false;
    };

    if (!badges.length) {
      cpRestoreDomBadges();
    } else {
      const allBadgeImgs = document.querySelectorAll(
        'img[src*="badge-icons"],[class*="badgeList"] img,[class*="profileBadges"] img'
      );
      allBadgeImgs.forEach((img) => {
        if (img.closest('#dc-cp-modal,#dc-cf-modal,#dc-settings-embedded,.dc-cp-dom-badges,[class*="activity"],[class*="spotify"],[class*="listening"],[class*="playing"],[class*="presence"],[class*="gameIcon"],[class*="assets_"],[class*="quest"],[class*="clan"],[class*="guildTag"]')) return;
        const src = img.getAttribute('src') || '';
        if (src.includes('/avatars/') || src.includes('/clan-badges/') || src.includes('/emojis/') || src.includes('/avatar-decoration')) return;
        const badgeBox =
          img.closest('[class*="badgeList"],[class*="profileBadges"],[class*="badges_"],[role="list"]') ||
          img.closest('a,button,[role="button"]')?.parentElement ||
          img.parentElement;
        if (!badgeBox || seenBoxes.has(badgeBox)) return;
        if (badgeBox.closest('[class*="activity"],[class*="spotify"],[class*="listening"],[class*="playing"],[class*="presence"],[class*="gameIcon"],[class*="assets_"],[class*="quest"]')) return;

        applyToBadgeBox(badgeBox, img);
      });

      document.querySelectorAll('[class*="badgeList"],[class*="profileBadges"]').forEach((badgeBox) => {
        if (seenBoxes.has(badgeBox)) return;
        if (badgeBox.closest('#dc-cp-modal,#dc-cf-modal,#dc-settings-embedded,.dc-cp-dom-badges,[class*="activity"],[class*="spotify"],[class*="listening"],[class*="playing"],[class*="presence"],[class*="gameIcon"],[class*="assets_"],[class*="quest"],[class*="clan"],[class*="guildTag"]')) return;
        applyToBadgeBox(badgeBox, null);
      });
    }

    // Remplace directement la décoration d'avatar & l'effet/cadre de profil sur ton propre compte partout
    const decoUrl = d.decorationAsset ? cpDecorationUrl(d.decorationAsset, true) : '';
    const effObj = d.profileEffectId ? (cpDynamicEffects || CP_PROFILE_EFFECTS).find((e) => e.id === d.profileEffectId) : null;
    const effLayers = effObj?.layers?.length ? effObj.layers : (effObj?.img ? [effObj.img] : []);
    if (decoUrl) {
      document.querySelectorAll(`img[src*="/avatars/${myId}/"],img[src*="/users/${myId}/avatars/"],img[data-dc-cf-uid="${myId}"]`).forEach((av) => {
        if (av.closest('#dc-cp-modal,#dc-cf-modal,#dc-settings-embedded')) return;
        const r = av.getBoundingClientRect();
        if (r.width < 20 || r.width > 140) return;
        let avBox = av.parentElement?.closest('[class*="avatarWrapper"],[class*="wrapper_"],[class*="avatar_"]');
        if (!avBox || avBox.clientWidth > r.width * 1.7 || avBox.clientHeight > r.height * 1.7) {
          avBox = av.parentElement;
        }
        if (!avBox || avBox.clientWidth > r.width * 1.8 || avBox.clientHeight > r.height * 1.8) return;
        const searchRoot = avBox.querySelector('img[src*="avatar-decoration"],[class*="avatarDecoration"] img') ? avBox : (avBox.parentElement || avBox);
        const decos = Array.from(searchRoot.querySelectorAll('img[src*="avatar-decoration"],[class*="avatarDecoration"] img')).filter(
          (nat) => !nat.classList.contains('dc-cf-inj-deco') && !nat.classList.contains('dc-cp-inj-deco')
        );
        if (decos.length) {
          avBox.querySelector('.dc-cp-inj-deco')?.remove();
          decos.forEach((nat) => {
            if (nat.dataset.dcCpOrigDeco === undefined) nat.dataset.dcCpOrigDeco = nat.getAttribute('src') || '';
            nat.removeAttribute('srcset');
            nat.style.display = '';
            if (nat.src !== decoUrl) nat.src = decoUrl;
          });
        } else {
          const sz = Math.round(r.width * 1.2);
          let inj = avBox.querySelector('.dc-cp-inj-deco');
          if (!inj) {
            inj = document.createElement('img');
            inj.className = 'dc-cp-inj-deco';
            if (getComputedStyle(avBox).position === 'static') avBox.style.position = 'relative';
            avBox.appendChild(inj);
          }
          inj.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:${sz}px;height:${sz}px;pointer-events:none;z-index:5;object-fit:contain`;
          if (inj.src !== decoUrl) inj.src = decoUrl;
        }
      });
    } else {
      document.querySelectorAll('.dc-cp-inj-deco').forEach((el) => el.remove());
      document.querySelectorAll('[data-dc-cp-orig-deco]').forEach((nat) => {
        nat.src = nat.dataset.dcCpOrigDeco;
        delete nat.dataset.dcCpOrigDeco;
      });
    }
    let cachedMyCards = null;
    const getMyProfileCards = () => {
      if (cachedMyCards) return cachedMyCards;
      cachedMyCards = [];
      const candidates = new Set(
        document.querySelectorAll(
          '[id^="popout_"] [class*="outer_"],[role="dialog"] [class*="outer_"],[class*="userPopoutOuter_"],[class*="userProfileOuter_"],[class*="userPanelOuter_"],[class*="profilePanel"],[class*="profileCustomization"] [class*="outer_"],[class*="accountProfilePopoutWrapper"] [class*="outer_"]'
        )
      );
      document.querySelectorAll('[class*="userProfileInner_"],[class*="userPopoutInner_"],[class*="profileEffects_"]').forEach((inner) => {
        const outer = inner.closest('[class*="outer_"]') || inner.parentElement;
        if (outer) candidates.add(outer);
      });
      candidates.forEach((card) => {
        if (card.closest('#dc-cp-modal,#dc-cf-modal,#dc-settings-embedded')) return;
        if (card.clientWidth < 200 || card.clientHeight < 180) return;
        const isMe = Boolean(card.querySelector(`img[src*="/avatars/${myId}/"],img[src*="/users/${myId}/avatars/"],img[data-dc-cf-uid="${myId}"]`)) || checkFiberForMe(card);
        if (isMe) cachedMyCards.push(card);
      });
      return cachedMyCards;
    };

    if (effLayers.length) {
      const effSig = d.profileEffectId + '|' + effLayers.join(',');
      getMyProfileCards().forEach((card) => {
        card.querySelectorAll('[class*="profileEffects_"]').forEach((pe) => {
          if (!pe.classList.contains('dc-cp-pe-ov')) pe.style.display = 'none';
        });
        let ov = card.querySelector('.dc-cp-pe-ov');
        if (!ov) {
          ov = document.createElement('div');
          ov.className = 'dc-cp-pe-ov';
          ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:12;border-radius:inherit';
          if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
          card.appendChild(ov);
        }
        if (ov.dataset.dcEffSig !== effSig) {
          ov.dataset.dcEffSig = effSig;
          log(`[CustomProfile] Applied profile effect ${d.profileEffectId} (${effLayers.length} layer(s))`);
          setHTML(
            ov,
            effLayers
              .map((src) => `<img src="${esc(src)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center;display:block;pointer-events:none">`)
              .join('')
          );
        }
      });
    } else {
      document.querySelectorAll('.dc-cp-pe-ov').forEach((el) => el.remove());
    }

    const cpFetchingFrames = window.__DC_CP_FETCHING_FRAMES__ || (window.__DC_CP_FETCHING_FRAMES__ = new Set());
    const pfObj = d.profileFrameId ? (cpDynamicFrames || CP_PROFILE_FRAMES).find((f) => f.id === d.profileFrameId) : null;
    if (pfObj && !pfObj.c1 && !pfObj.innerWidth && !cpFetchingFrames.has(pfObj.id)) {
      cpFetchingFrames.add(pfObj.id);
      dcDiscordApi('GET', `/collectibles-products/${pfObj.id}`, null, null, 'FrameCfg')
        .then((prod) => {
          const item = prod?.items?.find((x) => x && (x.type === 3 || Array.isArray(x.layers))) || prod?.items?.[0];
          if (!item) return;
          const layerDefs = (Array.isArray(item.layers) ? item.layers : [])
            .filter((l) => l && l.id)
            .map((l) => ({
              id: String(l.id),
              type: l.type || 'staple',
              order: l.order || 'front',
              anchor: l.anchor || 'top',
              responsive: Boolean(l.responsive),
              url: `https://cdn.discordapp.com/media/v1/collectibles-shop/${pfObj.id}/${l.id}/static`
            }));
          const patchTarget = (obj) => {
            if (!obj) return;
            obj.innerWidth = Number(item.inner_width ?? item.innerWidth ?? 1200) || 1200;
            obj.overflowTop = Number(item.overflow_top ?? item.overflowTop ?? 304) || 0;
            obj.overflowBottom = Number(item.overflow_bottom ?? item.overflowBottom ?? 212) || 0;
            obj.overflowHorizontal = Number(item.overflow_horizontal ?? item.overflowHorizontal ?? 56) || 0;
            if (layerDefs.length) {
              obj.layerDefs = layerDefs;
              obj.layers = layerDefs.map((l) => l.url);
            }
          };
          patchTarget(pfObj);
          patchTarget(CP_PROFILE_FRAMES.find((f) => f.id === pfObj.id));
          try { cpApplyDomBadges(true); } catch {}
        })
        .catch(() => {});
    }
    const pfLayers = pfObj?.layers?.length ? pfObj.layers : (pfObj?.img ? [pfObj.img] : []);
    const pfLayerDefs = Array.isArray(pfObj?.layerDefs) && pfObj.layerDefs.length
      ? pfObj.layerDefs
      : pfLayers.map((url) => ({ url, type: 'staple', order: 'front', anchor: 'top', responsive: false }));
    const pfIsCss = Boolean(pfObj && !pfLayers.length && pfObj.c1);
    if (pfLayers.length || pfIsCss) {
      const pfSig = pfIsCss
        ? `${d.profileFrameId}|css:${pfObj.c1}:${pfObj.c2}:${pfObj.c3}`
        : `${d.profileFrameId}|iw:${pfObj.innerWidth || 0}|${pfLayerDefs.map((l) => l.url).join(',')}`;
      getMyProfileCards().forEach((card) => {
        if (!pfIsCss && card.querySelector('[class*="profileFrame"]:not(.dc-cp-pf-ov)')) {
          card.querySelector('.dc-cp-pf-ov')?.remove();
          card.querySelector('.dc-cp-pf-ov-back')?.remove();
          return;
        }
        let targetCard = card;
        if (card.clientWidth > 420) {
          const ban = card.querySelector('[class*="bannerSVGWrapper"],[class*="banner_"],[class*="profileHeader"],[class*="header_"]');
          let cur = ban ? ban.parentElement : null;
          while (cur && cur !== card) {
            if (cur.clientWidth >= 220 && cur.clientWidth <= 420 && cur.clientHeight >= 180) {
              targetCard = cur;
            }
            cur = cur.parentElement;
          }
          if (targetCard !== card) {
            Array.from(card.children)
              .filter((ch) => ch.classList?.contains('dc-cp-pf-ov') || ch.classList?.contains('dc-cp-pf-ov-back'))
              .forEach((ch) => ch.remove());
          }
        }
        if (getComputedStyle(targetCard).position === 'static') targetCard.style.position = 'relative';
        if (!pfIsCss && getComputedStyle(targetCard).overflow === 'hidden') targetCard.style.overflow = 'visible';
        let ov = Array.from(targetCard.children).find((ch) => ch.classList?.contains('dc-cp-pf-ov'));
        if (!ov) {
          ov = document.createElement('div');
          ov.className = 'dc-cp-pf-ov';
          targetCard.appendChild(ov);
        }
        let ovBack = Array.from(targetCard.children).find((ch) => ch.classList?.contains('dc-cp-pf-ov-back'));
        if (!ovBack) {
          ovBack = document.createElement('div');
          ovBack.className = 'dc-cp-pf-ov-back';
          targetCard.insertBefore(ovBack, targetCard.firstChild);
        }
        if (pfIsCss) {
          ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:13;border-radius:inherit';
          ovBack.style.display = 'none';
        } else {
          const iw = Number(pfObj.innerWidth) || 0;
          const cw = targetCard.clientWidth || 300;
          const sc = iw > 0 ? cw / iw : 1;
          const ot = iw > 0 ? Math.round((Number(pfObj.overflowTop) || 0) * sc) : Math.round(cw * 0.25);
          const ob = iw > 0 ? Math.round((Number(pfObj.overflowBottom) || 0) * sc) : Math.round(cw * 0.17);
          const oh = iw > 0 ? Math.round((Number(pfObj.overflowHorizontal) || 0) * sc) : Math.round(cw * 0.047);
          ov.style.cssText = `position:absolute;top:${-ot}px;bottom:${-ob}px;left:${-oh}px;right:${-oh}px;overflow:visible;pointer-events:none;z-index:13;border-radius:inherit`;
          ovBack.style.cssText = `position:absolute;top:${-ot}px;bottom:${-ob}px;left:${-oh}px;right:${-oh}px;overflow:visible;pointer-events:none;z-index:0;border-radius:inherit`;
        }
        if (ov.dataset.dcPfSig !== pfSig) {
          ov.dataset.dcPfSig = pfSig;
          if (pfIsCss) {
            setHTML(
              ov,
              `<div class="dc-cp-pf-css${pfObj.rgb ? ' rgb' : ''}" style="--dc-pf-c1:${esc(pfObj.c1)};--dc-pf-c2:${esc(pfObj.c2 || pfObj.c1)};--dc-pf-c3:${esc(pfObj.c3 || pfObj.c1)};--dc-pf-glow:${esc(pfObj.glow || 'rgba(139,92,246,.45)')}"></div>`
            );
            setHTML(ovBack, '');
          } else {
            const renderLayer = (l) => {
              const posStyle =
                l.type === 'rail'
                  ? `position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:${l.anchor === 'bottom' ? 'bottom' : l.anchor === 'top' ? 'top' : 'center'} center;display:block;pointer-events:none`
                  : l.anchor === 'bottom'
                    ? 'position:absolute;bottom:0;left:0;width:100%;height:auto;display:block;pointer-events:none'
                    : 'position:absolute;top:0;left:0;width:100%;height:auto;display:block;pointer-events:none';
              return /\.webm(\?|$)|\.mp4(\?|$)/i.test(l.url)
                ? `<video src="${esc(l.url)}" autoplay loop muted playsinline style="${posStyle}"></video>`
                : `<img src="${esc(l.url)}" alt="" style="${posStyle}">`;
            };
            const frontHtml = pfLayerDefs.filter((l) => l.order !== 'back').map(renderLayer).join('');
            const backHtml = pfLayerDefs.filter((l) => l.order === 'back').map(renderLayer).join('');
            setHTML(ov, frontHtml);
            setHTML(ovBack, backHtml);
          }
        }
      });
    } else {
      document.querySelectorAll('.dc-cp-pf-ov,.dc-cp-pf-ov-back').forEach((el) => el.remove());
    }

    const npObj = d.nameplateId ? (cpDynamicNameplates || []).find((n) => n.id === d.nameplateId) : null;
    if (npObj && (npObj.animUrl || npObj.img)) {
      const npSig = `${npObj.id}|${npObj.animUrl || npObj.img}`;
      const seenNpRows = new Set();
      document.querySelectorAll(`img[src*="/avatars/${myId}/"],img[src*="/users/${myId}/avatars/"],img[data-dc-cf-uid="${myId}"]`).forEach((av) => {
        if (av.closest('#dc-cp-modal,#dc-cf-modal,#dc-settings-embedded')) return;
        const row =
          av.closest('[class*="member_"],[class*="voiceUser_"]') ||
          av.closest('[class*="panels_"] > [class*="container_"],[class*="panels_"] [class*="avatarWrapper_"]')?.closest('[class*="container_"]');
        if (!row || seenNpRows.has(row)) return;
        if (row.clientWidth < 100 || row.clientHeight < 28 || row.clientHeight > 90) return;
        seenNpRows.add(row);
        let bg = row.querySelector('.dc-cp-np-bg');
        if (!bg) {
          bg = document.createElement('div');
          bg.className = 'dc-cp-np-bg';
          bg.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;border-radius:inherit';
          if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
          row.prepend(bg);
        }
        if (bg.dataset.dcNpSig !== npSig) {
          bg.dataset.dcNpSig = npSig;
          setHTML(
            bg,
            npObj.animUrl
              ? `<video src="${esc(npObj.animUrl)}" poster="${esc(npObj.img || '')}" autoplay loop muted playsinline style="width:100%;height:100%;object-fit:cover;display:block;opacity:.92;pointer-events:none"></video>`
              : `<img src="${esc(npObj.img)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;opacity:.92;pointer-events:none">`
          );
        }
      });
    } else {
      document.querySelectorAll('.dc-cp-np-bg').forEach((el) => el.remove());
    }

    let themeC1 = d.accentColor || '';
    let themeC2 = d.accentColor2 || themeC1;
    if (!themeC1) {
      try {
        const UPS = cpFindStore('UserProfileStore', (m) => typeof m.getUserProfile === 'function' && typeof m.getGuildMemberProfile === 'function', ['getUserProfile', 'getGuildMemberProfile']);
        const tc = UPS?.getUserProfile?.(myId)?.themeColors;
        if (Array.isArray(tc) && tc.length) {
          const toHex = (n) => '#' + (Number(n) >>> 0).toString(16).padStart(6, '0').slice(-6);
          themeC1 = toHex(tc[0]);
          themeC2 = toHex(tc[1] ?? tc[0]);
        }
      } catch {}
    }
    if (themeC1) {
      getMyProfileCards().forEach((card) => {
        const isAccountMenu = Boolean(card.querySelector('[class*="menus_"],[class*="menu_"]'));
        if (!isAccountMenu) return;
        card.classList.add('dc-cp-themed-popout');
        card.style.setProperty('--dc-cp-c1', themeC1);
        card.style.setProperty('--dc-cp-c2', themeC2 || themeC1);
      });
    } else {
      document.querySelectorAll('.dc-cp-themed-popout').forEach((el) => el.classList.remove('dc-cp-themed-popout'));
    }

    function applyToBadgeBox(badgeBox, refImg) {
      const card =
        badgeBox.closest('[class*="accountProfileCard"],[class*="userPopout"],[class*="userProfile"],[class*="profilePanel"],[id^="popout_"],[role="dialog"]');
      const isMyCard =
        Boolean(badgeBox.closest('[class*="accountProfileCard"]')) ||
        Boolean(card?.querySelector(`img[src*="/avatars/${myId}/"],img[src*="/users/${myId}/avatars/"],img[data-dc-cf-uid="${myId}"]`)) ||
        (card && extractUserInfo(card)?.userId === myId) ||
        (refImg && checkFiberForMe(refImg)) ||
        checkFiberForMe(badgeBox);
      if (!isMyCard) return;

      seenBoxes.add(badgeBox);

      Array.from(badgeBox.children).forEach((ch) => {
        if (ch.classList.contains('dc-cp-dom-badges')) return;
        if (ch.dataset.dcCpOrigBadge !== '1') {
          ch.dataset.dcCpOrigBadge = '1';
          ch.dataset.dcCpOrigDisp = ch.style.display || '';
          ch.style.display = 'none';
        }
      });

      let holder = badgeBox.querySelector('.dc-cp-dom-badges');
      if (!holder) {
        holder = document.createElement('span');
        holder.className = 'dc-cp-dom-badges';
        holder.style.cssText = 'display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px';
        badgeBox.appendChild(holder);
      }
      if (holder.dataset.dcCpSig !== sig) {
        holder.dataset.dcCpSig = sig;
        if (cpDomLogCount < 3) {
          cpDomLogCount++;
          log(`[CustomProfile] DOM badges applied (${badges.length}) for ${myId}`);
        }
        setHTML(
          holder,
          badges
            .map(
              (b) =>
                `<img src="${esc(b.iconUrl)}" alt="${esc(b.description)}" title="${esc(b.description)}" style="width:20px;height:20px;object-fit:contain;display:block;cursor:pointer">`
            )
            .join('')
        );
      }
    }
  }

  let cpDynamicDecos = null;
  let cpDynamicEffects = null;
  let cpDynamicNameplates = null;
  let cpDynamicFrames = null;
  let cpCatalogLoading = false;
  let cpCatalogFetchedApi = false;
  let cpStoresLogged = false;
  const cpCatalogWaiters = [];

  const cpNameplateUrl = (asset, animated = false) => {
    const s = String(asset || '').trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    const base = s.endsWith('/') ? s : `${s}/`;
    return `https://cdn.discordapp.com/assets/collectibles/${base}${animated ? 'asset.webm' : 'static.png'}`;
  };

  function cpInstallShopTap(onCaptured) {
    try {
      const rest = getRestApi();
      if (rest && typeof rest.get === 'function' && !rest._dc_cp_shop_tap) {
        const origGet = rest.get.bind(rest);
        rest.get = function (req, ...restArgs) {
          const p = origGet(req, ...restArgs);
          try {
            const url = String(typeof req === 'string' ? req : req?.url || '');
            if (/\/collectibles|\/shop|profile-frame/i.test(url) && p && typeof p.then === 'function') {
              p.then((res) => {
                if (res?.body && typeof onCaptured === 'function') onCaptured(res.body, url);
              }).catch(() => {});
            }
          } catch {}
          return p;
        };
        rest._dc_cp_shop_tap = true;
      }
    } catch {}
  }

  async function cpLoadDiscordCollectibles(onDone, force = false) {
    if (typeof onDone === 'function') cpCatalogWaiters.push(onDone);
    if (!force && cpCatalogFetchedApi && cpDynamicDecos && cpDynamicEffects && cpDynamicNameplates && cpDynamicFrames) {
      while (cpCatalogWaiters.length) {
        try { cpCatalogWaiters.shift()(); } catch {}
      }
      return;
    }
    if (cpCatalogLoading) return;
    cpCatalogLoading = true;
    const decoMap = new Map((cpDynamicDecos || CP_AVATAR_DECORATIONS.map((d) => ({ ...d, img: cpDecorationUrl(d.id, true) }))).map((d) => [d.id, d]));
    const effMap = new Map((cpDynamicEffects || CP_PROFILE_EFFECTS).map((e) => [e.id, { ...e }]));
    const npMap = new Map((cpDynamicNameplates || []).map((n) => [n.id, { ...n }]));
    const pfMap = new Map((cpDynamicFrames || []).filter((f) => !f.c1).map((f) => [f.id, { ...f }]));
    try {
      const addDeco = (id, label, asset) => {
        const key = String(asset || id || '').trim();
        if (!key || decoMap.has(key)) return;
        const img = asset && (String(asset).startsWith('a_') || !/^\d+$/.test(String(asset)))
          ? `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=96&passthrough=true`
          : cpDecorationUrl(key, true);
        decoMap.set(key, { id: key, label: label || key, img });
      };
      const addEff = (id, label, img, layers, staticImg) => {
        const key = String(id || '').trim();
        if (!key) return;
        const cleanLayers = Array.isArray(layers) ? layers.filter(Boolean) : (layers ? [layers] : []);
        const prev = effMap.get(key);
        if (prev) {
          if (img && !prev.img) prev.img = img;
          if (staticImg && !prev.staticImg) prev.staticImg = staticImg;
          if (cleanLayers.length && (!prev.layers || !prev.layers.length)) prev.layers = cleanLayers;
          return;
        }
        effMap.set(key, {
          id: key,
          label: label || key,
          img: img || '',
          staticImg: staticImg || '',
          layers: cleanLayers.length ? cleanLayers : (img ? [img] : [])
        });
      };
      const addNameplate = (id, label, asset, palette, thumb) => {
        const key = String(id || asset || '').trim();
        if (!key) return;
        const cleanAsset = String(asset || '').trim();
        const staticImg = thumb || cpNameplateUrl(cleanAsset, false);
        const animUrl = cpNameplateUrl(cleanAsset, true);
        if (npMap.has(key)) return;
        npMap.set(key, {
          id: key,
          label: label || key,
          asset: cleanAsset,
          palette: palette || 'sky',
          img: staticImg,
          animUrl
        });
      };
      const addFrame = (id, label, img, layers, staticImg, asset, meta) => {
        const key = String(id || '').trim();
        if (!key) return;
        const cleanLayers = Array.isArray(layers) ? layers.filter(Boolean) : (layers ? [layers] : []);
        const fallbackImg = img || staticImg || (asset ? cpDecorationUrl(asset, true) : '');
        const prev = pfMap.get(key);
        if (prev) {
          if (fallbackImg && !prev.img) prev.img = fallbackImg;
          if (staticImg && !prev.staticImg) prev.staticImg = staticImg;
          if (cleanLayers.length && (!prev.layers || !prev.layers.length)) prev.layers = cleanLayers;
          if (meta) Object.assign(prev, meta);
          return;
        }
        pfMap.set(key, {
          id: key,
          label: label || key,
          asset: asset || '',
          img: fallbackImg,
          staticImg: staticImg || fallbackImg,
          layers: cleanLayers.length ? cleanLayers : (fallbackImg ? [fallbackImg] : []),
          ...(meta || {})
        });
      };
      const extractFrameObj = (it, parentName, parentPr) => {
        const sku = String(it.sku_id || it.skuId || it.id || parentPr?.sku_id || parentPr?.skuId || '').trim();
        if (!sku) return;
        const rawLayers = Array.isArray(it.layers)
          ? it.layers
          : (Array.isArray(it.effects) ? it.effects : (Array.isArray(it.frame_effects) ? it.frame_effects : []));
        const layerUrls = rawLayers
          .map((l) => l?.src || l?.url || (l?.id ? cpDecorationUrl(l.id, true) : ''))
          .filter(Boolean);
        const staticThumb =
          it.assets?.static_image_url ||
          it.assets?.static ||
          it.reduced_motion_src ||
          it.reducedMotionSrc ||
          it.static_src ||
          (rawLayers[0]?.id ? cpDecorationUrl(rawLayers[0].id, false, 64) : '') ||
          cpDecorationUrl(sku, false, 96);
        const thumb =
          it.assets?.animated_image_url ||
          it.assets?.animated ||
          it.thumbnail_preview_src ||
          it.thumbnailPreviewSrc ||
          staticThumb ||
          (it.asset ? cpNameplateUrl(it.asset, false) : '') ||
          cpDecorationUrl(sku, true);
        const finalLayers = layerUrls.length ? layerUrls : (thumb ? [thumb] : []);
        addFrame(
          sku,
          parentName || it.title || it.label || it.name || sku,
          thumb,
          finalLayers,
          staticThumb,
          it.asset || '',
          {
            innerWidth: it.inner_width ?? it.innerWidth ?? 0,
            overflowTop: it.overflow_top ?? it.overflowTop ?? 0,
            overflowBottom: it.overflow_bottom ?? it.overflowBottom ?? 0,
            overflowHorizontal: it.overflow_horizontal ?? it.overflowHorizontal ?? 0,
            rawConfig: it
          }
        );
      };
      let loggedEffSample = false;
      let loggedPfSample = false;
      const loggedTypes = new Set();
      const ingestProduct = (pr) => {
        if (!pr || typeof pr !== 'object') return;
        const prType = pr.type;
        const items = Array.isArray(pr.items) ? pr.items : [];
        if ((prType === 3 || prType === 'PROFILE_FRAME') && !items.length && (pr.sku_id || pr.skuId || pr.id)) {
          extractFrameObj(pr, pr.name || pr.title, pr);
        }
        for (const it of items) {
          if (!it || typeof it !== 'object') continue;
          const t = it?.type ?? prType;
          const assetStr = String(it?.asset || '');
          if (t === 2 || t === 'NAMEPLATE' || assetStr.includes('nameplate')) {
            addNameplate(it.sku_id || it.skuId || it.id || pr.sku_id || pr.skuId, pr.name || it.label || it.name, it.asset, it.palette, it.thumbnail_preview_src || it.thumbnailPreviewSrc);
          } else if (
            t === 3 ||
            t === 4 ||
            t === 'PROFILE_FRAME' ||
            prType === 3 ||
            prType === 'PROFILE_FRAME' ||
            assetStr.includes('profile_frame') ||
            assetStr.includes('frames/') ||
            it?.frame_effects ||
            it?.profile_frame ||
            it?.inner_width !== undefined ||
            it?.innerWidth !== undefined ||
            it?.overflow_top !== undefined ||
            it?.overflowTop !== undefined ||
            Array.isArray(it?.layers)
          ) {
            if (!loggedPfSample) {
              loggedPfSample = true;
              log('[CP-PF-SAMPLE] prType=' + prType + ' itType=' + it?.type + ' keys=' + Object.keys(it).join(',') + ' layers=' + (Array.isArray(it.layers) ? it.layers.length : 0));
            }
            extractFrameObj(it, pr.name, pr);
          } else if ((t === 0 || t === undefined) && it?.asset && !assetStr.includes('/')) {
            addDeco(it.sku_id || it.skuId || it.id, pr.name || it.label, it.asset);
          } else if (t === 1 || it?.title) {
            if (!loggedEffSample) {
              loggedEffSample = true;
              log('[CP-EFF-SAMPLE] keys=' + Object.keys(it).join(',') + ' effectsLen=' + (Array.isArray(it.effects) ? it.effects.length : 0));
            }
            const rawLayers = Array.isArray(it.effects) ? it.effects : [];
            const loopLayers = rawLayers.filter((l) => l?.src && l.loop === true).map((l) => l.src);
            const fallbackLayers = rawLayers.length ? [rawLayers[rawLayers.length - 1]?.src].filter(Boolean) : [];
            const staticThumb = it.reduced_motion_src || it.reducedMotionSrc || '';
            const thumb = it.thumbnail_preview_src || it.thumbnailPreviewSrc || staticThumb;
            const finalLayers = loopLayers.length ? loopLayers : (fallbackLayers.length ? fallbackLayers : (thumb ? [thumb] : []));
            const effId = String(it.sku_id || it.skuId || it.id || '').trim();
            addEff(effId, pr.name || it.title, thumb, finalLayers, staticThumb);
            if (it.id && String(it.id) !== effId && effMap.has(String(it.id))) {
              addEff(String(it.id), pr.name || it.title, thumb, finalLayers, staticThumb);
            }
          } else if (t !== undefined && t !== 0 && !loggedTypes.has(t)) {
            loggedTypes.add(t);
            log(`[CP-ITEM-TYPE] type=${t} keys=${Object.keys(it).join(',')}`);
          }
        }
        for (const bp of pr.bundled_products || pr.bundledProducts || []) ingestProduct(bp);
        for (const vr of pr.variants || []) ingestProduct(vr);
      };

      const walkSeen = new WeakSet();
      const ingestAnyNode = (node, depth = 0) => {
        if (!node || typeof node !== 'object' || depth > 7) return;
        if (walkSeen.has(node)) return;
        walkSeen.add(node);
        if (node instanceof Map) {
          for (const v of node.values()) ingestAnyNode(v, depth + 1);
          return;
        }
        if (node instanceof Set || Array.isArray(node)) {
          for (const v of node) ingestAnyNode(v, depth + 1);
          return;
        }
        if (Array.isArray(node.items) || Array.isArray(node.bundled_products) || Array.isArray(node.bundledProducts) || Array.isArray(node.variants)) {
          ingestProduct(node);
        }
        if (
          node.type === 3 ||
          node.type === 4 ||
          node.type === 'PROFILE_FRAME' ||
          Array.isArray(node.layers) ||
          node.overflow_top !== undefined ||
          node.overflowTop !== undefined ||
          node.inner_width !== undefined ||
          node.innerWidth !== undefined
        ) {
          if (!loggedPfSample) {
            loggedPfSample = true;
            log('[CP-PF-NODE] keys=' + Object.keys(node).join(','));
          }
          extractFrameObj(node, node.name || node.title || node.label, node);
        }
        for (const k of [
          'categories',
          'collections',
          'skus',
          'products',
          'shop_blocks',
          'shopBlocks',
          'blocks',
          'cards',
          'results',
          'shop_home_sections',
          'featured_products',
          'featuredProducts',
          'profile_frame_configs',
          'profileFrames',
          'profile_frame',
          'profileFrame',
          'records',
          'data',
          'items'
        ]) {
          if (node[k] && typeof node[k] === 'object') ingestAnyNode(node[k], depth + 1);
        }
      };

      cpInstallShopTap((body) => {
        const before = pfMap.size;
        ingestAnyNode(body);
        if (pfMap.size > before) {
          const mergedPf = new Map(CP_PROFILE_FRAMES.map((f) => [f.id, { ...f }]));
      for (const [k, v] of pfMap.entries()) mergedPf.set(k, v);
      cpDynamicFrames = Array.from(mergedPf.values());
          log(`[CustomProfile] Captured ${pfMap.size} Discord profile frame(s) from live shop fetch`);
        }
      });

      // 0) Direct Main-Process authenticated fetch
      try {
        const ipcRes = await window.DreamCordNative?.getCollectibles?.(getAuthToken());
        if (ipcRes?.ok) {
          for (const fr of ipcRes.frames || []) extractFrameObj(fr, fr.title || fr.label || fr.name, fr);
          for (const ef of ipcRes.effects || []) {
            const rawLayers = Array.isArray(ef.effects) ? ef.effects : [];
            const loopLayers = rawLayers.filter((l) => l?.src && l.loop === true).map((l) => l.src);
            const fallbackLayers = rawLayers.length ? [rawLayers[rawLayers.length - 1]?.src].filter(Boolean) : [];
            const staticThumb = ef.reducedMotionSrc || ef.reduced_motion_src || '';
            const fallbackSrc = staticThumb || ef.thumbnailPreviewSrc || ef.thumbnail_preview_src;
            const finalLayers = loopLayers.length ? loopLayers : (fallbackLayers.length ? fallbackLayers : (fallbackSrc ? [fallbackSrc] : []));
            const thumb = ef.thumbnailPreviewSrc || ef.thumbnail_preview_src || staticThumb;
            const primaryId = String(ef.sku_id || ef.id || '').trim();
            addEff(primaryId, ef.title || ef.name, thumb, finalLayers, staticThumb);
            if (ef.id && String(ef.id) !== primaryId && effMap.has(String(ef.id))) {
              addEff(String(ef.id), ef.title || ef.name, thumb, finalLayers, staticThumb);
            }
          }
          ingestAnyNode(ipcRes.categories);
          if ((ipcRes.effects?.length || 0) > 0 || (ipcRes.categories?.length || 0) > 0 || (ipcRes.frames?.length || 0) > 0) {
            cpCatalogFetchedApi = true;
          }
        }
      } catch {}

      // 1) Inspect ALL Discord Webpack Stores for Collectibles / Shop / ProfileFrames
      try {
        getRestApi();
        const cache = wpReq?.c;
        const foundStoreNames = [];
        if (cache) {
          for (const id in cache) {
            try {
              const exp = cache[id]?.exports;
              if (!exp || typeof exp !== 'object') continue;
              const candidates = [exp];
              for (const k of Reflect.ownKeys(exp)) {
                try {
                  const v = exp[k];
                  if (v && typeof v === 'object') candidates.push(v);
                } catch {}
              }
              for (const m of candidates) {
                let nm = '';
                try {
                  if (typeof m.getName === 'function') nm = String(m.getName() || '');
                } catch {}
                const looksLikeShop =
                  /collectible|shop|frame|nameplate|deco/i.test(nm) ||
                  typeof m.getProfileFrames === 'function' ||
                  typeof m.getProfileFrame === 'function' ||
                  (typeof m.getCategories === 'function' && typeof m.getProduct === 'function');
                if (!looksLikeShop) continue;
                if (nm && !foundStoreNames.includes(nm)) foundStoreNames.push(nm);
                for (const fn of ['getCategories', 'getProducts', 'getAllProducts', 'getShopBlocks', 'getProfileFrames', 'getPurchases', 'getShopHomeConfig']) {
                  try {
                    if (typeof m[fn] === 'function' && m[fn].length === 0) ingestAnyNode(m[fn]());
                  } catch {}
                }
                for (const prop of ['categories', '_categories', 'products', '_products', 'shopBlocks', '_shopBlocks', 'profileFrames', '_profileFrames', 'shopHomeConfig', 'purchases', '_purchases']) {
                  try {
                    if (m[prop] && typeof m[prop] === 'object') ingestAnyNode(m[prop]);
                  } catch {}
                }
              }
            } catch {}
          }
        }
        if (!cpStoresLogged) {
          cpStoresLogged = true;
          log(`[CP-STORES] ${foundStoreNames.join(',') || 'none'} (pfFromStores=${pfMap.size})`);
        }
      } catch {}

      // 2) Direct Renderer RestAPI queries when no Discord frames found yet (works on Ctrl+R without full quit!)
      if (pfMap.size === 0 || force) {
        const rest = getRestApi();
        if (rest || getAuthToken()) {
          const paths = [
            ['tabPf', '/collectibles-shop?tab=profile-frames'],
            ['shopHome', '/collectibles-shop?include_bundles=true&variants_return_style=2'],
            ['catV2', '/collectibles-categories/v2?include_bundles=true&include_dynamic_blocks=true&variants_return_style=2'],
            ['catV1', '/collectibles-categories?include_bundles=true&variants_return_style=2'],
            ['searchPf', '/shop/search?item_types=PROFILE_FRAME&limit=100'],
            ['frames', '/user-profile-frames'],
            ['effs', !effMap.size ? '/user-profile-effects' : '']
          ].filter((x) => x[1]);
          const settled = await Promise.allSettled(paths.map(([, u]) => dcDiscordApi('GET', u, null, null, 'Shop').catch(() => null)));
          const apiLog = [];
          settled.forEach((r, idx) => {
            const val = r.status === 'fulfilled' ? r.value : null;
            const tag = paths[idx][0];
            if (!val) {
              apiLog.push(`${tag}:null`);
              return;
            }
            const before = pfMap.size;
            if (tag === 'searchPf' && Array.isArray(val?.skus) && val.skus.length) {
              const sampleSku = getCpData().profileFrameId || String(val.skus[0]);
              try { log(`[CP-SKU-SAMPLE] len=${val.skus.length} sample=${sampleSku}`); } catch {}
              dcDiscordApi('GET', `/collectibles-products/${sampleSku}`, null, null, 'ShopProd')
                .then((prod) => {
                  if (prod) {
                    try { log(`[CP-PF-PROD] ${JSON.stringify(prod).slice(0, 1400)}`); } catch {}
                  }
                })
                .catch(() => {});
            }
            ingestAnyNode(val);
            if (Array.isArray(val?.profile_effect_configs)) {
              for (const ef of val.profile_effect_configs) addEff(ef.sku_id || ef.id, ef.title || ef.name, ef.thumbnailPreviewSrc || ef.thumbnail_preview_src);
            }
            const keys = Array.isArray(val) ? `arr(${val.length})` : Object.keys(val).slice(0, 6).join('+');
            apiLog.push(`${tag}:${keys}(+${pfMap.size - before}pf)`);
            cpCatalogFetchedApi = true;
          });
          log(`[CP-API-SCAN] ${apiLog.join(' | ')}`);
        }
      }
    } finally {
      cpDynamicDecos = Array.from(decoMap.values());
      cpDynamicEffects = Array.from(effMap.values());
      cpDynamicNameplates = Array.from(npMap.values());
      const mergedPf = new Map(CP_PROFILE_FRAMES.map((f) => [f.id, { ...f }]));
      for (const [k, v] of pfMap.entries()) mergedPf.set(k, v);
      cpDynamicFrames = Array.from(mergedPf.values());
      cpCatalogLoading = false;
      log(`[CustomProfile] Catalog: decos=${cpDynamicDecos.length}, effects=${cpDynamicEffects.length}, nameplates=${cpDynamicNameplates.length}, frames=${cpDynamicFrames.length} (discord=${pfMap.size}), rest=${Boolean(cachedRestApi)}, tok=${Boolean(getAuthToken())}`);
      if (isCpActive() && (getCpData().profileEffectId || getCpData().profileFrameId || getCpData().nameplateId)) {
        try { cpApplyDomBadges(true); } catch {}
      }
      while (cpCatalogWaiters.length) {
        try { cpCatalogWaiters.shift()(); } catch {}
      }
    }
  }

  function cpGetPlatformIconUrl(platId, fallback) {
    try {
      const mod = findWebpackExport((m) => typeof m?.get === 'function' && typeof m?.isSupported === 'function');
      const p = mod?.get?.(platId);
      const ico = p?.icon;
      if (ico) return ico.lightSVG || ico.whiteSVG || ico.darkSVG || ico.png || fallback || '';
    } catch {}
    return fallback || '';
  }

  function openCustomProfileModal() {
    setStyle('dc-p-custom-profile-css', CP_CSS);
    document.getElementById('dc-cp-modal')?.remove();
    cpLoadDiscordCollectibles();
    const US = getUserStore();
    let me = US?.getCurrentUser?.();
    if (!me) {
      const myId = cpGetMyId() || '0';
      const panels = document.querySelector('[class*="panels_"]');
      const avSrc = panels?.querySelector('img[src*="/avatars/"]')?.getAttribute('src') || '';
      const avHash = avSrc.match(/\/avatars\/\d+\/([^.?/]+)/)?.[1] || '';
      const gName = panels?.querySelector('[class*="nameTag_"] [class*="title_"], [class*="panelTitleContainer_"]')?.textContent?.trim() || 'User';
      me = { id: myId, username: gName, globalName: gName, avatar: avHash };
    }
    const draft = JSON.parse(JSON.stringify(getCpData() || {}));
    if (!Array.isArray(draft.customBadgeIds)) draft.customBadgeIds = [];
    if (!Array.isArray(draft.fakeConnections)) draft.fakeConnections = [];
    if (draft.nitroLevel === undefined) draft.nitroLevel = -1;
    if (draft.boostMonths === undefined) draft.boostMonths = -1;
    if (draft.levelReached === undefined) draft.levelReached = 1;

    let activeTab = 'general';
    let selPlatform = CP_FAKE_PLATFORMS[0].id;
    let connNameInput = '';
    let decoQuery = '';
    let effQuery = '';
    let npQuery = '';
    let pfQuery = '';

    const wrap = document.createElement('div');
    wrap.id = 'dc-cp-modal';
    document.body.appendChild(wrap);

    const getMyRealAvatar = () => {
      if (draft.avatar) return draft.avatar;
      if (me.avatar && me.id) {
        return `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${String(me.avatar).startsWith('a_') ? 'gif' : 'png'}?size=128`;
      }
      return 'https://cdn.discordapp.com/embed/avatars/0.png';
    };

    const renderPreview = () => {
      const prevEl = wrap.querySelector('#dc-cp-preview');
      if (!prevEl) return;
      const uname = (draft.username || '').trim() || me.username || 'username';
      const gname = (draft.globalName || '').trim() || me.globalName || uname;
      const avUrl = getMyRealAvatar();
      const decoUrl = draft.decorationAsset ? cpDecorationUrl(draft.decorationAsset, true) : '';
      const pfObj = draft.profileFrameId ? (cpDynamicFrames || CP_PROFILE_FRAMES).find((f) => f.id === draft.profileFrameId) : null;
      const badges = cpBuildBadgesList(draft, me.id || 'self');
      if (draft.banner) {
        prevEl.style.background = `linear-gradient(90deg, rgba(9,9,11,.84) 0%, rgba(9,9,11,.52) 100%), url("${draft.banner.replace(/"/g, '\\"')}") center/cover no-repeat`;
      } else if (draft.accentColor) {
        const c1 = draft.accentColor;
        const c2 = draft.accentColor2 || c1;
        prevEl.style.background = `linear-gradient(135deg, ${c1}55 0%, ${c2}33 55%, #0e0e12 100%)`;
      } else {
        prevEl.style.background = '';
      }
      const pfOverlay = pfObj?.c1
        ? `<div class="dc-cp-pf-css${pfObj.rgb ? ' rgb' : ''}" style="--dc-pf-c1:${esc(pfObj.c1)};--dc-pf-c2:${esc(pfObj.c2 || pfObj.c1)};--dc-pf-c3:${esc(pfObj.c3 || pfObj.c1)};--dc-pf-glow:${esc(pfObj.glow || 'rgba(139,92,246,.45)')}"></div>`
        : (pfObj?.staticImg || pfObj?.img
          ? `<img src="${esc(pfObj.staticImg || pfObj.img)}" alt="" style="position:absolute;top:0;right:8px;height:100%;width:auto;max-width:45%;object-fit:contain;pointer-events:none;z-index:2;opacity:.92">`
          : '');
      setHTML(
        prevEl,
        pfOverlay +
        `<div class="dc-cp-prev-avwrap">` +
          `<img class="dc-cp-prev-av" src="${esc(avUrl)}" alt="">` +
          (decoUrl ? `<img class="dc-cp-prev-deco" src="${esc(decoUrl)}" alt="">` : '') +
        `</div>` +
        `<div class="dc-cp-prev-info">` +
          `<div class="dc-cp-prev-names">` +
            `<span class="dc-cp-prev-user">@${esc(uname)}</span>` +
            (gname && gname !== uname ? `<span class="dc-cp-prev-gname">${esc(gname)}</span>` : '') +
          `</div>` +
          (badges.length
            ? `<div class="dc-cp-prev-badges">${badges.map((b) => `<img src="${esc(b.iconUrl)}" alt="" title="${esc(b.description)}">`).join('')}</div>`
            : `<div style="font-size:11.5px;color:#71717a">${esc(L('Aucun badge sélectionné', 'No badges selected'))}</div>`) +
        `</div>`
      );
      const accImg = wrap.querySelector('#dc-cp-acc-img');
      const accLbl = wrap.querySelector('#dc-cp-acc-lbl');
      if (accImg) accImg.src = avUrl;
      if (accLbl) accLbl.textContent = gname || uname;
    };

    const PICKER_BATCH = 48;
    let decoShown = PICKER_BATCH;
    let effShown = PICKER_BATCH;
    let npShown = PICKER_BATCH;
    let pfShown = PICKER_BATCH;
    let decoSearchTimer = null;
    let effSearchTimer = null;
    let npSearchTimer = null;
    let pfSearchTimer = null;

    const appendHTML = (el, html) => {
      if (!el || !html) return;
      const tmp = document.createElement('div');
      setHTML(tmp, html);
      const frag = document.createDocumentFragment();
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      el.appendChild(frag);
    };

    const getFilteredDecos = () => {
      const allDecos = cpDynamicDecos || CP_AVATAR_DECORATIONS.map((d) => ({ ...d, img: cpDecorationUrl(d.id, false, 64) }));
      const q = decoQuery.trim().toLowerCase();
      const list = q ? allDecos.filter((d) => (d.label || '').toLowerCase().includes(q)) : allDecos;
      if (!q && draft.decorationAsset) {
        const idx = list.findIndex((d) => d.id === draft.decorationAsset);
        if (idx >= PICKER_BATCH) return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)];
      }
      return list;
    };

    const buildDecoPill = (dec) => {
      const thumb = cpDecorationUrl(dec.id, false, 64) || dec.img;
      return (
        `<button type="button" class="dc-cp-pill${draft.decorationAsset === dec.id ? ' active' : ''}" data-cp-deco="${esc(dec.id)}" title="${esc(dec.label)}">` +
        `<img src="${esc(thumb)}" loading="lazy" decoding="async" alt="" onerror="this.style.display='none'"><span>${esc(dec.label)}</span></button>`
      );
    };

    const renderDecoPills = (limit = PICKER_BATCH) => {
      decoShown = limit;
      const list = getFilteredDecos();
      const slice = list.slice(0, decoShown);
      const rem = list.length - slice.length;
      return (
        `<button type="button" class="dc-cp-pill${!draft.decorationAsset ? ' active' : ''}" data-cp-deco=""><span>✕ ${esc(L('Aucun', 'None'))}</span></button>` +
        slice.map(buildDecoPill).join('') +
        (rem > 0 ? `<button type="button" class="dc-cp-more-btn" id="dc-cp-deco-more">+ ${esc(L(`Afficher plus (${rem})`, `Show more (${rem})`))}</button>` : '')
      );
    };

    const loadMoreDecos = () => {
      const dBox = wrap.querySelector('#dc-cp-deco-pills');
      if (!dBox) return;
      const list = getFilteredDecos();
      if (decoShown >= list.length) return;
      const nextEnd = Math.min(list.length, decoShown + PICKER_BATCH);
      const chunk = list.slice(decoShown, nextEnd);
      decoShown = nextEnd;
      dBox.querySelector('#dc-cp-deco-more')?.remove();
      const rem = list.length - decoShown;
      appendHTML(
        dBox,
        chunk.map(buildDecoPill).join('') +
          (rem > 0 ? `<button type="button" class="dc-cp-more-btn" id="dc-cp-deco-more">+ ${esc(L(`Afficher plus (${rem})`, `Show more (${rem})`))}</button>` : '')
      );
    };

    const getFilteredEffs = () => {
      const allEffs = cpDynamicEffects || CP_PROFILE_EFFECTS;
      const q = effQuery.trim().toLowerCase();
      const list = q ? allEffs.filter((e) => (e.label || '').toLowerCase().includes(q)) : allEffs;
      if (!q && draft.profileEffectId) {
        const idx = list.findIndex((e) => e.id === draft.profileEffectId);
        if (idx >= PICKER_BATCH) return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)];
      }
      return list;
    };

    const buildEffPill = (eff) => {
      const thumb = eff.staticImg || eff.img;
      return (
        `<button type="button" class="dc-cp-pill${draft.profileEffectId === eff.id ? ' active' : ''}" data-cp-eff="${esc(eff.id)}">` +
        (thumb ? `<img src="${esc(thumb)}" loading="lazy" decoding="async" alt="" onerror="this.style.display='none'" style="width:18px;height:18px;border-radius:4px;object-fit:cover">` : '') +
        `<span>${esc(eff.label)}</span></button>`
      );
    };

    const renderEffPills = (limit = PICKER_BATCH) => {
      effShown = limit;
      const list = getFilteredEffs();
      const slice = list.slice(0, effShown);
      const rem = list.length - slice.length;
      return (
        `<button type="button" class="dc-cp-pill${!draft.profileEffectId ? ' active' : ''}" data-cp-eff=""><span>✕ ${esc(L('Aucun', 'None'))}</span></button>` +
        slice.map(buildEffPill).join('') +
        (rem > 0 ? `<button type="button" class="dc-cp-more-btn" id="dc-cp-eff-more">+ ${esc(L(`Afficher plus (${rem})`, `Show more (${rem})`))}</button>` : '')
      );
    };

    const loadMoreEffs = () => {
      const eBox = wrap.querySelector('#dc-cp-eff-pills');
      if (!eBox) return;
      const list = getFilteredEffs();
      if (effShown >= list.length) return;
      const nextEnd = Math.min(list.length, effShown + PICKER_BATCH);
      const chunk = list.slice(effShown, nextEnd);
      effShown = nextEnd;
      eBox.querySelector('#dc-cp-eff-more')?.remove();
      const rem = list.length - effShown;
      appendHTML(
        eBox,
        chunk.map(buildEffPill).join('') +
          (rem > 0 ? `<button type="button" class="dc-cp-more-btn" id="dc-cp-eff-more">+ ${esc(L(`Afficher plus (${rem})`, `Show more (${rem})`))}</button>` : '')
      );
    };

    const bindPickerScroll = () => {
      const dBox = wrap.querySelector('#dc-cp-deco-pills');
      const eBox = wrap.querySelector('#dc-cp-eff-pills');
      if (dBox && !dBox.dataset.dcScrollBound) {
        dBox.dataset.dcScrollBound = '1';
        dBox.addEventListener('scroll', () => {
          if (dBox.scrollTop + dBox.clientHeight >= dBox.scrollHeight - 100) loadMoreDecos();
        }, { passive: true });
      }
      if (eBox && !eBox.dataset.dcScrollBound) {
        eBox.dataset.dcScrollBound = '1';
        eBox.addEventListener('scroll', () => {
          if (eBox.scrollTop + eBox.clientHeight >= eBox.scrollHeight - 100) loadMoreEffs();
        }, { passive: true });
      }
      const nBox = wrap.querySelector('#dc-cp-np-pills');
      if (nBox && !nBox.dataset.dcScrollBound) {
        nBox.dataset.dcScrollBound = '1';
        nBox.addEventListener('scroll', () => {
          if (nBox.scrollTop + nBox.clientHeight >= nBox.scrollHeight - 100) loadMoreNps();
        }, { passive: true });
      }
      const pBox = wrap.querySelector('#dc-cp-pf-pills');
      if (pBox && !pBox.dataset.dcScrollBound) {
        pBox.dataset.dcScrollBound = '1';
        pBox.addEventListener('scroll', () => {
          if (pBox.scrollTop + pBox.clientHeight >= pBox.scrollHeight - 100) loadMorePfs();
        }, { passive: true });
      }
    };

    const filterCollectibleList = (items, query, selectedId) => {
      const q = query.trim().toLowerCase();
      const list = q ? items.filter((x) => (x.label || '').toLowerCase().includes(q)) : items;
      if (!q && selectedId) {
        const idx = list.findIndex((x) => x.id === selectedId);
        if (idx >= PICKER_BATCH) return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)];
      }
      return list;
    };

    const buildCollectiblePill = (item, activeId, attr, moreStyle = 'width:18px;height:18px;border-radius:4px;object-fit:cover') => {
      const thumb = item.staticImg || item.img;
      const swatch = !thumb && item.c1
        ? `<span class="dc-cp-pf-swatch" style="--dc-pf-c1:${esc(item.c1)};--dc-pf-c2:${esc(item.c2 || item.c1)};--dc-pf-c3:${esc(item.c3 || item.c1)}"></span>`
        : '';
      return (
        `<button type="button" class="dc-cp-pill${activeId === item.id ? ' active' : ''}" data-cp-${attr}="${esc(item.id)}">` +
        (thumb ? `<img src="${esc(thumb)}" loading="lazy" decoding="async" alt="" onerror="this.style.display='none'" style="${moreStyle}">` : swatch) +
        `<span>${esc(item.label)}</span></button>`
      );
    };

    const renderNpPills = (limit = PICKER_BATCH) => {
      npShown = limit;
      const list = filterCollectibleList(cpDynamicNameplates || [], npQuery, draft.nameplateId);
      const slice = list.slice(0, npShown);
      const rem = list.length - slice.length;
      return (
        `<button type="button" class="dc-cp-pill${!draft.nameplateId ? ' active' : ''}" data-cp-np=""><span>✕ ${esc(L('Aucun', 'None'))}</span></button>` +
        slice.map((np) => buildCollectiblePill(np, draft.nameplateId, 'np', 'width:32px;height:18px;border-radius:4px;object-fit:cover')).join('') +
        (rem > 0 ? `<button type="button" class="dc-cp-more-btn" id="dc-cp-np-more">+ ${esc(L(`Afficher plus (${rem})`, `Show more (${rem})`))}</button>` : '')
      );
    };

    const loadMoreNps = () => {
      const nBox = wrap.querySelector('#dc-cp-np-pills');
      if (!nBox) return;
      const list = filterCollectibleList(cpDynamicNameplates || [], npQuery, draft.nameplateId);
      if (npShown >= list.length) return;
      const nextEnd = Math.min(list.length, npShown + PICKER_BATCH);
      const chunk = list.slice(npShown, nextEnd);
      npShown = nextEnd;
      nBox.querySelector('#dc-cp-np-more')?.remove();
      const rem = list.length - npShown;
      appendHTML(
        nBox,
        chunk.map((np) => buildCollectiblePill(np, draft.nameplateId, 'np', 'width:32px;height:18px;border-radius:4px;object-fit:cover')).join('') +
          (rem > 0 ? `<button type="button" class="dc-cp-more-btn" id="dc-cp-np-more">+ ${esc(L(`Afficher plus (${rem})`, `Show more (${rem})`))}</button>` : '')
      );
    };

    const renderPfPills = (limit = PICKER_BATCH) => {
      pfShown = limit;
      const list = filterCollectibleList(cpDynamicFrames || CP_PROFILE_FRAMES, pfQuery, draft.profileFrameId);
      const slice = list.slice(0, pfShown);
      const rem = list.length - slice.length;
      return (
        `<button type="button" class="dc-cp-pill${!draft.profileFrameId ? ' active' : ''}" data-cp-pf=""><span>✕ ${esc(L('Aucun', 'None'))}</span></button>` +
        slice.map((pf) => buildCollectiblePill(pf, draft.profileFrameId, 'pf')).join('') +
        (rem > 0 ? `<button type="button" class="dc-cp-more-btn" id="dc-cp-pf-more">+ ${esc(L(`Afficher plus (${rem})`, `Show more (${rem})`))}</button>` : '')
      );
    };

    const loadMorePfs = () => {
      const pBox = wrap.querySelector('#dc-cp-pf-pills');
      if (!pBox) return;
      const list = filterCollectibleList(cpDynamicFrames || CP_PROFILE_FRAMES, pfQuery, draft.profileFrameId);
      if (pfShown >= list.length) return;
      const nextEnd = Math.min(list.length, pfShown + PICKER_BATCH);
      const chunk = list.slice(pfShown, nextEnd);
      pfShown = nextEnd;
      pBox.querySelector('#dc-cp-pf-more')?.remove();
      const rem = list.length - pfShown;
      appendHTML(
        pBox,
        chunk.map((pf) => buildCollectiblePill(pf, draft.profileFrameId, 'pf')).join('') +
          (rem > 0 ? `<button type="button" class="dc-cp-more-btn" id="dc-cp-pf-more">+ ${esc(L(`Afficher plus (${rem})`, `Show more (${rem})`))}</button>` : '')
      );
    };

    const renderBody = () => {
      const bodyEl = wrap.querySelector('#dc-cp-body');
      if (!bodyEl) return;
      wrap.querySelectorAll('.dc-cp-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === activeTab));

      if (activeTab === 'general') {
        setHTML(
          bodyEl,
          `<div class="dc-cp-tcard">` +
            `<div><div class="dc-cp-tcard-ttl">${esc(L('Partager mon profil personnalisé', 'Share my Custom Profile'))}</div>` +
            `<div class="dc-cp-tcard-sub">${esc(L('Permet aux autres utilisateurs de voir votre profil personnalisé et vous permet de voir le leur', 'Lets other users see your Custom Profile, and lets you see theirs'))}</div></div>` +
            `${sw(Boolean(draft.shareProfile), 'id="dc-cp-share-sw"')}` +
          `</div>` +
          `<div class="dc-cp-warn">` +
            `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>` +
            `<span>${esc(L('Cela nécessite une autorisation Discord. Une fois activé, toutes les personnes utilisant le client pourront voir votre profil personnalisé et vous pourrez voir le leur.', 'This requires Discord authorization. Once enabled, everyone using the client will be able to see your Custom Profile, and you will be able to see theirs.'))}</span>` +
          `</div>` +
          `<div><label class="dc-cp-lbl">${esc(L("NOM D'UTILISATEUR", 'USERNAME'))}</label>` +
          `<input class="dc-cp-in" data-cp-k="username" placeholder="${esc(me.username || 'my_username_00')}" value="${esc(draft.username ?? me.username ?? '')}"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L("NOM D'AFFICHAGE", 'DISPLAY NAME'))}</label>` +
          `<input class="dc-cp-in" data-cp-k="globalName" placeholder="${esc(me.globalName || 'My Name')}" value="${esc(draft.globalName ?? me.globalName ?? '')}"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('BIOGRAPHIE', 'BIO'))}</label>` +
          `<input class="dc-cp-in" data-cp-k="bio" placeholder="${esc(L('Mon descriptif...', 'My description...'))}" value="${esc(draft.bio || '')}"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('PRONOMS', 'PRONOUNS'))}</label>` +
          `<input class="dc-cp-in" data-cp-k="pronouns" placeholder="${esc(L('il/lui', 'he/him'))}" value="${esc(draft.pronouns || '')}"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('DATE DE CRÉATION DU COMPTE', 'ACCOUNT CREATION DATE'))}</label>` +
          `<input class="dc-cp-in" type="date" data-cp-k="createdAt" value="${esc(draft.createdAt || '')}" style="color-scheme:dark"></div>` +
          `<div style="height:1px;background:rgba(255,255,255,.07);margin:2px 0"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('ADRESSE E-MAIL (AFFICHAGE LOCAL)', 'EMAIL ADDRESS (LOCAL DISPLAY)'))}</label>` +
          `<input class="dc-cp-in" data-cp-k="email" placeholder="exemple@mail.com" value="${esc(draft.email || '')}"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('TÉLÉPHONE (AFFICHAGE LOCAL)', 'PHONE (LOCAL DISPLAY)'))}</label>` +
          `<input class="dc-cp-in" data-cp-k="phone" placeholder="+33 6 00 00 00 00" value="${esc(draft.phone || '')}"></div>`
        );
        return;
      }

      if (activeTab === 'aesthetics') {
        setHTML(
          bodyEl,
          `<div class="dc-cp-tcard">` +
            `<div><div class="dc-cp-tcard-ttl">${esc(L('Simuler Nitro', 'Simulate Nitro'))}</div>` +
            `<div class="dc-cp-tcard-sub">${esc(L('Active la bannière et les décorations Nitro', 'Enables banner and Nitro decorations'))}</div></div>` +
            `${sw(Boolean(draft.nitro), 'id="dc-cp-nitro-sw"')}` +
          `</div>` +
          `<div><label class="dc-cp-lbl">${esc(L('PHOTO DE PROFIL', 'PROFILE PICTURE'))}</label>` +
          `<div class="dc-cp-img-card">` +
            `<input class="dc-cp-in" id="dc-cp-av-url" data-cp-k="avatar" placeholder="${esc(L("Collez l'URL d'une image...", 'Paste an image URL...'))}" value="${esc((draft.avatar || '').startsWith('data:') ? '' : draft.avatar || '')}">` +
            `<div style="display:flex;gap:8px;align-items:center">` +
              `<button type="button" class="dc-cp-browse-btn" id="dc-cp-av-pick"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"/></svg><span>${esc(L('Parcourir', 'Browse'))}</span></button>` +
              (draft.avatar ? `<button type="button" class="dc-cp-browse-btn" id="dc-cp-av-clr" style="color:#ed4245">✕</button>` : '') +
            `</div>` +
          `</div><input type="file" id="dc-cp-av-file" accept="image/*" style="display:none"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('BANNIÈRE', 'BANNER'))}</label>` +
          `<div class="dc-cp-img-card">` +
            `<input class="dc-cp-in" id="dc-cp-ban-url" data-cp-k="banner" placeholder="${esc(L("Collez l'URL d'une image...", 'Paste an image URL...'))}" value="${esc((draft.banner || '').startsWith('data:') ? '' : draft.banner || '')}">` +
            `<div style="display:flex;gap:8px;align-items:center">` +
              `<button type="button" class="dc-cp-browse-btn" id="dc-cp-ban-pick"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"/></svg><span>${esc(L('Parcourir', 'Browse'))}</span></button>` +
              (draft.banner ? `<button type="button" class="dc-cp-browse-btn" id="dc-cp-ban-clr" style="color:#ed4245">✕</button>` : '') +
            `</div>` +
          `</div><input type="file" id="dc-cp-ban-file" accept="image/*" style="display:none"></div>`
        );
        return;
      }

      if (activeTab === 'badges') {
        cpLoadDiscordCollectibles(() => {
          if (activeTab === 'badges' && document.body.contains(wrap)) {
            const dBox = wrap.querySelector('#dc-cp-deco-pills');
            const eBox = wrap.querySelector('#dc-cp-eff-pills');
            const nBox = wrap.querySelector('#dc-cp-np-pills');
            const pBox = wrap.querySelector('#dc-cp-pf-pills');
            const dCnt = wrap.querySelector('#dc-cp-deco-cnt');
            const eCnt = wrap.querySelector('#dc-cp-eff-cnt');
            const nCnt = wrap.querySelector('#dc-cp-np-cnt');
            const pCnt = wrap.querySelector('#dc-cp-pf-cnt');
            if (dBox) setHTML(dBox, renderDecoPills());
            if (eBox) setHTML(eBox, renderEffPills());
            if (nBox) setHTML(nBox, renderNpPills());
            if (pBox) setHTML(pBox, renderPfPills());
            if (dCnt && cpDynamicDecos) dCnt.textContent = `(${cpDynamicDecos.length})`;
            if (eCnt && cpDynamicEffects) eCnt.textContent = `(${cpDynamicEffects.length})`;
            if (nCnt && cpDynamicNameplates) nCnt.textContent = `(${cpDynamicNameplates.length})`;
            if (pCnt && cpDynamicFrames) pCnt.textContent = `(${cpDynamicFrames.length})`;
            bindPickerScroll();
          }
        });
        const flags = Number(draft.badgeFlags) || 0;
        const cIds = draft.customBadgeIds || [];
        const hasOldName = cIds.includes('oldname');
        const hasLevel = cIds.includes('gifting_level');
        const decoCount = (cpDynamicDecos || CP_AVATAR_DECORATIONS).length;
        const effCount = (cpDynamicEffects || CP_PROFILE_EFFECTS).length;
        const npCount = (cpDynamicNameplates || []).length;
        const pfCount = (cpDynamicFrames || CP_PROFILE_FRAMES).length;
        setHTML(
          bodyEl,
          `<div><label class="dc-cp-lbl">BADGES</label>` +
          `<div class="dc-cp-group-box">` +
            CP_BADGES.map(
              (b) =>
                `<button type="button" class="dc-cp-bchip${flags & b.flag ? ' active' : ''}" data-cp-flag="${b.flag}">` +
                `<img src="${esc(b.icon)}" alt=""><span>${esc(isEn() ? b.en : b.fr)}</span></button>`
            ).join('') +
          `</div></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('BADGES NITRO ÉVOLUTIFS', 'EVOLVING NITRO BADGE'))}</label>` +
          `<div class="dc-cp-group-box">` +
            `<button type="button" class="dc-cp-bchip${draft.nitroLevel === -1 ? ' active' : ''}" data-cp-nitro="-1"><span>${esc(L('Aucun', 'None'))}</span></button>` +
            CP_NITRO_LEVELS.map(
              (n, i) =>
                `<button type="button" class="dc-cp-bchip${draft.nitroLevel === i ? ' active' : ''}" data-cp-nitro="${i}">` +
                `<img src="${esc(n.icon)}" alt=""><span>${esc(isEn() ? n.en : n.fr)}</span></button>`
            ).join('') +
          `</div></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('BADGES SPÉCIAUX', 'SPECIAL BADGES'))}</label>` +
          `<div class="dc-cp-group-box">` +
            CP_SPECIAL_BADGES.map(
              (sp) =>
                `<button type="button" class="dc-cp-bchip${cIds.includes(sp.id) ? ' active' : ''}" data-cp-special="${esc(sp.id)}">` +
                `<img src="${esc(sp.icon)}" alt=""><span>${esc(isEn() ? sp.en : sp.fr)}</span></button>`
            ).join('') +
          `</div>` +
          (hasOldName
            ? `<div style="margin-top:10px"><label class="dc-cp-lbl">${esc(L("ANCIEN NOM D'UTILISATEUR AFFICHÉ", 'OLD USERNAME DISPLAYED IN TOOLTIP'))}</label>` +
              `<input class="dc-cp-in" data-cp-k="oldName" placeholder="OldUser#0000" value="${esc(draft.oldName || '')}">` +
              `<div style="font-size:11.5px;color:#949ba4;margin-top:4px">${esc(L('Ex : Triggerr#5954 — apparaîtra comme « Connu à l’origine sous le nom de Triggerr#5954 » au survol du badge.', 'Ex: Triggerr#5954 — will appear as "Originally known as Triggerr#5954" when hovering the badge.'))}</div></div>`
            : '') +
          (hasLevel
            ? `<div style="margin-top:10px"><label class="dc-cp-lbl">${esc(L('NIVEAU ATTEINT', 'LEVEL REACHED'))}</label>` +
              `<input class="dc-cp-in" type="number" min="1" max="10000" data-cp-k="levelReached" value="${esc(draft.levelReached ?? 1)}"></div>`
            : '') +
          `</div>` +
          `<div><label class="dc-cp-lbl">${esc(L('BADGES DE CADEAUX', 'GIFTING BADGES'))}</label>` +
          `<div class="dc-cp-group-box">` +
            CP_GIFTING_BADGES.map(
              (g) =>
                `<button type="button" class="dc-cp-bchip${cIds.includes(g.id) ? ' active' : ''}" data-cp-special="${esc(g.id)}">` +
                `<img src="${esc(g.icon)}" alt=""><span>${esc(isEn() ? g.en : g.fr)}</span></button>`
            ).join('') +
          `</div></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('BADGES DE BOOST DE SERVEUR', 'SERVER BOOST BADGES'))}</label>` +
          `<div class="dc-cp-group-box">` +
            `<button type="button" class="dc-cp-bchip${draft.boostMonths === -1 ? ' active' : ''}" data-cp-boost="-1"><span>${esc(L('Aucun', 'None'))}</span></button>` +
            CP_BOOST_LEVELS.map(
              (b, i) =>
                `<button type="button" class="dc-cp-bchip${draft.boostMonths === i ? ' active' : ''}" data-cp-boost="${i}">` +
                `<img src="${esc(b.icon)}" alt=""><span>${esc(isEn() ? b.en : b.fr)}</span></button>`
            ).join('') +
          `</div></div>` +
          `<div style="height:1px;background:rgba(255,255,255,.07);margin:2px 0"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L("DÉCORATION D'AVATAR", 'AVATAR DECORATION'))} <span id="dc-cp-deco-cnt" style="opacity:.7">(${decoCount})</span></label>` +
          `<input class="dc-cp-in" id="dc-cp-deco-q" placeholder="${esc(L('Rechercher une décoration Discord…', 'Search a Discord decoration...'))}" value="${esc(decoQuery)}" style="margin-bottom:10px;padding:9px 13px;font-size:13px">` +
          `<div class="dc-cp-pills dc-cp-pills-scroll" id="dc-cp-deco-pills">${renderDecoPills()}</div></div>` +
          `<div style="height:1px;background:rgba(255,255,255,.07);margin:2px 0"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('EFFET DE PROFIL', 'PROFILE EFFECT'))} <span id="dc-cp-eff-cnt" style="opacity:.7">(${effCount})</span></label>` +
          `<input class="dc-cp-in" id="dc-cp-eff-q" placeholder="${esc(L('Rechercher un effet de profil Discord…', 'Search a Discord profile effect...'))}" value="${esc(effQuery)}" style="margin-bottom:10px;padding:9px 13px;font-size:13px">` +
          `<div class="dc-cp-pills dc-cp-pills-scroll" id="dc-cp-eff-pills">${renderEffPills()}</div></div>` +
          `<div style="height:1px;background:rgba(255,255,255,.07);margin:2px 0"></div>` +
          `<div><label class="dc-cp-lbl">${esc(L('PLAQUE NOMINATIVE', 'NAMEPLATE'))} <span id="dc-cp-np-cnt" style="opacity:.7">(${npCount})</span></label>` +
          `<input class="dc-cp-in" id="dc-cp-np-q" placeholder="${esc(L('Rechercher une plaque nominative Discord…', 'Search a Discord nameplate...'))}" value="${esc(npQuery)}" style="margin-bottom:10px;padding:9px 13px;font-size:13px">` +
          `<div class="dc-cp-pills dc-cp-pills-scroll" id="dc-cp-np-pills">${renderNpPills()}</div></div>` +
          `<div style="height:1px;background:rgba(255,255,255,.07);margin:2px 0"></div>` +
          `<div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px"><label class="dc-cp-lbl" style="margin:0">${esc(L('CADRE DE PROFIL', 'PROFILE FRAME'))} <span id="dc-cp-pf-cnt" style="opacity:.7">(${pfCount})</span></label>` +
          `<button type="button" class="dc-cp-mini-btn" id="dc-cp-pf-refresh">↻ ${esc(L('Actualiser boutique', 'Refresh shop'))}</button></div>` +
          `<input class="dc-cp-in" id="dc-cp-pf-q" placeholder="${esc(L('Rechercher un cadre de profil Discord…', 'Search a Discord profile frame...'))}" value="${esc(pfQuery)}" style="margin-bottom:10px;padding:9px 13px;font-size:13px">` +
          `<div class="dc-cp-pills dc-cp-pills-scroll" id="dc-cp-pf-pills">${renderPfPills()}</div></div>`
        );
        wrap.querySelector('#dc-cp-pf-refresh')?.addEventListener('click', () => {
          cpLoadDiscordCollectibles(() => {
            if (activeTab === 'badges' && document.body.contains(wrap)) {
              const pBox = wrap.querySelector('#dc-cp-pf-pills');
              const pCnt = wrap.querySelector('#dc-cp-pf-cnt');
              const nBox = wrap.querySelector('#dc-cp-np-pills');
              const nCnt = wrap.querySelector('#dc-cp-np-cnt');
              if (pBox) setHTML(pBox, renderPfPills());
              if (pCnt) pCnt.textContent = `(${(cpDynamicFrames || CP_PROFILE_FRAMES).length})`;
              if (nBox) setHTML(nBox, renderNpPills());
              if (nCnt && cpDynamicNameplates) nCnt.textContent = `(${cpDynamicNameplates.length})`;
              bindPickerScroll();
            }
          }, true);
          showToast(L('Actualisation de la boutique Discord…', 'Refreshing Discord Shop...'), 'ok');
        });
        bindPickerScroll();
        return;
      }

      if (activeTab === 'connections') {
        const curPlat = CP_FAKE_PLATFORMS.find((p) => p.id === selPlatform) || CP_FAKE_PLATFORMS[0];
        const conns = draft.fakeConnections || [];
        const platIconHtml = (p) => {
          const url = cpGetPlatformIconUrl(p.id, p.icon);
          return url
            ? `<img src="${esc(url)}" alt="" style="width:18px;height:18px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">`
            : `<span class="dc-cp-plat-dot" style="background:${esc(p.color || '#ffffff')};color:${p.color === '#ffffff' ? '#09090b' : '#ffffff'}">${esc(p.short[0])}</span>`;
        };
        setHTML(
          bodyEl,
          (conns.length
            ? `<div style="display:flex;flex-direction:column;gap:8px">` +
              conns
                .map((c) => {
                  const pObj = CP_FAKE_PLATFORMS.find((p) => p.id === c.platform) || CP_FAKE_PLATFORMS[0];
                  return (
                    `<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 15px;background:#141418;border:1px solid rgba(255,255,255,.08);border-radius:10px">` +
                    `<div style="display:flex;align-items:center;gap:10px">` +
                      platIconHtml(pObj) +
                      `<b style="color:#ffffff">${esc(c.name)}</b>` +
                      `<span style="font-size:11px;color:#a1a1aa">(${esc(pObj.label)})</span>` +
                    `</div>` +
                    `<button type="button" class="dc-cp-browse-btn" style="padding:5px 10px;color:#f87171" data-cp-delconn="${esc(c.id)}">✕</button></div>`
                  );
                })
                .join('') +
              `</div>`
            : `<div style="padding:18px;text-align:center;background:#131317;border-radius:10px;border:1px solid rgba(255,255,255,.07);color:#a1a1aa;font-size:13px">${esc(L('Aucune connexion ajoutée. Choisis une plateforme ci-dessous.', 'No connections added yet. Fill out the form below to add one.'))}</div>`) +
          `<div style="height:1px;background:rgba(255,255,255,.07);margin:2px 0"></div>` +
          `<div>` +
            `<label class="dc-cp-lbl" style="margin-bottom:4px">${esc(L('AJOUTER UNE CONNEXION', 'ADD NEW CONNECTION'))}</label>` +
            `<label class="dc-cp-lbl" style="font-size:10.5px;color:#71717a">${esc(L('CHOISIR UNE PLATEFORME', 'SELECT PLATFORM'))}</label>` +
            `<div class="dc-cp-plat-grid">` +
              CP_FAKE_PLATFORMS.map(
                (p) =>
                  `<button type="button" class="dc-cp-plat-btn${selPlatform === p.id ? ' active' : ''}" data-cp-plat="${esc(p.id)}">` +
                  platIconHtml(p) +
                  `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.short)}</span></button>`
              ).join('') +
            `</div>` +
          `</div>` +
          `<div><label class="dc-cp-lbl">${esc(selPlatform === 'domain' ? L('NOM DE DOMAINE / SITE WEB', 'DOMAIN / WEBSITE NAME') : L('NOM DU COMPTE / PSEUDO', 'ACCOUNT NAME / USERNAME'))}</label>` +
          `<input class="dc-cp-in" id="dc-cp-conn-name" placeholder="${esc(curPlat.placeholder || 'dreamcord.app')}" value="${esc(connNameInput)}">` +
          `<button type="button" class="dc-cp-fbtn save" id="dc-cp-conn-add" style="margin-top:12px">+ ${esc(L('Ajouter la connexion', 'Add Connection'))}</button></div>`
        );
      }
    };

    const initAv = getMyRealAvatar();
    const initAccName = (draft.globalName || '').trim() || me.globalName || me.username || 'User';
    setHTML(
      wrap,
      `<div class="dc-cp-root">` +
        `<div class="dc-cp-header">` +
          `<div class="dc-cp-title"><svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg><span>${esc(L('Profil personnalisé', 'Custom Profile'))}</span></div>` +
          `<div class="dc-cp-acc-pill"><img id="dc-cp-acc-img" src="${esc(initAv)}" alt=""><span id="dc-cp-acc-lbl" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(initAccName)}</span><span style="opacity:.6;font-size:12px">⌄</span></div>` +
          `<button type="button" class="dc-cp-close" id="dc-cp-x">✕</button>` +
        `</div>` +
        `<div class="dc-cp-preview" id="dc-cp-preview"></div>` +
        `<div class="dc-cp-tabs">` +
          `<button type="button" class="dc-cp-tab active" data-tab="general">${esc(L('Général', 'General'))}</button>` +
          `<button type="button" class="dc-cp-tab" data-tab="aesthetics">${esc(L('Esthétique', 'Aesthetics'))}</button>` +
          `<button type="button" class="dc-cp-tab" data-tab="badges">${esc(L('Insignes et effets', 'Badges & Effects'))}</button>` +
          `<button type="button" class="dc-cp-tab" data-tab="connections">Connections</button>` +
        `</div>` +
        `<div class="dc-cp-body" id="dc-cp-body"></div>` +
        `<div class="dc-cp-footer">` +
          `<button type="button" class="dc-cp-fbtn save" id="dc-cp-save"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm3-10H5V5h10v4Z"/></svg><span>${esc(L('Enregistrer', 'Save'))}</span></button>` +
          `<button type="button" class="dc-cp-fbtn reset" id="dc-cp-reset"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.1l-.9 12.1A3 3 0 0 1 17 23H7a3 3 0 0 1-3-2.9L3.1 8H2a1 1 0 0 1 0-2h4V4Zm2 0v2h6V4H9ZM5.1 8l.9 11.9a1 1 0 0 0 1 .1h6a1 1 0 0 0 1-.1L14.9 8H5.1Z"/></svg><span>${esc(L('Réinitialiser', 'Reset'))}</span></button>` +
          `<button type="button" class="dc-cp-fbtn cancel" id="dc-cp-cancel">${esc(L('Annuler', 'Cancel'))}</button>` +
        `</div>` +
      `</div>`
    );

    renderPreview();
    renderBody();

    const close = () => {
      offEsc();
      wrap.remove();
    };
    const offEsc = listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }, true);

    wrap.onclick = (e) => {
      if (e.target === wrap) return close();
      const t = e.target.closest?.('button,[data-tab],[data-cp-flag],[data-cp-special],[data-cp-nitro],[data-cp-boost],[data-cp-deco],[data-cp-eff],[data-cp-plat],[data-cp-delconn]');
      if (!t) return;
      if (t.id === 'dc-cp-x' || t.id === 'dc-cp-cancel') return close();
      if (t.id === 'dc-cp-reset') {
        config.pluginSettings['custom-profile'] = {};
        if (me.id) {
          delete getCfUsers()[me.id];
          restoreCustomFriend(me.id);
        }
        cpSyncToDomAndStores();
        saveSoon();
        close();
        showToast(L('Custom Profile réinitialisé', 'Custom Profile reset'), 'ok');
        return;
      }
      if (t.id === 'dc-cp-save') {
        if (draft.oldName && !draft.customBadgeIds.includes('oldname')) {
          draft.customBadgeIds.push('oldname');
        }
        config.pluginSettings['custom-profile'] = draft;
        config.plugins['custom-profile'] = true;
        syncPlugins();
        cpSyncToDomAndStores();
        saveSoon();
        close();
        const ok = (v) => (v ? '✓' : '✗');
        showToast(
          `${L('Custom Profile appliqué !', 'Custom Profile applied!')} · Profil ${ok(cpFindStore('UserProfileStore'))} Badges ${ok(cpDpPatched)} — ${L('rouvre ton profil', 'reopen your profile')}`,
          'ok'
        );
        if (embeddedTab) rerender();
        return;
      }
      if (t.dataset.tab) {
        activeTab = t.dataset.tab;
        renderBody();
        return;
      }
      if (t.dataset.cpFlag !== undefined) {
        const fl = Number(t.dataset.cpFlag);
        draft.badgeFlags = (Number(draft.badgeFlags) || 0) ^ fl;
        renderPreview();
        renderBody();
        return;
      }
      if (t.dataset.cpSpecial !== undefined) {
        const sid = t.dataset.cpSpecial;
        const arr = draft.customBadgeIds || [];
        draft.customBadgeIds = arr.includes(sid) ? arr.filter((x) => x !== sid) : [...arr, sid];
        renderPreview();
        renderBody();
        return;
      }
      if (t.dataset.cpNitro !== undefined) {
        const nl = Number(t.dataset.cpNitro);
        draft.nitroLevel = nl;
        if (nl >= 0) draft.nitro = true;
        renderPreview();
        renderBody();
        return;
      }
      if (t.dataset.cpBoost !== undefined) {
        const bm = Number(t.dataset.cpBoost);
        draft.boostMonths = bm;
        if (bm >= 0) draft.nitro = true;
        renderPreview();
        renderBody();
        return;
      }
      if (t.id === 'dc-cp-deco-more') {
        loadMoreDecos();
        return;
      }
      if (t.id === 'dc-cp-eff-more') {
        loadMoreEffs();
        return;
      }
      if (t.id === 'dc-cp-np-more') {
        loadMoreNps();
        return;
      }
      if (t.id === 'dc-cp-pf-more') {
        loadMorePfs();
        return;
      }
      if (t.dataset.cpDeco !== undefined) {
        draft.decorationAsset = t.dataset.cpDeco || '';
        wrap.querySelectorAll('#dc-cp-deco-pills .dc-cp-pill').forEach((el) => {
          el.classList.toggle('active', (el.dataset.cpDeco || '') === draft.decorationAsset);
        });
        renderPreview();
        return;
      }
      if (t.dataset.cpEff !== undefined) {
        draft.profileEffectId = t.dataset.cpEff || '';
        wrap.querySelectorAll('#dc-cp-eff-pills .dc-cp-pill').forEach((el) => {
          el.classList.toggle('active', (el.dataset.cpEff || '') === draft.profileEffectId);
        });
        return;
      }
      if (t.dataset.cpNp !== undefined) {
        draft.nameplateId = t.dataset.cpNp || '';
        wrap.querySelectorAll('#dc-cp-np-pills .dc-cp-pill').forEach((el) => {
          el.classList.toggle('active', (el.dataset.cpNp || '') === draft.nameplateId);
        });
        return;
      }
      if (t.dataset.cpPf !== undefined) {
        draft.profileFrameId = t.dataset.cpPf || '';
        wrap.querySelectorAll('#dc-cp-pf-pills .dc-cp-pill').forEach((el) => {
          el.classList.toggle('active', (el.dataset.cpPf || '') === draft.profileFrameId);
        });
        renderPreview();
        return;
      }
      if (t.dataset.cpPlat !== undefined) {
        selPlatform = t.dataset.cpPlat;
        renderBody();
        return;
      }
      if (t.dataset.cpDelconn !== undefined) {
        draft.fakeConnections = (draft.fakeConnections || []).filter((c) => String(c.id) !== String(t.dataset.cpDelconn));
        renderBody();
        return;
      }
      if (t.id === 'dc-cp-conn-add') {
        const nameVal = (wrap.querySelector('#dc-cp-conn-name')?.value || '').trim();
        if (!nameVal) return;
        const plat = CP_FAKE_PLATFORMS.find((p) => p.id === selPlatform) || CP_FAKE_PLATFORMS[0];
        let url = '';
        if (plat.defaultUrl) {
          try { url = plat.defaultUrl(nameVal); } catch {}
        }
        draft.fakeConnections.push({ id: String(Date.now()), platform: selPlatform, name: nameVal, ...(url ? { url } : {}) });
        connNameInput = '';
        renderBody();
        return;
      }
      if (t.id === 'dc-cp-av-pick') return wrap.querySelector('#dc-cp-av-file')?.click();
      if (t.id === 'dc-cp-ban-pick') return wrap.querySelector('#dc-cp-ban-file')?.click();
      if (t.id === 'dc-cp-av-clr') {
        draft.avatar = '';
        renderPreview();
        renderBody();
        return;
      }
      if (t.id === 'dc-cp-ban-clr') {
        draft.banner = '';
        renderBody();
      }
    };

    wrap.oninput = (e) => {
      const t = e.target;
      if (t.dataset?.cpK) {
        const k = t.dataset.cpK;
        draft[k] = k === 'levelReached' ? Number(t.value) || 1 : t.value;
        if (k === 'oldName' && t.value.trim() && !draft.customBadgeIds.includes('oldname')) {
          draft.customBadgeIds.push('oldname');
        }
        renderPreview();
      } else if (t.id === 'dc-cp-c1-pick') {
        draft.accentColor = t.value;
        draft.nitro = true;
        const hex = wrap.querySelector('#dc-cp-c1-hex');
        if (hex) hex.value = t.value;
        renderPreview();
      } else if (t.id === 'dc-cp-c2-pick') {
        draft.accentColor2 = t.value;
        draft.nitro = true;
        const hex = wrap.querySelector('#dc-cp-c2-hex');
        if (hex) hex.value = t.value;
        renderPreview();
      } else if (t.id === 'dc-cp-conn-name') {
        connNameInput = t.value;
      } else if (t.id === 'dc-cp-deco-q') {
        decoQuery = t.value;
        clearTimeout(decoSearchTimer);
        decoSearchTimer = setTimeout(() => {
          const dBox = wrap.querySelector('#dc-cp-deco-pills');
          if (dBox) {
            setHTML(dBox, renderDecoPills());
            dBox.scrollTop = 0;
          }
        }, 120);
      } else if (t.id === 'dc-cp-eff-q') {
        effQuery = t.value;
        clearTimeout(effSearchTimer);
        effSearchTimer = setTimeout(() => {
          const eBox = wrap.querySelector('#dc-cp-eff-pills');
          if (eBox) {
            setHTML(eBox, renderEffPills());
            eBox.scrollTop = 0;
          }
        }, 120);
      } else if (t.id === 'dc-cp-np-q') {
        npQuery = t.value;
        clearTimeout(npSearchTimer);
        npSearchTimer = setTimeout(() => {
          const nBox = wrap.querySelector('#dc-cp-np-pills');
          if (nBox) {
            setHTML(nBox, renderNpPills());
            nBox.scrollTop = 0;
          }
        }, 120);
      } else if (t.id === 'dc-cp-pf-q') {
        pfQuery = t.value;
        clearTimeout(pfSearchTimer);
        pfSearchTimer = setTimeout(() => {
          const pfBtn = wrap.querySelector('#dc-cp-pf-pills');
      wrap.querySelector('#dc-cp-pf-refresh')?.addEventListener('click', () => {
        cpLoadDiscordCollectibles(() => {
          if (activeTab === 'badges' && document.body.contains(wrap)) {
            const pBox = wrap.querySelector('#dc-cp-pf-pills');
            const pCnt = wrap.querySelector('#dc-cp-pf-cnt');
            const nBox = wrap.querySelector('#dc-cp-np-pills');
            const nCnt = wrap.querySelector('#dc-cp-np-cnt');
            if (pBox) setHTML(pBox, renderPfPills());
            if (pCnt) pCnt.textContent = `(${(cpDynamicFrames || CP_PROFILE_FRAMES).length})`;
            if (nBox) setHTML(nBox, renderNpPills());
            if (nCnt && cpDynamicNameplates) nCnt.textContent = `(${cpDynamicNameplates.length})`;
            bindPickerScroll();
          }
        }, true);
        showToast(L('Actualisation de la boutique Discord…', 'Refreshing Discord Shop...'), 'ok');
      });
          if (pBox) {
            setHTML(pBox, renderPfPills());
            pBox.scrollTop = 0;
          }
        }, 120);
      }
    };

    wrap.onchange = async (e) => {
      const t = e.target;
      if (t.id === 'dc-cp-share-sw') {
        draft.shareProfile = t.checked;
      } else if (t.id === 'dc-cp-nitro-sw') {
        draft.nitro = t.checked;
        renderPreview();
      } else if (t.id === 'dc-cp-av-file') {
        const f = t.files?.[0];
        if (!f) return;
        try {
          draft.avatar = await imageFileToDataUrl(f, 256, 350000);
          renderPreview();
          renderBody();
        } catch {}
      } else if (t.id === 'dc-cp-ban-file') {
        const f = t.files?.[0];
        if (!f) return;
        try {
          draft.banner = await imageFileToDataUrl(f, 720, 500000);
          draft.nitro = true;
          renderBody();
        } catch {}
      }
    };
  }

  function startCustomProfile() {
    setStyle('dc-p-custom-profile-css', CP_CSS);
    cpInstallStoreHooks();
    cpSyncToDomAndStores();
    const ensureHeaderBtn = () => {
      cpInstallStoreHooks();
      if (document.getElementById('dc-cp-hdr-btn')) return;
      const bar = document.querySelector('[class*="upperContainer_"] [class*="toolbar_"]');
      if (!bar) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'dc-cp-hdr-btn';
      btn.className = 'dc-fms-btn';
      btn.title = 'Custom Profile';
      setHTML(btn, '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>');
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCustomProfileModal();
      };
      bar.prepend(btn);
    };
    ensureHeaderBtn();
    let cpInitialSynced = false;
    let cpClickTimer = 0;
    const hookTimer = setInterval(() => {
      if (document.hidden || !isCpActive()) return;
      cpInstallStoreHooks();
      cpHookDisplayProfileFromFibers();
      if (!cpInitialSynced && cpGetMyId()) {
        cpInitialSynced = true;
        cpSyncToDomAndStores();
      } else {
        cpApplyDomBadges();
      }
    }, 3500);
    const offClick = listen(document, 'mouseup', () => {
      if (!isCpActive()) return;
      clearTimeout(cpClickTimer);
      cpClickTimer = setTimeout(() => cpApplyDomBadges(true), 160);
    }, true);
    const offTask = addTask('custom-profile', () => {
      ensureHeaderBtn();
      if (!config?.plugins?.['custom-friend']) applyCustomFriends();
      cpHookDisplayProfileFromFibers();
      cpApplyDomBadges();
    });
    const preloadTimer = setTimeout(() => { if (isCpActive()) cpLoadDiscordCollectibles(); }, 5000);
    return chain(offTask, offClick, () => {
      clearTimeout(cpClickTimer);
      clearTimeout(preloadTimer);
      clearInterval(hookTimer);
      document.getElementById('dc-cp-hdr-btn')?.remove();
      document.getElementById('dc-cp-modal')?.remove();
      cpRestoreDomBadges();
      cpSyncToDomAndStores();
    });
  }

  // ============================================================
  //  Fake Message Send (avion en papier dans la barre de chat)
  // ============================================================
  const FMS_CSS =
    '.dc-fms-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;margin:0 2px;border:0;border-radius:6px;background:transparent;color:#b5bac1;cursor:pointer;transition:color .12s,background .12s}' +
    '.dc-fms-btn:hover{color:#f2f3f5;background:rgba(255,255,255,.08)}' +
    '#dc-fms-modal{position:fixed;inset:0;z-index:100025;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.68);backdrop-filter:blur(8px)}' +
    '.dc-fms-msg{position:relative;list-style:none;margin-top:17px;padding:2px 48px 2px 72px;min-height:44px;font-family:"gg sans","Noto Sans",Segoe UI,sans-serif}' +
    '.dc-fms-msg:hover{background:rgba(2,2,2,.06)}' +
    '.dc-fms-av{position:absolute;left:16px;top:2px;width:40px;height:40px;border-radius:50%;object-fit:cover;background:#2b2d31;pointer-events:none}' +
    '.dc-fms-hdr{display:flex;align-items:baseline;gap:8px;line-height:1.375rem}' +
    '.dc-fms-user{font-size:16px;font-weight:500;color:#f2f3f5}' +
    '.dc-fms-ts{font-size:12px;font-weight:500;color:#949ba4}' +
    '.dc-fms-txt{font-size:16px;line-height:1.375rem;color:#dbdee1;white-space:pre-wrap;word-wrap:break-word}' +
    '.dc-fms-del{position:absolute;right:14px;top:4px;display:none;width:26px;height:26px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:rgba(0,0,0,.8);color:#e4e4e7;cursor:pointer;align-items:center;justify-content:center}' +
    '.dc-fms-msg:hover .dc-fms-del{display:inline-flex}' +
    '.dc-fms-del:hover{background:#da373c;border-color:#da373c;color:#fff}' +
    '.dc-fms-list{display:flex;flex-wrap:wrap;gap:6px;max-height:140px;overflow-y:auto;padding:2px 0}' +
    '.dc-fms-opt{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:9px;background:#16161a;border:1px solid rgba(255,255,255,.1);color:#d4d4d8;font:600 13px/1.2 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:all .14s}' +
    '.dc-fms-opt:hover{background:#222227;color:#ffffff}' +
    '.dc-fms-opt.active{background:#ffffff;border-color:#ffffff;color:#09090b}' +
    '.dc-fms-opt img{width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0}';

  function getUserAvatarUrl(u) {
    if (!u) return '';
    if (u.avatar) {
      const ext = String(u.avatar).startsWith('a_') ? 'gif' : 'webp';
      return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}?size=80`;
    }
    try {
      const idx = Number((BigInt(u.id) >> 22n) % 6n);
      return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    } catch {
      return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
  }

  function getConversationParticipants() {
    const out = [];
    const seen = new Set();
    const cf = getCfUsers();
    const pushUser = (id, name, avatar) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const ov = cf[id];
      out.push({
        id,
        name: (!ov?.disabled && ov?.name) || name || id,
        avatar: (!ov?.disabled && ov?.avatar) || avatar || ''
      });
    };

    try {
      const chStore = getStore('channel', (m) => typeof m.getChannel === 'function' && typeof m.getDMFromUserId === 'function');
      const uStore = getUserStore();
      const chId = location.pathname.match(/\/channels\/(?:@me|\d+)\/(\d{15,22})/)?.[1];
      const ch = chId && chStore?.getChannel?.(chId);
      if (ch && Array.isArray(ch.recipients)) {
        for (const uid of ch.recipients) {
          const u = uStore?.getUser?.(uid);
          if (u) pushUser(String(u.id), u.globalName || u.username, getUserAvatarUrl(u));
          else pushUser(String(uid), String(uid), '');
        }
      }
    } catch {}

    if (!out.length) {
      document.querySelectorAll('li[id^="chat-messages-"]').forEach((li) => {
        const img = li.querySelector('img[src*="/avatars/"], img[data-dc-cf-uid]');
        const av = img?.src || '';
        const uid = img?.dataset?.dcCfUid || av.match(/\/avatars\/(\d{15,22})\//)?.[1] || '';
        const nameEl = li.querySelector('[id^="message-username-"]');
        const nm = nameEl?.querySelector('span:not([class*="Tag"])')?.textContent?.trim() || nameEl?.childNodes?.[0]?.nodeValue?.trim() || nameEl?.textContent?.trim() || '';
        if (uid && nm) pushUser(uid, nm, av);
      });
    }

    if (!out.length) {
      const dm = document.querySelector('[class*="privateChannels_"] :is([class*="selected_"],[aria-current="page"])');
      const img = dm?.querySelector('img');
      const nm = dm?.querySelector('[class*="name_"]')?.textContent?.trim() || '';
      if (nm) pushUser('dm-peer', nm, img?.src || '');
    }
    return out;
  }

  function insertFakeMessage(sender, text) {
    const list = document.querySelector('ol[data-list-id="chat-messages"], [data-list-id="chat-messages"] ol, ol[class*="scrollerInner_"]');
    if (!list) return showToast(L('Ouvre une conversation d’abord', 'Open a conversation first'), 'error');
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const li = document.createElement('li');
    li.className = 'dc-fms-msg';
    setHTML(
      li,
      `<img class="dc-fms-av" src="${esc(sender.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png')}" alt="">` +
        `<div class="dc-fms-hdr"><span class="dc-fms-user">${esc(sender.name)}</span><span class="dc-fms-ts">${esc(L(`Aujourd’hui à ${hm}`, `Today at ${hm}`))}</span></div>` +
        `<div class="dc-fms-txt">${esc(text)}</div>` +
        `<button type="button" class="dc-fms-del" title="${esc(L('Supprimer', 'Delete'))}">${svgStr('trash', 14)}</button>`
    );
    li.querySelector('.dc-fms-del').onclick = () => li.remove();
    li.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      li.remove();
    };

    const spacer = list.querySelector('[class*="scrollerSpacer_"]');
    if (spacer) list.insertBefore(li, spacer);
    else list.appendChild(li);

    const scroller = list.closest('[class*="scroller_"]') || list.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function openFakeMessageModal() {
    document.getElementById('dc-fms-modal')?.remove();
    const people = getConversationParticipants();
    let selectedIdx = 0;
    const wrap = document.createElement('div');
    wrap.id = 'dc-fms-modal';

    const selectorHtml =
      people.length > 1
        ? `<div><div class="dc-cf-lbl">${esc(L('Envoyer au nom de', 'Send as'))}</div><div class="dc-fms-list" id="dc-fms-list">` +
          people
            .map(
              (p, i) =>
                `<button type="button" class="dc-fms-opt${i === 0 ? ' active' : ''}" data-idx="${i}">` +
                `<img src="${esc(p.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png')}" alt=""><span>${esc(p.name)}</span></button>`
            )
            .join('') +
          `</div></div>`
        : people.length === 1
          ? `<div class="dc-cf-head">` +
            `<img class="dc-cf-av" style="width:40px;height:40px" src="${esc(people[0].avatar || 'https://cdn.discordapp.com/embed/avatars/0.png')}" alt="">` +
            `<div><div class="dc-cf-title" style="font-size:15px">${esc(people[0].name)}</div><div class="dc-cf-uid">${esc(L('Expéditeur (local)', 'Sender (local)'))}</div></div></div>`
          : `<div><div class="dc-cf-lbl">${esc(L('Pseudo de l’expéditeur', 'Sender name'))}</div><input class="dc-cf-in" id="dc-fms-custom-name" placeholder="${esc(L('Pseudo…', 'Username...'))}"></div>`;

    setHTML(
      wrap,
      `<div class="dc-cf-box">
        <div class="dc-cf-title">Fake Message Send</div>
        ${selectorHtml}
        <div>
          <div class="dc-cf-lbl">Message</div>
          <textarea class="dc-cf-in" id="dc-fms-text" rows="3" style="height:auto;padding:10px 12px;resize:vertical" placeholder="${esc(L('Écris ton faux message…', 'Write your fake message...'))}"></textarea>
        </div>
        <div class="dc-cf-actions">
          <button type="button" class="dc-clone-btn" id="dc-fms-cancel">${esc(L('Annuler', 'Cancel'))}</button>
          <button type="button" class="dc-clone-btn primary" id="dc-fms-send">${esc(L('Envoyer', 'Send'))}</button>
        </div>
      </div>`
    );
    document.body.appendChild(wrap);

    const closeFms = () => {
      offEsc();
      wrap.remove();
    };
    const offEsc = listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeFms();
      }
    }, true);

    wrap.querySelector('#dc-fms-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest?.('.dc-fms-opt');
      if (!btn) return;
      selectedIdx = Number(btn.dataset.idx) || 0;
      wrap.querySelectorAll('.dc-fms-opt').forEach((b) => b.classList.toggle('active', b === btn));
    });

    const ta = wrap.querySelector('#dc-fms-text');
    ta?.focus();
    const submit = () => {
      const text = (ta?.value || '').trim();
      if (!text) return showToast(L('Écris un message', 'Write a message'), 'error');
      let sender;
      if (people.length > 1) {
        sender = people[selectedIdx] || people[0];
      } else if (people.length === 1) {
        sender = people[0];
      } else {
        const nm = (wrap.querySelector('#dc-fms-custom-name')?.value || '').trim() || L('Utilisateur', 'User');
        sender = { id: 'custom', name: nm, avatar: '' };
      }
      insertFakeMessage(sender, text);
      closeFms();
    };
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    };
    wrap.querySelector('#dc-fms-send').onclick = submit;
    wrap.querySelector('#dc-fms-cancel').onclick = closeFms;
    wrap.onclick = (e) => { if (e.target === wrap) closeFms(); };
  }

  function startFakeMessageSend() {
    setStyle('dc-p-fake-message-send', FMS_CSS);
    const ensureBtn = () => {
      if (document.getElementById('dc-fms-btn')) return;
      const bar = document.querySelector('[class*="channelTextArea_"] [class*="buttons_"]');
      if (!bar) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'dc-fms-btn';
      btn.className = 'dc-fms-btn';
      btn.title = 'Fake Message Send';
      setHTML(btn, svgStr('send', 16));
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFakeMessageModal();
      };
      bar.appendChild(btn);
    };
    ensureBtn();
    const offTask = addTask('fake-message-send', ensureBtn);
    return chain(offTask, () => {
      setStyle('dc-p-fake-message-send', '');
      document.getElementById('dc-fms-btn')?.remove();
      document.getElementById('dc-fms-modal')?.remove();
    });
  }

  // ============================================================
  //  All Clear Message (supprimer tous ses messages d'une conv)
  // ============================================================
  function openClearMessagesModal(channelId, isGuildHint) {
    const pathMatch = location.pathname.match(/\/channels\/(@me|\d+)\/(\d{15,22})/);
    const chId = channelId || pathMatch?.[2];
    if (!chId) return showToast(L('Ouvre une conversation d’abord', 'Open a conversation first'), 'error');
    const hrefMatch = document.querySelector(`a[href*="/channels/"][href$="/${chId}"]`)?.getAttribute('href')?.match(/\/channels\/(@me|\d+)\//);
    const isGuild = typeof isGuildHint === 'boolean'
      ? isGuildHint
      : (hrefMatch ? hrefMatch[1] !== '@me' : (pathMatch?.[2] === chId && pathMatch?.[1] !== '@me'));
    document.getElementById('dc-clr-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'dc-clr-modal';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100025;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.68);backdrop-filter:blur(8px)';
    setHTML(
      wrap,
      `<div class="dc-cf-box">
        <div class="dc-cf-title">All Clear Message</div>
        <div class="dc-cf-uid" id="dc-clr-status" style="font-size:13px;color:#cbd5e1">${esc(L('Supprime tes messages envoyés dans ce salon / cette conversation.', 'Deletes your messages in this channel / conversation.'))}</div>
        ${isGuild ? `<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px;color:#e5e5e5;cursor:pointer;user-select:none">
          <input type="checkbox" id="dc-clr-all-authors" style="accent-color:#ffffff;width:15px;height:15px;cursor:pointer">
          <span>${esc(L('Supprimer TOUS les messages du salon (tous les membres)', 'Delete ALL messages in channel (all members)'))}</span>
        </label>` : ''}
        <div class="dc-cf-actions">
          <button type="button" class="dc-clone-btn" id="dc-clr-cancel">${esc(L('Fermer', 'Close'))}</button>
          <button type="button" class="dc-clone-btn danger" id="dc-clr-go" style="background:#da373c;border-color:transparent;color:#fff">${esc(L('Tout supprimer', 'Clear All'))}</button>
        </div>
      </div>`
    );
    document.body.appendChild(wrap);

    let stopped = false;
    let armed = false;
    let armTimer = 0;
    const statusEl = wrap.querySelector('#dc-clr-status');
    const allAuthorsEl = wrap.querySelector('#dc-clr-all-authors');
    const goBtn = wrap.querySelector('#dc-clr-go');
    const cancelBtn = wrap.querySelector('#dc-clr-cancel');
    const closeClr = () => {
      stopped = true;
      clearTimeout(armTimer);
      offEsc();
      wrap.remove();
    };
    const offEsc = listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeClr();
      }
    }, true);
    cancelBtn.onclick = closeClr;
    wrap.onclick = (e) => { if (e.target === wrap) closeClr(); };

    goBtn.onclick = async () => {
      if (goBtn.dataset.running === '1') {
        stopped = true;
        goBtn.textContent = L('Arrêt…', 'Stopping...');
        return;
      }
      if (!armed) {
        armed = true;
        goBtn.textContent = L('Confirmer la suppression ?', 'Confirm deletion?');
        statusEl.textContent = L('Clique à nouveau sous 4s pour lancer la suppression irréversible.', 'Click again within 4s to start irreversible deletion.');
        clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          if (goBtn.dataset.running !== '1') {
            armed = false;
            goBtn.textContent = L('Tout supprimer', 'Clear All');
          }
        }, 4000);
        return;
      }
      clearTimeout(armTimer);
      const deleteAllAuthors = Boolean(allAuthorsEl?.checked);
      if (allAuthorsEl) allAuthorsEl.disabled = true;
      goBtn.dataset.running = '1';
      goBtn.textContent = L('Arrêter', 'Stop');
      try {
        const token = null;
        const UserStore = getUserStore();
        const me = UserStore?.getCurrentUser?.()?.id || (await dcDiscordApi('GET', '/users/@me', token))?.id;
        if (!me) throw new Error(L('Utilisateur introuvable', 'User not found'));

        let deleted = 0;
        let failed = 0;
        let scanned = 0;
        let before = '';
        while (!stopped) {
          const q = before ? `?limit=100&before=${before}` : '?limit=100';
          const msgs = await dcDiscordApi('GET', `/channels/${chId}/messages${q}`, token, null, 'Fetch');
          if (!Array.isArray(msgs) || !msgs.length) break;
          scanned += msgs.length;
          before = msgs[msgs.length - 1].id;
          const targets = deleteAllAuthors
            ? msgs.filter((m) => m.type !== 3)
            : msgs.filter((m) => m.author?.id === me && (m.type === 0 || m.type === 19 || m.type === 20 || m.type === 21));
          statusEl.textContent = `${L('Analysés', 'Scanned')} : ${scanned} · ${L('Supprimés', 'Deleted')} : ${deleted}${failed ? ` · ${L('Échecs', 'Failed')} : ${failed}` : ''}`;
          for (const m of targets) {
            if (stopped) break;
            try {
              await dcDiscordApi('DELETE', `/channels/${chId}/messages/${m.id}`, token, null, 'Delete');
              deleted += 1;
            } catch (delErr) {
              failed += 1;
              if (deleteAllAuthors && deleted === 0 && failed >= 3 && String(delErr?.message || delErr).includes('403')) {
                throw new Error(L('Permission « Gérer les messages » requise pour supprimer les messages des autres.', 'Manage Messages permission required to delete others\' messages.'));
              }
            }
            statusEl.textContent = `${L('Analysés', 'Scanned')} : ${scanned} · ${L('Supprimés', 'Deleted')} : ${deleted}${failed ? ` · ${L('Échecs', 'Failed')} : ${failed}` : ''}`;
            await new Promise((r) => setTimeout(r, 900));
          }
          if (msgs.length < 100) break;
        }
        statusEl.textContent = stopped
          ? `${L('Arrêté. Supprimés', 'Stopped. Deleted')} : ${deleted}`
          : `${L('Terminé ! Supprimés', 'Done! Deleted')} : ${deleted}${failed ? ` · ${L('Échecs', 'Failed')} : ${failed}` : ''}`;
        goBtn.style.display = 'none';
      } catch (err) {
        statusEl.textContent = `${L('Erreur', 'Error')} : ${err?.message || err}`;
        if (allAuthorsEl) allAuthorsEl.disabled = false;
        goBtn.dataset.running = '0';
        goBtn.textContent = L('Réessayer', 'Retry');
      }
    };
  }

  function startClearMessages() {
    setStyle('dc-p-clear-messages', '.dc-fms-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;margin:0 2px;border:0;border-radius:6px;background:transparent;color:#b5bac1;cursor:pointer;transition:color .12s,background .12s}.dc-fms-btn:hover{color:#f2f3f5;background:rgba(255,255,255,.08)}');
    const ensureToolbarBtn = () => {
      if (document.getElementById('dc-clear-btn')) return;
      const bar = document.querySelector('[class*="upperContainer_"] [class*="toolbar_"]');
      if (!bar) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'dc-clear-btn';
      btn.className = 'dc-fms-btn';
      btn.title = 'All Clear Message';
      setHTML(btn, svgStr('trash', 16));
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openClearMessagesModal();
      };
      bar.appendChild(btn);
    };
    let ctxTimers = [];
    const clearCtx = () => {
      ctxTimers.forEach(clearTimeout);
      ctxTimers = [];
    };
    const onCtx = (e) => {
      const dm = e.target.closest?.('a[href*="/channels/"]');
      const hrefMatch = dm?.getAttribute('href')?.match(/\/channels\/(@me|\d+)\/(\d{15,22})/);
      const liMatch = !hrefMatch
        ? e.target.closest?.('[data-list-item-id*="channels___"]')?.getAttribute('data-list-item-id')?.match(/channels___(\d{15,22})/)
        : null;
      const chId = hrefMatch?.[2] || liMatch?.[1];
      if (!chId) return;
      const isGuildHint = hrefMatch ? hrefMatch[1] !== '@me' : Boolean(liMatch);
      clearCtx();
      const inject = () => {
        const menu = document.querySelector('#user-context, #channel-context, [role="menu"]:not(#guild-context)');
        if (!menu || menu.id === 'guild-context' || menu.querySelector('#dc-ctx-clear-msg')) return;
        if (!menu.querySelector('[role="menuitem"]')) return;
        const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
        if (!target.querySelector('.dc-ctx-hdr')) {
          const hdr = document.createElement('div');
          hdr.className = 'dc-ctx-hdr';
          hdr.textContent = L('Option DreamCord', 'DreamCord Options');
          target.appendChild(hdr);
        }
        const btn = document.createElement('div');
        btn.id = 'dc-ctx-clear-msg';
        btn.className = 'dc-ctx-clone';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = 'All Clear Message';
        btn.onclick = (ev) => {
          ev.stopPropagation();
          dismissDiscordMenu(menu);
          openClearMessagesModal(chId, isGuildHint);
        };
        target.appendChild(btn);
        clearCtx();
      };
      ctxTimers = [50, 120, 250, 450].map((ms) => setTimeout(inject, ms));
    };
    ensureToolbarBtn();
    const offTask = addTask('clear-messages', ensureToolbarBtn);
    return chain(offTask, clearCtx, listen(document, 'contextmenu', onCtx, true), () => {
      setStyle('dc-p-clear-messages', '');
      document.getElementById('dc-clear-btn')?.remove();
      document.getElementById('dc-ctx-clear-msg')?.remove();
      document.getElementById('dc-clr-modal')?.remove();
    });
  }

  // ============================================================
  //  Nouveaux plugins clients (ImageZoom, ViewIcons, ShowID,
  //  FakeDeleteMessage, ReverseImageSearch, PasscodeLock,
  //  StealthMode, WriteUpperCase)
  // ============================================================
  const toHdImageUrl = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    try {
      const u = new URL(raw);
      if (/cdn\.discordapp\.com|media\.discordapp\.net/i.test(u.hostname)) {
        u.searchParams.set('size', '1024');
        u.searchParams.delete('width');
        u.searchParams.delete('height');
      }
      return u.toString();
    } catch {
      return raw;
    }
  };

  function openImageLightbox(src, title = '', modalId = 'dc-zoom-modal') {
    if (!src) return;
    document.getElementById(modalId)?.remove();
    const wrap = document.createElement('div');
    wrap.id = modalId;
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:100028;background:rgba(9,9,11,.92);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;user-select:none;animation:dc-pop .14s ease-out';
    setHTML(
      wrap,
      `<div style="position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:10px;background:#0f0f12;border:1px solid rgba(255,255,255,.12);color:#f4f4f5;font:600 12.5px/1 'gg sans',Segoe UI,sans-serif">` +
        (title ? `<span style="color:#ffffff;padding-right:6px;border-right:1px solid rgba(255,255,255,.12)">${esc(title)}</span>` : '') +
        `<span id="dc-zm-pct" style="color:#a1a1aa;font-variant-numeric:tabular-nums;min-width:44px;text-align:center">100 %</span>` +
        `<button type="button" class="dc-clone-btn" id="dc-zm-copy" style="height:28px;padding:0 10px;font-size:12px">${esc(L('Copier l’URL', 'Copy URL'))}</button>` +
        `<a class="dc-clone-btn" target="_blank" rel="noreferrer" href="${esc(src)}" style="height:28px;padding:0 10px;font-size:12px">${esc(L('Ouvrir', 'Open'))}</a>` +
        `<button type="button" class="dc-clone-btn primary" id="dc-zm-close" style="height:28px;padding:0 10px;font-size:12px">${esc(L('Fermer', 'Close'))}</button>` +
      `</div>` +
      `<div id="dc-zm-stage" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab">` +
        `<img id="dc-zm-img" src="${esc(src)}" alt="" draggable="false" style="max-width:86vw;max-height:80vh;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#09090b;transform-origin:center center;transition:transform .08s ease-out">` +
      `</div>`
    );
    document.body.appendChild(wrap);

    const stage = wrap.querySelector('#dc-zm-stage');
    const img = wrap.querySelector('#dc-zm-img');
    const pctEl = wrap.querySelector('#dc-zm-pct');
    let scale = 1;
    let tx = 0;
    let ty = 0;
    let dragging = false;
    let sx = 0;
    let sy = 0;

    const sync = () => {
      if (scale <= 1) {
        tx = 0;
        ty = 0;
      }
      img.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${scale})`;
      pctEl.textContent = `${Math.round(scale * 100)} %`;
      stage.style.cursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in';
    };
    sync();

    const close = () => {
      offEsc();
      offMove();
      offUp();
      wrap.remove();
    };
    const offEsc = listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }, true);
    const offMove = listen(window, 'mousemove', (e) => {
      if (!dragging) return;
      tx += e.clientX - sx;
      ty += e.clientY - sy;
      sx = e.clientX;
      sy = e.clientY;
      img.style.transition = 'none';
      sync();
    });
    const offUp = listen(window, 'mouseup', () => {
      if (!dragging) return;
      dragging = false;
      img.style.transition = 'transform .08s ease-out';
      sync();
    });

    stage.onwheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      scale = clamp(Number((scale * factor).toFixed(3)), 1, 6);
      sync();
    };
    img.onmousedown = (e) => {
      if (e.button !== 0) return;
      if (scale <= 1) {
        scale = 2;
        sync();
        return;
      }
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      sync();
    };
    img.ondblclick = () => {
      scale = scale > 1 ? 1 : 2.25;
      sync();
    };
    stage.onclick = (e) => {
      if (e.target === stage) close();
    };
    wrap.querySelector('#dc-zm-close').onclick = close;
    wrap.querySelector('#dc-zm-copy').onclick = () => {
      navigator.clipboard?.writeText(src)?.catch?.(noop);
      showToast(L('URL copiée', 'URL copied'), 'ok');
    };
  }

  function startImageZoom() {
    const onClick = (e) => {
      if (!e.shiftKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('#dc-settings-embedded,#dc-cf-modal,#dc-zoom-modal,#dc-view-modal,#dc-lock-overlay')) return;
      const img = e.target.closest?.('img');
      if (!img) return;
      const src = img.currentSrc || img.src || '';
      if (!/^https?:\/\//i.test(src)) return;
      if (!img.closest?.('li[id^="chat-messages-"],[class*="imageWrapper_"],[class*="embed"],[class*="attachment"],[class*="modal"]')) return;
      e.preventDefault();
      e.stopPropagation();
      openImageLightbox(toHdImageUrl(src), 'ImageZoom', 'dc-zoom-modal');
    };
    return chain(listen(document, 'click', onClick, true), () => {
      document.getElementById('dc-zoom-modal')?.remove();
    });
  }

  function startViewIcons() {
    let ctxTimers = [];
    const clearCtx = () => {
      ctxTimers.forEach(clearTimeout);
      ctxTimers = [];
    };
    const extractMediaFromTarget = (el) => {
      if (!el || el.closest?.('#dc-settings-embedded,#dc-cf-modal,#dc-zoom-modal,#dc-view-modal,#dc-lock-overlay')) return null;
      const av = el.closest?.('img[src*="/avatars/"],img[src*="/icons/"],img[src*="/banners/"],img[data-dc-cf-uid]');
      if (av) {
        const src = av.dataset?.dcCfOrigSrc || av.src || '';
        if (src) return { url: toHdImageUrl(src), label: L('Voir l’avatar en HD', 'View HD Avatar') };
      }
      const banner = el.closest?.('[class*="banner_"], svg[class*="bannerSVGWrapper"] foreignObject > div');
      if (banner) {
        const bg = getComputedStyle(banner).backgroundImage || banner.style.backgroundImage || '';
        const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
        if (m?.[1]) return { url: toHdImageUrl(m[1]), label: L('Voir la bannière en HD', 'View HD Banner') };
      }
      const guildItem = el.closest?.('[data-list-item-id^="guildsnav___"]');
      if (guildItem) {
        const gImg = guildItem.querySelector('img[src*="/icons/"]');
        if (gImg?.src) return { url: toHdImageUrl(gImg.src), label: L('Voir l’icône du serveur', 'View Server Icon') };
      }
      const info = extractUserInfo(el);
      if (info?.origAvatar && /^https?:\/\//i.test(info.origAvatar)) {
        return { url: toHdImageUrl(info.origAvatar), label: L('Voir l’avatar en HD', 'View HD Avatar') };
      }
      return null;
    };
    const onCtx = (e) => {
      const media = extractMediaFromTarget(e.target);
      if (!media) return;
      clearCtx();
      const inject = () => {
        const menu = document.querySelector('[role="menu"]');
        if (!menu || menu.querySelector('#dc-ctx-view-icon')) return;
        if (!menu.querySelector('[role="menuitem"]')) return;
        const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
        if (!target.querySelector('.dc-ctx-hdr')) {
          const hdr = document.createElement('div');
          hdr.className = 'dc-ctx-hdr';
          hdr.textContent = L('Option DreamCord', 'DreamCord Options');
          target.appendChild(hdr);
        }
        const btn = document.createElement('div');
        btn.id = 'dc-ctx-view-icon';
        btn.className = 'dc-ctx-clone';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = media.label;
        btn.onclick = (ev) => {
          ev.stopPropagation();
          dismissDiscordMenu(menu);
          openImageLightbox(media.url, 'ViewIcons', 'dc-view-modal');
        };
        target.appendChild(btn);
        clearCtx();
      };
      ctxTimers = [40, 120, 260, 460].map((ms) => setTimeout(inject, ms));
    };
    return chain(listen(document, 'contextmenu', onCtx, true), clearCtx, () => {
      document.getElementById('dc-ctx-view-icon')?.remove();
      document.getElementById('dc-view-modal')?.remove();
    });
  }

  function startShowId() {
    const CSS =
      '.dc-showid-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding:7px 10px;border-radius:8px;background:#0f0f12;border:1px solid rgba(255,255,255,.1);font:12px/1.3 "gg sans",Segoe UI,sans-serif;color:#a1a1aa}' +
      '.dc-showid-val{font:600 11.5px/1 Consolas,monospace;color:#f4f4f5;user-select:all;overflow:hidden;text-overflow:ellipsis}' +
      '.dc-showid-btn{height:24px;padding:0 8px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:#16161a;color:#ffffff;font:600 11px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;flex-shrink:0;transition:background .12s,color .12s}' +
      '.dc-showid-btn:hover{background:#ffffff;color:#09090b;border-color:#ffffff}';
    setStyle('dc-p-show-id', CSS);
    const scan = () => {
      document
        .querySelectorAll('aside, [role="dialog"]:not(#dc-cf-modal), [class*="userPopoutOuter"], [class*="userProfileOuter"], [class*="profilePanel"]')
        .forEach((pop) => {
          if (isMemberListContainer(pop) || isIgnoredDialog(pop)) return;
          if (pop.querySelector('.dc-showid-row')) return;
          const uid = extractUserInfo(pop)?.userId;
          if (!uid || !/^\d{15,22}$/.test(uid)) return;
          const anchor = pop.querySelector('[class*="memberSince_"]')?.parentElement || pop.querySelector('[class*="body_"],[class*="scrollerBase_"]');
          if (!anchor) return;
          const row = document.createElement('div');
          row.className = 'dc-showid-row';
          setHTML(
            row,
            `<div style="min-width:0;display:flex;align-items:center;gap:6px"><span style="font-weight:700;color:#71717a;text-transform:uppercase;font-size:10px;letter-spacing:.06em">ID</span><span class="dc-showid-val">${esc(uid)}</span></div>` +
              `<button type="button" class="dc-showid-btn">${esc(L('Copier', 'Copy'))}</button>`
          );
          row.querySelector('.dc-showid-btn').onclick = (ev) => {
            ev.stopPropagation();
            navigator.clipboard?.writeText(uid)?.catch?.(noop);
            showToast(L(`ID copié : ${uid}`, `ID copied: ${uid}`), 'ok');
          };
          anchor.appendChild(row);
        });
    };
    scan();
    const offTask = addTask('show-id', scan);
    return chain(offTask, () => {
      setStyle('dc-p-show-id', '');
      document.querySelectorAll('.dc-showid-row').forEach((n) => n.remove());
    });
  }

  function startFakeDelete() {
    let ctxTimers = [];
    const clearCtx = () => {
      ctxTimers.forEach(clearTimeout);
      ctxTimers = [];
    };
    const onCtx = (e) => {
      const li = e.target.closest?.('li[id^="chat-messages-"]');
      if (!li) return;
      clearCtx();
      const inject = () => {
        const menu = document.querySelector('#message-actions, [role="menu"][id*="message"], [role="menu"]:not(#guild-context)');
        if (!menu || menu.id === 'guild-context' || menu.querySelector('#dc-ctx-fake-del')) return;
        if (!menu.querySelector('[role="menuitem"]')) return;
        const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
        if (!target.querySelector('.dc-ctx-hdr')) {
          const hdr = document.createElement('div');
          hdr.className = 'dc-ctx-hdr';
          hdr.textContent = L('Option DreamCord', 'DreamCord Options');
          target.appendChild(hdr);
        }
        const btn = document.createElement('div');
        btn.id = 'dc-ctx-fake-del';
        btn.className = 'dc-ctx-clone';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = L('Masquer localement', 'Hide locally');
        btn.onclick = (ev) => {
          ev.stopPropagation();
          dismissDiscordMenu(menu);
          li.dataset.dcFakeHidden = '1';
          li.style.display = 'none';
          showToast(L('Message masqué pour cette session', 'Message hidden for this session'), 'ok');
        };
        target.appendChild(btn);
        clearCtx();
      };
      ctxTimers = [40, 120, 260, 460].map((ms) => setTimeout(inject, ms));
    };
    return chain(listen(document, 'contextmenu', onCtx, true), clearCtx, () => {
      document.getElementById('dc-ctx-fake-del')?.remove();
      document.querySelectorAll('[data-dc-fake-hidden="1"]').forEach((el) => {
        el.style.display = '';
        delete el.dataset.dcFakeHidden;
      });
    });
  }

  function startReverseImageSearch() {
    let ctxTimers = [];
    const clearCtx = () => {
      ctxTimers.forEach(clearTimeout);
      ctxTimers = [];
    };
    const onCtx = (e) => {
      if (e.target.closest?.('#dc-settings-embedded,#dc-cf-modal,#dc-lock-overlay')) return;
      const img = e.target.closest?.('img') || e.target.closest?.('a')?.querySelector('img');
      const src = img?.currentSrc || img?.src || '';
      if (!/^https?:\/\//i.test(src)) return;
      clearCtx();
      const targetUrl = toHdImageUrl(src);
      const inject = () => {
        const menu = document.querySelector('[role="menu"]');
        if (!menu || menu.querySelector('#dc-ctx-ris-lens')) return;
        if (!menu.querySelector('[role="menuitem"]')) return;
        const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
        if (!target.querySelector('.dc-ctx-hdr')) {
          const hdr = document.createElement('div');
          hdr.className = 'dc-ctx-hdr';
          hdr.textContent = L('Option DreamCord', 'DreamCord Options');
          target.appendChild(hdr);
        }
        const addItem = (id, label, url) => {
          const btn = document.createElement('div');
          btn.id = id;
          btn.className = 'dc-ctx-clone';
          btn.setAttribute('role', 'menuitem');
          btn.textContent = label;
          btn.onclick = (ev) => {
            ev.stopPropagation();
            dismissDiscordMenu(menu);
            window.open(url, '_blank', 'noopener,noreferrer');
          };
          target.appendChild(btn);
        };
        addItem('dc-ctx-ris-lens', L('Google Lens (recherche inversée)', 'Google Lens (Reverse Search)'), `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(targetUrl)}`);
        addItem('dc-ctx-ris-tineye', L('TinEye (recherche inversée)', 'TinEye (Reverse Search)'), `https://tineye.com/search?url=${encodeURIComponent(targetUrl)}`);
        clearCtx();
      };
      ctxTimers = [40, 120, 260, 460].map((ms) => setTimeout(inject, ms));
    };
    return chain(listen(document, 'contextmenu', onCtx, true), clearCtx, () => {
      document.getElementById('dc-ctx-ris-lens')?.remove();
      document.getElementById('dc-ctx-ris-tineye')?.remove();
    });
  }

  const getPasscodePin = () => {
    const raw = String(pluginSetting('passcode-lock', 'pin', '1234') || '').replace(/\D/g, '');
    return raw.length >= 4 && raw.length <= 8 ? raw : '1234';
  };

  function openPasscodeLock() {
    if (document.getElementById('dc-lock-overlay')) return;
    const expected = getPasscodePin();
    let entered = '';
    const wrap = document.createElement('div');
    wrap.id = 'dc-lock-overlay';
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:100040;background:#09090b;display:flex;align-items:center;justify-content:center;font:14px/1.4 "gg sans",Segoe UI,sans-serif;color:#f4f4f5;user-select:none';
    const dotsHtml = Array.from({ length: expected.length }, (_, i) => `<span class="dc-lk-dot" data-i="${i}"></span>`).join('');
    const padKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
    setHTML(
      wrap,
      `<style>
        #dc-lock-overlay .dc-lk-box{width:320px;max-width:92vw;padding:28px 24px;border-radius:16px;background:#0f0f12;border:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;align-items:center;gap:16px;animation:dc-pop .16s ease-out}
        #dc-lock-overlay .dc-lk-logo{width:46px;height:46px;border-radius:12px;background:#09090b;border:1px solid rgba(255,255,255,.14);color:#ffffff;display:flex;align-items:center;justify-content:center}
        #dc-lock-overlay .dc-lk-dots{display:flex;gap:10px;padding:6px 0}
        #dc-lock-overlay .dc-lk-dot{width:11px;height:11px;border-radius:50%;border:1.5px solid rgba(255,255,255,.28);background:transparent;transition:background .12s,border-color .12s,transform .12s}
        #dc-lock-overlay .dc-lk-dot.on{background:#ffffff;border-color:#ffffff;transform:scale(1.1)}
        #dc-lock-overlay .dc-lk-dots.err{animation:dc-shake .28s ease}
        @keyframes dc-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
        #dc-lock-overlay .dc-lk-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%}
        #dc-lock-overlay .dc-lk-key{height:44px;border-radius:10px;border:1px solid rgba(255,255,255,.09);background:#16161a;color:#ffffff;font:700 16px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:background .12s,border-color .12s,transform .08s}
        #dc-lock-overlay .dc-lk-key:hover{background:#222227;border-color:rgba(255,255,255,.2)}
        #dc-lock-overlay .dc-lk-key:active{transform:scale(.96);background:#ffffff;color:#09090b}
      </style>
      <div class="dc-lk-box">
        <div class="dc-lk-logo">${logoSvg(24)}</div>
        <div style="text-align:center">
          <div style="font-size:16px;font-weight:700;color:#ffffff">DreamCord</div>
          <div id="dc-lk-sub" style="font-size:12px;color:#71717a;margin-top:2px">${esc(L('Entrez votre code PIN', 'Enter your PIN code'))}</div>
        </div>
        <div class="dc-lk-dots" id="dc-lk-dots">${dotsHtml}</div>
        <div class="dc-lk-pad" id="dc-lk-pad">${padKeys.map((k) => `<button type="button" class="dc-lk-key" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      </div>`
    );
    document.body.appendChild(wrap);

    const dotsWrap = wrap.querySelector('#dc-lk-dots');
    const subEl = wrap.querySelector('#dc-lk-sub');
    const syncDots = () => {
      dotsWrap.querySelectorAll('.dc-lk-dot').forEach((d, idx) => d.classList.toggle('on', idx < entered.length));
    };
    const unlock = () => {
      offKey();
      wrap.remove();
    };
    const pushDigit = (d) => {
      if (entered.length >= expected.length) return;
      entered += d;
      syncDots();
      if (entered.length === expected.length) {
        if (entered === expected) {
          unlock();
        } else {
          dotsWrap.classList.remove('err');
          void dotsWrap.offsetWidth;
          dotsWrap.classList.add('err');
          subEl.textContent = L('Code incorrect', 'Incorrect PIN');
          subEl.style.color = '#f87171';
          setTimeout(() => {
            entered = '';
            syncDots();
            subEl.textContent = L('Entrez votre code PIN', 'Enter your PIN code');
            subEl.style.color = '#71717a';
          }, 420);
        }
      }
    };
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        pushDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        entered = entered.slice(0, -1);
        syncDots();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        entered = '';
        syncDots();
      }
    };
    const offKey = listen(document, 'keydown', onKey, true);
    wrap.querySelector('#dc-lk-pad').onclick = (e) => {
      const btn = e.target.closest?.('.dc-lk-key');
      if (!btn) return;
      const k = btn.dataset.k;
      if (k === 'C') {
        entered = '';
        syncDots();
      } else if (k === '⌫') {
        entered = entered.slice(0, -1);
        syncDots();
      } else {
        pushDigit(k);
      }
    };
    wrap._dcUnlock = unlock;
  }

  function startPasscodeLock() {
    const ensureLockBtn = () => {
      if (document.getElementById('dc-lock-btn')) return;
      const dcBtn = document.getElementById('dc-userpanel-btn');
      const group = dcBtn?.parentElement || document.querySelector('[class*="panels_"] [class*="buttons_"]');
      if (!group) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'dc-lock-btn';
      btn.className = 'dc-up-btn';
      btn.title = L('Verrouiller Discord (Ctrl+Maj+L)', 'Lock Discord (Ctrl+Shift+L)');
      btn.setAttribute('aria-label', 'PasscodeLock');
      btn.appendChild(iconEl('lock', 14));
      btn.onclick = (e) => {
        e.stopPropagation();
        openPasscodeLock();
      };
      if (dcBtn) dcBtn.after(btn);
      else group.prepend(btn);
    };
    ensureLockBtn();
    const offTask = addTask('passcode-lock', ensureLockBtn);
    const offKey = listen(window, 'keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        openPasscodeLock();
      }
    });
    return chain(offTask, offKey, () => {
      document.getElementById('dc-lock-btn')?.remove();
      const ov = document.getElementById('dc-lock-overlay');
      if (ov?._dcUnlock) ov._dcUnlock();
      else ov?.remove();
    });
  }

  function startStealthMode() {
    const CSS =
      'html[data-dc-stealth] #dc-userpanel-btn,html[data-dc-stealth] #dc-lock-btn,html[data-dc-stealth] #dc-fms-btn,' +
      'html[data-dc-stealth] #dc-clear-btn,html[data-dc-stealth] #dc-clock,html[data-dc-stealth] #dc-charcount,' +
      'html[data-dc-stealth] #dc-call-timer,html[data-dc-stealth] .dc-showid-row,html[data-dc-stealth] .dc-cb-copy,' +
      'html[data-dc-stealth] .dc-msg-deleted-badge,html[data-dc-stealth] .dc-msg-deleted-x,' +
      'html[data-dc-stealth] #dc-settings-section{display:none!important}';
    setStyle('dc-p-stealth-mode', CSS);
    const offKey = listen(window, 'keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        const next = !root.hasAttribute('data-dc-stealth');
        root.toggleAttribute('data-dc-stealth', next);
        if (next && embeddedTab) unmountEmbedded();
        if (!next) showToast(L('Mode furtif désactivé', 'Stealth mode disabled'), 'ok');
      }
    });
    return chain(offKey, () => {
      root.removeAttribute('data-dc-stealth');
      setStyle('dc-p-stealth-mode', '');
    });
  }

  function startWriteUpperCase() {
    const onBeforeInput = (e) => {
      if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;
      const ch = e.data;
      if (ch === ch.toUpperCase() || !/[a-zà-öø-ÿ]/.test(ch)) return;
      const tb = e.target?.closest?.('[role="textbox"]');
      if (!tb) return;
      const txt = (tb.textContent || '').replace(/\u200b/g, '');
      if (txt.startsWith('/') || txt.startsWith('http://') || txt.startsWith('https://')) return;
      const shouldCap = txt.length === 0 || /(?:[.!?]\s+|\n)$/.test(txt);
      if (!shouldCap) return;
      e.preventDefault();
      document.execCommand('insertText', false, ch.toUpperCase());
    };
    return listen(document, 'beforeinput', onBeforeInput, true);
  }

  function tagOsWinButtons() {
    const containers = document.querySelectorAll('[class*="winButtons"]:not([class*="Divider"])');
    containers.forEach((box) => {
      if (box.querySelector('[class*="winButtons"]')) return;
      box.setAttribute('data-dc-winbox', '1');
      let btns = Array.from(box.children).filter((el) => (el.tagName === 'DIV' || el.tagName === 'BUTTON') && /winButton/i.test(el.className || ''));
      if (!btns.length) btns = Array.from(box.children).filter((el) => el.tagName === 'DIV' || el.tagName === 'BUTTON');
      if (!btns.length) return;
      const firstIsClose = /close/i.test(btns[0].className || '') || /close|fermer/i.test(btns[0].getAttribute('aria-label') || '');
      btns.forEach((btn, idx) => {
        const cls = btn.className || '';
        const lbl = btn.getAttribute('aria-label') || '';
        let role = '';
        if (/close/i.test(cls) || /close|fermer/i.test(lbl)) role = 'close';
        else if (/min/i.test(lbl) || /réduire/i.test(lbl)) role = 'min';
        else if (/max/i.test(lbl) || /agrandir|restaurer/i.test(lbl)) role = 'max';
        else if (firstIsClose) role = idx === 0 ? 'close' : idx === 1 ? 'max' : 'min';
        else role = idx === btns.length - 1 ? 'close' : idx === 0 ? 'min' : 'max';
        if (btn.getAttribute('data-dc-winbtn') !== role) btn.setAttribute('data-dc-winbtn', role);
      });
    });
  }

  function getOsWindowCss(mode) {
    if (mode === 'windows') {
      return (
        '[data-dc-winbox="1"]{flex-direction:row!important;align-items:stretch!important;gap:0!important;padding:0!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn]{width:46px!important;height:32px!important;min-width:46px!important;min-height:28px!important;max-width:46px!important;max-height:36px!important;border-radius:0!important;padding:0!important;margin:0!important;top:0!important;align-self:stretch!important;position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;background:transparent!important;border:0!important;color:#d4d4d8!important;box-sizing:border-box!important;transition:background .1s ease,color .1s ease!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn="min"]{order:1!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn="max"]{order:2!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn="close"]{order:3!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn] svg{width:12px!important;height:12px!important;opacity:.9!important;color:currentColor!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn]:hover{background:rgba(255,255,255,.08)!important;color:#ffffff!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn="close"]:hover{background:#c42b1c!important;color:#ffffff!important}'
      );
    }
    if (mode === 'linux') {
      return (
        '[data-dc-winbox="1"]{flex-direction:row!important;align-items:center!important;gap:8px!important;padding:0 10px!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn]{width:22px!important;height:22px!important;min-width:22px!important;min-height:22px!important;max-width:22px!important;max-height:22px!important;border-radius:50%!important;padding:0!important;margin:0!important;top:0!important;align-self:center!important;position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;background:#2d2d32!important;border:1px solid rgba(255,255,255,.12)!important;color:#e4e4e7!important;box-sizing:border-box!important;transition:background .12s ease,border-color .12s ease,color .12s ease!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn="min"]{order:1!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn="max"]{order:2!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn="close"]{order:3!important;background:#e95420!important;border-color:#ff6b35!important;color:#ffffff!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn] svg{width:10px!important;height:10px!important;opacity:.95!important;color:currentColor!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn]:hover{background:#3e3e46!important;border-color:rgba(255,255,255,.25)!important;color:#ffffff!important}' +
        '[data-dc-winbox="1"]>[data-dc-winbtn="close"]:hover{background:#f26330!important;border-color:#ff8255!important;color:#ffffff!important}'
      );
    }
    return (
      '[data-dc-winbox="1"]{flex-direction:row!important;align-items:center!important;gap:8px!important;padding:0 12px!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn]{width:12px!important;height:12px!important;min-width:12px!important;min-height:12px!important;max-width:12px!important;max-height:12px!important;border-radius:50%!important;padding:0!important;margin:0!important;top:0!important;align-self:center!important;position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;overflow:hidden!important;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.28)!important;transition:filter .12s ease!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn] svg{display:none!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn]::after{position:absolute!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:center!important;opacity:0!important;font:800 10px/12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;transition:opacity .1s ease!important;pointer-events:none!important}' +
      '[data-dc-winbox="1"]:hover>[data-dc-winbtn]::after{opacity:1!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn="close"]{order:1!important;background:#ff5f56!important;border:.5px solid #e0443e!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn="close"]::after{content:"×"!important;color:#4d0000!important;font-size:11px!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn="min"]{order:2!important;background:#ffbd2e!important;border:.5px solid #dea123!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn="min"]::after{content:"−"!important;color:#5c3c00!important;font-size:10px!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn="max"]{order:3!important;background:#27c93f!important;border:.5px solid #1aab29!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn="max"]::after{content:"+"!important;color:#004d0d!important;font-size:10px!important}' +
      '[data-dc-winbox="1"]>[data-dc-winbtn]:active{filter:brightness(.88)!important}'
    );
  }

  function refreshOsButtonsStyle() {
    if (!config?.plugins?.['macos-buttons']) {
      setStyle('dc-p-macos-buttons', '');
      return;
    }
    const mode = pluginSetting('macos-buttons', 'mode', 'macos') || 'macos';
    tagOsWinButtons();
    setStyle('dc-p-macos-buttons', getOsWindowCss(mode));
  }

  function startOsButtons() {
    refreshOsButtonsStyle();
    const offTask = addTask('macos-buttons', tagOsWinButtons);
    return chain(offTask, () => setStyle('dc-p-macos-buttons', ''));
  }


  // ============================================================
  //  Fond animé (image / GIF / vidéo)
  //  Pas de filtre CSS par défaut : la luminosité < 100 % passe par un voile noir
  //  (très léger pour le GPU) ; contraste / saturation / flou seulement si réglés.
  // ============================================================
  let wpKey = '';
  let wpMedia = null;
  let wpShade = null;
  let onBattery = false;
  let batteryHooked = false;

  function currentSource() {
    const wp = config.wallpaper;
    if (wp.source === 'url') return /^https?:\/\//i.test(wp.url || '') ? wp.url : '';
    return wallpaperSrc || '';
  }
  function currentKind() {
    const wp = config.wallpaper;
    const ref = wp.source === 'url' ? wp.url || '' : wp.fileName || '';
    return /\.(mp4|m4v|webm|mov|ogv|mkv)(\?|#|$)/i.test(ref) ? 'video' : 'image';
  }
  const wallpaperActive = () => Boolean(config?.wallpaper?.enabled && currentSource());

  function ensureBattery() {
    if (batteryHooked || !navigator.getBattery) return;
    batteryHooked = true;
    navigator
      .getBattery()
      .then((b) => {
        const update = () => {
          onBattery = !b.charging;
          updatePlayState();
        };
        update();
        b.addEventListener('chargingchange', update);
      })
      .catch(noop);
  }

  function updatePlayState() {
    const v = wpMedia;
    if (!v || v.tagName !== 'VIDEO' || !config) return;
    const wp = config.wallpaper;
    if (wp.pauseBattery) ensureBattery();
    const pause = (wp.pauseMinimized && document.hidden) || (wp.pauseUnfocused && !document.hasFocus()) || (wp.pauseBattery && onBattery);
    if (pause) {
      if (!v.paused) v.pause();
    } else if (v.paused) {
      v.play()?.catch?.(noop);
    }
  }
  document.addEventListener('visibilitychange', updatePlayState);
  window.addEventListener('blur', updatePlayState);
  window.addEventListener('focus', updatePlayState);

  function releaseMedia(media) {
    if (!media || media.tagName !== 'VIDEO') return;
    try {
      media.pause();
      media.removeAttribute('src');
      media.load();
    } catch {}
  }

  function removeWallpaper() {
    releaseMedia(wpMedia);
    document.getElementById('dc-wallpaper')?.remove();
    wpKey = '';
    wpMedia = null;
    wpShade = null;
  }

  function buildMedia(kind, src) {
    const media = document.createElement(kind === 'video' ? 'video' : 'img');
    media.className = 'dc-media';
    media.style.opacity = '0';
    if (kind === 'video') {
      media.muted = true;
      media.defaultMuted = true;
      media.loop = true;
      media.autoplay = true;
      media.playsInline = true;
      media.disablePictureInPicture = true;
      media.disableRemotePlayback = true;
      media.setAttribute('muted', '');
      media.preload = 'auto';
      media.onloadeddata = () => {
        media.dataset.ready = '1';
        applyWallpaperStyle();
        updatePlayState();
      };
    } else {
      media.alt = '';
      media.draggable = false;
      media.decoding = 'async';
      media.onload = () => {
        media.dataset.ready = '1';
        applyWallpaperStyle();
      };
    }
    media.onerror = () => {
      log('Chargement du fond impossible : ' + src);
      showToast(L('Impossible de charger ce fichier', 'Unable to load this file'), 'error');
    };
    media.src = src;
    return media;
  }

  function applyWallpaperStyle() {
    const wp = config.wallpaper;
    const media = wpMedia;
    if (!media) return;
    const b = clamp(wp.brightness, 10, 200);
    const c = clamp(wp.contrast, 50, 150);
    const s = clamp(wp.saturation, 0, 200);
    const bl = clamp(wp.blur, 0, 30);
    const filters = [];
    if (b > 100) filters.push(`brightness(${b}%)`);
    if (c !== 100) filters.push(`contrast(${c}%)`);
    if (s !== 100) filters.push(`saturate(${s}%)`);
    if (bl > 0) filters.push(`blur(${bl}px)`);
    const ms = media.style;
    ms.objectFit = wp.fit === 'contain' ? 'contain' : wp.fit === 'fill' ? 'fill' : 'cover';
    ms.filter = filters.join(' ');
    ms.transform = bl > 0 ? 'scale(1.06)' : '';
    ms.opacity = media.dataset.ready ? String(clamp(wp.opacity, 0, 100) / 100) : '0';
    if (wpShade) wpShade.style.opacity = b < 100 ? String(((100 - b) / 100).toFixed(3)) : '0';
    if (media.tagName === 'VIDEO') media.playbackRate = clamp(wp.speed, 0.25, 2);
  }

  function updateWallpaper() {
    const wp = config.wallpaper;
    const src = currentSource();
    if (!wp.enabled || !src) return removeWallpaper();
    if (!document.body) return;

    const kind = currentKind();
    const key = `${kind}|${src}`;
    let host = document.getElementById('dc-wallpaper');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dc-wallpaper';
      wpShade = document.createElement('div');
      wpShade.className = 'dc-shade';
      wpKey = '';
    } else if (!wpShade || !wpShade.isConnected) {
      wpShade = host.querySelector('.dc-shade') || document.createElement('div');
      wpShade.className = 'dc-shade';
    }
    if (!host.isConnected) document.body.prepend(host);

    if (key !== wpKey) {
      releaseMedia(wpMedia);
      host.textContent = '';
      wpMedia = buildMedia(kind, src);
      host.append(wpMedia, wpShade);
      wpKey = key;
    }
    applyWallpaperStyle();
    updatePlayState();
  }

  // ============================================================
  //  Thème transparent (CSS compilé une seule fois, réglages par variables)
  // ============================================================
  const THEME_VARS = [
    '--background-primary', '--background-secondary', '--background-secondary-alt', '--background-tertiary',
    '--bg-base-primary', '--bg-base-secondary', '--bg-base-tertiary', '--background-base-low', '--background-base-lower',
    '--background-base-lowest', '--background-surface-high', '--background-surface-higher', '--background-surface-highest',
    '--bg-surface-overlay', '--bg-surface-raised', '--bg-app-frame', '--chat-background-default', '--home-background',
    '--bg-overlay-1', '--bg-overlay-2', '--bg-overlay-3', '--bg-overlay-4', '--bg-overlay-5', '--bg-overlay-6',
    '--bg-overlay-chat', '--bg-overlay-home', '--bg-overlay-home-card', '--bg-overlay-app-frame'
  ];
  const THEME_SELECTORS = [
    '[class*="bg_"]', '[class*="app_"]', '[class*="base_"]', '[class*="layers_"]', '[class*="layer_"]',
    '[class*="appAsidePanelWrapper_"]', '[class*="notAppAsidePanel_"]', '[class*="page_"]', 'main[class*="container_"]',
    '[class*="content_"]', '[class*="callContainer_"]', '[class*="chat_"]', '[class*="chatContent_"]',
    '[class*="channelChatWrapper_"]', '[class*="messagesWrapper_"]', '[class*="subtitleContainer_"]',
    '[class*="sidebar_"]', '[class*="privateChannels_"]', '[class*="sidebarList_"]', '[class*="peopleColumn_"]',
    '[class*="tabBody_"]', '[class*="nowPlayingColumn_"]', '[class*="members_"]', '[class*="membersWrap_"]',
    '[class*="userPanelOuter_"]', '[class*="userPanelInner_"]', '[class*="scroller_"]', '[class*="guilds_"]',
    'nav[class*="wrapper_"]', '[class*="tree_"]', '[class*="guildSeparator_"]', '[class*="panels_"]',
    '[class*="panels_"] > div', '[class*="activityPanel_"]', 'header[class*="header_"]', 'section[class*="title_"]',
    '[class*="container_"][class*="themed_"]', '[class*="bar_"][class*="title_"]', '[class*="searchBar_"]',
    '[class*="itemCard_"]', '[class*="outer_"][class*="interactive_"]', '[class*="inset_"]', '[class*="member_"]',
    '[class*="standardSidebarView_"]', '[class*="contentRegion_"]', '[class*="sidebarRegion_"]',
    '[class*="contentRegionScroller_"]', '[class*="sidebarRegionScroller_"]', '[class*="contentColumn_"]',
    '.custom-theme-background'
  ];
  let themeCss = '';
  function getThemeCss() {
    if (themeCss) return themeCss;
    themeCss =
      `:root,.theme-dark,.theme-darker,.theme-midnight,.theme-light,.custom-theme-background{${THEME_VARS.map((v) => `${v}:transparent!important`).join(';')};--custom-theme-background:none!important}` +
      'body{background:transparent!important}' +
      '#app-mount{position:relative!important;z-index:1!important;background:rgba(0,0,0,var(--dc-veil,.3))!important}' +
      `${THEME_SELECTORS.join(',')}{background:transparent!important;background-color:transparent!important;background-image:none!important}` +
      '#dc-wallpaper{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:#000;contain:strict}' +
      '#dc-wallpaper>.dc-media{position:absolute;inset:0;width:100%;height:100%;display:block;transition:opacity .6s ease}' +
      '#dc-wallpaper>.dc-shade{position:absolute;inset:0;background:#000;opacity:0}';
    return themeCss;
  }

  // Fenêtre Paramètres de Discord : noir pur légèrement transparent en pur CSS
  const SG_CSS =
    'html[data-dc-sg] [class*="standardSidebarView_"],' +
    'html[data-dc-sg] [role="dialog"]:has(#dc-settings-section){' +
    '--background-primary:transparent!important;--background-secondary:transparent!important;--background-secondary-alt:transparent!important;' +
    '--background-tertiary:transparent!important;--modal-background:transparent!important;--modal-footer-background:transparent!important;' +
    '--background-base-low:transparent!important;--background-base-lower:transparent!important;--background-base-lowest:transparent!important;' +
    '--bg-base-primary:transparent!important;--bg-base-secondary:transparent!important;--bg-base-tertiary:transparent!important;' +
    '--background-surface-high:rgba(0,0,0,.6)!important;--background-surface-higher:rgba(0,0,0,.7)!important;--background-surface-highest:rgba(0,0,0,.8)!important;' +
    'background:rgba(0,0,0,var(--dc-sdim,.82))!important;background-color:rgba(0,0,0,var(--dc-sdim,.82))!important;background-image:none!important;backdrop-filter:var(--dc-sbf,blur(10px))}' +
    'html[data-dc-sg] [class*="standardSidebarView_"] :is([class*="sidebarRegion_"],[class*="sidebarRegionScroller_"],[class*="contentRegion_"],[class*="contentRegionScroller_"],[class*="contentColumn_"]),' +
    'html[data-dc-sg] [role="dialog"]:has(#dc-settings-section) :is(nav,aside,main,[class*="container_"],[class*="modal_"],[class*="root_"],[class*="wrapper_"],[class*="sidebar"],[class*="content"],[class*="scroller"],[class*="pane_"],[class*="panel_"],[class*="header_"],[class*="body_"]):not(#dc-settings-embedded):not(#dc-settings-embedded *),' +
    'html[data-dc-sg] [class*="layer_"]:has(#dc-settings-section) > div:not([role="dialog"]),' +
    'html[data-dc-sg] [class*="layer_"]:has([class*="standardSidebarView_"]){background:transparent!important;background-color:transparent!important;background-image:none!important}';

  const APPEARANCE_PALETTES = {
    amoled: { p: '#000000', s: '#050507', t: '#0a0a0e' },
    obsidian: { p: '#09090b', s: '#0f0f12', t: '#16161a' },
    carbon: { p: '#111113', s: '#18181b', t: '#202024' },
    slate: { p: '#0f141b', s: '#151c26', t: '#1c2532' },
    midnight: { p: '#0a0d16', s: '#0f1320', t: '#151a2b' },
    abyss: { p: '#060d14', s: '#0a141f', t: '#0f1c2b' },
    violet: { p: '#0e0a16', s: '#150f22', t: '#1d152e' },
    crimson: { p: '#12080b', s: '#1a0c10', t: '#231016' },
    forest: { p: '#07110d', s: '#0b1914', t: '#10221c' },
    coffee: { p: '#120e0b', s: '#1a1410', t: '#231b15' }
  };
  const APPEARANCE_FONT_LIST = [
    ['default', 'gg sans (Défaut)', '"gg sans", "Noto Sans", "Segoe UI", system-ui, sans-serif', ''],
    ['inter', 'Inter', '"Inter", "Segoe UI", system-ui, sans-serif', 'Inter:wght@400;500;600;700'],
    ['poppins', 'Poppins', '"Poppins", "Segoe UI", system-ui, sans-serif', 'Poppins:wght@400;500;600;700'],
    ['montserrat', 'Montserrat', '"Montserrat", "Segoe UI", system-ui, sans-serif', 'Montserrat:wght@400;500;600;700'],
    ['roboto', 'Roboto', '"Roboto", "Segoe UI", system-ui, sans-serif', 'Roboto:wght@400;500;700'],
    ['opensans', 'Open Sans', '"Open Sans", "Segoe UI", system-ui, sans-serif', 'Open+Sans:wght@400;600;700'],
    ['outfit', 'Outfit', '"Outfit", "Segoe UI", system-ui, sans-serif', 'Outfit:wght@400;500;600;700'],
    ['plusjakarta', 'Plus Jakarta Sans', '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif', 'Plus+Jakarta+Sans:wght@400;500;600;700'],
    ['spacegrotesk', 'Space Grotesk', '"Space Grotesk", "Segoe UI", system-ui, sans-serif', 'Space+Grotesk:wght@400;500;700'],
    ['rubik', 'Rubik', '"Rubik", "Segoe UI", system-ui, sans-serif', 'Rubik:wght@400;500;600;700'],
    ['quicksand', 'Quicksand', '"Quicksand", "Segoe UI", system-ui, sans-serif', 'Quicksand:wght@500;600;700'],
    ['nunito', 'Nunito', '"Nunito", "Segoe UI", system-ui, sans-serif', 'Nunito:wght@400;600;700'],
    ['comfortaa', 'Comfortaa', '"Comfortaa", "Segoe UI", cursive, sans-serif', 'Comfortaa:wght@400;600;700'],
    ['rajdhani', 'Rajdhani', '"Rajdhani", "Segoe UI", sans-serif', 'Rajdhani:wght@500;600;700'],
    ['orbitron', 'Orbitron', '"Orbitron", "Segoe UI", sans-serif', 'Orbitron:wght@500;700'],
    ['jetbrains', 'JetBrains Mono', '"JetBrains Mono", Consolas, monospace', 'JetBrains+Mono:wght@400;500;700'],
    ['firacode', 'Fira Code', '"Fira Code", Consolas, monospace', 'Fira+Code:wght@400;500;700'],
    ['mono', 'Cascadia Mono', '"Cascadia Mono", "Cascadia Code", Consolas, monospace', ''],
    ['consolas', 'Consolas', 'Consolas, "Courier New", monospace', ''],
    ['courier', 'Courier New', '"Courier New", Courier, monospace', ''],
    ['segoe', 'Segoe UI', '"Segoe UI", system-ui, sans-serif', ''],
    ['verdana', 'Verdana', 'Verdana, Geneva, sans-serif', ''],
    ['tahoma', 'Tahoma', 'Tahoma, "Segoe UI", sans-serif', ''],
    ['trebuchet', 'Trebuchet MS', '"Trebuchet MS", "Segoe UI", sans-serif', ''],
    ['calibri', 'Calibri', 'Calibri, "Segoe UI", sans-serif', ''],
    ['candara', 'Candara', 'Candara, "Segoe UI", sans-serif', ''],
    ['georgia', 'Georgia Serif', 'Georgia, Cambria, "Times New Roman", serif', ''],
    ['playfair', 'Playfair Display', '"Playfair Display", Georgia, serif', 'Playfair+Display:wght@400;600;700'],
    ['garamond', 'Garamond', 'Garamond, Georgia, serif', ''],
    ['impact', 'Impact', 'Impact, Haettenschweiler, sans-serif', ''],
    ['rounded', 'Comic Sans / Arrondie', '"Comic Sans MS", "Nunito", "Segoe UI", sans-serif', '']
  ];
  const APPEARANCE_FONTS = Object.fromEntries(APPEARANCE_FONT_LIST.filter(([k]) => k !== 'default').map(([k, , css]) => [k, css]));
  const APPEARANCE_GFONTS = Object.fromEntries(APPEARANCE_FONT_LIST.filter(([, , , gf]) => gf).map(([k, , , gf]) => [k, gf]));

  function ensureGoogleFont(fontKey, allPreview = false) {
    if (allPreview) {
      if (document.getElementById('dc-gfont-all')) return;
      const fams = APPEARANCE_FONT_LIST.map(([, , , gf]) => gf).filter(Boolean).map((f) => `family=${f}`).join('&');
      if (!fams) return;
      const link = document.createElement('link');
      link.id = 'dc-gfont-all';
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?${fams}&display=swap`;
      document.head.appendChild(link);
      return;
    }
    const gf = APPEARANCE_GFONTS[fontKey];
    if (!gf) return;
    let link = document.getElementById('dc-gfont-active');
    const href = `https://fonts.googleapis.com/css2?family=${gf}&display=swap`;
    if (link && link.getAttribute('href') === href) return;
    if (!link) {
      link = document.createElement('link');
      link.id = 'dc-gfont-active';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = href;
  }

  function applyAppearance() {
    if (!config) return;
    const ap = config.appearance || {};
    if (!ap.enabled) {
      root.style.removeProperty('--dc-accent');
      root.style.removeProperty('--dc-accent-fg');
      setStyle('dreamcord-appearance-style', '');
      return;
    }
    const rules = [];
    const accent = '#ffffff';
    const fg = '#09090b';
    root.style.setProperty('--dc-accent', accent);
    root.style.setProperty('--dc-accent-fg', fg);
    rules.push(
      `:root,.theme-dark,.theme-darker,.theme-midnight,.theme-light{--brand-500:${accent}!important;--brand-560:${accent}!important;--brand-experiment:${accent}!important;--brand-experiment-560:${accent}!important;--control-brand-foreground:${accent}!important;--dc-accent:${accent};--dc-accent-fg:${fg}}` +
        `.dc-nc-hbtn.primary,.dc-btn.primary,.dc-sw input:checked+span{background:${accent}!important;color:${fg}!important}` +
        `.dc-sw input:checked+span:before{background:${fg}!important}` +
        `.dc-seg-btn.active,.dc-chip.active{background:${accent}!important;border-color:${accent}!important;color:${fg}!important}` +
        `.dc-nav-item.active{box-shadow:inset 2px 0 0 ${accent}!important}` +
        `#dc-nc-ring-prog{stroke:${accent}!important}` +
        `.dc-cl-list li::marker{color:${accent}!important}`
    );
    const pal = APPEARANCE_PALETTES[ap.palette];
    if (pal) {
      rules.push(
        `#dc-settings-embedded{--dc-bg:${pal.t}!important;--dc-surface:${pal.s}!important;--dc-surface-hi:${pal.p}!important}` +
        `#dc-settings-embedded .dc-sec,#dc-settings-embedded .dc-nc-card,#dc-settings-embedded .dc-nc-hero,#dc-settings-embedded .dc-nc-stat{background:${pal.s}!important}`
      );
      if (!wallpaperActive()) {
        rules.push(
          `:root,html,body,.theme-dark,.theme-darker,.theme-midnight,.visual-refresh,.visual-refresh.theme-dark,.visual-refresh.theme-darker,.visual-refresh.theme-midnight{` +
            `--background-primary:${pal.p}!important;--background-secondary:${pal.s}!important;--background-secondary-alt:${pal.s}!important;--background-tertiary:${pal.t}!important;` +
            `--background-floating:${pal.t}!important;--modal-background:${pal.p}!important;--modal-footer-background:${pal.s}!important;` +
            `--bg-base-primary:${pal.p}!important;--bg-base-secondary:${pal.s}!important;--bg-base-tertiary:${pal.t}!important;` +
            `--background-base-low:${pal.p}!important;--background-base-lower:${pal.s}!important;--background-base-lowest:${pal.t}!important;` +
            `--background-surface-high:${pal.s}!important;--background-surface-higher:${pal.s}!important;--background-surface-highest:${pal.p}!important;` +
            `--bg-surface-overlay:${pal.s}!important;--bg-surface-raised:${pal.s}!important;--bg-app-frame:${pal.t}!important;` +
            `--chat-background-default:${pal.p}!important;--home-background:${pal.p}!important;--channeltextarea-background:${pal.t}!important;--input-background:${pal.t}!important;` +
            `--bg-overlay-chat:${pal.p}!important;--bg-overlay-home:${pal.p}!important;--bg-overlay-app-frame:${pal.t}!important;` +
            `--bg-overlay-1:${pal.s}!important;--bg-overlay-2:${pal.s}!important;--bg-overlay-3:${pal.p}!important}` +
          `body,#app-mount,[class*="chatContent_"],[class*="messagesWrapper_"],[class*="peopleColumn_"],[class*="tabBody_"],[class*="contentRegion_"],[class*="contentRegionScroller_"]{background-color:${pal.p}!important}` +
          `[class*="sidebar_"],[class*="privateChannels_"],[class*="members_"],[class*="membersWrap_"],[class*="nowPlayingColumn_"],[class*="panels_"],[class*="sidebarRegion_"],[class*="sidebarRegionScroller_"]{background-color:${pal.s}!important}` +
          `[class*="guilds_"],[class*="titleBar_"],[class*="bar_"][class*="title_"],[class*="scrollableContainer_"],[class*="searchBar_"]{background-color:${pal.t}!important}` +
          `html[data-dc-sg] [class*="standardSidebarView_"],html[data-dc-sg] [role="dialog"]:has(#dc-settings-section){background-color:${pal.p}!important}` +
          `html[data-dc-sg] [role="dialog"]:has(#dc-settings-section) :is(nav,aside,[class*="sidebar"]){background-color:${pal.s}!important}`
        );
      } else {
        rules.push(
          `html[data-dc-sg] [class*="standardSidebarView_"],html[data-dc-sg] [role="dialog"]:has(#dc-settings-section){background:color-mix(in srgb,${pal.p} 82%,transparent)!important;background-color:color-mix(in srgb,${pal.p} 82%,transparent)!important}`
        );
      }
    }
    const font = APPEARANCE_FONTS[ap.fontFamily];
    if (font) {
      ensureGoogleFont(ap.fontFamily);
      rules.push(`:root,html,body,.visual-refresh,#app-mount,#dc-settings-embedded,#dc-settings-embedded :is(div,span,p,b,button,input,label):not(.dc-font-item):not(.dc-font-item *){--font-primary:${font}!important;--font-display:${font}!important;font-family:${font}!important}`);
    }
    const avR = clamp(ap.avatarRadius ?? 50, 0, 50);
    if (avR !== 50) {
      rules.push(`img[class*="avatar_"],svg[class*="mask_"] foreignObject{mask:none!important;border-radius:${avR}%!important;overflow:hidden!important}`);
    }
    const uiR = clamp(ap.borderRadius ?? 8, 0, 18);
    if (uiR !== 8) {
      rules.push(
        `[class*="channelTextArea_"] [class*="scrollableContainer_"],.dc-nc-card,.dc-nc-hero,.dc-nc-stat,.dc-sec,.dc-btn{border-radius:${uiR}px!important}`
      );
    }
    setStyle('dreamcord-appearance-style', rules.join('\n'));
  }

  function applyTheme() {
    if (!config) return;
    const on = wallpaperActive();
    const wp = config.wallpaper;
    const sg = wp.settingsGlass !== false;
    root.toggleAttribute('data-dc-wp', on);
    root.toggleAttribute('data-dc-sg', sg);
    setStyle('dreamcord-theme-style', on ? getThemeCss() : '');
    setStyle('dreamcord-sg-style', sg ? SG_CSS : '');
    const st = root.style;
    if (on) st.setProperty('--dc-veil', ((clamp(wp.uiOpacity, 0, 100) / 100) * 0.42).toFixed(3));
    else st.removeProperty('--dc-veil');
    if (sg) {
      st.setProperty('--dc-sdim', (clamp(wp.settingsDim, 0, 90) / 100).toFixed(2));
      const sb = clamp(wp.settingsBlur, 0, 30);
      st.setProperty('--dc-sbf', sb > 0 ? `blur(${sb}px)` : 'none');
    } else {
      st.removeProperty('--dc-sdim');
      st.removeProperty('--dc-sbf');
    }
  }

  // ============================================================
  //  CSS de base de DreamCord (une seule fois — monochrome Noir & Blanc)
  // ============================================================
  const BASE_CSS = `
    #dc-toast{position:fixed;bottom:20px;left:50%;transform:translate(-50%,8px);opacity:0;z-index:100030;padding:9px 16px;border-radius:10px;font:600 13px/1.3 "gg sans",Segoe UI,sans-serif;color:#ffffff;background:#16161a;border:1px solid rgba(255,255,255,.16);box-shadow:0 12px 32px rgba(0,0,0,.6);pointer-events:none;transition:opacity .18s ease,transform .18s cubic-bezier(.16,1,.3,1)}
    #dc-toast.show{opacity:1;transform:translate(-50%,0)}
    #dc-toast.dc-toast-error{background:#dc2626;border-color:rgba(255,255,255,.16);color:#ffffff}
    #dc-toast.dc-toast-ok{background:#ffffff;border-color:#ffffff;color:#09090b}
    .dc-translate-box{margin-top:4px;padding:6px 10px;border-left:2px solid #ffffff;background:rgba(255,255,255,.06);border-radius:0 6px 6px 0;font-size:12.5px;color:#f4f4f5}
    .dc-exact-ts{opacity:.65;font-size:.85em}
    #dc-call-timer{margin-left:6px;font-size:11px;font-weight:700;color:#a1a1aa;font-variant-numeric:tabular-nums}
    #dc-clock{position:fixed;top:5px;left:50%;transform:translateX(-50%);z-index:100000;padding:2px 11px;border-radius:99px;background:rgba(9,9,11,.72);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.88);font:600 12px/1.4 "gg sans",Segoe UI,sans-serif;letter-spacing:.04em;font-variant-numeric:tabular-nums;pointer-events:none}
    #dc-charcount{position:absolute;right:10px;bottom:100%;margin-bottom:4px;padding:1px 8px;border-radius:6px;background:rgba(9,9,11,.78);border:1px solid rgba(255,255,255,.1);color:#a1a1aa;font:600 11px/1.5 "gg sans",Segoe UI,sans-serif;pointer-events:none}
    #dc-charcount.warn{color:#fbbf24}#dc-charcount.bad{color:#f87171}
    .dc-up-btn{width:28px;height:28px;border-radius:6px;border:0;background:transparent;color:#d4d4d8;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;z-index:2;transition:background .12s,color .12s}
    .dc-up-btn:hover{background:rgba(255,255,255,.1);color:#ffffff}
    [class*="panels_"] [class*="buttons_"]{position:relative;z-index:2}
    #dc-settings-section{margin:6px 0;padding:8px 0;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08)}
    .dc-nav-hdr{padding:4px 10px 6px;font-size:11px;font-weight:800;letter-spacing:.09em;color:#ffffff;text-transform:uppercase;display:flex;align-items:center;gap:7px}
    .dc-nav-item{display:flex;align-items:center;gap:11px;padding:8px 10px;margin:2px 0;border-radius:8px;cursor:pointer;color:#a1a1aa;font-size:14.5px;font-weight:500;transition:background .12s,color .12s,box-shadow .12s;outline:none}
    .dc-nav-item:hover,.dc-nav-item:focus-visible{background:rgba(255,255,255,.07);color:#f4f4f5}
    .dc-nav-item.active{background:rgba(255,255,255,.1);color:#ffffff;font-weight:600;box-shadow:inset 2px 0 0 var(--dc-accent,#ffffff)}
    ${SHARED_MODAL_CSS}
  `;

  // Panneau DreamCord (dans les Paramètres Discord) : monochrome Noir & Blanc exécutif
  const PANEL_CSS = `
    #dc-settings-embedded{--dc-bg:#09090b;--dc-surface:#0f0f12;--dc-surface-hi:#16161a;--dc-bdr:rgba(255,255,255,.08);--dc-bdr-hi:rgba(255,255,255,.18);flex:1 1 auto;width:100%;height:100%;max-height:100vh;overflow-y:auto;padding:22px 28px 56px;background:transparent;color:#f4f4f5;font:13.5px/1.45 "gg sans","Noto Sans",Segoe UI,system-ui,sans-serif;contain:content}
    #dc-settings-embedded *{box-sizing:border-box}
    #dc-settings-embedded>*{max-width:980px}
    #dc-settings-embedded::-webkit-scrollbar{width:6px}#dc-settings-embedded::-webkit-scrollbar-track{background:transparent}#dc-settings-embedded::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px}#dc-settings-embedded::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.26)}
    .dc-body{display:flex;flex-direction:column;gap:14px}
    .dc-emb-head{position:sticky;top:0;z-index:6;background:rgba(9,9,11,.94);backdrop-filter:blur(12px);margin:0 0 14px;padding:12px 18px;border-radius:12px;border:1px solid var(--dc-bdr);display:flex;align-items:center;justify-content:space-between;gap:12px}
    .dc-emb-title{font-size:16px;font-weight:700;color:#ffffff;display:flex;align-items:center;gap:9px;min-width:0;letter-spacing:-.01em}
    .dc-emb-title small{font-size:11px;font-weight:600;color:#d4d4d8;background:#16161a;border:1px solid rgba(255,255,255,.12);padding:2px 9px;border-radius:99px;white-space:nowrap}
    .dc-lang-btn{height:29px;padding:0 10px;border-radius:8px;border:1px solid var(--dc-bdr);background:#16161a;color:#a1a1aa;font:700 11px/1 "gg sans",Segoe UI,sans-serif;letter-spacing:.05em;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:border-color .14s,color .14s,background .14s}
    .dc-lang-btn:hover{border-color:var(--dc-bdr-hi);background:#1e1e23;color:#ffffff}
    .dc-lang-btn b{color:#ffffff}
    .dc-search-wrap{position:relative;flex:1;display:flex;align-items:center}
    .dc-search-ico{position:absolute;left:13px;color:#71717a;display:inline-flex;pointer-events:none}
    .dc-search-clr{position:absolute;right:8px;width:22px;height:22px;border-radius:6px;border:0;background:rgba(255,255,255,.08);color:#a1a1aa;font-size:14px;line-height:1;cursor:pointer;display:none;align-items:center;justify-content:center;transition:background .12s,color .12s}
    .dc-search-clr.show{display:inline-flex}
    .dc-search-clr:hover{background:rgba(255,255,255,.16);color:#ffffff}
    .dc-vc-search{width:100%;height:40px;background:var(--dc-bg);border:1px solid var(--dc-bdr);color:#ffffff;border-radius:10px;padding:0 36px 0 38px;font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
    .dc-vc-search::placeholder{color:#71717a}
    .dc-vc-search:focus{border-color:rgba(255,255,255,.32)}
    .dc-chips{display:flex;gap:6px;flex-wrap:wrap}
    .dc-chip{height:29px;padding:0 12px;border-radius:99px;border:1px solid var(--dc-bdr);background:var(--dc-surface);color:#a1a1aa;font:600 12px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:background .14s,border-color .14s,color .14s}
    .dc-chip:hover{background:var(--dc-surface-hi);border-color:var(--dc-bdr-hi);color:#ffffff}
    .dc-chip.active{background:var(--dc-accent,#ffffff);border-color:var(--dc-accent,#ffffff);color:var(--dc-accent-fg,#09090b)}
    .dc-font-list{max-height:212px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;padding:4px 4px 2px 0;margin-top:8px}
    .dc-font-list::-webkit-scrollbar{width:5px}.dc-font-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:99px}
    .dc-font-item{height:38px;padding:0 12px;border-radius:9px;border:1px solid var(--dc-bdr);background:var(--dc-bg);color:#d4d4d8;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;transition:background .12s,border-color .12s,color .12s}
    .dc-font-item:hover{background:var(--dc-surface-hi);border-color:var(--dc-bdr-hi);color:#ffffff}
    .dc-font-item.active{background:var(--dc-accent,#ffffff);border-color:var(--dc-accent,#ffffff);color:var(--dc-accent-fg,#09090b);font-weight:700}
    .dc-font-item small{font-size:11px;opacity:.68;white-space:nowrap}
    .dc-info-box{padding:10px 12px;border-radius:9px;background:var(--dc-bg);border:1px solid var(--dc-bdr);border-left:2px solid var(--dc-accent,#ffffff);font-size:12px;color:#d4d4d8;line-height:1.48;display:flex;flex-direction:column;gap:4px}
    .dc-info-box b{color:#ffffff}
    .dc-empty{padding:34px 20px;text-align:center;color:#71717a;font-size:13px;border-radius:12px;background:var(--dc-surface);border:1px dashed var(--dc-bdr)}
    .dc-hero{display:flex;gap:18px;align-items:stretch}
    .dc-preview{width:240px;height:135px;border-radius:10px;background:var(--dc-bg);border:1px solid var(--dc-bdr);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#71717a;font-size:12px;position:relative}
    .dc-preview video,.dc-preview img{width:100%;height:100%;object-fit:cover;display:block}
    .dc-preview-badge{position:absolute;top:8px;left:8px;padding:2px 7px;border-radius:6px;background:rgba(9,9,11,.84);border:1px solid rgba(255,255,255,.16);color:#ffffff;font:700 10px/1.3 "gg sans",Segoe UI,sans-serif;letter-spacing:.05em;text-transform:uppercase}
    .dc-hero-info{flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0;gap:10px}
    .dc-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .dc-div-row{padding-top:13px;border-top:1px solid rgba(255,255,255,.07)}
    .dc-dimmed{opacity:.4;pointer-events:none;transition:opacity .15s}
    .dc-sec{padding:17px 19px;border-radius:12px;background:var(--dc-surface);border:1px solid var(--dc-bdr);display:flex;flex-direction:column;gap:13px;transition:border-color .15s}
    .dc-sec:hover{border-color:rgba(255,255,255,.13)}
    .dc-sec-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .dc-sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#a1a1aa;display:flex;align-items:center;gap:8px}
    .dc-sec-tag{font-size:10.5px;font-weight:700;text-transform:none;letter-spacing:0;padding:2px 9px;border-radius:99px;background:var(--dc-accent,#ffffff);border:1px solid transparent;color:var(--dc-accent-fg,#09090b);transition:all .15s}
    .dc-sec-tag.off{background:#16161a;border-color:rgba(255,255,255,.1);color:#71717a}
    .dc-cl-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .dc-cl-ver{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:#ffffff}
    .dc-cl-date{font-size:12px;color:#71717a;font-weight:500}
    .dc-cl-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.05em}
    .dc-cl-badge.new{background:#ffffff;color:#09090b}
    .dc-cl-badge.fix{background:#16161a;border:1px solid rgba(255,255,255,.16);color:#e4e4e7}
    .dc-cl-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px;color:#d4d4d8;font-size:13px;line-height:1.5}
    .dc-cl-list li::marker{color:var(--dc-accent,#ffffff)}
    .dc-lbl{font-weight:600;font-size:14px;color:#f4f4f5}
    .dc-sub{color:#71717a;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dc-btns{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dc-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:var(--dc-surface-hi);color:#f4f4f5;font-weight:600;font-size:12.5px;font-family:inherit;cursor:pointer;transition:background .14s,border-color .14s,color .14s,opacity .14s,transform .1s;display:inline-flex;align-items:center;gap:6px}
    .dc-btn:hover{background:#222227;border-color:var(--dc-bdr-hi);color:#ffffff}
    .dc-btn:active{transform:scale(.98)}
    .dc-btn:disabled{opacity:.38;pointer-events:none}
    .dc-btn.primary{background:var(--dc-accent,#ffffff);border-color:transparent;color:var(--dc-accent-fg,#09090b);font-weight:700}.dc-btn.primary:hover{opacity:.88}
    .dc-btn.small{height:30px;padding:0 11px;font-size:12px}
    .dc-btn.danger{color:#f87171;border-color:rgba(239,68,68,.28);background:rgba(239,68,68,.09)}.dc-btn.danger:hover{background:#dc2626;border-color:#dc2626;color:#ffffff}
    .dc-urlrow{display:flex;gap:8px}
    .dc-in{flex:1;height:36px;background:var(--dc-bg);border:1px solid var(--dc-bdr);color:#ffffff;border-radius:8px;padding:0 12px;font-size:13px;font-family:inherit;outline:none;min-width:0;color-scheme:dark;transition:border-color .15s}
    .dc-in::placeholder{color:#71717a}
    .dc-in:focus{border-color:rgba(255,255,255,.32)}
    textarea.dc-code{width:100%;min-height:310px;resize:vertical;padding:13px 14px;font:12.5px/1.6 "Cascadia Code",Consolas,monospace;height:auto;white-space:pre;tab-size:2;background:var(--dc-bg)}
    .dc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px 22px}
    .dc-rt{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;font-size:12.5px;color:#d4d4d8}
    .dc-rt b{color:#ffffff;font-weight:700;font-variant-numeric:tabular-nums}
    #dc-settings-embedded input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent,#ffffff) var(--p,50%),rgba(255,255,255,.14) var(--p,50%));outline:none;margin:0;cursor:pointer}
    #dc-settings-embedded input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#ffffff;border:2px solid #09090b;box-shadow:0 1px 4px rgba(0,0,0,.55);cursor:pointer;transition:transform .12s}
    #dc-settings-embedded input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.12)}
    .dc-sw{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0}
    .dc-sw input{opacity:0;width:0;height:0}
    .dc-sw span{position:absolute;inset:0;cursor:pointer;border-radius:999px;background:#222226;border:1px solid rgba(255,255,255,.1);transition:background .16s ease,border-color .16s ease}
    .dc-sw span:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#a1a1aa;transition:transform .16s cubic-bezier(.16,1,.3,1),background .16s ease}
    .dc-sw input:checked+span{background:var(--dc-accent,#ffffff);border-color:transparent}.dc-sw input:checked+span:before{transform:translateX(20px);background:var(--dc-accent-fg,#09090b)}
    .dc-sw input:focus-visible+span{outline:2px solid rgba(255,255,255,.5);outline-offset:2px}
    .dc-seg{display:flex;flex-wrap:wrap;gap:6px}
    .dc-seg-btn{height:31px;padding:0 12px;border-radius:8px;border:1px solid var(--dc-bdr);background:var(--dc-surface-hi);color:#a1a1aa;font:600 12px/1 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:background .14s,border-color .14s,color .14s}
    .dc-seg-btn:hover{border-color:var(--dc-bdr-hi);background:#222227;color:#ffffff}
    .dc-seg-btn.active{background:var(--dc-accent,#ffffff);border-color:var(--dc-accent,#ffffff);color:var(--dc-accent-fg,#09090b);font-weight:700}
    @keyframes dc-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
    #dc-settings-embedded.dc-anim .dc-body{animation:dc-fade .14s ease-out}
    .dc-btn:focus-visible,.dc-in:focus-visible,.dc-seg-btn:focus-visible,.dc-chip:focus-visible,.dc-nc-ibtn:focus-visible,.dc-lang-btn:focus-visible{outline:2px solid rgba(255,255,255,.45);outline-offset:2px}
    .dc-cf-item{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.07);gap:12px}
    .dc-cf-item:last-child{border-bottom:0}
    .dc-cf-item.off{opacity:.5}
    .dc-cf-av-fallback{width:40px;height:40px;border-radius:50%;background:var(--dc-surface-hi);border:1px solid rgba(255,255,255,.14);color:#ffffff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0}
    .dc-cf-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
    .dc-cf-chip{font-size:10.5px;padding:1.5px 7px;border-radius:99px;background:var(--dc-surface-hi);border:1px solid var(--dc-bdr);color:#d4d4d8}
    .dc-nc-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 22px;border-radius:12px;background:var(--dc-surface);border:1px solid var(--dc-bdr)}
    .dc-nc-hero-l{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
    .dc-nc-hero-brand{display:flex;align-items:center;gap:9px}
    .dc-nc-hero-mark{width:28px;height:28px;border-radius:7px;background:var(--dc-bg);border:1px solid rgba(255,255,255,.14);color:#ffffff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
    .dc-nc-hero-t{font-size:16px;font-weight:700;color:#ffffff;letter-spacing:-.01em}
    .dc-nc-hero-s{font-size:12.5px;color:#a1a1aa;line-height:1.45;max-width:480px}
    .dc-nc-hero-actions{margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dc-nc-reset{height:29px;padding:0 12px;border-radius:7px;border:1px solid rgba(239,68,68,.28);background:rgba(239,68,68,.09);color:#f87171;font:700 11px/1 "gg sans",Segoe UI,sans-serif;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
    .dc-nc-reset:hover{background:#dc2626;border-color:#dc2626;color:#ffffff}
    .dc-nc-hero-r{display:flex;flex-direction:column;gap:7px;min-width:255px;flex-shrink:0}
    .dc-nc-hbtn{height:33px;padding:0 14px;border-radius:8px;border:1px solid var(--dc-bdr);background:var(--dc-surface-hi);color:#e4e4e7;font:700 11px/1 "gg sans",Segoe UI,sans-serif;letter-spacing:.03em;text-transform:uppercase;cursor:pointer;transition:background .14s,border-color .14s,color .14s,opacity .14s;text-align:center}
    .dc-nc-hbtn:hover{background:#222227;border-color:var(--dc-bdr-hi);color:#ffffff}
    .dc-nc-hbtn.primary{background:var(--dc-accent,#ffffff);border-color:transparent;color:var(--dc-accent-fg,#09090b);text-transform:none;font-size:12.5px;font-weight:700}
    .dc-nc-hbtn.primary:hover{opacity:.88}
    .dc-nc-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .dc-nc-stat{padding:15px 16px;border-radius:12px;background:var(--dc-surface);border:1px solid var(--dc-bdr);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;transition:border-color .15s}
    .dc-nc-stat:hover{border-color:var(--dc-bdr-hi)}
    .dc-nc-stat-lbl{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#71717a}
    .dc-nc-stat-val{font-size:21px;font-weight:800;color:#ffffff;display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
    .dc-nc-stat-val small{font-size:12.5px;font-weight:600;color:#71717a}
    .dc-nc-ring{width:20px;height:20px;transform:rotate(-90deg)}
    .dc-nc-bar{display:flex;flex-direction:column;gap:9px;padding:12px 14px;border-radius:12px;background:var(--dc-surface);border:1px solid var(--dc-bdr)}
    .dc-nc-res-count{font-size:11.5px;font-weight:600;color:#71717a;margin:-4px 2px 2px;display:flex;align-items:center;justify-content:space-between}
    .dc-nc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .dc-nc-card{display:flex;flex-direction:column;justify-content:space-between;gap:12px;padding:15px 16px;border-radius:12px;background:var(--dc-surface);border:1px solid var(--dc-bdr);content-visibility:auto;contain-intrinsic-size:138px;transition:border-color .15s,background .15s,box-shadow .15s}
    .dc-nc-card:hover{background:var(--dc-surface-hi);border-color:var(--dc-bdr-hi)}
    .dc-nc-card[data-on="1"]{border-color:rgba(255,255,255,.24);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 6px 18px rgba(0,0,0,.28)}
    .dc-nc-cat{padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#a1a1aa;font:600 10.5px/1.3 "gg sans",Segoe UI,sans-serif;letter-spacing:.02em}
    .dc-nc-card-head{display:flex;align-items:center;gap:7px;min-width:0}
    .dc-nc-ico{width:15px;height:15px;color:#71717a;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;transition:color .15s}
    .dc-nc-card[data-on="1"] .dc-nc-ico{color:var(--dc-accent,#ffffff)}
    .dc-nc-name{font-size:13.5px;font-weight:700;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
    .dc-nc-new{margin-left:auto;padding:2px 6px;border-radius:99px;background:#ffffff;color:#09090b;font:800 9px/1.2 "gg sans",Segoe UI,sans-serif;letter-spacing:.06em;text-transform:uppercase;flex-shrink:0}
    .dc-nc-desc{font-size:12px;color:#a1a1aa;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:34px}
    .dc-nc-card.open .dc-nc-desc{-webkit-line-clamp:unset}
    .dc-nc-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:6px;border-top:1px solid rgba(255,255,255,.06)}
    .dc-nc-icons{display:flex;align-items:center;gap:4px}
    .dc-nc-ibtn{width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:#8e929f;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .12s,color .12s}
    .dc-nc-ibtn:hover{background:rgba(255,255,255,.09);color:#ffffff}
    .dc-nc-ibtn.active{color:#09090b;background:#ffffff}
    .dc-nc-ibtn.fav{color:#ffffff}
    .dc-nc-ibtn.fav svg{fill:#ffffff}
    .dc-app-swatches{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
    .dc-app-sw{width:27px;height:27px;border-radius:8px;border:2px solid rgba(255,255,255,.16);cursor:pointer;padding:0;transition:transform .12s,border-color .12s,box-shadow .12s}
    .dc-app-sw:hover{transform:scale(1.08);border-color:#ffffff}
    .dc-app-sw.active{border-color:#ffffff;box-shadow:0 0 0 2px rgba(255,255,255,.28)}
    .dc-app-col-wrap{display:inline-flex;align-items:center;gap:6px;height:29px;padding:0 8px 0 4px;border-radius:8px;border:1px solid var(--dc-bdr-hi);background:var(--dc-bg)}
    .dc-app-col{width:22px;height:22px;padding:0;border-radius:5px;border:0;background:transparent;cursor:pointer}
    .dc-app-hex{font:600 11.5px/1 Consolas,monospace;color:#e4e4e7;text-transform:uppercase}
    .dc-kbd-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 14px}
    .dc-kbd-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 11px;border-radius:8px;background:var(--dc-bg);border:1px solid var(--dc-bdr);font-size:12.5px;color:#d4d4d8}
    .dc-kbd{padding:2px 7px;border-radius:6px;background:var(--dc-surface-hi);border:1px solid rgba(255,255,255,.14);color:#ffffff;font:700 11px/1.4 Consolas,monospace;white-space:nowrap}
    .dc-theme-pills{display:flex;flex-wrap:wrap;gap:6px}
    .dc-theme-pill{padding:3px 9px;border-radius:7px;background:var(--dc-surface-hi);border:1px solid rgba(255,255,255,.12);color:#e4e4e7;font:600 11.5px/1.3 Consolas,monospace}
    @media (max-width:900px){.dc-grid,.dc-nc-grid,.dc-nc-stats,.dc-kbd-grid{grid-template-columns:1fr}.dc-hero,.dc-nc-hero{flex-direction:column;align-items:stretch}.dc-preview{width:100%}.dc-nc-hero-r{min-width:0}}
    @media (prefers-reduced-motion:reduce){#dc-settings-embedded .dc-body{animation:none}}
  `;


  // ============================================================
  //  Sauvegarde (différée) + mémo pour l'écran de chargement
  // ============================================================
  let saveTimer = 0;
  function persistLocal() {
    try {
      localStorage.setItem('dreamcord:splash', '1');
    } catch {}
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      Bridge.save(config);
      persistLocal();
    }, 250);
  }
  function applyAll() {
    applyTheme();
    applyAppearance();
    updateWallpaper();
    syncPlugins();
  }

  function iconEl(name, size = 18) {
    const s = document.createElement('span');
    s.style.cssText = 'display:inline-flex;align-items:center;justify-content:center';
    setHTML(s, svgStr(name, size));
    return s;
  }
  function logoEl(size = 18) {
    const s = document.createElement('span');
    s.style.cssText = 'display:inline-flex;align-items:center;justify-content:center';
    setHTML(s, logoSvg(size));
    return s;
  }

  // ============================================================
  //  Intégration dans les Paramètres Discord
  // ============================================================
  let embeddedTab = null; // 'plugins' | 'personalization' | 'changelog' | 'credits'
  let subPage = null; // null | id d'un plugin
  let filter = 'all';
  let query = '';
  let pendingOpen = false;
  let pendingOpenTimer = 0;

  let cachedSettingsParts = null;
  function findSettingsParts() {
    if (cachedSettingsParts && cachedSettingsParts.sidebarList.isConnected && cachedSettingsParts.contentPane.isConnected) {
      return cachedSettingsParts;
    }
    cachedSettingsParts = null;
    const scope = document.querySelector('[class*="standardSidebarView_"]');
    if (scope) {
      const fastList = scope.querySelector('[class*="sidebarRegion_"] [role="tablist"], [class*="sidebar_"] [role="tablist"]');
      const fastPane = scope.querySelector('[class*="contentRegion_"]');
      if (fastList && fastPane) return (cachedSettingsParts = { sidebarList: fastList, contentPane: fastPane });
    }
    let fallbackScope = scope;
    if (!fallbackScope) {
      for (const dlg of document.querySelectorAll('[role="dialog"]')) {
        if (isIgnoredDialog(dlg)) continue;
        const nav = dlg.querySelector('nav, aside, [role="tablist"]');
        if (nav && /Apparence|Appearance|Déconnexion|Log Out/.test(nav.textContent || '')) {
          fallbackScope = dlg;
          break;
        }
      }
    }
    if (!fallbackScope) {
      const topLayer = document.querySelector('[class*="layer_"]:not([class*="baseLayer_"])');
      if (topLayer) {
        const nav = topLayer.querySelector('nav, aside, [role="tablist"]');
        if (nav && /Apparence|Appearance|Déconnexion|Log Out/.test(nav.textContent || '')) fallbackScope = topLayer;
      }
    }
    if (!fallbackScope) return null;
    const navHint = fallbackScope.querySelector('nav, aside, [role="tablist"]');
    if (navHint && !/Apparence|Appearance|Déconnexion|Log Out/.test(navHint.textContent || '')) return null;

    const matchAnchor = (el) => {
      if (el.children.length > 2) return false;
      const t = (el.textContent || '').trim();
      return t === 'Apparence' || t === 'Appearance' || t === 'Déconnexion' || t === 'Log Out';
    };
    let anchor = null;
    for (const el of fallbackScope.querySelectorAll('[role="tab"]')) {
      if (matchAnchor(el)) {
        anchor = el;
        break;
      }
    }
    if (!anchor) {
      const narrow = navHint || fallbackScope;
      for (const el of narrow.querySelectorAll('div, button, li, span')) {
        if (matchAnchor(el)) {
          anchor = el;
          break;
        }
      }
    }
    if (!anchor) return null;

    let sidebarList = anchor.parentElement;
    while (sidebarList && sidebarList !== document.body) {
      const txt = sidebarList.textContent || '';
      if (
        (txt.includes('Expérience') || txt.includes('Appearance')) &&
        (txt.includes('Facturation') || txt.includes('Déconnexion') || txt.includes('Log Out')) &&
        sidebarList.children.length >= 3
      )
        break;
      sidebarList = sidebarList.parentElement;
    }
    if (!sidebarList || sidebarList === document.body) return null;

    let col = sidebarList;
    while (col && col.parentElement && col.parentElement !== document.body) {
      const p = col.parentElement;
      const sibs = Array.from(p.children).filter((c) => c !== col && c.offsetWidth > 260 && c.offsetHeight > 200);
      if (sibs.length > 0 && p.offsetWidth > 520) return (cachedSettingsParts = { sidebarList, contentPane: sibs[0] });
      col = p;
    }
    return null;
  }

  function markNav() {
    document.querySelectorAll('#dc-settings-section [data-dc-nav]').forEach((n) => {
      const isAct = n.dataset.dcNav === embeddedTab;
      n.classList.toggle('active', isAct);
      n.setAttribute('aria-selected', isAct ? 'true' : 'false');
    });
  }

  function unmountEmbedded() {
    document.getElementById('dc-settings-embedded')?.remove();
    document.querySelectorAll('[data-dc-hidden="1"]').forEach((el) => {
      el.style.display = '';
      delete el.dataset.dcHidden;
    });
    embeddedTab = null;
    subPage = null;
    markNav();
  }

  function mountEmbedded(tab = 'plugins') {
    const region = findSettingsParts()?.contentPane;
    if (!region) return false;
    if (tab !== embeddedTab) subPage = null;
    embeddedTab = tab;
    setStyle('dc-panel-css', PANEL_CSS);
    for (const child of Array.from(region.children)) {
      if (child.id === 'dc-settings-embedded') continue;
      if (child.style.display !== 'none') {
        child.dataset.dcHidden = '1';
        child.style.display = 'none';
      }
    }
    let box = document.getElementById('dc-settings-embedded');
    if (!box) {
      box = document.createElement('div');
      box.id = 'dc-settings-embedded';
      region.appendChild(box);
      bindBox(box);
    }
    markNav();
    render(box);
    return true;
  }

  function openDreamCord(tab = 'plugins') {
    if (mountEmbedded(tab)) return;
    pendingOpen = tab;
    clearInterval(pendingOpenTimer);
    let tries = 0;
    pendingOpenTimer = setInterval(() => {
      tries++;
      ensureLauncher();
      if (!pendingOpen || tries >= 30) {
        clearInterval(pendingOpenTimer);
        pendingOpenTimer = 0;
        if (tries >= 30) pendingOpen = false;
      }
    }, 45);
    document.querySelector('button[aria-label*="Paramètres" i], button[aria-label*="User Settings" i]')?.click();
  }

  function ensureLauncher() {
    if (!config || !document.body) return;

    if (!document.getElementById('dc-userpanel-btn')) {
      const gear = document.querySelector('button[aria-label*="Paramètres" i], button[aria-label*="User Settings" i]');
      const group = gear?.parentElement || document.querySelector('[class*="panels_"] [class*="buttons_"]');
      if (group) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'dc-userpanel-btn';
        btn.className = 'dc-up-btn';
        btn.title = 'DreamCord';
        btn.setAttribute('aria-label', 'DreamCord');
        btn.appendChild(logoEl(18));
        btn.onclick = (e) => {
          e.stopPropagation();
          openDreamCord('plugins');
        };
        group.prepend(btn);
      }
    }

    if (document.getElementById('dc-settings-section')) {
      if (pendingOpen) {
        const t = pendingOpen;
        pendingOpen = false;
        clearInterval(pendingOpenTimer);
        pendingOpenTimer = 0;
        mountEmbedded(t);
      }
      return;
    }

    const parts = findSettingsParts();
    if (!parts) {
      if (embeddedTab) {
        embeddedTab = null;
        subPage = null;
      }
      return;
    }
    const { sidebarList } = parts;
    const sec = document.createElement('div');
    sec.id = 'dc-settings-section';
    const hdr = document.createElement('div');
    hdr.className = 'dc-nav-hdr';
    hdr.appendChild(logoEl(14));
    const hdrTxt = document.createElement('span');
    hdrTxt.textContent = 'DreamCord';
    hdr.appendChild(hdrTxt);
    sec.appendChild(hdr);
    for (const t of [
      { id: 'plugins', label: 'Plugins', icon: 'layers' },
      { id: 'personalization', label: L('Personnalisation', 'Personalization'), icon: 'wallpaper' },
      { id: 'changelog', label: L('Journal de mise à jour', 'Update Logs'), icon: 'changelog' },
      { id: 'credits', label: L('À propos', 'About'), icon: 'info' }
    ]) {
      const item = document.createElement('div');
      item.className = 'dc-nav-item';
      item.dataset.dcNav = t.id;
      item.setAttribute('role', 'tab');
      item.setAttribute('tabindex', '0');
      item.appendChild(iconEl(t.icon, 15));
      const lbl = document.createElement('span');
      lbl.textContent = t.label;
      item.appendChild(lbl);
      const activate = (e) => {
        e.stopPropagation();
        mountEmbedded(t.id);
      };
      item.onclick = activate;
      item.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(e);
        }
      };
      sec.appendChild(item);
    }
    const billing = Array.from(sidebarList.children).find((c) => /Facturation|Billing/.test(c.textContent || ''));
    if (billing) sidebarList.insertBefore(sec, billing);
    else sidebarList.appendChild(sec);
    markNav();

    if (!sidebarList.dataset.dcListener) {
      sidebarList.dataset.dcListener = '1';
      sidebarList.addEventListener(
        'click',
        (e) => {
          if (embeddedTab && !e.target.closest?.('#dc-settings-section')) unmountEmbedded();
        },
        true
      );
    }
    if (pendingOpen) {
      const t = pendingOpen;
      pendingOpen = false;
      clearInterval(pendingOpenTimer);
      pendingOpenTimer = 0;
      mountEmbedded(t);
    }
  }

  // ============================================================
  //  Pages du panneau (HTML en une passe, événements délégués)
  // ============================================================
  const sw = (checked, attrs) =>
    `<label class="dc-sw"><input type="checkbox" ${attrs}${checked ? ' checked' : ''}><span></span></label>`;

  const rangePct = (v, min, max) => (max > min ? Math.round(((clamp(v, min, max) - min) / (max - min)) * 100) : 0);
  const range = (scope, id, k, label, min, max, step, unit, value) =>
    `<div><div class="dc-rt"><span>${esc(label)}</span><b>${esc(value)}${esc(unit)}</b></div>` +
    `<input type="range" data-scope="${scope}" data-id="${esc(id)}" data-k="${esc(k)}" data-unit="${esc(unit)}" min="${min}" max="${max}" step="${step}" value="${value}" style="--p:${rangePct(value, min, max)}%"></div>`;

  const CATS = () => [
    ['all', L('Tous les plugins', 'All plugins')],
    ['on', L('Activés', 'Enabled')],
    ['fav', L('Favoris', 'Favorites')],
    ['ui', L('Interface', 'UI')],
    ['chat', 'Chat'],
    ['privacy', L('Discret', 'Privacy')],
    ['tools', L('Outils', 'Tools')]
  ];
  const CAT_TAG = (cat) =>
    ({ ui: L('Interface', 'UI'), chat: 'Chat', privacy: L('Discret', 'Privacy'), tools: L('Outils', 'Tools') }[cat] || cat);
  const CAT_ICON = (cat) => ({ ui: 'layout', chat: 'send', privacy: 'shield', tools: 'zap' }[cat] || 'plug');

  const openInfo = new Set();
  const isOn = (p) => (p.isWallpaper ? Boolean(config.wallpaper.enabled) : Boolean(config.plugins[p.id]));
  const isFav = (p) => Boolean(config.favoritePlugins?.[p.id]);
  const hasSettings = (p) => Boolean(p.hasPage || p.sliders || p.choices);
  const pName = (p) => (isEn() && PLUGIN_I18N[p.id]?.enName) || p.name;
  const pDesc = (p) => (isEn() && PLUGIN_I18N[p.id]?.enDesc) || p.desc;
  const langToggleBtn = () =>
    `<button type="button" class="dc-lang-btn" data-act="lang" title="FR / EN">${isEn() ? 'FR / <b>EN</b>' : '<b>FR</b> / EN'}</button>`;

  const infoBoxHtml = (infoPair) =>
    `<div class="dc-info-box"><div><b>${esc(L('Rôle', 'Role'))} :</b> ${esc(infoPair[0])}</div><div><b>${esc(L('Où', 'Where'))} :</b> ${esc(infoPair[1])}</div></div>`;

  const cardHtml = (p) => {
    const t = PLUGIN_I18N[p.id];
    const infoPair = isEn() ? t?.enInfo : t?.frInfo;
    const showInfo = openInfo.has(p.id) && infoPair;
    const fav = isFav(p);
    const fullDesc = infoPair?.[0] || pDesc(p);
    const choicesHtml = (p.choices || [])
      .map((c) => {
        const cur = pluginSetting(p.id, c.key, c.def);
        return (
          `<div class="dc-seg" style="margin-top:4px">` +
          c.items
            .map(
              ([v, l]) =>
                `<button type="button" class="dc-seg-btn${cur === v ? ' active' : ''}" style="height:24px;padding:0 9px;font-size:11px" data-act="pl-choice" data-id="${esc(p.id)}" data-k="${esc(c.key)}" data-v="${esc(v)}">${esc(l)}</button>`
            )
            .join('') +
          `</div>`
        );
      })
      .join('');
    return (
      `<div class="dc-nc-card${showInfo ? ' open' : ''}" data-on="${isOn(p) ? 1 : 0}" data-card="${esc(p.id)}">` +
      `<div class="dc-nc-card-top" style="display:flex;flex-direction:column;gap:8px">` +
      `<div class="dc-nc-card-head"><span class="dc-nc-ico">${svgStr(p.icon || CAT_ICON(p.cat), 12)}</span><span class="dc-nc-name">${esc(pName(p))}</span>${p.isNew ? '<span class="dc-nc-new">NEW</span>' : ''}</div>` +
      `<div class="dc-nc-desc">${esc(fullDesc)}</div>` +
      choicesHtml +
      (showInfo ? infoBoxHtml(infoPair) : '') +
      `</div>` +
      `<div class="dc-nc-foot">` +
      `<div class="dc-nc-icons">` +
      (infoPair ? `<button type="button" class="dc-nc-ibtn${showInfo ? ' active' : ''}" data-act="info" data-id="${esc(p.id)}" title="${esc(L('Détails', 'Details'))}">${svgStr('eye', 16)}</button>` : '') +
      `<button type="button" class="dc-nc-ibtn${fav ? ' fav' : ''}" data-act="fav" data-id="${esc(p.id)}" title="${esc(L('Favori', 'Favorite'))}">${svgStr('heart', 16)}</button>` +
      (hasSettings(p) ? `<button type="button" class="dc-nc-ibtn" data-act="gear" data-id="${esc(p.id)}" title="${esc(L('Réglages', 'Settings'))}">${svgStr('gear', 16)}</button>` : '') +
      `<span class="dc-nc-cat">${esc(CAT_TAG(p.cat))}</span>` +
      `</div>` +
      sw(isOn(p), `data-act="toggle" data-id="${esc(p.id)}"`) +
      `</div></div>`
    );
  };

  function cardsHtml() {
    const q = query.trim().toLowerCase();
    const list = PLUGINS.filter((p) => {
      if (filter === 'on' && !isOn(p)) return false;
      if (filter === 'fav' && !isFav(p)) return false;
      if (filter !== 'all' && filter !== 'on' && filter !== 'fav' && p.cat !== filter) return false;
      return !q || (pName(p) + ' ' + pDesc(p) + ' ' + p.name + ' ' + CAT_TAG(p.cat)).toLowerCase().includes(q);
    }).sort((a, b) => pName(a).localeCompare(pName(b), isEn() ? 'en' : 'fr'));
    if (!list.length) return `<div class="dc-empty">${esc(L('Aucun plugin trouvé', 'No plugins found'))}</div>`;
    return `<div class="dc-nc-res-count"><span>${list.length} ${esc(L(list.length > 1 ? 'plugins affichés' : 'plugin affiché', list.length > 1 ? 'plugins shown' : 'plugin shown'))}</span></div><div class="dc-nc-grid">${list.map(cardHtml).join('')}</div>`;
  }

  function pluginsPage() {
    const total = PLUGINS.length;
    const onCount = PLUGINS.filter(isOn).length;
    const pct = total ? Math.round((onCount / total) * 100) : 0;
    const favCount = PLUGINS.filter(isFav).length;
    const r = 7;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - pct / 100);
    const ringSvg =
      `<svg class="dc-nc-ring" viewBox="0 0 20 20">` +
      `<circle cx="10" cy="10" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2.5"/>` +
      `<circle id="dc-nc-ring-prog" cx="10" cy="10" r="${r}" fill="none" stroke="var(--dc-accent,#ffffff)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>` +
      `</svg>`;
    return (
      `<div class="dc-body">` +
      `<div class="dc-nc-hero">` +
      `<div class="dc-nc-hero-l">` +
      `<div class="dc-nc-hero-t">${esc(L('Gestion de l’écosystème de plugins', 'Plugin Ecosystem Management'))}</div>` +
      `<div class="dc-nc-hero-s">${esc(L('Gérez ici vos plugins DreamCord. Activez, désactivez et configurez-les à votre goût.', 'Manage your DreamCord plugins here. Enable, disable, and configure them to your liking.'))}</div>` +
      `<div class="dc-nc-hero-actions"><button type="button" class="dc-nc-reset" data-act="pl-reset">${esc(L('Réinitialiser', 'Reset'))}</button>${langToggleBtn()}</div>` +
      `</div>` +
      `<div class="dc-nc-hero-r">` +
      `<button type="button" class="dc-nc-hbtn primary" data-act="pl-favs">${esc(filter === 'fav' ? L('Afficher tous les plugins', 'Show all plugins') : L('Voir mes plugins favoris', 'View favorite plugins'))}</button>` +
      `<button type="button" class="dc-nc-hbtn" data-act="pl-default">${esc(L('Appliquer la config par défaut', 'Apply default config'))}</button>` +
      `<button type="button" class="dc-nc-hbtn" data-act="pl-basic">${esc(L('Appliquer la config de base', 'Apply basic config'))}</button>` +
      `</div></div>` +
      `<div class="dc-nc-stats">` +
      `<div class="dc-nc-stat"><div class="dc-nc-stat-lbl">${esc(L('Total plugins', 'Total plugins'))}</div><div class="dc-nc-stat-val">${total}</div></div>` +
      `<div class="dc-nc-stat"><div class="dc-nc-stat-lbl">${esc(L('Plugins activés', 'Active plugins'))}</div><div class="dc-nc-stat-val" id="dc-nc-active-stat"><span>${onCount}</span><small>(${pct}%)</small>${ringSvg}</div></div>` +
      `<div class="dc-nc-stat"><div class="dc-nc-stat-lbl">${esc(L('Favoris', 'Favorites'))}</div><div class="dc-nc-stat-val" id="dc-nc-fav-stat">${favCount}</div></div>` +
      `</div>` +
      `<div class="dc-nc-bar">` +
      `<div class="dc-search-wrap">` +
      `<span class="dc-search-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>` +
      `<input class="dc-vc-search" id="dc-search-in" data-act="search" placeholder="${esc(L('Rechercher un plugin, un tag ou une catégorie…', 'Search for a plugin, tag, or category...'))}" value="${esc(query)}">` +
      `<button type="button" class="dc-search-clr${query ? ' show' : ''}" id="dc-search-clr" data-act="search-clear" title="${esc(L('Effacer', 'Clear'))}">×</button>` +
      `</div>` +
      `<div class="dc-chips" id="dc-chips">${CATS().map(([id, l]) => `<button type="button" class="dc-chip${filter === id ? ' active' : ''}" data-act="pill" data-v="${id}">${esc(l)}</button>`).join('')}</div>` +
      `</div>` +
      `<div id="dc-grid">${cardsHtml()}</div></div>`
    );
  }

  const backHead = (title, extra = '') =>
    `<div class="dc-emb-head"><div class="dc-emb-title">${esc(title)}</div><div class="dc-btns">${extra}<button type="button" class="dc-btn small" data-act="back">‹ ${esc(L('Retour', 'Back'))}</button></div></div>`;

  const secCard = (title, body, tag = '', tagOff = false) =>
    `<div class="dc-sec">` +
    `<div class="dc-sec-head"><div class="dc-sec-title">${esc(title)}${tag ? `<span class="dc-sec-tag${tagOff ? ' off' : ''}">${esc(tag)}</span>` : ''}</div></div>` +
    body +
    `</div>`;

  const segBtns = (act, items, cur) =>
    `<div class="dc-seg">${items.map(([v, l]) => `<button type="button" class="dc-seg-btn${cur === v ? ' active' : ''}" data-act="${act}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;

  function wallpaperPage() {
    const wp = config.wallpaper;
    const src = currentSource();
    const kind = currentKind();
    const refName = wp.source === 'url' ? wp.url || '' : wp.fileName || '';
    const mediaTag = !src ? '' : kind === 'video' ? 'VIDEO' : /\.gif(\?|#|$)/i.test(refName) ? 'GIF' : 'IMAGE';
    const vidSrc = src && src.includes('#') ? src : `${src}#t=0.4`;
    const preview = !src
      ? L('Aucun fond', 'No wallpaper')
      : (kind === 'video' ? `<video src="${esc(vidSrc)}" preload="metadata" muted></video>` : `<img src="${esc(src)}" alt="">`) +
        (mediaTag ? `<span class="dc-preview-badge">${mediaTag}</span>` : '');
    const name = wp.source === 'url' ? wp.url : wp.fileName;
    const r = (k, label, min, max, step, unit) => range('wp', 'wp', k, label, min, max, step, unit, wp[k]);
    const resetWpBtn = `<button type="button" class="dc-btn small danger" data-act="resetwp">${esc(L('Réinitialiser', 'Reset'))}</button>`;
    const fits = [
      ['cover', L('Remplir', 'Cover')],
      ['contain', L('Ajuster', 'Contain')],
      ['fill', L('Étirer', 'Fill')]
    ];
    const glassOn = wp.settingsGlass !== false;
    return (
      backHead('Lively Wallpaper', resetWpBtn) +
      `<div class="dc-body">` +
      secCard(
        L('Source du fond animé', 'Live Wallpaper Source'),
        `<div class="dc-row"><div><div class="dc-lbl">${esc(L('Activer Lively Wallpaper', 'Enable Lively Wallpaper'))}</div>` +
          `<div class="dc-sub">${esc(L('Vidéo, GIF ou image animée derrière Discord', 'Video, GIF or animated image behind Discord'))}</div></div>` +
          `${sw(Boolean(wp.enabled), 'data-act="wpbool" data-k="enabled"')}</div>` +
          `<div class="dc-hero dc-div-row"><div class="dc-preview">${preview}</div><div class="dc-hero-info">` +
          `<div><div class="dc-lbl">${esc(name || L('Aucun fichier sélectionné', 'No file selected'))}</div>` +
          `<div class="dc-sub">${esc(L('MP4, WebM, GIF, PNG ou JPG (1080p conseillé)', 'MP4, WebM, GIF, PNG or JPG (1080p recommended)'))}</div></div>` +
          `<div class="dc-btns"><button type="button" class="dc-btn primary" data-act="pick">${esc(L('Choisir un fichier…', 'Choose file...'))}</button>` +
          (src ? `<button type="button" class="dc-btn danger" data-act="clearwp">${esc(L('Retirer', 'Remove'))}</button>` : '') +
          `</div></div></div>` +
          `<div class="dc-div-row"><div class="dc-rt"><span>${esc(L('Ou utiliser un lien direct (URL)', 'Or use a direct URL'))}</span></div>` +
          `<div class="dc-urlrow"><input class="dc-in" id="dc-url" placeholder="https://exemple.com/wallpaper.mp4" value="${esc(wp.source === 'url' ? wp.url : '')}"><button type="button" class="dc-btn" data-act="applyurl">${esc(L('Appliquer', 'Apply'))}</button></div></div>`,
        wp.enabled ? L('Actif', 'Active') : L('Inactif', 'Inactive'),
        !wp.enabled
      ) +
      secCard(
        L('Image & Filtres', 'Image & Filters'),
        `<div class="dc-grid">` +
          r('brightness', L('Luminosité', 'Brightness'), 10, 200, 1, ' %') +
          r('opacity', L('Opacité du fond', 'Wallpaper opacity'), 0, 100, 1, ' %') +
          r('uiOpacity', L('Voile sur l’interface', 'UI dim'), 0, 100, 1, ' %') +
          r('blur', L('Flou', 'Blur'), 0, 30, 1, ' px') +
          r('contrast', L('Contraste', 'Contrast'), 50, 150, 1, ' %') +
          r('saturation', L('Saturation', 'Saturation'), 0, 200, 1, ' %') +
          r('speed', L('Vitesse vidéo', 'Video speed'), 0.25, 2, 0.05, ' ×') +
          `<div><div class="dc-rt"><span>${esc(L('Ajustement', 'Fit'))}</span></div>${segBtns('fit', fits, wp.fit || 'cover')}</div>` +
          `</div>`
      ) +
      secCard(
        L('Paramètres Discord transparents', 'Transparent Discord Settings'),
        `<div class="dc-row"><div><div class="dc-lbl">${esc(L('Fenêtre Paramètres en verre', 'Glass Settings window'))}</div>` +
          `<div class="dc-sub">${esc(L('Rend la fenêtre des paramètres Discord translucide avec flou', 'Makes Discord settings window translucent with blur'))}</div></div>` +
          `${sw(glassOn, 'data-act="wpbool" data-k="settingsGlass"')}</div>` +
          `<div class="dc-grid dc-div-row${glassOn ? '' : ' dc-dimmed'}" id="dc-glass-sliders">${r('settingsDim', L('Voile sombre (0 = transparent)', 'Dark veil (0 = transparent)'), 0, 90, 1, ' %')}${r('settingsBlur', L('Flou', 'Blur'), 0, 30, 1, ' px')}</div>`
      ) +
      secCard(
        L('Économie de ressources', 'Performance'),
        [
          ['pauseMinimized', L('Pause quand la fenêtre est réduite', 'Pause when minimized')],
          ['pauseUnfocused', L('Pause quand Discord n’a pas le focus', 'Pause when unfocused')],
          ['pauseBattery', L('Pause sur batterie', 'Pause on battery')]
        ]
          .map(([k, l], i) => `<div class="dc-row${i ? ' dc-div-row' : ''}"><div class="dc-lbl">${esc(l)}</div>${sw(Boolean(wp[k]), `data-act="wpbool" data-k="${k}"`)}</div>`)
          .join('')
      ) +
      `</div>`
    );
  }

  let fontQuery = '';
  function fontListHtml() {
    const cur = config?.appearance?.fontFamily || 'default';
    const q = fontQuery.trim().toLowerCase();
    const list = APPEARANCE_FONT_LIST.filter(([k, name]) => !q || name.toLowerCase().includes(q) || k.toLowerCase().includes(q));
    if (!list.length) return `<div class="dc-sub" style="padding:10px 4px">${esc(L('Aucune police trouvée', 'No font found'))}</div>`;
    return list
      .map(
        ([k, name, css]) =>
          `<button type="button" class="dc-font-item${cur === k ? ' active' : ''}" data-act="app-font" data-v="${esc(k)}" style="font-family:${esc(css)}!important">` +
          `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:${esc(css)}!important">${esc(name)}</span>` +
          `<small style="font-family:${esc(css)}!important">Abc 123</small></button>`
      )
      .join('');
  }

  function personalizationPage() {
    ensureGoogleFont('', true);
    const winCfg = config.window || {};
    const ap = config.appearance || {};
    const wp = config.wallpaper || {};
    const iconPath = winCfg.iconPath || '';
    const iconName = iconPath ? iconPath.split(/[\\/]/).pop() : '';
    const iconPreview = winCfg.iconPreview
      ? `<img src="${esc(winCfg.iconPreview)}" alt="" style="width:48px;height:48px;object-fit:contain;border-radius:10px">`
      : svgStr('sparkle', 26);
    const resetBtn = `<button type="button" class="dc-btn small danger" data-act="resetpers">${esc(L('Réinitialiser', 'Reset'))}</button>`;
    const palettes = [
      ['default', L('Défaut', 'Default')],
      ['amoled', L('Noir AMOLED', 'AMOLED Black')],
      ['obsidian', L('Obsidienne', 'Obsidian')],
      ['carbon', L('Carbone', 'Carbon')],
      ['slate', L('Ardoise', 'Slate')],
      ['midnight', 'Midnight'],
      ['abyss', L('Abysse', 'Abyss')],
      ['violet', L('Noir Violet', 'Dark Violet')],
      ['crimson', L('Cramoisi', 'Crimson')],
      ['forest', L('Émeraude', 'Emerald')],
      ['coffee', L('Espresso', 'Espresso')]
    ];
    const curFontName = APPEARANCE_FONT_LIST.find(([k]) => k === (ap.fontFamily || 'default'))?.[1] || 'gg sans';
    const materials = [
      ['none', L('Aucun', 'None')],
      ['mica', 'Mica'],
      ['acrylic', 'Acrylic'],
      ['tabbed', 'Tabbed']
    ];
    const osModes = [
      ['default', L('Par défaut', 'Default')],
      ['macos', 'macOS'],
      ['windows', 'Windows'],
      ['linux', 'Linux']
    ];
    const curOsMode = config.plugins?.['macos-buttons']
      ? pluginSetting('macos-buttons', 'mode', 'macos') || 'macos'
      : 'default';
    const wpLabel = wp.enabled
      ? (wp.source === 'url' ? wp.url : wp.fileName) || L('Actif', 'Active')
      : L('Désactivé · configure vidéo, GIF, filtres et verre', 'Disabled · configure video, GIF, filters & glass');
    return (
      `<div class="dc-emb-head"><div class="dc-emb-title">${esc(L('Personnalisation', 'Personalization'))}</div><div class="dc-btns"><button type="button" class="dc-btn small" data-act="relaunch">↻ ${esc(L('Redémarrer Discord', 'Restart Discord'))}</button>${resetBtn}${langToggleBtn()}</div></div>` +
      `<div class="dc-body">` +
      secCard(
        L('Apparence, Thème & Police', 'Appearance, Theme & Font'),
        `<div class="dc-row"><div><div class="dc-lbl">${esc(L('Activer le thème personnalisé', 'Enable custom appearance'))}</div>` +
          `<div class="dc-sub">${esc(L('Applique le thème sombre, la police et les arrondis', 'Applies dark theme, font, and corner radii'))}</div></div>` +
          `${sw(Boolean(ap.enabled), 'id="dc-app-enabled-sw" data-act="appbool" data-k="enabled"')}</div>` +
          `<div class="dc-div-row"><div class="dc-rt"><span>${esc(L('Thème sombre', 'Dark theme palette'))}</span></div>${segBtns('app-palette', palettes, ap.palette || 'default')}</div>` +
          `<div class="dc-div-row"><div class="dc-rt"><span>${esc(L('Police d’écriture', 'Font family'))} (${APPEARANCE_FONT_LIST.length})</span><b id="dc-cur-font-lbl">${esc(curFontName)}</b></div>` +
          `<div class="dc-search-wrap" style="margin-top:6px"><span class="dc-search-ico">${svgStr('search', 15)}</span>` +
          `<input class="dc-vc-search" style="height:34px;font-size:12.5px" data-act="font-search" placeholder="${esc(L('Rechercher une police… (Poppins, JetBrains, Montserrat, Consolas…)', 'Search a font... (Poppins, JetBrains, Montserrat, Consolas...)'))}" value="${esc(fontQuery)}"></div>` +
          `<div class="dc-font-list" id="dc-font-list">${fontListHtml()}</div></div>` +
          `<div class="dc-grid dc-div-row">` +
          range('ap', 'ap', 'avatarRadius', L('Arrondi des avatars', 'Avatar roundness'), 0, 50, 2, ' %', ap.avatarRadius ?? 50) +
          range('ap', 'ap', 'borderRadius', L('Arrondi de l’interface', 'UI corner radius'), 0, 18, 1, ' px', ap.borderRadius ?? 8) +
          `</div>`,
        ap.enabled ? L('Actif', 'Active') : L('Inactif', 'Inactive'),
        !ap.enabled
      ) +
      secCard(
        L('Icône de bureau & fenêtre', 'Desktop Icon & Window'),
        `<div class="dc-row"><div style="display:flex;align-items:center;gap:14px;min-width:0">` +
          `<div class="dc-preview" style="width:60px;height:60px;border-radius:12px;flex-shrink:0">${iconPreview}</div>` +
          `<div style="min-width:0"><div class="dc-lbl">${esc(iconName || L('Icône Discord par défaut', 'Default Discord icon'))}</div>` +
          `<div class="dc-sub">${esc(L('Format .ico, .png ou .jpg (fenêtre et barre des tâches)', '.ico, .png or .jpg format (window & taskbar)'))}</div></div></div>` +
          `<div class="dc-btns"><button type="button" class="dc-btn primary" data-act="pickicon">${esc(L('Modifier l’icône…', 'Change icon...'))}</button>` +
          (iconPath ? `<button type="button" class="dc-btn" data-act="reseticon">${esc(L('Réinitialiser', 'Reset'))}</button>` : '') +
          `</div></div>` +
          `<div class="dc-row dc-div-row">` +
          `<div><div class="dc-lbl">${esc(L('Masquer le badge rouge (9+)', 'Hide red taskbar badge (9+)'))}</div>` +
          `<div class="dc-sub">${esc(L('Supprime la pastille rouge de notifications sur la barre des tâches', 'Removes the red notification badge on the taskbar icon'))}</div></div>` +
          `${sw(Boolean(winCfg.hideTaskbarBadge), 'data-act="winbool" data-k="hideTaskbarBadge"')}</div>` +
          `<div class="dc-row dc-div-row" style="flex-wrap:wrap">` +
          `<div><div class="dc-lbl">${esc(L('Mode OS des boutons de fenêtre', 'Window controls OS mode'))}</div>` +
          `<div class="dc-sub">${esc(L('Style macOS (Traffic Lights), Windows 11 ou Linux (GNOME)', 'macOS Traffic Lights, Windows 11 or Linux GNOME style'))}</div></div>` +
          `${segBtns('win-osmode', osModes, curOsMode)}</div>` +
          `<div class="dc-row dc-div-row" style="flex-wrap:wrap">` +
          `<div><div class="dc-lbl">${esc(L('Matériau de fenêtre Windows', 'Windows backdrop material'))}</div>` +
          `<div class="dc-sub">${esc(L('Effet Mica / Acrylic natif Windows 11', 'Native Windows 11 Mica / Acrylic effect'))}</div></div>` +
          `${segBtns('win-mat', materials, winCfg.material || 'none')}</div>`
      ) +
      secCard(
        'Lively Wallpaper',
        `<div class="dc-row"><div style="min-width:0;flex:1"><div class="dc-lbl">${esc(L('Fond d’écran animé & filtres', 'Live wallpaper & filters'))}</div>` +
          `<div class="dc-sub" id="dc-pers-wp-sub">${esc(wpLabel)}</div></div>` +
          `<div class="dc-btns">${sw(Boolean(wp.enabled), 'data-act="wpbool" data-k="enabled"')}` +
          `<button type="button" class="dc-btn primary" data-act="gear" data-id="lively-wallpaper">${esc(L('Configurer ›', 'Configure ›'))}</button></div></div>`,
        wp.enabled ? L('Actif', 'Active') : L('Inactif', 'Inactive'),
        !wp.enabled
      ) +
      `</div>`
    );
  }

  function cssPage() {
    const css = config.customCss || '';
    const themes = boot.themes || [];
    const lines = css ? css.split('\n').length : 0;
    const themesHtml = themes.length
      ? `<div class="dc-div-row"><div class="dc-rt"><span>${esc(L('Thèmes chargés depuis le dossier', 'Themes loaded from folder'))} (${themes.length})</span></div>` +
        `<div class="dc-theme-pills">${themes.map((t) => `<span class="dc-theme-pill">${esc(t.file)}</span>`).join('')}</div></div>`
      : '';
    return (
      backHead(L('CSS perso', 'Custom CSS')) +
      `<div class="dc-body"><div class="dc-sec"><div class="dc-row" style="flex-wrap:wrap"><div><div class="dc-lbl">${esc(L('Éditeur CSS', 'CSS Editor'))}</div><div class="dc-sub">${esc(L('Appliqué en direct · les fichiers .css du dossier thèmes sont chargés aussi', 'Applied live · .css files in the themes folder are loaded too'))}</div></div>` +
      `<div class="dc-btns"><button type="button" class="dc-btn small" data-act="folder">${esc(L('Ouvrir le dossier thèmes', 'Open themes folder'))}</button>` +
      (css ? `<button type="button" class="dc-btn small danger" data-act="css-clear">${esc(L('Vider', 'Clear'))}</button>` : '') +
      `</div></div>` +
      `<textarea class="dc-in dc-code" id="dc-css-ed" data-act="css" spellcheck="false" placeholder="/* CSS */">${esc(css)}</textarea>` +
      `<div class="dc-sub" id="dc-css-meta">${esc(L(`${lines} ligne(s) · ${css.length} caractères`, `${lines} line(s) · ${css.length} characters`))}</div>` +
      themesHtml +
      `</div></div>`
    );
  }

  function pluginPage(p) {
    const choicesBlock = (p.choices || [])
      .map((c) => {
        const cur = pluginSetting(p.id, c.key, c.def);
        return (
          `<div class="dc-div-row"><div class="dc-rt"><span>${esc(L(c.label, c.enLabel || c.label))}</span></div>` +
          `<div class="dc-seg">` +
          c.items
            .map(
              ([v, l]) =>
                `<button type="button" class="dc-seg-btn${cur === v ? ' active' : ''}" data-act="pl-choice" data-id="${esc(p.id)}" data-k="${esc(c.key)}" data-v="${esc(v)}">${esc(l)}</button>`
            )
            .join('') +
          `</div></div>`
        );
      })
      .join('');
    return (
      backHead(pName(p)) +
      `<div class="dc-body"><div class="dc-sec"><div class="dc-sub" style="white-space:normal">${esc(pDesc(p))}</div>` +
      choicesBlock +
      `<div class="dc-grid">` +
      (p.sliders || [])
        .map((s) => range('pl', p.id, s.key, L(s.label, s.enLabel || s.label), s.min, s.max, s.step, s.unit || '', pluginSetting(p.id, s.key, s.def)))
        .join('') +
      `</div></div></div>`
    );
  }

  const CHANGELOG = [
    {
      version: '0.3.0',
      date: '20/11/2026',
      tag: 'new',
      tagFr: 'Majeure',
      tagEn: 'Major',
      itemsFr: [
        'Refonte visuelle complète noir & blanc professionnel (zéro néon) + nouveau logo DreamCord monochrome.',
        'Catalogue étendu à 81 plugins (ImageZoom, ViewIcons, ShowID, CopyProfileId, FastDiscord, PictureInPicture, CommandPalette, ServerSearch, PasscodeLock, StealthMode, etc.).',
        'Onglet Personnalisation enrichi : 11 thèmes sombres, 10 polices d’écriture, arrondis personnalisés, icône de fenêtre et effets Windows 11 ; Lively Wallpaper dédié.',
        'Optimisations de performance (mises à jour DOM sur place, démarrage et injection plus rapides, correctifs Windows/Electron et Custom Friend).'
      ],
      itemsEn: [
        'Full executive monochrome Black & White UI redesign (zero neon) + new monochrome DreamCord logo.',
        'Expanded to 81 plugins (ImageZoom, ViewIcons, ShowID, CopyProfileId, FastDiscord, PictureInPicture, CommandPalette, ServerSearch, PasscodeLock, StealthMode, and more).',
        'Upgraded Personalization tab: 11 dark themes, 10 fonts, custom corner radii, window icon & Windows 11 backdrop; dedicated Lively Wallpaper settings page.',
        'Performance & stability overhaul (in-place DOM updates, faster startup/injection, Windows/Electron and Custom Friend fixes).'
      ]
    },
    {
      version: '0.2.1',
      date: '15/11/2026',
      tag: 'fix',
      tagFr: 'Correctif',
      tagEn: 'Fix',
      itemsFr: [
        'Custom Friend : correction du bug dans les serveurs où la photo de profil d’un ami personnalisé remplaçait celle de tous les membres dans la liste des membres.',
        'Ajout de l’onglet Journal de mise à jour (Update Logs) dans les paramètres DreamCord.'
      ],
      itemsEn: [
        'Custom Friend: fixed a bug in servers where a customized friend’s avatar replaced every member’s avatar in the server member list.',
        'Added the Update Logs tab in DreamCord settings.'
      ]
    },
    {
      version: '0.2.0',
      date: '2026',
      tag: 'new',
      tagFr: 'Majeure',
      tagEn: 'Major',
      itemsFr: [
        'Nouveau plugin Custom Friend : personnalisation locale complète d’un profil (pseudo, avatar, bannière, bio, pronoms, statut, couleur, thème, déco, note).',
        'Onglet Personnalisation unifié : fond d’écran animé (image, GIF, vidéo), filtres visuels, icône de fenêtre/barre des tâches et masquage du badge rouge.',
        'Interface bilingue FR / EN et intégration native dans les paramètres Discord.'
      ],
      itemsEn: [
        'New Custom Friend plugin: full local profile customization (name, avatar, banner, bio, pronouns, status, color, theme, decoration, note).',
        'Unified Personalization tab: live wallpaper (image, GIF, video), visual filters, window/taskbar icon, and red badge hiding.',
        'Bilingual FR / EN UI and native Discord settings integration.'
      ]
    },
    {
      version: '0.1.0',
      date: '2026',
      tag: 'new',
      tagFr: 'Initiale',
      tagEn: 'Initial',
      itemsFr: [
        'Lancement de DreamCord pour Windows avec serveur local de fond d’écran animé.',
        'Palettes de thèmes, éditeur CSS personnalisé et premiers plugins.'
      ],
      itemsEn: [
        'Initial release of DreamCord for Windows with local live wallpaper server.',
        'Theme palettes, custom CSS editor, and core plugins.'
      ]
    }
  ];

  function updateLogsPage() {
    const cards = CHANGELOG.map((entry) => {
      const tag = L(entry.tagFr, entry.tagEn);
      const items = (isEn() ? entry.itemsEn : entry.itemsFr)
        .map((txt) => `<li>${esc(txt)}</li>`)
        .join('');
      return (
        `<div class="dc-sec">` +
        `<div class="dc-cl-head">` +
        `<div class="dc-cl-ver"><span>v${esc(entry.version)}</span><span class="dc-cl-badge ${esc(entry.tag)}">${esc(tag)}</span></div>` +
        `<span class="dc-cl-date">${esc(entry.date)}</span>` +
        `</div>` +
        `<ul class="dc-cl-list">${items}</ul>` +
        `</div>`
      );
    }).join('');
    return (
      `<div class="dc-emb-head"><div class="dc-emb-title">${esc(L('Journal de mise à jour', 'Update Logs'))} <small>v${esc(CHANGELOG[0].version)}</small></div><div class="dc-btns">${langToggleBtn()}</div></div>` +
      `<div class="dc-body">${cards}</div>`
    );
  }

  function aboutPage() {
    const n = PLUGINS.filter(isOn).length;
    const shortcuts = [
      [L('Ouvrir DreamCord', 'Open DreamCord'), 'F9 / Ctrl+Alt+D'],
      [L('Traduire un message', 'Translate message'), L('Alt + Clic droit', 'Alt + Right-click')],
      [L('Copier message brut', 'Copy raw message'), L('Maj + Clic droit', 'Shift + Right-click')],
      [L('Copie rapide d’ID', 'Quick Copy ID'), L('Ctrl + Clic', 'Ctrl + Click')]
    ];
    return (
      `<div class="dc-emb-head"><div class="dc-emb-title">${svgStr('sparkle', 18)}<span>DreamCord</span><small>${esc(L('léger · rapide · local', 'light · fast · local'))}</small></div><div class="dc-btns">${langToggleBtn()}</div></div>` +
      `<div class="dc-body">` +
      `<div class="dc-nc-stats">` +
      `<div class="dc-nc-stat"><div class="dc-nc-stat-lbl">${esc(L('Version', 'Version'))}</div><div class="dc-nc-stat-val">v${esc(CHANGELOG[0].version)}</div></div>` +
      `<div class="dc-nc-stat"><div class="dc-nc-stat-lbl">${esc(L('Plugins actifs', 'Active plugins'))}</div><div class="dc-nc-stat-val">${n}<small>/ ${PLUGINS.length}</small></div></div>` +
      `<div class="dc-nc-stat"><div class="dc-nc-stat-lbl">${esc(L('Raccourci', 'Shortcut'))}</div><div class="dc-nc-stat-val">F9</div></div>` +
      `</div>` +
      secCard(
        L('Raccourcis clavier', 'Keyboard Shortcuts'),
        `<div class="dc-kbd-grid">${shortcuts.map(([lbl, kbd]) => `<div class="dc-kbd-row"><span>${esc(lbl)}</span><kbd class="dc-kbd">${esc(kbd)}</kbd></div>`).join('')}</div>`
      ) +
      `<div class="dc-sec"><div class="dc-row"><div><div class="dc-lbl">${esc(L('Maintenance & Dossiers', 'Maintenance & Folders'))}</div>` +
      `<div class="dc-sub">${esc(L('Accès rapide aux outils de diagnostic et à la configuration locale', 'Quick access to diagnostic tools and local configuration'))}</div></div></div>` +
      `<div class="dc-btns"><button type="button" class="dc-btn" data-act="devtools">${esc(L('Outils développeur', 'DevTools'))}</button>` +
      `<button type="button" class="dc-btn" data-act="folder">${esc(L('Dossier DreamCord', 'DreamCord folder'))}</button>` +
      `<button type="button" class="dc-btn danger" data-act="reset">${esc(L('Tout réinitialiser', 'Reset all'))}</button></div></div></div>`
    );
  }

  let cfQuery = '';
  const CF_FIELDS = ['name', 'username', 'avatar', 'banner', 'bio', 'pronouns', 'clanTag', 'customStatus', 'color', 'profileColor', 'decoration', 'note'];
  const CF_FIELD_LABEL = (k) => ({
    name: L('Pseudo', 'Name'),
    username: '@',
    avatar: 'PP',
    banner: L('Bannière', 'Banner'),
    bio: 'Bio',
    pronouns: L('Pronoms', 'Pronouns'),
    clanTag: 'Clan',
    customStatus: L('Statut', 'Status'),
    color: L('Couleur', 'Color'),
    profileColor: L('Thème', 'Theme'),
    decoration: L('Déco', 'Deco'),
    note: 'Note'
  }[k] || k);

  function cfListHtml() {
    const users = getCfUsers();
    const q = cfQuery.trim().toLowerCase();
    const entries = Object.entries(users).filter(([uid, u]) => {
      if (!q) return true;
      return `${uid} ${u.name || ''} ${u.origName || ''} ${u.username || ''}`.toLowerCase().includes(q);
    });
    if (!entries.length) {
      return `<div class="dc-empty">${esc(q ? L('Aucun résultat', 'No results') : L('Aucun ami personnalisé. Fais clic droit sur un ami ou ajoute son ID ci-dessus.', 'No custom friends yet. Right-click a user or add an ID above.'))}</div>`;
    }
    return entries
      .map(([uid, u]) => {
        const chips = CF_FIELDS.filter((f) => u[f])
          .slice(0, 6)
          .map((f) => `<span class="dc-cf-chip">${esc(CF_FIELD_LABEL(f))}</span>`)
          .join('');
        const display = u.name || u.origName || uid;
        const avHtml = u.avatar
          ? `<img src="${esc(u.avatar)}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.08);flex-shrink:0">`
          : `<span class="dc-cf-av-fallback">${esc(String(display).charAt(0).toUpperCase() || '?')}</span>`;
        return (
          `<div class="dc-row dc-cf-item${u.disabled ? ' off' : ''}">` +
          `<div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">` +
          avHtml +
          `<div style="min-width:0"><div class="dc-lbl" style="font-size:14px${u.color ? `;color:${esc(u.color)}` : ''}">${esc(display)}</div>` +
          `<div class="dc-sub">${esc(u.origName ? `${u.origName} · ${uid}` : uid)}</div>` +
          (chips ? `<div class="dc-cf-chips">${chips}</div>` : '') +
          `</div></div>` +
          `<div class="dc-btns">` +
          `<label class="dc-sw" title="${esc(L('Activer / désactiver', 'Enable / disable'))}"><input type="checkbox" ${u.disabled ? '' : 'checked'} data-act="cf-toggle" data-id="${esc(uid)}"><span></span></label>` +
          `<button type="button" class="dc-btn small" data-act="cf-edit" data-id="${esc(uid)}">${esc(L('Modifier', 'Edit'))}</button>` +
          `<button type="button" class="dc-btn small danger" data-act="cf-del" data-id="${esc(uid)}">${esc(L('Supprimer', 'Delete'))}</button>` +
          `</div></div>`
        );
      })
      .join('');
  }

  function customFriendPage() {
    const count = Object.keys(getCfUsers()).length;
    return (
      backHead('Custom Friend') +
      `<div class="dc-body">` +
      `<div class="dc-sec"><div class="dc-sec-title">${esc(L('Ajouter par ID utilisateur', 'Add by User ID'))}</div>` +
      `<div class="dc-urlrow"><input class="dc-in" id="dc-cf-add-id" placeholder="123456789012345678"><button type="button" class="dc-btn primary" data-act="cf-add">${esc(L('Personnaliser', 'Customize'))}</button></div></div>` +
      `<div class="dc-sec">` +
      `<div class="dc-row" style="flex-wrap:wrap;gap:10px">` +
      `<div class="dc-sec-title">${esc(L('Amis personnalisés', 'Custom friends'))} (${count})</div>` +
      `<div class="dc-btns">` +
      `<button type="button" class="dc-btn small" data-act="cf-export"${count ? '' : ' disabled'}>${esc(L('Exporter', 'Export'))}</button>` +
      `<button type="button" class="dc-btn small" data-act="cf-import">${esc(L('Importer', 'Import'))}</button>` +
      (count ? `<button type="button" class="dc-btn small danger" data-act="cf-clear">${esc(L('Tout supprimer', 'Clear all'))}</button>` : '') +
      `</div></div>` +
      (count > 1 ? `<input class="dc-in" id="dc-cf-search" data-act="cf-search" value="${esc(cfQuery)}" placeholder="${esc(L('Filtrer par pseudo ou ID…', 'Filter by name or ID...'))}">` : '') +
      `<div id="dc-cf-list">${cfListHtml()}</div></div></div>`
    );
  }

  let lastViewKey = '';
  function render(box) {
    const viewKey = `${embeddedTab || ''}|${subPage || ''}`;
    const changedView = viewKey !== lastViewKey;
    const top = changedView ? 0 : box.scrollTop;
    lastViewKey = viewKey;
    box.classList.toggle('dc-anim', changedView);
    let html;
    if (embeddedTab === 'credits') html = aboutPage();
    else if (embeddedTab === 'changelog') html = updateLogsPage();
    else if (embeddedTab === 'personalization' && !subPage) html = personalizationPage();
    else if (!subPage) html = pluginsPage();
    else if (subPage === 'lively-wallpaper') html = wallpaperPage();
    else if (subPage === 'custom-css') html = cssPage();
    else if (subPage === 'custom-friend') html = customFriendPage();
    else {
      const p = PLUGINS.find((x) => x.id === subPage);
      html = p ? pluginPage(p) : pluginsPage();
    }
    setHTML(box, html);
    box.scrollTop = top;
  }
  const rerender = () => {
    const box = document.getElementById('dc-settings-embedded');
    if (box) render(box);
  };

  // ---- Événements ----
  async function pickFlow() {
    const res = await Bridge.pickWallpaper();
    if (!res?.filePath) return;
    const url = await Bridge.getWallpaperUrl(res.filePath);
    if (!url) return showToast(L('Fichier illisible', 'Unreadable file'), 'error');
    wallpaperSrc = url;
    Object.assign(config.wallpaper, { source: 'file', filePath: res.filePath, fileName: res.fileName || '', enabled: true });
    applyAll();
    saveSoon();
    rerender();
  }

  async function pickIconFlow() {
    const res = await Bridge.pickIcon();
    if (!res?.filePath) return;
    config.window = config.window || {};
    config.window.iconPath = res.filePath;
    config.window.iconPreview = res.preview || '';
    ipc('set-icon', res.filePath);
    saveSoon();
    showToast(L('Icône appliquée', 'Icon applied'), 'ok');
    rerender();
  }

  const markActiveBtn = (t) => {
    const parent = t.parentElement;
    if (!parent) return;
    parent.querySelectorAll('.active').forEach((b) => b.classList.remove('active'));
    t.classList.add('active');
  };
  const syncSecTag = (el, enabled) => {
    const tag = el?.closest?.('.dc-sec')?.querySelector('.dc-sec-tag');
    if (!tag) return;
    tag.textContent = enabled ? L('Actif', 'Active') : L('Inactif', 'Inactive');
    tag.classList.toggle('off', !enabled);
  };
  const syncApEnabledUi = () => {
    const apSw = document.getElementById('dc-app-enabled-sw');
    if (apSw && !apSw.checked) apSw.checked = true;
    syncSecTag(apSw, true);
  };
  const armConfirm = (t, label = L('Confirmer ?', 'Confirm?')) => {
    if (t.dataset.armed === '1') {
      delete t.dataset.armed;
      return true;
    }
    t.dataset.armed = '1';
    const prev = t.textContent;
    t.textContent = label;
    setTimeout(() => {
      if (t.isConnected && t.dataset.armed === '1') {
        delete t.dataset.armed;
        t.textContent = prev;
      }
    }, 3500);
    return false;
  };
  const applyUrlInput = () => {
    const v = (document.getElementById('dc-url')?.value || '').trim();
    if (!/^https?:\/\//i.test(v)) return showToast(L('Lien invalide', 'Invalid URL'), 'error');
    Object.assign(config.wallpaper, { source: 'url', url: v, enabled: true });
    applyAll();
    saveSoon();
    rerender();
  };
  const addCfByIdInput = () => {
    const uid = (document.getElementById('dc-cf-add-id')?.value || '').trim();
    if (!/^\d{15,22}$/.test(uid)) return showToast(L('ID Discord invalide', 'Invalid Discord ID'), 'error');
    const u = getUserStore()?.getUser?.(uid);
    openCustomFriendModal({
      userId: uid,
      origName: u?.globalName || u?.username || '',
      origAvatar: getUserAvatarUrl(u)
    });
  };

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    switch (t.dataset.act) {
      case 'pill': {
        filter = t.dataset.v;
        markActiveBtn(t);
        const grid = document.getElementById('dc-grid');
        if (grid) setHTML(grid, cardsHtml());
        const favBtn = document.querySelector('[data-act="pl-favs"]');
        if (favBtn) favBtn.textContent = filter === 'fav' ? L('Afficher tous les plugins', 'Show all plugins') : L('Voir mes plugins favoris', 'View favorite plugins');
        return;
      }
      case 'search-clear': {
        query = '';
        const inp = document.getElementById('dc-search-in');
        if (inp) {
          inp.value = '';
          inp.focus();
        }
        t.classList.remove('show');
        const grid = document.getElementById('dc-grid');
        if (grid) setHTML(grid, cardsHtml());
        return;
      }
      case 'lang':
        config.lang = isEn() ? 'fr' : 'en';
        saveSoon();
        document.getElementById('dc-settings-section')?.remove();
        ensureLauncher();
        return rerender();
      case 'info': {
        const pid = t.dataset.id;
        const infoPair = isEn() ? PLUGIN_I18N[pid]?.enInfo : PLUGIN_I18N[pid]?.frInfo;
        const card = t.closest('.dc-nc-card');
        if (!card || !infoPair) return;
        const nowOpen = !openInfo.has(pid);
        if (nowOpen) openInfo.add(pid);
        else openInfo.delete(pid);
        card.classList.toggle('open', nowOpen);
        t.classList.toggle('active', nowOpen);
        const existing = card.querySelector('.dc-info-box');
        if (nowOpen && !existing) {
          const top = card.querySelector('.dc-nc-card-top');
          if (top) {
            const boxEl = document.createElement('div');
            setHTML(boxEl, infoBoxHtml(infoPair));
            if (boxEl.firstElementChild) top.appendChild(boxEl.firstElementChild);
          }
        } else if (!nowOpen && existing) {
          existing.remove();
        }
        return;
      }
      case 'fav': {
        const pid = t.dataset.id;
        config.favoritePlugins = config.favoritePlugins || {};
        config.favoritePlugins[pid] = !config.favoritePlugins[pid];
        if (!config.favoritePlugins[pid]) delete config.favoritePlugins[pid];
        saveSoon();
        t.classList.toggle('fav', Boolean(config.favoritePlugins[pid]));
        const favStat = document.getElementById('dc-nc-fav-stat');
        if (favStat) favStat.textContent = String(PLUGINS.filter(isFav).length);
        if (filter === 'fav') {
          const grid = document.getElementById('dc-grid');
          if (grid) setHTML(grid, cardsHtml());
        }
        return;
      }
      case 'pl-favs': {
        filter = filter === 'fav' ? 'all' : 'fav';
        t.textContent = filter === 'fav' ? L('Afficher tous les plugins', 'Show all plugins') : L('Voir mes plugins favoris', 'View favorite plugins');
        const chips = document.getElementById('dc-chips');
        if (chips) {
          chips.querySelectorAll('.dc-chip').forEach((c) => c.classList.toggle('active', c.dataset.v === filter));
        }
        const grid = document.getElementById('dc-grid');
        if (grid) setHTML(grid, cardsHtml());
        return;
      }
      case 'pl-reset':
        for (const p of PLUGINS) {
          if (p.isWallpaper) config.wallpaper.enabled = false;
          else config.plugins[p.id] = false;
        }
        applyAll();
        saveSoon();
        showToast(L('Tous les plugins ont été désactivés', 'All plugins disabled'), 'ok');
        return rerender();
      case 'pl-default':
        config.plugins = JSON.parse(JSON.stringify(boot.defaults?.plugins || {}));
        config.wallpaper.enabled = Boolean(boot.defaults?.wallpaper?.enabled);
        applyAll();
        saveSoon();
        showToast(L('Configuration par défaut appliquée', 'Default config applied'), 'ok');
        return rerender();
      case 'pl-basic': {
        const basic = new Set(['no-telemetry', 'message-logger', 'declutter-ui', 'translate', 'call-timer']);
        for (const p of PLUGINS) {
          if (!p.isWallpaper) config.plugins[p.id] = basic.has(p.id);
        }
        applyAll();
        saveSoon();
        showToast(L('Configuration de base appliquée', 'Basic config applied'), 'ok');
        return rerender();
      }
      case 'gear':
        if (t.dataset.id === 'custom-profile') {
          openCustomProfileModal();
          return;
        }
        subPage = t.dataset.id;
        return rerender();
      case 'back':
        subPage = null;
        return rerender();
      case 'pick':
        return void pickFlow();
      case 'pickicon':
        return void pickIconFlow();
      case 'reseticon':
        config.window = config.window || {};
        config.window.iconPath = '';
        config.window.iconPreview = '';
        ipc('set-icon', '');
        saveSoon();
        showToast(L('Icône réinitialisée', 'Icon reset'), 'ok');
        return rerender();
      case 'relaunch':
        ipc('relaunch');
        return;
      case 'app-accent': {
        config.appearance = config.appearance || {};
        config.appearance.enabled = true;
        config.appearance.accentColor = t.dataset.v;
        markActiveBtn(t);
        const pick = t.parentElement?.querySelector('[data-act="app-accent-pick"]');
        if (pick) pick.value = t.dataset.v;
        const hexEl = document.getElementById('dc-app-hex');
        if (hexEl) hexEl.textContent = t.dataset.v;
        syncApEnabledUi();
        applyAppearance();
        saveSoon();
        return;
      }
      case 'app-palette':
        config.appearance = config.appearance || {};
        config.appearance.enabled = true;
        config.appearance.palette = t.dataset.v;
        markActiveBtn(t);
        syncApEnabledUi();
        applyAppearance();
        saveSoon();
        return;
      case 'app-font': {
        config.appearance = config.appearance || {};
        config.appearance.enabled = true;
        config.appearance.fontFamily = t.dataset.v;
        t.parentElement?.querySelectorAll('.dc-font-item.active,.dc-seg-btn.active').forEach((b) => b.classList.remove('active'));
        t.classList.add('active');
        const curLbl = document.getElementById('dc-cur-font-lbl');
        if (curLbl) {
          curLbl.textContent = APPEARANCE_FONT_LIST.find(([k]) => k === t.dataset.v)?.[1] || t.dataset.v;
        }
        syncApEnabledUi();
        applyAppearance();
        saveSoon();
        return;
      }
      case 'pl-choice': {
        const pid = t.dataset.id;
        const key = t.dataset.k;
        const val = t.dataset.v;
        if (!pid || !key) return;
        (config.pluginSettings[pid] ||= {})[key] = val;
        config.plugins[pid] = true;
        markActiveBtn(t);
        const card = t.closest?.('.dc-nc-card');
        if (card) {
          card.dataset.on = '1';
          const chk = card.querySelector('input[data-act="toggle"]');
          if (chk) chk.checked = true;
        }
        syncPlugins();
        if (pid === 'macos-buttons') refreshOsButtonsStyle();
        saveSoon();
        return;
      }
      case 'win-osmode': {
        const mode = t.dataset.v;
        markActiveBtn(t);
        if (mode === 'default') {
          config.plugins['macos-buttons'] = false;
        } else {
          (config.pluginSettings['macos-buttons'] ||= {}).mode = mode;
          config.plugins['macos-buttons'] = true;
        }
        syncPlugins();
        refreshOsButtonsStyle();
        saveSoon();
        return;
      }
      case 'win-mat':
        config.window = config.window || {};
        config.window.material = t.dataset.v;
        markActiveBtn(t);
        ipc('set-material', t.dataset.v);
        saveSoon();
        return;
      case 'fit':
        config.wallpaper.fit = t.dataset.v;
        markActiveBtn(t);
        applyWallpaperStyle();
        saveSoon();
        return;
      case 'resetwp':
        config.wallpaper = { ...WP_FALLBACK, ...(boot.defaults?.wallpaper || {}) };
        wallpaperSrc = '';
        applyAll();
        saveSoon();
        showToast(L('Lively Wallpaper réinitialisé', 'Lively Wallpaper reset'), 'ok');
        return rerender();
      case 'resetpers':
        config.window = Object.assign(config.window || {}, { iconPath: '', iconPreview: '', hideTaskbarBadge: false, material: 'none' });
        config.appearance = { enabled: false, palette: 'default', accentColor: '#ffffff', borderRadius: 8, avatarRadius: 50, fontFamily: 'default' };
        config.plugins['macos-buttons'] = false;
        ipc('set-icon', '');
        ipc('hide-taskbar-badge', false);
        ipc('set-material', 'none');
        applyAll();
        saveSoon();
        showToast(L('Personnalisation réinitialisée', 'Personalization reset'), 'ok');
        return rerender();
      case 'applyurl':
        return applyUrlInput();
      case 'clearwp':
        Object.assign(config.wallpaper, { enabled: false, filePath: '', fileName: '', url: '' });
        wallpaperSrc = '';
        applyAll();
        saveSoon();
        return rerender();
      case 'css-clear':
        if (!armConfirm(t)) return;
        config.customCss = '';
        restartSoon('custom-css');
        saveSoon();
        showToast(L('CSS vidé', 'CSS cleared'), 'ok');
        return rerender();
      case 'folder':
        return ipc('open-folder', subPage === 'custom-css' ? 'themes' : '');
      case 'cf-add':
        return addCfByIdInput();
      case 'cf-edit': {
        const u = getCfUsers()[t.dataset.id];
        if (u) openCustomFriendModal({ userId: t.dataset.id, origName: u.origName || '', origAvatar: u.avatar || '' });
        return;
      }
      case 'cf-del':
        delete getCfUsers()[t.dataset.id];
        restoreCustomFriend(t.dataset.id);
        saveSoon();
        showToast(L('Ami supprimé', 'Friend removed'), 'ok');
        return rerender();
      case 'cf-export': {
        const data = JSON.stringify(getCfUsers(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `dreamcord-friends-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
        showToast(L('Profils exportés', 'Profiles exported'), 'ok');
        return;
      }
      case 'cf-import': {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,application/json';
        inp.onchange = async () => {
          const f = inp.files?.[0];
          if (!f) return;
          try {
            const parsed = JSON.parse(await f.text());
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
            const users = getCfUsers();
            let n = 0;
            for (const [uid, val] of Object.entries(parsed)) {
              if (/^\d{15,22}$/.test(uid) && val && typeof val === 'object') {
                users[uid] = val;
                cfRestored.delete(uid);
                n++;
              }
            }
            applyCustomFriends();
            saveSoon();
            showToast(L(`${n} profil(s) importé(s)`, `${n} profile(s) imported`), 'ok');
            rerender();
          } catch {
            showToast(L('Fichier JSON invalide', 'Invalid JSON file'), 'error');
          }
        };
        inp.click();
        return;
      }
      case 'cf-clear': {
        if (!armConfirm(t)) return;
        const users = getCfUsers();
        for (const uid of Object.keys(users)) {
          delete users[uid];
          restoreCustomFriend(uid);
        }
        saveSoon();
        showToast(L('Tous les profils supprimés', 'All profiles deleted'), 'ok');
        return rerender();
      }
      case 'devtools':
        return ipc('toggle-devtools');
      case 'reset':
        if (!armConfirm(t)) return;
        ipc('reset-config');
        ipc('set-icon', '');
        ipc('hide-taskbar-badge', false);
        ipc('always-on-top', false);
        ipc('window-opacity', 1);
        config = JSON.parse(JSON.stringify(boot.defaults || {}));
        normalizeConfig();
        wallpaperSrc = '';
        applyAll();
        persistLocal();
        showToast(L('Réglages réinitialisés', 'Settings reset'), 'ok');
        return rerender();
    }
  }

  async function ensureWallpaperSrc() {
    const wp = config?.wallpaper;
    if (wp?.enabled && wp.source === 'file' && wp.filePath && !wallpaperSrc) {
      wallpaperSrc = (await Bridge.getWallpaperUrl(wp.filePath)) || '';
      applyAll();
    }
  }

  function onChange(e) {
    const t = e.target;
    const act = t.dataset?.act;
    if (act === 'toggle') {
      const id = t.dataset.id;
      if (id === 'lively-wallpaper') {
        config.wallpaper.enabled = t.checked;
        applyTheme();
        applyAppearance();
        updateWallpaper();
        if (t.checked) void ensureWallpaperSrc();
      } else {
        config.plugins[id] = t.checked;
        const p = PLUGINS.find((x) => x.id === id);
        if (p) {
          if (t.checked) startPlugin(p);
          else stopPlugin(p);
        }
      }
      saveSoon();
      const card = t.closest('.dc-nc-card');
      if (card) card.dataset.on = t.checked ? '1' : '0';
      const activeStat = document.getElementById('dc-nc-active-stat');
      if (activeStat) {
        const onCount = PLUGINS.filter(isOn).length;
        const pct = PLUGINS.length ? Math.round((onCount / PLUGINS.length) * 100) : 0;
        const cntEl = activeStat.querySelector('span');
        const pctEl = activeStat.querySelector('small');
        const ringEl = document.getElementById('dc-nc-ring-prog');
        if (cntEl) cntEl.textContent = String(onCount);
        if (pctEl) pctEl.textContent = `(${pct}%)`;
        if (ringEl) {
          const circ = 2 * Math.PI * 7;
          ringEl.setAttribute('stroke-dashoffset', (circ * (1 - pct / 100)).toFixed(2));
        }
      }
    } else if (act === 'winbool') {
      config.window = config.window || {};
      config.window[t.dataset.k] = t.checked;
      if (t.dataset.k === 'hideTaskbarBadge') ipc('hide-taskbar-badge', t.checked);
      saveSoon();
    } else if (act === 'appbool') {
      config.appearance = config.appearance || {};
      config.appearance[t.dataset.k] = t.checked;
      applyAppearance();
      saveSoon();
      syncSecTag(t, t.checked);
    } else if (act === 'wpbool') {
      const k = t.dataset.k;
      config.wallpaper[k] = t.checked;
      applyTheme();
      if (k === 'enabled') {
        applyAppearance();
        updateWallpaper();
        if (t.checked) void ensureWallpaperSrc();
        syncSecTag(t, t.checked);
        const wpSub = document.getElementById('dc-pers-wp-sub');
        if (wpSub) {
          const wp = config.wallpaper;
          wpSub.textContent = wp.enabled
            ? (wp.source === 'url' ? wp.url : wp.fileName) || L('Actif', 'Active')
            : L('Désactivé · configure vidéo, GIF, filtres et verre', 'Disabled · configure video, GIF, filters & glass');
        }
      } else if (k === 'settingsGlass') {
        document.getElementById('dc-glass-sliders')?.classList.toggle('dc-dimmed', !t.checked);
      }
      updatePlayState();
      saveSoon();
    } else if (act === 'cf-toggle') {
      const u = getCfUsers()[t.dataset.id];
      if (u) {
        u.disabled = !t.checked;
        if (!u.disabled) cfRestored.delete(t.dataset.id);
        applyCustomFriends();
        saveSoon();
        t.closest('.dc-cf-item')?.classList.toggle('off', u.disabled);
      }
    }
  }

  let wpRaf = 0;
  function scheduleWpUpdate() {
    if (wpRaf) return;
    wpRaf = requestAnimationFrame(() => {
      wpRaf = 0;
      applyTheme();
      applyWallpaperStyle();
    });
  }
  let apRaf = 0;
  function scheduleApUpdate() {
    if (apRaf) return;
    apRaf = requestAnimationFrame(() => {
      apRaf = 0;
      applyAppearance();
    });
  }

  function onInput(e) {
    const t = e.target;
    if (t.type === 'range') {
      const v = Number(t.value);
      const { scope, id, k, unit } = t.dataset;
      t.style.setProperty('--p', `${rangePct(v, Number(t.min), Number(t.max))}%`);
      const label = t.previousElementSibling?.querySelector('b');
      if (label) label.textContent = v + (unit || '');
      if (scope === 'wp') {
        config.wallpaper[k] = v;
        scheduleWpUpdate();
      } else if (scope === 'ap') {
        config.appearance = config.appearance || {};
        config.appearance.enabled = true;
        config.appearance[k] = v;
        syncApEnabledUi();
        scheduleApUpdate();
      } else {
        (config.pluginSettings[id] ||= {})[k] = v;
        restartSoon(id);
      }
      saveSoon();
    } else if (t.dataset?.act === 'app-accent-pick') {
      config.appearance = config.appearance || {};
      config.appearance.enabled = true;
      config.appearance.accentColor = t.value;
      t.closest('.dc-app-swatches')?.querySelectorAll('.dc-app-sw.active').forEach((b) => b.classList.remove('active'));
      const hexEl = document.getElementById('dc-app-hex');
      if (hexEl) hexEl.textContent = t.value;
      syncApEnabledUi();
      scheduleApUpdate();
      saveSoon();
    } else if (t.dataset?.act === 'search') {
      query = t.value;
      document.getElementById('dc-search-clr')?.classList.toggle('show', Boolean(query));
      const grid = document.getElementById('dc-grid');
      if (grid) setHTML(grid, cardsHtml());
    } else if (t.dataset?.act === 'font-search') {
      fontQuery = t.value;
      const list = document.getElementById('dc-font-list');
      if (list) setHTML(list, fontListHtml());
    } else if (t.dataset?.act === 'cf-search') {
      cfQuery = t.value;
      const list = document.getElementById('dc-cf-list');
      if (list) setHTML(list, cfListHtml());
    } else if (t.dataset?.act === 'css') {
      config.customCss = t.value;
      const meta = document.getElementById('dc-css-meta');
      if (meta) {
        const lines = t.value ? t.value.split('\n').length : 0;
        meta.textContent = L(`${lines} ligne(s) · ${t.value.length} caractères`, `${lines} line(s) · ${t.value.length} characters`);
      }
      restartSoon('custom-css');
      saveSoon();
    }
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter') return;
    if (e.target?.id === 'dc-url') {
      e.preventDefault();
      applyUrlInput();
    } else if (e.target?.id === 'dc-cf-add-id') {
      e.preventDefault();
      addCfByIdInput();
    }
  }

  function bindBox(box) {
    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    box.addEventListener('input', onInput);
    box.addEventListener('keydown', onKeyDown);
  }

  // ============================================================
  //  Démarrage
  // ============================================================
  async function init() {
    try {
      config = boot.config ? JSON.parse(JSON.stringify(boot.config)) : await window.DreamCordNative?.getConfig?.();
      if (!config) {
        log('ERREUR: config introuvable');
        return;
      }
      normalizeConfig();
      const wp = config.wallpaper;
      if (wp.enabled && wp.source === 'file' && wp.filePath && !wallpaperSrc) {
        wallpaperSrc = (await Bridge.getWallpaperUrl(wp.filePath)) || '';
      }
      setStyle('dc-base-css', BASE_CSS);
      applyAll();
      addTask('launcher', ensureLauncher);
      ensureLauncher();
      persistLocal();
      listen(window, 'keydown', (e) => {
        if (e.key === 'F9' || (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D'))) {
          e.preventDefault();
          openDreamCord('plugins');
        }
      });
      window.DreamCordNative?.onOpenStudio?.(() => openDreamCord('plugins'));
      log('DreamCord prêt (fond: ' + (wallpaperActive() ? 'oui' : 'non') + ', plugins: ' + active.size + ')');
    } catch (err) {
      log('ERREUR init(): ' + (err?.stack || err?.message || err));
    } finally {
      root.setAttribute('data-dc-stage', 'ready'); // l'écran de chargement peut se fermer
    }
  }

  window.__DREAMCORD_REFRESH_BOOT__ = (b) => {
    if (b?.wallpaperUrl && !wallpaperSrc) wallpaperSrc = b.wallpaperUrl;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
