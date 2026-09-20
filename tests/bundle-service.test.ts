import { parseHTML } from "linkedom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { exportTranslationBundle, planBundleImport, importTranslationBundle } from "../src/bundles/service";
import { journalSourceHash } from "../src/translation/journal";
import { translatedOutputHash } from "../src/translation/output-hash";
import type { TranslationBundle } from "../src/bundles/format";
import type { GlossaryEntry } from "../src/glossary/types";

const state = vi.hoisted(() => ({ saved: new Map<string, Record<string, any>>(), glossary: [] as GlossaryEntry[], writes: 0 }));
vi.mock("../src/glossary/compendium-repository", () => ({ GlossaryCompendiumRepository: class {
  async loadExisting() { return state.glossary; }
  async load() { return state.glossary; }
  async saveEntries(entries: GlossaryEntry[]) { state.glossary.push(...entries); }
} }));
vi.mock("../src/translation/compendium-translation-repository", () => ({
  TRANSLATIONS_PACK_ID: "world.translations", TRANSLATION_FLAG_PATH: "flags.foundry-translate.translation",
  CompendiumJournalTranslationRepository: class {
    async save(data: Record<string, any>) {
      const key = data.flags["foundry-translate"].translation.sourceUuid;
      const copy = structuredClone({ ...data, _id: state.saved.get(key)?._id ?? `copy${state.saved.size}` });
      state.saved.set(key, copy); state.writes += 1;
      return { id: copy._id, uuid: `Compendium.world.translations.JournalEntry.${copy._id}`, toObject: () => structuredClone(copy) };
    }
  },
}));
const sources = new Map<string, any>();
function source(id: string, text = '<p>Hello.</p>') {
  const data = { _id: id, name: id, pages: [{ _id: `${id}page`, name: "Arrival", type: "text", text: { format: 1, content: text } }], flags: { ember: { important: true } }, ownership: { default: 0 } };
  const doc = { id, uuid: `JournalEntry.${id}`, name: id, documentName: "JournalEntry", toObject: () => structuredClone(data) };
  sources.set(doc.uuid, doc);
  return { doc, data };
}
function pack() {
  return { collection: "world.translations", locked: false, getIndex: async () => new Map([...state.saved.values()].map((d) => [d._id, { _id: d._id, name: d.name, flags: d.flags }])), getDocument: async (id: string) => {
    const data = [...state.saved.values()].find((d) => d._id === id);
    return data ? { id, uuid: `Compendium.world.translations.JournalEntry.${id}`, name: data.name, flags: data.flags, toObject: () => structuredClone(data) } : undefined;
  } };
}
async function createBundle(): Promise<TranslationBundle> {
  const a = source("a", '<p>Meet @UUID[JournalEntry.b.JournalEntryPage.bpage]{B}.</p>');
  const b = source("b", '<p>Return to @UUID[JournalEntry.a]{A}.</p>');
  return { format: "foundry-translate-bundle", version: 1, moduleVersion: "0.15.0", createdAt: "2026-09-20", systemId: "crucible", systemVersion: "0.11.0", targetLanguage: "cs", glossary: [],
    documents: await Promise.all([a, b].map(async ({ doc, data }, i) => ({ kind: "JournalEntry" as const, sourceUuid: doc.uuid, sourceName: data.name, sourceFingerprint: await translatedOutputHash(data), partial: false, processedPageIds: [data.pages[0]!._id], fallbackTextSegments: 0,
      providerId: "openai-compatible" as const, sourceLanguage: "en", translatedAt: "2026-09-20", engineRevision: 9,
      patches: [{ path: ["pages", 0, "text", "content"], format: "html" as const, source: data.pages[0]!.text.content,
        translation: i === 0 ? '<p>Potkejte @UUID[JournalEntry.b.JournalEntryPage.bpage]{B}.</p>' : '<p>Vraťte se k @UUID[JournalEntry.a]{A}.</p>' }] }))) };
}
beforeEach(() => {
  state.saved.clear(); state.glossary = []; state.writes = 0; sources.clear();
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  vi.stubGlobal("game", { user: { isGM: true }, system: { id: "crucible", version: "0.11.0" }, packs: new Map([["world.translations", pack()]]) });
  vi.stubGlobal("fromUuid", async (uuid: string) => sources.get(uuid) ?? null);
});
afterEach(() => vi.unstubAllGlobals());

it("previews without writes, imports cyclic references without a provider, and roundtrips the export", async () => {
  const bundle = await createBundle();
  const before = JSON.stringify([...sources.values()].map((d) => d.toObject()));
  const plan = await planBundleImport(bundle);
  expect(plan.rows.map((r) => r.state)).toEqual(["ready", "ready"]);
  expect(state.writes).toBe(0);
  const result = await importTranslationBundle(plan);
  expect(result).toMatchObject({ imported: 2, skipped: 0, issues: [] });
  const a = state.saved.get("JournalEntry.a")!;
  const b = state.saved.get("JournalEntry.b")!;
  expect(a.pages[0].text.content).toContain(`@UUID[Compendium.world.translations.JournalEntry.${b._id}.JournalEntryPage.bpage]`);
  expect(b.pages[0].text.content).toContain(`@UUID[Compendium.world.translations.JournalEntry.${a._id}]`);
  expect(a.flags.ember.important).toBe(true);
  expect(JSON.stringify([...sources.values()].map((d) => d.toObject()))).toBe(before);
  const exported = await exportTranslationBundle("cs");
  expect(exported.skipped).toEqual([]);
  expect(exported.bundle.documents.map((d) => d.patches)).toEqual(bundle.documents.map((d) => d.patches));
  expect(JSON.stringify(exported.bundle)).not.toContain('"ownership"');
});
it("keeps existing translations and is idempotent", async () => {
  const bundle = await createBundle();
  await importTranslationBundle(await planBundleImport(bundle));
  state.saved.get("JournalEntry.a")!.pages[0].text.content = "Manual correction";
  state.writes = 0;
  const result = await importTranslationBundle(await planBundleImport(bundle));
  expect(result.imported).toBe(0);
  expect(state.writes).toBe(0);
  expect(state.saved.get("JournalEntry.a")!.pages[0].text.content).toBe("Manual correction");
});
it("rechecks changed sources between preview and commit", async () => {
  const bundle = await createBundle();
  const plan = await planBundleImport(bundle);
  sources.get("JournalEntry.a").toObject = () => ({ name: "changed", pages: [] });
  const result = await importTranslationBundle(plan);
  expect(result.imported).toBe(1);
  expect(state.saved.has("JournalEntry.a")).toBe(false);
});
it("rejects mechanical changes even with a matching source hash", async () => {
  const bundle = await createBundle();
  bundle.documents[0]!.patches.push({ path: ["flags", "ember", "important"], source: "true", translation: "false", format: "text" });
  const plan = await planBundleImport(bundle);
  expect(plan.rows[0]!.state).toBe("invalid");
  expect(state.writes).toBe(0);
});
it("preserves local glossary decisions and rejects alias conflicts", async () => {
  const bundle = await createBundle();
  state.glossary = [{ source: "Ordain", replacement: "Ordain", category: "location", aliases: ["City"] }];
  bundle.glossary = [{ source: "Ordain", replacement: "Město", category: "location", aliases: [] }, { source: "Town", replacement: "Vesnice", category: "term", aliases: ["City"] }];
  const plan = await planBundleImport(bundle);
  expect(plan.glossary).toEqual([]);
  expect(plan.glossaryConflicts).toEqual(["Ordain", "Town"]);
});
it("rejects a different rules system before any write", async () => {
  const bundle = await createBundle(); bundle.systemId = "dnd5e";
  await expect(planBundleImport(bundle)).rejects.toThrow("requires system");
  expect(state.writes).toBe(0);
});
it("skips stale stored output during export", async () => {
  const { doc, data } = source("stale");
  state.saved.set(doc.uuid, { ...data, _id: "copy", flags: { "foundry-translate": { translation: {
    schemaVersion: 1, sourceUuid: doc.uuid, sourceHash: await journalSourceHash({ ...data, name: "old" }), providerId: "chrome-local", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-09-20", translatedTextPages: 1, skippedTextPages: 0,
  } } } });
  const result = await exportTranslationBundle("cs");
  expect(result.bundle.documents).toHaveLength(0);
  expect(result.skipped[0]).toContain("changed");
});
it("exports embedded pages by ID even when Foundry reorders the translated collection", async () => {
  const { doc, data } = source("reordered");
  data.pages.push({ _id: "second", name: "Second", type: "text", text: { format: 1, content: "<p>Goodbye.</p>" } });
  const copy = structuredClone(data);
  copy.pages[0]!.text.content = "<p>Ahoj.</p>";
  copy.pages[1]!.text.content = "<p>Sbohem.</p>";
  copy.pages.reverse();
  state.saved.set(doc.uuid, { ...copy, _id: "copy", flags: { "foundry-translate": { translation: {
    schemaVersion: 1, engineRevision: 9, sourceUuid: doc.uuid, sourceHash: await journalSourceHash(data), providerId: "chrome-local", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-09-20", translatedTextPages: 2, skippedTextPages: 0,
  } } } });
  const exported = await exportTranslationBundle("cs");
  expect(exported.skipped).toEqual([]);
  expect(exported.bundle.documents[0]!.patches.map((p) => [p.source, p.translation])).toEqual([
    ["<p>Hello.</p>", "<p>Ahoj.</p>"], ["<p>Goodbye.</p>", "<p>Sbohem.</p>"],
  ]);
});
