# hooks-pnpm — enforce pnpm

A Claude Code hooks plugin that blocks `npm` commands in pnpm monorepos.

## Overview

When the Claude Code agent tries to run `npm` / `npx` through the Bash tool, this plugin blocks the call and points you to `pnpm` / `pnpm dlx`.

## Install

```bash
claude plugin install hooks-pnpm@sccm
```

## What's blocked

**npm commands:**

```
npm install    npm i          npm ci         npm run
npm exec       npm start      npm test       npm build
npm publish    npm uninstall  npm remove     npm update
npm upgrade    npm init       npm link
```

**npx commands:**

```
npx create-react-app my-app
npx prettier --write .
npx tsc --init
```

## What's allowed

- Every `pnpm` command
- `pnpm dlx` (the `npx` replacement)
- `pnpm exec`
- Informational commands like `npm --version`, `npm help`
- The string `npm` / `npx` appearing inside a `git commit` message

## Block messages

```
BLOCKED: [enforce-pnpm] This project uses pnpm. Use pnpm instead of npm.
BLOCKED: [enforce-npx] This project uses pnpm. Use pnpm dlx instead of npx.
```

## Logs

Blocked events are written to `{CLAUDE_PROJECT_DIR}/.claude/hooks-logs/YYYY-MM-DD.jsonl`.

## Tests

```bash
cd plugins/hooks-pnpm
node --test
```

## Structure

```
plugins/hooks-pnpm/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── scripts/
│   ├── utils.js
│   ├── enforce-pnpm.js
│   └── __tests__/
│       └── enforce-pnpm.test.js
├── package.json
└── README.md
```
