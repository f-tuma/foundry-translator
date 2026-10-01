import type { GlossaryEntry } from "../glossary/types";
import { maskReviewParts, restoreReviewParts } from "../review/text-plan";

export function correctionParts(parts: string[], text: string[], labels: { marker: string; label: string }[]): string[] {
  if (parts.length !== text.length || text.some(s => !s.trim()) || text.join("").length > 60000) throw new Error("Review.EmptyText");
  const draft = maskReviewParts(parts), references = draft.references.flat(), seen = new Set<string>();
  for (const change of labels) {
    const reference = references.find(ref => ref.marker === change.marker);
    if (!reference?.editable || seen.has(change.marker)) throw new Error("Review.ReferenceChanged");
    seen.add(change.marker); reference.label = change.label;
  }
  const known = new Set(references.map(ref => ref.marker)), literal = new Set(parts.join("").match(/⟦+[^⟦⟧]*⟧+/gu) ?? []);
  for (const marker of text.join("").match(/⟦+[^⟦⟧]*⟧+/gu) ?? []) if (!known.has(marker) && !literal.has(marker)) throw new Error("Review.ReferenceChanged");
  return restoreReviewParts({ ...draft, text });
}
export function polishProse(parts: string[]): string {
  const masked = maskReviewParts(parts);
  return masked.text.join("") + " " + masked.references.flat().map(ref => ref.label).join(" ");
}
/** Terminology and mechanics checks accompany structural checks, not replace them. */
export function correctionWarnings(beforeParts: string[], afterParts: string[], glossary: GlossaryEntry[]): string[] {
  const before = polishProse(beforeParts), after = polishProse(afterParts);
  for (const term of glossary.filter(g => g.enabled !== false && g.mode !== "inflect")) {
    const escaped = term.replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const occurrences = (s: string) => [...s.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu"))].length;
    if (occurrences(before) > occurrences(after)) throw new Error(`EXACT glossary term removed or changed: ${term.replacement}`);
  }
  const numbers = (s: string) => [...s.matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)].map(m => m[0]).sort();
  const warnings: string[] = [];
  if (JSON.stringify(numbers(before)) !== JSON.stringify(numbers(after))) warnings.push("Numbers changed. Compare quantities, dates and rules with the English source.");
  if (after.length > before.length * 1.7 + 60 || after.length < before.length * .5 - 30) warnings.push("Substantial length change: check for added or omitted meaning.");
  return warnings;
}
