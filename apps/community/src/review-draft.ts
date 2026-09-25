import {
  maskReviewParts,
  restoreReviewParts,
  type ReviewTextDraft,
} from "../../../src/review/text-plan";
import type { Change } from "./shared";

export const referenceError =
  "Každá značka odkazu musí být v odstavci právě jednou. Pořadí můžete změnit. Popisek nesmí obsahovat příkazy, složené závorky ani nové řádky.";

/** Browser drafts retain incomplete cut/paste edits, never just the last valid text. */
export function validEditorDraft(value: unknown): value is ReviewTextDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as ReviewTextDraft;
  return (
    Array.isArray(d.text) &&
    d.text.every((t) => typeof t === "string") &&
    Array.isArray(d.references) &&
    d.references.length === d.text.length &&
    d.references.every(
      (refs) =>
        Array.isArray(refs) &&
        refs.every(
          (r) =>
            r &&
            [r.marker, r.command, r.label].every(
              (v) => typeof v === "string",
            ) &&
            typeof r.editable === "boolean",
        ),
    )
  );
}
export function editorDraft(
  change: Pick<Change, "after" | "editor">,
): ReviewTextDraft {
  return validEditorDraft(change.editor) &&
    change.editor.text.length === change.after.length
    ? change.editor
    : maskReviewParts(change.after);
}
export function referenceDraftError(draft: ReviewTextDraft): string {
  try {
    restoreReviewParts(draft);
    return "";
  } catch {
    return referenceError;
  }
}
export function changeWithDraft(
  change: Change,
  editor: ReviewTextDraft,
): Change {
  let after = change.after;
  try {
    after = restoreReviewParts(editor);
  } catch {
    /* The entire raw draft remains in editor. */
  }
  return { ...change, after, editor };
}
/** Only complete, restored text crosses the API boundary; raw drafts stay local. */
export function compileChanges(changes: readonly Change[]): Change[] {
  return changes.map(({ unitId, baseRevision, before, after, editor }) => {
    if (editor) {
      if (!validEditorDraft(editor)) throw new Error(referenceError);
      try {
        after = restoreReviewParts(editor);
      } catch {
        throw new Error(referenceError);
      }
    }
    return { unitId, baseRevision, before, after };
  });
}
