import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { diagnosePortableText } from "../src/bundles/format";
import { referenceIdentifierRepairDraft } from "../src/review/reference-identifier-repair";
import { portableReviewText, type ReviewSnapshot } from "../src/review/service";
import { planReviewText } from "../src/review/text-plan";

beforeEach(() => vi.stubGlobal("document", parseHTML("<html><body></body></html>").document));
afterEach(() => vi.unstubAllGlobals());

function fixture(source: string, translation: string, reverse = new Map<string, string>()): ReviewSnapshot {
  const field = { id: "field", source, translation, format: "html" as const, targetPath: ["description"], displayPlain: false };
  const snapshot: ReviewSnapshot = {
    entry: { id: "copy", pack: "world.translations", uuid: "Compendium.world.translations.JournalEntry.copy", name: "Guide", kind: "JournalEntry", sourceUuid: "JournalEntry.original", language: "cs" },
    sourceName: "Guide", rows: [], fields: [field], groups: [], sourceHash: "source", warning: null, partial: false,
    guard: { fingerprint: "guard" } as ReviewSnapshot["guard"], reverse,
  };
  const blocked = diagnosePortableText(source, portableReviewText(snapshot, field, translation), "html") ? "StructureChanged" : null;
  const targetPlan = planReviewText(translation, "html");
  snapshot.rows = planReviewText(source, "html").units.map((unit, index) => ({
    id: `row-${index}`, fieldId: field.id, unitId: unit.id, format: "html", group: "group", label: "text.content",
    source: unit.parts, translation: targetPlan.units.find(item => item.id === unit.id)?.parts ?? [translation],
    heading: unit.heading, fingerprint: "row", blocked, verified: null,
  }));
  return snapshot;
}

it("restores three source identifiers in one field while preserving Czech prose, formatting, numbers and mapped UUID labels", () => {
  const snapshot = fixture(
    '<p>The area is &amp;Reference[Lightly Obscured].</p><p><strong>Result 6:</strong> &Reference[Poisoned].</p><p>Take &Reference[Long Rest] for [[/roll 2d4 hours]] or @UUID[Actor.a]{Ally}.</p>',
    '<p>Oblast je &amp;Reference[Lehce zastřená].</p><p><strong>Výsledek 6:</strong> &Reference[Otravená].</p><p>Využij &Reference[Dlouhého odpočinku] po [[/roll 2d4 hours]] nebo @UUID[Compendium.world.actors.Actor.copy]{Spojence}.</p>',
    new Map([["Compendium.world.actors.Actor.copy", "Actor.a"]]),
  );
  const before = JSON.stringify(snapshot), repair = referenceIdentifierRepairDraft(snapshot, "field")!;
  expect(repair.changes).toHaveLength(3);
  expect(repair.identifiers).toEqual([
    { rowId: "row-0", before: "&Reference[Lehce zastřená]", after: "&Reference[Lightly Obscured]" },
    { rowId: "row-1", before: "&Reference[Otravená]", after: "&Reference[Poisoned]" },
    { rowId: "row-2", before: "&Reference[Dlouhého odpočinku]", after: "&Reference[Long Rest]" },
  ]);
  expect(repair.changes[1]!.parts).toEqual(["Výsledek 6:", " &Reference[Poisoned]."]);
  expect(repair.value).toBe('<p>Oblast je &amp;Reference[Lightly Obscured].</p><p><strong>Výsledek 6:</strong> &amp;Reference[Poisoned].</p><p>Využij &amp;Reference[Long Rest] po [[/roll 2d4 hours]] nebo @UUID[Compendium.world.actors.Actor.copy]{Spojence}.</p>');
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(diagnosePortableText(snapshot.fields[0]!.source, portableReviewText(snapshot, snapshot.fields[0]!, repair.value), "html")).toBeNull();
});

it("preserves the target occurrence position when sentence order and other links differ", () => {
  const snapshot = fixture('<p>&Reference[Poisoned] then @UUID[Actor.a]{A}.</p>', '<p>U @UUID[Actor.a]{Áčka} je teď &Reference[Otravená].</p>');
  expect(referenceIdentifierRepairDraft(snapshot, "field")?.changes[0]!.parts).toEqual(['U @UUID[Actor.a]{Áčka} je teď &Reference[Poisoned].']);
});

it.each([
  ['<p>&Reference[Poisoned] &Reference[Long Rest]</p>', '<p>&Reference[Otravená] &Reference[Odpočinek]</p>'],
  ['<p>&Reference[Poisoned]</p>', '<p>Otravená</p>'],
  ['<p>No condition.</p>', '<p>&Reference[Otravená]</p>'],
  ['<p>&Reference[Poisoned]</p>', '<p>&Reference[Otravená] &Reference[Otravená]</p>'],
  ['<p>&Reference[Poisoned]</p>', '<p class="bad">&Reference[Otravená]</p>'],
  ['<p>&Reference[Poisoned] @UUID[Actor.a]</p>', '<p>&Reference[Otravená] @UUID[Actor.b]</p>'],
  ['<p>&Reference[Poisoned]</p><p>[[/r 2d4]]</p>', '<p>&Reference[Otravená]</p><p>[[/r 3d4]]</p>'],
  ['<p>&Reference[Poisoned]</p><p>@Advantage[-2]</p>', '<p>&Reference[Otravená]</p><p>@Advantage[-1]</p>'],
  ['<p>&Reference[Poisoned]</p><p>@UUID[Actor.a]</p>', '<p>&Reference[Otravená]</p><p>Chybí.</p>'],
  ['<p>@UUID[Actor.a.Item.child]</p>', '<p>@UUID[Actor.a]</p>'],
  ['<p>&Reference[Poisoned]</p>', '<p>&Reference[Otravená]{Vlastní název}</p>'],
  ['<p>&Reference[Poisoned]{Poisoned}</p>', '<p>&Reference[Otravená]{Otravená}</p>'],
  ['<p>&Reference[Poisoned option="x"]</p>', '<p>&Reference[Otravená option="x"]</p>'],
  ['<p>&Reference[Poisoned] &Reference[Long Rest]</p>', '<p>&Reference[Long Rest] &Reference[Poisoned]</p>'],
])("rejects ambiguous or unsupported damage (%s)", (source, translation) => {
  expect(referenceIdentifierRepairDraft(fixture(source, translation), "field")).toBeNull();
});

it("does not infer identifier substitutions between different rows", () => {
  expect(referenceIdentifierRepairDraft(fixture('<p>&Reference[Poisoned]</p><p>Other.</p>', '<p>Jiné.</p><p>&Reference[Otravená]</p>'), "field")).toBeNull();
});

it.each(["MissingField", "Untranslated", "SourceChanged"])("rejects blocked %s rows and missing/mismatched snapshot rows", blocked => {
  const snapshot = fixture('<p>&Reference[Poisoned]</p>', '<p>&Reference[Otravená]</p>');
  snapshot.rows[0]!.blocked = blocked;
  expect(referenceIdentifierRepairDraft(snapshot, "field")).toBeNull();
  snapshot.rows[0]!.blocked = "StructureChanged";
  snapshot.rows[0]!.translation = ["Not the actual field"];
  expect(referenceIdentifierRepairDraft(snapshot, "field")).toBeNull();
  snapshot.rows = [];
  expect(referenceIdentifierRepairDraft(snapshot, "field")).toBeNull();
});

it("fails closed for source warnings, unknown fields, unchanged fields and formatted-part mismatches", () => {
  const snapshot = fixture('<p>&Reference[Poisoned]</p>', '<p>&Reference[Otravená]</p>');
  snapshot.warning = "SourceChanged";
  expect(referenceIdentifierRepairDraft(snapshot, "field")).toBeNull();
  expect(referenceIdentifierRepairDraft(snapshot, "missing")).toBeNull();
  expect(referenceIdentifierRepairDraft(fixture('<p>&Reference[Poisoned]</p>', '<p>&Reference[Poisoned]</p>'), "field")).toBeNull();
  expect(referenceIdentifierRepairDraft(fixture('<p><strong> </strong>&Reference[Poisoned]</p>', '<p><strong>Navíc</strong>&Reference[Otravená]</p>'), "field")).toBeNull();
});

it("can prove an exact forward repair of a reconstructed pre-undo field while preserving unrelated later prose", () => {
  const initial = fixture('<p>&Reference[Poisoned]</p><p>Other.</p>', '<p>&Reference[Otravená]</p><p>Jiné.</p>');
  const repair = referenceIdentifierRepairDraft(initial, "field")!;
  const reconstructed = fixture(initial.fields[0]!.source, initial.fields[0]!.translation.replace("Jiné.", "Pozdější jazyková oprava."));
  const forward = referenceIdentifierRepairDraft(reconstructed, "field")!;
  expect(forward.changes).toEqual(repair.changes);
  expect(forward.identifiers).toEqual(repair.identifiers);
  expect(forward.value).toContain("Pozdější jazyková oprava.");
});
