import { afterEach, describe, expect, it, vi } from "vitest";

import { MODULE_ID } from "../src/constants";
import {
  findStorageFolder,
  STORAGE_FOLDER_COLOR,
  STORAGE_FOLDER_NAME,
  storageFolderData,
  ensureStorageFolder,
  organizeCompendiumPack,
  organizeExistingStoragePacks,
} from "../src/storage/compendium-folder";

describe("Foundry Translate compendium folder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates just one folder when repositories initialize together", async () => {
    const folder = { id: "shared", ...storageFolderData() };
    const create = vi.fn(async () => folder);
    vi.stubGlobal("game", { user: { isGM: true }, folders: { contents: [] } });
    vi.stubGlobal("foundry", { documents: { Folder: { implementation: { create } } } });
    const folders = await Promise.all([ensureStorageFolder(), ensureStorageFolder(), ensureStorageFolder()]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(folders).toEqual([folder, folder, folder]);
  });

  it("serializes Foundry's shared configuration writes and repairs only module packs", async () => {
    const folder = { id: "shared", ...storageFolderData() };
    let configuration: Record<string, string> = {};
    const packs = ["world.foundry-translate-translations", "world.foundry-translate-items", "world.unrelated"].map((collection) => ({
      collection,
      get folder() { return configuration[collection] ? folder : null; },
      setFolder: vi.fn(async (target: FoundryFolder) => {
        const snapshot = { ...configuration, [collection]: target.id! };
        await Promise.resolve();
        configuration = snapshot;
      }),
    })) as unknown as FoundryCompendiumCollection[];
    vi.stubGlobal("game", { user: { isGM: true }, folders: { contents: [folder] }, packs: new Map(packs.map((pack) => [pack.collection, pack])) });
    await Promise.all(packs.slice(0, 2).map(organizeCompendiumPack));
    expect(configuration).toEqual({ "world.foundry-translate-translations": "shared", "world.foundry-translate-items": "shared" });
    configuration = {};
    await organizeExistingStoragePacks();
    expect(configuration).toEqual({ "world.foundry-translate-translations": "shared", "world.foundry-translate-items": "shared" });
    expect(packs[2]!.setFolder).not.toHaveBeenCalled();
    await organizeExistingStoragePacks();
    expect(packs[0]!.setFolder).toHaveBeenCalledTimes(2);
  });

  it("does not let a failed move block subsequent packs", async () => {
    const folder = { id: "shared", ...storageFolderData() };
    vi.stubGlobal("game", { user: { isGM: true }, folders: { contents: [folder] } });
    const failed = { folder: null, setFolder: vi.fn().mockRejectedValue(new Error("Offline")) } as unknown as FoundryCompendiumCollection;
    const next = { folder: null, setFolder: vi.fn().mockResolvedValue(undefined) } as unknown as FoundryCompendiumCollection;
    await expect(organizeCompendiumPack(failed)).rejects.toThrow("Offline");
    await organizeCompendiumPack(next);
    expect(next.setFolder).toHaveBeenCalledWith(folder);
  });
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
