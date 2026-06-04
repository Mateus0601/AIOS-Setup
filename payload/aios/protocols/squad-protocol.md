# Squad Protocol — Inter-Squad Communication and Routing Rules

## Overview

AIOS runs with specialized squads coordinated by ULTRON. Each squad has a domain of responsibility and an internal lead. ULTRON remains the SOLE orchestrator — squad leads are advisors, not sub-orchestrators.

## Registered Squads

| Squad | Lead | Agents | Domain |
|-------|-------|---------|---------|
| Engineering | ULTRON (direct) | VIGIL, FORGE, AEGIS | Architecture, implementation, review |
| Product | Morgan (PM) | PM, PO, SM, Analyst | Strategy, backlog, research, requirements |
| Growth | Link (Prospector) | Link | Prospecting, outreach, pipeline, attraction campaigns |

## Authority Hierarchy

```
USER (final say)
  |
ULTRON [Orchestrator] (sole orchestrator, coordinates EVERYTHING)
  |
  +-- Engineering Squad (ULTRON's direct agents)
  |   +-- VIGIL [Strategist]
  |   +-- FORGE [Executor]
  |   +-- AEGIS [Reviewer]
  |
  +-- Product Squad (coordinated internally by the PM)
  |   +-- Morgan [PM] (squad lead, ULTRON's advisor)
  |   +-- Pax [PO]
  |   +-- River [SM]
  |   +-- Atlas [Analyst]
  |
  +-- Growth Squad (ULTRON's direct agent)
      +-- Link [Prospector] (lead hunter, outreach, SQLite pipeline)
```

### Hierarchy Rules (INVIOLABLE)

1. **ULTRON is the sole orchestrator.** No squad agent may spawn other agents directly.
2. **The PM is an advisor, not an orchestrator.** The PM suggests delegations via `artifacts.delegations` — ULTRON decides whether and how to execute them.
3. **ULTRON mediates ALL inter-squad communication.** The Product Squad does not talk directly to the Engineering Squad.
4. **The user has the final say** on any strategic decision.

## Routing — When to Activate the Product Squad

ULTRON uses 4 objective triggers to decide whether the Product Squad should participate in a mission. The triggers are evaluated BEFORE complexity classification (smart routing).

**CRITICAL RULE:** All missions involving CREATION (product, brand, software, site, app, SaaS, any creation) MUST go through the Product Squad. Only pure implementation, adjustments, fixes, and refactors may skip the Product Squad.

### Trigger 0: Creation (`creation`) — TOP PRIORITY

**Condition:** Mission involves creating something new — product, brand, software, site, app, SaaS, platform, landing page, design, new system.

**Detectable keywords:** criar, construir, desenvolver, novo, site, app, saas, marca, brand, naming, software, sistema, plataforma, landing, design

**Flow:**
```
ULTRON detects the creation trigger
  -> Product Squad MANDATORY — PM (Morgan) coordinates
  -> PM defines product/strategy, may delegate to PO/SM/Analyst
  -> Product Squad artifacts feed the Engineering Squad
  -> If complex: Deliberative Group Chat with the Product Squad (rules in group-chat-protocol.md)
```

### Trigger 1: Product Definition (`product_definition`)

**Condition:** Mission involves defining a new product, PRD, roadmap, or strategic direction.

**Detectable keywords:** prd, produto, roadmap, estrategia, visao, mvp, feature-set, product

**Flow:**
```
ULTRON detects the product_definition trigger
  -> Spawns PM (Morgan) to create a PRD or define strategy
  -> PM returns PRD + strategicDecisions + delegations
  -> ULTRON evaluates the delegations and decides next steps
  -> If engineering is needed: follows the normal flow (VIGIL -> FORGE -> AEGIS)
  -> The PM-generated PRD replaces the one ULTRON would have written alone
```

### Trigger 2: Market Research (`market_research`)

**Condition:** Mission involves market research, competitive analysis, or insights gathering.

**Detectable keywords:** pesquisa, mercado, competidor, analise, benchmark, research, market

**Flow:**
```
ULTRON detects the market_research trigger
  -> Spawns Analyst (Atlas) directly OR via PM
  -> Analyst returns a research report + insights + recommendations
  -> ULTRON consolidates and decides next steps
```

### Trigger 3: Backlog Prioritization (`backlog_prioritization`)

**Condition:** Mission involves backlog prioritization, story refinement, or requirements management.

**Detectable keywords:** backlog, priorizar, priorizacao, stories, refinamento, requisitos, acceptance

**Flow:**
```
ULTRON detects the backlog_prioritization trigger
  -> Spawns PO (Pax) to prioritize/refine
  -> PO returns a prioritized backlog + acceptance criteria
  -> If stories need to be broken down: ULTRON may spawn SM (River)
  -> The result feeds the engineering squad
```

### Trigger 4: Prospecting and Growth (`prospecting`)

**Condition:** Mission involves lead prospecting, outreach, growth hacking, contact pipelines, attraction campaigns.

**Detectable keywords:** prospeccao, prospectar, outreach, leads, prospects, growth, encontrar pessoas, abordagem, email marketing, build in public, pipeline, comunidade encontrar, atrair membros

**Flow:**
```
ULTRON detects the prospecting trigger
  -> Growth Squad MANDATORY — Link executes
  -> Link prospects, writes drafts, manages the SQLite pipeline
  -> Results return to ULTRON (prospectList, outreachDrafts, pipelineReport)
  -> External actions (emails, posts) require explicit user approval via ULTRON
```

### Routing Decision Tree

```
ULTRON receives a mission from the user
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
  +-- prospecting trigger detected?
  |   YES -> Link (Growth Squad) participates
  |   NO  -> continue
  |
  +-- No trigger? -> Pure engineering flow (VIGIL/FORGE/AEGIS)
  |   (implementation, adjustments, fixes, refactors — NOT creation)
  |
  +-- Multiple triggers? -> PM coordinates the Product Squad; Link coordinates the Growth Squad; ULTRON mediates
```

### Integration with Smart Routing

The Product Squad routing happens BEFORE complexity smart routing:

```
1. ULTRON receives the mission
2. ULTRON evaluates Product Squad triggers
3. If a trigger is detected: Product Squad participates (pre-engineering)
4. ULTRON classifies engineering work complexity (simple/medium/complex)
5. Engineering flow proceeds as usual, enriched with Product Squad artifacts
```

## Inter-Squad Handoff

### Product Squad -> Engineering Squad

Handoff artifacts use NATIVE AIOS formats (zero new formats):

| Artifact | Format | Producer | Consumer | Path |
|----------|---------|----------|------------|------|
| PRD | Markdown | PM | VIGIL | `~/.claude/aios/docs/PRD-{slug}.md` |
| Story File | Markdown | SM | FORGE | `~/.claude/aios/stories/story-{ts}.md` |
| Backlog | JSON | PO | ULTRON | `~/.claude/aios/squads/produto/backlog.json` |
| Research Report | Markdown | Analyst | PM/ULTRON | `~/.claude/aios/docs/research-{slug}.md` |

### Growth Squad -> ULTRON

| Artifact | Format | Producer | Consumer | Via |
|----------|---------|----------|------------|-----|
| Prospect List | JSON in response | Link | ULTRON/user | artifacts.prospectList in HandoffResponse |
| Outreach Drafts | Text in response | Link | ULTRON/user | artifacts.outreachDrafts in HandoffResponse |
| Pipeline Report | Text in response | Link | ULTRON/user | artifacts.pipelineReport in HandoffResponse |
| Email Drafts | Text in response | Link | ULTRON/user | artifacts.emailDrafts (requires approval) |
| Campaign Plan | Text in response | Link | ULTRON/user | artifacts.campaignPlan in HandoffResponse |
| SQLite Pipeline | Database file | Link | Link (internal) | ~/.claude/aios/squads/growth/pipeline.db |

### Engineering Squad -> Product Squad

| Artifact | Format | Producer | Consumer | Via |
|----------|---------|----------|------------|-----|
| Technical Constraints | Text | VIGIL | PM | chain.vigilOutput in HandoffRequest |
| Implementation Status | Text | FORGE | PO | chain.forgeOutput in HandoffRequest |
| Review Feedback | Text | AEGIS | PM | Consolidated by ULTRON |

### Handoff Protocol

1. **ULTRON always mediates.** No agent sends an artifact directly to another squad.
2. **Artifacts are paths.** What goes in the HandoffRequest is the PATH to the artifact, not the full content.
3. **The receiving agent READS the artifact** from the path indicated in its context.
4. **ULTRON validates existence** of the artifact before referencing it in the HandoffRequest.

## Token Budget Enforcement

The Product Squad operates with a 60k token budget per full cycle. The Growth Squad operates with a 30k token budget per cycle. ULTRON monitors usage:

### Suggested Distribution

| Agent | Budget | Typical Use |
|--------|--------|------------|
| PM (Morgan) | 20k | PRD, strategy, decisions |
| PO (Pax) | 12k | Backlog, prioritization |
| SM (River) | 12k | Story files, tasks |
| Analyst (Atlas) | 16k | Research, reports |

**Growth Squad — 30k tokens per cycle:**

| Agent | Budget | Typical Use |
|--------|--------|------------|
| Link (Prospector) | 30k | Prospecting, outreach, pipeline, campaigns |

### Budget Rules

1. **Budget is a guideline, not a hard limit.** ULTRON can reallocate between agents as needed.
2. **Warning at 80%.** If an agent exceeds 80% of its budget, ULTRON logs a warning.
3. **Overflow into the next cycle.** If the budget is exhausted, ULTRON checkpoints and resumes in the next cycle.
4. **Budget does not apply to the Engineering Squad.** VIGIL/FORGE/AEGIS have an independent budget.

## Scope Enforcement

### Fundamental Rule

**Product Squad agents NEVER write application code.** Their output is DOCUMENTS:
- PRDs (Markdown)
- Backlogs (JSON)
- Research Reports (Markdown)
- Story Files (Markdown)
- Strategic Decisions (text)

### Growth Squad Rule

**Link NEVER sends emails or posts to social media without explicit user approval.** Link prepares drafts, presents them to the user via ULTRON, and only executes after approval. Every external action requires approval. Violations are logged as `scope_violation` in the activity-log.

Link MAY create/edit:
- `.md` files (documents, plans)
- SQLite DB at `~/.claude/aios/squads/growth/pipeline.db` (via mcp__sqlite)
- Email drafts via Gmail MCP (only `gmail_create_draft`, never send)

### Enforcement

If a Product Squad agent tries to:
- Create/modify `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, etc. files
- Run `npm`, `pip`, `cargo`, etc. commands
- Commit to git

ULTRON MUST:
1. Reject the action
2. Log in activity-log: `action="scope_violation"`, detail with agent and attempted action
3. Register a gotcha if it recurs

### Exceptions

Product Squad agents MAY create/edit:
- `.md` files (Markdown documents)
- `.json` files in `~/.claude/aios/` (AIOS configuration)
- Files in `~/.claude/aios/docs/` (product documents)
- Files in `~/.claude/aios/squads/produto/` (squad artifacts)

## Activity-Log Logging

### activities — Product Squad Actions

- `action="squad_routing"` — ULTRON routed a mission to the Product Squad (detail: "Trigger: {trigger}, agent: {agent}")
- `action="squad_handoff_enviado"` — ULTRON sent a handoff to a Product Squad agent
- `action="squad_handoff_recebido"` — ULTRON received a response from a Product Squad agent
- `action="scope_violation"` — A Product Squad agent attempted an out-of-scope action
- `action="token_budget_warning"` — A Product Squad agent exceeded 80% of its budget

### discussions — Inter-Squad Debates

Debates between agents of different squads are mediated by ULTRON:
- `from`: agent from a squad (e.g. "pm")
- `to`: "ultron" (ULTRON mediates)
- `topic`: inter-squad debate topic
- `message`: debate content

## Extensibility

### Adding New Squads

To add a new squad to AIOS:

1. Create the `~/.claude/aios/squads/{name}/` directory
2. Create `squad-manifest.json` following this file's schema
3. Create agent `.md` files for each squad agent
4. Create response schemas in `~/.claude/aios/schemas/handoff/`
5. Update `request.schema.json` with new targets
6. Update `squad-protocol.md` with routing triggers
7. Update `CLAUDE.md` with new slash commands

### Adding New Agents to a Squad

1. Add an entry in `squad-manifest.json` -> `agents`
2. Create the agent `.md` file
3. Create the response schema
4. Update the authority matrix
5. Update routing triggers if needed
