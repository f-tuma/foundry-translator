import { displayFields, buildDisplayTextRecord, DISPLAY_TEXT_PACK } from "../src/translation/display-text";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { MODULE_ID } from "../src/constants";
import { itemSourceHash, type ItemData } from "../src/translation/item";
import { translatedOutputHash } from "../src/translation/output-hash";
import { ITEM_TRANSLATIONS_PACK_ID } from "../src/translation/compendium-item-translation-repository";
import { loadReview, reviewCatalog, readReviewHistory, saveReviewRows } from "../src/review/service";
import { createLiveHandler } from "../src/polish/live-service";
import { parseLiveRequest } from "../src/polish/live-protocol";
import { isMachineProofreadingCurrent, prepareMachineProofreading, readMachineProofreading } from "../src/review/machine-proofreading";
import { GlossaryCompendiumRepository } from "../src/glossary/compendium-repository";
import { activeTranslations } from "../src/translation/active-translations";

class HTMLField {}
class StringField {}
class SchemaField { constructor(readonly fields: Record<string, unknown>) {} }
class CrucibleActionField extends SchemaField {}
class ArrayField { constructor(readonly element: unknown) {} }
let source: ItemData, copy: ItemData, sourceDoc: any, targetDoc: any, locked: boolean, writes: any[], connected: boolean;
let fields: Record<string, unknown>, handle: ReturnType<typeof createLiveHandler>;
let glossaryHook: (() => void) | undefined;
const documentId = `Compendium.${ITEM_TRANSLATIONS_PACK_ID}.Item.copy`;
const call = (method: string, args: Record<string, unknown>) => handle({ id: crypto.randomUUID(), method, args });
async function snapshot() { return loadReview((await reviewCatalog("cs"))[0]!); }
async function preview() { const r = await call("prepare_machine_proofreading", { documentId }); expect(r.ok).toBe(true); return r.value as any; }
async function args() { const p = await preview(); return { documentId, rowIds: p.rowIds, coverageHash: p.coverageHash, revision: p.revision, reason: "Read all source and translated prose conservatively", operationId: "machine-test" }; }
function dotted(patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split("."), data: any = copy; let obj = data;
    for (const key of path.slice(0, -1)) obj = obj[key] ??= {};
    obj[path.at(-1)!] = structuredClone(value);
  }
}
beforeEach(async () => {
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  fields = { description: new SchemaField({ public: new HTMLField(), private: new HTMLField() }), actions: new ArrayField(new CrucibleActionField({ id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() })) };
  source = { name: "Tool", type: "weapon", system: { description: { public: '<p>Use for 3 rounds.</p><p>Then <strong>rest</strong>.</p>', private: '<p>Private rule.</p>' },
    actions: [{ id: "strike", name: "Strike", description: '<p>Deal 2 damage @ref[item.name].</p>', condition: "After 1 miss.", cost: { action: 2 } }] }, effects: [{ _id: "affix", changes: [{ key: "damage", value: 2 }] }] };
  copy = structuredClone(source); copy._id = "copy"; copy.name = "Nástroj";
  (copy.system.description as any).public = '<p>Použij po 3 kola.</p><p>Potom <strong>odpočívej</strong>.</p>';
  (copy.system.description as any).private = '<p>Soukromé pravidlo.</p>';
  (copy.system.actions as any)[0].name = "Úder";
  (copy.system.actions as any)[0].description = '<p>Způsob 2 zranění @ref[item.name].</p>';
  (copy.system.actions as any)[0].condition = "Po 1 minutí.";
  copy.flags = { [MODULE_ID]: { itemTranslation: { schemaVersion: 1, engineRevision: 9, sourceUuid: "Item.source", sourceHash: await itemSourceHash(source), providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-10-06", translatedHtmlFields: 3, fallbackTextSegments: 2 } } };
  (copy.flags[MODULE_ID]!.itemTranslation as any).outputHash = await translatedOutputHash(copy);
  sourceDoc = { id: "source", uuid: "Item.source", documentName: "Item", system: { constructor: { schema: { get fields() { return fields; } } } }, toObject: () => structuredClone(source) };
  targetDoc = { id: "copy", uuid: documentId, documentName: "Item", get flags() { return copy.flags; }, toObject: () => structuredClone(copy), update: async (patch: any) => { writes.push(patch); dotted(patch); } };
  locked = false; writes = []; connected = true; glossaryHook = undefined;
  const pack = { get locked() { return locked; }, getIndex: async () => new Map([["copy", { _id: "copy", name: copy.name, flags: copy.flags }]]), getDocument: async () => targetDoc };
  vi.stubGlobal("game", { user: { id: "gm", name: "Reviewer", isGM: true }, world: { id: "world" }, system: { id: "crucible" }, modules: new Map(), packs: new Map([[ITEM_TRANSLATIONS_PACK_ID, pack]]), settings: { get: () => undefined } });
  vi.stubGlobal("fromUuid", async (uuid: string) => uuid === "Item.source" ? sourceDoc : null);
  vi.stubGlobal("Hooks", { callAll: vi.fn() });
  vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting").mockImplementation(async () => { glossaryHook?.(); return []; });
  handle = createLiveHandler("cs", () => connected);
});
afterEach(() => {
  for (const run of activeTranslations.list()) activeTranslations.finish(run.id);
  activeTranslations.clearFinished(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("previews every schema-derived row without writing, then records full machine proof without human verification/fallback/prose mutations", async () => {
  const before = structuredClone(copy), initial = await snapshot();
  expect(initial.rows).toHaveLength(7);
  // Existing human review is preserved exactly rather than fabricated or removed.
  copy.flags![MODULE_ID]!.review = { version: 1, entries: { [initial.rows[0]!.id]: { fingerprint: initial.rows[0]!.fingerprint, at: "date", userId: "human", userName: "Human" } } };
  const human = structuredClone(copy.flags![MODULE_ID]!.review);
  const p = await preview(); expect(p).toMatchObject({ fields: 6, humanVerification: false }); expect(writes).toHaveLength(0);
  const a = await args(), result = await call("commit_machine_proofreading", a);
  expect(result).toMatchObject({ ok: true, value: { saved: true, verified: false, machineProofread: true } });
  expect(writes).toHaveLength(1); expect(Object.keys(writes[0])).toEqual([`flags.${MODULE_ID}.machineProofreading`, `flags.${MODULE_ID}.reviewHistory.machine-test`]);
  expect(copy.name).toBe(before.name); expect(copy.system).toEqual(before.system); expect(copy.effects).toEqual(before.effects);
  expect(copy.flags![MODULE_ID]!.itemTranslation).toEqual(before.flags![MODULE_ID]!.itemTranslation);
  expect(copy.flags![MODULE_ID]!.review).toEqual(human);
  expect((copy.flags![MODULE_ID]!.itemTranslation as any).fallbackTextSegments).toBe(2);
  expect(await isMachineProofreadingCurrent(sourceDoc, copy, "cs", documentId)).toBe(true);
  expect(readReviewHistory(copy.flags)[0]).toMatchObject({ rows: [], label: `MCP: ${a.reason}`, machineProofreading: { before: null, after: { rowIds: initial.rows.map(r => r.id) } } });
});
it("requires all explicit unique known rowIds and exact coverage/revision, rejecting subsets, extras and arbitrary text", async () => {
  const a = await args();
  for (const change of [{ rowIds: a.rowIds.slice(1) }, { rowIds: [...a.rowIds, "f".repeat(64)] }, { coverageHash: "f".repeat(64) }, { revision: "f".repeat(64) }])
    expect(await call("commit_machine_proofreading", { ...a, ...change })).toMatchObject({ ok: false });
  for (const extra of [{ text: ["invented"] }, { labels: [] }, { fieldId: '["name"]' }, { rowIds: [...a.rowIds, a.rowIds[0]] }])
    expect(() => parseLiveRequest({ id: "request", method: "commit_machine_proofreading", args: { ...a, ...extra } })).toThrow("Live.InvalidRequest");
  expect(writes).toHaveLength(0);
});
it("retries identical operations once; changed reason/coverage/order conflicts and undo revokes machine proof only", async () => {
  const a = await args(); expect(await call("commit_machine_proofreading", a)).toMatchObject({ ok: true });
  expect(await call("commit_machine_proofreading", a)).toMatchObject({ ok: true, value: { alreadyApplied: true } });
  for (const change of [{ reason: "Different request reason" }, { rowIds: [...a.rowIds].reverse() }, { coverageHash: "f".repeat(64) }])
    expect(await call("commit_machine_proofreading", { ...a, ...change })).toMatchObject({ ok: false, error: { code: "Live.OperationConflict" } });
  expect(writes).toHaveLength(1);
  const prose = JSON.stringify(copy.system);
  expect(await call("undo_correction", { documentId, operationId: a.operationId })).toMatchObject({ ok: true, value: { undone: true } });
  expect(readMachineProofreading(copy)).toBeNull(); expect(await isMachineProofreadingCurrent(sourceDoc, copy, "cs", documentId)).toBe(false);
  expect(JSON.stringify(copy.system)).toBe(prose); expect(writes).toHaveLength(2);
  expect(await call("commit_machine_proofreading", a)).toMatchObject({ ok: false, error: { code: "Live.OperationConflict" } });
  expect(await call("undo_correction", { documentId, operationId: a.operationId })).toMatchObject({ ok: true, value: { alreadyUndone: true } });
});
it.each(["source-prose", "source-affix", "target-affix", "target-prose", "schema", "metadata", "history", "language", "identity"])("invalidates receipt and refuses replay after %s changes", async kind => {
  const a = await args(); expect(await call("commit_machine_proofreading", a)).toMatchObject({ ok: true });
  if (kind === "source-prose") source.name = "Changed";
  if (kind === "source-affix") (source.effects as any)[0].changes[0].value = 3;
  if (kind === "target-affix") (copy.effects as any)[0].changes[0].value = 3;
  if (kind === "target-prose") copy.name = "Změněný";
  if (kind === "schema") delete fields.actions;
  if (kind === "metadata") (copy.flags![MODULE_ID]!.itemTranslation as any).fallbackTextSegments = 1;
  if (kind === "history") delete (copy.flags![MODULE_ID]!.reviewHistory as any)[a.operationId];
  if (kind === "language") (copy.flags![MODULE_ID]!.itemTranslation as any).targetLanguage = "de";
  if (kind === "identity") (copy.flags![MODULE_ID]!.itemTranslation as any).sourceUuid = "Item.other";
  expect(await isMachineProofreadingCurrent(sourceDoc, copy, "cs", documentId)).toBe(false);
  const replay = await call("commit_machine_proofreading", a); expect(replay.ok).toBe(false);
  expect(await call("undo_correction", { documentId, operationId: a.operationId })).toMatchObject({ ok: false }); expect(writes).toHaveLength(1);
});
it.each(["locked", "partial", "running", "paused", "blocked", "numbers", "cross-part-numbers", "disconnected", "not-gm"])("refuses unsafe %s preview/commit", async kind => {
  const a = await args();
  if (kind === "locked") locked = true;
  if (kind === "partial") (copy.flags![MODULE_ID]!.itemTranslation as any).partial = true;
  if (kind === "running" || kind === "paused") { const r = activeTranslations.start("run", "cs", "Item.source"); if (kind === "paused") activeTranslations.update(r, { pausedAt: Date.now() }); }
  if (kind === "blocked") (copy.system.description as any).public = '<p>Invalid <em>structure</em>.</p>';
  if (kind === "numbers") (copy.system.actions as any)[0].condition = "Po 9 minutích.";
  if (kind === "cross-part-numbers") { (source.system.description as any).public = '<p>Use <strong>2</strong> or 3 rounds.</p>'; (copy.system.description as any).public = '<p>Použij <strong>3</strong> nebo 2 kola.</p>'; (copy.flags![MODULE_ID]!.itemTranslation as any).sourceHash = await itemSourceHash(source); }
  if (kind === "disconnected") connected = false;
  if (kind === "not-gm") (game.user as any).isGM = false;
  expect(await call("prepare_machine_proofreading", { documentId })).toMatchObject({ ok: false });
  expect(await call("commit_machine_proofreading", a)).toMatchObject({ ok: false }); expect(writes).toHaveLength(0);
});
it.each(["source", "effects", "output", "schema", "settings", "glossary", "lock", "run", "disconnect"])("rejects %s changing during final asynchronous write validation", async kind => {
  const a = await args(); let n = 0;
  glossaryHook = () => {
    if (++n !== (kind === "glossary" ? 2 : 3)) return;
    if (kind === "source") source.name = "Changed source";
    if (kind === "effects") (source.effects as any)[0].changes[0].value = 3;
    if (kind === "output") copy.name = "Změněný";
    if (kind === "schema") delete fields.actions;
    if (kind === "settings") (game as any).settings.get = () => "de";
    if (kind === "glossary") vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting").mockResolvedValue([{ id: "x", source: "Tool", replacement: "Nástroj", aliases: [], mode: "exact" }] as any);
    if (kind === "lock") locked = true;
    if (kind === "run") activeTranslations.start("new", "cs", "Item.source");
    if (kind === "disconnect") connected = false;
  };
  expect(await call("commit_machine_proofreading", a)).toMatchObject({ ok: false }); expect(writes).toHaveLength(0);
});
it("refuses malformed/unbacked receipt, other target identity and Actor scope", async () => {
  const a = await args(); expect(await call("commit_machine_proofreading", a)).toMatchObject({ ok: true });
  const valid = structuredClone(copy), receipt: any = copy.flags![MODULE_ID]!.machineProofreading;
  receipt.rowIds = receipt.rowIds.slice(1);
  expect(await isMachineProofreadingCurrent(sourceDoc, copy, "cs", documentId)).toBe(false);
  expect(await isMachineProofreadingCurrent(sourceDoc, valid, "cs", "Item.wrong")).toBe(false);
  expect(await isMachineProofreadingCurrent({ ...sourceDoc, documentName: "Actor" }, valid, "cs", documentId)).toBe(false);
  const s = await snapshot(); await expect(prepareMachineProofreading({ ...s, entry: { ...s.entry, kind: "Actor" } }, sourceDoc, valid)).rejects.toThrow();
});

it("supports a new attestation after undo and exact restoration of a prior machine receipt", async () => {
  const first = await args(); expect(await call("commit_machine_proofreading", first)).toMatchObject({ ok: true });
  const oldReceipt = structuredClone(readMachineProofreading(copy));
  const second = { ...await args(), operationId: "second-machine", reason: "Repeat complete machine reading independently" };
  expect(await call("commit_machine_proofreading", second)).toMatchObject({ ok: true });
  expect(await call("undo_correction", { documentId, operationId: second.operationId })).toMatchObject({ ok: true });
  expect(readMachineProofreading(copy)).toEqual(oldReceipt);
  expect(await isMachineProofreadingCurrent(sourceDoc, copy, "cs", documentId)).toBe(true);
  expect(await call("undo_correction", { documentId, operationId: first.operationId })).toMatchObject({ ok: true });
  const third = { ...await args(), operationId: "third-machine" };
  expect(await call("commit_machine_proofreading", third)).toMatchObject({ ok: true });
  expect(await isMachineProofreadingCurrent(sourceDoc, copy, "cs", documentId)).toBe(true);
  expect(writes).toHaveLength(5);
});

it("binds preview revision to full source Affix data even though historical itemSourceHash excludes effects", async () => {
  const a = await args(), old = await itemSourceHash(source);
  (source.effects as any)[0].changes[0].value = 5;
  expect(await itemSourceHash(source)).toBe(old);
  expect(await call("commit_machine_proofreading", a)).toMatchObject({ ok: false, error: { code: "Review.Conflict" } });
  const fresh = await args(); expect(fresh.revision).not.toBe(a.revision);
  expect(writes).toHaveLength(0);
});

it("rejects numerical swaps between Embed prose option slots even when their paragraph multiset is unchanged", async () => {
  (source.system.description as any).public = '<p>@Embed[Actor.a readaloud="Wait 2 rounds" caption="Take 3 points"]</p>';
  (copy.system.description as any).public = '<p>@Embed[Actor.a readaloud="Počkej 3 kola" caption="Vezmi 2 body"]</p>';
  (copy.flags![MODULE_ID]!.itemTranslation as any).sourceHash = await itemSourceHash(source);
  expect(await call("prepare_machine_proofreading", { documentId })).toMatchObject({ ok: false });
  (copy.system.description as any).public = '<p>@Embed[Actor.a readaloud="Počkej 2 kola" caption="Vezmi 3 body"]</p>';
  expect(await call("prepare_machine_proofreading", { documentId })).toMatchObject({ ok: true });
  expect(writes).toHaveLength(0);
});

async function affixDisplayFixture() {
  class CrucibleAffixActiveEffect { static schema = { fields: { actions: new ArrayField(new CrucibleActionField({ id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() })) } }; }
  vi.stubGlobal("CONFIG", { ActiveEffect: { dataModels: { affix: CrucibleAffixActiveEffect } } });
  const original: any = { _id: "affix", name: "Recovery", type: "affix", description: '<p>Original effect.</p>', system: { actions: [{ id: "recoverFocus", name: "Recover Focus", description: '<p>Recover 4 Focus.</p>', condition: "When equipped.", cost: { action: 2 } }] } };
  const src: any = { id: "affix", uuid: "Item.source.ActiveEffect.affix", documentName: "ActiveEffect", system: new CrucibleAffixActiveEffect(), toObject: () => structuredClone(original) };
  const metadata = displayFields("ActiveEffect", original).map((f, index) => ({ ...f, pageId: `page${index}`.padEnd(16, "0") }));
  const record = await buildDisplayTextRecord({ kind: "ActiveEffect", source: original, sourceUuid: src.uuid, sourceLanguage: "en", targetLanguage: "cs", glossaryFingerprint: "g", providerFingerprint: "p", providerId: "openai-compatible", translatedAt: "2026-10-06", fallbackTextSegments: 0 },
    metadata.map(f => ({ _id: f.pageId, type: "text", name: f.path.join("."), text: { content: f.format === "html" ? f.source : `<p>${f.source}</p>` } })), metadata);
  const actualWrites: any[] = [];
  const target: any = { id: "display", uuid: `Compendium.${DISPLAY_TEXT_PACK}.JournalEntry.display`, get flags() { return record.flags; }, toObject: () => structuredClone(record), update: async (patch: any) => {
    actualWrites.push(patch);
    for (const page of patch.pages ?? []) Object.assign(record.pages.find(p => p._id === page._id)!.text!, { content: page['text.content'] });
    for (const [key, value] of Object.entries(patch)) if (key !== "pages") {
      let data: any = record; const parts = key.split('.'); for (const part of parts.slice(0, -1)) data = data[part] ??= {}; data[parts.at(-1)!] = structuredClone(value);
    }
  } };
  (game as any).packs = new Map([[DISPLAY_TEXT_PACK, { locked: false, getIndex: async () => new Map([["display", { _id: "display", name: record.name, flags: record.flags }]]), getDocument: async () => target }]]);
  vi.stubGlobal("fromUuid", async (uuid: string) => uuid === src.uuid ? src : null);
  const entry = (await reviewCatalog("cs"))[0]!;
  return { original, record, actualWrites, entry };
}
it("addresses Affix display Action rows by canonical ID and saves only the separate prose Journal page", async () => {
  const f = await affixDisplayFixture(), original = JSON.stringify(f.original), before = structuredClone(f.record);
  const snapshot = await loadReview(f.entry), fieldId = JSON.stringify(["system", "actions", "recoverFocus", "name"]);
  const row = snapshot.rows.find(r => r.fieldId === fieldId)!;
  expect(row).toBeDefined(); expect(row.blocked).toBeNull(); expect(row.translation).toEqual(["Recover Focus"]);
  await saveReviewRows(snapshot, [{ rowId: row.id, parts: ["Obnova Soustředění"] }]);
  expect(f.actualWrites).toHaveLength(1); expect(f.actualWrites[0].pages).toHaveLength(1);
  expect(JSON.stringify(f.original)).toBe(original);
  const edited = f.record.pages.find(p => p._id === f.actualWrites[0].pages[0]._id)!;
  expect(edited.text!.content).toBe('<p>Obnova Soustředění</p>');
  expect(f.record.pages.filter(p => p._id !== edited._id)).toEqual(before.pages.filter(p => p._id !== edited._id));
});
it("marks source Affix cost drift stale and refuses a display-only Action correction", async () => {
  const f = await affixDisplayFixture(), snapshot = await loadReview(f.entry);
  const row = snapshot.rows.find(r => r.fieldId === JSON.stringify(["system", "actions", "recoverFocus", "name"]))!;
  f.original.system.actions[0].cost.action = 3;
  expect((await loadReview(f.entry)).rows.find(r => r.id === row.id)?.blocked).toBe("SourceChanged");
  await expect(saveReviewRows(snapshot, [{ rowId: row.id, parts: ["Obnova Soustředění"] }])).rejects.toThrow("Review.Conflict");
  expect(f.actualWrites).toHaveLength(0);
});
