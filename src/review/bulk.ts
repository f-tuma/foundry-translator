import { loadReview, saveReviewRows, type ReviewChange, type ReviewSnapshot } from "./service";
import { replaceHits, type SearchHit, type SearchIndex } from "./search";

export interface BulkDocument { snapshot: ReviewSnapshot; changes: ReviewChange[]; hits: SearchHit[] }
export interface BulkPlan { id: string; label: string; documents: BulkDocument[]; occurrences: number }
/** A preview is immutable once shown. Editing a query, selection or replacement creates a new plan. */
export function planBulk(index: SearchIndex, replacements: readonly { hit: SearchHit; replacement: string }[], label: string): BulkPlan {
  if (!replacements.length || new Set(replacements.map(change => change.hit.id)).size !== replacements.length) throw new Error("Review.NoSelection");
  for (const { hit } of replacements) if (hit.blocked) throw new Error(`Review.${hit.blocked}`);
  const documents: BulkDocument[] = [];
  for (const snapshot of index.snapshots) {
    const changes = replacements.filter(change => change.hit.document.uuid === snapshot.entry.uuid);
    if (!changes.length) continue;
    const rows = [...new Set(changes.map(change => change.hit.rowId))].map(rowId => {
      const row = snapshot.rows.find(row => row.id === rowId)!;
      if (!row || row.blocked) throw new Error(`Review.${row?.blocked ?? "MissingField"}`);
      return { rowId, parts: replaceHits(row, changes.filter(change => change.hit.rowId === rowId)) };
    }).filter(change => JSON.stringify(change.parts) !== JSON.stringify(snapshot.rows.find(row => row.id === change.rowId)!.translation));
    if (rows.length) documents.push({ snapshot, changes: rows, hits: changes.map(change => change.hit) });
  }
  if (!documents.length) throw new Error("Review.NoChanges");
  return { id: crypto.randomUUID(), label, documents, occurrences: replacements.length };
}
export interface BulkResult { completed: string[]; failed: string | null; error: string | null }
export async function applyBulk(plan: BulkPlan, progress: (done: number, total: number) => void, cancelled: () => boolean): Promise<BulkResult> {
  // Preflight ALL documents before any mutation. Each commit also rechecks freshness.
  for (const { snapshot } of plan.documents) {
    if (cancelled()) throw new Error("Review.SearchCancelled");
    const fresh = await loadReview(snapshot.entry);
    if (fresh.guard.fingerprint !== snapshot.guard.fingerprint || fresh.sourceHash !== snapshot.sourceHash) throw new Error("Review.Conflict");
  }
  const result: BulkResult = { completed: [], failed: null, error: null };
  for (const [i, { snapshot, changes }] of plan.documents.entries()) {
    if (cancelled()) { result.error = "Review.BatchStopped"; break; }
    progress(i, plan.documents.length);
    try {
      await saveReviewRows(snapshot, changes, { id: plan.id, label: plan.label });
      result.completed.push(snapshot.entry.uuid);
    } catch (error) { result.failed = snapshot.entry.uuid; result.error = error instanceof Error ? error.message : String(error); break; }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  progress(result.completed.length, plan.documents.length); return result;
}
