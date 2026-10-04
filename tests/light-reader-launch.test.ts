import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { prepareLightReader, sanitizeLightHtml } from "../src/reader/light-launch";

const mocks = vi.hoisted(() => ({ load: vi.fn(), read: vi.fn(), write: vi.fn(), source: vi.fn() }));
vi.mock("../src/reader/light-storage", () => ({ readLightLibrary: mocks.read, writeLightLibrary: mocks.write }));
vi.mock("../src/reader/content", () => ({
  loadReaderContent: mocks.load,
  prepareReaderProse: (html: string) => { const node = document.createElement("div"); node.innerHTML = html; return node; },
  canReadDocument: (doc: any) => !!doc && doc.allowed === true,
}));
vi.mock("../src/translation/document-identity", () => ({ parseDocumentReference: () => true, resolveSourceReference: mocks.source }));
let user: { id: string; name: string; isGM: boolean }, original: any, copy: any;
beforeEach(() => {
  vi.clearAllMocks();
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  user = { id: "u", name: "Reader", isGM: true };
  vi.stubGlobal("game", { user, world: { id: "w", title: "World" }, i18n: { lang: "cs" }, settings: { get: () => "cs" } });
  vi.stubGlobal("foundry", { utils: { getRoute: (value: string) => `/prefix/${value}` } });
  vi.stubGlobal("window", { location: { href: "https://example.test/prefix/game" } });
  vi.stubGlobal("CONFIG", { JournalEntryPage: { documentClass: { slugifyHeading: (heading: HTMLElement) => heading.textContent?.toLowerCase().replaceAll(" ", "-") } } });
  original = { uuid: "JournalEntry.source.JournalEntryPage.p", allowed: true, isOwner: true, documentName: "JournalEntryPage" };
  copy = { ...original, uuid: "JournalEntry.copy.JournalEntryPage.p" };
  mocks.source.mockResolvedValue(original.uuid);
  vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => uuid === original.uuid ? original : uuid === copy.uuid ? copy : null));
  mocks.read.mockResolvedValue(undefined); mocks.write.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({ uuid: copy.uuid, title: "Title", book: "Book", kind: "JournalEntryPage", html: "<p>Text</p>", chapters: [], native: copy });
});
afterEach(() => vi.unstubAllGlobals());

describe("light library launch authorization", () => {
  it("commits after source/copy checks and uses the configured route prefix", async () => {
    const url = await prepareLightReader(copy.uuid);
    expect(url).toContain("https://example.test/prefix/modules/foundry-translate/reader/index.html?");
    expect(new URL(url).searchParams.get("library")).toBe("w:u:cs");
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0]![0].documents[0]).not.toHaveProperty("native");
  });
  it.each(["source", "copy"])("fails the final recheck when %s access is revoked during preparation", async which => {
    await expect(prepareLightReader(copy.uuid, () => { (which === "source" ? original : copy).allowed = false; })).rejects.toThrow("Reader.Unavailable");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not commit previously prepared private prose after GM demotion", async () => {
    await expect(prepareLightReader(copy.uuid, () => { user.isGM = false; })).rejects.toThrow("Reader.LightAccountChanged");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rejects changed ownership even if observer permission remains", async () => {
    await expect(prepareLightReader(copy.uuid, () => { original.isOwner = false; })).rejects.toThrow("Reader.LightAccountChanged");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("passes cancellation through to the atomic storage operation", async () => {
    const controller = new AbortController(); await prepareLightReader(copy.uuid, undefined, controller.signal);
    expect(mocks.write.mock.calls[0]![1]).toBe(controller.signal);
  });
});

describe("lightweight static HTML", () => {
  it("uses the native ToC's distinct targets for repeated headings", () => {
    const nativeTOC = vi.fn((root: HTMLElement) => {
      const headings = root.querySelectorAll<HTMLElement>("h2");
      return { one: { element: headings[0], slug: "bridge" }, two: { element: headings[1], slug: "bridge$1" } };
    });
    vi.stubGlobal("CONFIG", { JournalEntryPage: { documentClass: { buildTOC: nativeTOC } } });
    const html = sanitizeLightHtml('<h2>Bridge</h2><h2>Bridge</h2><h3 id="custom">Other</h3>', "https://example.test/game");
    expect(nativeTOC).toHaveBeenCalledOnce(); expect(html).toContain('id="bridge$1"'); expect(html).toContain('id="custom"');
  });
  it("materializes native heading slugs while retaining explicit IDs", () => {
    const html = sanitizeLightHtml('<h2>Old Bridge</h2><h3 id="custom">Keep</h3>', "https://example.test/prefix/game");
    expect(html).toContain('id="old-bridge"'); expect(html).toContain('id="custom"');
  });
  it("drops executable markup and off-origin images and fixes local asset paths", () => {
    const html = sanitizeLightHtml('<p onclick="evil()">Text</p><script>evil()</script><svg onload="evil()"></svg><img src="https://tracker.test/a"><img src="systems/ember/a.webp"><a href="javascript:evil()">bad</a>', "https://example.test/prefix/game");
    expect(html).not.toMatch(/evil|onclick|tracker|<script|<svg/u);
    expect(html).toContain('src="https://example.test/prefix/systems/ember/a.webp"');
    expect(html).toContain('loading="lazy"');
  });
});
