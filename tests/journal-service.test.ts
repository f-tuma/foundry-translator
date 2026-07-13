import { describe, expect, it } from "vitest";

import { journalSourceHash, type JournalData } from "../src/translation/journal";
import { assertJournalSourceUnchanged } from "../src/translation/journal-service";

describe("Journal translation service protections", () => {
  it("includes page-category names in the source fingerprint", async () => {
    const source: JournalData = {
      name: "Guide",
      categories: [{ _id: "rules", name: "Playing the Game", sort: 100_000 }],
      pages: [{ name: "Rules", type: "text", category: "rules" }],
    };
    const changed: JournalData = structuredClone(source);
    changed.categories![0]!.name = "Running the Game";

    await expect(journalSourceHash(source)).resolves.not.toBe(
      await journalSourceHash(changed),
    );
  });

  it("refuses to save when the source changes during a long translation", async () => {
    const source: JournalData = {
      name: "Long Journal",
      pages: [{ name: "Page", type: "text", text: { format: 1, content: "<p>Before</p>" } }],
    };
    const changed: JournalData = structuredClone(source);
    changed.pages[0]!.text!.content = "<p>Changed while translating</p>";
    const document = {
      id: "long",
      uuid: "JournalEntry.long",
      name: source.name,
      toObject: () => changed,
    };

    await expect(
      assertJournalSourceUnchanged(document, await journalSourceHash(source)),
    ).rejects.toThrow(/během překladu změnil.*cache/);
  });
});
