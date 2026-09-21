import type { GlossaryEntry } from "../glossary/types";

/** Foundry otherwise obtains an implicit label from the original document.
 * Make names visible to the normal glossary translation pipeline without
 * changing UUIDs, anchors, embed options, or an author's explicit label.
 */
export function labelGlossaryReferences(text: string, glossary: readonly GlossaryEntry[]): string {
  if (!/@(?:UUID|Embed)\[/iu.test(text)) return text;
  const names = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entry of glossary) {
    if (entry.enabled === false || !entry.sourceUuid || /[{}<>\r\n]/u.test(entry.source)) continue;
    if (names.has(entry.sourceUuid) && names.get(entry.sourceUuid) !== entry.source) ambiguous.add(entry.sourceUuid);
    names.set(entry.sourceUuid, entry.source);
  }
  return text.replace(/@(?:UUID|Embed)\[([^\]\r\n]*)\](\{[^}\r\n]*\})?/giu, (expression, body: string, label: string | undefined) => {
    if (label !== undefined || /(?:^|\s)label\s*=/iu.test(body)) return expression;
    const uuid = body.trim().split(/\s+/u)[0]?.split("#")[0] ?? "";
    const name = !ambiguous.has(uuid) ? names.get(uuid) : undefined;
    return name ? `${expression}{${name}}` : expression;
  });
}
