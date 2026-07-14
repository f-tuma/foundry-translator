const BLOCK_SELECTOR = [
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "p",
  "section",
  "td",
  "th",
].join(",");

const EXCLUDED_SELECTOR = "code,pre,script,style,textarea,noscript,template";
const TRANSLATABLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "data-tooltip",
  "data-tooltip-text",
  "placeholder",
  "title",
]);
const TRANSLATABLE_TEXT = /[\p{L}\p{N}]/u;
const LOCALIZATION_KEY = /^[A-Z][A-Z0-9_]*(?:\.[A-Za-z0-9_-]+)+$/u;
export const MAX_HTML_UNIT_CHARACTERS = 3_200;

export interface HtmlTranslationPlan {
  units: readonly (readonly string[])[];
  apply(translatedUnits: readonly (readonly string[])[]): string;
}

function textDescendants(element: Element): Text[] {
  const nodes: Text[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      nodes.push(node as Text);
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(element);
  return nodes;
}

function isExcluded(node: Text): boolean {
  return !!node.parentElement?.closest(EXCLUDED_SELECTOR);
}

interface TranslationValue {
  source: string;
  apply(translated: string): void;
}

function textValue(node: Text): TranslationValue {
  return {
    source: node.data,
    apply: (translated) => {
      node.data = translated;
    },
  };
}

function hasTranslatableText(values: readonly TranslationValue[]): boolean {
  return TRANSLATABLE_TEXT.test(values.map(({ source }) => source).join(""));
}

function attributeValues(root: DocumentFragment): TranslationValue[] {
  const values: TranslationValue[] = [];
  for (const element of root.querySelectorAll("*")) {
    if (element.closest(EXCLUDED_SELECTOR)) continue;
    for (const attribute of element.attributes) {
      if (!TRANSLATABLE_ATTRIBUTES.has(attribute.name)) continue;
      const source = attribute.value;
      if (!TRANSLATABLE_TEXT.test(source) || LOCALIZATION_KEY.test(source)) continue;
      values.push({
        source,
        apply: (translated) => element.setAttribute(attribute.name, translated),
      });
    }
  }
  return values;
}

function safeSliceEnd(text: string, end: number): number {
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? end - 1
    : end;
}

function splitLongText(text: string): string[] {
  if (text.length <= MAX_HTML_UNIT_CHARACTERS) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + MAX_HTML_UNIT_CHARACTERS);
    if (end < text.length) {
      const minimum = start + Math.floor(MAX_HTML_UNIT_CHARACTERS * 0.6);
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

interface PlannedSegment {
  value: TranslationValue;
  source: string;
}

function planBoundedUnits(groups: readonly (readonly TranslationValue[])[]): PlannedSegment[][] {
  const units: PlannedSegment[][] = [];
  for (const nodes of groups) {
    let unit: PlannedSegment[] = [];
    let length = 0;
    for (const value of nodes) {
      for (const source of splitLongText(value.source)) {
        if (unit.length && length + source.length > MAX_HTML_UNIT_CHARACTERS) {
          units.push(unit);
          unit = [];
          length = 0;
        }
        unit.push({ value, source });
        length += source.length;
      }
    }
    if (unit.length) units.push(unit);
  }
  return units;
}

export function planHtmlTranslation(
  html: string,
  ownerDocument: Document = document,
): HtmlTranslationPlan {
  const template = ownerDocument.createElement("template");
  template.innerHTML = html;
  const covered = new Set<Text>();
  const groups: TranslationValue[][] = [];
  const blocks = [...template.content.querySelectorAll(BLOCK_SELECTOR)];
  const leafBlocks = blocks.filter((block) => !block.querySelector(BLOCK_SELECTOR));

  for (const block of leafBlocks) {
    const nodes = textDescendants(block).filter((node) => !isExcluded(node));
    nodes.forEach((node) => covered.add(node));
    const values = nodes.map(textValue);
    if (hasTranslatableText(values)) groups.push(values);
  }

  const remaining = textDescendants(template.content as unknown as Element).filter(
    (node) => !covered.has(node) && !isExcluded(node),
  );
  for (const node of remaining) {
    const value = textValue(node);
    if (hasTranslatableText([value])) groups.push([value]);
  }
  for (const value of attributeValues(template.content)) groups.push([value]);
  const plannedUnits = planBoundedUnits(groups);

  return {
    units: plannedUnits.map((unit) => unit.map(({ source }) => source)),
    apply(translatedUnits) {
      if (translatedUnits.length !== plannedUnits.length) {
        throw new Error("Počet přeložených HTML bloků neodpovídá zdroji.");
      }
      const translatedByValue = new Map<TranslationValue, string[]>();
      plannedUnits.forEach((unit, unitIndex) => {
        const segments = translatedUnits[unitIndex];
        if (!segments || segments.length !== unit.length) {
          throw new Error("Struktura přeloženého HTML bloku neodpovídá zdroji.");
        }
        unit.forEach(({ value }, segmentIndex) => {
          const values = translatedByValue.get(value) ?? [];
          values.push(segments[segmentIndex] ?? "");
          translatedByValue.set(value, values);
        });
      });
      for (const [value, translated] of translatedByValue) value.apply(translated.join(""));
      const serializer = ownerDocument.createElement("div");
      serializer.append(template.content.cloneNode(true));
      return serializer.innerHTML;
    },
  };
}
