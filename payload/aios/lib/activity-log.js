#!/usr/bin/env node

/**
 * activity-log.js — Concurrency-safe append to activity-log.json (Fase A)
 *
 * The activity-log is the ONLY genuinely shared state file between runs, and it
 * is INTOCAVEL in shape (append-only; it already partitions by `project`). For
 * parallelism it gains exactly two things:
 *   1. an OPTIONAL `runId` field per entry (non-required, backward compatible),
 *   2. a write lock so concurrent appends from 2+ orchestrators cannot corrupt
 *      the JSON.
 *
 * The lock reuses the existing lib/filelock.js (readModifyWrite) — NO new lock
 * mechanism is created. Only orchestrators (ULTRON + sub-orchestrators) append;
 * leaf agents return data and never write here (golden rule).
 *
 * CommonJS. Zero external deps beyond the existing filelock. Windows compatible.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const filelock = require('./filelock');

function aiosRoot() {
  const override = process.env.AIOS_HOME || process.env.AIOS_DIR;
  if (override && override.trim()) return override;
  return path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'aios');
}

function logPath(root) {
  return path.join(root || aiosRoot(), 'activity-log.json');
}

const SECTIONS = ['activities', 'discussions', 'decisions', 'tasks'];

/**
 * Compute the next id for a section (max existing id + 1).
 */
function nextId(data, section) {
  const arr = Array.isArray(data[section]) ? data[section] : [];
  let max = 0;
  for (const e of arr) {
    if (e && typeof e.id === 'number' && e.id > max) max = e.id;
  }
  return max + 1;
}

/**
 * Append an entry to a section of the activity-log under a file lock.
 *
 * The entry is the caller's responsibility to shape per the section schema,
 * EXCEPT id/timestamp which are auto-filled if missing. An optional `runId`
 * may be included to trace which run produced the line — it is passed through
 * untouched (the schema now permits it).
 *
 * @param {string} section - one of activities|discussions|decisions|tasks
 * @param {object} entry - the entry payload (id/timestamp auto-filled if absent)
 * @param {object} [opts]
 * @param {string} [opts.root]
 * @param {string} [opts.agent='orchestrator'] - lock holder label
 * @param {string} [opts.runId] - convenience: stamps entry.runId if not set
 * @returns {Promise<{success, id, error, attempts}>}
 */
async function appendEntry(section, entry, opts) {
  const options = opts || {};
  if (!SECTIONS.includes(section)) {
    return { success: false, id: null, error: `Unknown section: ${section}`, attempts: 0 };
  }
  const file = logPath(options.root);

  let assignedId = null;
  const result = await filelock.readModifyWrite(
    file,
    (data) => {
      if (!data || typeof data !== 'object') data = {};
      for (const s of SECTIONS) {
        if (!Array.isArray(data[s])) data[s] = [];
      }
      const id = typeof entry.id === 'number' ? entry.id : nextId(data, section);
      assignedId = id;
      const full = {
        id,
        timestamp: entry.timestamp || new Date().toISOString(),
        ...entry,
      };
      // runId convenience: stamp from opts if the caller did not set it.
      if (options.runId && full.runId === undefined) full.runId = options.runId;
      data[section].push(full);
      return data;
    },
    { agent: options.agent || 'orchestrator' }
  );

  if (!result.success) {
    return { success: false, id: null, error: result.error, attempts: result.attempts };
  }
  return { success: true, id: assignedId, error: null, attempts: result.attempts };
}

/**
 * Convenience wrappers per section.
 */
const appendActivity = (entry, opts) => appendEntry('activities', entry, opts);
const appendTask = (entry, opts) => appendEntry('tasks', entry, opts);
const appendDiscussion = (entry, opts) => appendEntry('discussions', entry, opts);
const appendDecision = (entry, opts) => appendEntry('decisions', entry, opts);

module.exports = {
  appendEntry,
  appendActivity,
  appendTask,
  appendDiscussion,
  appendDecision,
  logPath,
  nextId,
  SECTIONS,
};
