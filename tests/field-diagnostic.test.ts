import { parseHTML } from "linkedom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { diagnoseReferenceRebuild, prepareReferenceRebuild } from "../src/review/reference-rebuild";
import { restoreSourcePunctuation, type SourcePunctuationDiagnostic } from "../src/review/source-punctuation";
import { readFieldDiagnostic } from "../src/polish/field-diagnostic";
import { parseLiveRequest } from "../src/polish/live-protocol";
import { diagnosePortableText } from "../src/bundles/format";
import { planReviewText } from "../src/review/text-plan";
import { portableReviewText, type ReviewSnapshot } from "../src/review/service";
beforeEach(() => {
  vi.stubGlobal("document", parseHTML("<html></html>").document);
  vi.stubGlobal("game", { system: { id: "crucible" }, modules: new Map([["ember", { active: true, version: "0.6.2" }]]) });
});
afterEach(() => vi.unstubAllGlobals());
function snapshot(source: string, translation: string, format: "html" | "text" = "html"): ReviewSnapshot {
  const field = { id: "field", source, translation, format, targetPath: ["description"], displayPlain: false };
  const view: ReviewSnapshot = { entry: { id: "copy", pack: "world.translations", uuid: "Compendium.world.translations.JournalEntry.copy", name: "Synthetic", kind: "JournalEntry", sourceUuid: "JournalEntry.original", language: "cs" }, sourceName: "Synthetic", rows: [], fields: [field], groups: [], sourceHash: "s".repeat(64), warning: null, partial: false, guard: { fingerprint: "g".repeat(64) } as ReviewSnapshot["guard"], reverse: new Map() };
  const blocked = diagnosePortableText(source, portableReviewText(view, field, translation), format) ? "StructureChanged" : null;
  const current = planReviewText(translation, format);
  view.rows = planReviewText(source, format).units.map((unit, index) => ({ id: String(index), unitId: unit.id, fieldId: field.id, format, group: "document", label: "description", source: unit.parts, translation: current.units.find(other => other.id === unit.id)?.parts ?? [], heading: unit.heading, fingerprint: "f", blocked, verified: null }));
  return view;
}
const source = '<p>First<strong>,</strong> then second.</p>';
const current = '<p>První<strong></strong> a druhá.</p>';
it("reports the same successful pure punctuation proof without changing source/current", async () => {
  const view = snapshot(source, current), before = JSON.stringify(view);
  const result = await readFieldDiagnostic(view, "field", 0, 50);
  expect(result.raw).toEqual({ complete: true, source, current });
  expect(result.rebuild).toMatchObject({ canPrepare: true, stage: "ready", punctuation: { stage: "ready" } });
  expect(result.units[0]).toMatchObject({ sourceParts: 3, currentParts: 2 });
  expect(JSON.stringify(view)).toBe(before);
});
it("pinpoints translated prose attributes rejected by strict raw punctuation walker without weakening it", async () => {
  const view = snapshot(source.replace("<p>", '<p title="Source">'), current.replace("<p>", '<p title="Překlad">'));
  expect(await prepareReferenceRebuild(view, "field")).toBeNull();
  expect(await diagnoseReferenceRebuild(view, "field")).toMatchObject({ canPrepare: false, stage: "canonical-integrity", predicate: "only-command-defects-after-proved-punctuation", punctuation: { stage: "raw-walk", predicate: "all-raw-attributes-equal", path: "html/0" } });
});
it.each([
  [current.replace("<strong></strong>", "<em></em>"), "raw-walk", "tag-equal"],
  [current.replace("<strong></strong>", "<strong> </strong>"), "candidate", "exactly-one-inline-punctuation-candidate"],
])("observes actual punctuation predicate and keeps null: %s", (before, stage, predicate) => {
  const trace: { value?: SourcePunctuationDiagnostic } = {};
  expect(restoreSourcePunctuation(source, before, trace)).toBeNull();
  expect(trace.value).toMatchObject({ stage, predicate });
});
it("identifies no-repair case rather than invented candidate", async () => {
  expect(await diagnoseReferenceRebuild(snapshot('<p>Source.</p>', '<p>Překlad.</p>'), "field")).toMatchObject({ canPrepare: false, predicate: "repair-required" });
});
it("paginates inert nodes and never exposes other fields, flags or users", async () => {
  const view = snapshot(source, current); view.fields.push({ ...view.fields[0]!, id: "other", source: "SECRET_OTHER", translation: "SECRET_OTHER" });
  const result = await readFieldDiagnostic(view, "field", 0, 1), all = JSON.stringify(result);
  expect(result.nodes.items).toHaveLength(1); expect(result.nodes.nextOffset).toBe(1);
  expect(all).not.toContain("SECRET_OTHER"); expect(all).not.toContain("userId");
  await expect(readFieldDiagnostic(view, "flags.authentication", 0, 1)).rejects.toThrow("MissingField");
});
it("omits unsafe raw executable/credential payload but keeps structural diagnosis", async () => {
  const result = await readFieldDiagnostic(snapshot('<p>Source.</p><script>SECRET_CREDENTIAL</script>', '<p>Překlad.</p><script>SECRET_CREDENTIAL</script>'), "field", 0, 50);
  expect(result.raw).toMatchObject({ complete: false, omittedReason: "UnsafeRawPayload" });
  expect(JSON.stringify(result)).not.toContain("SECRET_CREDENTIAL");
});
it("omits oversized raw whole values explicitly rather than truncating prose", async () => {
  const result = await readFieldDiagnostic(snapshot(`<p>${"x".repeat(65000)}</p>`, `<p>${"y".repeat(65000)}</p>`), "field", 0, 50);
  expect(result.raw).toMatchObject({ complete: false, omittedReason: "RawSizeLimit" }); expect(result.truncated).toBe(false);
});
it("requires revision and rejects arbitrary paths/source IDs/write arguments", () => {
  const args = { documentId: "allowed", fieldId: "field", revision: "a".repeat(64) };
  expect(parseLiveRequest({ id: "diagnostic", method: "get_field_diagnostic", args }).args).toMatchObject(args);
  for (const extra of [{ rowId: "b".repeat(64) }, { sourceUuid: "Actor.other" }, { text: ["changed"] }, { operationId: "write" }, { options: [] }, { path: ["flags"] }, { restoreSourceNumbers: true }])
    expect(() => parseLiveRequest({ id: "diagnostic", method: "get_field_diagnostic", args: { ...args, ...extra } })).toThrow("InvalidRequest");
  const { revision: _, ...missing } = args;
  expect(() => parseLiveRequest({ id: "diagnostic", method: "get_field_diagnostic", args: missing })).toThrow("InvalidRequest");
});

it("never duplicates changed excluded values in integrity metadata", async () => {
  const result = await readFieldDiagnostic(snapshot('<p>Source.</p><script>SECRET_A</script>', '<p>Překlad.</p><script>SECRET_B</script>'), "field", 0, 50);
  expect(result.raw).toMatchObject({ complete: false, omittedReason: "UnsafeRawPayload" });
  expect(result.integrity).toMatchObject({ rejected: true, markup: [{ path: expect.any(String), sourceKind: expect.any(String), currentKind: expect.any(String) }] });
  for (const secret of ["SECRET_A", "SECRET_B"]) expect(JSON.stringify(result)).not.toContain(secret);
});
it.each([
  ['<a href="https://example.test/?api_key=SECRET_A">Source</a>', '<a href="https://example.test/?api_key=SECRET_B">Překlad</a>'],
  ['<a href="javascript:SECRET_A">Source</a>', '<a href="javascript:SECRET_B">Překlad</a>'],
  ['<iframe srcdoc="&lt;script&gt;SECRET_A&lt;/script&gt;"></iframe>', '<iframe srcdoc="&lt;script&gt;SECRET_B&lt;/script&gt;"></iframe>'],
])("suppresses unsafe changed credential/executable values in raw and integrity", async (source, current) => {
  const result = await readFieldDiagnostic(snapshot(source, current), "field", 0, 50);
  expect(result.raw).toMatchObject({ complete: false, omittedReason: "UnsafeRawPayload" });
  for (const secret of ["SECRET_A", "SECRET_B"]) expect(JSON.stringify(result)).not.toContain(secret);
});
it("suppresses changed credential URLs in text/plain before making an export claim", async () => {
  const result = await readFieldDiagnostic(snapshot("Source https://example.test/?access_token=SECRET_A", "Překlad https://example.test/?access_token=SECRET_B", "text"), "field", 0, 50);
  expect(result.raw).toMatchObject({ complete: false, omittedReason: "UnsafeRawPayload" });
  for (const secret of ["SECRET_A", "SECRET_B"]) expect(JSON.stringify(result)).not.toContain(secret);
});
it("does not return command bodies or their credential values in structural counts", async () => {
  const result = await readFieldDiagnostic(snapshot('@UUID[JournalEntry.original]{https://example.test/?token=SECRET_A}', '@UUID[JournalEntry.other]{https://example.test/?token=SECRET_B}', "text"), "field", 0, 50);
  expect(result.raw).toMatchObject({ complete: false });
  expect(result.integrity?.commands).toMatchObject({ missingKinds: 1, extraKinds: 1 });
  for (const secret of ["SECRET_A", "SECRET_B", "JournalEntry.original", "JournalEntry.other"]) expect(JSON.stringify(result)).not.toContain(secret);
});

it("examines decoded HTML attribute executable URLs before exporting raw", async () => {
  const result = await readFieldDiagnostic(snapshot('<p><a href="java&#x73;cript:SECRET_A">Source</a></p>', '<p><a href="java&#x73;cript:SECRET_B">Překlad</a></p>'), "field", 0, 50);
  expect(result.raw).toMatchObject({ complete: false, omittedReason: "UnsafeRawPayload" });
  for (const secret of ["SECRET_A", "SECRET_B"]) expect(JSON.stringify(result)).not.toContain(secret);
});
