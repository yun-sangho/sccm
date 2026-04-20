"use strict";
/**
 * verify-shared.test.mjs — fixture-based tests for validateShared().
 *
 * Each test builds a self-contained tmpdir that mimics the real repo
 * layout (packages/hooks-shared/src/*.js, plugins/<name>/scripts/...),
 * then calls validateShared() with the fixture's repoRoot/srcDir.
 * This keeps the real repo untouched and exercises the four
 * invariants the validator enforces:
 *   [drift]      — _shared/ copy differs from canonical source
 *   [stray]      — file in _shared/ that manifest doesn't declare
 *   [undeclared] — plugin code requires a module the manifest lacks
 *   [dead]       — manifest declares a module no plugin code uses
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateShared } from "../verify-shared.mjs";

const CANONICAL_STDIN = `module.exports = { readStdin: () => ({}) };\n`;
const CANONICAL_EXIT = `module.exports = { block: () => {}, allow: () => {} };\n`;

function makeFixture({ pluginCode, sharedFiles, manifestModules }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-shared-"));
  const srcDir = path.join(root, "packages", "hooks-shared", "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "stdin.js"), CANONICAL_STDIN);
  fs.writeFileSync(path.join(srcDir, "exit.js"), CANONICAL_EXIT);

  const pluginScripts = path.join(root, "plugins", "p1", "scripts");
  const sharedDest = path.join(pluginScripts, "_shared");
  fs.mkdirSync(sharedDest, { recursive: true });
  for (const [name, content] of Object.entries(sharedFiles)) {
    fs.writeFileSync(path.join(sharedDest, name), content);
  }
  fs.writeFileSync(path.join(pluginScripts, "main.js"), pluginCode);

  return {
    root,
    srcDir,
    consumers: [{ plugin: "p1", modules: manifestModules }],
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("clean baseline: manifest ↔ usage ↔ copies all match → ok", (t) => {
  const fx = makeFixture({
    pluginCode: `const { readStdin } = require("./_shared/stdin");\n`,
    sharedFiles: { "stdin.js": CANONICAL_STDIN },
    manifestModules: ["stdin.js"],
  });
  t.after(fx.cleanup);

  const { ok, problems } = validateShared({
    repoRoot: fx.root,
    srcDir: fx.srcDir,
    consumers: fx.consumers,
  });

  assert.equal(ok, true);
  assert.deepEqual(problems, []);
});

test("[drift] synced copy differs from canonical source", (t) => {
  const fx = makeFixture({
    pluginCode: `const { readStdin } = require("./_shared/stdin");\n`,
    sharedFiles: { "stdin.js": CANONICAL_STDIN + "\n// tampered\n" },
    manifestModules: ["stdin.js"],
  });
  t.after(fx.cleanup);

  const { ok, problems } = validateShared({
    repoRoot: fx.root,
    srcDir: fx.srcDir,
    consumers: fx.consumers,
  });

  assert.equal(ok, false);
  assert.ok(
    problems.some((p) => p.startsWith("[drift]") && p.includes("stdin.js")),
    `expected [drift] for stdin.js, got: ${JSON.stringify(problems)}`
  );
});

test("[stray] file in _shared/ not declared in manifest", (t) => {
  const fx = makeFixture({
    pluginCode: `const { readStdin } = require("./_shared/stdin");\n`,
    sharedFiles: {
      "stdin.js": CANONICAL_STDIN,
      "exit.js": CANONICAL_EXIT, // extra file
    },
    manifestModules: ["stdin.js"], // does NOT declare exit.js
  });
  t.after(fx.cleanup);

  const { ok, problems } = validateShared({
    repoRoot: fx.root,
    srcDir: fx.srcDir,
    consumers: fx.consumers,
  });

  assert.equal(ok, false);
  assert.ok(
    problems.some((p) => p.startsWith("[stray]") && p.includes("exit.js")),
    `expected [stray] for exit.js, got: ${JSON.stringify(problems)}`
  );
});

test("[undeclared] plugin code requires a module not in manifest", (t) => {
  const fx = makeFixture({
    pluginCode: `const { block } = require("./_shared/exit");\n`,
    sharedFiles: { "stdin.js": CANONICAL_STDIN },
    manifestModules: ["stdin.js"], // does not include exit.js
  });
  t.after(fx.cleanup);

  const { ok, problems } = validateShared({
    repoRoot: fx.root,
    srcDir: fx.srcDir,
    consumers: fx.consumers,
  });

  assert.equal(ok, false);
  assert.ok(
    problems.some(
      (p) =>
        p.startsWith("[undeclared]") &&
        p.includes("main.js") &&
        p.includes("exit.js")
    ),
    `expected [undeclared] naming main.js + exit.js, got: ${JSON.stringify(problems)}`
  );
});

test("[dead] manifest declares a module no code requires", (t) => {
  const fx = makeFixture({
    pluginCode: `const { readStdin } = require("./_shared/stdin");\n`,
    sharedFiles: {
      "stdin.js": CANONICAL_STDIN,
      "exit.js": CANONICAL_EXIT,
    },
    manifestModules: ["stdin.js", "exit.js"], // exit.js not used anywhere
  });
  t.after(fx.cleanup);

  const { ok, problems } = validateShared({
    repoRoot: fx.root,
    srcDir: fx.srcDir,
    consumers: fx.consumers,
  });

  assert.equal(ok, false);
  assert.ok(
    problems.some((p) => p.startsWith("[dead]") && p.includes("exit.js")),
    `expected [dead] for exit.js, got: ${JSON.stringify(problems)}`
  );
});

test("[sync] manifest declares module missing from disk", (t) => {
  const fx = makeFixture({
    pluginCode: `
      const { readStdin } = require("./_shared/stdin");
      const { block } = require("./_shared/exit");
    `,
    sharedFiles: { "stdin.js": CANONICAL_STDIN }, // exit.js absent
    manifestModules: ["stdin.js", "exit.js"],
  });
  t.after(fx.cleanup);

  const { ok, problems } = validateShared({
    repoRoot: fx.root,
    srcDir: fx.srcDir,
    consumers: fx.consumers,
  });

  assert.equal(ok, false);
  assert.ok(
    problems.some((p) => p.startsWith("[sync]") && p.includes("exit.js")),
    `expected [sync] missing for exit.js, got: ${JSON.stringify(problems)}`
  );
});

test("deriveUsage skips _shared/ and __tests__/ directories", (t) => {
  // Put a decoy require inside a __tests__ file — it must NOT count.
  const fx = makeFixture({
    pluginCode: `const { readStdin } = require("./_shared/stdin");\n`,
    sharedFiles: { "stdin.js": CANONICAL_STDIN },
    manifestModules: ["stdin.js"],
  });
  t.after(fx.cleanup);

  const testsDir = path.join(fx.root, "plugins", "p1", "scripts", "__tests__");
  fs.mkdirSync(testsDir);
  fs.writeFileSync(
    path.join(testsDir, "sample.test.js"),
    // If deriveUsage walked __tests__/, this spurious require would
    // flip an [undeclared] error for "exit.js". It must not.
    `const { block } = require("./_shared/exit");\n`
  );

  const { ok, problems } = validateShared({
    repoRoot: fx.root,
    srcDir: fx.srcDir,
    consumers: fx.consumers,
  });

  assert.equal(ok, true, `expected clean, got: ${JSON.stringify(problems)}`);
});

test("multiple consumers — each validated independently", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-shared-multi-"));
  const srcDir = path.join(root, "packages", "hooks-shared", "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "stdin.js"), CANONICAL_STDIN);
  fs.writeFileSync(path.join(srcDir, "exit.js"), CANONICAL_EXIT);

  // p1: clean
  const p1 = path.join(root, "plugins", "p1", "scripts");
  fs.mkdirSync(path.join(p1, "_shared"), { recursive: true });
  fs.writeFileSync(
    path.join(p1, "_shared", "stdin.js"),
    CANONICAL_STDIN
  );
  fs.writeFileSync(
    path.join(p1, "main.js"),
    `require("./_shared/stdin");\n`
  );

  // p2: broken (undeclared)
  const p2 = path.join(root, "plugins", "p2", "scripts");
  fs.mkdirSync(path.join(p2, "_shared"), { recursive: true });
  fs.writeFileSync(
    path.join(p2, "_shared", "stdin.js"),
    CANONICAL_STDIN
  );
  fs.writeFileSync(
    path.join(p2, "main.js"),
    `require("./_shared/stdin"); require("./_shared/exit");\n`
  );

  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { ok, problems } = validateShared({
    repoRoot: root,
    srcDir,
    consumers: [
      { plugin: "p1", modules: ["stdin.js"] },
      { plugin: "p2", modules: ["stdin.js"] },
    ],
  });

  assert.equal(ok, false);
  assert.ok(
    problems.some((p) => p.startsWith("[undeclared]") && p.includes("p2")),
    `expected [undeclared] for p2, got: ${JSON.stringify(problems)}`
  );
  // p1 must not contribute any problem
  assert.ok(
    !problems.some((p) => p.includes("/p1/")),
    `p1 should be clean, got: ${JSON.stringify(problems)}`
  );
});
