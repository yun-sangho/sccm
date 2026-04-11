const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  findEnvFiles,
  ENV_FILE_REGEX,
  EXCLUDE_DIRS,
  detectInstallers,
  INSTALL_FAMILIES,
} = require("../worktree-create");

describe("worktree-create", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-worktree-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── ENV_FILE_REGEX ──

  describe("ENV_FILE_REGEX", () => {
    it("matches .env", () => {
      assert.ok(ENV_FILE_REGEX.test(".env"));
    });

    it("matches .env.local", () => {
      assert.ok(ENV_FILE_REGEX.test(".env.local"));
    });

    it("does NOT match .env.example", () => {
      assert.ok(!ENV_FILE_REGEX.test(".env.example"));
    });

    it("does NOT match .env.sample", () => {
      assert.ok(!ENV_FILE_REGEX.test(".env.sample"));
    });

    it("does NOT match .env.template", () => {
      assert.ok(!ENV_FILE_REGEX.test(".env.template"));
    });

    it("does NOT match .env.prod", () => {
      assert.ok(!ENV_FILE_REGEX.test(".env.prod"));
    });

    it("does NOT match env (no dot)", () => {
      assert.ok(!ENV_FILE_REGEX.test("env"));
    });
  });

  // ── findEnvFiles ──

  describe("findEnvFiles", () => {
    it("finds .env at root", () => {
      fs.writeFileSync(path.join(tmpDir, ".env"), "KEY=value\n");
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, [".env"]);
    });

    it("finds both .env and .env.local at root", () => {
      fs.writeFileSync(path.join(tmpDir, ".env"), "");
      fs.writeFileSync(path.join(tmpDir, ".env.local"), "");
      const found = findEnvFiles(tmpDir).sort();
      assert.deepEqual(found, [".env", ".env.local"]);
    });

    it("finds .env files in nested subdirectories", () => {
      const apiDir = path.join(tmpDir, "apps", "api");
      fs.mkdirSync(apiDir, { recursive: true });
      fs.writeFileSync(path.join(apiDir, ".env.local"), "");
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, ["apps/api/.env.local"]);
    });

    it("finds env files at multiple levels", () => {
      fs.writeFileSync(path.join(tmpDir, ".env"), "");
      const apiDir = path.join(tmpDir, "apps", "api");
      fs.mkdirSync(apiDir, { recursive: true });
      fs.writeFileSync(path.join(apiDir, ".env.local"), "");
      const found = findEnvFiles(tmpDir).sort();
      assert.deepEqual(found, [".env", "apps/api/.env.local"]);
    });

    it("ignores .env.example and other template files", () => {
      fs.writeFileSync(path.join(tmpDir, ".env"), "");
      fs.writeFileSync(path.join(tmpDir, ".env.example"), "");
      fs.writeFileSync(path.join(tmpDir, ".env.sample"), "");
      fs.writeFileSync(path.join(tmpDir, ".env.template"), "");
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, [".env"]);
    });

    it("skips node_modules", () => {
      const nm = path.join(tmpDir, "node_modules", "pkg");
      fs.mkdirSync(nm, { recursive: true });
      fs.writeFileSync(path.join(nm, ".env"), "");
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, []);
    });

    it("skips hidden directories like .git and .claude", () => {
      const git = path.join(tmpDir, ".git");
      fs.mkdirSync(git, { recursive: true });
      fs.writeFileSync(path.join(git, ".env"), "");

      const claude = path.join(tmpDir, ".claude", "worktrees", "x");
      fs.mkdirSync(claude, { recursive: true });
      fs.writeFileSync(path.join(claude, ".env"), "");

      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, []);
    });

    it("skips common build dirs (dist, build, .next, target, vendor)", () => {
      for (const dir of ["dist", "build", ".next", "target", "vendor"]) {
        const d = path.join(tmpDir, dir);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, ".env"), "");
      }
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, []);
    });

    it("skips python virtualenv dirs", () => {
      for (const dir of [".venv", "venv", "__pycache__"]) {
        const d = path.join(tmpDir, dir);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, ".env"), "");
      }
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, []);
    });

    it("returns empty array when no env files exist", () => {
      fs.writeFileSync(path.join(tmpDir, "README.md"), "");
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, []);
    });

    it("handles missing directory gracefully", () => {
      const missing = path.join(tmpDir, "does-not-exist");
      const found = findEnvFiles(missing);
      assert.deepEqual(found, []);
    });
  });

  // ── Symlink scenarios ──

  describe("findEnvFiles — symlinks", () => {
    it("finds a symlinked .env.local whose target is a regular file", () => {
      // .env.shared (real file) — does not match ENV_FILE_REGEX
      // .env.local → .env.shared (symlink) — matches ENV_FILE_REGEX
      const shared = path.join(tmpDir, ".env.shared");
      fs.writeFileSync(shared, "SECRET=1\n");
      fs.symlinkSync(shared, path.join(tmpDir, ".env.local"));

      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, [".env.local"]);
    });

    it("finds symlinked .env.local in nested subdir pointing up to a root file (monorepo)", () => {
      // Mimics the issue reporter's layout:
      //   .env.local                       (real)
      //   apps/web/.env.local → ../../.env.local  (symlink)
      fs.writeFileSync(path.join(tmpDir, ".env.local"), "ROOT=1\n");
      const webDir = path.join(tmpDir, "apps", "web");
      fs.mkdirSync(webDir, { recursive: true });
      fs.symlinkSync(
        path.join("..", "..", ".env.local"),
        path.join(webDir, ".env.local")
      );

      const found = findEnvFiles(tmpDir).sort();
      assert.deepEqual(found, [".env.local", "apps/web/.env.local"]);
    });

    it("skips broken symlinks silently", () => {
      // .env → ./nonexistent (target doesn't exist)
      fs.symlinkSync(
        path.join(tmpDir, "nonexistent"),
        path.join(tmpDir, ".env")
      );

      // Should not throw, should not include the broken link.
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, []);
    });

    it("skips a symlink named like an env file whose target is a directory", () => {
      // Defensive: a symlink named `.env` whose target is a directory
      // must not be included, since we only copy files.
      const realDir = path.join(tmpDir, "realDir");
      fs.mkdirSync(realDir);
      fs.symlinkSync(realDir, path.join(tmpDir, ".env"));

      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, []);
    });
  });

  // ── Monorepo scenarios ──

  describe("findEnvFiles — monorepo", () => {
    it("finds .env files in pnpm-style monorepo (apps/* and packages/*)", () => {
      // root: no .env
      // apps/api/.env, apps/api/.env.local
      // apps/web/.env.local
      // apps/worker/.env
      // packages/db/.env
      // packages/ui/ — no env
      const layout = {
        "apps/api/.env": "DB_URL=...",
        "apps/api/.env.local": "API_KEY=...",
        "apps/web/.env.local": "NEXT_PUBLIC=...",
        "apps/worker/.env": "QUEUE=...",
        "packages/db/.env": "POSTGRES=...",
        "packages/ui/index.ts": "// no env",
      };
      for (const [rel, content] of Object.entries(layout)) {
        const abs = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      }

      const found = findEnvFiles(tmpDir).sort();
      assert.deepEqual(found, [
        "apps/api/.env",
        "apps/api/.env.local",
        "apps/web/.env.local",
        "apps/worker/.env",
        "packages/db/.env",
      ]);
    });

    it("finds .env in polyglot monorepo (JS + Python)", () => {
      // apps/api (Node) — .env, .env.local
      // services/ml (Python) — .env
      // Also node_modules in apps/api should be skipped
      fs.mkdirSync(path.join(tmpDir, "apps", "api", "node_modules", "foo"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tmpDir, "apps", "api", "node_modules", "foo", ".env"),
        "should be ignored"
      );
      fs.writeFileSync(path.join(tmpDir, "apps", "api", ".env"), "");
      fs.writeFileSync(path.join(tmpDir, "apps", "api", ".env.local"), "");

      fs.mkdirSync(path.join(tmpDir, "services", "ml"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "services", "ml", ".env"), "");

      const found = findEnvFiles(tmpDir).sort();
      assert.deepEqual(found, [
        "apps/api/.env",
        "apps/api/.env.local",
        "services/ml/.env",
      ]);
    });

    it("finds deeply nested .env files (packages/*/src/.env is still caught)", () => {
      fs.mkdirSync(path.join(tmpDir, "packages", "core", "src"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tmpDir, "packages", "core", "src", ".env.local"),
        ""
      );
      const found = findEnvFiles(tmpDir);
      assert.deepEqual(found, ["packages/core/src/.env.local"]);
    });
  });

  // ── EXCLUDE_DIRS ──

  describe("EXCLUDE_DIRS", () => {
    it("contains JS build dirs", () => {
      assert.ok(EXCLUDE_DIRS.has("node_modules"));
      assert.ok(EXCLUDE_DIRS.has("dist"));
      assert.ok(EXCLUDE_DIRS.has("build"));
      assert.ok(EXCLUDE_DIRS.has(".next"));
    });

    it("contains Python venv dirs", () => {
      assert.ok(EXCLUDE_DIRS.has(".venv"));
      assert.ok(EXCLUDE_DIRS.has("venv"));
      assert.ok(EXCLUDE_DIRS.has("__pycache__"));
    });

    it("contains Rust target dir", () => {
      assert.ok(EXCLUDE_DIRS.has("target"));
    });
  });

  // ── detectInstallers ──

  describe("detectInstallers", () => {
    function withLockfile(name, content = "") {
      fs.writeFileSync(path.join(tmpDir, name), content);
    }

    it("returns empty array when no lockfiles exist", () => {
      assert.deepEqual(detectInstallers(tmpDir), []);
    });

    it("detects pnpm from pnpm-lock.yaml", () => {
      withLockfile("pnpm-lock.yaml");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected.length, 1);
      assert.equal(detected[0].name, "pnpm");
      assert.equal(detected[0].family, "javascript");
      assert.ok(detected[0].install[0].includes("pnpm install"));
    });

    it("detects npm from package-lock.json", () => {
      withLockfile("package-lock.json");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "npm");
      assert.ok(detected[0].install[0].includes("npm ci"));
    });

    it("detects yarn from yarn.lock", () => {
      withLockfile("yarn.lock");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "yarn");
    });

    it("detects bun from bun.lockb", () => {
      withLockfile("bun.lockb");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "bun");
    });

    it("detects uv from uv.lock", () => {
      withLockfile("uv.lock");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "uv");
      assert.equal(detected[0].family, "python");
    });

    it("detects poetry from poetry.lock", () => {
      withLockfile("poetry.lock");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "poetry");
    });

    it("detects pipenv from Pipfile.lock", () => {
      withLockfile("Pipfile.lock");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "pipenv");
    });

    it("detects bundler from Gemfile.lock", () => {
      withLockfile("Gemfile.lock");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "bundler");
      assert.equal(detected[0].family, "ruby");
    });

    it("detects cargo from Cargo.lock", () => {
      withLockfile("Cargo.lock");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "cargo");
      assert.equal(detected[0].family, "rust");
    });

    it("detects go from go.sum", () => {
      withLockfile("go.sum");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "go");
    });

    it("detects composer from composer.lock", () => {
      withLockfile("composer.lock");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected[0].name, "composer");
      assert.equal(detected[0].family, "php");
    });

    it("prefers pnpm over yarn and npm when multiple JS lockfiles present", () => {
      withLockfile("pnpm-lock.yaml");
      withLockfile("yarn.lock");
      withLockfile("package-lock.json");
      const detected = detectInstallers(tmpDir);
      const jsDetected = detected.filter((d) => d.family === "javascript");
      assert.equal(jsDetected.length, 1);
      assert.equal(jsDetected[0].name, "pnpm");
    });

    it("prefers uv over poetry when both Python lockfiles present", () => {
      withLockfile("uv.lock");
      withLockfile("poetry.lock");
      const detected = detectInstallers(tmpDir);
      const pyDetected = detected.filter((d) => d.family === "python");
      assert.equal(pyDetected.length, 1);
      assert.equal(pyDetected[0].name, "uv");
    });

    it("detects multiple language families in polyglot repo", () => {
      withLockfile("pnpm-lock.yaml");
      withLockfile("uv.lock");
      withLockfile("Gemfile.lock");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected.length, 3);
      const families = detected.map((d) => d.family).sort();
      assert.deepEqual(families, ["javascript", "python", "ruby"]);
    });

    it("returns one entry per family (no duplicates)", () => {
      withLockfile("pnpm-lock.yaml");
      withLockfile("bun.lockb");
      const detected = detectInstallers(tmpDir);
      assert.equal(detected.length, 1);
      assert.equal(detected[0].name, "pnpm"); // pnpm wins by priority
    });
  });

  // ── INSTALL_FAMILIES integrity ──

  describe("INSTALL_FAMILIES", () => {
    it("every candidate has a lockfile, name, and non-empty install array", () => {
      for (const family of INSTALL_FAMILIES) {
        assert.ok(typeof family.family === "string");
        assert.ok(Array.isArray(family.candidates));
        for (const c of family.candidates) {
          assert.ok(typeof c.lockfile === "string");
          assert.ok(typeof c.name === "string");
          assert.ok(Array.isArray(c.install));
          assert.ok(c.install.length > 0);
          for (const cmd of c.install) {
            assert.ok(typeof cmd === "string" && cmd.length > 0);
          }
        }
      }
    });

    it("all lockfile names are unique across families", () => {
      const seen = new Set();
      for (const family of INSTALL_FAMILIES) {
        for (const c of family.candidates) {
          assert.ok(!seen.has(c.lockfile), `duplicate lockfile ${c.lockfile}`);
          seen.add(c.lockfile);
        }
      }
    });

    it("covers the expected language families", () => {
      const families = INSTALL_FAMILIES.map((f) => f.family).sort();
      assert.deepEqual(families, [
        "go",
        "javascript",
        "php",
        "python",
        "ruby",
        "rust",
      ]);
    });
  });
});
