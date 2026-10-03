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
