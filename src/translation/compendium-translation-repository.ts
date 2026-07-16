import { MODULE_ID, MODULE_TITLE } from "../constants";
import { organizeCompendiumPack } from "../storage/compendium-folder";
import {
  readJournalTranslationFlag,
  type JournalData,
  type JournalTranslationFlag,
} from "./journal";

export const TRANSLATIONS_PACK_NAME = "foundry-translate-translations" as const;
export const TRANSLATIONS_PACK_ID = `world.${TRANSLATIONS_PACK_NAME}` as const;
export const TRANSLATIONS_PACK_LABEL = `${MODULE_TITLE} — Translations` as const;
export const TRANSLATION_FLAG_PATH = `flags.${MODULE_ID}.translation` as const;

function translationKey(sourceUuid: string, targetLanguage: string): string {
  return `${sourceUuid}\u0000${targetLanguage}`;
}

function indexTranslationFlag(entry: FoundryCompendiumIndexEntry): JournalTranslationFlag | null {
  return readJournalTranslationFlag(entry.flags);
}

async function ensureTranslationsPack(): Promise<FoundryCompendiumCollection> {
  const existing = game.packs.get(TRANSLATIONS_PACK_ID);
  if (existing) {
    await organizeCompendiumPack(existing);
    return existing;
  }
  if (!game.user?.isGM) {
    throw new Error("Úložiště překladů může vytvořit pouze Game Master.");
  }

  const created = await foundry.documents.collections.CompendiumCollection.createCompendium({
    label: TRANSLATIONS_PACK_LABEL,
    name: TRANSLATIONS_PACK_NAME,
    type: "JournalEntry",
    package: "world",
    ownership: {
      GAMEMASTER: "OWNER",
      ASSISTANT: "OWNER",
      TRUSTED: "OBSERVER",
      PLAYER: "OBSERVER",
    },
  });
  await organizeCompendiumPack(created);
  return created;
}

export class CompendiumJournalTranslationRepository {
  #pack?: Promise<FoundryCompendiumCollection>;
  #index?: Promise<Map<string, string>>;

  async find(
    sourceUuid: string,
    targetLanguage: string,
  ): Promise<FoundryJournalDocument | null> {
    const pack = await this.#getPack();
    const index = await this.#getTranslationIndex(pack);
    const id = index.get(translationKey(sourceUuid, targetLanguage));
    return id ? (await pack.getDocument(id)) ?? null : null;
  }

  async save(data: JournalData): Promise<FoundryJournalDocument> {
    const flag = readJournalTranslationFlag(data.flags);
    if (!flag) throw new Error("Přeložený deník nemá platná metadata.");
    const pack = await this.#getPack();
    if (pack.locked) throw new Error("Compendium s překlady je zamčené.");

    const index = await this.#getTranslationIndex(pack);
    const key = translationKey(flag.sourceUuid, flag.targetLanguage);
    const existingId = index.get(key);
    if (existingId) {
      await foundry.documents.JournalEntry.implementation.updateDocuments(
        [{ ...data, _id: existingId }],
        { pack: pack.collection, foundryTranslateGenerated: true },
      );
      const updated = await pack.getDocument(existingId);
      if (!updated) throw new Error("Aktualizovaný překlad se nepodařilo načíst.");
      return updated;
    }

    const [created] = await foundry.documents.JournalEntry.implementation.createDocuments(
      [data],
      { pack: pack.collection },
    );
    if (!created?.id) throw new Error("Překlad se nepodařilo uložit do compendia.");
    index.set(key, created.id);
    return created;
  }

  async #getPack(): Promise<FoundryCompendiumCollection> {
    this.#pack ??= ensureTranslationsPack();
    return this.#pack;
  }

  async #getTranslationIndex(
    pack: FoundryCompendiumCollection,
  ): Promise<Map<string, string>> {
    this.#index ??= pack.getIndex({ fields: [TRANSLATION_FLAG_PATH] }).then((entries) => {
      const index = new Map<string, string>();
      for (const entry of entries.values()) {
        const flag = indexTranslationFlag(entry);
        if (flag) index.set(translationKey(flag.sourceUuid, flag.targetLanguage), entry._id);
      }
      return index;
    });
    return this.#index;
  }
}
