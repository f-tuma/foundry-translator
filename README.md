# Foundry Translate

Reliable, glossary-aware adventure translation for **Foundry Virtual Tabletop v14**.

Version **0.19.1** includes an adventure translation desk, an Ember-aware name
glossary, and portable JSON translation bundles. Translation runs locally through
Chrome or LM Studio, with Google Cloud available as an optional provider.
Generated text is structurally validated; language quality still depends on the
chosen model. The source adventure remains unchanged.

This release adds contextual Czech inflection of reviewed glossary names.
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
2. Open **Translator and language**, choose a provider, test the connection and save.
3. Open a Journal page and click **Translate this page** in its header.
4. Use **Show original** to switch back without losing the current page.

Names are synchronized automatically before translation. For a long book, use
**Translate a whole journal**; this also processes linked documents. A single-page
translation only processes that page and reuses already available linked copies.

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

**Chrome Local Translator** is the default for new worlds. It requires desktop
Chrome 138 or newer, downloads the selected language pack on first use, and then
translates on-device without an API key, character quota, or sending adventure
text to a translation service. Automatic source-language detection also runs in
the browser.

**Google Cloud Translation Basic v2** remains available as an optional provider.
Its API key is a client-scoped setting: it stays in the current browser and is not
stored in the world or shared with players.

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
first verifies the exact configured model ID. Google Cloud requires a project
with billing and the Cloud Translation API enabled.

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
This requires Czech and an OpenAI-compatible instruction model. Chrome, Google
and other target languages use the exact form; a translation-run warning explains
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
were made with, so after a glossary change a re-run updates the stored copy
instead of reusing it. Model, prompt, world-profile and source-language changes
also invalidate document reuse. Refreshing one page preserves other translated
pages but marks older glossary/model coverage as partial. If the source book
itself changed, refresh the whole book first; a page refresh will explain this
instead of replacing the other pages with English.

The glossary window also contains a review queue for suggestions learned from
manual corrections to translated Journal pages. A suggestion shows editable
source and replacement columns and must be explicitly accepted or rejected;
the module never adds it to the glossary automatically. If the source phrase
cannot be inferred safely, it is left blank and must be supplied before the
suggestion can be accepted. Newly generated Journal, Actor, and Item copies also
carry an output fingerprint. A detected correction invalidates document-level
reuse so the next run regenerates that copy; the correction itself remains
useful as a glossary suggestion after explicit review.

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

Chrome Local Translator first receives each protected logical block as a whole,
so it can use paragraph-level context across inline markup and fixed glossary
terms. The contextual result is accepted only when every structural, glossary,
and Foundry-syntax token survives byte-for-byte and in its original order. If
Chrome changes any token, the module automatically falls back to translating
isolated text fragments instead of risking damaged content.

Before the first request, the module scans the complete dependency graph
without writing anything and reports the total number of documents and
translatable parts. Progress messages therefore show both the current page and
the overall total. The **Active translations** window in the module settings
provides a global overview of every running translation with a progress bar,
totals, the current document, and an estimate of the remaining time. When a
run has issues — quality fallbacks, unresolved references, or failed
dependencies — a **Copy log** button copies a plain-text debug log with every
issue, its reason, and a source preview. A running translation can be
cancelled from the overview: it stops after the part that is currently being
translated, everything completed stays in the cache and compendia, and the
next run resumes from that point.

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
action. Its source UUID and hash allow an unchanged translation to be reused and
a changed source to update the same stored document instead of creating a
duplicate.

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

For a real Chrome Translator diagnostic against a running local Foundry, use:

```bash
npm run diagnose:chrome
```

The diagnostic launches the installed Chromium/Chrome directly and connects over
DevTools. This intentionally avoids automation defaults which disable Chromium's
component updater and can produce a false TranslateKit failure. `FOUNDRY_URL`,
`CHROMIUM_PATH`, `CHROMIUM_PROFILE`, `SOURCE_LANGUAGE`, and `TARGET_LANGUAGE` can
be overridden through environment variables.

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
