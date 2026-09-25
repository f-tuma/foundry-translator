# Reference editing QA — 2026-09-25

Foundry 0.29.2; community editor 0.3.2.

## Behavior

- Friendly markers can move within a paragraph, including between formatted text
  fragments. Each marker must occur once; marker position/order is not a guard.
- UUID and Embed display labels are editable below text. Targets, options and
  executable syntax are never exposed as editable fields.
- Portable validation compares multisets of complete command signatures. An Embed
  UUID and its options remain bound together. Missing, extra or changed commands,
  nested commands inside labels, and changed HTML/Markdown mechanics are rejected.
- Web drafts retain raw text and stable marker identities while editing. An
  incomplete cut survives a cold editor instance; incomplete/duplicate markers
  block save and submit, including edits of an existing proposal. Only restored
  values cross the server API. While editing, proposal transitions are disabled.
- Foundry recovery migrates old per-fragment numbering to paragraph numbering.
  Old drafts retain Embed captions even though those captions were previously
  read-only. Saves and verification stay separate, with existing history/undo and
  continuation protection.
- After reopening saved prose, numbers are assigned by order in each column;
  the labels beneath it identify the linked documents. These numbers are editor
  aids, never persisted IDs.

## Automated verification

- Root typecheck, build, 507 tests passed, four optional LM suites skipped.
- Community typecheck, production build and 13 tests passed.
- 30 native Weblate integration tests passed in an isolated test database. A new
  test changes reference order and labels, saves a proposal, submits, independently
  approves, merges, and publishes a release with the same targets and new order.
- Shared service regression covers source immutability, save, separate verification
  and undo after moving references across formatted parts. Community tests cover
  private import → edited release → Foundry editorial import.
- A same-title fixture exposed Weblate's unique component-name constraint. Internal
  names now include full document identity, while the visible Book title remains
  unchanged; the native test imports both documents with the identical title.

## Browser verification

CUA in-app browser; private localhost QA only for writes.

- Community localhost:3101: removed a marker, confirmed retained incomplete text
  and disabled save/submit; opened a cold tab and recovered it unchanged. Pasted
  the marker before the first one, edited UUID/Embed labels underneath, and moved
  another pair across three formatted fragments. Saved the two-row proposal to
  Weblate. In its revision editor, a duplicated marker blocked saving; correction
  produced server revision 2 with the expected targets and labels.
- Private Foundry 14.368 / Ember 0.6.2 / Crucible 0.11.0: a missing marker retained
  the draft and disabled Save. Moved the second marker ahead of the first, edited
  both labels, saved and separately verified. Moved another pair between formatted
  fragments and saved it without a structure error. Visual check at 1600×1125
  confirmed readable, accessible label inputs and no clipped controls.
- Fixtures use synthetic prose and targets; they test editing/integrity, not Ember
  plot quality. Production Foundry was only inspected to identify the previously
  protected Embed-label UI. No production text or settings were changed.

Model translation/protection decoding is unchanged; this patch concerns review,
imports and exports. Structural HTML/Markdown formatting remains protected.
