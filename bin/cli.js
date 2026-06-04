#!/usr/bin/env node
/*
 * aios-mateus — instalador CROSS-PLATFORM do motor AIOS (macOS / Windows / Linux).
 *
 * Distribuido via `npm i -g github:Mateus0601/AIOS-Setup` (repo PRIVADO; o npm
 * baixa o repo inteiro pelo git/gh autenticado do usuario, payload incluso) e
 * rodado explicitamente com `aios-mateus`. NAO ha postinstall: a instalacao do
 * AIOS so acontece quando o usuario roda este comando.
 *
 * Replica a logica dos install.sh/install.ps1 em Node puro (so builtins:
 * fs, path, os, child_process), de forma portavel e NAO-destrutiva.
 *
 * Comportamento:
 *  - Destino = path.join(os.homedir(), '.claude')  (flag --dest <dir> sobrescreve).
 *  - payload/ resolvido relativo a __dirname (path.join(__dirname, '..', 'payload')).
 *  - Se ~/.claude ja existe: BACKUP em ~/.claude.bak-<timestamp> ANTES de copiar.
 *  - Copia recursiva (merge) do payload pro ~/.claude SEM apagar dados do usuario
 *    (projects/, secrets/, .credentials.json, logs reais sao preservados).
 *  - Seeds idempotentes (activity-log=[], status=template) so se ausentes.
 *  - Scaffolds vazios com .gitkeep.
 *  - settings.template.json -> settings.json so se ausente.
 *  - payload/CLAUDE.md -> ~/CLAUDE.md so se ausente.
 *  - npm install em ~/.claude/aios/lib (npm.cmd no Windows; --no-npm pula).
 *  - Imprime ONBOARDING no fim e instrui /aios-tour.
 *
 * Uso:
 *   aios-mateus                       # instala em ~/.claude
 *   aios-mateus --dest /tmp/sandbox   # HOME alternativo (teste)
 *   aios-mateus --no-npm              # pula o npm install
 *   aios-mateus --help
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ─── Args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { dest: null, runNpm: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--no-npm') {
      opts.runNpm = false;
    } else if (a === '--dest') {
      opts.dest = argv[++i];
      if (!opts.dest) fail('--dest precisa de um diretorio. Ex: --dest /tmp/aios-test');
    } else if (a.startsWith('--dest=')) {
      opts.dest = a.slice('--dest='.length);
    } else {
      fail(`Argumento desconhecido: ${a}\nRode 'aios-mateus --help' para ajuda.`);
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
    [
      'aios-mateus — instalador do motor AIOS (Claude Code), cross-platform.',
      '',
      'Uso:',
      '  aios-mateus                     instala em ~/.claude',
      '  aios-mateus --dest <dir>        instala num HOME alternativo (sandbox/teste)',
      '  aios-mateus --no-npm            pula o npm install das libs',
      '  aios-mateus --help              esta ajuda',
      '',
      'O instalador faz backup de ~/.claude (se existir), copia o motor sem apagar',
      'seus dados, cria seeds/scaffolds idempotentes e imprime o onboarding.',
      '',
    ].join('\n')
  );
}

function fail(msg, code = 1) {
  process.stderr.write(`\nERRO: ${msg}\n`);
  process.exit(code);
}

// ─── SO (informativo) ────────────────────────────────────────────────────────
function detectOS() {
  switch (process.platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return process.platform;
  }
}

// ─── Timestamp para o nome do backup ─────────────────────────────────────────
// CLI real (nao workflow script): Date.now()/new Date() permitidos.
function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// ─── Copia recursiva (merge nao-destrutivo) ──────────────────────────────────
// Sobrescreve arquivos do motor que vem no payload, mas NUNCA remove arquivos do
// destino que nao existem no payload (preserva projects/, secrets/, logs, etc.).
// fs.cpSync preserva o mode (importante no mac/linux para .sh e bin executaveis).
function mergeCopy(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      mergeCopy(src, dest);
    } else if (entry.isSymbolicLink()) {
      // Resolve e copia o conteudo (evita links quebrados cross-platform).
      const real = fs.realpathSync(src);
      fs.copyFileSync(real, dest);
    } else {
      fs.copyFileSync(src, dest);
      try {
        fs.chmodSync(dest, fs.statSync(src).mode);
      } catch (_) {
        /* Windows pode ignorar chmod; sem problema. */
      }
    }
  }
}

function ensureGitkeep(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const keep = path.join(dir, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
}

// ─── Template do status.json (espelha install.sh) ────────────────────────────
const STATUS_TEMPLATE = {
  schema: 'aios-status-v1',
  activeAgent: 'ULTRON',
  activeTask: '',
  project: '',
  phase: 'idle',
  sessionStart: '1970-01-01T00:00:00.000Z',
  taskStart: '1970-01-01T00:00:00.000Z',
  lastUpdate: '1970-01-01T00:00:00.000Z',
  cycleCount: 0,
  agentsSpawned: [],
  activeStoryFile: '',
  lastActivityIds: { activities: 0, tasks: 0, discussions: 0, decisions: 0 },
  modifiedFiles: [],
  recoveryHint: '',
  missionComplexity: '',
};

const SCAFFOLD_DIRS = [
  'aios/checkpoints',
  'aios/stories',
  'aios/handoffs',
  'aios/missions',
  'aios/runs',
  'aios/raw',
  'aios/logs',
  'aios/secrets',
  'aios/docs',
  'projects',
];

// ─── npm install nas libs ────────────────────────────────────────────────────
function runNpmInstall(libDir) {
  if (!fs.existsSync(path.join(libDir, 'package.json'))) {
    log('npm install pulado: aios/lib/package.json nao encontrado.');
    return;
  }
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  log(`Instalando dependencias das libs (npm install em ${libDir}) ...`);
  const res = spawnSync(npmCmd, ['install', '--no-audit', '--no-fund'], {
    cwd: libDir,
    stdio: 'inherit',
    shell: false,
  });
  if (res.error || res.status !== 0) {
    log(
      `  [aviso] npm install falhou (${
        res.error ? res.error.message : 'exit ' + res.status
      }). Rode manualmente: npm install --prefix "${libDir}"`
    );
  }
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

// ─── Onboarding ──────────────────────────────────────────────────────────────
function printOnboarding(claudeDir) {
  const guia = path.join(claudeDir, 'aios', 'AIOS-GUIA.md');
  log('');
  log('============================================================');
  log(' AIOS instalado com sucesso!');
  log('============================================================');
  log('');
  log('VOCE ACABOU DE INSTALAR um sistema multi-agente para Claude Code:');
  log('  - 10 agentes em 3 squads (Engenharia, Produto, Growth) + 1 escriba.');
  log('  - ULTRON e o orquestrador: voce conversa com ele; ele coordena o resto.');
  log('');
  log('AGENTES:');
  log('  Engenharia: ULTRON (orquestra) - VIGIL (arquiteta) - FORGE (implementa) - AEGIS (revisa)');
  log('  Produto   : MORGAN (PRD) - PAX (backlog) - RIVER (stories) - ATLAS (pesquisa)');
  log('  Growth    : LINK (prospeccao/outreach)');
  log('  Escriba   : AMOSIS (wiki de conhecimento, opcional)');
  log('');
  log('FLUXOS (ULTRON classifica sozinho):');
  log('  simple  -> FORGE -> AEGIS');
  log('  medium  -> VIGIL -> FORGE -> AEGIS');
  log('  complex -> VIGIL -> Group Chat -> FORGE -> AEGIS');
  log('');
  log('SLASH COMMANDS principais:');
  log('  /aios  /missao <tarefa>  /continue  /fast-mode  /aios-tour  /aios-pack');
  log('  /ultron /vigil /forge /aegis  |  /pm /po /sm /analyst  |  /link-prospect');
  log('');
  log('PRIMEIROS PASSOS:');
  log('  1. Confira Node 18+:   node -v');
  log('  2. Abra o Claude Code e rode:   /aios-tour      (tour guiado completo)');
  log('  3. Ou mande logo uma tarefa:    /missao Crie uma landing page para X');
  log('');
  log(`GUIA COMPLETO em: ${guia}   (releia com /aios-tour)`);
  log('');
  log('IMPORTANTE: este pacote NAO traz credenciais nem config de MCP.');
  log('Configure seus MCP servers e logins normalmente. Veja o README do pacote.');
  log('============================================================');
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const destHome = opts.dest ? path.resolve(opts.dest) : os.homedir();
  if (!destHome) fail('Nao foi possivel resolver o HOME de destino.');

  const claudeDir = path.join(destHome, '.claude');
  const payloadDir = path.join(__dirname, '..', 'payload');

  log('=== Instalador do Motor AIOS (aios-mateus) ===');
  log(`SO detectado : ${detectOS()}`);
  log(`Node         : ${process.version}`);
  log(`Destino      : ${claudeDir}`);
  log(`Payload      : ${payloadDir}`);
  log('');

  if (!fs.existsSync(payloadDir) || !fs.statSync(payloadDir).isDirectory()) {
    fail(
      `payload/ nao encontrado em ${payloadDir}.\n` +
        'Reinstale via "npm i -g github:Mateus0601/AIOS-Setup" ou clone o repo completo.'
    );
  }

  // ─── Backup se ja existe ~/.claude ─────────────────────────────────────────
  if (fs.existsSync(claudeDir)) {
    const backup = `${claudeDir}.bak-${backupStamp()}`;
    log(`~/.claude ja existe. Fazendo backup em: ${backup}`);
    try {
      fs.cpSync(claudeDir, backup, { recursive: true });
    } catch (e) {
      fail(`Falha ao criar backup de ${claudeDir}: ${e.message}`);
    }
  }

  // ─── Copia payload -> ~/.claude (merge nao-destrutivo) ─────────────────────
  log(`Copiando motor para ${claudeDir} ...`);
  try {
    mergeCopy(payloadDir, claudeDir);
  } catch (e) {
    fail(`Falha ao copiar o payload: ${e.message}`);
  }

  // ─── aios/.gitignore (npm remove .gitignore do tarball; recriamos) ─────────
  // O npm SEMPRE exclui arquivos chamados ".gitignore" do pacote publicado
  // (regra fixa do npm, nao do nosso .npmignore). No caminho git-clone ele vem
  // normal; no caminho npm ele some. Recriamos com o mesmo conteudo se ausente,
  // garantindo paridade entre os dois metodos de instalacao.
  const aiosGitignore = path.join(claudeDir, 'aios', '.gitignore');
  if (!fs.existsSync(aiosGitignore)) {
    fs.mkdirSync(path.dirname(aiosGitignore), { recursive: true });
    fs.writeFileSync(aiosGitignore, 'secrets/\nlogs/\n*.log\nnode_modules/\n');
  }

  // ─── CLAUDE.md -> ~/CLAUDE.md (so se ausente) ──────────────────────────────
  const claudeMdSrc = path.join(claudeDir, 'CLAUDE.md');
  const claudeMdDest = path.join(destHome, 'CLAUDE.md');
  if (fs.existsSync(claudeMdSrc)) {
    if (!fs.existsSync(claudeMdDest)) {
      fs.copyFileSync(claudeMdSrc, claudeMdDest);
      log(`CLAUDE.md criado em ${claudeMdDest} (bootstrap do modo ULTRON).`);
    } else {
      log(`CLAUDE.md ja existe em ${claudeMdDest} — mantido (template em ${claudeMdSrc}).`);
    }
  }

  // ─── settings.json (so a partir do template, se ausente) ───────────────────
  const settingsTemplate = path.join(claudeDir, 'settings.template.json');
  const settingsJson = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsTemplate)) {
    if (!fs.existsSync(settingsJson)) {
      fs.copyFileSync(settingsTemplate, settingsJson);
      log('settings.json criado a partir do template (defaultMode=acceptEdits).');
    } else {
      log('settings.json ja existe no destino — mantido (template disponivel).');
    }
  }

  // ─── npm install nas libs ──────────────────────────────────────────────────
  if (opts.runNpm) {
    runNpmInstall(path.join(claudeDir, 'aios', 'lib'));
  } else {
    log('npm install pulado (--no-npm). Rode depois: npm install --prefix <claude>/aios/lib');
  }

  // ─── Scaffolds vazios (.gitkeep) ───────────────────────────────────────────
  log('Criando diretorios scaffold vazios ...');
  for (const d of SCAFFOLD_DIRS) {
    ensureGitkeep(path.join(claudeDir, d));
  }

  // ─── Arquivos-seed (so se ausentes) ────────────────────────────────────────
  log('Criando arquivos-seed (se ausentes) ...');
  const activityLog = path.join(claudeDir, 'aios', 'activity-log.json');
  fs.mkdirSync(path.dirname(activityLog), { recursive: true });
  if (!fs.existsSync(activityLog)) {
    fs.writeFileSync(activityLog, '[]\n');
  }
  const statusJson = path.join(claudeDir, 'aios', 'status.json');
  if (!fs.existsSync(statusJson)) {
    fs.writeFileSync(statusJson, JSON.stringify(STATUS_TEMPLATE, null, 2) + '\n');
    log('  status.json criado (template idle).');
  }
  log('  (pipeline.db do Growth sera criado pelo LINK no primeiro uso.)');

  printOnboarding(claudeDir);
  process.exit(0);
}

try {
  main();
} catch (e) {
  fail(e && e.stack ? e.stack : String(e));
}
