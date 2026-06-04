# aios-setup — Empacotador + Instalador do Motor AIOS

Distribui **100% do motor** do AIOS (um sistema multi-agente que roda dentro do
[Claude Code](https://claude.com/claude-code)) **sem nenhum dado pessoal**.

Serve para:
- **Passar o setup pra um amigo** — ele instala e ja tem os 10 agentes, fluxos,
  skills e protocolos funcionando.
- **Restaurar tudo do zero** se voce perder o PC ou trocar de maquina.

O AIOS e: um orquestrador (**ULTRON**) que coordena 10 agentes especializados em
3 squads (Engenharia, Produto, Growth) + 1 escriba (AMOSIS), com fluxos de
trabalho, skills e protocolos definidos. Voce conversa com o ULTRON; ele faz o
resto. Guia completo: `payload/aios/AIOS-GUIA.md` (ou `/aios-tour` apos instalar).

---

## Instalacao via npm (recomendada, multiplataforma)

> **Repositorio publico.** Qualquer pessoa instala — **sem convite, sem login,
> sem git clone manual**. O npm baixa o repo **inteiro** (payload incluso)
> direto do GitHub. (O pacote nao esta publicado no registry publico do npm; a
> distribuicao e via `github:` — mas como o repo e publico, nao exige auth.)

A **mesma sequencia** funciona em **macOS, Windows e Linux**:

```bash
# 1) instala o comando global (npm baixa o repo publico do GitHub)
npm i -g github:Mateus0601/AIOS-Setup

# 2) roda o instalador (so AGORA o AIOS e copiado pro ~/.claude)
aios-mateus
```

Ou sem instalar global, direto com `npx`:

```bash
npx github:Mateus0601/AIOS-Setup
```

> **Importante:** NAO ha `postinstall` automatico — o `npm i -g` so coloca o
> comando `aios-mateus` disponivel. A instalacao do AIOS em `~/.claude` so
> acontece quando voce **roda `aios-mateus` explicitamente**. (Decisao de
> seguranca: nada toca seu `~/.claude` sem você mandar.)

Flags do `aios-mateus`: `--dest <dir>` (HOME alternativo, util pra teste),
`--no-npm` (pula o npm install das libs), `--help`.

---

## Instalacao via git clone (alternativa)

> Repositorio publico — qualquer um pode clonar, sem login.

**Linux / macOS / Git-Bash:**

```bash
git clone https://github.com/Mateus0601/AIOS-Setup.git aios-setup && cd aios-setup && bash install.sh
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/Mateus0601/AIOS-Setup.git aios-setup ; cd aios-setup ; ./install.ps1
```

O instalador (via `aios-mateus`, `install.sh` ou `install.ps1` — todos fazem o mesmo):
1. Faz **backup** de `~/.claude` se ja existir (`~/.claude.bak-<data>`).
2. Copia o `payload/` (o motor) para `~/.claude/`.
3. Roda `npm install` em `~/.claude/aios/lib/` (precisa de **Node 18+**).
4. Cria os diretorios scaffold vazios (checkpoints, stories, runs, etc.) e os
   arquivos-seed (`activity-log.json = []`, `status.json` = template idle).
5. So cria `settings.json` a partir do template **se voce ainda nao tiver um**.
6. Imprime o **onboarding** com agentes, fluxos, comandos e primeiros passos.

E **idempotente** e **nao-destrutivo**: rodar de novo nao apaga seu trabalho;
sempre faz backup antes e nunca sobrescreve seu `settings.json`/log reais.

Flags uteis: `--dest <dir>` (HOME alternativo), `--date <stamp>` (nome do backup
deterministico), `--no-npm` (pula o npm install). No PowerShell: `-Dest`, `-Date`, `-NoNpm`.

---

## O que ESTA incluido (so o motor)

| Categoria | Conteudo |
|-----------|----------|
| Cerebro | `rules/doc-roots.md`, `rules/ultron-core.md` (auto-carregados) |
| Slash commands | 19 comandos (`commands/*.md`) incl. `/aios-pack` e `/aios-tour` |
| Protocolos | 12 protocolos (`aios/protocols/`) |
| Skills | 9 skills (`aios/skills/`) |
| Schemas | validacao JSON (`aios/schemas/`) |
| Libs | paralelismo, locks, activity-log (`aios/lib/` — sem `node_modules`) |
| Engine | handoff engine em Python (`aios/core/handoff_engine.py`) |
| Squads | personas de Produto e Growth + manifests |
| Hooks | validacao, telemetria, notify (config pessoal mora em `state/`, fora) |
| Statusline | `statusline.js` + `statusline-command.sh` |
| Configs | `concurrency.json`, `plan-config.json`, `llm-router-config.json` (so `apiKeyEnv`) |
| Guia | `aios/AIOS-GUIA.md` (onboarding didatico) |

Lista exata e auditavel: **`MANIFEST.md`** (gerado pelo empacotador).

---

## O que NAO esta incluido (e por que)

| Excluido | Motivo |
|----------|--------|
| `~/.claude/.credentials.json`, caches de auth de MCP | **Segredos.** Reconfigure seus logins. |
| `~/.claude/projects/` | **Memoria pessoal** (identidade, financas) do dono original. |
| `aios/activity-log.json`, `status.json` reais | Log/estado pessoais. O instalador cria vazios. |
| `aios/checkpoints/`, `stories/`, `handoffs/`, `missions/`, `runs/`, `raw/`, `docs/` | Trabalho de projetos reais. Recriados vazios. |
| `aios/secrets/`, qualquer `secrets/` | **Segredos.** |
| `squads/growth/pipeline.db` | Dados de prospects (pessoais). O LINK cria um novo no 1o uso. |
| `history.jsonl`, `sessions/`, `state/`, `tasks/`, `cache/`, `node_modules/` | Estado de sessao/maquina; nada de motor. |
| Tokens, pixel IDs, refs de Supabase, emails, nomes | **Sanitizados** e barrados pelo gate de seguranca. |

### Sanitizacoes aplicadas
- `settings.json` → `settings.template.json`: `defaultMode` virou `acceptEdits`
  (era `bypassPermissions`); flags agressivas (`skipDangerousModePermissionPrompt`,
  `skipAutoPermissionPrompt`) removidas. Um campo `_note` explica como reativar.
- `memory_blocks.json`: blocos `human`/`summary` viraram template generico
  (`persona`/`policies` do framework mantidos).
- `gotchas.json`: mantidos so os genericos do motor (`aios-core`); removidos os
  que citavam projetos pessoais.
- Docstrings/exemplos em `handoff_engine.py` e `ingest-trigger.js`: nomes
  pessoais → `<seu nome>`; lista de projetos pessoais → lista vazia para voce
  preencher.

---

## Como reconfigurar MCPs e credenciais (nao vem no pacote)

O pacote **nao** traz nenhum token nem config de MCP server. Apos instalar:

1. **Node 18+**: confirme com `node -v`.
2. **Logins/credenciais**: o Claude Code recria `~/.claude/.credentials.json` ao
   logar. Faca login normalmente (`claude` / fluxo do app).
3. **MCP servers** (memory, playwright, supabase, filesystem, gmail, etc.):
   configure-os como voce ja faz no Claude Code. Os hooks/skills referenciam MCPs
   pelo nome, entao habilite os que quiser usar.
4. **Chaves de API para apps gerados** (ex: OpenRouter no `llm-router-config.json`):
   o arquivo usa `apiKeyEnv` (so o NOME da variavel). Defina a env var no seu
   ambiente; nenhuma chave vai no pacote.
5. **Telegram/notify** (opcional): o hook `notify.js` le config de
   `~/.claude/state/notify-config.json`, que **nao** vem no pacote. Crie o seu se
   quiser notificacoes.

---

## Re-empacotar (atualizar o pacote)

Se voce mudou seu motor e quer gerar um pacote novo:

```bash
node bin/aios-pack.js
```

Isso limpa `payload/`, recopia o allowlist sanitizado, **roda o gate de
seguranca** (aborta se achar vazamento) e regenera `MANIFEST.md`. Tambem
disponivel como slash command: `/aios-pack`.

> O gate procura nomes, emails, tokens (sk-, Bearer, JWT, ghp_, xox), pixel IDs,
> refs de Supabase, telefones BR e mais. Se achar algo fora de um placeholder
> generico, **bloqueia** e lista arquivo:linha no MANIFEST.

---

## Estrutura do repositorio

```
aios-setup/
├── package.json              # pacote npm "aios-mateus" (bin + files allowlist)
├── .npmignore                # rede de seguranca (node_modules/.git fora; payload dentro)
├── bin/
│   ├── cli.js                # instalador CROSS-PLATFORM em Node puro (= aios-mateus)
│   ├── aios-pack.js          # o empacotador (gera payload/ + MANIFEST.md)
│   └── assets/               # arquivos fixos do pacote (comandos novos + guia)
│       ├── commands/aios-pack.md
│       ├── commands/aios-tour.md
│       └── aios/AIOS-GUIA.md
├── payload/                  # o MOTOR materializado (vai pra ~/.claude/)
├── install.sh                # instalador bash/Git-Bash/Linux/macOS
├── install.ps1               # instalador Windows PowerShell
├── MANIFEST.md               # lista auditavel do que foi empacotado
└── README.md                 # este arquivo
```

> **Os tres instaladores sao equivalentes.** `aios-mateus` (Node, via npm) e o
> recomendado por ser identico nas tres plataformas. `install.sh`/`install.ps1`
> continuam disponiveis para quem prefere o git clone.
