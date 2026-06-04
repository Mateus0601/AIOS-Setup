#!/usr/bin/env node
/**
 * wiki-lint.js
 *
 * Linter para vault AMOSIS / COFRE -01.
 *
 * Uso:
 *   node wiki-lint.js [--vault <path>] [--output <path>]
 *
 * Defaults:
 *   --vault   = ~/Documents/COFRE -01/
 *   --output  = <vault>/wiki/meta/lint-report-YYYY-MM-DD.md
 *
 * Valida:
 *   - Frontmatter YAML parseavel + campos obrigatorios (type, status, created, updated)
 *   - Campo `type` em [agent, mission, pattern, knowledge, decision, glossary, meta]
 *   - Campo `status` em [draft, active, archived]
 *   - Wikilinks [[X]] apontam pra paginas existentes
 *   - Paginas orfas em agents/, knowledge/, decisions/, patterns/ (zero inbound links)
 *
 * Stdlib Node only. Zero dependencias.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const DEFAULT_VAULT = path.join(HOME, 'Documents', 'COFRE -01');

const VALID_TYPES = ['agent', 'mission', 'pattern', 'knowledge', 'decision', 'glossary', 'meta'];
const VALID_STATUSES = ['draft', 'active', 'archived'];
const ORPHAN_DIRS = ['agents', 'knowledge', 'decisions', 'patterns'];

// Diretorios excluidos da varredura intensiva (mas ainda coletados como paginas existentes)
const SKIP_HEAVY_SCAN = ['meta', 'scribe-decisions'];

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { vault: DEFAULT_VAULT, output: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vault' && argv[i + 1]) { out.vault = argv[++i]; }
    else if (a === '--output' && argv[i + 1]) { out.output = argv[++i]; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// FS walk
// ---------------------------------------------------------------------------

function walk(dir, acc) {
  acc = acc || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, acc);
    } else if (e.isFile() && full.toLowerCase().endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (YAML basico, stdlib only)
// ---------------------------------------------------------------------------

function extractFrontmatter(text) {
  // Primeiro bloco entre --- e ---, linha 1.
  if (!text.startsWith('---')) return { raw: null, body: text };
  const lines = text.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { raw: null, body: text };
  const raw = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  return { raw, body };
}

function parseYamlSimple(raw) {
  // Parser YAML minimalista: key: value + listas com "- item" (flat).
  // Nao suporta aninhamento complexo; suficiente pro frontmatter padrao do vault.
  if (!raw) return null;
  const out = {};
  const lines = raw.split(/\r?\n/);
  let currentKey = null;
  let currentList = null;

  for (const raw_line of lines) {
    const line = raw_line.replace(/\s+$/, '');
    if (!line.trim()) { currentKey = null; currentList = null; continue; }
    // Item de lista
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentList) {
      currentList.push(unquote(listMatch[1].trim()));
      continue;
    }
    // key: value ou key:
    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const k = kvMatch[1];
      const v = kvMatch[2];
      if (v === '' || v === undefined) {
        // Pode ser inicio de lista
        out[k] = [];
        currentKey = k;
        currentList = out[k];
      } else if (/^\[.*\]$/.test(v)) {
        // Lista inline: [a, b, c]
        out[k] = v.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean);
        currentKey = null;
        currentList = null;
      } else {
        out[k] = unquote(v);
        currentKey = null;
        currentList = null;
      }
    }
  }
  return out;
}

function unquote(s) {
  if (typeof s !== 'string') return s;
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Validacao de frontmatter
// ---------------------------------------------------------------------------

function validateFrontmatter(fm) {
  const errors = [];
  if (!fm || typeof fm !== 'object') {
    return ['frontmatter ausente ou invalido'];
  }
  const required = ['type', 'status', 'created', 'updated'];
  for (const key of required) {
    if (!fm[key]) errors.push(`campo obrigatorio faltando: ${key}`);
  }
  if (fm.type && !VALID_TYPES.includes(String(fm.type).toLowerCase())) {
    errors.push(`type invalido: "${fm.type}" (esperado: ${VALID_TYPES.join(', ')})`);
  }
  if (fm.status && !VALID_STATUSES.includes(String(fm.status).toLowerCase())) {
    errors.push(`status invalido: "${fm.status}" (esperado: ${VALID_STATUSES.join(', ')})`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Wikilinks
// ---------------------------------------------------------------------------

function extractWikilinks(body) {
  // [[Target]] ou [[Target|Alias]] ou [[Target#section]]
  const re = /\[\[([^\]\n]+?)\]\]/g;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    let target = m[1];
    // Remover alias e anchor
    target = target.split('|')[0].split('#')[0].trim();
    if (!target) continue;
    // Linha do match
    const before = body.slice(0, m.index);
    const lineNum = before.split(/\r?\n/).length;
    out.push({ target, line: lineNum });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  const vault = args.vault;
  const wikiDir = path.join(vault, 'wiki');

  if (!fs.existsSync(wikiDir)) {
    console.error(`wiki-lint: vault/wiki nao encontrado: ${wikiDir}`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const output = args.output || path.join(vault, 'wiki', 'meta', `lint-report-${today}.md`);

  // 1. Coletar todas as paginas
  const allFiles = walk(wikiDir);
  const pageIndex = new Map(); // basename (sem .md) → path absoluto
  for (const f of allFiles) {
    const base = path.basename(f, '.md');
    // Se duplicado, mantem o primeiro (nao deve acontecer em vault saneado)
    if (!pageIndex.has(base)) pageIndex.set(base, f);
  }

  // 2. Varrer cada arquivo e validar
  const invalidFrontmatter = []; // [{path, errors[]}]
  const brokenLinks = [];        // [{origin, line, target}]
  const inboundCount = new Map(); // basename → count de inbound links

  for (const file of allFiles) {
    const rel = path.relative(vault, file).replace(/\\/g, '/');
    // Pular scan pesado em meta/ e scribe-decisions (ainda contam como paginas existentes)
    const parts = rel.split('/');
    const isHeavySkip = parts.length >= 2 && SKIP_HEAVY_SCAN.includes(parts[1]);

    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (_) { continue; }

    const { raw, body } = extractFrontmatter(text);
    const fm = parseYamlSimple(raw);

    if (!isHeavySkip) {
      const errs = validateFrontmatter(fm);
      if (errs.length) {
        invalidFrontmatter.push({ path: rel, errors: errs });
      }
    }

    // Wikilinks — sempre extrair (importa pra inbound count) mas so reportar broken fora de SKIP_HEAVY_SCAN
    const links = extractWikilinks(body || text);
    for (const { target, line } of links) {
      if (pageIndex.has(target)) {
        inboundCount.set(target, (inboundCount.get(target) || 0) + 1);
      } else if (!isHeavySkip) {
        brokenLinks.push({ origin: rel, line, target });
      }
    }
  }

  // 3. Detectar paginas orfas em ORPHAN_DIRS
  const orphanPages = [];
  for (const file of allFiles) {
    const rel = path.relative(wikiDir, file).replace(/\\/g, '/');
    const firstDir = rel.split('/')[0];
    if (!ORPHAN_DIRS.includes(firstDir)) continue;
    const base = path.basename(file, '.md');
    const cnt = inboundCount.get(base) || 0;
    if (cnt === 0) {
      orphanPages.push(path.relative(args.vault, file).replace(/\\/g, '/'));
    }
  }

  // 4. Gerar relatorio markdown
  const lines = [];
  lines.push(`# Wiki Lint Report — ${today}`);
  lines.push('');
  lines.push(`- Total paginas: ${allFiles.length}`);
  lines.push(`- Frontmatter invalido: ${invalidFrontmatter.length}`);
  lines.push(`- Wikilinks quebrados: ${brokenLinks.length}`);
  lines.push(`- Paginas orfas: ${orphanPages.length}`);
  lines.push('');

  if (invalidFrontmatter.length) {
    lines.push('## Frontmatter invalido');
    lines.push('');
    for (const item of invalidFrontmatter) {
      lines.push(`- \`${item.path}\``);
      for (const e of item.errors) lines.push(`  - ${e}`);
    }
    lines.push('');
  }

  if (brokenLinks.length) {
    lines.push('## Wikilinks quebrados');
    lines.push('');
    for (const { origin, line, target } of brokenLinks) {
      lines.push(`- \`${origin}\` (L${line}) -> \`[[${target}]]\``);
    }
    lines.push('');
  }

  if (orphanPages.length) {
    lines.push('## Paginas orfas (zero inbound links)');
    lines.push('');
    for (const p of orphanPages) lines.push(`- \`${p}\``);
    lines.push('');
  }

  // 5. Escrever relatorio
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true });
  } catch (_) { /* ignore */ }

  const header = [
    '---',
    'type: meta',
    'status: active',
    `created: ${new Date().toISOString()}`,
    `updated: ${new Date().toISOString()}`,
    'tags: [lint, wiki, automated]',
    '---',
    ''
  ].join('\n');

  fs.writeFileSync(output, header + lines.join('\n') + '\n', 'utf8');

  // 6. Se houver erros, append em scribe-errors.md
  const totalErrors = invalidFrontmatter.length + brokenLinks.length;
  if (totalErrors > 0) {
    const errFile = path.join(vault, 'wiki', 'meta', 'scribe-errors.md');
    try {
      fs.mkdirSync(path.dirname(errFile), { recursive: true });
      if (!fs.existsSync(errFile)) {
        const errHeader = [
          '---',
          'type: meta',
          'status: active',
          `created: ${new Date().toISOString()}`,
          `updated: ${new Date().toISOString()}`,
          'tags: [errors, lint, log]',
          '---',
          '',
          '# Scribe Errors Log',
          ''
        ].join('\n');
        fs.writeFileSync(errFile, errHeader, 'utf8');
      }
      const entry = [
        '',
        `## ${today}`,
        '',
        `- Relatorio: \`${path.relative(vault, output).replace(/\\/g, '/')}\``,
        `- Frontmatter invalido: ${invalidFrontmatter.length}`,
        `- Wikilinks quebrados: ${brokenLinks.length}`,
        `- Paginas orfas: ${orphanPages.length}`,
        ''
      ].join('\n');
      fs.appendFileSync(errFile, entry, 'utf8');
    } catch (e) {
      console.error('wiki-lint: falha ao atualizar scribe-errors.md: ' + e.message);
    }
  }

  console.log(`wiki-lint: relatorio gerado em ${output}`);
  console.log(`  paginas=${allFiles.length} frontmatter_invalido=${invalidFrontmatter.length} broken=${brokenLinks.length} orfas=${orphanPages.length}`);
}

main();
