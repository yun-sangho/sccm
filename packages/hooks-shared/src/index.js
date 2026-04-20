/**
 * hooks-shared — canonical index. Plugins should require the specific
 * sub-modules directly (e.g. require('./_shared/stdin')); this barrel
 * exists for the test suite convenience only.
 */
module.exports = {
  ...require("./stdin"),
  ...require("./logging"),
  ...require("./exit"),
  ...require("./shell-chain"),
};
