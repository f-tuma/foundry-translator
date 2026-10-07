// Offline unit tests: actual retention/normalization implementation; synthetic parents only.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/review/service', () => ({
  reviewCatalog: async () => [], readReviewHistory: () => [],
  hashSource: async (_kind: string, data: unknown) => {
    const { sha256 } = await import('../src/translation/hash');
    return sha256(JSON.stringify(data));
  },
}));
vi.mock('../src/glossary/compendium-repository', () => ({
  GlossaryCompendiumRepository: class { async loadExisting() { return []; } },
}));
import { prepareUnresolvedSourceRetention, bindUnresolvedSourceRetention } from '../src/review/unresolved-source-references';
import { batchObject } from '../src/polish/correction-batch';
import { sha256 } from '../src/translation/hash';

const sourceRoot = 'JournalEntry.syntheticSource';
const mappedRoot = 'Compendium.world.foundry-translate-translations.JournalEntry.syntheticCopy';
const suffix = '.JournalEntryPage.syntheticMissing#detail';
const DENIED = 'Review.UnresolvedSourceRetentionDenied';
let f: Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const source: any = { _id: 'syntheticSource', pages: [{ _id: 'existingSource', text: { content: 'source' } }] };
  const mapped: any = { _id: 'syntheticCopy', pages: [{ _id: 'existingCopy', text: { content: 'copy' } }], flags: {
    'foundry-translate': { translation: { schemaVersion: 1, sourceUuid: sourceRoot, sourceHash: 'synthetic', providerId: 'openai-compatible',
      sourceLanguage: 'en', targetLanguage: 'cs', translatedAt: 'synthetic', translatedTextPages: 1, skippedTextPages: 0 } },
  } };
  const original: any = { uuid: sourceRoot, documentName: 'JournalEntry', flags: {}, toObject: () => structuredClone(source), getEmbeddedDocument: vi.fn(() => null) };
  const copy: any = { uuid: mappedRoot, documentName: 'JournalEntry', flags: mapped.flags, toObject: () => structuredClone(mapped), getEmbeddedDocument: vi.fn(() => null) };
  const lookup = vi.fn(async (uuid: string) => uuid === sourceRoot ? original : uuid === mappedRoot ? copy : null);
  vi.stubGlobal('fromUuid', lookup);
  vi.stubGlobal('game', { world: { id: 'synthetic' }, user: { id: 'synthetic' }, settings: { get: () => 'cs' }, system: { id: 'synthetic' }, modules: new Map() });
  const snapshot: any = { entry: { sourceUuid: sourceRoot, kind: 'JournalEntry', language: 'cs' }, sourceHash: await sha256(JSON.stringify(source)), reverse: new Map([[mappedRoot, sourceRoot]]) };
  const targets: any = [{ sourceTarget: sourceRoot + suffix, target: mappedRoot + suffix, required: true }];
  return { source, mapped, original, copy, lookup, snapshot, targets };
}
function padNormalized(data: any, length: number) {
  data.padding = '';
  data.padding = 'x'.repeat(length - batchObject(data).length);
  expect(batchObject(data).length).toBe(length);
}
async function prepare() { return prepareUnresolvedSourceRetention(f.snapshot, f.targets); }
beforeEach(async () => { f = await fixture(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('current Journal retention guards, synthetic offline fixtures', () => {
  it('small exact parents qualify with all six absence cues', async () => {
    const proof = await prepare();
    expect(proof.mappings).toHaveLength(1);
    expect(proof.mappings[0]!.evidence).toEqual({ sourceExactAbsent: true, mappedExactAbsent: true,
      sourceSerializedChildAbsent: true, mappedSerializedChildAbsent: true, sourceEmbeddedAbsent: true, mappedEmbeddedAbsent: true });
    expect(proof.mappings[0]!.retainedTarget).toBe(sourceRoot + suffix);
    expect(f.copy.getEmbeddedDocument).toHaveBeenCalledWith('JournalEntryPage', 'syntheticMissing');
  });
  it('accepts the exact normalized 2,000,000-character boundary', async () => {
    padNormalized(f.mapped, 2000000);
    await expect(prepare()).resolves.toMatchObject({ version: 1, requested: true });
  });
  it('rejects 2,000,001 mapped characters before mapped absence probes', async () => {
    padNormalized(f.mapped, 2000001);
    await expect(prepare()).rejects.toThrow(DENIED);
    expect(f.copy.getEmbeddedDocument).not.toHaveBeenCalled();
    // The initial mapped exact target lookup remains required and precedes this bound.
    expect(f.lookup).toHaveBeenCalledWith(mappedRoot + suffix.split('#')[0]);
  });
  it('also rejects an oversized original parent', async () => {
    padNormalized(f.source, 2000001);
    f.snapshot.sourceHash = await sha256(JSON.stringify(f.source));
    await expect(prepare()).rejects.toThrow(DENIED);
    expect(f.original.getEmbeddedDocument).not.toHaveBeenCalled();
  });
  it('uses actual normalized JSON, excluding _stats but retaining flags/history', async () => {
    f.mapped._stats = { large: 'x'.repeat(2000001) };
    expect(batchObject(f.mapped).length).toBeLessThan(2000000);
    await expect(prepare()).resolves.toMatchObject({ requested: true });
    f.mapped.flags['foundry-translate'].syntheticHistory = 'x'.repeat(2000001);
    await expect(prepare()).rejects.toThrow(DENIED);
  });
  it('denies serialized child presence despite nullish lookup results', async () => {
    f.mapped.pages.push({ _id: 'syntheticMissing' });
    await expect(prepare()).rejects.toThrow(DENIED);
  });
  it('denies any serialized child without a nonempty string identity', async () => {
    f.mapped.pages.push({ name: 'synthetic child without ID' });
    await expect(prepare()).rejects.toThrow(DENIED);
  });
  it('denies a nonnull embedded result even when the exact lookup is null', async () => {
    f.copy.getEmbeddedDocument.mockReturnValue({ uuid: 'syntheticMismatch' });
    await expect(prepare()).rejects.toThrow(DENIED);
  });
  it('denies a nonnull exact target even if its returned identity is wrong', async () => {
    f.lookup.mockImplementation(async (uuid: string) => uuid === mappedRoot + suffix.split('#')[0]
      ? { uuid: 'JournalEntry.syntheticWrong', documentName: 'JournalEntryPage' }
      : uuid === sourceRoot ? f.original : uuid === mappedRoot ? f.copy : null);
    await expect(prepare()).rejects.toThrow(DENIED);
  });
  it('denies lookup errors rather than treating them as absence', async () => {
    f.copy.getEmbeddedDocument.mockImplementation(() => { throw new Error('synthetic lookup error'); });
    await expect(prepare()).rejects.toThrow(DENIED);
  });
  it('denies mapped provenance or reverse mapping changes', async () => {
    f.mapped.flags['foundry-translate'].translation.sourceUuid = 'JournalEntry.syntheticOther';
    await expect(prepare()).rejects.toThrow(DENIED);
    f.mapped.flags['foundry-translate'].translation.sourceUuid = sourceRoot;
    f.snapshot.reverse.clear();
    await expect(prepare()).rejects.toThrow(DENIED);
  });
  it('denies mapped body mutation during an absence observation', async () => {
    f.copy.getEmbeddedDocument.mockImplementation(() => {
      f.mapped.pages[0].text.content += 'changed'; return null;
    });
    await expect(prepare()).rejects.toThrow(DENIED);
  });
  it('accepts a later ordinary mapped body edit only after fresh stable re-observation', async () => {
    const proof = await prepare();
    f.mapped.pages[0].text.content = 'later stable ordinary prose';
    const binding = await bindUnresolvedSourceRetention(f.snapshot, proof);
    await expect(binding.recheck()).resolves.toBeUndefined();
  });
  it('denies a child appearing after preparation on fresh bind', async () => {
    const proof = await prepare();
    f.mapped.pages.push({ _id: 'syntheticMissing' });
    await expect(bindUnresolvedSourceRetention(f.snapshot, proof)).rejects.toThrow(DENIED);
  });
});
