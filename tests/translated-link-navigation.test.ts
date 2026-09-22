import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

import {
  isTranslatableDocumentReference,
  openTranslatedReference,
  openTranslationReference,
  linkedDocumentUuid,
  registerTranslatedLinkNavigation,
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
    expect(isTranslatableDocumentReference("Actor.hero.ActiveEffect.blessing")).toBe(false);
    expect(isTranslatableDocumentReference("Compendium.ember.items.Item.sword.ActiveEffect.magic")).toBe(false);
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
    const translatedRoot = { id: "csGuide", uuid: translatedRootUuid, flags: journalFlag(), sheet: { render } };
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
      uuid === translatedPage.uuid ? translatedPage : uuid === "JournalEntry.guide" ? { id: "guide", uuid } : uuid === "JournalEntry.guide.JournalEntryPage.intro" ? { id: "intro", uuid } : null));

    await expect(openTranslatedReference(
      "JournalEntry.guide.JournalEntryPage.intro",
    )).resolves.toBe(true);
    expect(render).toHaveBeenCalledWith({ force: true, pageId: "intro" });
    await Promise.all([openTranslationReference("JournalEntry.guide.JournalEntryPage.intro", {view: "translation"}), openTranslationReference("JournalEntry.guide.JournalEntryPage.intro", {view: "translation"})]);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("does not silently open a different page when an embedded page no longer exists", async () => {
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
    )).resolves.toBe(false);
    expect(render).not.toHaveBeenCalled();
  });
});

it("installs link navigation once and leaves gameplay controls alone", () => {
  const { document, HTMLElement, Element } = parseHTML('<html><body><a class="content-link" data-uuid="Actor.hero"><span>Hero</span></a><button data-action="attack" data-uuid="Actor.hero">Attack</button><div data-uuid="Actor.hero">Card</div><a class="content-link" data-action="custom" data-uuid="Actor.hero">Action</a></body></html>');
  vi.stubGlobal("document", document); vi.stubGlobal("Element", Element); vi.stubGlobal("HTMLElement", HTMLElement);
  const add = vi.spyOn(document, "addEventListener");
  registerTranslatedLinkNavigation(); registerTranslatedLinkNavigation();
  expect(add).toHaveBeenCalledTimes(1);
  expect(linkedDocumentUuid({ target: document.querySelector("span") } as unknown as MouseEvent)).toBe("Actor.hero");
  for (const node of document.querySelectorAll("button,div,a[data-action]")) expect(linkedDocumentUuid({ target: node } as unknown as MouseEvent)).toBeNull();
});
