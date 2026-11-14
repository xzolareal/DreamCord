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

  function normalizeConfig() {
    const d = boot.defaults || {};
    config.window = Object.assign({}, d.window, config.window);
    config.wallpaper = Object.assign({}, WP_FALLBACK, d.wallpaper, config.wallpaper);
    config.plugins = Object.assign({}, d.plugins, config.plugins);
    const ps = {};
    for (const k of new Set([...Object.keys(d.pluginSettings || {}), ...Object.keys(config.pluginSettings || {})])) {
      ps[k] = Object.assign({}, d.pluginSettings?.[k], config.pluginSettings?.[k]);
    }
    config.pluginSettings = ps;
    if (typeof config.customCss !== 'string') config.customCss = '';
    config.lang = config.lang === 'en' ? 'en' : 'fr';
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
    t.className = 'dc-toast-' + kind;
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._tm);
    t._tm = setTimeout(() => (t.style.opacity = '0'), 2400);
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
  //  Observateur DOM unique (un seul rappel par rafale, travail regroupé)
  // ============================================================
  const domTasks = new Map(); // id -> { fn, records }
  let observer = null;
  let flushTimer = 0;

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((records) => {
      for (const t of domTasks.values()) {
        if (!t.records) continue;
        try {
          t.fn(records);
        } catch {}
      }
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = 0;
        const run = () => {
          for (const t of domTasks.values()) {
            if (t.records) continue;
            try {
              t.fn();
            } catch {}
          }
        };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 400 });
        else run();
      }, 300);
    });
    const attach = () => (document.body ? observer.observe(document.body, { childList: true, subtree: true }) : setTimeout(attach, 30));
    attach();
  }

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
    wallpaper: ['M3 5h18v14H3z', circle(8.5, 10, 1.6), 'M3 17l5.5-5 4 4 3-3L21 17'],
    trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
    smile: [circle(12, 12, 9), 'M8.5 14.5a4.5 4.5 0 0 0 7 0', 'M9 9.5h.01', 'M15 9.5h.01'],
    globe: [circle(12, 12, 9), 'M3 12h18', 'M12 3c3 3.5 3 14 0 18', 'M12 3c-3 3.5-3 14 0 18'],
    code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M14 4l-4 16'],
    clock: [circle(12, 12, 9), 'M12 7v5l3 2'],
    hash: ['M5 9h14', 'M5 15h14', 'M10 4L8 20', 'M16 4l-2 16'],
    zoom: [circle(11, 11, 7), 'M20 20l-4-4', 'M11 8v6', 'M8 11h6'],
    link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
    eyeoff: ['M3 3l18 18', 'M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-3.2 3.8', 'M6.5 7.5C4.2 9.2 3 12 3 12s4 6 9 6a9 9 0 0 0 3.5-.7'],
    shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
    timer: [circle(12, 13, 8), 'M12 9v4l2 2', 'M9 3h6'],
    layout: ['M3 4h18v16H3z', 'M3 9h18', 'M9 9v11'],
    users: [circle(9, 8, 3.2), 'M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6', circle(17, 9, 2.4), 'M16 14.2c3 .2 5 2.3 5 5.3'],
    pulse: ['M3 12h4l3-8 4 16 3-8h4'],
    scroll: ['M12 3v18', 'M8 7l4-4 4 4', 'M8 17l4 4 4-4'],
    layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
    type: ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'],
    zap: ['M13 2L4 14h7l-1 8 9-12h-7z'],
    pin: ['M9 3h6l-1 6 3 3H7l3-3z', 'M12 12v9'],
    drop: ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'],
    braces: [
      'M8 4c-2 0-3 1-3 3v2c0 1.5-1 3-3 3 2 0 3 1.5 3 3v2c0 2 1 3 3 3',
      'M16 4c2 0 3 1 3 3v2c0 1.5 1 3 3 3-2 0-3 1.5-3 3v2c0 2-1 3-3 3'
    ],
    copy: ['M9 9h11v11H9z', 'M4 15V4h11'],
    send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
    gear: [
      circle(12, 12, 3),
      'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'
    ]
  };
  const svgStr = (name, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(ICONS[name] || ICONS.sparkle)
      .map((d) => `<path d="${d}"/>`)
      .join('')}</svg>`;

  // ============================================================
  //  Plugins
  //  start() renvoie une fonction de nettoyage ; "sliders" = réglages numériques
  // ============================================================
  const MSG_LOGGER_CSS =
    '.dc-msg-deleted{background:rgba(218,55,60,.14)!important;border-left:3px solid #da373c!important;border-radius:0 6px 6px 0}' +
    '.dc-msg-deleted-badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;background:rgba(218,55,60,.28);color:#fca5a5;font-size:10px;font-weight:700;text-transform:uppercase;vertical-align:middle}';

  const TRACKERS = /^(utm_[a-z0-9_]+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|mc_eid|mc_cid|igshid|igsh|ref_src|ref_url|_hsenc|_hsmi|mkt_tok|vero_id|yclid|twclid|ttclid|li_fat_id|s_cid)$/i;
  const HOST_TRACKERS = {
    'youtube.com': ['si', 'feature', 'pp'],
    'youtu.be': ['si', 'feature', 'pp'],
    'open.spotify.com': ['si', 'context'],
    'twitter.com': ['s', 't'],
    'x.com': ['s', 't'],
    'tiktok.com': ['_t', '_r', 'is_from_webapp', 'sender_device']
  };
  function cleanUrl(href) {
    try {
      const u = new URL(href);
      const extra = HOST_TRACKERS[u.hostname.replace(/^(www|m|music)\./, '')];
      let changed = false;
      for (const k of [...u.searchParams.keys()]) {
        if (TRACKERS.test(k) || (extra && extra.includes(k))) {
          u.searchParams.delete(k);
          changed = true;
        }
      }
      return changed ? u.toString() : null;
    } catch {
      return null;
    }
  }

  function openZoom(url) {
    document.getElementById('dc-zoom')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'dc-zoom';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = url;
    wrap.appendChild(img);
    document.body.appendChild(wrap);
    let offKey = noop;
    const close = () => {
      offKey();
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 180);
    };
    offKey = listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }, true);
    wrap.onclick = close;
  }

  const AVATAR_SEL = [
    'avatars', 'embed/avatars', 'guilds', 'icons', 'banners', 'role-icons', 'avatar-decoration-presets'
  ].map((d) => `img[src*="cdn.discordapp.com/${d}/"]`).join(',');

  const PLUGINS = [
    {
      id: 'lively-wallpaper', name: 'Fond animé', desc: 'Vidéo, GIF ou image', cat: 'ui', icon: 'wallpaper',
      isWallpaper: true, hasPage: true
    },
    {
      id: 'message-logger', name: 'Messages supprimés', desc: 'Restent visibles en rouge', cat: 'chat', icon: 'trash',
      start() {
        let lastScroll = 0;
        let lastNav = 0;
        let lastHref = location.href;
        const ghosts = [];
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
            for (const removed of m.removedNodes) {
              if (removed.nodeType !== 1 || !removed.id || !removed.id.startsWith('chat-messages-')) continue;
              if (removed.classList.contains('dc-msg-deleted') || document.getElementById(removed.id)) continue;
              const ghost = removed.cloneNode(true);
              ghost.classList.add('dc-msg-deleted');
              const header = ghost.querySelector('[id^="message-username-"], h3');
              if (header && !ghost.querySelector('.dc-msg-deleted-badge')) {
                const badge = document.createElement('span');
                badge.className = 'dc-msg-deleted-badge';
                badge.textContent = 'Supprimé';
                header.appendChild(badge);
              }
              if (m.nextSibling && m.target.contains(m.nextSibling)) m.target.insertBefore(ghost, m.nextSibling);
              else m.target.appendChild(ghost);
              ghosts.push(ghost);
              if (ghosts.length > 150) ghosts.shift().remove();
            }
          }
        }, true);
        return chain(
          listen(document, 'scroll', () => (lastScroll = Date.now()), true),
          offTask,
          () => {
            setStyle('dc-p-message-logger', '');
            ghosts.forEach((g) => g.remove());
          }
        );
      }
    },
    {
      id: 'translate', name: 'Traduire', desc: 'Alt + clic droit', cat: 'chat', icon: 'globe',
      start() {
        const lang = (navigator.language || 'fr').slice(0, 2);
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
            box = document.createElement('div');
            box.className = 'dc-translate-box';
            box.textContent = '…';
            content.after(box);
            try {
              const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(content.textContent.trim())}`);
              const data = await r.json();
              const text = Array.isArray(data?.[0]) ? data[0].map((s) => s?.[0] || '').join('') : '';
              box.textContent = text || 'Traduction indisponible';
            } catch {
              box.textContent = 'Erreur réseau';
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
          const raw = li.querySelector('[id^="message-content-"]')?.innerText || '';
          const ts = li.querySelector('time[datetime]')?.getAttribute('datetime') || '';
          navigator.clipboard?.writeText(`ID: ${li.id.replace('chat-messages-', '')}\nDate: ${ts}\n${raw}`);
          showToast('Message copié', 'ok');
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
      sliders: [{ key: 'amount', label: 'Intensité', min: 4, max: 20, step: 1, unit: ' px', def: 8 }],
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
        const iv = setInterval(() => {
          const host = document.querySelector('[class*="rtcConnectionStatus_"]');
          if (!host) {
            startAt = 0;
            return;
          }
          if (!startAt) startAt = Date.now();
          let badge = document.getElementById('dc-call-timer');
          if (!badge) {
            badge = document.createElement('span');
            badge.id = 'dc-call-timer';
            host.appendChild(badge);
          }
          const sec = Math.floor((Date.now() - startAt) / 1000);
          badge.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
        }, 1000);
        return () => {
          clearInterval(iv);
          document.getElementById('dc-call-timer')?.remove();
        };
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
      sliders: [{ key: 'value', label: 'Opacité', min: 40, max: 100, step: 1, unit: ' %', def: 92 }],
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
      sliders: [{ key: 'size', label: 'Taille', min: 12, max: 24, step: 1, unit: ' px', def: 16 }],
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
        ensureNetHook();
        setStyle('dc-p-server-cloner', CLONER_CSS);
        const onCtx = (e) => {
          const item = e.target.closest?.('[data-list-item-id^="guildsnav___"]');
          const m = item?.getAttribute('data-list-item-id')?.match(/^guildsnav___(\d{15,22})$/);
          if (!m) return;
          const guildId = m[1];
          const inject = () => {
            const menu = document.querySelector('#guild-context, [role="menu"][id*="guild"]');
            if (!menu || menu.querySelector('#dc-ctx-clone-guild')) return;
            const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
            if (!target.querySelector('.dc-ctx-hdr')) {
              const hdr = document.createElement('div');
              hdr.className = 'dc-ctx-hdr';
              hdr.textContent = 'Option DreamCord';
              target.appendChild(hdr);
            }
            const btn = document.createElement('div');
            btn.id = 'dc-ctx-clone-guild';
            btn.className = 'dc-ctx-clone';
            btn.setAttribute('role', 'menuitem');
            btn.textContent = 'Cloner le serveur';
            btn.onclick = (ev) => {
              ev.stopPropagation();
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
              menu.remove();
              cloneGuild(guildId);
            };
            target.appendChild(btn);
          };
          [20, 60, 140, 260].forEach((ms) => setTimeout(inject, ms));
        };
        return chain(listen(document, 'contextmenu', onCtx, true), () => {
          setStyle('dc-p-server-cloner', '');
          document.getElementById('dc-ctx-clone-guild')?.remove();
        });
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
    }
  ];

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
    }
  };

  // CSS perso : thèmes du dossier + éditeur intégré
  function buildCustomCss() {
    const themes = (boot.themes || []).map((t) => `/* ${t.file} */\n${t.css}`).join('\n');
    return `${themes}\n/* éditeur */\n${config.customCss || ''}`;
  }

  const CLONER_CSS =
    '.dc-ctx-clone{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0;padding:6px 8px;border-radius:4px;color:#a5b4fc;font-size:14px;font-weight:500;cursor:pointer;user-select:none}' +
    '.dc-ctx-clone:hover{background:#5865f2;color:#fff}' +
    '.dc-ctx-hdr{display:flex;align-items:center;gap:8px;margin:6px 4px 2px;padding:2px 0;font:700 10.5px/1 "gg sans",Segoe UI,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;user-select:none}' +
    '.dc-ctx-hdr::before,.dc-ctx-hdr::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.1)}' +
    '.dc-clone-backdrop{position:fixed;inset:0;z-index:999998;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;font:14px/1.45 "gg sans","Noto Sans",Segoe UI,system-ui,sans-serif;color:#f4f4f5}' +
    '.dc-clone-box{width:480px;max-width:calc(100vw - 32px);background:#050507;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.8);display:flex;flex-direction:column;gap:14px}' +
    '.dc-clone-head{display:flex;align-items:center;justify-content:space-between;gap:12px}' +
    '.dc-clone-title{font-size:18px;font-weight:700;color:#fff}' +
    '.dc-clone-pct{font-size:16px;font-weight:700;color:#818cf8;font-variant-numeric:tabular-nums}' +
    '.dc-clone-status{font-size:13.5px;color:#d4d4d8}.dc-clone-meta{font-size:12px;color:#71717a}' +
    '.dc-clone-bar{width:100%;height:6px;border-radius:999px;background:#141418;overflow:hidden}' +
    '.dc-clone-fill{height:100%;width:0%;background:linear-gradient(90deg,#5865f2,#818cf8,#fff);transition:width .18s ease}' +
    '.dc-clone-bots{max-height:170px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}' +
    '.dc-clone-bot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:#e2e8f0}' +
    '.dc-clone-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}' +
    '.dc-clone-btn{height:34px;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:#f4f4f5;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}' +
    '.dc-clone-btn:hover{background:rgba(255,255,255,.12)}' +
    '.dc-clone-btn.primary{background:linear-gradient(135deg,#6366f1,#818cf8);border-color:transparent;color:#fff}';

  let wpReq = null;
  function findWebpackExport(pred) {
    try {
      if (!wpReq) {
        window.webpackChunkdiscord_app?.push([[Symbol()], {}, (r) => { wpReq = r; }]);
      }
      const cache = wpReq?.c;
      if (!cache) return null;
      for (const id in cache) {
        const exp = cache[id]?.exports;
        if (!exp || (typeof exp !== 'object' && typeof exp !== 'function')) continue;
        try {
          if (pred(exp)) return exp;
        } catch {}
        for (const k in exp) {
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
          }
        }
      }
    } catch {}
    return null;
  }

  let cachedRestApi = null;
  function getRestApi() {
    if (!cachedRestApi) {
      const isBase = (m) =>
        typeof m.get === 'function' &&
        typeof m.post === 'function' &&
        typeof m.patch === 'function' &&
        typeof m.del === 'function' &&
        typeof m.put === 'function' &&
        !m.open &&
        !m.send;
      cachedRestApi =
        findWebpackExport((m) => isBase(m) && (typeof m.getAPIBaseURL === 'function' || /url|rejectWithError|oldFormErrors/.test(String(m.get)))) ||
        findWebpackExport(isBase);
    }
    return cachedRestApi;
  }

  async function dcDiscordApi(method, path, _unused, body, step = '') {
    const rest = getRestApi();
    if (!rest) throw new Error('Module RestAPI Discord introuvable');
    const fnMap = { GET: 'get', POST: 'post', PATCH: 'patch', DELETE: 'del', PUT: 'put' };
    const fn = rest[fnMap[method] || 'get'];
    if (typeof fn !== 'function') throw new Error(`Méthode HTTP non supportée: ${method}`);

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
          <div class="dc-clone-title">ServerCloner</div>
          <div class="dc-clone-pct" id="dc-cl-pct">0 %</div>
        </div>
        <div class="dc-clone-status" id="dc-cl-status">Récupération du serveur...</div>
        <div class="dc-clone-bar"><div class="dc-clone-fill" id="dc-cl-fill"></div></div>
        <div class="dc-clone-meta" id="dc-cl-meta">Initialisation...</div>
        <div id="dc-cl-extra"></div>
        <div class="dc-clone-actions" id="dc-cl-actions">
          <button type="button" class="dc-clone-btn" id="dc-cl-close">Fermer</button>
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
    wrap.querySelector('#dc-cl-close').onclick = () => {
      aborted = true;
      wrap.remove();
    };

    try {
      const GuildStore = findWebpackExport((m) => typeof m.getGuild === 'function' && typeof m.getGuilds === 'function');
      const RoleStore = findWebpackExport((m) => typeof m.getSortedRoles === 'function' && typeof m.getRole === 'function');
      const GuildChStore = findWebpackExport((m) => typeof m.getChannels === 'function' && typeof m.getDefaultChannel === 'function');
      const toArr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

      const [apiGuild, apiRoles, apiChannels] = await Promise.all([
        dcDiscordApi('GET', `/guilds/${guildId}`, token, null, 'Lecture serveur').catch(() => null),
        dcDiscordApi('GET', `/guilds/${guildId}/roles`, token, null, 'Lecture rôles').catch(() => null),
        dcDiscordApi('GET', `/guilds/${guildId}/channels`, token, null, 'Lecture salons').catch(() => null)
      ]);
      const guild = apiGuild || GuildStore?.getGuild?.(guildId);
      if (!guild) throw new Error('Serveur source introuvable');
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

      setProg(`Création de "${guild.name}"...`, 10, 'Téléchargement de l’icône...');
      const safeName = String(guild.name || 'Serveur').trim().slice(0, 100).padEnd(2, ' ');
      const icon = await fetchIconDataUri(guild);
      let newGuild;
      try {
        newGuild = await dcDiscordApi(
          'POST',
          '/guilds',
          token,
          { name: safeName, icon: icon || null, channels: [], system_channel_id: null, guild_template_code: '2TffvPucqHkN' },
          'Création serveur'
        );
      } catch (e) {
        if (icon) {
          newGuild = await dcDiscordApi(
            'POST',
            '/guilds',
            token,
            { name: safeName, icon: null, channels: [], system_channel_id: null, guild_template_code: '2TffvPucqHkN' },
            'Création serveur'
          );
        } else {
          throw e;
        }
      }
      if (!newGuild?.id) throw new Error('Création serveur impossible (aucun ID reçu)');
      if (icon && !newGuild.icon) {
        await dcDiscordApi('PATCH', `/guilds/${newGuild.id}`, token, { icon }, 'Icône serveur').catch(() => {});
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
          }, 'Création rôle');
          if (created?.id) {
            roleMap[r.id] = created.id;
            rolesOk++;
          }
        } catch {}
        done++;
        setProg(`Création des rôles : ${r.name}`, 15 + (done / totalSteps) * 80, `Rôles : ${rolesOk}/${customRoles.length}`);
      });

      const mapOverwrites = (c) =>
        toArr(c.permission_overwrites || c.permissionOverwrites)
          .filter((o) => o && o.type === 0 && roleMap[o.id])
          .map((o) => ({ id: roleMap[o.id], type: 0, allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') }));

      const cats = (channels || []).filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
      const others = (channels || []).filter((c) => c.type !== 4 && [0, 2, 5, 13, 15].includes(c.type)).sort((a, b) => a.position - b.position);
      const catMap = {};

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
        setProg(`Catégorie : ${c.name}`, 15 + (done / totalSteps) * 80, `Rôles : ${rolesOk}/${customRoles.length} · Salons : ${chansOk}/${cats.length + others.length}`);
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
        setProg(`Salon : ${c.name}`, 15 + (done / totalSteps) * 80, `Rôles : ${rolesOk}/${customRoles.length} · Salons : ${chansOk}/${cats.length + others.length}`);
      });

      setProg(`Clonage de "${guild.name}" terminé !`, 100, `Rôles : ${rolesOk}/${customRoles.length} · Salons : ${chansOk}/${cats.length + others.length}`);
      if (detectedBots.length) {
        setHTML(
          wrap.querySelector('#dc-cl-extra'),
          `<div class="dc-clone-bots">
            <div style="font-size:12px;color:#94a3b8;margin-bottom:2px">Bots détectés (autorisation requise par Discord) :</div>
            ${detectedBots
              .map(
                (b) =>
                  `<div class="dc-clone-bot"><span>${esc(b.name)}</span><a class="dc-clone-btn" target="_blank" rel="noreferrer" href="https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(b.botId)}&scope=bot%20applications.commands&guild_id=${encodeURIComponent(newGuild.id)}">Ajouter</a></div>`
              )
              .join('')}
          </div>`
        );
      }
      const actions = wrap.querySelector('#dc-cl-actions');
      const goBtn = document.createElement('button');
      goBtn.type = 'button';
      goBtn.className = 'dc-clone-btn primary';
      goBtn.textContent = 'Ouvrir le serveur';
      goBtn.onclick = () => {
        wrap.remove();
        window.history.pushState({}, '', `/channels/${newGuild.id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      };
      actions.prepend(goBtn);
    } catch (err) {
      setProg('Erreur : ' + (err?.message || err), 0);
    }
  }

  // ============================================================
  //  Custom Friend (pseudo & PP locaux par utilisateur)
  // ============================================================
  const CF_CSS =
    '#dc-cf-modal{position:fixed;inset:0;z-index:100025;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(6px)}' +
    '.dc-cf-box{width:430px;max-width:92vw;padding:22px;border-radius:16px;background:rgba(0,0,0,.86);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);color:#f1f5f9;font:14px/1.45 "gg sans",Segoe UI,sans-serif;box-shadow:0 24px 64px rgba(0,0,0,.78);display:flex;flex-direction:column;gap:14px}' +
    '.dc-cf-head{display:flex;align-items:center;gap:12px}' +
    '.dc-cf-av{width:52px;height:52px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.08);flex-shrink:0}' +
    '.dc-cf-title{font-size:17px;font-weight:700;color:#fff}.dc-cf-uid{font-size:11.5px;color:#94a3b8}' +
    '.dc-cf-lbl{font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:5px}' +
    '.dc-cf-in{width:100%;height:38px;background:rgba(0,0,0,.65);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:9px;padding:0 12px;font:inherit;outline:none;box-sizing:border-box}' +
    '.dc-cf-in:focus{border-color:rgba(255,255,255,.35)}' +
    '.dc-cf-row{display:flex;gap:8px;align-items:center}' +
    '.dc-cf-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}';

  const getCfUsers = () => ((config.pluginSettings['custom-friend'] ||= { users: {} }).users ||= {});

  function extractUserInfo(target) {
    if (!target || typeof target.closest !== 'function') return null;
    const item = target.closest(
      'li[id^="chat-messages-"],[class*="member_"],[class*="channel_"],[class*="peopleListItem_"],[class*="userPopout"],[class*="userProfile"],[class*="header_"],[class*="accountProfileCard_"],[data-user-id]'
    );
    let userId = target.closest('[data-user-id]')?.getAttribute('data-user-id') || item?.getAttribute('data-user-id') || '';
    let origAvatar = '';
    let origName = '';

    const avImg =
      target.closest('img[src*="/avatars/"], img[data-dc-cf-uid]') ||
      item?.querySelector('img[src*="/avatars/"], img[data-dc-cf-uid]');
    if (avImg) {
      origAvatar = avImg.dataset.dcCfOrigSrc || avImg.src || '';
      if (!userId) userId = avImg.dataset.dcCfUid || (origAvatar.match(/\/avatars\/(\d{15,22})\//)?.[1] || '');
    }

    const nameEl = item?.querySelector('[id^="message-username-"], [class*="username_"], [class*="name_"], [class*="nickname_"], [class*="userTagUsername"]');
    if (nameEl) origName = nameEl.dataset.dcCfOrigName || nameEl.textContent?.trim() || '';

    if (!userId) {
      try {
        let cur = target;
        for (let depth = 0; depth < 8 && cur && !userId; depth++, cur = cur.parentElement) {
          const fk = Object.keys(cur).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$'));
          if (!fk) continue;
          let node = cur[fk];
          for (let i = 0; i < 12 && node && !userId; i++, node = node.return) {
            const p = node.memoizedProps || node;
            const u = p?.user || p?.message?.author || p?.author;
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
      } catch {}
    }
    return userId ? { userId, origName, origAvatar } : null;
  }

  function applyCustomFriends() {
    const users = getCfUsers();
    const uids = Object.keys(users);
    if (!uids.length) return;
    for (const uid of uids) {
      const entry = users[uid];
      if (!entry) continue;
      const setName = (el) => {
        if (!el) return;
        let target = el;
        if (el.querySelector('svg,img,[class*="clanTag"],[class*="botTag"],[class*="badge"]')) {
          const sub = Array.from(el.querySelectorAll('span,div')).find(
            (c) =>
              !c.closest('[class*="clanTag"],[class*="botTag"],[class*="badge"]') &&
              !c.querySelector('svg,img,[class*="clanTag"],[class*="botTag"],[class*="badge"]') &&
              c.textContent?.trim()
          );
          if (sub) target = sub;
          else {
            const tn = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.nodeValue?.trim());
            if (!tn) return;
            if (entry.name) {
              el.dataset.dcCfUid = uid;
              if (el.dataset.dcCfOrigName === undefined) el.dataset.dcCfOrigName = tn.nodeValue;
              if (tn.nodeValue !== entry.name) tn.nodeValue = entry.name;
            } else if (el.dataset.dcCfOrigName !== undefined) {
              tn.nodeValue = el.dataset.dcCfOrigName;
              delete el.dataset.dcCfOrigName;
              delete el.dataset.dcCfUid;
            }
            return;
          }
        }
        if (entry.name) {
          target.dataset.dcCfUid = uid;
          if (target.dataset.dcCfOrigName === undefined) target.dataset.dcCfOrigName = target.textContent || '';
          if (target.hasAttribute('data-text')) target.setAttribute('data-text', entry.name);
          const tn = Array.from(target.childNodes).find((n) => n.nodeType === 3 && n.nodeValue?.trim());
          if (tn) {
            if (tn.nodeValue !== entry.name) tn.nodeValue = entry.name;
          } else if (!target.children.length && target.textContent !== entry.name) {
            target.textContent = entry.name;
          }
        } else if (target.dataset.dcCfOrigName !== undefined) {
          if (target.hasAttribute('data-text')) target.setAttribute('data-text', target.dataset.dcCfOrigName);
          const tn = Array.from(target.childNodes).find((n) => n.nodeType === 3);
          if (tn) tn.nodeValue = target.dataset.dcCfOrigName;
          else if (!target.children.length) target.textContent = target.dataset.dcCfOrigName;
          delete target.dataset.dcCfOrigName;
          delete target.dataset.dcCfUid;
        }
      };
      const imgs = document.querySelectorAll(`img[src*="/avatars/${uid}/"], img[data-dc-cf-uid="${uid}"]`);
      imgs.forEach((img) => {
        img.dataset.dcCfUid = uid;
        if (entry.avatar) {
          if (!img.dataset.dcCfOrigSrc) img.dataset.dcCfOrigSrc = img.src;
          if (img.src !== entry.avatar) img.src = entry.avatar;
        } else if (img.dataset.dcCfOrigSrc) {
          img.src = img.dataset.dcCfOrigSrc;
          delete img.dataset.dcCfOrigSrc;
        }
        const profileBox = img.closest(
          '[class*="profilePanel_"],[class*="userPanelOuter"],[class*="userProfileOuter"],[class*="userPopout"],[class*="userProfile"],aside[class*="outer_"]'
        );
        const box =
          profileBox ||
          img.closest(
            'li[id^="chat-messages-"],[class*="member_"],[class*="channel_"],[class*="peopleListItem_"],[class*="upperContainer_"],[class*="accountProfileCard_"]'
          );
        if (!box) return;
        if (profileBox) {
          profileBox
            .querySelectorAll('[class*="nickname_"],[class*="userTagUsername"],[class*="username_"],h1,h2')
            .forEach((el) => setName(el));
        } else {
          const nameEl = box.querySelector(
            '[id^="message-username-"],[class*="username_"],[class*="name_"],[class*="nickname_"],[class*="userTagUsername"],h1,[class*="title_"]'
          );
          setName(nameEl);
        }
      });
      if (
        document.querySelector(
          `[class*="privateChannels_"] :is([class*="selected_"],[aria-current="page"]) img[data-dc-cf-uid="${uid}"]`
        )
      ) {
        document
          .querySelectorAll(
            '[class*="upperContainer_"] h1,[class*="titleWrapper_"] h1,[class*="upperContainer_"] [class*="nicknames_"],[class*="upperContainer_"] [class*="title_"]'
          )
          .forEach((el) => setName(el));
      }
    }
  }

  function restoreCustomFriend(uid) {
    const sel = uid ? `[data-dc-cf-uid="${uid}"]` : '[data-dc-cf-uid]';
    document.querySelectorAll(sel).forEach((el) => {
      if (el.tagName === 'IMG' && el.dataset.dcCfOrigSrc) {
        el.src = el.dataset.dcCfOrigSrc;
        delete el.dataset.dcCfOrigSrc;
      } else if (el.dataset.dcCfOrigName !== undefined) {
        const tn = el.querySelector('svg,img') && Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.nodeValue?.trim());
        if (tn) tn.nodeValue = el.dataset.dcCfOrigName;
        else el.textContent = el.dataset.dcCfOrigName;
        delete el.dataset.dcCfOrigName;
      }
      delete el.dataset.dcCfUid;
    });
  }

  function imageFileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Lecture impossible'));
      reader.onload = () => {
        const res = String(reader.result || '');
        if (file.type === 'image/gif' && res.length < 700000) return resolve(res);
        const im = new Image();
        im.onload = () => {
          const max = 256;
          const scale = Math.min(1, max / Math.max(im.width || max, im.height || max));
          const w = Math.max(1, Math.round(im.width * scale));
          const h = Math.max(1, Math.round(im.height * scale));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(im, 0, 0, w, h);
          resolve(c.toDataURL('image/webp', 0.88));
        };
        im.onerror = () => resolve(res);
        im.src = res;
      };
      reader.readAsDataURL(file);
    });
  }

  function openCustomFriendModal(info) {
    document.getElementById('dc-cf-modal')?.remove();
    const users = getCfUsers();
    const cur = users[info.userId] || {};
    const wrap = document.createElement('div');
    wrap.id = 'dc-cf-modal';
    setHTML(
      wrap,
      `<div class="dc-cf-box">
        <div class="dc-cf-head">
          <img class="dc-cf-av" id="dc-cf-prev" src="${esc(cur.avatar || info.origAvatar || '')}" alt="">
          <div>
            <div class="dc-cf-title">Custom Friend</div>
            <div class="dc-cf-uid">${esc(info.origName || 'Utilisateur')} · ${esc(info.userId)}</div>
          </div>
        </div>
        <div>
          <div class="dc-cf-lbl">Nouveau pseudo (local)</div>
          <input class="dc-cf-in" id="dc-cf-name" placeholder="Laisser vide pour garder l'original" value="${esc(cur.name || '')}">
        </div>
        <div>
          <div class="dc-cf-lbl">Photo de profil (URL ou image du PC)</div>
          <div class="dc-cf-row">
            <input class="dc-cf-in" id="dc-cf-av-in" placeholder="https://… ou choisir un fichier" value="${esc(cur.avatar || '')}">
            <button type="button" class="dc-clone-btn" id="dc-cf-pick" style="flex-shrink:0">Image…</button>
          </div>
          <input type="file" id="dc-cf-file" accept="image/*" style="display:none">
        </div>
        <div class="dc-cf-actions">
          ${cur.name || cur.avatar ? '<button type="button" class="dc-clone-btn" id="dc-cf-reset">Réinitialiser</button>' : ''}
          <button type="button" class="dc-clone-btn" id="dc-cf-cancel">Annuler</button>
          <button type="button" class="dc-clone-btn primary" id="dc-cf-save">Enregistrer</button>
        </div>
      </div>`
    );
    document.body.appendChild(wrap);

    const avIn = wrap.querySelector('#dc-cf-av-in');
    const prev = wrap.querySelector('#dc-cf-prev');
    const fileIn = wrap.querySelector('#dc-cf-file');
    avIn.oninput = () => { prev.src = avIn.value.trim() || info.origAvatar || ''; };
    wrap.querySelector('#dc-cf-pick').onclick = () => fileIn.click();
    fileIn.onchange = async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      try {
        const dataUrl = await imageFileToDataUrl(f);
        avIn.value = dataUrl;
        prev.src = dataUrl;
      } catch {
        showToast('Image invalide', 'error');
      }
    };
    wrap.querySelector('#dc-cf-cancel').onclick = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    const resetBtn = wrap.querySelector('#dc-cf-reset');
    if (resetBtn) {
      resetBtn.onclick = () => {
        delete users[info.userId];
        restoreCustomFriend(info.userId);
        saveSoon();
        wrap.remove();
        rerender();
        showToast('Ami réinitialisé', 'ok');
      };
    }
    wrap.querySelector('#dc-cf-save').onclick = () => {
      const name = wrap.querySelector('#dc-cf-name').value.trim();
      const avatar = avIn.value.trim();
      if (!name && !avatar) {
        delete users[info.userId];
        restoreCustomFriend(info.userId);
      } else {
        users[info.userId] = { name, avatar, origName: info.origName || cur.origName || '' };
        applyCustomFriends();
      }
      saveSoon();
      wrap.remove();
      rerender();
      showToast('Custom Friend enregistré', 'ok');
    };
  }

  function startCustomFriend() {
    setStyle('dc-p-custom-friend', CLONER_CSS + CF_CSS);
    applyCustomFriends();
    const offTask = addTask('custom-friend', applyCustomFriends);
    const onCtx = (e) => {
      if (e.target.closest?.('[data-list-item-id^="guildsnav___"]')) return;
      const info = extractUserInfo(e.target);
      if (!info) return;
      const inject = () => {
        const menu = document.querySelector('#user-context, [role="menu"][id*="user"], [role="menu"]:not(#guild-context)');
        if (!menu || menu.id === 'guild-context' || menu.querySelector('#dc-ctx-custom-friend')) return;
        if (!menu.querySelector('[role="menuitem"]')) return;
        const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
        if (!target.querySelector('.dc-ctx-hdr')) {
          const hdr = document.createElement('div');
          hdr.className = 'dc-ctx-hdr';
          hdr.textContent = 'Option DreamCord';
          target.appendChild(hdr);
        }
        const btn = document.createElement('div');
        btn.id = 'dc-ctx-custom-friend';
        btn.className = 'dc-ctx-clone';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = 'Custom Friend';
        btn.onclick = (ev) => {
          ev.stopPropagation();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          menu.remove();
          openCustomFriendModal(info);
        };
        target.appendChild(btn);
      };
      [50, 120, 250, 450, 700].forEach((ms) => setTimeout(inject, ms));
    };
    return chain(listen(document, 'contextmenu', onCtx, true), offTask, () => {
      setStyle('dc-p-custom-friend', '');
      document.getElementById('dc-ctx-custom-friend')?.remove();
      document.getElementById('dc-cf-modal')?.remove();
      restoreCustomFriend('');
    });
  }

  // ============================================================
  //  Fake Message Send (avion en papier dans la barre de chat)
  // ============================================================
  const FMS_CSS =
    '.dc-fms-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;margin:0 2px;border:0;border-radius:6px;background:transparent;color:#b5bac1;cursor:pointer;transition:color .12s,background .12s}' +
    '.dc-fms-btn:hover{color:#f2f3f5;background:rgba(255,255,255,.08)}' +
    '#dc-fms-modal{position:fixed;inset:0;z-index:100025;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(6px)}' +
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
    '.dc-fms-opt{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:9px;background:rgba(0,0,0,.65);border:1px solid rgba(255,255,255,.1);color:#d4d4d8;font:600 13px/1.2 "gg sans",Segoe UI,sans-serif;cursor:pointer;transition:all .14s}' +
    '.dc-fms-opt:hover{background:rgba(255,255,255,.08);color:#fff}' +
    '.dc-fms-opt.active{background:rgba(35,165,90,.18);border-color:#23a55a;color:#fff}' +
    '.dc-fms-opt img{width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0}';

  let cachedChannelStore = null;
  let cachedUserStore = null;

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
        name: ov?.name || name || id,
        avatar: ov?.avatar || avatar || ''
      });
    };

    try {
      if (!cachedChannelStore) {
        cachedChannelStore = findWebpackExport((m) => typeof m.getChannel === 'function' && typeof m.getDMFromUserId === 'function');
      }
      if (!cachedUserStore) {
        cachedUserStore = findWebpackExport((m) => typeof m.getUser === 'function' && typeof m.getCurrentUser === 'function');
      }
      const chId = location.pathname.match(/\/channels\/(?:@me|\d+)\/(\d{15,22})/)?.[1];
      const ch = chId && cachedChannelStore?.getChannel?.(chId);
      if (ch && Array.isArray(ch.recipients)) {
        for (const uid of ch.recipients) {
          const u = cachedUserStore?.getUser?.(uid);
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
    if (!list) return showToast('Ouvre une conversation d’abord', 'error');
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const li = document.createElement('li');
    li.className = 'dc-fms-msg';
    setHTML(
      li,
      `<img class="dc-fms-av" src="${esc(sender.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png')}" alt="">` +
        `<div class="dc-fms-hdr"><span class="dc-fms-user">${esc(sender.name)}</span><span class="dc-fms-ts">Aujourd’hui à ${hm}</span></div>` +
        `<div class="dc-fms-txt">${esc(text)}</div>` +
        `<button type="button" class="dc-fms-del" title="Supprimer">${svgStr('trash', 14)}</button>`
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
        ? `<div><div class="dc-cf-lbl">Envoyer au nom de</div><div class="dc-fms-list" id="dc-fms-list">` +
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
            `<div><div class="dc-cf-title" style="font-size:15px">${esc(people[0].name)}</div><div class="dc-cf-uid">Expéditeur (local)</div></div></div>`
          : `<div><div class="dc-cf-lbl">Pseudo de l’expéditeur</div><input class="dc-cf-in" id="dc-fms-custom-name" placeholder="Pseudo…"></div>`;

    setHTML(
      wrap,
      `<div class="dc-cf-box">
        <div class="dc-cf-title">Fake Message Send</div>
        ${selectorHtml}
        <div>
          <div class="dc-cf-lbl">Message</div>
          <textarea class="dc-cf-in" id="dc-fms-text" rows="3" style="height:auto;padding:10px 12px;resize:vertical" placeholder="Écris ton faux message…"></textarea>
        </div>
        <div class="dc-cf-actions">
          <button type="button" class="dc-clone-btn" id="dc-fms-cancel">Annuler</button>
          <button type="button" class="dc-clone-btn" id="dc-fms-send" style="background:#23a55a;border-color:transparent;color:#fff">Envoyer</button>
        </div>
      </div>`
    );
    document.body.appendChild(wrap);

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
      if (!text) return showToast('Écris un message', 'error');
      let sender;
      if (people.length > 1) {
        sender = people[selectedIdx] || people[0];
      } else if (people.length === 1) {
        sender = people[0];
      } else {
        const nm = (wrap.querySelector('#dc-fms-custom-name')?.value || '').trim() || 'Utilisateur';
        sender = { id: 'custom', name: nm, avatar: '' };
      }
      insertFakeMessage(sender, text);
      wrap.remove();
    };
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    };
    wrap.querySelector('#dc-fms-send').onclick = submit;
    wrap.querySelector('#dc-fms-cancel').onclick = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
  }

  function startFakeMessageSend() {
    setStyle('dc-p-fake-message-send', CLONER_CSS + CF_CSS + FMS_CSS);
    const ensureBtn = () => {
      const bar = document.querySelector('[class*="channelTextArea_"] [class*="buttons_"]');
      if (!bar || bar.querySelector('#dc-fms-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'dc-fms-btn';
      btn.className = 'dc-fms-btn';
      btn.title = 'Fake Message Send';
      setHTML(btn, svgStr('send', 19));
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
  function openClearMessagesModal(channelId) {
    const chId = channelId || location.pathname.match(/\/channels\/(?:@me|\d+)\/(\d{15,22})/)?.[1];
    if (!chId) return showToast(L('Ouvre une conversation d’abord', 'Open a conversation first'), 'error');
    document.getElementById('dc-clr-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'dc-clr-modal';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100025;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(6px)';
    setHTML(
      wrap,
      `<div class="dc-cf-box">
        <div class="dc-cf-title">All Clear Message</div>
        <div class="dc-cf-uid" id="dc-clr-status" style="font-size:13px;color:#cbd5e1">${esc(L('Supprime tous tes messages envoyés dans cette conversation.', 'Deletes all messages you sent in this conversation.'))}</div>
        <div class="dc-cf-actions">
          <button type="button" class="dc-clone-btn" id="dc-clr-cancel">${esc(L('Fermer', 'Close'))}</button>
          <button type="button" class="dc-clone-btn" id="dc-clr-go" style="background:#da373c;border-color:transparent;color:#fff">${esc(L('Tout supprimer', 'Clear All'))}</button>
        </div>
      </div>`
    );
    document.body.appendChild(wrap);

    let stopped = false;
    const statusEl = wrap.querySelector('#dc-clr-status');
    const goBtn = wrap.querySelector('#dc-clr-go');
    const cancelBtn = wrap.querySelector('#dc-clr-cancel');
    cancelBtn.onclick = () => {
      stopped = true;
      wrap.remove();
    };
    wrap.onclick = (e) => {
      if (e.target === wrap) {
        stopped = true;
        wrap.remove();
      }
    };

    goBtn.onclick = async () => {
      if (goBtn.dataset.running === '1') {
        stopped = true;
        goBtn.textContent = L('Arrêt…', 'Stopping...');
        return;
      }
      goBtn.dataset.running = '1';
      goBtn.textContent = L('Arrêter', 'Stop');
      try {
        const token = null;
        if (!cachedUserStore) {
          cachedUserStore = findWebpackExport((m) => typeof m.getUser === 'function' && typeof m.getCurrentUser === 'function');
        }
        const me = cachedUserStore?.getCurrentUser?.()?.id || (await dcDiscordApi('GET', '/users/@me', token))?.id;
        if (!me) throw new Error(L('Utilisateur introuvable', 'User not found'));

        let deleted = 0;
        let before = '';
        while (!stopped) {
          const q = before ? `?limit=100&before=${before}` : '?limit=100';
          const msgs = await dcDiscordApi('GET', `/channels/${chId}/messages${q}`, token, null, 'Fetch');
          if (!Array.isArray(msgs) || !msgs.length) break;
          before = msgs[msgs.length - 1].id;
          const mine = msgs.filter((m) => m.author?.id === me && (m.type === 0 || m.type === 19));
          for (const m of mine) {
            if (stopped) break;
            try {
              await dcDiscordApi('DELETE', `/channels/${chId}/messages/${m.id}`, token, null, 'Delete');
              deleted += 1;
              statusEl.textContent = `${L('Supprimés', 'Deleted')} : ${deleted}`;
            } catch {}
            await new Promise((r) => setTimeout(r, 900));
          }
          if (msgs.length < 100) break;
        }
        statusEl.textContent = stopped
          ? `${L('Arrêté. Supprimés', 'Stopped. Deleted')} : ${deleted}`
          : `${L('Terminé ! Supprimés', 'Done! Deleted')} : ${deleted}`;
        goBtn.style.display = 'none';
      } catch (err) {
        statusEl.textContent = `${L('Erreur', 'Error')} : ${err?.message || err}`;
        goBtn.dataset.running = '0';
        goBtn.textContent = L('Réessayer', 'Retry');
      }
    };
  }

  function startClearMessages() {
    ensureNetHook();
    setStyle('dc-p-clear-messages', CLONER_CSS + CF_CSS + FMS_CSS);
    const ensureToolbarBtn = () => {
      const bar = document.querySelector('[class*="upperContainer_"] [class*="toolbar_"]');
      if (!bar || bar.querySelector('#dc-clear-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'dc-clear-btn';
      btn.className = 'dc-fms-btn';
      btn.title = 'All Clear Message';
      setHTML(btn, svgStr('trash', 18));
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openClearMessagesModal();
      };
      bar.appendChild(btn);
    };
    const onCtx = (e) => {
      const dm = e.target.closest?.('a[href*="/channels/"]');
      const chId = dm?.getAttribute('href')?.match(/\/channels\/(?:@me|\d+)\/(\d{15,22})/)?.[1];
      if (!chId) return;
      const inject = () => {
        const menu = document.querySelector('#user-context, #channel-context, [role="menu"]:not(#guild-context)');
        if (!menu || menu.id === 'guild-context' || menu.querySelector('#dc-ctx-clear-msg')) return;
        if (!menu.querySelector('[role="menuitem"]')) return;
        const target = menu.querySelector('[role="group"]') || menu.querySelector('[class*="scroller_"]') || menu;
        if (!target.querySelector('.dc-ctx-hdr')) {
          const hdr = document.createElement('div');
          hdr.className = 'dc-ctx-hdr';
          hdr.textContent = 'Option DreamCord';
          target.appendChild(hdr);
        }
        const btn = document.createElement('div');
        btn.id = 'dc-ctx-clear-msg';
        btn.className = 'dc-ctx-clone';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = 'All Clear Message';
        btn.onclick = (ev) => {
          ev.stopPropagation();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          menu.remove();
          openClearMessagesModal(chId);
        };
        target.appendChild(btn);
      };
      [50, 120, 250, 450].forEach((ms) => setTimeout(inject, ms));
    };
    ensureToolbarBtn();
    const offTask = addTask('clear-messages', ensureToolbarBtn);
    return chain(offTask, listen(document, 'contextmenu', onCtx, true), () => {
      setStyle('dc-p-clear-messages', '');
      document.getElementById('dc-clear-btn')?.remove();
      document.getElementById('dc-ctx-clear-msg')?.remove();
      document.getElementById('dc-clr-modal')?.remove();
    });
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

  function removeWallpaper() {
    if (wpMedia && wpMedia.tagName === 'VIDEO') {
      try {
        wpMedia.pause();
        wpMedia.removeAttribute('src');
        wpMedia.load();
      } catch {}
    }
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
      showToast('Impossible de charger ce fichier', 'error');
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
      wpShade = host.querySelector('.dc-shade');
    }
    if (!host.isConnected) document.body.prepend(host);

    if (key !== wpKey) {
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
  //  CSS de base de DreamCord (une seule fois)
  // ============================================================
  const BASE_CSS = `
    #dc-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:100002;padding:9px 16px;border-radius:8px;font:600 13px/1.3 "gg sans",Segoe UI,sans-serif;color:#fff;background:#5865f2;box-shadow:0 8px 24px rgba(0,0,0,.45);pointer-events:none;transition:opacity .2s ease}
    #dc-toast.dc-toast-error{background:#da373c}#dc-toast.dc-toast-ok{background:#23a55a}
    .dc-translate-box{margin-top:4px;padding:6px 10px;border-left:2px solid #5865f2;background:rgba(88,101,242,.12);border-radius:0 6px 6px 0;font-size:12.5px;color:#f2f3f5}
    .dc-exact-ts{opacity:.65;font-size:.85em}
    #dc-call-timer{margin-left:6px;font-size:11px;font-weight:700;color:#94a3b8;font-variant-numeric:tabular-nums}
    #dc-clock{position:fixed;top:5px;left:50%;transform:translateX(-50%);z-index:100000;padding:2px 11px;border-radius:99px;background:rgba(0,0,0,.3);color:rgba(255,255,255,.8);font:600 12px/1.4 "gg sans",Segoe UI,sans-serif;letter-spacing:.04em;font-variant-numeric:tabular-nums;pointer-events:none}
    #dc-charcount{position:absolute;right:10px;bottom:100%;margin-bottom:4px;padding:1px 8px;border-radius:6px;background:rgba(0,0,0,.55);color:#94a3b8;font:600 11px/1.5 "gg sans",Segoe UI,sans-serif;pointer-events:none}
    #dc-charcount.warn{color:#fbbf24}#dc-charcount.bad{color:#f87171}
    #dc-zoom{position:fixed;inset:0;z-index:100010;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);backdrop-filter:blur(8px);cursor:zoom-out;animation:dcFade .18s ease}
    #dc-zoom img{max-width:88vw;max-height:88vh;border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.7);object-fit:contain;animation:dcPop .24s cubic-bezier(.16,1,.3,1)}
    #dc-zoom.out{opacity:0;transition:opacity .18s}
    @keyframes dcFade{from{opacity:0}to{opacity:1}}@keyframes dcPop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}
    .dc-up-btn{width:32px;height:32px;border-radius:6px;border:0;background:transparent;color:#b5bac1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .12s,color .12s}
    .dc-up-btn:hover{background:rgba(255,255,255,.1);color:#f2f3f5}
    #dc-settings-section{margin:6px 0;padding:8px 0;border-top:1px solid rgba(255,255,255,.07);border-bottom:1px solid rgba(255,255,255,.07)}
    .dc-nav-hdr{padding:4px 10px 6px;font-size:11.5px;font-weight:700;letter-spacing:.08em;color:#e4e4e7;text-transform:uppercase}
    .dc-nav-item{display:flex;align-items:center;gap:12px;padding:8px 10px;margin:1px 0;border-radius:8px;cursor:pointer;color:#a1a1aa;font-size:15px;font-weight:500;transition:background .12s,color .12s}
    .dc-nav-item:hover{background:rgba(255,255,255,.07);color:#f4f4f5}
    .dc-nav-item.active{background:rgba(255,255,255,.11);color:#fff;box-shadow:inset 2px 0 0 #23a55a}
  `;

  // Panneau DreamCord (dans les Paramètres Discord) : verre translucide
  const PANEL_CSS = `
    #dc-settings-embedded{flex:1 1 auto;width:100%;height:100%;max-height:100vh;overflow-y:auto;padding:20px 26px 48px;background:transparent;color:#e4e4e7;font:13.5px/1.4 "gg sans","Noto Sans",Segoe UI,system-ui,sans-serif;contain:content}
    #dc-settings-embedded *{box-sizing:border-box}
    #dc-settings-embedded>*{max-width:980px}
    #dc-settings-embedded::-webkit-scrollbar{width:7px}#dc-settings-embedded::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:99px}
    .dc-body{display:flex;flex-direction:column;gap:14px}
    .dc-emb-head{margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .dc-emb-title{font-size:22px;font-weight:700;color:#fff;display:flex;align-items:center;gap:10px}
    .dc-emb-title small{font-size:12px;font-weight:600;color:#4ade80;background:rgba(35,165,90,.14);border:1px solid rgba(35,165,90,.35);padding:3px 9px;border-radius:99px}
    .dc-lang-btn{height:30px;padding:0 11px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.72);color:#a1a1aa;font:700 11.5px/1 "gg sans",Segoe UI,sans-serif;letter-spacing:.05em;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:all .15s}
    .dc-lang-btn:hover{border-color:rgba(255,255,255,.28);color:#fff}
    .dc-lang-btn b{color:#fff}
    .dc-vc-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .dc-vc-search{flex:1;min-width:170px;height:36px;background:rgba(0,0,0,.72);border:1px solid rgba(255,255,255,.1);color:#f4f4f5;border-radius:9px;padding:0 12px;font-size:13.5px;font-family:inherit;outline:none;transition:border-color .15s}
    .dc-vc-search:focus{border-color:rgba(255,255,255,.32)}
    .dc-vc-pills{display:flex;gap:6px;flex-wrap:wrap}
    .dc-pill{height:32px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.09);background:rgba(0,0,0,.68);color:#a1a1aa;font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .15s}
    .dc-pill:hover{background:rgba(255,255,255,.09);color:#fff}
    .dc-pill.active{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.28);color:#fff}
    .dc-vc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:4px}
    .dc-vc-card{display:flex;flex-direction:column;justify-content:space-between;gap:10px;padding:16px 18px;border-radius:12px;background:rgba(0,0,0,.74);border:1px solid rgba(255,255,255,.08);transition:background .15s,border-color .15s}
    .dc-vc-card[data-on="1"]{background:rgba(0,0,0,.74);border-color:rgba(255,255,255,.14)}
    .dc-vc-card:hover,.dc-vc-card[data-on="1"]:hover{background:rgba(12,14,18,.9);border-color:rgba(255,255,255,.22)}
    .dc-vc-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .dc-vc-name{font-size:15.5px;font-weight:600;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:8px;min-width:0}
    .dc-cat-tag{font-size:10.5px;font-weight:600;color:#71717a;background:rgba(255,255,255,.05);padding:2px 6px;border-radius:5px;flex-shrink:0}
    .dc-vc-desc{font-size:13px;color:#94a3b8;line-height:1.4}
    .dc-vc-actions{display:flex;align-items:center;gap:7px;flex-shrink:0}
    .dc-gear,.dc-info-btn{width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#a1a1aa;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all .15s;font:700 13px/1 "gg sans",Segoe UI,sans-serif}
    .dc-gear:hover,.dc-info-btn:hover,.dc-info-btn.active{background:rgba(255,255,255,.14);color:#fff}
    .dc-info-box{padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.04);border-left:2px solid #23a55a;font-size:12px;color:#cbd5e1;line-height:1.45;display:flex;flex-direction:column;gap:4px}
    .dc-info-box b{color:#f8fafc}
    .dc-empty{padding:28px;text-align:center;color:#71717a}
    .dc-hero{display:flex;gap:18px;align-items:stretch;padding:16px;border-radius:14px;background:rgba(0,0,0,.74);border:1px solid rgba(255,255,255,.09)}
    .dc-preview{width:220px;height:124px;border-radius:11px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.08);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#71717a;font-size:12px}
    .dc-preview video,.dc-preview img{width:100%;height:100%;object-fit:cover;display:block}
    .dc-hero-info{flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0;gap:10px}
    .dc-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .dc-sec{padding:16px;border-radius:14px;background:rgba(0,0,0,.74);border:1px solid rgba(255,255,255,.09);display:flex;flex-direction:column;gap:14px}
    .dc-sec-title{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8}
    .dc-lbl{font-weight:600;font-size:15px;color:#f1f5f9}
    .dc-sub{color:#94a3b8;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dc-btns{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .dc-btn{height:36px;padding:0 15px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#f1f5f9;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer;transition:all .15s}
    .dc-btn:hover{background:rgba(255,255,255,.13)}
    .dc-btn.primary{background:#5865f2;border-color:transparent;color:#fff}.dc-btn.primary:hover{background:#6875f5}
    .dc-btn.small{height:28px;padding:0 10px;font-size:12px}
    .dc-urlrow{display:flex;gap:8px}
    .dc-in,.dc-sel{height:38px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);color:#e4e4e7;border-radius:9px;padding:0 12px;font-size:13.5px;font-family:inherit;outline:none;min-width:0;color-scheme:dark}
    .dc-in{flex:1}.dc-in:focus,.dc-sel:focus{border-color:#818cf8}
    textarea.dc-code{width:100%;min-height:300px;resize:vertical;padding:12px;font:12.5px/1.55 Consolas,"Cascadia Code",monospace;height:auto;white-space:pre;tab-size:2}
    .dc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 24px}
    .dc-rt{display:flex;justify-content:space-between;margin-bottom:6px;font-size:13.5px;color:#e4e4e7}
    .dc-rt b{color:#a5b4fc;font-weight:600;font-variant-numeric:tabular-nums}
    #dc-settings-embedded input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:6px;border-radius:999px;background:rgba(255,255,255,.14);outline:none;margin:0;cursor:pointer}
    #dc-settings-embedded input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid #818cf8;box-shadow:0 1px 6px rgba(99,102,241,.5);cursor:pointer}
    .dc-sw{position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0}
    .dc-sw input{opacity:0;width:0;height:0}
    .dc-sw span{position:absolute;inset:0;cursor:pointer;border-radius:999px;background:rgba(255,255,255,.16);transition:.18s ease}
    .dc-sw span:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#d4d4d8;transition:.18s ease}
    .dc-sw input:checked+span{background:#23a55a}.dc-sw input:checked+span:before{transform:translateX(18px);background:#fff}
    @media (max-width:900px){.dc-grid{grid-template-columns:1fr}.dc-hero{flex-direction:column}.dc-preview{width:100%}}
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
    updateWallpaper();
    syncPlugins();
  }

  function iconEl(name, size = 18) {
    const s = document.createElement('span');
    s.style.cssText = 'display:inline-flex;align-items:center;justify-content:center';
    setHTML(s, svgStr(name, size));
    return s;
  }

  // ============================================================
  //  Intégration dans les Paramètres Discord
  // ============================================================
  let embeddedTab = null; // 'plugins' | 'credits'
  let subPage = null; // null | id d'un plugin
  let filter = 'all';
  let query = '';
  let page = 1;
  let pendingOpen = false;

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
    const fallbackScope =
      scope ||
      document.querySelector('[role="dialog"]') ||
      document.querySelector('[class*="layer_"] nav')?.closest('[class*="layer_"]');
    if (!fallbackScope) return null;

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
      for (const el of fallbackScope.querySelectorAll('div, button, li, span')) {
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
      n.classList.toggle('active', n.dataset.dcNav === embeddedTab);
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
    document.querySelector('button[aria-label*="Paramètres" i], button[aria-label*="User Settings" i]')?.click();
  }

  function ensureLauncher() {
    if (!config || !document.body) return;

    if (!document.getElementById('dc-userpanel-btn')) {
      const gear = document.querySelector('button[aria-label*="Paramètres" i], button[aria-label*="User Settings" i]');
      const group = gear?.parentElement || document.querySelector('[class*="panels_"] [class*="buttons_"]');
      if (group) {
        const btn = document.createElement('button');
        btn.id = 'dc-userpanel-btn';
        btn.className = 'dc-up-btn';
        btn.title = 'DreamCord';
        btn.appendChild(iconEl('sparkle', 18));
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
        mountEmbedded(t);
      }
      return;
    }

    const parts = findSettingsParts();
    if (!parts) {
      embeddedTab = null;
      return;
    }
    const { sidebarList } = parts;
    const sec = document.createElement('div');
    sec.id = 'dc-settings-section';
    const hdr = document.createElement('div');
    hdr.className = 'dc-nav-hdr';
    hdr.textContent = 'DreamCord';
    sec.appendChild(hdr);
    for (const t of [
      { id: 'plugins', label: 'Plugins', icon: 'layers' },
      { id: 'credits', label: 'À propos', icon: 'info' }
    ]) {
      const item = document.createElement('div');
      item.className = 'dc-nav-item';
      item.dataset.dcNav = t.id;
      item.setAttribute('role', 'tab');
      item.appendChild(iconEl(t.icon, 18));
      const lbl = document.createElement('span');
      lbl.textContent = t.label;
      item.appendChild(lbl);
      item.onclick = (e) => {
        e.stopPropagation();
        mountEmbedded(t.id);
      };
      sec.appendChild(item);
    }
    const billing = Array.from(sidebarList.children).find((c) => /Facturation|Billing/.test(c.textContent || ''));
    if (billing) sidebarList.insertBefore(sec, billing);
    else sidebarList.appendChild(sec);

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
      mountEmbedded(t);
    }
  }

  // ============================================================
  //  Pages du panneau (HTML en une passe, événements délégués)
  // ============================================================
  const sw = (checked, attrs) =>
    `<label class="dc-sw"><input type="checkbox" ${attrs}${checked ? ' checked' : ''}><span></span></label>`;

  const range = (scope, id, k, label, min, max, step, unit, value) =>
    `<div><div class="dc-rt"><span>${esc(label)}</span><b>${esc(value)}${esc(unit)}</b></div>` +
    `<input type="range" data-scope="${scope}" data-id="${esc(id)}" data-k="${esc(k)}" data-unit="${esc(unit)}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;

  const CATS = () => [
    ['all', L('Tous', 'All')],
    ['on', L('Actifs', 'Active')],
    ['ui', L('Interface', 'UI')],
    ['chat', 'Chat'],
    ['privacy', L('Discret', 'Privacy')],
    ['tools', L('Outils', 'Tools')]
  ];
  const CAT_TAG = (cat) =>
    ({ ui: L('Interface', 'UI'), chat: 'Chat', privacy: L('Discret', 'Privacy'), tools: L('Outils', 'Tools') }[cat] || cat);

  const openInfo = new Set();
  const isOn = (p) => (p.isWallpaper ? Boolean(config.wallpaper.enabled) : Boolean(config.plugins[p.id]));
  const hasSettings = (p) => Boolean(p.hasPage || p.sliders);
  const pName = (p) => (isEn() && PLUGIN_I18N[p.id]?.enName) || p.name;
  const pDesc = (p) => (isEn() && PLUGIN_I18N[p.id]?.enDesc) || p.desc;

  const cardHtml = (p) => {
    const t = PLUGIN_I18N[p.id];
    const infoPair = isEn() ? t?.enInfo : t?.frInfo;
    const showInfo = openInfo.has(p.id) && infoPair;
    return (
      `<div class="dc-vc-card" data-on="${isOn(p) ? 1 : 0}" data-card="${esc(p.id)}">` +
      `<div class="dc-vc-top"><div class="dc-vc-name"><span>${esc(pName(p))}</span><span class="dc-cat-tag">${esc(CAT_TAG(p.cat))}</span></div>` +
      `<div class="dc-vc-actions">` +
      (infoPair ? `<button class="dc-info-btn${showInfo ? ' active' : ''}" data-act="info" data-id="${esc(p.id)}" title="${esc(L('Détails', 'Details'))}">i</button>` : '') +
      (hasSettings(p) ? `<button class="dc-gear" data-act="gear" data-id="${esc(p.id)}" title="${esc(L('Réglages', 'Settings'))}">${svgStr('gear', 15)}</button>` : '') +
      sw(isOn(p), `data-act="toggle" data-id="${esc(p.id)}"`) +
      `</div></div>` +
      `<div class="dc-vc-desc">${esc(pDesc(p))}</div>` +
      (showInfo
        ? `<div class="dc-info-box"><div><b>${esc(L('Rôle', 'Role'))} :</b> ${esc(infoPair[0])}</div><div><b>${esc(L('Où', 'Where'))} :</b> ${esc(infoPair[1])}</div></div>`
        : '') +
      `</div>`
    );
  };

  function cardsHtml() {
    const q = query.trim().toLowerCase();
    const list = PLUGINS.filter((p) => {
      if (filter === 'on' && !isOn(p)) return false;
      if (filter !== 'all' && filter !== 'on' && p.cat !== filter) return false;
      return !q || (pName(p) + ' ' + pDesc(p) + ' ' + p.name).toLowerCase().includes(q);
    }).sort((a, b) => pName(a).localeCompare(pName(b), isEn() ? 'en' : 'fr'));
    if (!list.length) return `<div class="dc-empty">${esc(L('Aucun plugin', 'No plugins'))}</div>`;
    return `<div class="dc-vc-grid">${list.map(cardHtml).join('')}</div>`;
  }

  function pluginsPage() {
    const onCount = PLUGINS.filter(isOn).length;
    const langBtn = `<button class="dc-lang-btn" data-act="lang" title="FR / EN">${isEn() ? 'FR / <b>EN</b>' : '<b>FR</b> / EN'}</button>`;
    return (
      `<div class="dc-emb-head"><div class="dc-emb-title">Plugins <small>${onCount} / ${PLUGINS.length} ${esc(L('actifs', 'active'))}</small></div>${langBtn}</div>` +
      `<div class="dc-body"><div class="dc-vc-bar"><input class="dc-vc-search" data-act="search" placeholder="${esc(L('Rechercher…', 'Search...'))}" value="${esc(query)}">` +
      `<div class="dc-vc-pills">${CATS().map(([id, l]) => `<button class="dc-pill${filter === id ? ' active' : ''}" data-act="pill" data-v="${id}">${l}</button>`).join('')}</div></div>` +
      `<div id="dc-grid">${cardsHtml()}</div></div>`
    );
  }

  const backHead = (title) =>
    `<div class="dc-emb-head"><div class="dc-emb-title">${esc(title)}</div><button class="dc-btn" data-act="back">‹ ${esc(L('Retour', 'Back'))}</button></div>`;

  function wallpaperPage() {
    const wp = config.wallpaper;
    const src = currentSource();
    const preview = !src
      ? 'Aucun fond'
      : currentKind() === 'video'
        ? `<video src="${esc(src)}#t=0.4" preload="metadata" muted></video>`
        : `<img src="${esc(src)}" alt="">`;
    const name = wp.source === 'url' ? wp.url : wp.fileName;
    const r = (k, label, min, max, step, unit) => range('wp', 'wp', k, label, min, max, step, unit, wp[k]);
    return (
      backHead('Fond animé') +
      `<div class="dc-body">` +
      `<div class="dc-hero"><div class="dc-preview">${preview}</div><div class="dc-hero-info">` +
      `<div><div class="dc-lbl">${esc(name || 'Choisis une image, un GIF ou une vidéo')}</div><div class="dc-sub">MP4 / WebM conseillé, 1080p</div></div>` +
      `<div class="dc-btns"><button class="dc-btn primary" data-act="pick">Choisir un fichier…</button>` +
      (src ? `<button class="dc-btn" data-act="clearwp">Retirer</button>` : '') +
      `</div></div></div>` +
      `<div class="dc-sec"><div class="dc-sec-title">Lien direct</div><div class="dc-urlrow"><input class="dc-in" id="dc-url" placeholder="https://…" value="${esc(wp.source === 'url' ? wp.url : '')}"><button class="dc-btn" data-act="applyurl">Utiliser</button></div></div>` +
      `<div class="dc-sec"><div class="dc-sec-title">Image</div><div class="dc-grid">` +
      r('brightness', 'Luminosité', 10, 200, 1, ' %') + r('opacity', 'Opacité du fond', 0, 100, 1, ' %') +
      r('uiOpacity', 'Voile sur l’interface', 0, 100, 1, ' %') + r('blur', 'Flou', 0, 30, 1, ' px') +
      r('contrast', 'Contraste', 50, 150, 1, ' %') + r('saturation', 'Saturation', 0, 200, 1, ' %') +
      r('speed', 'Vitesse vidéo', 0.25, 2, 0.05, ' ×') +
      `<div><div class="dc-rt"><span>Ajustement</span></div><select class="dc-sel" style="width:100%" data-act="fit">` +
      [['cover', 'Remplir'], ['contain', 'Ajuster'], ['fill', 'Étirer']].map(([v, l]) => `<option value="${v}"${wp.fit === v ? ' selected' : ''}>${l}</option>`).join('') +
      `</select></div></div></div>` +
      `<div class="dc-sec"><div class="dc-sec-title">Paramètres Discord transparents</div>` +
      `<div class="dc-row"><div><div class="dc-lbl">Fenêtre Paramètres en verre</div><div class="dc-sub">Transparente, avec le flou et le voile ci-dessous</div></div>${sw(wp.settingsGlass !== false, 'data-act="wpbool" data-k="settingsGlass"')}</div>` +
      `<div class="dc-grid">${r('settingsDim', 'Voile sombre (0 = transparent)', 0, 90, 1, ' %')}${r('settingsBlur', 'Flou', 0, 30, 1, ' px')}</div></div>` +
      `<div class="dc-sec"><div class="dc-sec-title">Économie de ressources</div>` +
      [['pauseMinimized', 'Pause quand la fenêtre est réduite'], ['pauseUnfocused', 'Pause quand Discord n’a pas le focus'], ['pauseBattery', 'Pause sur batterie']]
        .map(([k, l]) => `<div class="dc-row"><div class="dc-lbl" style="font-size:14px">${l}</div>${sw(Boolean(wp[k]), `data-act="wpbool" data-k="${k}"`)}</div>`)
        .join('') +
      `</div></div>`
    );
  }

  function cssPage() {
    return (
      backHead('CSS perso') +
      `<div class="dc-body"><div class="dc-sec"><div class="dc-row"><div><div class="dc-lbl">Éditeur</div><div class="dc-sub">Appliqué en direct · les fichiers .css du dossier thèmes sont chargés aussi</div></div>` +
      `<button class="dc-btn small" data-act="folder">Ouvrir le dossier thèmes</button></div>` +
      `<textarea class="dc-in dc-code" data-act="css" spellcheck="false" placeholder="/* ton CSS */">${esc(config.customCss || '')}</textarea></div></div>`
    );
  }

  function pluginPage(p) {
    return (
      backHead(p.name) +
      `<div class="dc-body"><div class="dc-sec"><div class="dc-sub" style="white-space:normal">${esc(p.desc)}</div><div class="dc-grid">` +
      (p.sliders || []).map((s) => range('pl', p.id, s.key, s.label, s.min, s.max, s.step, s.unit || '', pluginSetting(p.id, s.key, s.def))).join('') +
      `</div></div></div>`
    );
  }

  function aboutPage() {
    const n = PLUGINS.filter(isOn).length;
    return (
      `<div class="dc-emb-head"><div class="dc-emb-title">DreamCord <small>léger · rapide · transparent</small></div></div>` +
      `<div class="dc-body"><div class="dc-sec"><div class="dc-row"><div><div class="dc-lbl">${n} plugins actifs sur ${PLUGINS.length}</div>` +
      `<div class="dc-sub">F9 ou Ctrl + Alt + D pour ouvrir ce panneau</div></div></div>` +
      `<div class="dc-btns"><button class="dc-btn" data-act="devtools">Outils développeur</button><button class="dc-btn" data-act="folder">Dossier DreamCord</button>` +
      `<button class="dc-btn" data-act="reset">Tout réinitialiser</button></div></div></div>`
    );
  }

  function customFriendPage() {
    const users = getCfUsers();
    const entries = Object.entries(users);
    const list = !entries.length
      ? '<div class="dc-empty">Aucun ami personnalisé. Fais clic droit sur un ami ou un profil puis « Custom Friend ».</div>'
      : entries
          .map(
            ([uid, u]) =>
              `<div class="dc-row" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)">` +
              `<div style="display:flex;align-items:center;gap:12px;min-width:0">` +
              `<img src="${esc(u.avatar || '')}" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.08);flex-shrink:0">` +
              `<div style="min-width:0"><div class="dc-lbl" style="font-size:14px">${esc(u.name || u.origName || uid)}</div>` +
              `<div class="dc-sub">${esc(u.origName ? `${u.origName} · ${uid}` : uid)}</div></div></div>` +
              `<div class="dc-btns"><button class="dc-btn small" data-act="cf-edit" data-id="${esc(uid)}">Modifier</button>` +
              `<button class="dc-btn small" data-act="cf-del" data-id="${esc(uid)}">Supprimer</button></div></div>`
          )
          .join('');
    return (
      backHead('Custom Friend') +
      `<div class="dc-body"><div class="dc-sec"><div class="dc-sec-title">Amis personnalisés (${entries.length})</div>${list}</div></div>`
    );
  }

  function render(box) {
    const top = box.scrollTop;
    let html;
    if (embeddedTab === 'credits') html = aboutPage();
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
    if (!url) return showToast('Fichier illisible', 'error');
    wallpaperSrc = url;
    Object.assign(config.wallpaper, { source: 'file', filePath: res.filePath, fileName: res.fileName || '', enabled: true });
    applyAll();
    saveSoon();
    rerender();
  }

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    switch (t.dataset.act) {
      case 'pill':
        filter = t.dataset.v;
        page = 1;
        return rerender();
      case 'lang':
        config.lang = isEn() ? 'fr' : 'en';
        saveSoon();
        return rerender();
      case 'info':
        if (openInfo.has(t.dataset.id)) openInfo.delete(t.dataset.id);
        else openInfo.add(t.dataset.id);
        return rerender();
      case 'page':
        page = Number(t.dataset.v) || 1;
        return rerender();
      case 'gear':
        subPage = t.dataset.id;
        return rerender();
      case 'back':
        subPage = null;
        return rerender();
      case 'pick':
        return void pickFlow();
      case 'applyurl': {
        const v = (document.getElementById('dc-url')?.value || '').trim();
        if (!/^https?:\/\//i.test(v)) return showToast('Lien invalide', 'error');
        Object.assign(config.wallpaper, { source: 'url', url: v, enabled: true });
        applyAll();
        saveSoon();
        return rerender();
      }
      case 'clearwp':
        Object.assign(config.wallpaper, { enabled: false, filePath: '', fileName: '', url: '' });
        wallpaperSrc = '';
        applyAll();
        saveSoon();
        return rerender();
      case 'folder':
        return ipc('open-folder', subPage === 'custom-css' ? 'themes' : '');
      case 'cf-edit': {
        const u = getCfUsers()[t.dataset.id];
        if (u) openCustomFriendModal({ userId: t.dataset.id, origName: u.origName || '', origAvatar: u.avatar || '' });
        return;
      }
      case 'cf-del':
        delete getCfUsers()[t.dataset.id];
        restoreCustomFriend(t.dataset.id);
        saveSoon();
        showToast('Ami supprimé', 'ok');
        return rerender();
      case 'devtools':
        return ipc('toggle-devtools');
      case 'reset':
        ipc('reset-config');
        config = JSON.parse(JSON.stringify(boot.defaults || {}));
        normalizeConfig();
        wallpaperSrc = '';
        applyAll();
        persistLocal();
        showToast('Réglages réinitialisés', 'ok');
        return rerender();
    }
  }

  function onChange(e) {
    const t = e.target;
    const act = t.dataset?.act;
    if (act === 'toggle') {
      const id = t.dataset.id;
      if (id === 'lively-wallpaper') config.wallpaper.enabled = t.checked;
      else config.plugins[id] = t.checked;
      applyAll();
      saveSoon();
      const card = t.closest('.dc-vc-card');
      if (card) card.dataset.on = t.checked ? '1' : '0';
      const small = document.querySelector('.dc-emb-title small');
      if (small) small.textContent = `${PLUGINS.filter(isOn).length} / ${PLUGINS.length} ${L('actifs', 'active')}`;
    } else if (act === 'wpbool') {
      config.wallpaper[t.dataset.k] = t.checked;
      applyAll();
      updatePlayState();
      saveSoon();
    } else if (act === 'fit') {
      config.wallpaper.fit = t.value;
      applyWallpaperStyle();
      saveSoon();
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

  function onInput(e) {
    const t = e.target;
    if (t.type === 'range') {
      const v = Number(t.value);
      const { scope, id, k, unit } = t.dataset;
      const label = t.previousElementSibling?.querySelector('b');
      if (label) label.textContent = v + (unit || '');
      if (scope === 'wp') {
        config.wallpaper[k] = v;
        scheduleWpUpdate();
      } else {
        (config.pluginSettings[id] ||= {})[k] = v;
        restartSoon(id);
      }
      saveSoon();
    } else if (t.dataset?.act === 'search') {
      query = t.value;
      page = 1;
      const grid = document.getElementById('dc-grid');
      if (grid) setHTML(grid, cardsHtml());
    } else if (t.dataset?.act === 'css') {
      config.customCss = t.value;
      restartSoon('custom-css');
      saveSoon();
    }
  }

  function bindBox(box) {
    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    box.addEventListener('input', onInput);
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
