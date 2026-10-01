# Editor pagination and integrity repair — 2026-10-01

Release candidate: Foundry Translate 0.32.1 / polish MCP 0.3.1.

## Reproduction and changes

The document editor rendered all rows in a section, repeatedly searched the
snapshot while filtering DOM rows, and alternated layout writes/reads for every
textarea. Large sections could monopolize the UI thread. The editor now renders
50 rows, filters the entire section in memory, debounces typing, and batches
textarea measurements. Translation-unit lookup uses a map. Drafts survive page,
section and search changes; bookmark navigation selects the containing page.

Integrity failures now identify missing/extra complete commands with counts and
bounded HTML differences. Lowercase Crucible `&reference[...]` receives the same
protection as `&Reference[...]`, including rejection inside editable link labels.

Explicit MCP options support restoring incorrect prose digits to the source
multiset, or reinserting exact missing source commands from a provided draft.
Changed destinations, extra commands and markup damage remain blocked. A complete
field must pass validation before the write. Revision guards, persistent history,
idempotency and separate human verification remain in effect.

## Automated evidence

- Root check: 553 tests pass; four optional live-model tests skipped.
- MCP check: 30 tests pass, including actual STDIO client/bridge integration and
  correction-only boolean repair flags.
- Type checks, production build and release metadata verification pass.
- Focused pagination regressions cover off-page drafts, filtering and bookmarks.
- Repair regressions cover preview/save/undo, retry identity, changed UUIDs,
  duplicate markers, rejected markup changes and unchanged roll formulas.

## Browser evidence

A standalone browser harness uses the real editor and review service with a mocked
ApplicationV2/container and repository. Its synthetic section contains 1,200
paragraphs plus a page name. Opening took approximately 687 ms in one observation;
this is not a native Foundry benchmark or a before/after speedup measurement.
Only 50 passage rows were mounted. Moving to the next page, searching for the
last paragraph, returning to the first page and saving retained the earlier
draft. Saving left the row unverified. No console errors were observed there.

Native Foundry testing uses a private loopback QA world, not production. A first
save/undo smoke test was on the previously loaded 0.32.0 manifest; it is baseline
evidence only. After restarting the private server, the loaded version was
confirmed as 0.32.1. WebGL world startup was intermittently unresponsive before
the editor opened; the final editor test therefore used Foundry's `noCanvas`
client setting. This is not a graphics/startup regression test.

On native Foundry 14.368 / Crucible 0.11.0 / Ember 0.6.2 at 1440×1000:

- Created a separate synthetic 1,200-paragraph QA journal and its translated copy.
- Opened the section: exactly 50 passage rows, range 1–50 / 1201.
- Edited paragraph 0, moved to 51–100, searched for paragraph 1199: one hit and
  the off-page draft remained intact.
- Cleared the search and saved the retained draft. Foundry confirmed the write,
  no dirty rows remained, and the passage still required human verification.
- Persistent history contained the exact correction; the normal undo flow was
  used to restore it.
- No editor errors appeared. Earlier login selection and viewport errors belong
  to the test setup, not the editor. Screenshot capture failed in the browser
  tool; native assertions were verified through DOM state and persisted history.

The private QA module copy was restored to the clean release build after testing.
The temporary noCanvas preference was removed. Synthetic QA documents and their
history remain only in the private test world for reproduction.

## Scope limits

No automatic repair pass is performed during an update. Existing damaged fields
must be inspected individually. Multiple missing references in separate passages
of one field cannot be partially committed through the single-passage repair tool.
Digit comparison does not establish sentence meaning or interpret number words.
The server offers no cross-GM compare-and-swap; use one writing GM at a time.
