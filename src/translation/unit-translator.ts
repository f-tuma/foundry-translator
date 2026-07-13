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
const MAX_CHROME_UNITS_PER_REQUEST = 16;
export const MAX_REQUEST_CHARACTERS = 4_500;

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
  indices: number[];
  key: string;
  protectedText: string;
  segments: PreparedSegment[];
  boundaryTokens: string[];
}

interface PreparedSegment {
  protection: ReturnType<typeof protectGlossaryTerms>;
  leading: string;
  trailing: string;
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
  const translatable = prepared.segments
    .map(({ protection }, index) => ({ text: protection.text, index }))
    .filter(({ text }) => text.length > 0);
  const results = await provider.translate({
    texts: translatable.map(({ text }) => text),
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
  return prepared.segments.map(({ protection }, index) =>
    translatedCores.get(index) ?? protection.text,
  );
}

function prepareSegment(
  segment: string,
  glossary: readonly GlossaryEntry[],
  nonce: string,
): PreparedSegment {
  const leading = segment.match(/^\s*/u)?.[0] ?? "";
  const withoutLeading = segment.slice(leading.length);
  const trailing = withoutLeading.match(/\s*$/u)?.[0] ?? "";
  const core = withoutLeading.slice(0, withoutLeading.length - trailing.length);
  return {
    leading,
    trailing,
    protection: protectGlossaryTerms(
      core,
      [...glossary, ...foundrySyntaxEntries(core)],
      { nonce },
    ),
  };
}

function requestBatches(
  misses: readonly PreparedUnit[],
  providerId: ProviderId,
): PreparedUnit[][] {
  const batches: PreparedUnit[][] = [];
  let batch: PreparedUnit[] = [];
  let characters = 0;
  const maxUnits = providerId === "chrome-local"
    ? MAX_CHROME_UNITS_PER_REQUEST
    : MAX_UNITS_PER_REQUEST;
  for (const prepared of misses) {
    const size = prepared.protectedText.length;
    if (
      batch.length &&
      (batch.length >= maxUnits || characters + size > MAX_REQUEST_CHARACTERS)
    ) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(prepared);
    characters += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function translateUnits(
  options: TranslateUnitsOptions,
): Promise<readonly (readonly string[])[]> {
  if (!options.units.length) return [];

  const glossaryFingerprint = await sha256(glossarySnapshot(options.glossary));
  const translated: (readonly string[] | undefined)[] = Array(options.units.length);
  const misses: PreparedUnit[] = [];
  const missesByKey = new Map<string, PreparedUnit>();
  const keyedUnits = await Promise.all(options.units.map(async (segments, index) => ({
    index,
    segments,
    key: await cacheKey(segments, glossaryFingerprint, options.settings),
  })));
  let cachedValues = new Map<string, readonly string[]>();
  if (options.cache?.getMany) {
    cachedValues = await options.cache.getMany(keyedUnits.map(({ key }) => key));
  } else if (options.cache) {
    const values = await Promise.all(keyedUnits.map(async ({ key }) => ({
      key,
      value: await options.cache?.get(key),
    })));
    for (const { key, value } of values) {
      if (value) cachedValues.set(key, value);
    }
  }

  for (const { index, segments, key } of keyedUnits) {
    const cached = cachedValues.get(key);
    if (cached && cached.length === segments.length) {
      translated[index] = cached;
      continue;
    }
    const duplicate = missesByKey.get(key);
    if (duplicate) {
      duplicate.indices.push(index);
      continue;
    }

    const nonce = options.nonceFactory?.() ?? randomNonce();
    const boundaryTokens = segments.length > 1
      ? createBoundaryTokens(segments.length, nonce)
      : [];
    const preparedSegments = segments.map((segment, segmentIndex) =>
      prepareSegment(
        segment,
        options.glossary,
        `${nonce}${segmentIndex.toString(36)}`,
      ),
    );
    const prepared: PreparedUnit = {
      indices: [index],
      key,
      boundaryTokens,
      protectedText: boundaryTokens.length
        ? combineSegments(preparedSegments.map(({ protection }) => protection.text), boundaryTokens)
        : (preparedSegments[0]?.protection.text ?? ""),
      segments: preparedSegments,
    };
    misses.push(prepared);
    missesByKey.set(key, prepared);
  }

  for (const batch of requestBatches(misses, options.settings.providerId)) {
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
        const preparedSegment = prepared.segments[index];
        if (!preparedSegment) throw new Error("Chybí ochrana přeloženého HTML segmentu.");
        const restored = restoreGlossaryTerms(segment, preparedSegment.protection);
        return `${preparedSegment.leading}${restored}${preparedSegment.trailing}`;
      });
      for (const index of prepared.indices) translated[index] = segments;
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
