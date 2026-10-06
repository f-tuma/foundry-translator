import { afterEach, describe, expect, it, vi } from "vitest";

import { MODULE_ID } from "../src/constants";
import type { ItemData } from "../src/translation/item";
import { ITEM_TRANSLATION_ENGINE_REVISION } from "../src/translation/item";
import { captureTranslationWriteGuard } from "../src/translation/write-guard";
import {
  ITEM_TRANSLATIONS_PACK_ID,
  CompendiumItemTranslationRepository,
} from "../src/translation/compendium-item-translation-repository";

function data(): ItemData {
  return {
    name: "Emberbrand [CS]",
    type: "weapon",
    system: {},
    flags: {
      [MODULE_ID]: {
        itemTranslation: {
          schemaVersion: 1,
          engineRevision: ITEM_TRANSLATION_ENGINE_REVISION,
          sourceUuid: "Item.source",
          sourceHash: "hash",
          providerId: "chrome-local",
          sourceLanguage: "en",
          targetLanguage: "cs",
          translatedAt: "2026-07-14T00:00:00.000Z",
          translatedHtmlFields: 1,
          fallbackTextSegments: 0,
        },
      },
    },
  };
}

describe("compendium Item translation repository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates once and updates the same Item translation", async () => {
    const itemData = data();
    const stored = {
      id: "translated-item",
      uuid: "Compendium.world.foundry-translate-items.Item.translated-item",
      documentName: "Item",
      flags: itemData.flags,
      toObject: () => itemData,
    };
    const createDocuments = vi.fn().mockResolvedValue([stored]);
    const updateDocuments = vi.fn().mockResolvedValue([stored]);
    const pack = {
      collection: ITEM_TRANSLATIONS_PACK_ID,
      locked: false,
      folder: { id: "folder", name: "Foundry Translate", type: "Compendium" },
      getIndex: vi.fn().mockResolvedValue(new Map()),
      getDocument: vi.fn().mockResolvedValue(stored),
      setFolder: vi.fn(),
    };
    vi.stubGlobal("game", {
      user: { isGM: true },
      packs: new Map([[ITEM_TRANSLATIONS_PACK_ID, pack]]),
      folders: { contents: [pack.folder] },
    });
    vi.stubGlobal("foundry", {
      documents: { Item: { implementation: { createDocuments, updateDocuments } } },
    });

    const repository = new CompendiumItemTranslationRepository();
    await expect(repository.save(itemData)).resolves.toBe(stored);
    await expect(repository.save(itemData)).resolves.toBe(stored);
    await expect(repository.find("Item.source", "cs")).resolves.toBe(stored);
    expect(createDocuments).toHaveBeenCalledTimes(1);
    expect(updateDocuments).toHaveBeenCalledWith(
      [{ ...itemData, _id: "translated-item" }],
      { pack: ITEM_TRANSLATIONS_PACK_ID },
    );
  });

  function createOnlyFixture() {
    const itemData = data(), entries = new Map<string, any>();
    const stored = { id: "translated-item", flags: itemData.flags, toObject: () => itemData };
    const createDocuments = vi.fn().mockResolvedValue([stored]), updateDocuments = vi.fn().mockResolvedValue([stored]);
    const pack = {
      collection: ITEM_TRANSLATIONS_PACK_ID, locked: false,
      folder: { id: "folder", name: "Foundry Translate", type: "Compendium" },
      getIndex: vi.fn(async () => new Map(entries)), getDocument: vi.fn(async () => stored), setFolder: vi.fn(),
    };
    vi.stubGlobal("game", { user: { isGM: true }, packs: new Map([[ITEM_TRANSLATIONS_PACK_ID, pack]]),
      folders: { contents: [pack.folder] }, i18n: { localize: (key: string) => key } });
    vi.stubGlobal("foundry", { documents: { Item: { implementation: { createDocuments, updateDocuments } } } });
    return { itemData, stored, entries, pack, createDocuments, updateDocuments, repository: new CompendiumItemTranslationRepository() };
  }

  it.each(["valid", "malformed"])("rejects a newly reserved %s identity created only during the final callback", async kind => {
    const f = createOnlyFixture();
    const reserved = { _id: "manual", name: "Manual correction", flags: kind === "valid" ? f.itemData.flags : {
      [MODULE_ID]: { itemTranslation: { sourceUuid: "Item.source", targetLanguage: "cs", partial: true } },
    } };
    const beforeCreate = vi.fn(async () => {
      expect(f.pack.getIndex).toHaveBeenCalledTimes(1);
      await Promise.resolve(); f.entries.set(reserved._id, reserved);
    });
    await expect(f.repository.save(f.itemData, null, beforeCreate)).rejects.toThrow("OutputChanged");
    expect(beforeCreate).toHaveBeenCalledOnce(); expect(f.pack.getIndex).toHaveBeenCalledTimes(2);
    expect(f.createDocuments).not.toHaveBeenCalled(); expect(f.updateDocuments).not.toHaveBeenCalled();
    expect(f.entries.get("manual")).toBe(reserved);
  });

  it.each(["callback", "final-index"])("rechecks a pack locked during %s before create", async phase => {
    const f = createOnlyFixture();
    const beforeCreate = vi.fn(async () => { if (phase === "callback") f.pack.locked = true; });
    f.pack.getIndex.mockImplementation(async () => {
      if (phase === "final-index" && f.pack.getIndex.mock.calls.length === 2) f.pack.locked = true;
      return new Map(f.entries);
    });
    await expect(f.repository.save(f.itemData, null, beforeCreate)).rejects.toThrow("zamčené");
    expect(f.pack.getIndex).toHaveBeenCalledTimes(2);
    expect(f.createDocuments).not.toHaveBeenCalled(); expect(f.updateDocuments).not.toHaveBeenCalled();
  });

  it("creates with the refreshed index and reuses that index for subsequent lookup", async () => {
    const f = createOnlyFixture(), beforeCreate = vi.fn(async () => {});
    const beforeCommit = vi.fn(() => { expect(f.pack.getIndex).toHaveBeenCalledTimes(2); expect(f.createDocuments).not.toHaveBeenCalled(); });
    await expect(f.repository.save(f.itemData, null, beforeCreate, beforeCommit)).resolves.toBe(f.stored);
    await expect(f.repository.find("Item.source", "cs")).resolves.toBe(f.stored);
    expect(f.pack.getIndex).toHaveBeenCalledTimes(2); expect(beforeCreate).toHaveBeenCalledOnce();
    expect(beforeCommit).toHaveBeenCalledOnce();
    expect(f.createDocuments).toHaveBeenCalledExactlyOnceWith([f.itemData], { pack: ITEM_TRANSLATIONS_PACK_ID, keepId: false });
    expect(f.updateDocuments).not.toHaveBeenCalled();
  });

  it("also refreshes a create-only decision when no final callback was supplied", async () => {
    const f = createOnlyFixture();
    f.pack.getIndex.mockImplementation(async () => {
      if (f.pack.getIndex.mock.calls.length === 2) f.entries.set("manual", { _id: "manual", flags: f.itemData.flags });
      return new Map(f.entries);
    });
    await expect(f.repository.save(f.itemData, null)).rejects.toThrow("OutputChanged");
    expect(f.createDocuments).not.toHaveBeenCalled(); expect(f.updateDocuments).not.toHaveBeenCalled();
  });

  it("keeps guarded updates on the original path without invoking a creation callback or extra index read", async () => {
    const f = createOnlyFixture(); f.entries.set(f.stored.id, { _id: f.stored.id, flags: f.itemData.flags });
    const guard = await captureTranslationWriteGuard(f.stored), beforeCreate = vi.fn(async () => { throw new Error("Must not create"); });
    const beforeCommit = vi.fn(() => { throw new Error("Must not commit creation"); });
    await expect(f.repository.save(f.itemData, guard, beforeCreate, beforeCommit)).resolves.toBe(f.stored);
    expect(f.pack.getIndex).toHaveBeenCalledOnce(); expect(beforeCreate).not.toHaveBeenCalled();
    expect(beforeCommit).not.toHaveBeenCalled();
    expect(f.createDocuments).not.toHaveBeenCalled();
    expect(f.updateDocuments).toHaveBeenCalledExactlyOnceWith([{ ...f.itemData, _id: f.stored.id }], { pack: ITEM_TRANSLATIONS_PACK_ID });
  });
  it("lets the synchronous final proof reject drift during the refreshed index read before any create", async () => {
    const f = createOnlyFixture(); let unchanged = true;
    f.pack.getIndex.mockImplementation(async () => {
      if (f.pack.getIndex.mock.calls.length === 2) unchanged = false;
      return new Map(f.entries);
    });
    const beforeCreate = vi.fn(async () => { expect(unchanged).toBe(true); });
    const beforeCommit = vi.fn(() => { if (!unchanged) throw new Error("Captured source changed"); });
    await expect(f.repository.save(f.itemData, null, beforeCreate, beforeCommit)).rejects.toThrow("Captured source changed");
    expect(beforeCreate).toHaveBeenCalledOnce(); expect(beforeCommit).toHaveBeenCalledOnce();
    expect(f.createDocuments).not.toHaveBeenCalled(); expect(f.updateDocuments).not.toHaveBeenCalled();
  });
});
