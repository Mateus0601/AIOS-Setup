#!/usr/bin/env node
/**
 * AIOS Validation Hook — Claude Code PostToolUse hook
 *
 * Runs after Write/Edit operations. If the file is an AIOS JSON file,
 * validates it using the handoff_engine.py validate-file command.
 *
 * Exit 0 = valid (proceed)
 * Exit 2 = invalid (report error to Claude)
 */

const { execSync } = require('child_process');
const path = require('path');

// Files we want to validate
// NOTE: state_graph.json foi aposentado (telemetria, nao runtime) e movido para
// ~/.claude/aios/_deprecated/ — removido desta lista para nao validar o que nao existe.
const WATCHED_FILES = new Set([
  'activity-log.json',
  'status.json',
  'gotchas.json',
  'memory_blocks.json',
]);

// Detect Python command (try python, python3, py in order)
function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      return cmd;
    } catch {
      // Not found, try next
    }
  }
  return null;
}

async function main() {
  // Read hook input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0); // Can't parse input, allow
  }

  // Get file path from tool input
  const filePath = hookData?.tool_input?.file_path;
  if (!filePath) {
    process.exit(0); // No file path, allow
  }

  // Check if this is an AIOS file we care about
  const fileName = path.basename(filePath);
  const isCheckpoint = filePath.includes('checkpoints') && fileName.endsWith('.json');

  if (!WATCHED_FILES.has(fileName) && !isCheckpoint) {
    process.exit(0); // Not an AIOS file, allow
  }

  // Find Python
  const pythonCmd = findPython();
  if (!pythonCmd) {
    // Python not found — warn but don't block
    const warnMsg = JSON.stringify({
      additionalContext: 'AIOS validation hook: Python not found (tried python, python3, py). Validation skipped.'
    });
    process.stdout.write(warnMsg);
    process.exit(0);
  }

  // Validate using handoff_engine.py
  const enginePath = path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.claude', 'aios', 'core', 'handoff_engine.py'
  );

  try {
    const result = execSync(
      `${pythonCmd} "${enginePath}" validate-file "${filePath}"`,
      { encoding: 'utf-8', timeout: 15000 }
    );

    const validation = JSON.parse(result);

    if (!validation.valid) {
      // Report errors to Claude
      const errorMsg = [
        `AIOS VALIDATION FAILED: ${fileName} (${validation.file_type})`,
        ...validation.errors.map(e => `  ERROR: ${e}`),
        ...validation.warnings.map(w => `  WARNING: ${w}`),
        '',
        'Fix the errors above and retry the write.',
      ].join('\n');

      process.stderr.write(errorMsg);
      process.exit(2); // Block — show error to Claude
    }

    // Valid — show warnings if any
    if (validation.warnings.length > 0) {
      const warnMsg = JSON.stringify({
        additionalContext: `AIOS validation passed with warnings for ${fileName}: ${validation.warnings.join('; ')}`
      });
      process.stdout.write(warnMsg);
    }

    process.exit(0); // Valid, proceed

  } catch (err) {
    if (err.status === 2) {
      // Validation failed (exit code 2 from engine)
      process.stderr.write(err.stderr || err.stdout || 'Validation failed');
      process.exit(2);
    }
    // Other error — don't block, just warn
    process.exit(0);
  }
}

main();
