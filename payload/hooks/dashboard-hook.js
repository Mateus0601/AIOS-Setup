#!/usr/bin/env node
/**
 * AIOS Dashboard Hook
 *
 * Claude Code hook that notifies the dashboard server about events
 * AND auto-opens the dashboard browser tab on first UserPromptSubmit.
 *
 * Triggered on PostToolUse, PreToolUse, UserPromptSubmit, Stop, and SubagentStop events.
 * Fire-and-forget: never blocks the Claude Code workflow.
 *
 * Usage (configured in ~/.claude/settings.json):
 *   node ~/.claude/hooks/dashboard-hook.js <EventType> <SessionId>
 *
 * Hooks receive JSON data via stdin from Claude Code.
 */

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const DASHBOARD_SERVER_URL = 'http://localhost:4001';
// UI e servidor de eventos compartilham a mesma porta (4001) — web leve, 1 processo.
const DASHBOARD_URL = 'http://localhost:4001';
const EVENTS_ENDPOINT = '/events';
const TIMEOUT_MS = 3000;
const HEALTH_CHECK_TIMEOUT_MS = 1500;

const eventType = process.argv[2] || 'unknown';
const sessionId = process.argv[3] || 'unknown';

/**
 * Get the session flag file path (tracks if we already opened the dashboard this session)
 */
function getSessionFlagPath() {
  return path.join(os.tmpdir(), `aios-dashboard-opened-${sessionId}`);
}

/**
 * Check if the dashboard has already been opened this session
 */
function hasOpenedThisSession() {
  try {
    return fs.existsSync(getSessionFlagPath());
  } catch {
    return false;
  }
}

/**
 * Mark that we opened the dashboard this session
 */
function markOpened() {
  try {
    fs.writeFileSync(getSessionFlagPath(), String(Date.now()), 'utf-8');
  } catch {
    // Ignore write errors
  }
}

/**
 * Clean up the session flag file (called on Stop event)
 */
function cleanupSessionFlag() {
  try {
    const flagPath = getSessionFlagPath();
    if (fs.existsSync(flagPath)) {
      fs.unlinkSync(flagPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Check if the dashboard is responding on its port
 * Returns a promise that resolves to true (running) or false (not running)
 */
function isDashboardRunning() {
  return new Promise((resolve) => {
    const url = new URL(DASHBOARD_URL);
    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port,
        path: '/',
        timeout: HEALTH_CHECK_TIMEOUT_MS,
      },
      (res) => {
        res.resume(); // consume response
        resolve(true);
      }
    );

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Open the dashboard in the default browser (fire-and-forget)
 */
function openDashboard() {
  // Windows: use 'start' command
  // macOS: use 'open' command
  // Linux: use 'xdg-open' command
  const platform = process.platform;
  let cmd;

  if (platform === 'win32') {
    cmd = `start "" "${DASHBOARD_URL}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${DASHBOARD_URL}"`;
  } else {
    cmd = `xdg-open "${DASHBOARD_URL}"`;
  }

  exec(cmd, { timeout: 5000 }, () => {
    // Fire-and-forget, ignore errors
  });
}

/**
 * Auto-open logic: opens dashboard in browser on first UserPromptSubmit of the session
 */
async function tryAutoOpen() {
  // Quick check: already opened this session?
  if (hasOpenedThisSession()) {
    // Already opened, but verify dashboard is still responding
    const running = await isDashboardRunning();
    if (!running) {
      // User may have closed the tab — try opening again
      openDashboard();
    }
    return;
  }

  // First prompt of the session — check if dashboard is running
  const running = await isDashboardRunning();
  if (!running) {
    // Dashboard server not running, open it
    openDashboard();
  }

  // Mark as opened regardless (the server must be started separately)
  markOpened();
}

/**
 * Read all data from stdin (Claude Code sends JSON via stdin for hooks)
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');

    // Set a timeout so we don't hang forever if stdin is empty
    const timeout = setTimeout(() => {
      resolve(data || '{}');
    }, 500);

    process.stdin.on('data', (chunk) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(data || '{}');
    });

    process.stdin.on('error', () => {
      clearTimeout(timeout);
      resolve('{}');
    });

    // If stdin is not a TTY and has no data, it might not fire 'end'
    if (process.stdin.isTTY) {
      clearTimeout(timeout);
      resolve('{}');
    }
  });
}

/**
 * Fire-and-forget POST to the dashboard server
 */
function notifyDashboard(payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);

    const url = new URL(EVENTS_ENDPOINT, DASHBOARD_SERVER_URL);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: TIMEOUT_MS,
    };

    const req = http.request(options, (res) => {
      // Consume response to free resources
      res.resume();
      resolve();
    });

    req.on('error', () => {
      // Fire-and-forget: silently ignore connection errors
      // Dashboard might not be running
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      resolve();
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  try {
    const stdinData = await readStdin();
    let hookData = {};

    try {
      hookData = JSON.parse(stdinData);
    } catch {
      // stdin might not be valid JSON
    }

    // Auto-open dashboard on UserPromptSubmit
    if (eventType === 'UserPromptSubmit') {
      // Fire-and-forget — don't block the hook
      tryAutoOpen().catch(() => {});
    }

    // Cleanup session flag on Stop
    if (eventType === 'Stop') {
      cleanupSessionFlag();
    }

    const payload = {
      type: 'hook:event',
      hookType: eventType,
      sessionId,
      data: hookData,
      timestamp: new Date().toISOString(),
    };

    await notifyDashboard(payload);
  } catch {
    // Never crash - hooks should be invisible
  }

  process.exit(0);
}

main();
