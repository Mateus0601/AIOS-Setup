# Handoff Protocol — Structured Communication Between Agents

The Handoff Protocol defines how ULTRON sends tasks to agents (HandoffRequest) and how agents return results (HandoffResponse). It replaces ad-hoc context passing with a structured contract featuring validation, retry, and fallback.

## Schemas

The formal JSON schemas live in `~/.claude/aios/schemas/handoff/`:
- `request.schema.json` — HandoffRequest (ULTRON -> agent)
- `response-vigil.schema.json` — VIGIL Response (VIGIL -> ULTRON)
- `response-forge.schema.json` — FORGE Response (FORGE -> ULTRON)
- `response-aegis.schema.json` — AEGIS Response (AEGIS -> ULTRON)
- ~~`handoff-file.schema.json`~~ — DEPRECATED (on-disk handoff persistence retired; schema moved to `_deprecated/schemas-handoff-file/`). The live handoff is IN-PROMPT (see "Disk Persistence" below).

## Serialization/Deserialization Protocol

### Serialization (ULTRON -> agent)

ULTRON serializes the HandoffRequest into the agent's prompt using delimiters:

```
<HANDOFF_REQUEST>
{JSON of the HandoffRequest, validated against request.schema.json}
</HANDOFF_REQUEST>

{persona and natural-language instructions — duplicated from instructions.persona for compatibility}
```

**Serialization rules:**
1. The JSON inside `<HANDOFF_REQUEST>` MUST be valid and complete
2. The natural-language text AFTER the tags is a human-readable version of the same content (Phase 1 hybrid)
3. The agent MUST prioritize the structured JSON; the natural text serves as a fallback
4. `null` fields must be included explicitly (not omitted)
5. Empty arrays must be included as `[]` (not omitted)

### Deserialization (agent -> ULTRON)

The agent returns its response using delimiters:

```
<HANDOFF_RESPONSE>
{JSON of the response, matching the schema indicated in instructions.responseSchema}
</HANDOFF_RESPONSE>

{optional free text — observations, explanations, extra context}
```

**Parsing algorithm (executed by ULTRON):**

```
1. Look for <HANDOFF_RESPONSE> and </HANDOFF_RESPONSE> in the agent's output
2. If found:
   a. Extract the content between the tags
   b. Try JSON.parse() on the extracted content
   c. If JSON.parse succeeds: validate against the expected schema -> SUCCESS
   d. If JSON.parse fails:
      i.  Cleanup: remove comments (// and /* */), trailing commas, fix quotes
      ii. Try JSON.parse() again
      iii. If it succeeds: validate against the schema -> SUCCESS with warning "json_cleanup_needed"
      iv. If it fails: FALLBACK to free text
0. If the output is empty or only whitespace: return an error response immediately
   a. {"agent": target, "status": "error", "summary": "Empty agent output", "artifacts": {}, "issues": [], "metadata": {"freeText": ""}}
   b. Log warning: "handoff_response_empty"
   c. Do not attempt parsing — go directly to retry (if maxRetries > 0)
3. If the tags are NOT found:
   a. FALLBACK: treat the entire output as legacy free text
   b. Log warning: "handoff_response_not_found"
   c. Encapsulate in a minimal response with ALL required fields:
      - VIGIL: {"agent": "vigil", "status": "partial", "summary": "Response without structured schema", "artifacts": {"storyFile": null, "storyTaskCount": 0, "decisions": [], "architecture": "", "risks": []}, "issues": [], "metadata": {"analysisDepth": "quick", "debateRequired": false, "debateTopics": [], "freeText": entire_output, "position": null}}
      - FORGE: {"agent": "forge", "status": "partial", "summary": "Response without structured schema", "artifacts": {"completedTasks": [], "modifiedFiles": [], "testsRun": {"passed": 0, "failed": 0, "skipped": 0}, "storyFileUpdated": false, "reactIterations": {"totalAttempts": 1, "selfCorrections": [], "finalObserveStatus": "passed"}}, "issues": [], "metadata": {"linesAdded": 0, "linesRemoved": 0, "buildStatus": "skipped", "freeText": entire_output, "position": null, "reactEnabled": true}}
      - AEGIS: {"agent": "aegis", "status": "partial", "summary": "Response without structured schema", "artifacts": {"verdict": "approved_with_issues", "critical": [], "important": [], "minor": [], "vigilDecisionsRespected": {"total": 0, "respected": 0, "violated": 0}, "tasksVerified": {"total": 0, "verified": 0, "mismatched": 0}}, "issues": [], "metadata": {"reviewDepth": "quick", "storyFileChecked": false, "freeText": entire_output, "position": null}}
      - PM: {"agent": "pm", "status": "partial", "summary": "Response without structured schema", "artifacts": {"prdPath": null, "roadmapItems": [], "strategicDecisions": [], "delegations": [], "marketInsights": []}, "issues": [], "metadata": {"missionType": "other", "autoDecisions": 0, "delegationsRequested": 0, "freeText": entire_output, "position": null}}
      - PO: {"agent": "po", "status": "partial", "summary": "Response without structured schema", "artifacts": {"backlogItems": [], "validationResult": null, "prioritizedTasks": [], "epicCoherence": null}, "issues": [], "metadata": {"missionType": "other", "autoDecisions": 0, "storiesValidated": 0, "freeText": entire_output, "position": null}}
      - SM: {"agent": "sm", "status": "partial", "summary": "Response without structured schema", "artifacts": {"storyFile": null, "storyTaskCount": 0, "acceptanceCriteria": [], "sprintPlan": null, "impediments": []}, "issues": [], "metadata": {"missionType": "other", "autoDecisions": 0, "storiesCreated": 0, "tasksCreated": 0, "freeText": entire_output, "position": null}}
      - Analyst: {"agent": "analyst", "status": "partial", "summary": "Response without structured schema", "artifacts": {"researchReport": null, "insights": [], "recommendations": [], "competitorAnalysis": null, "marketData": null}, "issues": [], "metadata": {"missionType": "other", "autoDecisions": 0, "sourcesCount": 0, "confidenceDistribution": null, "freeText": entire_output, "position": null}}
   d. The fallback IS VALID against the corresponding agent schema (all required fields filled with defaults)
```

**Deserialization rules:**
1. The tag search is case-sensitive
2. If there are multiple `<HANDOFF_RESPONSE>` blocks, use the FIRST one
3. Text outside the tags is captured as `metadata.freeText` if the field exists in the schema
4. Empty output (no tags and no text) results in status "error" (see step 0 of the algorithm)

## Validation Protocol

### Pre-spawn — Request Validation (ULTRON validates before sending)

ULTRON MUST validate the HandoffRequest before serializing and sending it to the agent:

**Required fields (all targets):**
- `$schema` = "handoff-request-v1"
- `target` in ["vigil", "forge", "aegis", "pm", "po", "sm", "analyst"]
- `mission.id`, `mission.description`, `mission.project`, `mission.priority`
- `context` with all subfields (may be empty arrays or null)
- `chain` with all subfields
- `instructions.persona` non-empty
- `instructions.responseSchema` matches the target

**Conditional constraints by target:**
| Field | VIGIL | FORGE (medium/complex) | FORGE (simple) | AEGIS (medium/complex) | AEGIS (simple) |
|-------|-------|------------------------|-----------------|------------------------|----------------|
| chain.vigilOutput | null | REQUIRED (non-empty string) | null (allowed) | REQUIRED (non-empty string) | null (allowed) |
| chain.forgeOutput | null | null | null | REQUIRED (non-empty string) | REQUIRED (non-empty string) |
| context.assignedTasks | may be empty | RECOMMENDED non-empty | may be empty | may be empty | may be empty |
| mission.complexity | any | "medium" or "complex" | "simple" | "medium" or "complex" | "simple" |
| instructions.responseSchema | "response-vigil" | "response-forge" | "response-forge" | "response-aegis" | "response-aegis" |

**Conditional constraints by target (Product Squad):**
| Field | PM | PO | SM | Analyst |
|-------|----|----|----|----|
| chain.vigilOutput | null (allowed) | null (allowed) | null (allowed) | null (allowed) |
| chain.forgeOutput | null (allowed) | null (allowed) | null (allowed) | null (allowed) |
| context.assignedTasks | may be empty | may be empty | may be empty | may be empty |
| mission.complexity | any | any | any | any |
| instructions.responseSchema | "response-pm" | "response-po" | "response-sm" | "response-analyst" |

**If validation fails:**
- ULTRON fixes internally (fills missing fields with reasonable defaults)
- Logs a warning in activity-log: action="handoff_request_validation_fix", detail with the fixed fields
- DOES NOT spawn with an invalid request

### Post-receive — Response Validation (ULTRON validates after receiving)

ULTRON MUST validate the HandoffResponse after parsing:

**Required fields (all responses):**
- `agent` in ["vigil", "forge", "aegis", "pm", "po", "sm", "analyst"] and matches the original target
- `status` in ["success", "partial", "error"]
- `summary` non-empty string

**Required fields per agent:**
- VIGIL: `artifacts.decisions` (array), `artifacts.architecture` (string)
- FORGE: `artifacts.completedTasks` (array), `artifacts.modifiedFiles` (array)
- AEGIS: `artifacts.verdict` in ["approved", "approved_with_issues", "rejected"]
- PM: `artifacts.prdPath` (string or null), `artifacts.strategicDecisions` (array)
- PO: `artifacts.backlogItems` (array), `artifacts.prioritizedTasks` (array)
- SM: `artifacts.storyFile` (string or null), `artifacts.acceptanceCriteria` (array)
- Analyst: `artifacts.researchReport` (string or null), `artifacts.insights` (array)

**Validation levels:**
| Level | Condition | Action |
|-------|----------|------|
| VALID | Parseable JSON + all required fields present + correct types | Accept normally |
| PARTIAL | Parseable JSON + required fields present + some types incorrect | Accept with warnings, log in activity-log |
| INCOMPLETE | Parseable JSON + some required fields missing | Accept with warnings, fill missing with defaults |
| INVALID | Unparseable JSON or completely off-schema | Fallback to free text OR retry |

## Retry Policy and Circuit Breaker

### Retry per Attempt

| Attempt | Action |
|-----------|------|
| 1st | Normal spawn with full HandoffRequest + natural text (Phase 1 hybrid) |
| 2nd | Re-spawn with `instructions.retryHint` = "You must return `<HANDOFF_RESPONSE>` with valid JSON at the start of your reply. Follow the schema {responseSchema}." |
| 3rd (final) | Re-spawn with `instructions.retryHint` = "LAST ATTEMPT. Return ONLY the `<HANDOFF_RESPONSE>` block with JSON. Minimum template: {schema with required fields and placeholder values}" |
| After 3 failures | FALLBACK: accept free text as `metadata.freeText`, log warning "handoff_max_retries_exceeded" |

**Re-spawn mechanism:**
- ULTRON re-sends the COMPLETE HandoffRequest (same mission, context, chain) with the `instructions.retryHint` field populated
- The agent's prior output is added to `chain.debateHistory` as an entry: `{"from": target, "to": "ultron", "topic": "retry_context", "message": "[previous output truncated to 2000 chars]"}`
- The `instructions.maxRetries` field is decremented by 1 on each retry for tracking

**Retry rules:**
- Retry only occurs if the response is INVALID (unparseable JSON AND no tags)
- PARTIAL or INCOMPLETE responses do NOT trigger retry (they are accepted with warnings)
- The `instructions.maxRetries` field controls the limit (default: 2, max: 5)

### Circuit Breaker

**In-session failure counter (NOT persisted):**
- ULTRON keeps a running count of complete handoff failures (after all retries) within the current session. The persisted `handoffFailures` field in status.json was removed in M3 — the counter now lives only in ULTRON's working context and is reconstructed from the `circuit_breaker_triggered` / `handoff_fallback` entries in `activity-log.json` if needed.
- The count increments on each complete failure and resets on a success.
- If it exceeds 5: ULTRON MUST report it at the next checkpoint + register an automatic gotcha.

**Action when the circuit breaker trips (5+ consecutive failures):**
1. Log in activity-log: action="circuit_breaker_triggered", detail="Handoff failures exceeded threshold: {count}"
2. Register gotcha: category="handoff", severity="critical", title="Circuit breaker: handoff failing repeatedly"
3. Include in the next checkpoint for user visibility
4. Keep operating in free-text mode (graceful degradation) until handoffs work again

## Migration Plan and Backward Compatibility

> **HISTORICAL.** This was a one-time migration from free-text handoffs to the structured in-prompt envelope. That migration is **complete**: the in-prompt model (HandoffRequest/HandoffResponse in the prompt) is the live state. The tracking fields `handoffPhase` and `handoffFailures` were **removed from `status.json` in M3** (no live reader after `state_graph.json` was deprecated). The phased plan below is kept only as historical context — there is no active phase counter anymore.

### Tracking the Current Phase — REMOVED

The `handoffPhase`/`handoffFailures` fields in `status.json` were removed in M3. Originally they tracked the active migration phase (integer enum [1,2,3]) with automatic regression on repeated failures. ULTRON no longer reads or writes them.

### Phase 1 — Hybrid Templates (IMMEDIATE — current state)

**Input to agents (ULTRON -> agent):**
- HandoffRequest JSON inside `<HANDOFF_REQUEST>` tags
- Natural text duplicated AFTER the tags (persona, context, instructions)
- Agent receives BOTH formats

**Output from agents (agent -> ULTRON):**
- Agent MUST try to return `<HANDOFF_RESPONSE>` with JSON
- If not, free text is accepted normally (legacy fallback)
- ULTRON tries to parse the JSON; if it fails, uses free text

**Exit criterion from Phase 1:**
- 5+ consecutive cycles with every handoff returning valid JSON
- Zero circuit breaker trips in those 5 cycles
- Record in activity-log: action="handoff_phase_transition", detail="Phase 1 -> Phase 2"

### Phase 2 — Schema-First (AFTER 5 CYCLES WITHOUT FAILURE)

**Input to agents:**
- HandoffRequest JSON inside `<HANDOFF_REQUEST>` tags
- Natural text REMOVED (only the `instructions.persona` field remains in the JSON)
- Agent receives ONLY the structured schema

**Output from agents:**
- `<HANDOFF_RESPONSE>` with JSON is REQUIRED
- Free text still accepted as fallback, but generates a warning
- Retry triggered more aggressively (retry on INCOMPLETE responses as well)

**Exit criterion from Phase 2:**
- 10+ consecutive cycles without a fallback to free text
- Zero retries in those 10 cycles

### Phase 3 — Schema-Only (AFTER 10+ CYCLES WITHOUT FAILURE)

**Input to agents:**
- Only `<HANDOFF_REQUEST>` with JSON (no duplicated natural text)

**Output from agents:**
- Only `<HANDOFF_RESPONSE>` with JSON
- Free text accepted ONLY in the `metadata.freeText` field inside the JSON
- Fallback to free text generates a warning + increments handoffFailures

**Note:** The transition between phases is recorded in the activity-log and in the checkpoint. Regression (returning to the previous phase) is automatic if handoffFailures > 3 in the current phase.

## Trade-offs and Strategic Decisions

### 1. Rigid vs Flexible Schema
- **Chosen:** Flexible Schema (Soft Schema)
- **Justification:** The medium is string in / string out (LLM prompts). There is no real-time validation runtime. A rigid schema that rejects valid-but-incomplete outputs would lose useful agent work.
- **Trade-off:** Less structural guarantee, but zero data loss. Leveled validation (valid/partial/incomplete/invalid) mitigates the risk.

### 2. JSON in the Prompt vs Natural Text
- **Chosen:** JSON + Natural Text (Phase 1 hybrid, converging to JSON-only)
- **Justification:** LLMs respond well to JSON when they receive JSON, but persona/behavioral instructions work better in natural language. The envelope pattern separates structured data (JSON) from behavioral instructions (persona in text).
- **Trade-off:** ~300 extra tokens in Phase 1 due to duplication. Negligible compared to the total cost of a spawn (~4000-8000 tokens).

### 3. Serialization Overhead
- **Impact:** Negligible
- **Justification:** ~300 extra tokens on the request + ~200 extra tokens on the response (tags + JSON boilerplate). Parsing is in microseconds. The gain in structure, traceability, and debugging more than compensates.

### 4. Retry vs Accept-and-Move-On
- **Chosen:** Limited retry (max 3) + Accept as final fallback
- **Justification:** Retries cost tokens and time. After 3 attempts, the probability of success drops sharply. Accepting free text as a fallback is better than blocking the entire pipeline.
- **Trade-off:** In a total-failure scenario, ULTRON operates with unstructured data (like before the Handoff Protocol). It is not a regression — it is graceful degradation.

### 5. Envelope Pattern vs Fully Separate Schemas
- **Chosen:** Envelope Pattern (single base schema with per-target conditionals)
- **Justification:** Reduces duplication (mission, context, instructions are identical across targets). Conditionals (`allOf` with `if/then`) ensure agent-specific fields are validated. Extensible — adding a new agent only needs a new conditional.
- **Trade-off:** Schema is harder to read (allOf/if/then). Mitigated by clear documentation and by each response having its own separate (simpler) schema.

### 6. Delimiter Tags vs Pure JSON
- **Chosen:** Delimiter tags (`<HANDOFF_REQUEST>` / `<HANDOFF_RESPONSE>`)
- **Justification:** They allow structured JSON to coexist with free text in the same output. Robust parsing (looking for tags is trivial). Compatible with the Phase 1 hybrid where natural text coexists with JSON.
- **Trade-off:** If the LLM produces malformed tags (e.g. opening tag without closing one), parsing fails. Mitigated by the free-text fallback.

## Disk Persistence — Handoff Files — DEPRECATED

> **DEPRECATED (retired in the M3 pruning).** Handoffs are NO LONGER persisted to disk. The whole on-disk mechanism — the `~/.claude/aios/handoffs/` tree, `handoff-file.schema.json` (now in `_deprecated/schemas-handoff-file/`), the `aios-handoff-file-v1` payload, and its `state_graph.json` companion (also in `_deprecated/`) — is gone.
>
> **The live handoff is IN-PROMPT.** ULTRON serializes the HandoffRequest into the spawned agent's prompt (`<HANDOFF_REQUEST>` … `</HANDOFF_REQUEST>`, validated against `request.schema.json`) and parses the `<HANDOFF_RESPONSE>` it returns. Nothing is written to a handoff directory and no `debateRound`/`graphInstanceId` is tracked. **Auditability comes from `activity-log.json`**, not from per-handoff files.

## Quick Reference

### For ULTRON (Orchestrator)
1. Build the HandoffRequest per `request.schema.json`
2. Validate pre-spawn (required fields + conditionals per target)
3. Serialize with `<HANDOFF_REQUEST>` tags + natural text (Phase 1)
4. Spawn the agent via the Task tool
5. Parse the response with the deserialization algorithm
6. Validate post-receive (required fields + types)
7. If invalid: retry up to maxRetries, then fallback
8. Log the outcome to `activity-log.json` (`handoff_recebido` / `handoff_retry` / `handoff_fallback`). The legacy `handoffFailures` counter in status.json was removed in M3.

### For Agents (VIGIL, FORGE, AEGIS)
1. Read `<HANDOFF_REQUEST>` from the prompt
2. Execute the task per mission and context
3. Return `<HANDOFF_RESPONSE>` with JSON per the indicated responseSchema
4. Additional free text may go AFTER the response block

### Activity-Log Logging
Handoff actions must be recorded:
- `action="handoff_enviado"` — ULTRON sent a request (detail with target and mission.id)
- `action="handoff_recebido"` — ULTRON received a response (detail with agent and status)
- `action="handoff_retry"` — ULTRON retried (detail with attempt and reason)
- `action="handoff_fallback"` — ULTRON used free-text fallback (detail with reason)
- `action="handoff_request_validation_fix"` — ULTRON fixed the request (detail with fields)
- `action="circuit_breaker_triggered"` — Failure threshold exceeded
- `action="handoff_phase_transition"` — Transition between migration phases
