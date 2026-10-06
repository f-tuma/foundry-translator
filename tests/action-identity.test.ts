import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { assertSystemActionFieldIdentity } from "../src/translation/system-html-fields";
import { loadReview, reviewCatalog } from "../src/review/service";
import { exportTranslationBundle } from "../src/bundles/service";
import { actorSourceHash, type ActorData } from "../src/translation/actor";
import { itemSourceHash, type ItemData } from "../src/translation/item";
import { MODULE_ID } from "../src/constants";
import { ACTOR_TRANSLATIONS_PACK_ID } from "../src/translation/compendium-actor-translation-repository";
import { ITEM_TRANSLATIONS_PACK_ID } from "../src/translation/compendium-item-translation-repository";
import { GlossaryCompendiumRepository } from "../src/glossary/compendium-repository";

class StringField {}
class HTMLField {}
class CrucibleActionField { fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() }; }
class ArrayField { constructor(readonly element: unknown) {} }
const runtime = { system: { constructor: { schema: { fields: { actions: new ArrayField(new CrucibleActionField()) } } } } };
const originalActions = () => [{ id: "first", name: "First", description: "<p>First action.</p>", condition: "When you become Weakened.", cost: 3 },
  { id: "second", name: "Second", description: "<p>Second action.</p>", condition: "After 1 round.", cost: 1 }];
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("checks the actual corresponding Item systems after top-level collection ID remapping", () => {
  const source = { items: [{ _id: "a", system: { actions: originalActions() } }, { _id: "b", system: {} }] };
  const copy = { items: [source.items[1], structuredClone(source.items[0])] };
  expect(() => assertSystemActionFieldIdentity(source, copy,
    ["items", 0, "system", "actions", 0, "name"], ["items", 1, "system", "actions", 0, "name"])).not.toThrow();
  expect(() => assertSystemActionFieldIdentity(source, copy,
    ["items", 0, "system", "actions", 0, "description"], ["items", 0, "system", "actions", 0, "description"])).toThrow("identity");
  expect(() => assertSystemActionFieldIdentity(source, copy, ["items", 0, "name"], ["items", 1, "name"])).not.toThrow();
});

it.each(["reordered", "duplicate", "missing", "empty", "invalid", "deleted"])(
  "rejects %s action identity for names, descriptions and nested HTML", mutation => {
    const source = { system: { actions: originalActions() } }, copy = structuredClone(source);
    const actions: any[] = copy.system.actions;
    if (mutation === "reordered") actions.reverse();
    if (mutation === "duplicate") actions[1].id = actions[0].id;
    if (mutation === "missing") delete actions[1].id;
    if (mutation === "empty") actions[1].id = " ";
    if (mutation === "invalid") actions[1] = null;
    if (mutation === "deleted") actions.pop();
    for (const tail of [["name"], ["condition"], ["description"], ["effects", 0, "description"]]) {
      expect(() => assertSystemActionFieldIdentity(source, copy, ["system", "actions", 0, ...tail])).toThrow("identity");
    }
    expect(() => assertSystemActionFieldIdentity(copy, source, ["system", "actions", 0, "description"])).toThrow("identity");
  });

async function fixture(kind: "Item" | "Actor", mutation: string) {
  const item = { _id: "talent", name: "Talent", system: { actions: originalActions() } };
  const data: any = kind === "Item" ? { name: "Talent", type: "talent", system: item.system } :
    { name: "Scholar", type: "adversary", system: {}, items: [item, { _id: "other", name: "Other", system: {} }] };
  const output = structuredClone(data);
  const system = kind === "Item" ? output.system : output.items[0].system;
  system.actions[0].name = "První"; system.actions[0].description = "<p>První akce.</p>";
  system.actions[0].condition = "Když se stanete Oslabenými.";
  system.actions[1].condition = "Po 1 kole.";
  system.actions[1].name = "Druhá"; system.actions[1].description = "<p>Druhá akce.</p>";
  if (mutation === "reordered") system.actions.reverse();
  if (mutation === "duplicate") system.actions[1].id = system.actions[0].id;
  if (mutation === "missing") delete system.actions[1].id;
  if (kind === "Actor") output.items.reverse(); // First-level ID mapping remains valid.
  const packId = kind === "Item" ? ITEM_TRANSLATIONS_PACK_ID : ACTOR_TRANSLATIONS_PACK_ID;
  const uuid = `${kind}.source`, key = kind === "Item" ? "itemTranslation" : "actorTranslation";
  output.flags = { [MODULE_ID]: { [key]: { schemaVersion: 1, engineRevision: 8, sourceUuid: uuid,
    sourceHash: kind === "Item" ? await itemSourceHash(data as ItemData) : await actorSourceHash(data as ActorData),
    providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-10-06",
    translatedHtmlFields: 2, fallbackTextSegments: 0 } } };
  const source = { id: "source", uuid, name: data.name, documentName: kind, toObject: () => structuredClone(data),
    ...(kind === "Item" ? runtime : { items: { contents: [{ id: "talent", ...runtime }] } }) };
  const copy = { id: "copy", uuid: `Compendium.${packId}.${kind}.copy`, name: output.name,
    flags: output.flags, toObject: () => structuredClone(output) };
  const pack = { collection: packId, locked: false, getDocument: async () => copy,
    getIndex: async () => new Map([["copy", { _id: "copy", name: output.name, flags: output.flags }]]) };
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  vi.stubGlobal("game", { user: { isGM: true, id: "gm", name: "Reviewer" }, world: { id: "test-world" },
    system: { id: "crucible", version: "0.11.0" }, settings: { get: () => undefined }, packs: new Map([[packId, pack]]) });
  vi.stubGlobal("fromUuid", async () => source);
  vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting").mockResolvedValue([]);
  return { data, output, source, copy };
}

it.each(["Item", "Actor"] as const)("retains correctly paired %s action fields through review and export", async kind => {
  const { data, source } = await fixture(kind, "valid");
  const before = JSON.stringify(data);
  const view = await loadReview((await reviewCatalog("cs"))[0]!);
  const rows = view.rows.filter(row => row.fieldId.includes('"actions"'));
  expect(rows).toHaveLength(6);
  expect(rows.every(row => row.blocked === null)).toBe(true);
  expect(rows.some(row => row.translation[0] === "První")).toBe(true);
  expect(rows.filter(row => row.fieldId.endsWith('"condition"]')).map(row => row.translation[0])).toEqual([
    "Když se stanete Oslabenými.", "Po 1 kole.",
  ]);
  const exported = await exportTranslationBundle("cs");
  expect(exported.skipped).toEqual([]);
  expect(exported.bundle.documents[0]!.patches.filter(patch => patch.path.includes("actions"))).toHaveLength(6);
  expect(JSON.stringify(source.toObject())).toBe(before);
});

it.each((["Item", "Actor"] as const).flatMap(kind => ["reordered", "duplicate", "missing"].map(mutation => ({ kind, mutation }))))(
  "blocks $kind $mutation action fields in review and skips its export without pairing by index", async ({ kind, mutation }) => {
    const { data, output } = await fixture(kind, mutation);
    const original = JSON.stringify(data), translated = JSON.stringify(output);
    const view = await loadReview((await reviewCatalog("cs"))[0]!);
    const rows = view.rows.filter(row => row.fieldId.includes('"actions"'));
    expect(rows).toHaveLength(6);
    expect(rows.every(row => row.blocked === "MissingField")).toBe(true);
    const exported = await exportTranslationBundle("cs");
    expect(exported.bundle.documents).toEqual([]);
    expect(exported.skipped).toHaveLength(1);
    expect(exported.skipped[0]).toContain("identity changed");
    expect(JSON.stringify(data)).toBe(original);
    expect(JSON.stringify(output)).toBe(translated);
  });
