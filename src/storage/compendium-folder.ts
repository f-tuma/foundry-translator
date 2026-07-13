import { MODULE_ID, MODULE_TITLE } from "../constants";

export const STORAGE_FOLDER_NAME = MODULE_TITLE;
export const STORAGE_FOLDER_COLOR = "#6b7280";
export const STORAGE_FOLDER_TYPE = "Compendium" as const;
export const STORAGE_FOLDER_FLAG = "storageFolder" as const;

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
