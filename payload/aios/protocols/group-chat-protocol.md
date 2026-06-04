# Deliberative Group Chat — Protocol

The Deliberative Group Chat is a structured multi-round debate between **Product Squad** agents for product, brand, strategy, and design decisions on complex missions, with automatic convergence. It is activated by ULTRON only for missions classified as `complex`.

**IMPORTANT:** The Group Chat is EXCLUSIVE to the Product Squad (PM, PO, SM, Analyst). The Engineering Squad (VIGIL, FORGE, AEGIS) does NOT participate in the Group Chat — they use standard sequential debates.

## When to Activate

**ACTIVATE (MANDATORY):**
- Missions classified as `complex` that involve CREATION (product, brand, software, site, app, SaaS, any form of creation)
- Decisions about product, strategy, naming, pricing, go-to-market
- Brainstorming with multiple possible PRODUCT approaches

**DO NOT activate for:**
- `simple` or `medium` tasks
- Purely technical implementation decisions (use the Engineering Squad's sequential debates)
- Direct implementation (no ambiguity)
- Adjustments, fixes, refactors (not creation)

## Round Mechanics

```
Round 1:
  ULTRON builds a prompt with topic + context
  -> Spawn PM (Morgan) (opines)      \
  -> Spawn PO (Pax) (opines)          > parallel
  -> Spawn SM (River) (opines)        |
  -> Spawn Analyst (Atlas) (opines)  /
  ULTRON collects responses, checks convergence

Round 2 (LAST if needed):
  ULTRON builds prompt with accumulated context (all previous opinions)
  -> Spawn agents again with updated context
  ULTRON checks convergence

Convergence or Round 2:
  ULTRON consolidates the final decision
```

### Round Limit
- Maximum: 2 rounds (HARD LIMIT — token savings)
- Best case: 1 round (4 spawns) — everyone converges immediately
- Worst case: 2 rounds (8 spawns) — no convergence, ULTRON breaks the tie
- Selective use (only `complex` + creation) mitigates the cost

## Position Field

Each agent returns a `position` field in its response (inside `metadata`), indicating its position relative to the others:

**Format:** String matching one of these patterns:
- `"agree_with:{agent}"` — Agrees with another agent's position (e.g. `"agree_with:vigil"`)
- `"disagree"` — Disagrees with the dominant position, without a specific alternative
- `"propose:{alternative}"` — Proposes a specific alternative (e.g. `"propose:usar_redis_em_vez_de_postgres"`)

**Rules:**
- In round 1, position is typically `"propose:{approach}"` (each agent proposes its view)
- Starting in round 2, agents may change position after seeing the prior opinions
- The position field is OPTIONAL (default null) — if missing, ULTRON infers from the textual analysis

## Convergence

**Threshold: 75% (3 out of 4 agree)**

ULTRON checks convergence after each round:

1. Parse the `position` field of each agent
2. Group by position (agree_with counts as a vote for the target)
3. If 3+ agents converge on the same position: **CONVERGED**
4. If it did not converge: next round (up to round 2)

### Convergence examples

**Convergence in round 1:**
- PM (Morgan): `"propose:approach_A"`
- PO (Pax): `"agree_with:pm"`
- SM (River): `"agree_with:pm"`
- Analyst (Atlas): `"disagree"`
- Result: 3/4 on approach_A -> CONVERGED

**No convergence (4 different proposals):**
- PM (Morgan): `"propose:approach_A"`
- PO (Pax): `"propose:approach_B"`
- SM (River): `"propose:approach_C"`
- Analyst (Atlas): `"propose:approach_D"`
- Result: 0/4 converged -> next round

## Early Exit

If it converges in round 1, ULTRON stops immediately:
- Log: `action="group_chat_converged"`, detail with round and winning position
- DO NOT spawn round 2
- Proceed with the converged decision

## Tie-Breaker

If after 2 rounds there is no convergence:
1. ULTRON analyzes all positions and arguments from all rounds
2. ULTRON makes the final decision as the tie-breaker
3. ULTRON records a detailed justification
4. Log: `action="group_chat_tiebreak"`, detail with decision and justification
5. Record in activity-log decisions with alternatives containing every position

## Prompt Template for Group Chat

```
ULTRON spawns each Product Squad agent with:

DEBATE TOPIC: {decision description}
CONTEXT: {mission context, PRD, architecture}
ROUND: {N} of max 2

[If round > 1]
PREVIOUS OPINIONS:
- PM Morgan (round {N-1}): {summary + position}
- PO Pax (round {N-1}): {summary + position}
- SM River (round {N-1}): {summary + position}
- Analyst Atlas (round {N-1}): {summary + position}

INSTRUCTION: Analyze the topic, consider previous opinions (if any),
and return your opinion with a position field in metadata.
You may agree, disagree, or propose an alternative.
```

The HandoffRequest is built as usual (per agent-templates.md), with the debate context added to `chain.debateHistory`.

## Handoff Files for Group Chat — DEPRECATED

> **DEPRECATED.** On-disk debate handoff files (`handoffs/{mission-id}/debate/round-N-*.json`) and `handoff-file.schema.json` were retired (schema moved to `_deprecated/schemas-handoff-file/`). The Group Chat now runs entirely **in-prompt**: each round's debate context travels in the HandoffRequest's `chain.debateHistory` (see the HandoffRequest note above), and the round is recorded in the activity-log (below). There is no on-disk debate directory and no `debateRound` field anymore.

## Activity-Log Logging

### activities
- `action="group_chat_round"` — ULTRON completed a round (detail: "Round {N}: PM={position}, PO={position}, SM={position}, Analyst={position}")
- `action="group_chat_converged"` — Convergence detected (detail: "Converged at round {N}: {winning_position} (agents: {list})")
- `action="group_chat_tiebreak"` — ULTRON broke a tie (detail: "Tie-break after {N} rounds: {decision}")

### discussions
Each opinion from each agent in each round produces an entry:
- `from`: agent that opined
- `to`: "ultron" (the debate is mediated by ULTRON)
- `topic`: debate topic
- `message`: agent's summary + position

### decisions
The final decision (converged or tie-break) produces an entry with:
- `agent`: "ultron" (ULTRON consolidates the decision)
- `decision`: winning position
- `justification`: why this position was chosen
- `alternatives`: all positions proposed during the debate

## State Graph Integration — REMOVED

> **REMOVED.** The state graph (`state_graph.json` + the `group-chat-deliberative` template) was retired in the M3 pruning and moved to `_deprecated/`. The Group Chat no longer records topology in a graph; the round sequence and the converged/tie-break decision live in the activity-log entries documented above.

## Costs and Mitigations

| Scenario | Spawns | Tokens (estimate) |
|---------|--------|---------------------|
| Best case (convergence round 1) | 4 | ~20k |
| Worst case (tie-break round 2) | 8 | ~40k |

**Mitigations:**
- Selective use (only `complex` + creation)
- Early exit (stop on convergence)
- HARD LIMIT of 2 rounds (token savings)
- ULTRON should be conservative in classification — when in doubt, classify as `medium`
- Accumulated context is summarized (does not pass the full output of earlier rounds)
