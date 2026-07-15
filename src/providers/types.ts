export type TranslationFormat = "text" | "html";

export interface TranslateRequest {
  texts: readonly string[];
  targetLanguage: string;
  sourceLanguage?: string;
  format?: TranslationFormat;
  /** Optional terminology reference for context-aware LLM providers. */
  glossary?: readonly { source: string; replacement: string }[];
}

export interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage?: string;
}

export interface ProviderRequestMetrics {
  phase: "started" | "completed" | "failed";
  model: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  tokensPerSecond?: number;
  finishReason?: string;
}

export interface TranslationProvider {
  /** Distinguishes model/configuration-specific cache entries without including secrets. */
  readonly cacheIdentity?: string;
  translate(request: TranslateRequest): Promise<TranslationResult[]>;
  testConnection(targetLanguage: string): Promise<void>;
  prepare?(request: TranslateRequest): Promise<void>;
}
