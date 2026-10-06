import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { JournalTranslationService } from "../src/translation/journal-service";
import { activeTranslations } from "../src/translation/active-translations";
import { readItemTranslationFlag } from "../src/translation/item";
import { collectEmberCreationItems, collectCrucibleCreationEquipment, creationRuntimeGuard, creationSourceGuard, assertCreationItem, CRUCIBLE_EQUIPMENT_PACK, EMBER_CREATION_PACK, MAX_CREATION_ITEMS, planMissingCreationItems } from "../src/translation/ember-creation-items";

const mock = vi.hoisted(() => ({ translate: vi.fn(), prepare: vi.fn(), create: vi.fn(), glossary: [] as any[], settings: {} as any }));
vi.mock("../src/providers/factory", () => ({ createTranslationProvider: (...args: unknown[]) => {
  mock.create(...args); return { translate: mock.translate, prepare: mock.prepare, cacheIdentity: "creation-test" };
} }));
vi.mock("../src/settings/settings", async original => ({ ...await original<object>(), getTranslatorSettings: () => ({ ...mock.settings }) }));
vi.mock("../src/glossary/compendium-repository", () => ({ GlossaryCompendiumRepository: class {
  async prepareForTranslation() { return structuredClone(mock.glossary); }
  async loadExisting() { return structuredClone(mock.glossary); }
} }));
type Row = Record<string, any>;
let tables: Map<string, Map<string, Row>>, packs: Map<string, any>, documents: Map<string, any>, journals: Map<string, any>;
let writes: { pack: string; data: Row; kind: string }[], nextId: number;
const targetPack = "world.foundry-translate-items";
function stored(pack: string, id: string) {
  const type = pack === EMBER_CREATION_PACK || pack === CRUCIBLE_EQUIPMENT_PACK || pack === targetPack ? "Item" : "JournalEntry", uuid = `Compendium.${pack}.${type}.${id}`;
  if (documents.has(uuid)) return documents.get(uuid);
  const rows = tables.get(pack)!;
  const doc = { id, uuid, documentName: type, parent: null,
    get visible() { return rows.get(id)?.visible !== false; },
    get name() { return rows.get(id)?.name; }, get type() { return rows.get(id)?.type; },
    get flags() { return rows.get(id)?.flags; }, get folder() { return { id: rows.get(id)?.folder }; },
    get system() { return { ...rows.get(id)?.system, constructor: { schema: { fields: { description: { constructor: { name: "HTMLField" } } } } } }; },
    toObject: () => structuredClone(rows.get(id)),
  };
  documents.set(uuid, doc); return doc;
}
function freshDocument(cached: any, row = cached.toObject()) {
  const snapshot = structuredClone(row);
  return { id: cached.id, uuid: cached.uuid, documentName: cached.documentName, parent: null,
    get visible() { return snapshot.visible !== false; }, get name() { return snapshot.name; },
    get type() { return snapshot.type; }, get flags() { return snapshot.flags; }, get folder() { return { id: snapshot.folder }; },
    get system() { return { ...snapshot.system, constructor: { schema: { fields: { description: { constructor: { name: "HTMLField" } } } } } }; },
    toObject: () => structuredClone(snapshot),
  };
}
function makePack(collection: string) {
  tables.set(collection, new Map());
  const pack = { collection, locked: false, folder: { id: "folder" }, setFolder: vi.fn(),
    getIndex: vi.fn(async () => new Map([...tables.get(collection)!].map(([id, row]) => [id, { _id: id, name: row.name, flags: structuredClone(row.flags) }]))),
    getDocument: vi.fn(async (id: string) => tables.get(collection)!.has(id) ? stored(collection, id) : undefined),
    getDocuments: vi.fn(async () => [...tables.get(collection)!.keys()].map(id => stored(collection, id))),
  };
  packs.set(collection, pack); return pack;
}
function source(id: string, type = "ancestry", identifier = id, folder?: string) {
  const row = { _id: id, name: `English ${id}`, type, folder,
    system: { identifier, description: `<p>English paragraph ${id} 3.</p>`, talents: [] as any[], movement: { size: 4, stride: 5 } } };
  tables.get(EMBER_CREATION_PACK)!.set(id, row); return stored(EMBER_CREATION_PACK, id);
}
function journal(id: string, pages: any[]) {
  const doc = { uuid: `JournalEntry.${id}`, documentName: "JournalEntry", visible: true, pages: { contents: pages },
    toObject: () => structuredClone({ name: id, pages }) };
  journals.set(id, doc); return doc;
}
function page(type: string, identifier: string, item?: string) { return { type, visible: true, system: { identifier, item } }; }
function reserve(doc: any, id = "copy", flag: Row = {}) {
  tables.get(targetPack)!.set(id, { _id: id, name: "Corrected copy", type: doc.type, system: { description: "Corrected text" },
    flags: { "foundry-translate": { itemTranslation: { sourceUuid: doc.uuid, targetLanguage: "cs", ...flag } } } });
}
function latestRun() { return activeTranslations.list().at(-1)!; }
const itemWrites = () => writes.filter(write => write.pack === targetPack);
beforeEach(() => {
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  tables = new Map(); packs = new Map(); documents = new Map(); journals = new Map(); writes = []; nextId = 0;
  makePack(EMBER_CREATION_PACK); makePack(targetPack);
  mock.settings = { provider: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", openAiBaseUrl: "http://model.invalid/v1", openAiModel: "test", openAiApiKey: "", worldContext: "" };
  mock.glossary = []; mock.create.mockClear(); mock.prepare.mockReset().mockResolvedValue(undefined);
  mock.translate.mockReset().mockImplementation(async ({ texts }: { texts: string[] }) => texts.map(text => ({ translatedText: text.replaceAll("English", "Český") })));
  const implementation = {
    async createDocuments(data: Row[], { pack }: { pack: string }) {
      return data.map(value => { const id = `created${++nextId}`; tables.get(pack)!.set(id, { ...structuredClone(value), _id: id }); writes.push({ pack, data: structuredClone(value), kind: "create" }); return stored(pack, id); });
    },
    async updateDocuments(data: Row[], { pack }: { pack: string }) {
      return data.map(value => { tables.get(pack)!.set(value._id, structuredClone(value)); writes.push({ pack, data: structuredClone(value), kind: "update" }); return stored(pack, value._id); });
    },
  };
  vi.stubGlobal("foundry", { documents: { JournalEntry: { implementation }, Item: { implementation },
    collections: { CompendiumCollection: { async createCompendium({ name }: { name: string }) { return makePack(`world.${name}`); } } } } });
  vi.stubGlobal("game", { user: { isGM: true }, world: {}, system: { id: "crucible", version: "0.11" }, modules: new Map([["ember", { active: true, version: "0.6" }]]), packs, journal: journals,
    folders: { contents: [{ id: "folder", name: "Foundry Translate", type: "Compendium" }] }, i18n: { localize: (key: string) => key } });
  vi.stubGlobal("fromUuid", vi.fn(async uuid => documents.get(uuid) ?? null));
  vi.stubGlobal("ui", { notifications: { warn: vi.fn() } }); activeTranslations.clearFinished();
});
afterEach(() => {
  for (const run of activeTranslations.list()) { activeTranslations.requestCancel(run.id); activeTranslations.finishCancelled(run.id); }
  activeTranslations.clearFinished(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("Ember creation Item collection", () => {
  it("supports native fresh getDocuments results while fromUuid retains cached Items across preview and Start", async () => {
    const a = source("a"); journal("emberAncestries0", [page("ember.ancestry", "a")]);
    const reads: any[][] = [];
    packs.get(EMBER_CREATION_PACK).getDocuments.mockImplementation(async () => {
      // Foundry caches only absent IDs, but returns each new database result.
      const result = [freshDocument(a)]; reads.push(result); return result;
    });
    const preview = await collectEmberCreationItems(), guard = await creationSourceGuard(preview[0]!);
    const start = await collectEmberCreationItems();
    expect(reads[0]![0]).not.toBe(a); expect(reads[1]![0]).not.toBe(reads[0]![0]);
    expect(preview[0]).toBe(a); expect(start[0]).toBe(a); await guard();
    expect(await new JournalTranslationService().translateMissingItems(preview)).toMatchObject({ createdDocuments: 1 });
  });
  it.each(["canonical-content", "fetched-content", "canonical-permission", "fetched-permission", "canonical-flag", "fetched-flag", "canonical-type", "canonical-uuid"])("rejects mismatching %s instead of canonicalizing it", async reason => {
    const a = source("a"); journal("emberAncestries0", [page("ember.ancestry", "a")]);
    packs.get(EMBER_CREATION_PACK).getDocuments.mockImplementation(async () => {
      const fetched = a.toObject();
      if (reason === "fetched-content") fetched.system.movement.size = 8;
      if (reason === "fetched-permission") fetched.visible = false;
      if (reason === "fetched-flag") fetched.flags = { "foundry-translate": { itemTranslation: {} } };
      if (reason === "canonical-content") tables.get(EMBER_CREATION_PACK)!.get("a")!.system.movement.size = 8;
      if (reason === "canonical-permission") tables.get(EMBER_CREATION_PACK)!.get("a")!.visible = false;
      if (reason === "canonical-flag") tables.get(EMBER_CREATION_PACK)!.get("a")!.flags = { "foundry-translate": { itemTranslation: {} } };
      if (reason === "canonical-type") tables.get(EMBER_CREATION_PACK)!.get("a")!.type = "background";
      if (reason === "canonical-uuid") documents.set(a.uuid, { ...freshDocument(a), uuid: `${a.uuid}other` });
      return [freshDocument(a, fetched)];
    });
    // Unreadable fetched sources are omitted by the native readable selector.
    if (reason === "fetched-permission") expect(await collectEmberCreationItems()).toEqual([]);
    else await expect(collectEmberCreationItems()).rejects.toThrow("InvalidSource");
    expect(writes).toEqual([]); expect(mock.create).not.toHaveBeenCalled();
  });
  it("rechecks an earlier canonical Item after resolving later Items", async () => {
    const a = source("a"), b = source("b"); journal("emberAncestries0", [page("ember.ancestry", "a"), page("ember.ancestry", "b")]);
    packs.get(EMBER_CREATION_PACK).getDocuments.mockResolvedValue([freshDocument(a), freshDocument(b)]);
    vi.mocked(fromUuid).mockImplementation(async uuid => {
      if (uuid === b.uuid) tables.get(EMBER_CREATION_PACK)!.get("a")!.system.movement.size = 8;
      return documents.get(uuid) ?? null;
    });
    await expect(collectEmberCreationItems()).rejects.toThrow("InvalidSource"); expect(writes).toEqual([]);
  });
  it("collects native unique ancestry/culture/path selectors plus one level of explicit talent slots", async () => {
    const a = source("a"), c = source("c", "background"), p = source("p", "background", "p", "emberPaths000000"), t = source("t", "talent"), nested = source("nested", "talent");
    source("other", "background"); source("weapon", "weapon");
    tables.get(EMBER_CREATION_PACK)!.get("a")!.system.talents = [{ item: t.uuid }, { item: "Compendium.other.pack.Item.foreign" }];
    tables.get(EMBER_CREATION_PACK)!.get("t")!.system.talents = [{ item: nested.uuid }];
    journal("emberAncestries0", [page("ember.ancestry", "a")]);
    journal("emberCultures000", [page("ember.culture", "c", "Compendium.ember.character.Item.c")]);
    expect((await collectEmberCreationItems()).map(doc => doc.uuid)).toEqual([a, c, p, t].map(doc => doc.uuid));
    expect(writes).toEqual([]); expect(mock.create).not.toHaveBeenCalled();
  });
  it("does not infer a foreign pack Item with the same ID or a name-only culture match", async () => {
    source("sameId", "talent", "different"); source("name", "background", "different");
    journal("emberAncestries0", [page("ember.ancestry", "missing", "Compendium.ember.character.Item.sameId")]);
    journal("emberCultures000", [page("ember.culture", "missing", "Compendium.ember.character.Item.name")]);
    expect(await collectEmberCreationItems()).toEqual([]);
  });
  it("rejects ambiguous native identifiers instead of choosing a copy", async () => {
    source("a", "background", "culture"); source("b", "background", "culture");
    journal("emberCultures000", [page("ember.culture", "culture", "Compendium.ember.character.Item.source")]);
    await expect(collectEmberCreationItems()).rejects.toThrow("AmbiguousSource");
  });
  it("deduplicates and reserves malformed, partial and duplicate existing identities without writes", async () => {
    const a = source("a"), b = source("b"); reserve(a); reserve(a, "duplicate", { partial: true });
    const plan = await planMissingCreationItems([b, a, b], "cs");
    expect(plan.sources).toEqual([a, b]); expect(plan.missing).toEqual([b]); expect(plan.existing).toBe(1); expect(writes).toEqual([]);
  });
});

describe("creation source guard across Compendium cache rehydration", () => {
  it("accepts a readable rehydrated canonical Item with the identical complete source proof", async () => {
    const a = source("a"), guard = await creationSourceGuard(a);
    documents.set(a.uuid, freshDocument(a)); await guard();
    expect(writes).toEqual([]);
  });
  it.each(["original-content", "canonical-content", "original-permission", "canonical-permission", "original-flag", "canonical-flag", "canonical-type", "canonical-uuid"])("rejects %s after cache rehydration", async reason => {
    const a = source("a"), guard = await creationSourceGuard(a), canonicalRow = a.toObject();
    if (reason === "original-content") tables.get(EMBER_CREATION_PACK)!.get("a")!.system.movement.size = 8;
    if (reason === "original-permission") tables.get(EMBER_CREATION_PACK)!.get("a")!.visible = false;
    if (reason === "original-flag") tables.get(EMBER_CREATION_PACK)!.get("a")!.flags = { "foundry-translate": { itemTranslation: {} } };
    if (reason === "canonical-content") canonicalRow.system.movement.size = 8;
    if (reason === "canonical-permission") canonicalRow.visible = false;
    if (reason === "canonical-flag") canonicalRow.flags = { "foundry-translate": { itemTranslation: {} } };
    if (reason === "canonical-type") canonicalRow.type = "background";
    const canonical = freshDocument(a, canonicalRow);
    if (reason === "canonical-uuid") canonical.uuid += "other";
    documents.set(a.uuid, canonical);
    await expect(guard()).rejects.toThrow(); expect(writes).toEqual([]);
  });
  it("rejects original source mutation during canonical resolution", async () => {
    const a = source("a"), guard = await creationSourceGuard(a), canonical = freshDocument(a);
    vi.mocked(fromUuid).mockImplementation(async () => {
      tables.get(EMBER_CREATION_PACK)!.get("a")!.system.movement.size = 8; return canonical;
    });
    await expect(guard()).rejects.toThrow("SourceChanged"); expect(writes).toEqual([]);
  });
});

describe("missing-only creation Item service", () => {
  it("creates only absent copies, leaving all originals, mechanics, references and existing corrections intact", async () => {
    const a = source("a"), b = source("b", "background"), t = source("t", "talent"); reserve(b, "partial", { partial: true, sourceHash: "stale" });
    const original = tables.get(EMBER_CREATION_PACK)!.get("a")!;
    original.system.talents = [{ item: t.uuid, level: 2 }];
    original.system.description += '<p>@Embed[JournalEntry.untranslated.JournalEntryPage.page overview inline]</p>';
    const before = structuredClone([...tables.get(EMBER_CREATION_PACK)!]), existing = structuredClone(tables.get(targetPack)!.get("partial"));
    const onPlan = vi.fn(), result = await new JournalTranslationService({ onPlan }).translateMissingItems([b, a, t, a]);
    expect(result).toMatchObject({ createdDocuments: 2, skippedDocuments: 1, fallbackTextSegments: 0 });
    expect(onPlan).toHaveBeenCalledWith({ totalDocuments: 2, totalUnits: 2 });
    expect([...tables.get(EMBER_CREATION_PACK)!]).toEqual(before); expect(tables.get(targetPack)!.get("partial")).toEqual(existing);
    const copy = itemWrites().find(write => write.data.flags["foundry-translate"].itemTranslation.sourceUuid === a.uuid)!.data;
    expect(copy.system.talents).toEqual(original.system.talents); expect(copy.system.movement).toEqual(original.system.movement);
    expect(copy.system.description).toContain("Český paragraph a 3."); expect(copy.system.description).toContain("@Embed[JournalEntry.untranslated.JournalEntryPage.page overview inline]");
    expect(itemWrites().every(write => write.kind === "create")).toBe(true);
    expect(writes.every(write => [targetPack, "world.foundry-translate-cache"].includes(write.pack))).toBe(true);
  });
  it("does not contact a provider or repair existing malformed copies when everything already exists", async () => {
    const a = source("a"); reserve(a); reserve(a, "duplicate");
    expect(await new JournalTranslationService().translateMissingItems([a])).toMatchObject({ createdDocuments: 0, skippedDocuments: 1 });
    expect(mock.create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it("rejects an oversized plan before provider preparation or writes", async () => {
    const sources = Array.from({ length: MAX_CREATION_ITEMS + 1 }, (_, index) => source(`a${index}`));
    await expect(new JournalTranslationService().translateMissingItems(sources)).rejects.toThrow("TooMany");
    expect(mock.create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it.each(["permission", "world", "language", "ember", "source"])("does not save an Item when %s changes during the provider request", async reason => {
    const a = source("a");
    mock.translate.mockImplementation(async ({ texts }: { texts: string[] }) => {
      if (reason === "permission") (game as any).user.isGM = false;
      if (reason === "world") (game as any).world = {};
      if (reason === "language") mock.settings.targetLanguage = "de";
      if (reason === "ember") game.modules.get("ember")!.active = false;
      if (reason === "source") tables.get(EMBER_CREATION_PACK)!.get("a")!.system.movement.size = 8;
      return texts.map(text => ({ translatedText: text.replaceAll("English", "Český") }));
    });
    await expect(new JournalTranslationService().translateMissingItems([a])).rejects.toThrow(); expect(itemWrites()).toEqual([]);
  });
  it("fails closed when an existing identity appears during translation, even with malformed flags", async () => {
    const a = source("a");
    mock.translate.mockImplementation(async ({ texts }: { texts: string[] }) => { reserve(a); return texts.map(text => ({ translatedText: text.replaceAll("English", "Český") })); });
    await expect(new JournalTranslationService().translateMissingItems([a])).rejects.toThrow("OutputChanged");
    expect(itemWrites()).toEqual([]); expect(tables.get(targetPack)!.get("copy")!.system.description).toBe("Corrected text");
    expect(readItemTranslationFlag(tables.get(targetPack)!.get("copy")!.flags)).toBeNull();
  });
  it.each(["valid", "malformed"])("rejects a %s identity appearing in the final save index", async kind => {
    const a = source("a"), pack = packs.get(targetPack), getIndex = pack.getIndex.getMockImplementation();
    pack.getIndex.mockImplementation(async (...args: any[]) => {
      if (pack.getIndex.mock.calls.length === 5) reserve(a, "race", kind === "valid" ? {
        schemaVersion: 1, sourceHash: "hash", providerId: "openai-compatible", sourceLanguage: "en", translatedAt: "now", translatedHtmlFields: 1,
      } : {});
      return getIndex(...args);
    });
    await expect(new JournalTranslationService().translateMissingItems([a])).rejects.toThrow("OutputChanged");
    expect(pack.getIndex).toHaveBeenCalledTimes(5); expect(itemWrites()).toEqual([]);
    expect(tables.get(targetPack)!.get("race")!.name).toBe("Corrected copy");
  });
  it.each(["source", "runtime"])("stops %s drift during provider preparation before any cache or Item write", async reason => {
    const a = source("a");
    mock.prepare.mockImplementation(async () => {
      if (reason === "source") tables.get(EMBER_CREATION_PACK)!.get("a")!.system.description = "Changed source";
      if (reason === "runtime") mock.settings.targetLanguage = "de";
    });
    await expect(new JournalTranslationService().translateMissingItems([a])).rejects.toThrow();
    expect(mock.translate).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it.each(["source", "language", "permission", "glossary", "cancel"])("rejects %s drift during the final repository index await before creating an Item", async reason => {
    const a = source("a"), pack = packs.get(targetPack), getIndex = pack.getIndex.getMockImplementation();
    pack.getIndex.mockImplementation(async (...args: any[]) => {
      if (pack.getIndex.mock.calls.length === 5) {
        if (reason === "source") tables.get(EMBER_CREATION_PACK)!.get("a")!.system.movement.size = 8;
        if (reason === "language") mock.settings.targetLanguage = "de";
        if (reason === "permission") (game as any).user.isGM = false;
        if (reason === "glossary") mock.glossary = [{ source: "New", replacement: "Nový", category: "other", aliases: [], enabled: true }];
        if (reason === "cancel") activeTranslations.requestCancel(latestRun().id);
      }
      return getIndex(...args);
    });
    await expect(new JournalTranslationService().translateMissingItems([a])).rejects.toThrow();
    expect(pack.getIndex).toHaveBeenCalledTimes(5); expect(itemWrites()).toEqual([]);
  });
  it("resumes after provider failure using cached name units and retains the shared busy lock", async () => {
    const a = source("a");
    mock.translate.mockImplementation(async ({ texts }: { texts: string[] }) => {
      if (texts.some(text => text.includes("paragraph"))) throw new Error("Model offline");
      return texts.map(text => ({ translatedText: text.replaceAll("English", "Český") }));
    });
    await expect(new JournalTranslationService().translateMissingItems([a])).rejects.toThrow("Model offline"); expect(itemWrites()).toEqual([]);
    mock.translate.mockReset().mockImplementation(async ({ texts }: { texts: string[] }) => texts.map(text => ({ translatedText: text.replaceAll("English", "Český") })));
    await new JournalTranslationService().translateMissingItems([a]);
    expect(mock.translate.mock.calls.flatMap(([request]) => request.texts)).not.toContain("English a"); expect(itemWrites()).toHaveLength(1);
  });
  it("pauses at a saved-cache boundary and refuses a concurrent translation until resumed", async () => {
    const a = source("a"), b = source("b"); let paused = false;
    const pending = new JournalTranslationService({ onProgress: () => { if (!paused) { paused = true; activeTranslations.requestPause(latestRun().id); } } }).translateMissingItems([a, b]);
    await vi.waitFor(() => expect(latestRun().pausedAt).toBeDefined());
    await expect(new JournalTranslationService().translateMissingItems([b])).rejects.toThrow("AlreadyRunning");
    expect(itemWrites()).toEqual([]); activeTranslations.resume(latestRun().id);
    expect((await pending).createdDocuments).toBe(2);
  });
  it("cancels between saved Items and a new run skips the completed copy", async () => {
    const a = source("a"), b = source("b");
    const unsubscribe = activeTranslations.subscribe(() => { const run = latestRun(); if (run?.completedDocuments === 1 && !run.finishedAt) activeTranslations.requestCancel(run.id); });
    await expect(new JournalTranslationService().translateMissingItems([a, b])).rejects.toThrow(/zrušen/); unsubscribe();
    expect(itemWrites()).toHaveLength(1);
    const result = await new JournalTranslationService().translateMissingItems([a, b]); expect(result).toMatchObject({ createdDocuments: 1, skippedDocuments: 1 });
  });
});

function equipment(id: string, price: unknown = 100, type = "weapon", category = "blade") {
  const row = { _id: id, name: `English ${id}`, type, system: { price, category, description: `<p>English equipment ${id} 3.</p>`,
    damage: 5, references: [{ item: "Compendium.other.pack.Item.untouched" }] } };
  tables.get(CRUCIBLE_EQUIPMENT_PACK)!.set(id, row); return stored(CRUCIBLE_EQUIPMENT_PACK, id);
}
function equipmentSetup() {
  makePack(CRUCIBLE_EQUIPMENT_PACK);
  Object.assign(game.system!, { CONFIG: { packs: { equipment: new Set([CRUCIBLE_EQUIPMENT_PACK, "other.equipment"]) } },
    CONST: { ACTOR: { STARTING_EQUIPMENT_BUDGET: 2500 } } });
  vi.stubGlobal("crucible", game.system);
}

describe("separate missing starting equipment scope", () => {
  beforeEach(equipmentSetup);
  it("matches native positive-price/budget/non-scroll selection in exactly the base equipment pack", async () => {
    const cheap = equipment("cheap", 1), equal = equipment("equal", 2500), fraction = equipment("fraction", 22.5, "armor");
    equipment("too-expensive", 2500.01); equipment("free", 0); equipment("negative", -1); equipment("string", "100");
    equipment("nan", NaN); equipment("infinity", Infinity); equipment("missing"); delete tables.get(CRUCIBLE_EQUIPMENT_PACK)!.get("missing")!.system.price;
    equipment("scroll", 20, "consumable", "scroll"); const potion = equipment("potion", 20, "consumable", "potion");
    equipment("hidden", 10); tables.get(CRUCIBLE_EQUIPMENT_PACK)!.get("hidden")!.visible = false;
    equipment("translated", 10); tables.get(CRUCIBLE_EQUIPMENT_PACK)!.get("translated")!.flags = { "foundry-translate": { itemTranslation: { schemaVersion: 1, sourceUuid: cheap.uuid, targetLanguage: "cs", sourceLanguage: "en", sourceHash: "hash", providerId: "openai-compatible", translatedAt: "now", translatedHtmlFields: 1, fallbackTextSegments: 0 } } };
    const foreign = makePack("other.equipment"); foreign.getDocuments.mockResolvedValue([equipment("foreign-in-other-pack")]);
    tables.get(CRUCIBLE_EQUIPMENT_PACK)!.delete("foreign-in-other-pack");
    expect((await collectCrucibleCreationEquipment()).map(doc => doc.uuid)).toEqual([cheap, equal, fraction, potion].map(doc => doc.uuid).sort());
    expect(foreign.getDocuments).not.toHaveBeenCalled(); expect(writes).toEqual([]); expect(mock.create).not.toHaveBeenCalled();
  });
  it("retains default creation scope and rejects mixed, foreign, embedded and translated sources", async () => {
    const item = equipment("a"), creation = source("ancestry");
    await expect(planMissingCreationItems([item], "cs")).rejects.toThrow("InvalidSource");
    await expect(planMissingCreationItems([creation], "cs", "equipment")).rejects.toThrow("InvalidEquipmentSource");
    for (const bad of [{ ...freshDocument(item), uuid: "Compendium.other.equipment.Item.a" }, { ...freshDocument(item), parent: {} },
      { ...freshDocument(item), documentName: "Actor" }, { ...freshDocument(item), visible: false },
      { ...freshDocument(item), flags: { "foundry-translate": { itemTranslation: {} } } }]) {
      expect(() => assertCreationItem(bad as any, "equipment")).toThrow("InvalidEquipmentSource");
    }
    expect(mock.create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it("rejects invalid scope before reading output or contacting the provider, including an empty batch", async () => {
    const item = equipment("a");
    expect(() => creationRuntimeGuard("other" as any)).toThrow("InvalidScope");
    await expect(planMissingCreationItems([], "cs", "other" as any)).rejects.toThrow("InvalidScope");
    await expect(new JournalTranslationService().translateMissingItems([item], "other" as any)).rejects.toThrow("InvalidScope");
    expect(mock.create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it.each(["no-config", "foreign-only", "missing-pack", "invalid-budget", "different-global"])("fails closed on unsupported native equipment runtime: %s", async reason => {
    equipment("a"); const runtime = game.system as any;
    if (reason === "no-config") delete runtime.CONFIG;
    if (reason === "foreign-only") runtime.CONFIG.packs.equipment = new Set(["other.equipment"]);
    if (reason === "missing-pack") packs.delete(CRUCIBLE_EQUIPMENT_PACK);
    if (reason === "invalid-budget") runtime.CONST.ACTOR.STARTING_EQUIPMENT_BUDGET = NaN;
    if (reason === "different-global") vi.stubGlobal("crucible", { ...runtime });
    await expect(collectCrucibleCreationEquipment()).rejects.toThrow(); expect(mock.create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it("accepts fully equal fresh getDocuments/cache instances without mutating any source", async () => {
    const item = equipment("a"); packs.get(CRUCIBLE_EQUIPMENT_PACK).getDocuments.mockResolvedValue([freshDocument(item)]);
    expect(await collectCrucibleCreationEquipment()).toEqual([item]); const check = await creationSourceGuard(item, "equipment");
    documents.set(item.uuid, freshDocument(item)); await check(); expect(writes).toEqual([]);
  });
  it.each(["canonical-price", "fetched-content", "canonical-permission", "canonical-uuid", "duplicate-id", "earlier-source-change"])(
    "rejects %s before allowing a starting equipment plan", async reason => {
      const a = equipment("a"), b = equipment("b");
      const fetched = freshDocument(a);
      packs.get(CRUCIBLE_EQUIPMENT_PACK).getDocuments.mockResolvedValue(reason === "duplicate-id" ? [fetched, freshDocument(a)] : [fetched, freshDocument(b)]);
      if (reason === "canonical-price") tables.get(CRUCIBLE_EQUIPMENT_PACK)!.get("a")!.system.price = 101;
      if (reason === "fetched-content") { const row = a.toObject(); row.system.damage = 8; packs.get(CRUCIBLE_EQUIPMENT_PACK).getDocuments.mockResolvedValue([freshDocument(a, row)]); }
      if (reason === "canonical-permission") tables.get(CRUCIBLE_EQUIPMENT_PACK)!.get("a")!.visible = false;
      if (reason === "canonical-uuid") documents.set(a.uuid, { ...freshDocument(a), uuid: "Compendium.crucible.equipment.Item.other" });
      if (reason === "earlier-source-change") vi.mocked(fromUuid).mockImplementation(async uuid => {
        if (uuid === b.uuid) tables.get(CRUCIBLE_EQUIPMENT_PACK)!.get("a")!.system.damage = 8; return documents.get(uuid) ?? null;
      });
      await expect(collectCrucibleCreationEquipment()).rejects.toThrow(); expect(writes).toEqual([]);
    });
  it("rejects more than256 native candidates before any provider preparation", async () => {
    Array.from({ length: MAX_CREATION_ITEMS + 1 }, (_, i) => equipment(`a${i}`));
    await expect(collectCrucibleCreationEquipment()).rejects.toThrow("TooMany");
    await expect(new JournalTranslationService().translateMissingItems([...documents.values()].filter(doc => doc.uuid.startsWith("Compendium.crucible.equipment.")), "equipment")).rejects.toThrow("TooMany");
    expect(mock.create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it("creates only missing equipment, preserving every reserved correction and original price/mechanics/reference", async () => {
    const a = equipment("a"), b = equipment("b", 2500), c = equipment("c"); reserve(b, "manual"); reserve(b, "duplicate", { partial: true }); reserve(c, "partial", { partial: true, sourceHash: "old" });
    const before = structuredClone([...tables.get(CRUCIBLE_EQUIPMENT_PACK)!]), copies = structuredClone([...tables.get(targetPack)!]);
    const result = await new JournalTranslationService().translateMissingItems([a, b, c], "equipment");
    expect(result).toMatchObject({ createdDocuments: 1, skippedDocuments: 2 }); expect(itemWrites()).toHaveLength(1);
    expect(itemWrites()[0]!.kind).toBe("create"); expect(itemWrites()[0]!.data.system).toMatchObject({ price: 100, damage: 5, references: a.toObject().system.references });
    expect(itemWrites()[0]!.data.system.description).toBe("<p>Český equipment a 3.</p>");
    expect([...tables.get(CRUCIBLE_EQUIPMENT_PACK)!]).toEqual(before);
    for (const [id, copy] of copies) expect(tables.get(targetPack)!.get(id)).toEqual(copy);
  });
  it("does not contact a provider when every equipment identity is reserved, including malformed copies", async () => {
    const a = equipment("a"); reserve(a);
    expect(await new JournalTranslationService().translateMissingItems([a], "equipment")).toMatchObject({ createdDocuments: 0, skippedDocuments: 1 });
    expect(mock.create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
  });
  it.each(["price", "scroll", "visibility", "budget", "pack-config", "pack-instance", "source", "permission", "copy-race"])(
    "blocks %s changes during the provider request before any Item write", async reason => {
      const a = equipment("a"); mock.translate.mockImplementation(async ({ texts }: { texts: string[] }) => {
        const data = tables.get(CRUCIBLE_EQUIPMENT_PACK)!.get("a")!, runtime = game.system as any;
        if (reason === "price") data.system.price = 101;
        if (reason === "scroll") { data.type = "consumable"; data.system.category = "scroll"; }
        if (reason === "visibility") data.visible = false;
        if (reason === "budget") runtime.CONST.ACTOR.STARTING_EQUIPMENT_BUDGET = 3000;
        if (reason === "pack-config") runtime.CONFIG.packs.equipment.add("new.equipment");
        if (reason === "pack-instance") packs.set(CRUCIBLE_EQUIPMENT_PACK, { ...packs.get(CRUCIBLE_EQUIPMENT_PACK) });
        if (reason === "source") data.system.damage = 8;
        if (reason === "permission") (game as any).user.isGM = false;
        if (reason === "copy-race") reserve(a);
        return texts.map(text => ({ translatedText: text.replaceAll("English", "Český") }));
      });
      await expect(new JournalTranslationService().translateMissingItems([a], "equipment")).rejects.toThrow(); expect(itemWrites()).toEqual([]);
    });
});
