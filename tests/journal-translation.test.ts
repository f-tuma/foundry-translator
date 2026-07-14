import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

import type { TranslationProvider } from "../src/providers/types";
import { MemoryTranslationCache } from "../src/translation/cache";
import {
  canReuseJournalTranslation,
  readJournalTranslationFlag,
  TRANSLATION_ENGINE_REVISION,
  translateJournalData,
  type JournalData,
} from "../src/translation/journal";

const translationProvider: TranslationProvider = {
  async translate(request) {
    return request.texts.map((text) => ({
      translatedText: text
        .replace("The Invitation", "Pozvání")
        .replace("Arrival", "Příchod")
        .replace("Appendix", "Dodatek")
        .replace("Opening Chapters", "Úvodní kapitoly")
        .replace("welcomes", "vítá")
        .replace("the heroes", "hrdiny")
        .replace("Player overview", "Přehled pro hráče")
        .replace("Hidden history", "Skrytá historie"),
    }));
  },
  async testConnection() {},
};

describe("Journal translation", () => {
  it("reads older translation flags as having no quality fallbacks", () => {
    const flag = readJournalTranslationFlag({
      "foundry-translate": {
        translation: {
          schemaVersion: 1,
          sourceUuid: "JournalEntry.old",
          sourceHash: "hash",
          providerId: "chrome-local",
          sourceLanguage: "en",
          targetLanguage: "cs",
          translatedAt: "2026-07-14T00:00:00.000Z",
          translatedTextPages: 1,
          skippedTextPages: 0,
        },
      },
    });
    expect(flag?.fallbackTextSegments).toBe(0);
    expect(flag?.engineRevision).toBe(0);
    expect(flag && canReuseJournalTranslation(flag, "hash")).toBe(false);
  });

  it("creates translated copy data while preserving HTML, Foundry syntax, and source", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source: JournalData = {
      _id: "journal-id",
      _stats: { modifiedTime: 123 },
      name: "The Invitation",
      categories: [
        {
          _id: "category-one",
          name: "Opening Chapters",
          sort: 100_000,
        },
      ],
      pages: [
        {
          _id: "page-one",
          _stats: { modifiedTime: 123 },
          name: "Arrival",
          category: "category-one",
          type: "ember.lore",
          text: {
            format: 1,
            content:
              '<p>Strahd welcomes <strong data-secret="keep">the heroes</strong>. @UUID[Actor.strahd]{Strahd}</p>',
          },
          system: {
            content: {
              overview: "<p>Player overview</p>",
              gamemaster: "<p>Hidden history</p>",
            },
          },
        },
        {
          _id: "page-two",
          name: "Appendix",
          type: "text",
          text: { format: 2, content: "Rendered", markdown: "# Raw markdown" },
        },
      ],
      flags: { existing: { keep: true } },
    };
    const original = structuredClone(source);

    const translated = await translateJournalData({
      source,
      sourceUuid: "JournalEntry.journal-id",
      glossary: [
        {
          source: "Strahd",
          replacement: "Strahd",
          category: "character",
          aliases: [],
        },
      ],
      provider: translationProvider,
      settings: {
        providerId: "chrome-local",
        sourceLanguage: "en",
        targetLanguage: "cs",
      },
      ownerDocument: document,
      nonceFactory: () => "JOURNAL",
      systemHtmlFieldPaths: [
        [
          ["content", "overview"],
          ["content", "gamemaster"],
        ],
        [],
      ],
    });

    expect(source).toEqual(original);
    expect(translated.data._id).toBeUndefined();
    expect(translated.data._stats).toBeUndefined();
    expect(translated.data.name).toBe("Pozvání [CS]");
    expect(translated.data.categories).toEqual([
      {
        _id: "category-one",
        name: "Úvodní kapitoly",
        sort: 100_000,
      },
    ]);
    expect(translated.data.pages[0]?.category).toBe("category-one");
    expect(translated.data.pages[0]?._stats).toBeUndefined();
    expect(translated.data.pages[0]?.name).toBe("Příchod");
    expect(translated.data.pages[0]?.text?.content).toBe(
      '<p>Strahd vítá <strong data-secret="keep">hrdiny</strong>. @UUID[Actor.strahd]{Strahd}</p>',
    );
    expect(translated.data.pages[0]?.type).toBe("ember.lore");
    expect(translated.data.pages[0]?.system).toMatchObject({
      content: {
        overview: "<p>Přehled pro hráče</p>",
        gamemaster: "<p>Skrytá historie</p>",
      },
    });
    expect(translated.data.pages[1]?.name).toBe("Dodatek");
    expect(translated.data.pages[1]?.text?.markdown).toBe("# Raw markdown");
    expect(translated.translatedTextPages).toBe(1);
    expect(translated.skippedTextPages).toBe(1);
    expect(translated.fallbackTextSegments).toBe(0);
    expect(translated.data.flags?.existing).toEqual({ keep: true });
    expect(translated.data.flags?.["foundry-translate"]?.translation).toMatchObject({
      schemaVersion: 1,
      engineRevision: TRANSLATION_ENGINE_REVISION,
      sourceUuid: "JournalEntry.journal-id",
      providerId: "chrome-local",
      sourceLanguage: "en",
      targetLanguage: "cs",
      fallbackTextSegments: 0,
    });
    const currentFlag = readJournalTranslationFlag(translated.data.flags);
    expect(currentFlag && canReuseJournalTranslation(currentFlag, currentFlag.sourceHash)).toBe(true);
  });

  it("finishes the journal and reports a fragment kept in the original", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source: JournalData = {
      name: "Guide",
      pages: [{
        name: "Overview",
        type: "text",
        text: {
          format: 1,
          content: "<p>The heroes enter the castle.</p><p>Welcome home.</p>",
        },
      }],
    };
    const qualityFallback = vi.fn();
    const provider: TranslationProvider = {
      async translate({ texts }) {
        return texts.map((text) => ({
          translatedText: text
            .replace("Guide", "Průvodce")
            .replace("Overview", "Přehled")
            .replace("Welcome home", "Vítejte doma"),
        }));
      },
      async testConnection() {},
    };

    const translated = await translateJournalData({
      source,
      sourceUuid: "JournalEntry.guide",
      glossary: [],
      provider,
      settings: {
        providerId: "chrome-local",
        sourceLanguage: "en",
        targetLanguage: "cs",
      },
      ownerDocument: document,
      nonceFactory: () => "GRACEFUL",
      onQualityFallback: qualityFallback,
    });

    expect(translated.data.name).toBe("Průvodce [CS]");
    expect(translated.data.pages[0]?.name).toBe("Přehled");
    expect(translated.data.pages[0]?.text?.content).toBe(
      "<p>The heroes enter the castle.</p><p>Vítejte doma.</p>",
    );
    expect(translated.fallbackTextSegments).toBe(1);
    expect(qualityFallback).toHaveBeenCalledWith(expect.objectContaining({
      reason: "unchanged",
      attempts: 3,
    }));
    expect(translated.data.flags?.["foundry-translate"]?.translation).toMatchObject({
      fallbackTextSegments: 1,
    });
  });

  it("commits cache page by page and resumes after a middle page fails", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source: JournalData = {
      name: "Long Journal",
      pages: ["First", "Second", "Third"].map((name) => ({
        name,
        type: "text",
        text: { format: 1, content: `<p>${name} content.</p>` },
      })),
    };
    const cache = new MemoryTranslationCache();
    const translatedInputs: string[] = [];
    let failSecond = true;
    const provider: TranslationProvider = {
      async translate({ texts }) {
        translatedInputs.push(...texts);
        if (failSecond && texts.some((text) => text.includes("Second"))) {
          failSecond = false;
          throw new Error("Temporary provider failure");
        }
        return texts.map((text) => ({ translatedText: text }));
      },
      async testConnection() {},
    };
    const firstProgress = vi.fn();
    const options = {
      source,
      sourceUuid: "JournalEntry.long",
      glossary: [],
      provider,
      settings: {
        providerId: "chrome-local" as const,
        sourceLanguage: "en",
        targetLanguage: "cs",
      },
      cache,
      ownerDocument: document,
      nonceFactory: () => "LONG",
    };

    await expect(translateJournalData({ ...options, onProgress: firstProgress })).rejects.toThrow(
      /stránky 2\/3.*Second.*cache/,
    );
    expect(firstProgress).toHaveBeenCalledTimes(1);

    const secondProgress = vi.fn();
    const translated = await translateJournalData({ ...options, onProgress: secondProgress });

    expect(translated.translatedTextPages).toBe(3);
    expect(secondProgress.mock.calls.map(([progress]) => progress.completedPages)).toEqual([1, 2, 3]);
    expect(translatedInputs.filter((text) => text.includes("Long Journal"))).toHaveLength(1);
    expect(translatedInputs.filter((text) => text.includes("First"))).toHaveLength(2);
    expect(translatedInputs.filter((text) => text.includes("Second"))).toHaveLength(4);
  });
});
