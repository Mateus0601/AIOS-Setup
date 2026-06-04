#!/usr/bin/env node
/**
 * aios-ingest-prep.js
 *
 * Hook: SubagentStop
 *
 * Quando um subagente termina, se o subagente foi AEGIS e o veredicto foi
 * APROVADO, prepara material pra ingest do AMOSIS:
 *   1. Converte o transcript JSONL da sessao em markdown em raw/sessions/
 *   2. Cria marker PENDING-INGEST-<mission-id>.md em raw/inbox/
 *   3. Registra entry em ~/.claude/aios/ingest-pending.json
 *
 * Stdlib Node apenas. Hooks NAO devem quebrar UX — todos os erros sao logados
 * e o processo sai com exit 0.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const VAULT = path.join(HOME, 'Documents', 'COFRE -01');
const RAW_SESSIONS = path.join(VAULT, 'raw', 'sessions');
const RAW_INBOX = path.join(VAULT, 'raw', 'inbox');
const LOG_DIR = path.join(HOME, '.claude', 'aios', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'ingest-prep.log');
const LOCK_FILE = path.join(RAW_INBOX, '.lock');
const JSONL_TO_MD = path.join(HOME, '.claude', 'aios', 'lib', 'jsonl-to-markdown.js');
const MISSION_BOARD = path.join(HOME, '.claude', 'aios', 'mission-board.md');
const PENDING_JSON = path.join(HOME, '.claude', 'aios', 'ingest-pending.json');

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_) { /* ignore */ }
}

function log(msg) {
  try {
    ensureDir(LOG_DIR);
    const ts = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`, 'utf8');
  } catch (_) { /* swallow */ }
}

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
}

function readLastLines(file, n) {
  // Stdlib-only tail: ler o arquivo inteiro e pegar as ultimas n linhas.
  // JSONL de sessao normalmente cabem em memoria; se crescer, otimizamos depois.
  const txt = safeRead(file);
  if (!txt) return [];
  const lines = txt.split(/\r?\n/).filter(Boolean);
  return lines.slice(-n);
}

function parseJsonSafe(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

function findLastSubagent(lines) {
  // Percorre de tras pra frente procurando uma linha que parece ser o ultimo
  // Task/subagent: procura campos comuns como "subagent_type", "tool_name":"Task",
  // ou conteudo com "AEGIS". Formato exato do JSONL varia entre versoes do CLI,
  // entao trabalhamos com heuristicas tolerantes.
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = parseJsonSafe(lines[i]);
    if (!obj) continue;
    const flat = JSON.stringify(obj);
    if (/"Task"/.test(flat) || /subagent_type/i.test(flat)) {
      return { idx: i, obj, flat };
    }
  }
  return null;
}

function isAegisSubagent(lastSubagent, allLines) {
  if (!lastSubagent) return false;
  const flat = lastSubagent.flat || '';
  if (/AEGIS|aegis\s*\[/i.test(flat)) return true;
  // Fallback: procurar menção explícita a AEGIS nas ultimas linhas.
  const tail = allLines.slice(-50).join('\n');
  return /AEGIS|\baegis\b/i.test(tail);
}

function aegisApproved(allLines) {
  // Procura veredicto nos ultimos outputs.
  const tail = allLines.slice(-100).join('\n');

  // Anti-padrao explicito: se contiver REPROVADO/BLOQUEADO/REJECTED/REJEITADO,
  // retorna false imediatamente — mesmo que "APROVADO" apareça em outro lugar.
  if (/REPROVADO|BLOQUEADO|REJECTED|REJEITADO/i.test(tail)) return false;

  // Exige token de veredito explicito seguido de APROVADO/APPROVED.
  // Formato esperado: "verdict: approved", "veredito: APROVADO", "status: APPROVED".
  // Isso evita falso-positivo de "nao aprovado" ou menção solta de "aprovad".
  return /(?:veredito|veredicto|verdict|status)[:\s]+(APROVADO|APPROVED)/i.test(tail);
}

function readActiveMissionId() {
  const txt = safeRead(MISSION_BOARD);
  if (!txt) return null;
  // Formato esperado (flexivel): seccoes com "## <mission-id>" ou linhas com
  // "status: active" / "id: <slug>". Buscamos o primeiro bloco com status active.
  const blocks = txt.split(/\n(?=##\s)/);
  for (const b of blocks) {
    if (/status\s*:\s*active/i.test(b)) {
      const idMatch = b.match(/id\s*:\s*([a-z0-9][a-z0-9\-_]*)/i)
        || b.match(/^##\s+([a-z0-9][a-z0-9\-_]*)/mi);
      if (idMatch) return idMatch[1].trim();
    }
  }
  // Fallback: primeira secao `## <slug>`.
  const head = txt.match(/^##\s+([a-z0-9][a-z0-9\-_]*)/mi);
  return head ? head[1].trim() : null;
}

function fallbackMissionId() {
  const sid = (process.env.CLAUDE_SESSION_ID || '').slice(0, 8) || 'nosid';
  const ts = Math.floor(Date.now() / 1000);
  return `SESSION-${sid}-${ts}`;
}

function slugifyBase(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'session';
}

function acquireLock() {
  // Hook simples — usamos apenas O_EXCL (lock de arquivo atomico).
  // A API do filelock.js do AIOS e async/promise-based e nao cabe aqui.
  try {
    ensureDir(path.dirname(LOCK_FILE));
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return { type: 'file', handle: LOCK_FILE };
  } catch (_) {
    return null;
  }
}

function releaseLock(lock) {
  if (!lock) return;
  try {
    fs.unlinkSync(lock.handle);
  } catch (_) { /* ignore */ }
}

function runJsonlToMd(jsonlPath, outputPath) {
  if (!fs.existsSync(JSONL_TO_MD)) {
    log('jsonl-to-markdown.js nao encontrado em ' + JSONL_TO_MD);
    return false;
  }
  const res = spawnSync(process.execPath, [
    JSONL_TO_MD,
    '--jsonl', jsonlPath,
    '--output', outputPath
  ], { encoding: 'utf8', timeout: 20000 });
  if (res.error) {
    log('spawn jsonl-to-markdown erro: ' + res.error.message);
    return false;
  }
  if (res.status !== 0) {
    log('jsonl-to-markdown exit ' + res.status + ' stderr: ' + (res.stderr || '').slice(0, 500));
    return false;
  }
  return fs.existsSync(outputPath);
}

function writePendingMarker(missionId, sessionId, transcriptPath, rawOutPath) {
  const markerPath = path.join(RAW_INBOX, `PENDING-INGEST-${missionId}.md`);
  const nowIso = new Date().toISOString();
  const rel = path.relative(VAULT, rawOutPath).replace(/\\/g, '/');
  const body = [
    '---',
    'type: meta',
    'status: pending',
    `created: ${nowIso}`,
    `updated: ${nowIso}`,
    `mission-id: ${missionId}`,
    `session-id: ${sessionId || 'unknown'}`,
    'tags: [ingest-pending, aegis-approved]',
    '---',
    '',
    '# PENDING INGEST',
    '',
    `- mission-id: \`${missionId}\``,
    `- session-id: \`${sessionId || 'unknown'}\``,
    `- timestamp AEGIS aprovado: ${nowIso}`,
    `- raw session path: \`${rel}\``,
    `- transcript origem: \`${transcriptPath}\``,
    '- veredicto: APROVADO',
    '',
    'AMOSIS: rode `/wiki-ingest ' + missionId + '` pra processar este item.',
    ''
  ].join('\n');
  fs.writeFileSync(markerPath, body, 'utf8');
  return markerPath;
}

function appendPendingEntry(entry) {
  // Le arquivo existente, append, salva. Se inexistente, cria array com entry.
  // Best-effort: erros viram log, nao quebram o hook.
  try {
    ensureDir(path.dirname(PENDING_JSON));
    let arr = [];
    if (fs.existsSync(PENDING_JSON)) {
      const raw = safeRead(PENDING_JSON) || '[]';
      const parsed = parseJsonSafe(raw);
      if (Array.isArray(parsed)) arr = parsed;
    }
    arr.push(entry);
    const tmp = PENDING_JSON + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, PENDING_JSON);
  } catch (e) {
    log('appendPendingEntry falhou: ' + e.message);
  }
}

function main() {
  try {
    // Nota: o CLI passa o payload do hook via stdin (JSON com transcript_path etc),
    // e algumas versoes expoe CLAUDE_TRANSCRIPT_PATH no env. Tentamos ambos.
    let transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH || '';
    let sessionId = process.env.CLAUDE_SESSION_ID || '';

    if (!transcriptPath) {
      try {
        // Ler stdin sincrono (best-effort, nao bloqueia infinitamente).
        const stdinBuf = fs.readFileSync(0, 'utf8');
        if (stdinBuf) {
          const payload = parseJsonSafe(stdinBuf);
          if (payload) {
            transcriptPath = payload.transcript_path || payload.transcriptPath || '';
            sessionId = sessionId || payload.session_id || payload.sessionId || '';
          }
        }
      } catch (_) { /* sem stdin */ }
    }

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('sem transcript path utilizavel, saindo');
      process.exit(0);
      return;
    }

    const lines = readLastLines(transcriptPath, 200);
    if (!lines.length) {
      log('transcript vazio');
      process.exit(0);
      return;
    }

    const lastSub = findLastSubagent(lines);
    if (!isAegisSubagent(lastSub, lines)) {
      log('ultimo subagent nao parece AEGIS, ignorando');
      process.exit(0);
      return;
    }

    if (!aegisApproved(lines)) {
      log('AEGIS detectado mas veredicto != aprovado');
      process.exit(0);
      return;
    }

    const missionId = readActiveMissionId() || fallbackMissionId();
    const slug = slugifyBase(missionId);

    ensureDir(RAW_SESSIONS);
    ensureDir(RAW_INBOX);

    const lock = acquireLock();
    if (!lock) {
      log('lock ocupado, outro hook processando — saindo');
      process.exit(0);
      return;
    }

    try {
      const rawOutPath = path.join(RAW_SESSIONS, `${slug}.md`);

      // Evita sobrescrever: se ja existe, gera variante com timestamp.
      let finalOut = rawOutPath;
      if (fs.existsSync(finalOut)) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        finalOut = path.join(RAW_SESSIONS, `${slug}-${ts}.md`);
      }

      const ok = runJsonlToMd(transcriptPath, finalOut);
      if (!ok) {
        log('falha ao gerar markdown da sessao');
        return;
      }

      const markerPath = writePendingMarker(slug, sessionId, transcriptPath, finalOut);

      // Registra em ingest-pending.json para ULTRON/slash commands detectarem.
      appendPendingEntry({
        mission_id: slug,
        session_id: sessionId || 'unknown',
        timestamp: new Date().toISOString(),
        raw_path: finalOut,
        marker_path: markerPath,
        status: 'pending'
      });

      log(`ingest preparado: session=${finalOut} marker=${markerPath}`);
    } finally {
      releaseLock(lock);
    }

    process.exit(0);
  } catch (e) {
    log('erro inesperado: ' + (e && e.stack ? e.stack : String(e)));
    process.exit(0);
  }
}

main();
