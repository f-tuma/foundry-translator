import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractCorrectionCandidate, readGlossaryCandidates } from "../src/glossary/candidates";

describe("smart glossary candidates", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extracts a focused manual correction and recovers a source proper name", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);

    expect(extractCorrectionCandidate({
      sourceText: "Enter Castle Ravenloft before dusk.",
      generatedText: "Vstupte do Castle Ravenloft před soumrakem.",
      correctedText: "Vstupte do Hradu Ravenloft před soumrakem.",
      glossary: [],
      documentName: "Guide",
      fieldName: "Arrival: text.content",
      id: "candidate-1",
      createdAt: "2026-07-15T00:00:00.000Z",
    })).toEqual({
      id: "candidate-1",
      source: "Castle",
      replacement: "Hradu",
      previousTranslation: "Castle",
      documentName: "Guide",
      fieldName: "Arrival: text.content",
      createdAt: "2026-07-15T00:00:00.000Z",
    });
  });

  it("maps a changed fixed translation back through an existing glossary entry", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    const candidate = extractCorrectionCandidate({
      sourceText: "The Silver Order waits.",
      generatedText: "Stříbrný řád čeká.",
      correctedText: "Řád stříbrného draka čeká.",
      glossary: [{
        source: "The Silver Order",
        replacement: "Stříbrný řád",
        category: "term",
        aliases: [],
      }],
      documentName: "Guide",
      fieldName: "Order",
    });
    expect(candidate?.source).toBe("The Silver Order");
    expect(candidate?.replacement).toBe("Řád stříbrného draka");
  });

  it("keeps an ambiguous source blank so a user must complete the review", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    const candidate = extractCorrectionCandidate({
      sourceText: "A strange creature waits.",
      generatedText: "Podivné stvoření čeká.",
      correctedText: "Zvláštní bytost čeká.",
      glossary: [],
      documentName: "Guide",
      fieldName: "Creature",
    });
    expect(candidate?.source).toBe("");
    expect(candidate?.replacement).toBe("Zvláštní bytost");
  });

  it("does not include a duplicated unchanged ending in the suggested replacement", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    const candidate = extractCorrectionCandidate({
      sourceText: "Welcome to Ember. The adventure begins.",
      generatedText: "Vítejte v Emberu. Dobrodružství začíná.",
      correctedText: "Vítejte ve světě Ember. Dobrodružství začíná. Dobrodružství začíná.",
      glossary: [],
      documentName: "Guide",
      fieldName: "Welcome",
    });

    expect(candidate?.previousTranslation).toBe("v Emberu");
    expect(candidate?.replacement).toBe("ve světě Ember");
  });

  it("ignores HTML block and whitespace normalization around a focused correction", () => {
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    const candidate = extractCorrectionCandidate({
      sourceText: "<p>The Silver Dragon waits.</p><p>The gate is shut.</p>",
      generatedText: "<p>Stříbrný drak\u00a0čeká.</p><p>Brána je zavřená.</p>",
      correctedText: "<div>Stříbrný drak vyčkává.</div><div>Brána je zavřená.</div>",
      glossary: [],
      documentName: "Guide",
      fieldName: "Dragon",
    });

    expect(candidate?.previousTranslation).toBe("čeká");
    expect(candidate?.replacement).toBe("vyčkává");
  });

  it("rejects malformed persisted candidates", () => {
    expect(readGlossaryCandidates([{ id: "bad" }, null])).toEqual([]);
  });
});
