import { MODULE_ID } from "../constants";
import { assertPortableText } from "../bundles/format";
import { isProviderId, type ProviderId } from "../settings/settings";
import { sha256 } from "./hash";
import type { JournalData } from "./journal";
import type { TranslateItemOptions } from "./item";
import { translateDocumentNames } from "./document-names";
import { translateHtmlFields } from "./html-field-translation";

export const DISPLAY_TEXT_REVISION = 1;
export const DISPLAY_TEXT_PACK = "world.foundry-translate-display-text";
export type DisplayDocumentKind = "Scene" | "ActiveEffect";
export interface DisplayDocument extends FoundryJournalWorldDocument {
  documentName: DisplayDocumentKind;
}
export interface DisplayField {
  /** Collection members are addressed by embedded ID, never by array position. */
  path: string[];
  format: "text" | "html";
  source: string;
}
export interface DisplayTextFlag {
  schemaVersion: 1;
  engineRevision: number;
  sourceUuid: string;
  documentType: DisplayDocumentKind;
  sourceHash: string;
  targetLanguage: string;
  sourceLanguage: string;
  glossaryFingerprint: string;
  providerFingerprint: string;
  providerId: ProviderId;
  translatedAt: string;
  fallbackTextSegments: number;
  fields: (DisplayField & { pageId: string })[];
}

export function isDisplayDocument(document: FoundryUuidDocument): document is DisplayDocument {
  return ["Scene", "ActiveEffect"].includes(document.documentName ?? "") && typeof document.toObject === "function";
}

export function displayFields(kind: DisplayDocumentKind, source: Record<string, unknown>): DisplayField[] {
  const fields: DisplayField[] = [];
  const add = (path: string[], format: DisplayField["format"] = "text") => {
    const value = readDisplayField(source, path);
    if (typeof value === "string" && value.trim()) fields.push({ path, format, source: value });
  };
  add(["name"]);
  if (kind === "ActiveEffect") add(["description"], "html");
  else {
    add(["navName"]);
    for (const [collection, property] of [["drawings", "text"], ["notes", "text"], ["levels", "name"], ["regions", "name"]]) {
      const members = source[collection!];
      if (Array.isArray(members)) for (const member of members) {
        if (typeof member?._id === "string") add([collection!, member._id, property!]);
      }
    }
  }
  return fields;
}

export function readDisplayField(source: unknown, path: readonly string[]): unknown {
  let value = source;
  for (const part of path) {
    if (Array.isArray(value)) value = value.find(member => member?._id === part);
    else if (value && typeof value === "object" && Object.hasOwn(value, part)) value = (value as Record<string, unknown>)[part];
    else return undefined;
  }
  return value;
}

export async function displaySourceHash(kind: DisplayDocumentKind, source: Record<string, unknown>): Promise<string> {
  // Runtime state, positions, durations and rules are deliberately not translated or copied.
  return sha256(JSON.stringify({ kind, fields: displayFields(kind, source).sort((a, b) => JSON.stringify(a.path).localeCompare(JSON.stringify(b.path))) }));
}

export function isDisplayFieldPath(kind: DisplayDocumentKind, path: readonly string[], format: string): boolean {
  if (path.length === 1) return (path[0] === "name" && format === "text") ||
    (kind === "Scene" && path[0] === "navName" && format === "text") ||
    (kind === "ActiveEffect" && path[0] === "description" && format === "html");
  if (kind !== "Scene" || path.length !== 3 || format !== "text" || !/^[a-zA-Z0-9]{16}$/.test(path[1]!)) return false;
  return (["notes", "drawings"].includes(path[0]!) && path[2] === "text") ||
    (["levels", "regions"].includes(path[0]!) && path[2] === "name");
}

export function readDisplayTextFlag(flags: FoundryJournalDocument["flags"]): DisplayTextFlag | null {
  const flag = flags?.[MODULE_ID]?.displayTranslation as DisplayTextFlag | undefined;
  if (!flag || flag.schemaVersion !== 1 || flag.engineRevision !== DISPLAY_TEXT_REVISION ||
    !["Scene", "ActiveEffect"].includes(flag.documentType) || typeof flag.sourceUuid !== "string" ||
    typeof flag.sourceHash !== "string" || typeof flag.targetLanguage !== "string" ||
    !flag.sourceUuid.includes(`${flag.documentType}.`) || !flag.targetLanguage || !/^[a-f0-9]{64}$/.test(flag.sourceHash) ||
    !isProviderId(flag.providerId) || typeof flag.sourceLanguage !== "string" || typeof flag.translatedAt !== "string" ||
    typeof flag.glossaryFingerprint !== "string" || typeof flag.providerFingerprint !== "string" ||
    !Number.isSafeInteger(flag.fallbackTextSegments) || flag.fallbackTextSegments < 0 ||
    !Array.isArray(flag.fields) || flag.fields.length > 10000) return null;
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const field of flag.fields) {
    if (!field || !/^[a-zA-Z0-9]{16}$/.test(field.pageId) || ids.has(field.pageId) ||
      !Array.isArray(field.path) || field.path.some(p => typeof p !== "string" || ["__proto__", "prototype", "constructor"].includes(p)) ||
      !isDisplayFieldPath(flag.documentType, field.path, field.format) || typeof field.source !== "string" || paths.has(JSON.stringify(field.path))) return null;
    ids.add(field.pageId); paths.add(JSON.stringify(field.path));
  }
  return flag;
}

export function escapeDisplayText(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Read an editable text page, but never accept executable markup or altered UUIDs. */
export function readDisplayTranslation(data: JournalData, field: DisplayTextFlag["fields"][number]): string | null {
  const page = data.pages.find(p => p._id === field.pageId);
  const html = page?.text?.content;
  if (typeof html !== "string") return null;
  let text = html;
  if (field.format === "text") {
    const template = document.createElement("template");
    template.innerHTML = html;
    if (template.content.querySelectorAll("*").length !== 1 || template.content.firstElementChild?.tagName !== "P" ||
      template.content.firstElementChild.attributes.length) return null;
    if ([...template.content.childNodes].some(node => node !== template.content.firstElementChild && node.textContent?.trim())) return null;
    text = template.content.firstElementChild.textContent ?? "";
  }
  try { assertPortableText(field.source, text, field.format); } catch { return null; }
  return text.trim() ? text : null;
}

export async function translateDisplayText(options: Omit<TranslateItemOptions, "source" | "systemHtmlFieldPaths" | "onProgress"> & {
  source: Record<string, unknown>;
  kind: DisplayDocumentKind;
  glossaryHash: string;
  providerHash: string;
  onField?: (completed: number, total: number, field: string) => void;
}): Promise<JournalData> {
  const fields = displayFields(options.kind, options.source);
  const pages: JournalData["pages"] = [];
  const metadata: DisplayTextFlag["fields"] = [];
  let fallbacks = 0;
  for (const [index, field] of fields.entries()) {
    await options.beforeBatch?.();
    let translation: string;
    if (field.format === "text") {
      const result = await translateDocumentNames([field.source], options);
      translation = result.names[0]!;
      fallbacks += result.fallbacks;
    } else {
      const owner = { description: field.source };
      const result = await translateHtmlFields({ ...options, targets: [{ owner, path: ["description"] }],
        documentTitle: String(options.source.name), documentLabel: options.kind });
      translation = owner.description;
      fallbacks += result.fallbackTextSegments;
    }
    // A deterministic page ID keeps manual review and references stable across runs.
    const pageId = (await sha256(JSON.stringify(field.path))).slice(0, 16);
    metadata.push({ ...field, pageId });
    pages.push({ _id: pageId, name: field.path.join(" / "), type: "text",
      text: { format: 1, content: field.format === "html" ? translation : `<p>${escapeDisplayText(translation)}</p>` } });
    options.onField?.(index + 1, fields.length, field.path.join(" / "));
  }
  return buildDisplayTextRecord({
    kind: options.kind, source: options.source, sourceUuid: options.sourceUuid,
    sourceLanguage: options.settings.sourceLanguage, targetLanguage: options.settings.targetLanguage,
    glossaryFingerprint: options.glossaryHash, providerFingerprint: options.providerHash,
    providerId: options.settings.providerId, translatedAt: new Date().toISOString(), fallbackTextSegments: fallbacks,
  }, pages, metadata);
}

export async function buildDisplayTextRecord(
  options: Omit<DisplayTextFlag, "schemaVersion" | "engineRevision" | "sourceHash" | "documentType" | "fields"> &
    { kind: DisplayDocumentKind; source: Record<string, unknown> },
  pages: JournalData["pages"], fields: DisplayTextFlag["fields"],
): Promise<JournalData> {
  const { kind, source, ...provenance } = options;
  const flag: DisplayTextFlag = {
    ...provenance, schemaVersion: 1, engineRevision: DISPLAY_TEXT_REVISION, documentType: kind,
    sourceHash: await displaySourceHash(kind, source), fields,
  };
  const data: JournalData = { name: String(source.name), pages,
    flags: { [MODULE_ID]: { displayTranslation: flag } } };
  const name = fields.find(f => f.path.length === 1 && f.path[0] === "name");
  if (name) data.name = readDisplayTranslation(data, name) ?? data.name;
  return data;
}
