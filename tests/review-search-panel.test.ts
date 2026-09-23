import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewSearchPanel } from "../src/review/search-panel";
import * as search from "../src/review/search";
import * as bulk from "../src/review/bulk";
import type { ReviewSnapshot } from "../src/review/service";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("requires an explicit preview and save, and disables preview when the query changes", async () => {
  const { document, Event } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  vi.stubGlobal("game", { i18n: { localize: (key: string) => key.split(".").at(-1)! } });
  const snapshot: ReviewSnapshot = { entry: { id: "a", uuid: "Actor.a", pack: "world.pack", name: "Name", kind: "Actor", sourceUuid: "Actor.original", language: "cs" },
    sourceName: "Name", rows: [{ id: "row", fieldId: "name", unitId: "text", group: "document", label: "name", format: "text", source: ["Agraband Swift"], translation: ["Agraband Rychlý"], heading: false, fingerprint: "f", verified: null, blocked: null }],
    fields: [], groups: [{ id: "document", name: "Name" }], guard: { id: "a", fingerprint: "x" }, sourceHash: "source", warning: null, partial: false, reverse: new Map() };
  vi.spyOn(search, "buildSearchIndex").mockResolvedValue({ snapshots: [snapshot], skipped: [] });
  const apply = vi.spyOn(bulk, "applyBulk").mockResolvedValue({ completed: [snapshot.entry.uuid], failed: null, error: null });
  const root = document.createElement("div"); let pending = Promise.resolve();
  const panel = new ReviewSearchPanel({ language: () => "cs", status: vi.fn(), open: vi.fn(), render: () => { root.replaceChildren(panel.render()); }, run: action => { pending = action().then(() => { root.replaceChildren(panel.render()); }); } });
  const render = () => root.replaceChildren(panel.render()); render();
  const query = root.querySelector<HTMLInputElement>('input[type="search"]')!; query.value = "Agraband"; query.dispatchEvent(new Event("input"));
  const click = (label: string) => [...root.querySelectorAll("button")].find(button => button.textContent === label)!.click();
  click("Find"); await pending;
  const variant = root.querySelector<HTMLInputElement>(".ft-workbench__variant input[type='checkbox']")!; variant.checked = true; variant.dispatchEvent(new Event("change"));
  const replacement = root.querySelector<HTMLInputElement>(".ft-workbench__variant input[type='text']")!; replacement.value = "Agrabant"; replacement.dispatchEvent(new Event("input"));
  expect(apply).not.toHaveBeenCalled(); expect(panel.dirty).toBe(true);
  const changedQuery = root.querySelector<HTMLInputElement>('input[type="search"]')!; changedQuery.value = "Other"; changedQuery.dispatchEvent(new Event("input"));
  expect(root.querySelector<HTMLButtonElement>("[data-preview-changes]")!.disabled).toBe(true);
  changedQuery.value = "Agraband"; changedQuery.dispatchEvent(new Event("input"));
  click("PreviewChanges"); await pending;
  expect(root.querySelector("ins")!.textContent).toBe("t"); expect(apply).not.toHaveBeenCalled();
  expect(root.querySelector<HTMLFormElement>("form")!.hidden).toBe(true);
  click("ApplySelected"); await pending;
  expect(apply).toHaveBeenCalledOnce(); expect(panel.dirty).toBe(false);
});
