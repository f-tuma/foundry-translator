import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectNameContexts } from "../src/glossary/name-context";

describe("glossary name context", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("takes the entity description and nearby source mentions, excluding translated copies and unrelated fields", () => {
    vi.stubGlobal("document", parseHTML("<html></html>").document);
    const result = collectNameContexts([{ source: "Old Carinth", replacement: "Old Carinth", category: "location", aliases: [], sourceUuid: "Page.old" }], {
      actors: [], scenes: [], journals: [
        { pages: { contents: [{ name: "Old Carinth", uuid: "Page.old", toObject: () => ({ system: { overview: "<p>A ruined settlement.</p><script>bad()</script>", development: { notes: "internal-not-for-context" }, secretToken: "do-not-send" } }) },
          { name: "Road", toObject: () => ({ text: { content: "<p>The road from @UUID[Page.old]{Old Carinth} crosses the river.</p>" } }) }] } },
        { flags: { "foundry-translate": { translation: {} } }, pages: { contents: [{ name: "Old Carinth", toObject: () => ({ text: { content: "Old Carinth translated-copy-must-not-be-used" } }) }] } },
      ],
    }).get("Old Carinth");
    expect(result).toContain("A ruined settlement.");
    expect(result).toContain("The road from Old Carinth crosses the river.");
    expect(result).not.toMatch(/bad\(\)|internal-not-for-context|do-not-send|translated-copy|@UUID/);
    expect(result!.length).toBeLessThanOrEqual(1200);
  });
});
