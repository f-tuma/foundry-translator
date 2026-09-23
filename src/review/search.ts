import type { FieldFormat } from "../bundles/fields";
import { maskReviewReferences, restoreReviewReferences } from "./text-plan";
import { loadReview, reviewCatalog, type ReviewSnapshot, type ReviewDocument, type ReviewRow } from "./service";

export const normalizeSearch = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().normalize("NFC");
interface Word { value: string; start: number; end: number }
export interface TextMatch { start: number; end: number; text: string; score: number }
const words = (text: string): Word[] => [...text.matchAll(/[\p{L}\p{N}\p{M}]+(?:['’’-][\p{L}\p{N}\p{M}]+)*/gu)]
  .map(match => ({ value: normalizeSearch(match[0]), start: match.index!, end: match.index! + match[0].length }));
function distance(a: string, b: string): number {
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i]; rows.push(row);
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1]! + 1, rows[i - 1]![j]! + 1, rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j]!, rows[i - 2]![j - 2]! + 1);
    }
  }
  return rows[a.length]![b.length]!;
}
/** Word boundaries, accent/case folding and conservative per-word similarity.
 * Scores describe spelling similarity, never semantic or grammatical certainty. */
export function findTextMatches(text: string, query: string, fuzzy = false): TextMatch[] {
  const needle = words(query.trim()), haystack = words(text), result: TextMatch[] = [];
  if (!needle.length || needle.length > 12 || query.length > 160) return result;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    const window = haystack.slice(i, i + needle.length);
    if (window.some((word, j) => j > 0 && !/^[\s’'\-]*$/u.test(text.slice(window[j - 1]!.end, word.start)))) continue;
    let total = 0, valid = true;
    for (let j = 0; j < needle.length; j++) {
      const a = needle[j]!.value, b = window[j]!.value;
      if (a === b) { total += 1; continue; }
      if (!fuzzy || a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 3 || a.length > 80 || b.length > 80) { valid = false; break; }
      const d = distance(a, b), score = 1 - d / Math.max(a.length, b.length);
      let prefix = 0; while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
      const inflection = prefix >= 4 && prefix / Math.min(a.length, b.length) >= .65;
      if (d > 3 || score < (inflection ? .60 : .68)) { valid = false; break; }
      total += score;
    }
    if (valid) { const start = window[0]!.start, end = window.at(-1)!.end; result.push({ start, end, text: text.slice(start, end), score: total / needle.length }); i += needle.length - 1; }
  }
  return result;
}

export interface SearchSegment { part: number; reference: number | null; start: number; end: number; text: string }
/** Exclude executable references, Markdown destinations/code and HTML embedded in text attributes. */
export function searchableSegments(parts: readonly string[], format: FieldFormat): SearchSegment[] {
  const result: SearchSegment[] = [];
  parts.forEach((part, index) => {
    const masked = maskReviewReferences(part);
    const protect = /⟦+[^⟦⟧]*⟧+|```[\s\S]*?```|`[^`]*`|<[^>]*>|!?\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s<>]+/gu;
    let start = 0;
    const add = (from: number, end: number) => { if (end > from) result.push({ part: index, reference: null, start: from, end, text: masked.text.slice(from, end) }); };
    for (const match of masked.text.matchAll(protect)) {
      add(start, match.index!);
      if (format === "markdown" && /^!?\[/u.test(match[0])) {
        const offset = match[0].startsWith("!") ? 2 : 1;
        add(match.index! + offset, match.index! + match[0].indexOf("]"));
      }
      start = match.index! + match[0].length;
    }
    add(start, masked.text.length);
    masked.references.forEach((ref, reference) => { if (ref.editable && ref.label) result.push({ part: index, reference, start: 0, end: ref.label.length, text: ref.label }); });
  });
  return result;
}
export interface SearchHit {
  id: string; document: ReviewDocument; rowId: string; group: string; groupName: string; label: string;
  source: string; translation: string; variant: string; score: number; verified: boolean; blocked: string | null;
  segment: SearchSegment; start: number; end: number;
}
export interface SearchIndex { snapshots: ReviewSnapshot[]; skipped: { entry: ReviewDocument; reason: string }[] }
export async function buildSearchIndex(language: string, progress: (done: number, total: number) => void, cancelled: () => boolean): Promise<SearchIndex> {
  const catalog = await reviewCatalog(language), result: SearchIndex = { snapshots: [], skipped: [] };
  for (const [index, entry] of catalog.entries()) {
    if (cancelled()) throw new Error("Review.SearchCancelled");
    progress(index, catalog.length);
    try { result.snapshots.push(await loadReview(entry, catalog)); }
    catch (error) { result.skipped.push({ entry, reason: error instanceof Error ? error.message : String(error) }); }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  progress(catalog.length, catalog.length); return result;
}
export function searchReviews(index: SearchIndex, query: string, fuzzy: boolean, side: "translation" | "source" = "translation"): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const snapshot of index.snapshots) for (const row of snapshot.rows) {
    // Incomplete pages contain English placeholders, not translations.
    if (row.blocked === "Untranslated" || row.blocked === "MissingField") continue;
    const rowHitsStart = hits.length;
    for (const segment of searchableSegments(side === "source" ? row.source : row.translation, row.format)) {
      for (const match of findTextMatches(segment.text, query, fuzzy)) hits.push({
        id: `${snapshot.entry.uuid}:${row.id}:${segment.part}:${segment.reference}:${segment.start + match.start}:${side}`,
        document: snapshot.entry, rowId: row.id, group: row.group, groupName: snapshot.groups.find(group => group.id === row.group)!.name,
        label: row.label, source: displayParts(row.source), translation: displayParts(row.translation), variant: match.text,
        score: match.score, verified: !!row.verified, blocked: row.blocked, segment, start: match.start, end: match.end,
      });
    }
    // A name can cross inline formatting or a link boundary. Surface it for manual
    // review without guessing how a replacement should be distributed across nodes.
    if ((side === "source" ? row.source : row.translation).length > 1) {
      const text = displayParts(side === "source" ? row.source : row.translation);
      const seen = new Map<string, number>();
      for (const hit of hits.slice(rowHitsStart)) seen.set(hit.variant, (seen.get(hit.variant) ?? 0) + 1);
      for (const match of findTextMatches(text, query, fuzzy)) {
        if ((seen.get(match.text) ?? 0) > 0) { seen.set(match.text, seen.get(match.text)! - 1); continue; }
        hits.push({ id: `${snapshot.entry.uuid}:${row.id}:split:${match.start}:${side}`, document: snapshot.entry, rowId: row.id, group: row.group,
          groupName: snapshot.groups.find(group => group.id === row.group)!.name, label: row.label, source: displayParts(row.source), translation: displayParts(row.translation),
          variant: match.text, score: match.score, verified: !!row.verified, blocked: row.blocked ?? "SplitFormatting",
          segment: { part: -1, reference: null, start: 0, end: text.length, text }, start: match.start, end: match.end });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.variant.localeCompare(b.variant) || a.document.name.localeCompare(b.document.name));
}
/** Yield between small row batches so search/cancel stays responsive on large worlds. */
export async function searchReviewsAsync(index: SearchIndex, query: string, fuzzy: boolean, side: "source" | "translation", cancelled: () => boolean): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  for (const snapshot of index.snapshots) for (let start = 0; start < snapshot.rows.length; start += 80) {
    if (cancelled()) throw new Error("Review.SearchCancelled");
    hits.push(...searchReviews({ snapshots: [{ ...snapshot, rows: snapshot.rows.slice(start, start + 80) }], skipped: [] }, query, fuzzy, side));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return hits.sort((a, b) => b.score - a.score || a.variant.localeCompare(b.variant) || a.document.name.localeCompare(b.document.name));
}

export function displayParts(parts: readonly string[]): string {
  return parts.map(part => { const masked = maskReviewReferences(part); return masked.references.reduce((text, ref) => text.replace(ref.marker, ref.label || ref.marker), masked.text); }).join(" ");
}
export function replaceHits(row: ReviewRow, changes: readonly { hit: SearchHit; replacement: string }[]): string[] {
  const masked = row.translation.map(maskReviewReferences);
  const bySegment = new Map<string, { start: number; end: number; before: string; value: string }[]>();
  for (const { hit, replacement } of changes) {
    if (hit.rowId !== row.id || !replacement.trim()) throw new Error("Review.EmptyText");
    const s = hit.segment, key = `${s.part}:${s.reference ?? "text"}`;
    const replacements = bySegment.get(key) ?? [];
    replacements.push({ start: s.start + hit.start, end: s.start + hit.end, before: hit.variant, value: replacement }); bySegment.set(key, replacements);
  }
  for (const [key, changes] of bySegment) {
    const [part, reference] = key.split(":"), current = masked[Number(part)]!;
    let text = reference === "text" ? current.text : current.references[Number(reference)]!.label;
    let boundary = text.length;
    for (const change of changes.sort((a, b) => b.start - a.start)) {
      if (change.end > boundary || text.slice(change.start, change.end) !== change.before) throw new Error("Review.Conflict");
      text = text.slice(0, change.start) + change.value + text.slice(change.end); boundary = change.start;
    }
    if (reference === "text") current.text = text; else current.references[Number(reference)]!.label = text;
  }
  return masked.map(part => restoreReviewReferences(part.text, part.references));
}
