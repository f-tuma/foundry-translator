import { ChromeLocalProvider, type ChromeLocalProviderStatus } from "./chrome-local";
import { GoogleCloudBasicProvider } from "./google-cloud-basic";
import type { TranslationProvider } from "./types";
import type { TranslatorSettings } from "../settings/settings";
import { OpenAiCompatibleProvider } from "./openai-compatible";

export interface ProviderFactoryOptions {
  onChromeStatus?: (status: ChromeLocalProviderStatus) => void;
}

export function createTranslationProvider(
  settings: TranslatorSettings,
  options: ProviderFactoryOptions = {},
): TranslationProvider {
  if (settings.provider === "chrome-local") {
    return new ChromeLocalProvider({
      ...(options.onChromeStatus ? { onStatus: options.onChromeStatus } : {}),
    });
  }
  if (settings.provider === "openai-compatible") {
    return new OpenAiCompatibleProvider({
      baseUrl: settings.openAiBaseUrl,
      model: settings.openAiModel,
      apiKey: settings.openAiApiKey,
      worldContext: settings.worldContext,
    });
  }
  return new GoogleCloudBasicProvider(settings.apiKey);
}
