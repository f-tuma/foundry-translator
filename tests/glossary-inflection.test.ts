import { describe, expect, it, vi } from "vitest";
import { normalizeCzechGlossaryForm } from "../src/glossary/inflection";
import { protectGlossaryTerms, restoreGlossaryTerms } from "../src/glossary/protection";
import type { GlossaryEntry } from "../src/glossary/types";
import { translateUnits, glossaryFingerprint } from "../src/translation/unit-translator";
import { MemoryTranslationCache } from "../src/translation/cache";
import type { TranslateRequest, TranslationProvider } from "../src/providers/types";

const town: GlossaryEntry = { source: "Old Carinth", replacement: "Starý Carinth", category: "location", aliases: ["Old Town"], mode: "inflect" };
const settings = { providerId: "openai-compatible" as const, sourceLanguage: "en", targetLanguage: "cs" };
const markers = { nonce: "TEST", allowInflection: true };

describe("Czech glossary forms", () => {
  it.each([
    ["Starý Carinth", "Starého Carinthu"], ["Starý Carinth", "Starém Carinthu"],
    ["Průlom Hlubiny", "Průlomu Hlubiny"], ["Permoníci", "Permoníkům"],
    ["Přízračné Šelmy", "Přízračných Šelem"], ["Kočka Casirská", "Kočce Casirské"],
    ["Přízračné Šelmy", "Přízračným Šelmám"], ["Bílé Kočky", "Bílým Kočkám"],
    ["Rudý Běs", "Rudým Běsem"], ["Brackus Z Tetu", "Brackusem Z Tetu"],
    ["Stříbrný Paprsek", "Stříbrného Paprsku"], ["Bůh", "Boha"],
    ["Jorey Rychlý", "Joreyho Rychlého"], ["Dřímající Kobka", "Dřímající Kobky"],
    ["Ku'arta", "Ku'arty"], ["Město a Hrad", "Města a Hradu"],
  ])("accepts %s → %s", (base, form) => expect(normalizeCzechGlossaryForm(base, form)).toBe(form));

  it.each([
    "Nového Carinthu", "Starého Města", "Starého Krásného Carinthu", "Carinthu", "",
    "Starého Carinthu<script>", "Starého __FTG_TEST_9999__", "Starého Carinthu. Přijď.",
    "Starý\nCarinth", "Starého @UUID[Actor.foo]", "Starý Carinthův",
  ])("rejects renaming or unrelated output: %s", value => expect(normalizeCzechGlossaryForm(town.replacement, value)).toBeNull());
  it("retains glossary capitalization, numbers and conjunctions", () => {
    expect(normalizeCzechGlossaryForm("Město a Hrad", "města A hradu")).toBe("Města a Hradu");
    expect(normalizeCzechGlossaryForm("V'Mar", "v'maru")).toBe("V'Maru");
    expect(normalizeCzechGlossaryForm("Ku'arta", "KU'ARTY")).toBe("Ku'arty");
    expect(normalizeCzechGlossaryForm("Věž 6", "Věže 7")).toBeNull();
  });
});

describe("bounded glossary inflection", () => {
  it("keeps occurrence-specific forms and exact entries together", () => {
    const p = protectGlossaryTerms("From Old Carinth to Old Town with Ember.", [town, { ...town, source: "Ember", replacement: "Ember", aliases: [], mode: "fixed" }], markers);
    const translated = p.text.replace("From", "Ze").replace("to", "do").replace("with", "se")
      .replace("Starý Carinth", "Starého Carinthu").replace("Starý Carinth", "Starého Carinthu");
    expect(restoreGlossaryTerms(translated, p)).toBe("Ze Starého Carinthu do Starého Carinthu se Ember.");
    expect(p.tokens[2]?.endToken).toBeUndefined();
  });
  it("ignores disabled entries and uses an exact form without model capability", () => {
    expect(protectGlossaryTerms("Old Carinth", [{ ...town, enabled: false }], markers).text).toBe("Old Carinth");
    const fixed = protectGlossaryTerms("Old Carinth", [town], { nonce: "FIXED" });
    expect(fixed.text).not.toContain("Starý");
    expect(restoreGlossaryTerms(fixed.text, fixed)).toBe("Starý Carinth");
  });
  it("rejects missing, reordered, duplicate, nested and foreign boundaries", () => {
    const p = protectGlossaryTerms("Old Carinth", [town], markers);
    const { token, endToken } = p.tokens[0]!;
    for (const output of [token + "Starého Carinthu", endToken + "Starého Carinthu" + token,
      p.text + endToken, token + "Nového Carinthu" + endToken,
      token + "Starého __FTG_OTHER_0000__" + endToken]) {
      expect(() => restoreGlossaryTerms(output, p)).toThrow();
    }
  });
  it("allows Czech forms next to protected link syntax and Unicode case expansion", () => {
    const open = "__FTS_LINK_0000__", close = "__FTS_LINK_0001__";
    const p = protectGlossaryTerms(`Straße ${open}Old Carinth${close}`, [town], { ...markers, opaqueTokens: [open, close] });
    expect(restoreGlossaryTerms(p.text.replace("Starý Carinth", "Starém Carinthu"), p)).toBe(`Straße ${open}Starém Carinthu${close}`);
  });
});

describe("inflection through translation units", () => {
  function model(transform: (text: string) => string): TranslationProvider {
    return { supportsGlossaryInflection: true, translate: vi.fn(async (request: TranslateRequest) => request.texts.map(text => ({ translatedText: transform(text) }))), async testConnection() {} };
  }
  it("translates contextual forms inside a Foundry label without altering UUIDs", async () => {
    const p = model(text => text.replace("Travel to ", "Cestujte do ").replace("Starý Carinth", "Starého Carinthu"));
    const result = await translateUnits({ units: [["Travel to @UUID[Scene.old]{Old Carinth}."]], glossary: [town], provider: p, settings });
    expect(result).toEqual([["Cestujte do @UUID[Scene.old]{Starého Carinthu}."]]);
  });
  it("keeps standalone names and link labels canonical, but inflects names across HTML segments", async () => {
    const p = model(text => text.replace("Travel to", "Cestujte do").replaceAll("Starý Carinth", "Starého Carinthu"));
    const result = await translateUnits({ units: [
      ["Old Carinth"], ["@UUID[Scene.old]{Old Carinth}"], [" ", "Old Town", " "],
      ["Travel to ", "Old Carinth", "."],
    ], glossary: [town], provider: p, settings });
    expect(result).toEqual([
      ["Starý Carinth"], ["@UUID[Scene.old]{Starý Carinth}"], [" ", "Starý Carinth", " "],
      ["Cestujte do ", "Starého Carinthu", "."],
    ]);
  });
  it("retries a renamed term and never caches a failed translation", async () => {
    const onQualityFallback = vi.fn();
    const cache = new MemoryTranslationCache();
    const p = model(text => text.replace("Travel to", "Cestujte do").replace("Starý Carinth", "Nového Města"));
    const options = { units: [["Travel to Old Carinth."]], glossary: [town], provider: p, settings, cache, onQualityFallback };
    expect(await translateUnits(options)).toEqual([["Travel to Starý Carinth."]]);
    expect(p.translate).toHaveBeenCalledTimes(3);
    expect(onQualityFallback).toHaveBeenCalledWith(expect.objectContaining({reason: "integrity"}));
    await translateUnits(options);
    expect(p.translate).toHaveBeenCalledTimes(6);
  });
  it("invalidates cached translations when the glossary mode changes", async () => {
    const p = model(text => text.replace("Travel to", "Cestujte do").replace("Starý Carinth", "Starého Carinthu"));
    const cache = new MemoryTranslationCache();
    const options = { units: [["Travel to Old Carinth."]], glossary: [{ ...town, mode: "fixed" as const }], provider: p, settings, cache };
    expect(await translateUnits(options)).toEqual([["Cestujte do Starý Carinth."]]);
    expect(await translateUnits({...options,glossary:[town]})).toEqual([["Cestujte do Starého Carinthu."]]);
    expect(p.translate).toHaveBeenCalledTimes(2);
    expect(await glossaryFingerprint([town])).not.toBe(await glossaryFingerprint(options.glossary));
  });
  it("keeps exact forms for non-Czech targets and providers without instruction support", async () => {
    for (const targetLanguage of ["cs", "de"]) {
      const p = { ...model(text => text.replace("Travel to", "Go to")), supportsGlossaryInflection: targetLanguage !== "cs" };
      expect(await translateUnits({ units: [["Travel to Old Carinth."]], glossary:[town], provider:p,settings:{...settings,targetLanguage} })).toEqual([["Go to Starý Carinth."]]);
    }
  });
});
