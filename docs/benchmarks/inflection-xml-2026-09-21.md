# Czech inflection: input representation and current models, 2026-09-21

The follow-up improves several reproducible failures without changing the
reviewed glossary. It does **not** establish release-quality Czech yet. The
existing draft PR #19 remains a draft; no Foundry world, settings or glossary
were modified by these experiments.

## Diagnosis and changes

Controlled requests showed that the representation of names was part of the
problem. Hy-MT2 translated `The tracks belong to Spirit Beasts.` correctly when
given English source text and a separate terminology reference, but failed with
long ASCII protection markers or Czech words substituted into the English
sentence. Short XML tags retained more of the sentence's grammatical context.

The production provider now receives original source names, short XML IDs and
only the terminology used in that batch. Original aliases are preserved in
these references. The adapter reconstructs the original protection tokens
before the existing vocabulary and Foundry-syntax checks run. Malformed XML
triggers smaller batches, retries and ultimately a visible, uncached source
fallback. The XML adapter applies to Czech inflection on the OpenAI-compatible
provider; fixed names and other provider/language paths retain their behavior.

IDs, hierarchy, item/segment order and opaque syntax must survive. Whole name
phrases can change order within one plain text container with no opaque syntax.
They cannot move across a link or segment boundary. This permits natural Czech
such as moving “before leaving Old Carinth” to the beginning of a sentence.

Real output also exposed a separate validator bug: the list of noun endings
omitted feminine dative plural `-ám`. It rejected the correct form
`Přízračným Šelmám`. The ending is now supported with regression coverage.
The cache schema is 8 and the provider prompt revision is 10.

## Results through the production translation pipeline

These are small diagnostic samples, not a general model ranking. Name-form
counts check an expected substring, **not whole-sentence correctness**. Times
include retries and may include loading. Sampling, prompts and batching vary
between iterations; the observed range is not a guaranteed speed or score.

| Run | Expected name forms | Elapsed | Main observations |
| --- | --- | --- | --- |
| Previous Hy-MT2, ASCII markers | 13/15 | 17.8 s | Incorrect plural and Spirit Beasts sentence |
| Hy-MT2 XML, after `-ám` fix | 14/15 | 6.1 s | Correct Spirit Beasts sentence; still `Permonícům` |
| Hy-MT2 XML, final word-order instructions | 13/15 | 12.2 s | Correct Spirit Beasts sentence; wrong forms of Permoníci and Hlubinní Trpaslíci; batch needed splitting |
| Qwen3.8 XML, initial word-order instructions | 14/15 | 46.7 s | Correct `Permoníkům` in this run; Spirit Beasts ownership still reversed |

Four synthetic narrative paragraphs were also tested on the final code:

| Model | Structure checks | Elapsed | Manual language review |
| --- | --- | --- | --- |
| Hy-MT2 7B Q8_0 | Passed, no source fallbacks | 8.6 s | `Stopy patří Přízračným Šelmám` and `před Permoníky` are correct; still `z Starého` instead of `ze Starého`, and an unnecessary tense change |
| Qwen3.8 27B Q4_K_M | Passed, no source fallbacks | 36.3 s | `ze Starého Carinthu` is correct, but `Stopám patří Přízračné Šelmy` reverses ownership and `proti Permonícům` is wrong |

Both kept the UUID and segmented link label intact. Passing that structural
test does not approve the translation's grammar or meaning. Larger context
helped Hy-MT2 on these examples; it did not resolve Qwen's semantic error.

Separate probes compared plain text, XML and JSON on Hy-MT2, Gemma 4 12B and
Qwen3.8. Reasoning-enabled probes produced a correct `Permoníkům` but introduced
new surrounding errors (`Stop patří` / `Stopky patří`). Lowercasing terminology
and providing explicit noun hints did not consistently fix the plural. None
of those probes was adopted as a blanket production change. No benchmark-name
replacements or automatic glossary renaming were added.

## Next comparison

A fresh [model review](local-models-2026-09-21.md) checked publisher cards and
files. The first additional download requested is Google's Gemma 4 26B-A4B
QAT Q4_0, main file `gemma-4-26B_q4_0-it.gguf` (14.4 GB). It is not yet offered
by this LM Studio server at the last check. It still needs the same short-form
and paragraph checks; model size or release date alone does not decide quality.
Tencent Hy-MT2 30B-A3B and Xiaomi's August MiLMMT-46-12B v1.0 are further
candidates, with the memory/template qualifications in that review.

Host: RTX 5070 Ti (16,303 MiB VRAM), about 64 GB RAM. Hy-MT2 uses Chat
Completions with temperature 0.7 and top_p 0.6. Qwen uses native LM Studio chat
with reasoning off and temperature 0. The earlier model report records the
installed files and Qwen MTP configuration.

## Reproduction and evidence

```sh
LM_STUDIO_MODEL=hy-mt2-7b LM_STUDIO_RESULT=/tmp/inflection-short.json npm test -- tests/local-inflection.integration.test.ts
LM_STUDIO_MODEL=hy-mt2-7b LM_STUDIO_RESULT=/tmp/inflection-context.json npm test -- tests/local-context.integration.test.ts
```

Replace the model ID to run the same checks against another installed model.
Both opt-in tests are skipped in normal CI. The short test deliberately keeps
its failing language assertions. The paragraph test checks structure; inspect
its recorded sentences for meaning, negation, tense, agreement and narration.

- [Controlled representations](inflection-xml-2026-09-21/representation-controls.json)
- [Three-model format probes](inflection-xml-2026-09-21/three-model-format-probe.json)
- [Reasoning probes](inflection-xml-2026-09-21/reasoning-probe.json)
- [Capitalization and noun-hint probes](inflection-xml-2026-09-21/capitalization-probe.json)
- [Hy-MT2 before fixing the dative validator](inflection-xml-2026-09-21/hymt-before-dative-fix.json)
- [Hy-MT2 after that fix](inflection-xml-2026-09-21/hymt-after-dative-fix.json)
- [Hy-MT2 final short test](inflection-xml-2026-09-21/hymt-short-final.json)
- [Qwen short test](inflection-xml-2026-09-21/qwen-short.json)
- [Hy-MT2 paragraphs](inflection-xml-2026-09-21/hymt-paragraphs.json)
- [Qwen paragraphs](inflection-xml-2026-09-21/qwen-paragraphs.json)
- [Earlier ASCII-marker runs](inflection-2026-09-21.md)

Reports contain authored synthetic examples, final model answers and metrics,
not private adventure exports or hidden reasoning. Unit validation: 288 tests
passed, two opt-in model tests skipped; typecheck and production build passed.
The XML tests cover malformed output, missing/duplicate IDs, changed hierarchy,
unsafe tag injection, alias handling, retry, and permitted/forbidden name moves.
