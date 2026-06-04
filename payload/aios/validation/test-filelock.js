#!/usr/bin/env node

/**
 * test-filelock.js — Test suite for filelock.js
 *
 * Validates:
 * - Atomic lock acquire/release
 * - O_EXCL exclusion (two acquires on same file)
 * - Stale lock detection (PID dead, timeout)
 * - Write-through-temp (readModifyWrite)
 * - Bracket pattern (withFileLock)
 * - Backoff behavior
 * - Nonce ownership verification
 * - Edge cases (missing file, corrupted lock, etc.)
 *
 * Usage: node ~/.claude/aios/validation/test-filelock.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const filelock = require('../lib/filelock');

// ---------------------------------------------------------------------------
// Test framework (minimal, zero deps)
// ---------------------------------------------------------------------------

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertIncludes(str, substr, message) {
  if (typeof str !== 'string' || !str.includes(substr)) {
    throw new Error(
      `${message || 'assertIncludes'}: expected string containing "${substr}", got ${JSON.stringify(str)}`
    );
  }
}

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err.message });
    console.log(`  [FAIL] ${name}`);
    console.log(`         ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_DIR = path.join(os.tmpdir(), 'aios-filelock-test-' + Date.now());

function testFile(name) {
  return path.join(TEST_DIR, name);
}

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[warn] Could not clean up test dir: ${err.message}`);
  }
}

function writeTestJson(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runAllTests() {
  console.log('\n=== filelock.js Test Suite ===\n');
  console.log(`Test dir: ${TEST_DIR}\n`);

  setup();

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  console.log('--- Internal helpers ---');

  await runTest('_lockPath: produces correct .lock path', async () => {
    const lp = filelock._lockPath('/some/dir/activity-log.json');
    assertEqual(lp, path.join('/some/dir', 'activity-log.json.lock'));
  });

  await runTest('_isPidAlive: current process is alive', async () => {
    assert(filelock._isPidAlive(process.pid), 'own PID should be alive');
  });

  await runTest('_isPidAlive: non-existent PID is dead', async () => {
    // PID 99999999 is extremely unlikely to exist
    assert(!filelock._isPidAlive(99999999), 'fake PID should be dead');
  });

  await runTest('_isPidAlive: invalid PID returns false', async () => {
    assert(!filelock._isPidAlive(-1), 'negative PID');
    assert(!filelock._isPidAlive(0), 'zero PID');
    assert(!filelock._isPidAlive(null), 'null PID');
    assert(!filelock._isPidAlive('abc'), 'string PID');
  });

  await runTest('_backoffDelay: increases with attempts', async () => {
    const d0 = filelock._backoffDelay(0, 10, 5000);
    const d3 = filelock._backoffDelay(3, 10, 5000);
    // d3 should be significantly larger (exponential), but with jitter
    // d0 = 10*1 + jitter(0-10) = 10-20
    // d3 = 10*8 + jitter(0-10) = 80-90
    assert(d0 >= 10, `d0 should be >= 10, got ${d0}`);
    assert(d0 <= 25, `d0 should be <= 25, got ${d0}`);
    assert(d3 >= 80, `d3 should be >= 80, got ${d3}`);
  });

  await runTest('_backoffDelay: respects max cap', async () => {
    const d = filelock._backoffDelay(20, 10, 100);
    assert(d <= 100, `delay should be capped at 100, got ${d}`);
  });

  // -----------------------------------------------------------------------
  // acquireLock / releaseLock
  // -----------------------------------------------------------------------

  console.log('\n--- acquireLock / releaseLock ---');

  await runTest('acquireLock: successfully acquires on clean file', async () => {
    const fp = testFile('test-acquire.json');
    writeTestJson(fp, { test: true });

    const result = await filelock.acquireLock(fp, { agent: 'test' });
    assert(result.acquired, 'should acquire lock');
    assert(result.nonce, 'should have nonce');
    assertEqual(result.attempts, 1, 'should acquire on first attempt');
    assert(result.error === null, 'no error');

    // Lock file should exist
    const lockFile = filelock._lockPath(fp);
    assert(fs.existsSync(lockFile), 'lock file should exist');

    // Lock file should have valid metadata
    const metadata = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    assertEqual(metadata.pid, process.pid, 'PID should match');
    assertEqual(metadata.agent, 'test', 'agent should match');
    assert(metadata.timestamp, 'should have timestamp');
    assert(metadata.hostname, 'should have hostname');
    assertEqual(metadata.nonce, result.nonce, 'nonce should match');

    // Cleanup
    filelock.releaseLock(fp, { nonce: result.nonce });
  });

  await runTest('releaseLock: removes lock file', async () => {
    const fp = testFile('test-release.json');
    writeTestJson(fp, { test: true });

    const lock = await filelock.acquireLock(fp, { agent: 'test' });
    const lockFile = filelock._lockPath(fp);
    assert(fs.existsSync(lockFile), 'lock file should exist before release');

    const result = filelock.releaseLock(fp, { nonce: lock.nonce });
    assert(result.released, 'should release');
    assert(!fs.existsSync(lockFile), 'lock file should not exist after release');
  });

  await runTest('releaseLock: nonce mismatch prevents release', async () => {
    const fp = testFile('test-nonce-mismatch.json');
    writeTestJson(fp, { test: true });

    const lock = await filelock.acquireLock(fp, { agent: 'test' });
    const result = filelock.releaseLock(fp, { nonce: 'wrong-nonce' });
    assert(!result.released, 'should not release with wrong nonce');
    assertIncludes(result.error, 'ownership mismatch');

    // Cleanup with correct nonce
    filelock.releaseLock(fp, { nonce: lock.nonce });
  });

  await runTest('releaseLock: without nonce releases anyway', async () => {
    const fp = testFile('test-release-no-nonce.json');
    writeTestJson(fp, { test: true });

    await filelock.acquireLock(fp, { agent: 'test' });
    const result = filelock.releaseLock(fp); // no nonce
    assert(result.released, 'should release without nonce check');
  });

  await runTest('releaseLock: already released returns success', async () => {
    const fp = testFile('test-release-nonexistent.json');
    const result = filelock.releaseLock(fp);
    assert(result.released, 'releasing non-existent lock should succeed');
  });

  // -----------------------------------------------------------------------
  // Exclusion (two acquires)
  // -----------------------------------------------------------------------

  console.log('\n--- Exclusion ---');

  await runTest('acquireLock: second acquire fails when lock held (limited retries)', async () => {
    const fp = testFile('test-exclusion.json');
    writeTestJson(fp, { test: true });

    const lock1 = await filelock.acquireLock(fp, { agent: 'holder' });
    assert(lock1.acquired, 'first lock should succeed');

    // Second acquire with minimal retries to avoid long wait
    const lock2 = await filelock.acquireLock(fp, {
      agent: 'contender',
      maxRetries: 2,
      retryBaseMs: 5,
      retryMaxMs: 20,
    });
    assert(!lock2.acquired, 'second lock should fail');
    assertIncludes(lock2.error, 'Lock contention');
    assert(lock2.attempts >= 2, 'should have retried');

    // Cleanup
    filelock.releaseLock(fp, { nonce: lock1.nonce });
  });

  // -----------------------------------------------------------------------
  // Stale lock detection
  // -----------------------------------------------------------------------

  console.log('\n--- Stale lock detection ---');

  await runTest('isLockStale: active lock is not stale', async () => {
    const fp = testFile('test-stale-active.json');
    writeTestJson(fp, { test: true });

    const lock = await filelock.acquireLock(fp, { agent: 'test' });
    const lockFile = filelock._lockPath(fp);
    const result = filelock.isLockStale(lockFile);
    assert(!result.stale, 'active lock should not be stale');

    filelock.releaseLock(fp, { nonce: lock.nonce });
  });

  await runTest('isLockStale: lock with dead PID is stale', async () => {
    const lockFile = testFile('test-stale-deadpid.json.lock');
    // Write lock with a PID that almost certainly doesn't exist
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: 99999999,
      agent: 'dead-agent',
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      filepath: 'test.json',
      nonce: 'abc123',
    }));

    const result = filelock.isLockStale(lockFile);
    assert(result.stale, 'lock with dead PID should be stale');
    assertEqual(result.reason, 'pid_dead');
  });

  await runTest('isLockStale: old lock is stale by timeout', async () => {
    const lockFile = testFile('test-stale-timeout.json.lock');
    // Write lock with timestamp 60 seconds ago
    const oldTimestamp = new Date(Date.now() - 60000).toISOString();
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid, // alive PID, but old
      agent: 'old-agent',
      timestamp: oldTimestamp,
      hostname: os.hostname(),
      filepath: 'test.json',
      nonce: 'old123',
    }));

    const result = filelock.isLockStale(lockFile, { staleLockTimeoutMs: 30000 });
    assert(result.stale, 'old lock should be stale');
    assertEqual(result.reason, 'timeout');
  });

  await runTest('isLockStale: corrupted lock file is stale', async () => {
    const lockFile = testFile('test-stale-corrupt.json.lock');
    fs.writeFileSync(lockFile, 'not valid json!!!');

    const result = filelock.isLockStale(lockFile);
    assert(result.stale, 'corrupted lock should be stale');
    assertEqual(result.reason, 'unreadable');
  });

  await runTest('acquireLock: recovers from stale lock (dead PID)', async () => {
    const fp = testFile('test-recover-deadpid.json');
    writeTestJson(fp, { test: true });

    // Create stale lock with dead PID
    const lockFile = filelock._lockPath(fp);
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: 99999999,
      agent: 'dead-agent',
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      filepath: path.basename(fp),
      nonce: 'stale-nonce',
    }));

    // Should recover and acquire
    const lock = await filelock.acquireLock(fp, { agent: 'recovery-agent' });
    assert(lock.acquired, 'should acquire after removing stale lock');

    filelock.releaseLock(fp, { nonce: lock.nonce });
  });

  await runTest('acquireLock: recovers from stale lock (timeout)', async () => {
    const fp = testFile('test-recover-timeout.json');
    writeTestJson(fp, { test: true });

    // Create stale lock with old timestamp but alive PID
    const lockFile = filelock._lockPath(fp);
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      agent: 'slow-agent',
      timestamp: new Date(Date.now() - 60000).toISOString(),
      hostname: os.hostname(),
      filepath: path.basename(fp),
      nonce: 'old-nonce',
    }));

    const lock = await filelock.acquireLock(fp, {
      agent: 'recovery-agent',
      staleLockTimeoutMs: 30000,
    });
    assert(lock.acquired, 'should acquire after removing timed-out lock');

    filelock.releaseLock(fp, { nonce: lock.nonce });
  });

  // -----------------------------------------------------------------------
  // withFileLock (bracket pattern)
  // -----------------------------------------------------------------------

  console.log('\n--- withFileLock ---');

  await runTest('withFileLock: executes function and releases lock', async () => {
    const fp = testFile('test-bracket.json');
    writeTestJson(fp, { count: 0 });

    let executed = false;
    await filelock.withFileLock(fp, async () => {
      // Lock should be held here
      const lockFile = filelock._lockPath(fp);
      assert(fs.existsSync(lockFile), 'lock should exist during execution');
      executed = true;
    }, { agent: 'test' });

    assert(executed, 'function should have executed');
    // Lock should be released
    const lockFile = filelock._lockPath(fp);
    assert(!fs.existsSync(lockFile), 'lock should be released after execution');
  });

  await runTest('withFileLock: returns function return value', async () => {
    const fp = testFile('test-bracket-return.json');
    writeTestJson(fp, {});

    const result = await filelock.withFileLock(fp, async () => {
      return 42;
    }, { agent: 'test' });

    assertEqual(result, 42, 'should return function return value');
  });

  await runTest('withFileLock: releases lock even on error', async () => {
    const fp = testFile('test-bracket-error.json');
    writeTestJson(fp, {});

    let threw = false;
    try {
      await filelock.withFileLock(fp, async () => {
        throw new Error('intentional error');
      }, { agent: 'test' });
    } catch (err) {
      threw = true;
      assertEqual(err.message, 'intentional error');
    }

    assert(threw, 'should have thrown');
    const lockFile = filelock._lockPath(fp);
    assert(!fs.existsSync(lockFile), 'lock should be released after error');
  });

  await runTest('withFileLock: throws ELOCK when cannot acquire', async () => {
    const fp = testFile('test-bracket-nolock.json');
    writeTestJson(fp, {});

    // Hold lock
    const lock = await filelock.acquireLock(fp, { agent: 'holder' });

    let threw = false;
    try {
      await filelock.withFileLock(fp, async () => {
        // should not reach here
      }, { agent: 'contender', maxRetries: 1, retryBaseMs: 5, retryMaxMs: 10 });
    } catch (err) {
      threw = true;
      assertEqual(err.code, 'ELOCK');
    }

    assert(threw, 'should have thrown ELOCK');
    filelock.releaseLock(fp, { nonce: lock.nonce });
  });

  // -----------------------------------------------------------------------
  // readModifyWrite
  // -----------------------------------------------------------------------

  console.log('\n--- readModifyWrite ---');

  await runTest('readModifyWrite: basic read-modify-write cycle', async () => {
    const fp = testFile('test-rmw-basic.json');
    writeTestJson(fp, { items: [], count: 0 });

    const result = await filelock.readModifyWrite(fp, (data) => {
      data.items.push('alpha');
      data.count = data.items.length;
      return data;
    }, { agent: 'test' });

    assert(result.success, 'should succeed');
    assertEqual(result.data.count, 1);
    assertEqual(result.data.items[0], 'alpha');
    assertEqual(result.attempts, 1);

    // Verify file on disk
    const ondisk = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    assertEqual(ondisk.count, 1);
    assertEqual(ondisk.items[0], 'alpha');

    // Lock should be released
    assert(!fs.existsSync(filelock._lockPath(fp)), 'lock should be released');
  });

  await runTest('readModifyWrite: async transform function', async () => {
    const fp = testFile('test-rmw-async.json');
    writeTestJson(fp, { value: 1 });

    const result = await filelock.readModifyWrite(fp, async (data) => {
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 5));
      data.value = data.value * 2;
      return data;
    }, { agent: 'test' });

    assert(result.success, 'should succeed');
    assertEqual(result.data.value, 2);
  });

  await runTest('readModifyWrite: uses defaultData when file missing', async () => {
    const fp = testFile('test-rmw-default.json');
    // Don't create the file

    const result = await filelock.readModifyWrite(fp, (data) => {
      data.items.push('first');
      return data;
    }, { agent: 'test', defaultData: { items: [] } });

    assert(result.success, 'should succeed with defaultData');
    assertEqual(result.data.items.length, 1);
    assertEqual(result.data.items[0], 'first');

    // File should now exist
    assert(fs.existsSync(fp), 'file should be created');
  });

  await runTest('readModifyWrite: fails when file missing and no defaultData', async () => {
    const fp = testFile('test-rmw-no-default.json');

    const result = await filelock.readModifyWrite(fp, (data) => data, {
      agent: 'test',
      defaultData: null,
    });

    assert(!result.success, 'should fail without defaultData');
    assertIncludes(result.error, 'readModifyWrite error');
  });

  await runTest('readModifyWrite: cleans up .tmp on transform error', async () => {
    const fp = testFile('test-rmw-transform-error.json');
    writeTestJson(fp, { value: 1 });

    const result = await filelock.readModifyWrite(fp, (data) => {
      throw new Error('transform exploded');
    }, { agent: 'test' });

    assert(!result.success, 'should report failure');
    assertIncludes(result.error, 'transform exploded');

    // Original file should be untouched
    const ondisk = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    assertEqual(ondisk.value, 1, 'original data should be preserved');

    // No temp file should remain
    assert(!fs.existsSync(fp + '.tmp'), 'temp file should be cleaned up');

    // Lock should be released
    assert(!fs.existsSync(filelock._lockPath(fp)), 'lock should be released');
  });

  await runTest('readModifyWrite: atomic write (no partial data)', async () => {
    const fp = testFile('test-rmw-atomic.json');
    const originalData = { items: Array.from({ length: 100 }, (_, i) => `item-${i}`) };
    writeTestJson(fp, originalData);

    const result = await filelock.readModifyWrite(fp, (data) => {
      data.items.push('new-item');
      data.total = data.items.length;
      return data;
    }, { agent: 'test' });

    assert(result.success, 'should succeed');
    assertEqual(result.data.items.length, 101);
    assertEqual(result.data.total, 101);

    // Read back and verify completeness
    const ondisk = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    assertEqual(ondisk.items.length, 101);
    assertEqual(ondisk.total, 101);
  });

  await runTest('readModifyWrite: multiple sequential writes', async () => {
    const fp = testFile('test-rmw-sequential.json');
    writeTestJson(fp, { counter: 0 });

    for (let i = 0; i < 5; i++) {
      const result = await filelock.readModifyWrite(fp, (data) => {
        data.counter++;
        return data;
      }, { agent: 'test' });
      assert(result.success, `write ${i} should succeed`);
    }

    const ondisk = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    assertEqual(ondisk.counter, 5, 'counter should be 5 after 5 increments');
  });

  // -----------------------------------------------------------------------
  // getLockStatus
  // -----------------------------------------------------------------------

  console.log('\n--- getLockStatus ---');

  await runTest('getLockStatus: reports unlocked when no lock', async () => {
    const fp = testFile('test-status-unlocked.json');
    writeTestJson(fp, {});

    const status = filelock.getLockStatus(fp);
    assert(!status.locked, 'should be unlocked');
    assert(!status.stale, 'should not be stale');
    assert(status.metadata === null, 'no metadata');
  });

  await runTest('getLockStatus: reports locked when lock held', async () => {
    const fp = testFile('test-status-locked.json');
    writeTestJson(fp, {});

    const lock = await filelock.acquireLock(fp, { agent: 'status-test' });
    const status = filelock.getLockStatus(fp);
    assert(status.locked, 'should be locked');
    assert(!status.stale, 'should not be stale');
    assertEqual(status.metadata.agent, 'status-test');

    filelock.releaseLock(fp, { nonce: lock.nonce });
  });

  // -----------------------------------------------------------------------
  // breakLock
  // -----------------------------------------------------------------------

  console.log('\n--- breakLock ---');

  await runTest('breakLock: removes lock forcefully', async () => {
    const fp = testFile('test-break.json');
    writeTestJson(fp, {});

    await filelock.acquireLock(fp, { agent: 'victim' });
    assert(fs.existsSync(filelock._lockPath(fp)), 'lock should exist');

    const result = filelock.breakLock(fp);
    assert(result.broken, 'should break lock');
    assert(!fs.existsSync(filelock._lockPath(fp)), 'lock file should be gone');
    assertEqual(result.metadata.agent, 'victim');
  });

  await runTest('breakLock: succeeds when no lock exists', async () => {
    const fp = testFile('test-break-nonexistent.json');
    const result = filelock.breakLock(fp);
    assert(result.broken, 'should succeed even if no lock');
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  console.log('\n--- Edge cases ---');

  await runTest('readModifyWrite: handles large JSON files', async () => {
    const fp = testFile('test-large.json');
    // ~50KB file (similar to real activity-log.json)
    const largeData = {
      activities: Array.from({ length: 500 }, (_, i) => ({
        id: i + 1,
        agent: 'forge',
        action: 'test_action',
        detail: 'This is a test detail with some reasonable length text to simulate real data entries',
        timestamp: new Date().toISOString(),
        project: 'test-project',
      })),
    };
    writeTestJson(fp, largeData);

    const start = Date.now();
    const result = await filelock.readModifyWrite(fp, (data) => {
      data.activities.push({
        id: data.activities.length + 1,
        agent: 'test',
        action: 'added',
        detail: 'New entry',
        timestamp: new Date().toISOString(),
        project: 'test',
      });
      return data;
    }, { agent: 'test' });
    const elapsed = Date.now() - start;

    assert(result.success, 'should succeed on large file');
    assertEqual(result.data.activities.length, 501);
    // Performance: should complete in well under 1 second
    assert(elapsed < 1000, `should be fast, took ${elapsed}ms`);
  });

  await runTest('readModifyWrite: preserves JSON formatting', async () => {
    const fp = testFile('test-formatting.json');
    writeTestJson(fp, { key: 'value' });

    await filelock.readModifyWrite(fp, (data) => {
      data.newKey = 'newValue';
      return data;
    }, { agent: 'test', indentation: 2 });

    const raw = fs.readFileSync(fp, 'utf-8');
    // Should be indented with 2 spaces and end with newline
    assert(raw.includes('  "key"'), 'should have 2-space indentation');
    assert(raw.endsWith('\n'), 'should end with newline');
  });

  await runTest('readModifyWrite: concurrent writes serialize correctly', async () => {
    const fp = testFile('test-rmw-concurrent.json');
    writeTestJson(fp, { counter: 0 });

    // Two parallel readModifyWrite calls on the same file
    const [r1, r2] = await Promise.all([
      filelock.readModifyWrite(fp, (data) => {
        data.counter++;
        return data;
      }, { agent: 'writer-1' }),
      filelock.readModifyWrite(fp, (data) => {
        data.counter++;
        return data;
      }, { agent: 'writer-2' }),
    ]);

    // Both should succeed (one waits for the other via lock)
    assert(r1.success, 'writer-1 should succeed');
    assert(r2.success, 'writer-2 should succeed');

    // Counter should be exactly 2 (not 1 — no lost updates)
    const ondisk = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    assertEqual(ondisk.counter, 2, 'counter should be 2 after 2 concurrent increments');
  });

  await runTest('getLockStatus: reports stale lock correctly', async () => {
    const fp = testFile('test-status-stale.json');
    writeTestJson(fp, {});

    // Create stale lock with dead PID
    const lockFile = filelock._lockPath(fp);
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: 99999999,
      agent: 'dead-agent',
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      filepath: path.basename(fp),
      nonce: 'stale-nonce',
    }));

    const status = filelock.getLockStatus(fp);
    assert(status.locked, 'should report as locked');
    assert(status.stale, 'should report as stale');
    assertEqual(status.metadata.agent, 'dead-agent');

    // Cleanup
    try { fs.unlinkSync(lockFile); } catch (_) {}
  });

  await runTest('DEFAULTS: exports sensible defaults', async () => {
    assertEqual(filelock.DEFAULTS.staleLockTimeoutMs, 30000, 'stale timeout');
    assertEqual(filelock.DEFAULTS.retryBaseMs, 10, 'retry base');
    assertEqual(filelock.DEFAULTS.retryMaxMs, 5000, 'retry max');
    assertEqual(filelock.DEFAULTS.maxRetries, 10, 'max retries');
    assertEqual(filelock.DEFAULTS.agent, 'unknown', 'default agent');
  });

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  teardown();

  console.log('\n=== Results ===');
  console.log(`Total:  ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => {
      console.log(`  - ${f.name}: ${f.error}`);
    });
  }

  console.log('');

  return failedTests === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

runAllTests()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(err => {
    console.error('Test runner crashed:', err);
    process.exit(2);
  });
