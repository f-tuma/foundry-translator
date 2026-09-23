import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import type { ReviewSnapshot } from "../src/review/service";

async function fixture() {
  vi.resetModules();
  const { document, Event } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("game", { world: { id: "qa" }, user: { id: "gm", isGM: true }, i18n: { localize: (key: string) => key }, tooltip: { activate: vi.fn(), deactivate: vi.fn(), clearPending: vi.fn() } });
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] ?? null, getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("foundry", { applications: { api: { ApplicationV2: class {
    readonly element = document.createElement("section");
    readonly content = document.createElement("div");
    constructor() { const close = document.createElement("button"); close.dataset.nativeClose = ""; this.element.append(close, this.content); }
    async render() { const self = this as any; self._replaceHTML(await self._renderHTML(), self.content); self._onRender(); return this; }
    async close() { this.element.remove(); return this; }
  } } } });
  const service = await import("../src/review/service");
  const glossary = await import("../src/glossary/compendium-repository");
  vi.spyOn(glossary.GlossaryCompendiumRepository.prototype, "loadExisting").mockResolvedValue([]);
  const settings = await import("../src/settings/settings");
  vi.spyOn(settings, "getTranslatorSettings").mockReturnValue({ targetLanguage: "cs" } as ReturnType<typeof settings.getTranslatorSettings>);
  const snapshot: ReviewSnapshot = { entry: { id: "copy", uuid: "Compendium.world.pack.JournalEntry.copy", kind: "JournalEntry", name: "<img src=x onerror=alert(1)>", sourceUuid: "JournalEntry.source", language: "cs", pack: "world.pack" },
    rows: [{ id: "row1", fieldId: "field1", group: "document", unitId: "text", label: "name", format: "text", source: ["Original"], translation: ["Překlad"], fingerprint: "f1", verified: null, heading: false, blocked: null },
      { id: "row2", fieldId: "field2", group: "page2", unitId: "text", label: "name", format: "text", source: ["Other"], translation: ["Další"], fingerprint: "f2", verified: null, heading: false, blocked: null }],
    sourceName: "Source", fields: ["field1", "field2"].map(id => ({ id, source: id === "field1" ? "Original" : "Other", translation: id === "field1" ? "Překlad" : "Další", format: "text", targetPath: ["name"], displayPlain: false })), groups: [{ id: "document", name: "Source" }, { id: "page2", name: "Page two" }], guard: { id: "copy", fingerprint: "x" }, sourceHash: "source", warning: null, partial: false, reverse: new Map() };
  vi.spyOn(service, "reviewCatalog").mockResolvedValue([snapshot.entry]);
  vi.spyOn(service, "loadReview").mockResolvedValue(snapshot);
  const save = vi.spyOn(service, "updateReview").mockImplementation(async (view, id, action) => ({ ...view, rows: view.rows.map(row => row.id === id ? { ...row, translation: action.type === "save" ? action.parts : row.translation,
    verified: action.type === "verify" ? { fingerprint: row.fingerprint, at: "2026-09-22", userId: "gm", userName: "GM" } : null } : row) }));
  const { TranslationReviewApplication } = await import("../src/review/review-app");
  const app = new TranslationReviewApplication(); document.body.append(app.element); await app.render(true);
  return { app, Event, save, snapshot, storage, TranslationReviewApplication };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("offers a persisted crash draft in a new editor, restores only to the form and clears recovery only after saving", async () => {
  const { app, Event, save, storage, TranslationReviewApplication } = await fixture();
  const input = app.element.querySelector("textarea")!; input.value = "Rozepsaná oprava"; input.dispatchEvent(new Event("input"));
  expect([...storage.keys()].some(key => key.includes("review-draft"))).toBe(true);
  app.element.remove();
  const cold = new TranslationReviewApplication(); document.body.append(cold.element); await cold.render(true);
  expect(cold.element.querySelector("textarea")!.value).toBe("Překlad"); expect(save).not.toHaveBeenCalled();
  const click = (text: string) => { const item = [...cold.element.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes(`Review.${text}`)); expect(item).toBeTruthy(); item!.click(); };
  click("Recovery"); await vi.waitFor(() => expect(cold.element.textContent).toContain("DownloadDraft"));
  click("Preview"); await vi.waitFor(() => expect(cold.element.textContent).toContain("RecoveryReady"));
  click("RecoverDraft"); await vi.waitFor(() => expect(cold.element.querySelector("textarea")!.value).toBe("Rozepsaná oprava"));
  expect(save).not.toHaveBeenCalled();
  cold.element.querySelector<HTMLButtonElement>("[data-review-save]")!.click();
  await vi.waitFor(() => expect(cold.element.querySelector("[data-review-status]")!.textContent).toContain("Saved"));
  expect([...storage.keys()].filter(key => key.includes("review-draft"))).toEqual([]);
  expect(cold.element.querySelector("[data-row-status]")!.textContent).toContain("NeedsReview");
});

it("keeps drafts across sections, prevents accidental closing and requires saving before verification", async () => {
  const { app, Event, save } = await fixture();
  expect(app.element.querySelector("img")).toBeNull();
  const input = app.element.querySelector("textarea")!; input.value = "Ruční oprava"; input.dispatchEvent(new Event("input"));
  expect(app.element.querySelector<HTMLButtonElement>("[data-review-verify]")!.disabled).toBe(true);
  expect(app.element.querySelector("[data-row-status]")!.textContent).toContain("Unsaved");
  await app.close(); expect(app.element.isConnected).toBe(true);
  (app.element.querySelectorAll("nav button")[1] as HTMLButtonElement).click();
  await vi.waitFor(() => expect(app.element.querySelector("textarea")!.value).toBe("Další"));
  (app.element.querySelectorAll("nav button")[0] as HTMLButtonElement).click();
  await vi.waitFor(() => expect(app.element.querySelector("textarea")!.value).toBe("Ruční oprava"));
  app.element.querySelector<HTMLButtonElement>("[data-review-save]")!.click();
  expect(app.element.querySelector<HTMLButtonElement>("[data-native-close]")!.disabled).toBe(false);
  await vi.waitFor(() => expect(app.element.querySelector("[data-row-status]")!.textContent).toContain("NeedsReview"));
  expect(save).toHaveBeenLastCalledWith(expect.anything(), "row1", { type: "save", parts: ["Ruční oprava"] });
  app.element.querySelector<HTMLButtonElement>("[data-review-verify]")!.click();
  await vi.waitFor(() => expect(app.element.querySelector("[data-row-status]")!.textContent).toContain("Verified"));
  await app.close(); expect(app.element.isConnected).toBe(false);
});
it("retains the draft after a detected conflict and does not mark it verified", async () => {
  const { app, Event, save } = await fixture(); save.mockRejectedValueOnce(new Error("Review.Conflict"));
  const input = app.element.querySelector("textarea")!; input.value = "Moje oprava"; input.dispatchEvent(new Event("input"));
  app.element.querySelector<HTMLButtonElement>("[data-review-save]")!.click();
  await vi.waitFor(() => expect(app.element.querySelector("[data-review-status]")!.textContent).toContain("Conflict"));
  await vi.waitFor(() => expect(app.element.querySelector("textarea")!.disabled).toBe(false));
  expect(app.element.querySelector("textarea")!.value).toBe("Moje oprava");
  expect(app.element.querySelector<HTMLButtonElement>("[data-review-verify]")!.disabled).toBe(true);
});
it("keeps note drafts across sections, blocks navigation and refuses to close until explicitly discarded", async () => {
  const { app, Event, snapshot } = await fixture();
  await app.openAt(snapshot.entry.uuid, "document", "row1");
  const note = app.element.querySelector<HTMLTextAreaElement>("[data-review-context] textarea")!;
  note.value = "Need to check this meaning."; note.dispatchEvent(new Event("input"));
  await app.close(); expect(app.element.isConnected).toBe(true);
  await expect(app.openAt(snapshot.entry.uuid, "page2", "row2")).rejects.toThrow("UnsavedNavigation");
  (app.element.querySelectorAll("nav button")[1] as HTMLButtonElement).click();
  await vi.waitFor(() => expect(app.element.querySelector("textarea")!.value).toBe("Další"));
  await app.close(); expect(app.element.isConnected).toBe(true);
  app.element.querySelector<HTMLButtonElement>("[data-review-discard]")!.click();
  await app.close(); expect(app.element.isConnected).toBe(false);
});
it("scopes shortcuts to the selected row, saves before verifying and never toggles an existing verification off", async () => {
  const { app, Event, save } = await fixture();
  const input = app.element.querySelector("textarea")!;
  input.dispatchEvent(new Event("focusin", { bubbles: true }));
  input.value = "Nový překlad"; input.dispatchEvent(new Event("input"));
  const key = (value: string) => { const event = new Event("keydown", { bubbles: true, cancelable: true }); Object.assign(event, { key: value, ctrlKey: true }); app.element.querySelector("textarea")!.dispatchEvent(event); };
  key("Enter"); expect(save).not.toHaveBeenCalled();
  key("s"); await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(app.element.querySelector("textarea")!.disabled).toBe(false));
  key("Enter"); await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(app.element.querySelector("textarea")!.disabled).toBe(false));
  key("Enter"); expect(save).toHaveBeenCalledTimes(2);
});
