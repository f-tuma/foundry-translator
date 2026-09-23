import { afterEach, expect, it, vi } from "vitest";
import { contextTerms, contextLinks } from "../src/review/context-panel";
import { editorialKey, queueItems, readBookmark, readEditorial, saveBookmark, writeEditorial } from "../src/review/editorial";
import type { ReviewDocument, ReviewRow, ReviewSnapshot } from "../src/review/service";
import type { GlossaryEntry } from "../src/glossary/types";
const entry: ReviewDocument = { uuid: "Compendium.world.test.JournalEntry.copy", sourceUuid: "JournalEntry.source", id: "copy", pack: "world.test", name: "Guide", language: "cs", kind: "JournalEntry" };
const row = (id = "r1", extra: Partial<ReviewRow> = {}): ReviewRow => ({ id, group: "document", fieldId: "name", unitId: "text", label: "name", format: "text", source: ["Agraband Swift"], translation: ["Agraband Rychlý"], fingerprint: "f1", heading: false, blocked: null, verified: null, ...extra });
const term = (source: string, replacement: string): GlossaryEntry => ({ source, replacement, category: "character", mode: "inflect", aliases: [] });
function setup() {
  let store: unknown = { version: 1, entries: {} };
  vi.stubGlobal("game", { world: { id: "world1" }, user: { id: "gm", name: "GM", isGM: true }, settings: { get: () => store, set: vi.fn(async (_ns, _key, value) => { store = value; }) } });
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  return storage;
}
afterEach(() => vi.unstubAllGlobals());
it("keeps independent notes, detects concurrent note changes and never writes translation content", async () => {
  setup();
  await writeEditorial(entry, row(), null, "meaning", "Check the actor's motivation.");
  const first = readEditorial().entries[editorialKey(entry, "r1")]!;
  expect(first).toMatchObject({ state: "meaning", fingerprint: "f1", userName: "GM" });
  await writeEditorial(entry, row("r2"), null, "discussion", "Discuss name");
  await expect(writeEditorial(entry, row(), null, "none", "overwrite")).rejects.toThrow("Conflict");
  await writeEditorial(entry, row(), first, "none", "");
  expect(Object.keys(readEditorial().entries)).toEqual([editorialKey(entry, "r2")]);
  expect(game.settings.set).toHaveBeenCalledTimes(3);
});
it("restricts note writes to GM and rejects invalid or oversized input", async () => {
  setup(); game.user!.isGM = false;
  await expect(writeEditorial(entry, row(), null, "none", "hello")).rejects.toThrow("GMOnly");
  game.user!.isGM = true;
  await expect(writeEditorial(entry, row(), null, "meaning", "x".repeat(8001))).rejects.toThrow("NoteInvalid");
  expect(game.settings.set).not.toHaveBeenCalled();
});
it("orders the queue by document and actual section order, excludes blocked rows and keeps issues independent of verification", () => {
  const issue = { state: "meaning" as const, note: "Check", fingerprint: "old", at: "2026", userName: "GM" };
  const snapshot = { entry, groups: [{ id: "document", name: "Root" }, { id: "early", name: "First" }, { id: "later", name: "Second" }], rows: [row("late", { group: "later" }), row("root"), row("early", { group: "early" }), row("blocked", { blocked: "Untranslated" }), row("checked", { verified: { at: "2026", userId: "gm", userName: "GM", fingerprint: "f1" }, editorial: issue })] } as ReviewSnapshot;
  const index = { snapshots: [snapshot], skipped: [] };
  expect(queueItems(index, "unverified").map(item => item.row.id)).toEqual(["root", "early", "late"]);
  expect(queueItems(index, "meaning").map(item => item.row.id)).toEqual(["checked"]);
  expect(queueItems(index, "notes")).toHaveLength(1);
});
it("scopes bookmarks by world, user and language and tolerates unavailable storage", () => {
  setup(); saveBookmark(entry, row());
  expect(readBookmark("cs")?.rowId).toBe("r1"); expect(readBookmark("en")).toBeNull();
  (game.user as { isGM: boolean; id?: string }).id = "other"; expect(readBookmark("cs")).toBeNull();
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } });
  expect(readBookmark("cs")).toBeNull(); expect(() => saveBookmark(entry, row())).not.toThrow();
});
it("shows longest source glossary names across inline formatting while excluding code and UUID targets", () => {
  const long = term("Agraband Swift", "Agraband Rychlý"), short = term("Swift", "Rychlý"), alias = { ...term("Old Carinth", "Starý Carinth"), aliases: ["Old City"] };
  const result = contextTerms(row("x", { format: "html", source: ["Agraband ", "Swift travels to Old City. @UUID[Actor.Tempest]{someone} `Tempest` tempest"] }), [short, long, alias, term("Tempest", "Bouře"), { ...term("travels", "cestuje"), enabled: false }]);
  expect(result).toEqual([long, alias]);
});
it("only offers inert UUID references, never macros, rolls, URLs or relative destinations", () => {
  expect(contextLinks(row("x", { source: ["@UUID[Actor.test]{<img src=x>} @Macro[delete] [[1d6]] @UUID[.relative] @UUID[https://evil] @UUID[Actor.test]{Name}"] }))).toEqual([{ uuid: "Actor.test", label: "Name" }]);
});
