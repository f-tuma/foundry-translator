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
