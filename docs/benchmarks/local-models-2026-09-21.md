# Local translation model review, checked 2026-09-21

This shortlist follows a fresh review of the publishers' model cards, files and
LM Studio catalogue. It is a test order for this project, not a claim that a
newer release automatically has better Czech. Current host verified with
nvidia-smi: RTX 5070 Ti, 16,303 MiB VRAM; RAM about 64 GB, Intel Ultra 7 265K.
Model file size is not total runtime memory; context, buffers and other loaded
models also consume VRAM.

Follow-up: the user prefers smaller, faster models and installed MiLMMT 12B.
Its Q4_K_S build was tested with the documented raw-completion prompt. Ordinary
prose was fast, but it ignored approved glossary names and corrupted markup.
See [the MiLMMT evaluation](milmmt-2026-09-21.md). Hy-MT2 7B remains the current
smaller-model baseline. The larger candidates below are optional research
alternatives, not required next downloads.

| Candidate | Verified availability and fit | Decision |
| --- | --- | --- |
| Gemma 4 26B-A4B QAT Q4_0 | Official Google GGUF: main file 14.4 GB; larger family member than the tested 12B | Previously requested, now optional given the smaller-model preference; not tested yet |
| Hy-MT2 30B-A3B | Tencent translation specialist; official Q4_K_M 18.2 GB; Czech listed by publisher | Second candidate; exceeds this GPU's VRAM before context, needs partial RAM offload |
| MiLMMT-46-12B v1.0 | Xiaomi's August 2026 post-training release, explicitly supports Czech; based on Gemma3-12B | Tested community Q4_K_S: fast plain prose, unreliable glossary and markup; not selected |
| Qwen3.8-27B | Current local LM Studio model, updated August 17; already installed Q4_K_M with MTP | Retest with improved input representation; initial inflection failures do not rule out other settings |
| TranslateGemma 12B/27B | Google translation specialist with a dedicated language-code chat template | Secondary option; integration differs from generic chat, so not an immediate drop-in recommendation |
| Qwen3.8-LiveTranslate | September 18 announcement, speech interpretation with a DashScope real-time API | Different deployment/task from local Foundry text translation; no local GGUF confirmed in reviewed sources |

Earlier Gemma download request (optional; smaller-model work can continue):

- Repository: `google/gemma-4-26B-A4B-it-qat-q4_0-gguf`
- Main file: `gemma-4-26B_q4_0-it.gguf` (14.4 GB)
- The separate mmproj file serves image input; it is not the text model.

Primary sources (accessed 2026-09-21):

- [Google official Gemma QAT files](https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf/tree/main)
- [Google Gemma model overview](https://ai.google.dev/gemma/docs/core)
- [Tencent Hy-MT2 card: languages, terminology, structured-data prompts and sampling](https://huggingface.co/tencent/Hy-MT2-7B)
- [Tencent 30B-A3B GGUF files](https://huggingface.co/tencent/Hy-MT2-30B-A3B-GGUF/tree/main)
- [Xiaomi MiLMMT-46-12B v1.0 card](https://huggingface.co/xiaomi-research/MiLMMT-46-12B-v1.0)
- [MiLMMT v1.0 research paper](https://arxiv.org/abs/2608.10812)
- [Qwen3.8 in LM Studio](https://lmstudio.ai/models/qwen/qwen3.8-27b)
- [Qwen3.8-LiveTranslate announcement](https://qwen.ai/blog?id=qwen3.8-livetranslate)
- [Google TranslateGemma card](https://huggingface.co/google/translategemma-12b-it)

The initial diagnostic controls show that our previous representation matters:
Hy-MT2 translated the Spirit Beasts sentence correctly with an English source
and a separate terminology reference, but failed after long ASCII markers were
inserted. Replacing the markers with short XML tags also helped that sentence.
All of Hy-MT2, Gemma 4 12B and Qwen3.8 still struggled with Permoníci in short
nonreasoning prompts. This motivates testing both model choice and the input
representation, rather than attributing every failure to model capability.
