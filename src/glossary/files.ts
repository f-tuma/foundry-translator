import { parseTranslationBundle } from "../bundles/format";
import { isGlossaryCategory, isGlossaryMode, type GlossaryEntry } from "./types";
import { validateGlossary } from "./protection";

export const GLOSSARY_FILE_FORMAT = "foundry-translate-glossary";
export const MAX_GLOSSARY_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 20000;
export interface GlossaryFile { language: string; entries: GlossaryEntry[] }
export interface GlossaryImportRow {
  key: string;
  state: "new" | "changed" | "unchanged";
  before?: GlossaryEntry;
  after: GlossaryEntry;
}
export const glossaryEntryKey = (source: string) => source.normalize("NFC").trim().toLowerCase();
const fail = (key: string, detail = ""): never => { throw new Error(`${game.i18n.localize(`FOUNDRY_TRANSLATE.Glossary.Files.${key}`)}${detail ? `: ${detail}` : ""}`); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function field(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string" || value.length > max || /\u0000/u.test(value)) return fail("InvalidFields");
  const text = value.normalize("NFC").trim();
  if (!multiline && (/[<>\r\n\t]/u.test(text) || /__FT[NGS]_|@(?:UUID|Embed)\[|\[\[/iu.test(text))) return fail("InvalidFields");
  return text;
}

/** Portable fields only; IDs, provenance, commands and source documents are never imported. */
function readEntry(value: unknown): GlossaryEntry {
  if (!object(value) || !isGlossaryCategory(value.category)) return fail("InvalidFields");
  const source = field(value.source, 240);
  const replacement = field(value.replacement, 240) || source;
  if (!source || (value.enabled !== undefined && typeof value.enabled !== "boolean")) return fail("InvalidFields");
  if (value.mode !== undefined && !isGlossaryMode(value.mode)) return fail("InvalidFields");
  const rawAliases = value.aliases ?? [];
  if (!Array.isArray(rawAliases) || rawAliases.length > 100) return fail("InvalidFields");
  const aliases = [...new Set(rawAliases.map((alias) => field(alias, 240)).filter(Boolean))];
  return { source, replacement, category: value.category, aliases, enabled: value.enabled !== false,
    ...(value.mode === "inflect" ? { mode: "inflect" as const } : {}),
    notes: field(value.notes ?? "", 2000, true), customized: true };
}

export function validateGlossaryFileEntries(entries: readonly GlossaryEntry[]): void {
  const sources = new Set<string>();
  const terms = new Map<string, string>();
  for (const entry of entries) {
    const key = glossaryEntryKey(entry.source);
    if (sources.has(key)) fail("Duplicate", entry.source);
    sources.add(key);
    if (entry.enabled === false) continue;
    for (const term of [entry.source, ...entry.aliases]) {
      const normalized = glossaryEntryKey(term);
      const behavior = JSON.stringify([entry.replacement, entry.mode ?? "fixed"]);
      if (terms.has(normalized) && terms.get(normalized) !== behavior) fail("AliasConflict", term);
      terms.set(normalized, behavior);
    }
  }
  validateGlossary(entries);
}

/** Strict RFC-style quoted cells, including embedded delimiters/newlines and CRLF. */
function readCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? "";
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const endCell = () => { row.push(cell); cell = ""; closed = false; };
  const endRow = () => { endCell(); if (row.some((value) => value !== "")) rows.push(row); row = []; if (rows.length > MAX_ENTRIES + 1) fail("TooLarge"); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === delimiter) endCell();
    else if (c === "\r" || c === "\n") { if (c === "\r" && text[i + 1] === "\n") i++; endRow(); }
    else if (c === '"' && !cell && !closed) quoted = true;
    else if (closed || c === '"') fail("InvalidCsv");
    else cell += c;
  }
  if (quoted) fail("InvalidCsv");
  if (cell || row.length || closed) endRow();
  return rows;
}

// Escape spreadsheet formulas without losing an original leading apostrophe.
const formula = /^[\s]*[=+\-@\t\r]/u;
const csvCell = (value: string) => `"${(formula.test(value) || value.startsWith("'") ? `'${value}` : value).replaceAll('"', '""')}"`;
const unescapeCell = (value: string) => value.startsWith("'") && (value[1] === "'" || formula.test(value.slice(1))) ? value.slice(1) : value;
const columns = ["source", "replacement", "category", "aliases", "enabled", "notes", "context", "language", "mode"];

export function parseGlossaryFile(raw: string, format: "json" | "csv", fallbackLanguage: string): GlossaryFile {
  if (new TextEncoder().encode(raw).length > MAX_GLOSSARY_BYTES) fail("TooLarge");
  const text = raw.replace(/^\uFEFF/u, "");
  let language = fallbackLanguage, values: unknown[];
  if (format === "json") {
    let data: unknown;
    try { data = JSON.parse(text); } catch { return fail("InvalidJson"); }
    if (object(data) && data.format === "foundry-translate-bundle") {
      const bundle = parseTranslationBundle(text);
      language = bundle.targetLanguage; values = bundle.glossary;
    } else {
      if (!object(data) || data.format !== GLOSSARY_FILE_FORMAT || (data.version !== 1 && data.version !== 2) || !Array.isArray(data.entries) || typeof data.targetLanguage !== "string") return fail("InvalidJson");
      language = data.targetLanguage; values = data.entries;
    }
  } else {
    const rows = readCsv(text);
    const header = (rows.shift() ?? []).map((cell) => cell.trim());
    if (!["source", "replacement", "category"].every((name) => header.includes(name)) || new Set(header).size !== header.length || header.some((name) => !columns.includes(name))) return fail("InvalidHeader");
    const languages = new Set<string>();
    values = rows.map((row, index) => {
      if (row.length !== header.length) return fail("InvalidCsv", String(index + 2));
      const data = Object.fromEntries(header.map((key, i) => [key, unescapeCell(row[i] ?? "")]));
      if (data.language?.trim()) languages.add(data.language.trim());
      if (data.enabled && !["true", "false"].includes(data.enabled)) return fail("InvalidFields", String(index + 2));
      let aliases: unknown = [];
      if (data.aliases?.trim()) { try { aliases = JSON.parse(data.aliases); } catch { return fail("InvalidAliases", String(index + 2)); } }
      return { ...data, aliases, enabled: data.enabled !== "false", mode: data.mode || undefined };
    });
    if (languages.size > 1) return fail("LanguageMismatch");
    language = [...languages][0] ?? fallbackLanguage;
  }
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(language)) return fail("LanguageMismatch");
  if (values.length > MAX_ENTRIES) return fail("TooLarge");
  const entries = values.map(readEntry);
  validateGlossaryFileEntries(entries);
  return { language, entries };
}

export function serializeGlossaryFile(entries: readonly GlossaryEntry[], language: string, format: "json" | "csv", contexts = new Map<string, string>()): string {
  const portable = [...entries].sort((a, b) => a.source.localeCompare(b.source)).map((entry) => ({
    source: entry.source, replacement: entry.replacement, category: entry.category, aliases: entry.aliases,
    enabled: entry.enabled !== false, notes: entry.notes ?? "", context: contexts.get(entry.source) ?? "",
    mode: entry.mode ?? "fixed",
  }));
  if (format === "json") return JSON.stringify({ format: GLOSSARY_FILE_FORMAT, version: entries.some(entry => entry.mode === "inflect") ? 2 : 1, targetLanguage: language, entries: portable }, null, 2);
  return "\uFEFF" + [columns.map(csvCell).join(","), ...portable.map((entry) => [entry.source, entry.replacement, entry.category,
    JSON.stringify(entry.aliases), String(entry.enabled), entry.notes, entry.context, language, entry.mode].map(csvCell).join(","))].join("\r\n") + "\r\n";
}

export function entryFingerprint(entry: GlossaryEntry | undefined): string {
  return entry ? JSON.stringify([entry.id, entry.sourceUuid, entry.source, entry.replacement, entry.category, entry.aliases, entry.enabled !== false, entry.mode ?? "fixed", entry.notes ?? "", entry.customized === true]) : "missing";
}

export function planGlossaryImport(stored: readonly GlossaryEntry[], file: GlossaryFile, language: string): GlossaryImportRow[] {
  if (file.language.toLowerCase() !== language.toLowerCase()) return fail("LanguageMismatch");
  validateGlossaryFileEntries(stored);
  const bySource = new Map(stored.map((entry) => [glossaryEntryKey(entry.source), entry]));
  return file.entries.map((entry) => {
    const key = glossaryEntryKey(entry.source), before = bySource.get(key);
    const after: GlossaryEntry = { ...entry, source: before?.source ?? entry.source,
      ...(before?.id ? { id: before.id } : {}), ...(before?.sourceUuid ? { sourceUuid: before.sourceUuid } : {}), customized: true };
    const state = !before ? "new" : entryFingerprint(before) === entryFingerprint(after) ? "unchanged" : "changed";
    return { key, state, ...(before ? { before } : {}), after };
  });
}

export function validateSelectedImport(stored: readonly GlossaryEntry[], selected: readonly GlossaryImportRow[]): void {
  const keys = new Set(selected.map((row) => row.key));
  validateGlossaryFileEntries([...stored.filter((entry) => !keys.has(glossaryEntryKey(entry.source))), ...selected.map((row) => row.after)]);
}
