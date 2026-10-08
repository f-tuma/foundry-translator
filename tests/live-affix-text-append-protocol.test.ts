import { expect, it } from 'vitest';
import { parseAffixAppendRequest } from '../src/polish/affix-text-append-protocol';
const prepare = () => ({ id: 'request1', method: 'prepare_affix_text_append', args: { documentId: 'Compendium.world.foundry-translate-display-text.JournalEntry.translation00001', revision: 'a'.repeat(64) } });
const apply = () => ({ id: 'request2', method: 'apply_affix_text_append', args: { ...prepare().args, planHash: 'b'.repeat(64), edits: [{ rowId: 'c'.repeat(64), text: ['Text ⟦1⟧'], labels: [{ marker: '⟦1⟧', label: 'caption' }] }], reason: 'Explicit manual append', operationId: 'append1' } });
it('strict JSON roundtrip accepts prepare, validate and apply only', () => { for (const p of [prepare(), apply(), { ...apply(), method: 'validate_affix_text_append', args: { ...apply().args, operationId: undefined } }]) {
    if (p.method === 'validate_affix_text_append')
        delete (p.args as any).operationId;
    expect(parseAffixAppendRequest(JSON.parse(JSON.stringify(p))).method).toBe(p.method);
} });
it.each(['sourceUuid', 'source', 'fields', 'path', 'pageId', 'mechanics', 'restoreSourceNumbers', 'retainUnresolvedSourceReferences', 'flag', 'proof', 'rootApproved', 'options'])('rejects caller-owned %s even when false/empty', key => { const p = apply(); (p.args as any)[key] = false; expect(() => parseAffixAppendRequest(p)).toThrow('InvalidAffixAppendRequest'); });
it.each(['method', 'target', 'revision', 'planHash', 'reason', 'operationId', 'empty', 'duplicate', 'missing-text', 'blank', 'label-option', 'label-duplicate', 'prototype', 'oversize', 'unknown-envelope', 'prepare-edits'])('rejects malformed protocol %s', problem => { const p: any = apply(); if (problem === 'method')
    p.method = 'save_correction'; if (problem === 'target')
    p.args.documentId = 'Item.foreign'; if (problem === 'revision')
    p.args.revision = 'bad'; if (problem === 'planHash')
    delete p.args.planHash; if (problem === 'reason')
    p.args.reason = 'tiny'; if (problem === 'operationId')
    p.args.operationId = '__proto__'; if (problem === 'empty')
    p.args.edits = []; if (problem === 'duplicate')
    p.args.edits.push(p.args.edits[0]); if (problem === 'missing-text')
    delete p.args.edits[0].text; if (problem === 'blank')
    p.args.edits[0].text = [' ']; if (problem === 'label-option')
    p.args.edits[0].labels[0].options = []; if (problem === 'label-duplicate')
    p.args.edits[0].labels.push(p.args.edits[0].labels[0]); if (problem === 'prototype')
    Object.setPrototypeOf(p.args, { inherited: true }); if (problem === 'oversize')
    p.args.edits[0].text = ['x'.repeat(120001)]; if (problem === 'unknown-envelope')
    p.untrusted = 'ignored'; if (problem === 'prepare-edits')
    p.method = 'prepare_affix_text_append'; expect(() => parseAffixAppendRequest(p)).toThrow(); });
it('preflights accessors before reading any args or edit values', () => { let reads = 0; const p = apply(); Object.defineProperty(p.args, 'edits', { enumerable: true, get() { reads++; return []; } }); expect(() => parseAffixAppendRequest(p)).toThrow(); expect(reads).toBe(0); });
it('rejects JSON own __proto__ keys instead of applying inherited write paths', () => { const p = JSON.parse(JSON.stringify(apply())); p.args.edits[0] = JSON.parse('{"rowId":"' + 'c'.repeat(64) + '","text":["text"],"__proto__":{}}'); expect(() => parseAffixAppendRequest(p)).toThrow(); });
it("rejects text-array accessors before invoking them", () => { let reads = 0; const p = apply(); Object.defineProperty(p.args.edits[0]!.text, "0", { enumerable: true, get() { reads++; return "malicious"; } }); expect(() => parseAffixAppendRequest(p)).toThrow(); expect(reads).toBe(0); });
