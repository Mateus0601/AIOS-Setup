# Story Files — Full Protocol

Story Files are human-readable Markdown plans that accompany the execution of a mission. They complement checkpoints (the technical source of truth) with a progress-oriented format.

## Files
- `~/.claude/aios/stories/` — Directory for all story files
- Naming: `story-YYYYMMDDTHHmmss.md` (compact ISO8601, no special characters)

## Relationship with Checkpoints
- A story file is a **complement**, NOT a replacement for the checkpoint
- The checkpoint is the technical source of truth (full session state)
- The story file is a readable visual plan (task progress with checkboxes)
- The checkpoint gains an `activeStoryFile` field pointing to the active story file
- The story file has a reference to the checkpoint slug in its frontmatter

## Story File Format

```markdown
---
id: story-YYYYMMDDTHHmmss
project: project-name
createdBy: vigil
createdAt: YYYY-MM-DDTHH:mm:ssZ
checkpoint: checkpoint-slug
status: in_progress
---

# Story: [Descriptive mission title]

## Goal
[1-2 sentences about what this story delivers]

## Tasks

- [ ] `T1` Task 1 description
- [ ] `T2` Task 2 description
- [x] `T3` Task 3 description (complete)
- [ ] `T4` Task 4 description

## Strategic Decisions
- [Decision 1]: Justification
- [Decision 2]: Justification

## FORGE Progress
<!-- FORGE updates this section automatically -->

### Session YYYY-MM-DDTHH:mm:ssZ
- Completed T3: [brief description of what was done]
- Started T1: [partial status]
```

## Frontmatter Fields

| Field | Type | Description |
|-------|------|-----------|
| `id` | string | Unique ID in the format `story-YYYYMMDDTHHmmss` |
| `project` | string | Project name (same as checkpoint/activity-log) |
| `createdBy` | string | Always `vigil` (VIGIL generates the story file) |
| `createdAt` | string | ISO8601 creation timestamp |
| `checkpoint` | string | Slug of the associated checkpoint (may be null if not yet created) |
| `status` | enum | `planning`, `in_progress`, `completed`, `abandoned` |

## Who Does What

### VIGIL [Strategist] — CREATES the Story File
VIGIL generates the story file as part of its approach-validation output:
1. Analyzes the mission and defines tasks with short IDs (`T1`, `T2`, ...)
2. Records strategic decisions with justifications
3. Generates the file at `~/.claude/aios/stories/story-{timestamp}.md`
4. Returns the story file path in its output to ULTRON

**When VIGIL generates a story file:**
- On every medium/large mission (one that follows the full flow with agents)
- Does NOT generate for simple tasks (one-off fix, direct question)

### FORGE [Executor] — UPDATES the Story File
FORGE updates the story file during execution:
1. When starting a task: keep `- [ ]` (do not change the checkbox)
2. When completing a task: change `- [ ]` to `- [x]`
3. Add an entry to the "FORGE Progress" section with timestamp and brief description

**How FORGE receives the story file:**
- ULTRON includes the story file path in FORGE's prompt
- FORGE reads the file, executes the tasks, and updates the file at the end

### ULTRON [Orchestrator] — MANAGES the Story File
ULTRON manages the lifecycle:
1. Includes the story file path in the checkpoint's `activeStoryFile` field
2. When restoring a checkpoint, reads the story file for context
3. When completing the mission: updates `status: completed` in the frontmatter
4. When abandoning: updates `status: abandoned`

### AEGIS [Reviewer] — READS the Story File
AEGIS uses the story file as a reference during review:
1. Compares tasks marked `[x]` with FORGE's actual output
2. Verifies that all of VIGIL's strategic decisions were respected
3. Does NOT modify the story file directly

## Task ID Rules

- Short sequential IDs: `T1`, `T2`, `T3`, ...
- IDs are unique within a story file
- If tasks are added later, continue the sequence (`T5`, `T6`, ...)
- Removed tasks: keep the ID and mark with ~~strikethrough~~ (for traceability)

## Progress — Calculation

To calculate the progress of a story file:
- Total tasks: count all `- [ ]` and `- [x]` lines (excluding ~~strikethrough~~)
- Completed tasks: count `- [x]` lines
- Progress: `completed / total * 100`

## /continue Integration

The `/continue` command uses the story file as the primary source of progress:
1. Reads the paused checkpoint → extracts `activeStoryFile`
2. Reads the story file → parses the tasks
3. Identifies the next pending task (`- [ ]` with the lowest ID)
4. Displays a readable summary to the user
5. Spawns FORGE to continue on the next pending task

## Activity-Log Logging (MANDATORY)

Story file actions must be recorded in `activity-log.json`:
- VIGIL created a story file: `action="criou_story_file"`, detail with path and task count
- FORGE updated a story file: `action="atualizou_story_file"`, detail with completed tasks
- ULTRON completed a story: `action="completou_story"`, detail with final progress
- ULTRON abandoned a story: `action="abandonou_story"`, detail with reason

## Edge Cases

- **Story file without a checkpoint:** Valid. A planning story file can exist before a checkpoint does.
- **Checkpoint without a story file:** Valid. Simple tasks may have a checkpoint without a story file.
- **Multiple story files for the same project:** Each mission generates its own story file. The checkpoint's `activeStoryFile` points to the most recent/active one.
- **Story file with all tasks complete:** ULTRON updates `status: completed` in the frontmatter.
- **Story file referenced in the checkpoint but missing/corrupt:** Treat as a checkpoint without a story file (fall back to workStack/nextAction). Log a warning in activity-log: `action="story_file_nao_encontrado"`.
- **Story file with no pending tasks (all [x] or strikethrough):** Treat the story as `completed`, update the frontmatter, use the checkpoint's `nextAction` as a fallback. If the checkpoint also has no `nextAction`, report that the mission appears to be complete.
