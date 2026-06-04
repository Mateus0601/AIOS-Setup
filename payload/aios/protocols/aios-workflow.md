# AIOS Workflow

## Smart Routing — Complexity Classification

Before starting any mission, ULTRON classifies the complexity as `simple`, `medium`, or `complex`. This classification determines which flow is used.

**Classification criteria (ULTRON heuristics):**

| Criterion | Simple | Medium | Complex |
|----------|--------|--------|---------|
| Files affected | 1-3 | 4-10 | 10+ |
| Technical decision | None or obvious | 1-2 decisions | Multiple, controversial |
| Scope | Point fix, tweak | Feature, refactor | Architecture, new system |
| Risk | Low | Medium | High |
| Ambiguity | Zero | Some | High |

ULTRON may use any combination of these criteria. It is not a rigid checklist — it is informed judgment.

**When classifying, ULTRON MUST:**
1. Record the complexity in `status.json` under `missionComplexity`
2. Log to the activity-log: `action="analisou_missao"`, detail including the complexity
3. Use the corresponding flow below

## Pre-Mission Clarification

For `medium` or `complex` missions (MANDATORY), ULTRON asks the user clarifying questions BEFORE starting the agent flow. For `simple` missions, it is OPTIONAL (ULTRON may skip it if requirements are clear).

**Clarification happens INSIDE the `analysis` phase — it is NOT a new phase.**

```
User "dumps" request
      |
ULTRON analyzes and classifies complexity
      |
[If medium/complex] ULTRON asks 2-5 clarifying questions
      |
User answers / refines
      |
[If complex or new project] ULTRON generates a PRD at ~/.claude/aios/docs/PRD-{slug}.md
      |
Normal flow according to complexity
```

**Style of the questions:**
- Focused on ambiguities and decisions that impact implementation
- Not bureaucratic — it is a semi-debate, not an interrogation
- ULTRON logs in the activity-log: `action="clarificacao_pre_missao"`
- If a PRD is generated: `action="gerou_prd"`, detail with PRD path

## SIMPLE Flow

```
User asks for something
      |
[ULTRON] Checks checkpoints/index.json — restores if needed
      |
[ULTRON] Classifies as SIMPLE (missionComplexity = "simple")
      |
[ULTRON] Consults relevant gotchas at ~/.claude/aios/gotchas.json
      |
[FORGE] (Task instance) Implements directly
        (NO VIGIL — ULTRON provides context directly)
      |
[AEGIS] (Task instance) Reviews the delivery
      |
[ULTRON] Consolidates -> Checkpoint with the user
      |
[ULTRON] Saves checkpoint + handoff files
```

**Rules of the Simple flow:**
- VIGIL does NOT participate (no strategy phase)
- FORGE receives context directly from ULTRON (chain.vigilOutput = null)
- FORGE operates with CoT + ReACT: thinks out loud first (Chain-of-Thought), then executes with an internal loop (REASON-ACT-OBSERVE, max 3 iterations) — plans before acting and self-corrects before handing off to AEGIS
- AEGIS ALWAYS participates — quality is not optional
- No Deliberative Group Chat
- No story file (unless ULTRON deems it necessary)
- Graph template: `simple-task`

## MEDIUM Flow (default)

```
User asks for something
      |
[ULTRON] Checks checkpoints/index.json — restores if needed
      |
[ULTRON] Classifies as MEDIUM (missionComplexity = "medium")
      |
[ULTRON] Pre-Mission Clarification (MANDATORY)
      |
[ULTRON] Consults relevant gotchas at ~/.claude/aios/gotchas.json
      |
[VIGIL] (Task instance) Validates the approach — DEBATES if needed
        Generates a Story File at ~/.claude/aios/stories/ (if medium/large task)
      |
  Checkpoint with the user (if large task) OR continues
      |
[FORGE] (Task instance) Implements — may be parallel if tasks are independent
        Updates the Story File (checks tasks [x], records progress)
      |
[AEGIS] (Task instance) Reviews the delivery — DEBATES if issues are found
      |
[ULTRON] Consolidates everything -> Checkpoint with the user
      |
[ULTRON] Saves checkpoint + handoff files
        Updates checkpoints/index.json
        Includes activeStoryFile in the checkpoint
```

**Rules of the Medium flow:**
- Full flow MANDATORY: VIGIL -> FORGE -> AEGIS
- FORGE operates with CoT + ReACT: thinks out loud first (Chain-of-Thought), then executes with an internal loop (REASON-ACT-OBSERVE, max 3 iterations) — plans before acting and self-corrects before handing off to AEGIS
- Standard debates between agents (existing protocol)
- No Deliberative Group Chat (debates are sequential)
- Graph template: `standard-cycle`

## COMPLEX Flow

```
User asks for something
      |
[ULTRON] Checks checkpoints/index.json — restores if needed
      |
[ULTRON] Classifies as COMPLEX (missionComplexity = "complex")
      |
[ULTRON] Pre-Mission Clarification (MANDATORY) + generates PRD
      |
[ULTRON] Consults relevant gotchas at ~/.claude/aios/gotchas.json
      |
[VIGIL] (Task instance) Validates the approach
        Generates a Story File at ~/.claude/aios/stories/
      |
  Checkpoint with the user (MANDATORY before executing)
      |
[GROUP CHAT] Product/strategy decisions via Deliberative Group Chat
             (Product Squad: PM, PO, SM, Analyst — max 2 rounds)
             (full protocol in ~/.claude/aios/protocols/group-chat-protocol.md)
      |
[FORGE] (Task instance) Implements
        Updates the Story File
      |
[AEGIS] (Task instance) Reviews the delivery
      |
[ULTRON] Consolidates everything -> Checkpoint with the user
      |
[ULTRON] Saves checkpoint + handoff files
        Updates checkpoints/index.json
        Includes activeStoryFile in the checkpoint
```

**Rules of the Complex flow:**
- Full flow MANDATORY: VIGIL -> FORGE -> AEGIS
- FORGE operates with CoT + ReACT: thinks out loud first (Chain-of-Thought), then executes with an internal loop (REASON-ACT-OBSERVE, max 3 iterations) — plans before acting and self-corrects before handing off to AEGIS
- Deliberative Group Chat activated for product/strategy decisions (Product Squad: PM, PO, SM, Analyst — max 2 rounds)
- The Engineering Squad (VIGIL, FORGE, AEGIS) does NOT participate in the Group Chat — it uses sequential debates
- PRD MANDATORY before execution
- Checkpoint with the user MANDATORY before spawning FORGE
- Graph template: `group-chat-deliberative` or `debate-cycle`

## Product Squad — Routing and Integration

AIOS runs with 2 squads: **Engineering** (VIGIL, FORGE, AEGIS) and **Product** (Morgan PM, Pax PO, River SM, Atlas Analyst). The Product Squad is a PRE-ENGINEERING layer — it defines the product, researches the market, and prioritizes the backlog BEFORE the engineering squad implements.

**ULTRON remains the SOLE orchestrator.** The PM (Morgan) is the internal squad lead (advisor), not a sub-orchestrator. ULTRON mediates ALL inter-squad communication.

**Full protocol:** See `~/.claude/aios/protocols/squad-protocol.md`

### Routing Triggers

ULTRON evaluates 4 triggers BEFORE the complexity classification (smart routing). If detected, the Product Squad participates in the mission:

| Trigger | Keywords | Target Agent | Example |
|---------|----------|-------------|---------|
| `creation` | criar, construir, desenvolver, novo, site, app, saas, marca, brand, naming, software, sistema, plataforma, landing, design | PM (Morgan) | "Criar um site para vender AIOS" |
| `product_definition` | prd, produto, roadmap, estrategia, visao, mvp, feature-set, product | PM (Morgan) | "Criar PRD para novo modulo" |
| `market_research` | pesquisa, mercado, competidor, analise, benchmark, research, market | Analyst (Atlas) | "Pesquisar concorrentes do produto X" |
| `backlog_prioritization` | backlog, priorizar, priorizacao, stories, refinamento, requisitos, acceptance | PO (Pax) | "Priorizar backlog do sprint" |

**CRITICAL RULE:** All missions that involve CREATION (product, brand, software, site, app, SaaS, any creation) MUST go through the Product Squad. Only pure implementation, adjustments, fixes, and refactors can skip the Product Squad.

### Routing Decision Tree

```
ULTRON receives mission from the user
  |
  +-- Does the mission involve CREATION? (product, brand, software, site, app, SaaS, any creation)
  |   YES -> Product Squad MANDATORY (PM coordinates)
  |   NO  -> continue evaluating specific triggers
  |
  +-- product_definition trigger detected?
  |   YES -> PM (Morgan) participates
  |   NO  -> continue
  |
  +-- market_research trigger detected?
  |   YES -> Analyst (Atlas) participates (via PM or directly)
  |   NO  -> continue
  |
  +-- backlog_prioritization trigger detected?
  |   YES -> PO (Pax) participates
  |   NO  -> continue
  |
  +-- No trigger? -> Pure engineering flow (VIGIL/FORGE/AEGIS)
  |   (implementation, adjustments, fixes, refactors)
  |
  +-- Multiple triggers? -> PM coordinates (as squad lead)
```

### Integration with Smart Routing (Complexity)

The Product Squad routing happens BEFORE complexity smart routing:

```
1. ULTRON receives the mission
2. ULTRON evaluates Product Squad triggers (keywords in the mission)
3. If trigger detected: Product Squad participates (pre-engineering phase)
4. ULTRON classifies the complexity (simple/medium/complex) of the ENGINEERING work
5. The engineering flow proceeds as usual, enriched with Product Squad artifacts
```

### Product-Aware Flow (with Product Squad)

```
User asks for something
      |
[ULTRON] Evaluates Product Squad triggers
      |
[ULTRON] Detects trigger(s) -> Spawns Product Squad agent(s)
      |
[PM/Analyst/PO/SM] Produces artifact (PRD, research report, backlog, story file)
      |
[ULTRON] Receives the Product Squad artifact
      |
[ULTRON] Classifies engineering work complexity (simple/medium/complex)
      |
[Normal flow] VIGIL -> FORGE -> AEGIS (enriched with Product Squad artifacts)
      |
[ULTRON] Consolidates -> Checkpoint with the user
```

### Pure Engineering Flow (no Product Squad)

If no trigger is detected, the flow is identical to the Simple/Medium/Complex flows described above — no change whatsoever.

### Inter-Squad Handoff Artifacts

Handoff artifacts use NATIVE AIOS formats (zero new formats):

| Artifact | Format | Producer | Consumer | Path |
|----------|---------|----------|------------|------|
| PRD | Markdown | PM (Morgan) | VIGIL | `~/.claude/aios/docs/PRD-{slug}.md` |
| Story File | Markdown | SM (River) | FORGE | `~/.claude/aios/stories/story-{ts}.md` |
| Backlog | JSON | PO (Pax) | ULTRON | `~/.claude/aios/squads/produto/backlog.json` |
| Research Report | Markdown | Analyst (Atlas) | PM/ULTRON | `~/.claude/aios/docs/research-{slug}.md` |

### Token Budget

The Product Squad operates with a 60k token budget per cycle (guideline, not hard limit). Suggested distribution: PM 20k, Analyst 16k, PO 12k, SM 12k. ULTRON monitors and logs a warning at 80%.

### Scope Enforcement

Product Squad agents NEVER write application code. Their output is DOCUMENTS (PRDs, backlogs, research reports, stories). Violations are logged as `scope_violation` in the activity-log.

## Deliberative Group Chat

For `complex` missions that involve CREATION (product, brand, software, site, app, SaaS), product and strategy decisions are debated via the Deliberative Group Chat — structured multi-round debate with automatic convergence.

**IMPORTANT:** The Group Chat is EXCLUSIVE to the Product Squad (PM, PO, SM, Analyst). The Engineering Squad (VIGIL, FORGE, AEGIS) does NOT participate in the Group Chat — they use standard sequential debates.

**SINGLE SOURCE OF TRUTH for scope/rules (rounds, convergence threshold, participants):** `~/.claude/aios/protocols/group-chat-protocol.md`. Do not duplicate the parameters here — read that file. In short: Product-Squad-only, 3-of-4 (75%) convergence, max 2 rounds, ULTRON tie-breaks.

## Handoff Files on Disk — DEPRECATED

> **DEPRECATED.** The on-disk handoff mechanism (the `~/.claude/aios/handoffs/` tree, `handoff-file.schema.json`, and its `state_graph.json` companion) was retired in the M3 pruning. `handoff-file.schema.json` now lives in `_deprecated/schemas-handoff-file/` and `state_graph.json` in `_deprecated/`. The **live handoff is IN-PROMPT**: ULTRON passes the HandoffRequest envelope (`request.schema.json`) directly to the spawned agent and receives the response envelope back — nothing is persisted to a handoff directory. See `handoff-protocol.md` for the in-prompt contract. Auditability now comes from the activity-log, not from per-handoff files.

## Story Files

For medium/large tasks, VIGIL generates a Story File as part of its validation output. The Story File is the human-readable visual plan with checkboxes that tracks execution. Full protocol in `~/.claude/aios/protocols/story-files-protocol.md`.

**Summary flow:**
1. VIGIL generates the story file when validating the approach
2. ULTRON passes the story file path to FORGE
3. FORGE updates tasks (`[x]`) and the "FORGE Progress" section during execution
4. ULTRON saves the path in the checkpoint's `activeStoryFile` field
5. `/continue` uses the story file to resume pending work

## Chain-of-Thought (CoT) — FORGE Explicit Reasoning

Chain-of-Thought is a protocol that forces FORGE to think step by step out loud BEFORE starting to implement. The reasoning is VISIBLE in the output (free text after the HANDOFF_RESPONSE JSON), documenting decisions and justifications.

### Benefits

- **Accuracy:** FORGE thinks before acting, reducing implementation errors
- **Early self-correction:** Identifies problems in the plan, before coding
- **Automatic documentation:** Implementation decisions end up recorded in the output
- **Auditability:** AEGIS and ULTRON can review the reasoning, not just the result

### Relationship with ReACT

CoT and ReACT are COMPLEMENTARY and operate at different levels:

| Aspect | Chain-of-Thought (CoT) | ReACT (REASON-ACT-OBSERVE) |
|---------|------------------------|---------------------------|
| **When** | BEFORE starting to implement | DURING the implementation of each task |
| **Level** | Strategic — big picture | Tactical — one task at a time |
| **Focus** | Planning, decisions, risks | Execution, verification, correction |
| **Output** | "## Reasoning (Chain-of-Thought)" section | Fields in artifacts.reactIterations |
| **Iteration** | Once (at the start) | Loop up to 3x per task |

FORGE's full flow is: **CoT (plan everything) -> ReACT loop per task (execute and verify each one)**

### Output Format

FORGE writes the CoT section in free text, after the HANDOFF_RESPONSE JSON:

```
<HANDOFF_RESPONSE>
{...JSON...}
</HANDOFF_RESPONSE>

## Reasoning (Chain-of-Thought)

1. **Understanding:** [task summary]
2. **Decomposition:** [concrete steps]
3. **Decisions:** [options and justifications]
4. **Risks:** [edge cases, dependencies]
5. **Verification:** [test/review plan]

[implementation details]
```

### Token Economics

CoT adds ~200-500 tokens to FORGE's output. In exchange, it reduces retries and AEGIS rejections — errors that would be caught in review are avoided in planning. The ROI is positive for tasks touching more than 2 files.

## ReACT Protocol — FORGE's Internal Loop

ReACT (REASON-ACT-OBSERVE) is a behavioral protocol that makes FORGE self-iterate internally before sending to AEGIS. It is implemented as instructions in FORGE's prompt — it is not runtime code.

### How It Works

For each task, FORGE runs the cycle:

```
REASON: Analyzes the task, identifies edge cases, plans the implementation
    |
ACT: Implements following the plan (writes code, modifies files)
    |
OBSERVE: Critically reviews the result
    |--- Tests available? Runs them via Bash (npm test, pytest, etc.)
    |--- No tests? Critical self-review (bugs, imports, edge cases)
    |
[If OBSERVE failed with an implementation problem]
    |--- Fixes and goes back to ACT (max 3 iterations)
    |
[If OBSERVE failed with an architectural problem]
    |--- Stops iterating, reports in issues[], escalates to AEGIS
    |
[If OBSERVE passed]
    |--- Task complete, reports in artifacts.reactIterations
```

### Stop Conditions

FORGE stops iterating when:
1. **OBSERVE passed** — implementation is correct (ideal case)
2. **Max iterations reached** — default 3, configurable up to 5
3. **Architectural problem** — FORGE identifies that the issue is not one of implementation and escalates

### Token Economics

Without ReACT, an implementation error creates the cycle: FORGE -> AEGIS rejects -> ULTRON re-spawns -> FORGE fixes (~12k-20k tokens per extra cycle). With ReACT, FORGE self-corrects internally (~500-2k tokens per extra iteration). ~80% reduction in the cost of fixing simple errors.

### Relationship with AEGIS

ReACT does NOT replace AEGIS. AEGIS continues to review EVERY delivery. The difference:
- **Without ReACT:** AEGIS catches simple bugs (typos, imports) + complex issues -> rejects -> ULTRON re-spawns FORGE
- **With ReACT:** FORGE has already fixed simple bugs -> AEGIS focuses on complex issues (architecture, security, performance)

AEGIS becomes aware of ReACT via `artifacts.reactIterations` and can calibrate review depth (if FORGE already iterated 3 times and OBSERVE failed, AEGIS knows the problem is likely architectural).

### Logging

ULTRON logs the ReACT actions when parsing FORGE's response:
- `action="react_iteration"` — Each internal iteration (detail: "Iteracao {N}: issue={problem}, fix={correction}")
- `action="react_observe_passed"` — Final OBSERVE passed (detail: "OBSERVE passou na iteracao {N}. {N} self-corrections feitas")
- `action="react_escalated"` — Architectural problem escalated (detail: "Problema arquitetural detectado na iteracao {N}: {description}. Escalando para AEGIS.")

### Schema

Fields in response-forge.schema.json (all optional, backward compatible):
- `artifacts.reactIterations.totalAttempts` (integer, 1-5, default 1) — schema allows up to 5 (ceiling), prompt instructs max 3 (operational default), value 1 means single-pass (no self-correction loop)
- `artifacts.reactIterations.selfCorrections` (array of {iteration, issue, fix})
- `artifacts.reactIterations.finalObserveStatus` (enum: passed, failed, partial)

Configuration via HandoffRequest:
- `instructions.maxReactIterations` (integer, 1-5, default 3) — ULTRON can configure the iteration cap per handoff
- `metadata.reactEnabled` (boolean, default true)

## Debate Protocol (sequential)

Sequential debate is the default for `medium` flows. For decisions in `complex` flows, use the Deliberative Group Chat.

1. ULTRON [Orchestrator] identifies a topic that requires analysis
2. Spawns VIGIL [Strategist] via Task -> receives analysis
3. Spawns FORGE [Executor] via Task with context + analysis -> receives response
4. Spawns AEGIS [Reviewer] via Task with context + both analyses -> receives evaluation
5. ULTRON [Orchestrator] analyzes all perspectives and makes the final decision
6. EVERY debate is recorded in activity-log.json (discussions + decisions)

## When to Create a PRD

- `complex` missions: MANDATORY
- `medium` missions with a new project: RECOMMENDED
- `simple` missions: NOT needed

For construction projects (software, system, complex automation), ULTRON [Orchestrator] MUST create a PRD before execution:
- Overview, goals, features, out of scope
- Technical requirements, success criteria, risks
- The PRD is validated by VIGIL [Strategist] (Task instance) before the user checkpoint
- Output at `~/.claude/aios/docs/PRD-{slug}.md`

## Early Save Protocol

ULTRON MUST update `status.json` with recovery fields at every phase transition:

### On starting analysis (phase: analysis)
- activeStoryFile: null (does not exist yet)
- lastActivityIds: current snapshot from the activity-log
- modifiedFiles: [] (new cycle)
- missionComplexity: determined classification
- recoveryHint: "ULTRON analyzing mission: {brief description}"

### On spawning VIGIL (phase: strategy)
- recoveryHint: "VIGIL validating approach: {description}"
- Other fields kept

### After VIGIL returns (before spawning FORGE)
- activeStoryFile: story file name (if VIGIL generated one)
- recoveryHint: "Approach validated by VIGIL. FORGE ready to execute: {next task}"

### On spawning FORGE (phase: execution)
- agentsSpawned: update with "forge"
- recoveryHint: "FORGE executing: {current task from the story file}"
- modifiedFiles: accumulate files modified by FORGE

### On spawning AEGIS (phase: review)
- agentsSpawned: update with "aegis"
- recoveryHint: "AEGIS reviewing FORGE delivery"

### On consolidating (phase: checkpoint)
- recoveryHint: "ULTRON consolidating results for checkpoint"
- Full checkpoint is saved normally (Tier 2)

### On ending the cycle (phase: idle)
- Reset ALL recovery fields to null/[] (as already done for existing fields)
- missionComplexity: null

## Supervisor Node Protocol (RETIRED)

> **RETIRED 2026-06-02.** `state_graph.json` was telemetry (an enriched log), not runtime — confirmed by the protocol itself ("NOT a runtime"). It was moved to `~/.claude/aios/_deprecated/` along with `supervisor-protocol.md` and the `state-graph/` schemas. ULTRON must no longer create graph instances or record transitions in `state_graph.json`. The source of truth for execution is `activity-log.json` (the live handoff is IN-PROMPT, no longer on disk — see `handoff-protocol.md`). Everything below (graph templates, `graphInstanceId`, "Persists a handoff file to disk", transitions in `state_graph.json`) is kept only as historical reference and does NOT describe an active mechanism.

The State Graph recorded the execution topology of each mission. ULTRON acted as the Supervisor Node — it decided freely and recorded transitions post-hoc in `state_graph.json` (the file is now in `_deprecated/`). The graph was NOT runtime; it was an enriched log for auditing and visualization.

**Full protocol (archived):** `~/.claude/aios/_deprecated/supervisor-protocol.md`

### When to Create a Graph Instance

ULTRON MUST create a graph instance when starting any mission that follows the full flow (with agents). DO NOT create one for simple tasks that ULTRON runs directly.

### Which Template to Use

| Situation | Template |
|----------|----------|
| Simple mission (FORGE + AEGIS) | `simple-task` or `standard-cycle` without strategy |
| Medium mission (full flow) | `standard-cycle` |
| Complex mission (with group chat) | `group-chat-deliberative` |
| Independent parallelizable tasks | `parallel-execution` |
| Expected sequential debate | `debate-cycle` |

### How to Record Transitions

At each phase/agent transition, ULTRON:
1. Creates a transition entry with HandoffRequest in state_graph.json
2. Updates currentNode
3. Spawns the agent
4. On receiving the response: updates the transition with HandoffResponse, durationMs, status
5. Updates status.json (phase, activeAgent, graphInstanceId)
6. Logs to activity-log (graph_transition_started, graph_transition_completed)
7. Persists a handoff file to disk (handoffs/{mission-id}/)

### Integration with the Existing Flow

The Supervisor Node does NOT change the flow — it only RECORDS the transitions that were already going to happen. The flows are:

```
SIMPLE:         ULTRON analyzes -> FORGE implements -> AEGIS reviews -> ULTRON consolidates
MEDIUM:         ULTRON analyzes -> VIGIL validates -> FORGE implements -> AEGIS reviews -> ULTRON consolidates
COMPLEX:        ULTRON analyzes -> VIGIL validates -> [Group Chat] -> FORGE implements -> AEGIS reviews -> ULTRON consolidates
PRODUCT-AWARE:  ULTRON routing -> [Product Squad] -> ULTRON classifies -> [Normal engineering flow]
```

The difference is that each arrow (->) now produces a transition entry in state_graph.json with:
- Timing (timestamp, completedAt, durationMs)
- Payloads (HandoffRequest, HandoffResponse)
- Status (in_progress, completed, failed, skipped)

### Early Save Protocol — graphInstanceId

Include `graphInstanceId` in status.json at every transition:

- On starting analysis (phase: analysis): graphInstanceId = ID of the newly created instance
- On each subsequent transition: keep graphInstanceId
- On ending the cycle (phase: idle): graphInstanceId = null
- In crash recovery: use graphInstanceId to reconnect to the correct graph

## Checkpoint Rules

- At the end of every work cycle
- When a large task requires intermediate user validation
- When AEGIS [Reviewer] finds issues that change direction
- Maximum 5 rounds before forcing a checkpoint
- `complex` missions: MANDATORY checkpoint before spawning FORGE
