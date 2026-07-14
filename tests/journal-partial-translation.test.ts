import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import type { TranslationProvider } from "../src/providers/types";
import {
  canReuseJournalPageTranslation,
  canReuseJournalTranslation,
  mergePartialJournalTranslation,
  readJournalTranslationFlag,
  translateJournalData,
  type JournalData,
} from "../src/translation/journal";

const provider: TranslationProvider = {
  async translate({ texts }) {
    return texts.map((text) => ({
      translatedText: text
        .replaceAll("First page text.", "Text první stránky.")
        .replaceAll("Second page text.", "Text druhé stránky.")
        .replaceAll("Guide", "Průvodce")
        .replaceAll("First", "První")
        .replaceAll("Second", "Druhá"),
    }));
  },
  async testConnection() {},
};

function source(): JournalData {
  return {
    name: "Guide",
    pages: [
      {
        _id: "page-one",
        name: "First",
        type: "text",
        text: { format: 1, content: "<p>First page text.</p>" },
      },
      {
        _id: "page-two",
        name: "Second",
        type: "text",
        text: { format: 1, content: "<p>Second page text.</p>" },
      },
    ],
  };
}

async function translatePage(pageId: string) {
  const { document } = parseHTML("<html><body></body></html>");
  return translateJournalData({
    source: source(),
    sourceUuid: "JournalEntry.guide",
    glossary: [],
    provider,
    settings: { providerId: "chrome-local", sourceLanguage: "en", targetLanguage: "cs" },
    pageIds: [pageId],
    ownerDocument: document,
    nonceFactory: () => "PARTIAL",
  });
}

describe("Partial journal page translation", () => {
  it("translates only the selected page and records a partial flag", async () => {
    const result = await translatePage("page-one");

    expect(result.data.pages[0]?.name).toBe("První");
    expect(result.data.pages[0]?.text?.content).toBe("<p>Text první stránky.</p>");
    expect(result.data.pages[1]?.name).toBe("Second");
    expect(result.data.pages[1]?.text?.content).toBe("<p>Second page text.</p>");
    expect(result.translatedTextPages).toBe(1);

    const flag = readJournalTranslationFlag(result.data.flags);
    expect(flag?.partial).toBe(true);
    expect(flag?.processedPageIds).toEqual(["page-one"]);
    expect(flag && canReuseJournalTranslation(flag, flag.sourceHash)).toBe(false);
    expect(flag && canReuseJournalPageTranslation(flag, flag.sourceHash, "page-one")).toBe(true);
    expect(flag && canReuseJournalPageTranslation(flag, flag.sourceHash, "page-two")).toBe(false);
  });

  it("merges two partial translations into a complete one", async () => {
    const first = await translatePage("page-one");
    const second = await translatePage("page-two");

    const merged = mergePartialJournalTranslation(first.data, second.data);
    expect(merged.pages[0]?.text?.content).toBe("<p>Text první stránky.</p>");
    expect(merged.pages[1]?.text?.content).toBe("<p>Text druhé stránky.</p>");

    const flag = readJournalTranslationFlag(merged.flags);
    expect(flag?.partial).toBe(false);
    expect(flag?.processedPageIds).toEqual(["page-one", "page-two"]);
    expect(flag?.translatedTextPages).toBe(2);
    expect(flag && canReuseJournalTranslation(flag, flag.sourceHash)).toBe(true);
  });

  it("does not reuse a translation made with a different glossary", async () => {
    const result = await translatePage("page-one");
    const flag = readJournalTranslationFlag(result.data.flags);
    expect(flag?.glossaryFingerprint).toBeTruthy();
    expect(flag && canReuseJournalPageTranslation(flag, flag.sourceHash, "page-one", flag.glossaryFingerprint)).toBe(true);
    expect(flag && canReuseJournalPageTranslation(flag, flag.sourceHash, "page-one", "changed-glossary")).toBe(false);
  });

  it("keeps a partial result unchanged when the existing translation is stale", async () => {
    const fresh = await translatePage("page-one");
    const stale = structuredClone(fresh.data);
    const staleFlag = readJournalTranslationFlag(stale.flags);
    if (staleFlag) {
      staleFlag.sourceHash = "outdated";
      staleFlag.partial = true;
      staleFlag.processedPageIds = ["page-two"];
      stale.flags!["foundry-translate"]!.translation = staleFlag;
    }

    const merged = mergePartialJournalTranslation(stale, fresh.data);
    expect(merged).toEqual(fresh.data);
  });
});
