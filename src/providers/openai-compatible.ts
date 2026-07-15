import type {
  ProviderRequestMetrics,
  TranslateRequest,
  TranslationProvider,
  TranslationResult,
} from "./types";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_TEXTS_PER_REQUEST = 32;
const PROMPT_REVISION = 4;
const OUTPUT_TOKEN_LIMITS = [4_096, 8_192] as const;
const BATCH_TOKEN_PATTERN = /__FTB_[A-Z0-9]+_[A-Z0-9]{4}__/gu;

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

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

function normalizedBaseUrl(value: string): string {
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

function glossaryPrompt(
  glossary: TranslateRequest["glossary"],
): string {
  if (!glossary?.length) return "";
  return glossary
    .slice(0, 200)
    .map(({ source, replacement }) => `${source} => ${replacement || source}`)
    .join("\n")
    .slice(0, 6_000);
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
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #apiKey: string;
  readonly #worldContext: string;
  readonly #fetch: FetchImplementation;
  readonly #onMetrics: ((metrics: ProviderRequestMetrics) => void) | undefined;
  #lmStudioNativeAvailable: boolean | undefined;
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

  async translate(request: TranslateRequest): Promise<TranslationResult[]> {
    this.#validateRequest(request);
    const results: TranslationResult[] = request.texts.map((text) => ({ translatedText: text }));
    const pending = request.texts
      .map((text, index) => ({ text, index }))
      .filter(({ text }) => Boolean(text));

    if (pending.length > 1) {
      const boundaryTokens = createBatchTokens(pending.length);
      try {
        const translatedBatch = await this.#translateOne(
          combineBatch(pending.map(({ text }) => text), boundaryTokens),
          request,
        );
        const translated = splitBatch(translatedBatch, boundaryTokens);
        if (translated) {
          pending.forEach(({ index }, resultIndex) => {
            results[index] = { translatedText: translated[resultIndex] ?? "" };
          });
          return results;
        }
      } catch (error) {
        // A model may not support stable batch delimiters. Provider/network
        // errors still propagate; only a completed but unusable generation
        // falls back to the proven single-text path.
        if (!(error instanceof OpenAiCompatibleTranslationError) || error.status !== 200) {
          throw error;
        }
      }
    }

    // Local servers generally serialize generation internally. Keeping the
    // fallback sequential avoids filling their queue after a malformed batch.
    for (const { text, index } of pending) {
      results[index] = { translatedText: await this.#translateOne(text, request) };
    }
    return results;
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

  async #translateOne(text: string, request: TranslateRequest): Promise<string> {
    const source = languageLabel(request.sourceLanguage);
    const target = languageLabel(request.targetLanguage);
    const system = [
      `Translate from ${source} to ${target}.`,
      "Return only the translated text, without commentary, labels, or Markdown fences.",
      "Do not include the text_to_translate wrapper in the response.",
      "Translate directly; do not explain, analyze, or reason about the translation in the response.",
      "Preserve every token beginning with __FTN_, __FTG_, __FTS_, or __FTB_ byte-for-byte, exactly once, and in the original order.",
      "FTB tokens delimit independent translation items. Translate every item independently and never move words across an FTB boundary.",
      "Preserve the meaning, tone, paragraph structure, and surrounding whitespace.",
      ...(this.#worldContext
        ? [`World and translation context:\n${this.#worldContext}`]
        : []),
      ...(glossaryPrompt(request.glossary)
        ? [`Approved glossary (source => fixed target):\n${glossaryPrompt(request.glossary)}`]
        : []),
    ].join(" ");
    if (/\bgemma-4\b/iu.test(this.#model) && this.#lmStudioNativeAvailable !== false) {
      const native = await this.#translateWithLmStudioNative(text, system);
      if (native !== null) return native;
    }
    let lastDetail = "";
    for (const maxTokens of OUTPUT_TOKEN_LIMITS) {
      const startedAt = Date.now();
      this.#onMetrics?.({ phase: "started", model: this.#model });
      let response: Response;
      let payload: ChatCompletionPayload;
      try {
        response = await this.#request(`${this.#baseUrl}/chat/completions`, {
          method: "POST",
          body: JSON.stringify({
            model: this.#model,
            // TranslateGemma's stock LM Studio template requires the first message
            // to use the user role, so instructions and input share one message.
            messages: [{
              role: "user",
              content: `${system}\n\n<text_to_translate>\n${text}\n</text_to_translate>`,
            }],
            temperature: 0,
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
          input: `${system}\n\n<text_to_translate>\n${text}\n</text_to_translate>`,
          temperature: 0,
          max_output_tokens: 4_096,
          reasoning: "off",
          stream: false,
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
      return null;
    }

    const payload = await this.#readJson<LmStudioChatPayload>(response);
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
