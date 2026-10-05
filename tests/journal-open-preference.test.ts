import { afterEach, describe, expect, it, vi } from "vitest";

async function fixture() {
  vi.resetModules();
  const sourceUuid = "JournalEntry.guide", copyUuid = "Compendium.world.foundry-translate-translations.JournalEntry.copy";
  const flag = { schemaVersion: 1, sourceUuid, sourceHash: "hash", providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs",
    translatedAt: "2026-10-05T00:00:00.000Z", translatedTextPages: 1, skippedTextPages: 0, partial: false };
  const native = vi.fn(async function(this: any, ..._args: unknown[]) { return this; });
  class Sheet { constructor(public entry: any) {} render(...args: unknown[]): any { return native.apply(this, args); } }
  const user = { id: "player", isGM: false };
  const source: any = { uuid: sourceUuid, documentName: "JournalEntry", flags: {}, testUserPermission: vi.fn(() => true) };
  const copy: any = { uuid: copyUuid, documentName: "JournalEntry", flags: { "foundry-translate": { translation: flag } }, testUserPermission: vi.fn(() => true) };
  source.sheet = new Sheet(source); copy.sheet = new Sheet(copy);
  const docs = new Map<string, any>([[source.uuid, source], [copy.uuid, copy]]);
  for (const root of [source, copy]) docs.set(`${root.uuid}.JournalEntryPage.chapter`, { uuid: `${root.uuid}.JournalEntryPage.chapter`, documentName: "JournalEntryPage", id: "chapter", parent: root, testUserPermission: vi.fn(() => true) });
  const index = new Map([["copy", { _id: "copy", flags: copy.flags }]]);
  let enabled = true, language = "cs";
  const pack = { getIndex: vi.fn(async () => index), getDocument: vi.fn(async (id: string) => id === "copy" ? copy : null) };
  vi.stubGlobal("foundry", { applications: { sheets: { journal: { JournalEntrySheet: Sheet } } } });
  vi.stubGlobal("game", { user, settings: { get: vi.fn((_id, key) => key === "autoOpenTranslations" ? enabled : key === "targetLanguage" ? language : undefined) }, packs: new Map([["world.foundry-translate-translations", pack]]) });
  const lookup = vi.fn(async (uuid: string) => docs.get(uuid) ?? null); vi.stubGlobal("fromUuid", lookup);
  const api = await import("../src/translation/journal-open-preference"); api.registerJournalOpenPreference();
  return { ...api, source, copy, flag, docs, index, native, lookup, pack, Sheet, user, off: () => { enabled = false; }, otherLanguage: () => { language = "en"; } };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("native journal open preference", () => {
  it("opens an exact permitted copy from a native directory render and returns its V2 render promise", async () => {
    const f = await fixture();
    const rendered = await f.source.sheet.render(true);
    expect(rendered).toBe(f.copy.sheet);
    expect(f.native).toHaveBeenCalledOnce(); expect(f.native.mock.instances[0]).toBe(f.copy.sheet);
    expect(f.native).toHaveBeenCalledWith({ force: true });
  });
  it("preserves native map-note page/mode and page-link anchors with both render signatures", async () => {
    const f = await fixture();
    await f.source.sheet.render(true, { pageId: "chapter", mode: 1 });
    expect(f.native).toHaveBeenLastCalledWith({ pageId: "chapter", mode: 1, force: true });
    await f.source.sheet.render({ force: true, pageId: "chapter", anchor: "a-heading", mode: 2 });
    expect(f.native).toHaveBeenLastCalledWith({ force: true, pageId: "chapter", anchor: "a-heading", mode: 2 });
    expect(f.native.mock.instances.every(sheet => sheet === f.copy.sheet)).toBe(true);
  });
  it("is idempotently installed, deduplicates simultaneous exact opens, and never patches global UUID resolution", async () => {
    const f = await fixture(), render = f.Sheet.prototype.render, lookup = fromUuid;
    f.registerJournalOpenPreference(); expect(f.Sheet.prototype.render).toBe(render);
    const first = f.source.sheet.render(true), second = f.source.sheet.render(true);
    expect(second).toBe(first); await Promise.all([first, second]);
    expect(f.native).toHaveBeenCalledOnce(); expect(f.pack.getIndex).toHaveBeenCalledOnce(); expect(fromUuid).toBe(lookup);
  });
  it("allows Show original once while ON without leaking the private marker to Foundry or blocking future translated opens", async () => {
    const f = await fixture();
    await f.renderOriginalJournal(f.source.sheet, { force: true, pageId: "chapter" });
    expect(f.native.mock.instances[0]).toBe(f.source.sheet);
    expect(f.native).toHaveBeenCalledWith({ force: true, pageId: "chapter" }); expect(f.lookup).not.toHaveBeenCalled();
    await f.source.sheet.render(true); expect(f.native.mock.instances[1]).toBe(f.copy.sheet);
  });
  it("keeps the original bypass through an asynchronous subclass renderer", async () => {
    const f = await fixture(), adapted = f.Sheet.prototype.render;
    f.source.sheet.render = async (...args: unknown[]) => {
      await Promise.resolve();
      return adapted.apply(f.source.sheet, args);
    };
    await f.renderOriginalJournal(f.source.sheet, { force: true, pageId: "chapter" });
    expect(f.native.mock.instances[0]).toBe(f.source.sheet); expect(f.lookup).not.toHaveBeenCalled();
    await f.source.sheet.render(true); expect(f.native.mock.instances[1]).toBe(f.copy.sheet);
  });
  it("clears the source bypass after a failed native render", async () => {
    const f = await fixture(); f.native.mockRejectedValueOnce(new Error("Closed while rendering"));
    await expect(f.renderOriginalJournal(f.source.sheet, { force: true })).rejects.toThrow("Closed while rendering");
    await f.source.sheet.render(true); expect(f.native.mock.instances[1]).toBe(f.copy.sheet);
  });
  it("preserves OFF and explicit copy renders, and leaves background source refreshes native", async () => {
    const f = await fixture(); f.off();
    await f.source.sheet.render(true); expect(f.native.mock.instances[0]).toBe(f.source.sheet); expect(f.lookup).not.toHaveBeenCalled();
    await f.copy.sheet.render({ force: true, pageId: "chapter" }); expect(f.native.mock.instances[1]).toBe(f.copy.sheet);
    await f.source.sheet.render(false); expect(f.native.mock.instances[2]).toBe(f.source.sheet);
  });
  it.each(["source", "copy", "sourcePage", "copyPage"])("falls back to the native original when %s is unreadable", async name => {
    const f = await fixture();
    const doc = name === "source" ? f.source : name === "copy" ? f.copy : f.docs.get(`${name === "sourcePage" ? f.source.uuid : f.copy.uuid}.JournalEntryPage.chapter`);
    doc.testUserPermission.mockReturnValue(false);
    await f.source.sheet.render({ force: true, pageId: "chapter" }); expect(f.native).toHaveBeenCalledOnce(); expect(f.native.mock.instances[0]).toBe(f.source.sheet);
  });
  it.each(["copyPageMissing", "wrongParent", "partial", "duplicate", "missingCopy", "uncheckable"])("fails closed for %s rather than guessing a page/copy", async state => {
    const f = await fixture();
    if (state === "copyPageMissing") f.docs.delete(f.copy.uuid + ".JournalEntryPage.chapter");
    if (state === "wrongParent") f.docs.get(f.copy.uuid + ".JournalEntryPage.chapter").parent = f.source;
    if (state === "partial") Object.assign(f.flag, { partial: true, processedPageIds: ["chapter"] });
    if (state === "duplicate") f.index.set("other", { _id: "other", flags: f.copy.flags });
    if (state === "missingCopy") f.pack.getDocument.mockResolvedValue(null);
    if (state === "uncheckable") delete f.copy.testUserPermission;
    await f.source.sheet.render(true, { pageId: "chapter" }); expect(f.native.mock.instances[0]).toBe(f.source.sheet);
  });
  it.each(["permission", "provenance", "parent", "user", "preference", "language", "sheetIdentity"])("rechecks %s after all awaited lookups", async state => {
    const f = await fixture();
    f.lookup.mockImplementation(async uuid => {
      if (uuid === f.copy.uuid + ".JournalEntryPage.chapter") {
        if (state === "permission") f.source.testUserPermission.mockReturnValue(false);
        if (state === "provenance") f.flag.sourceUuid = "JournalEntry.other";
        if (state === "parent") f.docs.get(f.source.uuid + ".JournalEntryPage.chapter").parent = f.copy;
        if (state === "user") (game as any).user = { id: "someoneElse" };
        if (state === "preference") f.off();
        if (state === "language") f.otherLanguage();
        if (state === "sheetIdentity") f.copy.sheet.entry = f.source;
      }
      return f.docs.get(uuid) ?? null;
    });
    await f.source.sheet.render({ force: true, pageId: "chapter" });
    expect(f.native).toHaveBeenCalledOnce(); expect(f.native.mock.instances[0]).toBe(f.source.sheet);
  });
  it.each([[true, { tempOwnership: true, pageId: "chapter" }], [true, { pageIndex: 0 }], [{ force: true, editable: true }], [true, "unsupported"], [true, { pageId: 4 }], [{ force: true, mode: 9 }]])("preserves unknown/temporary native render intent %j", async (...args) => {
    const f = await fixture(); await f.source.sheet.render(...args);
    expect(f.native.mock.instances[0]).toBe(f.source.sheet); expect(f.native).toHaveBeenCalledWith(...args); expect(f.lookup).not.toHaveBeenCalled();
  });
  it("never redirects Actor, Item, or page edit sheets", async () => {
    const f = await fixture();
    for (const documentName of ["Actor", "Item", "JournalEntryPage"]) {
      const doc = { ...f.source, documentName, uuid: `${documentName}.native` }, sheet = new f.Sheet(doc);
      await sheet.render({ force: true }); expect(f.native.mock.instances.at(-1)).toBe(sheet);
    }
    expect(f.lookup).not.toHaveBeenCalled();
  });
  it("supports source bypass through the public openReference API with the same page and anchor", async () => {
    const f = await fixture();
    const { openTranslationReference } = await import("../src/translation/translated-link-navigation");
    expect(await openTranslationReference(f.copy.uuid + ".JournalEntryPage.chapter#anchor", { view: "source" })).toBe(true);
    expect(f.native).toHaveBeenCalledWith({ force: true, pageId: "chapter", anchor: "anchor" });
    expect(f.native.mock.instances[0]).toBe(f.source.sheet); expect(f.pack.getIndex).not.toHaveBeenCalled();
  });
});
