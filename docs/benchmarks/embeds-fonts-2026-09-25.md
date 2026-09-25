# Embedded prose and Czech font audit — 2026-09-25

## Reproduction

The production Czech Gamemaster's Guide still rendered its introductory embed
from the original Players' Guide page. Its own trailing paragraph was Czech.
The original source UUID was retained in the stored embed; the click-navigation
adapter cannot affect native embedding, which resolves a document directly.
Production was inspected through the UI only, with no reload or data changes.

In a private local copy of Ember 0.6.2 (Foundry 14.368, Crucible 0.11.0), an audit
of journal `text.content` found 52 absolute journal-page embeds:

| Referenced page type | Count |
| --- | ---: |
| Text | 14 |
| Ember location | 28 |
| Ember lore | 6 |
| Ember ancestry | 4 |

The GM guide contains 14 shared text pages plus one ancestry overview. Shared
pages include the introduction, system requirements, gameplay/UI, exploration,
maps, codex and weather. The Players' Guide embeds nine lore/ancestry pages;
28 area pages embed gazetteer locations. This is an inventory of potential
affected references, not a claim that all 52 have saved translations in production.
Actor, RollTable and relative custom embeds were not counted in this table.

## Fix and safety boundary

Version 0.29.1 resolves saved prose translations when rendering an embed inside
a translated document. It uses the existing fresh, language-aware UUID identity
resolver. Missing/ambiguous mappings, inaccessible copies, mismatched page types
and unfinished pages fall back to the original. Original views remain original.
Native embed configuration, recursion depth and explicit secret visibility are
forwarded; implicit secret visibility cannot increase.

Reviewed prose types are `text`, `ember.lore`, `ember.ancestry` and
`ember.location`. Ember 0.6.2's native embed implementations for these types
render text/overview/exposition, without initializing game registries. Event,
quest and unreviewed custom page types are excluded. The adapter neither writes
documents nor replaces global `fromUuid` or game actions.

## Fonts

FontTools cmap inspection found that Pirate Scroll lacks all Czech accented
letters; Foundry's Modesto and Amiri miss several caron/ring glyphs. Vollkorn
normal and italic cover the full lower/uppercase Czech alphabet. Both complete
variable fonts are bundled as WOFF2 with the SIL OFL license (about 350 KiB).
CSS switches complete decorative font faces, preserving text/case and icons.
The per-browser setting defaults on for Czech UI or a Czech translation target.

## Validation

- Deterministic suite: 498 passing, four opt-in tests skipped; typecheck/build and
  release metadata/assets verification pass.
- Native local Foundry: later-created translations reused on render; nested
  translated page included; incomplete embedded page falls back until processed;
  source view and stored original UUID unchanged.
- Native Ember location/lore/ancestry: all three render translated overview and
  full text, identify the saved translated page, preserve source view/data, and
  leave the serialized location/event registries unchanged (16 assertions).
- Browser inspected at 1600×1125: uppercase and mixed-case Czech specimen uses the
  bundled face; actual Ember GM headings also use it; icons retain their glyphs.
- The font preference can be disabled, and non-Czech UI/target leaves it inactive.

Synthetic test documents remain only in the private QA copy. No paid adventure
body text or world data is shipped with the patch.
