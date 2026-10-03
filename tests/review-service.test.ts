import { saveReviewRows, readReviewHistory, reviewHistory, undoReview } from "../src/review/service";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadReview, reviewCatalog, updateReview, type ReviewSnapshot } from "../src/review/service";
import { journalSourceHash, type JournalData } from "../src/translation/journal";
import { hasManualOutputEdits, translatedOutputHash } from "../src/translation/output-hash";
import { MODULE_ID } from "../src/constants";
import { TRANSLATIONS_PACK_ID } from "../src/translation/compendium-translation-repository";
import { DISPLAY_TEXT_PACK, DISPLAY_TEXT_REVISION, displaySourceHash } from "../src/translation/display-text";
import { activeTranslations } from "../src/translation/active-translations";
import { actorSourceHash, type ActorData } from "../src/translation/actor";
import { itemSourceHash, type ItemData } from "../src/translation/item";
import { ACTOR_TRANSLATIONS_PACK_ID } from "../src/translation/compendium-actor-translation-repository";
import { ITEM_TRANSLATIONS_PACK_ID } from "../src/translation/compendium-item-translation-repository";
import { createLiveHandler } from "../src/polish/live-service";
import { GlossaryCompendiumRepository } from "../src/glossary/compendium-repository";

let source: JournalData, copy: JournalData, locked = false;
let writes: { kind: string; patch: any }[];
let sourceDocument: any, copyDocument: any;
let packId: string;
function dotted(data: any, patch: any): void {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.'); let obj = data;
    for (const part of parts.slice(0, -1)) obj = obj[part] ??= {};
    obj[parts.at(-1)!] = structuredClone(value);
  }
}
function install(): void {
  copyDocument = {
    id: "copy", uuid: `Compendium.${packId}.JournalEntry.copy`, get name() { return copy.name; },
    get flags() { return copy.flags; }, toObject: () => structuredClone(copy),
    update: async (patch: any) => {
      writes.push({ kind: "root", patch });
      const { pages, items, ...root } = patch; dotted(copy, root);
      for (const [collection, updates] of [[copy.pages, pages], [copy.items, items]] as any[]) {
        for (const update of updates ?? []) dotted(collection.find((entry: any) => entry._id === update._id), update);
      }
    },
    updateEmbeddedDocuments: async (kind: string, patches: any[]) => {
      writes.push({ kind, patch: patches });
      for (const patch of patches) dotted((kind === "Item" ? copy.items as any[] : copy.pages).find(page => page._id === patch._id), patch);
    },
  };
  sourceDocument = { id: "source", uuid: "JournalEntry.source", documentName: "JournalEntry", toObject: () => structuredClone(source) };
  const pack = { collection: packId, get locked() { return locked; }, getDocument: async () => copyDocument,
    getIndex: async () => new Map([["copy", { _id: "copy", name: copy.name, flags: copy.flags }]]) };
  vi.stubGlobal("game", { user: { isGM: true, id: "gm", name: "Reviewer" }, world: { id: "test-world", title: "Test world" }, settings: { get: () => undefined }, i18n: { localize: (key: string) => key }, packs: new Map([[packId, pack]]) });
  vi.stubGlobal("fromUuid", async () => sourceDocument);
  vi.stubGlobal("Hooks", { callAll: vi.fn() });
}
async function snapshot(): Promise<ReviewSnapshot> { return loadReview((await reviewCatalog("cs")).find(item => item.pack === packId && item.id === "copy")!); }
function textRow(s: ReviewSnapshot) { return s.rows.find(row => row.label === "text.content")!; }

beforeEach(async () => {
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  source = { name: "Guide", pages: [{ _id: "one", name: "Arrival", type: "text", text: { content: '<p>Three-toed feet.</p><p>Second paragraph.</p>', format: 1 } },
    { _id: "two", name: "Later", type: "text", text: { content: '<p>Later.</p>', format: 1 } }] };
  copy = structuredClone(source); copy._id = "copy"; copy.name = "Průvodce";
  copy.pages[0]!.text!.content = '<p>Třínohé končetiny.</p><p>Druhý odstavec.</p>';
  copy.flags = { [MODULE_ID]: { translation: { schemaVersion: 1, engineRevision: 12, sourceUuid: "JournalEntry.source", sourceHash: await journalSourceHash(source),
    providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-09-22", translatedTextPages: 2, skippedTextPages: 0, partial: false } } };
  (copy.flags[MODULE_ID]!.translation as any).outputHash = await translatedOutputHash(copy);
  writes = []; locked = false; packId = TRANSLATIONS_PACK_ID; install();
});
afterEach(() => {
  for (const run of activeTranslations.list()) activeTranslations.finish(run.id);
  activeTranslations.clearFinished(); vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("saves only the translated paragraph, separately verifies it, preserves original and manual-edit protection", async () => {
  const original = JSON.stringify(source), before = await snapshot(); const row = textRow(before);
  const saved = await updateReview(before, row.id, { type: "save", parts: ["Tříprsté nohy."] });
  expect(copy.pages[0]!.text!.content).toBe('<p>Tříprsté nohy.</p><p>Druhý odstavec.</p>');
  expect(writes[0]).toMatchObject({ kind: "root", patch: { pages: [{ _id: "one", "text.content": copy.pages[0]!.text!.content }] } });
  expect(saved.rows.find(r => r.id === row.id)!.verified).toBeNull();
  expect(await hasManualOutputEdits(copy, (copy.flags![MODULE_ID]!.translation as any).outputHash)).toBe(true);
  const verified = await updateReview(saved, row.id, { type: "verify" });
  expect(verified.rows.find(r => r.id === row.id)!.verified).toMatchObject({ userId: "gm", userName: "Reviewer" });
  expect(JSON.stringify(source)).toBe(original);
  const edited = await updateReview(verified, row.id, { type: "save", parts: ["Jeho tříprsté nohy."] });
  expect(edited.rows.find(r => r.id === row.id)!.verified).toBeNull();
});
it("does not make an unedited verified copy look manually edited, and can revoke verification", async () => {
  let view = await snapshot(); const row = textRow(view);
  view = await updateReview(view, row.id, { type: "verify" });
  expect(await hasManualOutputEdits(copy, (copy.flags![MODULE_ID]!.translation as any).outputHash)).toBe(false);
  view = await updateReview(view, row.id, { type: "unverify" });
  expect(view.rows.find(r => r.id === row.id)!.verified).toBeNull();
});
it("invalidates verification on source changes and blocks stale writes without changing drafts", async () => {
  const before = await snapshot(), row = textRow(before);
  await updateReview(before, row.id, { type: "verify" });
  source.pages[0]!.text!.content = '<p>Three legs.</p><p>Second paragraph.</p>';
  const after = await snapshot();
  expect(after.warning).toBe("SourceChanged");
  expect(after.rows.every(row => !row.verified)).toBe(true);
  const count = writes.length;
  await expect(updateReview(before, row.id, { type: "save", parts: ["Nohy."] })).rejects.toThrow("Conflict");
  await expect(updateReview(after, row.id, { type: "verify" })).rejects.toThrow("SourceChanged");
  expect(writes).toHaveLength(count);
});
it("rejects concurrent copy edits, locked compendiums and active translation writes", async () => {
  let before = await snapshot(); const row = textRow(before);
  copy.pages[0]!.text!.content = '<p>Someone else.</p><p>Druhý odstavec.</p>';
  await expect(updateReview(before, row.id, { type: "save", parts: ["Nohy."] })).rejects.toThrow("Conflict");
  before = await snapshot(); locked = true;
  await expect(updateReview(before, row.id, { type: "verify" })).rejects.toThrow("Locked");
  locked = false; activeTranslations.start("Guide", "cs");
  await expect(updateReview(before, row.id, { type: "verify" })).rejects.toThrow("PauseFirst");
  expect(writes).toHaveLength(0);
});
it("uses stable embedded IDs after reordering and excludes unprocessed pages from verification", async () => {
  const flag = copy.flags![MODULE_ID]!.translation as any; flag.partial = true; flag.processedPageIds = ["one"];
  const before = await snapshot(), firstId = textRow(before).id;
  copy.pages.reverse();
  const view = await snapshot();
  expect(textRow(view).id).toBe(firstId);
  expect(view.rows.find(row => row.group === 'pages:two')!.blocked).toBe("Untranslated");
  await expect(updateReview(view, view.rows.find(row => row.group === 'pages:two')!.id, { type: "verify" })).rejects.toThrow("Untranslated");
  await updateReview(view, firstId, { type: "save", parts: ["Tříprsté nohy."] });
  expect(copy.pages.find(page => page._id === "one")!.text!.content).toContain("Tříprsté nohy.");
  expect(copy.pages.find(page => page._id === "two")!.text!.content).toBe('<p>Later.</p>');
});
it("accepts translated copy references but rejects changes to their UUIDs and added commands", async () => {
  source.pages[0]!.text!.content = '<p>Read @UUID[JournalEntry.source]{Guide}.</p>';
  copy.pages[0]!.text!.content = `<p>Čti @UUID[Compendium.${packId}.JournalEntry.copy]{Průvodce}.</p>`;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  let view = await snapshot(), row = textRow(view);
  expect(row.blocked).toBeNull();
  for (const value of ['Čti @UUID[Actor.other].', `Čti @UUID[Compendium.${packId}.JournalEntry.copy]{[[/r 99d6]]}.`]) {
    await expect(updateReview(view, row.id, { type: "save", parts: [value] })).rejects.toThrow("ProtectedText");
  }
  view = await updateReview(view, row.id, { type: "save", parts: [`Přečti si @UUID[Compendium.${packId}.JournalEntry.copy]{Příručku}.`] });
  expect(textRow(view).translation[0]).toContain('{Příručku}');
});
it("allows reviewing an omitted invisible icon placeholder without allowing missing references", async () => {
  source.pages[0]!.text!.content = '<p><span class="reference fa-solid fa-compass">\u200B</span> Read @UUID[JournalEntry.source]{Guide}.</p>';
  copy.pages[0]!.text!.content = `<p><span class="reference fa-solid fa-compass"></span> Čti @UUID[Compendium.${packId}.JournalEntry.copy]{Průvodce}.</p>`;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const original = JSON.stringify(source), view = await snapshot(), row = textRow(view);
  expect(row.blocked).toBeNull();
  expect(row.source).toHaveLength(1);
  expect(row.translation).toHaveLength(1);
  const saved = await updateReview(view, row.id, { type: "save", parts: [`Přečti @UUID[Compendium.${packId}.JournalEntry.copy]{Příručku}.`] });
  expect(textRow(saved).id).toBe(row.id);
  expect(textRow(saved).blocked).toBeNull();
  expect(JSON.stringify(source)).toBe(original);
  expect(copy.pages[0]!.text!.content).toContain('<span class="reference fa-solid fa-compass"></span>');
  copy.pages[0]!.text!.content = '<p><span class="reference fa-solid fa-compass"></span> Přečti příručku.</p>';
  expect(textRow(await snapshot()).blocked).toBe("StructureChanged");
});
it("edits and verifies scene sidecar text without touching the scene mechanics", async () => {
  packId = DISPLAY_TEXT_PACK;
  const scene = { name: "Old Gate", navName: "Gate", width: 8000, walls: [{ _id: "wall", c: [0, 0, 100, 100] }] };
  copy = { name: "Old Gate · cs", pages: [{ _id: "name000000000000", name: "name", type: "text", text: { content: '<p>Stará brána</p>' } }, { _id: "nav0000000000000", name: "navName", type: "text", text: { content: '<p>Brána</p>' } }],
    flags: { [MODULE_ID]: { displayTranslation: { schemaVersion: 1, engineRevision: DISPLAY_TEXT_REVISION, sourceUuid: "Scene.source", documentType: "Scene", sourceHash: await displaySourceHash("Scene", scene),
      providerId: "openai-compatible", targetLanguage: "cs", sourceLanguage: "en", translatedAt: "2026-09-22", glossaryFingerprint: "", providerFingerprint: "", fallbackTextSegments: 0,
      fields: [{ path: ["name"], format: "text", source: "Old Gate", pageId: "name000000000000" }, { path: ["navName"], format: "text", source: "Gate", pageId: "nav0000000000000" }] } } } };
  install(); sourceDocument = { id: "source", uuid: "Scene.source", documentName: "Scene", toObject: () => structuredClone(scene) };
  const before = JSON.stringify(scene); let view = await snapshot(); const row = view.rows[0]!;
  expect(row.translation).toEqual(["Stará brána"]);
  view = await updateReview(view, row.id, { type: "save", parts: ["Stará Brána"] });
  expect(copy.pages[0]!.text!.content).toBe('<p>Stará Brána</p>');
  view = await updateReview(view, row.id, { type: "verify" });
  expect(view.rows[0]!.verified).toBeTruthy();
  expect(JSON.stringify(scene)).toBe(before);
  expect(Hooks.callAll).toHaveBeenCalledWith("foundryTranslateDisplayTextChanged");
});

async function effectReview(content: string) {
  packId = DISPLAY_TEXT_PACK;
  const effect = { name: "Protection", description: "<p>Visit @UUID[Actor.source]{Guide}.</p>", changes: [{ key: "system.health", value: 5 }] };
  copy = { name: "Ochrana", pages: [{ _id: "name000000000000", name: "name", type: "text", text: { content: "<p>Ochrana</p>" } },
    { _id: "desc000000000000", name: "description", type: "text", text: { content } }],
    flags: { [MODULE_ID]: { displayTranslation: { schemaVersion: 1, engineRevision: DISPLAY_TEXT_REVISION,
      sourceUuid: "ActiveEffect.source", documentType: "ActiveEffect", sourceHash: await displaySourceHash("ActiveEffect", effect),
      providerId: "openai-compatible", targetLanguage: "cs", sourceLanguage: "en", translatedAt: "2026-10-03",
      glossaryFingerprint: "", providerFingerprint: "", fallbackTextSegments: 0,
      fields: [{ path: ["name"], format: "text", source: effect.name, pageId: "name000000000000" },
        { path: ["description"], format: "html", source: effect.description, pageId: "desc000000000000" }] } } } };
  install(); sourceDocument = { id: "source", uuid: "ActiveEffect.source", documentName: "ActiveEffect", toObject: () => structuredClone(effect) };
  const catalog = await reviewCatalog("cs");
  catalog.push({ id: "linked", uuid: `Compendium.${ACTOR_TRANSLATIONS_PACK_ID}.Actor.linked`, pack: ACTOR_TRANSLATIONS_PACK_ID,
    name: "Průvodce", kind: "Actor", sourceUuid: "Actor.source", language: "cs" });
  return { effect, snapshot: await loadReview(catalog.find(d => d.kind === "ActiveEffect")!, catalog) };
}

it("reviews effect descriptions with mapped UUIDs instead of discarding them as missing", async () => {
  const { snapshot: view } = await effectReview(`<p>Navštivte @UUID[Compendium.${ACTOR_TRANSLATIONS_PACK_ID}.Actor.linked]{Průvodce}.</p>`);
  const row = view.rows.find(row => row.label === "description")!;
  expect(row.blocked).toBeNull();
  expect(row.translation[0]).toContain("{Průvodce}");
  expect(view.fields.find(f => f.id === row.fieldId)!.integrity).toBeNull();
});

it("retains damaged effect text for diagnosis and still rejects ordinary saves", async () => {
  const { effect, snapshot: view } = await effectReview("<p>Navštivte @UUID[Actor.unrelated]{Průvodce}.</p>");
  const before = JSON.stringify(effect), row = view.rows.find(row => row.label === "description")!;
  expect(row.blocked).toBe("StructureChanged");
  expect(row.translation).toEqual(["Navštivte @UUID[Actor.unrelated]{Průvodce}."]);
  expect(view.fields.find(f => f.id === row.fieldId)!.integrity?.commands.missing).toHaveLength(1);
  await expect(updateReview(view, row.id, { type: "save", parts: ["Jiná věta."] })).rejects.toThrow("StructureChanged");
  expect(writes).toEqual([]); expect(JSON.stringify(effect)).toBe(before);
});

it("distinguishes a genuinely absent effect description page from damaged content", async () => {
  await effectReview("<p>Navštivte @UUID[Actor.source]{Průvodce}.</p>");
  copy.pages.pop();
  const view = await snapshot(), row = view.rows.find(row => row.label === "description")!;
  expect(row.blocked).toBe("MissingField"); expect(row.translation).toEqual([""]);
});

it("writes Ember outcome labels as a schema array and preserves adjacent automation data", async () => {
  const outcomes = [{ id: "win", label: "Victory", effect: { changes: ["grant-item"] } }, { id: "lose", label: "Defeat", effect: { changes: ["damage"] } }];
  source.pages[0] = { _id: "one", name: "Battle", type: "ember.questEvent", system: { outcomes } };
  copy.pages[0] = structuredClone(source.pages[0]);
  (copy.pages[0]!.system!.outcomes as any[])[0].label = "Vítězství";
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  sourceDocument.pages = { contents: [{ id: "one", system: { constructor: { schema: { fields: { outcomes: { element: { fields: { label: { constructor: { name: "StringField" } } } } } } } } } }] };
  const view = await snapshot(); const row = view.rows.find(row => row.label === "system.outcomes.0.label")!;
  await updateReview(view, row.id, { type: "save", parts: ["Výhra"] });
  expect(writes[0]!.patch.pages[0]["system.outcomes"]).toEqual([{ ...outcomes[0], label: "Výhra" }, outcomes[1]]);
  expect((copy.pages[0]!.system!.outcomes as any[])[0].effect).toEqual(outcomes[0]!.effect);
});

it("sorts journal pages with their category in book order, rather than persistence order", async () => {
  source.categories = [{ _id: "late", name: "Later", sort: 200 }, { _id: "early", name: "Introduction", sort: 100 }];
  source.pages[0]!.category = "late"; source.pages[0]!.sort = 200;
  source.pages[1]!.category = "early"; source.pages[1]!.sort = 100;
  copy.categories = structuredClone(source.categories);
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  expect((await snapshot()).groups.map(group => group.id)).toEqual(["document", "categories:early", "pages:two", "categories:late", "pages:one"]);
});

it.each(["Actor", "Item"] as const)("restricts %s editing to schema prose, including embedded item names", async kind => {
  packId = kind === "Actor" ? ACTOR_TRANSLATIONS_PACK_ID : ITEM_TRANSLATIONS_PACK_ID;
  source.type = kind === "Actor" ? "hero" : "weapon";
  source.system = { description: '<p>Original.</p>', damage: 8 };
  source.items = [{ _id: "blade", name: "Sword", system: { damage: 12 } }];
  copy.system = { description: '<p>Překlad.</p>', damage: 8 }; copy.type = source.type;
  copy.items = structuredClone(source.items);
  const hash = kind === "Actor" ? await actorSourceHash(source as unknown as ActorData) : await itemSourceHash(source as unknown as ItemData);
  copy.flags = { [MODULE_ID]: { [kind === "Actor" ? "actorTranslation" : "itemTranslation"]: { schemaVersion: 1, engineRevision: 12, sourceUuid: `${kind}.source`, sourceHash: hash,
    providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-09-22", translatedHtmlFields: 1, fallbackTextSegments: 0 } } };
  install(); sourceDocument.uuid = `${kind}.source`; sourceDocument.documentName = kind;
  copyDocument.uuid = `Compendium.${packId}.${kind}.copy`;
  sourceDocument.system = { constructor: { schema: { fields: { description: { constructor: { name: "HTMLField" } }, damage: { constructor: { name: "NumberField" } } } } } };
  const original = JSON.stringify(source); let view = await snapshot();
  expect(view.rows.some(row => row.label.includes("damage"))).toBe(false);
  const prose = view.rows.find(row => row.label === "system.description")!;
  view = await updateReview(view, prose.id, { type: "save", parts: ["Opravený popis."] });
  expect(writes[0]).toMatchObject({ kind: "root", patch: { "system.description": "<p>Opravený popis.</p>" } });
  if (kind === "Actor") {
    const item = view.rows.find(row => row.group === "items:blade")!;
    await updateReview(view, item.id, { type: "save", parts: ["Meč"] });
    expect(copy.items).toEqual([{ _id: "blade", name: "Meč", system: { damage: 12 } }]);
  }
  expect(JSON.stringify(source)).toBe(original);
});

it("commits multiple paragraphs and durable undo history in one document update", async () => {
  const before = await snapshot(), rows = before.rows.filter(row => row.label === "text.content" && row.group === "pages:one");
  const edited = await saveReviewRows(before, rows.map((row, i) => ({ rowId: row.id, parts: [i === 0 ? "Tříprsté nohy." : "Další odstavec."] })), { id: "batch-one", label: "Feet" });
  expect(writes).toHaveLength(1);
  expect(writes[0]!.patch.pages).toEqual([{ _id: "one", "text.content": "<p>Tříprsté nohy.</p><p>Další odstavec.</p>" }]);
  expect(readReviewHistory(copy.flags)[0]!.rows).toHaveLength(2);
  // Unrelated subsequent edits must survive undo.
  await updateReview(edited, edited.rows.find(row => row.group === "pages:two" && row.label === "name")!.id, { type: "save", parts: ["Později"] });
  await undoReview(before.entry, "batch-one");
  expect(copy.pages[0]!.text!.content).toBe("<p>Třínohé končetiny.</p><p>Druhý odstavec.</p>");
  expect(copy.pages[1]!.name).toBe("Později");
  expect(readReviewHistory(copy.flags).find(item => item.id === "batch-one")!.undoneAt).toBeTruthy();
  await expect(undoReview(before.entry, "batch-one")).rejects.toThrow("UndoConflict");
});
it("refuses unsafe undo and validates every planned paragraph before any write", async () => {
  const before = await snapshot(), row = textRow(before);
  const edited = await saveReviewRows(before, [{ rowId: row.id, parts: ["Nohy."] }], { id: "first" });
  await updateReview(edited, row.id, { type: "save", parts: ["Další ruční oprava."] });
  const count = writes.length;
  await expect(undoReview(before.entry, "first")).rejects.toThrow("UndoConflict");
  const current = await snapshot();
  await expect(saveReviewRows(current, [{ rowId: row.id, parts: ["Jiná věta."] }, { rowId: "missing", parts: ["X"] }])).rejects.toThrow("MissingField");
  expect(writes).toHaveLength(count);
});

it("stores notes outside translated documents and preserves proof, source and output hash", async () => {
  let store: unknown = { version: 1, entries: {} };
  game.settings = { get: () => store, set: vi.fn(async (_ns, _key, value) => { store = value; }), register: vi.fn(), registerMenu: vi.fn() };
  let view = await snapshot(); const id = textRow(view).id;
  view = await updateReview(view, id, { type: "verify" });
  const before = JSON.stringify(copy), original = JSON.stringify(source), count = writes.length;
  view = await updateReview(view, id, { type: "editorial", state: "discussion", note: "Should this be claws?" });
  expect(view.rows.find(row => row.id === id)?.editorial).toMatchObject({ state: "discussion", note: "Should this be claws?" });
  expect(view.rows.find(row => row.id === id)?.verified).not.toBeNull();
  expect(JSON.stringify(copy)).toBe(before); expect(JSON.stringify(source)).toBe(original); expect(writes).toHaveLength(count);
  view = await updateReview(view, id, { type: "save", parts: ["Tříprsté končetiny."] });
  const updated = view.rows.find(row => row.id === id)!;
  expect(updated.editorial?.fingerprint).not.toBe(updated.fingerprint); expect(updated.verified).toBeNull();
  await expect(updateReview({ ...view, rows: view.rows.map(row => ({ ...row, editorial: null })) }, id, { type: "editorial", state: "none", note: "" })).rejects.toThrow("Conflict");
});
it("rejects notes when the underlying document changed since opening", async () => {
  game.settings = { get: () => undefined, set: vi.fn(), register: vi.fn(), registerMenu: vi.fn() };
  const view = await snapshot(); copy.name = "Externally changed";
  await expect(updateReview(view, textRow(view).id, { type: "editorial", state: "meaning", note: "note" })).rejects.toThrow("Conflict");
  expect(game.settings.set).not.toHaveBeenCalled();
});
it("saves, verifies and undoes reference movement across formatted text fragments", async () => {
  source.pages[0]!.text!.content = '<p>Meet @UUID[Actor.a]{A} <strong>before</strong> @Embed[JournalEntry.b inline]{B}.</p>';
  copy.pages[0]!.text!.content = '<p>Potkej @UUID[Actor.a]{Áčko} <strong>před</strong> @Embed[JournalEntry.b inline]{Béčko}.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const original = JSON.stringify(source), before = copy.pages[0]!.text!.content;
  let view = await snapshot(); const row = textRow(view);
  view = await saveReviewRows(view, [{ rowId: row.id, parts: ['@Embed[JournalEntry.b inline]{Béčka} potkáš ', 'před', ' @UUID[Actor.a]{Áčkem}.'] }], { id: 'move-links' });
  expect(textRow(view).blocked).toBeNull();
  expect(copy.pages[0]!.text!.content).toBe('<p>@Embed[JournalEntry.b inline]{Béčka} potkáš <strong>před</strong> @UUID[Actor.a]{Áčkem}.</p>');
  view = await updateReview(view, row.id, { type: 'verify' });
  expect(textRow(view).verified).toBeTruthy();
  await undoReview(view.entry, 'move-links');
  expect(copy.pages[0]!.text!.content).toBe(before);
  expect(JSON.stringify(source)).toBe(original);
});

async function liveFixture() {
  vi.spyOn(GlossaryCompendiumRepository.prototype, 'loadExisting').mockResolvedValue([]);
  let connected = true;
  const handle = createLiveHandler('cs', () => connected);
  const s = await snapshot(), row = textRow(s);
  const call = (method: string, args: Record<string, unknown> = {}) => handle({ id: crypto.randomUUID(), method, args });
  const context = await call('get_context', { documentId: s.entry.uuid, rowId: row.id });
  expect(context.ok).toBe(true);
  const args = { documentId: s.entry.uuid, rowId: row.id, revision: (context.value as any).revision,
    text: ['Tříprsté nohy.'], labels: [], reason: 'Přesnější anatomický význam původní věty.', operationId: crypto.randomUUID() };
  return { s, row, call, args, disconnect: () => { connected = false; } };
}
it('MCP corrects resolver fallback prose with guarded history and undo while preserving the expression', async () => {
  source.pages[0]!.text!.content = '<p>@ref[actor.name]{Watcher} waits near the gate.</p>';
  copy.pages[0]!.text!.content = '<p>@ref[actor.name]{Strážce čeká u brány.}</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const original = JSON.stringify(source), before = copy.pages[0]!.text!.content;
  const f = await liveFixture();
  expect(await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id })).toMatchObject({
    ok: true, value: { edit: { references: [[{ editable: true, label: 'Strážce čeká u brány.' }]] } },
  });
  const args = { ...f.args, text: ['U brány čeká ⟦1⟧.'], labels: [{ marker: '⟦1⟧', label: 'Strážce' }] };
  expect((await f.call('validate_correction', args)).ok).toBe(true);
  expect(await f.call('save_correction', args)).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toBe('<p>U brány čeká @ref[actor.name]{Strážce}.</p>');
  expect(textRow(await snapshot()).blocked).toBeNull();
  expect(textRow(await snapshot()).verified).toBeNull();
  await undoReview(f.s.entry, args.operationId);
  expect(copy.pages[0]!.text!.content).toBe(before);
  expect(JSON.stringify(source)).toBe(original);
});
it('MCP previews and directly saves with history, resolves lost-response retries, and safely undoes', async () => {
  const original = JSON.stringify(source), f = await liveFixture();
  const preview = await f.call('validate_correction', f.args); expect(preview.ok).toBe(true); expect(writes).toHaveLength(0);
  const saved = await f.call('save_correction', f.args); expect(saved).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toContain('Tříprsté nohy.');
  const count = writes.length;
  expect(await f.call('save_correction', f.args)).toMatchObject({ ok: true, value: { alreadyApplied: true } }); expect(writes).toHaveLength(count);
  const history = readReviewHistory(copy.flags); expect(history[0]).toMatchObject({ id: f.args.operationId, agentRequestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(await f.call('save_correction', { ...f.args, text: ['Úplně jiná věta.'] })).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
  expect(await f.call('undo_correction', { documentId: f.s.entry.uuid, operationId: f.args.operationId })).toMatchObject({ ok: true, value: { undone: true } });
  expect(copy.pages[0]!.text!.content).toContain('Třínohé končetiny.');
  const afterUndo = writes.length;
  expect(await f.call('undo_correction', { documentId: f.s.entry.uuid, operationId: f.args.operationId })).toMatchObject({ ok: true, value: { alreadyUndone: true } });
  expect(writes).toHaveLength(afterUndo); expect(JSON.stringify(source)).toBe(original);
});
it('MCP reads only the original reference attached to the fresh paragraph, even without a translated copy', async () => {
  source.pages[0]!.text!.content = '<p>Read @UUID[Item.path]{Path}.</p>';
  copy.pages[0]!.text!.content = '<p>Přečtěte si @UUID[Item.wrong]{Cestu}.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : uuid === 'Item.path' ? {
    uuid, documentName: 'Item', toObject: () => ({ name: 'Path', system: { description: '<p>A life of travel.</p>', health: 5 }, flags: { private: 'secret' } }),
    system: { constructor: { schema: { fields: { description: { constructor: { name: 'HTMLField' } } } } } },
  } : null);
  const f = await liveFixture();
  const context = await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id });
  expect(context).toMatchObject({ ok: true, value: { blocked: 'StructureChanged', sourceReferences: [{ index: 0, sourceUuid: 'Item.path' }] } });
  const result = await f.call('get_reference_context', { documentId: f.s.entry.uuid, rowId: f.row.id, referenceIndex: 0 });
  expect(result).toMatchObject({ ok: true, value: { sourceUuid: 'Item.path', total: 2, fields: [{ text: 'Path' }, { text: '<p>A life of travel.</p>' }] } });
  expect(JSON.stringify(result)).not.toMatch(/health|secret|private/);
  expect(await f.call('get_reference_context', { documentId: f.s.entry.uuid, rowId: f.row.id, referenceIndex: 1 })).toMatchObject({ ok: false, error: { code: 'Live.ReferenceUnavailable' } });
  expect(await f.call('get_reference_context', { documentId: 'JournalEntry.source', rowId: f.row.id, referenceIndex: 0 })).toMatchObject({ ok: false, error: { code: 'Review.TranslationMissing' } });
  f.disconnect();
  expect(await f.call('get_reference_context', { documentId: f.s.entry.uuid, rowId: f.row.id, referenceIndex: 0 })).toMatchObject({ ok: false, error: { code: 'Live.Disconnected' } });
  expect(writes).toEqual([]);
});

it('MCP refuses stale revisions, arbitrary original reads, invalid links, and revoked world access', async () => {
  const f = await liveFixture();
  expect(await f.call('get_context', { documentId: 'JournalEntry.source', rowId: f.row.id })).toMatchObject({ ok: false, error: { code: 'Review.TranslationMissing' } });
  expect(await f.call('save_correction', { ...f.args, text: ['Nohy. @Macro[delete]'] })).toMatchObject({ ok: false, error: { code: 'Review.ProtectedText', fieldId: f.row.fieldId } });
  copy.pages[0]!.text!.content = '<p>Ruční oprava.</p><p>Druhý odstavec.</p>';
  expect(await f.call('save_correction', f.args)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  expect(writes).toHaveLength(0); f.disconnect();
  expect(await f.call('list_documents')).toMatchObject({ ok: false, error: { code: 'Live.Disconnected' } });
});
it('MCP retains EXACT terms and refuses numeric changes and active translation writes', async () => {
  const f = await liveFixture();
  vi.mocked(GlossaryCompendiumRepository.prototype.loadExisting).mockResolvedValue([{ source: 'Three-toed', replacement: 'Třínohé', category: 'term', aliases: [] }]);
  const context = await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id });
  const args = { ...f.args, revision: (context.value as any).revision };
  expect(await f.call('save_correction', args)).toMatchObject({ ok: false, error: { code: 'Live.InvalidCorrection' } });
  expect(await f.call('save_correction', { ...args, text: ['Třínohé končetiny mají 4 prsty.'] })).toMatchObject({ ok: false, error: { code: 'Live.NumbersChanged' } });
  activeTranslations.start('Guide', 'cs');
  expect(await f.call('save_correction', { ...args, text: ['Třínohé končetiny poutníka.'] })).toMatchObject({ ok: false, error: { code: 'Review.PauseFirst' } });
  expect(writes).toHaveLength(0);
});
it('MCP undo refuses later manual corrections, and disconnect is checked immediately before persistence', async () => {
  const f = await liveFixture();
  await expect(saveReviewRows(f.s, [{ rowId: f.row.id, parts: ['Nohy.'] }], { canWrite: () => false })).rejects.toThrow('Live.Disconnected');
  expect(writes).toHaveLength(0);
  expect((await f.call('save_correction', f.args)).ok).toBe(true);
  copy.pages[0]!.text!.content = '<p>Ruční pozdější oprava.</p><p>Druhý odstavec.</p>';
  const count = writes.length;
  expect(await f.call('undo_correction', { documentId: f.s.entry.uuid, operationId: f.args.operationId })).toMatchObject({ ok: false, error: { code: 'Review.UndoConflict' } });
  expect(await f.call('save_correction', f.args)).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
  expect(writes).toHaveLength(count);
});
it('aligns source/target paragraphs when an inline comma becomes whitespace without changing markup', async () => {
  source.pages[0]!.text!.content = '<p>Hello <strong>hero</strong>,<em>friend</em>.</p>';
  copy.pages[0]!.text!.content = '<p>Ahoj <strong>hrdino</strong> <em>příteli</em>.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const s = await snapshot(), row = textRow(s);
  expect(row.source).toHaveLength(5); expect(row.translation).toHaveLength(4); expect(row.blocked).toBeNull();
  const saved = await saveReviewRows(s, [{ rowId: row.id, parts: ['Zdravím ', 'hrdino', 'příteli', '.'] }]);
  expect(saved.rows.find(r => r.id === row.id)?.blocked).toBeNull();
});

it('MCP explicitly restores wrong chapter numbers only to the complete source multiset, with history and retry binding', async () => {
  source.pages[0]!.text!.content = '<p>Unlike Chapter 2, Chapter 3 quests can occur simultaneously.</p>';
  copy.pages[0]!.text!.content = '<p>Na rozdíl od 3. kapitoly mohou úkoly probíhat současně.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const f = await liveFixture(), text = ['Na rozdíl od 2. kapitoly mohou úkoly 3. kapitoly probíhat současně.'];
  const args = { ...f.args, text, restoreSourceNumbers: true, reason: 'Originál rozlišuje kapitoly 2 a 3; překlad nesprávně obsahoval jen 3.' };
  expect(await f.call('validate_correction', args)).toMatchObject({ ok: true, value: { numberRepair: { allowed: true, requested: true, source: ['2', '3'], before: ['3'], after: ['2', '3'] } } });
  expect(writes).toHaveLength(0);
  expect(await f.call('save_correction', { ...args, restoreSourceNumbers: false })).toMatchObject({ ok: false, error: { code: 'Live.NumbersChanged' } });
  expect(await f.call('save_correction', { ...args, text: ['Kapitoly 2 a 4.'] })).toMatchObject({ ok: false, error: { code: 'Live.InvalidNumberRepair' } });
  expect(writes).toHaveLength(0);
  const original = JSON.stringify(source);
  expect(await f.call('save_correction', args)).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toContain(text[0]);
  expect(JSON.stringify(source)).toBe(original);
  expect(readReviewHistory(copy.flags)[0]?.label).toContain(args.reason);
  expect(await f.call('save_correction', args)).toMatchObject({ ok: true, value: { alreadyApplied: true } });
  expect(await f.call('save_correction', { ...args, restoreSourceNumbers: false })).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
});

it('MCP cannot use source-number repair to change correct quantities or executable rolls', async () => {
  source.pages[0]!.text!.content = '<p>Damage 3. [[/r 2d6]]</p>';
  copy.pages[0]!.text!.content = '<p>Poškození 3. [[/r 2d6]]</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const f = await liveFixture();
  expect(await f.call('save_correction', { ...f.args, restoreSourceNumbers: true, text: ['Poškození činí 4. ⟦1⟧'] })).toMatchObject({ ok: false, error: { code: 'Live.InvalidNumberRepair' } });
  expect(await f.call('save_correction', { ...f.args, restoreSourceNumbers: true, text: ['Poškození činí 3. [[/r 3d6]]'] })).toMatchObject({ ok: false, error: { code: 'Review.ReferenceChanged' } });
  expect(writes).toHaveLength(0);
});

it('MCP reports exact field integrity differences without unblocking or writing damaged fields', async () => {
  source.pages[0]!.text!.content = '<p>@UUID[Actor.a] @UUID[Actor.a]</p>';
  copy.pages[0]!.text!.content = '<p class="changed">@UUID[Actor.b]</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const f = await liveFixture();
  const context = await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id });
  expect(context).toMatchObject({ ok: true, value: { blocked: 'StructureChanged', integrityDetails: {
    commands: { missing: [{ command: '@UUID[Actor.a]', count: 2 }], extra: [{ command: '@UUID[Actor.b]', count: 1 }] },
    markup: expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('html/'), translation: ['class', 'changed'] })]) } } });
  expect(await f.call('save_correction', { ...f.args, text: ['⟦1⟧ Oprava.'] })).toMatchObject({ ok: false, error: { code: 'Review.StructureChanged' } });
  expect(writes).toHaveLength(0);
});

it('MCP deliberately restores a missing source reference, unblocks the field, preserves mechanics and safely undoes', async () => {
  source.pages[0]!.text!.content = '<p>The device has AC 20 and a &reference[damage threshold] of 10.</p><p>Next paragraph.</p>';
  copy.pages[0]!.text!.content = '<p>Zařízení má AC 20 a práh poškození 10.</p><p>Další odstavec.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const f = await liveFixture(), original = JSON.stringify(source);
  const context = await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id });
  expect(context).toMatchObject({ ok: true, value: { blocked: 'StructureChanged', referenceRepairEdit: {
    text: ['Zařízení má AC 20 a práh poškození 10.'], references: [[{ marker: '⟦1⟧', command: '&reference[damage threshold]', editable: false }]] } } });
  const args = { ...f.args, restoreSourceReferences: true, text: ['Zařízení má AC 20 a ⟦1⟧ ve výši 10.'], reason: 'Obnova vynechaného původního příkazu pravidla, čísla beze změny.' };
  expect(await f.call('validate_correction', args)).toMatchObject({ ok: true });
  expect(writes).toHaveLength(0);
  expect(await f.call('save_correction', { ...args, text: ['Zařízení má AC 20 a ⟦1⟧ ⟦1⟧ ve výši 10.'] })).toMatchObject({ ok: false, error: { code: 'Review.ReferenceChanged' } });
  expect(await f.call('save_correction', args)).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(textRow(await snapshot()).blocked).toBeNull();
  expect(copy.pages[0]!.text!.content).toContain('&amp;reference[damage threshold]');
  expect(readReviewHistory(copy.flags)[0]?.referenceRepair).toBe(true);
  expect(await f.call('save_correction', args)).toMatchObject({ ok: true, value: { alreadyApplied: true } });
  expect(await f.call('undo_correction', { documentId: f.s.entry.uuid, operationId: args.operationId })).toMatchObject({ ok: true, value: { undone: true } });
  expect(copy.pages[0]!.text!.content).toBe('<p>Zařízení má AC 20 a práh poškození 10.</p><p>Další odstavec.</p>');
  expect(textRow(await snapshot()).blocked).toBe('StructureChanged');
  expect(JSON.stringify(source)).toBe(original);
});

it('MCP does not offer source-reference repair for changed destinations or damaged markup', async () => {
  source.pages[0]!.text!.content = '<p>@UUID[Actor.a]</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  for (const invalid of ['<p>@UUID[Actor.b]</p>', '<p class="wrong">Chybí.</p>']) {
    copy.pages[0]!.text!.content = invalid;
    const f = await liveFixture();
    const context = await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id });
    expect(context).toMatchObject({ ok: true, value: { referenceRepairEdit: null } });
    expect(await f.call('save_correction', { ...f.args, restoreSourceReferences: true, text: ['⟦1⟧'] })).toMatchObject({ ok: false, error: { code: 'Live.InvalidReferenceRepair' } });
  }
  expect(writes).toHaveLength(0);
});

it.each(['Item', 'JournalEntryPage'])('MCP restores an unambiguous collapsed %s link with preview, retry binding and guarded undo', async child => {
  const root = child === 'Item' ? 'Actor.light' : 'JournalEntry.source';
  const mapped = child === 'Item' ? 'Compendium.world.actors.Actor.copyLight' : copyDocument.uuid;
  source.pages[0]!.text!.content = `<p>Use @UUID[${root}.${child}.ability#details]{Luminous Transit}.</p><p>Other text.</p>`;
  copy.pages[0]!.text!.content = `<p>Použijte @UUID[${mapped}]{Světelný Přesun}.</p><p>Další text.</p>`;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  if (child === 'Item') {
    game.packs.set('world.actors', { getIndex: async () => new Map([['copyLight', { _id: 'copyLight', name: 'Light', flags: { [MODULE_ID]: {
      actorTranslation: { schemaVersion: 1, sourceUuid: root, sourceHash: 'x', targetLanguage: 'cs', sourceLanguage: 'en',
        providerId: 'openai-compatible', translatedAt: '2026-10-01', translatedHtmlFields: 1 },
    } } }]]) } as any);
    // Use the module's managed actor compendium identity, not an arbitrary pack.
    const actorPack = game.packs.get('world.actors')!;
    game.packs.delete('world.actors'); game.packs.set(ACTOR_TRANSLATIONS_PACK_ID, actorPack);
    copy.pages[0]!.text!.content = copy.pages[0]!.text!.content!.replace(mapped, `Compendium.${ACTOR_TRANSLATIONS_PACK_ID}.Actor.copyLight`);
  }
  const target = child === 'Item' ? `Compendium.${ACTOR_TRANSLATIONS_PACK_ID}.Actor.copyLight.${child}.ability#details` : `${mapped}.${child}.ability#details`;
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === target.split('#')[0] ? { uuid, documentName: child } : sourceDocument);
  const before = copy.pages[0]!.text!.content, original = JSON.stringify(source), f = await liveFixture();
  const context = await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id });
  expect(context).toMatchObject({ ok: true, value: { referenceRepairEdit: { text: ['Použijte ⟦1⟧.'],
    references: [[{ marker: '⟦1⟧', command: `@UUID[${target}]{Světelný Přesun}`, editable: true }]],
    targetChanges: [{ marker: '⟦1⟧', after: `@UUID[${target}]{Světelný Přesun}` }],
  } } });
  const args = { ...f.args, restoreSourceReferences: true, text: ['Pomocí ⟦1⟧ se přesuňte.'], labels: [{ marker: '⟦1⟧', label: 'Světelného Přesunu' }] };
  expect(await f.call('validate_correction', args)).toMatchObject({ ok: true, value: { referenceRepair: { requested: true, targetChanges: [{ marker: '⟦1⟧' }] }, willVerify: false } });
  expect(writes).toHaveLength(0);
  expect(await f.call('save_correction', { ...args, restoreSourceReferences: false })).toMatchObject({ ok: false });
  expect(await f.call('save_correction', { ...args, text: [`Use @UUID[${root}.${child}.other].`] })).toMatchObject({ ok: false });
  expect(writes).toHaveLength(0);
  expect(await f.call('save_correction', args)).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toContain(`@UUID[${target}]{Světelného Přesunu}`);
  expect(textRow(await snapshot()).blocked).toBeNull();
  expect(await f.call('save_correction', args)).toMatchObject({ ok: true, value: { alreadyApplied: true } });
  expect(await f.call('save_correction', { ...args, restoreSourceReferences: false })).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
  expect(await f.call('undo_correction', { documentId: f.s.entry.uuid, operationId: args.operationId })).toMatchObject({ ok: true, value: { undone: true } });
  expect(copy.pages[0]!.text!.content).toBe(before);
  expect(textRow(await snapshot()).blocked).toBe('StructureChanged');
  expect(JSON.stringify(source)).toBe(original);
});

it.each([
  ['@UUID[Actor.a.Item.one]', '@UUID[Actor.b]'],
  ['@UUID[Actor.a.Item.one] @UUID[Actor.a.Item.two]', '@UUID[Actor.a]'],
  ['@UUID[Actor.a.Item.one] @UUID[Actor.a.Item.one]', '@UUID[Actor.a] @UUID[Actor.a]'],
  ['@UUID[Actor.a.Item.one]', '@Embed[Actor.a]'],
  ['@UUID[Actor.a.Item.one]', '@UUID[Actor.a#other]'],
  ['@UUID[Actor.a.Item.one] [[/r 2d6]]', '@UUID[Actor.a] [[/r 3d6]]'],
  ['@UUID[Actor.a.ActiveEffect.one]', '@UUID[Actor.a]'],
])('MCP rejects ambiguous or unrelated target repair: %s -> %s', async (original, changed) => {
  source.pages[0]!.text!.content = `<p>${original}</p>`;
  copy.pages[0]!.text!.content = `<p>${changed}</p>`;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const f = await liveFixture();
  expect(await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id })).toMatchObject({ ok: true, value: { referenceRepairEdit: null } });
  expect(await f.call('save_correction', { ...f.args, restoreSourceReferences: true, text: ['⟦1⟧'] })).toMatchObject({ ok: false, error: { code: 'Live.InvalidReferenceRepair' } });
  expect(writes).toHaveLength(0);
});

it('requires all remaining field damage to be fixed and rejects stale target repairs', async () => {
  source.pages[0]!.text!.content = '<p>Use @UUID[Actor.a.Item.one].</p><p>Keep &Reference[exhaustion].</p>';
  copy.pages[0]!.text!.content = '<p>Použijte @UUID[Actor.a].</p><p>Další text.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'Actor.a.Item.one' ? { uuid, documentName: 'Item' } : sourceDocument);
  const f = await liveFixture(), args = { ...f.args, restoreSourceReferences: true, text: ['Použijte ⟦1⟧.'] };
  expect(await f.call('validate_correction', args)).toMatchObject({ ok: false, error: { code: 'Review.ProtectedText' } });
  copy.pages[0]!.text!.content += '<p>Novější editace.</p>';
  expect(await f.call('save_correction', args)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  expect(writes).toHaveLength(0);
});

it('combines missing commands and collapsed targets across inline fragments, while undo preserves unrelated later edits', async () => {
  source.pages[0]!.text!.content = '<p><strong>Use</strong> @UUID[Actor.a.Item.one] and &Reference[exhaustion].</p><p>Other paragraph.</p>';
  copy.pages[0]!.text!.content = '<p><strong>Použijte</strong> @UUID[Actor.a] a únavu.</p><p>Další odstavec.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'Actor.a.Item.one' ? { uuid, documentName: 'Item' } : sourceDocument);
  const f = await liveFixture(), args = { ...f.args, restoreSourceReferences: true, text: ['Použijte', ' ⟦1⟧ a ⟦2⟧.'] };
  expect(await f.call('validate_correction', args)).toMatchObject({ ok: true });
  expect(await f.call('save_correction', args)).toMatchObject({ ok: true });
  let s = await snapshot();
  const other = s.rows.find(row => row.label === 'text.content' && row.id !== f.row.id)!;
  await saveReviewRows(s, [{ rowId: other.id, parts: ['Novější oprava jinde.'] }]);
  expect(await f.call('undo_correction', { documentId: f.s.entry.uuid, operationId: args.operationId })).toMatchObject({ ok: true });
  expect(copy.pages[0]!.text!.content).toBe('<p><strong>Použijte</strong> @UUID[Actor.a] a únavu.</p><p>Novější oprava jinde.</p>');
  s = await snapshot();
  const freshContext = await f.call('get_context', { documentId: s.entry.uuid, rowId: f.row.id });
  const second = { ...args, revision: (freshContext.value as any).revision, operationId: crypto.randomUUID() };
  expect(await f.call('save_correction', second)).toMatchObject({ ok: true });
  copy.pages[0]!.text!.content = copy.pages[0]!.text!.content!.replace('Použijte', 'Využijte');
  const count = writes.length;
  expect(await f.call('undo_correction', { documentId: s.entry.uuid, operationId: second.operationId })).toMatchObject({ ok: false, error: { code: 'Review.UndoConflict' } });
  expect(writes).toHaveLength(count);
});

it('reports a source-derived child that no longer exists and rechecks targets between preview and save', async () => {
  source.pages[0]!.text!.content = '<p>Use @UUID[Actor.a.Item.oldAbility].</p>';
  copy.pages[0]!.text!.content = '<p>Použijte @UUID[Actor.a].</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  let exists = false;
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'Actor.a.Item.oldAbility' ? exists ? { uuid, documentName: 'Item' } : null : sourceDocument);
  const f = await liveFixture(), args = { ...f.args, restoreSourceReferences: true, text: ['Použijte ⟦1⟧.'] };
  expect(await f.call('get_context', { documentId: f.s.entry.uuid, rowId: f.row.id })).toMatchObject({ ok: true, value: {
    referenceRepairEdit: null, referenceRepairTargets: [{ target: 'Actor.a.Item.oldAbility', exists: false }],
  } });
  expect(await f.call('validate_correction', args)).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  exists = true;
  expect(await f.call('validate_correction', args)).toMatchObject({ ok: true });
  exists = false;
  expect(await f.call('save_correction', args)).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  expect(writes).toHaveLength(0);
});


it("reads history from parent flags in the compendium index without hydrating unrelated documents", async () => {
  const pack = game.packs.get(packId)!;
  const getDocument = vi.spyOn(pack, "getDocument");
  copy.flags![MODULE_ID]!.reviewHistory = { correction: { id: "correction", at: "2026-10-01", userName: "GM", sourceHash: "x", label: "Correction", rows: [] } };
  const progress = vi.fn();
  const history = await reviewHistory("cs", { progress });
  expect(history).toHaveLength(1); expect(history[0]?.operations[0]?.id).toBe("correction");
  expect(history[0]?.entry.uuid).toBe(`Compendium.${packId}.JournalEntry.copy`);
  expect(getDocument).not.toHaveBeenCalled();
  expect(await reviewHistory("de")).toEqual([]);
  expect(progress).toHaveBeenLastCalledWith(1, 1);
});
it("lets history cancel a stalled index read immediately without late progress updates", async () => {
  const controller = new AbortController(), pack = game.packs.get(packId)!;
  let complete!: (value: any) => void;
  vi.spyOn(pack, "getIndex").mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const progress = vi.fn(), pending = reviewHistory("cs", { signal: controller.signal, progress });
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  complete(new Map()); await Promise.resolve(); expect(progress).toHaveBeenCalledTimes(1);
});

async function identifierFixture() {
  source.pages[0]!.text!.content = '<p>The area is &amp;Reference[Lightly Obscured].</p><p><strong>Result 6:</strong> &amp;Reference[Poisoned].</p><p>Take &amp;Reference[Long Rest] for [[/roll 2d4 hours]] or @UUID[Actor.a]{Ally}.</p><p>Other text.</p>';
  copy.pages[0]!.text!.content = '<p>Oblast je &amp;Reference[Lehce zastřená].</p><p><strong>Výsledek 6:</strong> &amp;Reference[Otravená].</p><p>Využij &amp;Reference[Dlouhého odpočinku] po [[/roll 2d4 hours]] nebo @UUID[Actor.a]{Spojence}.</p><p>Jiný text.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const f = await liveFixture();
  const args = { documentId: f.args.documentId, rowId: f.args.rowId, revision: f.args.revision,
    reason: 'Obnova přesných původních resolver identifikátorů; próza i mechaniky zachovány.' };
  return { ...f, repairArgs: args, saveArgs: { ...args, operationId: crypto.randomUUID() } };
}

it('atomically restores three source Reference identifiers with exact preview, one persistent write and idempotent receipt', async () => {
  const f = await identifierFixture(), original = JSON.stringify(source);
  const preview = await f.call('validate_reference_identifiers', f.repairArgs);
  expect(preview).toMatchObject({ ok: true, value: { willVerify: false, identifiers: [
    { before: '&Reference[Lehce zastřená]', after: '&Reference[Lightly Obscured]' },
    { before: '&Reference[Otravená]', after: '&Reference[Poisoned]' },
    { before: '&Reference[Dlouhého odpočinku]', after: '&Reference[Long Rest]' },
  ], changes: expect.any(Array) } });
  expect((preview.value as any).changes).toHaveLength(3);
  expect(writes).toHaveLength(0);
  // The ordinary row route must not apply just one member of a broken field.
  expect(await f.call('save_correction', { ...f.args, text: ['Oblast je &Reference[Lightly Obscured].'] })).toMatchObject({ ok: false });
  expect(writes).toHaveLength(0);
  const saved = await f.call('restore_reference_identifiers', f.saveArgs);
  expect(saved).toMatchObject({ ok: true, value: { saved: true, verified: false, rowIds: expect.any(Array) } });
  expect(writes).toHaveLength(1); expect(writes[0]!.kind).toBe('root');
  const view = await snapshot();
  expect(view.rows.filter(row => row.fieldId === f.row.fieldId).every(row => !row.blocked && !row.verified)).toBe(true);
  expect(copy.pages[0]!.text!.content).toContain('[[/roll 2d4 hours]] nebo @UUID[Actor.a]{Spojence}');
  expect(copy.pages[0]!.text!.content).toContain('<strong>Výsledek 6:</strong>');
  expect(copy.pages[0]!.text!.content).toContain('<p>Jiný text.</p>');
  expect(JSON.stringify(source)).toBe(original);
  expect(readReviewHistory(copy.flags)[0]).toMatchObject({ id: f.saveArgs.operationId, identifierRepair: true, rows: expect.any(Array) });
  expect(readReviewHistory(copy.flags)[0]!.rows).toHaveLength(3);
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: true, value: { alreadyApplied: true } });
  expect(writes).toHaveLength(1);
  expect(await f.call('restore_reference_identifiers', { ...f.saveArgs, reason: 'Different request reason' })).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
  expect(await f.call('restore_reference_identifiers', { ...f.saveArgs, rowId: view.rows.find(row => row.fieldId === f.row.fieldId && row.id !== f.row.id)!.id })).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
});

it('undo proves the exact whole-field identifier repair and preserves unrelated subsequent prose edits', async () => {
  const f = await identifierFixture(), before = copy.pages[0]!.text!.content!, original = JSON.stringify(source);
  expect((await f.call('restore_reference_identifiers', f.saveArgs)).ok).toBe(true);
  const s = await snapshot(), other = s.rows.find(row => row.translation.join('') === 'Jiný text.')!;
  await saveReviewRows(s, [{ rowId: other.id, parts: ['Pozdější jazyková oprava.'] }]);
  expect(await f.call('undo_correction', { documentId: f.saveArgs.documentId, operationId: f.saveArgs.operationId })).toMatchObject({ ok: true, value: { undone: true } });
  expect(copy.pages[0]!.text!.content).toBe(before.replace('Jiný text.', 'Pozdější jazyková oprava.'));
  expect(textRow(await snapshot()).blocked).toBe('StructureChanged');
  expect(JSON.stringify(source)).toBe(original);
  const count = writes.length;
  expect(await f.call('undo_correction', { documentId: f.saveArgs.documentId, operationId: f.saveArgs.operationId })).toMatchObject({ ok: true, value: { alreadyUndone: true } });
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
  expect(writes).toHaveLength(count);
});

it('refuses identifier undo after an affected-row edit or a source change', async () => {
  const f = await identifierFixture();
  expect((await f.call('restore_reference_identifiers', f.saveArgs)).ok).toBe(true);
  const s = await snapshot();
  await saveReviewRows(s, [{ rowId: f.row.id, parts: ['Oblast nyní má &Reference[Lightly Obscured].'] }]);
  const count = writes.length;
  expect(await f.call('undo_correction', { documentId: f.saveArgs.documentId, operationId: f.saveArgs.operationId })).toMatchObject({ ok: false, error: { code: 'Review.UndoConflict' } });
  source.pages[0]!.text!.content += '<p>New source.</p>';
  expect(await f.call('undo_correction', { documentId: f.saveArgs.documentId, operationId: f.saveArgs.operationId })).toMatchObject({ ok: false, error: { code: 'Review.UndoConflict' } });
  expect(writes).toHaveLength(count);
});

it.each([
  ['<p>&Reference[Poisoned]</p>', '<p>Chybí.</p>'],
  ['<p>&Reference[Poisoned]</p><p>Other.</p>', '<p>Jiné.</p><p>&Reference[Otravená]</p>'],
  ['<p>&Reference[Poisoned] &Reference[Long Rest]</p>', '<p>&Reference[Otravená] &Reference[Odpočinek]</p>'],
  ['<p>&Reference[Poisoned] @UUID[Actor.a]</p>', '<p>&Reference[Otravená] @UUID[Actor.b]</p>'],
  ['<p>&Reference[Poisoned]</p>', '<p class="wrong">&Reference[Otravená]</p>'],
])('keeps unsupported identifier damage blocked: %s', async (original, translated) => {
  source.pages[0]!.text!.content = original; copy.pages[0]!.text!.content = translated;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  const f = await liveFixture(), args = { documentId: f.args.documentId, rowId: f.args.rowId, revision: f.args.revision, reason: 'Restore exact source identifiers' };
  expect(await f.call('validate_reference_identifiers', args)).toMatchObject({ ok: false, error: { code: 'Live.InvalidIdentifierRepair' } });
  expect(await f.call('restore_reference_identifiers', { ...args, operationId: crypto.randomUUID() })).toMatchObject({ ok: false, error: { code: 'Live.InvalidIdentifierRepair' } });
  expect(writes).toHaveLength(0);
});

it('rechecks identifier repair revision, exact changes and write permission without a normal-write bypass', async () => {
  const f = await identifierFixture();
  const { referenceIdentifierRepairDraft } = await import('../src/review/reference-identifier-repair');
  const repair = referenceIdentifierRepairDraft(f.s, f.row.fieldId)!;
  await expect(saveReviewRows(f.s, repair.changes.slice(0, 1), { identifierRepair: true })).rejects.toThrow('ProtectedText');
  await expect(saveReviewRows(f.s, [{ ...repair.changes[0]!, parts: ['Invented prose'] }, ...repair.changes.slice(1)], { identifierRepair: true })).rejects.toThrow('ProtectedText');
  await expect(saveReviewRows(f.s, repair.changes, { identifierRepair: true, canWrite: () => false })).rejects.toThrow('Live.Disconnected');
  expect(writes).toHaveLength(0);
  locked = true;
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: 'Review.Locked' } });
  locked = false; const run = activeTranslations.start('Guide', 'cs');
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: 'Review.PauseFirst' } });
  activeTranslations.finish(run);
  copy.pages[0]!.text!.content += '<p>Newer copy edit.</p>';
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  f.disconnect();
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: 'Live.Disconnected' } });
  expect(writes).toHaveLength(0);
});

it('rechecks the authoritative source immediately before the atomic identifier persistence', async () => {
  const f = await identifierFixture();
  let reads = 0;
  vi.stubGlobal('fromUuid', async () => {
    if (++reads === 3) source.pages[0]!.text!.content += '<p>Concurrent source revision.</p>';
    return sourceDocument;
  });
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  expect(writes).toHaveLength(0);
});
