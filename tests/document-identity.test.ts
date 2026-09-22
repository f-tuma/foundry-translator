import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDocumentReference, resolveSourceReference, resolveTranslationReference, sourceReferenceUuid } from "../src/translation/document-identity";

export function journalIdentity(sourceUuid = "JournalEntry.source", language = "cs") {
  return { "foundry-translate": { translation: { schemaVersion: 1, sourceUuid, sourceHash: "hash", providerId: "openai-compatible",
    sourceLanguage: "en", targetLanguage: language, translatedAt: "now", translatedTextPages: 1, skippedTextPages: 0 } } };
}
function fixture() {
  const source = { id: "source", uuid: "JournalEntry.source" };
  const translation = { id: "copy", uuid: "Compendium.world.foundry-translate-translations.JournalEntry.copy", flags: journalIdentity() };
  const sourcePage = { id: "page", uuid: `${source.uuid}.JournalEntryPage.page` };
  const targetPage = { id: "page", uuid: `${translation.uuid}.JournalEntryPage.page` };
  const documents = new Map<string, any>([source, translation, sourcePage, targetPage].map(doc => [doc.uuid, doc]));
  const index = new Map([["copy", { _id: "copy", flags: translation.flags }]]);
  vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => documents.get(uuid) ?? null));
  vi.stubGlobal("game", { packs: new Map([["world.foundry-translate-translations", {
    getIndex: async () => index, getDocument: async (id: string) => documents.get(translation.uuid.replace(/copy$/u, id)),
  }]]) });
  return { source, translation, sourcePage, targetPage, documents, index };
}
afterEach(() => vi.unstubAllGlobals());

describe("bidirectional document identity", () => {
  it("round-trips page identity and anchors without names or writes", async () => {
    const f = fixture();
    const sourceUuid = f.sourcePage.uuid + "#heading";
    const translatedUuid = f.targetPage.uuid + "#heading";
    const expected = { sourceUuid, translatedUuid, status: "mapped" };
    expect(await resolveTranslationReference(sourceUuid, "cs")).toEqual(expected);
    expect(await resolveTranslationReference(translatedUuid, "cs")).toEqual(expected);
    expect(await resolveTranslationReference(translatedUuid, "cs")).toEqual(expected);
    expect(sourceReferenceUuid(translatedUuid, f.translation)).toBe(sourceUuid);
  });
  it("does not confuse languages", async () => {
    const f = fixture();
    expect(await resolveTranslationReference(f.targetPage.uuid, "de")).toEqual({ sourceUuid: f.sourcePage.uuid, translatedUuid: null, status: "source-only" });
  });
  it("refuses duplicate translations independently of index order", async () => {
    const f = fixture(); f.index.set("duplicate", { _id: "duplicate", flags: journalIdentity() });
    expect((await resolveTranslationReference(f.source.uuid, "cs")).status).toBe("ambiguous");
  });
  it("does not open a different page when an embedded page is missing", async () => {
    const f = fixture(); f.documents.delete(f.targetPage.uuid);
    expect((await resolveTranslationReference(f.sourcePage.uuid, "cs")).status).toBe("missing");
  });
  it("rechecks deletion and replacement without a stale mapping cache", async () => {
    const f = fixture(); expect((await resolveTranslationReference(f.source.uuid, "cs")).status).toBe("mapped");
    f.documents.delete(f.translation.uuid);
    expect((await resolveTranslationReference(f.source.uuid, "cs")).status).toBe("invalid");
    f.documents.set(f.translation.uuid, { ...f.translation, flags: journalIdentity("JournalEntry.other") });
    expect((await resolveTranslationReference(f.source.uuid, "cs")).status).toBe("invalid");
  });
  it("rejects missing sources and translation cycles", async () => {
    const f = fixture();
    f.documents.set(f.source.uuid, { ...f.source, flags: journalIdentity(f.translation.uuid) });
    expect((await resolveTranslationReference(f.translation.uuid, "cs")).status).toBe("invalid");
    f.documents.delete(f.source.uuid);
    expect((await resolveTranslationReference(f.translation.uuid, "cs")).status).toBe("missing");
  });
  it.each([".page", "JournalEntry.sourceExtra.", "Actor.a.JournalEntryPage", "Scene.s", "JournalEntry.a b", "Compendium.x.Actor.a"])("rejects unsupported/malformed reference %s", uuid => {
    expect(parseDocumentReference(uuid)).toBeNull();
  });
  it("refuses cross-type or self-referential metadata", () => {
    const f = fixture();
    expect(sourceReferenceUuid(f.targetPage.uuid, { ...f.translation, flags: journalIdentity("Actor.source") })).toBeNull();
    expect(sourceReferenceUuid(f.targetPage.uuid, { ...f.translation, flags: journalIdentity(f.translation.uuid) })).toBeNull();
  });
});

it("resolves the original even when the translation index is broken", async () => {
 const f=fixture(); vi.stubGlobal("game", {packs: new Map()});
 expect(await resolveSourceReference(f.targetPage.uuid)).toBe(f.sourcePage.uuid);
});

it.each(["Actor", "Item"])("maps %s copies with language-aware identity", async type => {
 const packId = type === "Actor" ? "world.foundry-translate-actors" : "world.foundry-translate-items";
 const key = type === "Actor" ? "actorTranslation" : "itemTranslation";
 const source = { id:"source", uuid:type+".source" };
 const translation = {id:"copy",uuid:`Compendium.${packId}.${type}.copy`,flags:{"foundry-translate":{[key]:{...journalIdentity()["foundry-translate"].translation,sourceUuid:source.uuid,translatedHtmlFields:1}}}};
 const docs=new Map([source,translation].map(d=>[d.uuid,d]));
 vi.stubGlobal("fromUuid",async(uuid:string)=>docs.get(uuid));
 vi.stubGlobal("game",{packs:new Map([[packId,{getIndex:async()=>new Map([["copy",{_id:"copy",flags:translation.flags}]]),getDocument:async()=>translation}]])});
 expect(await resolveTranslationReference(translation.uuid,"cs")).toEqual({sourceUuid:source.uuid,translatedUuid:translation.uuid,status:"mapped"});
});
