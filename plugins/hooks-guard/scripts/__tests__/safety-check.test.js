const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { checkSafety, hasIgnoreScripts } = require("../safety-check");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sccm-safety-"));
}

function rmRf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function writeSettings(projectDir, obj) {
  fs.mkdirSync(path.join(projectDir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, ".claude", "settings.local.json"),
    JSON.stringify(obj)
  );
}

function goodSandbox(projectDir) {
  writeSettings(projectDir, { sandbox: { enabled: true } });
}

function goodNpmrc(home) {
  fs.writeFileSync(path.join(home, ".npmrc"), "ignore-scripts=true\n");
}

test("hasIgnoreScripts: true variants", () => {
  assert.equal(hasIgnoreScripts("ignore-scripts=true"), true);
  assert.equal(hasIgnoreScripts("ignore-scripts = true"), true);
  assert.equal(hasIgnoreScripts("  ignore-scripts=true  "), true);
  assert.equal(
    hasIgnoreScripts("# some comment\nfoo=bar\nignore-scripts=true\nbaz=qux"),
    true
  );
});

test("hasIgnoreScripts: false / missing", () => {
  assert.equal(hasIgnoreScripts(""), false);
  assert.equal(hasIgnoreScripts(null), false);
  assert.equal(hasIgnoreScripts("ignore-scripts=false"), false);
  assert.equal(hasIgnoreScripts("registry=https://registry.npmjs.org"), false);
  // Commented-out setting does not count.
  assert.equal(hasIgnoreScripts("# ignore-scripts=true"), false);
});

test("checkSafety: warns when settings.local.json is missing", () => {
  const proj = mkTmp();
  const home = mkTmp();
  goodNpmrc(home);
  try {
    const r = checkSafety({ projectDir: proj, home, env: {} });
    assert.ok(
      r.warnings.some((w) => /not configured/i.test(w)),
      JSON.stringify(r.warnings)
    );
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: warns when sandbox.enabled is false", () => {
  const proj = mkTmp();
  const home = mkTmp();
  writeSettings(proj, { sandbox: { enabled: false } });
  goodNpmrc(home);
  try {
    const r = checkSafety({ projectDir: proj, home, env: {} });
    assert.ok(
      r.warnings.some((w) => /explicitly disabled/.test(w)),
      JSON.stringify(r.warnings)
    );
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: warns when sandbox block is absent from settings", () => {
  const proj = mkTmp();
  const home = mkTmp();
  writeSettings(proj, { permissions: { allow: [] } });
  goodNpmrc(home);
  try {
    const r = checkSafety({ projectDir: proj, home, env: {} });
    assert.ok(
      r.warnings.some((w) => /not enabled/.test(w)),
      JSON.stringify(r.warnings)
    );
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: silent on happy path (sandbox + ignore-scripts)", () => {
  const proj = mkTmp();
  const home = mkTmp();
  goodSandbox(proj);
  goodNpmrc(home);
  try {
    const r = checkSafety({ projectDir: proj, home, env: {} });
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.notes, []);
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: warns when ignore-scripts is not set anywhere", () => {
  const proj = mkTmp();
  const home = mkTmp();
  goodSandbox(proj);
  try {
    const r = checkSafety({ projectDir: proj, home, env: {} });
    assert.ok(
      r.warnings.some((w) => /ignore-scripts/.test(w)),
      JSON.stringify(r.warnings)
    );
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: project .npmrc satisfies ignore-scripts check", () => {
  const proj = mkTmp();
  const home = mkTmp();
  goodSandbox(proj);
  fs.writeFileSync(path.join(proj, ".npmrc"), "ignore-scripts=true\n");
  try {
    const r = checkSafety({ projectDir: proj, home, env: {} });
    assert.ok(
      !r.warnings.some((w) => /ignore-scripts/.test(w)),
      `should not warn, got ${JSON.stringify(r.warnings)}`
    );
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: respects SCCM_HOOKS_GUARD_QUIET=1", () => {
  const proj = mkTmp();
  const home = mkTmp();
  // deliberately bad: no sandbox, no .npmrc — would normally warn twice
  try {
    const r = checkSafety({
      projectDir: proj,
      home,
      env: { SCCM_HOOKS_GUARD_QUIET: "1" },
    });
    assert.deepEqual(r, { warnings: [], notes: [] });
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: worktree note when .claude/worktrees/ exists and cwd is outside", () => {
  const proj = mkTmp();
  const home = mkTmp();
  goodSandbox(proj);
  goodNpmrc(home);
  fs.mkdirSync(path.join(proj, ".claude", "worktrees"), { recursive: true });
  try {
    const r = checkSafety({ projectDir: proj, home, env: {} });
    assert.ok(
      r.notes.some((n) => /worktree/.test(n)),
      JSON.stringify(r.notes)
    );
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: no worktree note when cwd IS inside a worktree", () => {
  const proj = mkTmp();
  const home = mkTmp();
  const worktreeCwd = path.join(proj, ".claude", "worktrees", "feat-foo");
  fs.mkdirSync(worktreeCwd, { recursive: true });
  goodSandbox(worktreeCwd);
  goodNpmrc(home);
  try {
    const r = checkSafety({ projectDir: worktreeCwd, home, env: {} });
    assert.deepEqual(r.notes, []);
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});

test("checkSafety: malformed settings.local.json triggers parse warning", () => {
  const proj = mkTmp();
  const home = mkTmp();
  fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(proj, ".claude", "settings.local.json"),
    "{ this is not json"
  );
  goodNpmrc(home);
  try {
    const r = checkSafety({ projectDir: proj, home, env: {} });
    assert.ok(
      r.warnings.some((w) => /parse/.test(w)),
      JSON.stringify(r.warnings)
    );
  } finally {
    rmRf(proj);
    rmRf(home);
  }
});
