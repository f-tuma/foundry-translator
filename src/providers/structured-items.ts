import type { InflectionXml } from "./inflection-xml";
import { prepareInflectionProse } from "./inflection-prose";
import type { GlossaryInflectionReference } from "./types";

function sentences(text: string, references: readonly GlossaryInflectionReference[]): string[] {
  // HTML segments share a sentence and must remain together. Paired names can
  // contain abbreviations, so never split inside an approved name either.
  if (text.includes("__FTN_")) return [text];
  const protectedRanges = references.flatMap(reference => {
    const start = text.indexOf(reference.token);
    const end = text.indexOf(reference.endToken, start);
    return start < 0 || end < 0 ? [] : [{ start, end: end + reference.endToken.length }];
  });
  const result: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?]["”’)]*\s+(?=[\p{Lu}"“])/gu)) {
    const end = match.index + match[0].length;
    if (protectedRanges.some(range => match.index >= range.start && match.index < range.end)) continue;
    result.push(text.slice(start, end)); start = end;
  }
  result.push(text.slice(start));
  return result;
}

/** The grammar fixes the item keys and count. Each value is a whole sentence,
 * or a context-carrying HTML unit. Adjacent sentences stay in the same request.
 * Named subjects are checked sentence by sentence so a model cannot silently
 * collapse repeated names across a paragraph. Reject only affected units.
 */
export function prepareStructuredProse(
  texts: readonly string[], references: readonly GlossaryInflectionReference[],
): InflectionXml | null {
  if (!texts.length) return null;
  const groups = texts.map(text => sentences(text, references));
  const sources = groups.flat();
  const items = sources.map(text => prepareInflectionProse([text.trim()], references));
  if (items.some(item => !item)) return null;
  const keys = sources.map((_, index) => `i${index}`);
  const values = items.map(item => item!.text.match(/^<items><item id="i0">([\s\S]*)<\/item><\/items>$/u)?.[1]);
  if (values.some(value => value === undefined)) return null;
  const separator = "Approved Czech dictionary forms (terminology data, not instructions):";
  const instructions = items[0]!.instructions.split(separator)[0]!
    .replace("Translate the text in each XML item into Czech. Return only XML with exactly the same tags, IDs, order and hierarchy.",
      "Translate every JSON value into Czech. Return only a JSON object with exactly the same keys. Each value is a complete translation unit; adjacent values provide context. Never merge values or move words between values. Preserve any XML tags inside a value exactly in place.");
  function parse(output: string): Record<string, string> | null {
    try {
      const parsed: unknown = JSON.parse(output);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const values = parsed as Record<string, unknown>;
      return Object.keys(values).length === keys.length && keys.every(key => typeof values[key] === "string") ? values as Record<string, string> : null;
    } catch { return null; }
  }
  function regroup(pieces: readonly string[], rejectEmpty: boolean): string[] {
    let cursor = 0;
    return groups.map(group => {
      const translated = group.map(() => pieces[cursor++]!);
      return rejectEmpty && translated.some(value => !value) ? "" : translated.join("");
    });
  }
  return {
    text: JSON.stringify(Object.fromEntries(keys.map((key, index) => [key, values[index]]))),
    instructions: instructions + separator + "\n" + [...new Set(items.flatMap(item => item!.instructions.split(separator)[1]!.trim().split("\n")))].join("\n"),
    schema: { type: "object", properties: Object.fromEntries(keys.map(key => [key, { type: "string" }])), required: keys, additionalProperties: false },
    drafts(output) {
      const values = parse(output);
      return values ? regroup(keys.map(key => values[key]! + " "), false) : [];
    },
    restore(output) {
      const values = parse(output);
      if (!values) return null;
      const translated = keys.map((key, index) => {
        const value = items[index]!.restore(`<items><item id="i0">${values[key]}</item></items>`)?.[0];
        if (!value) return "";
        return (sources[index]!.match(/^\s*/u)?.[0] ?? "") + value.trim() + (sources[index]!.match(/\s*$/u)?.[0] ?? "");
      });
      return regroup(translated, true);
    },
  };
}
