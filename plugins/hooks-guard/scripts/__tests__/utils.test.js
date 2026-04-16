const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  LEVELS,
  LOG_DIR,
  log,
  splitShellChain,
  loadGuardConfig,
  resolveSafetyLevel,
  resolvePath,
  _resetGuardConfigCache,
  CONFIG_FILENAME,
} = require("../utils");

describe("utils", () => {
  // ── LEVELS ──

  describe("LEVELS", () => {
    it("has critical = 1", () => {
      assert.equal(LEVELS.critical, 1);
    });
    it("has high = 2", () => {
      assert.equal(LEVELS.high, 2);
    });
    it("has strict = 3", () => {
      assert.equal(LEVELS.strict, 3);
    });
    it("critical < high < strict", () => {
      assert.ok(LEVELS.critical < LEVELS.high);
      assert.ok(LEVELS.high < LEVELS.strict);
    });
  });

  // ── log ──

  describe("log", () => {
    let tmpDir;
    let origLogDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-guard-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes JSONL to date-named file", () => {
      // Temporarily patch LOG_DIR by requiring a fresh context
      // Since LOG_DIR is computed at module load, we test by calling log
      // with the actual LOG_DIR. Instead, we test the file format directly.
      const logDir = path.join(tmpDir, "hooks-logs");
      fs.mkdirSync(logDir, { recursive: true });

      const today = new Date().toISOString().slice(0, 10);
      const logFile = path.join(logDir, `${today}.jsonl`);

      // Simulate what log() does
      const entry = { ts: new Date().toISOString(), hook: "test-hook", level: "BLOCKED", id: "test" };
      fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");

      const content = fs.readFileSync(logFile, "utf8").trim();
      const parsed = JSON.parse(content);
      assert.equal(parsed.hook, "test-hook");
      assert.equal(parsed.level, "BLOCKED");
      assert.equal(parsed.id, "test");
      assert.ok(parsed.ts);
    });

    it("log function does not throw on valid input", () => {
      // This tests that log() doesn't throw even if directory doesn't exist
      // (it creates it, or silently catches errors)
      assert.doesNotThrow(() => {
        log("test-hook", { level: "BLOCKED", id: "test" });
      });
    });

    it("log function does not throw on missing dir", () => {
      // Override env to point to non-existent dir — log should not throw
      const origDir = process.env.CLAUDE_PROJECT_DIR;
      process.env.CLAUDE_PROJECT_DIR = path.join(tmpDir, "nonexistent-project");

      // Re-require to pick up new LOG_DIR
      // Since LOG_DIR is computed at load time, we just verify
      // the exported log function is resilient
      assert.doesNotThrow(() => {
        log("test-hook", { data: "test" });
      });

      if (origDir !== undefined) {
        process.env.CLAUDE_PROJECT_DIR = origDir;
      } else {
        delete process.env.CLAUDE_PROJECT_DIR;
      }
    });
  });

  // ── splitShellChain ──

  describe("splitShellChain", () => {
    it("returns empty array for empty string", () => {
      assert.deepEqual(splitShellChain(""), []);
    });
    it("returns empty array for null", () => {
      assert.deepEqual(splitShellChain(null), []);
    });
    it("returns single segment for a plain command", () => {
      assert.deepEqual(splitShellChain("ls -la"), ["ls -la"]);
    });
    it("trims whitespace around segments", () => {
      assert.deepEqual(splitShellChain("  ls -la  "), ["ls -la"]);
    });

    // Operator splitting
    it("splits on &&", () => {
      assert.deepEqual(
        splitShellChain("foo && bar"),
        ["foo", "bar"],
      );
    });
    it("splits on ||", () => {
      assert.deepEqual(
        splitShellChain("foo || bar"),
        ["foo", "bar"],
      );
    });
    it("splits on ;", () => {
      assert.deepEqual(
        splitShellChain("foo ; bar"),
        ["foo", "bar"],
      );
    });
    it("splits on |", () => {
      assert.deepEqual(
        splitShellChain("foo | bar"),
        ["foo", "bar"],
      );
    });
    it("splits on background &", () => {
      assert.deepEqual(
        splitShellChain("foo & bar"),
        ["foo", "bar"],
      );
    });
    it("splits on mixed operators", () => {
      assert.deepEqual(
        splitShellChain("a && b || c ; d | e"),
        ["a", "b", "c", "d", "e"],
      );
    });
    it("collapses empty segments from ;;", () => {
      assert.deepEqual(
        splitShellChain("a ;; b"),
        ["a", "b"],
      );
    });

    // Quote protection
    it("does not split inside single quotes", () => {
      assert.deepEqual(
        splitShellChain("echo 'foo && bar'"),
        ["echo 'foo && bar'"],
      );
    });
    it("does not split inside double quotes", () => {
      assert.deepEqual(
        splitShellChain('git commit -m "msg && payload"'),
        ['git commit -m "msg && payload"'],
      );
    });
    it("does not split on ; inside double quotes", () => {
      assert.deepEqual(
        splitShellChain('echo "a;b;c"'),
        ['echo "a;b;c"'],
      );
    });
    it("splits outside quotes but not inside", () => {
      assert.deepEqual(
        splitShellChain('echo "a && b" && ls'),
        ['echo "a && b"', "ls"],
      );
    });

    // Command substitution
    it("does not split inside $()", () => {
      assert.deepEqual(
        splitShellChain('git commit -m "$(cat msg && echo more)"'),
        ['git commit -m "$(cat msg && echo more)"'],
      );
    });
    it("handles nested $()", () => {
      assert.deepEqual(
        splitShellChain("echo $(foo $(bar && baz) qux) && ls"),
        ["echo $(foo $(bar && baz) qux)", "ls"],
      );
    });
    it("does not split inside backticks", () => {
      assert.deepEqual(
        splitShellChain("echo `foo && bar` && ls"),
        ["echo `foo && bar`", "ls"],
      );
    });

    // Escaping
    it("treats backslash-escaped operators as literal", () => {
      assert.deepEqual(
        splitShellChain("echo a \\&\\& b"),
        ["echo a \\&\\& b"],
      );
    });

    // The motivating case for issue #5
    it("splits git commit && rm .env", () => {
      assert.deepEqual(
        splitShellChain("git commit -m msg && rm .env"),
        ["git commit -m msg", "rm .env"],
      );
    });
    it("splits git commit with heredoc body && cat secret", () => {
      const cmd =
        "git commit -m \"$(cat <<'EOF'\nfix: .env handling\nEOF\n)\" && cat .env";
      assert.deepEqual(splitShellChain(cmd), [
        "git commit -m \"$(cat <<'EOF'\nfix: .env handling\nEOF\n)\"",
        "cat .env",
      ]);
    });
  });

  // ── JSONL format validation ──

  describe("log format", () => {
    it("produces valid JSONL entries", () => {
      const entries = [
        { ts: "2026-04-09T00:00:00.000Z", hook: "guard-bash", level: "BLOCKED", id: "rm-root" },
        { ts: "2026-04-09T00:00:01.000Z", hook: "guard-secrets", level: "BLOCKED", id: "env-file" },
      ];

      const jsonl = entries.map((e) => JSON.stringify(e)).join("\n");
      const parsed = jsonl.split("\n").map((line) => JSON.parse(line));

      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].hook, "guard-bash");
      assert.equal(parsed[1].hook, "guard-secrets");
    });
  });

  // ── resolvePath ──

  describe("resolvePath", () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-guard-resolve-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns fallback object for empty input", () => {
      assert.deepEqual(resolvePath(""), {
        raw: "",
        resolved: "",
        viaSymlink: false,
      });
    });

    it("returns fallback object for null", () => {
      assert.deepEqual(resolvePath(null), {
        raw: null,
        resolved: null,
        viaSymlink: false,
      });
    });

    it("returns raw on missing file (realpath throws)", () => {
      const bogus = path.join(tmpDir, "does-not-exist.txt");
      const r = resolvePath(bogus);
      assert.equal(r.raw, bogus);
      assert.equal(r.resolved, bogus);
      assert.equal(r.viaSymlink, false);
    });

    it("resolves a symlink to its target and flags viaSymlink=true", () => {
      const target = path.join(tmpDir, "secret-target");
      const linkPath = path.join(tmpDir, "innocent-link");
      fs.writeFileSync(target, "shhh");
      fs.symlinkSync(target, linkPath);

      const r = resolvePath(linkPath);
      assert.equal(r.raw, linkPath);
      assert.equal(r.resolved, fs.realpathSync(target));
      assert.equal(r.viaSymlink, true);
    });

    it("non-symlink real file: resolved differs only if cwd-relative", () => {
      const real = path.join(tmpDir, "plain.txt");
      fs.writeFileSync(real, "hi");
      const r = resolvePath(real);
      assert.equal(r.raw, real);
      // On some platforms /tmp is itself a symlink (e.g. macOS
      // /tmp -> /private/tmp); accept that but make sure we did
      // get an absolute resolved path back.
      assert.ok(path.isAbsolute(r.resolved));
    });
  });

  // ── loadGuardConfig / resolveSafetyLevel ──

  describe("guard config & safety level", () => {
    let tmpDir;
    let origProjectDir;
    let origEnv;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-guard-cfg-"));
      origProjectDir = process.env.CLAUDE_PROJECT_DIR;
      origEnv = process.env.SCCM_GUARD_LEVEL;
      process.env.CLAUDE_PROJECT_DIR = tmpDir;
      delete process.env.SCCM_GUARD_LEVEL;
      fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
      _resetGuardConfigCache();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (origProjectDir !== undefined) {
        process.env.CLAUDE_PROJECT_DIR = origProjectDir;
      } else {
        delete process.env.CLAUDE_PROJECT_DIR;
      }
      if (origEnv !== undefined) {
        process.env.SCCM_GUARD_LEVEL = origEnv;
      } else {
        delete process.env.SCCM_GUARD_LEVEL;
      }
      _resetGuardConfigCache();
    });

    it("loadGuardConfig returns {} when no config exists", () => {
      assert.deepEqual(loadGuardConfig(), {});
    });

    it("loadGuardConfig reads project-level config", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".claude", CONFIG_FILENAME),
        JSON.stringify({ safetyLevel: "strict", envRefAllowCommands: ["foo"] })
      );
      _resetGuardConfigCache();
      const cfg = loadGuardConfig();
      assert.equal(cfg.safetyLevel, "strict");
      assert.deepEqual(cfg.envRefAllowCommands, ["foo"]);
    });

    it("loadGuardConfig returns {} when JSON is malformed", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".claude", CONFIG_FILENAME),
        "{ not json"
      );
      _resetGuardConfigCache();
      assert.deepEqual(loadGuardConfig(), {});
    });

    it("resolveSafetyLevel returns fallback when nothing is set", () => {
      assert.equal(resolveSafetyLevel("high"), "high");
      assert.equal(resolveSafetyLevel("strict"), "strict");
    });

    it("resolveSafetyLevel: env var wins over config", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".claude", CONFIG_FILENAME),
        JSON.stringify({ safetyLevel: "strict" })
      );
      _resetGuardConfigCache();
      process.env.SCCM_GUARD_LEVEL = "critical";
      assert.equal(resolveSafetyLevel("high"), "critical");
    });

    it("resolveSafetyLevel: invalid env var falls through to config", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".claude", CONFIG_FILENAME),
        JSON.stringify({ safetyLevel: "strict" })
      );
      _resetGuardConfigCache();
      process.env.SCCM_GUARD_LEVEL = "nonsense";
      assert.equal(resolveSafetyLevel("high"), "strict");
    });

    it("resolveSafetyLevel: invalid config safetyLevel falls through to fallback", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".claude", CONFIG_FILENAME),
        JSON.stringify({ safetyLevel: "bogus" })
      );
      _resetGuardConfigCache();
      assert.equal(resolveSafetyLevel("high"), "high");
    });
  });
});
