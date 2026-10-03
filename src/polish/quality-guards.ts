import type { GlossaryEntry } from "../glossary/types";
import { maskReviewParts, restoreReviewParts, type ReviewTextDraft } from "../review/text-plan";
import { applyEmbedTextOptions, editableEmbedTextOptions, embedOptionChanges, embedTextOptionSignature, type EmbedTextOptionKey } from "../review/embed-text-options";

export interface CorrectionEmbedOption { marker: string; key: EmbedTextOptionKey; value: string }
export interface CorrectionOptionChange { marker: string; key: EmbedTextOptionKey; before: string; after: string }
function applyCorrectionOptions(draft: ReviewTextDraft, options: readonly CorrectionEmbedOption[]): CorrectionOptionChange[] {
  const changes: CorrectionOptionChange[] = [], seen = new Set<string>();
  for (const option of options) {
    const identity = JSON.stringify([option.marker, option.key]), reference = draft.references.flat().find(ref => ref.marker === option.marker);
    const baseline = reference?.options?.find(slot => slot.key === option.key);
    if (!reference || !baseline || seen.has(identity)) throw new Error("Review.ReferenceChanged");
    seen.add(identity);
    applyEmbedTextOptions(reference.command, [{ key: option.key, value: option.value }]);
    if (baseline.value !== option.value) changes.push({ marker: option.marker, key: option.key, before: baseline.value, after: option.value });
    baseline.value = option.value;
  }
  return changes;
}
/** Derive preview changes from fresh immutable commands, not caller ranges. */
export function correctionOptionChanges(parts: string[], options: readonly CorrectionEmbedOption[]): CorrectionOptionChange[] {
  return applyCorrectionOptions(maskReviewParts(parts), options);
}

export function correctionParts(parts: string[], text: string[], labels: { marker: string; label: string }[], repairDraft?: ReviewTextDraft, options: readonly CorrectionEmbedOption[] = []): string[] {
  if (parts.length !== text.length || text.some(s => !s.trim()) || text.join("").length > 60000) throw new Error("Review.EmptyText");
  const draft = repairDraft ? structuredClone(repairDraft) : maskReviewParts(parts), references = draft.references.flat(), seen = new Set<string>();
  for (const change of labels) {
    const reference = references.find(ref => ref.marker === change.marker);
    if (!reference?.editable || seen.has(change.marker)) throw new Error("Review.ReferenceChanged");
    seen.add(change.marker); reference.label = change.label;
  }
  const known = new Set(references.map(ref => ref.marker)), literal = new Set(parts.join("").match(/⟦+[^⟦⟧]*⟧+/gu) ?? []);
  for (const marker of text.join("").match(/⟦+[^⟦⟧]*⟧+/gu) ?? []) if (!known.has(marker) && !literal.has(marker)) throw new Error("Review.ReferenceChanged");
  applyCorrectionOptions(draft, options);
  return restoreReviewParts({ ...draft, text });
}
export function polishProse(parts: string[]): string {
  const masked = maskReviewParts(parts);
  let text = masked.text.join("");
  for (const ref of masked.references.flat()) text = text.replace(ref.marker, "");
  return text + " " + masked.references.flat().flatMap(ref => [ref.label, ...(ref.options ?? []).map(option => option.value)]).join(" ");
}
const numbersIn = (value: string) => [...value.matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)].map(m => m[0]).sort();
export function proseNumbers(parts: string[]): string[] {
  return numbersIn(polishProse(parts));
}
export function embedOptionNumbersChanged(before: readonly string[], after: readonly string[]): boolean {
  return embedOptionChanges(before, after).some(change => JSON.stringify(numbersIn(change.before)) !== JSON.stringify(numbersIn(change.after)));
}
/** Opt-in repair can only restore the entire source's numerical multiset. It
 * cannot introduce a new quantity, remove a correct quantity or alter commands. */
export function sourceNumberRepair(source: string[], before: string[], after: string[], toSource: (parts: string[]) => string[] = parts => parts) {
  const numbers = { source: proseNumbers(source), before: proseNumbers(before), after: proseNumbers(after) };
  let optionsAllowed = true, optionMismatch = false;
  try {
    const sourceReferences = maskReviewParts(source).references.flat();
    for (const change of embedOptionChanges(before, after)) {
      if (JSON.stringify(numbersIn(change.before)) === JSON.stringify(numbersIn(change.after))) continue;
      const canonical = toSource([change.command]);
      if (canonical.length !== 1 || typeof canonical[0] !== "string") { optionsAllowed = false; break; }
      const signature = embedTextOptionSignature(canonical[0]);
      const candidates = sourceReferences.filter(ref => signature !== null && embedTextOptionSignature(ref.command) === signature);
      // Duplicate identical source configs are equivalent. Different source
      // payloads sharing a destination/config cannot be paired by their order.
      const configs = new Set(candidates.map(ref => ref.command.slice(0, ref.command.indexOf("]") + 1)));
      const value = candidates.length && editableEmbedTextOptions(candidates[0]!.command).find(option => option.key === change.key)?.value;
      if (configs.size !== 1 || typeof value !== "string" || JSON.stringify(numbersIn(value)) !== JSON.stringify(numbersIn(change.after))) {
        optionsAllowed = false; break;
      }
      optionMismatch ||= JSON.stringify(numbersIn(value)) !== JSON.stringify(numbersIn(change.before));
    }
  } catch { optionsAllowed = false; }
  return { ...numbers, allowed: (JSON.stringify(numbers.before) !== JSON.stringify(numbers.source) || optionMismatch) &&
    JSON.stringify(numbers.after) === JSON.stringify(numbers.source) && optionsAllowed };
}
/** Terminology and mechanics checks accompany structural checks, not replace them. */
export function correctionWarnings(beforeParts: string[], afterParts: string[], glossary: GlossaryEntry[]): string[] {
  const before = polishProse(beforeParts), after = polishProse(afterParts);
  for (const term of glossary.filter(g => g.enabled !== false && g.mode !== "inflect")) {
    const escaped = term.replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const occurrences = (s: string) => [...s.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu"))].length;
    if (occurrences(before) > occurrences(after)) throw new Error(`EXACT glossary term removed or changed: ${term.replacement}`);
  }
  const warnings: string[] = [];
  if (JSON.stringify(proseNumbers(beforeParts)) !== JSON.stringify(proseNumbers(afterParts)) || embedOptionNumbersChanged(beforeParts, afterParts)) warnings.push("Numbers changed. Compare quantities, dates and rules with the English source.");
  if (after.length > before.length * 1.7 + 60 || after.length < before.length * .5 - 30) warnings.push("Substantial length change: check for added or omitted meaning.");
  return warnings;
}
