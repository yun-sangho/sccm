"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "src", "stdin.js");

function runReadStdin(input) {
  const script = `
    const { readStdin } = require(${JSON.stringify(SRC)});
    readStdin()
      .then((data) => process.stdout.write(JSON.stringify({ ok: true, data })))
      .catch((err) => process.stdout.write(JSON.stringify({ ok: false, err: String(err.message) })));
  `;
  const res = spawnSync(process.execPath, ["-e", script], {
    input,
    encoding: "utf8",
  });
  return JSON.parse(res.stdout);
}

test("readStdin: parses a well-formed JSON payload", () => {
  const out = runReadStdin('{"tool_name":"Bash","tool_input":{"command":"ls"}}');
  assert.equal(out.ok, true);
  assert.equal(out.data.tool_name, "Bash");
  assert.equal(out.data.tool_input.command, "ls");
});

test("readStdin: empty input returns {} (does not throw)", () => {
  const out = runReadStdin("");
  assert.equal(out.ok, true);
  assert.deepEqual(out.data, {});
});

test("readStdin: whitespace-only input returns {}", () => {
  const out = runReadStdin("   \n\t  ");
  assert.equal(out.ok, true);
  assert.deepEqual(out.data, {});
});

test("readStdin: malformed JSON rejects — caller must catch", () => {
  const out = runReadStdin("{ not json at all");
  assert.equal(out.ok, false);
  assert.match(out.err, /JSON/);
});
