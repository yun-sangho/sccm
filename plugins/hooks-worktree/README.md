# hooks-worktree — Git worktree automation

A universal Claude Code plugin that bootstraps a new Git worktree so it is ready to use immediately: copies env files, brings over gitignored local Claude settings, and installs dependencies across most mainstream language ecosystems.

## Install

```bash
claude plugin install hooks-worktree@sccm
```

## What it does

On `WorktreeCreate`, in order:

1. **Creates the Git worktree** at `.claude/worktrees/{name}` on a new `worktree-{name}` branch.
2. **Copies every `.env` / `.env.local` file** from the main repo to the same relative path inside the worktree. Monorepo-safe — recursively walks the repo and finds env files at any depth (`apps/api/.env`, `packages/db/.env.local`, `services/ml/.env`, …). Template files (`.env.example`, `.env.sample`, `.env.template`, `.env.defaults`) are skipped.
3. **Copies `.claude/settings.local.json`** if it exists in the main repo. This file is typically gitignored so it would otherwise be missing from the new worktree.
4. **Detects package managers by lockfile** at the worktree root and runs the appropriate install for each detected language family. See the table below.

On `WorktreeRemove`:

1. `git worktree remove --force` (falls back to manual directory removal + `git worktree prune`).
2. Deletes the `worktree-*` branch.

No port allocation, no `lsof`/process killing. Keeps the automation small and predictable.

## Supported package managers

| Family | Lockfile (priority order) | Install command (tried in order) |
|--------|---------------------------|----------------------------------|
| JavaScript | `pnpm-lock.yaml` → `bun.lockb` → `yarn.lock` → `package-lock.json` | `pnpm install --frozen-lockfile` → `pnpm install` (and similar for bun / yarn / `npm ci` → `npm install`) |
| Python | `uv.lock` → `poetry.lock` → `Pipfile.lock` | `uv sync --frozen` → `uv sync` / `poetry install` / `pipenv install --deploy` → `pipenv install` |
| Ruby | `Gemfile.lock` | `bundle install` |
| Rust | `Cargo.lock` | `cargo fetch` |
| Go | `go.sum` | `go mod download` |
| PHP | `composer.lock` | `composer install` |

**Priority:** within a family the first lockfile found wins, so `pnpm-lock.yaml` + `package-lock.json` in the same repo picks pnpm. **Polyglot repos** (e.g. a JS app plus a Python service) run one install per detected family.

**Install failures are non-fatal** — if the install command fails (missing binary, lockfile drift, network error), the hook logs to `.worktree-setup.log` inside the worktree and proceeds. The worktree is still created.

## Env file discovery rules

- Matches `^\.env(?:\.local)?$` exactly — only `.env` and `.env.local`.
- Walks recursively from `CLAUDE_PROJECT_DIR`.
- Skipped directory names:
  - Hidden dirs (`.git`, `.claude`, `.github`, ...)
  - `node_modules`, `dist`, `build`, `out`, `.next`, `.turbo`, `.cache`, `coverage`
  - `target` (Rust), `vendor` (Ruby/PHP), `.venv` / `venv` / `__pycache__` (Python)

## Tests

```bash
cd plugins/hooks-worktree
node --test scripts/__tests__/*.test.js
```

## Known issue on Claude Code 2.1.101 — and a one-command workaround

On Claude Code 2.1.101, plugin-registered `WorktreeCreate` / `WorktreeRemove` hooks (the ones declared in `hooks/hooks.json`) are **silently dropped** by the runtime, so new worktrees are created with nothing copied into them. See [yun-sangho/sccm#9](https://github.com/yun-sangho/sccm/issues/9) and [anthropics/claude-code#46664](https://github.com/anthropics/claude-code/issues/46664) for the full diagnosis — the same events registered in `~/.claude/settings.json` do fire, so the bug is limited to plugin dispatch.

Until that ships a fix, this plugin ships a one-command bridge:

```
/hooks-worktree:install-workaround      # install the bridge
/hooks-worktree:uninstall-workaround    # remove it once upstream is fixed
```

The install command merges two entries into `~/.claude/settings.json` that point at the plugin's on-disk scripts via the stable marketplace path (`~/.claude/plugins/marketplaces/sccm/plugins/hooks-worktree/scripts/`). That path is the marketplace git checkout, not the per-version cache, so the bridge keeps working across plugin version bumps without re-running.

The bridge is:

- **Idempotent** — re-running `install` is a no-op.
- **Non-destructive** — any pre-existing `WorktreeCreate` / `WorktreeRemove` entries the user authored themselves are preserved. Only entries marked with the `hooks-worktree@sccm/workaround` marker are touched on uninstall.
- **Reversible** — `uninstall-workaround` removes exactly what `install-workaround` added and nothing else.

If you'd rather edit `~/.claude/settings.json` by hand, the equivalent entries are:

```jsonc
{
  "hooks": {
    "WorktreeCreate": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins/marketplaces/sccm/plugins/hooks-worktree/scripts/worktree-create.js\"",
            "timeout": 600
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins/marketplaces/sccm/plugins/hooks-worktree/scripts/worktree-remove.js\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Reporting bugs / suggesting features

From inside Claude Code:

```
/hooks-worktree:report-issue bug       # file a bug report
/hooks-worktree:report-issue feature   # suggest an improvement
```

The command auto-collects the plugin version, OS, and recent conversation
context, then files a structured issue at
[github.com/yun-sangho/sccm/issues](https://github.com/yun-sangho/sccm/issues/new/choose).
If `gh` is not installed it opens a pre-filled browser form instead.

## Structure

```
plugins/hooks-worktree/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json           # WorktreeCreate (600s timeout), WorktreeRemove (30s)
├── commands/
│   ├── install-workaround.md     # bridge for Claude Code 2.1.101 dispatch bug
│   ├── uninstall-workaround.md
│   └── report-issue.md
├── scripts/
│   ├── worktree-create.js
│   ├── worktree-remove.js
│   ├── install-workaround.js     # merges settings.json bridge entries
│   └── __tests__/
│       ├── worktree-create.test.js
│       └── install-workaround.test.js
├── package.json
└── README.md
```
