import { afterEach, describe, expect, it, vi } from "vitest";

import { MODULE_ID } from "../src/constants";
import type { ItemData } from "../src/translation/item";
import { ITEM_TRANSLATION_ENGINE_REVISION } from "../src/translation/item";
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
});
