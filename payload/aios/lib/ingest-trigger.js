#!/usr/bin/env node
/**
 * ingest-trigger.js — AIOS Wiki Ingest Script
 *
 * Processa um transcript de sessão Claude Code e:
 * 1. Cria/copia o transcript em raw/sessions/
 * 2. Extrai metadados básicos (agentes, decisões, arquivos, entidades)
 * 3. Gera/atualiza wiki/missions/<mission-id>.md
 * 4. Atualiza wiki/index.md (adiciona entrada da missão)
 * 5. Faz append em wiki/log.md
 * 6. Valida frontmatter gerado contra o schema JSON
 *
 * Uso:
 *   node ingest-trigger.js --transcript <path> --mission-id <id> [--dry-run]
 *
 * Deps: js-yaml (npm install js-yaml), fs e path do stdlib Node.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// js-yaml: única dep externa. Carregamos com try/catch para dar erro útil.
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  console.error(
    '[ingest] ERRO: js-yaml não encontrado.\n' +
    'Instale com: npm install js-yaml\n' +
    'Ou globalmente: npm install -g js-yaml'
  );
  process.exit(1);
}

// ─── Config de paths ───────────────────────────────────────────────────────
// Usa a home do usuário para construir paths absolutos.
// Isso evita depender do cwd de onde o script é chamado.
const HOME       = process.env.HOME || process.env.USERPROFILE || 'C:/Users/mateu';
const VAULT_ROOT = process.env.AIOS_VAULT_ROOT || path.join(HOME, 'Documents', 'COFRE -01');
const SCHEMA_PATH = path.join(HOME, '.claude', 'aios', 'schemas', 'wiki-frontmatter.json');

// Subpastas do vault
const RAW_SESSIONS = path.join(VAULT_ROOT, 'raw', 'sessions');
const WIKI_MISSIONS = path.join(VAULT_ROOT, 'wiki', 'missions');
const WIKI_INDEX   = path.join(VAULT_ROOT, 'wiki', 'index.md');
const WIKI_LOG     = path.join(VAULT_ROOT, 'wiki', 'log.md');

// ─── CLI Args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { transcript: null, missionId: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transcript' && args[i + 1]) {
      result.transcript = args[++i];
    } else if (args[i] === '--mission-id' && args[i + 1]) {
      result.missionId = args[++i];
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
    }
  }

  return result;
}

// ─── Utils ─────────────────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19); // YYYY-MM-DD HH:MM:SS
}

// Escreve arquivo (ou apenas loga em dry-run)
function writeFile(filePath, content, dryRun) {
  if (dryRun) {
    console.log(`\n[dry-run] Escreveria em: ${filePath}`);
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[ingest] Escrito: ${filePath}`);
  }
}

// Faz append em arquivo existente (ou loga em dry-run)
function appendFile(filePath, content, dryRun) {
  if (dryRun) {
    console.log(`\n[dry-run] Faria append em: ${filePath}`);
    console.log(content);
  } else {
    fs.appendFileSync(filePath, content, 'utf8');
    console.log(`[ingest] Append em: ${filePath}`);
  }
}

// ─── Extração de metadados ─────────────────────────────────────────────────
/**
 * Extrai informações do transcript usando regex simples.
 * NÃO inventa — só captura o que está explicitamente no texto.
 *
 * Padrões reconhecidos:
 * - Agentes: linhas com "FORGE", "VIGIL", "AEGIS", "ULTRON", etc.
 * - Decisões: seções "## Decisao" ou "## Decision"
 * - Arquivos: paths com extensão (ex: src/app.ts, lib/utils.js)
 * - Projetos conhecidos do usuario (configurar)
 * - Ferramentas AIOS mencionadas
 */
function extractMetadata(transcriptContent) {
  const lines = transcriptContent.split('\n');

  // Agentes conhecidos do AIOS
  const KNOWN_AGENTS = ['ULTRON', 'VIGIL', 'FORGE', 'AEGIS', 'MORGAN', 'PAX', 'RIVER', 'ATLAS', 'LINK', 'AMOSIS'];

  // Projetos do usuario (configure aqui os seus para reconhece-los como entidades)
  const KNOWN_PROJECTS = [
    // Adicione aqui os nomes dos SEUS projetos para o ingest reconhece-los.
  ];

  // Ferramentas e tecnologias relevantes
  const KNOWN_TOOLS = [
    'Obsidian', 'Supabase', 'Vercel', 'GitHub', 'n8n',
    'Next.js', 'React', 'Tailwind', 'SQLite', 'PostgreSQL',
    'Python', 'TypeScript', 'Node.js', 'Playwright', 'MCP'
  ];

  const agentsFound    = new Set();
  const decisionsFound = [];
  const filesFound     = new Set();
  const projectsFound  = new Set();
  const toolsFound     = new Set();

  // Regex para paths de arquivo (captura extensões comuns)
  const filePattern = /\b[\w.\-/\\]+\.(js|ts|tsx|jsx|py|json|md|yaml|yml|html|css|sql|sh|env)\b/gi;

  // Regex para linhas de decisão
  const decisionHeaderPattern = /^#{1,3}\s*(decisao|decision|decis[aã]o arquitetural|decided|resolvido)/i;

  let insideDecision = false;
  let currentDecision = [];

  for (const line of lines) {
    // Detecta agentes mencionados
    for (const agent of KNOWN_AGENTS) {
      // Busca o nome do agente como palavra, com ou sem colchetes/marcadores
      if (new RegExp(`\\b${agent}\\b`).test(line)) {
        agentsFound.add(agent);
      }
    }

    // Detecta projetos mencionados
    for (const proj of KNOWN_PROJECTS) {
      if (new RegExp(`\\b${proj}\\b`, 'i').test(line)) {
        projectsFound.add(proj);
      }
    }

    // Detecta ferramentas mencionadas
    for (const tool of KNOWN_TOOLS) {
      if (new RegExp(`\\b${tool}\\b`, 'i').test(line)) {
        toolsFound.add(tool);
      }
    }

    // Detecta arquivos mencionados
    const fileMatches = line.match(filePattern);
    if (fileMatches) {
      for (const f of fileMatches) {
        // Filtra falsos positivos óbvios (ex: "1.0", "v2.0")
        if (!/^\d+\.\d+$/.test(f)) {
          filesFound.add(f);
        }
      }
    }

    // Captura seções de decisão
    if (decisionHeaderPattern.test(line)) {
      // Salva decisão anterior se existia
      if (currentDecision.length > 0) {
        decisionsFound.push(currentDecision.join(' ').trim().slice(0, 200));
      }
      insideDecision = true;
      currentDecision = [];
    } else if (insideDecision) {
      if (/^#{1,3}\s/.test(line) && !decisionHeaderPattern.test(line)) {
        // Nova seção não-decisão: encerra captura
        if (currentDecision.length > 0) {
          decisionsFound.push(currentDecision.join(' ').trim().slice(0, 200));
        }
        insideDecision = false;
        currentDecision = [];
      } else if (line.trim().length > 0) {
        currentDecision.push(line.trim());
      }
    }
  }

  // Salva última decisão se ficou aberta
  if (insideDecision && currentDecision.length > 0) {
    decisionsFound.push(currentDecision.join(' ').trim().slice(0, 200));
  }

  return {
    agents:    [...agentsFound].sort(),
    decisions: decisionsFound.slice(0, 10),    // máx 10 decisões extraídas
    files:     [...filesFound].slice(0, 20),   // máx 20 arquivos
    projects:  [...projectsFound].sort(),
    tools:     [...toolsFound].sort(),
  };
}

// ─── Geração de conteúdo ───────────────────────────────────────────────────
/**
 * Monta o frontmatter YAML como string.
 * Mantemos separado para facilitar validação antes de escrever.
 */
function buildFrontmatter(fields) {
  // Serializa arrays em bloco YAML
  const serializeArray = (arr) =>
    arr.length === 0
      ? '[]'
      : '\n' + arr.map(v => `  - "${v}"`).join('\n');

  return [
    '---',
    `type: ${fields.type}`,
    `status: ${fields.status}`,
    `created: ${fields.created}`,
    `updated: ${fields.updated}`,
    `sources:${serializeArray(fields.sources)}`,
    `tags:${serializeArray(fields.tags)}`,
    '---',
  ].join('\n');
}

/**
 * Gera o conteúdo completo da página wiki/missions/<id>.md.
 * Inclui frontmatter + seções padrão.
 */
function buildMissionPage(missionId, meta, rawSessionPath, date) {
  const relativeSource = rawSessionPath
    ? `raw/sessions/${path.basename(rawSessionPath)}`
    : `raw/sessions/${missionId}.md`;

  const frontmatter = buildFrontmatter({
    type: 'mission',
    status: 'draft',
    created: date,
    updated: date,
    sources: [relativeSource],
    tags: ['mission', missionId, ...meta.projects.map(p => p.toLowerCase())],
  });

  const agentsList = meta.agents.length > 0
    ? meta.agents.map(a => `- ${a}`).join('\n')
    : '- (não identificados automaticamente — revisar transcript)';

  const decisionsList = meta.decisions.length > 0
    ? meta.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')
    : '- (nenhuma seção `## Decisao` encontrada — o escriba deve revisar)';

  const filesList = meta.files.length > 0
    ? meta.files.map(f => `- \`${f}\``).join('\n')
    : '- (nenhum arquivo detectado automaticamente)';

  const projectsList = meta.projects.length > 0
    ? meta.projects.map(p => `- ${p}`).join('\n')
    : '- (nenhum projeto mencionado explicitamente)';

  const toolsList = meta.tools.length > 0
    ? meta.tools.map(t => `- ${t}`).join('\n')
    : '- (nenhuma ferramenta detectada)';

  return `${frontmatter}

# Missão: ${missionId}

> **Gerado automaticamente** por \`ingest-trigger.js\` em ${date}.
> O escriba deve revisar e expandir o conteúdo com base no transcript em \`${relativeSource}\`.

## Sumário

<!-- O escriba preenche: 2-4 frases descrevendo o objetivo e resultado da missão -->
_Pendente revisão do escriba._

## Conteúdo

### Objetivo
<!-- O que foi pedido / qual problema resolver -->
_Pendente revisão do escriba._

### Abordagem
<!-- Como foi feito — flow seguido, decisões tomadas -->
_Pendente revisão do escriba._

### Resultado
<!-- O que foi entregue, status final (aprovado, pendente, rejeitado) -->
_Pendente revisão do escriba._

### Agentes Invocados
${agentsList}

### Decisões (extraídas automaticamente)
${decisionsList}

### Arquivos Tocados
${filesList}

### Projetos Mencionados
${projectsList}

### Ferramentas / Tecnologias
${toolsList}

## Relações

- Transcript: [[${path.basename(relativeSource, '.md')}]]

## Histórico

- ${date}: esqueleto gerado por ingest-trigger.js (extração automática)
`;
}

// ─── Validação de frontmatter ──────────────────────────────────────────────
/**
 * Valida o frontmatter de um conteúdo MD contra o schema JSON.
 * Retorna { valid: boolean, errors: string[] }
 *
 * Validação manual (sem deps de ajv) para manter zero deps extras.
 * Cobre: campos obrigatórios, tipo enum, formato de data, arrays.
 */
function validateFrontmatter(mdContent) {
  const errors = [];

  // Extrai bloco frontmatter
  const match = mdContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { valid: false, errors: ['Frontmatter não encontrado (bloco --- ausente)'] };
  }

  let parsed;
  try {
    // CORE_SCHEMA evita que js-yaml converta "2026-04-22" em objeto Date automaticamente.
    // Sem isso, datas ISO no frontmatter viram Date objects e quebram a validação de padrão.
    parsed = yaml.load(match[1], { schema: yaml.CORE_SCHEMA });
  } catch (e) {
    return { valid: false, errors: [`YAML inválido no frontmatter: ${e.message}`] };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, errors: ['Frontmatter vazio ou não é objeto'] };
  }

  // Carrega schema para pegar os enums (se disponível)
  let schema = null;
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch {
    // Schema não encontrado — validamos com valores hardcoded
  }

  const VALID_TYPES   = schema?.properties?.type?.enum   || ['agent', 'mission', 'pattern', 'knowledge', 'decision', 'glossary', 'meta'];
  const VALID_STATUSES = schema?.properties?.status?.enum || ['draft', 'active', 'archived'];
  const DATE_PATTERN  = /^\d{4}-\d{2}-\d{2}$/;

  // type
  if (!parsed.type) {
    errors.push('Campo "type" obrigatório ausente');
  } else if (!VALID_TYPES.includes(parsed.type)) {
    errors.push(`"type" inválido: "${parsed.type}". Válidos: ${VALID_TYPES.join(', ')}`);
  }

  // status
  if (!parsed.status) {
    errors.push('Campo "status" obrigatório ausente');
  } else if (!VALID_STATUSES.includes(parsed.status)) {
    errors.push(`"status" inválido: "${parsed.status}". Válidos: ${VALID_STATUSES.join(', ')}`);
  }

  // created
  if (!parsed.created) {
    errors.push('Campo "created" obrigatório ausente');
  } else if (!DATE_PATTERN.test(String(parsed.created))) {
    errors.push(`"created" deve ser YYYY-MM-DD, recebeu: "${parsed.created}"`);
  }

  // updated
  if (!parsed.updated) {
    errors.push('Campo "updated" obrigatório ausente');
  } else if (!DATE_PATTERN.test(String(parsed.updated))) {
    errors.push(`"updated" deve ser YYYY-MM-DD, recebeu: "${parsed.updated}"`);
  }

  // sources (array obrigatório, pode ser vazio)
  if (!Object.prototype.hasOwnProperty.call(parsed, 'sources')) {
    errors.push('Campo "sources" obrigatório ausente (use [] se não houver fontes ainda)');
  } else if (!Array.isArray(parsed.sources)) {
    errors.push('"sources" deve ser um array');
  }

  // tags (array obrigatório, pode ser vazio)
  if (!Object.prototype.hasOwnProperty.call(parsed, 'tags')) {
    errors.push('Campo "tags" obrigatório ausente (use [] se não houver tags)');
  } else if (!Array.isArray(parsed.tags)) {
    errors.push('"tags" deve ser um array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Atualização de index.md ───────────────────────────────────────────────
/**
 * Adiciona a missão na tabela de "Missões Recentes" do index.md.
 * Se já existe entrada para o mesmo mission-id, não duplica.
 */
function updateIndex(missionId, date, dryRun) {
  if (!fs.existsSync(WIKI_INDEX)) {
    console.log('[ingest] AVISO: wiki/index.md não encontrado. Pulando atualização do index.');
    return;
  }

  let content = fs.readFileSync(WIKI_INDEX, 'utf8');

  // Verifica se a missão já está no index
  if (content.includes(`[[${missionId}]]`)) {
    console.log(`[ingest] Missão "${missionId}" já está no index.md. Sem duplicação.`);
    return;
  }

  // Adiciona linha na tabela de missões recentes
  // Procura pelo marcador da tabela de missões
  const tableMarker = '| Missão | Data | Status |';
  const newRow = `| [[${missionId}]] | ${date} | draft |`;

  if (content.includes(tableMarker)) {
    // Insere após o cabeçalho da tabela e a linha separadora
    const separatorPattern = /(\| Missão \| Data \| Status \|\n\|[-|]+\|\n)/;
    if (separatorPattern.test(content)) {
      const updated = content.replace(separatorPattern, `$1${newRow}\n`);
      writeFile(WIKI_INDEX, updated, dryRun);
    } else {
      // Tabela sem separador ainda — append após o header
      const updated = content.replace(tableMarker, `${tableMarker}\n|---|---|---|\n${newRow}`);
      writeFile(WIKI_INDEX, updated, dryRun);
    }
  } else {
    // Tabela não encontrada — apenas loga aviso
    console.log('[ingest] AVISO: tabela de missões não encontrada em index.md. Adicione manualmente.');
  }

  // Atualiza data de "updated" no frontmatter do index
  if (!dryRun) {
    let indexContent = fs.readFileSync(WIKI_INDEX, 'utf8');
    indexContent = indexContent.replace(
      /^(updated:\s*)\d{4}-\d{2}-\d{2}/m,
      `$1${date}`
    );
    fs.writeFileSync(WIKI_INDEX, indexContent, 'utf8');
  }
}

// ─── Atualização de log.md ─────────────────────────────────────────────────
function appendLog(missionId, action, dryRun) {
  const timestamp = nowTimestamp();
  const logEntry = `| ${timestamp} | ingest | ${missionId} | ${action} |\n`;

  // Verifica se já existe seção para hoje
  const dateSection = `## ${today()}`;

  if (!fs.existsSync(WIKI_LOG)) {
    console.log('[ingest] AVISO: wiki/log.md não encontrado. Pulando atualização do log.');
    return;
  }

  let content = fs.readFileSync(WIKI_LOG, 'utf8');

  if (content.includes(dateSection)) {
    // Adiciona dentro da seção de hoje, após a linha do header da tabela
    const afterTable = content.indexOf('| Hora |', content.indexOf(dateSection));
    if (afterTable !== -1) {
      // Encontra o fim da linha do separador da tabela
      const sepEnd = content.indexOf('\n', content.indexOf('|---|', afterTable)) + 1;
      const updated = content.slice(0, sepEnd) + logEntry + content.slice(sepEnd);
      if (!dryRun) {
        fs.writeFileSync(WIKI_LOG, updated, 'utf8');
        console.log(`[ingest] Log atualizado: ${WIKI_LOG}`);
      } else {
        console.log(`\n[dry-run] Adicionaria ao log:\n${logEntry}`);
      }
    } else {
      console.warn('[ingest] AVISO: secao de hoje em log.md existe mas nao tem cabecalho | Hora |. Entry descartada.');
    }
  } else {
    // Cria nova seção para hoje no final do arquivo
    const newSection = `\n## ${today()}\n\n| Hora | Operação | Alvo | Resultado |\n|------|----------|------|----------|\n${logEntry}`;
    appendFile(WIKI_LOG, newSection, dryRun);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const { transcript, missionId, dryRun } = parseArgs();

  // Valida args obrigatórios
  if (!missionId) {
    console.error('[ingest] ERRO: --mission-id é obrigatório.');
    console.error('Uso: node ingest-trigger.js --transcript <path> --mission-id <id> [--dry-run]');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[ingest] Modo DRY-RUN ativado. Nenhum arquivo será escrito.');
  }

  const date = today();

  // ── Passo 1: Trata o transcript ──────────────────────────────────────────
  let transcriptContent = '';
  let rawSessionFile    = null;

  if (transcript) {
    const transcriptPath = path.resolve(transcript);

    if (!fs.existsSync(transcriptPath)) {
      console.error(`[ingest] ERRO: Transcript não encontrado: ${transcriptPath}`);
      process.exit(1);
    }

    transcriptContent = fs.readFileSync(transcriptPath, 'utf8');

    // Copia para raw/sessions/ com nome padronizado
    const timestamp    = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const rawFileName  = `${missionId}-${timestamp}.md`;
    rawSessionFile     = path.join(RAW_SESSIONS, rawFileName);

    // Só copia se não existir ainda (preserva imutabilidade)
    if (!fs.existsSync(rawSessionFile)) {
      writeFile(rawSessionFile, transcriptContent, dryRun);
    } else {
      console.log(`[ingest] Transcript já existe em raw/sessions/. Usando: ${rawSessionFile}`);
    }
  } else {
    // Sem --transcript: procura o mais recente em raw/sessions/ para este mission-id
    if (fs.existsSync(RAW_SESSIONS)) {
      const files = fs.readdirSync(RAW_SESSIONS)
        .filter(f => f.startsWith(missionId))
        .sort()
        .reverse();

      if (files.length > 0) {
        rawSessionFile    = path.join(RAW_SESSIONS, files[0]);
        transcriptContent = fs.readFileSync(rawSessionFile, 'utf8');
        console.log(`[ingest] Usando transcript existente: ${rawSessionFile}`);
      } else {
        console.log(`[ingest] AVISO: Nenhum transcript encontrado para "${missionId}". Gerando esqueleto sem extração.`);
      }
    }
  }

  // ── Passo 2: Extrai metadados ────────────────────────────────────────────
  console.log('[ingest] Extraindo metadados do transcript...');
  const meta = extractMetadata(transcriptContent);

  console.log(`[ingest] Agentes encontrados: ${meta.agents.join(', ') || 'nenhum'}`);
  console.log(`[ingest] Projetos mencionados: ${meta.projects.join(', ') || 'nenhum'}`);
  console.log(`[ingest] Decisões extraídas: ${meta.decisions.length}`);
  console.log(`[ingest] Arquivos detectados: ${meta.files.length}`);

  // ── Passo 3: Gera/atualiza wiki/missions/<id>.md ─────────────────────────
  const missionFilePath = path.join(WIKI_MISSIONS, `${missionId}.md`);
  const missionExists   = fs.existsSync(missionFilePath);

  let missionContent;

  if (missionExists) {
    // Missão já existe: não sobrescreve, apenas adiciona round no Histórico
    console.log(`[ingest] Missão "${missionId}" já existe. Adicionando round ao Histórico.`);
    let existing = fs.readFileSync(missionFilePath, 'utf8');

    // Atualiza data "updated" no frontmatter
    existing = existing.replace(
      /^(updated:\s*)\d{4}-\d{2}-\d{2}/m,
      `$1${date}`
    );

    // Adiciona entry no Histórico (antes da linha de fechamento se houver)
    const newHistEntry = `- ${date}: re-ingest via ingest-trigger.js (${meta.agents.length} agentes, ${meta.decisions.length} decisões)`;
    existing = existing.replace(
      /(## Histórico\n)/,
      `$1${newHistEntry}\n`
    );

    missionContent = existing;

    // ── Passo 4a: Valida frontmatter em memória ANTES de escrever (re-ingest) ─
    console.log('[ingest] Validando frontmatter (re-ingest)...');
    const { valid: validReIngest, errors: errorsReIngest } = validateFrontmatter(missionContent);

    if (!validReIngest) {
      console.error('[ingest] ERRO: Frontmatter inválido no re-ingest. Arquivo NÃO sobrescrito.');
      errorsReIngest.forEach(e => console.error(`  - ${e}`));
      process.exit(2);
    }

    writeFile(missionFilePath, missionContent, dryRun);
  } else {
    // Cria página nova
    console.log(`[ingest] Criando nova página para missão "${missionId}".`);
    missionContent = buildMissionPage(missionId, meta, rawSessionFile, date);

    // ── Passo 4a: Valida frontmatter em memória ANTES de escrever (nova missão) ─
    console.log('[ingest] Validando frontmatter (nova missão)...');
    const { valid: validNew, errors: errorsNew } = validateFrontmatter(missionContent);

    if (!validNew) {
      console.error('[ingest] ERRO: Frontmatter inválido. Arquivo NÃO criado.');
      errorsNew.forEach(e => console.error(`  - ${e}`));
      process.exit(2);
    }

    writeFile(missionFilePath, missionContent, dryRun);
  }

  // ── Passo 4: Confirmação pós-write (validação já ocorreu acima) ──────────
  console.log('[ingest] Frontmatter válido.');

  // ── Passo 5: Atualiza index.md ───────────────────────────────────────────
  console.log('[ingest] Atualizando wiki/index.md...');
  updateIndex(missionId, date, dryRun);

  // ── Passo 6: Append em log.md ────────────────────────────────────────────
  console.log('[ingest] Atualizando wiki/log.md...');
  const logAction = missionExists
    ? `re-ingest: ${meta.agents.length} agentes, ${meta.decisions.length} decisões`
    : `nova missão criada: ${meta.agents.length} agentes, ${meta.decisions.length} decisões`;
  appendLog(missionId, logAction, dryRun);

  // ── Resumo ───────────────────────────────────────────────────────────────
  console.log('\n[ingest] ✓ Concluído.');
  console.log(`  Missão:    ${missionId}`);
  console.log(`  Arquivo:   ${missionFilePath}`);
  console.log(`  Raw:       ${rawSessionFile || '(sem transcript)'}`);
  console.log(`  Dry-run:   ${dryRun}`);
}

main().catch(err => {
  console.error('[ingest] Erro inesperado:', err.message);
  process.exit(1);
});
