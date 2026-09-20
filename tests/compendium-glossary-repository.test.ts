import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryCompendiumRepository, GLOSSARY_PACK_ID } from "../src/glossary/compendium-repository";
import { NamingCancelledError } from "../src/glossary/name-analysis";
import type { GlossaryEntry } from "../src/glossary/types";

const entry = (index: number): GlossaryEntry => ({ source: `Old Town${index}`, replacement: `Old Town${index}`, aliases: [], category: "location", sourceUuid: `Scene.${index}` });
function fixture(onRequest?: () => void, invalid = false) {
  const records = new Map<string, FoundryCompendiumIndexEntry>();
  let nextId = 1;
  const folder = { id: "folder", name: "Foundry Translate", type: "Compendium" };
  const pack = { collection: GLOSSARY_PACK_ID, folder, locked: false, getIndex: async () => new Map([...records].map(([id, record]) => [id, structuredClone(record)])) };
  const settings: Record<string, unknown> = { provider: "openai-compatible", glossaryAiEnabled: true, openAiBaseUrl: "http://localhost:1234/v1", openAiModel: "hy-mt2-7b", glossaryAiModel: "qwen3.5-9b", targetLanguage: "cs" };
  const request = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "GET") return new Response(JSON.stringify({ data: [{ id: "qwen3.5-9b" }] }));
    onRequest?.();
    if (invalid) return new Response(JSON.stringify({ output: [{ type: "message", content: "not valid JSON" }] }));
    const input = JSON.parse(JSON.parse(init?.body as string).input);
    const decisions = input.candidates.map((candidate: { id: number; name: string }) => ({ id: candidate.id, action: "translate", replacement: candidate.name.replace("Old", "Starý"), roots: [candidate.name.split(" ")[1]], confidence: "high", reason: "Popisné přídavné jméno." }));
    return new Response(JSON.stringify({ output: [{ type: "message", content: JSON.stringify({ decisions }) }] }));
  });
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

describe("AI glossary persistence", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("saves choices once and reuses them on subsequent and simultaneous syncs", async () => {
    const { request } = fixture();
    const repo = new GlossaryCompendiumRepository();
    const results = await Promise.all([repo.sync([entry(0)]), repo.sync([entry(0)])]);
    expect(results[0]?.aiTranslated).toBe(1);
    expect((await repo.loadExisting())[0]?.replacement).toBe("Starý Town0");
    expect(request).toHaveBeenCalledTimes(2); // one model list, one batch
    await repo.sync([entry(0)]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite an edit made while inference is running", async () => {
    const { records } = fixture(() => {
      const record = records.get("1")!;
      const flag = record.flags!["foundry-translate"]!.glossary as Record<string, unknown>;
      flag.replacement = "Ruční překlad";
      flag.customized = true;
    });
    const repo = new GlossaryCompendiumRepository();
    await repo.sync([entry(0)]);
    expect((await repo.loadExisting())[0]?.replacement).toBe("Ruční překlad");
    expect((await repo.loadExisting())[0]?.naming).toBeUndefined();
  });
  it("checkpoints complete batches and resumes remaining names after cancellation", async () => {
    fixture();
    const repo = new GlossaryCompendiumRepository();
    const entries = Array.from({ length: 9 }, (_, i) => entry(i));
    let cancel = false;
    await expect(repo.sync(entries, {
      shouldCancel: () => cancel,
      onProgress: ({ completed }) => { if (completed === 8) cancel = true; },
    })).rejects.toBeInstanceOf(NamingCancelledError);
    expect((await repo.loadExisting()).filter((term) => term.naming)).toHaveLength(8);
    const resumed = await repo.sync(entries);
    expect(resumed.aiTranslated).toBe(1);
    expect((await repo.loadExisting()).filter((term) => term.naming)).toHaveLength(9);
  });
  it("rejects a stale decision when an entry is reclassified during inference", async () => {
    const { records } = fixture(() => {
      const flag = records.get("1")!.flags!["foundry-translate"]!.glossary as Record<string, unknown>;
      flag.category = "character";
    });
    const repo = new GlossaryCompendiumRepository();
    await repo.sync([entry(0)]);
    expect((await repo.loadExisting())[0]?.replacement).toBe("Old Town0");
    expect((await repo.loadExisting())[0]?.naming).toBeUndefined();
  });
  it("preserves names on malformed output and skips AI for Chrome", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { request, settings } = fixture(undefined, true);
      const repo = new GlossaryCompendiumRepository();
      expect((await repo.sync([entry(0)])).aiWarning).toBeTruthy();
      expect((await repo.loadExisting())[0]?.replacement).toBe("Old Town0");
      expect((await repo.loadExisting())[0]?.naming).toBeUndefined();
      settings.provider = "chrome-local";
      request.mockClear();
      await repo.sync([entry(0)]);
      expect(request).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
