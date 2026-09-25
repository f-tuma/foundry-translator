import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalReviewDrafts, draftIdentity, recoverText, type DraftPayload } from "../src/review/drafts";
import { previewRecovery } from "../src/review/recovery-panel";
import * as service from "../src/review/service";
import { restoreReviewReferences } from "../src/review/text-plan";

let values: Map<string, string>;
const payload: DraftPayload = { kind: "text", uuid: "copy", sourceUuid: "Actor.source", rowId: "row", group: "document", name: "Name", source: "Original", baseline: ["Čti @UUID[Actor.source]{Jméno}."], text: ["Přečti ⟦1⟧."], labels: [["Nové jméno"]] };
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal("game", { world: { id: "ember" }, user: { id: "gm" }, i18n: { localize: (key: string) => key } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("recovers across cold editor instances, isolates world/user/language and retains link labels", () => {
  const report = vi.fn(), first = new LocalReviewDrafts(() => "cs", report); first.write(payload);
  const cold = new LocalReviewDrafts(() => "cs", report), saved = cold.list()[0]!;
  const draft = recoverText(saved.payload as Extract<DraftPayload, { kind: "text" }>);
  expect(restoreReviewReferences(draft.text[0]!, draft.references[0]!)).toBe("Přečti @UUID[Actor.source]{Nové jméno}.");
  expect(new LocalReviewDrafts(() => "en", report).list()).toEqual([]);
  (game.user as any).id = "other"; expect(cold.list()).toEqual([]);
  (game.user as any).id = "gm"; (game.world as any).id = "different"; expect(cold.list()).toEqual([]);
  expect(report).not.toHaveBeenCalled();
});
it("retains the crash copy until save/discard and never deletes another tab's newer draft", () => {
  const first = new LocalReviewDrafts(() => "cs", vi.fn()); first.write(payload);
  const second = new LocalReviewDrafts(() => "cs", vi.fn()), saved = second.list()[0]!;
  second.adopt(saved, payload); expect(second.list()).toHaveLength(2);
  first.write({ ...payload, text: ["Ještě novější ⟦1⟧."] });
  second.clear(draftIdentity(payload));
  expect(second.list()).toHaveLength(1); expect((second.list()[0]!.payload as any).text).toEqual(["Ještě novější ⟦1⟧."]);
});
it("reports storage failures while keeping the current draft downloadable", () => {
  const report = vi.fn(), storage = new LocalReviewDrafts(() => "cs", report);
  vi.stubGlobal("localStorage", { setItem: () => { throw Error("Quota"); }, get length() { throw Error("Denied"); } });
  storage.write(payload); expect(report).toHaveBeenCalledWith("DraftStorageFailed");
  expect(storage.list()[0]?.payload).toEqual(payload);
});
it("previews changed translations and blocks changed originals without any writes", async () => {
  const snapshot = { entry: { uuid: "copy", sourceUuid: "Actor.source" }, fields: [{ id: "name", source: "Original" }], rows: [{ id: "row", fieldId: "name", translation: ["Cizí změna"], blocked: null }] } as unknown as service.ReviewSnapshot;
  vi.spyOn(service, "reviewCatalog").mockResolvedValue([snapshot.entry]); vi.spyOn(service, "loadReview").mockResolvedValue(snapshot);
  const saved = { version: 1 as const, id: "draft", at: "2026-09-23", payload };
  const preview = await previewRecovery(saved, "cs"); expect(preview.conflict).toBe(true); expect(preview.blocked).toBe(false); expect(preview.current).toEqual(["Cizí změna"]);
  snapshot.fields[0]!.source = "Different source";
  expect((await previewRecovery(saved, "cs")).blocked).toBe(true);
  expect(values.size).toBe(0);
});
it("migrates legacy per-fragment marker numbers without losing unfinished edits", () => {
  const old = { ...payload, kind: 'text' as const, baseline: ['@UUID[Actor.a]', 'and @UUID[Actor.b]'], text: ['⟦1⟧', 'a ⟦1⟧'], labels: [['Áčko'], ['Béčko']] };
  const recovered = recoverText(old);
  expect(recovered.text).toEqual(['⟦1⟧', 'a ⟦2⟧']);
  expect(recovered.references[1]![0]!.label).toBe('Béčko');
  const modern = recoverText({ ...old, referenceScope: 'row', text: ['⟦2⟧ a ⟦1⟧', 'zbytek'] });
  expect(modern.text).toEqual(['⟦2⟧ a ⟦1⟧', 'zbytek']);
});

it("retains embed captions from old drafts that did not yet expose them as editable", () => {
  const old = { ...payload, kind: 'text' as const, baseline: ['@Embed[JournalEntry.a inline]{Původní popisek}'], text: ['Přečti ⟦1⟧.'], labels: [['']] };
  expect(recoverText(old).references[0]![0]!.label).toBe('Původní popisek');
  expect(recoverText({ ...old, referenceScope: 'row' }).references[0]![0]!.label).toBe('');
});
