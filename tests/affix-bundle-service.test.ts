import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { exportTranslationBundle, importTranslationBundle, planBundleImport } from "../src/bundles/service";
import type { TranslationBundle } from "../src/bundles/format";
import { displaySourceHash, readDisplayTextFlag } from "../src/translation/display-text";
import { affixActionSourceHash } from "../src/translation/affix-action-display";
const state = vi.hoisted(() => ({ saved: new Map<string, any>(), writes: 0 }));
vi.mock("../src/glossary/compendium-repository", () => ({ GlossaryCompendiumRepository: class {
  async loadExisting() { return []; } async saveEntries() {}
} }));
vi.mock("../src/translation/compendium-display-text-repository", () => ({ CompendiumDisplayTextRepository: class {
  async find(sourceUuid: string) { const data = state.saved.get(sourceUuid); return data ? { id: data._id, name: data.name, flags: data.flags,
    uuid: `Compendium.world.foundry-translate-display-text.JournalEntry.${data._id}`, documentName: "JournalEntry", toObject: () => structuredClone(data) } : null; }
  async save(data: any) { const copy = structuredClone({ ...data, _id: "copy" }); state.saved.set(copy.flags["foundry-translate"].displayTranslation.sourceUuid, copy); state.writes++; return copy; }
} }));
class StringField {}
class HTMLField {}
class CrucibleActionField { fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() }; }
class ArrayField { element = new CrucibleActionField(); }
class CrucibleAffixActiveEffect { static schema = { fields: { actions: new ArrayField() } }; }
let source: any, doc: any;
beforeEach(() => {
  state.saved.clear(); state.writes = 0;
  source = { _id: "focusing00000000", name: "Focusing", type: "affix", description: "<p>Original affix.</p>", system: {
    identifier: "focusing", tier: { value: 1 }, actions: [{ id: "affixFocusing", name: "Replenish Focus", description: "<p>Recover 4 Focus.</p>", condition: "While equipped", cost: { action: 2 } }] } };
  doc = { id: source._id, name: source.name, type: "affix", uuid: "Compendium.crucible.affixes.ActiveEffect.focusing00000000", documentName: "ActiveEffect",
    system: new CrucibleAffixActiveEffect(), toObject: () => structuredClone(source) };
  const pack = { collection: "world.foundry-translate-display-text", locked: false,
    getIndex: async () => new Map([...state.saved.values()].map(data => [data._id, { _id: data._id, name: data.name, flags: data.flags }])),
    getDocument: async (id: string) => { const data = [...state.saved.values()].find(copy => copy._id === id); return data ? { id, name: data.name, flags: data.flags,
      uuid: `Compendium.world.foundry-translate-display-text.JournalEntry.${id}`, documentName: "JournalEntry", toObject: () => structuredClone(data) } : undefined; } };
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  vi.stubGlobal("game", { user: { isGM: true }, system: { id: "crucible", version: "1" }, packs: new Map([[pack.collection, pack]]) });
  vi.stubGlobal("CONFIG", { ActiveEffect: { dataModels: { affix: CrucibleAffixActiveEffect } } });
  vi.stubGlobal("fromUuid", async (uuid: string) => uuid === doc.uuid ? doc : null);
  vi.stubGlobal("Hooks", { callAll: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
async function bundle(): Promise<TranslationBundle> {
  return { format: "foundry-translate-bundle", version: 3, moduleVersion: "0.34.16", createdAt: "2026-10-06", systemId: "crucible", systemVersion: "1", targetLanguage: "cs", glossary: [], documents: [{
    kind: "ActiveEffect", sourceUuid: doc.uuid, sourceName: source.name, sourceFingerprint: await displaySourceHash("ActiveEffect", source), partial: false,
    processedPageIds: [], fallbackTextSegments: 0, providerId: "openai-compatible", sourceLanguage: "en", translatedAt: "2026-10-06", engineRevision: 1,
    patches: [{ path: ["system", "actions", 0, "name"], format: "text", source: "Replenish Focus", translation: "Doplnit Soustředění" },
      { path: ["system", "actions", 0, "description"], format: "html", source: "<p>Recover 4 Focus.</p>", translation: "<p>Doplňte 4 body Soustředění.</p>" }] }] };
}
describe("Affix Action display record bundle roundtrip", () => {
  it("imports text into separate display pages, then exports numeric source paths from canonical Action IDs", async () => {
    const input = await bundle(), before = JSON.stringify(source);
    const preview = await planBundleImport(input); expect(preview.rows[0]!.state).toBe("ready"); expect(state.writes).toBe(0);
    expect(await importTranslationBundle(preview)).toMatchObject({ imported: 1, issues: [] });
    const copy = state.saved.get(doc.uuid)!; copy.pages.reverse();
    const flag = readDisplayTextFlag(copy.flags)!;
    expect(flag.affixSourceHash).toBe(await affixActionSourceHash(source));
    expect(flag.fields.some(field => JSON.stringify(field.path) === JSON.stringify(["system", "actions", "affixFocusing", "name"]))).toBe(true);
    expect(copy.system).toBeUndefined(); expect(copy.effects).toBeUndefined(); expect(JSON.stringify(source)).toBe(before);
    const output = await exportTranslationBundle("cs");
    expect(output.skipped).toEqual([]); expect(output.bundle.documents[0]!.patches).toEqual(input.documents[0]!.patches);
  });
  it("rejects adjacent mechanical write paths even with correct full source proof", async () => {
    const input = await bundle(); input.documents[0]!.patches.push({ path: ["system", "actions", 0, "cost", "action"], format: "text", source: "2", translation: "9" });
    expect((await planBundleImport(input)).rows[0]!.state).toBe("invalid"); expect(state.writes).toBe(0);
  });
  it("rejects stale mechanics before import and skips records with invalid Affix proof during export", async () => {
    const input = await bundle(); source.system.actions[0].cost.action = 3;
    expect((await planBundleImport(input)).rows[0]!.state).toBe("changed"); expect(state.writes).toBe(0);
    source.system.actions[0].cost.action = 2;
    await importTranslationBundle(await planBundleImport(input));
    state.saved.get(doc.uuid).flags["foundry-translate"].displayTranslation.affixSourceHash = "0".repeat(64);
    const output = await exportTranslationBundle("cs"); expect(output.bundle.documents).toEqual([]); expect(output.skipped[0]).toContain("proof");
  });
  it("keeps duplicate or missing Action identities outside the local import allowlist", async () => {
    const input = await bundle(); source.system.actions.push(structuredClone(source.system.actions[0]));
    input.documents[0]!.sourceFingerprint = await displaySourceHash("ActiveEffect", source);
    expect((await planBundleImport(input)).rows[0]!.state).toBe("invalid"); expect(state.writes).toBe(0);
  });
});
