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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

it("opens the working file from MCP but refuses to interrupt unsaved text or a running save", async () => {
  const { app, Event, save } = await fixture();
  const input = app.element.querySelector('textarea')!; input.value = 'Rozepsaná oprava'; input.dispatchEvent(new Event('input'));
  await expect(app.openProject()).rejects.toThrow('Review.UnsavedNavigation');
  expect(app.element.querySelector('textarea')!.value).toBe('Rozepsaná oprava');
  let finish!: () => void;
  save.mockImplementationOnce(async view => { await new Promise<void>(resolve => { finish = resolve; }); return view; });
  app.element.querySelector<HTMLButtonElement>('[data-review-save]')!.click();
  await expect(app.openProject()).rejects.toThrow('Review.Working');
  finish(); await vi.waitFor(() => expect(app.element.querySelector('textarea')!.disabled).toBe(false));
  await app.openProject(); expect(app.element.textContent).toContain('Review.ProjectNotice');
});

function addLargeSection(snapshot: ReviewSnapshot): void {
  // More than four production-size pages: filtering must inspect hidden rows.
  for (let i = 0; i < 220; i++) snapshot.rows.push({ ...snapshot.rows[0]!, id: `large-${i}`, source: [`Passage ${i}`], translation: [`Pasáž ${i}`] });
}

it("bounds large sections to fifty rows and retains drafts when paging away and back", async () => {
  const { app, Event, snapshot } = await fixture(); addLargeSection(snapshot);
  await app.render(true);
  expect(app.element.querySelectorAll('[data-review-row]')).toHaveLength(50);
  const input = app.element.querySelector('textarea')!; input.value = 'Rozepsáno mimo stránku'; input.dispatchEvent(new Event('input'));
  app.element.querySelector<HTMLButtonElement>('[data-review-next-page]')!.click();
  expect(app.element.querySelectorAll('[data-review-row]')).toHaveLength(50);
  expect(app.element.querySelector('[data-review-row="large-49"]')).toBeTruthy();
  expect(app.element.querySelector('textarea')!.value).not.toBe('Rozepsáno mimo stránku');
  app.element.querySelector<HTMLButtonElement>('[data-review-previous-page]')!.click();
  expect(app.element.querySelectorAll('[data-review-row]')).toHaveLength(50);
  expect(app.element.querySelector('textarea')!.value).toBe('Rozepsáno mimo stránku');
});

it("searches hidden pages after the debounce and retains a draft when clearing the filter", async () => {
  const { app, Event, snapshot } = await fixture(); addLargeSection(snapshot);
  await app.render(true);
  const input = app.element.querySelector('textarea')!; input.value = 'Rozepsáno mimo stránku'; input.dispatchEvent(new Event('input'));
  const search = app.element.querySelector<HTMLInputElement>('input[type=search]')!;
  // Exercise the real debounce callback without wall-clock polling under CI load.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  search.value = 'Pasáž 218'; search.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(149);
  expect(app.element.querySelectorAll('[data-review-row]')).toHaveLength(50);
  // A newer query cancels the earlier deadline and gets its own full debounce.
  search.value = 'Pasáž 219'; search.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(149);
  expect(app.element.querySelectorAll('[data-review-row]')).toHaveLength(50);
  vi.advanceTimersByTime(1);
  expect(app.element.querySelectorAll('[data-review-row]')).toHaveLength(1);
  expect(app.element.querySelector('[data-review-row="large-219"]')).toBeTruthy();
  expect(app.element.querySelector('textarea')!.value).toBe('Pasáž 219');
  search.value = ''; search.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  expect(app.element.querySelectorAll('[data-review-row]')).toHaveLength(50);
  expect(app.element.querySelector('textarea')!.value).toBe('Rozepsáno mimo stránku');
});

it("opens an off-page bookmark directly on its bounded page", async () => {
  const { app, snapshot } = await fixture(); addLargeSection(snapshot);
  await app.openAt(snapshot.entry.uuid, 'document', 'large-219');
  expect(app.element.querySelector('[data-review-row="large-219"]')).toBeTruthy();
  expect(app.element.querySelectorAll('[data-review-row]').length).toBeLessThanOrEqual(50);
  expect(app.element.querySelector('[data-review-row="row1"]')).toBeNull();
});

it("keeps tabs and closing available while history is waiting for a compendium index", async () => {
  const { app } = await fixture(); const service = await import("../src/review/service");
  let complete!: (value: any) => void;
  vi.spyOn(service, "reviewHistory").mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const tab = (key: string) => [...app.element.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(button => button.textContent?.endsWith(key))!;
  tab("History").click();
  await vi.waitFor(() => expect(app.element.textContent).toContain("ExportHistory"));
  expect(tab("Documents").disabled).toBe(false);
  tab("Documents").click(); await vi.waitFor(() => expect(app.element.querySelector("textarea")).toBeTruthy());
  complete([]); await Promise.resolve(); expect(app.element.querySelector("textarea")).toBeTruthy();
  await app.close(); expect(app.element.isConnected).toBe(false);
});

it("edits existing embed prose beside readonly originals in one disclosure without moving or exposing commands", async () => {
  const { app, Event, snapshot, save, storage } = await fixture();
  const row = snapshot.rows[0]!;
  row.source = ['@Embed[Actor.a inline readaloud="English words" caption="English caption" label="English name"]{English brace}'];
  row.translation = ['@Embed[Actor.a inline readaloud="Česká slova" caption="Český titulek" label="Český název"]{Český popisek}'];
  await app.render(true);
  const rendered = app.element.querySelector('[data-review-row="row1"]')!;
  expect(rendered.querySelectorAll('details.ft-review__references')).toHaveLength(1);
  expect(rendered.querySelectorAll('[data-reference-option]')).toHaveLength(6);
  const source = rendered.querySelector<HTMLTextAreaElement>('[data-reference-option="readaloud"][data-reference-side="source"]')!;
  const target = rendered.querySelector<HTMLTextAreaElement>('[data-reference-option="readaloud"][data-reference-side="target"]')!;
  expect(source.readOnly).toBe(true); expect(source.value).toBe("English words");
  target.value = '<img src=x onerror=alert(1)> Nový český text.'; target.dispatchEvent(new Event("input"));
  expect(rendered.querySelector('img')).toBeNull();
  expect([...storage.values()].join(" ")).toContain('"key":"readaloud"');
  target.value = "Nový český text."; target.dispatchEvent(new Event("input"));
  rendered.querySelector<HTMLButtonElement>('[data-review-save]')!.click();
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  const action = save.mock.calls.at(-1)![2];
  expect(action.type).toBe("save");
  if (action.type === "save") expect(action.parts[0]).toContain('readaloud="Nový český text."');
  expect(row.source[0]).toContain('readaloud="English words"');
});
it("matches reordered embed originals by canonical immutable targets, not marker order", async () => {
  const { app, snapshot } = await fixture(); const row = snapshot.rows[0]!;
  row.source = ['@Embed[Actor.a readaloud="Original A"] @Embed[Actor.b readaloud="Original B"]'];
  row.translation = ['@Embed[Compendium.world.actors.Actor.copyB readaloud="Překlad B"] @Embed[Compendium.world.actors.Actor.copyA readaloud="Překlad A"]'];
  snapshot.reverse.set('Compendium.world.actors.Actor.copyA', 'Actor.a'); snapshot.reverse.set('Compendium.world.actors.Actor.copyB', 'Actor.b');
  await app.render(true);
  const entries = app.element.querySelector('[data-review-row="row1"]')!.querySelectorAll('.ft-review__reference-entry');
  expect(entries[0]!.querySelector<HTMLTextAreaElement>('[data-reference-side="source"]')!.value).toBe('Original B');
  expect(entries[1]!.querySelector<HTMLTextAreaElement>('[data-reference-side="source"]')!.value).toBe('Original A');
  row.source = ['@Embed[Actor.a readaloud="Original A"] @Embed[Actor.a readaloud="Another A"]'];
  row.translation = ['@Embed[Actor.a readaloud="Překlad A"] @Embed[Actor.a readaloud="Další A"]'];
  await app.render(true);
  expect(app.element.querySelector('[data-review-row="row1"]')!.querySelectorAll('[data-reference-side="source"]')).toHaveLength(0);
  expect(app.element.textContent).toContain('SourceReferenceUnmatched');
});
