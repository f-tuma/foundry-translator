import { MODULE_ID } from "../constants";
import type { GlossaryEntry } from "../glossary/types";
import type { TranslationProvider } from "../providers/types";
import { isProviderId, type ProviderId } from "../settings/settings";
import type { TranslationCache } from "./cache";
import { sha256 } from "./hash";
import {
  translateHtmlFields,
  type HtmlFieldTranslationTarget,
} from "./html-field-translation";
import { translatedOutputHash } from "./output-hash";
import type { HtmlFieldPath } from "./system-html-fields";
import {
  glossaryFingerprint,
  type TranslationQualityFallback,
} from "./unit-translator";

export const ACTOR_TRANSLATION_SCHEMA_VERSION = 1;
export const ACTOR_TRANSLATION_ENGINE_REVISION = 3;

export interface ActorItemData extends Record<string, unknown> {
  _id?: string;
  _stats?: unknown;
  name?: string;
  system?: Record<string, unknown>;
}

export interface ActorData extends Record<string, unknown> {
  _id?: string;
  _stats?: unknown;
  name: string;
  type: string;
  system: Record<string, unknown>;
  items?: ActorItemData[];
  flags?: Record<string, Record<string, unknown>>;
}

export interface ActorTranslationFlag {
  schemaVersion: typeof ACTOR_TRANSLATION_SCHEMA_VERSION;
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

export interface ActorTranslationProgress {
  completedFields: number;
  totalFields: number;
  fieldPath: readonly (string | number)[];
  itemName?: string;
}

export interface TranslateActorOptions {
  source: ActorData;
  sourceUuid: string;
  glossary: readonly GlossaryEntry[];
  provider: TranslationProvider;
  settings: {
    providerId: ProviderId;
    sourceLanguage: string;
    targetLanguage: string;
  };
  systemHtmlFieldPaths: readonly HtmlFieldPath[];
  itemHtmlFieldPaths: readonly (readonly HtmlFieldPath[])[];
  cache?: TranslationCache;
  ownerDocument?: Document;
  nonceFactory?: () => string;
  onProgress?: (progress: ActorTranslationProgress) => void;
  onQualityFallback?: (fallback: TranslationQualityFallback) => void;
}

export interface TranslatedActor {
  data: ActorData;
  translatedHtmlFields: number;
  fallbackTextSegments: number;
}

export function readActorTranslationFlag(
  flags: ActorData["flags"],
): ActorTranslationFlag | null {
  const value = flags?.[MODULE_ID]?.actorTranslation;
  if (!value || typeof value !== "object") return null;
  const flag = value as Partial<ActorTranslationFlag>;
  if (
    flag.schemaVersion !== ACTOR_TRANSLATION_SCHEMA_VERSION ||
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
  } as ActorTranslationFlag;
}

export function canReuseActorTranslation(
  flag: ActorTranslationFlag,
  sourceHash: string,
  glossaryHash?: string,
): boolean {
  return flag.sourceHash === sourceHash &&
    flag.engineRevision === ACTOR_TRANSLATION_ENGINE_REVISION &&
    (glossaryHash === undefined || flag.glossaryFingerprint === glossaryHash);
}

function sourceSnapshot(source: ActorData): string {
  return JSON.stringify({
    name: source.name,
    type: source.type,
    system: source.system,
    items: source.items,
  });
}

export async function actorSourceHash(source: ActorData): Promise<string> {
  return sha256(sourceSnapshot(source));
}

export async function stampActorOutputHash(data: ActorData): Promise<string> {
  const flag = readActorTranslationFlag(data.flags);
  if (!flag) throw new Error("Přeložený Actor nemá platná metadata pro otisk výstupu.");
  const outputHash = await translatedOutputHash(data);
  flag.outputHash = outputHash;
  data.flags = {
    ...data.flags,
    [MODULE_ID]: { ...data.flags?.[MODULE_ID], actorTranslation: flag },
  };
  return outputHash;
}

export async function translateActorData(options: TranslateActorOptions): Promise<TranslatedActor> {
  const copy = structuredClone(options.source);
  delete copy._id;
  delete copy._stats;
  delete copy.folder;
  copy.name = `${copy.name} [${options.settings.targetLanguage.toUpperCase()}]`;
  for (const item of copy.items ?? []) delete item._stats;

  const targets: HtmlFieldTranslationTarget[] = options.systemHtmlFieldPaths.map((path) => ({
    owner: copy.system,
    path,
  }));
  options.itemHtmlFieldPaths.forEach((paths, itemIndex) => {
    const item = copy.items?.[itemIndex];
    if (!item) return;
    paths.forEach((path) => targets.push({
      owner: item.system,
      path,
      ...(item.name ? { itemName: item.name } : {}),
    }));
  });

  const { translatedHtmlFields, fallbackTextSegments } = await translateHtmlFields({
    targets,
    glossary: options.glossary,
    provider: options.provider,
    settings: options.settings,
    documentLabel: "Actoru",
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
      ...(target.itemName ? { itemName: target.itemName } : {}),
    }),
  });

  const sourceHash = await actorSourceHash(options.source);
  const glossaryHash = await glossaryFingerprint(options.glossary);
  copy.flags = {
    ...copy.flags,
    [MODULE_ID]: {
      ...copy.flags?.[MODULE_ID],
      actorTranslation: {
        schemaVersion: ACTOR_TRANSLATION_SCHEMA_VERSION,
        engineRevision: ACTOR_TRANSLATION_ENGINE_REVISION,
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
