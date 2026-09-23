import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { findTextMatches, searchableSegments, searchReviews, replaceHits, type SearchIndex } from "../src/review/search";
import { planBulk, applyBulk } from "../src/review/bulk";
import * as service from "../src/review/service";
import { resolveReviewTarget } from "../src/review/target";
import type { ReviewSnapshot } from "../src/review/service";
const row = { id: "row", fieldId: "field", unitId: "text", group: "document", label: "name", format: "text" as const, source: ["Agraband Swift"],
  translation: ["Agraband Rychlý potkal Agrabanda Rychlého."], heading: false, fingerprint: "f", verified: null, blocked: null };
function view(id: string): ReviewSnapshot {
  return { entry: { id, pack: "world.pack", uuid: `Compendium.world.pack.Actor.${id}`, name: id, kind: "Actor", sourceUuid: `Actor.${id}`, language: "cs" },
    sourceName: id, rows: [structuredClone(row)], fields: [], groups: [{ id: "document", name: "Biography" }], guard: { id, fingerprint: "guard" }, sourceHash: "hash", warning: null, partial: false, reverse: new Map() };
}
beforeEach(() => vi.stubGlobal("document", parseHTML("<html></html>").document));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("finds accented, inflected and mistyped names while retaining original offsets and exact variants", () => {
  const text = "S Agrabandem Rychlým, potom Agraband Rychlý a Agraband Rychlé. Jiné jméno.";
  expect(findTextMatches(text, "agraband rychly").map(hit => hit.text)).toEqual(["Agraband Rychlý"]);
  expect(findTextMatches(text, "agraband rychly", true).map(hit => hit.text)).toEqual(["Agrabandem Rychlým", "Agraband Rychlý", "Agraband Rychlé"]);
  expect(findTextMatches("AgrabandX Rychlý", "Agraband Rychlý")).toEqual([]);
  expect(findTextMatches("Old. Gate", "Old Gate", true)).toEqual([]);
  expect(findTextMatches("Odl Gate", "Old Gate", true)).toEqual([]); // Short common words must match exactly.
  const decomposed = "Rychly\u0301"; expect(findTextMatches(decomposed, "Rychlý")[0]).toMatchObject({ start: 0, end: decomposed.length, text: decomposed });
  expect(findTextMatches("Agarband", "Agraband", true)).toHaveLength(1);
});
it("replaces only selected occurrences with separate inflected replacements", () => {
  const snapshot = view("a"), index = { snapshots: [snapshot], skipped: [] };
  const hits = searchReviews(index, "Agraband Rychlý", true);
  expect(hits).toHaveLength(2);
  const plan = planBulk(index, hits.map(hit => ({ hit, replacement: hit.variant === "Agraband Rychlý" ? "Agraband Hbitý" : "Agrabanda Hbitého" })), "Agraband");
  expect(plan.documents[0]!.changes[0]!.parts).toEqual(["Agraband Hbitý potkal Agrabanda Hbitého."]);
  const selected = planBulk(index, [{ hit: hits[0]!, replacement: "Agraband Hbitý" }], "Agraband");
  expect(selected.documents[0]!.changes[0]!.parts[0]).toContain("Agrabanda Rychlého");
  expect(() => planBulk(index, [{ hit: hits[0]!, replacement: "" }], "bad")).toThrow("EmptyText");
});
it("protects UUIDs, rolls, URLs and code but finds editable link labels", () => {
  const parts = ['Rychlý @UUID[Actor.Rychly]{Rychlý} @Embed[Actor.Rychly]{Rychlý} [[Rychly]] `Rychlý` [Rychlý](https://Rychly.test)'];
  const segments = searchableSegments(parts, "markdown");
  expect(segments.map(segment => segment.text).join(" ")).not.toMatch(/Actor|https:|Embed|\[\[/u);
  const snapshot = view("a"); snapshot.rows[0]!.translation = parts; snapshot.rows[0]!.format = "markdown" as any;
  const hits = searchReviews({ snapshots: [snapshot], skipped: [] }, "Rychlý", false);
  expect(hits).toHaveLength(3);
  expect(replaceHits(snapshot.rows[0]!, hits.map(hit => ({ hit, replacement: "Hbitý" })))[0]).toBe('Hbitý @UUID[Actor.Rychly]{Hbitý} @Embed[Actor.Rychly]{Rychlý} [[Rychly]] `Rychlý` [Hbitý](https://Rychly.test)');
});
it("skips incomplete pages and keeps blocked results read only", () => {
  const snapshot = view("a"); snapshot.rows.push({ ...row, id: "pending", blocked: "Untranslated" }, { ...row, id: "locked", blocked: "Locked" });
  const index: SearchIndex = { snapshots: [snapshot], skipped: [] }, hits = searchReviews(index, "Agraband", false);
  expect(hits.map(hit => hit.rowId)).toEqual(["row", "locked"]);
  expect(() => planBulk(index, [{ hit: hits[1]!, replacement: "Else" }], "test")).toThrow("Locked");
});
it("preflights all documents before saving, and stops at first failed write", async () => {
  const a = view("a"), b = view("b"), index = { snapshots: [a, b], skipped: [] };
  const plan = planBulk(index, searchReviews(index, "Agraband", false).map(hit => ({ hit, replacement: "Agrabant" })), "name");
  const load = vi.spyOn(service, "loadReview").mockImplementation(async entry => entry.id === "a" ? a : { ...b, guard: { id: "b", fingerprint: "changed" } });
  const save = vi.spyOn(service, "saveReviewRows").mockResolvedValue(a);
  await expect(applyBulk(plan, vi.fn(), () => false)).rejects.toThrow("Conflict"); expect(save).not.toHaveBeenCalled();
  load.mockImplementation(async entry => entry.id === "a" ? a : b);
  save.mockResolvedValueOnce(a).mockRejectedValueOnce(new Error("Disconnected"));
  expect(await applyBulk(plan, vi.fn(), () => false)).toEqual({ completed: [a.entry.uuid], failed: b.entry.uuid, error: "Disconnected" });
});
it("resolves original and translated embedded document shortcuts unambiguously", () => {
  const a = view("a").entry, item = { ...view("item").entry, kind: "Item" as const, sourceUuid: "Actor.a.Item.sword" };
  expect(resolveReviewTarget([a], "Actor.a.Item.sword")).toEqual({ entry: a, group: "items:sword" });
  expect(resolveReviewTarget([a, item], "Actor.a.Item.sword")!.entry).toBe(item);
  expect(resolveReviewTarget([a], `${a.uuid}.Item.sword`)!.group).toBe("items:sword");
  expect(resolveReviewTarget([a, { ...a, uuid: "duplicate" }], "Actor.a")).toBeNull();
});
it("surfaces names split across inline formatting for manual editing without unsafe bulk replacement", () => {
  const snapshot = view("a"); snapshot.rows[0]!.translation = ["Agraband", " Rychlý přijel."];
  const index = { snapshots: [snapshot], skipped: [] }, hits = searchReviews(index, "Agraband Rychlý", true);
  expect(hits).toHaveLength(1); expect(hits[0]!.blocked).toBe("SplitFormatting");
  expect(() => planBulk(index, [{ hit: hits[0]!, replacement: "Other" }], "test")).toThrow("SplitFormatting");
});
it("stops a bulk operation at a document boundary without writing the remaining documents", async () => {
  const a = view("a"), b = view("b"), index = { snapshots: [a, b], skipped: [] };
  const plan = planBulk(index, searchReviews(index, "Agraband", false).map(hit => ({ hit, replacement: "Agrabant" })), "test");
  vi.spyOn(service, "loadReview").mockImplementation(async entry => entry.id === "a" ? a : b);
  let stopped = false;
  const save = vi.spyOn(service, "saveReviewRows").mockImplementation(async () => { stopped = true; return a; });
  expect(await applyBulk(plan, vi.fn(), () => stopped)).toEqual({ completed: [a.entry.uuid], failed: null, error: "Review.BatchStopped" });
  expect(save).toHaveBeenCalledOnce();
});
