import { diagnoseReferenceRebuild as peerDiagnose } from "../src/review/reference-rebuild";
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
  vi.stubGlobal("game", { user: { isGM: true, id: "gm", name: "Reviewer" }, world: { id: "test-world", title: "Test world" }, system: { id: "crucible" }, modules: new Map([["ember", { active: true, version: "0.6.2" }]]), settings: { get: () => undefined }, i18n: { localize: (key: string) => key }, packs: new Map([[packId, pack]]) });
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


async function rebuildFixture(sourceContent = '<p>Use @UUID[Actor.a.Item.b]{Ability} in 3 rounds.</p><p>The area is &amp;Reference[Lightly Obscured].</p><p>Unchanged paragraph.</p>',
  translatedContent = '<p>Použij @UUID[Actor.a]{Schopnost} za 3 kola.</p><p>Oblast je &amp;Odkaz[Lehce Zastřená].</p><p>Beze změny.</p>') {
  source.pages[0]!.text!.content = sourceContent;
  copy.pages[0]!.text!.content = translatedContent;
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : { uuid, documentName: uuid.endsWith('.Item.b') ? 'Item' : 'Actor' });
  vi.spyOn(GlossaryCompendiumRepository.prototype, 'loadExisting').mockResolvedValue([]);
  let connected = true;
  const handle = createLiveHandler('cs', () => connected);
  const s = await snapshot(), fieldId = textRow(s).fieldId;
  const call = (method: string, args: Record<string, unknown> = {}) => handle({ id: crypto.randomUUID(), method, args });
  const prepared = await call('prepare_reference_rebuild', { documentId: s.entry.uuid, fieldId });
  expect(prepared).toMatchObject({ ok: true });
  const value = prepared.value as any;
  const args = { documentId: s.entry.uuid, fieldId, revision: value.revision, planHash: value.planHash,
    edits: value.plan.rows.map((row: any) => ({ rowId: row.rowId, text: [...row.edit.text] })),
    reason: 'Restore exact source references while preserving prose', operationId: crypto.randomUUID() };
  return { s, value, args, call, disconnect: () => { connected = false; } };
}
it('prepares full source/current parts and atomically saves a source-owned field with retry and undo receipts', async () => {
  const f = await rebuildFixture(), sourceBefore = JSON.stringify(source), before = copy.pages[0]!.text!.content;
  expect(f.value).toMatchObject({ willVerify: false, canApply: true, plan: { rows: expect.any(Array) }, targets: expect.any(Array) });
  expect(f.value.plan.rows).toHaveLength(2); expect(writes).toHaveLength(0);
  const { operationId, ...previewArgs } = f.args;
  const preview = await f.call('validate_reference_rebuild', previewArgs);
  expect(preview).toMatchObject({ ok: true, value: { willVerify: false, changes: expect.any(Array), numberRepair: { requested: false, parts: expect.any(Array) } } });
  expect(writes).toHaveLength(0);
  const saved = await f.call('apply_reference_rebuild', f.args);
  expect(saved).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(writes).toHaveLength(1); expect(copy.pages[0]!.text!.content).toContain('@UUID[Actor.a.Item.b]');
  expect(copy.pages[0]!.text!.content).toContain('&amp;Reference[Lightly Obscured]');
  expect(copy.pages[0]!.text!.content).toContain('<p>Beze změny.</p>');
  expect(JSON.stringify(source)).toBe(sourceBefore);
  expect(readReviewHistory(copy.flags)[0]).toMatchObject({ id: operationId, referenceRebuild: { fieldId: f.args.fieldId } });
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: true, value: { alreadyApplied: true, verified: false } });
  expect(writes).toHaveLength(1);
  expect(await f.call('apply_reference_rebuild', { ...f.args, reason: 'Changed operation meaning' })).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
  expect(await f.call('undo_correction', { documentId: f.args.documentId, operationId })).toMatchObject({ ok: true, value: { undone: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toBe(before);
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
});
it('previews and atomically saves a source-owned punctuation leaf with a missing reference, retry and exact layout undo', async () => {
  const sourceHtml = '<p>First<strong>,</strong> then &amp;Reference[Exhaustion] for 2 turns.</p><p>Keep another paragraph.</p>';
  const targetHtml = '<p>První<strong></strong> potom na 2 tahy.</p><p>Další odstavec.</p>';
  const f = await rebuildFixture(sourceHtml, targetHtml), beforeSource = JSON.stringify(source);
  expect(f.value.plan.punctuation).toEqual({ parentPath: [0, 1], text: ',', unitId: 'html/0', partIndex: 1 });
  expect(f.value.plan.rows[0]).toMatchObject({ before: ['První', ' potom na 2 tahy.'], alignedBefore: ['První', ',', ' potom na 2 tahy.'] });
  const planned = f.value.plan.rows[0];
  f.args.edits[0]!.text[2] = ` potom ${planned.edit.references[2][0].marker} na 2 tahy.`;
  const { operationId, ...previewArgs } = f.args;
  expect(await f.call('validate_reference_rebuild', previewArgs)).toMatchObject({ ok: true, value: { changes: [{ warnings: [] }], willVerify: false } });
  expect(writes).toHaveLength(0);
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(writes).toHaveLength(1);
  expect(copy.pages[0]!.text!.content).toBe('<p>První<strong>,</strong> potom &amp;Reference[Exhaustion] na 2 tahy.</p><p>Další odstavec.</p>');
  expect(JSON.stringify(source)).toBe(beforeSource);
  expect(readReviewHistory(copy.flags)[0]).toMatchObject({ id: operationId, referenceRebuild: { punctuation: f.value.plan.punctuation } });
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: true, value: { alreadyApplied: true } });
  expect(writes).toHaveLength(1);
  expect(await f.call('undo_correction', { documentId: f.args.documentId, operationId })).toMatchObject({ ok: true, value: { undone: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toBe(targetHtml);
  expect(writes).toHaveLength(2);
});
it('keeps EXACT glossary authority on the aligned prose after the restored punctuation and refuses its loss', async () => {
  const f = await rebuildFixture('<p>First<strong>,</strong> then Exact Name and &amp;Reference[Exhaustion].</p>',
    '<p>První<strong></strong> potom Exact Name.</p>');
  vi.spyOn(GlossaryCompendiumRepository.prototype, 'loadExisting').mockResolvedValue([
    { source: 'Exact Name', replacement: 'Exact Name', category: 'character', aliases: [], mode: 'fixed' },
  ]);
  const prepared = await f.call('prepare_reference_rebuild', { documentId: f.args.documentId, fieldId: f.args.fieldId });
  expect(prepared).toMatchObject({ ok: true });
  const value = prepared.value as any;
  const edits = value.plan.rows.map((row: any) => ({ rowId: row.rowId, text: [...row.edit.text] }));
  edits[0].text[2] = edits[0].text[2].replace('Exact Name', 'Other Name');
  const args = { ...f.args, revision: value.revision, planHash: value.planHash, edits };
  expect(await f.call('validate_reference_rebuild', args)).toMatchObject({ ok: false });
  expect(await f.call('apply_reference_rebuild', args)).toMatchObject({ ok: false });
  expect(writes).toHaveLength(0);
});
it('repairs a punctuation-only blocked field through MCP without changing existing prose or labels, with retry and undo', async () => {
  const sourceHtml = '<p>Use <strong>a &amp;Reference[Equipment]{Tool}</strong><strong>,</strong> or borrowed clothes for 2 turns.</p><p>Keep this.</p>';
  const targetHtml = '<p>Použij <strong>nástroj &amp;Reference[Equipment]{Nástroj}</strong><strong></strong> nebo půjčené oblečení na 2 tahy.</p><p>Beze změny.</p>';
  const f = await rebuildFixture(sourceHtml, targetHtml), sourceBefore = JSON.stringify(source);
  expect(f.value.plan.rows).toHaveLength(1);
  expect(f.value.plan.rows[0].partIndices).toEqual([2]);
  expect(f.value.plan.targets).toEqual([]);
  const { operationId, ...previewArgs } = f.args;
  const preview = await f.call('validate_reference_rebuild', previewArgs);
  expect(preview).toMatchObject({ ok: true, value: { willVerify: false, changes: [{ warnings: [] }] } });
  expect(writes).toHaveLength(0);
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toBe(targetHtml.replace('<strong></strong>', '<strong>,</strong>'));
  expect((await snapshot()).rows.every(row => !row.blocked && !row.verified)).toBe(true);
  expect(JSON.stringify(source)).toBe(sourceBefore);
  expect(readReviewHistory(copy.flags)[0]).toMatchObject({ id: operationId, referenceRebuild: { punctuation: f.value.plan.punctuation } });
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: true, value: { alreadyApplied: true, verified: false } });
  expect(writes).toHaveLength(1);
  expect(await f.call('undo_correction', { documentId: f.args.documentId, operationId })).toMatchObject({ ok: true, value: { undone: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toBe(targetHtml);
});
it('rejects missing/extra plan rows, unknown labels, stale revision/hash and missing immutable targets without writes', async () => {
  const f = await rebuildFixture(); const { operationId, ...args } = f.args;
  for (const unsafe of [ { ...args, edits: args.edits.slice(0, 1) }, { ...args, edits: [...args.edits, { rowId: 'e'.repeat(64), text: ['Extra'] }] },
    { ...args, planHash: 'd'.repeat(64) }, { ...args, revision: 'd'.repeat(64) },
    { ...args, edits: args.edits.map((edit: any, index: number) => index ? edit : { ...edit, labels: [{ marker: '⟦999⟧', label: 'Invented' }] }) } ]) {
    expect(await f.call('validate_reference_rebuild', unsafe)).toMatchObject({ ok: false });
    expect(await f.call('apply_reference_rebuild', { ...unsafe, operationId })).toMatchObject({ ok: false });
  }
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : null);
  expect(await f.call('prepare_reference_rebuild', { documentId: args.documentId, fieldId: args.fieldId })).toMatchObject({ ok: true, value: { canApply: false } });
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  expect(writes).toHaveLength(0);
});
it('checks glossary/source/scope and write-time run, lock and GM gates', async () => {
  const f = await rebuildFixture();
  vi.spyOn(GlossaryCompendiumRepository.prototype, 'loadExisting').mockResolvedValue([{ id: 'term', source: 'Area', replacement: 'Oblast', aliases: [], enabled: true, mode: 'exact' }] as any);
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  vi.spyOn(GlossaryCompendiumRepository.prototype, 'loadExisting').mockResolvedValue([]);
  locked = true; expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false }); locked = false;
  const run = activeTranslations.start('Test', 'cs', 'JournalEntry.source');
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false }); activeTranslations.finish(run);
  source.pages[0]!.text!.content += '<p>Changed source.</p>';
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  f.disconnect(); expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.Disconnected' } });
  expect(writes).toHaveLength(0);
});
it('rejects same-total cross-part numeric swaps and restores only source-proven parts', async () => {
  const f = await rebuildFixture('<p>Use @UUID[Actor.a.Item.b]{Ability} in 3 rounds.</p><p>&amp;Reference[Poisoned] lasts 4 rounds.</p>',
    '<p>Použij @UUID[Actor.a]{Schopnost} za 4 kola.</p><p>&amp;Odkaz[Otrávený] trvá 3 kola.</p>');
  const { operationId, ...args } = f.args;
  const edits = args.edits.map((edit: any, index: number) => ({ ...edit, text: edit.text.map((text: string) => text.replace(index ? /3/gu : /4/gu, index ? '4' : '3')) }));
  expect(await f.call('apply_reference_rebuild', { ...f.args, edits })).toMatchObject({ ok: false });
  const valid = { ...args, edits, restoreSourceNumbers: true };
  expect(await f.call('validate_reference_rebuild', valid)).toMatchObject({ ok: true, value: { numberRepair: { requested: true, allowed: true } } });
  expect(await f.call('apply_reference_rebuild', { ...valid, operationId })).toMatchObject({ ok: true, value: { saved: true, verified: false } });
});
it('binds retry to every payload field and refuses affected-row undo conflicts', async () => {
  const f = await rebuildFixture();
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: true });
  for (const changed of [ { ...f.args, restoreSourceNumbers: true }, { ...f.args, planHash: 'f'.repeat(64) },
    { ...f.args, edits: f.args.edits.map((edit: any, index: number) => index ? edit : { ...edit, labels: [{ marker: '⟦1⟧', label: 'Jiné' }] }) } ])
    expect(await f.call('apply_reference_rebuild', changed)).toMatchObject({ ok: false, error: { code: 'Live.OperationConflict' } });
  copy.pages[0]!.text!.content = copy.pages[0]!.text!.content!.replace('Beze změny.', 'Jiný pozdější text.');
  expect(await f.call('undo_correction', { documentId: f.args.documentId, operationId: f.args.operationId })).toMatchObject({ ok: true });
  expect(copy.pages[0]!.text!.content).toContain('Jiný pozdější text.');
  const fresh = await rebuildFixture();
  expect(await fresh.call('apply_reference_rebuild', fresh.args)).toMatchObject({ ok: true });
  copy.pages[0]!.text!.content = copy.pages[0]!.text!.content!.replace('3', '5');
  expect(await fresh.call('undo_correction', { documentId: fresh.args.documentId, operationId: fresh.args.operationId })).toMatchObject({ ok: false });
});
it('refuses targets resolving to a different UUID or kind and revoked GM access', async () => {
  const f = await rebuildFixture();
  for (const doc of [{ uuid: 'Actor.other.Item.b', documentName: 'Item' }, { uuid: 'Actor.a.Item.b', documentName: 'Actor' }]) {
    vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : doc);
    expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  }
  (game.user as any).isGM = false;
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ScopeChanged' } });
  expect(writes).toHaveLength(0);
});
it('requires untouched formatted parts to stay byte-identical and refuses raw commands in explicit prose', async () => {
  const f = await rebuildFixture('<p>Use @UUID[Actor.a.Item.b]{Ability} <strong>after 3 rounds.</strong></p>',
    '<p>Použij @UUID[Actor.a]{Schopnost} <strong>po 3 kolech.</strong></p>');
  const edit = f.args.edits[0]!;
  expect(f.value.plan.rows[0].partIndices).toEqual([0]);
  expect(edit.text[1]).toBe('po 3 kolech.');
  for (const text of [[edit.text[0], 'po 4 kolech.'], [edit.text[0] + ' @UUID[Actor.other]', edit.text[1]]]) {
    expect(await f.call('apply_reference_rebuild', { ...f.args, edits: [{ ...edit, text }] })).toMatchObject({ ok: false });
  }
  expect(writes).toHaveLength(0);
});
it('rechecks glossary after asynchronous target validation immediately before the atomic write', async () => {
  const f = await rebuildFixture();
  let reads = 0;
  vi.stubGlobal('fromUuid', async (uuid: string) => {
    if (uuid === 'JournalEntry.source') return sourceDocument;
    if (++reads === 2) vi.spyOn(GlossaryCompendiumRepository.prototype, 'loadExisting').mockResolvedValue([{ id: 'changed', source: 'Ability', replacement: 'Schopnost', aliases: [], mode: 'exact' }] as any);
    return { uuid, documentName: 'Item' };
  });
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  expect(reads).toBe(2); expect(writes).toHaveLength(0);
});
it('declines a no-op source-number override even when references need rebuilding', async () => {
  const f = await rebuildFixture();
  expect(await f.call('apply_reference_rebuild', { ...f.args, restoreSourceNumbers: true })).toMatchObject({ ok: false, error: { code: 'Review.NumbersChanged' } });
  expect(writes).toHaveLength(0);
});
const gateSource = '<div class="system-swap-block"><div data-system="dnd5e"><p>Use @UUID[Actor.a.Item.b]{Ability} in 3 rounds.</p></div><div data-system="crucible"><p>The area is &amp;Reference[Lightly Obscured].</p></div></div>';
const gateCopy = '<div class="system-swap-block"><div data-system="dnd5e"><p>Použij @UUID[Actor.a]{Schopnost} za 3 kola.</p></div><div data-system="crucible"><p>Oblast je &amp;Odkaz[Lehce Zastřená].</p></div></div>';
it('shows an unavailable exact inactive Ember source branch and preserves it in a validated atomic rebuild', async () => {
  const f = await rebuildFixture(gateSource, gateCopy);
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : null);
  const preview = await f.call('prepare_reference_rebuild', { documentId: f.args.documentId, fieldId: f.args.fieldId });
  expect(preview).toMatchObject({ ok: true, value: { canApply: true, systemId: 'crucible', targets: [{ required: false, inactiveSystem: 'dnd5e', exists: false, availability: 'missing-preserved-from-source' }] } });
  const { operationId, ...args } = f.args;
  expect(await f.call('validate_reference_rebuild', args)).toMatchObject({ ok: true, value: { willVerify: false } });
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: true, value: { saved: true, verified: false } });
  expect(copy.pages[0]!.text!.content).toContain('@UUID[Actor.a.Item.b]');
  expect(copy.pages[0]!.text!.content).toContain('data-system="dnd5e"');
});
it('requires a missing target also used in any ungated source occurrence, including an unaffected row', async () => {
  const f = await rebuildFixture(gateSource + '<p>Also @UUID[Actor.a.Item.b]{Ability}.</p>', gateCopy + '<p>Také @UUID[Actor.a.Item.b]{Schopnost}.</p>');
  vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : null);
  expect(await f.call('prepare_reference_rebuild', { documentId: f.args.documentId, fieldId: f.args.fieldId })).toMatchObject({ ok: true, value: { canApply: false, targets: [{ required: true, exists: false }] } });
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  expect(writes).toHaveLength(0);
});
it('binds prepared inactive branches to the actual system and rejects a changed active system', async () => {
  const f = await rebuildFixture(gateSource, gateCopy);
  (game as any).system.id = 'dnd5e';
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ScopeChanged' } });
  const handle = createLiveHandler('cs', () => true);
  const old = await handle({ id: crypto.randomUUID(), method: 'apply_reference_rebuild', args: f.args });
  expect(old).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  const preview = await handle({ id: crypto.randomUUID(), method: 'prepare_reference_rebuild', args: { documentId: f.args.documentId, fieldId: f.args.fieldId } });
  expect(preview).toMatchObject({ ok: true, value: { systemId: 'dnd5e', targets: [{ required: true }] } });
  expect(writes).toHaveLength(0);
});
it('never treats unknown, nested or wrong source gate wrappers as an inactive availability proof', async () => {
  for (const [prefix, suffix] of [
    ['<div class="system-swap-block"><span data-system="dnd5e">', '</span></div>'],
    ['<div class="system-swap-block"><div data-system="unknown">', '</div></div>'],
    ['<div class="system-swap-block"><div data-system="dnd5e"><div class="system-swap-block"><div data-system="crucible">', '</div></div></div></div>'],
  ]) {
    const f = await rebuildFixture(prefix + '<p>Use @UUID[Actor.a.Item.b]{Ability} in 3 rounds.</p>' + suffix,
      prefix + '<p>Použij @UUID[Actor.a]{Schopnost} za 3 kola.</p>' + suffix);
    vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : null);
    expect(await f.call('prepare_reference_rebuild', { documentId: f.args.documentId, fieldId: f.args.fieldId })).toMatchObject({ ok: true, value: { canApply: false } });
    expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  }
  expect(writes).toHaveLength(0);
});
it('requires target existence without the exact supported active Ember renderer', async () => {
  for (const ember of [{ active: false, version: '0.6.2' }, { active: true, version: 'unknown' }]) {
    (game as any).modules.set('ember', ember);
    const f = await rebuildFixture(gateSource, gateCopy);
    vi.stubGlobal('fromUuid', async (uuid: string) => uuid === 'JournalEntry.source' ? sourceDocument : null);
    expect(await f.call('prepare_reference_rebuild', { documentId: f.args.documentId, fieldId: f.args.fieldId })).toMatchObject({ ok: true, value: { canApply: false, targets: [{ required: true }] } });
    expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ReferenceTargetMissing' } });
  }
  expect(writes).toHaveLength(0);
});
it('rejects renderer changes after a prepare, including during asynchronous target reads', async () => {
  const f = await rebuildFixture(gateSource, gateCopy);
  (game as any).modules.get('ember').active = false;
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ScopeChanged' } });
  (game as any).modules.get('ember').active = true;
  vi.stubGlobal('fromUuid', async (uuid: string) => {
    if (uuid === 'JournalEntry.source') return sourceDocument;
    (game as any).modules.get('ember').version = 'other';
    return null;
  });
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Live.ScopeChanged' } });
  expect(writes).toHaveLength(0);
});
it('never trusts a gate fabricated only in the translated HTML', async () => {
  const f = await rebuildFixture();
  copy.pages[0]!.text!.content = '<div class="system-swap-block"><div data-system="dnd5e">' + copy.pages[0]!.text!.content + '</div></div>';
  expect(await f.call('apply_reference_rebuild', f.args)).toMatchObject({ ok: false, error: { code: 'Review.Conflict' } });
  const fresh = await f.call('prepare_reference_rebuild', { documentId: f.args.documentId, fieldId: f.args.fieldId });
  expect(fresh).toMatchObject({ ok: false });
  expect(writes).toHaveLength(0);
});


// Read-only generic diagnostic route fixtures; no production/private prose.
async function diagnosticFixture() {
  source.pages[0]!.text!.content = '<p title="Source">First<strong>,</strong> then second.</p>';
  copy.pages[0]!.text!.content = '<p title="Překlad">První<strong></strong> a druhá.</p>';
  (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
  sourceDocument.testUserPermission = () => true; copyDocument.testUserPermission = () => true;
  copy.flags![MODULE_ID]!.secretForTest = 'NEVER_RETURN_SECRET';
  vi.spyOn(GlossaryCompendiumRepository.prototype, 'loadExisting').mockResolvedValue([]);
  const handle = createLiveHandler('cs', () => true), s = await snapshot(), row = textRow(s);
  const call = (method: string, args: Record<string, unknown>) => handle({ id: crypto.randomUUID(), method, args });
  const context = await call('get_context', { documentId: s.entry.uuid, rowId: row.id, radius: 0 });
  expect(context.ok).toBe(true);
  const args = { documentId: s.entry.uuid, fieldId: row.fieldId, revision: (context.value as any).revision };
  return { call, args };
}
it('read-only diagnostic returns exact one portable field with actual failing predicate and no flags/users/writes', async () => {
  const f = await diagnosticFixture(), original = JSON.stringify(source), translated = JSON.stringify(copy);
  const result = await f.call('get_field_diagnostic', f.args);
  expect(result).toMatchObject({ ok: true, value: { raw: { complete: true }, rebuild: { canPrepare: false, punctuation: { predicate: 'all-raw-attributes-equal' } } } });
  expect(JSON.stringify(result)).not.toContain('NEVER_RETURN_SECRET');
  expect(JSON.stringify(source)).toBe(original);
  expect(JSON.stringify(copy)).toBe(translated); expect(writes).toHaveLength(0);
});
it.each(['permission', 'source', 'scope'])('read-only diagnostic discards result if %s changes across awaits', async kind => {
  const f = await diagnosticFixture(); let permissions = 0;
  sourceDocument.testUserPermission = () => {
    permissions++;
    if (kind === 'permission') return permissions < 2;
    if (permissions === 1 && kind === 'source') source.pages[0]!.text!.content += '<p>Changed source.</p>';
    if (permissions === 1 && kind === 'scope') (game.user as any).isGM = false;
    return true;
  };
  expect(await f.call('get_field_diagnostic', f.args)).toMatchObject({ ok: false }); expect(writes).toHaveLength(0);
});
it('read-only diagnostic rejects stale revision, unknown field and unrelated document', async () => {
  const f = await diagnosticFixture();
  for (const extra of [{ revision: 'f'.repeat(64) }, { fieldId: '["flags","secrets"]' }, { documentId: 'JournalEntry.unrelated' }])
    expect(await f.call('get_field_diagnostic', { ...f.args, ...extra })).toMatchObject({ ok: false });
  expect(writes).toHaveLength(0);
});

it('read-only diagnostic rejects registry ambiguity created after old-snapshot diagnosis', async () => {
 const f = await diagnosticFixture();
 source.pages[0]!.text!.content = '<p>Use @UUID[Actor.a.Item.b]{Ability}.</p>';
 copy.pages[0]!.text!.content = '<p>Použij @UUID[Actor.a]{Schopnost}.</p>';
 (copy.flags![MODULE_ID]!.translation as any).sourceHash = await journalSourceHash(source);
 const actorFlag = { schemaVersion:1, sourceUuid:'Actor.a',sourceHash:'source',providerId:'openai-compatible',sourceLanguage:'en',targetLanguage:'cs',translatedAt:'date',translatedHtmlFields:1 };
 let rows = [{_id:'aCopy',name:'Actor A',flags:{[MODULE_ID]:{actorTranslation:actorFlag}}}];
 (game.packs as any).set(ACTOR_TRANSLATIONS_PACK_ID,{getIndex:async()=>new Map(rows.map(x=>[x._id,x]))});
 const st = await snapshot(),row = textRow(st);
 const ctx = await f.call('get_context',{documentId:st.entry.uuid,rowId:row.id,radius:0});
 expect(ctx.ok).toBe(true);
 expect(await peerDiagnose(st,row.fieldId)).toMatchObject({canPrepare:true});
 let calls=0;
 sourceDocument.testUserPermission = () => { if (++calls===1) rows.push({_id:'aCopy2',name:'Actor A2',flags:{[MODULE_ID]:{actorTranslation:actorFlag}}});return true; };
 const result = await f.call('get_field_diagnostic',{documentId:st.entry.uuid,fieldId:row.fieldId,revision:(ctx.value as any).revision});
 const fresh = await snapshot();
 expect(await peerDiagnose(fresh,row.fieldId)).toMatchObject({canPrepare:false});
 expect(result).toMatchObject({ok:false});
 expect(writes).toHaveLength(0);
});

// Private candidate fixtures and real handler flow; entirely synthetic data.
async function retainedFixture(anchor = "#detail") {
 const sourceTarget = `Actor.a.Item.b${anchor}`;
 const f=await rebuildFixture(`<p>Use @UUID[${sourceTarget.replaceAll("&", "&amp;")}]{Ability} in 3 rounds.</p><p>Unchanged paragraph.</p>`,'<p>Použij @UUID[Actor.a]{Schopnost} za 3 kola.</p><p>Beze změny.</p>');
 const actorFlag={schemaVersion:1,sourceUuid:'Actor.a',sourceHash:'source',providerId:'openai-compatible',sourceLanguage:'en',targetLanguage:'cs',translatedAt:'date',translatedHtmlFields:1};
 const mappedRoot=`Compendium.${ACTOR_TRANSLATIONS_PACK_ID}.Actor.aCopy`,a:any={_id:'a',name:'Actor source',items:[]},b:any={_id:'aCopy',name:'Actor copy',items:[],flags:{[MODULE_ID]:{actorTranslation:actorFlag}}};
 const original:any={uuid:'Actor.a',documentName:'Actor',get flags(){return a.flags;},toObject:()=>structuredClone(a),getEmbeddedDocument:()=>null},mapped:any={uuid:mappedRoot,documentName:'Actor',get flags(){return b.flags;},toObject:()=>structuredClone(b),getEmbeddedDocument:()=>null};
 const actorRows:any[]=[{_id:'aCopy',name:'Actor copy',flags:b.flags}];(game.packs as any).set(ACTOR_TRANSLATIONS_PACK_ID,{getIndex:async()=>new Map(actorRows.map(x=>[x._id,x])),getDocument:async()=>mapped});
 const overrides=new Map<string,unknown>();let intercept:((uuid:string)=>void)|undefined;
 vi.stubGlobal('fromUuid',async(uuid:string)=>{intercept?.(uuid);if(overrides.has(uuid)){const v=overrides.get(uuid);if(v instanceof Error)throw v;return v;}return uuid==='JournalEntry.source'?sourceDocument:uuid==='Actor.a'?original:uuid===mappedRoot?mapped:null;});
 const mode={documentId:f.args.documentId,fieldId:f.args.fieldId,retainUnresolvedSourceReferences:true},prepared:any=await f.call('prepare_reference_rebuild',mode);expect(prepared.ok,JSON.stringify(prepared)).toBe(true);const value=prepared.value;
 const args={...f.args,retainUnresolvedSourceReferences:true,revision:value.revision,planHash:value.planHash,edits:value.plan.rows.map((r:any)=>({rowId:r.rowId,text:r.edit.text.map((t:string)=>t.replace('Use ','Použij ').replace(' in 3 rounds.',' za 3 kola.')),labels:r.edit.references.flat().filter((x:any)=>x.editable).map((x:any)=>({marker:x.marker,label:'Schopnost'}))}))};
 return {...f,value,args,mode,overrides,original,mapped,a,b,mappedRoot,setIntercept:(fn:(uuid:string)=>void)=>{intercept=fn;},addCopy:()=>actorRows.push({_id:'aCopy2',name:'Other',flags:b.flags})};
}
it('opt-in retains ORIGINAL anchor with complete actual stored-operation readback/idempotency/undo',async()=>{
 const f=await retainedFixture(),original=JSON.stringify(source),before=copy.pages[0]!.text!.content;
 expect(f.value).toMatchObject({canApply:true,retainUnresolvedSourceReferences:true,targets:[{required:true,retentionPolicy:'retain-exact-unresolved-original',target:'Actor.a.Item.b#detail'}],unresolvedSourceReferences:[{status:'retained-original-unresolved',humanVerified:false}]});
 const {operationId,...preview}=f.args;expect(await f.call('validate_reference_rebuild',preview)).toMatchObject({ok:true,value:{retainUnresolvedSourceReferences:true}});expect(writes).toHaveLength(0);
 const saved:any=await f.call('apply_reference_rebuild',f.args);expect(saved.ok,JSON.stringify(saved)).toBe(true);expect(saved.value).toMatchObject({saved:true,complete:true,willVerify:false,verified:false,operation:{referenceRebuild:{unresolvedSourceRetention:{requested:true}}}});
 expect(copy.pages[0]!.text!.content).toContain('@UUID[Actor.a.Item.b#detail]{Schopnost}');expect(copy.pages[0]!.text!.content).not.toContain(f.mappedRoot+'.Item.b');expect(JSON.stringify(source)).toBe(original);expect(writes).toHaveLength(1);
 expect(saved.value.operation).toEqual(readReviewHistory(copy.flags).find(x=>x.id===operationId));
 const read:any=await f.call('get_correction_operation',{documentId:f.args.documentId,operationId});expect(read).toMatchObject({ok:true,value:{complete:true,retainUnresolvedSourceReferences:true,affectedRowsCompatible:true}});expect(read.value.operationHash).toBe(saved.value.operationHash);
 expect(await f.call('apply_reference_rebuild',f.args)).toMatchObject({ok:true,value:{alreadyApplied:true,complete:true}});expect(writes).toHaveLength(1);
 expect(await f.call('apply_reference_rebuild',{...f.args,retainUnresolvedSourceReferences:false})).toMatchObject({ok:false,error:{code:'Live.OperationConflict'}});
 expect(await f.call('undo_correction',{documentId:f.args.documentId,operationId})).toMatchObject({ok:true,value:{undone:true,verified:false}});expect(copy.pages[0]!.text!.content).toBe(before);expect(JSON.stringify(source)).toBe(original);expect(writes).toHaveLength(2);
});
it('strict default and false refuse unavailable mapped child with distinct mode plan hash',async()=>{
 const f=await retainedFixture();for(const flag of [undefined,false]){const p:any=await f.call('prepare_reference_rebuild',{documentId:f.args.documentId,fieldId:f.args.fieldId,...(flag===undefined?{}:{retainUnresolvedSourceReferences:flag})});expect(p).toMatchObject({ok:true,value:{canApply:false,targets:[{required:true,exists:false,availability:'missing-required'}]}});expect(p.value.planHash).not.toBe(f.value.planHash);expect(await f.call('apply_reference_rebuild',{...f.args,retainUnresolvedSourceReferences:false,revision:p.value.revision,planHash:p.value.planHash})).toMatchObject({ok:false,error:{code:'Live.ReferenceTargetMissing'}});}expect(writes).toHaveLength(0);
});
it('warning persists after real ordinary prose correction and diagnostic remains human-false',async()=>{
 const f=await retainedFixture();expect(await f.call('apply_reference_rebuild',f.args)).toMatchObject({ok:true});const s=await snapshot(),row=s.rows.find(r=>r.translation.join('').includes('Použij'))!;let c:any=await f.call('get_context',{documentId:s.entry.uuid,rowId:row.id,radius:0});expect(c).toMatchObject({ok:true,value:{verified:false,unresolvedSourceReferences:[{status:'retained-original-unresolved',availability:'not-refreshed',humanVerified:false}]}});
 const ordinary={documentId:s.entry.uuid,rowId:row.id,revision:c.value.revision,text:c.value.edit.text.map((t:string)=>t.replace('Použij','Použij nyní')),labels:[],reason:'Reviewed Czech prose preserving exact original source identity'};
 expect(await f.call('validate_correction',ordinary)).toMatchObject({ok:true,value:{warnings:[],willVerify:false}});
 expect(await f.call('save_correction',{...ordinary,operationId:crypto.randomUUID()})).toMatchObject({ok:true,value:{saved:true,verified:false}});
 const final=await snapshot(),field=final.fields.find(x=>x.id===row.fieldId)!;
 const {assertPortableText}=await import('../src/bundles/format');const {portableReviewText}=await import('../src/review/service');const {planReviewText}=await import('../src/review/text-plan');
 assertPortableText(field.source,portableReviewText(final,field,field.translation),field.format);
 const native=planReviewText(field.translation,field.format);expect(native.units.length).toBe(planReviewText(field.source,field.format).units.length);
 for(const actual of final.rows.filter(x=>x.fieldId===field.id)) expect(native.units.find(u=>u.id===actual.unitId)?.parts).toEqual(actual.translation);
 expect(field.translation).toContain('@UUID[Actor.a.Item.b#detail]{Schopnost}');expect(field.translation).not.toContain(f.mappedRoot+'.Item.b');
 c=await f.call('get_context',{documentId:s.entry.uuid,rowId:row.id,radius:0});expect(c).toMatchObject({ok:true,value:{verified:false,unresolvedSourceReferences:[{sourceTarget:'Actor.a.Item.b#detail',status:'retained-original-unresolved'}]}});
 sourceDocument.testUserPermission=()=>true;copyDocument.testUserPermission=()=>true;copyDocument.documentName='JournalEntry';expect(await f.call('get_field_diagnostic',{documentId:s.entry.uuid,fieldId:row.fieldId,revision:c.value.revision,offset:0,limit:10})).toMatchObject({ok:true,value:{unresolvedSourceReferences:[{status:'retained-original-unresolved'}]}});
 expect(await f.call('undo_correction',{documentId:s.entry.uuid,operationId:f.args.operationId})).toMatchObject({ok:false});
});
it.each(['source-exists','mapped-exists','source-throws','mapped-throws','mapped-mismatch','serialized-source-present','serialized-mapped-present','embedded-source-present','embedded-mapped-throws','serializer-fails','provenance-changed','source-changed'])('rejects stale retention before update: %s',async fault=>{
 const f=await retainedFixture(),st='Actor.a.Item.b',mt=f.mappedRoot+'.Item.b';
 if(fault==='source-exists')f.overrides.set(st,{uuid:st,documentName:'Item'});if(fault==='mapped-exists')f.overrides.set(mt,{uuid:mt,documentName:'Item'});if(fault==='source-throws')f.overrides.set(st,new Error('synthetic source failure'));if(fault==='mapped-throws')f.overrides.set(mt,new Error('synthetic mapped failure'));if(fault==='mapped-mismatch')f.overrides.set(mt,{uuid:'Actor.unrelated.Item.wrong',documentName:'Item'});
 if(fault==='serialized-source-present')f.a.items=[{_id:'b'}];if(fault==='serialized-mapped-present')f.b.items=[{_id:'b'}];if(fault==='embedded-source-present')f.original.getEmbeddedDocument=()=>({uuid:st,documentName:'Item'});if(fault==='embedded-mapped-throws')f.mapped.getEmbeddedDocument=()=>{throw Error('synthetic embedded inaccessible');};if(fault==='serializer-fails')f.original.toObject=()=>{throw Error('synthetic serializer inaccessible');};if(fault==='provenance-changed')f.addCopy();if(fault==='source-changed')source.pages[0]!.text!.content+='<p>Source changed.</p>';
 expect(await f.call('apply_reference_rebuild',f.args)).toMatchObject({ok:false});expect(writes).toHaveLength(0);
});
it('rejects caller targets/probes/nonboolean mode and injected arbitrary command',async()=>{
 const f=await retainedFixture();for(const extra of [{targets:['Actor.guessed.Item.fake']},{sourceProbe:{resolved:false}},{retainUnresolvedSourceReferences:'true'}])expect(await f.call('apply_reference_rebuild',{...f.args,...extra})).toMatchObject({ok:false});const args=structuredClone(f.args);args.edits[0].text[0]+=' @UUID[Actor.guessed.Item.fake]';expect(await f.call('apply_reference_rebuild',args)).toMatchObject({ok:false});expect(writes).toHaveLength(0);
});
it('rejects target mutation during awaited observations',async()=>{
 const f=await retainedFixture();let calls=0;f.setIntercept(uuid=>{if(uuid===f.mappedRoot+'.Item.b'&&++calls===3)f.a.items=[{_id:'b'}];});expect(await f.call('apply_reference_rebuild',f.args)).toMatchObject({ok:false});expect(writes).toHaveLength(0);
});
it('holds missing bare DND root in opt-in mode',async()=>{
 const f=await rebuildFixture('<p>Use @UUID[Compendium.dnd5e.spells24.Item.phbsplLesserRest]{Spell}.</p>','<p>Použij kouzlo.</p>');vi.stubGlobal('fromUuid',async(uuid:string)=>uuid==='JournalEntry.source'?sourceDocument:null);expect(await f.call('prepare_reference_rebuild',{documentId:f.args.documentId,fieldId:f.args.fieldId,retainUnresolvedSourceReferences:true})).toMatchObject({ok:false});expect(writes).toHaveLength(0);
});
it('retains source-relative self-page as absolute original, then receipt undo survives its own mapped-parent update',async()=>{
 const f=await rebuildFixture('<p>Use @UUID[.missing#detail]{Place} for 3 rounds.</p><p>Unchanged.</p>','<p>Použij @UUID[JournalEntry.source]{Místo} na 3 kola.</p><p>Beze změny.</p>');
 const before=copy.pages[0]!.text!.content,original=JSON.stringify(source);sourceDocument.getEmbeddedDocument=()=>null;copyDocument.getEmbeddedDocument=()=>null;copyDocument.documentName='JournalEntry';
 vi.stubGlobal('fromUuid',async(uuid:string)=>uuid==='JournalEntry.source'?sourceDocument:uuid===f.args.documentId?copyDocument:null);
 const p:any=await f.call('prepare_reference_rebuild',{documentId:f.args.documentId,fieldId:f.args.fieldId,retainUnresolvedSourceReferences:true});expect(p.ok,JSON.stringify(p)).toBe(true);expect(p.value.targets[0]).toMatchObject({required:true,target:'JournalEntry.source.JournalEntryPage.missing#detail'});
 const args={...f.args,retainUnresolvedSourceReferences:true,revision:p.value.revision,planHash:p.value.planHash,edits:p.value.plan.rows.map((r:any)=>({rowId:r.rowId,text:[...r.edit.text]}))};expect(await f.call('apply_reference_rebuild',args)).toMatchObject({ok:true});
 expect(copy.pages[0]!.text!.content).toContain('@UUID[JournalEntry.source.JournalEntryPage.missing#detail]');expect(JSON.stringify(source)).toBe(original);
 expect(await f.call('undo_correction',{documentId:args.documentId,operationId:args.operationId})).toMatchObject({ok:true,value:{undone:true}});expect(copy.pages[0]!.text!.content).toBe(before);
});
it('forged retained receipt cannot expand source identity during undo',async()=>{
 const f=await retainedFixture();expect(await f.call('apply_reference_rebuild',f.args)).toMatchObject({ok:true});const op=readReviewHistory(copy.flags).find(x=>x.id===f.args.operationId)!;op.referenceRebuild!.referenceMap[0]!.target='Actor.guessed.Item.fake';const n=writes.length;
 expect(await f.call('undo_correction',{documentId:f.args.documentId,operationId:f.args.operationId})).toMatchObject({ok:false});expect(writes).toHaveLength(n);
});
it('direct save service independently rejects invented target despite correct opt-in/proof hash',async()=>{
 const f=await retainedFixture(),s=await snapshot();await expect(saveReviewRows(s,[{rowId:f.value.plan.rows[0].rowId,parts:['Použij @UUID[Actor.guessed.Item.fake]{Schopnost} za 3 kola.']}],{id:'direct-forgery',referenceRebuild:{fieldId:f.args.fieldId,proofHash:f.value.plan.proofHash,retainUnresolvedSourceReferences:true}})).rejects.toThrow();expect(writes).toHaveLength(0);
});
it.each(['unknown-child-id','scope-change','locked','source-parent-kind','mapped-parent-provenance'])('fails closed on unknown metadata or final scope: %s',async fault=>{
 const f=await retainedFixture();if(fault==='unknown-child-id')f.a.items=[{name:'No exact ID'}];if(fault==='scope-change')(game as any).world.id='other-world';if(fault==='locked')locked=true;if(fault==='source-parent-kind')f.original.documentName='Item';if(fault==='mapped-parent-provenance')f.b.flags[MODULE_ID].actorTranslation.sourceUuid='Actor.unrelated';expect(await f.call('apply_reference_rebuild',f.args)).toMatchObject({ok:false});expect(writes).toHaveLength(0);
});

it('fresh opt-in denies mapped parent in another language even if catalog still maps its source',async()=>{
 const f=await retainedFixture(),catalogFlags=structuredClone(f.b.flags);(game.packs.get(ACTOR_TRANSLATIONS_PACK_ID) as any).getIndex=async()=>new Map([['aCopy',{_id:'aCopy',name:'Actor copy',flags:catalogFlags}]]);f.b.flags[MODULE_ID].actorTranslation.targetLanguage='de';
 expect(await f.call('prepare_reference_rebuild',f.mode)).toMatchObject({ok:false});expect(writes).toHaveLength(0);
});
it('fresh opt-in denies ORIGINAL parent with a translation identity',async()=>{
 const f=await retainedFixture();f.a.flags=structuredClone(f.b.flags);
 expect(await f.call('prepare_reference_rebuild',f.mode)).toMatchObject({ok:false});expect(writes).toHaveLength(0);
});


it('HTML-encoded retained anchor stays visibly unresolved through actual retention and ordinary prose handler flows',async()=>{
 const f=await retainedFixture('#x&y'),target='Actor.a.Item.b#x&y',sourceBefore=JSON.stringify(source);
 expect(f.value.targets).toEqual(expect.arrayContaining([expect.objectContaining({sourceTarget:target,target,required:true,retentionPolicy:'retain-exact-unresolved-original'})]));
 const {operationId,...preview}=f.args;
 expect(await f.call('validate_reference_rebuild',preview)).toMatchObject({ok:true,value:{retainUnresolvedSourceReferences:true}});
 const saved:any=await f.call('apply_reference_rebuild',f.args);
 expect(saved).toMatchObject({ok:true,value:{saved:true,complete:true,verified:false}});
 expect(copy.pages[0]!.text!.content).toContain('@UUID[Actor.a.Item.b#x&amp;y]{Schopnost}');
 expect(saved.value.operation).toEqual(readReviewHistory(copy.flags).find(op=>op.id===operationId));
 expect(saved.value.unresolvedSourceReferences).toEqual([expect.objectContaining({sourceTarget:target,retainedTarget:target,status:'retained-original-unresolved',availability:'not-refreshed',humanVerified:false})]);
 const first=await snapshot(),row=first.rows.find(r=>r.translation.join('').includes('Použij'))!;
 sourceDocument.testUserPermission=()=>true;copyDocument.testUserPermission=()=>true;copyDocument.documentName='JournalEntry';
 const assertWarnings=async()=>{
  const context:any=await f.call('get_context',{documentId:first.entry.uuid,rowId:row.id,radius:0});expect(context.ok,JSON.stringify(context)).toBe(true);
  const diagnostic:any=await f.call('get_field_diagnostic',{documentId:first.entry.uuid,fieldId:row.fieldId,revision:context.value.revision,offset:0,limit:10});expect(diagnostic.ok,JSON.stringify(diagnostic)).toBe(true);
  const operation:any=await f.call('get_correction_operation',{documentId:first.entry.uuid,operationId});expect(operation).toMatchObject({ok:true,value:{complete:true,sourceCompatible:true}});
  for(const response of [context,diagnostic,operation])expect(response.value.unresolvedSourceReferences).toEqual([expect.objectContaining({sourceTarget:target,retainedTarget:target,status:'retained-original-unresolved',availability:'not-refreshed',humanVerified:false})]);
  return context.value;
 };
 const context=await assertWarnings();
 const ordinary={documentId:first.entry.uuid,rowId:row.id,revision:context.revision,text:context.edit.text.map((part:string)=>part.replace('Použij','Použij nyní')),labels:[],reason:'Review Czech prose while retaining exact encoded original anchor'};
 expect(await f.call('validate_correction',ordinary)).toMatchObject({ok:true,value:{warnings:[],willVerify:false}});
 expect(await f.call('save_correction',{...ordinary,operationId:crypto.randomUUID()})).toMatchObject({ok:true,value:{saved:true,verified:false}});
 expect(copy.pages[0]!.text!.content).toContain('Použij nyní @UUID[Actor.a.Item.b#x&amp;y]{Schopnost}');
 expect(writes).toHaveLength(2);expect(JSON.stringify(source)).toBe(sourceBefore);
 await assertWarnings();
 const final=await snapshot(),field=final.fields.find(f=>f.id===row.fieldId)!;
 const {assertPortableText}=await import('../src/bundles/format');const {portableReviewText}=await import('../src/review/service');const {planReviewText}=await import('../src/review/text-plan');
 assertPortableText(field.source,portableReviewText(final,field,field.translation),field.format);
 for(const actual of final.rows.filter(r=>r.fieldId===field.id))expect(planReviewText(field.translation,field.format).units.find(unit=>unit.id===actual.unitId)?.parts).toEqual(actual.translation);
});
