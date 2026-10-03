import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTranslatedQuestSummaries, translatedQuestSummarySections, type QuestSummaryEnvironment, type QuestSummarySection } from "../src/translation/translated-quest-summaries";
import { resolveTranslationReference } from "../src/translation/document-identity";

vi.mock("../src/translation/document-identity", async original => ({
  ...await original<typeof import("../src/translation/document-identity")>(), resolveTranslationReference: vi.fn(),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function fixture(compendium = false) {
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  const parent = (uuid: string, source?: string): any => ({ uuid, visible: true, documentName: "JournalEntry", flags: source ? {
    "foundry-translate": { translation: { schemaVersion: 1, sourceUuid: source, sourceHash: "hash", providerId: "openai-compatible",
      sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedTextPages: 3, skippedTextPages: 0, partial: false } },
  } : {} });
  const original = parent("JournalEntry.original"), copy = parent(compendium ? "Compendium.world.translations.JournalEntry.copy" : "JournalEntry.copy", original.uuid);
  const page = (id: string, p: any, type: string, system: any, name: string): any => ({ id, uuid: `${p.uuid}.JournalEntryPage.${id}`,
    documentName: "JournalEntryPage", parent: p, type, system, name, visible: true, isOwner: true });
  const quest = page("quest", original, "ember.quest", { questId: "quest-id" }, "A Small Quest");
  const questCopy = page("quest", copy, "ember.quest", { questId: "quest-id" }, "Malý Úkol");
  const event = page("event", original, "ember.questEvent", { eventId: "event-id", overview: "<p>A scout arrives.</p>",
    _source: { eventId: "event-id", questId: "quest-id", outcomes: [{ id: "outcome", label: "Success", next: "next" }] } }, "The Scout");
  const eventCopy = page("event", copy, "ember.questEvent", { eventId: "event-id", overview: "<p>Přichází zvěd.</p>",
    _source: { eventId: "event-id", questId: "quest-id", outcomes: [{ id: "outcome", label: "Úspěch", next: "next" }] } }, "Zvěd");
  const location = page("location", original, "ember.location", { locationId: "location-id", overview: "<p>A quiet valley.</p>" }, "Quiet Valley");
  const locationCopy = page("location", copy, "ember.location", { locationId: "location-id", overview: "<p>Tiché údolí.</p>" }, "Tiché Údolí");
  const step: any = { id: "event-id", page: event.uuid, text: { overview: event.system.overview }, setting: { locations: ["location-id"] } };
  const steps = [step];
  const nativeQuest = { page: quest.uuid, getSteps: () => [...steps] };
  const nativeLocation = { id: "location-id", page: location };
  const runtime: any = { narrative: { quests: { "quest-id": nativeQuest }, events: { "event-id": step } },
    region: { locations: new Map([["location-id", nativeLocation]]) } };
  const docs = new Map([quest, questCopy, event, eventCopy, location, locationCopy].map(p => [p.uuid, p]));
  const pairs = new Map([[event.uuid, eventCopy.uuid], [location.uuid, locationCopy.uuid]]);
  const enrich = vi.fn(async (text: string, _options: any) => text);
  const env: QuestSummaryEnvironment = { resolve: vi.fn(async uuid => docs.get(uuid) ?? null),
    pair: vi.fn(async uuid => ({ sourceUuid: uuid, translatedUuid: pairs.get(uuid) ?? null, status: pairs.has(uuid) ? "mapped" as const : "missing" as const })),
    source: vi.fn(async uuid => uuid), runtime: () => runtime, enrich };
  const link = (p: any) => `<a class="content-link" data-uuid="${p.uuid}" data-type="JournalEntryPage" data-tooltip="native" draggable="true"><i class="fas fa-book"></i>${p.name}</a>`;
  const sections: QuestSummarySection[] = [
    { sectionClass: "overview", content: "<p>Kopie úvodu.</p>" },
    { sectionClass: "events", header: "Event Summary", content: `<ol class="event-summary-list"><li class="event-summary"><h4>${link(event)}</h4><ul class="tags"><li data-event-id="event-id">Active</li></ul><div class="overview">${event.system.overview}</div></li></ol>` },
    { sectionClass: "locations", content: `<dl class="event-location-list"><dt class="event-location">${link(location)}</dt><dd>${location.system.overview}</dd></dl>` },
  ];
  const sheet = { document: questCopy, isView: true };
  return { original, copy, quest, questCopy, event, eventCopy, location, locationCopy, step, steps, nativeQuest, nativeLocation, runtime, docs, pairs, env, enrich, sections, sheet, link };
}
function dom(content: string) { const root = document.createElement("div"); root.innerHTML = content; return root; }
function freeze(value: any) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } }

describe("translated native quest summaries", () => {
  it.each([false, true])("renders event/location prose with exact provenance, retaining source anchors, tags and order (compendium=%s)", async compendium => {
    const f = fixture(compendium), before = JSON.stringify([f.original, f.copy, f.quest, f.event, f.location, f.runtime]);
    for (const page of f.docs.values()) freeze(page);
    freeze(f.step); freeze(f.nativeQuest); freeze(f.nativeLocation); freeze(f.runtime);
    const result = await translatedQuestSummarySections(f.sheet, f.sections, f.env);
    expect(result[0]).toBe(f.sections[0]); expect(f.sections[1]?.content).toContain("A scout arrives");
    const event = dom(result[1]!.content!), place = dom(result[2]!.content!);
    expect(event.querySelector(".overview")?.innerHTML).toBe("<p>Přichází zvěd.</p>");
    expect(place.querySelector("dd")?.innerHTML).toBe("<p>Tiché údolí.</p>");
    expect(event.querySelector("a")?.textContent).toBe("Zvěd"); expect(place.querySelector("a")?.textContent).toBe("Tiché Údolí");
    const beforeAnchor = dom(f.sections[1]!.content!).querySelector("a")!, afterAnchor = event.querySelector("a")!;
    expect([...afterAnchor.attributes].map(a => [a.name, a.value])).toEqual([...beforeAnchor.attributes].map(a => [a.name, a.value]));
    expect(event.querySelector("i")?.outerHTML).toBe(beforeAnchor.querySelector("i")?.outerHTML);
    expect(event.querySelector(".tags")?.outerHTML).toBe(dom(f.sections[1]!.content!).querySelector(".tags")?.outerHTML);
    expect(f.enrich).toHaveBeenCalledWith(f.eventCopy.system.overview, { relativeTo: f.eventCopy, secrets: true });
    expect(f.enrich).toHaveBeenCalledWith(f.locationCopy.system.overview, { relativeTo: f.locationCopy, secrets: true });
    expect(JSON.stringify([f.original, f.copy, f.quest, f.event, f.location, f.runtime])).toBe(before);
  });
  it("is idempotent and reads current copy prose for each native render", async () => {
    const f = fixture(), first = await translatedQuestSummarySections(f.sheet, f.sections, f.env);
    expect(await translatedQuestSummarySections(f.sheet, first, f.env)).toEqual(first);
    f.eventCopy.system.overview = "<p>Zvěd dorazil.</p>";
    expect((await translatedQuestSummarySections(f.sheet, f.sections, f.env))[1]?.content).toContain("Zvěd dorazil");
  });
  it.each(["original", "edit", "hidden-parent", "quest-id", "quest-registry", "unprocessed"])("leaves native sections untouched for invalid containing context: %s", async mode => {
    const f = fixture();
    if (mode === "original") f.sheet.document = f.quest;
    if (mode === "edit") f.sheet.isView = false;
    if (mode === "hidden-parent") f.copy.visible = false;
    if (mode === "quest-id") f.questCopy.system.questId = "different";
    if (mode === "quest-registry") f.nativeQuest.page = "JournalEntry.other.JournalEntryPage.quest";
    if (mode === "unprocessed") { f.copy.flags["foundry-translate"].translation.partial = true; f.copy.flags["foundry-translate"].translation.processedPageIds = []; }
    expect(await translatedQuestSummarySections(f.sheet, f.sections, f.env)).toBe(f.sections);
    expect(f.enrich).not.toHaveBeenCalled();
  });
  it.each(["missing", "wrong-language", "wrong-source", "wrong-type", "hidden-source", "hidden-target", "partial", "mechanics", "event-id", "structure", "commands", "secrets"])("retains an invalid source event card while allowing independent valid locations: %s", async mode => {
    const f = fixture();
    if (mode === "missing") f.docs.delete(f.eventCopy.uuid);
    if (mode === "wrong-language") f.eventCopy.parent = { ...f.copy, flags: { "foundry-translate": { translation: { ...f.copy.flags["foundry-translate"].translation, targetLanguage: "de" } } } };
    if (mode === "wrong-source") f.eventCopy.parent = { ...f.copy, flags: { "foundry-translate": { translation: { ...f.copy.flags["foundry-translate"].translation, sourceUuid: "JournalEntry.unrelated" } } } };
    if (mode === "wrong-type") f.eventCopy.type = "ember.location";
    if (mode === "hidden-source") f.event.visible = false;
    if (mode === "hidden-target") f.eventCopy.visible = false;
    if (mode === "partial") f.eventCopy.parent = { ...f.copy, flags: { "foundry-translate": { translation: { ...f.copy.flags["foundry-translate"].translation, partial: true, processedPageIds: ["location"] } } } };
    if (mode === "mechanics") f.eventCopy.system._source.outcomes[0].next = "unrelated";
    if (mode === "event-id") f.eventCopy.system.eventId = "different";
    if (mode === "structure") f.eventCopy.system.overview = "<h1>Jiná struktura.</h1>";
    if (mode === "commands") f.eventCopy.system.overview = "<p>@UUID[Actor.unrelated]{Nový odkaz}</p>";
    if (mode === "secrets") f.eventCopy.system.overview = '<p class="secret">Utajeno.</p>';
    const result = await translatedQuestSummarySections(f.sheet, f.sections, f.env);
    expect(result[1]).toBe(f.sections[1]); expect(result[2]?.content).toContain("Tiché údolí");
  });
  it("does not match unrelated registry pages by their title or position", async () => {
    const f = fixture(); f.step.page = "JournalEntry.unrelated.JournalEntryPage.event";
    const result = await translatedQuestSummarySections(f.sheet, f.sections, f.env);
    expect(result[1]).toBe(f.sections[1]);
  });
  it("normalizes proven copied references for validation and enriches in the translated page context", async () => {
    const f = fixture();
    f.event.system.overview = "<p>@UUID[Actor.friend]{Friend} arrives.</p>"; f.step.text.overview = f.event.system.overview;
    f.eventCopy.system.overview = "<p>@UUID[Compendium.world.actors.Actor.friend]{Přítel} přichází.</p>";
    f.env.source = vi.fn(async uuid => uuid === "Compendium.world.actors.Actor.friend" ? "Actor.friend" : uuid);
    f.sections[1]!.content = `<ol class="event-summary-list"><li class="event-summary"><h4>${f.link(f.event)}</h4><div class="overview">${f.event.system.overview}</div></li></ol>`;
    await translatedQuestSummarySections(f.sheet, f.sections, f.env);
    expect(f.enrich).toHaveBeenCalledWith(f.eventCopy.system.overview, { relativeTo: f.eventCopy, secrets: true });
  });
  it.each(["page", "quest", "source", "target"])("uses the intersection of all owners for secrets: %s", async who => {
    const f = fixture(); ({ page: f.questCopy, quest: f.quest, source: f.event, target: f.eventCopy } as any)[who].isOwner = false;
    await translatedQuestSummarySections(f.sheet, f.sections, f.env);
    expect(f.enrich).toHaveBeenCalledWith(f.eventCopy.system.overview, { relativeTo: f.eventCopy, secrets: false });
  });
  it.each(["owner", "flag", "source", "target", "registry", "membership"])("falls back after a concurrent context change: %s", async change => {
    const f = fixture();
    f.enrich.mockImplementationOnce(async text => {
      if (change === "owner") f.eventCopy.isOwner = false;
      if (change === "flag") f.copy.flags["foundry-translate"].translation.targetLanguage = "de";
      if (change === "source") f.event.system.overview = "<p>Changed source.</p>";
      if (change === "target") f.eventCopy.system.overview = "<p>Změněný překlad.</p>";
      if (change === "registry") f.runtime.narrative.events["event-id"] = { ...f.step };
      if (change === "membership") f.step.setting.locations = [];
      return text;
    });
    const result = await translatedQuestSummarySections(f.sheet, f.sections, f.env);
    expect(result[1]).toBe(f.sections[1]);
  });
  it("rechecks already rendered cards after later asynchronous work, avoiding stale secret exposure", async () => {
    const f = fixture(); f.enrich.mockImplementation(async text => { if (text.includes("údolí")) f.eventCopy.isOwner = false; return text; });
    expect(await translatedQuestSummarySections(f.sheet, f.sections, f.env)).toBe(f.sections);
  });
  it("retains malformed/unsupported layout and native stale registry text", async () => {
    const f = fixture(); f.sections[1]!.content = f.sections[1]!.content!.replace("class=\"overview\"", "class=\"unsupported\"");
    f.location.system.overview = "<p>New source overview.</p>";
    expect(await translatedQuestSummarySections(f.sheet, f.sections, f.env)).toEqual(f.sections);
  });
  it("does not replace a multi-paragraph source location with a simplified single-paragraph translation", async () => {
    const f = fixture();
    f.location.system.overview = "<p>A quiet valley.</p><p>Two paths meet here.</p>";
    f.sections[2]!.content = `<dl class="event-location-list"><dt class="event-location">${f.link(f.location)}</dt><dd>${f.location.system.overview}</dd></dl>`;
    const result = await translatedQuestSummarySections(f.sheet, f.sections, f.env);
    expect(result[2]).toBe(f.sections[2]); expect(result[1]?.content).toContain("Přichází zvěd");
  });
  it("fails closed on enrichment or mapping errors", async () => {
    const f = fixture(); f.enrich.mockRejectedValue(new Error("enrich unavailable"));
    expect(await translatedQuestSummarySections(f.sheet, f.sections, f.env)).toEqual(f.sections);
  });
  it("wraps the native public sections path once, shared by Sheet and Reader, and localizes only translated view subtitles", async () => {
    const f = fixture(true), native = vi.fn(async () => f.sections), prepare = vi.fn(async () => ({ subtitle: "Quest Overview", unchanged: true }));
    const prototype: any = { _getSections: native, _prepareContext: prepare };
    f.runtime.api = { applications: { EmberQuestOverviewPageSheet: { prototype } } };
    vi.stubGlobal("ember", f.runtime); vi.stubGlobal("game", { modules: new Map([["ember", { active: true }]]), i18n: { localize: () => "Přehled úkolu (Ember)" } });
    vi.stubGlobal("fromUuid", f.env.resolve); vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { enrichHTML: f.enrich } } } });
    vi.mocked(resolveTranslationReference).mockImplementation(f.env.pair);
    registerTranslatedQuestSummaries(); const wrapped = prototype._getSections; registerTranslatedQuestSummaries(); expect(prototype._getSections).toBe(wrapped);
    const result = await prototype._getSections.call(f.sheet, {});
    expect(result[1].content).toContain("Přichází zvěd"); expect(native).toHaveBeenCalledTimes(1);
    expect(await prototype._prepareContext.call(f.sheet, {})).toEqual({ subtitle: "Přehled úkolu (Ember)", unchanged: true });
    expect(await prototype._prepareContext.call({ document: f.quest, isView: true }, {})).toEqual({ subtitle: "Quest Overview", unchanged: true });
    expect(await prototype._getSections.call({ document: f.quest, isView: true }, {})).toBe(f.sections);
  });
});
