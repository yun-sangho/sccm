/**
 * hooks-shared — canonical source for utilities shared across the sccm
 * hook plugins. The files in this directory are copied into each
 * plugin's scripts/_shared/ by scripts/sync-shared.mjs so that each
 * plugin remains self-contained at install time (the marketplace
 * distribution does not install cross-plugin dependencies).
 *
 * Plugins should `require("./_shared/<module>")` directly rather than
 * importing this index — keeping imports narrow makes the wire-up
 * intent obvious from the import alone. The index exists mainly for
 * the internal test suite.
 */
module.exports = {
  ...require("./stdin"),
  ...require("./logging"),
  ...require("./exit"),
  ...require("./shell-chain"),
};
