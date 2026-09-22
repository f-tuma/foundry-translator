import type { ChromeLocalProviderStatus } from "./chrome-local";
import type { ProviderRequestMetrics, TranslationProvider } from "./types";
import type { TranslatorSettings } from "../settings/settings";
import { OpenAiCompatibleProvider } from "./openai-compatible";

export interface ProviderFactoryOptions {
  onChromeStatus?: (status: ChromeLocalProviderStatus) => void;
  onProviderMetrics?: (metrics: ProviderRequestMetrics) => void;
}

export function createTranslationProvider(
  settings: TranslatorSettings,
  options: ProviderFactoryOptions = {},
): TranslationProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: settings.openAiBaseUrl,
    model: settings.openAiModel,
    apiKey: settings.openAiApiKey,
    worldContext: settings.worldContext,
    ...(options.onProviderMetrics ? { onMetrics: options.onProviderMetrics } : {}),
  });
}
