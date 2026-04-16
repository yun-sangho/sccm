"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "src", "exit.js");

// block/allow call process.exit, so invoke them in a child process and
// observe the exit code + stderr.
function runBlock(id, reason) {
  const script = `
    const { block } = require(${JSON.stringify(SRC)});
    block(${JSON.stringify(id)}, ${JSON.stringify(reason)});
  `;
  return spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
}

function runAllow() {
  const script = `
    const { allow } = require(${JSON.stringify(SRC)});
    allow();
  `;
  return spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
}

test("block: exits 2 with BLOCKED stderr", () => {
  const res = runBlock("env-file", ".env contains secrets");
  assert.equal(res.status, 2);
  assert.equal(res.stderr.trim(), "BLOCKED: [env-file] .env contains secrets");
});

test("block: stderr format is stable (grep-friendly)", () => {
  const res = runBlock("rm-root", "rm targeting /");
  assert.match(res.stderr, /^BLOCKED: \[rm-root\] rm targeting \/$/m);
});

test("allow: exits 0 with empty stderr", () => {
  const res = runAllow();
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
  assert.equal(res.stdout, "");
});
