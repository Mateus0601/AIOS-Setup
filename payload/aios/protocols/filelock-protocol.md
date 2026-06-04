# File Locking Protocol — Concurrent Access to AIOS JSON Files

AIOS uses shared JSON files (activity-log.json, status.json, gotchas.json, etc.) that can be accessed simultaneously by multiple agents. File locking guarantees atomicity and prevents corruption.

## Module

`~/.claude/aios/lib/filelock.js` (CommonJS, zero external dependencies).

## Protected Files

| File | Risk | Write Frequency |
|---------|-------|-----------------------|
| `activity-log.json` | HIGH | Every agent action |
| `status.json` | MEDIUM | Phase transitions |
| `gotchas.json` | LOW | Problem logging |
| `checkpoints/*.json` | LOW | Session save/restore |

## API

### `readModifyWrite(filepath, transformFn, opts)` (RECOMMENDED)

Main function for most cases. Performs lock -> read -> transform -> write-tmp -> rename -> unlock atomically.

```javascript
const { readModifyWrite } = require('../lib/filelock');

const result = await readModifyWrite(
  '/path/to/activity-log.json',
  (data) => {
    data.activities.push({
      id: data.activities.length + 1,
      agent: 'forge',
      action: 'implementou_feature',
      detail: 'Created filelock.js',
      timestamp: new Date().toISOString(),
      project: 'aios-core'
    });
    return data;
  },
  { agent: 'forge' }
);

if (!result.success) {
  console.error('Failure:', result.error);
}
```

**Options:**
- `agent` (string) — Agent name (for lock metadata)
- `encoding` (string, default 'utf-8') — File encoding
- `indentation` (number, default 2) — JSON indentation spaces
- `defaultData` (object|null) — Default data if the file does not exist
- `staleLockTimeoutMs` (number, default 30000) — Timeout for stale locks
- `maxRetries` (number, default 10) — Max acquire attempts
- `retryBaseMs` (number, default 10) — Exponential backoff base
- `retryMaxMs` (number, default 5000) — Maximum delay per retry

### `withFileLock(filepath, asyncFn, opts)`

Bracket pattern for fine-grained control. Acquires the lock, runs the function, releases the lock (even if the function throws).

```javascript
const { withFileLock } = require('../lib/filelock');

await withFileLock('/path/to/status.json', async () => {
  const raw = fs.readFileSync('/path/to/status.json', 'utf-8');
  const data = JSON.parse(raw);
  data.phase = 'execution';
  data.lastUpdate = new Date().toISOString();
  fs.writeFileSync('/path/to/status.json', JSON.stringify(data, null, 2) + '\n');
}, { agent: 'ultron' });
```

**Note:** Prefer `readModifyWrite` for JSON files. Use `withFileLock` only when you need more complex logic that does not fit the read-modify-write pattern.

### `acquireLock(filepath, opts)` / `releaseLock(filepath, opts)`

Low-level API. Use only if you need full control over the lock lifecycle.

```javascript
const { acquireLock, releaseLock } = require('../lib/filelock');

const lock = await acquireLock('/path/to/file.json', { agent: 'forge' });
if (!lock.acquired) {
  console.error('Could not acquire lock:', lock.error);
  return;
}

try {
  // ... operations on the file ...
} finally {
  releaseLock('/path/to/file.json', { nonce: lock.nonce });
}
```

### `getLockStatus(filepath, opts)`

Inspects lock state without attempting to acquire.

```javascript
const { getLockStatus } = require('../lib/filelock');

const status = getLockStatus('/path/to/activity-log.json');
// { locked: true, stale: false, metadata: { pid: 12345, agent: 'forge', ... } }
```

### `breakLock(filepath)`

**EMERGENCY ONLY.** Forcibly removes the lock. Logs a warning.

```javascript
const { breakLock } = require('../lib/filelock');
breakLock('/path/to/activity-log.json');
```

## Internal Mechanism

### Atomic Lock (O_EXCL)

The lock uses `fs.openSync(path, 'wx')`, which maps to `O_CREAT | O_EXCL | O_WRONLY`:
- If the file does NOT exist: creates it and acquires the lock (atomic in the kernel)
- If the file EXISTS: fails with EEXIST (another holder owns the lock)
- Atomic guarantee from the filesystem — no race condition between check and create

### Lock File

The `.lock` file lives in the same directory as the protected file:
- `activity-log.json` -> `activity-log.json.lock`
- `status.json` -> `status.json.lock`

Lock file contents (JSON):
```json
{
  "pid": 12345,
  "agent": "forge",
  "timestamp": "2026-02-19T10:30:00.000Z",
  "hostname": "DESKTOP-XXX",
  "filepath": "activity-log.json",
  "nonce": "a1b2c3d4e5f6g7h8"
}
```

### Write-Through-Temp

Every atomic write follows the pattern:
1. Writes to `{filepath}.tmp`
2. `fs.renameSync('{filepath}.tmp', '{filepath}')` — atomic on NTFS (same volume)

This prevents corruption if the process dies during the write: either the file has the complete old contents or the complete new contents.

### Stale Lock Detection

A lock is considered stale (and removed automatically) if:
1. **PID dead:** `process.kill(pid, 0)` throws (the process no longer exists)
2. **Timeout:** The lock is older than 30 seconds (default `staleLockTimeoutMs`)

On stale detection, the lock is removed and the acquire retries without backoff.

### Retry with Exponential Backoff + Jitter

If the lock is active (not stale), the acquire uses exponential backoff:
- `delay = min(base * 2^attempt + random(0, base), maxDelay)`
- Base: 10ms, Max delay: 5000ms, Max retries: 10
- Total worst case: ~10 seconds
- Jitter prevents thundering herd when multiple agents compete

## When to Use (MANDATORY)

### MUST use `readModifyWrite`:
- Every write to `activity-log.json`
- Every write to `status.json`
- Every write to `gotchas.json`
- Every write to checkpoints

### MAY use `withFileLock`:
- Complex operations that read/write multiple fields
- Operations that are not pure read-modify-write

### NO lock needed:
- Pure reads (read-only) — tolerates slightly stale reads
- Write-once files (created once and never modified)
- Story files (written by a single agent at a time, by design)

## Performance

- Lock acquire: < 0.5ms (uncontended case)
- Total lock held: ~5ms for activity-log.json (~52KB)
- Throughput: ~100 writes/second (single writer)
- `.tmp` + rename overhead: negligible (<1ms)

## Troubleshooting

### Orphan lock file (process crashed)
Stale detection handles it automatically. If you need to do it manually:
```javascript
const { breakLock } = require('../lib/filelock');
breakLock('/path/to/file.json');
```

### Lock timeout (lock active >30s)
Usually indicates a stuck agent. The lock is removed automatically after the timeout. If the agent was legitimately working, it will get an error when trying to release the lock (nonce mismatch, ignorable).

### High contention (many retries)
Check whether agents are holding locks for too long. `readModifyWrite` minimizes lock-held time by reading, transforming, and writing in a quick sequence.
