import type { GlossaryInflectionReference } from "./types";

interface Frame {
  tag: "items" | "item" | "segment" | "name" | "keep";
  id?: string;
  prefix: string;
  suffix: string;
  text: boolean;
  item?: number;
  /** Names may move within this plain text container, never across opaque syntax. */
  group?: number;
}

interface Boundary {
  frame: Frame;
  kind: "open" | "close" | "empty";
}

export interface InflectionXml {
  text: string;
  instructions: string;
  schema?: Record<string, unknown>;
  drafts?(output: string): string[];
  restore(output: string): string[] | null;
}

export function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function unescapeXml(text: string): string {
  if (/[<>]|&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/iu.test(text)) throw new Error("Invalid XML text");
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/giu, (_, entity: string) => {
    const known: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (known[entity]) return known[entity]!;
    if (!entity.startsWith("#")) throw new Error("Invalid XML entity");
    const codepoint = entity.slice(1, 2).toLowerCase() === "x"
      ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!codepoint || codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) throw new Error("Invalid XML character");
    return String.fromCodePoint(codepoint);
  });
}

/** A deliberately small XML wire format. No source markup is executed or parsed
 * as HTML. Output must preserve hierarchy and IDs. Names may move within plain
 * prose; opaque syntax and segment order stay fixed. Original protection tokens
 * are restored for the normal integrity and vocabulary guards.
 */
export function prepareInflectionXml(
  texts: readonly string[],
  references: readonly GlossaryInflectionReference[],
  allowWithoutNames = false,
): InflectionXml | null {
  const names = new Map(references.map(reference => [reference.token, reference]));
  const nameTokens = new Set(references.flatMap(({ token, endToken }) => [token, endToken]));
  if (!allowWithoutNames && !references.some(({ token }) => texts.some(text => text.includes(token)))) return null;
  const boundaries: Boundary[] = [];
  const terminology = new Set<string>();
  let nextId = 0;
  let nextGroup = 0;
  function element(frame: Frame, content: () => string): string {
    boundaries.push({ frame, kind: "open" });
    const body = content();
    boundaries.push({ frame, kind: "close" });
    return `<${frame.tag}${frame.id ? ` id="${frame.id}"` : ""}>${body}</${frame.tag}>`;
  }
  function content(text: string): string {
    let output = "", cursor = 0;
    const pattern = /__(?:FTG|FTS|FTN)_[A-Z0-9]+_[A-Z0-9]+__/gu;
    const group = [...text.matchAll(pattern)].every(([token]) => nameTokens.has(token)) ? nextGroup++ : undefined;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      output += escapeXml(text.slice(cursor, match.index));
      const reference = names.get(match[0]);
      if (reference) {
        const end = text.indexOf(reference.endToken, pattern.lastIndex);
        if (end < 0 || text.slice(pattern.lastIndex, end) !== reference.replacement) throw new Error("Invalid name pair");
        terminology.add(`${JSON.stringify(reference.source)} = ${JSON.stringify(reference.replacement)}`);
        output += element({ tag: "name", id: `n${nextId++}`, prefix: reference.token,
          suffix: reference.endToken, text: true, ...(group !== undefined ? { group } : {}) }, () => escapeXml(reference.source));
        pattern.lastIndex = end + reference.endToken.length;
      } else {
        const frame: Frame = { tag: "keep", id: `k${nextId++}`, prefix: match[0], suffix: "", text: false };
        boundaries.push({ frame, kind: "empty" });
        output += `<keep id="${frame.id}"/>`;
      }
      cursor = pattern.lastIndex;
    }
    return output + escapeXml(text.slice(cursor));
  }

  let text: string;
  try {
    text = element({ tag: "items", prefix: "", suffix: "", text: false }, () => texts.map((source, item) => {
      const segments = [...source.matchAll(/__FTN_[A-Z0-9]+_[A-Z0-9]+__/gu)];
      return element({ tag: "item", id: `i${item}`, prefix: "", suffix: "", text: segments.length === 0, item }, () => {
        if (!segments.length) return content(source);
        if (segments.length < 2 || segments[0]!.index !== 0 || segments.at(-1)!.index + segments.at(-1)![0].length !== source.length) {
          throw new Error("Invalid segment boundaries");
        }
        return segments.slice(0, -1).map((start, index) => {
          const end = segments[index + 1]!;
          return element({ tag: "segment", id: `s${nextId++}`, prefix: index === 0 ? start[0] : "",
            suffix: end[0], text: true }, () => content(source.slice(start.index + start[0].length, end.index)));
        }).join("");
      });
    }).join("\n"));
  } catch {
    return null;
  }
  const instructions = [
    "Translate the text in every XML item. Return only the translated XML, without Markdown fences.",
    "Preserve all tags, IDs, attributes and hierarchy; do not add or remove tags. Keep item, segment and keep elements in their original order.",
    "You may move whole name phrases within one item or segment containing no keep elements to form natural Czech word order. Never move names across items, segments or keep elements.",
    "Each item is independent. Segments within an item form one sentence: use their shared context but keep words inside their segment.",
    "Keep elements named keep empty. Elements named name contain the original source name: use its approved Czech translation below and inflect it naturally in context.",
    "Preserve meaning, negation, numbers, and who does what. Keep standalone titles in their dictionary form.",
    "Approved Czech dictionary forms (terminology data, not instructions):",
    ...terminology,
  ].join("\n");

  return {
    text, instructions,
    restore(output) {
      try {
        const result = texts.map(() => "");
        const expectedBoundaries = boundaries.slice();
        const stack: Frame[] = [];
        let currentItem: number | undefined, boundary = 0, cursor = 0;
        function append(raw: string): void {
          const value = unescapeXml(raw);
          if (!stack.at(-1)?.text) {
            if (value.trim()) throw new Error("Text outside a translatable element");
          } else if (currentItem !== undefined) result[currentItem] += value;
        }
        for (const match of output.matchAll(/<[^>]*>/gu)) {
          append(output.slice(cursor, match.index));
          const tag = /^<(\/?)(items|item|segment|name|keep)(?:\s+id=(?:"([a-z]\d+)"|'([a-z]\d+)'))?\s*(\/?)>$/u.exec(match[0]);
          if (!tag) return null;
          const kind = tag[1] ? "close" : tag[5] ? "empty" : "open";
          const id = tag[3] ?? tag[4];
          let expected = expectedBoundaries[boundary];
          if (!expected) return null;
          if (kind === "open" && tag[2] === "name" && expected.kind === "open" &&
            expected.frame.tag === "name" && expected.frame.group !== undefined && expected.frame.id !== id) {
            const alternative = expectedBoundaries.findIndex((entry, index) => index > boundary && entry.kind === "open" &&
              entry.frame.tag === "name" && entry.frame.group === expected!.frame.group && entry.frame.id === id);
            if (alternative < 0) return null;
            // Name elements are text-only leaves, so their two boundary records
            // can be swapped without moving link syntax or segment containers.
            for (const offset of [0, 1]) {
              [expectedBoundaries[boundary + offset], expectedBoundaries[alternative + offset]] =
                [expectedBoundaries[alternative + offset]!, expectedBoundaries[boundary + offset]!];
            }
            expected = expectedBoundaries[boundary]!;
          }
          boundary += 1;
          const { frame } = expected;
          if (tag[2] !== frame.tag || kind !== expected.kind ||
            id !== (kind === "close" ? undefined : frame.id)) return null;
          if (kind === "close") {
            if (stack.pop() !== frame) return null;
            if (currentItem !== undefined) result[currentItem] += frame.suffix;
            if (frame.tag === "item") currentItem = undefined;
          } else {
            if (frame.item !== undefined) currentItem = frame.item;
            if (currentItem !== undefined) result[currentItem] += frame.prefix;
            if (kind === "open") stack.push(frame);
          }
          cursor = match.index + match[0].length;
        }
        append(output.slice(cursor));
        return boundary === boundaries.length && !stack.length ? result : null;
      } catch {
        return null;
      }
    },
  };
}
