#!/usr/bin/env node
/**
 * session-classifier.js
 *
 * Classifica sessoes historicas do Claude Code em ~/.claude/projects/*.jsonl
 * em 3 veredictos (INCLUI / PULA / DUVIDA) para backfill seletivo do vault AIOS.
 *
 * Criterio: wiki/meta/scribe-decisions/2026-04-23-criterio-backfill.md
 *
 * Uso:
 *   node session-classifier.js [--projects-dir <path>] [--output <path>]
 *
 * Stdlib only. Usa readline pra streaming (sessoes tem 10k+ linhas).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ============================================================================
// CLI args
// ============================================================================

function parseArgs(argv) {
  const args = {
    projectsDir: path.join(os.homedir(), '.claude', 'projects'),
    output: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--projects-dir' && argv[i + 1]) {
      args.projectsDir = argv[++i];
    } else if (a === '--output' && argv[i + 1]) {
      args.output = argv[++i];
    }
  }
  if (!args.output) {
    const today = new Date().toISOString().slice(0, 10);
    args.output = path.join(
      os.homedir(),
      'Documents',
      '<SEU-VAULT>',
      'wiki',
      'meta',
      `backfill-report-${today}.md`
    );
  }
  return args;
}

// ============================================================================
// Session analysis (streaming)
// ============================================================================

const SESSION_TIMEOUT_MS = 60 * 1000;

/**
 * Extrai metricas de uma sessao JSONL.
 * Retorna objeto com: totalMessages, substantiveMessages, firstTs, lastTs,
 * durationMs, tools (map), toolsCount, filesWritten (Set), aegisDetected,
 * firstUserPrompts (array, ate 3), invalidLines, tooLarge.
 */
async function analyzeSession(filepath) {
  const metrics = {
    totalMessages: 0,
    substantiveMessages: 0,
    firstTs: null,
    lastTs: null,
    durationMs: 0,
    tools: Object.create(null),
    toolsCount: 0,
    filesWritten: new Set(),
    aegisDetected: false,
    firstUserPrompts: [],
    invalidLines: 0,
    tooLarge: false,
    error: null,
  };

  const start = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let timer;

    const stream = fs.createReadStream(filepath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      rl.close();
      stream.destroy();
      resolve(metrics);
    };

    timer = setTimeout(() => {
      metrics.tooLarge = true;
      finish();
    }, SESSION_TIMEOUT_MS);

    rl.on('line', (line) => {
      if (!line.trim()) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        metrics.invalidLines++;
        return;
      }

      const type = obj.type;
      if (type !== 'user' && type !== 'assistant') return;

      metrics.totalMessages++;

      const ts = obj.timestamp;
      if (ts) {
        if (!metrics.firstTs || ts < metrics.firstTs) metrics.firstTs = ts;
        if (!metrics.lastTs || ts > metrics.lastTs) metrics.lastTs = ts;
      }

      const msg = obj.message;
      if (!msg) return;

      const content = msg.content;
      // Extrai texto e tool_use de content (pode ser string ou array de blocks)
      let plainText = '';
      if (typeof content === 'string') {
        plainText = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'text' && typeof block.text === 'string') {
            plainText += block.text + '\n';
          } else if (block.type === 'tool_use') {
            const name = block.name || 'unknown';
            metrics.tools[name] = (metrics.tools[name] || 0) + 1;
            metrics.toolsCount++;
            // Captura paths escritos por Write/Edit/MultiEdit/NotebookEdit
            if (
              name === 'Write' ||
              name === 'Edit' ||
              name === 'MultiEdit' ||
              name === 'NotebookEdit'
            ) {
              const inp = block.input || {};
              const p = inp.file_path || inp.path || inp.notebook_path;
              if (p && typeof p === 'string') {
                metrics.filesWritten.add(p);
              }
            }
          }
        }
      }

      const stripped = plainText.trim();
      if (stripped.length > 20) metrics.substantiveMessages++;

      // AEGIS detection — prompts de Task geralmente vivem como user/system messages
      // Heuristica: busca "AEGIS" em texto extraido
      if (!metrics.aegisDetected && /\bAEGIS\b/.test(stripped)) {
        metrics.aegisDetected = true;
      }

      // Captura ate 3 primeiros user prompts substantivos (pra DUVIDA context)
      if (
        type === 'user' &&
        metrics.firstUserPrompts.length < 3 &&
        stripped.length > 30 &&
        !stripped.startsWith('<command-')
      ) {
        const snippet = stripped.slice(0, 200).replace(/\s+/g, ' ');
        metrics.firstUserPrompts.push(snippet);
      }
    });

    rl.on('close', () => {
      if (metrics.firstTs && metrics.lastTs) {
        metrics.durationMs =
          new Date(metrics.lastTs).getTime() - new Date(metrics.firstTs).getTime();
      }
      finish();
    });

    rl.on('error', (err) => {
      metrics.error = err.message;
      finish();
    });

    stream.on('error', (err) => {
      metrics.error = err.message;
      finish();
    });
  }).then((m) => {
    m._analyzeMs = Date.now() - start;
    return m;
  });
}

// ============================================================================
// Classificador (heuristicas da scribe-decision)
// ============================================================================

function classify(m) {
  if (m.tooLarge) {
    return { verdict: 'DUVIDA', justification: 'TOO_LARGE: timeout 60s (sessao muito grande, requer analise manual)' };
  }
  if (m.error) {
    return { verdict: 'PULA', justification: `erro de leitura: ${m.error}` };
  }

  const reasons = [];

  // PULA — criterios duros
  if (m.substantiveMessages < 10) {
    return { verdict: 'PULA', justification: `apenas ${m.substantiveMessages} msgs substantivas (< 10)` };
  }
  if (m.totalMessages < 50 && m.filesWritten.size === 0) {
    return {
      verdict: 'PULA',
      justification: `curta (${m.totalMessages} msgs) e sem arquivos escritos`,
    };
  }
  if (m.toolsCount === 0) {
    return { verdict: 'PULA', justification: 'conversa pura, zero tool_use' };
  }

  // INCLUI — precisa substantive >= 50 E um dos 4 criterios
  if (m.substantiveMessages >= 50) {
    if (m.filesWritten.size >= 5) reasons.push(`${m.filesWritten.size} arquivos escritos`);
    if (m.aegisDetected) reasons.push('AEGIS detectado');
    if (m.toolsCount >= 30) reasons.push(`${m.toolsCount} tool_uses`);
    if (m.substantiveMessages >= 200) reasons.push(`${m.substantiveMessages} msgs substantivas`);

    if (reasons.length > 0) {
      return { verdict: 'INCLUI', justification: reasons.join(', ') };
    }
  }

  // DUVIDA — demais casos
  return {
    verdict: 'DUVIDA',
    justification: `${m.substantiveMessages} substantivas, ${m.filesWritten.size} files, ${m.toolsCount} tools — sem criterio INCLUI claro`,
  };
}

// ============================================================================
// Report generation
// ============================================================================

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function projectLabel(dirname) {
  // "C--Users-voce-projects-acme" -> ultimo segmento util
  const parts = dirname.split('-').filter(Boolean);
  return parts[parts.length - 1] || dirname;
}

function generateReport(projects, today) {
  const allSessions = [];
  for (const p of projects) {
    for (const s of p.sessions) allSessions.push({ project: p.label, ...s });
  }

  const total = allSessions.length;
  const inclui = allSessions.filter((s) => s.verdict === 'INCLUI');
  const pula = allSessions.filter((s) => s.verdict === 'PULA');
  const duvida = allSessions.filter((s) => s.verdict === 'DUVIDA');

  const pct = (n) => (total === 0 ? '0' : ((n / total) * 100).toFixed(1));

  let md = `---\n`;
  md += `type: meta\n`;
  md += `status: active\n`;
  md += `created: ${today}\n`;
  md += `updated: ${today}\n`;
  md += `tags:\n  - backfill\n  - report\n  - classifier\n`;
  md += `---\n\n`;
  md += `# Backfill Report — ${today}\n\n`;
  md += `## Sumario\n\n`;
  md += `- Projetos analisados: ${projects.length}\n`;
  md += `- Sessoes totais: ${total}\n`;
  md += `- INCLUI: ${inclui.length} (${pct(inclui.length)}%)\n`;
  md += `- PULA: ${pula.length} (${pct(pula.length)}%)\n`;
  md += `- DUVIDA: ${duvida.length} (${pct(duvida.length)}%)\n\n`;

  md += `## Por projeto\n\n`;
  for (const p of projects) {
    const pInclui = p.sessions.filter((s) => s.verdict === 'INCLUI').length;
    const pPula = p.sessions.filter((s) => s.verdict === 'PULA').length;
    const pDuvida = p.sessions.filter((s) => s.verdict === 'DUVIDA').length;

    md += `### ${p.label}\n`;
    md += `Sessoes: ${p.sessions.length} | INCLUI: ${pInclui} | PULA: ${pPula} | DUVIDA: ${pDuvida}\n\n`;
    md += `| Session file | Data | Msgs | Subst | Tools | Files | Dur | Veredito | Justificativa |\n`;
    md += `|---|---|---|---|---|---|---|---|---|\n`;
    // Ordena por substantivas desc
    const sorted = [...p.sessions].sort((a, b) => b.m.substantiveMessages - a.m.substantiveMessages);
    for (const s of sorted) {
      md += `| \`${s.file}\` | ${fmtDate(s.m.firstTs)} | ${s.m.totalMessages} | ${s.m.substantiveMessages} | ${s.m.toolsCount} | ${s.m.filesWritten.size} | ${fmtDuration(s.m.durationMs)} | ${s.verdict} | ${s.justification} |\n`;
    }
    md += `\n`;
  }

  md += `## Sessoes DUVIDA (requer validacao humana)\n\n`;
  if (duvida.length === 0) {
    md += `_Nenhuma._\n\n`;
  } else {
    for (const s of duvida) {
      md += `### ${s.project} / \`${s.file}\`\n`;
      md += `- Data: ${fmtDate(s.m.firstTs)} | Msgs: ${s.m.totalMessages} | Subst: ${s.m.substantiveMessages} | Tools: ${s.m.toolsCount} | Files: ${s.m.filesWritten.size}\n`;
      md += `- Justificativa: ${s.justification}\n`;
      if (s.m.firstUserPrompts.length > 0) {
        md += `- Primeiros prompts do usuario:\n`;
        for (const p of s.m.firstUserPrompts) {
          md += `  - > ${p}\n`;
        }
      }
      md += `\n`;
    }
  }

  md += `## Sessoes INCLUI sugeridas pra backfill prioritario (top 10 por substancia)\n\n`;
  const topIncluir = [...inclui]
    .sort((a, b) => b.m.substantiveMessages - a.m.substantiveMessages)
    .slice(0, 10);
  if (topIncluir.length === 0) {
    md += `_Nenhuma._\n\n`;
  } else {
    md += `| # | Projeto | Session | Data | Subst | Files | Tools | Justificativa |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    topIncluir.forEach((s, i) => {
      md += `| ${i + 1} | ${s.project} | \`${s.file}\` | ${fmtDate(s.m.firstTs)} | ${s.m.substantiveMessages} | ${s.m.filesWritten.size} | ${s.m.toolsCount} | ${s.justification} |\n`;
    });
    md += `\n`;
  }

  md += `## Metadata\n\n`;
  md += `- Gerado por: \`~/.claude/aios/lib/session-classifier.js\`\n`;
  md += `- Criterio: \`wiki/meta/scribe-decisions/2026-04-23-criterio-backfill.md\`\n`;

  return md;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);
  const today = new Date().toISOString().slice(0, 10);

  console.error(`[classifier] projects-dir: ${args.projectsDir}`);
  console.error(`[classifier] output: ${args.output}`);

  if (!fs.existsSync(args.projectsDir)) {
    console.error(`[classifier] ERRO: projects-dir nao existe`);
    process.exit(1);
  }

  const projectDirs = fs
    .readdirSync(args.projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.error(`[classifier] ${projectDirs.length} projetos encontrados`);

  const projects = [];
  let totalSessions = 0;
  const startAll = Date.now();

  for (const dirname of projectDirs) {
    const projectDir = path.join(args.projectsDir, dirname);
    let entries;
    try {
      entries = fs.readdirSync(projectDir);
    } catch (err) {
      console.error(`[classifier] skip ${dirname}: ${err.message}`);
      continue;
    }
    const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) continue;

    const project = { dirname, label: projectLabel(dirname), sessions: [] };

    for (const file of jsonlFiles) {
      const fp = path.join(projectDir, file);
      totalSessions++;
      const t0 = Date.now();
      let m;
      try {
        m = await analyzeSession(fp);
      } catch (err) {
        console.error(`[classifier] erro analyze ${file}: ${err.message}`);
        continue;
      }
      const c = classify(m);
      project.sessions.push({ file, m, verdict: c.verdict, justification: c.justification });
      const elapsed = Date.now() - t0;
      if (elapsed > 5000) {
        console.error(`[classifier] lenta: ${dirname}/${file} (${elapsed}ms, ${c.verdict})`);
      }
    }

    projects.push(project);
  }

  const totalMs = Date.now() - startAll;
  console.error(`[classifier] analise concluida em ${(totalMs / 1000).toFixed(1)}s`);

  const md = generateReport(projects, today);

  // Garante diretorio output
  const outDir = path.dirname(args.output);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.output, md, 'utf8');

  console.error(`[classifier] report escrito em ${args.output}`);
  console.error(
    `[classifier] ${projects.length} projetos, ${totalSessions} sessoes, ${(totalMs / 1000).toFixed(1)}s`
  );
}

main().catch((err) => {
  console.error(`[classifier] FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
