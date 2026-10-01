import { diagnosePortableText, syntaxExpressions } from "../bundles/format";
import { portableReviewText, type ReviewSnapshot, type ReviewRow } from "./service";
import { maskReviewParts, type ReviewTextDraft } from "./text-plan";

/** Only missing source commands, never changed destinations or markup. Expose
 * exact source tokens for deliberate placement, not an automatically appended link. */
export function referenceRepairDraft(snapshot: ReviewSnapshot, row: ReviewRow): ReviewTextDraft | null {
  const field = snapshot.fields.find(field => field.id === row.fieldId);
  if (!field || row.blocked !== "StructureChanged" || snapshot.warning) return null;
  const integrity = field.integrity ?? diagnosePortableText(field.source, portableReviewText(snapshot, field, field.translation), field.format);
  if (!integrity || integrity.commands.extra.length || integrity.commands.truncated || integrity.markup.length || integrity.markupTruncated || !integrity.commands.missing.length) return null;
  const remaining = new Map<string, number>();
  for (const command of syntaxExpressions(portableReviewText(snapshot, field, row.translation).join(""))) remaining.set(command, (remaining.get(command) ?? 0) + 1);
  const missing = maskReviewParts(row.source).references.flat().filter(ref => {
    const key = syntaxExpressions(ref.command)[0]!;
    if ((remaining.get(key) ?? 0) > 0) { remaining.set(key, remaining.get(key)! - 1); return false; }
    return true;
  });
  if (!missing.length) return null;
  const draft = maskReviewParts(row.translation), occupied = new Set(draft.references.flat().map(ref => ref.marker));
  let number = 0;
  for (const ref of missing) {
    let marker: string;
    do { marker = `⟦${++number}⟧`; } while (occupied.has(marker) || row.translation.join("\n").includes(marker));
    occupied.add(marker);
    draft.references[0]!.push({ marker, command: ref.command, label: ref.label, editable: false });
  }
  return draft;
}
