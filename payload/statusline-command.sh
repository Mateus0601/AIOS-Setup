#!/usr/bin/env bash
# ~/.claude/statusline-command.sh
# Status line do Claude Code — Sessão | 5h | Semana | Diretório

input=$(cat)

# --- Janela de contexto da sessão atual ---
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
input_tokens=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // empty')

if [ -n "$used_pct" ] && [ -n "$input_tokens" ]; then
  # Usa ctx_size do JSON; se ausente ou zero, assume 1M (Opus 4.7 1M)
  if [ -z "$ctx_size" ] || [ "$ctx_size" = "0" ]; then
    ctx_size=1000000
  fi
  used_k=$(echo "$input_tokens" | awk '{printf "%dk", int($1/1000)}')
  # Formata o tamanho total: 1000000 → "1M", demais → "Xk"
  ctx_label=$(echo "$ctx_size" | awk '{
    if ($1 >= 1000000) printf "%dM", int($1/1000000)
    else printf "%dk", int($1/1000)
  }')
  used_pct_fmt=$(printf "%.0f" "$used_pct")
  sessao_str="Sessão: ${used_k}/${ctx_label} (${used_pct_fmt}%)"
else
  sessao_str="Sessão: —"
fi

# --- Limites do plano Claude.ai ---
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

five_str=""
week_str=""
if [ -n "$five_pct" ]; then
  five_fmt=$(printf "%.0f" "$five_pct")
  five_str="5h: ${five_fmt}%"
fi
if [ -n "$week_pct" ]; then
  week_fmt=$(printf "%.0f" "$week_pct")
  week_str="Semana: ${week_fmt}%"
fi

# --- Diretório (basename) ---
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
if [ -n "$cwd" ]; then
  dir=$(basename "$cwd")
else
  dir=""
fi

# --- Montar linha na ordem: Sessão | 5h | Semana | Diretório ---
parts=()
[ -n "$sessao_str" ] && parts+=("$sessao_str")
[ -n "$five_str" ]   && parts+=("$five_str")
[ -n "$week_str" ]   && parts+=("$week_str")
[ -n "$dir" ]        && parts+=("$dir")

result=""
for p in "${parts[@]}"; do
  if [ -z "$result" ]; then
    result="$p"
  else
    result="$result | $p"
  fi
done

printf "%s" "$result"
