# Foundry Translate — project handoff

- Updated: 2026-07-14
- Repository state: `main`, release `v0.8.4`
- Repository: <https://github.com/f-tuma/foundry-translator>

This document provides the working context needed to continue the project from
another device or with another agent. The README remains the user-facing
documentation; this document records technical decisions, verified findings,
and the recommended implementation order.

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
- the priority after `v0.8.4` is recursive translation of referenced documents.

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
- 81 automated tests across 16 test files.

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

The translation flag contains the source UUID and hash, provider, language pair,
timestamp, translated/skipped page counts, fallback-fragment count, and engine
revision. A legacy flag without an engine revision remains readable but must not
be reused as a current translation.

## Main remaining work: recursive translation

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

#### 1. Dependency discovery without writes

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

#### 2. Translation graph orchestrator

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

1. `JournalEntry` with stable `JournalEntryPage` IDs.
2. `Actor`, especially Ember biography/readaloud/system HTML.
3. `Item` and other types discovered during real Ember traversal.
4. Additional types only when supported by evidence from actual content.

Each document type needs its own world compendium in the `Foundry Translate`
folder, for example translated Actors and Items. The source UUID plus target
language to translated UUID mapping must remain consistent across packs.

#### 4. Reference rewriting

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
- Add **Translate this page** for the active page and its recursive dependencies.
- Show the current document, current page, completed/total count, and unresolved
  and fallback counts.
- The completion warning should distinguish:
  - text fallbacks;
  - unresolved documents;
  - dependency documents that failed translation.
- Hide Translate/Show Original controls while minimized, as in `v0.8.4`.

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

- Recursive translation and reference rewriting are not implemented yet.
- Dynamically rendered content from a source Actor may therefore remain in
  English.
- Markdown source pages are intentionally not translated yet.
- Portable translation-bundle export/import is not implemented yet.
- Helium does not support Chrome Local Translator; the tested Chromium profile
  does.

## Local development environment on the original machine

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
3. Start with dependency-discovery types and the parser, without Foundry writes.
4. Add synthetic graph tests before the orchestrator creates compendia.
5. Implement Journal-to-Journal recursion first.
6. Then add the Actor adapter for Ember `@Embed`, which is the main current use
   case.
7. Only then add **Translate this page** and run the full Ember smoke test.
