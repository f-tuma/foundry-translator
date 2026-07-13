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

  it("batches at most 128 units per provider request", async () => {
    const batchSizes: number[] = [];
    await translateUnits({
      units: Array.from({ length: 130 }, (_, index) => [`Text ${index}`]),
      glossary: [],
      provider: provider((text) => text, batchSizes),
      settings,
      nonceFactory: () => crypto.randomUUID().replaceAll("-", ""),
    });

    expect(batchSizes).toEqual([128, 2]);
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
});
