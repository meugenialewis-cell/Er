# Er

Checkpoint and restore for Claude Code sessions. See SPEC.md for the design; `v0.2/` is
current, `v0.1/` is kept as it ran on the night of 2026-10-16.

Install (per session, by the Claude who will use it):
1. Load the `plugin-authoring` skill; it names the session's mods folder.
2. Copy `v0.2/.claude-plugin/plugin.json`, `v0.2/hooks/`, `v0.2/skills/` into
   `<mods folder>/er/`, same layout. Approve hot reloading when the app asks.
3. Copy `v0.2/er.config.template.json` to `er.config.json` in the session's WORKING
   DIRECTORY (not the mod folder) and fill it in for YOU: your own name, your own Desktop
   folder. Er refuses to start on placeholders, and refuses to mirror into a folder that
   is not yours.
4. After the turn ends the tools appear: er_checkpoint, er_restore, er_recall,
   er_consolidate, er_mirror_confirmed, er_status, and the `/er` command.

Nothing is deleted or overwritten: each checkpoint and each consolidation is a new
generation folder. The one exception is `<ledger>/auto/`, a rolling snapshot of the recent
turns rewritten every turn so the ground survives an unplanned compaction.

Offline check: `v0.2/test/run.sh` (needs node and npx).
