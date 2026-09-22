import { normalizePassageContext, passageContextInstructions } from "../translation/passage-context";
import type { PassageContext } from "./types";
import type {
  ProviderRequestMetrics,
  TranslateRequest,
  TranslationProvider,
  TranslationResult,
} from "./types";
import { unmatchedGlossaryTokens } from "./inflection-prose";
import { prepareStructuredProse } from "./structured-items";
import { prepareInflectionXml } from "./inflection-xml";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_TEXTS_PER_REQUEST = 32;
const PROMPT_REVISION = 13;
const INFLECTION_INSTRUCTIONS = "Some __FTG_ markers form a pair: __FTG_NONCE_ID__Approved Czech Name__FTG_NONCE_IDEND__. The words inside each pair are an approved Czech glossary name, already translated. Keep BOTH markers unchanged and in place around that name. Use this exact vocabulary; only inflect its words to the grammatical case required by the surrounding Czech sentence. Do not rename, translate again, add or remove words inside a pair. For example: to __FTG_X_0000__Starý Carinth__FTG_X_0000END__ becomes do __FTG_X_0000__Starého Carinthu__FTG_X_0000END__. A standalone title keeps the canonical form. Adapt surrounding articles, prepositions, gender and agreement naturally. Fixed markers without an END partner remain opaque and unchanged.";
const OUTPUT_TOKEN_LIMITS = [4_096, 8_192] as const;
const BATCH_TOKEN_PATTERN = /__FTB_[A-Z0-9]+_[A-Z0-9]{4}__/gu;

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

interface PendingTranslation {
  text: string;
  index: number;
}

interface ChatCompletionPayload {
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  error?: { message?: unknown };
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    completion_tokens_details?: { reasoning_tokens?: unknown };
  };
}

interface ModelsPayload {
  data?: Array<{ id?: unknown }>;
  error?: { message?: unknown };
}

interface LmStudioChatPayload {
  output?: Array<{ type?: unknown; content?: unknown }>;
  stats?: {
    input_tokens?: unknown;
    total_output_tokens?: unknown;
    reasoning_output_tokens?: unknown;
    tokens_per_second?: unknown;
  };
  error?: unknown;
}

interface LmStudioStreamEvent {
  type?: unknown;
  content?: unknown;
  result?: unknown;
  error?: { message?: unknown };
}

function textFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export interface OpenAiCompatibleProviderOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  worldContext?: string;
  fetchImplementation?: FetchImplementation;
  onMetrics?: (metrics: ProviderRequestMetrics) => void;
}

export class OpenAiCompatibleTranslationError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "OpenAiCompatibleTranslationError";
    this.status = status;
  }
}

async function readLmStudioEventStream(
  response: Response,
  onMessage: (content: string) => void,
): Promise<LmStudioChatPayload> {
  if (!response.body) {
    throw new OpenAiCompatibleTranslationError(
      "LM Studio vrátil stream bez čitelného těla.",
      response.status,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let message = "";
  let result: LmStudioChatPayload | undefined;
  let streamError = "";

  const consume = (finished = false): void => {
    if (finished) buffer += "\n\n";
    while (true) {
      const boundary = buffer.match(/\r?\n\r?\n/u);
      if (boundary?.index === undefined) break;
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = block
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      let event: LmStudioStreamEvent;
      try {
        event = JSON.parse(data) as LmStudioStreamEvent;
      } catch {
        continue;
      }
      if (event.type === "message.delta" && typeof event.content === "string") {
        message += event.content;
        onMessage(message);
      } else if (event.type === "chat.end" && event.result && typeof event.result === "object") {
        result = event.result as LmStudioChatPayload;
      } else if (event.type === "error" && typeof event.error?.message === "string") {
        streamError = event.error.message;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    consume();
  }
  buffer += decoder.decode();
  consume(true);
  if (result) return result;
  throw new OpenAiCompatibleTranslationError(
    streamError || "LM Studio stream skončil bez závěrečné odpovědi chat.end.",
    response.status,
  );
}

export function normalizedBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new OpenAiCompatibleTranslationError(
      "OpenAI-compatible Base URL není platná adresa.",
      0,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OpenAiCompatibleTranslationError("Base URL musí používat HTTP nebo HTTPS.", 0);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new OpenAiCompatibleTranslationError(
      "Base URL nesmí obsahovat přihlašovací údaje, query ani fragment.",
      0,
    );
  }
  const normalized = url.toString().replace(/\/$/u, "");
  return url.pathname === "/" ? `${normalized}/v1` : normalized;
}

function languageLabel(code: string | undefined): string {
  if (!code || code === "auto") return "the detected source language";
  return ({ en: "English", cs: "Czech", de: "German", fr: "French", pl: "Polish" } as
    Record<string, string>)[code] ?? code;
}

function createBatchTokens(count: number): string[] {
  const nonce = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return Array.from(
    { length: count + 1 },
    (_, index) => `__FTB_${nonce}_${index.toString(36).toUpperCase().padStart(4, "0")}__`,
  );
}

function combineBatch(texts: readonly string[], boundaryTokens: readonly string[]): string {
  return texts.map((text, index) => `${boundaryTokens[index]}${text}`).join("") +
    boundaryTokens.at(-1);
}

function splitBatch(text: string, boundaryTokens: readonly string[]): string[] | null {
  BATCH_TOKEN_PATTERN.lastIndex = 0;
  const found = [...text.matchAll(BATCH_TOKEN_PATTERN)].map(([token]) => token);
  if (
    found.length !== boundaryTokens.length ||
    !boundaryTokens.every((token, index) => token === found[index])
  ) {
    return null;
  }

  const starts: number[] = [];
  let cursor = 0;
  for (const token of boundaryTokens) {
    const position = text.indexOf(token, cursor);
    if (position < 0) return null;
    starts.push(position);
    cursor = position + token.length;
  }
  const firstStart = starts[0] ?? 0;
  const lastStart = starts.at(-1) ?? text.length;
  if (text.slice(0, firstStart).trim() ||
    text.slice(lastStart + (boundaryTokens.at(-1)?.length ?? 0)).trim()) {
    return null;
  }
  return boundaryTokens.slice(0, -1).map((token, index) => {
    const start = (starts[index] ?? 0) + token.length;
    const end = starts[index + 1] ?? text.length;
    return text.slice(start, end);
  });
}

export class OpenAiCompatibleProvider implements TranslationProvider {
  readonly supportsPassageContext = true;
  readonly supportsGlossaryInflection = true;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #apiKey: string;
  readonly #worldContext: string;
  readonly #fetch: FetchImplementation;
  readonly #onMetrics: ((metrics: ProviderRequestMetrics) => void) | undefined;
  #lmStudioNativeAvailable: boolean | undefined;
  #adaptiveBatchSize = MAX_TEXTS_PER_REQUEST;
  readonly #rejectedDrafts = new Map<string, string>();
  readonly cacheIdentity: string;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.#baseUrl = normalizedBaseUrl(options.baseUrl);
    this.#model = options.model.trim();
    this.#apiKey = options.apiKey?.trim() ?? "";
    this.#worldContext = options.worldContext?.trim().slice(0, 6_000) ?? "";
    this.#fetch = options.fetchImplementation ?? ((input, init) =>
      foundry.utils.fetchWithTimeout(input, init, { timeoutMs: REQUEST_TIMEOUT_MS }));
    this.#onMetrics = options.onMetrics;
    this.cacheIdentity = `openai-compatible:${this.#baseUrl}:${this.#model}:context-${textFingerprint(this.#worldContext)}:prompt-${PROMPT_REVISION}`;
  }

  rejectedGlossaryTokens(text: string, references: readonly NonNullable<TranslateRequest["inflections"]>[number][], context?: PassageContext): readonly string[] {
    const draft = this.#rejectedDrafts.get(this.#draftKey(text, context));
    return draft ? unmatchedGlossaryTokens(draft, references) : [];
  }

  #draftKey(text: string, context?: PassageContext): string {
    return JSON.stringify([text, normalizePassageContext(context)]);
  }

  async translate(request: TranslateRequest): Promise<TranslationResult[]> {
    if (request.contexts && request.contexts.length !== request.texts.length) throw new Error("Passage context count does not match source items.");
    this.#validateRequest(request);
    const results: TranslationResult[] = request.texts.map((text) => ({ translatedText: text }));
    const pending = request.texts
      .map((text, index) => ({ text, index }))
      .filter(({ text }) => Boolean(text) && !/^\s*(?:__(?:FTG|FTS|FTN)_[A-Z0-9]+_[A-Z0-9]+__\s*)+$/u.test(text));

    // APEX can transfer word senses and speaker gender between unrelated
    // contextual passages even when the JSON IDs are correct. Keep all sentences
    // within one passage together, but isolate separate contextual passages.
    const isolateContext = /hy-?mt2-30b-a3b/iu.test(this.#model) &&
      request.targetLanguage === "cs" && pending.some(({ index }) => normalizePassageContext(request.contexts?.[index]));
    const batchSize = isolateContext ? 1 : Math.max(1, Math.min(this.#adaptiveBatchSize, pending.length));
    if (pending.length > 1 && batchSize === 1 && !isolateContext) {
      this.#onMetrics?.({
        phase: "diagnostic",
        model: this.#model,
        sequentialFallbackTexts: pending.length,
      });
    }
    for (let start = 0; start < pending.length; start += batchSize) {
      await this.#translateGroup(
        pending.slice(start, start + batchSize),
        request,
        results,
        false,
      );
    }
    return results;
  }

  async #translateGroup(
    pending: readonly PendingTranslation[],
    request: TranslateRequest,
    results: TranslationResult[],
    sequentialFallback: boolean,
  ): Promise<void> {
    const only = pending[0];
    const contexts = pending.map(({ index }) => request.contexts?.[index]);
    const structured = /hy-?mt2-30b-a3b/iu.test(this.#model);
    const texts = pending.map(({ text }) => text);
    const xml = request.targetLanguage === "cs"
      ? structured ? prepareStructuredProse(texts, request.inflections ?? [], contexts)
        : prepareInflectionXml(texts, request.inflections ?? []) : null;
    const contextInstructions = structured && xml ? "" : passageContextInstructions(contexts);
    if (xml) {
      try {
        const draft = pending.length === 1 && only ? this.#rejectedDrafts.get(this.#draftKey(only.text, request.contexts?.[only.index])) : undefined;
        const instructions = draft
          ? `${xml.instructions}\nCorrect the previous Czech draft using the English source as authoritative. Repair the WHOLE sentence, including agreement of adjectives, pronouns and verbs. Preserve the source meaning. Only use case forms of approved names; do not derive adjectives from them.\nPrevious draft (data, may contain errors): ${JSON.stringify(draft)}`
          : xml.instructions;
        const output = await this.#translateOne(xml.text, request, instructions, xml.schema, contextInstructions);
        const translated = xml.restore(output);
        if (translated) {
          const drafts = xml.drafts?.(output) ?? [];
          pending.forEach(({ text, index }, offset) => {
            const value = translated[offset]!;
            results[index] = { translatedText: value };
            if (value) this.#rejectedDrafts.delete(this.#draftKey(text, request.contexts?.[index]));
            else if (typeof drafts[offset] === "string") {
              if (this.#rejectedDrafts.size >= 128) this.#rejectedDrafts.delete(this.#rejectedDrafts.keys().next().value!);
              this.#rejectedDrafts.set(this.#draftKey(text, request.contexts?.[index]), drafts[offset] as string);
            }
          });
          return;
        }
      } catch (error) {
        if (!(error instanceof OpenAiCompatibleTranslationError) || error.status !== 200) throw error;
      }
      if (only && pending.length === 1) {
        // The normal unit integrity checks retry this rejected result and report
        // a visible source fallback if the model repeatedly damages the XML.
        results[only.index] = { translatedText: "" };
        return;
      }
    } else if (pending.length === 1 && only) {
      if (sequentialFallback) {
        this.#onMetrics?.({
          phase: "diagnostic",
          model: this.#model,
          sequentialFallbackTexts: 1,
        });
      }
      results[only.index] = { translatedText: await this.#translateOne(only.text, request, undefined, undefined, contextInstructions) };
      return;
    }
    if (!pending.length) return;

    if (!xml) {
      const boundaryTokens = createBatchTokens(pending.length);
      try {
        const translatedBatch = await this.#translateOne(
          combineBatch(pending.map(({ text }) => text), boundaryTokens),
          request, undefined, undefined, contextInstructions,
        );
        const translated = splitBatch(translatedBatch, boundaryTokens);
        if (translated) {
          pending.forEach(({ index }, resultIndex) => {
            results[index] = { translatedText: translated[resultIndex] ?? "" };
          });
          return;
        }
      } catch (error) {
        // Provider/network errors still propagate. Only a completed but unusable
        // generation is safe to retry as smaller independent batches.
        if (!(error instanceof OpenAiCompatibleTranslationError) || error.status !== 200) {
          throw error;
        }
      }
    }

    this.#onMetrics?.({
      phase: "diagnostic",
      model: this.#model,
      batchFallbacks: 1,
    });
    const smallerBatchSize = Math.max(1, Math.ceil(pending.length / 2));
    // A recursively split sub-batch may need to reach individual texts, but
    // that one malformed response must not poison the whole provider session
    // into thousands of one-text requests. Degrade the remembered size only
    // once for the original request; recursive recovery stays local to it.
    if (!sequentialFallback) {
      this.#adaptiveBatchSize = Math.min(this.#adaptiveBatchSize, smallerBatchSize);
    }
    const midpoint = Math.ceil(pending.length / 2);
    // LM Studio serializes generation internally; recurse sequentially rather
    // than filling its queue. Successful halves avoid N one-text requests.
    await this.#translateGroup(pending.slice(0, midpoint), request, results, true);
    await this.#translateGroup(pending.slice(midpoint), request, results, true);
  }

  async testConnection(targetLanguage: string): Promise<void> {
    this.#validateConfiguration();
    const response = await this.#request(`${this.#baseUrl}/models`, { method: "GET" });
    const payload = await this.#readJson<ModelsPayload>(response);
    if (!response.ok) throw this.#httpError(response.status, payload.error?.message);
    const modelIds = payload.data?.map(({ id }) => id).filter((id): id is string =>
      typeof id === "string") ?? [];
    if (!modelIds.includes(this.#model)) {
      throw new OpenAiCompatibleTranslationError(
        `Model „${this.#model}“ server nenabízí. Dostupné modely: ${modelIds.join(", ") || "žádné"}.`,
        response.status,
      );
    }
    const sourceLanguage = targetLanguage === "en" ? "cs" : "en";
    await this.translate({
      texts: [sourceLanguage === "en" ? "Connection test." : "Test připojení."],
      sourceLanguage,
      targetLanguage,
      format: "text",
    });
  }

  async generateWorldContext(sourceMaterial: string, targetLanguage: string): Promise<string> {
    this.#validateConfiguration();
    if (!sourceMaterial.trim()) {
      throw new OpenAiCompatibleTranslationError("Pro vytvoření profilu světa chybí zdrojový text.", 0);
    }
    const target = languageLabel(targetLanguage);
    const response = await this.#request(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({
        model: this.#model,
        messages: [{
          role: "user",
          content: `${[
            `Create a concise translation context profile written in ${target}.`,
            "The supplied Foundry material is an intentionally incomplete mix of keyword-selected lore or guide passages and random excerpts and names.",
            "Use repeated patterns across both selected and random evidence to infer a useful broad world profile; cautious high-level inferences are allowed.",
            "Do not overfit the profile to one adventure, location, faction, or sampled passage, and do not present the sample as exhaustive.",
            "Never guess a game system from generic RPG terminology; name it only when the sample metadata identifies it.",
            "Cover genre, setting, tone, recurring factions and proper names, terminology style, and translation guidance.",
            "Preserve proper nouns exactly unless the evidence explicitly supplies an established translation.",
            "Do not invent specific lore or add commentary about the task. Return at most 300 words of plain text.",
          ].join(" ")}\n\n<foundry_world_sample>\n${sourceMaterial.slice(0, 12_000)}\n</foundry_world_sample>`,
        }],
        temperature: 0.2,
        max_tokens: 2_048,
        stream: false,
      }),
    });
    const payload = await this.#readJson<ChatCompletionPayload>(response);
    if (!response.ok) throw this.#httpError(response.status, payload.error?.message);
    const result = payload.choices?.[0]?.message?.content;
    if (typeof result !== "string" || !result.trim()) {
      throw new OpenAiCompatibleTranslationError("Model nevytvořil použitelný profil světa.", response.status);
    }
    return result.trim().slice(0, 6_000);
  }

  async #translateOne(text: string, request: TranslateRequest, xmlInstructions?: string, schema?: Record<string, unknown>, contextInstructions = ""): Promise<string> {
    const source = languageLabel(request.sourceLanguage);
    const target = languageLabel(request.targetLanguage);
    const terminology = request.targetLanguage === "cs" ? [
      /\bparty\b/iu.test(text) ? "When party occurs in the source, translate it as družina." : "",
      /\bchecks?\b/iu.test(text) ? "When a game check occurs in the source, translate it as ověření." : "",
    ].filter(Boolean).join(" ") : "";
    const inflection = request.targetLanguage === "cs" && /__FTG_[A-Z0-9]+_[A-Z0-9]+END__/iu.test(text)
      ? INFLECTION_INSTRUCTIONS : "";
    const system = [
      `Translate from ${source} to ${target}.`,
      "Return only the translated text, without commentary, labels, or Markdown fences.",
      "Do not include the text_to_translate wrapper in the response.",
      "Translate directly; do not explain, analyze, or reason about the translation in the response.",
      ...(xmlInstructions ? [xmlInstructions] : [
        "Preserve every token beginning with __FTN_, __FTG_, __FTS_, or __FTB_ byte-for-byte, exactly once, and in the original order.",
        "FTB tokens delimit independent translation items. Translate every item independently and never move words across an FTB boundary.",
      ]),
      "Preserve the meaning, tone, paragraph structure, and surrounding whitespace.",
      "Keep other proper names in their original spelling. Translate ordinary roles and game terms.",
      ...(inflection ? [inflection] : []),
      "This is a tabletop roleplaying adventure. Use fluent narration suitable for reading aloud and precise game instructions.",
      ...(request.targetLanguage === "cs" ? [
        "Use idiomatic, grammatically correct Czech. Silently check spelling before returning the translation.", terminology,
      ] : []),
      ...(this.#worldContext
        ? [`World and translation context:\n${this.#worldContext}`]
        : []),
      contextInstructions,
      // Glossary terms have already been replaced with protected FTG tokens
      // by unit-translator and are restored deterministically afterwards.
      // Repeating the entire glossary here only wastes input tokens.
    ].join(" ");
    // Qwen3.8 defaults to xhigh reasoning in LM Studio, which can exhaust the
    // request timeout before returning a translation. Native chat can disable it.
    if (/(?:\bgemma-4\b|\bqwen3\.8\b)/iu.test(this.#model) && this.#lmStudioNativeAvailable !== false) {
      const native = await this.#translateWithLmStudioNative(text, system);
      if (native !== null) return native;
    }
    if (/\bgemma-4-e2b\b/iu.test(this.#model)) {
      const structured = await this.#translateWithStructuredOutput(text, system);
      if (structured !== null) return structured;
    }
    let lastDetail = "";
    const translationModel = /(?:^|\/)hy-?mt(?:2|1\.5)(?:-|$)/iu.test(this.#model);
    for (const [attemptIndex, maxTokens] of OUTPUT_TOKEN_LIMITS.entries()) {
      if (attemptIndex > 0) {
        this.#onMetrics?.({
          phase: "diagnostic",
          model: this.#model,
          responseRetries: 1,
        });
      }
      const startedAt = Date.now();
      this.#onMetrics?.({ phase: "started", model: this.#model });
      let response: Response;
      let payload: ChatCompletionPayload;
      try {
        response = await this.#request(`${this.#baseUrl}/chat/completions`, {
          method: "POST",
          body: JSON.stringify({
            model: this.#model,
            messages: translationModel ? [{
              // Hy-MT's documented template puts translation instructions in
              // the user message. Its sampling defaults also avoid degenerate
              // greedy decoding on long delimiter-heavy batches.
              role: "user",
              content: xmlInstructions
                ? `${this.#worldContext ? `[Background Information]\n${this.#worldContext}\n\n` : ""}Translate from ${source} into ${target} for a fantasy roleplaying adventure. ${terminology}\n${xmlInstructions}${contextInstructions}\n\n${text}`
                : `${this.#worldContext ? `[Background Information]\n${this.#worldContext}\n\n` : ""}Translate the following text from ${source} into ${target}. Output only the translation.\nKeep other proper names unchanged. Preserve every __FTN_, __FTG_, __FTS_ and __FTB_ token exactly once in its original order. FTB tokens separate independent items; never move text between items. Preserve paragraph structure. Use fluent narration and precise game terminology.${terminology ? ` ${terminology}` : ""}${inflection ? `\n${inflection}` : ""}${contextInstructions}\n\n[Source Text]\n${text}`,
            }] : [
              { role: "system", content: system },
              { role: "user", content: `<text_to_translate>\n${text}\n</text_to_translate>` },
            ],
            ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "translation_items", strict: true, schema } } } : {}),
            temperature: schema ? 0 : translationModel ? 0.7 : 0,
            // Tencent recommends full nucleus sampling for the 30B MoE;
            // 1.8B and 7B retain their documented narrower distribution.
            ...(translationModel ? { top_p: /hy-?mt2-30b-a3b/iu.test(this.#model) ? 1 : 0.6 } : {}),
            max_tokens: maxTokens,
            stream: false,
          }),
        });
        payload = await this.#readJson<ChatCompletionPayload>(response);
      } catch (error) {
        this.#onMetrics?.({
          phase: "failed",
          model: this.#model,
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }

      const metrics = this.#completionMetrics(payload, Date.now() - startedAt);
      if (!response.ok) {
        this.#onMetrics?.({ phase: "failed", model: this.#model, ...metrics });
        throw this.#httpError(response.status, payload.error?.message);
      }
      this.#onMetrics?.({ phase: "completed", model: this.#model, ...metrics });

      const translated = payload.choices?.[0]?.message?.content;
      const finishReason = metrics.finishReason ?? "unknown";
      if (typeof translated === "string" && translated.trim() && finishReason !== "length") {
        return translated;
      }
      const reasoning = metrics.reasoningTokens ?? 0;
      lastDetail = finishReason === "length"
        ? `výstup narazil na limit ${maxTokens} tokenů`
        : reasoning > 0
          ? `model spotřeboval ${reasoning} tokenů na reasoning, ale nevrátil překlad`
          : "odpověď neobsahovala text překladu";
    }
    throw new OpenAiCompatibleTranslationError(
      `OpenAI-compatible server dvakrát nevrátil úplný překlad (${lastDetail}). Zkuste model bez reasoningu nebo kratší kontext světa.`,
      200,
    );
  }

  async #translateWithStructuredOutput(text: string, system: string): Promise<string | null> {
    const startedAt = Date.now();
    this.#onMetrics?.({ phase: "started", model: this.#model });
    let response: Response;
    let payload: ChatCompletionPayload;
    try {
      response = await this.#request(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
          model: this.#model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: text },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "translation_response",
              strict: true,
              schema: {
                type: "object",
                properties: { translation: { type: "string" } },
                required: ["translation"],
                additionalProperties: false,
              },
            },
          },
          temperature: 0,
          max_tokens: 4_096,
          stream: false,
        }),
      });
      payload = await this.#readJson<ChatCompletionPayload>(response);
    } catch (error) {
      this.#onMetrics?.({
        phase: "failed",
        model: this.#model,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
    const metrics = this.#completionMetrics(payload, Date.now() - startedAt);
    if (!response.ok) {
      this.#onMetrics?.({ phase: "failed", model: this.#model, ...metrics });
      if ([400, 404, 405, 422].includes(response.status)) return null;
      throw this.#httpError(response.status, payload.error?.message);
    }
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      try {
        const parsed = JSON.parse(content) as { translation?: unknown };
        if (typeof parsed.translation === "string" && parsed.translation.trim()) {
          this.#onMetrics?.({ phase: "completed", model: this.#model, ...metrics });
          return parsed.translation;
        }
      } catch {
        // A nominally compatible server may ignore response_format. Its plain
        // response is handled by the established native/fallback path below.
      }
    }
    this.#onMetrics?.({ phase: "failed", model: this.#model, ...metrics });
    return null;
  }

  async #translateWithLmStudioNative(text: string, system: string): Promise<string | null> {
    const url = new URL(this.#baseUrl);
    const startedAt = Date.now();
    this.#onMetrics?.({ phase: "started", model: this.#model });
    let response: Response;
    try {
      response = await this.#request(`${url.origin}/api/v1/chat`, {
        method: "POST",
        body: JSON.stringify({
          model: this.#model,
          system_prompt: system,
          input: `<text_to_translate>\n${text}\n</text_to_translate>`,
          temperature: 0,
          max_output_tokens: 4_096,
          reasoning: "off",
          stream: true,
          store: false,
        }),
      });
    } catch (error) {
      this.#onMetrics?.({
        phase: "failed",
        model: this.#model,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
    if (response.status === 404 || response.status === 405) {
      this.#lmStudioNativeAvailable = false;
      this.#onMetrics?.({
        phase: "failed",
        model: this.#model,
        durationMs: Date.now() - startedAt,
      });
      this.#onMetrics?.({
        phase: "diagnostic",
        model: this.#model,
        nativeFallbacks: 1,
      });
      return null;
    }

    let lastProgressAt = 0;
    let lastProgressCharacters = 0;
    const contentType = response.headers.get("Content-Type") ?? "";
    let payload: LmStudioChatPayload;
    try {
      payload = contentType.includes("text/event-stream")
        ? await readLmStudioEventStream(response, (content) => {
            const now = Date.now();
            if (
              lastProgressCharacters > 0 &&
              now - lastProgressAt < 150 &&
              content.length - lastProgressCharacters < 100
            ) return;
            lastProgressAt = now;
            lastProgressCharacters = content.length;
            this.#onMetrics?.({
              phase: "progress",
              model: this.#model,
              durationMs: now - startedAt,
              streamedCharacters: content.length,
            });
          })
        : await this.#readJson<LmStudioChatPayload>(response);
    } catch (error) {
      this.#onMetrics?.({
        phase: "failed",
        model: this.#model,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
    const numeric = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const inputTokens = numeric(payload.stats?.input_tokens);
    const outputTokens = numeric(payload.stats?.total_output_tokens);
    const reasoningTokens = numeric(payload.stats?.reasoning_output_tokens);
    const tokensPerSecond = numeric(payload.stats?.tokens_per_second);
    const durationMs = Date.now() - startedAt;
    const telemetry = {
      durationMs,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
    };
    if (!response.ok) {
      this.#onMetrics?.({ phase: "failed", model: this.#model, ...telemetry });
      throw this.#httpError(response.status, payload.error);
    }
    this.#lmStudioNativeAvailable = true;
    const translated = payload.output?.find(({ type }) => type === "message")?.content;
    if (typeof translated === "string" && translated.trim()) {
      this.#onMetrics?.({
        phase: "completed",
        model: this.#model,
        finishReason: "stop",
        ...telemetry,
      });
      return translated;
    }
    this.#onMetrics?.({ phase: "failed", model: this.#model, ...telemetry });
    this.#onMetrics?.({
      phase: "diagnostic",
      model: this.#model,
      nativeFallbacks: 1,
    });
    return null;
  }

  #completionMetrics(
    payload: ChatCompletionPayload,
    durationMs: number,
  ): Omit<ProviderRequestMetrics, "phase" | "model"> {
    const number = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const finishReason = payload.choices?.[0]?.finish_reason;
    const inputTokens = number(payload.usage?.prompt_tokens);
    const outputTokens = number(payload.usage?.completion_tokens);
    const reasoningTokens = number(payload.usage?.completion_tokens_details?.reasoning_tokens);
    return {
      durationMs,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      ...(typeof finishReason === "string" ? { finishReason } : {}),
    };
  }

  #validateConfiguration(): void {
    if (!this.#model) {
      throw new OpenAiCompatibleTranslationError("Název lokálního modelu není vyplněný.", 0);
    }
  }

  #validateRequest(request: TranslateRequest): void {
    this.#validateConfiguration();
    if (!request.targetLanguage.trim()) {
      throw new OpenAiCompatibleTranslationError("Cílový jazyk není vybraný.", 0);
    }
    if (request.format === "html") {
      throw new OpenAiCompatibleTranslationError(
        "OpenAI-compatible provider přijímá pouze předem chráněný text.",
        0,
      );
    }
    if (!request.texts.length || request.texts.length > MAX_TEXTS_PER_REQUEST) {
      throw new OpenAiCompatibleTranslationError(
        `Jeden požadavek musí obsahovat 1 až ${MAX_TEXTS_PER_REQUEST} textů.`,
        0,
      );
    }
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    if (this.#apiKey) headers.set("Authorization", `Bearer ${this.#apiKey}`);
    try {
      return await this.#fetch(url, { ...init, headers });
    } catch (error) {
      throw new OpenAiCompatibleTranslationError(
        "Lokální OpenAI-compatible server není dostupný. Zkontrolujte adresu, spuštěný server a CORS.",
        0,
        { cause: error },
      );
    }
  }

  async #readJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch (error) {
      throw new OpenAiCompatibleTranslationError(
        "OpenAI-compatible server nevrátil platný JSON.",
        response.status,
        { cause: error },
      );
    }
  }

  #httpError(status: number, message: unknown): OpenAiCompatibleTranslationError {
    if (
      this.#model.toLocaleLowerCase().includes("translategemma") &&
      typeof message === "string" &&
      /prompt|content|source_lang_code/iu.test(message)
    ) {
      return new OpenAiCompatibleTranslationError(
        "Výchozí LM Studio šablona TranslateGemma není kompatibilní se standardním OpenAI Chat API. Použijte běžný instruction model (Gemma/Qwen) nebo kompatibilní vlastní prompt template.",
        status,
      );
    }
    return new OpenAiCompatibleTranslationError(
      typeof message === "string" ? message : `OpenAI-compatible server vrátil HTTP ${status}.`,
      status,
    );
  }
}
