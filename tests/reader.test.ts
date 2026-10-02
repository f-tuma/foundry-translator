import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { currentPlace, navigateTab, freshReaderState, parseReaderState, closeReaderTab } from "../src/reader/state";
import { loadReaderContent, prepareReaderProse, readerPageHtml, readerChapters } from "../src/reader/content";

const identities = vi.hoisted(() => ({ source: vi.fn(), target: vi.fn(), identity: vi.fn() }));
vi.mock("../src/translation/document-identity", () => ({
  parseDocumentReference: (uuid: string) => /^(JournalEntry|Actor|Item|Compendium)\./u.test(uuid),
  resolveSourceReference: identities.source, resolveTranslationReference: identities.target,
  translationIdentity: identities.identity,
}));
const place = (uuid: string) => ({ uuid, title: uuid, scroll: 123, ratio: .3, width: 900 });
const flag = (partial = false, ids: string[] = []) => ({ "foundry-translate": { translation: {
  schemaVersion: 1, sourceUuid: "JournalEntry.source", sourceHash: "hash", providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-10-02", translatedTextPages: 1, skippedTextPages: 0, partial, processedPageIds: ids,
} } });
const permission = () => true;
const doc = <T extends Record<string, any>>(uuid: string, extras: T = {} as T) => ({ uuid, id: uuid.split(".").at(-1)!, documentName: uuid.split(".").at(-2)!, name: uuid, testUserPermission: permission, isOwner: true, ...extras });
beforeEach(() => {
  vi.stubGlobal("game", { user: { isGM: false }, settings: { get: () => true }, i18n: { localize: (s: string) => s } });
  vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { enrichHTML: async (s: string) => s } } } });
  identities.source.mockImplementation(async uuid => uuid); identities.identity.mockReturnValue(null);
  identities.target.mockResolvedValue({ status: "source-only" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("reader navigation", () => {
  it("keeps a return position, branches history and preserves independent tabs", () => {
    const state = freshReaderState(); navigateTab(state, place("JournalEntry.a"));
    navigateTab(state, place("Actor.b")); state.tabs[0]!.cursor = 0;
    expect(currentPlace(state)?.scroll).toBe(123);
    navigateTab(state, place("Item.c")); expect(state.tabs[0]!.history.map(p => p.uuid)).toEqual(["JournalEntry.a", "Item.c"]);
    navigateTab(state, place("JournalEntry.d"), true); const second = state.active;
    navigateTab(state, place("Item.c"), true); expect(state.tabs).toHaveLength(2);
    expect(currentPlace(state)?.uuid).toBe("Item.c"); closeReaderTab(state, state.active);
    expect(state.active).toBe(second); expect(currentPlace(state)?.uuid).toBe("JournalEntry.d");
  });
  it("bounds untrusted storage and never restores document prose", () => {
    expect(parseReaderState("bad")).toEqual(freshReaderState());
    const state = parseReaderState(JSON.stringify({version:1, fontSize:999, theme:"evil", tabs:[{id:"tab",cursor:999,history:[{...place("JournalEntry.a"),html:"SECRET",ratio:99}]}], bookmarks:[place("javascript:evil")]}));
    expect(state.fontSize).toBe(30); expect(state.theme).toBe("dark"); expect(currentPlace(state)?.ratio).toBe(1);
    expect(currentPlace(state)).not.toHaveProperty("html"); expect(state.bookmarks).toEqual([]);
  });
  it("limits tabs without changing the current chapter", () => {
    const state = freshReaderState(); for(let n=0;n<8;n++) navigateTab(state, place(`JournalEntry.n${n}`),true);
    expect(() => navigateTab(state, place("JournalEntry.other"), true)).toThrow("Reader.TabLimit");
    expect(currentPlace(state)?.uuid).toBe("JournalEntry.n7");
  });
});

describe("reader content and access", () => {
  it("keeps unsupported diagrams/media navigable with a native-view notice", async () => {
    expect(await readerPageHtml(doc("JournalEntry.j.JournalEntryPage.p", {type:"ember.questFlowchart"}), false)).toContain("Reader.Unsupported");
    expect(await readerPageHtml(doc("JournalEntry.j.JournalEntryPage.p", {type:"pdf"}), false)).toContain("Reader.NativeHint");
  });
  it("reads Ember's view sections without rendering or changing the live sheet", async () => {
    const original = {mode:"edit"}, render = vi.fn();
    class Sheet { options = original; render = render; constructor(public config: any = {}) {}
      async _prepareContext() { expect(this.config.mode).toBe("view"); return {}; }
      async _preparePartContext() { return {sections:[{header:"Overview",content:"<p>Story</p>"},{sectionClass:"gamemaster",content:"SECRET"},{sectionClass:"actions",content:"RUN"}]}; }
      _getSections() {}
    }
    const sheet = new Sheet(); const html = await readerPageHtml(doc("JournalEntry.j.JournalEntryPage.p",{type:"ember.lore",sheet}), false);
    expect(html).toContain("Story"); expect(html).not.toMatch(/SECRET|RUN/u); expect(sheet.options.mode).toBe("edit"); expect(render).not.toHaveBeenCalled();
  });
  it("requires access to the original even when a translated actor is public", async () => {
    const translated = doc("Actor.cs",{toObject:()=>({system:{details:{biography:{public:"SPOILER"}}}})});
    const original = doc("Actor.source", {testUserPermission:()=>false});
    identities.source.mockResolvedValue(original.uuid);
    vi.stubGlobal("fromUuid", async (id:string)=>id===translated.uuid?translated:original);
    await expect(loadReaderContent(translated.uuid)).rejects.toThrow("Reader.Unavailable");
  });
  it("shows only a portrait/name for LIMITED actors and no private biography", async () => {
    const actor = doc("Actor.hero",{testUserPermission:(_u:unknown,level:string)=>level==="LIMITED",img:"hero.png",toObject:()=>({system:{details:{biography:{public:"PUBLIC",private:"SECRET"}}}})});
    vi.stubGlobal("fromUuid", async()=>actor);
    const content = await loadReaderContent(actor.uuid); expect(content.html).toContain("hero.png"); expect(content.html).not.toMatch(/PUBLIC|SECRET/u);
  });
  it("uses a translated first page of an unfinished book and falls back for unprocessed pages", async () => {
    const source = doc("JournalEntry.source", {pages:{contents:[] as any[]}}), target = doc("JournalEntry.target", {flags:flag(true,["p"]),pages:{contents:[] as any[]}});
    const p = doc("JournalEntry.source.JournalEntryPage.p",{type:"text",text:{content:"Original"},parent:source});
    const q = doc("JournalEntry.source.JournalEntryPage.q",{type:"text",sort:1,text:{content:"Unfinished"},parent:source});
    const cp = doc("JournalEntry.target.JournalEntryPage.p",{type:"text",text:{content:"Překlad"},parent:target});
    const cq = doc("JournalEntry.target.JournalEntryPage.q",{type:"text",sort:1,text:{content:"WRONG"},parent:target});
    source.pages.contents=[p,q]; target.pages.contents=[cp,cq];
    const docs = [source,target,p,q,cp,cq]; vi.stubGlobal("fromUuid",async(id:string)=>docs.find(d=>d.uuid===id));
    identities.source.mockImplementation(async id=>id.replace("JournalEntry.target", "JournalEntry.source"));
    identities.identity.mockImplementation(root=>root===target?{}:null);
    identities.target.mockImplementation(async id=>({status:"mapped",translatedUuid:id.replace("JournalEntry.source", "JournalEntry.target")}));
    expect((await loadReaderContent(source.uuid)).html).toBe("Překlad");
    expect((await loadReaderContent(cq.uuid)).html).toBe("Unfinished");
  });
  it("filters source-restricted chapters and preserves native category order", () => {
    const pages=[doc("JournalEntry.a.JournalEntryPage.p",{category:"later",sort:0}),doc("JournalEntry.a.JournalEntryPage.q",{category:"first",sort:100}),doc("JournalEntry.a.JournalEntryPage.secret",{category:"first",sort:0})];
    const root=doc("JournalEntry.a",{pages:{contents:pages},categories:{contents:[{id:"later",sort:2,name:"Second"},{id:"first",sort:1,name:"First"}]}});
    const source=doc("JournalEntry.source",{pages:{contents:pages.map(p=>({...p,testUserPermission:()=>p.id!=="secret"}))}});
    expect(readerChapters(root,source).map(p=>p.category)).toEqual(["First","Second"]);
  });
  it("retains link identities while stripping actions and hidden GM content", () => {
    const {document,HTMLElement,Element}=parseHTML("<html><body></body></html>");
    vi.stubGlobal("document",document); vi.stubGlobal("HTMLElement",HTMLElement); vi.stubGlobal("Element",Element);
    const prose=prepareReaderProse('<p>Hello <a class="content-link" data-uuid="Actor.hero" onclick="evil()">Hero</a></p><script>evil()</script><button data-action="run">Run</button><p class="gamemaster">SECRET</p><a href="javascript:evil()">Bad</a><document-embed uuid="RollTable.table" class="block"><p>Embedded prose</p></document-embed>');
    expect(prose.querySelector('.content-link')?.getAttribute('data-uuid')).toBe("Actor.hero");
    expect(prose.innerHTML).not.toMatch(/onclick|script|button|SECRET|javascript:/u);
    expect(prose.querySelector("document-embed")).toBeNull();
    expect(prose.querySelector(".ft-reader-static-embed")?.textContent).toBe("Embedded prose");
  });
});
