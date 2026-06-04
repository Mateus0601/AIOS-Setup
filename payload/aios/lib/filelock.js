#!/usr/bin/env node

/**
 * filelock.js — Atomic file locking for AIOS shared JSON files
 *
 * Provides O_EXCL-based atomic locking with:
 * - Write-through-temp (.tmp + rename) for atomic writes
 * - Stale lock detection (PID check + age timeout)
 * - Exponential backoff with jitter for contention
 * - Bracket pattern (withFileLock) for safe lock/unlock
 * - readModifyWrite convenience for JSON read-modify-write cycles
 *
 * CommonJS module. Zero external dependencies. Windows 10 compatible.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULTS = Object.freeze({
  staleLockTimeoutMs: 30000,   // 30 seconds — lock considered stale
  retryBaseMs: 10,             // base delay for exponential backoff
  retryMaxMs: 5000,            // cap per-retry delay
  maxRetries: 10,              // total max ~10s worst case
  agent: 'unknown',            // calling agent name
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the .lock path for a given file path.
 * Lock lives in the same directory as the protected file.
 */
function lockPath(filepath) {
  const dir = path.dirname(filepath);
  const base = path.basename(filepath);
  return path.join(dir, base + '.lock');
}

/**
 * Generate a unique nonce for this lock holder.
 * Used to verify ownership on release.
 */
function generateNonce() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Sleep for ms milliseconds (async).
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute exponential backoff delay with jitter.
 * delay = min(base * 2^attempt + random(0, base), retryMaxMs)
 */
function backoffDelay(attempt, baseMs, maxMs) {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, maxMs);
}

/**
 * Check if a process with the given PID is alive.
 * Uses process.kill(pid, 0) which sends no signal but checks existence.
 * Works on Windows.
 */
function isPidAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process, EPERM = process exists but no permission
    if (err.code === 'EPERM') {
      return true; // process exists, we just can't signal it
    }
    return false;
  }
}

/**
 * Read and parse lock metadata from a .lock file.
 * Returns null if file doesn't exist or can't be parsed.
 */
function readLockMetadata(lockFilePath) {
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Check if a lock file is stale.
 *
 * A lock is stale if:
 * 1. The PID in the lock file is dead, OR
 * 2. The lock is older than staleLockTimeoutMs
 *
 * @param {string} lockFilePath - Path to the .lock file
 * @param {object} [opts] - Options
 * @param {number} [opts.staleLockTimeoutMs=30000] - Timeout in ms
 * @returns {{ stale: boolean, reason: string|null, metadata: object|null }}
 */
function isLockStale(lockFilePath, opts) {
  const options = Object.assign({}, DEFAULTS, opts);
  const metadata = readLockMetadata(lockFilePath);

  if (!metadata) {
    // Can't read lock file — treat as stale (file may be corrupted)
    return { stale: true, reason: 'unreadable', metadata: null };
  }

  // Check 1: PID alive?
  if (metadata.pid && !isPidAlive(metadata.pid)) {
    return { stale: true, reason: 'pid_dead', metadata };
  }

  // Check 2: Age timeout
  if (metadata.timestamp) {
    const lockAge = Date.now() - new Date(metadata.timestamp).getTime();
    if (lockAge > options.staleLockTimeoutMs) {
      return { stale: true, reason: 'timeout', metadata };
    }
  }

  return { stale: false, reason: null, metadata };
}

/**
 * Try to acquire a lock file atomically using O_EXCL.
 *
 * @param {string} filepath - Path to the file to lock (NOT the .lock file)
 * @param {object} [opts] - Options
 * @param {string} [opts.agent='unknown'] - Agent name for metadata
 * @param {number} [opts.staleLockTimeoutMs=30000] - Stale timeout
 * @param {number} [opts.retryBaseMs=10] - Base delay for backoff
 * @param {number} [opts.retryMaxMs=5000] - Max delay per retry
 * @param {number} [opts.maxRetries=10] - Max retry attempts
 * @returns {Promise<{ acquired: boolean, nonce: string|null, attempts: number, error: string|null }>}
 */
async function acquireLock(filepath, opts) {
  const options = Object.assign({}, DEFAULTS, opts);
  const lp = lockPath(filepath);
  const nonce = generateNonce();

  const metadata = JSON.stringify({
    pid: process.pid,
    agent: options.agent,
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    filepath: path.basename(filepath),
    nonce: nonce,
  }, null, 2);

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      // O_CREAT | O_EXCL | O_WRONLY — atomic create-or-fail
      const fd = fs.openSync(lp, 'wx');
      fs.writeSync(fd, metadata, 0, 'utf-8');
      fs.closeSync(fd);
      return { acquired: true, nonce, attempts: attempt + 1, error: null };
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock file already exists — check if stale
        const staleCheck = isLockStale(lp, options);
        if (staleCheck.stale) {
          // Remove stale lock and retry immediately
          try {
            fs.unlinkSync(lp);
            console.warn(
              `[filelock] Removed stale lock for ${path.basename(filepath)} ` +
              `(reason: ${staleCheck.reason}, holder PID: ${staleCheck.metadata?.pid || 'unknown'})`
            );
          } catch (unlinkErr) {
            // Another process may have already removed it — continue to retry
          }
          continue; // retry without backoff
        }

        // Lock is active — backoff and retry
        if (attempt < options.maxRetries) {
          const delay = backoffDelay(attempt, options.retryBaseMs, options.retryMaxMs);
          await sleep(delay);
          continue;
        }

        // Max retries exhausted
        return {
          acquired: false,
          nonce: null,
          attempts: attempt + 1,
          error: `Lock contention: ${path.basename(filepath)} held by PID ${staleCheck.metadata?.pid || 'unknown'} (agent: ${staleCheck.metadata?.agent || 'unknown'})`,
        };
      }

      // Unexpected error (ENOENT for missing directory, EACCES, etc.)
      return {
        acquired: false,
        nonce: null,
        attempts: attempt + 1,
        error: `Lock error: ${err.code || err.message}`,
      };
    }
  }

  return {
    acquired: false,
    nonce: null,
    attempts: options.maxRetries + 1,
    error: 'Max retries exhausted',
  };
}

/**
 * Release a lock file.
 *
 * Optionally verifies nonce to ensure we only release our own lock.
 *
 * @param {string} filepath - Path to the file that was locked (NOT the .lock file)
 * @param {object} [opts] - Options
 * @param {string} [opts.nonce] - Nonce from acquireLock to verify ownership
 * @returns {{ released: boolean, error: string|null }}
 */
function releaseLock(filepath, opts) {
  const options = opts || {};
  const lp = lockPath(filepath);

  try {
    // If nonce provided, verify ownership before releasing
    if (options.nonce) {
      const metadata = readLockMetadata(lp);
      if (metadata && metadata.nonce !== options.nonce) {
        return {
          released: false,
          error: `Lock ownership mismatch: expected nonce ${options.nonce}, found ${metadata.nonce}`,
        };
      }
    }

    fs.unlinkSync(lp);
    return { released: true, error: null };
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Lock already gone — consider it released
      return { released: true, error: null };
    }
    return { released: false, error: `Release error: ${err.code || err.message}` };
  }
}

/**
 * Bracket pattern: acquire lock, run async function, release lock.
 *
 * Guarantees lock release even if asyncFn throws.
 *
 * @param {string} filepath - Path to the file to lock
 * @param {function} asyncFn - Async function to run while lock is held.
 *                             Receives no arguments.
 * @param {object} [opts] - Options passed to acquireLock
 * @returns {Promise<*>} - Return value of asyncFn
 * @throws {Error} - If lock cannot be acquired, or if asyncFn throws
 */
async function withFileLock(filepath, asyncFn, opts) {
  const result = await acquireLock(filepath, opts);

  if (!result.acquired) {
    const error = new Error(`Failed to acquire lock for ${path.basename(filepath)}: ${result.error}`);
    error.code = 'ELOCK';
    error.attempts = result.attempts;
    throw error;
  }

  try {
    return await asyncFn();
  } finally {
    releaseLock(filepath, { nonce: result.nonce });
  }
}

/**
 * Atomic read-modify-write for JSON files.
 *
 * Flow:
 * 1. acquireLock(filepath)
 * 2. data = JSON.parse(readFileSync(filepath))
 * 3. newData = transformFn(data)
 * 4. writeFileSync(filepath + '.tmp', JSON.stringify(newData))
 * 5. renameSync(filepath + '.tmp', filepath)
 * 6. releaseLock(filepath)
 *
 * transformFn can be sync or async. It receives the parsed JSON data
 * and must return the new data to write.
 *
 * @param {string} filepath - Path to the JSON file
 * @param {function} transformFn - (data) => newData. Can be sync or async.
 * @param {object} [opts] - Options
 * @param {string} [opts.agent='unknown'] - Agent name
 * @param {string} [opts.encoding='utf-8'] - File encoding
 * @param {number} [opts.indentation=2] - JSON indentation spaces
 * @param {object} [opts.defaultData=null] - Default data if file doesn't exist
 * @returns {Promise<{ success: boolean, data: *, error: string|null, attempts: number }>}
 */
async function readModifyWrite(filepath, transformFn, opts) {
  const options = Object.assign({ encoding: 'utf-8', indentation: 2, defaultData: null }, DEFAULTS, opts);

  const lockResult = await acquireLock(filepath, options);
  if (!lockResult.acquired) {
    return {
      success: false,
      data: null,
      error: `Failed to acquire lock: ${lockResult.error}`,
      attempts: lockResult.attempts,
    };
  }

  const tmpPath = filepath + '.tmp';

  try {
    // Step 1: Read current data
    let data;
    try {
      const raw = fs.readFileSync(filepath, options.encoding);
      data = JSON.parse(raw);
    } catch (readErr) {
      if (readErr.code === 'ENOENT' && options.defaultData !== null) {
        data = JSON.parse(JSON.stringify(options.defaultData)); // deep clone
      } else {
        throw readErr;
      }
    }

    // Step 2: Transform
    const newData = await transformFn(data);

    // Step 3: Write to temp file
    const serialized = JSON.stringify(newData, null, options.indentation) + '\n';
    fs.writeFileSync(tmpPath, serialized, options.encoding);

    // Step 4: Atomic rename (same volume on NTFS = atomic)
    fs.renameSync(tmpPath, filepath);

    return {
      success: true,
      data: newData,
      error: null,
      attempts: lockResult.attempts,
    };
  } catch (err) {
    // Clean up temp file if it exists
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }

    return {
      success: false,
      data: null,
      error: `readModifyWrite error: ${err.message}`,
      attempts: lockResult.attempts,
    };
  } finally {
    releaseLock(filepath, { nonce: lockResult.nonce });
  }
}

// ---------------------------------------------------------------------------
// Utility: Force-break a lock (emergency use only)
// ---------------------------------------------------------------------------

/**
 * Force-remove a lock file regardless of ownership.
 * EMERGENCY USE ONLY. Logs a warning.
 *
 * @param {string} filepath - Path to the file (NOT the .lock file)
 * @returns {{ broken: boolean, metadata: object|null, error: string|null }}
 */
function breakLock(filepath) {
  const lp = lockPath(filepath);
  const metadata = readLockMetadata(lp);

  try {
    fs.unlinkSync(lp);
    console.warn(
      `[filelock] FORCE BREAK: Lock for ${path.basename(filepath)} removed. ` +
      `Previous holder: PID ${metadata?.pid || 'unknown'}, agent: ${metadata?.agent || 'unknown'}`
    );
    return { broken: true, metadata, error: null };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { broken: true, metadata: null, error: null };
    }
    return { broken: false, metadata, error: err.message };
  }
}

/**
 * Get lock status for a file without attempting to acquire.
 *
 * @param {string} filepath - Path to the file (NOT the .lock file)
 * @param {object} [opts] - Options
 * @returns {{ locked: boolean, stale: boolean, metadata: object|null }}
 */
function getLockStatus(filepath, opts) {
  const lp = lockPath(filepath);
  try {
    fs.accessSync(lp, fs.constants.F_OK);
  } catch (_) {
    return { locked: false, stale: false, metadata: null };
  }

  const staleCheck = isLockStale(lp, opts);
  const metadata = staleCheck.metadata || readLockMetadata(lp);

  return {
    locked: true,
    stale: staleCheck.stale,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Core API
  acquireLock,
  releaseLock,
  withFileLock,
  readModifyWrite,

  // Inspection
  isLockStale,
  getLockStatus,

  // Emergency
  breakLock,

  // Internal (exported for testing)
  _lockPath: lockPath,
  _isPidAlive: isPidAlive,
  _backoffDelay: backoffDelay,
  _generateNonce: generateNonce,
  _readLockMetadata: readLockMetadata,

  // Constants
  DEFAULTS,
};
