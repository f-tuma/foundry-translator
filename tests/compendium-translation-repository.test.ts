import { afterEach, describe, expect, it, vi } from "vitest";

import { MODULE_ID } from "../src/constants";
import {
  CompendiumJournalTranslationRepository,
  TRANSLATIONS_PACK_ID,
} from "../src/translation/compendium-translation-repository";
import type { JournalData } from "../src/translation/journal";
import { TRANSLATION_ENGINE_REVISION } from "../src/translation/journal";

function translatedData(): JournalData {
  return {
    name: "Pozvání [CS]",
    pages: [],
    flags: {
      [MODULE_ID]: {
        translation: {
          schemaVersion: 1,
          engineRevision: TRANSLATION_ENGINE_REVISION,
          sourceUuid: "JournalEntry.source",
          sourceHash: "hash",
          providerId: "chrome-local",
          sourceLanguage: "en",
          targetLanguage: "cs",
          translatedAt: "2026-07-13T18:00:00.000Z",
          translatedTextPages: 2,
          skippedTextPages: 0,
        },
      },
    },
  };
}

describe("compendium Journal translation repository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates once and updates the same source-language translation", async () => {
    const data = translatedData();
    const storedDocument = {
      id: "translation-id",
      name: data.name,
      uuid: "Compendium.world.foundry-translate-translations.JournalEntry.translation-id",
      flags: data.flags,
      toObject: () => data,
    };
    const createDocuments = vi.fn().mockResolvedValue([storedDocument]);
    const updateDocuments = vi.fn().mockResolvedValue([storedDocument]);
    const getDocument = vi.fn().mockResolvedValue(storedDocument);
    const pack = {
      collection: TRANSLATIONS_PACK_ID,
      locked: false,
      folder: { id: "folder", name: "Foundry Translate", type: "Compendium" },
      getIndex: vi.fn().mockResolvedValue(new Map()),
      getDocument,
      setFolder: vi.fn(),
    };
    vi.stubGlobal("game", {
      user: { isGM: true },
      packs: new Map([[TRANSLATIONS_PACK_ID, pack]]),
      folders: { contents: [pack.folder] },
    });
    vi.stubGlobal("foundry", {
      documents: {
        JournalEntry: { implementation: { createDocuments, updateDocuments } },
      },
    });

    const repository = new CompendiumJournalTranslationRepository();
    await expect(repository.save(data)).resolves.toBe(storedDocument);
    await expect(repository.save(data)).resolves.toBe(storedDocument);
    await expect(repository.find("JournalEntry.source", "cs")).resolves.toBe(storedDocument);

    expect(createDocuments).toHaveBeenCalledTimes(1);
    expect(updateDocuments).toHaveBeenCalledTimes(1);
    expect(updateDocuments).toHaveBeenCalledWith(
      [{ ...data, _id: "translation-id" }],
      { pack: TRANSLATIONS_PACK_ID, foundryTranslateGenerated: true },
    );
  });

  it("updates the same compendium document when a legacy translation is rebuilt", async () => {
    const data = translatedData();
    const legacyData = structuredClone(data);
    const legacyFlag = legacyData.flags?.[MODULE_ID]?.translation as
      | Record<string, unknown>
      | undefined;
    if (legacyFlag) delete legacyFlag.engineRevision;
    const legacyIndexEntry = {
      _id: "legacy-translation-id",
      flags: legacyData.flags,
    };
    const storedDocument = {
      id: legacyIndexEntry._id,
      name: data.name,
      uuid: `Compendium.${TRANSLATIONS_PACK_ID}.JournalEntry.${legacyIndexEntry._id}`,
      flags: data.flags,
      toObject: () => data,
    };
    const createDocuments = vi.fn();
    const updateDocuments = vi.fn().mockResolvedValue([storedDocument]);
    const getDocument = vi.fn().mockResolvedValue(storedDocument);
    const pack = {
      collection: TRANSLATIONS_PACK_ID,
      locked: false,
      folder: { id: "folder", name: "Foundry Translate", type: "Compendium" },
      getIndex: vi.fn().mockResolvedValue(new Map([[legacyIndexEntry._id, legacyIndexEntry]])),
      getDocument,
      setFolder: vi.fn(),
    };
    vi.stubGlobal("game", {
      user: { isGM: true },
      packs: new Map([[TRANSLATIONS_PACK_ID, pack]]),
      folders: { contents: [pack.folder] },
    });
    vi.stubGlobal("foundry", {
      documents: {
        JournalEntry: { implementation: { createDocuments, updateDocuments } },
      },
    });

    const repository = new CompendiumJournalTranslationRepository();
    await expect(repository.save(data)).resolves.toBe(storedDocument);

    expect(createDocuments).not.toHaveBeenCalled();
    expect(updateDocuments).toHaveBeenCalledWith(
      [{ ...data, _id: legacyIndexEntry._id }],
      { pack: TRANSLATIONS_PACK_ID, foundryTranslateGenerated: true },
    );
  });
});
