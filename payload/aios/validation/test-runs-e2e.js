#!/usr/bin/env node
/**
 * test-runs-e2e.js — REAL end-to-end parallelism proof (the "1 missao real").
 *
 * Unlike test-runs-smoke (which seeds a temp root via the `root` param), this
 * drives the engine the way ULTRON actually would: a sandbox AIOS_HOME env, two
 * concurrent runs (logitok + ultron) opened through the real lib, divergent
 * per-run state, concurrent activity-log appends stamped with runId via the
 * filelock, and a /continue-style read of the index to list activeRuns.
 *
 * It also asserts the g060 heal: an EMPTY runs/ + legacy status.json => single
 * run mode (isMultiRunMode === false), exactly the live half-state.
 *
 * Zero deps. Exit 0 = all pass. NEVER touches ~/.claude/aios (uses AIOS_HOME).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// --- sandbox: point the WHOLE engine at a throwaway dir via env, like prod ---
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-e2e-'));
process.env.AIOS_HOME = SANDBOX;
delete process.env.AIOS_DIR;

// seed a fresh activity-log + a LEGACY status.json (the realistic starting point)
fs.writeFileSync(
  path.join(SANDBOX, 'activity-log.json'),
  JSON.stringify({ activities: [], discussions: [], decisions: [], tasks: [] }, null, 2) + '\n'
);
fs.writeFileSync(
  path.join(SANDBOX, 'status.json'),
  JSON.stringify({ schema: 'aios-status-v1', project: 'legacy', phase: 'idle' }, null, 2) + '\n'
);

// require AFTER setting env so the libs resolve the sandbox via aiosRoot()
const runs = require('../lib/runs');
const activityLog = require('../lib/activity-log');

let failures = 0;
function ok(name, cond, extra) {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

async function main() {
  console.log('Sandbox AIOS_HOME:', SANDBOX);
  console.log('aiosRoot() resolves to:', runs.aiosRoot());
  ok('engine resolves sandbox via AIOS_HOME', runs.aiosRoot() === SANDBOX, runs.aiosRoot());
  console.log('═══════════════════════════════════════════════════════');

  // ---- STEP 0: g060 heal — empty runs/ + legacy status => single-run ----
  console.log('\n--- STEP 0: half-state heal (empty runs/, legacy status) ---');
  fs.mkdirSync(path.join(SANDBOX, 'runs'), { recursive: true }); // empty leftover
  ok('isMultiRunMode() FALSE with empty runs/ + legacy status (g060 heal)',
    runs.isMultiRunMode() === false);
  ok('listActiveRuns() empty in half-state', runs.listActiveRuns().length === 0);

  // ---- STEP 1: open 2 REAL concurrent runs through the real lib (no root arg) ----
  console.log('\n--- STEP 1: openRun x2 (logitok + ultron), env-driven ---');
  const t = new Date('2026-06-03T03:10:00Z');
  const rLogi = runs.openRun('logitok', { date: t, meta: { mission: 'cobranca', complexity: 'medium' } });
  const rUlt  = runs.openRun('ultron',  { date: t, meta: { mission: 'dispatcher', complexity: 'complex' } });
  console.log('  logitok run:', rLogi.runId, '->', rLogi.dir);
  console.log('  ultron  run:', rUlt.runId,  '->', rUlt.dir);

  ok('2 isolated run-dirs on disk', rLogi.dir !== rUlt.dir
    && fs.existsSync(path.join(rLogi.dir, 'status.json'))
    && fs.existsSync(path.join(rUlt.dir, 'status.json')));
  ok('both fresh creates', rLogi.created === true && rUlt.created === true);

  // ---- STEP 2: NOW we ARE multi-run; index has both ----
  console.log('\n--- STEP 2: multi-run detection + index ---');
  ok('isMultiRunMode() TRUE after real runs open', runs.isMultiRunMode() === true);
  const active = runs.listActiveRuns();
  ok('index lists exactly 2 runs', active.length === 2, JSON.stringify(active));
  ok('index contains both runIds',
    active.indexOf(rLogi.runId) !== -1 && active.indexOf(rUlt.runId) !== -1);
  ok('listRunDirsOnDisk sees both real dirs', runs.listRunDirsOnDisk().length === 2);

  // ---- STEP 3: divergent per-run state must NOT cross ----
  console.log('\n--- STEP 3: divergent per-run status (no cross-talk) ---');
  runs.writeRunStatus(rLogi.runId, { phase: 'execution', activeAgent: 'forge', activeTask: 'LogiTok cobranca' });
  runs.writeRunStatus(rUlt.runId,  { phase: 'review',    activeAgent: 'aegis', activeTask: 'Ultron dispatcher' });
  const sLogi = runs.readRunStatus(rLogi.runId);
  const sUlt  = runs.readRunStatus(rUlt.runId);
  console.log('  logitok:', sLogi.phase, sLogi.activeAgent, '/', sLogi.activeTask);
  console.log('  ultron :', sUlt.phase,  sUlt.activeAgent,  '/', sUlt.activeTask);
  ok('logitok state intact', sLogi.phase === 'execution' && sLogi.activeTask === 'LogiTok cobranca');
  ok('ultron state intact',  sUlt.phase  === 'review'    && sUlt.activeTask  === 'Ultron dispatcher');
  ok('states diverge (no clobber across runs)',
    sLogi.phase !== sUlt.phase && sLogi.activeTask !== sUlt.activeTask);
  // the legacy ROOT status.json must be UNTOUCHED by per-run writes
  const rootStatus = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'status.json'), 'utf8'));
  ok('root status.json was NOT mutated by per-run writes',
    rootStatus.schema === 'aios-status-v1' || rootStatus.schema === 'aios-runs-index-v1',
    'schema=' + rootStatus.schema);

  // ---- STEP 4: concurrent activity-log appends from BOTH runs via the lock ----
  console.log('\n--- STEP 4: concurrent appends (2 runs) via filelock, runId stamped ---');
  const N = 16; // 8 per run, fired together
  const ops = [];
  for (let i = 0; i < N; i++) {
    const fromRun = i % 2 === 0 ? rLogi.runId : rUlt.runId;
    ops.push(activityLog.appendActivity(
      { agent: i % 2 === 0 ? 'forge' : 'aegis', action: `e2e_append_${i}`,
        project: i % 2 === 0 ? 'logitok' : 'ultron' },
      { runId: fromRun, agent: 'orchestrator' } // note: NO root arg — env-driven
    ));
  }
  const res = await Promise.all(ops);
  ok('all concurrent appends succeeded', res.every((r) => r.success),
    `${res.filter(r => r.success).length}/${N}`);

  let parsed = null, perr = null;
  try { parsed = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'activity-log.json'), 'utf8')); }
  catch (e) { perr = e.message; }
  ok('activity-log still valid JSON (no corruption under contention)', parsed !== null, perr || '');
  if (parsed) {
    const acts = parsed.activities;
    ok('all N entries present', acts.length === N, `got ${acts.length}`);
    ok('ids unique (no race overwrite)', new Set(acts.map(a => a.id)).size === acts.length);
    ok('every entry stamped with runId', acts.every(a => typeof a.runId === 'string'));
    const byRun = new Set(acts.map(a => a.runId));
    ok('both runs represented', byRun.size === 2
      && byRun.has(rLogi.runId) && byRun.has(rUlt.runId), [...byRun].join(' | '));
  }

  // ---- STEP 5: /continue-style — read the index, report activeRuns ----
  console.log('\n--- STEP 5: /continue-style resume (read index, list activeRuns) ---');
  const idx = runs.readIndex();
  ok('index schema is runs-index', idx.schema === runs.INDEX_SCHEMA, idx.schema);
  const resumeList = idx.activeRuns.map(r => ({ runId: r.runId, project: r.project, mission: r.mission }));
  console.log('  ACTIVE RUNS A /continue WOULD SHOW:');
  for (const r of resumeList) console.log('   •', r.runId, `(project=${r.project}, mission=${r.mission})`);
  ok('/continue sees 2 resumable runs', resumeList.length === 2);
  ok('/continue can read each run\'s live status', (() => {
    try {
      const a = runs.readRunStatus(resumeList[0].runId);
      const b = runs.readRunStatus(resumeList[1].runId);
      return a && b && a.phase && b.phase;
    } catch (_) { return false; }
  })());

  // ---- STEP 6: close one run, index shrinks, other still resumable ----
  console.log('\n--- STEP 6: close one run (lifecycle) ---');
  runs.closeRunInIndex(rLogi.runId);
  const after = runs.listActiveRuns();
  ok('closed run removed from index', after.indexOf(rLogi.runId) === -1);
  ok('other run still active', after.indexOf(rUlt.runId) !== -1, JSON.stringify(after));
  ok('still multi-run while 1 real run remains', runs.isMultiRunMode() === true);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(failures === 0 ? '✅ E2E PARALLELISM PROVEN' : `🔴 ${failures} E2E CHECK(S) FAILED`);

  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
