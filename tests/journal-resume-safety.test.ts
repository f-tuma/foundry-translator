import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../src/constants";
import { JournalTranslationService } from "../src/translation/journal-service";
import { activeTranslations } from "../src/translation/active-translations";
import { readJournalTranslationFlag, type JournalData } from "../src/translation/journal";

const mock = vi.hoisted(() => ({
  translate: vi.fn(), glossary: [] as unknown[],
  provider: "chrome-local", identity: "resume-test",
}));
vi.mock("../src/providers/factory", () => ({ createTranslationProvider: () => ({
  translate: mock.translate, cacheIdentity: mock.identity, async testConnection() {},
}) }));
vi.mock("../src/settings/settings", async (original) => ({
  ...await original<object>(),
  getTranslatorSettings: () => ({ provider: mock.provider, sourceLanguage: "en", targetLanguage: "cs" }),
}));
vi.mock("../src/glossary/compendium-repository", () => ({ GlossaryCompendiumRepository: class {
  async prepareForTranslation() { return structuredClone(mock.glossary); }
} }));

type Stored = Record<string, any>;
let packs: Map<string, any>;
let tables: Map<string, Map<string, Stored>>;
let writes: { pack: string; data: Stored }[];
let source: JournalData;
let sourceDoc: any;
let sourceActors: any[];
let nextId: number;

const translate = async ({ texts }: { texts: string[] }) => texts.map(text => ({ translatedText: text.replaceAll("English", "Český") }));
function storedDocument(pack: string, id: string) {
  const rows = tables.get(pack)!;
  const kind = pack.endsWith("actors") ? "Actor" : pack.endsWith("items") ? "Item" : "JournalEntry";
  return {
    id, uuid: `Compendium.${pack}.${kind}.${id}`, documentName: kind,
    get name() { return rows.get(id)?.name; },
    get flags() { return rows.get(id)?.flags; },
    toObject: () => structuredClone(rows.get(id)),
  };
}
function makePack(name: string) {
  const collection = `world.${name}`;
  tables.set(collection, new Map());
  const pack = {
    collection, locked: false, folder: { id: "folder" },
    async setFolder() {},
    async getIndex() { return new Map([...tables.get(collection)!].map(([id, data]) => [id, { _id: id, name: data.name, flags: structuredClone(data.flags) }])); },
    async getDocument(id: string) { return tables.get(collection)!.has(id) ? storedDocument(collection, id) : undefined; },
  };
  packs.set(collection, pack);
  return pack;
}
function rootCopy() { return [...(tables.get("world.foundry-translate-translations")?.values() ?? [])][0]; }
function latestRun() { return activeTranslations.list().at(-1)!; }
function contentWrites() { return writes.filter(write => write.pack === "world.foundry-translate-translations"); }

beforeEach(() => {
  const { document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  packs = new Map(); tables = new Map(); writes = []; nextId = 0; sourceActors = [];
  mock.glossary = []; mock.identity = "resume-test"; mock.provider = "chrome-local";
  mock.translate.mockReset().mockImplementation(translate);
  source = { name: "English Guide", pages: [1, 2, 3].map(id => ({ _id: `page${id}`, name: `English Page ${id}`, type: "text", text: { format: 1, content: `<p>English paragraph ${id}.</p>` } })) };
  sourceDoc = { id: "source", uuid: "JournalEntry.source", documentName: "JournalEntry", name: source.name, toObject: () => structuredClone(source) };
  const implementation = {
    async createDocuments(data: Stored[], { pack }: { pack: string }) {
      return data.map(value => {
        const id = value._id ?? `id${++nextId}`;
        tables.get(pack)!.set(id, { ...structuredClone(value), _id: id });
        writes.push({ pack, data: structuredClone(value) });
        return storedDocument(pack, id);
      });
    },
    async updateDocuments(data: Stored[], { pack }: { pack: string }) {
      return data.map(value => {
        tables.get(pack)!.set(value._id, structuredClone(value));
        writes.push({ pack, data: structuredClone(value) });
        return storedDocument(pack, value._id);
      });
    },
  };
  vi.stubGlobal("foundry", { documents: {
    JournalEntry: { implementation }, Actor: { implementation }, Item: { implementation },
    collections: { CompendiumCollection: { async createCompendium({ name }: { name: string }) { return makePack(name); } } },
  } });
  vi.stubGlobal("game", {
    user: { isGM: true }, packs, folders: { contents: [{ id: "folder", name: "Foundry Translate", type: "Compendium" }] },
    i18n: { localize: (key: string) => key },
  });
  vi.stubGlobal("ui", { notifications: { warn: vi.fn(), info: vi.fn() } });
  vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => {
    if (uuid === sourceDoc.uuid) return sourceDoc;
    const actor = sourceActors.find(actor => actor.uuid === uuid);
    if (actor) return actor;
    for (const [pack, rows] of tables) for (const id of rows.keys()) {
      const doc = storedDocument(pack, id);
      if (doc.uuid === uuid) return doc;
    }
    return null;
  }));
  activeTranslations.clearFinished();
});
afterEach(() => {
  for (const run of activeTranslations.list()) {
    activeTranslations.requestCancel(run.id);
    activeTranslations.finishCancelled(run.id);
  }
  activeTranslations.clearFinished();
  vi.unstubAllGlobals();
});

async function interruptAfterFirstPage() {
  const service = new JournalTranslationService({ onProgress: progress => {
    if (progress.completedPages === 1) activeTranslations.requestCancel(latestRun().id);
  } });
  await expect(service.translate(sourceDoc)).rejects.toThrow(/zrušen/);
  expect(readJournalTranslationFlag(rootCopy()?.flags)?.processedPageIds).toEqual(["page1"]);
}

describe("saved translation continuation", () => {
  it("continues after cancellation using saved pages even if the unit cache was lost", async () => {
    await interruptAfterFirstPage();
    const firstPage = structuredClone(rootCopy()!.pages[0]);
    tables.get("world.foundry-translate-cache")!.clear();
    mock.translate.mockClear();
    const result = await new JournalTranslationService().translate(sourceDoc);
    expect(result.data.pages[0]).toEqual(firstPage);
    const requests = mock.translate.mock.calls.flatMap(([request]) => request.texts);
    expect(requests.some(text => /English Page 1|English paragraph 1/.test(text))).toBe(false);
    expect(requests.some(text => /English paragraph 2/.test(text))).toBe(true);
    expect(result.data.pages.every(page => page.text!.content!.includes("Český"))).toBe(true);
    expect(readJournalTranslationFlag(result.data.flags)).toMatchObject({ partial: false, translatedTextPages: 3 });
    expect(tables.get("world.foundry-translate-translations")!.size).toBe(1);
  });

  it("pauses after saving a page, blocks a second job, then continues the same job", async () => {
    const job = new JournalTranslationService({ onProgress: progress => {
      if (progress.completedPages === 1) activeTranslations.requestPause(latestRun().id);
    } }).translate(sourceDoc);
    await vi.waitFor(() => expect(latestRun()?.pausedAt).toBeDefined());
    expect(readJournalTranslationFlag(rootCopy()!.flags)?.processedPageIds).toEqual(["page1"]);
    const calls = mock.translate.mock.calls.length;
    await expect(new JournalTranslationService().translate(sourceDoc)).rejects.toThrow("AlreadyRunning");
    expect(mock.translate.mock.calls.length).toBe(calls);
    activeTranslations.resume(latestRun().id);
    await expect(job).resolves.toMatchObject({ reused: false });
    expect(readJournalTranslationFlag(rootCopy()!.flags)?.partial).toBe(false);
  });

  it("can cancel a paused job without deadlock and retain the saved page", async () => {
    const job = new JournalTranslationService({ onProgress: progress => {
      if (progress.completedPages === 1) activeTranslations.requestPause(latestRun().id);
    } }).translate(sourceDoc);
    const expectation = expect(job).rejects.toThrow(/zrušen/);
    await vi.waitFor(() => expect(latestRun()?.pausedAt).toBeDefined());
    activeTranslations.requestCancel(latestRun().id);
    await expectation;
    expect(readJournalTranslationFlag(rootCopy()!.flags)?.processedPageIds).toEqual(["page1"]);
  });

  it("saves the complete four-page LM Studio batch before pausing", async () => {
    mock.provider = "openai-compatible";
    source.pages = Array.from({ length: 7 }, (_, index) => ({
      _id: `page${index + 1}`, name: `English Page ${index + 1}`, type: "text",
      text: { format: 1, content: `<p>English paragraph ${index + 1}.</p>` },
    }));
    const job = new JournalTranslationService({ onProgress: progress => {
      if (progress.completedPages === 4) activeTranslations.requestPause(latestRun().id);
    } }).translate(sourceDoc);
    await vi.waitFor(() => expect(latestRun()?.pausedAt).toBeDefined());
    expect(readJournalTranslationFlag(rootCopy()!.flags)?.processedPageIds).toEqual(["page1", "page2", "page3", "page4"]);
    expect(mock.translate.mock.calls.flatMap(([request]) => request.texts).join(" ")).not.toContain("paragraph 5");
    activeTranslations.resume(latestRun().id);
    await expect(job).resolves.toMatchObject({ translatedTextPages: 7 });
    expect(readJournalTranslationFlag(rootCopy()!.flags)?.partial).toBe(false);
  });

  it.each(["source", "glossary", "provider"])("blocks incompatible %s changes without writing over the saved checkpoint", async change => {
    await interruptAfterFirstPage();
    const saved = structuredClone(rootCopy());
    const count = contentWrites().length;
    if (change === "source") source.pages[1]!.text!.content = "<p>English changed</p>";
    if (change === "glossary") mock.glossary = [{ source: "Gate", replacement: "Brána", category: "place", aliases: [] }];
    if (change === "provider") mock.identity = "another-model";
    await expect(new JournalTranslationService().translate(sourceDoc)).rejects.toThrow("IncompatibleExisting");
    expect(contentWrites()).toHaveLength(count);
    expect(rootCopy()).toEqual(saved);
  });

  it("protects a manually edited unfinished copy", async () => {
    await interruptAfterFirstPage();
    rootCopy()!.pages[0].text.content = "<p>Moje ruční oprava</p>";
    const saved = structuredClone(rootCopy());
    const count = contentWrites().length;
    await expect(new JournalTranslationService().translate(sourceDoc)).rejects.toThrow("EditedPartial");
    expect(rootCopy()).toEqual(saved);
    expect(contentWrites()).toHaveLength(count);
  });

  it("reuses completed manual corrections without regeneration or restamping them", async () => {
    await new JournalTranslationService().translate(sourceDoc);
    rootCopy()!.pages[0].text.content = "<p>Moje ruční oprava</p>";
    const saved = structuredClone(rootCopy());
    const count = contentWrites().length;
    mock.translate.mockClear();
    const result = await new JournalTranslationService().translate(sourceDoc);
    expect(result.reused).toBe(true);
    expect(rootCopy()).toEqual(saved);
    expect(contentWrites()).toHaveLength(count);
    expect(mock.translate).not.toHaveBeenCalled();
    expect(latestRun().issues.some(issue => issue.type === "protected")).toBe(true);
  });

  it("detects an edit made while paused before saving the next batch", async () => {
    const job = new JournalTranslationService({ onProgress: progress => {
      if (progress.completedPages === 1) activeTranslations.requestPause(latestRun().id);
    } }).translate(sourceDoc);
    const expectation = expect(job).rejects.toThrow("OutputChanged");
    await vi.waitFor(() => expect(latestRun()?.pausedAt).toBeDefined());
    rootCopy()!.pages[0].text.content = "<p>Oprava za běhu</p>";
    const saved = structuredClone(rootCopy());
    activeTranslations.resume(latestRun().id);
    await expectation;
    expect(rootCopy()).toEqual(saved);
  });

  it("detects a deleted checkpoint and does not recreate it over the user's action", async () => {
    const job = new JournalTranslationService({ onProgress: progress => {
      if (progress.completedPages === 1) activeTranslations.requestPause(latestRun().id);
    } }).translate(sourceDoc);
    const expectation = expect(job).rejects.toThrow("OutputChanged");
    await vi.waitFor(() => expect(latestRun()?.pausedAt).toBeDefined());
    tables.get("world.foundry-translate-translations")!.clear();
    activeTranslations.resume(latestRun().id);
    await expectation;
    expect(rootCopy()).toBeUndefined();
  });
});

describe("failures and dependent documents", () => {
  it("retains a checkpoint after provider failure and continues with a fresh service", async () => {
    mock.translate.mockImplementation(async request => {
      if (request.texts.some((text: string) => text.includes("paragraph 2"))) throw new Error("LM Studio offline");
      return translate(request);
    });
    await expect(new JournalTranslationService().translate(sourceDoc)).rejects.toThrow("LM Studio offline");
    expect(readJournalTranslationFlag(rootCopy()!.flags)?.processedPageIds).toEqual(["page1"]);
    mock.translate.mockImplementation(translate);
    const result = await new JournalTranslationService().translate(sourceDoc);
    expect(readJournalTranslationFlag(result.data.flags)?.partial).toBe(false);
  });

  it("does not overwrite a source change made while paused", async () => {
    const job = new JournalTranslationService({ onProgress: progress => {
      if (progress.completedPages === 1) activeTranslations.requestPause(latestRun().id);
    } }).translate(sourceDoc);
    const expectation = expect(job).rejects.toThrow(/během překladu změnil/);
    await vi.waitFor(() => expect(latestRun()?.pausedAt).toBeDefined());
    const saved = structuredClone(rootCopy());
    source.pages[1]!.text!.content = "<p>English new source paragraph</p>";
    activeTranslations.resume(latestRun().id);
    await expectation;
    expect(rootCopy()).toEqual(saved);
  });

  it("preserves a manually corrected Actor dependency and its metadata", async () => {
    const actorData = { name: "English Scout", type: "npc", system: { description: "<p>English biography</p>" } };
    sourceActors.push({ id: "scout", uuid: "Actor.scout", documentName: "Actor", name: actorData.name, type: "npc", toObject: () => structuredClone(actorData) });
    source.pages[0]!.text!.content += " @UUID[Actor.scout]";
    await new JournalTranslationService().translate(sourceDoc);
    const actorRows = tables.get("world.foundry-translate-actors")!;
    expect(actorRows.size).toBe(1);
    const actor = [...actorRows.values()][0]!;
    actor.name = "Moje opravené jméno";
    const saved = structuredClone(actor);
    const before = writes.length;
    mock.translate.mockClear();
    await new JournalTranslationService().translate(sourceDoc);
    expect([...actorRows.values()][0]).toEqual(saved);
    expect(writes.length).toBe(before);
    expect(mock.translate).not.toHaveBeenCalled();
  });

  it("refuses to replace a copy created elsewhere while the first batch was translating", async () => {
    let createdElsewhere = false;
    mock.translate.mockImplementation(async request => {
      if (!createdElsewhere) {
        createdElsewhere = true;
        tables.get("world.foundry-translate-translations")!.set("elsewhere", {
          _id: "elsewhere", name: "Jiný překlad", pages: [], flags: { [MODULE_ID]: { translation: {
            schemaVersion: 1, engineRevision: 11, sourceUuid: sourceDoc.uuid, sourceHash: "other", providerId: "chrome-local",
            sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedTextPages: 0, skippedTextPages: 0,
          } } },
        });
      }
      return translate(request);
    });
    await expect(new JournalTranslationService().translate(sourceDoc)).rejects.toThrow("OutputChanged");
    expect(rootCopy()!.name).toBe("Jiný překlad");
    expect(contentWrites()).toHaveLength(0);
  });
});
