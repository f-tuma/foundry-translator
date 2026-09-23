import { MODULE_ID } from "../constants";
import { translatedOutputHash } from "./output-hash";
import { readPath, writePath, type HtmlFieldPath } from "./system-html-fields";

/** A receipt for editor-only changes. An unrelated edit invalidates the receipt;
 * saving a correction must never bless unknown changes elsewhere in the copy. */
export interface EditorProtection {
  version: 1; sourceHash: string; generatedHash: string; outputHash: string;
  fields: Record<string, { path: HtmlFieldPath; value: string }>;
  rows: Record<string, string>;
}
type Data = Record<string, unknown>;
function namespace(data: Data): Record<string, unknown> {
  return (data.flags as Record<string, Record<string, unknown>> | undefined)?.[MODULE_ID] ?? {};
}
export function readEditorProtection(data: Data): EditorProtection | null {
  const value = namespace(data).editorProtection as EditorProtection | undefined;
  if (value?.version !== 1 || typeof value.sourceHash !== "string" || typeof value.generatedHash !== "string" || typeof value.outputHash !== "string"
    || !value.fields || typeof value.fields !== "object" || !value.rows || typeof value.rows !== "object") return null;
  if (!Object.values(value.rows).every(value => typeof value === "string")) return null;
  for (const field of Object.values(value.fields)) {
    if (!field || typeof field.value !== "string" || !Array.isArray(field.path) || !field.path.length || field.path.length > 30
      || field.path.some(key => !(typeof key === "string" || Number.isInteger(key)) || ["__proto__", "prototype", "constructor"].includes(String(key)))) return null;
  }
  return value;
}
function resolvedPath(data: Data, stable: HtmlFieldPath): HtmlFieldPath {
  const path = [...stable];
  if (["pages", "items", "categories"].includes(String(path[0])) && typeof path[1] === "string") {
    const collection = data[path[0]!] as Data[] | undefined;
    path[1] = collection?.findIndex(row => (row._id ?? row.id) === stable[1]) ?? -1;
  }
  return path;
}
export async function isEditorProtected(data: Data, sourceHash: string, generatedHash: string | undefined): Promise<boolean> {
  const saved = readEditorProtection(data);
  return !!saved && saved.sourceHash === sourceHash && saved.generatedHash === generatedHash
    && Object.keys(saved.fields).length > 0 && Object.keys(saved.rows).length > 0
    && Object.values(saved.fields).every(field => readPath(data, resolvedPath(data, field.path)) === field.value)
    && saved.outputHash === await translatedOutputHash(data);
}
export async function recordEditorProtection(before: Data, after: Data, sourceHash: string, generatedHash: string | undefined,
  fields: { id: string; path: HtmlFieldPath; value: string }[], rows: Record<string, string>): Promise<EditorProtection | null> {
  if (!generatedHash) return null;
  const previous = readEditorProtection(before);
  const tracked = await isEditorProtected(before, sourceHash, generatedHash);
  if (!tracked && (namespace(before).editorProtection || await translatedOutputHash(before) !== generatedHash)) return null;
  const saved: EditorProtection = tracked ? structuredClone(previous!)
    : { version: 1, sourceHash, generatedHash, outputHash: "", fields: {}, rows: {} };
  for (const field of fields) saved.fields[field.id] = { path: field.path, value: field.value };
  Object.assign(saved.rows, rows);
  saved.outputHash = await translatedOutputHash(after);
  return saved;
}
/** Preserve corrected fields byte-for-byte. Journal continuation skips completed
 * pages; only new pages are generated. Root names/categories need this overlay. */
export function preserveEditorContent(data: Data, previous: Data): void {
  const saved = readEditorProtection(previous);
  if (!saved) return;
  for (const field of Object.values(saved.fields)) {
    if (!writePath(data, resolvedPath(data, field.path), field.value)) throw new Error("Review.Conflict");
  }
  // Output hashes intentionally exclude root bookkeeping/flags. Preserve those
  // from the saved copy, rather than replacing custom permissions or module state
  // with the source's values when continuing a book.
  const translation = namespace(data).translation;
  data.flags = structuredClone(previous.flags ?? {});
  const flags = data.flags as Record<string, Record<string, unknown>>;
  flags[MODULE_ID] = { ...namespace(data), translation };
  for (const key of ["ownership", "folder", "sort"]) {
    if (Object.hasOwn(previous, key)) data[key] = structuredClone(previous[key]);
  }
}
/** Called only after preserving a validated receipt in generated data. */
export function restampEditorProtection(data: Data, generatedHash: string): void {
  const saved = readEditorProtection(data);
  if (saved) { saved.generatedHash = generatedHash; saved.outputHash = generatedHash; }
}
/** While paused, accept only editor changes against our last saved checkpoint. */
export async function isEditorOnlyUpdate(before: Data, after: Data, sourceHash: string, generatedHash: string | undefined): Promise<boolean> {
  if (!await isEditorProtected(after, sourceHash, generatedHash)) return false;
  const restored = structuredClone(after), original = structuredClone(before);
  for (const field of Object.values(readEditorProtection(after)!.fields)) {
    const value = readPath(before, resolvedPath(before, field.path));
    if (typeof value !== "string" || !writePath(restored, resolvedPath(restored, field.path), value)) return false;
  }
  for (const data of [original, restored]) for (const key of ["editorProtection", "review", "reviewHistory"]) delete namespace(data)[key];
  return await translatedOutputHash({ document: original }) === await translatedOutputHash({ document: restored });
}
