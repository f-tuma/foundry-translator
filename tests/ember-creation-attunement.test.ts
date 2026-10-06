import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { translateAttunementSummary } from "../src/translation/ember-creation-attunement";

const identity = vi.hoisted(() => ({ source: vi.fn() }));
vi.mock("../src/translation/document-identity", () => ({ resolveSourceReference: identity.source }));
let enrich: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  enrich = vi.fn(async (html: string) => `ENRICHED:${html}`);
  vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { enrichHTML: enrich } } } });
  identity.source.mockImplementation(async (uuid: string) => uuid);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function fixture() {
  const original: any = { id: "cosmos", uuid: "JournalEntry.cosmos", documentName: "JournalEntry", visible: true, pages: { contents: [] } };
  const flag = { schemaVersion: 1, sourceUuid: original.uuid, sourceHash: "current-hash", providerId: "openai-compatible",
    sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-10-06", translatedTextPages: 2, skippedTextPages: 0,
    fallbackTextSegments: 55, partial: false };
  const translated: any = { id: "cs", uuid: "Compendium.world.translations.JournalEntry.cs", documentName: "JournalEntry", visible: true,
    flags: { "foundry-translate": { translation: flag } }, pages: { contents: [] } };
  const source: any = { id: "force", uuid: `${original.uuid}.JournalEntryPage.force`, documentName: "JournalEntryPage",
    parent: original, visible: true, type: "ember.cosmos", system: { identifier: "syntheticForce", content: { overview: "<p>Overview 3.</p>" } } };
  const target: any = { ...source, parent: translated, uuid: `${translated.uuid}.JournalEntryPage.force`,
    system: { identifier: "syntheticForce", content: { overview: "<p>Přehled 3.</p>" } } };
  const lore: any = { id: "jc7TEnx3yMnUcILK", uuid: `${original.uuid}.JournalEntryPage.jc7TEnx3yMnUcILK`, documentName: "JournalEntryPage",
    parent: original, visible: true, type: "ember.lore", text: { content: '<section class="block attunement force"><p>Ideal 4.</p></section>' } };
  const targetLore: any = { ...lore, parent: translated, uuid: `${translated.uuid}.JournalEntryPage.jc7TEnx3yMnUcILK`,
    text: { content: '<section class="block attunement force"><p>Ideál 4.</p></section>' } };
  original.pages.contents = [source, lore]; translated.pages.contents = [target, targetLore];
  const config: any = { identifier: "syntheticForce", id: "force", pageUuid: source.uuid, label: "Not a pairing key", description: "" };
  const native = () => {
    const div = document.createElement("div"); div.innerHTML = lore.text.content;
    config.description = `${source.system.content.overview}<div class="ember">${div.querySelector("section")!.outerHTML}</div>`;
    return `ENRICHED:${config.description}`;
  };
  const summary = native();
  vi.stubGlobal("ember", { CONST: { ATTUNEMENT_IDENTIFIERS: { syntheticForce: config } } });
  const hash = vi.fn(async () => "current-hash"), lookup = vi.fn(async () => targetLore), guards: (() => boolean)[] = [];
  const run = (value = summary, locale = "cs") => translateAttunementSummary(value, source, target, locale, guards, hash, lookup);
  return { original, translated, flag, source, target, lore, targetLore, config, hash, lookup, guards, native, summary, run };
}

describe("render-only Ember attunement description", () => {
  it("composes the two proven fields even with unrelated journal fallbacks and keeps native identities/state unchanged", async () => {
    const f = fixture(); const before = JSON.stringify([f.source.system, f.target.system, f.lore.text, f.targetLore.text, f.config]);
    Object.freeze(f.config);
    expect(await f.run()).toBe('ENRICHED:<p>Přehled 3.</p><div class="ember"><section class="block attunement force"><p>Ideál 4.</p></section></div>');
    expect(JSON.stringify([f.source.system, f.target.system, f.lore.text, f.targetLore.text, f.config])).toBe(before);
    expect(f.hash).toHaveBeenCalledOnce(); expect(f.hash).toHaveBeenCalledWith(f.original);
    expect(f.lookup).toHaveBeenCalledWith(f.lore); expect(f.guards.every(valid => valid())).toBe(true);
    expect(enrich).toHaveBeenNthCalledWith(1, f.config.description, { secrets: false });
    expect(enrich.mock.calls.every(call => !Object.hasOwn(call[1], "relativeTo"))).toBe(true);
  });
  it("uses identifiers, page UUID and short ID rather than labels", async () => {
    const f = fixture(); f.config.label = "Completely unrelated caption";
    expect(await f.run()).not.toBeNull();
  });
  it.each(["identifier", "pageUuid", "id", "source-id", "target-identifier", "target-UUID", "target-type", "source-parent", "wrong-language"])("rejects unproven identity: %s", async reason => {
    const f = fixture();
    if (reason === "identifier") f.config.identifier = "different";
    if (reason === "pageUuid") f.config.pageUuid = "JournalEntry.other.JournalEntryPage.force";
    if (reason === "id") f.config.id = "other";
    if (reason === "source-id") f.source.id = "other";
    if (reason === "target-identifier") f.target.system.identifier = "other";
    if (reason === "target-UUID") f.target.uuid = "JournalEntry.foreign.JournalEntryPage.force";
    if (reason === "target-type") f.target.type = "ember.ancestry";
    if (reason === "source-parent") f.flag.sourceUuid = "JournalEntry.other";
    if (reason === "wrong-language") f.flag.targetLanguage = "de";
    expect(await f.run()).toBeNull(); expect(enrich).not.toHaveBeenCalled();
  });
  it.each(["source", "target", "original", "translated", "lore", "targetLore"])("keeps native prose when %s is unreadable", async name => {
    const f = fixture(); (f as any)[name].visible = false;
    expect(await f.run()).toBeNull();
  });
  it.each(["missing", "duplicate", "target-duplicate", "wrong-target-class", "wrong-target-parent", "foreign-source-page"])("rejects ambiguous/unpaired section: %s", async reason => {
    const f = fixture();
    if (reason === "missing") f.original.pages.contents = [f.source];
    if (reason === "duplicate") f.lore.text.content += f.lore.text.content;
    if (reason === "target-duplicate") f.targetLore.text.content += f.targetLore.text.content;
    if (reason === "wrong-target-class") f.targetLore.text.content = f.targetLore.text.content.replace("attunement force", "attunement other");
    if (reason === "wrong-target-parent") f.targetLore.parent = { ...f.translated };
    if (reason === "foreign-source-page") f.lore.uuid = "JournalEntry.other.JournalEntryPage.jc7TEnx3yMnUcILK";
    expect(await f.run()).toBeNull();
  });
  it.each(["source-only", "lore-only", "both"])("allows only both processed pages in a fresh partial-journal render: %s", async coverage => {
    const f = fixture(); f.flag.partial = true;
    Object.assign(f.flag, { processedPageIds: coverage === "both" ? [f.source.id, f.lore.id]
      : [coverage === "source-only" ? f.source.id : f.lore.id] });
    if (coverage === "both") expect(await f.run()).not.toBeNull();
    else expect(await f.run()).toBeNull();
  });
  it("requires the current parent hash and exactly enriched whole native summary", async () => {
    const f = fixture(); f.hash.mockResolvedValue("stale");
    expect(await f.run()).toBeNull(); expect(enrich).not.toHaveBeenCalled();
    f.hash.mockResolvedValue("current-hash");
    expect(await f.run("Item description instead")).toBeNull();
    expect(await f.run(f.config.description)).toBeNull();
    f.config.description = "Unrelated config prose";
    expect(await f.run()).toBeNull();
  });
  it.each(["overview-structure", "section-structure", "overview-number", "section-number", "overview-command", "section-command"])("keeps native prose on unsafe %s changes", async reason => {
    const f = fixture();
    if (reason === "overview-structure") f.target.system.content.overview = '<p onclick="unsafe()">Přehled 3.</p>';
    if (reason === "section-structure") f.targetLore.text.content = f.targetLore.text.content.replace('<p>', '<p class="new">');
    if (reason === "overview-number") f.target.system.content.overview = "<p>Přehled 5.</p>";
    if (reason === "section-number") f.targetLore.text.content = f.targetLore.text.content.replace("4", "8");
    if (reason === "overview-command") f.target.system.content.overview = "<p>Přehled 3. [[/roll 1d6]]</p>";
    if (reason === "section-command") f.targetLore.text.content = f.targetLore.text.content.replace("Ideál 4.", "Ideál 4. [[/roll 1d6]]");
    expect(await f.run()).toBeNull();
  });
  it("canonicalizes translated reference targets separately for each source field, preserving anchors and syntax", async () => {
    const f = fixture();
    const sourceRef = '@UUID[JournalEntry.other.JournalEntryPage.child#target]{source}';
    const targetRef = '@UUID[Compendium.world.translations.JournalEntry.other.JournalEntryPage.child#target]{český}';
    f.source.system.content.overview = `<p>Overview 3. ${sourceRef}</p>`;
    f.target.system.content.overview = `<p>Přehled 3. ${targetRef}</p>`;
    f.lore.text.content = f.lore.text.content.replace("Ideal 4.", `Ideal 4. ${sourceRef}`);
    f.targetLore.text.content = f.targetLore.text.content.replace("Ideál 4.", `Ideál 4. ${targetRef}`);
    identity.source.mockImplementation(async uuid => uuid.replace("Compendium.world.translations.JournalEntry.other", "JournalEntry.other"));
    const result = await f.run(f.native());
    expect(result?.match(/@UUID\[JournalEntry\.other\.JournalEntryPage\.child#target\]\{český\}/gu)).toHaveLength(2);
    expect(result).not.toContain("Compendium.world.translations.JournalEntry.other");
  });
  it.each(["source", "target", "lore", "targetLore", "config", "config-instance", "flag", "access", "parent-page-set"])("discards overlay on asynchronous %s changes", async reason => {
    const f = fixture(); let count = 0;
    enrich.mockImplementation(async html => {
      if (++count === 2) {
        if (reason === "source") f.source.system.content.overview = "Changed";
        if (reason === "target") f.target.system.content.overview = "Changed";
        if (reason === "lore") f.lore.text.content = "Changed";
        if (reason === "targetLore") f.targetLore.text.content = "Changed";
        if (reason === "config") f.config.description = "Changed";
        if (reason === "config-instance") (globalThis as any).ember.CONST.ATTUNEMENT_IDENTIFIERS.syntheticForce = { ...f.config };
        if (reason === "flag") f.flag.sourceHash = "Changed";
        if (reason === "access") f.original.visible = false;
        if (reason === "parent-page-set") f.original.pages.contents = [f.source];
      }
      return `ENRICHED:${html}`;
    });
    expect(await f.run()).toBeNull(); expect(f.guards.every(valid => valid())).toBe(false);
  });
  it("honors caller runtime guards and supports their source-hash recheck", async () => {
    const f = fixture(); let runtimeCurrent = true;
    f.guards.push(() => runtimeCurrent);
    f.hash.mockImplementation(async () => { f.guards.push(() => f.original.otherSourceField !== "changed"); return "current-hash"; });
    enrich.mockImplementation(async html => { if (html.startsWith("<p>Přehled")) runtimeCurrent = false; return `ENRICHED:${html}`; });
    expect(await f.run()).toBeNull();
  });
  it("turns lookup/enrichment failures into a native fallback", async () => {
    const f = fixture(); f.lookup.mockRejectedValue(new Error("unavailable"));
    expect(await f.run()).toBeNull();
    f.lookup.mockResolvedValue(f.targetLore); enrich.mockRejectedValue(new Error("unavailable"));
    expect(await f.run()).toBeNull();
  });
});
