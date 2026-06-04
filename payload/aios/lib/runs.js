#!/usr/bin/env node

/**
 * runs.js — Run namespacing for AIOS multi-project parallelism (Fase A)
 *
 * A "run" is one execution = (project + mission + timestamp). Each run is fully
 * isolated on disk under runs/{runId}/ so two runs NEVER touch the same state
 * file. The root status.json becomes a lightweight INDEX of active runs.
 *
 * Backward compatibility (R3): if runs/ does not exist, nothing here is forced
 * on the engine — the legacy single-run status.json keeps working exactly as
 * before. These helpers only ACT when an orchestrator opts into runs.
 *
 * Golden rule (problem #2): only the orchestrator writes state. Leaf agents
 * return data in the HANDOFF_RESPONSE; the orchestrator calls writeRunStatus /
 * writeRunResult to persist. This module is the orchestrator's state writer.
 *
 * CommonJS. Zero external deps. Windows 10 compatible.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function aiosRoot() {
  // Sandbox/test override: AIOS_HOME (or AIOS_DIR) lets a caller point the whole
  // engine at a throwaway dir WITHOUT touching the live ~/.claude/aios. Default
  // stays the real home so production behavior is unchanged.
  const override = process.env.AIOS_HOME || process.env.AIOS_DIR;
  if (override && override.trim()) return override;
  return path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'aios');
}

function runsDir(root) {
  return path.join(root || aiosRoot(), 'runs');
}

function indexPath(root) {
  return path.join(root || aiosRoot(), 'status.json');
}

function runDir(runId, root) {
  return path.join(runsDir(root), runId);
}

function runStatusPath(runId, root) {
  return path.join(runDir(runId, root), 'status.json');
}

function runResultsDir(runId, root) {
  return path.join(runDir(runId, root), 'results');
}

// ---------------------------------------------------------------------------
// runId — deterministic: run-{project}-{YYYYMMDDTHHmmss}
// ---------------------------------------------------------------------------

/**
 * Short deterministic hash of a string (FNV-1a, 32-bit) as base36.
 * Used to keep distinct non-ASCII project names distinct after slugifying
 * (two different non-ASCII names would otherwise both collapse to '' and
 * collide on a fixed fallback). Stable across runs and platforms.
 */
function shortHash(s) {
  let h = 0x811c9dc5; // FNV offset basis
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // >>> 0 to get an unsigned 32-bit int, base36 for compactness
  return (h >>> 0).toString(36).slice(0, 8);
}

/**
 * Slugify a project name so it is safe in a directory name.
 * Lowercases, replaces non-alphanumerics with '-', collapses repeats.
 * When the slug collapses to empty (e.g. a fully non-ASCII name), fall back to
 * a short hash of the ORIGINAL name so two distinct names stay distinct
 * (instead of both becoming a fixed 'unknown' and colliding).
 */
function slugifyProject(project) {
  const raw = String(project || 'unknown');
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (slug) return slug;
  // Empty slug (non-ASCII / symbol-only name): preserve distinction via hash.
  return 'x-' + shortHash(raw);
}

/**
 * Format a Date as YYYYMMDDTHHmmss (UTC) — the deterministic timestamp segment.
 */
function formatRunTimestamp(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/**
 * Generate a deterministic runId for a project at a given time.
 * @param {string} project
 * @param {Date} [date] - defaults to now
 * @returns {string} run-{project}-{YYYYMMDDTHHmmss}
 */
function makeRunId(project, date) {
  return `run-${slugifyProject(project)}-${formatRunTimestamp(date)}`;
}

// ---------------------------------------------------------------------------
// Index (root status.json as activeRuns index)
// ---------------------------------------------------------------------------

const INDEX_SCHEMA = 'aios-runs-index-v1';

/**
 * A run-dir is "valid" (i.e. a REAL run, not a leftover/empty artifact) iff it
 * is a directory that contains a status.json. An empty dir or a stray file does
 * NOT count — that is what made the half-state (g060): the test left an empty
 * runs/ behind and the old detector flipped the whole engine to multi-run mode
 * even though zero real runs existed and the root was still legacy single-run.
 */
function isValidRunDir(runId, root) {
  try {
    if (!fs.statSync(runDir(runId, root)).isDirectory()) return false;
    return fs.statSync(runStatusPath(runId, root)).isFile();
  } catch (_) {
    return false;
  }
}

/**
 * List run-dirs on disk that actually contain a status.json (real runs).
 * Returns runIds. Used as the ground truth for multi-run detection so the mode
 * never depends on the mere existence of an (possibly empty) runs/ folder.
 */
function listRunDirsOnDisk(root) {
  let entries;
  try {
    entries = fs.readdirSync(runsDir(root), { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.isDirectory() && isValidRunDir(e.name, root)) out.push(e.name);
  }
  return out;
}

/**
 * Detect whether the engine is operating in multi-run mode.
 *
 * FIXED (g060): multi-run mode means there are REAL active runs, NOT merely that
 * the runs/ directory exists. We are in multi-run mode iff EITHER
 *   (a) the index (root status.json, schema aios-runs-index-v1) lists >= 1 run, OR
 *   (b) there is >= 1 valid run-dir on disk (a dir containing status.json).
 *
 * An empty runs/ folder (leftover test artifact) + a legacy aios-status-v1 root
 * => false => single-run mode, legacy status.json stays valid. This is what
 * heals the half-state without touching the live status.json.
 */
function isMultiRunMode(root) {
  if (listActiveRuns(root).length > 0) return true;
  if (listRunDirsOnDisk(root).length > 0) return true;
  return false;
}

/**
 * Read the root index. Returns a normalized index object.
 * If status.json is still in legacy single-run format (schema aios-status-v1),
 * returns an empty index ({activeRuns: []}) WITHOUT mutating the file — callers
 * decide when to convert the root to an index (only once runs/ is in use).
 */
function readIndex(root) {
  const p = indexPath(root);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return { schema: INDEX_SCHEMA, activeRuns: [], lastUpdate: null };
  }
  if (raw && raw.schema === INDEX_SCHEMA && Array.isArray(raw.activeRuns)) {
    return raw;
  }
  // Legacy single-run status.json — treat as no active runs in the index sense.
  return { schema: INDEX_SCHEMA, activeRuns: [], lastUpdate: raw && raw.lastUpdate || null };
}

/**
 * List active runIds from the index.
 */
function listActiveRuns(root) {
  return readIndex(root).activeRuns.map((r) => (typeof r === 'string' ? r : r.runId));
}

// ---------------------------------------------------------------------------
// Run lifecycle (orchestrator-only writers)
// ---------------------------------------------------------------------------

const RUN_STATUS_SCHEMA = 'aios-status-v1'; // reuse the existing run-state shape

/**
 * Build the default per-run status object (the 13 legacy fields), seeded with
 * the run's project. Mirrors the legacy status.json so /continue and the
 * checkpoint protocol read it identically inside a run-dir.
 */
function defaultRunStatus(project) {
  const now = new Date().toISOString();
  return {
    schema: RUN_STATUS_SCHEMA,
    activeAgent: null,
    activeTask: null,
    project: project || null,
    phase: 'idle',
    sessionStart: now,
    taskStart: null,
    lastUpdate: now,
    cycleCount: 0,
    agentsSpawned: [],
    activeStoryFile: null,
    lastActivityIds: { activities: 0, tasks: 0, discussions: 0, decisions: 0 },
    modifiedFiles: [],
    recoveryHint: null,
    missionComplexity: null,
  };
}

/**
 * Ensure the runs/ dir exists. Creating it is what flips the engine into
 * multi-run mode, so callers do this deliberately (openRun does it).
 */
function ensureRunsDir(root) {
  fs.mkdirSync(runsDir(root), { recursive: true });
}

/**
 * Decide whether a runId is already "taken" (run-dir exists OR it is registered
 * in the index). Used to guarantee a FRESH openRun never aliases an existing
 * run-dir (blocker B1: same project + same second would otherwise collide and
 * silently clobber the first run's state).
 */
function runIdTaken(runId, root) {
  try {
    if (fs.existsSync(runDir(runId, root))) return true;
  } catch (_) { /* ignore */ }
  return listActiveRuns(root).indexOf(runId) !== -1;
}

/**
 * Given a base runId, return a UNIQUE one by appending a deterministic
 * incremental suffix (-2, -3, ...) until it is free. The base itself is used
 * when free. No randomness — reproducible and testable.
 */
function disambiguateRunId(baseRunId, root) {
  if (!runIdTaken(baseRunId, root)) return baseRunId;
  for (let n = 2; ; n++) {
    const candidate = `${baseRunId}-${n}`;
    if (!runIdTaken(candidate, root)) return candidate;
  }
}

/**
 * Create (or reopen) a run-dir for a project and register it in the index.
 *
 * Two distinct paths (blocker B1 fix):
 *  - FRESH CREATE (no opts.runId): generates a deterministic base runId and, if
 *    that base is already taken (same project + same second, or already in the
 *    index/on disk), DISAMBIGUATES with an incremental suffix (-2, -3, ...). A
 *    fresh openRun therefore NEVER silently aliases an existing run-dir, so it
 *    can never clobber another run's state. Always returns created:true.
 *  - EXPLICIT REOPEN (opts.runId given): the caller is intentionally targeting a
 *    specific run (resume). Reuses that exact run-dir as before; created reflects
 *    whether status.json had to be seeded.
 *
 * - Creates runs/{runId}/ and runs/{runId}/results/.
 * - Writes runs/{runId}/status.json (default run state) if absent.
 * - Adds the runId to the root index activeRuns (idempotent).
 *
 * @param {string} project
 * @param {object} [opts]
 * @param {string} [opts.root]
 * @param {string} [opts.runId] - EXPLICIT reopen/resume of a known run
 * @param {Date}   [opts.date]
 * @param {object} [opts.meta] - extra index metadata (mission, complexity...)
 * @returns {{ runId, dir, statusPath, resultsDir, created }}
 */
function openRun(project, opts) {
  const options = opts || {};
  const root = options.root;
  const isReopen = typeof options.runId === 'string' && options.runId.length > 0;

  ensureRunsDir(root);

  // FRESH CREATE: guarantee a unique runId so we never alias an existing dir.
  // EXPLICIT REOPEN: honor the exact runId the caller asked for (resume path).
  const runId = isReopen
    ? options.runId
    : disambiguateRunId(makeRunId(project, options.date), root);

  const dir = runDir(runId, root);
  const results = runResultsDir(runId, root);
  fs.mkdirSync(results, { recursive: true });

  const sp = runStatusPath(runId, root);
  let created = false;
  if (!fs.existsSync(sp)) {
    const status = defaultRunStatus(project);
    fs.writeFileSync(sp, JSON.stringify(status, null, 2) + '\n', 'utf8');
    created = true;
  }

  registerRunInIndex(runId, { project, ...(options.meta || {}) }, root);

  return { runId, dir, statusPath: sp, resultsDir: results, created };
}

/**
 * Add a run to the root index (idempotent). Converts a legacy single-run
 * status.json into an index on first registration — this is the moment the
 * engine transitions from single-run to multi-run.
 */
function registerRunInIndex(runId, meta, root) {
  const idx = readIndex(root);
  const exists = idx.activeRuns.some((r) => (typeof r === 'string' ? r : r.runId) === runId);
  if (!exists) {
    idx.activeRuns.push({
      runId,
      project: (meta && meta.project) || null,
      startedAt: new Date().toISOString(),
      ...(meta && meta.mission ? { mission: meta.mission } : {}),
      ...(meta && meta.complexity ? { complexity: meta.complexity } : {}),
    });
  }
  idx.schema = INDEX_SCHEMA;
  idx.lastUpdate = new Date().toISOString();
  writeIndex(idx, root);
  return idx;
}

/**
 * Remove a run from the index (e.g., on completion). Does NOT delete the
 * run-dir — results stay on disk for AEGIS/checkpoint. Idempotent.
 */
function closeRunInIndex(runId, root) {
  const idx = readIndex(root);
  idx.activeRuns = idx.activeRuns.filter(
    (r) => (typeof r === 'string' ? r : r.runId) !== runId
  );
  idx.schema = INDEX_SCHEMA;
  idx.lastUpdate = new Date().toISOString();
  writeIndex(idx, root);
  return idx;
}

function writeIndex(idx, root) {
  fs.writeFileSync(indexPath(root), JSON.stringify(idx, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Per-run state I/O (orchestrator writes, everyone reads)
// ---------------------------------------------------------------------------

/**
 * Read a run's status.json. Throws if the run-dir is missing.
 */
function readRunStatus(runId, root) {
  return JSON.parse(fs.readFileSync(runStatusPath(runId, root), 'utf8'));
}

/**
 * Patch a run's status.json (shallow merge), bumping lastUpdate. Orchestrator
 * only. This is a plain write because the file is owned by exactly ONE run —
 * there is no cross-run contention on it (that is the whole point of the
 * per-run-dir isolation). The only genuinely shared file (activity-log) uses
 * the filelock instead (see lib/activity-log.js).
 */
function writeRunStatus(runId, patch, root) {
  const cur = readRunStatus(runId, root);
  const next = { ...cur, ...(patch || {}), lastUpdate: new Date().toISOString() };
  fs.writeFileSync(runStatusPath(runId, root), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

/**
 * Persist a structured agent result into runs/{runId}/results/{agent}.json.
 * This is how the orchestrator records what a leaf agent RETURNED in its
 * HANDOFF_RESPONSE (the golden rule: agents return, orchestrator writes).
 *
 * @param {string} runId
 * @param {string} agent - e.g. "forge", "aegis" (used as the filename)
 * @param {object} result - the structured HANDOFF_RESPONSE payload
 * @param {string} [root]
 * @returns {string} path written
 */
function writeRunResult(runId, agent, result, root) {
  const dir = runResultsDir(runId, root);
  fs.mkdirSync(dir, { recursive: true });
  const safe = slugifyProject(agent) || 'agent';
  const file = path.join(dir, `${safe}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return file;
}

/**
 * List result files for a run (basenames without extension = agent ids).
 */
function listRunResults(runId, root) {
  const dir = runResultsDir(runId, root);
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch (_) {
    return [];
  }
}

module.exports = {
  // path helpers
  aiosRoot,
  runsDir,
  indexPath,
  runDir,
  runStatusPath,
  runResultsDir,
  // runId
  slugifyProject,
  shortHash,
  formatRunTimestamp,
  makeRunId,
  runIdTaken,
  disambiguateRunId,
  // mode + index
  isMultiRunMode,
  isValidRunDir,
  listRunDirsOnDisk,
  readIndex,
  listActiveRuns,
  registerRunInIndex,
  closeRunInIndex,
  // lifecycle
  ensureRunsDir,
  openRun,
  defaultRunStatus,
  // per-run state
  readRunStatus,
  writeRunStatus,
  writeRunResult,
  listRunResults,
  // constants
  INDEX_SCHEMA,
  RUN_STATUS_SCHEMA,
};
