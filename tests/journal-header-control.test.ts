import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addJournalTranslationHeaderButton,
  addJournalTranslationHeaderControl,
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

    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({
      action: "foundry-translate-translate-journal",
      label: "FOUNDRY_TRANSLATE.JournalTranslation.Header.Action",
    });
    expect(header.querySelectorAll(".ft-journal-translate-header")).toHaveLength(1);
    expect(header.firstElementChild?.textContent).toContain("Přeložit tento deník");
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
});
