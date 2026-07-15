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
import {
  protectFoundrySyntax,
  restoreFoundrySyntax,
  type FoundrySyntaxProtection,
} from "./foundry-syntax";

const MAX_UNITS_PER_REQUEST = 128;
const MAX_CHROME_UNITS_PER_REQUEST = 16;
const MAX_OPENAI_UNITS_PER_REQUEST = 16;
const QUALITY_ATTEMPTS = 3;
export const MAX_REQUEST_CHARACTERS = 4_500;
const PROTECTION_TOKEN = /__(?:FTN|FTG|FTS)_[A-Z0-9]+_[A-Z0-9]+__/giu;
const URL_TLDS = new Set(["com", "org", "net", "io", "cz", "dev"]);
const SOURCE_LANGUAGE_HINTS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set([
    "a", "an", "and", "are", "as", "at", "be", "for", "from", "in", "is", "of",
    "on", "that", "the", "this", "to", "with", "you", "your",
  ]),
  de: new Set([
    "als", "auf", "das", "der", "die", "ein", "eine", "für", "ist", "mit", "und",
    "von", "zu",
  ]),
  fr: new Set([
    "au", "aux", "avec", "ce", "ces", "dans", "de", "des", "du", "est", "et", "la",
    "le", "les", "pour", "un", "une",
  ]),
  pl: new Set([
    "a", "do", "i", "jest", "na", "nie", "od", "po", "przez", "się", "to", "w", "z",
    "za", "że",
  ]),
};

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
  onQualityFallback?: (fallback: TranslationQualityFallback) => void;
}

export interface TranslationQualityFallback {
  sourcePreview: string;
  reason: "empty" | "integrity" | "provider" | "unchanged";
  detail: string;
  attempts: number;
  occurrences: number;
}

interface PreparedUnit {
  indices: number[];
  key: string;
  protectedText: string;
  segments: PreparedSegment[];
  boundaryTokens: string[];
}

interface PreparedSegment {
  syntax: FoundrySyntaxProtection;
  protection: ReturnType<typeof protectGlossaryTerms>;
  leading: string;
  trailing: string;
}

interface TranslationProblem {
  reason: TranslationQualityFallback["reason"];
  detail: string;
}

interface CheckedSegments {
  segments: readonly string[];
  usedFallback: boolean;
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
  providerIdentity?: string,
): Promise<string> {
  return sha256(
    JSON.stringify({
      schemaVersion: 4,
      segments,
      glossaryFingerprint,
      ...(providerIdentity ? { providerIdentity } : {}),
      ...settings,
    }),
  );
}

function comparableText(text: string): string {
  PROTECTION_TOKEN.lastIndex = 0;
  return text
    .replace(PROTECTION_TOKEN, " ")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function visibleSourceWords(text: string): string[] {
  PROTECTION_TOKEN.lastIndex = 0;
  return text
    .replace(PROTECTION_TOKEN, " ")
    .normalize("NFKC")
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? [];
}

function looksLikeProperTitle(
  source: string,
  settings: TranslationUnitSettings,
): boolean {
  const words = visibleSourceWords(source);
  if (words.length < 2 || words.length > 6) return false;
  const hints = SOURCE_LANGUAGE_HINTS[settings.sourceLanguage] ??
    (settings.sourceLanguage === "auto" ? SOURCE_LANGUAGE_HINTS.en : undefined);
  let namedWords = 0;
  for (const word of words) {
    const normalized = word.toLocaleLowerCase();
    if (hints?.has(normalized)) continue;
    if (!/^\p{Lu}/u.test(word)) return false;
    namedWords += 1;
  }
  return namedWords >= 2;
}

function looksLikeUrlReference(source: string): boolean {
  const words = visibleSourceWords(source).map((word) => word.toLocaleLowerCase());
  if (words[0] !== "http" && words[0] !== "https" && words[0] !== "www") return false;
  return words.some((word) => URL_TLDS.has(word));
}

function suspiciouslyUnchanged(
  source: string,
  translated: string,
  settings: TranslationUnitSettings,
): boolean {
  if (settings.sourceLanguage === settings.targetLanguage) return false;
  const sourceText = comparableText(source);
  const translatedText = comparableText(translated);
  if (!sourceText || sourceText !== translatedText) return false;

  const words = sourceText.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = (sourceText.match(/\p{L}/gu) ?? []).length;
  if (letters < 8 || words.length < 2) return false;
  if (looksLikeUrlReference(source)) return false;
  if (looksLikeProperTitle(source, settings)) return false;
  if (words.length >= 5 && letters >= 20) return true;

  const hints = SOURCE_LANGUAGE_HINTS[settings.sourceLanguage] ??
    (settings.sourceLanguage === "auto" ? SOURCE_LANGUAGE_HINTS.en : undefined);
  return !!hints && letters >= 10 && words.some((word) => hints.has(word));
}

function translationProblem(
  prepared: PreparedSegment,
  translated: string,
  settings: TranslationUnitSettings,
): TranslationProblem | null {
  if (!translated.trim() && comparableText(prepared.protection.text)) {
    return { reason: "empty", detail: "The provider returned empty text." };
  }
  try {
    const glossaryRestored = restoreGlossaryTerms(translated, prepared.protection);
    restoreFoundrySyntax(glossaryRestored, prepared.syntax);
  } catch (error) {
    return {
      reason: "integrity",
      detail: error instanceof Error ? error.message : "The provider corrupted protection tokens.",
    };
  }
  if (suspiciouslyUnchanged(prepared.protection.text, translated, settings)) {
    const preview = comparableText(prepared.protection.text).slice(0, 100);
    return {
      reason: "unchanged",
      detail: `The provider left the text in the source language: "${preview}".`,
    };
  }
  return null;
}

async function retrySuspiciousSegments(
  prepared: PreparedUnit,
  protectedSegments: readonly string[],
  provider: TranslationProvider,
  settings: TranslationUnitSettings,
  glossary: readonly GlossaryEntry[],
  onQualityFallback?: (fallback: TranslationQualityFallback) => void,
): Promise<CheckedSegments> {
  const checked: string[] = [];
  let usedFallback = false;
  for (const [index, initial] of protectedSegments.entries()) {
    const preparedSegment = prepared.segments[index];
    if (!preparedSegment) throw new Error("Chybí metadata kontrolovaného překladu.");
    const source = preparedSegment.protection.text;
    let candidate = initial;
    let attempt = 1;
    let problem = translationProblem(preparedSegment, candidate, settings);
    while (attempt < QUALITY_ATTEMPTS && problem) {
      attempt += 1;
      try {
        const [retry] = await provider.translate({
          texts: [source],
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          format: "text",
          glossary,
        });
        candidate = typeof retry?.translatedText === "string" ? retry.translatedText : "";
        problem = translationProblem(preparedSegment, candidate, settings);
      } catch (error) {
        problem = {
          reason: "provider",
          detail: error instanceof Error
            ? error.message
            : "The retry translation of the fragment failed.",
        };
        break;
      }
    }
    if (problem) {
      usedFallback = true;
      onQualityFallback?.({
        sourcePreview: comparableText(source).slice(0, 100),
        reason: problem.reason,
        detail: problem.detail,
        attempts: attempt,
        occurrences: prepared.indices.length,
      });
      candidate = source;
    }
    checked.push(candidate);
  }
  return { segments: checked, usedFallback };
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
  glossary: readonly GlossaryEntry[],
): Promise<string[]> {
  const translatable = prepared.segments
    .map(({ protection }, index) => ({ text: protection.text, index }))
    .filter(({ text }) => text.length > 0);
  const results = await provider.translate({
    texts: translatable.map(({ text }) => text),
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    format: "text",
    glossary,
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
  const syntax = protectFoundrySyntax(core, { nonce });
  return {
    leading,
    trailing,
    syntax,
    protection: protectGlossaryTerms(
      syntax.text,
      glossary,
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
    : providerId === "openai-compatible"
      ? MAX_OPENAI_UNITS_PER_REQUEST
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

/** Stable hash of the glossary contents, including custom replacements. */
export async function glossaryFingerprint(entries: readonly GlossaryEntry[]): Promise<string> {
  return sha256(glossarySnapshot(entries));
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
    key: await cacheKey(
      segments,
      glossaryFingerprint,
      options.settings,
      options.provider.cacheIdentity,
    ),
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
    if (segments.length > 0 && segments.every((segment) => looksLikeUrlReference(segment))) {
      translated[index] = segments;
      continue;
    }
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
      glossary: options.glossary,
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
          try {
            protectedSegments = await translateSegmentsSeparately(
              prepared,
              options.provider,
              options.settings,
              options.glossary,
            );
          } catch {
            protectedSegments = prepared.segments.map(({ protection }) => protection.text);
          }
        }
      }
      const checked = await retrySuspiciousSegments(
        prepared,
        protectedSegments,
        options.provider,
        options.settings,
        options.glossary,
        options.onQualityFallback,
      );
      protectedSegments = checked.segments;
      const segments = protectedSegments.map((segment, index) => {
        const preparedSegment = prepared.segments[index];
        if (!preparedSegment) throw new Error("Chybí ochrana přeloženého HTML segmentu.");
        const glossaryRestored = restoreGlossaryTerms(segment, preparedSegment.protection);
        const restored = restoreFoundrySyntax(glossaryRestored, preparedSegment.syntax);
        return `${preparedSegment.leading}${restored}${preparedSegment.trailing}`;
      });
      for (const index of prepared.indices) translated[index] = segments;
      if (!checked.usedFallback) {
        cacheWrites.push({ key: prepared.key, translatedSegments: segments });
      }
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
