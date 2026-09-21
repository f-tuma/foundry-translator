# Whole-sentence repair and two additional Hy-MT models, 2026-09-21

The user's proposed repair step is useful: give the model the English original,
the complete Czech draft and relevant dictionary-form glossary entries. The
model must repair surrounding agreement as well as the name. Both 7B and
30B-A3B corrected the supplied dashboard example and gender/number agreement.
A refined prompt also repaired reversed ownership. However, unconditional
second passes sometimes damage already acceptable text, and several errors
remain. Automatic post-editing has **not** been enabled in the module.

## Installed variants

| LM Studio ID | Installed variant | File bytes |
| --- | --- | --- |
| `hy-mt2-1.8b` | Tencent Q8_0 | 1,908,528,192 |
| `hy-mt2-7b` | Tencent Q8_0 | 7,981,928,896 |
| `hy-mt2-30b-a3b-apex` | alphaZimuth APEX-I-Nano, mixed quantization; API does not report a uniform quantization name | 12,447,420,032 |

The APEX file is about 12.4 decimal GB / 11.59 GiB, distinct from the previously
discussed official Q4_K_M file. Its publisher's
[model card](https://huggingface.co/alphaZimuth/Hy-MT2-30B-A3B-APEX-GGUF)
identifies the Nano tier. Tencent's
[Hy-MT2 instructions](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF)
recommend a user-message prompt and different sampling for the dense and MoE
models. The production client now sends `top_p=1` for Hy-MT2 30B-A3B, retaining
`0.6` for 1.8B/7B. Temperature remains 0.7 there. Prompt revision is 11.
This is the only production behavior change in this follow-up.

## Direct protected translation

The existing opt-in 15-case test exercised the actual `translateUnits` and
provider pipeline, including protected names and UUIDs:

| Model | Expected name substrings | Source fallbacks | Total elapsed |
| --- | --- | --- | --- |
| 1.8B Q8_0 | 6/15 | 7 | 41.2 s |
| 30B-A3B APEX-I-Nano | 10/15 | 5 | 47.6 s |

Both language tests failed. Times include loading, recursive splitting and
retries. The first 30B request took 16.8 seconds; this is not its warmed-up
per-sentence latency. These substring counts are not full language scores:
the 30B result for an imperative became “Cesta do … Družina se vydala na cestu”
despite containing the expected name form.

Captured single-item XML responses confirmed real structure loss: APEX sometimes
removed the entire name element, including its ID. The parser correctly rejected
this. It also returned valid XML in another probe, which decoded successfully.
No guard was relaxed to accept ambiguous missing-name structure.

## Whole-sentence experiment

`scripts/benchmark-sentence-repair.mjs` compares three modes on nine examples:

1. Direct translation with a glossary.
2. Repair of that model's own generated translation.
3. Repair of a supplied draft with known faults, or a correct control draft.

Cases cover the dashboard example, a changed grammatical gender with a following
pronoun, plural agreement, Permoníci, ownership, quantity/negation/prepositions,
mixed EXACT and inflected names, an already correct passage, and a UUID label.
These are unprotected prompt experiments, not the production pipeline. Names,
meaning and syntax were inspected manually; there is no automatic semantic score.

An initial Czech-language instruction probe on 1.8B mostly echoed the task. The
three-model baseline therefore uses English instructions carrying the same
whole-sentence requirement. Its second pass repaired the dashboard and agreement
on 7B/30B, but left reversed ownership in place. The 7B model also leaked the word
EXACT into unrelated sentences and replaced Permoníci with Delverové.

The refined `source-first` variant uses the publisher's background/source layout:
the draft and terminology are background, and the English original is explicitly
authoritative. It includes EXACT and UUID instructions only when relevant.
This experiment also changes temperature from 0.7 to 0. **Prompt and sampling
changed together**, so improvements cannot be attributed to either alone.

Observed supplied-draft repairs with that variant:

| Draft / required change | 7B result | APEX-I-Nano result |
| --- | --- | --- |
| Nová nástěnka byla vytvořena → řídicí panel | Nový řídicí panel byl vytvořen. | Byl vytvořen nový řídicí panel. |
| Zraněná Ledová Strážkyně dorazila. Byla vyčerpaná. → Mrazový Strážce | Correct name, masculine adjective, verb and following agreement | Correct name and masculine agreement |
| Lesní Duch byl unavený, ale neodešel. → plural in English | Lesní Duchové byli unavení, ale neodešli. | Same correction |
| Stopám patří Přízračné Šelmy. → tracks belong to creatures | Stopy patří Přízračným Šelmám. | Ty stopy patří Přízračným Šelmám. |
| Missing “only”; z Starého Carinthu | Added Jen and corrected ze, preserving negation | Added pouze but retained z Starého |
| Bojují proti Permonícům. | Still wrong | Still wrong |
| EXACT Dawn Star plus inflected Starý Carinth | EXACT retained; Carinth left uninflected after do | Same remaining inflection issue |
| UUID label needing genitive | Syntax retained; label left in nominative | Syntax retained; label left in nominative |

The 1.8B model remained fast but often ignored or changed approved vocabulary,
including `Spirit Beests`, `Delversům` and `Dawn Staru` despite EXACT. It is not
selected for the reviewed glossary on this evidence.

Second-pass timing in the refined experiment (nine short requests per column):

| Model | Median repair of generated draft | Median repair of supplied draft |
| --- | --- | --- |
| 1.8B Q8_0 | 0.103 s | 0.119 s |
| 7B Q8_0 | 0.271 s | 0.286 s |
| APEX-I-Nano | 0.389 s | 0.387 s |

These are small warmed-up requests, not whole-adventure throughput estimates.
They show that APEX is not necessarily slow for this task. Its protected-output
reliability still matters more than this latency. Each combination was sampled
once; the temperature-zero requests are not proof of universal determinism.

## Decision

Retain the whole-sentence repair approach for further development, with the
English original as the authority and only relevant glossary entries. The
experiment demonstrates repairs beyond noun substitution. Do not automatically
accept every second-pass response: existing name/structure guards are still
required and cannot establish semantic correctness. Even a structurally valid
repair can preserve a wrong case or add emphasis absent from the original.

Keep 7B as the current smaller-model baseline, with APEX as a viable comparison
candidate rather than dismissing it for size. Do not select 1.8B for this glossary
yet. No automatic naming, per-benchmark word replacement, weaker validation,
live import, release or Foundry setting change was introduced. PR #19 stays draft.

## Reproduction and validation

```sh
LM_STUDIO_MODEL=hy-mt2-30b-a3b-apex LM_STUDIO_RESULT=/tmp/inflection-apex.json npm test -- tests/local-inflection.integration.test.ts
LM_STUDIO_MODEL=hy-mt2-7b LM_STUDIO_RESULT=/tmp/repair-baseline.json node scripts/benchmark-sentence-repair.mjs
LM_STUDIO_MODEL=hy-mt2-7b LM_REPAIR_PROMPT=source-first LM_REPAIR_TEMPERATURE=0 LM_STUDIO_RESULT=/tmp/repair-refined.json node scripts/benchmark-sentence-repair.mjs
```

Replace the model ID to compare variants. The script saves prompts, complete
final answers, timings and sampling options; it never changes Foundry. It skips
repairing excessively long generated responses rather than treating a prompt
echo as an ordinary draft. Supplied-draft repair still runs for those cases.

`npm run check`: typecheck, 290 unit tests and build passed; two opt-in integration
tests skipped in normal CI. The two explicit real-model integration runs above
failed quality assertions, as recorded. Release metadata verification passed.

Evidence in [sentence-repair-2026-09-21](sentence-repair-2026-09-21/): model-info,
both production reports, the initial Czech probe, English baselines and refined
runs for all three models, and the APEX XML diagnosis. Reports contain synthetic
examples and final responses, not private adventure exports or hidden reasoning.
