import { discoverDocumentDependencies, rewriteDocumentReferences } from "../translation/document-dependencies";
import type { HtmlFieldPath } from "../translation/system-html-fields";

/** The context that Foundry uses to resolve relative links in a text field. */
export function referenceContext(uuid: string, data: Record<string, unknown>, path: HtmlFieldPath): string {
  const type = { pages: "JournalEntryPage", items: "Item", effects: "ActiveEffect" }[String(path[0])];
  const member = typeof path[1] === "number" ? (data[String(path[0])] as Record<string, unknown>[] | undefined)?.[path[1]] : undefined;
  return type && member && typeof member._id === "string" ? `${uuid}.${type}.${member._id}` : uuid;
}

/** Foundry v14 relative-UUID rules, without resolving or guessing missing documents. */
export function absoluteReference(uuid: string, context: string): string | null {
  const anchor = uuid.indexOf("#");
  if (anchor >= 0) { const base = absoluteReference(uuid.slice(0, anchor), context); return base ? `${base}${uuid.slice(anchor)}` : null; }
  if (!uuid.startsWith(".")) return uuid;
  const rootLength = context.startsWith("Compendium.") ? 5 : 2;
  const parts = context.split(".");
  const dots = /^\.+/u.exec(uuid)![0].length;
  for (let i = 1; i < dots; i++) {
    if (parts.length <= rootLength) return null;
    parts.splice(-2);
  }
  const suffix = uuid.slice(dots);
  if (!suffix) return parts.join(".");
  const tail = suffix.split(".");
  if (tail.some(part => !part)) return null;
  if (tail.length % 2 === 0) return [...parts, ...tail].join(".");
  // An odd suffix addresses a sibling by ID rather than an explicit child type.
  return [...parts.slice(0, -1), ...tail].join(".");
}

/** Restore only equivalent spellings present in the source. Never drop embedded
 * suffixes or anchors. Ambiguous spellings fail closed in the regular validator. */
export function sourceReferenceNotation<T extends string | string[]>(source: string, translation: T, context: string): T {
  const spellings = new Map<string, Set<string>>();
  for (const { sourceUuid } of discoverDocumentDependencies(source)) {
    const absolute = absoluteReference(sourceUuid, context);
    if (!absolute) continue;
    const set = spellings.get(absolute) ?? new Set<string>();
    set.add(sourceUuid); spellings.set(absolute, set);
  }
  const dependencies = discoverDocumentDependencies(typeof translation === "string" ? translation : translation.join("\n"));
  const replacements = dependencies.flatMap(({ sourceUuid }) => {
    const absolute = absoluteReference(sourceUuid, context), set = absolute && spellings.get(absolute);
    const spelling = set && set.size === 1 ? [...set][0] : undefined;
    return spelling && spelling !== sourceUuid ? [{ sourceUuid, translatedUuid: spelling }] : [];
  });
  return rewriteDocumentReferences(translation, replacements);
}
