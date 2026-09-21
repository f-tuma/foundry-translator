# Czech interface catalogs

Foundry Translate provides Czech interface dictionaries for Foundry VTT 14.368,
Crucible 0.11.0 and Ember 0.6.2. Select **Čeština** in Foundry's language preference
and reload. The dictionaries are packaged with the module; LM Studio is not
needed to display them. The translation provider's target language is a separate
setting and does not change Foundry's interface language.

Coverage: 3,587 core strings, 1,969 Crucible strings and 503 Ember strings. This is
coverage of those versions' localization keys, not a claim that every visible
string in every module is localized. Adventure documents, hard-coded English in
upstream code and other modules' dictionaries are outside this UI catalog.

## Loading

Native manifest language files load before Foundry pre-localizes DataModel
schema labels. An `i18nInit` overlay would run too late. The Crucible dictionary
has a `system: crucible` filter; Ember has a `module: ember` filter. They therefore
do not override unrelated systems or inactive Ember installations.
`coreTranslation: true` also makes this package available as a server language
provider for Setup. English remains available in Foundry's language preference.
No source Actor, Item, Journal, system or Ember package file is modified.

For Czech Setup, select **Čeština – Foundry Translate** as the server's default
language. Foundry stores this provider as `cs.foundry-translate`. Deployments
that supply the language through an environment variable must use that value
in their server configuration too; otherwise a restart can replace the choice
made in Setup. The environment variable name depends on the deployment image.
The user's in-world **Čeština** preference is a separate setting.

## Maintenance and validation

The initial drafts were generated locally using Hy-MT2 30B-A3B APEX. Manual
corrections in `scripts/ui-czech-overrides.json` take precedence. Review covered
Ember labels and field hints, common Crucible actions, character data, status and
spell terminology, and core navigation, sharing, settings and deployment flows.
Additional corrections will still be needed in less frequently used screens.
Language quality is not guaranteed by the structural tests.

Keep downloaded English dictionaries and model checkpoints outside the repository.
Generate a draft with:

```sh
node scripts/translate-ui.mjs source-en.json draft.cs.json checkpoint.json
node scripts/apply-ui-overrides.mjs ember draft.cs.json
```

Use `core`, `crucible` or `ember` for the override catalog. `LM_STUDIO_MODEL`,
`LM_STUDIO_URL` and optional `FOUNDRY_GLOSSARY` configure the local generator.
Completed batches checkpoint after each request. Rerun after interruption, then
reapply the manual overrides. No generator process publishes or installs files.

The contracts in `tests/fixtures/ui-catalog-contracts.json` record source version,
key count and a hash of paths, placeholders, HTML, links and intentionally empty
strings. They contain no English source catalog. Recompute them against the
new **English source**, not the translated file, when updating upstream versions.
Tests reject missing keys, changed formatting and overwritten manual corrections;
the release check also verifies that each manifest language file is packaged.
Plain angle-bracket labels such as `<Unnamed Category>` are text, not HTML.

Before a release, compare numeric examples and rule conditions with their source;
verify displayed settings, a character sheet, journals and the translation desk.
Use the reviewed adventure glossary for setting names (Hlubina, Sladění), while
keeping distinct mechanical concepts distinct (e.g. item Naladění and Očarování).
