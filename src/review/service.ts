import { hasManualOutputEdits } from "../translation/output-hash";
import { isEditorProtected, readEditorProtection, recordEditorProtection } from "../translation/editor-protection";
import { MODULE_ID } from "../constants";
import { portableFields, type BundleDocumentKind, type FieldFormat, type PortableDocument } from "../bundles/fields";
import { assertPortableText } from "../bundles/format";
import { remapBundleReferences } from "../bundles/service";
import { ACTOR_TRANSLATIONS_PACK_ID } from "../translation/compendium-actor-translation-repository";
import { ITEM_TRANSLATIONS_PACK_ID } from "../translation/compendium-item-translation-repository";
import { TRANSLATIONS_PACK_ID } from "../translation/compendium-translation-repository";
import { actorSourceHash, readActorTranslationFlag, type ActorData } from "../translation/actor";
import { itemSourceHash, readItemTranslationFlag, type ItemData } from "../translation/item";
import { journalSourceHash, readJournalTranslationFlag, type JournalData } from "../translation/journal";
import { DISPLAY_TEXT_PACK, displaySourceHash, escapeDisplayText, readDisplayTextFlag, readDisplayTranslation } from "../translation/display-text";
import { readPath, writePath, type HtmlFieldPath } from "../translation/system-html-fields";
import { captureTranslationWriteGuard, type TranslationWriteGuard } from "../translation/write-guard";
import { activeTranslations } from "../translation/active-translations";
import { sha256 } from "../translation/hash";
import { planReviewText } from "./text-plan";

const SPECS = [
  { kind: "JournalEntry", pack: TRANSLATIONS_PACK_ID, key: "translation", read: readJournalTranslationFlag },
  { kind: "Actor", pack: ACTOR_TRANSLATIONS_PACK_ID, key: "actorTranslation", read: readActorTranslationFlag },
  { kind: "Item", pack: ITEM_TRANSLATIONS_PACK_ID, key: "itemTranslation", read: readItemTranslationFlag },
  { kind: "Scene", pack: DISPLAY_TEXT_PACK, key: "displayTranslation", read: readDisplayTextFlag },
] as const;
export interface ReviewDocument {
  id: string; pack: string; uuid: string; name: string; kind: BundleDocumentKind; sourceUuid: string; language: string;
}
export interface ReviewRecord { fingerprint: string; at: string; userId: string; userName: string }
export interface ReviewRow {
  id: string; fieldId: string; unitId: string; group: string; label: string; format: FieldFormat;
  source: string[]; translation: string[]; heading: boolean; fingerprint: string;
  verified: ReviewRecord | null; blocked: string | null; protected?: boolean;
}
export interface ReviewField {
  id: string; source: string; translation: string; format: FieldFormat; targetPath: HtmlFieldPath; displayPlain: boolean;
}
export interface ReviewSnapshot {
  entry: ReviewDocument; sourceName: string; rows: ReviewRow[]; fields: ReviewField[];
  groups: { id: string; name: string }[]; guard: TranslationWriteGuard; sourceHash: string;
  warning: string | null; partial: boolean; protection?: "tracked" | "untracked" | null; reverse: Map<string, string>;
}

function fail(key: string): never { throw new Error(`Review.${key}`); }
function gmOnly(): void { if (!game.user?.isGM) fail("GMOnly"); }
const displayKind = (kind: BundleDocumentKind) => kind === "Scene" || kind === "ActiveEffect";

export async function reviewCatalog(language: string): Promise<ReviewDocument[]> {
  gmOnly();
  const result: ReviewDocument[] = [];
  for (const spec of SPECS) {
    const pack = game.packs.get(spec.pack);
    if (!pack) continue;
    for (const item of (await pack.getIndex({ fields: [`flags.${MODULE_ID}.${spec.key}`] })).values()) {
      const flag = spec.read(item.flags);
      if (!flag || flag.targetLanguage !== language) continue;
      const kind = "documentType" in flag ? flag.documentType : spec.kind;
      result.push({ id: item._id, pack: spec.pack, uuid: `Compendium.${spec.pack}.${displayKind(kind) ? "JournalEntry" : kind}.${item._id}`,
        name: item.name ?? item._id, kind, sourceUuid: flag.sourceUuid, language });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, language));
}

async function hashSource(kind: BundleDocumentKind, data: Record<string, unknown>): Promise<string> {
  if (kind === "Scene" || kind === "ActiveEffect") return displaySourceHash(kind, data);
  if (kind === "JournalEntry") return journalSourceHash(data as JournalData);
  if (kind === "Actor") return actorSourceHash(data as ActorData);
  return itemSourceHash(data as ItemData);
}

/** Resolve collection members by ID in both documents, never by incidental sort order. */
function fieldPaths(source: Record<string, unknown>, copy: Record<string, unknown>, path: HtmlFieldPath): { stable: HtmlFieldPath; target: HtmlFieldPath } {
  const stable = [...path], target = [...path];
  if (typeof path[1] === "number") {
    const rows = source[path[0]!] as Record<string, unknown>[];
    const id = rows[path[1]]?._id ?? rows[path[1]]?.id;
    if (typeof id !== "string") fail("MissingField");
    stable[1] = id;
    const index = (copy[path[0]!] as Record<string, unknown>[] | undefined)?.findIndex(row => (row._id ?? row.id) === id) ?? -1;
    if (index < 0) fail("MissingField");
    target[1] = index;
  }
  return { stable, target };
}

function proof(flags: FoundryJournalDocument["flags"], id: string, fingerprint: string): ReviewRecord | null {
  const review = flags?.[MODULE_ID]?.review as { version?: unknown; entries?: Record<string, unknown> } | undefined;
  const value = review?.version === 1 ? review.entries?.[id] as ReviewRecord | undefined : undefined;
  return value?.fingerprint === fingerprint && typeof value.at === "string" && typeof value.userId === "string" && typeof value.userName === "string" ? value : null;
}

export async function loadReview(entry: ReviewDocument, knownCatalog?: ReviewDocument[]): Promise<ReviewSnapshot> {
  gmOnly();
  const catalog = knownCatalog ?? await reviewCatalog(entry.language);
  const matches = catalog.filter(item => item.sourceUuid === entry.sourceUuid && item.kind === entry.kind);
  if (matches.length !== 1 || matches[0]?.uuid !== entry.uuid) fail("IdentityChanged");
  const current = matches[0];
  const pack = game.packs.get(current.pack)!;
  const copy = await pack.getDocument(current.id);
  const source = await fromUuid(current.sourceUuid) as PortableDocument | null;
  if (!copy || !source?.toObject || source.documentName !== current.kind) fail("MissingSource");
  const spec = SPECS.find(spec => spec.pack === current.pack)!;
  const data = source.toObject(), output = copy.toObject();
  const flag = spec.read(copy.flags);
  if (!flag || flag.sourceUuid !== current.sourceUuid || flag.targetLanguage !== current.language) fail("IdentityChanged");
  const sourceHash = await hashSource(current.kind, data);
  const warning = sourceHash !== flag.sourceHash ? "SourceChanged" : pack.locked ? "Locked" : null;
  const reverse = new Map(catalog.filter(item => !displayKind(item.kind)).map(item => [item.uuid, item.sourceUuid]));
  const display = displayKind(current.kind) ? readDisplayTextFlag(copy.flags)! : null;
  const snapshot: ReviewSnapshot = { entry: current, sourceName: String(data.name ?? current.sourceUuid), rows: [], fields: [],
    groups: [{ id: "document", name: String(data.name ?? current.name) }], guard: (await captureTranslationWriteGuard(copy))!, sourceHash, warning,
    partial: "partial" in flag && flag.partial, reverse };
  const outputHash = "outputHash" in flag ? flag.outputHash : undefined;
  const tracked = !display && await isEditorProtected(output, sourceHash, outputHash);
  const protection = tracked ? readEditorProtection(output) : null;
  snapshot.protection = tracked ? "tracked" : !display && snapshot.partial && (!outputHash || await hasManualOutputEdits(output, outputHash)) ? "untracked" : null;
  const groupIds = new Set(["document"]);
  const groupOrder = new Map<string, number[]>([["document", [-1, -1]]]);
  for (const field of portableFields(source, data)) {
    const original = readPath(data, field.path) as string;
    if (!original.trim()) continue;
    let blocked = warning;
    let stable: (string | number)[], target: HtmlFieldPath;
    let translated: unknown;
    if (display) {
      stable = [...field.path];
      if (typeof stable[1] === "number") stable[1] = (data[stable[0]!] as { _id: string }[])[stable[1]]!._id;
      const metadata = display.fields.find(saved => JSON.stringify(saved.path) === JSON.stringify(stable));
      const pageIndex = (output as JournalData).pages.findIndex(page => page._id === metadata?.pageId);
      translated = metadata && readDisplayTranslation(output as JournalData, metadata);
      target = ["pages", pageIndex, "text", "content"];
    } else {
      try { const paths = fieldPaths(data, output, field.path); stable = [...paths.stable]; target = paths.target; translated = readPath(output, target); }
      catch { stable = [...field.path]; target = []; blocked = "MissingField"; }
    }
    const fieldId = JSON.stringify(stable);
    const collection = field.path[0];
    const embedded = typeof field.path[1] === "number" ? (data[collection!] as Record<string, unknown>[])[field.path[1]] : null;
    const group = embedded ? `${collection}:${String(embedded._id ?? embedded.id)}` : "document";
    if (!groupIds.has(group)) {
      groupIds.add(group);
      const category = collection === "pages" ? (data as JournalData).categories?.find(category => (category._id ?? category.id) === embedded?.category) : undefined;
      snapshot.groups.push({ id: group, name: [category?.name, String(embedded?.name ?? group)].filter(Boolean).join(" › ") });
      const sort = Number(embedded?.sort) || Number(field.path[1]) || 0;
      groupOrder.set(group, collection === "categories" ? [sort, -1] : category ? [Number(category.sort) || 0, sort] : [0, sort]);
    }
    if (collection === "pages" && "partial" in flag && flag.partial && !flag.processedPageIds?.includes(String(embedded?._id))) blocked = "Untranslated";
    if (typeof translated !== "string") { translated = ""; blocked ??= "MissingField"; }
    const translation = translated as string;
    try { assertPortableText(original, remapBundleReferences(translation, reverse), field.format); }
    catch { blocked ??= "StructureChanged"; }
    const originalPlan = planReviewText(original, field.format), translatedPlan = planReviewText(translation, field.format);
    const labelPath = embedded ? field.path.slice(2) : field.path;
    const label = labelPath.join(".");
    snapshot.fields.push({ id: fieldId, source: original, translation, format: field.format, targetPath: target, displayPlain: !!display && field.format === "text" });
    for (const unit of originalPlan.units) {
      const translatedUnit = translatedPlan.units.find(candidate => candidate.id === unit.id);
      const parts = translatedUnit?.parts ?? [translation];
      const rowBlocked = blocked ?? (parts.length === unit.parts.length ? null : "StructureChanged");
      const id = await sha256(JSON.stringify([current.sourceUuid, current.language, fieldId, unit.id]));
      // Bind attestation to the source field (context included) and this exact paragraph.
      const fingerprint = await sha256(JSON.stringify([id, field.format, original, parts]));
      snapshot.rows.push({ id, fieldId, unitId: unit.id, group, label: unit.attribute ? `${label} · ${unit.attribute}` : label,
        format: field.format, source: unit.parts, translation: parts, heading: unit.heading, fingerprint,
        protected: !rowBlocked && protection?.rows[id] === fingerprint, blocked: rowBlocked, verified: rowBlocked ? null : proof(copy.flags, id, fingerprint) });
    }
  }
  snapshot.groups.sort((left, right) => {
    const a = groupOrder.get(left.id)!, b = groupOrder.get(right.id)!;
    return a[0]! - b[0]! || a[1]! - b[1]!;
  });
  return snapshot;
}

interface WritableReviewDocument extends FoundryJournalDocument {
  update(data: Record<string, unknown>): Promise<unknown>;
  updateEmbeddedDocuments(kind: string, updates: Record<string, unknown>[]): Promise<unknown>;
}
export type ReviewAction = { type: "save"; parts: string[] } | { type: "verify" } | { type: "unverify" };

/** Foundry updates schema arrays as arrays, not dotted numeric object keys. */
function fieldUpdate(data: Record<string, unknown>, path: HtmlFieldPath, value: string): Record<string, unknown> {
  const arrayIndex = path.findIndex(part => typeof part === "number");
  if (arrayIndex < 0) return { [path.join(".")]: value };
  const prefix = path.slice(0, arrayIndex);
  const array = structuredClone(readPath(data, prefix));
  if (!Array.isArray(array) || !writePath(array, path.slice(arrayIndex), value)) fail("MissingField");
  return { [prefix.join(".")]: array };
}

/** Re-derive the allowlist and compare a fresh snapshot; callers never supply a write path.
 * Foundry has no server CAS: this detects intervening edits, not simultaneous GM commits. */
export async function updateReview(snapshot: ReviewSnapshot, rowId: string, action: ReviewAction): Promise<ReviewSnapshot> {
  if (action.type === "save") return saveReviewRows(snapshot, [{ rowId, parts: action.parts }]);
  gmOnly();
  if (activeTranslations.list().some(run => run.finishedAt === undefined && run.pausedAt === undefined)) fail("PauseFirst");
  const fresh = await loadReview(snapshot.entry);
  if (fresh.guard.fingerprint !== snapshot.guard.fingerprint || fresh.sourceHash !== snapshot.sourceHash) fail("Conflict");
  const row = fresh.rows.find(row => row.id === rowId);
  if (!row) fail("MissingField");
  if (row.blocked) fail(row.blocked);
  const pack = game.packs.get(fresh.entry.pack)!;
  if (pack.locked) fail("Locked");
  const target = await pack.getDocument(fresh.entry.id) as WritableReviewDocument | undefined;
  if (!target || (await captureTranslationWriteGuard(target))?.fingerprint !== fresh.guard.fingerprint) fail("Conflict");
  const user = game.user as { id?: string; name?: string };
  const value: ReviewRecord | null = action.type === "verify" ? {
    fingerprint: row.fingerprint, at: new Date().toISOString(), userId: user.id ?? "", userName: user.name ?? "GM",
  } : null;
  await target.update({ [`flags.${MODULE_ID}.review.version`]: 1, [`flags.${MODULE_ID}.review.entries.${row.id}`]: value });
  if (displayKind(fresh.entry.kind)) Hooks.callAll("foundryTranslateDisplayTextChanged");
  return loadReview(fresh.entry);
}

export interface ReviewChange { rowId: string; parts: string[] }
export interface ReviewHistoryEntry {
  id: string; at: string; userName: string; sourceHash: string; label: string;
  rows: { rowId: string; before: string[]; after: string[]; label: string; group: string }[];
  undoneAt?: string;
}
export interface ReviewHistoryDocument { entry: ReviewDocument; operations: ReviewHistoryEntry[] }
export function readReviewHistory(flags: FoundryJournalDocument["flags"]): ReviewHistoryEntry[] {
  const history = flags?.[MODULE_ID]?.reviewHistory as Record<string, ReviewHistoryEntry> | undefined;
  return Object.values(history ?? {}).filter(item => item && typeof item.id === "string" && typeof item.at === "string" && Array.isArray(item.rows));
}
export async function reviewHistory(language: string): Promise<ReviewHistoryDocument[]> {
  const result: ReviewHistoryDocument[] = [];
  for (const entry of await reviewCatalog(language)) {
    const doc = await game.packs.get(entry.pack)!.getDocument(entry.id);
    const operations = readReviewHistory(doc?.flags);
    if (operations.length) result.push({ entry, operations });
  }
  return result;
}

/** Compile only schema-allowed text updates. One document update includes its embedded
 * changes and undo record, so a lost response can be resolved from persistent history. */
export async function saveReviewRows(snapshot: ReviewSnapshot, changes: readonly ReviewChange[], options: { id?: string; label?: string; undoId?: string } = {}): Promise<ReviewSnapshot> {
  gmOnly();
  if (activeTranslations.list().some(run => run.finishedAt === undefined && run.pausedAt === undefined)) fail("PauseFirst");
  const fresh = await loadReview(snapshot.entry);
  if (fresh.guard.fingerprint !== snapshot.guard.fingerprint || fresh.sourceHash !== snapshot.sourceHash) fail("Conflict");
  if (!changes.length || new Set(changes.map(change => change.rowId)).size !== changes.length) fail("MissingField");
  const pack = game.packs.get(fresh.entry.pack)!;
  if (pack.locked) fail("Locked");
  const target = await pack.getDocument(fresh.entry.id) as WritableReviewDocument | undefined;
  if (!target) fail("Conflict");
  const data = target.toObject(), staged = structuredClone(data), fieldValues = new Map<string, string>();
  const history: ReviewHistoryEntry = { id: options.id ?? crypto.randomUUID(), at: new Date().toISOString(), userName: (game.user as { name?: string }).name ?? "GM",
    sourceHash: fresh.sourceHash, label: options.label ?? "Correction", rows: [] };
  if (!/^[a-zA-Z0-9-]{1,80}$/u.test(history.id) || (options.undoId && !/^[a-zA-Z0-9-]{1,80}$/u.test(options.undoId))) fail("MissingField");
  if (readReviewHistory(target.flags).some(item => item.id === history.id)) fail("Conflict");
  const patch: Record<string, unknown> = {};
  for (const change of changes) {
    const row = fresh.rows.find(row => row.id === change.rowId);
    if (!row) fail("MissingField");
    if (row.blocked) fail(row.blocked);
    if (change.parts.length !== row.translation.length || change.parts.some(part => typeof part !== "string" || !part.trim())) fail("EmptyText");
    if (JSON.stringify(change.parts) === JSON.stringify(row.translation)) continue;
    const field = fresh.fields.find(field => field.id === row.fieldId)!;
    const previous = fieldValues.get(field.id) ?? field.translation;
    const value = planReviewText(previous, field.format).replace(row.unitId, change.parts);
    try { assertPortableText(field.source, remapBundleReferences(value, fresh.reverse), field.format); assertPortableText(field.translation, value, field.format); }
    catch { fail("ProtectedText"); }
    fieldValues.set(field.id, value);
    history.rows.push({ rowId: row.id, before: row.translation, after: [...change.parts], label: row.label, group: row.group });
    patch[`flags.${MODULE_ID}.review.entries.${row.id}`] = null;
  }
  if (!history.rows.length) return fresh;
  for (const [id, value] of fieldValues) {
    const field = fresh.fields.find(field => field.id === id)!;
    const path = field.targetPath, storedValue = field.displayPlain ? `<p>${escapeDisplayText(value)}</p>` : value;
    if (!path.length || !writePath(staged, path, storedValue)) fail("MissingField");
    if (typeof path[1] === "number") {
      const collection = path[0]!;
      const entries = staged[collection] as Record<string, unknown>[], item = entries[path[1]]!;
      if (collection === "pages" || collection === "items") {
        const updates = (patch[collection] ??= []) as Record<string, unknown>[];
        let embeddedPatch = updates.find(row => row._id === item._id);
        if (!embeddedPatch) { embeddedPatch = { _id: item._id }; updates.push(embeddedPatch); }
        Object.assign(embeddedPatch, fieldUpdate(item, path.slice(2), storedValue));
      } else if (collection === "categories" && path.length === 3 && path[2] === "name") patch.categories = entries;
      else fail("MissingField");
    } else Object.assign(patch, fieldUpdate(staged, path, storedValue));
  }
  if (!displayKind(fresh.entry.kind)) {
    const flag = SPECS.find(spec => spec.pack === fresh.entry.pack)!.read(target.flags)!;
    const protectedRows: Record<string, string> = {};
    for (const change of history.rows) {
      const row = fresh.rows.find(row => row.id === change.rowId)!, field = fresh.fields.find(field => field.id === row.fieldId)!;
      protectedRows[row.id] = await sha256(JSON.stringify([row.id, field.format, field.source, change.after]));
    }
    const protection = await recordEditorProtection(data, staged, fresh.sourceHash, ("outputHash" in flag ? flag.outputHash : undefined),
      [...fieldValues].map(([id, value]) => ({ id, path: JSON.parse(id) as HtmlFieldPath, value })), protectedRows);
    // Explicit null clears a stale receipt instead of authenticating unknown edits.
    patch[`flags.${MODULE_ID}.editorProtection`] = protection;
  }
  patch[`flags.${MODULE_ID}.reviewHistory.${history.id}`] = history;
  if (options.undoId) patch[`flags.${MODULE_ID}.reviewHistory.${options.undoId}.undoneAt`] = history.at;
  // Recheck immediately before the single persistence operation. Never restamp outputHash.
  if ((await captureTranslationWriteGuard(target))?.fingerprint !== fresh.guard.fingerprint) fail("Conflict");
  await target.update(patch);
  if (displayKind(fresh.entry.kind)) Hooks.callAll("foundryTranslateDisplayTextChanged");
  return loadReview(fresh.entry);
}

/** Undo only unchanged affected paragraphs, preserving subsequent edits elsewhere. */
export async function undoReview(entry: ReviewDocument, operationId: string): Promise<ReviewSnapshot> {
  gmOnly();
  const snapshot = await loadReview(entry), doc = await game.packs.get(entry.pack)!.getDocument(entry.id);
  const operation = readReviewHistory(doc?.flags).find(item => item.id === operationId);
  if (!operation || operation.undoneAt || operation.sourceHash !== snapshot.sourceHash) fail("UndoConflict");
  const changes = operation.rows.map(change => {
    const row = snapshot.rows.find(row => row.id === change.rowId);
    if (!row || row.blocked || JSON.stringify(row.translation) !== JSON.stringify(change.after)) fail("UndoConflict");
    return { rowId: row.id, parts: change.before };
  });
  return saveReviewRows(snapshot, changes, { label: "Undo", undoId: operationId });
}
