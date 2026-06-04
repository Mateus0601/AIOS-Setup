#!/usr/bin/env bash
# bridge-launcher.sh — Inicia o daemon Telegram<->ULTRON com auto-restart (Git Bash / WSL)
# Uso: bash ~/.claude/hooks/bridge-launcher.sh

BRIDGE="$HOME/.claude/hooks/telegram-bridge.js"

echo "[bridge-launcher] Iniciando daemon Telegram..."
echo "[bridge-launcher] Script: $BRIDGE"
echo "[bridge-launcher] Ctrl+C para encerrar"
echo ""

while true; do
  echo "[bridge-launcher] $(date '+%Y-%m-%d %H:%M:%S') — iniciando node..."
  node "$BRIDGE"
  EXIT_CODE=$?
  echo "[bridge-launcher] Daemon encerrou (code $EXIT_CODE). Reiniciando em 3s..."
  sleep 3
done
