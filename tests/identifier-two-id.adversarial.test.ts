import { referenceIdentifierRepairDraft as baselineDraft } from "./fixtures/reference-identifier-repair-baseline";
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


const anchor = '@UUID[Compendium.fixture.spells.Item.syntheticSpell]';
const original = `<p>&Reference[poisoned] and &Reference[incapacitated] ${anchor}{Fictional restoration}.</p>`;
const translated = `<p>&Reference[otrávený] a &Reference[neschopný pohybu] ${anchor}{Testovací obnova}.</p>`;
it('repairs exactly two bare IDs with an unchanged unavailable lexical UUID without touching fallback/prose', () => {
  const s = fixture(original, translated), frozen = JSON.stringify(s);
  const r = referenceIdentifierRepairDraft(s, 'field')!;
  expect(r.changes).toHaveLength(1); expect(r.identifiers).toHaveLength(2);
  expect(r.changes[0]!.parts).toEqual([translated.slice(3, -4).replace('&Reference[otrávený]', '&Reference[poisoned]').replace('&Reference[neschopný pohybu]', '&Reference[incapacitated]')]);
  expect(r.value).toContain(`${anchor}{Testovací obnova}`);
  expect(JSON.stringify(s)).toBe(frozen);
});
it.each([
  ['unanchored', original.replace(` ${anchor}{Fictional restoration}`, ''), translated.replace(` ${anchor}{Testovací obnova}`, '')],
  ['duplicate source IDs', original.replace('[incapacitated]', '[poisoned]'), translated],
  ['duplicate target IDs', original, translated.replace('[neschopný pohybu]', '[otrávený]')],
  ['swapped source pair', original, translated.replace('[otrávený]', '[incapacitated]').replace('[neschopný pohybu]', '[poisoned]')],
  ['missing ID', original, translated.replace('&Reference[neschopný pohybu]', '')],
  ['extra ID', original, translated.replace(' a ', ' &Reference[ležící] a ')],
  ['changed UUID identity', original, translated.replace('syntheticSpell', 'different')],
  ['reordered anchor slot', original, `<p>${anchor}{Testovací obnova} &Reference[otrávený] a &Reference[neschopný pohybu].</p>`],
  ['resolver label', original, translated.replace('&Reference[otrávený]', '&Reference[otrávený]{Jed}')],
  ['source resolver label', original.replace('&Reference[poisoned]', '&Reference[poisoned]{Poisoned}'), translated],
  ['resolver option', original, translated.replace('[otrávený]', '[otrávený option="x"]')],
  ['control character', original, translated.replace('[otrávený]', '[otrá\nvený]')],
  ['cross formatted part', original, translated.replace('&Reference[neschopný pohybu]', '<strong>&Reference[neschopný pohybu]</strong>')],
  ['both sides span formatted parts', original.replace('&Reference[incapacitated]', '<strong>&Reference[incapacitated]</strong>'), translated.replace('&Reference[neschopný pohybu]', '<strong>&Reference[neschopný pohybu]</strong>')],
  ['markup damage', original, translated.replace('<p>', '<p class="bad">')],
  ['third pair', original.replace(' and ', ' &Reference[prone] and '), translated.replace(' a ', ' &Reference[ležící] a ')],
  ['missing unaffected UUID', original + '<p>@UUID[Item.a]</p>', translated + '<p>Chybí.</p>'],
  ['changed unaffected roll', original + '<p>[[/roll 2d4]]</p>', translated + '<p>[[/roll 3d4]]</p>'],
])('rejects anchored adversarial damage: %s', (_name, source, current) => {
  expect(referenceIdentifierRepairDraft(fixture(source!, current!), 'field')).toBeNull();
});
it('admits canonical provenance for other UUID slots but requires one lexical anchor', () => {
  const s = fixture(original.replace('</p>', ' @UUID[Actor.a]{A}.</p>'), translated.replace('</p>', ' @UUID[Compendium.world.actors.Actor.copy]{Spojence}.</p>'), new Map([['Compendium.world.actors.Actor.copy', 'Actor.a']]));
  expect(referenceIdentifierRepairDraft(s, 'field')?.value).toContain('@UUID[Compendium.world.actors.Actor.copy]{Spojence}');
  const noLexical = fixture('<p>&Reference[poisoned] &Reference[incapacitated] @UUID[Actor.a]</p>', '<p>&Reference[otrávený] &Reference[neschopný pohybu] @UUID[Compendium.world.actors.Actor.copy]</p>', new Map([['Compendium.world.actors.Actor.copy', 'Actor.a']]));
  expect(referenceIdentifierRepairDraft(noLexical, 'field')).toBeNull();
});
it('fails closed when another damage-bearing part is present in the same row', () => {
  const s = fixture(original.replace('</p>', '<strong>&Reference[prone]</strong></p>'), translated.replace('</p>', '<strong>&Reference[ležící]</strong></p>'));
  expect(referenceIdentifierRepairDraft(s, 'field')).toBeNull();
});

it('documents existing one-ID unordered boundary equally in baseline and prototype; not a paired-branch regression', () => {
  const s = fixture(original, translated.replace('[otrávený]', '[incapacitated]'));
  const before = JSON.stringify(s), baseline = baselineDraft(s, 'field'), prototype = referenceIdentifierRepairDraft(s, 'field');
  expect(baseline).not.toBeNull(); expect(prototype).toEqual(baseline); expect(baseline!.identifiers).toHaveLength(1);
  expect(baseline!.changes[0]!.parts[0]).toContain('&Reference[incapacitated] a &Reference[poisoned]');
  expect(JSON.stringify(s)).toBe(before);
});
it('baseline rejects the actual new anchored pair while prototype admits it', () => {
  const s = fixture(original, translated); expect(baselineDraft(s, 'field')).toBeNull();
  expect(referenceIdentifierRepairDraft(s, 'field')?.identifiers).toHaveLength(2);
});
