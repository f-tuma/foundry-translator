# Foundry Translate

Reliable, glossary-aware adventure translation for **Foundry Virtual Tabletop v14**.

> [!IMPORTANT]
> The module is currently an early development build. Version `0.3.2` adds a
> free on-device Chrome translator alongside Google Cloud, with explicit model
> download and readiness states; document translation is not implemented yet.

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

## Development

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
```

The production module is generated in `dist/`. A release tag such as `v0.3.2`
runs the checks, builds the module, packages the contents of `dist/`, and publishes
both `module.json` and `foundry-translate.zip` as GitHub Release assets.

## Planned functionality

- Provider API keys stored in Foundry module settings
- Exact protection of character and location names using a glossary
- Translation cache stored in a world compendium
- Detection of changed source documents and selective retranslation
- Portable export and import of translation bundles
