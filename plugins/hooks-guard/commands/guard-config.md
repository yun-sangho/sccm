---
description: "View the current .env reference guard configuration — shows active config source, built-in defaults, and user exceptions."
argument-hint: "[--project|--user|--all]"
allowed-tools: Read, Bash(node:*)
---

The user wants to **view** the current state of the `.env` reference
guard's allow configuration. This is a read-only command — it never
writes files. Use `/hooks-guard:guard-allow` to add or remove entries.

## How the two-layer matching works

1. **Built-in safe commands** — prefix matching, always active.
   Defined in `DEFAULT_ENV_REF_ALLOW_COMMANDS` in guard-secrets.js.

2. **User exceptions** — exact match, loaded from
   `hooks-guard.config.json` (project-level or user-level). The legacy
   filename `guard-secrets.config.json` is still read for backwards
   compatibility — when reporting, treat both as valid sources but
   surface which one was actually loaded.

## Steps

1. **Parse `$ARGUMENTS`.**

   - `--project` — show only project-level config
   - `--user` — show only user-level config
   - `--all` or empty — show everything (default)

2. **Gather information.**

   a. **Read built-in defaults** from the plugin source:
      ```
      node -e "const g = require('${CLAUDE_PLUGIN_ROOT}/scripts/guard-secrets.js'); const u = require('${CLAUDE_PLUGIN_ROOT}/scripts/utils.js'); console.log(JSON.stringify({defaults: g.DEFAULT_ENV_REF_ALLOW_COMMANDS, configFilename: u.CONFIG_FILENAME, legacyConfigFilename: u.LEGACY_CONFIG_FILENAME}))"
      ```

   b. **Determine config file paths** (both canonical and legacy):
      - Project canonical: `${CLAUDE_PROJECT_DIR}/.claude/hooks-guard.config.json`
        (if `CLAUDE_PROJECT_DIR` is not set, use cwd)
      - Project legacy: `${CLAUDE_PROJECT_DIR}/.claude/guard-secrets.config.json`
      - User canonical: `~/.claude/hooks-guard.config.json`
      - User legacy: `~/.claude/guard-secrets.config.json`

   c. **Read each config file** using the Read tool. Note which exist
      and which don't. If a legacy file exists at a scope where the
      canonical file does NOT exist, flag it in the report so the user
      knows to migrate.

3. **Display the report.** Format it clearly:

   ```
   ## .env Reference Guard Configuration

   ### Built-in safe commands (prefix matching, always active)
   ls, stat, file, test, touch, chmod, chown, chgrp, du,
   find, fd, locate, which, whereis,
   sha256sum, sha1sum, md5sum, sha512sum, cksum, b2sum,
   mv, rename,
   basename, dirname, realpath, readlink,
   echo, printf,
   wc, gh,
   git log, git status, git branch, git remote, git tag,
   git add, git rm, git checkout, git switch,
   git fetch, git pull, git push, git clone, git init,
   git merge, git rebase, git cherry-pick

   ### Project-level exceptions (exact match)
   Path: /path/to/.claude/hooks-guard.config.json
   Status: [exists | not found | (legacy guard-secrets.config.json found)]
   Entries: (list or "none")

   ### User-level exceptions (exact match)
   Path: ~/.claude/hooks-guard.config.json
   Status: [exists | not found | (legacy guard-secrets.config.json found)]
   Entries: (list or "none")

   ### Active resolution
   At runtime, the guard checks:
   1. Built-in defaults (prefix) -> [N] entries
   2. [Project|User] config (exact) -> [M] entries
   ```

4. **If both config files exist**, note that only the **project-level**
   one is active at runtime (first found wins). The user-level config
   is ignored when a project-level config is present.

5. **Suggest next steps** if helpful:
   - "To add an exception: `/hooks-guard:guard-allow add <exact-command>`"
   - "To add at user level: `/hooks-guard:guard-allow add <exact-command> --user`"

## Important constraints

- This command is **read-only**. Never write or modify any file.
- Do not show file contents that might contain secrets — the config file
  only contains command strings, so it's safe to display.
- Use the Read tool (not Bash cat) to read config files.
