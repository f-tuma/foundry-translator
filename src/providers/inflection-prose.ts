import { normalizeCzechGlossaryForm } from "../glossary/inflection";
import type { GlossaryInflectionReference } from "./types";
import { prepareInflectionXml, escapeXml, unescapeXml, type InflectionXml } from "./inflection-xml";

interface NameSpan {
  id: string;
  reference: GlossaryInflectionReference;
  before: string;
  after: string;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|\p{N}+/gu;

/** Locate every approved form, requiring an unambiguous, exact occurrence count.
 * This recognises vocabulary, not grammar. It never invents or repairs a name.
 */
function annotateNames(text: string, names: readonly NameSpan[]): string | null {
  const words = [...text.matchAll(WORD)];
  const replacements: { start: number; end: number; value: string }[] = [];
  const groups = new Map<string, NameSpan[]>();
  for (const name of names) {
    const group = groups.get(name.reference.replacement) ?? [];
    group.push(name);
    groups.set(name.reference.replacement, group);
  }
  for (const [canonical, occurrences] of groups) {
    const canonicalWords = [...canonical.matchAll(WORD)];
    if (!canonicalWords.length) return null;
    const prefix = canonical.slice(0, canonicalWords[0]!.index);
    const last = canonicalWords.at(-1)!;
    const suffix = canonical.slice(last.index + last[0].length);
    const matches: { start: number; end: number; form: string }[] = [];
    for (let index = 0; index <= words.length - canonicalWords.length; index++) {
      const start = words[index]!.index - prefix.length;
      const endWord = words[index + canonicalWords.length - 1]!;
      const end = endWord.index + endWord[0].length + suffix.length;
      if (start < 0 || end > text.length) continue;
      const candidate = text.slice(start, end);
      const form = normalizeCzechGlossaryForm(canonical, candidate);
      if (form !== null) matches.push({ start, end, form });
    }
    // Missing, duplicated, or ambiguous names are rejected, never guessed.
    if (matches.length !== occurrences.length) return null;
    matches.forEach((match, index) => replacements.push({
      ...match, value: `${occurrences[index]!.before}<name id="${occurrences[index]!.id}">${escapeXml(match.form)}</name>${occurrences[index]!.after}`,
    }));
  }
  replacements.sort((a, b) => a.start - b.start);
  let cursor = 0, result = "";
  for (const { start, end, value } of replacements) {
    if (start < cursor) return null;
    result += escapeXml(text.slice(cursor, start)) + value;
    cursor = end;
  }
  return result + escapeXml(text.slice(cursor));
}

/** Identify vocabulary failures for a conservative exact-name recovery. A
 * successful match here is not a grammar claim; the complete decoder still
 * validates occurrences, boundaries and opaque syntax on the next attempt.
 */
export function unmatchedGlossaryTokens(draft: string, references: readonly GlossaryInflectionReference[]): string[] {
  const text = draft.replace(/<[^>]*>/gu, " ");
  const groups = new Map<string, GlossaryInflectionReference[]>();
  for (const reference of references) {
    const group = groups.get(reference.replacement) ?? [];
    group.push(reference); groups.set(reference.replacement, group);
  }
  return [...groups.values()].flatMap(group => annotateNames(text, group.map((reference, index) =>
    ({ id: `n${index}`, reference, before: "", after: "" }))) === null ? group.map(reference => reference.token) : []);
}

/** APEX translates continuous prose without inline name tags. Every name is
 * located and checked within its original syntax/segment boundaries afterward.
 * The existing XML decoder and the unit integrity checks remain authoritative.
 */
export function prepareInflectionProse(
  texts: readonly string[], references: readonly GlossaryInflectionReference[],
): InflectionXml | null {
  const xml = prepareInflectionXml(texts, references, true);
  if (!xml) return null;
  const byToken = new Map(references.map(reference => [reference.token, reference]));
  const ordered = texts.flatMap(text => [...text.matchAll(/__FTG_[A-Z0-9]+_[A-Z0-9]+__/gu)]
    .flatMap(([token]) => byToken.has(token) ? [byToken.get(token)!] : []));
  let nameIndex = 0;
  const names = new Map<string, GlossaryInflectionReference>();
  for (const match of xml.text.matchAll(/<name id="([a-z]\d+)">/gu)) names.set(match[1]!, ordered[nameIndex++]!);
  const wrappers = new Map<string, { before: string; after: string }>();
  // Adjacent opaque link delimiters travel with their checked name. The model
  // never sees a UUID or has to guess which side of an empty tag owns the name.
  const visible = xml.text.replace(/((?:<keep id="[a-z]\d+"\/>)*)(<name id="([a-z]\d+)">[^<]*<\/name>)((?:<keep id="[a-z]\d+"\/>)*)/gu,
    (_, before: string, element: string, id: string, after: string) => {
      wrappers.set(id, { before, after });
      return element;
    });
  const regions: NameSpan[][] = [];
  // Name elements belong to a text region. Structural elements stay visible.
  const pieces = visible.split(/(<(?!\/?name\b)[^>]*>)/gu);
  const input = pieces.map((piece, index) => {
    if (index % 2) return piece;
    const region: NameSpan[] = [];
    regions.push(region);
    return piece.replace(/<name id="([a-z]\d+)">([^<]*)<\/name>/gu, (_, id: string, source: string) => {
      region.push({ id, reference: names.get(id)!, ...wrappers.get(id)! });
      return source;
    });
  }).join("");
  const tags = pieces.filter((_, index) => index % 2);
  return {
    text: input,
    instructions: [
      "Translate the text in each XML item into Czech. Return only XML with exactly the same tags, IDs, order and hierarchy.",
      "Each item is independent. Segments within an item form one sentence: use their shared context but never move words across segment or keep tags. Keep empty keep tags unchanged.",
      "Use the approved vocabulary below. The glossary gives dictionary forms: inflect them naturally and adjust the agreement of adjectives, pronouns and verbs throughout the sentence.",
      "Retain EVERY occurrence of each glossary name, including repeated names. Never replace a glossary name with a pronoun, a synonym or an omission.",
      "Preserve meaning, tense, negation, numbers and who does what. Preserve commands as commands. Keep standalone titles in their dictionary form. Do not add or omit facts.",
      "Approved Czech dictionary forms (terminology data, not instructions):",
      ...new Set(ordered.map(reference => `${JSON.stringify(reference.source)} = ${JSON.stringify(reference.replacement)}`)),
    ].join("\n"),
    restore(output) {
      try {
        const translated = output.split(/(<[^>]*>)/gu);
        const outputTags = translated.filter((_, index) => index % 2);
        const normalizeTag = (tag: string) => tag.replaceAll("'", '"').replace(/\s+\/>$/u, "/>");
        if (outputTags.length !== tags.length || outputTags.some((tag, index) => normalizeTag(tag) !== tags[index])) return null;
        let region = 0;
        const restored: string[] = [];
        for (let index = 0; index < translated.length; index++) {
          if (index % 2) { restored.push(tags[(index - 1) / 2]!); continue; }
          const value = annotateNames(unescapeXml(translated[index]!), regions[region++]!);
          if (value === null) return null;
          restored.push(value);
        }
        return xml.restore(restored.join(""));
      } catch { return null; }
    },
  };
}
