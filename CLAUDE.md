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
| `pnpm test` | Run every plugin's tests + the shared-package tests |
| `pnpm run test:shared` | Run only `packages/hooks-shared/` tests |
| `pnpm run test:<plugin>` | Run one plugin's tests |
| `pnpm run verify-versions` | Assert all three version files agree per plugin |
| `pnpm run verify-shared` | Assert each plugin's `_shared/` matches `packages/hooks-shared/src/` |
| `pnpm run sync-shared` | Copy `packages/hooks-shared/src/` into each plugin's `scripts/_shared/` |
| `pnpm run bump <plugin> <level>` | Bump a plugin's version in all three files |
| `claude plugin validate plugins/<name>` | Validate one plugin's manifest, hooks, and command frontmatter |

## Shared hook utilities

Utilities used by more than one hook plugin (`readStdin`, `appendJsonl`,
`block`/`allow`, `splitShellChain`) live in **`packages/hooks-shared/src/`**
as the single canonical source. Because Claude Code plugins are distributed
as self-contained directories and the marketplace installer does not run
`npm install`, the shared files are **copied** into each plugin's
`scripts/_shared/` directory by `pnpm run sync-shared`.

Rules:

- **Never edit** `plugins/*/scripts/_shared/*`. Those files are regenerated
  on every `pnpm run sync-shared` and `pnpm run verify-shared` fails the
  build if they drift from the canonical source.
- When you change a file under `packages/hooks-shared/src/`, immediately
  run `pnpm run sync-shared` to propagate the change, then `pnpm test` to
  confirm both the shared tests and every consuming plugin still pass.
- Bump the **consuming plugins** (not `hooks-shared`) when a shared change
  lands — the version bump rule is about what the marketplace user
  installs, and they install plugins, not this package.

## Package manager

This repo uses **pnpm**. The `hooks-pnpm` plugin enforces this — `npm`
commands at the repo root are blocked by a PreToolUse hook. Always use
`pnpm`.

