/**
 * AIOS LLM Client — Template para apps gerados pelo FORGE
 *
 * USO: FORGE copia este template para qualquer app que precise de chamadas LLM.
 * O app chama llm() com o prompt e o tier desejado. O router escolhe o modelo.
 *
 * SETUP:
 * 1. Copiar este arquivo para o projeto
 * 2. Definir variável de ambiente: OPENROUTER_API_KEY=sk-or-...
 * 3. (Opcional) Copiar llm-router-config.json para o projeto para customizar
 *
 * EXEMPLOS:
 *   const { llm } = require('./llm-client');
 *
 *   // Task simples → DeepSeek ($0.001)
 *   const classified = await llm('Classifique este lead: João, 35, CEO', 'fast');
 *
 *   // Task intermediária → Sonnet
 *   const draft = await llm('Escreva um email marketing sobre AIOS', 'balanced');
 *
 *   // Task crítica → Opus
 *   const copy = await llm('Escreva copy de vendas para landing page AIOS', 'quality');
 *
 *   // Auto-detect (usa fast por padrão)
 *   const result = await llm('Extraia o nome e email deste texto: ...');
 */

const fs = require('fs');
const path = require('path');

// --- Config ---

const DEFAULT_CONFIG = {
  provider: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY'
  },
  tiers: {
    fast: { model: 'deepseek/deepseek-chat-v3-0324', maxTokens: 4096 },
    balanced: { model: 'anthropic/claude-sonnet-4', maxTokens: 8192 },
    quality: { model: 'anthropic/claude-opus-4', maxTokens: 16384 }
  },
  defaults: { tier: 'fast', temperature: 0.7, maxRetries: 2 }
};

function loadConfig() {
  // Tenta carregar config local do projeto, senão usa default
  const localPath = path.join(process.cwd(), 'llm-router-config.json');
  const aiosPath = path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.claude', 'aios', 'llm-router-config.json'
  );

  for (const p of [localPath, aiosPath]) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch { /* fallback */ }
  }
  return DEFAULT_CONFIG;
}

// --- Core ---

/**
 * Faz uma chamada LLM via OpenRouter
 * @param {string} prompt - O prompt para enviar
 * @param {'fast'|'balanced'|'quality'} [tier] - Tier de qualidade/custo
 * @param {object} [options] - Opções adicionais
 * @param {string} [options.systemPrompt] - System prompt
 * @param {number} [options.temperature] - Temperature (0-2)
 * @param {number} [options.maxTokens] - Max tokens de resposta
 * @param {object[]} [options.messages] - Mensagens completas (ignora prompt se fornecido)
 * @returns {Promise<{content: string, model: string, tier: string, usage: object}>}
 */
async function llm(prompt, tier, options = {}) {
  const config = loadConfig();
  const selectedTier = tier || config.defaults?.tier || 'fast';
  const tierConfig = config.tiers[selectedTier];

  if (!tierConfig) {
    throw new Error(`Tier "${selectedTier}" não encontrado. Use: fast, balanced, quality`);
  }

  const apiKey = process.env[config.provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `API key não encontrada. Defina: export ${config.provider.apiKeyEnv}=sk-or-...\n` +
      `Obtenha em: https://openrouter.ai/keys`
    );
  }

  const messages = options.messages || [
    ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
    { role: 'user', content: prompt }
  ];

  const body = {
    model: tierConfig.model,
    messages,
    temperature: options.temperature ?? config.defaults?.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? tierConfig.maxTokens
  };

  const maxRetries = config.defaults?.maxRetries ?? 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${config.provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://aios.local',
          'X-Title': 'AIOS App'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${err}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];

      return {
        content: choice?.message?.content || '',
        model: data.model || tierConfig.model,
        tier: selectedTier,
        usage: data.usage || {}
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * Helper: chama múltiplos prompts em paralelo
 * @param {Array<{prompt: string, tier?: string, options?: object}>} calls
 * @returns {Promise<Array<{content: string, model: string, tier: string, usage: object}>>}
 */
async function llmBatch(calls) {
  return Promise.allSettled(
    calls.map(c => llm(c.prompt, c.tier, c.options || {}))
  ).then(results =>
    results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message })
  );
}

/**
 * Helper: pipeline de refinamento (fast → quality)
 * Usa modelo barato para rascunho, modelo caro para refinar
 * @param {string} prompt - Prompt inicial
 * @param {string} [refineInstruction] - Instrução de refinamento
 * @returns {Promise<{draft: string, final: string, totalUsage: object}>}
 */
async function llmRefine(prompt, refineInstruction) {
  const draft = await llm(prompt, 'fast');

  const refinePrompt = refineInstruction
    ? `${refineInstruction}\n\nTexto para refinar:\n${draft.content}`
    : `Refine e melhore o seguinte texto, mantendo o sentido original mas elevando a qualidade da escrita:\n\n${draft.content}`;

  const refined = await llm(refinePrompt, 'quality');

  return {
    draft: draft.content,
    final: refined.content,
    totalUsage: {
      draftTokens: draft.usage,
      refineTokens: refined.usage
    }
  };
}

module.exports = { llm, llmBatch, llmRefine, loadConfig };
