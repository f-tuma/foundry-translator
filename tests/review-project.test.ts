import { parseHTML } from "linkedom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { exportEditorialProject, planEditorialProject, importEditorialProject } from "../src/review/project";
import { parseEditorialProject } from "../src/review/project-format";
import { journalSourceHash } from "../src/translation/journal";
import { translatedOutputHash } from "../src/translation/output-hash";
import { loadReview, reviewCatalog, updateReview } from "../src/review/service";
import { editorialKey } from "../src/review/editorial";

const state = vi.hoisted(() => ({ saved: new Map<string, any>(), writes: 0, serial: 0, afterWrite: null as (() => void) | null }));
vi.mock("../src/glossary/compendium-repository", () => ({ GlossaryCompendiumRepository: class { async loadExisting() { return []; } async saveEntries() {} } }));
vi.mock("../src/translation/compendium-translation-repository", () => ({ TRANSLATIONS_PACK_ID: "world.translations", TRANSLATION_FLAG_PATH: "flags.foundry-translate.translation", CompendiumJournalTranslationRepository: class {
  async save(data: any) {
    const uuid = data.flags["foundry-translate"].translation.sourceUuid;
    const copy = structuredClone({ ...data, _id: state.saved.get(uuid)?._id ?? `copy${state.serial++}` }); state.saved.set(uuid, copy); state.writes++;
    return { id: copy._id, uuid: `Compendium.world.translations.JournalEntry.${copy._id}`, toObject: () => structuredClone(copy) };
  }
} }));
const sources = new Map<string, any>(), settings = new Map<string, any>();
function dotted(data: any, patch: any) {
  for (const [key, value] of Object.entries(patch)) { const path = key.split('.'); let obj = data; for (const part of path.slice(0, -1)) obj = obj[part] ??= {}; obj[path.at(-1)!] = structuredClone(value); }
}
function pack() {
  return { collection: "world.translations", locked: false, getIndex: async () => new Map([...state.saved.values()].map(d => [d._id, { _id: d._id, name: d.name, flags: d.flags }])), getDocument: async (id: string) => {
    const data = [...state.saved.values()].find(d => d._id === id); if (!data) return undefined;
    return { id, uuid: `Compendium.world.translations.JournalEntry.${id}`, get flags() { return data.flags; }, toObject: () => structuredClone(data), update: async (patch: any) => {
      const { pages, ...root } = patch; dotted(data, root); for (const page of pages ?? []) dotted(data.pages.find((item: any) => item._id === page._id), page); state.writes++; state.afterWrite?.();
    } };
  } };
}
async function snapshot() { return loadReview((await reviewCatalog("cs"))[0]!); }
const paragraph = (snapshot: Awaited<ReturnType<typeof loadReview>>) => snapshot.rows.find(row => row.label === "text.content")!;
beforeEach(async () => {
  sources.clear(); settings.clear(); state.saved.clear(); state.writes = 0; state.serial = 1; state.afterWrite = null;
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  vi.stubGlobal("game", { user: { isGM: true, id: "gm", name: "Alice" }, system: { id: "crucible", version: "0.11" }, modules: new Map(), packs: new Map([["world.translations", pack()]]), i18n: { localize: (key: string) => key },
    settings: { get: (_ns: string, key: string) => structuredClone(settings.get(key)), set: async (_ns: string, key: string, value: any) => { settings.set(key, structuredClone(value)); state.writes++; } } });
  vi.stubGlobal("fromUuid", async (uuid: string) => sources.get(uuid) ?? null); vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
  const data = { _id: "source", name: "Guide", pages: [{ _id: "page", name: "Page", type: "text", text: { format: 1, content: '<p>Read @UUID[JournalEntry.source]{Guide}.</p><p>More.</p>' } }], flags: { ember: { mechanics: true } } };
  sources.set("JournalEntry.source", { uuid: "JournalEntry.source", documentName: "JournalEntry", toObject: () => structuredClone(data) });
  const copy: any = structuredClone(data); copy._id = "copy0"; copy.name = "Průvodce";
  copy.pages[0].text.content = '<p>Čti @UUID[Compendium.world.translations.JournalEntry.copy0]{Průvodce}.</p><p>Více.</p>';
  copy.flags["foundry-translate"] = { translation: { schemaVersion: 1, engineRevision: 12, sourceUuid: "JournalEntry.source", sourceHash: await journalSourceHash(data), providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-09-23", translatedTextPages: 1, skippedTextPages: 0, partial: false, outputHash: await translatedOutputHash(copy) } };
  state.saved.set("JournalEntry.source", copy);
});
afterEach(() => vi.unstubAllGlobals());
it("roundtrips translations, notes and verification across new copy IDs without changing originals; repeat import is a no-op", async () => {
  let view = await snapshot(), row = paragraph(view);
  view = await updateReview(view, row.id, { type: "save", parts: [row.translation[0]!.replace("Čti", "Přečti")] });
  view = await updateReview(view, row.id, { type: "verify" });
  view = await updateReview(view, row.id, { type: "editorial", state: "discussion", note: "Check the title." });
  const before = JSON.stringify(sources.get("JournalEntry.source").toObject());
  const exported = await exportEditorialProject("cs"); expect(exported.skipped).toEqual([]);
  const file = JSON.stringify(exported.project); expect(file).not.toContain("JournalEntry.copy0");
  state.saved.clear(); settings.clear(); state.writes = 0;
  let plan = await planEditorialProject(parseEditorialProject(file)); expect(state.writes).toBe(0); expect(plan.documents[0]!.state).toBe("new");
  const selected = { documents: ["JournalEntry.source"], ui: [], glossary: false };
  expect(await importEditorialProject(plan, selected)).toMatchObject({ documents: 1, issues: [] });
  view = await snapshot(); row = paragraph(view);
  expect(row.translation[0]).toContain("JournalEntry.copy1"); expect(row.verified).toMatchObject({ userName: "Alice", userId: "", importedAt: expect.any(String) });
  expect(row.protected).toBe(true);
  expect(row.editorial).toMatchObject({ state: "discussion", note: "Check the title.", fingerprint: row.fingerprint });
  expect(JSON.stringify(sources.get("JournalEntry.source").toObject())).toBe(before);
  plan = await planEditorialProject(parseEditorialProject(file)); state.writes = 0;
  expect(await importEditorialProject(plan, selected)).toMatchObject({ documents: 1, issues: [] }); expect(state.writes).toBe(0);
});
it("previews existing text replacements, refuses changes after preview and leaves unselected documents alone", async () => {
  const { project } = await exportEditorialProject("cs");
  state.saved.get("JournalEntry.source").name = "Moje úprava";
  let plan = await planEditorialProject(project); expect(plan.documents[0]!.changes[0]).toMatchObject({ before: ["Moje úprava"], parts: ["Průvodce"] });
  state.writes = 0; await importEditorialProject(plan, { documents: [], ui: [], glossary: false }); expect(state.writes).toBe(0);
  state.saved.get("JournalEntry.source").name = "Novější úprava";
  await expect(importEditorialProject(plan, { documents: ["JournalEntry.source"], ui: [], glossary: false })).rejects.toThrow("Conflict"); expect(state.writes).toBe(0);
  plan = await planEditorialProject(project);
  expect(await importEditorialProject(plan, { documents: ["JournalEntry.source"], ui: [], glossary: false })).toMatchObject({ documents: 1, issues: [] });
  expect(state.saved.get("JournalEntry.source").name).toBe("Průvodce");
  expect(state.saved.get("JournalEntry.source").flags["foundry-translate"].reviewHistory).toBeTruthy();
});
it("does not transfer proof after the file text changes, and retains stale notes as stale", async () => {
  let view = await snapshot(); const row = paragraph(view);
  view = await updateReview(view, row.id, { type: "editorial", state: "meaning", note: "Old concern" });
  view = await updateReview(view, row.id, { type: "save", parts: [row.translation[0]!.replace("Čti", "Přečti")] });
  await updateReview(view, row.id, { type: "verify" });
  const { project } = await exportEditorialProject("cs"); expect(project.reviews[0]!.rows[0]!.editorial?.stale).toBe(true);
  state.saved.clear(); settings.clear();
  await importEditorialProject(await planEditorialProject(project), { documents: ["JournalEntry.source"], ui: [], glossary: false });
  view = await snapshot(); expect(paragraph(view).editorial!.fingerprint).not.toBe(paragraph(view).fingerprint);
  project.bundle.documents[0]!.patches.find(patch => patch.format === "html")!.translation = '<p>Jiný @UUID[JournalEntry.source]{Průvodce}.</p><p>Více.</p>';
  const plan = await planEditorialProject(project); expect(plan.documents[0]!.skippedMetadata).toBe(1); expect(plan.documents[0]!.metadata).toEqual([]);
  await importEditorialProject(plan, { documents: ["JournalEntry.source"], ui: [], glossary: false });
  expect(paragraph(await snapshot()).verified).toBeNull();
});
it("stops when a note changes during text persistence and reports partial completion without overwriting the note", async () => {
  let view = await snapshot(); const row = paragraph(view);
  await updateReview(view, row.id, { type: "editorial", state: "meaning", note: "From export" });
  const { project } = await exportEditorialProject("cs");
  state.saved.get("JournalEntry.source").name = "Changed";
  const plan = await planEditorialProject(project), key = editorialKey(view.entry, row.id);
  state.afterWrite = () => { const notes = settings.get("reviewEditorial"); notes.entries[key].note = "Concurrent reviewer"; };
  const result = await importEditorialProject(plan, { documents: ["JournalEntry.source"], ui: [], glossary: false });
  expect(result.issues).toContain("Review.Conflict"); expect(settings.get("reviewEditorial").entries[key].note).toBe("Concurrent reviewer");
});
it("rejects duplicate metadata and prototype keys, and blocks a mechanically changed original", async () => {
  const { project } = await exportEditorialProject("cs");
  const duplicate = structuredClone(project); duplicate.reviews.push(duplicate.reviews[0]!);
  expect(() => parseEditorialProject(JSON.stringify(duplicate))).toThrow("ProjectInvalid");
  const bad = structuredClone(project); bad.ui.push({ scope: "core", key: "__proto__.bad", source: "Hello", value: "Ahoj", base: "Ahoj", at: "2026-09-23", userName: "Alice" });
  expect(() => parseEditorialProject(JSON.stringify(bad))).toThrow("ProjectInvalid");
  const source = sources.get("JournalEntry.source"), data = source.toObject(); data.pages[0].system = { outcomes: [{ id: "win", effect: "changed" }] }; source.toObject = () => data;
  expect((await planEditorialProject(project)).documents[0]!.state).toBe("blocked");
});
