# APEX release validation — 2026-09-21

Selected server ID: `hy-mt2-30b-a3b-apex` (Hy-MT2 30B-A3B, APEX-I-Nano,
12.45 GB). Host: RTX 5070 Ti 16 GB, 64 GB RAM, LM Studio on localhost.
The user selected this model and accepts minor grammar errors while prioritizing
meaning, reviewed terminology and usable adventure references.

## Production behavior

For Czech, the model translates whole sentences or context-carrying HTML units
inside a JSON object. JSON Schema fixes its keys, string values and item count.
LM Studio applies grammar-constrained sampling for GGUF models through its
[structured-output API](https://lmstudio.ai/docs/developer/openai-compat/structured-output).
No additional inference server or XGrammar installation is required.
The APEX path uses temperature 0 and top_p 1; prompt revision is 12.

Code locates each approved name form in its original region and reattaches opaque
link syntax. Missing, renamed, duplicated or overlapping names, changed HTML
boundaries and damaged Foundry syntax are rejected. Failed units are retried with
the English source, previous Czech draft and relevant terminology. If needed,
exact approved forms replace the affected inflections, then all names in that
fragment. This is a visible grammar-review warning and is never cached. Final
validation failure keeps the source fragment with approved names and an issue.
Successful sentences are not automatically rewritten in a second pass.

Schema validity is not a grammar or meaning guarantee. The Czech form validator
is deliberately bounded; unsupported valid forms can be rejected, and wrong
endings sharing an accepted stem can pass. Source meaning still requires human
review. Standalone glossary titles keep their canonical form.

## Measurements

- Fifteen synthetic name/context cases: 3.990 seconds at temperature 0,
  no source fallbacks, 14/15 expected name substrings. The remaining output was
  `proti Hlubinním Trpaslíkům` instead of `proti Hlubinným Trpaslíkům`.
  This is an explicit failure of the strict language test, not a 100% language
  score. A prior temperature 0.7 run had the same 14/15 result in 4.418 seconds.
- Four synthetic contextual paragraphs: 3.716 seconds, no source fallbacks and
  intact inline UUID syntax. Minor wording and agreement errors remain.
- Final real Ember Main Quest Overview: 50 HTML units, 148.119 seconds.
  All HTML/immutable-attribute, opaque-reference and marker-leak checks passed.
  Six fragments needed exact-name recovery and are flagged for grammar review;
  one Ankarist readaloud fragment remained in English after five attempts.
  The no-source-fallback assertion **failed** (49/50 units translated).
  This remains a known quality limitation, not a passing end-to-end quality
  score. Longer passages also contain awkward agreement and some loose wording;
  the release does not certify semantic equivalence.
- Private adventure
  exports, glossary context and generated full-page reports remain outside this
  public repository. The opt-in integration test checks HTML/immutable
  attributes, opaque Foundry references, leaked markers and source fallbacks.
  Exact-form review warnings are reported separately and permitted; they are
  not claimed to pass a grammar test.

These timings are observations on this host, including the production protection
pipeline, not forecasts for an entire adventure or smaller machines.

## Reproduction

Run `npm run check` and `npm run release:verify` for deterministic checks.
Use the server's exact model ID for the opt-in language test:

```sh
LM_STUDIO_MODEL=hy-mt2-30b-a3b-apex npm test -- tests/local-inflection.integration.test.ts
```

For a private exported Foundry Journal, provide `FOUNDRY_JOURNAL`,
`FOUNDRY_GLOSSARY` (reviewed version-2 JSON), and `LM_STUDIO_MODEL`, then run
`npm test -- tests/local-ember.integration.test.ts`. Optional `FOUNDRY_PAGE`,
`LM_STUDIO_RESULT` and `LM_STUDIO_TRACE` choose the page and private output files.
Do not commit adventure text or glossary context to the public repository.

Deterministic release checks: typecheck, 307 tests, production build, metadata
verification and diff whitespace checks pass. Three local-model tests are opt-in
and skipped by ordinary CI; their language results are reported above.
