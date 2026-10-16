// Offline harness for Er 0.3 (0.2's checks, plus the 0.3 cut detection and staleness): fakes the parts of the Claude Code mod API Er uses
// ($.fs, $.session, $.process, $.tool, $.command, $.ui) against a temp directory, then
// runs: auto snapshot → checkpoint → "compaction" → restore → six more checkpoints →
// consolidation → restore. Run with: node test/harness.mjs (after building register.ts
// to /tmp/er.mjs with esbuild; see test/run.sh).
import { register } from '/tmp/er.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'er-'))
const cwd = path.join(root, 'work')
await fs.mkdir(cwd, { recursive: true })
await fs.writeFile(path.join(cwd, 'er.config.json'), JSON.stringify({
  agent: 'Claude (Test 0.3)', person: 'Gena', ledgerRoot: path.join(root, 'ledger'), mirrorRoot: `${root}/Desktop/Test 0.3/er/ledger`,
  pinnedThread: '', recentTurns: 4, fullResultTurns: 2, fullResultBytes: 5000, noteBudgetTokens: 300, consolidateCount: 3, restoreBudgetTokens: 4000,
}))

const messages = []
const say = (role, text, toolUses = []) => messages.push({ role, text, toolUses })

const $ = {
  fs: {
    exists: async (p) => fs.access(abs(p)).then(() => true, () => false),
    read: async (p) => fs.readFile(abs(p), 'utf8'),
    write: async (p, t) => { await fs.mkdir(path.dirname(abs(p)), { recursive: true }); await fs.writeFile(abs(p), t) },
    list: async (p) => (await fs.readdir(abs(p), { withFileTypes: true })).map((d) => ({ name: d.name, kind: d.isDirectory() ? 'dir' : 'file' })),
  },
  session: { id: async () => 'thread-1', cwd: async () => cwd, messages: async () => messages },
  process: { run: async () => ({ exitCode: 1, stdout: '' }) },
  tool: { register: async (t) => tools.push(t.name) },
  command: { register: async () => {} },
  ui: { log: (s) => console.log('[ui]', s) },
}
const abs = (p) => (path.isAbsolute(p) ? p : path.join(cwd, p))
const tools = []

const handlers = []
register((ev, a, b) => handlers.push(typeof a === 'function' ? { ev, fn: a } : { ev, filter: a, fn: b }))
const fire = async (ev, e, filter) => {
  for (const h of handlers) {
    if (h.ev !== ev) continue
    if (h.filter && filter && JSON.stringify(h.filter) !== JSON.stringify(filter)) continue
    if (h.filter && !filter) continue
    if (!h.filter && filter) continue
    return h.fn($, e, async (x) => ({ ...x, next: true }))
  }
}
const call = (tool, input) => fire('tool.call', { ...input, tool_use_id: 'x' }, { tool: `mcp__er__${tool}` })
const bigResult = 'R'.repeat(3000)

await fire('session.start', {})
assert.deepEqual(tools, ['er_checkpoint', 'er_restore', 'er_recall', 'er_consolidate', 'er_mirror_confirmed', 'er_status'])

// a few turns of conversation with tool traffic
for (let t = 1; t <= 6; t++) {
  say('user', `question ${t}`)
  say('assistant', '', [{ tool: 'Bash', input: { command: `cmd ${t}` }, text: `${bigResult} result ${t}` }])
  say('user', '') // the tool-result message
  say('assistant', `answer ${t}`)
  await fire('turn.start', {})
}
let auto = JSON.parse(await $.fs.read(`${root}/ledger/thread-1/auto/MANIFEST.json`))
assert.equal(auto.turns, 4, 'recentTurns counts real turns')
const autoRows = (await $.fs.read(`${root}/ledger/thread-1/auto/recent.jsonl`)).trim().split('\n').map(JSON.parse)
const withFull = autoRows.filter((r) => r.toolUses.some((u) => u.result !== undefined)).map((r) => r.turn)
assert.deepEqual([...new Set(withFull)], [3], 'only the newest results fit the byte cap (one 3000-byte result in 5000)')

// checkpoint without "In hand" is refused; with it, written
let r = await call('er_checkpoint', { present_state: '## Must survive\nI am the test Claude.\n## Context\n' + 'x'.repeat(100) })
assert.match(r.deny, /In hand/)
r = await call('er_checkpoint', { present_state: '## Must survive\nI am the test Claude; we decided A because B.\n## Context\n' + 'x'.repeat(100) + '\n## In hand\nquestion 6, about to answer.' })
assert.match(r.result, /Checkpoint gen1 written/)
const gen1 = r.result.match(/manifest sha256 ([0-9a-f]+)/)[1]

// mirror: stale hash refused, right hash accepted
assert.match((await call('er_mirror_confirmed', { manifest_sha256: 'deadbeef' })).deny, /not the latest/)
assert.match((await call('er_mirror_confirmed', { manifest_sha256: gen1, method: 'test' })).result, /Mirror confirmed/)

// more turns after the checkpoint, then a compaction notice
say('user', 'question 7'); say('assistant', 'answer 7 — the thing in hand now')
await fire('turn.start', {})
await fire('session.append', { message: { name: 'compact_boundary' } }, { door: 'notice' })
let dash = (await call('er_status', {})).result
assert.match(dash, /RESTORE AVAILABLE/)

// restore: note first, then the automatic In hand from the ground, then the turns with full results
r = await call('er_restore', {})
assert.match(r.result, /## In hand\nquestion 6/)
assert.match(r.result, /## In hand \(automatic, at .*\)\n\nThe person last said:\nquestion 7/, 'automatic In hand rides the restore when the ground is newer than the note')
assert.match(r.result, /The last reply:\nanswer 7/)
const autoM = JSON.parse(await $.fs.read(`${root}/ledger/thread-1/auto/MANIFEST.json`))
assert.ok(autoM.files['in-hand.md'].sha256, 'in-hand.md is in the auto manifest')
assert.match(r.result, /ground snapshot/)
assert.match(r.result, /answer 7 — the thing in hand now/)
assert.match(r.result, /RRRR/, 'full tool result restored')
dash = (await call('er_status', {})).result
assert.doesNotMatch(dash, /RESTORE AVAILABLE/)

// six more checkpoints → the chain passes the note budget → CONSOLIDATE ADVISED
for (let n = 2; n <= 7; n++) {
  say('user', `q${n}`); say('assistant', `a${n}`)
  await fire('turn.start', {})
  r = await call('er_checkpoint', { present_state: `## Must survive\nnote ${n} keeps this.\n## Context\n${'c'.repeat(300)}\n## In hand\nq${n}` })
  assert.match(r.result, new RegExp(`gen${n} written`))
}
dash = (await call('er_status', {})).result
assert.match(dash, /CONSOLIDATE ADVISED/)
assert.match(dash, /notes 7/)

// consolidate: wrong covers refused; right covers accepted; chain shrinks; originals still readable
r = await call('er_consolidate', { present_state: '## Must survive\nnote 1 keeps this. note 2 keeps this. note 3 keeps this.\n## Context\n' + 'z'.repeat(100), covers: [2, 3, 4] })
assert.match(r.deny, /\[1, 2, 3\]/)
r = await call('er_consolidate', { present_state: '## Must survive\nI am the test Claude; we decided A because B. note 2 keeps this. note 3 keeps this.\n## Context\n' + 'z'.repeat(100), covers: [1, 2, 3] })
assert.match(r.result, /Consolidation gen8 written.*covers gen0001, gen0002, gen0003/)
dash = (await call('er_status', {})).result
assert.match(dash, /notes 5/)
r = await call('er_recall', { note: 'gen0001' })
assert.match(r.result, /question 6, about to answer/)
r = await call('er_restore', {})
assert.match(r.result, /Consolidated present state \(covers gen0001, gen0002, gen0003\)/)
assert.doesNotMatch(r.result, /## In hand\nq3\b/, 'covered note not read directly')
assert.match(r.result, /## In hand\nq7/)
r = await call('er_recall', { query: 'result 6' })
assert.match(r.result, /gen0001:/)

// ---- 0.3: the cut, noticed without the compaction events (the guard hides them)
let exact
$.process.run = async () =>
  exact === undefined
    ? { exitCode: 1, stdout: '' }
    : { exitCode: 0, stdout: 'cut first line\n' + JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: exact - 10, cache_creation_input_tokens: 0 } } }) + '\n' }
const status = async () => (await call('er_status', {})).result
// a small thread's noise is not a cut
exact = 15000; await status()
exact = 5000
assert.doesNotMatch(await status(), /RESTORE AVAILABLE/)
exact = 300000
dash = await status()
assert.match(dash, /300K\/\S+ \(\d+%, exact\)/)
assert.doesNotMatch(dash, /RESTORE AVAILABLE/)
exact = 250000 // a 17% fall is not a cut
assert.doesNotMatch(await status(), /RESTORE AVAILABLE/)
exact = 110000 // a 56% fall is
dash = await status()
assert.match(dash, /RESTORE AVAILABLE — the context fell from 250K to 110K/)
// a checkpoint written after the cut does not hide the restore
r = await call('er_checkpoint', { present_state: '## Must survive\nnote 9 keeps this.\n## Context\n' + 'k'.repeat(100) + '\n## In hand\nwriting after the cut' })
assert.match(r.result, /gen9 written/)
assert.match(await status(), /RESTORE AVAILABLE/)
r = await call('er_restore', {})
assert.match(r.result, /cut: the context fell from 250K to 110K/)
dash = await status()
assert.doesNotMatch(dash, /RESTORE AVAILABLE/)
assert.match(dash, /last cut: the context fell/)
exact = undefined // estimates never trigger it
assert.doesNotMatch(await status(), /RESTORE AVAILABLE/)

// the second net: the session's history shrinks under us; the old snapshot is kept
const beforeCut = await $.fs.read(`${root}/ledger/thread-1/auto/recent.jsonl`)
messages.splice(0, messages.length - 2)
say('user', 'after the cut'); say('assistant', 'reply after the cut')
await fire('turn.start', {})
dash = await status()
assert.match(dash, /RESTORE AVAILABLE — the session's history shrank from \d+ to 4 messages/)
const pre = (await $.fs.list(`${root}/ledger/thread-1`)).find((d) => d.name.startsWith('auto-precut-'))
assert.ok(pre, 'pre-cut snapshot kept')
assert.equal(await $.fs.read(`${root}/ledger/thread-1/${pre.name}/recent.jsonl`), beforeCut, 'pre-cut snapshot is the old ground, byte for byte')
r = await call('er_restore', {})
assert.match(r.result, /snapshot from before the cut is kept at .*auto-precut-/)

// the gauge is watched at turn start too, not only on tool results (the prose gap)
exact = 400000; await status()
exact = 120000
say('user', 'prose after a cut'); say('assistant', 'a prose reply, no tool call')
await fire('turn.start', {})
const st = JSON.parse(await $.fs.read(`${root}/ledger/thread-1/state.json`))
assert.equal(st.restoreAvailable, true, 'cut noticed at turn.start without any tool result')
assert.equal(st.cut.how, 'gauge')
await call('er_restore', {})

// staleness: twenty turns without a note
for (let t = 1; t <= 20; t++) { say('user', `later ${t}`); say('assistant', `ok ${t}`); await fire('turn.start', {}) }
assert.match(await status(), /CHECKPOINT STALE — 2\d turns since gen9/)
r = await call('er_checkpoint', { present_state: '## Must survive\nnote 10 keeps this.\n## Context\n' + 'k'.repeat(100) + '\n## In hand\nafter twenty turns' })
assert.doesNotMatch(await status(), /CHECKPOINT STALE/)

// hash check: tamper with a note
const g2 = (await $.fs.list(`${root}/ledger/thread-1`)).find((d) => d.name.startsWith('gen0005')).name
await fs.appendFile(`${root}/ledger/thread-1/${g2}/present-state.md`, 'tampered')
r = await call('er_restore', {})
assert.match(r.result, /HASH MISMATCH on present-state.md/)

console.log('ok — all Er 0.3.1 harness checks passed in', root)
