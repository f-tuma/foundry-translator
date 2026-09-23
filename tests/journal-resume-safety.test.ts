import { loadReview, reviewCatalog, saveReviewRows, updateReview } from "../src/review/service";
import { isEditorProtected, readEditorProtection } from "../src/translation/editor-protection";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../src/constants";
import { JournalTranslationService } from "../src/translation/journal-service";
import { exportTranslationBundle, importTranslationBundle, planBundleImport } from "../src/bundles/service";
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
  async loadExisting() { return structuredClone(mock.glossary); }
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
    update: async (patch: Stored) => {
      const data = rows.get(id)!;
      function apply(target: Stored, values: Stored) {
        for (const [key, value] of Object.entries(values)) {
          const path = key.split("."); let obj = target;
          for (const part of path.slice(0, -1)) obj = obj[part] ??= {};
          obj[path.at(-1)!] = structuredClone(value);
        }
      }
      const { pages, items, ...root } = patch; apply(data, root);
      for (const [collection, changes] of [[data.pages, pages], [data.items, items]]) for (const change of changes ?? []) apply(collection.find((entry: Stored) => entry._id === change._id), change);
    },
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
    user: { isGM: true }, system: { id: "crucible", version: "0.11.0" }, packs, folders: { contents: [{ id: "folder", name: "Foundry Translate", type: "Compendium" }] },
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

describe("scene and effect display translation", () => {
  function displaySource(kind: "Scene" | "ActiveEffect") {
    const data: Stored = { _id: `source${kind}`, name: "English Name", flags: { ember: { automation: "unchanged" } },
      ...(kind === "Scene" ? { active: true, tokens: [{ actorId: "a", name: "Untouched" }], navName: "English Navigation" }
        : { description: "<p>English protection.</p>", disabled: false, changes: [{ key: "system.defense", value: "2" }], duration: { seconds: 30 } }),
    };
    const doc = { id: data._id, uuid: `${kind}.${data._id}`, name: data.name, documentName: kind, toObject: () => structuredClone(data) };
    sourceActors.push(doc);
    return { data, doc };
  }
  it("translates both dependencies while retaining original UUIDs and mechanical data", async () => {
    vi.stubGlobal("Hooks", { callAll: vi.fn() });
    const scene = displaySource("Scene"), effect = displaySource("ActiveEffect");
    source.pages[0]!.text!.content = `<p>English @UUID[${scene.doc.uuid}] @UUID[${effect.doc.uuid}]</p>`;
    const before = JSON.stringify([scene.doc.toObject(), effect.doc.toObject()]);
    const result = await new JournalTranslationService().translate(sourceDoc);
    expect(result.processedDocuments).toBe(3);
    expect(result.dependencyWarnings).toEqual([]);
    expect(result.data.pages[0]!.text!.content).toContain(`@UUID[${scene.doc.uuid}]`);
    expect(result.data.pages[0]!.text!.content).toContain(`@UUID[${effect.doc.uuid}]`);
    expect(JSON.stringify([scene.doc.toObject(), effect.doc.toObject()])).toBe(before);
    const rows = tables.get("world.foundry-translate-display-text")!;
    expect(rows.size).toBe(2);
    const record = [...rows.values()].find(row => row.flags[MODULE_ID].displayTranslation.documentType === "Scene")!;
    record.pages[0].text.content = "<p>Ruční Úprava</p>";
    mock.translate.mockClear();
    const repeated = await new JournalTranslationService().translate(sourceDoc);
    expect(repeated.reusedDocuments).toBe(3);
    expect(mock.translate).not.toHaveBeenCalled();
    expect(record.pages[0].text.content).toContain("Ruční Úprava");
  });
  it("stops a source text change before saving", async () => {
    vi.stubGlobal("Hooks", { callAll: vi.fn() });
    const { data, doc } = displaySource("Scene");
    mock.translate.mockImplementation(async (request: { texts: string[] }) => {
      data.name = "Changed Name";
      return translate(request);
    });
    await expect(new JournalTranslationService().translateDisplay(doc)).rejects.toThrow("IncompatibleExisting");
    expect(tables.get("world.foundry-translate-display-text")?.size ?? 0).toBe(0);
  });
  it("stops on duplicate or malformed stored claims instead of silently creating another translation", async () => {
    vi.stubGlobal("Hooks", { callAll: vi.fn() });
    const { doc } = displaySource("ActiveEffect");
    await new JournalTranslationService().translateDisplay(doc);
    const rows = tables.get("world.foundry-translate-display-text")!;
    const [id, record] = [...rows][0]!;
    rows.set("duplicate", structuredClone(record));
    await expect(new JournalTranslationService().translateDisplay(doc)).rejects.toThrow("Duplicate");
    rows.delete("duplicate");
    record.flags[MODULE_ID].displayTranslation.fields[0].path = ["system", "damage"];
    await expect(new JournalTranslationService().translateDisplay(doc)).rejects.toThrow("Invalid");
    expect([...rows.keys()]).toEqual([id]);
  });
  it("exports and imports scene/effect text offline, without source writes or clone UUIDs", async () => {
    vi.stubGlobal("Hooks", { callAll: vi.fn() });
    const scene = displaySource("Scene"), effect = displaySource("ActiveEffect");
    const before = JSON.stringify([scene.data, effect.data]);
    await new JournalTranslationService().translateDisplay(scene.doc);
    await new JournalTranslationService().translateDisplay(effect.doc);
    const { bundle, skipped } = await exportTranslationBundle("cs");
    expect(skipped).toEqual([]);
    expect(bundle.version).toBe(3);
    expect(bundle.documents.map(d => d.kind)).toEqual(["Scene", "ActiveEffect"]);
    expect(JSON.stringify(bundle)).not.toMatch(/automation|disabled|duration|actorId/);
    tables.get("world.foundry-translate-display-text")!.clear();
    mock.translate.mockClear();
    const plan = await planBundleImport(bundle);
    expect(plan.rows.map(r => r.state)).toEqual(["ready", "ready"]);
    const result = await importTranslationBundle(plan);
    expect(result).toMatchObject({ imported: 2, issues: [] });
    expect(mock.translate).not.toHaveBeenCalled();
    expect(JSON.stringify([scene.data, effect.data])).toBe(before);
    const repeated = await importTranslationBundle(plan);
    expect(repeated).toMatchObject({ imported: 0, skipped: 2, issues: [] });
    expect((await exportTranslationBundle("cs")).bundle.documents).toEqual(bundle.documents);
    // Portable imports have no local provider identity, but can still be reused safely.
    expect((await new JournalTranslationService().translateDisplay(effect.doc)).reused).toBe(true);
    expect(mock.translate).not.toHaveBeenCalled();
    const invalid = structuredClone(bundle);
    invalid.documents[0]!.patches.push({ path: ["flags", "ember", "automation"], format: "text", source: "unchanged", translation: "changed" });
    expect((await planBundleImport(invalid)).rows[0]!.state).toBe("invalid");
    const incomplete = structuredClone(bundle);
    incomplete.documents[0]!.partial = true;
    expect((await planBundleImport(incomplete)).rows[0]!.state).toBe("invalid");
  });
  it("checks the write guard when another translation appears during generation", async () => {
    vi.stubGlobal("Hooks", { callAll: vi.fn() });
    const { doc } = displaySource("Scene");
    await new JournalTranslationService().translateDisplay(doc);
    const rows = tables.get("world.foundry-translate-display-text")!;
    const saved = structuredClone([...rows.values()][0]!);
    rows.clear();
    tables.get("world.foundry-translate-cache")!.clear();
    mock.translate.mockImplementation(async (request: { texts: string[] }) => {
      rows.set("otherGM", { ...saved, _id: "otherGM" });
      return translate(request);
    });
    await expect(new JournalTranslationService().translateDisplay(doc)).rejects.toThrow("OutputChanged");
    expect([...rows.keys()]).toEqual(["otherGM"]);
  });

  it("discovers embedded effects without an explicit journal link, preserving the copied effect data", async () => {
    vi.stubGlobal("Hooks", { callAll: vi.fn() });
    const effect = displaySource("ActiveEffect");
    const actorData = { name: "English Actor", type: "adversary", system: {}, effects: [effect.data] };
    const actor = { id: "carrier", uuid: "Actor.carrier", name: actorData.name, documentName: "Actor",
      effects: { contents: [effect.doc] }, toObject: () => structuredClone(actorData) };
    sourceActors.push(actor);
    source.pages[0]!.text!.content = "<p>English @UUID[Actor.carrier]</p>";
    const result = await new JournalTranslationService().translate(sourceDoc);
    expect(result.processedDocuments).toBe(3);
    expect(tables.get("world.foundry-translate-display-text")!.size).toBe(1);
    expect([...tables.get("world.foundry-translate-actors")!.values()][0]!.effects).toEqual(actorData.effects);
  });

});

async function correctCheckpoint() {
  const snapshot = await loadReview((await reviewCatalog("cs")).find(entry => entry.sourceUuid === sourceDoc.uuid)!);
  const paragraph = snapshot.rows.find(row => row.group === "pages:page1" && row.label === "text.content")!;
  const name = snapshot.rows.find(row => row.group === "document" && row.label === "name")!;
  const corrected = await saveReviewRows(snapshot, [{ rowId: paragraph.id, parts: ["Ručně opravený odstavec."] }, { rowId: name.id, parts: ["Můj Průvodce"] }]);
  return updateReview(corrected, paragraph.id, { type: "verify" });
}
describe("editor-protected continuation", () => {
  it("continues a cancelled book with corrected title and paragraph, keeping verification and history", async () => {
    await interruptAfterFirstPage();
    rootCopy()!.flags.otherModule = { note: "Keep this module state" };
    rootCopy()!.ownership = { default: 0 };
    const edited = await correctCheckpoint();
    expect(edited.protection).toBe("tracked");
    expect(edited.rows.filter(row => row.protected)).toHaveLength(2);
    tables.get("world.foundry-translate-cache")!.clear(); mock.translate.mockClear();
    const result = await new JournalTranslationService().translate(sourceDoc);
    expect(result.data.flags!.otherModule).toEqual({ note: "Keep this module state" });
    expect(result.data.ownership).toEqual({ default: 0 });
    expect(result.data.name).toBe("Můj Průvodce");
    expect(result.data.pages[0]!.text!.content).toBe("<p>Ručně opravený odstavec.</p>");
    expect(readJournalTranslationFlag(result.data.flags)?.partial).toBe(false);
    expect(await isEditorProtected(result.data, readJournalTranslationFlag(result.data.flags)!.sourceHash, readJournalTranslationFlag(result.data.flags)!.outputHash)).toBe(true);
    const reviewed = await loadReview(edited.entry);
    expect(reviewed.rows.find(row => row.protected && row.group === "pages:page1")?.verified).toBeTruthy();
    expect(result.data.flags![MODULE_ID]!.reviewHistory).toBeTruthy();
    expect(mock.translate.mock.calls.flatMap(([request]) => request.texts).join(" ")).not.toContain("paragraph 1");
    mock.translate.mockClear(); await new JournalTranslationService().translate(sourceDoc); expect(mock.translate).not.toHaveBeenCalled();
  });
  it("accepts editor corrections while paused, including their separate verification", async () => {
    const job = new JournalTranslationService({ onProgress: progress => {
      if (progress.completedPages === 1) activeTranslations.requestPause(latestRun().id);
    } }).translate(sourceDoc);
    await vi.waitFor(() => expect(latestRun()?.pausedAt).toBeDefined());
    await correctCheckpoint(); activeTranslations.resume(latestRun().id);
    const result = await job;
    expect(result.data.name).toBe("Můj Průvodce");
    expect(result.data.pages[0]!.text!.content).toBe("<p>Ručně opravený odstavec.</p>");
    expect(readEditorProtection(result.data)?.rows).toBeTruthy();
  });
  it.each(["before", "after"])("does not bless an unrelated change made %s an editor correction", async when => {
    await interruptAfterFirstPage();
    if (when === "before") rootCopy()!.pages[1]!.name = "Nesledovaná změna";
    await correctCheckpoint();
    if (when === "after") rootCopy()!.pages[1]!.name = "Nesledovaná změna";
    const saved = structuredClone(rootCopy()); mock.translate.mockClear();
    await expect(new JournalTranslationService().translate(sourceDoc)).rejects.toThrow("EditedPartial");
    expect(rootCopy()).toEqual(saved); expect(mock.translate).not.toHaveBeenCalled();
  });
  it("still rejects changed glossary and source after a tracked correction", async () => {
    await interruptAfterFirstPage(); await correctCheckpoint();
    source.pages[1]!.text!.content = "<p>Changed original.</p>";
    const saved = structuredClone(rootCopy());
    await expect(new JournalTranslationService().translate(sourceDoc)).rejects.toThrow("IncompatibleExisting");
    expect(rootCopy()).toEqual(saved);
  });
});
it("rewrites links in new pages while preserving corrected fields and their review proof", async () => {
  const actorData = { name: "English Scout", type: "npc", system: { description: "<p>English biography</p>" } };
  sourceActors.push({ id: "scout", uuid: "Actor.scout", documentName: "Actor", name: actorData.name, type: "npc", toObject: () => structuredClone(actorData) });
  source.pages[1]!.text!.content += " @UUID[Actor.scout]";
  await interruptAfterFirstPage(); const edited = await correctCheckpoint();
  const result = await new JournalTranslationService().translate(sourceDoc);
  expect(result.data.pages[1]!.text!.content).toContain("@UUID[Compendium.world.foundry-translate-actors.Actor.");
  expect(result.data.pages[0]!.text!.content).toBe("<p>Ručně opravený odstavec.</p>");
  expect((await loadReview(edited.entry)).rows.find(row => row.protected && row.group === "pages:page1")?.verified).toBeTruthy();
  expect(await isEditorProtected(result.data, readJournalTranslationFlag(result.data.flags)!.sourceHash, readJournalTranslationFlag(result.data.flags)!.outputHash)).toBe(true);
});
