import { MODULE_ID, MODULE_TITLE } from "../constants";

export const STORAGE_FOLDER_NAME = MODULE_TITLE;
export const STORAGE_FOLDER_COLOR = "#6b7280";
export const STORAGE_FOLDER_TYPE = "Compendium" as const;
export const STORAGE_FOLDER_FLAG = "storageFolder" as const;

const STORAGE_PACK_IDS = new Set([
  "world.foundry-translate-glossary",
  "world.foundry-translate-cache",
  "world.foundry-translate-translations",
  "world.foundry-translate-actors",
  "world.foundry-translate-items",
]);
let creatingFolder: Promise<FoundryFolder> | undefined;
let organizingPacks: Promise<void> = Promise.resolve();

export interface CompendiumFolderLike {
  id?: string | null;
  name?: string | null;
  type?: string | null;
  flags?: Record<string, Record<string, unknown>>;
}

function isModuleFolder(folder: CompendiumFolderLike): boolean {
  return folder.flags?.[MODULE_ID]?.[STORAGE_FOLDER_FLAG] === true;
}

export function findStorageFolder(
  folders: Iterable<CompendiumFolderLike>,
): CompendiumFolderLike | undefined {
  const compendiumFolders = [...folders].filter(
    (folder) => folder.type === STORAGE_FOLDER_TYPE,
  );

  return (
    compendiumFolders.find(isModuleFolder) ??
    compendiumFolders.find((folder) => folder.name === STORAGE_FOLDER_NAME)
  );
}

export function storageFolderData(): FoundryFolderData {
  return {
    name: STORAGE_FOLDER_NAME,
    type: STORAGE_FOLDER_TYPE,
    color: STORAGE_FOLDER_COLOR,
    sorting: "a",
    flags: {
      [MODULE_ID]: {
        [STORAGE_FOLDER_FLAG]: true,
      },
    },
  };
}

async function createStorageFolder(): Promise<FoundryFolder> {
  const folder = findStorageFolder(game.folders.contents) as FoundryFolder | undefined;
  if (folder) return folder;

  if (!game.user?.isGM) {
    throw new Error("Složku Foundry Translate může vytvořit pouze Game Master.");
  }

  const created = await foundry.documents.Folder.implementation.create(storageFolderData());
  if (!created || Array.isArray(created)) {
    throw new Error("Složku Foundry Translate se nepodařilo vytvořit.");
  }
  return created;
}

export async function ensureStorageFolder(): Promise<FoundryFolder> {
  creatingFolder ??= createStorageFolder().finally(() => { creatingFolder = undefined; });
  return creatingFolder;
}

export async function organizeCompendiumPack(
  pack: FoundryCompendiumCollection,
): Promise<void> {
  if (!game.user?.isGM) return;
  // Foundry setFolder rewrites the shared core.compendiumConfiguration object.
  // Parallel calls can each save an old snapshot, undoing another pack's move.
  const operation = organizingPacks.then(async () => {
    const folder = await ensureStorageFolder();
    if (pack.folder?.id !== folder.id) await pack.setFolder(folder);
  });
  organizingPacks = operation.catch(() => {});
  return operation;
}

/** Repair existing module packs without creating any packs or changing content. */
export async function organizeExistingStoragePacks(): Promise<void> {
  if (!game.user?.isGM) return;
  for (const pack of game.packs.values()) {
    if (STORAGE_PACK_IDS.has(pack.collection)) await organizeCompendiumPack(pack);
  }
}
