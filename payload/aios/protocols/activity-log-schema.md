# Activity Log — Schema and Protocol

The file `~/.claude/aios/activity-log.json` is the central record of EVERYTHING the agents do. It feeds the AIOS Dashboard.

## File Format

```json
{
  "activities": [
    {"id": 1, "agent": "ultron", "action": "distribuiu_tarefas", "detail": "...", "timestamp": "ISO8601", "project": "name"}
  ],
  "discussions": [
    {"id": 1, "from": "vigil", "to": "forge", "topic": "...", "message": "...", "timestamp": "ISO8601", "project": "name"}
  ],
  "decisions": [
    {"id": 1, "agent": "ultron", "decision": "...", "justification": "...", "alternatives": ["..."], "timestamp": "ISO8601", "project": "name"}
  ],
  "tasks": [
    {"id": 1, "task": "...", "assignedBy": "ultron", "assignedTo": "forge", "status": "pending|in_progress|done|blocked", "priority": "alta|media|baixa", "timestamp": "ISO8601", "completedAt": null, "project": "name"}
  ]
}
```

## When to Log (MANDATORY)

### activities — Every time an agent DOES something:
- ULTRON [Orchestrator]: analyze mission, break tasks, dispatch, resolve conflict, checkpoint
- VIGIL [Strategist]: validate approach, analyze trade-offs, define architecture, prioritize, question
- FORGE [Executor]: implement feature, create file, fix bug, install dependency, run test
- FORGE [Executor] — ReACT actions (logged by ULTRON when parsing FORGE's response):
  - `action="react_iteration"` — FORGE ran an internal self-correction iteration (detail: "Iteracao {N}: issue={problem}, fix={correction}")
  - `action="react_observe_passed"` — FORGE completed OBSERVE successfully (detail: "OBSERVE passou na iteracao {N}. {N} self-corrections feitas")
  - `action="react_escalated"` — FORGE identified an architectural problem and escalated (detail: "Problema arquitetural detectado na iteracao {N}: {description}. Escalando para AEGIS.")
- AEGIS [Reviewer]: review code, find bug, approve/reject, suggest improvement
- Morgan [PM]: create PRD, define roadmap, make strategic decision, delegate to squad. (Details in "Product Squad — Action Logging")
- Pax [PO]: prioritize backlog, validate requirements, define acceptance criteria. (Details in "Product Squad — Action Logging")
- River [SM]: create story file, break epic into stories, record impediments. (Details in "Product Squad — Action Logging")
- Atlas [Analyst]: market research, competitive analysis, generate report. (Details in "Product Squad — Action Logging")

### discussions — Every time an agent OPINES, QUESTIONS, or DISAGREES:
- VIGIL [Strategist] questions FORGE [Executor]'s approach
- AEGIS [Reviewer] critiques a delivery and FORGE [Executor] replies
- ULTRON [Orchestrator] resolves a conflict between agents
- Any debate over a technical decision

### decisions — Every non-trivial decision:
- Choice of technology, architecture, or pattern
- Conflict resolution
- Trade-off chosen
- Task prioritization

### tasks — Every task created by ULTRON [Orchestrator]:
- On creation: status "pending"
- On start: status "in_progress"
- On completion: status "done" + completedAt
- On block: status "blocked"

## How to Log
Read the file, add the entry with an incremental ID, write it back. Use the `project` field with the current project name.

**IMPORTANT — File Locking:** Every write to activity-log.json MUST use `readModifyWrite` from the file-locking module (`~/.claude/aios/lib/filelock.js`) to prevent corruption from concurrent access. Full protocol in `~/.claude/aios/protocols/filelock-protocol.md`.

```javascript
const path = require('path');
const { readModifyWrite } = require(path.join(require('os').homedir(), '.claude', 'aios', 'lib', 'filelock'));

await readModifyWrite(activityLogPath, (data) => {
  data.activities.push({ id: maxId + 1, agent, action, detail, timestamp, project });
  return data;
}, { agent: 'agent-name' });
```

## Schema Validation
Validation schemas live in `~/.claude/aios/schemas/`. Use the validator: `node ~/.claude/aios/validation/validate.js ~/.claude/aios/activity-log.json`

## Valid Enums (agents)
- ultron, vigil, forge, aegis, system
- pm, po, sm, analyst (Product Squad)
- (Legacy, backward compat): orchestrator, strategist, executor, reviewer

## Valid Enums (status)
- pending, in_progress, done, blocked

## Valid Enums (priority)
- baixa, media, alta, critica

## status.json — Real-Time Snapshot

The file `~/.claude/aios/status.json` is a snapshot of the current state of the AIOS system, kept up to date by ULTRON [Orchestrator] throughout each cycle.

### Update Protocol (MANDATORY)

**When starting a work cycle**, ULTRON MUST update:
```json
{
  "activeAgent": "ultron",
  "activeTask": "description of the current task",
  "project": "project-name",
  "phase": "analysis",
  "sessionStart": "<ISO8601 timestamp if a new session>",
  "taskStart": "<current ISO8601 timestamp>",
  "lastUpdate": "<current ISO8601 timestamp>",
  "cycleCount": "<increment by 1>",
  "agentsSpawned": [],
  "activeStoryFile": null,
  "lastActivityIds": {"activities": 0, "tasks": 0, "discussions": 0, "decisions": 0},
  "modifiedFiles": [],
  "recoveryHint": "ULTRON analyzing mission: <brief description>"
}
```

**When spawning each agent**, append to the `agentsSpawned` array and update `activeAgent`, `phase`, and `recoveryHint`.

**When ending the cycle** (checkpoint with the user or completed task), ULTRON MUST reset:
```json
{
  "activeAgent": null,
  "activeTask": null,
  "phase": "idle",
  "taskStart": null,
  "lastUpdate": "<current ISO8601 timestamp>",
  "agentsSpawned": [],
  "activeStoryFile": null,
  "lastActivityIds": null,
  "modifiedFiles": [],
  "recoveryHint": null
}
```

### Early Save — Recovery Fields

status.json works as a low-cost "breadcrumb". Recovery fields are updated alongside the existing fields at each phase transition, with no extra overhead:

- `activeStoryFile`: Populated as soon as VIGIL creates the story file. Contains only the filename (e.g. `story-20260218T170000.md`), not the full path.
- `lastActivityIds`: Snapshot of the max IDs for each section of activity-log.json. Updated on every activity-log write. Enables detecting activities that occurred after a crash.
- `modifiedFiles`: Array of file paths modified in this cycle. Accumulates throughout the cycle (append, not overwrite). Reset at the start of a new cycle.
- `recoveryHint`: Brief, human description of what to do next. Updated on every significant transition. Used by crash recovery to guide resumption.

### Valid Phases
- `idle` — System idle, waiting for a task
- `analysis` — ULTRON analyzing the mission and breaking down tasks
- `strategy` — VIGIL validating the approach and architecture
- `execution` — FORGE implementing
- `review` — AEGIS reviewing the delivery
- `checkpoint` — ULTRON consolidating and presenting results to the user

## Handoff Protocol — Structured Communication Logging

The Handoff Protocol (`~/.claude/aios/protocols/handoff-protocol.md`) defines how ULTRON sends tasks to agents and how agents return results. The following actions must be logged in the activity-log:

### activities — Handoff Actions
- `action="handoff_enviado"` — ULTRON sent a HandoffRequest (detail with target and mission.id)
- `action="handoff_recebido"` — ULTRON received a HandoffResponse (detail with agent and status)
- `action="handoff_retry"` — ULTRON retried a spawn (detail with attempt and reason)
- `action="handoff_fallback"` — ULTRON used a free-text fallback (detail with reason)
- `action="handoff_request_validation_fix"` — ULTRON fixed an invalid request (detail with corrected fields)
- `action="circuit_breaker_triggered"` — Consecutive-failure threshold exceeded
- `action="handoff_phase_transition"` — Transition between migration phases (Phase 1 -> 2 -> 3)

### status.json — handoffFailures Field — REMOVED

> **REMOVED in M3.** The `handoffFailures` counter (and the `handoffPhase` migration field) were dropped from `status.json` — no live reader remained after `state_graph.json` was deprecated. Handoff outcomes are logged to `activity-log.json` (`handoff_recebido` / `handoff_retry` / `handoff_fallback` / `circuit_breaker_triggered`); there is no persistent failure counter in status.json anymore.

## State Graph — Execution Topology Logging — DEPRECATED

> **DEPRECATED.** `state_graph.json`, `supervisor-protocol.md`, and the state-graph schemas were retired in the P2/M3 pruning and moved to `~/.claude/aios/_deprecated/`. ULTRON no longer creates graph instances, records transitions, or maintains a `graphInstanceId` in status.json (that field was removed). Execution topology is no longer logged as a graph; the source of truth is `activity-log.json`. The `graph_*` log actions and `graphInstanceId` are kept here only as historical reference and MUST NOT be emitted.

## Smart Routing — Complexity Classification Logging

### activities — Smart Routing Actions
- `action="analisou_missao"` — ULTRON classified mission complexity (detail: "Mission '{description}' classified as {simple|medium|complex}. Criteria: {criteria used}")
- `action="clarificacao_pre_missao"` — ULTRON asked clarifying questions of the user (detail: "Clarification for mission '{description}': {N} questions asked")
- `action="gerou_prd"` — ULTRON generated a PRD (detail: "PRD generated at {path} for mission '{description}'")

### status.json — missionComplexity Field

The `missionComplexity` field (enum: "simple", "medium", "complex" | null, default null) in status.json records the current mission's complexity:
- Set during the analysis phase when ULTRON classifies the mission
- Reset to null when the cycle ends (phase: idle)
- Determines which flow to use (Simple, Medium, Complex)

Schema updated in `~/.claude/aios/schemas/status/status.schema.json`.

## Deliberative Group Chat — Multi-Round Debate Logging

The Deliberative Group Chat (`~/.claude/aios/protocols/group-chat-protocol.md`) is activated for `complex` missions that involve CREATION. It is EXCLUSIVE to the Product Squad (PM, PO, SM, Analyst). Max 2 rounds. Full protocol in the referenced file.

### activities — Group Chat Actions
- `action="group_chat_round"` — ULTRON completed a debate round (detail: "Round {N}: PM={position}, PO={position}, SM={position}, Analyst={position}")
- `action="group_chat_converged"` — Convergence detected (detail: "Converged at round {N}: {winning_position} (agents: {list})")
- `action="group_chat_tiebreak"` — ULTRON broke a tie after max rounds (detail: "Tie-break after {N} rounds: {decision}")

### discussions — Group Chat Debates
Each opinion from each agent in each round produces an entry:
- `from`: agent that opined (pm, po, sm, analyst)
- `to`: "ultron" (the debate is mediated by ULTRON)
- `topic`: debate topic
- `message`: agent's summary + position

### decisions — Group Chat Decisions
The final decision (converged or tie-break) produces an entry:
- `agent`: "ultron"
- `decision`: winning position
- `justification`: why this position was chosen
- `alternatives`: all positions proposed during the debate

## Handoff Files — Disk Persistence Logging

### activities — Handoff File Actions
- `action="handoff_file_created"` — ULTRON created a handoff file on disk (detail: "Handoff file created: {path}")
- `action="handoff_file_updated"` — ULTRON updated a handoff file with a response (detail: "Handoff file updated: {path}, status: {completed|failed}")
- `action="handoff_files_archived"` — ULTRON archived handoff files of a completed mission (detail: "Handoff files for mission {id} moved to archive/")

## Product Squad — Action Logging

The Product Squad (PM, PO, SM, Analyst) produces specific actions in the activity-log. ULTRON logs both the routing actions and the individual actions of each agent.

### activities — Product Squad Agent Actions

- PM (Morgan):
  - `action="criou_prd"` — PM created a PRD (detail: "PRD created at {path} for mission '{description}'")
  - `action="definiu_roadmap"` — PM defined a roadmap (detail: "Roadmap defined: {N} epics, priority: {list}")
  - `action="decisao_estrategica"` — PM made a strategic decision (detail: "Decision: {description}. Justification: {justification}")
  - `action="delegou_para_squad"` — PM delegated a task to a squad agent (detail: "Delegation: {task} to {agent}")

- Analyst (Atlas):
  - `action="pesquisa_mercado"` — Analyst carried out research (detail: "Research: {topic}. {N} sources analyzed, confidence: {level}")
  - `action="analise_competitiva"` — Analyst did competitive analysis (detail: "Competitors analyzed: {list}. {N} insights generated")
  - `action="gerou_relatorio"` — Analyst generated a research report (detail: "Report at {path}: {title}")

- PO (Pax):
  - `action="priorizou_backlog"` — PO prioritized the backlog (detail: "Backlog prioritized: {N} items, criterion: {criterion}")
  - `action="validou_requisitos"` — PO validated requirements (detail: "Requirements validated for {feature}: {result}")
  - `action="definiu_acceptance_criteria"` — PO defined acceptance criteria (detail: "AC defined for {story}: {N} criteria")

- SM (River):
  - `action="criou_story_file"` — SM created a story file (detail: "Story file created at {path}: {N} tasks")
  - `action="quebrou_epic"` — SM broke an epic into stories (detail: "Epic '{title}' broken into {N} stories")
  - `action="registrou_impedimento"` — SM recorded an impediment (detail: "Impediment: {description}, severity: {level}")

### activities — Product Squad Routing Actions

These actions are logged by ULTRON when routing missions to the Product Squad:

- `action="squad_routing"` — ULTRON routed a mission to the Product Squad (detail: "Trigger: {trigger}, target agent: {agent}, mission: {description}")
- `action="squad_handoff_enviado"` — ULTRON sent a handoff to a Product Squad agent (detail: "Handoff sent to {agent}, mission.id: {id}")
- `action="squad_handoff_recebido"` — ULTRON received a response from a Product Squad agent (detail: "Handoff received from {agent}, status: {status}")
- `action="scope_violation"` — Product Squad agent attempted an out-of-scope action (detail: "Scope violation: {agent} attempted {forbidden_action}")
- `action="token_budget_warning"` — Product Squad agent exceeded 80% of its budget (detail: "Budget warning: {agent} used {tokens_used}/{max_budget} tokens")

### discussions — Inter-Squad Debates

Debates between agents of different squads are mediated by ULTRON and logged as discussions:
- `from`: agent of a squad (e.g. "pm", "analyst", "po", "sm")
- `to`: "ultron" (ULTRON mediates all inter-squad communication)
- `topic`: inter-squad debate topic (e.g. "prd_review", "backlog_conflict", "strategy_alignment")
- `message`: debate content (summary + agent position)

Examples of inter-squad debates:
- PM questions technical feasibility with VIGIL (mediated by ULTRON)
- PO disagrees with the prioritization proposed by PM
- Analyst presents data that contradicts a PRD premise
- SM identifies an impediment that affects the engineering squad

## Checkpoint — Logging Protocol

When saving a checkpoint:
- activities: action="salvou_checkpoint", detail="Project {name} paused. Next action: {nextAction.description}"

When restoring a checkpoint:
- activities: action="restaurou_checkpoint", detail="Resuming project {name}. Continuing: {nextAction.description}"

When archiving a checkpoint:
- activities: action="arquivou_checkpoint", detail="Checkpoint of {name} archived. Reason: {archiveReason}"
