import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTranslatedEventEnrichers, translatedEventState, translatedInlineOutcome,
  type EventEnricherEnvironment } from "../src/translation/translated-event-outcomes";
import { registerEmberRuntimeBridge } from "../src/translation/ember-runtime-bridge";
import { resolveTranslationReference } from "../src/translation/document-identity";
import { readerPageHtml } from "../src/reader/content";

vi.mock("../src/translation/document-identity", async original => ({
  ...await original<typeof import("../src/translation/document-identity")>(), resolveTranslationReference: vi.fn(),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function fixture(standalone = true) {
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  const sourceParent = { uuid: "JournalEntry.source", visible: true };
  const targetParent: any = { uuid: "Compendium.world.foundry-translate-translations.JournalEntry.copy", visible: true, flags: {
    "foundry-translate": { translation: { schemaVersion: 1, sourceUuid: sourceParent.uuid, sourceHash: "hash", providerId: "openai-compatible",
      sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedTextPages: 1, skippedTextPages: 0 } },
  } };
  const source: any = { uuid: `${sourceParent.uuid}.JournalEntryPage.event`, id: "event", parent: sourceParent,
    documentName: "JournalEntryPage", visible: true, isOwner: true, name: "Clearing the Rubble", type: "ember.questEvent",
    system: { eventId: "evt", _source: { eventId: "evt", outcomes: [
      { id: "collapsed", label: "Spire Collapsed", summary: "The spire collapses.", choice: standalone ? "" : "group", retry: false },
      { id: "standing", label: "Spire Standing", summary: "The spire stands.", choice: standalone ? "" : "group", retry: true },
    ] } } };
  const page: any = { ...source, uuid: `${targetParent.uuid}.JournalEntryPage.event`, parent: targetParent,
    name: "Odklízení Sutin", system: structuredClone(source.system) };
  Object.assign(page.system._source.outcomes[0], { label: "Zřícená Věž", summary: "Věž se zřítí." });
  Object.assign(page.system._source.outcomes[1], { label: "Stojící Věž", summary: "Věž stojí." });
  const event: any = { id: "evt", page: source.uuid, label: source.name, active: false, complete: true,
    outcomes: Object.fromEntries(source.system._source.outcomes.map((outcome: any) => [outcome.id,
      { ...outcome, text: { summary: outcome.summary }, complete: outcome.id === "collapsed" }])) };
  const contextSourceParent = { uuid: "JournalEntry.context", visible: true };
  const contextParent = { ...targetParent, uuid: "Compendium.world.foundry-translate-translations.JournalEntry.contextCopy",
    flags: structuredClone(targetParent.flags) };
  contextParent.flags["foundry-translate"].translation.sourceUuid = contextSourceParent.uuid;
  const contextSource: any = { documentName: "JournalEntryPage", type: "text", id: "context", name: "Context", visible: true,
    isOwner: true, uuid: `${contextSourceParent.uuid}.JournalEntryPage.context`, parent: contextSourceParent };
  const context: any = { ...contextSource, uuid: `${contextParent.uuid}.JournalEntryPage.context`, parent: contextParent };
  const pages = new Map([source, page, contextSource, context].map(doc => [doc.uuid, doc]));
  const env: EventEnricherEnvironment = { resolve: vi.fn(async uuid => pages.get(uuid) ?? null),
    pair: vi.fn(async uuid => ({ status: "mapped" as const, sourceUuid: uuid,
      translatedUuid: uuid === contextSource.uuid ? context.uuid : page.uuid })),
    source: vi.fn(async uuid => uuid), binding: vi.fn(() => event), event: vi.fn(() => event) };
  const escape = (text: string) => text.replace(/[&<>"]/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const row = (id: string) => {
    const outcome = event.outcomes[id], tag = standalone ? "fieldset" : "div";
    return `<${tag} class="${standalone ? "standalone " : ""}outcome"><label class="checkbox">\n<input type="checkbox" class="event-outcome-checkbox" name="choices" value="${id}" ${outcome.complete ? "checked" : ""}${standalone ? "" : ' data-choice="group"'}>\n${escape(outcome.label)}.\n</label><p class="notes">${escape(outcome.summary)}</p></${tag}>`;
  };
  const inline = (ids = ["collapsed"]) => {
    const element = document.createElement("enriched-content"); element.className = "ember-enricher event-outcome";
    element.innerHTML = `<form class="choices closed" autocomplete="off">${standalone ? ids.map(row).join("")
      : `<fieldset class="choice">${ids.map(row).join("")}</fieldset>`}</form>`;
    return element;
  };
  const state = (outcomeId?: string) => {
    const element = document.createElement("enriched-content"); element.className = "ember-enricher event-state";
    element.innerHTML = `<a class="content-link" data-uuid="${source.uuid}" data-type="JournalEntryPage" data-tooltip-text="Event Completed"><i class="fa-solid fa-check"></i> ${outcomeId ? event.outcomes[outcomeId].label : event.label}</a>`;
    return element;
  };
  return { source, page, event, env, context, contextSource, inline, state, row, pages };
}
const stateMatch = (outcomeId?: string) => [`[[/eventState evt${outcomeId ? ` ${outcomeId}` : ""}]]`, "evt", outcomeId ?? ""];
function summary(node: HTMLElement) { return [...node.querySelectorAll("p.notes")].map(p => p.textContent); }

describe("native inline outcome presentation", () => {
  it.each([true, false])("projects standalone/group labels and summaries without registry or controls writes (%s)", async standalone => {
    const f = fixture(standalone), node = f.inline(["collapsed", "standing"]);
    const before = JSON.stringify([f.source, f.page, f.event]);
    const inputs = [...node.querySelectorAll("input")].map(input => input.outerHTML), form = node.querySelector("form")!.getAttribute("class");
    expect(await translatedInlineOutcome(f.page, node, f.env)).toBe(node);
    expect(summary(node)).toEqual(["Věž se zřítí.", "Věž stojí."]);
    expect(node.querySelectorAll("label")[0]!.textContent?.trim()).toBe("Zřícená Věž.");
    expect(node.querySelectorAll("label")[1]!.textContent?.trim()).toBe("Stojící Věž.");
    expect([...node.querySelectorAll("input")].map(input => input.outerHTML)).toEqual(inputs);
    expect(node.querySelector("form")!.getAttribute("class")).toBe(form);
    expect(JSON.stringify([f.source, f.page, f.event])).toBe(before);
    const rendered = node.outerHTML; await translatedInlineOutcome(f.page, node, f.env); expect(node.outerHTML).toBe(rendered);
  });
  it("allows label-only correction and summary-only correction, and separate widgets with the same ID", async () => {
    const f = fixture(); f.page.system._source.outcomes[0].summary = f.source.system._source.outcomes[0].summary;
    const first = f.inline(), second = f.inline();
    for (const node of [first, second]) {
      await translatedInlineOutcome(f.page, node, f.env);
      expect(summary(node)).toEqual(["The spire collapses."]); expect(node.textContent).toContain("Zřícená Věž.");
    }
    f.page.system._source.outcomes[0].label = f.source.system._source.outcomes[0].label;
    f.page.system._source.outcomes[0].summary = "Věž se zřítí.";
    const third = f.inline(); await translatedInlineOutcome(f.page, third, f.env);
    expect(summary(third)).toEqual(["Věž se zřítí."]); expect(third.textContent).toContain("Spire Collapsed.");
  });
  it("preserves live checkbox properties, native node identity and attached listeners", async () => {
    const f = fixture(), node = f.inline(), input = node.querySelector("input")!, form = node.querySelector("form")!,
      card = node.querySelector("fieldset")!, listener = vi.fn();
    // Live DOM state may differ from HTML attributes. Text projection cannot
    // reset it by replacing the native form subtree.
    input.checked = false; input.disabled = true; input.indeterminate = true;
    input.addEventListener("change", listener);
    await translatedInlineOutcome(f.page, node, f.env);
    expect(node.querySelector("input")).toBe(input); expect(node.querySelector("form")).toBe(form);
    expect(node.querySelector("fieldset")).toBe(card);
    expect([input.checked, input.disabled, input.indeterminate]).toEqual([false, true, true]);
    input.dispatchEvent(new document.defaultView!.Event("change")); expect(listener).toHaveBeenCalledOnce();
    expect(node.textContent).toContain("Zřícená Věž.");
  });
  it("permits label-only translation in an exact empty native notes slot", async () => {
    const f = fixture();
    f.source.system._source.outcomes[0].summary = f.page.system._source.outcomes[0].summary = "";
    f.event.outcomes.collapsed.summary = f.event.outcomes.collapsed.text.summary = "";
    const node = f.inline(); await translatedInlineOutcome(f.page, node, f.env);
    expect(summary(node)).toEqual([""]); expect(node.textContent).toContain("Zřícená Věž.");
  });
  it.each(["duplicate-slot", "duplicate-source-id", "duplicate-copy-id", "unrelated-node", "enriched-notes", "wrong-label", "wrong-native-id", "wrong-event-id", "extra-label-element", "malformed-notes", "empty-label", "hidden-copy", "hidden-source", "hidden-parent", "unprocessed", "original", "ambiguous", "mechanics"])("retains source for %s", async reason => {
    const f = fixture(), node = f.inline();
    if (reason === "duplicate-slot") node.querySelector("form")!.insertAdjacentHTML("beforeend", f.row("collapsed"));
    if (reason === "duplicate-source-id") f.source.system._source.outcomes.push({ ...f.source.system._source.outcomes[0] });
    if (reason === "duplicate-copy-id") f.page.system._source.outcomes.push({ ...f.page.system._source.outcomes[0] });
    if (reason === "unrelated-node") node.classList.remove("event-outcome");
    if (reason === "enriched-notes") node.querySelector("p")!.innerHTML = "<span>The spire collapses.</span>";
    if (reason === "wrong-label") node.querySelector("label")!.append("custom");
    if (reason === "wrong-native-id") f.event.outcomes.collapsed.id = "other";
    if (reason === "wrong-event-id") f.event.id = "other";
    if (reason === "extra-label-element") node.querySelector("label")!.append(document.createElement("i"));
    if (reason === "malformed-notes") node.querySelector("p")!.remove();
    if (reason === "empty-label") f.page.system._source.outcomes[0].label = "   ";
    if (reason === "hidden-copy") f.page.visible = false;
    if (reason === "hidden-source") f.source.visible = false;
    if (reason === "hidden-parent") f.page.parent.visible = false;
    if (reason === "unprocessed") Object.assign(f.page.parent.flags["foundry-translate"].translation, { partial: true, processedPageIds: [] });
    if (reason === "original") f.page.parent.flags = {};
    if (reason === "ambiguous") vi.mocked(f.env.pair).mockResolvedValue({ status: "ambiguous", sourceUuid: f.source.uuid, translatedUuid: null });
    if (reason === "mechanics") f.page.system._source.outcomes[0].retry = true;
    const before = node.outerHTML; await translatedInlineOutcome(f.page, node, f.env); expect(node.outerHTML).toBe(before);
  });
  it.each(["html", "uuid", "roll"])("retains both native label and summary for invalid %s prose", async reason => {
    const f = fixture(), node = f.inline();
    f.page.system._source.outcomes[0].summary += reason === "html" ? " <b>NEW</b>" : reason === "uuid" ? " @UUID[Actor.invented]" : " [[/r 1d20]]";
    const before = node.outerHTML; await translatedInlineOutcome(f.page, node, f.env); expect(node.outerHTML).toBe(before);
  });
  it.each(["copy-before-source", "source-and-copy", "registry", "visibility", "mapping", "node", "checkbox"])("discards an async %s mutation", async reason => {
    const f = fixture(), node = f.inline();
    if (reason === "copy-before-source") vi.mocked(f.env.resolve).mockImplementation(async uuid => {
      f.page.system._source.outcomes[0].summary += "changed"; return f.pages.get(uuid) ?? null;
    });
    else {
      let calls = 0; vi.mocked(f.env.pair).mockImplementation(async uuid => {
        if (++calls === 2) {
          if (reason === "source-and-copy") { f.source.system._source.outcomes[0].retry = true; f.page.system._source.outcomes[0].retry = true; }
          if (reason === "registry") f.event.outcomes.collapsed.complete = false;
          if (reason === "visibility") f.source.parent.visible = false;
          if (reason === "mapping") return { status: "ambiguous", sourceUuid: uuid, translatedUuid: null };
          if (reason === "node") node.dataset.changed = "true", node.querySelector("p")!.textContent = "Changed by another renderer";
          if (reason === "checkbox") node.querySelector("input")!.checked = false;
        }
        return { status: "mapped", sourceUuid: uuid, translatedUuid: f.page.uuid };
      });
    }
    await translatedInlineOutcome(f.page, node, f.env);
    expect(node.textContent).not.toContain("Zřícená Věž"); expect(node.textContent).not.toContain("Věž se zřítí.");
    if (reason === "node") expect(node.textContent).toContain("Changed by another renderer");
    if (reason === "checkbox") expect(node.querySelector("input")!.checked).toBe(false);
  });
});

describe("native eventState text projection", () => {
  it.each([undefined, "collapsed"])("projects exact event/outcome text (%s), retaining native UUID, icon, status and all data", async outcomeId => {
    const f = fixture(), node = f.state(outcomeId), link = node.querySelector("a")!, icon = link.querySelector("i")!;
    const attributes = [...link.attributes].map(a => [a.name, a.value]), before = JSON.stringify([f.source, f.page, f.event, f.context, f.contextSource]);
    expect(await translatedEventState(stateMatch(outcomeId), { relativeTo: f.context }, node, f.env)).toBe(node);
    expect(link.textContent?.trim()).toBe(outcomeId ? "Zřícená Věž" : "Odklízení Sutin");
    expect([...link.attributes].map(a => [a.name, a.value])).toEqual(attributes); expect(link.querySelector("i")).toBe(icon);
    expect(JSON.stringify([f.source, f.page, f.event, f.context, f.contextSource])).toBe(before);
    const rendered = node.outerHTML; await translatedEventState(stateMatch(outcomeId), { relativeTo: f.context }, node, f.env); expect(node.outerHTML).toBe(rendered);
  });
  it.each(["original", "hidden-context", "hidden-context-source", "hidden-context-parent", "hidden-source", "hidden-copy", "hidden-source-parent", "unprocessed-context", "unprocessed-copy", "ambiguous", "ambiguous-context", "source-missing", "target-missing", "wrong-event-id", "wrong-source-event-id", "wrong-copy-event-id", "wrong-source-page", "wrong-native-label", "wrong-anchor-uuid", "mechanics", "duplicate-id", "malformed-outcomes", "wrong-language", "wrong-target-source", "unknown-outcome", "wrong-outcome-id", "wrong-outcome-label", "unexpected-child"])("falls back for %s", async reason => {
    const f = fixture(), outcomeId = reason.includes("outcome") ? "collapsed" : undefined, node = f.state(outcomeId);
    if (reason === "original") f.context.parent.flags = {};
    if (reason === "hidden-context") f.context.visible = false;
    if (reason === "hidden-context-source") f.contextSource.visible = false;
    if (reason === "hidden-context-parent") f.context.parent.visible = false;
    if (reason === "hidden-source") f.source.visible = false;
    if (reason === "hidden-copy") f.page.visible = false;
    if (reason === "hidden-source-parent") f.source.parent.visible = false;
    if (reason === "unprocessed-context") Object.assign(f.context.parent.flags["foundry-translate"].translation, { partial: true, processedPageIds: [] });
    if (reason === "unprocessed-copy") Object.assign(f.page.parent.flags["foundry-translate"].translation, { partial: true, processedPageIds: [] });
    if (reason === "ambiguous" || reason === "ambiguous-context") vi.mocked(f.env.pair).mockImplementation(async uuid => uuid === (reason === "ambiguous" ? f.source.uuid : f.contextSource.uuid)
      ? { status: "ambiguous", sourceUuid: uuid, translatedUuid: null } : { status: "mapped", sourceUuid: uuid, translatedUuid: uuid === f.source.uuid ? f.page.uuid : f.context.uuid });
    if (reason === "source-missing") f.pages.delete(f.source.uuid);
    if (reason === "target-missing") f.pages.delete(f.page.uuid);
    if (reason === "wrong-event-id") f.event.id = "another";
    if (reason === "wrong-source-event-id") f.source.system.eventId = "another";
    if (reason === "wrong-copy-event-id") f.page.system.eventId = "another";
    if (reason === "wrong-source-page") f.event.page = f.contextSource.uuid;
    if (reason === "wrong-native-label") f.event.label = "Custom runtime label";
    if (reason === "wrong-anchor-uuid") node.querySelector("a")!.dataset.uuid = f.page.uuid;
    if (reason === "mechanics") f.page.system._source.outcomes[0].retry = true;
    if (reason === "duplicate-id") f.page.system._source.outcomes.push({ ...f.page.system._source.outcomes[0] });
    if (reason === "malformed-outcomes") f.page.system._source.outcomes = [null];
    if (reason === "wrong-language") f.page.parent.flags["foundry-translate"].translation.targetLanguage = "de";
    if (reason === "wrong-target-source") f.page.parent.flags["foundry-translate"].translation.sourceUuid = "JournalEntry.other";
    if (reason === "unknown-outcome") delete f.event.outcomes.collapsed;
    if (reason === "wrong-outcome-id") f.event.outcomes.collapsed.id = "another";
    if (reason === "wrong-outcome-label") f.event.outcomes.collapsed.label = "Custom outcome label";
    if (reason === "unexpected-child") node.querySelector("a")!.append(document.createElement("span"));
    const before = node.outerHTML; await translatedEventState(stateMatch(outcomeId), { relativeTo: f.context }, node, f.env); expect(node.outerHTML).toBe(before);
  });
  it.each(["context-before-source", "source-during-pair", "source-and-copy", "copy-label", "source-summary", "registry", "permissions", "mapping", "node-before-snapshot", "detached-link"])("discards async %s mutation", async reason => {
    const f = fixture(), node = f.state("collapsed");
    const mutate = () => {
      if (reason === "context-before-source") f.context.name = "changed";
      if (reason === "source-during-pair") f.source.name = f.event.label = "Changed together";
      if (reason === "source-and-copy") f.source.system._source.outcomes[0].retry = f.page.system._source.outcomes[0].retry = true;
      if (reason === "copy-label") f.page.system._source.outcomes[0].label += " changed";
      if (reason === "source-summary") f.source.system._source.outcomes[0].summary += " changed";
      if (reason === "registry") f.event.outcomes.collapsed.complete = false;
      if (reason === "permissions") f.contextSource.isOwner = false;
      if (reason === "node-before-snapshot") node.querySelector("a")!.dataset.changed = "true";
      if (reason === "detached-link") node.innerHTML = node.innerHTML;
    };
    if (["context-before-source", "node-before-snapshot"].includes(reason)) vi.mocked(f.env.resolve).mockImplementation(async uuid => { mutate(); return f.pages.get(uuid) ?? null; });
    else {
      let calls = 0; vi.mocked(f.env.pair).mockImplementation(async uuid => {
        if (++calls === (reason === "source-during-pair" ? 2 : 3)) {
          mutate(); if (reason === "mapping") return { status: "ambiguous", sourceUuid: uuid, translatedUuid: null };
        }
        return { status: "mapped", sourceUuid: uuid, translatedUuid: uuid === f.source.uuid ? f.page.uuid : f.context.uuid };
      });
    }
    await translatedEventState(stateMatch("collapsed"), { relativeTo: f.context }, node, f.env);
    expect(node.textContent?.trim()).toBe("Spire Collapsed");
  });
});

describe("registered Ember enrichers in native and Reader rendering", () => {
  it("registers only exact IDs once, preserving native receiver/match/options and plain-text fallback", async () => {
    const f = fixture(), native = vi.fn(async () => f.inline()), untouched = vi.fn(() => document.createTextNode("other"));
    const entries = [{ id: "emberEventOutcome", enricher: native }, { id: "other", enricher: untouched }];
    registerTranslatedEventEnrichers(entries, f.env); const wrapped = entries[0]!.enricher; registerTranslatedEventEnrichers(entries, f.env);
    expect(entries[0]!.enricher).toBe(wrapped); expect(entries[1]!.enricher).toBe(untouched);
    const match = ["[[/outcome collapsed]]", "collapsed"], options = { relativeTo: f.page }, receiver = {};
    const node = await (wrapped as any).call(receiver, match, options);
    expect(native).toHaveBeenCalledExactlyOnceWith(match, options); expect(native.mock.contexts[0]).toBe(receiver);
    expect(node.textContent).toContain("Zřícená Věž");
    const plain = document.createTextNode("[[/outcome missing]]");
    const missing = [{ id: "emberEventOutcome", enricher: vi.fn(() => plain) }]; registerTranslatedEventEnrichers(missing, f.env);
    expect(await (missing[0]!.enricher as any)(match, options)).toBe(plain);
  });
  it.each([false, true])("uses actual shortcode enrichment in native prose and Reader, before/after section preparation (%s)", async enrichedBeforeSections => {
    const f = fixture(); f.source.system.parent = f.source; f.page.system.parent = f.page; f.source.system.event = f.event;
    const entries: any[] = [{ id: "emberEventOutcome", enricher: vi.fn(async () => f.inline()) },
      { id: "emberEventState", enricher: vi.fn(async () => f.state()) }];
    const enrichHTML = async (html: string, options: any) => {
      for (const [id, regex] of [["emberEventOutcome", /\[\[\/outcome (\w+)\]\]/u], ["emberEventState", /\[\[\/eventState (\w+)\]\]/u]] as const) {
        const match = html.match(regex);
        if (match) html = html.replace(match[0], (await entries.find(entry => entry.id === id).enricher(match, options)).outerHTML);
      }
      return html;
    };
    class Sheet {
      document: any; isView: boolean;
      constructor(config: any = {}) { this.document = config.document; this.isView = config.mode === "view"; }
      async _prepareContext() { return {}; }
      async _preparePartContext(_id: string, context: any) { return { ...context, sections: await this._getSections() }; }
      async _getSections() {
        let content = "<p>[[/outcome collapsed]] [[/eventState evt]]</p>";
        if (enrichedBeforeSections) content = await enrichHTML(content, { relativeTo: this.document });
        return [{ sectionClass: "content", content }, { sectionClass: "outcomes", content: `<form class="choices closed">${f.row("collapsed")}</form>` }];
      }
      async _onRender() {}
    }
    vi.stubGlobal("game", { user: { isGM: true }, modules: new Map([["ember", { active: true }]]), i18n: { localize: (key: string) => key } });
    vi.stubGlobal("CONFIG", { TextEditor: { enrichers: entries }, JournalEntryPage: { dataModels: {} } });
    vi.stubGlobal("ember", { narrative: { events: { evt: f.event }, quests: {} }, api: { applications: { EmberEventPageSheet: { prototype: Sheet.prototype } } } });
    vi.stubGlobal("fromUuid", async (uuid: string) => f.pages.get(uuid) ?? null);
    vi.stubGlobal("fromUuidSync", (uuid: string) => f.pages.get(uuid) ?? null);
    vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { enrichHTML } } } });
    vi.mocked(resolveTranslationReference).mockImplementation(f.env.pair);
    registerEmberRuntimeBridge(); f.page.sheet = new Sheet({ document: f.page, mode: "view" });
    const before = JSON.stringify(f.event), native = await f.page.sheet._getSections();
    const nativeProse = await enrichHTML(native[0].content, { relativeTo: f.page }), reader = await readerPageHtml(f.page, true);
    expect(nativeProse).toContain("Zřícená Věž."); expect(nativeProse).toContain("Věž se zřítí."); expect(nativeProse).toContain("Odklízení Sutin");
    expect(reader).toContain("Zřícená Věž."); expect(reader.match(/Věž se zřítí\./gu)).toHaveLength(2);
    expect(reader).toContain("Odklízení Sutin"); expect(reader).not.toContain("The spire collapses.");
    expect(JSON.stringify(f.event)).toBe(before);
    const original = await enrichHTML("[[/outcome collapsed]] [[/eventState evt]]", { relativeTo: f.source });
    expect(original).toContain("The spire collapses."); expect(original).toContain("Clearing the Rubble");
  });
});
