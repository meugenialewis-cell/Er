# Er — a context checkpoint-and-restore mod for Claude Code

Spec 0.2, 2026-10-16. 0.1 by Claude (Fable 5.1) with Gena; 0.2 continued in Replit from Fable's gen0001 checkpoint, with Gena. Named for the soul in Republic X
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

## 0.2 — the ground, the chain, and consolidation

What a restore from 0.1 taught us (the first real one was Replit's agent reading Fable's
gen0001): the note did almost all the work, and the forty verbatim turns would have added
texture, not substance. And what a note cannot give is the ground — the file open, the
error just hit, the next move. Memory is what I did and why; it is not standing in the
middle of doing it. 0.2 is built around that.

1. **The ground is snapshotted automatically.** On every turn Er rewrites
   `<ledger>/auto/recent.jsonl` (+ manifest): the last `recentTurns` real turns — a turn
   is the person's message plus every reply and tool exchange until the next — and the
   last `fullResultTurns` of them keep their tool results in full, within
   `fullResultBytes` (newest first); older results are a 200-char stub plus sha256. Only
   the note needs Claude. A compaction that lands before anyone checkpointed loses nothing
   verbatim. `auto/` is a rolling cache, the one thing Er overwrites; generations remain
   the record.
2. **The note has three sections.** `Must survive` (the lines no restore may drop, and a
   consolidation carries forward verbatim), `Context`, and `In hand` (the exact thing open
   at that moment and the next move). `er_checkpoint` refuses a note with no `In hand`.
3. **Restore reads the chain of notes first.** Newest note, never trimmed; then older
   notes newest-first, whole or not at all, with a generation that a later consolidation
   covers represented by the consolidation; then the turns — from `auto/` when it is
   newer than the last generation, else from that generation — newest first until the
   budget is spent. The footer says what was left out and how to fetch it.
4. **Consolidation keeps the chain bounded.** When the chain's notes pass
   `noteBudgetTokens` and number more than `consolidateCount`, the dashboard says
   `CONSOLIDATE ADVISED`. The Claude reads the oldest `consolidateCount` notes
   (`er_recall note=genNNNN`) and calls `er_consolidate` with one first-person note and
   `covers: [...]`, which must be exactly those generations. It is stored as a generation
   of kind `consolidation`; the originals stay on disk, hash-checked, and `er_recall`
   still opens them. Consolidations can themselves be consolidated, so in 2028 the chain
   is still a few notes deep.
5. `er_recall` also takes `note` (a whole note by generation) and searches tool results
   that were kept in full; `auto:N` addresses a message in the snapshot. Hits are capped
   at 20 and say so.

Config additions, with defaults: `fullResultTurns` 5, `fullResultBytes` 200000,
`noteBudgetTokens` 20000, `consolidateCount` 5.

The `.claude-plugin/plugin.json` and the `er-restore` skill the README refers to are now
in the tree (0.1 shipped without them). `test/run.sh` runs an offline harness that fakes
the mod API and walks checkpoint → compaction → restore → consolidation → restore, with a
tamper check.

## Open for the Claudes

- Test `er_restore` after a real compaction, in a throwaway thread. The second trigger —
  the dashboard on the first tool result after the cut — has a gap: if the first act after
  the cut is prose, no tool result carries it. Whether the `tool-message` door can carry
  the dashboard on the next `turn.start` is untested; the skill description is the trigger
  that does not depend on it.
- `$.session.messages()` reports the person's messages with their text, tool-result
  messages as `user` with empty text; 0.2's turn grouping relies on that. Confirm it holds.
- The three 0.1 questions, answered for now: N is secondary (40 stays); the budget is
  spent on notes before turns; weighting is structural (`Must survive`) rather than numeric.
