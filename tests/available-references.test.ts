import { afterEach, expect, it, vi } from "vitest";
import { availableDocumentReferences } from "../src/translation/available-references";
import { rewriteDocumentReferences } from "../src/translation/document-dependencies";

afterEach(() => vi.unstubAllGlobals());
const examples = [
  { kind: "JournalEntry", source: "JournalEntry.guide", copy: "Compendium.world.foundry-translate-translations.JournalEntry.copy", pack: "world.foundry-translate-translations", key: "translation", suffix: ".JournalEntryPage.intro" },
  { kind: "Actor", source: "Actor.bird", copy: "Compendium.world.foundry-translate-actors.Actor.copy", pack: "world.foundry-translate-actors", key: "actorTranslation", suffix: ".Item.call" },
  { kind: "Item", source: "Item.rope", copy: "Compendium.world.foundry-translate-items.Item.copy", pack: "world.foundry-translate-items", key: "itemTranslation", suffix: "" },
];
function stubPack(e: typeof examples[number], duplicate = false) {
  const flag = { schemaVersion: 1, sourceUuid: e.source, sourceHash: "hash", providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "today", translatedTextPages: 2, skippedTextPages: 0, translatedHtmlFields: 2 };
  const row = { _id: "copy", flags: { "foundry-translate": { [e.key]: flag } } };
  const rows = new Map([["copy", row], ["de", { _id: "de", flags: { "foundry-translate": { [e.key]: { ...flag, targetLanguage: "de" } } } }]]);
  if (duplicate) rows.set("duplicate", { ...row, _id: "duplicate" });
  vi.stubGlobal("game", { packs: new Map([[e.pack, { collection: e.pack, getIndex: vi.fn(async () => rows) }]]) });
}

it.each(examples)("reuses the exact available $kind root", async e => {
  stubPack(e); vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => ({ uuid, documentName: e.kind })));
  expect(await availableDocumentReferences({ content: `@UUID[${e.source}]{Name}` }, "cs")).toEqual([{ sourceUuid: e.source, translatedUuid: e.copy }]);
});

it.each(examples.slice(0, 2))("retains the exact available $kind embedded suffix and anchor", async e => {
  stubPack(e); const target = e.copy + e.suffix;
  const resolve = vi.fn(async (uuid: string) => uuid === target ? { uuid } : null); vi.stubGlobal("fromUuid", resolve);
  const original = { content: `@UUID[${e.source}${e.suffix}#chapter]{Call} @Embed[${e.source}${e.suffix}#chapter inline caption="Czech caption"]` };
  const replacements = await availableDocumentReferences(original, "cs");
  expect(replacements).toEqual([
    { sourceUuid: e.source + e.suffix, translatedUuid: target },
    { sourceUuid: e.source + e.suffix, translatedUuid: target },
  ]);
  expect(rewriteDocumentReferences(original, replacements)).toEqual({ content: `@UUID[${target}#chapter]{Call} @Embed[${target}#chapter inline caption="Czech caption"]` });
  expect(resolve.mock.calls.every(([uuid]) => uuid === target)).toBe(true);
});

const failures = examples.slice(0, 2).flatMap(e => ["missing", "inaccessible", "different-uuid"].map(failure => ({ ...e, failure })));
it.each(failures)("preserves original $kind child commands when $failure", async e => {
  stubPack(e); const resolve = vi.fn(async (_uuid: string) => {
    if (e.failure === "inaccessible") throw Error("unavailable");
    return e.failure === "different-uuid" ? { uuid: e.copy } : null;
  }); vi.stubGlobal("fromUuid", resolve);
  const original = { content: `@UUID[${e.source}${e.suffix}#section]{Český Název} @Embed[${e.source}${e.suffix}#section inline readaloud="Čtěte Nahlas"] <a data-uuid="${e.source}${e.suffix}">Odkaz</a>` };
  const replacements = await availableDocumentReferences(original, "cs");
  expect(replacements).toEqual([]);
  expect(rewriteDocumentReferences(original, replacements)).toEqual(original);
  expect(resolve.mock.calls.every(([uuid]) => uuid === e.copy + e.suffix)).toBe(true);
});

it.each(examples)("preserves the original $kind root when its translated root is inaccessible", async e => {
  stubPack(e); vi.stubGlobal("fromUuid", vi.fn(async () => { throw Error("unavailable"); }));
  const original = { content: `@Embed[${e.source} count=2]{Český Název}` };
  const replacements = await availableDocumentReferences(original, "cs");
  expect(replacements).toEqual([]); expect(rewriteDocumentReferences(original, replacements)).toEqual(original);
});

it.each(examples.slice(0, 2))("never chooses between duplicate $kind translation roots", async e => {
  stubPack(e, true); const resolve = vi.fn(); vi.stubGlobal("fromUuid", resolve);
  expect(await availableDocumentReferences({ content: `@UUID[${e.source}${e.suffix}]` }, "cs")).toEqual([]);
  expect(resolve).not.toHaveBeenCalled();
});

it("is idempotent after available links are rewritten and missing children remain original", async () => {
  const e = examples[0]!; stubPack(e);
  vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => uuid === e.copy + e.suffix ? { uuid } : null));
  const original = { content: `@UUID[${e.source}${e.suffix}#intro]{Úvod} @Embed[${e.source}.JournalEntryPage.removed] <a data-uuid="${e.source}${e.suffix}">Úvod</a>` };
  const first = rewriteDocumentReferences(original, await availableDocumentReferences(original, "cs"));
  expect(first.content).toBe(`@UUID[${e.copy}${e.suffix}#intro]{Úvod} @Embed[${e.source}.JournalEntryPage.removed] <a data-uuid="${e.copy}${e.suffix}">Úvod</a>`);
  expect(rewriteDocumentReferences(first, await availableDocumentReferences(first, "cs"))).toEqual(first);
});
