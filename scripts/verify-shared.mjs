#!/usr/bin/env node
/**
 * verify-shared.mjs — thin wrapper that invokes sync-shared in check
 * mode. Exists as its own pnpm script name so the repo-root README
 * and CLAUDE.md can refer to it next to verify-versions as a peer
 * sanity check.
 */
import { syncAll } from "./sync-shared.mjs";

const { drift, targets, files } = syncAll({ check: true });

if (drift.length > 0) {
  console.error(
    `✘ _shared directories are out of sync with packages/hooks-shared/src/:`
  );
  for (const d of drift) {
    console.error(`    plugins/${d.target}/${d.file}`);
  }
  console.error(`\nRun 'pnpm run sync-shared' to update.`);
  process.exit(1);
}

console.log(
  `✔ All _shared directories in sync (${targets.length} targets, ${files.length} files).`
);
