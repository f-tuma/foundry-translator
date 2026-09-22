# Ember translation identity and live events

A translated document is a presentation copy, not a second game object. Version
0.22.0 adds deterministic UUID resolution and an adapter for Ember 0.6.2 event
pages (tested with Foundry 14.368 and Crucible 0.11.0).

## Invariants

- Source UUID, language and document type determine identity. Names never do.
- Embedded page/item IDs and heading anchors survive a round trip.
- A lookup neither writes documents nor creates/registers events. It checks the
  current index/documents instead of retaining a stale mapping after deletion.
- Duplicate translations, missing pages, mismatched metadata and source cycles
  do not choose an arbitrary target. An explicit original view does not depend
  on the translation index being available.
- Foundry's global `fromUuid`/`fromUuidSync` and Ember's event registry are not
  replaced. Ordinary document links may open a translation; action widgets keep
  their native handler. Repeated installation does not add another click handler.
- Concurrent identical open requests share one promise; subsequent opens reuse
  Foundry's document sheet. This is UI deduplication, not a server transaction lock.

## Runtime binding

The translated event page resolves its source page from the Journal's translation
metadata and its retained page ID. The source must have the same Ember page type,
`eventId`, and event mechanics. Prose and outcome labels may differ, but IDs,
encounter configuration, prerequisites, uniqueness and outcome retry rules may not.
The registry must contain the source page's actual event object and source UUID.

The copy then reads that same event object through a live getter. Replacing the
source event is picked up on the next access. No clone, proxy game state, event
registration, or background state synchronization is involved. Native Ember
controls perform the actual game actions and retain their own dialogs and checks.
Choice labels are replaced only in the rendered DOM, matched by outcome ID; the
underlying outcome object, listeners and values are unchanged.

Ember's `initializeEvent`, `reinitializeEvent`, and `initializeQuest` methods are
wrapped only to guard marked translation copies. On a copy they look up the
canonical object, without registering it again, deleting custom outcomes, or
replacing quest labels/page pointers. Calls for originals pass through unchanged.
Do not edit rules in the translated copy: use the original and then regenerate
its translation as appropriate.

If binding fails, the page displays a warning and disables its controls, with a
button to the original. A capturing action guard rechecks the binding at click
or change time, including when the source disappeared after rendering.

## Public API

```js
const translator = game.modules.get("foundry-translate").api;
const pair = await translator.resolveReference(documentUuid, "cs");
// {sourceUuid, translatedUuid, status}
// status: mapped, source-only, ambiguous, missing, invalid
await translator.openReference(documentUuid, {view: "source"});
await translator.openReference(documentUuid, {view: "translation", language: "cs"});
```

`resolveReference` is read-only. `openReference` returns a boolean; it does not
start a translation job. The translation direction uses the module's storage
packs. Reverse lookup also accepts an imported copy carrying valid metadata.
A missing embedded page is not silently replaced by a different page.

## Verification and boundaries

Automated tests cover round trips, languages, actors/items, duplicate/cyclic/stale
mappings, source removal, model replacement, mechanics changes, original method
pass-through, repeated setup, DOM labels and blocked stale controls.

In a separate local Ember copy, a synthetic standalone event was opened repeatedly
through its translation, started, given an outcome through the native confirmation,
and completed. The original document stayed unchanged; only Ember's canonical
state moved from active (2) to complete (3), retaining the selected outcome.
Repeated initialize/reinitialize calls on the translation preserved the event
identity, registry count, source pointer and existing outcomes. A copy of a real
quest/event also retained the identical runtime object and did not change quest
labels, pointers or game state when initialized repeatedly.

This does not make an imported translated Actor a live replacement for a world
Actor, synchronize tokens/HP, or globally redirect macros. Native automatic
opening may still show the original Journal; generated summaries/confirmation
labels derived from the canonical event can remain English. Combat, every
encounter hook, every quest branch, multiplayer races and other Ember versions
are not certified by these tests. Native gameplay actions themselves retain
Ember's concurrency behavior; opening a view is the operation made idempotent.
