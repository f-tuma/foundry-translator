import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderGlossaryView, updateGlossaryFilter } from "../src/glossary/glossary-view";

describe("Glossary view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders stored terms as an escaped two-column editor", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });

    const view = renderGlossaryView({
      discovered: [],
      stored: [{
        source: "Order <Silver>",
        replacement: "Řád & drak",
        category: "term",
        aliases: [],
      }],
    });

    expect(view.querySelectorAll(".ft-glossary__columns strong")).toHaveLength(2);
    expect(view.querySelector(".ft-glossary__source")?.textContent).toBe("Order <Silver>");
    expect(view.querySelector<HTMLInputElement>("[data-glossary-replacement]")?.value)
      .toBe("Řád & drak");
    expect(view.innerHTML).toContain("Order &lt;Silver&gt;");
    expect(view.querySelector<HTMLButtonElement>("[data-action='save-edits']")?.disabled)
      .toBe(false);
  });

  it("renders candidates as editable review rows with explicit decisions", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
    const view = renderGlossaryView({
      discovered: [],
      stored: [],
      candidates: [{
        id: "one",
        source: "Castle Ravenloft",
        replacement: "Hrad Ravenloft",
        previousTranslation: "Castle Ravenloft",
        documentName: "Guide",
        fieldName: "Arrival: text.content",
        createdAt: "2026-07-15T00:00:00.000Z",
      }],
    });

    expect(view.querySelector<HTMLInputElement>("[data-candidate-source]")?.value)
      .toBe("Castle Ravenloft");
    expect(view.querySelector<HTMLInputElement>("[data-candidate-replacement]")?.value)
      .toBe("Hrad Ravenloft");
    expect(view.querySelector("[data-action='accept-candidate']")).not.toBeNull();
    expect(view.querySelector("[data-action='reject-candidate']")).not.toBeNull();
  });

  it("filters stored terms from the source field by source, translation, and aliases", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", {
      i18n: {
        localize: (key: string) => ({
          "FOUNDRY_TRANSLATE.Glossary.Search.Results": "Matching entries: {count} of {total}.",
          "FOUNDRY_TRANSLATE.Glossary.Search.Empty": "No similar entry was found.",
        })[key] ?? key,
      },
    });
    const view = renderGlossaryView({
      discovered: [],
      stored: [
        { source: "Castle Ravenloft", replacement: "Hrad Ravenloft", category: "location", aliases: ["Ravenloft Keep"] },
        { source: "Silver Dragon", replacement: "Stříbrný drak", category: "term", aliases: [] },
        { source: "Ember Order", replacement: "Řád uhlíků", category: "term", aliases: ["Ashen Circle"] },
      ],
    });

    expect(updateGlossaryFilter(view, "stribrny")).toEqual({ matches: 1, total: 3 });
    expect(Array.from(view.querySelectorAll<HTMLElement>("[data-glossary-row]:not([hidden])")))
      .toHaveLength(1);
    expect(updateGlossaryFilter(view, "ashen circle").matches).toBe(1);
    expect(updateGlossaryFilter(view, "missing").matches).toBe(0);
    expect(view.querySelector("[data-glossary-filter-text]")?.textContent)
      .toBe("No similar entry was found.");

    expect(updateGlossaryFilter(view, "")).toEqual({ matches: 3, total: 3 });
    expect(view.querySelector<HTMLElement>("[data-glossary-filter-status]")?.hidden).toBe(true);
    expect(Array.from(view.querySelectorAll<HTMLElement>("[data-glossary-row]"))
      .every((row) => !row.hidden)).toBe(true);
  });
});
