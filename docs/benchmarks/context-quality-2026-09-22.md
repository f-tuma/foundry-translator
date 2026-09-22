# Passage context evaluation — 2026-09-22

Version 0.21.0 uses bounded source context and isolates contextual APEX passages.
The test supports this design for word-sense disambiguation. It does **not**
establish unattended semantic correctness for a whole adventure.

## Method

- Local LM Studio, `hy-mt2-30b-a3b-apex` (APEX-I-Nano), 8192-token context,
  RTX 5070 Ti 16 GB; structured output, temperature 0.
- 54 passages: 30 public synthetic cases with explicit meaning expectations,
  plus 24 deterministic samples spread across six private Ember Journal exports.
  The guide samples include release-note prose as well as adventure prose.
- Same current production pipeline, model and glossary in both arms; no
  translation cache. Baseline omits passage context. This is **not** a comparison
  against the complete v0.20.0 implementation.
- Input batches contain three samples; the first arm alternates per batch.
  The production APEX provider sends contextual passages individually; sentences
  from one source paragraph remain together in the structured request.
- Original titles and neighbouring text only. No generated lore summaries or
  unreviewed glossary editorial notes are injected as factual context.
- Final report: one observed output per case/arm. Earlier exploratory runs were
  retained privately; prompt layouts were refined on this set, so it is a
  development reference set, **not an independent held-out benchmark**.

## Final observed run

| Measure | Without passage context | With passage context |
| --- | ---: | ---: |
| Passages | 54 | 54 |
| Links / protected syntax intact | 54 | 54 |
| Source fallback, visibly reported | 1 | 1 |
| Exact-name grammar fallback | 1 | 0 |
| API requests, including retries | 24 | 56 |
| Input tokens | 12,555 | 28,467 |
| Output tokens | 7,117 | 6,011 |
| Total measured pipeline time | 43.364 s | 38.717 s |

These timings are a single local observation, affected by retries, output length
and server prompt caching. More input tokens and requests mean this is not a
promise of a speedup, particularly on weaker machines or a paid remote API.
Both arms' source fallback occurred on the same guide passage. A valid JSON
response whose terminology cannot be safely restored is still rejected.

## Meaning review

Agent inspection found concrete improvements on synthetic examples:

- The damaged *seal* became a wax **pečeť**, rather than a damaged animal.
- A poisoned *spring* became **pramen**, rather than **studna**.
- The lantern instruction retained an imperative and the required action order.
- The sample with secret background information did not append that information
  to the translation target.

Remaining errors matter. In the final run a female speaker still received a
masculine verb, and a past-tense arrival became present tense. Grammar also
remains imperfect, e.g. *obě řetězy*. Private passages include a misread fictional
era, an island/creature relationship changed to a creature's home, a colloquial
*check in* incorrectly treated as a game-mechanics check, and unglossaried fantasy
terms needing review. These are flagged in the private review artifact; they
are not hidden behind a structural pass rate.

No user approval or independent human quality score has been claimed. The
reference expectations and agent review notes are proposals for joint review.
The release retains source-fallback warnings, deterministic link/glossary checks
and safe saved-copy guards. It does not add an unreliable automatic “meaning
verified” badge or claim to detect all semantic errors.

## Reproduce

```bash
LM_STUDIO_MODEL=hy-mt2-30b-a3b-apex \
QUALITY_REPORT=/private/quality.json \
QUALITY_SOURCE_DIR=/private/foundry-sources \
FOUNDRY_GLOSSARY=/private/approved-glossary.json \
npx vitest run tests/local-quality.integration.test.ts

node scripts/render-quality-review.mjs /private/quality.json /private/review.html
```

Omit the two Foundry variables to run only the 30 synthetic cases. Source files
and reports stay outside Git. The review page provides source / baseline /
context columns, searchable passages, review filters, local notes and JSON note
export. It never imports translations automatically.

## Integration checks

Automated coverage includes context/cache separation, normalized cache reuse,
cache-hit alignment, original Actor/Item names, HTML reading order, excluded
attributes/code, sentence grouping, opaque-only skips, isolated contexts,
retry alignment and context included in request budgets. Old Chrome/Google
settings normalize to OpenAI-compatible without reading or reusing their keys.
Historical translation bundle provenance remains accepted.

Local browser QA used a separate Ember copy on `127.0.0.1:30000` (Foundry
14.368, Crucible 0.11.0, Ember 0.6.2), with the in-app browser at 1440×1000.
The settings form showed only OpenAI-compatible API, tested APEX successfully
and persisted the model/provider. A synthetic Journal page translated a damaged
seal as **Pečeť je poškozená**; network inspection confirmed original neighbouring
paragraphs in the request. The source remained unchanged. Repeating the page
translation made **zero** model requests. Existing Crucible/Ember content warnings
remained; there were no translation-module errors in the exercised flow. The
review artifact loaded and filtered correctly without console errors. Production
Foundry and the user's original local data were not changed. Mobile Foundry UI
was not tested.
