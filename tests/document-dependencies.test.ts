import { describe, expect, it } from "vitest";

import {
  discoverDocumentDependencies,
  discoverJournalDependencies,
  rewriteJournalDocumentReferences,
} from "../src/translation/document-dependencies";
import type { JournalData } from "../src/translation/journal";

describe("document dependency discovery", () => {
  it("finds Foundry links, embeds, and enriched HTML UUIDs", () => {
    const dependencies = discoverDocumentDependencies(
      '<p>@UUID[JournalEntry.guide.JournalEntryPage.intro]{Start}</p>' +
      '<p>@Embed[Actor.hero inline readaloud="Hero arrives"]</p>' +
      '<a data-uuid="Item.sword">Sword</a>',
      ["pages", 0, "text", "content"],
    );

    expect(dependencies).toEqual([
      expect.objectContaining({
        sourceUuid: "JournalEntry.guide.JournalEntryPage.intro",
        kind: "uuid",
      }),
      expect.objectContaining({ sourceUuid: "Actor.hero", kind: "embed" }),
      expect.objectContaining({ sourceUuid: "Item.sword", kind: "data-uuid" }),
    ]);
  });

  it("discovers references in custom page-system fields and deduplicates exact occurrences", () => {
    const source: JournalData = {
      name: "Guide",
      pages: [{
        name: "Page",
        type: "ember",
        text: { content: "@UUID[JournalEntry.other]{Other}" },
        system: { readaloud: '<div data-uuid="Actor.hero">Hero</div>' },
      }],
    };

    expect(discoverJournalDependencies(source)).toMatchObject([
      { sourceUuid: "JournalEntry.other", fieldPath: ["pages", 0, "text", "content"] },
      { sourceUuid: "Actor.hero", fieldPath: ["pages", 0, "system", "readaloud"] },
    ]);
  });

  it("strips anchors when discovering and keeps them when rewriting", () => {
    const dependencies = discoverDocumentDependencies(
      "<p>@UUID[JournalEntry.guide.JournalEntryPage.intro#resurrection]{Rules}</p>" +
      "<p>@UUID[.pageId#section]{Local}</p>",
    );
    expect(dependencies).toMatchObject([
      { sourceUuid: "JournalEntry.guide.JournalEntryPage.intro" },
      { sourceUuid: ".pageId" },
    ]);

    const source: JournalData = {
      name: "Guide",
      pages: [{
        name: "Page",
        type: "text",
        text: { content: "@UUID[JournalEntry.guide.JournalEntryPage.intro#resurrection]{Rules}" },
      }],
    };
    const rewritten = rewriteJournalDocumentReferences(source, [
      {
        sourceUuid: "JournalEntry.guide.JournalEntryPage.intro",
        translatedUuid: "Compendium.world.translations.JournalEntry.cs.JournalEntryPage.intro",
      },
    ]);
    expect(rewritten.pages[0]?.text?.content).toBe(
      "@UUID[Compendium.world.translations.JournalEntry.cs.JournalEntryPage.intro#resurrection]{Rules}",
    );
  });

  it("rewrites only UUID-bearing syntax and preserves page IDs and options", () => {
    const source: JournalData = {
      name: "Guide",
      pages: [{
        name: "Page",
        type: "text",
        text: {
          content:
            '@UUID[JournalEntry.guide.JournalEntryPage.intro]{Start} ' +
            '@Embed[Actor.hero inline readaloud="Hero arrives"] ' +
            '<a data-uuid="Item.sword">Item.sword</a>',
        },
      }],
    };
    const rewritten = rewriteJournalDocumentReferences(source, [
      {
        sourceUuid: "JournalEntry.guide.JournalEntryPage.intro",
        translatedUuid: "Compendium.world.translations.JournalEntry.cs-guide.JournalEntryPage.intro",
      },
      {
        sourceUuid: "Actor.hero",
        translatedUuid: "Compendium.world.actors.Actor.cs-hero",
      },
    ]);

    expect(rewritten.pages[0]?.text?.content).toBe(
      '@UUID[Compendium.world.translations.JournalEntry.cs-guide.JournalEntryPage.intro]{Start} ' +
      '@Embed[Compendium.world.actors.Actor.cs-hero inline readaloud="Hero arrives"] ' +
      '<a data-uuid="Item.sword">Item.sword</a>',
    );
    expect(source.pages[0]?.text?.content).toContain("@Embed[Actor.hero");
  });
});
