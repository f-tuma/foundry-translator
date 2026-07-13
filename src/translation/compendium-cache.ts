import { MODULE_ID, MODULE_TITLE } from "../constants";
import { organizeCompendiumPack } from "../storage/compendium-folder";
import type { TranslationCache, TranslationCacheEntry } from "./cache";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_FLAG = "translationCache";
const CACHE_FLAG_PATH = `flags.${MODULE_ID}.${CACHE_FLAG}`;

export const CACHE_PACK_NAME = "foundry-translate-cache" as const;
export const CACHE_PACK_ID = `world.${CACHE_PACK_NAME}` as const;
export const CACHE_PACK_LABEL = `${MODULE_TITLE} — Translation Cache` as const;

interface CacheFlag {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  key: string;
  translatedSegments: string[];
}

function readIndexKey(entry: FoundryCompendiumIndexEntry): string | null {
  const value = entry.flags?.[MODULE_ID]?.[CACHE_FLAG];
  if (!value || typeof value !== "object") return null;
  const flag = value as Partial<CacheFlag>;
  return flag.schemaVersion === CACHE_SCHEMA_VERSION && typeof flag.key === "string"
    ? flag.key
    : null;
}

function readDocumentFlag(document: FoundryJournalDocument): CacheFlag | null {
  const value = document.flags?.[MODULE_ID]?.[CACHE_FLAG];
  if (!value || typeof value !== "object") return null;
  const flag = value as Partial<CacheFlag>;
  if (
    flag.schemaVersion !== CACHE_SCHEMA_VERSION ||
    typeof flag.key !== "string" ||
    !Array.isArray(flag.translatedSegments) ||
    !flag.translatedSegments.every((segment) => typeof segment === "string")
  ) {
    return null;
  }
  return flag as CacheFlag;
}

function documentData(entry: TranslationCacheEntry): FoundryJournalEntryData {
  return {
    name: `Translation ${entry.key.slice(0, 16)}`,
    flags: {
      [MODULE_ID]: {
        [CACHE_FLAG]: {
          schemaVersion: CACHE_SCHEMA_VERSION,
          key: entry.key,
          translatedSegments: [...entry.translatedSegments],
        },
      },
    },
  };
}

async function ensureCachePack(): Promise<FoundryCompendiumCollection> {
  const existing = game.packs.get(CACHE_PACK_ID);
  if (existing) {
    await organizeCompendiumPack(existing);
    return existing;
  }
  if (!game.user?.isGM) {
    throw new Error("Překladovou cache může vytvořit pouze Game Master.");
  }
  const created = await foundry.documents.collections.CompendiumCollection.createCompendium({
    label: CACHE_PACK_LABEL,
    name: CACHE_PACK_NAME,
    type: "JournalEntry",
    package: "world",
  });
  await organizeCompendiumPack(created);
  return created;
}

export class CompendiumTranslationCache implements TranslationCache {
  #pack?: Promise<FoundryCompendiumCollection>;
  #index?: Promise<Map<string, string>>;

  async get(key: string): Promise<readonly string[] | null> {
    const pack = await this.#getPack();
    const index = await this.#getKeyIndex(pack);
    const id = index.get(key);
    if (!id) return null;

    const document = await pack.getDocument(id);
    if (!document) return null;
    const flag = readDocumentFlag(document);
    return flag?.key === key ? flag.translatedSegments : null;
  }

  async getMany(keys: readonly string[]): Promise<Map<string, readonly string[]>> {
    const pack = await this.#getPack();
    const index = await this.#getKeyIndex(pack);
    const uniqueKeys = [...new Set(keys)];
    const documents = await Promise.all(uniqueKeys.map(async (key) => {
      const id = index.get(key);
      return { key, document: id ? await pack.getDocument(id) : undefined };
    }));
    const values = new Map<string, readonly string[]>();
    for (const { key, document } of documents) {
      if (!document) continue;
      const flag = readDocumentFlag(document);
      if (flag?.key === key) values.set(key, flag.translatedSegments);
    }
    return values;
  }

  async set(key: string, translatedSegments: readonly string[]): Promise<void> {
    await this.setMany([{ key, translatedSegments }]);
  }

  async setMany(entries: readonly TranslationCacheEntry[]): Promise<void> {
    if (!entries.length) return;
    const pack = await this.#getPack();
    if (pack.locked) {
      throw new Error("Compendium s překladovou cache je zamčené.");
    }
    const index = await this.#getKeyIndex(pack);
    const missing = entries.filter(({ key }) => !index.has(key));
    if (!missing.length) return;

    const created = await foundry.documents.JournalEntry.implementation.createDocuments(
      missing.map(documentData),
      { pack: pack.collection },
    );
    created.forEach((document, createdIndex) => {
      const entry = missing[createdIndex];
      if (entry && document.id) index.set(entry.key, document.id);
    });
  }

  async #getPack(): Promise<FoundryCompendiumCollection> {
    this.#pack ??= ensureCachePack();
    return this.#pack;
  }

  async #getKeyIndex(pack: FoundryCompendiumCollection): Promise<Map<string, string>> {
    this.#index ??= pack.getIndex({ fields: [CACHE_FLAG_PATH] }).then((entries) => {
      const index = new Map<string, string>();
      for (const entry of entries.values()) {
        const key = readIndexKey(entry);
        if (key) index.set(key, entry._id);
      }
      return index;
    });
    return this.#index;
  }
}
