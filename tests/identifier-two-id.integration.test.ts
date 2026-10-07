import {synthetic99} from './fixtures/correction-batch-fixtures';
import { createHash } from "node:crypto";
import { referenceIdentifierRepairDraft } from "../src/review/reference-identifier-repair";
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
import { prepareReferenceRebuild, materializeReferenceRebuild } from "../src/review/reference-rebuild";

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

async function rebuildFixture() {
  const root = `Compendium.${packId}.JournalEntry.copy`;
  source.pages[0]!.text!.content = '<p>Read @UUID[JournalEntry.source.JournalEntryPage.two]{Later} and @UUID[JournalEntry.source.JournalEntryPage.one]{Arrival}.</p><p>They are &Reference[surprise]{surprised}.</p><p>Untouched.</p>';
  copy.pages[0]!.text!.content = `<p>Přečti @UUID[${root}]{Úvod} a @UUID[${root}]{Později}.</p><p>Jsou &Odkaz[nepředvídané]{překvapení}.</p><p>Beze změny.</p>`;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : { uuid, documentName: 'JournalEntryPage' });
  const view = await snapshot(), row = textRow(view), plan = (await prepareReferenceRebuild(view, row.fieldId))!;
  expect(plan.rows).toHaveLength(2);
  const edits = plan.rows.map(row => ({ rowId: row.rowId, text: [...row.edit.text], labels: row.edit.references.flat().filter(ref => ref.editable).map(ref => ({ marker: ref.marker, label: `Název ${ref.marker.replace(/\D/gu, '')}` })) }));
  // Labels must retain their original numerical multiset; avoid adding quantities.
  for (const edit of edits) for (const label of edit.labels) label.label = 'Přeložený název';
  const proposed = await materializeReferenceRebuild(view, plan, edits);
  return { view, plan, proposed, options: { fieldId: plan.fieldId, proofHash: plan.proofHash } };
}

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

const missingSpell = 'Compendium.fixture.spells.Item.syntheticSpell';
const twoSource = `<p>Use &amp;Reference[poisoned] and &amp;Reference[incapacitated] @UUID[${missingSpell}]{Fictional restoration} for 3 rounds.</p><p>Other text.</p>`;
const twoCurrent = `<p>Použij &amp;Reference[otrávený] a &amp;Reference[neschopný pohybu] @UUID[${missingSpell}]{Testovací obnova} po 3 kola.</p><p>Jiný text.</p>`;
async function twoFixture(captured = false) {
  const capture:any=captured?structuredClone(synthetic99):null;
  source.pages[0]!.text!.content = captured ? capture.raw.source : twoSource;
  copy.pages[0]!.text!.content = captured ? capture.raw.current : twoCurrent;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  if (captured) {
    const pack = game.packs.get(packId)!, baseIndex = await pack.getIndex(), entries = [...baseIndex.entries()];
    // Only the two explicit captured canonical mappings are provided in this mocked catalog.
    for (const [id, sourceUuid] of [['syntheticChainCopy', 'JournalEntry.syntheticChain'], ['syntheticGuideCopy', 'JournalEntry.syntheticGuide']]) {
      const flags = structuredClone(copy.flags!); (flags[MODULE_ID]!.translation as any).sourceUuid = sourceUuid;
      entries.push([id!, { _id: id!, name: 'Fictional mapping fixture', flags }]);
    }
    vi.spyOn(pack, 'getIndex').mockImplementation(async () => new Map(entries));
  }
  let targetVersion = 0;
  const resolver = vi.fn(async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : uuid === missingSpell && targetVersion > 0 ? { uuid, documentName: 'Item', name: 'Spell', toObject: () => ({ name: 'Spell', system: { version: targetVersion } }) } : null);
  vi.stubGlobal('fromUuid', resolver);
  const f = await liveFixture();
  const row = f.s.rows.find(row => row.label === 'text.content' && row.source.some(part => part.includes('[poisoned]') && part.includes('[incapacitated]')))!;
  expect(row).toBeDefined();
  const args = { documentId: f.s.entry.uuid, rowId: row.id, revision: f.args.revision, reason: 'Přesná obnova dvou zdrojových resolver ID.' };
  return { ...f, row, args, saveArgs: { ...args, operationId: crypto.randomUUID() }, capture, resolver, setTargetVersion: (value: number) => { targetVersion = value; } };
}
it('runs synthetic full99 field through exact preview/save/history/idempotence with missing unchanged spell', async () => {
  const f = await twoFixture(true), raw = copy.pages[0]!.text!.content!, original = JSON.stringify(source);
  const rows = f.s.rows.filter(row => row.fieldId === f.row.fieldId);
  expect(rows).toHaveLength(99); expect(rows.map(row => row.unitId)).toEqual(f.capture.units.map((unit: any) => unit.unitId));
  expect(rows.every(row => row.blocked === 'StructureChanged' && !row.verified)).toBe(true);
  const expected = raw.replace('&amp;reference[otrávený]', '&amp;reference[poisoned]').replace('&amp;reference[neschopný pohybu]', '&amp;reference[incapacitated]');
  const preview = await f.call('validate_reference_identifiers', f.args);
  expect(preview).toMatchObject({ ok: true, value: { willVerify: false, changes: [{ rowId: f.row.id }], identifiers: [{ before: '&reference[otrávený]', after: '&reference[poisoned]' }, { before: '&reference[neschopný pohybu]', after: '&reference[incapacitated]' }] } });
  expect(writes).toHaveLength(0);
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: true, value: { saved: true, verified: false, rowIds: [f.row.id] } });
  expect(writes).toHaveLength(1); expect(writes[0]!.kind).toBe('root'); expect(copy.pages[0]!.text!.content).toBe(expected);
  const after = await snapshot(); expect(after.rows.filter(row => row.fieldId === f.row.fieldId)).toHaveLength(99);
  expect(after.rows.filter(row => row.fieldId === f.row.fieldId).every(row => !row.blocked && !row.verified)).toBe(true);
  const history = readReviewHistory(copy.flags); expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ id: f.saveArgs.operationId, identifierRepair: true, label: `MCP: ${f.args.reason}`, sourceHash: f.s.sourceHash, rows: [{ rowId: f.row.id, before: f.row.translation, after: (preview.value as any).changes[0].after }] });
  expect(history[0]!.agentRequestHash).toBe(createHash('sha256').update(JSON.stringify(['reference-identifiers', f.args.documentId, f.row.id, f.row.fieldId, f.s.sourceHash, f.args.revision, f.args.reason])).digest('hex'));
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: true, value: { alreadyApplied: true } });
  expect(writes).toHaveLength(1); expect(readReviewHistory(copy.flags)).toHaveLength(1);
  for (const conflict of [{ reason: 'Different reason' }, { revision: '0'.repeat(64) }, { rowId: rows.find(row => row.id !== f.row.id)!.id }]) expect(await f.call('restore_reference_identifiers', { ...f.saveArgs, ...conflict })).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
  expect(f.resolver.mock.calls.some(([uuid]) => uuid === missingSpell)).toBe(false); expect(JSON.stringify(source)).toBe(original); expect(writes).toHaveLength(1);
});
it('keeps rebuild target required and pair repair never resolves unchanged UUID despite target fingerprint changes', async () => {
  const f = await twoFixture();
  const prepared = await f.call('prepare_reference_rebuild', { documentId: f.s.entry.uuid, fieldId: f.row.fieldId });
  expect(prepared).toMatchObject({ ok: true, value: { canApply: false, targets: expect.arrayContaining([expect.objectContaining({ target: missingSpell, exists: false, required: true })]) } });
  const value = prepared.value as any, edits = value.plan.rows.map((row: any) => ({ rowId: row.rowId, text: row.edit.text, labels: [] }));
  const args = { documentId: f.s.entry.uuid, fieldId: f.row.fieldId, revision: value.revision, planHash: value.planHash, edits, reason: 'Rebuild references', operationId: crypto.randomUUID() };
  expect(await f.call('validate_reference_rebuild', Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'operationId')))).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  expect(await f.call('apply_reference_rebuild', args)).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  f.resolver.mockClear(); expect(await f.call('validate_reference_identifiers', f.args)).toMatchObject({ ok: true });
  f.setTargetVersion(1); expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: true });
  expect(f.resolver.mock.calls.some(([uuid]) => uuid === missingSpell)).toBe(false);
  expect(copy.pages[0]!.text!.content).toContain(`@UUID[${missingSpell}]{Testovací obnova}`); expect(writes).toHaveLength(1);
});
it('undo reconstructs pair while preserving unrelated later prose and refuses a post-undo retry', async () => {
  const f = await twoFixture(), before = copy.pages[0]!.text!.content!;
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: true });
  const s = await snapshot(), other = s.rows.find(row => row.translation.join('') === 'Jiný text.')!;
  await saveReviewRows(s, [{ rowId: other.id, parts: ['Pozdější jazyková oprava.'] }]);
  expect(await f.call('undo_correction', { documentId: f.args.documentId, operationId: f.saveArgs.operationId })).toMatchObject({ ok: true, value: { undone: true } });
  expect(copy.pages[0]!.text!.content).toBe(before.replace('Jiný text.', 'Pozdější jazyková oprava.'));
  expect(readReviewHistory(copy.flags).find(h => h.id === f.saveArgs.operationId)!.undoneAt).toBeTruthy(); const n = writes.length;
  expect(await f.call('undo_correction', { documentId: f.args.documentId, operationId: f.saveArgs.operationId })).toMatchObject({ ok: true, value: { alreadyUndone: true } });
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } }); expect(writes).toHaveLength(n);
});
it.each(['affected-row', 'source'])('refuses pair undo after %s conflict', async conflict => {
  const f = await twoFixture(); expect((await f.call('restore_reference_identifiers', f.saveArgs)).ok).toBe(true);
  if (conflict === 'source') source.pages[0]!.text!.content += '<p>Concurrent source.</p>'; else copy.pages[0]!.text!.content = copy.pages[0]!.text!.content!.replace('Použij', 'Novější oprava');
  const n = writes.length; expect(await f.call('undo_correction', { documentId: f.args.documentId, operationId: f.saveArgs.operationId })).toMatchObject({ ok: false, error: { code: 'Review.UndoConflict' } }); expect(writes).toHaveLength(n);
});
it('service recomputes exact pair and rejects caller-injected prose/UUID, half repair and mixed modes', async () => {
  const f = await twoFixture(), repair = referenceIdentifierRepairDraft(f.s, f.row.fieldId)!;
  for (const parts of [repair.changes[0]!.parts.map(p => p.replace('&Reference[incapacitated]', '&Reference[neschopný pohybu]')), repair.changes[0]!.parts.map(p => p + ' Injected.'), repair.changes[0]!.parts.map(p => p.replace('syntheticSpell', 'wrong'))]) await expect(saveReviewRows(f.s, [{ rowId: f.row.id, parts }], { identifierRepair: true })).rejects.toThrow('ProtectedText');
  await expect(saveReviewRows(f.s, repair.changes, { identifierRepair: true, repairReferences: true })).rejects.toThrow('ProtectedText');
  await expect(saveReviewRows(f.s, repair.changes, { identifierRepair: true, canWrite: () => false })).rejects.toThrow('Live.Disconnected'); expect(writes).toHaveLength(0);
});
it.each(['language', 'system', 'module', 'version', 'GM', 'locked', 'run', 'disconnect', 'source', 'current'])('rechecks %s gate between pair preview and save', async gate => {
  const f = await twoFixture(); expect((await f.call('validate_reference_identifiers', f.args)).ok).toBe(true); const g = game as any;
  if (gate === 'language') g.settings.get = () => 'de';
  if (gate === 'system') g.system = { id: 'other-system' };
  if (gate === 'module') g.modules = new Map([['ember', { active: true, version: '0.6.2' }]]);
  if (gate === 'version') g.modules = new Map([['ember', { active: false, version: 'changed' }]]);
  if (gate === 'GM') g.user.isGM = false; if (gate === 'locked') locked = true;
  if (gate === 'run') activeTranslations.start('Guide', 'cs'); if (gate === 'disconnect') f.disconnect();
  if (gate === 'source') source.pages[0]!.text!.content += '<p>Concurrent source.</p>';
  if (gate === 'current') copy.pages[0]!.text!.content += '<p>Concurrent translation.</p>';
  const expected = ['language', 'system', 'module', 'version', 'GM'].includes(gate) ? 'Live.ScopeChanged' : gate === 'locked' ? 'Review.Locked' : gate === 'run' ? 'Review.PauseFirst' : gate === 'disconnect' ? 'Live.Disconnected' : 'Review.Conflict';
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: expected } }); expect(writes).toHaveLength(0);
});
it('rechecks source race immediately before atomic pair persistence', async () => {
  const f = await twoFixture(); let reads = 0;
  vi.stubGlobal('fromUuid', async (uuid: string) => { if (uuid !== 'JournalEntry.source') return null; if (++reads === 3) source.pages[0]!.text!.content += '<p>Racing source.</p>'; return sourceDocument; });
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } }); expect(writes).toHaveLength(0);
});
it('rejects caller text, targets, labels/options and foreign fields before identifier dispatch', async () => {
  const f = await twoFixture();
  for (const extra of [{ text: ['Injected'] }, { labels: [] }, { options: [] }, { uuid: missingSpell }, { command: '@UUID[Item.other]' }, { fieldId: f.row.fieldId }, { restoreSourceNumbers: true }, { restoreSourceReferences: true }, { edits: [] }]) {
    expect(await f.call('restore_reference_identifiers', { ...f.saveArgs, ...extra })).toMatchObject({ ok: false, error: { code: 'Live.InvalidRequest' } });
  }
  expect(writes).toHaveLength(0);
});
it('reconciles a lost mock persistence response from actual history with an exact retry and no second write', async () => {
  const f = await twoFixture(), persist = copyDocument.update;
  copyDocument.update = async (patch: any) => { await persist(patch); throw new Error('Lost mock update response'); };
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: false });
  expect(writes).toHaveLength(1); expect(readReviewHistory(copy.flags)[0]).toMatchObject({ id: f.saveArgs.operationId, identifierRepair: true });
  copyDocument.update = persist;
  expect(await f.call('restore_reference_identifiers', f.saveArgs)).toMatchObject({ ok: true, value: { alreadyApplied: true } });
  expect(writes).toHaveLength(1); expect(readReviewHistory(copy.flags)).toHaveLength(1);
});
it('undo of the synthetic99 field preserves one subsequent unrelated row edit and restores both exact IDs', async () => {
  const f = await twoFixture(true), raw = copy.pages[0]!.text!.content!;
  expect((await f.call('restore_reference_identifiers', f.saveArgs)).ok).toBe(true);
  const s = await snapshot(), other = s.rows.find(row => row.fieldId === f.row.fieldId && row.id !== f.row.id && !row.heading && row.translation.length === 1 && !/[&@<>]|\[\[/u.test(row.translation[0]!) && raw.includes(row.translation[0]!))!;
  expect(other).toBeDefined(); const later = `${other.translation[0]} Pozdější jazyková oprava.`;
  await saveReviewRows(s, [{ rowId: other.id, parts: [later] }]);
  expect(await f.call('undo_correction', { documentId: f.args.documentId, operationId: f.saveArgs.operationId })).toMatchObject({ ok: true, value: { undone: true } });
  expect(copy.pages[0]!.text!.content).toBe(raw.replace(other.translation[0]!, later));
  expect((await snapshot()).rows.filter(row => row.fieldId === f.row.fieldId && row.blocked === 'StructureChanged')).toHaveLength(99);
});

// Additional integration seams use generated fictional data, never captured world text.
async function integratedFixture(full99=false){
  const g=game as any;g.system={id:'crucible'};g.modules=new Map([['ember',{active:true,version:'0.6.2'}],[MODULE_ID,{active:true,version:'0.34.17'}]]);g.settings.get=(_n:string,key:string)=>key==='targetLanguage'?'cs':undefined;
  return twoFixture(full99);
}
async function integratedBatch(f:Awaited<ReturnType<typeof twoFixture>>,rowIds:string[]){
  const contexts:any[]=[];
  for(const rowId of rowIds){const r:any=await f.call('get_context',{documentId:f.args.documentId,rowId});expect(r.ok,JSON.stringify(r)).toBe(true);contexts.push(r.value);}
  const args={documentId:f.args.documentId,revision:contexts[0].revision,reason:'Ordinary batch after exact identifier restoration.',changes:contexts.map(c=>({rowId:c.rowId,text:c.edit.text.map((t:string)=>t+' '),labels:[],reason:'Whitespace-only edit preserving commands and quantities.'}))};
  const preview:any=await f.call('validate_correction_batch',args);expect(preview.ok,JSON.stringify(preview)).toBe(true);
  return {args,preview,save:{...args,planHash:preview.value.planHash,operationId:crypto.randomUUID()}};
}
it('integrates fictional full99 identifier repair with ordinary batch, exact retry and ordered whole-operation undo',async()=>{
  const f=await integratedFixture(true),before=copy.pages[0]!.text!.content!,sourceBefore=JSON.stringify(source);
  const blocked:any=await f.call('get_context',{documentId:f.args.documentId,rowId:f.row.id});
  expect((await f.call('validate_correction_batch',{documentId:f.args.documentId,revision:blocked.value.revision,reason:'Refuse ordinary editing while structurally blocked.',changes:[{rowId:f.row.id,text:blocked.value.edit.text.map((t:string)=>t+' '),labels:[],reason:'No structural bypass.'}]})).ok).toBe(false);expect(writes).toHaveLength(0);
  expect((await f.call('restore_reference_identifiers',f.saveArgs)).ok).toBe(true);const repaired=copy.pages[0]!.text!.content!,after=await snapshot(),rows=after.rows.filter(r=>r.fieldId===f.row.fieldId);
  expect(rows).toHaveLength(99);expect(rows.every(r=>!r.blocked&&!r.verified)).toBe(true);const other=rows.find(r=>r.id!==f.row.id)!;
  const batch=await integratedBatch(f,[f.row.id,other.id]);const saved:any=await f.call('save_correction_batch',batch.save);expect(saved.ok,JSON.stringify(saved)).toBe(true);expect(saved.value.operation.rows).toHaveLength(2);expect(writes).toHaveLength(2);expect(writes.every(w=>w.kind==='root')).toBe(true);
  expect(await f.call('save_correction_batch',batch.save)).toMatchObject({ok:true,value:{alreadyApplied:true}});expect(writes).toHaveLength(2);expect(readReviewHistory(copy.flags)).toHaveLength(2);
  expect(await f.call('get_correction_operation',{documentId:f.args.documentId,operationId:batch.save.operationId})).toMatchObject({ok:true,value:{complete:true,affectedRowsCompatible:true}});
  expect(await f.call('undo_correction',{documentId:f.args.documentId,operationId:f.saveArgs.operationId})).toMatchObject({ok:false,error:{code:'Review.UndoConflict'}});expect(writes).toHaveLength(2);
  expect((await f.call('undo_correction',{documentId:f.args.documentId,operationId:batch.save.operationId})).ok).toBe(true);expect(copy.pages[0]!.text!.content).toBe(repaired);
  expect((await f.call('undo_correction',{documentId:f.args.documentId,operationId:f.saveArgs.operationId})).ok).toBe(true);expect(copy.pages[0]!.text!.content).toBe(before);expect(writes).toHaveLength(4);
  expect(await f.call('undo_correction',{documentId:f.args.documentId,operationId:batch.save.operationId})).toMatchObject({ok:true,value:{alreadyUndone:true,undoneRowsCompatible:false}});expect(writes).toHaveLength(4);expect(JSON.stringify(source)).toBe(sourceBefore);expect(f.resolver.mock.calls.some(([uuid])=>uuid===missingSpell)).toBe(false);
});
it('keeps repair and batch operation IDs distinct and reconciles a lost batch reply after repair without another write',async()=>{
  const f=await integratedFixture();expect((await f.call('restore_reference_identifiers',f.saveArgs)).ok).toBe(true);const batch=await integratedBatch(f,[f.row.id]);
  expect(await f.call('save_correction_batch',{...batch.save,operationId:f.saveArgs.operationId})).toMatchObject({ok:false,error:{code:'Live.OperationConflict'}});expect(writes).toHaveLength(1);
  const persist=copyDocument.update;copyDocument.update=async(patch:any)=>{await persist(patch);throw Error('Lost integrated mock batch reply')};expect((await f.call('save_correction_batch',batch.save)).ok).toBe(false);expect(writes).toHaveLength(2);expect(readReviewHistory(copy.flags)).toHaveLength(2);copyDocument.update=persist;
  expect(await f.call('get_correction_operation',{documentId:f.args.documentId,operationId:batch.save.operationId})).toMatchObject({ok:true,value:{complete:true,affectedRowsCompatible:true}});
  expect(await f.call('save_correction_batch',batch.save)).toMatchObject({ok:true,value:{alreadyApplied:true}});expect(writes).toHaveLength(2);
});

it('binds diagnostic revision to identifier repair, ordinary save, batch and undo snapshots',async()=>{
 const f=await integratedFixture(),original=JSON.stringify(source);
 const context=async()=>{const r:any=await f.call('get_context',{documentId:f.args.documentId,rowId:f.row.id});expect(r.ok).toBe(true);return r.value;};
 const diagnostic=async(c:any)=>f.call('get_reference_diagnostic',{documentId:f.args.documentId,rowId:f.row.id,referenceIndex:0,revision:c.revision});
 let previous=await context();expect(await diagnostic(previous)).toMatchObject({ok:true,value:{predicate:'root-unresolved'}});expect(writes).toHaveLength(0);
 expect((await f.call('restore_reference_identifiers',f.saveArgs)).ok).toBe(true);expect(await diagnostic(previous)).toMatchObject({ok:false,error:{code:'Review.Conflict'}});
 previous=await context();expect((await diagnostic(previous)).ok).toBe(true);
 const ordinary={documentId:f.args.documentId,rowId:f.row.id,revision:previous.revision,text:previous.edit.text.map((t:string)=>t+' '),labels:[],reason:'Ordinary whitespace preserving source commands.',operationId:crypto.randomUUID()};
 expect((await f.call('validate_correction',Object.fromEntries(Object.entries(ordinary).filter(([k])=>k!=='operationId')))).ok).toBe(true);expect((await f.call('save_correction',ordinary)).ok).toBe(true);expect(await diagnostic(previous)).toMatchObject({ok:false,error:{code:'Review.Conflict'}});
 previous=await context();expect((await diagnostic(previous)).ok).toBe(true);
 const batch=await integratedBatch(f,[f.row.id]);expect((await f.call('save_correction_batch',batch.save)).ok).toBe(true);expect(await diagnostic(previous)).toMatchObject({ok:false,error:{code:'Review.Conflict'}});
 previous=await context();expect((await diagnostic(previous)).ok).toBe(true);
 expect((await f.call('undo_correction',{documentId:f.args.documentId,operationId:batch.save.operationId})).ok).toBe(true);expect(await diagnostic(previous)).toMatchObject({ok:false,error:{code:'Review.Conflict'}});
 expect((await diagnostic(await context())).ok).toBe(true);expect(writes).toHaveLength(4);expect(JSON.stringify(source)).toBe(original);
});
