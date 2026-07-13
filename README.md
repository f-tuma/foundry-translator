# Foundry Translate

Reliable, glossary-aware adventure translation for **Foundry Virtual Tabletop v14**.

> [!IMPORTANT]
> The module is currently an early development build. Version `0.4.1` adds a
> world-compendium glossary for protected character, location, and custom names,
> organized in a dedicated Compendium folder. Document translation is not
> implemented yet.

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

## Development

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
```

The production module is generated in `dist/`. A release tag such as `v0.4.1`
runs the checks, builds the module, packages the contents of `dist/`, and publishes
both `module.json` and `foundry-translate.zip` as GitHub Release assets.

## Planned functionality

- Provider API keys stored in Foundry module settings
- Translation cache stored in a world compendium
- Detection of changed source documents and selective retranslation
- Portable export and import of translation bundles
