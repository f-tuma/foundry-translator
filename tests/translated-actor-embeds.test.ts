import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTranslatedActorEmbeds } from "../src/translation/translated-actor-embeds";
import { resolveSourceReference, resolveTranslationReference } from "../src/translation/document-identity";
import { GlossaryCompendiumRepository } from "../src/glossary/compendium-repository";

vi.mock("../src/translation/document-identity", async importOriginal => ({
  ...await importOriginal<typeof import("../src/translation/document-identity")>(),
  resolveTranslationReference: vi.fn(), resolveSourceReference: vi.fn(),
}));
vi.mock("../src/glossary/compendium-repository", () => ({ GlossaryCompendiumRepository: vi.fn() }));
const resolve = vi.mocked(resolveTranslationReference), reverse = vi.mocked(resolveSourceReference);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function fixture() {
  const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("Node", window.Node); vi.stubGlobal("Event", window.Event);
  const source = { id: "source", uuid: "Actor.source", documentName: "Actor", name: "Silver Scout", type: "adversary",
    visible: true, isOwner: true, system: { details: { biography: { appearance: "<p>A tall scout.</p>" },
      taxonomy: { name: "Human" }, archetype: { name: "Operator" } }, advancement: { threatLevel: 7 } }, flags: {} };
  const actorFlag = { schemaVersion: 1, sourceUuid: source.uuid, sourceHash: "hash", providerId: "openai-compatible",
    sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedHtmlFields: 1 };
  const target = { ...source, id: "copy", uuid: "Compendium.world.foundry-translate-actors.Actor.copy", name: "Stříbrný Zvěd",
    system: { details: { biography: { appearance: "<p>Vysoký zvěd.</p>" }, taxonomy: { name: "BAD COPIED MECHANIC" }, archetype: { name: "BAD COPIED MECHANIC" } } },
    flags: { "foundry-translate": { actorTranslation: actorFlag } } };
  // No public/private text may ever be read or appended to an appearance card.
  Object.defineProperties(target.system.details.biography, {
    public: { get() { throw new Error("public must not be read"); } },
    private: { get() { throw new Error("private must not be read"); } },
  });
  const journal = { id: "guide", uuid: "JournalEntry.copy", documentName: "JournalEntry", visible: true, flags: { "foundry-translate": { translation: {
    schemaVersion: 1, sourceUuid: "JournalEntry.source", sourceHash: "hash", providerId: "openai-compatible",
    sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedTextPages: 1, skippedTextPages: 0,
  } } } };
  const root = document.createElement("document-embed");
  root.className = "block actor"; root.setAttribute("uuid", source.uuid); root.setAttribute("data-srcuuid", source.uuid);
  root.innerHTML = `<img class="portrait" src="source.webp" alt="Silver Scout"><header><h4><a data-uuid="Actor.source"><i class="native-icon"></i>Silver Scout</a><span class="count">(x3)</span></h4><button data-action="toggleDiscovery" data-discovery-id="source">Discover</button><div class="meta"><span class="threat">Level 7 (Boss)</span><span class="category">Human Operator</span></div></header><section class="readaloud"><p>A tall scout.</p></section>`;
  const original = vi.fn(async function(this: typeof source, _config: Record<string, unknown>, _options: unknown) { return root as unknown as HTMLElement; });
  const prototype = { toEmbed: original };
  const enrich = vi.fn(async (text: string, _options: Record<string, unknown>) => text);
  const loadExisting = vi.fn(async () => [
    { source: "Human", replacement: "Člověk", aliases: [], category: "term" },
    { source: "Operator", replacement: "Operátor", aliases: [], category: "term" },
  ]);
  vi.mocked(GlossaryCompendiumRepository).mockImplementation(() => ({ loadExisting }) as unknown as GlossaryCompendiumRepository);
  vi.stubGlobal("game", { system: { id: "crucible" } });
  vi.stubGlobal("CONFIG", { Actor: { documentClass: { prototype } }, ux: { TextEditor: { enrichHTML: enrich } } });
  vi.stubGlobal("fromUuid", vi.fn(async () => target));
  resolve.mockResolvedValue({ sourceUuid: source.uuid, translatedUuid: target.uuid, status: "mapped" });
  reverse.mockImplementation(async uuid => uuid);
  registerTranslatedActorEmbeds();
  const invoke = (options: any = { relativeTo: { parent: journal } }, config: any = {}, doc: any = source) => prototype.toEmbed.call(doc, config, options);
  const slot = () => root.querySelector("section.readaloud")!;
  return { source, target, actorFlag, journal, root, slot, original, prototype, enrich, loadExisting, invoke };
}

describe("translated native Actor appearance embeds", () => {
  it("renders the original once and changes only presentation, preserving UUIDs, mechanics, nodes and discovery listeners", async () => {
    const f = fixture(), before = JSON.stringify([f.source, f.target]);
    const discovery = f.root.querySelector("button")!, clicked = vi.fn(); discovery.addEventListener("click", clicked);
    const heading = f.root.querySelector("h4")!, icon = f.root.querySelector("i")!;
    const config = { count: 3, image: "token" }, options = { relativeTo: f.journal, _embedDepth: 2, secrets: false };
    expect(await f.invoke(options, config)).toBe(f.root);
    expect(f.original).toHaveBeenCalledTimes(1); expect(f.original.mock.instances[0]).toBe(f.source);
    expect(f.original).toHaveBeenCalledWith(config, options);
    expect(f.enrich).toHaveBeenCalledWith("<p>Vysoký zvěd.</p>", { ...options, relativeTo: f.source, secrets: false });
    expect(f.slot().innerHTML).toBe("<p>Vysoký zvěd.</p>");
    expect(f.root.querySelector("h4")).toBe(heading); expect(f.root.querySelector("i")).toBe(icon);
    expect(f.root.querySelector("a")?.textContent).toBe("Stříbrný Zvěd");
    expect(f.root.querySelector(".category")?.textContent).toBe("Člověk Operátor");
    expect(f.root.querySelector(".threat")?.textContent).toBe("Level 7 (Boss)");
    expect(f.root.querySelector(".count")?.textContent).toBe("(x3)");
    expect(f.root.querySelector("a")?.getAttribute("data-uuid")).toBe(f.source.uuid);
    expect(f.root.getAttribute("uuid")).toBe(f.source.uuid); expect(f.root.getAttribute("data-srcuuid")).toBe(f.source.uuid);
    expect(f.root.querySelector("img")?.getAttribute("src")).toBe("source.webp");
    discovery.dispatchEvent(new Event("click")); expect(clicked).toHaveBeenCalledTimes(1);
    expect(discovery.getAttribute("data-discovery-id")).toBe("source");
    expect(JSON.stringify([f.source, f.target])).toBe(before);
  });
  it("normalizes translated dependency identities to exact source IDs before native enrichment", async () => {
    const f = fixture();
    f.source.system.details.biography.appearance = "<p>A friend @UUID[Actor.friend]{Scout}.</p>";
    f.target.system.details.biography.appearance = "<p>Přítel @UUID[Compendium.world.foundry-translate-actors.Actor.friend]{Zvěd}.</p>";
    reverse.mockResolvedValue("Actor.friend");
    await f.invoke();
    expect(f.enrich.mock.calls[0]?.[0]).toBe("<p>Přítel @UUID[Actor.friend]{Zvěd}.</p>");
    expect(f.enrich.mock.calls[0]?.[1].relativeTo).toBe(f.source);
  });
  it("retains exact relative child references rather than redirecting owned gameplay items", async () => {
    const f = fixture();
    f.source.system.details.biography.appearance = "<p>@UUID[.Item.action]{Strike}</p>";
    f.target.system.details.biography.appearance = "<p>@UUID[.Item.action]{Úder}</p>";
    reverse.mockResolvedValue("Actor.source.Item.action");
    await f.invoke();
    expect(f.enrich.mock.calls[0]?.[0]).toBe("<p>@UUID[.Item.action]{Úder}</p>");
  });
  it("does not infer missing translated child IDs or allow executable syntax in a caption", async () => {
    const f = fixture(), before = f.root.outerHTML; vi.spyOn(console, "warn").mockImplementation(() => {});
    f.source.system.details.biography.appearance = "<p>@UUID[.Item.action]{Strike}</p>";
    f.target.system.details.biography.appearance = "<p>@UUID[.Item.other]{Úder}</p>";
    reverse.mockResolvedValue(null);
    await f.invoke(); expect(f.root.outerHTML).toBe(before); expect(f.enrich).not.toHaveBeenCalled();
    f.target.system.details.biography.appearance = "<p>@UUID[.Item.action]{@Check[type:poison dc:99]}</p>";
    await f.invoke(); expect(f.root.outerHTML).toBe(before); expect(f.enrich).not.toHaveBeenCalled();
  });
  it.each(["missing", "ambiguous", "invalid", "source-only"] as const)("keeps native rendering when mapping is %s", async status => {
    const f = fixture(), before = f.root.outerHTML;
    resolve.mockResolvedValue({ sourceUuid: f.source.uuid, translatedUuid: null, status });
    await f.invoke(); expect(f.root.outerHTML).toBe(before); expect(f.enrich).not.toHaveBeenCalled();
  });
  it.each(["<p>Nový @UUID[Actor.unrelated]{Odkaz}</p>", "<p>@Check[type:poison dc:99]</p>", "<h1>Nový text</h1>", "<p class='secret'>Utajený text.</p>"])("rejects altered commands, structure or secret policy: %s", async bad => {
    const f = fixture(), before = f.root.outerHTML;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    f.target.system.details.biography.appearance = bad;
    await f.invoke(); expect(f.root.outerHTML).toBe(before); expect(f.enrich).not.toHaveBeenCalled();
  });
  it("preserves source secret containers and restricts enrichment to both owners even with explicit secrets true", async () => {
    const f = fixture();
    f.source.system.details.biography.appearance = '<p>Scout.</p><section class="secret"><p>Hidden.</p></section>';
    f.target.system.details.biography.appearance = '<p>Zvěd.</p><section class="secret"><p>Skryté.</p></section>';
    f.target.isOwner = false;
    await f.invoke({ relativeTo: f.journal, secrets: true });
    expect(f.enrich).toHaveBeenCalledWith(f.target.system.details.biography.appearance, expect.objectContaining({ relativeTo: f.source, secrets: false }));
    expect(f.slot().querySelector("section.secret")).not.toBeNull();
  });
  it("falls back when source secret structure has been removed from a translation", async () => {
    const f = fixture(), before = f.root.outerHTML; vi.spyOn(console, "warn").mockImplementation(() => {});
    f.source.system.details.biography.appearance = '<section class="secret"><p>Hidden.</p></section>';
    f.target.system.details.biography.appearance = '<section><p>Skryté.</p></section>';
    await f.invoke(); expect(f.root.outerHTML).toBe(before);
  });
  it("does not translate unscoped/original journals, copied actors, unsupported layouts or model types", async () => {
    const f = fixture(), before = f.root.outerHTML;
    await f.invoke({}); await f.invoke({ relativeTo: { uuid: "JournalEntry.source", documentName: "JournalEntry" } });
    await f.invoke(undefined, {}, f.target); await f.invoke(undefined, {}, { ...f.source, type: "character" });
    f.root.classList.remove("actor"); await f.invoke();
    expect(f.enrich).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
    f.root.classList.add("actor"); expect(f.root.outerHTML).toBe(before);
  });
  it("renders four explicit plain-text readaloud overrides in a compendium page, retaining the native chat/discovery DOM", async () => {
    const overrides = ["Vidíte vysokého zvěda.", "Slyšíte kroky.\\nZ chodby vystupuje bojovník.",
      "Cestovatel má zlaté oči.", "Lékař & jeho pomocník vás zdraví."];
    for (const readaloud of overrides) {
      const f = fixture();
      f.journal.uuid = "Compendium.world.foundry-translate-translations.JournalEntry.guide";
      const page = { id: "overview", uuid: `${f.journal.uuid}.JournalEntryPage.overview`, documentName: "JournalEntryPage", visible: true, parent: f.journal };
      const snapshot = JSON.stringify([f.source, f.target, f.journal, page]);
      const discovery = f.root.querySelector("button")!, listener = vi.fn(); discovery.addEventListener("click", listener);
      const chat = document.createElement("button"); chat.className = "readaloud-chat";
      let posted = "";
      chat.addEventListener("click", () => {
        const clone = chat.closest("section.readaloud")!.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("button.readaloud-chat").forEach(button => button.remove());
        posted = clone.innerHTML;
      });
      const config = { readaloud, count: 3, uuid: f.source.uuid }, options = { relativeTo: page, secrets: false };
      await f.invoke(options, config);
      f.slot().appendChild(chat); chat.dispatchEvent(new Event("click")); discovery.dispatchEvent(new Event("click"));
      expect([...f.slot().querySelectorAll("p")].map(p => p.textContent)).toEqual(readaloud.split("\\n"));
      expect(posted).toBe(f.slot().innerHTML.replace(chat.outerHTML, ""));
      expect(posted).not.toContain("A tall scout"); expect(listener).toHaveBeenCalledTimes(1);
      expect(f.original).toHaveBeenCalledWith(config, options);
      expect(f.enrich).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        relativeTo: f.source, secrets: false, documents: false, links: false, embeds: false, rolls: false, custom: false,
      }));
      expect(f.root.getAttribute("uuid")).toBe(f.source.uuid);
      expect(f.root.querySelector("a")?.getAttribute("data-uuid")).toBe(f.source.uuid);
      expect(discovery.getAttribute("data-discovery-id")).toBe("source");
      expect(JSON.stringify([f.source, f.target, f.journal, page])).toBe(snapshot);
    }
  });
  it.each(["missing", "ambiguous", "invalid", "source-only"] as const)("does not need an Actor copy for a journal override when mapping is %s", async status => {
    const f = fixture(); resolve.mockResolvedValue({ sourceUuid: f.source.uuid, translatedUuid: null, status });
    await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda." });
    expect(f.slot().textContent).toBe("Vidíte zvěda.");
    expect(f.root.querySelector("a")?.textContent).toBe("Silver Scout");
    expect(f.root.querySelector(".category")?.textContent).toBe("Human Operator");
    expect(fromUuid).not.toHaveBeenCalled(); expect(f.loadExisting).not.toHaveBeenCalled();
  });
  it("uses a journal override when the optional Actor index is unavailable, retaining source captions", async () => {
    const f = fixture(); resolve.mockRejectedValueOnce(new Error("Index unavailable"));
    await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda." });
    expect(f.slot().textContent).toBe("Vidíte zvěda.");
    expect(f.root.querySelector("a")?.textContent).toBe("Silver Scout");
  });
  it.each(["", "   ", false, 7, "<p>HTML</p>", "<section class='secret'>Hidden</section>", "@UUID[Actor.other]", "@Check[type:poison dc:99]", "&Reference[Poisoned]", "[[1d20]]", "x".repeat(60001)]
    .map(readaloud => ({ readaloud, label: typeof readaloud === "string" && readaloud.length > 80 ? "over size limit" : String(readaloud) })))
  ("keeps native rendering for an empty or unsupported override $label", async ({ readaloud }) => {
    const f = fixture(), before = f.root.outerHTML;
    await f.invoke({ relativeTo: f.journal }, { readaloud });
    expect(f.root.outerHTML).toBe(before); expect(f.enrich).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });
  it("leaves original journals native even with a valid override, and honors explicit caller captions in translated ones", async () => {
    const f = fixture(), before = f.root.outerHTML;
    await f.invoke({ relativeTo: { documentName: "JournalEntry", visible: true, flags: {} } }, { readaloud: "Original override" });
    expect(f.root.outerHTML).toBe(before); expect(f.enrich).not.toHaveBeenCalled();
    // The label wrapper/native renderer owns an explicit caption; the appearance
    // adapter may not replace it with the copy's stored name.
    f.root.querySelector("a")!.lastChild!.textContent = "Caller caption";
    await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda.", label: "Caller caption" });
    expect(f.root.querySelector("a")?.textContent).toBe("Caller caption");
    expect(f.slot().textContent).toBe("Vidíte zvěda.");
  });
  it("does not widen journal/Actor visibility or use an invalid mapped copy for explicit overrides", async () => {
    const f = fixture(), before = f.root.outerHTML;
    f.journal.visible = false; await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda." });
    f.journal.visible = true; f.source.visible = false; await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda." });
    f.source.visible = true; f.target.visible = false; await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda." });
    f.target.visible = true; f.actorFlag.sourceUuid = "Actor.unrelated"; await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda." });
    expect(f.root.outerHTML).toBe(before); expect(f.enrich).not.toHaveBeenCalled();
  });
  it("rechecks the full journal identity, visibility and override while enrichment is pending", async () => {
    const f = fixture(), before = f.root.outerHTML;
    f.enrich.mockImplementationOnce(async text => { f.journal.flags["foundry-translate"].translation.sourceUuid = "JournalEntry.other"; return text; });
    await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda." });
    expect(f.root.outerHTML).toBe(before);
    f.enrich.mockImplementationOnce(async text => { f.journal.visible = false; return text; });
    await f.invoke({ relativeTo: f.journal }, { readaloud: "Vidíte zvěda." });
    expect(f.root.outerHTML).toBe(before); f.journal.visible = true;
    const config = { readaloud: "Vidíte zvěda." };
    f.enrich.mockImplementationOnce(async text => { config.readaloud = "<p>Later markup</p>"; return text; });
    await f.invoke({ relativeTo: f.journal }, config);
    expect(f.root.outerHTML).toBe(before);
  });
  it("does not use private nested slots for unsupported native layouts", async () => {
    const f = fixture(); f.root.innerHTML = '<header><h4><a data-uuid="Actor.source">Silver Scout</a></h4></header><div><section class="readaloud">Nested</section></div>';
    await f.invoke(); expect(resolve).not.toHaveBeenCalled();
  });
  it("rechecks source and target visibility, language, and source identity", async () => {
    const f = fixture(), before = f.root.outerHTML;
    f.source.visible = false; await f.invoke(); f.source.visible = true;
    f.target.visible = false; await f.invoke(); f.target.visible = true;
    f.actorFlag.targetLanguage = "de"; await f.invoke(); f.actorFlag.targetLanguage = "cs";
    f.actorFlag.sourceUuid = "Actor.other"; await f.invoke(); f.actorFlag.sourceUuid = f.source.uuid;
    f.target.type = "character"; await f.invoke();
    expect(f.enrich).not.toHaveBeenCalled(); expect(f.root.outerHTML).toBe(before);
  });
  it("stages DOM changes and falls back if enrichment fails or visibility/prose changes while awaiting it", async () => {
    const f = fixture(), before = f.root.outerHTML; vi.spyOn(console, "warn").mockImplementation(() => {});
    f.enrich.mockRejectedValueOnce(new Error("Unavailable renderer")); await f.invoke();
    expect(f.root.outerHTML).toBe(before);
    f.enrich.mockImplementationOnce(async text => { f.source.visible = false; return text; }); await f.invoke();
    expect(f.root.outerHTML).toBe(before); f.source.visible = true;
    f.enrich.mockImplementationOnce(async text => { f.target.system.details.biography.appearance = "<p>Later change</p>"; return text; });
    await f.invoke(); expect(f.root.outerHTML).toBe(before);
  });
  it("rechecks ownership and the containing journal identity after asynchronous enrichment", async () => {
    const f = fixture(), before = f.root.outerHTML;
    f.enrich.mockImplementationOnce(async text => { f.target.isOwner = false; return text; });
    await f.invoke(); expect(f.root.outerHTML).toBe(before); f.target.isOwner = true;
    f.enrich.mockImplementationOnce(async text => { f.journal.flags["foundry-translate"].translation.targetLanguage = "de"; return text; });
    await f.invoke(); expect(f.root.outerHTML).toBe(before);
  });
  it("keeps native rendering when an index is unavailable or the resolved copy is missing", async () => {
    const f = fixture(), before = f.root.outerHTML; vi.spyOn(console, "warn").mockImplementation(() => {});
    resolve.mockRejectedValueOnce(new Error("Index unavailable")); await f.invoke();
    vi.mocked(fromUuid).mockResolvedValueOnce(null); await f.invoke();
    expect(f.root.outerHTML).toBe(before); expect(f.enrich).not.toHaveBeenCalled();
  });
  it("preserves explicit captions, missing/ambiguous glossary terms and native category qualifiers", async () => {
    const f = fixture();
    f.loadExisting.mockResolvedValueOnce([
      { source: "Human", replacement: "Člověk", aliases: [], category: "term" },
      { source: "Human", replacement: "Lidé", aliases: [], category: "term" },
    ]);
    await f.invoke(undefined, { label: "Explicit caption" });
    expect(f.root.querySelector("a")?.textContent).toBe("Silver Scout");
    expect(f.root.querySelector(".category")?.textContent).toBe("Human Operator");
    f.root.querySelector(".category")!.textContent = "Human Operator (secret rank)";
    await f.invoke(); expect(f.root.querySelector(".category")?.textContent).toBe("Human Operator (secret rank)");
  });
  it("registers once and only for Crucible, and keeps native null results", async () => {
    const f = fixture(), wrapped = f.prototype.toEmbed;
    registerTranslatedActorEmbeds(); expect(f.prototype.toEmbed).toBe(wrapped);
    f.original.mockResolvedValueOnce(null as unknown as HTMLElement);
    expect(await f.invoke()).toBeNull(); expect(resolve).not.toHaveBeenCalled();
    const untouched = { toEmbed: vi.fn() };
    vi.stubGlobal("game", { system: { id: "dnd5e" } });
    vi.stubGlobal("CONFIG", { Actor: { documentClass: { prototype: untouched } } });
    const native = untouched.toEmbed; registerTranslatedActorEmbeds(); expect(untouched.toEmbed).toBe(native);
  });
});
