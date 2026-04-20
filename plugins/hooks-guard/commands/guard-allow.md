---
description: "Add or remove exact-match command exceptions for the .env reference guard. Manages hooks-guard.config.json at project or user scope."
argument-hint: "<add|remove> <exact-command> [--project|--user]"
allowed-tools: Read, Write, Bash(node:*)
---

The user wants to **add or remove** an exact-match exception from the
`.env` reference guard's user config. This command edits
`hooks-guard.config.json` directly via the Read and Write tools (never
via Bash) to avoid the guard hook itself blocking the operation.

## How the two-layer matching works

The `.env` reference guard has two layers:

1. **Built-in safe commands** (`DEFAULT_ENV_REF_ALLOW_COMMANDS`) — prefix
   matching, always active, not user-editable via config. `"ls"` allows
   `ls -la .env`, `"git log"` allows `git log --all -- .env`.

2. **User exceptions** (`envRefAllowCommands` in config file) — **exact
   match only**. The trimmed command must equal the entry exactly. This
   command manages this layer.

**This means:** if a user adds `"grep SECRET .env"`, only the exact
command `grep SECRET .env` is allowed. `grep API_KEY .env` would still be
blocked. This is by design — maximum tightness.

## Plugin identity

- Plugin name: `hooks-guard`
- Config filename: `hooks-guard.config.json` (canonical)
- Legacy filename: `guard-secrets.config.json` — still read at runtime
  for backwards compatibility; this command writes to the canonical name.

## Config file locations (first found wins at runtime)

| Priority | Scope | Path |
|---|---|---|
| 1 (highest) | project | `{CLAUDE_PROJECT_DIR}/.claude/hooks-guard.config.json` |
| 2 | project (legacy) | `{CLAUDE_PROJECT_DIR}/.claude/guard-secrets.config.json` |
| 3 | user | `~/.claude/hooks-guard.config.json` |
| 4 | user (legacy) | `~/.claude/guard-secrets.config.json` |

If no config file exists, there are zero user exceptions (only built-in
defaults apply).

## Steps

1. **Parse `$ARGUMENTS`.**

   Expected forms:
   - `add <exact-command>` — add an exact-match entry
   - `add <exact-command> --user` — add to user-level config
   - `add <exact-command> --project` — add to project-level config (default)
   - `remove <exact-command>` — remove an entry
   - `remove <exact-command> --user` — remove from user-level config

   If `$ARGUMENTS` is empty or unclear, ask the user interactively:
   1. "Add or remove?" (default: add)
   2. "Which exact command to allow?" — prompt for the **full command
      string** they want to whitelist (e.g. `grep SECRET .env`,
      `docker compose --env-file .env.staging up -d`)
   3. "Which scope — project or user?" (default: project)

   **Default scope is `project`** unless `--user` is specified.

   **Important:** Explain to the user that this is an **exact match**.
   The registered command string must match the blocked command exactly
   (after trimming whitespace). If they need multiple variants, they
   should add each one separately.

2. **Determine the config file path.**

   - If scope is `project`: use `${CLAUDE_PROJECT_DIR}/.claude/hooks-guard.config.json`
     (if `CLAUDE_PROJECT_DIR` is not set, use the current working directory)
   - If scope is `user`: use `~/.claude/hooks-guard.config.json`

   Resolve `~` to the actual home directory path.

3. **Read the existing config file** using the Read tool.

   - If the canonical file `hooks-guard.config.json` exists at the chosen
     scope, parse the JSON and extract `envRefAllowCommands`.
   - Else if the legacy file `guard-secrets.config.json` exists at the
     same scope, read from it. Treat its contents as the starting point,
     but **write to the canonical filename** in step 6. Tell the user
     at the end that the legacy file was read and can be deleted once
     they have verified the new canonical file is correct.
   - Else, start with an **empty array** `[]`.
     (Built-in defaults are always active separately — they are not in
     this config file.)

4. **Perform the action.**

   - **add**: Check if the entry already exists in the array.
     - If yes, tell the user: `"<entry>" is already in the allow list.`
     - If no, append the entry to the array.
   - **remove**: Check if the entry exists in the array.
     - If yes, remove it.
     - If no, tell the user: `"<entry>" is not in the allow list.`

5. **Show the user what will change** before writing.

   Display a brief summary:
   ```
   Scope:   project (.claude/hooks-guard.config.json)
   Action:  add "grep SECRET .env"
   Match:   exact (only this exact command will pass)
   Result:  2 -> 3 entries
   ```

   Ask for confirmation: "Proceed? (yes/no)". If no, stop.

6. **Write the updated config** using the Write tool.

   Write the full JSON object:
   ```json
   {
     "envRefAllowCommands": [
       ...updated array...
     ]
   }
   ```

   Use 2-space indentation. Ensure the `.claude/` directory exists — if
   writing to a project that has no `.claude/` directory yet, create it
   via `mkdir -p` using Bash first (this is safe — no `.env` in the
   command).

7. **Confirm success.** Tell the user:
   - What was added/removed
   - The file path written
   - Remind them: "This is an exact match. Only the command
     `<entry>` will be allowed. Variations will still be blocked."
   - The change takes effect on the **next** tool call (hooks are
     short-lived processes, no restart needed)

## Important constraints

- **NEVER use Bash to write the config file.** The guard-secrets hook
  monitors Bash commands, and a Bash command containing `.env` in its
  arguments would be blocked by the very guard we're configuring. Always
  use the Read and Write tools for file I/O.
- Do not modify any other file. Only touch `hooks-guard.config.json`.
- Do not show the user's entire existing config unless they ask — it may
  be long.
- If the config file has extra keys beyond `envRefAllowCommands`, preserve
  them when writing back.
- The entry is an **exact command string** (not a prefix, not a regex).
  Examples:
  - `"grep SECRET .env"` — allows only `grep SECRET .env` exactly
  - `"docker compose --env-file .env.staging up -d"` — allows only that
    exact command
  - `"sed -i 's/old/new/' .env.local"` — allows only that exact sed call
