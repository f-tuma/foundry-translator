import { describe, expect, it } from "vitest";
import { discoverGlossaryEntries } from "../src/glossary/discovery";
import { planGlossarySync } from "../src/glossary/sync";
import { protectGlossaryTerms, restoreGlossaryTerms } from "../src/glossary/protection";
import { glossaryFingerprint } from "../src/translation/unit-translator";
import { discoverEmberTextFieldPaths } from "../src/translation/system-html-fields";
import type { GlossaryEntry } from "../src/glossary/types";

it("uses Ember entity types, leaving ordinary headings, classes and quests translatable", () => {
  const entries = discoverGlossaryEntries({ actors: [], scenes: [], journals: [{ pages: { contents: [
    { name: "Burnished Hand", type: "ember.organization", uuid: "JournalEntry.a.JournalEntryPage.f" },
    { name: "Katu", type: "ember.deity" }, { name: "Ordain", type: "ember.location" },
    { name: "Introduction", type: "text" }, { name: "Artificer", type: "ember.characterClass" }, { name: "One Last Thing", type: "ember.questEvent" },
  ] } }] });
  expect(entries.map((e) => [e.source, e.category])).toEqual([["Burnished Hand", "faction"], ["Katu", "deity"], ["Ordain", "location"]]);
});
it("never rediscovers translated journal names", () => {
  expect(discoverGlossaryEntries({ actors: [], scenes: [], journals: [{ flags: { "foundry-translate": { translation: {} } }, pages: { contents: [{ name: "Řád", type: "ember.organization" }] } }] })).toEqual([]);
});
it("lets Ember creature templates translate while preserving named characters and local overrides", () => {
  const entries = discoverGlossaryEntries({ actors: [
    { name: "Abyssal Eel", uuid: "Actor.eel", flags: { ember: { discoverable: "creature" } } },
    { name: "Adelyne Goss", flags: { ember: { discoverable: "character" } } },
  ], scenes: [] });
  const eel = entries.find((e) => e.source === "Abyssal Eel")!;
  expect(eel).toMatchObject({ category: "term", enabled: false });
  expect(entries.find((e) => e.source === "Adelyne Goss")?.enabled).not.toBe(false);
  const legacy = { ...eel, id: "old", category: "character" as const, enabled: true };
  expect(planGlossarySync([legacy], [eel]).update[0]).toMatchObject({ enabled: false, category: "term" });
  expect(planGlossarySync([{ ...legacy, customized: true }], [eel]).unchanged[0]?.enabled).toBe(true);
  expect(planGlossarySync([{ ...legacy, replacement: "Hlubinný úhoř" }], [eel]).update[0]?.enabled).toBe(true);
});
it("keeps disabled entries and human classifications stable across discovery", async () => {
  const entry: GlossaryEntry = { id: "one", source: "Guard", replacement: "Guard", aliases: [], category: "term", sourceUuid: "Actor.one", enabled: false, customized: true };
  const plan = planGlossarySync([entry], [{ ...entry, category: "character", enabled: true, customized: false }]);
  expect(plan.update).toHaveLength(0);
  expect(plan.unchanged[0]?.enabled).toBe(false);
  const protection = protectGlossaryTerms("Guard meets Strahd.", [entry]);
  expect(restoreGlossaryTerms(protection.text, protection)).toBe("Guard meets Strahd.");
  expect(await glossaryFingerprint([entry])).toBe(await glossaryFingerprint([]));
});
describe("reviewed Ember text fields", () => {
  class StringField {}
  const schema = { subtitle: new StringField(), eventId: new StringField(), outcomes: { element: { fields: { label: new StringField(), id: new StringField() } } } };
  const system = { subtitle: "A quiet place", eventId: "do-not-touch", outcomes: [{ id: "success", label: "Make an ally" }] };
  it("includes subtitle and outcome label, never event IDs or outcome IDs", () => {
    expect(discoverEmberTextFieldPaths("ember.questEvent", schema, system)).toEqual([["subtitle"], ["outcomes", 0, "label"]]);
    expect(discoverEmberTextFieldPaths("other.event", schema, system)).toEqual([]);
  });
});
