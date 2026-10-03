import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { maskReviewParts, restoreReviewParts, maskReviewReferences, planReviewText, restoreReviewReferences } from "../src/review/text-plan";
import { assertPortableText } from "../src/bundles/format";

beforeEach(() => vi.stubGlobal("document", parseHTML("<html><body></body></html>").document));
afterEach(() => vi.unstubAllGlobals());

it("aligns prose around icons whose invisible placeholder was omitted, without creating a phantom review row", () => {
  const source = '<p><span class="reference fa-solid fa-map">\u200b</span> Read <strong>this</strong>.</p>';
  const target = '<p><span class="reference fa-solid fa-map"></span> Přečti <strong>toto</strong>.</p>';
  const before = planReviewText(source, "html"), after = planReviewText(target, "html");
  expect(before.units.map(u => u.id)).toEqual(after.units.map(u => u.id));
  expect(before.units.map(u => u.parts.length)).toEqual(after.units.map(u => u.parts.length));
  expect(before.units).toHaveLength(1);
  expect(before.units[0]!.parts).toEqual([" Read ", "this", "."]);
  expect(() => assertPortableText(source, after.replace(after.units[0]!.id, [" Prohlédni si ", "toto", "."]), "html")).not.toThrow();
});

it("keeps paragraphs and inline formatting together without exposing executable markup", () => {
  const value = '<h2>Arrival</h2><p>The <strong>three-toed</strong> feet.</p><p>Next.</p><img src="map.webp" alt="Map"><pre>keep me</pre>';
  const plan = planReviewText(value, "html");
  expect(plan.units.map(row => row.parts)).toEqual([["Arrival"], ["The ", "three-toed", " feet."], ["Next."], ["Map"]]);
  expect(plan.units[0]!.heading).toBe(true);
  const result = plan.replace(plan.units[1]!.id, ["Jeho ", "tříprsté", " nohy."]);
  expect(result).toContain('<p>Jeho <strong>tříprsté</strong> nohy.</p>');
  expect(result).toContain('<img src="map.webp" alt="Map">');
  expect(result).toContain('<pre>keep me</pre>');
  expect(() => assertPortableText(value, result, "html")).not.toThrow();
});
it("aligns structural addresses regardless of paragraph length and escapes typed markup", () => {
  const source = planReviewText('<p>Short.</p><p>Next.</p>', "html");
  const copy = planReviewText(`<p>${"Dlouhé. ".repeat(1000)}</p><p>Další.</p>`, "html");
  expect(source.units.map(row => row.id)).toEqual(copy.units.map(row => row.id));
  const edited = copy.replace(copy.units[1]!.id, ['<img src=x onerror="evil()">']);
  expect(edited).toContain('&lt;img');
  expect(edited).not.toContain('<img');
});
it("merges entity text boundaries while preserving inline element boundaries", () => {
  const source = '<p>A &amp; B meet <strong>Swift</strong> near the bridge.</p>';
  const translated = '<p>A a B potkají <strong>Rychlého</strong> u mostu.</p>';
  expect(() => assertPortableText(source, translated, "html")).not.toThrow();
  const sourcePlan = planReviewText(source, "html"), targetPlan = planReviewText(translated, "html");
  expect(sourcePlan.units[0]!.parts).toEqual(['A & B meet ', 'Swift', ' near the bridge.']);
  expect(sourcePlan.units.map(u => [u.id, u.parts.length])).toEqual(targetPlan.units.map(u => [u.id, u.parts.length]));
  expect(() => assertPortableText(source, translated.replace('<strong>', '<em>').replace('</strong>', '</em>'), "html")).toThrow();
  expect(() => assertPortableText('<code>A &amp; B</code>', '<code>A a B</code>', "html")).toThrow();
});
it("masks references, edits display labels and preserves UUIDs and rolls", () => {
  const masked = maskReviewReferences('Meet @UUID[Actor.swift]{Swift}, then [[/r 1d6]].');
  expect(masked.text).toBe('Meet ⟦1⟧, then ⟦2⟧.');
  masked.references[0]!.label = "Rychlý";
  expect(restoreReviewReferences('Potkej ⟦1⟧, pak ⟦2⟧.', masked.references)).toBe('Potkej @UUID[Actor.swift]{Rychlý}, pak [[/r 1d6]].');
  expect(restoreReviewReferences('⟦2⟧ a ⟦1⟧.', masked.references)).toBe('[[/r 1d6]] a @UUID[Actor.swift]{Rychlý}.');
  for (const value of ['⟦1⟧', '⟦1⟧ ⟦1⟧ ⟦2⟧']) expect(() => restoreReviewReferences(value, masked.references)).toThrow('Review.ReferenceChanged');
});
it("does not confuse literal reference markers or silently process nested placeholders", () => {
  const masked = maskReviewReferences('Literal ⟦1⟧ and @UUID[Actor.swift].');
  expect(masked.references[0]!.marker).toBe('⟦⟦1⟧⟧');
  expect(restoreReviewReferences(masked.text, masked.references)).toBe('Literal ⟦1⟧ and @UUID[Actor.swift].');
  masked.references[0]!.label = 'Bad}\nlabel';
  expect(() => restoreReviewReferences(masked.text, masked.references)).toThrow();
});

it("moves whole links and embeds between formatted fragments and edits their labels", () => {
  const draft = maskReviewParts(['Meet @UUID[Actor.a]{A}, ', 'then', ' @Embed[JournalEntry.b inline]{B}.']);
  expect(draft.text).toEqual(['Meet ⟦1⟧, ', 'then', ' ⟦2⟧.']);
  draft.text = ['⟦2⟧ potkáte ', 'poté', ' u ⟦1⟧.'];
  draft.references[0]![0]!.label = 'Ačka';
  draft.references[2]![0]!.label = 'Béčko';
  expect(restoreReviewParts(draft)).toEqual(['@Embed[JournalEntry.b inline]{Béčko} potkáte ', 'poté', ' u @UUID[Actor.a]{Ačka}.']);
  draft.text[2] = ' u vchodu.';
  expect(() => restoreReviewParts(draft)).toThrow('Review.ReferenceChanged');
});
it("counts complete markers, rejects nested commands in labels and keeps duplicate destinations distinct", () => {
  const draft = maskReviewParts(['@UUID[Actor.a]{A} and @UUID[Actor.a]{Again}']);
  draft.text = ['⟦2⟧ a ⟦1⟧'];
  expect(restoreReviewParts(draft)[0]).toBe('@UUID[Actor.a]{Again} a @UUID[Actor.a]{A}');
  draft.text = ['⟦⟦1⟧⟧ a ⟦2⟧'];
  expect(() => restoreReviewParts(draft)).toThrow();
  draft.text = ['⟦1⟧ a ⟦2⟧'];
  draft.references[0]![0]!.label = '@Macro[evil]';
  expect(() => restoreReviewParts(draft)).toThrow();
});

it("edits resolver fallback names and moves sentence prose outside the label without changing its expression", () => {
  const source = '<p>@ref[actor.name]{The Watcher} waits beside the gate.</p>';
  const target = '<p>@ref[actor.name]{Strážce čeká u brány.}</p>';
  const plan = planReviewText(target, "html");
  const draft = maskReviewParts(plan.units[0]!.parts);
  expect(draft.references[0]![0]!.editable).toBe(true);
  draft.references[0]![0]!.label = "Strážce";
  draft.text = ["U brány čeká ⟦1⟧."];
  const result = plan.replace(plan.units[0]!.id, restoreReviewParts(draft));
  expect(result).toBe('<p>U brány čeká @ref[actor.name]{Strážce}.</p>');
  expect(() => assertPortableText(source, result, "html")).not.toThrow();
  expect(() => assertPortableText(source, result.replace('actor.name', 'actor.secret'), "html")).toThrow();
  for (const label of ['@Macro[execute]', '[[/r 1d20]]', 'Name}\n{other']) {
    draft.references[0]![0]!.label = label;
    expect(() => restoreReviewParts(draft)).toThrow("Review.ReferenceChanged");
  }
});

it("preserves empty resolver fallback braces and leaves unlabeled expressions protected", () => {
  for (const command of ['@ref[actor.name]{}', '@ref[actor.name]{ }', '@ref[actor.name]']) {
    const draft = maskReviewParts([command]);
    expect(restoreReviewParts(draft)).toEqual([command]);
  }
  const empty = maskReviewParts(['@ref[actor.name]{}']);
  empty.references[0]![0]!.label = 'Tvor';
  expect(restoreReviewParts(empty)).toEqual(['@ref[actor.name]{Tvor}']);
  empty.references[0]![0]!.label = '';
  expect(restoreReviewParts(empty)).toEqual(['@ref[actor.name]{}']);
  expect(() => assertPortableText('@ref[actor.name]{Creature}', '@ref[actor.name]{}', 'text')).not.toThrow();
  expect(maskReviewParts(['@ref[actor.name]']).references[0]![0]!.editable).toBe(false);
});
