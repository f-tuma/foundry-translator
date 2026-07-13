import { MODULE_ID, MODULE_TITLE } from "../constants";
import { organizeCompendiumPack } from "../storage/compendium-folder";
import { GLOSSARY_SCHEMA_VERSION, type GlossaryDocumentFlag, type GlossaryEntry } from "./types";
import { planGlossarySync } from "./sync";

export const GLOSSARY_PACK_NAME = "foundry-translate-glossary" as const;
export const GLOSSARY_PACK_ID = `world.${GLOSSARY_PACK_NAME}` as const;
export const GLOSSARY_PACK_LABEL = `${MODULE_TITLE} — Glossary` as const;
export const GLOSSARY_FLAG_PATH = `flags.${MODULE_ID}.glossary` as const;

export interface GlossarySyncResult {
  created: number;
  updated: number;
  unchanged: number;
}

function isCategory(value: unknown): value is GlossaryEntry["category"] {
  return value === "character" || value === "location" || value === "term";
}

function readFlag(indexEntry: FoundryCompendiumIndexEntry): GlossaryEntry | null {
  const namespace = indexEntry.flags?.[MODULE_ID];
  const value = namespace?.glossary;
  if (!value || typeof value !== "object") return null;

  const flag = value as Partial<GlossaryDocumentFlag>;
  if (
    flag.schemaVersion !== GLOSSARY_SCHEMA_VERSION ||
    typeof flag.source !== "string" ||
    typeof flag.replacement !== "string" ||
    !isCategory(flag.category) ||
    !Array.isArray(flag.aliases) ||
    !flag.aliases.every((alias) => typeof alias === "string")
  ) {
    return null;
  }

  return {
    id: indexEntry._id,
    source: flag.source,
    replacement: flag.replacement,
    category: flag.category,
    aliases: flag.aliases,
    ...(typeof flag.sourceUuid === "string" ? { sourceUuid: flag.sourceUuid } : {}),
  };
}

function toFlag(entry: GlossaryEntry): GlossaryDocumentFlag {
  return {
    schemaVersion: GLOSSARY_SCHEMA_VERSION,
    source: entry.source,
    replacement: entry.replacement,
    category: entry.category,
    aliases: entry.aliases,
    ...(entry.sourceUuid ? { sourceUuid: entry.sourceUuid } : {}),
  };
}

function toDocumentData(entry: GlossaryEntry): FoundryJournalEntryData {
  return {
    ...(entry.id ? { _id: entry.id } : {}),
    name: entry.source,
    flags: {
      [MODULE_ID]: {
        glossary: toFlag(entry),
      },
    },
  };
}

async function ensureGlossaryPack(): Promise<FoundryCompendiumCollection> {
  const existing = game.packs.get(GLOSSARY_PACK_ID);
  if (existing) {
    await organizeCompendiumPack(existing);
    return existing;
  }

  if (!game.user?.isGM) {
    throw new Error("Slovník ještě neexistuje a vytvořit jej může pouze Game Master.");
  }

  const created = await foundry.documents.collections.CompendiumCollection.createCompendium({
    label: GLOSSARY_PACK_LABEL,
    name: GLOSSARY_PACK_NAME,
    type: "JournalEntry",
    package: "world",
  });
  await organizeCompendiumPack(created);
  return created;
}

async function loadFromPack(pack: FoundryCompendiumCollection): Promise<GlossaryEntry[]> {
  const index = await pack.getIndex({ fields: [GLOSSARY_FLAG_PATH] });
  return [...index.values()].map(readFlag).filter((entry): entry is GlossaryEntry => !!entry);
}

export class GlossaryCompendiumRepository {
  async getPack(): Promise<FoundryCompendiumCollection> {
    return ensureGlossaryPack();
  }

  async load(): Promise<GlossaryEntry[]> {
    const pack = await ensureGlossaryPack();
    return loadFromPack(pack);
  }

  async sync(discovered: Iterable<GlossaryEntry>): Promise<GlossarySyncResult> {
    if (!game.user?.isGM) {
      throw new Error("Slovník může měnit pouze Game Master.");
    }

    const pack = await ensureGlossaryPack();
    if (pack.locked) {
      throw new Error("Compendium se slovníkem je zamčené. Nejdřív jej ve Foundry odemkněte.");
    }

    const plan = planGlossarySync(await loadFromPack(pack), discovered);
    if (plan.create.length) {
      await foundry.documents.JournalEntry.implementation.createDocuments(
        plan.create.map(toDocumentData),
        { pack: pack.collection },
      );
    }
    if (plan.update.length) {
      await foundry.documents.JournalEntry.implementation.updateDocuments(
        plan.update.map(toDocumentData),
        { pack: pack.collection },
      );
    }

    return {
      created: plan.create.length,
      updated: plan.update.length,
      unchanged: plan.unchanged.length,
    };
  }
}
