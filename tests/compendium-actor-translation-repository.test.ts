import { afterEach, describe, expect, it, vi } from "vitest";

import { MODULE_ID } from "../src/constants";
import type { ActorData } from "../src/translation/actor";
import { ACTOR_TRANSLATION_ENGINE_REVISION } from "../src/translation/actor";
import {
  ACTOR_TRANSLATIONS_PACK_ID,
  CompendiumActorTranslationRepository,
} from "../src/translation/compendium-actor-translation-repository";

function data(): ActorData {
  return {
    name: "Vinarith [CS]",
    type: "adversary",
    system: {},
    flags: {
      [MODULE_ID]: {
        actorTranslation: {
          schemaVersion: 1,
          engineRevision: ACTOR_TRANSLATION_ENGINE_REVISION,
          sourceUuid: "Actor.source",
          sourceHash: "hash",
          providerId: "chrome-local",
          sourceLanguage: "en",
          targetLanguage: "cs",
          translatedAt: "2026-07-14T00:00:00.000Z",
          translatedHtmlFields: 2,
          fallbackTextSegments: 0,
        },
      },
    },
  };
}

describe("compendium Actor translation repository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates once and updates the same Actor translation", async () => {
    const actorData = data();
    const stored = {
      id: "translated-actor",
      uuid: "Compendium.world.foundry-translate-actors.Actor.translated-actor",
      documentName: "Actor",
      flags: actorData.flags,
      toObject: () => actorData,
    };
    const createDocuments = vi.fn().mockResolvedValue([stored]);
    const updateDocuments = vi.fn().mockResolvedValue([stored]);
    const pack = {
      collection: ACTOR_TRANSLATIONS_PACK_ID,
      locked: false,
      folder: { id: "folder", name: "Foundry Translate", type: "Compendium" },
      getIndex: vi.fn().mockResolvedValue(new Map()),
      getDocument: vi.fn().mockResolvedValue(stored),
      setFolder: vi.fn(),
    };
    vi.stubGlobal("game", {
      user: { isGM: true },
      packs: new Map([[ACTOR_TRANSLATIONS_PACK_ID, pack]]),
      folders: { contents: [pack.folder] },
    });
    vi.stubGlobal("foundry", {
      documents: { Actor: { implementation: { createDocuments, updateDocuments } } },
    });

    const repository = new CompendiumActorTranslationRepository();
    await expect(repository.save(actorData)).resolves.toBe(stored);
    await expect(repository.save(actorData)).resolves.toBe(stored);
    await expect(repository.find("Actor.source", "cs")).resolves.toBe(stored);
    expect(createDocuments).toHaveBeenCalledTimes(1);
    expect(updateDocuments).toHaveBeenCalledWith(
      [{ ...actorData, _id: "translated-actor" }],
      { pack: ACTOR_TRANSLATIONS_PACK_ID },
    );
  });
});
