#!/usr/bin/env node
/**
 * aios-pack — EMPACOTADOR do MOTOR AIOS (Claude Code multi-agente).
 *
 * Le ~/.claude/ (origem), copia SO o allowlist para ~/aios-setup/payload/,
 * aplicando sanitizacao (remocao de dados pessoais/segredos). Idempotente:
 * limpa payload/ antes de cada execucao.
 *
 * REGRA DE OURO: o pacote contem APENAS o motor. ZERO dados pessoais.
 * No fim roda um GATE de scan que ABORTA se achar vazamento.
 *
 * Uso:
 *   node bin/aios-pack.js              # empacota usando ~/.claude como origem
 *   node bin/aios-pack.js --src <dir>  # origem alternativa (ex: sandbox)
 *   node bin/aios-pack.js --no-gate    # pula o gate (NAO recomendado)
 *
 * Determinismo: NAO usa Date.now()/new Date()/Math.random(). O MANIFEST
 * lista arquivos em ordem alfabetica estavel.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ----------------------------------------------------------------------------
// Args
// ----------------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const SRC = path.resolve(argVal('--src') || path.join(os.homedir(), '.claude'));
const PACK_ROOT = path.resolve(__dirname, '..');
const PAYLOAD = path.join(PACK_ROOT, 'payload');
const RUN_GATE = !args.includes('--no-gate');

// ----------------------------------------------------------------------------
// Helpers de FS
// ----------------------------------------------------------------------------
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function rmrf(p) { if (exists(p)) fs.rmSync(p, { recursive: true, force: true }); }

/** Lista arquivos recursivamente (ordem estavel), retornando paths relativos. */
function listFilesRec(dir, base = dir, acc = []) {
  if (!exists(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFilesRec(full, base, acc);
    else if (e.isFile()) acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
}

const copied = []; // {dest (rel ao payload), src (abs), sanitized: bool}

function recordCopy(srcAbs, destRel, sanitized = false) {
  copied.push({ dest: destRel, src: srcAbs, sanitized });
}

/** Copia um arquivo cru (sem sanitizar). */
function copyFile(srcAbs, destRel) {
  if (!exists(srcAbs)) { warn(`SKIP (nao existe): ${srcAbs}`); return false; }
  const destAbs = path.join(PAYLOAD, destRel);
  ensureDir(path.dirname(destAbs));
  fs.copyFileSync(srcAbs, destAbs);
  recordCopy(srcAbs, destRel, false);
  return true;
}

/** Escreve conteudo (string) direto no payload (arquivo sanitizado/gerado). */
function writePayload(destRel, content, fromSrcAbs = null) {
  const destAbs = path.join(PAYLOAD, destRel);
  ensureDir(path.dirname(destAbs));
  fs.writeFileSync(destAbs, content, 'utf8');
  recordCopy(fromSrcAbs, destRel, true);
}

/** Copia todos os arquivos de um diretorio (recursivo) para um destino. */
function copyDir(srcDirAbs, destDirRel, opts = {}) {
  const { exclude = [] } = opts; // array de regex contra path relativo
  if (!exists(srcDirAbs)) { warn(`SKIP dir (nao existe): ${srcDirAbs}`); return; }
  for (const rel of listFilesRec(srcDirAbs)) {
    if (exclude.some((re) => re.test(rel))) continue;
    copyFile(path.join(srcDirAbs, rel), path.posix.join(destDirRel, rel));
  }
}

// ----------------------------------------------------------------------------
// Log
// ----------------------------------------------------------------------------
const logs = [];
function log(m) { logs.push(m); console.log(m); }
function warn(m) { logs.push('  [warn] ' + m); console.warn('  [warn] ' + m); }

// ----------------------------------------------------------------------------
// 0. Reset idempotente do payload
// ----------------------------------------------------------------------------
log('=== aios-pack: empacotando MOTOR AIOS ===');
log(`Origem : ${SRC}`);
log(`Destino: ${PAYLOAD}`);
rmrf(PAYLOAD);
ensureDir(PAYLOAD);

// ----------------------------------------------------------------------------
// 1. ALLOWLIST — copia crua
// ----------------------------------------------------------------------------

// rules/
copyFile(path.join(SRC, 'rules/doc-roots.md'), 'rules/doc-roots.md');
copyFile(path.join(SRC, 'rules/ultron-core.md'), 'rules/ultron-core.md');

// commands/*.md (todos)
copyDir(path.join(SRC, 'commands'), 'commands', { exclude: [/[^.].*(?<!\.md)$/] });
// Reforco: garante que so .md entrou
for (const rel of listFilesRec(path.join(PAYLOAD, 'commands'))) {
  if (!rel.endsWith('.md')) rmrf(path.join(PAYLOAD, 'commands', rel));
}

// statusline
copyFile(path.join(SRC, 'statusline.js'), 'statusline.js');
copyFile(path.join(SRC, 'statusline-command.sh'), 'statusline-command.sh');

// hooks/*.js + *.sh + *.bat
copyDir(path.join(SRC, 'hooks'), 'hooks', {
  exclude: [/\.(?!js$|sh$|bat$)[^.]*$/],
});

// aios/protocols/* (todos)
copyDir(path.join(SRC, 'aios/protocols'), 'aios/protocols');

// aios/skills/* (todos)
copyDir(path.join(SRC, 'aios/skills'), 'aios/skills');

// aios/schemas/** (recursivo)
copyDir(path.join(SRC, 'aios/schemas'), 'aios/schemas');

// aios/lib/*.js + package.json + package-lock.json (SEM node_modules)
copyDir(path.join(SRC, 'aios/lib'), 'aios/lib', {
  exclude: [/^node_modules\//],
});

// aios/core/*.py (ignora __pycache__)
copyDir(path.join(SRC, 'aios/core'), 'aios/core', {
  exclude: [/__pycache__/, /\.pyc$/],
});

// aios/validation/**
copyDir(path.join(SRC, 'aios/validation'), 'aios/validation', {
  exclude: [/node_modules/],
});

// aios/templates/**
copyDir(path.join(SRC, 'aios/templates'), 'aios/templates', {
  exclude: [/node_modules/],
});

// aios/squads/produto/*.md + squad-manifest.json
for (const f of ['analyst.md', 'pm.md', 'po.md', 'sm.md', 'squad-manifest.json']) {
  copyFile(path.join(SRC, 'aios/squads/produto', f), path.posix.join('aios/squads/produto', f));
}

// aios/squads/growth/link.md + squad-manifest.json  (NAO copia pipeline.db)
copyFile(path.join(SRC, 'aios/squads/growth/link.md'), 'aios/squads/growth/link.md');
copyFile(path.join(SRC, 'aios/squads/growth/squad-manifest.json'), 'aios/squads/growth/squad-manifest.json');

// configs simples (sem chave/dados pessoais)
copyFile(path.join(SRC, 'aios/concurrency.json'), 'aios/concurrency.json');
copyFile(path.join(SRC, 'aios/plan-config.json'), 'aios/plan-config.json');
copyFile(path.join(SRC, 'aios/llm-router-config.json'), 'aios/llm-router-config.json');
copyFile(path.join(SRC, 'aios/.gitignore'), 'aios/.gitignore');
copyFile(path.join(SRC, 'aios/mission-board.md'), 'aios/mission-board.md'); // ja e template

// ----------------------------------------------------------------------------
// 2. ALLOWLIST — copia COM sanitizacao
// ----------------------------------------------------------------------------

// 2a. settings.json -> settings.template.json (sanitizado)
sanitizeSettings();

// 2b. memory_blocks.json -> generico (human/summary viram template)
sanitizeMemoryBlocks();

// 2c. gotchas.json -> remove referencias a projetos/dados pessoais
sanitizeGotchas();

// 2d. evolution-log.md -> ja e template puro; copia cru (sem dados)
copyFile(path.join(SRC, 'aios/evolution-log.md'), 'aios/evolution-log.md');

// 2e. Sanitiza vazamentos pontuais em arquivos de codigo (docstrings/exemplos)
sanitizeSourceLeaks();

// 2f. Sanitiza paths pessoais hardcoded em TODOS os arquivos de texto do payload
//     (username, home do Windows, Vault, OneDrive) -> portavel/placeholder.
sanitizePersonalPaths();

// ----------------------------------------------------------------------------
// 3. Arquivos do PROPRIO pacote (comandos novos) — gerados/copiados depois
//    aios-pack.md e aios-tour.md sao escritos por scripts externos (build do
//    repo). Aqui copiamos do payload/commands se ja existirem ao lado do pack.
// ----------------------------------------------------------------------------
// (Os arquivos commands/aios-pack.md, commands/aios-tour.md e AIOS-GUIA.md
//  sao criados como assets fixos do repo em payload/ — este script NAO os
//  apaga porque sao escritos APOS o reset apenas se vierem de assets/.)
copyPackAssets();

// ----------------------------------------------------------------------------
// 4. GATE de seguranca
// ----------------------------------------------------------------------------
let gateResult = { clean: true, findings: [] };
if (RUN_GATE) {
  gateResult = securityGate(PAYLOAD);
}

// ----------------------------------------------------------------------------
// 5. MANIFEST.md
// ----------------------------------------------------------------------------
writeManifest(gateResult);

// ----------------------------------------------------------------------------
// Resultado final
// ----------------------------------------------------------------------------
log('');
log(`Arquivos empacotados: ${copied.length}`);
if (RUN_GATE) {
  const alerts = (gateResult.findings || []).filter((f) => f.alert);
  if (gateResult.clean) {
    log('GATE DE SEGURANCA: LIMPO (nenhum vazamento bloqueante encontrado).');
    if (alerts.length) {
      log(`  (${alerts.length} alerta(s) nao-bloqueante(s) — nomes de projeto em exemplos:)`);
      for (const f of alerts) log(`  ~ ${f.file}:${f.line} [${f.rule}] ${f.snippet}`);
    }
  } else {
    log('GATE DE SEGURANCA: BLOQUEADO — vazamentos encontrados:');
    for (const f of (gateResult.blocking || gateResult.findings)) log(`  - ${f.file}:${f.line} [${f.rule}] ${f.snippet}`);
    process.exitCode = 2;
  }
}
log('MANIFEST gerado em: ' + path.join(PACK_ROOT, 'MANIFEST.md'));

// ============================================================================
// SANITIZADORES
// ============================================================================

function sanitizeSettings() {
  const srcAbs = path.join(SRC, 'settings.json');
  if (!exists(srcAbs)) { warn('settings.json nao existe; pulando'); return; }
  const raw = JSON.parse(fs.readFileSync(srcAbs, 'utf8'));

  // Permissions: mantem a estrutura, mas torna o default seguro.
  if (raw.permissions) {
    raw.permissions.defaultMode = 'acceptEdits'; // era bypassPermissions (agressivo)
  }
  // Remove flags agressivas de auto-aprovacao.
  delete raw.skipDangerousModePermissionPrompt;
  delete raw.skipAutoPermissionPrompt;

  // Nota explicando como reativar o modo agressivo (opt-in consciente).
  raw._note = [
    'Template do AIOS. defaultMode foi trocado de "bypassPermissions" para "acceptEdits" por seguranca.',
    'Para reativar o modo agressivo (auto-aprova tudo) APOS entender os riscos, defina',
    'permissions.defaultMode = "bypassPermissions" e adicione skipDangerousModePermissionPrompt:true',
    'e skipAutoPermissionPrompt:true. Hooks usam node em $HOME/.claude/hooks/*.js — Node 18+ obrigatorio.',
    'enabledPlugins/extraKnownMarketplaces sao plugins publicos do marketplace oficial da Anthropic; ajuste a gosto.',
  ].join(' ');

  const out = JSON.stringify(raw, null, 2) + '\n';
  writePayload('settings.template.json', out, srcAbs);
  log('  sanitizado: settings.json -> settings.template.json (defaultMode=acceptEdits, flags agressivas removidas)');
}

function sanitizeMemoryBlocks() {
  const srcAbs = path.join(SRC, 'aios/memory_blocks.json');
  if (!exists(srcAbs)) { warn('memory_blocks.json nao existe; pulando'); return; }
  const data = JSON.parse(fs.readFileSync(srcAbs, 'utf8'));

  const HUMAN_TEMPLATE =
    'Nome: <seu nome>. Idioma: <seu idioma, ex PT-BR>. Projetos: <descreva seus projetos>. ' +
    'Preferencias: <ex: respostas diretas e objetivas>. SO/shell: <ex: Windows 10 + bash>.';

  data.updatedAt = '<gerado-na-instalacao>';
  if (data.agents) {
    for (const agentId of Object.keys(data.agents)) {
      const blocks = data.agents[agentId];
      for (const b of blocks) {
        if (b.label === 'human') b.value = HUMAN_TEMPLATE;
        else if (b.label === 'summary') b.value = '';
        // persona e policies sao do framework -> mantem
      }
    }
  }
  writePayload('aios/memory_blocks.json', JSON.stringify(data, null, 2) + '\n', srcAbs);
  log('  sanitizado: memory_blocks.json (human=template generico, summary=vazio; persona/policies mantidos)');
}

function sanitizeGotchas() {
  const srcAbs = path.join(SRC, 'aios/gotchas.json');
  if (!exists(srcAbs)) { warn('gotchas.json nao existe; pulando'); return; }
  const data = JSON.parse(fs.readFileSync(srcAbs, 'utf8'));

  // Mantem APENAS gotchas genericos do MOTOR (project = aios-core).
  // Remove os que citam projetos pessoais (aios-dashboard, aios-monetization, etc).
  const KEEP_PROJECTS = new Set(['aios-core']);
  const before = (data.gotchas || []).length;
  data.gotchas = (data.gotchas || []).filter((g) => KEEP_PROJECTS.has(g.project));

  // Recalcula estatisticas para refletir o subset.
  const byCat = {}, bySev = {};
  let resolved = 0;
  for (const g of data.gotchas) {
    byCat[g.category] = (byCat[g.category] || 0) + 1;
    bySev[g.severity] = (bySev[g.severity] || 0) + 1;
    if (g.resolved) resolved++;
  }
  data.statistics = {
    total: data.gotchas.length,
    resolved,
    unresolved: data.gotchas.length - resolved,
    byCategory: byCat,
    bySeverity: bySev,
  };
  data.lastUpdated = '<gerado-na-instalacao>';

  writePayload('aios/gotchas.json', JSON.stringify(data, null, 2) + '\n', srcAbs);
  log(`  sanitizado: gotchas.json (${before} -> ${data.gotchas.length}; mantidos so genericos do motor aios-core)`);
}

/**
 * Sanitiza vazamentos pontuais em arquivos de CODIGO (docstrings e exemplos
 * hardcoded). Substituicoes literais e deterministas — nao alteram a logica:
 * - "Nome: Mateus. ..." (string de exemplo de bloco human) -> template generico.
 * - "Nome: Mateus..." (linha de --help) -> "Nome: <seu nome>...".
 * - "do Mateus" (comentarios) -> "do usuario".
 * - Lista hardcoded de projetos pessoais (KNOWN_PROJECTS) -> lista vazia
 *   (o codigo continua funcionando: zero projetos pre-conhecidos; ele ainda
 *   detecta agentes/ferramentas/arquivos normalmente).
 */
function sanitizeSourceLeaks() {
  const HUMAN_TEMPLATE_PY =
    'Nome: <seu nome>. Idioma: <seu idioma>. Projetos: <seus projetos>. ' +
    'Preferencias: <ex: respostas diretas>. SO/shell: <ex: Windows + bash>.';

  // handoff_engine.py
  patch('aios/core/handoff_engine.py', (s) => s
    .replace(
      /value="Nome: Mateus\. Idioma: PT-BR\. Projetos: AIOS multi-agente com Claude Code\. Prefere respostas diretas e objetivas\. Usa Windows 10 \+ bash\.",/,
      `value="${HUMAN_TEMPLATE_PY}",`)
    .replace(/memory set vigil human "Nome: Mateus\.\.\."/,
      'memory set vigil human "Nome: <seu nome>..."'));

  // --- M2: nomes de projeto REAIS usados como EXEMPLO -> nomes neutros -----
  // Apenas em exemplos/testes/comentarios; nao altera logica (os testes usam
  // os nomes so como strings de projeto, equivalentes a qualquer outro nome).
  // agent-templates.md: lista de exemplos de <projeto>.
  patch('aios/protocols/agent-templates.md', (s) => s
    .replace('ex: `aios`, `logitek`, `panini`, `critiq`', 'ex: `aios`, `projeto-a`, `projeto-b`, `acme`'));

  // notify.js: comentario de exemplo de extracao de nome de projeto.
  patch('hooks/notify.js', (s) => s
    .replace(/critiq/g, 'acme'));

  // runs-protocol.md: exemplos de runId/pastas com nomes de projeto reais.
  patch('aios/protocols/runs-protocol.md', (s) => s
    .replace(/LogiTok/g, 'Projeto-A')
    .replace(/logitok/g, 'projeto-a')
    .replace(/\bUltron\b(?= vs| vs\.)/g, 'Projeto-B'));

  // test-runs-*.js: usam 'logitok'/'ultron' como nomes de projeto de teste.
  for (const t of ['aios/validation/test-runs-e2e.js', 'aios/validation/test-runs-smoke.js']) {
    patch(t, (s) => s
      .replace(/\(logitok \+ ultron\)/g, '(projeto-a + projeto-b)')
      .replace(/LogiTok/g, 'Projeto-A')
      .replace(/logitok/g, 'projeto-a')
      .replace(/'ultron'/g, "'projeto-b'")
      .replace(/ultron-only/g, 'projeto-b-only')
      // 'ultron' usado como NOME DE PROJETO em assercoes/labels/strings de teste
      // (nao o agente ULTRON). Mantem os testes consistentes com openRun('projeto-b').
      .replace(/run-ultron-/g, 'run-projeto-b-')
      .replace(/\(ultron\)/g, '(projeto-b)')
      .replace(/Ultron dispatcher/g, 'Projeto-B dispatcher')
      .replace(/'ultron-only'/g, "'projeto-b-only'")
      .replace(/i % 2 === 0 \? 'projeto-a' : 'ultron'/g, "i % 2 === 0 ? 'projeto-a' : 'projeto-b'"));
  }

  // session-classifier.js — comentario de exemplo com path pessoal "achatado"
  // (formato C--Users-mateu-...-Logitok). Troca por exemplo neutro. So comentario.
  patch('aios/lib/session-classifier.js', (s) => s
    .replace(
      /\/\/ "C--Users-mateu-OneDrive-Documentos-Code-Logitok" -> ultimo segmento util/,
      '// "C--Users-voce-projects-acme" -> ultimo segmento util'));

  // ingest-trigger.js — neutraliza comentarios e zera a lista de projetos pessoais.
  patch('aios/lib/ingest-trigger.js', (s) => s
    .replace(/Projetos conhecidos do Mateus/g, 'Projetos conhecidos do usuario (configurar)')
    .replace(/Projetos ativos do Mateus \(para reconhecer como entidades\)/g,
      'Projetos do usuario (configure aqui os seus para reconhece-los como entidades)')
    .replace(
      /const KNOWN_PROJECTS = \[[\s\S]*?\];/,
      'const KNOWN_PROJECTS = [\n    // Adicione aqui os nomes dos SEUS projetos para o ingest reconhece-los.\n  ];'));
}

/**
 * Sanitiza paths pessoais hardcoded em TODOS os arquivos de TEXTO do payload.
 * Roda DEPOIS das copias e dos sanitizadores pontuais. Deterministico, so texto.
 *
 * Estrategia:
 *  - C1 (pdf-generation.md): troca o require absoluto por um require portavel
 *    baseado em HOME/USERPROFILE (evita MODULE_NOT_FOUND no amigo).
 *  - C2 (missao.md): troca o path pessoal OneDrive\Documentos\Code por ~/projects.
 *  - GERAL: para todo arquivo de texto, substitui ocorrencias do home do
 *    Windows do autor e do Vault/OneDrive por placeholders portaveis (~).
 */
function sanitizePersonalPaths() {
  // --- C1: require portavel no skill de PDF -------------------------------
  patch('aios/skills/pdf-generation.md', (s) => s
    .replace(
      /const \{ htmlToPdf \} = require\(['"]\/c\/Users\/mateu\/\.claude\/aios\/lib\/html2pdf\.js['"]\);/,
      "const { htmlToPdf } = require(require('path').join(process.env.HOME || process.env.USERPROFILE, '.claude/aios/lib/html2pdf.js'));"));

  // --- C2: /missao cria projeto em ~/projects, sem OneDrive/path pessoal --
  patch('commands/missao.md', (s) => s
    .replace(
      /Criar em `C:\\Users\\mateu\\OneDrive\\Documentos\\Code\\\{nome-do-projeto\}`/,
      'Criar em `~/projects/{nome-do-projeto}`')
    // fallback caso o trecho esteja com barras normais ou outro separador
    .replace(
      /C:[\\/]+Users[\\/]+mateu[\\/]+OneDrive[\\/]+Documentos[\\/]+Code[\\/]+\{nome-do-projeto\}/g,
      '~/projects/{nome-do-projeto}'));

  // --- GERAL: percorre todo o payload de texto e neutraliza paths pessoais
  const VAULT_PLACEHOLDER = '~/Documents/<SEU-VAULT>';
  for (const rel of listFilesRec(PAYLOAD)) {
    if (/\.(db|png|jpg|jpeg|gif|ico|woff2?|ttf|otf|zip|gz|pdf)$/i.test(rel)) continue;
    patch(rel, (s) => {
      let out = s;
      // 1. Vault concreto do autor -> placeholder generico (faz ANTES do home).
      //    Captura o prefixo ATE "COFRE -01" e tambem o subpath que vem depois
      //    (raw\artifacts\..., scribe-decisions.md, etc.), convertendo as
      //    barras invertidas do subpath em barras normais para ficar portavel.
      const vaultPrefix =
        /(?:C:[\\/]+Users[\\/]+mateu|\/c\/Users\/mateu)[\\/]+Documents[\\/]+COFRE ?-01([\\/][^\s`'")]*)?/gi;
      out = out.replace(vaultPrefix, (_m, sub) =>
        VAULT_PLACEHOLDER + (sub ? sub.replace(/\\/g, '/') : ''));
      // 2. OneDrive\Documentos\Code do autor -> ~/projects.
      out = out
        .replace(/C:[\\/]+Users[\\/]+mateu[\\/]+OneDrive[\\/]+Documentos[\\/]+Code/gi,
          '~/projects')
        .replace(/\/c\/Users\/mateu\/OneDrive\/Documentos\/Code/gi, '~/projects');
      // 3. Home do Windows do autor -> ~ (qualquer separador remanescente).
      out = out
        .replace(/C:[\\/]+Users[\\/]+mateu/gi, '~')
        .replace(/\/c\/Users\/mateu/gi, '~');
      // 4. Nome PESSOAL do Vault do autor ("COFRE -01") -> placeholder neutro.
      //    Aparece solto em docs ("~/Documents/COFRE -01/wiki") e como default
      //    em libs (path.join(HOME,'Documents','COFRE -01')). Trocar a string
      //    nao quebra logica: continua sendo so um nome default de pasta, e o
      //    usuario sobrescreve via env (AIOS_VAULT_ROOT).
      out = out
        .replace(/COFRE ?-01/g, '<SEU-VAULT>')
        // colapsa o placeholder duplo que pode surgir de "~/Documents/<SEU-VAULT>"
        // ja gerado na etapa 1 seguido de outra ocorrencia (idempotente).
        .replace(/<SEU-VAULT>\/<SEU-VAULT>/g, '<SEU-VAULT>');
      return out;
    });
  }
}

/** Le um arquivo ja no payload, aplica fn(content) e regrava (marca sanitizado). */
function patch(destRel, fn) {
  const abs = path.join(PAYLOAD, destRel);
  if (!exists(abs)) { warn(`patch SKIP (nao existe no payload): ${destRel}`); return; }
  const before = fs.readFileSync(abs, 'utf8');
  const after = fn(before);
  if (before === after) return; // nada mudou -> nao reescreve nem marca
  fs.writeFileSync(abs, after, 'utf8');
  const rec = copied.find((c) => c.dest === destRel);
  if (rec) rec.sanitized = true;
  log(`  sanitizado (leak em codigo): ${destRel}`);
}

// ============================================================================
// ASSETS FIXOS DO PACOTE (vivem em bin/assets/ no repo, copiados pro payload)
// ============================================================================
function copyPackAssets() {
  const assetsDir = path.join(__dirname, 'assets');
  if (!exists(assetsDir)) { warn('bin/assets/ nao existe ainda (sera criado pelo build)'); return; }
  for (const rel of listFilesRec(assetsDir)) {
    copyFile(path.join(assetsDir, rel), rel); // rel ja inclui ex: commands/aios-tour.md
  }
  log('  assets do pacote copiados (commands novos + AIOS-GUIA.md)');
}

// ============================================================================
// GATE DE SEGURANCA — scan recursivo por dados pessoais/segredos
// ============================================================================
function securityGate(root) {
  // Padroes proibidos. Cada um com nome para o relatorio.
  // Whitelist: linhas com placeholders claramente genericos sao ignoradas.
  const PLACEHOLDER = /<[^>]*>|seu-email@exemplo|exemplo\.com|seu nome|your[-_ ]?name|apiKeyEnv|API_KEY"|_ENV"|process\.env|getenv|<gerado-na-instalacao>/i;

  const rules = [
    { name: 'nome-mateus', re: /\bmateus\b/i },
    { name: 'path-windows-pessoal', re: /Users[\\/]+mateu/i },
    { name: 'username', re: /\bmateu\b/i },
    { name: 'projeto-real', re: /\b(logitok|logitek|panini|critiq|polymarket|orbita|praiago|promokintsugi)\b/i, alert: true },
    { name: 'email-pessoal', re: /mateusdeustempoder/i },
    { name: 'email-generico', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
    { name: 'socio-michel', re: /\bmichel\b/i },
    { name: 'socio-bernardo', re: /\bbernardo\b/i },
    { name: 'blackcat', re: /blackcat/i },
    { name: 'vennox', re: /vennox/i },
    { name: 'labia', re: /labiadecachorro/i },
    { name: 'pixel-tiktok', re: /\bD7[CD][A-Z0-9]{8,}/ },
    { name: 'supabase-ref', re: /uvudsuprvdeinbusmcar/i },
    { name: 'token-sk', re: /\bsk-[A-Za-z0-9]{16,}/ },
    { name: 'token-bearer', re: /Bearer\s+[A-Za-z0-9._-]{10,}/ },
    { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    { name: 'github-pat', re: /\bghp_[A-Za-z0-9]{20,}/ },
    { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
    { name: 'credentials', re: /\.credentials\b/ },
    { name: 'telefone-br', re: /\+?55\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/ },
  ];

  // Arquivos cujo conteudo legitimamente cita termos do motor (ex: a propria
  // regra do gate). Excluimos o MANIFEST e este script do scan? Nao: o MANIFEST
  // ainda nao existe quando o gate roda, e o script vive em bin/, fora do payload.
  const findings = [];
  for (const rel of listFilesRec(root)) {
    // Pula binarios obvios (db, png, etc.) — so escaneia texto.
    if (/\.(db|png|jpg|jpeg|gif|ico|woff2?|ttf|otf|zip|gz|pdf)$/i.test(rel)) continue;
    const abs = path.join(root, rel);
    let content;
    try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (PLACEHOLDER.test(line)) continue; // linha com placeholder generico -> ok
      for (const rule of rules) {
        if (rule.re.test(line)) {
          findings.push({
            file: rel,
            line: i + 1,
            rule: rule.name,
            snippet: line.trim().slice(0, 120),
            alert: !!rule.alert, // alert=so avisa, nao bloqueia o pack
          });
        }
      }
    }
  }
  // BLOQUEANTES = findings sem flag alert. ALERTAS aparecem no relatorio mas
  // nao impedem o pack (ex: nomes de projeto em exemplos neutralizaveis).
  const blocking = findings.filter((f) => !f.alert);
  return { clean: blocking.length === 0, findings, blocking };
}

// ============================================================================
// MANIFEST.md
// ============================================================================
function writeManifest(gate) {
  const sorted = [...copied].sort((a, b) => a.dest.localeCompare(b.dest));
  const lines = [];
  lines.push('# MANIFEST — aios-pack');
  lines.push('');
  lines.push('Lista auditavel de EXATAMENTE quais arquivos foram empacotados no `payload/`.');
  lines.push('Gerada automaticamente por `bin/aios-pack.js`. Nao editar a mao.');
  lines.push('');
  lines.push(`- Total de arquivos: **${sorted.length}**`);
  lines.push(`- Arquivos sanitizados: **${sorted.filter((c) => c.sanitized).length}**`);
  const blockingCount = (gate.blocking || gate.findings || []).length;
  lines.push(`- Gate de seguranca: **${gate.clean ? 'LIMPO' : 'BLOQUEADO (' + blockingCount + ' vazamentos)'}**`);
  lines.push('');
  lines.push('| # | Arquivo (destino em ~/.claude/) | Sanitizado |');
  lines.push('|---|---------------------------------|------------|');
  sorted.forEach((c, idx) => {
    lines.push(`| ${idx + 1} | \`${c.dest}\` | ${c.sanitized ? 'sim' : 'nao'} |`);
  });
  lines.push('');
  if (!gate.clean) {
    lines.push('## VAZAMENTOS DETECTADOS PELO GATE');
    lines.push('');
    lines.push('| Arquivo | Linha | Regra | Trecho |');
    lines.push('|---------|-------|-------|--------|');
    for (const f of (gate.blocking || gate.findings)) {
      lines.push(`| \`${f.file}\` | ${f.line} | ${f.rule} | \`${f.snippet.replace(/\|/g, '\\|')}\` |`);
    }
    lines.push('');
  }
  const alerts = (gate.findings || []).filter((f) => f.alert);
  if (alerts.length) {
    lines.push('## ALERTAS NAO-BLOQUEANTES (nomes de projeto em exemplos)');
    lines.push('');
    lines.push('| Arquivo | Linha | Regra | Trecho |');
    lines.push('|---------|-------|-------|--------|');
    for (const f of alerts) {
      lines.push(`| \`${f.file}\` | ${f.line} | ${f.rule} | \`${f.snippet.replace(/\|/g, '\\|')}\` |`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(PACK_ROOT, 'MANIFEST.md'), lines.join('\n'), 'utf8');
}
