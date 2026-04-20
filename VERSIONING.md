# Versioning guide

The core rule lives in [CLAUDE.md](CLAUDE.md): any change under
`plugins/<name>/` MUST bump that plugin's version in the same change.
This doc expands on the full order of operations and the incident that
motivated the rule. For the level taxonomy (patch / minor / major),
see the rule section in CLAUDE.md — it's short enough to keep inline.

## Order of operations

1. Make the code / preset / hook / doc change under `plugins/<name>/`
2. `pnpm run bump <name> <level>` — updates `marketplace.json`,
   `plugin.json`, and `package.json` atomically. Refuses to run on a
   pre-existing mismatch, so a broken baseline is surfaced before the
   bump lands.
3. `pnpm run verify-versions` — sanity check that all three files agree
4. `claude plugin validate plugins/<name>` — see [VALIDATION.md](VALIDATION.md)
5. `pnpm test` (or `pnpm run test:<name>`)
6. Commit — the bump can be in the same commit as the change, or a
   follow-up commit immediately after. **Never push the change without
   the bump.** A pushed change without a bump ships a silent no-op to
   every existing installer of the plugin.

When in doubt on level, bias toward the higher one. A missed bump is
invisible to existing users (see incident below); an over-bump just
triggers one extra update that was going to happen anyway.

## Incident reference

Commit `af1e257` added `permissions.allow` merging to `sccm-sandbox`
but forgot to bump the version. Anyone who had already installed
`sccm-sandbox@sccm` kept getting the pre-merge behavior because Claude
Code's cache keyed off the unchanged `version` field — there was no
signal that a new build was available. Fixed in `be0d62a` as `0.2.0`.

The trap is that everything looks fine locally: tests pass, code on
disk is correct, the commit lands clean. Only users running against
the cached marketplace see the stale behavior, and silently. `pnpm
test` and `pnpm run verify-versions` both give a green result. This is
why the rule is a hard gate, not a best-effort convention.
