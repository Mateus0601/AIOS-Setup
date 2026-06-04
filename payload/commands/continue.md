# Continue — Retomar Trabalho Pendente

Retome automaticamente o trabalho pendente do ultimo checkpoint, crash recovery ou story file.

## Instrucoes

Voce e ULTRON [Orquestrador]. Execute o protocolo de retomada com cascade de niveis:

### Nivel 0: Indice de Runs Ativos (paralelismo Fase A)

**So se aplica em modo multi-run.** Verifique se `~/.claude/aios/runs/` existe.

- **Se `runs/` NAO existe** (modo single-run de hoje) → pule direto para o Nivel 1.
  O fluxo abaixo permanece identico ao comportamento legado.
- **Se `runs/` existe**, leia o indice em `~/.claude/aios/status.json`:
  - Se `schema == "aios-runs-index-v1"` e `activeRuns` tem entradas:
    - **1 run ativo:** retome-o direto. Leia `~/.claude/aios/runs/{runId}/status.json`
      (estado completo daquele run — os 13 campos) e siga o protocolo dos Niveis
      1-3 USANDO ESSE arquivo de run como o `status.json` da retomada (story file,
      crash detection e fallback operam sobre o estado do run).
    - **2+ runs ativos:** liste todos com um resumo de uma linha cada
      (`runId`, `project`, `lastUpdate`, fase) e pergunte ao usuario qual retomar.
      Apos a escolha, leia `runs/{runId}/status.json` e siga os Niveis 1-3 sobre
      ele.
  - Se o indice esta vazio (`activeRuns: []`) → pule para o Nivel 1.

  Helper: `lib/runs.js` `listActiveRuns()` / `readRunStatus(runId)`.

### Nivel 1: Verificar Checkpoints (Alta Fidelidade)

Leia `~/.claude/aios/checkpoints/index.json` e verifique checkpoints com `status: "paused"`.

**Se 1 checkpoint paused:**
- Leia o checkpoint completo em `~/.claude/aios/checkpoints/{slug}.json`
- **Se `crashIndicator.sessionEndedNormally == false`:**
  - Avisar: "CRASH DETECTADO — Checkpoint de {project} pode estar em estado inconsistente."
  - Listar modifiedFiles do checkpoint
  - Pedir confirmacao ao usuario antes de restaurar
  - Se confirmado: seguir restore normal abaixo
  - Se negado: arquivar checkpoint → prosseguir para Nivel 2
- Extraia o campo `activeStoryFile` (se existir)
- Siga para "Ler Story File" abaixo

**Se 2+ checkpoints paused:**
- Liste todos os projetos com resumo de uma linha cada
- Pergunte ao usuario em qual deseja continuar
- Apos escolha, leia o checkpoint e siga para "Ler Story File"

**Se 0 checkpoints paused:**
- Prossiga para Nivel 2

#### Ler Story File (para Nivel 1)

Se o checkpoint tem `activeStoryFile`:
1. Tente ler o story file em `~/.claude/aios/stories/{activeStoryFile}`
2. **Se o arquivo nao existir ou o frontmatter estiver malformado:** tratar como se nao houvesse activeStoryFile (fallback para workStack/nextAction do checkpoint). Registrar aviso no activity-log: `action="story_file_nao_encontrado"`.
3. Parseie as tasks: conte `- [x]` (completas) vs `- [ ]` (pendentes)
4. **Se nao ha tasks pendentes (`- [ ]`):** considerar o story como `completed`, atualizar o frontmatter `status: completed`, e usar `nextAction` do checkpoint como fallback. Se o checkpoint tambem nao tem `nextAction`, informar que a missao parece concluida.
5. Identifique a proxima task pendente (menor ID com `- [ ]`)
6. Calcule progresso: `completas / total * 100`

Se NAO tem `activeStoryFile`:
1. Use o `workStack` e `nextAction` do checkpoint como fallback
2. Informe que nao ha story file associado

#### Exibir Resumo (Nivel 1)

```
CHECKPOINT RESTAURADO — Projeto: {project}
Pausado em: {savedAt}

STORY: {story title}
Progresso: {completas}/{total} tasks ({porcentagem}%)

TASKS COMPLETAS:
{lista de tasks [x] com IDs}

PROXIMA TASK:
{ID e descricao da proxima task pendente}

TASKS RESTANTES:
{lista de tasks [ ] restantes com IDs}

DECISOES ESTRATEGICAS:
{decisoes do story file, se houver}
```

Se nao tem story file:
```
CHECKPOINT RESTAURADO — Projeto: {project}
Pausado em: {savedAt}

ONDE PARAMOS:
{nextAction.description do checkpoint}

ARQUIVOS EM PROGRESSO:
{modifiedFiles do checkpoint}
```

Logue no activity-log: `action="restaurou_checkpoint"`. Siga para "Execucao".

---

### Nivel 2: Crash Detection via status.json (Media Fidelidade)

Se nenhum checkpoint paused:
1. Tente ler `~/.claude/aios/status.json`. **Se o arquivo nao existir ou contiver JSON invalido**, tratar como `phase == "idle"` e prosseguir para Nivel 3.
2. Se `phase == "idle"` → pular para Nivel 3
3. Se `phase != "idle"` → **CRASH DETECTADO**

#### Crash Recovery

a) Extrair contexto do status.json:
   - project, phase, activeTask, activeAgent
   - activeStoryFile, modifiedFiles, recoveryHint
   - lastActivityIds, lastUpdate

b) Cross-reference com activity-log.json:
   - Filtrar entries onde project == status.project
   - Se lastActivityIds existe: identificar entries adicionadas depois (id > snapshot). Estas entries serao exibidas no resumo do step e abaixo.
   - Identificar tasks com status "in_progress" sem correspondente "done"

c) Cross-reference com story file (se activeStoryFile existe):
   - Ler `~/.claude/aios/stories/{activeStoryFile}`
   - Contar tasks `[x]` vs `[ ]`
   - Identificar proxima task pendente

d) Staleness check:
   - Se lastUpdate > 24h atras: avisar que pode ser stale, perguntar se deseja limpar o estado ou continuar
   - Se lastUpdate < 24h: provavelmente crash recente

e) Exibir resumo:
```
CRASH RECOVERY — Sessao anterior terminada de forma anormal

Projeto: {project}
Fase quando crashou: {phase}
Agente ativo: {activeAgent}
Tarefa: {activeTask}
Ultimo update: {lastUpdate}

RECONSTRUCAO DO ESTADO:
- Activity-log: ultimas {N} entries do projeto
  Ultima acao: {descricao}
  Tasks in_progress: {lista ou "nenhuma"}
- Story file: {progresso}% ({completas}/{total}) [se existe]
  Proxima task: {ID} - {descricao} [se existe]
- Arquivos modificados: {lista ou "nenhum registrado"}

PROXIMA ACAO RECOMENDADA:
{recoveryHint ou inferencia da fase + story file}
```

f) Perguntar ao usuario: "Deseja continuar de onde parou?"
   - Se sim: criar checkpoint retroativo → seguir para "Execucao"
   - Se nao: resetar status.json para idle → informar "Estado limpo"

Logue no activity-log: `action="crash_recovery"`, detail com resumo do estado reconstruido.

---

### Nivel 3: Story File Fallback (Baixa Fidelidade)

Se fase == idle e nenhum checkpoint paused:
1. Verificar `~/.claude/aios/stories/` por story files com `status: in_progress` no frontmatter
2. Se encontrar, usar o mais recente como fonte de contexto
3. Se nao encontrar: "Nenhum trabalho pendente encontrado. Use `/aios` ou `/missao` para iniciar uma nova missao." → ENCERRAR

#### Se encontrou story file in_progress:

1. Ler o story file e parsear tasks
2. Calcular progresso
3. Exibir resumo:

```
RETOMANDO VIA STORY FILE — Projeto: {project}

STORY: {story title}
Progresso: {completas}/{total} tasks ({porcentagem}%)

PROXIMA TASK:
{ID e descricao da proxima task pendente}

TASKS RESTANTES:
{lista de tasks [ ] restantes com IDs}

NOTA: Nenhum checkpoint encontrado. Contexto limitado ao story file.
```

Logue no activity-log: `action="retomou_story_file"`. Siga para "Execucao".

---

### Execucao (para todos os niveis)

Apos resolver qual nivel aplicar e obter contexto:

1. Atualize status.json para refletir o ciclo ativo (phase, activeAgent, activeTask, campos de recovery)
2. Spawne FORGE [Executor] via Task tool para continuar na proxima task pendente. Passe no prompt do FORGE:
   - O contexto completo da missao
   - O path do story file para atualizacao
   - A task especifica a executar
   - Os arquivos ja modificados (do checkpoint ou status.json)
3. Apos FORGE concluir, spawne AEGIS [Revisor] para revisar a entrega
4. Siga o fluxo AIOS normal (consolidar, checkpoint, atualizar story file e activity-log)

---

$ARGUMENTS
