import { afterEach, beforeEach, vi } from 'vitest';
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
export async function fixture(kind: keyof typeof fixtures = 'Focusing', identity = 'Item.owner00000000001') {
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
