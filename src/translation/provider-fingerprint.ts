import type { TranslationProvider } from "../providers/types";
import { sha256 } from "./hash";

/** Model/profile changes invalidate document reuse without storing server details. */
export function providerFingerprint(providerId: string, provider: TranslationProvider, sourceLanguage: string): Promise<string> {
  return sha256(JSON.stringify([providerId, provider.cacheIdentity ?? providerId, sourceLanguage]));
}
