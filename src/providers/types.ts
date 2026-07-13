export type TranslationFormat = "text" | "html";

export interface TranslateRequest {
  texts: readonly string[];
  targetLanguage: string;
  sourceLanguage?: string;
  format?: TranslationFormat;
}

export interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage?: string;
}

export interface TranslationProvider {
  translate(request: TranslateRequest): Promise<TranslationResult[]>;
  testConnection(targetLanguage: string): Promise<void>;
}
