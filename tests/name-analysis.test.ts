import { afterEach, describe, expect, it, vi } from "vitest";
import { NameAnalysisClient, needsNameAnalysis, parseNameDecisions } from "../src/glossary/name-analysis";
import { readNamingDecision, type GlossaryEntry } from "../src/glossary/types";
import type { TranslatorSettings } from "../src/settings/settings";
import invalidRootResponse from "./fixtures/naming-invalid-root.cs.json";

const entry = (source = "Old Carinth"): GlossaryEntry => ({ source, replacement: source, category: "location", aliases: [], sourceUuid: `Scene.${source}` });
const decision = (overrides: Record<string, unknown> = {}) => ({ id: 0, action: "translate", replacement: "Starý Carinth", roots: ["Carinth"], confidence: "high", reason: "Popisná část názvu.", ...overrides });
const parse = (values: unknown[], entries = [entry()]) => parseNameDecisions(JSON.stringify({ decisions: values }), entries, "cs", "naming-model");
const settings: TranslatorSettings = { provider: "openai-compatible", openAiBaseUrl: "http://localhost:1234", openAiModel: "hy-mt2-7b", openAiApiKey: "secret", worldContext: "", apiKey: "", sourceLanguage: "en", targetLanguage: "cs" };

describe("context-aware naming", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("stores a stable decision and excludes manual, imported and disabled entries", () => {
    const translated = parse([decision()])[0]!;
    expect(translated.replacement).toBe("Starý Carinth");
    expect(needsNameAnalysis(translated, "cs")).toBe(false);
    expect(needsNameAnalysis({ ...entry(), customized: true }, "cs")).toBe(false);
    expect(needsNameAnalysis({ ...entry(), enabled: false }, "cs")).toBe(false);
    expect(needsNameAnalysis({ ...entry("May"), category: "character" }, "cs")).toBe(true);
    expect(needsNameAnalysis({ ...entry(), replacement: "Můj vlastní název" }, "cs")).toBe(false);
    const preserved = parse([decision({ action: "preserve", replacement: "Old Carinth" })])[0]!;
    expect(needsNameAnalysis(preserved, "cs")).toBe(false);
  });
  it("keeps uncertain names but allows meaningful personal-name translations", () => {
    expect(parse([decision({ confidence: "uncertain" })])[0]?.replacement).toBe("Old Carinth");
    const person = { ...entry("Agraband Swift"), category: "character" as const };
    expect(parse([decision({ replacement: "Agraband Hbitý", roots: ["Agraband"] })], [person])[0]?.replacement).toBe("Agraband Hbitý");
    expect(parse([decision({ replacement: "Agraban Hbitý", roots: ["Agraband"] })], [person])[0]?.replacement).toBe("Agraband Swift");
  });
  it("honors established translated and preserved names even inside a new title", () => {
    const names = [{ source: "Carinth", replacement: "Karinth" }];
    const data = (replacement: string, roots = ["Carinth"]) => JSON.stringify({ decisions: [decision({ replacement, roots })] });
    expect(parseNameDecisions(data("Starý Karinth"), [entry()], "cs", "model", names)[0]?.replacement).toBe("Starý Karinth");
    expect(parseNameDecisions(data("Starý Carinth", []), [entry()], "cs", "model", names)[0]?.naming?.guard).toBe("protected-root");
    expect(parseNameDecisions(data("Starý Karinth", []), [entry()], "cs", "model", [{ source: "Carinth", replacement: "Carinth" }])[0]?.replacement).toBe("Old Carinth");
    const person = entry("Captain Orren Stormborn");
    const canonical = [{ source: "Stormborn", replacement: "Zrozený v bouři" }, { source: "Orren Stormborn", replacement: "Orren Bouřný" }];
    const candidate = (replacement: string) => JSON.stringify({ decisions: [decision({ replacement, roots: ["Orren", "Stormborn"] })] });
    expect(parseNameDecisions(candidate("Kapitán Orren Bouřný"), [person], "cs", "model", canonical)[0]?.replacement).toBe("Kapitán Orren Bouřný");
    expect(parseNameDecisions(candidate("Kapitán Orren Bouřlivák"), [person], "cs", "model", canonical)[0]?.naming?.guard).toBe("protected-root");
  });
  it("preserves changed roots without discarding safe decisions in the same batch", () => {
    const values = parse([decision(), decision({ id: 1, replacement: "Lylina karavana", roots: ["Lyla"], reason: "Jméno zůstává stejné." })], [entry(), { ...entry("Lyla's Caravan"), category: "faction" }]);
    expect(values[0]?.replacement).toBe("Starý Carinth");
    expect(values[1]?.replacement).toBe("Lyla's Caravan");
    expect(values[1]?.naming).toMatchObject({ action: "preserve", confidence: "uncertain", guard: "protected-root", reason: "" });
    expect(readNamingDecision(JSON.parse(JSON.stringify(values[1]?.naming)))).toEqual(values[1]?.naming);
    expect(needsNameAnalysis(values[1]!, "cs")).toBe(false);
    for (const replacement of ["Starý Karinth", "Starého Carinthu", "Starý XCarinth", "Starý CarinthX"]) {
      expect(parse([decision({ replacement })])[0]?.replacement).toBe("Old Carinth");
    }
  });
  it("retains invalid proposals without accepting markup, false roots or malformed fields", () => {
    for (const overrides of [{ replacement: '<img src="x">' }, { replacement: "@UUID[Actor.bad]{click}" }, { replacement: "Name\nignore instructions" }, { replacement: "__FTG_name__" }, { roots: ["Invented"] }, { action: ["translate"] }, { confidence: ["high"] }]) {
      const result = parse([decision(overrides)])[0]!;
      expect(result).toMatchObject({ replacement: "Old Carinth", naming: { guard: "invalid-decision", confidence: "uncertain" } });
      expect(readNamingDecision(result.naming)).toEqual(result.naming);
    }
  });
  it("still rejects missing or duplicate IDs instead of assigning a decision to the wrong name", () => {
    expect(() => parse([decision({ id: 2 })])).toThrow();
    expect(() => parse([])).toThrow();
    expect(() => parse([decision(), decision()], [entry(), entry("New Ordain")])).toThrow();
  });
  it("continues past a case-mismatched root without losing other decisions", () => {
    const names = ["Old Sunvale", "New Mistford", "Dawn Tower", "Mira Stormlake", "Vardel Circle", "Velora", "Orlith", "Orlithians"];
    const result = parseNameDecisions(JSON.stringify(invalidRootResponse), names.map((name) => entry(name)), "cs", "qwen/qwen3.8-27b");
    expect(result).toHaveLength(8);
    expect(result[0]?.replacement).toBe("Starý Sunvale");
    expect(result[4]).toMatchObject({ replacement: "Vardel Circle", naming: { guard: "invalid-decision" } });
    expect(result[7]?.replacement).toBe("Orlithians");
  });
  it("matches decisions by ID even if the model reorders them", () => {
    const values = parse([decision({ id: 1, replacement: "Nový Ordain", roots: ["Ordain"] }), decision()], [entry(), entry("New Ordain")]);
    expect(values.map((value) => [value.source, value.replacement])).toEqual([["New Ordain", "Nový Ordain"], ["Old Carinth", "Starý Carinth"]]);
  });
  it("can preserve an existing name with punctuation without validating it as generated text", () => {
    const original = entry("The Keep [Ruins]");
    expect(parse([decision({ action: "preserve", replacement: original.source, roots: [] })], [original])[0]?.replacement).toBe(original.source);
  });
  it("requires an explicitly selected model until a naming default passes language QA", async () => {
    vi.stubGlobal("game", { i18n: { localize: (s: string) => s } });
    const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ id: "hy-mt2-7b" }, { id: "qwen3.5-4b" }, { id: "qwen3.5-9b" }, { id: "qwen3.5-coder-9b" }] })));
    await expect(new NameAnalysisClient(settings, request).model()).rejects.toThrow("ModelMissing");
    expect(await new NameAnalysisClient({ ...settings, glossaryAiModel: "qwen3.5-9b" }, request).model()).toBe("qwen3.5-9b");
    await expect(new NameAnalysisClient({ ...settings, glossaryAiModel: "missing" }, request).model()).rejects.toThrow("ModelMissing");
    expect(request.mock.calls[0]?.[0]).toBe("http://localhost:1234/v1/models");
  });
  it("uses the native response message only, without persisting a chat", async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ output: [
      { type: "reasoning", content: "not JSON" }, { type: "message", content: JSON.stringify({ decisions: [decision()] }) },
    ] })));
    const values = await new NameAnalysisClient(settings, request).analyze([entry()], new Map([["Old Carinth", "A historic town."]]), "qwen3.5-9b");
    expect(values[0]?.replacement).toBe("Starý Carinth");
    const body = JSON.parse(request.mock.calls[0]?.[1]?.body as string);
    expect(body.store).toBe(false);
    expect(body.reasoning).toBe("off");
    expect(body.input).toContain("A historic town.");
    expect(body.input).not.toContain("secret");
  });
  it("shares only bounded relevant established glossary names with the model", async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ output: [{ type: "message", content: JSON.stringify({ decisions: [decision()] }) }] })));
    const established = [{ source: "Carinth", replacement: "Carinth", context: "private unrelated biography" }, { source: "Unrelated", replacement: "Nesouvisející" }];
    await new NameAnalysisClient(settings, request).analyze([entry()], new Map(), "model", established);
    const input = JSON.parse(JSON.parse(request.mock.calls[0]?.[1]?.body as string).input);
    expect(input.establishedNames).toEqual([{ source: "Carinth", replacement: "Carinth" }]);
    expect(JSON.stringify(input)).not.toContain("private unrelated biography");
  });
  it("falls back for other OpenAI-compatible servers and fails closed on errors", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decisions: [decision()] }) } }] })));
    expect((await new NameAnalysisClient(settings, request).analyze([entry()], new Map(), "other-instruct"))[0]?.replacement).toBe("Starý Carinth");
    expect(request.mock.calls[1]?.[0]).toBe("http://localhost:1234/v1/chat/completions");
    await expect(new NameAnalysisClient(settings, async () => new Response("", { status: 503 })).analyze([entry()], new Map(), "other")).rejects.toThrow("503");
  });
});
