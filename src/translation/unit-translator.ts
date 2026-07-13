import type { GlossaryEntry } from "../glossary/types";
import {
  GlossaryIntegrityError,
  protectGlossaryTerms,
  restoreGlossaryTerms,
} from "../glossary/protection";
import type { TranslationProvider } from "../providers/types";
import type { ProviderId } from "../settings/settings";
import type { TranslationCache, TranslationCacheEntry } from "./cache";
import { sha256 } from "./hash";
import { foundrySyntaxEntries } from "./foundry-syntax";

const MAX_UNITS_PER_REQUEST = 128;

export interface TranslationUnitSettings {
  providerId: ProviderId;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslateUnitsOptions {
  units: readonly (readonly string[])[];
  glossary: readonly GlossaryEntry[];
  provider: TranslationProvider;
  settings: TranslationUnitSettings;
  cache?: TranslationCache;
  nonceFactory?: () => string;
}

interface PreparedUnit {
  index: number;
  key: string;
  protectedText: ReturnType<typeof protectGlossaryTerms>;
  boundaryTokens: string[];
}

function glossarySnapshot(entries: readonly GlossaryEntry[]): string {
  return JSON.stringify(
    [...entries]
      .map(({ source, replacement, category, aliases }) => ({
        source,
        replacement,
        category,
        aliases: [...aliases].sort(),
      }))
      .sort((left, right) => left.source.localeCompare(right.source)),
  );
}

async function cacheKey(
  segments: readonly string[],
  glossaryFingerprint: string,
  settings: TranslationUnitSettings,
): Promise<string> {
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      segments,
      glossaryFingerprint,
      ...settings,
    }),
  );
}

function createBoundaryTokens(segmentCount: number, nonce: string): string[] {
  return Array.from(
    { length: segmentCount + 1 },
    (_, index) => `⟦FTN:${nonce}:${index.toString(36).padStart(4, "0")}⟧`,
  );
}

function combineSegments(segments: readonly string[], boundaryTokens: readonly string[]): string {
  return segments.map((segment, index) => `${boundaryTokens[index]}${segment}`).join("") +
    boundaryTokens.at(-1);
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function splitTranslatedSegments(text: string, boundaryTokens: readonly string[]): string[] {
  let cursor = 0;
  const starts: number[] = [];

  for (const token of boundaryTokens) {
    if (countOccurrences(text, token) !== 1) {
      throw new GlossaryIntegrityError(
        `Translation must contain HTML boundary token ${token} exactly once.`,
      );
    }
    const position = text.indexOf(token, cursor);
    if (position < cursor) {
      throw new GlossaryIntegrityError("Translation changed the order of HTML boundary tokens.");
    }
    starts.push(position);
    cursor = position + token.length;
  }

  const before = text.slice(0, starts[0]);
  const after = text.slice((starts.at(-1) ?? 0) + (boundaryTokens.at(-1)?.length ?? 0));
  if (before.trim() || after.trim()) {
    throw new GlossaryIntegrityError("Translation moved text outside the HTML boundary tokens.");
  }

  return boundaryTokens.slice(0, -1).map((token, index) => {
    const start = (starts[index] ?? 0) + token.length;
    const end = starts[index + 1] ?? text.length;
    return text.slice(start, end);
  });
}

function randomNonce(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export async function translateUnits(
  options: TranslateUnitsOptions,
): Promise<readonly (readonly string[])[]> {
  if (!options.units.length) return [];

  const glossaryFingerprint = await sha256(glossarySnapshot(options.glossary));
  const translated: (readonly string[] | undefined)[] = Array(options.units.length);
  const misses: PreparedUnit[] = [];

  for (const [index, segments] of options.units.entries()) {
    const key = await cacheKey(segments, glossaryFingerprint, options.settings);
    const cached = await options.cache?.get(key);
    if (cached && cached.length === segments.length) {
      translated[index] = cached;
      continue;
    }

    const nonce = options.nonceFactory?.() ?? randomNonce();
    const boundaryTokens = createBoundaryTokens(segments.length, nonce);
    const combined = combineSegments(segments, boundaryTokens);
    const protectedEntries = [...options.glossary, ...foundrySyntaxEntries(combined)];
    misses.push({
      index,
      key,
      boundaryTokens,
      protectedText: protectGlossaryTerms(combined, protectedEntries, { nonce }),
    });
  }

  for (let offset = 0; offset < misses.length; offset += MAX_UNITS_PER_REQUEST) {
    const batch = misses.slice(offset, offset + MAX_UNITS_PER_REQUEST);
    const results = await options.provider.translate({
      texts: batch.map(({ protectedText }) => protectedText.text),
      sourceLanguage: options.settings.sourceLanguage,
      targetLanguage: options.settings.targetLanguage,
      format: "text",
    });

    if (results.length !== batch.length) {
      throw new Error("Překladač vrátil jiný počet výsledků, než kolik dostal bloků.");
    }

    const cacheWrites: TranslationCacheEntry[] = [];
    for (const [resultIndex, result] of results.entries()) {
      const prepared = batch[resultIndex];
      if (!prepared) throw new Error("Chybí metadata přeloženého bloku.");
      const restored = restoreGlossaryTerms(result.translatedText, prepared.protectedText);
      const segments = splitTranslatedSegments(restored, prepared.boundaryTokens);
      translated[prepared.index] = segments;
      cacheWrites.push({ key: prepared.key, translatedSegments: segments });
    }

    if (options.cache?.setMany) {
      await options.cache.setMany(cacheWrites);
    } else if (options.cache) {
      await Promise.all(
        cacheWrites.map(({ key, translatedSegments }) =>
          options.cache?.set(key, translatedSegments),
        ),
      );
    }
  }

  if (translated.some((segments) => !segments)) {
    throw new Error("Některé bloky se nepodařilo přeložit.");
  }
  return translated as readonly (readonly string[])[];
}
