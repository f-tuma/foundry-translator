import { MODULE_ID } from "../constants";
import type { GlossaryEntry } from "../glossary/types";
import type { TranslationProvider } from "../providers/types";
import { isProviderId, type ProviderId } from "../settings/settings";
import type { TranslationCache } from "./cache";
import { sha256 } from "./hash";
import { planHtmlTranslation } from "./html";
import { planMarkdownTranslation } from "./markdown";
import { translatedOutputHash } from "./output-hash";
import { readPath, writePath, type HtmlFieldPath } from "./system-html-fields";
import {
  glossaryFingerprint,
  translateUnits,
  type TranslationQualityFallback,
} from "./unit-translator";

export const TRANSLATION_SCHEMA_VERSION = 1;
export const TRANSLATION_ENGINE_REVISION = 6;
const HTML_FORMAT = 1;
const MARKDOWN_FORMAT = 2;

export interface JournalPageData extends Record<string, unknown> {
  _id?: string;
  _stats?: unknown;
  name: string;
  type: string;
  text?: {
    content?: string;
    format?: number;
    markdown?: string;
    [key: string]: unknown;
  };
  system?: Record<string, unknown>;
}

export interface JournalCategoryData extends Record<string, unknown> {
  _id?: string;
  id?: string;
  name: string;
}

export interface JournalData extends Record<string, unknown> {
  _id?: string;
  _stats?: unknown;
  name: string;
  pages: JournalPageData[];
  categories?: JournalCategoryData[];
  flags?: Record<string, Record<string, unknown>>;
}

export interface JournalTranslationSettings {
  providerId: ProviderId;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslateJournalOptions {
  source: JournalData;
  sourceUuid: string;
  glossary: readonly GlossaryEntry[];
  provider: TranslationProvider;
  settings: JournalTranslationSettings;
  cache?: TranslationCache;
  ownerDocument?: Document;
  nonceFactory?: () => string;
  systemHtmlFieldPaths?: readonly (readonly HtmlFieldPath[])[];
  /** Translate only these pages; the rest stay source copies and the flag records a partial translation. */
  pageIds?: readonly string[];
  onProgress?: (progress: JournalTranslationProgress) => void;
  /** Reports the page currently being prepared before its first provider request. */
  onPageStart?: (pageName: string) => void;
  onQualityFallback?: (fallback: TranslationQualityFallback) => void;
}

export interface JournalTranslationProgress {
  kind?: "journal-page" | "actor-field" | "item-field";
  completedPages: number;
  totalPages: number;
  pageIndex: number;
  pageName: string;
  translatedText: boolean;
  skippedText: boolean;
  documentName?: string;
  overallCompletedUnits?: number;
  overallTotalUnits?: number;
  completedDocuments?: number;
  totalDocuments?: number;
}

export interface TranslatedJournal {
  data: JournalData;
  translatedTextPages: number;
  skippedTextPages: number;
  fallbackTextSegments: number;
}

export interface JournalTranslationFlag {
  schemaVersion: typeof TRANSLATION_SCHEMA_VERSION;
  engineRevision: number;
  sourceUuid: string;
  sourceHash: string;
  providerId: ProviderId;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translatedTextPages: number;
  skippedTextPages: number;
  fallbackTextSegments: number;
  /**
   * True while only a subset of pages is translated. Stored explicitly
   * because Foundry's update merges flag objects, so a missing key would
   * silently keep its previous stored value.
   */
  partial: boolean;
  /** Source page IDs already processed by partial runs. */
  processedPageIds?: string[];
  /** Glossary hash at translation time; a changed glossary invalidates reuse. */
  glossaryFingerprint?: string;
  /** Fingerprint of the generated copy, used to detect later manual edits. */
  outputHash?: string;
}

export function readJournalTranslationFlag(
  flags: JournalData["flags"],
): JournalTranslationFlag | null {
  const value = flags?.[MODULE_ID]?.translation;
  if (!value || typeof value !== "object") return null;
  const flag = value as Partial<JournalTranslationFlag>;
  if (
    flag.schemaVersion !== TRANSLATION_SCHEMA_VERSION ||
    typeof flag.sourceUuid !== "string" ||
    typeof flag.sourceHash !== "string" ||
    !isProviderId(flag.providerId) ||
    typeof flag.sourceLanguage !== "string" ||
    typeof flag.targetLanguage !== "string" ||
    typeof flag.translatedAt !== "string" ||
    typeof flag.translatedTextPages !== "number" ||
    typeof flag.skippedTextPages !== "number"
  ) {
    return null;
  }
  return {
    ...flag,
    engineRevision:
      typeof flag.engineRevision === "number" ? flag.engineRevision : 0,
    fallbackTextSegments:
      typeof flag.fallbackTextSegments === "number" ? flag.fallbackTextSegments : 0,
    partial: flag.partial === true,
  } as JournalTranslationFlag;
}

export function canReuseJournalTranslation(
  flag: JournalTranslationFlag,
  sourceHash: string,
  glossaryHash?: string,
): boolean {
  return flag.sourceHash === sourceHash &&
    flag.engineRevision === TRANSLATION_ENGINE_REVISION &&
    !flag.partial &&
    (glossaryHash === undefined || flag.glossaryFingerprint === glossaryHash);
}

export function canReuseJournalPageTranslation(
  flag: JournalTranslationFlag,
  sourceHash: string,
  pageId: string,
  glossaryHash?: string,
): boolean {
  return flag.sourceHash === sourceHash &&
    flag.engineRevision === TRANSLATION_ENGINE_REVISION &&
    (!flag.partial || (flag.processedPageIds?.includes(pageId) ?? false)) &&
    (glossaryHash === undefined || flag.glossaryFingerprint === glossaryHash);
}

/**
 * Merges a new partial translation into an existing hash-compatible partial
 * translation: pages already processed earlier are taken from the stored
 * translation, counters are combined, and once every source page is covered
 * the merged flag becomes a complete translation.
 */
export function mergePartialJournalTranslation(
  existing: JournalData,
  partial: JournalData,
): JournalData {
  const existingFlag = readJournalTranslationFlag(existing.flags);
  const partialFlag = readJournalTranslationFlag(partial.flags);
  if (!existingFlag?.partial || !partialFlag?.partial) return partial;
  if (!existingFlag.processedPageIds || !partialFlag.processedPageIds) return partial;
  if (existingFlag.sourceHash !== partialFlag.sourceHash ||
    existingFlag.engineRevision !== partialFlag.engineRevision) return partial;

  const merged = structuredClone(partial);
  const partialProcessed = new Set(partialFlag.processedPageIds);
  const existingProcessed = new Set(existingFlag.processedPageIds);
  const existingPages = new Map(existing.pages.map((page) => [page._id, page]));
  merged.pages = merged.pages.map((page) => {
    if (!page._id || partialProcessed.has(page._id) || !existingProcessed.has(page._id)) {
      return page;
    }
    return structuredClone(existingPages.get(page._id) ?? page);
  });

  const processedPageIds = [...new Set([...existingFlag.processedPageIds, ...partialFlag.processedPageIds])];
  const complete = merged.pages.every((page) => page._id && processedPageIds.includes(page._id));
  const flag: JournalTranslationFlag = {
    ...partialFlag,
    translatedTextPages: existingFlag.translatedTextPages + partialFlag.translatedTextPages,
    skippedTextPages: existingFlag.skippedTextPages + partialFlag.skippedTextPages,
    fallbackTextSegments: existingFlag.fallbackTextSegments + partialFlag.fallbackTextSegments,
    partial: !complete,
    processedPageIds,
  };
  merged.flags = {
    ...merged.flags,
    [MODULE_ID]: { ...merged.flags?.[MODULE_ID], translation: flag },
  };
  return merged;
}

interface TranslationTarget {
  segments: readonly string[];
  translatedSegments?: readonly string[];
  apply(segments: readonly string[]): void;
}

interface StructuredTranslationTarget {
  start: number;
  length: number;
  apply(units: readonly (readonly string[])[]): void;
}

interface PageTranslationWork {
  pageIndex: number;
  sourcePageName: string;
  targets: TranslationTarget[];
  structuredTargets: StructuredTranslationTarget[];
  translatedPage: boolean;
  skippedPage: boolean;
}

function journalPageBatchSize(providerId: ProviderId): number {
  if (providerId === "chrome-local") return 1;
  if (providerId === "openai-compatible") return 4;
  return 8;
}

async function translateTargets(
  options: TranslateJournalOptions,
  targets: TranslationTarget[],
  structuredTargets: readonly StructuredTranslationTarget[],
  onQualityFallback: (fallback: TranslationQualityFallback) => void,
): Promise<void> {
  const translatedUnits = await translateUnits({
    units: targets.map(({ segments }) => segments),
    glossary: options.glossary,
    provider: options.provider,
    settings: options.settings,
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.nonceFactory ? { nonceFactory: options.nonceFactory } : {}),
    onQualityFallback,
  });

  targets.forEach((target, index) => {
    const translatedSegments = translatedUnits[index] ?? [];
    if (translatedSegments.some((segment) => /__FT[NGS]_/iu.test(segment))) {
      throw new Error("Překlad obsahuje neobnovený ochranný token.");
    }
    target.translatedSegments = translatedSegments;
    target.apply(translatedSegments);
  });
  for (const target of structuredTargets) {
    target.apply(
      targets
        .slice(target.start, target.start + target.length)
        .map(({ translatedSegments }) => translatedSegments ?? []),
    );
  }
}

function sourceSnapshot(source: JournalData): string {
  return JSON.stringify({
    name: source.name,
    categories: source.categories,
    pages: source.pages.map((page) => ({
      id: page._id,
      name: page.name,
      type: page.type,
      text: page.text,
      system: page.system,
    })),
  });
}

export async function journalSourceHash(source: JournalData): Promise<string> {
  return sha256(sourceSnapshot(source));
}

export async function stampJournalOutputHash(data: JournalData): Promise<string> {
  const flag = readJournalTranslationFlag(data.flags);
  if (!flag) throw new Error("Přeložený deník nemá platná metadata pro otisk výstupu.");
  const outputHash = await translatedOutputHash(data);
  flag.outputHash = outputHash;
  data.flags = {
    ...data.flags,
    [MODULE_ID]: { ...data.flags?.[MODULE_ID], translation: flag },
  };
  return outputHash;
}

export async function translateJournalData(
  options: TranslateJournalOptions,
): Promise<TranslatedJournal> {
  const copy = structuredClone(options.source);
  delete copy._id;
  delete copy._stats;

  let translatedTextPages = 0;
  let skippedTextPages = 0;
  let fallbackTextSegments = 0;
  const recordQualityFallback = (fallback: TranslationQualityFallback): void => {
    fallbackTextSegments += fallback.occurrences;
    options.onQualityFallback?.(fallback);
  };

  await translateTargets(options, [{
    segments: [copy.name],
    apply: ([translatedName]) => {
      copy.name = `${translatedName ?? copy.name} [${options.settings.targetLanguage.toUpperCase()}]`;
    },
  }], [], recordQualityFallback);

  if (copy.categories?.length) {
    const categoryTargets = copy.categories.map<TranslationTarget>((category) => ({
      segments: [category.name],
      apply: ([translatedName]) => {
        category.name = translatedName ?? category.name;
      },
    }));
    try {
      await translateTargets(options, categoryTargets, [], recordQualityFallback);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new Error(
        `Překlad skupin stránek deníku selhal.${detail} Hotové části zůstávají v cache pro další pokus.`,
        { cause: error },
      );
    }
  }

  const selectedPageIds = options.pageIds ? new Set(options.pageIds) : null;
  const selectedPages = copy.pages.filter(
    (page) => !selectedPageIds || (page._id && selectedPageIds.has(page._id)),
  );
  if (selectedPageIds && !selectedPages.length) {
    throw new Error("Vybraná stránka deníku už ve zdrojovém dokumentu neexistuje.");
  }
  let completedSelectedPages = 0;
  const pageWork: PageTranslationWork[] = [];

  for (const [pageIndex, page] of copy.pages.entries()) {
    delete page._stats;
    if (selectedPageIds && (!page._id || !selectedPageIds.has(page._id))) continue;
    const sourcePageName = page.name;
    const targets: TranslationTarget[] = [];
    const structuredTargets: StructuredTranslationTarget[] = [];
    targets.push({
      segments: [page.name],
      apply: ([translatedName]) => {
        page.name = translatedName ?? page.name;
      },
    });

    let translatedPage = false;
    let skippedPage = false;
    const queueHtml = (content: string, apply: (translated: string) => void): void => {
      const plan = planHtmlTranslation(content, options.ownerDocument);
      if (!plan.units.length) return;
      const start = targets.length;
      for (const segments of plan.units) {
        targets.push({ segments, apply: () => undefined });
      }
      structuredTargets.push({
        start,
        length: plan.units.length,
        apply: (translated) => apply(plan.apply(translated)),
      });
      translatedPage = true;
    };

    const queueMarkdown = (markdown: string, apply: (translated: string) => void): void => {
      const plan = planMarkdownTranslation(markdown);
      if (!plan.units.length) return;
      const start = targets.length;
      for (const segments of plan.units) {
        targets.push({ segments, apply: () => undefined });
      }
      structuredTargets.push({
        start,
        length: plan.units.length,
        apply: (translated) => apply(plan.apply(translated)),
      });
      translatedPage = true;
    };

    const text = page.text;
    const content = text?.content;
    const isMarkdownTextPage =
      text?.format === MARKDOWN_FORMAT &&
      (typeof text.markdown === "string" || typeof content === "string");
    const isHtmlTextPage =
      typeof content === "string" &&
      (text?.format === undefined || text.format === HTML_FORMAT) &&
      !text?.markdown;
    if (isMarkdownTextPage) {
      if (typeof text.markdown === "string") {
        queueMarkdown(text.markdown, (translated) => {
          if (page.text) page.text.markdown = translated;
        });
      }
      // Foundry stores the rendered HTML alongside the original Markdown.
      // Translate it too so the compendium copy renders correctly without
      // relying on an internal Markdown converter during document creation.
      if (typeof content === "string") {
        queueHtml(content, (translated) => {
          if (page.text) page.text.content = translated;
        });
      }
    } else if (!isHtmlTextPage) {
      if (typeof content === "string" && content.trim()) {
        skippedPage = true;
      }
    } else {
      queueHtml(content, (translated) => {
        if (page.text) page.text.content = translated;
      });
    }

    for (const path of options.systemHtmlFieldPaths?.[pageIndex] ?? []) {
      const systemContent = readPath(page.system, path);
      if (typeof systemContent !== "string" || !systemContent.trim()) continue;
      queueHtml(systemContent, (translated) => {
        if (!writePath(page.system, path, translated)) {
          throw new Error(`Nepodařilo se zapsat vlastní HTML pole Journalu: ${path.join(".")}`);
        }
      });
    }

    pageWork.push({
      pageIndex,
      sourcePageName,
      targets,
      structuredTargets,
      translatedPage,
      skippedPage,
    });
  }

  const pageBatchSize = journalPageBatchSize(options.settings.providerId);
  for (let start = 0; start < pageWork.length; start += pageBatchSize) {
    const batch = pageWork.slice(start, start + pageBatchSize);
    const targets: TranslationTarget[] = [];
    const structuredTargets: StructuredTranslationTarget[] = [];
    for (const work of batch) {
      options.onPageStart?.(work.sourcePageName);
      const offset = targets.length;
      targets.push(...work.targets);
      structuredTargets.push(...work.structuredTargets.map((target) => ({
        ...target,
        start: target.start + offset,
      })));
    }
    try {
      await translateTargets(options, targets, structuredTargets, recordQualityFallback);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      const first = batch[0];
      const last = batch.at(-1);
      const pageDescription = batch.length === 1
        ? `stránky ${(first?.pageIndex ?? 0) + 1}/${copy.pages.length} „${first?.sourcePageName ?? ""}“`
        : `stránek ${(first?.pageIndex ?? 0) + 1}–${(last?.pageIndex ?? 0) + 1}/${copy.pages.length} „${first?.sourcePageName ?? ""}“ až „${last?.sourcePageName ?? ""}“`;
      throw new Error(
        `Překlad ${pageDescription} selhal.${detail} Hotové stránky zůstávají v cache pro další pokus.`,
        { cause: error },
      );
    }

    for (const work of batch) {
      if (work.translatedPage) translatedTextPages += 1;
      else if (work.skippedPage) skippedTextPages += 1;
      completedSelectedPages += 1;
      options.onProgress?.({
        completedPages: completedSelectedPages,
        totalPages: selectedPages.length,
        pageIndex: work.pageIndex,
        pageName: work.sourcePageName,
        translatedText: work.translatedPage,
        skippedText: work.skippedPage && !work.translatedPage,
      });
    }
  }

  const sourceHash = await journalSourceHash(options.source);
  const glossaryHash = await glossaryFingerprint(options.glossary);
  copy.flags = {
    ...copy.flags,
    [MODULE_ID]: {
      ...copy.flags?.[MODULE_ID],
      translation: {
        schemaVersion: TRANSLATION_SCHEMA_VERSION,
        engineRevision: TRANSLATION_ENGINE_REVISION,
        sourceUuid: options.sourceUuid,
        sourceHash,
        providerId: options.settings.providerId,
        sourceLanguage: options.settings.sourceLanguage,
        targetLanguage: options.settings.targetLanguage,
        translatedAt: new Date().toISOString(),
        translatedTextPages,
        skippedTextPages,
        fallbackTextSegments,
        partial: Boolean(selectedPageIds) && selectedPages.length < copy.pages.length,
        processedPageIds: selectedPages
          .map((page) => page._id)
          .filter((id): id is string => Boolean(id)),
        glossaryFingerprint: glossaryHash,
      },
    },
  };

  return { data: copy, translatedTextPages, skippedTextPages, fallbackTextSegments };
}
