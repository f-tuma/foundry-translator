import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { auditNames, isNameConcern, nameFormKey, readNameForms, saveNameForm, type NameForms } from "../src/review/name-consistency";
import type { SearchIndex } from "../src/review/search";
import type { GlossaryEntry } from "../src/glossary/types";
import { GlossaryCompendiumRepository } from "../src/glossary/compendium-repository";
const term: GlossaryEntry = { source: "Agraband Swift", replacement: "Agraband Rychlý", category: "character", aliases: ["Swift the Scout"], mode: "inflect" };
const empty: NameForms = { version: 1, entries: [] };
function index(source: string[], translation: string[]): SearchIndex {
  return { skipped: [], snapshots: [{ entry: { id: "a", uuid: "Actor.copy", sourceUuid: "Actor.original", kind: "Actor", name: "Scout", pack: "world.actors", language: "cs" }, sourceName: "Scout", rows: [{ id: "row", group: "document", fieldId: "name", unitId: "text", source, translation, format: "text", label: "name", fingerprint: "hash", verified: null, heading: false, blocked: null }], fields: [], groups: [{ id: "document", name: "Biography" }], guard: { id: "a", fingerprint: "guard" }, sourceHash: "source", warning: null, partial: false, reverse: new Map() }] };
}
beforeEach(() => vi.stubGlobal("document", parseHTML("<html></html>").document));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("recognizes Czech forms across inline formatting, and flags a second misspelled occurrence", async () => {
  const result = await auditNames(index(["Agraband ", "Swift met Agraband Swift."], ["S Agrabandem ", "Rychlým přišel i Agarband Rychlý."]), [term], "cs", empty);
  expect(result.findings.map(hit => [hit.candidate, hit.status])).toEqual([["Agrabandem Rychlým", "inflected"], ["Agarband Rychlý", "variant"]]);
  expect(result.findings.filter(isNameConcern)).toHaveLength(1);
});
it("reports missing names, untranslated aliases and capitalization without treating them as verified errors", async () => {
  expect((await auditNames(index(["Swift the Scout"], ["Agraband Swift"]), [term], "cs", empty)).findings[0]?.status).toBe("original");
  expect((await auditNames(index(["Agraband Swift"], ["Neznámý muž."]), [term], "cs", empty)).findings[0]?.status).toBe("missing");
  expect((await auditNames(index(["Agraband Swift"], ["agraband rychlý"]), [term], "cs", empty)).findings[0]?.status).toBe("case");
});
it("uses longest source phrases, disables inactive entries, and ignores code and UUID targets", async () => {
  const place: GlossaryEntry = { source: "Old Carinth", replacement: "Starý Carinth", category: "location", aliases: [], mode: "inflect" };
  const city = { ...place, source: "Carinth", replacement: "Carinth" };
  const result = await auditNames(index(["Old Carinth. `Agraband Swift` @UUID[Actor.Agraband Swift]{Old Carinth}"], ["Ve Starém Carinthu. `Agraband Swift` @UUID[Actor.Agraband Swift]{Starý Carinth}"]), [place, city, term], "cs", empty);
  expect(result.checkedTerms).toBe(1); expect(result.findings.every(hit => hit.term === place)).toBe(true);
  expect(result.findings.filter(isNameConcern)).toEqual([]);
  expect((await auditNames(index([term.source], ["Bad"]), [{ ...term, enabled: false }], "cs", empty)).checkedTerms).toBe(0);
});
it("does not accept inflection for fixed terms and skips untranslated or structurally blocked rows", async () => {
  expect((await auditNames(index([term.source], ["S Agrabandem Rychlým"]), [{ ...term, mode: "fixed" }], "cs", empty)).findings[0]?.status).toBe("variant");
  const data = index([term.source], [term.source]); data.snapshots[0]!.rows[0]!.blocked = "Untranslated";
  expect(await auditNames(data, [term], "cs", empty)).toMatchObject({ findings: [], checkedRows: 0, skippedRows: 1 });
});
it("accepts explicit irregular forms only for the matching term, language and glossary wording", async () => {
  const name = { ...term, source: "Wolf", replacement: "Vlk" };
  const forms: NameForms = { version: 1, entries: [{ key: nameFormKey(name, "cs"), form: "Vlci", at: "today", userName: "GM" }] };
  expect((await auditNames(index(["Wolf"], ["Vlci"]), [name], "cs", forms)).findings[0]?.status).toBe("approved");
  expect((await auditNames(index(["Wolf"], ["Vlci"]), [{ ...name, replacement: "Vlčák" }], "cs", forms)).findings[0]?.status).not.toBe("approved");
  expect((await auditNames(index(["Wolf"], ["Vlci"]), [name], "sk", forms)).findings[0]?.status).not.toBe("approved");
});
it("supports cancellation without returning a deceptively complete audit", async () => {
  await expect(auditNames(index([term.source], [term.replacement]), [term], "cs", empty, () => true)).rejects.toThrow("SearchCancelled");
});
it("stores approval separately from translation, checks stale glossary/settings and GM permission", async () => {
  let store = structuredClone(empty);
  const set = vi.fn(async (_module, _key, value) => { store = structuredClone(value); });
  vi.stubGlobal("game", { user: { isGM: true, name: "GM" }, settings: { get: () => store, set } });
  const load = vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting").mockResolvedValue([term]);
  const saved = await saveNameForm(empty, term, "cs", "Agrabandovi Rychlému");
  expect(readNameForms()).toEqual(saved); expect(saved.entries).toHaveLength(1);
  await expect(saveNameForm(empty, term, "cs", "Agraband Rychlý")).rejects.toThrow("Conflict");
  load.mockResolvedValue([{ ...term, replacement: "Agraband Hbitý" }]);
  await expect(saveNameForm(saved, term, "cs", "Agraband Rychlý")).rejects.toThrow("NameGlossaryChanged");
  load.mockResolvedValue([term]);
  expect((await saveNameForm(saved, term, "cs", saved.entries[0]!.form, true)).entries).toEqual([]);
  (game.user as any).isGM = false;
  await expect(saveNameForm(empty, term, "cs", term.replacement)).rejects.toThrow("GMOnly");
  expect(set).toHaveBeenCalledTimes(2);
});
it("distinguishes a capitalized proper name from a common noun and accepts another glossary term", async () => {
  const tempest = { ...term, source: "Tempest", replacement: "Bouřnov", category: "location" as const, aliases: [] };
  expect((await auditNames(index(["A ship in a tempest."], ["Loď v bouři."]), [tempest], "cs", empty)).findings).toEqual([]);
  expect((await auditNames(index(["A ship in Tempest."], ["Loď v Bouřnově."]), [tempest], "cs", empty)).findings[0]?.status).toBe("inflected");
  const city = { ...term, source: "Ordain", replacement: "Ordain", aliases: [] }, people = { ...city, source: "Ordani", replacement: "Ordaiňan" };
  const result = await auditNames(index(["Ordain has Ordani citizens."], ["Ordain je domovem Ordaiňanů."]), [city, people], "cs", empty);
  expect(result.findings.filter(isNameConcern)).toEqual([]);
  const generic = { ...term, source: "Party", replacement: "Družina", category: "term" as const, aliases: [] };
  expect((await auditNames(index(["The party arrived."], ["Přijela družina."]), [generic], "cs", empty)).findings[0]?.status).toBe("exact");
});
