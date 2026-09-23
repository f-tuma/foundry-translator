import { portableFields, type PortableDocument } from "../bundles/fields";
import type { BundleDocument } from "../bundles/format";
import { exportTranslationBundle, importTranslationBundle, planBundleImport, remapBundleReferences, type BundleImportPlan } from "../bundles/service";
import { readPath } from "../translation/system-html-fields";
import { sha256 } from "../translation/hash";
import { activeTranslations } from "../translation/active-translations";
import { readEditorial } from "./editorial";
import { labelFor } from "./labels";
import { PROJECT_FORMAT, parseEditorialProject, type EditorialProject, type PortableReviewMetadata } from "./project-format";
import { importReviewMetadata, loadReview, portableReviewBinding, reviewCatalog, saveReviewRows, type ReviewChange, type ReviewSnapshot } from "./service";
import { planReviewText } from "./text-plan";
import { importUiProject, loadUiCatalog, previewUiProject, type UiImport } from "./ui-catalog";

interface PortableRow { id: string; fieldId: string; source: string; parts: string[]; binding: string; label: string }
/** Derive row addresses from the installed original and the already validated bundle. */
async function incomingRows(entry: BundleDocument, language: string): Promise<PortableRow[]> {
  const source = await fromUuid(entry.sourceUuid) as PortableDocument, data = source.toObject(), rows: PortableRow[] = [];
  for (const field of portableFields(source, data)) {
    const original = readPath(data, field.path) as string; if (!original.trim()) continue;
    const path = [...field.path];
    if (typeof path[1] === "number") path[1] = String((data[path[0]!] as { _id?: string; id?: string }[])[path[1]]!._id ?? (data[path[0]!] as { id: string }[])[path[1]]!.id);
    if (entry.partial && path[0] === "pages" && !entry.processedPageIds.includes(String(path[1]))) continue;
    const fieldId = JSON.stringify(path), patch = entry.patches.find(patch => JSON.stringify(patch.path) === JSON.stringify(field.path));
    const plan = planReviewText(patch?.translation ?? original, field.format);
    const embedded = typeof field.path[1] === "number" ? (data[field.path[0]!] as { name?: string }[])[field.path[1]] : null;
    const label = [embedded?.name, labelFor((embedded ? field.path.slice(2) : field.path).join("."))].filter(Boolean).join(" · ");
    for (const unit of plan.units) {
      const id = await sha256(JSON.stringify([entry.sourceUuid, language, fieldId, unit.id]));
      rows.push({ id, fieldId, source: original, parts: unit.parts, label, binding: await sha256(JSON.stringify([id, field.format, original, unit.parts])) });
    }
  }
  return rows;
}
export async function exportEditorialProject(language: string, progress?: (message: string) => void): Promise<{ project: EditorialProject; skipped: string[] }> {
  const result = await exportTranslationBundle(language, progress), catalog = await reviewCatalog(language);
  const project: EditorialProject = { format: PROJECT_FORMAT, version: 1, bundle: result.bundle, reviews: [], ui: [] };
  const kept: BundleDocument[] = [];
  for (const item of result.bundle.documents) {
    try {
      const entry = catalog.find(entry => entry.sourceUuid === item.sourceUuid && entry.kind === item.kind);
      if (!entry) throw new Error("Review.IdentityChanged");
      const snapshot = await loadReview(entry), incoming = await incomingRows(item, language), rows: PortableReviewMetadata[] = [];
      if (snapshot.warning) throw new Error(`Review.${snapshot.warning}`);
      for (const portable of incoming) {
        const row = snapshot.rows.find(row => row.id === portable.id);
        if (!row || row.blocked || await portableReviewBinding(snapshot, row) !== portable.binding) throw new Error("Review.Conflict");
        if (!row.verified && !row.editorial && !row.protected) continue;
        rows.push({ rowId: row.id, binding: portable.binding,
          ...(row.protected ? { protected: true } : {}),
          ...(row.verified ? { proof: { at: row.verified.at, userName: row.verified.userName } } : {}),
          ...(row.editorial ? { editorial: { state: row.editorial.state, note: row.editorial.note, at: row.editorial.at, userName: row.editorial.userName, stale: row.editorial.fingerprint !== row.fingerprint } } : {}) });
      }
      project.reviews.push({ sourceUuid: item.sourceUuid, rows }); kept.push(item);
    } catch (error) { result.skipped.push(`${item.sourceName}: ${String(error)}`); }
  }
  project.bundle = { ...project.bundle, documents: kept };
  const ui = await loadUiCatalog();
  result.skipped.push(...ui.errors);
  for (const row of ui.rows.filter(row => row.override)) {
    if (row.blocked) { result.skipped.push(`${row.scope}: ${row.key}`); continue; }
    const item = { ...row.override! }; if (!row.verified) delete item.verified;
    project.ui.push(item);
  }
  return { project: parseEditorialProject(JSON.stringify(project)), skipped: result.skipped };
}
export interface ProjectDocumentPlan {
  sourceUuid: string; name: string; state: "new" | "update" | "blocked"; detail: string;
  changes: (ReviewChange & { before: string[]; label: string })[];
  metadata: PortableReviewMetadata[]; skippedMetadata: number; snapshot?: ReviewSnapshot;
  patches: BundleDocument["patches"];
  reviewText: Record<string, { label: string; parts: string[] }>;
}
export interface ProjectPlan { project: EditorialProject; bundle: BundleImportPlan; documents: ProjectDocumentPlan[]; ui: UiImport; notes: string }
export async function planEditorialProject(project: EditorialProject): Promise<ProjectPlan> {
  // Parse at the service boundary as well as at file selection.
  project = parseEditorialProject(JSON.stringify(project));
  const bundle = await planBundleImport(project.bundle), catalog = await reviewCatalog(project.bundle.targetLanguage), documents: ProjectDocumentPlan[] = [];
  const forward = new Map(catalog.filter(entry => !["Scene", "ActiveEffect"].includes(entry.kind)).map(entry => [entry.sourceUuid, entry.uuid]));
  for (const item of bundle.rows) {
    const result: ProjectDocumentPlan = { sourceUuid: item.entry.sourceUuid, name: item.entry.sourceName, state: "blocked", detail: item.detail, changes: [], metadata: [], skippedMetadata: 0, patches: item.entry.patches, reviewText: {} };
    documents.push(result);
    if (!["ready", "existing"].includes(item.state)) continue;
    try {
      const incoming = await incomingRows(item.entry, project.bundle.targetLanguage);
      const metadata = project.reviews.find(review => review.sourceUuid === item.entry.sourceUuid)?.rows ?? [];
      result.metadata = metadata.filter(meta => incoming.some(row => row.id === meta.rowId && row.binding === meta.binding));
      for (const meta of result.metadata) { const row = incoming.find(row => row.id === meta.rowId)!; result.reviewText[meta.rowId] = { label: row.label, parts: row.parts }; }
      result.skippedMetadata = metadata.length - result.metadata.length;
      if (item.state === "ready") { result.state = "new"; result.detail = ""; continue; }
      const entry = catalog.find(entry => entry.sourceUuid === item.entry.sourceUuid && entry.kind === item.entry.kind);
      if (!entry) throw new Error("Review.IdentityChanged");
      const snapshot = await loadReview(entry); result.snapshot = snapshot;
      if (snapshot.warning) throw new Error(`Review.${snapshot.warning}`);
      for (const row of incoming) {
        const current = snapshot.rows.find(current => current.id === row.id);
        if (!current || current.blocked) throw new Error("Review.ProjectCoverageConflict");
        const parts = remapBundleReferences(row.parts, forward, true);
        if (JSON.stringify(current.translation) !== JSON.stringify(parts)) result.changes.push({ rowId: row.id, parts, before: current.translation, label: `${snapshot.groups.find(group => group.id === current.group)?.name ?? ""} · ${labelFor(current.label)}` });
      }
      result.state = "update"; result.detail = "";
    } catch (error) { result.detail = String(error instanceof Error ? error.message : error); }
  }
  return { project, bundle, documents, ui: await previewUiProject(await loadUiCatalog(), project.ui), notes: JSON.stringify(readEditorial()) };
}
export interface ProjectSelection { documents: string[]; ui: string[]; glossary: boolean }
export const uiProjectId = (entry: { scope: string; key: string }) => `${entry.scope}:${entry.key}`;
function signature(plan: ProjectPlan, selection: ProjectSelection): string {
  return JSON.stringify({ documents: plan.documents.filter(doc => selection.documents.includes(doc.sourceUuid)).map(doc => ({ ...doc, snapshot: doc.snapshot ? { guard: doc.snapshot.guard, sourceHash: doc.snapshot.sourceHash } : null })),
    ui: plan.ui.entries.filter(entry => selection.ui.includes(uiProjectId(entry))).map(({ importedAt: _, ...entry }) => entry), store: selection.ui.length ? plan.ui.catalog.store : null,
    notes: selection.documents.length ? plan.notes : null, glossary: selection.glossary ? [plan.bundle.glossary, plan.bundle.glossaryConflicts] : null });
}
export async function importEditorialProject(plan: ProjectPlan, selection: ProjectSelection, progress?: (message: string) => void): Promise<{ documents: number; ui: number; glossary: number; issues: string[] }> {
  if (!game.user?.isGM) throw new Error("Review.GMOnly");
  if (activeTranslations.list().some(run => run.finishedAt === undefined && run.pausedAt === undefined)) throw new Error("Review.PauseFirst");
  const fresh = await planEditorialProject(plan.project);
  if (signature(fresh, selection) !== signature(plan, selection) || selection.documents.some(id => !fresh.documents.some(doc => doc.sourceUuid === id && doc.state !== "blocked")) || selection.ui.some(id => !fresh.ui.entries.some(entry => uiProjectId(entry) === id))) throw new Error("Review.Conflict");
  const result = { documents: 0, ui: 0, glossary: 0, issues: [] as string[] };
  let expectedNotes = fresh.notes;
  // Once writes begin, report partial completion. Re-running always creates a fresh preview.
  try {
    const selected = fresh.documents.filter(doc => selection.documents.includes(doc.sourceUuid));
    const newIds = selected.filter(doc => doc.state === "new").map(doc => doc.sourceUuid);
    if (newIds.length || selection.glossary) {
      const bundle = { ...fresh.project.bundle, documents: fresh.project.bundle.documents.filter(doc => newIds.includes(doc.sourceUuid)), glossary: selection.glossary ? fresh.project.bundle.glossary : [] };
      const imported = await importTranslationBundle(await planBundleImport(bundle), progress);
      result.glossary = imported.glossaryAdded;
      if (imported.issues.length || imported.imported !== newIds.length) { result.issues.push(...imported.issues, "Review.ProjectPartial"); return result; }
    }
    for (const doc of selected) {
      progress?.(doc.name);
      if (JSON.stringify(readEditorial()) !== expectedNotes) throw new Error("Review.Conflict");
      let snapshot = doc.snapshot;
      if (!snapshot) {
        const entry = (await reviewCatalog(fresh.project.bundle.targetLanguage)).find(entry => entry.sourceUuid === doc.sourceUuid);
        if (!entry) throw new Error("Review.TranslationMissing");
        snapshot = await loadReview(entry);
      } else if (doc.changes.length) snapshot = await saveReviewRows(snapshot, doc.changes, { label: "ProjectImport" });
      if (JSON.stringify(readEditorial()) !== expectedNotes) throw new Error("Review.Conflict");
      if (doc.metadata.length) await importReviewMetadata(snapshot, doc.metadata);
      expectedNotes = JSON.stringify(readEditorial());
      result.documents++;
    }
    const entries = fresh.ui.entries.filter(entry => selection.ui.includes(uiProjectId(entry)));
    if (entries.length) { await importUiProject({ ...fresh.ui, entries }); result.ui = entries.length; }
  } catch (error) { result.issues.push(error instanceof Error ? error.message : String(error), "Review.ProjectPartial"); }
  return result;
}
