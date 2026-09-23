import { afterEach, expect, it, vi } from "vitest";
import { EditorialQueuePanel } from "../src/review/queue-panel";
import * as search from "../src/review/search";
import type { ReviewSnapshot, ReviewRow } from "../src/review/service";
const row = (id: string, extra = {}): ReviewRow => ({ id, group: "document", fieldId: "name", label: "name", format: "text", unitId: "text", source: [id], translation: [id], heading: false, fingerprint: id, blocked: null, verified: null, ...extra });
const snapshot = (uuid: string, rows: ReviewRow[]) => ({ entry: { uuid, sourceUuid: `source.${uuid}` }, groups: [{ id: "document", name: "Root" }], rows }) as ReviewSnapshot;
function fixture() {
  vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
  const open = vi.fn(async () => {}), status = vi.fn();
  const panel = new EditorialQueuePanel({ open, status, language: () => "cs", run: async action => action(), render: vi.fn() });
  return { panel, open, status };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("rebuilds the current queue before every next step, crosses documents and wraps while skipping checked/blocked/current rows", async () => {
  const { panel, open } = fixture();
  const index = vi.spyOn(search, "buildSearchIndex").mockResolvedValue({ snapshots: [snapshot("a", [row("first"), row("checked", { verified: {} }), row("blocked", { blocked: "Untranslated" })]), snapshot("b", [row("next")])], skipped: [] });
  await panel.next({ uuid: "a", sourceUuid: "source.a", rowId: "first", group: "document" });
  expect(open).toHaveBeenLastCalledWith("b", "document", "next");
  await panel.next({ uuid: "b", sourceUuid: "source.b", rowId: "next", group: "document" });
  expect(open).toHaveBeenLastCalledWith("a", "document", "first"); expect(index).toHaveBeenCalledTimes(2);
});
it("reports unavailable documents rather than claiming every passage has been reviewed", async () => {
  const { panel, open, status } = fixture();
  vi.spyOn(search, "buildSearchIndex").mockResolvedValue({ snapshots: [], skipped: [{ entry: snapshot("missing", []).entry, reason: "Review.SourceMissing" }] });
  await panel.next(); expect(open).not.toHaveBeenCalled(); expect(status.mock.lastCall?.[0]).toContain("QueueSkipped");
});
