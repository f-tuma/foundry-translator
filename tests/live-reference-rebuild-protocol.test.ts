import { expect, it } from 'vitest';
import { parseLiveRequest } from '../src/polish/live-protocol';
const base = { documentId: 'translated', fieldId: '["pages","page","text","content"]', revision: 'a'.repeat(64) };
const edits = [{ rowId: 'b'.repeat(64), text: ['Věta ⟦1⟧.'], labels: [{ marker: '⟦1⟧', label: 'Spojenec' }] }];
const args = { ...base, planHash: 'c'.repeat(64), edits, reason: 'Rebuild from exact original references' };
const parse = (method: string, args: unknown) => parseLiveRequest({ id: 'test', method, args });
it('separates read-only prepare/validate from applying a strictly bounded source-owned rebuild', () => {
  expect(parse('prepare_reference_rebuild', base).args).toMatchObject(base);
  expect(parse('prepare_reference_rebuild', { documentId: base.documentId, fieldId: base.fieldId }).args.revision).toBeUndefined();
  expect(parse('validate_reference_rebuild', args).args).toMatchObject(args);
  expect(parse('apply_reference_rebuild', { ...args, operationId: 'rebuild-1', restoreSourceNumbers: true }).args).toMatchObject({ ...args, operationId: 'rebuild-1', restoreSourceNumbers: true });
});
it('rejects caller target identities, option edits, unknown keys, incomplete/stale-shaped scopes and duplicate edits', () => {
  for (const method of ['validate_reference_rebuild', 'apply_reference_rebuild']) {
    const bound = { ...args, ...(method === 'apply_reference_rebuild' ? { operationId: 'rebuild-1' } : {}) };
    for (const unsafe of [ { ...bound, command: '@UUID[Actor.other]' }, { ...bound, options: [] }, { ...bound, text: ['caller command'] },
      { ...bound, restoreSourceReferences: true }, { ...bound, planHash: 'bad' }, { ...bound, fieldId: '' }, { ...bound, edits: [] },
      { ...bound, edits: [...edits, ...edits] }, { ...bound, edits: [{ ...edits[0], uuid: 'Actor.other' }] },
      { ...bound, edits: [{ ...edits[0], labels: [{ marker: '⟦1⟧', label: 'A', target: 'Actor.other' }] }] },
      { ...bound, edits: [{ ...edits[0], labels: [edits[0]!.labels[0], edits[0]!.labels[0]] }] },
      { ...bound, edits: [{ ...edits[0], text: [' '] }] }, { ...bound, edits: [{ ...edits[0], text: ['x'.repeat(60001)] }] },
    ]) expect(() => parse(method, unsafe)).toThrow('Live.InvalidRequest');
  }
  expect(() => parse('apply_reference_rebuild', args)).toThrow();
  expect(() => parse('validate_reference_rebuild', { ...args, operationId: 'unexpected' })).toThrow();
  expect(() => parse('prepare_reference_rebuild', args)).toThrow();
  expect(() => parse('get_context', { documentId: base.documentId, rowId: edits[0]!.rowId, fieldId: base.fieldId })).toThrow();
});
