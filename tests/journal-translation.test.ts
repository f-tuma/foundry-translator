import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import type { TranslationProvider } from "../src/providers/types";
import { translateJournalData, type JournalData } from "../src/translation/journal";

const translationProvider: TranslationProvider = {
  async translate(request) {
    return request.texts.map((text) => ({
      translatedText: text
        .replace("The Invitation", "Pozvání")
        .replace("Arrival", "Příchod")
        .replace("Appendix", "Dodatek")
        .replace("welcomes", "vítá")
        .replace("the heroes", "hrdiny"),
    }));
  },
  async testConnection() {},
};

describe("Journal translation", () => {
  it("creates translated copy data while preserving HTML, Foundry syntax, and source", async () => {
    const { document } = parseHTML("<html><body></body></html>");
    const source: JournalData = {
      _id: "journal-id",
      _stats: { modifiedTime: 123 },
      name: "The Invitation",
      pages: [
        {
          _id: "page-one",
          _stats: { modifiedTime: 123 },
          name: "Arrival",
          type: "ember.lore",
          text: {
            format: 1,
            content:
              '<p>Strahd welcomes <strong data-secret="keep">the heroes</strong>. @UUID[Actor.strahd]{Strahd}</p>',
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
    });

    expect(source).toEqual(original);
    expect(translated.data._id).toBeUndefined();
    expect(translated.data._stats).toBeUndefined();
    expect(translated.data.name).toBe("Pozvání [CS]");
    expect(translated.data.pages[0]?._stats).toBeUndefined();
    expect(translated.data.pages[0]?.name).toBe("Příchod");
    expect(translated.data.pages[0]?.text?.content).toBe(
      '<p>Strahd vítá <strong data-secret="keep">hrdiny</strong>. @UUID[Actor.strahd]{Strahd}</p>',
    );
    expect(translated.data.pages[0]?.type).toBe("ember.lore");
    expect(translated.data.pages[1]?.name).toBe("Dodatek");
    expect(translated.data.pages[1]?.text?.markdown).toBe("# Raw markdown");
    expect(translated.translatedTextPages).toBe(1);
    expect(translated.skippedTextPages).toBe(1);
    expect(translated.data.flags?.existing).toEqual({ keep: true });
    expect(translated.data.flags?.["foundry-translate"]?.translation).toMatchObject({
      schemaVersion: 1,
      sourceUuid: "JournalEntry.journal-id",
      providerId: "chrome-local",
      sourceLanguage: "en",
      targetLanguage: "cs",
    });
  });
});
