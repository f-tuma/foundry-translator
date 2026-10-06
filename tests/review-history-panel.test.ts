import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import type { ReviewHistoryDocument } from "../src/review/service";
import type { PanelHost } from "../src/review/elements";

async function fixture() {
  vi.resetModules();
  const { document, Event } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
  const service = await import("../src/review/service");
  const read = vi.spyOn(service, "reviewHistory");
  const host: PanelHost = { language: () => "cs", render: vi.fn(), run: vi.fn(), open: vi.fn(), status: vi.fn() };
  const { ReviewHistoryPanel } = await import("../src/review/history-panel");
  const panel = new ReviewHistoryPanel(host);
  const history: ReviewHistoryDocument[] = [{ entry: { id: "copy", uuid: "Compendium.world.pack.JournalEntry.copy", kind: "JournalEntry", pack: "world.pack", name: "Guide", sourceUuid: "JournalEntry.source", language: "cs" }, operations: [{ id: "first", at: "2026-10-01", userName: "GM", sourceHash: "x", label: "Correction", rows: Array.from({ length: 1200 }, (_, i) => ({ rowId: String(i), before: [`Before ${i}`], after: [`After ${i}`], label: "text", group: "page" })) }] }];
  return { document, Event, read, host, panel, history };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("returns an interactive shell immediately, can stop loading, and ignores a late response", async () => {
  const { read, panel, history } = await fixture(); let complete!: (history: ReviewHistoryDocument[]) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const root = panel.render();
  expect(root.tagName).toBe("SECTION");
  expect(root.querySelectorAll("button")).toHaveLength(3);
  expect([...root.querySelectorAll("button")].find(b => b.textContent?.endsWith("ExportHistory"))!.disabled).toBe(true);
  [...root.querySelectorAll("button")].find(b => b.textContent?.endsWith("StopSearch"))!.click();
  expect(root.textContent).toContain("HistoryStopped");
  complete(history); await Promise.resolve(); expect(root.querySelectorAll("article")).toHaveLength(0);
  panel.invalidate(); read.mockResolvedValueOnce(history); panel.render(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
});
it("builds no collapsed diffs and bounds expanded changes to 20 paragraphs", async () => {
  const { panel, read, history, Event } = await fixture(); read.mockResolvedValue(history);
  const root = panel.render(); await Promise.resolve();
  expect(root.querySelectorAll(".ft-workbench__pair")).toHaveLength(0);
  const details = root.querySelector("details")!; details.open = true; details.dispatchEvent(new Event("toggle"));
  expect(root.querySelectorAll(".ft-workbench__pair")).toHaveLength(20);
  const next = [...details.querySelectorAll("button")].find(b => b.textContent?.endsWith("Next"))!; next.click();
  expect(details.textContent).toContain("Before 20"); expect(details.textContent).not.toContain("Before 0");
  expect(root.querySelectorAll(".ft-workbench__pair")).toHaveLength(20);
  details.open = false; details.dispatchEvent(new Event("toggle")); expect(root.querySelectorAll(".ft-workbench__pair")).toHaveLength(0);
});
it("invalidates outstanding loading on navigation and does not modify the detached panel", async () => {
  const { read, panel, history } = await fixture(); let complete!: (history: ReviewHistoryDocument[]) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const root = panel.render(); panel.invalidate(); complete(history); await Promise.resolve();
  expect(root.querySelectorAll("article")).toHaveLength(0);
});
it("shows the complete machine proofreading coverage and a metadata-only undo explanation", async () => {
  const { panel, read, history, Event } = await fixture();
  const op = history[0]!.operations[0]!;
  op.rows = []; op.label = "MCP: Full source/target review";
  op.machineProofreading = { before: null, after: { rowIds: ["a", "b", "c"], reason: "Read every passage" } } as any;
  read.mockResolvedValue(history); const root = panel.render(); await Promise.resolve();
  expect(root.textContent).toContain("Passages: 3");
  const details = root.querySelector("details")!; expect(details.textContent).toContain("MachineProofreading");
  details.open = true; details.dispatchEvent(new Event("toggle"));
  expect(details.textContent).toContain("Read every passage"); expect(details.textContent).toContain("MachineProofreadingDetails");
  [...root.querySelectorAll("button")].find(button => button.textContent?.endsWith(".Undo"))!.click();
  expect(root.textContent).toContain("MachineProofreadingUndoWarning");
  expect(root.textContent).toContain("ConfirmUndo");
});
