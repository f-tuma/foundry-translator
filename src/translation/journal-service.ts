import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { logger } from "../logger";
import { createTranslationProvider } from "../providers/factory";
import type { ChromeLocalProviderStatus } from "../providers/chrome-local";
import { getTranslatorSettings } from "../settings/settings";
import { CompendiumTranslationCache } from "./compendium-cache";
import { CompendiumJournalTranslationRepository } from "./compendium-translation-repository";
import {
  canReuseJournalTranslation,
  journalSourceHash,
  readJournalTranslationFlag,
  translateJournalData,
  type JournalData,
  type JournalTranslationProgress,
  type TranslatedJournal,
} from "./journal";
import {
  discoverSystemHtmlFieldPaths,
  readPath,
  type HtmlFieldPath,
} from "./system-html-fields";

export interface JournalTranslationServiceOptions {
  onChromeStatus?: (status: ChromeLocalProviderStatus) => void;
  onProgress?: (progress: JournalTranslationProgress) => void;
}

export interface JournalTranslationResult extends TranslatedJournal {
  document: FoundryJournalDocument;
  reused: boolean;
}

interface RuntimePageSystem {
  constructor?: {
    schema?: {
      fields?: Record<string, unknown>;
    };
  };
}

interface RuntimeJournalPage {
  system?: RuntimePageSystem;
}

function systemHtmlFieldPaths(
  sourceDocument: FoundryJournalWorldDocument,
  source: JournalData,
): readonly (readonly HtmlFieldPath[])[] {
  const pages = (sourceDocument as FoundryJournalWorldDocument & {
    pages?: { contents?: RuntimeJournalPage[] };
  }).pages?.contents ?? [];
  return source.pages.map((page, index) => discoverSystemHtmlFieldPaths(
    pages[index]?.system?.constructor?.schema?.fields,
    page.system,
  ));
}

function translationSample(
  source: JournalData,
  htmlFieldPaths: readonly (readonly HtmlFieldPath[])[],
): string {
  const contents = source.pages
    .flatMap((page, index) => [
      page.text?.content,
      ...(htmlFieldPaths[index] ?? []).map((path) => readPath(page.system, path)),
    ])
    .filter((content): content is string => typeof content === "string")
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${source.name}. ${contents}`.slice(0, 4000);
}

export async function assertJournalSourceUnchanged(
  sourceDocument: FoundryJournalWorldDocument,
  expectedHash: string,
): Promise<void> {
  const currentSourceHash = await journalSourceHash(sourceDocument.toObject() as JournalData);
  if (currentSourceHash !== expectedHash) {
    throw new Error(
      "Zdrojový deník se během překladu změnil. Překlad nebyl uložen; spusťte jej znovu a hotové stránky se načtou z cache.",
    );
  }
}

export class JournalTranslationService {
  readonly #onChromeStatus: ((status: ChromeLocalProviderStatus) => void) | undefined;
  readonly #onProgress: ((progress: JournalTranslationProgress) => void) | undefined;

  constructor(options: JournalTranslationServiceOptions = {}) {
    this.#onChromeStatus = options.onChromeStatus;
    this.#onProgress = options.onProgress;
  }

  async translate(sourceDocument: FoundryJournalWorldDocument): Promise<JournalTranslationResult> {
    if (!game.user?.isGM) throw new Error("Deník může překládat pouze Game Master.");

    const settings = getTranslatorSettings();
    const source = sourceDocument.toObject() as JournalData;
    const htmlFieldPaths = systemHtmlFieldPaths(sourceDocument, source);
    const provider = createTranslationProvider(settings, {
      ...(this.#onChromeStatus ? { onChromeStatus: this.#onChromeStatus } : {}),
    });

    // Calling prepare before the first await preserves Chrome's user activation.
    const preparation = provider.prepare?.({
      texts: [translationSample(source, htmlFieldPaths)],
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      format: "text",
    });

    const translations = new CompendiumJournalTranslationRepository();
    const [glossary, sourceHash, existing] = await Promise.all([
      new GlossaryCompendiumRepository().load(),
      journalSourceHash(source),
      translations.find(sourceDocument.uuid, settings.targetLanguage),
      preparation ?? Promise.resolve(),
    ]);
    const existingFlag = existing
      ? readJournalTranslationFlag(existing.flags)
      : null;
    if (existing && existingFlag && canReuseJournalTranslation(existingFlag, sourceHash)) {
      return {
        data: existing.toObject() as JournalData,
        translatedTextPages: existingFlag.translatedTextPages,
        skippedTextPages: existingFlag.skippedTextPages,
        fallbackTextSegments: existingFlag.fallbackTextSegments,
        document: existing,
        reused: true,
      };
    }

    const translated = await translateJournalData({
      source,
      sourceUuid: sourceDocument.uuid,
      glossary,
      provider,
      settings: {
        providerId: settings.provider,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
      },
      cache: new CompendiumTranslationCache(),
      systemHtmlFieldPaths: htmlFieldPaths,
      onQualityFallback: (fallback) => {
        logger.warn("Translation quality fallback kept the original fragment.", fallback);
      },
      ...(this.#onProgress ? { onProgress: this.#onProgress } : {}),
    });
    await assertJournalSourceUnchanged(sourceDocument, sourceHash);
    const document = await translations.save(translated.data);

    return { ...translated, document, reused: false };
  }
}
