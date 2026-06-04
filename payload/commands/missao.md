# Nova Missao AIOS

Inicie uma nova missao no sistema AIOS. Crie o mission-board e o scaffolding completo do projeto.

## Instrucoes

### Fase 0 — Project Scaffolding (OBRIGATORIO)

Antes de qualquer analise ou planejamento, ULTRON DEVE criar a infraestrutura base do projeto:

**1. Diretorio do projeto** (OBRIGATORIO):
   - Criar em `~/projects/{nome-do-projeto}`
   - Este e o diretorio padrao para TODOS os projetos novos. Sem excecao.
   - O nome do diretorio deve ser kebab-case (ex: `meu-projeto`, `synth-v2`)

**2. `.gitignore` (OBRIGATORIO):**
   - Criar na raiz do projeto usando o template abaixo
   - Adaptar as secoes conforme a stack detectada no objetivo

**3. `.env` (OBRIGATORIO):**
   - Criar na raiz do projeto usando o template abaixo
   - Preencher as secoes com placeholders vazios baseados na stack do projeto
   - NUNCA commitar valores reais — apenas placeholders

**4. Outros arquivos base conforme a stack:**

| Stack Detectada | Arquivos Adicionais |
|-----------------|---------------------|
| Node.js / TypeScript | `package.json`, `tsconfig.json` |
| Python | `requirements.txt` ou `pyproject.toml`, `venv/` no .gitignore |
| Monorepo | `package.json` com workspaces |
| Cloudflare Workers | `wrangler.toml` |
| Docker | `Dockerfile`, `docker-compose.yml`, `.dockerignore` |
| Qualquer projeto | `README.md` (minimo: titulo + descricao de 1 linha) |

### Fase 1 — Mission Board

5. Crie um arquivo `mission-board.md` na raiz do projeto usando o template de `~/.claude/aios/mission-board.md`
6. Preencha com o objetivo, data de hoje, status "Planejamento", ciclo 1
7. Se o projeto for complexo (software, sistema), crie tambem um PRD

### Fase 2 — Planejamento

8. Quebre o objetivo em tarefas iniciais com agentes responsaveis
9. Apresente o mission-board preenchido ao usuario para aprovacao
10. Liste os arquivos criados no scaffolding para confirmacao

---

## Template .gitignore (adaptar conforme stack)

```gitignore
# Dependencies
node_modules/
.pnpm-store/
__pycache__/
venv/
.venv/

# Build outputs
dist/
build/
.output/
.astro/
*.pyc

# Environment (NUNCA commitar)
.env
.env.local
.env.*.local
.dev.vars

# Cloudflare
.wrangler/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db
desktop.ini

# Logs
*.log
npm-debug.log*

# Testing
coverage/
.nyc_output/
.pytest_cache/
htmlcov/

# Temporary
tmp/
temp/
*.tmp

# Secrets (NUNCA commitar)
*.pem
*.key
secrets.json
credentials.json

# Playwright / Browser automation
.playwright-cli/
```

## Template .env (adaptar conforme stack)

```env
# ============================================================
# [NOME DO PROJETO] — Environment Variables
# ============================================================
# Preencha com valores reais. NUNCA commite este arquivo.
# O .gitignore ja exclui .env do repositorio.
# ============================================================

# ─── App ─────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000

# ─── Database ────────────────────────────────────────────────
# DATABASE_URL=

# ─── API Keys ────────────────────────────────────────────────
# (adicionar conforme servicos usados no projeto)

# ─── Auth ────────────────────────────────────────────────────
# JWT_SECRET=
# SESSION_SECRET=
```

**IMPORTANTE:** Os templates acima sao BASE. ULTRON deve adaptar:
- Remover secoes irrelevantes (ex: sem Database se nao usa DB)
- Adicionar secoes especificas (ex: STRIPE_KEY se usa Stripe)
- Adicionar variaveis conforme detectado no objetivo do usuario

---

## Objetivo da Missao:

$ARGUMENTS
