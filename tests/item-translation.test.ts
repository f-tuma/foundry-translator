import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranslationProvider } from "../src/providers/types";
import {
  canReuseItemTranslation,
  itemSourceHash,
  readItemTranslationFlag,
  translateItemData,
  type ItemData,
} from "../src/translation/item";

beforeEach(() => vi.stubGlobal("document", parseHTML("<html><body></body></html>").document));
afterEach(() => vi.unstubAllGlobals());

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
    expect(flag.engineRevision).toBe(9);
    expect(canReuseItemTranslation({ ...flag, engineRevision: 8 }, flag.sourceHash)).toBe(false);
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

describe("displayed Action trigger sentences", () => {
  it("uses a separate whole-sentence prose unit, preserves commands/numbers and leaves neighboring mechanics untouched", async () => {
    const source: ItemData = { name: "Talent", type: "talent", system: { actions: [
      { id: "first", name: "First Action", condition: "You become @Condition[weakened] after 3 rounds.",
        cost: { action: 3 }, tags: ["summon"], effects: [{ name: "Original", condition: "NOT PROSE" }] },
    ] } };
    const before = structuredClone(source), calls: string[][] = [];
    const result = await translateItemData({ source, sourceUuid: "Item.talent", glossary: [],
      provider: { supportsPassageContext: true, async translate({ texts }) { calls.push([...texts]); return texts.map(text => ({ translatedText: text
        .replaceAll("Talent", "Nadání").replaceAll("First Action", "První Akce")
        .replaceAll("You become ", "Stanete se ").replaceAll(" after 3 rounds.", " po 3 kolech.") })); }, async testConnection() {} },
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
      systemHtmlFieldPaths: [], actionNameFieldPaths: [["actions", 0, "name"]],
      actionConditionFieldPaths: [["actions", 0, "condition"], ["actions", 0, "name"], ["actions", 0, "id"],
        ["actions", 0, "effects", 0, "condition"], ["actions", 0, "cost", "action"]],
      nonceFactory: () => "CONDITION",
    });
    expect(source).toEqual(before);
    const expected = structuredClone(source.system);
    (expected.actions as any[])[0].name = "První Akce";
    (expected.actions as any[])[0].condition = "Stanete se @Condition[weakened] po 3 kolech.";
    expect(result.data.system).toEqual(expected);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["Talent", "First Action"]);
    expect(calls[1]).toHaveLength(1);
    expect(calls[1]![0]).toContain("You become ");
    expect(calls[1]![0]).toContain(" after 3 rounds.");
    expect(result.translatedHtmlFields).toBe(0);
    expect(result.fallbackTextSegments).toBe(0);
    expect(readItemTranslationFlag(result.data.flags)?.engineRevision).toBe(9);
  });
  it.each(["number", "command", "HTML", "empty"])("keeps an unsafe %s trigger native and reports fallback", async failure => {
    const source: ItemData = { name: "Talent", type: "talent", system: { actions: [
      { id: "first", name: "First", condition: "After 3 rounds, you gain 1 Action." },
    ] } };
    const issues: string[] = [];
    const result = await translateItemData({ source, sourceUuid: "Item.talent", glossary: [],
      provider: { async translate({ texts }) { return texts.map(text => ({ translatedText: !text.includes("After") ? text :
        failure === "number" ? "Po 4 kolech získáte 1 Akci." : failure === "command" ? "Po 3 kolech získáte 1 Akci. @UUID[Actor.foreign]" :
          failure === "HTML" ? "<b>Po 3 kolech získáte 1 Akci.</b>" : "" })); }, async testConnection() {} },
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
      systemHtmlFieldPaths: [], actionConditionFieldPaths: [["actions", 0, "condition"]], onQualityFallback: issue => issues.push(issue.reason),
    });
    expect(result.data.system).toEqual(source.system);
    expect(result.fallbackTextSegments).toBeGreaterThan(0);
    expect(issues.length).toBeGreaterThan(0);
  });
  it("rejects a condition slot with duplicate native IDs before translating its sentence", async () => {
    const source: ItemData = { name: "Talent", type: "talent", system: { actions: [
      { id: "same", condition: "After 3 rounds." }, { id: "same", condition: "After 1 round." },
    ] } };
    await expect(translateItemData({ source, sourceUuid: "Item.talent", glossary: [], provider,
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
      systemHtmlFieldPaths: [], actionConditionFieldPaths: [["actions", 0, "condition"]],
    })).rejects.toThrow("identity");
  });
});
