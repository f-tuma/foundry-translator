import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { normalizePassageContext, passageContexts } from "../src/translation/passage-context";
import { planHtmlTranslation } from "../src/translation/html";
import { MemoryTranslationCache } from "../src/translation/cache";
import { translateUnits } from "../src/translation/unit-translator";
import { prepareStructuredProse } from "../src/providers/structured-items";
import { OpenAiCompatibleProvider } from "../src/providers/openai-compatible";
import { translateActorData } from "../src/translation/actor";
import type { TranslateRequest, TranslationProvider } from "../src/providers/types";

const settings = { providerId: "openai-compatible" as const, sourceLanguage: "en", targetLanguage: "cs" };
describe("bounded source passage context", () => {
  it("bounds Unicode text and removes mechanical syntax without losing visible labels", () => {
    expect(normalizePassageContext({ previous: "x".repeat(500) + " @UUID[Actor.secret]{Mira} [[/r 1d20]]", next: "😀".repeat(300), field: "\n  biography\t public " }))
      .toEqual({ previous: "x".repeat(208) + " Mira [roll]", next: "😀".repeat(180), field: "biography public" });
    expect(normalizePassageContext({ next: " @UUID[Actor.secret] " })).toBeUndefined();
  });
  it("uses source reading order and excludes attributes and code from neighbouring prose", () => {
    const { document } = parseHTML("<html><body></body></html>");
    const html = '<section>First.<p>Second <em>paragraph</em>.</p>Third.<code>secret code</code><img alt="Image description"></section>';
    const plan = planHtmlTranslation(html, document);
    expect(plan.units.map(unit => unit.join(""))).toEqual(["First.", "Second paragraph.", "Third.", "Image description"]);
    expect(plan.contexts).toEqual([{ next: "Second paragraph." }, { previous: "First.", next: "Third." }, { previous: "Second paragraph." }, undefined]);
    expect(plan.apply(plan.units)).toContain('alt="Image description"');
    expect(plan.apply(plan.units)).toContain("<code>secret code</code>");
  });
  it("keeps context paired with sentence IDs after splitting structured prose", () => {
    const batch = prepareStructuredProse(["She arrived. She waited.", "It broke."], [], [{ documentTitle: "Captain Mira" }, { documentTitle: "The Seal" }])!;
    expect(JSON.parse(batch.text)).toEqual([
      { context: { documentTitle: "Captain Mira" }, source: { i0: "She arrived.", i1: "She waited." } },
      { context: { documentTitle: "The Seal" }, source: { i2: "It broke." } },
    ]);
    expect(batch.instructions).toContain("Translate ONLY source values");
    expect(batch.restore('{"i0":"Přišla.","i1":"Čekala.","i2":"Rozbilo se to."}')).toEqual(["Přišla. Čekala.", "Rozbilo se to."]);
  });
  it("separates identical sentences by normalized context in cache and in-flight deduplication", async () => {
    const requests: TranslateRequest[] = [];
    const provider: TranslationProvider = { supportsPassageContext: true, async testConnection() {}, async translate(request) {
      requests.push(request);
      return request.texts.map((_text, i) => ({ translatedText: request.contexts?.[i]?.previous === "Mira" ? "Odešla." : "Odešel." }));
    } };
    const cache = new MemoryTranslationCache();
    const options = { units: [["They left."], ["They left."]], contexts: [{ previous: "Mira" }, { previous: "Borin" }], glossary: [], settings, provider, cache };
    expect(await translateUnits(options)).toEqual([["Odešla."], ["Odešel."]]);
    expect(requests[0]!.texts).toHaveLength(2);
    await translateUnits({ ...options, contexts: [{ previous: " Mira\n" }, { previous: "Borin" }] });
    expect(requests).toHaveLength(1);
    await translateUnits({ ...options, units: [["They left."]], contexts: [{ previous: "Someone else" }] });
    expect(requests).toHaveLength(2);
  });
  it("keeps context aligned when an earlier item was a cache hit", async () => {
    const requests: TranslateRequest[] = [];
    const provider: TranslationProvider = { supportsPassageContext: true, async testConnection() {}, async translate(request) { requests.push(request); return request.texts.map(text => ({ translatedText: text })); } };
    const cache = new MemoryTranslationCache();
    const options = { glossary: [], settings, provider, cache };
    await translateUnits({ ...options, units: [["First."]], contexts: [{ previous: "A" }] });
    await translateUnits({ ...options, units: [["First."], ["Second."]], contexts: [{ previous: "A" }, { previous: "B" }] });
    expect(requests[1]!.contexts).toEqual([{ previous: "B" }]);
    expect(requests[1]!.texts).toEqual(["Second."]);
  });
  it("rejects misaligned context before sending any request", async () => {
    const provider: TranslationProvider = { async testConnection() {}, async translate() { throw Error("must not call"); } };
    await expect(translateUnits({ units: [["Hello"]], contexts: [], glossary: [], provider, settings })).rejects.toThrow("context count");
  });
  it("retains original actor and embedded item names after translating their display names", async () => {
    const requests: TranslateRequest[] = [];
    const provider: TranslationProvider = { supportsPassageContext: true, async testConnection() {}, async translate(request) {
      requests.push(request); return request.texts.map(text => ({ translatedText: text.replace("Silver Sword", "Stříbrný Meč").replace("Guard", "Strážný") }));
    } };
    const { document } = parseHTML("<html><body></body></html>");
    await translateActorData({ source: { name: "Guard", type: "adversary", system: {}, items: [{ name: "Silver Sword", system: { description: "<p>It is sharp.</p>" } }] }, sourceUuid: "Actor.test", glossary: [], provider, settings, systemHtmlFieldPaths: [], itemHtmlFieldPaths: [[["description"]]], ownerDocument: document });
    const context = requests.find(r => r.texts.includes("It is sharp."))!.contexts![0];
    expect(context).toEqual({ documentTitle: "Guard", sectionTitle: "Silver Sword", field: "description" });
  });
  it("isolates context after skipping opaque-only items without cross-passage speaker leakage", async () => {
    const prompts: string[] = [];
    const provider = new OpenAiCompatibleProvider({ baseUrl: "http://localhost:1234/v1", model: "hy-mt2-30b-a3b-apex", fetchImplementation: async (_input, init) => {
      const prompt = JSON.parse(String(init?.body)).messages[0].content; prompts.push(prompt);
      const content = JSON.stringify({ i0: prompts.length === 1 ? "Ona čeká." : "On čeká." });
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { headers: { "Content-Type": "application/json" } });
    } });
    const result = await provider.translate({ texts: ["__FTG_X_0000__", "She waits.", "He waits."], contexts: [{ documentTitle: "Hidden" }, { documentTitle: "Mira" }, { documentTitle: "Borin" }], targetLanguage: "cs" });
    expect(result.map(x => x.translatedText)).toEqual(["__FTG_X_0000__", "Ona čeká.", "On čeká."]);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('"documentTitle":"Hidden"');
    expect(prompts[0]).toContain('"context":{"documentTitle":"Mira"},"source":{"i0":"She waits."}');
    expect(prompts[0]).not.toContain('"documentTitle":"Borin"');
    expect(prompts[1]).toContain('"context":{"documentTitle":"Borin"},"source":{"i0":"He waits."}');
  });
  it("derives neighbours from originals without modifying caller data", () => {
    const units = [["First."], ["Second."]];
    expect(passageContexts(units, { documentTitle: "Source" })).toEqual([{ documentTitle: "Source", next: "Second." }, { documentTitle: "Source", previous: "First." }]);
    expect(units).toEqual([["First."], ["Second."]]);
  });
  it("counts bounded context against the request budget and preserves it on a retry", async () => {
    const requests: TranslateRequest[] = [];
    let rejectOnce = true;
    const provider: TranslationProvider = { supportsPassageContext: true, async testConnection() {}, async translate(request) {
      requests.push(request);
      return request.texts.map(() => ({ translatedText: rejectOnce ? (rejectOnce = false, "") : "Cesta je uzavřená." }));
    } };
    const context = { documentTitle: "T".repeat(100), sectionTitle: "S".repeat(100), field: "F".repeat(60), previous: "P".repeat(220), next: "N".repeat(180) };
    const units = Array.from({ length: 20 }, (_, i) => [`The road number ${i} is closed.`]);
    await translateUnits({ units, contexts: units.map(() => context), glossary: [], provider, settings });
    expect(requests[0]!.texts.length).toBeLessThan(16);
    for (const request of requests) {
      expect(request.texts.length).toBe(request.contexts!.length);
      expect(request.texts.reduce((sum, text, i) => sum + text.length + JSON.stringify(request.contexts![i]).length, 0)).toBeLessThanOrEqual(4500);
    }
    const retry = requests.find(request => request.texts.length === 1 && request.texts[0] === units[0]![0]);
    expect(retry?.contexts).toEqual([context]);
  });

});
