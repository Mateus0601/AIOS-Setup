'use strict';

/**
 * notify.js — Hook de notificação Telegram para o Claude Code
 *
 * Modos (argv[2]):
 *   prompt       — UserPromptSubmit: salva timestamp da sessão
 *   stop         — Stop: dispara notificação se sessão durou mais de 15s
 *   notification — Notification: sempre dispara notificação
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const STATE_PATH = path.join(os.homedir(), '.claude', 'state', 'notify-state.json');
const MAX_SESSIONS = 20;
const MIN_DURATION_MS = 15000;

// Rate limit: cooldown por tipo (stop/notification/prompt) e global entre quaisquer envios
const RATE_LIMIT_TYPE_MS = 60000;   // 60s por tipo
const RATE_LIMIT_GLOBAL_MS = 10000; // 10s global

let fired = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escapa caracteres especiais do Markdown (parse_mode: Markdown do Telegram).
 */
function escapeMarkdown(s) {
  return String(s).replace(/([_*`\[\]])/g, '\\$1');
}

/**
 * Lê o arquivo de configuração de notificação.
 * Retorna null em caso de falha.
 */
function readNotifyConfig() {
  try {
    const cfgPath = path.join(os.homedir(), '.claude', 'state', 'notify-config.json');
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Dispara uma mensagem Telegram via Bot API.
 * Fire-and-forget: não bloqueia o hook.
 *
 * @param {string} title   - Titulo da notificacao
 * @param {string} body    - Corpo da notificacao
 * @param {string} [eventType] - Tipo do evento ('stop'|'notification'|'prompt') para rate limit
 */
function fireTelegram(title, body, eventType) {
  const cfg = readNotifyConfig();
  if (!cfg || !cfg.telegram || !cfg.telegram.bot_token || !cfg.telegram.chat_id) return;

  // ── Rate limit ──────────────────────────────────────────────────────────────
  const now = Date.now();
  const state = readState();

  // Cooldown global: 10s entre quaisquer envios
  const lastGlobal = state._lastGlobalSentAt || 0;
  if (now - lastGlobal < RATE_LIMIT_GLOBAL_MS) return;

  // Cooldown por tipo: 60s para o mesmo eventType
  if (eventType) {
    const rateLimits = state._rateLimits || {};
    const lastOfType = rateLimits[eventType] || 0;
    if (now - lastOfType < RATE_LIMIT_TYPE_MS) return;
  }
  // ── /Rate limit ─────────────────────────────────────────────────────────────

  const text = `🤖 *${escapeMarkdown(title)}*\n\n${escapeMarkdown(body)}`;
  const payload = JSON.stringify({
    chat_id: cfg.telegram.chat_id,
    text,
    parse_mode: 'Markdown',
    disable_notification: false
  });

  const url = new URL(`https://api.telegram.org/bot${cfg.telegram.bot_token}/sendMessage`);
  const req = https.request({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload, 'utf8')
    },
    timeout: 4000
  }, (res) => {
    res.on('data', () => {});
    res.on('end', () => {
      // Registrar timestamps de rate limit APENAS em sucesso (2xx)
      // Evita suprimir notificacoes legitimas (ex: permission_prompt) quando a rede falha
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const stateForUpdate = readState();
          stateForUpdate._lastGlobalSentAt = now;
          if (eventType) {
            if (!stateForUpdate._rateLimits) stateForUpdate._rateLimits = {};
            stateForUpdate._rateLimits[eventType] = now;
          }
          writeState(stateForUpdate);
        } catch (_) {}
      }
    });
  });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());

  fired = true;
  req.write(payload);
  req.end();
}

/**
 * Extrai o nome do projeto a partir do cwd do payload.
 * Ex: "~\\acme" → "acme"
 */
function projectName(cwd) {
  if (!cwd) return '';
  return path.basename(cwd);
}

/**
 * Lê o arquivo de estado, retornando objeto vazio em caso de falha.
 */
function readState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

/**
 * Persiste o objeto de estado em disco.
 * Mantém apenas as MAX_SESSIONS entradas de sessao mais recentes.
 * Chaves com prefixo '_' (ex: _rateLimits, _lastGlobalSentAt) sao preservadas intactas.
 */
function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

  // Separar chaves de controle (_*) das entradas de sessao (session_id -> timestamp)
  const metaEntries = Object.entries(state).filter(([k]) => k.startsWith('_'));
  const sessionEntries = Object.entries(state).filter(([k]) => !k.startsWith('_'));

  // Purge: ordenar sessoes por timestamp e manter so as mais recentes
  const trimmedSessions = sessionEntries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SESSIONS);

  const trimmed = Object.fromEntries([...metaEntries, ...trimmedSessions]);
  fs.writeFileSync(STATE_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
}

/**
 * Monta o título da notificação incluindo o nome do projeto (se disponível).
 */
function buildTitle(proj) {
  return proj ? `Claude Code · ${proj}` : 'Claude Code';
}

// ── Modo: prompt ──────────────────────────────────────────────────────────────

function handlePrompt(payload) {
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const state = readState();
  state[sessionId] = Date.now();
  writeState(state);
}

// ── Modo: stop ────────────────────────────────────────────────────────────────

function handleStop(payload) {
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const state = readState();
  const start = state[sessionId];

  if (!start) return; // sessão sem timestamp — não notificar

  const delta = Date.now() - start;
  if (delta < MIN_DURATION_MS) return; // sessão curta — não notificar

  const proj  = projectName(payload.cwd);
  const title = buildTitle(proj);
  fireTelegram(title, 'Tarefa concluída', 'stop');
}

// ── Modo: notification ────────────────────────────────────────────────────────

function handleNotification(payload) {
  const proj  = projectName(payload.cwd);
  const title = buildTitle(proj);

  let body = payload.notification_message || '';

  if (!body) {
    const type = payload.notification_type || '';
    if (type === 'permission_prompt') {
      body = 'Preciso de permissão';
    } else if (type === 'idle_prompt') {
      body = 'Esperando seu input';
    } else if (type === 'auth_success') {
      body = 'Autenticação OK';
    } else if (type.startsWith('elicitation_')) {
      body = 'Aguardando resposta';
    } else {
      body = 'Notificação Claude Code';
    }
  }

  fireTelegram(title, body, 'notification');
}

// ── Entry point ───────────────────────────────────────────────────────────────

try {
  const mode = process.argv[2];

  let raw = '';
  try {
    // Lê stdin de forma síncrona (buffer completo antes de processar)
    // fd 0 = stdin já aberto pelo Node.js; evita /dev/stdin que não existe no Windows
    const fd = 0;
    const chunks = [];
    const buf = Buffer.alloc(4096);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      chunks.push(buf.slice(0, bytesRead));
    }
    // Não fechar fd 0 (stdin do processo Node — fechamento causa instabilidade)
    raw = Buffer.concat(chunks).toString('utf8');
  } catch (_) {
    // Stdin pode não estar disponível em alguns contextos — continuar
  }

  let payload = {};
  try {
    if (raw.trim()) {
      payload = JSON.parse(raw);
    }
  } catch (_) {
    // JSON inválido — sair silenciosamente
    process.exit(0);
  }

  switch (mode) {
    case 'prompt':
      handlePrompt(payload);
      break;
    case 'stop':
      handleStop(payload);
      break;
    case 'notification':
      handleNotification(payload);
      break;
    default:
      // Modo desconhecido — sair silenciosamente
      break;
  }
} catch (_) {
  // Qualquer erro não tratado — sair silenciosamente, NUNCA bloquear Claude
}

if (fired) {
  setTimeout(() => process.exit(0), 3000);
} else {
  process.exit(0);
}
