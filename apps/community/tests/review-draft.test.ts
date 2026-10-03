import { expect, it } from "vitest";
import { maskReviewParts } from "../../../src/review/text-plan";
import {
  changeWithDraft,
  compileChanges,
  editorDraft,
  referenceDraftError,
  validEditorDraft,
} from "../src/review-draft";
import type { Change } from "../src/shared";

it("retains a cut marker through storage and rejects submission until it has been pasted", () => {
  const value = ["Setkej se s @UUID[Actor.a]{Áčkem} a @UUID[Actor.b]{Béčkem}."];
  const change: Change = {
    unitId: "one",
    baseRevision: "r1",
    before: value,
    after: value,
  };
  const draft = maskReviewParts(value);
  draft.text = ["Setkej se s ⟦1⟧ a ."];
  const cut = changeWithDraft(change, draft);
  const recovered: Change = JSON.parse(JSON.stringify(cut));
  expect(editorDraft(recovered).text).toEqual(draft.text);
  expect(referenceDraftError(editorDraft(recovered))).toBeTruthy();
  expect(() => compileChanges([recovered])).toThrow();
  const moved = editorDraft(recovered);
  moved.text = ["⟦2⟧ se setká s ⟦1⟧."];
  moved.references[0]![1]!.label = "Béčko";
  const done = changeWithDraft(recovered, moved);
  expect(done.editor!.references[0]![1]!.marker).toBe("⟦2⟧");
  expect(compileChanges([done])).toEqual([
    {
      ...change,
      after: ["@UUID[Actor.b]{Béčko} se setká s @UUID[Actor.a]{Áčkem}."],
    },
  ]);
  expect(done.editor!.text[0]).toBe("⟦2⟧ se setká s ⟦1⟧.");
});
it("rejects duplicate markers, executable labels and malformed persisted drafts", () => {
  const draft = maskReviewParts(["@UUID[Actor.a]"]);
  draft.text = ["⟦1⟧ ⟦1⟧"];
  expect(referenceDraftError(draft)).toBeTruthy();
  draft.text = ["⟦1⟧"];
  draft.references[0]![0]!.label = "@Macro[evil]";
  expect(referenceDraftError(draft)).toBeTruthy();
  expect(
    validEditorDraft({ text: ["x"], references: [[{ marker: "x" }]] }),
  ).toBe(false);
});

it("persists embed options in version 1 row-scoped drafts and moves them with the marker", () => {
  const value = ['@Embed[Actor.a inline readaloud="Read me" caption="Caption" label="Heading"]{Brace}'];
  const change: Change = { unitId: "embed", baseRevision: "r1", before: value, after: value };
  const draft = maskReviewParts(value);
  draft.text = ['Na závěr ⟦1⟧.'];
  draft.references[0]![0]!.options!.find(option => option.key === "readaloud")!.value = "Přečti mě.";
  draft.references[0]![0]!.label = "Popisek";
  const done = changeWithDraft(change, draft);
  const serialized = JSON.parse(JSON.stringify(done));
  expect(serialized.editor.version).toBe(1);
  expect(serialized.editor.referenceScope).toBe("row");
  expect(serialized.editor.options).toContainEqual({ marker: "⟦1⟧", key: "readaloud", value: "Přečti mě." });
  expect(compileChanges([serialized])[0]!.after).toEqual(['Na závěr @Embed[Actor.a inline readaloud="Přečti mě." caption="Caption" label="Heading"]{Popisek}.']);
  expect(editorDraft(serialized).text).toEqual(['Na závěr ⟦1⟧.']);
});
it("hydrates existing options in old drafts, retains invalid values for correction and rejects unknown option metadata", () => {
  const value = ['@Embed[Actor.a caption="Old caption"]'];
  const change: Change = { unitId: "embed", baseRevision: "r1", before: value, after: value };
  const old = maskReviewParts(value); delete old.references[0]![0]!.options;
  expect(editorDraft({ ...change, editor: old }).references[0]![0]!.options).toEqual([{ key: "caption", value: "Old caption" }]);
  const draft = editorDraft({ ...change, editor: old });
  draft.references[0]![0]!.options![0]!.value = 'Broken ] caption';
  const broken = JSON.parse(JSON.stringify(changeWithDraft(change, draft)));
  expect(editorDraft(broken).references[0]![0]!.options![0]!.value).toBe('Broken ] caption');
  expect(() => compileChanges([broken])).toThrow();
  broken.editor.options[0].marker = '⟦2⟧';
  expect(() => compileChanges([broken])).toThrow();
  expect(validEditorDraft({ ...broken.editor, options: [{ marker: '⟦1⟧', key: 'uuid', value: 'Actor.evil' }] })).toBe(false);
});
