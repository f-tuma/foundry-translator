import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderGlossaryView } from "../src/glossary/glossary-view";

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
});
