# Triage bootstrap (paste this into the cloud trigger)

This is the entire prompt that lives in the Anthropic-cloud scheduled
task. It does nothing on its own — it fetches the canonical triage
prompt from this repo and follows it. To change triage behavior, edit
[`triage.md`](triage.md), commit, push. The next hourly run picks it
up. **You should not need to edit this bootstrap after the first
deploy.**

Copy everything between the `---` markers below into the cloud trigger
prompt field.

---

Read `prompts/triage.md` from `yun-sangho/sccm` on `main` using
`mcp__github__get_file_contents` and follow it verbatim. If the fetch
fails or returns an empty body, stop the run without triaging — do not
improvise from memory.

---

That's it. Three sentences. All operational rules — what to label,
what to skip, what to send to Discord, what NOT to do — live in
`prompts/triage.md`. Keeping the bootstrap this thin means the cloud
trigger config almost never needs to change.
