import { readFile, writeFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { protectFoundrySyntax } from "../src/translation/foundry-syntax";
import { planHtmlTranslation } from "../src/translation/html";
import { translateUnits, type TranslationQualityFallback } from "../src/translation/unit-translator";
import { OpenAiCompatibleProvider } from "../src/providers/openai-compatible";
import { parseGlossaryFile } from "../src/glossary/files";

// Private exports and translation reports remain outside the repository.
describe.runIf(!!process.env.LM_STUDIO_MODEL && !!process.env.FOUNDRY_JOURNAL && !!process.env.FOUNDRY_GLOSSARY)("local exported Ember page", () => {
  it("translates a real page while preserving HTML attributes and Foundry references", async () => {
    const journal = JSON.parse(await readFile(process.env.FOUNDRY_JOURNAL!, "utf8"));
    const page = journal.pages.find((page: { name: string }) => page.name === (process.env.FOUNDRY_PAGE || "Main Quest Overview"));
    expect(page).toBeDefined();
    const glossary = parseGlossaryFile(await readFile(process.env.FOUNDRY_GLOSSARY!, "utf8"), "json", "cs").entries;
    const { document } = parseHTML("<html><body></body></html>");
    const plan = planHtmlTranslation(page.text.content, document);
    const fallbacks: TranslationQualityFallback[] = [];
    const trace: unknown[] = [];
    const provider = new OpenAiCompatibleProvider({ model: process.env.LM_STUDIO_MODEL!, baseUrl: process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1",
      onMetrics: event => { if (event.phase === "completed") console.info("Request", event.durationMs, "ms", event.outputTokens, "tokens"); },
      fetchImplementation: async (input, init) => {
        const response = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) });
        if (process.env.LM_STUDIO_TRACE) {
          trace.push({ request: JSON.parse(String(init?.body)), response: await response.clone().json() });
          await writeFile(process.env.LM_STUDIO_TRACE, JSON.stringify(trace, null, 2));
        }
        return response;
      },
    });
    const start = Date.now();
    const results = await translateUnits({ units: plan.units, glossary, provider,
      settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" }, onQualityFallback: issue => fallbacks.push(issue) });
    const html = plan.apply(results);
    const report = { model: process.env.LM_STUDIO_MODEL, page: page.name, durationMs: Date.now() - start, fallbacks,
      results: plan.units.map((source, index) => ({ source: source.join(""), translation: results[index]!.join("") })), html };
    if (process.env.LM_STUDIO_RESULT) await writeFile(process.env.LM_STUDIO_RESULT, JSON.stringify(report, null, 2));
    const references = (text: string) => protectFoundrySyntax(text).tokens.map(token => token.source).sort();
    expect(references(html)).toEqual(references(page.text.content));
    expect(html).not.toMatch(/__FT[GSNB]_/u);
    const structure = (content: string) => {
      const root = document.createElement("div"); root.innerHTML = content;
      return [...root.querySelectorAll("*")].map(element => [element.tagName, ...[...element.attributes].filter(attr => !["title", "alt", "aria-label", "data-tooltip", "data-tooltip-text", "placeholder"].includes(attr.name)).map(attr => [attr.name, attr.value])]);
    };
    expect(structure(html)).toEqual(structure(page.text.content));
    console.info("Review warnings", fallbacks);
    // Exact approved forms are a visible grammar-review outcome; preserving an
    // untranslated source fragment is still a failure for this release sample.
    expect(fallbacks.filter(issue => issue.reason !== "fixed-glossary")).toEqual([]);
  }, 300_000);
});
