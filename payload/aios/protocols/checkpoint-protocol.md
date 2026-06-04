# Checkpoint System — Save/Restore Protocol

The Checkpoint System saves the full working state when the user pauses in the middle of a feature and restores it automatically when they come back.

## Files
- `~/.claude/aios/checkpoints/index.json` — Index of all checkpoints
- `~/.claude/aios/checkpoints/{project-slug}.json` — Individual per-project checkpoint

## SAVE Protocol (MANDATORY)

ULTRON MUST save a checkpoint in the following situations:
1. **End of cycle:** When status.json.phase transitions to `checkpoint` or `idle`
2. **Checkpoint with the user:** Before delivering a consolidated response to the user
3. **Explicit pause:** When the user says they are stopping/pausing

### How to save:
1. Read the existing checkpoint (if any) for the current project
2. Update every field with the current state:
   - workStack: story/task/subtask in progress
   - nextAction: detailed description of the NEXT thing to do
   - modifiedFiles: ALL files created/modified in this cycle
   - agentContext: agents spawned, pending debates
   - pendingDecisions: unresolved decisions
   - activityLogSnapshot: current max IDs from the activity-log
   - activeStoryFile: name of the active story file (e.g. `story-20260218T143000.md`), or null if there is none
   - crashIndicator.sessionEndedNormally: false (defensive default)
   - crashIndicator.statusAtPause: status.json's current phase
3. Write to `~/.claude/aios/checkpoints/{slug}.json`
4. Update `~/.claude/aios/checkpoints/index.json` (activeCheckpoints)
5. Log to activity-log: action="salvou_checkpoint"

Project slug: `project.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')`

## RESTORE Protocol (MANDATORY at the start of every session)

ULTRON MUST check for checkpoints at the BEGINNING of every session, BEFORE anything else:

1. Read `~/.claude/aios/checkpoints/index.json`
2. Check whether there are checkpoints with `status: "paused"`

### If 1 paused checkpoint:
- Read the full checkpoint
- Restore automatically
- Notify the user with a summary:
  ```
  CHECKPOINT RESTORED — Project: {project}
  Paused at: {savedAt}
  Last agent: {lastActiveAgent}

  WHERE WE LEFT OFF:
  - Story: {story.title}
  - Task: {task.title} (#{task.id})
  - Subtask: {subtask.title}

  NEXT ACTION:
  {nextAction.description}

  FILES IN PROGRESS:
  {modifiedFiles list}

  PENDING DEBATES: {pendingDebates list, if any}
  PENDING DECISIONS: {pendingDecisions list, if any}

  STORY FILE: {activeStoryFile, if any}
  PROGRESS: {completed tasks}/{total tasks} ({percent}%)
  NEXT TASK: {ID and description of the next pending task from the story file}
  ```

**Using activeStoryFile:** If the checkpoint has `activeStoryFile`, ULTRON MUST read the story file at `~/.claude/aios/stories/{activeStoryFile}` and use pending tasks to guide resumption. The story file takes priority over `nextAction` when deciding what to do next.

**Using activityLogSnapshot:** When restoring, ULTRON MUST compare the snapshot IDs with the current activity-log IDs. If there is a mismatch (current IDs > snapshot), another session has appended entries — notify the user about possible drift.

> **REMOVED (M3):** the former "Using graphInstanceId" step is gone. `graphInstanceId` and `state_graph.json` were retired (state graph moved to `_deprecated/`); checkpoints no longer carry a graph instance and `/continue` resumes from `nextAction` + the story file + the activity-log, not from a graph.

- Continue where you left off (execute nextAction, or the next task from the story file)

### If 2+ paused checkpoints:
- List every project with a one-line summary
- Ask the user which one to continue
- Restore only the chosen one

### Crash Recovery (sessionEndedNormally: false + status.json is idle):
- Warn the user: "The previous session may have ended abnormally"
- List modifiedFiles with state pending_*
- Ask for confirmation before continuing
- FORGE verifies the actual state of the listed files

## When to ARCHIVE a checkpoint

Move from activeCheckpoints to archivedCheckpoints when:
- All tasks in workStack are `done` in the activity-log → archiveReason: "auto_detected_completion"
- The project is explicitly completed by the user → archiveReason: "completed"
- The user discards the checkpoint → archiveReason: "user_discarded"

## Multi-Run Mode (parallelism Fase A)

When `~/.claude/aios/runs/` exists, the root `status.json` is a lightweight INDEX
of active runs (`schema: "aios-runs-index-v1"`, field `activeRuns[]`) and the full
breadcrumb state lives PER RUN in `runs/{runId}/status.json` (same recovery fields,
schema `aios-status-v1`). In this mode:

- The "Early Save via status.json" breadcrumb below applies to each run's
  `runs/{runId}/status.json`, not the root.
- `/continue` reads the root index first (Nivel 0): 1 active run → resume it;
  2+ → list `activeRuns` and ask which to resume. See `continue.md` Nivel 0 and
  `runs-protocol.md`.
- **Backward compatible:** if `runs/` does not exist, everything below is
  unchanged — the root `status.json` IS the single-run breadcrumb as before.

## Early Save via status.json

status.json works as a "breadcrumb" — it marks where AIOS was at each moment. In the event of a crash (terminal closed abruptly), the recovery fields allow enough context to be reconstructed.

### Recovery Fields
- `activeStoryFile`: active story file (to read task progress)
- `lastActivityIds`: snapshot of activity-log IDs (to detect post-crash activity)
- `modifiedFiles`: files touched in this cycle (for state verification)
- `recoveryHint`: human description of what to do next

### When It Is Used
The early save is used by `/continue` when **no paused checkpoint exists** but `status.json` shows `phase != "idle"` — indicating a crash of the previous session.

### Difference from Full Save (Checkpoint)
| Aspect | Early Save (status.json) | Full Save (checkpoint) |
|---------|-------------------------|----------------------|
| Fidelity | Medium | High |
| Overhead | Zero | Read-merge-write-index-log |
| Trigger | Every phase transition | End of cycle / pause |
| Recovery | Requires user confirmation | Automatic |

### Crash Recovery via status.json

When `/continue` detects a crash (phase != idle without a checkpoint):
1. Extract project, phase, activeTask, activeAgent from status.json
2. Read the activity-log for the project's entries (recent actions, in_progress tasks)
3. Read the story file if activeStoryFile exists (task progress)
4. Present a summary to the user with a crash warning
5. **Ask for confirmation** before continuing (state may be inconsistent)
6. If confirmed: create a retroactive checkpoint + follow the normal flow
7. If denied: reset status.json to idle

### Staleness Detection
If status.json's `lastUpdate` is older than 24 hours, treat it as potentially stale (not a recent crash). Ask the user whether they want to:
- Continue the work (treat it as a crash)
- Clear the state (reset status.json to idle)

## Edge Cases
- Obsolete checkpoint: if workStack.task.id is done in the activity-log, archive automatically
- Multi-project: NEVER restore multiple checkpoints simultaneously
- Crash without a checkpoint: if status.json has phase != idle but there is no checkpoint, `/continue` uses status.json + activity-log + story file to reconstruct context (see "Early Save via status.json")

## Dev Servers and Long-Running Processes

**MANDATORY RULE:** Every dev server or long-running process MUST be started with `run_in_background: true` on the Bash tool.

### Protocol
1. **Before starting:** ULTRON MUST save a checkpoint (or update status.json with recoveryHint)
2. **When starting:** Use `run_in_background: true` on the Bash tool — NEVER foreground
3. **After starting:** Commit partial changes if there is unsaved code

### Covered processes
- `npm run dev`, `next dev`, `vite dev`
- `node server.js`, `python manage.py runserver`
- `cargo run`, `go run`
- Any process listening on a local port

### Justification
If the process runs in the foreground and the user closes the port/terminal, Claude Code may lose the entire session. With `run_in_background: true`, the process runs independently and the AIOS session is not affected.
