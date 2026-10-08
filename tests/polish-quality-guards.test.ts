import { describe, expect, it } from "vitest";
import { correctionOptionChanges, correctionParts, correctionWarnings, embedOptionNumbersChanged, polishProse, proseNumbers, sourceNumberRepair } from "../src/polish/quality-guards";
import { maskReviewParts } from "../src/review/text-plan";
import type { GlossaryEntry } from "../src/glossary/types";

describe("Embed prose corrections and quality guards", () => {
  const before = ['Before @Embed[Actor.a readaloud="A scout waits 2 hours." caption="Scout" count=9]{Name}.'];
  it("previews and restores requested existing options without caller commands or offsets", () => {
    const options = [{ marker: '⟦1⟧', key: 'readaloud' as const, value: 'Zvěd čeká 2 hodiny.' }];
    expect(correctionOptionChanges(before, options)).toEqual([{ marker: '⟦1⟧', key: 'readaloud', before: 'A scout waits 2 hours.', after: 'Zvěd čeká 2 hodiny.' }]);
    const result = correctionParts(before, ['⟦1⟧ stojí před vámi.'], [{ marker: '⟦1⟧', label: 'Jméno' }], undefined, options);
    expect(result).toEqual(['@Embed[Actor.a readaloud="Zvěd čeká 2 hodiny." caption="Scout" count=9]{Jméno} stojí před vámi.']);
    expect(proseNumbers(result)).toEqual(['2']); expect(polishProse(result)).toContain('Zvěd čeká 2 hodiny.');
    expect(correctionParts(before, maskReviewParts(before).text, [])).toEqual(before);
  });
  it("rejects unknown/duplicate/injected option edits and retains the repairDraft fourth parameter", () => {
    const edit = { marker: '⟦1⟧', key: 'readaloud' as const, value: 'Zvěd.' };
    for (const options of [[{ ...edit, marker: '⟦9⟧' }], [edit, edit], [{ ...edit, key: 'label' as const }], [{ ...edit, value: 'Bad" count=99' }]]) {
      expect(() => correctionParts(before, ['⟦1⟧'], [], undefined, options)).toThrow('Review.ReferenceChanged');
    }
    const repairDraft = maskReviewParts(['@UUID[Actor.a.Item.child]{Strike}']);
    const saved = JSON.stringify(repairDraft);
    expect(correctionParts(['@UUID[Actor.a]{Strike}'], ['⟦1⟧'], [{ marker: '⟦1⟧', label: 'Úder' }], repairDraft)).toEqual(['@UUID[Actor.a.Item.child]{Úder}']);
    expect(JSON.stringify(repairDraft)).toBe(saved);
  });
  it("checks EXACT glossary prose inside option text", () => {
    const term = { source: 'Scout', replacement: 'Zvěd', aliases: [], category: 'character', enabled: true } as GlossaryEntry;
    const a = ['@Embed[Actor.a readaloud="Zvěd čeká."]'], b = ['@Embed[Actor.a readaloud="Tvor čeká."]'];
    expect(() => correctionWarnings(a, b, [term])).toThrow('EXACT glossary term removed');
  });
  it("rejects numerical changes even when an opposite outside or caption edit preserves global numbers", () => {
    const a = ['3 @Embed[Actor.a readaloud="Wait 2 hours." caption="Party 4"]'];
    const b = ['2 @Embed[Actor.a readaloud="Wait 3 hours." caption="Party 4"]'];
    const c = ['3 @Embed[Actor.a readaloud="Wait 4 hours." caption="Party 2"]'];
    expect(proseNumbers(a)).toEqual(proseNumbers(b)); expect(proseNumbers(a)).toEqual(proseNumbers(c));
    expect(embedOptionNumbersChanged(a, b)).toBe(true); expect(embedOptionNumbersChanged(a, c)).toBe(true);
    expect(correctionWarnings(a, b, [])).toContain('Numbers changed. Compare quantities, dates and rules with the English source.');
    expect(sourceNumberRepair(a, a, c).allowed).toBe(false);
  });
  it("permits only uniquely source-bound complete numerical restoration, with authoritative copy remapping", () => {
    const source = ['@Embed[Actor.a readaloud="Wait 3 hours." count=2]'];
    const old = ['@Embed[Compendium.world.copies.Actor.copy readaloud="Čekejte 4 hodiny." count=2]'];
    const after = ['@Embed[Compendium.world.copies.Actor.copy readaloud="Čekejte 3 hodiny." count=2]'];
    expect(sourceNumberRepair(source, old, after).allowed).toBe(false);
    const canonical = (parts: string[]) => parts.map(part => part.replace('Compendium.world.copies.Actor.copy', 'Actor.a'));
    expect(sourceNumberRepair(source, old, after, canonical).allowed).toBe(true);
    expect(sourceNumberRepair(source, old, after.map(part => part.replace('3 hodiny', '5 hodin')), canonical).allowed).toBe(false);
    expect(sourceNumberRepair(['@Embed[Actor.b readaloud="Wait 3 hours." count=2]'], old, after, canonical).allowed).toBe(false);
  });
  it("fails closed for competing source overrides instead of binding them by order", () => {
    const source = ['@Embed[Actor.a readaloud="Wait 2 hours."] @Embed[Actor.a readaloud="Wait 3 hours."]'];
    const old = ['@Embed[Actor.a readaloud="Čekejte 2 hodiny."] @Embed[Actor.a readaloud="Čekejte 4 hodiny."]'];
    const after = ['@Embed[Actor.a readaloud="Čekejte 2 hodiny."] @Embed[Actor.a readaloud="Čekejte 3 hodiny."]'];
    expect(sourceNumberRepair(source, old, after).allowed).toBe(false);
  });
  it("can restore swapped slots when each is bound to a unique source config, even if global quantities originally matched", () => {
    const source = ['@Embed[Actor.a readaloud="Wait 2 hours." caption="Group 3"]'];
    const old = ['@Embed[Actor.a readaloud="Čekejte 3 hodiny." caption="Skupina 2"]'];
    const after = ['@Embed[Actor.a readaloud="Čekejte 2 hodiny." caption="Skupina 3"]'];
    expect(sourceNumberRepair(source, old, after).allowed).toBe(true);
  });
  it("retains legacy prose-number restoration and accepts reorder with unchanged option quantities", () => {
    expect(sourceNumberRepair(['Chapter 2'], ['Kapitola 3'], ['Kapitola 2']).allowed).toBe(true);
    const a = '@Embed[Actor.a readaloud="2 hours"]', b = '@Embed[Actor.b readaloud="3 hours"]';
    expect(embedOptionNumbersChanged([a + b], [b + a])).toBe(false);
    expect(embedOptionNumbersChanged([a + b], [b.replace('hours', 'hodiny') + a.replace('hours', 'hodiny')])).toBe(false);
  });
  it("restores Soothe's quantity to its exact formatted source part when the whole-row numbers already match", () => {
    const source = ['You perform a calming verse, benefiting all allies who can perceive you within ', '12 feet', '. Make a ',
      'Performance', ' check against the ', 'Rallying Threshold', " of each ally. On success, each ally's ", 'Morale', ' is restored.'];
    const before = ['Přednesete uklidňující verš, který prospívá všem spojencům, kteří vás vnímají do 12 stop.', ' Provedete',
      ' ověření dovednosti ', 'Uměleckého vystupování', ' proti ', 'Prahu povzbuzení',
      ' každého spojence. Při úspěchu se každému spojenci obnoví ', 'Morálka', '.'];
    const after = ['Přednesete uklidňující verš, který prospívá všem spojencům, kteří vás vnímají do ', '12 stop',
      '. Provedete ověření dovednosti ', ...before.slice(3)];
    expect(proseNumbers(before)).toEqual(proseNumbers(after));
    expect(sourceNumberRepair(source, before, after)).toMatchObject({ allowed: true, placementOnly: true,
      source: ['12'], before: ['12'], after: ['12'], parts: [
        { source: [], before: ['12'], after: [] }, { source: ['12'], before: [], after: ['12'] },
        ...source.slice(2).map(() => ({ source: [], before: [], after: [] })),
      ] });
    expect(sourceNumberRepair(source, after, after).allowed).toBe(false);
    const wrongPart = [...after]; wrongPart[1] = 'stopy'; wrongPart[2] = '. Provedete 12 ověření dovednosti ';
    const duplicate = [...after]; duplicate[0] += '12 ';
    const unrelated = [...after]; unrelated[1] = '13 stop';
    const command = [...after]; command[2] += '[[/r 12d6]]';
    const lostPart = [...after]; lostPart.splice(2, 1);
    for (const invalid of [wrongPart, duplicate, unrelated, command, lostPart]) {
      expect(sourceNumberRepair(source, before, invalid).allowed).toBe(false);
    }
  });
  it("rejects globally restored but redistributed quantities, ambiguous parts and command movement", () => {
    expect(sourceNumberRepair(['Distance ', '12 feet', ' for 3 rounds'], ['Vzdálenost ', '99 stop', ' po 4 kola'],
      ['Vzdálenost 12 ', 'stopy', ' po 3 kola']).allowed).toBe(false);
    expect(sourceNumberRepair(['Distance ', '12 feet'], ['Vzdálenost 99 stop'], ['Vzdálenost ', '12 stop']).allowed).toBe(false);
    const source = ['Within @UUID[Item.abc123]{Focus}', '12 feet'];
    const before = ['Do 12 stop @UUID[Item.abc123]{Focus}', ' provedete'];
    const after = ['Do @UUID[Item.abc123]{Focus}', '12 stop'];
    expect(sourceNumberRepair(source, before, after).allowed).toBe(true);
    expect(sourceNumberRepair(source, before, ['Do ', '12 stop @UUID[Item.abc123]{Focus}']).allowed).toBe(false);
    expect(sourceNumberRepair(source, before, ['Do @UUID[Item.abc456]{Focus}', '12 stop']).allowed).toBe(false);
  });
});
