#!/usr/bin/env node
/**
 * test-runs-smoke.js — GATE for parallelism Fase A (T10)
 *
 * Proves, by REALLY running:
 *  1. Run isolation: 2 concurrent runs (logitok + ultron) have SEPARATE state.
 *  2. Concurrent append: 2 "simultaneous" activity-log appends through the lock
 *     produce an INTACT JSON with both entries.
 *  3. Backward compat: with no runs/, the index helper reports single-run mode.
 *
 * Uses a throwaway temp root so it NEVER touches the real ~/.claude/aios files.
 * Zero deps. Exit 0 = all pass.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const runs = require('../lib/runs');
const activityLog = require('../lib/activity-log');

let failures = 0;
function ok(name, cond, extra) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${extra ? ' — ' + extra : ''}`);
}

function makeTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-runs-smoke-'));
  // seed a fresh activity-log skeleton
  fs.writeFileSync(
    path.join(dir, 'activity-log.json'),
    JSON.stringify({ activities: [], discussions: [], decisions: [], tasks: [] }, null, 2) + '\n'
  );
  return dir;
}

async function main() {
  const root = makeTempRoot();
  console.log('Temp root:', root);
  console.log('═══════════════════════════════════════════════════════');

  // ---- TEST 0: backward compat (no runs/ yet) ----
  console.log('\n--- TEST 3 (retrocompat): no runs/ => single-run mode ---');
  ok('isMultiRunMode() is false before any run', runs.isMultiRunMode(root) === false);
  ok('listActiveRuns() is empty before any run', runs.listActiveRuns(root).length === 0);

  // ---- TEST 1: isolation of 2 concurrent runs ----
  console.log('\n--- TEST 1 (isolation): 2 concurrent runs ---');
  const d = new Date('2026-06-03T02:45:00Z');
  const r1 = runs.openRun('logitok', { root, date: d, meta: { complexity: 'medium' } });
  const r2 = runs.openRun('ultron', { root, date: d, meta: { complexity: 'complex' } });
  console.log('  run1:', r1.runId);
  console.log('  run2:', r2.runId);

  ok('runId deterministic format (logitok)', r1.runId === 'run-logitok-20260603T024500', r1.runId);
  ok('runId deterministic format (ultron)', r2.runId === 'run-ultron-20260603T024500', r2.runId);
  ok('multi-run mode active after openRun', runs.isMultiRunMode(root) === true);
  ok('index lists both runs', runs.listActiveRuns(root).length === 2,
    JSON.stringify(runs.listActiveRuns(root)));

  // write DIFFERENT state into each run
  runs.writeRunStatus(r1.runId, { phase: 'execution', activeAgent: 'forge', activeTask: 'LogiTok cobranca', project: 'logitok' }, root);
  runs.writeRunStatus(r2.runId, { phase: 'review', activeAgent: 'aegis', activeTask: 'Ultron dispatcher', project: 'ultron' }, root);

  const s1 = runs.readRunStatus(r1.runId, root);
  const s2 = runs.readRunStatus(r2.runId, root);
  console.log('  run1 state:', JSON.stringify({ phase: s1.phase, agent: s1.activeAgent, task: s1.activeTask }));
  console.log('  run2 state:', JSON.stringify({ phase: s2.phase, agent: s2.activeAgent, task: s2.activeTask }));

  ok('run1 state isolated', s1.phase === 'execution' && s1.activeAgent === 'forge' && s1.activeTask === 'LogiTok cobranca');
  ok('run2 state isolated', s2.phase === 'review' && s2.activeAgent === 'aegis' && s2.activeTask === 'Ultron dispatcher');
  ok('NO cross-contamination (run1 != run2)', s1.activeTask !== s2.activeTask && s1.phase !== s2.phase);

  // results isolation
  runs.writeRunResult(r1.runId, 'forge', { status: 'success', diff: 'logitok-only' }, root);
  runs.writeRunResult(r2.runId, 'forge', { status: 'success', diff: 'ultron-only' }, root);
  const res1 = JSON.parse(fs.readFileSync(path.join(r1.resultsDir, 'forge.json'), 'utf8'));
  const res2 = JSON.parse(fs.readFileSync(path.join(r2.resultsDir, 'forge.json'), 'utf8'));
  ok('results isolated per run', res1.diff === 'logitok-only' && res2.diff === 'ultron-only');

  // ---- TEST 2: concurrent activity-log appends through the lock ----
  console.log('\n--- TEST 2 (concurrent append): 2 simultaneous appends via lock ---');
  const N = 12; // 6 from each "run", fired concurrently
  const ops = [];
  for (let i = 0; i < N; i++) {
    const fromRun = i % 2 === 0 ? r1.runId : r2.runId;
    const agent = i % 2 === 0 ? 'forge' : 'aegis';
    ops.push(
      activityLog.appendActivity(
        { agent, action: `concurrent_append_${i}`, project: i % 2 === 0 ? 'logitok' : 'ultron' },
        { root, runId: fromRun, agent: 'orchestrator' }
      )
    );
  }
  const results = await Promise.all(ops);
  const allSucceeded = results.every((r) => r.success);
  ok('all concurrent appends succeeded', allSucceeded,
    `${results.filter(r => r.success).length}/${N}`);

  // file must still be valid JSON with all N entries and unique ids
  const logRaw = fs.readFileSync(path.join(root, 'activity-log.json'), 'utf8');
  let parsed = null, parseErr = null;
  try { parsed = JSON.parse(logRaw); } catch (e) { parseErr = e.message; }
  ok('activity-log still parses (no corruption)', parsed !== null, parseErr || '');

  if (parsed) {
    const acts = parsed.activities;
    ok('all N entries present', acts.length === N, `got ${acts.length}`);
    const ids = acts.map((a) => a.id);
    ok('ids unique (no overwrite from race)', new Set(ids).size === ids.length,
      `ids=${ids.join(',')}`);
    const withRunId = acts.filter((a) => typeof a.runId === 'string');
    ok('runId stamped on entries', withRunId.length === N, `${withRunId.length}/${N}`);
    const bothRuns = new Set(acts.map((a) => a.runId));
    ok('both runs represented in log', bothRuns.size === 2, [...bothRuns].join(' | '));
  }

  // ---- TEST 4 (B1 regression): same project + same second must NOT collide ----
  console.log('\n--- TEST 4 (B1): 2 runs, same project, same second => distinct dirs ---');
  const sameSec = new Date('2026-06-03T01:15:00Z');
  const c1 = runs.openRun('logitok', { root, date: sameSec });
  const c2 = runs.openRun('logitok', { root, date: sameSec }); // same project, same second
  console.log('  collide run1:', c1.runId);
  console.log('  collide run2:', c2.runId);

  ok('B1: base runId on first call', c1.runId === 'run-logitok-20260603T011500', c1.runId);
  ok('B1: second call disambiguated (suffix)', c2.runId === 'run-logitok-20260603T011500-2', c2.runId);
  ok('B1: 2 DISTINCT runIds (no alias)', c1.runId !== c2.runId);
  ok('B1: 2 DISTINCT run-dirs on disk', c1.dir !== c2.dir
    && fs.existsSync(c1.dir) && fs.existsSync(c2.dir));
  ok('B1: both fresh creates (created:true)', c1.created === true && c2.created === true);

  // index must hold BOTH new runs (plus the survivors from earlier tests)
  const activeAfter = runs.listActiveRuns(root);
  ok('B1: index has 2 entries for the colliding pair', activeAfter.indexOf(c1.runId) !== -1
    && activeAfter.indexOf(c2.runId) !== -1,
    JSON.stringify(activeAfter));

  // THE clobber proof: write distinct state, run1 must stay intact after run2 writes
  runs.writeRunStatus(c1.runId, { activeTask: 'TASK ONE', phase: 'execution' }, root);
  runs.writeRunStatus(c2.runId, { activeTask: 'TASK TWO', phase: 'review' }, root);
  const cs1 = runs.readRunStatus(c1.runId, root);
  const cs2 = runs.readRunStatus(c2.runId, root);
  ok('B1: run1 state INTACT after run2 write (no clobber)',
    cs1.activeTask === 'TASK ONE' && cs1.phase === 'execution',
    `run1=${cs1.activeTask}/${cs1.phase}`);
  ok('B1: run2 state independent', cs2.activeTask === 'TASK TWO' && cs2.phase === 'review',
    `run2=${cs2.activeTask}/${cs2.phase}`);

  // ---- TEST 5 (slug minor): distinct non-ASCII names must NOT collide ----
  console.log('\n--- TEST 5 (slug): distinct non-ASCII project names stay distinct ---');
  const slugA = runs.slugifyProject('日本語');
  const slugB = runs.slugifyProject('한국어');
  console.log('  slug(日本語):', slugA, ' slug(한국어):', slugB);
  ok('slug: non-ASCII name does NOT collapse to fixed "unknown"', slugA !== 'unknown' && slugB !== 'unknown');
  ok('slug: two distinct non-ASCII names => distinct slugs', slugA !== slugB, `${slugA} vs ${slugB}`);
  ok('slug: stable/deterministic', runs.slugifyProject('日本語') === slugA);

  // ---- close + cleanup ----
  runs.closeRunInIndex(r1.runId, root);
  ok('closeRunInIndex removes one run', runs.listActiveRuns(root).indexOf(r1.runId) === -1);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(failures === 0 ? '✅ ALL GATE TESTS PASSED' : `🔴 ${failures} GATE TEST(S) FAILED`);

  // cleanup temp
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
