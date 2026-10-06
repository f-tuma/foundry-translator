import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { affixActionSourceHash } from "../src/translation/affix-action-display";
import { itemSourceHash } from "../src/translation/item";
import { translatedItemCard } from "../src/translation/translated-item-tooltips";
const mapping = vi.hoisted(() => ({ pair: vi.fn(), source: vi.fn(), display: vi.fn() }));
vi.mock("../src/translation/document-identity", async original => ({
  ...await original<typeof import("../src/translation/document-identity")>(),
  resolveTranslationReference: mapping.pair, resolveSourceReference: mapping.source,
}));
vi.mock("../src/translation/display-text-view", () => ({ lookupDisplayText: mapping.display }));
class StringField {}
class HTMLField {}
class CrucibleActionField { fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() }; }
class ArrayField { element = new CrucibleActionField(); }
class CrucibleAffixActiveEffect { static schema = { fields: { actions: new ArrayField() } }; }
let enrich: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mapping.pair.mockReset(); mapping.source.mockReset(); mapping.display.mockReset();
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  vi.stubGlobal("game", { user: { id: "gm" }, system: { id: "crucible" }, settings: { get: (_module: string, key: string) => key === "targetLanguage" ? "cs" : true } });
  enrich = vi.fn(async html => html);
  vi.stubGlobal("CONFIG", { ux: { TextEditor: { enrichHTML: enrich } }, ActiveEffect: { dataModels: { affix: CrucibleAffixActiveEffect } } });
  mapping.source.mockImplementation(async uuid => uuid);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function fixture() {
  const affixData: any = { _id: "focusing00000001", type: "affix", name: "Focusing", description: "<p>Focus.</p>", system: {
    identifier: "focusing", tier: { value: 1 }, actions: [{ id: "affixFocusing", name: "Replenish Focus", condition: "While equipped",
      description: "<p>Recover 4 Focus using @ref[item.name].</p>", cost: { action: 2 }, hooks: { postActivate: "affixFocusing" } }] } };
  const sourceData: any = { _id: "pearl", name: "Focusing Pearl", type: "accessory", system: { description: { public: "<p>A pearl.</p>" }, actions: [] }, effects: [affixData] };
  const source: any = { id: "pearl", uuid: "Compendium.crucible.equipment.Item.pearl", documentName: "Item", name: sourceData.name,
    type: "accessory", system: { description: sourceData.system.description }, flags: {}, isOwner: true,
    toObject: () => sourceData, testUserPermission: vi.fn(() => true), effects: { contents: [] }, actions: [] };
  const affix: any = { id: affixData._id, uuid: `${source.uuid}.ActiveEffect.${affixData._id}`, documentName: "ActiveEffect", type: "affix",
    parent: source, system: new CrucibleAffixActiveEffect(), toObject: () => affixData, testUserPermission: vi.fn(() => true) };
  const action: any = { ...structuredClone(affixData.system.actions[0]), item: source, affix, parent: affix.system,
    toObject() { const { item: _item, affix: _affix, parent: _parent, toObject: _toObject, ...data } = this; return data; } };
  source.effects.contents.push(affix); source.actions.push(action);
  const targetData: any = structuredClone(sourceData); targetData.name = "Perla Soustředění"; targetData.system.description.public = "<p>Perla.</p>";
  const target: any = { ...source, id: "copy", uuid: "Compendium.world.foundry-translate-items.Item.copy", name: targetData.name,
    system: targetData.system, toObject: () => targetData, flags: { "foundry-translate": { itemTranslation: {
      schemaVersion: 1, engineRevision: 9, sourceUuid: source.uuid, sourceHash: await itemSourceHash(sourceData), providerId: "openai-compatible",
      sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-10-06", translatedHtmlFields: 1, fallbackTextSegments: 0 } } } };
  mapping.pair.mockResolvedValue({ status: "mapped", sourceUuid: source.uuid, translatedUuid: target.uuid });
  vi.stubGlobal("fromUuid", async (uuid: string) => uuid === target.uuid ? target : uuid === source.uuid ? source : null);
  const translations: any = { name: "Doplnit Soustředění", condition: "Při nošení", description: "<p>Doplňte 4 body Soustředění pomocí @ref[item.name].</p>" };
  const hash = await affixActionSourceHash(affixData);
  mapping.display.mockImplementation((doc, path, sourceHash) => doc === affix && sourceHash === hash ? translations[path[3]] ?? null : null);
  const native = '<div class="action line-item" data-item-id="pearl"><header class="action-header"><div class="title"><h4>Focusing Pearl</h4></div></header><div class="description"><p>A pearl.</p></div>'
    + '<section class="actions"><div class="action line-item full" data-action-id="affixFocusing"><header class="action-header"><img alt="Replenish Focus"><div class="title"><h4>Replenish Focus</h4><span class="tag">2 Actions</span></div></header>'
    + '<p class="condition activation"><em>While equipped</em></p><div class="description"><p>Recover 4 Focus using Focusing Pearl.</p></div><button data-action="activate" data-action-id="affixFocusing">Activate</button></div></section></div>';
  return { source, target, sourceData, affixData, affix, action, translations, native };
}
function html(text: string) { const root = document.createElement("div"); root.innerHTML = text; return root; }
describe("Affix Action native Item hover integration", () => {
  it("overlays separate display records while preserving source action identity and native mechanics", async () => {
    const f = await fixture(), stored = JSON.stringify(f.source.toObject()), prepared = JSON.stringify(f.action.toObject(false));
    const result = html(await translatedItemCard(f.source, f.native, "cs")), action = result.querySelector("section.actions > div")!;
    expect(action.querySelector("h4")?.textContent).toBe("Doplnit Soustředění");
    expect(action.querySelector(".description")?.textContent).toBe("Doplňte 4 body Soustředění pomocí Perla Soustředění.");
    expect(action.querySelector("em")?.textContent).toBe("Při nošení");
    expect(action.querySelector("img")?.alt).toBe("Doplnit Soustředění");
    expect(enrich.mock.calls.some(([, options]) => options.relativeTo === f.action)).toBe(true);
    for (const selector of [".tag", "button"]) expect(action.querySelector(selector)?.outerHTML).toBe(html(f.native).querySelector("section.actions " + selector)?.outerHTML);
    expect(JSON.stringify(f.source.toObject())).toBe(stored); expect(JSON.stringify(f.action.toObject(false))).toBe(prepared);
  });
  it.each(["missing-record", "stale-proof", "denied-affix", "changed-number", "changed-command", "foreign-runtime"])("retains native Action for %s", async problem => {
    const f = await fixture();
    if (problem === "missing-record") mapping.display.mockReturnValue(null);
    if (problem === "stale-proof") f.affixData.system.tier.value = 2;
    if (problem === "denied-affix") f.affix.testUserPermission.mockReturnValue(false);
    if (problem === "changed-number") f.translations.description = "<p>Doplňte 5 bodů Soustředění pomocí @ref[item.name].</p>";
    if (problem === "changed-command") f.translations.description = "<p>Doplňte 4 body Soustředění pomocí @UUID[Item.foreign].</p>";
    if (problem === "foreign-runtime") f.action.parent = {};
    const result = html(await translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector("section.actions")?.outerHTML).toBe(html(f.native).querySelector("section.actions")?.outerHTML);
    expect(result.querySelector("h4")?.textContent).toBe("Perla Soustředění");
  });
  it.each(["mechanics", "translation"])("abandons all overlay when %s changes during native Action enrichment", async problem => {
    const f = await fixture();
    enrich.mockImplementation(async (text, options) => {
      if (options.relativeTo === f.action) {
        if (problem === "mechanics") f.affixData.system.actions[0].cost.action = 9;
        if (problem === "translation") f.translations.name = "Changed";
      }
      return text;
    });
    expect(await translatedItemCard(f.source, f.native, "cs")).toBe(f.native);
  });
});
