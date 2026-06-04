#!/usr/bin/env node
/**
 * test-dispatcher.js — cap + FIFO queue proof (T6)
 */
'use strict';
const { Dispatcher } = require('../lib/dispatcher');

let failures = 0;
function ok(name, cond, extra) {
  if (!cond) failures++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
}

const cfg = {
  maxConcurrentRuns: 2,
  maxConcurrentAgentsPerRun: 2,
  maxConcurrentAgentsGlobal: 3,
  queuePolicy: 'fifo',
  degradeToSequentialOnPressure: true,
};
const d = new Dispatcher(cfg);

console.log('--- cap admission ---');
ok('admit A', d.requestRun('A').admitted === true);
ok('admit B', d.requestRun('B').admitted === true);
const c = d.requestRun('C');
ok('C queued (cap=2)', c.admitted === false && c.queued === true, `pos=${c.position}`);
const e = d.requestRun('D');
ok('D queued behind C', e.queued === true && e.position === 2);
ok('underPressure at cap', d.underPressure() === true);

console.log('--- FIFO selection on completion ---');
const next1 = d.completeRun('A');
ok('completing A admits C (FIFO, not D)', next1 && next1.runId === 'C', next1 && next1.runId);
const next2 = d.completeRun('B');
ok('completing B admits D', next2 && next2.runId === 'D', next2 && next2.runId);
const next3 = d.completeRun('C');
ok('queue empty => null', next3 === null);

console.log('--- agent caps ---');
const d2 = new Dispatcher(cfg);
d2.requestRun('R1');
d2.requestRun('R2');
ok('R1 can spawn 2 agents', d2.canSpawnAgents('R1', 2) === true);
d2.spawnAgents('R1', 2);
ok('R1 cannot spawn 3rd (per-run cap)', d2.canSpawnAgents('R1', 1) === false);
ok('R2 can spawn 1 (global has 1 slot left: 2+1=3)', d2.canSpawnAgents('R2', 1) === true);
ok('R2 cannot spawn 2 (global cap 3)', d2.canSpawnAgents('R2', 2) === false);
d2.releaseAgents('R1', 1);
ok('after release, global has room', d2.canSpawnAgents('R2', 2) === true);

console.log(failures === 0 ? '✅ DISPATCHER TESTS PASSED' : `🔴 ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
