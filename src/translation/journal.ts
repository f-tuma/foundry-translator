import { MODULE_ID } from "../constants";
import type { GlossaryEntry } from "../glossary/types";
import type { TranslationProvider } from "../providers/types";
import type { ProviderId } from "../settings/settings";
import type { TranslationCache } from "./cache";
import { sha256 } from "./hash";
import { planHtmlTranslation } from "./html";
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
}

export interface JournalData extends Record<string, unknown> {
  _id?: string;
  _stats?: unknown;
  name: string;
  pages: JournalPageData[];
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

function sourceSnapshot(source: JournalData): string {
  return JSON.stringify({
    name: source.name,
    pages: source.pages.map((page) => ({
      id: page._id,
      name: page.name,
      type: page.type,
      text: page.text,
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

  const targets: TranslationTarget[] = [];
  const htmlTargets: HtmlTranslationTarget[] = [];
  let translatedTextPages = 0;
  let skippedTextPages = 0;

  targets.push({
    segments: [copy.name],
    apply: ([translatedName]) => {
      copy.name = `${translatedName ?? copy.name} [${options.settings.targetLanguage.toUpperCase()}]`;
    },
  });

  for (const page of copy.pages) {
    delete page._stats;
    targets.push({
      segments: [page.name],
      apply: ([translatedName]) => {
        page.name = translatedName ?? page.name;
      },
    });

    const text = page.text;
    const content = text?.content;
    const isHtmlTextPage =
      typeof content === "string" &&
      (text?.format === undefined || text.format === HTML_FORMAT) &&
      !text?.markdown;
    if (!isHtmlTextPage) {
      if (typeof content === "string" && content.trim()) {
        skippedTextPages += 1;
      }
      continue;
    }

    const plan = planHtmlTranslation(content, options.ownerDocument);
    if (!plan.units.length) continue;
    const start = targets.length;
    for (const segments of plan.units) {
      targets.push({ segments, apply: () => undefined });
    }
    htmlTargets.push({
      start,
      length: plan.units.length,
      apply: (translated) => {
        if (page.text) page.text.content = plan.apply(translated);
      },
    });
    translatedTextPages += 1;
  }

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
