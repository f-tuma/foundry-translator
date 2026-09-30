import type { TranslationBundle } from "../../../src/bundles/format";
export function fixture(): TranslationBundle {
  return { format: "foundry-translate-bundle", version: 3, createdAt: "2026-09-30", moduleVersion: "0.29.2",
    systemId: "crucible", systemVersion: "0.11.0", targetLanguage: "cs",
    glossary: [
      { source: "Old Carinth", replacement: "Starý Carinth", aliases: [], category: "location", mode: "inflect" },
      { source: "Ember", replacement: "Ember", aliases: [], category: "lore" },
    ], documents: [
      { kind: "JournalEntry", sourceUuid: "JournalEntry.guide", sourceName: "Guide", sourceFingerprint: "a".repeat(64),
        partial: false, processedPageIds: ["page"], fallbackTextSegments: 0, providerId: "openai-compatible", sourceLanguage: "en", translatedAt: "2026-09-30", engineRevision: 12,
        patches: [
          { path: ["name"], format: "text", source: "Guide", translation: "Příručka" },
          { path: ["pages", 0, "name"], format: "text", source: "Journey", translation: "Cesta" },
          { path: ["pages", 0, "text", "content"], format: "html",
            source: '<h2>Arrival</h2><p>The travellers entered Old Carinth.</p><p>In Ember, meet @UUID[Actor.scout]{Scout}, <strong>then</strong> see @Embed[JournalEntry.other inline]{Notes}.</p><p>Pay 3 coins.</p>',
            translation: '<h2>Příchod</h2><p>Poutníci vstoupil do Starého Carinthu.</p><p>V Ember potkej @UUID[Actor.scout]{Zvěd}, <strong>pak</strong> viz @Embed[JournalEntry.other inline]{Poznámky}.</p><p>Zaplať 3 mince.</p>' },
        ] },
      { kind: "Actor", sourceUuid: "Actor.scout", sourceName: "Scout", sourceFingerprint: "b".repeat(64),
        partial: false, processedPageIds: [], fallbackTextSegments: 0, providerId: "openai-compatible", sourceLanguage: "en", translatedAt: "2026-09-30", engineRevision: 12,
        patches: [{ path: ["name"], format: "text", source: "Scout", translation: "Zvěd" }] },
    ] };
}
