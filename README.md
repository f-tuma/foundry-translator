# Foundry Translate

Reliable, glossary-aware adventure translation for **Foundry Virtual Tabletop v14**.

> [!IMPORTANT]
> The module is currently an early development build. Version `0.11.0` processes
> long Journals page by page, validates and retries suspicious unchanged output,
> safely keeps an isolated failed fragment in the original, translates human text
> inside Foundry embeds, recursively translates linked Journals, Actors, and
> Items, rewrites links and embeds to their stored translations, resumes from
> the server cache, and reports live progress with overall totals.

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

The provider test performs one short English-to-Czech translation. Google Cloud
requires a project with billing and the Cloud Translation API enabled.

## Protected name glossary

As Game Master open **Configure Settings → Module Settings → Name glossary** and
select **Manage glossary**. The module discovers the names of world Actors and
Scenes without modifying those documents. **Synchronize names** creates or
updates entries in the `Foundry Translate — Glossary` world compendium. Module
compendia are grouped in a gray `Foundry Translate` folder in the Compendium
sidebar.

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
instead of reusing it.

## Translate a Journal Entry

As Game Master open **Configure Settings → Module Settings → Journal
translation** and select **Translate Journal Entry**. Choose one world Journal
Entry and open its stored translation. The source document is never modified.

You can also open a world Journal Entry and select **Translate this journal**
directly in its header. A visible header button and the standard header controls
menu provide the same safe translation action. The header controls menu also
offers **Translate this page**: it translates only the currently viewed page
plus one level of referenced documents, so a single chapter of a large journal
is ready quickly. Page translations of the same journal merge into one stored
translation, and once every page has been processed the result counts as a
complete translation. Clicking the translate action of a journal that is
already being translated opens the global overview instead.

The current development build translates the journal name, page-category names,
page names, and HTML-backed pages, including custom page types used by adventure modules.
Inline markup and mechanical attributes remain local, while visible attributes
such as `alt`, `title`, and `aria-label` are translated. Foundry references such
as `@UUID[...]` and inline rolls such as `[[/r 1d20]]` are integrity-protected.
Human labels and supported `@Embed[...]` options such as `readaloud` are
translated without exposing UUIDs or configuration to the model. Markdown
source pages are deliberately left unchanged for now and reported in the
completion summary.

Before the first request, the module scans the complete dependency graph
without writing anything and reports the total number of documents and
translatable parts. Progress messages therefore show both the current page and
the overall total. The **Active translations** window in the module settings
provides a global overview of every running translation with a progress bar,
totals, the current document, and an estimate of the remaining time. When a
run has issues — quality fallbacks, unresolved references, or failed
dependencies — a **Copy log** button copies a plain-text debug log with every
issue, its reason, and a source preview.

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

## Planned functionality

- Portable export and import of translation bundles

## Project handoff

The current technical state, verified findings, and implementation plan for
recursive translation are documented in the [project handoff](docs/project-handoff.md).
