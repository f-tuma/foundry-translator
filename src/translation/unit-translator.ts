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
  protectedText: string;
  segmentProtections: ReturnType<typeof protectGlossaryTerms>[];
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
  const normalizedNonce = nonce.toUpperCase();
  return Array.from(
    { length: segmentCount + 1 },
    (_, index) =>
      `__FTN_${normalizedNonce}_${index.toString(36).toUpperCase().padStart(4, "0")}__`,
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

async function translateSegmentsSeparately(
  prepared: PreparedUnit,
  provider: TranslationProvider,
  settings: TranslationUnitSettings,
): Promise<string[]> {
  const segments = prepared.segmentProtections.map(({ text }) => {
    const leading = text.match(/^\s*/u)?.[0] ?? "";
    const withoutLeading = text.slice(leading.length);
    const trailing = withoutLeading.match(/\s*$/u)?.[0] ?? "";
    return {
      leading,
      core: withoutLeading.slice(0, withoutLeading.length - trailing.length),
      trailing,
    };
  });
  const translatable = segments
    .map(({ core }, index) => ({ core, index }))
    .filter(({ core }) => core.length > 0);
  const results = await provider.translate({
    texts: translatable.map(({ core }) => core),
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    format: "text",
  });
  if (results.length !== translatable.length) {
    throw new Error("Překladač vrátil jiný počet HTML segmentů, než kolik dostal.");
  }
  const translatedCores = new Map(
    translatable.map(({ index }, resultIndex) => [index, results[resultIndex]?.translatedText ?? ""]),
  );
  return segments.map(({ leading, core, trailing }, index) =>
    `${leading}${translatedCores.get(index) ?? core}${trailing}`,
  );
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
    const boundaryTokens = segments.length > 1
      ? createBoundaryTokens(segments.length, nonce)
      : [];
    const segmentProtections = segments.map((segment, segmentIndex) =>
      protectGlossaryTerms(
        segment,
        [...options.glossary, ...foundrySyntaxEntries(segment)],
        { nonce: `${nonce}${segmentIndex.toString(36)}` },
      ),
    );
    misses.push({
      index,
      key,
      boundaryTokens,
      protectedText: boundaryTokens.length
        ? combineSegments(segmentProtections.map(({ text }) => text), boundaryTokens)
        : (segmentProtections[0]?.text ?? ""),
      segmentProtections,
    });
  }

  for (let offset = 0; offset < misses.length; offset += MAX_UNITS_PER_REQUEST) {
    const batch = misses.slice(offset, offset + MAX_UNITS_PER_REQUEST);
    const results = await options.provider.translate({
      texts: batch.map(({ protectedText }) => protectedText),
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
      let protectedSegments: readonly string[];
      if (!prepared.boundaryTokens.length) {
        protectedSegments = [result.translatedText];
      } else {
        try {
          protectedSegments = splitTranslatedSegments(
            result.translatedText,
            prepared.boundaryTokens,
          );
        } catch (error) {
          if (!(error instanceof GlossaryIntegrityError)) throw error;
          protectedSegments = await translateSegmentsSeparately(
            prepared,
            options.provider,
            options.settings,
          );
        }
      }
      const segments = protectedSegments.map((segment, index) => {
        const protection = prepared.segmentProtections[index];
        if (!protection) throw new Error("Chybí ochrana přeloženého HTML segmentu.");
        return restoreGlossaryTerms(segment, protection);
      });
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
