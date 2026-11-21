const fs = require('fs');
const path = require('path');
const os = require('os');

const DISCORD_BRANCHES = [
  { id: 'stable', name: 'Discord Stable', folder: 'Discord' },
  { id: 'ptb', name: 'Discord PTB', folder: 'DiscordPTB' },
  { id: 'canary', name: 'Discord Canary', folder: 'DiscordCanary' },
  { id: 'dev', name: 'Discord Development', folder: 'DiscordDevelopment' }
];

function getLocalAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

function getPatchScriptPath() {
  return path.resolve(__dirname, 'discord-patch.js');
}

function compareAppDirsDesc(a, b) {
  const pa = a.replace(/^app-/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^app-/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

function findCoreIndexFiles(branchFolder) {
  const localAppData = getLocalAppData();
  const baseDir = path.join(localAppData, branchFolder);
  if (!fs.existsSync(baseDir)) return [];

  const results = [];
  try {
    const appDirs = fs
      .readdirSync(baseDir)
      .filter((d) => d.startsWith('app-'))
      .sort(compareAppDirsDesc);

    for (const appDir of appDirs) {
      const modulesDir = path.join(baseDir, appDir, 'modules');
      if (!fs.existsSync(modulesDir)) continue;

      const coreDirs = fs
        .readdirSync(modulesDir)
        .filter((d) => d.startsWith('discord_desktop_core'));

      for (const coreDir of coreDirs) {
        const candidate1 = path.join(modulesDir, coreDir, 'discord_desktop_core', 'index.js');
        const candidate2 = path.join(modulesDir, coreDir, 'index.js');
        if (fs.existsSync(candidate1)) {
          results.push({ appVersion: appDir.replace('app-', ''), indexPath: candidate1, baseDir });
        } else if (fs.existsSync(candidate2)) {
          results.push({ appVersion: appDir.replace('app-', ''), indexPath: candidate2, baseDir });
        }
      }
    }
  } catch (err) {
    console.error('[DreamCord Injector] Erreur scan:', err);
  }
  return results;
}

function getInstallationsStatus() {
  const statuses = [];
  for (const branch of DISCORD_BRANCHES) {
    const cores = findCoreIndexFiles(branch.folder);
    if (cores.length === 0) {
      statuses.push({
        id: branch.id,
        name: branch.name,
        installed: false,
        injected: false,
        version: null,
        indexPath: null
      });
      continue;
    }
    const latest = cores[0];
    let injected = false;
    try {
      const raw = fs.readFileSync(latest.indexPath, 'utf8');
      injected = raw.includes('DREAMCORD INJECTION START') || raw.includes('discord-patch.js');
    } catch {}
    statuses.push({
      id: branch.id,
      name: branch.name,
      installed: true,
      injected,
      version: latest.appVersion,
      indexPath: latest.indexPath,
      allTargets: cores
    });
  }
  return statuses;
}

function findTargetBranch(statuses, branchId) {
  const exact = statuses.find((s) => s.id === branchId && s.installed);
  if (exact) return exact;
  return branchId === 'stable' ? statuses.find((s) => s.installed) : null;
}

function injectBranch(branchId = 'stable') {
  const statuses = getInstallationsStatus();
  const target = findTargetBranch(statuses, branchId);
  if (!target || !target.installed) {
    return { ok: false, message: 'Aucune installation Discord détectée pour cette branche.' };
  }

  const patchScriptLiteral = JSON.stringify(getPatchScriptPath());
  const payload = [
    '// --- DREAMCORD INJECTION START ---',
    'try {',
    `  require(${patchScriptLiteral});`,
    '} catch (err) {',
    '  console.error("[DreamCord] Erreur démarrage patch:", err);',
    '}',
    '// --- DREAMCORD INJECTION END ---',
    "module.exports = require('./core.asar');",
    ''
  ].join('\n');

  try {
    for (const item of target.allTargets) {
      const backupPath = `${item.indexPath}.dreamcord.bak`;
      let current = '';
      try {
        current = fs.readFileSync(item.indexPath, 'utf8');
      } catch {}
      if (!fs.existsSync(backupPath) && current && !current.includes('DREAMCORD INJECTION START')) {
        fs.writeFileSync(backupPath, current, 'utf8');
      }
      if (current !== payload) fs.writeFileSync(item.indexPath, payload, 'utf8');
    }
    return {
      ok: true,
      message: `DreamCord a été injecté dans ${target.name} (v${target.version}) ! Redémarre complètement Discord (clic droit sur l'icône Discord -> Quitter Discord) pour l'activer.`
    };
  } catch (err) {
    return { ok: false, message: `Erreur d'injection : ${err.message}` };
  }
}

function uninjectBranch(branchId = 'stable') {
  const statuses = getInstallationsStatus();
  const target = findTargetBranch(statuses, branchId);
  if (!target || !target.installed) {
    return { ok: false, message: 'Aucune installation Discord trouvée.' };
  }

  try {
    for (const item of target.allTargets) {
      const backupPath = `${item.indexPath}.dreamcord.bak`;
      let restoreContent = "module.exports = require('./core.asar');\n";
      if (fs.existsSync(backupPath)) {
        try {
          const bak = fs.readFileSync(backupPath, 'utf8');
          if (bak && !bak.includes('DREAMCORD INJECTION START')) {
            restoreContent = bak;
          }
        } catch {}
      }
      fs.writeFileSync(item.indexPath, restoreContent, 'utf8');
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
    return {
      ok: true,
      message: `DreamCord a été retiré de ${target.name}. Redémarre Discord pour revenir à l'état d'origine.`
    };
  } catch (err) {
    return { ok: false, message: `Erreur de désinstallation : ${err.message}` };
  }
}

if (require.main === module) {
  const action = process.argv[2] || 'status';
  const branch = process.argv[3] || 'stable';
  if (action === 'inject') {
    const res = injectBranch(branch);
    console.log(res.message);
    process.exit(res.ok ? 0 : 1);
  } else if (action === 'uninject') {
    const res = uninjectBranch(branch);
    console.log(res.message);
    process.exit(res.ok ? 0 : 1);
  } else {
    console.log(JSON.stringify(getInstallationsStatus(), null, 2));
  }
}

module.exports = {
  getInstallationsStatus,
  injectBranch,
  uninjectBranch
};
