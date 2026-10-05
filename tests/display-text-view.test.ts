import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MODULE_ID } from "../src/constants";
import { DISPLAY_TEXT_PACK, readDisplayTextFlag, translateDisplayText } from "../src/translation/display-text";
import type { DisplayDocument } from "../src/translation/display-text";
import { GlossaryCompendiumRepository } from "../src/glossary/compendium-repository";
import { applyCanvasDisplayText, applyDisplayLabels, lookupDisplayText, registerEffectCards, reloadDisplayTexts } from "../src/translation/display-text-view";

vi.mock("../src/translation/journal-service", () => ({ JournalTranslationService: class {} }));
vi.mock("../src/settings/settings", async original => ({ ...await original<object>(), getTranslatorSettings: () => ({ targetLanguage: "cs" }) }));
let docs: Map<string, DisplayDocument>;
let stored: Map<string, any>;
let packs: Map<string, any>;
beforeEach(async () => {
  const { document, HTMLElement } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", HTMLElement);
  docs = new Map(); stored = new Map(); packs = new Map();
  packs.set(DISPLAY_TEXT_PACK, { async getIndex() { return new Map([...stored].map(([id, data]) => [id, { _id: id, flags: data.flags }])); },
    async getDocument(id: string) { const data = stored.get(id); return data ? { flags: data.flags, toObject: () => structuredClone(data) } : null; } });
  vi.stubGlobal("game", { user: { isGM: true }, system: { id: "crucible" }, packs, settings: { get: () => true } });
  vi.stubGlobal("fromUuid", async (uuid: string) => docs.get(uuid) ?? null);
  await reloadDisplayTexts();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function seed(kind: "Scene" | "ActiveEffect", source: Record<string, any>) {
  const uuid = `${kind}.source1234567890`;
  const doc: DisplayDocument = { uuid, id: "source1234567890", documentName: kind, name: source.name, toObject: () => structuredClone(source) };
  docs.set(uuid, doc);
  const data = await translateDisplayText({ source, sourceUuid: uuid, kind, glossary: [], glossaryHash: "g", providerHash: "p",
    settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
    provider: { async testConnection() {}, async translate({ texts }) { return texts.map(text => ({ translatedText: text.replaceAll("English", "Český") })); } } });
  stored.set(uuid, data);
  await reloadDisplayTexts();
  return { doc, data };
}
it("rerenders idempotently while retaining native handlers, UUIDs, icons and form values", async () => {
  const source = { name: "English Scene" };
  const { doc } = await seed("Scene", source);
  document.body.innerHTML = `<div id="scenes"><div data-entry-id="${doc.id}"><a class="entry-name">English Scene</a></div></div>
    <a class="content-link" data-uuid="${doc.uuid}"><i class="icon"></i>English Scene</a><input value="English Scene">`;
  const link = document.querySelector("a.content-link")!;
  const icon = link.querySelector("i"), click = vi.fn(); link.addEventListener("click", click);
  await applyDisplayLabels(document.body); await applyDisplayLabels(document.body);
  expect(link.textContent).toBe("Český Scene");
  expect(document.querySelector(".entry-name")!.textContent).toBe("Český Scene");
  expect(link.querySelector("i")).toBe(icon);
  expect(link.getAttribute("data-uuid")).toBe(doc.uuid);
  expect(document.querySelector("input")!.value).toBe("English Scene");
  link.dispatchEvent(new document.defaultView!.Event("click")); expect(click).toHaveBeenCalledTimes(1);
  stored.clear(); await reloadDisplayTexts();
  expect(link.textContent).toBe("English Scene");
});
it("matches embedded text by ID and does not touch drawing edit buffers or scene data", async () => {
  const source = { name: "English Scene", drawings: [{ _id: "drawing123456789", text: "English Gate", x: 5 }] };
  const { doc } = await seed("Scene", source);
  const object = { document: { uuid: `${doc.uuid}.Drawing.drawing123456789`, id: "drawing123456789", documentName: "Drawing", text: "English Gate", parent: doc }, text: { text: "English Gate" } };
  const before = JSON.stringify(source);
  applyCanvasDisplayText(object); applyCanvasDisplayText(object);
  expect(object.text.text).toBe("Český Gate");
  expect(JSON.stringify(source)).toBe(before);
  const editing = { ...object, _pendingText: "User typing", text: { text: "User typing" } };
  applyCanvasDisplayText(editing);
  expect(editing.text.text).toBe("User typing");
  expect(lookupDisplayText(doc, ["drawings", "drawing123456789", "text"])).toBe("Český Gate");
  source.drawings[0]!.text = "Changed Gate";
  expect(lookupDisplayText(doc, ["drawings", "drawing123456789", "text"])).toBeNull();
  applyCanvasDisplayText(object);
  expect(object.text.text).toBe("English Gate");
});
it("rejects duplicate records and clears stale labels if compendium access fails", async () => {
  const { doc, data } = await seed("Scene", { name: "English Scene" });
  stored.set("duplicate", data); await reloadDisplayTexts();
  expect(lookupDisplayText(doc, ["name"])).toBeNull();
  stored.delete("duplicate"); await reloadDisplayTexts();
  expect(lookupDisplayText(doc, ["name"])).toBe("Český Scene");
  packs.get(DISPLAY_TEXT_PACK).getIndex = async () => { throw new Error("No access"); };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await reloadDisplayTexts();
  expect(lookupDisplayText(doc, ["name"])).toBeNull(); warn.mockRestore();
});
it("translates Crucible card prose without modifying effect tags, mechanics or the source", async () => {
  const source = { name: "English Blessing", description: "<p>English protection.</p>", duration: { seconds: 30 } };
  const { doc } = await seed("ActiveEffect", source);
  const original = vi.fn(async () => '<div class="action" data-effect-id="id"><header class="action-header"><h4>English Blessing</h4><span class="tag">30 seconds</span></header><div class="description"><p>English protection.</p></div></div>');
  const prototype = { renderCard: original };
  vi.stubGlobal("CONFIG", { ActiveEffect: { documentClass: { prototype } } });
  vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { implementation: { enrichHTML: async (html: string) => html } } } } });
  registerEffectCards(); registerEffectCards();
  const html = await prototype.renderCard.call(doc);
  expect(html).toContain("Český Blessing"); expect(html).toContain("Český protection.");
  expect(html).toContain('<span class="tag">30 seconds</span>');
  expect(original).toHaveBeenCalledTimes(1);
  expect(source).toEqual({ name: "English Blessing", description: "<p>English protection.</p>", duration: { seconds: 30 } });
});

it("uses explicit parent identity for effects inside translated Actor copies", async () => {
  const source = { name: "English Blessing" };
  const { doc, data } = await seed("ActiveEffect", source);
  readDisplayTextFlag(data.flags)!.sourceUuid = "Actor.hero.ActiveEffect.effect1";
  await reloadDisplayTexts();
  const parent = { id: "copy", uuid: "Compendium.world.foundry-translate-actors.Actor.copy", flags: {
    [MODULE_ID]: { actorTranslation: { schemaVersion: 1, sourceUuid: "Actor.hero", sourceHash: "hash", providerId: "openai-compatible",
      sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedHtmlFields: 1, fallbackTextSegments: 0 } },
  } };
  const copy = { ...doc, uuid: `${parent.uuid}.ActiveEffect.effect1`, parent };
  expect(lookupDisplayText(copy, ["name"])).toBe("Český Blessing");
  expect(lookupDisplayText({ ...copy, uuid: `${parent.uuid}.ActiveEffect.other` }, ["name"])).toBeNull();
});

it("uses current raw text without cloning large scenes during canvas refresh", async () => {
  const source = { name: "English Scene", regions: [{ _id: "region1234567890", name: "English Region" }] };
  const { doc } = await seed("Scene", source);
  const native = { ...doc, _source: source, toObject: vi.fn(() => { throw new Error("Scene clone on hot path"); }) };
  expect(lookupDisplayText(native, ["regions", "region1234567890", "name"])).toBe("Český Region");
  source.regions[0]!.name = "Changed";
  expect(lookupDisplayText(native, ["regions", "region1234567890", "name"])).toBeNull();
  expect(native.toObject).not.toHaveBeenCalled();
});

it("restores only its own unchanged map labels when the translation preference is disabled", async () => {
  const { doc } = await seed("Scene", { name: "English Scene", notes: [{ _id: "note123456789012", text: "English Gate" }] });
  const object = { document: { uuid: `${doc.uuid}.Note.note123456789012`, id: "note123456789012", documentName: "Note", text: "English Gate", parent: doc }, tooltip: { text: "English Gate" } };
  document.body.innerHTML = `<a class="content-link" data-uuid="${doc.uuid}">English Scene</a>`;
  applyCanvasDisplayText(object); await applyDisplayLabels(document.body);
  expect(object.tooltip.text).toBe("Český Gate");
  expect(document.body.textContent).toBe("Český Scene");
  game.settings.get = () => false;
  applyCanvasDisplayText(object); await applyDisplayLabels(document.body);
  expect(object.tooltip.text).toBe("English Gate");
  expect(document.body.textContent).toBe("English Scene");
  object.tooltip.text = "External change";
  applyCanvasDisplayText(object);
  expect(object.tooltip.text).toBe("External change");
});

it("uses the exact glossary name for Ember map notes, including native default page labels", async () => {
  vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting").mockResolvedValue([
    { source: "Forest of Stone", replacement: "Kamenný Les", category: "location", aliases: [] },
  ]);
  const { doc } = await seed("Scene", { name: "World Map" });
  const data = { uuid: `${doc.uuid}.Note.note123456789012`, id: "note123456789012", documentName: "Note", text: "", label: "FOREST OF STONE", parent: doc, getFlag: () => "geography" };
  const object = { document: data, tooltip: { text: "FOREST OF STONE" } };
  const before = { ...data };
  applyCanvasDisplayText(object); applyCanvasDisplayText(object);
  expect(object.tooltip.text).toBe("Kamenný Les");
  expect(data).toEqual(before);
  const ordinary = { document: { ...data, getFlag: () => undefined }, tooltip: { text: "FOREST OF STONE" } };
  applyCanvasDisplayText(ordinary);
  expect(ordinary.tooltip.text).toBe("FOREST OF STONE");
  game.settings.get = () => false;
  applyCanvasDisplayText(object);
  expect(object.tooltip.text).toBe("FOREST OF STONE");
});

it("does not reapply a label after preference changes while fromUuid is pending", async () => {
  const { doc } = await seed("Scene", { name: "English Scene" });
  document.body.innerHTML = `<a class="content-link" data-uuid="${doc.uuid}">English Scene</a>`;
  let release!: (doc: DisplayDocument) => void;
  vi.stubGlobal("fromUuid", () => new Promise<DisplayDocument>(resolve => { release = resolve; }));
  const pending = applyDisplayLabels(document.body);
  expect(release).toBeTypeOf("function");
  game.settings.get = () => false;
  await applyDisplayLabels(document.body);
  release(doc);
  await pending;
  expect(document.body.textContent).toBe("English Scene");
});
it("returns the native card if preference changes during enrichHTML", async () => {
  const { doc } = await seed("ActiveEffect", { name: "English Blessing", description: "<p>English protection.</p>" });
  const native = '<div class="action"><header class="action-header"><h4>English Blessing</h4></header><div class="description"><p>English protection.</p></div></div>';
  const prototype = { renderCard: vi.fn(async () => native) };
  vi.stubGlobal("CONFIG", { ActiveEffect: { documentClass: { prototype } } });
  let release!: (html: string) => void;
  const started = new Promise<void>(resolve => {
    vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { implementation: { enrichHTML: () => {
      resolve(); return new Promise<string>(done => { release = done; });
    } } } } } });
  });
  registerEffectCards();
  const pending = prototype.renderCard.call(doc);
  await started;
  game.settings.get = () => false;
  release("<p>Český protection.</p>");
  expect(await pending).toBe(native);
});

it("keeps native Note identity, mechanics and source while rendering default page labels", async () => {
  vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting").mockResolvedValue([
    { source: "Forest of Stone", replacement: "Kamenný Les", category: "location", aliases: [] },
  ]);
  const { doc } = await seed("Scene", { name: "World Map" });
  const data = { uuid: `${doc.uuid}.Note.note123456789012`, id: "note123456789012", documentName: "Note", text: "", label: "FOREST OF STONE", parent: doc, getFlag: () => "geography" };
  const object = { document: data, tooltip: { text: "FOREST OF STONE" } };
  const source = structuredClone(doc.toObject());
  const plainBefore = { uuid: data.uuid, id: data.id, documentName: data.documentName, text: data.text, label: data.label };
  applyCanvasDisplayText(object); applyCanvasDisplayText(object);
  expect(object.tooltip.text).toBe("Kamenný Les");
  expect({ uuid: data.uuid, id: data.id, documentName: data.documentName, text: data.text, label: data.label }).toEqual(plainBefore);
  expect(data.parent).toBe(doc);
  expect(doc.toObject()).toEqual(source);
});
it("removes previously rendered glossary labels after glossary access fails", async () => {
  const loader = vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting").mockResolvedValue([
    { source: "Forest of Stone", replacement: "Kamenný Les", category: "location", aliases: [] },
  ]);
  const { doc } = await seed("Scene", { name: "World Map" });
  const object = { document: { uuid: `${doc.uuid}.Note.note123456789012`, id: "note123456789012", documentName: "Note", text: "", label: "Forest of Stone", parent: doc, getFlag: () => "geography" }, tooltip: { text: "Forest of Stone" } };
  vi.stubGlobal("canvas", { notes: { placeables: [object] } });
  applyCanvasDisplayText(object);
  expect(object.tooltip.text).toBe("Kamenný Les");
  loader.mockRejectedValue(new Error("No access"));
  await reloadDisplayTexts();
  expect(object.tooltip.text).toBe("Forest of Stone");
});
it("keeps the newest glossary when two loads finish in reverse order", async () => {
  const { doc } = await seed("Scene", { name: "World Map" });
  let release!: (entries: any[]) => void;
  let signal!: () => void;
  const started = new Promise<void>(resolve => { signal = resolve; });
  const loader = vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting");
  loader.mockImplementationOnce(() => { signal(); return new Promise<any[]>(resolve => { release = resolve; }); });
  const first = reloadDisplayTexts();
  await started;
  loader.mockResolvedValueOnce([{ source: "Forest of Stone", replacement: "Nový Název", category: "location", aliases: [] }]);
  await reloadDisplayTexts();
  release([{ source: "Forest of Stone", replacement: "Starý Název", category: "location", aliases: [] }]);
  await first;
  const object = { document: { uuid: `${doc.uuid}.Note.note123456789012`, id: "note123456789012", documentName: "Note", text: "", label: "Forest of Stone", parent: doc, getFlag: () => "geography" }, tooltip: { text: "Forest of Stone" } };
  applyCanvasDisplayText(object);
  expect(object.tooltip.text).toBe("Nový Název");
});

it("discards a pending effect preview after preference, source, container or connection changes", async () => {
  const source = { name: "English Blessing", description: "<p>English protection.</p>" };
  const { doc } = await seed("ActiveEffect", source);
  const events = new Map<string, (...args: any[]) => unknown>();
  vi.stubGlobal("Hooks", { on: (event: string, callback: (...args: any[]) => unknown) => events.set(event, callback) });
  vi.stubGlobal("game", { user: { isGM: true }, system: { id: "crucible" }, packs,
    i18n: { localize: (key: string) => key }, settings: { get: () => true } });
  vi.stubGlobal("CONFIG", {});
  const { registerDisplayTextView } = await import("../src/translation/display-text-view");
  registerDisplayTextView();
  await reloadDisplayTexts();
  const render = events.get("renderApplicationV2")!;
  expect(render).toBeTypeOf("function");
  for (const change of ["preference", "detached", "source", "container", "document"] as const) {
    game.settings.get = () => true;
    source.description = "<p>English protection.</p>";
    document.body.innerHTML = '<div class="effect-window"><div class="window-content"></div></div>';
    const element = document.querySelector<HTMLElement>(".effect-window")!;
    const app = { document: doc, element, render: vi.fn() };
    let release!: (html: string) => void;
    let signal!: () => void;
    const started = new Promise<void>(resolve => { signal = resolve; });
    vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { implementation: { enrichHTML: () => {
      signal(); return new Promise<string>(resolve => { release = resolve; });
    } } } } } });
    render(app, element);
    await started;
    if (change === "preference") game.settings.get = () => false;
    if (change === "detached") element.remove();
    if (change === "source") source.description = "<p>Changed source prose.</p>";
    if (change === "document") app.document = { ...doc, uuid: "ActiveEffect.other123456789", name: "Other Effect" };
    if (change === "container") {
      app.element = document.createElement("div");
      app.element.innerHTML = '<div class="window-content"></div>';
      document.body.append(app.element);
    }
    release("<p>Český protection.</p>");
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(element.querySelector(".ft-display-preview"), change).toBeNull();
    expect(app.element.querySelector(".ft-display-preview"), change).toBeNull();
  }
});
