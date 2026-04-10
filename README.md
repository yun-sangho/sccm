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
/plugin install hooks-guard@sccm
/plugin install hooks-pnpm@sccm
/plugin install hooks-worktree@sccm
/plugin install sccm-sandbox@sccm
```

### 3. Verify installation

```
/plugin list
```

Once installed, hooks activate automatically — no extra configuration needed.

## Plugin list

| Plugin | Install command | Description |
|--------|-----------------|-------------|
| [hooks-guard](plugins/hooks-guard/) | `/plugin install hooks-guard@sccm` | Security guard — blocks dangerous Bash commands and sensitive file access |
| [hooks-pnpm](plugins/hooks-pnpm/) | `/plugin install hooks-pnpm@sccm` | Blocks `npm` commands in pnpm projects |
| [hooks-worktree](plugins/hooks-worktree/) | `/plugin install hooks-worktree@sccm` | Git worktree automation — mirrors `.env` files (monorepo-safe) and auto-installs dependencies |
| [sccm-sandbox](plugins/sccm-sandbox/) | `/plugin install sccm-sandbox@sccm` | Vetted `sandbox.*` presets + `/sccm-sandbox:apply` slash command |

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
/plugin install hooks-guard@sccm

# List
/plugin list

# Disable
/plugin disable hooks-guard@sccm

# Remove
/plugin remove hooks-guard@sccm
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
    "hooks-guard@sccm": true,
    "hooks-pnpm@sccm": true,
    "hooks-worktree@sccm": true,
    "sccm-sandbox@sccm": true
  }
}
```

## Behavior check

Once installed, dangerous commands are blocked inside Claude Code sessions:

```
# With hooks-guard installed
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

### hooks-guard — security guard

Two guard hooks that preempt dangerous operations:

- **guard-bash**: blocks `rm -rf /`, fork bombs, `curl | sh`, `git push --force main`, and more
- **guard-secrets**: blocks access to `.env`, SSH keys, AWS credentials, etc.

Three safety levels (`critical` → `high` → `strict`) tune the block scope. See the [hooks-guard README](plugins/hooks-guard/README.md) for details.

### hooks-pnpm — enforce pnpm

Blocks `npm install`, `npm run`, and friends, and nudges you toward `pnpm`. See the [hooks-pnpm README](plugins/hooks-pnpm/README.md) for details.

### hooks-worktree — Git worktree automation

Universal worktree bootstrap. On `WorktreeCreate`:

1. Creates the worktree at `.claude/worktrees/{name}` on a fresh `worktree-{name}` branch.
2. Recursively mirrors every `.env` / `.env.local` from the main repo (monorepo-safe).
3. Copies `.claude/settings.local.json` (gitignored personal overrides).
4. Auto-detects the package manager via lockfiles and installs dependencies — supports **pnpm, bun, yarn, npm** (JavaScript), **uv, poetry, pipenv** (Python), **bundler** (Ruby), **cargo** (Rust), **go mod** (Go), **composer** (PHP). Polyglot monorepos run one install per detected language family.

On `WorktreeRemove`, tears the worktree and its `worktree-*` branch down cleanly. See the [hooks-worktree README](plugins/hooks-worktree/README.md) for details.

## Sandbox presets

Pre-built `sandbox.*` settings snippets for common dev workflows. They live inside the [`sccm-sandbox`](plugins/sccm-sandbox/) plugin (not as bundled plugin settings — Claude Code's plugin system intentionally forbids plugins from shipping `sandbox.*` or `permissions.*` keys, only `agent` settings are honored, per the [plugin reference](https://code.claude.com/docs/en/plugins-reference)). Apply them via the slash command, or use one of the manual flows below.

### Available profiles

| Profile | What it allows | Heads-up |
|---------|---------------|----------|
| `min` | Anthropic API + GitHub HTTPS + npm registry + Supabase + Vercel. Minimal bootstrap. | Stays fully sandboxed |
| `base` (default) | Broader network (Yarn / PyPI / Docker Hub / Supabase / Vercel …) **and** runs `docker / npm / pnpm / yarn / bun / pip / uv / poetry / cargo / go / git / gh` **outside** the sandbox via `excludedCommands` | Excluded commands have **no** OS-level sandbox protection — see the warning below |

### Apply: slash command (recommended)

Once `sccm-sandbox@sccm` is installed, run inside any Claude Code session:

```
/sccm-sandbox:apply              # defaults to 'base'
/sccm-sandbox:apply min --dry-run
/sccm-sandbox:apply base --shared
```

The command shells out to the bundled merge script via `${CLAUDE_PLUGIN_ROOT}` — no clone, no curl, no shell-hopping.

### Apply: direct download (no plugin install)

If `.claude/settings.local.json` doesn't exist yet, just drop the file in:

```bash
mkdir -p .claude
curl -fsSL https://raw.githubusercontent.com/yun-sangho/sccm/main/plugins/sccm-sandbox/presets/base.json \
  -o .claude/settings.local.json
```

### Apply: run the script directly (no plugin install)

If `.claude/settings.local.json` already exists (or has other keys you want to keep), and you have the repo cloned, run the merge helper. It concatenates array fields, dedupes, preserves any user-set scalar values, and **never touches non-`sandbox` top-level keys**.

```bash
# Default target: <cwd>/.claude/settings.local.json
node plugins/sccm-sandbox/scripts/sandbox-apply.mjs base

# Preview without writing
node plugins/sccm-sandbox/scripts/sandbox-apply.mjs base --dry-run

# Apply to shared (team-committed) settings instead of local
node plugins/sccm-sandbox/scripts/sandbox-apply.mjs base --shared
```

> ⚠ Sandbox config changes only take effect on **new** sessions. Restart Claude Code after applying.

### Trade-off: `excludedCommands` runs unsandboxed

The `base` profile lists package managers and git/gh under `sandbox.excludedCommands`. Per [official sandboxing guidance](https://code.claude.com/docs/en/sandboxing), this is the recommended way to make these tools work — but commands in this list run **entirely outside** the sandbox: free filesystem, free network, all child processes (including `npm` postinstall scripts) inherit that. The `hooks-guard` PreToolUse layer still applies, so the dangerous patterns it knows about (`git push --force main`, `docker run --privileged`, …) are still blocked, but OS-level protection is gone for those commands. If you want stricter sandboxing, use `min` instead.

If you want stricter sandboxing for some of these tools, edit your local `.claude/settings.local.json` after applying and remove individual entries from `sandbox.excludedCommands`.

### Known issues to be aware of

- [anthropics/claude-code#37970](https://github.com/anthropics/claude-code/issues/37970) — `sandbox.network.allowedDomains` may be ignored on Cowork / Remote.
- [anthropics/claude-code#33231](https://github.com/anthropics/claude-code/issues/33231) — `httpProxyPort` connection refused when using a custom proxy.

## Bugs and feedback

Every plugin ships a `/<plugin>:report-issue` slash command that
auto-collects your version, OS, and recent conversation context, then files
a structured issue at
[github.com/yun-sangho/sccm/issues](https://github.com/yun-sangho/sccm/issues/new/choose):

```
/hooks-guard:report-issue bug
/sccm-sandbox:report-issue feature
```

If `gh` (GitHub CLI) is not installed, the command opens a pre-filled
browser form instead. You can also file directly on GitHub — the repo has
structured issue templates for both bugs and feature requests.

## Cloud automations

An hourly Claude Code scheduled task on Anthropic cloud auto-triages
every new issue: classifies the plugin, decides bug vs. enhancement,
flags duplicates, asks for missing info, and posts a single Discord
summary with clickable links back to the issues.

The canonical prompt lives at [`prompts/triage.md`](prompts/triage.md);
the cloud trigger holds only a small bootstrap
([`prompts/triage.bootstrap.md`](prompts/triage.bootstrap.md)) that
fetches the canonical prompt via the GitHub MCP and follows it. To
change triage behavior, edit `prompts/triage.md` on `main` and push —
the next hourly run picks it up automatically. See
[`prompts/README.md`](prompts/README.md) for required labels and
deploy notes.

## Structure

```
marketplace/
├── .claude-plugin/
│   └── marketplace.json         # Marketplace registry
├── plugins/                     # Official plugins (pluginRoot)
│   ├── hooks-guard/             # Security guard (Bash + secret access)
│   ├── hooks-pnpm/              # Enforce pnpm
│   ├── hooks-worktree/          # Git worktree automation
│   └── sccm-sandbox/            # Sandbox.* presets + /sccm-sandbox:apply command
│       ├── commands/apply.md    # Slash command entrypoint (defaults to base)
│       ├── presets/             # min.json, base.json
│       └── scripts/             # sandbox-apply.mjs + tests
├── prompts/                     # Prompts for cloud-side Claude Code automations
│   ├── triage.md                # Canonical hourly issue-triage prompt
│   ├── triage.bootstrap.md      # Tiny bootstrap pasted into the cloud trigger
│   └── README.md                # Required labels + deploy notes
├── scripts/
│   ├── bump.mjs                 # Version bump for a single plugin
│   └── verify-versions.mjs      # CI check — version consistency across files
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
/plugin install hooks-guard@sccm
```

### Unit tests

```bash
# Per-plugin
cd plugins/hooks-guard && node --test scripts/__tests__/*.test.js
cd plugins/hooks-pnpm && node --test scripts/__tests__/*.test.js
cd plugins/hooks-worktree && node --test scripts/__tests__/*.test.js
cd plugins/sccm-sandbox && node --test scripts/__tests__/*.test.mjs
```

## Versioning & releasing

Each plugin keeps its SemVer in three places:

1. `.claude-plugin/marketplace.json` — `plugins[name].version`
2. `plugins/<name>/.claude-plugin/plugin.json` — `version`
3. `plugins/<name>/package.json` — `version`

All three must agree. Use the bump helper to update them atomically:

```bash
# Bump a single plugin
node scripts/bump.mjs hooks-guard patch       # 0.1.0 → 0.1.1
node scripts/bump.mjs hooks-pnpm minor         # 0.1.1 → 0.2.0
node scripts/bump.mjs hooks-worktree 1.0.0     # explicit version

# Check that every plugin's three version fields are in sync
node scripts/verify-versions.mjs
```

`verify-versions.mjs` exits non-zero on any mismatch and is suitable for pre-commit hooks or CI.

Standard release flow:

```bash
# 1. Edit the plugin
vim plugins/hooks-guard/scripts/guard-bash.js

# 2. Bump version (atomic across the three files)
node scripts/bump.mjs hooks-guard patch

# 3. Test + verify
cd plugins/hooks-guard && node --test 'scripts/__tests__/*.test.js'
cd ../.. && node scripts/verify-versions.mjs

# 4. Commit + push
git add -A
git commit -m "hooks-guard 0.1.1 — fix curl regex false positive"
git push

# 5. (Users) update their installation
claude plugin marketplace update sccm
claude plugin update hooks-guard@sccm
```

## License

UNLICENSED (personal use)
