# Foundry Translate

Reliable, glossary-aware adventure translation for **Foundry Virtual Tabletop v14**.

Version **0.16.2** includes an adventure translation desk, an Ember-aware name
glossary, and portable JSON translation bundles. Translation runs locally through
Chrome or LM Studio, with Google Cloud available as an optional provider.
Generated text is structurally validated; language quality still depends on the
chosen model. The source adventure remains unchanged.

This release keeps the glossary editor live during naming: saved batches appear
without closing the window, and drafts, filters and scroll position stay in place.
Invalid individual AI proposals preserve the original name and are marked for
review, while the other names continue processing.

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

For Czech, the current tested candidate is **Tencent Hy-MT2 7B Q8_0**
(`hy-mt2-7b` in the test server). The provider automatically uses its documented
translation instruction format and sampling settings. On the test PC, one real
Ember quest overview took about 38 seconds with zero structural fallbacks. Its
Czech was better than Gemma 4 12B/E2B QAT in this sample, but still needs review.
Gemma 4 uses LM Studio's native API with reasoning disabled. These are measured
samples, not guarantees for every adventure. See the [Czech guide](docs/user-guide.cs.md).

LLM translation can use an editable world profile containing setting, genre,
tone, lore, and translation preferences. **Suggest profile from world** builds a
bounded stratified sample: it prioritizes Journal and page names associated with
setting, lore, guides, history, factions, and similar overview material, then
fills the remaining budget with random excerpts from different Journals and
random Actor, Item, and Scene names. The prompt explicitly tells the model this
is an incomplete sample and asks it to infer broad repeated patterns without
overfitting to one adventure. The GM must review the result and explicitly save
the settings. Each LLM request also receives the approved glossary as terminology
reference, while glossary and Foundry tokens remain integrity-protected. Cache
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

### Optional contextual fantasy names

The module can use a separate instruction model to decide stable
translations for newly discovered names. Short descriptions and nearby mentions
provide context. Clear descriptive names are saved automatically; uncertain
names retain their source form. Meaningful personal names, surnames and epithets
may also be localized when they sound natural and believable in the fantasy
setting. The resulting glossary choice is reused consistently. Manual edits and imported
glossaries take precedence. Ember group Actors, including caravans, are categorized
as factions so their descriptive names can be considered.

AI naming is off by default, preserving the existing translation workflow.
Under **Translator and language**, enable the AI naming policy and choose an explicit
**Glossary model** ID on the same OpenAI-compatible server. No automatic model is
selected until a candidate passes Czech naming QA. Qwen3.5 9B Q4_K_M and
Granite 4.2 8B Q4_K_S failed the
[local benchmark](docs/benchmarks/naming-2026-09-20.md).
Qwen3.8 27B Q4_K_M produced better Czech but still made errors on new names;
it is not an automatic default either. Bundled MTP improved its local generation
speed by about 1.7× in this workload.
Unit tests do not establish translation quality. The
ordinary text model can remain Hy-MT2. Chrome/Google skip AI naming, and an
unavailable model leaves pending names unchanged with a warning. Saved choices
are reused, exported with the glossary, and visible with a short reason in the
entry's info tooltip. Cancellation preserves completed batches.
Relevant established glossary choices are included in each request. The longest
matching full name takes precedence over its components. When a proposal changes
a declared opaque root or conflicts with an established name, that entry retains
its original name with a localized explanation and the other entries continue.
Malformed responses still stop the batch safely.

The module also serializes compendium folder updates and repairs existing
module packs on world startup. This avoids simultaneous pack creation undoing
another pack's folder assignment.

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
