import { describe, expect, it, vi } from "vitest";
import { portableFields, type PortableDocument } from "../src/bundles/fields";
import { labelFor } from "../src/review/labels";
import { discoverCrucibleActionConditionFieldPaths, discoverCrucibleActionNameFieldPaths, discoverSystemHtmlFieldPaths } from "../src/translation/system-html-fields";

class StringField {}
class HTMLField {}
class NumberField {}
class SchemaField { constructor(readonly fields: Record<string, unknown>) {} }
class CrucibleActionField extends SchemaField {}
class ArrayField { constructor(readonly element: unknown) {} }

function schema() {
  return { description: new HTMLField(), actions: new ArrayField(new CrucibleActionField({
    id: new StringField(), name: new StringField(), description: new HTMLField(),
    condition: new StringField(), cost: new SchemaField({ action: new NumberField() }),
    effects: new ArrayField(new SchemaField({ name: new StringField() })),
  })) };
}
function data() {
  return { description: "<p>A talent.</p>", actions: [{ id: "constructedCompanion", name: "Construct Companion",
    description: "<p>Construct a companion for 3 action points.</p>", condition: "Keep original condition",
    cost: { action: 3 }, tags: ["summon"], effects: [{ name: "Keep original effect" }] },
  { id: "second", name: "Second Action", description: "<p>Second.</p>" }] };
}
const runtime = (fields: Record<string, unknown>) => ({ system: { constructor: { schema: { fields } } } });

describe("native Crucible action name allowlist", () => {
  it("discovers only names and retains the already supported action HTML descriptions", () => {
    const fields = schema(), system = data(), before = structuredClone(system);
    expect(discoverCrucibleActionNameFieldPaths(fields, system)).toEqual([
      ["actions", 0, "name"], ["actions", 1, "name"],
    ]);
    expect(discoverSystemHtmlFieldPaths(fields, system)).toEqual([
      ["description"], ["actions", 0, "description"], ["actions", 1, "description"],
    ]);
    expect(system).toEqual(before);
  });

  it.each([
    undefined, {}, { actions: new SchemaField({ name: new StringField() }) },
    { actions: new ArrayField(new SchemaField({ id: new StringField(), name: new StringField(), description: new HTMLField() })) },
    { actions: new ArrayField(new CrucibleActionField({ name: new StringField(), description: new HTMLField() })) },
    { actions: new ArrayField(new CrucibleActionField({ id: new NumberField(), name: new StringField(), description: new HTMLField() })) },
    { actions: new ArrayField(new CrucibleActionField({ id: new StringField(), name: new HTMLField(), description: new HTMLField() })) },
    { actions: new ArrayField(new CrucibleActionField({ id: new StringField(), name: new StringField(), description: new StringField() })) },
  ])("requires the exact local native schema: %j", fields => {
    expect(discoverCrucibleActionNameFieldPaths(fields, data())).toEqual([]);
  });

  it.each([undefined, null, [], "actions", {}, { actions: null }, { actions: {} }, { actions: "name" }])(
    "rejects non-array system action data: %j", system => {
      expect(discoverCrucibleActionNameFieldPaths(schema(), system)).toEqual([]);
    });

  it.each([null, [], "action", { name: "Missing ID" }, { id: 5, name: "Number ID" },
    { id: "", name: "Empty ID" }, { id: "  ", name: "Whitespace ID" },
    { id: "constructedCompanion", name: "Duplicate ID" }])(
    "rejects the entire name allowlist when one action cannot establish unique identity: %j", invalid => {
      const system = { ...data(), actions: [data().actions[0], invalid] };
      expect(discoverCrucibleActionNameFieldPaths(schema(), system)).toEqual([]);
    });

  it("never treats condition/effect/identifier strings or a non-string name as translatable action names", () => {
    const system = { actions: [{ id: "one", name: 5, condition: "Condition", effects: [{ name: "Effect" }] },
      { id: "two", name: "", description: "" }, { id: "three", name: "Valid Action" }] };
    expect(discoverCrucibleActionNameFieldPaths(schema(), system)).toEqual([
      ["actions", 1, "name"], ["actions", 2, "name"],
    ]);
  });

  it("adds standalone Item action names as text fields derived from its runtime schema", () => {
    const fields = schema(), system = data(), value = { name: "Talent", type: "talent", system };
    const doc = { documentName: "Item", ...runtime(fields), toObject: () => value } as unknown as PortableDocument;
    expect(portableFields(doc)).toEqual([
      { path: ["name"], format: "text" }, { path: ["system", "description"], format: "html" },
      { path: ["system", "actions", 0, "description"], format: "html" },
      { path: ["system", "actions", 1, "description"], format: "html" },
      { path: ["system", "actions", 0, "name"], format: "text" },
      { path: ["system", "actions", 1, "name"], format: "text" },
      { path: ["system", "actions", 0, "condition"], format: "text" },
    ]);
  });

  it("uses each embedded Actor Item's ID-matched local schema, never the Actor or another Item schema", () => {
    const fields = schema(), system = data();
    const value = { name: "Actor", system, items: [{ _id: "missing", name: "No local schema", system },
      { _id: "talent", name: "Talent", system }] };
    const doc = { documentName: "Actor", ...runtime(fields), toObject: () => value,
      items: { contents: [{ id: "talent", ...runtime(fields) }] } } as unknown as PortableDocument;
    const names = portableFields(doc).filter(field => field.path.at(-1) === "name" && field.path.includes("actions"));
    expect(names).toEqual([
      { path: ["items", 1, "system", "actions", 0, "name"], format: "text" },
      { path: ["items", 1, "system", "actions", 1, "name"], format: "text" },
    ]);
  });

  it("does not broaden journal-page strings even if a page carries the same shaped custom schema", () => {
    const fields = schema(), system = data();
    const value = { name: "Journal", pages: [{ _id: "page", name: "Page", type: "text", system }] };
    const doc = { documentName: "JournalEntry", toObject: () => value,
      pages: { contents: [{ id: "page", ...runtime(fields) }] } } as unknown as PortableDocument;
    expect(portableFields(doc).some(field => field.path.includes("actions") && field.format === "text")).toBe(false);
  });

  it("cannot enable action name editing/export/import through data alone or duplicate IDs", () => {
    const system = data(), value = { name: "Talent", system };
    const withoutSchema = { documentName: "Item", toObject: () => value } as unknown as PortableDocument;
    expect(portableFields(withoutSchema)).toEqual([{ path: ["name"], format: "text" }]);
    system.actions[1]!.id = system.actions[0]!.id;
    const doc = { documentName: "Item", ...runtime(schema()), toObject: () => value } as unknown as PortableDocument;
    expect(portableFields(doc).some(field => field.path.includes("actions") && field.format === "text")).toBe(false);
  });
});


describe("native Crucible displayed Action condition allowlist", () => {
  it("labels each condition separately from its name and description with a one-based Action number", () => {
    vi.stubGlobal("game", { i18n: { localize: (key: string) => ({
      "FOUNDRY_TRANSLATE.Review.ActionName": "Akce {number} · Název",
      "FOUNDRY_TRANSLATE.Review.ActionDescription": "Akce {number} · Popis",
      "FOUNDRY_TRANSLATE.Review.ActionCondition": "Akce {number} · Podmínka",
    } as Record<string, string>)[key] ?? key } });
    try {
      expect(labelFor("system.actions.0.condition")).toBe("Akce 1 · Podmínka");
      expect(labelFor("system.actions.3.condition")).toBe("Akce 4 · Podmínka");
      expect(labelFor("system.actions.3.name")).toBe("Akce 4 · Název");
      expect(labelFor("system.actions.3.description")).toBe("Akce 4 · Popis");
    } finally { vi.unstubAllGlobals(); }
  });
  it("discovers StringField trigger prose while excluding every adjacent automation field", () => {
    const system = data(), before = structuredClone(system);
    expect(discoverCrucibleActionConditionFieldPaths(schema(), system)).toEqual([["actions", 0, "condition"]]);
    expect(system).toEqual(before);
  });
  it.each([undefined, {}, { actions: new ArrayField(new SchemaField({ condition: new StringField() })) }])(
    "does not trust condition strings without the reviewed native schema: %j", fields => {
      expect(discoverCrucibleActionConditionFieldPaths(fields, data())).toEqual([]);
    });
  it.each([undefined, new HTMLField(), new NumberField(), new SchemaField({})])(
    "rejects a different condition field type: %j", field => {
      const fields = schema(); (fields.actions.element as any).fields.condition = field;
      expect(discoverCrucibleActionConditionFieldPaths(fields, data())).toEqual([]);
    });
  it.each([null, { name: "No ID", condition: "Visible" }, { id: "", condition: "Visible" },
    { id: "constructedCompanion", condition: "Duplicate" }, { id: "third", condition: 42 }])(
    "rejects ambiguous identity or non-text condition data across the whole array: %j", invalid => {
      expect(discoverCrucibleActionConditionFieldPaths(schema(), { actions: [data().actions[0], invalid] })).toEqual([]);
    });
  it("keeps absent/null conditions out and accepts an empty native string without manufacturing prose", () => {
    const system = { actions: [{ id: "one", condition: null }, { id: "two" }, { id: "three", condition: "" }] };
    expect(discoverCrucibleActionConditionFieldPaths(schema(), system)).toEqual([["actions", 2, "condition"]]);
  });
  it("exposes embedded conditions only for the ID-matched Item schema and never journal pages", () => {
    const fields = schema(), system = data();
    const value = { name: "Actor", system: {}, items: [{ _id: "missing", name: "Unknown", system },
      { _id: "known", name: "Known", system }] };
    const actor = { documentName: "Actor", toObject: () => value,
      items: { contents: [{ id: "known", ...runtime(fields) }] } } as unknown as PortableDocument;
    expect(portableFields(actor).filter(field => field.path.at(-1) === "condition")).toEqual([
      { path: ["items", 1, "system", "actions", 0, "condition"], format: "text" },
    ]);
    const journal = { documentName: "JournalEntry", toObject: () => ({ name: "Journal", pages: [{ _id: "p", type: "text", name: "Page", system }] }),
      pages: { contents: [{ id: "p", ...runtime(fields) }] } } as unknown as PortableDocument;
    expect(portableFields(journal).some(field => field.path.at(-1) === "condition")).toBe(false);
  });
});
