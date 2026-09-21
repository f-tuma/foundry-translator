import { MODULE_ID, MODULE_TITLE } from "../constants";
import { organizeCompendiumPack } from "../storage/compendium-folder";
import { GLOSSARY_SCHEMA_VERSION, isGlossaryCategory, isGlossaryMode, readNamingDecision, type GlossaryDocumentFlag, type GlossaryEntry } from "./types";
import { planGlossarySync } from "./sync";
import { validateGlossary } from "./protection";
import { discoverWorldGlossary } from "./discovery";
import { GlossarySyncCancelledError, type GlossaryProgress } from "./types";
import { glossaryEntryKey, entryFingerprint, validateSelectedImport, type GlossaryImportRow } from "./files";
import { glossaryLive } from "./live";

export const GLOSSARY_PACK_NAME = "foundry-translate-glossary" as const;
export const GLOSSARY_PACK_ID = `world.${GLOSSARY_PACK_NAME}` as const;
export const GLOSSARY_PACK_LABEL = `${MODULE_TITLE} — Glossary` as const;
export const GLOSSARY_FLAG_PATH = `flags.${MODULE_ID}.glossary` as const;

export interface GlossarySyncResult {
  created: number;
  updated: number;
  unchanged: number;
}

export interface GlossarySyncOptions {
  onProgress?: (progress: GlossaryProgress) => void;
  shouldCancel?: () => boolean;
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

  const naming = readNamingDecision(flag.naming);
  return {
    id: indexEntry._id,
    source: flag.source,
    replacement: flag.replacement,
    category: flag.category,
    aliases: flag.aliases,
    ...(naming ? { naming } : {}),
    ...(typeof flag.notes === "string" ? { notes: flag.notes } : {}),
    ...(typeof flag.enabled === "boolean" ? { enabled: flag.enabled } : {}),
    ...(isGlossaryMode(flag.mode) ? { mode: flag.mode } : {}),
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
    ...(entry.naming ? { naming: entry.naming } : {}),
    notes: entry.notes ?? "",
    ...(entry.enabled !== undefined ? { enabled: entry.enabled } : {}),
    ...(entry.mode ? { mode: entry.mode } : {}),
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
const preparationObservers = new Set<GlossarySyncOptions>();
let syncingGlossary: Promise<void> = Promise.resolve();
let writingGlossary: Promise<void> = Promise.resolve();
function writeGlossary<T>(operation: () => Promise<T>): Promise<T> {
  const result = writingGlossary.then(operation);
  writingGlossary = result.then(() => {}, () => {});
  return result;
}

export class GlossaryCompendiumRepository {
  async loadExisting(): Promise<GlossaryEntry[]> {
    const pack = game.packs.get(GLOSSARY_PACK_ID);
    return pack ? loadFromPack(pack) : [];
  }
  async prepareForTranslation(options: GlossarySyncOptions = {}): Promise<GlossaryEntry[]> {
    preparationObservers.add(options);
    try {
      preparingGlossary ??= (async () => {
        await this.sync(discoverWorldGlossary(), {
          onProgress: (progress) => preparationObservers.forEach((observer) => observer.onProgress?.(progress)),
          shouldCancel: () => [...preparationObservers].every((observer) => observer.shouldCancel?.() === true),
        });
        return this.load();
      })().finally(() => { preparingGlossary = undefined; });
      return await preparingGlossary;
    } finally { preparationObservers.delete(options); }
  }
  async getPack(): Promise<FoundryCompendiumCollection> {
    return ensureGlossaryPack();
  }

  async load(): Promise<GlossaryEntry[]> {
    const pack = await ensureGlossaryPack();
    return loadFromPack(pack);
  }

  async sync(discovered: Iterable<GlossaryEntry>, options: GlossarySyncOptions = {}): Promise<GlossarySyncResult> {
    const entries = [...discovered];
    const operation = syncingGlossary.then(async () => {
      glossaryLive.publish({ running: true, status: { state: "testing", message: game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Status.Syncing") } });
      try {
        const result = await this.#sync(entries, options);
        const summary = game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Status.Synced")
          .replace("{created}", String(result.created)).replace("{updated}", String(result.updated)).replace("{unchanged}", String(result.unchanged));
        glossaryLive.publish({ running: false, status: { state: "success", message: summary } });
        return result;
      } catch (error) {
        glossaryLive.publish({ running: false, status: {
          state: error instanceof GlossarySyncCancelledError ? "idle" : "error",
          message: error instanceof GlossarySyncCancelledError ? game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Status.Cancelled")
            : error instanceof Error ? error.message : game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Status.Error"),
        } });
        throw error;
      }
    });
    syncingGlossary = operation.then(() => {}, () => {});
    return operation;
  }

  async #sync(discovered: readonly GlossaryEntry[], options: GlossarySyncOptions): Promise<GlossarySyncResult> {
    if (options.shouldCancel?.()) throw new GlossarySyncCancelledError();
    if (!game.user?.isGM) {
      throw new Error("Slovník může měnit pouze Game Master.");
    }

    const pack = await ensureGlossaryPack();
    if (pack.locked) {
      throw new Error("Compendium se slovníkem je zamčené. Nejdřív jej ve Foundry odemkněte.");
    }

    const discoveredEntries = [...discovered];
    const plan = await writeGlossary(async () => {
      const stored = await loadFromPack(pack);
      if (options.shouldCancel?.()) throw new GlossarySyncCancelledError();
      const plan = planGlossarySync(stored, discoveredEntries);
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
      glossaryLive.publish({ entries: await loadFromPack(pack) });
      return plan;
    });

    const result: GlossarySyncResult = {
      created: plan.create.length,
      updated: plan.update.length,
      unchanged: plan.unchanged.length,
    };
    options.onProgress?.({ completed: discovered.length, total: discovered.length });
    return result;
  }

  /** Overwrites the stored entry, e.g. with a user-supplied custom translation. */
  async saveEntry(entry: GlossaryEntry): Promise<void> {
    return this.saveEntries([entry]);
  }

  async saveEntries(entries: readonly GlossaryEntry[]): Promise<void> {
    await this.#saveEntries(entries);
  }

  /** Recheck the preview inside the same write queue used by sync/manual edits. */
  async importEntries(rows: readonly GlossaryImportRow[]): Promise<void> {
    await this.#saveEntries(rows.map((row) => ({ ...row.after, customized: true })), rows);
  }

  async #saveEntries(proposed: readonly GlossaryEntry[], expected?: readonly GlossaryImportRow[]): Promise<GlossaryEntry[]> {
    return writeGlossary(async () => {
      if (!game.user?.isGM) {
        throw new Error("Slovník může měnit pouze Game Master.");
      }
      const pack = await ensureGlossaryPack();
      if (pack.locked) {
        throw new Error("Compendium se slovníkem je zamčené. Nejdřív jej ve Foundry odemkněte.");
      }
      const existing = await loadFromPack(pack);
      if (expected) {
        validateSelectedImport(existing, expected);
        for (const row of expected) {
          const current = existing.find((entry) => glossaryEntryKey(entry.source) === row.key);
          if (entryFingerprint(current) !== entryFingerprint(row.before)) {
            throw new Error(game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Files.Stale"));
          }
        }
      }
      const entries = [...proposed];
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
      glossaryLive.publish({ entries: await loadFromPack(pack) });
      return entries;
    });
  }
}
