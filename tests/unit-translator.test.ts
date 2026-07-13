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

  it("rejects missing or reordered HTML boundary tokens", async () => {
    await expect(
      translateUnits({
        units: [["Hello ", "world"]],
        glossary: [],
        provider: provider((text) => {
          const tokens = [...text.matchAll(/⟦FTN:[^⟧]+⟧/gu)].map(([token]) => token);
          return text.replace(tokens[0] ?? "", tokens[1] ?? "");
        }),
        settings,
        nonceFactory: () => "BROKEN",
      }),
    ).rejects.toThrow(/boundary token/);
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
