import { MODULE_ID } from "../constants";
import type { GlossaryEntry } from "../glossary/types";
import type { TranslationProvider } from "../providers/types";
import { isProviderId, type ProviderId } from "../settings/settings";
import type { TranslationCache } from "./cache";
import { sha256 } from "./hash";
import { translateHtmlFields } from "./html-field-translation";
import { translatedOutputHash } from "./output-hash";
import type { HtmlFieldPath } from "./system-html-fields";
import {
  glossaryFingerprint,
  type TranslationQualityFallback,
} from "./unit-translator";

export const ITEM_TRANSLATION_SCHEMA_VERSION = 1;
export const ITEM_TRANSLATION_ENGINE_REVISION = 3;

export interface ItemData extends Record<string, unknown> {
  _id?: string;
  _stats?: unknown;
  name: string;
  type: string;
  system: Record<string, unknown>;
  flags?: Record<string, Record<string, unknown>>;
}

export interface ItemTranslationFlag {
  schemaVersion: typeof ITEM_TRANSLATION_SCHEMA_VERSION;
  engineRevision: number;
  sourceUuid: string;
  sourceHash: string;
  providerId: ProviderId;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translatedHtmlFields: number;
  fallbackTextSegments: number;
  /** Glossary hash at translation time; a changed glossary invalidates reuse. */
  glossaryFingerprint?: string;
  /** Fingerprint of the generated copy, used to detect later manual edits. */
  outputHash?: string;
}

export interface ItemTranslationProgress {
  completedFields: number;
  totalFields: number;
  fieldPath: readonly (string | number)[];
}

export interface TranslateItemOptions {
  source: ItemData;
  sourceUuid: string;
  glossary: readonly GlossaryEntry[];
  provider: TranslationProvider;
  settings: {
    providerId: ProviderId;
    sourceLanguage: string;
    targetLanguage: string;
  };
  systemHtmlFieldPaths: readonly HtmlFieldPath[];
  cache?: TranslationCache;
  ownerDocument?: Document;
  nonceFactory?: () => string;
  onProgress?: (progress: ItemTranslationProgress) => void;
  onQualityFallback?: (fallback: TranslationQualityFallback) => void;
}

export interface TranslatedItem {
  data: ItemData;
  translatedHtmlFields: number;
  fallbackTextSegments: number;
}

export function readItemTranslationFlag(
  flags: ItemData["flags"],
): ItemTranslationFlag | null {
  const value = flags?.[MODULE_ID]?.itemTranslation;
  if (!value || typeof value !== "object") return null;
  const flag = value as Partial<ItemTranslationFlag>;
  if (
    flag.schemaVersion !== ITEM_TRANSLATION_SCHEMA_VERSION ||
    typeof flag.sourceUuid !== "string" ||
    typeof flag.sourceHash !== "string" ||
    !isProviderId(flag.providerId) ||
    typeof flag.sourceLanguage !== "string" ||
    typeof flag.targetLanguage !== "string" ||
    typeof flag.translatedAt !== "string" ||
    typeof flag.translatedHtmlFields !== "number"
  ) return null;
  return {
    ...flag,
    engineRevision: typeof flag.engineRevision === "number" ? flag.engineRevision : 0,
    fallbackTextSegments:
      typeof flag.fallbackTextSegments === "number" ? flag.fallbackTextSegments : 0,
  } as ItemTranslationFlag;
}

export function canReuseItemTranslation(
  flag: ItemTranslationFlag,
  sourceHash: string,
  glossaryHash?: string,
): boolean {
  return flag.sourceHash === sourceHash &&
    flag.engineRevision === ITEM_TRANSLATION_ENGINE_REVISION &&
    (glossaryHash === undefined || flag.glossaryFingerprint === glossaryHash);
}

function sourceSnapshot(source: ItemData): string {
  return JSON.stringify({
    name: source.name,
    type: source.type,
    system: source.system,
  });
}

export async function itemSourceHash(source: ItemData): Promise<string> {
  return sha256(sourceSnapshot(source));
}

export async function stampItemOutputHash(data: ItemData): Promise<string> {
  const flag = readItemTranslationFlag(data.flags);
  if (!flag) throw new Error("Přeložený Item nemá platná metadata pro otisk výstupu.");
  const outputHash = await translatedOutputHash(data);
  flag.outputHash = outputHash;
  data.flags = {
    ...data.flags,
    [MODULE_ID]: { ...data.flags?.[MODULE_ID], itemTranslation: flag },
  };
  return outputHash;
}

export async function translateItemData(options: TranslateItemOptions): Promise<TranslatedItem> {
  const copy = structuredClone(options.source);
  delete copy._id;
  delete copy._stats;
  delete copy.folder;
  copy.name = `${copy.name} [${options.settings.targetLanguage.toUpperCase()}]`;

  const { translatedHtmlFields, fallbackTextSegments } = await translateHtmlFields({
    targets: options.systemHtmlFieldPaths.map((path) => ({ owner: copy.system, path })),
    glossary: options.glossary,
    provider: options.provider,
    settings: options.settings,
    documentLabel: "Itemu",
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.ownerDocument ? { ownerDocument: options.ownerDocument } : {}),
    ...(options.nonceFactory ? { nonceFactory: options.nonceFactory } : {}),
    ...(options.onQualityFallback
      ? { onQualityFallback: options.onQualityFallback }
      : {}),
    onProgress: (target, completedFields, totalFields) => options.onProgress?.({
      completedFields,
      totalFields,
      fieldPath: target.path,
    }),
  });

  const sourceHash = await itemSourceHash(options.source);
  const glossaryHash = await glossaryFingerprint(options.glossary);
  copy.flags = {
    ...copy.flags,
    [MODULE_ID]: {
      ...copy.flags?.[MODULE_ID],
      itemTranslation: {
        schemaVersion: ITEM_TRANSLATION_SCHEMA_VERSION,
        engineRevision: ITEM_TRANSLATION_ENGINE_REVISION,
        sourceUuid: options.sourceUuid,
        sourceHash,
        providerId: options.settings.providerId,
        sourceLanguage: options.settings.sourceLanguage,
        targetLanguage: options.settings.targetLanguage,
        translatedAt: new Date().toISOString(),
        translatedHtmlFields,
        fallbackTextSegments,
        glossaryFingerprint: glossaryHash,
      },
    },
  };

  return { data: copy, translatedHtmlFields, fallbackTextSegments };
}
