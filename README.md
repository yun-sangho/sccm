# SCCM — Sangho Claude Code Market

A personal Claude Code plugin marketplace.

## Quick start

### 1. Add the marketplace

In a Claude Code session:

```
/plugin marketplace add yun-sangho/sccm
```

This resolves to `github.com/yun-sangho/sccm` and works for anyone (the repo is public). If your environment prefers an explicit URL, either of these also works:

```
/plugin marketplace add https://github.com/yun-sangho/sccm.git
/plugin marketplace add git@github.com:yun-sangho/sccm.git
```

You can also install from a local clone during development:

```
/plugin marketplace add ~/project/marketplace
```

### 2. Install plugins

```
/plugin install hooks-common@sccm
/plugin install hooks-pnpm@sccm
/plugin install hooks-worktree@sccm
```

### 3. Verify installation

```
/plugin list
```

Once installed, hooks activate automatically — no extra configuration needed.

## Plugin list

| Plugin | Install command | Description |
|--------|-----------------|-------------|
| [hooks-common](plugins/hooks-common/) | `/plugin install hooks-common@sccm` | Security guard — blocks dangerous Bash commands and sensitive file access |
| [hooks-pnpm](plugins/hooks-pnpm/) | `/plugin install hooks-pnpm@sccm` | Blocks `npm` commands in pnpm projects |
| [hooks-worktree](plugins/hooks-worktree/) | `/plugin install hooks-worktree@sccm` | Git worktree automation — mirrors `.env` files (monorepo-safe) and auto-installs dependencies |

## CLI command reference

### Marketplace management

```bash
# Add marketplace
/plugin marketplace add yun-sangho/sccm

# Update marketplace (pick up new plugins)
/plugin marketplace update

# Validate marketplace
/plugin validate .
```

### Plugin management

```bash
# Install
/plugin install hooks-common@sccm

# List
/plugin list

# Disable
/plugin disable hooks-common@sccm

# Remove
/plugin remove hooks-common@sccm
```

## Auto-register the marketplace in a project

Adding this to your project's `.claude/settings.json` auto-registers the marketplace when a teammate trusts the project directory:

```json
{
  "extraKnownMarketplaces": {
    "sccm": {
      "source": {
        "source": "url",
        "url": "https://github.com/yun-sangho/sccm.git"
      }
    }
  },
  "enabledPlugins": {
    "hooks-common@sccm": true,
    "hooks-pnpm@sccm": true,
    "hooks-worktree@sccm": true
  }
}
```

## Behavior check

Once installed, dangerous commands are blocked inside Claude Code sessions:

```
# With hooks-common installed
> rm -rf /
BLOCKED: [rm-root] rm targeting root filesystem

> cat .env
BLOCKED: [cat-env] Reading .env file exposes secrets

# With hooks-pnpm installed
> npm install lodash
BLOCKED: [enforce-pnpm] This project uses pnpm. Use pnpm instead of npm.
```

Blocked commands are logged to `.claude/hooks-logs/YYYY-MM-DD.jsonl`.

## Plugin details

### hooks-common — security guard

Two guard hooks that preempt dangerous operations:

- **guard-bash**: blocks `rm -rf /`, fork bombs, `curl | sh`, `git push --force main`, and more
- **guard-secrets**: blocks access to `.env`, SSH keys, AWS credentials, etc.

Three safety levels (`critical` → `high` → `strict`) tune the block scope. See the [hooks-common README](plugins/hooks-common/README.md) for details.

### hooks-pnpm — enforce pnpm

Blocks `npm install`, `npm run`, and friends, and nudges you toward `pnpm`. See the [hooks-pnpm README](plugins/hooks-pnpm/README.md) for details.

### hooks-worktree — Git worktree automation

Universal worktree bootstrap. On `WorktreeCreate`:

1. Creates the worktree at `.claude/worktrees/{name}` on a fresh `worktree-{name}` branch.
2. Recursively mirrors every `.env` / `.env.local` from the main repo (monorepo-safe).
3. Copies `.claude/settings.local.json` (gitignored personal overrides).
4. Auto-detects the package manager via lockfiles and installs dependencies — supports **pnpm, bun, yarn, npm** (JavaScript), **uv, poetry, pipenv** (Python), **bundler** (Ruby), **cargo** (Rust), **go mod** (Go), **composer** (PHP). Polyglot monorepos run one install per detected language family.

On `WorktreeRemove`, tears the worktree and its `worktree-*` branch down cleanly. See the [hooks-worktree README](plugins/hooks-worktree/README.md) for details.

## Structure

```
marketplace/
├── .claude-plugin/
│   └── marketplace.json       # Marketplace registry
├── plugins/                   # Official plugins (pluginRoot)
│   ├── hooks-common/          # Security guard
│   ├── hooks-pnpm/            # Enforce pnpm
│   └── hooks-worktree/        # Git worktree automation
├── scripts/
│   ├── bump.mjs               # Version bump for a single plugin
│   └── verify-versions.mjs    # CI check — version consistency across files
└── README.md
```

## Plugin development guide

### Adding a new plugin

1. Create a `plugins/{name}/` directory
2. Add the required files:

```
plugins/{name}/
├── .claude-plugin/
│   └── plugin.json       # Metadata (name, version, description)
├── hooks/
│   └── hooks.json        # Hook registration (event, matcher, script)
├── scripts/
│   ├── my-hook.js        # Hook implementation
│   └── __tests__/        # Tests
├── package.json
└── README.md
```

3. Register it in the `plugins` array of `.claude-plugin/marketplace.json`
4. Validate, then commit

### Hook protocol

| Item | Description |
|------|-------------|
| Input | stdin JSON: `{ tool_name, tool_input, session_id, cwd }` |
| Allow | exit code `0` |
| Block | exit code `2` + stderr error message |
| Error | exit code `0` (fail-open — does not block) |

### Local testing

```bash
# Validate the marketplace
/plugin validate .

# Install from a local path
/plugin marketplace add ./path/to/marketplace
/plugin install hooks-common@sccm
```

### Unit tests

```bash
cd plugins/hooks-common && node --test scripts/__tests__/*.test.js
cd plugins/hooks-pnpm && node --test scripts/__tests__/*.test.js
cd plugins/hooks-worktree && node --test scripts/__tests__/*.test.js
```

## Versioning & releasing

Each plugin keeps its SemVer in three places:

1. `.claude-plugin/marketplace.json` — `plugins[name].version`
2. `plugins/<name>/.claude-plugin/plugin.json` — `version`
3. `plugins/<name>/package.json` — `version`

All three must agree. Use the bump helper to update them atomically:

```bash
# Bump a single plugin
node scripts/bump.mjs hooks-common patch       # 0.1.0 → 0.1.1
node scripts/bump.mjs hooks-pnpm minor         # 0.1.1 → 0.2.0
node scripts/bump.mjs hooks-worktree 1.0.0     # explicit version

# Check that every plugin's three version fields are in sync
node scripts/verify-versions.mjs
```

`verify-versions.mjs` exits non-zero on any mismatch and is suitable for pre-commit hooks or CI.

Standard release flow:

```bash
# 1. Edit the plugin
vim plugins/hooks-common/scripts/guard-bash.js

# 2. Bump version (atomic across the three files)
node scripts/bump.mjs hooks-common patch

# 3. Test + verify
cd plugins/hooks-common && node --test 'scripts/__tests__/*.test.js'
cd ../.. && node scripts/verify-versions.mjs

# 4. Commit + push
git add -A
git commit -m "hooks-common 0.1.1 — fix curl regex false positive"
git push

# 5. (Users) update their installation
claude plugin marketplace update sccm
claude plugin update hooks-common@sccm
```

## License

UNLICENSED (personal use)
