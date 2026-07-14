import { describe, expect, it } from "vitest";

import type { TranslationProvider } from "../src/providers/types";
import { MemoryTranslationCache } from "../src/translation/cache";
import { translateUnits } from "../src/translation/unit-translator";

function provider(
  translateText: (text: string) => string,
  batchSizes: number[] = [],
): TranslationProvider {
  return {
    async translate(request) {
      batchSizes.push(request.texts.length);
      return request.texts.map((text) => ({ translatedText: translateText(text) }));
    },
    async testConnection() {},
  };
}

const settings = {
  providerId: "chrome-local" as const,
  sourceLanguage: "en",
  targetLanguage: "cs",
};

describe("translation units", () => {
  it("preserves glossary names and inline segment boundaries", async () => {
    const result = await translateUnits({
      units: [["Strahd entered ", "Castle Ravenloft", "."]],
      glossary: [
        {
          source: "Strahd",
          replacement: "Strahd",
          category: "character",
          aliases: [],
        },
        {
          source: "Castle Ravenloft",
          replacement: "Castle Ravenloft",
          category: "location",
          aliases: [],
        },
      ],
      provider: provider((text) => text.replace("entered", "vstoupil do")),
      settings,
      nonceFactory: () => "TEST",
    });

    expect(result).toEqual([["Strahd vstoupil do ", "Castle Ravenloft", "."]]);
  });

  it("uses cached segment translations without calling the provider again", async () => {
    const cache = new MemoryTranslationCache();
    const batchSizes: number[] = [];
    const translationProvider = provider(
      (text) => text.replace("Hello", "Ahoj"),
      batchSizes,
    );
    const options = {
      units: [["Hello"]],
      glossary: [],
      provider: translationProvider,
      settings,
      cache,
      nonceFactory: () => "CACHE",
    } as const;

    expect(await translateUnits(options)).toEqual([["Ahoj"]]);
    expect(await translateUnits(options)).toEqual([["Ahoj"]]);
    expect(batchSizes).toEqual([1]);
  });

  it("falls back to separate segments when HTML boundary tokens are changed", async () => {
    let request = 0;
    const result = await translateUnits({
      units: [["Hello ", "world"]],
      glossary: [],
      provider: {
        async translate({ texts }) {
          request += 1;
          if (request === 1) {
            return texts.map((text) => ({
              translatedText: text.replaceAll(/__FTN_[A-Z0-9]+_[A-Z0-9]+__/gu, ""),
            }));
          }
          return texts.map((text) => ({
            translatedText: text.trim().replace("Hello", "Ahoj").replace("world", "světe"),
          }));
        },
        async testConnection() {},
      },
      settings,
      nonceFactory: () => "BROKEN",
    });

    expect(request).toBe(2);
    expect(result).toEqual([["Ahoj ", "světe"]]);
  });

  it("does not use HTML boundary tokens for a single segment", async () => {
    let providerInput = "";
    const result = await translateUnits({
      units: [["Welcome to the castle."]],
      glossary: [],
      provider: provider((text) => {
        providerInput = text;
        return "Vítejte na hradě.";
      }),
      settings,
      nonceFactory: () => "SINGLE",
    });

    expect(providerInput).toBe("Welcome to the castle.");
    expect(providerInput).not.toContain("__FTN_");
    expect(result).toEqual([["Vítejte na hradě."]]);
  });

  it("uses ASCII markers that survive Unicode bracket normalization", async () => {
    let providerInput = "";
    const result = await translateUnits({
      units: [["Strahd", " entered Castle Ravenloft."]],
      glossary: [
        {
          source: "Strahd",
          replacement: "Strahd",
          category: "character",
          aliases: [],
        },
        {
          source: "Castle Ravenloft",
          replacement: "Castle Ravenloft",
          category: "location",
          aliases: [],
        },
      ],
      provider: provider((text) => {
        providerInput = text;
        return text
          .replaceAll("⟦", "[")
          .replaceAll("⟧", "]")
          .replace("entered", "vstoupil do");
      }),
      settings,
      nonceFactory: () => "CHROME",
    });

    expect(providerInput).toContain("__FTN_CHROME_0000__");
    expect(providerInput).toContain("__FTG_CHROME0_0000__");
    expect(providerInput).not.toContain("⟦");
    expect(result).toEqual([["Strahd", " vstoupil do Castle Ravenloft."]]);
  });

  it("uses smaller checkpoint batches for the sequential Chrome provider", async () => {
    const batchSizes: number[] = [];
    await translateUnits({
      units: Array.from({ length: 130 }, (_, index) => [`Text ${index}`]),
      glossary: [],
      provider: provider((text) => text, batchSizes),
      settings,
      nonceFactory: () => crypto.randomUUID().replaceAll("-", ""),
    });

    expect(batchSizes).toEqual([16, 16, 16, 16, 16, 16, 16, 16, 2]);
  });

  it("keeps full request batches for network providers", async () => {
    const batchSizes: number[] = [];
    await translateUnits({
      units: Array.from({ length: 130 }, (_, index) => [`Text ${index}`]),
      glossary: [],
      provider: provider((text) => text, batchSizes),
      settings: { ...settings, providerId: "google-cloud-basic" },
      nonceFactory: () => crypto.randomUUID().replaceAll("-", ""),
    });

    expect(batchSizes).toEqual([128, 2]);
  });

  it("keeps provider requests near the recommended character size", async () => {
    const requestSizes: number[] = [];
    await translateUnits({
      units: [
        ["A".repeat(2_000)],
        ["B".repeat(2_000)],
        ["C".repeat(2_000)],
      ],
      glossary: [],
      provider: {
        async translate({ texts }) {
          requestSizes.push(texts.reduce((total, text) => total + text.length, 0));
          return texts.map((text) => ({ translatedText: text }));
        },
        async testConnection() {},
      },
      settings,
      nonceFactory: () => crypto.randomUUID().replaceAll("-", ""),
    });

    expect(requestSizes).toEqual([4_000, 2_000]);
  });

  it("deduplicates identical units within the same translation run", async () => {
    const batchSizes: number[] = [];
    const result = await translateUnits({
      units: [["Repeated text"], ["Repeated text"], ["Repeated text"]],
      glossary: [],
      provider: provider((text) => text.replace("Repeated", "Opakovaný"), batchSizes),
      settings,
      nonceFactory: () => "DUPLICATE",
    });

    expect(batchSizes).toEqual([1]);
    expect(result).toEqual([["Opakovaný text"], ["Opakovaný text"], ["Opakovaný text"]]);
  });

  it("reattaches exact outer whitespace even when the provider trims it", async () => {
    const result = await translateUnits({
      units: [["  Welcome.\n"]],
      glossary: [],
      provider: provider((text) => text.trim().replace("Welcome", "Vítejte")),
      settings,
      nonceFactory: () => "WHITESPACE",
    });

    expect(result).toEqual([["  Vítejte.\n"]]);
  });

  it("keeps Foundry document references and inline rolls exact", async () => {
    const result = await translateUnits({
      units: [["Open @UUID[JournalEntry.abc]{the journal} and roll [[/r 1d20+5]]."]],
      glossary: [],
      provider: provider((text) =>
        text.replace("Open", "Otevři").replace("the journal", "deník").replace("and roll", "a hoď"),
      ),
      settings,
      nonceFactory: () => "SYNTAX",
    });

    expect(result).toEqual([
      ["Otevři @UUID[JournalEntry.abc]{deník} a hoď [[/r 1d20+5]]."],
    ]);
  });

  it("translates an Embed readaloud while keeping all mechanical configuration exact", async () => {
    const providerInputs: string[] = [];
    const source =
      '@Embed[Actor.abc inline cite=false readaloud="The heroes enter Ordain."]{Example actor}';
    const result = await translateUnits({
      units: [[source]],
      glossary: [{
        source: "Ordain",
        replacement: "Ordain",
        category: "location",
        aliases: [],
      }],
      provider: provider((text) => {
        providerInputs.push(text);
        return text
          .replace("The heroes enter", "Hrdinové vstoupí do")
          .replace("Example actor", "Ukázková postava");
      }),
      settings,
      nonceFactory: () => "EMBED",
    });

    expect(providerInputs.join(" ")).not.toContain("Actor.abc");
    expect(providerInputs.join(" ")).not.toContain("cite=false");
    expect(result).toEqual([[
      '@Embed[Actor.abc inline cite=false readaloud="Hrdinové vstoupí do Ordain."]{Ukázková postava}',
    ]]);
  });

  it("retries a suspicious unchanged translation and only caches the verified result", async () => {
    const cache = new MemoryTranslationCache();
    let calls = 0;
    const translationProvider = provider((text) => {
      calls += 1;
      return calls === 1 ? text : text.replace("The heroes enter the castle", "Hrdinové vstoupí do hradu");
    });
    const options = {
      units: [["The heroes enter the castle."]],
      glossary: [],
      provider: translationProvider,
      settings,
      cache,
      nonceFactory: () => "QUALITY",
    } as const;

    await expect(translateUnits(options)).resolves.toEqual([
      ["Hrdinové vstoupí do hradu."],
    ]);
    await expect(translateUnits(options)).resolves.toEqual([
      ["Hrdinové vstoupí do hradu."],
    ]);
    expect(calls).toBe(2);
  });

  it("fails closed after three suspicious unchanged translations", async () => {
    let calls = 0;
    await expect(translateUnits({
      units: [["The heroes enter the castle."]],
      glossary: [],
      provider: provider((text) => {
        calls += 1;
        return text;
      }),
      settings,
      nonceFactory: () => "UNCHANGED",
    })).rejects.toThrow(/původním jazyce.*3 pokusech/u);
    expect(calls).toBe(3);
  });

  it("retries a damaged Foundry syntax token before restoring the document", async () => {
    let calls = 0;
    const result = await translateUnits({
      units: [["Open @UUID[JournalEntry.abc]{the journal}."]],
      glossary: [],
      provider: provider((text) => {
        calls += 1;
        if (calls === 1) return text.replace(/__FTS_[A-Z0-9_]+__/u, "");
        return text.replace("Open", "Otevři").replace("the journal", "deník");
      }),
      settings,
      nonceFactory: () => "DAMAGED",
    });

    expect(result).toEqual([["Otevři @UUID[JournalEntry.abc]{deník}."]]);
    expect(calls).toBe(2);
  });

  it("allows an unchanged phrase when the glossary intentionally protects it", async () => {
    let calls = 0;
    const result = await translateUnits({
      units: [["The Shattered Moon"]],
      glossary: [{
        source: "The Shattered Moon",
        replacement: "The Shattered Moon",
        category: "location",
        aliases: [],
      }],
      provider: provider((text) => {
        calls += 1;
        return text;
      }),
      settings,
      nonceFactory: () => "PROPERNAME",
    });

    expect(result).toEqual([["The Shattered Moon"]]);
    expect(calls).toBe(1);
  });

  it("allows a short Title Case proper name to remain unchanged without a glossary entry", async () => {
    let calls = 0;
    const result = await translateUnits({
      units: [["Shard of Fear"]],
      glossary: [],
      provider: provider((text) => {
        calls += 1;
        return text;
      }),
      settings,
      nonceFactory: () => "PROPERTITLE",
    });

    expect(result).toEqual([["Shard of Fear"]]);
    expect(calls).toBe(1);
  });

  it("still rejects a sentence that only starts with a capital letter", async () => {
    let calls = 0;
    await expect(translateUnits({
      units: [["The heroes enter the castle."]],
      glossary: [],
      provider: provider((text) => {
        calls += 1;
        return text;
      }),
      settings,
      nonceFactory: () => "NOTATITLE",
    })).rejects.toThrow(/původním jazyce.*3 pokusech/u);
    expect(calls).toBe(3);
  });
});
