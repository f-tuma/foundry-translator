import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGlossaryFile, serializeGlossaryFile, planGlossaryImport, validateSelectedImport, MAX_GLOSSARY_BYTES } from "../src/glossary/files";
import type { GlossaryEntry } from "../src/glossary/types";
const term = (source: string, replacement = source): GlossaryEntry => ({ source, replacement, category: "location", aliases: [] });
beforeEach(() => vi.stubGlobal("game", { i18n: { localize: (key: string) => key } }));
afterEach(() => vi.unstubAllGlobals());

describe("reviewed glossary files", () => {
  it.each(["json", "csv"] as const)("round trips %s, Unicode, quoting, multiline notes and disabled entries without internal data", (format) => {
    const entries = [{ ...term('The "Dawn", Tower', "Věž úsvitu"), id: "private", sourceUuid: "Scene.private", aliases: ["Old;Tower", "Tower, Old"], notes: 'First line\n"Second", line', enabled: false }];
    const raw = serializeGlossaryFile(entries, "cs", format, new Map([[entries[0]!.source, "Reference only"]]));
    expect(raw).not.toContain("Scene.private");
    expect(raw).not.toContain('"private"');
    expect(raw).toContain("Reference only");
    const parsed = parseGlossaryFile(raw, format, "en");
    expect(parsed.language).toBe("cs");
    expect(parsed.entries[0]).toEqual({ source: entries[0]!.source, replacement: "Věž úsvitu", category: "location", aliases: ["Old;Tower", "Tower, Old"], notes: entries[0]!.notes, enabled: false, customized: true });
  });
  it("neutralizes spreadsheet formulas and preserves literal apostrophes on reimport", () => {
    const names = ["=SUM(A1)", "+Tower", "-Keep", "@Place", "'=name", "'literal"];
    const raw = serializeGlossaryFile(names.map((name) => term(name)), "cs", "csv");
    expect(raw).toContain('"\'=SUM(A1)"');
    expect(parseGlossaryFile(raw, "csv", "cs").entries.map((e) => e.source)).toEqual([...names].sort((a,b) => a.localeCompare(b)));
  });
  it("accepts semicolon CSV and blank translations as an explicit preserved original", () => {
    expect(parseGlossaryFile("source;replacement;category\r\nSunvale;;location", "csv", "cs").entries[0]?.replacement).toBe("Sunvale");
  });
  it("reports malformed quoting, headers, JSON and mismatched columns", () => {
    for (const raw of ['source,replacement,category\n"unfinished', "source,replacement\nA,B", 'source,replacement,category\n"A"x,B,location', "source,replacement,category\nA,B"]) {
      expect(() => parseGlossaryFile(raw, "csv", "cs")).toThrow();
    }
    expect(() => parseGlossaryFile('{"entries":[]}', "json", "cs")).toThrow("InvalidJson");
    expect(() => parseGlossaryFile("broken", "json", "cs")).toThrow("InvalidJson");
    expect(() => parseGlossaryFile("x".repeat(MAX_GLOSSARY_BYTES + 1), "csv", "cs")).toThrow("TooLarge");
  });
  it("rejects duplicate names, ambiguous aliases and markup in names", () => {
    expect(() => parseGlossaryFile(serializeGlossaryFile([term("Sunvale"),term("sunvale")], "cs", "json"), "json", "cs")).toThrow("Duplicate");
    expect(() => parseGlossaryFile(serializeGlossaryFile([term("Sunvale"),{ ...term("Tower"), aliases:["SUNVALE"] }], "cs", "json"), "json", "cs")).toThrow("AliasConflict");
    expect(() => parseGlossaryFile(serializeGlossaryFile([term("<script>")], "cs", "json"), "json", "cs")).toThrow("InvalidFields");
  });
  it("previews replacements and metadata, detects language mismatch and leaves omissions untouched", () => {
    const old = [{ ...term("Tower"), id:"1", sourceUuid:"Scene.1", customized:true }, { ...term("Keep"), customized:true }];
    const file = parseGlossaryFile(serializeGlossaryFile([{ ...term("Tower", "Věž"), notes:"Approved" }, term("Sunvale")], "cs", "json"), "json", "cs");
    const plan = planGlossaryImport(old,file,"cs");
    expect(plan.map((row) => row.state)).toEqual(["new","changed"]);
    expect(plan[1]?.after).toMatchObject({ id:"1", sourceUuid:"Scene.1", notes:"Approved", customized:true });
    expect(() => planGlossaryImport(old,file,"de")).toThrow("LanguageMismatch");
    const mixed = "source,replacement,category,language\nA,A,term,cs\nB,B,term,en";
    expect(() => parseGlossaryFile(mixed,"csv","cs")).toThrow("LanguageMismatch");
  });
  it("validates only the selected changes against current saved aliases", () => {
    const stored = [{ ...term("Tower"), id:"1", aliases:["Keep"] }];
    const file = { language:"cs", entries:[{ ...term("Tower"), aliases:[] }, term("Keep", "Hrad")] };
    const plan = planGlossaryImport(stored,file,"cs");
    expect(() => validateSelectedImport(stored,plan)).not.toThrow();
    expect(() => validateSelectedImport(stored,plan.filter((row) => row.state === "new"))).toThrow("AliasConflict");
  });
  it("requires approval even when an unreviewed name stays unchanged, then becomes idempotent", () => {
    const stored = [{ ...term("Sunvale"), id: "1" }];
    const file = parseGlossaryFile(serializeGlossaryFile(stored, "cs", "json"), "json", "cs");
    const rows = planGlossaryImport(stored, file, "cs");
    expect(rows[0]?.state).toBe("changed");
    expect(rows[0]?.after.customized).toBe(true);
    expect(planGlossaryImport(rows.map((r) => r.after), file, "cs")[0]?.state).toBe("unchanged");
  });
  it("reads only glossary entries from a legacy translation bundle", () => {
    const bundle = { format:"foundry-translate-bundle", version:1, createdAt:"2026-09-20", moduleVersion:"0.16.2",
      systemId:"crucible", systemVersion:"0.11", targetLanguage:"cs", glossary:[term("Sunvale")], documents:[] };
    const file = parseGlossaryFile(JSON.stringify(bundle), "json", "en");
    expect(file.language).toBe("cs");
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]?.customized).toBe(true);
  });

});
