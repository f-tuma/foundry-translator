import type { TranslateRequest, TranslationProvider, TranslationResult } from "./types";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_TEXTS_PER_REQUEST = 32;
const PROMPT_REVISION = 2;

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

interface ChatCompletionPayload {
  choices?: Array<{
    message?: { content?: unknown };
  }>;
  error?: { message?: unknown };
}

interface ModelsPayload {
  data?: Array<{ id?: unknown }>;
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

export class OpenAiCompatibleProvider implements TranslationProvider {
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #apiKey: string;
  readonly #worldContext: string;
  readonly #fetch: FetchImplementation;
  readonly cacheIdentity: string;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.#baseUrl = normalizedBaseUrl(options.baseUrl);
    this.#model = options.model.trim();
    this.#apiKey = options.apiKey?.trim() ?? "";
    this.#worldContext = options.worldContext?.trim().slice(0, 6_000) ?? "";
    this.#fetch = options.fetchImplementation ?? ((input, init) =>
      foundry.utils.fetchWithTimeout(input, init, { timeoutMs: REQUEST_TIMEOUT_MS }));
    this.cacheIdentity = `openai-compatible:${this.#baseUrl}:${this.#model}:context-${textFingerprint(this.#worldContext)}:prompt-${PROMPT_REVISION}`;
  }

  async translate(request: TranslateRequest): Promise<TranslationResult[]> {
    this.#validateRequest(request);
    const results: TranslationResult[] = [];
    // Local servers generally serialize generation internally. Keeping this
    // loop sequential avoids filling their queue with a large Foundry page.
    for (const text of request.texts) {
      if (!text) {
        results.push({ translatedText: text });
        continue;
      }
      results.push({ translatedText: await this.#translateOne(text, request) });
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
      "Preserve every token beginning with __FTN_, __FTG_, or __FTS_ byte-for-byte, exactly once, and in the original order.",
      "Preserve the meaning, tone, paragraph structure, and surrounding whitespace.",
      ...(this.#worldContext
        ? [`World and translation context:\n${this.#worldContext}`]
        : []),
      ...(glossaryPrompt(request.glossary)
        ? [`Approved glossary (source => fixed target):\n${glossaryPrompt(request.glossary)}`]
        : []),
    ].join(" ");
    const response = await this.#request(`${this.#baseUrl}/chat/completions`, {
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
        max_tokens: 2_048,
        stream: false,
      }),
    });
    const payload = await this.#readJson<ChatCompletionPayload>(response);
    if (!response.ok) throw this.#httpError(response.status, payload.error?.message);
    const translated = payload.choices?.[0]?.message?.content;
    if (typeof translated !== "string" || !translated.trim()) {
      throw new OpenAiCompatibleTranslationError(
        "OpenAI-compatible server vrátil prázdnou nebo neočekávanou odpověď.",
        response.status,
      );
    }
    return translated;
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
