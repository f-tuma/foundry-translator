# Czech glossary inflection: local-model checks, 2026-09-21

**Result: not ready for release.** Both tested models retained the glossary
markers, UUID and segment structure in completed runs, but produced incorrect
Czech. The integrity guard detects changed vocabulary and structure; it does
not establish grammatical correctness or preserved sentence meaning.

Requests used the production `translateUnits` and `OpenAiCompatibleProvider`
against the user's local LM Studio. No world data was translated or imported.
The sentences are short authored test examples, not exported adventure prose.
Reports contain final translations and request metrics, not hidden reasoning.

| Run | Expected name forms | Time | Findings |
| --- | --- | --- | --- |
| Hy-MT2 baseline, 10 cases | 7/10 | 17.3 s | Wrong plural cases and a standalone title changed to genitive |
| Qwen3.8 native, 10 cases | 8/10 | 69.5 s | Wrong plural; reversed ownership in the Spirit Beasts sentence |
| Hy-MT2 expanded, 15 cases | 13/15 | 17.8 s | Same two failures; additional preposition and narration errors |

Counts measure the expected name substring, **not whole-sentence quality**.
Qwen was tested after the standalone-title fix; its higher count is not evidence
that it fixed that title by itself. Times include requests/retries and may include
model loading. This is a small diagnostic sample, not a general model ranking.

- `hy-mt2-7b`: Tencent Hy-MT2 7B Q8_0, 7,981,928,896 bytes. Chat Completions,
  temperature 0.7, top_p 0.6, the provider's Hy-MT user-message template.
- `qwen/qwen3.8-27b`: Q4_K_M, 17,742,040,464 bytes. Server-reported loaded
  context 8,192, `speculative_draft_mtp=true`, max draft tokens 3. Native chat,
  temperature 0, reasoning off, max output 4,096, streaming on, persistence off.
- Qwen's initial Chat Completions request timed out at 120 seconds. Native model
  metadata advertised default reasoning `xhigh`. Native chat with explicit off
  completed; the measured prompt probe reported zero reasoning tokens.

Examples requiring correction:

| Source | Actual result | Problem |
| --- | --- | --- |
| They fight against Delvers. | Bojují proti Permonícům. | Should use Permoníkům |
| The tracks belong to Spirit Beasts. | Stopy patří k Přízračné Šelmy. | Hy-MT2 did not decline the name or form a grammatical sentence |
| The tracks belong to Spirit Beasts. | Stopám patří Přízračné Šelmy. | Qwen reversed who owns the tracks |
| They return from Old Carinth. | Vrací se z Starého Carinthu. | Name form matches, but Czech needs ze |

A temporary prompt explained that the name is a Czech dictionary form, required
inflecting every noun/adjective, supplied unrelated examples `Vlci → Vlkům` and
`Černé Kočky → Černým Kočkám`, and instructed the model not to reverse ownership
to avoid inflection. It also explained that markers should be invisible to
preposition choice. Qwen repeated the same failures (8/10); Hy-MT2 worsened to
3/10. The prompt was discarded; the expanded run uses the original instructions.

The expanded report corrects one erroneous expected value after capture:
`Hlubinní Trpaslíci` has dative plural `Hlubinným Trpaslíkům`, not `Hlubinním`.
The model output is unchanged and was already correct in that case. The test
oracle has been corrected. Passing this name-form check still does not imply
that all the surrounding text is good Czech.

Implemented fixes:

- A unit containing only one glossary name always keeps its canonical form,
  including standalone UUID labels. Names in a sentence split across HTML
  segments still inflect with their surrounding context. Cache schema bumped.
- Qwen3.8 uses native LM Studio chat with reasoning off, matching the existing
  Gemma path; servers without the native endpoint retain the compatibility path.
- The opt-in integration test supplies Node fetch with timeout/cancellation,
  records metrics, and now covers 15 cases including additional names not in
  the prompt examples. Standard CI skips real-model requests.

Run the current check with:

```sh
LM_STUDIO_MODEL=hy-mt2-7b LM_STUDIO_RESULT=/tmp/inflection.json npm test -- tests/local-inflection.integration.test.ts
```

Captured reports are in [inflection-2026-09-21](inflection-2026-09-21/).
The failing language checks are intentionally retained. Do not release the
all-inflect import based only on successful unit tests or structural validation.
