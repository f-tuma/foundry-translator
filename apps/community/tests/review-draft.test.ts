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
