import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTranslationWriteGuard, captureTranslationWriteGuard } from "../src/translation/write-guard";

beforeEach(() => vi.stubGlobal("game", { i18n: { localize: (key: string) => key } }));
afterEach(() => vi.unstubAllGlobals());

function document() {
  const data = { name: "Průvodce", pages: [{ _id: "page", name: "Úvod", text: { content: "Původní překlad" } }], flags: { translator: { source: "original" } }, _stats: { modifiedTime: 1 } };
  return { id: "copy", data, toObject: () => structuredClone(data) };
}

describe("translation write guard", () => {
  it("accepts the unchanged copy and volatile Foundry bookkeeping", async () => {
    const doc = document();
    const guard = await captureTranslationWriteGuard(doc);
    doc.data._stats.modifiedTime = 2;
    await expect(assertTranslationWriteGuard(doc, guard)).resolves.toBeUndefined();
  });
  it("rejects edits made after the run took its snapshot", async () => {
    const doc = document();
    const guard = await captureTranslationWriteGuard(doc);
    doc.data.pages[0]!.text.content = "Ruční oprava během pauzy";
    await expect(assertTranslationWriteGuard(doc, guard)).rejects.toThrow("OutputChanged");
  });
  it("rejects changed translation metadata even when the prose is identical", async () => {
    const doc = document();
    const guard = await captureTranslationWriteGuard(doc);
    doc.data.flags.translator.source = "another original";
    await expect(assertTranslationWriteGuard(doc, guard)).rejects.toThrow("OutputChanged");
  });
  it("rejects a removed, replaced or concurrently created copy", async () => {
    const doc = document();
    const guard = await captureTranslationWriteGuard(doc);
    await expect(assertTranslationWriteGuard(null, guard)).rejects.toThrow("OutputChanged");
    await expect(assertTranslationWriteGuard({ ...doc, id: "replacement" }, guard)).rejects.toThrow("OutputChanged");
    await expect(assertTranslationWriteGuard(doc, null)).rejects.toThrow("OutputChanged");
    await expect(assertTranslationWriteGuard(null, null)).resolves.toBeUndefined();
  });
});
