# Foundry Translate

Reliable, glossary-aware adventure translation for **Foundry Virtual Tabletop v14**.

> [!IMPORTANT]
> The module is currently an early development build. Version `0.8.4` processes
> long Journals page by page, validates and retries suspicious unchanged output,
> safely keeps an isolated failed fragment in the original, translates human text
> inside Foundry embeds, invalidates stale engine results, resumes from the server
> cache, and reports live progress.

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
can also add custom names such as factions or artifacts. Before future document
translation, exact glossary matches will be replaced by unique tokens; if a
provider loses, duplicates, or changes a token, the translation will be rejected
instead of returning a corrupted name.

## Translate a Journal Entry

As Game Master open **Configure Settings → Module Settings → Journal
translation** and select **Translate Journal Entry**. Choose one world Journal
Entry and open its stored translation. The source document is never modified.

You can also open a world Journal Entry and select **Translate this journal**
directly in its header. A visible header button and the standard header controls
menu provide the same safe translation action.

The current development build translates the journal name, page-category names,
page names, and HTML-backed pages, including custom page types used by adventure modules.
Inline markup and mechanical attributes remain local, while visible attributes
such as `alt`, `title`, and `aria-label` are translated. Foundry references such
as `@UUID[...]` and inline rolls such as `[[/r 1d20]]` are integrity-protected.
Human labels and supported `@Embed[...]` options such as `readaloud` are
translated without exposing UUIDs or configuration to the model. Markdown
source pages are deliberately left unchanged for now and reported in the
completion summary.

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

The production module is generated in `dist/`. A release tag such as `v0.8.4`
runs the checks, builds the module, packages the contents of `dist/`, and publishes
both `module.json` and `foundry-translate.zip` as GitHub Release assets.

## Planned functionality

- Portable export and import of translation bundles

## Project handoff

The current technical state, verified findings, and implementation plan for
recursive translation are documented in the [project handoff](docs/project-handoff.md).
