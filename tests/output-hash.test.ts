import { describe, expect, it } from "vitest";

import { hasManualOutputEdits, translatedOutputHash } from "../src/translation/output-hash";

describe("translated output fingerprints", () => {
  it("ignores Foundry bookkeeping and flags", async () => {
    const generated = {
      name: "Guide [CS]",
      pages: [{ _id: "page", name: "Úvod", _stats: { modifiedTime: 1 } }],
      flags: { "foundry-translate": { translation: { outputHash: "old" } } },
    };
    const stored = {
      ...generated,
      _id: "stored-id",
      folder: "folder-id",
      ownership: { default: 2 },
      sort: 100,
      pages: [{ _id: "page", name: "Úvod", _stats: { modifiedTime: 999 } }],
      flags: { "foundry-translate": { translation: { outputHash: "new" } } },
    };
    await expect(translatedOutputHash(stored)).resolves.toBe(await translatedOutputHash(generated));
  });

  it("detects a manual content correction", async () => {
    const generated = { name: "Guide [CS]", pages: [{ name: "Úvod" }] };
    const expected = await translatedOutputHash(generated);
    expect(await hasManualOutputEdits(
      { name: "Guide [CS]", pages: [{ name: "Ruční oprava" }] },
      expected,
    )).toBe(true);
    expect(await hasManualOutputEdits(generated, undefined)).toBe(false);
  });

  it("is stable when Foundry reorders hydrated document fields", async () => {
    const generated = {
      name: "Guide [CS]",
      pages: [{
        _id: "page",
        name: "Úvod",
        type: "text",
        text: { format: 1, content: "<p>Vítejte.</p>" },
      }],
    };
    const hydrated = {
      pages: [{
        text: { content: "<p>Vítejte.</p>", format: 1 },
        type: "text",
        name: "Úvod",
        _id: "page",
      }],
      name: "Guide [CS]",
    };

    await expect(translatedOutputHash(hydrated)).resolves.toBe(
      await translatedOutputHash(generated),
    );
  });
});
