import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { qualityPassages } from "./fixtures/quality-passages";
import { OpenAiCompatibleProvider } from "../src/providers/openai-compatible";
import { translateUnits, type TranslationQualityFallback } from "../src/translation/unit-translator";
import { planHtmlTranslation } from "../src/translation/html";
import { normalizePassageContext } from "../src/translation/passage-context";
import { protectFoundrySyntax } from "../src/translation/foundry-syntax";
import { parseGlossaryFile } from "../src/glossary/files";
import type { GlossaryEntry } from "../src/glossary/types";
import type { PassageContext, ProviderRequestMetrics } from "../src/providers/types";

interface Sample { id: string; source: string; context: PassageContext; expectation: string; private?: boolean; }
// Explicit opt-in; writes only an external report, never a Foundry document.
describe.runIf(!!process.env.QUALITY_REPORT && !!process.env.LM_STUDIO_MODEL)("reference translation A/B", () => {
  it("records meaning-review material and checks structural integrity in both modes", async () => {
    const samples: Sample[] = [...qualityPassages];
    let glossary: GlossaryEntry[] = [
      { source: "Old Carinth", replacement: "Starý Carinth", category: "location", aliases: [], mode: "inflect" },
      { source: "Forest Warden", replacement: "Lesní Strážce", category: "character", aliases: ["Forest Wardens"], mode: "inflect" },
      ...["Mira", "Borin"].map(source => ({ source, replacement: source, category: "character" as const, aliases: [], mode: "inflect" as const })),
    ];
    if (process.env.FOUNDRY_GLOSSARY) glossary = [...parseGlossaryFile(await readFile(process.env.FOUNDRY_GLOSSARY, "utf8"), "json", "cs").entries, ...glossary];
    if (process.env.QUALITY_SOURCE_DIR) {
      const { document } = parseHTML("<html><body></body></html>");
      const files = (await readdir(process.env.QUALITY_SOURCE_DIR)).filter(file => /^fvtt-JournalEntry-(?:gamemaster|deities|history|organizations|notable-figures|myths-and-legends)/u.test(file)).sort().slice(0, 6);
      for (const file of files) {
        const journal = JSON.parse(await readFile(join(process.env.QUALITY_SOURCE_DIR, file), "utf8"));
        const candidates: Sample[] = [];
        for (const page of journal.pages ?? []) {
          const html = page.text?.content;
          if (typeof html !== "string") continue;
          const plan = planHtmlTranslation(html, document);
          plan.units.forEach((unit, i) => {
            const source = unit.join("");
            if (source.length < 140 || source.length > 650 || !plan.contexts[i]) return;
            candidates.push({ id: `${journal._id ?? file}:${page._id}:${i}`, source, context: normalizePassageContext({ ...plan.contexts[i], documentTitle: journal.name, sectionTitle: page.name })!, private: true, expectation: "Porovnat s originálem: kdo co dělá, vztahy, negace, podmínky, počty, glosář; jazykové drobnosti hodnotit zvlášť." });
          });
        }
        // Deterministic spread over the source, not selection by a good model output.
        for (let i = 0; i < Math.min(4, candidates.length); i++) samples.push(candidates[Math.floor(i * candidates.length / 4)]!);
      }
    }
    const metrics: ProviderRequestMetrics[] = [];
    const trace: unknown[] = [];
    const provider = new OpenAiCompatibleProvider({ model: process.env.LM_STUDIO_MODEL!, baseUrl: process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1", onMetrics: event => metrics.push(event), fetchImplementation: async (input, init) => {
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) });
      trace.push({ request: JSON.parse(String(init?.body)), response: await response.clone().json() });
      return response;
    } });
    const report = { model: process.env.LM_STUDIO_MODEL, providerIdentity: provider.cacheIdentity, createdAt: new Date().toISOString(), contextLimit: 8192, note: "Same production pipeline; temperature 0; no translation cache; input batches of 3, alternating A/B order; production APEX isolates contextual passages. Structural checks are not a semantic score. Human review pending. Private samples must not be published.", samples, runs: [] as unknown[], metrics, trace };
    const structuralFailures: string[] = [];
    for (let start = 0; start < samples.length; start += 3) {
      const batch = samples.slice(start, start + 3);
      for (const mode of start % 2 ? ["context", "baseline"] : ["baseline", "context"]) {
        const fallbacks: TranslationQualityFallback[] = [];
        const begin = Date.now(), metricStart = metrics.length;
        const result = await translateUnits({ units: batch.map(row => [row.source]), ...(mode === "context" ? { contexts: batch.map(row => row.context) } : {}), glossary, provider, settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" }, onQualityFallback: issue => fallbacks.push(issue) });
        const durationMs = Date.now() - begin;
        const rows = batch.map((row, i) => {
          const translation = result[i]!.join("");
          const refs = (value: string) => protectFoundrySyntax(value).tokens.map(token => token.source).sort();
          const syntaxOK = JSON.stringify(refs(translation)) === JSON.stringify(refs(row.source)) && !/__FT[GSNB]_/u.test(translation);
          if (!syntaxOK) structuralFailures.push(`${row.id}:${mode}`);
          return { id: row.id, translation, syntaxOK, sourceUnchanged: translation === row.source };
        });
        report.runs.push({ mode, durationMs, fallbacks, metrics: metrics.slice(metricStart), rows });
        await writeFile(process.env.QUALITY_REPORT!, JSON.stringify(report, null, 2) + "\n");
        console.info(`${mode} ${start + 1}–${start + batch.length}/${samples.length}: ${durationMs} ms; ${fallbacks.length} warnings`);
      }
    }
    expect(structuralFailures).toEqual([]);
  }, 1_200_000);
});
