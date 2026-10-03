import {
  maskReviewParts,
  restoreReviewParts,
  type ReviewTextDraft,
} from "../../../src/review/text-plan";
import type { Change } from "./shared";

interface EditorOption { marker: string; key: "readaloud" | "caption" | "label"; value: string }
export interface EditorDraft extends ReviewTextDraft {
  version?: 1;
  referenceScope?: "row";
  options?: EditorOption[];
}
const optionKeys = new Set(["readaloud", "caption", "label"]);
function validOption(value: unknown): value is { key: EditorOption["key"]; value: string } {
  if (!value || typeof value !== "object") return false;
  const option = value as EditorOption;
  return optionKeys.has(option.key) && typeof option.value === "string";
}
function storedEditorDraft(draft: ReviewTextDraft): EditorDraft {
  return { ...draft, version: 1, referenceScope: "row", options: draft.references.flatMap(refs => refs.flatMap(ref =>
    (ref.options ?? []).map(option => ({ marker: ref.marker, ...option })))) };
}

export const referenceError =
  "Každá značka odkazu musí být v odstavci právě jednou. Pořadí můžete změnit. Popisek nesmí obsahovat příkazy, složené závorky ani nové řádky. Text vloženého náhledu musí být prostý text bez HTML, příkazů, uvozovek, hranatých či složených závorek, znaku = a nových řádků.";

/** Browser drafts retain incomplete cut/paste edits, never just the last valid text. */
export function validEditorDraft(value: unknown): value is EditorDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as EditorDraft;
  return (
    (d.version === undefined || d.version === 1) &&
    (d.referenceScope === undefined || d.referenceScope === "row") &&
    (d.options === undefined || (d.referenceScope === "row" && Array.isArray(d.options) && d.options.every(option => validOption(option) && typeof option.marker === "string"))) &&
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
            typeof r.editable === "boolean" && (r.options === undefined || (Array.isArray(r.options) && r.options.every(validOption))),
        ),
    )
  );
}
export function editorDraft(
  change: Pick<Change, "after" | "editor">,
): EditorDraft {
  if (!validEditorDraft(change.editor) || change.editor.text.length !== change.after.length) return maskReviewParts(change.after);
  const saved = change.editor;
  // Old drafts retain command options but predate their editable fields. Hydrate
  // only from their original command, keeping raw prose and brace labels intact.
  const refs = saved.references.map(parts => parts.map(reference => ({ ...reference,
    options: (reference.options ?? maskReviewParts([reference.command]).references[0]?.[0]?.options)?.map(option => ({ ...option })),
  })));
  if (saved.options === undefined) return { ...saved, references: refs };
  const references = new Map(refs.flat().map(reference => [reference.marker, reference]));
  for (const option of saved.options) {
    const target = references.get(option.marker)?.options?.find(value => value.key === option.key);
    // Invalid metadata remains present and submission validation rejects it; do
    // not discard raw text just because a pasted option is temporarily invalid.
    if (target) target.value = option.value;
  }
  return { ...saved, references: refs };
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
  return { ...change, after, editor: storedEditorDraft(editor) };
}
/** Only complete, restored text crosses the API boundary; raw drafts stay local. */
export function compileChanges(changes: readonly Change[]): Change[] {
  return changes.map(({ unitId, baseRevision, before, after, editor }) => {
    if (editor) {
      if (!validEditorDraft(editor)) throw new Error(referenceError);
      try {
        const refs = new Map(editor.references.flat().map(reference => [reference.marker, reference]));
        const seen = new Set<string>();
        for (const option of editor.options ?? []) {
          const identity = JSON.stringify([option.marker, option.key]);
          if (!refs.get(option.marker)?.options?.some(value => value.key === option.key) || seen.has(identity)) throw new Error(referenceError);
          seen.add(identity);
        }
        after = restoreReviewParts(editorDraft({ after, editor }));
      } catch {
        throw new Error(referenceError);
      }
    }
    return { unitId, baseRevision, before, after };
  });
}
