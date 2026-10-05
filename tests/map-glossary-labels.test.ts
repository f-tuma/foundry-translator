import { expect, it } from "vitest";
import { mapGlossaryLabel, mapGlossaryLabels } from "../src/translation/map-glossary-labels";
import type { GlossaryEntry } from "../src/glossary/types";
const entry = (source: string, replacement: string, aliases: string[] = []): GlossaryEntry => ({ source, replacement, aliases, category: "location" });

it("uses exact canonical glossary names for map labels, including Unicode and uppercase labels", () => {
  const labels = mapGlossaryLabels([entry("Old Carinth", "Starý Carinth"), entry("Šířina", "Šířina", ["Shirina"])]);
  expect(mapGlossaryLabel(labels, " OLD CARINTH ")).toBe("Starý Carinth");
  expect(mapGlossaryLabel(labels, "S\u030ci\u0301r\u030cina")).toBe("Šířina");
  expect(mapGlossaryLabel(labels, "Shirina")).toBe("Šířina");
  expect(mapGlossaryLabel(labels, "Old Carinth Harbour")).toBeNull();
});

it("rejects ambiguous aliases, disabled entries and empty replacements", () => {
  const labels = mapGlossaryLabels([entry("Place A", "Místo A", ["Alias"]), entry("Place B", "Místo B", ["ALIAS"]),
    { ...entry("Disabled", "Vypnuté"), enabled: false }, entry("Empty", " ")]);
  expect(mapGlossaryLabel(labels, "Alias")).toBeNull();
  expect(mapGlossaryLabel(labels, "Disabled")).toBeNull();
  expect(mapGlossaryLabel(labels, "Empty")).toBeNull();
  expect(mapGlossaryLabel(labels, "Place A")).toBe("Místo A");
});

it("allows repeated identical decisions without changing or inflecting the saved glossary", () => {
  const entries = [entry("Forest of Stone", "Kamenný Les"), entry("Forest of Stone", "Kamenný Les")];
  const before = structuredClone(entries);
  expect(mapGlossaryLabel(mapGlossaryLabels(entries), "Forest of Stone")).toBe("Kamenný Les");
  expect(entries).toEqual(before);
});
