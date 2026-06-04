<#
.SYNOPSIS
  Instalador do MOTOR AIOS para Windows PowerShell.

.DESCRIPTION
  Copia payload/ para ~/.claude/, instala deps das libs, cria diretorios
  scaffold vazios (.gitkeep) e arquivos-seed (activity-log=[], status=template),
  e imprime o ONBOARDING no fim.

  Idempotente e NAO-destrutivo:
   - Se ~/.claude ja existe, faz BACKUP em ~/.claude.bak-<data> antes de copiar.
     A data NAO usa um timestamp embutido: vem do parametro -Date; se ausente,
     do Get-Date; se nem isso, usa "SEM-DATA".
   - settings.template.json so vira settings.json se nao existir um no destino.
   - Arquivos-seed so sao criados se nao existirem.

.PARAMETER Dest
  HOME alternativo (sandbox). Default: $HOME.

.PARAMETER Date
  Stamp deterministico para o nome do backup (ex: 20260604-001500).

.PARAMETER NoNpm
  Pula o npm install.

.EXAMPLE
  ./install.ps1
  ./install.ps1 -Dest C:\temp\teste -Date 20260604-001500 -NoNpm
#>

param(
  [string]$Dest = $HOME,
  [string]$Date = "",
  [switch]$NoNpm
)

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadDir = Join-Path $ScriptDir "payload"
$ClaudeDir  = Join-Path $Dest ".claude"

# --- SO (informativo) ---
$OS = if ($IsWindows -or $env:OS -match "Windows") { "Windows" } elseif ($IsMacOS) { "macOS" } elseif ($IsLinux) { "Linux" } else { "desconhecido" }

Write-Host "=== Instalador do Motor AIOS (PowerShell) ==="
Write-Host "SO detectado : $OS"
Write-Host "Destino      : $ClaudeDir"
Write-Host "Payload      : $PayloadDir"
Write-Host ""

if (-not (Test-Path $PayloadDir)) {
  Write-Error "payload/ nao encontrado. Rode 'node bin/aios-pack.js' ou clone o repo completo."
  exit 1
}

# --- Backup se ja existe ~/.claude ---
if (Test-Path $ClaudeDir) {
  if ($Date -ne "") {
    $Stamp = $Date
  } else {
    try { $Stamp = (Get-Date).ToString("yyyyMMdd-HHmmss") } catch { $Stamp = "SEM-DATA" }
  }
  $Backup = "$ClaudeDir.bak-$Stamp"
  Write-Host "~/.claude ja existe. Fazendo backup em: $Backup"
  Copy-Item -Path $ClaudeDir -Destination $Backup -Recurse -Force
}

# --- Copia payload -> ~/.claude ---
New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null
Write-Host "Copiando motor para $ClaudeDir ..."
Copy-Item -Path (Join-Path $PayloadDir "*") -Destination $ClaudeDir -Recurse -Force

# --- CLAUDE.md: bootstrap do modo ULTRON (so cria se ausente) ---
# O payload traz um CLAUDE.md generico. Copiamos para ~/CLAUDE.md SO SE ausente,
# para nao sobrescrever um proprio. Sem ele o Claude Code nao entra no modo ULTRON.
$ClaudeMdSrc  = Join-Path $ClaudeDir "CLAUDE.md"
$ClaudeMdDest = Join-Path $Dest "CLAUDE.md"
if (Test-Path $ClaudeMdSrc) {
  if (-not (Test-Path $ClaudeMdDest)) {
    Copy-Item -Path $ClaudeMdSrc -Destination $ClaudeMdDest -Force
    Write-Host "CLAUDE.md criado em $ClaudeMdDest (bootstrap do modo ULTRON)."
  } else {
    Write-Host "CLAUDE.md ja existe em $ClaudeMdDest - mantido (template em $ClaudeMdSrc)."
  }
}

# --- settings.json: so cria a partir do template se nao existir ---
$TplPath = Join-Path $ClaudeDir "settings.template.json"
$SetPath = Join-Path $ClaudeDir "settings.json"
if (Test-Path $TplPath) {
  if (-not (Test-Path $SetPath)) {
    Copy-Item -Path $TplPath -Destination $SetPath -Force
    Write-Host "settings.json criado a partir do template (defaultMode=acceptEdits)."
  } else {
    Write-Host "settings.json ja existe no destino - mantido (template em settings.template.json)."
  }
}

# --- npm install nas libs ---
$LibDir = Join-Path $ClaudeDir "aios\lib"
if ((-not $NoNpm) -and (Test-Path (Join-Path $LibDir "package.json"))) {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "Instalando dependencias das libs (npm install em aios/lib) ..."
    Push-Location $LibDir
    try { npm install --no-audit --no-fund } catch { Write-Host "  [aviso] npm install falhou; rode: npm install --prefix `"$LibDir`"" }
    Pop-Location
  } else {
    Write-Host "  [aviso] npm nao encontrado. Instale Node 18+ e rode: npm install --prefix `"$LibDir`""
  }
} else {
  Write-Host "npm install pulado."
}

# --- Scaffolds vazios (.gitkeep) ---
Write-Host "Criando diretorios scaffold vazios ..."
$Scaffolds = @(
  "aios\checkpoints","aios\stories","aios\handoffs","aios\missions",
  "aios\runs","aios\raw","aios\logs","aios\secrets","aios\docs","projects"
)
foreach ($d in $Scaffolds) {
  $full = Join-Path $ClaudeDir $d
  New-Item -ItemType Directory -Force -Path $full | Out-Null
  $keep = Join-Path $full ".gitkeep"
  if (-not (Test-Path $keep)) { New-Item -ItemType File -Path $keep | Out-Null }
}

# --- Arquivos-seed (so se nao existirem) ---
Write-Host "Criando arquivos-seed (se ausentes) ..."
$ActivityLog = Join-Path $ClaudeDir "aios\activity-log.json"
if (-not (Test-Path $ActivityLog)) { Set-Content -Path $ActivityLog -Value "[]" -Encoding utf8 }

$StatusJson = Join-Path $ClaudeDir "aios\status.json"
if (-not (Test-Path $StatusJson)) {
  $statusTemplate = @'
{
  "schema": "aios-status-v1",
  "activeAgent": "ULTRON",
  "activeTask": "",
  "project": "",
  "phase": "idle",
  "sessionStart": "1970-01-01T00:00:00.000Z",
  "taskStart": "1970-01-01T00:00:00.000Z",
  "lastUpdate": "1970-01-01T00:00:00.000Z",
  "cycleCount": 0,
  "agentsSpawned": [],
  "activeStoryFile": "",
  "lastActivityIds": {"activities": 0, "tasks": 0, "discussions": 0, "decisions": 0},
  "modifiedFiles": [],
  "recoveryHint": "",
  "missionComplexity": ""
}
'@
  Set-Content -Path $StatusJson -Value $statusTemplate -Encoding utf8
  Write-Host "  status.json criado (template idle)."
}

Write-Host "  (pipeline.db do Growth sera criado pelo LINK no primeiro uso.)"

# --- Onboarding ---
Write-Host ""
Write-Host "============================================================"
Write-Host " AIOS instalado com sucesso!"
Write-Host "============================================================"
Write-Host ""
Write-Host "Sistema multi-agente para Claude Code: 10 agentes em 3 squads + 1 escriba."
Write-Host "ULTRON e o orquestrador: voce conversa com ele; ele coordena o resto."
Write-Host ""
Write-Host "AGENTES:"
Write-Host "  Engenharia: ULTRON - VIGIL - FORGE - AEGIS"
Write-Host "  Produto   : MORGAN - PAX - RIVER - ATLAS"
Write-Host "  Growth    : LINK    |  Escriba: AMOSIS"
Write-Host ""
Write-Host "FLUXOS:  simple->FORGE->AEGIS  |  medium->VIGIL->FORGE->AEGIS  |  complex->VIGIL->GroupChat->FORGE->AEGIS"
Write-Host ""
Write-Host "SLASH COMMANDS: /aios /missao /continue /fast-mode /aios-tour /aios-pack"
Write-Host "                /ultron /vigil /forge /aegis  /pm /po /sm /analyst  /link-prospect"
Write-Host ""
Write-Host "9 SKILLS: api-design, backend-patterns, database-design, system-architecture,"
Write-Host "          infrastructure, cicd-monitoring, security-auth, frontend-design, pdf-generation"
Write-Host ""
Write-Host "PRIMEIROS PASSOS:"
Write-Host "  1. node -v   (precisa Node 18+)"
Write-Host "  2. No Claude Code:  /aios-tour    (tour guiado completo)"
Write-Host "  3. Ou mande:        /missao Crie uma landing page para X"
Write-Host ""
Write-Host "GUIA COMPLETO em: $ClaudeDir\aios\AIOS-GUIA.md   (releia com /aios-tour)"
Write-Host ""
Write-Host "Este pacote NAO traz credenciais nem config de MCP. Configure seus MCPs e logins. Veja o README."
Write-Host "============================================================"
