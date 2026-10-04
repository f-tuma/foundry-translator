import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translatedOutcomeSections, type OutcomeEnvironment, type OutcomeSection } from "../src/translation/translated-event-outcomes";
import { registerEmberRuntimeBridge } from "../src/translation/ember-runtime-bridge";
import { resolveTranslationReference } from "../src/translation/document-identity";
import { readerPageHtml } from "../src/reader/content";

vi.mock("../src/translation/document-identity", async original => ({
  ...await original<typeof import("../src/translation/document-identity")>(), resolveTranslationReference: vi.fn(), resolveSourceReference: vi.fn(),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function fixture(standalone = false) {
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  const parent = { uuid: "JournalEntry.source", visible: true };
  const targetParent: any = { uuid: "Compendium.world.foundry-translate-translations.JournalEntry.copy", visible: true, flags: {
    "foundry-translate": { translation: { schemaVersion: 1, sourceUuid: parent.uuid, sourceHash: "hash", providerId: "openai-compatible",
      sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedTextPages: 1, skippedTextPages: 0 } },
  } };
  const source: any = { uuid: `${parent.uuid}.JournalEntryPage.event`, id: "event", parent, visible: true, isOwner: true,
    documentName: "JournalEntryPage", type: "ember.questEvent", system: { eventId: "evt", _source: {eventId: "evt", outcomes: [
      { id: "choice", label: "Accept", summary: "A warm meal awaits.", retry: false },
      { id: "refuse", label: "Refuse", summary: "They leave.", retry: true },
    ]} } };
  const page: any = { ...source, uuid: `${targetParent.uuid}.JournalEntryPage.event`, parent: targetParent, system: structuredClone(source.system) };
  page.system._source.outcomes[0].label = "Přijmout"; page.system._source.outcomes[0].summary = "Čeká je teplé jídlo.";
  page.system._source.outcomes[1].label = "Odmítnout"; page.system._source.outcomes[1].summary = "Odejdou.";
  const event: any = { id: "evt", page: source.uuid, state: { complete: false }, outcomes: Object.fromEntries(source.system._source.outcomes.map((o: any) => [o.id,
    { ...o, text: { summary: o.summary }, complete: o.id === "choice" }])) };
  const canonical = event.outcomes.choice;
  Object.defineProperty(canonical, "summary", { configurable: true, get: () => canonical.text.summary });
  const env: OutcomeEnvironment = { resolve: vi.fn(async uuid => uuid === source.uuid ? source : null),
    pair: vi.fn(async uuid => ({ status: "mapped" as const, sourceUuid: uuid, translatedUuid: page.uuid })),
    source: vi.fn(async uuid => uuid), binding: vi.fn(() => event) };
  const row = (id: string, summary: string) => `<${standalone ? 'fieldset class="standalone outcome"' : 'div class="outcome"'}><label class="checkbox"><input class="event-outcome-checkbox" value="${id}" name="choices" checked data-choice="group"><i class="icon"></i> Accept.</label><p class="notes">${summary}</p></${standalone ? "fieldset" : "div"}>`;
  const sections: OutcomeSection[] = [{ sectionClass: "overview", content: "<p>Overview</p>" }, { sectionClass: "outcomes", header: "Event Outcomes",
    content: `<form class="choices open">${row("choice", source.system._source.outcomes[0].summary)}${row("refuse", source.system._source.outcomes[1].summary)}</form>` }];
  return { source, page, event, env, sections, sheet: { document: page, isView: true }, canonical, row };
}
function dom(html: string) { const root = document.createElement("div"); root.innerHTML = html; return root; }

describe("translated event outcome summaries", () => {
  it.each([false, true])("uses exact IDs in grouped/standalone native slots, preserving controls and all canonical data (standalone=%s)", async standalone => {
    const f = fixture(standalone), before = JSON.stringify([f.source, f.page, f.event, f.sections]);
    const result = await translatedOutcomeSections(f.sheet, f.sections, f.env);
    expect(result[0]).toBe(f.sections[0]);
    const root = dom(result[1]!.content!);
    expect([...root.querySelectorAll("p.notes")].map(p => p.textContent)).toEqual(["Čeká je teplé jídlo.", "Odejdou."]);
    expect(root.querySelector("input")!.outerHTML).toBe(dom(f.sections[1]!.content!).querySelector("input")!.outerHTML);
    expect(root.querySelector("label")!.outerHTML).toBe(dom(f.sections[1]!.content!).querySelector("label")!.outerHTML);
    expect(root.querySelector("i")!.outerHTML).toBe('<i class="icon"></i>');
    expect(JSON.stringify([f.source, f.page, f.event, f.sections])).toBe(before);
    expect(await translatedOutcomeSections(f.sheet, result, f.env)).toEqual(result);
  });
  it.each(["edit", "original", "hidden-copy", "hidden-source", "hidden-parent", "unprocessed", "wrong-source", "ambiguous-pair", "mechanics", "duplicate-id", "registry-page"])("falls back for %s", async reason => {
    const f = fixture();
    if (reason === "edit") f.sheet.isView = false;
    if (reason === "original") f.page.parent.flags = {};
    if (reason === "hidden-copy") f.page.visible = false;
    if (reason === "hidden-source") f.source.visible = false;
    if (reason === "hidden-parent") f.source.parent.visible = false;
    if (reason === "unprocessed") Object.assign(f.page.parent.flags['foundry-translate'].translation, {partial: true, processedPageIds: []});
    if (reason === "wrong-source") f.source.uuid = "JournalEntry.other.JournalEntryPage.event";
    if (reason === "ambiguous-pair") vi.mocked(f.env.pair).mockResolvedValue({status: "ambiguous", sourceUuid: f.source.uuid, translatedUuid: null});
    if (reason === "mechanics") f.page.system._source.outcomes[0].retry = true;
    if (reason === "duplicate-id") f.page.system._source.outcomes.push({...f.page.system._source.outcomes[0]});
    if (reason === "registry-page") f.event.page = "JournalEntry.other.JournalEntryPage.event";
    expect(await translatedOutcomeSections(f.sheet, f.sections, f.env)).toBe(f.sections);
  });
  it.each(["uuid", "roll", "html", "native-text", "custom-outcome", "duplicate-slot", "enriched-slot"])("keeps an invalid %s summary while translating another valid outcome", async reason => {
    const f = fixture();
    if (reason === "uuid") f.page.system._source.outcomes[0].summary += " @UUID[Actor.invented]";
    if (reason === "roll") f.page.system._source.outcomes[0].summary += " [[/r 1d20]]";
    if (reason === "html") f.page.system._source.outcomes[0].summary += " <b>NEW</b>";
    if (reason === "native-text") f.canonical.text.summary = "Changed since source creation";
    if (reason === "custom-outcome") f.canonical.id = "different";
    if (reason === "duplicate-slot") f.sections[1]!.content = f.sections[1]!.content!.replace("</form>", `${f.row("choice", "A warm meal awaits.")}</form>`);
    if (reason === "enriched-slot") f.sections[1]!.content = f.sections[1]!.content!.replace("A warm meal awaits.", "<span>A warm meal awaits.</span>");
    const result = await translatedOutcomeSections(f.sheet, f.sections, f.env), root = dom(result[1]!.content!);
    expect(root.querySelector("p.notes")!.textContent).toBe("A warm meal awaits.");
    expect(root.textContent).toContain("Odejdou.");
  });
  it.each(["source-text", "translation-text", "permissions", "registry", "mapping"])("discards results when %s changes across awaited reference validation", async reason => {
    const f = fixture();
    for (const o of [f.source.system._source.outcomes[0], f.page.system._source.outcomes[0]]) o.summary += " @UUID[Actor.scout]{Scout}";
    f.canonical.text.summary = f.source.system._source.outcomes[0].summary;
    f.sections[1]!.content = f.sections[1]!.content!.replace("A warm meal awaits.", f.canonical.summary);
    vi.mocked(f.env.source).mockImplementation(async uuid => {
      if (reason === "source-text") f.source.system._source.outcomes[0].summary += "changed";
      if (reason === "translation-text") f.page.system._source.outcomes[0].summary += "changed";
      if (reason === "permissions") f.source.visible = false;
      if (reason === "registry") vi.mocked(f.env.binding).mockReturnValue({...f.event});
      if (reason === "mapping") vi.mocked(f.env.pair).mockResolvedValue({status: "ambiguous", sourceUuid: f.source.uuid, translatedUuid: null});
      return uuid;
    });
    expect(await translatedOutcomeSections(f.sheet, f.sections, f.env)).toBe(f.sections);
  });
  it("permits translated reference captions while retaining the exact original command", async () => {
    const f = fixture();
    f.source.system._source.outcomes[0].summary += " @UUID[Actor.scout]{Scout}";
    f.page.system._source.outcomes[0].summary += " @UUID[Actor.scout]{Zvěd}";
    f.canonical.text.summary = f.source.system._source.outcomes[0].summary;
    f.sections[1]!.content = f.sections[1]!.content!.replace("A warm meal awaits.", f.canonical.summary);
    expect((await translatedOutcomeSections(f.sheet, f.sections, f.env))[1]!.content).toContain("Čeká je teplé jídlo. @UUID[Actor.scout]{Zvěd}");
  });
  it("keeps unexpected empty source summaries rather than replacing native fallback notices", async () => {
    const f = fixture(); f.source.system._source.outcomes[0].summary = ""; f.canonical.text.summary = "";
    expect(dom((await translatedOutcomeSections(f.sheet, f.sections, f.env))[1]!.content!).querySelector("p.notes")!.textContent).toBe("A warm meal awaits.");
  });
  it("installs the shared native section adapter idempotently, leaving edit/original sections unchanged", async () => {
    const f = fixture();
    const original = vi.fn(async () => f.sections);
    const prototype: any = { _prepareContext: vi.fn(), _getSections: original, _onRender: vi.fn() };
    vi.stubGlobal("game", { modules: new Map([["ember", {active: true}]]) });
    vi.stubGlobal("CONFIG", { JournalEntryPage: {dataModels:{}} });
    vi.stubGlobal("ember", {api:{applications:{EmberEventPageSheet:{prototype}}}});
    registerEmberRuntimeBridge(); const wrapped = prototype._getSections; registerEmberRuntimeBridge();
    expect(prototype._getSections).toBe(wrapped);
    const result = await prototype._getSections.call({ document: f.source, isView: true });
    expect(result).toBe(f.sections); expect(original).toHaveBeenCalledTimes(1);
  });
  it("uses the same validated summaries in native sheets and the Reader without changing live outcome state", async () => {
    const f = fixture();
    f.source.system.parent = f.source; f.page.system.parent = f.page; f.source.system.event = f.event;
    class Sheet {
      document: any; isView: boolean;
      constructor(config: any = {}) { this.document = config.document; this.isView = config.mode === "view"; }
      async _prepareContext() { return {}; }
      async _preparePartContext(_id: string, context: any) { return { ...context, sections: await this._getSections() }; }
      async _getSections() { return f.sections; }
      async _onRender() {}
    }
    vi.stubGlobal("game", { user: {isGM: true}, modules: new Map([["ember", {active: true}]]), i18n: {localize: (key: string) => key} });
    vi.stubGlobal("CONFIG", { JournalEntryPage: {dataModels:{}} });
    vi.stubGlobal("ember", {narrative: {events: {evt: f.event}, quests: {}}, api:{applications:{EmberEventPageSheet:{prototype: Sheet.prototype}}}});
    vi.stubGlobal("fromUuid", async (uuid: string) => uuid === f.source.uuid ? f.source : null);
    vi.stubGlobal("fromUuidSync", (uuid: string) => uuid === f.source.uuid ? f.source : null);
    vi.stubGlobal("foundry", {applications:{ux:{TextEditor:{enrichHTML: async (html: string) => html}}}});
    vi.mocked(resolveTranslationReference).mockResolvedValue({status:"mapped", sourceUuid:f.source.uuid, translatedUuid:f.page.uuid});
    const before = JSON.stringify(f.event);
    registerEmberRuntimeBridge();
    f.page.sheet = new Sheet({document: f.page, mode: "view"});
    const native = await f.page.sheet._getSections();
    const reader = await readerPageHtml(f.page, true);
    expect(native[1].content).toContain("Čeká je teplé jídlo.");
    expect(reader).toContain("Čeká je teplé jídlo."); expect(reader).toContain("Odejdou.");
    expect(reader).toContain("Přijmout."); expect(reader).not.toContain("A warm meal awaits.");
    expect(JSON.stringify(f.event)).toBe(before);
    expect(f.event.outcomes.choice.complete).toBe(true);
    expect(f.page.system.event).toBe(f.event);
  });
});
