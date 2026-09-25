import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTranslatedJournalEmbeds } from "../src/translation/translated-journal-embeds";
import { resolveTranslationReference } from "../src/translation/document-identity";

vi.mock("../src/translation/document-identity", async importOriginal => ({
  ...await importOriginal<typeof import("../src/translation/document-identity")>(),
  resolveTranslationReference: vi.fn(),
}));
const resolve = vi.mocked(resolveTranslationReference);
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function fixture() {
  const flags = { "foundry-translate": { translation: {
    schemaVersion: 1, sourceUuid: "JournalEntry.source", sourceHash: "hash", providerId: "openai-compatible",
    sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedTextPages: 1, skippedTextPages: 0,
    partial: false, processedPageIds: [] as string[],
  } } };
  const source = { uuid: "JournalEntry.source.JournalEntryPage.page", id: "page", documentName: "JournalEntryPage", type: "text", visible: true, isOwner: true };
  const parent = { id: "copy", uuid: "Compendium.world.foundry-translate-translations.JournalEntry.copy", documentName: "JournalEntry", flags };
  const target = { ...source, uuid: `${parent.uuid}.JournalEntryPage.page`, parent };
  const original = vi.fn(async function(this: { uuid: string }, _config: any, _options: any) { return { uuid: this.uuid } as unknown as HTMLElement; });
  const prototype = { toEmbed: original };
  vi.stubGlobal("CONFIG", { JournalEntryPage: { documentClass: { prototype } } });
  vi.stubGlobal("fromUuid", vi.fn(async () => target));
  resolve.mockResolvedValue({ sourceUuid: source.uuid, translatedUuid: target.uuid, status: "mapped" });
  registerTranslatedJournalEmbeds();
  const invoke = (doc = source, options: any = { relativeTo: { parent } }, config = {}) => prototype.toEmbed.call(doc, config, options);
  return { source, target, parent, flags, original, prototype, invoke };
}

describe("translated journal text embeds", () => {
  it("uses a later-created translation without rewriting the stored embed, preserving configuration and depth", async () => {
    const f = fixture();
    const options = { relativeTo: f.parent, _embedDepth: 2, documents: false, links: true, secrets: false };
    const config = { uuid: f.source.uuid, label: "Explicit caption", inline: true };
    expect(await f.invoke(f.source, options, config)).toEqual({ uuid: f.target.uuid });
    expect(resolve).toHaveBeenCalledWith(f.source.uuid, "cs");
    expect(f.original).toHaveBeenCalledWith(config, options);
    expect(config.uuid).toBe(f.source.uuid);
  });
  it("does not redirect original views, unscoped calls or gameplay/image embeds", async () => {
    const f = fixture();
    await f.invoke(f.source, {});
    await f.invoke(f.source, { relativeTo: { documentName: "JournalEntry" } });
    await f.invoke({ ...f.source, type: "event" });
    await f.invoke({ ...f.source, type: "image" });
    expect(resolve).not.toHaveBeenCalled();
    expect(f.original.mock.instances).toEqual([f.source, f.source, expect.objectContaining({ type: "event" }), expect.objectContaining({ type: "image" })]);
  });
  it("registers once and leaves an already translated page alone", async () => {
    const f = fixture(); const wrapped = f.prototype.toEmbed;
    registerTranslatedJournalEmbeds();
    expect(f.prototype.toEmbed).toBe(wrapped);
    expect(await f.invoke(f.target)).toEqual({ uuid: f.target.uuid });
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each(["ember.lore", "ember.ancestry", "ember.location"])("renders reviewed %s prose through its native embed implementation", async type => {
    const f = fixture(); f.source.type = type; f.target.type = type;
    const config = { values: ["overview", "inline"] };
    expect(await f.invoke(f.source, { relativeTo: f.parent }, config)).toEqual({ uuid: f.target.uuid });
    expect(f.original).toHaveBeenCalledWith(config, expect.any(Object));
  });
  it.each(["ember.quest", "ember.questEvent", "ember.standaloneEvent", "ember.biome", "unknown.custom"])("does not redirect %s models", async type => {
    const f = fixture(); f.source.type = type;
    expect(await f.invoke()).toEqual({ uuid: f.source.uuid });
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each(["missing", "ambiguous", "invalid", "source-only"] as const)("keeps the source on %s mappings", async status => {
    const f = fixture(); resolve.mockResolvedValue({ sourceUuid: f.source.uuid, translatedUuid: null, status });
    expect(await f.invoke()).toEqual({ uuid: f.source.uuid });
  });
  it("only uses completed pages in a partial guide", async () => {
    const f = fixture(); f.flags["foundry-translate"].translation.partial = true;
    expect(await f.invoke()).toEqual({ uuid: f.source.uuid });
    f.flags["foundry-translate"].translation.processedPageIds.push("page");
    expect(await f.invoke()).toEqual({ uuid: f.target.uuid });
  });
  it("rechecks target language, type and visibility after resolution", async () => {
    const f = fixture();
    f.flags["foundry-translate"].translation.targetLanguage = "de";
    expect(await f.invoke(f.source, { relativeTo: { ...f.parent, flags: { "foundry-translate": { translation: { ...f.flags["foundry-translate"].translation, targetLanguage: "cs" } } } } })).toEqual({ uuid: f.source.uuid });
    f.flags["foundry-translate"].translation.targetLanguage = "cs";
    f.target.type = "event"; expect(await f.invoke()).toEqual({ uuid: f.source.uuid });
    f.target.type = "text"; f.target.visible = false;
    expect(await f.invoke()).toEqual({ uuid: f.source.uuid });
  });
  it("never widens the source's implicit secret visibility", async () => {
    const f = fixture(); f.source.isOwner = false;
    await f.invoke();
    expect(f.original).toHaveBeenLastCalledWith({}, expect.objectContaining({ secrets: false }));
  });
  it("falls back if resolving or rendering a translation fails", async () => {
    const f = fixture(); vi.spyOn(console, "warn").mockImplementation(() => {});
    resolve.mockRejectedValueOnce(new Error("Unavailable index"));
    expect(await f.invoke()).toEqual({ uuid: f.source.uuid });
    f.original.mockRejectedValueOnce(new Error("Unavailable page"));
    expect(await f.invoke()).toEqual({ uuid: f.source.uuid });
    vi.restoreAllMocks();
  });
});
