/**
 * consumer-manifest.mjs — single source of truth for which plugins
 * consume which modules from packages/hooks-shared/src/.
 *
 * Imported by sync-shared.mjs, verify-shared.mjs, and
 * verify-shared-bump.mjs. Previously duplicated in all three; a single
 * module makes it impossible for them to disagree.
 *
 * To add a new consumer or start using a new shared module, edit this
 * file. `verify-shared` then enforces that the declaration matches
 * what each plugin's source actually requires.
 */
export const CONSUMERS = [
  {
    plugin: "hooks-guard",
    modules: ["stdin.js", "logging.js", "exit.js", "shell-chain.js"],
  },
  {
    plugin: "hooks-pnpm",
    modules: ["stdin.js", "logging.js", "exit.js"],
  },
  {
    plugin: "hooks-permission-log",
    // Note: no exit.js — this plugin observes and logs, it never
    // blocks the tool chain, so it does not need block()/allow().
    modules: ["stdin.js", "logging.js", "shell-chain.js"],
  },
];
