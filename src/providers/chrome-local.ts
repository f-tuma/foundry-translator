import type {
  TranslateRequest,
  TranslationProvider,
  TranslationResult,
} from "./types";

export type ChromeModelAvailability =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

export interface ChromeDownloadProgressEvent {
  loaded: number;
}

export interface ChromeDownloadMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: ChromeDownloadProgressEvent) => void,
  ): void;
}

export interface ChromeTranslatorSession {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

export interface ChromeTranslatorFactory {
  availability(options: ChromeLanguagePair): Promise<ChromeModelAvailability>;
  create(
    options: ChromeLanguagePair & ChromeModelCreationOptions,
  ): Promise<ChromeTranslatorSession>;
}

export interface ChromeDetectedLanguage {
  detectedLanguage: string;
  confidence: number;
}

export interface ChromeLanguageDetectorSession {
  detect(text: string): Promise<ChromeDetectedLanguage[]>;
  destroy?(): void;
}

export interface ChromeLanguageDetectorFactory {
  availability(): Promise<ChromeModelAvailability>;
  create(options?: ChromeModelCreationOptions): Promise<ChromeLanguageDetectorSession>;
}

export interface ChromeLocalApis {
  Translator?: ChromeTranslatorFactory;
  LanguageDetector?: ChromeLanguageDetectorFactory;
}

export type ChromeLocalProviderStatus =
  | {
      phase: "availability";
      component: "translator" | "language-detector";
      availability: ChromeModelAvailability;
    }
  | {
      phase: "download";
      component: "translator" | "language-detector";
      progress: number;
    }
  | {
      phase: "ready";
      component: "translator" | "language-detector";
    };

interface ChromeLanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

interface ChromeModelCreationOptions {
  monitor?: (monitor: ChromeDownloadMonitor) => void;
}

interface ChromeLocalProviderOptions {
  apis?: ChromeLocalApis;
  onDownloadProgress?: (progress: number) => void;
  onStatus?: (status: ChromeLocalProviderStatus) => void;
  modelTimeoutMs?: number;
}

const DEFAULT_MODEL_TIMEOUT_MS = 300_000;
const EMPTY_TRANSLATION_ATTEMPTS = 3;
const PROTECTION_TOKEN = /__(?:FTN|FTG)_[A-Z0-9]+_[A-Z0-9]+__/giu;
const TRANSLATABLE_CONTENT = /[\p{L}\p{N}]/u;

function isProtectionToken(value: string): boolean {
  return /^__(?:FTN|FTG)_[A-Z0-9]+_[A-Z0-9]+__$/iu.test(value);
}

function protectedTextParts(text: string): string[] {
  PROTECTION_TOKEN.lastIndex = 0;
  if (!PROTECTION_TOKEN.test(text)) return [text];
  PROTECTION_TOKEN.lastIndex = 0;
  return text.split(/(__(?:FTN|FTG)_[A-Z0-9]+_[A-Z0-9]+__)/giu);
}

const getBrowserApis = (): ChromeLocalApis =>
  globalThis as unknown as ChromeLocalApis;

export class ChromeLocalTranslationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChromeLocalTranslationError";
  }
}

export class ChromeLocalProvider implements TranslationProvider {
  readonly #apis: ChromeLocalApis;
  readonly #onDownloadProgress: ((progress: number) => void) | undefined;
  readonly #onStatus: ((status: ChromeLocalProviderStatus) => void) | undefined;
  readonly #modelTimeoutMs: number;
  readonly #translators = new Map<string, Promise<ChromeTranslatorSession>>();
  #detector?: Promise<ChromeLanguageDetectorSession>;

  constructor(options: ChromeLocalProviderOptions = {}) {
    this.#apis = options.apis ?? getBrowserApis();
    this.#onDownloadProgress = options.onDownloadProgress;
    this.#onStatus = options.onStatus;
    this.#modelTimeoutMs = options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  }

  async translate(request: TranslateRequest): Promise<TranslationResult[]> {
    this.#validateRequest(request);

    const results: TranslationResult[] = [];

    for (const text of request.texts) {
      if (!text) {
        results.push({ translatedText: text });
        continue;
      }

      const detectedSourceLanguage = await this.#resolveSourceLanguage(
        text,
        request.sourceLanguage,
      );

      if (detectedSourceLanguage === request.targetLanguage) {
        results.push({
          translatedText: text,
          ...(request.sourceLanguage === "auto" ? { detectedSourceLanguage } : {}),
        });
        continue;
      }

      const translator = await this.#getTranslator({
        sourceLanguage: detectedSourceLanguage,
        targetLanguage: request.targetLanguage,
      });
      const translatedText = await this.#translateProtectedText(translator, text);

      results.push({
        translatedText,
        ...(request.sourceLanguage === "auto" ? { detectedSourceLanguage } : {}),
      });
    }

    return results;
  }

  async #translateProtectedText(
    translator: ChromeTranslatorSession,
    text: string,
  ): Promise<string> {
    const parts = protectedTextParts(text);
    const translated: string[] = [];
    for (const part of parts) {
      if (!part || isProtectionToken(part) || !TRANSLATABLE_CONTENT.test(part)) {
        translated.push(part);
        continue;
      }
      let translatedPart = "";
      for (let attempt = 0; attempt < EMPTY_TRANSLATION_ATTEMPTS; attempt += 1) {
        const candidate = await translator.translate(part);
        if (typeof candidate === "string" && candidate.trim()) {
          translatedPart = candidate;
          break;
        }
      }
      if (!translatedPart) {
        throw new ChromeLocalTranslationError(
          "Chrome Local Translator vrátil prázdný nebo neplatný překlad i po 3 pokusech.",
        );
      }
      translated.push(translatedPart);
    }
    return translated.join("");
  }

  async prepare(request: TranslateRequest): Promise<void> {
    this.#validateRequest(request);
    const sample = request.texts.find((text) => text.trim());
    if (!sample) return;

    // Start model creation synchronously while the click still has transient user activation.
    if (request.sourceLanguage && request.sourceLanguage !== "auto") {
      await this.#getTranslator({
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
      });
      return;
    }

    const detectorPromise = this.#getLanguageDetector();
    const detector = await detectorPromise;
    const detections = await detector.detect(sample);
    const detected = detections.find(
      (candidate) =>
        typeof candidate.detectedLanguage === "string" &&
        candidate.detectedLanguage.trim() &&
        Number.isFinite(candidate.confidence),
    );
    if (!detected) {
      throw new ChromeLocalTranslationError(
        "Chrome nedokázal rozpoznat zdrojový jazyk. Vyberte jej ručně.",
      );
    }
    if (detected.detectedLanguage !== request.targetLanguage) {
      await this.#getTranslator({
        sourceLanguage: detected.detectedLanguage,
        targetLanguage: request.targetLanguage,
      });
    }
  }

  async testConnection(targetLanguage: string): Promise<void> {
    const sourceLanguage = targetLanguage === "en" ? "cs" : "en";
    const text = sourceLanguage === "en" ? "Connection test." : "Test připojení.";
    this.#validateRequest({ texts: [text], sourceLanguage, targetLanguage });

    // Chrome requires create() to be called while transient user activation from the
    // button click is still active. Do not await availability() or another operation first.
    const translatorPromise = this.#getTranslator({ sourceLanguage, targetLanguage });
    const translator = await translatorPromise;
    const translatedText = await translator.translate(text);

    if (typeof translatedText !== "string" || !translatedText.trim()) {
      throw new ChromeLocalTranslationError(
        "Chrome Local Translator vrátil prázdný nebo neplatný testovací překlad.",
      );
    }
  }

  #validateRequest(request: TranslateRequest): void {
    if (!this.#apis.Translator) {
      throw new ChromeLocalTranslationError(
        "Chrome Local Translator není v tomto prohlížeči dostupný. Použijte desktopový Chrome 138 nebo novější.",
      );
    }

    if (!request.targetLanguage.trim()) {
      throw new ChromeLocalTranslationError("Cílový jazyk není vybraný.");
    }

    if (request.texts.length === 0) {
      throw new ChromeLocalTranslationError("Požadavek neobsahuje žádný text.");
    }

    if (request.format === "html") {
      throw new ChromeLocalTranslationError(
        "Chrome Local Translator zatím nepřijímá nezpracované HTML.",
      );
    }
  }

  async #resolveSourceLanguage(text: string, requestedLanguage?: string): Promise<string> {
    if (requestedLanguage && requestedLanguage !== "auto") return requestedLanguage;

    const detector = await this.#getLanguageDetector();
    const detections = await detector.detect(text);
    const detected = detections.find(
      (candidate) =>
        typeof candidate.detectedLanguage === "string" &&
        candidate.detectedLanguage.trim() &&
        Number.isFinite(candidate.confidence),
    );

    if (!detected) {
      throw new ChromeLocalTranslationError(
        "Chrome nedokázal rozpoznat zdrojový jazyk. Vyberte jej ručně.",
      );
    }

    return detected.detectedLanguage;
  }

  async #getLanguageDetector(): Promise<ChromeLanguageDetectorSession> {
    const factory = this.#apis.LanguageDetector;

    if (!factory) {
      throw new ChromeLocalTranslationError(
        "Automatická detekce jazyka není v tomto prohlížeči dostupná. Vyberte zdrojový jazyk ručně.",
      );
    }

    this.#detector ??= this.#createLanguageDetector(factory);
    return this.#detector;
  }

  async #createLanguageDetector(
    factory: ChromeLanguageDetectorFactory,
  ): Promise<ChromeLanguageDetectorSession> {
    try {
      const lifecycle = this.#createModelLifecycle("language-detector");
      const creation = factory.create({ monitor: lifecycle.monitor });
      try {
        lifecycle.observeAvailability(factory.availability());
      } catch {
        // Creation is authoritative; availability is informational only.
      }
      const detector = await this.#withModelTimeout(
        creation,
        "lokální detekci jazyka",
      );
      lifecycle.ready();
      return detector;
    } catch (error) {
      if (error instanceof ChromeLocalTranslationError) throw error;
      throw new ChromeLocalTranslationError(
        "Chrome nedokázal připravit lokální detekci jazyka.",
        { cause: error },
      );
    }
  }

  async #getTranslator(pair: ChromeLanguagePair): Promise<ChromeTranslatorSession> {
    const key = `${pair.sourceLanguage}:${pair.targetLanguage}`;
    const existing = this.#translators.get(key);
    if (existing) return existing;

    const translator = this.#createTranslator(pair);
    this.#translators.set(key, translator);

    try {
      return await translator;
    } catch (error) {
      this.#translators.delete(key);
      throw error;
    }
  }

  async #createTranslator(pair: ChromeLanguagePair): Promise<ChromeTranslatorSession> {
    const factory = this.#apis.Translator;
    if (!factory) {
      throw new ChromeLocalTranslationError("Chrome Local Translator není dostupný.");
    }

    try {
      const lifecycle = this.#createModelLifecycle("translator");
      const creation = factory.create({ ...pair, monitor: lifecycle.monitor });
      try {
        lifecycle.observeAvailability(factory.availability(pair));
      } catch {
        // Creation is authoritative; availability is informational only.
      }
      const translator = await this.#withModelTimeout(
        creation,
        `překlad ${pair.sourceLanguage} → ${pair.targetLanguage}`,
      );
      lifecycle.ready();
      return translator;
    } catch (error) {
      if (error instanceof ChromeLocalTranslationError) throw error;
      throw new ChromeLocalTranslationError(
        `Chrome nedokázal připravit překlad ${pair.sourceLanguage} → ${pair.targetLanguage}.`,
        { cause: error },
      );
    }
  }

  #createModelLifecycle(component: "translator" | "language-detector"): {
    monitor: (monitor: ChromeDownloadMonitor) => void;
    observeAvailability: (availability: Promise<ChromeModelAvailability>) => void;
    ready: () => void;
  } {
    let downloadStarted = false;
    let finished = false;

    return {
      monitor: (monitor) => {
        monitor.addEventListener("downloadprogress", (event) => {
          if (finished) return;
          downloadStarted = true;
          const progress = Math.min(1, Math.max(0, event.loaded));
          this.#onDownloadProgress?.(progress);
          this.#onStatus?.({ phase: "download", component, progress });
        });
      },
      observeAvailability: (availability) => {
        void availability.then(
          (value) => {
            if (downloadStarted || finished) return;
            this.#onStatus?.({ phase: "availability", component, availability: value });
          },
          () => undefined,
        );
      },
      ready: () => {
        finished = true;
        this.#onStatus?.({ phase: "ready", component });
      },
    };
  }

  #withModelTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        reject(
          new ChromeLocalTranslationError(
            `Chrome nedokončil ${label} do 5 minut. Zkontrolujte připojení, volné místo a nastavení překladu v Chromu.`,
          ),
        );
      }, this.#modelTimeoutMs);

      promise.then(
        (value) => {
          globalThis.clearTimeout(timeout);
          resolve(value);
        },
        (error: unknown) => {
          globalThis.clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }
}
