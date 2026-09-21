# Foundry Translate — project handoff

- Updated: 2026-09-21
- Deployed version: `v0.18.1`; PR #20 merged, GitHub release published and installed in Foundry.
- Repository: <https://github.com/f-tuma/foundry-translator>

This document provides the working context needed to continue the project from
another device or with another agent. The README remains the user-facing
documentation; this document records technical decisions, verified findings,
and the recommended implementation order.

## Current work log

- 2026-09-21, v0.18.1 deployed: PR #20 squash-merged as `7e88d72`; release
  workflow succeeded and ZIP/manifest are published. Updated the existing module
  through Foundry Setup, launched Ember and joined as Gamemaster. Live ready=true,
  module version=0.18.1, glossary count=776. Real enriched actor and item cards now
  show translated headings AND link text with original UUIDs. Translation desk
  opens normally. Browser startup was slow; paused local UI generation and
  unloaded APEX while verifying. The world subsequently loaded completely.
  No source document or glossary edits; no adventure translation run started.
  The only new console error was Foundry's warning about the automation viewport
  being 1280x720, below its recommended minimum height. Existing Crucible/Ember
  content warnings remain unrelated to this change.

  Full Czech UI is NOT in v0.18.1 and is NOT finished. Work remains in the primary
  checkout on `codex/document-names-and-czech-ui`: native manifest language entries,
  generator, format/key contracts and manual terminology overrides. 337/503 Ember
  strings had checkpointed before the pause. Generation resumed sequentially for
  Ember, Crucible and core, with the reviewed glossary and durable private
  checkpoints in the visualization `ui-localization` directory. Logs:
  /tmp/foundry-ui-ember-resume.log, /tmp/foundry-ui-crucible.log,
  /tmp/foundry-ui-core.log. Last exec session: 25998. APEX is loaded with context
  8192, parallel=1 and GPU offload=0.4. GPU 0.5 failed KV allocation while the
  user's game was running; do not close their applications. The user has a pending
  optional question about freeing GPU memory. No automatic publish/install is
  attached to the generator. Review all formatting fallback cases, semantic
  terminology and rendered UI; then run the full suite and ship the Czech UI.
  Current standard release checks passed 320 tests (3 opt-in skipped).


- 2026-09-21, current branch `codex/document-names-and-czech-ui` (not deployed):
  fixed Actor/Item, embedded item and prototype-token name translation. Canonical
  whole glossary names bypass the model. Implicit UUID/Embed labels now use
  sourceUuid glossary metadata; cache schema 9, Actor/Item revision 6 and Journal
  revision 11. Crucible 0.11 ignores explicit embed labels in its own actor/item
  renderers; a narrow DOM adapter preserves them without modifying sources or
  UUIDs. Verified real Agraband Swift actor and A Farewell Note item through
  Foundry TextEditor enrichment, with temporary wrappers restored afterwards.
  Portable bundles now carry these names and permit added plain reference labels
  while rejecting altered UUIDs/options/commands. 320 deterministic tests pass,
  three opt-in skipped; typecheck passes. UI localization is still in progress,
  so the full suite includes an unfinished catalog-coverage check and is NOT
  release-ready yet. Live instance remains v0.18.0, with no document mutations.
  User confirmed Czech for ALL Foundry + Ember UI. Private en catalogs captured:
  core 14.368 (3587 strings), Crucible 0.11.0 (1969), Ember 0.6.2 (503).
  Use native manifest language paths (system/module filters), NOT i18nInit:
  Foundry localizes schema labels before that hook. coreTranslation=true allows
  selection as server language too. Generation utility and contracts are WIP.
  LM Studio server was off; restarted via the existing Flatpak CLI on localhost
  with the previously approved CORS setting. APEX full GPU load failed because
  a game uses GPU memory. Loaded APEX at 45% GPU, 8192 context; about 6 output
  tokens/sec. User has been asked whether they can free GPU memory. CLI lives
  inside Flatpak ai.lmstudio.lm-studio at ~/.lmstudio/bin/lms; use flatpak ps to
  obtain its running instance. Do not close the user's game or other apps.
  UI generation uses flat JSON string values; nested context/text objects caused
  degenerate output and were rejected. Checkpoints remain private in /tmp.
  Review semantic quality and glossary consistency (Attunement = Sladění) before
  release; format checks alone are insufficient.


- 2026-09-21, deployment completed: PR #19 squash-merged as `4be277f`; tag and
  GitHub release v0.18.0 published successfully with ZIP and manifest. CI and
  release workflow pass. Updated Foundry through Setup, relaunched Ember and
  joined as Gamemaster. The old browser tab became unresponsive during startup;
  a fresh tab loaded normally and the user confirmed the world was available.
  Imported the jointly reviewed version-2 JSON through the glossary preview:
  0 new / 776 changed, then "Saved 776 selected entries". Read back all 776:
  every replacement, category, alias, enabled flag, mode and note matches the
  approved file; all are enabled, inflect and customized. Current compendium
  backup and readback JSON are stored privately in visualization outputs as
  glossary-before-v018-2026-09-21.json and glossary-after-v018-2026-09-21.json.
  Saved LM Studio model `hy-mt2-30b-a3b-apex` at localhost:1234/v1, English to
  Czech. Replaced the contradictory preserve-all-names world profile with
  guidance giving the reviewed glossary priority and preserving source meaning.
  The browser connection/test translation passes. Desk confirms APEX and 776
  active terms; no browser console errors after deployment. Large adventure
  translation has not been started. Known quality limits remain as documented
  in benchmarks/apex-release-2026-09-21.md (one source fallback on a 50-unit page).


- 2026-09-21, APEX release preparation: user selected APEX and accepts minor
  grammar errors; explicitly requested GitHub release, Foundry update and import
  of the jointly reviewed 776-name version-2 glossary. APEX Czech now uses
  JSON-schema constrained whole contextual units, host-side name matching and
  link restoration, conditional full-sentence repair, and visible uncached
  exact-name recovery before source fallback. Prompt revision 12; temperature 0.
  Standard checks: 307 pass, 3 opt-in skipped, typecheck/build/metadata pass.
  Final real 50-unit Ember page: 148.119 s, intact HTML/references, six exact-name
  review warnings, one source fallback; strict no-source-fallback test fails.
  Synthetic name sample 14/15 expected forms (Hlubinním instead of Hlubinným).
  These remaining language limitations do not block the user-requested release;
  do not claim perfect grammar or meaning. See benchmarks/apex-release-2026-09-21.md.
  Private backup of 776 existing live entries saved in visualization outputs as
  glossary-before-v018-2026-09-21.json. Reviewed import is the sibling task output
  ember-glosar-cs-sklonovani-2026-09-20.json (776 enabled, inflect). Never publish
  adventure exports/context in this public repository. Deployment/import status
  is recorded in the newest entry above once completed.


- 2026-09-21, whole-sentence repair: user supplied the dashboard/řídicí panel
  agreement example and installed `hy-mt2-1.8b` (Tencent Q8_0, 1.91 GB) and
  `hy-mt2-30b-a3b-apex` (alphaZimuth APEX-I-Nano, 12.45 GB / 11.59 GiB).
  Actual protected 15-case runs failed: 1.8B 6/15 expected substrings and seven
  source fallbacks (41.2 s); APEX 10/15 and five fallbacks (47.6 s including
  loading). Exact XML probes confirmed APEX sometimes deletes name elements;
  rejection is correct, so no parser guard was loosened. Production now uses
  Tencent's top_p=1 for 30B-A3B, still 0.6 for 1.8B/7B; prompt revision 11.
  Added scripts/benchmark-sentence-repair.mjs: nine synthetic cases, direct vs
  generated-draft repair vs deliberately faulty/correct supplied drafts. Baseline
  and refined source-first prompts tested on 1.8B, 7B and APEX. Czech instructions
  mostly echoed on 1.8B; English variants were used for fair comparisons. Refined
  prompt also uses temperature zero, so it is not a single-variable experiment.
  Both 7B and APEX repaired the dashboard, gender/plural agreement and (after
  refinement) reversed ownership; Permoníci, some prepositions and UUID labels
  remain wrong. Second passes sometimes worsen already reasonable text. Refined
  repair median about 0.27–0.29 s on 7B, 0.39 s on APEX; these are short warm
  requests, not equivalent to protected full-pipeline throughput. Small 1.8B often
  violates terminology/EXACT and is not selected. Keep 7B baseline and APEX for
  comparison; automatic post-editing is NOT enabled. Details and raw evidence:
  docs/benchmarks/sentence-repair-2026-09-21.md. Unit checks: 290 pass, two opt-in
  tests skipped; typecheck, build and metadata pass. No live-world changes or
  release. PR #19 draft and all-inflect import still require language validation.

- 2026-09-21, MiLMMT follow-up: user installed MiLMMT-46-12B-v1.0-GGUF and
  prefers a smaller model over a slow large one. LM Studio offers
  `milmmt-46-12b-v1.0`, mradermacher Q4_K_S, 7,789,533,216 bytes, loaded context
  8,192. Tested documented raw `/v1/completions` prompt and a chat comparison.
  Four warm plain paragraphs took 2.81 s, four with terminology 2.78 s, but
  terminology was ignored (Duchovním bestiím, Delverů, Karintu, von Tetem) and a
  UUID label became a formatting escape. Eight additional glossary formats
  (XML, mixed-language, HTML, few-shot and ASCII tokens) did not fix reliability.
  This is not a timing comparison at equal functionality to the protected
  production pipeline. See docs/benchmarks/milmmt-2026-09-21.md and its raw
  evidence; rerun paragraphs with node scripts/benchmark-milmmt.mjs. Script
  syntax check and all eight requests completed. No production changes or
  live Foundry mutations. Keep Hy-MT2 7B as the smaller-model baseline, PR #19
  draft, and larger model downloads optional. Do not automatically select
  MiLMMT or describe ordinary-prose quality as a glossary success.

- 2026-09-21, follow-up: the user requested continued improvement and a fresh
  model review. See docs/benchmarks/local-models-2026-09-21.md (primary sources).
  Requested Google Gemma 4 26B-A4B QAT Q4_0, main file 14.4 GB, for the next
  comparison. It was not yet in GET /v1/models at the last check. Other verified
  candidates are Tencent Hy-MT2 30B-A3B Q4_K_M (18.2 GB) and Xiaomi MiLMMT-46-12B
  v1.0 (August release). Qwen3.8-LiveTranslate is a speech API, not a verified
  local GGUF replacement. Host GPU was rechecked: RTX 5070 Ti, 16,303 MiB.
  Diagnostic controls showed ASCII markers/mixed-language source worsened some
  sentences. Added an XML wire adapter for Czech inflection: original source
  names and only current terminology are sent, with short name/item/segment/keep
  IDs. All original FT tokens are reconstructed and validated as before. XML IDs,
  hierarchy and opaque/segment order must match; whole name phrases can move
  within one plain container with no opaque syntax, which permits natural Czech
  word order without moving link labels. Malformed XML retries via existing batch
  splitting and unit fallback. Added request occurrence metadata including exact
  source aliases on the initial, retry and separate-segment paths. Cache schema 8,
  prompt revision 10. Also fixed a guard bug: valid feminine dative plural -ám
  (Přízračným Šelmám) was missing from allowed endings. No glossary choices changed.
  Small production tests improved specific errors: Hy-MT2 now translated the
  Spirit Beasts sentence correctly; Qwen produced correct Permoníkům. Hy-MT2
  scored 13–14/15 expected substrings over XML iterations, Qwen 14/15 in its
  XML probe. Counts are not full grammar scores; short-sentence language checks
  still fail. Four full Hy-MT2 paragraphs passed structural checks after fixing
  overly strict name order, with remaining Czech preposition/tense issues.
  Qwen's four paragraphs also passed structural checks (36.3 s), but repeated
  reversed ownership (Stopám patří Přízračné Šelmy) and wrong Permonícům.
  See docs/benchmarks/inflection-xml-2026-09-21.md for raw evidence and limitations.
  Unit suite: 288 passing, two opt-in model tests skipped; typecheck/build passed.
  PR #19 stays draft. No deployment or live-world import/settings changes.

- 2026-09-21: LM Studio is now available. Completed real production-pipeline
  checks on Hy-MT2 Q8_0 and Qwen3.8-27B Q4_K_M with MTP enabled on Qwen's
  loaded instance. CORS preflight from the Ember origin returned HTTP 200.
  The opt-in Node integration test needed an injected native fetch with a
  120-second timeout (Foundry fetchWithTimeout is unavailable in Node).
  Hy-MT2 changed a standalone title to genitive; fixed by making a whole unit
  consisting only of one glossary name opaque/canonical, including link labels.
  Sentence context across HTML segments remains inflectable. Cache schema is 7.
  Qwen's default xhigh reasoning timed out after 120 seconds; it now uses the
  existing LM Studio native path with reasoning off (prompt revision 9).
  Both fixes have regression tests. Structural checks passed in completed model
  runs, but language quality did NOT: Hy-MT2 produced Permonícům and Stopy patří
  k Přízračné Šelmy; Qwen produced Permonícům and reversed ownership in the
  Spirit Beasts sentence. A more explicit prompt failed to improve Qwen and
  worsened Hy-MT2, so it was discarded. The expanded 15-case Hy-MT2 run matched
  13 expected name forms, but surrounding Czech also has preposition errors.
  One test oracle was corrected: Hlubinní Trpaslíci → Hlubinným Trpaslíkům,
  not Hlubinním. The captured model answer was already correct for this case.
  See docs/benchmarks/inflection-2026-09-21.md and its captured JSON reports.
  The draft PR #19 remains open. Do not describe 0.18.0 as ready for release:
  real grammar checks fail even though unit tests and marker guards pass.
  No live Foundry settings, glossary, installation or import were changed.
  Next work should improve the inflection strategy, not weaken assertions or
  add special-case replacements for benchmark names. The prepared all-inflect
  776-name import remains a draft artifact until this is resolved.

- 2026-09-20: user requested grammatical inflection before importing the reviewed
  Ember glossary. Added `mode: fixed | inflect` (missing = fixed); `enabled=false`
  still means the entry is ignored. The editor now offers three named choices,
  with explanations behind an info icon. Mode is persisted in compendium flags,
  sync, stale-write fingerprints, import previews, CSV/JSON and adventure bundles.
  Files/bundles with inflection use format version 2 so old releases reject them
  rather than silently ignoring the behavior. Legacy version-1 JSON/CSV is accepted.
  Czech OpenAI-compatible providers receive the chosen Czech name between paired
  FTG markers and may change its case endings. Each occurrence is checked for
  marker integrity, word count, punctuation and bounded Czech suffix/stem changes.
  Capitalization follows the glossary, including internal apostrophes. This is a
  conservative guard, not a full morphology analyser; irregular forms may fail
  and grammar still depends on the model. Existing retries and visible source
  fallbacks apply, and failed results are not cached. Chrome/Google/non-Czech use
  exact forms with a run warning. Mode and prompt revisions invalidate caches.
  Local CUA QA at 760/360 px: select/save inflection, select/save disabled, import
  preview, explicit overwrite, immediate editor update and idempotent reimport
  passed. The real 776-entry prepared import was also saved in the local mock
  compendium and returned 776 unchanged entries; no console warnings/errors.
  The live Foundry world and its glossary were not modified. Source exports and
  the reviewed import stay outside the repository in the conversation directory.
  JSON/CSV imports now enable all 776 reviewed names with `mode=inflect`, including
  the 120 originally disabled terms, preserving all 522 chosen translations.
  Actual local-model validation is still pending: localhost:1234 refused the
  connection, including outside the sandbox. The user was asked to start LM Studio.
  Run `LM_STUDIO_MODEL=hy-mt2-7b npm test -- tests/local-inflection.integration.test.ts`
  (or the exact available model ID). `LM_STUDIO_RESULT=/tmp/result.json` records
  ten real contextual examples through the production pipeline. This opt-in test
  is skipped in normal CI. Do not report its language-quality checks as passed
  until a real server run completes. Release/install have not been performed.

- 2026-09-20: v0.17.0 follows the user's explicit switch to human-reviewed names.
  Removed the naming-model client, prompts, settings UI/registration and benchmark
  runner. Saved legacy decisions are retained and marked for review; no migration
  rewrites replacements. Ordinary prose translation providers remain available.
  Glossary → Export / import provides standalone JSON and UTF-8 CSV with optional
  bounded context, category/aliases/enabled state and persistent editorial notes.
  Import previews old/new values, selects only new rows initially, and requires
  explicit selection of updates (including approval of an unchanged unreviewed
  name). Blank replacements preserve originals; omitted entries are not deleted.
  It rejects duplicate source keys, conflicting aliases, mismatched languages,
  malformed files and stale selected rows before writing. CSV quotes/newlines,
  semicolon separators and spreadsheet-formula escaping round-trip correctly.
  Context and internal IDs/provenance are excluded from imported fields. Existing
  world IDs/source links are retained when updating. Writes are serialized and
  rechecked inside the local client's write queue; this is not a multi-client
  server transaction. JSON from legacy adventure bundles is accepted for its
  glossary; the separate adventure bundle importer still preserves local choices.
  The active glossary refreshes through its existing live feed. Drafts block
  file operations until saved, and file selection errors discard any older
  actionable preview. Help text stays behind info icons.
  Local CUA QA used the real editor, file controller, parser, repository and
  compendium read/write adapter with synthetic records. CSV upload preview,
  explicit overwrite selection, save, immediate editor refresh, unchanged-row
  detection, search and invalid-file rejection passed. Actual CSV and JSON
  downloads were parsed on disk and verified for notes/context and chosen names.
  Windows at 760/360 px rendered without horizontal overflow; no relevant console
  errors or framework overlays. A fixture import typo was fixed before UI testing.
  One CUA file chooser wait was invalidated by Vite reloading during edits; the
  chooser flow succeeded again after reacquiring the tab. No external browser
  process or script injection was used. No world glossary changes were made in
  these tests. PR #18 merged as `44b7727`; v0.17.0 is published and installed in
  Foundry 14.368. All 235 tests, typecheck, build, metadata checks, PR/main CI and
  release workflow passed. Downloaded release manifest and ZIP matched source,
  including the versioned stylesheet. Before updating, the live progress window
  confirmed no translation was running. Ember restarted and GM login succeeded.
  Live QA followed Journal Notes → Adventure translation → Names and terminology
  → Export / import. The UI renders correctly at 1855×1256 and loads the versioned
  0.17.0 JS/CSS. No new module errors were captured. No glossary sync or import
  was run in the live world; its previously empty glossary remains empty.
  The glossary file window is left open for the user. The local QA tab/server
  are closed, and byte-verified synthetic downloads were removed from Downloads
  (copies remain under `/tmp/ft-manual-glossary-qa`).

- 2026-09-20: v0.16.2 fixes the user's live glossary failure. Browser console
  reported `Invalid name decision fields`; LM Studio's server log at 16:02:12
  showed a capitalized source root paired with a lowercase model root. The
  original response was replayed locally. The committed fixture in
  `tests/fixtures/naming-invalid-root.cs.json` uses synthetic names and reasons;
  it reproduces the same case mismatch without publishing the private response.
  Valid IDs with invalid per-name fields now produce a stable original-name
  fallback marked for review; malformed JSON or missing/duplicate IDs still
  reject the batch. The latter has a specific visible status instead of advice
  to check a working connection.
  A shared live feed publishes discovery and each saved naming batch, including
  preparation started by journal translation. The glossary patches changed
  rows without replacing drafts/focused inputs, filters, expanded details or
  scroll. Writes are serialized and AI decisions recheck the latest entry inside
  the write queue, so manual edits win. Review and translated-name filters help
  inspect results before the whole run finishes. Status survives rerender; closing
  a window unsubscribes its listener. This is client-local coordination, not a
  server transaction across multiple independent GM browsers.
  Local CUA QA used the real controller/view and a naming-response replay with a
  mocked repository, not the live world: 760/360 px window widths, draft preserved
  across batch arrival, manual save while running, next-batch insertion and review
  filter all passed. The 360 px window had no horizontal overflow. An initial QA
  harness module-identity mistake was fixed; no new console errors followed.
  PR #17 merged as `7a731f8`; v0.16.2 was published and installed through
  Foundry Setup. All 240 tests, typecheck, build, release metadata checks,
  PR/main CI and release workflow passed. Downloaded release assets matched
  the source manifest; the ZIP contained the expected versioned JS and CSS.
  Live Ember smoke testing followed Journal Notes → Adventure translation →
  Names and terminology. The new AI naming filter switched to `needs review`
  and back to `All names`; layout and help icons rendered correctly at
  1855×1256. The live DOM loaded `foundry-translate-0.16.2.js` and imported
  `styles/foundry-translate-0.16.2.css`. No new module errors or warnings were
  captured; old 0.16.1 failures remain in browser history, alongside unrelated
  Crucible/Ember startup warnings. The glossary was already empty before the
  update and remains empty; no bulk sync/translation was started and no saved
  decisions were restored or recreated. The glossary window is left open for
  the user. Ongoing batch behavior was verified in the local real-code replay,
  not by starting a long live world run.


- 2026-09-20: the user authorized release and installation of the current work.
  PR #15 merged as `a63b5d6`; v0.16.0 was published and installed through Foundry
  Setup. Both PR/main CI and the release workflow passed; 231 tests, typecheck,
  build and metadata checks passed. Downloaded release hashes matched GitHub,
  and ZIP contents matched the source manifest. Ember started and GM login,
  Journal Notes → Adventure translation → Translator and language all worked.
  The browser loaded the versioned 0.16.0 script and preserved Hy-MT2 settings.
  AI naming is now explicitly opt-in (off by
  default), so upgrading an existing world without a naming-model selection
  preserves its prior workflow without a missing-model warning. The separate
  naming model still requires an explicit choice. The release includes the
  tested UI and compendium fixes and optional fantasy-name localization.
  The earlier no-instance-change restriction is superseded by this deployment
  request; ordinary translation runs still require their own task scope.

  Live visual QA caught stale cached CSS at the unversioned module stylesheet
  URL: the browser's imported sheet had no `.ft-help-*` rules, so new help icons
  appeared as full buttons below labels. v0.16.1 emits a versioned
  stylesheet and verifies that the packaged CSS matches its source. Keep the
  stable public CSS file for source/fixture use. The browser will request a new
  URL on each release, matching the existing JS versioning strategy.

  PR #16 merged as `fce3fb4`; v0.16.1 is published and installed in Foundry
  14.368. PR/main CI and release workflow passed; the downloaded ZIP contains
  the exact source CSS at the versioned manifest path. The same in-app browser
  session loaded `foundry-translate-0.16.1.js` and
  `styles/foundry-translate-0.16.1.css` without clearing cache. Live QA at
  1855×1256 followed Journal Notes → Adventure translation → Translator and
  language. Help icons are 24×24 px inline with labels; the naming help renders
  its full explanation, and Escape leaves the tooltip hidden (opacity 0).
  No console errors or module warnings were captured; unrelated Crucible/Ember
  content warnings appeared on startup. No bulk translation or glossary sync
  was started, and no provider/world settings were saved. The settings window
  remains open for the user; Hy-MT2 and Czech target settings are preserved,
  AI naming is off and the glossary model field is empty. Live validation used
  the available CUA browser API; no separate browser process or injected code.

- 2026-09-20 development branch `codex/ui-alignment-help` (included in v0.16.0):
  added AI naming during glossary sync, saved in batches of eight with progress,
  cancellation/resume and protection against manual edits made during inference.
  Only new, enabled, uncustomized, discovered names are analyzed. Opaque roots
  must survive exactly unless an established glossary choice supplies their
  canonical translation; uncertain decisions retain source form. Meaningful
  character names can also translate under the user's latest policy below.
  Existing manual/imported choices win, and portable bundles contain the
  chosen replacements without AI provenance or context. Source documents stay
  untouched. Ember Actor `group` is a faction (the actual Strayhearth Caravan is
  `Actor.emberStrayhearth`, not a Journal page).
  Context uses bounded public descriptions and nearby mentions from loaded world
  documents. LM Studio native requests disable reasoning and chat persistence;
  other servers can use structured Chat Completions. A model ID must currently
  be selected explicitly; the unvalidated Qwen automatic default was removed.
  Missing/invalid model output stops AI naming safely and warns, while translation
  can continue with the original names. Completed batches are not re-requested.
  The user chose automatic saving with ambiguous names preserved.

  Language QA remains pending: Gemma 4 12B generated incorrect Czech names even
  with high confidence (Stará Carinth, Karavana Bloudomá); E2B returned incomplete
  JSON. Gemma decomposition plus Hy-MT produced unnatural word order. Gemma
  reasoning-on spent 6,000 tokens repeating text without a final answer. These
  approaches are not selected automatically. Qwen3.5-9B Q4_K_M is now available
  and failed local naming QA: only 1/6 production batches passed validation, and
  accepted output still had Czech semantic/grammar errors. Supported vendor
  nonthinking parameters did not fix those errors (1/3 batches accepted).
  A thinking-mode trial used all 6,144 output tokens without a final message.
  Granite 4.2 8B is now downloaded as Q4_K_S (not the initially discussed
  Q4_K_M). It failed naming QA: 0/6 baseline batches, 2/6 IBM-sampling batches
  accepted, with severe Czech errors even in accepted output. Low-effort
  reasoning returned a final answer but did not fix meaning or root preservation.
  Short single-name prompts and English-only decomposition also failed.
  Hy-MT's single-name Czech was better but translated personal/opaque names;
  Qwen's English-only root extractor preserved the test fixture's protected
  names but overprotected clear descriptions. These are separate probes, not a
  validated combined pipeline. No default or live settings were changed. See
  [benchmark notes](benchmarks/naming-2026-09-20.md) and the repeatable
  `npm run benchmark:naming` script. Old Carinth and Strayhearth are
  user-preferred few-shot examples, not held-out evidence.

  Qwen3.8's main model is now available: `qwen/qwen3.8-27b`, curated Q4_K_M,
  17,742,040,464 bytes, 27B. This is different from the initially linked ggml-org
  ~19 GB file. The two `Mtp Qwen3.8 27B` files are separate 3.0B helpers and were
  not loaded. The curated main model's bundled MTP is enabled. Matched original
  prompts measured median 11.39 tok/s with MTP versus 6.73 without (about 1.7×).
  Context is 8,192, parallel slots 4, Flash Attention and GPU KV cache enabled.
  The model was left loaded with MTP on; no persistent global preset was changed.
  The REST load API accepted `speculative_draft_mtp` and the effective config
  was read back to verify it. Published npm SDK 1.5.0 lacks that option.

  Qwen3.8 has better Czech, but remains unvalidated for unattended naming:
  original prompt 3/6 batches accepted; shorter-reason prompt 4/6 under the old
  strict parser. The new 16-name fixture exposed "Prasklý Sluneční Hodiny" and
  "Lévna Rook". Do not equate parser acceptance or repeated identical outputs
  with language quality. The new parser retains the complete source name when
  the model changes a declared protected root, records a localized protection
  explanation, and continues with other names instead of aborting the batch.
  Malformed IDs/fields/JSON still fail closed. Saved fallbacks are stable.

  Latest user clarification (2026-09-20): **personal names may translate too**.
  The priority is consistent, believable fantasy naming, not preserving English
  spellings. Meaningful surnames and epithets may localize; opaque/ambiguous names
  stay original. The temporary character inference bypass was removed before
  committing. Related saved glossary choices are sent as bounded reference data
  (32 names / 4,000 characters), refreshed before every batch. A matching full
  name overrides its components, and a proposal that conflicts with a supplied
  canonical name falls back to the original. Manual/imported choices still win.
  The new `naming-fantasy-personal.cs.json` fixture exercises this policy and a
  pre-established translated name. Earlier benchmark reports used the older
  personal-name policy and must be interpreted in that context.
  Two live batches returned stable Agraband Rychlý, Tamsin Popelavá and the
  pre-established Kapitán Orren Bouřný, but also an incorrect Reed → Rostová
  etymology. A single low-reasoning trial timed out after 180 seconds with no
  received final response; no quality score was assigned. Qwen was reloaded
  with MTP on afterward. No automatic model default is enabled.

  Compendium folder root cause was confirmed by read-only inspection of Foundry
  14.368: setFolder -> configure rewrites the full core.compendiumConfiguration
  snapshot. Concurrent moves lose another pack's assignment. All module moves
  now use one queue, folder creation shares one promise, and ready repairs the
  five existing module packs only. Regression tests simulate the shared-setting
  race, failed move recovery and duplicate folder creation. This is client-local
  serialization, not a server transaction across independent GM browsers.

  Final local validation: TypeScript, 230 tests across 39 files, production build.
  New tests cover stable decisions, malformed output, modified roots, context
  bounds, concurrent sync, interrupted batches, manual edits and reclassification.
  Local controller QA also exercised sync → rerender → cancel → enabled sync
  button, using actual controller code with a mocked repository. AI provenance
  and its info tooltip rendered at 360 px without horizontal overflow.
  The live Ember world was read only, with no reload, injection or installation.
  At inspection it contained only the empty Glossary pack in the module folder;
  don't recreate the user's deleted test output. Prior no-instance-change request
  remained in force during that QA; it is superseded by the release request above.

- 2026-09-20 local UI polish (included in v0.16.0): aligned and centered active-run
  actions, removed Copy log's extra top margin, made long titles wrap, matched
  glossary select/input heights, and made narrow layouts respond to the Foundry
  window width. Longer explanations now live behind native Foundry info
  tooltips, with focus/tap/Escape support and accessible descriptions. Costs,
  import warnings, progress and whole-journal scope stay visible.
  Local fixture QA used the actual view renderers/CSS with a simulated Foundry
  shell/tooltip host at localhost:4174; six surfaces passed at 720 and 360 px,
  and 480 px active-run actions had equal 38 px height and identical Y positions.
  Hover, Tab focus and Escape were exercised; no console errors. The live Ember
  page was not modified or reloaded. TypeScript, 203 tests and build passed.

- 2026-09-20: v0.15.2 adds the requested Adventure translation button under the
  left Journal Notes scene controls using Foundry v14's `getSceneControlButtons`
  hook. It is GM-only, uses the existing localized title/language icon and opens
  the same desk without changing the active note tool. Live click/repeated-click
  QA passed in the user's current `ember` world at 1855×1256; this is a different
  world from the earlier `bublina-ember` tests and currently has default provider
  settings and no translation packs. Do not overwrite those settings based on
  the old world's configuration. TypeScript, 203 tests, build and release
  metadata validation passed.
  PR #14 merged as `ca9b38b`, and v0.15.2 is published with both assets. Live
  installation was confirmed by the user, who tested the new button. The QA
  server was stopped.

- Deployment completed: PR #13 merged as `5a8e0a2`, tag `v0.15.1` published
  successfully by GitHub Actions, and Foundry Setup updated the installed module.
  After restarting the world, the loaded module/API both report 0.15.1 and ready,
  with no injected development module. The desk shows Hy-MT2 and 660 active
  glossary entries; the connection test passes. The temporary QA server is off.
  Final screenshot caught stale pre-update CSS in the browser cache. A reload
  with `ignoreCache: true` loaded the actual desk grid/cards and restored the
  expected desktop layout. The user guide documents hard refresh recovery;
  versioned stylesheet filenames are a useful future packaging improvement.

- 2026-09-20 post-install QA: PR #12 was merged, v0.15.0 released successfully
  and installed through Foundry Setup. User signed back in as Gamemaster.
  The installed API reports 0.15.0/ready without development injection; the
  saved Hy-MT2 connection test passed. Glossary synchronization stored 779
  entries (659 enabled, 120 common creatures left for automatic translation).
  Isota, a prose-only character, was subsequently added manually (780/660).
- A real header-button translation of `Myths & Legends` → `The Knight & The
  Dragon` exposed two bugs, fixed in the 0.15.1 patch: Foundry syntax tokens
  blocked glossary word boundaries around link labels, and repeated partial
  refreshes could erase old pages whose freshness coverage had expired.
  Syntax tokens now stay opaque while separating glossary words; partial
  merges retain every unselected stored page independently of freshness.
  Unit-cache and Journal/Actor/Item engine revisions invalidate buggy output.
- Verified the patch with Hy-MT2 on the same actual page (27.217 s, then
  25.908 s after adding Isota, one page/document and zero new fallbacks).
  Tayan/Kelmezian/Cascilian/Lumek/Ordani stayed exact inside links, and Isota
  was no longer inflected after manual protection. The three older page
  translations temporarily reset by the first failing test were restored
  from the captured pre-test snapshot. A further refresh preserved their
  names, text and system fields; only Foundry `_stats` changed. The source
  document remained byte-for-byte unchanged throughout. Model grammar and
  invented expansion of the era abbreviation AS remain quality limitations.
  Patch checks: TypeScript, 203 tests, production build and release validation.

- 2026-09-20: `v0.15.0` adds a Journal-sidebar translation desk, glossary
  categories/aliases/opt-out, automatic pre-translation name synchronization,
  and portable JSON bundles with a read-only import preview. Ember semantic
  page types supply places, factions, deities, cultures and lore; explicit
  creature templates are unprotected terms. Manual choices always win. Unknown
  Actor names stay protected conservatively; unique item names and prose-only
  entities still require review. Schema-backed HTML plus reviewed subtitles and
  event outcome labels translate; identifiers and mechanics do not.
- One-page jobs now have dependency depth zero, relink to available translated
  copies, retain the active page on original/translation switching, and preserve
  other translated pages on a glossary/model refresh. Changed source books need
  a whole-book refresh. Coverage is invalidated by model/profile/source-language
  fingerprints as well as engine/glossary changes. Checkpoint merging uses the
  initial stored snapshot so live document updates cannot double-count pages.
- Bundle v1 exports allowlisted text patches, original field values for validation,
  canonical source fingerprints and the glossary; no connection credentials or
  executable document flags. Imports require matching system/UUID/content, keep
  existing translations/local glossary choices, validate markup/rolls/references,
  and repair cycles after creating copies. Embedded export fields match by ID,
  not collection order. Preview is read-only and import rechecks before writing.
- Live QA: Foundry 14.368, Crucible 0.11.0, Ember 0.6.2 at ember.frgtn.cz. New
  dialogs were injected temporarily from localhost during development; this is
  not a persistent server installation. LM Studio CORS now works and the saved
  connection uses localhost. Source adventure data was unchanged by model tests.
  Existing data export produced 190 portable documents and 582 skips (574 changed
  source, 7 missing source, 1 changed Foundry reference). Do not bypass those checks.
- Model QA: Gemma 4 12B QAT synthetic scene 6.584 s, E2B 4.475 s, one request
  and zero structural fallbacks each after disabling native LM Studio reasoning.
  The real Diplomatic Impunity overview exposed poor Czech despite Gemma's zero
  structural fallbacks (37.207 s). E2B was worse. Structural success is not a
  language-quality score. Hy-MT2 7B Q8 was subsequently downloaded for comparison;
  the generic instruction path took 144.587 s with one original-text fallback.
  The dedicated documented Hy-MT prompt/sampling adapter completed the same
  page in 38.172 s, 3 requests, no reasoning tokens, zero structural fallbacks
  and an unchanged source. Czech was better but still contained grammatical
  and lexical errors; names absent from the glossary were not consistently
  preserved. Model quality and prose-only name discovery remain open work.
- Final local checks: `npm run check` passed TypeScript, 199 tests in 36 files
  and the 227 kB production build; `npm run release:verify` passed. Browser QA
  covered Journal sidebar → desk, settings test/save → refreshed model summary,
  glossary search/category/details, existing-copy import preview (disabled write),
  invalid JSON rejection, and desktop/1024×768 layout. Import writes/cyclic links
  were exercised in isolated repository tests, not against production adventure
  documents. UI navigation and read-only previews did not rewrite translations.
- Official model references checked on 2026-09-20:
  <https://huggingface.co/tencent/Hy-MT2-7B-GGUF>,
  <https://lmstudio.ai/models/google/gemma-4-12b-qat>,
  <https://lmstudio.ai/models/google/gemma-4-e2b-qat>.
- Chrome Translator was detected in the in-app browser but its en→cs model
  download failed. Do not claim it works in this browser from API availability
  alone. Console warnings from existing Crucible Actor actions/gear were present
  while loading old compendia; distinguish them from module regressions.


- 2026-07-17: Patch `v0.14.12` keeps the active-translations window within the
  viewport using a scrollable history that preserves its position during live
  metric refreshes. Finished runs can be removed individually or cleared in
  bulk, while running jobs cannot be deleted. Reopened source or translated
  Journal sheets now reconnect to the live run by source UUID and expose the
  active overview instead of offering a duplicate translation action.

- 2026-07-17: Patch `v0.14.11` adds a write-light repair preflight after the
  dependency scan and before provider translation. Existing translated
  Journals, Actors, and Items are immediately relinked to already available
  translated dependencies. Known-stale embedded page UUIDs are validated and
  fall back to the translated root when the page no longer exists. Generated
  link-only repairs refresh output hashes, while documents with earlier manual
  edits retain their old hash so the normal glossary/regeneration path still
  detects those edits. A one-page translation now treats already translated
  direct dependencies as complete instead of retranslating their entire
  Journals. OpenAI-compatible requests no longer repeat the glossary because
  matching terms are already protected and restored deterministically, and a
  recursively malformed batch can reduce the remembered batch size only once
  per top-level request instead of poisoning the rest of a long run down to
  one text per request. LM Studio native requests now use the documented
  `system_prompt` field instead of placing instructions and source in one user
  input. Prompt-leak and expanded meta-commentary detection fails closed to the
  original fragment, contaminated stored translations are excluded from the
  preflight, and Journal/Actor/Item engine revisions were raised to invalidate
  output created by the unsafe prompt layout. Journal sheets now expose a
  separate always-visible `Translate this page` button because Ember's v14
  sheet does not render the contributed header-controls menu; whole-Journal
  translation has an explicit large-recursive-run confirmation.
- 2026-07-17: Patch `v0.14.10` limits automatic translated-link interception
  to Journal, Actor, and Item UUIDs. Folder and other unsupported sidebar UUIDs
  remain entirely under Foundry's native click handling, so a folder click
  expands or collapses it instead of opening the folder configuration sheet.
- 2026-07-16: Patch `v0.14.9` makes reliable translated Journal navigation the
  primary behavior. Manual edits no longer block a refresh: they still feed
  glossary candidates, but a rerun regenerates edited output. Journal engine
  revision 7 invalidates the incorrectly preserved `v0.14.8` root documents
  while retaining segment cache reuse. Embedded UUID resolution falls back to
  a valid root document and preserves the page/item suffix during rewriting.
  A world-level `Open available translations automatically` setting (enabled
  by default) intercepts Foundry document links and opens the stored target-
  language Journal, Actor, or Item; stale embedded-page links fall back to the
  translated root instead of the English document.
- 2026-07-16: Patch `v0.14.8` makes translated-output fingerprints stable
  across Foundry save/load field ordering. Existing manually edited Journals,
  Actors, and Items are now preserved as non-fatal reused documents instead of
  failing a long recursive run; active edits made between live checkpoints
  still stop that document before it can be overwritten. Copied run logs add
  an issue-type summary and cap verbose details at the first 50 entries.
- 2026-07-16: Patch `v0.14.7` persists a valid partial Journal translation
  after every completed page batch. Stored checkpoints merge with pages from
  earlier partial runs, preserve processed page IDs and counters, verify that
  the source is unchanged, and stop before overwriting edits made to the live
  translation between checkpoints. The active-translations overview exposes
  the root checkpoint through an `Open live translation` action, allowing a GM
  to read the translated pages while the remaining Journal continues.
- 2026-07-15: A real `v0.14.5` run exposed seven malformed Gemma batches,
  95 texts sent through sequential fallback, and a foreign protection token
  that failed a four-page dependency window. Patch `v0.14.6` recursively
  bisects malformed LLM batches, remembers the smaller successful batch size
  for the rest of the provider session, and validates foreign FT tokens at the
  individual segment boundary so only that segment is retried or restored.
  Completed runs with dependency issues are now labelled `done-with-issues`
  instead of plain `done` in the overview and copied log.
- 2026-07-15: Patch `v0.14.3` batches up to four Actor/embedded
  Item or standalone Item HTML fields per OpenAI-compatible request and folds
  Journal metadata into the first multi-page LLM window. A fresh three-page
  Foundry QA Journal required one LM Studio request for 500 input and 359 output
  tokens, down from two requests after the first page-batching pass. LM Studio's
  native `/api/v1/chat` path now consumes official SSE streaming events, exposes
  a sanitized live model-output preview while a request is active, and retains
  the authoritative final usage and token-speed statistics from `chat.end`.
  JSON responses remain supported as a compatibility fallback. Validation
  passes with **147 tests across 31 files**; real LM Studio responses confirmed
  `text/event-stream`, one-request multi-page translation, and intact final
  metrics. Temporary QA documents were removed.
- 2026-07-15: A real `v0.14.2` partial translation log for the selected
  Gamemaster's Guide page exposed a failed 33-page `Players' Guide` dependency:
  76 provider requests consumed 229,336 input and 47,482 output tokens, but the
  copied issue discarded the original nested error. `v0.14.4` now carries the
  exact dependency exception into the active-translations issue/log and records
  malformed LLM batches, texts sent through sequential fallback, response
  retries, and native LM Studio API fallbacks. These counters are visible in
  the overview and copied log, so another attempt can distinguish delimiter
  damage from empty/truncated generation without relying on request count alone.
- 2026-07-15: The `v0.14.5` LLM progress UI no longer renders the rapidly
  changing tail of the streamed model response. SSE still supplies progress
  and final usage metrics, but the overview now shows a stable generation
  status with the received character count and refreshes on its one-second
  ticker instead of re-rendering for every stream chunk.
- 2026-07-15: Stored partial Journal translations now expose the same
  `Translate this page` header action as their source Journal. Because partial
  copies preserve source page IDs, the action resolves the source document
  from the translation flag and merges the selected page back into the stored
  translation without requiring the GM to switch to the original first.

- 2026-07-15: Patch `v0.14.2` fixes smart-glossary candidate suffix duplication
  and avoids repeated failed whole-block attempts in Chrome Local Translator.
  OpenAI-compatible translation now sends true protected multi-item batches,
  falls back safely when a model damages batch delimiters, shares identical
  in-flight units between concurrent runs, and groups up to four Journal pages
  into one LLM request window. Real Foundry QA against LM Studio with
  `google/gemma-4-12b-qat` translated a three-page Journal in two LLM requests;
  final validation passed with **144 tests across 31 files**.

- 2026-07-15: The repository was verified clean at `v0.13.0`; the older handoff
  header and Item-recursion roadmap text were stale. Development after the
  release started with Markdown pages, glossary editing, and glossary-token
  spacing reliability.
- 2026-07-15: Markdown-backed Journal pages are now translated conservatively.
  Visible Markdown text is planned separately from syntax; frontmatter, fenced
  and inline code, URL/link destinations, reference definitions, table
  delimiters, escapes, and structural markers remain byte-for-byte source data.
  Foundry expressions still go through the existing integrity protection. Both
  `text.markdown` and stored rendered `text.content` are translated because
  Foundry v14 stores both and does not expose a supported public converter for
  use during compendium creation. Journal engine revision is now 6.
- 2026-07-15: Glossary management gained a two-column editor showing source
  terms and editable fixed translations, including bulk saving. Token restoration
  now repairs missing word boundaries when a provider glues a word to a glossary
  token; Chrome Local Translator additionally preserves source whitespace around
  all protection tokens before and after each local translation call.
- 2026-07-15: The first **smart glossary** slice is implemented. Newly generated
  Journal, Actor, and standalone Item copies store a normalized output hash.
  When a later translation trigger would overwrite a detected manual change,
  the run stops with an explicit preservation error; compatible translations
  continue to reuse the manually edited copy.
- 2026-07-15: Manual edits to translated Journal pages are compared with the
  previous stored text and the corresponding source page. A conservative
  single-span extractor creates review candidates, using an exact source match
  or an existing glossary replacement when possible and otherwise leaving the
  source field blank. Candidates are stored in a hidden world setting and shown
  in the glossary's editable review queue. The GM must explicitly accept or
  reject each one; incomplete candidates cannot be accepted and nothing is ever
  inserted automatically. Actor/Item candidate capture remains future work.
- 2026-07-15: `npm run check` passed after these changes: typecheck, **123 tests
  across 28 test files**, and a production bundle of approximately 137.3 kB.
- 2026-07-15: Real-Foundry QA passed in `ember-test` on Foundry `14.364` and
  Crucible `0.10.1`: a manual edit to a temporary translated Journal page
  produced the expected `Castle` → `Hradu` review candidate while adding no
  glossary entry automatically; Accept stored an explicitly reviewed test
  entry, Reject discarded a second one, and all temporary documents, entries,
  and candidates were removed. The module UI produced no console errors.
- 2026-07-15: Chrome Local Translator gained conservative paragraph-context
  translation. A complete protected logical block is attempted first and used
  only if every protection token survives byte-exactly and in order; otherwise
  the provider falls back to the previous isolated-fragment path. Cache schema
  is now 4 and engine revisions are Journal 6, Actor 3, and Item 3 so old
  fragment-context output is not reused.
- 2026-07-15: Added an `openai-compatible` provider for LM Studio and similar
  local servers. Its client-scoped settings are Base URL, exact model ID, and
  optional Bearer token; a root server URL automatically gains `/v1`. The
  connection test lists models first and then performs a real Chat Completions
  translation. Calls are sequential, bounded, timeout-aware, and cache identity
  includes server, model, prompt revision, and world-context fingerprint without
  including secrets.
- 2026-07-15: LLM calls now receive the approved glossary as terminology
  reference and an editable world profile. The settings UI can have the selected
  local model suggest that profile from a 12,000-character maximum sample of
  Journal text and Actor/Item/Scene names. Generation only fills the textarea;
  the GM must review and explicitly save it. The final check passed with **129
  tests across 30 files** and a 153.02 kB production bundle.
- 2026-07-15: Real Foundry-to-LM-Studio QA passed after CORS was enabled on the
  user's LAN server. The settings UI successfully listed and tested
  `google/gemma-4-12b-qat`, saved the OpenAI-compatible provider, server URL,
  model, and manual Ember profile, and loaded those values back. The first
  30,000-character world-profile sample exhausted this model's 8,192-token
  context during reasoning and produced no final content; reducing the bounded
  sample to 12,000 characters fixed it. A subsequent real-Foundry generation
  produced a 1,165-character editable profile and left the previously saved
  profile unchanged until explicit Save. The suggestion included at least one
  questionable inference (D&D 5e), confirming that mandatory human review is
  necessary.
- 2026-07-15: Root cause of the misleading Ember profile was identified after
  release `v0.14.0`: the 12,000-character prefix contained only five text pages
  from the first `Chamber of Agaseros` Journal out of 75 Journals and no Actor,
  Item, or Scene names. The sampler was replaced with a stratified selection:
  keyword-ranked overview/lore/guide/history/faction pages from distinct
  Journals, random excerpts from additional Journals, a keyword-first Journal
  name index, random Actor/Item/Scene name samples, and world/system metadata.
  Both the English model prompt and Czech/English UI now state that this is an
  incomplete keyword-selected and random sample and instruct the model not to
  overfit one adventure or guess the rules system from generic RPG terms.
- 2026-07-15: Real Ember QA of the replacement sampler passed against LM Studio
  with `google/gemma-4-12b-qat`. The request included the official Ember world
  description, active `Crucible 0.10.1` metadata, all 75 Journal names,
  randomized samples from 265 Actors, 443 Items, and 97 Scenes, five
  keyword-selected excerpts from distinct broad-profile Journals, and three
  random excerpts from other Journals. Empty `Under Construction` and
  Foundry-reference-only pages are filtered before selection. The resulting
  profile covered the Ember Cosmos, Eiru, the Weave, Shard Gods, Elder Gods,
  major organizations and locations instead of one dungeon. The existing saved
  profile remained unchanged. Final validation passed with **132 tests across
  31 files** and a 157.18 kB production bundle; patch release `v0.14.1`.
- 2026-07-14: The user confirmed that recursive Journal translation in `v0.9.0`
  works in their Foundry instance.
- 2026-07-14: Work started on the next milestone: schema-aware Actor translation,
  a dedicated translated-Actor compendium, Actor nodes in the dependency graph,
  and rewriting Journal `@Embed` references to translated Actor UUIDs.
- 2026-07-14: Actor copies must preserve the complete Actor and stable embedded
  Item IDs. Only fields identified as `HTMLField` by the live Actor/Item system
  schemas will be translated; mechanical values, model identifiers, actions,
  UUIDs, and non-HTML strings must remain byte-for-byte source data.
- 2026-07-14: In the symlinked local development install, rebuilding to a new
  module version removes the previous versioned bundle from `dist/`, while an
  already-running Foundry server keeps the old manifest in memory. Restart
  Foundry after a version/bundle-name change or the client requests the old file
  and receives a 404.
- 2026-07-14: Actor milestone was paused due to a session usage limit and
  resumed in a later session on the same day.
- 2026-07-14: The interrupted `/tmp/test-foundry-actor-recursion.mjs` E2E was
  re-run against a freshly restarted Foundry and **passed**: the synthetic
  Actor biography was stored translated in `world.foundry-translate-actors`,
  the Journal `@Embed` was rewritten to the translated Actor UUID, the source
  Actor remained byte-for-byte unchanged, and zero fallback segments occurred.
  The only console errors were the known unrelated Crucible `prepareGrimoire`
  failures. Temporary test data was cleaned up by the script.
- 2026-07-14: A fresh Foundry start redirects to the `/join` screen; the E2E
  script now selects the Gamemaster user and joins before waiting for
  `game.ready`.
- 2026-07-14: Released as `v0.10.0`.
- 2026-07-14: Added a global active-translations overview and an upfront
  dependency-graph size scan. Before translating, the whole graph is traversed
  write-free and the total number of documents and translation units (journal
  pages plus Actor HTML fields) is computed, so progress and a remaining-time
  estimate can be shown from the first unit. The overview window lives in the
  module settings menu (`Probíhající překlady`), tracks every run regardless of
  entry point via the `activeTranslations` registry in
  `src/translation/active-translations.ts`, and shows state, progress bar,
  counts, ETA, and the current document/page. Verified with a real-Foundry E2E
  (`/tmp/test-foundry-active-translations.mjs`): a 2-page Journal with an Actor
  embed reported 5/5 units and 2/2 documents and finished with a full progress
  bar. Per-run status strings now include the overall totals.
- 2026-07-14: The user asked that commits contain no `Co-Authored-By: Claude`
  trailer.
- 2026-07-14: `v0.10.0` was pushed and tagged, the GitHub release published,
  and the public manifest and `foundry-translate.zip` assets verified. The
  user confirmed that the active-translations overview and the upfront graph
  totals work in their Foundry instance.
- 2026-07-14: Standalone Item recursion implemented for `v0.11.0`, mirroring
  the Actor pipeline: complete Item copy in `world.foundry-translate-items`,
  only live-schema `HTMLField` paths translated, references rewritten. A
  real-Foundry E2E (`/tmp/test-foundry-item-recursion.mjs`) passed on the first
  run: a Crucible weapon's `system.description.public` was translated, all
  mechanical fields stayed byte-for-byte, the Journal `@UUID` was rewritten,
  and the source Item was unchanged.
- 2026-07-14: A scripted whole-`Gamemaster's Guide` smoke test with a stubbed
  translator was started locally but crashed mid-run because its Chromium
  window was closed while the user worked on the machine. Its automatic
  cleanup did not run, so the local `ember-test` world may still contain
  stub artifacts: translated documents whose names start with `CZ ` and cache
  entries containing `CZ `-prefixed units. `/tmp/cleanup-guide-smoke.mjs`
  removes exactly those; it still needs to be run once the user approves.
- 2026-07-14: The user ran a full `Gamemaster's Guide` translation on another
  machine with real data: it completed, a small number of parts did not pass
  (isolated fallbacks/warnings), and the overall result looked good for the
  document count involved.
- 2026-07-14: **Translate this page** implemented: the journal header controls
  menu translates only the active page plus one dependency level
  (`JournalTranslationService.translatePage`, `scope.dependencyDepthLimit`).
  Partial translations carry an explicit `partial: boolean` +
  `processedPageIds` in the flag and merge into one stored document
  (`mergePartialJournalTranslation`); full page coverage flips the flag to a
  complete translation. **Important Foundry finding:** update-in-place merges
  flag objects recursively, so a key omitted from a new flag silently keeps its
  old stored value — never encode state as "key absent"; use explicit values.
  Verified by a two-phase real-Foundry E2E including depth-limit behavior
  (the dependency of a dependency stays untranslated and keeps its source
  reference).
- 2026-07-14: Clicking the translate action of an already-running journal opens
  the active-translations overview (`openActiveTranslationsOverview`).
- 2026-07-14: Runs collect issues (quality fallbacks with source preview,
  unresolved/unsupported/failed dependencies) in the registry; the overview
  shows an issue count and a **Copy log** button producing a plain-text debug
  log (`formatRunLog`). Verified via clipboard in a real-Foundry E2E.
- 2026-07-14: The glossary now supports fixed custom translations: a second
  input in Manage glossary sets `replacement`; entering an existing term
  updates it (`planManualTerm`, `GlossaryCompendiumRepository.saveEntry`).
  Journal/Actor/Item flags store a `glossaryFingerprint`, and reuse checks
  reject translations made with a different glossary, so corrections re-apply
  on the next run (verified end-to-end: replacement change → re-translate →
  stored copy updated). The unit cache already keyed on the glossary
  fingerprint.
- 2026-07-14: Vitest now loads `tests/setup.ts`, which provides a minimal
  `foundry` global so ApplicationV2 subclasses can be imported in tests.
- 2026-07-14: `v0.11.0` (standalone Item recursion) was tagged and released by
  the user while the next features were still in progress, so page
  translation, the copyable run log, and glossary custom translations ship as
  `v0.12.0`.
- 2026-07-14: The user's real Ember `Gamemaster's Guide` run log (768
  documents, 7 739 units) exposed two genuine resolution bugs, both fixed:
  anchored references (`...JournalEntryPage.X#section`) failed because the
  anchor was treated as part of the UUID — discovery now strips `#anchor` and
  rewriting keeps it after the translated UUID; and page-relative references
  (`.pageId`, `.pageId#anchor`) failed because Foundry resolves them relative
  to the containing PAGE (the entry alone lacks the embedded type), so
  resolution now anchors to the page first. Verified by a real-Foundry E2E.
  All three engine revisions were bumped (journal 4, actor 2, item 2) so the
  improved rewriting re-applies to stored translations.
- 2026-07-14: Debug logs are now English end-to-end: quality-fallback details
  in the unit translator, and dependency issues rendered from structured data
  (type, `documentType` for unsupported references) instead of the Czech UI
  message. Issues beyond the 500-per-run cap are counted and reported as
  `(+N more were not recorded)`.
- 2026-07-14: The active-translations overview gained a **Cancel** button.
  `activeTranslations.requestCancel` sets a flag; the service checks it before
  each document and after each completed unit and throws
  `TranslationCancelledError`, which finishes the run as `cancelled` (not an
  error). Completed units stay in the cache and completed documents in the
  compendia, so the next run resumes where the cancelled one stopped —
  verified by a real-Foundry E2E with a slowed translator (cancelled at 2/6
  units, resume completed from cache).
- 2026-07-14: The user asked whether manually editing stored translations is
  safe, and proposed a learn-from-corrections feature. Current behavior:
  manual edits to translated compendium documents survive as long as reuse
  holds (same source hash, glossary fingerprint, and engine revision), but ANY
  retranslation trigger silently overwrites them. Future feature idea, in
  order of value: (1) store a content hash of the saved translation in the
  flag, detect manual edits before overwriting, and warn or skip; (2) diff the
  manual edit against the machine output to propose glossary replacement
  entries ("learning from mistakes"). Not implemented yet.
- 2026-07-14: Remaining known causes of unresolved references in real Ember
  data: genuinely missing world documents, and `Compendium.dnd5e.*` links
  pointing to packs that are not present in the user's world. Unsupported
  types observed in real data: Scene, Playlist, Macro, RollTable,
  ActiveEffect, Folder — candidates for future adapters (RollTable text
  likely first by value).

### Actor milestone state (released in v0.10.0)

Implemented:

- `src/translation/actor.ts`:
  - immutable Actor snapshot and source hash;
  - versioned Actor translation metadata;
  - translation of only live-schema-confirmed Actor and embedded Item
    `HTMLField` paths;
  - complete Actor copy with stable embedded Item IDs;
  - cache, token integrity, quality fallback counts, and field progress;
  - proper Actor names are preserved and receive only the target-language suffix.
- `src/translation/compendium-actor-translation-repository.ts`:
  - dedicated `world.foundry-translate-actors` Actor compendium;
  - source UUID + target language identity;
  - update-in-place instead of duplicate creation;
  - placement in the shared `Foundry Translate` compendium folder.
- The Journal dependency graph now accepts both Journal and Actor nodes:
  - Journal `@Embed[Actor...]` targets can be translated as Actor dependencies;
  - Actor HTML may recursively reference Journals or other Actors;
  - reference rewriting is generic across translated Journal and Actor data;
  - standalone Item roots remain unsupported for now;
  - Actor quality fallbacks are included in the graph completion total.
- UI progress distinguishes Journal pages from Actor HTML fields.
- New unit coverage for Actor source immutability, schema-selected HTML fields,
  mechanical-data preservation, embedded Item ID preservation, Actor hashing,
  and Actor compendium update-in-place behavior.

Verified:

- `npm run check` passed: typecheck, **91 tests across 20 test files**, and a
  production bundle of approximately 92.7 kB.
- The real-Foundry E2E `/tmp/test-foundry-actor-recursion.mjs` passed (see the
  work log above). Journal-to-Actor recursion is confirmed working against
  Foundry `14.364`, Crucible `0.10.1`, and Chrome Local Translator.
- No interrupted Node/Chromium process remained from the previous session; the
  E2E was run with the single `/tmp/foundry-chromium-148-profile` profile and
  the browser was closed afterwards.

## Project goal

Foundry Translate is a Foundry VTT v14 module for playing English adventures in
Czech without a separate server-side service. Source documents must never be
modified. Translations are stored in world compendia, use a portable proper-name
glossary, and must safely preserve Foundry syntax, UUIDs, inline rolls, embeds,
and HTML.

The user's main priorities are:

- reliability is more important than speed or the number of documents created;
- proper names and locations may remain unchanged and do not need Czech inflection;
- API keys are entered through the module settings;
- everything runs inside Foundry, with no separate service;
- translations should eventually be exportable and importable between instances;
- the priority after `v0.9.0` is translating Actor and Item dependencies.

## Implemented functionality

- Chrome Local Translator is the default free provider.
- Google Cloud Translation Basic v2 is available as an optional provider.
- Provider, language, and local API-key settings.
- Proper-name glossary in the `Foundry Translate — Glossary` compendium.
- Duplicate-safe synchronization of world Actor and Scene names.
- A **Translate this journal** action directly in an open Journal window.
- A **Show original** action in stored translations.
- Journal actions are hidden while the window is minimized and restored when it
  is expanded again.
- One translation per source UUID and target language; subsequent runs update the
  same compendium document.
- Translation of the Journal name, page categories, page names, and HTML content.
- Automatic detection of Ember/custom-system HTML fields.
- Translation of visible HTML attributes (`alt`, `title`, and `aria-label`).
- Protection of `@UUID`, inline rolls, glossary tokens, and HTML boundaries.
- Translation of human-readable `@Embed` parts, including `readaloud`, without
  changing the UUID.
- Recursive Journal-to-Journal translation with dependency-first traversal.
- Recursive Actor translation: complete Actor copies with stable embedded Item
  IDs in the `world.foundry-translate-actors` compendium, translation limited to
  live-schema-confirmed `HTMLField` paths, and Journal `@Embed[Actor...]`
  references rewritten to the translated Actor UUID.
- Recursive standalone Item translation: complete Item copies in the
  `world.foundry-translate-items` compendium with only live-schema-confirmed
  `HTMLField` paths translated and references rewritten, mirroring the Actor
  pipeline. Embedded Actor Items continue to travel inside the Actor copy.
- A write-free scan of the whole dependency graph before translation computes
  total documents and units, powering overall progress and the global
  active-translations overview window with a remaining-time estimate.
- Deduplication of shared dependencies and safe cycle handling.
- Rewriting to translated compendium UUIDs after every graph node is stored.
- Stable JournalEntryPage IDs across rewritten page references.
- Missing and unsupported dependencies fall back to their source UUID with a
  non-fatal warning.
- Long-content chunking, bounded request batches, and page-by-page progress.
- Server-side cache in the `Foundry Translate — Translation Cache` compendium.
- Quality retries for empty, structurally damaged, or suspiciously unchanged
  output.
- After quality retries are exhausted, an isolated fragment safely falls back to
  its source text, the rest of the page continues, the fallback is not cached,
  and the UI shows an amber summary.
- URL-like technical references are not sent to the provider.
- A source hash protects against changes to the source during a long translation.
- The translation-engine revision invalidates stored results after logic changes.
- The translation cache uses a versioned key schema; the current schema is `3`.
- Module compendia are grouped in the shared grey `Foundry Translate` folder.
- Translate this page: the active journal page plus one dependency level, with
  partial-translation merging into the single stored document.
- A global active-translations overview with progress, ETA, collected issues,
  and a copyable plain-text debug log.
- Glossary entries may carry a fixed custom translation; changing the glossary
  invalidates translation reuse via a stored glossary fingerprint.
- Markdown Journal pages translate visible source text while preserving Markdown
  mechanics, and their stored rendered HTML is translated for immediate display.
- Glossary entries are editable in a two-column source/fixed-translation view.
- 114 automated tests across 26 test files.

## Verified real-world cases

The module has been tested with Foundry `14.364`, Crucible `0.10.1`, the Ember
world, and Chromium 148 with the Chrome Built-in Translator model.

- Exact first page of Ember's `Gamemaster's Guide`:
  - page: `Main Quest Overview`;
  - source length: 15,671 characters;
  - Czech output: approximately 14,380 characters;
  - translated name: `Přehled hlavního úkolu`;
  - Actor embeds preserved;
  - no leaked protection tokens;
  - zero quality fallbacks.
- `https foundryvtt com releases 14 358` remains exactly unchanged.
- `Shard of Fear` may remain unchanged as a proper name without causing a false
  translation failure.
- A long Journal is saved as one translated compendium document, not as a world
  duplicate.
- Journal minimization changes the translate action from
  `flex -> none -> flex` across expanded, minimized, and restored states.
- A real Foundry `A -> B -> A` graph test translated both Journals, rewrote both
  directions, preserved the linked page ID, and removed all source UUIDs from
  the translated copies.
- `Gamemaster's Guide` contains 44 distinct Actor references. Real Actor data
  confirms that the main visible fields are `system.details.biography.*`, with
  additional HTML in taxonomy, archetype, and embedded Item descriptions.

Known `prepareGrimoire` console errors involving `life` and `illusion` originate
in the Crucible system and are unrelated to this module.

## Architecture and invariants

### Translation pipeline

- `src/translation/html.ts` plans safely translatable HTML text units.
- `src/translation/foundry-syntax.ts` protects Foundry syntax and translates only
  the human-readable parts of supported constructs.
- `src/glossary/protection.ts` protects proper names with integrity tokens.
- `src/translation/unit-translator.ts` handles batching, cache keys, retries,
  fallbacks, and segment restoration.
- `src/translation/journal.ts` translates Journal data page by page and creates
  the translation flag.
- `src/translation/journal-service.ts` connects the provider, cache, glossary,
  source hash, and stored translation.
- `src/translation/compendium-translation-repository.ts` maintains one stored
  translation per source UUID and target language.
- `src/translation/document-dependencies.ts` discovers and rewrites `@UUID`,
  `@Embed`, and enriched `data-uuid` references.
- `src/translation/dependency-graph.ts` provides dependency-first traversal,
  deduplication, cycle protection, and isolated dependency failures.

### Safety rules

- Never modify a source document.
- Never store an unrestored `__FTN_`, `__FTG_`, or `__FTS_` token.
- Never send the mechanical or identifying part of a Foundry reference to the
  translation model.
- Never use structurally damaged model output; retry and then use the safe source
  fragment.
- Never write a fallback fragment to the cache.
- A provider-wide failure on the first request remains fatal; an isolated retry
  failure for a fragment uses a fallback.
- After translation-logic changes, increment `TRANSLATION_ENGINE_REVISION` in
  `src/translation/journal.ts`.
- After changes to unit-output or cache semantics, increment `schemaVersion` in
  `cacheKey()` in `src/translation/unit-translator.ts`.
- An existing translation must be updated under the same compendium document ID,
  not duplicated.

## Current data stores

- `world.foundry-translate-glossary` — proper names and locations.
- `world.foundry-translate-cache` — translated-unit cache.
- `world.foundry-translate-translations` — JournalEntry translations.
- `world.foundry-translate-actors` — translated Actor copies.
- `world.foundry-translate-items` — translated standalone Item copies.

The translation flag contains the source UUID and hash, provider, language pair,
timestamp, translated/skipped page counts, fallback-fragment count, and engine
revision. A legacy flag without an engine revision remains readable but must not
be reused as a current translation.

## Completed recursion milestone (Actor in v0.10.0, Item in v0.11.0)

### Required user outcome

When a page contains an `@UUID`, `@Embed`, or another supported document
reference, the module should:

1. Resolve the referenced source document.
2. Create or update its translation in the appropriate Foundry Translate
   compendium.
3. Recursively process its own dependencies.
4. Rewrite the translated parent's reference to the translated UUID.
5. Preserve all source documents and stable page IDs.
6. Safely handle cycles, repeated references, and missing documents.
7. Report progress by document and page.
8. Allow translation of either the complete Journal graph or only the active
   page graph.

### Recommended implementation plan

#### 1. Dependency discovery without writes — completed for Journals

- Introduce a normalized `TranslationDependency` type containing `sourceUuid`,
  `rootUuid`, `documentType`, `pageId`, `syntaxKind`, and `fieldPath`.
- Extract dependencies from source values before tokenization:
  - `@UUID[...]`;
  - `@Embed[...]`;
  - enriched HTML links with `data-uuid`;
  - visible/custom-system HTML fields.
- Distinguish root documents from embedded page UUIDs.
- Resolve with Foundry's `fromUuid` and return an explicit unresolved warning.
- Do not mutate or save anything in this phase.
- Add tests for world UUIDs, compendium UUIDs, page UUIDs, embeds, duplicates,
  and missing UUIDs.

#### 2. Translation graph orchestrator — completed for Journals

- Use `sourceUuid + targetLanguage` as the graph node key.
- Node states: `queued`, `translating`, `translated`, `failed`, `unresolved`.
- Use `visited` and `inProgress` sets to break cycles such as `A -> B -> A`.
- Translate a shared dependency only once even when hundreds of references point
  to it.
- Do not impose a small implicit maximum depth. Reliability is the priority. Add
  cycle protection, user cancellation, and, if needed, an explicit high safety
  limit with a clear warning.
- Save completed nodes incrementally so a failed or cancelled run can resume.
- Translate dependencies first, then atomically save the parent with rewritten
  UUIDs.

#### 3. Document adapters and per-type compendia

A Foundry compendium has one document type, so the Journal translation pack
cannot store Actor or Item dependencies. Introduce an adapter interface such as:

```ts
interface DocumentTranslationAdapter<TSource, TData> {
  supports(document: FoundryDocument): boolean;
  snapshot(document: FoundryDocument): TSource;
  dependencies(source: TSource): TranslationDependency[];
  translate(source: TSource, context: TranslationContext): Promise<TData>;
  save(data: TData, context: TranslationContext): Promise<FoundryDocument>;
}
```

Recommended adapter order:

1. `JournalEntry` with stable `JournalEntryPage` IDs — completed.
2. `Actor`, especially Ember biography/readaloud/system HTML — completed.
3. `Item` and other types discovered during real Ember traversal — standalone
   Items completed.
4. Additional types only when supported by evidence from actual content.

Each document type needs its own world compendium in the `Foundry Translate`
folder, for example translated Actors and Items. The source UUID plus target
language to translated UUID mapping must remain consistent across packs.

#### 4. Reference rewriting — completed for Journal targets

- Rewrite `@UUID[JournalEntry.X.JournalEntryPage.Y]` to the translated Journal
  UUID while preserving page ID `Y`.
- Rewrite `@Embed[Actor.X]` to the translated Actor UUID so dynamically rendered
  white Ember text loads in Czech.
- Translate human-readable labels and options, then integrity-check the mechanical
  syntax again.
- If a dependency cannot be resolved or translated, keep its source UUID and add
  a warning. One missing reference must not discard the whole graph.
- Never rewrite a source UUID inside the source document itself.

#### 5. UI and progress

- The existing **Translate this journal** action should process the complete
  dependency graph.
- Add **Translate this page** for the active page and its recursive
  dependencies — completed with a one-level dependency scope.
- Show the current document, current page, completed/total count, and unresolved
  and fallback counts.
- The completion warning should distinguish:
  - text fallbacks;
  - unresolved documents;
  - dependency documents that failed translation.
- Hide Translate/Show Original controls while minimized, as in `v0.9.0`.

#### 6. Mandatory recursion regression tests

- `A -> B -> C`, including all rewritten links.
- `A -> B -> A` cycle without a deadlock or duplicate.
- Two pages referencing the same Actor produce one translated Actor.
- A Journal page UUID preserves its page ID.
- An `@Embed Actor` renders translated Actor data.
- A missing UUID remains the source UUID with a warning, and the parent is saved.
- A dependency provider failure does not destroy completed nodes.
- A source change in a dependency invalidates only the required translated node,
  while the parent link remains stable.
- An older translation or cache revision is not reused.
- A full `Gamemaster's Guide` smoke test in Ember.

## Known remaining limitations

- Recursive translation and reference rewriting support Journal, Actor, and
  standalone Item targets. Other document types remain pointed at their source
  UUID and produce a warning.
- Portable translation-bundle export/import is not implemented yet.
- Smart-glossary candidate extraction currently observes manual edits to
  translated Journal pages. Corrections intentionally do not block a later
  regeneration; Actor and Item corrections do not yet create review candidates.
- Helium does not support Chrome Local Translator; the tested Chromium profile
  does.
- The stock TranslateGemma LM Studio chat template requires custom structured
  message fields which are discarded by LM Studio's standard OpenAI-compatible
  Chat Completions normalization. A general Gemma/Qwen instruction model works;
  TranslateGemma needs a compatible custom prompt template before it can be used
  through this provider. Its official template also does not support the freeform
  context prompt used by the world-profile feature.

## Local development environment on the original machine

Current machine update (2026-07-15):

- Foundry `14.364` binary is available at
  `/home/flamendrin/Games/FoundryVTT-Linux-14.364/foundryvtt`.
- The `fvtt` CLI is configured with that install and the isolated data path
  `/home/flamendrin/.local/share/FoundryVTT-foundry-translator-test`.
- The disposable `ember-test` world is installed in that profile. It uses
  Crucible `0.10.1`, requires the Ember module, and is the preferred target for
  Ember-specific real-Foundry E2E testing.
- The development module is linked from
  `Data/modules/foundry-translate` to this repository's `dist` directory.
- Start the setup server with
  `fvtt launch --noupnp --noupdate --port 30000`; add `--world ember-test` for
  direct world launch after the Foundry license has been activated.
- A test LM Studio server was available at `http://192.168.10.183:1234`.
  `GET /v1/models` exposed `translategemma-4b-it`, two general Gemma models,
  Qwen, and an embedding model. A real protected-token translation succeeded
  with `google/gemma-4-12b-qat`; the stock `translategemma-4b-it` template
  rejected standard OpenAI chat message shapes as described above.

These paths are machine-specific and must be replaced with equivalents elsewhere.

- workspace: `/home/spilberktuma/workspace/foundry-translate`
- Foundry binary:
  `/home/spilberktuma/Downloads/FoundryVTT-Linux-14.364/foundryvtt`
- data path: `/home/spilberktuma/.local/share/FoundryVTT`
- test world: `ember-test`
- URL: `http://127.0.0.1:30000`
- Chromium: `/usr/bin/chromium`
- profile with the installed model: `/tmp/foundry-chromium-148-profile`

Use only one Chromium process with this profile. Do not create parallel profiles,
and terminate the process after testing. Old test profiles once filled `/tmp` and
caused `Quota exceeded (-122)`; do not delete the main profile containing the
TranslateKit model.

Start Foundry with:

```bash
/home/spilberktuma/Downloads/FoundryVTT-Linux-14.364/foundryvtt \
  --dataPath=/home/spilberktuma/.local/share/FoundryVTT \
  --world=ember-test \
  --port=30000
```

## Development, testing, and releases

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
npm run release:verify
```

Release workflow used by this project:

1. Inspect `git status -sb`, the complete diff, and `git diff --check`.
2. Stage only explicit files; do not use `git add -A`.
3. Create one coherent commit directly on `main`.
4. Run `git push origin main`.
5. Create and push an annotated `vX.Y.Z` tag.
6. Verify the GitHub Actions release.
7. Verify the public `module.json` and `foundry-translate.zip` assets.

`gh` authentication was not working on the original machine, but normal HTTPS
`git push` worked. The project intentionally uses fewer, larger, verified pushes.

Installation manifest:

```text
https://github.com/f-tuma/foundry-translator/releases/latest/download/module.json
```

## Recommended first steps for the next agent

1. Read this document and the README.
2. Run `git status -sb` and `npm run check`.
3. If the local `ember-test` world still contains `CZ `-prefixed stub
   artifacts from the crashed smoke test, run `/tmp/cleanup-guide-smoke.mjs`
   (see the work log) with the user's approval.
4. Remaining roadmap in order: user-approved smart-glossary improvements, then
   portable translation-bundle export/import (the user explicitly wants export
   last). Manual corrections are candidate input, not protected output.
5. If the user reports specific failed parts from their real `Gamemaster's
   Guide` run, ask for the copyable log from the Active translations window
   and address the reported fallbacks.
