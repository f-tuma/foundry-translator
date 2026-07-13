import { describe, expect, it } from "vitest";

import { MODULE_ID } from "../src/constants";
import {
  findStorageFolder,
  STORAGE_FOLDER_COLOR,
  STORAGE_FOLDER_NAME,
  storageFolderData,
} from "../src/storage/compendium-folder";

describe("Foundry Translate compendium folder", () => {
  it("creates a gray, alphabetically sorted Compendium folder", () => {
    expect(storageFolderData()).toEqual({
      name: STORAGE_FOLDER_NAME,
      type: "Compendium",
      color: STORAGE_FOLDER_COLOR,
      sorting: "a",
      flags: {
        [MODULE_ID]: {
          storageFolder: true,
        },
      },
    });
  });

  it("prefers a module-marked folder", () => {
    const named = { id: "named", name: STORAGE_FOLDER_NAME, type: "Compendium" };
    const marked = {
      id: "marked",
      name: "Renamed folder",
      type: "Compendium",
      flags: { [MODULE_ID]: { storageFolder: true } },
    };

    expect(findStorageFolder([named, marked])).toBe(marked);
  });

  it("reuses an existing Compendium folder with the same name", () => {
    const actorFolder = { id: "actor", name: STORAGE_FOLDER_NAME, type: "Actor" };
    const compendiumFolder = {
      id: "compendium",
      name: STORAGE_FOLDER_NAME,
      type: "Compendium",
    };

    expect(findStorageFolder([actorFolder, compendiumFolder])).toBe(compendiumFolder);
  });
});
