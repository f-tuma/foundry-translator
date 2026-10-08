import type { AffixAppendReceipt } from "./affix-text-append";
import { bindUnresolvedSourceRetention } from "./unresolved-source-references";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { batchObject, buildCorrectionBatch, assertBatchApplicability, assertBatchFinal, batchRequestHash, type BatchReceipt } from "../polish/correction-batch";
import { canonicalAffixActionDisplayPath } from "../translation/affix-action-display";
import { prepareMachineProofreading, assertMachineProofreadingCoverage, readMachineProofreading, machineProofreadingSchemaProof, type MachineProofreadingReceipt } from "./machine-proofreading";
import { readEditorial, editorialKey, writeEditorial, EDITORIAL_SETTING, type EditorialRecord, type EditorialState } from "./editorial";
import type { PortableReviewMetadata } from "./project-format";
import { hasManualOutputEdits } from "../translation/output-hash";
import { isEditorProtected, readEditorProtection, recordEditorProtection } from "../translation/editor-protection";
import { MODULE_ID } from "../constants";
import { portableFields, type BundleDocumentKind, type FieldFormat, type PortableDocument } from "../bundles/fields";
import { assertPortableText, diagnosePortableText, syntaxExpressions, type PortableTextDiagnostics } from "../bundles/format";
import { referenceRepairDraft } from "./reference-repair";
import { referenceIdentifierRepairDraft } from "./reference-identifier-repair";
import { validateReferenceRebuildChanges, undoReferenceRebuild, assertReferenceRebuildEnvironment, type ReferenceRebuildReceipt } from "./reference-rebuild";
import { remapBundleReferences } from "../bundles/service";
import { ACTOR_TRANSLATIONS_PACK_ID } from "../translation/compendium-actor-translation-repository";
import { ITEM_TRANSLATIONS_PACK_ID } from "../translation/compendium-item-translation-repository";
import { TRANSLATIONS_PACK_ID } from "../translation/compendium-translation-repository";
import { actorSourceHash, readActorTranslationFlag, type ActorData } from "../translation/actor";
import { itemSourceHash, readItemTranslationFlag, type ItemData } from "../translation/item";
import { journalSourceHash, readJournalTranslationFlag, type JournalData } from "../translation/journal";
import { DISPLAY_TEXT_PACK, displaySourceHash, escapeDisplayText, readDisplayTextFlag, readDisplayTranslation, readDisplayTranslationContent } from "../translation/display-text";
import { assertSystemActionFieldIdentity, readPath, writePath, type HtmlFieldPath } from "../translation/system-html-fields";
import { captureTranslationWriteGuard, type TranslationWriteGuard } from "../translation/write-guard";
import { activeTranslations } from "../translation/active-translations";
import { sha256 } from "../translation/hash";
import { planReviewText } from "./text-plan";
import { assertEmbedOptionEdits } from "./embed-text-options";
import { embedOptionNumbersChanged, proseNumbers, sourceNumberRepair } from "../polish/quality-guards";
import { referenceContext, sourceReferenceNotation } from "../bundles/reference-notation";

const SPECS = [
  { kind: "JournalEntry", pack: TRANSLATIONS_PACK_ID, key: "translation", read: readJournalTranslationFlag },
  { kind: "Actor", pack: ACTOR_TRANSLATIONS_PACK_ID, key: "actorTranslation", read: readActorTranslationFlag },
  { kind: "Item", pack: ITEM_TRANSLATIONS_PACK_ID, key: "itemTranslation", read: readItemTranslationFlag },
  { kind: "Scene", pack: DISPLAY_TEXT_PACK, key: "displayTranslation", read: readDisplayTextFlag },
] as const;
export interface ReviewDocument {
  id: string; pack: string; uuid: string; name: string; kind: BundleDocumentKind; sourceUuid: string; language: string;
}
export interface ReviewRecord { fingerprint: string; at: string; userId: string; userName: string; importedAt?: string }
export interface ReviewRow {
  id: string; fieldId: string; unitId: string; group: string; label: string; format: FieldFormat;
  source: string[]; translation: string[]; heading: boolean; fingerprint: string;
  verified: ReviewRecord | null; blocked: string | null; protected?: boolean; editorial?: EditorialRecord | null;
}
export interface ReviewField {
  id: string; source: string; translation: string; format: FieldFormat; targetPath: HtmlFieldPath; displayPlain: boolean;
  referenceContext?: string; integrity?: PortableTextDiagnostics | null;
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

export async function hashSource(kind: BundleDocumentKind, data: Record<string, unknown>): Promise<string> {
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
  assertSystemActionFieldIdentity(source, copy, path, target);
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
      stable = canonicalAffixActionDisplayPath(data, field.path) ?? [...field.path];
      if (typeof stable[1] === "number") stable[1] = (data[stable[0]!] as { _id: string }[])[stable[1]]!._id;
      const metadata = display.fields.find(saved => JSON.stringify(saved.path) === JSON.stringify(stable));
      const pageIndex = (output as JournalData).pages.findIndex(page => page._id === metadata?.pageId);
      // Validate below with canonical UUIDs and the current source. The runtime
      // reader deliberately rejects damaged content; using it here would hide
      // the actual stored text and misreport broken references as MissingField.
      translated = metadata && readDisplayTranslationContent(output as JournalData, metadata);
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
    const context = referenceContext(current.sourceUuid, data, field.path);
    const integrity = diagnosePortableText(original, sourceReferenceNotation(original, remapBundleReferences(translation, reverse), context), field.format);
    if (integrity) blocked ??= "StructureChanged";
    const originalPlan = planReviewText(original, field.format), translatedPlan = planReviewText(translation, field.format);
    const labelPath = embedded ? field.path.slice(2) : field.path;
    const label = labelPath.join(".");
    snapshot.fields.push({ id: fieldId, source: original, translation, format: field.format, targetPath: target, displayPlain: !!display && field.format === "text", referenceContext: context, integrity });
    const translatedUnits = new Map(translatedPlan.units.map(unit => [unit.id, unit]));
    for (const unit of originalPlan.units) {
      const translatedUnit = translatedUnits.get(unit.id);
      const parts = translatedUnit?.parts ?? [translation];
      // Whitespace-only prose parts are omitted by the planner. Source and
      // translation may therefore have different part counts despite identical
      // markup; edits always retain the target's own validated part layout.
      const rowBlocked = blocked ?? (translatedUnit ? null : "StructureChanged");
      const id = await sha256(JSON.stringify([current.sourceUuid, current.language, fieldId, unit.id]));
      // Bind attestation to the source field (context included) and this exact paragraph.
      const fingerprint = await sha256(JSON.stringify([id, field.format, original, parts]));
      snapshot.rows.push({ id, fieldId, unitId: unit.id, group, label: unit.attribute ? `${label} · ${unit.attribute}` : label,
        format: field.format, source: unit.parts, translation: parts, heading: unit.heading, fingerprint,
        protected: !rowBlocked && protection?.rows[id] === fingerprint, blocked: rowBlocked, verified: rowBlocked ? null : proof(copy.flags, id, fingerprint) });
    }
  }
  const editorial = readEditorial();
  for (const row of snapshot.rows) row.editorial = editorial.entries[editorialKey(current, row.id)] ?? null;
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
export type ReviewAction = { type: "save"; parts: string[] } | { type: "verify" } | { type: "unverify" } | { type: "editorial"; state: EditorialState; note: string };

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
  if (action.type === "editorial") {
    await writeEditorial(fresh.entry, row, snapshot.rows.find(item => item.id === rowId)?.editorial ?? null, action.state, action.note);
    return loadReview(fresh.entry);
  }
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
/** Portable attestation: source context and canonical links, independent of copy IDs. */
export function portableReviewBinding(snapshot: ReviewSnapshot, row: ReviewRow, parts = row.translation): Promise<string> {
  const field = snapshot.fields.find(field => field.id === row.fieldId)!;
  return sha256(JSON.stringify([row.id, row.format, field.source, portableReviewText(snapshot, field, parts)]));
}
export function portableReviewText<T extends string | string[]>(snapshot: ReviewSnapshot, field: ReviewField, text: T): T {
  return sourceReferenceNotation(field.source, remapBundleReferences(text, snapshot.reverse), field.referenceContext ?? snapshot.entry.sourceUuid);
}
export async function importReviewMetadata(snapshot: ReviewSnapshot, records: PortableReviewMetadata[]): Promise<ReviewSnapshot> {
  gmOnly();
  if (activeTranslations.list().some(run => run.finishedAt === undefined && run.pausedAt === undefined)) fail("PauseFirst");
  const fresh = await loadReview(snapshot.entry);
  if (fresh.guard.fingerprint !== snapshot.guard.fingerprint || fresh.sourceHash !== snapshot.sourceHash) fail("Conflict");
  const notes = readEditorial(), previousNotes = JSON.stringify(notes), patch: Record<string, unknown> = {};
  const protectedRows: Record<string, string> = {}, protectedFields = new Set<string>();
  for (const record of records) {
    const row = fresh.rows.find(row => row.id === record.rowId), expected = snapshot.rows.find(row => row.id === record.rowId);
    if (!row || row.blocked || await portableReviewBinding(fresh, row) !== record.binding) fail("Conflict");
    if (record.protected && !row.protected && !displayKind(fresh.entry.kind)) { protectedRows[row.id] = row.fingerprint; protectedFields.add(row.fieldId); }
    if (record.proof && !row.verified) {
      patch[`flags.${MODULE_ID}.review.version`] = 1;
      patch[`flags.${MODULE_ID}.review.entries.${row.id}`] = { fingerprint: row.fingerprint, at: record.proof.at, userName: record.proof.userName, userId: "", importedAt: new Date().toISOString() } satisfies ReviewRecord;
    }
    if (record.editorial) {
      if (JSON.stringify(row.editorial ?? null) !== JSON.stringify(expected?.editorial ?? null)) fail("Conflict");
      const note = record.editorial, key = editorialKey(fresh.entry, row.id);
      const fingerprint = note.stale ? `imported-stale:${record.binding}` : row.fingerprint;
      notes.entries[key] = { state: note.state, note: note.note, at: note.at, userName: note.userName, fingerprint };
    }
  }
  if (Object.keys(notes.entries).length > 20000) fail("NoteInvalid");
  const target = await game.packs.get(fresh.entry.pack)!.getDocument(fresh.entry.id) as WritableReviewDocument | undefined;
  if (!target || (await captureTranslationWriteGuard(target))?.fingerprint !== fresh.guard.fingerprint || JSON.stringify(readEditorial()) !== previousNotes) fail("Conflict");
  if (protectedFields.size) {
    const data = target.toObject(), flag = SPECS.find(spec => spec.pack === fresh.entry.pack)!.read(target.flags)!;
    const protection = await recordEditorProtection(data, data, fresh.sourceHash, "outputHash" in flag ? flag.outputHash : undefined,
      fresh.fields.filter(field => protectedFields.has(field.id)).map(field => ({ id: field.id, path: JSON.parse(field.id) as HtmlFieldPath, value: field.translation })), protectedRows);
    if (protection) patch[`flags.${MODULE_ID}.editorProtection`] = protection;
    if ((await captureTranslationWriteGuard(target))?.fingerprint !== fresh.guard.fingerprint) fail("Conflict");
  }
  if (Object.keys(patch).length) await target.update(patch);
  if (JSON.stringify(notes) !== previousNotes) {
    if (JSON.stringify(readEditorial()) !== previousNotes) fail("Conflict");
    await game.settings.set(MODULE_ID, EDITORIAL_SETTING, notes);
  }
  return loadReview(fresh.entry);
}
export interface ReviewHistoryEntry {
  id: string; at: string; userName: string; sourceHash: string; label: string;
  agentRequestHash?: string;
  correctionBatch?: BatchReceipt;
  affixTextAppend?: AffixAppendReceipt;
  referenceRepair?: true;
  identifierRepair?: true;
  referenceRebuild?: ReferenceRebuildReceipt;
  machineProofreading?: { before: MachineProofreadingReceipt | null; after: MachineProofreadingReceipt };
  rows: { rowId: string; before: string[]; after: string[]; label: string; group: string }[];
  undoneAt?: string;
}
export interface ReviewHistoryDocument { entry: ReviewDocument; operations: ReviewHistoryEntry[] }
export function readReviewHistory(flags: FoundryJournalDocument["flags"]): ReviewHistoryEntry[] {
  const history = flags?.[MODULE_ID]?.reviewHistory as Record<string, ReviewHistoryEntry> | undefined;
  return Object.values(history ?? {}).filter(item => item && typeof item.id === "string" && typeof item.at === "string" && Array.isArray(item.rows));
}
export async function reviewHistory(language: string, options: { signal?: AbortSignal; progress?: (done: number, total: number) => void } = {}): Promise<ReviewHistoryDocument[]> {
  gmOnly();
  const result: ReviewHistoryDocument[] = [];
  const specs = SPECS.filter(spec => game.packs.has(spec.pack));
  options.progress?.(0, specs.length);
  for (const [position, spec] of specs.entries()) {
    options.signal?.throwIfAborted();
    const pack = game.packs.get(spec.pack)!;
    // History lives on the parent document. Index only its flags, never load every
    // Actor/Item/Journal and all their embedded content just to find corrections.
    const pending = pack.getIndex({ fields: [`flags.${MODULE_ID}.${spec.key}`, `flags.${MODULE_ID}.reviewHistory`] });
    const index = await abortableHistoryRead(pending, options.signal);
    let scanned = 0;
    for (const item of index.values()) {
      options.signal?.throwIfAborted();
      const flag = spec.read(item.flags);
      if (flag?.targetLanguage === language) {
        const operations = readReviewHistory(item.flags);
        if (operations.length) {
          const kind = "documentType" in flag ? flag.documentType : spec.kind;
          result.push({ entry: { id: item._id, pack: spec.pack, uuid: `Compendium.${spec.pack}.${displayKind(kind) ? "JournalEntry" : kind}.${item._id}`,
            name: item.name ?? item._id, kind, sourceUuid: flag.sourceUuid, language }, operations });
        }
      }
      if (++scanned % 100 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    options.progress?.(position + 1, specs.length);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  options.signal?.throwIfAborted();
  return result;
}

function abortableHistoryRead<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Compile only schema-allowed text updates. One document update includes its embedded
 * changes and undo record, so a lost response can be resolved from persistent history. */
export async function saveReviewRows(snapshot: ReviewSnapshot, changes: readonly ReviewChange[], options: { id?: string; label?: string; undoId?: string; agentRequestHash?: string; ordinaryBatch?: BatchReceipt; repairReferences?: boolean; identifierRepair?: boolean; referenceRebuild?: { fieldId: string; proofHash: string; restoreSourceNumbers?: boolean; retainUnresolvedSourceReferences?: boolean }; restoreEmbedSourceNumbers?: boolean; canWrite?: () => boolean; beforeWrite?: () => Promise<void> } = {}): Promise<ReviewSnapshot> {
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
  const undo = options.undoId ? readReviewHistory(target.flags).find(item => item.id === options.undoId) : undefined;
  const exactUndo = !!undo && !undo.undoneAt && undo.sourceHash === fresh.sourceHash && undo.rows.length === changes.length &&
    undo.rows.every(saved => changes.some(change => change.rowId === saved.rowId && JSON.stringify(change.parts) === JSON.stringify(saved.before)) &&
      JSON.stringify(fresh.rows.find(row => row.id === saved.rowId)?.translation) === JSON.stringify(saved.after));
  if (options.undoId && !exactUndo) fail("UndoConflict");
  const rebuildMode = !!options.referenceRebuild || !!undo?.referenceRebuild;
  const batchMode = !!options.ordinaryBatch || !!undo?.correctionBatch;
  if (options.beforeWrite && !options.referenceRebuild && !options.ordinaryBatch) fail("ProtectedText");
  if (batchMode && (options.referenceRebuild || options.identifierRepair || options.repairReferences || options.restoreEmbedSourceNumbers || (options.ordinaryBatch && options.undoId))) fail("ProtectedText");
  if (options.ordinaryBatch) {
    if (options.label !== `MCP batch: ${options.ordinaryBatch.payload.reason}` || options.agentRequestHash !== await batchRequestHash(options.ordinaryBatch.payloadHash,options.ordinaryBatch.planHash)) fail("Conflict");
    const proved = await buildCorrectionBatch(fresh, options.ordinaryBatch.payload, await reviewCatalog(fresh.entry.language), await new GlossaryCompendiumRepository().loadExisting());
    if (JSON.stringify(proved.receipt) !== JSON.stringify(options.ordinaryBatch) || JSON.stringify(proved.changes) !== JSON.stringify(changes)) fail("Conflict");
  } else if (undo?.correctionBatch) await assertBatchApplicability(fresh, undo);
  let batchSynchronousCheck: (() => void) | undefined;
  let rebuildReceipt: ReferenceRebuildReceipt | undefined;
  let rebuildTargets: { target: string; required: boolean; sourceTarget?: string; retentionPolicy?: "retain-exact-unresolved-original" }[] = [];
  let retentionGuard: Awaited<ReturnType<typeof bindUnresolvedSourceRetention>> | undefined;
  if (rebuildMode) {
    if (options.repairReferences || options.identifierRepair || options.restoreEmbedSourceNumbers || (options.referenceRebuild && options.undoId)) fail("ProtectedText");
    if (options.referenceRebuild) {
      const rebuilt = await validateReferenceRebuildChanges(fresh, options.referenceRebuild.fieldId, options.referenceRebuild.proofHash, changes, options.referenceRebuild.restoreSourceNumbers ?? false, options.referenceRebuild.retainUnresolvedSourceReferences ?? false);
      rebuildTargets = rebuilt.plan.targets;
      rebuildReceipt = rebuilt.receipt;
      if (rebuilt.receipt.unresolvedSourceRetention) retentionGuard = await bindUnresolvedSourceRetention(fresh, rebuilt.receipt.unresolvedSourceRetention);
      fieldValues.set(rebuilt.plan.fieldId, rebuilt.value);
    } else {
      if (!undo?.referenceRebuild || !exactUndo) fail("UndoConflict");
      const restored = await undoReferenceRebuild(fresh, undo.referenceRebuild, undo.rows);
      if (undo.referenceRebuild.unresolvedSourceRetention) retentionGuard = await bindUnresolvedSourceRetention(fresh, undo.referenceRebuild.unresolvedSourceRetention);
      fieldValues.set(restored.fieldId, restored.value);
    }
  }
  if (options.identifierRepair && (options.repairReferences || options.undoId)) fail("ProtectedText");
  const identifierMode = options.identifierRepair || !!undo?.identifierRepair;
  if (identifierMode) {
    const fieldId = fresh.rows.find(row => row.id === changes[0]!.rowId)?.fieldId;
    if (!fieldId || changes.some(change => fresh.rows.find(row => row.id === change.rowId)?.fieldId !== fieldId)) fail("ProtectedText");
    const field = fresh.fields.find(item => item.id === fieldId)!;
    if (options.identifierRepair) {
      const repair = referenceIdentifierRepairDraft(fresh, fieldId);
      if (!repair || JSON.stringify(repair.changes) !== JSON.stringify(changes)) fail("ProtectedText");
      fieldValues.set(fieldId, repair.value);
    } else {
      if (!undo || undo.undoneAt || undo.sourceHash !== fresh.sourceHash || undo.rows.length !== changes.length ||
        !undo.rows.every(saved => changes.some(change => change.rowId === saved.rowId && JSON.stringify(change.parts) === JSON.stringify(saved.before)) &&
          JSON.stringify(fresh.rows.find(row => row.id === saved.rowId)?.translation) === JSON.stringify(saved.after))) fail("UndoConflict");
      // Reconstruct every recorded before row before proving the inverse. An
      // ordinary partial-row validator cannot validate this intentionally bad field.
      const beforePlan = planReviewText(field.translation, field.format);
      let beforeValue = field.translation;
      for (const change of changes) beforeValue = beforePlan.replace(fresh.rows.find(row => row.id === change.rowId)!.unitId, change.parts);
      const beforeUnits = new Map(planReviewText(beforeValue, field.format).units.map(unit => [unit.id, unit.parts]));
      const restored: ReviewSnapshot = { ...fresh,
        fields: fresh.fields.map(item => item.id === fieldId ? { ...item, translation: beforeValue } : item),
        rows: fresh.rows.map(row => row.fieldId === fieldId ? { ...row, translation: beforeUnits.get(row.unitId) ?? [], blocked: "StructureChanged" } : row) };
      const proof = referenceIdentifierRepairDraft(restored, fieldId);
      if (!proof || proof.value !== field.translation || JSON.stringify(proof.changes) !==
        JSON.stringify(undo.rows.map(saved => ({ rowId: saved.rowId, parts: saved.after })))) fail("UndoConflict");
      fieldValues.set(fieldId, beforeValue);
    }
  }
  const undoReferences = !!undo?.referenceRepair && !undo.undoneAt && undo.sourceHash === fresh.sourceHash && undo.rows.length === changes.length &&
    undo.rows.every(saved => changes.some(change => change.rowId === saved.rowId && JSON.stringify(change.parts) === JSON.stringify(saved.before)) &&
      JSON.stringify(fresh.rows.find(row => row.id === saved.rowId)?.translation) === JSON.stringify(saved.after));
  const history: ReviewHistoryEntry = { id: options.id ?? crypto.randomUUID(), at: new Date().toISOString(), userName: (game.user as { name?: string }).name ?? "GM",
    sourceHash: fresh.sourceHash, label: options.label ?? "Correction", rows: [] };
  if (options.agentRequestHash !== undefined) {
    if (!/^[a-f0-9]{64}$/u.test(options.agentRequestHash)) fail("MissingField");
    history.agentRequestHash = options.agentRequestHash;
  }
  if (options.ordinaryBatch) history.correctionBatch = structuredClone(options.ordinaryBatch);
  if (options.repairReferences) history.referenceRepair = true;
  if (options.identifierRepair) history.identifierRepair = true;
  if (rebuildReceipt) history.referenceRebuild = rebuildReceipt;
  if (!/^[a-zA-Z0-9-]{1,80}$/u.test(history.id) || (options.undoId && !/^[a-zA-Z0-9-]{1,80}$/u.test(options.undoId))) fail("MissingField");
  if (readReviewHistory(target.flags).some(item => item.id === history.id)) fail("Conflict");
  const patch: Record<string, unknown> = {};
  for (const change of changes) {
    const row = fresh.rows.find(row => row.id === change.rowId);
    if (!row) fail("MissingField");
    if (row.blocked && !((options.repairReferences || options.identifierRepair || options.referenceRebuild) && row.blocked === "StructureChanged")) fail(row.blocked);
    if (JSON.stringify(change.parts) === JSON.stringify(row.translation)) continue;
    const field = fresh.fields.find(field => field.id === row.fieldId)!;
    const previous = fieldValues.get(field.id) ?? field.translation;
    const value = identifierMode || rebuildMode ? fieldValues.get(field.id)! : validateReviewCorrection(fresh, row.id, change.parts, previous, !!options.repairReferences, undoReferences, !!options.restoreEmbedSourceNumbers, exactUndo);
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
  const checkRebuildTargets = async () => {
    if (retentionGuard) await retentionGuard.recheck();
    for (const target of rebuildTargets) {
      if (target.retentionPolicy) {
        if (!retentionGuard || !rebuildReceipt?.unresolvedSourceRetention?.mappings.some(m => m.sourceTarget === target.sourceTarget && m.retainedTarget === target.target)) fail("Conflict");
        continue; // Only independently qualified exact unresolved originals.
      }
      if (!target.required) continue; // Exact source-only, proven inactive Ember branch.
      const uuid = target.target.split("#")[0]!;
      const kind = /(?:^|\.)(Actor|Item|JournalEntry|JournalEntryPage)\.[^.]+$/u.exec(uuid)?.[1];
      const document = await fromUuid(uuid);
      if (!kind || document?.uuid !== uuid || document.documentName !== kind) fail("ReferenceTargetMissing");
    }
  };
  // Check both sides of the integration callback: it may await glossary/scope
  // reads while a required target changes. Its repeated read also rejects a
  // glossary change during the final target reads. Foundry still has no CAS.
  await checkRebuildTargets();
  if (options.beforeWrite) await options.beforeWrite();
  if (options.beforeWrite) { await checkRebuildTargets(); await options.beforeWrite(); }
  if (identifierMode || rebuildMode) {
    const latestSource = await fromUuid(fresh.entry.sourceUuid) as PortableDocument | null;
    if (!latestSource?.toObject || latestSource.documentName !== fresh.entry.kind ||
      await hashSource(fresh.entry.kind, latestSource.toObject()) !== fresh.sourceHash) fail("Conflict");
    if (pack.locked) fail("Locked");
    if (activeTranslations.list().some(run => run.finishedAt === undefined && run.pausedAt === undefined)) fail("PauseFirst");
  }
  if (batchMode) {
    batchSynchronousCheck = await assertBatchFinal(fresh, options.ordinaryBatch ?? undo!.correctionBatch!);
    if (options.beforeWrite) await options.beforeWrite();
    batchSynchronousCheck = await assertBatchFinal(fresh, options.ordinaryBatch ?? undo!.correctionBatch!);
  }
  // Recheck immediately before the single persistence operation. Never restamp outputHash.
  if ((await captureTranslationWriteGuard(target))?.fingerprint !== fresh.guard.fingerprint) fail("Conflict");
  if (rebuildMode) assertReferenceRebuildEnvironment(rebuildReceipt ?? undo!.referenceRebuild!);
  if (rebuildMode) {
    if (pack.locked) fail("Locked");
    if (activeTranslations.list().some(run => run.finishedAt === undefined && run.pausedAt === undefined)) fail("PauseFirst");
  }
  if (options.canWrite && !options.canWrite()) throw new Error("Live.Disconnected");
  if (retentionGuard) {
    if (batchObject(target.toObject()) !== batchObject(data)) fail("Conflict");
    retentionGuard.assertUnchanged();
  }
  batchSynchronousCheck?.();
  await target.update(patch);
  if (displayKind(fresh.entry.kind)) Hooks.callAll("foundryTranslateDisplayTextChanged");
  return loadReview(fresh.entry);
}

/** Preview and persistence share the same paragraph/markup/reference checks. */
export function validateReviewCorrection(snapshot: ReviewSnapshot, rowId: string, parts: string[], previous?: string, repairReferences = false, undoReferences = false, restoreEmbedSourceNumbers = false, undoEmbedOptions = false): string {
  const row = snapshot.rows.find(row => row.id === rowId);
  if (!row) fail("MissingField");
  if (row.blocked && !(repairReferences && row.blocked === "StructureChanged")) fail(row.blocked);
  if (parts.length !== row.translation.length || parts.some(part => typeof part !== "string" || !part.trim())) fail("EmptyText");
  const field = snapshot.fields.find(field => field.id === row.fieldId)!;
  const value = planReviewText(previous ?? field.translation, field.format).replace(row.unitId, parts);
  try {
    assertEmbedOptionEdits(row.translation, parts);
    const sameTotal = JSON.stringify(proseNumbers(row.translation)) === JSON.stringify(proseNumbers(parts));
    const changedPlacement = parts.some((part, index) => JSON.stringify(proseNumbers([part])) !== JSON.stringify(proseNumbers([row.translation[index]!]))) && sameTotal;
    if (changedPlacement && !restoreEmbedSourceNumbers && !undoEmbedOptions) throw new Error("Numerical placement requires explicit source-part restoration.");
    if (restoreEmbedSourceNumbers && !undoEmbedOptions && !sourceNumberRepair(row.source, row.translation, parts,
      text => portableReviewText(snapshot, field, text)).allowed) throw new Error("Invalid source-part numerical restoration.");
    if (!undoEmbedOptions && embedOptionNumbersChanged(row.translation, parts) &&
        (!restoreEmbedSourceNumbers || !sourceNumberRepair(row.source, row.translation, parts,
          text => portableReviewText(snapshot, field, text)).allowed)) throw new Error("Numbers inside an embedded description changed.");
    if (repairReferences || undoReferences) {
      if (repairReferences) {
        const repair = referenceRepairDraft(snapshot, row);
        if (!repair || JSON.stringify(syntaxExpressions(portableReviewText(snapshot, field, parts).join(""))) !==
          JSON.stringify(syntaxExpressions(portableReviewText(snapshot, field, repair.references.flat().map(ref => ref.command)).join("")))) {
          throw new Error("Only the source-derived reference repair can be applied.");
        }
      }
      if (undoReferences) {
        // Reachable only through a guard-checked, exact persistent undo record.
        const restored = { ...field, translation: value, integrity: null };
        if (!referenceRepairDraft({ ...snapshot, fields: snapshot.fields.map(item => item.id === field.id ? restored : item) },
          { ...row, translation: parts, blocked: "StructureChanged" })) throw new Error("Invalid reference repair undo.");
      } else assertPortableText(field.source, portableReviewText(snapshot, field, value), field.format);
    } else {
      assertPortableText(field.source, portableReviewText(snapshot, field, value), field.format);
      assertPortableText(field.translation, value, field.format);
    }
  }
  catch (error) { throw new Error("Review.ProtectedText", { cause: error }); }
  return value;
}

/** Metadata-only machine attestation; it never rewrites prose, fallback counts or human review entries. */
export async function saveMachineProofreading(snapshot: ReviewSnapshot, rowIds: string[], coverageHash: string,
  options: { id: string; label: string; reason: string; agentRequestHash: string; canWrite: () => boolean; beforeWrite: () => Promise<void> }): Promise<ReviewSnapshot> {
  gmOnly();
  const idle = () => { if (activeTranslations.list().some(run => run.finishedAt === undefined)) fail("PauseFirst"); };
  idle();
  const fresh = await loadReview(snapshot.entry);
  if (fresh.guard.fingerprint !== snapshot.guard.fingerprint || fresh.sourceHash !== snapshot.sourceHash) fail("Conflict");
  const pack = game.packs.get(fresh.entry.pack)!;
  const target = await pack.getDocument(fresh.entry.id) as WritableReviewDocument | undefined;
  const source = await fromUuid(fresh.entry.sourceUuid) as PortableDocument | null;
  if (!target || !source || source.uuid !== fresh.entry.sourceUuid || source.documentName !== "Item") fail("Conflict");
  const data = target.toObject() as ItemData, sourceProof = JSON.stringify(source.toObject()), targetProof = JSON.stringify(data);
  const schemaProof = machineProofreadingSchemaProof(source);
  const plan = await prepareMachineProofreading(fresh, source, data);
  assertMachineProofreadingCoverage(plan, rowIds, coverageHash);
  if (!/^[a-zA-Z0-9-]{1,80}$/u.test(options.id) || !/^[a-f0-9]{64}$/u.test(options.agentRequestHash) || options.reason.trim().length < 5 || options.reason.length > 3000 || options.label !== `MCP: ${options.reason}` || !game.user?.id) fail("MissingField");
  if (readReviewHistory(target.flags).some(item => item.id === options.id)) fail("Conflict");
  const receipt: MachineProofreadingReceipt = { version: 1, kind: "Item", operationId: options.id, at: new Date().toISOString(),
    userId: game.user!.id!, reason: options.reason, documentId: plan.documentId, sourceUuid: plan.sourceUuid, language: plan.language,
    sourceHash: plan.sourceHash, fullSourceHash: plan.fullSourceHash, outputHash: plan.outputHash, coverageHash: plan.coverageHash,
    metadataHash: plan.metadataHash, rowIds: plan.rowIds };
  const history: ReviewHistoryEntry = { id: options.id, at: receipt.at, userName: (game.user as { name?: string }).name ?? "GM",
    sourceHash: fresh.sourceHash, label: options.label, agentRequestHash: options.agentRequestHash, rows: [],
    machineProofreading: { before: readMachineProofreading(data), after: receipt } };
  await options.beforeWrite();
  const latest = await loadReview(fresh.entry), latestSource = await fromUuid(fresh.entry.sourceUuid) as PortableDocument | null;
  if (latest.guard.fingerprint !== fresh.guard.fingerprint || latest.sourceHash !== fresh.sourceHash || latest.warning || latest.partial ||
    !latestSource || latestSource.uuid !== source.uuid || latestSource.documentName !== "Item" || JSON.stringify(latestSource.toObject()) !== sourceProof) fail("Conflict");
  await options.beforeWrite();
  // Synchronous final checks close mutations during final asynchronous validation.
  if (JSON.stringify(source.toObject()) !== sourceProof || JSON.stringify(latestSource.toObject()) !== sourceProof || JSON.stringify(target.toObject()) !== targetProof || machineProofreadingSchemaProof(source) !== schemaProof || machineProofreadingSchemaProof(latestSource) !== schemaProof) fail("Conflict");
  if (pack.locked) fail("Locked"); idle(); gmOnly();
  if (!options.canWrite()) throw new Error("Live.Disconnected");
  await target.update({ [`flags.${MODULE_ID}.machineProofreading`]: receipt, [`flags.${MODULE_ID}.reviewHistory.${history.id}`]: history });
  return loadReview(fresh.entry);
}

async function undoMachineProofreading(snapshot: ReviewSnapshot, operation: ReviewHistoryEntry, canWrite?: () => boolean): Promise<ReviewSnapshot> {
  const record = operation.machineProofreading;
  if (!record || operation.rows.length || operation.undoneAt) fail("UndoConflict");
  if (activeTranslations.list().some(run => run.finishedAt === undefined)) fail("PauseFirst");
  const pack = game.packs.get(snapshot.entry.pack)!, target = await pack.getDocument(snapshot.entry.id) as WritableReviewDocument | undefined;
  const source = await fromUuid(snapshot.entry.sourceUuid) as PortableDocument | null;
  if (!target || !source || source.uuid !== snapshot.entry.sourceUuid || source.documentName !== "Item") fail("UndoConflict");
  const data = target.toObject() as ItemData, sourceProof = JSON.stringify(source.toObject()), targetProof = JSON.stringify(data);
  if (JSON.stringify(readMachineProofreading(data)) !== JSON.stringify(record.after)) fail("UndoConflict");
  const schemaProof = machineProofreadingSchemaProof(source);
  const plan = await prepareMachineProofreading(snapshot, source, data);
  if (plan.fullSourceHash !== record.after.fullSourceHash || plan.outputHash !== record.after.outputHash || plan.metadataHash !== record.after.metadataHash) fail("UndoConflict");
  assertMachineProofreadingCoverage(plan, record.after.rowIds, record.after.coverageHash);
  const latest = await loadReview(snapshot.entry), latestSource = await fromUuid(snapshot.entry.sourceUuid) as PortableDocument | null;
  if (latest.guard.fingerprint !== snapshot.guard.fingerprint || latest.sourceHash !== snapshot.sourceHash || !latestSource || latestSource.uuid !== source.uuid ||
    JSON.stringify(latestSource.toObject()) !== sourceProof || JSON.stringify(source.toObject()) !== sourceProof || JSON.stringify(target.toObject()) !== targetProof || machineProofreadingSchemaProof(source) !== schemaProof || machineProofreadingSchemaProof(latestSource) !== schemaProof) fail("UndoConflict");
  if (pack.locked) fail("Locked"); gmOnly();
  if (activeTranslations.list().some(run => run.finishedAt === undefined)) fail("PauseFirst");
  if (canWrite && !canWrite()) throw new Error("Live.Disconnected");
  const at = new Date().toISOString(), undoId = crypto.randomUUID();
  await target.update({ [`flags.${MODULE_ID}.machineProofreading`]: record.before, [`flags.${MODULE_ID}.reviewHistory.${operation.id}.undoneAt`]: at,
    [`flags.${MODULE_ID}.reviewHistory.${undoId}`]: { id: undoId, at, sourceHash: snapshot.sourceHash, label: "Undo machine proofreading",
      userName: (game.user as { name?: string }).name ?? "GM", rows: [] } });
  return loadReview(snapshot.entry);
}

/** Undo only unchanged affected paragraphs, preserving subsequent edits elsewhere. */
export async function undoReview(entry: ReviewDocument, operationId: string, canWrite?: () => boolean): Promise<ReviewSnapshot> {
  gmOnly();
  const snapshot = await loadReview(entry), doc = await game.packs.get(entry.pack)!.getDocument(entry.id);
  const operation = readReviewHistory(doc?.flags).find(item => item.id === operationId);
  if (operation?.affixTextAppend) fail("AffixAppendUndoRequiresDedicatedGuard");
  if (!operation || operation.undoneAt || operation.sourceHash !== snapshot.sourceHash) fail("UndoConflict");
  if (operation.machineProofreading) return undoMachineProofreading(snapshot, operation, canWrite);
  const changes = operation.rows.map(change => {
    const row = snapshot.rows.find(row => row.id === change.rowId);
    if (!row || row.blocked || JSON.stringify(row.translation) !== JSON.stringify(change.after)) fail("UndoConflict");
    return { rowId: row.id, parts: change.before };
  });
  return saveReviewRows(snapshot, changes, { label: "Undo", undoId: operationId, ...(canWrite ? { canWrite } : {}) });
}
