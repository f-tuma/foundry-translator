import { DISPLAY_TEXT_PACK, DISPLAY_TEXT_REVISION, buildDisplayTextRecord, displayFields, displaySourceHash, escapeDisplayText,
  isDisplayDocument, readDisplayTextFlag, readDisplayTranslation, type DisplayDocumentKind } from "../translation/display-text";
import { CompendiumDisplayTextRepository } from "../translation/compendium-display-text-repository";
import { sha256 } from "../translation/hash";
import { MODULE_ID, MODULE_VERSION } from "../constants";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { validateGlossary } from "../glossary/protection";
import type { GlossaryEntry } from "../glossary/types";
import { actorSourceHash, readActorTranslationFlag, type ActorData } from "../translation/actor";
import { itemSourceHash, readItemTranslationFlag, type ItemData } from "../translation/item";
import { journalSourceHash, readJournalTranslationFlag, type JournalData } from "../translation/journal";
import { CompendiumJournalTranslationRepository, TRANSLATIONS_PACK_ID, TRANSLATION_FLAG_PATH } from "../translation/compendium-translation-repository";
import { CompendiumActorTranslationRepository, ACTOR_TRANSLATIONS_PACK_ID, ACTOR_TRANSLATION_FLAG_PATH } from "../translation/compendium-actor-translation-repository";
import { CompendiumItemTranslationRepository, ITEM_TRANSLATIONS_PACK_ID, ITEM_TRANSLATION_FLAG_PATH } from "../translation/compendium-item-translation-repository";
import { discoverObjectDependencies, rewriteDocumentReferences } from "../translation/document-dependencies";
import { readPath, writePath, type HtmlFieldPath } from "../translation/system-html-fields";
import { translatedOutputHash } from "../translation/output-hash";
import { glossaryFingerprint } from "../translation/unit-translator";
import { portableFields, type PortableDocument, type BundleDocumentKind } from "./fields";
import { BUNDLE_FORMAT, assertPortableText, parseTranslationBundle, type BundleDocument, type TranslationBundle } from "./format";

const SPECS = [
  { kind: "JournalEntry", pack: TRANSLATIONS_PACK_ID, flagPath: TRANSLATION_FLAG_PATH, flagKey: "translation", read: readJournalTranslationFlag },
  { kind: "Actor", pack: ACTOR_TRANSLATIONS_PACK_ID, flagPath: ACTOR_TRANSLATION_FLAG_PATH, flagKey: "actorTranslation", read: readActorTranslationFlag },
  { kind: "Item", pack: ITEM_TRANSLATIONS_PACK_ID, flagPath: ITEM_TRANSLATION_FLAG_PATH, flagKey: "itemTranslation", read: readItemTranslationFlag },
] as const;
const displayKind = (kind: BundleDocumentKind): kind is DisplayDocumentKind => kind === "Scene" || kind === "ActiveEffect";
const specFor = (kind: BundleDocumentKind) => SPECS.find((s) => s.kind === kind)!;

function gmOnly(): void { if (!game.user?.isGM) throw new Error("Only a Game Master can manage translation bundles."); }
function isSource(value: FoundryUuidDocument | null, kind: BundleDocumentKind): value is PortableDocument {
  return !!value?.toObject && value.documentName === kind && (displayKind(kind) || !specFor(kind).read(value.flags));
}
async function sourceHash(kind: BundleDocumentKind, data: Record<string, unknown>): Promise<string> {
  if (displayKind(kind)) return displaySourceHash(kind, data);
  if (kind === "JournalEntry") return journalSourceHash(data as JournalData);
  if (kind === "Actor") return actorSourceHash(data as ActorData);
  return itemSourceHash(data as ItemData);
}

async function bundleFingerprint(kind: BundleDocumentKind, data: Record<string, unknown>): Promise<string> {
  return displayKind(kind) ? displaySourceHash(kind, data) : translatedOutputHash(data);
}

interface StoredTranslation { kind: BundleDocumentKind; document: FoundryJournalDocument; sourceUuid: string; targetLanguage: string }
async function storedIdentities(language: string): Promise<{ kind: BundleDocumentKind; sourceUuid: string; uuid: string }[]> {
  const result: { kind: BundleDocumentKind; sourceUuid: string; uuid: string }[] = [];
  for (const spec of SPECS) {
    const pack = game.packs.get(spec.pack);
    if (!pack) continue;
    for (const row of (await pack.getIndex({ fields: [spec.flagPath] })).values()) {
      const flag = spec.read(row.flags);
      if (flag?.targetLanguage === language) result.push({ kind: spec.kind, sourceUuid: flag.sourceUuid, uuid: `Compendium.${pack.collection}.${spec.kind}.${row._id}` });
    }
  }
  for (const stored of await storedDisplayTranslations(language)) {
    // A display translation never becomes a gameplay target.
    result.push({ kind: stored.kind, sourceUuid: stored.sourceUuid, uuid: stored.sourceUuid });
  }
  return result;
}
async function storedDisplayTranslations(language: string): Promise<StoredTranslation[]> {
  const pack = game.packs.get(DISPLAY_TEXT_PACK);
  if (!pack) return [];
  const result: StoredTranslation[] = [];
  for (const row of (await pack.getIndex({ fields: [`flags.${MODULE_ID}.displayTranslation`] })).values()) {
    const claim = row.flags?.[MODULE_ID]?.displayTranslation as { sourceUuid?: string; targetLanguage?: string } | undefined;
    if (claim?.targetLanguage !== language || !claim.sourceUuid) continue;
    // The repository checks duplicates and malformed claims before export/import can overwrite anything.
    const document = await new CompendiumDisplayTextRepository().find(claim.sourceUuid, language);
    const flag = document && readDisplayTextFlag(document.flags);
    if (document && flag) result.push({ kind: flag.documentType, document, sourceUuid: flag.sourceUuid, targetLanguage: language });
  }
  return result;
}
async function storedTranslations(language: string, onProgress?: (message: string) => void): Promise<StoredTranslation[]> {
  const result: StoredTranslation[] = [];
  for (const spec of SPECS) {
    const pack = game.packs.get(spec.pack);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: [spec.flagPath] });
    const rows = [...index.values()].filter((row) => spec.read(row.flags)?.targetLanguage === language);
    for (let start = 0; start < rows.length; start += 8) {
      onProgress?.(`${spec.kind}: ${start} / ${rows.length}`);
      const loaded = await Promise.all(rows.slice(start, start + 8).map(async (row) => {
        const document = await pack.getDocument(row._id);
        const flag = spec.read(row.flags)!;
        return document ? { kind: spec.kind, document, sourceUuid: flag.sourceUuid, targetLanguage: language } : null;
      }));
      for (const item of loaded) if (item) result.push(item);
    }
  }
  result.push(...await storedDisplayTranslations(language));
  return result;
}

/** Rewrite only recognized Foundry references, retaining embedded suffixes. */
export function remapBundleReferences<T>(value: T, roots: ReadonlyMap<string, string>, preserveEffectTargets = false): T {
  const keys = [...roots.keys()].sort((a, b) => b.length - a.length);
  const replacements = discoverObjectDependencies(value).flatMap(({ sourceUuid }) => {
    if (preserveEffectTargets && /\.ActiveEffect\.[^.]+(?:#.*)?$/u.test(sourceUuid)) return [];
    const root = keys.find((key) => sourceUuid === key || sourceUuid.startsWith(`${key}.`));
    return root ? [{ sourceUuid, translatedUuid: `${roots.get(root)}${sourceUuid.slice(root.length)}` }] : [];
  });
  return rewriteDocumentReferences(value, replacements);
}

export interface ExportResult { bundle: TranslationBundle; skipped: string[] }

/** Foundry may reorder embedded collections when a copy is saved. */
function translatedField(source: Record<string, unknown>, translated: Record<string, unknown>, path: HtmlFieldPath): unknown {
  const [collection, index] = path;
  if (typeof collection === "string" && ["pages", "items", "categories"].includes(collection) && typeof index === "number") {
    const originalRows = source[collection] as Record<string, unknown>[];
    const copyRows = translated[collection] as Record<string, unknown>[] | undefined;
    const original = originalRows[index];
    const id = original?._id ?? original?.id;
    if (id) {
      const copyIndex = copyRows?.findIndex((row) => (row._id ?? row.id) === id) ?? -1;
      if (copyIndex < 0) throw new Error(`translated ${collection} entry is missing: ${id}`);
      return readPath(translated, [collection, copyIndex, ...path.slice(2)]);
    }
  }
  return readPath(translated, path);
}

export async function exportTranslationBundle(language: string, onProgress?: (message: string) => void): Promise<ExportResult> {
  gmOnly();
  const stored = await storedTranslations(language, onProgress);
  const reverse = new Map(stored.flatMap((s) => s.document.uuid ? [[s.document.uuid, s.sourceUuid] as const] : []));
  const documents: BundleDocument[] = [];
  const skipped: string[] = [];
  for (const [index, item] of stored.entries()) {
    onProgress?.(`${index + 1} / ${stored.length}: ${item.document.name ?? item.sourceUuid}`);
    try {
      const source = await fromUuid(item.sourceUuid);
      if (!isSource(source, item.kind)) throw new Error("source is missing");
      const data = source.toObject();
      const flag = displayKind(item.kind) ? readDisplayTextFlag(item.document.flags)! : specFor(item.kind).read(item.document.flags)!;
      if (flag.sourceHash !== await sourceHash(item.kind, data)) throw new Error("source has changed since translation");
      const translated = displayKind(item.kind) ? item.document.toObject() : remapBundleReferences(item.document.toObject(), reverse);
      const displayFlag = displayKind(item.kind) ? readDisplayTextFlag(item.document.flags)! : null;
      const patches = portableFields(source, data).flatMap((field) => {
        const original = readPath(data, field.path);
        let translation: unknown;
        if (displayFlag) {
          const stable = [...field.path].map(String);
          if (typeof field.path[1] === "number") stable[1] = (data[field.path[0]!] as { _id: string }[])[field.path[1]]!._id;
          const metadata = displayFlag.fields.find(f => JSON.stringify(f.path) === JSON.stringify(stable));
          translation = metadata && readDisplayTranslation(translated as JournalData, metadata);
          if (typeof translation !== "string") throw new Error(`Invalid translated field: ${field.path.join(".")}`);
        } else translation = translatedField(data, translated, field.path);
        if (typeof original !== "string" || typeof translation !== "string" || original === translation) return [];
        assertPortableText(original, translation, field.format);
        return [{ ...field, source: original, translation }];
      });
      const journalFlag = item.kind === "JournalEntry" ? readJournalTranslationFlag(item.document.flags) : null;
      documents.push({ kind: item.kind, sourceUuid: source.uuid, sourceName: String(data.name), sourceFingerprint: await bundleFingerprint(item.kind, data), patches,
        partial: journalFlag?.partial ?? false, processedPageIds: journalFlag?.processedPageIds ?? [], fallbackTextSegments: flag.fallbackTextSegments,
        providerId: flag.providerId, sourceLanguage: flag.sourceLanguage, translatedAt: flag.translatedAt, engineRevision: flag.engineRevision });
    } catch (error) { skipped.push(`${item.document.name ?? item.sourceUuid}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const glossary = (await new GlossaryCompendiumRepository().loadExisting()).map(({ id: _id, sourceUuid: _uuid, ...entry }) => entry);
  const bundle: TranslationBundle = { format: BUNDLE_FORMAT, version: documents.some(d => displayKind(d.kind)) ? 3 : glossary.some(entry => entry.mode === "inflect") ? 2 : 1, createdAt: new Date().toISOString(), moduleVersion: MODULE_VERSION,
    systemId: game.system?.id ?? "unknown", systemVersion: game.system?.version ?? "", targetLanguage: language, glossary, documents };
  // The same validation applies to our own exports and third-party imports.
  return { bundle: parseTranslationBundle(JSON.stringify(bundle)), skipped };
}

export type ImportState = "ready" | "existing" | "missing" | "changed" | "invalid";
export interface ImportRow { entry: BundleDocument; state: ImportState; detail: string; sourceUuid?: string }
export interface BundleImportPlan { bundle: TranslationBundle; rows: ImportRow[]; glossary: GlossaryEntry[]; glossaryConflicts: string[] }

function glossaryMerge(stored: readonly GlossaryEntry[], incoming: readonly GlossaryEntry[]): { glossary: GlossaryEntry[]; glossaryConflicts: string[] } {
  const glossary: GlossaryEntry[] = [];
  const glossaryConflicts: string[] = [];
  for (const entry of incoming) {
    const existing = stored.find((s) => s.source.normalize("NFC").toLowerCase() === entry.source.normalize("NFC").toLowerCase());
    if (existing) {
      if (existing.replacement !== entry.replacement || (existing.enabled !== false) !== (entry.enabled !== false) || (existing.mode ?? "fixed") !== (entry.mode ?? "fixed") || JSON.stringify(existing.aliases) !== JSON.stringify(entry.aliases)) glossaryConflicts.push(entry.source);
      continue;
    }
    try { validateGlossary([...stored, ...glossary, entry]); glossary.push(entry); }
    catch { glossaryConflicts.push(entry.source); }
  }
  return { glossary, glossaryConflicts };
}

function validatePatches(entry: BundleDocument, source: PortableDocument): void {
  const data = source.toObject();
  if (displayKind(entry.kind) && (entry.engineRevision !== DISPLAY_TEXT_REVISION || entry.partial || entry.processedPageIds.length)) {
    throw new Error("Unsupported scene/effect translation revision or coverage.");
  }
  const allowed = new Map(portableFields(source, data).map((field) => [JSON.stringify(field.path), field.format]));
  if (entry.kind === "JournalEntry") {
    const ids = new Set((data as JournalData).pages.map((p) => p._id));
    if (entry.processedPageIds.some((id) => !ids.has(id))) throw new Error("Unknown translated page ID.");
  }
  for (const patch of entry.patches) {
    if (allowed.get(JSON.stringify(patch.path)) !== patch.format) throw new Error(`Field is not translatable: ${patch.path.join(".")}`);
    if (readPath(data, patch.path) !== patch.source) throw new Error(`Source field has changed: ${patch.path.join(".")}`);
    assertPortableText(patch.source, patch.translation, patch.format);
  }
}

export async function planBundleImport(bundle: TranslationBundle): Promise<BundleImportPlan> {
  gmOnly();
  if (bundle.systemId !== game.system?.id) throw new Error(`Bundle requires system ${bundle.systemId}; current system is ${game.system?.id}.`);
  const existing = await storedIdentities(bundle.targetLanguage);
  const rows: ImportRow[] = [];
  for (const entry of bundle.documents) {
    // Exact source UUIDs are intentional. Never fuzzy-match adventure names.
    const source = await fromUuid(entry.sourceUuid).catch(() => null);
    if (!isSource(source, entry.kind)) { rows.push({ entry, state: "missing", detail: "Source document is missing." }); continue; }
    if (await bundleFingerprint(entry.kind, source.toObject()) !== entry.sourceFingerprint) { rows.push({ entry, state: "changed", detail: "Source content differs from this bundle." }); continue; }
    try { validatePatches(entry, source); }
    catch (error) { rows.push({ entry, state: "invalid", detail: error instanceof Error ? error.message : String(error) }); continue; }
    const stored = existing.find((s) => s.kind === entry.kind && s.sourceUuid === source.uuid);
    rows.push({ entry, sourceUuid: source.uuid, state: stored ? "existing" : "ready", detail: stored ? "Existing translation will be kept." : "Ready to import." });
  }
  const merge = glossaryMerge(await new GlossaryCompendiumRepository().loadExisting(), bundle.glossary);
  return { bundle, rows, ...merge };
}

export interface ImportResult { imported: number; skipped: number; glossaryAdded: number; issues: string[] }
export async function importTranslationBundle(plan: BundleImportPlan, onProgress?: (message: string) => void): Promise<ImportResult> {
  gmOnly();
  // Re-plan immediately before writing: source documents and local edits may
  // have changed while the user reviewed the preview.
  const current = await planBundleImport(plan.bundle);
  const result: ImportResult = { imported: 0, skipped: current.rows.filter((r) => r.state !== "ready").length, glossaryAdded: 0, issues: [] };
  const repository = new GlossaryCompendiumRepository();
  if (current.glossary.length) { await repository.saveEntries(current.glossary); result.glossaryAdded = current.glossary.length; }
  const glossaryHash = await glossaryFingerprint(current.bundle.glossary);
  const journals = new CompendiumJournalTranslationRepository();
  const actors = new CompendiumActorTranslationRepository();
  const items = new CompendiumItemTranslationRepository();
  const save = (kind: BundleDocumentKind, data: Record<string, unknown>) => kind === "JournalEntry" ? journals.save(data as JournalData)
    : kind === "Actor" ? actors.save(data as ActorData) : items.save(data as ItemData);
  const created: { kind: BundleDocumentKind; data: Record<string, unknown>; uuid: string; sourceUuid: string }[] = [];
  for (const row of current.rows.filter((r) => r.state === "ready")) {
    const entry = row.entry;
    onProgress?.(`${result.imported + 1} / ${current.rows.filter((r) => r.state === "ready").length}: ${entry.sourceName}`);
    try {
      const source = await fromUuid(row.sourceUuid!);
      if (!isSource(source, entry.kind) || await bundleFingerprint(entry.kind, source.toObject()) !== entry.sourceFingerprint) throw new Error("Source changed during import.");
      if (displayKind(entry.kind) && isDisplayDocument(source)) {
        if (entry.engineRevision !== DISPLAY_TEXT_REVISION) throw new Error("Unsupported scene/effect translation revision.");
        const sourceData = source.toObject();
        const fields = displayFields(entry.kind, sourceData);
        const portable = portableFields(source, sourceData);
        const metadata = await Promise.all(fields.map(async field => ({ ...field, pageId: (await sha256(JSON.stringify(field.path))).slice(0, 16) })));
        const pages = metadata.map((field, index) => {
          const patch = entry.patches.find(p => JSON.stringify(p.path) === JSON.stringify(portable[index]!.path));
          const value = patch?.translation ?? field.source;
          return { _id: field.pageId, name: field.path.join(" / "), type: "text", text: { format: 1,
            content: field.format === "html" ? value : `<p>${escapeDisplayText(value)}</p>` } };
        });
        const data = await buildDisplayTextRecord({ kind: entry.kind, source: sourceData, sourceUuid: source.uuid,
          sourceLanguage: entry.sourceLanguage, targetLanguage: current.bundle.targetLanguage, providerId: entry.providerId,
          translatedAt: entry.translatedAt, fallbackTextSegments: entry.fallbackTextSegments,
          glossaryFingerprint: glossaryHash, providerFingerprint: "" }, pages, metadata);
        await new CompendiumDisplayTextRepository().save(data, null);
        Hooks.callAll("foundryTranslateDisplayTextChanged");
        result.imported += 1;
        continue;
      }
      const data = structuredClone(source.toObject());
      for (const patch of entry.patches) if (!writePath(data, patch.path, patch.translation)) throw new Error("Could not apply text field.");
      delete data._id;
      delete data._stats;
      const fieldCount = portableFields(source).filter((f) => f.format === "html").length;
      const flag = { schemaVersion: 1, engineRevision: entry.engineRevision, sourceUuid: source.uuid,
        sourceHash: await sourceHash(entry.kind, source.toObject()), providerId: entry.providerId, sourceLanguage: entry.sourceLanguage,
        targetLanguage: current.bundle.targetLanguage, translatedAt: entry.translatedAt, importedAt: new Date().toISOString(),
        glossaryFingerprint: glossaryHash, fallbackTextSegments: entry.fallbackTextSegments,
        ...(entry.kind === "JournalEntry" ? { partial: entry.partial, processedPageIds: entry.processedPageIds,
          translatedTextPages: entry.partial ? entry.processedPageIds.length : (data as JournalData).pages.length, skippedTextPages: 0 } : { translatedHtmlFields: fieldCount }),
        outputHash: await translatedOutputHash(data) };
      data.flags = { ...(data.flags as object), [MODULE_ID]: { [specFor(entry.kind).flagKey]: flag } };
      const document = await save(entry.kind, data);
      if (!document.uuid) throw new Error("Imported copy has no UUID.");
      created.push({ kind: entry.kind, data, uuid: document.uuid, sourceUuid: source.uuid });
      result.imported += 1;
    } catch (error) { result.issues.push(`${entry.sourceName}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // Two phases allow cycles A -> B -> A without exporting another user's
  // compendium IDs. All targets are known before any link is rewritten.
  const stored = await storedIdentities(current.bundle.targetLanguage);
  const forward = new Map(stored.map((s) => [s.sourceUuid, s.uuid]));
  for (const item of created) {
    try {
      const data = remapBundleReferences(item.data, forward, true);
      const flags = data.flags as Record<string, Record<string, Record<string, unknown>>>;
      // Remapping applies to prose; source metadata must always point at the original.
      const flag = flags[MODULE_ID]![specFor(item.kind).flagKey]!;
      flag.sourceUuid = item.sourceUuid;
      flag.outputHash = await translatedOutputHash(data);
      await save(item.kind, data);
    } catch (error) { result.issues.push(`${String(item.data.name)}: link repair: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return result;
}
