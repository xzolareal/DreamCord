// Petit serveur HTTP local (127.0.0.1 uniquement) qui sert UN SEUL fichier :
// l'image ou la vidéo choisie comme fond d'écran.
// Pourquoi ? Discord est chargé depuis https://discord.com : Chromium refuse
// d'y charger directement un fichier du disque (file://). Via http://127.0.0.1
// ça fonctionne, avec lecture/avance rapide pour les vidéos (requêtes Range).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
};

const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'];
const IMAGE_EXT = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'];

// Jeton aléatoire par lancement : sans lui, impossible d'accéder au fichier.
const TOKEN = crypto.randomBytes(16).toString('hex');

let server = null;
let port = 0;
let starting = null;
let current = null; // { filePath, mime }
let generation = 0;
// Seuls les fichiers choisis par l'utilisateur (ou enregistrés dans sa config) peuvent être servis.
const allowed = new Set();
const allow = (filePath) => {
  if (typeof filePath === 'string' && filePath) allowed.add(path.resolve(filePath));
};

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  let start;
  let end;
  if (m[1] === '' && m[2] === '') return null;
  if (m[1] === '') {
    // suffixe : "-500" = les 500 derniers octets
    const n = parseInt(m[2], 10);
    if (!n) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (!(start >= 0) || !(end >= start) || start >= size) return null;
  return { start, end };
}

function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true'
    });
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }

  let parts = [];
  try {
    parts = new URL(req.url, 'http://127.0.0.1').pathname.split('/').filter(Boolean);
  } catch {}

  if (!current || parts[0] !== TOKEN) {
    res.writeHead(404);
    return res.end();
  }

  let stat;
  try {
    stat = fs.statSync(current.filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404);
    return res.end();
  }

  const size = stat.size;
  const headers = {
    'Content-Type': current.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Private-Network': 'true',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff'
  };

  let start = 0;
  let end = size - 1;
  let status = 200;

  if (req.headers.range) {
    const r = parseRange(req.headers.range, size);
    if (!r) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    start = r.start;
    end = r.end;
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }

  headers['Content-Length'] = size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);

  if (req.method === 'HEAD' || size === 0) return res.end();

  const stream = fs.createReadStream(current.filePath, { start, end, highWaterMark: 1 << 20 });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function ensureServer() {
  if (server && port) return Promise.resolve();
  if (starting) return starting;
  const p = new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      server = s;
      port = s.address().port;
      s.unref(); // ne bloque jamais la fermeture de l'application
      resolve();
    });
  });
  starting = p;
  p.then(
    () => {
      starting = null;
    },
    () => {
      starting = null;
    }
  );
  return p;
}

// Prépare le fichier et renvoie l'URL locale à donner au <video> / <img>.
async function serveFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime || !allowed.has(path.resolve(filePath))) return null;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  await ensureServer();
  current = { filePath, mime };
  generation += 1;
  const name = encodeURIComponent(path.basename(filePath));
  return `http://127.0.0.1:${port}/${TOKEN}/${name}?v=${Math.floor(stat.mtimeMs)}&g=${generation}`;
}

// Boîte de dialogue "Choisir un fichier".
async function pickFile(win) {
  const { dialog } = require('electron');
  const options = {
    title: 'Choisir un fond d’écran',
    properties: ['openFile'],
    filters: [
      { name: 'Images et vidéos', extensions: [...IMAGE_EXT, ...VIDEO_EXT] },
      { name: 'Images', extensions: IMAGE_EXT },
      { name: 'Vidéos', extensions: VIDEO_EXT }
    ]
  };
  const result =
    win && typeof win.isDestroyed === 'function' && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  allow(filePath);
  return { filePath, fileName: path.basename(filePath) };
}

module.exports = { serveFile, pickFile, allow, VIDEO_EXT, IMAGE_EXT };
