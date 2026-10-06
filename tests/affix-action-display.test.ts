import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { affixActionDisplayFields, affixActionIndexPath, affixActionSourceHash, canonicalAffixActionDisplayPath,
  isAffixActionDisplayPath, readAffixActionDisplayField, resolveAffixActionDisplay } from "../src/translation/affix-action-display";
import { buildDisplayTextRecord, displayFields, displaySourceHash, readDisplayField, readDisplayTextFlag, translateDisplayText } from "../src/translation/display-text";
import { portableFields } from "../src/bundles/fields";

class StringField {}
class HTMLField {}
class CrucibleActionField { fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() }; }
class ArrayField { element = new CrucibleActionField(); }
class CrucibleAffixActiveEffect { static schema = { fields: { actions: new ArrayField() } }; }
const runtime = () => ({ system: new CrucibleAffixActiveEffect() });
function source() { return { _id: "affix00000000001", name: "Focusing", type: "affix", description: "<p>Original affix.</p>",
  system: { identifier: "focusing", tier: { value: 1 }, actions: [{ id: "affixFocusing", name: "Replenish Focus",
    description: "<p>Recover 4 Focus using @ref[item.name].</p>", condition: "While equipped", cost: { action: 2, heroism: 1 },
    hooks: { postActivate: "affixFocusing" }, effects: [] }] }, flags: { crucible: { native: true } } }; }
beforeEach(() => {
  CrucibleAffixActiveEffect.schema = { fields: { actions: new ArrayField() } };
  vi.stubGlobal("game", { user: { id: "gm" }, system: { id: "crucible" } });
  vi.stubGlobal("CONFIG", { ActiveEffect: { dataModels: { affix: CrucibleAffixActiveEffect } } });
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
});
afterEach(() => vi.unstubAllGlobals());

describe("canonical native Affix Action fields", () => {
  it("extracts only names, descriptions and displayed conditions from the configured native schema", () => {
    const data = source();
    expect(affixActionDisplayFields(data, runtime()).map(field => [field.path, field.format])).toEqual([
      [["system", "actions", "affixFocusing", "name"], "text"],
      [["system", "actions", "affixFocusing", "description"], "html"],
      [["system", "actions", "affixFocusing", "condition"], "text"],
    ]);
    expect(displayFields("ActiveEffect", data, runtime()).length).toBe(5);
    expect(readDisplayField(data, ["system", "actions", "affixFocusing", "description"])).toBe(data.system.actions[0]!.description);
  });
  it.each(["other-system", "other-type", "missing-model", "foreign-runtime", "wrong-array", "wrong-description", "duplicate-id", "unsafe-id", "missing-description"])("fails closed for %s", problem => {
    const data: any = source(); let model: any = runtime();
    if (problem === "other-system") game.system!.id = "dnd5e";
    if (problem === "other-type") data.type = "base";
    if (problem === "missing-model") vi.stubGlobal("CONFIG", {});
    if (problem === "foreign-runtime") model = { system: {} };
    if (problem === "wrong-array") (CrucibleAffixActiveEffect.schema.fields as any).actions = new StringField();
    if (problem === "wrong-description") (CrucibleAffixActiveEffect.schema.fields.actions.element.fields as any).description = new StringField();
    if (problem === "duplicate-id") data.system.actions.push(structuredClone(data.system.actions[0]));
    if (problem === "unsafe-id") data.system.actions[0].id = "__proto__";
    if (problem === "missing-description") delete data.system.actions[0].description;
    expect(affixActionDisplayFields(data, model)).toEqual([]);
    expect(displayFields("ActiveEffect", data, model).map(field => field.path)).toEqual([["name"], ["description"]]);
  });
  it("requires StringField conditions and never exposes hooks, costs or effect configuration", () => {
    (CrucibleAffixActiveEffect.schema.fields.actions.element.fields as any).condition = new HTMLField();
    const fields = affixActionDisplayFields(source());
    expect(fields.map(field => field.path[3])).toEqual(["name", "description"]);
    for (const key of ["hooks", "effects", "cost", "identifier", "tier"]) expect(isAffixActionDisplayPath(["system", "actions", "affixFocusing", key])).toBe(false);
    expect(isAffixActionDisplayPath(["system", "actions", "affixFocusing", "description"], "text")).toBe(false);
    expect(isAffixActionDisplayPath(["system", "actions", 0, "name"])).toBe(false);
  });
  it("maps canonical IDs to numeric import paths only after local identity validation", () => {
    const data: any = source();
    data.system.actions.unshift({ ...structuredClone(data.system.actions[0]), id: "otherAction", name: "Other" });
    expect(affixActionIndexPath(data, ["system", "actions", "affixFocusing", "name"])).toEqual(["system", "actions", 1, "name"]);
    expect(canonicalAffixActionDisplayPath(data, ["system", "actions", 1, "name"])).toEqual(["system", "actions", "affixFocusing", "name"]);
    expect(readAffixActionDisplayField(data, ["system", "actions", "missing", "name"])).toBeNull();
    expect(affixActionIndexPath(data, ["system", "actions", "affixFocusing", "cost"])).toBeNull();
    const doc: any = { ...runtime(), id: data._id, uuid: `Item.pearl.ActiveEffect.${data._id}`, name: data.name,
      documentName: "ActiveEffect", toObject: () => data };
    expect(portableFields(doc).find(field => field.path[2] === 1 && field.path[3] === "name")?.path).toEqual(["system", "actions", 1, "name"]);
    data.system.actions.push(structuredClone(data.system.actions[1]));
    expect(affixActionIndexPath(data, ["system", "actions", "affixFocusing", "name"])).toBeNull();
  });
  it("fingerprints the full original Affix, including nontext mechanics and flags", async () => {
    const data = source(), before = await affixActionSourceHash(data), displayBefore = await displaySourceHash("ActiveEffect", data);
    const changed = structuredClone(data); changed.system.actions[0]!.cost.action = 3;
    expect(await affixActionSourceHash(changed)).not.toBe(before);
    expect(await displaySourceHash("ActiveEffect", changed)).not.toBe(displayBefore);
    const flags = structuredClone(data); flags.flags.crucible.native = false;
    expect(await affixActionSourceHash(flags)).not.toBe(before);
    expect(await affixActionSourceHash({ ...data, _stats: { modifiedTime: 42 } })).toBe(before);
    const reordered = { flags: data.flags, system: data.system, description: data.description, type: data.type, name: data.name, _id: data._id };
    expect(await affixActionSourceHash(reordered)).toBe(before);
  });
  it("does not invalidate plain Scene or non-Affix effect hashes when mechanics change", async () => {
    const data = { ...source(), type: "base" };
    const before = await displaySourceHash("ActiveEffect", data); data.system.actions[0]!.cost.action = 99;
    expect(await displaySourceHash("ActiveEffect", data)).toBe(before);
  });
  it("builds separate display pages with mandatory fullsource proof, never translated Action models", async () => {
    const data = source(), fields = displayFields("ActiveEffect", data);
    const metadata = fields.map((field, index) => ({ ...field, pageId: String(index).padStart(16, "0") }));
    const pages = metadata.map(field => ({ _id: field.pageId, name: field.path.join(" / "), type: "text", text: { content: field.format === "html" ? field.source : `<p>${field.source}</p>` } }));
    const result = await buildDisplayTextRecord({ kind: "ActiveEffect", source: data, sourceUuid: "Item.pearl.ActiveEffect.affix00000000001",
      sourceLanguage: "en", targetLanguage: "cs", glossaryFingerprint: "g", providerFingerprint: "p", providerId: "openai-compatible",
      translatedAt: "2026-10-06", fallbackTextSegments: 0 }, pages, metadata);
    const flag = readDisplayTextFlag(result.flags)!;
    expect(flag.affixSourceHash).toBe(await affixActionSourceHash(data));
    expect(result.system).toBeUndefined();
    expect(readDisplayTextFlag({ "foundry-translate": { displayTranslation: { ...flag, outputHash: "a".repeat(64) } } })).not.toBeNull();
    expect(readDisplayTextFlag({ "foundry-translate": { displayTranslation: { ...flag, outputHash: "forged" } } })).toBeNull();
    delete flag.affixSourceHash;
    expect(readDisplayTextFlag({ "foundry-translate": { displayTranslation: flag } })).toBeNull();
    expect(data.system.actions[0]!.cost.action).toBe(2);
  });
  it("translates only an explicit source-derived Action subset while binding the complete source", async () => {
    const data = source(), requested: string[] = [], before = structuredClone(data);
    const path = ["system", "actions", "affixFocusing", "name"];
    const result = await translateDisplayText({ source: data, sourceUuid: "Item.pearl.ActiveEffect.affix00000000001", kind: "ActiveEffect",
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" }, glossary: [], glossaryHash: "g", providerHash: "p",
      onlyPaths: [path], provider: { async testConnection() {}, async translate({ texts }) { requested.push(...texts); return texts.map(text => ({ translatedText: `CZ ${text}` })); } } });
    const flag = readDisplayTextFlag(result.flags)!;
    expect(flag.fields.map(field => field.path)).toEqual([path]); expect(result.pages).toHaveLength(1);
    expect(flag.affixSourceHash).toBe(await affixActionSourceHash(data));
    expect(flag.sourceHash).toBe(await displaySourceHash("ActiveEffect", data));
    expect(requested.join(" ")).not.toContain("Original affix"); expect(data).toEqual(before);
  });
  it.each([{ onlyPaths: [] }, { onlyPaths: [["system", "actions", "affixFocusing", "cost"]] }, { onlyPaths: [["system", "actions", "missing", "name"]] },
    { onlyPaths: [["system", "actions", "affixFocusing", "name"], ["system", "actions", "affixFocusing", "name"]] }])("rejects empty, unknown, mechanical or duplicate subset $onlyPaths before provider use", async ({ onlyPaths }) => {
    const translate = vi.fn(async () => []);
    await expect(translateDisplayText({ source: source(), sourceUuid: "Item.pearl.ActiveEffect.affix00000000001", kind: "ActiveEffect",
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" }, glossary: [], glossaryHash: "g", providerHash: "p", onlyPaths,
      provider: { async testConnection() {}, translate } })).rejects.toThrow("field selection");
    expect(translate).not.toHaveBeenCalled();
  });
});

function nativeFixture() {
  const data: any = source();
  const item: any = { id: "pearl", uuid: "Compendium.crucible.equipment.Item.pearl", documentName: "Item", flags: {},
    testUserPermission: vi.fn(() => true), system: { actions: [] }, actions: [], effects: { contents: [] },
    toObject() { return { _id: this.id, name: "Focusing Pearl", type: "accessory", system: this.system, flags: this.flags,
      effects: this.effects.contents.map((effect: any) => effect.toObject()) }; } };
  const affix: any = { ...runtime(), id: data._id, uuid: `${item.uuid}.ActiveEffect.${data._id}`, documentName: "ActiveEffect", type: "affix",
    parent: item, testUserPermission: vi.fn(() => true), toObject: () => data };
  const action: any = { ...structuredClone(data.system.actions[0]), parent: affix.system, item, affix,
    toObject() { const { item: _item, affix: _affix, parent: _parent, toObject: _toObject, ...value } = this; return value; } };
  item.effects.contents.push(affix); item.actions.push(action);
  const translations: any = { name: "Doplnit Soustředění", description: "<p>Doplňte 4 body Soustředění pomocí @ref[item.name].</p>", condition: "Při nošení" };
  const lookup = vi.fn((_source: any, path: readonly string[], _hash: string): string | null => translations[path[3]!] ?? null);
  return { item, affix, action, data, translations, lookup };
}
describe("native Affix Action presentation lookup", () => {
  it("returns source-bound prose while retaining the original models, IDs and costs", async () => {
    const f = nativeFixture(), before = JSON.stringify(f.item.toObject()), actionBefore = JSON.stringify(f.action.toObject(false));
    const result = await resolveAffixActionDisplay(f.item, f.action, f.lookup);
    expect(result?.name).toBe("Doplnit Soustředění"); expect(result?.description).toContain("@ref[item.name]");
    expect(result?.condition).toBe("Při nošení"); expect(result?.source).toBe(f.affix); expect(result?.current()).toBe(true);
    expect(f.lookup).toHaveBeenCalledWith(f.affix, ["system", "actions", "affixFocusing", "name"], await affixActionSourceHash(f.data));
    expect(JSON.stringify(f.item.toObject())).toBe(before); expect(JSON.stringify(f.action.toObject(false))).toBe(actionBefore);
  });
  it.each(["foreign-affix", "foreign-item", "wrong-parent", "duplicate-runtime", "item-id-collision", "duplicate-affix", "source-denied", "affix-denied", "runtime-prose", "changed-number", "changed-command", "changed-html", "foreign-uuid"])("rejects %s", problem => {
    const f = nativeFixture();
    if (problem === "foreign-affix") f.action.affix = { ...f.affix };
    if (problem === "foreign-item") f.action.item = { ...f.item };
    if (problem === "wrong-parent") f.action.parent = {};
    if (problem === "duplicate-runtime") f.item.actions.push(f.action);
    if (problem === "item-id-collision") f.item.system.actions.push({ id: f.action.id });
    if (problem === "duplicate-affix") f.item.effects.contents.push(f.affix);
    if (problem === "source-denied") f.item.testUserPermission.mockReturnValue(false);
    if (problem === "affix-denied") f.affix.testUserPermission.mockReturnValue(false);
    if (problem === "runtime-prose") f.action.description = "<p>Other.</p>";
    if (problem === "changed-number") f.translations.description = "<p>Doplňte 5 bodů Soustředění pomocí @ref[item.name].</p>";
    if (problem === "changed-command") f.translations.description = "<p>Doplňte 4 body Soustředění pomocí @UUID[Item.other].</p>";
    if (problem === "changed-html") f.translations.description = '<p class="different">Doplňte 4 body Soustředění pomocí @ref[item.name].</p>';
    if (problem === "foreign-uuid") f.affix.uuid = "Item.foreign.ActiveEffect.affix00000000001";
    return expect(resolveAffixActionDisplay(f.item, f.action, f.lookup)).resolves.toBeNull();
  });
  it.each(["source-mechanics", "runtime-mechanics", "permissions", "translation", "user", "schema", "item-uuid", "removed-affix"])("invalidates after %s changes during caller enrichment", async change => {
    const f = nativeFixture(), result = await resolveAffixActionDisplay(f.item, f.action, f.lookup);
    expect(result?.current()).toBe(true);
    if (change === "source-mechanics") f.data.system.actions[0].cost.action = 9;
    if (change === "runtime-mechanics") f.action.cost.action = 9;
    if (change === "permissions") f.affix.testUserPermission.mockReturnValue(false);
    if (change === "translation") f.translations.name = "Changed";
    if (change === "user") game.user = { id: "other", isGM: false };
    if (change === "schema") vi.stubGlobal("CONFIG", {});
    if (change === "item-uuid") f.item.uuid = "Item.other";
    if (change === "removed-affix") f.item.effects.contents.length = 0;
    expect(result?.current()).toBe(false);
  });
});
