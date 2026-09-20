import { MODULE_ID, MODULE_TITLE } from "../constants";
import { organizeCompendiumPack } from "../storage/compendium-folder";
import { GLOSSARY_SCHEMA_VERSION, isGlossaryCategory, type GlossaryDocumentFlag, type GlossaryEntry } from "./types";
import { planGlossarySync } from "./sync";
import { validateGlossary } from "./protection";
import { discoverWorldGlossary } from "./discovery";

export const GLOSSARY_PACK_NAME = "foundry-translate-glossary" as const;
export const GLOSSARY_PACK_ID = `world.${GLOSSARY_PACK_NAME}` as const;
export const GLOSSARY_PACK_LABEL = `${MODULE_TITLE} — Glossary` as const;
export const GLOSSARY_FLAG_PATH = `flags.${MODULE_ID}.glossary` as const;

export interface GlossarySyncResult {
  created: number;
  updated: number;
  unchanged: number;
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
    !isGlossaryCategory(flag.category) ||
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
    ...(typeof flag.enabled === "boolean" ? { enabled: flag.enabled } : {}),
    ...(typeof flag.customized === "boolean" ? { customized: flag.customized } : {}),
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
    ...(entry.enabled !== undefined ? { enabled: entry.enabled } : {}),
    ...(entry.customized !== undefined ? { customized: entry.customized } : {}),
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

let preparingGlossary: Promise<GlossaryEntry[]> | undefined;

export class GlossaryCompendiumRepository {
  async loadExisting(): Promise<GlossaryEntry[]> {
    const pack = game.packs.get(GLOSSARY_PACK_ID);
    return pack ? loadFromPack(pack) : [];
  }
  async prepareForTranslation(): Promise<GlossaryEntry[]> {
    preparingGlossary ??= (async () => {
      await this.sync(discoverWorldGlossary());
      return this.load();
    })().finally(() => { preparingGlossary = undefined; });
    return preparingGlossary;
  }
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

    const stored = await loadFromPack(pack);
    const plan = planGlossarySync(stored, discovered);
    validateGlossary([...stored.filter((entry) => !plan.update.some((updated) => updated.id === entry.id)), ...plan.create, ...plan.update]);
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

  /** Overwrites the stored entry, e.g. with a user-supplied custom translation. */
  async saveEntry(entry: GlossaryEntry): Promise<void> {
    return this.saveEntries([entry]);
  }

  async saveEntries(entries: readonly GlossaryEntry[]): Promise<void> {
    if (!game.user?.isGM) {
      throw new Error("Slovník může měnit pouze Game Master.");
    }
    const pack = await ensureGlossaryPack();
    if (pack.locked) {
      throw new Error("Compendium se slovníkem je zamčené. Nejdřív jej ve Foundry odemkněte.");
    }
    const existing = await loadFromPack(pack);
    validateGlossary([...existing.filter((stored) => !entries.some((entry) => entry.id === stored.id)), ...entries]);
    const updates = entries.filter((entry) => entry.id);
    const creates = entries.filter((entry) => !entry.id);
    if (updates.length) {
      await foundry.documents.JournalEntry.implementation.updateDocuments(
        updates.map(toDocumentData),
        { pack: pack.collection },
      );
    }
    if (creates.length) {
      await foundry.documents.JournalEntry.implementation.createDocuments(
        creates.map(toDocumentData),
        { pack: pack.collection },
      );
    }
  }
}
