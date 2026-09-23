# Foundry Translate

Reliable, glossary-aware adventure translation for **Foundry Virtual Tabletop v14**.

Version **0.28.0** adds recoverable local drafts and previewed editorial project
export/import, including notes and imported attestations. Glossary name checks
and protected editorial corrections survive continuation of unfinished journals. The editor also includes global
fuzzy search, previewed bulk corrections, undo history and Czech UI catalogs. It also supports display-only translations for scenes and active
effects, preserving their original UUIDs and game mechanics, including Ember automation.
It includes safe pause/continue, protected saved translations,
an adventure translation desk, an Ember-aware name
glossary, and portable JSON translation bundles. Translation runs locally through
LM Studio or another OpenAI-compatible API.
Generated text is structurally validated; language quality still depends on the
chosen model. The source adventure remains unchanged.

Translated actors, items and journals use clean names without a language suffix.
The target language and original document are tracked in metadata.
Contextual Czech inflection follows the reviewed glossary.
Automatic AI naming remains disabled; names are chosen through the reviewed glossary workflow.
Export names as CSV or JSON, edit them with context and notes, then preview and
select additions or updates before importing. Synchronization only collects
original names; it does not contact a naming model.

## Czech interface

Version 0.19.1 adds Czech interface catalogs for Foundry v14, Crucible and Ember.
Choose **Čeština** under **Game Settings → Language Preference**, save and reload.
The interface works without a running model. Adventure translation remains a
separate action. See [coverage and maintenance](docs/czech-interface.md).

## Quick start

1. Open **Adventure translation** under the left **Journal Notes** controls, in the Journal sidebar, or in Module Settings.
2. Open **Translator and language**, enter the API address and model ID, test the connection and save.
3. Open a Journal page and click **Translate this page** in its header.
4. Use **Show original** to switch back without losing the current page.

Names are synchronized automatically before translation. For a long book, use
**Translate a whole journal**; this also processes linked documents. A single-page
translation only processes that page and reuses already available linked copies.

## Scenes and active effects

Click **Translate text** in a Scene or Active Effect sheet. Whole-journal translation
also processes linked scenes/effects and effects embedded in linked actors/items.
The module translates scene/navigation names, map drawing and note text, level and
region names, and effect names/descriptions. Rules, positions, scripts, statuses,
durations, and source UUIDs are never translated or copied by this feature.

Review them through **Adventure translation → Translation editor**, or edit
the text pages in **Foundry Translate — Scene & Effect Text** directly.
The pack is GM-only by default because scene names and notes may contain spoilers.
Translations display in navigation, map labels, placeable lists, native content
links and Crucible effect cards; configuration fields keep their original values
with a read-only translated preview. This does not patch every third-party widget.
Changed source text falls back to the original. Existing manual corrections are
kept, and incompatible or conflicting records block regeneration.

## Review and corrections

Open **Adventure translation → Translation editor**. Select a translated
Journal, Actor, Item, Scene or Active Effect. Sections keep Journal pages and
embedded items together; the table aligns original paragraphs with editable
translations. Inline formatting is preserved through separate text segments.
Link markers protect UUIDs and game commands while their display labels remain
editable. Search a section or show only unverified blocks.


**Recovery** restores locally saved document, note and interface drafts after a
reload or crash, with a comparison against current content. Recovery only fills
the editor; save and verification remain separate. Storage failures are visible
and drafts can be downloaded. Bulk replacement selections require a fresh preview.

**Project file** exports saved translations, glossary, notes, issue states,
valid attestations and Czech interface overrides. Import has explicit selection
and text/metadata previews, requires matching original UUIDs and content, and
rejects stale previews. Imported attestations retain the claimed author and time
and are visibly labelled; they are not signatures. Stale notes remain stale.
Existing conflicting glossary terms are preserved. Drafts and undo history are
not transferred. Partial failures are reported; reopen the file to re-plan.

Open **Find and replace** to search all stored translations in the target language.
Choose original or translated text, document types and unverified-only results.
Similar spellings are suggestions: each literal variant has its own replacement,
so Czech inflections can be corrected independently. Bulk corrections do not
change the glossary; update its base term separately for future translations. Select variants or individual
occurrences, inspect the paragraph-level before/after preview, then save. Names
split across formatting segments are offered for manual editing. Commands, UUIDs,
Markdown destinations and code are excluded from automatic replacement.

**Correction history** records before/after text, reviewer and time for each saved
correction. Changes and their history are saved together in one document update.
Batches preflight all selected documents, commit sequentially and stop on failure;
there is no all-world transaction. A stop completes the current document. Undo
works per document and refuses to overwrite subsequently changed passages or
changed sources. Undo also clears verification. Export history as JSON for a
readable audit record; it is not an importable translation bundle. History is
stored with the translated document and inherits its access permissions.

The **Edit translation** header icon opens the corresponding document/page directly,
from either a translated sheet or its source when a unique translation exists.
The **Interface** tab edits installed Foundry, Ember and Crucible Czech catalogs:
search, correct, verify separately or restore the bundled text. Overrides live in
the world settings, survive module updates, and apply on each client's next reload.
Variables, tags and URLs are validated. JSON export/import offers a before/after
preview; imports skip incompatible source strings and do not import verification.
An updated source disables a stale override until it is corrected. Interface
settings are world-scoped; they do not customize Foundry Setup before a world loads.

**Save correction** and **Verify** are separate actions. Verification records
the reviewing GM and time and is valid only for the saved paragraph and original
field context. A changed source or translated block no longer appears verified.
Untranslated pages in partial journals cannot be verified. Dirty drafts survive
section navigation, and closing/reloading requires saving or discarding them.

Edits only update translation copies or display-text sidecars. Locked packs,
changed sources, mismatched structures and detected intervening edits block writes.
Pause a running translation before editing. Corrections saved by the 0.26+ editor
carry a verifiable receipt: unchanged source/glossary/provider allow continuation
of remaining pages while corrected fields, review marks and history are preserved.
Untracked changes (including older corrections) still block unfinished copies. Foundry does not offer a server
compare-and-swap transaction: coordinate simultaneous GM edits to one document.
JSON bundles include saved corrections; verification marks remain local and must
be confirmed again in an importing world. A manual mark is a reviewer's approval,
not an automatic guarantee of semantic accuracy.

Portable JSON bundles include these records (bundle format 3, requires 0.23.0+).
Import does not need a model and never modifies the scene or effect itself.
Macros, roll tables, playlists and text baked into images remain outside scope.

## Installation

In Foundry VTT Setup open **Add-on Modules → Install Module**, paste this address
into **Manifest URL**, and select **Install**:

```text
https://github.com/f-tuma/foundry-translator/releases/latest/download/module.json
```

Then open a world as Game Master, choose **Manage Modules**, enable
**Foundry Translate**, and save the module configuration.

Do not paste the repository address into Foundry. Foundry requires the direct
manifest address ending in `module.json` shown above.

## Current smoke test

After activating the module, open the browser developer console and verify:

```js
game.modules.get("foundry-translate")?.active;
game.modules.get("foundry-translate")?.api;
```

The first expression should return `true`. The API object should report
`isReady(): true` after the world finishes loading.

## Translation provider setup

As Game Master open **Configure Settings → Module Settings → Foundry Translate**
and select **Configure translator**.

The only active provider is **OpenAI-compatible API**. Older Chrome/Google
settings are ignored, and their credentials are never reused as API tokens.
Existing imported translations still retain their historical provider metadata.

**OpenAI-compatible / LM Studio** connects directly from the GM browser to a
local server. Enter either the server root (for example
`http://localhost:1234`) or its `/v1` URL, the exact model ID returned by
`GET /v1/models`, and an optional Bearer token. LM Studio must allow CORS and,
for another machine on the LAN, serve on the local network. The address, model,
and token are client-scoped.

For Czech on the current test PC, use **Hy-MT2 30B-A3B APEX** with the
server ID `hy-mt2-30b-a3b-apex`. Its Czech path uses grammar-constrained JSON
items, whole-sentence context and checked glossary forms. APEX's structured
translation uses temperature 0; other Hy-MT models retain their sampling defaults.
Hy-MT2 7B remains a smaller alternative, with a different protected XML path.
Gemma 4 and Qwen3.8 use LM Studio's native API with reasoning disabled.
See the [Czech guide](docs/user-guide.cs.md) and [APEX validation](docs/benchmarks/apex-release-2026-09-21.md).

LLM translation can use an editable world profile containing setting, genre,
tone, lore, and translation preferences. **Suggest profile from world** builds a
bounded stratified sample: it prioritizes Journal and page names associated with
setting, lore, guides, history, factions, and similar overview material, then
fills the remaining budget with random excerpts from different Journals and
random Actor, Item, and Scene names. The prompt explicitly tells the model this
is an incomplete sample and asks it to infer broad repeated patterns without
overfitting to one adventure. The GM must review the result and explicitly save
the settings. Names in the exact glossary mode stay hidden behind protected
tokens. Names with Czech inflection enabled are inserted in their approved Czech
form between checked marker pairs so the model can choose their grammatical case. Cache
entries are separated by server, model, prompt revision, world profile, and
glossary contents.

Google's stock TranslateGemma chat template uses a specialized structured
message format which LM Studio currently does not preserve through the standard
OpenAI-compatible Chat Completions endpoint. For this provider, use a normal
instruction model such as Gemma Instruct or Qwen, or install a
TranslateGemma-compatible LM Studio prompt template. The world-profile generator
requires a general instruction model.

The provider test performs one short English-to-Czech translation. For an LLM it
first verifies the exact configured model ID.

## Protected name glossary

### Reviewed glossary files

Open **Names and terminology → Export / import**. Synchronize first to collect
original names, then export **CSV** for collaborative editing or **JSON** for a
portable backup. Save draft edits before exporting. Both formats include source,
replacement, category, aliases, enabled state, usage mode and editorial notes; optional
context contains bounded excerpts from the adventure and may include spoilers.
AI naming and its settings have been removed. Previous decisions remain stored;
unreviewed legacy AI proposals are marked **needs review**.

Choose the edited file to preview additions, updates and unchanged entries.
New entries are selected initially; existing names require an explicit selection.
The preview compares translations, categories, aliases, notes, enabled state and
manual approval. Importing an unreviewed entry also approves it. Only selected
rows are saved; omitted rows are never deleted. Changes made since the preview
and conflicting aliases block writes. The open glossary refreshes after import
without overwriting drafts. Writes are serialized within this client, not as a
server transaction spanning independent GM browsers.

CSV uses UTF-8 with a BOM, quoted comma-separated cells and CRLF. Semicolon-separated
input is also accepted. Required columns: `source,replacement,category`.
Optional: `aliases,enabled,notes,context,language,mode`. Keep source names intact;
an empty replacement preserves the original. Categories use stable codes:
`character`, `location`, `faction`, `deity`, `item`, `lore`, `term`.
Aliases are a JSON array such as `["short name","other spelling"]`; enabled is
`true` or `false`. Mode is `fixed` (the legacy default) or `inflect`.
Disabled entries are ignored in either mode. Context is reference-only and is not imported.
Duplicate source names, ambiguous aliases, invalid fields, mixed/different
languages and files over 5 MB are rejected. Spreadsheet formula prefixes are
escaped on export and restored on import.

JSON uses `format: "foundry-translate-glossary"`, `version: 1` (or `2` for files with inflection),
`targetLanguage` and `entries`. The glossary from older translation bundles can
also be reviewed here; document translations in those bundles are ignored by
this glossary-only screen. To revise existing glossary choices, use this screen;
the separate adventure-bundle import continues to preserve local choices.

### Czech name inflection

Choose **Allow inflection** in a glossary row to retain its approved vocabulary
while allowing case endings, for example `Starý Carinth` → `do Starého Carinthu`.
This requires Czech and an OpenAI-compatible instruction model. Other target languages use the exact form; a translation-run warning explains
that fallback. **Do not use** omits the entry entirely, including terminology hints.

Internally, names use paired glossary markers. APEX receives complete contextual
units as JSON string values with only relevant approved dictionary forms.
The server grammar constrains the object keys, value types and item count.
Code locates every approved name form and reattaches adjacent protected link
syntax. Missing, duplicate, overlapping or renamed terms are rejected; opaque
syntax and HTML segment boundaries are validated separately. Other models use
short XML elements around original names. Both paths feed the same protection
checks and restore the glossary's capitalization.

These are vocabulary and structure guards, not a complete Czech morphology
engine or a guarantee of correct meaning. A wrong grammatical ending can pass;
an unsupported irregular form can be rejected. Failed items alone are retried
with the original sentence and rejected draft. If inflection still fails, the
translator tries exact approved forms for the affected names, then all names
in the fragment. This recovery is visibly flagged for grammar review and is
not cached. If even that fails validation, the original fragment is retained
with approved glossary forms and a visible issue.
Foundry UUIDs, commands and HTML boundaries retain their existing protection.
Mode changes invalidate translation caches and are preserved by sync, imports and
translation bundles. Version-2 JSON prevents older releases silently dropping modes.
Standalone units consisting of one glossary name (including a link label) keep
the exact canonical form; inline name segments still use the surrounding sentence.

The release prioritizes preserved meaning, consistent approved names and intact
references. Minor language errors still need editorial review. See the measured
results and limits in [APEX validation](docs/benchmarks/apex-release-2026-09-21.md).

To verify a local model through the production pipeline, run
`LM_STUDIO_MODEL=hy-mt2-30b-a3b-apex npm test -- tests/local-inflection.integration.test.ts`.
Use the server's exact model ID; optional `LM_STUDIO_URL` and `LM_STUDIO_RESULT`
set its address and the JSON result path. This integration check is opt-in and
skipped by regular CI; unit tests alone do not establish a model's Czech quality.
For synthetic multi-sentence paragraphs and inline references, use
`tests/local-context.integration.test.ts`. Its assertions check structure; the
printed translations still require a language review.

### Discover and edit names

As Game Master open **Configure Settings → Module Settings → Name glossary** and
select **Manage glossary**. The module discovers Actor and Scene names plus typed Ember location, biome,
cosmos, organization, deity, culture and lore pages, without changing those documents.
It categorizes characters, locations, factions, deities, unique items, lore and
ordinary terms. Ember creature templates (`flags.ember.discoverable=creature`)
are listed as ordinary, unprotected terms; named characters remain protected.
Actors without reliable classification retain the conservative name protection.
Unique items and names mentioned only in prose require a manual entry. **Synchronize names** creates or
updates entries in the `Foundry Translate — Glossary` world compendium. Module
compendia are grouped in a gray `Foundry Translate` folder in the Compendium
sidebar.

Search and category filters make large glossaries manageable. Expand a row to
edit its category, semicolon-separated aliases and protection checkbox. Disabled
terms remain stored but are translated normally. Manual decisions and custom
translations take precedence over future automatic synchronization.

Repeated synchronization does not create duplicates. Renamed Actors and Scenes
are detected by UUID, while manually customized replacements are preserved. You
can also add custom names such as factions or artifacts, and optionally give a
term a fixed custom translation — useful for correcting a strange machine
translation of a specific word. Entering an existing term with a new
translation updates it. During translation, exact glossary matches are
replaced by unique integrity tokens and restored as the stored replacement; if
a provider loses, duplicates, or changes a token, the translation is rejected
instead of returning a corrupted name. Translations remember the glossary they
were made with. A source, glossary, model, prompt, world-profile or source-language
change blocks automatic continuation of an incompatible saved copy. Review and
export that copy before deliberately removing it to generate a replacement.
The module never silently replaces it with a new model's output.

The glossary window also contains a review queue for suggestions learned from
manual corrections to translated Journal pages. A suggestion shows editable
source and replacement columns and must be explicitly accepted or rejected;
the module never adds it to the glossary automatically. If the source phrase
cannot be inferred safely, it is left blank and must be supplied before the
suggestion can be accepted. Newly generated Journal, Actor, and Item copies also
carry an output fingerprint. A compatible completed copy with manual corrections
is reused. An unfinished copy with tracked editor corrections can continue safely;
unknown changes still stop automatic continuation for review. The correction can also become a
glossary suggestion after explicit review.

## Name consistency checks (0.26.0)

In **Translation editor → Name consistency**, run a fresh scan of saved copies.
It uses enabled glossary names and aliases found in source passages, including
visible UUID labels. It highlights retained English names, missing equivalents,
capitalization differences and similar spellings. Recognized Czech inflections
are shown separately from concerns; this is a spelling heuristic, not semantic
or grammatical certification. Overlapping source phrases use the longest match.

Open a passage to inspect context, or send a spelling to global search for
selected replacements with preview. Unusual correct forms can be approved for
checks in this world, for this language and glossary wording; changing the base
translation invalidates that approval. Approval does not edit the glossary,
change translation prompts or mark a passage verified. Approvals can be revoked.
Re-scan after editing. Exported audit JSON is a report, not an import format.
Blocked/untranslated passages and unreadable documents are counted explicitly.
The scan only evaluates terms identifiable in source prose, not all possible
semantic omissions or names hidden in unlabelled references.

## Translate a Journal Entry

As Game Master open **Configure Settings → Module Settings → Journal
translation** and select **Translate Journal Entry**. Choose one world Journal
Entry and open its stored translation. The source document is never modified.

You can also open a world Journal Entry and select **Translate this journal**
directly in its header. A visible header button and the standard header controls
menu provide the same safe translation action. The header controls menu also
offers **Translate this page**: it translates only the currently viewed page
without starting translations of linked documents, so a chapter does not launch
an entire linked guide. Links use existing translations when available. Page translations of the same journal merge into one stored
translation, and once every page has been processed the result counts as a
complete translation. Clicking the translate action of a journal that is
already being translated opens the global overview instead.

The current development build translates the journal name, page-category names,
page names, HTML-backed pages, and Markdown source pages, including custom page
types used by adventure modules. In Ember this includes schema-declared HTML
fields, subtitles, and visible quest/standalone event outcome labels. Mechanical
IDs, quest state, outcome IDs, conditions and graph structure remain unchanged.
Inline markup and mechanical attributes remain local, while visible attributes
such as `alt`, `title`, and `aria-label` are translated. Foundry references such
as `@UUID[...]` and inline rolls such as `[[/r 1d20]]` are integrity-protected.
Human labels and supported `@Embed[...]` options such as `readaloud` are
translated without exposing UUIDs or configuration to the model. Markdown
structure, link destinations, fenced and inline code, frontmatter, and reference
definitions stay byte-for-byte unchanged; both the editable Markdown source and
its stored rendered HTML are translated.

Each narrative unit receives bounded original-source context: document/page titles,
field identity and neighbouring prose. Context is labelled as data, never appended
to the translated text, and participates in cache identity and request budgets.
HTML attributes cannot become prose context. Glossary rules retain precedence.
APEX sends contextual passages separately to reduce cross-passage word-sense and
speaker leakage; sentences within a passage are still translated together.

The [reference quality evaluation](docs/benchmarks/context-quality-2026-09-22.md)
compares the same pipeline with and without context. Meaning must be reviewed
separately from structural integrity; passing JSON/link checks does not certify
that a translation is semantically correct.

Before the first request, the module scans the complete dependency graph
without writing anything and reports the total number of documents and
translatable parts. Progress messages therefore show both the current page and
the overall total. The **Active translations** window in the module settings
provides a global overview of every running translation with a progress bar,
totals, the current document, and an estimate of the remaining time. When a
run has issues — quality fallbacks, unresolved references, or failed
dependencies — a **Copy log** button copies a plain-text debug log with every
issue, its reason, and a source preview. **Pause** finishes and saves the current
batch, then waits. **Continue** resumes that same run and configuration. With LM
Studio, a journal batch can contain four pages, so pausing is not instantaneous.
Paused time is excluded from the time estimate. **Cancel** also works while paused
and retains saved progress. Only one translation job runs in a browser at a time.

The run itself lives in the browser. After reloading or closing the tab, start the
same source journal again with the same settings: compatible saved journal pages
are reused directly, and cached text avoids repeating completed Actor/Item fields.
An unfinished model request may need to run again. Wait for **Paused** before
closing when possible. Edits, deletion or replacement of the target detected
before a save stop the run instead of overwriting intervening work.

These are optimistic checks, not a server transaction or a cross-browser lock.
Run translations from one GM tab; simultaneous writes from separate clients still
have a narrow race window. Export important reviewed translations as a backup.

Empty, structurally damaged, and suspicious unchanged results are retried up to
three times and are never written to cache. Intentionally preserved glossary
terms are excluded from this check. Translated blocks are cached in the
`Foundry Translate — Translation Cache`
world compendium. Cache keys include source text, provider, language pair, and a
glossary fingerprint. Long HTML blocks are divided at safe text boundaries and
provider requests are size-limited. Each page commits its blocks to cache before
the next page starts, so retrying after a failure reuses completed work. If the
source changes during translation, the stale result is rejected instead of
being saved. A single full translation per source Journal and target
language is stored in `Foundry Translate — Translations`, outside the world
Journal sidebar. Opening the translated Journal provides a **Show original**
action. Its source UUID and hash allow an unchanged translation to be reused
under the same document ID. Incompatible saved copies are preserved for review.

Linked Journal Entries, Actors, and Items are translated recursively. Shared
dependencies are processed only once, cycles are handled without deadlocks, and
links in the translated copy are rewritten to stable translated compendium
UUIDs. Links to a specific Journal page preserve that page's original ID.
The world setting **Open available translations automatically** is enabled by
default: clicking any Foundry document link opens its stored target-language
copy when one exists. Disable it in Module Settings to restore Foundry's source-
document behavior. If an old link names a removed embedded page but its Journal
translation exists, the translated Journal root opens instead of a broken or
English target.
Referenced Actors are copied completely into the
`Foundry Translate — Translated Actors` world compendium with stable embedded Item IDs; only HTML fields confirmed by
the live system schema — such as Ember biography text — are translated, while
all mechanical values, identifiers, and actions stay byte-for-byte source data.
Journal `@Embed[Actor...]` references are rewritten to the translated Actor so
dynamically rendered Actor text loads in the target language. Referenced
standalone Items are copied the same way into the
`Foundry Translate — Translated Items` world compendium with only their
schema-confirmed HTML fields translated. Missing references and document types
that are not supported recursively yet remain pointed at the source and are
reported as warnings instead of failing the whole translation.

## Development

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
```

The production module is generated in `dist/`. A release tag such as `v0.9.0`
runs the checks, builds the module, packages the contents of `dist/`, and publishes
both `module.json` and `foundry-translate.zip` as GitHub Release assets.

## Share translations without an AI model

Open **Adventure translation → Share or import translations**. Export creates a
JSON file containing the glossary and text patches for the selected language.
Connection addresses, API keys, original document objects, images and executable
flags are omitted. Text patches include original strings for validation, so a
bundle can still contain adventure prose and spoilers.

The recipient installs the same adventure/system and chooses the JSON file.
A preview shows ready, existing, missing, changed and invalid documents before
any writes. Import requires a GM but no AI model or server. Existing translated
copies and local glossary decisions are preserved. Cyclic links are repaired
after all new copies exist. Export skips stale or incompatible translations and
lists reasons; it does not silently label them as current.

This first bundle format uses **exact source UUIDs and content fingerprints**.
It works with matching module/compendium IDs and matching imported worlds. It
will not guess matches by title when a recipient's world assigned different
IDs. HTML, Markdown, rolls and Foundry references are validated; only locally
allowlisted prose fields can be imported.

## Project handoff

The current technical state, verified findings, and implementation plan for
recursive translation are documented in the [project handoff](docs/project-handoff.md).
