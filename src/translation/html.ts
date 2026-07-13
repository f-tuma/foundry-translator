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
const TRANSLATABLE_TEXT = /[\p{L}\p{N}]/u;

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

function hasTranslatableText(nodes: readonly Text[]): boolean {
  return TRANSLATABLE_TEXT.test(nodes.map(({ data }) => data).join(""));
}

export function planHtmlTranslation(
  html: string,
  ownerDocument: Document = document,
): HtmlTranslationPlan {
  const template = ownerDocument.createElement("template");
  template.innerHTML = html;
  const covered = new Set<Text>();
  const groups: Text[][] = [];
  const blocks = [...template.content.querySelectorAll(BLOCK_SELECTOR)];
  const leafBlocks = blocks.filter((block) => !block.querySelector(BLOCK_SELECTOR));

  for (const block of leafBlocks) {
    const nodes = textDescendants(block).filter((node) => !isExcluded(node));
    nodes.forEach((node) => covered.add(node));
    if (hasTranslatableText(nodes)) groups.push(nodes);
  }

  const remaining = textDescendants(template.content as unknown as Element).filter(
    (node) => !covered.has(node) && !isExcluded(node),
  );
  for (const node of remaining) {
    if (hasTranslatableText([node])) groups.push([node]);
  }

  return {
    units: groups.map((nodes) => nodes.map(({ data }) => data)),
    apply(translatedUnits) {
      if (translatedUnits.length !== groups.length) {
        throw new Error("Počet přeložených HTML bloků neodpovídá zdroji.");
      }
      groups.forEach((nodes, groupIndex) => {
        const segments = translatedUnits[groupIndex];
        if (!segments || segments.length !== nodes.length) {
          throw new Error("Struktura přeloženého HTML bloku neodpovídá zdroji.");
        }
        nodes.forEach((node, nodeIndex) => {
          node.data = segments[nodeIndex] ?? "";
        });
      });
      const serializer = ownerDocument.createElement("div");
      serializer.append(template.content.cloneNode(true));
      return serializer.innerHTML;
    },
  };
}
