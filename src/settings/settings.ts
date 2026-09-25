import { MODULE_ID } from "../constants";

export const SETTINGS = {
  PROVIDER: "provider",
  SOURCE_LANGUAGE: "sourceLanguage",
  TARGET_LANGUAGE: "targetLanguage",
  GLOSSARY_CANDIDATES: "glossaryCandidates",
  OPENAI_BASE_URL: "openAiBaseUrl",
  OPENAI_MODEL: "openAiModel",
  OPENAI_API_KEY: "openAiApiKey",
  WORLD_CONTEXT: "worldContext",
  AUTO_OPEN_TRANSLATIONS: "autoOpenTranslations",
  CZECH_FONTS: "czechFonts",
} as const;

export type ProviderId = "chrome-local" | "google-cloud-basic" | "openai-compatible";

export interface TranslatorSettings {
  provider: ProviderId;
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
  // Legacy provider IDs remain valid provenance for imported translations, but
  // active translation always uses the user's OpenAI-compatible connection.
  return {
    provider: "openai-compatible",
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
  await game.settings.set(MODULE_ID, SETTINGS.PROVIDER, "openai-compatible");
  await game.settings.set(MODULE_ID, SETTINGS.OPENAI_BASE_URL, settings.openAiBaseUrl.trim());
  await game.settings.set(MODULE_ID, SETTINGS.OPENAI_MODEL, settings.openAiModel.trim());
  await game.settings.set(MODULE_ID, SETTINGS.OPENAI_API_KEY, settings.openAiApiKey.trim());
  await game.settings.set(MODULE_ID, SETTINGS.WORLD_CONTEXT, settings.worldContext.trim());
  await game.settings.set(MODULE_ID, SETTINGS.SOURCE_LANGUAGE, settings.sourceLanguage);
  await game.settings.set(MODULE_ID, SETTINGS.TARGET_LANGUAGE, settings.targetLanguage);
}
