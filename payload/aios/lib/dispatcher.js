#!/usr/bin/env node

/**
 * dispatcher.js — Hardware-aware run scheduler (cap + FIFO queue) for Fase A
 *
 * The dispatcher is fundamentally BEHAVIORAL: ULTRON follows it when deciding
 * how many runs/agents to launch concurrently. But the cap/queue/select-next
 * logic must be a real, testable helper — this is it.
 *
 * It reads concurrency.json (cap is config, NOT hardcoded — same engine scales
 * local->cloud just by changing the numbers, the Fase B portability path) and
 * exposes a pure-ish in-memory scheduler:
 *   - admit(): can a new run start now, or must it queue? (respects cap + g020)
 *   - enqueue()/dequeue(): FIFO queue above the cap
 *   - selectNext(): pull the next queued run when a slot frees
 *
 * Degradation graciosa: when at the run cap, new requests queue (FIFO) instead
 * of over-committing RAM — that is the entire defense against gotcha g020
 * (8GB trava). Failure of one run does NOT affect the queue (runs are isolated
 * by run-dir; the dispatcher only tracks ids).
 *
 * CommonJS. Zero external deps. Windows compatible.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = Object.freeze({
  schema: 'aios-concurrency-v1',
  maxConcurrentRuns: 2,
  maxConcurrentAgentsPerRun: 2,
  maxConcurrentAgentsGlobal: 3,
  queuePolicy: 'fifo',
  degradeToSequentialOnPressure: true,
});

function aiosRoot() {
  const override = process.env.AIOS_HOME || process.env.AIOS_DIR;
  if (override && override.trim()) return override;
  return path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'aios');
}

function configPath(root) {
  return path.join(root || aiosRoot(), 'concurrency.json');
}

/**
 * Load concurrency config from concurrency.json, falling back to conservative
 * defaults if the file is missing or malformed (fail-safe, not fail-open:
 * defaults are the SAFE small numbers).
 */
function loadConfig(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(root), 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      // never let a bad config exceed sane integer bounds
      maxConcurrentRuns: clampPositive(raw.maxConcurrentRuns, DEFAULT_CONFIG.maxConcurrentRuns),
      maxConcurrentAgentsPerRun: clampPositive(raw.maxConcurrentAgentsPerRun, DEFAULT_CONFIG.maxConcurrentAgentsPerRun),
      maxConcurrentAgentsGlobal: clampPositive(raw.maxConcurrentAgentsGlobal, DEFAULT_CONFIG.maxConcurrentAgentsGlobal),
    };
  } catch (_) {
    return { ...DEFAULT_CONFIG };
  }
}

function clampPositive(v, fallback) {
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

/**
 * Dispatcher — tracks active runs and a FIFO queue, enforcing the cap.
 *
 * In-memory by design: ULTRON drives one dispatcher per orchestration session.
 * The source of truth for which runs are persistently active is the runs index
 * (lib/runs.js); this scheduler is the decision helper layered on top.
 */
class Dispatcher {
  /**
   * @param {object} [config] - concurrency config; loaded from file if omitted
   * @param {string} [root]
   */
  constructor(config, root) {
    this.config = config || loadConfig(root);
    this.active = new Map();   // runId -> { agents: number }
    this.queue = [];           // FIFO array of { runId, payload }
  }

  /** Number of currently active runs. */
  activeRunCount() {
    return this.active.size;
  }

  /** Total agents committed across all active runs (global cap check). */
  activeAgentCount() {
    let total = 0;
    for (const r of this.active.values()) total += r.agents;
    return total;
  }

  /**
   * Can a new run start RIGHT NOW without queuing?
   * Respects maxConcurrentRuns. (Per-run/global agent caps are enforced at
   * agent-fanout time via canSpawnAgents, not at run admission.)
   */
  canAdmitRun() {
    return this.active.size < this.config.maxConcurrentRuns;
  }

  /**
   * Request to start a run. If a slot is free, marks it active and returns
   * {admitted:true}. Otherwise enqueues FIFO and returns {admitted:false, queued:true}.
   *
   * @param {string} runId
   * @param {*} [payload] - opaque data carried with the queued request
   * @returns {{admitted:boolean, queued:boolean, position?:number}}
   */
  requestRun(runId, payload) {
    if (this.active.has(runId)) {
      return { admitted: true, queued: false }; // idempotent
    }
    if (this.canAdmitRun()) {
      this.active.set(runId, { agents: 0 });
      return { admitted: true, queued: false };
    }
    this.queue.push({ runId, payload });
    return { admitted: false, queued: true, position: this.queue.length };
  }

  /**
   * Mark a run finished, freeing its slot. Returns the next queued run that can
   * now be admitted (and admits it), or null if the queue is empty.
   *
   * @param {string} runId
   * @returns {{runId:string, payload:*}|null} the newly admitted run, if any
   */
  completeRun(runId) {
    this.active.delete(runId);
    return this.selectNext();
  }

  /**
   * Pull the next queued run (FIFO) IF a slot is free, admit it, and return it.
   * Returns null if nothing to admit.
   */
  selectNext() {
    if (this.queue.length === 0) return null;
    if (!this.canAdmitRun()) return null;
    const next = this.queue.shift();
    this.active.set(next.runId, { agents: 0 });
    return next;
  }

  /**
   * Can a run spawn N more agents without breaking the per-run or global cap?
   * This is the hardware guard that keeps fan-out within RAM budget (g020).
   *
   * @param {string} runId
   * @param {number} [n=1]
   */
  canSpawnAgents(runId, n) {
    const count = n || 1;
    const run = this.active.get(runId);
    if (!run) return false;
    if (run.agents + count > this.config.maxConcurrentAgentsPerRun) return false;
    if (this.activeAgentCount() + count > this.config.maxConcurrentAgentsGlobal) return false;
    return true;
  }

  /** Record that a run spawned N agents (after canSpawnAgents passed). */
  spawnAgents(runId, n) {
    const run = this.active.get(runId);
    if (run) run.agents += (n || 1);
    return run ? run.agents : 0;
  }

  /** Record that N agents of a run finished. */
  releaseAgents(runId, n) {
    const run = this.active.get(runId);
    if (run) run.agents = Math.max(0, run.agents - (n || 1));
    return run ? run.agents : 0;
  }

  /**
   * Should the dispatcher degrade to sequential execution under pressure?
   * Heuristic (Fase A): active runs are at the run cap. When true, ULTRON runs
   * the next pipeline more sequentially instead of fanning out — graceful
   * degradation rather than blowing the RAM budget.
   */
  underPressure() {
    return this.config.degradeToSequentialOnPressure && this.active.size >= this.config.maxConcurrentRuns;
  }

  /** Snapshot for logging/inspection. */
  snapshot() {
    return {
      activeRuns: [...this.active.keys()],
      queuedRuns: this.queue.map((q) => q.runId),
      activeAgents: this.activeAgentCount(),
      underPressure: this.underPressure(),
      config: this.config,
    };
  }
}

module.exports = {
  Dispatcher,
  loadConfig,
  configPath,
  DEFAULT_CONFIG,
};
