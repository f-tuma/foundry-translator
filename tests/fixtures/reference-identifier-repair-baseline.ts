import { assertPortableText, diagnosePortableText, syntaxExpressions } from "../../src/bundles/format";
import { FOUNDRY_EXPRESSION } from "../../src/translation/foundry-syntax";
import { portableReviewText, type ReviewChange, type ReviewSnapshot } from "../../src/review/service";
import { planReviewText } from "../../src/review/text-plan";

export interface ReferenceIdentifierRepairDraft {
  fieldId: string;
  changes: ReviewChange[];
  identifiers: { rowId: string; before: string; after: string }[];
  value: string;
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const available = [...right], missing: string[] = [];
  for (const value of left) {
    const index = available.indexOf(value);
    if (index === -1) missing.push(value);
    else available.splice(index, 1);
  }
  return missing;
}

// Bare resolver IDs only: spaces are legitimate (e.g. Lightly Obscured).
// Labels, option syntax, nested expressions and control characters are excluded.
function bareReference(command: string): boolean {
  const id = /^&(?:amp;)?[Rr]eference\[([^\[\]{}"'=|\u0000-\u001f]+)\]$/u.exec(command)?.[1];
  return !!id?.trim() && !/[@&]/u.test(id);
}

/** Restore only exact source Reference IDs at unambiguous existing occurrences.
 * No caller text/commands, semantic guessing, partial field writes or UUID repair.
 * The complete repaired field must pass the ordinary portable-text validator. */
export function referenceIdentifierRepairDraft(snapshot: ReviewSnapshot, fieldId: string): ReferenceIdentifierRepairDraft | null {
  try { return buildDraft(snapshot, fieldId); }
  catch { return null; } // Malformed source/target is diagnostic data, never authority to write.
}

function buildDraft(snapshot: ReviewSnapshot, fieldId: string): ReferenceIdentifierRepairDraft | null {
  const field = snapshot.fields.find(item => item.id === fieldId);
  if (!field || snapshot.warning || !field.translation.trim()) return null;
  const integrity = diagnosePortableText(field.source, portableReviewText(snapshot, field, field.translation), field.format);
  if (!integrity || integrity.commands.truncated || integrity.markupTruncated || integrity.markup.length) return null;
  const sourcePlan = planReviewText(field.source, field.format), targetPlan = planReviewText(field.translation, field.format);
  const rows = snapshot.rows.filter(row => row.fieldId === fieldId);
  if (rows.length !== sourcePlan.units.length || targetPlan.units.length !== sourcePlan.units.length ||
    rows.some(row => row.blocked !== null && row.blocked !== "StructureChanged") ||
    new Set(rows.map(row => row.unitId)).size !== rows.length || new Set(rows.map(row => row.id)).size !== rows.length) return null;

  const draft: ReferenceIdentifierRepairDraft = { fieldId, changes: [], identifiers: [], value: field.translation };
  for (const unit of sourcePlan.units) {
    const row = rows.find(item => item.unitId === unit.id), target = targetPlan.units.find(item => item.id === unit.id);
    if (!row || !target || row.format !== field.format || unit.parts.length !== target.parts.length ||
      JSON.stringify(row.source) !== JSON.stringify(unit.parts) || JSON.stringify(row.translation) !== JSON.stringify(target.parts)) return null;
    const expected = syntaxExpressions(unit.parts.join(""));
    const actual = syntaxExpressions(portableReviewText(snapshot, field, target.parts).join(""));
    const missing = difference(expected, actual), extra = difference(actual, expected);
    if (!missing.length && !extra.length) continue;
    if (missing.length !== 1 || extra.length !== 1) return null;
    const originals = unit.parts.flatMap(part => [...part.matchAll(FOUNDRY_EXPRESSION)].map(match => match[0]))
      .filter(command => syntaxExpressions(command)[0] === missing[0]);
    const occurrences = target.parts.flatMap((part, partIndex) => [...part.matchAll(FOUNDRY_EXPRESSION)]
      .filter(match => syntaxExpressions(portableReviewText(snapshot, field, match[0]))[0] === extra[0])
      .map(match => ({ command: match[0], index: match.index, partIndex })));
    if (!originals.length || !originals.every(command => bareReference(command) && command === originals[0]) ||
      occurrences.length !== 1 || !bareReference(occurrences[0]!.command)) return null;
    const original = originals[0]!, occurrence = occurrences[0]!, parts = [...target.parts];
    const part = parts[occurrence.partIndex]!;
    parts[occurrence.partIndex] = part.slice(0, occurrence.index) + original + part.slice(occurrence.index + occurrence.command.length);
    if (JSON.stringify(syntaxExpressions(portableReviewText(snapshot, field, parts).join(""))) !== JSON.stringify(expected)) return null;
    draft.changes.push({ rowId: row.id, parts });
    draft.identifiers.push({ rowId: row.id, before: occurrence.command, after: original });
    draft.value = targetPlan.replace(unit.id, parts);
  }
  if (!draft.changes.length) return null;
  assertPortableText(field.source, portableReviewText(snapshot, field, draft.value), field.format);
  return draft;
}
