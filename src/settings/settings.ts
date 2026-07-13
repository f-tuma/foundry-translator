import { MODULE_ID } from "../constants";

export const SETTINGS = {
  PROVIDER: "provider",
  GOOGLE_API_KEY: "googleApiKey",
  SOURCE_LANGUAGE: "sourceLanguage",
  TARGET_LANGUAGE: "targetLanguage",
} as const;

export type ProviderId = "chrome-local" | "google-cloud-basic";

export interface TranslatorSettings {
  provider: ProviderId;
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export function isProviderId(value: string): value is ProviderId {
  return value === "chrome-local" || value === "google-cloud-basic";
}

export function getTranslatorSettings(): TranslatorSettings {
  const storedProvider = String(
    game.settings.get(MODULE_ID, SETTINGS.PROVIDER) ?? "chrome-local",
  );

  return {
    provider: isProviderId(storedProvider) ? storedProvider : "chrome-local",
    apiKey: String(game.settings.get(MODULE_ID, SETTINGS.GOOGLE_API_KEY) ?? ""),
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
  await game.settings.set(MODULE_ID, SETTINGS.SOURCE_LANGUAGE, settings.sourceLanguage);
  await game.settings.set(MODULE_ID, SETTINGS.TARGET_LANGUAGE, settings.targetLanguage);
}
