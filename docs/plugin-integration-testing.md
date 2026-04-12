# Plugin Integration Testing

## Tests

```bash
pnpm test                            # unit tests
pnpm run test:<plugin-name>          # single plugin
pnpm run verify-versions             # version consistency
claude plugin validate plugins/<name>  # manifest validation
```

## Integration test

Spawn a child Claude Code process with the plugin loaded from source:

```bash
claude -p "<prompt>" \
  --plugin-dir plugins/<name> \
  --allowedTools "Bash"
```

The child receives the prompt, attempts tool calls, and the plugin's
hooks block or allow them.

### Tips

- **Parent hook interference**: If the plugin is already installed, its
  hooks may intercept the `claude -p` command. Uninstall first:
  `claude plugin uninstall <name>@sccm` → `/reload-plugins`

- **Claude refuses before hook fires**: Use `--system-prompt` to force
  command execution so the hook is the one doing the blocking.

- **Config file tests**: Run from a temp dir (`cd $(mktemp -d)`) to
  prevent the child from committing files to your repo.

## Quick iteration

`claude -p` is slow (~10s per call). Pipe JSON directly into the hook:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"<cmd>"},"session_id":"test","cwd":"/tmp"}' \
  | node plugins/<name>/scripts/<hook>.js 2>&1
echo $?  # 0 = allow, 2 = block
```
