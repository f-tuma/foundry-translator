# Source-derived embedded reference repair — 0.32.3

Module 0.32.3 / live MCP 0.3.2 extends explicit source-reference repair to legacy
UUID commands collapsed from an embedded Item or JournalEntryPage to its parent.
For example, a source `@UUID[Actor.source.Item.ability]` and an existing translated
`@UUID[Compendium.world.foundry-translate-actors.Actor.copy]` can produce only
`@UUID[Compendium.world.foundry-translate-actors.Actor.copy.Item.ability]`.
The existing parent copy is retained; no new parent mapping is selected.

`referenceRepairEdit.targetChanges` and validation's `referenceRepair.targetChanges`
show the commands before/after repair. Existing labels are retained and can be
edited separately; anchors from the source child are retained. Markers may move
within their formatted paragraph. Missing source commands remain supported.

## Limits and safeguards

- Only immediate Item/JournalEntryPage children; no arbitrary new destinations,
  siblings, ActiveEffects, changed roll parameters, Embed commands or HTML repair.
- Exactly one matching missing child and one extra parent command, each occurring
  once, with both in the same row. Ambiguous or repeated candidates fail closed.
  Relative translated parents and truncated diagnostics also remain blocked.
- Full-field command/markup validation remains mandatory. Damage in another row
  can still block an otherwise valid single-row repair.
- For restored collapsed links, `referenceRepairTargets` reports exact UUID and
  availability without exposing extra document contents. Missing/inaccessible
  children withhold the context draft and reject preview/save with
  `Live.ReferenceTargetMissing`. Targets are checked afresh for each new request;
  this does not make concurrent document deletion transactional.
- Fresh revision, world/language/GM scope, source identity, operation-ID binding,
  history, active-translation guards and separate human verification remain.
- Undo requires the exact persisted operation and unchanged affected rows/source.
  It can restore the prior broken reference; unrelated later edits remain intact.
- No automatic migration or claim that every failed export is repaired.

## Validation

`npm run check`: 571 tests passed; four optional LM tests skipped. Typecheck and
production build passed. `npm --prefix apps/polish-mcp run check`: 30 tests passed,
including real STDIO and private loopback connection/launcher tests.
`npm run release:verify` passed for v0.32.3.

New tests cover Item/Page targets with anchors and labels, preview without writes,
explicit opt-in, arbitrary target rejection, exact retry binding, safe undo,
ambiguous/repeated/unrelated links, changed commands/markup, full-field remaining
damage, stale revisions, inline fragments, later edits and target disappearance
between preview and save.

Native validation used an isolated licensed copy of Foundry 14.368, Crucible
0.11.0 and Ember 0.6.2 on 127.0.0.1:30001. A synthetic journal referred to an
existing embedded ability in a copied native Ember Actor. Seventeen assertions
passed: retained embedded IDs, source diagnosis, exact translated parent/child,
whole-field preview without writes, persisted save/history without verification,
idempotent retry, guarded undo, exact restored text, broken-source diagnosis,
missing-target rejection on preview/save without writes, and unchanged original
Ember Actor/Journal source hashes. No production updates or proofreading writes
were made during this engineering iteration.

## Confirmed source issue

The inspected Ember 0.6.2 Oldcraft Lodge / Mote Chase source references the Light
Mote ability `Item.luminousTransit0`, but the inspected original Actor does not
contain that ID. A read-only production Actor audit confirmed its absence there
as well. This is a source-data issue in addition to legacy reference collapse.
The new guard deliberately leaves it blocked. A different existing ability must
not be guessed as a replacement; the intended source target needs confirmation.

After installing the module, copy the newly generated MCP JSON from Foundry and
restart the MCP client so the immutable executable and tool instructions match.
