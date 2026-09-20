import { afterEach, expect, it, vi } from "vitest";
import { availableDocumentReferences } from "../src/translation/available-references";
import { TRANSLATIONS_PACK_ID } from "../src/translation/compendium-translation-repository";

afterEach(() => vi.unstubAllGlobals());
it("reuses existing translations, retains page IDs, and falls back for removed pages", async () => {
  const flag = { schemaVersion: 1, sourceUuid: "JournalEntry.guide", sourceHash: "hash", providerId: "chrome-local", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "today", translatedTextPages: 2, skippedTextPages: 0 };
  const collection = TRANSLATIONS_PACK_ID;
  const root = `Compendium.${collection}.JournalEntry.copy`;
  const pack = { collection, getIndex: vi.fn(async () => new Map([
    ["copy", { _id: "copy", flags: { "foundry-translate": { translation: flag } } }],
    ["de", { _id: "de", flags: { "foundry-translate": { translation: { ...flag, targetLanguage: "de" } } } }],
  ])) };
  vi.stubGlobal("game", { packs: new Map([[collection, pack]]) });
  vi.stubGlobal("fromUuid", vi.fn(async (id: string) => id.endsWith(".intro") ? { id: "intro" } : null));
  const result = await availableDocumentReferences({ content: "@UUID[JournalEntry.guide.JournalEntryPage.intro] @Embed[JournalEntry.guide.JournalEntryPage.removed] @UUID[Actor.unknown]" }, "cs");
  expect(result).toEqual([
    { sourceUuid: "JournalEntry.guide.JournalEntryPage.intro", translatedUuid: `${root}.JournalEntryPage.intro` },
    { sourceUuid: "JournalEntry.guide.JournalEntryPage.removed", translatedUuid: root },
  ]);
});
