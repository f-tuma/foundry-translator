import { MODULE_ID } from "../constants";
import type { GlossaryEntry } from "../glossary/types";
import type { TranslationProvider } from "../providers/types";
import type { ProviderId } from "../settings/settings";
import type { TranslationCache } from "./cache";
import { sha256 } from "./hash";
import { planHtmlTranslation } from "./html";
import { readPath, writePath, type HtmlFieldPath } from "./system-html-fields";
import { translateUnits } from "./unit-translator";

export const TRANSLATION_SCHEMA_VERSION = 1;
const HTML_FORMAT = 1;

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
  onProgress?: (progress: JournalTranslationProgress) => void;
}

export interface JournalTranslationProgress {
  completedPages: number;
  totalPages: number;
  pageIndex: number;
  pageName: string;
  translatedText: boolean;
  skippedText: boolean;
}

export interface TranslatedJournal {
  data: JournalData;
  translatedTextPages: number;
  skippedTextPages: number;
}

export interface JournalTranslationFlag {
  schemaVersion: typeof TRANSLATION_SCHEMA_VERSION;
  sourceUuid: string;
  sourceHash: string;
  providerId: ProviderId;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translatedTextPages: number;
  skippedTextPages: number;
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
    (flag.providerId !== "chrome-local" && flag.providerId !== "google-cloud-basic") ||
    typeof flag.sourceLanguage !== "string" ||
    typeof flag.targetLanguage !== "string" ||
    typeof flag.translatedAt !== "string" ||
    typeof flag.translatedTextPages !== "number" ||
    typeof flag.skippedTextPages !== "number"
  ) {
    return null;
  }
  return flag as JournalTranslationFlag;
}

interface TranslationTarget {
  segments: readonly string[];
  translatedSegments?: readonly string[];
  apply(segments: readonly string[]): void;
}

interface HtmlTranslationTarget {
  start: number;
  length: number;
  apply(units: readonly (readonly string[])[]): void;
}

async function translateTargets(
  options: TranslateJournalOptions,
  targets: TranslationTarget[],
  htmlTargets: readonly HtmlTranslationTarget[],
): Promise<void> {
  const translatedUnits = await translateUnits({
    units: targets.map(({ segments }) => segments),
    glossary: options.glossary,
    provider: options.provider,
    settings: options.settings,
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.nonceFactory ? { nonceFactory: options.nonceFactory } : {}),
  });

  targets.forEach((target, index) => {
    const translatedSegments = translatedUnits[index] ?? [];
    if (translatedSegments.some((segment) => /__FT[NG]_/iu.test(segment))) {
      throw new Error("Překlad obsahuje neobnovený ochranný token.");
    }
    target.translatedSegments = translatedSegments;
    target.apply(translatedSegments);
  });
  for (const target of htmlTargets) {
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

export async function translateJournalData(
  options: TranslateJournalOptions,
): Promise<TranslatedJournal> {
  const copy = structuredClone(options.source);
  delete copy._id;
  delete copy._stats;

  let translatedTextPages = 0;
  let skippedTextPages = 0;

  await translateTargets(options, [{
    segments: [copy.name],
    apply: ([translatedName]) => {
      copy.name = `${translatedName ?? copy.name} [${options.settings.targetLanguage.toUpperCase()}]`;
    },
  }], []);

  if (copy.categories?.length) {
    const categoryTargets = copy.categories.map<TranslationTarget>((category) => ({
      segments: [category.name],
      apply: ([translatedName]) => {
        category.name = translatedName ?? category.name;
      },
    }));
    try {
      await translateTargets(options, categoryTargets, []);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new Error(
        `Překlad skupin stránek deníku selhal.${detail} Hotové části zůstávají v cache pro další pokus.`,
        { cause: error },
      );
    }
  }

  for (const [pageIndex, page] of copy.pages.entries()) {
    const sourcePageName = page.name;
    delete page._stats;
    const targets: TranslationTarget[] = [];
    const htmlTargets: HtmlTranslationTarget[] = [];
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
      htmlTargets.push({
        start,
        length: plan.units.length,
        apply: (translated) => apply(plan.apply(translated)),
      });
      translatedPage = true;
    };

    const text = page.text;
    const content = text?.content;
    const isHtmlTextPage =
      typeof content === "string" &&
      (text?.format === undefined || text.format === HTML_FORMAT) &&
      !text?.markdown;
    if (!isHtmlTextPage) {
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

    try {
      await translateTargets(options, targets, htmlTargets);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new Error(
        `Překlad stránky ${pageIndex + 1}/${copy.pages.length} „${sourcePageName}“ selhal.${detail} Hotové stránky zůstávají v cache pro další pokus.`,
        { cause: error },
      );
    }

    if (translatedPage) translatedTextPages += 1;
    else if (skippedPage) skippedTextPages += 1;
    options.onProgress?.({
      completedPages: pageIndex + 1,
      totalPages: copy.pages.length,
      pageIndex,
      pageName: sourcePageName,
      translatedText: translatedPage,
      skippedText: skippedPage && !translatedPage,
    });
  }

  const sourceHash = await journalSourceHash(options.source);
  copy.flags = {
    ...copy.flags,
    [MODULE_ID]: {
      ...copy.flags?.[MODULE_ID],
      translation: {
        schemaVersion: TRANSLATION_SCHEMA_VERSION,
        sourceUuid: options.sourceUuid,
        sourceHash,
        providerId: options.settings.providerId,
        sourceLanguage: options.settings.sourceLanguage,
        targetLanguage: options.settings.targetLanguage,
        translatedAt: new Date().toISOString(),
        translatedTextPages,
        skippedTextPages,
      },
    },
  };

  return { data: copy, translatedTextPages, skippedTextPages };
}
