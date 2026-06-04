# Memory Protocol (Memory MCP)

## Save Automatically
- Decisions made and their justifications (tag `[DECISION]`)
- Errors encountered and how they were fixed (tag `[ERROR]`)
- Implementation patterns that worked (tag `[PATTERN]`)
- User preferences (tag `[PREFERENCE]`)
- Technology learnings (tag `[TECH]`)

## Query Automatically
- When starting any task: prior similar projects, recurring error patterns, user preferences
- When implementing: saved patterns for similar problems
- When reviewing: known recurring issues

## Dashboard Sync — DEPRECATED

> **DEPRECATED (2026-06-02).** The export to `memory-export.json` + the dashboard SSE watcher are retired — no dashboard consumes this file. `memory-export.json` was moved to `_deprecated/`. Do NOT recreate the export. The Memory MCP is queried directly via `mcp__memory__*`; there is no on-disk mirror to maintain.

## Gotchas — Problem Memory (HYBRID model)

The file `~/.claude/aios/gotchas.json` is the structured memory of recurring problems and their workarounds.

**Operating model (HYBRID — user decision):**
- `gotchas.json` is a **passive reference file**, maintained manually. There is **NO active error-tracking pipeline** feeding it automatically — the old `error-tracking.json` ingestion layer was deprecated (P2) and removed. Entries are added/resolved by hand by the agents, not by a background process.
- **The push of relevant gotchas stays active.** ULTRON [Orchestrator] filters and injects the top-N relevant gotchas (max 3, by project + category) into every spawn via `context.gotchas` in the HANDOFF_REQUEST. This push is the regression guard against recurring bugs and is anchored in `agent-templates.md` (`GOTCHAS_RELEVANTES`) — do not remove it.

So: passive store + manual upkeep, but continuous top-N injection by ULTRON at spawn time.

### When to Register a Gotcha
Register a gotcha (manually) whenever:
- An error affects the agents' workflow (any agent may register one)
- A non-obvious workaround is found for a technical problem
- A problem occurs for the second time (indicative of a recurring pattern)
- AEGIS [Reviewer] identifies a systemic failure during a review

To register: read `gotchas.json`, add the entry with an incremental ID (g001, g002…), update `statistics`, write it back.

### When to Mark as Resolved
Set `resolved: true` and fill `resolvedAt` when:
- The root cause has been definitively fixed in code/configuration
- The fix has been verified by AEGIS [Reviewer]
- The workaround is no longer needed

Also update the `statistics.resolved` field (recount by hand — there is no auto-pipeline).

### Lookup Protocol (MANDATORY — the active half of the hybrid)
When starting any task, ULTRON [Orchestrator] MUST:
1. Read `~/.claude/aios/gotchas.json`
2. Filter by `project` (current project or "aios-core") and the `category` relevant to the task
3. Keep only `resolved: false` (still-active gotchas)
4. Inject the top 3 (ordered by severity: critical > warning > info) into `context.gotchas` of each agent being spawned

Example prompt inclusion: "RELEVANT ACTIVE GOTCHAS: [g001] Memory MCP does not persist to disk — workaround: re-query the graph via `mcp__memory__read_graph` at task start."

## AIOS Templates
Templates live in `~/.claude/aios/`:
- `mission-board.md` — Mission board (tasks, decisions, conflicts, checkpoints)
- `evolution-log.md` — Agent self-improvement log
