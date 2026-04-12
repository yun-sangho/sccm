#!/bin/bash
# Full flow test for hooks-guard config CRUD + guard behavior.
# Tests two-layer matching: built-in prefix + user exact-match exceptions.
# Validates config file discovery (project > user priority).
# Usage: bash tests/integration/test-hooks-guard-config-flow.sh
set -uo pipefail

PLUGIN_ROOT="${PLUGIN_ROOT:-$(cd "$(dirname "$0")/../../plugins/hooks-guard" && pwd)}"
GUARD="$PLUGIN_ROOT/scripts/guard-secrets.js"
PROJ=$(mktemp -d)
USERHOME=$(mktemp -d)
trap 'rm -rf "$PROJ" "$USERHOME"' EXIT

PASS=0
FAIL=0

test_cmd() {
  local expected="$1" cmd="$2"
  local exit_code
  echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$cmd\"},\"session_id\":\"test\",\"cwd\":\"/tmp\"}" \
    | CLAUDE_PROJECT_DIR="$PROJ" HOME="$USERHOME" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" node "$GUARD" >/dev/null 2>&1
  exit_code=$?
  if { [ "$expected" = "block" ] && [ $exit_code -eq 2 ]; } || \
     { [ "$expected" = "allow" ] && [ $exit_code -eq 0 ]; }; then
    echo "  ✓ PASS ($expected) $cmd"
    PASS=$((PASS + 1))
  else
    echo "  ✗ FAIL (exit=$exit_code, expected=$expected) $cmd"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Phase 1: No config — defaults only ==="
test_cmd block "grep SECRET .env"
test_cmd block "docker compose --env-file .env up"
test_cmd block "sed -i 's/x/y/' .env"
test_cmd block "diff .env .env.staging"
test_cmd allow "ls -la .env"
test_cmd allow "find . -name .env"
test_cmd allow "git log -- .env"
test_cmd allow "stat .env"

echo ""
echo "=== Phase 2: Project-scope exception (exact match) ==="
mkdir -p "$PROJ/.claude"
echo '{"envRefAllowCommands":["grep SECRET .env"]}' > "$PROJ/.claude/guard-secrets.config.json"
test_cmd allow "grep SECRET .env"
test_cmd block "grep API_KEY .env"
test_cmd block "grep SECRET .env.local"
test_cmd allow "ls .env"

echo ""
echo "=== Phase 3: User-scope exception ==="
rm "$PROJ/.claude/guard-secrets.config.json"
mkdir -p "$USERHOME/.claude"
echo '{"envRefAllowCommands":["diff .env .env.bak"]}' > "$USERHOME/.claude/guard-secrets.config.json"
test_cmd allow "diff .env .env.bak"
test_cmd block "grep SECRET .env"
test_cmd block "diff .env.local .env.bak"

echo ""
echo "=== Phase 4: Project > user priority ==="
echo '{"envRefAllowCommands":["grep SECRET .env"]}' > "$PROJ/.claude/guard-secrets.config.json"
test_cmd allow "grep SECRET .env"
test_cmd block "diff .env .env.bak"

echo ""
echo "=== Phase 5: Multiple entries in config ==="
echo '{"envRefAllowCommands":["grep SECRET .env","docker compose --env-file .env up"]}' > "$PROJ/.claude/guard-secrets.config.json"
test_cmd allow "grep SECRET .env"
test_cmd allow "docker compose --env-file .env up"
test_cmd block "docker compose --env-file .env.local up"

echo ""
echo "=== Phase 6: Invalid/missing config graceful handling ==="
echo '{ invalid json }' > "$PROJ/.claude/guard-secrets.config.json"
rm "$USERHOME/.claude/guard-secrets.config.json"
test_cmd block "grep SECRET .env"
test_cmd allow "ls .env"

echo ""
echo "================================"
echo "TOTAL: $((PASS + FAIL)) assertions"
echo "PASS:  $PASS"
echo "FAIL:  $FAIL"
echo "================================"

[ $FAIL -eq 0 ] || exit 1
