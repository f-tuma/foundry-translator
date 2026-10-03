import { describe, expect, it } from "vitest";
import { applyEmbedTextOptions, assertEmbedOptionEdits, editableEmbedTextOptions, embedOptionChanges, safeEmbedOptionText } from "../src/review/embed-text-options";

describe("existing Embed plain text option edits", () => {
  it("edits only top-level existing quoted prose, preserving exact configuration and fallback", () => {
    const command = '@Embed[Actor.scout  inline cite=false count=4 image="token" readaloud="A scout.\\nHe waits." caption="Old caption" label="Scout" classes="wide"]{Fallback}';
    expect(editableEmbedTextOptions(command)).toEqual([
      { key: "readaloud", value: "A scout.\\nHe waits." }, { key: "caption", value: "Old caption" }, { key: "label", value: "Scout" },
    ]);
    const after = applyEmbedTextOptions(command, [{ key: "readaloud", value: "Zvěd.\\nČeká." }, { key: "label", value: "Zvěd" }]);
    expect(after).toBe('@Embed[Actor.scout  inline cite=false count=4 image="token" readaloud="Zvěd.\\nČeká." caption="Old caption" label="Zvěd" classes="wide"]{Fallback}');
    expect(() => assertEmbedOptionEdits([command], [after])).not.toThrow();
    expect(command).toContain('readaloud="A scout.');
  });
  it("leaves boolean/unquoted options immutable and distinguishes words in a quoted value from keys", () => {
    const command = '@Embed[Actor.a caption=false label=Name count=4 readaloud="The label and caption are ordinary words."]';
    expect(editableEmbedTextOptions(command)).toEqual([{ key: "readaloud", value: "The label and caption are ordinary words." }]);
    expect(() => applyEmbedTextOptions(command, [{ key: "caption", value: "Popisek" }])).toThrow("Review.ReferenceChanged");
    expect(applyEmbedTextOptions(command, [{ key: "readaloud", value: "Popisek je obyčejné slovo." }])).toContain('caption=false label=Name count=4');
  });
  it.each([
    '@Embed[Actor.a readaloud="A" readaloud="B"]', '@Embed[Actor.a readaloud="A" Readaloud=false]',
    '@Embed[Actor.a readaloud="A]', '@Embed[Actor.a readaloud="A"trailing]',
    '@Embed[Actor.a readaloud="caption=Bad"]', '@Embed[Actor.a readaloud=""]', '@Embed[Actor.a readaloud="<p>HTML</p>"]',
    '@Embed[Actor.a readaloud=false]', '@Embed[Actor.a caption=4]', '@Embed[Actor.a Readaloud="A"]',
  ])("does not expose ambiguous, malformed, unsafe or nontextual configuration: %s", command => {
    expect(editableEmbedTextOptions(command)).toEqual([]);
    expect(() => applyEmbedTextOptions(command, [{ key: "readaloud", value: "Text" }])).toThrow();
    expect(applyEmbedTextOptions(command, [])).toBe(command);
  });
  it.each(['', '   ', '" break', 'key=value', 'x] count=9', '<img onerror=evil>', '{caption}', '@UUID[Actor.a]', '[[1d20]]', '⟦2⟧', '__FTS_A_0001__', 'A\nB', 'A\u0000B'])
  ("rejects unsupported payload %s", value => {
    expect(safeEmbedOptionText(value)).toBe(false);
    expect(() => applyEmbedTextOptions('@Embed[Actor.a readaloud="Original"]', [{ key: "readaloud", value }])).toThrow();
  });
  it("rejects new/duplicate option keys and raw configuration edits", () => {
    const before = '@Embed[Actor.a readaloud="Original" count=4]';
    expect(() => applyEmbedTextOptions(before, [{ key: "caption", value: "New" }])).toThrow();
    expect(() => applyEmbedTextOptions(before, [{ key: "readaloud", value: "One" }, { key: "readaloud", value: "Two" }])).toThrow();
    for (const after of [before.replace('Actor.a', 'Actor.b'), before.replace('count=4', 'count=9'), before.replace('readaloud=', 'label='),
      before.replace('Original', '<em>HTML</em>'), before.replace('Original', ''), before.replace(']', ' caption="New"]')]) {
      expect(() => assertEmbedOptionEdits([before], [after])).toThrow("Review.ReferenceChanged");
    }
  });
  it("allows complete marker/config reordering without relying on occurrence order", () => {
    const a = '@Embed[Actor.a readaloud="One"]', b = '@Embed[Actor.b readaloud="Two"]';
    const changes = embedOptionChanges([`${a} ${b}`], [`${b.replace('Two', 'Dva')} ${a.replace('One', 'Jeden')}`]);
    expect(changes.map(({ before, after }) => [before, after])).toEqual([["One", "Jeden"], ["Two", "Dva"]]);
    expect(() => assertEmbedOptionEdits([a + b], [b + a])).not.toThrow();
  });
  it("cancels unchanged duplicates before binding a single residual correction", () => {
    const a = '@Embed[Actor.a readaloud="First"]', b = '@Embed[Actor.a readaloud="Second"]';
    expect(embedOptionChanges([a + b], [b + a.replace('First', 'První')])).toHaveLength(1);
    expect(() => assertEmbedOptionEdits([a + b], [a.replace('First', 'První') + b.replace('Second', 'Druhý')])).toThrow();
    expect(embedOptionChanges([a + a], [a.replace('First', 'První') + a.replace('First', 'První')])).toHaveLength(2);
  });
  it("keeps unchanged legacy unsafe values and separately changed brace labels, without legalizing new payloads", () => {
    const unsafe = '@Embed[Actor.a readaloud="<em>Legacy</em>"]{Name}';
    expect(() => assertEmbedOptionEdits([unsafe], [unsafe.replace('{Name}', '{Jméno}')])).not.toThrow();
    expect(() => assertEmbedOptionEdits([unsafe], [unsafe.replace('Legacy', 'Other')])).toThrow();
    expect(() => assertEmbedOptionEdits([unsafe], [unsafe.replace('<em>Legacy</em>', 'Plain')])).toThrow();
  });
  it("rejects newly unterminated raw Embed commands instead of ignoring unmatched syntax", () => {
    expect(() => assertEmbedOptionEdits(['Text'], ['Text @Embed[Actor.a readaloud="Payload"'])).toThrow();
    const legacy = 'Text @Embed[Actor.a';
    expect(() => assertEmbedOptionEdits([legacy], [legacy])).not.toThrow();
    expect(() => assertEmbedOptionEdits([legacy], [legacy.replace('Actor.a', 'Actor.b')])).toThrow();
  });
});
