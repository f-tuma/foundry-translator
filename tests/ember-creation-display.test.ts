import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { itemSourceHash } from "../src/translation/item";
import { registerEmberCreationDisplay, translateEmberCreationContext, translateEmberCreationFeatureHtml } from "../src/translation/ember-creation-display";

const identity = vi.hoisted(() => ({ resolve: vi.fn(), source: vi.fn(), identity: vi.fn() }));
const glossary = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../src/glossary/compendium-repository", () => ({ GlossaryCompendiumRepository: class { loadExisting = glossary.load; } }));
vi.mock("../src/translation/document-identity", () => ({ resolveTranslationReference: identity.resolve,
  resolveSourceReference: identity.source, translationIdentity: identity.identity }));
let documents: Map<string, any>, journals: Map<string, any>, enrich: ReturnType<typeof vi.fn>;
let targetLanguage: string, preference: boolean;
beforeEach(() => {
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  documents = new Map(); journals = new Map(); enrich = vi.fn(async (html: string) => html);
  targetLanguage = "cs"; preference = true;
  vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { enrichHTML: enrich } } } });
  vi.stubGlobal("game", { system: { id: "crucible" }, modules: new Map([["ember", { active: true }]]),
    i18n: { lang: "en", localize: (key: string) => key }, journal: journals, settings: { get: (_module: string, key: string) => key === "targetLanguage" ? targetLanguage : key === "autoOpenTranslations" ? preference : undefined } });
  vi.stubGlobal("fromUuid", async (uuid: string) => documents.get(uuid) ?? null);
  identity.identity.mockReturnValue(null); identity.resolve.mockResolvedValue({ status: "source-only" });
  glossary.load.mockResolvedValue([]);
  identity.source.mockImplementation(async (uuid: string) => uuid);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const flag = (key: string, sourceUuid: string, extra = {}) => ({ "foundry-translate": { [key]: { schemaVersion: 1,
  sourceUuid, sourceHash: "hash", providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs",
  translatedAt: "2026-10-05", translatedTextPages: 1, skippedTextPages: 0, translatedHtmlFields: 1, ...extra } } });
async function itemPair() {
  const data = { name: "Arcturian", type: "background", system: { identifier: "arcturian", description: "<p>Original culture.</p>", talents: [{ item: "Item.talent" }] } };
  const source = { uuid: "Compendium.ember.crucible-character.Item.culture", documentName: "Item", visible: true,
    isOwner: false, ...data, toObject: () => data };
  const target = { ...source, uuid: "Compendium.world.foundry-translate-items.Item.cs", name: "Arktuřan",
    system: { ...data.system, description: "<p>Česká kultura.</p>" },
    flags: flag("itemTranslation", source.uuid, { sourceHash: await itemSourceHash(data) }) };
  documents.set(target.uuid, target);
  identity.resolve.mockImplementation(async (uuid: string) => uuid === source.uuid
    ? { status: "mapped", sourceUuid: uuid, translatedUuid: target.uuid } : { status: "source-only" });
  return { source, target, data };
}
function pagePair(sourceItem: any) {
  const original = { uuid: "JournalEntry.emberCultures000", documentName: "JournalEntry", visible: true, pages: { contents: [] as any[] } };
  const translated = { uuid: "Compendium.world.foundry-translate-translations.JournalEntry.cs", documentName: "JournalEntry", visible: true,
    flags: flag("translation", original.uuid) };
  const source = { uuid: `${original.uuid}.JournalEntryPage.p`, id: "p", documentName: "JournalEntryPage", type: "ember.culture", visible: true,
    parent: original, name: sourceItem.name, system: { identifier: "arcturian", subtitle: "A Culture", banner: { caption: "A soul lasts." } } };
  const target = { ...source, uuid: `${translated.uuid}.JournalEntryPage.p`, parent: translated, name: "Arktuřan",
    system: { identifier: "arcturian", subtitle: "Kultura", banner: { caption: "Duše přetrvá." } } };
  original.pages.contents.push(source); journals.set("emberCultures000", original); documents.set(target.uuid, target);
  const previous = identity.resolve.getMockImplementation()!;
  identity.resolve.mockImplementation(async (uuid: string, locale: string) => uuid === source.uuid
    ? { status: "mapped", sourceUuid: uuid, translatedUuid: target.uuid } : previous(uuid, locale));
  return { source, target, original, translated };
}

describe("Ember creation display overlay", () => {
  it("clones option and tab presentation while retaining original Items, mechanics, references and state", async () => {
    const f = await itemPair(), features = Object.freeze([{ items: ["<p>Native feature</p>"], id: "talents" }]);
    const option = Object.freeze({ identifier: "arcturian", item: f.source, name: "Arcturian", summary: "<p>Original culture.</p>", features, selected: true });
    const tabs = Object.freeze({ culture: Object.freeze({ selectionLabel: "Arcturian", action: "chooseCulture" }) });
    const context = Object.freeze({ cultures: Object.freeze([option]), culture: option, tabs, clone: f.source });
    const result = await translateEmberCreationContext(context) as any;
    expect(result.culture).toMatchObject({ identifier: "arcturian", item: f.source, name: "Arktuřan", summary: "<p>Česká kultura.</p>", selected: true });
    expect(result.cultures[0]).toBe(result.culture); expect(result.culture.features).toEqual(features);
    expect(result.clone).toBe(f.source); expect(result.tabs.culture).toEqual({ selectionLabel: "Arktuřan", action: "chooseCulture" });
    expect(context.culture.name).toBe("Arcturian"); expect(context.tabs.culture.selectionLabel).toBe("Arcturian");
    expect(identity.resolve).toHaveBeenCalledTimes(1);
    expect(enrich).toHaveBeenCalledWith("<p>Česká kultura.</p>", { relativeTo: f.source, secrets: false });
  });
  it.each(["hidden-source", "hidden-target", "stale-source", "ambiguous", "wrong-type", "wrong-UUID", "partial-item", "fallback-item"])("keeps native content for %s", async reason => {
    const f = await itemPair();
    if (reason === "hidden-source") f.source.visible = false;
    if (reason === "hidden-target") f.target.visible = false;
    if (reason === "stale-source") f.data.system.description = "<p>Changed source</p>";
    if (reason === "ambiguous") identity.resolve.mockResolvedValue({ status: "ambiguous" });
    if (reason === "wrong-type") f.target.type = "talent";
    if (reason === "wrong-UUID") f.target.uuid = "Item.unrelated";
    if (reason === "partial-item") Object.assign(f.target.flags["foundry-translate"].itemTranslation!, { partial: true });
    if (reason === "fallback-item") Object.assign(f.target.flags["foundry-translate"].itemTranslation!, { fallbackTextSegments: 1 });
    const context = { culture: { name: f.source.name, item: f.source, summary: "native", identifier: "arcturian" } };
    expect((await translateEmberCreationContext(context) as any).culture).toEqual(context.culture);
    expect(enrich).not.toHaveBeenCalled();
  });
  it("never uses journal body as replacement for a missing Item description", async () => {
    const f = await itemPair(); identity.resolve.mockResolvedValue({ status: "source-only" });
    const p = pagePair(f.source);
    (p.target.system as any).content = { overview: "Unrelated translated prose" };
    const context = { culture: { name: f.source.name, item: f.source, identifier: "arcturian", summary: "Native Item summary", figure: { src: "image.webp", caption: "A soul lasts." } } };
    const result = await translateEmberCreationContext(context) as any;
    expect(result.culture.name).toBe("Arktuřan"); expect(result.culture.figure).toEqual({ src: "image.webp", caption: "Duše přetrvá." });
    expect(result.culture.summary).toBe("Native Item summary"); expect(enrich).not.toHaveBeenCalled();
  });
  it.each(["partial", "hidden-parent", "duplicate-page", "mismatched-caption"])("keeps untrusted page-derived captions for %s", async reason => {
    const f = await itemPair(); identity.resolve.mockResolvedValue({ status: "source-only" }); const p = pagePair(f.source);
    if (reason === "partial") Object.assign(p.translated.flags["foundry-translate"].translation!, { partial: true, processedPageIds: [] });
    if (reason === "hidden-parent") p.original.visible = false;
    if (reason === "duplicate-page") p.original.pages.contents.push({ ...p.source, id: "other" });
    const caption = reason === "mismatched-caption" ? "Different native figure" : "A soul lasts.";
    const result = await translateEmberCreationContext({ culture: { identifier: "arcturian", figure: { caption } } }) as any;
    expect(result.culture.figure.caption).toBe(caption);
  });
  it("does not apply Item descriptions to attunement config prose", async () => {
    const f = await itemPair();
    const result = await translateEmberCreationContext({ attunement: { name: f.source.name, item: f.source, summary: "Config description" } }) as any;
    expect(result.attunement.name).toBe("Arktuřan"); expect(result.attunement.summary).toBe("Config description"); expect(enrich).not.toHaveBeenCalled();
  });
  it("retains source description if translated HTML or command structure changes", async () => {
    const f = await itemPair(); f.target.system.description = '<p onclick="unsafe()">Česká kultura.</p>';
    const result = await translateEmberCreationContext({ culture: { name: f.source.name, item: f.source, summary: "native" } }) as any;
    expect(result.culture.summary).toBe("native"); expect(enrich).not.toHaveBeenCalled();
  });
  it("retains the native creation producer's secret visibility even for an owner", async () => {
    const f = await itemPair(); f.source.isOwner = f.target.isOwner = true;
    const result = await translateEmberCreationContext({ culture: { item: f.source, name: f.source.name, summary: "native" } }) as any;
    expect(result.culture.summary).toBe("<p>Česká kultura.</p>");
    expect(enrich).toHaveBeenCalledWith("<p>Česká kultura.</p>", { relativeTo: f.source, secrets: false });
  });
  it("does not display a translated Item description with changed quantities", async () => {
    const f = await itemPair();
    f.data.system.description = "<p>Damage 3.</p>";
    f.target.flags["foundry-translate"].itemTranslation!.sourceHash = await itemSourceHash(f.data);
    f.target.system.description = "<p>Zranění 5.</p>";
    const result = await translateEmberCreationContext({ culture: { item: f.source, name: f.source.name, summary: "native" } }) as any;
    expect(result.culture.summary).toBe("native"); expect(enrich).not.toHaveBeenCalled();
  });
  it("rechecks visibility/content after asynchronous enrichment", async () => {
    const f = await itemPair(); enrich.mockImplementation(async () => { f.target.visible = false; return "HIDDEN"; });
    const result = await translateEmberCreationContext({ culture: { name: f.source.name, item: f.source, summary: "native" } }) as any;
    expect(result.culture.summary).toBe("native");
  });
  it("uses target content language independently of interface language and fresh lookup on every render", async () => {
    const f = await itemPair(); const context = { culture: { name: f.source.name, item: f.source } };
    expect((await translateEmberCreationContext(context) as any).culture.name).toBe("Arktuřan"); targetLanguage = "en";
    identity.resolve.mockResolvedValue({ status: "source-only" });
    expect((await translateEmberCreationContext(context) as any).culture.name).toBe(f.source.name);
    expect(identity.resolve).toHaveBeenLastCalledWith(f.source.uuid, "en");
  });
  it.each(["user", "language", "preference", "source-flag", "target-flag", "source-mechanics"])("discards the overlay when %s changes during enrichment", async reason => {
    const f = await itemPair(); const context = { culture: { item: f.source, name: f.source.name, summary: "native" } };
    enrich.mockImplementation(async () => {
      if (reason === "user") (game as any).user = {};
      if (reason === "language") targetLanguage = "en";
      if (reason === "preference") preference = false;
      if (reason === "source-flag") (f.source as any).flags = flag("itemTranslation", "Item.other");
      if (reason === "target-flag") f.target.flags["foundry-translate"].itemTranslation!.sourceUuid = "Item.other";
      if (reason === "source-mechanics") f.data.system.identifier = "other";
      return "translated";
    });
    expect(await translateEmberCreationContext(context)).toBe(context);
  });
  it("retains native submission state and installs its context wrapper idempotently", async () => {
    const f = await itemPair(), state = { culture: { name: f.source.name, item: f.source, identifier: "arcturian" } }, submit = vi.fn();
    class Sheet { _state = state; async _prepareContext() { return state; } _onSubmit = submit; }
    vi.stubGlobal("ember", { system: { applications: { EmberHeroCreationSheet: Sheet } } });
    registerEmberCreationDisplay(); const method = Sheet.prototype._prepareContext; registerEmberCreationDisplay();
    const sheet = new Sheet(), result = await sheet._prepareContext() as any;
    expect(Sheet.prototype._prepareContext).toBe(method); expect(result.culture.name).toBe("Arktuřan");
    expect(sheet._state).toBe(state); expect(sheet._state.culture.name).toBe(f.source.name); expect(sheet._onSubmit).toBe(submit);
    preference = false;
    expect(await sheet._prepareContext()).toBe(state);
  });
});

async function talentPair() {
  const f = await itemPair(); f.source.type = f.target.type = f.data.type = "talent";
  f.source.name = f.data.name = "Personalized Crafting"; f.target.name = "Osobní Řemeslo";
  f.target.flags["foundry-translate"].itemTranslation!.sourceHash = await itemSourceHash(f.data);
  documents.set(f.source.uuid, f.source);
  return f;
}
const inline = (uuid: string, name = "Personalized Crafting") => `<div class="crucible-item-inline line-item talent" data-uuid="${uuid}" data-crucible-tooltip="talent"><div class="icon-frame"><img alt="${name}"></div><div class="title"><h4>${name}</h4><div class="tags"><span class="tag">Ancestry: Human</span></div></div><input name="system.talents.0.level" type="number" value="2"><a data-action="removeTalent">Remove</a></div>`;
describe("native creation talent captions", () => {
  it("replaces exact caption/alt slots and keeps original tooltip UUID, tags and controls", async () => {
    const f = await talentPair(); const html = await translateEmberCreationFeatureHtml(inline(f.source.uuid), "cs");
    const root = document.createElement("div"); root.innerHTML = html;
    expect(root.querySelector("h4")?.textContent).toBe("Osobní Řemeslo"); expect(root.querySelector("img")?.getAttribute("alt")).toBe("Osobní Řemeslo");
    expect(root.firstElementChild?.getAttribute("data-uuid")).toBe(f.source.uuid);
    expect(root.firstElementChild?.getAttribute("data-crucible-tooltip")).toBe("talent");
    expect(root.querySelector(".tag")?.textContent).toBe("Ancestry: Human");
    expect(root.querySelector("input")?.getAttribute("name")).toBe("system.talents.0.level");
    expect(root.querySelector("input")?.getAttribute("value")).toBe("2"); expect(root.querySelector("a")?.getAttribute("data-action")).toBe("removeTalent");
    expect(enrich).not.toHaveBeenCalled();
  });
  it("uses approved exact glossary names when a translated Item is unavailable, without substring matches", async () => {
    const f = await talentPair(); identity.resolve.mockResolvedValue({ status: "source-only" });
    glossary.load.mockResolvedValue([{ source: "Crafting", replacement: "Řemeslo", aliases: [] }]);
    expect(await translateEmberCreationFeatureHtml(inline(f.source.uuid), "cs")).toBe(inline(f.source.uuid));
    glossary.load.mockResolvedValue([{ source: f.source.name, replacement: "Osobní Řemeslo", aliases: [] }]);
    expect(await translateEmberCreationFeatureHtml(inline(f.source.uuid), "cs")).toContain("<h4>Osobní Řemeslo</h4>");
    glossary.load.mockResolvedValue([{ source: f.source.name, replacement: "A", aliases: [] }, { source: f.source.name, replacement: "B", aliases: [] }]);
    expect(await translateEmberCreationFeatureHtml(inline(f.source.uuid), "cs")).toBe(inline(f.source.uuid));
  });
  it("clones initialized feature HTML in each new context without changing shared native features", async () => {
    const f = await talentPair(); const features = Object.freeze([{ id: "talents", items: Object.freeze([inline(f.source.uuid)]) }]);
    const context = { culture: { item: f.source, features }, cultures: [{ item: f.source, features }] };
    const result = await translateEmberCreationContext(context) as any;
    expect(result.culture.features[0].items[0]).toContain("<h4>Osobní Řemeslo</h4>");
    expect(context.culture.features[0]?.items[0]).toBe(inline(f.source.uuid)); expect(glossary.load).toHaveBeenCalledTimes(1);
  });
  it("does not change foreign UUIDs, author-supplied captions or markup inside a title", async () => {
    const f = await talentPair();
    for (const html of [inline("Item.missing"), inline(f.source.uuid, "Explicit Caption"), inline(f.source.uuid).replace("<h4>Personalized Crafting</h4>", "<h4><em>Personalized Crafting</em></h4>")]) {
      expect(await translateEmberCreationFeatureHtml(html, "cs")).toBe(html);
    }
  });
  it("does not apply a world glossary to a foreign explicit language", async () => {
    const f = await talentPair(); identity.resolve.mockResolvedValue({ status: "source-only" });
    glossary.load.mockResolvedValue([{ source: f.source.name, replacement: "České Jméno", aliases: [] }]);
    expect(await translateEmberCreationFeatureHtml(inline(f.source.uuid), "de")).toBe(inline(f.source.uuid)); expect(glossary.load).not.toHaveBeenCalled();
  });
  it("localizes only source-proven ancestry tag values with exact glossary matches", async () => {
    const f = await talentPair(); identity.resolve.mockResolvedValue({ status: "source-only" });
    (f.source as any).getTags = () => ({ ancestry: "Ancestry: Human, Keth/Kivahr" });
    (game.i18n as any).localize = (key: string) => key === "TYPES.Item.ancestry" ? "Původ" : key;
    glossary.load.mockResolvedValue([{ source: "Human", replacement: "Člověk", aliases: [] }, { source: "Keth", replacement: "A", aliases: [] }, { source: "Keth", replacement: "B", aliases: [] }, { source: "Kivahr", replacement: "Kivahr", aliases: [] }]);
    const html = inline(f.source.uuid).replace("Ancestry: Human", "Ancestry: Human, Keth/Kivahr");
    expect(await translateEmberCreationFeatureHtml(html, "cs")).toContain("Původ: Člověk, Keth/Kivahr");
    // Similar prose or a forged tag not present in native getTags is untouched.
    expect(await translateEmberCreationFeatureHtml(inline(f.source.uuid).replace("Ancestry: Human", "Ancestry: Human Warrior"), "cs")).toBe(inline(f.source.uuid).replace("Ancestry: Human", "Ancestry: Human Warrior"));
  });
  it("localizes native tab and progression/trait labels through actual interface dictionaries only", async () => {
    (game.i18n as any).lang = "cs";
    const values: Record<string, string> = { Culture: "Kultura", AsterProgression: "Vývoj Asterů", Rarity: "Vzácnost", Lifespan: "Délka Života" };
    (game.i18n as any).localize = (key: string) => values[key.replace("FOUNDRY_TRANSLATE.Creation.", "")] ?? key;
    const context = { tabs: { culture: { id: "culture", label: "Culture", action: "chooseCulture" }, custom: { label: "Custom" } },
      aster: { features: [{ label: "Aster Progression", tags: [{ text: "Lifespan: 150 years", id: "lifespan" }, { text: "Rarity: Uncommon" }, { text: "Other: 3" }] }] } };
    const result = await translateEmberCreationContext(context) as any;
    expect(result.tabs.culture).toEqual({ id: "culture", label: "Kultura", action: "chooseCulture" });
    expect(result.tabs.custom).toBe(context.tabs.custom);
    expect(result.aster.features[0]).toEqual({ label: "Vývoj Asterů", tags: [{ text: "Délka Života: 150 years", id: "lifespan" }, { text: "Vzácnost: Uncommon" }, { text: "Other: 3" }] });
    expect(context.tabs.culture.label).toBe("Culture");
    const html = '<section class="gameplay-traits option-summary crucible"><div class="step-feature"><h4>Aster Progression</h4><div class="tags"><span class="tag">Lifespan: 150 years</span></div></div></section>';
    const after = await translateEmberCreationFeatureHtml(html, "cs");
    expect(after).toContain("<h4>Vývoj Asterů</h4>"); expect(after).toContain("Délka Života: 150 years");
  });
  it("discards feature label changes after source access or world changes during asynchronous lookup", async () => {
    const f = await talentPair(); const old = identity.resolve.getMockImplementation()!;
    identity.resolve.mockImplementation(async (uuid: string, locale: string) => { const result = await old(uuid, locale); (game as any).world = {}; return result; });
    expect(await translateEmberCreationFeatureHtml(inline(f.source.uuid), "cs")).toBe(inline(f.source.uuid));
  });
  it.each(["unprocessed", "wrong-source-UUID", "source-change"])("keeps native explicit summary for %s", async reason => {
    const f = await talentPair(), p = pagePair(f.source); documents.set(p.source.uuid, p.source);
    const originalUuid = p.source.uuid;
    identity.source.mockImplementation(async uuid => uuid === p.target.uuid ? originalUuid : uuid);
    if (reason === "unprocessed") Object.assign(p.translated.flags["foundry-translate"].translation!, { partial: true, processedPageIds: [] });
    if (reason === "wrong-source-UUID") p.source.uuid = "JournalEntry.foreign.JournalEntryPage.p";
    if (reason === "source-change") {
      const before = identity.resolve.getMockImplementation()!;
      identity.resolve.mockImplementation(async (uuid: string, locale: string) => { const result = await before(uuid, locale); p.source.system.identifier = "changed"; return result; });
    }
    class Sheet { async _prepareContext() { return {}; } static optionSummaryHTML = vi.fn(async (_page: unknown) => inline(f.source.uuid)); }
    vi.stubGlobal("ember", { system: { applications: { EmberHeroCreationSheet: Sheet } } }); registerEmberCreationDisplay();
    expect(await Sheet.optionSummaryHTML(p.target as any)).toBe(inline(f.source.uuid));
  });
  it("allows explicit translated-page summaries with preference off while leaving ordinary summaries native", async () => {
    const f = await talentPair(), p = pagePair(f.source); documents.set(p.source.uuid, p.source);
    identity.source.mockImplementation(async uuid => uuid === p.target.uuid ? p.source.uuid : uuid);
    class Sheet { async _prepareContext() { return {}; } static optionSummaryHTML = vi.fn(async (_page: unknown) => inline(f.source.uuid)); }
    vi.stubGlobal("ember", { system: { applications: { EmberHeroCreationSheet: Sheet } } }); registerEmberCreationDisplay(); preference = false;
    expect(await Sheet.optionSummaryHTML(p.source as any)).toBe(inline(f.source.uuid));
    expect(await Sheet.optionSummaryHTML(p.target as any)).toContain("<h4>Osobní Řemeslo</h4>");
    p.source.visible = false;
    expect(await Sheet.optionSummaryHTML(p.target as any)).toBe(inline(f.source.uuid));
  });
});
