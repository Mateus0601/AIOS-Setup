#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(raw); } catch (_) {}

  // --- ADITIVO: dumpa o JSON da statusline pro dashboard ler ---------------
  // Claude Code so entrega rate_limits/model/context_window pro comando da
  // statusLine (este stdin), NUNCA pro stdin dos hooks. Persistimos os campos
  // relevantes num arquivo que o server.js do dashboard observa via fs.watch.
  // Fire-and-forget e blindado: qualquer erro aqui NAO pode quebrar a string
  // que o terminal espera no stdout.
  try {
    const rlSnap = data.rate_limits || {};
    const cwSnap = data.context_window || {};
    const out = {
      capturedAt: new Date().toISOString(),
      model: (data.model && (data.model.display_name || data.model.id)) || data.model || null,
      rate_limits: {
        five_hour: {
          used_percentage: (rlSnap.five_hour || {}).used_percentage ?? null,
          resets_at: (rlSnap.five_hour || {}).resets_at ?? null,
        },
        seven_day: {
          used_percentage: (rlSnap.seven_day || {}).used_percentage ?? null,
          resets_at: (rlSnap.seven_day || {}).resets_at ?? null,
        },
      },
      context_window: {
        used_percentage: cwSnap.used_percentage ?? null,
        context_window_size: cwSnap.context_window_size ?? null,
        input_tokens: (cwSnap.current_usage || {}).input_tokens ?? null,
      },
      cost: data.cost || null,
      cwd: (data.workspace && data.workspace.current_dir) || data.cwd || null,
    };
    const stateDir = path.join(os.homedir(), '.claude', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const dest = path.join(stateDir, 'statusline-latest.json');
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, dest); // escrita atomica — evita JSON parcial pro watcher
  } catch (_) { /* nunca deixa o dump derrubar a statusline */ }
  // -------------------------------------------------------------------------

  // ANSI color helpers
  const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
  const dim = s => c('2', s);
  const cyan = s => c('36', s);
  const pctColor = (pct) => {
    if (pct >= 80) return c('1;31', pct + '%');  // bold red
    if (pct >= 50) return c('33', pct + '%');     // yellow
    return c('32', pct + '%');                     // green
  };

  const cw = data.context_window || {};
  const usedPct = cw.used_percentage;
  const ctxSize = cw.context_window_size;
  const inputTokens = (cw.current_usage || {}).input_tokens;

  let sessaoStr = '';
  if (inputTokens != null) {
    // Mostrar tokens desde o inicio — nao depende de used_percentage
    const size = (ctxSize && ctxSize !== 0) ? ctxSize : 1000000;
    const usedK = Math.floor(inputTokens / 1000) + 'k';
    const ctxLabel = size >= 1000000
      ? Math.floor(size / 1000000) + 'M'
      : Math.floor(size / 1000) + 'k';
    // Calcular pct: usar used_percentage se disponivel, senao calcular a partir de input_tokens
    const computedPct = (usedPct != null)
      ? usedPct
      : (ctxSize && ctxSize > 0 ? (inputTokens / ctxSize) * 100 : null);
    if (computedPct != null) {
      const pctFmt = Math.round(computedPct);
      sessaoStr = `${dim('Sessão:')} ${usedK}/${ctxLabel} (${pctColor(pctFmt)})`;
    } else {
      // Sem ctx_size conhecido — mostrar so os tokens sem percentual
      sessaoStr = `${dim('Sessão:')} ${usedK}`;
    }
  } else {
    sessaoStr = `${dim('Sessão: —')}`;
  }

  const rl = data.rate_limits || {};
  const fiveObj = rl.five_hour || {};
  const weekObj = rl.seven_day || {};

  let fiveStr = '';
  let weekStr = '';
  const resetsAt = fiveObj.resets_at;
  const nowSec = Math.floor(Date.now() / 1000);
  const fivePct = fiveObj.used_percentage;

  if (resetsAt != null && resetsAt > nowSec) {
    const delta = resetsAt - nowSec;
    let timeStr;
    if (delta >= 3600) {
      const h = Math.floor(delta / 3600);
      const m = Math.floor((delta % 3600) / 60);
      timeStr = `${h}h ${m}m`;
    } else if (delta >= 60) {
      timeStr = `${Math.floor(delta / 60)}m`;
    } else {
      timeStr = '<1m';
    }
    const pctPart = (fivePct != null) ? ` ${dim('·')} ${pctColor(Math.round(fivePct))}` : '';
    fiveStr = `${dim('Reset')} ${cyan(timeStr)}${pctPart}`;
  } else if (fivePct != null) {
    fiveStr = `${dim('5h')} ${pctColor(Math.round(fivePct))}`;
  }

  if (weekObj.used_percentage != null) {
    weekStr = `${dim('Semana')} ${pctColor(Math.round(weekObj.used_percentage))}`;
  }

  const cwdRaw = (data.workspace && data.workspace.current_dir) || data.cwd || '';
  let dir = '';
  if (cwdRaw) {
    dir = cwdRaw.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
    if (dir) dir = dim(dir);
  }

  const parts = [sessaoStr, fiveStr, weekStr, dir].filter(Boolean);
  process.stdout.write(parts.join(` ${dim('|')} `));
});
