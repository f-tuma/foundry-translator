import { ChromeLocalProvider, type ChromeLocalProviderStatus } from "./chrome-local";
import { GoogleCloudBasicProvider } from "./google-cloud-basic";
import type { TranslationProvider } from "./types";
import type { TranslatorSettings } from "../settings/settings";

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
  return new GoogleCloudBasicProvider(settings.apiKey);
}
