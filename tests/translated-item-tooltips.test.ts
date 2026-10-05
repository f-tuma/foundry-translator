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
