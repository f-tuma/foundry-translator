import { MODULE_ID } from "../constants";

export const SETTINGS = {
  PROVIDER: "provider",
  GOOGLE_API_KEY: "googleApiKey",
  SOURCE_LANGUAGE: "sourceLanguage",
  TARGET_LANGUAGE: "targetLanguage",
} as const;

export interface GoogleSettings {
  provider: "google-cloud-basic";
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export function getGoogleSettings(): GoogleSettings {
  return {
    provider: "google-cloud-basic",
    apiKey: String(game.settings.get(MODULE_ID, SETTINGS.GOOGLE_API_KEY) ?? ""),
    sourceLanguage: String(
      game.settings.get(MODULE_ID, SETTINGS.SOURCE_LANGUAGE) ?? "auto",
    ),
    targetLanguage: String(
      game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? "cs",
    ),
  };
}

export async function saveGoogleSettings(settings: GoogleSettings): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.PROVIDER, settings.provider);
  await game.settings.set(MODULE_ID, SETTINGS.GOOGLE_API_KEY, settings.apiKey.trim());
  await game.settings.set(MODULE_ID, SETTINGS.SOURCE_LANGUAGE, settings.sourceLanguage);
  await game.settings.set(MODULE_ID, SETTINGS.TARGET_LANGUAGE, settings.targetLanguage);
}
