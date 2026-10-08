import identities from './affix-append-identity-fixture12.json';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import fixtures from './affix-append-source-fixtures.json';
import { MODULE_ID } from '../src/constants';
import { translateDisplayText, readDisplayTextFlag, displaySourceHash, DISPLAY_TEXT_PACK } from '../src/translation/display-text';
import { prepareAffixTextAppend, validateAffixTextAppend, affixAppendOperation, affixAppendRequestHash, assertAffixAppendAfter, undoAffixTextAppend, type AffixAppendEnvironment, type AffixAppendEdit } from '../src/review/affix-text-append';
import { applyAffixAppend, undoAffixAppend, getAffixAppendOperation, type AffixAppendBackend, type AppendRequest } from '../src/review/affix-text-append-service';
class StringField {
}
class HTMLField {
}
class CrucibleActionField {
    fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() };
}
class ArrayField {
    element = new CrucibleActionField();
}
class CrucibleAffixActiveEffect {
    static schema = { fields: { actions: new ArrayField() } };
}
beforeEach(() => { CrucibleAffixActiveEffect.schema = { fields: { actions: new ArrayField() } }; vi.stubGlobal('game', { user: { id: 'gm', isGM: true }, system: { id: 'crucible' } }); vi.stubGlobal('CONFIG', { ActiveEffect: { dataModels: { affix: CrucibleAffixActiveEffect } } }); vi.stubGlobal('document', parseHTML('<html><body></body></html>').document); });
afterEach(() => vi.unstubAllGlobals());
async function fixture(kind: keyof typeof fixtures = 'Focusing', identity = 'Item.owner00000000001') {
    const stored = fixtures[kind], fields = stored.fields;
    const data: any = { _id: kind.toLowerCase().padEnd(16, '0'), type: 'affix', name: kind, description: fields.find(f => f.path.length === 1 && f.path[0] === 'description')!.source, system: { tier: { value: 1 }, actions: [] }, flags: { original: { preserve: true } } };
    const map = new Map<string, any>();
    for (const f of fields.filter(f => f.path[0] === 'system')) {
        const id = f.path[2]!;
        const action = map.get(id) ?? { id, name: '', description: '', condition: '', cost: { action: 2 }, damage: { dice: '1d6' }, effects: [] };
        action[f.path[3]!] = f.source;
        map.set(id, action);
    }
    data.system.actions = [...map.values()];
    const source: any = { id: data._id, uuid: `${identity}.ActiveEffect.${data._id}`, documentName: 'ActiveEffect', type: 'affix', system: new CrucibleAffixActiveEffect(), toObject: () => structuredClone(data) };
    if (identity.startsWith('Compendium.crucible.affixes'))
        source.pack = 'crucible.affixes';
    else {
        const parent: any = { id: identity.split('.').at(-1), uuid: identity, documentName: 'Item', effects: { contents: [source] }, toObject() { return { _id: this.id, name: 'Owner', flags: { owner: true }, effects: this.effects.contents.map((s: any) => s.toObject()), system: { actions: [] } }; } };
        source.parent = parent;
    }
    const legacy = structuredClone(data);
    delete legacy.system.actions;
    let current: any = await translateDisplayText({ source: legacy, sourceUuid: source.uuid, kind: 'ActiveEffect', glossary: [], glossaryHash: 'legacy-gloss', providerHash: 'legacy-provider', settings: { providerId: 'openai-compatible', sourceLanguage: 'en', targetLanguage: 'cs' }, provider: { async testConnection() { }, async translate({ texts }) { return texts.map(t => ({ translatedText: 'CZ ' + t })); } } });
    current._id = 'translation00001';
    current.name = 'Ručně Zachovaný Název';
    current.ownership = { default: 0 };
    current.folder = 'private';
    current.sort = 17;
    current.flags['other-module'] = { keep: true };
    current.flags[MODULE_ID].review = { entries: { old: { userName: 'Human' } } };
    current.flags[MODULE_ID].editorProtection = { keep: 'literal' };
    current.flags[MODULE_ID].reviewHistory = { old: { id: 'old', at: 'then', rows: [] } };
    readDisplayTextFlag(current.flags)!.outputHash = 'a'.repeat(64);
    const target: any = { id: current._id, uuid: `Compendium.${DISPLAY_TEXT_PACK}.JournalEntry.${current._id}`, pack: DISPLAY_TEXT_PACK, toObject: () => structuredClone(current) };
    const env: AffixAppendEnvironment = { source, target, claims: [{ sourceUuid: source.uuid, language: 'cs', documentId: target.uuid }], scope: { worldId: 'ember', language: 'cs', systemId: 'crucible', systemVersion: '0.11-test', foundryVersion: '14-test', moduleVersion: 'isolated-proposal', clientId: 'client', userId: 'gm', isGM: true, packLocked: false, activeTranslations: false, emberActive: true, emberVersion: 'test' }, glossaryHash: 'g'.repeat(64) };
    const set = (x: any) => { current = structuredClone(x); }, get = () => current;
    return { env, data, get, set };
}
function edits(plan: Awaited<ReturnType<typeof prepareAffixTextAppend>>): AffixAppendEdit[] { return plan.rows.map(r => ({ rowId: r.rowId, text: r.edit.text.map(t => 'CZ ' + t) })); }
async function staged(f: Awaited<ReturnType<typeof fixture>>) { const plan = await prepareAffixTextAppend(f.env), e = edits(plan), preview = await validateAffixTextAppend(f.env, plan, e), requestHash = await affixAppendRequestHash(plan.documentId, plan.revision, plan.planHash, e, 'Explicit manual append'); const result = await affixAppendOperation(plan, preview, requestHash, 'append1', 'Explicit manual append', 'GM', 'now'); return { ...result, plan, preview, e }; }
it.each(['Disguise', 'Focusing', 'Luminous'] as const)('appends exact own captured %s source units and preserves every existing page/provenance/manual attribute', async (kind) => {
    const f = await fixture(kind), before = structuredClone(f.get()), source = structuredClone(f.data), s = await staged(f);
    f.set(s.data);
    await assertAffixAppendAfter(f.env, s.operation);
    expect(f.get().pages.slice(0, 2)).toEqual(before.pages);
    for (const k of ['name', 'ownership', 'folder', 'sort'])
        expect(f.get()[k]).toEqual(before[k]);
    expect(f.get().flags['other-module']).toEqual(before.flags['other-module']);
    for (const k of ['review', 'editorProtection'])
        expect(f.get().flags[MODULE_ID][k]).toEqual(before.flags[MODULE_ID][k]);
    expect(f.get().flags[MODULE_ID].reviewHistory.old).toEqual(before.flags[MODULE_ID].reviewHistory.old);
    const prior = readDisplayTextFlag(before.flags)!, after = readDisplayTextFlag(f.get().flags)!;
    for (const k of ['providerId', 'providerFingerprint', 'glossaryFingerprint', 'translatedAt', 'engineRevision', 'outputHash', 'fallbackTextSegments'])
        expect((after as any)[k]).toEqual((prior as any)[k]);
    expect(after.fields.slice(0, 2)).toEqual(prior.fields);
    expect(after.sourceHash).toBe(await displaySourceHash('ActiveEffect', source));
    expect(s.preview.fields.every(x => x.before === null)).toBe(true);
    expect(s.operation.rows.every(r => r.beforeMissing && r.before.length === 0)).toBe(true);
    expect(s.operation.affixTextAppend.humanVerified).toBe(false);
    expect(f.data).toEqual(source);
    if (kind === 'Disguise')
        expect(s.preview.fields.map(x => x.afterRaw).join(' ')).toContain('24 hours');
    if (kind === 'Focusing')
        expect(s.plan.rows.map(r => r.source.join(' ')).join(' ')).toContain('8 Focus');
    if (kind === 'Luminous')
        expect(s.preview.fields.map(x => x.afterRaw).join(' ')).toContain('@ref[item.name]{item}');
});
it.each(['Actor.actor0000000001.Item.owner00000000001', 'Item.owner00000000001', 'Compendium.crucible.equipment.Item.owner00000000001', 'Compendium.crucible.affixes'])('binds embedded/standalone exact identity: %s', async (identity) => { const f = await fixture('Disguise', identity); const p = await prepareAffixTextAppend(f.env); expect(p.sourceUuid).toBe(f.env.source.uuid); expect(p.rows).toHaveLength(3); });
it('uses full sourceUuid in stable row identity; equal bodies and leaf IDs do not merge owners', async () => { const a = await fixture('Focusing', 'Item.owner00000000001'), b = await fixture('Focusing', 'Item.owner00000000002'); const p = await prepareAffixTextAppend(a.env), q = await prepareAffixTextAppend(b.env); expect(p.rows.map(r => r.rowId)).not.toEqual(q.rows.map(r => r.rowId)); });
it('guards successful undo and returns exact prior flag/old pages; source is still modern and thus SourceChanged', async () => { const f = await fixture(), before = structuredClone(f.get()), s = await staged(f); f.set(s.data); const undone = await undoAffixTextAppend(f.env, s.operation, 'undo1', 'GM', 'later'); expect(readDisplayTextFlag(undone.flags)).toEqual(readDisplayTextFlag(before.flags)); expect(undone.pages).toEqual(before.pages); expect(undone.flags![MODULE_ID]!.reviewHistory).toMatchObject({ append1: { undoneAt: 'later' }, undo1: { undoOf: 'append1' } }); expect(readDisplayTextFlag(undone.flags)!.sourceHash).not.toBe(await displaySourceHash('ActiveEffect', f.data)); expect(f.data.system.actions).toHaveLength(1); });
it.each(['source-punctuation', 'forged-hash', 'stored-source', 'duplicate-claim', 'duplicate-page', 'orphan-page', 'partial', 'fallback', 'already-modern', 'bad-base-command', 'wrong-language', 'wrong-pack', 'owner-runtime', 'owner-serialized', 'duplicate-action', 'unknown-model', 'locked', 'run', 'non-gm', 'base-number', 'damaged-page', 'foreign-id'])('rejects bad base eligibility without mutation: %s', async (problem) => {
    const f = await fixture(), flag = readDisplayTextFlag(f.get().flags)!;
    if (problem === 'source-punctuation')
        f.data.description += '!';
    if (problem === 'forged-hash')
        flag.sourceHash = 'f'.repeat(64);
    if (problem === 'stored-source')
        flag.fields[0]!.source += '!';
    if (problem === 'duplicate-claim')
        f.env.claims.push({ ...f.env.claims[0]! });
    if (problem === 'duplicate-page')
        f.get().pages.push(structuredClone(f.get().pages[0]));
    if (problem === 'orphan-page')
        f.get().pages.push({ _id: 'orphan', text: { content: 'old' } });
    if (problem === 'partial')
        (flag as any).partial = true;
    if (problem === 'fallback')
        flag.fallbackTextSegments = 1;
    if (problem === 'already-modern')
        flag.affixSourceHash = 'f'.repeat(64);
    if (problem === 'bad-base-command')
        f.get().pages[1].text.content += '@UUID[Item.foreign]';
    if (problem === 'wrong-language')
        f.env.scope.language = 'de';
    if (problem === 'wrong-pack')
        f.env.target.pack = 'foreign';
    if (problem === 'owner-runtime')
        f.env.source.parent!.effects.contents = [];
    if (problem === 'owner-serialized')
        f.env.source.parent!.toObject = () => ({ _id: f.env.source.parent!.id, effects: [] });
    if (problem === 'duplicate-action')
        f.data.system.actions.push(structuredClone(f.data.system.actions[0]));
    if (problem === 'unknown-model')
        vi.stubGlobal('CONFIG', {});
    if (problem === 'locked')
        f.env.scope.packLocked = true;
    if (problem === 'run')
        f.env.scope.activeTranslations = true;
    if (problem === 'non-gm')
        f.env.scope.isGM = false;
    if (problem === 'base-number')
        f.get().pages[1].text.content += ' 9';
    if (problem === 'damaged-page')
        delete f.get().pages[1].text.content;
    if (problem === 'foreign-id')
        f.env.source.id = 'foreign';
    const before = structuredClone(f.get());
    await expect(prepareAffixTextAppend(f.env)).rejects.toThrow();
    expect(f.get()).toEqual(before);
});
it.each(['omitted', 'duplicate', 'unknown', 'empty', 'parts', 'command', 'numeric', 'cross-part-numbers', 'html', 'option', 'old-row', 'fake-caption', 'marker'])('rejects unsafe new payload: %s', async (problem) => {
    const f = await fixture('Luminous'), p = await prepareAffixTextAppend(f.env), e = edits(p), numeric = e.find(x => x.text.some(t => t.includes('20 feet')))!;
    if (problem === 'omitted')
        e.pop();
    if (problem === 'duplicate')
        e.push(e[0]!);
    if (problem === 'unknown')
        e[0]!.rowId = '0'.repeat(64);
    if (problem === 'empty')
        e[0]!.text = [' '];
    if (problem === 'parts')
        e[0]!.text.push('extra');
    if (problem === 'command')
        e[0]!.text[0] = '@UUID[Item.foreign]';
    if (problem === 'numeric')
        numeric.text = numeric.text.map(t => t.replace('20 feet', '21 feet'));
    if (problem === 'cross-part-numbers') {
        numeric.text[0] += '20';
        numeric.text[1] = numeric.text[1]!.replace('20', '');
    }
    if (problem === 'html')
        e[0]!.text[0] = '<p>injection</p>';
    if (problem === 'option')
        (e[0] as any).options = [];
    if (problem === 'old-row')
        e[0]!.rowId = 'a'.repeat(64);
    if (problem === 'fake-caption')
        e[0]!.labels = [{ marker: '⟦bogus⟧', label: 'text' }];
    if (problem === 'marker')
        e.find(x => x.text.some(t => t.includes('⟦1⟧')))!.text = ['CZ ⟦1⟧ ⟦1⟧'];
    const before = structuredClone(f.get());
    await expect(validateAffixTextAppend(f.env, p, e)).rejects.toThrow();
    expect(f.get()).toEqual(before);
});
it.each(['source-cost', 'source-tier', 'source-flags', 'old-current', 'permissions', 'history', 'scope-client', 'glossary', 'schema'])('rejects intervening change after a crypto await: %s', async (problem) => { const f = await fixture(); let mutated = false; const real = crypto.subtle.digest.bind(crypto.subtle); const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => { const result = await real(...args); if (!mutated) {
    mutated = true;
    if (problem === 'source-cost')
        f.data.system.actions[0].cost.action++;
    if (problem === 'source-tier')
        f.data.system.tier.value++;
    if (problem === 'source-flags')
        f.data.flags.original.preserve = false;
    if (problem === 'old-current')
        f.get().pages[0].text.content += '!';
    if (problem === 'permissions')
        f.get().ownership.default = 3;
    if (problem === 'history')
        f.get().flags[MODULE_ID].reviewHistory.later = { id: 'later' };
    if (problem === 'scope-client')
        f.env.scope.clientId = 'changed';
    if (problem === 'glossary')
        f.env.glossaryHash = 'changed';
    if (problem === 'schema')
        (CrucibleAffixActiveEffect.schema.fields.actions.element.fields as any).description = new StringField();
} return result; }); try {
    await expect(prepareAffixTextAppend(f.env)).rejects.toThrow();
}
finally {
    spy.mockRestore();
} });
function backend(f: Awaited<ReturnType<typeof fixture>>, cap = true): AffixAppendBackend & {
    writes: number;
    lose: boolean;
    hook: (() => void) | undefined;
} {
    const b = { writes: 0, lose: false, async load() { return f.env; }, current() { }, async references() { b.hook?.(); }, atomicCapability() { return cap ? { foundryVersion: f.env.scope.foundryVersion, systemVersion: f.env.scope.systemVersion, moduleVersion: 'isolated-proposal', evidenceHash: 'a'.repeat(64) } : null; }, async persist(data: any) { b.writes++; f.set(data); if (b.lose) {
            b.lose = false;
            throw new Error('Response lost');
        } }, userName: () => 'GM', now: () => 'now', hook: undefined as (() => void) | undefined };
    return b;
}
async function request(f: Awaited<ReturnType<typeof fixture>>): Promise<AppendRequest> { const p = await prepareAffixTextAppend(f.env); return { documentId: p.documentId, revision: p.revision, planHash: p.planHash, edits: edits(p), reason: 'Explicit manual append', operationId: 'append1' }; }
it('checks existing receipt before fresh prepare on response loss; exact retry saves once and getter is actual complete', async () => { const f = await fixture(), b = backend(f), r = await request(f); b.lose = true; await expect(applyAffixAppend(b, r)).rejects.toThrow('Response lost'); const retry = await applyAffixAppend(b, r); expect(retry.alreadyApplied).toBe(true); expect(b.writes).toBe(1); const getter = await getAffixAppendOperation(b, r.documentId, r.operationId); expect(getter.complete).toBe(true); expect(getter.rows.length).toBe(r.edits.length); expect(getter.operation).toEqual(f.get().flags[MODULE_ID].reviewHistory.append1); await expect(applyAffixAppend(b, { ...r, reason: 'Different reason' })).rejects.toThrow('OperationConflict'); expect(b.writes).toBe(1); });
it('observed parent-save capability is an explicit release blocker before any write', async () => { const f = await fixture(), b = backend(f, false), r = await request(f); await expect(applyAffixAppend(b, r)).rejects.toThrow('ParentSaveBehaviorUnproven'); expect(b.writes).toBe(0); });
it('single parent mock roundtrip then guarded undo preserves manual base content and only inserts inverse history', async () => { const f = await fixture(), before = structuredClone(f.get()), b = backend(f), r = await request(f); const applied = await applyAffixAppend(b, r); expect(applied.alreadyApplied).toBe(false); expect(b.writes).toBe(1); await undoAffixAppend(b, r.documentId, r.operationId, 'undo1'); expect(b.writes).toBe(2); expect(f.get().pages).toEqual(before.pages); expect(readDisplayTextFlag(f.get().flags)).toEqual(readDisplayTextFlag(before.flags)); await expect(applyAffixAppend(b, r)).rejects.toThrow('OperationConflict'); });
it.each(['new-prose', 'old-prose', 'permissions', 'history', 'mechanics'])('refuses retry and undo after later %s change instead of erasing work', async (problem) => { const f = await fixture(), b = backend(f), r = await request(f); await applyAffixAppend(b, r); if (problem === 'new-prose')
    f.get().pages[2].text.content += '!'; if (problem === 'old-prose')
    f.get().pages[0].text.content += '!'; if (problem === 'permissions')
    f.get().ownership.default = 3; if (problem === 'history')
    f.get().flags[MODULE_ID].reviewHistory.later = { id: 'later', rows: [] }; if (problem === 'mechanics')
    f.data.system.actions[0].cost.action++; await expect(applyAffixAppend(b, r)).rejects.toThrow(); await expect(undoAffixAppend(b, r.documentId, r.operationId, 'undo1')).rejects.toThrow(); expect(b.writes).toBe(1); });
it('post-save incompatible actual field cannot be reported as a successful getter', async () => { const f = await fixture(), b = backend(f), r = await request(f); await applyAffixAppend(b, r); f.get().pages[2].text.content = 'tamper'; await expect(getAffixAppendOperation(b, r.documentId, r.operationId)).rejects.toThrow('AfterDataChanged'); });
it("final reference await cannot smuggle a source/permission change into persistence even with an inert backend.current", async () => { const f = await fixture(), b = backend(f), r = await request(f); b.hook = () => { f.data.system.actions[0].cost.action++; }; await expect(applyAffixAppend(b, r)).rejects.toThrow("InterveningChange"); expect(b.writes).toBe(0); });
it.each(identities)("keeps exact ledger identity $sourceUuid separate using synthetic valid legacy state, no live eligibility assertion", async ({ sourceUuid }) => { const suffix = sourceUuid.split(".ActiveEffect.").at(-1)!, kind = (suffix.startsWith("disguise") ? "Disguise" : suffix.startsWith("luminous") ? "Luminous" : "Focusing") as keyof typeof fixtures, identity = sourceUuid.split(".ActiveEffect.")[0]!; const f = await fixture(kind, identity); expect(f.env.source.uuid).toBe(sourceUuid); const plan = await prepareAffixTextAppend(f.env); expect(plan.sourceUuid).toBe(sourceUuid); });
it("rejects persisted receipt-plan tampering despite otherwise unchanged stored fields", async () => { const f = await fixture(), b = backend(f), r = await request(f); await applyAffixAppend(b, r); f.get().flags[MODULE_ID].reviewHistory.append1.affixTextAppend.plan.ownerProof = "f".repeat(64); await expect(getAffixAppendOperation(b, r.documentId, r.operationId)).rejects.toThrow("PersistedPlanProof"); });
it('adds schema-owned condition text only with fresh StringField proof', async () => { const f = await fixture(); f.data.system.actions[0].condition = 'While equipped'; const p = await prepareAffixTextAppend(f.env); expect(p.addedFields.some(x => x.path[3] === 'condition')).toBe(true); expect(p.rows.find(r => r.fieldId.endsWith('"condition"]'))?.source).toEqual(['While equipped']); (CrucibleAffixActiveEffect.schema.fields.actions.element.fields as any).condition = new HTMLField(); await expect(validateAffixTextAppend(f.env, p, edits(p))).rejects.toThrow(); });
it('allows exact editable source caption text while keeping resolver identity and all options', async () => { const f = await fixture('Luminous'), p = await prepareAffixTextAppend(f.env), e = edits(p), r = p.rows.find(x => x.edit.references.flat().some(x => x.marker === '⟦1⟧'))!; e.find(x => x.rowId === r.rowId)!.labels = [{ marker: '⟦1⟧', label: 'předmět' }]; const v = await validateAffixTextAppend(f.env, p, e); expect(v.fields.map(x => x.afterRaw).join(' ')).toContain('@ref[item.name]{předmět}'); e.find(x => x.rowId === r.rowId)!.labels = [{ marker: '⟦1⟧', label: 'předmět 99' }]; await expect(validateAffixTextAppend(f.env, p, e)).rejects.toThrow('SourcePartNumbers'); });
it('missing required reference check rejects before persistence, with no unresolved retention escape', async () => { const f = await fixture(), b = backend(f), r = await request(f); b.references = async () => { throw new Error('ReferenceTargetMissing'); }; await expect(applyAffixAppend(b, r)).rejects.toThrow('ReferenceTargetMissing'); expect(b.writes).toBe(0); });
it('oversized complete source plan rejects without truncating or mutating the target', async () => { const f = await fixture(); f.data.system.actions[0].description = '<p>' + 'text '.repeat(100001) + '</p>'; const before = structuredClone(f.get()); await expect(prepareAffixTextAppend(f.env)).rejects.toThrow('CompletePlanBounds'); expect(f.get()).toEqual(before); });
