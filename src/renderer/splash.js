// Écran de chargement DreamCord.
// - Ultra léger : DOM/SVG pur (sans innerHTML, compatible Trusted Types), animations GPU transform/opacity uniquement.
// - Esthétique monochrome Noir & Blanc (#09090b / #ffffff), zéro néon.
// - Utilisable depuis le preload (require) ET injecté dans la page (auto-démarrage), dédupliqué entre mondes isolés.
// - Se ferme instantanément dès que Discord et DreamCord sont prêts, sans jamais bloquer les clics.
(function () {
  'use strict';

  const ID = 'dc-splash';
  const STYLE_ID = ID + '-css';
  const ATTR = 'data-dc-splash';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN_MS = 220; // évite un flash 1 frame tout en restant quasi instantané
  const FALLBACK_MS = 1800; // ferme dès que Discord est prêt même sans signal core
  const MAX_MS = 4500; // sécurité absolue : ne bloque jamais Discord

  const LOGO_PATH_OUTER =
    'M5 3h6.5a9 9 0 0 1 0 18H5a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 5 3Zm2 3.5v11h4.5a5.5 5.5 0 0 0 0-11H7Z';
  const LOGO_PATH_MARK =
    'M11.6 9.1l.85 2.05 2.05.85-2.05.85-.85 2.05-.85-2.05L8.7 12l2.05-.85.85-2.05Z';

  function enabled() {
    try {
      return localStorage.getItem('dreamcord:splash') !== '0';
    } catch {
      return true;
    }
  }

  const CSS =
    '#dc-splash{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;overflow:hidden;' +
    'background:#09090b;color:#ffffff;font-family:"gg sans","Segoe UI",system-ui,sans-serif;transition:opacity .2s ease-out;will-change:opacity;contain:strict}' +
    '#dc-splash.out{opacity:0;pointer-events:none}' +
    '#dc-splash .c{display:flex;flex-direction:column;align-items:center;gap:14px}' +
    '#dc-splash .mark{width:52px;height:52px;border-radius:14px;background:#0f0f12;border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;color:#ffffff}' +
    '#dc-splash .mark svg{width:28px;height:28px;display:block}' +
    '#dc-splash .t{font-size:15px;font-weight:700;letter-spacing:.04em;color:#ffffff}' +
    '#dc-splash .row{display:flex;align-items:center;gap:8px;margin-top:-6px}' +
    '#dc-splash .spin{width:12px;height:12px;border-radius:50%;border:1.5px solid rgba(255,255,255,.16);border-top-color:#ffffff;animation:dcRot .7s linear infinite;will-change:transform;flex:none}' +
    '#dc-splash .s{font-size:12px;color:#a1a1aa}' +
    '#dc-splash .b{position:relative;width:168px;height:2px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:2px}' +
    '#dc-splash .f{position:absolute;inset:0;width:100%;border-radius:99px;background:#ffffff;transform:scaleX(.08);transform-origin:left;will-change:transform}' +
    '@keyframes dcRot{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){#dc-splash .spin{animation:none!important}}';

  const READY_SELECTOR =
    '[data-list-item-id^="guildsnav___"],[class*="privateChannels_"],[class*="chat_"],[class*="sidebar_"],input[name="email"],[class*="authBox"]';

  function discordReady() {
    const appMount = document.getElementById('app-mount');
    if (appMount && appMount.childElementCount === 0) return false;
    return Boolean((appMount || document).querySelector(READY_SELECTOR));
  }

  function makeEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function makeLogoSvg() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const p1 = document.createElementNS(SVG_NS, 'path');
    p1.setAttribute('fill-rule', 'evenodd');
    p1.setAttribute('d', LOGO_PATH_OUTER);
    const p2 = document.createElementNS(SVG_NS, 'path');
    p2.setAttribute('d', LOGO_PATH_MARK);
    svg.append(p1, p2);
    return svg;
  }

  function mount() {
    const root = document.documentElement;
    if (!root) return;
    const state = root.getAttribute(ATTR);
    if (state === '1' || state === 'done' || document.getElementById(ID)) return;
    root.setAttribute(ATTR, '1');

    const prevStyle = document.getElementById(STYLE_ID);
    if (prevStyle) prevStyle.remove();

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;

    const el = makeEl('div');
    el.id = ID;
    const box = makeEl('div', 'c');
    const mark = makeEl('div', 'mark');
    mark.appendChild(makeLogoSvg());
    const title = makeEl('div', 't', 'DreamCord');
    const row = makeEl('div', 'row');
    const spin = makeEl('div', 'spin');
    const isEn = window.__DREAMCORD_BOOT__?.config?.lang === 'en';
    const sub = makeEl('div', 's', isEn ? 'Starting Discord…' : 'Démarrage de Discord…');
    row.append(spin, sub);
    const track = makeEl('div', 'b');
    const bar = makeEl('i', 'f');
    track.appendChild(bar);
    box.append(mark, title, row, track);
    el.appendChild(box);

    (document.head || root).appendChild(style);
    // Monté sur <html> afin que l'hydratation React de <body>/#app-mount ne le perturbe jamais
    root.appendChild(el);

    const t0 = Date.now();
    let progress = 0.08;
    let closing = false;
    let cleaned = false;

    const onTransitionEnd = (e) => {
      if (e.target === el) cleanup();
    };

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(timer);
      clearTimeout(hardTimeout);
      el.removeEventListener('transitionend', onTransitionEnd);
      root.setAttribute(ATTR, 'done');
      if (el.isConnected) el.remove();
      if (style.isConnected) style.remove();
    };

    const close = () => {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      // Libère immédiatement les clics dès que Discord est prêt
      el.style.pointerEvents = 'none';
      bar.style.transition = 'transform .14s ease-out';
      bar.style.transform = 'scaleX(1)';
      setTimeout(() => {
        if (cleaned) return;
        el.addEventListener('transitionend', onTransitionEnd);
        el.classList.add('out');
        setTimeout(cleanup, 260);
      }, 70);
    };

    const timer = setInterval(() => {
      if (!el.isConnected) return cleanup();
      const dt = Date.now() - t0;
      progress += (0.92 - progress) * 0.1;
      bar.style.transform = 'scaleX(' + progress.toFixed(3) + ')';

      if (dt >= MAX_MS) return close();
      if (dt < MIN_MS) return;

      const coreReady = root.getAttribute('data-dc-stage') === 'ready';
      if ((coreReady || dt >= FALLBACK_MS) && discordReady()) close();
    }, 80);

    // Filet de sécurité absolu : garantit la disparition complète du splash
    const hardTimeout = setTimeout(cleanup, MAX_MS + 800);
  }

  function isMainApp() {
    try {
      if (window.top !== window || window.opener) return false;
      if (!/(^|\.)discord(app)?\.com$/i.test(location.hostname)) return false;
      if (/^\/(overlay|popout|oauth2|billing|login\/handoff)/i.test(location.pathname || '/')) return false;
      return true;
    } catch {
      return false;
    }
  }

  function start() {
    if (window.__DC_SPLASH__ || !enabled() || !isMainApp()) return;
    const rootState = document.documentElement?.getAttribute(ATTR);
    if (rootState === '1' || rootState === 'done') return;
    window.__DC_SPLASH__ = true;

    const go = () => {
      if (document.documentElement) mount();
    };
    if (document.documentElement) {
      go();
    } else {
      // preload : le document n'existe pas encore (plafonné à 3 s pour éviter toute fuite)
      const waitStart = Date.now();
      const iv = setInterval(() => {
        if (document.documentElement) {
          clearInterval(iv);
          go();
        } else if (Date.now() - waitStart > 3000) {
          clearInterval(iv);
        }
      }, 5);
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { start };
  // Injecté dans la page (charge utile DreamCord) : démarrage immédiat si pas déjà monté/terminé par le preload.
  if (window.__DREAMCORD_BOOT__ || typeof module === 'undefined') start();
})();
