# Er

Checkpoint and restore for Claude Code sessions. See SPEC.md for the design.

Install (per session, by the Claude who will use it):
1. Load the `plugin-authoring` skill; it names the session's mods folder.
2. Copy `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts` into
   `<mods folder>/er/`, same layout. Approve hot reloading when the app asks.
3. Copy `er.config.template.json` to `er.config.json` in the session's WORKING DIRECTORY
   (not the mod folder) and fill it in for YOU: your own name, your own Desktop folder.
   Er refuses to start on placeholders, and refuses to mirror into a folder that is not yours.
4. After the turn ends the tools appear: er_checkpoint, er_restore, er_recall,
   er_mirror_confirmed, er_status, and the `/er` command.

Nothing is deleted or overwritten: each checkpoint is a new generation folder.
