# SCCM — Sangho Claude Code Market

A personal Claude Code plugin marketplace.

## Quick start

### 1. Add the marketplace

In a Claude Code session:

```
/plugin marketplace add <TODO: your git URL or local path>
```

You can also use a local path directly:

```
/plugin marketplace add ~/project/marketplace
```

### 2. Install plugins

```
/plugin install hooks-common@sccm
/plugin install hooks-pnpm@sccm
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
/plugin marketplace add ~/project/marketplace

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
        "url": "<TODO: your git URL>"
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

## License

UNLICENSED (personal use)
