import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import type { ReaderChapter, ReaderContent } from "../src/reader/content";
import { buildLightLibrary } from "../src/reader/light-library";

const book = "JournalEntry.book";
const first = `${book}.JournalEntryPage.first`;
const second = `${book}.JournalEntryPage.second`;
const otherBook = "JournalEntry.other";
const linkedPage = `${otherBook}.JournalEntryPage.linked`;
const unrequestedChapter = `${otherBook}.JournalEntryPage.unrequested`;

const request = (roots: string[] = [book]) => ({
  id: "tablet-library", worldId: "ember", worldName: "Ember",
  userId: "reader", userName: "Čtenář", language: "cs", roots,
});
const chapter = (uuid: string, name = uuid): ReaderChapter => ({ uuid, name, category: "Příručka", level: 1 });
const content = (uuid: string, html: string, chapters: ReaderChapter[] = []): ReaderContent => ({
  uuid, title: uuid, book: "Příručka Vypravěče", html, chapters,
  kind: "JournalEntryPage", native: { uuid } as ReaderContent["native"],
});

// The real loader decides access and renders Foundry prose. These tests exercise
// only the offline graph builder with explicit, deterministic dependencies.
function loader(entries: Record<string, ReaderContent | Error>) {
  return vi.fn(async (uuid: string): Promise<ReaderContent> => {
    const entry = entries[uuid];
    if (entry instanceof Error) throw entry;
    if (!entry) throw new Error("Reader.Unavailable");
    return entry;
  });
}

function sanitize(html: string): string {
  const prose = document.createElement("div");
  prose.innerHTML = html;
  for (const node of prose.querySelectorAll("script, button, input, form")) node.remove();
  for (const node of prose.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      if (/^on/u.test(attribute.name) || attribute.name === "data-action") node.removeAttribute(attribute.name);
    }
  }
  return prose.innerHTML;
}

beforeEach(() => {
  const { document, HTMLElement, Element } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", HTMLElement);
  vi.stubGlobal("Element", Element);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("light Reader library", () => {
  it("starts at the root journal's first page and includes every explicit root chapter", async () => {
    const chapters = [chapter(first, "Úvod"), chapter(second, "Další Kapitola")];
    const load = loader({
      [book]: content(first, "<p>Úvod.</p>", chapters),
      [first]: content(first, "<p>Úvod.</p>", chapters),
      [second]: content(second, "<p>Další kapitola.</p>", chapters),
    });
    const library = await buildLightLibrary(request(), { load, sanitize });

    expect(library.version).toBe(1);
    expect(library).toMatchObject(request());
    expect(library.startUuid).toBe(first);
    expect(Object.values(library.documents).map(doc => doc.uuid).sort()).toEqual([first, second].sort());
    expect(library.documents.find(doc => doc.uuid === first)?.aliases).toEqual(expect.arrayContaining([book, first]));
    expect(library.warnings).toEqual([]);
    expect(load).toHaveBeenCalledWith(second);
    expect(Number.isNaN(Date.parse(library.createdAt))).toBe(false);
  });

  it("follows linked documents once through cycles without pulling unrelated chapters of linked books", async () => {
    const load = loader({
      [first]: content(first, `<p><a data-uuid="${linkedPage}">Dál</a><a data-uuid="${linkedPage}" data-hash="notes">Poznámky</a></p>`),
      [linkedPage]: content(linkedPage, `<a data-uuid="${first}">Zpět</a><a data-uuid="Actor.guard">Strážce</a>`, [chapter(linkedPage), chapter(unrequestedChapter)]),
      "Actor.guard": { ...content("Actor.guard", `<a data-uuid="${linkedPage}">Kapitola</a>`), kind: "Actor" },
      [unrequestedChapter]: content(unrequestedChapter, "NOT REQUESTED"),
    });
    const library = await buildLightLibrary(request([first]), { load, sanitize });

    expect(Object.values(library.documents).map(doc => doc.uuid).sort()).toEqual([first, linkedPage, "Actor.guard"].sort());
    const loaded = load.mock.calls.map(([uuid]) => uuid);
    expect(loaded.filter(uuid => uuid === linkedPage)).toHaveLength(1);
    expect(loaded.filter(uuid => uuid === first)).toHaveLength(1);
    expect(loaded).not.toContain(unrequestedChapter);
  });

  it("rewrites rendered internal links while retaining fragments and external URLs", async () => {
    const external = "https://example.org/guide?lang=cs#intro";
    const load = loader({
      [first]: content(first, `<p><a class="content-link" data-uuid="Actor.guard" data-hash="biography" href="#">Strážce</a><a href="${external}" target="_blank" rel="noopener noreferrer">Web</a></p>`),
      "Actor.guard": { ...content("Actor.guard", "<p>Strážce.</p>"), kind: "Actor" },
    });
    const library = await buildLightLibrary(request([first]), { load, sanitize });
    const page = Object.values(library.documents).find(doc => doc.uuid === first)!;
    const dom = document.createElement("div"); dom.innerHTML = page.html;
    const internal = dom.querySelector(".content-link")!;

    expect(internal.getAttribute("data-uuid")).toBeNull();
    expect(internal.getAttribute("data-reader-uuid")).toBe("Actor.guard#biography");
    expect(internal.getAttribute("data-hash")).toBeNull();
    expect(internal.textContent).toBe("Strážce");
    expect(dom.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe(external);
    expect(load.mock.calls.map(([uuid]) => uuid)).not.toContain(external);
  });

  it("deduplicates source/translation aliases and rewrites both links to one canonical document", async () => {
    const translated = { ...content("Actor.translated", "<p>Přeložený strážce.</p>"), kind: "Actor" };
    const load = loader({
      [first]: content(first, '<a data-uuid="Actor.original" data-hash="notes">Originál</a><a data-uuid="Actor.translated#portrait">Překlad</a>'),
      "Actor.original": translated,
      "Actor.translated": translated,
    });
    const library = await buildLightLibrary(request([first]), { load, sanitize });
    const exported = library.documents.find(doc => doc.uuid === translated.uuid)!;
    const page = library.documents.find(doc => doc.uuid === first)!;
    const dom = document.createElement("div"); dom.innerHTML = page.html;

    expect(library.documents).toHaveLength(2);
    expect(exported.aliases.sort()).toEqual(["Actor.original", "Actor.translated"].sort());
    expect([...dom.querySelectorAll("a")].map(link => link.getAttribute("data-reader-uuid"))).toEqual([
      "Actor.translated#notes", "Actor.translated#portrait",
    ]);
    expect(load.mock.calls.map(([uuid]) => uuid)).not.toContain("Actor.translated#portrait");
  });

  it("never serializes native documents, circular references, private state or live controls", async () => {
    const native = {
      uuid: first, id: "first", system: { privateBiography: "NATIVE_PRIVATE_SENTINEL", eventState: "ACTIVE_WORLD_STATE" },
      sheet: { render: vi.fn() }, update: vi.fn(), parent: null as unknown,
    };
    native.parent = native;
    const page = { ...content(first, '<p>Veřejný text.</p><script>LIVE_SCRIPT</script><button data-action="roll">LIVE_ROLL</button><a href="https://example.org" onclick="LIVE_HANDLER">Web</a>'), native } as ReaderContent;
    const safe = vi.fn(sanitize);
    const library = await buildLightLibrary(request([first]), { load: loader({ [first]: page }), sanitize: safe });
    const serialized = JSON.stringify(library);

    expect(serialized).toContain("Veřejný text.");
    expect(serialized).not.toMatch(/NATIVE_PRIVATE_SENTINEL|ACTIVE_WORLD_STATE|LIVE_SCRIPT|LIVE_ROLL|LIVE_HANDLER/u);
    for (const exported of Object.values(library.documents)) {
      expect(exported).not.toHaveProperty("native");
      expect(exported).not.toHaveProperty("system");
      expect(exported).not.toHaveProperty("sheet");
    }
    expect(safe).toHaveBeenCalledWith(page.html);
    expect(native.sheet.render).not.toHaveBeenCalled();
    expect(native.update).not.toHaveBeenCalled();
    expect(page.html).toContain("LIVE_SCRIPT");
    expect(native.parent).toBe(native);
  });

  it("records inaccessible linked targets without inventing their document or leaking their prose", async () => {
    const load = loader({
      [first]: content(first, '<p>Čitelný text <a data-uuid="Actor.denied">Neznámá Postava</a> a <a data-uuid="Item.missing">Předmět</a>.</p>'),
      "Actor.denied": new Error("Reader.Unavailable"),
      "Item.missing": new Error("Reader.Unavailable"),
    });
    const library = await buildLightLibrary(request([first]), { load, sanitize });

    expect(Object.values(library.documents).map(doc => doc.uuid)).toEqual([first]);
    expect(library.warnings).toHaveLength(2);
    expect(JSON.stringify(library)).toContain("Čitelný text");
    expect(Object.values(library.documents).some(doc => doc.uuid === "Actor.denied" || doc.uuid === "Item.missing")).toBe(false);
  });

  it("fails the whole build when any explicitly requested root cannot be read", async () => {
    const load = loader({ [first]: content(first, "<p>První.</p>"), "JournalEntry.denied": new Error("Reader.Unavailable") });
    await expect(buildLightLibrary(request([first, "JournalEntry.denied"]), { load, sanitize })).rejects.toThrow();
  });

  it("rechecks an old library's root permissions without returning or mutating its cached prose", async () => {
    const scope = request([first]);
    const previous = await buildLightLibrary(scope, { load: loader({ [first]: content(first, "PREVIOUSLY_AUTHORIZED_PROSE") }), sanitize });
    const before = JSON.stringify(previous);
    const denied = loader({ [first]: new Error("Reader.Unavailable") });

    await expect(buildLightLibrary(scope, { load: denied, sanitize })).rejects.toThrow("Reader.Unavailable");
    expect(denied).toHaveBeenCalledWith(first);
    expect(JSON.stringify(previous)).toBe(before);
  });

  it("does not begin loading an already aborted build", async () => {
    const controller = new AbortController(); controller.abort();
    const load = loader({ [first]: content(first, "<p>Text.</p>") });

    await expect(buildLightLibrary(request([first]), { load, sanitize, signal: controller.signal })).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects a build aborted while a document is loading instead of returning a partial library", async () => {
    const controller = new AbortController();
    const load = vi.fn(async () => { controller.abort(); return content(first, "<p>Text.</p>"); });
    await expect(buildLightLibrary(request([first]), { load, sanitize, signal: controller.signal })).rejects.toThrow();
  });

  it("rejects exceeding the document cap instead of silently dropping a reachable target", async () => {
    const load = loader({
      [first]: content(first, '<a data-uuid="Actor.guard">Strážce</a>'),
      "Actor.guard": { ...content("Actor.guard", "<p>Strážce.</p>"), kind: "Actor" },
    });
    await expect(buildLightLibrary(request([first]), { load, sanitize, maxDocuments: 1 })).rejects.toThrow();
  });

  it("rejects a byte cap exceeded by UTF-8 Czech prose", async () => {
    const scope = request([first]);
    const ascii = loader({ [first]: content(first, `<p>${"z".repeat(100)}</p>`) });
    const baseline = await buildLightLibrary(scope, { load: ascii, sanitize });
    const maxBytes = new TextEncoder().encode(JSON.stringify(baseline)).length + 50;
    await expect(buildLightLibrary(scope, { load: ascii, sanitize, maxBytes })).resolves.toMatchObject({ startUuid: first });
    const czech = loader({ [first]: content(first, `<p>${"ž".repeat(100)}</p>`) });
    await expect(buildLightLibrary(scope, { load: czech, sanitize, maxBytes })).rejects.toThrow();
  });

  it("reports completed work and drains the pending queue after following links", async () => {
    const load = loader({
      [first]: content(first, '<a data-uuid="Actor.guard">Strážce</a>'),
      "Actor.guard": { ...content("Actor.guard", "<p>Strážce.</p>"), kind: "Actor" },
    });
    const progress = vi.fn();
    await buildLightLibrary(request([first]), { load, sanitize, progress });
    expect(progress.mock.calls.at(-1)).toEqual([2, 0]);
    expect(progress.mock.calls.every(([done, pending]) => Number.isInteger(done) && done > 0 && Number.isInteger(pending) && pending >= 0)).toBe(true);
  });
});
