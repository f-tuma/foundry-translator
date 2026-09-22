# Laya translation-review assessment — 2026-09-22

The installed LM Studio entry `laya-multilingual` was identified as publisher
`mys`, architecture `ggmlc`, F16, 663,262,880 bytes. A synthetic English/Czech
negation-check request to the local `/v1/chat/completions` endpoint failed at
model loading. No decision output or translation accuracy was measured.

The [exact GGUF model card](https://huggingface.co/mys/laya-multilingual-GGUF)
identifies this as a 322M mmBERT encoder with a 1,024-token context. It scores typed
questions rather than generating translations. Its files require the separate
`ggmlc` Laya runtime; the card explicitly says they cannot load in llama.cpp.
The supplied server uses `/api/decide`, not OpenAI chat completions.

The [upstream Laya project](https://github.com/NandhaKishorM/laya) warns that shipped
probabilities can be overconfident and that multilingual calibration is not fitted.
A high score alone is therefore not evidence that a Czech translation is correct.

A possible future use is flagging meaning changes, lost negation, numbers or
speaker/subject swaps in source/translation pairs. This is a hypothesis, not a
verified quality improvement. It cannot supply missing Ember lore and should not
authorize writes, silently rewrite reviewed text or change glossary entries.

Before integration: run the compatible local runtime, build a human-labelled
English/Czech evaluation set (including correct inflection and deliberately bad
translations), measure missed errors and false alarms, calibrate thresholds,
and compare latency and quality against the existing structural checks. Keep it
optional and informational until those results justify stronger behavior.
