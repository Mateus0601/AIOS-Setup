'use strict';

/**
 * telegram-bridge.js — Daemon de long-polling Telegram <-> ULTRON/Claude
 *
 * Fluxo: getUpdates -> allowlist chat_id -> parse rota -> fila serial -> spawn claude -p -> sendMessage
 *
 * Iniciar: node ~\.claude\hooks\telegram-bridge.js
 * Reinicio automatico via bridge-launcher.bat ou bridge-launcher.sh
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

// ── Configuracao ────────────────────────────────────────────────────────────────

const HOME = os.homedir();
const CONFIG_PATH = path.join(HOME, '.claude', 'state', 'notify-config.json');
const CWD_CLAUDE = path.join(HOME);

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error('[bridge] ERRO: Nao foi possivel ler notify-config.json:', e.message);
    process.exit(1);
  }
}

const cfg = loadConfig();

if (!cfg.telegram || !cfg.telegram.bot_token || !cfg.telegram.chat_id) {
  console.error('[bridge] ERRO: notify-config.json deve ter telegram.bot_token e telegram.chat_id');
  process.exit(1);
}

const BOT_TOKEN = cfg.telegram.bot_token;
const ALLOWED_CHAT_ID = String(cfg.telegram.chat_id);

// ── Estado ──────────────────────────────────────────────────────────────────────

/**
 * Caminho absoluto do executavel claude, resolvido uma unica vez via where/which.
 * null = ainda nao resolvido; false = nao encontrado.
 * @type {string|null|false}
 */
let resolvedClaudePath = null;

/**
 * Resolve o caminho absoluto de 'claude' no PATH usando where (Windows) ou which (POSIX).
 * Resultado eh cacheado. Nunca usa shell=true.
 * @returns {string|false} caminho absoluto ou false se nao encontrado
 */
function resolveClaudePath() {
  if (resolvedClaudePath !== null) return resolvedClaudePath;

  const isWindows = process.platform === 'win32';
  const finder = isWindows ? 'where' : 'which';

  const r = spawnSync(finder, ['claude'], { encoding: 'utf8', shell: false, timeout: 5000 });
  if (r.error || r.status !== 0 || !r.stdout || !r.stdout.trim()) {
    resolvedClaudePath = false;
    return false;
  }

  const lines = r.stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // No Windows, `where` pode retornar .cmd, .exe, ou sem extensao. Prefira .cmd ou .exe.
  if (isWindows) {
    const preferred = lines.find(l => /\.(cmd|exe)$/i.test(l));
    resolvedClaudePath = preferred || lines[0];
  } else {
    resolvedClaudePath = lines[0];
  }

  console.log('[bridge] Caminho de claude resolvido:', resolvedClaudePath);
  return resolvedClaudePath;
}

/** chatId -> string sessionId (UUID do claude --resume) */
const sessionMap = new Map();

/** chatId -> Promise (fila serial) */
const queueMap = new Map();

let lastUpdateId = 0;

// Slash commands de agentes: passados diretamente para claude -p
const AGENT_COMMANDS = new Set([
  'forge', 'aegis', 'vigil', 'pm', 'po', 'sm', 'analyst', 'link', 'ultron',
  'missao', 'continue', 'implementacao', 'aios', 'fast-mode', 'link-prospect'
]);

// ── HTTP helpers ────────────────────────────────────────────────────────────────

/**
 * GET https://api.telegram.org/bot{token}/{method}?{params}
 */
function telegramGet(method, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const options = {
      method: 'GET',
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}${qs ? '?' + qs : ''}`,
      timeout: 30000
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse error: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout em ' + method)); });
    req.end();
  });
}

/**
 * POST sendMessage — fire-and-forget (nao bloqueia o daemon).
 * Trunca automaticamente em 4096 chars (limite Telegram).
 */
function sendMessage(chatId, text) {
  const MAX = 4000;
  const chunks = [];
  // Dividir em pedacos de MAX chars
  for (let i = 0; i < text.length; i += MAX) {
    chunks.push(text.slice(i, i + MAX));
  }
  chunks.forEach((chunk, idx) => {
    const suffix = chunks.length > 1 ? ` [${idx + 1}/${chunks.length}]` : '';
    const body = JSON.stringify({
      chat_id: chatId,
      text: chunk + suffix,
      parse_mode: 'Markdown'
    });
    const req = https.request({
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      },
      timeout: 8000
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => {});
    });
    req.on('error', (e) => console.error('[bridge] sendMessage erro:', e.message));
    req.on('timeout', () => req.destroy());
    req.write(body);
    req.end();
  });
}

// ── Spawn claude -p ─────────────────────────────────────────────────────────────

/**
 * Executa claude -p com o prompt dado e retorna { sessionId, result }.
 *
 * Estrategia de escaping: shell:false + array de args para evitar injection do texto do usuario.
 * O prompt e passado como argumento direto ao processo — sem interpretacao de shell.
 * Funciona em Windows porque Claude CLI aceita args posicionais normalmente.
 */
function runClaude(prompt, chatId) {
  return new Promise((resolve) => {
    const existingSession = sessionMap.get(chatId);
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
    if (existingSession) {
      args.push('--resume', existingSession);
    }

    console.log('[bridge] spawn claude', args.slice(0, 4).join(' '), '...');

    // Resolve o caminho absoluto de claude (cache, shell:false, sem injection)
    const claudeExe = resolveClaudePath();
    if (claudeExe === false) {
      // Executavel nao encontrado — nunca usar shell:true com input do usuario
      sendMessage(chatId, "Erro: executável 'claude' não encontrado no PATH. Verifique a instalação.");
      resolve({ sessionId: null, result: "Erro: executável 'claude' não encontrado no PATH." });
      return;
    }

    // shell:false com path absoluto evita injection e nao depende do PATH do shell
    let child;
    try {
      child = spawn(claudeExe, args, {
        cwd: CWD_CLAUDE,
        shell: false,       // NUNCA shell:true — o prompt do usuario nunca passa pelo shell
        timeout: 300000,    // 5 min max
        windowsHide: true
      });
    } catch (spawnErr) {
      resolve({ sessionId: null, result: 'Erro ao iniciar claude: ' + spawnErr.message });
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    let capturedSessionId = null;
    let resultText = '';

    child.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf8'); });

    child.on('close', (code) => {
      // Processar linhas do stream-json acumulado
      const lines = stdoutBuf.split('\n').filter(l => l.trim());
      for (const line of lines) {
        let obj;
        try { obj = JSON.parse(line); } catch (_) { continue; }

        // session_id aparece no type:system subtype:init
        if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
          capturedSessionId = obj.session_id;
        }

        // Resultado final
        if (obj.type === 'result') {
          if (obj.result) {
            resultText = obj.result;
          }
        }
      }

      // Fallback: se nao capturou result pelo campo result, tenta assistant text
      if (!resultText) {
        for (const line of lines) {
          let obj;
          try { obj = JSON.parse(line); } catch (_) { continue; }
          if (obj.type === 'assistant' && Array.isArray(obj.message && obj.message.content)) {
            for (const block of obj.message.content) {
              if (block.type === 'text' && block.text) {
                resultText = block.text; // ultimo assistant text
              }
            }
          }
        }
      }

      if (!resultText && stderrBuf) {
        console.error('[bridge] stderr:', stderrBuf.slice(0, 500));
      }

      if (!resultText) {
        if (code !== 0) {
          resultText = `Erro na execucao (code ${code}). Tente /new.`;
        } else {
          resultText = '(sem resposta)';
        }
      }

      resolve({ sessionId: capturedSessionId, result: resultText });
    });

    child.on('error', (err) => {
      resolve({ sessionId: null, result: 'Erro ao executar claude: ' + err.message });
    });
  });
}

// ── Processamento de mensagem ───────────────────────────────────────────────────

async function executeMsg(msg) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  if (!text) return;

  // Roteamento
  if (text.startsWith('/')) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === 'new' || cmd === 'reset') {
      sessionMap.delete(chatId);
      sendMessage(chatId, '✅ Nova sessão iniciada.');
      return;
    }

    if (cmd === 'status') {
      const qLen = queueMap.has(chatId) ? 1 : 0; // fila e Promise chain, nao ha contador direto
      sendMessage(chatId, `ℹ️ Bridge ativa. Session: ${sessionMap.has(chatId) ? sessionMap.get(chatId).slice(0, 8) + '...' : 'nenhuma'}. Pronto.`);
      return;
    }

    if (cmd === 'help') {
      sendMessage(chatId,
        '*Bridge AIOS — Comandos:*\n' +
        '/new — Inicia nova sessão\n' +
        '/status — Status da bridge\n' +
        '/forge /aegis /vigil /pm /po /sm ... — Ativa agente\n' +
        'Mensagem normal → ULTRON'
      );
      return;
    }

    // Comando de agente conhecido OU comando desconhecido → passa texto completo pro claude
    sendMessage(chatId, '⏳ Processando...');
    const { sessionId, result } = await runClaude(text, chatId);
    if (sessionId) sessionMap.set(chatId, sessionId);
    sendMessage(chatId, result || '(sem resposta)');
    return;
  }

  // Mensagem normal → ULTRON
  sendMessage(chatId, '⏳ Processando...');
  const { sessionId, result } = await runClaude(text, chatId);
  if (sessionId) sessionMap.set(chatId, sessionId);
  sendMessage(chatId, result || '(sem resposta)');
}

function enqueue(msg) {
  const chatId = String(msg.chat.id);
  const prev = queueMap.get(chatId) || Promise.resolve();
  const next = prev.then(() => executeMsg(msg)).catch((err) => {
    console.error('[bridge] executeMsg erro:', err);
    try { sendMessage(chatId, 'Erro interno. Tente /new.'); } catch (_) {}
  }).finally(() => {
    // Limpa a entrada do map apos resolucao para evitar leak de memoria
    if (queueMap.get(chatId) === next) queueMap.delete(chatId);
  });
  queueMap.set(chatId, next);
}

// ── Loop principal de long-polling ──────────────────────────────────────────────

async function pollLoop() {
  console.log('[bridge] Iniciando long-polling. Chat permitido:', ALLOWED_CHAT_ID);

  // Validar token antes de comecar
  try {
    const me = await telegramGet('getMe', {});
    if (me.ok) {
      console.log('[bridge] Bot autenticado:', me.result.username);
    } else {
      console.error('[bridge] getMe falhou:', JSON.stringify(me));
    }
  } catch (e) {
    console.warn('[bridge] getMe erro (continuando):', e.message);
  }

  while (true) {
    try {
      const params = {
        timeout: '25',
        offset: String(lastUpdateId + 1),
        allowed_updates: JSON.stringify(['message'])
      };
      const data = await telegramGet('getUpdates', params);

      if (!data.ok) {
        console.error('[bridge] getUpdates nao-ok:', JSON.stringify(data).slice(0, 300));
        await sleep(5000);
        continue;
      }

      for (const update of (data.result || [])) {
        if (update.update_id > lastUpdateId) {
          lastUpdateId = update.update_id;
        }

        const msg = update.message;
        if (!msg || !msg.text) continue;

        // Allowlist: ignorar silenciosamente chats nao permitidos
        if (String(msg.chat.id) !== ALLOWED_CHAT_ID) continue;

        enqueue(msg);
      }
    } catch (err) {
      console.error('[bridge] Erro no loop de polling:', err.message);
      await sleep(5000);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Inicializacao ───────────────────────────────────────────────────────────────

pollLoop().catch((err) => {
  console.error('[bridge] Erro fatal:', err);
  process.exit(1);
});
