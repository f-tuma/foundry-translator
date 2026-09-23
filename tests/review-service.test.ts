import { saveReviewRows, readReviewHistory, undoReview } from "../src/review/service";
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
  vi.stubGlobal("game", { user: { isGM: true, id: "gm", name: "Reviewer" }, i18n: { localize: (key: string) => key }, packs: new Map([[packId, pack]]) });
  vi.stubGlobal("fromUuid", async () => sourceDocument);
  vi.stubGlobal("Hooks", { callAll: vi.fn() });
}
async function snapshot(): Promise<ReviewSnapshot> { return loadReview((await reviewCatalog("cs"))[0]!); }
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
