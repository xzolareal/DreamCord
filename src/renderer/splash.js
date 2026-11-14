// Écran de chargement DreamCord.
// - Ultra léger : un seul élément, animations transform/opacity uniquement (GPU).
// - Utilisable depuis le preload (require) ET injecté dans la page (auto-démarrage).
// - Se ferme tout seul quand Discord et le cœur DreamCord sont prêts (ou après 7 s max).
(function () {
  'use strict';

  const ID = 'dc-splash';
  const MIN_MS = 650; // durée minimale : évite un flash trop bref
  const MAX_MS = 7000; // sécurité : ne bloque jamais Discord

  function enabled() {
    try {
      return localStorage.getItem('dreamcord:splash') !== '0';
    } catch {
      return true;
    }
  }

  const CSS =
    '#dc-splash{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;overflow:hidden;' +
    'background:#07070c;color:#fff;font-family:"gg sans","Segoe UI",system-ui,sans-serif;transition:opacity .45s cubic-bezier(.4,0,.2,1),transform .45s cubic-bezier(.4,0,.2,1);will-change:opacity}' +
    '#dc-splash.out{opacity:0;transform:scale(1.035);pointer-events:none}' +
    // aurore : trois halos flous qui dérivent lentement
    '#dc-splash .a{position:absolute;width:62vmax;height:62vmax;border-radius:50%;filter:blur(70px);opacity:.5;will-change:transform}' +
    '#dc-splash .a1{background:radial-gradient(circle,#5865f2 0%,transparent 65%);left:-18vmax;top:-22vmax;animation:dcA1 9s ease-in-out infinite alternate}' +
    '#dc-splash .a2{background:radial-gradient(circle,#a855f7 0%,transparent 65%);right:-22vmax;bottom:-26vmax;animation:dcA2 11s ease-in-out infinite alternate}' +
    '#dc-splash .a3{background:radial-gradient(circle,#22d3ee 0%,transparent 65%);left:30vw;top:38vh;width:40vmax;height:40vmax;opacity:.22;animation:dcA1 13s ease-in-out infinite alternate-reverse}' +
    '#dc-splash .g{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 35%,rgba(0,0,0,.65) 100%)}' +
    '#dc-splash .c{position:relative;display:flex;flex-direction:column;align-items:center;gap:22px;animation:dcRise .7s cubic-bezier(.16,1,.3,1) both}' +
    '#dc-splash .m{position:relative;width:84px;height:84px;display:grid;place-items:center}' +
    '#dc-splash .m::before{content:"";position:absolute;inset:-16px;border-radius:50%;background:radial-gradient(circle,rgba(129,140,248,.55),transparent 68%);animation:dcPulse 2.4s ease-in-out infinite;will-change:transform,opacity}' +
    '#dc-splash .m svg{position:relative;width:60px;height:60px;filter:drop-shadow(0 0 14px rgba(129,140,248,.8));animation:dcSpin 7s linear infinite;will-change:transform}' +
    '#dc-splash .t{font-size:27px;font-weight:800;letter-spacing:.34em;text-indent:.34em;background:linear-gradient(90deg,#fff,#c7d2fe 45%,#fff);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '#dc-splash .b{position:relative;width:176px;height:3px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}' +
    '#dc-splash .f{position:absolute;inset:0;width:100%;border-radius:99px;background:linear-gradient(90deg,#5865f2,#c4b5fd,#22d3ee);transform:scaleX(.04);transform-origin:left;will-change:transform}' +
    '#dc-splash .f::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent);transform:translateX(-100%);animation:dcShine 1.3s ease-in-out infinite}' +
    '@keyframes dcA1{to{transform:translate3d(9vmax,7vmax,0) scale(1.15)}}' +
    '@keyframes dcA2{to{transform:translate3d(-8vmax,-9vmax,0) scale(1.1)}}' +
    '@keyframes dcRise{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:none}}' +
    '@keyframes dcPulse{0%,100%{transform:scale(.88);opacity:.55}50%{transform:scale(1.12);opacity:1}}' +
    '@keyframes dcSpin{to{transform:rotate(360deg)}}' +
    '@keyframes dcShine{to{transform:translateX(100%)}}' +
    '@media (prefers-reduced-motion:reduce){#dc-splash *{animation:none!important}}';

  const SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#e0e7ff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M12 2l2.4 7.1L22 12l-7.6 2.9L12 22l-2.4-7.1L2 12l7.6-2.9z" fill="rgba(129,140,248,.28)"/></svg>';

  function discordReady() {
    return Boolean(
      document.querySelector(
        '[data-list-item-id^="guildsnav___"],[class*="privateChannels_"],[class*="chat_"],[class*="sidebar_"],input[name="email"],[class*="authBox"]'
      )
    );
  }

  function mount() {
    if (document.getElementById(ID)) return;
    const host = document.body || document.documentElement;
    const style = document.createElement('style');
    style.id = ID + '-css';
    style.textContent = CSS;
    const el = document.createElement('div');
    el.id = ID;
    el.innerHTML =
      '<i class="a a1"></i><i class="a a2"></i><i class="a a3"></i><i class="g"></i>' +
      '<div class="c"><div class="m">' + SVG + '</div><div class="t">DREAMCORD</div><div class="b"><i class="f"></i></div></div>';
    (document.head || document.documentElement).appendChild(style);
    host.appendChild(el);

    const bar = el.querySelector('.f');
    const t0 = Date.now();
    let progress = 0.04;
    let closing = false;

    const close = () => {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      bar.style.transition = 'transform .2s ease-out';
      bar.style.transform = 'scaleX(1)';
      setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => {
          el.remove();
          style.remove();
        }, 520);
      }, 180);
    };

    const timer = setInterval(() => {
      const dt = Date.now() - t0;
      // progression « asymptotique » : rapide au début, ralentit sans jamais atteindre 100 %
      progress += (0.9 - progress) * 0.06;
      bar.style.transform = 'scaleX(' + progress.toFixed(3) + ')';
      const coreReady = document.documentElement.getAttribute('data-dc-stage') === 'ready';
      if (dt >= MAX_MS || (dt >= MIN_MS && coreReady && discordReady()) || (dt >= 2600 && discordReady())) close();
    }, 90);
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
    window.__DC_SPLASH__ = true;
    const go = () => {
      if (document.documentElement) mount();
    };
    if (document.documentElement) go();
    else {
      // preload : le document n'existe pas encore
      const iv = setInterval(() => {
        if (document.documentElement) {
          clearInterval(iv);
          go();
        }
      }, 5);
    }
    if (document.body === null) document.addEventListener('DOMContentLoaded', go, { once: true });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { start };
  // Injecté dans la page (charge utile DreamCord) : démarrage immédiat.
  if (window.__DREAMCORD_BOOT__ || typeof module === 'undefined') start();
})();
