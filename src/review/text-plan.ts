import type { FieldFormat } from "../bundles/fields";

export interface ReviewTextUnit { id: string; parts: string[]; heading: boolean; attribute?: string }
export interface ReviewTextPlan {
  units: ReviewTextUnit[];
  replace(id: string, parts: readonly string[]): string;
}
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,div,section,article,figcaption,dt,dd";
const EXCLUDED = "script,style,code,pre,textarea,noscript,template";
const ATTRIBUTES = new Set(["alt", "title", "aria-label", "data-tooltip", "data-tooltip-text", "placeholder"]);

/** Structural addresses align paragraphs without depending on translated text length.
 * Edits touch text nodes only: formatting, assets and system attributes stay intact. */
export function planReviewText(value: string, format: FieldFormat): ReviewTextPlan {
  if (format !== "html") return {
    units: [{ id: "text", parts: [value], heading: false }],
    replace(id, parts) { if (id !== "text" || parts.length !== 1) throw new Error("Invalid review block."); return parts[0]!; },
  };
  const template = document.createElement("template");
  template.innerHTML = value;
  const groups = new Map<string, { unit: ReviewTextUnit; setters: ((value: string) => void)[] }>();
  const address = new Map<Node, string>();
  const visit = (node: Node, path: string): void => {
    address.set(node, path);
    [...node.childNodes].forEach((child, i) => visit(child, `${path}/${i}`));
  };
  visit(template.content, "html");
  const add = (id: string, text: string, setter: (value: string) => void, heading = false, attribute?: string) => {
    const group = groups.get(id) ?? { unit: { id, parts: [], heading, ...(attribute ? { attribute } : {}) }, setters: [] };
    group.unit.parts.push(text); group.setters.push(setter); groups.set(id, group);
  };
  for (const [node, path] of address) {
    if (node.nodeType !== 3 || node.parentElement?.closest(EXCLUDED) || !node.textContent?.trim()) continue;
    const block = node.parentElement?.closest(BLOCKS);
    add(block ? address.get(block)! : path, node.textContent, value => { node.textContent = value; }, !!block?.matches("h1,h2,h3,h4,h5,h6"));
  }
  for (const element of template.content.querySelectorAll("*")) {
    if (element.closest(EXCLUDED)) continue;
    for (const attr of element.attributes) {
      if (ATTRIBUTES.has(attr.name) && attr.value.trim() && !/^[A-Z][A-Z0-9_]*(?:\.[A-Za-z0-9_-]+)+$/u.test(attr.value)) {
        add(`${address.get(element)}@${attr.name}`, attr.value, value => element.setAttribute(attr.name, value), false, attr.name);
      }
    }
  }
  return {
    units: [...groups.values()].map(group => group.unit),
    replace(id, parts) {
      const group = groups.get(id);
      if (!group || parts.length !== group.setters.length) throw new Error("Invalid review block.");
      group.setters.forEach((set, i) => set(parts[i]!));
      const serializer = document.createElement("div");
      serializer.append(template.content.cloneNode(true));
      return serializer.innerHTML;
    },
  };
}

const COMMAND = /@[A-Za-z][A-Za-z0-9]*\[[^\]\r\n]*\](?:\{[^}\r\n]*\})?|\[\[[^\]\r\n]*\]\]/gu;
export interface ReviewReference { marker: string; command: string; label: string; editable: boolean }
/** Friendly link markers keep UUIDs and executable syntax out of the editing surface. */
export function maskReviewReferences(value: string): { text: string; references: ReviewReference[] } {
  const references: ReviewReference[] = [];
  const text = value.replace(COMMAND, command => {
    let marker = `⟦${references.length + 1}⟧`;
    while (value.includes(marker)) marker = `⟦${marker}⟧`;
    const match = /^(@UUID\[[^\]\r\n]*\])(?:\{([^}\r\n]*)\})?$/iu.exec(command);
    references.push({ marker, command, label: match?.[2] ?? "", editable: !!match });
    return marker;
  });
  return { text, references };
}

export function restoreReviewReferences(text: string, references: readonly ReviewReference[]): string {
  let position = -1;
  for (const reference of references) {
    const index = text.indexOf(reference.marker);
    if (index <= position || index < 0 || text.indexOf(reference.marker, index + reference.marker.length) >= 0) throw new Error("Review.ReferenceChanged");
    position = index;
  }
  // Replace in one pass: a label cannot manufacture another reference marker.
  const replacements = new Map(references.map(reference => {
    if (/[{}\r\n]/u.test(reference.label)) throw new Error("Review.ReferenceChanged");
    const command = reference.editable ? reference.command.replace(/\{[^}\r\n]*\}$/u, "") + (reference.label ? `{${reference.label}}` : "") : reference.command;
    return [reference.marker, command];
  }));
  return text.replace(/⟦+[^⟦⟧]*⟧+/gu, marker => replacements.get(marker) ?? marker);
}
