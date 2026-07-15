import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import type { TranslationProvider } from "../src/providers/types";
import {
  canReuseItemTranslation,
  itemSourceHash,
  readItemTranslationFlag,
  translateItemData,
  type ItemData,
} from "../src/translation/item";

const provider: TranslationProvider = {
  async translate({ texts }) {
    return texts.map((text) => ({
      translatedText: text.replaceAll("A blade of embers.", "Čepel z uhlíků."),
    }));
  },
  async testConnection() {},
};

describe("Item translation", () => {
  it("translates only selected HTML fields and preserves mechanical data", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source: ItemData = {
      _id: "item-id",
      _stats: { modifiedTime: 1 },
      name: "Emberbrand",
      type: "weapon",
      system: {
        description: "<p>A blade of embers.</p>",
        damage: "2d6",
        actionCost: 1,
        identifier: "emberbrand",
      },
      flags: { ember: { keep: true } },
    };
    const original = structuredClone(source);

    const result = await translateItemData({
      source,
      sourceUuid: "Item.item-id",
      glossary: [],
      provider,
      settings: {
        providerId: "chrome-local",
        sourceLanguage: "en",
        targetLanguage: "cs",
      },
      systemHtmlFieldPaths: [["description"]],
      ownerDocument: document,
      nonceFactory: () => "ITEM",
    });

    expect(source).toEqual(original);
    expect(result.data._id).toBeUndefined();
    expect(result.data._stats).toBeUndefined();
    expect(result.data.name).toBe("Emberbrand [CS]");
    expect(result.data.system).toMatchObject({
      description: "<p>Čepel z uhlíků.</p>",
      damage: "2d6",
      actionCost: 1,
      identifier: "emberbrand",
    });
    expect(result.translatedHtmlFields).toBe(1);
    const flag = readItemTranslationFlag(result.data.flags);
    expect(flag).toMatchObject({
      sourceUuid: "Item.item-id",
      translatedHtmlFields: 1,
      fallbackTextSegments: 0,
    });
    expect(flag && canReuseItemTranslation(flag, flag.sourceHash)).toBe(true);
  });

  it("hashes mechanical and HTML source changes", async () => {
    const source: ItemData = {
      name: "Item",
      type: "weapon",
      system: { description: "Before", damage: "1d6" },
    };
    const changed = structuredClone(source);
    changed.system.damage = "2d6";
    await expect(itemSourceHash(source)).resolves.not.toBe(await itemSourceHash(changed));
  });

  it("uses bounded multi-field batches for an LLM provider", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const requestSizes: number[] = [];
    const progress: number[] = [];
    const fields = ["one", "two", "three", "four", "five"];
    const source: ItemData = {
      name: "Field Test",
      type: "feature",
      system: Object.fromEntries(fields.map((field) => [field, `<p>${field} field.</p>`])),
    };

    const result = await translateItemData({
      source,
      sourceUuid: "Item.fields",
      glossary: [],
      provider: {
        async translate({ texts }) {
          requestSizes.push(texts.length);
          return texts.map((text) => ({ translatedText: `Přeloženo: ${text}` }));
        },
        async testConnection() {},
      },
      settings: {
        providerId: "openai-compatible",
        sourceLanguage: "en",
        targetLanguage: "cs",
      },
      systemHtmlFieldPaths: fields.map((field) => [field]),
      ownerDocument: document,
      nonceFactory: () => "ITEMBATCH",
      onProgress: ({ completedFields }) => progress.push(completedFields),
    });

    expect(requestSizes).toEqual([4, 1]);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    expect(result.translatedHtmlFields).toBe(5);
    expect(result.data.system.five).toBe("<p>Přeloženo: five field.</p>");
  });
});
