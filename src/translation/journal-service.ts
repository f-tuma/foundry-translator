import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { createTranslationProvider } from "../providers/factory";
import type { ChromeLocalProviderStatus } from "../providers/chrome-local";
import { getTranslatorSettings } from "../settings/settings";
import { CompendiumTranslationCache } from "./compendium-cache";
import { translateJournalData, type JournalData, type TranslatedJournal } from "./journal";

export interface JournalTranslationServiceOptions {
  onChromeStatus?: (status: ChromeLocalProviderStatus) => void;
}

export interface JournalTranslationResult extends TranslatedJournal {
  document: FoundryJournalWorldDocument;
}

function translationSample(source: JournalData): string {
  const contents = source.pages
    .map((page) => page.text?.content)
    .filter((content): content is string => typeof content === "string")
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${source.name}. ${contents}`.slice(0, 4000);
}

export class JournalTranslationService {
  readonly #onChromeStatus: ((status: ChromeLocalProviderStatus) => void) | undefined;

  constructor(options: JournalTranslationServiceOptions = {}) {
    this.#onChromeStatus = options.onChromeStatus;
  }

  async translate(sourceDocument: FoundryJournalWorldDocument): Promise<JournalTranslationResult> {
    if (!game.user?.isGM) throw new Error("Deník může překládat pouze Game Master.");

    const settings = getTranslatorSettings();
    const source = sourceDocument.toObject() as JournalData;
    const provider = createTranslationProvider(settings, {
      ...(this.#onChromeStatus ? { onChromeStatus: this.#onChromeStatus } : {}),
    });

    // Calling prepare before the first await preserves Chrome's user activation.
    const preparation = provider.prepare?.({
      texts: [translationSample(source)],
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      format: "text",
    });

    const [glossary] = await Promise.all([
      new GlossaryCompendiumRepository().load(),
      preparation ?? Promise.resolve(),
    ]);
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
    });
    const created = await foundry.documents.JournalEntry.implementation.create(translated.data);
    if (!created) throw new Error("Přeloženou kopii deníku se nepodařilo vytvořit.");

    return { ...translated, document: created };
  }
}
