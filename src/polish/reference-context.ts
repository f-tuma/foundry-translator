import { portableFields, type PortableDocument, type PortableField } from "../bundles/fields";
import { absoluteReference } from "../bundles/reference-notation";
import { discoverDocumentDependencies } from "../translation/document-dependencies";
import { parseDocumentReference, translationIdentity, TRANSLATION_IDENTITIES } from "../translation/document-identity";
import { discoverEmberTextFieldPaths, discoverSystemHtmlFieldPaths, readPath } from "../translation/system-html-fields";
import type { ReviewField, ReviewRow, ReviewSnapshot } from "../review/service";

/** An index into the freshly loaded source paragraph, never a caller's UUID. */
export function sourceReferences(snapshot: ReviewSnapshot, field: ReviewField, row: ReviewRow) {
  const context = field.referenceContext ?? snapshot.entry.sourceUuid;
  const uuids = [...new Set(discoverDocumentDependencies(row.source.join("\n")).map(ref => absoluteReference(ref.sourceUuid, context)).filter((uuid): uuid is string => !!uuid))];
  return uuids.map((sourceUuid, index) => ({ index, sourceUuid }));
}

/** Read prose from an exact original referenced by the source. No flags, rules,
 * scripts, behaviors, arbitrary paths or reads of unrelated documents. */
export async function readSourceReferenceContext(snapshot: ReviewSnapshot, field: ReviewField, row: ReviewRow, index: number, offset: number, limit: number) {
  const reference = sourceReferences(snapshot, field, row)[index];
  const ref = reference && parseDocumentReference(reference.sourceUuid);
  if (!reference || !ref) throw new Error("Live.ReferenceUnavailable");
  const root = await fromUuid(ref.root);
  if (!root || root.uuid !== ref.root || root.documentName !== ref.type || translationIdentity(root, ref.type) ||
    TRANSLATION_IDENTITIES.some(spec => ref.root.startsWith(`Compendium.${spec.pack}.`))) throw new Error("Live.ReferenceUnavailable");
  const target = ref.suffix ? await fromUuid(`${ref.root}${ref.suffix}`) : root;
  if (!target || target.uuid !== `${ref.root}${ref.suffix}` || !target.toObject || !["Actor", "Item", "JournalEntry", "JournalEntryPage"].includes(target.documentName ?? "")) throw new Error("Live.ReferenceUnavailable");
  const data = target.toObject();
  let fields: PortableField[];
  if (target.documentName === "JournalEntryPage") {
    const runtime = target as FoundryUuidDocument & { system?: FoundryRuntimeSystem };
    fields = [{ path: ["name"], format: "text" }];
    if (typeof readPath(data, ["text", "content"]) === "string") fields.push({ path: ["text", "content"], format: "html" });
    if (typeof readPath(data, ["text", "markdown"]) === "string") fields.push({ path: ["text", "markdown"], format: "markdown" });
    fields.push(...discoverSystemHtmlFieldPaths(runtime.system?.constructor?.schema?.fields, data.system).map(path => ({ path: ["system", ...path], format: "html" as const })));
    fields.push(...discoverEmberTextFieldPaths(String(data.type ?? ""), runtime.system?.constructor?.schema?.fields, data.system).map(path => ({ path: ["system", ...path], format: "text" as const })));
  } else fields = portableFields(target as PortableDocument, data);
  const prose = fields.map(f => ({ path: f.path, format: f.format, text: readPath(data, f.path) })).filter(f => typeof f.text === "string" && f.text.trim());
  const value = { sourceUuid: target.uuid, kind: target.documentName, name: typeof data.name === "string" ? data.name : "",
    total: prose.length, fields: prose.slice(offset, offset + limit), nextOffset: offset + limit < prose.length ? offset + limit : null };
  if (new TextEncoder().encode(JSON.stringify(value)).length > 500000) throw new Error("Live.ContextTooLarge");
  return value;
}

/** Sanitized metadata only. Null means unattempted or not established, never absent. */
interface SourceReferenceProbeMetadata {
  lookupAttempted: boolean;
  lookupThrew: boolean;
  resolved: boolean | null;
  metadataReadThrew: boolean;
  uuidMatches: boolean | null;
  supportedKind: boolean | null;
  expectedKindMatches: boolean | null;
  toObjectCallable: boolean | null;
  toObjectAttempted: boolean;
  toObjectSucceeded: boolean | null;
  serializedRecord: boolean | null;
}
function emptyReferenceProbe(): SourceReferenceProbeMetadata {
  return { lookupAttempted: false, lookupThrew: false, resolved: null, metadataReadThrew: false,
    uuidMatches: null, supportedKind: null, expectedKindMatches: null, toObjectCallable: null,
    toObjectAttempted: false, toObjectSucceeded: null, serializedRecord: null };
}
type ProbeDocument = { uuid?: unknown; documentName?: unknown; toObject?: unknown; getEmbeddedDocument?: unknown };
function referenceProbeMetadata(document: unknown, uuid: string, kind: string, result: SourceReferenceProbeMetadata) {
  result.resolved = !!document;
  if (!document) return;
  try {
    const target = document as ProbeDocument;
    result.uuidMatches = target.uuid === uuid;
    result.supportedKind = ["Actor", "Item", "JournalEntry", "JournalEntryPage"].includes(String(target.documentName ?? ""));
    result.expectedKindMatches = target.documentName === kind;
    result.toObjectCallable = typeof target.toObject === "function";
    // A mismatched object cannot authorize any further serialized read.
    if (!result.uuidMatches || !result.supportedKind || !result.expectedKindMatches || !result.toObjectCallable) return;
    result.toObjectAttempted = true;
    try {
      const data: unknown = (target.toObject as () => unknown).call(document);
      result.toObjectSucceeded = true;
      result.serializedRecord = !!data && typeof data === "object" && !Array.isArray(data);
    } catch { result.toObjectSucceeded = false; }
  } catch { result.metadataReadThrew = true; }
}

/** Future caller must use the same paired/GM/language/catalog/snapshot checks as
 * get_reference_context and recheck scope after awaiting. This helper has no API
 * UUID/path parameter, no prose/flags return, no replacement or write authority.
 * Existing readSourceReferenceContext behavior is unchanged. */
type DiagnosticHooks = { resolve: typeof fromUuid; embedded: (parent: unknown, kind: string, id: string) => Promise<unknown> };
export async function diagnoseSourceReferenceContext(snapshot: ReviewSnapshot, field: ReviewField, row: ReviewRow, index: number, hooks?: DiagnosticHooks) {
  const result = { version: 1, referenceIndex: Number.isSafeInteger(index) ? index : null,
    predicate: "reference-unavailable", suffixShape: "unestablished",
    root: { ...emptyReferenceProbe(), originalIdentityAllowed: null as boolean | null },
    target: emptyReferenceProbe(),
    parentSerialized: { toObjectCallable: null as boolean | null, toObjectAttempted: false,
      toObjectSucceeded: null as boolean | null, serializedRecord: null as boolean | null,
      expectedCollectionIsArray: null as boolean | null, expectedChildIdPresent: null as boolean | null },
    embedded: { methodCallable: null as boolean | null, ...emptyReferenceProbe() } };
  if (!Number.isSafeInteger(index) || index < 0 || index > 1000 || !snapshot.fields.includes(field) ||
    !snapshot.rows.includes(row) || row.fieldId !== field.id) return result;
  const reference = sourceReferences(snapshot, field, row)[index], ref = reference && parseDocumentReference(reference.sourceUuid);
  if (!reference || !ref) return result;
  const child = /^\.(Item|JournalEntryPage)\.([A-Za-z0-9_-]+)$/u.exec(ref.suffix);
  const supportedChild = !!child && ((ref.type === "Actor" && child[1] === "Item") ||
    (ref.type === "JournalEntry" && child[1] === "JournalEntryPage"));
  result.suffixShape = !ref.suffix ? "none" : supportedChild ? "one-supported-child" : "unsupported";
  if (ref.suffix && !supportedChild) { result.predicate = "unsupported-suffix"; return result; }
  if (TRANSLATION_IDENTITIES.some(spec => ref.root.startsWith(`Compendium.${spec.pack}.`))) {
    result.root.originalIdentityAllowed = false; result.predicate = "translated-pack-forbidden"; return result;
  }
  result.root.lookupAttempted = true;
  let root: FoundryUuidDocument | null | undefined;
  try { root = await (hooks?.resolve ?? fromUuid)(ref.root); }
  catch { result.root.lookupThrew = true; result.predicate = "root-resolver-threw"; return result; }
  result.root.resolved = !!root;
  if (!root) { result.predicate = "root-unresolved"; return result; }
  try {
    result.root.uuidMatches = root.uuid === ref.root;
    result.root.supportedKind = ["Actor", "Item", "JournalEntry"].includes(root.documentName ?? "");
    result.root.expectedKindMatches = root.documentName === ref.type;
    if (!result.root.uuidMatches) { result.predicate = "root-uuid-mismatch"; return result; }
    if (!result.root.expectedKindMatches) { result.predicate = "root-kind-mismatch"; return result; }
    result.root.originalIdentityAllowed = !translationIdentity(root, ref.type);
    if (!result.root.originalIdentityAllowed) { result.predicate = "translated-root-forbidden"; return result; }
  } catch { result.root.metadataReadThrew = true; result.predicate = "root-metadata-threw"; return result; }
  if (!ref.suffix) {
    result.target.lookupAttempted = false;
    referenceProbeMetadata(root, ref.root, ref.type, result.target);
    result.predicate = "root-metadata-reported"; return result;
  }
  const expectedUuid = `${ref.root}${ref.suffix}`, childKind = child![1]!, childId = child![2]!;
  // Only fixed collections and exact ID equality are inspected, never prose,
  // names or another child's metadata. Missing serialization is not absence.
  try {
    const target = root as FoundryUuidDocument & ProbeDocument;
    const serialize = target.toObject;
    result.parentSerialized.toObjectCallable = typeof serialize === "function";
    if (typeof serialize === "function") {
      result.parentSerialized.toObjectAttempted = true;
      try {
        const data: unknown = serialize.call(root);
        result.parentSerialized.toObjectSucceeded = true;
        result.parentSerialized.serializedRecord = !!data && typeof data === "object" && !Array.isArray(data);
        if (result.parentSerialized.serializedRecord) {
          const key = childKind === "Item" ? "items" : "pages";
          const values = Object.getOwnPropertyDescriptor(data, key)?.value as unknown;
          result.parentSerialized.expectedCollectionIsArray = Array.isArray(values);
          if (Array.isArray(values)) result.parentSerialized.expectedChildIdPresent = values.some(value =>
            !!value && typeof value === "object" && (Object.getOwnPropertyDescriptor(value, "_id")?.value === childId ||
              Object.getOwnPropertyDescriptor(value, "id")?.value === childId));
        }
      } catch { result.parentSerialized.toObjectSucceeded = false; }
    }
  } catch { result.parentSerialized.toObjectCallable = null; }
  try {
    const parent = root as FoundryUuidDocument & ProbeDocument;
    result.embedded.methodCallable = typeof parent.getEmbeddedDocument === "function";
    if (result.embedded.methodCallable) {
      result.embedded.lookupAttempted = true;
      try {
        const embedded: unknown = await (hooks ? hooks.embedded(root, childKind, childId) : (parent.getEmbeddedDocument as (kind: string, id: string) => unknown).call(root, childKind, childId));
        referenceProbeMetadata(embedded, expectedUuid, childKind, result.embedded);
      } catch { result.embedded.lookupThrew = true; }
    }
  } catch { result.embedded.methodCallable = null; }
  result.target.lookupAttempted = true;
  try {
    const target = await (hooks?.resolve ?? fromUuid)(expectedUuid);
    referenceProbeMetadata(target, expectedUuid, childKind, result.target);
  } catch { result.target.lookupThrew = true; }
  // Cues remain independent. Embedded presence never substitutes for fromUuid,
  // and neither metadata path establishes replacement identity or deletion.
  result.predicate = "source-child-metadata-reported";
  return result;
}

/** Internal-only repeat-observation binder. Exact source-derived lookups are
 * supplied by the helper above. Neither the stamps nor recheck closure are
 * serializable route output; no target body or identity is returned.
 * This is change detection across observations, not atomic server CAS. */
export async function diagnoseSourceReferenceContextBound(snapshot: ReviewSnapshot, field: ReviewField, row: ReviewRow, index: number) {
  type Observation = { read: () => Promise<unknown>; stamp: string; document: unknown; uuid: string; kind: string };
  const selectedReference = sourceReferences(snapshot, field, row)[index];
  const selectedRoot = selectedReference && parseDocumentReference(selectedReference.sourceUuid)?.root;
  const observations: Observation[] = [];
  let boundFailure = false;
  const stamp = (document: unknown, uuid: string, kind: string): string => {
    if (!document) return "unresolved";
    try {
      const target = document as ProbeDocument;
      const matches = target.uuid === uuid && target.documentName === kind;
      if (!matches) return JSON.stringify(["mismatch", target.uuid === uuid, target.documentName === kind]);
      if (["Actor", "Item", "JournalEntry"].includes(kind) && translationIdentity(document as FoundryUuidDocument, kind as "Actor" | "Item" | "JournalEntry")) return "translated-root-forbidden";
      const callable = typeof target.toObject === "function";
      if (!callable) return "matched-no-serializer";
      try {
        const body = JSON.stringify((target.toObject as () => unknown).call(document));
        // Internal raw evidence is bounded and never put in the response.
        if (body !== undefined && body.length > 2000000) throw new Error("Live.ContextTooLarge");
        return JSON.stringify(["matched", typeof target.getEmbeddedDocument === "function", body ?? null]);
      } catch (error) {
        if (error instanceof Error && error.message === "Live.ContextTooLarge") throw error;
        return "matched-serialization-unavailable";
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Live.ContextTooLarge") throw error;
      return "metadata-unavailable";
    }
  };
  const observe = async (read: () => Promise<unknown>, uuid: string, kind: string) => {
    let document: unknown;
    try { document = await read(); }
    catch {
      observations.push({ read, stamp: "lookup-threw", document: null, uuid, kind });
      throw new Error("Live.ReferenceUnavailable");
    }
    try { observations.push({ read, stamp: stamp(document, uuid, kind), document, uuid, kind }); }
    catch { boundFailure = true; throw new Error("Live.ContextTooLarge"); }
    return document;
  };
  const hooks: DiagnosticHooks = {
    resolve: async uuid => {
      const ref = parseDocumentReference(uuid)!;
      const kind = ref.suffix ? /\.(Item|JournalEntryPage)\.[^.]+$/u.exec(ref.suffix)![1]! : ref.type;
      return await observe(() => fromUuid(uuid), uuid, kind) as FoundryUuidDocument | null;
    },
    embedded: async (parent, kind, id) => {
      const object = parent as ProbeDocument;
      const uuid = `${selectedRoot!}.${kind}.${id}`;
      return observe(async () => {
        if (typeof object.getEmbeddedDocument !== "function") return null;
        return (object.getEmbeddedDocument as (kind: string, id: string) => unknown).call(parent, kind, id);
      }, uuid, kind);
    },
  };
  const diagnostic = await diagnoseSourceReferenceContext(snapshot, field, row, index, hooks);
  if (boundFailure) throw new Error("Live.ContextTooLarge");
  const lastDocuments: { document: unknown; observation: Observation }[] = [];
  const assertUnchanged = () => {
    for (const { document, observation } of lastDocuments) if (stamp(document, observation.uuid, observation.kind) !== observation.stamp || stamp(observation.document, observation.uuid, observation.kind) !== observation.stamp) throw new Error("Review.Conflict");
  };
  return { diagnostic, assertUnchanged, recheck: async () => {
    const latest: { document: unknown; observation: Observation }[] = [];
    for (const observation of observations) {
      let document: unknown;
      try { document = await observation.read(); }
      catch {
        if (observation.stamp !== "lookup-threw") throw new Error("Review.Conflict");
        continue;
      }
      if (observation.stamp === "lookup-threw" || stamp(document, observation.uuid, observation.kind) !== observation.stamp) throw new Error("Review.Conflict");
      latest.push({ document, observation });
    }
    lastDocuments.splice(0, lastDocuments.length, ...latest);
    // Final synchronous checks also detect mutation while a later lookup awaited.
    for (const { document, observation } of latest) {
      if (stamp(document, observation.uuid, observation.kind) !== observation.stamp ||
          stamp(observation.document, observation.uuid, observation.kind) !== observation.stamp) throw new Error("Review.Conflict");
    }
  } };
}
