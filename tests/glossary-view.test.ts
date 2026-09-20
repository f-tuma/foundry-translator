import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasGlossaryEdits, readGlossaryRow, refreshGlossaryRows, renderGlossaryView, updateGlossaryFilter } from "../src/glossary/glossary-view";
import type { GlossaryEntry } from "../src/glossary/types";

describe("Glossary view", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("edits name usage without treating a legacy default as an unsaved change", () => {
    const {document} = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document",document);
    vi.stubGlobal("game",{i18n:{localize:(key:string)=>key}});
    const entry:GlossaryEntry = {source:"Old Carinth",replacement:"Starý Carinth",category:"location",aliases:[]};
    const view = renderGlossaryView({discovered:[],stored:[entry]});
    const row = view.querySelector<HTMLElement>("[data-glossary-row]")!;
    const select = row.querySelector<HTMLSelectElement>("[data-glossary-mode]")!;
    expect(hasGlossaryEdits(readGlossaryRow(row,entry),entry)).toBe(false);
    const choose=(value:string)=>{for(const option of select.querySelectorAll("option")) option.toggleAttribute("selected",option.value===value);};
    choose("inflect");
    const edited=readGlossaryRow(row,entry);
    expect(edited).toMatchObject({enabled:true,mode:"inflect"});
    expect(hasGlossaryEdits(edited,entry)).toBe(true);
    expect(refreshGlossaryRows(view,[entry],[entry])[0]).toEqual(entry);
    expect(select.value).toBe("inflect");
    choose("off");
    expect(readGlossaryRow(row,edited)).toMatchObject({enabled:false,mode:"inflect"});
  });

  it("explains locally blocked name changes instead of repeating the model's misleading reason", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
    const view = renderGlossaryView({ discovered: [], stored: [{
      source: "Lyla's Caravan", replacement: "Lyla's Caravan", category: "faction", aliases: [],
      naming: { revision: 1, source: "Lyla's Caravan", targetLanguage: "cs", model: "test", action: "preserve", confidence: "uncertain", reason: "The changed name is safe", guard: "protected-root" },
    }] });
    const row = view.querySelector("[data-glossary-row]")!;
    expect(row.textContent).toContain("FOUNDRY_TRANSLATE.Glossary.ReviewNeeded");
    expect(row.textContent).toContain("FOUNDRY_TRANSLATE.Glossary.LegacyProposal");
    expect(row.innerHTML).not.toContain("The changed name is safe");
    expect(row.querySelector<HTMLInputElement>("[data-glossary-replacement]")?.value).toBe("Lyla's Caravan");
  });

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

  it("updates completed rows while retaining unsaved edits, filters, expanded details and scroll", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
    const original: GlossaryEntry[] = [
      { id: "1", source: "Old Carinth", replacement: "Old Carinth", category: "location", aliases: [] },
      { id: "2", source: "Silver Keep", replacement: "Silver Keep", category: "location", aliases: [] },
    ];
    const view = renderGlossaryView({ discovered: [], stored: original });
    document.body.append(view);
    const rows = view.querySelectorAll<HTMLElement>("[data-glossary-row]");
    const draft = rows[0]!.querySelector<HTMLInputElement>("[data-glossary-replacement]")!;
    draft.value = "Můj rozepsaný překlad";
    rows[1]!.querySelector("details")!.open = true;
    const list = view.querySelector<HTMLElement>(".ft-glossary__rows")!;
    list.scrollTop = 120;
    view.querySelector<HTMLInputElement>("[name='manualTerm']")!.value = "Keep";
    const next: GlossaryEntry[] = [
      { ...original[0]!, replacement: "Starý Carinth" },
      { ...original[1]!, replacement: "Stříbrná tvrz" },
      { id: "3", source: "New Keep", replacement: "Nová tvrz", category: "location", aliases: [] },
    ];
    const baselines = refreshGlossaryRows(view, next, original);
    expect(view.querySelector('[data-source="Old Carinth"]')).toBe(draft);
    expect(draft.value).toBe("Můj rozepsaný překlad");
    expect(baselines.find((entry) => entry.id === "1")?.replacement).toBe("Old Carinth");
    expect(view.querySelector<HTMLInputElement>('[data-source="Silver Keep"]')?.value).toBe("Stříbrná tvrz");
    expect(view.querySelector('[data-source="Silver Keep"]')?.closest("[data-glossary-row]")?.querySelector("details")?.open).toBe(true);
    expect(list.scrollTop).toBe(120);
    expect(view.querySelector("[data-glossary-stored-count]")?.textContent).toBe("3");
    expect(view.querySelector<HTMLInputElement>("[name='manualTerm']")?.value).toBe("Keep");
    expect(view.querySelectorAll("[data-glossary-row]:not([hidden])")).toHaveLength(2);
  });

  it("keeps a focused clean input stable until focus leaves, then shows its saved result", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
    const entry: GlossaryEntry = { source: "Old Carinth", replacement: "Old Carinth", category: "location", aliases: [] };
    const view = renderGlossaryView({ discovered: [], stored: [entry] });
    const input = view.querySelector<HTMLInputElement>("[data-glossary-replacement]")!;
    Object.defineProperty(document, "activeElement", { configurable: true, value: input });
    const next = [{ ...entry, replacement: "Starý Carinth" }];
    const baseline = refreshGlossaryRows(view, next, [entry]);
    expect(input.value).toBe("Old Carinth");
    Object.defineProperty(document, "activeElement", { configurable: true, value: null });
    refreshGlossaryRows(view, next, baseline);
    expect(view.querySelector<HTMLInputElement>("[data-glossary-replacement]")?.value).toBe("Starý Carinth");
  });

  it("marks and filters invalid proposals for review without displaying model-generated explanations", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
    const entry: GlossaryEntry = { source: "Vardel Circle", replacement: "Vardel Circle", category: "faction", aliases: [],
      naming: { revision: 1, source: "Vardel Circle", targetLanguage: "cs", model: "qwen", action: "preserve", confidence: "uncertain", reason: "", guard: "invalid-decision" } };
    const view = renderGlossaryView({ discovered: [], stored: [entry, { source: "Carinth", replacement: "Carinth", category: "location", aliases: [] }] });
    const filter = view.querySelector<HTMLSelectElement>("[name='namingFilter']")!;
    filter.querySelector('[value="review"]')!.setAttribute("selected", "");
    filter.querySelector('[value=""]')!.removeAttribute("selected");
    expect(updateGlossaryFilter(view, "").matches).toBe(1);
    expect(view.querySelector(".ft-glossary__review-status")?.textContent).toContain("ReviewNeeded");
    expect(view.querySelector('[data-naming-status="review"]')?.textContent).toContain("LegacyProposal");
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
