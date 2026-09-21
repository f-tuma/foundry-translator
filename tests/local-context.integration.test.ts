import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "../src/providers/openai-compatible";
import { translateUnits, type TranslationQualityFallback } from "../src/translation/unit-translator";
import type { GlossaryEntry } from "../src/glossary/types";

// Synthetic paragraphs: structure checks are automatic; meaning and Czech need review.
describe.runIf(!!process.env.LM_STUDIO_MODEL)("local model paragraph context", () => {
  it("keeps approved names, inline context and Foundry references in narrative paragraphs", async () => {
    const model = process.env.LM_STUDIO_MODEL!;
    const glossary: GlossaryEntry[] = [
      ["Old Carinth", "Starý Carinth"], ["Brackus von Tet", "Brackus Z Tetu"],
      ["Delvers", "Permoníci"], ["Spirit Beasts", "Přízračné Šelmy"],
      ["Silver Tower", "Stříbrná Věž"],
    ].map(([source, replacement]) => ({ source: source!, replacement: replacement!, category: "term", aliases: [], mode: "inflect" }));
    const units = [
      ["Fresh paw prints cross the muddy path. The tracks belong to Spirit Beasts. The creatures are hiding in the forest, not inside the Silver Tower."],
      ["Three guards defend the bridge against Delvers. They let the party pass without a fight. No one is injured."],
      ["Speak with Brackus von Tet before leaving Old Carinth. He gives the party a silver key, but he does not travel with them."],
      ["Before nightfall, the party returns to ", "@UUID[Scene.old]{Old Carinth}", ". The road to the Silver Tower is closed. The guards will not open the gate until morning."],
    ];
    const fallbacks: TranslationQualityFallback[] = [];
    const trace: unknown[] = [];
    const provider = new OpenAiCompatibleProvider({
      model, baseUrl: process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1",
      fetchImplementation: async (input, init) => {
        const response = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) });
        if (process.env.LM_STUDIO_TRACE && response.headers.get("Content-Type")?.includes("application/json")) {
          const data = await response.clone().json();
          trace.push({ request: JSON.parse(String(init?.body)), output: data.choices?.[0]?.message?.content });
          await writeFile(process.env.LM_STUDIO_TRACE, JSON.stringify(trace, null, 2));
        }
        return response;
      },
    });
    const start = Date.now();
    const result = await translateUnits({ units, glossary, provider,
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
      onQualityFallback: issue => fallbacks.push(issue),
    });
    const report = { model, durationMs: Date.now() - start, fallbacks,
      results: units.map((unit, i) => ({ source: unit.join(""), translation: result[i]!.join(""), segments: result[i] })),
    };
    console.info(JSON.stringify(report, null, 2));
    if (process.env.LM_STUDIO_RESULT) await writeFile(process.env.LM_STUDIO_RESULT, JSON.stringify(report, null, 2));
    expect(fallbacks).toEqual([]);
    expect(result[3]).toHaveLength(3);
    expect(result[3]![1]).toMatch(/^@UUID\[Scene\.old\]\{Star[\p{L} ]+\}$/u);
    expect(result.flat().join(" ")).not.toMatch(/__FT|<\/?(?:items|item|segment|name|keep)\b/u);
  }, 240_000);
});
