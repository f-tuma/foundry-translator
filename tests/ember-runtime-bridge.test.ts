import { afterEach, describe, expect, it, vi } from "vitest";
import { bindTranslatedEmberModel, eventMechanics, guardEmberInitializer, resolveEmberBinding } from "../src/translation/ember-runtime-bridge";

function fixture(type = "ember.questEvent") {
  const flag = { "foundry-translate": { translation: { schemaVersion: 1, sourceUuid: "JournalEntry.source", sourceHash: "hash", providerId: "openai-compatible",
    sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedTextPages: 1, skippedTextPages: 0 } } };
  const source: any = { id: "page", uuid: "JournalEntry.source.JournalEntryPage.page", type, parent: { uuid: "JournalEntry.source" } };
  const copy: any = { id: "page", uuid: "Compendium.world.foundry-translate-translations.JournalEntry.copy.JournalEntryPage.page", type,
    parent: { uuid: "Compendium.world.foundry-translate-translations.JournalEntry.copy", flags: flag } };
  const data = { eventId: "event", unique: true, encounter: { tokens: [{ actor: "Actor.npc", number: 2 }] }, outcomes: [{ id: "choice", label: "Accept", summary: "Text", retry: false }], overview: "Original" };
  const event = { id: "event", page: source.uuid, state: { step: 0 }, outcomes: { choice: { id: "choice", custom: true } } };
  source.system = { parent: source, eventId: "event", _source: structuredClone(data), event };
  copy.system = { parent: copy, eventId: "event", _source: structuredClone(data) };
  copy.system._source.overview = "Překlad"; copy.system._source.outcomes[0].label = "Přijmout";
  const runtime = { narrative: { events: { event }, quests: {} }, api: { applications: { EmberEventPageSheet: { prototype: {} } } } };
  const env = { resolve: vi.fn((uuid: string) => uuid === source.uuid ? source : null), runtime: () => runtime };
  return { source, copy, event, runtime, env };
}
afterEach(() => vi.unstubAllGlobals());

describe("Ember translated event identity", () => {
  it.each(["ember.questEvent", "ember.standaloneEvent"])("binds %s to the very same live event with no registration/state writes", type => {
    const f = fixture(type); const before = JSON.stringify(f.runtime);
    for (let i = 0; i < 5; i++) expect(bindTranslatedEmberModel(f.copy.system, f.env).status).toBe("bound");
    expect(f.copy.system.event).toBe(f.event);
    expect(JSON.stringify(f.runtime)).toBe(before);
    expect(f.copy.system._source.overview).toBe("Překlad");
    f.event.state.step = 2; expect(f.copy.system.event.state.step).toBe(2);
  });
  it("follows source event replacement and fails closed after removal", () => {
    const f = fixture(); bindTranslatedEmberModel(f.copy.system, f.env);
    const next = { ...f.event, state: { step: 3 } };
    f.source.system.event = next; f.runtime.narrative.events.event = next;
    expect(f.copy.system.event).toBe(next);
    f.env.resolve.mockReturnValue(null);
    expect(f.copy.system.event).toBeUndefined();
  });
  it.each(["event-id", "rules", "page-type", "registry-page", "registry-identity"])("blocks a mismatched %s", change => {
    const f = fixture();
    if (change === "event-id") f.copy.system.eventId = "another";
    if (change === "rules") f.copy.system._source.encounter.tokens[0].number = 9;
    if (change === "page-type") f.copy.type = "ember.lore";
    if (change === "registry-page") f.event.page = "JournalEntry.other.JournalEntryPage.page";
    if (change === "registry-identity") f.source.system.event = { ...f.event };
    expect(resolveEmberBinding(f.copy.system, f.env).event).toBeUndefined();
  });
  it("rejects translated sources instead of following a cycle", () => {
    const f = fixture(); f.source.parent.flags = f.copy.parent.flags;
    expect(resolveEmberBinding(f.copy.system, f.env).status).toBe("mismatch");
  });
  it("preserves mechanics but permits changes to display text", () => {
    const f = fixture(); expect(eventMechanics(f.source.system._source)).toBe(eventMechanics(f.copy.system._source));
    f.copy.system._source.outcomes[0].retry = true;
    expect(eventMechanics(f.source.system._source)).not.toBe(eventMechanics(f.copy.system._source));
  });
  it("guards initialize and reinitialize idempotently, retaining original behavior", () => {
    const f = fixture(); const destructive = vi.fn(function() { Reflect.deleteProperty(f.event.outcomes, "choice"); return "registered"; });
    const prototype = { initializeEvent: destructive, reinitializeEvent: destructive };
    for (let i = 0; i < 3; i++) for (const method of Object.keys(prototype)) guardEmberInitializer(prototype, method, f.env);
    expect(prototype.initializeEvent.call(f.copy.system)).toBe(f.event);
    expect(prototype.reinitializeEvent.call(f.copy.system)).toBe(f.event);
    expect(destructive).not.toHaveBeenCalled(); expect(f.event.outcomes.choice).toBeDefined();
    expect(prototype.initializeEvent.call(f.source.system)).toBe("registered"); expect(destructive).toHaveBeenCalledTimes(1);
  });
  it("does not register even malformed translation metadata", () => {
    const f = fixture(); f.copy.parent.flags['foundry-translate'].translation = {};
    const fn = vi.fn(); const prototype = { initializeEvent: fn }; guardEmberInitializer(prototype, "initializeEvent", f.env);
    expect(prototype.initializeEvent.call(f.copy.system)).toBeUndefined(); expect(fn).not.toHaveBeenCalled();
  });
  it("does not let assignments replace the source event", () => {
    const f = fixture(); bindTranslatedEmberModel(f.copy.system, f.env);
    f.copy.system.event = { id: "wrong" }; expect(f.copy.system.event).toBe(f.event);
  });
  it("binds quest initialization without replacing labels/page pointers", () => {
    const f = fixture("ember.quest"); f.source.system.questId = f.copy.system.questId = "quest";
    (f.runtime.narrative.quests as any).quest = f.event;
    const original = vi.fn(); const proto = { initializeQuest: original }; guardEmberInitializer(proto, "initializeQuest", f.env);
    expect(proto.initializeQuest.call(f.copy.system)).toBe(f.event);
    expect(original).not.toHaveBeenCalled(); expect(f.event.page).toBe(f.source.uuid);
  });
});

it("localizes outcome labels idempotently without touching IDs, listeners or event state", async () => {
  const { parseHTML } = await import("linkedom");
  const { translateOutcomeLabels } = await import("../src/translation/ember-runtime-bridge");
  const { document } = parseHTML('<html><body><label><input class="event-outcome-checkbox" value="choice" checked><span class="icon"></span> Accept.</label></body></html>');
  const input = document.querySelector("input")!;
  const handler = vi.fn(); input.addEventListener("change", handler);
  const outcomes = [{ id: "choice", label: "Přijmout <Dopis>" }];
  translateOutcomeLabels(document.body, outcomes); const first = document.body.innerHTML;
  translateOutcomeLabels(document.body, outcomes);
  expect(document.body.innerHTML).toBe(first);
  expect(document.querySelector("input")).toBe(input);
  expect(input.value).toBe("choice"); expect(input.hasAttribute("checked")).toBe(true);
  expect(document.querySelector("span.icon")).not.toBeNull();
  expect(document.body.textContent).toContain("Přijmout <Dopis>");
  expect(document.querySelector("Dopis")).toBeNull();
  input.dispatchEvent(new document.defaultView!.Event("change")); expect(handler).toHaveBeenCalledTimes(1);
});

it("blocks stale controls before native handlers and keeps one notice/listener after rerenders", async () => {
  const { parseHTML } = await import("linkedom");
  const { decorateEmberTranslation } = await import("../src/translation/ember-runtime-bridge");
  const f = fixture();
  const { document, HTMLElement, Element, Event } = parseHTML('<html><body><article><button data-action="eventStep">Start</button><a class="inline-roll">Roll</a><input class="event-outcome-checkbox" value="choice"></article></body></html>');
  vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", HTMLElement); vi.stubGlobal("Element", Element);
  vi.stubGlobal("fromUuidSync", f.env.resolve); vi.stubGlobal("ember", f.runtime);
  vi.stubGlobal("game", { i18n: { localize: (key: string) => key } });
  const warn = vi.fn(); vi.stubGlobal("ui", { notifications: { warn } });
  const root = document.querySelector("article")!;
  const sheet = { document: f.copy, element: root };
  const listeners = vi.spyOn(root, "addEventListener");
  decorateEmberTranslation(sheet); decorateEmberTranslation(sheet);
  expect(root.querySelectorAll(".ft-ember-bridge")).toHaveLength(1);
  expect(listeners.mock.calls.filter(([name]) => name === "click")).toHaveLength(1);
  expect(f.copy.system.event).toBe(f.event);
  // Source disappears after rendering: fresh checks block stale UI, too.
  f.env.resolve.mockReturnValue(null);
  const event = new Event("click", { bubbles: true, cancelable: true });
  root.querySelector("button[data-action]")!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true); expect(warn).toHaveBeenCalledTimes(1);
  decorateEmberTranslation(sheet);
  expect(root.querySelector<HTMLButtonElement>("button[data-action]")!.disabled).toBe(true);
  expect(f.copy.system.event).toBeUndefined();
});

it("lets Ember skip an unbound imported quest instead of returning an unusable undefined quest", () => {
  const f = fixture("ember.quest"); f.env.resolve.mockReturnValue(null);
  const original = vi.fn(); const prototype = { initializeQuest: original };
  guardEmberInitializer(prototype, "initializeQuest", f.env);
  expect(() => prototype.initializeQuest.call(f.copy.system)).toThrow("no valid original runtime binding");
  expect(original).not.toHaveBeenCalled();
});
