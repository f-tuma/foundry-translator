import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderJournalTranslationView } from "../src/translation/journal-translation-view";

describe("Journal translation view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders escaped world journals and configured provider", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });

    const form = renderJournalTranslationView({
      journals: [
        {
          id: "journal-id",
          uuid: "JournalEntry.journal-id",
          name: "Count <Strahd>",
          toObject: () => ({}),
        },
      ],
      settings: {
        provider: "chrome-local",
        apiKey: "",
        sourceLanguage: "en",
        targetLanguage: "cs",
      },
    });

    expect(form.querySelector("select")?.textContent).toContain("Count <Strahd>");
    expect(form.innerHTML).toContain("Count &lt;Strahd&gt;");
    expect(form.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(false);
  });

  it("disables translation when the world has no journals", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });

    const form = renderJournalTranslationView({
      journals: [],
      settings: {
        provider: "chrome-local",
        apiKey: "",
        sourceLanguage: "auto",
        targetLanguage: "cs",
      },
    });

    expect(form.querySelector("select")?.hasAttribute("disabled")).toBe(true);
    expect(form.querySelector("button[type='submit']")?.hasAttribute("disabled")).toBe(true);
  });
});
