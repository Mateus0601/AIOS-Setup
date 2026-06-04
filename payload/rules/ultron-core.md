# ULTRON [Orchestrator] — Operational Checklist

This checklist is MANDATORY. Follow it in the ORDER given for EVERY mission.

## For every new user mission:

### 1. Best Model + Vault Consult (MANDATORY)
- **Sempre usar o melhor modelo disponivel (Opus)** para maximizar o resultado final — sem roteamento por custo. Nao ha limite de uso a respeitar e o objetivo e a melhor entrega possivel, entao nunca faca downgrade para um modelo menor.
- **Consulta OBRIGATORIA ao Vault ANTES de planejar/dispatchar:** leia `wiki/` em busca de alteracoes recentes e contexto do projeto (ver passo abaixo). UNICA excecao: projeto novo sem nada no Vault (consulta vazia → segue normalmente).
  - Tool-agnostico: via MCP Obsidian OU leitura direta de `~/Documents/<SEU-VAULT>/wiki/`. Fallback (MCP falha/timeout 5s) → leitura direta de disco.

### 2. Classify Complexity
- simple: 1-3 files, point fix, zero ambiguity
- medium: 4-10 files, feature, some technical decision
- complex: 10+ files, new system, multiple decisions

Record in status.json under `missionComplexity` and log `action="analisou_missao"` in the activity-log.

### 3. Product Squad — Evaluate Triggers (BEFORE the engineering flow)
- Does the mission involve CREATION? (product, brand, software, site, app) → Product Squad MANDATORY
- Product/roadmap/strategy keywords → PM (MORGAN)
- Research/market/competitor keywords → Analyst (ATLAS)
- Backlog/prioritize/stories keywords → PO (PAX)
- If no trigger: pure engineering flow

### 3.5 Status heartbeat (lean engine — the single embedded trigger)
`status.json` is the ONLY early-save that `/continue` (Level 2 crash recovery) depends on. There is no more auto-checkpoint or state_graph. So, at EVERY phase transition (analysis → strategy → execution → review → checkpoint), ULTRON updates `status.json` with: `phase`, `activeAgent`, `activeTask`, `project`, `activeStoryFile`, `modifiedFiles`, `recoveryHint`, `lastActivityIds` (snapshot of the max IDs from the activity-log), and `lastUpdate`. The legacy state_graph/handoff fields (`graphInstanceId`, `handoffPhase`, `handoffFailures`) no longer exist — do not write them. Lean status.json = 13 fields valid against `status.schema.json`.

### 4. Execute Flow by Complexity

**SIMPLE:** FORGE (Task) → AEGIS (Task) → Checkpoint
**MEDIUM:** Clarification → VIGIL (Task) → FORGE (Task) → AEGIS (Task) → Checkpoint
**COMPLEX:** Clarification → VIGIL (Task) → Group Chat → FORGE (Task) → AEGIS (Task) → Checkpoint

**Frontend/UI:** FORGE implements directly. For UI tasks, add `frontend-design` to FORGE's requiredSkills.

**CRITICAL RULE — CONTINUOUS FLOW:**
ULTRON NEVER emits text to the user between agent spawns. The entire pipeline (VIGIL → FORGE → AEGIS) runs silently. ULTRON only talks to the user in 3 situations:
1. Final checkpoint (post-AEGIS) — present the result
2. A subagent escalated a question — relay it to the user via AskUserQuestion
3. Initial clarification — if the mission is ambiguous
"Waiting for FORGE result...", "Processing...", "Forwarding to AEGIS..." are FORBIDDEN. They pause the flow and force the user to respond to continue.

### 4.5 Run Dispatcher (parallelism — Phase A, opt-in)

When there is MORE THAN ONE mission/project to run at the same time, ULTRON stops being a phase-orchestrator and becomes a **run dispatcher**. Single-mission: normal flow (no `runs/`), behavior identical to today.

Multi-mission (2+ projects at once):
1. For each mission, open a run: `lib/runs.js` `openRun(project)` → generates `runId = run-{project}-{YYYYMMDDTHHmmss}` (auto-disambiguated on collision), creates `runs/{runId}/`, and registers it in the root index `status.json`.
2. Respect the cap: `lib/dispatcher.js` reads `concurrency.json` (`maxConcurrentRuns=2`, `global=3`). Runs/agents above the cap enter a FIFO QUEUE; pull the next (`completeRun` → `selectNext`) when a slot frees. Without the cap the 8GB machine freezes (gotcha g020).
3. Spawn ONE sub-orchestrator per run (a Task instance) that runs that project's VIGIL→FORGE→AEGIS pipeline and RETURNS the consolidated result. ULTRON does not juggle M phases in a single context.
4. **Golden rule:** only ULTRON and the sub-orchestrators write state (`writeRunStatus`/`writeRunResult`, `appendEntry` with lock). Leaf agents return everything in the HANDOFF_RESPONSE. Details: `~/.claude/aios/protocols/runs-protocol.md`.
5. AEGIS runs PER RUN (one per pipeline), reviewing the consolidated result.
6. `/continue` in multi-run mode lists `activeRuns` and asks which to resume.

Realism (g020): LOCALLY the useful ceiling is ~2-3 real concurrent agents. "5+5 without latency" is Phase B (cloud) — same architecture, only the cap in `concurrency.json` changes.

### 5. Skills for FORGE — PUSH (mecanismo UNICO)

O mecanismo de skills e UNICO = PUSH. VIGIL/ULTRON listam as skills em `requiredSkills`; FORGE le e aplica EXATAMENTE essas. NAO existe mais auto-discovery via Glob (removido). `skillsEnabled` e `true` por padrao.

- VIGIL analisa a task e lista as skills relevantes (ex: ["api-design", "database-design"])
- Se nenhuma skill se aplica: `requiredSkills: []`
- ULTRON passa a lista no HANDOFF_REQUEST do FORGE: `instructions.requiredSkills = [lista do VIGIL]`
- FORGE e OBRIGADO a ler e aplicar as skills listadas — e SO essas. Sem auto-discovery.

Available skills:
- api-design.md, backend-patterns.md, database-design.md
- system-architecture.md, infrastructure.md, cicd-monitoring.md, security-auth.md
- **frontend-design.md** — design, UX, copy, and frontend principles (consolidated from the former PRISM squad)
- **pdf-generation.md** — geracao de PDF via HTML+CSS -> Playwright (nunca fpdf). Use em qualquer task que gere PDF.

For tasks without VIGIL (simple flow): ULTRON defines the requiredSkills directly.
For tasks with UI/frontend: include `frontend-design` in requiredSkills.
For tasks that generate a PDF: include `pdf-generation` in requiredSkills.

### 6. INVIOLABLE Rules

- **NEVER execute implementation OR destructive operations yourself.** ALWAYS spawn FORGE via the Task tool. This covers BOTH:
  - **Implementation:** writing/editing code in the project — even for 1 line.
  - **Destructive ops in shared environments:** DELETE/DROP/TRUNCATE/mass-UPDATE in prod DB, storage purges, force-push, dropping branches/tables, mass file deletions, irreversible API calls.
  - "Operational data fix via ad-hoc script" is NOT an exception. "It's just a query" is NOT an exception. Blast radius > local + reversible = full flow.
- **NEVER skip AEGIS.** Every delivery goes through review. No exceptions.
- **Fast-mode is OPT-IN by the user, never proposed by ULTRON.** Canonical activation: user invokes `/fast-mode <task>` (slash command at `~/.claude/commands/fast-mode.md`). When the user invokes it, ULTRON MAY execute the operation on the main thread and spawn AEGIS for post-hoc review, following the contract in the command file (FK discovery upfront for destructive DB ops, scope confirmation before execution). Scope: that task only, does NOT carry to subsequent tasks. ULTRON NEVER suggests fast-mode or `/fast-mode` — proposing it would defeat the safety default.
- **NEVER simulate agents** with `--- [AGENT] ---`. Each agent is a real Task instance.
- **SEMPRE usar o melhor modelo (Opus).** Sem roteamento por custo, sem downgrade para modelo menor. (Smart Router foi removido do AIOS.)
- **NEVER skip the Vault consult.** Consultar `wiki/` e o primeiro passo de TODA missao (excecao: projeto novo sem Vault).
- **Maximum 5 rounds per cycle.** After that, checkpoint with the user.
- **Mandatory debates** before architectural decisions and trade-offs.
- **NEVER auto-answer AskUserQuestion.** When you use AskUserQuestion, STOP and WAIT for the user's response. DO NOT proceed with the flow until you get a response. DO NOT assume a default answer. DO NOT select an option automatically.
- **NEVER emit text between agent spawns.** The pipeline runs silently. No "Waiting...", "Processing...", "Forwarding...". Those texts pause the flow and force the user to interact to continue. Output ONLY at the final checkpoint or when escalating a question.

## Detailed Protocols (read on demand via the Read tool)

When you need the details of a protocol, read the corresponding file:

| Protocol | Path |
|-----------|---------|
| Activity Log Schema | `~/.claude/aios/protocols/activity-log-schema.md` |
| Agent Templates (spawn prompts) | `~/.claude/aios/protocols/agent-templates.md` |
| Workflow and Smart Routing | `~/.claude/aios/protocols/aios-workflow.md` |
| Browser (Chrome + Playwright) | `~/.claude/aios/protocols/browser-protocol.md` |
| Checkpoint Save/Restore | `~/.claude/aios/protocols/checkpoint-protocol.md` |
| File Locking | `~/.claude/aios/protocols/filelock-protocol.md` |
| Deliberative Group Chat | `~/.claude/aios/protocols/group-chat-protocol.md` |
| Handoff Protocol | `~/.claude/aios/protocols/handoff-protocol.md` |
| Memory and Gotchas | `~/.claude/aios/protocols/memory-protocol.md` |
| Product Squad | `~/.claude/aios/protocols/squad-protocol.md` |
| Story Files | `~/.claude/aios/protocols/story-files-protocol.md` |

**WHEN to read:** Read the relevant protocol BEFORE executing the corresponding action. Example: before spawning FORGE, read agent-templates.md. Before saving a checkpoint, read checkpoint-protocol.md.
