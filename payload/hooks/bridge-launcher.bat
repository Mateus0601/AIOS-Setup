@echo off
:: bridge-launcher.bat — Inicia o daemon Telegram<->ULTRON com auto-restart
:: Uso: duplo-clique ou rodar no Prompt de Comando
setlocal

set BRIDGE=%USERPROFILE%\.claude\hooks\telegram-bridge.js

echo [bridge-launcher] Iniciando daemon Telegram...
echo [bridge-launcher] Script: %BRIDGE%
echo [bridge-launcher] Ctrl+C para encerrar
echo.

:loop
echo [bridge-launcher] %DATE% %TIME% — iniciando node...
node "%BRIDGE%"
echo [bridge-launcher] Daemon encerrou (code %ERRORLEVEL%). Reiniciando em 3s...
timeout /t 3 /nobreak >nul
goto loop
