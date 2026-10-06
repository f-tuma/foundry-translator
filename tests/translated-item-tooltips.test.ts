import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { itemSourceHash } from "../src/translation/item";

const mapping = vi.hoisted(() => ({ pair: vi.fn(), source: vi.fn() }));
vi.mock("../src/translation/document-identity", async importActual => ({
  ...await importActual<typeof import("../src/translation/document-identity")>(),
  resolveTranslationReference: mapping.pair, resolveSourceReference: mapping.source,
}));
let documents: Map<string, any>, hooks: Map<string, ((...args: any[]) => void)[]>;
let locale: string, preference: boolean, enrich: ReturnType<typeof vi.fn>;
let api: typeof import("../src/translation/translated-item-tooltips");
beforeEach(async () => {
  vi.resetModules(); mapping.pair.mockReset(); mapping.source.mockReset();
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLElement", window.HTMLElement); vi.stubGlobal("Event", window.Event);
  documents = new Map(); hooks = new Map(); locale = "cs"; preference = true;
  enrich = vi.fn(async (html: string) => html);
  vi.stubGlobal("CONFIG", { ux: { TextEditor: { enrichHTML: enrich } } });
  vi.stubGlobal("game", { user: { id: "u" }, system: { id: "crucible" },
    settings: { get: (_m: string, key: string) => key === "targetLanguage" ? locale : key === "autoOpenTranslations" ? preference : undefined },
    tooltip: { element: null, deactivate: vi.fn() } });
  vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => documents.get(uuid) ?? null));
  vi.stubGlobal("Hooks", { on: (event: string, callback: (...args: any[]) => void) => hooks.set(event, [...(hooks.get(event) ?? []), callback]) });
  mapping.source.mockImplementation(async uuid => uuid);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  api = await import("../src/translation/translated-item-tooltips");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function flag(sourceUuid: string, sourceHash: string, extra = {}) {
  return { "foundry-translate": { itemTranslation: { schemaVersion: 1, engineRevision: 7, sourceUuid, sourceHash,
    providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "2026-10-05",
    translatedHtmlFields: 1, fallbackTextSegments: 0, ...extra } } };
}
async function fixture(feature = false) {
  const source = { id: "sword", uuid: "Item.sword", documentName: "Item", name: "Sword", type: feature ? "talent" : "weapon",
    system: { description: feature ? "<p>Damage 3.</p>" : { public: "<p>Damage 3.</p>" } }, isOwner: false,
    testUserPermission: vi.fn(() => true), toObject() { return { name: this.name, type: this.type, system: this.system }; },
    renderCard: vi.fn(async (): Promise<string> => native) };
  const target = { ...source, id: "csSword", uuid: "Compendium.world.foundry-translate-items.Item.csSword", name: "Meč", isOwner: true,
    system: { description: feature ? "<p>Zranění 3.</p>" : { public: "<p>Zranění 3.</p>" } },
    testUserPermission: vi.fn(() => true), flags: flag(source.uuid, await itemSourceHash(source.toObject())) };
  const native = feature
    ? `<div class="crucible-item-card line-item talent" data-uuid="Item.sword"><header><img alt="Sword"><div class="title"><h2>Sword</h2><span class="prerequisite unmet">Requires Strength 4</span></div></header><section class="description"><p>Damage 3.</p></section><button data-uuid="Item.sword" data-action="use">Native</button></div>`
    : `<div class="action line-item" data-item-id="sword"><header class="action-header"><img alt="Sword"><div class="title"><h4>Sword</h4><span class="tag">Damage 3</span></div></header><div class="description"><p>Damage 3.</p></div><section class="actions"><div data-action-id="hit"><h4>Hit</h4><div class="description">Native action</div></div></section></div>`;
  documents.set(source.uuid, source); documents.set(target.uuid, target);
  mapping.pair.mockResolvedValue({ status: "mapped", sourceUuid: source.uuid, translatedUuid: target.uuid });
  return { source, target, native };
}
function html(value: string) { const root = document.createElement("div"); root.innerHTML = value; return root; }
async function settle() { for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 0)); }
function link() {
  const anchor = document.createElement("a"); anchor.className = "content-link";
  Object.assign(anchor.dataset, { link: "", uuid: "Item.sword", crucibleTooltip: "weapon", tooltip: " " });
  document.body.append(anchor); return anchor;
}
// Linkedom simulates ancestor capture only for bubbling events; native
// pointerenter is captured by document without bubbling in browsers.
function enter(element: HTMLElement) { element.dispatchEvent(new Event("pointerenter", { bubbles: true })); }

describe("native Item card prose", () => {
  it.each([false, true])("preserves native mechanics, IDs and controls (feature=%s)", async feature => {
    const f = await fixture(feature), result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(feature ? "h2" : "h4")?.textContent).toBe("Meč");
    expect(result.querySelector(".description")?.innerHTML).toBe("<p>Zranění 3.</p>");
    expect(result.querySelector("img")?.alt).toBe("Meč");
    if (feature) {
      expect(result.querySelector(".prerequisite")?.outerHTML).toContain("Requires Strength 4");
      expect(result.querySelector("button")?.outerHTML).toContain('data-uuid="Item.sword"');
      expect(result.firstElementChild?.getAttribute("data-uuid")).toBe("Item.sword");
    } else {
      expect(result.querySelector(".tag")?.textContent).toBe("Damage 3");
      expect(result.querySelector(".actions")?.outerHTML).toBe(html(f.native).querySelector(".actions")?.outerHTML);
      expect(result.firstElementChild?.getAttribute("data-item-id")).toBe("sword");
    }
    expect(enrich).toHaveBeenCalledWith("<p>Zranění 3.</p>", { relativeTo: f.source, secrets: false });
    expect(f.source.name).toBe("Sword"); expect(f.target.renderCard).not.toHaveBeenCalled();
  });
  it.each(["denied-source", "denied-copy", "stale-hash", "wrong-type", "wrong-UUID", "partial", "fallback", "ambiguous", "unknown-template", "foreign-title", "changed-number", "changed-command"])("keeps native for %s", async problem => {
    const f = await fixture(); let native = f.native;
    if (problem === "denied-source") f.source.testUserPermission.mockReturnValue(false);
    if (problem === "denied-copy") f.target.testUserPermission.mockReturnValue(false);
    if (problem === "stale-hash") f.target.flags["foundry-translate"].itemTranslation.sourceHash = "stale";
    if (problem === "wrong-type") f.target.type = "talent";
    if (problem === "wrong-UUID") f.target.uuid = "Item.other";
    if (problem === "partial") Object.assign(f.target.flags["foundry-translate"].itemTranslation, { partial: true });
    if (problem === "fallback") f.target.flags["foundry-translate"].itemTranslation.fallbackTextSegments = 1;
    if (problem === "ambiguous") mapping.pair.mockResolvedValue({ status: "ambiguous" });
    if (problem === "unknown-template") native = "<section><h4>Sword</h4></section>";
    if (problem === "foreign-title") native = native.replace("<h4>Sword</h4>", "<h4>Other</h4>");
    if (problem === "changed-number") f.target.system.description = { public: "<p>Zranění 5.</p>" };
    if (problem === "changed-command") f.target.system.description = { public: "<p>Zranění 3. @UUID[Item.foreign]</p>" };
    expect(await api.translatedItemCard(f.source, native, "cs")).toBe(native);
  });
  it.each(["permission", "provenance", "source-edit", "target-edit", "owner", "user"])("rechecks %s after async enrichment", async change => {
    const f = await fixture(true);
    enrich.mockImplementation(async (value: string) => {
      if (change === "permission") f.source.testUserPermission.mockReturnValue(false);
      if (change === "provenance") f.target.flags["foundry-translate"].itemTranslation.sourceUuid = "Item.other";
      if (change === "source-edit") f.source.name = "Changed source";
      if (change === "target-edit") f.target.name = "Changed target";
      if (change === "owner") f.source.isOwner = true;
      if (change === "user") game.user = { isGM: false, id: "other" };
      return value;
    });
    expect(await api.translatedItemCard(f.source, f.native, "cs")).toBe(f.native);
  });
  it("uses canonical source context for relative links and only permits existing source commands", async () => {
    const f = await fixture(); f.source.system.description = { public: "<p>@UUID[Item.sword] Damage 3.</p>" };
    f.target.system.description = { public: `<p>@UUID[${f.target.uuid}] Zranění 3.</p>` };
    f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
    mapping.source.mockImplementation(async uuid => uuid === f.target.uuid ? f.source.uuid : uuid);
    const result = await api.translatedItemCard(f.source, f.native, "cs");
    expect(result).toContain("@UUID[Item.sword] Zranění 3.");
    expect(enrich.mock.calls[0]?.[1]).toEqual({ relativeTo: f.source, secrets: false });
  });
});

class StringField {}
class HTMLField {}
class CrucibleActionField { fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() }; }
class ArrayField { element = new CrucibleActionField(); }
async function actionFixture(feature = true) {
  const f = await fixture(feature);
  const source: any = f.source, target: any = f.target;
  source.system.actions = [{ id: "companion", name: "Construct Companion", description: "<p>Spend 1 hour.</p>",
    cost: { action: 0 }, condition: "hasTalent", summon: { actorUuid: "Actor.original" }, tags: ["summon"] }];
  target.system.actions = structuredClone(source.system.actions);
  target.system.actions[0].name = "Sestrojit Společníka";
  target.system.actions[0].description = "<p>Věnujte tomu 1 hodinu.</p>";
  Object.defineProperty(source.system, "constructor", { value: { schema: { fields: { actions: new ArrayField() } } } });
  source.actions = source.system.actions.map((action: any) => ({ ...structuredClone(action), item: source,
    toObject() { const { item: _item, toObject: _method, ...data } = this; return structuredClone(data); } }));
  target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(source.toObject());
  const action = `<section class="actions"><h3>Akce</h3><div class="action line-item full" data-action-id="companion"><header class="action-header"><img alt="Construct Companion" title="Construct Companion" src="original.webp"><div class="title"><h4>Construct Companion</h4><div class="tags">5 / 0A</div></div></header><p class="activation">hasTalent</p><div class="description"><p>Spend 1 hour.</p></div><ul class="effects"><li>Original effect</li></ul><button data-action="activate" data-action-id="companion">Activate</button></div></section>`;
  const native = feature ? f.native.replace(/<\/div>$/u, action + "</div>")
    : f.native.replace(/<section class="actions">[\s\S]*?<\/section>/u, action);
  return { source, target, native };
}
describe("included native Action prose", () => {
  it("translates names and descriptions in the original Action enrichment context without changing mechanics", async () => {
    const f = await actionFixture(), beforeSource = JSON.stringify(f.source.toObject()), beforeTarget = JSON.stringify(f.target.toObject());
    const result = html(await api.translatedItemCard(f.source, f.native, "cs")), row = result.querySelector(".actions > .action")!;
    expect(row.querySelector("h4")?.textContent).toBe("Sestrojit Společníka");
    expect(row.querySelector(".description")?.innerHTML).toBe("<p>Věnujte tomu 1 hodinu.</p>");
    expect(row.querySelector("img")?.alt).toBe("Sestrojit Společníka");
    expect(row.querySelector("img")?.getAttribute("src")).toBe("original.webp");
    for (const selector of [".tags", ".activation", ".effects", "button"]) {
      expect(row.querySelector(selector)?.outerHTML).toBe(html(f.native).querySelector(".actions " + selector)?.outerHTML);
    }
    expect(row.getAttribute("data-action-id")).toBe("companion");
    expect(enrich).toHaveBeenCalledWith("<p>Věnujte tomu 1 hodinu.</p>", { relativeTo: f.source.actions[0], secrets: false });
    expect(JSON.stringify(f.source.toObject())).toBe(beforeSource);
    expect(JSON.stringify(f.target.toObject())).toBe(beforeTarget);
    expect(f.target.renderCard).not.toHaveBeenCalled();
  });
  it("preserves physical Item owner-only Action visibility without revealing private Item biography", async () => {
    const f = await actionFixture(false);
    f.source.isOwner = true;
    f.source.system.actions[0].description = '<section class="secret"><p>Spend 1 hour.</p></section>';
    f.source.actions[0].description = f.source.system.actions[0].description;
    f.target.system.actions[0].description = '<section class="secret"><p>Věnujte tomu 1 hodinu.</p></section>';
    f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".actions h4")?.textContent).toBe("Sestrojit Společníka");
    expect(enrich).toHaveBeenCalledWith("<p>Zranění 3.</p>", { relativeTo: f.source, secrets: false });
    expect(enrich).toHaveBeenCalledWith(f.target.system.actions[0].description, { relativeTo: f.source.actions[0], secrets: true });
  });
  it.each(["source", "target"])("rechecks physical Action %s ownership after enrichment", async owner => {
    const f = await actionFixture(false); f.source.isOwner = true;
    enrich.mockImplementation(async (value: string) => {
      if (value.includes("hodinu")) f[owner as "source" | "target"].isOwner = false;
      return value;
    });
    expect(await api.translatedItemCard(f.source, f.native, "cs")).toBe(f.native);
  });
  it.each(["schema", "missing-copy", "foreign-id", "duplicate-copy", "duplicate-runtime", "foreign-runtime", "runtime-text", "foreign-heading", "number", "command", "HTML", "name-command", "duplicate-row", "reorder"])("keeps unsupported or unsafe Action native: %s", async reason => {
    const f = await actionFixture(); let native = f.native;
    if (reason === "schema") f.source.system.constructor.schema.fields.actions.element.fields.name = new HTMLField();
    if (reason === "missing-copy") f.target.system.actions = [];
    if (reason === "foreign-id") f.target.system.actions[0].id = "foreign";
    if (reason === "duplicate-copy") f.target.system.actions.push(structuredClone(f.target.system.actions[0]));
    if (reason === "duplicate-runtime") f.source.actions.push(f.source.actions[0]);
    if (reason === "foreign-runtime") f.source.actions[0].item = f.target;
    if (reason === "runtime-text") f.source.actions[0].description = "Other";
    if (reason === "foreign-heading") native = native.replace("<h4>Construct Companion</h4>", "<h4>Other</h4>");
    if (reason === "number") f.target.system.actions[0].description = "<p>Věnujte tomu 2 hodiny.</p>";
    if (reason === "command") f.target.system.actions[0].description = "<p>Věnujte tomu 1 hodinu. @UUID[Actor.foreign]</p>";
    if (reason === "HTML") f.target.system.actions[0].description = '<p class="unsafe">Věnujte tomu 1 hodinu.</p>';
    if (reason === "name-command") f.target.system.actions[0].name = "@UUID[Actor.foreign]";
    if (reason === "duplicate-row") {
      const container = html(native), section = container.querySelector("section.actions")!;
      section.append(section.querySelector(".action")!.cloneNode(true)); native = container.innerHTML;
    }
    if (reason === "reorder") {
      const second = { id: "second", name: "Second", description: "<p>Second.</p>" };
      f.source.system.actions.push(second); f.source.actions.push({ ...second, item: f.source });
      f.target.system.actions.unshift(structuredClone(second));
      f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
    }
    const result = html(await api.translatedItemCard(f.source, native, "cs"));
    expect(result.querySelector("h2")?.textContent).toBe("Meč");
    expect(result.querySelector("section.actions")?.outerHTML).toBe(html(native).querySelector("section.actions")?.outerHTML);
  });
  it.each(["target-action", "source-runtime", "source-data"])("discards the whole overlay when %s changes during enrichment", async reason => {
    const f = await actionFixture();
    enrich.mockImplementation(async (value: string) => {
      if (value.includes("hodinu")) {
        if (reason === "target-action") f.target.system.actions[0].name = "Changed";
        if (reason === "source-runtime") f.source.actions[0].name = "Changed";
        if (reason === "source-data") f.source.system.actions[0].condition = "Changed";
      }
      return value;
    });
    expect(await api.translatedItemCard(f.source, f.native, "cs")).toBe(f.native);
  });
  it("uses original prepared @ref values and ignores copy mechanics, effects and summon targets", async () => {
    const f = await actionFixture();
    f.source.system.actions[0].description = "<p>Range @ref[range.maximum].</p>";
    f.source.actions[0].description = f.source.system.actions[0].description;
    f.source.actions[0].range = { maximum: 5 };
    f.target.system.actions[0].description = "<p>Dosah @ref[range.maximum].</p>";
    Object.assign(f.target.system.actions[0], { cost: { action: 99 }, range: { maximum: 99 },
      effects: [{ name: "Foreign effect" }], summon: { actorUuid: "Actor.foreign" } });
    f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
    enrich.mockImplementation(async (value: string, options: any) => value.replace("@ref[range.maximum]", String(options.relativeTo.range?.maximum)));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs")), row = result.querySelector(".actions > .action")!;
    expect(row.querySelector(".description")?.textContent).toBe("Dosah 5.");
    expect(row.querySelector(".tags")?.textContent).toBe("5 / 0A");
    expect(row.querySelector(".effects")?.textContent).toBe("Original effect");
    expect(row.querySelector("button")?.getAttribute("data-action-id")).toBe("companion");
  });
  it.each(["range", "cost", "instance"])("discards an overlay after prepared runtime %s changes without any raw source edit", async change => {
    const f = await actionFixture();
    f.source.system.actions[0].description = "<p>Range @ref[range.maximum].</p>";
    f.source.actions[0].description = f.source.system.actions[0].description;
    f.source.actions[0].range = { maximum: 5 };
    f.target.system.actions[0].description = "<p>Dosah @ref[range.maximum].</p>";
    f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
    const originalRaw = JSON.stringify(f.source.toObject());
    enrich.mockImplementation(async (value: string, options: any) => {
      if (value.includes("@ref")) {
        if (change === "range") f.source.actions[0].range.maximum = 7;
        if (change === "cost") f.source.actions[0].cost.action = 7;
        if (change === "instance") f.source.actions[0] = { ...f.source.actions[0] };
        return value.replace("@ref[range.maximum]", String(options.relativeTo.range.maximum));
      }
      return value;
    });
    expect(await api.translatedItemCard(f.source, f.native, "cs")).toBe(f.native);
    expect(JSON.stringify(f.source.toObject())).toBe(originalRaw);
  });
  it("canonicalizes Action links while retaining the native runtime context and secret visibility", async () => {
    const f = await actionFixture();
    f.source.system.actions[0].description = "<p>@UUID[Item.sword] Spend 1 hour.</p>";
    f.source.actions[0].description = f.source.system.actions[0].description;
    f.target.system.actions[0].description = `<p>@UUID[${f.target.uuid}] Věnujte tomu 1 hodinu.</p>`;
    f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
    mapping.source.mockImplementation(async uuid => uuid === f.target.uuid ? f.source.uuid : uuid);
    await api.translatedItemCard(f.source, f.native, "cs");
    expect(enrich).toHaveBeenCalledWith("<p>@UUID[Item.sword] Věnujte tomu 1 hodinu.</p>", { relativeTo: f.source.actions[0], secrets: false });
  });
});

describe("scoped native hover producer", () => {
  it("handles the reviewed native creation talent div without changing selection, tooltip or Item identity", async () => {
    const f = await fixture(true);
    const row = document.createElement("div");
    row.className = "crucible-item-inline line-item talent";
    Object.assign(row.dataset, { uuid: "Item.sword", crucibleTooltip: "talent" });
    row.innerHTML = '<div class="icon-frame"><img alt="Meč"></div><div class="title"><h4>Meč</h4><div class="tags"><span class="tag">Ancestry: Human</span></div></div><input name="system.talents.0.level" value="2"><a data-action="removeTalent">Remove</a>';
    document.body.append(row);
    const originalBody = row.innerHTML, render = f.source.renderCard;
    api.registerTranslatedItemTooltips();
    let nativeProductions = 0;
    document.addEventListener("pointerenter", event => {
      if ((event.target as HTMLElement).dataset.crucibleTooltip === "talent" && !("tooltipHtml" in (event.target as HTMLElement).dataset)) nativeProductions++;
    }, true);
    enter(row); expect(row.dataset.tooltipHtml).toBe(""); await settle();
    expect(row.dataset.tooltipHtml).toContain("Zranění 3.");
    expect(row.dataset.uuid).toBe("Item.sword"); expect(row.dataset.crucibleTooltip).toBe("talent");
    expect(row.innerHTML).toBe(originalBody); expect(f.source.renderCard).toBe(render);
    expect(render).toHaveBeenCalledTimes(1); expect(nativeProductions).toBe(0);
  });
  it("claims only the presentation request, preserving link/drag identity and native render method", async () => {
    const f = await fixture(), render = f.source.renderCard, anchor = link();
    api.registerTranslatedItemTooltips(); api.registerTranslatedItemTooltips();
    let nativeProductions = 0;
    // Linkedom has no ancestor capture ordering; install the simulated
    // Crucible handler after our document capture listener on the same root.
    document.addEventListener("pointerenter", event => {
      if (!("tooltipHtml" in (event.target as HTMLElement).dataset)) nativeProductions++;
    }, true);
    enter(anchor); expect(anchor.dataset.tooltipHtml).toBe(""); await settle();
    expect(anchor.dataset.tooltipHtml).toContain("Zranění 3.");
    expect(anchor.dataset.uuid).toBe("Item.sword"); expect(anchor.dataset.link).toBe("");
    expect(f.source.renderCard).toBe(render); expect(render).toHaveBeenCalledTimes(1);
    expect(nativeProductions).toBe(0);
  });
  it("OFF leaves ordinary source hovers native", async () => {
    await fixture(); preference = false; const anchor = link(); api.registerTranslatedItemTooltips(); enter(anchor); await settle();
    expect(anchor.dataset.tooltipHtml).toBeUndefined(); expect(mapping.pair).not.toHaveBeenCalled();
  });
  it("OFF still supports a permitted manually opened translated journal scope", async () => {
    await fixture(); preference = false; const anchor = link(), root = document.createElement("article"); document.body.append(root); root.append(anchor);
    const journal = { uuid: "Compendium.world.foundry-translate-translations.JournalEntry.cs", documentName: "JournalEntry",
      testUserPermission: () => true, flags: { "foundry-translate": { translation: { schemaVersion: 1, sourceUuid: "JournalEntry.guide",
        sourceHash: "h", providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "today",
        translatedTextPages: 1, skippedTextPages: 0, fallbackTextSegments: 0, partial: false } } } };
    api.registerTranslatedItemTooltips(); for (const callback of hooks.get("renderApplicationV2") ?? []) callback({ element: root, document: journal });
    enter(anchor); await settle(); expect(anchor.dataset.tooltipHtml).toContain("Zranění 3.");
  });
  it.each(["Actor", "ActiveEffect", "embedded", "editor", "reader", "cached", "unknown-kind"])("does not seize %s hover requests", async reason => {
    await fixture(); const anchor = link();
    if (reason === "Actor") anchor.dataset.uuid = "Actor.hero";
    if (reason === "ActiveEffect") anchor.dataset.crucibleTooltip = "activeEffect";
    if (reason === "embedded") anchor.dataset.uuid = "Actor.hero.Item.sword";
    if (reason === "editor" || reason === "reader") { const holder = document.createElement("div"); holder.className = reason === "editor" ? "editor-content ProseMirror" : "ft-reader"; document.body.append(holder); holder.append(anchor); }
    if (reason === "cached") anchor.dataset.tooltipHtml = "Native cached";
    if (reason === "unknown-kind") anchor.dataset.crucibleTooltip = "action";
    api.registerTranslatedItemTooltips(); enter(anchor); await settle();
    expect(mapping.pair).not.toHaveBeenCalled(); expect(anchor.dataset.tooltipHtml).toBe(reason === "cached" ? "Native cached" : undefined);
  });
  it.each(["leave", "detached", "UUID", "preference", "language", "user"])("does not publish after stale %s", async change => {
    const f = await fixture(), anchor = link(); let finish!: (value: string) => void;
    f.source.renderCard.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    api.registerTranslatedItemTooltips(); enter(anchor); await settle();
    if (change === "leave") anchor.dispatchEvent(new Event("pointerleave", { bubbles: true }));
    if (change === "detached") anchor.remove();
    if (change === "UUID") anchor.dataset.uuid = "Item.other";
    if (change === "preference") preference = false;
    if (change === "language") locale = "de";
    if (change === "user") game.user = { id: "other", isGM: false };
    finish(f.native); await settle(); expect(anchor.dataset.tooltipHtml ?? "").not.toContain("Zranění");
  });
  it("failed lookup returns the untouched request to native producer exactly once", async () => {
    const anchor = link(); api.registerTranslatedItemTooltips(); let calls = 0;
    document.addEventListener("pointerenter", event => { if (!("tooltipHtml" in (event.target as HTMLElement).dataset)) calls++; }, true);
    enter(anchor); await settle(); expect(calls).toBe(1); expect(anchor.dataset.tooltipHtml).toBeUndefined();
  });
  it("does not replay a denied source Item to the unguarded native producer", async () => {
    const f = await fixture(), anchor = link(); f.source.testUserPermission.mockReturnValue(false);
    api.registerTranslatedItemTooltips(); let nativeProductions = 0;
    document.addEventListener("pointerenter", event => {
      if (!("tooltipHtml" in (event.target as HTMLElement).dataset)) nativeProductions++;
    }, true);
    enter(anchor); await settle();
    expect(f.source.renderCard).not.toHaveBeenCalled(); expect(mapping.pair).not.toHaveBeenCalled();
    expect(anchor.dataset.tooltipHtml).toBeUndefined(); expect(nativeProductions).toBe(0);
  });
  it("returns source edits during native rendering to one fresh native request without mixing translated prose", async () => {
    const f = await fixture(), anchor = link(); let finish!: (value: string) => void;
    f.source.renderCard.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    api.registerTranslatedItemTooltips(); let nativeProductions = 0;
    document.addEventListener("pointerenter", event => {
      if (!("tooltipHtml" in (event.target as HTMLElement).dataset)) nativeProductions++;
    }, true);
    enter(anchor); await settle(); f.source.system.description = { public: "<p>Damage 5.</p>" };
    finish(f.native); await settle();
    expect(f.source.renderCard).toHaveBeenCalledTimes(1); expect(mapping.pair).not.toHaveBeenCalled();
    expect(anchor.dataset.tooltipHtml).toBeUndefined(); expect(nativeProductions).toBe(1);
  });
  it.each(["pending", "cached"])("clears an app's %s hover even when its close hook no longer has an element", async state => {
    const f = await fixture(), anchor = link(), root = document.createElement("article");
    document.body.append(root); root.append(anchor);
    const app: { element: HTMLElement | null } = { element: root };
    let finish!: (value: string) => void;
    if (state === "pending") f.source.renderCard.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    api.registerTranslatedItemTooltips();
    for (const callback of hooks.get("renderApplicationV2") ?? []) callback(app);
    enter(anchor); await settle();
    if (state === "pending") expect(anchor.dataset.tooltipHtml).toBe("");
    else expect(anchor.dataset.tooltipHtml).toContain("Zranění");
    game.tooltip.element = anchor;
    root.remove(); app.element = null;
    for (const callback of hooks.get("closeApplicationV2") ?? []) callback(app);
    expect(anchor.dataset.tooltipHtml).toBeUndefined(); expect(game.tooltip.deactivate).toHaveBeenCalledTimes(1);
    if (state === "pending") { finish(f.native); await settle(); expect(mapping.pair).not.toHaveBeenCalled(); }
    document.body.append(root);
    expect(anchor.dataset.tooltipHtml).toBeUndefined();
  });
  it("removes detached owned cache attributes before a row is reconnected and hovered again", async () => {
    const f = await fixture(), anchor = link(); api.registerTranslatedItemTooltips();
    enter(anchor); await settle(); expect(anchor.dataset.tooltipHtml).toContain("Zranění 3.");
    anchor.remove(); enter(document.body);
    expect(anchor.dataset.tooltipHtml).toBeUndefined();
    document.body.append(anchor); enter(anchor); await settle();
    expect(f.source.renderCard).toHaveBeenCalledTimes(2); expect(anchor.dataset.tooltipHtml).toContain("Zranění 3.");
  });
});

async function conditionFixture(feature = true) {
  const f = await actionFixture(feature);
  f.source.system.actions[0].condition = "You become Weakened within 6 rounds.";
  f.source.actions[0].condition = f.source.system.actions[0].condition;
  f.target.system.actions[0].condition = "Stanete se Oslabenými do 6 kol.";
  f.native = f.native.replace('<p class="activation">hasTalent</p>', '<p class="condition activation"><strong>Stav:</strong> <em>You become Weakened within 6 rounds.</em></p>');
  f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
  return f;
}
describe("included native Action trigger sentence", () => {
  it.each([false, true])("overlays only the escaped UI sentence without replacing execution context (feature=%s)", async feature => {
    const f = await conditionFixture(feature);
    const original = JSON.stringify(f.source.toObject()), prepared = JSON.stringify(f.source.actions[0].toObject(false));
    const target = JSON.stringify(f.target.toObject());
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".condition em")?.textContent).toBe("Stanete se Oslabenými do 6 kol.");
    expect(result.querySelector(".condition strong")?.textContent).toBe("Stav:");
    expect(result.querySelector(".actions .tags")?.outerHTML).toBe(html(f.native).querySelector(".actions .tags")?.outerHTML);
    expect(result.querySelector(".actions button")?.outerHTML).toBe(html(f.native).querySelector(".actions button")?.outerHTML);
    expect(JSON.stringify(f.source.toObject())).toBe(original);
    expect(JSON.stringify(f.source.actions[0].toObject(false))).toBe(prepared);
    expect(JSON.stringify(f.target.toObject())).toBe(target);
    expect(enrich).toHaveBeenCalledWith("<p>Věnujte tomu 1 hodinu.</p>", { relativeTo: f.source.actions[0], secrets: false });
  });
  it.each(["unknown-schema", "wrong-schema", "runtime-sentence", "native-sentence", "changed-number", "new-command", "blank", "non-string", "nested-em", "duplicate-em"])("retains native condition for %s while allowing validated names and prose", async problem => {
    const f = await conditionFixture();
    if (problem === "unknown-schema") delete f.source.system.constructor.schema.fields.actions.element.fields.condition;
    if (problem === "wrong-schema") f.source.system.constructor.schema.fields.actions.element.fields.condition = new HTMLField();
    if (problem === "runtime-sentence") f.source.actions[0].condition = "Other condition";
    if (problem === "native-sentence") f.native = f.native.replace('<em>You become Weakened within 6 rounds.</em>', '<em>Other condition</em>');
    if (problem === "changed-number") f.target.system.actions[0].condition = "Stanete se Oslabenými do 7 kol.";
    if (problem === "new-command") f.target.system.actions[0].condition = "Stanete se Oslabenými do 6 kol. @UUID[Actor.foreign]";
    if (problem === "blank") f.target.system.actions[0].condition = " ";
    if (problem === "non-string") f.target.system.actions[0].condition = 6;
    if (problem === "nested-em") f.native = f.native.replace('<em>You become Weakened within 6 rounds.</em>', '<span><em>You become Weakened within 6 rounds.</em></span>');
    if (problem === "duplicate-em") f.native = f.native.replace('</em>', '</em><em>You become Weakened within 6 rounds.</em>');
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".condition")?.outerHTML).toBe(html(f.native).querySelector(".condition")?.outerHTML);
    expect(result.querySelector(".actions h4")?.textContent).toBe("Sestrojit Společníka");
    expect(result.querySelector(".actions .description")?.innerHTML).toBe("<p>Věnujte tomu 1 hodinu.</p>");
  });
  it("escapes copied condition text instead of interpreting HTML", async () => {
    const f = await conditionFixture();
    f.target.system.actions[0].condition = "Když řeknete <img src=x onerror=alert()> do 6 kol.";
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".condition em img")).toBeNull();
  });
  it("discards the overlay if the runtime condition changes during enrichment", async () => {
    const f = await conditionFixture();
    enrich.mockImplementation(async value => { if (value.includes("hodinu")) f.source.actions[0].condition = "Changed"; return value; });
    expect(await api.translatedItemCard(f.source, f.native, "cs")).toBe(f.native);
  });
});

// Synthetic equivalent of Crucible's Text-node @ref enricher. It deliberately
// resolves every path against the supplied original runtime model, including code
// text and nested command labels, as native TextEditor traversal does.
function nativeReferences(value: string, options: any): string {
  const root = html(value);
  if (!options.secrets) for (const secret of root.querySelectorAll("section.secret:not(.revealed)")) secret.remove();
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      node.textContent = node.textContent!.replace(/@ref\[([\w.]+)\](?:\{([^}]+)\})?/gu, (command, path, fallback) => {
        const resolved = path.split(".").reduce((object: any, key: string) => object?.[key], options.relativeTo);
        return String(resolved || fallback || command);
      });
    } else for (const child of [...node.childNodes]) visit(child);
  };
  visit(root); return root.innerHTML;
}
async function referenceFixture(before: string, after: string) {
  const f = await actionFixture();
  f.source.system.actions[0].description = before;
  f.source.actions[0].description = before;
  f.target.system.actions[0].description = after;
  f.native = f.native.replace("<p>Spend 1 hour.</p>", before);
  f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
  return f;
}
describe("terminal display names in native @ref prose", () => {
  it("distinguishes Action name from Item name while retaining prepared mechanics and repeated references", async () => {
    const f = await referenceFixture(
      "<p>@ref[name] uses @ref[item.name]. Range @ref[range.maximum]. @ref[name]{Fallback}.</p>",
      "<p>@ref[name] používá @ref[item.name]. Dosah @ref[range.maximum]. @ref[name]{Náhrada}.</p>");
    f.source.actions[0].range = { maximum: 5 };
    f.target.system.actions[0].range = { maximum: 99 };
    const original = JSON.stringify(f.source.toObject()), copy = JSON.stringify(f.target.toObject());
    const prepared = JSON.stringify(f.source.actions[0].toObject(false));
    enrich.mockImplementation(async (value, options) => nativeReferences(value, options));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".actions .description")?.textContent).toBe("Sestrojit Společníka používá Meč. Dosah 5. Sestrojit Společníka.");
    expect(enrich.mock.calls.find(([value]) => value.includes("Dosah"))?.[1]).toEqual({ relativeTo: f.source.actions[0], secrets: false });
    expect(JSON.stringify(f.source.toObject())).toBe(original);
    expect(JSON.stringify(f.target.toObject())).toBe(copy);
    expect(JSON.stringify(f.source.actions[0].toObject(false))).toBe(prepared);
    expect(result.querySelector(".actions button")?.getAttribute("data-action-id")).toBe("companion");
    expect(f.target.renderCard).not.toHaveBeenCalled();
  });
  it("binds top-level Item name only and retains the native fallback for unproven item.name", async () => {
    const f = await fixture(true);
    f.source.system.description = "<p>@ref[name]. @ref[item.name]{Fallback}.</p>";
    f.target.system.description = "<p>@ref[name]. @ref[item.name]{Náhrada}.</p>";
    f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
    enrich.mockImplementation(async (value, options) => nativeReferences(value, options));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".description")?.textContent).toBe("Meč. Náhrada.");
    expect(enrich.mock.calls[0]?.[1]).toEqual({ relativeTo: f.source, secrets: false });
  });
  it("leaves attributes, excluded code, nested labels, Embed options and roll commands to native enrichment", async () => {
    const nested = '<p title="@ref[name]">@ref[name] @UUID[Actor.stable]{@ref[name]} '
      + '@Embed[Actor.stable readaloud="@ref[name] and @ref[item.name]"] '
      + '[[1 + @ref[range.maximum]]] <code>@ref[name]</code></p>';
    const f = await referenceFixture(nested, nested);
    f.source.actions[0].range = { maximum: 5 };
    enrich.mockImplementation(async (value, options) => nativeReferences(value, options));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    const input = enrich.mock.calls.find(([value]) => value.includes("@Embed"))?.[0];
    expect(input).toContain('title="@ref[name]"');
    expect(input).toContain("@UUID[Actor.stable]{@ref[name]}");
    expect(input).toContain('@Embed[Actor.stable readaloud="@ref[name] and @ref[item.name]"]');
    expect(input).toContain("[[1 + @ref[range.maximum]]]");
    expect(input).toContain("<code>@ref[name]</code>");
    const body = result.querySelector(".actions .description")!;
    expect(body.querySelector("p")?.getAttribute("title")).toBe("@ref[name]");
    expect(body.querySelector("code")?.textContent).toBe("Construct Companion");
    expect(body.textContent).toContain("Sestrojit Společníka @UUID[Actor.stable]{Construct Companion}");
    expect(body.textContent).toContain('@Embed[Actor.stable readaloud="Construct Companion and Sword"]');
  });
  it("keeps ambiguous malformed nesting unchanged rather than granting an inner name binding", async () => {
    const f = await referenceFixture('<p>@Embed[Actor.stable readaloud="@ref[name] @ref[item.name]</p>',
      '<p>@Embed[Actor.stable readaloud="@ref[name] @ref[item.name]</p>');
    await api.translatedItemCard(f.source, f.native, "cs");
    expect(enrich).toHaveBeenCalledWith(f.target.system.actions[0].description, { relativeTo: f.source.actions[0], secrets: false });
  });
  it.each([
    '@UUID[Item.other]{<em>@ref[name]</em>}',
    '@Embed[Actor.stable caption="<em>@ref[name]</em> and @ref[item.name]"]',
  ])("does not bind names inside an outer command split across text nodes: %s", async command => {
    const text = `<p>${command} @ref[name].</p>`, f = await referenceFixture(text, text);
    enrich.mockImplementation(async (value, options) => nativeReferences(value, options));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    const input = enrich.mock.calls.find(([value]) => value.includes("<em>"))?.[0];
    expect(input).toContain(command);
    expect(result.querySelector(".actions .description em")?.textContent).toBe("Construct Companion");
    expect(result.querySelector(".actions .description")?.textContent).toContain("Sestrojit Společníka.");
  });
  it("keeps a split outer label protected across a hidden-section boundary", async () => {
    const text = '<div>@UUID[Item.other]{<section class="secret"><p>@ref[name]</p></section>}</div><p>@ref[item.name].</p>';
    const f = await referenceFixture(text, text);
    enrich.mockImplementation(async (value, options) => nativeReferences(value, options));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(enrich.mock.calls.find(([value]) => value.includes("secret"))?.[0]).toContain('<section class="secret"><p>@ref[name]</p></section>');
    expect(result.querySelector(".actions .secret")).toBeNull();
    expect(result.querySelector(".actions .description")?.textContent).toBe("@UUID[Item.other]{}Meč.");
  });
  it("inserts copied command-like names as terminal Text, never through an enricher or executable HTML", async () => {
    const f = await referenceFixture("<p>@ref[item.name].</p>", "<p>@ref[item.name].</p>");
    f.source.name = "Sword @UUID[Actor.stable]"; f.target.name = "Meč @UUID[Actor.stable]";
    f.native = f.native.replace('<h2>Sword</h2>', '<h2>Sword @UUID[Actor.stable]</h2>');
    f.target.flags["foundry-translate"].itemTranslation.sourceHash = await itemSourceHash(f.source.toObject());
    enrich.mockImplementation(async (value, options) => {
      expect(value).not.toContain("Meč @UUID");
      // A command passed into native enrichment would become an active link.
      return nativeReferences(value, options).replace("@UUID[Actor.stable]", '<a data-uuid="Actor.stable">Actor</a>');
    });
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".actions .description")?.textContent).toBe("Meč @UUID[Actor.stable].");
    expect(result.querySelector(".actions .description a")).toBeNull();
    expect(f.source.name).toBe("Sword @UUID[Actor.stable]");
  });
  it.each(["new-command", "new-markup", "changed-number", "blank"])("leaves an unproven Item name reference native for %s", async problem => {
    const f = await referenceFixture("<p>@ref[item.name].</p>", "<p>@ref[item.name].</p>");
    if (problem === "new-command") f.target.name = "Meč @UUID[Actor.foreign]";
    if (problem === "new-markup") f.target.name = '<img src="foreign">Meč';
    if (problem === "changed-number") f.target.name = "Meč 7";
    if (problem === "blank") f.target.name = " ";
    enrich.mockImplementation(async (value, options) => nativeReferences(value, options));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".actions .description")?.textContent).toBe(problem === "blank" ? "@ref[item.name]." : "Sword.");
    expect(result.querySelector(".actions .description img")).toBeNull();
  });
  it.each(["missing", "duplicate", "unknown", "attribute", "code"])("fails the affected Action presentation closed for an enriched %s marker", async problem => {
    const f = await referenceFixture("<p>@ref[name].</p>", "<p>@ref[name].</p>");
    enrich.mockImplementation(async value => {
      const marker = value.match(/FTCARDNAME[0-9a-f]+TOKEN0END/u)?.[0];
      if (!marker) return value;
      if (problem === "missing") return value.replace(marker, "");
      if (problem === "duplicate") return value + marker;
      if (problem === "unknown") return value + marker.replace("0END", "99END");
      if (problem === "attribute") return value.replace(marker, `<span title="${marker}"></span>`);
      return value.replace(marker, `<code>${marker}</code>`);
    });
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".actions")?.outerHTML).toBe(html(f.native).querySelector(".actions")?.outerHTML);
    expect(result.innerHTML).not.toContain("FTCARDNAME");
  });
  it("uses source/copy secret intersection and never binds names inside hidden source blocks", async () => {
    const f = await referenceFixture('<section class="secret"><p>@ref[name].</p></section><p>@ref[item.name].</p>',
      '<section class="secret"><p>@ref[name].</p></section><p>@ref[item.name].</p>');
    enrich.mockImplementation(async (value, options) => nativeReferences(value, options));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    const input = enrich.mock.calls.find(([value]) => value.includes("secret"))?.[0];
    expect(input).toContain('<section class="secret"><p>@ref[name].</p></section>');
    expect(result.querySelector(".actions .secret")).toBeNull();
    expect(result.querySelector(".actions .description")?.textContent).toBe("Meč.");
    expect(enrich.mock.calls.find(([value]) => value.includes("secret"))?.[1]?.secrets).toBe(false);
  });
  it("fails closed if native enrichment returns a hidden source block alongside a name marker", async () => {
    const f = await referenceFixture('<section class="secret"><p>@ref[name].</p></section><p>@ref[item.name].</p>',
      '<section class="secret"><p>@ref[name].</p></section><p>@ref[item.name].</p>');
    // The real native card has already suppressed the source secret.
    f.native = f.native.replace('<section class="secret"><p>@ref[name].</p></section>', "");
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".actions")?.outerHTML).toBe(html(f.native).querySelector(".actions")?.outerHTML);
    expect(result.querySelector(".actions .secret")).toBeNull();
  });
  it("also checks native secrecy when every relevant name reference is hidden", async () => {
    const secret = '<section class="secret"><p>@ref[name].</p></section>';
    const f = await referenceFixture(secret, secret);
    f.native = f.native.replace(secret, "<p>Visible native prose.</p>");
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(enrich).toHaveBeenCalledWith(secret, { relativeTo: f.source.actions[0], secrets: false });
    expect(result.querySelector(".actions")?.outerHTML).toBe(html(f.native).querySelector(".actions")?.outerHTML);
    expect(result.querySelector(".actions .secret")).toBeNull();
  });
  it("works with insecure-origin crypto that exposes getRandomValues but no randomUUID", async () => {
    const f = await referenceFixture("<p>@ref[name].</p>", "<p>@ref[name].</p>");
    const random = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues: random, subtle: crypto.subtle });
    enrich.mockImplementation(async (value, options) => nativeReferences(value, options));
    const result = html(await api.translatedItemCard(f.source, f.native, "cs"));
    expect(result.querySelector(".actions .description")?.textContent).toBe("Sestrojit Společníka.");
  });
  it.each(["source-name", "copy-name", "action-name", "prepared-range", "ownership", "user"])("discards name overlays after asynchronous %s drift", async change => {
    const f = await referenceFixture("<p>@ref[name] @ref[item.name] @ref[range.maximum].</p>",
      "<p>@ref[name] @ref[item.name] @ref[range.maximum].</p>");
    f.source.actions[0].range = { maximum: 5 };
    enrich.mockImplementation(async (value, options) => {
      if (value.includes("FTCARDNAME")) {
        if (change === "source-name") f.source.name = "Changed";
        if (change === "copy-name") f.target.name = "Changed";
        if (change === "action-name") f.source.actions[0].name = "Changed";
        if (change === "prepared-range") f.source.actions[0].range.maximum = 9;
        if (change === "ownership") f.source.isOwner = true;
        if (change === "user") game.user = { id: "different", isGM: false };
      }
      return nativeReferences(value, options);
    });
    expect(await api.translatedItemCard(f.source, f.native, "cs")).toBe(f.native);
  });
});
