import { diagnosePortableText, syntaxExpressions } from "../bundles/format";
import { portableReviewText, type ReviewSnapshot, type ReviewRow } from "./service";
import { maskReviewParts, type ReviewTextDraft } from "./text-plan";

export interface ReferenceRepairDraft extends ReviewTextDraft {
  targetChanges: { marker: string; before: string; after: string }[];
}
const uuidTarget = (command: string) => /^@UUID\[([^\]\s]+)\]$/iu.exec(command)?.[1];
/** A missing immediate child, never another parent, sibling or changed option. */
function collapsedChild(parent: string, child: string): boolean {
  return child.startsWith(`${parent}.`) && /^(?:Item|JournalEntryPage)\.[^.#[\]\s]+(?:#[^\]\s]+)?$/u.test(child.slice(parent.length + 1));
}

/** Source-derived repairs only: missing commands and uniquely identified child
 * links collapsed to their parent. Never guess among siblings or repair markup.
 * The proposed paragraph must still make the entire field pass validation. */
export function referenceRepairDraft(snapshot: ReviewSnapshot, row: ReviewRow): ReferenceRepairDraft | null {
  try { return buildReferenceRepairDraft(snapshot, row); }
  catch { return null; } // Malformed/nested source syntax is diagnostic data, never a repair.
}

function buildReferenceRepairDraft(snapshot: ReviewSnapshot, row: ReviewRow): ReferenceRepairDraft | null {
  const field = snapshot.fields.find(field => field.id === row.fieldId);
  if (!field || row.blocked !== "StructureChanged" || snapshot.warning) return null;
  const integrity = field.integrity ?? diagnosePortableText(field.source, portableReviewText(snapshot, field, field.translation), field.format);
  if (!integrity || integrity.commands.truncated || integrity.markup.length || integrity.markupTruncated || !integrity.commands.missing.length) return null;
  const draft: ReferenceRepairDraft = { ...maskReviewParts(row.translation), targetChanges: [] };
  const sourceRefs = maskReviewParts(row.source).references.flat();
  for (const extra of integrity.commands.extra) {
    const parent = uuidTarget(extra.command);
    if (!parent || extra.count !== 1) return null;
    const candidates = integrity.commands.missing.filter(missing => {
      const child = uuidTarget(missing.command);
      return child && collapsedChild(parent, child);
    });
    if (candidates.length !== 1 || candidates[0]!.count !== 1) return null;
    const missing = candidates[0]!;
    const source = sourceRefs.filter(ref => syntaxExpressions(ref.command)[0] === syntaxExpressions(missing.command)[0]);
    const current = draft.references.flat().filter(ref => syntaxExpressions(portableReviewText(snapshot, field, ref.command))[0] === syntaxExpressions(extra.command)[0]);
    // Single-row writes cannot guess where to fix a reference in another paragraph.
    if (source.length !== 1 || current.length !== 1) return null;
    const ref = current[0]!, before = ref.command;
    const mappedParent = uuidTarget(before.replace(/\{[^}\r\n]*\}$/u, ""));
    if (!mappedParent || mappedParent.startsWith(".")) return null;
    // Keep the exact existing parent copy; only add the authoritative child suffix.
    // No new copy is selected, even when several translations of that parent exist.
    ref.command = `@UUID[${mappedParent}${uuidTarget(missing.command)!.slice(parent.length)}]`;
    if (ref.label) ref.command += `{${ref.label}}`;
    draft.targetChanges.push({ marker: ref.marker, before, after: ref.command });
  }
  const remaining = new Map<string, number>();
  for (const command of syntaxExpressions(portableReviewText(snapshot, field, draft.references.flat().map(ref => ref.command)).join(""))) remaining.set(command, (remaining.get(command) ?? 0) + 1);
  const missing = sourceRefs.filter(ref => {
    const key = syntaxExpressions(ref.command)[0]!;
    if ((remaining.get(key) ?? 0) > 0) { remaining.set(key, remaining.get(key)! - 1); return false; }
    return true;
  });
  if (!missing.length && !draft.targetChanges.length) return null;
  const occupied = new Set(draft.references.flat().map(ref => ref.marker));
  let number = 0;
  for (const ref of missing) {
    let marker: string;
    do { marker = `⟦${++number}⟧`; } while (occupied.has(marker) || row.translation.join("\n").includes(marker));
    occupied.add(marker);
    draft.references[0]!.push({ marker, command: ref.command, label: ref.label, editable: false });
  }
  return draft;
}
