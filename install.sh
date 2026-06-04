#!/usr/bin/env bash
#
# install.sh — INSTALADOR do MOTOR AIOS (bash / Git-Bash / Linux / macOS).
#
# Copia payload/ para ~/.claude/, instala deps das libs, cria os diretorios
# scaffold vazios (.gitkeep) e os arquivos-seed (activity-log=[], status=template),
# e imprime o ONBOARDING no fim.
#
# Idempotente e NAO-destrutivo:
#  - Se ~/.claude ja existe, faz BACKUP em ~/.claude.bak-<data> ANTES de copiar.
#    A data NAO usa Date.now(); vem do argumento --date <YYYYMMDD-HHMMSS> ou,
#    se ausente, do `date` do sistema; se ate isso faltar, usa um placeholder.
#  - settings.template.json so vira settings.json se NAO existir um no destino.
#  - Arquivos-seed so sao criados se nao existirem (nao sobrescreve seu log real).
#
# Uso:
#   ./install.sh                          # instala em ~/.claude
#   ./install.sh --dest /tmp/teste        # instala num HOME alternativo (sandbox)
#   ./install.sh --date 20260604-001500   # data deterministica pro backup
#   ./install.sh --no-npm                 # pula npm install (util em sandbox/offline)

set -euo pipefail

# ─── Resolve diretorio do script ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_DIR="$SCRIPT_DIR/payload"

# ─── Args ──────────────────────────────────────────────────────────────────
DEST_HOME="$HOME"
DATE_ARG=""
RUN_NPM=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST_HOME="$2"; shift 2 ;;
    --date) DATE_ARG="$2"; shift 2 ;;
    --no-npm) RUN_NPM=0; shift ;;
    *) echo "Argumento desconhecido: $1"; exit 1 ;;
  esac
done

CLAUDE_DIR="$DEST_HOME/.claude"

# ─── Detecta SO (informativo) ──────────────────────────────────────────────
detect_os() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Linux*)  echo "Linux" ;;
    Darwin*) echo "macOS" ;;
    MINGW*|MSYS*|CYGWIN*) echo "Windows (Git-Bash)" ;;
    *) echo "desconhecido" ;;
  esac
}
OS="$(detect_os)"

echo "=== Instalador do Motor AIOS ==="
echo "SO detectado : $OS"
echo "Destino      : $CLAUDE_DIR"
echo "Payload      : $PAYLOAD_DIR"
echo

if [ ! -d "$PAYLOAD_DIR" ]; then
  echo "ERRO: payload/ nao encontrado. Rode 'node bin/aios-pack.js' primeiro ou clone o repo completo." >&2
  exit 1
fi

# ─── Backup se ja existe ~/.claude ─────────────────────────────────────────
if [ -d "$CLAUDE_DIR" ]; then
  if [ -n "$DATE_ARG" ]; then
    STAMP="$DATE_ARG"
  elif date +%Y%m%d-%H%M%S >/dev/null 2>&1; then
    STAMP="$(date +%Y%m%d-%H%M%S)"
  else
    STAMP="SEM-DATA"
  fi
  BACKUP="$CLAUDE_DIR.bak-$STAMP"
  echo "~/.claude ja existe. Fazendo backup em: $BACKUP"
  cp -a "$CLAUDE_DIR" "$BACKUP"
fi

# ─── Copia payload -> ~/.claude (merge nao-destrutivo) ─────────────────────
mkdir -p "$CLAUDE_DIR"
echo "Copiando motor para $CLAUDE_DIR ..."
# cp -R copia o CONTEUDO de payload/ para dentro de ~/.claude/
cp -R "$PAYLOAD_DIR/." "$CLAUDE_DIR/"

# ─── CLAUDE.md: bootstrap do modo ULTRON (so cria se ausente) ──────────────
# O payload traz um CLAUDE.md generico (template). Copiamos para o HOME do
# usuario (~/CLAUDE.md) SO SE ele ainda nao tiver um, para nao sobrescrever um
# CLAUDE.md proprio. Sem este arquivo o Claude Code nao entra no modo ULTRON.
CLAUDE_MD_SRC="$CLAUDE_DIR/CLAUDE.md"
CLAUDE_MD_DEST="$DEST_HOME/CLAUDE.md"
if [ -f "$CLAUDE_MD_SRC" ]; then
  if [ ! -f "$CLAUDE_MD_DEST" ]; then
    cp "$CLAUDE_MD_SRC" "$CLAUDE_MD_DEST"
    echo "CLAUDE.md criado em $CLAUDE_MD_DEST (bootstrap do modo ULTRON)."
  else
    echo "CLAUDE.md ja existe em $CLAUDE_MD_DEST — mantido (template em $CLAUDE_MD_SRC)."
  fi
fi

# ─── settings.json: so cria a partir do template se nao existir ────────────
if [ -f "$CLAUDE_DIR/settings.template.json" ]; then
  if [ ! -f "$CLAUDE_DIR/settings.json" ]; then
    cp "$CLAUDE_DIR/settings.template.json" "$CLAUDE_DIR/settings.json"
    echo "settings.json criado a partir do template (defaultMode=acceptEdits)."
  else
    echo "settings.json ja existe no destino — mantido (template disponivel em settings.template.json)."
  fi
fi

# ─── npm install nas libs (se houver package.json) ─────────────────────────
LIB_DIR="$CLAUDE_DIR/aios/lib"
if [ "$RUN_NPM" -eq 1 ] && [ -f "$LIB_DIR/package.json" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Instalando dependencias das libs (npm install em aios/lib) ..."
    ( cd "$LIB_DIR" && npm install --no-audit --no-fund ) || \
      echo "  [aviso] npm install falhou; rode manualmente: npm install --prefix \"$LIB_DIR\""
  else
    echo "  [aviso] npm nao encontrado. Instale Node 18+ e rode: npm install --prefix \"$LIB_DIR\""
  fi
else
  echo "npm install pulado (use sem --no-npm, com Node/npm instalado, para habilitar)."
fi

# ─── Scaffolds vazios (.gitkeep) ───────────────────────────────────────────
echo "Criando diretorios scaffold vazios ..."
SCAFFOLD_DIRS=(
  "aios/checkpoints" "aios/stories" "aios/handoffs" "aios/missions"
  "aios/runs" "aios/raw" "aios/logs" "aios/secrets" "aios/docs"
  "projects"
)
for d in "${SCAFFOLD_DIRS[@]}"; do
  mkdir -p "$CLAUDE_DIR/$d"
  [ -e "$CLAUDE_DIR/$d/.gitkeep" ] || : > "$CLAUDE_DIR/$d/.gitkeep"
done

# ─── Arquivos-seed (so se nao existirem) ───────────────────────────────────
echo "Criando arquivos-seed (se ausentes) ..."
ACTIVITY_LOG="$CLAUDE_DIR/aios/activity-log.json"
[ -f "$ACTIVITY_LOG" ] || printf '[]\n' > "$ACTIVITY_LOG"

STATUS_JSON="$CLAUDE_DIR/aios/status.json"
if [ ! -f "$STATUS_JSON" ]; then
  cat > "$STATUS_JSON" <<'JSON'
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
JSON
  echo "  status.json criado (template idle)."
fi

# pipeline.db do LINK: deixamos o LINK criar no primeiro uso (schema esta no manifest).
echo "  (pipeline.db do Growth sera criado pelo LINK no primeiro uso.)"

# ─── Onboarding ────────────────────────────────────────────────────────────
echo
echo "============================================================"
echo " AIOS instalado com sucesso!"
echo "============================================================"
echo
echo "VOCE ACABOU DE INSTALAR um sistema multi-agente para Claude Code:"
echo "  - 10 agentes em 3 squads (Engenharia, Produto, Growth) + 1 escriba."
echo "  - ULTRON e o orquestrador: voce conversa com ele; ele coordena o resto."
echo
echo "AGENTES:"
echo "  Engenharia: ULTRON (orquestra) - VIGIL (arquiteta) - FORGE (implementa) - AEGIS (revisa)"
echo "  Produto   : MORGAN (PRD) - PAX (backlog) - RIVER (stories) - ATLAS (pesquisa)"
echo "  Growth    : LINK (prospeccao/outreach)"
echo "  Escriba   : AMOSIS (wiki de conhecimento, opcional)"
echo
echo "FLUXOS (ULTRON classifica sozinho):"
echo "  simple  -> FORGE -> AEGIS"
echo "  medium  -> VIGIL -> FORGE -> AEGIS"
echo "  complex -> VIGIL -> Group Chat -> FORGE -> AEGIS"
echo
echo "SLASH COMMANDS principais:"
echo "  /aios  /missao <tarefa>  /continue  /fast-mode  /aios-tour  /aios-pack"
echo "  /ultron /vigil /forge /aegis  |  /pm /po /sm /analyst  |  /link-prospect"
echo
echo "9 SKILLS (o FORGE aplica conforme a tarefa):"
echo "  api-design, backend-patterns, database-design, system-architecture,"
echo "  infrastructure, cicd-monitoring, security-auth, frontend-design, pdf-generation"
echo
echo "PRIMEIROS PASSOS:"
echo "  1. Confira Node 18+:   node -v"
echo "  2. Abra o Claude Code e rode:   /aios-tour      (tour guiado completo)"
echo "  3. Ou mande logo uma tarefa:    /missao Crie uma landing page para X"
echo
echo "GUIA COMPLETO em: $CLAUDE_DIR/aios/AIOS-GUIA.md   (releia com /aios-tour)"
echo
echo "IMPORTANTE: este pacote NAO traz credenciais nem config de MCP."
echo "Configure seus MCP servers e logins normalmente. Veja o README do pacote."
echo "============================================================"
