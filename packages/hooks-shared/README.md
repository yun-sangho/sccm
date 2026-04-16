# @sccm/hooks-shared

Canonical source for utilities shared across the sccm hook plugins
(`hooks-guard`, `hooks-pnpm`, `hooks-permission-log`).

## Why this package exists

Claude Code plugins are distributed as self-contained directories: at
install time, a plugin cannot reach sibling plugins for runtime code.
Declaring an external npm dependency is not an option either — the
marketplace installer does not run `npm install` on plugins.

To avoid drifting copies of the same helper living in three different
plugins, this package holds the **canonical source**. A sync script
copies the files into each plugin's `scripts/_shared/` directory as
part of the development flow. Plugins `require("./_shared/<module>")`
and are fully self-contained at runtime.

## Workflow

```
# Edit the canonical source
vim packages/hooks-shared/src/stdin.js

# Copy into every plugin's _shared/
pnpm run sync-shared

# Run the full test suite (shared tests + per-plugin tests)
pnpm test

# Verify drift before committing
pnpm run verify-shared
```

`verify-shared` runs in CI-style mode: it compares the files under
`plugins/*/scripts/_shared/` against the canonical source and exits
non-zero if any diverge. Treat a verify-shared failure the same way
you would a `pnpm run verify-versions` failure — re-run the sync.

## Modules

| File | Export | Notes |
|---|---|---|
| `src/stdin.js` | `readStdin()` | Reads all of stdin, parses JSON, returns `{}` for empty input. |
| `src/logging.js` | `appendJsonl(logDir, entry)` | Appends one JSON line to `<logDir>/YYYY-MM-DD.jsonl`. Creates the dir if needed. Swallows IO errors (never throws — hooks must not break). |
| `src/exit.js` | `block(id, reason)`, `allow()` | Writes the canonical `BLOCKED: [id] reason` line to stderr and exits 2, or exits 0 silently. |
| `src/shell-chain.js` | `splitShellChain(cmd)` | Splits a bash string on top-level `&&`/`\|\|`/`;`/`\|`/`&` while respecting quotes, `$(...)`, and backticks. |

## Editing rules

- **Never edit** `plugins/*/scripts/_shared/*` — those files are
  regenerated on every `pnpm run sync-shared` and any manual change
  is caught by `pnpm run verify-shared` on the next commit.
- **Always** add a unit test to `__tests__/` when changing behaviour.
  Plugin-level tests exercise these functions indirectly via each
  plugin's own `utils.js`, so a shared-lib bug shows up as a plugin
  test failure too — but the centralized tests catch the regression
  earlier.
- **Never** add plugin-specific logic here. If a helper only needs to
  live in one plugin, keep it in that plugin's `scripts/`.
