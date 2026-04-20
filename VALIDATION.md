# Validation guide

The core rule lives in [CLAUDE.md](CLAUDE.md): after any change under
`plugins/<name>/`, run `claude plugin validate plugins/<name>` and
confirm it passes before committing. This doc expands on the failure
modes the validator catches, the shape of its output, and how to
handle warnings vs errors.

## What the validator catches that nothing else does

### 1. Command frontmatter YAML parse errors

A malformed `argument-hint`, `allowed-tools`, or `description` in
`commands/*.md` fails to parse, and Claude Code loads the command with
**empty metadata — every frontmatter field silently dropped**. The
command still appears in the picker and still runs, but with:

- **no `allowed-tools` whitelist** → permission scoping lost, every
  Bash call prompts
- **no `description`** → blank line in the slash-command picker
- **no `argument-hint`** → no usage hint

`pnpm test` and `pnpm run verify-versions` do not catch this. `claude
plugin install` does not block on it either. The only signal is the
validator.

### 2. Plugin manifest / hooks.json schema violations

Same failure mode — the file loads with dropped fields, looks fine at
a glance, and everything downstream appears to work. A hook registered
with a wrong `event` key, a matcher that's the wrong type, or a
`plugin.json` with a malformed `commands` array all fall into this
class.

## Expected output

On success:

```
Validating plugin manifest: /path/to/plugin.json
✔ Validation passed
```

On warning (`✔ Validation passed with warnings`): read it and decide.
Warnings are non-blocking but usually signal something worth fixing
(e.g. missing `author` metadata). Not a hard gate — but don't dismiss
mechanically.

On error (`✘ Validation failed`): do not commit. Fix the underlying
file, re-run, and only commit once it passes.

## Incident reference

Commit `e20f975` fixed seven `commands/*.md` files across five plugins
whose `argument-hint: [bug|feature] [optional: short title]` was being
parsed as a YAML flow sequence and then failing at the second `[`. The
bug had been in the repo since `cf5f14c` (the initial `report-issue`
command commit) and nobody noticed — installs succeeded, tests passed,
versions were consistent. Only `claude plugin validate` surfaced it.

Moral: validator errors are the only signal for this failure class.
Run it on every plugin change, even doc-only ones — a typo in a YAML
string counts as a "doc change" and will silently drop the entire
frontmatter.
