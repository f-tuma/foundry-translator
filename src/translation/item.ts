import { providerFingerprint } from "./provider-fingerprint";
import { translateDocumentNames } from "./document-names";
import { MODULE_ID } from "../constants";
import type { GlossaryEntry } from "../glossary/types";
import type { TranslationProvider } from "../providers/types";
import { isProviderId, type ProviderId } from "../settings/settings";
import type { TranslationCache } from "./cache";
import { sha256 } from "./hash";
import { translateHtmlFields } from "./html-field-translation";
import { translatedOutputHash } from "./output-hash";
import { assertSystemActionFieldIdentity, readPath, writePath, type HtmlFieldPath } from "./system-html-fields";
import { assertPortableText } from "../bundles/format";
import { proseNumbers } from "../polish/quality-guards";
import {
  glossaryFingerprint,
  translateUnits,
  type TranslationQualityFallback,
} from "./unit-translator";

export const ITEM_TRANSLATION_SCHEMA_VERSION = 1;
export const ITEM_TRANSLATION_ENGINE_REVISION = 9;

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
  providerFingerprint?: string;
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
  /** Plain names selected by the local Crucible action schema allowlist. */
  actionNameFieldPaths?: readonly HtmlFieldPath[];
  /** Displayed trigger sentences selected by the local Crucible schema. */
  actionConditionFieldPaths?: readonly HtmlFieldPath[];
  cache?: TranslationCache;
  ownerDocument?: Document;
  nonceFactory?: () => string;
  beforeBatch?: () => Promise<void>;
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
  providerHash?: string,
): boolean {
  return flag.sourceHash === sourceHash &&
    flag.engineRevision === ITEM_TRANSLATION_ENGINE_REVISION &&
    (glossaryHash === undefined || flag.glossaryFingerprint === glossaryHash) &&
    (providerHash === undefined || flag.providerFingerprint === providerHash);
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

export interface ActionConditionTranslationTarget {
  owner: unknown;
  path: HtmlFieldPath;
  itemName?: string;
}

/** Translate one complete trigger sentence per unit. Conditions never pass
 * through canonical-title substitution or any title-casing operation. */
export async function translateActionConditions(
  targets: readonly ActionConditionTranslationTarget[],
  options: Pick<TranslateItemOptions, "glossary" | "provider" | "settings" | "cache" | "nonceFactory" | "beforeBatch" | "onQualityFallback">,
  documentTitle: string,
): Promise<number> {
  const pending = targets.flatMap(target => {
    const { path } = target;
    if (path.length !== 3 || path[0] !== "actions" || typeof path[1] !== "number"
      || !Number.isInteger(path[1]) || path[1] < 0 || path[2] !== "condition") return [];
    const source = readPath(target.owner, path);
    if (typeof source !== "string" || !source.trim()) return [];
    assertSystemActionFieldIdentity({ system: target.owner }, { system: target.owner }, ["system", ...path]);
    return [{ target, source }];
  });
  let fallbacks = 0;
  for (let start = 0; start < pending.length; start += 4) {
    await options.beforeBatch?.();
    const batch = pending.slice(start, start + 4);
    const output = await translateUnits({ ...options, units: batch.map(field => [field.source]),
      contexts: batch.map(({ target }) => ({ documentTitle, field: target.path.join("."),
        ...(target.itemName ? { sectionTitle: target.itemName } : {}) })),
      onQualityFallback: issue => { fallbacks += issue.occurrences; options.onQualityFallback?.(issue); },
    });
    batch.forEach(({ target, source }, index) => {
      let text = output[index]?.[0] ?? source;
      try {
        assertPortableText(source, text, "text");
        if (JSON.stringify(proseNumbers([source])) !== JSON.stringify(proseNumbers([text]))) {
          throw new Error("Action condition numbers changed");
        }
      } catch (error) {
        text = source;
        fallbacks += 1;
        options.onQualityFallback?.({ reason: "integrity", sourcePreview: source.slice(0, 200),
          detail: error instanceof Error ? error.message : String(error), attempts: 1, occurrences: 1 });
      }
      if (!writePath(target.owner, target.path, text)) throw new Error(`Cannot write Action condition: ${target.path.join(".")}`);
    });
  }
  return fallbacks;
}

export async function translateItemData(options: TranslateItemOptions): Promise<TranslatedItem> {
  const copy = structuredClone(options.source);
  delete copy._id;
  delete copy._stats;
  delete copy.folder;
  const actionNames = (options.actionNameFieldPaths ?? []).flatMap((path) => {
    // Never let a plain-text option reach adjacent action configuration.
    if (path.length !== 3 || path[0] !== "actions" || typeof path[1] !== "number"
      || !Number.isInteger(path[1]) || path[1] < 0 || path[2] !== "name") return [];
    const name = readPath(copy.system, path);
    return typeof name === "string" && name.trim() ? [{ path, name }] : [];
  });
  const names = await translateDocumentNames([copy.name, ...actionNames.map(({ name }) => name)], options);
  copy.name = names.names[0]!;
  actionNames.forEach(({ path }, index) => {
    if (!writePath(copy.system, path, names.names[index + 1]!)) {
      throw new Error(`Nepodařilo se zapsat název akce Itemu: ${path.join(".")}`);
    }
  });

  const conditionFallbacks = await translateActionConditions(
    (options.actionConditionFieldPaths ?? []).map(path => ({ owner: copy.system, path })), options, options.source.name,
  );

  const fields = await translateHtmlFields({
    ...(options.beforeBatch ? { beforeBatch: options.beforeBatch } : {}),
    targets: options.systemHtmlFieldPaths.map((path) => ({ owner: copy.system, path })),
    glossary: options.glossary,
    provider: options.provider,
    settings: options.settings,
    documentTitle: options.source.name,
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
  const translatedHtmlFields = fields.translatedHtmlFields;
  const fallbackTextSegments = fields.fallbackTextSegments + names.fallbacks + conditionFallbacks;

  const sourceHash = await itemSourceHash(options.source);
  const glossaryHash = await glossaryFingerprint(options.glossary);
  const providerHash = await providerFingerprint(options.settings.providerId, options.provider, options.settings.sourceLanguage);
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
          providerFingerprint: providerHash,
      },
    },
  };

  return { data: copy, translatedHtmlFields, fallbackTextSegments };
}
