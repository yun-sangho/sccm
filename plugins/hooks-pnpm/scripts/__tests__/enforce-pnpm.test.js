const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { NPM_COMMANDS, NPX_COMMAND } = require("../enforce-pnpm");

describe("enforce-pnpm", () => {
  // ── Blocked npm commands ──

  describe("blocks npm commands", () => {
    const blocked = [
      "npm install",
      "npm i",
      "npm ci",
      "npm run dev",
      "npm run build",
      "npm exec prettier .",
      "npm start",
      "npm test",
      "npm build",
      "npm publish",
      "npm uninstall lodash",
      "npm remove lodash",
      "npm update",
      "npm upgrade",
      "npm init",
      "npm link",
    ];

    for (const cmd of blocked) {
      it(`blocks: ${cmd}`, () => {
        assert.ok(NPM_COMMANDS.test(cmd), `expected "${cmd}" to be blocked`);
      });
    }
  });

  describe("blocks npm with flags", () => {
    it("blocks npm install --save-dev", () => {
      assert.ok(NPM_COMMANDS.test("npm install --save-dev lodash"));
    });
    it("blocks npm i -D", () => {
      assert.ok(NPM_COMMANDS.test("npm i -D typescript"));
    });
    it("blocks npm ci --production", () => {
      assert.ok(NPM_COMMANDS.test("npm ci --production"));
    });
  });

  describe("blocks npm in compound commands", () => {
    it("blocks cd dir && npm install", () => {
      assert.ok(NPM_COMMANDS.test("cd app && npm install"));
    });
    it("blocks npm run build && npm publish", () => {
      assert.ok(NPM_COMMANDS.test("npm run build && npm publish"));
    });
  });

  // ── Allowed commands ──

  describe("allows pnpm commands", () => {
    const allowed = [
      "pnpm install",
      "pnpm i",
      "pnpm run dev",
      "pnpm exec prettier .",
      "pnpm start",
      "pnpm test",
      "pnpm build",
      "pnpm add lodash",
      "pnpm remove lodash",
      "pnpm update",
      "pnpm link",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, () => {
        assert.ok(!NPM_COMMANDS.test(cmd), `expected "${cmd}" to be allowed`);
      });
    }
  });

  describe("allows other commands", () => {
    const allowed = [
      "node index.js",
      "git status",
      "ls -la",
      "cat package.json",
      "echo npm is great",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, () => {
        assert.ok(!NPM_COMMANDS.test(cmd), `expected "${cmd}" to be allowed`);
      });
    }
  });

  // ── Blocked npx commands ──

  describe("blocks npx commands", () => {
    const blocked = [
      "npx create-react-app my-app",
      "npx prettier --write .",
      "npx tsc --init",
      "npx jest",
      "npx eslint .",
    ];

    for (const cmd of blocked) {
      it(`blocks: ${cmd}`, () => {
        assert.ok(NPX_COMMAND.test(cmd), `expected "${cmd}" to be blocked`);
      });
    }
  });

  describe("blocks npx in compound commands", () => {
    it("blocks cd dir && npx jest", () => {
      assert.ok(NPX_COMMAND.test("cd app && npx jest"));
    });
  });

  describe("allows pnpm dlx (npx alternative)", () => {
    const allowed = [
      "pnpm dlx create-react-app my-app",
      "pnpm dlx prettier --write .",
      "pnpm exec jest",
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, () => {
        assert.ok(!NPX_COMMAND.test(cmd), `expected "${cmd}" to be allowed`);
      });
    }
  });

  describe("edge cases", () => {
    it("does not match npm without subcommand", () => {
      assert.ok(!NPM_COMMANDS.test("npm --version"));
    });
    it("does not match npm help", () => {
      assert.ok(!NPM_COMMANDS.test("npm help"));
    });
    it("does not match substring 'snpm install'", () => {
      assert.ok(!NPM_COMMANDS.test("snpm install"));
    });
  });
});
