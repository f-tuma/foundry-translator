import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addShowTranslationHeaderButton, addJournalTranslationHeaderButton, addJournalTranslationHeaderControl } from "../src/translation/journal-header-control";

const sourceUuid = "JournalEntry.source";
const copyUuid = "Compendium.world.foundry-translate-translations.JournalEntry.copy";
const flag = () => ({ schemaVersion: 1, sourceUuid, sourceHash: "hash", providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-10-05T00:00:00.000Z", translatedTextPages: 1, skippedTextPages: 0 });
let docs: Map<string, any>, source: any, copy: any, app: any, header: HTMLElement, index: Map<string, any>, warn: ReturnType<typeof vi.fn>;
function readable(uuid: string, documentName: string, extras: Record<string, any> = {}) {
  return { uuid, id: uuid.split(".").at(-1), documentName, name: uuid, toObject: () => ({}), testUserPermission: vi.fn(() => true), ...extras };
}
beforeEach(() => {
  const { document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  header = document.createElement("header"); const controls = document.createElement("button"); header.append(controls); document.body.append(header);
  source = readable(sourceUuid, "JournalEntry", { sheet: { render: vi.fn() } });
  copy = readable(copyUuid, "JournalEntry", { sheet: { render: vi.fn() }, flags: { "foundry-translate": { translation: flag() } } });
  docs = new Map([[sourceUuid, source], [copyUuid, copy]]);
  for (const root of [source, copy]) {
    const page = readable(`${root.uuid}.JournalEntryPage.chapter`, "JournalEntryPage", { parent: root }); docs.set(page.uuid, page);
  }
  index = new Map([["copy", { _id: "copy", flags: copy.flags }]]);
  vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => docs.get(uuid) ?? null));
  vi.stubGlobal("game", { user: { id: "player", isGM: false }, journal: { contents: [source] }, settings: { get: vi.fn((_m, key) => key === "targetLanguage" ? "cs" : undefined) }, i18n: { localize: (key: string) => key }, packs: new Map([["world.foundry-translate-translations", { getIndex: vi.fn(async () => index), getDocument: vi.fn(async (id: string) => id === "copy" ? copy : null) }]]) });
  warn = vi.fn(); vi.stubGlobal("ui", { notifications: { warn } });
  app = { entry: source, pageId: "chapter", close: vi.fn(async () => {}), window: { header, controls } };
});
afterEach(() => vi.unstubAllGlobals());

describe("Player journal read toggle", () => {
  it("opens the existing permitted translation at the same page without exposing write actions", async () => {
    await addShowTranslationHeaderButton(app); await addShowTranslationHeaderButton(app);
    const controls: any[] = []; addJournalTranslationHeaderControl(app, controls); addJournalTranslationHeaderButton(app);
    expect(controls).toEqual([]); expect(header.querySelector(".ft-journal-translate-header")).toBeNull();
    expect(header.querySelectorAll(".ft-journal-read-toggle")).toHaveLength(1);
    header.querySelector<HTMLButtonElement>(".ft-journal-show-translation")!.click();
    await vi.waitFor(() => expect(copy.sheet.render).toHaveBeenCalledOnce());
    expect(copy.sheet.render).toHaveBeenCalledWith({ force: true, pageId: "chapter" });
    expect(app.close).toHaveBeenCalledOnce();
    expect((game.settings.get as any).mock.calls.every((args: string[]) => args[1] === "targetLanguage")).toBe(true);
  });
  it("offers a permission-checked return to original for a translated compendium entry", async () => {
    app.entry = copy; await addShowTranslationHeaderButton(app);
    header.querySelector<HTMLButtonElement>(".ft-journal-show-original")!.click();
    await vi.waitFor(() => expect(source.sheet.render).toHaveBeenCalledWith({ force: true, pageId: "chapter" }));
    expect(app.close).toHaveBeenCalledOnce();
  });
  it.each([sourceUuid, copyUuid, sourceUuid + ".JournalEntryPage.chapter", copyUuid + ".JournalEntryPage.chapter"])("hides the toggle when %s is not readable", async uuid => {
    docs.get(uuid).testUserPermission.mockReturnValue(false); await addShowTranslationHeaderButton(app);
    expect(header.querySelector(".ft-journal-read-toggle")).toBeNull();
  });
  it("rechecks permissions on click and keeps the source window open after revocation", async () => {
    await addShowTranslationHeaderButton(app); copy.testUserPermission.mockReturnValue(false);
    header.querySelector<HTMLButtonElement>(".ft-journal-read-toggle")!.click();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce()); expect(copy.sheet.render).not.toHaveBeenCalled(); expect(app.close).not.toHaveBeenCalled();
  });
  it("checks both pages again when the displayed page changes", async () => {
    await addShowTranslationHeaderButton(app); app.pageId = "hidden";
    header.querySelector<HTMLButtonElement>(".ft-journal-read-toggle")!.click();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce()); expect(copy.sheet.render).not.toHaveBeenCalled();
  });
  it("hides ambiguous copies and missing exact child pages rather than guessing", async () => {
    index.set("duplicate", { _id: "duplicate", flags: copy.flags }); await addShowTranslationHeaderButton(app);
    expect(header.querySelector(".ft-journal-read-toggle")).toBeNull();
    index.delete("duplicate"); docs.delete(copyUuid + ".JournalEntryPage.chapter"); await addShowTranslationHeaderButton(app);
    expect(header.querySelector(".ft-journal-read-toggle")).toBeNull();
  });
  it("does not render if access changes during an awaited page lookup", async () => {
    await addShowTranslationHeaderButton(app);
    (fromUuid as any).mockImplementation(async (uuid: string) => { if (uuid === copyUuid + ".JournalEntryPage.chapter") source.testUserPermission.mockReturnValue(false); return docs.get(uuid) ?? null; });
    header.querySelector<HTMLButtonElement>(".ft-journal-read-toggle")!.click();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce()); expect(copy.sheet.render).not.toHaveBeenCalled();
  });
  it("does not render if translation provenance changes during an awaited page lookup", async () => {
    await addShowTranslationHeaderButton(app);
    (fromUuid as any).mockImplementation(async (uuid: string) => {
      if (uuid === copyUuid + ".JournalEntryPage.chapter") copy.flags["foundry-translate"].translation.sourceUuid = "JournalEntry.other";
      return docs.get(uuid) ?? null;
    });
    header.querySelector<HTMLButtonElement>(".ft-journal-read-toggle")!.click();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(copy.sheet.render).not.toHaveBeenCalled(); expect(app.close).not.toHaveBeenCalled();
  });
  it("fails closed for uncheckable permission and a page bound to another parent", async () => {
    const page = docs.get(copyUuid + ".JournalEntryPage.chapter");
    delete page.testUserPermission; await addShowTranslationHeaderButton(app);
    expect(header.querySelector(".ft-journal-read-toggle")).toBeNull();
    page.testUserPermission = vi.fn(() => true); page.parent = source; await addShowTranslationHeaderButton(app);
    expect(header.querySelector(".ft-journal-read-toggle")).toBeNull();
  });
  it("opens only the root when the journal has no selected page", async () => {
    delete app.pageId; await addShowTranslationHeaderButton(app);
    header.querySelector<HTMLButtonElement>(".ft-journal-read-toggle")!.click();
    await vi.waitFor(() => expect(copy.sheet.render).toHaveBeenCalledWith({ force: true }));
  });
  it("cannot reuse a button after the logged in account changes", async () => {
    await addShowTranslationHeaderButton(app); (game as any).user = { id: "other", isGM: false };
    header.querySelector<HTMLButtonElement>(".ft-journal-read-toggle")!.click();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce()); expect(copy.sheet.render).not.toHaveBeenCalled();
  });
});
