import type { GlossaryEntry } from "../glossary/types";
import { isGlossaryCategory, isGlossaryMode } from "../glossary/types";
import { validateGlossary } from "../glossary/protection";
import { FOUNDRY_EXPRESSION, protectFoundrySyntax } from "../translation/foundry-syntax";
import { planMarkdownTranslation } from "../translation/markdown";
import type { BundleDocumentKind, FieldFormat, PortableField } from "./fields";
import { isProviderId, type ProviderId } from "../settings/settings";

export const BUNDLE_FORMAT = "foundry-translate-bundle";
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
export interface BundlePatch extends PortableField { source: string; translation: string }
export interface BundleDocument {
  kind: BundleDocumentKind;
  sourceUuid: string;
  sourceName: string;
  /** Canonical fingerprint of source content, independent of root ID and bookkeeping. */
  sourceFingerprint: string;
  patches: BundlePatch[];
  partial: boolean;
  processedPageIds: string[];
  fallbackTextSegments: number;
  providerId: ProviderId;
  sourceLanguage: string;
  translatedAt: string;
  engineRevision: number;
}
export interface TranslationBundle {
  format: typeof BUNDLE_FORMAT;
  version: 1 | 2 | 3;
  createdAt: string;
  moduleVersion: string;
  systemId: string;
  systemVersion: string;
  targetLanguage: string;
  glossary: GlossaryEntry[];
  documents: BundleDocument[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid translation bundle: ${message}`);
}
function shortString(value: unknown, max = 500): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function parseTranslationBundle(text: string): TranslationBundle {
  requireValue(new TextEncoder().encode(text).length <= MAX_BUNDLE_BYTES, "maximum size is 50 MB.");
  const value: unknown = JSON.parse(text);
  requireValue(record(value) && value.format === BUNDLE_FORMAT && (value.version === 1 || value.version === 2 || value.version === 3), "unsupported format or version.");
  for (const key of ["createdAt", "moduleVersion", "systemId", "targetLanguage"]) requireValue(shortString(value[key]), `missing ${key}.`);
  requireValue(typeof value.systemVersion === "string", "missing system version.");
  requireValue(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value.targetLanguage as string), "invalid language.");
  requireValue(Array.isArray(value.glossary) && value.glossary.length <= 20000, "invalid glossary.");
  const seenTerms = new Set<string>();
  const glossary = value.glossary.map((entry: unknown): GlossaryEntry => {
    requireValue(record(entry) && shortString(entry.source, 240) && shortString(entry.replacement, 240), "invalid glossary term.");
    requireValue(isGlossaryCategory(entry.category), "invalid category.");
    requireValue(Array.isArray(entry.aliases) && entry.aliases.length <= 100 && entry.aliases.every((a) => shortString(a, 240)), "invalid aliases.");
    requireValue(entry.enabled === undefined || typeof entry.enabled === "boolean", "invalid glossary state.");
    requireValue(entry.mode === undefined || isGlossaryMode(entry.mode), "invalid glossary mode.");
    const key = entry.source.normalize("NFC").trim().toLowerCase();
    requireValue(key && !seenTerms.has(key), `duplicate term ${entry.source}.`);
    seenTerms.add(key);
    return { source: entry.source, replacement: entry.replacement, category: entry.category, aliases: entry.aliases as string[],
      ...(entry.mode === "inflect" ? { mode: "inflect" } : {}),
      ...(entry.enabled === false ? { enabled: false } : {}), ...(typeof entry.notes === "string" ? { notes: entry.notes.slice(0, 2000) } : {}), customized: true };
  });
  validateGlossary(glossary);
  requireValue(Array.isArray(value.documents) && value.documents.length <= 10000, "invalid document list.");
  const seenDocuments = new Set<string>();
  const documents = value.documents.map((entry: unknown): BundleDocument => {
    requireValue(record(entry) && (value.version === 3 ? ["JournalEntry", "Actor", "Item", "Scene", "ActiveEffect"] : ["JournalEntry", "Actor", "Item"]).includes(String(entry.kind)), "invalid document kind.");
    requireValue(shortString(entry.sourceUuid) && shortString(entry.sourceName), "invalid document identity.");
    requireValue(typeof entry.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(entry.sourceFingerprint), "invalid source fingerprint.");
    requireValue(!seenDocuments.has(entry.sourceUuid), "duplicate document.");
    seenDocuments.add(entry.sourceUuid);
    requireValue(typeof entry.partial === "boolean", "invalid coverage.");
    requireValue(Array.isArray(entry.processedPageIds) && entry.processedPageIds.every((id) => shortString(id, 100)), "invalid pages.");
    requireValue(Number.isSafeInteger(entry.fallbackTextSegments) && Number(entry.fallbackTextSegments) >= 0, "invalid fallback count.");
    requireValue(isProviderId(entry.providerId) && shortString(entry.sourceLanguage) && shortString(entry.translatedAt) && Number.isSafeInteger(entry.engineRevision), "invalid provenance.");
    requireValue(Array.isArray(entry.patches) && entry.patches.length <= 100000, "invalid patches.");
    const seenPaths = new Set<string>();
    const patches = entry.patches.map((patch: unknown): BundlePatch => {
      requireValue(record(patch) && ["html", "markdown", "text"].includes(String(patch.format)), "invalid field format.");
      requireValue(Array.isArray(patch.path) && patch.path.length > 0 && patch.path.length <= 20 && patch.path.every((part) =>
        typeof part === "number" ? Number.isSafeInteger(part) && part >= 0 : shortString(part, 100) && !["__proto__", "prototype", "constructor"].includes(part)), "invalid field path.");
      requireValue(typeof patch.source === "string" && patch.source.length <= 2_000_000 && typeof patch.translation === "string" && patch.translation.length <= 2_000_000, "invalid field text.");
      const key = JSON.stringify(patch.path);
      requireValue(!seenPaths.has(key), "duplicate field path.");
      seenPaths.add(key);
      return { path: patch.path as (string | number)[], format: patch.format as FieldFormat, source: patch.source, translation: patch.translation };
    });
    return { kind: entry.kind as BundleDocumentKind, sourceUuid: entry.sourceUuid, sourceName: entry.sourceName, sourceFingerprint: entry.sourceFingerprint,
      partial: entry.partial, processedPageIds: [...entry.processedPageIds] as string[], fallbackTextSegments: Number(entry.fallbackTextSegments),
      providerId: entry.providerId, sourceLanguage: entry.sourceLanguage, translatedAt: entry.translatedAt, engineRevision: Number(entry.engineRevision), patches };
  });
  // Reconstruct the object so credentials, flags and unknown fields are discarded.
  return { format: BUNDLE_FORMAT, version: value.version, createdAt: String(value.createdAt), moduleVersion: String(value.moduleVersion), systemId: String(value.systemId),
    systemVersion: String(value.systemVersion), targetLanguage: String(value.targetLanguage), glossary, documents };
}

const TEXT_ATTRIBUTES = new Set(["title", "alt", "aria-label", "data-tooltip", "data-tooltip-text", "placeholder"]);
function htmlStructure(value: string): string {
  const template = document.createElement("template");
  template.innerHTML = value;
  const walk = (node: Node): unknown => {
    if (node.nodeType === 3) return "#text";
    if (node.nodeType !== 1) return [node.nodeType, node.textContent];
    const el = node as Element;
    if (el.matches("code,pre,script,style,textarea,noscript,template")) return el.outerHTML;
    // Foundry tooltips can render HTML stored in an attribute. Validate their
    // structure too, rather than treating an injected element as plain prose.
    return [el.tagName, [...el.attributes].map((a) => [a.name, TEXT_ATTRIBUTES.has(a.name) ? htmlStructure(a.value) : a.value]).sort(), [...el.childNodes].map(walk)];
  };
  return JSON.stringify([...template.content.childNodes].map(walk));
}

/** Import prose only: reject changes to markup, URLs, UUIDs, rolls and macros. */
export function assertPortableText(source: string, translation: string, format: FieldFormat): void {
  requireValue(!/__FT[NGS]_/iu.test(translation), "unrestored protection token.");
  const syntax = (text: string) => JSON.stringify([...text.matchAll(FOUNDRY_EXPRESSION)].map(([expression]) => {
    // Compare complete commands as a multiset. Sorting protection fragments would
    // let options or UUIDs migrate between different commands unnoticed.
    const reference = expression.replace(/(@(?:UUID|Embed)\[[^\]\r\n]*\])\{([^}\r\n]*)\}/giu,
      (whole, command: string, label: string) => /@[A-Za-z][A-Za-z0-9]*\[|\[\[/u.test(label) ? whole : command);
    // Reject nested executable syntax in any editable label or embed caption.
    const prose = protectFoundrySyntax(reference, { nonce: "BUNDLE" });
    requireValue(!/@[A-Za-z][A-Za-z0-9]*\[|\[\[/u.test(prose.text), "nested Foundry commands in a label.");
    return JSON.stringify(prose.tokens.map(t => t.source));
  }).sort());
  requireValue(syntax(source) === syntax(translation), "Foundry references or commands were changed.");
  if (format === "html" || format === "text") requireValue(htmlStructure(source) === htmlStructure(translation), "HTML structure or attributes were changed.");
  if (format === "markdown") {
    let marker = "PORTABLEPROSE";
    while (source.includes(marker) || translation.includes(marker)) marker += "X";
    const skeleton = (text: string) => {
      const p = planMarkdownTranslation(text);
      // Moving a Foundry reference can join or split adjacent prose spans.
      // Normalize those spans, while retaining code, destinations and markup.
      return p.apply(p.units.map(u => u.map(() => marker))).replace(new RegExp(`(?:${marker})+`, "gu"), marker);
    };
    requireValue(skeleton(source) === skeleton(translation), "Markdown structure or destinations were changed.");
  }
}
