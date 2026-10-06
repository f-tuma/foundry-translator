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
    expect(result.data.name).toBe("Emberbrand");
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

    expect(requestSizes).toEqual([1, 4, 1]);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    expect(result.translatedHtmlFields).toBe(5);
    expect(result.data.system.five).toBe("<p>Přeloženo: five field.</p>");
  });
  it("translates schema-selected action names with the Item title without changing IDs or mechanics", async () => {
    const source: ItemData = { name: "Talent", type: "talent", system: { actions: [
      { id: "constructedCompanion", name: "Construct Companion", description: "", cost: { action: 3 },
        condition: "original condition", tags: ["summon"], effects: [{ name: "Unchanged Effect" }] },
      { id: "inherited", name: "", cost: { action: 1 } },
    ] } };
    const before = structuredClone(source);
    const result = await translateItemData({ source, sourceUuid: "Item.talent", glossary: [],
      provider: { async translate({ texts }) { return texts.map(text => ({ translatedText: text
        .replaceAll("Talent", "Nadání").replaceAll("Construct Companion", "Sestrojit Společníka") })); }, async testConnection() {} },
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
      systemHtmlFieldPaths: [], actionNameFieldPaths: [["actions", 0, "name"], ["actions", 1, "name"],
        ["actions", 0, "condition"], ["actions", 0, "id"], ["actions", 0, "effects", 0, "name"]],
    });
    expect(source).toEqual(before);
    expect(result.data.name).toBe("Nadání");
    const expected = structuredClone(source.system);
    (expected.actions as { name: string }[])[0]!.name = "Sestrojit Společníka";
    expect(result.data.system).toEqual(expected);
    expect(result.translatedHtmlFields).toBe(0);
    const flag = readItemTranslationFlag(result.data.flags)!;
    expect(flag.engineRevision).toBe(8);
    expect(canReuseItemTranslation({ ...flag, engineRevision: 7 }, flag.sourceHash)).toBe(false);
  });

  it("counts action-name integrity fallback and keeps the original action name", async () => {
    const source: ItemData = { name: "Talent", type: "talent", system: { actions: [
      { id: "summon", name: "Construct 3 Companions", cost: { action: 3 } },
    ] } };
    const result = await translateItemData({ source, sourceUuid: "Item.talent", glossary: [],
      provider: { async translate({ texts }) { return texts.map(text => ({ translatedText:
        text.includes("Construct 3 Companions") ? "" : text })); }, async testConnection() {} },
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
      systemHtmlFieldPaths: [], actionNameFieldPaths: [["actions", 0, "name"]],
    });
    expect(result.data.system).toEqual(source.system);
    expect(result.fallbackTextSegments).toBe(1);
    expect(readItemTranslationFlag(result.data.flags)?.fallbackTextSegments).toBe(1);
  });

});
