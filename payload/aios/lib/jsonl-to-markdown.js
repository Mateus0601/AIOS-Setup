#!/usr/bin/env node
/**
 * jsonl-to-markdown.js
 *
 * Converte um JSONL do Claude Code em Markdown estruturado com frontmatter
 * valido para ingest em `raw/sessions/` do vault AIOS.
 *
 * Uso:
 *   node jsonl-to-markdown.js --jsonl <path> --output <path>
 *
 * Dependencias: apenas stdlib (fs, path, readline).
 *
 * Comportamento:
 *  - Le JSONL linha por linha (streaming, seguro para arquivos > 10MB)
 *  - Extrai type/content/timestamp de cada entrada
 *  - Formata como markdown (headers numerados, tool blocks destacados)
 *  - Preserva code blocks (escapa triple-backticks internos)
 *  - Trunca conteudo binario/imagens com nota
 *  - Adiciona frontmatter com type: meta, status: active, tags raw/session/claude-code
 *  - Linhas invalidas viram [ERRO LINHA N: ...] sem abortar
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jsonl') args.jsonl = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printUsageAndExit(code) {
  const msg = [
    'Uso: node jsonl-to-markdown.js --jsonl <path> --output <path>',
    '',
    'Converte um arquivo JSONL do Claude Code em Markdown estruturado',
    'com frontmatter valido para ingest no vault AIOS.',
  ].join('\n');
  console.error(msg);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateFromTimestamp(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function slugFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Escapa YAML para valores de string simples (paths).
 * Se a string tiver caracteres especiais, embrulha em aspas duplas e escapa.
 */
function yamlString(s) {
  if (s == null) return '""';
  const str = String(s);
  // Caminhos Windows tem backslashes — YAML aceita, mas quoting defensivo
  if (/[:#\n"\\]/.test(str)) {
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return str;
}

/**
 * Detecta conteudo binario/imagem grande.
 * Heuristica: base64 longo (>500 chars sem espaco), data URLs, campos image/file.
 */
function isBinaryContent(content) {
  if (typeof content !== 'string') return false;
  if (/^data:image\//i.test(content)) return true;
  // base64 longo continuo
  if (/^[A-Za-z0-9+/=]{500,}$/.test(content.replace(/\s/g, ''))) return true;
  return false;
}

/**
 * Escapa triple-backticks internos para nao quebrar fences.
 * Substitui ``` por \`\`\` apenas quando for uma triple real.
 */
function safeCodeFence(s) {
  if (typeof s !== 'string') return '';
  // Nao modifica o texto, apenas escolhe um fence que nao colida
  // Se texto contem ```, usamos ~~~ como fence externo
  return s;
}

function chooseFence(s) {
  if (typeof s === 'string' && s.includes('```')) return '~~~';
  return '```';
}

/**
 * Extrai texto de um content que pode ser string, array de blocos, ou objeto.
 * Retorna { text, toolUse, toolResult } — toolUse/toolResult opcionais.
 */
function normalizeContent(raw) {
  // String simples
  if (typeof raw === 'string') return { text: raw };
  // Array (formato Anthropic messages)
  if (Array.isArray(raw)) {
    const parts = [];
    const toolUses = [];
    const toolResults = [];
    for (const block of raw) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUses.push({
          name: block.name || 'unknown',
          input: block.input ?? {},
          id: block.id || null,
        });
      } else if (block.type === 'tool_result') {
        const tc = block.content;
        let txt;
        if (typeof tc === 'string') txt = tc;
        else if (Array.isArray(tc)) {
          txt = tc.map(b => (typeof b === 'string' ? b : (b && b.text) || '')).join('\n');
        } else {
          txt = JSON.stringify(tc, null, 2);
        }
        toolResults.push({ tool_use_id: block.tool_use_id || null, text: txt });
      } else if (block.type === 'image') {
        parts.push('[binary content omitted]');
      }
    }
    return { text: parts.join('\n\n'), toolUses, toolResults };
  }
  // Objeto solto — stringify
  if (typeof raw === 'object') {
    return { text: JSON.stringify(raw, null, 2) };
  }
  return { text: String(raw ?? '') };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderEntry(entry, index) {
  const { type, timestamp } = entry;
  // Claude Code JSONL nested structure: message.content holds the actual content
  const content = entry.message?.content ?? entry.content;
  const out = [];
  const role = (type || 'unknown').toUpperCase();

  out.push(`## ${index}. [${role}]`);
  if (timestamp) out.push(`*${timestamp}*`);
  out.push('');

  const { text, toolUses, toolResults } = normalizeContent(content);

  if (text) {
    if (isBinaryContent(text)) {
      out.push('[binary content omitted]');
    } else {
      out.push(text);
    }
    out.push('');
  }

  if (Array.isArray(toolUses)) {
    for (const tu of toolUses) {
      out.push(`### Tool use: ${tu.name}`);
      const fence = chooseFence(JSON.stringify(tu.input));
      out.push(`${fence}json`);
      try {
        out.push(JSON.stringify(tu.input, null, 2));
      } catch {
        out.push(String(tu.input));
      }
      out.push(fence);
      out.push('');
    }
  }

  if (Array.isArray(toolResults)) {
    for (const tr of toolResults) {
      out.push('### Tool result');
      if (isBinaryContent(tr.text)) {
        out.push('[binary content omitted]');
      } else {
        const fence = chooseFence(tr.text);
        out.push(fence);
        out.push(tr.text);
        out.push(fence);
      }
      out.push('');
    }
  }

  return out.join('\n');
}

function renderFrontmatter({ created, updated, sourceAbs }) {
  return [
    '---',
    'type: meta',
    'status: active',
    `created: ${created}`,
    `updated: ${updated}`,
    'sources:',
    `  - ${yamlString(sourceAbs)}`,
    'tags:',
    '  - raw',
    '  - session',
    '  - claude-code',
    '---',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) printUsageAndExit(0);
  if (!args.jsonl || !args.output) {
    console.error('ERRO: --jsonl e --output sao obrigatorios.');
    printUsageAndExit(2);
  }

  const jsonlAbs = path.resolve(args.jsonl);
  const outAbs = path.resolve(args.output);

  if (!fs.existsSync(jsonlAbs)) {
    console.error(`ERRO: arquivo JSONL nao encontrado: ${jsonlAbs}`);
    process.exit(2);
  }

  const outDir = path.dirname(outAbs);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const sessionName = slugFromFilename(jsonlAbs);
  const createdDate = today();

  // Streaming read + streaming write para aguentar arquivos grandes
  const readStream = fs.createReadStream(jsonlAbs, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  // Primeira passada: coletamos rapido timestamp do primeiro evento pra frontmatter
  // e depois re-abrimos pra stream de verdade. Como o arquivo pode ser grande,
  // fazemos tudo em uma passada so: bufferizamos o header em memoria e vamos
  // escrevendo o corpo conforme lemos. Header final (frontmatter + title) e
  // gravado quando terminamos de saber o total e a primeira data.

  const tmpOut = outAbs + '.part';
  const outStream = fs.createWriteStream(tmpOut, { encoding: 'utf8' });

  let count = 0;
  let errorLines = 0;
  let firstTimestamp = null;
  let lineNo = 0;

  await new Promise((resolve, reject) => {
    outStream.on('error', reject);
    rl.on('line', (line) => {
      lineNo++;
      const trimmed = line.trim();
      if (!trimmed) return;
      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch (e) {
        errorLines++;
        outStream.write(`\n<!-- [ERRO LINHA ${lineNo}: JSON invalido — ${e.message}] -->\n`);
        return;
      }
      count++;
      if (!firstTimestamp && entry && entry.timestamp) {
        firstTimestamp = entry.timestamp;
      }
      const block = renderEntry(entry, count);
      outStream.write('\n' + block + '\n---\n');
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });

  await new Promise((resolve, reject) => {
    outStream.end((err) => (err ? reject(err) : resolve()));
  });

  const firstDate = dateFromTimestamp(firstTimestamp) || createdDate;
  const frontmatter = renderFrontmatter({
    created: createdDate,
    updated: createdDate,
    sourceAbs: jsonlAbs,
  });

  const header = [
    frontmatter,
    `# Sessao ${sessionName}`,
    '',
    `**Extraido de:** ${jsonlAbs}`,
    `**Data:** ${firstDate}`,
    `**Total de mensagens:** ${count}`,
    errorLines > 0 ? `**Linhas invalidas puladas:** ${errorLines}` : null,
    '',
    '---',
    '',
  ].filter(Boolean).join('\n');

  // Concatena header + corpo (tmpOut) em outAbs
  const body = fs.readFileSync(tmpOut, 'utf8');
  fs.writeFileSync(outAbs, header + body, 'utf8');
  fs.unlinkSync(tmpOut);

  console.log(`OK: ${count} mensagens convertidas -> ${outAbs}`);
  if (errorLines > 0) console.log(`    (${errorLines} linha(s) invalidas puladas)`);
}

main().catch((err) => {
  console.error('FALHA:', err && err.stack || err);
  process.exit(1);
});
