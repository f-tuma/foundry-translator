import { translateUnits, type TranslationQualityFallback } from "./unit-translator";
import type { GlossaryEntry } from "../glossary/types";
import type { TranslationProvider } from "../providers/types";
import type { ProviderId } from "../settings/settings";
import type { TranslationCache } from "./cache";
import { protectGlossaryTerms } from "../glossary/protection";

interface NameOptions {
  glossary: readonly GlossaryEntry[];
  provider: TranslationProvider;
  settings: { providerId: ProviderId; sourceLanguage: string; targetLanguage: string };
  cache?: TranslationCache;
  nonceFactory?: () => string;
  onQualityFallback?: (fallback: TranslationQualityFallback) => void;
}

/** Names use the same glossary and integrity checks as prose. A complete
 * glossary title remains canonical, including when its prose mode is inflect.
 */
export async function translateDocumentNames(names: readonly string[], options: NameOptions): Promise<{ names: string[]; fallbacks: number }> {
  let fallbacks = 0;
  const output = [...names];
  const pending: { index: number; name: string }[] = [];
  names.forEach((name, index) => {
    const protectedName = protectGlossaryTerms(name, options.glossary, { nonce: "TITLE", allowInflection: false });
    const token = protectedName.tokens[0];
    if (protectedName.tokens.length === 1 && token && protectedName.text.trim() === token.token) {
      // The reviewed title is already known; no model call or grammar decision.
      output[index] = protectedName.text.replace(token.token, () => token.replacement);
    } else pending.push({ index, name });
  });
  const translated = await translateUnits({ ...options, units: pending.map(({ name }) => [name]),
    onQualityFallback: issue => { fallbacks += issue.occurrences; options.onQualityFallback?.(issue); },
  });
  pending.forEach(({ index, name }, position) => { output[index] = translated[position]?.[0] || name; });
  return { names: output, fallbacks };
}
