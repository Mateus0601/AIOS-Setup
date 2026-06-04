# Browser Protocol — Chrome + Playwright CLI

## Configuration

- **Chrome Path:** `C:\Program Files\Google\Chrome\Application\chrome.exe`
- **Debug Port:** `9222` (default)
- **CDP Endpoint:** `http://127.0.0.1:9222`
- **Debug Profile:** `~/.chrome-debug-profile` (fallback when Chrome is already open)
- **Real Profile:** `$LOCALAPPDATA/Google/Chrome/User Data` (used when Chrome is NOT open — preserves logins/sessions)
- **Launcher script:** `~/.claude/scripts/chrome-debug.sh` (Bash) / `~/.claude/scripts/chrome-debug.bat` (CMD)
- **CLI config:** `~/.playwright/cli.config.json`
- **Snapshots saved to:** `.playwright-cli/` (in the current directory)

## Why CLI and not MCP

The Playwright CLI consumes **~4x fewer tokens** than the MCP Playwright:
- MCP: ~114k tokens per task (snapshots inlined in context)
- CLI: ~27k tokens per task (snapshots saved to disk)

The CLI writes snapshots and screenshots to disk. The agent reads only what it needs, preserving context for actual code.

## Usage Protocol (MANDATORY)

### Before any browser operation

ALWAYS run the Chrome launcher script BEFORE using the Playwright CLI:

```bash
bash "$HOME/.claude/scripts/chrome-debug.sh"
```

The script:
1. Checks whether Chrome is already listening on port 9222 (via curl to the CDP endpoint)
2. If yes: does nothing (idempotent)
3. If not: detects whether Chrome is already open
   - Chrome CLOSED: launches with the user's real profile (logins and sessions preserved)
   - Chrome OPEN: launches with a dedicated profile (no logins — the real profile is locked)
4. Uses `--window-size=1366,768` + `--start-maximized` + `--force-device-scale-factor=1`
5. Waits up to 10 seconds for the port to become ready
6. Reports success or error and indicates which profile was used

### After Chrome: connect the CLI

On the first time of the session, connect the CLI to Chrome:

```bash
playwright-cli open --config "$HOME/.playwright/cli.config.json"
```

This connects via CDP to Chrome on port 9222. After that, all commands use this connection.

### Main Commands (via Bash tool)

```bash
# Navigation
playwright-cli goto <url>              # navigate to URL
playwright-cli go-back                 # back
playwright-cli go-forward              # forward
playwright-cli reload                  # reload

# Interaction
playwright-cli click <ref>             # click an element
playwright-cli fill <ref> "text"       # fill a field
playwright-cli type "text"             # type text
playwright-cli press <key>             # press a key
playwright-cli hover <ref>             # hover over an element
playwright-cli select <ref> <val>      # pick an option
playwright-cli upload <file>           # upload a file
playwright-cli check <ref>             # check a checkbox
playwright-cli uncheck <ref>           # uncheck a checkbox

# Snapshots and Screenshots (saved to disk!)
playwright-cli snapshot                # page snapshot -> .playwright-cli/page-*.yml
playwright-cli screenshot              # screenshot -> .playwright-cli/page-*.png
playwright-cli screenshot <ref>        # screenshot of a specific element

# Tabs
playwright-cli tab-list                # list tabs
playwright-cli tab-new [url]           # new tab
playwright-cli tab-close [index]       # close tab
playwright-cli tab-select <index>      # select tab

# DevTools
playwright-cli console                 # console messages
playwright-cli network                 # network requests
playwright-cli eval "expression"       # run JS on the page

# Session
playwright-cli close                   # close the browser
playwright-cli dialog-accept           # accept a dialog
playwright-cli dialog-dismiss          # dismiss a dialog
```

### Typical interaction flow

```bash
# 1. Launch Chrome (if not already running)
bash "$HOME/.claude/scripts/chrome-debug.sh"

# 2. Connect the CLI (first time of the session)
playwright-cli open --config "$HOME/.playwright/cli.config.json"

# 3. Navigate
playwright-cli goto https://example.com

# 4. See the page (snapshot saved to a file)
playwright-cli snapshot
# -> Only read the file .playwright-cli/page-*.yml if needed

# 5. Interact
playwright-cli click e42
playwright-cli fill e35 "my search"
playwright-cli press Enter
```

### SIMPLE browser tasks

For simple requests (open a page, click, fill a form, take a screenshot, look something up):

1. Run the Chrome launcher script
2. Connect the CLI (if not already connected)
3. Use `playwright-cli` commands via the **Bash tool**

**DO NOT spawn AIOS agents for simple browser tasks.** Execute directly as ULTRON.

### COMPLEX browser missions

For complex missions (full scraping, multi-page automation, E2E tests, complex flows):

1. Run the Chrome launcher script + connect the CLI
2. Follow the normal AIOS flow (classify complexity, spawn agents)
3. FORGE uses `playwright-cli` via Bash within its Task context

## Playwright CLI Config

File: `~/.playwright/cli.config.json`

```json
{
  "browser": {
    "browserName": "chromium",
    "cdpEndpoint": "http://127.0.0.1:9222",
    "launchOptions": {
      "channel": "chrome"
    }
  }
}
```

## Profile — Real vs Dedicated

The script tries the user's real profile first:

**Chrome CLOSED (best case):**
- Uses `--user-data-dir=$LOCALAPPDATA/Google/Chrome/User Data`
- Logins, sessions, cookies, extensions — everything available
- Playwright browses as if it were the user

**Chrome OPEN (fallback):**
- Uses `--user-data-dir=~/.chrome-debug-profile` (dedicated profile)
- No logins — clean profile
- To use with logins: close ALL Chrome windows and relaunch the script

## Troubleshooting

- **Error `ECONNREFUSED 127.0.0.1:9222`:** Chrome is not running. Run `bash "$HOME/.claude/scripts/chrome-debug.sh"`.
- **CLI does not connect:** Run `playwright-cli open --config "$HOME/.playwright/cli.config.json"` to reconnect.
- **Port taken by a Chrome without debug:** The script launches a separate instance with the dedicated profile — the user's Chrome is not affected.
- **Chrome not found:** Check the installation at `C:\Program Files\Google\Chrome\Application\`.
- **Corrupted profile:** Delete `~/.chrome-debug-profile` and relaunch.
- **Snapshots piling up:** Clean `.playwright-cli/` periodically.
