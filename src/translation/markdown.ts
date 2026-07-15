const TRANSLATABLE_TEXT = /[\p{L}\p{N}]/u;
const MAX_MARKDOWN_UNIT_CHARACTERS = 3_200;
const FOUNDRY_EXPRESSION =
  /^@[A-Za-z][A-Za-z0-9]*\[[^\]\r\n]*\](?:\{[^}\r\n]*\})?/u;
const INLINE_ROLL = /^\[\[[^\]\r\n]*\]\]/u;
const URL = /^(?:https?:\/\/|www\.)[^\s<>]+/iu;
const HTML_OR_AUTOLINK = /^<[^>\r\n]+>/u;
const HTML_ENTITY = /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/iu;

interface MarkdownSpan {
  start: number;
  end: number;
  chunks: string[];
  translated: string[];
  group: number;
}

interface PlannedSegment {
  span: MarkdownSpan;
  chunkIndex: number;
  source: string;
}

export interface MarkdownTranslationPlan {
  units: readonly (readonly string[])[];
  apply(translatedUnits: readonly (readonly string[])[]): string;
}

function safeSliceEnd(text: string, end: number): number {
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? end - 1
    : end;
}

function splitLongText(text: string): string[] {
  if (text.length <= MAX_MARKDOWN_UNIT_CHARACTERS) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + MAX_MARKDOWN_UNIT_CHARACTERS);
    if (end < text.length) {
      const minimum = start + Math.floor(MAX_MARKDOWN_UNIT_CHARACTERS * 0.6);
      for (let cursor = end; cursor > minimum; cursor -= 1) {
        if (/\s|[.!?;:…]/u.test(text[cursor - 1] ?? "")) {
          end = cursor;
          break;
        }
      }
      end = safeSliceEnd(text, end);
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function closingBracket(text: string, start: number, opening: string, closing: string): number {
  let depth = 0;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === opening) depth += 1;
    else if (text[cursor] === closing) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function blockPrefixLength(line: string): number {
  let cursor = 0;
  while (cursor < line.length) {
    const prefix = line.slice(cursor).match(
      /^(?: {0,3}>[ \t]?| {0,3}(?:[-+*]|\d+[.)])[ \t]+| {0,3}#{1,6}[ \t]+)/u,
    )?.[0];
    if (!prefix) break;
    cursor += prefix.length;
  }
  const task = line.slice(cursor).match(/^\[[ xX]\][ \t]+/u)?.[0];
  return cursor + (task?.length ?? 0);
}

function isStructuralLine(line: string): boolean {
  return /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|=+|-+)\s*$/u.test(line) ||
    /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)?\|?\s*$/u.test(line) ||
    /^ {0,3}\[[^\]]+\]:\s*\S+/u.test(line);
}

function addSpan(
  spans: MarkdownSpan[],
  source: string,
  start: number,
  end: number,
  group: number,
): void {
  const value = source.slice(start, end);
  if (!TRANSLATABLE_TEXT.test(value)) return;
  spans.push({ start, end, chunks: splitLongText(value), translated: [], group });
}

function scanInline(
  source: string,
  start: number,
  end: number,
  group: number,
  spans: MarkdownSpan[],
): void {
  let cursor = start;
  let plainStart = start;
  const flush = (position: number): void => {
    addSpan(spans, source, plainStart, position, group);
  };

  while (cursor < end) {
    const rest = source.slice(cursor, end);
    const foundry = rest.match(FOUNDRY_EXPRESSION)?.[0];
    const inlineRoll = rest.match(INLINE_ROLL)?.[0];
    const url = rest.match(URL)?.[0];
    const html = rest.match(HTML_OR_AUTOLINK)?.[0];
    const entity = rest.match(HTML_ENTITY)?.[0];

    if (foundry || inlineRoll) {
      flush(cursor);
      const expression = foundry ?? inlineRoll ?? "";
      addSpan(spans, source, cursor, cursor + expression.length, group);
      cursor += expression.length;
      plainStart = cursor;
      continue;
    }
    if (url || html || entity) {
      flush(cursor);
      cursor += (url ?? html ?? entity ?? "").length;
      plainStart = cursor;
      continue;
    }
    if (source[cursor] === "\\") {
      flush(cursor);
      cursor = Math.min(end, cursor + 2);
      plainStart = cursor;
      continue;
    }
    if (source[cursor] === "`") {
      flush(cursor);
      const delimiter = source.slice(cursor).match(/^`+/u)?.[0] ?? "`";
      const closing = source.indexOf(delimiter, cursor + delimiter.length);
      cursor = closing >= 0 && closing < end ? closing + delimiter.length : cursor + delimiter.length;
      plainStart = cursor;
      continue;
    }

    const image = source[cursor] === "!" && source[cursor + 1] === "[";
    if (image || source[cursor] === "[") {
      const bracketStart = cursor + (image ? 1 : 0);
      const bracketEnd = closingBracket(source, bracketStart, "[", "]");
      if (bracketEnd >= 0 && bracketEnd < end) {
        flush(cursor);
        const labelStart = bracketStart + 1;
        const label = source.slice(labelStart, bracketEnd);
        if (!label.startsWith("^") && !label.startsWith("[")) {
          scanInline(source, labelStart, bracketEnd, group, spans);
        }
        cursor = bracketEnd + 1;
        if (source[cursor] === "(") {
          const targetEnd = closingBracket(source, cursor, "(", ")");
          if (targetEnd >= 0 && targetEnd < end) cursor = targetEnd + 1;
        } else if (source[cursor] === "[") {
          const referenceEnd = closingBracket(source, cursor, "[", "]");
          if (referenceEnd >= 0 && referenceEnd < end) cursor = referenceEnd + 1;
        }
        plainStart = cursor;
        continue;
      }
    }

    if (/[*_~#|]/u.test(source[cursor] ?? "")) {
      flush(cursor);
      const marker = source[cursor];
      while (cursor < end && source[cursor] === marker) cursor += 1;
      plainStart = cursor;
      continue;
    }
    cursor += 1;
  }
  flush(end);
}

function lineRanges(source: string): { start: number; contentEnd: number; end: number }[] {
  const lines: { start: number; contentEnd: number; end: number }[] = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline + 1;
    const contentEnd = newline < 0
      ? source.length
      : newline > start && source[newline - 1] === "\r" ? newline - 1 : newline;
    lines.push({ start, contentEnd, end });
    start = end;
  }
  if (!source.length) lines.push({ start: 0, contentEnd: 0, end: 0 });
  return lines;
}

export function planMarkdownTranslation(markdown: string): MarkdownTranslationPlan {
  const spans: MarkdownSpan[] = [];
  let group = 0;
  let fence: { character: string; length: number } | null = null;
  let frontmatter = false;

  for (const [lineIndex, range] of lineRanges(markdown).entries()) {
    const line = markdown.slice(range.start, range.contentEnd);
    if (lineIndex === 0 && /^---\s*$/u.test(line)) {
      frontmatter = true;
      group += 1;
      continue;
    }
    if (frontmatter) {
      if (/^(?:---|\.\.\.)\s*$/u.test(line)) frontmatter = false;
      continue;
    }
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`, "u");
      if (closing.test(line)) fence = null;
      continue;
    }
    const opening = line.match(/^ {0,3}(?<fence>`{3,}|~{3,})/u)?.groups?.fence;
    if (opening) {
      fence = { character: opening[0] ?? "`", length: opening.length };
      group += 1;
      continue;
    }
    if (!line.trim() || /^(?: {4}|\t)/u.test(line) || isStructuralLine(line)) {
      group += 1;
      continue;
    }
    const prefix = blockPrefixLength(line);
    scanInline(markdown, range.start + prefix, range.contentEnd, group, spans);
  }

  const segments = spans.flatMap((span) =>
    span.chunks.map<PlannedSegment>((source, chunkIndex) => ({ span, chunkIndex, source })));
  const units: PlannedSegment[][] = [];
  let unit: PlannedSegment[] = [];
  let length = 0;
  let previousGroup = -1;
  for (const segment of segments) {
    if (unit.length && (segment.span.group !== previousGroup || length + segment.source.length > MAX_MARKDOWN_UNIT_CHARACTERS)) {
      units.push(unit);
      unit = [];
      length = 0;
    }
    unit.push(segment);
    length += segment.source.length;
    previousGroup = segment.span.group;
  }
  if (unit.length) units.push(unit);

  return {
    units: units.map((entries) => entries.map(({ source }) => source)),
    apply(translatedUnits) {
      if (translatedUnits.length !== units.length) {
        throw new Error("Počet přeložených Markdown bloků neodpovídá zdroji.");
      }
      units.forEach((entries, unitIndex) => {
        const translated = translatedUnits[unitIndex];
        if (!translated || translated.length !== entries.length) {
          throw new Error("Struktura přeloženého Markdown bloku neodpovídá zdroji.");
        }
        entries.forEach(({ span, chunkIndex }, segmentIndex) => {
          span.translated[chunkIndex] = translated[segmentIndex] ?? "";
        });
      });
      let output = markdown;
      for (const span of [...spans].reverse()) {
        output = `${output.slice(0, span.start)}${span.translated.join("")}${output.slice(span.end)}`;
      }
      return output;
    },
  };
}
