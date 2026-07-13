import type {
  TranslateRequest,
  TranslationProvider,
  TranslationResult,
} from "./types";

const GOOGLE_TRANSLATE_ENDPOINT =
  "https://translation.googleapis.com/language/translate/v2";
const MAX_TEXTS_PER_REQUEST = 128;
const REQUEST_TIMEOUT_MS = 15_000;

interface GoogleTranslation {
  translatedText?: unknown;
  detectedSourceLanguage?: unknown;
}

interface GoogleTranslationResponse {
  data?: {
    translations?: GoogleTranslation[];
  };
  error?: {
    code?: unknown;
    message?: unknown;
    status?: unknown;
  };
}

export class GoogleCloudTranslationError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "GoogleCloudTranslationError";
    this.status = status;
  }
}

export class GoogleCloudBasicProvider implements TranslationProvider {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(apiKey: string, fetchImplementation: typeof fetch = globalThis.fetch) {
    this.#apiKey = apiKey.trim();
    this.#fetch = fetchImplementation;
  }

  async translate(request: TranslateRequest): Promise<TranslationResult[]> {
    this.#validateRequest(request);

    const body: Record<string, unknown> = {
      q: request.texts,
      target: request.targetLanguage,
      format: request.format ?? "text",
      model: "nmt",
    };

    if (request.sourceLanguage && request.sourceLanguage !== "auto") {
      body.source = request.sourceLanguage;
    }

    let response: Response;

    try {
      response = await this.#fetch(GOOGLE_TRANSLATE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-goog-api-key": this.#apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GoogleCloudTranslationError(
        "Google Cloud Translation není dostupný. Zkontrolujte připojení a zkuste to znovu.",
        0,
        { cause: error },
      );
    }

    const payload = await this.#readPayload(response);

    if (!response.ok) {
      const message =
        typeof payload.error?.message === "string"
          ? payload.error.message
          : `Google Cloud Translation vrátil chybu HTTP ${response.status}.`;
      throw new GoogleCloudTranslationError(message, response.status);
    }

    const translations = payload.data?.translations;
    if (!Array.isArray(translations) || translations.length !== request.texts.length) {
      throw new GoogleCloudTranslationError(
        "Google Cloud Translation vrátil neočekávanou odpověď.",
        response.status,
      );
    }

    return translations.map((translation) => {
      if (typeof translation.translatedText !== "string") {
        throw new GoogleCloudTranslationError(
          "Google Cloud Translation vrátil neplatný přeložený text.",
          response.status,
        );
      }

      const result: TranslationResult = {
        translatedText: translation.translatedText,
      };

      if (typeof translation.detectedSourceLanguage === "string") {
        result.detectedSourceLanguage = translation.detectedSourceLanguage;
      }

      return result;
    });
  }

  async testConnection(targetLanguage: string): Promise<void> {
    const sourceLanguage = targetLanguage === "en" ? "cs" : "en";
    const text = sourceLanguage === "en" ? "Connection test." : "Test připojení.";

    await this.translate({
      texts: [text],
      sourceLanguage,
      targetLanguage,
      format: "text",
    });
  }

  #validateRequest(request: TranslateRequest): void {
    if (!this.#apiKey) {
      throw new GoogleCloudTranslationError("API klíč není vyplněný.", 0);
    }

    if (!request.targetLanguage.trim()) {
      throw new GoogleCloudTranslationError("Cílový jazyk není vybraný.", 0);
    }

    if (request.texts.length === 0 || request.texts.length > MAX_TEXTS_PER_REQUEST) {
      throw new GoogleCloudTranslationError(
        `Jeden požadavek musí obsahovat 1 až ${MAX_TEXTS_PER_REQUEST} textů.`,
        0,
      );
    }
  }

  async #readPayload(response: Response): Promise<GoogleTranslationResponse> {
    try {
      return (await response.json()) as GoogleTranslationResponse;
    } catch (error) {
      throw new GoogleCloudTranslationError(
        "Google Cloud Translation nevrátil platný JSON.",
        response.status,
        { cause: error },
      );
    }
  }
}
