# Runs Protocol — Multi-Project Parallelism (Fase A)

> **Scope:** how the AIOS engine isolates N agents across M projects running at
> the same time, without mixing state or documents. Fase A delivers CORRECT
> isolation on the current hardware (i5-7200U / 8GB, gotcha g020). Heavy real
> parallelism (5+5) is Fase B (cloud / better machine) — same engine, bigger cap.
>
> Source plan: `stories/story-20260602T235149.md`. Helpers: `lib/runs.js`,
> `lib/activity-log.js`, `lib/dispatcher.js`. Config: `concurrency.json`.

## Core concept — the RUN as the unit of isolation

A **run** is one execution = (project + mission + timestamp). Every run has a
deterministic id:

```
run-{project}-{YYYYMMDDTHHmmss}
e.g. run-logitok-20260603T024500
```

Everything that is "live state of an execution" is namespaced by `runId`. Two
runs NEVER touch the same state file — isolation is by construction.

## Disk layout

```
~/.claude/aios/
  status.json            <- ROOT INDEX of active runs in multi-run mode
                            { schema: "aios-runs-index-v1", activeRuns: [...], lastUpdate }
                            (legacy single-run shape "aios-status-v1" still valid)
  runs/
    run-logitok-20260603T0245/
      status.json         <- full per-run state (the 13 legacy fields, "aios-status-v1")
      results/            <- structured agent returns (1 file per agent: forge.json, aegis.json)
    run-ultron-20260603T0246/
      status.json
      results/
  activity-log.json       <- INTOCAVEL. append-only. gains OPTIONAL runId per entry.
                            concurrent appends protected by lib/filelock.js.
  gotchas.json            <- INTOCAVEL. shared, read-only concurrent.
  concurrency.json        <- cap + FIFO queue config (hardware-aware, not hardcoded).
```

## Backward compatibility (absolute constraint)

- **If `runs/` does not exist, the engine operates single-run EXACTLY as before.**
  The root `status.json` keeps its legacy `aios-status-v1` shape. Nothing in the
  current flow changes. `runs/` is the implicit feature flag (`runs.isMultiRunMode()`).
- The first call to `runs.openRun()` creates `runs/` and converts the root
  `status.json` into the index — that is the deliberate transition point.
- `activity-log.json` keeps every pre-existing entry valid: `runId` is OPTIONAL.
- The validation hook (`handoff_engine.py _validate_status_basic`) accepts BOTH
  `aios-status-v1` and `aios-runs-index-v1` on the root file.

## The 3 things parallelism fixes (everything else was already ready)

The engine was ~70% ready: the log already partitions by `project`, the handoff
is IN-PROMPT (no shared file), code is isolated by folder. Only 3 things broke:

1. **Singular `status.json`** → now a per-run-dir namespace + a root index.
2. **Concurrent write race on `activity-log.json`** → `lib/filelock.js` lock on append.
3. **Singular ULTRON juggling M phases** → ULTRON becomes a dispatcher; one
   sub-orchestrator per run.

## Golden rule — orchestrator writes, agents return

**No leaf agent (VIGIL, FORGE, AEGIS, …) writes to shared state.** Agents return
structured data in their `HANDOFF_RESPONSE` (already IN-PROMPT). The run's
orchestrator is the ONLY writer:

- per-run state → `runs.writeRunStatus(runId, patch)`
- structured agent result → `runs.writeRunResult(runId, agent, payload)`
- activity-log line → `activityLog.appendEntry(section, entry, { runId })` (locked)

This is what eliminates write races: there is exactly one writer per file.
Formalized in `agent-templates.md` ("Regra de Ouro — Orquestrador Escreve").

## Concurrency — cap + FIFO queue (hardware-aware)

`concurrency.json` (read by `lib/dispatcher.js`):

```json
{
  "maxConcurrentRuns": 2,
  "maxConcurrentAgentsPerRun": 2,
  "maxConcurrentAgentsGlobal": 3,
  "queuePolicy": "fifo",
  "degradeToSequentialOnPressure": true
}
```

- **Cap is config, NOT hardcoded.** On cloud / a better machine, raise the
  numbers and the SAME engine scales — zero code change. This is the Fase B
  portability path.
- **FIFO queue above the cap.** Runs/agents beyond the cap queue; the dispatcher
  pulls the next when a slot frees (`Dispatcher.completeRun` → `selectNext`).
  Without this the 8GB PC freezes (gotcha g020).
- **Graceful degradation.** At the run cap, `Dispatcher.underPressure()` is true
  → ULTRON runs the next pipeline more sequentially instead of over-committing RAM.
- **Failure isolation.** A failed run does NOT take down the others (isolated by
  run-dir); the dispatcher only tracks ids.
- **Hard truth (g020):** locally the useful ceiling is ~2-3 real simultaneous
  agents. "5+5 with no latency" only exists in the cloud (Fase B). Fase A
  delivers clean isolation now; heavy parallelism when the hardware changes —
  with no rewrite.

## Write isolation — directory vs worktree

- **Trust directory separation (default):** parallel agents on DIFFERENT projects
  (LogiTok vs Ultron) — distinct folders, zero file overlap. No worktree needed.
  This is the main case.
- **git worktree per agent (Fase B / T12):** only when 2+ agents work the SAME
  project and may touch overlapping files. Each agent gets an isolated worktree;
  the sub-orchestrator merges the diffs. Cross-project does not need this.
- **activity-log (single-orchestrator-writer + lockfile):** the only genuinely
  shared file. Protected by `lib/filelock.js` (reused, not reinvented).

## AEGIS per run

AEGIS runs **per run** (1 AEGIS per run pipeline), not 1 global AEGIS. The rule
"AEGIS reviews every delivery" holds — scoped per run. For a run with N parallel
FORGEs, the sub-orchestrator consolidates the N diffs and sends ONE AEGIS the
aggregated result (review cost proportional to runs, not leaves). See
`agent-templates.md` (AEGIS section) and `aios-workflow.md`.

## Helper API quick reference (`lib/runs.js`)

| Call | Purpose |
|------|---------|
| `makeRunId(project[, date])` | deterministic `run-{project}-{ts}` |
| `openRun(project[, opts])` | create/open run-dir + results/ + register in index |
| `isMultiRunMode()` | true iff `runs/` exists (feature flag) |
| `listActiveRuns()` | runIds from the root index |
| `readRunStatus(runId)` / `writeRunStatus(runId, patch)` | per-run state I/O |
| `writeRunResult(runId, agent, payload)` | persist an agent's returned result |
| `closeRunInIndex(runId)` | remove run from index on completion (keeps run-dir) |

`lib/activity-log.js`: `appendEntry(section, entry, { runId, agent })` — locked,
auto-fills `id`/`timestamp`. `lib/dispatcher.js`: `new Dispatcher()` + `requestRun`
/ `completeRun` / `selectNext` / `canSpawnAgents`.
