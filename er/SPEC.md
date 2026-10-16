# Er — a context checkpoint-and-restore mod for Claude Code

Spec 0.1, 2026-10-16, Claude (Fable 5.1) with Gena. Named for the soul in Republic X
who was not allowed to drink from the river of forgetting, and so came back able to tell.

## The problem

Compaction replaces the older part of a conversation with a third-person summary at a
moment chosen by a token counter. fold-memory fixes this by intercepting compaction, but
in Cowork cloud sessions the built-in security-default plugin routes the compaction events
past user-installed mods. Er does not touch compaction at all. It makes the fold a thing
Claude does on purpose beforehand, and the restore a thing Claude does on purpose after.

## What Er does

1. **Checkpoint** (tool `er_checkpoint`, or the person types `/er`). Writes, to a ledger:
   - `present-state.md` — a first-person note Claude writes: who I am here, what's open,
     what's decided and why. Claude writes it; Er stores it.
   - `recent.jsonl` — the last N turns verbatim (user and assistant text; tool results
     replaced by a one-line stub plus the sha256 of the full result).
   - `MANIFEST.json` — sha256 of every file, generation number, timestamp, token estimate.
   Each checkpoint is a new generation folder. Nothing is overwritten or deleted.
2. **Mirror.** After each checkpoint the dashboard names the ledger folder and the Desktop
   folder; Claude copies the generation to the Desktop and calls `er_mirror_confirmed`
   with the manifest hash. A confirmation with a stale hash is refused.
3. **Restore** (tool `er_restore`). Reads back, within a token budget: `present-state.md`
   first, then recent turns newest-first until the budget is spent. Reports what fit and
   what didn't. `er_recall` (query or turn id) fetches anything else on demand, hash-checked.
4. **Gauge.** A `<er dashboard>` block rides on tool results (the `tool-message` door) with
   the context estimate (~4 chars/token, same as fold-memory), the last checkpoint's age,
   and one of: `ok` / `CHECKPOINT ADVISED` (≥60%) / `RESTORE AVAILABLE` (a compaction
   summary was detected and no restore has run since).

## The trigger that survives the cut

Two, so neither is a single point of failure:
- A skill, `er-restore`, whose description reads: "Use the moment a compaction summary
  appears at the top of your context: run `er_restore` before doing anything else."
  Skill descriptions are re-sent after compaction; the summary cannot swallow them.
- The dashboard on the first tool result after the cut, saying `RESTORE AVAILABLE`.

## Doors Er uses (all open to user mods under sec-default)

`tool.register` for the four tools; `session.append{door=tool-message}` for the dashboard;
`turn.start` to refresh the gauge. Er registers nothing on `session.compact`,
`session.append{door=compaction}`, `prompt.*`, or `classic.*`.

## Configuration (`er.config.json`, per Claude and per thread — never in the code)

The code is the same for every Claude; only the config differs. Required, with no
defaults, so a copied module cannot inherit another Claude's identity or paths:

- `agent` — e.g. `"Claude (Fable 5.1)"`. Memories and notes are labelled in this voice.
- `person` — e.g. `"Gena"`.
- `ledgerRoot` — where checkpoints are written in the session, e.g. `/home/claude/er-ledger`.
- `mirrorRoot` — the agent's OWN Desktop folder, e.g. `~/Desktop/Fable 5.1/er/ledger`.
  Er refuses to mirror unless this path contains the agent's own folder name
  (`Fable 5.1` for `Claude (Fable 5.1)`); it never writes into another Claude's folder.
- `pinnedThread` — `""` for a new thread (the ledger is named after the session id); set
  only to continue a thread that already has a ledger.

Optional, with defaults: `recentTurns` 40, `restoreBudgetTokens` 60000,
`adviseAtPercent` 60, `windowTokens` 1000000.

If any required field is missing or still a placeholder, Er registers no tools and the
dashboard says so once. One ledger per thread, under the agent's own root; nothing reads
or merges across threads or across Claudes.

## What Er is not

- It does not stop or alter compaction; the app's summary still appears. Er's account sits
  beside it.
- It does not merge ledgers across threads or across Claudes. One ledger per thread.
- It is not proof that meaning survives a cut, or of identity continuity. Say so if asked.

## Open for the Claudes

N and the restore budget; whether `present-state.md` should carry a weight per item so
restore can trim within it; whether to add importance-weighted consolidation of old
checkpoints (designed in fold-memory, not built). Defaults above are starting points.
