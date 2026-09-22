export type TranslationFormat = "text" | "html";

/** Original-source reading context, never an additional translation target. */
export interface PassageContext {
  documentTitle?: string;
  sectionTitle?: string;
  field?: string;
  previous?: string;
  next?: string;
}

export interface TranslateRequest {
  texts: readonly string[];
  targetLanguage: string;
  sourceLanguage?: string;
  format?: TranslationFormat;
  /** Optional terminology reference for context-aware LLM providers. */
  glossary?: readonly { source: string; replacement: string }[];
  /** Only the protected occurrences in these texts, retaining their original wording. */
  inflections?: readonly GlossaryInflectionReference[];
  /** Aligned with texts; missing entries have no passage context. */
  contexts?: readonly (PassageContext | undefined)[];
}

export interface GlossaryInflectionReference {
  token: string;
  endToken: string;
  source: string;
  replacement: string;
}

export interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage?: string;
}

export interface ProviderRequestMetrics {
  phase: "started" | "progress" | "diagnostic" | "completed" | "failed";
  model: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  tokensPerSecond?: number;
  finishReason?: string;
  streamedCharacters?: number;
  batchFallbacks?: number;
  sequentialFallbackTexts?: number;
  responseRetries?: number;
  nativeFallbacks?: number;
}

export interface TranslationProvider {
  readonly supportsPassageContext?: boolean;
  /** Can follow instructions for inflected, bounded Czech glossary names. */
  readonly supportsGlossaryInflection?: boolean;
  /** Distinguishes model/configuration-specific cache entries without including secrets. */
  readonly cacheIdentity?: string;
  /** Optional diagnostics used to keep only rejected name forms exact on recovery. */
  rejectedGlossaryTokens?(text: string, references: readonly GlossaryInflectionReference[], context?: PassageContext): readonly string[];
  translate(request: TranslateRequest): Promise<TranslationResult[]>;
  testConnection(targetLanguage: string): Promise<void>;
  prepare?(request: TranslateRequest): Promise<void>;
}
