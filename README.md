# Foundry Translate

Reliable, glossary-aware adventure translation for **Foundry Virtual Tabletop v14**.

> [!IMPORTANT]
> The module is currently an early development build. Version `0.2.0` adds the
> first Google Cloud Translation provider settings and connection test; document
> translation is not implemented yet.

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

## Google Cloud Translation setup

As Game Master open **Configure Settings → Module Settings → Foundry Translate**
and select **Configure translator**. The API key is a client-scoped setting: it
stays in the current browser and is not stored in the world or shared with players.

The connection test sends one short translation request to the official Google
Cloud Translation Basic v2 endpoint. A Google Cloud project with billing and the
Cloud Translation API enabled is required.

## Development

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
```

The production module is generated in `dist/`. A release tag such as `v0.2.0`
runs the checks, builds the module, packages the contents of `dist/`, and publishes
both `module.json` and `foundry-translate.zip` as GitHub Release assets.

## Planned functionality

- Provider API keys stored in Foundry module settings
- Exact protection of character and location names using a glossary
- Translation cache stored in a world compendium
- Detection of changed source documents and selective retranslation
- Portable export and import of translation bundles
