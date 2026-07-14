import type { JournalData } from "./journal";

export type DocumentReferenceKind = "uuid" | "embed" | "data-uuid";

export interface DocumentDependency {
  sourceUuid: string;
  kind: DocumentReferenceKind;
  fieldPath: readonly (string | number)[];
}

export interface DocumentReferenceReplacement {
  sourceUuid: string;
  translatedUuid: string;
}

const FOUNDRY_REFERENCE = /@(?<kind>UUID|Embed)\[(?<body>[^\]\r\n]*)\]/giu;
const DATA_UUID = /(?<prefix>\bdata-uuid\s*=\s*)(?<quote>["'])(?<uuid>[^"']+)\k<quote>/giu;

function referenceUuid(body: string): string | null {
  const token = body.trim().split(/\s+/u, 1)[0] ?? "";
  // Anchors such as `JournalEntry.X.JournalEntryPage.Y#section` are not part
  // of the UUID; strip them so the reference resolves and rewriting keeps them.
  const uuid = token.split("#", 1)[0] ?? "";
  return uuid && !uuid.includes("=") ? uuid : null;
}

export function discoverDocumentDependencies(
  text: string,
  fieldPath: readonly (string | number)[] = [],
): DocumentDependency[] {
  const dependencies: DocumentDependency[] = [];
  for (const match of text.matchAll(FOUNDRY_REFERENCE)) {
    const sourceUuid = referenceUuid(match.groups?.body ?? "");
    if (!sourceUuid) continue;
    dependencies.push({
      sourceUuid,
      kind: match.groups?.kind?.toLowerCase() === "embed" ? "embed" : "uuid",
      fieldPath,
    });
  }
  for (const match of text.matchAll(DATA_UUID)) {
    const sourceUuid = match.groups?.uuid?.trim();
    if (sourceUuid) dependencies.push({ sourceUuid, kind: "data-uuid", fieldPath });
  }
  return dependencies;
}

function walkStrings(
  value: unknown,
  path: readonly (string | number)[],
  visit: (text: string, path: readonly (string | number)[]) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, [...path, index], visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    walkStrings(entry, [...path, key], visit);
  }
}

export function discoverJournalDependencies(source: JournalData): DocumentDependency[] {
  const dependencies: DocumentDependency[] = [];
  source.pages.forEach((page, pageIndex) => {
    walkStrings(page, ["pages", pageIndex], (text, fieldPath) => {
      dependencies.push(...discoverDocumentDependencies(text, fieldPath));
    });
  });

  const unique = new Map<string, DocumentDependency>();
  for (const dependency of dependencies) {
    const key = `${dependency.kind}\u0000${dependency.sourceUuid}\u0000${dependency.fieldPath.join(".")}`;
    if (!unique.has(key)) unique.set(key, dependency);
  }
  return [...unique.values()];
}

export function discoverObjectDependencies(source: unknown): DocumentDependency[] {
  const dependencies: DocumentDependency[] = [];
  walkStrings(source, [], (text, fieldPath) => {
    dependencies.push(...discoverDocumentDependencies(text, fieldPath));
  });
  const unique = new Map<string, DocumentDependency>();
  for (const dependency of dependencies) {
    const key = `${dependency.kind}\u0000${dependency.sourceUuid}\u0000${dependency.fieldPath.join(".")}`;
    if (!unique.has(key)) unique.set(key, dependency);
  }
  return [...unique.values()];
}

function rewriteText(
  text: string,
  replacements: ReadonlyMap<string, string>,
): string {
  const foundry = text.replace(FOUNDRY_REFERENCE, (expression, ...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string> | undefined;
    const body = groups?.body ?? "";
    const sourceUuid = referenceUuid(body);
    const translatedUuid = sourceUuid ? replacements.get(sourceUuid) : undefined;
    if (!sourceUuid || !translatedUuid) return expression;
    const uuidOffset = body.indexOf(sourceUuid);
    const rewrittenBody = `${body.slice(0, uuidOffset)}${translatedUuid}${body.slice(uuidOffset + sourceUuid.length)}`;
    return expression.replace(body, rewrittenBody);
  });
  return foundry.replace(DATA_UUID, (expression, ...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string> | undefined;
    const sourceUuid = groups?.uuid?.trim() ?? "";
    const translatedUuid = replacements.get(sourceUuid);
    return translatedUuid ? expression.replace(groups?.uuid ?? sourceUuid, translatedUuid) : expression;
  });
}

function rewriteStrings(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return rewriteText(value, replacements);
  if (Array.isArray(value)) return value.map((entry) => rewriteStrings(entry, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, rewriteStrings(entry, replacements)]),
  );
}

export function rewriteJournalDocumentReferences(
  source: JournalData,
  replacements: readonly DocumentReferenceReplacement[],
): JournalData {
  const replacementMap = new Map(
    replacements.map(({ sourceUuid, translatedUuid }) => [sourceUuid, translatedUuid]),
  );
  return rewriteStrings(source, replacementMap) as JournalData;
}

export function rewriteDocumentReferences<T>(
  source: T,
  replacements: readonly DocumentReferenceReplacement[],
): T {
  const replacementMap = new Map(
    replacements.map(({ sourceUuid, translatedUuid }) => [sourceUuid, translatedUuid]),
  );
  return rewriteStrings(source, replacementMap) as T;
}
