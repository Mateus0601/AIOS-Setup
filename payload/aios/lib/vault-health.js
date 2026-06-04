#!/usr/bin/env node
/**
 * vault-health.js
 *
 * Relatorio de saude do vault AMOSIS / <SEU-VAULT>.
 *
 * Uso:
 *   node vault-health.js [--vault <path>] [--output <path>]
 *
 * Defaults:
 *   --vault  = ~/Documents/<SEU-VAULT>/
 *   --output = <vault>/wiki/meta/health-YYYY-WW.md
 *
 * Metricas:
 *   - Total paginas por type
 *   - Ingests da semana (parse wiki/log.md filtrando por datas ISO da semana)
 *   - Pendencias raw/inbox/PENDING-INGEST-*.md (count)
 *   - Decisoes novas na semana (raw/decisions/ + wiki/decisions/)
 *   - Paginas sem `updated:` ha 60+ dias
 *   - Tamanho raw vs wiki (MB)
 *   - Total scribe-decisions ativas
 *
 * Stdlib Node only.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const DEFAULT_VAULT = path.join(HOME, 'Documents', '<SEU-VAULT>');

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
// ISO week calculation
// ---------------------------------------------------------------------------

function isoWeek(date) {
  // Retorna { year, week } segundo ISO 8601
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Dom=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function weekStartEnd(date) {
  // Retorna [start, end] da semana ISO contendo `date` (segunda 00:00 UTC a domingo 23:59:59)
  const d = new Date(date);
  const day = d.getUTCDay() || 7;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - (day - 1));
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return [start, end];
}

// ---------------------------------------------------------------------------
// FS helpers
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
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function dirSizeMB(dir) {
  const files = walk(dir);
  let total = 0;
  for (const f of files) {
    try { total += fs.statSync(f).size; } catch (_) { /* ignore */ }
  }
  return Math.round((total / (1024 * 1024)) * 100) / 100;
}

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Frontmatter (reuso minimo do wiki-lint)
// ---------------------------------------------------------------------------

function extractFrontmatter(text) {
  if (!text || !text.startsWith('---')) return null;
  const lines = text.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return null;
  const raw = lines.slice(1, end).join('\n');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$/);
    if (m) {
      const v = m[2].trim();
      if (v && !v.startsWith('[')) {
        out[m[1]] = v.replace(/^["']|["']$/g, '');
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parse data em frontmatter (ISO8601 ou YYYY-MM-DD)
// ---------------------------------------------------------------------------

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  const vault = args.vault;
  const wikiDir = path.join(vault, 'wiki');
  const rawDir = path.join(vault, 'raw');

  if (!fs.existsSync(vault)) {
    console.error(`vault-health: vault nao encontrado: ${vault}`);
    process.exit(1);
  }

  const now = new Date();
  const { year, week } = isoWeek(now);
  const weekStr = `${year}-W${String(week).padStart(2, '0')}`;
  const output = args.output || path.join(wikiDir, 'meta', `health-${weekStr}.md`);

  const [weekStart, weekEnd] = weekStartEnd(now);

  // 1. Totais por type
  const typeCount = {};
  const staleWarns = []; // paginas com updated > 60 dias atras
  const sixtyDaysMs = 60 * 24 * 3600 * 1000;
  const wikiFiles = walk(wikiDir).filter(f => f.toLowerCase().endsWith('.md'));

  for (const f of wikiFiles) {
    const txt = safeRead(f);
    const fm = extractFrontmatter(txt || '');
    if (!fm) continue;
    const type = (fm.type || 'unknown').toLowerCase();
    typeCount[type] = (typeCount[type] || 0) + 1;

    const upd = parseDate(fm.updated);
    if (upd && (now - upd) > sixtyDaysMs) {
      staleWarns.push({
        path: path.relative(vault, f).replace(/\\/g, '/'),
        updated: fm.updated,
        ageDays: Math.floor((now - upd) / (24 * 3600 * 1000))
      });
    }
  }

  // 2. Ingests da semana via wiki/log.md
  const logFile = path.join(wikiDir, 'log.md');
  let ingestsThisWeek = 0;
  const logTxt = safeRead(logFile);
  if (logTxt) {
    // Varre linhas com data ISO (YYYY-MM-DD) e conta as que cairam na semana.
    const dateRe = /\b(\d{4}-\d{2}-\d{2})\b/g;
    const lineList = logTxt.split(/\r?\n/);
    for (const line of lineList) {
      if (!/ingest/i.test(line)) continue;
      const m = dateRe.exec(line);
      dateRe.lastIndex = 0;
      if (!m) continue;
      const d = parseDate(m[1]);
      if (d && d >= weekStart && d <= weekEnd) ingestsThisWeek++;
    }
  }

  // 3. Pendencias PENDING-INGEST-*.md
  const inboxDir = path.join(rawDir, 'inbox');
  let pendingCount = 0;
  try {
    const entries = fs.readdirSync(inboxDir);
    pendingCount = entries.filter(n => /^PENDING-INGEST-.+\.md$/i.test(n)).length;
  } catch (_) { /* inbox inexistente */ }

  // 4. Decisoes novas na semana (raw/decisions + wiki/decisions)
  let newDecisions = 0;
  const decisionDirs = [path.join(rawDir, 'decisions'), path.join(wikiDir, 'decisions')];
  for (const dd of decisionDirs) {
    const files = walk(dd).filter(f => f.toLowerCase().endsWith('.md'));
    for (const f of files) {
      const txt = safeRead(f);
      const fm = extractFrontmatter(txt || '');
      const created = fm && parseDate(fm.created);
      if (created && created >= weekStart && created <= weekEnd) newDecisions++;
    }
  }

  // 5. Tamanho raw vs wiki
  const rawSize = dirSizeMB(rawDir);
  const wikiSize = dirSizeMB(wikiDir);

  // 6. Scribe-decisions ativas
  const scribeDecisionsDir = path.join(wikiDir, 'scribe-decisions');
  let scribeActive = 0;
  const scribeFiles = walk(scribeDecisionsDir).filter(f => f.toLowerCase().endsWith('.md'));
  for (const f of scribeFiles) {
    const txt = safeRead(f);
    const fm = extractFrontmatter(txt || '');
    if (fm && String(fm.status || '').toLowerCase() === 'active') scribeActive++;
  }

  // 7. Gerar relatorio
  const lines = [];
  lines.push(`# Vault Health — ${weekStr}`);
  lines.push('');
  lines.push(`- Gerado em: ${now.toISOString()}`);
  lines.push(`- Semana ISO: ${weekStr} (${weekStart.toISOString().slice(0, 10)} a ${weekEnd.toISOString().slice(0, 10)})`);
  lines.push('');

  lines.push('## Paginas por type');
  lines.push('');
  const typeEntries = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
  for (const [t, c] of typeEntries) {
    lines.push(`- **${t}**: ${c}`);
  }
  const total = typeEntries.reduce((a, [, c]) => a + c, 0);
  lines.push(`- **TOTAL**: ${total}`);
  lines.push('');

  lines.push('## Atividade da semana');
  lines.push('');
  lines.push(`- Ingests processados: ${ingestsThisWeek}`);
  lines.push(`- Decisoes novas: ${newDecisions}`);
  lines.push(`- Pendencias no inbox: ${pendingCount}`);
  lines.push(`- Scribe-decisions ativas: ${scribeActive}`);
  lines.push('');

  lines.push('## Armazenamento');
  lines.push('');
  lines.push(`- raw/: ${rawSize} MB`);
  lines.push(`- wiki/: ${wikiSize} MB`);
  lines.push(`- Ratio raw:wiki: ${wikiSize > 0 ? (rawSize / wikiSize).toFixed(2) : 'n/a'}`);
  lines.push('');

  lines.push(`## Paginas stale (updated > 60 dias) — ${staleWarns.length}`);
  lines.push('');
  if (staleWarns.length === 0) {
    lines.push('_Nenhuma._');
  } else {
    // Limita a 30 pra nao inflar relatorio
    for (const s of staleWarns.slice(0, 30)) {
      lines.push(`- \`${s.path}\` — updated ${s.updated} (${s.ageDays} dias)`);
    }
    if (staleWarns.length > 30) {
      lines.push(`- ... e mais ${staleWarns.length - 30}`);
    }
  }
  lines.push('');

  // 8. Escrever
  try { fs.mkdirSync(path.dirname(output), { recursive: true }); } catch (_) { /* ignore */ }

  const header = [
    '---',
    'type: meta',
    'status: active',
    `created: ${now.toISOString()}`,
    `updated: ${now.toISOString()}`,
    'tags: [health, vault, automated]',
    '---',
    ''
  ].join('\n');

  fs.writeFileSync(output, header + lines.join('\n') + '\n', 'utf8');

  console.log(`vault-health: relatorio em ${output}`);
  console.log(`  total=${total} ingests_semana=${ingestsThisWeek} pendentes=${pendingCount} stale=${staleWarns.length}`);
}

main();
