/** Strict dedicated parser; no caller paths, source replacements or capability attestations. */
import type { AffixAppendEdit } from '../review/affix-text-append';
export type AffixAppendMethod = 'prepare_affix_text_append' | 'validate_affix_text_append' | 'apply_affix_text_append' | 'get_affix_text_append_operation' | 'undo_affix_text_append' | 'probe_affix_text_append_parent_save';
export interface AffixAppendArgs {
    documentId?: string;
    revision?: string;
    undoId?: string;
    confirmIsolatedTestJournal?: true;
    planHash?: string;
    edits?: AffixAppendEdit[];
    reason?: string;
    operationId?: string;
}
export const AFFIX_APPEND_METHODS:readonly string[]=['prepare_affix_text_append','validate_affix_text_append','apply_affix_text_append','get_affix_text_append_operation','undo_affix_text_append','probe_affix_text_append_parent_save'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function fail(): never { throw new Error('Live.InvalidAffixAppendRequest'); }
/** No getters, inherited/prototype keys, source/paths/flags/proof options or number repair. */
function data(v: unknown, allowed: string[]): asserts v is Record<string, unknown> {
    if (!object(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Reflect.ownKeys(v).some(k => typeof k !== 'string' || !allowed.includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value')))
        fail();
}
function dense(v: unknown): asserts v is any[] { if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || Reflect.ownKeys(v).length !== v.length + 1 || Array.from({ length: v.length }, (_, i) => String(i)).some(k => !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value')))
    fail(); }
export function parseAffixAppendRequest(value: unknown): {
    id: string;
    method: AffixAppendMethod;
    args: AffixAppendArgs;
} {
    data(value, ['id', 'method', 'args']);
    if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/u.test(value.id) || !AFFIX_APPEND_METHODS.includes(String(value.method)))
        fail();
    const simpleMethod=value.method as AffixAppendMethod;
    if (['get_affix_text_append_operation','undo_affix_text_append','probe_affix_text_append_parent_save'].includes(simpleMethod)) {
        const probe=simpleMethod==='probe_affix_text_append_parent_save',undo=simpleMethod==='undo_affix_text_append';
        data(value.args,probe?['operationId','confirmIsolatedTestJournal']:['documentId','operationId',...(undo?['undoId','revision']:[])]);
        const a=value.args;
        if(typeof a.operationId!=='string'||!/^[A-Za-z0-9-]{1,80}$/u.test(a.operationId))fail();
        if(probe){if(a.confirmIsolatedTestJournal!==true)fail();}
        else if(typeof a.documentId!=='string'||!/^Compendium\.world\.foundry-translate-display-text\.JournalEntry\.[A-Za-z0-9]{16}$/u.test(a.documentId))fail();
        if(undo&&(typeof a.undoId!=='string'||!/^[A-Za-z0-9-]{1,80}$/u.test(a.undoId)||typeof a.revision!=='string'||!/^[a-f0-9]{64}$/u.test(a.revision)))fail();
        return {id:value.id,method:simpleMethod,args:a as AffixAppendArgs};
    }
    const method = value.method as AffixAppendMethod, prepare = method === 'prepare_affix_text_append', apply = method === 'apply_affix_text_append';
    data(value.args, ['documentId', 'revision', ...(!prepare ? ['planHash', 'edits', 'reason'] : []), ...(apply ? ['operationId'] : [])]);
    const a = value.args;
    if (typeof a.documentId !== 'string' || !/^Compendium\.world\.foundry-translate-display-text\.JournalEntry\.[A-Za-z0-9]{16}$/u.test(a.documentId) || typeof a.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(a.revision))
        fail();
    if (!prepare) {
        if (typeof a.planHash !== 'string' || !/^[a-f0-9]{64}$/u.test(a.planHash) || typeof a.reason !== 'string' || a.reason.trim().length < 5 || a.reason.length > 3000 || !Array.isArray(a.edits) || !a.edits.length || a.edits.length > 100)
            fail();
        dense(a.edits);
        for (const e of a.edits) {
            data(e, ['rowId', 'text', 'labels']);
            if (typeof e.rowId !== 'string' || !/^[a-f0-9]{64}$/u.test(e.rowId) || !Array.isArray(e.text) || !e.text.length || e.text.length > 1000)
                fail();
            dense(e.text);
            if (e.text.some(t => typeof t !== 'string' || !t.trim()))
                fail();
            if (e.labels !== undefined) {
                if (!Array.isArray(e.labels) || e.labels.length > 1000)
                    fail();
                dense(e.labels);
                for (const l of e.labels) {
                    data(l, ['marker', 'label']);
                    if (typeof l.marker !== 'string' || !l.marker || l.marker.length > 120 || typeof l.label !== 'string' || l.label.length > 2000)
                        fail();
                }
                if (new Set(e.labels.map(l => l.marker)).size !== e.labels.length)
                    fail();
            }
        }
        if (new Set(a.edits.map(e => e.rowId)).size !== a.edits.length)
            fail();
    }
    if (apply && (typeof a.operationId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/u.test(a.operationId)))
        fail();
    if (new TextEncoder().encode(JSON.stringify(a)).length > 120000)
        fail();
    return { id: value.id, method, args: a as unknown as AffixAppendArgs };
}
