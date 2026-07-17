import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addJournalTranslationHeaderButton,
  addJournalTranslationHeaderControl,
  addShowTranslationHeaderButton,
} from "../src/translation/journal-header-control";

function journal(id = "journal-id"): FoundryJournalWorldDocument {
  return {
    id,
    uuid: `JournalEntry.${id}`,
    name: "A Journal",
    toObject: () => ({}),
  };
}

describe("Journal header translation action", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds a direct button and a header control for a GM world journal", () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source = journal();
    const header = document.createElement("header");
    const controlsButton = document.createElement("button");
    header.append(controlsButton);
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", {
      user: { isGM: true },
      journal: { contents: [source] },
      i18n: { localize: () => "Přeložit tento deník" },
    });

    const application = {
      entry: source,
      window: { header, controls: controlsButton },
    };
    const controls: import("../src/translation/journal-header-control").ApplicationHeaderControl[] = [];
    addJournalTranslationHeaderControl(application, controls);
    addJournalTranslationHeaderButton(application);
    addJournalTranslationHeaderButton(application);

    expect(controls).toHaveLength(2);
    expect(controls[0]).toMatchObject({
      action: "foundry-translate-translate-journal",
      label: "FOUNDRY_TRANSLATE.JournalTranslation.Header.Action",
    });
    expect(controls[1]).toMatchObject({
      action: "foundry-translate-translate-page",
      label: "FOUNDRY_TRANSLATE.JournalTranslation.Header.ActionPage",
    });
    expect(header.querySelectorAll(".ft-journal-translate-header")).toHaveLength(1);
    expect(header.querySelectorAll(".ft-journal-translate-page-header")).toHaveLength(1);
    expect(header.firstElementChild?.textContent).toContain("Přeložit tento deník");
  });

  it("adds a switch-to-translation button only when a stored translation exists", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source = journal();
    const header = document.createElement("header");
    document.body.append(header);
    const controlsButton = document.createElement("button");
    header.append(controlsButton);
    vi.stubGlobal("document", document);
    const translationFlag = {
      schemaVersion: 1,
      engineRevision: 3,
      sourceUuid: source.uuid,
      sourceHash: "hash",
      providerId: "chrome-local",
      sourceLanguage: "en",
      targetLanguage: "cs",
      translatedAt: "2026-07-14T00:00:00.000Z",
      translatedTextPages: 1,
      skippedTextPages: 0,
      fallbackTextSegments: 0,
      partial: false,
    };
    const pack = {
      getIndex: vi.fn().mockResolvedValue(new Map([[
        "translated-id",
        { _id: "translated-id", flags: { "foundry-translate": { translation: translationFlag } } },
      ]])),
      getDocument: vi.fn(),
    };
    vi.stubGlobal("game", {
      user: { isGM: true },
      journal: { contents: [source] },
      i18n: { localize: (key: string) => key },
      packs: new Map([["world.foundry-translate-translations", pack]]),
      settings: { get: (_m: string, key: string) => (key === "targetLanguage" ? "cs" : "") },
    });

    const application = { entry: source, window: { header, controls: controlsButton } };
    await addShowTranslationHeaderButton(application);
    await addShowTranslationHeaderButton(application);
    expect(header.querySelectorAll(".ft-journal-show-translation")).toHaveLength(1);

    // A journal without a stored translation gets no button.
    const other = journal("other");
    const otherHeader = document.createElement("header");
    document.body.append(otherHeader);
    const otherControls = document.createElement("button");
    otherHeader.append(otherControls);
    (game.journal.contents as FoundryJournalWorldDocument[]).push(other);
    await addShowTranslationHeaderButton({
      entry: other,
      window: { header: otherHeader, controls: otherControls },
    });
    expect(otherHeader.querySelector(".ft-journal-show-translation")).toBeNull();
  });

  it("does not add translation actions for a player or a non-world journal", () => {
    const source = journal();
    vi.stubGlobal("game", {
      user: { isGM: false },
      journal: { contents: [source] },
      i18n: { localize: (key: string) => key },
    });
    const controls: import("../src/translation/journal-header-control").ApplicationHeaderControl[] = [];
    addJournalTranslationHeaderControl({ entry: source }, controls);
    expect(controls).toHaveLength(0);

    vi.stubGlobal("game", {
      user: { isGM: true },
      journal: { contents: [] },
      i18n: { localize: (key: string) => key },
    });
    addJournalTranslationHeaderControl({ entry: source }, controls);
    expect(controls).toHaveLength(0);
  });

  it("offers page translation and a return to the source from a stored translation", () => {
    const source = journal();
    const translated: FoundryJournalDocument = {
      id: "translated-id",
      uuid: "Compendium.world.foundry-translate-translations.JournalEntry.translated-id",
      name: "A Journal [CS]",
      flags: {
        "foundry-translate": {
          translation: {
            schemaVersion: 1,
            sourceUuid: source.uuid,
            sourceHash: "hash",
            providerId: "chrome-local",
            sourceLanguage: "en",
            targetLanguage: "cs",
            translatedAt: "2026-07-13T18:00:00.000Z",
            translatedTextPages: 1,
            skippedTextPages: 0,
          },
        },
      },
      toObject: () => ({}),
    };
    vi.stubGlobal("game", {
      user: { isGM: true },
      journal: { contents: [source] },
      i18n: { localize: (key: string) => key },
    });
    const controls: import("../src/translation/journal-header-control").ApplicationHeaderControl[] = [];

    addJournalTranslationHeaderControl({ entry: translated }, controls);

    expect(controls[0]).toMatchObject({
      action: "foundry-translate-show-original-journal",
      label: "FOUNDRY_TRANSLATE.JournalTranslation.Header.Original",
      icon: "fa-solid fa-arrow-left",
    });
    expect(controls[1]).toMatchObject({
      action: "foundry-translate-translate-page",
      label: "FOUNDRY_TRANSLATE.JournalTranslation.Header.ActionPage",
      icon: "fa-solid fa-file-lines",
    });
  });

  it("handles a direct header click through the application frame", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const renderSource = vi.fn();
    const source = { ...journal(), sheet: { render: renderSource } };
    const translated: FoundryJournalDocument = {
      id: "translated-id",
      uuid: "Compendium.world.foundry-translate-translations.JournalEntry.translated-id",
      flags: {
        "foundry-translate": {
          translation: {
            schemaVersion: 1,
            sourceUuid: source.uuid,
            sourceHash: "hash",
            providerId: "chrome-local",
            sourceLanguage: "en",
            targetLanguage: "cs",
            translatedAt: "2026-07-13T18:00:00.000Z",
            translatedTextPages: 1,
            skippedTextPages: 0,
          },
        },
      },
      toObject: () => ({}),
    };
    const element = document.createElement("section");
    const header = document.createElement("header");
    const controlsButton = document.createElement("button");
    header.append(controlsButton);
    element.append(header);
    document.body.append(element);
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", {
      user: { isGM: true },
      journal: { contents: [source] },
      i18n: { localize: () => "Zobrazit originál" },
    });
    const close = vi.fn().mockResolvedValue(undefined);

    addJournalTranslationHeaderButton({
      entry: translated,
      close,
      window: { header, controls: controlsButton },
    });
    header.querySelector<HTMLButtonElement>(".ft-journal-translate-header")?.click();
    await vi.waitFor(() => expect(renderSource).toHaveBeenCalledWith(true));

    expect(close).toHaveBeenCalledOnce();
  });
});
