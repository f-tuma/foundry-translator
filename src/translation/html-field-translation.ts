import type { GlossaryEntry } from "../glossary/types";
import type { TranslationProvider } from "../providers/types";
import type { ProviderId } from "../settings/settings";
import type { TranslationCache } from "./cache";
import { planHtmlTranslation } from "./html";
import { readPath, writePath, type HtmlFieldPath } from "./system-html-fields";
import {
  translateUnits,
  type TranslationQualityFallback,
} from "./unit-translator";

export interface HtmlFieldTranslationTarget {
  owner: unknown;
  path: HtmlFieldPath;
  itemName?: string;
}

interface PreparedHtmlField {
  target: HtmlFieldTranslationTarget;
  targetIndex: number;
  units: readonly (readonly string[])[];
  apply(translated: readonly (readonly string[])[]): string;
}

export interface TranslateHtmlFieldsOptions {
  targets: readonly HtmlFieldTranslationTarget[];
  glossary: readonly GlossaryEntry[];
  provider: TranslationProvider;
  settings: {
    providerId: ProviderId;
    sourceLanguage: string;
    targetLanguage: string;
  };
  documentLabel: string;
  cache?: TranslationCache;
  ownerDocument?: Document;
  nonceFactory?: () => string;
  onProgress?: (
    target: HtmlFieldTranslationTarget,
    completedFields: number,
    totalFields: number,
  ) => void;
  onQualityFallback?: (fallback: TranslationQualityFallback) => void;
}

export interface TranslatedHtmlFields {
  translatedHtmlFields: number;
  fallbackTextSegments: number;
}

function fieldBatchSize(providerId: ProviderId): number {
  if (providerId === "chrome-local") return 1;
  if (providerId === "openai-compatible") return 4;
  return 8;
}

export async function translateHtmlFields(
  options: TranslateHtmlFieldsOptions,
): Promise<TranslatedHtmlFields> {
  const prepared: PreparedHtmlField[] = [];
  for (const [targetIndex, target] of options.targets.entries()) {
    const content = readPath(target.owner, target.path);
    if (typeof content !== "string" || !content.trim()) continue;
    const plan = planHtmlTranslation(content, options.ownerDocument);
    if (!plan.units.length) continue;
    prepared.push({
      target,
      targetIndex,
      units: plan.units,
      apply: plan.apply,
    });
  }

  let translatedHtmlFields = 0;
  let fallbackTextSegments = 0;
  const batchSize = fieldBatchSize(options.settings.providerId);
  for (let start = 0; start < prepared.length; start += batchSize) {
    const batch = prepared.slice(start, start + batchSize);
    const units = batch.flatMap(({ units }) => units);
    const translated = await translateUnits({
      units,
      glossary: options.glossary,
      provider: options.provider,
      settings: options.settings,
      ...(options.cache ? { cache: options.cache } : {}),
      ...(options.nonceFactory ? { nonceFactory: options.nonceFactory } : {}),
      onQualityFallback: (fallback) => {
        fallbackTextSegments += fallback.occurrences;
        options.onQualityFallback?.(fallback);
      },
    });

    let translatedOffset = 0;
    for (const field of batch) {
      const fieldTranslation = translated.slice(
        translatedOffset,
        translatedOffset + field.units.length,
      );
      translatedOffset += field.units.length;
      const output = field.apply(fieldTranslation);
      if (/__FT[NGS]_/iu.test(output)) {
        throw new Error(`Překlad ${options.documentLabel} obsahuje neobnovený ochranný token.`);
      }
      if (!writePath(field.target.owner, field.target.path, output)) {
        throw new Error(
          `Nepodařilo se zapsat HTML pole ${options.documentLabel}: ${field.target.path.join(".")}`,
        );
      }
      translatedHtmlFields += 1;
      options.onProgress?.(
        field.target,
        field.targetIndex + 1,
        options.targets.length,
      );
    }
  }

  return { translatedHtmlFields, fallbackTextSegments };
}
