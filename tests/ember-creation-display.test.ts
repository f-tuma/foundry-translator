import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { itemSourceHash } from "../src/translation/item";
import { journalSourceHash } from "../src/translation/journal";
import * as journal from "../src/translation/journal";
import { registerEmberCreationDisplay, translateEmberCreationContext, translateEmberCreationFeatureHtml } from "../src/translation/ember-creation-display";

const identity = vi.hoisted(() => ({ resolve: vi.fn(), source: vi.fn(), identity: vi.fn() }));
const glossary = vi.hoisted(() => ({ load: vi.fn() }));
const machine = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("../src/review/machine-proofreading", () => ({ isMachineProofreadingCurrent: machine.current }));
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
  machine.current.mockResolvedValue(false);
  identity.source.mockImplementation(async (uuid: string) => uuid);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const flag = (key: string, sourceUuid: string, extra = {}) => ({ "foundry-translate": { [key]: { schemaVersion: 1,
  sourceUuid, sourceHash: "hash", providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs",
  translatedAt: "2026-10-05", translatedTextPages: 1, skippedTextPages: 0, translatedHtmlFields: 1, fallbackTextSegments: 0, ...extra } } });
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

async function ancestryOverviewPair() {
  const f = await itemPair(), p = pagePair(f.source);
  journals.delete("emberCultures000"); journals.set("emberAncestries0", p.original);
  p.original.uuid = "JournalEntry.emberAncestries0";
  p.source.uuid = `${p.original.uuid}.JournalEntryPage.p`;
  p.source.type = p.target.type = "ember.ancestry";
  p.source.system = { ...p.source.system, content: { overview: "<p>Native overview 3.</p>" } } as any;
  p.target.system = { ...p.target.system, content: { overview: "<p>Český přehled 3.</p>" } } as any;
  const sourceData = { name: "Ancestries", pages: [{ _id: p.source.id, name: p.source.name, type: p.source.type, system: p.source.system }] };
  Object.assign(p.original, { toObject: () => sourceData });
  Object.assign(p.translated.flags["foundry-translate"].translation!, { sourceUuid: p.original.uuid, sourceHash: await journalSourceHash(sourceData) });
  f.data.system.description = `<p>Item prose.</p><p>@Embed[${p.source.uuid} overview inline]</p>`;
  identity.resolve.mockImplementation(async uuid => uuid === p.source.uuid
    ? { status: "mapped", sourceUuid: uuid, translatedUuid: p.target.uuid } : { status: "source-only" });
  const summary = `<p>Item prose.</p><document-embed class="inline" data-uuid="${p.source.uuid}" data-action="open"><p style="">Native overview 3.</p></document-embed><p>After.</p>`;
  const option = Object.freeze({ identifier: "arcturian", name: f.source.name, item: f.source, summary });
  return { ...f, ...p, sourceData, summary, option, context: Object.freeze({ ancestry: option, ancestries: Object.freeze([option]) }) };
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
  it("uses a fresh paired overview only inside the exact native source-page embed without an Item copy", async () => {
    const f = await ancestryOverviewPair();
    const result = await translateEmberCreationContext(f.context) as any;
    expect(result.ancestry.summary).toBe(f.summary.replace('<p style="">Native overview 3.</p>', "<p>Český přehled 3.</p>"));
    expect(result.ancestries[0]).toBe(result.ancestry); expect(result.ancestry.item).toBe(f.option.item);
    expect(f.context.ancestry.summary).toBe(f.summary); expect(f.data.system.description).toContain(`@Embed[${f.source.uuid} overview inline]`);
    expect(enrich).toHaveBeenCalledWith("<p>Český přehled 3.</p>", { relativeTo: f.source, secrets: false });
  });
  it("snapshots and hashes a shared ancestry parent once per render and rechecks it once before returning", async () => {
    const f = await ancestryOverviewPair(), hash = vi.spyOn(journal, "journalSourceHash");
    const snapshot = vi.spyOn(f.original as any, "toObject");
    const context = { ancestries: Array.from({ length: 17 }, () => ({ ...f.option })) };
    const first = await translateEmberCreationContext(context) as any;
    expect(first.ancestries.every((option: any) => option.summary.includes("Český přehled 3."))).toBe(true);
    expect(hash).toHaveBeenCalledTimes(1); expect(snapshot).toHaveBeenCalledTimes(2);
    await translateEmberCreationContext(context);
    expect(hash).toHaveBeenCalledTimes(2); expect(snapshot).toHaveBeenCalledTimes(4);
  });
  it("accepts only whitespace in the native empty style attribute", async () => {
    const f = await ancestryOverviewPair();
    const summary = f.summary.replace('style=""', 'style="   "');
    const result = await translateEmberCreationContext({ ancestry: { ...f.option, summary } }) as any;
    expect(result.ancestry.summary).toBe(f.summary.replace('<p style="">Native overview 3.</p>', "<p>Český přehled 3.</p>"));
  });
  it("allows the completed ancestry page in a partial journal and canonicalizes translated links before enrichment", async () => {
    const f = await ancestryOverviewPair();
    const before = '<p>Native @UUID[JournalEntry.other.JournalEntryPage.child]{name} 3.</p>';
    (f.source.system as any).content.overview = before;
    (f.target.system as any).content.overview = '<p>České @UUID[Compendium.world.foundry-translate-translations.JournalEntry.other.JournalEntryPage.child]{jméno} 3.</p>';
    Object.assign(f.translated.flags["foundry-translate"].translation!, { partial: true, processedPageIds: ["p"], sourceHash: await journalSourceHash(f.sourceData) });
    identity.source.mockResolvedValue("JournalEntry.other.JournalEntryPage.child");
    const summary = f.summary.replace('<p style="">Native overview 3.</p>', before);
    const result = await translateEmberCreationContext({ ancestry: { ...f.option, summary } }) as any;
    expect(result.ancestry.summary).toContain('@UUID[JournalEntry.other.JournalEntryPage.child]{jméno}');
    expect(result.ancestry.summary).toContain(`data-uuid="${f.source.uuid}"`);
    expect(enrich).toHaveBeenCalledWith('<p>České @UUID[JournalEntry.other.JournalEntryPage.child]{jméno} 3.</p>', { relativeTo: f.source, secrets: false });
  });
  it.each(["no-embed-command", "full-page-mode", "foreign-embed", "changed-native-prose", "duplicate-embed", "stale-journal", "unprocessed-page", "hidden-parent", "hidden-target", "hidden-target-parent", "changed-structure", "changed-numbers", "preference-off", "foreign-language", "empty-item-identifier", "missing-item-identifier", "translated-source-item", "nonempty-native-style", "other-native-attribute"])("retains native ancestry summary for %s", async reason => {
    const f = await ancestryOverviewPair(); let summary = f.summary, locale = "cs";
    f.translated.flags["foundry-translate"].translation!.fallbackTextSegments = 31;
    if (reason === "no-embed-command") f.data.system.description = "Unrelated Item prose";
    if (reason === "full-page-mode") f.data.system.description = `@Embed[${f.source.uuid} inline]`;
    if (reason === "foreign-embed") summary = summary.replace(f.source.uuid, "JournalEntry.foreign.JournalEntryPage.p");
    if (reason === "changed-native-prose") summary = summary.replace("Native overview", "Different overview");
    if (reason === "duplicate-embed") summary += summary;
    if (reason === "stale-journal") f.sourceData.name = "Changed source journal";
    if (reason === "unprocessed-page") Object.assign(f.translated.flags["foundry-translate"].translation!, { partial: true, processedPageIds: [] });
    if (reason === "hidden-parent") f.original.visible = false;
    if (reason === "hidden-target") f.target.visible = false;
    if (reason === "hidden-target-parent") f.translated.visible = false;
    if (reason === "changed-structure") (f.target.system as any).content.overview = "<p onclick=\"unsafe()\">Český přehled 3.</p>";
    if (reason === "changed-numbers") (f.target.system as any).content.overview = "<p>Český přehled 5.</p>";
    if (reason === "preference-off") preference = false;
    if (reason === "foreign-language") locale = "de";
    if (reason === "empty-item-identifier") f.data.system.identifier = " ";
    if (reason === "missing-item-identifier") delete (f.data.system as any).identifier;
    if (reason === "translated-source-item") identity.identity.mockImplementation(doc => doc === f.option.item ? { targetLanguage: "cs" } : null);
    if (reason === "nonempty-native-style") summary = summary.replace('style=""', 'style="color: red"');
    if (reason === "other-native-attribute") summary = summary.replace('style=""', 'style="" class="unexpected"');
    const result = await translateEmberCreationContext({ ancestry: { ...f.option, summary } }, locale) as any;
    expect(result.ancestry.summary).toBe(summary); expect(enrich).not.toHaveBeenCalled();
  });
  it("uses a valid overview despite unrelated journal fallbacks, including an Item copy that embeds the original page", async () => {
    const f = await ancestryOverviewPair();
    f.translated.flags["foundry-translate"].translation!.fallbackTextSegments = 31;
    const itemTarget = documents.get("Compendium.world.foundry-translate-items.Item.cs");
    itemTarget.system.description = f.data.system.description;
    itemTarget.flags["foundry-translate"].itemTranslation!.sourceHash = await itemSourceHash(f.data);
    const resolve = identity.resolve.getMockImplementation()!;
    identity.resolve.mockImplementation(async (uuid, locale) => uuid === f.option.item.uuid
      ? { status: "mapped", sourceUuid: uuid, translatedUuid: itemTarget.uuid } : resolve(uuid, locale));
    enrich.mockImplementation(async html => html === f.data.system.description ? f.summary : html);
    const result = await translateEmberCreationContext(f.context) as any;
    expect(result.ancestry.summary).toContain("Český přehled 3.");
    expect(result.ancestry.summary).toContain(`data-uuid="${f.source.uuid}"`);
    expect(result.ancestry.item).toBe(f.option.item);
    expect(f.translated.flags["foundry-translate"].translation!.fallbackTextSegments).toBe(31);
  });
  it("supports the native lowercase culture embed without replacing unrelated prose", async () => {
    const f = await ancestryOverviewPair();
    journals.delete("emberAncestries0"); journals.set("emberCultures000", f.original);
    f.source.type = f.target.type = "ember.culture";
    f.data.system.description = f.data.system.description.replace("@Embed[", "@embed[");
    f.translated.flags["foundry-translate"].translation!.sourceHash = await journalSourceHash(f.sourceData);
    const result = await translateEmberCreationContext({ culture: f.option }) as any;
    expect(result.culture.summary).toBe(f.summary.replace('<p style="">Native overview 3.</p>', "<p>Český přehled 3.</p>"));
    expect(f.option.summary).toBe(f.summary);
  });
  it("localizes only Ember's synthesized empty ancestry caption", async () => {
    const f = await ancestryOverviewPair();
    f.source.system.banner.caption = f.target.system.banner.caption = "";
    (game.i18n as any).localize = (key: string) => key.endsWith(".ExampleCharacter") ? "Ukázková postava ({name})." : key;
    const option = { ...f.option, figure: { caption: `An example ${f.option.name} character.`, src: "native.webp" } };
    const result = await translateEmberCreationContext({ ancestry: option }) as any;
    expect(result.ancestry.figure).toEqual({ caption: "Ukázková postava (Arktuřan).", src: "native.webp" });
    const custom = { ...option, figure: { ...option.figure, caption: "Author's caption" } };
    expect((await translateEmberCreationContext({ ancestry: custom }) as any).ancestry.figure.caption).toBe("Author's caption");
  });
  it.each(["source-journal", "source-item", "target-page", "preference", "language", "user"])("discards overview changes when %s changes during enrichment", async reason => {
    const f = await ancestryOverviewPair();
    enrich.mockImplementation(async () => {
      if (reason === "source-journal") f.sourceData.name = "Changed";
      if (reason === "source-item") f.data.system.description = "Changed";
      if (reason === "target-page") (f.target.system as any).content.overview = "Changed";
      if (reason === "preference") preference = false;
      if (reason === "language") targetLanguage = "en";
      if (reason === "user") (game as any).user = {};
      return "<p>Český přehled 3.</p>";
    });
    expect(await translateEmberCreationContext(f.context)).toBe(f.context);
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
  it("integrates the composed attunement with translated presentation while keeping the native Item and selection state", async () => {
    const f = await itemPair(), p = pagePair(f.source);
    journals.delete("emberCultures000"); journals.set("emberCosmos00000", p.original);
    p.original.uuid = "JournalEntry.emberCosmos00000";
    p.source.uuid = `${p.original.uuid}.JournalEntryPage.p`;
    p.source.type = p.target.type = "ember.cosmos";
    p.source.name = "Realm of Air"; p.target.name = "Říše Vzduchu";
    Object.assign(p.source.system, { content: { overview: "<p>Native realm 3.</p>" } });
    Object.assign(p.target.system, { content: { overview: "<p>Česká říše 3.</p>" } });
    const beforeSection = '<section class="block attunement aura"><h4>Ideal</h4><p>Native ideal 2.</p></section>';
    const afterSection = '<section class="block attunement aura"><h4>Ideál</h4><p>Český ideál 2.</p></section>';
    const id = "jc7TEnx3yMnUcILK";
    const lore = { uuid: `${p.original.uuid}.JournalEntryPage.${id}`, id, type: "text", documentName: "JournalEntryPage", visible: true,
      parent: p.original, text: { content: beforeSection } };
    const targetLore = { ...lore, uuid: `${p.translated.uuid}.JournalEntryPage.${id}`, parent: p.translated, text: { content: afterSection } };
    p.original.pages.contents.push(lore);
    const data = { name: "Cosmos", pages: p.original.pages.contents.map(page => ({ _id: page.id, name: page.name, type: page.type, system: page.system, text: page.text })) };
    Object.assign(p.original, { toObject: () => data });
    Object.assign(p.translated.flags["foundry-translate"].translation!, { sourceUuid: p.original.uuid, sourceHash: await journalSourceHash(data), fallbackTextSegments: 55 });
    identity.resolve.mockImplementation(async uuid => ({ status: "mapped", sourceUuid: uuid,
      translatedUuid: uuid === p.source.uuid ? p.target.uuid : uuid === lore.uuid ? targetLore.uuid : f.target.uuid }));
    documents.set(targetLore.uuid, targetLore);
    const summary = `<p>Native realm 3.</p><div class="ember">${beforeSection}</div>`;
    vi.stubGlobal("ember", { CONST: { ATTUNEMENT_IDENTIFIERS: { arcturian: Object.freeze({ identifier: "arcturian", pageUuid: p.source.uuid,
      id: "aura", label: "Air", description: summary }) } } });
    glossary.load.mockResolvedValue([{ source: "Air", replacement: "Vzduch", aliases: [] }]);
    (game.i18n as any).localize = (key: string) => key.endsWith(".Attunement") ? "Naladění" : key;
    const option = Object.freeze({ identifier: "arcturian", item: f.source, name: "Air", title: p.source.name, subtitle: p.source.system.subtitle,
      summary, figure: Object.freeze({ caption: p.source.system.banner.caption, src: "native.webp" }) });
    const state = Object.freeze({ attunementId: "arcturian" });
    const context = { state, attunement: option, tabs: { attunement: { label: "Attunement", selectionLabel: "Air", action: "chooseAttunement" } } };
    const result = await translateEmberCreationContext(context) as any;
    expect(result.attunement).toMatchObject({ item: f.source, identifier: "arcturian", name: "Vzduch", title: "Říše Vzduchu", subtitle: "Kultura",
      summary: `<p>Česká říše 3.</p><div class="ember">${afterSection}</div>`, figure: { caption: "Duše přetrvá.", src: "native.webp" } });
    expect(result.tabs.attunement).toEqual({ label: "Naladění", selectionLabel: "Vzduch", action: "chooseAttunement" });
    expect(result.state).toBe(state); expect(context.attunement).toBe(option); expect(option.summary).toBe(summary);
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

async function equipmentPair() {
  const f = await itemPair();
  f.data.name = f.source.name = "Longsword"; f.data.type = f.source.type = f.target.type = "weapon";
  f.target.name = "Dlouhý Meč";
  f.target.flags["foundry-translate"].itemTranslation!.sourceHash = await itemSourceHash(f.data);
  documents.set(f.source.uuid, f.source);
  const tags = Object.freeze(["One-handed", Object.freeze({ label: "Sword", unmet: true, tooltip: "Needs training" })]);
  const row = Object.freeze({ uuid: f.source.uuid, name: f.source.name, img: "sword.webp", tags,
    scaledPrice: 35, quantity: 2, unaffordable: true });
  const selected = Object.freeze({ ...row, totalCost: 70 });
  const state = Object.freeze({ equipment: Object.freeze({ [f.source.uuid]: Object.freeze({ item: f.source, quantity: 2, scaledPrice: 35 }) }) });
  const context = Object.freeze({ equipmentItems: Object.freeze([row]), equipmentSelected: Object.freeze([selected]), equipmentRemaining: 9, state });
  return { ...f, row, selected, context };
}

describe("native creation equipment captions", () => {
  it("uses a current complete machine receipt for both equipment lists without clearing fallbacks or changing native state", async () => {
    const f = await equipmentPair();
    f.target.flags["foundry-translate"].itemTranslation!.fallbackTextSegments = 1;
    f.target.toObject = () => ({ name: f.target.name, type: f.target.type, system: f.target.system, flags: f.target.flags });
    machine.current.mockResolvedValue(true);
    const result = await translateEmberCreationContext(f.context) as any;
    expect(result.equipmentItems[0].name).toBe("Dlouhý Meč");
    expect(result.equipmentSelected[0].name).toBe("Dlouhý Meč");
    expect(result.state).toBe(f.context.state);
    expect(f.target.flags["foundry-translate"].itemTranslation!.fallbackTextSegments).toBe(1);
    expect(machine.current).toHaveBeenCalledTimes(1);
    expect(machine.current).toHaveBeenCalledWith(f.source, f.target.toObject(), "cs", f.target.uuid);
  });
  it("keeps native equipment captions when complete machine validation fails", async () => {
    const f = await equipmentPair();
    f.target.flags["foundry-translate"].itemTranslation!.fallbackTextSegments = 1;
    f.target.toObject = () => ({ name: f.target.name, type: f.target.type, system: f.target.system, flags: f.target.flags });
    const result = await translateEmberCreationContext(f.context) as any;
    expect(result.equipmentItems[0].name).toBe("Longsword");
    expect(result.equipmentSelected[0].name).toBe("Longsword");
    expect(machine.current).toHaveBeenCalledTimes(1);
  });
  it("requires stored target data before accepting a fallback receipt", async () => {
    const f = await equipmentPair();
    f.target.flags["foundry-translate"].itemTranslation!.fallbackTextSegments = 1;
    delete (f.target as any).toObject;
    machine.current.mockResolvedValue(true);
    const result = await translateEmberCreationContext(f.context) as any;
    expect(result.equipmentItems[0].name).toBe("Longsword");
    expect(machine.current).not.toHaveBeenCalled();
  });
  it.each(["receipt", "history", "mechanics"])("rejects a target whose %s changes during machine validation", async reason => {
    const f = await equipmentPair();
    f.target.flags["foundry-translate"].itemTranslation!.fallbackTextSegments = 1;
    f.target.toObject = () => structuredClone({ name: f.target.name, type: f.target.type, system: f.target.system, flags: f.target.flags });
    machine.current.mockImplementation(async () => {
      if (reason === "receipt") (f.target.flags["foundry-translate"] as any).machineProofreading = { invalidated: true };
      if (reason === "history") (f.target.flags["foundry-translate"] as any).reviewHistory = { operation: { undoneAt: "now" } };
      if (reason === "mechanics") f.target.system.identifier = "changed";
      return true;
    });
    const result = await translateEmberCreationContext(f.context) as any;
    expect(result.equipmentItems[0].name).toBe("Longsword");
    expect(result.equipmentSelected[0].name).toBe("Longsword");
  });
  it("translates available and selected plain records without changing purchase identity, mechanics, tags or native state", async () => {
    const f = await equipmentPair(), resolve = vi.fn(async (uuid: string) => documents.get(uuid) ?? null);
    vi.stubGlobal("fromUuid", resolve);
    const result = await translateEmberCreationContext(f.context) as any;
    expect(result.equipmentItems[0]).toEqual({ ...f.row, name: "Dlouhý Meč" });
    expect(result.equipmentSelected[0]).toEqual({ ...f.selected, name: "Dlouhý Meč" });
    expect(result.equipmentItems[0]).not.toBe(f.row); expect(result.equipmentSelected[0]).not.toBe(f.selected);
    expect(result.equipmentItems[0].tags).toBe(f.row.tags);
    expect(result.state).toBe(f.context.state); expect(result.equipmentRemaining).toBe(9);
    expect(f.row.name).toBe("Longsword"); expect(f.selected.name).toBe("Longsword");
    expect(f.context.state.equipment[f.source.uuid]!.item).toBe(f.source);
    expect(f.source.name).toBe("Longsword"); expect(identity.resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls.filter(([uuid]) => uuid === f.source.uuid)).toHaveLength(1);
    expect(enrich).not.toHaveBeenCalled();
  });
  it.each(["unreadable-source", "unreadable-target", "stale-source", "wrong-source-uuid", "wrong-source-kind", "translated-source",
    "wrong-target-uuid", "wrong-target-kind", "wrong-target-type", "wrong-pair-source", "wrong-flag-source", "foreign-target-language",
    "ambiguous", "partial", "fallback", "missing-source", "resolve-error", "different-row-name", "preference-off", "foreign-render-language"])(
    "keeps native equipment names for %s", async reason => {
      const f = await equipmentPair(); let context: any = f.context, locale = "cs";
      const translation = f.target.flags["foundry-translate"].itemTranslation!;
      if (reason === "unreadable-source") f.source.visible = false;
      if (reason === "unreadable-target") f.target.visible = false;
      if (reason === "stale-source") f.data.system.description = "Changed original";
      if (reason === "wrong-source-uuid") f.source.uuid = "Item.other";
      if (reason === "wrong-source-kind") f.source.documentName = "Actor";
      if (reason === "translated-source") identity.identity.mockImplementation(doc => doc === f.source ? { targetLanguage: "cs" } : null);
      if (reason === "wrong-target-uuid") f.target.uuid = "Item.other";
      if (reason === "wrong-target-kind") f.target.documentName = "Actor";
      if (reason === "wrong-target-type") f.target.type = "talent";
      if (reason === "wrong-pair-source") identity.resolve.mockResolvedValue({ status: "mapped", sourceUuid: "Item.other", translatedUuid: f.target.uuid });
      if (reason === "wrong-flag-source") translation.sourceUuid = "Item.other";
      if (reason === "foreign-target-language") translation.targetLanguage = "de";
      if (reason === "ambiguous") identity.resolve.mockResolvedValue({ status: "ambiguous" });
      if (reason === "partial") Object.assign(translation, { partial: true });
      if (reason === "fallback") translation.fallbackTextSegments = 1;
      if (reason === "missing-source") documents.delete(f.source.uuid);
      if (reason === "resolve-error") vi.stubGlobal("fromUuid", vi.fn(async () => { throw new Error("Unavailable pack"); }));
      if (reason === "different-row-name") context = { equipmentItems: [{ ...f.row, name: "Author caption" }] };
      if (reason === "preference-off") preference = false;
      if (reason === "foreign-render-language") locale = "de";
      const result = await translateEmberCreationContext(context, locale) as any;
      expect(result.equipmentItems).toEqual(context.equipmentItems);
      if (context.equipmentSelected) expect(result.equipmentSelected).toEqual(context.equipmentSelected);
      expect(enrich).not.toHaveBeenCalled();
    });
  it("uses only unambiguous exact whole glossary labels for readable original Items, independently of copy completeness", async () => {
    const f = await equipmentPair(); f.target.flags["foundry-translate"].itemTranslation!.fallbackTextSegments = 1;
    glossary.load.mockResolvedValue([{ source: "Longsword", replacement: "Dlouhý Meč", aliases: [] }]);
    expect((await translateEmberCreationContext(f.context) as any).equipmentItems[0].name).toBe("Dlouhý Meč");
    glossary.load.mockResolvedValue([{ source: "Longsword", replacement: "Dlouhý Meč", aliases: [] }, { source: "Longsword", replacement: "Jiný Meč", aliases: [] }]);
    expect((await translateEmberCreationContext(f.context) as any).equipmentItems[0].name).toBe("Longsword");
    glossary.load.mockResolvedValue([{ source: "Sword", replacement: "Meč", aliases: [] }]);
    expect((await translateEmberCreationContext(f.context) as any).equipmentItems[0].name).toBe("Longsword");
    glossary.load.mockResolvedValue([{ source: "Longsword", replacement: "Dlouhý Meč", aliases: [] }]); f.source.visible = false;
    expect((await translateEmberCreationContext(f.context) as any).equipmentItems[0].name).toBe("Longsword");
  });
  it.each(["source-visibility", "target-visibility", "source-name", "target-name", "source-mechanics", "target-flag", "row-name", "row-uuid", "source-kind", "user", "world", "language", "preference"])(
    "discards equipment overlay if %s changes during lookup", async reason => {
      const f = await equipmentPair(), row = { ...f.row }, context = { equipmentItems: [row] };
      vi.stubGlobal("fromUuid", async (uuid: string) => {
        if (uuid !== f.target.uuid) return documents.get(uuid) ?? null;
        // The target name is pinned before asynchronous source hashing. Mutate
        // after resolution to exercise the final render guards as well.
        queueMicrotask(() => queueMicrotask(() => {
          if (reason === "source-visibility") f.source.visible = false;
          if (reason === "target-visibility") f.target.visible = false;
          if (reason === "source-name") f.source.name = "Other source";
          if (reason === "target-name") f.target.name = "Other target";
          if (reason === "source-mechanics") f.data.system.identifier = "changed";
          if (reason === "target-flag") f.target.flags["foundry-translate"].itemTranslation!.sourceHash = "changed";
          if (reason === "row-name") row.name = "Other caption";
          if (reason === "row-uuid") row.uuid = "Item.other";
          if (reason === "source-kind") f.source.documentName = "Actor";
          if (reason === "user") (game as any).user = {};
          if (reason === "world") (game as any).world = {};
          if (reason === "language") targetLanguage = "de";
          if (reason === "preference") preference = false;
        }));
        return f.target;
      });
      const result = await translateEmberCreationContext(context) as any;
      expect(result.equipmentItems[0].name).toBe(row.name);
    });
  it("leaves unsupported row shapes and unresolved source identities untouched", async () => {
    const f = await equipmentPair(), rows = [null, 7, "Longsword", [], {}, { name: "Longsword" }, { uuid: f.source.uuid },
      { uuid: "JournalEntry.unknown", name: "Longsword" }, { uuid: f.source.uuid, name: 4 }];
    const context = { equipmentItems: rows, equipmentSelected: "custom" };
    const result = await translateEmberCreationContext(context) as any;
    expect(result.equipmentItems).toEqual(rows); expect(result.equipmentSelected).toBe("custom");
    expect(result.equipmentItems.every((row: unknown, index: number) => row === rows[index])).toBe(true);
    expect(identity.resolve).not.toHaveBeenCalled();
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
    const values: Record<string, string> = { Culture: "Kultura", AsterProgression: "Vývoj Asterů", Rarity: "Vzácnost", Lifespan: "Délka Života", Years: "let", RarityUncommon: "Neobvyklý" };
    (game.i18n as any).localize = (key: string) => values[key.replace("FOUNDRY_TRANSLATE.Creation.", "")] ?? key;
    const context = { tabs: { culture: { id: "culture", label: "Culture", action: "chooseCulture" }, custom: { label: "Custom" } },
      aster: { features: [{ label: "Aster Progression", tags: [{ text: "Lifespan: 150 years", id: "lifespan" }, { text: "Rarity: Uncommon" }, { text: "Other: 3" }] }] } };
    const result = await translateEmberCreationContext(context) as any;
    expect(result.tabs.culture).toEqual({ id: "culture", label: "Kultura", action: "chooseCulture" });
    expect(result.tabs.custom).toBe(context.tabs.custom);
    expect(result.aster.features[0]).toEqual({ label: "Vývoj Asterů", tags: [{ text: "Délka Života: 150 let", id: "lifespan" }, { text: "Vzácnost: Neobvyklý" }, { text: "Other: 3" }] });
    expect(context.tabs.culture.label).toBe("Culture");
    const html = '<section class="gameplay-traits option-summary crucible"><div class="step-feature"><h4>Aster Progression</h4><div class="tags"><span class="tag">Lifespan: 150 years</span></div></div></section>';
    const after = await translateEmberCreationFeatureHtml(html, "cs");
    expect(after).toContain("<h4>Vývoj Asterů</h4>"); expect(after).toContain("Délka Života: 150 let");
  });
  it("discards feature label changes after source access or world changes during asynchronous lookup", async () => {
    const f = await talentPair(); const old = identity.resolve.getMockImplementation()!;
    identity.resolve.mockImplementation(async (uuid: string, locale: string) => { const result = await old(uuid, locale); (game as any).world = {}; return result; });
    expect(await translateEmberCreationFeatureHtml(inline(f.source.uuid), "cs")).toBe(inline(f.source.uuid));
  });
  it.each([
    ["Rarity: Rare", "Vzácnost: Vzácný"],
    ["Rarity: Extinct", "Vzácnost: Vyhynulý"],
    ["Lifespan: 450 - 600 years.", "Délka Života: 450 - 600 let."],
    ["Lifespan: 600-800 Years", "Délka Života: 600-800 let"],
    ["Lifespan: 250 - 300 (Immortal Exceptions)", "Délka Života: 250 - 300 (Výjimečně nesmrtelní)"],
    ["Lifespan: Unknown", "Délka Života: Neznámá"],
    ["Lifespan: Varied", "Délka Života: Proměnlivá"],
    ["Lifespan: About 150 years of uncertain origin", "Délka Života: About 150 years of uncertain origin"],
    ["Rarity: Secret category", "Vzácnost: Secret category"],
  ])("localizes supported authored display values and leaves unknown prose alone: %s", async (before, after) => {
    const values: Record<string, string> = { Rarity: "Vzácnost", Lifespan: "Délka Života", RarityRare: "Vzácný", RarityExtinct: "Vyhynulý", Years: "let",
      ImmortalExceptions: "Výjimečně nesmrtelní", UnknownLifespan: "Neznámá", VariedLifespan: "Proměnlivá" };
    (game.i18n as any).localize = (key: string) => values[key.replace("FOUNDRY_TRANSLATE.Creation.", "")] ?? key;
    const context = { ancestry: { features: [{ id: "traits", tags: [{ text: before, native: true }] }] } };
    const result = await translateEmberCreationContext(context) as any;
    expect(result.ancestry.features[0].tags).toEqual([{ text: after, native: true }]);
    expect(context.ancestry.features[0]!.tags[0]!.text).toBe(before);
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
