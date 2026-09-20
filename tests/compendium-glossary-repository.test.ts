import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryCompendiumRepository, GLOSSARY_PACK_ID } from "../src/glossary/compendium-repository";
import { GlossarySyncCancelledError } from "../src/glossary/types";
import { planGlossaryImport } from "../src/glossary/files";
import type { GlossaryEntry } from "../src/glossary/types";
import { glossaryLive } from "../src/glossary/live";

const entry = (index: number): GlossaryEntry => ({ source: `Old Town${index}`, replacement: `Old Town${index}`, aliases: [], category: "location", sourceUuid: `Scene.${index}` });
function fixture() {
  const records = new Map<string, FoundryCompendiumIndexEntry>();
  let nextId = 1;
  const folder = { id: "folder", name: "Foundry Translate", type: "Compendium" };
  const pack = { collection: GLOSSARY_PACK_ID, folder, locked: false, getIndex: async () => new Map([...records].map(([id, record]) => [id, structuredClone(record)])) };
  const settings: Record<string, unknown> = { provider: "openai-compatible", glossaryAiEnabled: true, openAiBaseUrl: "http://localhost:1234/v1", openAiModel: "hy-mt2-7b", glossaryAiModel: "qwen3.5-9b", targetLanguage: "cs" };
  const request = vi.fn();
  const updateDocuments = vi.fn(async (documents: FoundryJournalEntryData[]) => {
    for (const doc of documents) records.set(doc._id as string, structuredClone(doc) as FoundryCompendiumIndexEntry);
    return [];
  });
  vi.stubGlobal("document", parseHTML("<html></html>").document);
  vi.stubGlobal("game", { user: { isGM: true }, settings: { get: (_namespace: string, key: string) => settings[key] },
    i18n: { localize: (key: string) => key }, folders: { contents: [folder] }, packs: new Map([[GLOSSARY_PACK_ID, pack]]), actors: { contents: [] }, scenes: { contents: [] }, journal: { contents: [] } });
  vi.stubGlobal("foundry", { utils: { fetchWithTimeout: request }, documents: { JournalEntry: { implementation: {
    createDocuments: async (documents: FoundryJournalEntryData[]) => {
      for (const doc of documents) { const id = String(nextId++); records.set(id, { ...structuredClone(doc), _id: id }); }
      return [];
    }, updateDocuments,
  } } } });
  return { records, request, updateDocuments, settings };
}

describe("manual glossary persistence", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("never calls a naming model, including worlds with the former feature enabled", async () => {
    const { request } = fixture();
    const repo = new GlossaryCompendiumRepository();
    const results = await Promise.all([repo.sync([entry(0)]), repo.sync([entry(0)])]);
    expect(results.map((r) => r.created)).toEqual([1, 0]);
    expect(request).not.toHaveBeenCalled();
    expect((await repo.loadExisting())[0]?.replacement).toBe("Old Town0");
    expect(glossaryLive.state.entries).toHaveLength(1);
  });
  it("keeps legacy decisions and manual edits during discovery", async () => {
    fixture();
    const repo = new GlossaryCompendiumRepository();
    await repo.sync([entry(0)]);
    const initial = (await repo.loadExisting())[0]!;
    await repo.saveEntry({ ...initial, replacement: "Starý Town0", customized: true, notes: "Schváleno" });
    await repo.sync([entry(0)]);
    expect((await repo.loadExisting())[0]).toMatchObject({ replacement: "Starý Town0", notes: "Schváleno", customized: true });
  });
  it("imports only selected rows and keeps identity, context link and unrelated entries", async () => {
    fixture();
    const repo = new GlossaryCompendiumRepository();
    await repo.sync([entry(0), entry(1)]);
    const stored = await repo.loadExisting();
    const rows = planGlossaryImport(stored, { language: "cs", entries: [{ ...entry(0), replacement: "Starý Town0", notes: "Ručně schváleno" }, entry(2)] }, "cs");
    await repo.importEntries(rows.filter((row) => row.state === "changed"));
    const after = await repo.loadExisting();
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: stored[0]?.id, sourceUuid: "Scene.0", replacement: "Starý Town0", customized: true, notes: "Ručně schváleno" });
    await repo.sync([entry(0)]);
    expect((await repo.loadExisting())[0]?.replacement).toBe("Starý Town0");
  });
  it("refuses stale updates and newly conflicting names inside the write queue", async () => {
    const { updateDocuments } = fixture();
    const repo = new GlossaryCompendiumRepository();
    await repo.sync([entry(0)]);
    const stored = await repo.loadExisting();
    const rows = planGlossaryImport(stored, { language: "cs", entries: [{ ...entry(0), replacement: "Import" }] }, "cs");
    await repo.saveEntry({ ...stored[0]!, replacement: "New manual choice", customized: true });
    updateDocuments.mockClear();
    await expect(repo.importEntries(rows)).rejects.toThrow("Stale");
    expect(updateDocuments).not.toHaveBeenCalled();
    const newRows = planGlossaryImport([], { language: "cs", entries: [entry(1)] }, "cs");
    await repo.sync([entry(1)]);
    await expect(repo.importEntries(newRows)).rejects.toThrow("Stale");
  });
  it("rejects alias conflicts before writing any part of the import", async () => {
    const { updateDocuments } = fixture();
    const repo = new GlossaryCompendiumRepository();
    await repo.sync([entry(0)]);
    const rows = planGlossaryImport(await repo.loadExisting(), { language: "cs", entries: [{ ...entry(1), replacement: "Conflict", aliases: ["old town0"] }] }, "cs");
    await expect(repo.importEntries(rows)).rejects.toThrow("AliasConflict");
    expect(updateDocuments).not.toHaveBeenCalled();
    expect(await repo.loadExisting()).toHaveLength(1);
  });
  it("persists imported inflection through reload and synchronization", async () => {
    fixture();
    const repo = new GlossaryCompendiumRepository();
    await repo.sync([entry(0)]);
    const old = (await repo.loadExisting())[0]!;
    const rows = planGlossaryImport([old], {language:"cs",entries:[{...old,mode:"inflect",enabled:true}]},"cs");
    await repo.importEntries(rows);
    await repo.sync([entry(0)]);
    expect((await repo.loadExisting())[0]).toMatchObject({mode:"inflect",enabled:true,customized:true});
  });
  it("can clear notes and checks cancellation, GM access and locked packs", async () => {
    fixture();
    const repo = new GlossaryCompendiumRepository();
    await expect(repo.sync([entry(0)], { shouldCancel: () => true })).rejects.toBeInstanceOf(GlossarySyncCancelledError);
    expect(await repo.loadExisting()).toHaveLength(0);
    await repo.sync([entry(0)]);
    await repo.saveEntry({ ...(await repo.loadExisting())[0]!, notes: "Delete me" });
    await repo.saveEntry({ ...(await repo.loadExisting())[0]!, notes: "" });
    expect((await repo.loadExisting())[0]?.notes).toBe("");
    game.packs.get(GLOSSARY_PACK_ID)!.locked = true;
    await expect(repo.saveEntry(entry(1))).rejects.toThrow("zamčené");
  });
});
