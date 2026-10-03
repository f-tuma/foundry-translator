import { afterEach, expect, it, vi } from "vitest";
import { readSourceReferenceContext, sourceReferences } from "../src/polish/reference-context";
import { parseLiveRequest } from "../src/polish/live-protocol";
import type { ReviewField, ReviewRow, ReviewSnapshot } from "../src/review/service";

const uuid = "Compendium.ember.character.Item.lightsworn000000";
const snapshot = { entry: { sourceUuid: "JournalEntry.guide" } } as ReviewSnapshot;
const field = { referenceContext: "JournalEntry.guide.JournalEntryPage.paths" } as ReviewField;
const row = { source: [`Read @UUID[${uuid}]{Lightsworn}.`] } as ReviewRow;
afterEach(() => vi.unstubAllGlobals());

it("reads full referenced Item prose without returning mechanics, flags or unrelated documents", async () => {
  const read = vi.fn(async (_target: string) => ({ uuid, documentName: "Item", toObject: () => ({ name: "Lightsworn", system: { description: "<p>A sworn oath.</p>", damage: 15, script: "execute()" }, flags: { secret: "hidden" } }),
    system: { constructor: { schema: { fields: { description: { constructor: { name: "HTMLField" } }, damage: { constructor: { name: "NumberField" } }, script: { constructor: { name: "StringField" } } } } } } }));
  vi.stubGlobal("fromUuid", read);
  expect(sourceReferences(snapshot, field, row)).toEqual([{ index: 0, sourceUuid: uuid }]);
  const first = await readSourceReferenceContext(snapshot, field, row, 0, 0, 1);
  expect(first).toMatchObject({ total: 2, fields: [{ path: ["name"], text: "Lightsworn" }], nextOffset: 1 });
  const next = await readSourceReferenceContext(snapshot, field, row, 0, 1, 1);
  expect(next.fields).toEqual([{ path: ["system", "description"], format: "html", text: "<p>A sworn oath.</p>" }]);
  expect(next.nextOffset).toBeNull();
  expect(JSON.stringify([first, next])).not.toMatch(/"(?:damage|script|secret)"|execute\(\)|hidden/);
  expect(read.mock.calls.every(([target]) => target === uuid)).toBe(true);
});

it("uses exact source-relative page references and includes both prose and Ember captions", async () => {
  const pageUuid = "JournalEntry.guide.JournalEntryPage.other";
  const read = vi.fn(async (target: string) => target === "JournalEntry.guide" ? { uuid: target, documentName: "JournalEntry" } : target === pageUuid ? {
    uuid: target, documentName: "JournalEntryPage", toObject: () => ({ name: "Oath", type: "ember.character", text: { content: "<p>Read this.</p>" }, system: { subtitle: "Oathkeeper", trigger: "execute()" } }),
    system: { constructor: { schema: { fields: { subtitle: { constructor: { name: "StringField" } }, trigger: { constructor: { name: "StringField" } } } } } },
  } : null);
  vi.stubGlobal("fromUuid", read);
  const linked = { source: ["Read @UUID[.other]{Oath}."] } as ReviewRow;
  const result = await readSourceReferenceContext(snapshot, field, linked, 0, 0, 20);
  expect(result).toMatchObject({ sourceUuid: pageUuid, kind: "JournalEntryPage", total: 3 });
  expect(result.fields.map(f => f.text)).toEqual(["Oath", "<p>Read this.</p>", "Oathkeeper"]);
  expect(JSON.stringify(result)).not.toContain("execute");
});

it("fails closed on absent references, targets and translated roots", async () => {
  const read = vi.fn(async () => null);
  vi.stubGlobal("fromUuid", read);
  await expect(readSourceReferenceContext(snapshot, field, row, 1, 0, 20)).rejects.toThrow("Live.ReferenceUnavailable");
  expect(read).not.toHaveBeenCalled();
  await expect(readSourceReferenceContext(snapshot, field, row, 0, 0, 20)).rejects.toThrow("Live.ReferenceUnavailable");
  read.mockResolvedValue({ uuid, documentName: "Item", flags: { "foundry-translate": { itemTranslation: { schemaVersion: 1, sourceUuid: "Item.original", sourceHash: "hash", providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedHtmlFields: 1 } } } } as any);
  await expect(readSourceReferenceContext(snapshot, field, row, 0, 0, 20)).rejects.toThrow("Live.ReferenceUnavailable");
});

it("accepts only a bounded reference index tied to an existing translated paragraph", () => {
  const args = { documentId: "translated", rowId: "a".repeat(64), referenceIndex: 0 };
  expect(parseLiveRequest({ id: "ref", method: "get_reference_context", args }).args.referenceIndex).toBe(0);
  for (const invalid of [{ ...args, sourceUuid: uuid }, { ...args, referenceIndex: -1 }, { ...args, referenceIndex: 1001 }, { ...args, referenceIndex: "0" }, { documentId: "translated", referenceIndex: 0 }]) {
    expect(() => parseLiveRequest({ id: "ref", method: "get_reference_context", args: invalid })).toThrow("Live.InvalidRequest");
  }
  expect(() => parseLiveRequest({ id: "ref", method: "get_context", args })).toThrow("Live.InvalidRequest");
});
