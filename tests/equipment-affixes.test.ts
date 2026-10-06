import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { equipmentAffixSourceGuard, planMissingEquipmentAffixes } from "../src/translation/equipment-affixes";
import { DISPLAY_TEXT_PACK, displayFields, displaySourceHash } from "../src/translation/display-text";
import { CRUCIBLE_EQUIPMENT_PACK } from "../src/translation/ember-creation-items";
const state = vi.hoisted(() => ({ settings: { targetLanguage: "cs" } }));
vi.mock("../src/settings/settings", async original => ({ ...await original<object>(), getTranslatorSettings: () => ({ ...state.settings }) }));
class StringField {}
class HTMLField {}
class CrucibleActionField { fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() }; }
class ArrayField { element = new CrucibleActionField(); }
class CrucibleAffixActiveEffect { static schema = { fields: { actions: new ArrayField() } }; }
let documents: Map<string, any>, rows: Map<string, any>, index: ReturnType<typeof vi.fn>;
function fixture() {
  const data = { _id: "pearl", name: "Focusing Pearl", type: "accessory", system: { price: 100, category: "jewelry", actions: [] },
    effects: [{ _id: "affixFocus", name: "Focusing", description: "<p>Original Affix.</p>", type: "affix", system: { actions: [{ id: "replenish", name: "Replenish Focus",
      description: "<p>Recover 4 Focus.</p>", condition: "While equipped", cost: { action: 2 } }], tier: 1 }, flags: {} }] };
  const owner: any = { id: data._id, uuid: `Compendium.${CRUCIBLE_EQUIPMENT_PACK}.Item.${data._id}`, name: data.name,
    documentName: "Item", type: data.type, visible: true, parent: null, system: data.system,
    testUserPermission: vi.fn(() => true), toObject: () => structuredClone(data), effects: { contents: [] } };
  const effect: any = { id: "affixFocus", uuid: `${owner.uuid}.ActiveEffect.affixFocus`, documentName: "ActiveEffect", type: "affix", name: "Focusing",
    parent: owner, system: new CrucibleAffixActiveEffect(), testUserPermission: vi.fn(() => true), toObject: () => structuredClone(data.effects[0]) };
  owner.effects.contents.push(effect); documents.set(owner.uuid, owner); documents.set(effect.uuid, effect);
  return { data, owner, effect };
}
beforeEach(() => {
  state.settings = { targetLanguage: "cs" }; documents = new Map(); rows = new Map(); index = vi.fn(async () => rows);
  CrucibleAffixActiveEffect.schema = { fields: { actions: new ArrayField() } };
  const system = { id: "crucible", version: "0.11", CONFIG: { packs: { equipment: new Set([CRUCIBLE_EQUIPMENT_PACK]) } }, CONST: { ACTOR: { STARTING_EQUIPMENT_BUDGET: 2500 } } };
  vi.stubGlobal("game", { user: { isGM: true, id: "gm" }, world: {}, system, modules: new Map([["ember", { active: true, version: "0.6" }]]),
    packs: new Map([[CRUCIBLE_EQUIPMENT_PACK, {}], [DISPLAY_TEXT_PACK, { getIndex: index }]]), i18n: { localize: (key: string) => key } });
  vi.stubGlobal("crucible", system); vi.stubGlobal("CONFIG", { ActiveEffect: { dataModels: { affix: CrucibleAffixActiveEffect } } });
  vi.stubGlobal("fromUuid", vi.fn(async uuid => documents.get(uuid) ?? null));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("missing-only equipment Affix display plan", () => {
  it("plans only embedded native Affixes with stored Actions and never writes source or records", async () => {
    const f = fixture(), before = JSON.stringify(f.owner.toObject());
    const plan = await planMissingEquipmentAffixes([f.owner], "cs");
    expect(plan).toEqual({ sources: [f.effect], missing: [f.effect], extendable: [], existing: 0 });
    expect(JSON.stringify(f.owner.toObject())).toBe(before); expect(rows.size).toBe(0);
    expect(index).toHaveBeenCalledWith({ fields: ["flags.foundry-translate.displayTranslation"] });
  });
  it.each(["malformed", "partial", "manual", "duplicate"])("reserves %s claims without opening or overwriting a record", async kind => {
    const f = fixture(); rows.set("existing", { flags: { "foundry-translate": { displayTranslation: { sourceUuid: f.effect.uuid, targetLanguage: "cs", schemaVersion: -1, kind } } } });
    if (kind === "duplicate") rows.set("other", structuredClone(rows.get("existing")));
    expect(await planMissingEquipmentAffixes([f.owner], "cs")).toEqual({ sources: [f.effect], missing: [], extendable: [], existing: 1 });
  });
  it("does not reserve another language and works before the display pack exists", async () => {
    const f = fixture(); rows.set("existing", { flags: { "foundry-translate": { displayTranslation: { sourceUuid: f.effect.uuid, targetLanguage: "de" } } } });
    expect((await planMissingEquipmentAffixes([f.owner], "cs")).missing).toEqual([f.effect]);
    game.packs.delete(DISPLAY_TEXT_PACK); expect((await planMissingEquipmentAffixes([f.owner], "cs")).missing).toEqual([f.effect]);
  });
  it.each(["plain-effect", "no-actions", "unknown-schema"])("does not expand the Action scope for %s", async kind => {
    const f = fixture();
    if (kind === "plain-effect") { f.effect.type = "base"; f.data.effects[0]!.type = "base"; }
    if (kind === "no-actions") f.data.effects[0]!.system.actions = [];
    if (kind === "unknown-schema") vi.stubGlobal("CONFIG", {});
    expect(await planMissingEquipmentAffixes([f.owner], "cs")).toEqual({ sources: [], missing: [], extendable: [], existing: 0 });
  });
  it.each(["owner-denied", "effect-denied", "parent", "foreign-uuid", "duplicate-member", "stored-id", "stored-data", "duplicate-owner", "copied-owner"])
    ("rejects ambiguous or unsafe %s", async kind => {
      const f = fixture(); let owners = [f.owner];
      if (kind === "owner-denied") f.owner.testUserPermission.mockReturnValue(false);
      if (kind === "effect-denied") f.effect.testUserPermission.mockReturnValue(false);
      if (kind === "parent") f.effect.parent = {};
      if (kind === "foreign-uuid") f.effect.uuid = "ActiveEffect.foreign";
      if (kind === "duplicate-member") f.owner.effects.contents.push(f.effect);
      if (kind === "stored-id") f.data.effects[0]!._id = "other";
      if (kind === "stored-data") f.effect.toObject = () => ({ ...structuredClone(f.data.effects[0]), name: "Other" });
      if (kind === "duplicate-owner") owners.push(f.owner);
      if (kind === "copied-owner") f.owner.flags = { "foundry-translate": { itemTranslation: {} } };
      await expect(planMissingEquipmentAffixes(owners, "cs")).rejects.toThrow();
    });
  it.each(["owner-text", "effect-mechanics", "prepared-price", "member-instance", "permission", "budget", "settings", "pack", "user"])
    ("rejects %s drift while awaiting the reservation index", async kind => {
      const f = fixture(); index.mockImplementation(async () => {
        if (kind === "owner-text") f.data.name = "Changed";
        if (kind === "effect-mechanics") f.data.effects[0]!.system.actions[0]!.cost.action = 7;
        if (kind === "prepared-price") f.owner.system = { ...f.owner.system, price: 101 };
        if (kind === "member-instance") f.owner.effects.contents = [{ ...f.effect }];
        if (kind === "permission") f.effect.testUserPermission.mockReturnValue(false);
        if (kind === "budget") (game.system as any).CONST.ACTOR.STARTING_EQUIPMENT_BUDGET = 2499;
        if (kind === "settings") state.settings.targetLanguage = "de";
        if (kind === "pack") game.packs.set(DISPLAY_TEXT_PACK, {} as any);
        if (kind === "user") game.user = { isGM: true, id: "other" };
        return rows;
      });
      await expect(planMissingEquipmentAffixes([f.owner], "cs")).rejects.toThrow();
    });
});
describe("embedded equipment Affix source proof", () => {
  it("rechecks the full source and exposes a synchronous final boundary", async () => {
    const f = fixture(), check = await equipmentAffixSourceGuard(f.effect, f.owner);
    await check(); expect(() => check.assertCurrent()).not.toThrow();
    f.data.effects[0]!.system.actions[0]!.cost.action = 9;
    expect(() => check.assertCurrent()).toThrow(); await expect(check()).rejects.toThrow();
  });
  it.each(["missing", "parent", "foreign-id", "mechanics", "permission", "member"])("rejects canonical %s substitution", async kind => {
    const f = fixture(), check = await equipmentAffixSourceGuard(f.effect, f.owner);
    const canonical = { ...f.effect };
    if (kind === "missing") documents.delete(f.effect.uuid);
    if (kind === "parent") canonical.parent = {};
    if (kind === "foreign-id") canonical.id = "other";
    if (kind === "mechanics") canonical.toObject = () => ({ ...structuredClone(f.data.effects[0]), system: { tier: 99, actions: f.data.effects[0]!.system.actions } });
    if (kind === "permission") canonical.testUserPermission = () => false;
    if (kind === "member") canonical.parent = f.owner;
    if (kind !== "missing") documents.set(f.effect.uuid, canonical);
    await expect(check()).rejects.toThrow();
  });
  it("rejects full source mutations during canonical resolution", async () => {
    const f = fixture(), check = await equipmentAffixSourceGuard(f.effect, f.owner);
    (fromUuid as ReturnType<typeof vi.fn>).mockImplementation(async uuid => {
      if (uuid === f.effect.uuid) f.data.effects[0]!.system.actions[0]!.description = "<p>Changed.</p>";
      return documents.get(uuid);
    });
    await expect(check()).rejects.toThrow();
  });
});

async function reserveLegacy(f: ReturnType<typeof fixture>, changes: Record<string, unknown> = {}) {
  const data = f.effect.toObject(), legacy = { name: data.name, description: data.description };
  const flag = { schemaVersion: 1, engineRevision: 1, sourceUuid: f.effect.uuid, documentType: "ActiveEffect",
    sourceHash: await displaySourceHash("ActiveEffect", legacy), targetLanguage: "cs", sourceLanguage: "en",
    glossaryFingerprint: "g", providerFingerprint: "p", providerId: "openai-compatible", translatedAt: "2026-10-06", fallbackTextSegments: 0,
    fields: displayFields("ActiveEffect", legacy).map((field, i) => ({ ...field, pageId: String(i).padStart(16, "0") })), ...changes };
  rows.set("legacy", { flags: { "foundry-translate": { displayTranslation: flag } } });
  return flag;
}
describe("append-only legacy equipment Affix candidates", () => {
  it("offers only a valid single source-matched base record for the service's final page proofs", async () => {
    const f = fixture(); await reserveLegacy(f); const before = JSON.stringify([...rows]);
    expect(await planMissingEquipmentAffixes([f.owner], "cs")).toEqual({ sources: [f.effect], missing: [], extendable: [f.effect], existing: 0 });
    expect(JSON.stringify([...rows])).toBe(before);
  });
  it.each(["duplicate", "fallback", "partial", "source-hash", "field-source", "nested-action", "affix-proof"])("keeps %s records reserved without suggesting extension", async reason => {
    const f = fixture(), flag = await reserveLegacy(f);
    if (reason === "duplicate") rows.set("duplicate", structuredClone(rows.get("legacy")));
    if (reason === "fallback") flag.fallbackTextSegments = 1;
    if (reason === "partial") Object.assign(flag, { partial: true });
    if (reason === "source-hash") flag.sourceHash = "0".repeat(64);
    if (reason === "field-source") flag.fields[0]!.source = "Other";
    if (reason === "nested-action") flag.fields.push({ path: ["system", "actions", "replenish", "name"], source: "Replenish Focus", pageId: "action0000000001", format: "text" });
    if (reason === "affix-proof") Object.assign(flag, { affixSourceHash: "1".repeat(64) });
    expect(await planMissingEquipmentAffixes([f.owner], "cs")).toEqual({ sources: [f.effect], missing: [], extendable: [], existing: 1 });
  });
});
