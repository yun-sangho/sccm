# Testing guide

Three testing layers, each catching a different class of failure. Run
them in order — later layers assume earlier ones pass.

## 1. Unit / integration — `pnpm test`

`node:test` suites under `plugins/<name>/scripts/__tests__/`. Cover
pure JS logic: regex patterns, JSON parsing, CLI arg parsing, redact /
truncate helpers, archival branches. Fast — 600+ tests in ~1–2s.

| Command | Scope |
|---|---|
| `pnpm test` | Every plugin |
| `pnpm run test:<plugin>` | One plugin |

**Does NOT cover:** whether `hooks.json` wires a script on the right
event, whether the stdin → exit-code contract still holds end-to-end,
whether command frontmatter parses.

## 2. Plugin validation — `claude plugin validate plugins/<name>`

Catches schema violations in `plugin.json`, `hooks.json`, and
`commands/*.md` frontmatter that silently drop metadata. See the
"Plugin validation rule" in [CLAUDE.md](CLAUDE.md) for why neither
unit tests nor version checks surface these failures.

**Does NOT cover:** wrong event/matcher on a structurally-valid
`hooks.json` ("script runs, but on the wrong trigger").

## 3. Hook E2E — stdin boundary simulation

Every hook follows the same contract:

> **stdin JSON → node script → exit 0 (allow) or exit 2 + `BLOCKED: [id] reason` on stderr.**

Exercise it without a live Claude Code session:

```bash
printf '{"tool_name":"Read","tool_input":{"file_path":"..."}}' \
  | node plugins/hooks-guard/scripts/guard-secrets.js
# → exit 2, stderr: BLOCKED: [ssh-private-key-2] SSH private key
```

### When to run

- New hook event or matcher
- New block pattern (hooks-guard) or decision mapping (hooks-permission-log)
- Cross-cutting logging change: schema-version bump, archival, redact rules
- Anything tagged "breaking" in plugin version notes

### Isolation rules

- Work under `$TMPDIR/sccm-e2e-*/`. Never touch real `~/.ssh/`, the
  real project `.claude/`, or real log directories.
- Set `CLAUDE_PROJECT_DIR=<workspace>` so scripts write logs into the
  scratch dir.
- For sensitive-file tests: create a throwaway target (e.g. a fake
  `id_rsa` file) and symlink the test path to it. Never point tests
  at the user's real keys or credentials.

### Boundary check

After a stdin-level run, confirm `hooks.json` points at the script
you just exercised on the right event:

```bash
cat plugins/<name>/hooks/hooks.json
```

This catches "correct script, wrong event" bugs that neither
`pnpm test` nor `claude plugin validate` detects.

### Reference run

[PR #15](https://github.com/yun-sangho/sccm/pull/15) exercised all
three layers end-to-end; reproducible script and results in the
[E2E comment](https://github.com/yun-sangho/sccm/pull/15#issuecomment-4278216447)
and the [wiring / `pnpm test` follow-up](https://github.com/yun-sangho/sccm/pull/15#issuecomment-4278220455).
