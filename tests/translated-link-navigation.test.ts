import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isTranslatableDocumentReference,
  openTranslatedReference,
  translatedEmbeddedUuid,
} from "../src/translation/translated-link-navigation";

afterEach(() => {
  vi.unstubAllGlobals();
});

function journalFlag() {
  return {
    "foundry-translate": {
      translation: {
        schemaVersion: 1,
        engineRevision: 8,
        sourceUuid: "JournalEntry.guide",
        sourceHash: "source",
        providerId: "openai-compatible",
        sourceLanguage: "en",
        targetLanguage: "cs",
        translatedAt: "2026-07-16T00:00:00.000Z",
        translatedTextPages: 1,
        skippedTextPages: 0,
        fallbackTextSegments: 0,
        partial: false,
      },
    },
  };
}

describe("translated link navigation", () => {
  it("intercepts only document types supported by translated navigation", () => {
    expect(isTranslatableDocumentReference("JournalEntry.guide")).toBe(true);
    expect(isTranslatableDocumentReference(
      "JournalEntry.guide.JournalEntryPage.intro",
    )).toBe(true);
    expect(isTranslatableDocumentReference("Actor.hero")).toBe(true);
    expect(isTranslatableDocumentReference("Item.sword")).toBe(true);
    expect(isTranslatableDocumentReference(
      "Compendium.ember.character.Item.sword",
    )).toBe(true);

    expect(isTranslatableDocumentReference("Folder.journals")).toBe(false);
    expect(isTranslatableDocumentReference("Scene.map")).toBe(false);
    expect(isTranslatableDocumentReference("Playlist.ambience")).toBe(false);
    expect(isTranslatableDocumentReference(
      "Compendium.world.foundry-translate-translations.JournalEntry.csGuide",
    )).toBe(false);
  });

  it("maps a source Journal and its embedded page to the translated root", () => {
    const translated = "Compendium.world.foundry-translate-translations.JournalEntry.csGuide";

    expect(translatedEmbeddedUuid("JournalEntry.guide", translated)).toBe(translated);
    expect(translatedEmbeddedUuid(
      "JournalEntry.guide.JournalEntryPage.intro",
      translated,
    )).toBe(`${translated}.JournalEntryPage.intro`);
  });

  it("maps compendium and embedded Actor references without changing their suffix", () => {
    const translated = "Compendium.world.foundry-translate-actors.Actor.csHero";
    expect(translatedEmbeddedUuid(
      "Compendium.ember.actors.Actor.hero.Item.sword",
      translated,
    )).toBe(`${translated}.Item.sword`);
  });

  it("opens a translated embedded page when the translation pack contains its root", async () => {
    const translatedRootUuid =
      "Compendium.world.foundry-translate-translations.JournalEntry.csGuide";
    const render = vi.fn();
    const translatedRoot = { id: "csGuide", uuid: translatedRootUuid, sheet: { render } };
    const translatedPage = {
      id: "intro",
      uuid: `${translatedRootUuid}.JournalEntryPage.intro`,
      documentName: "JournalEntryPage",
      parent: translatedRoot,
      sheet: { render },
    };
    const pack = {
      getIndex: vi.fn(async () => new Map([
        ["csGuide", { _id: "csGuide", flags: journalFlag() }],
      ])),
      getDocument: vi.fn(async () => translatedRoot),
    };
    vi.stubGlobal("game", {
      settings: { get: vi.fn((_module: string, key: string) => key === "targetLanguage" ? "cs" : true) },
      packs: new Map([["world.foundry-translate-translations", pack]]),
    });
    vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) =>
      uuid === translatedPage.uuid ? translatedPage : null));

    await expect(openTranslatedReference(
      "JournalEntry.guide.JournalEntryPage.intro",
    )).resolves.toBe(true);
    expect(render).toHaveBeenCalledWith(true, undefined);
  });

  it("opens the translated Journal root when an old embedded page ID no longer exists", async () => {
    const render = vi.fn();
    const translatedRoot = {
      id: "csGuide",
      uuid: "Compendium.world.foundry-translate-translations.JournalEntry.csGuide",
      sheet: { render },
    };
    const pack = {
      getIndex: vi.fn(async () => new Map([
        ["csGuide", { _id: "csGuide", flags: journalFlag() }],
      ])),
      getDocument: vi.fn(async () => translatedRoot),
    };
    vi.stubGlobal("game", {
      settings: { get: vi.fn((_module: string, key: string) => key === "targetLanguage" ? "cs" : true) },
      packs: new Map([["world.foundry-translate-translations", pack]]),
    });
    vi.stubGlobal("fromUuid", vi.fn(async () => null));

    await expect(openTranslatedReference(
      "JournalEntry.guide.JournalEntryPage.removed",
    )).resolves.toBe(true);
    expect(render).toHaveBeenCalledWith(true, { pageId: "removed" });
  });
});
