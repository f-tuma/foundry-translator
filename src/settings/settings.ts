import { MODULE_ID } from "../constants";

export const SETTINGS = {
  PROVIDER: "provider",
  GOOGLE_API_KEY: "googleApiKey",
  SOURCE_LANGUAGE: "sourceLanguage",
  TARGET_LANGUAGE: "targetLanguage",
  GLOSSARY_CANDIDATES: "glossaryCandidates",
  OPENAI_BASE_URL: "openAiBaseUrl",
  OPENAI_MODEL: "openAiModel",
  OPENAI_API_KEY: "openAiApiKey",
  WORLD_CONTEXT: "worldContext",
  AUTO_OPEN_TRANSLATIONS: "autoOpenTranslations",
} as const;

export type ProviderId = "chrome-local" | "google-cloud-basic" | "openai-compatible";

export interface TranslatorSettings {
  provider: ProviderId;
  apiKey: string;
  openAiBaseUrl: string;
  openAiModel: string;
  openAiApiKey: string;
  worldContext: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export function isProviderId(value: unknown): value is ProviderId {
  return value === "chrome-local" || value === "google-cloud-basic" ||
    value === "openai-compatible";
}

export function getTranslatorSettings(): TranslatorSettings {
  const storedProvider = String(
    game.settings.get(MODULE_ID, SETTINGS.PROVIDER) ?? "chrome-local",
  );

  return {
    provider: isProviderId(storedProvider) ? storedProvider : "chrome-local",
    apiKey: String(game.settings.get(MODULE_ID, SETTINGS.GOOGLE_API_KEY) ?? ""),
    openAiBaseUrl: String(
      game.settings.get(MODULE_ID, SETTINGS.OPENAI_BASE_URL) ?? "http://localhost:1234/v1",
    ),
    openAiModel: String(game.settings.get(MODULE_ID, SETTINGS.OPENAI_MODEL) ?? ""),
    openAiApiKey: String(game.settings.get(MODULE_ID, SETTINGS.OPENAI_API_KEY) ?? ""),
    worldContext: String(game.settings.get(MODULE_ID, SETTINGS.WORLD_CONTEXT) ?? ""),
    sourceLanguage: String(
      game.settings.get(MODULE_ID, SETTINGS.SOURCE_LANGUAGE) ?? "auto",
    ),
    targetLanguage: String(
      game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? "cs",
    ),
  };
}

export async function saveTranslatorSettings(settings: TranslatorSettings): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.PROVIDER, settings.provider);
  await game.settings.set(MODULE_ID, SETTINGS.GOOGLE_API_KEY, settings.apiKey.trim());
  await game.settings.set(MODULE_ID, SETTINGS.OPENAI_BASE_URL, settings.openAiBaseUrl.trim());
  await game.settings.set(MODULE_ID, SETTINGS.OPENAI_MODEL, settings.openAiModel.trim());
  await game.settings.set(MODULE_ID, SETTINGS.OPENAI_API_KEY, settings.openAiApiKey.trim());
  await game.settings.set(MODULE_ID, SETTINGS.WORLD_CONTEXT, settings.worldContext.trim());
  await game.settings.set(MODULE_ID, SETTINGS.SOURCE_LANGUAGE, settings.sourceLanguage);
  await game.settings.set(MODULE_ID, SETTINGS.TARGET_LANGUAGE, settings.targetLanguage);
}
