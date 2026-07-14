import { MODULE_ID, MODULE_TITLE } from "../constants";
import { organizeCompendiumPack } from "../storage/compendium-folder";
import { readActorTranslationFlag, type ActorData, type ActorTranslationFlag } from "./actor";

export const ACTOR_TRANSLATIONS_PACK_NAME = "foundry-translate-actors" as const;
export const ACTOR_TRANSLATIONS_PACK_ID = `world.${ACTOR_TRANSLATIONS_PACK_NAME}` as const;
export const ACTOR_TRANSLATIONS_PACK_LABEL = `${MODULE_TITLE} — Translated Actors` as const;
export const ACTOR_TRANSLATION_FLAG_PATH = `flags.${MODULE_ID}.actorTranslation` as const;

function translationKey(sourceUuid: string, targetLanguage: string): string {
  return `${sourceUuid}\u0000${targetLanguage}`;
}

function indexFlag(entry: FoundryCompendiumIndexEntry): ActorTranslationFlag | null {
  return readActorTranslationFlag(entry.flags);
}

async function ensurePack(): Promise<FoundryCompendiumCollection> {
  const existing = game.packs.get(ACTOR_TRANSLATIONS_PACK_ID);
  if (existing) {
    await organizeCompendiumPack(existing);
    return existing;
  }
  if (!game.user?.isGM) throw new Error("Úložiště přeložených Actorů může vytvořit pouze Game Master.");
  const created = await foundry.documents.collections.CompendiumCollection.createCompendium({
    label: ACTOR_TRANSLATIONS_PACK_LABEL,
    name: ACTOR_TRANSLATIONS_PACK_NAME,
    type: "Actor",
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

export class CompendiumActorTranslationRepository {
  #pack?: Promise<FoundryCompendiumCollection>;
  #index?: Promise<Map<string, string>>;

  async find(sourceUuid: string, targetLanguage: string): Promise<FoundryActorDocument | null> {
    const pack = await this.#getPack();
    const index = await this.#getIndex(pack);
    const id = index.get(translationKey(sourceUuid, targetLanguage));
    return id ? (await pack.getDocument(id) as FoundryActorDocument | undefined) ?? null : null;
  }

  async save(data: ActorData): Promise<FoundryActorDocument> {
    const flag = readActorTranslationFlag(data.flags);
    if (!flag) throw new Error("Přeložený Actor nemá platná metadata.");
    const pack = await this.#getPack();
    if (pack.locked) throw new Error("Compendium s přeloženými Actory je zamčené.");
    const index = await this.#getIndex(pack);
    const key = translationKey(flag.sourceUuid, flag.targetLanguage);
    const existingId = index.get(key);
    if (existingId) {
      await foundry.documents.Actor.implementation.updateDocuments(
        [{ ...data, _id: existingId }],
        { pack: pack.collection },
      );
      const updated = await pack.getDocument(existingId) as FoundryActorDocument | undefined;
      if (!updated) throw new Error("Aktualizovaný překlad Actoru se nepodařilo načíst.");
      return updated;
    }
    const [created] = await foundry.documents.Actor.implementation.createDocuments(
      [data],
      { pack: pack.collection, keepId: false },
    );
    if (!created?.id) throw new Error("Přeložený Actor se nepodařilo uložit do compendia.");
    index.set(key, created.id);
    return created;
  }

  async #getPack(): Promise<FoundryCompendiumCollection> {
    this.#pack ??= ensurePack();
    return this.#pack;
  }

  async #getIndex(pack: FoundryCompendiumCollection): Promise<Map<string, string>> {
    this.#index ??= pack.getIndex({ fields: [ACTOR_TRANSLATION_FLAG_PATH] }).then((entries) => {
      const index = new Map<string, string>();
      for (const entry of entries.values()) {
        const flag = indexFlag(entry);
        if (flag) index.set(translationKey(flag.sourceUuid, flag.targetLanguage), entry._id);
      }
      return index;
    });
    return this.#index;
  }
}
