# Foundry Translate — project handoff

- Updated: 2026-07-15
- Repository state: `main`; `v0.14.3` prepared locally from `v0.14.2`
- Repository: <https://github.com/f-tuma/foundry-translator>

This document provides the working context needed to continue the project from
another device or with another agent. The README remains the user-facing
documentation; this document records technical decisions, verified findings,
and the recommended implementation order.

## Current work log

- 2026-07-15: Patch `v0.14.3` batches up to four Actor/embedded
  Item or standalone Item HTML fields per OpenAI-compatible request and folds
  Journal metadata into the first multi-page LLM window. A fresh three-page
  Foundry QA Journal required one LM Studio request for 500 input and 359 output
  tokens, down from two requests after the first page-batching pass. LM Studio's
  native `/api/v1/chat` path now consumes official SSE streaming events, exposes
  a sanitized live model-output preview while a request is active, and retains
  the authoritative final usage and token-speed statistics from `chat.end`.
  JSON responses remain supported as a compatibility fallback. Validation
  passes with **147 tests across 31 files**; real LM Studio responses confirmed
  `text/event-stream`, one-request multi-page translation, and intact final
  metrics. Temporary QA documents were removed.

- 2026-07-15: Patch `v0.14.2` fixes smart-glossary candidate suffix duplication
  and avoids repeated failed whole-block attempts in Chrome Local Translator.
  OpenAI-compatible translation now sends true protected multi-item batches,
  falls back safely when a model damages batch delimiters, shares identical
  in-flight units between concurrent runs, and groups up to four Journal pages
  into one LLM request window. Real Foundry QA against LM Studio with
  `google/gemma-4-12b-qat` translated a three-page Journal in two LLM requests;
  final validation passed with **144 tests across 31 files**.

- 2026-07-15: The repository was verified clean at `v0.13.0`; the older handoff
  header and Item-recursion roadmap text were stale. Development after the
  release started with Markdown pages, glossary editing, and glossary-token
  spacing reliability.
- 2026-07-15: Markdown-backed Journal pages are now translated conservatively.
  Visible Markdown text is planned separately from syntax; frontmatter, fenced
  and inline code, URL/link destinations, reference definitions, table
  delimiters, escapes, and structural markers remain byte-for-byte source data.
  Foundry expressions still go through the existing integrity protection. Both
  `text.markdown` and stored rendered `text.content` are translated because
  Foundry v14 stores both and does not expose a supported public converter for
  use during compendium creation. Journal engine revision is now 6.
- 2026-07-15: Glossary management gained a two-column editor showing source
  terms and editable fixed translations, including bulk saving. Token restoration
  now repairs missing word boundaries when a provider glues a word to a glossary
  token; Chrome Local Translator additionally preserves source whitespace around
  all protection tokens before and after each local translation call.
- 2026-07-15: The first **smart glossary** slice is implemented. Newly generated
  Journal, Actor, and standalone Item copies store a normalized output hash.
  When a later translation trigger would overwrite a detected manual change,
  the run stops with an explicit preservation error; compatible translations
  continue to reuse the manually edited copy.
- 2026-07-15: Manual edits to translated Journal pages are compared with the
  previous stored text and the corresponding source page. A conservative
  single-span extractor creates review candidates, using an exact source match
  or an existing glossary replacement when possible and otherwise leaving the
  source field blank. Candidates are stored in a hidden world setting and shown
  in the glossary's editable review queue. The GM must explicitly accept or
  reject each one; incomplete candidates cannot be accepted and nothing is ever
  inserted automatically. Actor/Item candidate capture remains future work.
- 2026-07-15: `npm run check` passed after these changes: typecheck, **123 tests
  across 28 test files**, and a production bundle of approximately 137.3 kB.
- 2026-07-15: Real-Foundry QA passed in `ember-test` on Foundry `14.364` and
  Crucible `0.10.1`: a manual edit to a temporary translated Journal page
  produced the expected `Castle` → `Hradu` review candidate while adding no
  glossary entry automatically; Accept stored an explicitly reviewed test
  entry, Reject discarded a second one, and all temporary documents, entries,
  and candidates were removed. The module UI produced no console errors.
- 2026-07-15: Chrome Local Translator gained conservative paragraph-context
  translation. A complete protected logical block is attempted first and used
  only if every protection token survives byte-exactly and in order; otherwise
  the provider falls back to the previous isolated-fragment path. Cache schema
  is now 4 and engine revisions are Journal 6, Actor 3, and Item 3 so old
  fragment-context output is not reused.
- 2026-07-15: Added an `openai-compatible` provider for LM Studio and similar
  local servers. Its client-scoped settings are Base URL, exact model ID, and
  optional Bearer token; a root server URL automatically gains `/v1`. The
  connection test lists models first and then performs a real Chat Completions
  translation. Calls are sequential, bounded, timeout-aware, and cache identity
  includes server, model, prompt revision, and world-context fingerprint without
  including secrets.
- 2026-07-15: LLM calls now receive the approved glossary as terminology
  reference and an editable world profile. The settings UI can have the selected
  local model suggest that profile from a 12,000-character maximum sample of
  Journal text and Actor/Item/Scene names. Generation only fills the textarea;
  the GM must review and explicitly save it. The final check passed with **129
  tests across 30 files** and a 153.02 kB production bundle.
- 2026-07-15: Real Foundry-to-LM-Studio QA passed after CORS was enabled on the
  user's LAN server. The settings UI successfully listed and tested
  `google/gemma-4-12b-qat`, saved the OpenAI-compatible provider, server URL,
  model, and manual Ember profile, and loaded those values back. The first
  30,000-character world-profile sample exhausted this model's 8,192-token
  context during reasoning and produced no final content; reducing the bounded
  sample to 12,000 characters fixed it. A subsequent real-Foundry generation
  produced a 1,165-character editable profile and left the previously saved
  profile unchanged until explicit Save. The suggestion included at least one
  questionable inference (D&D 5e), confirming that mandatory human review is
  necessary.
- 2026-07-15: Root cause of the misleading Ember profile was identified after
  release `v0.14.0`: the 12,000-character prefix contained only five text pages
  from the first `Chamber of Agaseros` Journal out of 75 Journals and no Actor,
  Item, or Scene names. The sampler was replaced with a stratified selection:
  keyword-ranked overview/lore/guide/history/faction pages from distinct
  Journals, random excerpts from additional Journals, a keyword-first Journal
  name index, random Actor/Item/Scene name samples, and world/system metadata.
  Both the English model prompt and Czech/English UI now state that this is an
  incomplete keyword-selected and random sample and instruct the model not to
  overfit one adventure or guess the rules system from generic RPG terms.
- 2026-07-15: Real Ember QA of the replacement sampler passed against LM Studio
  with `google/gemma-4-12b-qat`. The request included the official Ember world
  description, active `Crucible 0.10.1` metadata, all 75 Journal names,
  randomized samples from 265 Actors, 443 Items, and 97 Scenes, five
  keyword-selected excerpts from distinct broad-profile Journals, and three
  random excerpts from other Journals. Empty `Under Construction` and
  Foundry-reference-only pages are filtered before selection. The resulting
  profile covered the Ember Cosmos, Eiru, the Weave, Shard Gods, Elder Gods,
  major organizations and locations instead of one dungeon. The existing saved
  profile remained unchanged. Final validation passed with **132 tests across
  31 files** and a 157.18 kB production bundle; patch release `v0.14.1`.
- 2026-07-14: The user confirmed that recursive Journal translation in `v0.9.0`
  works in their Foundry instance.
- 2026-07-14: Work started on the next milestone: schema-aware Actor translation,
  a dedicated translated-Actor compendium, Actor nodes in the dependency graph,
  and rewriting Journal `@Embed` references to translated Actor UUIDs.
- 2026-07-14: Actor copies must preserve the complete Actor and stable embedded
  Item IDs. Only fields identified as `HTMLField` by the live Actor/Item system
  schemas will be translated; mechanical values, model identifiers, actions,
  UUIDs, and non-HTML strings must remain byte-for-byte source data.
- 2026-07-14: In the symlinked local development install, rebuilding to a new
  module version removes the previous versioned bundle from `dist/`, while an
  already-running Foundry server keeps the old manifest in memory. Restart
  Foundry after a version/bundle-name change or the client requests the old file
  and receives a 404.
- 2026-07-14: Actor milestone was paused due to a session usage limit and
  resumed in a later session on the same day.
- 2026-07-14: The interrupted `/tmp/test-foundry-actor-recursion.mjs` E2E was
  re-run against a freshly restarted Foundry and **passed**: the synthetic
  Actor biography was stored translated in `world.foundry-translate-actors`,
  the Journal `@Embed` was rewritten to the translated Actor UUID, the source
  Actor remained byte-for-byte unchanged, and zero fallback segments occurred.
  The only console errors were the known unrelated Crucible `prepareGrimoire`
  failures. Temporary test data was cleaned up by the script.
- 2026-07-14: A fresh Foundry start redirects to the `/join` screen; the E2E
  script now selects the Gamemaster user and joins before waiting for
  `game.ready`.
- 2026-07-14: Released as `v0.10.0`.
- 2026-07-14: Added a global active-translations overview and an upfront
  dependency-graph size scan. Before translating, the whole graph is traversed
  write-free and the total number of documents and translation units (journal
  pages plus Actor HTML fields) is computed, so progress and a remaining-time
  estimate can be shown from the first unit. The overview window lives in the
  module settings menu (`Probíhající překlady`), tracks every run regardless of
  entry point via the `activeTranslations` registry in
  `src/translation/active-translations.ts`, and shows state, progress bar,
  counts, ETA, and the current document/page. Verified with a real-Foundry E2E
  (`/tmp/test-foundry-active-translations.mjs`): a 2-page Journal with an Actor
  embed reported 5/5 units and 2/2 documents and finished with a full progress
  bar. Per-run status strings now include the overall totals.
- 2026-07-14: The user asked that commits contain no `Co-Authored-By: Claude`
  trailer.
- 2026-07-14: `v0.10.0` was pushed and tagged, the GitHub release published,
  and the public manifest and `foundry-translate.zip` assets verified. The
  user confirmed that the active-translations overview and the upfront graph
  totals work in their Foundry instance.
- 2026-07-14: Standalone Item recursion implemented for `v0.11.0`, mirroring
  the Actor pipeline: complete Item copy in `world.foundry-translate-items`,
  only live-schema `HTMLField` paths translated, references rewritten. A
  real-Foundry E2E (`/tmp/test-foundry-item-recursion.mjs`) passed on the first
  run: a Crucible weapon's `system.description.public` was translated, all
  mechanical fields stayed byte-for-byte, the Journal `@UUID` was rewritten,
  and the source Item was unchanged.
- 2026-07-14: A scripted whole-`Gamemaster's Guide` smoke test with a stubbed
  translator was started locally but crashed mid-run because its Chromium
  window was closed while the user worked on the machine. Its automatic
  cleanup did not run, so the local `ember-test` world may still contain
  stub artifacts: translated documents whose names start with `CZ ` and cache
  entries containing `CZ `-prefixed units. `/tmp/cleanup-guide-smoke.mjs`
  removes exactly those; it still needs to be run once the user approves.
- 2026-07-14: The user ran a full `Gamemaster's Guide` translation on another
  machine with real data: it completed, a small number of parts did not pass
  (isolated fallbacks/warnings), and the overall result looked good for the
  document count involved.
- 2026-07-14: **Translate this page** implemented: the journal header controls
  menu translates only the active page plus one dependency level
  (`JournalTranslationService.translatePage`, `scope.dependencyDepthLimit`).
  Partial translations carry an explicit `partial: boolean` +
  `processedPageIds` in the flag and merge into one stored document
  (`mergePartialJournalTranslation`); full page coverage flips the flag to a
  complete translation. **Important Foundry finding:** update-in-place merges
  flag objects recursively, so a key omitted from a new flag silently keeps its
  old stored value — never encode state as "key absent"; use explicit values.
  Verified by a two-phase real-Foundry E2E including depth-limit behavior
  (the dependency of a dependency stays untranslated and keeps its source
  reference).
- 2026-07-14: Clicking the translate action of an already-running journal opens
  the active-translations overview (`openActiveTranslationsOverview`).
- 2026-07-14: Runs collect issues (quality fallbacks with source preview,
  unresolved/unsupported/failed dependencies) in the registry; the overview
  shows an issue count and a **Copy log** button producing a plain-text debug
  log (`formatRunLog`). Verified via clipboard in a real-Foundry E2E.
- 2026-07-14: The glossary now supports fixed custom translations: a second
  input in Manage glossary sets `replacement`; entering an existing term
  updates it (`planManualTerm`, `GlossaryCompendiumRepository.saveEntry`).
  Journal/Actor/Item flags store a `glossaryFingerprint`, and reuse checks
  reject translations made with a different glossary, so corrections re-apply
  on the next run (verified end-to-end: replacement change → re-translate →
  stored copy updated). The unit cache already keyed on the glossary
  fingerprint.
- 2026-07-14: Vitest now loads `tests/setup.ts`, which provides a minimal
  `foundry` global so ApplicationV2 subclasses can be imported in tests.
- 2026-07-14: `v0.11.0` (standalone Item recursion) was tagged and released by
  the user while the next features were still in progress, so page
  translation, the copyable run log, and glossary custom translations ship as
  `v0.12.0`.
- 2026-07-14: The user's real Ember `Gamemaster's Guide` run log (768
  documents, 7 739 units) exposed two genuine resolution bugs, both fixed:
  anchored references (`...JournalEntryPage.X#section`) failed because the
  anchor was treated as part of the UUID — discovery now strips `#anchor` and
  rewriting keeps it after the translated UUID; and page-relative references
  (`.pageId`, `.pageId#anchor`) failed because Foundry resolves them relative
  to the containing PAGE (the entry alone lacks the embedded type), so
  resolution now anchors to the page first. Verified by a real-Foundry E2E.
  All three engine revisions were bumped (journal 4, actor 2, item 2) so the
  improved rewriting re-applies to stored translations.
- 2026-07-14: Debug logs are now English end-to-end: quality-fallback details
  in the unit translator, and dependency issues rendered from structured data
  (type, `documentType` for unsupported references) instead of the Czech UI
  message. Issues beyond the 500-per-run cap are counted and reported as
  `(+N more were not recorded)`.
- 2026-07-14: The active-translations overview gained a **Cancel** button.
  `activeTranslations.requestCancel` sets a flag; the service checks it before
  each document and after each completed unit and throws
  `TranslationCancelledError`, which finishes the run as `cancelled` (not an
  error). Completed units stay in the cache and completed documents in the
  compendia, so the next run resumes where the cancelled one stopped —
  verified by a real-Foundry E2E with a slowed translator (cancelled at 2/6
  units, resume completed from cache).
- 2026-07-14: The user asked whether manually editing stored translations is
  safe, and proposed a learn-from-corrections feature. Current behavior:
  manual edits to translated compendium documents survive as long as reuse
  holds (same source hash, glossary fingerprint, and engine revision), but ANY
  retranslation trigger silently overwrites them. Future feature idea, in
  order of value: (1) store a content hash of the saved translation in the
  flag, detect manual edits before overwriting, and warn or skip; (2) diff the
  manual edit against the machine output to propose glossary replacement
  entries ("learning from mistakes"). Not implemented yet.
- 2026-07-14: Remaining known causes of unresolved references in real Ember
  data: genuinely missing world documents, and `Compendium.dnd5e.*` links
  pointing to packs that are not present in the user's world. Unsupported
  types observed in real data: Scene, Playlist, Macro, RollTable,
  ActiveEffect, Folder — candidates for future adapters (RollTable text
  likely first by value).

### Actor milestone state (released in v0.10.0)

Implemented:

- `src/translation/actor.ts`:
  - immutable Actor snapshot and source hash;
  - versioned Actor translation metadata;
  - translation of only live-schema-confirmed Actor and embedded Item
    `HTMLField` paths;
  - complete Actor copy with stable embedded Item IDs;
  - cache, token integrity, quality fallback counts, and field progress;
  - proper Actor names are preserved and receive only the target-language suffix.
- `src/translation/compendium-actor-translation-repository.ts`:
  - dedicated `world.foundry-translate-actors` Actor compendium;
  - source UUID + target language identity;
  - update-in-place instead of duplicate creation;
  - placement in the shared `Foundry Translate` compendium folder.
- The Journal dependency graph now accepts both Journal and Actor nodes:
  - Journal `@Embed[Actor...]` targets can be translated as Actor dependencies;
  - Actor HTML may recursively reference Journals or other Actors;
  - reference rewriting is generic across translated Journal and Actor data;
  - standalone Item roots remain unsupported for now;
  - Actor quality fallbacks are included in the graph completion total.
- UI progress distinguishes Journal pages from Actor HTML fields.
- New unit coverage for Actor source immutability, schema-selected HTML fields,
  mechanical-data preservation, embedded Item ID preservation, Actor hashing,
  and Actor compendium update-in-place behavior.

Verified:

- `npm run check` passed: typecheck, **91 tests across 20 test files**, and a
  production bundle of approximately 92.7 kB.
- The real-Foundry E2E `/tmp/test-foundry-actor-recursion.mjs` passed (see the
  work log above). Journal-to-Actor recursion is confirmed working against
  Foundry `14.364`, Crucible `0.10.1`, and Chrome Local Translator.
- No interrupted Node/Chromium process remained from the previous session; the
  E2E was run with the single `/tmp/foundry-chromium-148-profile` profile and
  the browser was closed afterwards.

## Project goal

Foundry Translate is a Foundry VTT v14 module for playing English adventures in
Czech without a separate server-side service. Source documents must never be
modified. Translations are stored in world compendia, use a portable proper-name
glossary, and must safely preserve Foundry syntax, UUIDs, inline rolls, embeds,
and HTML.

The user's main priorities are:

- reliability is more important than speed or the number of documents created;
- proper names and locations may remain unchanged and do not need Czech inflection;
- API keys are entered through the module settings;
- everything runs inside Foundry, with no separate service;
- translations should eventually be exportable and importable between instances;
- the priority after `v0.9.0` is translating Actor and Item dependencies.

## Implemented functionality

- Chrome Local Translator is the default free provider.
- Google Cloud Translation Basic v2 is available as an optional provider.
- Provider, language, and local API-key settings.
- Proper-name glossary in the `Foundry Translate — Glossary` compendium.
- Duplicate-safe synchronization of world Actor and Scene names.
- A **Translate this journal** action directly in an open Journal window.
- A **Show original** action in stored translations.
- Journal actions are hidden while the window is minimized and restored when it
  is expanded again.
- One translation per source UUID and target language; subsequent runs update the
  same compendium document.
- Translation of the Journal name, page categories, page names, and HTML content.
- Automatic detection of Ember/custom-system HTML fields.
- Translation of visible HTML attributes (`alt`, `title`, and `aria-label`).
- Protection of `@UUID`, inline rolls, glossary tokens, and HTML boundaries.
- Translation of human-readable `@Embed` parts, including `readaloud`, without
  changing the UUID.
- Recursive Journal-to-Journal translation with dependency-first traversal.
- Recursive Actor translation: complete Actor copies with stable embedded Item
  IDs in the `world.foundry-translate-actors` compendium, translation limited to
  live-schema-confirmed `HTMLField` paths, and Journal `@Embed[Actor...]`
  references rewritten to the translated Actor UUID.
- Recursive standalone Item translation: complete Item copies in the
  `world.foundry-translate-items` compendium with only live-schema-confirmed
  `HTMLField` paths translated and references rewritten, mirroring the Actor
  pipeline. Embedded Actor Items continue to travel inside the Actor copy.
- A write-free scan of the whole dependency graph before translation computes
  total documents and units, powering overall progress and the global
  active-translations overview window with a remaining-time estimate.
- Deduplication of shared dependencies and safe cycle handling.
- Rewriting to translated compendium UUIDs after every graph node is stored.
- Stable JournalEntryPage IDs across rewritten page references.
- Missing and unsupported dependencies fall back to their source UUID with a
  non-fatal warning.
- Long-content chunking, bounded request batches, and page-by-page progress.
- Server-side cache in the `Foundry Translate — Translation Cache` compendium.
- Quality retries for empty, structurally damaged, or suspiciously unchanged
  output.
- After quality retries are exhausted, an isolated fragment safely falls back to
  its source text, the rest of the page continues, the fallback is not cached,
  and the UI shows an amber summary.
- URL-like technical references are not sent to the provider.
- A source hash protects against changes to the source during a long translation.
- The translation-engine revision invalidates stored results after logic changes.
- The translation cache uses a versioned key schema; the current schema is `3`.
- Module compendia are grouped in the shared grey `Foundry Translate` folder.
- Translate this page: the active journal page plus one dependency level, with
  partial-translation merging into the single stored document.
- A global active-translations overview with progress, ETA, collected issues,
  and a copyable plain-text debug log.
- Glossary entries may carry a fixed custom translation; changing the glossary
  invalidates translation reuse via a stored glossary fingerprint.
- Markdown Journal pages translate visible source text while preserving Markdown
  mechanics, and their stored rendered HTML is translated for immediate display.
- Glossary entries are editable in a two-column source/fixed-translation view.
- 114 automated tests across 26 test files.

## Verified real-world cases

The module has been tested with Foundry `14.364`, Crucible `0.10.1`, the Ember
world, and Chromium 148 with the Chrome Built-in Translator model.

- Exact first page of Ember's `Gamemaster's Guide`:
  - page: `Main Quest Overview`;
  - source length: 15,671 characters;
  - Czech output: approximately 14,380 characters;
  - translated name: `Přehled hlavního úkolu`;
  - Actor embeds preserved;
  - no leaked protection tokens;
  - zero quality fallbacks.
- `https foundryvtt com releases 14 358` remains exactly unchanged.
- `Shard of Fear` may remain unchanged as a proper name without causing a false
  translation failure.
- A long Journal is saved as one translated compendium document, not as a world
  duplicate.
- Journal minimization changes the translate action from
  `flex -> none -> flex` across expanded, minimized, and restored states.
- A real Foundry `A -> B -> A` graph test translated both Journals, rewrote both
  directions, preserved the linked page ID, and removed all source UUIDs from
  the translated copies.
- `Gamemaster's Guide` contains 44 distinct Actor references. Real Actor data
  confirms that the main visible fields are `system.details.biography.*`, with
  additional HTML in taxonomy, archetype, and embedded Item descriptions.

Known `prepareGrimoire` console errors involving `life` and `illusion` originate
in the Crucible system and are unrelated to this module.

## Architecture and invariants

### Translation pipeline

- `src/translation/html.ts` plans safely translatable HTML text units.
- `src/translation/foundry-syntax.ts` protects Foundry syntax and translates only
  the human-readable parts of supported constructs.
- `src/glossary/protection.ts` protects proper names with integrity tokens.
- `src/translation/unit-translator.ts` handles batching, cache keys, retries,
  fallbacks, and segment restoration.
- `src/translation/journal.ts` translates Journal data page by page and creates
  the translation flag.
- `src/translation/journal-service.ts` connects the provider, cache, glossary,
  source hash, and stored translation.
- `src/translation/compendium-translation-repository.ts` maintains one stored
  translation per source UUID and target language.
- `src/translation/document-dependencies.ts` discovers and rewrites `@UUID`,
  `@Embed`, and enriched `data-uuid` references.
- `src/translation/dependency-graph.ts` provides dependency-first traversal,
  deduplication, cycle protection, and isolated dependency failures.

### Safety rules

- Never modify a source document.
- Never store an unrestored `__FTN_`, `__FTG_`, or `__FTS_` token.
- Never send the mechanical or identifying part of a Foundry reference to the
  translation model.
- Never use structurally damaged model output; retry and then use the safe source
  fragment.
- Never write a fallback fragment to the cache.
- A provider-wide failure on the first request remains fatal; an isolated retry
  failure for a fragment uses a fallback.
- After translation-logic changes, increment `TRANSLATION_ENGINE_REVISION` in
  `src/translation/journal.ts`.
- After changes to unit-output or cache semantics, increment `schemaVersion` in
  `cacheKey()` in `src/translation/unit-translator.ts`.
- An existing translation must be updated under the same compendium document ID,
  not duplicated.

## Current data stores

- `world.foundry-translate-glossary` — proper names and locations.
- `world.foundry-translate-cache` — translated-unit cache.
- `world.foundry-translate-translations` — JournalEntry translations.
- `world.foundry-translate-actors` — translated Actor copies.
- `world.foundry-translate-items` — translated standalone Item copies.

The translation flag contains the source UUID and hash, provider, language pair,
timestamp, translated/skipped page counts, fallback-fragment count, and engine
revision. A legacy flag without an engine revision remains readable but must not
be reused as a current translation.

## Completed recursion milestone (Actor in v0.10.0, Item in v0.11.0)

### Required user outcome

When a page contains an `@UUID`, `@Embed`, or another supported document
reference, the module should:

1. Resolve the referenced source document.
2. Create or update its translation in the appropriate Foundry Translate
   compendium.
3. Recursively process its own dependencies.
4. Rewrite the translated parent's reference to the translated UUID.
5. Preserve all source documents and stable page IDs.
6. Safely handle cycles, repeated references, and missing documents.
7. Report progress by document and page.
8. Allow translation of either the complete Journal graph or only the active
   page graph.

### Recommended implementation plan

#### 1. Dependency discovery without writes — completed for Journals

- Introduce a normalized `TranslationDependency` type containing `sourceUuid`,
  `rootUuid`, `documentType`, `pageId`, `syntaxKind`, and `fieldPath`.
- Extract dependencies from source values before tokenization:
  - `@UUID[...]`;
  - `@Embed[...]`;
  - enriched HTML links with `data-uuid`;
  - visible/custom-system HTML fields.
- Distinguish root documents from embedded page UUIDs.
- Resolve with Foundry's `fromUuid` and return an explicit unresolved warning.
- Do not mutate or save anything in this phase.
- Add tests for world UUIDs, compendium UUIDs, page UUIDs, embeds, duplicates,
  and missing UUIDs.

#### 2. Translation graph orchestrator — completed for Journals

- Use `sourceUuid + targetLanguage` as the graph node key.
- Node states: `queued`, `translating`, `translated`, `failed`, `unresolved`.
- Use `visited` and `inProgress` sets to break cycles such as `A -> B -> A`.
- Translate a shared dependency only once even when hundreds of references point
  to it.
- Do not impose a small implicit maximum depth. Reliability is the priority. Add
  cycle protection, user cancellation, and, if needed, an explicit high safety
  limit with a clear warning.
- Save completed nodes incrementally so a failed or cancelled run can resume.
- Translate dependencies first, then atomically save the parent with rewritten
  UUIDs.

#### 3. Document adapters and per-type compendia

A Foundry compendium has one document type, so the Journal translation pack
cannot store Actor or Item dependencies. Introduce an adapter interface such as:

```ts
interface DocumentTranslationAdapter<TSource, TData> {
  supports(document: FoundryDocument): boolean;
  snapshot(document: FoundryDocument): TSource;
  dependencies(source: TSource): TranslationDependency[];
  translate(source: TSource, context: TranslationContext): Promise<TData>;
  save(data: TData, context: TranslationContext): Promise<FoundryDocument>;
}
```

Recommended adapter order:

1. `JournalEntry` with stable `JournalEntryPage` IDs — completed.
2. `Actor`, especially Ember biography/readaloud/system HTML — completed.
3. `Item` and other types discovered during real Ember traversal — standalone
   Items completed.
4. Additional types only when supported by evidence from actual content.

Each document type needs its own world compendium in the `Foundry Translate`
folder, for example translated Actors and Items. The source UUID plus target
language to translated UUID mapping must remain consistent across packs.

#### 4. Reference rewriting — completed for Journal targets

- Rewrite `@UUID[JournalEntry.X.JournalEntryPage.Y]` to the translated Journal
  UUID while preserving page ID `Y`.
- Rewrite `@Embed[Actor.X]` to the translated Actor UUID so dynamically rendered
  white Ember text loads in Czech.
- Translate human-readable labels and options, then integrity-check the mechanical
  syntax again.
- If a dependency cannot be resolved or translated, keep its source UUID and add
  a warning. One missing reference must not discard the whole graph.
- Never rewrite a source UUID inside the source document itself.

#### 5. UI and progress

- The existing **Translate this journal** action should process the complete
  dependency graph.
- Add **Translate this page** for the active page and its recursive
  dependencies — completed with a one-level dependency scope.
- Show the current document, current page, completed/total count, and unresolved
  and fallback counts.
- The completion warning should distinguish:
  - text fallbacks;
  - unresolved documents;
  - dependency documents that failed translation.
- Hide Translate/Show Original controls while minimized, as in `v0.9.0`.

#### 6. Mandatory recursion regression tests

- `A -> B -> C`, including all rewritten links.
- `A -> B -> A` cycle without a deadlock or duplicate.
- Two pages referencing the same Actor produce one translated Actor.
- A Journal page UUID preserves its page ID.
- An `@Embed Actor` renders translated Actor data.
- A missing UUID remains the source UUID with a warning, and the parent is saved.
- A dependency provider failure does not destroy completed nodes.
- A source change in a dependency invalidates only the required translated node,
  while the parent link remains stable.
- An older translation or cache revision is not reused.
- A full `Gamemaster's Guide` smoke test in Ember.

## Known remaining limitations

- Recursive translation and reference rewriting support Journal, Actor, and
  standalone Item targets. Other document types remain pointed at their source
  UUID and produce a warning.
- Portable translation-bundle export/import is not implemented yet.
- Output-hash protection covers newly generated Journal, Actor, and Item copies;
  older stored translations gain it only after they are generated again.
- Smart-glossary candidate extraction currently observes manual edits to
  translated Journal pages. Actor and Item field corrections are protected from
  overwrite but do not yet create review candidates.
- Helium does not support Chrome Local Translator; the tested Chromium profile
  does.
- The stock TranslateGemma LM Studio chat template requires custom structured
  message fields which are discarded by LM Studio's standard OpenAI-compatible
  Chat Completions normalization. A general Gemma/Qwen instruction model works;
  TranslateGemma needs a compatible custom prompt template before it can be used
  through this provider. Its official template also does not support the freeform
  context prompt used by the world-profile feature.

## Local development environment on the original machine

Current machine update (2026-07-15):

- Foundry `14.364` binary is available at
  `/home/flamendrin/Games/FoundryVTT-Linux-14.364/foundryvtt`.
- The `fvtt` CLI is configured with that install and the isolated data path
  `/home/flamendrin/.local/share/FoundryVTT-foundry-translator-test`.
- The disposable `ember-test` world is installed in that profile. It uses
  Crucible `0.10.1`, requires the Ember module, and is the preferred target for
  Ember-specific real-Foundry E2E testing.
- The development module is linked from
  `Data/modules/foundry-translate` to this repository's `dist` directory.
- Start the setup server with
  `fvtt launch --noupnp --noupdate --port 30000`; add `--world ember-test` for
  direct world launch after the Foundry license has been activated.
- A test LM Studio server was available at `http://192.168.10.183:1234`.
  `GET /v1/models` exposed `translategemma-4b-it`, two general Gemma models,
  Qwen, and an embedding model. A real protected-token translation succeeded
  with `google/gemma-4-12b-qat`; the stock `translategemma-4b-it` template
  rejected standard OpenAI chat message shapes as described above.

These paths are machine-specific and must be replaced with equivalents elsewhere.

- workspace: `/home/spilberktuma/workspace/foundry-translate`
- Foundry binary:
  `/home/spilberktuma/Downloads/FoundryVTT-Linux-14.364/foundryvtt`
- data path: `/home/spilberktuma/.local/share/FoundryVTT`
- test world: `ember-test`
- URL: `http://127.0.0.1:30000`
- Chromium: `/usr/bin/chromium`
- profile with the installed model: `/tmp/foundry-chromium-148-profile`

Use only one Chromium process with this profile. Do not create parallel profiles,
and terminate the process after testing. Old test profiles once filled `/tmp` and
caused `Quota exceeded (-122)`; do not delete the main profile containing the
TranslateKit model.

Start Foundry with:

```bash
/home/spilberktuma/Downloads/FoundryVTT-Linux-14.364/foundryvtt \
  --dataPath=/home/spilberktuma/.local/share/FoundryVTT \
  --world=ember-test \
  --port=30000
```

## Development, testing, and releases

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
npm run release:verify
```

Release workflow used by this project:

1. Inspect `git status -sb`, the complete diff, and `git diff --check`.
2. Stage only explicit files; do not use `git add -A`.
3. Create one coherent commit directly on `main`.
4. Run `git push origin main`.
5. Create and push an annotated `vX.Y.Z` tag.
6. Verify the GitHub Actions release.
7. Verify the public `module.json` and `foundry-translate.zip` assets.

`gh` authentication was not working on the original machine, but normal HTTPS
`git push` worked. The project intentionally uses fewer, larger, verified pushes.

Installation manifest:

```text
https://github.com/f-tuma/foundry-translator/releases/latest/download/module.json
```

## Recommended first steps for the next agent

1. Read this document and the README.
2. Run `git status -sb` and `npm run check`.
3. If the local `ember-test` world still contains `CZ `-prefixed stub
   artifacts from the crashed smoke test, run `/tmp/cleanup-guide-smoke.mjs`
   (see the work log) with the user's approval.
4. Remaining roadmap in order: safe manual edits and user-approved smart
   glossary suggestions, then portable translation-bundle export/import (the
   user explicitly wants export last).
5. If the user reports specific failed parts from their real `Gamemaster's
   Guide` run, ask for the copyable log from the Active translations window
   and address the reported fallbacks.
