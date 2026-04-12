# sccm — Sangho Claude Code Marketplace

A monorepo of Claude Code plugins under `plugins/`. Each plugin has its own
`package.json`, `.claude-plugin/plugin.json`, and is also listed in
`.claude-plugin/marketplace.json`.

## Plugin version rule — ALWAYS bump on change

**If you modify any file under `plugins/<name>/`, you MUST bump that
plugin's version in the same change.**

Why: Claude Code keys plugin updates off the `version` field in
`marketplace.json` / `plugin.json`. If the version doesn't move, users
who installed the plugin via this marketplace will **not** receive the
update — Claude Code's cache treats it as unchanged. A modification
without a bump is effectively invisible to every existing user.

How: use the bump script — it updates all three places (marketplace.json,
plugin.json, package.json) atomically and refuses to run on a mismatch.

```
pnpm run bump <plugin-name> <patch|minor|major|X.Y.Z>
pnpm run verify-versions   # sanity check
```

Which level:
- **patch** — bug fix, doc change, internal refactor with no user-visible
  behavior change
- **minor** — new feature, new preset, new hook, new command, expanded
  default behavior (additive and backwards-compatible)
- **major** — breaking change: removed/renamed command, changed default
  that could surprise existing users, removed allow/exclude entries

Recent example of the trap: commit `af1e257` added `permissions.allow`
merging to `sccm-sandbox` but forgot to bump → fixed in `be0d62a` as
`0.2.0`. Don't repeat this. Bump in the same commit as the change, or as
the immediately following commit before pushing.

Order of operations when modifying a plugin:
1. Make the code/preset/hook/doc change under `plugins/<name>/`
2. `pnpm run bump <name> <level>`
3. `pnpm run verify-versions`
4. `claude plugin validate plugins/<name>`
5. `pnpm test` (or `pnpm run test:<name>`)
6. Commit (the bump can be in the same commit as the change, or its own
   commit immediately after — but never push the change without the bump)

## Plugin validation rule — ALWAYS validate on change

**If you modify any file under `plugins/<name>/`, you MUST run
`claude plugin validate plugins/<name>` and confirm it passes before
committing.**

Why: Claude Code's validator catches silent failure modes that nothing
else does, and they fail in ways the user never sees. Notably:

- **Command frontmatter YAML parse errors.** A malformed `argument-hint`,
  `allowed-tools`, or `description` in `commands/*.md` fails to parse,
  and Claude Code "loads the command with empty metadata (all
  frontmatter fields silently dropped)". The command still appears and
  still runs — but with **no `allowed-tools` whitelist** (permission
  scoping lost, every Bash call prompts), **no `description`** (blank in
  the slash-command picker), and **no `argument-hint`** (no usage
  guidance). `pnpm test` and `pnpm run verify-versions` do not catch
  this. `claude plugin install` does not block on it either. The only
  signal is the validator.
- **Plugin manifest / hooks.json schema violations.** Same story — loads
  with empty metadata, looks fine at a glance, silently drops fields.

Concrete example of the trap: commit `e20f975` fixed 7 `commands/*.md`
files across 5 plugins whose `argument-hint: [bug|feature] [optional:
short title]` was being parsed as a YAML flow sequence and then failing
at the second `[`. The bug had been in the repo since `cf5f14c` (the
initial `report-issue` command commit) and nobody noticed — installs
succeeded, tests passed, versions were consistent. Only `claude plugin
validate` surfaced it.

How:

```
claude plugin validate plugins/<name>
```

Expected output on success:

```
Validating plugin manifest: /path/to/plugin.json
✔ Validation passed
```

If the validator emits a **warning** (`✔ Validation passed with
warnings`) read it and decide — warnings are non-blocking but are usually
signalling something worth fixing (e.g. missing `author` metadata).

If the validator emits an **error** (`✘ Validation failed`), do not
commit. Fix the underlying file, re-run, and only commit once it passes.

## Repo commands

| Command | What it does |
|---|---|
| `pnpm test` | Run every plugin's tests |
| `pnpm run test:<plugin>` | Run one plugin's tests |
| `pnpm run verify-versions` | Assert all three version files agree per plugin |
| `pnpm run bump <plugin> <level>` | Bump a plugin's version in all three files |
| `claude plugin validate plugins/<name>` | Validate one plugin's manifest, hooks, and command frontmatter |

## Package manager

This repo uses **pnpm**. The `hooks-pnpm` plugin enforces this — `npm`
commands at the repo root are blocked by a PreToolUse hook. Always use
`pnpm`.

## Plugin integration testing

Unit tests (`pnpm test`) verify logic, but **integration tests** verify
that the installed plugin actually blocks/allows commands correctly.

### Quick setup (run once per session)

```bash
# 1. Register the local marketplace
claude plugin marketplace add /home/user/sccm

# 2. Install the plugin you want to test
claude plugin install hooks-guard@sccm

# 3. Verify installation
claude plugin list
# Expected: hooks-guard@sccm  Version: X.Y.Z  Status: ✔ enabled
```

**Note:** Hooks from newly installed plugins only take effect on the
**next** Claude Code session. For the current session, test via direct
script invocation (see below).

### Testing hooks via direct invocation

Pipe JSON into the hook script to simulate PreToolUse events:

```bash
# Find the installed plugin path
PLUGIN_ROOT=$(python3 -c "
import json
d = json.load(open('/root/.claude/plugins/installed_plugins.json'))
p = d['plugins']['hooks-guard@sccm'][0]
print(p['installPath'])
")
GUARD="$PLUGIN_ROOT/scripts/guard-secrets.js"

# Test a command (exit 0 = allowed, exit 2 = blocked)
echo '{"tool_name":"Bash","tool_input":{"command":"grep SECRET .env"},"session_id":"test","cwd":"/tmp"}' \
  | CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" node "$GUARD" 2>&1
echo "EXIT: $?"
```

### Testing with config files

```bash
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.claude"

# Write a test config
echo '{"envRefAllowCommands":["grep SECRET .env"]}' > "$TMPDIR/.claude/guard-secrets.config.json"

# Test with config (CLAUDE_PROJECT_DIR points to tmp dir)
echo '{"tool_name":"Bash","tool_input":{"command":"grep SECRET .env"},"session_id":"test","cwd":"/tmp"}' \
  | CLAUDE_PROJECT_DIR="$TMPDIR" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" node "$GUARD" 2>&1
echo "EXIT: $?"  # should be 0 (allowed by exact match)

# Cleanup
rm -rf "$TMPDIR"
```

### Batch test template

```bash
PLUGIN_ROOT="..."  # set from above
GUARD="$PLUGIN_ROOT/scripts/guard-secrets.js"

test_cmd() {
  local expected="$1" cmd="$2"
  local result exit_code
  result=$(echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$cmd\"},\"session_id\":\"test\",\"cwd\":\"/tmp\"}" \
    | CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" node "$GUARD" 2>&1)
  exit_code=$?
  if [ "$expected" = "block" ] && [ $exit_code -eq 2 ]; then
    echo "  ✓ BLOCKED: $cmd"
  elif [ "$expected" = "allow" ] && [ $exit_code -eq 0 ]; then
    echo "  ✓ ALLOWED: $cmd"
  else
    echo "  ✗ UNEXPECTED (exit=$exit_code, expected=$expected): $cmd"
  fi
}

test_cmd block "grep SECRET .env"
test_cmd block "docker compose --env-file .env.local up"
test_cmd block "sed 's/foo/bar/' .env"
test_cmd allow "ls -la .env"
test_cmd allow "find . -name .env"
test_cmd allow "git log --all -- .env"
```

### Full flow test (config CRUD + guard behavior)

This tests the complete `/guard-allow` flow end-to-end:

```bash
PLUGIN_ROOT=$(python3 -c "
import json; d = json.load(open('/root/.claude/plugins/installed_plugins.json'))
print(d['plugins']['hooks-guard@sccm'][0]['installPath'])")
GUARD="$PLUGIN_ROOT/scripts/guard-secrets.js"

PROJ=$(mktemp -d); USERHOME=$(mktemp -d)

test_cmd() {
  local expected="$1" cmd="$2"
  local exit_code
  echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$cmd\"},\"session_id\":\"test\",\"cwd\":\"/tmp\"}" \
    | CLAUDE_PROJECT_DIR="$PROJ" HOME="$USERHOME" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" node "$GUARD" >/dev/null 2>&1
  exit_code=$?
  if { [ "$expected" = "block" ] && [ $exit_code -eq 2 ]; } || \
     { [ "$expected" = "allow" ] && [ $exit_code -eq 0 ]; }; then
    echo "  ✓ ($expected) $cmd"
  else
    echo "  ✗ FAIL (exit=$exit_code, expected=$expected) $cmd"
  fi
}

# Phase 1: no config → defaults only
test_cmd block "grep SECRET .env"
test_cmd allow "ls -la .env"

# Phase 2: project-scope exception (exact match)
mkdir -p "$PROJ/.claude"
echo '{"envRefAllowCommands":["grep SECRET .env"]}' > "$PROJ/.claude/guard-secrets.config.json"
test_cmd allow "grep SECRET .env"      # exact match → passes
test_cmd block "grep API_KEY .env"     # different args → blocked

# Phase 3: user-scope exception
rm "$PROJ/.claude/guard-secrets.config.json"
mkdir -p "$USERHOME/.claude"
echo '{"envRefAllowCommands":["diff .env .env.bak"]}' > "$USERHOME/.claude/guard-secrets.config.json"
test_cmd allow "diff .env .env.bak"    # user scope works
test_cmd block "grep SECRET .env"      # not in user config

# Phase 4: project > user priority
echo '{"envRefAllowCommands":["grep SECRET .env"]}' > "$PROJ/.claude/guard-secrets.config.json"
test_cmd allow "grep SECRET .env"      # project wins
test_cmd block "diff .env .env.bak"    # user ignored when project exists

rm -rf "$PROJ" "$USERHOME"
```

### Re-installing after code changes

After modifying plugin code, re-install to update the cached copy:

```bash
claude plugin uninstall hooks-guard@sccm
claude plugin install hooks-guard@sccm
```

The install copies files to `~/.claude/plugins/cache/sccm/<plugin>/<version>/`.
Unit tests run against source (`plugins/<name>/scripts/`), but integration
tests should run against the cached copy to match real-world behavior.
