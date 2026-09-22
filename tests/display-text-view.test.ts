import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MODULE_ID } from "../src/constants";
import { DISPLAY_TEXT_PACK, readDisplayTextFlag, translateDisplayText } from "../src/translation/display-text";
import type { DisplayDocument } from "../src/translation/display-text";
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
  vi.stubGlobal("game", { user: { isGM: true }, system: { id: "crucible" }, packs });
  vi.stubGlobal("fromUuid", async (uuid: string) => docs.get(uuid) ?? null);
  await reloadDisplayTexts();
});
afterEach(() => vi.unstubAllGlobals());
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
